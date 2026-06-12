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
#   5. 同 JST 日の発火回数が上限未満か (state file の last_proactive_date +
#      proactive_count、1 日 PROACTIVE_DAILY_MAX 回上限)
#   6. 種があるか (直近 topic session の存在 + 任意で当日 vault 追記)。種ゼロなら発火しない
#      ※発火が確定した回の種の中身は、週 1 (PROACTIVE_DORMANT_INTERVAL_DAYS) で
#        「死蔵知識との再会」(古い vault ノートの掘り起こし) に切り替わる。判定順
#        1〜7 自体は変えない (persona 軸 4 実装 (2)、チケット #20)
#   7. 確率パス (PROACTIVE_PROBABILITY) を通ったか

set -euo pipefail

STATE_FILE="${HOME}/companion/maintenance/.state/proactive"
OUR_LOG="${HOME}/companion/logs/maintenance/proactive-companion.log"

SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"
SESSIONS_DIR="${HOME}/companion/bot/sessions/topics"
VAULT_NOTES_DIR="${HOME}/companion/vault/notes"

# --- 調整可能パラメータ (env override 可、未設定時は確定済デフォルト) -------------
PROACTIVE_ENABLED="${PROACTIVE_ENABLED:-1}"
PROACTIVE_HOUR_START="${PROACTIVE_HOUR_START:-9}"     # JST、この時刻以上で発火可
PROACTIVE_HOUR_END="${PROACTIVE_HOUR_END:-22}"        # JST、この時刻未満で発火可 (22:00 ちょうどは除外)
PROACTIVE_SILENCE_HOURS="${PROACTIVE_SILENCE_HOURS:-4}"
PROACTIVE_PROBABILITY="${PROACTIVE_PROBABILITY:-0.7}" # 0.0〜1.0、種ありかつ条件成立時に発火する確率
PROACTIVE_DAILY_MAX="${PROACTIVE_DAILY_MAX:-2}"       # 同 JST 日の発火回数上限
PROACTIVE_DORMANT_INTERVAL_DAYS="${PROACTIVE_DORMANT_INTERVAL_DAYS:-7}"  # 死蔵知識種の最短間隔 (日)
PROACTIVE_DORMANT_MIN_AGE_DAYS="${PROACTIVE_DORMANT_MIN_AGE_DAYS:-30}"   # この日数より古い mtime のノートを死蔵候補とする

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$OUR_LOG")"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$OUR_LOG"
}

# state file は単純な key=value 行 (snooze_until=<epoch> /
# last_proactive_date=<YYYY-MM-DD> / proactive_count=<その日の発火回数> /
# last_dormant_date=<YYYY-MM-DD、死蔵知識種を最後に使った日> /
# dormant_last=<前回掘り起こしたノート basename、連続同一ノート除外用>)。
# 無ければ空扱い。
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

# --- 5. 1 日上限 (JST 日付単位、PROACTIVE_DAILY_MAX 回) ----------------------------
last_proactive_date=$(state_get last_proactive_date)
proactive_count=$(state_get proactive_count)
today_count=0
if [[ "$last_proactive_date" == "$today_jst" ]]; then
    # 後方互換: 旧形式 state (proactive_count なし) は「本日 1 回発火済み」の
    # 意味だったので count=1 とみなす (安全側)。
    today_count="${proactive_count:-1}"
fi
if (( today_count >= PROACTIVE_DAILY_MAX )); then
    log "skip: already fired ${today_count}x today ($today_jst, max=$PROACTIVE_DAILY_MAX)"
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
    # 候補 = notes 直下の *.md で mtime が MIN_AGE_DAYS 日より古いもの。前回掘り
    # 起こした basename (dormant_last) は除外し、残りからランダム 1 件。
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

# --- 7. 確率パス -----------------------------------------------------------------
# awk で [0,1) 乱数を引き、PROBABILITY 未満なら発火。閾値は env 調整可。
roll=$(awk 'BEGIN { srand(); print rand() }')
if awk -v r="$roll" -v p="$PROACTIVE_PROBABILITY" 'BEGIN { exit !(r < p) }'; then
    : # 発火
else
    log "skip: probability gate (roll=$roll >= p=$PROACTIVE_PROBABILITY)"
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
payload=$(python3 -c '
import json, sys
seed_kind, vault_hint, dormant_hint, silence_hours = sys.argv[1:5]
obj = {"kind": "proactive", "version": 1, "seed_kind": seed_kind,
       "silence_hours": int(silence_hours)}
if vault_hint:
    obj["vault_hint"] = vault_hint
if dormant_hint:
    obj["dormant_hint"] = dormant_hint
print(json.dumps(obj, ensure_ascii=False))
' "$seed_kind" "$vault_hint" "$dormant_hint" "$silence_hours")

message=$(printf '[[proactive-v1]]\n%s' "$payload")

if printf '%s' "$message" | nc -U -N "$SOCK"; then
    # last_proactive_date=today + proactive_count を +1 = 「本日の 1 回分を消費」を
    # state で確定 (日付が変わっていれば count=1 から数え直し)。依頼の handoff 成功
    # (socket 書き込み成功) を以て消費する。bot 側で guard 拒否 / claude 失敗だった
    # 場合も script からは再試行しない (場当たりリトライ禁止、2 周目ルール)。
    # bot 側の成否は bot 側 ledger / log に残る。
    # snooze_until は保持する (依頼が通っても snooze 設定は消さない)。
    # 注意: ここはキー明示列挙で書き戻す (bot 側 write_snooze_until の総なめ保持と
    # 非対称)。state に新キーを足すときは、この書き戻しにも必ず足すこと。
    tmp=$(mktemp "${STATE_FILE}.XXXXXX")
    [[ -n "$snooze_until" ]] && printf 'snooze_until=%s\n' "$snooze_until" >> "$tmp"
    printf 'last_proactive_date=%s\n' "$today_jst" >> "$tmp"
    printf 'proactive_count=%s\n' "$(( today_count + 1 ))" >> "$tmp"
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
    log "proactive request sent (seed_kind=$seed_kind, vault_hint='${vault_hint}', dormant_hint='${dormant_hint}', silence_hours=$silence_hours, roll=$roll)"
else
    log "send failed"
    exit 1
fi
