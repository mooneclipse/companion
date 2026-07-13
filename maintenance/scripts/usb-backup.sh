#!/usr/bin/env bash
# オフディスクバックアップ (machine-audit S6-2)。
# KIOXIA USB (FAT32) 上の restic リポジトリへ、GitHub バックアップのない
# ローカルデータ (音楽 / dotfiles / 鍵類 .ssh・.gnupg・keyrings / /etc) をスナップショット保存する。
# 運用: USB を挿してから `sudo ~/companion/maintenance/scripts/usb-backup.sh` を手動 1 発。
# /etc を全量読むため root 必須。初回実行時はリポジトリを自動 init する。
# パスワードは PASSWORD_FILE (マシン内) + オフマシン控えの 2 箇所保持が前提
# (ディスク全損 + USB だけ残った場合、控えがないと復元不能)。

set -euo pipefail

OWNER_HOME=/home/miho
MOUNT_POINT=/media/miho/KIOXIA
REPO="${MOUNT_POINT}/restic-repo"
PASSWORD_FILE="${OWNER_HOME}/.config/restic/usb-password"
LOG_DIR="${OWNER_HOME}/companion/logs/maintenance"
LOG_FILE="${LOG_DIR}/usb-backup-$(date '+%Y%m%d').log"
# 成功完了マーカー。daily system-report の滞留 nudge が「前回バックアップからの
# 経過日数」をここから計算する (ログは mount チェック前に生成されるため成否判定に使えない)。
STATE_FILE="${OWNER_HOME}/companion/maintenance/.state/last-usb-backup"
KEEP_LAST=12

BACKUP_PATHS=(
    "${OWNER_HOME}/ミュージック"
    "${OWNER_HOME}/music"
    "${OWNER_HOME}/bin"
    "${OWNER_HOME}/.config"
    "${OWNER_HOME}/.bashrc"
    "${OWNER_HOME}/.profile"
    "${OWNER_HOME}/.claude"
    # companion モノレポは GitHub push 対象だが、gitignore された english/media・
    # repo なしの logs/・.env 系 secret の唯一のオフディスクコピーとして丸ごと含める
    # (2026-07-07 追加、当時の (C) 区分は 2026-07-11 モノレポ化で廃止。除外は下の EXCLUDES 参照)
    "${OWNER_HOME}/companion"
    # 2026-07-13 追加: GitHub にもどこにもコピーがない漏れ分
    "${OWNER_HOME}/mineroad-analysis"
    "${OWNER_HOME}/.claude.json"
    "${OWNER_HOME}/.mozc"
    "${OWNER_HOME}/.ssh"
    "${OWNER_HOME}/.gnupg"
    "${OWNER_HOME}/.local/share/keyrings"
    "${OWNER_HOME}/ドキュメント"
    /etc
)

EXCLUDES=(
    --exclude "${OWNER_HOME}/.config/discord"
    --exclude "${OWNER_HOME}/.claude/projects"
    --exclude "${OWNER_HOME}/.claude/file-history"
    --exclude "${OWNER_HOME}/.claude/cache"
    --exclude "${OWNER_HOME}/.claude/paste-cache"
    # companion 配下の再取得・再生成可能な大物 (photos 35G は Takeout 原本 zip が別在、
    # voice/engine 3.8G は VOICEVOX 再 DL 可)
    --exclude "${OWNER_HOME}/companion/photos"
    --exclude "${OWNER_HOME}/companion/voice/engine"
    # 名前一致でどこでも除外 (再生成可能物)
    --exclude ".venv"
    --exclude "venv"
    --exclude "node_modules"
    --exclude "__pycache__"
)

if [[ $EUID -ne 0 ]]; then
    echo "root が必要 (/etc の全量読み取り)。sudo $0 で実行する" >&2
    exit 1
fi

mkdir -p "$LOG_DIR"
touch "$LOG_FILE" && chown miho:miho "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

if ! mountpoint -q "$MOUNT_POINT"; then
    echo "USB が ${MOUNT_POINT} にマウントされていない。挿してから再実行" >&2
    exit 1
fi

if [[ ! -r "$PASSWORD_FILE" ]]; then
    echo "パスワードファイルがない: ${PASSWORD_FILE}" >&2
    exit 1
fi

export RESTIC_REPOSITORY="$REPO"
export RESTIC_PASSWORD_FILE="$PASSWORD_FILE"

log "=== usb-backup 開始 ==="

if [[ ! -f "${REPO}/config" ]]; then
    log "リポジトリ未初期化。restic init を実行"
    restic init
fi

log "backup: ${BACKUP_PATHS[*]}"
restic backup "${EXCLUDES[@]}" "${BACKUP_PATHS[@]}"

log "forget --group-by host --keep-last ${KEEP_LAST} --prune"
restic forget --group-by host --keep-last "$KEEP_LAST" --prune

log "check"
restic check

log "snapshots (現在の世代一覧)"
restic snapshots

# 成功完了マーカーを更新 (ここまで到達 = set -e 下で全工程成功)。
mkdir -p "$(dirname "$STATE_FILE")"
date '+%Y-%m-%d' > "$STATE_FILE"
chown miho:miho "$STATE_FILE"
log "state 更新: ${STATE_FILE}"

log "=== 完了。抜く前にファイラの取り出し (アンマウント) を忘れずに ==="
