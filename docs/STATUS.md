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
   - **配置は §7 の `--kiosk --kiosk-monitor=1` で firefox 自身が確定**（2026-05-25〜）。旧 `--kiosk` 単独不採用理由「WM が wmctrl move を無視」「窓が primary=LVDS-1 に出る」は wmctrl 経由の placement を前提とした話で、`--kiosk-monitor=1` 併用時は構造的に消える（firefox 自身が target monitor を選び、Marco の再配置は当該窓に適用されない）。
   - **`-P <name>` ではなく `--profile <絶対パス>`**（self-contained、profile-manager レジストリに依存しない、未登録時に Profile Manager GUI が出ない）。
7. **配置**: firefox を `firefox --new-instance --no-remote --profile <path> --kiosk --kiosk-monitor=1 URL &` で起動し、firefox 自身に HDMI-1 を占有させる。wmctrl による窓同定＋配置は **廃止** (2026-05-25 軸移行、§Done 2026-05-25 エントリ参照)。番号体系は実機検証で N=0=LVDS-1 / N=1=HDMI-1 と確定 (2026-05-25、xrandr 順ではなく primary 以外が 1 と推定)。primary 変更・モニタ追加時は要再検証。
   - **常用 firefox との独立**: dashboard 専用 profile + `--new-instance --no-remote` で常用 firefox の窓・プロファイルとは完全独立。WM_CLASS マッチ・PID 一致・title 一致といった「窓同定」ロジック自体が不要になったため、2026-05-15 の WM_CLASS-grep 事故系列は原理的に再発しない。
   - **背景**: 常用 firefox を前夜から開いた状態で寝る生活（前夜タブ/YouTube 再生位置を残す）を破壊しないため、社会的解決は採らず技術修正で根治。
   - **z-top**: --kiosk-monitor=1 起動時 firefox は target monitor で fullscreen 化、Marco の per-monitor fullscreen で他モニタ窓と独立。B23 系列の検証懸念（常用窓が前面に残る）は --kiosk-monitor の挙動で吸収。
   - 「窓が HDMI-1 に出ない」観測時はここに polling を足し戻さず、--kiosk-monitor 番号体系の再検証＋STATUS への記録から始める（§ 対症療法 2 周目ルールの先回り 配置項参照）。
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
- **セリフ枠（キャラ隣 `#quote-text`）**: 30 秒ごとに 1 言ずつフェード切替で表示（既存 `QUOTE_INTERVAL_MS=30s` / `.is-fading` transition は流用）。ローテーション内容は **helper の `GET /quotes` を集約点**にして bot 通知と dashboard ブラウザで完全一致させる:
  - 月〜金: `[きょうの天気, 朝の天気, 夜の天気, 占い, ニュース×1〜3]`
  - 土日:   `[きょうの天気, 占い, ニュース×1〜3]`
  - **helper `/quotes` 集約 (2026-05-29 改修)**: helper (`server/nowplaying-helper.py`) が JST 当日の日付を key に in-memory cache で 1 日 1 回だけ build → 同じ JSON を返す。返り値: `{"date": "YYYY-MM-DD", "weather": [...lines...], "fortune": "...", "news": [...lines...]}`。app.js（ブラウザ）も `bin/dashboard-notify-ren-quotes.py`（bot 通知）も両方 `/quotes` を fetch する **薄いクライアント** に統一。占い random seed / 天気 fetch 時点 / news fetch 時点のズレは helper 側で吸収され、同日中は両者で「同じ占い文 / 同じニュース並び / 同じ天気行」が出る。
  - **天気** (helper 側): Open-Meteo に直接 fetch（app.js の weather パネル fetch とは別系統、helper 単独で fetch して `_wx_band_stats` で時刻帯 match）。平日 3 行 (きょう 6-21 / 朝 7-9 / 夜 18-22) / 土日 1 行 (きょう 6-21)。各行に **降水確率「降水 N%」を温度の次に表示**（傘ワードの根拠を可視化、傘がいらない日でも数字が出る）。服装ワード (`_clothes_phrase`) は slot を問わず「その日の最高気温 = all slot [6,21) の hi」基準で固定判定、傘ワード (`_umbrella_phrase`) は slot ごとの pop_max で判定（朝に傘・夜に傘の時間帯固有の意味を残す）。データ不在時はその一言だけスキップ（cycle は止めない）。
  - **占い（双子座固定）** (helper 側): 日付 (YYYYMMDD) を seed にした Python 標準 `random.Random` で deterministic 生成、phrase pool は helper 内集中管理 (`FORTUNE_LUCK` / `FORTUNE_LEVEL` / `FORTUNE_COLOR` / `FORTUNE_TIP`)。**phrase pool 二重管理は解消**（旧版は app.js と notify script で持っており、Mulberry32 / random.Random で結果がズレていた → 改修で helper 集約 + bot 通知と同一に確定）。**外部 API 無し**（CSP / file:// origin 安全、API key 不要）。星座固定（双子座のみ）、他星座対応は先回り雛形なので不採用。
  - **ニュース** (helper 側): NHK NEWS WEB RSS (`https://www.nhk.or.jp/rss/news/cat0.xml`) を helper が proxy 取得し helper メモリ内 TTL=30 分でキャッシュ（過剰アクセス防止）。`/quotes` は news_items() を流用し「ニュース：<title>」形式で返す。**取得元選定理由**: 認証不要・日本語主要ニュース・公開 RSS・API key 不要。fetch 失敗時は空配列（既存 `/np` と同じ pattern、retry/backoff 無し）。
  - **CORS 回避**: file:// origin から外部 RSS への直 fetch は CORS 制約で弾かれるため helper proxy 1 段で受ける。改修後は天気 / 占い / news が全て helper 集約になったため、ブラウザの quote frame は **外部 API を一切叩かない**（weather パネル用の Open-Meteo fetch は別系統で残置）。
  - **失敗時の振る舞い**: helper unreachable / parse 失敗 / fetch 失敗は該当配列が空（または fortune が空文字）で返る。app.js は queue 空のまま cycle 静止、notify script は exit 0 で抜けて翌日再試行（`.state/last-notify-date` を mark しないため）。retry/backoff は一切持たない（次の起動・次の日付ロールオーバーで再 build）。
  - **/news endpoint の残置**: `GET /news` は app.js から参照されなくなったが、debug 用途で残置（NHK RSS の素データを確認する経路として）。
  - **不採用**: ① 外部 news API への直 fetch（CORS で破綻、helper proxy 1 段で構造的に解決）。② 多自治体・多星座対応の config 化（先回り雛形）。③ 文言 phrase pool の `dashboard-config.js` 分離（先回り雛形、改修後は helper 1 箇所集約で足りる）。
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
- **3 朝連続失敗で再設計判断**: 単発失敗を patch しない（`~/companion/CLAUDE.md` 2 周目ルール準拠、修正効果観察に最低 3 朝必要）。本ルールは「対症療法を打つ前のクールダウン」であり、構造引き直し（軸の置換、例: 2026-05-22 PID→title / 2026-05-25 title→`--kiosk-monitor=1`）には適用しない。
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
├── bin/dashboard-start.sh         # $INVOCATION_ID ガード → 現音量保存 → 音量20%+unmute → slot判定 → mpv(空ならskip) → helper → firefox(--kiosk --kiosk-monitor=1 で HDMI-1 占有) → exec sleep infinity
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
- ツール: mpv 0.34.1 / firefox 151（唯一のブラウザ、`--kiosk` + `--kiosk-monitor <num>` あり。後者は 151 で実装、150 には無い。2026-05-25 更新）/ wmctrl あり（**xdotool 無し**）/ python3 / pactl
- systemd **user** unit: companion-bot / maintenance の通知 timer 群が稼働中。`graphical-session.target` は無い。`systemctl --user show-environment` に `DISPLAY=:0` `XAUTHORITY=~/.Xauthority` `DBUS_SESSION_BUS_ADDRESS` `XDG_RUNTIME_DIR=/run/user/1000` あり。
- x11vnc: システムサービス、`-display :0`、tailscale IP のみ listen、`-noipv6`。壊さない・触らない。
- now-playing helper の待受ポート `47823` は **2 箇所で手書き**: `server/nowplaying-helper.py` の `PORT` と `web/dashboard-config.js` の `nowPlaying.port`。変えるなら両方。
- `loginctl show-user miho` → `Linger=no`（B15）。auto-login で常時 session ありなので実害は薄いが、`loginctl enable-linger miho`（要 sudo・ユーザー端末）は安い保険。
- `xset` / `xdpyinfo` は両方インストール済み（B14 は moot）。ただし `dashboard.service` の X-readiness gate は外部バイナリ非依存の `[ -e /tmp/.X11-unix/X0 ]` を使っている。

## 対症療法 2 周目ルールの先回り（`~/companion/CLAUDE.md` 準拠）
- 音量: 「20% になってない気がする → sleep して再 set / 読み戻し比較で再 set」をしない。`set-sink-volume`+`set-sink-mute` は冪等・同期、1 回で終わり。
- 配置: firefox 自身が `--kiosk --kiosk-monitor=1` で HDMI-1 占有 (2026-05-25〜)。wmctrl 経由の窓同定＋配置は廃止、復活させない。「窓が HDMI-1 に出ない」観測時は polling の再導入ではなく `--kiosk-monitor` 番号体系の再検証＋STATUS への記録から始める。
- プロセス kill: `pkill firefox`/`pkill mpv`/`pkill -f …` は禁止（常用 firefox 巻き込み + `pkill -f` は Bash wrapper 自爆。MEMORY 既出）。cgroup-kill（`systemctl --user stop`）のみ。専用 `--profile <path>` で曖昧さゼロ。
- 天気 fetch: 「timeout/5xx → retry → backoff → cache TTL hack」をしない。「直近成功値（state）を保持、失敗時はそれを表示、通常スケジュールでのみ再試行」。
- slot 判定: 境界時刻の特別扱いをしない。start 時に 1 回確定、途中再評価しない。slot #2 が来たら時計監視ループを足すのではなく `dashboard@<slot>.service` テンプレ化に移行。
- now-playing: mpv IPC は 1 回の connect-or-empty で確定。「mpv 起動待ちで数回リトライ」をしない。
- respawn: `while true; do firefox …; done` 系禁止。`Restart=` 付けない。子が 1 個落ちても残りは degrade、9:00 に cgroup kill で掃除。
- **窓識別＋配置**: firefox `--kiosk --kiosk-monitor=1` で firefox 自身が HDMI-1 占有 (2026-05-25〜)。wmctrl による窓同定＋配置（title 一致 / PID 一致 / WM_CLASS マッチ）は **すべて廃止**。
  - 履歴: WM_CLASS マッチ (~5/15 事故) → PID 一致 (5/16 実装) → title 一致 (5/22 引き直し) → `--kiosk-monitor=1` (5/25 引き直し)。
  - 5/22 で PID 一致から title 一致へ identity 軸を据え直した理由は不変（firefox `--new-instance` の launcher PID と窓 `_NET_WM_PID` が原理的に食い違う）。だが title 一致も「title 反映遅延 race」を抱えており、5/25 朝の本番初回失敗で表面化（journal: `firefox window not found within timeout — leaving as-is`、10s 上限内に `<title>=COMPANION-DASH` が反映されず窓は LVDS-1 座標 1974,153 へデフォルト着地、TV 黒）。
  - polling 数値延長は対症療法 2 周目（ガード規則 § 対症療法 2 周目ルール先回り）。「窓出現＋title 反映」を待つ polling 自体を捨て、placement 軸を firefox 内蔵フラグへ移した。一致 0 件・fallback 連鎖の心配が原理的に消える。
- **2026-05-22 → 2026-05-25 の軸移行履歴**: 5/22 引き直し時に G 系列（`firefox --kiosk --kiosk-monitor=<N>`）を「firefox に存在しない幻のフラグ」として却下したが、これは当時の firefox 150 の `--help` 結果に拠る（Chromium 流儀との混同もあった）。**firefox 151 で `--kiosk-monitor <num>` が実装** されており、2026-05-25 に `firefox --help` で実存確認 + 使い捨て profile で N=0=LVDS-1 / N=1=HDMI-1 の番号体系を実機確定。
  - 5/22 時点の「壊れていたのは placement ではなく identity」判断は当時のフラグ事実に対しては正しい。5/25 時点では placement 軸（firefox 内蔵）が使える状態に変わったため、identity 軸（title）の race を抱えるより placement 軸へ全移行する方が構造的（polling 廃止、軸の置換 1 回で完結、fallback 連鎖なし）。
  - WM(Marco) の「新規窓を primary=LVDS-1 へ再配置」挙動は依然有効。だが --kiosk-monitor=1 で firefox 自身が target monitor を Marco の前段で指定するため、Marco の再配置は当該窓には適用されない（5/25 実機で確認）。

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
- [x] **〔ユーザー〕title 一致引き直しの本番確認** — 2026-05-25 朝 **失敗観測** (5/23 朝 user TV 確認漏れ、5/24 は journal 観察のみで TV 物理確認なし)。5/25 朝 user TV で「ダッシュボード非表示」報告 → journal: `firefox window not found within timeout — leaving as-is`、窓 0x04800003 が LVDS-1 座標 1974,153 へデフォルト着地、TV 黒。title 反映遅延 race が原因。設計引き直し → `--kiosk --kiosk-monitor=1` へ軸移行（次の Done エントリ参照）。
- [x] **〔ユーザー〕`--kiosk-monitor=1` 引き直しの本番確認**: 2026-05-28 朝 user TV 物理確認で機能成功 (Done 詳細参照)。
- [x] **B7 拡張系（v0.2 redesign 用の実機確認）**: B24-B27 を 2026-05-28 朝の本番表示で目視確認、崩れ・違和感なし (Done 詳細参照)。

## In progress

（なし、2026-05-29 セリフ集 helper /quotes 集約 + 降水確率表示 Done 移管完了）

## Done

- 2026-05-29 セリフ集を helper `/quotes` 集約に統一 + 天気各行に降水確率を表示 (orc 経由 implementer)。**ユーザー要望**: 「bot 経由 Telegram 通知と dashboard ブラウザ表示で同じ占い文 / 同じ news 並び / 同じ天気が出るようにしたい。さらに天気各行に降水確率を出して、傘がいらない根拠を読み取れるようにしたい」。旧実装は app.js (Mulberry32 JS) と notify script (random.Random Python) で占いを別実装しており同日でも結果が違った + news も時点ズレで順序がズレる可能性があった。
  - **A. helper `GET /quotes` 新設** (`server/nowplaying-helper.py`): 返り値 `{"date": "YYYY-MM-DD", "weather": [...], "fortune": "...", "news": [...]}` を JST 当日の日付 key で in-memory cache。同日 1 回だけ build → 同じ JSON を返す。日付ロールオーバーで自動再 build（dashboard は 5:30-9:00 運用なので実質起動毎に新規 build）。failure 時は空配列で 200 を返す（既存 `/np` / `/news` と同方針、retry/backoff 無し）。helper に Open-Meteo 直 fetch / NHK RSS proxy（既存）/ 占い deterministic 生成（`random.Random(yyyymmdd seed)`）を集約。phrase pool (`FORTUNE_LUCK` / `FORTUNE_LEVEL` / `FORTUNE_COLOR` / `FORTUNE_TIP`) も helper に集中管理化 → 旧版の app.js / notify 二重管理は解消。
  - **B. 天気行に降水確率「降水 N%」を追加** (`server/nowplaying-helper.py` の `_build_weather_line`): 温度の次に挿入。例 `きょうの天気：最高 28° / 最低 21°、降水 0%、半袖で十分、傘はいらなさそう`。pop_max が None のときは降水パートを省略（温度や服装と同じ扱い）。傘ワードはそのまま残す → 傘ワードの根拠（降水確率の数値）が一目で読み取れる。
  - **C. notify script を helper `/quotes` 利用に書き換え** (`bin/dashboard-notify-ren-quotes.py`): 旧版の Open-Meteo 直 fetch / fortune 生成 / RSS fetch ロジックを全削除し、helper の `/quotes` を fetch して `weather + [fortune] + news` を順に並べて本文を組む。helper port は `dashboard-config.js` の `nowPlaying.port`（regex で抽出、失敗時はデフォルト 47823）。helper unreachable / JSON parse 失敗は stderr に記録して exit 0（本流非干渉、既存原則踏襲）。`.state/last-notify-date` 同日 skip 機構は維持。送信ヘッダ「今朝の ren セリフ集（YYYY-MM-DD (Day) HH:MM）」も維持。
  - **D. app.js の quote frame ロジックを `/quotes` 利用に書き換え** (`web/app.js`): 旧版の `buildWeatherLines` / `_wxBandStats` / `_clothesPhrase` / `_umbrellaPhrase` / `_buildWeatherLine` / `FORTUNE_*` / `_fortuneSeed` / `_mulberry32` / `buildFortuneLine` / `buildNewsLines` / `pollNews` / `NEWS_POLL_MS` / `lastNewsItems` を全撤去（app.js のセリフ枠ロジックは ~180 行縮小）。新規 `fetchQuotes(callback)` で起動時に `/quotes` を 1 回 fetch、`lastQuotesPayload` に保持。`buildQuoteQueue()` は payload から純粋関数で queue を組む。helper unreachable / 空 payload 時は queue 空のままで cycle 静止（`showNext` 早期 return、既存 retry/backoff 無し方針と整合）。**weather パネル** (時間ごと予報 strip / 現在気温 / アイコン / `wx-pop`) は変更なし、Open-Meteo 直 fetch する既存ルート維持（生 hourly 配列が要るため）。
  - **E. helper readiness 待機を dashboard-start.sh に追加** (`bin/dashboard-start.sh`): helper 起動 (`step 4`) と notify 起動 (`step 4.5`) の間に新規 `step 4.4` を挿入。`for _ in $(seq 1 25); do curl -sf -m 0.5 http://127.0.0.1:47823/np >/dev/null 2>&1 && break; sleep 0.2; done` で最大 5 秒の guard。helper 起動直後の race で notify が helper unreachable に落ちて空通知になるのを防ぐ。port 47823 は helper デフォルトを hardcode（コメントで「変えたら追従必要」と記録）。
  - **対症療法 2 周目ガード非該当**: 既存条件分岐・閾値・fallback の追加延長ではなく、責務再配置（app.js / notify 両側で持っていた weather / fortune / news 計算ロジックを helper 1 箇所に集約）。failure 経路は「helper 失敗 = 空配列を 200 で返す → クライアントは queue 空で静止 or exit 0」の 1 段確定で fallback 連鎖なし。`~/companion/CLAUDE.md` 2 周目ルール準拠。
  - **動作確認**:
    - **/quotes 単体**: helper 手動起動 → `curl -sf -m 12 http://127.0.0.1:47823/quotes | python3 -m json.tool` で `date / weather (3 行、平日) / fortune (1 行) / news (3 行)` の JSON が返却。各 weather 行に「降水 N%」が温度の次に入ることを目視確認 (例: `きょうの天気：最高 28° / 最低 21°、降水 0%、半袖で十分、傘はいらなさそう`)。
    - **cache 同一性**: 同 helper に 2 回叩いて `diff` で 0 行（同一 JSON）。
    - **notify 単体**: `.state/last-notify-date` 削除後に notify 実行 → `dashboard-notify: sent (321 bytes) for 2026-05-29` + state file 作成。2 回目実行で `already sent for 2026-05-29, skipping`。
    - **bot socket 不在ケース**: `XDG_RUNTIME_DIR=/tmp/nonexistent-dashboard-test` で notify → stderr `bot socket send failed: [Errno 2] No such file or directory` + exit 0 + state file 作られず（次回再送可能経路）。
    - **helper unreachable ケース**: helper kill 後に notify → stderr `helper /quotes fetch failed: <urlopen error [Errno 111] Connection refused>` + `no lines built (helper unreachable or empty), skipping` + exit 0。
    - **notify body と /quotes の完全一致**: notify の `build_message` 出力と `curl /quotes` 出力を並べて、weather 3 行 / fortune 1 行 / news 3 行が一字一句同じであることを確認。
    - **helper readiness ループ単体**: ① helper 立てない状態でループ → 約 6 秒で抜ける (25 × 0.2s sleep + curl connection-refused は即返、5s 弱の guard 動作)。② 別 shell で 0.6 秒後に helper を起動するジョブを仕込んでループ → 約 1.35 秒で抜ける（helper 起動を検知して即先に進む）。
    - **app.js payload → queue 変換**: node 単体で `buildQuoteQueue(payload)` を実行、平日 payload で queue length 7、土日 payload で 3、null / 空 payload で 0 を確認。
    - **syntax check**: `python3 -m py_compile server/nowplaying-helper.py` pass、`python3 -m py_compile bin/dashboard-notify-ren-quotes.py` pass、`bash -n bin/dashboard-start.sh` pass、`node -e "new Function(fs.readFileSync('web/app.js'))"` pass。
  - **設計判断の記録**:
    - **/news の残置**: `GET /news` endpoint は app.js から呼ばれなくなったが、debug 用途で残置（NHK RSS 素データを確認する経路）。撤去は別タスクで実施可能、本改修では非干渉に倒した。
    - **port 47823 の重複**: helper port は `dashboard-config.js` の `nowPlaying.port`（regex で抽出、notify 側）、helper Python の `PORT = 47823` （helper 自身）、dashboard-start.sh の readiness ループ（curl URL 内 hardcode）の 3 箇所で並ぶ。shell から JS を読むのは煩雑なため readiness ループは helper のデフォルトを hardcode で受ける（dashboard-config.js の値を変えるなら helper Python の PORT 定数と shell の URL 両方を追従させる必要、既存と同じ重複構造）。
    - **fortune phrase pool の helper 集約**: 旧版は app.js と notify で別の pool を持っており、文言追加時に両方更新する drift リスクが残っていた。helper 集約で 1 箇所更新で全クライアントに反映される構造に転換（drift の構造的解消）。
    - **`lastWeatherData` 撤去**: app.js のセリフ枠が `lastWeatherData` を使わなくなったので変数自体を撤去。weather パネル描画用には `renderWeather` が直接 data を受け取って描画するため影響なし。
  - **意図との差分**: 委任時の意図と異なる対応はなし。
  - **commit**: 1 論理単位 = 「セリフ集 helper 集約 + 天気行に降水確率追加」を 1 commit にまとめる（helper / notify / app.js / start.sh / STATUS.md の 5 ファイル）。push は orc / ユーザー側で実施 (implementer は commit 止め)。
  - **残**: 〔ユーザー〕 ① helper の手動再起動 (memory 常駐のためコード変更を反映するため `pkill -f 'python3.*nowplaying-helper'` ではなく PID 直 kill + 手動 `python3 server/nowplaying-helper.py &`、または `systemctl --user restart dashboard.service` で次回 5:30 起動時に新コードが乗る)。② 実機 TV (HDMI-1 1920x1080i) で `systemctl --user restart dashboard.service` 後にセリフ枠の rotation を目視確認（各 weather 行に「降水 N%」が入ること、`[きょうの天気, 朝の天気, 夜の天気, 占い, ニュース×3]` の順で 30s 切替）。③ 明朝 2026-05-30 (土) 05:30 発火時の Telegram #maintenance 通知本文が `[きょうの天気, 占い, ニュース×1〜3]` の土日パターンで届くか確認、ブラウザ表示と同一であることも確認。

- 2026-05-28 `--kiosk-monitor=1` 本番確認 + B7 拡張系 (B24-B27) 実機確認 完了。
  - **`--kiosk-monitor=1` 本番確認**: 2026-05-28 朝 user TV 物理確認で機能成功。5/26 引き直し以降 3 朝 (5/26 / 5/27 / 5/28) を含めた本番運用で TV に dashboard が全画面表示されることを確定。journal `firefox launched (kiosk on monitor 1 = HDMI-1)` 1 行で成功。L113「3 朝連続失敗」ルール不発動。`--kiosk-monitor=1` への軸移行 (placement 軸、polling 廃止、fallback 連鎖なし) が想定通り機能。
  - **B7 拡張系 (B24-B27)**: 同朝の TV 表示で崩れ・違和感なし。B24 fold 高さ (~696px 予測) / B25 vignette 中心 `50% 40%` 端部視認性 / B26 `.gb-when` 日本語+ASCII 混在見た目 / B27 Noto Sans CJK JP weight 700 スナップ表示、いずれも目視 OK で `.gb-when` の `var(--font-body)` 切替・vignette 中心調整等の追加対応は不要。

- 2026-05-28 天気予報セリフ枠の改修 3 件 (orc 経由 implementer)。
  - **A. 平日セリフに「1 日の天気」を頭出しに追加**: 平日 = `[きょうの天気, 朝の天気, 夜の天気, 占い, ニュース×3]` (4→5 行)、土日は現状維持 `[きょうの天気, 占い, ニュース×3]`。`web/app.js` の `buildWeatherLines` 並び順を変更 (all → morning → evening) + 冒頭コメント更新、`bin/dashboard-notify-ren-quotes.py` の同等関数も同順に変更 + docstring 更新。
  - **B. 服装ロジックを「その日の最高気温」基準に統一**: 朝枠 (hi=20°) でも夜枠 (hi=22°) でも、服装ワード (`_clothesPhrase` / `_clothes_phrase`) はその日の最高気温 = all slot [6,21) の hi (= `dayHi` / `day_hi`) で固定判定。気温の数値表示は slot ごとの hi/lo を維持 (朝枠なら「最高 20°」)、傘ワードも slot ごとの pop_max を維持 (朝に傘・夜に傘の時間帯固有の意味を残す)。`_buildWeatherLine` / `_build_weather_line` のシグネチャに `dayHi` / `day_hi` 引数を追加し、呼び出し側 (`buildWeatherLines` / `build_weather_lines`) が all band stats を先に算出して全 line builder に渡す責務分担。閾値・文言は据置 (一般成人女性の標準体感、寒がりではない想定)。
  - **C. データソースは Open-Meteo を継続採用**: JMA `forecast/230000.json` (愛知県) を実機で 200 OK + ACAO:* 確認したが、データ粒度が現行 UI と不整合のため不採用。具体的には: ① 短期予報の気温 timeSeries は 4 ポイント (今日 9 時 / 24 時 / 明日 9 時 / 18 時) で、現行 `_wxBandStats` が前提とする「1 時間単位 hi/lo 集約」が出来ない。② 降水確率は 6h 区切り 7 ポイントで、`[7,9) / [18,22) / [6,21)` の半開区間集約と整合しない。③ 天気概況も「今日午前 / 今日午後」の 2 ポイントで時間ごと予報 strip (6/9/12/15/18/21 時 6 スロット) の再構築には別データ源 (時系列予報) が要る → 切替えは hourly strip / band stats ロジックを大幅作り直し = 設計引き直し級の作業に発展 (`~/companion/CLAUDE.md` 2 周目ガード抵触懸念)。④ Open-Meteo は名古屋粒度で JMA データを取り込んだブレンドモデル、1.5 ヶ月運用実績で安定。⑤ 「精度向上」のユーザー要望は本タスク B (服装の最高気温基準化) でカバーできる範囲が大きい。判断: Open-Meteo 継続 + 切替えはセリフ精度の追加観察結果が出てから別タスクで設計。
  - **対症療法 2 周目ガード非該当**: 既存条件分岐・閾値・fallback の追加延長ではなく、責務分担の引き直し (`buildWeatherLines` 側で all band stats を 1 回算出して line builder に dayHi として渡す = 引数化)。服装/傘の判定条件は据置、新規 case 追加・stderr 文言マッチ無し。`~/companion/CLAUDE.md` 2 周目ルール準拠。
  - **動作確認**:
    - `python3 -m py_compile bin/dashboard-notify-ren-quotes.py` pass。
    - app.js 単体 (node vm): 平日 (dow=4=木) `buildWeatherLines()` で `[きょうの天気, 朝の天気, 夜の天気]` 3 行を順に返却、朝枠 (slot hi=20°) で `dayHi=26` 渡しのとき「半袖で十分」が出ること、夜枠 (slot hi=22°) でも同様に「半袖で十分」が出ることを確認。`dayHi=null` で服装パート省略・slot ごと hi/lo 表示は残ることも確認。
    - app.js 単体 (土日強制 `Date.getDay()=6`): `buildWeatherLines()` が `[きょうの天気]` 1 行のみ返却を確認。
    - notify 単体 (python): `_wx_band_stats` で `morning {hi:20,lo:20,pop_max:10}` / `all {hi:26,lo:19,pop_max:60}` / `evening {hi:22,lo:22,pop_max:60}` を返却、`_build_weather_line` が `dayHi=26` 渡しで朝枠 / 夜枠とも「半袖で十分」を含む文字列を生成。平日 `build_weather_lines(dt(2026-05-28))` で 3 行・土日 `build_weather_lines(dt(2026-05-30))` で 1 行・data 不在で空 list を確認。
    - `build_message` 統合 (平日 mock fetch_weather + mock news): 1 通本文に `きょうの天気 → 朝の天気 → 夜の天気 → 占い → ニュース×3` の 7 行が並ぶ。
    - JMA endpoint 検証: `curl -sI https://www.jma.go.jp/bosai/forecast/data/forecast/230000.json` で `HTTP/2 200` + `access-control-allow-origin: *` + `cache-control: max-age=60`、ペイロード 3.1KB。entry[0] timeSeries が `天気概況 (2pt) / 降水確率 (7pt, 6h刻み) / 気温 (4pt, 名古屋地点)` という粒度であることを実 JSON で確認。
  - **意図との差分**: 委任時の意図と異なる対応はなし。データソースは委任の独断 OK 範囲で Open-Meteo 継続を選択 (理由は上述、判断根拠は本 Done に記録)。
  - **commit**: 1 論理単位 = 「天気予報セリフ枠 3 件改修 (平日 1 日天気追加 + 服装 dayHi 基準化 + データソース調査)」で 1 commit。push は orc / ユーザー側で実施 (implementer は commit 止め、dashboard repo は remote `mooneclipse/companion-dashboard` あり)。
  - **残**: 〔ユーザー〕実機 TV (HDMI-1 1920x1080i) で `systemctl --user restart dashboard.service` 後にセリフ枠が `[きょうの天気, 朝の天気, 夜の天気, 占い, ニュース×3]` の順で 30s 切替で回ることを目視確認。明朝 2026-05-29 05:30 発火時の Telegram #maintenance 通知本文も同順で届くか確認 (本 Done の通知本文サンプルは平日 mock データ)。

- 2026-05-28 5:30 dashboard 起動時に「今朝の ren セリフ集」を bot 経由で Telegram #maintenance topic に silent 通知する機能を追加。orc 経由 implementer。**ユーザー要望**: 「ダッシュボードに表示される ren のセリフを 5:30 dashboard 起動時にその朝の分まとめて 1 通として bot 経由で Telegram #maintenance topic に silent 通知してほしい」。Phase 2.6 cold cut 直後で bot 側は安定運用中につき bot 側コードは無改修、既存 Unix socket 通知経路（`$XDG_RUNTIME_DIR/companion-bot.sock`）流用で完結。
  - **新規スクリプト追加** (`bin/dashboard-notify-ren-quotes.py`): Python 3 単独スクリプト、`#!/usr/bin/env python3` shebang + executable。`dashboard-start.sh` から `&` でバックグラウンド起動される想定。内部で「全例外を最上位で握って exit 0」を実装、dashboard 本流（mpv / firefox / sleep infinity）を倒さない。
    - **セリフ内容**: 平日 = `朝の天気 + 夜の天気 + 占い + ニュース×3`、土日 = `きょうの天気 + 占い + ニュース×3`。web/app.js のセリフ枠ロジックと同等概念（時点ズレ可、同じ意図のセリフが届けば成功条件を満たす）。天気は朝 [7,9) / 夜 [18,22) / 一日 [6,21) の半開区間で、`_clothes_phrase` / `_umbrella_phrase` は web/app.js の閾値と文言を完全一致で Python 移植。占いは日付 seed の Python 標準 `random.Random` で deterministic 生成（双子座固定、phrase pool は app.js と同一文言）。Mulberry32 / JS 32bit 演算との bit-exact 一致は不要（同日同じ結果で deterministic ならよい）。
    - **天気 fetch**: Open-Meteo (`https://api.open-meteo.com/v1/forecast`) に直接 fetch、`web/dashboard-config.js` から `lat` / `lon` / `tz` を正規表現で抽出。timeout 4 秒、失敗は天気行スキップ。app.js と同じパラメータ（hourly=temperature_2m,weather_code,precipitation_probability + current + timezone + forecast_days=1）。
    - **ニュース fetch**: NHK NEWS WEB 主要ニュース RSS (`https://www.nhk.or.jp/rss/news/cat0.xml`) に直接 fetch + ElementTree parse、最大 3 件抽出（server/nowplaying-helper.py と同方針）。timeout 3 秒。helper の `/news` は dashboard helper として 30 分 TTL キャッシュを持つが、bot 通知は 1 日 1 通なので helper キャッシュは経由せず直接 fetch する設計（5:30 時点で helper が起動しているかは race condition で不確定 + helper 経由にする実利がない）。
    - **bot socket 投入**: `socket.AF_UNIX` で `$XDG_RUNTIME_DIR/companion-bot.sock` に connect、UTF-8 で本文送信後 `shutdown(SHUT_WR)` で EOF を送って bot 側に転送確定させる。`[critical] ` プレフィクスは付けない（silent default の希望どおり）。timeout 3 秒、失敗時は stderr に 1 行記録して `mark_sent_today` を呼ばずに exit 0（次回起動で再試行可能）。
  - **dashboard-start.sh 改修** (`bin/dashboard-start.sh`): step 4 (now-playing helper 起動) と step 5 (firefox 起動) の間に新規 step 4.5 を挿入。`python3 "$DASH_DIR/bin/dashboard-notify-ren-quotes.py" &` でバックグラウンド起動。`set -e` は元々全体掛けしていないため、新規追加部分も他ステップと同様に独立で扱う。header コメントのシーケンス行も更新。
  - **重複防止**: `.state/last-notify-date` に YYYY-MM-DD（JST）を書き、同日内の再起動では skip。**判断根拠**: 「毎回送る」/「1 日 1 通制限」のどちらでも成功条件を満たすが、観察期間中に手動 `systemctl --user restart dashboard.service` を 1 日に複数回行ったとき #maintenance topic に同じセリフ集が複数届くと過剰（topic を眺める user の体験悪化）。1 日 1 通に倒し、強制再送したい場合は `.state/last-notify-date` を削除すればよい運用に統一。送信失敗時は mark しないので次回 dashboard 起動で再送される。
  - **failure isolation**: ① スクリプト自身は全例外を try/except で握って常に exit 0、② dashboard-start.sh からは `&` でバックグラウンド起動、③ bot socket 不在 / Open-Meteo タイムアウト / NHK RSS タイムアウト / parse 失敗 すべて degraded mode で進む（取れた sub-source だけで build、占いは無条件で出るので最低 1 行は確保）、④ 全 sub-source 空なら body=None で送信せず終わる。dashboard 本流（mpv / firefox / sleep infinity）に影響なし。
  - **動作確認**:
    - `python3 -m py_compile bin/dashboard-notify-ren-quotes.py` pass、`bash -n bin/dashboard-start.sh` pass。
    - 単体実行: `python3 bin/dashboard-notify-ren-quotes.py` → stdout `dashboard-notify: sent (255 bytes) for 2026-05-28` + bot.log に `notify forwarded len=255 critical=False` + Telegram #maintenance topic に 1 通受信（実機目視は orc 経由）。
    - 重複防止確認: 同条件で 2 回目実行 → `dashboard-notify: already sent for 2026-05-28, skipping` で送信せず exit 0。
    - socket 不在ケース: `XDG_RUNTIME_DIR=/tmp/nonexistent-dir python3 bin/dashboard-notify-ren-quotes.py` → stderr に `bot socket send failed: [Errno 2] No such file or directory` + exit 0 + `.state/last-notify-date` 作られず（次回再送可能経路）。
    - degraded build: 内部で `_fetch_weather=lambda: None` + `build_news_lines=lambda: []` に差し替え → 占い 1 行のみで body 構築成功。さらに `build_fortune_line` も例外化 → body=None で送信せず exit 0。
    - 平日/土日分岐: 木曜の `build_weather_lines` で `[朝の天気, 夜の天気]` の 2 行、`_wx_band_stats` が朝 [7,9) で `{'hi':20.1,'lo':20.0,'pop_max':19}` / 夜 [18,22) で `{'hi':22.1,'lo':21.8,'pop_max':20}` / 一日 [6,21) で `{'hi':22.4,'lo':19.7,'pop_max':24}` を返すことを確認。土日コードパスは「`now.weekday() >= 5` で `きょうの天気` 1 行」を build_weather_lines 内で分岐実装。
    - **送信本文サンプル** (2026-05-28 木 01:04 実行):
      ```
      今朝の ren セリフ集（2026-05-28 (Thu) 01:04）

      朝の天気：最高 20°, 長袖シャツで, 傘はいらなさそう

      夜の天気：最高 22°, 長袖シャツで, 傘はいらなさそう

      きょうの双子座：健康運が穏やか。ラッキーカラーは青。誰かに一言「ありがとう」を伝えてみよう。

      ニュース：大阪地検特捜部の特別公務員暴行陵虐事件 検事側が無罪主張へ

      ニュース：「国家情報局」設置法 成立 政府のインテリジェンス機能強化へ

      ニュース：皇位継承 衆参議長・副議長が会談 “幅広い賛同を”認識共有
      ```
  - **対症療法 2 周目ガード非該当**: 既存条件分岐・閾値・fallback の追加・延長ではなく、初出の新規スクリプト追加 + dashboard-start.sh に 1 行 step を挿入。failure 経路は「失敗 = 送らず exit 0」の 1 段確定で fallback 連鎖なし。`~/companion/CLAUDE.md` 2 周目ルール準拠。
  - **設計判断の記録**:
    - **phrase pool 二重管理**: web/app.js の `FORTUNE_LUCK` / `FORTUNE_LEVEL` / `FORTUNE_COLOR` / `FORTUNE_TIP` を Python 側でも保持しており、pool 更新時は両方追従が必要。bot 通知用に「同じ意図のセリフが届けば成功条件を満たす」前提（committee 受け取りの「セリフ内容は web/app.js のセリフ枠ロジックと同等概念」）に従い、phrase pool 単一管理化は将来の選択肢（dashboard-config.js に分離 or JSON 化）として残置。これ自体は新規実装 1 周目につき対症療法 2 周目ガード非該当だが、将来 pool 更新が両側に同期されない drift が起きたら根本対策（単一管理化）を検討する。
    - **socket 経路独立**: bot 通知 helper (`nowplaying-helper.py` の `/news`) を経由せず、Python 側で NHK RSS を直接 fetch する選択。理由: 5:30 時点で `now-playing helper` の起動が race condition で先か後か不確定 + helper キャッシュ 30 分の効きは 1 日 1 通には不要 + 経由するとさらに HTTP 1 段増えて failure path も増える。
    - **重複防止 = 1 日 1 通制限**: 上述「判断根拠」参照。手動 restart で過剰送信を防ぐ方針を選択。
  - **意図との差分**: 委任時の意図と異なる対応はなし。
  - **commit**: `bin/dashboard-notify-ren-quotes.py` 新規 + `bin/dashboard-start.sh` 改修 + `docs/STATUS.md` Done 反映を 1 commit (1 論理単位 = 「ren セリフ集 Telegram 通知追加」)。push は orc / ユーザー側で実施 (implementer は commit 止め、dashboard repo は remote `mooneclipse/companion-dashboard` あり)。
  - **残**: 〔ユーザー〕明朝 2026-05-29 05:30 発火で Telegram #maintenance topic に「今朝の ren セリフ集」が 1 通 silent で届くかの実機確認（本台帳 L113 ルールの 3 朝連続観察対象）。

- 2026-05-27 セリフ枠下端に 30 秒切替メーターを追加（細い進捗線）。orc 経由 implementer。**ユーザー要望**: 「ren のセリフが切り替わるタイミングがわかるような 30 秒のメーターがほしいかも、細い線でも円でもいいから」(2026-05-27 夜) → orc 経由で形式確定「セリフ枠下端の細い横線」を採用。industrial-refined v0.2 トーン親和性が高い案。
  - **HTML 追加 1 要素** (`web/index.html`): `.quote` 内の `#quote-text` の弟として `<div class="quote-progress" id="quote-progress" aria-hidden="true"><span></span></div>` を 1 行追加。`<span>` を中に入れて parent の border-radius / padding と独立に width 0→100% アニメをかけられる構造。
  - **CSS 追加** (`web/style.css`): ① `.quote` を `position: relative` + `flex-direction: column` + `justify-content: center` + `overflow: hidden` に変更（progress 線を下端絶対配置するための土台 / セリフ本文は引き続き縦中央 / 下端線が border-radius を越えないように clip）。② 新規 `.quote-progress { position:absolute; left/right/bottom:0; height:1.5px; background: rgba(243,184,95,0.12) }` (accent の薄い下敷き track) + `.quote-progress > span { display:block; height:100%; width:0; background: var(--accent) }` + `.quote-progress.is-running > span { animation: quote-progress 30s linear forwards }` + `@keyframes quote-progress { from { width:0 } to { width:100% } }`。
  - **JS ロジック追加** (`web/app.js`): セリフ IIFE 内に `progressEl = $('quote-progress')` 取得 + `restartProgress()` 関数を新設。`restartProgress` は `classList.remove('is-running')` → `void offsetWidth` (reflow 強制) → `classList.add('is-running')` の 3 段で、同名 class 再付与だけだと再開しないブラウザ仕様への対処。初回起動時 + `setInterval` callback 冒頭（fade-out 前）で呼び、setInterval の 30s 周期と progress の 30s animation を完全同期 (drift しない)。`progressEl` 不在時 (HTML 退化ケース) は早期 return で本流不変。
  - **触らない範囲は完全無改修**: ① `QUOTES` build ロジック (`buildQuoteQueue` / `_clothesPhrase` / `_umbrellaPhrase` / `buildFortuneLine` / `buildNewsLines`) / 天気/占い/ニュース fetch / cycle 順序 ([朝の天気, 夜の天気, 占い, ニュース×3] 等)。② セリフ fade 320ms (`.quote-text.is-fading` transition + `QUOTE_FADE_MS`) は据置。③ 他 5 セル (時計 / 天気 / ごみ / 再生中の曲 / 空欄) は無改変。④ キャラ SVG / 瞬き&目線 / 体の揺れ keyframes (`cmp-*`, `cmp-sway`, `cmp-breathe`) も無関係。⑤ `dashboard-config.js` 無関係。差分 stat: `web/app.js` +13 / `web/index.html` +3 -1 / `web/style.css` +30 -2 で局所化を確認。
  - **対症療法 2 周目ガード非該当**: 既存条件分岐・閾値・fallback の追加延長ではなく、初出の進捗線 1 要素追加 + 単純な class toggle 1 回で完結。fallback 連鎖なし、`progressEl` 不在は 1 段で early return 確定。`~/companion/CLAUDE.md` 2 周目ルール準拠。
  - **動作確認**:
    - firefox 151 ヘッドレスで原本 `file:///home/miho/companion/dashboard/web/index.html` を 1920x1080 起動 → スクリーンショット (`/tmp/dashboard-progress-check/t0.png`) で 6 セル全て無改変描画を確認 (時計 21:41 / 天気 18° くもり時々晴れ / ごみ きょう(水)プラ容器 / キャラ + セリフ「双子座: 金銭運が好調」/ now-playing 空 / 空欄)、セリフ枠の border-left オレンジ + border-radius 維持。
    - 進捗線の途中 width 観察: アニメ途中状態をヘッドレスで撮るための test HTML (`/tmp/dashboard-progress-check/test-progress-states.html`) で `animation-delay: -8s` / `-30s` を使い 0% / ~26% / 100% の 3 状態を 1 画像 (`/tmp/dashboard-progress-check/t-states.png`) で並列確認 → 線が左から右へ accent オレンジで伸びることを目視確認 (t=0: 描画なし / t=8s: ~26% / t=30s: 100%)。`.quote` の `position:relative` + `overflow:hidden` で枠の border-radius を線が越えないことも同時確認。
    - JS の class toggle 経路: node 単体 (`/tmp/dashboard-progress-check/test-restart.js`) で `restartProgress` をモック DOM に対して 2 回呼び、毎回 `remove:is-running → reflow → add:is-running` の 3 イベントが出ることと、`progressEl=null` 時に throw せず no-op で抜けることを確認。
  - **既存セリフ fade との整合**: `setInterval` callback の最初に `restartProgress()`、その直後に `el.classList.add('is-fading')` を呼ぶ順序で、progress は新サイクルを 0% から再カウント開始、セリフ本文は 320ms かけて opacity 0→ 差替え → 1。fade 中に progress が 0% から動き始める仕様で、線とテキストが独立に進む。`~/companion/CLAUDE.md` 対症療法 2 周目ルールの「外部呼び出しの成否判定は 1 回で確定」原則どおり、setInterval 1 周ごとに progress reset 1 回で確定する設計。
  - **commit**: `web/index.html` + `web/style.css` + `web/app.js` + `docs/STATUS.md` Done 反映を 1 commit (1 論理単位 = 「30 秒メーター追加」)。push は orc / ユーザー側で実施 (implementer は commit 止め)。
  - **残**: 〔ユーザー〕実機 TV (HDMI-1 1920x1080i) 目視 → **2026-05-27 21:50 pass** (orc 経由、手動 `systemctl --user restart dashboard.service` 後に確認)。ユーザー評「めっちゃいい」。線の太さ 1.5px / 色 `var(--accent)` / 透明度 0.12 track / 30s 同期リセットすべて実機で違和感なし、CSS 数値の再調整は不要。code-reviewer 軽微提案 1 件 (`.quote-progress > span` の `transform-origin: left center;` は width animation に効かないデッドコード) は実害ゼロにつき独断見送り、次回 CSS を触る機会に併せる。

- 2026-05-27 レイアウト v3 微調整: 周囲余白 + 時計/天気のセル内中央寄せ（v3.1）。orc 経由 implementer。**ユーザー報告 2 点**: ①「周囲の余白がない」(2026-05-27 夜の TV 実機目視) / ②「時計と今日の天気のやつはセル内の中央がいいかも」。industrial-refined v0.2 トーン (`#28323f` 地・accent `#f3b85f`・Josefin Sans / DM Sans / Noto Sans CJK JP・ビネット) は維持。
  - **CSS 微調整のみ** (`web/style.css`): ① `.dashboard` の `padding: 40px 70px` → `64px 110px` (TV 1080i overscan 上下〜40 / 左右〜60px + 視覚的余白の両立、ベゼル付近まで詰めない)。② 時計セル: `.cell-clock` を `align-items: flex-start` → `center`、`.clock` 内側も `align-items: flex-start` / `text-align: left` → `center` / `center` で `hh:mm` + 日付ブロックをセル内中央 (水平・垂直) へ。③ 天気セル: `.cell-weather` を `justify-content: stretch; align-items: stretch` に、`.weather` を `display: flex` → `display: grid; grid-template-rows: 1fr auto; flex: 1` で「1 行目=今日の天気ブロックを縦中央 / 2 行目=hourly strip を下端固定」を実現。`.weather-now` には `align-items: center; justify-content: center; align-self: center` を追加して 1 行目セル内中央へ。
  - **HTML/JS は無改修**: `web/index.html` の 6 セル DOM 配線・id (wx-*, gb-*, np-text, companion, hh/mm/date, wx-hourly) は全て据置。`web/app.js` のセリフ枠ローテーション・天気 fetch・now-playing polling・キャラ瞬き&目線も無改修。`dashboard-config.js` も無改修。
  - **触らないセルは無改変**: (2,L)ごみ予告 / (2,R)キャラ+セリフ / (3,L)再生中の曲 / (3,R)空欄 の 4 セルは CSS 改修の波及範囲外で確認 (差分 grep で `.cell-clock` / `.cell-weather` / `.weather` / `.weather-now` / `.dashboard` のみに変更が局所化)。
  - **動作確認**: firefox 151 ヘッドレスで `file:///home/miho/companion/dashboard/web/index.html` を 1920x1080 起動 → スクリーンショット (`/tmp/dashboard-v3.1-after.png`) で 6 セル目視: 時計「20:14」+ 日付「5月27日 (水)」が時計セル内で水平・垂直中央配置 / 天気セル「21° 霧雨 ↑24° ↓18° 降水 78%」が縦中央配置 + 3 時間ごと予報 strip (6/9/12/15/18/21 時) が同セル下部に配置 / グリッド外周に控えめな余白 (左右 110px + 上下 64px) / 他 4 セル (ごみ「きょう (水) プラ容器」/ キャラ + セリフ「双子座: 金銭運が好調」/ 再生中の曲 / 空欄) は無改変で 1080 fold 圏内に収まる。
  - **対症療法 2 周目ガード非該当**: 既存の条件分岐・閾値・fallback の追加・延長ではなく、初出の余白追加 + 中央寄せ。`.weather` の `display: flex` → `grid` への置換も「責務を grid の 2 行分割で 1 回確定」する設計改善で、`~/companion/CLAUDE.md` 2 周目ルール準拠。
  - **commit**: `web/style.css` 余白追加 + 時計/天気中央寄せ + `docs/STATUS.md` v3.1 Done 反映を 1 commit (1 論理単位)。push は orc / ユーザー側で実施 (implementer は commit 止め)。
  - **残**: 〔ユーザー〕実機 TV (HDMI-1 1920x1080i) 目視 → **2026-05-27 21:34 pass** (orc 経由、手動 `systemctl --user restart dashboard.service` 後に確認)。padding 64px 110px / 時計セル中央 / 天気セル縦中央 + hourly 下端固定すべて実機で違和感なし、padding 値 / grid 行比 / vw 値の再調整は不要。code-reviewer 軽微提案 1 件 (`.cell-weather { justify-content: stretch; ... }` は flex 主軸で invalid value、`align-items: stretch` のみで十分) は実害ゼロにつき独断見送り、次回 CSS を触る機会に併せる。

- 2026-05-27 セリフ枠（`#quote-text`）を偉人の名言ループから動的内容（天気・占い・ニュース）へ置換。orc 経由 implementer。
  - **ローテーション仕様**: 30 秒ごとに 1 言ずつフェード切替。月〜金=`[朝の天気, 夜の天気, 占い, ニュース×1〜3]` / 土日=`[一日の天気, 占い, ニュース×1〜3]`。cycle 末尾まで来たら次 cycle で再 build（天気・ニュースの最新値を反映）。既存 `QUOTE_INTERVAL_MS=30*1000` / `QUOTE_FADE_MS=320` / CSS `.quote-text.is-fading` は流用、CSS は無改修。
  - **天気の文言ロジック** (`web/app.js`): `fetchWeather()` の成功 / localStorage 復帰時に `lastWeatherData` へ保持し、cycle build 時に `_wxBandStats(baseDate, hourFrom, hourTo)` で時刻帯 match（朝 7-9 / 夜 18-22 / 一日 6-21）→ hi/lo/popMax を集約 → `_clothesPhrase` (≥30/25/20/15/10/5/`<5`) + `_umbrellaPhrase` (≥70/50/30/`<30`) で組み立て。**新規 API call ゼロ**（既存毎時 fetch の再利用）。データ不在は該当行スキップ（cycle 全体は止めない）。
  - **占いロジック** (`web/app.js`): 日付 (YYYYMMDD) を seed にした Mulberry32 で deterministic 生成、双子座固定。phrase pool は `FORTUNE_LUCK(8)` / `FORTUNE_LEVEL(5)` / `FORTUNE_COLOR(12)` / `FORTUNE_TIP(8)` の組み合わせ。**外部 API 無し**（CSP / file:// origin / CORS いずれも回避）。node 単体検証で同日 deterministic / 翌日変化を確認。
  - **ニュース proxy** (`server/nowplaying-helper.py`): NHK NEWS WEB RSS (`https://www.nhk.or.jp/rss/news/cat0.xml`) を `urllib.request` + `xml.etree.ElementTree` で fetch + parse、`<item><title>` を最大 3 件抽出。`GET /news` で `{"items": [...]}` を返す（ACAO:* 付き）。helper メモリ内 TTL=30 分キャッシュ。fetch / parse 失敗時は `{"items": []}` を 200 で返す（既存 `/np` の「失敗=正常状態を 200 で返す」原則と整合、retry/backoff 無し）。**取得元選定理由**: 認証不要・日本語主要ニュース・公開 RSS・API key 不要。
  - **CORS 回避**: file:// origin → 外部 RSS 直 fetch は CORS で破綻するため、helper proxy 1 段で受ける（既存 `/np` と同 pattern）。「外部 news API 直接 fetch」案は不採用として確定アーキ section に記録。
  - **client 側ポーリング**: ニュースは起動直後 + 1 時間ごとに `/news` を fetch、`lastNewsItems` に保持。失敗時は前回値保持（client 側 retry/backoff 無し）。helper キャッシュ 30 分 × client 1 時間で外部 RSS への過剰アクセス防止。
  - **既存機能への影響ゼロ**: 時計・天気パネル・3 時間ごと予報 strip・ゴミ予告・now-playing・キャラ瞬き&目線は一切無改修。`fetchWeather` の成功 hook に `lastWeatherData = j;` の 2 行追加のみ（renderWeather の挙動は不変）。
  - **動作確認**:
    - `python3 -m py_compile server/nowplaying-helper.py` pass。
    - helper 起動 + curl: `/news` が 200 + ACAO:* + `{"items":[...]}` で 3 件返却（NHK RSS 実 fetch 成功、Content-Length 279）。`/np` は mpv 不在で `{"playing":false}` 200。`/unknown` は 404。
    - node 単体テスト: 占い deterministic OK（同日 run1==run2、翌日 run≠）、`_clothesPhrase` 全境界（30/24/10/5/null）OK、`_umbrellaPhrase` 全境界（80/55/30/10/null）OK。
    - node 統合テスト: 水曜=朝/夜 2 件 + 占い + ニュース 3 件 = 6 言 / 土曜=一日 1 件 + 占い + ニュース 3 件 = 5 言 を正しく build。news 不在時は news 行をスキップして cycle 継続。
  - **対症療法 2 周目ガード非該当**: 既存ロジック（fetchWeather / now-playing polling）に条件分岐・閾値追加なし。セリフ枠の責務追加 1 回で完結、fallback 連鎖なし（helper 失敗→client 失敗→該当言スキップ、で 1 段確定）。
  - **commit**: ① `server/nowplaying-helper.py` に `/news` 追加（NHK RSS proxy） ② `web/app.js` のセリフ枠を動的化（天気・占い・ニュース） ③ `docs/STATUS.md` に確定アーキ追記 + Done 反映。push は orc / ユーザー側で実施（implementer は commit 止め）。
  - **残（〔ユーザー〕実機作業）**: 実機 TV 目視 → **2026-05-27 21:34 pass** (orc 経由、手動 `systemctl --user restart dashboard.service` 後に確認)。夜帯 [18,22) で `[朝の天気, 夜の天気, 占い, ニュース×3]` が 30s フェード切替で回ることを実機目視確認、ユーザー評「動作 OK」。文言ロジック区切り（温度帯 / 降水確率閾値 / 占い phrase pool）の調整は不要。**helper 古プロセス残置の副次観察**: 同日 16:41 頃に何らかの経路で立ち上がっていた古い helper (PID 189257) が 9:00 自動 stop の cgroup-kill から外れた状態で port 47823 を占有 → 21:01 の手動 start で `OSError: Address already in use` 発生、orc が PID 直 kill + restart でクリーンアップ。発生経路と再現条件は別途観察対象 (本 Done 範囲外、TODO 候補)。

- 2026-05-27 レイアウトを 2 列 3 行グリッドへ組み替え + キャラセル隣にセリフ枠新設。orc 経由 implementer。**ユーザー指定の新仕様**: (1,L)時計 / (1,R)今日の天気+3 時間ごと予報 / (2,L)ごみ予告 / (2,R)キャラ(セル端寄せ)+セリフ / (3,L)再生中の曲 / (3,R)空欄（将来「おすすめ」予約セル、現状ロジック未実装＝空のまま）。
  - **HTML 構造変更** (`web/index.html`): 旧 `.main-row`(水平 3 カラム) + 全幅 `.hourly-strip` + footer `.now-playing` + absolute 配置 `.companion` を破棄、新 `.grid` (2 列 × 3 行) に 6 `.cell` を配置。3 時間ごと予報は (1,R) 天気セル内に統合 (`HOURLY_SLOTS=[6,9,12,15,18,21]` がそのまま 3 時間刻みなので app.js 不変)。
  - **CSS 全面書き換え** (`web/style.css`): `.grid` に `grid-template-columns: 1fr 1.25fr` / `grid-template-rows: 1.4fr 1fr 0.5fr` / `column-gap: 60px` / `row-gap: 32px`。フォント・カラー・ビネット・キャラ SVG / アニメ keyframes は据置 (industrial-refined v0.2 トーン継承)。時計 13vw→11vw、天気/ごみのフォントサイズも 2x3 セル高さに合わせ縮小。`.companion` を absolute から flow に戻し `.companion-row` で `display:flex` + `gap:24px` でキャラ左端寄せ + セリフ枠を隣に配置。`.quote` は `border-left:3px solid var(--accent)` + `background: rgba(40,50,63,0.35)` で「キャラの声」感。
  - **新規 JS ロジック** (`web/app.js` 末尾): `QUOTES` 配列に 5 個の名言（チャップリン / デカルト / エジソン / ソクラテス / マルクス・アウレリウス）を定数定義、`QUOTE_INTERVAL_MS=30*1000` で 30 秒ごとに `.quote-text` を fade out (320ms, CSS `.is-fading` transition) → text 差替え → fade in で循環表示。配列は同ファイル冒頭に集約（dashboard-config.js への分離は先回り雛形につき不採用）。既存の時計 / 天気 / ごみ / now-playing / キャラ瞬き&目線ロジックは一切変更なし。
  - **id/データ配線維持**: `wx-icon`/`wx-temp`/`wx-label`/`wx-hilo`/`wx-pop`/`wx-stamp`/`wx-hourly`/`gb-when`/`gb-type`/`gb-next`/`np-text`/`companion`/`hh`/`mm`/`date` の id は全て維持。app.js の DOM 操作・index 内 inline 時計 script は無改変。
  - **動作確認**: firefox 151 ヘッドレスで `file:///home/miho/companion/dashboard/web/index.html` を 1920x1080 起動 → 6 セル全てが想定位置に描画 (時計 13:41 / 天気 18° くもり時々晴れ / ごみ「きょう (水) プラ容器」/ キャラ + 1 番目の名言「人生はクローズアップで…チャップリン」/ 再生中曲は helper 不在で is-empty 透明 / 右下空欄)。fold 圏内（1080px）に全要素収まる。QUOTES の 30 秒 setInterval / 5 件ループ / fade トランジションは node 単体検証で interval 値・配列件数を確認。
  - **未実装/プレースホルダ対応**: ① 再生中の曲 = 既存 now-playing helper 経由なので新規実装なし、helper 不在時は CSS `.is-empty { opacity:0 }` で控えめに非表示（既存挙動踏襲）。② 「おすすめ」セル (3,R) = 仕様どおり空のまま（HTML コメントだけ残す。markup の予約はしない＝先回り雛形回避）。
  - **対症療法 2 周目ガード非該当**: 既存ロジック (天気 fetch / now-playing polling / ごみ計算 / キャラ瞬き) に条件分岐・閾値追加なし。レイアウト軸（grid 構造）の置換 1 回で完結、fallback 連鎖なし。
  - **commit**: `799bb93` レイアウトを 2 列 3 行グリッドへ組み替え + キャラセリフ枠を追加。push は orc / ユーザー側で実施（implementer は commit 止め）。
  - **残**: 〔ユーザー〕実機 TV (HDMI-1 1920x1080i) 目視 → **2026-05-27 21:34 pass** (v3.1 経由で 6 セル配置・セリフ 30 秒切替・既存要素の整合を実機目視確認、ユーザー評「動作 OK」)。CSS の vw 値追加調整は不要、ただし周囲余白 + 時計/天気中央寄せは v3.1 (commit `7554e48`) で別 Done として吸収済み。

- 2026-05-25 窓配置の placement 軸全移行（title 一致 → `--kiosk --kiosk-monitor=1`）。**ユーザー報告**「いまテレビつけたらダッシュボードが表示されてない」(2026-05-25 朝 08:05) を起点に調査。
  - **根本原因**: journal の 5/25 05:30 起動ログに `firefox window not found within timeout — leaving as-is`、`wmctrl -lG` で窓 0x04800003 が geometry `1974,153,1280,710` = LVDS-1 内に着地、TV (HDMI-1) は黒。title 一致方式（5/22 引き直し済）の polling が 10s 上限内に `<title>=COMPANION-DASH` を捕捉できず、Marco が新規 firefox 窓を primary=LVDS-1 へ再配置するデフォルト挙動が表面化。プロセスは全部生きていた（mpv / nowplaying-helper / firefox）。
  - **応急処置**: lead が dashboard-start.sh L129-131 と同じ wmctrl 3 ステップ（remove maximize → `-e 0,0,0,1920,1080` → `add,fullscreen`）を手動実行、TV 表示復旧（2026-05-25 08:09）。
  - **設計引き直し**: ユーザー選択で構造引き直し合意。3 案提示（A: `--kiosk-monitor` 再評価 / B: devilspie2 WM rule 常駐 / C: `firefox --class` で WM_CLASS 一意化）から A を採用。
  - **5/22 「`--kiosk-monitor` は幻のフラグ」判断の訂正**: L190-191 の旧記述は当時の firefox 150 `--help` 結果に拠るもの（Chromium 流儀との混同もあった）。5/25 時点で firefox 151 が稼働中（`firefox --version` → `Mozilla Firefox 151.0`、`firefox --help` で `--kiosk-monitor <num>` 実存確認）。G 系列が選択肢として復活。
  - **実機検証**（2026-05-25 09:08〜、9:00 自動停止後、使い捨て profile `/tmp/ff-kiosk-prof-{0,1}-<ts>` で kill 後の lock 干渉を避ける、`pgrep -f <profile path>` で PID 一致 kill）: `--kiosk-monitor=0` → 窓 geometry `3840,166,1366,768` = LVDS-1 サイズで着地 / `--kiosk-monitor=1` → 窓 geometry `0,0,1920,1080` = HDMI-1 そのものに着地。**N=1=HDMI-1 確定**。番号体系は xrandr 順ではなく primary 以外が 1 と推定（primary 変更・モニタ追加時は要再検証）。
  - **実装差分**: `bin/dashboard-start.sh` の firefox 起動行に `--kiosk --kiosk-monitor=1` を追加、L108-135 の wmctrl 配置ブロック（窓同定 polling + remove maximize + `-e` move + `add,fullscreen`）を全削除、関連コメント更新。`FF_PID=$!` も不要化で削除。前回残骸掃除の `rm -f` 行に `xulstore.json` を追加（旧 wmctrl 時代の screenX:319 / sizemode:normal / 1280x710 保持を kiosk が 100% 上書きする保険、code-reviewer 軽微提案）。STATUS L27 / L29 / L113 / L152 / L175 / L184 / L190-191 を 5/25 軸移行に追従。`bash -n` 構文 OK、code-reviewer pass（修正必須 2 件 = STATUS L27/L152 同一文書内矛盾、軽微提案 2 件 = xulstore 削除・環境メモ更新、いずれも反映済み）。
  - **対症療法 2 周目ガード非該当**: polling の数値延長や条件追加ではなく軸の置換（identity 軸 polling → placement 軸 firefox 内蔵フラグ）。fallback 連鎖なし、成否 1 回で確定（`~/companion/CLAUDE.md` 対症療法 2 周目ルール準拠）。
  - **残**: 〔ユーザー〕明朝 2026-05-26 05:30 発火で TV に dashboard が全画面表示されるか物理確認。journal の `firefox launched (kiosk on monitor 1 = HDMI-1)` 1 行のみ確認できれば成功。
- 2026-05-22 小箱キャラを下半分中央に追加（commit `0591f85`）。設計ノート `~/companion/vault/notes/2026-05-16_dashboard-character-design.md` を実装。
  - **位置づけ**: PROJECT.md Phase 4（persona）寄りの題材だが、persona 着手ゲート（Phase 3 常用 2 週間 + 無事故 + ユーザー明示宣言）とは**別軌道の「飾りレイヤ」**として実装。`data-state="normal"` 固定駆動で、外部連携（状態を実データで切り替え）は将来差分。下半分は恒久的に飾りという既存原則の範囲内。
  - **構成**: 体は固定 SVG（`web/index.html` の `.companion` ブロック、viewBox 160×200 の直方体 + 影 + スクリーン + 目 2 点 + 口）。スクリーン内の目/口だけ `data-state` で切替（normal/thinking/answering/happy/confused/error/sleepy の 7 状態を `style.css` に予約）。揺れ/呼吸は CSS keyframes 常時ループ、瞬き/目線は `app.js` のランダムタイマー（瞬き 3-7s・100ms / 目線 8-15s）。
  - **バグ修正（今回の主眼）**: 既存実装に設計ノートとの不整合があり 4 点修正。① app.js が存在しない state 名 `working` で停止判定しており idle 停止が一切発火しなかった → 実 state 名に合わせ `blinkAllowed()`（error のみ停止）/ `gazeAllowed()`（thinking/answering/error で停止）に分割。② 体の揺れ/呼吸が state で止まらなかった → CSS で thinking/answering/error 時 `animation: none`。③ confused に CSS 定義がなかった → 右目を細める表情を追加。④ sleepy の重い瞬き（200ms）未実装 → `blinkOnce()` に hold 分岐。
  - **code-reviewer 修正必須 1 件を反映**: confused/happy/sleepy の目 transform（specificity 0,2,x）が `.cmp-eye.blink`（0,1,0）に勝ち、これらの state 中に瞬きが効かなかった → `.cmp-eye.blink { ... !important }` で blink を全 state 最優先化（瞬き停止は app.js の error 判定のみ＝設計ノートと整合）。再レビュー pass（修正必須なし）。
  - **x11vnc CPU 事故防止原則の順守**: absolute 配置で flow 外＝上半分レイアウト（時計含む）を揺らさない。アニメは `.companion` 局所 transform のみで全画面アニメ・hover なし。
  - **軽微提案（将来メモ、現状リスクなし）**: ① answering/happy 等で予約済みの `x`/`width`/`rx` の CSS 上書きは SVG2 geometry property 依存。将来 state を実データ駆動する際、表示エンジン次第で効かない可能性あり（現状 firefox 駆動なので可、normal 固定中は不発火）。② `scheduleBlink`/`scheduleGaze` は自己再帰の永続タイマーで停止口がない（常駐前提なので意図どおり、将来キャラを DOM から外す導線ができたら要停止）。
  - **配色フォロー（2026-05-22、ユーザーフィードバック）**: 「黒地にオレンジの目は視認性が悪い」→ `.cmp-screen` を `#0c1118`→`#1a2230` に上げた（窪みは body `#28323f` より暗く維持、目/口の `var(--accent)` #f3b85f は据置）。地を上げる/橙維持はユーザー選択。code-reviewer pass（WCAG コントラスト比 9.0、AAA 超）。実機 1080i 目視を同日テレビフル起動で実施、ユーザー確認 OK（地を上げた橙の視認性・アイドル動作とも良好）。
  - **title 一致 HDMI-1 配置の副次確認（2026-05-22 夜）**: 上記テレビ確認の手動 `systemctl --user start dashboard.service` で journal に `placed firefox window 0x01600003 on HDMI-1 (fullscreen)`（従来は `window not found within timeout`）。L219 の title 一致引き直しが実地で初動作。ただし確認用 firefox 窓が同 title `COMPANION-DASH` で並存する非標準条件下での成功で、複数窓 title マッチ時の awk 選択挙動は本番（単一窓）と条件が異なる。L219 の明朝 5:30 純条件確認はそのまま継続。
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
