#!/usr/bin/env bash
# machine-audit S1: セキュリティ修正の一括実行 (PLAN.md S1 の 1〜4)
# 実行: sudo bash ~/companion/maintenance/machine-audit/s1-security.sh
# 出力は画面と LOG の両方に残る。ip6tables の追加要否は LOG を見て判断する。
set -u

if [ "$(id -u)" -ne 0 ]; then
    echo "sudo で実行してください: sudo bash $0" >&2
    exit 1
fi

LOG=/home/miho/companion/logs/maintenance/machine-audit-s1-$(date +%Y%m%d).log
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "===== machine-audit S1 $(date '+%F %T') ====="

echo "=== [1/4] /etc/iptables/rules.v6 (x11vnc [::]:5900 ブロック確認) ==="
cat /etc/iptables/rules.v6
echo "[1/4] rc=$?"

echo "=== [2/4] ufw status verbose ==="
ufw status verbose
echo "[2/4] rc=$?"

echo "=== [3/4] apt upgrade (openssl/libssl3/vim 系 security 更新) ==="
apt upgrade -y
echo "[3/4] rc=$?"

echo "=== [4/4] navidrome 停止 + 無効化 (データは /var/lib/navidrome に残置) ==="
systemctl disable --now navidrome.service
echo "[4/4] rc=$?"
echo "is-enabled: $(systemctl is-enabled navidrome.service 2>&1)"
echo "is-active:  $(systemctl is-active navidrome.service 2>&1)"

echo "===== 完了 $(date '+%F %T') ====="
echo "LOG: $LOG"
