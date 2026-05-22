#!/usr/bin/env bash
# dashboard-start.sh — dashboard.service の ExecStart。systemd 経由でのみ起動する想定。
#
# シーケンス: 音量固定 → 時間帯フォルダ判定 → mpv(空ならskip) → now-playing helper → firefox(file://) → wmctrl で HDMI-1 全画面 → exec sleep infinity
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

# ── 5. firefox（dashboard 専用 profile。--kiosk は使わない＝この後 wmctrl で HDMI-1 に配置するため）
mkdir -p "$FF_PROFILE"
rm -f "$FF_PROFILE/.parentlock" "$FF_PROFILE/lock" 2>/dev/null   # 前回の残骸を掃除（clean state）
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

firefox --new-instance --no-remote --profile "$FF_PROFILE" "$WEB_URL" &
FF_PID=$!
echo "dashboard-start.sh: firefox launched (launcher pid $FF_PID)"

# ── 6. firefox ウィンドウを HDMI-1（1920x1080+0+0）へ移動して全画面化
#   observable state（窓の存在）への上限付き readiness wait → 出なければ benign give-up（service は殺さない）。
#   窓同定は index.html の <title>=COMPANION-DASH のタイトル一致。
#     旧: `wmctrl -l -p` の PID 一致（$3 == FF_PID）。だが firefox --new-instance は launcher PID($!) と
#     実窓の _NET_WM_PID が食い違い、PID 一致が原理的に当たらず毎朝 timeout していた（2026-05-22 実機確定）。
#     同定の軸を「OS 任せの PID」→「index.html で我々が所有するタイトル」へ引き直した（成否は1回で確定、
#     fallback 連鎖なし＝対症療法 2 周目ではない。根拠は ../docs/STATUS.md 2026-05-22 エントリ）。
#     WM_CLASS-grep 不採用は据え置き（常用 firefox 並走時に他窓を拾う、2026-05-15 事故 root cause）。
#     COMPANION-DASH は dashboard 専用 profile + --new-instance ゆえ常用 firefox の窓と衝突しない一意キー。
#   xulstore / --kiosk による位置指定は不採用: この機の WM(Marco) が新規窓を primary=LVDS-1 へ再配置し
#     screenX を無視するため HDMI-1 を狙えない（2026-05-22 実機で全パターン LVDS-1 着地を確認）。
#     HDMI-1 を座標で確実に狙えるのは wmctrl -e のみ（B4 2026-05-16 + 2026-05-22 再実証）。
#   ※ ここを「窓が出ない → 回数を増やす / sleep を足す」方向に育てないこと。flaky が続くなら patch #2 を当てず設計引き直し（../docs/STATUS.md 参照）。
WIN_TITLE_MATCH="COMPANION-DASH"
WIN_ID=""
for _ in $(seq 1 20); do
  WIN_ID=$(wmctrl -l 2>/dev/null | awk -v t="$WIN_TITLE_MATCH" 'index($0, t) {print $1; exit}')
  [ -n "$WIN_ID" ] && break
  sleep 0.5
done
if [ -n "$WIN_ID" ]; then
  wmctrl -i -r "$WIN_ID" -b remove,maximized_vert,maximized_horz 2>/dev/null
  wmctrl -i -r "$WIN_ID" -e 0,0,0,1920,1080                       2>/dev/null
  wmctrl -i -r "$WIN_ID" -b add,fullscreen                        2>/dev/null
  echo "dashboard-start.sh: placed firefox window $WIN_ID on HDMI-1 (fullscreen)"
else
  echo "dashboard-start.sh: firefox window not found within timeout — leaving as-is" >&2
fi

# ── 7. service を active に保つ。寿命は systemd（dashboard-stop.timer / cgroup-kill）が握る。
exec sleep infinity
