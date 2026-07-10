#!/usr/bin/env bash
# dashboard-restore-volume.sh — dashboard.service の ExecStopPost。
# 起動時に dashboard-start.sh が保存した sink の音量・mute 状態を復元する。
#
# ・状態ファイルが無ければ no-op（手動 start 経由していない場合や、起動側 pactl 失敗時の事故防止）。
# ・pactl 失敗は warning のみで rc 0 を保つ（stop を失敗させない）。
# ・cgroup-kill 後 / 異常終了後でも ExecStopPost で必ず通る経路。

set -u

DASH_DIR="$HOME/companion/dashboard"
PREV_VOL_FILE="$DASH_DIR/.state/prev-sink-volume"
PREV_MUTE_FILE="$DASH_DIR/.state/prev-sink-mute"

if [ -s "$PREV_VOL_FILE" ]; then
  PREV_VOL=$(cat "$PREV_VOL_FILE")
  if [[ "$PREV_VOL" =~ ^[0-9]+%$ ]]; then
    pactl set-sink-volume @DEFAULT_SINK@ "$PREV_VOL" \
      || echo "dashboard-restore-volume.sh: set-sink-volume $PREV_VOL failed" >&2
  else
    echo "dashboard-restore-volume.sh: invalid saved volume '$PREV_VOL' — skip" >&2
  fi
  rm -f "$PREV_VOL_FILE"   # set 失敗でも消す: 「失敗時に次回 stop へ持ち越して retry」をしない方針（対症療法 2 周目）
fi

if [ -s "$PREV_MUTE_FILE" ]; then
  PREV_MUTE=$(cat "$PREV_MUTE_FILE")
  case "$PREV_MUTE" in
    yes) pactl set-sink-mute @DEFAULT_SINK@ 1 || echo "dashboard-restore-volume.sh: set-sink-mute 1 failed" >&2 ;;
    no)  pactl set-sink-mute @DEFAULT_SINK@ 0 || echo "dashboard-restore-volume.sh: set-sink-mute 0 failed" >&2 ;;
    *)   echo "dashboard-restore-volume.sh: invalid saved mute '$PREV_MUTE' — skip" >&2 ;;
  esac
  rm -f "$PREV_MUTE_FILE"   # 同上（持ち越し retry なし）
fi

exit 0
