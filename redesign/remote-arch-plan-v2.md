# companion-remote architect plan v2.0（devil 最終確認用）

このファイルは team `companion-remote-design` の Round 3 最終確認用に lead が architect の v2.0 報告を転記したもの。teammate は CWD 内なので permission なしで読める。devil は v1.0(remote-arch-plan-v1.md)からの差分=lead 裁定13件の反映に穴がないか最終確認すること。lead は §D 整合チェック済(内部矛盾なし)。

## 改版履歴
- v1.0 (2026-05-20): 初版 Round 1。案B + ハイブリッド + 案Z境界=「claude を叩くか」1ビット。
- v2.0 (2026-05-20): Round 2 cross-review lead 裁定13件反映。§3.1 stdlib 確定+ガードレール5点 / H-1 認可退行緩和明記 / H-2 v1-α F-3 を OS status のみに縮小・ledger/session は v1-β bot socket 経路 / M-14 budget guard 必須を実装契約化 / M-1 第2原則明文化 / lane 単一 in-flight ガード / socket timeout を bot tier 導出 / say.sh env 隔離 / N-1〜N-3。

## 0. 確定前提
案B / ハイブリッド(v1-α〜6/2, v1-β 6/2後) / M-14 は「未認証経路を作らない & 全 claude 起動を単一 budget guard でメータする」趣旨ベース。

## 1. 全体像
```
Pixel-6 Chrome PWA ──HTTPS(tailscale serve, MagicDNS cert)──> tailscaled ──> 127.0.0.1:<port> remote app server (systemd user)
  認可 edge = HTTP 段で1回: Bearer(compare_digest) + Tailscale ACL + identity header(可能なら)
                          ├─ F-1(v1-β): $XDG_RUNTIME_DIR/companion-bot-remote.sock 経由 bot run_claude (verb=ask)
                          ├─ F-3 集計(v1-β): 同 socket verb=status (budget_guard.summary 読み取り, claude 不起動)
                          ├─ F-2: subprocess say.sh (env 隔離 argv 直叩き)
                          └─ F-3 OS(v1-α): df/free/sensors/uptime 等 read-only コマンド
```

## 2. §3 技術選択（確定）
- **§3.1 = stdlib http.server(ThreadingHTTPServer) 確定**。ガードレール5点(RA-1/RA-2): (i)明示ルートテーブルのみ・self.path を FS 連結しない (ii)静的ファイルは固定 allowlist dict 配信・URL→FS join 禁止 (iii)Content-Length 手動 cap(JSON 64KB / F-1 prompt 別枠) (iv)Bearer は secrets.compare_digest (v)ディレクトリリスティング無効・Content-Type 明示・generic 404/500。
- §3.2 素 HTML/JS + manifest + SW。§3.3 tailscale serve https(MagicDNS cert)。§3.4 systemd user service。

## 3. 案Z 境界 whack-a-mole 対策
**第1原則**: endpoint ごとに「claude を叩くか」を設計時1回確定、runtime 再評価しない。
| 機能 | claude 起動 | 経路 |
|---|---|---|
| F-1 | Yes | bot socket(verb=ask, budget guard 経由) |
| F-3 集計 | No(読取) | bot socket(verb=status, summary 読取) |
| F-2 voice | No | remote 直叩き(say.sh) |
| F-3 OS | No | remote 直叩き(read-only cmd) |

**第2原則(M-1)**: 1ビットは capability(claude の推論/session 要否)に束ね設計時凍結、表層文言/rc で分岐しない。他モジュールの private 永続 schema(ledger.jsonl 等)を読むなら所有者 accessor 経由(生パース禁止)→ F-3 集計は bot の budget_guard.summary を socket 越しに呼ぶ。capability が変わったら既存 endpoint を変異させず新 endpoint を切る(F-4 vault write は ask 流用せず新 endpoint 追加に正規化)。

## 4. q-3 / q-4 / q-8
- q-3 SW: shell-only precache(index.html/app.js/manifest.json/icons)+ API network-only。cache-name versioning + skipWaiting。PC 停止/Tailscale 切断時にエラー画面。scope `/`, display: standalone。
- q-4: 暗黙 v1。/api/health に build 文字列1個。SW network-only で stale client なし。
- q-8: tailscale serve --bg を1回だけ実行→tailscaled state 永続化。ask 1回承認の one-time setup として SETUP.md 化。systemd ExecStart に入れない(stateful 再実行 whack-a-mole 回避)。

## 5. F-1 認可退行(H-1) design 明記
F-1 は run_claude 直呼びで on_message の OWNER_ID チェックを通らない → token+ACL の二段は Discord 経路(OWNER_ID 二重)より弱い。緩和: (i)identity header 二段化(HTTP edge で Bearer AND Tailscale-User-Login==mr.mooneclipse@)。serve 実機で identity header が出るか要確認(検証 d)、出なければ Bearer+ACL に縮退し「F-1 認可が Discord 経路より弱い」を design 明記。(ii)budget guard 必須(§6 RB-1)が damage backstop。(iii)token 失効(SSH で tokens.json 空)= F-1 即無効化と紐付け。

## 6. v1-α サブタスク分割（〜6/2, bot.service 非依存、1サブタスク=1commit）
- RA-1: scaffold + server skeleton。server/app.py(http.server, 127.0.0.1:<port>, /api/health)。ガードレール (i)(ii)(v) 土台化。.env.example + .gitignore(.state/, tokens.json)。
- RA-2: トークン認証。server/auth.py(secrets.token_urlsafe(32) 発行 CLI + remote/.state/tokens.json 0o600 + Bearer compare_digest + 不一致 401)。ガードレール (iii)(iv) + Content-Length cap(JSON 64KB)。失効=SSH で tokens.json 編集。
- RA-3: F-3 **OS status のみ** /api/status。df/free/sensors/uptime 等 read-only コマンド直叩き。ledger/session 由来情報(最終活動・生 N 件)は含めない(全部 v1-β bot socket 経路、H-2 裁定)。
- RA-4: F-2 voice POST /api/say。env 隔離: subprocess.run([say_sh, text, str(speaker)], env=固定最小env)(PATH/HOME/XDG_RUNTIME_DIR/DISPLAY/PULSE 等のみ、user HTTP 入力を環境変数に流さない=say.sh の $VOICE_HOME/.env source 経路に任意ファイル差し込ませない)。speaker は remote 側でも整数 validation。flock 直列化(5s→exit 3)は UX 吸収。N-1: 失敗時 say.sh が [voice]FAIL→bot socket→Discord notify する副作用を design 明記、/api/say 簡易 rate-limit。
- RA-5: PWA。web/index.html+app.js+manifest.json+sw.js(shell-only precache/API network-only/cache versioning/skipWaiting/エラー画面)+icons。F-2 発話 + F-3 OS status 表示 + 初回トークン入力欄(SSH 発行→1回 paste→localStorage)。
- RA-6: systemd/companion-remote.service(Type=simple, Restart=on-failure, 127.0.0.1) + SETUP.md(tailscale serve --bg one-time / トークン発行 / SSH revoke)。
- RA-7: docs/STATUS.md 反映 + (B)GitHub 昇格判断。N-3: 確定 design 時に brief §2.3「失効・再発行 endpoint を最初から用意」を削除(RA-2 SSH 手動失効と矛盾)。

## 7. v1-β サブタスク分割（6/2 観察窓後、bot.service restart 伴う）
- RB-1: bot.py 最小双方向化。REMOTE_SOCKET = $XDG_RUNTIME_DIR/companion-bot-remote.sock(既存 notify socket 前例の親ディレクトリ、/tmp 禁止・symlink race 回避, 0o600)を setup_hook に2本目 start_unix_server で追加。_handle_remote は verb 振り分け:
  - verb=ask: prompt read→必ず同一 budget_guard インスタンス経由(allow() チェック→run_claude(prompt, REMOTE_CHANNEL_ID)→成功時 record())。迂回禁止=M-14 核心の実装契約。認可は upstream HTTP edge で1回済、socket は plumbing。
  - verb=status: budget_guard.summary + sessions.load(REMOTE_CHANNEL_ID) を read-only で serialize(allow/record 呼ばない、claude 不起動)。F-3 集計の owner accessor(M-1 第2原則)。
  - N-2: REMOTE_CHANNEL_ID ≠ 0(bot の channel_id or 0 sentinel 回避、例 1、snowflake 非衝突)。
  - 既存 _handle_notify/on_message/sessions 無改変。bot/tests/ に verb 別単体テスト。bot.service restart は観察窓後、健全性履歴に「実装過程の意図的 restart」明記。
- RB-2: remote F-1 bridge POST /api/ask→非同期ジョブ型: job_id 即返し、background スレッドが socket connect/send(verb=ask)/recv、結果を remote/.state/jobs/<id>.json 0o600 保存、GET /api/ask/<job_id> polling。
  - M-2/(f) lane 単一 in-flight ガード: REMOTE_CHANNEL_ID に進行中 job があれば2本目は 409 相当「前の応答待ち」。rc を見て --resume リトライ厳禁(SESSION_ALREADY_IN_USE / design.md §1.4 + CLAUDE.md 2周目)。
  - M-3 socket read timeout: 320 ハードコード禁止、bot の最長 timeout tier から導出(bot 側に最長 tier を返させる or 共有 config)。bot は timeout 時も [timeout] を terminal write するので orphan 応答 + session ずれ(§0-G)を防ぐ。job TTL cleanup。
- RB-3: F-1 PWA UI(送信→job_id→polling→結果表示、サーバ保持) + F-3 集計表示を verb=status 経由に接続。会話継続は単一 lane。
- RB-4: docs/STATUS.md + remote-design.md v1.0 反映 + 健全性観察影響記録。

## 8. ディレクトリ構成
```
remote/  docs/{STATUS.md,SETUP.md} / server/{app.py,auth.py,status.py,jobs.py(β)} / web/{index.html,app.js,manifest.json,sw.js,icons/} / systemd/companion-remote.service / .env.example / .gitignore / .state/{tokens.json(0o600),jobs/(β)}
bot/  (β のみ) bot.py 最小差分 + tests/
```

## 9. 採用前実機検証項目
- (d) 最重要: tailscale serve 実機で (1)ルート / マウント可否(SW scope / 前提) (2)identity header(Tailscale-User-Login)が proxy で付与されるか(H-1 (i) の成否)。要 tailscale serve 実行(ask 承認)。出なければ H-1 (i) 縮退・design に弱さ明記。
- bot の最長 timeout tier 値の確定(RB-2 M-3 の導出元)。
- say.sh 固定最小 env で paplay/ffmpeg/curl が動くか(DISPLAY/PULSE/PATH 充足)。
