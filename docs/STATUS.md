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
2. **音量固定**: `pactl set-sink-volume @DEFAULT_SINK@ 20%` + `pactl set-sink-mute @DEFAULT_SINK@ 0`。冪等・同期。**読み戻して比較・再 set はしない**（対症療法 2 周目の罠）。音声は PulseAudio 15.99.1、sink は `alsa_output.pci-0000_00_1b.0.hdmi-stereo` の 1 個のみで default。値は BGM 量フィットで 50→20% に変更（2026-05-14 実機調整）。**停止時に元値復元**: `pactl set-` の前に現在値を `.state/prev-sink-volume` / `.state/prev-sink-mute` に保存（`LC_ALL=C` で英語ロケール固定。日本語ロケール下では `Mute: いいえ` 等になりパース破綻するため必須）。復元は `dashboard-restore-volume.sh` を `dashboard.service` の `ExecStopPost=` で呼ぶ（手動 stop / 9:00 自動 stop / 異常終了どれでも経由する。状態ファイル不在は no-op＝20% のまま残るが無音破綻はしない）。**前提**: 保存処理 (start.sh 序盤) が走る前に死ぬと状態ファイルが出来ず復元側は no-op＝20% のまま残る（現状の `ExecStartPre` = X readiness gate で fail した場合は ExecStart 自体走らずこの経路に乗らないが、ExecStartPre を増やす際は把握すべき前提）。復元失敗時に状態ファイルを持ち越して next stop で retry することはしない（対症療法 2 周目を呼ばない）。
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
  - **時間ごと予報 strip**: 6/9/12/15/18/21 時の 6 スロットを天気パネル下端に描画（時刻 / アイコン / 気温 / 降水%）。既存 `forecast_days=1` のレスポンスから時刻 match で抽出（hour ジャンプ補間や smoothing はしない＝1 度の参照で確定）。fetch 失敗時は空＋ `min-height` で骨格維持（レイアウト揺らさない）。スロットは hardcode（CFG 化はしない＝先回り雛形）。**tz 前提**: Open-Meteo に `timezone=Asia/Tokyo` を渡しレスポンスの hourly.time は ISO local（無タイムゾーン）として `new Date()` で JST 解釈。`dashboard-config.js` の `weather.tz` を JST 以外に変える運用は設計外（CFG 化禁止方針と整合）。
  - **レジリエンス（state はクライアント側）**: 直近成功レスポンスを JS 変数（+ 任意で `localStorage`）に保持。fetch 失敗時はそれを表示し続け（小さく「更新 HH:MM」）、通常スケジュールでのみ再試行（即時 retry・backoff・retry ladder は無し）。保持値も無い/古すぎる → 「天気 — 取得できません」＋中立アイコン。古い予報を「現在」として出さない。**どの場合もパネルの骨格は必ず描く**（レイアウトをガタつかせない）。
  - 不採用: 天気を long-lived サーバでプロキシ＆`.state/weather.json` キャッシュする案（architect 初版）。理由: ブラウザ直 fetch で足りる／サーバ常駐は supervise 対象＋SPOF を個人用 single-viewer に抱える理由が薄い（devil A2/A3）。
  - **B5 が NG だった場合の contingency**（build 時判断、runtime fallback ではない）: now-playing helper に `GET /weather` を足して Open-Meteo をプロキシ、app.js は `http://127.0.0.1:<port>/weather` を叩く（app.js 1 行 + helper ~10 行）。
- **ゴミの日**: `web/dashboard-config.js`（`<script src>` で読み込む。`file://` から `fetch()` は弾かれるが `<script src>` は通る）に `window.DASHBOARD_CONFIG = { weather:{lat,lon,tz}, garbage:{rules:[...]} }`。クライアント JS が次回収集日＋種別を計算（純ローカル計算、retry 罠なし、5:30–9:00 で日跨ぎなし）。日付ロールオーバー検知で再計算。config 欠落/不正 → 「ゴミ設定なし」placeholder。**自治体カレンダー取込はしない**＝年末年始の振替等は表示が外れる（本ファイル明記済み）。
- **now-playing**: クライアント JS が `http://127.0.0.1:<port>/np` を ~2-3s ポーリング（helper が ACAO:* を返すので `file://` から OK）。曲なし/mpv 不在/fetch 失敗 → ごく薄く「♪ —」or 非表示。**絶対にレイアウトを揺らさない・エラーを上げない**。最も使い捨て可能な要素。fetch 失敗時は前状態保持 or 静かにクリア。
- **〔将来〕アドバイス枠**: 今回は実装しない。**markup/ファイルの予約もしない**（PROJECT.md が禁じる「先回りの雛形増やし」）。やってよいのは「将来 1 要素増えても再設計せず吸収できる柔らかいレイアウト」方針のみ。可視帯の上 ~100px を「呼吸スペース（ただのマージン）」として空け、時計を帯の上寄りに置く（垂直中央には置かない＝後でアドバイス band を足したとき時計が下にずれて fold に近づくのを防ぐ）。HTML に `<!-- 将来: アドバイス band はここ -->` のコメント 1 行のみ。

### 画面レイアウト（v0.2: industrial-refined / dashboard-redesign-2 team で確定）

2026-05-16 に v0.1 から v0.2 へリセット（ユーザー報告「情報密度が合っていない、リセットして再配置」+「Claude Code のデザインシステムを利用」=`frontend-design` skill 採用）。team `dashboard-redesign-2`（architect / ux / devil's advocate）で議論、本ファイルが確定形。

#### 美的方向（ux plan §0）
**Tone: "industrial-refined" — 制御室の静けさ**。13vw 時計が空白の海に浮かぶ「主役の不在」。記憶に残るのは「Josefin Sans の太いジオメトリック数字が暗い画面に浮かぶ、制御室の時計板感」。

#### カラー（値は v0.1 から不変、役割を明示整理）
- Dominant: `--bg-top #141a24` / `--bg-bottom #0b0f15`（deep navy）
- Text hierarchy: `--ink #ece6da`（一次）/ `--ink-dim #7f8893`（二次）/ `--ink-faint #4a525c`（三次）
- Sharp accents: `--accent #f3b85f`（amber、`.gb-when` + `.wx-icon` primary）/ `--cool #8fb6c7`（teal、`.wx-pop` + `.wx-h-pop` のみ）。範囲を広げない。

#### タイポグラフィ
**generic AI font 全廃** (skill 指針)。Inter / system-ui を撤去:
- Display (`--font-display`): `'Josefin Sans', 'Noto Sans CJK JP', sans-serif` — `.time` / `.wx-temp` / `.gb-when` に適用
- Body (`--font-body`): `'DM Sans', 'Noto Sans CJK JP', sans-serif` — 他全要素
- 自己ホスト: `web/fonts/` に `JosefinSans-SemiBold.ttf` / `DMSans-Regular.ttf` / `DMSans-Medium.ttf` 配置（OFL 1.1 ライセンス同梱）。kiosk `file://` 安全。
- 日本語: `Noto Sans CJK JP` を `local()` 参照（`fonts-noto-cjk` パッケージ前提）。Mint 21.3 確認: Regular(400) / Bold(700) のみ存在 → weight 500/600 指定は近 weight にスナップ（視聴距離 2-3m で知覚不能、対症療法 2 周目を呼ばない設計）。
- letter-spacing: `.time -0.02em` / `.wx-temp` `.gb-when -0.01em`（Josefin の geometry に合わせて引く）。

#### 寸法と配置
- 画面: `padding: 50px 90px 0`（上端 50px = オーバースキャン保険）
- advice-space: 60px（v0.1 92px → 圧縮、将来 band 用余白は維持）
- main-row: `grid-template-columns: 1fr 1.25fr 1fr`、`column-gap: 60px`（v0.1 40px → 余白を効かせる）、`align-items: start`
- 時計 13vw（変更なし、確定）/ 日付 3vw / 天気 icon 5.2vw・temp 3.8vw・label 1.9vw・sub 1.5vw / ゴミ icon 4.0vw・when 3.6vw（amber）・type 2.6vw・next 1.4vw / hourly-strip スロット time 1.1vw・icon 2.4vw・temp 1.35vw・pop 0.95vw / now-playing 1.5vw（margin-top 2.0vw）
- **時間ごと予報 strip を weather panel から独立全幅行へ移動**: v0.1 で weather 内に置いた結果 3 カラム高さが崩壊（weather ~594px vs garbage ~295px）→ v0.2 で `<div class="hourly-strip"><div class="wx-hourly">` の独立行にして 3 カラムバランス回復。`wx-hourly` ID は保持して `app.js` 変更ゼロ。
- **`.gb-type` に `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`**: 列幅縮小で「燃やすごみ・プラ容器」等が折れるのを防ぐ（pre-existing 問題の同時解消、architect 提案）

#### Atmosphere
- 周辺ビネット (`.dashboard::before`): `radial-gradient(ellipse 120% 90% at 50% 40%, transparent 40%, rgba(11,15,21,0.55) 100%)`、`position: fixed` で全画面。**center `50% 40%` は B7 仮値**、実測後に調整候補。
- 不採用: **grain overlay** (`.dashboard::after` SVG noise opacity 0.03)。devil 反証採用: opacity 0.03 は視聴距離 2-3m で JND 以下＋1080i のコーミングラインとモアレ干渉リスク＋skill「Match complexity to aesthetic vision」違反。再導入時はモアレ確認必須。
- 不採用: **hourly-strip 上端の `border-top: 2px solid rgba(255,255,255,0.05)`**。devil 反証採用: 5% 白 overlay の `#141a24` 上コントラスト比 ≈ 1.05:1 で実質不可視。`margin-top: 16px` の近接性で接続感は十分。

#### Motion
- `.dashboard` の fade-in 700ms（ロード時 1 回のみ）維持
- `.now-playing transition: opacity 200ms`（v0.1 380ms → 短縮、2.5s ポーリングで連続 transition を避ける）
- 全画面アニメ・hover / focus は禁止（kiosk、x11vnc CPU 事故防止）

#### fold 高さ予測
- v0.1 hourly 追加後 ~841px → v0.2 ~696px（architect §10 補正値、line-height 継承考慮）。fold が ~700px 以上なら全要素可視帯に収まる。strict y580 想定なら advice-space 40px or hourly min-height 5vw で追調整（B7 実測後判断）。

#### 下半分の扱い（v0.1 から継承）
**恒久的に「飾り」=確定**。コンテンツは上 ~580-700px に住み、下はベース色の続き（縦グラデで僅かに下を暗く + vignette overlay）。テクスチャ・画像・動画背景なし。時間帯で色を変えるのは punt（朝のみ運用）。

#### 撤回した設計選択（teammate plan archive）
- v0.1 の「Inter / Noto Sans JP / system-ui」font stack: 撤回（generic AI font として skill が禁じる）
- v0.1 の「hourly-strip を `.weather` 内に置く」: 撤回（3 カラム高さ崩壊の根本原因）
- ux 提案だった `grain overlay` / `border-top 2px`: devil 反証で不採用
- 案 B（時計左寄せ + 右縦積み）: 言及廃止（v0.1 のみの予備案、v0.2 で言及しない）

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
├── bin/dashboard-start.sh         # $INVOCATION_ID ガード → 現音量保存 → 音量20%+unmute → slot判定 → mpv(空ならskip) → helper → firefox(file://) → wmctrl で HDMI-1 全画面 → exec sleep infinity
├── bin/dashboard-restore-volume.sh # dashboard.service ExecStopPost。.state/prev-sink-volume{,mute} を読んで pactl で復元 → ファイル削除。状態ファイル不在は no-op。
├── server/nowplaying-helper.py    # ~30行。127.0.0.1:<port> GET /np のみ。mpv IPC → JSON, ACAO:*。mpv不在は {"playing":false} を 200 で。
├── web/
│   ├── index.html
│   ├── style.css
│   ├── app.js                     # 時計(冒頭・毎秒・隔離) / 天気(Open-Meteo直fetch・毎時・last-good保持) / ゴミ(config計算・日付ロールオーバーで再計算) / nowplaying(/np を 2-3s ポーリング)
│   └── dashboard-config.js        # window.DASHBOARD_CONFIG = {weather:{lat,lon,tz}, garbage:{rules}}。ユーザーが中村区の実収集日に書き換え。git管理。
├── systemd/
│   ├── dashboard.service          # Type=simple, Restart=no, Environment=DISPLAY=:0, ExecStartPre=X-readiness(bounded), ExecStart=bin/dashboard-start.sh, ExecStopPost=bin/dashboard-restore-volume.sh, TimeoutStopSec=15s, WorkingDirectory=%h/companion/dashboard
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
- **窓識別**: index.html の `<title>=COMPANION-DASH` のタイトル一致（`wmctrl -l | awk 'index($0,t)'`）で確定。WM_CLASS マッチ / 多重述語 / 配置後の geometry read-back / stderr 文言マッチ / リトライ fallback は足さない。一致 0 件 = benign give-up。**旧 PID 一致（`wmctrl -l -p` の `$3==FF_PID`）から 2026-05-22 に引き直し**: `firefox --new-instance` の launcher PID(`$!`) と実窓の `_NET_WM_PID` が原理的に食い違い PID 一致が当たらず毎朝 timeout していた（5/17-19 の「window not found」の真因はこれ。当時 STATUS が「firefox --kiosk で HDMI-1 占有」と書いたのは誤帰属＝スクリプトに `--kiosk` は無い。実際は前回 firefox が書いた xulstore の 1280x710 normal 窓が偶々 HDMI-1 上にあっただけ）。COMPANION-DASH は dashboard 専用 profile + `--new-instance` ゆえ常用 firefox の窓と衝突しない、我々が所有する一意キー。
- **2026-05-22 引き直しの軸選択（identity 軸の据え直し、placement 軸移行は不採用）**: 当初の引き直し先 G（`firefox --kiosk --kiosk-monitor=<N>`）は **firefox に存在しない幻のフラグ**だった（`--kiosk-monitor` は Chromium のオプション、firefox 151 `--help` に無し）。さらに実機検証（2026-05-22、`DISPLAY=:0` 使い捨て profile）で xulstore（`sizemode:fullscreen`→maximized 格下げ / `sizemode:normal`+screenX:0 / +screenX:300）も `--kiosk` も **この機の WM(Marco) が新規窓を primary=LVDS-1 へ再配置するため全パターン LVDS-1 着地**（尊重されるのは width/height のみ、モニタは不可制御）と判明。HDMI-1 を座標で確実に狙えるのは `wmctrl -e 0,0,1920,1080`+`add,fullscreen` のみ（B4 2026-05-16 + 2026-05-22 再実証で X=0/1920×1080/FULLSCREEN を確認）。**壊れていたのは placement ではなく identity** だったため、placement 軸（G）へは移さず identity 軸を PID→title へ据え直した。成否は 1 回で確定・fallback 連鎖なしゆえ `~/companion/CLAUDE.md` の対症療法 2 周目には当たらない（PID 述語への条件追加ではなく軸の置換）。

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
- [x] **〔ユーザー〕`web/dashboard-config.js` の緯度経度を中村区実値に書き換え** — 2026-05-19 (N35°10'25.38" E136°52'16.87" → lat 35.173717 / lon 136.871353)
- [ ] **〔ユーザー実機作業 / 観察対象外〕`web/dashboard-config.js` の garbage.rules を中村区の自分の地区の実収集日に書き換え**（現状ダミー、機能的支障なし）
- [x] git → GitHub private repo `mooneclipse/companion-dashboard`（private）→ push 済み（2026-05-13）。※companion repo 群の monorepo 化は someday 候補（`workspace/PROJECT.md` の「将来の保留事項」に記載）
- [x] (B12 残) 2026-05-15 05:30 発火検証 → **失敗**、root cause = WM_CLASS-grep が前夜 22:14 起動の常用 firefox 窓（PID 158734、YouTube タブ）を拾った。team `dashboard-redesign` で設計引き直し、PID 一致への置換確定。
- [x] **〔ユーザー〕現状回復** — 2026-05-16 完了（常用 firefox を閉じて HDMI-1 占拠解消）。
- [x] patch 適用 — 2026-05-16 完了（`bin/dashboard-start.sh` line 91 で `FF_PID=$!` 追加 / line 100 の predicate を `wmctrl -l -p | awk -v p="$FF_PID" '$3==p'` に置換、code-reviewer pass、commit + push 済み）。判断: B3/B4/B17-B23 実機検証 pass を待たず先当て（理由: 設計引き直しは redesign team で確定済、patch は実装 1 周目、明朝 05:30 までの空白を埋めるため）。
- [x] **〔ユーザー〕明朝 2026-05-17 05:30 発火観察** — 2026-05-17 / 5/18 / 5/19 の 3 朝とも user TV 物理確認で **機能成功** (Done 詳細参照、2026-05-20 全体レビュー軸 1 で確定)。journal 上 `firefox window not found within timeout — leaving as-is` は出るが、firefox 自身が kiosk mode で HDMI-1 を占有しており TV 表示は OK。predicate ロジック (wmctrl PID 一致 12 秒以内) の効きどころ見直しは Phase 4 trigger 時 or 別タイミング、L113「3 朝連続失敗」ルールは機能成功のため不発動。
- [x] **〔ユーザー〕実機検証** B3 改訂 / B4 改訂 / B10 / B17 (短期) / B19 (warm) / B22 / B23 (限定条件) — 2026-05-16 00:55 事故再現条件下で `systemctl --user start dashboard.service` 実行、pass。残り B5 / B7 / B11 / B13 / B15 / B16 / B18 / B20 / B21 は別途。
- [x] **停止時の音量復元** — 2026-05-16 実装。`bin/dashboard-start.sh` で起動時に現音量・mute を `.state/prev-sink-volume{,mute}` に保存（`LC_ALL=C` でロケール固定）、新規 `bin/dashboard-restore-volume.sh` を `dashboard.service` の `ExecStopPost=` で呼んで復元。要 `systemctl --user daemon-reload`。
- [x] **時間ごと予報 strip** — 2026-05-16 実装。天気パネル下端に 6/9/12/15/18/21 時の 6 スロット (時刻 / アイコン / 気温 / 降水%) を追加。既存 `forecast_days=1` のレスポンスで賄える。`index.html` / `app.js` (renderHourly) / `style.css` (.wx-hourly grid) 更新。
- [x] **v0.2 redesign（industrial-refined）** — 2026-05-16 実装。team `dashboard-redesign-2` (architect / ux / devil) で議論し本 STATUS の画面レイアウト section を全面書き換え。Inter / Noto Sans JP を撤去し Josefin Sans + DM Sans + Noto Sans CJK JP を自己ホスト (`web/fonts/`)。サイズリセット (weather/garbage 縮小・hourly 独立行)・column-gap 60px・vignette overlay・letter-spacing 精緻化を反映。grain と border-top は devil 反証で不採用。`app.js` 変更ゼロ。
- [ ] **〔ユーザー〕title 一致引き直しの本番確認**（2026-05-22 実装）: 明朝 2026-05-23 05:30 発火 or 手動 `systemctl --user start dashboard.service` で TV に **全画面**表示されるか物理確認。journal に `placed firefox window <id> on HDMI-1 (fullscreen)` が出れば title 一致成功（従来は `window not found within timeout`）。NG が 3 朝続けば L190-191 に従い設計引き直し。
- [ ] **B7 拡張系（v0.2 redesign 用の実機確認）**: 下記 B24-B27 を本番初発火 or 手動 start で目視
  - B24: fold 高さ実測（v0.2 予測 ~696px が可視域内か）
  - B25: vignette 中心 `50% 40%` で端部の wx-sub / gb-next が暗くなりすぎないか
  - B26: `.gb-when` の日本語+ASCII 混在見た目（"あす(水)" のひらがな・漢字は Noto fallback、括弧 2 文字のみ Josefin）。NG なら `.gb-when` を `var(--font-body)` に 1 行変更（対症療法 2 周目ルール抵触なし）
  - B27: Noto Sans CJK JP weight 700 スナップ表示（`.gb-when` `.wx-temp` `.time` の日本語要素、ただし数字主体なので影響軽微）

## In progress

（なし、2026-05-20 全体レビュー軸 1 で 5/17-19 観察 Done 移管完了）

## Done

- 2026-05-22 窓配置の identity 軸引き直し（PID 一致 → title 一致）。**ユーザー報告**「9:00 にブラウザごと閉じるのは確認できた。ただ YouTube と同じでウィンドウの大きさが制御できていない」を起点に調査。
  - **根本原因**: ① 現行 profile の `xulstore.json` が `screenX:319,screenY:169,width:1280,height:710,sizemode:normal` を保持 → firefox がこの 1280x710 の「普通の窓」を復元（＝大きさ未制御の正体）。② step6 の wmctrl PID 一致が毎朝 timeout（今朝 5/22 も `firefox window not found within timeout`、05:30:12）。真因は `firefox --new-instance` の launcher PID(`$!`) ≠ 実窓 `_NET_WM_PID`。③ 台帳が予告した引き直し先 G（`firefox --kiosk --kiosk-monitor=<N>`）は firefox に存在しない幻フラグ（Chromium のもの、firefox 151 `--help` 確認）。chromium/chrome/xdotool は未導入（firefox のみ）。
  - **実機検証**（`DISPLAY=:0` 使い捨て profile、5 パターン）: xulstore `sizemode:fullscreen`→maximized 格下げで **LVDS-1** / `normal`+screenX:0→**LVDS-1** / `normal`+screenX:300→x≈2014 で **LVDS-1** / `--kiosk`+xulstore→真の全画面だが **LVDS-1** / **title 一致+`wmctrl -e 0,0,1920,1080`+`add,fullscreen`→X=0,Y=0,1920×1080,FULLSCREEN=HDMI-1** ✓。結論: この機の WM(Marco) は新規窓を primary=LVDS-1 へ再配置し screenX を無視（video-design の `--fs-screen=0`→LVDS-1 と同じ罠）。firefox に mpv の `--fs-screen-name=HDMI-1` 相当の出力名フラグは無いため、HDMI-1 を狙えるのは座標指定の `wmctrl -e` のみ。
  - **引き直し（ユーザー承認 2 段階: 方式選択→xulstore 否定後に第3案へ切替）**: 壊れていたのは placement でなく identity ゆえ identity 軸を PID→title へ据え直し（placement 軸 G へは移さない）。`web/index.html` の `<title>` を `dashboard`→`COMPANION-DASH`（全画面では非表示の一意キー）、`bin/dashboard-start.sh` step6 の同定を `wmctrl -l -p` PID 一致 → `wmctrl -l | awk -v t=COMPANION-DASH 'index($0,t)'` title 一致に置換。配置（`wmctrl -e`+`add,fullscreen`）は据え置き。`bash -n` OK、awk が素の "dashboard" 行を拾わないことを単体確認。対症療法 2 周目非該当（軸の置換、成否 1 回確定、fallback なし）。
  - **誤帰属の訂正**: 5/17-19 の「機能成功 = firefox `--kiosk` で HDMI-1 占有」（旧 L214/237）は誤り。スクリプトに `--kiosk` は無く、実際は xulstore の 1280x710 normal 窓が偶々 HDMI-1 上にあっただけ（だから「大きさ未制御」が当初から潜在していた）。
  - **残**: 〔ユーザー〕明朝 2026-05-23 05:30 発火 or 手動 start で TV 全画面を物理確認（journal に `placed firefox window … on HDMI-1 (fullscreen)` が出れば title 一致成功）。3 朝連続失敗時は L190-191 のルールに従い設計引き直し（patch #2 を打たない）。
- 2026-05-20 全体レビュー軸 1 で発覚した dashboard 5/17-19 観察結果整理 + In progress 解消
  - **背景**: 健全性 2 週間観察期間 (2026-05-19〜2026-06-02) 起点で実施した全体レビュー (PROJECT.md 健全性履歴 2026-05-20 entry 参照) 軸 1 STATUS.md drift 点検で、5/17 patch 後の本番初発火観察が In progress のまま 3 朝放置されている drift を検出。journal 確認 + user TV 物理確認で 3 朝とも機能成功と判明、L113 / L191 「3 朝連続失敗」ルール不発動を確定
  - **journal 観察値** (`journalctl --user -u dashboard.service` 5/17-19):
    - 5/17 05:30:00 start / `firefox window not found within timeout — leaving as-is` / 09:00:00 stop, `ExecMainStatus=0` `Result=success` `Consumed 18min 48.153s CPU time`
    - 5/18 05:30:00 start / 同 / 09:00:00 stop, `Consumed 18min 39.957s CPU time`
    - 5/19 05:30:00 start / 同 / 09:00:00 stop, `Consumed 18min 51.093s CPU time`
  - **user TV 物理確認**: 5/17, 5/18, 5/19 の 3 朝とも TV にダッシュボードが映っていた = **機能成功**。journal の「window not found」は dashboard-start.sh L100 の wmctrl predicate (`-l -p | awk '$3==FF_PID'`) が 12 秒以内に PID 一致 window を捕まえられなかっただけで、firefox 自身は `--kiosk` で HDMI-1 を占有・全画面化していた
  - **「3 朝連続失敗」ルール判定**: L113 / L191 のルールは「機能失敗 (TV に何も映らない / 異常表示)」を前提とする。本件は機能成功なのでルール不発動、G 系列 (firefox --kiosk --kiosk-monitor=<N>) への引き直しは不要
  - **残置課題 (修正対象外)**: dashboard-start.sh L100 predicate が常に timeout する事実は新たな観察値。firefox --kiosk は自前で全画面化するので wmctrl 操作は本来不要だった可能性 (= 「leaving as-is」が結果オーライ)。Phase 4 trigger 時 or 別タイミングで「predicate を撤去するか / window 移動責務を kiosk monitor option に統合するか」を再判定 → 本台帳「実機検証チェックリスト」B7 拡張系 (B24-B27) の議論時に併合検討。今は機能成功 + 観察値記録のみで commit ノイズを避ける (CLAUDE.md「対症療法 2 周目ルール」抵触なし)
  - **drift #3 関連**: L209 ゴミ収集ルール書き換え TODO は「ユーザー実機作業 / 観察対象外」とラベル付け、In progress とは別欄管理 (本日 5/20 修正済)
  - **作業範囲**: `dashboard/docs/STATUS.md` L209 ラベル付け + L214 観察結果記録 + L227 In progress 整理 + 本 Done エントリ。1 ファイル
  - **code-reviewer**: 省略 (drift 整備 + 観察値記録のみ、実装変更ゼロ、bot/STATUS.md 5/19 「workspace/CLAUDE.md §B-2 反映済 drift 解消」と同方針)
  - **次タスク**: Phase 2.5 健全性 2 週間観察 (2026-05-19〜2026-06-02) で dashboard.service 引き続き観察、B24-B27 v0.2 redesign 目視は user 朝の運用ペースで実施

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
- 2026-05-16 停止時の音量復元実装。経緯: ユーザー報告「画面終了後に音量が元に戻らない」。`dashboard-start.sh` は起動時に sink を 20% 固定するが、停止時に元値に戻す経路が無かった。実装: 起動時 `pactl get-sink-volume/mute @DEFAULT_SINK@` の現値を `.state/prev-sink-volume{,mute}` に保存（`LC_ALL=C` 必須＝ja_JP では `Mute: いいえ` でパース破綻する地雷を踏みかけた）、`dashboard.service` に `ExecStopPost=%h/companion/dashboard/bin/dashboard-restore-volume.sh` を追加（手動 stop / 9:00 自動 stop / 異常終了どれでも経由する）、復元側は状態ファイル不在で no-op (20% のまま残るが無音破綻はしない＝対症療法 2 周目を呼ばない設計)。**ユーザー手動検証 pass** (2026-05-16): `systemctl --user daemon-reload` 後に start → 5s → stop で元の音量に戻ることを目視確認。
- 2026-05-16 v0.2 redesign（industrial-refined）。経緯: ユーザー報告「情報密度が合っていない、一度リセットしてきれいに配置し直してほしい / 上半分維持 / 色は現状 / Claude Code のデザインシステム (=`frontend-design` skill) を利用 / agent team モードは auto」。team `dashboard-redesign-2` (architect / ux / devil's advocate、in-process / auto モード) で議論。ユーザー Q&A 2 点を中継 (Q1: skill 解釈=frontend-design plugin / Q2: 密度ミスマッチ方向=サイズが情報価値と不釣合い)。architect 案 (vw 縮小 + hourly 独立行) + ux 案 (Josefin Sans / DM Sans / Noto Sans CJK JP 自己ホスト + vignette + letter-spacing 精緻化) + devil 反証 (grain と border-top 削除、`.gb-type` ellipsis 追加) を統合し v0.2 確定。teammate plan archive: `~/.claude/plans/dashboard-redesign-2-{architect,ux,devil}.md`。実装差分: CSS ~95 行書き換え (`web/style.css` 全面再構成) / HTML ~7 行 (hourly を main-row 外へ移動) / JS ゼロ / 新規 `web/fonts/` 3 ttf + 2 OFL ライセンス。B7 拡張系 B24-B27 は本番初発火で観察。
- 2026-05-16 時間ごと予報 strip 実装。経緯: ユーザー報告「時間ごとの予報がみたい」。既存 app.js は Open-Meteo hourly レスポンスを取得していたが、UI は今日の hi/lo と降水 max を集約していただけ。実装: 天気パネル下端に 6/9/12/15/18/21 時の 6 スロット (時刻 / アイコン / 気温 / 降水%) を grid で描画 (`renderHourly`)。スロット時刻は hardcode、CFG 化はしない (`先回りの雛形`)。fetch 失敗時は空＋ `min-height: 7.2vw` で骨格維持。weather panel 縦長化で fold 近傍に伸びるため、`web/style.css` のサイズは控えめ (時刻 1.1vw / アイコン 2.6vw / 気温 1.45vw / 降水 0.95vw)。本番 TV での読みやすさ確認は明朝の本番初発火時の観察対象。
- 2026-05-19 `web/dashboard-config.js` の緯度経度をダミー (lat 35.170 / lon 136.882) からユーザー提供の中村区実値 N35°10'25.38" E136°52'16.87" を十進度変換した値 (lat 35.173717 / lon 136.871353) に書き換え、コメントも DMS 出典に揃えた。code-reviewer pass (修正必須なし)、Open-Meteo の latitude/longitude パラメータ整合 OK。ゴミ収集日 (garbage.rules) はダミーのまま残置 (TODO に分離)。
