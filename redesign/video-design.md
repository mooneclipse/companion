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
キュー/プレイリスト(MVP punt、capability 拡張は §5 第2原則で新 endpoint)/ live の DVR シーク開放(初手無効、build 後に1回判断)/ ライブ先頭へ戻る / 字幕・画質手動切替 / YouTube 以外のサイト / Phase 4 キャラクター層。

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

### 3.4 IPC verb whitelist(RCE 面の一線)
`video.py` は**固定テンプレート**(loadfile replace / set pause / stop / seek abs+rel / set volume / get_property 固定リスト)のみを **`json.dumps` 構築**で送る。**`run`/`load-script`/任意 `set_property` を HTTP 層から一切受けない**。socket=`$XDG_RUNTIME_DIR/companion-video-mpv.sock` 0o600 remote 単独書き。

---

## 4. セキュリティ(security、3層 + 契約)

remote-design §2 のネットワーク層(127.0.0.1 bind + tailscale serve + token)をそのまま継承(新規外部露出なし。mpv/yt-dlp は YouTube CDN へ**外向き**接続するのみ)。F-video 固有は以下。

### 4.1 URL allowlist(唯一の外向き境界 = 絶対死守)
課金ゼロゆえ budget guard backstop が効かない → **allowlist が唯一の門**。`remote/server/urlguard.py` に bot.py `_normalize_play_url` の**ミラー複製**(冒頭に同期コメント)。bot/remote は別 repo ゆえ物理共有は YAGNI 超過 → **canonical 攻撃ベクタを本ファイル §4.1 に1箇所定義、両 repo の test が mirror して drift 検出**。

**canonical 攻撃ベクタ(確定)**:
- 拒否: userinfo 詐称(`https://evil@youtube.com/...` / `youtube.com@evil.com`) / 空白・制御文字 / `file://`・`ftp://` 等 http(s) 以外の scheme / `169.254.169.254` 等 SSRF 起点 / suffix 偽装(`youtube.com.evil.com`) / 非 allowlist host(`notyoutube.com`)
- 受理: `www.youtube.com/watch` / `youtu.be/<id>` / `music.youtube.com` / `m.youtube.com` / **`www.youtube.com/live/<id>`**(hostname 照合のみ、path で分岐しない=攻撃面を増やさない)

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

- **検出(LIVE-1 解消)**: phase は **まず `core-idle`/再生開始で判定**(RESOLVING vs PLAYING)。`duration=null` だけで loading 判定すると、**live は再生中も duration=null** ゆえ正常 live が永遠に "解決中…" 誤判定になる(devil LIVE-1)。→ **playing 確定後に `duration` を1回 read: number=VOD / None(unavailable)=live**、補助で `seekable`。capability read で1回分岐(stderr マッチ厳禁)。実 live URL の境界挙動は build 検証(§10 V-A3)、観測で変わっても property を盛る2周目に入らず1回引き直す。
- **運用穴(LIVE-2)**: live は eof で自然終了しない → 停止し忘れで TV/AVX1 デコード/CDN が無制限。**auto-stop タイマーは作らない**(cross-control/数値2周目)。**glance now-playing 常駐(§5.4)を唯一の忘れ防止 backstop** として明記。単一 lane ゆえ本数は増えず自己DoS の新規面ではない。
- **clean-fail**: ephemeral live URL(配信終了等)は既存 failed phase で clean-fail(live 専用リトライ厳禁)。lead 実証: `jfKfPfyJRdk` は "This live stream recording is not available" = 有効 live URL は ephemeral。
- live 固有の追加 security 面なし(同 allowlist/env/CDN、T-7 射程を広げない)。

---

## 8. yt-dlp churn bound(T-5、ハードストップ)

mpv 0.34.1(Mint 21.3 同梱、凍結)× yt-dlp(YouTube 仕様変更で更新を強制されるため永久 freeze 不可)の結合。bound の本質は「強制更新を**無秩序な flag 盛り/ytdl_hook patch にしない規律**」:
- **known-good ペアを台帳記録**(remote STATUS.md に「mpv ver + yt-dlp ver + 検証日 + 結果」。現行 = mpv 0.34.1 + yt-dlp 2026.03.17 + 2026-05-20)。
- 破綻シグナル = **全動画が failed**。reactive 手動差替(退避→差替→§10 スモーク再走→ロールバック可)。**prophylactic 自動更新(`-U`)禁止**。
- **非互換時は ytdl_hook.lua patch も flag 盛りもせず、(α)yt-dlp 旧版保留 or (β)mpv 更新/pre-resolve 方式へ の1回の設計判断を台帳記録してから動く**(2周目を打たない)。

---

## 9. 採用しない / 罠リスト(devil、生存分)

- **致命級ゼロ**(NEW-1/NEW-2/T-2/DV-1/T-3 は lead 実証 + 議論で溶解、撤回確定)。
- ガードレール(降格): T-5 churn(§8) / LIVE-1 検出誤判定(§7) / LIVE-2 停止し忘れ(§7) / NEW-4 resident 前提(§3.2/§6) / DV-2 sink 不可触(§6) / NEW-3 取りこぼし(§5.3)。
- 不採用: deno(§4.3) / 非同期ジョブ基盤(§1、mpv が state 所有) / lane ガード・409(§3.2、replace 単一保持実証) / auto-stop タイマー(§7) / wmctrl 配置(§3.2、fs-screen) / キュー(§0) / live DVR シーク開放(§0、初手無効)。

---

## 10. build 検証項目(実装フェーズ、lead が GUI/実機で握る)

🔴必須:
- **V-A1**: `--fs-screen=<N>` が TV(HDMI)側に全画面表示するか + idle mpv が窓を占有しないか(GUI セッション、DISPLAY 必要)。
- **V-A3**: 実 live URL での is_live/duration/seekable 実挙動 → LIVE UI 変種の最終出し分け(§7 LIVE-1)。有効 live URL を取得後1回確定。
- **V-A6**: resident mpv の RAM 実測(3.7Gi 制約での 24/7 常駐妥当性)。

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
- 実装注記 (2026-05-20): RV-1〜RV-5 を `~/companion/remote/` に実装完了(設計変更なし)。lead スモーク = 単体8テスト pass / headless mpv で IPC 実プロトコル検証 / ハンドラ層 E2E(実 mpv 接続)。GUI・実 live URL 依存の §10 build 検証は残置(SETUP §6)。詳細は `remote/docs/STATUS.md` 2026-05-20 Done エントリ。
