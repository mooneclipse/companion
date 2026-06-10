#!/usr/bin/env bash
# machine-audit S6-1: RAM 逼迫の解消 — zram 導入 + 物理増設の判断材料収集 (PLAN.md S6-1、sudo が要る分のみ)
# 実行: sudo bash ~/companion/maintenance/machine-audit/s6-1-zram.sh
# 出力は画面と LOG の両方に残る。
# 設定根拠 (2026-06-10 実物確認済):
#   - zram-tools 0.3.3.1 の /etc/default/zramswap は ALGO / PERCENT / PRIORITY を読む (PERCENT が SIZE より優先)
#   - kernel 5.15.0-181 は CONFIG_CRYPTO_ZSTD=m で zstd 利用可
#   - ALGO=zstd (回転 HDD 比で十分速く圧縮率優先) / PERCENT=50 (~1.85G) / PRIORITY=100 (swapfile prio -2 より先に使われる)
#   - 既存 /swapfile 2G は overflow として残す (撤去しない)
set -u

if [ "$(id -u)" -ne 0 ]; then
    echo "sudo で実行してください: sudo bash $0" >&2
    exit 1
fi

LOG=/home/miho/companion/logs/maintenance/machine-audit-s6-1-$(date +%Y%m%d).log
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "===== machine-audit S6-1 $(date '+%F %T') ====="

echo "=== [1/4] 物理増設の判断材料: dmidecode -t memory (スロット数・現装着・最大容量) ==="
dmidecode -t memory
echo "[1/4] rc=$?"

echo "=== [2/4] zram-tools インストール ==="
apt-get install -y zram-tools
echo "[2/4] rc=$?"

echo "=== [3/4] /etc/default/zramswap 設定 + zramswap 起動 ==="
[ -e /etc/default/zramswap.dist ] || cp -a /etc/default/zramswap /etc/default/zramswap.dist
cat > /etc/default/zramswap <<'EOF'
# machine-audit S6-1 (2026-06-10): zstd / RAM の 50% / HDD swapfile (prio -2) より優先
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
cat /etc/default/zramswap
systemctl enable zramswap.service
systemctl restart zramswap.service
echo "[3/4] rc=$?"

echo "=== [4/4] 事後状態 ==="
echo "--- comp_algorithm ([zstd] が選択されていれば OK) ---"
cat /sys/block/zram0/comp_algorithm
echo "--- zramctl ---"
zramctl
echo "--- swapon (zram0 prio 100 / swapfile prio -2 の 2 段構成が正) ---"
swapon --show
echo "--- free ---"
free -h
echo "--- ログ所有者を miho に ---"
chown miho:miho /home/miho/companion/logs/maintenance/machine-audit-s6-1-*.log

echo "===== 完了 $(date '+%F %T') ====="
echo "LOG: $LOG"
