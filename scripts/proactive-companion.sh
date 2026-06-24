#!/usr/bin/env bash
# companion-bot に「自発的に話しかける」発火依頼を出す判定スクリプト。
#
# 設計出典: ~/companion/vault/notes/2026-05-30_proactive-companion-messaging-design.md
# (§4 推奨方向 / §5 最小スケッチ)。判定は state (session JSON / state file) を
# 1 回引いて確定する (CLAUDE.md 2 周目ルール: stderr 文言マッチ / 場当たり
# リトライ / 条件分岐の積み増しを使わない)。
#
# claude 起動は **しない**。条件成立時、bot の Unix socket に「自発発話依頼」を
# 構造化メッセージ ([[proactive-v1]] + JSON) で渡すだけ。claude 起動 + budget
# guard + 送信は bot 側 (M-14 単一 guard 境界、迂回禁止)。
#
# 判定順 (どれか一つでも不成立なら exit 0、依頼を出さない):
#   1. PROACTIVE_ENABLED が 1 系か (グローバル on/off)
#   2. 現在時刻が発火時間帯 (PROACTIVE_HOUR_START〜END JST) 内か
#   3. snooze 中でないか (state file の snooze_until)
#   4. 全 topic session の max(last_prompt_at) から沈黙閾値 (PROACTIVE_SILENCE_HOURS) 超か
#   5. 過去 168h (7 日) のローリングウィンドウ内の発火回数が上限未満か
#      (state file の proactive_fire_epochs = 発火 epoch のカンマ区切り列、
#      PROACTIVE_WEEKLY_MAX 回上限)。日次上限 → 週ローリングに置換 (OWNER 確定
#      2026-06-19): step7 の活性度確率変調 (乗ってる日↑/静かな日↓) と噛み合わせ、
#      硬い日次天井で乗ってる日の山を頭打ちにせず波の振幅を週総量で管理する。
#   6. 種があるか (直近 topic session の存在 + 任意で当日 vault 追記)。種ゼロなら発火しない
#      ※発火が確定した回の種の中身は、週 1 (PROACTIVE_DORMANT_INTERVAL_DAYS) で
#        「死蔵知識との再会」(古い vault ノートの掘り起こし) に切り替わる。判定順
#        1〜7 自体は変えない (persona 軸 4 実装 (2)、チケット #20)
#   7. 確率パス (PROACTIVE_PROBABILITY を関心 index の活性度で変調した実効確率) を通ったか
#      ※実効確率は step7 内で「関心 index の活性度」に連動して上下する (固定→波)。
#        活性度が高い日 (新鮮なスレッドが多い) = 乗ってる日 = 発火しやすく、
#        decay で静かになると発火しにくくなる。波の生成は決定的 (index を 1 回引いて
#        導く純関数、per-tick の追加乱数で静寂を作らない)。index が空 / 全 decay 済みなら
#        base 確率 (従来挙動) に戻す (bootstrap-safe、persona 軸 4 拡張 (2)、TODO (2))。

set -euo pipefail

STATE_FILE="${HOME}/companion/maintenance/.state/proactive"
OUR_LOG="${HOME}/companion/logs/maintenance/proactive-companion.log"

# 5:30 の朝報 (dashboard-notify-ren-quotes.py が /quotes を取得して書く) の構造化
# データ。当日分の天気を先回り発話の材料に渡す唯一の経路 (helper は 09:00 停止で
# ライブ取得不可、チケット #36)。当日 (JST) と一致する場合のみ天気を抽出する。
MORNING_REPORT_FILE="${HOME}/companion/dashboard/.state/morning-report.json"

SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"
SESSIONS_DIR="${HOME}/companion/bot/sessions/topics"
VAULT_NOTES_DIR="${HOME}/companion/vault/notes"

# --- 調整可能パラメータ (env override 可、未設定時は確定済デフォルト) -------------
PROACTIVE_ENABLED="${PROACTIVE_ENABLED:-1}"
PROACTIVE_HOUR_START="${PROACTIVE_HOUR_START:-9}"     # JST、この時刻以上で発火可
PROACTIVE_HOUR_END="${PROACTIVE_HOUR_END:-22}"        # JST、この時刻未満で発火可 (22:00 ちょうどは除外)
PROACTIVE_SILENCE_HOURS="${PROACTIVE_SILENCE_HOURS:-4}"
PROACTIVE_PROBABILITY="${PROACTIVE_PROBABILITY:-0.7}" # 0.0〜1.0、種ありかつ条件成立時に発火する確率
PROACTIVE_WEEKLY_MAX="${PROACTIVE_WEEKLY_MAX:-8}"     # 過去 168h (7 日) ローリングの発火回数上限
PROACTIVE_DORMANT_INTERVAL_DAYS="${PROACTIVE_DORMANT_INTERVAL_DAYS:-7}"  # 死蔵知識種の最短間隔 (日)
PROACTIVE_DORMANT_MIN_AGE_DAYS="${PROACTIVE_DORMANT_MIN_AGE_DAYS:-30}"   # この日数より古い mtime のノートを死蔵候補とする

# --- 不在の可変ケイデンス (関心 index 活性度 → step7 実効確率の変調、TODO (2)) -------
# PROACTIVE_PROBABILITY を base とし、活性度 a∈[0,1] で
#   P_eff = P_MOD_FLOOR + (P_MOD_CEIL - P_MOD_FLOOR) * a   (FLOOR<=P_eff<=CEIL)
# に変調する。CEIL は乗ってる日 (活性度1) の上限 = base より上に取り、乗ってる日に実効確率を
# base を越えて集中発火させる (OWNER 確定 2026-06-19)。以前は CEIL=base に張って「ほぼ毎日」
# 上限を越えないようにしていたが、step5 を日次上限 → 週ローリング総量上限に移したことで
# 「乗ってる日の山」を硬い日次天井で頭打ちにする必要が無くなった。日々の波は活性度確率に
# 任せ、鬱陶しさの安全弁は週総量 (PROACTIVE_WEEKLY_MAX) 側で受ける役割分担にしたため、
# CEIL を base より上げて波の振幅を出す。FLOOR は静かな日の最低発火率。FRESHNESS_DAYS =
# 活性度を測る新鮮さ窓 = このケイデンスの唯一の窓 (step7 で decay と activity_score の両方に
# この 1 値を渡す。bot.py の滲ませ用 decay TTL=14=PROACTIVE_INTEREST_TTL_DAYS とは別管理)。
# FLOOR=CEIL=base にすれば変調幅 0 = 従来の固定ケイデンスに戻る (env で戻せる経路)。
INTERESTS_INDEX="${HOME}/companion/bot/sessions/companion_interests.json"
BOT_DIR="${HOME}/companion/bot"
PROACTIVE_CADENCE_FRESHNESS_DAYS="${PROACTIVE_CADENCE_FRESHNESS_DAYS:-5}"   # 活性度を測る新鮮さ窓 (日)
PROACTIVE_PROBABILITY_FLOOR="${PROACTIVE_PROBABILITY_FLOOR:-0.25}"          # 静かな日 (活性度0) の実効確率の下限
PROACTIVE_PROBABILITY_CEIL="${PROACTIVE_PROBABILITY_CEIL:-0.92}"            # 乗ってる日 (活性度1) の上限 (base 超で集中発火、週総量で安全弁)

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$OUR_LOG")"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$OUR_LOG"
}

# state file は単純な key=value 行 (snooze_until=<epoch> /
# proactive_fire_epochs=<発火 epoch のカンマ区切り列、過去 168h ローリング上限の
#   カウント源。handoff 成功時に now_epoch を 1 つ足し 168h 超を prune してから書く> /
# last_dormant_date=<YYYY-MM-DD、死蔵知識種を最後に使った日> /
# dormant_last=<前回掘り起こしたノート basename、連続同一ノート除外用>)。
# 旧 last_proactive_date / proactive_count は週ローリングに置換され不要 (OWNER 確定
# 2026-06-19)。bot.py write_snooze_until は総なめ保持なので残骸があっても害なし
# (script 側が書かなくなれば自然に持ち越されなくなる)。無ければ空扱い。
state_get() {
    local key="$1"
    [[ -f "$STATE_FILE" ]] || return 0
    awk -F= -v k="$key" '$1==k {print $2; exit}' "$STATE_FILE"
}

# --- 1. グローバル on/off ---------------------------------------------------------
case "$PROACTIVE_ENABLED" in
    1|true|TRUE|yes|on) : ;;
    *) log "skip: PROACTIVE_ENABLED=$PROACTIVE_ENABLED (disabled)"; exit 0 ;;
esac

# JST 基準の now を一度だけ確定する (以降の時刻判定はこの値で揃える)。
now_epoch=$(date +%s)
now_hour_jst=$(TZ='Asia/Tokyo' date -d "@${now_epoch}" '+%-H')
today_jst=$(TZ='Asia/Tokyo' date -d "@${now_epoch}" '+%Y-%m-%d')

# --- 2. 発火時間帯 (JST) ----------------------------------------------------------
if (( now_hour_jst < PROACTIVE_HOUR_START || now_hour_jst >= PROACTIVE_HOUR_END )); then
    log "skip: outside active window (hour_jst=$now_hour_jst, window=${PROACTIVE_HOUR_START}-${PROACTIVE_HOUR_END})"
    exit 0
fi

# --- 3. snooze 中か ---------------------------------------------------------------
snooze_until=$(state_get snooze_until)
if [[ -n "$snooze_until" ]] && (( now_epoch < snooze_until )); then
    log "skip: snoozed until epoch=$snooze_until (now=$now_epoch)"
    exit 0
fi

# --- 4. 沈黙閾値 (全 topic max(last_prompt_at)) -----------------------------------
# session JSON の last_prompt_at (ISO8601、null あり) を全 topic から拾い、最大
# (=最も新しい) epoch を取る。1 つでも最近なら沈黙していない。
silence_threshold_epoch=$(( now_epoch - PROACTIVE_SILENCE_HOURS * 3600 ))
max_last_prompt_epoch=0

if [[ -d "$SESSIONS_DIR" ]]; then
    while IFS= read -r -d '' f; do
        iso=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        d = json.load(fh)
except Exception:
    sys.exit(0)
v = d.get("last_prompt_at")
if v:
    print(v)
' "$f")
        [[ -z "$iso" ]] && continue
        # ISO8601 (tz 付き) → epoch。date -d は ISO8601 を解釈できる。
        ep=$(date -d "$iso" +%s 2>/dev/null || echo 0)
        (( ep > max_last_prompt_epoch )) && max_last_prompt_epoch=$ep
    done < <(find "$SESSIONS_DIR" -maxdepth 1 -type f -name '*.json' -print0)
fi

if (( max_last_prompt_epoch == 0 )); then
    # 会話実績ゼロ = 種ゼロ扱い (Meta ガード (b): 会話実績がある topic にだけ出す)。
    log "skip: no session with last_prompt_at (no conversation history)"
    exit 0
fi

if (( max_last_prompt_epoch > silence_threshold_epoch )); then
    log "skip: not silent enough (max_last_prompt_epoch=$max_last_prompt_epoch > threshold=$silence_threshold_epoch)"
    exit 0
fi

# 沈黙時間 (整数時間)。bot 側 build_proactive_prompt が数値検証して prompt に展開する
# (「最後の会話から約 N 時間経っている」)。閾値判定はあくまで上記 1 回で確定済み、
# この値は prompt の文脈足し専用。
silence_hours=$(( (now_epoch - max_last_prompt_epoch) / 3600 ))

# --- 5. 週ローリング上限 (過去 168h、PROACTIVE_WEEKLY_MAX 回) -----------------------
# 日次上限 → 週ローリングに置換 (OWNER 確定 2026-06-19)。発火履歴は script 側 state の
# proactive_fire_epochs (カンマ区切り epoch 列) で持ち、ここを 1 回だけ読んで
# now_epoch - 168*3600 より新しい epoch を数える (= 過去 7 日のローリングカウント)。
# カウント源は script 側 handoff 履歴 1 本のみ (bot 側 ledger は読まない: handoff
# カウントと実送信カウントの 2 源混在 = 二重計上 = 2 周目ルール抵触を避ける)。
# 判定は state を 1 回引いて確定 (read-once の epoch 列から純粋に出す、乱数を増やさない)。
#
# bootstrap-safe: キー無し / 空 / parse 不能 / 旧形式 state (proactive_count のみ) は
# すべて 0 回扱い (発火可) に正規化する (「state が引けない」を履歴ゼロの 1 状態に倒す、
# interests.load_interests と同じ思想、回復用の条件分岐を積まない)。set -euo pipefail
# 下で python3 が異常終了しても末尾 `|| recent_fire_count=""` で空に倒し、直後の
# `[[ -z ]]` で 0 に正規化する (errexit による step5 即死を防ぐ)。
fire_epochs_raw=$(state_get proactive_fire_epochs)
window_start_epoch=$(( now_epoch - 168 * 3600 ))
recent_fire_count=$(python3 -c '
import sys
raw, window_start = sys.argv[1], sys.argv[2]
try:
    cutoff = int(window_start)
    n = 0
    for tok in raw.split(","):
        tok = tok.strip()
        if not tok:
            continue
        try:
            ep = int(tok)
        except (TypeError, ValueError):
            # parse 不能トークンは無視 (履歴ゼロ寄り = 発火可へ倒す)。
            continue
        if ep >= cutoff:
            n += 1
    print(n)
except Exception:
    # 算出不能はすべて 0 (発火可) へ正規化。
    print(0)
' "$fire_epochs_raw" "$window_start_epoch") \
    || recent_fire_count=""

# python3 が何も返さない (異常終了 / rc≠0 で上の || が空にした) 場合は 0 回へ正規化。
if [[ -z "$recent_fire_count" ]]; then
    recent_fire_count=0
fi

if (( recent_fire_count >= PROACTIVE_WEEKLY_MAX )); then
    log "skip: already fired ${recent_fire_count}x in last 168h (max=$PROACTIVE_WEEKLY_MAX)"
    exit 0
fi

# --- 6. 種を集める (最小: 直近会話あり=確定済。任意で当日 vault 追記を種ヒントに足す) ---
# 直近会話は §4-4 で max_last_prompt_epoch > 0 = 既に成立。当日 vault 追記があれば
# 種ヒントに足す (必須でない)。種ヒントは bot 側 prompt の文脈足しに使う。
#
# 死蔵知識との再会 (persona 軸 4 実装 (2)、チケット #20): 前回の死蔵種から
# PROACTIVE_DORMANT_INTERVAL_DAYS 日以上空いていれば、古い (mtime が
# PROACTIVE_DORMANT_MIN_AGE_DAYS 日より過去) ノートをランダム 1 件掘り起こして
# 種に切り替える。判定は state の last_dormant_date 1 回引きで確定 (2 周目ルール)。
# 候補ゼロ (古いノートなし / 前回分の除外で空) ならそのまま従来種で続行し、
# last_dormant_date は更新しない (次回の発火で再挑戦)。リトライ loop は作らない。
seed_kind="recent_conversation"
vault_hint=""
dormant_hint=""
last_dormant_date=$(state_get last_dormant_date)
dormant_last=$(state_get dormant_last)

dormant_due=0
if [[ -z "$last_dormant_date" ]]; then
    dormant_due=1
else
    # YYYY-MM-DD 同士の日数差 (JST 固定、DST なしなので 86400 で正確に割れる)。
    # parse 不能な値は epoch 0 = 差が巨大 = due 扱い (state 1 回引きで確定、再試行しない)。
    last_dormant_epoch=$(TZ='Asia/Tokyo' date -d "$last_dormant_date" +%s 2>/dev/null || echo 0)
    today_epoch=$(TZ='Asia/Tokyo' date -d "$today_jst" +%s)
    if (( (today_epoch - last_dormant_epoch) / 86400 >= PROACTIVE_DORMANT_INTERVAL_DAYS )); then
        dormant_due=1
    fi
fi

if (( dormant_due )) && [[ -d "$VAULT_NOTES_DIR" ]]; then
    # 候補 = notes 直下の *.md で mtime が MIN_AGE_DAYS 日超 (find -mtime +N の
    # 切り捨て仕様により実質 N+1 日以上) 古いもの。前回掘り起こした basename
    # (dormant_last) は除外し、残りからランダム 1 件。
    dormant_candidates=""
    while IFS= read -r note; do
        base=$(basename "$note" .md)
        [[ "$base" == "$dormant_last" ]] && continue
        dormant_candidates+="${base}"$'\n'
    done < <(find "$VAULT_NOTES_DIR" -maxdepth 1 -type f -name '*.md' -mtime +"$PROACTIVE_DORMANT_MIN_AGE_DAYS" 2>/dev/null)
    if [[ -n "$dormant_candidates" ]]; then
        dormant_hint=$(printf '%s' "$dormant_candidates" | shuf -n1)
        seed_kind="dormant_knowledge"
    fi
fi

# 死蔵種を使う回は当日 vault_hint を付けない (1 メッセージ 1 話題、軸 4「1〜3 行で
# 短く」と整合)。直近会話ベースの silence_hours はそのまま渡す。
if [[ -z "$dormant_hint" && -d "$VAULT_NOTES_DIR" ]]; then
    # 当日 mtime のノートファイル名 (拡張子なし) を最大 3 件、種ヒントに足す。本文は
    # 渡さない (プライバシー: ファイル名 = 日付/トピック程度の手がかりに留める)。
    while IFS= read -r note; do
        base=$(basename "$note" .md)
        if [[ -z "$vault_hint" ]]; then
            vault_hint="$base"
        else
            vault_hint="${vault_hint}, ${base}"
        fi
    done < <(find "$VAULT_NOTES_DIR" -maxdepth 1 -type f -name '*.md' -newermt "$today_jst 00:00:00" 2>/dev/null | head -n3)
    [[ -n "$vault_hint" ]] && seed_kind="recent_conversation+vault"
fi

# --- 7. 確率パス (関心 index 活性度で変調した実効確率) ---------------------------
# 関心 index を 1 回だけ読み、bot/interests.py の canonical な decay + activity_score で
# 活性度 a∈[0,1] を算出する (decay の意味を script 側で別解釈にしない = DRY)。a から
# 実効確率 eff_probability を変調する。波の生成は決定的: a は read-once の index から
# 純粋に導かれ、ここで乱数を増やさない (最終ロール 1 個だけが乱数源)。
#
# decay と activity_score には同じ FRESHNESS_DAYS を渡す。activity_score 自体が窓
# フィルタ (窓外は寄与 0) を内包するので、ケイデンス用の窓は FRESHNESS_DAYS 1 本で
# 決まる。先に decay を同窓でかけているのは保持期限の正規化 (窓外スレッドを index から
# 落として「自分の時間が流れる」手触りを保つ) で、activity_score 結果は decay の有無で
# 変わらない (decay 後 0 本でも score=0.0)。bot.py 側の滲ませ用 decay TTL=14
# (PROACTIVE_INTEREST_TTL_DAYS) はこのケイデンス窓とは別管理 (bot 側で別途 decay する)。
#
# bootstrap-safe (最重要): index 未生成 / 空 / 全 decay 済み (a=0) でも、実効確率を 0 に
# 潰さず FLOOR 以上を保つ。さらに import 失敗・算出エラー時は base 確率 (従来挙動) に
# フォールバックする = 「state が引けない」を 1 状態 (=従来の固定ケイデンス) に正規化する
# (interests.py の load_interests と同じ思想、回復用の条件分岐ではない)。
# env の float 変換 / import / 算出をすべて try 内に置き、どこで失敗しても except で
# base に倒す (FLOOR 等に非数値が入る ValueError も含め全経路を base へ正規化)。
# command substitution 末尾の `|| eff_probability=""` は python3 不在 (rc 127) や
# kill 等で python が非ゼロ終了した場合に set -e による step7 即死を防ぎ、空文字 →
# 直後の `[[ -z ]]` 既定動作 (base) に確実に落とすため (「state が引けない」= base の
# 1 状態への正規化を、errexit 下でも貫通させない)。
eff_probability=$(python3 -c '
import sys
from datetime import datetime
from pathlib import Path

index_path, bot_dir, freshness, floor, ceil, base = sys.argv[1:7]
try:
    freshness = float(freshness); floor = float(floor)
    ceil = float(ceil); base = float(base)
    sys.path.insert(0, bot_dir)
    import interests
    data = interests.load_interests(Path(index_path))
    now = datetime.now()
    threads = data.get("threads") or []
    if not threads:
        # index 未生成 / 空 = まだ bootstrap 前。base (従来固定ケイデンス) を維持して
        # 発火させ、index を seeding させる。ここを潰すと永久に bootstrap できない
        # (「state が無い」= 従来挙動への正規化、interests.load_interests と同じ思想)。
        # threads が 1 本でもあれば全 decay でも「静かな日 (FLOOR)」= 別状態。
        eff = base
    else:
        data = interests.decay(data, now, ttl_days=freshness)
        a = interests.activity_score(data, now, freshness_days=freshness)
        eff = floor + (ceil - floor) * a
        # 念のため [0,1] にクランプ (env の FLOOR/CEIL 設定ミス耐性)。
        eff = max(0.0, min(1.0, eff))
except Exception:
    # float 変換 / import / 算出のいずれかが失敗 = state が引けない →
    # base (従来固定ケイデンス) へ正規化。base 自体の変換も try 内なので float() で包む。
    try:
        eff = float(base)
    except (TypeError, ValueError):
        eff = 0.0
print("%.4f" % eff)
' "$INTERESTS_INDEX" "$BOT_DIR" "$PROACTIVE_CADENCE_FRESHNESS_DAYS" \
    "$PROACTIVE_PROBABILITY_FLOOR" "$PROACTIVE_PROBABILITY_CEIL" "$PROACTIVE_PROBABILITY") \
    || eff_probability=""

# python3 が何も返さない (異常終了 / rc≠0 で上の || が空にした) 場合は base へ正規化
# (bootstrap-safe の二重化ではなく、「実効確率が引けない」の 1 状態を base に倒す既定動作)。
if [[ -z "$eff_probability" ]]; then
    eff_probability="$PROACTIVE_PROBABILITY"
fi

# awk で [0,1) 乱数を引き、実効確率未満なら発火。
roll=$(awk 'BEGIN { srand(); print rand() }')
if awk -v r="$roll" -v p="$eff_probability" 'BEGIN { exit !(r < p) }'; then
    : # 発火
else
    log "skip: probability gate (roll=$roll >= eff_p=$eff_probability, base=$PROACTIVE_PROBABILITY)"
    exit 0
fi

# --- socket 不在なら skip (maintenance lib と同方針、bot 停止時は skip) -------------
if [[ ! -S "$SOCK" ]]; then
    log "skip: socket not present ($SOCK)"
    exit 0
fi

# --- 自発発話依頼を構造化メッセージで送る -----------------------------------------
# [[proactive-v1]] 行マーカー + JSON。bot 側の socket 接続ハンドラがこのマーカーを
# 検出して proactive 経路へ振り分ける (既存の素通し通知 = 文字列 forward 経路には
# 触れない)。JSON は seed ヒントを bot 側 prompt に足すための材料。
#
# 今朝の朝報 (天気) も当日分だけこの payload 構築 python3 の中で 1 回読み取り・1 回
# 判定して obj に足す (チケット #36)。5:30 の朝報 JSON
# (dashboard/.state/morning-report.json) を **1 回だけ** open し、`date` が当日 (JST)
# と一致しかつ天気配列が空でない場合のみ morning_weather (天気行を改行区切り) と
# morning_hint (占い + ニュース見出しを改行区切り) を obj に付ける。判定は state (JSON)
# を 1 回引いて確定する (2 周目ルール: 文言マッチ / 場当たりリトライ / 条件分岐の
# 積み増しを使わない)。ファイル不在・JSON 壊れ・日付が古い (前日以前)・天気配列が空、
# のいずれかなら morning_weather / morning_hint とも obj に **付けない** (古い天気を
# 絶対に渡さない)。hint は weather が有効なときだけ出す (weather 空なら hint も無効、の
# 結合を維持)。python3 で JSON を読むのはこのスクリプトの既存慣習 (session JSON 読みも
# すべて python3)。多行値をシェル変数経由で渡すと改行と衝突するため、朝報の読み取りは
# この payload 構築 python3 に MORNING_REPORT_FILE と today_jst を渡して内部で完結させる。
payload=$(python3 -c '
import json, sys
(seed_kind, vault_hint, dormant_hint, silence_hours,
 morning_report_file, today) = sys.argv[1:7]
obj = {"kind": "proactive", "version": 1, "seed_kind": seed_kind,
       "silence_hours": int(silence_hours)}
if vault_hint:
    obj["vault_hint"] = vault_hint
if dormant_hint:
    obj["dormant_hint"] = dormant_hint
# 朝報 JSON を 1 回だけ open し、当日 (JST) かつ天気ありのときだけ
# morning_weather / morning_hint を足す。読めない / 古い / 天気空はすべて
# 「朝報なし」の 1 状態に倒し、フィールドを付けない (古い天気を渡さない)。
try:
    with open(morning_report_file, encoding="utf-8") as fh:
        report = json.load(fh)
except Exception:
    report = None
if isinstance(report, dict) and report.get("date") == today:
    weather = [w for w in (report.get("weather") or []) if isinstance(w, str) and w]
    if weather:
        obj["morning_weather"] = "\n".join(weather)
        hint_parts = []
        fortune = report.get("fortune")
        if isinstance(fortune, str) and fortune:
            hint_parts.append(fortune)
        hint_parts.extend(
            n for n in (report.get("news") or []) if isinstance(n, str) and n
        )
        if hint_parts:
            obj["morning_hint"] = "\n".join(hint_parts)
print(json.dumps(obj, ensure_ascii=False))
' "$seed_kind" "$vault_hint" "$dormant_hint" "$silence_hours" "$MORNING_REPORT_FILE" "$today_jst")

message=$(printf '[[proactive-v1]]\n%s' "$payload")

if printf '%s' "$message" | nc -U -N "$SOCK"; then
    # 週ローリング履歴 proactive_fire_epochs に now_epoch を 1 つ足し、168h より古い
    # epoch を prune してから書き戻す (state が単調肥大しない)。依頼の handoff 成功
    # (socket 書き込み成功) を以て 1 回消費する。bot 側で guard 拒否 / claude 失敗
    # だった場合も script からは再試行しない (場当たりリトライ禁止、2 周目ルール)。
    # bot 側の成否は bot 側 ledger / log に残る (script は handoff 履歴 1 本のみ持つ)。
    # snooze_until は保持する (依頼が通っても snooze 設定は消さない)。
    # 注意: ここはキー明示列挙で書き戻す (bot 側 write_snooze_until の総なめ保持と
    # 非対称)。state に新キーを足すときは、この書き戻しにも必ず足すこと。
    # 旧 last_proactive_date / proactive_count は週ローリング化で廃止 (書かない)。
    new_fire_epochs=$(python3 -c '
import sys
raw, now_epoch, window_start = sys.argv[1], sys.argv[2], sys.argv[3]
now = int(now_epoch)
cutoff = int(window_start)
kept = []
for tok in raw.split(","):
    tok = tok.strip()
    if not tok:
        continue
    try:
        ep = int(tok)
    except (TypeError, ValueError):
        continue
    if ep >= cutoff:
        kept.append(ep)
kept.append(now)
print(",".join(str(e) for e in sorted(kept)))
' "$fire_epochs_raw" "$now_epoch" "$window_start_epoch") \
        || new_fire_epochs=""

    # python3 が異常終了 (rc≠0 で上の || が空にした) 場合、最低限この回の now_epoch
    # だけは記録する (handoff は成功済み = この発火を週カウントから漏らさない、
    # 二重発火リスクを断つ既定動作)。「prune が引けない」を「今回分のみ記録」の
    # 1 状態に倒す (errexit 下でも state 更新を貫通させる、step7 と同じ思想)。
    if [[ -z "$new_fire_epochs" ]]; then
        new_fire_epochs="$now_epoch"
    fi

    tmp=$(mktemp "${STATE_FILE}.XXXXXX")
    [[ -n "$snooze_until" ]] && printf 'snooze_until=%s\n' "$snooze_until" >> "$tmp"
    printf 'proactive_fire_epochs=%s\n' "$new_fire_epochs" >> "$tmp"
    # 死蔵知識キー: 死蔵種を使った回は today + 掘り起こした basename で更新。
    # 使わなかった回 (従来種 / 候補ゼロ) も既存値をそのまま保持して書き戻す。
    if [[ -n "$dormant_hint" ]]; then
        printf 'last_dormant_date=%s\n' "$today_jst" >> "$tmp"
        printf 'dormant_last=%s\n' "$dormant_hint" >> "$tmp"
    else
        [[ -n "$last_dormant_date" ]] && printf 'last_dormant_date=%s\n' "$last_dormant_date" >> "$tmp"
        [[ -n "$dormant_last" ]] && printf 'dormant_last=%s\n' "$dormant_last" >> "$tmp"
    fi
    mv "$tmp" "$STATE_FILE"
    log "proactive request sent (seed_kind=$seed_kind, vault_hint='${vault_hint}', dormant_hint='${dormant_hint}', silence_hours=$silence_hours, roll=$roll, eff_p=$eff_probability, weekly_count=$(( recent_fire_count + 1 ))/$PROACTIVE_WEEKLY_MAX)"
else
    log "send failed"
    exit 1
fi
