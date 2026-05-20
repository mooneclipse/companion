# remote-design.md (companion-remote 確定設計)

version: **v1.0 (確定版)** — agent team `companion-remote-design` (architect/ux/security/devil + lead) の Round 1〜3 議論を経て確定。
作成: 2026-05-20
ステータス: **設計確定**。実装着手前に §10 の user 確認4件を要する。実装は §7(v1-α)→ §8(v1-β)の順。
議論アーカイブ: team plan は cleanup で消滅。本ファイル + `remote-arch-plan-v{1,2}.md`(architect plan 転記)が成果物。

---

## 0. 目的と非目的

### 目的
スマホ (Pixel-6, Tailnet 同居) を Linux Mint 機 (miho-inspiron-3521) 専用の軽量リモコンにする。素早い open → 操作 → close。完全個人利用 (miho 1人)。Discord アプリのアカウント切替制約を回避し、**対話完結型**(claude への指示も応答もリモコン UI で完結)で使う。

### 非目的
push 通知 / バックグラウンド処理 / スマホハード活用 / 外部公開(Tailnet 外) / マルチユーザ / ストア配布 / Phase 4 キャラクター層。

---

## 1. 確定要件

| 項目 | 確定内容 | 根拠 |
|---|---|---|
| 構成 | PWA + Tailscale Serve | user 確定 (brief §1) |
| 要求粒度 | **(iii) 対話完結型** — F-1 の claude 応答も remote UI に返す | user 確定 (2026-05-20)。Discord 応答案D は却下「Discord と行き来しない」、テレビ前にいない時も使うため |
| 責務境界 | **案B** = F-1 は bot 経由(bot.py 最小双方向化)、F-2/F-3 は remote 直接 | user 確定。§5 |
| MVP 機能 | F-1(claude に任意テキスト) / F-2(voice 発話) / F-3(ステータス) | user 確定 |
| 認証 | a = localStorage 永続ランダムトークン + Bearer | user 確定。§2.3 |
| 実装順 | **ハイブリッド**: v1-α(〜6/2 先行, bot.service 非依存) → v1-β(6/2後, bot.py 改変) | user 確定。Phase 2.5 健全性観察(〜6/2)を汚さない |
| サーバ実装 | **stdlib http.server (ThreadingHTTPServer)** | architect 推奨 + security 裁定。§3.1 |
| ブラウザ | Chrome / dev 経路 = SSH ポートフォワード | brief default |

---

## 2. セキュリティ3層

### 2.1 ネットワーク層
- サーバは **127.0.0.1 (+ ::1) バインドのみ**。0.0.0.0 / tailnet IP 厳禁(x11vnc が tailnet IP 直バインドしているのは反面教師)。
- 外向きは `tailscale serve https` だけ。`tailscale funnel` 絶対禁止(settings deny 済)。
- デプロイ後 `ss -tlnp` で 127.0.0.1/::1 以外に listen していないことを検証。
- ufw 化は **本タスクスコープ外**(既存 inbound = x11vnc 5900 等への自己ロックアウトリスク、§10 で user 判断)。loopback bind で境界は閉じる。

### 2.2 アクセス層 (Tailscale ACL)
- **2026-05-20 user 裁定: default allow-all は据え置き**(撤去は tailnet 全体 = m-gamepc 含む既存デバイス間通信に波及するため見送り、§10)。境界は §2.1 loopback bind + §2.3 アプリ層トークンで担保し、ACL 単独には依存しない。
- port 単位 ACL(pixel-6 → remote-host:443 のみ、x11vnc 5900 を pixel にすら開けない最小権限)への絞り込みは**後日の独立タスク**に切り出す(本タスクスコープ外)。allow-all のままだと tailnet 内の他端末は 443 に到達はできるが `/api/*` は token 無しで 401、static のみ可視。
- tag 運用・tailnet lock は不採用(個人3台で過剰)。

### 2.3 アプリ層 (認証 a)
- `secrets.token_urlsafe(32)` を SSH 発行 CLI で生成 → `remote/.state/tokens.json` (0o600) → PWA に **1回 paste → localStorage 保存**(out-of-band bootstrap、ネットワークを流れない)。
- Bearer 検証は `secrets.compare_digest`(定数時間)。不一致 401。static (/, manifest, sw.js) は無認証、`/api/*` のみ Bearer 必須。
- **identity header 二段化**(可能なら): HTTP edge で Bearer AND `Tailscale-User-Login == mr.mooneclipse@`。serve 実機で header が出るか §9(d)で確認、出なければ Bearer+ACL に縮退し §6 の認可退行を design 明記。
- TLS は MagicDNS の Let's Encrypt 実 CA 証明書(TOFU 非該当)。
- caveat: SSH 発行トークンは print-once 推奨 / CSP `default-src 'self'` + innerHTML 不使用で localStorage XSS 露出を防ぐ / URL・DOM・ログにトークンを残さない。
- 失効 = SSH で tokens.json を空に(UI 経由の失効 endpoint は循環参照で**作らない**)。device revoke と2系統(q-7)。

---

## 3. 技術選択(確定)

### 3.1 サーバ = stdlib http.server (ThreadingHTTPServer)
FastAPI でなく stdlib を採用(architect 推奨 + security 裁定)。根拠: dashboard/server が同型 precedent / RAM 3.7Gi + AVX1 + HDD で uvicorn+fastapi+pydantic 常駐 ~50-80MB を避ける(stdlib ~15MB)/ tailscale serve が前段リバースプロキシでクリーン HTTP のみ渡す(stdlib の HTTP パース堅牢性懸念が消える)/ path traversal は framework 非依存。

**必須ガードレール5点**(RA-1/RA-2 に織込):
1. 明示ルートテーブルのみ(`{(method,path):handler}`)。`self.path` を FS に連結しない。
2. 静的ファイルは固定 allowlist dict 配信(`{url:(fs_path,content_type)}`)。URL→FS join 禁止。
3. Content-Length 手動 cap(JSON body 64KB / F-1 prompt は別枠で上限明示)。
4. Bearer は `secrets.compare_digest`。
5. ディレクトリリスティング無効・Content-Type 明示・エラーで内部パス非漏洩(generic 404/500)。

YAGNI 境界: endpoint ~8本超 or 入力 validation/OpenAPI 必要時に FastAPI 移行。

### 3.2 PWA フロント
素 HTML/JS + manifest.json + 最小 SW。ビルド工程なし(dashboard/web 同方針)。

### 3.3 配信
`tailscale serve https`(SW の secure context 要件 → HTTPS 必須、MagicDNS cert)。

### 3.4 起動
systemd user service(bot/voice/dashboard と同 pattern、auto-login で起動)。

---

## 4. 機能スコープ

MVP = **F-1 / F-2 / F-3 のみ**。F-4〜F-8 は v2 punt(F-5 dashboard on/off が v2 最有力候補)。

| # | 機能 | claude 起動 | 経路 | 実装段 |
|---|---|---|---|---|
| F-1 | 任意テキスト → claude | Yes | bot socket (verb=ask, budget guard 経由) | v1-β |
| F-2 | voice 発話 | No | remote 直叩き (say.sh) | v1-α |
| F-3 OS | df/free/sensors/uptime | No | remote 直叩き (read-only cmd) | v1-α |
| F-3 集計 | quota/session 集計 | No(読取) | bot socket (verb=status, summary 読取) | v1-β |

---

## 5. 責務境界(案Z → 1ビット静的判定 + 第2原則)

### 第1原則(whack-a-mole 防止の核心)
振り分けは「会話状態の有無」という曖昧語でなく、**「その操作が `claude -p` を起動して Max クレジットを消費し claude session を触るか」の静的1ビットで設計時に1回確定**し、runtime で再評価しない(stderr マッチ/rc 分岐/fallback リトライをしない。CLAUDE.md「成否判定は1回で確定」)。claude を叩く操作は bot 経由(quota+session の単一 owner = bot)、叩かない操作は remote 直接。

### 第2原則(M-1)
- 1ビットは **capability(claude の推論/session が要るか)に束ねて設計時に凍結**。表層文言や rc で分岐しない。
- 他モジュールの private 永続 schema(ledger.jsonl 等)を読むなら **所有者 accessor 経由**(生パース禁止)。→ F-3 集計は bot の `budget_guard.summary` を socket 越しに呼ぶ(remote が ledger を再パースしない)。
- capability が変わったら **既存 endpoint を変異させず新 endpoint を切る**(将来 F-4 vault write は ask を流用せず新 endpoint 追加に正規化、配管やり直しにしない)。

---

## 6. F-1 認可退行(H-1, design 明記)

F-1 は `run_claude` 直呼びで `on_message` の OWNER_ID チェックを通らない → token + ACL の二段は Discord 経路(Discord アカウント + OWNER_ID の二重)より一段弱い。緩和:
- (i) identity header 二段化(§2.3、serve 実機 §9(d)待ち。縮退時は弱さを明記)。
- (ii) **budget guard 必須**(§8 RB-1)が damage backstop(認可が漏れても Max クレジットは月次 cap で頭打ち)。
- (iii) token 失効(SSH で tokens.json 空)= F-1 即無効化と紐付け。
- 受容判断: 単一ユーザ・宅内 remote・tailnet 限定到達で、devil 最終確認も「受容可」。F-2/F-3 は token 保持者なら無制限だがコストゼロ(嫌がらせ面のみ)。

---

## 7. v1-α サブタスク(〜6/2, bot.service 非依存、1サブタスク=1commit)

- **RA-1**: scaffold + server skeleton。`server/app.py`(http.server, 127.0.0.1:<port>, `/api/health`)。ガードレール (i)(ii)(v) 土台化。`.env.example` + `.gitignore`(.state/, tokens.json)。
- **RA-2**: トークン認証。`server/auth.py`(token_urlsafe 発行 CLI + tokens.json 0o600 + Bearer compare_digest + 401)。ガードレール (iii)(iv)。失効 = SSH 手動。
- **RA-3**: F-3 **OS status のみ** `/api/status`(df/free/sensors/uptime 直叩き)。**ledger/session 由来情報は含めない**(v1-β へ、H-2)。
- **RA-4**: F-2 voice `POST /api/say`。**env 隔離**(`subprocess.run([say_sh,text,str(speaker)], env=固定最小env)`、user 入力を環境変数に流さない=say.sh の $VOICE_HOME/.env source 経路を塞ぐ)。speaker 整数 validation。flock(5s→exit 3)は UX 吸収。N-1: 失敗時 [voice]FAIL→Discord notify 副作用を明記、`/api/say` 簡易 rate-limit。
- **RA-5**: PWA(index.html/app.js/manifest.json/sw.js[shell-only precache, API network-only, cache versioning, skipWaiting, エラー画面]/icons)。F-2 発話 + F-3 OS status + 初回トークン paste 欄。glance strip = ● 接続 + OS health(タップで詳細)。401 時は再 paste UX(R4)。
- **RA-6**: `systemd/companion-remote.service`(Type=simple, Restart=on-failure, 127.0.0.1) + SETUP.md(tailscale serve --bg one-time / トークン発行 / SSH revoke)。
- **RA-7**: docs/STATUS.md 反映 + (B)GitHub 昇格判断 + **N-3: brief §2.3 失効 endpoint 記述削除** + **R1: PROJECT.md L373 M-14 文面を改訂 M-14 へ更新**(台帳 vs 実装の不一致防止)。

## 8. v1-β サブタスク(6/2 観察窓後、bot.service restart 伴う)

- **RB-1**: bot.py 最小双方向化。`REMOTE_SOCKET = $XDG_RUNTIME_DIR/companion-bot-remote.sock`(notify socket 前例の親ディレクトリ、/tmp 禁止, 0o600)を setup_hook に2本目 start_unix_server。`_handle_remote` は verb 振り分け:
  - `verb=ask`: prompt read → **必ず同一 budget_guard インスタンス経由**(allow() → run_claude(prompt, REMOTE_CHANNEL_ID) → 成功時 record())。**迂回禁止 = M-14 核心の実装契約**。認可は upstream HTTP edge で1回済、socket は plumbing。
  - `verb=status`: `budget_guard.summary` + `sessions.load(REMOTE_CHANNEL_ID)` を read-only serialize(allow/record 呼ばない、claude 不起動)。F-3 集計の owner accessor。
  - REMOTE_CHANNEL_ID ≠ 0(bot の sentinel 回避、例 1、snowflake 非衝突)。既存 _handle_notify/on_message/sessions 無改変。bot/tests/ に verb 別単体テスト。bot.service restart は観察窓後、健全性履歴に「実装過程の意図的 restart」明記。
- **RB-2**: remote F-1 bridge `POST /api/ask` → 非同期ジョブ型(job_id 即返し、background スレッドが socket connect/send/recv、結果を `.state/jobs/<id>.json` 0o600 保存、`GET /api/ask/<job_id>` polling)。**lane 単一 in-flight ガード**(進行中 job あれば2本目は 409、--resume リトライ厳禁=design.md §1.4)。**socket read timeout は bot 最長 tier から導出**(320 ハードコード禁止。R2: claude_lock 待ち行列も考慮、or bot が accepted/queued frame で wait 延長)。job TTL cleanup。
- **RB-3**: F-1 PWA UI(送信→job_id→polling→結果表示、サーバ保持、job_id localStorage 復元、多重投入 disable、status 表示)+ F-3 集計を verb=status に接続。glance に quota%/最終活動を昇格。
- **RB-4**: docs/STATUS.md + 本ファイル反映 + 健全性観察影響記録。

---

## 9. 採用前実機検証項目
- **(d) 最重要**: `tailscale serve` 実機で (1)ルート `/` マウント可否(SW scope `/` 前提) (2)identity header(Tailscale-User-Login)が proxy で付与されるか(H-1(i)の成否)。要 `tailscale serve` 実行(ask 承認)。
  - (d-3) サーバは IPv4 単独 bind(127.0.0.1、§2.2 反面教師回避で安全側)。`tailscale serve` の前段が loopback target を `localhost`→`::1` 解決すると到達不能になり得る。RA-6 で serve 実機疎通を確認し、到達不能なら `::1` も bind 追加を検討(RA-1 レビュー軽微提案)。
- bot の最長 timeout tier 値の確定 + **claude_lock 待ち行列考慮**(RB-2 M-3/R2)。
- say.sh 固定最小 env で paplay/ffmpeg/curl が動くか(DISPLAY/PULSE/PATH 充足)。

## 10. 実装着手前に user 確認が要る4件 → 2026-05-20 全件裁定済
1. **ACL allow-all 撤去** → **据え置き**(撤去せず。境界は loopback bind + token、§2.2。port 単位 ACL 化は後日の独立タスク)
2. **ufw 化** → **見送り**(loopback bind + ACL で足り、既存 inbound への自己ロックアウトリスク回避。本タスクスコープ外)
3. **M-14 改訂文面** → **OK**(認可趣旨ベース改訂を承認。RA-7 で PROJECT.md L373 を差替え)
4. **H-1 認可退行** → **受容**(単一ユーザ・宅内・tailnet 限定到達、budget guard backstop で課金被害は月次 cap 頭打ち。§6)

## 11. 議論経緯サマリ(なぜこの設計か)
- **D-1/D-2**(devil 摘出, lead 裏取り済): 当初 user 確定の「案Z + bot.py 不可触 + F-1 会話機能」は両立しない。bot socket は notify-only で F-1 応答経路が無く、作るには bot.py 改変が必須。M-14「Discord 経由統一」とも衝突。→ user に差し戻し、**対話完結型**(応答も remote)を確定 → 案B(bot.py 最小双方向化)+ M-14 を認可趣旨ベースに改訂で解決。
- **H-1**(認可退行)/ **H-2**(派生原則自己違反)を devil cross-review で摘出 → §6 / §5 第2原則 + v1-α F-3 を OS status のみに縮小で対処。
- サーバ実装は RAM 制約で stdlib(security 裁定 + ガードレール5点)。
- 実装は Phase 2.5 健全性観察(〜6/2)を汚さないハイブリッド(F-1 のみ 6/2後)。

## 改版履歴
- v1.0 (2026-05-20): agent team `companion-remote-design` の Round 1〜3 + lead 裁定13件 + devil 最終確認(approve 可・致命級ゼロ・残課題 R1〜R4)を経て確定。brief v0.1 を全面改稿。
- v0.1 (2026-05-20): 議論前 brief(初版)。
