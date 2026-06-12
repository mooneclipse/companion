#!/usr/bin/env bash
# 日次のシステムリソースレポート（ディスク / メモリ / CPU 温度 / apt 滞留 / 再起動待ち）を
# companion-bot の Unix socket 経由で通知する。
# 同日 2 回目以降は state ファイルで二重通知抑止。
# 注意: df / free / sensors / apt list の出力フォーマット前提。

set -euo pipefail

STATE_FILE="${HOME}/companion/maintenance/.state/last-notified-system-report"
OUR_LOG="${HOME}/companion/logs/maintenance/notify-system-report.log"

# shellcheck source=../lib/notify.sh
source "$(dirname "$0")/../lib/notify.sh"

today=$(date '+%Y-%m-%d')

if state_matches "$today"; then
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

# apt 滞留数 (kept back 含む)。mintupdate automation (毎晩 00:18) が適用しない
# 更新が残留していないかの検出が目的。同じ件数が何日も続いたら kept back を疑う。
# キャッシュは読むだけ (apt update はしない。mintupdate が毎晩 refresh 済み)。
if apt_list=$(LC_ALL=C apt list --upgradable 2>/dev/null); then
    apt_pending=$(grep -c '\[upgradable from:' <<< "$apt_list" || true)
    apt_line=$(printf 'apt 滞留: %s 件' "$apt_pending")
else
    apt_line='apt 滞留: 取得失敗'
fi

reboot_line=""
[[ -f /var/run/reboot-required ]] && reboot_line='再起動待ち: あり'

now=$(date '+%Y-%m-%d %H:%M')
body=$(printf 'システムレポート %s\n%s\n%s' "$now" "$disk_line" "$mem_lines")
[[ -n "$temp_line" ]] && body=$(printf '%s\n%s' "$body" "$temp_line")
body=$(printf '%s\n%s' "$body" "$apt_line")
[[ -n "$reboot_line" ]] && body=$(printf '%s\n%s' "$body" "$reboot_line")

# voice 異常の可視化 (voice-design.md v2.0 §1.5 (3))。集計元は say.sh が書く
# voice/.state/last-result-YYYY-MM-DD (今日 + 昨日 ≈ 直近 24h、ファイル不在 = 0 件)。
# padding skipped は exit 0 で bot /say 応答に乗らないためここが唯一の表面化経路。
voice_state="${HOME}/companion/voice/.state"
voice_files=("$voice_state/last-result-$today" "$voice_state/last-result-$(date -d yesterday '+%Y-%m-%d')")
voice_fails=$(cat "${voice_files[@]}" 2>/dev/null | grep -c '^FAIL' || true)
voice_pad=$(cat "${voice_files[@]}" 2>/dev/null | grep -c '^padding skipped' || true)
voice_warn=""
[[ "$voice_fails" -ge 3 ]] && voice_warn="voice FAIL: ${voice_fails} 件/24h"
[[ "$voice_pad" -ge 5 ]] && voice_warn="${voice_warn:+$voice_warn / }voice padding skipped: ${voice_pad} 件/24h"
[[ -n "$voice_warn" ]] && body=$(printf '%s\n%s' "$body" "$voice_warn")

notify_send "$body" "$today"
