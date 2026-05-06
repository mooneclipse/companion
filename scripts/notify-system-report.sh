#!/usr/bin/env bash
# 日次のシステムリソースレポート（ディスク / メモリ / CPU 温度）を
# companion-bot の Unix socket 経由で OWNER DM に通知する。
# 同日 2 回目以降は state ファイルで二重通知抑止。
# 注意: df / free / sensors の出力フォーマット前提。

set -euo pipefail

STATE_DIR="${HOME}/companion/maintenance/.state"
STATE_FILE="${STATE_DIR}/last-notified-system-report"
OUR_LOG="${HOME}/companion/logs/maintenance/notify-system-report.log"
SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"

mkdir -p "$STATE_DIR" "$(dirname "$OUR_LOG")"

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$OUR_LOG"
}

today=$(date '+%Y-%m-%d')
last_notified=""
[[ -f "$STATE_FILE" ]] && last_notified=$(cat "$STATE_FILE")

if [[ "$today" == "$last_notified" ]]; then
    log "skip: already notified today ($today)"
    exit 0
fi

disk_line=$(df -h / | awk 'NR==2 {printf "ディスク (/): %s / %s (%s)", $3, $2, $5}')

mem_lines=$(free -h | awk '
    /^Mem:/  { printf "メモリ: %s / %s (空き %s)\n", $3, $2, $7 }
    /^Swap:/ { printf "swap: %s / %s", $3, $2 }
')

temp_line=""
if command -v sensors >/dev/null 2>&1; then
    temp_c=$(sensors 2>/dev/null | awk '
        /^Package id 0:/ { gsub(/[^0-9.]/, "", $4); print $4; exit }
    ')
    if [[ -n "$temp_c" ]]; then
        temp_line=$(printf 'CPU 温度: %s°C' "$temp_c")
    fi
fi

if [[ ! -S "$SOCK" ]]; then
    log "skip send: socket not present ($SOCK)"
    exit 0
fi

now=$(date '+%Y-%m-%d %H:%M')
body=$(printf 'システムレポート %s\n%s\n%s' "$now" "$disk_line" "$mem_lines")
[[ -n "$temp_line" ]] && body=$(printf '%s\n%s' "$body" "$temp_line")

if printf '%s' "$body" | nc -U -N "$SOCK"; then
    printf '%s' "$today" > "$STATE_FILE"
    log "notified for $today"
else
    log "send failed"
    exit 1
fi
