#!/usr/bin/env bash
# unattended-upgrades の直近実行結果を companion-bot の Unix socket 経由で
# OWNER DM に通知する。同一実行は state ファイルで二重通知抑止。
# 注意: 状態判定は ja_JP ロケールのログメッセージ前提。

set -euo pipefail

LOG_FILE="/var/log/unattended-upgrades/unattended-upgrades.log"
STATE_FILE="${HOME}/companion/maintenance/.state/last-notified-unattended-upgrades"
OUR_LOG="${HOME}/companion/logs/maintenance/notify-unattended-upgrades.log"

# shellcheck source=../lib/notify.sh
source "$(dirname "$0")/../lib/notify.sh"

if [[ ! -r "$LOG_FILE" ]]; then
    log "skip: log not readable ($LOG_FILE)"
    exit 0
fi

start_line=$( (grep -n '自動アップグレードスクリプトを開始します' "$LOG_FILE" || true) | tail -n1 | cut -d: -f1)

if [[ -z "$start_line" ]]; then
    log "skip: no start marker"
    exit 0
fi

start_ts=$(sed -n "${start_line}p" "$LOG_FILE" | awk '{print $1, $2}')

if state_matches "$start_ts"; then
    log "skip: already notified ($start_ts)"
    exit 0
fi

body_section=$(tail -n +"$start_line" "$LOG_FILE")

if grep -q '自動更新可能なパッケージおよび保留中の自動削除が見つかりません' <<< "$body_section"; then
    result_line="状態: 更新対象なし"
elif grep -q 'パッケージのアップグレードが終了しました' <<< "$body_section"; then
    result_line="状態: 更新完了"
elif grep -qi 'ERROR' <<< "$body_section"; then
    err=$(grep -i 'ERROR' <<< "$body_section" | head -n3)
    result_line=$(printf '状態: エラー\n%s' "$err")
else
    # 結果マーカー未到達（apt-daily 起動で u-u 呼出されたが判定途中で停止する等）。
    # 次回 timer 発火時に結果マーカーが揃っていれば通知する。
    log "skip: result not yet logged ($start_ts)"
    exit 0
fi

reboot_line=""
if [[ -f /var/run/reboot-required ]]; then
    reboot_line="再起動が必要"
    if [[ -r /var/run/reboot-required.pkgs ]]; then
        pkgs=$(tr '\n' ' ' < /var/run/reboot-required.pkgs | sed 's/ $//')
        [[ -n "$pkgs" ]] && reboot_line="${reboot_line}: ${pkgs}"
    fi
fi

body=$(printf 'unattended-upgrades 結果\n開始: %s\n%s' "$start_ts" "$result_line")
[[ -n "$reboot_line" ]] && body=$(printf '%s\n%s' "$body" "$reboot_line")

notify_send "$body" "$start_ts"
