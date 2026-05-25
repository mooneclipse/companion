#!/usr/bin/env bash
# dashboard-start.sh — dashboard.service の ExecStart。systemd 経由でのみ起動する想定。
#
# シーケンス: 音量固定 → 時間帯フォルダ判定 → mpv(空ならskip) → now-playing helper → firefox(--kiosk --kiosk-monitor=1 で HDMI-1 占有) → exec sleep infinity
# 停止は dashboard-stop.timer(09:00) → systemctl --user stop dashboard.service → cgroup-kill。このスクリプトに kill ロジックは置かない。
# set -e は掛けない（pactl/wmctrl の非致命ステップで死なせない）。詳細設計は ../docs/STATUS.md。

set -u

# systemd 経由でしか動かさない（cgroup 外で起動すると stop が届かず孤児になる）
[ -n "${INVOCATION_ID:-}" ] || { echo "dashboard-start.sh: must be run via systemd (no INVOCATION_ID)" >&2; exit 1; }

DASH_DIR="$HOME/companion/dashboard"
WEB_URL="file://$DASH_DIR/web/index.html"
FF_PROFILE="$DASH_DIR/.state/ff-profile"
RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
MPV_SOCK="$RUNTIME/dashboard-mpv.sock"
SINK_VOL_PCT=20     # PulseAudio sink（マスター）。BGM 量フィットで 50→20%（2026-05-14 実機調整）。
MPV_VOL_PCT=100     # mpv ストリーム（stream-restore に上書きされないよう明示。最終実音量 = sink × stream = 20%）
PREV_VOL_FILE="$DASH_DIR/.state/prev-sink-volume"
PREV_MUTE_FILE="$DASH_DIR/.state/prev-sink-mute"

export DISPLAY="${DISPLAY:-:0}"

# ── 1. 音量を固定値にセット（前夜の状態に依存させない）。冪等・同期。読み戻し比較や再 set はしない。
#   停止時に dashboard-restore-volume.sh (ExecStopPost) で元値へ戻すため、現値を .state/ に保存。
#   保存失敗は警告のみで進む（復元側がファイル不在で no-op に流れる＝20% のまま残るが、無音破綻はしない）。
mkdir -p "$DASH_DIR/.state"
# pactl の出力は日本語ロケールで "Mute: いいえ" 等になるため LC_ALL=C で英語固定（volume も念のため）。
LC_ALL=C pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null \
  | awk '/^Volume:/ {for(i=1;i<=NF;i++) if($i ~ /%/){gsub(",","",$i); print $i; exit}}' \
  > "$PREV_VOL_FILE"
[ -s "$PREV_VOL_FILE" ] || { rm -f "$PREV_VOL_FILE"; echo "dashboard-start.sh: failed to capture prev sink volume" >&2; }
LC_ALL=C pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null | awk '{print $2}' > "$PREV_MUTE_FILE"
[ -s "$PREV_MUTE_FILE" ] || { rm -f "$PREV_MUTE_FILE"; echo "dashboard-start.sh: failed to capture prev sink mute" >&2; }

pactl set-sink-volume @DEFAULT_SINK@ "${SINK_VOL_PCT}%" || echo "dashboard-start.sh: pactl set-sink-volume failed" >&2
pactl set-sink-mute   @DEFAULT_SINK@ 0                  || echo "dashboard-start.sh: pactl set-sink-mute failed" >&2

# ── 2. 時間帯フォルダ判定（5:30 起動なら morning。境界時刻の特別扱いはしない、起動時に1回確定）
H=$(date +%H); H=$((10#$H))
if   [ "$H" -ge 5 ]  && [ "$H" -lt 11 ]; then SLOT=morning
elif [ "$H" -ge 11 ] && [ "$H" -lt 16 ]; then SLOT=afternoon
elif [ "$H" -ge 16 ] && [ "$H" -lt 21 ]; then SLOT=evening
else                                          SLOT=night
fi
MUSIC_DIR="$HOME/music/$SLOT"
echo "dashboard-start.sh: slot=$SLOT music_dir=$MUSIC_DIR"

# ── 3. 音楽: フォルダに音楽ファイルが1つでもあれば mpv 起動（無ければ skip。別フォルダへの fallback はしない）
HAS_MUSIC=$(find "$MUSIC_DIR" -maxdepth 1 -type f \
  \( -iname '*.mp3' -o -iname '*.flac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.wav' \) \
  -print -quit 2>/dev/null)
if [ -n "$HAS_MUSIC" ]; then
  rm -f "$MPV_SOCK"   # stale socket を掃除（clean state = 原因側。retry ではない）
  mpv --no-video --no-terminal --shuffle --loop-playlist=inf \
      --volume="$MPV_VOL_PCT" \
      --input-ipc-server="$MPV_SOCK" \
      "$MUSIC_DIR" &
  echo "dashboard-start.sh: mpv started (pid $!)"
else
  echo "dashboard-start.sh: no music files in $MUSIC_DIR — skipping mpv" >&2
fi

# ── 4. now-playing helper（mpv IPC → http://127.0.0.1:PORT/np。mpv 不在でも {"playing":false} を返すだけ）
python3 "$DASH_DIR/server/nowplaying-helper.py" &
echo "dashboard-start.sh: nowplaying-helper started (pid $!)"

# ── 5. firefox（dashboard 専用 profile。--kiosk --kiosk-monitor=1 で firefox 自身が HDMI-1 占有）
mkdir -p "$FF_PROFILE"
# 前回の残骸を掃除（clean state）。xulstore.json は旧 wmctrl 時代の screenX/sizemode:normal を
# 保持しうるため毎朝捨てる（5/22 STATUS L257 参照、2026-05-25 引き直しで保険として追加）。
rm -f "$FF_PROFILE/.parentlock" "$FF_PROFILE/lock" "$FF_PROFILE/xulstore.json" 2>/dev/null
cat > "$FF_PROFILE/user.js" <<'FFEOF'
// dashboard 専用 firefox profile 設定。起動毎に再生成（冪等）。
// first-run / what's-new / session 復元 / default-browser / telemetry の各種プロンプトを全部抑止。
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("browser.startup.page", 0);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.messaging-system.whatsNewPanel.enabled", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.shell.skipDefaultBrowserCheckOnFirstRun", true);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("browser.warnOnQuitShortcut", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("trailhead.firstrun.didSeeAboutWelcome", true);
user_pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
user_pref("browser.aboutConfig.showWarning", false);
user_pref("app.update.auto", false);
user_pref("browser.discovery.enabled", false);
user_pref("extensions.getAddons.showPane", false);
user_pref("full-screen-api.warning.timeout", 0);
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");
user_pref("browser.fullscreen.autohide", true);
user_pref("dom.disable_open_during_load", false);
FFEOF

firefox --new-instance --no-remote --profile "$FF_PROFILE" \
        --kiosk --kiosk-monitor=1 "$WEB_URL" &
echo "dashboard-start.sh: firefox launched (kiosk on monitor 1 = HDMI-1)"

# ── 6. ウィンドウ配置は firefox の --kiosk-monitor=1 が確定。wmctrl による窓同定＋配置は不要。
#   旧版: 起動後に「title=COMPANION-DASH の窓が wmctrl -l に出る」のを上限付き polling し、
#         wmctrl -e で HDMI-1 (0,0,1920,1080) へ移動 + add,fullscreen していた。
#   2026-05-25 引き直し: 「title 反映遅延」race で 10s 上限を超えるケースが本番発火（5/25 朝、
#         title-match 引き直し後の初回失敗。ログ「firefox window not found within timeout」+
#         窓が LVDS-1 (座標 1974,153) へデフォルト着地→TV 黒）。これを polling 数値で延ばすのは
#         対症療法 2 周目（ガード規則: ../docs/STATUS.md 「対症療法 2 周目ルールの先回り」）。
#   軸の置換: 旧設計 STATUS L191 では --kiosk-monitor を「firefox にない幻のフラグ」として却下
#         していたが、これは 5/22 時点 firefox 150 の話。firefox 151 で --kiosk-monitor <num> が
#         実装され、`firefox --help` で実存確認 (2026-05-25)。番号体系は実機検証で N=0=LVDS-1 /
#         N=1=HDMI-1 確定 (xrandr 順ではなく primary 以外が 1 と推定)。primary 変更・モニタ
#         追加時は再検証要。
#   旧 --kiosk 不採用理由「WM が wmctrl move を無視」「窓が primary=LVDS-1 に出る」は wmctrl 移動
#         を前提とした話。--kiosk-monitor=1 は firefox 自身がモニタを選ぶため wmctrl 自体が不要に
#         なり、これら過去の懸念は構造的に消えた。
#   ※ 「窓が HDMI-1 に出ない」観測時はここに polling を足し戻さず、--kiosk-monitor 番号体系の再
#      検証＋STATUS への記録から始めること。

# ── 7. service を active に保つ。寿命は systemd（dashboard-stop.timer / cgroup-kill）が握る。
exec sleep infinity
