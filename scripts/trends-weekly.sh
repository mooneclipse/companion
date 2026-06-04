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

REPO="${HOME}/companion/maintenance"
CONFIG="${REPO}/config/trends-sources.yaml"
STATE="${REPO}/.state/trends-seen-urls.json"
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

# --- claude バイナリ解決 (node バージョンをハードコードしない) -------------------
CLAUDE_BIN="$(command -v claude || true)"
if [[ -z "$CLAUDE_BIN" ]]; then
    CLAUDE_BIN="$(ls "$HOME"/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1 || true)"
fi
if [[ -z "$CLAUDE_BIN" ]]; then
    log "abort: claude バイナリが見つからない"
    exit 1
fi

# --- ISO 週ラベルとノートパスを確定 ----------------------------------------------
isoweek="$(date +%G-W%V)"          # 例 2026-W23
note_name="${isoweek} AIトレンド.md"
note_path="${VAULT_DIR}/${note_name}"

# --- 冪等ゲート: 対象ノートが既存なら no-op -------------------------------------
if [[ -f "$note_path" ]]; then
    log "skip: note already exists for ${isoweek} (${note_path})"
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
    prompt="/trends-report new-items.json は ${new_items} にあります。ISO 週ラベルは ${isoweek}、出力先は ${report} です。指定の書式で日本語の週次トレンドノートを ${report} に Write してください。"
    log "invoking claude -p (/trends-report)"
    if ! timeout 600 "$CLAUDE_BIN" -p "$prompt" \
            --output-format json \
            --permission-mode acceptEdits \
            --allowedTools "Read Write Edit" \
            --max-budget-usd 1.0 \
            < /dev/null >> "$OUR_LOG" 2>&1; then
        log "abort: claude -p 失敗 (state 未更新)"
        exit 1
    fi
    if [[ ! -s "$report" ]]; then
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

# --- Discord 通知 (best-effort) -------------------------------------------------
# socket 在席時のみ送る。不在 / 送信失敗でも本体は成功扱い (bot 停止時も成功)。
if [[ -S "$SOCK" ]]; then
    body="今週の AI トレンドレポートできたよ: ${isoweek}"
    if printf '%s' "$body" | nc -U -N "$SOCK"; then
        log "notify sent (${isoweek})"
    else
        log "notify send failed (best-effort, 無視)"
    fi
else
    log "notify skip: socket not present (${SOCK})"
fi

# WORKDIR のクリーンアップは EXIT trap (冒頭) が一元実施する。
log "done (${isoweek})"
