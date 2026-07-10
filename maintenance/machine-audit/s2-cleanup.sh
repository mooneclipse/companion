#!/usr/bin/env bash
# machine-audit S2: 未使用サービス・パッケージ整理の一括実行 (PLAN.md S2)
# 実行: sudo bash ~/companion/maintenance/machine-audit/s2-cleanup.sh
# 出力は画面と LOG の両方に残る。
# 対象 (2026-06-10 ユーザー確認済み):
#   無効化 = openvpn(設定空) / rsync(デーモン未設定) / ModemManager / casper-md5check(LiveISO用) / cups一式(プリンタ0台)
#   navidrome は手動設置のため直削除 (unit + バイナリ + データ + 専用ユーザー、~/ミュージック は無傷)
#   variety / mineroad-analysis は残す (ユーザー判断)
set -u

if [ "$(id -u)" -ne 0 ]; then
    echo "sudo で実行してください: sudo bash $0" >&2
    exit 1
fi

LOG=/home/miho/companion/logs/maintenance/machine-audit-s2-$(date +%Y%m%d).log
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "===== machine-audit S2 $(date '+%F %T') ====="

echo "=== [1/5] 未使用サービス無効化 ==="
systemctl disable --now openvpn rsync ModemManager casper-md5check cups cups-browsed cups.socket cups.path
echo "[1/5] rc=$?"
systemctl reset-failed casper-md5check 2>&1
for s in openvpn rsync ModemManager casper-md5check cups cups-browsed cups.socket cups.path; do
    printf "%-20s enabled=%-12s active=%s\n" "$s" "$(systemctl is-enabled "$s" 2>&1)" "$(systemctl is-active "$s" 2>&1)"
done

echo "=== [2/5] apt autoremove --purge (gcc-10-base:i386, mint-backgrounds-vanessa) ==="
apt autoremove --purge -y
echo "[2/5] rc=$?"

echo "=== [3/5] kept back 3 件の適用 (fwupd/libjcat1/libxmlb2, jammy-updates。依存追加が要るため明示 install) ==="
apt install -y fwupd libjcat1 libxmlb2
echo "[3/5] rc=$?"

echo "=== [4/5] navidrome 完全撤去 ==="
rm -v /etc/systemd/system/navidrome.service /usr/local/bin/navidrome
echo "rm(unit+bin) rc=$?"
rm -r /var/lib/navidrome
echo "rm(data) rc=$?"
userdel navidrome
echo "userdel rc=$?"
systemctl daemon-reload
echo "[4/5] rc=$?"

echo "=== [5/5] 事後状態 ==="
echo "--- failed units (system) ---"
systemctl list-units --failed --no-pager
echo "--- apt 状態 ---"
apt list --upgradable 2>/dev/null
echo "--- listen ポート (631 が消えているはず) ---"
ss -tlnp

echo "===== 完了 $(date '+%F %T') ====="
echo "LOG: $LOG"
