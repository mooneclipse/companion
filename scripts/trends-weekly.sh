#!/usr/bin/env bash
# AI 技術トレンド週次収集レポート — オーケストレーション。
#
# 週 1 回 systemd user timer (companion-trends.timer) から起動される。
#   RSS 収集 (lib/trends_fetch.py) → claude -p で要約 (/trends-report skill)
#   → Obsidian vault に Markdown ノート 1 枚を書き込む。
# 放置運用前提: 冪等 (同週再実行は no-op) / 部分失敗許容 / budget bound。
#
# 設計の要点 (CLAUDE.md 2 周目ルール準拠):
# - rc 判定は 1 回で確定する。stderr 文言マッチ / 場当たりリトライをしない。
#   失敗時は state を更新せず exit 1 で抜け、systemd journal に失敗を残す
#   (state を進めないので次回実行で取りこぼした記事を拾い直せる = 冪等)。
# - vault 書き込みは shell が一元管理する (claude には vault 権限を渡さない
#   = CLAUDE.md の vault 書き込み境界遵守)。
# - Discord 通知は best-effort。socket 不在 / 送信失敗でも本体は成功扱い。

set -euo pipefail

# REPO はこのスクリプト実体 (scripts/trends-weekly.sh) の親の親 = maintenance ルート。
# readlink -f で symlink 越しでも実体を辿る。どの cwd から起動されても以降のパスと
# claude -p の cwd を maintenance ルートに固定するため (skill /trends-report は
# project skill = <cwd>/.claude/skills/ にあり、cwd 依存で解決される)。
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
CONFIG="${REPO}/config/trends-sources.yaml"
STATE="${REPO}/.state/trends-seen-urls.json"
# 配信冪等の state: 最後に Telegram 通知した ISO 週を 1 行で持つ。
# ノート生成の冪等 (trends-seen-urls.json / ノート存在) とは別軸。
# 前倒し生成 (予算超過リカバリ等) でノートが既にあっても、その週を
# まだ通知していなければ土曜発火で配信する判定に使う。
# 命名は notify-system-report.sh / notify-unattended-upgrades.sh の
# last-notified-* 慣習に寄せた。
NOTIFY_STATE="${REPO}/.state/last-notified-trends-week"
# 失敗通知の冪等 state: 最後に「失敗」を Telegram 通知した ISO 週を 1 行で持つ。
# 成功通知 (NOTIFY_STATE) とは別軸に分ける。同じ週で失敗→修正→成功した場合に
# 成功通知が抑止されないよう、state を混ぜない (失敗通知済みでも成功通知は
# NOTIFY_STATE 側で独立に判定される)。timer の Persistent catch-up で同じ週の
# 失敗が連続発火しても、この state を 1 回引いて二重送信を抑える。
FAILED_NOTIFY_STATE="${REPO}/.state/last-failed-trends-week"
WORKDIR="${REPO}/.state/trends-work"
FETCH_PY="${REPO}/lib/trends_fetch.py"
OUR_LOG="${HOME}/companion/logs/maintenance/trends-weekly.log"
VAULT_DIR="${HOME}/companion/vault/notes/ai-trends"

SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"

# state 保持週数。これより古い seen エントリは prune (無限肥大防止)。
SEEN_KEEP_WEEKS=26

mkdir -p "$(dirname "$STATE")" "$WORKDIR" "$VAULT_DIR" "$(dirname "$OUR_LOG")"

# WORKDIR は中間生成物 (new-items.json / report.md) 置き場。正常終了でも
# 途中 exit (fetch 失敗 / report 空 / claude 失敗) でも残さないよう、EXIT trap で
# 一元的にクリアする (vault への配置は別パスなので消えない)。
trap 'rm -rf "${WORKDIR:?}"/* 2>/dev/null || true' EXIT

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$OUR_LOG"
}

# --- 配信 (best-effort、配信冪等は NOTIFY_STATE で確定) ----------------------------
# 引数の ISO 週をまだ通知していなければ socket 経由で 1 回だけ通知する。
# 配信済みか否かは NOTIFY_STATE を 1 回引いて確定する (state を持つ側で判定。
# stderr 文言マッチや場当たりリトライで分岐しない = CLAUDE.md 対症療法ルール準拠)。
#   - 既に同じ週を通知済み → skip (二重通知しない)。
#   - socket 不在 / 送信失敗 → state を更新しない (次回発火で再試行できる)。
#   - 実際に送れたときだけ NOTIFY_STATE を当該週に更新する。
notify_week() {
    local week="$1"
    local last=""
    [[ -f "$NOTIFY_STATE" ]] && last="$(cat "$NOTIFY_STATE")"
    if [[ "$last" == "$week" ]]; then
        log "notify skip: already notified (${week})"
        return 0
    fi
    if [[ ! -S "$SOCK" ]]; then
        log "notify skip: socket not present (${SOCK})"
        return 0
    fi
    local body="今週の AI トレンドレポートできたよ: ${week}"
    if printf '%s' "$body" | nc -U -N "$SOCK"; then
        printf '%s' "$week" > "$NOTIFY_STATE"
        log "notify sent (${week})"
    else
        log "notify send failed (best-effort, 無視)"
    fi
}

# --- ISO 週ラベルとノートパスを確定 ----------------------------------------------
# claude バイナリ解決より前に算出する。失敗通知 (notify_failure) が常に week を
# 添えて送れるようにするため (バイナリ不在パスもこの時点で isoweek が確定済み)。
isoweek="$(date +%G-W%V)"          # 例 2026-W23
note_name="${isoweek} AIトレンド.md"
note_path="${VAULT_DIR}/${note_name}"

# --- 失敗通知 (best-effort、失敗冪等は FAILED_NOTIFY_STATE で確定) -----------------
# 生成が失敗した段階で、その週をまだ「失敗通知」していなければ socket 経由で
# 1 回だけ理由付きで通知する。冪等は FAILED_NOTIFY_STATE を 1 回引いて確定する
# (state を持つ側で判定。stderr 文言マッチや場当たりリトライで分岐しない)。
#   - 同じ週で既に成功通知済み (NOTIFY_STATE 一致) → 失敗通知は送らない
#     (前倒し生成で成功済みの週に遅れて失敗が来ても矛盾通知を出さない)。
#   - 同じ週で既に失敗通知済み → skip (catch-up 連続発火で連投しない)。
#   - socket 不在 / 送信失敗 → state を更新しない (次回発火で再試行できる)。
#   - 実際に送れたときだけ FAILED_NOTIFY_STATE を当該週に更新する。
# notify_week と同じく内部で rc を握り、set -e 下でも本体の exit 1 を巻き込まない。
notify_failure() {
    local reason="$1"
    local week="$isoweek"
    local notified="" failed_last=""
    [[ -f "$NOTIFY_STATE" ]] && notified="$(cat "$NOTIFY_STATE")"
    if [[ "$notified" == "$week" ]]; then
        log "notify-fail skip: week already notified as success (${week})"
        return 0
    fi
    [[ -f "$FAILED_NOTIFY_STATE" ]] && failed_last="$(cat "$FAILED_NOTIFY_STATE")"
    if [[ "$failed_last" == "$week" ]]; then
        log "notify-fail skip: already notified failure (${week})"
        return 0
    fi
    if [[ ! -S "$SOCK" ]]; then
        log "notify-fail skip: socket not present (${SOCK})"
        return 0
    fi
    local body="今週の AI トレンドレポート生成に失敗: ${reason} (${week})"
    if printf '%s' "$body" | nc -U -N "$SOCK"; then
        printf '%s' "$week" > "$FAILED_NOTIFY_STATE"
        log "notify-fail sent: ${reason} (${week})"
    else
        log "notify-fail send failed (best-effort, 無視)"
    fi
    return 0
}

# --- claude バイナリ解決 (node バージョンをハードコードしない) -------------------
CLAUDE_BIN="$(command -v claude || true)"
if [[ -z "$CLAUDE_BIN" ]]; then
    CLAUDE_BIN="$(ls "$HOME"/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1 || true)"
fi
if [[ -z "$CLAUDE_BIN" ]]; then
    notify_failure "claudeバイナリ不在"
    log "abort: claude バイナリが見つからない"
    exit 1
fi

# --- 生成の冪等ゲート: 対象ノートが既存なら再生成しない -------------------------
# ただし配信は別軸。前倒し生成 (予算超過リカバリ等) で土曜より前にノートが
# 生成済みでも、その週をまだ通知していなければここで配信してから抜ける
# (生成の冪等は維持、配信の取りこぼしを塞ぐ)。配信済み判定は notify_week が
# NOTIFY_STATE を引いて確定する。
if [[ -f "$note_path" ]]; then
    log "skip generate: note already exists for ${isoweek} (${note_path})"
    notify_week "$isoweek"
    exit 0
fi

# --- WORKDIR を毎回クリア (EXIT trap が前回分を消すが、trap 設置前に死んだ
#     ケースの取りこぼしに備えた防御的 pre-clear) --------------------------------
rm -rf "${WORKDIR:?}"/*
new_items="${WORKDIR}/new-items.json"
report="${WORKDIR}/report.md"

# --- RSS 収集 -------------------------------------------------------------------
log "fetch start (isoweek=${isoweek})"
if ! python3 "$FETCH_PY" "$CONFIG" "$STATE" "$new_items" 2>>"$OUR_LOG"; then
    notify_failure "fetch失敗"
    log "abort: trends_fetch.py 失敗 (state 未更新)"
    exit 1
fi

total_new="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["total_new"])' "$new_items" 2>>"$OUR_LOG")"
log "fetch done: total_new=${total_new}"

# --- ノート生成 -----------------------------------------------------------------
if [[ "$total_new" -eq 0 ]]; then
    # 0 件: claude を呼ばず shell が最小ノートを直接書く (budget 節約)。
    log "no new items; writing minimal note without claude"
    today="$(date '+%Y-%m-%d')"
    {
        printf -- '---\n'
        printf 'tags: [ai-trends]\n'
        printf 'week: %s\n' "$isoweek"
        printf 'created: %s\n' "$today"
        printf -- '---\n\n'
        printf '# %s AIトレンド\n\n' "$isoweek"
        printf '## 今週のまとめ\n\n'
        printf '今週は新規の収集記事はありませんでした。\n'
        # failed_sources があれば注記
        failed="$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
fs=d.get("failed_sources") or []
print(", ".join(fs))
' "$new_items")"
        if [[ -n "$failed" ]]; then
            printf '\n> 収集できなかったソース: %s\n' "$failed"
        fi
    } > "$report"
else
    # 1 件以上: claude -p で /trends-report skill を実行。rc は 1 回で確定する。
    # project skill (/trends-report) は cwd 依存で解決されるため、必ず REPO を
    # cwd にして呼ぶ (サブシェルで cd。これがないと systemd 経由の cwd=$HOME で
    # Unknown command になる)。new_items / report は WORKDIR 派生の絶対パスなので
    # cd しても読み書きは壊れない。
    prompt="/trends-report new-items.json は ${new_items} にあります。ISO 週ラベルは ${isoweek}、出力先は ${report} です。指定の書式で日本語の週次トレンドノートを ${report} に Write してください。"
    log "invoking claude -p (/trends-report) in cwd=${REPO}"
    # --model は明示固定する。未指定だと既定モデルの変動を丸ごと受け、要約タスクに
    # 不相応な高単価モデル (例: fable-5 $10/$50) を引いて --max-budget-usd を超える
    # (2026-06-13 W24 が fable-5 で $1.08 = 上限超過で失敗)。trends-report は RSS の
    # クラスタリング+要約+整形で sonnet-4-6 ($3/$15) で十分。budget は state を持つ
    # 側 (= --model) を 1 回引いて確定する (CLAUDE.md 対症療法 2 周目ルール)。
    if ! ( cd "$REPO" && timeout 600 "$CLAUDE_BIN" -p "$prompt" \
            --output-format json \
            --permission-mode acceptEdits \
            --allowedTools "Read Write Edit" \
            --model claude-sonnet-4-6 \
            --max-budget-usd 1.0 \
            < /dev/null ) >> "$OUR_LOG" 2>&1; then
        notify_failure "claude -p失敗(予算超過/timeout含む)"
        log "abort: claude -p 失敗 (state 未更新)"
        exit 1
    fi
    if [[ ! -s "$report" ]]; then
        notify_failure "report空"
        log "abort: report.md が空または未生成 (state 未更新)"
        exit 1
    fi
fi

# --- vault 配置 (shell が一元管理) ----------------------------------------------
cp "$report" "$note_path"
log "note written: ${note_path}"

# --- state 更新 (成功後のみ) ----------------------------------------------------
# new-items.json の各 URL を {url: isoweek} で seen に追記。SEEN_KEEP_WEEKS より
# 古いエントリは prune。一時ファイル + mv で原子的に書く。
tmp_state="$(mktemp "${STATE}.XXXXXX")"
if python3 - "$STATE" "$new_items" "$isoweek" "$SEEN_KEEP_WEEKS" "$tmp_state" <<'PY'
import datetime as dt
import json
import sys

state_path, items_path, isoweek, keep_weeks, out_path = sys.argv[1:6]
keep_weeks = int(keep_weeks)

# 既存 seen を読む
try:
    with open(state_path, encoding="utf-8") as fh:
        seen = json.load(fh)
except (FileNotFoundError, json.JSONDecodeError):
    seen = {}

# 今回の URL を追記 ({url: isoweek})
with open(items_path, encoding="utf-8") as fh:
    items = json.load(fh).get("items", [])
for it in items:
    url = it.get("url")
    if url:
        seen[url] = isoweek

# prune: keep_weeks より古い ISO 週のエントリを落とす
def week_to_monday(label):
    # "YYYY-Www" -> その週の月曜の date
    try:
        y, w = label.split("-W")
        return dt.date.fromisocalendar(int(y), int(w), 1)
    except Exception:
        return None

cur_monday = week_to_monday(isoweek)
if cur_monday is not None:
    cutoff = cur_monday - dt.timedelta(weeks=keep_weeks)
    pruned = {}
    for url, wk in seen.items():
        m = week_to_monday(wk)
        if m is None or m >= cutoff:
            pruned[url] = wk
    seen = pruned

with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(seen, fh, ensure_ascii=False, indent=0)
PY
then
    mv "$tmp_state" "$STATE"
    log "state updated (seen-urls)"
else
    rm -f "$tmp_state"
    log "warn: state 更新失敗 (ノートは生成済み、次回 dedup が効かない可能性)"
fi

# --- 通知 (best-effort) ---------------------------------------------------------
# socket 在席時のみ送る。不在 / 送信失敗でも本体は成功扱い (bot 停止時も成功)。
# 配信冪等は notify_week が NOTIFY_STATE で確定する (新規生成パスでも、未通知
# なら 1 回だけ送り、送れたときだけ state を進める)。
notify_week "$isoweek"

# WORKDIR のクリーンアップは EXIT trap (冒頭) が一元実施する。
log "done (${isoweek})"
