#!/usr/bin/env bash
# machine-audit S3: ディスク・ログ衛生の一括実行 (PLAN.md S3、sudo が要る分のみ)
# 実行: sudo bash ~/companion/maintenance/machine-audit/s3-hygiene.sh
# 出力は画面と LOG の両方に残る。
# sudo 不要分 (npm cache 2.8G / claude -tmp-* 残骸) は claude 側で実行済み。
# mozilla キャッシュは smart_size 自動管理 (~1G 上限) が効いており対応不要で確定。
set -u

if [ "$(id -u)" -ne 0 ]; then
    echo "sudo で実行してください: sudo bash $0" >&2
    exit 1
fi

LOG=/home/miho/companion/logs/maintenance/machine-audit-s3-$(date +%Y%m%d).log
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "===== machine-audit S3 $(date '+%F %T') ====="

echo "=== [1/4] journald 上限設定 (SystemMaxUse=200M) + 即時 vacuum ==="
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/size.conf
cat /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald
journalctl --vacuum-size=200M
echo "[1/4] rc=$?"
journalctl --disk-usage

echo "=== [2/4] S2 残務: orphan 回収 (libfwupdplugin5) ==="
apt autoremove --purge -y
echo "[2/4] rc=$?"

echo "=== [3/4] machine-audit ログの所有者を miho に (sudo 実行で root 所有になっていた分) ==="
chown miho:miho /home/miho/companion/logs/maintenance/machine-audit-s*.log
echo "[3/4] rc=$?"
ls -la /home/miho/companion/logs/maintenance/

echo "=== [4/4] 事後状態 ==="
echo "--- autoremove 残り (空が正) ---"
apt-get -s autoremove 2>/dev/null | grep -E "^Remv" || echo "(なし)"
df -h /

echo "===== 完了 $(date '+%F %T') ====="
echo "LOG: $LOG"
