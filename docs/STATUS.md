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
2. **音量固定**: `pactl set-sink-volume @DEFAULT_SINK@ 50%` + `pactl set-sink-mute @DEFAULT_SINK@ 0`。冪等・同期。**読み戻して比較・再 set はしない**（対症療法 2 周目の罠）。音声は PulseAudio 15.99.1、sink は `alsa_output.pci-0000_00_1b.0.hdmi-stereo` の 1 個のみで default。
3. **時間帯フォルダ判定**: `date +%H` → `5..10`=morning / `11..15`=afternoon / `16..20`=evening / else=night。5:30 起動なので morning。これは「正しい関数を最初から書く」だけで先回りの雛形ではない（先回り＝afternoon.timer や `dashboard@.service` テンプレを今作ること。それはしない）。
4. **音楽**: `~/music/<slot>/` に音楽ファイルが 1 つでもあるか `find -print -quit` でチェック。空なら mpv をスキップ（journal に warn）。非空なら stale socket を `rm -f` してから `mpv --no-video --shuffle --loop-playlist=inf --volume=100 --input-ipc-server="$XDG_RUNTIME_DIR/dashboard-mpv.sock" "$HOME/music/<slot>/" &`。フォルダ別音量は将来 config 値（retry ではない）。**別フォルダへの fallback はしない**。
5. **now-playing helper**: `python3 server/nowplaying-helper.py &`（127.0.0.1:<固定ポート> で `GET /np` のみ。mpv IPC socket に `{"command":["get_property","media-title"]}` を投げ、`media-title`+`metadata`(artist) を JSON で返す。`Access-Control-Allow-Origin: *`。mpv 不在/死亡＝ENOENT/ECONNREFUSED → `{"playing":false}` を HTTP 200 で返す＝正常状態。1 回の connect-or-empty で確定、リトライしない）。
6. **firefox**: `.state/ff-profile/user.js` を heredoc で（再）生成（session 復元 OFF / first-run・what's-new・default-browser・telemetry プロンプト全 OFF / `full-screen-api.warning.timeout=0` / `browser.fullscreen.autohide=true`）。`firefox --new-instance --no-remote --profile "$HOME/companion/dashboard/.state/ff-profile" "file://$HOME/companion/dashboard/web/index.html" &`。
   - **`--kiosk` は使わない**（kiosk の EWMH fullscreen 状態は WM が wmctrl の move を無視しがち＋窓が primary=LVDS-1 に出て事故る）。
   - **`-P <name>` ではなく `--profile <絶対パス>`**（self-contained、profile-manager レジストリに依存しない、未登録時に Profile Manager GUI が出ない）。
7. **配置**: firefox ウィンドウ出現を `wmctrl -l -x | grep -i firefox` で上限付き待ち（~10s, 0.5s 刻み）。出たら `wmctrl -i -r <id> -b remove,maximized_vert,maximized_horz` → `wmctrl -i -r <id> -e 0,0,0,1920,1080`（HDMI-1 は `+0+0` なので原点へ置けば TV に乗る）→ `wmctrl -i -r <id> -b add,fullscreen`。出なければ warn して諦め（service は殺さない。何か出てる方がマシ）。**この上限待ちを「窓が出ない → 回数増やす/sleep 足す」方向に育てない**。flaky が続いたら patch #2 を当てず設計引き直し（候補: 極小 openbox session / marco 設定 / 諦めて手動修正）を本ファイルに根拠付き記録してから着手。
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
- 案 A: 左 1/3=天気（アイコン / 現在気温 / 天候ラベル / 今日 ↑↓ / 降水%）、中 1/3=時計（最大、HH:MM ~240px tabular figures、秒は ~56px で右肩従属 or コロン点滅のみ — 好み、要ユーザー確認、日付 ~56px「5月13日 (火)」）、右 1/3=ゴミ（アイコン / 種別 / 「あす(水)」/ 「次: プラ 5/16」）。下に now-playing 1 行（~28px、♪ 曲名 — アーティスト、控えめ）。それ以下〜y=1080 はベース色の続き（任意でほぼ知覚不能の縦グラデで僅かに下を暗く）。テクスチャ・画像・動画背景なし。
- 案 B（予備）: 時計左寄せ大 + 右に天気/ゴミ縦積み。情報量が将来増えたら右列に積みやすい。今は案 A 推奨。
- **下半分を恒久的に「飾り」にする判断＝確定**。要素 4 つ + 将来 1 つは 1920×~580px に余裕で収まる。「溢れたら degrade」柔軟設計は存在しない問題への対策＝YAGNI 違反。「手前モニタを下げれば下も見える」は朝の運用（モニタ上げたまま一瞥）では発生しない前提。下に「下げれば見える二次情報」を置くのもナシ（誰も見ない二層 UI を検証できない／「見えないと存在しない」原則に反する）。ただし下半分は「壊れた余り」ではなく「デザインの連続」（1920×1080 全体で 1 つのデザイン、コンテンツは上 ~580px に住む、下はベース色がそのまま続く）。
- 時間帯で色を変える: punt（朝のみ運用なので便益ゼロ、色替えコード経路を増やさない。将来 afternoon/evening timer が来たら入れる）。
- フロント方向性: 「夜明け前の静けさ」。余白贅沢（コンテンツは可視帯の 6 割程度）、大きく幾何学的な humanist sans（system stack: Inter / Noto Sans JP / system-ui）、時計だけ tabular-figures で tight。天気/ゴミは大きめ角丸カード or カード無しの浮遊テキスト群（後者の方が静か — 実装で判断）。データ更新は 300-500ms のソフトフェード、何も pop しない。アニメーション禁欲的（GPU 無し Ivy Bridge + x11vnc が dirty frame を毎回再エンコードするので全画面アニメ/動くグラデは CPU・VNC 帯域を食う。毎秒の時計更新＝小 dirty rect は OK）。

### x11vnc 非干渉
x11vnc はシステムサービス（`/etc/systemd/system/x11vnc.service`）で `-display :0` を framebuffer キャプチャ + 入力注入してるだけ。ウィンドウ管理には関与しない。今回足すのは user unit で :0 にウィンドウを出すだけ → 衝突なし。**x11vnc の unit には一切触らない**。

### 電源
スリープ/スクリーンセーバー/蓋閉じ無効化済み前提に乗る。stop で `suspend`/`shutdown` は呼ばない。9:00 停止後の TV はデスクトップ壁紙が見える（TV blank は out of scope）。

---

## 実機検証チェックリスト（build/test フェーズで実施。一部の設計選択はこれ待ちの暫定）

> ⚠ 検証で音が出る・TV が光るものは 5:30〜9:00 以外にやると寝てる人を起こす。音量 0 で or ユーザーが起きてる時に。

- **B1 音量 50% 固定が pactl 1 発で成立するか**: PulseAudio の `module-stream-restore` が mpv のストリーム音量を前セッションから復元しうる（最終実音量 = sink音量 × stream音量）。`mpv --volume=100` がそれを上書きするか確認（`pactl list sink-inputs | grep -i volume`, `pactl get-sink-volume @DEFAULT_SINK@`）。上書きしないなら mpv 起動後に sink-input volume も 100% に pin（B1 結果次第の追加、先回りでは入れない）。
- **B2 mpv 0.34.1 のディレクトリ→playlist 挙動**: ダミー mp3 1-2 個で `mpv --no-video --shuffle --loop-playlist=inf --input-ipc-server=/run/user/1000/dashboard-mpv.sock ~/music/morning/` → 再帰するか / 拡張子フィルタ / 空ディレクトリ時 exit-or-idle / stale socket で起動できるか。空時即 exit なら `find` で playlist を組む実装に倒す。
- **B3 firefox 多重起動**: 常用 firefox 起動中に別端末から `firefox --new-instance --no-remote --profile /tmp/dash-test "file://..."` → 新インスタンスが立つか / `--profile` で dir 自動生成か / `wmctrl -l -x` で WM_CLASS（`Navigator.Firefox` か `firefox` か — polling grep に必要）。
- **B4 wmctrl で firefox 窓を HDMI-1 に全画面化**: 非 kiosk `--new-window` 起動 → `wmctrl -l -x` で id → `wmctrl -i -r <id> -b remove,maximized_vert,maximized_horz` → `-e 0,0,0,1920,1080` → `-b add,fullscreen` → HDMI-1(0,0) でフル / LVDS にはみ出さない / fullscreen 警告オーバーレイが残らない / Marco の per-monitor fullscreen が効くか。効かないなら設計引き直し（kiosk + 出たモニタで妥協 or 一時 primary 切替＋9:00 復元機構）を STATUS 記録してから。
- **B5 `file://` origin から Open-Meteo に fetch できるか**: `file:///tmp/t.html` に fetch を書いて firefox で開き CORS で通るか。通れば「天気サーバレス」確定。通らなければ上記 contingency（helper に `/weather` プロキシ）。
- **B6 HDMI-1 のモード（インターレース）**: 現状 `1920x1080i`（progressive 最大は 1280x720）。`xrandr` の `*` が 1080i。細い横線・小文字でコーミング/ちらつき。`xrandr --output HDMI-1 --mode 1280x720` に切り替えて TV で文字の見え方を比較。デフォルト方針: 1080i のまま太字・hairline なし・大文字で運用、アプリは解像度を触らない。1080i の文字が許容不能 & 720p が大幅改善なら → ユーザーが恒久的に 720p に設定（アプリ scope 外）or 再検討。**解像度切替はアプリに焼かない**（切替えると 9:00 復元機構が要る = devil A1 系の複雑化、MATE パネル/アイコン再配置の副作用）。
- **B7 TV の物理可視域の実測**: firefox で「縦に 0/270/540/810/1080px の目盛りページ」を全画面表示し、実配置で何 px〜何 px 見えるか現物で測る。「上半分=540px」は思い込みかも（家具で下が隠れてるだけなら ~700px、額縁で上下削れて ~450px かも）。実測値が出るまで CSS に高さを焼かない。clock+weather+garbage(+nowplaying) が実測可視域で「部屋の向こうから読める」字サイズに収まるかモックで現物確認（収まらないなら nowplaying 落とす / garbage 1 行に圧縮）。
- **B8 GUI-from-systemd-user-unit**（最重要）: `systemctl --user start dashboard.service` を平日昼に手動実行 → firefox が :0 に開くか。`DISPLAY=:0`（+`XAUTHORITY`?）で足りるか。`journalctl --user -u dashboard.service` に X 接続エラーなし。
- **B9 firefox `$!` PID 永続性**: `firefox --new-instance --no-remote --profile <path> URL & FF=$!; sleep 8; ps -p $FF` — 落ち着いた後も生きてるか（実装は `exec sleep infinity` にするので致命ではないが挙動把握）。
- **B10 `systemctl --user stop` の teardown**: firefox（content 全部）+ mpv + helper が `TimeoutStopSec` 内に消えるか。`systemd-cgls --user` で cgroup 空、PID 1 への孤児ゼロ。double-fork する子がいないか（mpv / python / `firefox --new-instance --no-remote` のいずれも無いはず）。
- **B11 PipeWire→PulseAudio from user service**: `dashboard.service` の中から `pactl set-sink-volume @DEFAULT_SINK@ 50%` が効くか（env に `XDG_RUNTIME_DIR`）、sink SUSPENDED でも。mpv 再生で実際に TV から音が出るか。
- **B12 timer**: `systemctl --user list-timers` に `dashboard-start.timer` が次 05:30、`AccuracySec=1s` で数秒以内発火、`Persistent=true` が無いこと。`dashboard-stop.timer` が次 09:00。
- **B13 `--profile <path>` 初回 + user.js**: 厳選 `user.js` で default-browser / session 復元 / telemetry プロンプト / what's-new タブが出ないか。
- **B14 `xset` の有無**: `ExecStartPre` の X-readiness gate で `xset q` を使う想定。無ければ `xdpyinfo` or `[ -e /tmp/.X11-unix/X0 ]` に倒す。
- **B15 `loginctl show-user miho | grep Linger`**: linger 無効なら user timer は session 依存（auto-login で常時 session ありなので実害薄い）。`loginctl enable-linger miho` は安い保険（要 sudo はユーザー側端末）。やるか判断。
- **B16 garbage の nth-weekday 計算テスト**（実装時必須）: 第 n 曜日の月境界 / 第 5 週が無い月 / 「今日が収集日」のとき next 判定（収集時刻 前/後）/ 月跨ぎ。

---

## 構成

```
dashboard/
├── bin/dashboard-start.sh         # $INVOCATION_ID ガード → 音量50%+unmute → slot判定 → mpv(空ならskip) → helper → firefox(file://) → wmctrl で HDMI-1 全画面 → exec sleep infinity
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
- 音量: 「50% になってない気がする → sleep して再 set / 読み戻し比較で再 set」をしない。`set-sink-volume`+`set-sink-mute` は冪等・同期、1 回で終わり。
- 配置: wmctrl の上限付き readiness wait は OK（observable state へのゲート、benign give-up）。「窓が出ない → 回数増やす/sleep 足す」方向に育てない。flaky なら patch #2 ではなく設計引き直しを STATUS 記録してから。
- プロセス kill: `pkill firefox`/`pkill mpv`/`pkill -f …` は禁止（常用 firefox 巻き込み + `pkill -f` は Bash wrapper 自爆。MEMORY 既出）。cgroup-kill（`systemctl --user stop`）のみ。専用 `--profile <path>` で曖昧さゼロ。
- 天気 fetch: 「timeout/5xx → retry → backoff → cache TTL hack」をしない。「直近成功値（state）を保持、失敗時はそれを表示、通常スケジュールでのみ再試行」。
- slot 判定: 境界時刻の特別扱いをしない。start 時に 1 回確定、途中再評価しない。slot #2 が来たら時計監視ループを足すのではなく `dashboard@<slot>.service` テンプレ化に移行。
- now-playing: mpv IPC は 1 回の connect-or-empty で確定。「mpv 起動待ちで数回リトライ」をしない。
- respawn: `while true; do firefox …; done` 系禁止。`Restart=` 付けない。子が 1 個落ちても残りは degrade、9:00 に cgroup kill で掃除。

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
- [ ] **〔ユーザー〕モックの見た目チェック**: Firefox で `file:///home/miho/companion/dashboard/web/index.html` を開く（時計は動く。天気は file:// から Open-Meteo に届けば実データ、届かなければ「取得できません」表示＝B5 の実地テストにもなる。ゴミは dashboard-config.js のダミールールで計算表示）
- [ ] 実機検証チェックリスト B1-B16（音が出る/TV が光るものはユーザー在席時 or 音量0。特に B1 音量実体・B4 wmctrl 配置・B5 file://→Open-Meteo CORS・B6 1080i・B7 可視域実測・B8 GUI-from-user-unit が load-bearing）
- [ ] **〔ユーザー〕`web/dashboard-config.js` を名古屋市中村区の実収集日・実緯度経度に書き換え**（今はダミー）
- [ ] **〔ユーザー〕秒表示の好み確認**（右肩に小さく従属 / コロン点滅のみで秒非表示）→ 後者なら `.time .ss` を非表示にし index.html の `<span class="ss">` を落とす
- [ ] 検証 OK 後: `systemctl --user enable --now dashboard-start.timer dashboard-stop.timer`（`dashboard.service` / `dashboard-stop.service` は `Unit=` で駆動されるので enable 不要）→ `systemctl --user list-timers` で 05:30 / 09:00 を確認
- [ ] git → GitHub private repo → `git push`（push は `ask` 権限、**ユーザー承認 + repo 作成手段（gh / 手動）確認**）※ローカル commit は 2026-05-13 に実施済み（下記 Done）

## In progress

- ユーザーレビュー待ち（モック見た目 / dashboard-config.js 記入 / 秒表示の好み）+ 実機検証 B1-B16

## Done

- 2026-05-13 skeleton 作成
- 2026-05-13 設計レビュー（team dashboard-design: architect / ux / devil）完了、本ファイルに確定設計を転記
- 2026-05-13 実装一式（web/ モック + app.js + dashboard-config.js / server/nowplaying-helper.py / bin/dashboard-start.sh / systemd 4 ユニット）作成、構文チェック・symlink・daemon-reload 済み（timer はまだ enable していない）
- 2026-05-13 code-reviewer レビュー（修正必須なし）、軽微 2 点反映
- 2026-05-13 git init + 初回ローカル commit（push は未。pre-commit hook 配置 + gitleaks 確認込み）
