#!/usr/bin/env bash
set -euo pipefail

cat > /etc/systemd/system/powertop-autotune.service << 'UNIT'
[Unit]
Description=PowerTOP auto-tune
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/powertop --auto-tune

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable powertop-autotune
echo "powertop-autotune.service enabled (runs at boot)"
systemctl list-unit-files powertop-autotune.service
