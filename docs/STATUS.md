# dashboard — STATUS

毎日 5:30（systemd user timer）に TV へダッシュボードを全画面表示し、時間帯フォルダの曲を mpv でシャッフル再生・音量を固定値にセット。毎日 9:00 に firefox と mpv を終了（laptop はスリープ/シャットダウンしない＝Navidrome 等を継続）。

設計レビュー: team `dashboard-design`（architect / ux / devil's advocate、2026-05-13）。本ファイルが確定形（teammate plan は archive、ここに転記済み）。

---

## 確定アーキテクチャ

### プロセス / systemd
- **`dashboard.service` (Type=simple, `Restart=no`)** が `bin/dashboard-start.sh` を ExecStart。スクリプトが mpv・now-playing helper・firefox を起動し、最後に `exec sleep infinity`（service の寿命は子プロセスではなく systemd が握る）。`KillMode=control-group`（default）なので停止時に cgroup ごと SIGTERM。
- 起動: `dashboard-start.timer` = `OnCalendar=*-*-* 05:30:00` + `AccuracySec=1s`。**`Persistent=true` は付けない**（目覚まし意味論：寝過ごした朝を昼に遅延起動しない）。`RandomizedDelaySec` も付けない（5:30 ちょうどに点けたい）。
- 終了: `dashboard-stop.timer` = `OnCalendar=*-*-* 09:00:00` → `dashboard-stop.service`（oneshot）→ `systemctl --user stop dashboard.service` → cgroup-kill で firefox/mpv/helper 全滅。`TimeoutStopSec=15s`。
  - **不採用: `RuntimeMaxSec=12600` で stop timer/service を省く案**。理由: 仕様が「終了=毎日 9:00」（壁時計）であって「起動から N 時間後」ではない。RuntimeMaxSec だと手動 start した時の終了時刻がズレる。部品 2 ファイル増えるが意味論を正とする。既存 maintenance フェーズの「oneshot service + timer」型とも揃う。
  - **不採用: mpv/web/firefox を個別 service に分割**。v1 では over-engineering。
- GUI 依存: service に `Environment=DISPLAY=:0`（`systemctl --user show-environment` には既に `DISPLAY` `XAUTHORITY` `DBUS_SESSION_BUS_ADDRESS` `XDG_RUNTIME_DIR` が入っているが明示する）。**`graphical-session.target` は user systemd に存在しないので `After=/PartOf=` には使わない**。代わりに `ExecStartPre` で X 到達を上限付き待ち（5:25 reboot → 5:30 発火のような edge で firefox を死んだ display に投げない。bounded・clean fail。retry-loop ではない＝observable state への readiness gate）。
- start script 冒頭に `[ -n "$INVOCATION_ID" ] || exit 1`（systemd 経由以外で動かさない＝stop が cgroup で届かない孤児を防ぐ）。`set -e` は全体には掛けない（pactl/wmctrl の非致命ステップで死ぬ）。

### 起動シーケンス（`bin/dashboard-start.sh`）
1. `$INVOCATION_ID` ガード。
2. **音量固定**: `pactl set-sink-volume @DEFAULT_SINK@ 20%` + `pactl set-sink-mute @DEFAULT_SINK@ 0`。冪等・同期。**読み戻して比較・再 set はしない**（対症療法 2 周目の罠）。音声は PulseAudio 15.99.1、sink は `alsa_output.pci-0000_00_1b.0.hdmi-stereo` の 1 個のみで default。値は BGM 量フィットで 50→20% に変更（2026-05-14 実機調整）。
3. **時間帯フォルダ判定**: `date +%H` → `5..10`=morning / `11..15`=afternoon / `16..20`=evening / else=night。5:30 起動なので morning。これは「正しい関数を最初から書く」だけで先回りの雛形ではない（先回り＝afternoon.timer や `dashboard@.service` テンプレを今作ること。それはしない）。
4. **音楽**: `~/music/<slot>/` に音楽ファイルが 1 つでもあるか `find -print -quit` でチェック。空なら mpv をスキップ（journal に warn）。非空なら stale socket を `rm -f` してから `mpv --no-video --shuffle --loop-playlist=inf --volume=100 --input-ipc-server="$XDG_RUNTIME_DIR/dashboard-mpv.sock" "$HOME/music/<slot>/" &`。フォルダ別音量は将来 config 値（retry ではない）。**別フォルダへの fallback はしない**。
5. **now-playing helper**: `python3 server/nowplaying-helper.py &`（127.0.0.1:<固定ポート> で `GET /np` のみ。mpv IPC socket に `{"command":["get_property","media-title"]}` を投げ、`media-title`+`metadata`(artist) を JSON で返す。`Access-Control-Allow-Origin: *`。mpv 不在/死亡＝ENOENT/ECONNREFUSED → `{"playing":false}` を HTTP 200 で返す＝正常状態。1 回の connect-or-empty で確定、リトライしない）。
6. **firefox**: `.state/ff-profile/user.js` を heredoc で（再）生成（session 復元 OFF / first-run・what's-new・default-browser・telemetry プロンプト全 OFF / `full-screen-api.warning.timeout=0` / `browser.fullscreen.autohide=true`）。`firefox --new-instance --no-remote --profile "$HOME/companion/dashboard/.state/ff-profile" "file://$HOME/companion/dashboard/web/index.html" &`。
   - **`--kiosk` は使わない**（kiosk の EWMH fullscreen 状態は WM が wmctrl の move を無視しがち＋窓が primary=LVDS-1 に出て事故る）。
   - **`-P <name>` ではなく `--profile <絶対パス>`**（self-contained、profile-manager レジストリに依存しない、未登録時に Profile Manager GUI が出ない）。
7. **配置**: firefox を `firefox --new-instance --no-remote --profile <path> URL &; FF_PID=$!` で起動し、`wmctrl -l -p` で `_NET_WM_PID == $FF_PID` の窓 ID を上限付き待ち (~10s, 0.5s 刻み)。出たら `wmctrl -i -r <id> -b remove,maximized_vert,maximized_horz` → `wmctrl -i -r <id> -e 0,0,0,1920,1080` → `wmctrl -i -r <id> -b add,fullscreen`。出なければ warn して諦め (service は殺さない)。
   - **WM_CLASS マッチは使わない**（常用 firefox 起動中だと「WM_CLASS に firefox を含む最初の窓」= 常用 firefox 窓を拾ってしまい、2026-05-15 05:30 初発火事故の root cause になった。`~/companion/CLAUDE.md` 対症療法 2 周目ルール準拠で WM_CLASS-grep → PID-match の 1 度の引き直しで確定）。
   - **背景**: 常用 firefox を前夜から開いた状態で寝る生活（前夜タブ/YouTube 再生位置を残す）を破壊しないため、社会的解決は採らず技術修正で根治。
   - **z-top 保証**（B23 検証で常用窓が前面に残る場合のみ）: `add,fullscreen` の直後に `wmctrl -i -a <id>` を 1 行追加（`_NET_ACTIVE_WINDOW` 経由で raise+focus、`_NET_WM_STATE` 不変、副作用ゼロ、9:00 cgroup-kill で残り火なし）。ux 元案 `-b add,above` は不採用（`_NET_WM_STATE_ABOVE` 固定 race、9:00 stop 前にユーザー触れたら state 永続化リスク）。
   - 配置の上限待ちを「窓が出ない → 回数増やす/sleep 足す」方向に育てない。「PID 一致でも見つからない」観測時の引き直し先は § 対症療法 2 周目ルールの先回り 9 項目目を参照（i-TITLE 等の中間段を経ず G 系列に 1 度で引き直し）。
8. `exec sleep infinity`。9:00 の stop で cgroup ごと落ちる。

### ダッシュボード（`web/`、サーバレス）
- **firefox は `file://.../web/index.html` を直接開く**。最大限のレジリエンス＝ページは常にロードできる（サーバ・ネット全滅でも時計は動く）。
- **時計**: 100% クライアント（`new Date()`、ネット依存ゼロ）。専用 DOM、fetch 系コードから一切触らない。app.js 冒頭（await/fetch より前）で `setInterval` 登録。app.js の他処理が throw しても時計は刻み続ける。**時計だけは絶対に欠けてはいけない**。毎秒更新。
- **天気**: クライアント JS が **Open-Meteo に直接 fetch**（無料・APIキー不要・`Access-Control-Allow-Origin: *` のはず → `file://` origin からも通る前提。要検証 B5）。クエリ: `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&hourly=temperature_2m,weather_code,precipitation_probability&current=temperature_2m,weather_code&timezone=Asia/Tokyo&forecast_days=1`。WMO `weather_code` → 日本語ラベル＋アイコン（インライン SVG）。1 時間ごとに再 fetch。
  - **レジリエンス（state はクライアント側）**: 直近成功レスポンスを JS 変数（+ 任意で `localStorage`）に保持。fetch 失敗時はそれを表示し続け（小さく「更新 HH:MM」）、通常スケジュールでのみ再試行（即時 retry・backoff・retry ladder は無し）。保持値も無い/古すぎる → 「天気 — 取得できません」＋中立アイコン。古い予報を「現在」として出さない。**どの場合もパネルの骨格は必ず描く**（レイアウトをガタつかせない）。
  - 不採用: 天気を long-lived サーバでプロキシ＆`.state/weather.json` キャッシュする案（architect 初版）。理由: ブラウザ直 fetch で足りる／サーバ常駐は supervise 対象＋SPOF を個人用 single-viewer に抱える理由が薄い（devil A2/A3）。
  - **B5 が NG だった場合の contingency**（build 時判断、runtime fallback ではない）: now-playing helper に `GET /weather` を足して Open-Meteo をプロキシ、app.js は `http://127.0.0.1:<port>/weather` を叩く（app.js 1 行 + helper ~10 行）。
- **ゴミの日**: `web/dashboard-config.js`（`<script src>` で読み込む。`file://` から `fetch()` は弾かれるが `<script src>` は通る）に `window.DASHBOARD_CONFIG = { weather:{lat,lon,tz}, garbage:{rules:[...]} }`。クライアント JS が次回収集日＋種別を計算（純ローカル計算、retry 罠なし、5:30–9:00 で日跨ぎなし）。日付ロールオーバー検知で再計算。config 欠落/不正 → 「ゴミ設定なし」placeholder。**自治体カレンダー取込はしない**＝年末年始の振替等は表示が外れる（本ファイル明記済み）。
- **now-playing**: クライアント JS が `http://127.0.0.1:<port>/np` を ~2-3s ポーリング（helper が ACAO:* を返すので `file://` から OK）。曲なし/mpv 不在/fetch 失敗 → ごく薄く「♪ —」or 非表示。**絶対にレイアウトを揺らさない・エラーを上げない**。最も使い捨て可能な要素。fetch 失敗時は前状態保持 or 静かにクリア。
- **〔将来〕アドバイス枠**: 今回は実装しない。**markup/ファイルの予約もしない**（PROJECT.md が禁じる「先回りの雛形増やし」）。やってよいのは「将来 1 要素増えても再設計せず吸収できる柔らかいレイアウト」方針のみ。可視帯の上 ~100px を「呼吸スペース（ただのマージン）」として空け、時計を帯の上寄りに置く（垂直中央には置かない＝後でアドバイス band を足したとき時計が下にずれて fold に近づくのを防ぐ）。HTML に `<!-- 将来: アドバイス band はここ -->` のコメント 1 行のみ。

### 画面レイアウト（ux 案 A）
- ダークテーマ既定（冬の 5:30 は真っ暗、5 月でも薄暗い。暗い部屋に白画面は朝に暴力的）。漆黒 `#000` は避ける（TV でバンディング/ギラつき）→ deep navy/ink (`#0e1419`〜`#141a24` 系) ベース＋暖かいオフホワイト文字 (`#e8e3d8` 系)＋抑制した 1 アクセント色（sunrise amber か soft teal を 1 つだけ。天気アイコンとゴミの「あす/きょう」ハイライトにだけ）。auto light/dark 切替は不要（朝のみ運用）。
- 上端 ~50px はオーバースキャン保険マージン（コンテンツ開始 y≈80px）。fold は y≈580-600 とみなし now-playing baseline は y≈500 までに収める。**`height:540px` を CSS に焼かない**（実 TV の可視域は要実測 B7）。重要要素を上に積む top-anchored 1 カラムで組み、可視域は content priority のガイドラインとして扱う。
- 案 A: 左 1/3=天気（アイコン / 現在気温 / 天候ラベル / 今日 ↑↓ / 降水%）、中 1/3=時計（最大、`HH:MM` のみ ~13vw tabular figures・**秒は出さない**・コロンは静的、日付 ~3vw「5月13日 (火)」）、右 1/3=ゴミ（アイコン / 種別 / 「あす(水)」/ 「次: プラ 5/16」）。下に now-playing 1 行（~1.5vw、♪ 曲名 — アーティスト、控えめ）。それ以下〜y=1080 はベース色の続き（縦グラデで僅かに下を暗く）。テクスチャ・画像・動画背景なし。
- 案 B（予備）: 時計左寄せ大 + 右に天気/ゴミ縦積み。情報量が将来増えたら右列に積みやすい。今は案 A 推奨。
- **下半分を恒久的に「飾り」にする判断＝確定**。要素 4 つ + 将来 1 つは 1920×~580px に余裕で収まる。「溢れたら degrade」柔軟設計は存在しない問題への対策＝YAGNI 違反。「手前モニタを下げれば下も見える」は朝の運用（モニタ上げたまま一瞥）では発生しない前提。下に「下げれば見える二次情報」を置くのもナシ（誰も見ない二層 UI を検証できない／「見えないと存在しない」原則に反する）。ただし下半分は「壊れた余り」ではなく「デザインの連続」（1920×1080 全体で 1 つのデザイン、コンテンツは上 ~580px に住む、下はベース色がそのまま続く）。
- 時間帯で色を変える: punt（朝のみ運用なので便益ゼロ、色替えコード経路を増やさない。将来 afternoon/evening timer が来たら入れる）。
- フロント方向性: 「夜明け前の静けさ」。余白贅沢（コンテンツは可視帯の 6 割程度）、大きく幾何学的な humanist sans（system stack: Inter / Noto Sans JP / system-ui）、時計だけ tabular-figures で tight。天気/ゴミは大きめ角丸カード or カード無しの浮遊テキスト群（後者の方が静か — 実装で判断）。データ更新は 300-500ms のソフトフェード、何も pop しない。アニメーション禁欲的（GPU 無し Ivy Bridge + x11vnc が dirty frame を毎回再エンコードするので全画面アニメ/動くグラデは CPU・VNC 帯域を食う。毎秒の時計更新＝小 dirty rect は OK）。

### x11vnc 非干渉
x11vnc はシステムサービス（`/etc/systemd/system/x11vnc.service`）で `-display :0` を framebuffer キャプチャ + 入力注入してるだけ。ウィンドウ管理には関与しない。今回足すのは user unit で :0 にウィンドウを出すだけ → 衝突なし。**x11vnc の unit には一切触らない**。

### 電源
スリープ/スクリーンセーバー/蓋閉じ無効化済み前提に乗る。stop で `suspend`/`shutdown` は呼ばない。9:00 停止後の TV はデスクトップ壁紙が見える（TV blank は out of scope）。

---

## 朝の運用ルール

dashboard.service の朝の運用は以下の制約に従う。窓配置失敗時のリカバリ動線は **設計に含めない**。

- **C0**: 朝の本人操作要求は **TV リモコン ON のみ**。マウス/キーボードでの復旧は要求しない（寝起き不機嫌閾値の対策）。
- **学習信号**: BGM 鳴 + TV 黒/前夜状態 = 「絵だけ失敗、夜に診断」と即判断できる状態を本人が学習している前提で運用。
- **夜手動診断**: 失敗観測時は当夜 `journalctl --user -u dashboard.service --since today` で確認 → 本 STATUS の「既知の問題」セクションに追記。
- **3 朝連続失敗で再設計判断**: 単発失敗を patch しない（`~/companion/CLAUDE.md` 2 周目ルール準拠、修正効果観察に最低 3 朝必要）。3 連続失敗観測時は § 対症療法 2 周目ルールの先回り 9 項目目に従い G 系列（`--kiosk --kiosk-monitor=<N>`）へ移行。
- **朝の compensating control は採らない**: Discord bot 経由通知 / now-playing helper にステータス追加 等の朝通知は **不採用**（寝てる本人を起こす方向、目覚まし系の信頼喪失、Phase 4 無口な相棒像と逆向き）。

---

## 実機検証チェックリスト（build/test フェーズで実施。一部の設計選択はこれ待ちの暫定）

> ⚠ 検証で音が出る・TV が光るものは 5:30〜9:00 以外にやると寝てる人を起こす。音量 0 で or ユーザーが起きてる時に。

- **B1 音量 20% 固定が pactl 1 発で成立するか** ✅ 2026-05-14 pass: PulseAudio の `module-stream-restore` が mpv のストリーム音量を前セッションから復元しうる（最終実音量 = sink音量 × stream音量）。`mpv --volume=100` がそれを上書きするか確認（`pactl list sink-inputs | grep -i volume`, `pactl get-sink-volume @DEFAULT_SINK@`）。検証結果: mpv が stream を 100% で立ち上げ、stream-restore による上書きは観測せず → sink-input volume の追加 pin は不要。
- **B2 mpv 0.34.1 のディレクトリ→playlist 挙動** ✅ 2026-05-14 pass: ダミー mp3 1-2 個で `mpv --no-video --shuffle --loop-playlist=inf --input-ipc-server=/run/user/1000/dashboard-mpv.sock ~/music/morning/` → 再帰するか / 拡張子フィルタ / 空ディレクトリ時 exit-or-idle / stale socket で起動できるか。空時即 exit なら `find` で playlist を組む実装に倒す。検証結果: `~/music/morning/` (mp3 7 ファイル) を渡して playlist 構築・shuffle・loop 動作 OK、stale socket は事前 `rm -f` で問題なし。
- **B3 (改訂) 常用 firefox 並走時の `--new-instance --no-remote --profile` 同定** ✅ 2026-05-16 pass: 常用 firefox (PID 251413, window 0x02000003, YouTube タブ desktop 0) を起動した状態で `systemctl --user start dashboard.service` → journal が「firefox launched (launcher pid 252288)」「placed firefox window 0x02400003 on HDMI-1 (fullscreen)」を記録、`wmctrl -l -p` で確認: 新窓 0x02400003 の `$3` 列が 252288 一致、常用窓 0x02000003 は触られず desktop 0 に残存。事故再現条件下で fix 効果直接確認。
- **B4 (改訂) wmctrl で firefox 窓を HDMI-1 に全画面化** ✅ 2026-05-16 pass: 上の B3 検証で新窓 0x02400003 が HDMI-1 (1920x1080+0+0) に全画面化、LVDS-1 にはみ出さず TV 目視 OK（時計・天気・ゴミ表示）。Marco の per-monitor fullscreen 期待通り動作。
- **B5 `file://` origin から Open-Meteo に fetch できるか**: `file:///tmp/t.html` に fetch を書いて firefox で開き CORS で通るか。通れば「天気サーバレス」確定。通らなければ上記 contingency（helper に `/weather` プロキシ）。
- **B6 HDMI-1 のモード（インターレース）**: 現状 `1920x1080i`（progressive 最大は 1280x720）。`xrandr` の `*` が 1080i。細い横線・小文字でコーミング/ちらつき。`xrandr --output HDMI-1 --mode 1280x720` に切り替えて TV で文字の見え方を比較。デフォルト方針: 1080i のまま太字・hairline なし・大文字で運用、アプリは解像度を触らない。1080i の文字が許容不能 & 720p が大幅改善なら → ユーザーが恒久的に 720p に設定（アプリ scope 外）or 再検討。**解像度切替はアプリに焼かない**（切替えると 9:00 復元機構が要る = devil A1 系の複雑化、MATE パネル/アイコン再配置の副作用）。
- **B7 TV の物理可視域の実測**: firefox で「縦に 0/270/540/810/1080px の目盛りページ」を全画面表示し、実配置で何 px〜何 px 見えるか現物で測る。「上半分=540px」は思い込みかも（家具で下が隠れてるだけなら ~700px、額縁で上下削れて ~450px かも）。実測値が出るまで CSS に高さを焼かない。clock+weather+garbage(+nowplaying) が実測可視域で「部屋の向こうから読める」字サイズに収まるかモックで現物確認（収まらないなら nowplaying 落とす / garbage 1 行に圧縮）。
- **B8 GUI-from-systemd-user-unit**（最重要）: `systemctl --user start dashboard.service` を平日昼に手動実行 → firefox が :0 に開くか。`DISPLAY=:0`（+`XAUTHORITY`?）で足りるか。`journalctl --user -u dashboard.service` に X 接続エラーなし。
- **B9 firefox `$!` PID 永続性**: `firefox --new-instance --no-remote --profile <path> URL & FF=$!; sleep 8; ps -p $FF` — 落ち着いた後も生きてるか（実装は `exec sleep infinity` にするので致命ではないが挙動把握）。
- **B10 `systemctl --user stop` の teardown** ✅ 2026-05-16 pass: 上の B3/B4 検証後に `systemctl --user stop dashboard.service` → 3 秒で inactive (dead), code=killed signal=TERM。新 dashboard 窓 0x02400003 (PID 252288) と nowplaying-helper (PID 252284) は消滅、`pgrep -af firefox` で残るのは常用 firefox PID 251413 系のみ。double-fork による孤児なし。
- **B11 PipeWire→PulseAudio from user service**: `dashboard.service` の中から `pactl set-sink-volume @DEFAULT_SINK@ 20%` が効くか（env に `XDG_RUNTIME_DIR`）、sink SUSPENDED でも。mpv 再生で実際に TV から音が出るか。
- **B12 timer**: `systemctl --user list-timers` に `dashboard-start.timer` が次 05:30、`AccuracySec=1s` で数秒以内発火、`Persistent=true` が無いこと。`dashboard-stop.timer` が次 09:00。
- **B13 `--profile <path>` 初回 + user.js**: 厳選 `user.js` で default-browser / session 復元 / telemetry プロンプト / what's-new タブが出ないか。
- **B14 `xset` の有無**: `ExecStartPre` の X-readiness gate で `xset q` を使う想定。無ければ `xdpyinfo` or `[ -e /tmp/.X11-unix/X0 ]` に倒す。
- **B15 `loginctl show-user miho | grep Linger`**: linger 無効なら user timer は session 依存（auto-login で常時 session ありなので実害薄い）。`loginctl enable-linger miho` は安い保険（要 sudo はユーザー側端末）。やるか判断。
- **B16 garbage の nth-weekday 計算テスト**（実装時必須）: 第 n 曜日の月境界 / 第 5 週が無い月 / 「今日が収集日」のとき next 判定（収集時刻 前/後）/ 月跨ぎ。
- **B17 (新規) `$!` = `_NET_WM_PID` 同一性 + 持続性** ✅ 2026-05-16 pass (短期): launcher PID 252288 = 新窓 `_NET_WM_PID` 252288 (wmctrl `$3` 列) で一致、`wmctrl -l -p` が新窓を 1 行で返すまで journal 上 8 秒。長期持続性 (60s/300s) は本検証セッションでは未測定だが、明朝 05:30〜09:00 (5h30m) 連続稼働で確認できる。firefox update 時の再走ルールは継続。
- **B18 (新規) `_NET_WM_PID` カバレッジ + first-run wizard**: 全 firefox 窓（本窓 / Profile Manager / splash / first-run wizard / what's-new tab）で `_NET_WM_PID` がセットされるか、`xprop` で目視。dashboard 専用 profile の初回起動で wizard / what's-new tab が新窓として現れないか確認。
- **B19 (新規) cold boot 起動所要時間** ✅ 2026-05-16 pass (warm): warm session (laptop は数日連続稼働、auto-login session 生存中) で journal の「firefox launched」(05:00) → 「placed firefox window 0x02400003 on HDMI-1」(05:08) で **8 秒**。10s 上限 (`seq 1 20 × sleep 0.5`) に収まる。cold boot (laptop 起動直後 5 分) は本検証セッションでは未測定、明朝 05:30 が事実上の cold boot ケース。
- **B20 (新規) firefox crash → restart 時の挙動**: 新インスタンスが crash recovery で auto-restart した場合、`$!` PID は古い PID で残り、新 PID の窓は polling timeout → benign give-up。9:00 stop で cgroup-kill されるまで「窓不在」状態が固定化しないか確認。
- **B21 (新規) `_NET_WM_PID` セット遅延 race**: window create と `_NET_WM_PID` セットの間に race、初出 iter 観測。`for i in $(seq 1 30); do wmctrl -l -p | awk -v p=$FF '$3==p {print $1, NR; exit}'; sleep 0.2; done` で何 iter 目から PID 列に出るか観察（B19 と統合可）。
- **B22 (新規) 3 重指定独立 process 保証** ✅ 2026-05-16 pass: B3 検証時に `pgrep -af firefox` で常用 firefox PID 251413 と新 firefox PID 252288 が別、子プロセスツリーも独立 (`parentPid 251413` vs `parentPid 252288`)。profile dir lock cleanup は現行スクリプト L58 で対策済。
- **B23 (新規) Marco fullscreen 化窓の z-order 保証** 2026-05-16 観察 (限定条件): 常用 firefox 窓は LVDS-1 (desktop 0) に YouTube タブで在席、新 dashboard 窓を HDMI-1 全画面化したとき TV 目視で dashboard が前面表示 OK (z-top 補強は不要だった)。ただし「常用 firefox が HDMI-1 に全画面残置時」(2026-05-15 事故再現後の片付け前条件) は本検証では再現できず未検証。同一モニタ並走で z-top 問題が観測されたら `wmctrl -i -a "$WIN_ID"` を fullscreen 直後に 1 行追加 (採用方針確定済)。

---

## 構成

```
dashboard/
├── bin/dashboard-start.sh         # $INVOCATION_ID ガード → 音量20%+unmute → slot判定 → mpv(空ならskip) → helper → firefox(file://) → wmctrl で HDMI-1 全画面 → exec sleep infinity
├── server/nowplaying-helper.py    # ~30行。127.0.0.1:<port> GET /np のみ。mpv IPC → JSON, ACAO:*。mpv不在は {"playing":false} を 200 で。
├── web/
│   ├── index.html
│   ├── style.css
│   ├── app.js                     # 時計(冒頭・毎秒・隔離) / 天気(Open-Meteo直fetch・毎時・last-good保持) / ゴミ(config計算・日付ロールオーバーで再計算) / nowplaying(/np を 2-3s ポーリング)
│   └── dashboard-config.js        # window.DASHBOARD_CONFIG = {weather:{lat,lon,tz}, garbage:{rules}}。ユーザーが中村区の実収集日に書き換え。git管理。
├── systemd/
│   ├── dashboard.service          # Type=simple, Restart=no, Environment=DISPLAY=:0, ExecStartPre=X-readiness(bounded), ExecStart=bin/dashboard-start.sh, TimeoutStopSec=15s, WorkingDirectory=%h/companion/dashboard
│   ├── dashboard-start.timer       # OnCalendar=*-*-* 05:30:00, AccuracySec=1s, (Persistent/RandomizedDelaySec 無し)
│   ├── dashboard-stop.service      # Type=oneshot, ExecStart=systemctl --user stop dashboard.service
│   └── dashboard-stop.timer        # OnCalendar=*-*-* 09:00:00
├── .state/                        # ff-profile/ など。.gitignore。(mpv socket は $XDG_RUNTIME_DIR 側)
├── docs/STATUS.md
└── .gitignore
```
`~/.config/systemd/user/` から symlink → `systemctl --user daemon-reload && enable --now dashboard-start.timer dashboard-stop.timer`（maintenance と同手順）。journal: `journalctl --user -u dashboard.service`。

## 環境メモ（実機確認済み 2026-05-13）
- Dell Inspiron 3521 / Linux Mint 21.3 MATE / X11 / auto-login (miho) / session 24h 生存
- ディスプレイ: `HDMI-1` = TV、現行モード **`1920x1080i`（インターレース）**、progressive 最大 1280x720、+0+0 配置 / `LVDS-1` = 本体パネル 1366x768+1920+83 **primary 指定**。スクリーンセーバー/DPMS/蓋閉じスリープ全部無効化済み。
- 音声: **PulseAudio 15.99.1**（PipeWire ではない）。sink は `alsa_output.pci-0000_00_1b.0.hdmi-stereo` の 1 個・default。起動直後 SUSPENDED。
- ツール: mpv 0.34.1 / firefox 150（唯一のブラウザ、`--kiosk` あり）/ wmctrl あり（**xdotool 無し**）/ python3 / pactl
- systemd **user** unit: companion-bot / maintenance の通知 timer 群が稼働中。`graphical-session.target` は無い。`systemctl --user show-environment` に `DISPLAY=:0` `XAUTHORITY=~/.Xauthority` `DBUS_SESSION_BUS_ADDRESS` `XDG_RUNTIME_DIR=/run/user/1000` あり。
- x11vnc: システムサービス、`-display :0`、tailscale IP のみ listen、`-noipv6`。壊さない・触らない。
- now-playing helper の待受ポート `47823` は **2 箇所で手書き**: `server/nowplaying-helper.py` の `PORT` と `web/dashboard-config.js` の `nowPlaying.port`。変えるなら両方。
- `loginctl show-user miho` → `Linger=no`（B15）。auto-login で常時 session ありなので実害は薄いが、`loginctl enable-linger miho`（要 sudo・ユーザー端末）は安い保険。
- `xset` / `xdpyinfo` は両方インストール済み（B14 は moot）。ただし `dashboard.service` の X-readiness gate は外部バイナリ非依存の `[ -e /tmp/.X11-unix/X0 ]` を使っている。

## 対症療法 2 周目ルールの先回り（`~/companion/CLAUDE.md` 準拠）
- 音量: 「20% になってない気がする → sleep して再 set / 読み戻し比較で再 set」をしない。`set-sink-volume`+`set-sink-mute` は冪等・同期、1 回で終わり。
- 配置: wmctrl の上限付き readiness wait は OK（observable state へのゲート、benign give-up）。「窓が出ない → 回数増やす/sleep 足す」方向に育てない。flaky なら patch #2 ではなく設計引き直しを STATUS 記録してから。
- プロセス kill: `pkill firefox`/`pkill mpv`/`pkill -f …` は禁止（常用 firefox 巻き込み + `pkill -f` は Bash wrapper 自爆。MEMORY 既出）。cgroup-kill（`systemctl --user stop`）のみ。専用 `--profile <path>` で曖昧さゼロ。
- 天気 fetch: 「timeout/5xx → retry → backoff → cache TTL hack」をしない。「直近成功値（state）を保持、失敗時はそれを表示、通常スケジュールでのみ再試行」。
- slot 判定: 境界時刻の特別扱いをしない。start 時に 1 回確定、途中再評価しない。slot #2 が来たら時計監視ループを足すのではなく `dashboard@<slot>.service` テンプレ化に移行。
- now-playing: mpv IPC は 1 回の connect-or-empty で確定。「mpv 起動待ちで数回リトライ」をしない。
- respawn: `while true; do firefox …; done` 系禁止。`Restart=` 付けない。子が 1 個落ちても残りは degrade、9:00 に cgroup kill で掃除。
- **窓識別**: `wmctrl -l -p` の PID 一致のみで確定。WM_CLASS マッチへの fallback / 多重述語（WM_CLASS AND PID）/ 配置後の geometry read-back / stderr 文言マッチは足さない。PID 一致で 0 件 = benign give-up。firefox launch 失敗時は `$!` が前ジョブ PID（nowplaying-helper or mpv）を返し、helper/mpv は X11 窓を持たない → wmctrl で見つからず timeout → benign give-up に流れる。
- **案 A 不成立観測時の引き直し先 = G（placement 軸移行）**: 「PID 一致でも見つからない」観測時（3 朝連続失敗、§ 朝の運用ルール準拠）は polling 上限（10s → 20s）を増やす **2 周目を打たず**、identity 軸 → placement 軸へ 1 度で引き直し: G（`firefox --kiosk --kiosk-monitor=<N>` + wmctrl 撤去）。最小覆しデータは monitor index 決定論性 / HDMI-1 占有 / 9:00 panel 復帰 / fullscreen-warning 抑止 / `--new-instance --kiosk` 干渉 / xrandr disconnect 挙動。**同一軸の中間段（i-TITLE 等）は持たない** — 補欠複数を持つと patch #2/#3 を呼び込み「3 度目を打たずに一段引いて設計を見直す」上限を浪費（`~/companion/CLAUDE.md` 抵触）。G への移行は判断根拠を本欄に追記してから着手。

---

## TODO

- [x] skeleton（ディレクトリ / STATUS / .gitignore / `~/music/{morning,afternoon,evening,night}/`）
- [x] 設計レビュー（team `dashboard-design`: architect / ux / devil）→ 本ファイルに確定形を転記
- [x] モック（`web/index.html` + `style.css`、案A・ダークテーマ）
- [x] `web/dashboard-config.js`（ダミー）/ `web/app.js`（時計・天気 Open-Meteo 直 fetch・ゴミ計算・nowplaying ポーリング）
- [x] `server/nowplaying-helper.py`
- [x] `bin/dashboard-start.sh`
- [x] systemd 4 ユニット + `~/.config/systemd/user/` symlink + `daemon-reload`（**`enable --now` はまだ。検証後に**）
- [x] code-reviewer subagent レビュー（修正必須なし。軽微 2 点を反映: firefox 起動オプション表記統一 / `.gitignore` から未使用の `config/weather.env` 削除）
- [x] **〔ユーザー〕モックの見た目チェック** — 2026-05-13 実機 TV で確認、OK
- [x] 秒表示は無し（時計は `HH:MM` のみ、コロンは静的）に決定 → `.time .ss` / `<span class="ss">` / inline script の `ss` を削除済み
- [x] **〔ユーザー〕`docs/SETUP.md` の手順を実行**（音楽配置 → dashboard-config.js 記入 → 手動 start/stop テスト → timer enable → git push）— 2026-05-14 完了。dashboard-config.js の中村区実データ書き換えは TODO に残る
- [ ] **〔ユーザー〕`web/dashboard-config.js` を名古屋市中村区の実収集日・実緯度経度に書き換え**（今はダミー）
- [x] git → GitHub private repo `mooneclipse/companion-dashboard`（private）→ push 済み（2026-05-13）。※companion repo 群の monorepo 化は someday 候補（`workspace/PROJECT.md` の「将来の保留事項」に記載）
- [x] (B12 残) 2026-05-15 05:30 発火検証 → **失敗**、root cause = WM_CLASS-grep が前夜 22:14 起動の常用 firefox 窓（PID 158734、YouTube タブ）を拾った。team `dashboard-redesign` で設計引き直し、PID 一致への置換確定。
- [x] **〔ユーザー〕現状回復** — 2026-05-16 完了（常用 firefox を閉じて HDMI-1 占拠解消）。
- [x] patch 適用 — 2026-05-16 完了（`bin/dashboard-start.sh` line 91 で `FF_PID=$!` 追加 / line 100 の predicate を `wmctrl -l -p | awk -v p="$FF_PID" '$3==p'` に置換、code-reviewer pass、commit + push 済み）。判断: B3/B4/B17-B23 実機検証 pass を待たず先当て（理由: 設計引き直しは redesign team で確定済、patch は実装 1 周目、明朝 05:30 までの空白を埋めるため）。
- [ ] **〔ユーザー〕明朝 2026-05-17 05:30 発火観察**（patch 後の本番初発火、cold boot 系の B19 真値、長期持続性 B17、BGM (B11) など実機セッションでは取れなかった項目を確認）。失敗時は STATUS L73「3 朝連続失敗で再設計判断」に従い夜診断、3 朝連続なら G 系列移行。
- [x] **〔ユーザー〕実機検証** B3 改訂 / B4 改訂 / B10 / B17 (短期) / B19 (warm) / B22 / B23 (限定条件) — 2026-05-16 00:55 事故再現条件下で `systemctl --user start dashboard.service` 実行、pass。残り B5 / B7 / B11 / B13 / B15 / B16 / B18 / B20 / B21 は別途。

## In progress

- 明朝 2026-05-17 05:30 発火観察（patch 後の本番初発火）。`web/dashboard-config.js` 中村区実データ書き換えは並行。

## Done

- 2026-05-13 skeleton 作成
- 2026-05-13 設計レビュー（team dashboard-design: architect / ux / devil）完了、本ファイルに確定設計を転記
- 2026-05-13 実装一式（web/ モック + app.js + dashboard-config.js / server/nowplaying-helper.py / bin/dashboard-start.sh / systemd 4 ユニット）作成、構文チェック・symlink・daemon-reload 済み（timer はまだ enable していない）
- 2026-05-13 code-reviewer レビュー（修正必須なし）、軽微 2 点反映
- 2026-05-13 git init + 初回ローカル commit（push は未。pre-commit hook 配置 + gitleaks 確認込み）
- 2026-05-14 手動 start 実機検証: TV に全画面表示 OK / 時計・天気・ゴミ表示 OK / mpv は slot=morning 等価コマンドで起動、当初値 sink 50% × stream 100% で `module-stream-restore` による stream 上書きが起きないことを確認（B1 pass）/ `~/music/morning/` の dir→playlist 再生 OK（B2 pass）/ now-playing helper `/np` が `Access-Control-Allow-Origin: *` 付きで正常応答（mpv 起動時は `playing:true`、不在時は `playing:false` を HTTP 200 で返す）。実音量が大きすぎたため `SINK_VOL_PCT` を 50→20 に変更（最終運用値）。
- 2026-05-14 `dashboard-start.timer` / `dashboard-stop.timer` を `enable --now` で本番化。`list-timers` で次発火 2026-05-15 05:30 (start) / 09:00 (stop) を確認。翌朝の実発火確認（B12 残）と中村区実データへの `web/dashboard-config.js` 書き換え（TODO 残）が残作業。
- 2026-05-15 dashboard 初発火（05:30）で TV に dashboard 窓が出ず、LVDS-1 に小窓 firefox が出る事故が発生。journal の `placed firefox window 0x02000003 on HDMI-1 (fullscreen)` は新規 dashboard 窓ではなく前夜 22:14 起動の常用 firefox YouTube 窓（PID 158734）を動かしていた（root cause: `bin/dashboard-start.sh:99` の WM_CLASS-grep が同一バイナリ起動の全窓を区別不能）。team `dashboard-redesign`（architect / ux / devil's advocate）で設計引き直し:
  - **採用**: 窓同定を `wmctrl -l -p` の PID 一致（`$3 == $FF_PID`）に置換。差分 ~3 行（`bin/dashboard-start.sh` line 91 で `FF_PID=$!` 追加 / line 99 predicate 置換）。
  - **B23 z-top 保証**（実機検証で必要なら）: `add,fullscreen` 直後に `wmctrl -i -a <id>` 1 行追加（ux 元案 `-b add,above` は always-on-top 固定 race リスクで不採用）。
  - **案 A 不成立観測時の引き直し先**: G（`firefox --kiosk --kiosk-monitor=<N>`）、3 朝連続失敗観測で移行。中間段（i-TITLE 等）は持たない。
  - 設計議論で z-top 対応案・補欠階段で方針反転 4 周目に到達、`~/companion/CLAUDE.md`「3 度目を打たずに一段引いて設計を見直す」適用、lead が「これ以上の方針反転は受理しない」closure 強制で確定。team archive: `~/.claude/plans/dashboard-redesign-architect.md` / `-ux.md` / `-devil.md`（後の Phase 2.5 着手者リファレンスとして残置、本 STATUS が center of truth）。
- 2026-05-16 patch 適用: `bin/dashboard-start.sh` line 91 で `FF_PID=$!` 追加、`echo` の `$!` → `$FF_PID`、line 100 の `wmctrl -l -x` WM_CLASS-grep を `wmctrl -l -p` の PID 一致に置換、コメントに 2026-05-15 事故 root cause + PID 一致採用根拠を 1 行追記。`bash -n` 構文 OK、code-reviewer 修正必須なし。commit `1a44ee2` → push 完了 (2026-05-16 00:30 頃)。
- 2026-05-16 00:55 B 検証実機 pass: 事故再現条件下（常用 firefox PID 251413 / 0x02000003 YouTube タブ desktop 0 起動中）で `systemctl --user start dashboard.service` → 8 秒で新窓 0x02400003 (PID 252288) を HDMI-1 全画面化、TV 目視 OK、常用窓は触られず desktop 0 に残存。続けて stop → 3 秒で teardown clean (cgroup-kill, 孤児なし)。pass 項目: B3 改訂 / B4 改訂 / B10 / B17 (短期) / B19 (warm 8s) / B22 / B23 (限定条件: 常用窓が別モニタ条件のみ)。残課題は明朝 2026-05-17 05:30 で cold boot 系 B19 と長期持続性 B17 / BGM (B11) を本番観察。
