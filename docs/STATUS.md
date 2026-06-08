# companion-remote 開発台帳（フェーズ外単発ユーティリティ: スマホ専用リモコン PWA）

最終更新: 2026-06-08 (バージョン表記を追加 = 起動時に1回 git short hash + コミット日を確定する server/version.py + GET /api/version[Bearer 必須] + ホーム masthead の .ver 表示。ビルド工程なし[vendored 資産 + stdlib]のため版は HEAD から起動時1回読み、失敗は "unknown" フォールバック[リトライ/stderr 分岐なし=設計上限ルール準拠]。版は /api/health[無認証で情報を絞る方針]でなく authed 側に配置。文字列生成は純関数 format_version に切り出し test_version.py で 5 件検証[既存 52+5=57 全 PASS]。SW CACHE remote-v16→v17。restart 未実施[反映には systemctl --user restart companion-remote.service]。下記 Done 参照) / 2026-06-08 (F-vault ノート内画像の表示を追加 = 画像配信エンドポイント + CSP 緩和 + ローカル画像 blob 表示。原因 2 件[CSP が img-src 未指定で default-src 'self' フォールバック → clips のリモート画像 pbs.twimg.com 全滅 / サーバに画像配信経路なくローカル画像取得不可]を修正。server/vault.py に get_image[_safe_abspath の realpath+commonpath 境界判定を _resolve_in_vault に共通化、拡張子 allowlist のみ画像版に差し替え、read 専用 rb] + app.py GET /api/vault/image[Bearer 必須、403/404 写像は api_vault_get 一致、バイナリ送出は _Binary 1 型判定で icon png と同じ _send 再利用] / app.js は ![[name.ext]] → <img data-vault-img> 前処理 + DOMPurify ADD_ATTR + Bearer api() で blob fetch→object URL[src は Auth 送れないため必ず blob、再描画ごと revoke、失敗は握り潰し] / index.html CSP を img-src 'self' data: blob: https://pbs.twimg.com に緩和[inline 不許可・object-src/base-uri 維持] / SW は /api/ 既存 network-only でキャッシュ素通し、CACHE v14→v15。test_vault.py に get_image パス検証 10 件追加、全 52 件 pass。restart 未実施[反映には systemctl --user restart companion-remote.service]。下記 Done 参照) / 2026-06-03 (vault 閲覧機能 = F-vault read-only 追加。server/vault.py[realpath+commonpath traversal ガード / read 専用 / list・get・search 3 API Bearer 必須] + PWA「ノート」タイル/詳細[marked+DOMPurify クライアント描画 / wikilink ジャンプ / frontmatter 表示] + vendored marked@12.0.2・dompurify@3.0.11 + SW v12→v13、単体 42 全 pass[vault 19 件 = traversal 拒否含む] + loopback curl 往復 実観測 PASS。search は stdlib で安価ゆえ採用。下記 Done 参照) / 2026-06-03 (リモコン UI をホーム型タイルランチャー + ミニマルデザイン[紺地/朱赤]に全面リデザイン = ticket #2 完了。構造3案[下タブ/ホーム/集約]→ホーム型選定、見た目を並列デザイナー subagent 4案[温かみ/ネオン/ミニマル/家電]で発散→ミニマル選定、配色は紺地+アクセント朱赤 #d8392a 確定。選定は使い捨て mock を tailscale serve 経由で Pixel-6 実機プレビューさせて実施。app.js の状態機械/API/localStorage は全面流用し UI 構造のみ刷新、機能欠落なし、CSP/innerHTML 不使用継続、SW remote-v11→v12、Playwright 36 アサーション PASS、commit 178a9d9。下記 Done 参照) / 2026-06-03 (共用 TODO/inbox = F-todo v1-α 追加 [bot.py 非依存]。tickets.py + .state/tickets.lock flock / API 3 ルート Bearer 必須 / PWA 折りたたみカード + 件数バッジ / SW v10→v11 bump、単体 23 全 pass + loopback curl 往復 実観測 PASS。下記 Done 参照) / 2026-06-02 (第 3 作なごりリンク追加 = GAMES に :8444/nagori/ を 1 行、SW cache v8→v9 bump。下記 Done 参照) / 2026-06-02 (第 2 作ともしびリンク追加 = GAMES に :8444/tomoshibi/ を 1 行、SW cache v7→v8 bump。下記 Done 参照) / 2026-06-02 (ゲームリンク追加 = #app 最下部に折りたたみ「ゲーム」カード、GAMES 配列駆動でみちゆき:8444、SW cache v6→v7、Chromium 検証 PASS。下記 Done 参照) / 2026-06-01 (v1-β = F-1 bot.py 双方向化 RB-1/2/3 の位置づけを更新 [companion 全体 Phase 3→4 転換 + 同日追加判断: 条件 #2 を Phase 4 着手の門から外したため、凍結ではなく Phase 4 着手後の bot.py 大改変として様子見付きで入れる順序の後ろ倒し、PROJECT.md 健全性履歴 2026-06-01 entry]。F-2 voice / F-3 OS status [v1-α] は影響なし) / 2026-05-28 21:20 (RV-8 baseline 計測完了 = Wi-Fi 2.4GHz / ping IPv6 100% loss / IPv4 jitter 0.66ms。別 Live 1.07 Mbps では cache 10 秒先読み余裕 + underrun false でカクつき出ず、5 秒周期 stall は配信 bitrate 依存の新仮説。buffer 拡大は的外れの可能性高、修正は次回カクつく Live 再現時の IPC sampling 後に判断)

## 概要

スマホ (Pixel-6、Tailnet 同居) から Linux Mint 機 (miho-inspiron-3521) を「専用リモコン」として叩くための PWA + 配信サーバ。Discord アプリのアカウント切替制約を回避し、companion 機専用 UI で素早く操作することが目的。**対話完結型**(claude への指示も応答もリモコン UI で完結、Discord と行き来しない)。

- 用途: 専用リモコン (素早い open → 操作 → close)
- 対象ユーザ: miho 個人のみ (完全個人利用、家族端末・外部公開なし)
- ネットワーク境界: Tailscale 内のみ (Tailnet 外には絶対に出さない)
- 不要なもの: push 通知 / スマホハード機能 / マルチユーザ / 外部配布

## 位置付け

PROJECT.md の Phase 1〜4 ロードマップとは独立した **フェーズ外の単発ユーティリティ** (dashboard と同じ扱い)。

- **bot.py 改変方針 (設計で更新)**: 対話完結型(F-1 の claude 応答を remote UI に返す)を実現するため、当初の「bot.py 不可触」を緩め、**案B = bot.py 最小双方向化**(2本目 socket + request/response ハンドラ + 定数の最小差分、既存 notify/on_message/sessions 無改変)を採用。ただし bot.py を触るのは **F-1 のみ・v1-β(6/2後)** に限定。F-2/F-3 は bot.py 非依存。
- **Phase 2.5 健全性 2 週間観察 (2026-05-19 〜 2026-06-02) を汚さない**: bot.service restart を伴う F-1(v1-β)は観察窓後。F-2/F-3(v1-α)は bot.service 非依存で先行実装可。
- voice/ 側 bot/ 実装着手 (2026-06 上旬目処) とも独立。

## 設計

**確定設計**: `~/companion/workspace/redesign/remote-design.md` **v1.0**(2026-05-20 確定)。agent team `companion-remote-design`(architect/ux/security/devil + lead)の Round 1〜3 議論 + lead 裁定13件 + devil 最終確認(approve 可・致命級ゼロ)を経て確定。

確定の骨子:
- 責務境界 = 案B。振り分けは「claude を叩くか」の静的1ビットで設計時に1回確定(whack-a-mole 防止)。F-1=bot socket 経由、F-2/F-3=remote 直接。
- サーバ = stdlib http.server(ThreadingHTTPServer)+ ガードレール5点(RAM 3.7Gi 制約 / dashboard precedent / tailscale serve 前段)。FastAPI は不採用。
- 認証 = localStorage 永続トークン(SSH 発行→paste)+ Bearer + identity header 二段化(可能なら)。
- 実装 = ハイブリッド(v1-α 〜6/2 先行 / v1-β 6/2後)。

architect plan 全文は `workspace/redesign/remote-arch-plan-v2.md`(議論アーカイブ)。

## ディレクトリ構成（確定）

```
remote/
├── docs/STATUS.md, SETUP.md
├── server/   app.py(http.server) / auth.py / status.py / voice.py / urlguard.py / video.py / jobs.py(v1-β)
├── tests/    test_urlguard.py(§4.1 canonical ベクタ mirror + video._derive)
├── web/      index.html / app.js / style.css / manifest.json / sw.js / icons/
├── systemd/  companion-remote.service / companion-video-mpv.service(F-video 常駐 mpv)
├── .env.example / .gitignore
└── .state/   tokens.json(0o600) / jobs/(v1-β)
```

git の扱い: 現在 **(C) ローカル git のみ (remote なし、rollback 専用)**。**(B) GitHub バックアップ付きへの昇格**(= `remote add` + `push`)は voice/ パターンに揃え「実装着手と同時」(RA-7 で判断)。

## TODO

### 実装着手前 user 確認4件 → 2026-05-20 全件裁定済（design §10）
- [x] ACL allow-all 撤去 → **据え置き**(撤去せず。境界は loopback bind + token。port 単位 ACL 化は後日の独立タスク)
- [x] ufw 化 → **見送り**(本タスクスコープ外。loopback bind + ACL で足り、自己ロックアウトリスク回避)
- [x] M-14 改訂文面 → **OK**(認可趣旨ベース改訂を承認。RA-7 で PROJECT.md L373 差替え)
- [x] H-1 認可退行 → **受容**(単一ユーザ・宅内・tailnet 限定到達、budget guard backstop で課金被害は月次 cap 頭打ち)

### v1-α サブタスク（〜6/2, bot.service 非依存、1サブタスク=1commit）→ 2026-05-20 完了
- [x] RA-1: scaffold + server skeleton(http.server 127.0.0.1, /api/health, ガードレール土台, .env.example, .gitignore)
- [x] RA-2: トークン認証(auth.py, token_urlsafe 発行 CLI, tokens.json 0o600 SHA-256 保存, Bearer compare_digest, 401, Content-Length cap + chunked 拒否)
- [x] RA-3: F-3 OS status のみ /api/status(df/free/sensors/uptime 直叩き。ledger/session 由来は含めない)
- [x] RA-4: F-2 voice POST /api/say(say.sh argv 直叩き + env 隔離実証 + speaker 整数 validation + rate-limit + exit code→HTTP 写像)
- [x] RA-5: PWA(index/app.js/manifest/sw[shell-only precache, API network-only]/icons, F-2 + F-3 OS + token paste, glance=接続+OS health, CSP + innerHTML 不使用)
- [x] RA-6: systemd/companion-remote.service + SETUP.md(tailscale serve / トークン発行 / SSH revoke / §9 serve 実機検証チェックリスト)
- [x] RA-7: docs/STATUS.md 反映 + PROJECT.md L373 M-14 文面改訂(R1, user 承認済) + N-3(v1.0 改稿で充足済) + (B)GitHub 昇格判断

### F-video サブタスク（v1-α 系列、bot.service 非依存、1サブタスク=1commit）→ 2026-05-20 実装完了
設計: `~/companion/workspace/redesign/video-design.md` v1.0。再生 state は mpv 所有、PWA は `GET /api/video/state` ポーリング(ジョブ基盤不要)。
- [x] RV-1: `systemd/companion-video-mpv.service`(Type=simple, --idle=yes, Environment 隔離 PATH=/home/miho/bin, --no-config, --ytdl-raw-options=ignore-config=,no-playlist=, ytdl_path 固定, --ytdl-format 720p上限, --fs-screen=0 暫定, --input-ipc-server + UMask=0077 で 0o600, ExecStartPre stale rm)
- [x] RV-2: `server/urlguard.py`(bot.py `_normalize_play_url` ミラー + §4.1 canonical ベクタ) + `server/video.py`(mpv IPC クライアント, verb whitelist 固定テンプレート json.dumps, 1接続1確定, phase 導出) + `tests/test_urlguard.py`(canonical ベクタ + _derive 計 8 テスト pass)
- [x] RV-3: `/api/video/*` ルート追加(app.py, Bearer 必須, play/pause/resume/stop/seek/volume/state, urlguard normalize→loadfile replace, 接続不能 503 / mpv エラー 502 / 構造化応答のみ stderr パースなし)
- [x] RV-4: PWA 動画パネル(状態機械 IDLE→RESOLVING→PLAYING⇄PAUSED + LIVE モード●LIVE + RESOLVING 経過秒/目安/キャンセル/90s 文言 + close≠stop + glance now-playing 統合 + 取りこぼし中立明示)。sw.js CACHE remote-v1→v2 bump。innerHTML 不使用継続
- [x] RV-5: docs/STATUS.md + SETUP.md(mpv unit 手順 + §10 build 検証 + churn 手順)反映 + known-good ペア台帳記録 + bot `/play` 判断
- [x] **build 検証(GUI/実機、SETUP §6) 🔴必須項目 完了 (2026-05-28)**: V-A1 ✅(2026-05-20) / V-A3 VOD ✅(2026-05-20) + Live hwdec ✅(2026-05-28 hwdec=vaapi 投入後 estimated-vf-fps 27.3→60.0 / %CPU 66.7→20.0 / decoder-frame-drop=0、IPC `hwdec-current=vaapi` 確認、user TV 物理確認で平均 fps 上は解消) / **V-A6 ✅ RAM 実測**: idle 10.4 MB → 再生中 160-244 MB(3.7Gi の 6.5%、24/7 常駐妥当性 OK)。**video-zoom=-0.05 オーバースキャン補正導入** ✅: TV 実機で「ちょうどいい」確認済。🟠 dashboard BGM mpv 同居 / 720p deinterlace / 単一 lane 再確認は残(別 TODO 化せず実運用観察に任せる)。5 秒周期 Live edge 追従 stall は別軸 → 下記 RV-8 TODO へ分離。

### F-video 残課題 (2026-05-28 RV-5 build 検証で発覚、別タスク分離)

- [ ] **RV-8: Live edge 追従 stall (5 秒周期カクつき) の root cause 切り分け**: hwdec=vaapi で平均 fps は 60.0 まで回復したが、user 実機で 5 秒周期(YouTube Live DASH/HLS segment 長と一致)の固まりが残る。機械測定で `demuxer-cache-state.underrun=True` 発火 + `paused-for-cache` 反復 + estimated-vf-fps が 60.0↔37.5 を反復 = **ネットワーク受信(yt-dlp chunk 取得)がデコードに追いついていない**ことを確認。**対症療法 2 周目ガード抵触リスク高(`--ytdl-format` 480p 絞り / `--cache-secs` 数値変更 はいずれも「数値だけを動かす」修正)** なので、独断で打たず root cause 切り分けを先行する。
  - 切り分け項目: (a) Wi-Fi リンク品質(`iwconfig` signal / `ping youtube.com` jitter) (b) YouTube CDN 経路の peak bitrate vs sustained throughput (c) yt-dlp chunk 取得モード(HLS vs DASH segment 単位) (d) mpv `--cache` 設定の現状値 と挙動。
  - **2026-05-28 (c)(d) claude 側調査完了 (実機検証 (a)(b) は別ターン)**:
    - **(d) mpv 現状値 = `--cache*` / `--demuxer-readahead-secs` / `--stream-buffer-size` を service 側で一切指定しておらず mpv 0.34.1 デフォルトで稼働中**。`--cache=auto`(network media では yes) / `--cache-secs=3600000`(1 時間、容量十分) / `--demuxer-max-bytes=150 MiB`(容量十分) / **`--demuxer-readahead-secs=1.0`(先読みマージン 1 秒のみ)** / **`--stream-buffer-size=128 KiB`(fetch buffer 小)** / `--cache-pause=yes` + `--cache-pause-wait=1.0`(underrun で 1 秒 stall) / `--hls-bitrate=max` / `--network-timeout=60.0`。
    - **(c) yt-dlp は URL 解決のみ、実 chunk fetch は mpv 内 ffmpeg demuxer_lavf が逐次取得**(ytdl_hook 経由)。yt-dlp 側の `concurrent_fragment_downloads` 等の chunk 戦略変更は mpv 経由では効かない(= yt-dlp オプション層で対処は不可、レイヤを誤らない)。
    - **整合する仮説**: YouTube Live HLS は 5 秒 segment。mpv ffmpeg demuxer が次 segment fetch を待つ間に readahead 1 秒分を食い潰すと underrun → `--cache-pause-wait=1.0` で 1 秒 stall → 次 segment 取得復帰、を 5 秒周期で反復。Wi-Fi/CDN の sustained throughput が 720p60 の HLS chunk peak bitrate に追従できないと顕在化。60.0↔37.5 fps 反復は cache-pause→resume の frame 補填と整合(5 秒平均 37.5 ≒ 60×4/(4+1.6))。
    - **2 周目ガード判定の論点(user 判断待ち)**: `--cache-secs` 数値変更は 2 周目該当(数値だけ動かす)。一方 `--demuxer-readahead-secs` / `--stream-buffer-size` を **未指定 → 明示指定** に変える対応は hwdec=vaapi と同じ「新規オプション追加 = 1 周目」と解釈可能だが、実質効果は readahead buffer 拡大 = 数値動かしと等価のため判定は分岐。(a)(b) 実測で「網側に十分な平均 throughput はあるが瞬間 burst が segment fetch 内に収まらない」が確定すれば readahead 明示指定は妥当、ネット側 sustained throughput 不足なら mpv buffer 拡大しても解消せず別軸(Wi-Fi 5GHz 帯移行 / 有線化 / 480p 受容)に倒すべき。
  - **2026-05-28 21:20 baseline 計測完了 (claude 環境 = TV 直結機と判明、IPC は claude 側 python から直接取得可、socat 不在ゆえ python -c で UnixSocket)**:
    - Wi-Fi: 2.4GHz / SSID `IODATA-324230-2G` / 公称 150 Mb/s / Signal -58 dBm / Link Quality 52/70 (**5GHz 帯ではない**)
    - ping IPv4 youtube.com (rj-in-f190.1e100.net=142.251.24.190): 0% loss / avg 16.4 ms / **jitter mdev=0.66 ms** (極めて安定)
    - ping IPv6 youtube.com (tu-in-f136.1e100.net): **100% loss** ← 別の有力 root cause 候補(ffmpeg HTTP の IPv6→IPv4 fallback タイムアウトが 5 秒周期 stall に化けている可能性)
    - HTTP (curl https://www.youtube.com): 200 OK 即返却(疎通自体は正常)
    - journalctl --user -u companion-video-mpv: chunk fetch / CDN edge URL は出ない(yt-dlp の出力が Lua hook 経由で systemd journal に伝わらない設計)。CDN edge の特定は再生中 IPC 経由か yt-dlp 直叩きが必要
  - **同 21:20 別 Live (にじさんじ レオス・ヴィンセント STREET FIGHTER 6, video-bitrate 1.07 Mbps) で再生中 IPC 取得 → カクつき出ず**:
    - file-format=hls / video-codec=h264 / 1280x720 / container-fps=60.0 / **estimated-vf-fps=60.0(完全追従、frame drop なし)** / hwdec-current=vaapi
    - paused-for-cache=False / cache-buffering-state=100 / **demuxer-cache-state.cache-duration=9.78 秒(先読みに余裕)** / underrun=false / raw-input-rate=442 kBps(video+audio 合計 150 kBps を 3 倍上回り)
    - video-bitrate **1.07 Mbps** ← 格闘ゲーム配信 = 静止 UI 多い、動きの少ないシーン
  - **新仮説 (有力)**: 5 秒周期 stall は **配信側の video-bitrate に依存**。3D Live (hololive ENreco FUWAWA POV 等、カメラワーク+衣装+エフェクトで数 Mbps オーダー想定) では Wi-Fi 2.4GHz の瞬間 throughput が HLS segment burst (5 秒分を 1-2 秒で取りに行く) に追従できず underrun → cache-pause-wait=1.0 で 1 秒 stall → 次 segment 取得復帰、を 5 秒周期で反復。今回 1.07 Mbps 配信で **cache 10 秒先読み余裕 + underrun false** = buffer 容量は問題ではなく fetch 速度律速の傍証。
  - **対策方向の再評価**: mpv `--demuxer-readahead-secs` / `--stream-buffer-size` の拡大は **的外れの可能性高**(現状でも buffer 容量は 150 MB / 10 秒先読みあり)。真の対策は (i) IPv6 fallback 仮説なら `--ytdl-raw-options=force-ipv4=` 1 周目相当 / (ii) bitrate 仮説なら **ネット側** = Wi-Fi 5GHz 帯移行 or 有線化 or 480p 受容(2 周目相当、user 環境変更要)。前者は低リスク、後者は user 判断。
  - **次にカクつく Live (FUWAWA 系等) が再現したら取るべき IPC sampling** (claude 側 python で 60 秒):
    - 比較対象: 上記 baseline (1.07 Mbps / cache-duration 9.78 / underrun false)
    - 取得 props: `video-bitrate` `demuxer-cache-state` `paused-for-cache` `cache-buffering-state` `estimated-vf-fps` を 1 秒間隔
    - 判定: cache-duration が 1 秒以下に落ちる / underrun=true 反復 / paused-for-cache=true 反復 が 5 秒周期で並ぶか
    - 並行: `ping -4 -c 30 <CDN edge>` と `ping -6 -c 30 <CDN edge>` で IPv4/IPv6 差を見る(IPv6 fallback 仮説の決め手)
  - 対策候補(切り分け確定後に再評価): 480p 絞り / cache 増量 / 60fps Live を build 検証要件から外す。
  - 着手は別 session、本 RV-5 build 検証 Done とは独立。優先度は voice 統合 / Phase 2.6 Telegram 観察より下。

### F-video 追加要望（user 2026-05-21。bot 非依存 = v1-α 系列）→ 2026-05-22 実装完了（RV-6/RV-7）
- [x] **RV-6 URL 入力欄のクリアボタン**: `#video-idle` にクリアボタンを足し、`#video-url` を空に + 取りこぼし/失敗文言(`#video-ended`)もクリア。純 client UI、低リスク。
- [x] **RV-7 ±N秒スキップ + ステップ可変**: 再生中に「10秒進む / 10秒戻す」ボタン。上下ボタンでステップ秒数を可変（既定 10s）。
  - 設計メモ: 相対シークは **§3.4 verb whitelist に "seek abs+rel" として既に許可済**ゆえ RCE 面を増やさない。実装は (a) `/api/video/seek` に `relative` モード引数を足す（`seek <delta> relative`）か (b) client が `state.pos + delta` で既存 absolute seek を呼ぶ、のどちらか。(a) が素直（pos 取得待ちが要らない）。
  - ステップ秒数は **client 側 state**（localStorage 表示ヒント、token と分離）。サーバは delta を受けるだけ。
  - **live は is_live でシーク無効ゆえ ±N も非表示**（VOD/seekable のみ。§5.1 と整合）。
  - SW CACHE bump 必須。

### v1-β サブタスク（6/2 観察窓後、bot.service restart 伴う）

**2026-06-01 当面保留**: companion 全体が Phase 3 を畳んで Phase 4 (相棒層) に進む方針に転換。Phase 4 着手条件 #2 を『Telegram 移行 (5/28) を最後の bot.py 大改変として 6/11 判定』に戻したため、その前提として当面 bot.py を大きく触らない方針。remote v1-β (F-1 = bot.py 双方向化、RB-1/2/3) は Phase 4 着手の見通しが立つまで**着手保留**。設計内容は破棄せず、着手タイミングのみ後ろ倒し。F-2 voice / F-3 OS status (v1-α、bot.py 非依存) は影響なし。根拠: PROJECT.md 健全性履歴 2026-06-01 entry。

**2026-06-01 追加判断で前提更新**: 上記「6/11 判定まで当面 bot.py 凍結」の前提が変わった。同日 user 判断で **条件 #2 (2 週間観察) を Phase 4 着手の門から外す (bot.py 大改変時の様子見へ再定義)、Phase 4 は条件 #1 (vault 充足) + #3 (user 宣言) で着手可** となったため、remote v1-β は「凍結 (6/11 判定まで)」ではなく **Phase 4 着手後に bot.py 大改変として、その変更への様子見観察付きで入れる** 位置づけ。すなわち凍結ではなく「Phase 4 のキャラ作業を優先した順序の後ろ倒し」。F-2/F-3 (v1-α) は引き続き影響なし。根拠: PROJECT.md 健全性履歴 2026-06-01 entry「追加判断」section。

- [ ] RB-1: bot.py 最小双方向化(REMOTE_SOCKET=$XDG_RUNTIME_DIR/companion-bot-remote.sock 0o600, _handle_remote verb=ask/status, REMOTE_CHANNEL_ID≠0, budget guard 経由必須=M-14 核心, 既存無改変, tests 追加, restart は観察窓後)
- [ ] RB-2: remote F-1 bridge POST /api/ask(非同期ジョブ型, job_id, polling, .state/jobs/, lane 単一 in-flight ガード 409, --resume リトライ厳禁, socket timeout=bot 最長 tier 導出 + claude_lock 待ち考慮[R2])
- [ ] RB-3: F-1 PWA UI(送信→polling→結果, job_id localStorage 復元, 多重投入 disable)+ F-3 集計を verb=status に接続(glance に quota%/最終活動昇格)
- [ ] RB-4: docs/STATUS.md + remote-design.md 反映 + 健全性観察影響記録

### 実装メモ(LOW, 該当サブタスクで吸収)
- R3: 将来 F-4 vault write の endpoint を切る時、cross-process vault lock が要る(bot の in-process vault_lock では不足)
- R4: PWA の token 失効後 401 再入力 UX

## In progress

(なし)

## Done

- 2026-06-08 **バージョン表記を追加 (デプロイ版を一目で確認、orc 経由)**: OWNER が「今スマホに乗っているのが最新か」を確認できるよう、ホーム masthead にデプロイ中の版(git short hash + コミット日)を表示。直近の SW キャッシュ/画像表示変更で版ずれ確認のニーズが出たため。**ビルド工程なし(vendored 資産 + stdlib http.server)で自動更新される版**にした。
  - **A. サーバ版解決 (`server/version.py` 新規)**: `REPO_ROOT`(remote repo ルート)に対し `git rev-parse --short HEAD` と `git show -s --format=%cs HEAD`(YYYY-MM-DD)を **subprocess で起動時に1回だけ**実行し `APP_VERSION` を確定。git 不在/非 repo/非ゼロ終了/timeout は `None` → `"unknown"` フォールバック(例外で起動を止めない。成否は1回で確定、リトライ/stderr 文言マッチ/分岐の積み増しなし=`~/companion/CLAUDE.md` 設計上限ルール準拠)。**版文字列の生成は git に依存しない純関数 `format_version(short_hash, date)` に切り出し**(hash+date→`"<hash> (<date>)"` / hash のみ→`"<hash>"` / hash なし→`"unknown"`、前後空白除去)、これを単体テスト。
  - **B. エンドポイント (`server/app.py`)**: `GET /api/version`(**Bearer 必須**)を追加し `{"version": version.APP_VERSION}` を返す。ROUTES 登録・auth 適用は既存 vault route と同じ流儀。`/api/health` は無認証で情報を絞る既存方針を維持するため、版は **authed 側に配置**(home は token 設定済みでのみ版を取りに行く)。ハンドラは定数を返すだけ(リクエスト毎に git を再実行しない)。
  - **C. フロント (`web/index.html` + `app.js`)**: 既存の masthead `<div class="ver">Remote</div>` に `id="app-version"` を付与(新規 DOM 追加なし、`style.css` の `.ver` 控えめトーンを流用)。`refreshVersion()` を追加し、認証後(token 保存時 / 起動時 / token 設定済み)に `api("/api/version")` で取得して `"v<hash> (<date>)"` を表示。トークン未設定/取得失敗は `"Remote"` に戻して握り潰す(リトライループなし)。DOM は既存規律どおり `textContent` のみ(innerHTML 不使用)。
  - **SW**: app shell(index.html / app.js)更新につき `CACHE` を **remote-v16→v17** bump。SHELL は新規ファイル無しで不変。`/api/` は既存 network-only でキャッシュ素通し(`/api/version` も stale 化しない)。
  - **テスト**: `tests/test_version.py` 5 件追加(hash+date / hash のみ / hash なし→unknown / 空白除去 / `APP_VERSION` が非空文字列)。既存 52 + 5 = **全 57 件 PASS**。`py_compile`(version.py / app.py)+ `node --check`(app.js / sw.js)OK。`version.resolve()` を実 repo に対し実行 → `9b60fe9 (2026-06-08)` を確認。
  - **設計判断**: 版を authed 側(`/api/version`)に置いた(無認証 health は情報を絞る既存方針に最も寄る案。home はトークン設定済みでのみ版を表示するため authed で支障なし)。
  - **restart 未実施**: `server/*.py` 編集はメモリ常駐で `systemctl --user restart companion-remote.service` まで無反映(`/api/version` が 404 のままになる)。restart はメイン機ユーザー操作のため未実施(`web/` 静的は即反映で乖離する点に注意)。Pixel-6 実機での版表示目視は orc/user 委譲。SW v17 は次回アクセス時 skipWaiting で更新。
  - commit (下記)。push は未実施(user 実施)。

- 2026-06-08 **F-vault ノート内画像の表示を追加 (画像配信エンドポイント + CSP 緩和 + ローカル画像 blob 表示、orc 経由)**: ノート閲覧で画像が出ない問題を修正。原因は 2 つ — (1) `index.html` の CSP が `img-src` 未指定で `default-src 'self'` にフォールバックし、clips ノートのリモート画像(`https://pbs.twimg.com/...`)が全滅。(2) サーバ `vault.py` は `.md` しか配信せずローカル保存画像の取得経路がない。
  - **A. サーバ画像配信 (`server/vault.py` + `app.py`)**: `vault.py` に `get_image(rel_path)` を追加。既存 `_safe_abspath` の realpath+commonpath 境界判定を `_resolve_in_vault` に**共通化**(traversal/範囲外/symlink 脱出を 1 回確定する核は .md/画像で共有、拡張子の許否のみ呼び出し側が決める。条件分岐を積まない=設計上限ルール準拠)。画像版は拡張子 allowlist `IMAGE_TYPES`(`.jpg/.jpeg/.png/.gif/.webp` → content-type)に限定、**read 専用**(`open("rb")` のみ、書き込み/mkdir なし)。`app.py` に `GET /api/vault/image?path=`(**Bearer 必須**)を追加、`VaultError`→403(範囲外/不正/非画像)/404(not found)写像は `api_vault_get` と一致。バイナリ送出は `_Binary` ラッパを 1 回型判定し、icon png(STATIC)と同じ `_send` のバイナリ対応を再利用(JSON 経路と分岐 1 箇所のみ)。
  - **B. フロント表示 (`web/app.js`)**: ①リモート URL 画像 `![](https://pbs.twimg.com/...)` は marked が `<img src>` を生成 → CSP 緩和で表示(JS 追加なし)。②ローカル埋め込み `![[name.(jpg|jpeg|png|gif|webp)]]` は `vaultRewriteWikilinks` を拡張して `<img data-vault-img="name">` に前処理(画像埋め込みを通常 `[[...]]` より先に置換、非画像埋め込み・通常リンクは挙動不変。属性値は既存同様エスケープ)。`DOMPurify` の `ADD_ATTR` に `data-vault-img` 追加。描画後に `img[data-vault-img]` を走査し **Bearer 付き `api()`** で `/api/vault/image?path=attachments/<name>` を **blob fetch → `URL.createObjectURL` → `img.src`**(`<img src>` は Authorization を送れないため必ず blob 方式、生 src をブラウザに読ませない)。契約: bot 側は画像を vault `attachments/<basename>` 保存・本文で `![[<basename>]]` 参照、フロントは `attachments/` 固定で解釈(Obsidian `attachmentFolderPath="attachments"` と一致)。**object URL リーク防止**: ノート再描画(`vaultRenderMarkdown`)の冒頭で前回 URL を `revokeObjectURL`。取得失敗は壊れアイコンを残さずプレースホルダ alt で握り潰す(リトライループなし)。
  - **C. CSP 緩和 (`web/index.html`)**: `default-src 'self'; img-src 'self' data: blob: https://pbs.twimg.com; object-src 'none'; base-uri 'none'`。`blob:`=ローカル画像 object URL / `data:`=軽量プレースホルダ / `https://pbs.twimg.com`=clips のリモート画像(host 限定、ワイルドカード `https:` にしない)。inline 不許可・`object-src`/`base-uri` は維持。
  - **SW**: `/api/` は既存 fetch handler で network-only(`startsWith("/api/")` で return)のため `/api/vault/image` はキャッシュ素通し・stale 化しない(変更不要)。app shell 更新につき `CACHE` を **remote-v14→v15** bump。SHELL は新規ファイル無しで不変。
  - **テスト**: `tests/test_vault.py` に `get_image` のパス検証 **10 件追加**(正常 png/jpg の content-type + バイト先頭 / 非画像拡張子(.exe)拒否 / .md は画像 EP から不可 / 不在 404 / traversal `../`・絶対 path・null byte・symlink 脱出・空/非 string 拒否)。既存 42 件 + 10 = **全 52 件 PASS**。`py_compile`(vault.py/app.py) + `node --check`(app.js/sw.js) OK。
  - **設計判断**: バイナリ応答を既存 `(code, obj)` 契約に載せるため `_Binary` ラッパ + dispatch での 1 回型判定を採用(handler が自前送信して契約を崩す案より、既存 `_send` 再利用・ルートテーブル一貫の方が既存慣習に寄る)。
  - **restart 未実施**: `server/*.py` 編集はメモリ常駐で `systemctl --user restart companion-remote.service` まで無反映。restart はメイン機ユーザー操作のため未実施(`web/` 静的は即反映で乖離する点に注意)。Pixel-6 実機での画像表示目視は orc/user 委譲(token 平文を claude 側で扱わない方針)。SW v15 は次回アクセス時 skipWaiting で更新。
  - commit `06eddaa`。push は未実施(user 実施)。

- 2026-06-03 **vault 閲覧機能を追加 (F-vault、read-only、orc 経由)**: 出先から Pixel-6 で `~/companion/vault/` 配下の全 .md を**閲覧専用**で読む。tickets(F-todo)と同じ型(server module + 明示ルート Bearer 必須 + PWA タイル/詳細画面)。**vault へは read のみ・書き込み/編集 UI は一切作らない**。
  - **サーバ `server/vault.py`(read-only データ層)**: `VAULT_ROOT` を `os.path.realpath` で正規化して canonical root を 1 つ固定、env `REMOTE_VAULT_ROOT` で上書き可(既定 `~/companion/vault`)。3 API はすべて GET / Bearer 必須(`app.py` ROUTES に 3 行 + 静的 allowlist に vendored ライブラリ 2 件)。
    - `GET /api/vault/list` — `os.walk` で全 .md を再帰列挙しフォルダ別グルーピング(`{root,count,folders:[{folder,notes:[{path,name}]}]}`)。ドットディレクトリ(.obsidian/.git/.claude 等)を `dirnames[:]` in-place 除外で walk から落とす。
    - `GET /api/vault/get?path=` — 1 ファイルの生 markdown。**パストラバーサル対策 = `_safe_abspath`**: 要求 path を root と join → `os.path.realpath` で `..`/symlink を畳む → `os.path.commonpath([root,candidate]) == root`(prefix 文字列一致でなく境界で照合、`vault-evil` 兄弟誤認を回避)+ 拡張子 `.md` を検証してから open。外れたら `VaultError`。null byte / 絶対 path / 非 string も拒否。open は `"r"` のみ(書き込み/削除/mkdir なし)。
    - `GET /api/vault/search?q=` — **採用**(stdlib のみで安価)。全 .md 横断のファイル名 + 本文部分一致(大小無視)、ヒット箇所前後 40 字 snippet、結果 100 件で打ち切り。
    - 400/403/404 切り分けは構造で確定: `VaultError` のうち `"not found"` のみ 404、他(traversal/範囲外/非.md)はすべて 403(stderr/文言マッチで分岐を増やさない)。
  - **PWA(web/)**: ホームに「¶ 06 ノート」タイル + `<section id="vault">` 追加(tile-count 5→6、`SCREENS` に "vault")。一覧ビュー(検索 + フォルダ別リスト)→ タップで本文ビュー。本文ビュー内の「‹ 戻る」は一覧へ、一覧では(`data-home`)ホームへ(capture-phase で出し分け)。
    - **markdown 描画方式 = クライアント側 vendored ライブラリ**(stdlib 縛り維持・サーバで HTML 変換しない): `marked@12.0.2`(35 KB, parse) + `dompurify@3.0.11`(21 KB, sanitize)を `web/` に同梱、CSP `default-src 'self'` を満たす同一オリジン script として `app.js` 前に読み込み。**XSS 対策**: 本文は owner 自身の信頼できる vault 由来だが、レンダラ素通しを防ぐため `marked.parse` → `DOMPurify.sanitize`(style/form/input 系 FORBID、onerror/onload FORBID)を通してから `innerHTML`。app.js は本来 innerHTML を使わない規律のため、本文描画を唯一の例外として理由をコードコメントに明記。
    - **wikilink 解決**: `[[target]]` / `[[target|alias]]` を marked 前処理で `<a data-vault-link>` に置換(属性値は自前エスケープ)、DOMPurify に `data-vault-link` を ADD_ATTR 許可、クリックで同ビューア内ジャンプ。target→実 path の解決辞書は `list` 取得時に同時構築(追加フェッチ不要、name/path/拡張子なし path をキー化)。解決不能リンクは遷移せずメッセージのみ。
    - **frontmatter**: 先頭 `---...---` を本文から分離し、key/value をメタ情報として簡潔表示(本文には出さない)。
    - **SW**: `marked.min.js`/`purify.min.js` を SHELL precache に追加、`CACHE` を **remote-v12→v13** bump。manifest 変更なし。
  - **テスト**: `tests/test_vault.py` 19 件追加(list が全 .md 列挙 / ドットディレクトリ除外 / フォルダ別グルーピング / 既知ファイル get / 不在 404 / **パストラバーサル拒否 = ../・絶対 path・非.md・null byte・symlink 脱出・`root-evil` 兄弟 prefix 誤認** / search 本文・ファイル名・大小無視ヒット)。既存 23 件と合わせ **全 42 件 PASS**。
  - **動作確認**: `systemctl --user restart companion-remote.service` 後 loopback curl 往復 実観測 PASS — 無認証 list=401 / list count=82(vault の .md 全件、.claude/.obsidian/.git 除外と一致) / 既知 README.md get / `../../etc/passwd.md`=403 / `../remote/server/app.py`=403 / `game_state.json`(非.md)=403 / 不在=404 / search "tailscale"=1 件 / `/marked.min.js`・`/purify.min.js`=200。検証用 token は発行→検証後 tokens.json から該当のみ削除(実機 token `pixel-6` 温存・平文非残置)、その後 restart で無効化確認。Pixel-6 実機目視は user 委譲。
  - commit (下記)。push は未実施(user 実施)。

- 2026-06-03 **リモコン UI を「ホーム型タイルランチャー + ミニマルデザイン」に全面リデザイン (ticket #2, orc 経由)**: フラット縦積み(動画/発話/OS/やること/ゲームを 1 列に積む)でゴチャついた画面を、情報設計から作り直し。**機能は 1 つも削らず、サーバ API は無変更、見た目とナビゲーション構造のみ刷新**。
  - **選定プロセス(user 反復選択)**: ①構造 3 案(下タブ/ホーム/集約スクロール)を提示 → user「ホーム型」選定。②見た目を 0 から並列デザイナー subagent 4 人で発散(温かみ/ネオングラス/ミニマル/家電スキューモーフィック) → user「ミニマル(タイポ主導・罫線グリッド)」選定。③配色 4 種(朱/琥珀ダーク/紺&真鍮/深緑) → user「紺&真鍮(生成り地+濃紺、目に優しい)」の地を選定。④アクセント赤 3 種(朱赤/真紅/ワイン) → user「朱赤 #d8392a」確定。**選定は使い捨て mock を本番 server の STATIC に一時追加 → tailscale serve 経由で Pixel-6 実機プレビューさせて実施**(ASCII では判断不可の user feedback を受けた方式転換)。
  - **確定デザイン**: 地=生成り `#f4f2ea` / テキスト・罫線=濃紺 `#1b2a3a` / アクセント=朱赤 `#d8392a` / `--line:#ddd9cd`。ミニマル/エディトリアル骨格(2 列罫線グリッド・特大タイポ見出し・ナンバリング ▶01 等・uppercase ラベル)。**ホーム**(masthead + glance[接続ドット+disk/mem/温度の要約] + 再生中バー[再生中のみ表示・タップで動画詳細へ] + タイル 5 枚) → タイルタップで**各機能の詳細画面**(左上「‹ 戻る」)、`SCREENS` 配列 + `classList.toggle("active")` の素直な画面切替。
  - **移植方針(状態機械を壊さない)**: 現行 `app.js` の API 呼び出し・動画状態機械(IDLE→RESOLVING→PLAYING⇄PAUSED/LIVE)・ポーリング・localStorage キー・innerHTML 不使用(createElement/textContent)は**全面流用**、DOM 結線を新構造へ。glance を要約専門化 + `renderNow` を再生中バーへ昇格、todo バッジをホームの「やること」タイルへ、games/todo の折りたたみカードは廃止し詳細画面化。**CSP 厳守**(mock の inline CSS/JS を `style.css`/`app.js` に分離、index は外部参照のみ)。
  - **機能保全(5 機能、code-reviewer 確認で欠落ゼロ)**: 動画(状態機械/LIVE ●/close≠stop の可逆・不可逆/±N スキップ+ステップ可変/音量/取りこぼし・失敗文言/reopen) ・ 発話(speaker/409・429・503 文言) ・ OS status(glance 要約+詳細 dl) ・ やること(未対応バッジ/追加/完了/起票者タグ 🙋🤖) ・ ゲーム(GAMES 配列・rel=noopener)。「閉じる」は可逆セマンティクス維持しつつホームへ戻す挙動を追加。
  - **将来枠(今回は非表示=設計判断)**: vault 閲覧(#1)・done 履歴(#3) は未実装ゆえタイル/リンクを**出さない**(押せないものを出さない)。`.grid` にタイル 1 枚 + section 1 つ追加で足せる構造にし、拡張点を index.html にコメント明示。
  - **SW**: web アセット更新につき `CACHE` を **remote-v11→v12** bump(SHELL は新規ファイル無しで不変)。選定用 mock(`mock.html`/`mock1`〜`4.html`) と app.py の一時 STATIC エントリ(**未コミットだったため削除で HEAD と一致 = app.py 無変更**)、使い捨て検証スクリプトは撤去済み。
  - **検証**: Playwright/Chromium(390x844, 本番ポート 47824) で **36 アサーション ALL PASS**(token 未設定→token-setup → ダミー注入→ホーム → 5 タイル各々詳細遷移→戻る / 朱赤 `--acc=#d8392a`・紺地 CSS 適用 / 各画面 横はみ出しなし / pageerror 0 / 動画 resolving・transport[VOD は seekrow+skiprow]・LIVE[badge 表示・seek/skip 非表示] の各 view / 再生中バー表示+タップ遷移)。検証用一時 token は発行→検証後に tokens.json から該当のみ削除(実機 token `pixel-6` 温存・平文非残置)。**server restart 実施済**(`/` 200・`/mock` 404 で mock 撤去確認)。**code-reviewer 修正必須なし**(軽微提案 1 = `goHome()` 配置は動作正常ゆえ見送り)。
  - **未実施(user 委譲)**: Pixel-6 実機での新 UI 目視・操作確認(token 平文を claude 側で扱わない方針)。SW v12 は次回アクセス時 skipWaiting で更新。
  - commit `178a9d9`。push は未実施(user 実施)。

- 2026-06-03 **共用 TODO/inbox(チケット)機能を追加 (F-todo、v1-α 系列 = bot.py 非依存、user 要望)**: user と AI(claude セッション) 共用の inbox。user は PWA で起票 → 番号 `#N` が振られ「#N やって」とセッションで AI に渡せる。AI は稼働中に思いついたら CLI で起票し、user は件数バッジで気づく。「Tailscale 通したときだけ見える」要件は既存リモコン(tailscale serve + Bearer token + PWA shell)への相乗りでゼロコスト充足。
  - **実体 = single source of truth `.state/tickets.json`**(0o600, git 外、tokens.json と同居)。`server/tickets.py` がデータ層 + CLI。server(常駐 ThreadingHTTPServer)と claude CLI(別プロセス)が競合して書くため `.state/tickets.lock` の `fcntl.flock(LOCK_EX)` で read-modify-write 全体を囲み、採番(next_id)を flock 内で 1 回引いて確定(`~/companion/CLAUDE.md`「条件分岐は state 側で 1 回確定」準拠、対症療法 2 周目を打たない)。`_load` は壊れ JSON を空正規形に復元 + next_id を max(id)+1 で復元。id は連番・再利用しない。
  - **API**(`server/app.py` ROUTES に 3 行、全て Bearer 必須): GET `/api/todo`(done 除く一覧 + counts) / POST `/api/todo`{text}(起票 by=user) / POST `/api/todo/status`{id,status}(状態変更)。400/404 切り分けは「id/status を先に検証 → 残る TicketError = 該当なし = 404」と構造で確定(stderr/文言マッチで分岐しない)。
  - **状態 3 段階** todo/doing/done。doing は主に AI が `start` で立てて進捗可視化。done は active 一覧から外れ tickets.json に履歴として残る(完了は一覧から消える + 履歴保持、user 確定仕様)。
  - **PWA**(index.html/app.js/style.css): 折りたたみ「やること」カード(ゲームカードと同形のトグル click + Enter/Space、既定畳む)。見出しに未対応(todo+doing)件数バッジを常時表示、各行に番号 `#N` + 起票者タグ(🙋user / 🤖ai) + 完了ボタン。15s ポーリングでバッジ更新(展開中は一覧も)。`api()` ヘルパ流用、innerHTML 不使用継続。**SW CACHE remote-v10→v11 bump**。
  - **CLI**(claude セッション用): `python3 server/tickets.py add "text" [--by ai]`(既定 user) / `list [--all]` / `show <id>` / `start <id>` / `done <id>`。
  - **検証**: 単体 16 テスト追加(採番連番 / by・status デフォルト / 遷移 / done 除外 / 不正 status 拒否 / counts / 並行 add 30 スレッド衝突なし)+ 既存 urlguard 7 と合わせ **23 全 pass**。server `systemctl --user restart` 後に loopback curl で 3 ルート 401(再起動忘れ 404 でないこと確認)→ 一時 token で認証込み往復(add → doing → done で active から消える / bad status 400 / missing id 404 / empty text 400)を**実観測 PASS**。CLI 往復も観測。code-reviewer 修正必須なし。検証用データはクリーンアップ済(一時 token 破棄・pixel-6 温存・tickets.json は空から運用開始)。
  - **運用フロー**: user が PWA 起票 → `#N` → セッションで「#N やって」 → AI が `tickets.py show N` で詳細 → `start N`(着手中) → 作業 → `done N`。逆に AI が `tickets.py add --by ai "…"` で起票 → user はバッジで気づく。
  - **未実施(実機 / user)**: Pixel-6 実機での PWA 起票 → 一覧 / バッジ → 完了 UI 確認(token 平文を claude 側で扱わない設計に沿い user に委ねる、RA-7 と同方針)。SW v11 は次回アクセス時 skipWaiting で更新。
- 2026-06-03 **第 4 作「あかり」リンク追加 (`/newgame` 自走)**: companion-games 第 4 作あかり (明度がリソースのデッキ構築ローグライク、シリーズ方向転換作) への導線を `GAMES` 配列に 1 行追加。URL = `https://miho-inspiron-3521.tail5e989b.ts.net:8444/akari/` (同一サーバ・同一ポートで `/akari/` prefix 配信、みちゆき `:8444/`・ともしび `/tomoshibi/`・なごり `/nagori/` は不変)。`renderGames` が `rel=noopener` を一様付与するため個別対応なし。
  - app.js 変更につき **SW CACHE を remote-v9→v10 に bump** (cache-first の旧 shell を更新)。SHELL は新規ファイル無しで変更不要。web 静的なので server 再起動不要・即配信、SW は skipWaiting で次回アクセス時に更新。
- 2026-06-02 **第 3 作「なごり」リンク追加 (`/newgame` 自走)**: companion-games 第 3 作なごり (指でなぞって消えない道を描き、霧の淀みを繋いで自分の一筆を俯瞰する) への導線を `GAMES` 配列に 1 行追加。URL = `https://miho-inspiron-3521.tail5e989b.ts.net:8444/nagori/` (同一サーバ・同一ポートで `/nagori/` prefix 配信、みちゆき `:8444/`・ともしび `/tomoshibi/` は不変)。`renderGames` が `rel=noopener` を一様付与するため個別対応なし。
  - app.js 変更につき **SW CACHE を remote-v8→v9 に bump** (cache-first の旧 shell を更新)。SHELL は新規ファイル無しで変更不要。web 静的なので server 再起動不要・即配信、SW は skipWaiting で次回アクセス時に更新。
- 2026-06-02 **第 2 作「ともしび」リンク追加 (user 質問起点)**: companion-games 第 2 作ともしび (呼びかけると世界が応える歩行ゲーム) への導線を `GAMES` 配列に 1 行追加。URL = `https://miho-inspiron-3521.tail5e989b.ts.net:8444/tomoshibi/` (games は同一サーバ・同一ポートで `/tomoshibi/` prefix 配信、みちゆき `:8444/` は不変)。`renderGames` が `rel=noopener` を一様付与するため個別対応なし。
  - app.js 変更につき **SW CACHE を remote-v7→v8 に bump** (cache-first の旧 shell を更新)。SHELL は新規ファイル無しで変更不要。
  - 検証: `node --check` 構文 OK / code-reviewer 全観点 OK (修正必須なし)。web 静的なので server 再起動不要・即配信、SW は skipWaiting で次回アクセス時に更新。

- 2026-06-02 **ゲームリンク追加 (user 要望)**: companion-games (umbrella「全部 AI で作るゲーム」) のゲームへ、リモコンからアドレスをコピペせず飛べる導線を追加。
  - `#app` 最下部に折りたたみ「ゲーム」カード。リモコン機能(動画/発話/OS status)の邪魔をしないよう **既定で畳む**(タップで一覧展開→各ゲーム名タップで開く、数タップ)。glance トグルと同じ作法(click + Enter/Space keydown, `aria-expanded` + `.open` chevron)。
  - 一覧は `app.js` の `GAMES` 配列駆動(`createElement`/`textContent` のみ、innerHTML 不使用の既存慣習)。第 2 作以降は配列に 1 行追加。現状: みちゆき → `https://miho-inspiron-3521.tail5e989b.ts.net:8444/`(別オリジン = games サーバの別ポート、`rel=noopener` の単純 `<a>` ナビ。CSP `default-src 'self'` はトップレベルナビには効かず fetch もしないので境界に反しない)。games 本番ポート(現 8444)が変わったら `GAMES` の 1 箇所を直す。
  - index.html/app.js/style.css を変更したので **SW CACHE を remote-v6→v7 に bump**(cache-first の旧 shell を更新)。SHELL リストは新規ファイル無しのため変更不要。
  - 検証: Chromium(games の playwright 借用)で 既定畳み→展開で みちゆき リンク href/rel 一致→再畳み、pageerror 0 を PASS。code-reviewer 全観点 OK(修正必須なし)。
  - 関連: ゲーム側に v1 で「トップにバージョン番号表示」要望あり(キャッシュ問題か検証不足かの切り分け用)。games repo 側で対応 → `games/docs/STATUS.md`。

- 2026-05-28 **RV-5 build 検証 🔴必須項目 完了 + 5 秒周期 stall を RV-8 別タスク化**
  - **V-A1 ✅**(再確認、2026-05-28): VOD URL (YouTube 切り抜き 5 分強) を PWA から投入 → TV(HDMI-1)全画面 720p 再生 / `is_live=false` / `seekable=true` / pos 進行 / dashboard BGM mpv (別 socket、9:00 終了後で停止中) と非競合。
  - **V-A3 Live hwdec ✅**(2026-05-28): hololive ENreco Live URL (FUWAWA POV) を投入、`systemctl --user restart` で新 ExecStart(`--hwdec=vaapi --video-zoom=-0.05`) 反映後の同 URL 再投入で IPC `hwdec-current=vaapi` を確認。**estimated-vf-fps 27.3→60.0 (container 60.0 に完全追随) / %CPU 66.7→20.0 (top) / RSS 223→160 MB / decoder-frame-drop=0 維持**。ソフトデコードでは捌けなかった 60fps デコード CPU 負荷をハードに逃がす本筋対応。
  - **V-A6 ✅**(2026-05-28): resident mpv RAM 実測。idle 10.4 MB / 再生中 160-244 MB(3.7Gi の 6.5%)、24/7 常駐妥当性 OK。
  - **video-zoom=-0.05 ✅**(2026-05-28): TV オーバースキャン補正、user 実機で「ちょうどいい」確認済(IPC `set_property video-zoom -0.05` 即時適用 → service file 永続化)。値は 1 回確定、刻まない。
  - **5 秒周期 Live edge stall → RV-8 別タスク化**: hwdec=vaapi 投入後も user TV 実機で 5 秒周期(YouTube Live DASH/HLS segment 長と一致)の固まりが残る。機械測定で `demuxer-cache-state.underrun=True` + `paused-for-cache` 反復 + estimated-vf-fps が 60.0↔37.5 を反復 = ネットワーク受信側の問題と切り分け確定。**対症療法 2 周目ガード抵触リスク高**(`--ytdl-format` 480p 絞り / `--cache-secs` 増量 はいずれも「数値だけを動かす」修正に該当)ゆえ独断で打たず、root cause 切り分け(Wi-Fi 品質 / 経路 / yt-dlp chunk 戦略 / mpv cache 設定)を先行する。TODO RV-8 へ分離、別 session 着手、優先度は Phase 2.6 Telegram 観察 / voice 統合より下。
  - **build 検証 SETUP §6 残🟠(別 TODO 化せず実運用観察に任せる)**: dashboard BGM mpv 同居(別 socket だが PulseAudio sink / 全画面競合は朝 5:30-9:00 で目視)/ 720p deinterlace 1080i 画質(progressive 動画では未検証、必要時に観察)/ 単一 lane 実機再確認(`pgrep -af yt-dlp` 本数)。
  - 設計反映: `~/companion/workspace/redesign/video-design.md` §3.5 実機検証結果(後続 commit) + 改版履歴。

- 2026-05-28 **F-video mpv チューニング(hwdec=vaapi + video-zoom=-0.05)を service に追加**
  - **hwdec=vaapi**: V-A3 Live URL 再生で `hwdec-current=no` のまま frame-drop 690 / estimated-vf-fps 27.3 (container 60.0) を観測。ソフトデコードでは Live 60fps を捌けないことが定量で確定したため有効化。i3-3217U(Ivy Bridge GEN7)+ Intel HD Graphics 4000 は VA-API 対応世代、ホストに `i965-va-driver` インストール済(`/usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so` 存在を確認)。**新規オプション 1 つの追加 = 対症療法 2 周目ガード非該当(1 周目)**。
  - **video-zoom=-0.05**: TV オーバースキャン補正(画面端の見切れ解消)。user 実機で「ちょうどいい」確認済。dashboard BGM mpv(別 unit)には影響しない。値は 1 回確定で刻まない。
  - **検証**: service 編集後 `systemctl --user daemon-reload` → `systemctl --user show companion-video-mpv.service -p ExecStart` で `--hwdec=vaapi` と `--video-zoom=-0.05` 反映を確認。
  - **実 restart は本対応では未実施**: 現プロセス PID 239162 稼働中、user が Live URL 再投入時に frame-drop / hwdec-current の再判定段を lead が握る。
  - **V-A6 ✅**: resident mpv RAM 実測 183-244 MB(3.7Gi の 6.5%、24/7 常駐妥当性 OK)。
  - 設計反映: `~/companion/workspace/redesign/video-design.md` §3.5(hwdec)/ §3.6(video-zoom) + 改版履歴。
- 2026-05-22 **F-video 追加要望 RV-6（URL クリアボタン）+ RV-7（±N スキップ/ステップ可変）実装完了**
  - RV-6: `#video-idle` にクリアボタン。`videoClear` で `#video-url` を空に + `#video-ended`/`#video-play-err` 文言 + 直前 URL ヒント(`V_LASTURL_KEY`)をクリア。last URL も消さないと poll 次 tick の `renderIdle` で文言/再投入が復活するため一緒に落とす。純 client UI。
  - RV-7: 設計メモ採用案 (a)。`/api/video/seek` に `{delta}` 相対モードを追加し `video.seek(amount, relative=True)` → mpv `seek <delta> relative`(verb whitelist「seek abs+rel」内、RCE 面据え置き)。負 delta 許可・`abs<=86400` で範囲制限、範囲外は mpv が clamp（成否1回確定・条件積みの2周目を打たない）。ステップ秒(5/10/30/60s, 既定 10s)は client `localStorage`(`V_STEP_KEY`, token と分離)、サーバは delta を受けるだけ。`seekable=VOD` のみ `#video-skiprow` 表示（live は §5.1 で非表示、`#video-seekrow` と同条件）。
  - 検証: `python3 -m unittest discover -s tests` で 8 テスト pass、`py_compile` OK。code-reviewer 修正必須なし。sw.js CACHE v4→v5 bump。
  - 実機確認(2026-05-22, ユーザー在席)で 3 件の不具合を発覚 → 即修正:
    - ① **クリアボタン行のレイアウト崩れ**: `#video-play` を `.row` 内に入れたのに `margin-top` 規則に残り `.row` の margin と二重がけで縦ずれ → 規則から外し `.row` に一本化(style.css)。
    - ② **再生が前回 pause を継承**(F-video 本体の既存不具合): mpv `pause` は global property で `loadfile` 跨ぎ保持されるため、前回一時停止のまま閉じると次の再生も pause で始まる。`play()` の loadfile に per-file option `pause=no` を付け継承を断つ。実機で再現/復帰確認、mpv 0.34.1 構文確認(video.py)。global pause property は書き換えず pause/resume 経路と独立、成否 1 IPC 確定。
    - ③ **±N スキップ無反応 → 真因はサーバ未再起動**: 当初キャッシュを疑ったが誤り。ステップ秒の上下ボタン(`changeStep`, 純 client)は効くのにスキップ(`videoSkip`, サーバ叩く)だけ効かない、で切り分け確定。`companion-remote.service`(user service)は 2026-05-20 起動のまま稼働し**旧 `app.py` がメモリ常駐**、`{delta}` 分岐が無く 400。静的 `web/` はリクエスト毎ディスク配信ゆえ client だけ新版だった。`systemctl --user restart companion-remote.service` で新コード反映(②pause=no・RV-7 サーバ側もこの再起動で初反映)。sw.js v5→v6 bump は client 新版置換の保険として有効(無害)。
  - **運用知見**: remote の `server/*.py` 編集は `systemctl --user restart companion-remote.service` するまで無反映(Python メモリ常駐)。`web/` 静的ファイルは即反映なので「UI は変わったのに API 挙動が古い」と乖離する。→ §8 churn 手順 / CLAUDE.md 反映候補。
  - 残: 再起動後の実機確認(±N スキップ実動 / レイアウト揃い / 再生が pause で始まらない)。朝 dashboard 稼働(5:30〜9:00)を避ける。
- 2026-05-21 **F-video アーカイブ再生不能を修正（mpv try_ytdl_first=yes）**
  - 症状: 配信終了後アーカイブ（was_live VOD）が PWA から再生できず、解決中表示のあと idle に戻る。
  - 切り分け: yt-dlp `-g` 単体・standalone mpv（フル env）・headless idle+IPC では再生到達。**実 service（systemd 最小 env + 実 vo/HDMI）でのみ ~5秒で idle に中断**（清浄・単一 lane でも再現、競合ではない）。
  - 根本原因: mpv 0.34.1 既定 `ytdl_hook-try_ytdl_first=no` は youtube URL をまず ffmpeg で直開き→必ず失敗→`on_load_fail` で yt-dlp フォールバックする。**実 vo 環境では直開き失敗後・フォールバック完了前に load が idle 中断**され、解決の遅いアーカイブ（yt-dlp 解決 18〜37s と高分散）で顕在化。速い VOD/live はフォールバックが間に合っていた。
  - 修正: service の `--script-opts` に `ytdl_hook-try_ytdl_first=yes` を追加（最初から yt-dlp を呼ぶ＝失敗状態を経由しない、無駄な直開きも消え僅かに高速化）。条件追加・stderr 分岐・リトライ増の 2周目ではなく load 戦略を正す単一オプション。
  - 検証: 実 service mpv にアーカイブ投入 → **t+23s で再生到達**（修正前は t+5s で idle）。standalone でも t+7s 再生確認。
  - 補足: yt-dlp 解決は内蔵 jsinterp で 6/6 成功するが 7〜37s と高分散（ネットワーク律速、node でも改善せず・service PATH に node 無し）。JS ランタイム deprecation 警告は現状ブロックせず、§8 churn の watch 項目として継続。
- 2026-05-20 **F-video build 検証（GUI 実機、V-A1/V-A3 ✅ / V-A6 未了）**
  - **V-A1 ✅**: `--fs-screen=0`(数値 index)はノート本体(LVDS-1=primary)を掴んだ → **出力名指定 `--fs-screen-name=HDMI-1` で TV へ全画面確定**(xrandr: HDMI-1 1920x1080 820x460mm=TV)。idle mpv は `--force-window=no` で窓非占有。実機で TV 全画面 + シーク + 音 OK。脆い数値 index でなく権威ソース(出力名)で決定論化。
  - **V-A3 ✅**: live 検出の当初案「duration=None=live」が **DVR バッファ長を有限 duration で返す**実挙動(46→104→178s と伸長)で外れた。設計 §7 予告通り property を盛らず **`seekable` を主シグナルへ1回引き直し**(`is_live = playing and not seekable`、live=seekable False / VOD=True)。実機で live=●LIVE/シーク無効/pause 有効、VOD=シーク可。
  - **付随バグ修正**: ① `[hidden]` 属性が `.row{display:flex}` に specificity で負け live 時シークバーが残る → CSS `[hidden]{display:none!important}`。② 配信終了/再生不可 URL の clean-fail 時、投入直後の失敗だけ「読み込めませんでした…」と明確化(client 遷移=resolving→idle で playing 未到達、を判定。stateless は崩さない。再開時の取りこぼしは従来の中立文言を維持)。SW CACHE remote-v1→v4。
  - **V-A6 未了**: resident mpv RAM 実測。現状 `systemctl --user start` のみ(`enable` 保留)。RAM 妥当性確認後に boot 自動起動を確定する。
  - 🟠残: dashboard BGM mpv 同居 / 720p deinterlace / 単一 lane 再確認。
  - **アーカイブ視聴**: → 2026-05-21 Done エントリで解決（try_ytdl_first=yes）。配信直後の post_live 処理中は YouTube 側でアーカイブ未公開のため依然 clean-fail（時限、待てば視聴可）。
- 2026-05-20 **F-video（動画プレイヤー）実装完了（RV-1〜RV-5、bot.service 非依存 = v1-α 系列）**
  - 設計 `video-design.md` v1.0 の確定設計どおり実装。Discord `/play`→`xdg-open`→ブラウザ（再生後操作不能）を置き換える、mpv 0.34.1 + yt-dlp ytdl_hook ベースの再生 + pause/seek/音量/停止制御。
  - **RV-1** 常駐 idle mpv unit。**RV-2** urlguard（bot.py ミラー、§4.1 canonical 攻撃ベクタ）+ video.py（IPC verb whitelist 固定テンプレート、PulseAudio sink 不可触、ytdl_hook ゆえ署名付き stream URL を見ない）+ test。**RV-3** `/api/video/*` 7 endpoint。**RV-4** PWA 動画パネル（LIVE モード / RESOLVING UX / close≠stop / glance now-playing / 取りこぼし中立明示）。**RV-5** docs。
  - **スモークテスト（lead、DISPLAY 不要分）**: ① urlguard/video 単体 8 テスト pass ② headless mpv（`--vo=null --ao=null`）で IPC 実プロトコル検証（state 導出 / pause/volume/stop verb 写像 / socket 0o600 確認）③ ハンドラ層 E2E（実 mpv 接続で play allowlist 受理/拒否・seek/volume validation・503/502/400 写像・state 集約を確認）。
  - **未実施（GUI/実 live URL 依存、SETUP §6 = build 検証へ）**: V-A1 `--fs-screen` TV 全画面 + idle 窓非占有 / V-A3 実 live URL 挙動 / V-A6 resident mpv RAM 実測。lead がユーザー在席時に握る（朝 dashboard 稼働中は避ける）。
  - 各サブタスクで code-reviewer レビュー（結果は本エントリ更新時に反映）。
- 2026-05-20 **known-good ペア台帳（yt-dlp churn bound、video-design §8）**
  - **mpv 0.34.1（Mint 21.3 同梱、凍結） + yt-dlp 2026.03.17 + 検証日 2026-05-20 + 結果: 単体/IPC/ハンドラ E2E スモーク pass（実再生は build 検証で確認）**。
  - 破綻シグナル = 全動画が failed。reactive 手動差替（旧版退避→差替→§10 スモーク再走→ロールバック可）。**`yt-dlp -U` 自動更新は禁止**。非互換時は (α)yt-dlp 旧版保留 or (β)mpv 更新/pre-resolve への 1回の設計判断を本欄に記録してから動く（2周目を打たない）。
- 2026-05-20 **bot `/play` の deprecate 判断 = 据え置き（撤去せず）**
  - bot.py 改変は v1-β（6/2 健全性観察窓後）に限定する方針（本 STATUS「位置付け」）と整合。F-video の build 検証（V-A1 TV 全画面実機確認）が pass し実運用に乗るまでは Discord `/play` を残し、両系統併存とする。撤去/リダイレクトの最終判断はユーザー裁定（build 検証 pass 後に F-1 v1-β とまとめて bot.py を触るタイミングで再検討）。
- 2026-05-20 **実機デプロイ + serve 疎通検証**
  - systemd user service 配置・`enable --now`(active、起動時自動起動も登録)。`ss` で 127.0.0.1:47824 のみ listen を確認。
  - `tailscale serve --bg 47824` で公開 → `https://miho-inspiron-3521.tail5e989b.ts.net/`(tailnet only)。**注意**: 初回に「Serve is not enabled on your tailnet」警告が出るが続けて Success し実際に稼働する(curl 実 CA 検証通過)。
  - **§9 検証済**: d-1 ルート `/` マウント(index/manifest/sw/icons 配信)✅ / d-3 ::1 疎通(serve→127.0.0.1)✅ / TLS 実 CA 証明書 ✅ / token 無 `/api/status` 401 ✅ / **d-4 say.sh audio ✅**(voice engine 0.25.2 起動後、remote service 実環境から抽出した最小 env で say.sh exit 0 = 合成+再生 OK。PULSE_SERVER は env に無いが XDG_RUNTIME_DIR/pulse 経由で paplay 到達)。
  - **§9 残**: d-2 identity header(echo endpoint が無く未確認、H-1 は token+ACL で受容済なので必須でない)。
  - PWA は Pixel-6 にインストール済(2026-05-20、user 確認)。OS status / glance 動作確認済。
  - トークン発行は user 自身が `auth.py issue pixel-6` で実施(会話ログに平文を残さないため)。
- 2026-05-20 **v1-α 実装完了（RA-1〜RA-7、各サブタスク 1commit + code-reviewer レビュー）**
  - RA-1 server skeleton(http.server 127.0.0.1:47824, /api/health, ガードレール (i)(ii)(v) 土台)。RA-2 トークン認証(auth.py 発行 CLI, tokens.json 0o600 に SHA-256 保存, Bearer compare_digest, Content-Length cap + chunked 拒否)。RA-3 F-3 OS status(/api/status, df/free/sensors/uptime, ledger 非参照=H-2)。RA-4 F-2 voice(/api/say, say.sh argv 直叩き + env 隔離をスモークで実証, exit code→HTTP, rate-limit)。RA-5 PWA(発話/OS status/token paste/glance, CSP + innerHTML 不使用, SW shell precache + API network-only, icons)。RA-6 systemd service + SETUP.md。RA-7 台帳反映。
  - 各サブタスクで code-reviewer レビュー(修正必須ゼロ、軽微提案は反映 or 台帳記録)。スモークテストは全サブタスク実施(認証/413/chunked/env 隔離/静的配信/traversal 404 等)。
  - **未実施(実機依存、SETUP §9)**: tailscale serve 実機疎通(d-1 ルートマウント / d-2 identity header / d-3 ::1 / d-4 say.sh audio env)。systemd enable + serve 設定は SETUP.md の手順で user 実施。
  - **N-3**: remote-design v1.0 改稿時点で §2.3 が「UI 失効 endpoint は作らない」と正記載済のため、削除対象の stale 記述なし(充足済)。
  - **R1**: PROJECT.md L373 M-14 文面を承認済み改訂案(認可趣旨ベース)へ差替え済。
- 2026-05-20 **(B)GitHub 昇格は見送り、(C) ローカル git のみ継続**(user 判断)。workspace/web と同じ rollback 専用、GitHub remote は意図的に付けない。昇格は後日判断でも可。
- 2026-05-20 **設計議論完了 / remote-design.md v1.0 確定**
  - agent team `companion-remote-design`(architect/ux/security/devil + lead)で Round 1〜3。
  - 致命級 D-1/D-2(案Z+bot.py不可触+F-1会話の三つ巴矛盾)を devil が摘出 → user 差し戻しで対話完結型 + 案B 確定。H-1(認可退行)/H-2(派生原則自己違反)も cross-review で摘出・対処。lead 裁定13件、devil 最終確認 approve 可(致命級ゼロ、残課題 R1〜R4 は実装スコープに畳み済)。
  - 成果物: remote-design.md v1.0 + remote-arch-plan-v{1,2}.md(議論アーカイブ)。
- 2026-05-20 `remote/` をローカル git のみ (remote なし、rollback 専用) で先行 git 化
  - **やったこと**: `git init -b main` + user 設定 + gitleaks pre-commit フック配置 + `.gitignore` 作成 + `gitleaks dir` で no leaks 確認 + 初回 commit。**GitHub remote は意図的に付けない**

## 既知の問題

- **H-1 F-1 認可退行**(設計確定済・**2026-05-20 user 受容済**): F-1 は run_claude 直呼びで on_message の OWNER_ID チェックを通らず、token+ACL(+identity header)の認可で Discord 経路の OWNER_ID 二重より一段弱い。緩和=identity header 二段化 + budget guard backstop(課金月次 cap)+ SSH 失効。F-1 自体は v1-β(6/2 観察窓後)実装なので v1-α には未出現。

## 運用注記

- **Tailscale funnel は絶対に叩かない** (外部公開コマンド、誤発射防止のため `.claude/settings.json` で deny 済)
- サーバは `127.0.0.1` バインドのみ、外向き口は `tailscale serve` 経由だけ
- **web/ アセット(index/app.js/style.css 等)を更新したら `web/sw.js` の `CACHE` を 1 つ上げる**(SW は shell cache-first のため、bump しないと旧版を掴む)
- スマホ紛失時の revoke 手順(2系統): ①Tailscale 管理画面で pixel-6 を device disable(第一手・最上流) ②SSH で `remote/.state/tokens.json` を空に + service restart。**UI 経由のトークン無効化 endpoint は作らない**(漏洩端末から叩ける循環参照のため、N-3 で確定)。
