#!/usr/bin/env bash
set -u

[ -n "${INVOCATION_ID:-}" ] || { echo "screensaver-start.sh: must be run via systemd" >&2; exit 1; }

SS_DIR="$HOME/companion/screensaver"
WEB_URL="file://$SS_DIR/web/index.html"
FF_PROFILE="$SS_DIR/.state/ff-profile"

export DISPLAY="${DISPLAY:-:0}"

if systemctl --user is-active --quiet dashboard.service 2>/dev/null; then
  echo "screensaver-start.sh: dashboard.service is active — skipping" >&2
  exit 0
fi

mkdir -p "$FF_PROFILE"
rm -f "$FF_PROFILE/.parentlock" "$FF_PROFILE/lock" "$FF_PROFILE/xulstore.json" 2>/dev/null
cp "$SS_DIR/web/user.js.template" "$FF_PROFILE/user.js"

firefox --new-instance --no-remote --profile "$FF_PROFILE" \
        --kiosk --kiosk-monitor=1 "$WEB_URL" &
echo "screensaver-start.sh: firefox launched (kiosk on monitor 1 = HDMI-1)"

exec sleep infinity
