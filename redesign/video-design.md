# video-design.md (companion-remote 動画プレイヤー F-video 確定設計)

version: **v1.0 (確定版)** — agent team `companion-video-design` (architect/ux/security/devil + lead) の Round 1〜3 議論 + lead 実機検証 + devil 最終確認(致命級ゼロ・approve 可)を経て確定。
作成: 2026-05-20
ステータス: **実装完了(RV-1〜RV-5、2026-05-20)**。host = companion-remote(remote-design.md v1.0)の新機能。コード/設定/PWA/docs は `~/companion/remote/`(v1-α 系列、bot.service 非依存)に実装済。残るは §10 の build 検証項目(GUI セッション/実 live URL 依存、`remote/docs/SETUP.md §6` + `remote/docs/STATUS.md` build 検証行)で lead がユーザー在席時に握る。
議論アーカイブ: team plan(`~/.claude/plans/video-{architect,ux,devil}.md` / `async-percolating-dragon.md`=security)は cleanup で消滅。本ファイルが成果物。

---

## 0. 目的と非目的

### 目的
companion-remote PWA(スマホ Pixel-6 専用リモコン)から、Linux Mint 機(miho-inspiron-3521)の TV に YouTube 動画を再生し、**再生後も pause/seek/音量/停止を制御**する。現状の Discord `/play`→`xdg-open`→ブラウザ(ブラウザ設定に振り回される / 再生後まったく操作できない)を置き換え、「VRChat の動画プレイヤー級」の制御を得る。

### 非目的
キュー/プレイリスト(MVP punt、capability 拡張は §5 第2原則で新 endpoint)/ live の DVR シーク開放(初手無効、build 後に1回判断)/ ライブ先頭へ戻る / 字幕・画質手動切替 / YouTube・ニコニコ動画以外のサイト(ニコニコは 2026-06-11 追加、§4.1 と改版履歴参照。ニコ生 `live.nicovideo.jp` は引き続き非目的)/ Phase 4 キャラクター層。

---

## 1. 確定要件

| 項目 | 確定内容 | 根拠 |
|---|---|---|
| 置き場所 | companion-remote の新機能 F-video。**bot 非依存 = v1-α 系列**(bot.service 再起動なし、6/2 健全性観察窓を汚さない) | user 確定 2026-05-20 |
| プレイヤー | 既存 **mpv 0.34.1**(新規プレイヤーは書かない) | lead スモーク実証 |
| URL 解決 | **yt-dlp 2026.03.17** を mpv ytdl_hook 経由(方式 a) | architect §13 + lead 実証 |
| latency | URL投入→再生開始 **40〜70秒**(yt-dlp の YouTube 解決コスト、ネットワーク律速、技術で消せない)を**受容** | user 確定 2026-05-20 |
| live 配信 | **MVP でサポート**(LIVE モード = シーク無効 + ●LIVE 表示) | user 確定 2026-05-20 |
| 制御経路 | claude を起動しない → remote 直接(F-2/F-3 と同じ側)。F-1 のような bot socket 経由ではない | §5 第1原則 |
| ジョブ基盤 | **不要**(再生 state は mpv が所有、PWA は `GET /api/video/state` ポーリング) | architect §10 + lead 実証 |

---

## 2. lead 実機検証結果(2026-05-20、設計の土台)

| 項目 | 結果 |
|---|---|
| VOD 再生 + IPC | ✅ `mpv --no-config` で YouTube 再生、IPC で `pause`/`seek`/`volume`/`get_property`(duration/media-title/time-pos)/`quit` 全動作 |
| latency | yt-dlp `-J` ~39s / `-g` 既定 ~70s / `player_client=tv,ios` は **rc=1 失敗**。user CPU 全試行 3-4s = **ネットワーク律速**(ローカル計算でない)。**client チューニングで縮まない**(数値いじり=2周目に入らない) |
| loadfile replace | ✅ 解決中(yt-dlp 稼働中)に loadfile replace すると**旧 yt-dlp は kill、yt-dlp 単一保持**(timeline: U1後=1 → U2 replace後ピーク=1)。→ lane ガード/409 不要 |
| 最小 env | ✅ `env -i HOME=... PATH=/home/miho/bin:/usr/bin:/bin XDG_RUNTIME_DIR=...`(PROXY・user shell env なし)で rc=0 再生成立。CA 証明書も system 既定で解決、SSL_CERT_FILE 追加不要 |
| `--ytdl-raw-options` pass-through | ✅ 不正 raw option を渡すと yt-dlp が直接実行時と同一 usage エラー → **hook 経由で yt-dlp に確実に届く**(SG-3 ハードニングが効く) |
| nsig 解決 | deno なし / node あり / yt-dlp=python3 zipapp。**内蔵 jsinterp(sandboxed Python)で解決**、外部 JS ランタイム未起動 → deno 不採用(速くもならず攻撃面増) |
| live 検出シグナル | ✅ yt-dlp `is_live`/`live_status` を返す(VOD=`is_live=False live_status=not_live` 実証) |
| **未検証(build 項目)** | live 再生実挙動(有効 live URL が ephemeral で headless 取得不可) / `--fs-screen` の TV 側表示(lead Bash に DISPLAY 不在) / resident mpv RAM 実測 |

---

## 3. アーキテクチャ(architect)

### 3.1 エンドポイント `/api/video/*`(Bearer 必須、stdlib http.server)
remote 既存サーバ(remote-design §3.1)にルートを足す。`server/video.py`(voice.py 同型の IPC クライアント、1 接続1確定)。

| endpoint | mpv IPC |
|---|---|
| `POST /api/video/play {url}` | URL を §4.1 で normalize → 即 200 → `loadfile <url> replace` |
| `POST /api/video/pause` / `resume` | `set_property pause true/false` |
| `POST /api/video/stop` | `stop`(idle に戻す) |
| `POST /api/video/seek {pos}` | `seek <pos> absolute`(VOD のみ) |
| `POST /api/video/volume {v}` | `set_property volume <v>`(**mpv volume のみ、PulseAudio sink 不可触**) |
| `GET /api/video/state` | `get_property` 群を集約(phase/title/pos/duration/pause/is_live) |

### 3.2 mpv ライフサイクル = resident idle mpv 専用 unit
- **`companion-video-mpv.service`**(Type=simple、`--idle=yes` で常駐、null 起動)。生死監視/孤児/再起動/stale socket 掃除を **systemd 任せ**(remote.service に supervise 責務を足さない)。stale socket は `ExecStartPre` で rm。
- remote サーバは IPC を叩くだけ = **stateless 維持**。mpv の spawn/reap をしない。
- **単一インスタンス = 単一 lane を物理保証**(409/lane ガード/server-state 不要。lead 実証: replace で yt-dlp 単一保持)。
- 窓配置は **mpv `--fs-screen=<N>`**(dashboard の wmctrl PID-match 苦闘=2周目を踏まない)。index 決定論性と idle mpv の窓非占有は build 検証(§10 V-A1)。
- **解像度上限 `--ytdl-format`(720p 上限)**(AVX1+HDD+x11vnc 競合での 4K ソフトデコード自己DoS 回避。数値は1回確定、刻まない)。
- **resident vs on-demand の裁定 = resident**(NEW-4): IPC socket の RCE 能力は **fs パーミッション(socket 0o600 + `/run/user/1000` が 0700/miho)で gate され、HTTP token では gate されない**。HTTP が送るのは §3.4 verb whitelist のみ(run/load-script 不可)→ resident でも on-demand でも token 攻撃者は RCE verb に到達不可、24/7 常駐は **HTTP 到達面を変えない**。socket は同一権限(miho-uid)からのみ到達 = escalation でなく lateral(miho-uid プロセスは socket 無くても tokens.json 読取・unit 起動が可能)。devil も resident に合意。**load-bearing 前提**「単一 GUI uid + socket 0o600 + remote 単独書き」を崩したら再評価。RAM が渋い場合のみ on-demand 再考(security でなく RAM 判断)。

### 3.3 yt-dlp 起動 = mpv ytdl_hook 任せ(方式 a)
server は yt-dlp を直接 subprocess しない。理由: stream URL 失効の自前再解決(2周目)を回避 / cancel・replace を mpv が所有 / **server が署名付き stream URL を見ない(§4 ログ安全)**。SG-3 ハードニングは mpv unit の宣言的 `Environment=` + `--no-config` + `--ytdl-raw-options=ignore-config=,no-playlist=` で達成(lead 実証で hook 経由到達を確認)。
- **`ytdl_hook-try_ytdl_first=yes` 必須(V-A3 build 検証 2026-05-21 で確定)**: mpv 既定 `no` は URL をまず ffmpeg で直開き→youtube は必ず失敗→`on_load_fail` で yt-dlp フォールバックする。**実 vo(HDMI)環境では直開き失敗後・フォールバック完了前に load が idle 中断**され、解決の遅いアーカイブ(was_live VOD、yt-dlp 解決 18〜37s と高分散)が再生不能になる。最初から yt-dlp を呼ぶ `yes` で解消(全 URL が youtube ゆえ直開きは無駄でしかなく、僅かに高速化も伴う)。実装 `remote/systemd/companion-video-mpv.service`。
- **hook 実体 = vendored v0.37.0 ytdl_hook.lua(2026-06-12、RV-9 解決)**: mpv 0.34.1 組み込み hook は yt-dlp の per-format `cookies` フィールド未対応でニコニコ domand HLS が 403(RV-9)。`--ytdl=no` で組み込みを切り、upstream v0.37.0 の hook(**無改変** vendored、`remote/vendor/ytdl_hook.lua`、sha256=4f2e2a2a... を upstream raw と一致確認)を `--scripts=` で読む。§8 が要求する「1 回の設計判断」の記録は §8 末尾と改版履歴 2026-06-12 を参照。**ファイル名 `ytdl_hook.lua` は必須**(script-opts の prefix がファイル名由来のため、リネームすると `ytdl_hook-*` オプションが届かなくなる)。
- **`force-ipv4=` を raw-options に追加(2026-06-12)**: この網は IPv6 が 100% loss(RV-8 実測)なのに CDN(delivery.domand.nicovideo.jp 等の CloudFront)が AAAA を返し、yt-dlp の接続が IPv6 connect timeout(~40s)→ IPv4 fallback を繰り返す。DL 経路(dlqueue)で実測 2.5KB/s → 3.35MiB/s(約 90 倍)を確認した同一根本原因の streaming 側適用(同一根拠の 2 適用点 = 2 周目ではない)。yt-dlp の解決リクエストにのみ効き、fragment 取得(mpv/ffmpeg)側は別経路である点に注意(soak 検証は remote STATUS.md 2026-06-12 参照)。

### 3.4 IPC verb whitelist(RCE 面の一線)
`video.py` は**固定テンプレート**(loadfile replace / set pause / stop / seek abs+rel / set volume / get_property 固定リスト)のみを **`json.dumps` 構築**で送る。**`run`/`load-script`/任意 `set_property` を HTTP 層から一切受けない**。socket=`$XDG_RUNTIME_DIR/companion-video-mpv.sock` 0o600 remote 単独書き。

### 3.5 ハードウェアデコード(`--hwdec=vaapi`) — 2026-05-28 追加
- **採用根拠**: V-A3 build 検証中の Live URL 再生で **frame-drop 690 / estimated-vf-fps 27.3 (container 60.0) / hwdec-current=no** を実機観測。i3-3217U(Ivy Bridge GEN7)+ Intel HD Graphics 4000 は VA-API 対応世代で、ホストには `i965-va-driver` インストール済(`/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so` 存在)。**ソフトデコードでは 60fps Live を捌けない**ことが定量で出たためハードウェアデコードを有効化。
- **対症療法 2 周目ガード非該当**: 既存の条件分岐の延長(`if rc != 0:` / stderr マッチ拡張)でも、数値だけ動かす修正でも、リトライ追加でもなく、**新規オプション 1 つの追加 = 1 周目**。`~/companion/CLAUDE.md`「2 周目」定義のいずれにも該当しない。
- **不採用候補**: (α) `--hwdec=auto` は将来 driver 入替時に再評価ポイントを増やす(libva の preferred 順序が暗黙に変わると挙動が動く) → `vaapi` で固定して再評価面を 1 箇所に絞る。(β) `--hwdec=vaapi-copy` はメモリコピー経由で省 GPU メモリだが Ivy Bridge GEN7 では VRAM 共有ゆえ利点なし、本筋の zero-copy `vaapi` を採用。
- **load-bearing 前提**: `i965-va-driver` 利用可能(`dpkg -l | grep va-driver` 確認、`/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so` 存在)。driver 不在 OS へ移植する場合は `--hwdec` の値を再評価する(契約2 と同じく前提が崩れたら再評価の対象)。
- **検証**: service edit + `systemctl --user daemon-reload` で ExecStart に `hwdec=vaapi` 反映を確認。
- **実機検証結果 (2026-05-28 同日 restart 後)**: 同 Live URL 再投入で IPC `hwdec-current=vaapi` を確認、**estimated-vf-fps 27.3→60.0 (container 60.0 に完全追随) / %CPU 66.7→20.0 (top) / RSS 223→160 MB / decoder-frame-drop=0 維持**。デコード CPU 律速は解消、本オプションは想定通り機能。
- **残課題(本オプション範囲外)**: hwdec=vaapi 投入後も user TV 実機で **5 秒周期(YouTube Live segment 長と一致)の固まり**が残る。機械測定で `demuxer-cache-state.underrun=True` + `paused-for-cache` 反復 = ネットワーク受信(yt-dlp chunk 取得)側の問題と切り分け確定。本オプションは「デコード側 CPU 律速」を解消する範囲で完結、Live edge 追従 stall は別軸 = `~/companion/remote/docs/STATUS.md` RV-8 として TODO 化(対症療法 2 周目ガード抵触リスク高で root cause 切り分けを先行)。

### 3.6 TV オーバースキャン補正(`--video-zoom=-0.05`) — 2026-05-28 追加
- **採用根拠**: TV 側のオーバースキャン(画面端の見切れ)が発生していたため、mpv 側で 5% 縮小して可視領域に収める。実機で「ちょうどいい」と user 確認済(2026-05-28)。
- **mpv 側で吸収する理由**: TV 側で overscan off を毎回設定する/X 側で `xrandr --transform` を組むより、mpv 1 オプションで完結する方が状態が 1 箇所(service unit)に閉じる(center of truth)。dashboard BGM mpv(別 unit)には影響しない。
- **値の固定**: `-0.05` は user 実機で 1 回確定。`<再生位置の見切れ報告>` が再発しない限り数値を刻まない(2 周目ガード適用、本ファイル §6 契約と同じ規律)。

---

## 4. セキュリティ(security、3層 + 契約)

remote-design §2 のネットワーク層(127.0.0.1 bind + tailscale serve + token)をそのまま継承(新規外部露出なし。mpv/yt-dlp は YouTube CDN へ**外向き**接続するのみ)。F-video 固有は以下。

### 4.1 URL allowlist(唯一の外向き境界 = 絶対死守)
課金ゼロゆえ budget guard backstop が効かない → **allowlist が唯一の門**。`remote/server/urlguard.py` に bot.py `_normalize_play_url` の**ミラー複製**(冒頭に同期コメント)。bot/remote は別 repo ゆえ物理共有は YAGNI 超過 → **canonical 攻撃ベクタを本ファイル §4.1 に1箇所定義、両 repo の test が mirror して drift 検出**。

**canonical 攻撃ベクタ(確定)**:
- 拒否: userinfo 詐称(`https://evil@youtube.com/...` / `youtube.com@evil.com` / `evil@nicovideo.jp` / `evil@tver.jp`) / 空白・制御文字 / `file://`・`ftp://` 等 http(s) 以外の scheme / `169.254.169.254` 等 SSRF 起点 / suffix 偽装(`youtube.com.evil.com` / `nicovideo.jp.evil.com` / `nico.ms.evil.com` / `tver.jp.evil.com`) / 非 allowlist host(`notyoutube.com`) / 非 allowlist サブドメイン(`embed.nicovideo.jp`)
- 受理: `www.youtube.com/watch` / `youtu.be/<id>` / `music.youtube.com` / `m.youtube.com` / **`www.youtube.com/live/<id>`** / `www.nicovideo.jp/watch/<id>` / `sp.nicovideo.jp/watch/<id>` / `nicovideo.jp/watch/<id>` / `nico.ms/<id>` / `tver.jp/episodes/<id>` / `www.tver.jp/episodes/<id>`(hostname 照合のみ、path で分岐しない=攻撃面を増やさない)
- ニコニコ 4 host は 2026-06-11 追加(user 依頼)。`embed.nicovideo.jp` はユーザーが貼る共有 URL でないため除外(攻撃面を増やさない)。`live.nicovideo.jp`(ニコ生)はスコープ外(将来候補、remote STATUS.md 参照)。normalize ロジック本体は無改変(frozenset への host 追加のみ)。
- TVer 2 host は 2026-06-12 追加(RV-11、user 依頼)。実エピソード 3 本(3 系列局)を yt-dlp 2026.03.17 `-J` で解決検証済(DRM 0 / HLS m3u8_native / 無ログイン)+ 本番 mpv 実再生スモーク(11s playing / シーク / 停止)。normalize ロジック本体は無改変。
- **DL の門は別関数 `normalize_dl`**(remote のみ、2026-06-12): 再生 allowlist のうち `STREAM_ONLY_HOSTS`(TVer 2 host)を除外して判定し、`/api/dl` はこちらを通す。TVer は期限付き見逃し配信でローカル保存が期限・権利の両面を迂回するため事前 DL(RV-10)に流さない。bot 側に DL 経路はないためミラー対象は再生 allowlist のみ。
- **`nico.ms` はリダイレクタ**: リダイレクト先は yt-dlp 内部で解決され allowlist の再検査を受けない。nico.ms はドワンゴ管理のクローズド短縮(任意外部 URL へ飛ばせない)であることが受理の前提。この前提が崩れたら allowlist から外す(code-reviewer 指摘 2026-06-11)。

### 4.2 yt-dlp env 隔離
mpv unit の `Environment=`(PROXY 系を入れない、user shell env 非継承)で達成。yt-dlp は ytdl_hook 経由で mpv の子 = mpv env を継承。`--no-config` + `--ytdl-raw-options=ignore-config=,no-playlist=` + ytdl_path 固定 + TLS 維持。**自動更新(`-U`)禁止**(§8)。lead 実証: 最小 env rc=0。

### 4.3 deno 不採用(条件付き)
nsig は内蔵 jsinterp で解決済(外部 JS spawn なし)。deno は latency をネットワーク律速ゆえ縮めず、攻撃者制御 JS の外部ランタイム = 攻撃面増。**不採用**。将来 deno 導入時は外部ランタイム PATH 固定要件が即復活する条件付き。

### 4.4 ログ
`/play` の `%r` 方式踏襲(OWNER/token 限定経路前提)。記録先は **remote 自身のログ(0o600、bot.log と別)**。token/Bearer は不記録。**ytdl_hook 方式ゆえ server は署名付き stream URL(googlevideo 時限 token 含む)を見ない** = ログ安全。

---

## 5. UX(ux)

### 5.1 状態機械 + LIVE モード
- 状態: `IDLE` → `RESOLVING`(40〜70秒) → `PLAYING` ⇄ `PAUSED` / `ERROR`。transport の真実は mpv IPC、PWA はその写像。
- **重要な非対称: close ≠ stop**。画面を閉じても TV 再生は継続。停止は明示「停止」ボタン(不可逆・破壊的)で隔離。「閉じる」(可逆・TV 継続)と語彙/位置/確認で分離。glance の now-playing 残置で継続を可視化。
- **LIVE モード**: 状態爆発を避け、`playing`/`paused` に **`is_live` フラグ**を付ける変種で対応。LIVE 時はシークバーを **`● LIVE` 表示に置換**、**初手はシーク無効(安全側)**、pause/resume は有効。

### 5.2 RESOLVING(40〜70秒)の UX = latency 吸収の主役
楽観的遷移(タップ即 RESOLVING)+ amber スピナー + **経過秒**(嘘 ETA を出さない)+ **目安テキスト「読み込みに最大1分ほどかかります」**(実測 40〜70s に整合、VRChat に無い不安緩和)+ **キャンセル必須**(state 1本で確定、stderr 分岐しない)+ 投入中に画面を閉じてよい/再開で `GET /api/video/state` ポーリングから復元(job_id 不要)。90s 超で追加文言。

### 5.3 取りこぼし許容(NEW-3)
サーバ stateless ゆえ `failed`/終了済 phase は再開 PWA に復元されない(サーバに結果 state を持たせない=stateless 原則を崩さない、1回確定)。再開時は phase=idle + localStorage の URL ヒントがあれば **中立明示「前回の再生は終了しています」**(成功/失敗を断定しない)+ 入力欄に直前 URL を残し再投入動線へ。

### 5.4 エラー / glance
- エラーは **構造化出力限定、stderr パース禁止**(契約)。種別を一般エラーに集約(case を増やさない=2周目回避)、自動リトライなし。live 失敗も VOD と同じ clean-fail。
- glance は**状態依存の条件表示で圧縮**: ①●接続 ②now-playing(アクティブ時のみ挿入、`▶ タイトル` / `⟳ 解決中… 18s` / `● LIVE タイトル`) ③quota%(F-1 RB-3) ④OS health。動画非利用時は肥大しない。
- localStorage は token と表示ヒントを分離(remote §2.3 caveat 踏襲)。

---

## 6. 設計契約(実装者が破ると壊れる一線 — video-design.md で強調)

1. **PulseAudio sink 不可触**: 音量は mpv `volume` プロパティのみ。`pactl`/sink 操作を**未来も絶対に入れない**。sink の owner は dashboard(朝20%固定→ExecStopPost 復元のライフサイクルで所有)。video が sink を触ると owner 2人化 → dashboard の prev 保存が video 値を掴む汚染。verb whitelist に sink 操作を含めない。(architect §11 / security / ux 三者一致)
2. **resident mpv の load-bearing 前提**: 単一 GUI uid + socket 0o600 + remote 単独書き。これが崩れたら resident 裁定を再評価(§3.2)。
3. **IPC verb whitelist**: HTTP 層は §3.4 の固定 verb のみ mpv に写像。socket 自体は全コマンド受理だが**同一権限(miho-uid)からのみ到達ゆえ escalation 無し**。`run`/`load-script`/任意 `set_property` を HTTP から通すと RCE 面が開く。(契約1と契約3はセット = sink 不可触を verb whitelist で機械的に保証)

---

## 7. live サポート詳細

- **検出(LIVE-1 解消)**: phase は **まず `core-idle`/再生開始で判定**(RESOLVING vs PLAYING)。当初案は「playing 確定後に `duration` を1回 read: number=VOD / None=live、補助で `seekable`」だったが、**V-A3 実機検証(2026-05-20)で duration=None 前提が外れた** — YouTube live は DVR バッファ長を**有限 duration で返し**(実測 46→104→178s と伸びる)、`seekable=False`/`partially-seekable=False`。VOD は `seekable=True`。設計が予告した通り property を盛らず**1回引き直し、`seekable` を主シグナルへ確定**: `is_live = playing and not seekable`。UX が gate したいのは「seek できるか」そのものゆえ最も素直(capability read で1回分岐、stderr マッチ厳禁)。実装 `remote/server/video.py:_derive`。
- **運用穴(LIVE-2)**: live は eof で自然終了しない → 停止し忘れで TV/AVX1 デコード/CDN が無制限。**auto-stop タイマーは作らない**(cross-control/数値2周目)。**glance now-playing 常駐(§5.4)を唯一の忘れ防止 backstop** として明記。単一 lane ゆえ本数は増えず自己DoS の新規面ではない。
- **clean-fail**: ephemeral live URL(配信終了等)は既存 failed phase で clean-fail(live 専用リトライ厳禁)。lead 実証: `jfKfPfyJRdk` は "This live stream recording is not available" = 有効 live URL は ephemeral。
- live 固有の追加 security 面なし(同 allowlist/env/CDN、T-7 射程を広げない)。

---

## 8. yt-dlp churn bound(T-5、ハードストップ)

mpv 0.34.1(Mint 21.3 同梱、凍結)× yt-dlp(YouTube 仕様変更で更新を強制されるため永久 freeze 不可)の結合。bound の本質は「強制更新を**無秩序な flag 盛り/ytdl_hook patch にしない規律**」:
- **known-good ペアを台帳記録**(remote STATUS.md に「mpv ver + yt-dlp ver + 検証日 + 結果」。現行 = **mpv 0.34.1 core + vendored ytdl_hook v0.37.0 + yt-dlp 2026.03.17 + 2026-06-12**。旧 = mpv 0.34.1 組み込み hook + 同 yt-dlp + 2026-05-20)。
- 破綻シグナル = **全動画が failed**。reactive 手動差替(退避→差替→§10 スモーク再走→ロールバック可)。**prophylactic 自動更新(`-U`)禁止**。
- **非互換時は ytdl_hook.lua patch も flag 盛りもせず、(α)yt-dlp 旧版保留 or (β)mpv 更新/pre-resolve 方式へ の1回の設計判断を台帳記録してから動く**(2周目を打たない)。
- **2026-06-12 の 1 回の設計判断(RV-9 = 0.34.1 hook の cookies 未対応)**: 選択肢 (α) 見送り(事前 DL = RV-10 で代替)/(β1) mpv 本体更新/(β2) pre-resolve 方式/(γ) **upstream v0.37.0 hook を無改変 vendored で 0.34.1 core に載せる ← 採用**。根拠: user 要望「ストリーミング再生はできてほしい」で (α) 落ち。(β2) は server が署名付き URL を見る + 自前再解決で §3.3 の採用理由を 2 つ崩す。(β1) は Mint 21.3 の apt に新版が無く PPA/flatpak/static build は導入・運用 churn が大きい。(γ) は実機検証 pass(ニコニコ sm9 8s playing / YouTube VOD 回帰なし seekable=True / 本番 TV 10s playing)で最小差分。「patch 禁止」には抵触しない(改変ゼロの upstream ファイル差し替えで、§8 が禁じる無秩序な行レベル patch ではない)。**撤去条件**: mpv 本体を 0.37+ に更新したら vendored hook と `--ytdl=no`/`--scripts=` を撤去して組み込みに戻す(hook v0.37 × core 0.34 の非対称は将来 yt-dlp 更新時の検証面が 1 つ増えるため、恒久構成ではなく mpv 更新までの橋)。

---

## 9. 採用しない / 罠リスト(devil、生存分)

- **致命級ゼロ**(NEW-1/NEW-2/T-2/DV-1/T-3 は lead 実証 + 議論で溶解、撤回確定)。
- ガードレール(降格): T-5 churn(§8) / LIVE-1 検出誤判定(§7) / LIVE-2 停止し忘れ(§7) / NEW-4 resident 前提(§3.2/§6) / DV-2 sink 不可触(§6) / NEW-3 取りこぼし(§5.3)。
- 不採用: deno(§4.3) / 非同期ジョブ基盤(§1、mpv が state 所有) / lane ガード・409(§3.2、replace 単一保持実証) / auto-stop タイマー(§7) / wmctrl 配置(§3.2、fs-screen) / キュー(§0) / live DVR シーク開放(§0、初手無効)。

---

## 10. build 検証項目(実装フェーズ、lead が GUI/実機で握る)

🔴必須:
- ~~**V-A1**~~ **✅ 確定(2026-05-20)**: `--fs-screen=<N>` の数値 index は脆い(0 = LVDS-1 = ノート本体を掴んだ) → **出力名指定 `--fs-screen-name=HDMI-1` で TV へ全画面確定**(xrandr: HDMI-1 1920x1080 820x460mm=TV / LVDS-1=primary ノート)。idle mpv は `--force-window=no` で窓非占有を確認。実機で TV 全画面 + シーク + 音 OK。
- ~~**V-A3**~~ **✅ 確定(2026-05-20)**: live 検出を `seekable` ベースへ1回引き直し(§7、duration=None 前提が DVR 有限 duration で外れたため)。実機で live=●LIVE/シーク無効/pause 有効、VOD=シーク可 を確認。`[hidden]` が `.row{display:flex}` に負けて live 時シークバーが残るバグも CSS `[hidden]{display:none!important}` で修正。
- **V-A6**: resident mpv の RAM 実測(3.7Gi 制約での 24/7 常駐妥当性)。**未了**(現状 `start` のみで `enable` 保留、RAM 妥当性確認後に boot 自動起動を確定)。

🟠:
- dashboard BGM mpv との同居(別 socket だが音 sink 共有/全画面競合、朝晩運用での実観測)。
- 720p deinterlace の 1080i 表示品質。
- 単一 lane 実機再確認(`pgrep -af yt-dlp` 本数、replace 中断時)。

> ⚠ V-A1/V-A3/同居は TV が光る/音が出る → 5:30〜9:00 以外 or ユーザー在席時に。dashboard 稼働中(朝)は避ける。

---

## 11. 実装サブタスク(v1-α 系列、1サブタスク=1commit、bot.service 非依存)

- **RV-1**: `systemd/companion-video-mpv.service`(Type=simple, `--idle=yes`, Environment 隔離, --no-config, --ytdl-raw-options, --fs-screen, 720p上限, --input-ipc-server 0o600, ExecStartPre stale rm)。
- **RV-2**: `server/urlguard.py`(bot.py ミラー複製 + §4.1 canonical ベクタ) + `server/video.py`(IPC クライアント, verb whitelist, json.dumps) + test(canonical ベクタ mirror)。
- **RV-3**: `/api/video/*` ルート追加(remote app.py、Bearer 必須、play/pause/resume/stop/seek/volume/state)。
- **RV-4**: PWA 動画パネル(状態機械 + LIVE モード + RESOLVING UX + close≠stop + glance 統合 + 取りこぼし明示)。SW CACHE bump。
- **RV-5**: docs/STATUS.md + 本ファイル反映 + known-good ペア台帳記録 + bot `/play` の deprecate/リダイレクト判断。

---

## 12. 議論経緯サマリ(なぜこの設計か)

- lead スモークで feasibility 確定(VOD 再生 + IPC 制御)、最大リスク = latency 40〜70s(ネットワーク律速、技術で消せず) → user 受容。
- devil 致命級 NEW-1(yt-dlp 起動方式衝突)/ NEW-2(二重 yt-dlp)/ T-2(ジョブ基盤前借りor重複)を、architect「mpv が state 所有=ジョブ不要」の第3の解 + security の (a)ytdl_hook 合流 + **lead 実機検証**(replace 単一保持 / pass-through / 最小 env rc=0)で全て溶解。
- live サポートは user 追加要件。検出は is_live/mpv duration(LIVE-1 を core-idle 先判定で解消)、運用穴 LIVE-2 は glance backstop。live 再生実挙動は build 検証。
- resident vs on-demand(NEW-4)は「RCE は fs perms で gate、HTTP token で gate されない」で resident に収束(devil 合意)。

## 改版履歴
- v1.0 (2026-05-20): agent team `companion-video-design` Round 1〜3 + lead 実機検証6本 + devil 最終確認(致命級ゼロ・approve 可)を経て確定。
- 実装注記 (2026-05-20): RV-1〜RV-5 を `~/companion/remote/` に実装完了(設計変更なし)。lead スモーク = 単体8テスト pass / headless mpv で IPC 実プロトコル検証 / ハンドラ層 E2E(実 mpv 接続)。
- build 検証注記 (2026-05-20): GUI 実機で V-A1 ✅(fs-screen-name=HDMI-1 へ確定) / V-A3 ✅(live 検出を seekable ベースへ1回引き直し、§7) を完了。付随修正 = `[hidden]` CSS 修正 + 投入直後の読み込み失敗文言(client 遷移判定、§7 clean-fail)。V-A6 RAM 実測のみ未了(`enable` 保留中)。詳細は `remote/docs/STATUS.md` 2026-05-20 エントリ。
- アーカイブ再生修正 (2026-05-21): was_live アーカイブが実 service で再生不能だった根本原因を `ytdl_hook-try_ytdl_first=yes` で解消(§3.3)。実 vo + 既定 no の直開き失敗→idle 中断が原因。post_live 処理中(YouTube 側アーカイブ未公開)は依然 clean-fail(時限)。詳細は `remote/docs/STATUS.md` 2026-05-21 エントリ。
- mpv チューニング追加 (2026-05-28): Live 60fps 再生で frame-drop 690 / estimated-vf-fps 27.3 (container 60.0) / hwdec-current=no を観測したため `--hwdec=vaapi` 追加(§3.5、i965-va-driver 利用可、対症療法 2 周目ガード非該当 = 新規オプション 1 つの追加 = 1 周目)。併せて TV オーバースキャン補正 `--video-zoom=-0.05` の採用根拠を §3.6 に記録(user 実機確認 OK)。実 restart は本変更では実施せず、user が Live URL 再投入時に lead が再判定段を握る。詳細は `remote/docs/STATUS.md` 2026-05-28 エントリ。
- 実機検証結果 (2026-05-28 同日): restart 後の同 Live URL 再投入で `hwdec-current=vaapi` 確認、estimated-vf-fps 27.3→60.0 / %CPU 66.7→20.0 / decoder-frame-drop=0 = デコード CPU 律速の解消を定量確認(§3.5 末尾追記)。一方 user TV 実機で 5 秒周期の固まりが残り、機械測定で `demuxer-cache-state.underrun=True` + `paused-for-cache` 反復 = ネットワーク受信側の問題と切り分け確定。本軸(hwdec)範囲外として `remote/docs/STATUS.md` RV-8 に分離(対症療法 2 周目ガード抵触リスク高で root cause 切り分け先行)。RV-5 build 検証 🔴必須項目(V-A1/V-A3 hwdec/V-A6)は完了。
- RV-9 解決 = vendored v0.37.0 ytdl_hook + force-ipv4 (2026-06-12): ニコニコ streaming 不達 (0.34.1 組み込み hook の per-format cookies 未対応 → domand HLS 403) を、upstream v0.37.0 hook の無改変 vendored (`remote/vendor/ytdl_hook.lua`, `--ytdl=no` + `--scripts=`) で解決 (§3.3 / §8 の 1 回の設計判断、撤去条件 = mpv 本体 0.37+ 更新時)。併せて網の IPv6 100% loss × CDN AAAA による接続 timeout 回避で `force-ipv4=` を raw-options に追加 (DL 経路実測 90 倍と同根拠)。実機 = ニコニコ sm9 8s playing / YouTube VOD 回帰なし / 本番 TV 10s playing。known-good ペア更新。詳細は `remote/docs/STATUS.md` 2026-06-12 エントリ。
- ニコニコ動画 allowlist 拡張 (2026-06-11): §4.1 受理リストに `nicovideo.jp` / `www.nicovideo.jp` / `sp.nicovideo.jp` / `nico.ms` の 4 host、拒否ベクタにニコニコ版(userinfo 詐称 / suffix 偽装 / 非 allowlist サブドメイン `embed.nicovideo.jp`)を追加(user 依頼)。normalize ロジック本体は無改変(frozenset 追加 + テストのみ)、両 repo の mirror テスト同期済。`live.nicovideo.jp`(ニコ生)はスコープ外。§5 の「security + architect 再 cross-review」は host 4 件追加・ロジック非変更の小粒拡張のため code-reviewer の security 観点レビューで代替(orc 判断)。known-good 実測・mpv 実再生スモーク結果は `remote/docs/STATUS.md` 2026-06-11 エントリ参照。
- TVer allowlist 拡張 + DL の門分離 (2026-06-12): RV-11 の手順(検証が先)どおり実エピソード 3 本(3 系列局、TVer platform API から取得)を yt-dlp 2026.03.17 `-J` で解決検証(DRM 0 / HLS m3u8_native / 無ログイン)→ §4.1 受理リストに `tver.jp` / `www.tver.jp` を追加、拒否ベクタに TVer 版(userinfo 詐称 / suffix 偽装)追加、両 repo mirror テスト同期(remote 90 件 / bot 47 件 pass)。**事前 DL は不可**: TVer は期限付き見逃し配信でローカル保存が期限・権利を迂回するため、remote に `normalize_dl`(`STREAM_ONLY_HOSTS` 除外)を新設し `/api/dl` の門を分離(再生の門は無改変)。本番実再生スモーク = 投入 11s で playing / シーク ±60s / 停止、loopback で DL 経路 400 拒否を実観測。あわせて PWA 動画画面を整理(URL 欄を再生/事前DL で 1 本化、文言を実測へ更新)し軽量仕様を `remote/docs/video-ui.md` に新設。ニコニコ前例と同じく小粒拡張のため code-reviewer レビューで代替。
