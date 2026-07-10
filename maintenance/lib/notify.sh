#!/usr/bin/env bash
# companion-bot の Unix socket への通知を共通化するライブラリ。
# source して使う。呼び出し側で以下を事前に設定する:
#   STATE_FILE : 二重通知抑止用ファイルパス
#   OUR_LOG    : このタスク固有のログファイルパス

: "${STATE_FILE:?STATE_FILE must be set before sourcing notify.sh}"
: "${OUR_LOG:?OUR_LOG must be set before sourcing notify.sh}"

SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$OUR_LOG")"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$OUR_LOG"
}

# state ファイルの内容が引数と一致すれば 0（= 既に通知済み）。
state_matches() {
    local expected="$1"
    local current=""
    [[ -f "$STATE_FILE" ]] && current=$(cat "$STATE_FILE")
    [[ "$current" == "$expected" ]]
}

# socket に body を送信。成功時は state に marker を書き、ログに記録。
# socket 不在時は skip ログを残して exit 0、送信失敗時は exit 1。
notify_send() {
    local body="$1"
    local marker="$2"

    if [[ ! -S "$SOCK" ]]; then
        log "skip send: socket not present ($SOCK)"
        exit 0
    fi

    if printf '%s' "$body" | nc -U -N "$SOCK"; then
        printf '%s' "$marker" > "$STATE_FILE"
        log "notified for $marker"
    else
        log "send failed"
        exit 1
    fi
}
