# companion-remote architect Round 1 plan v1.0（cross-review 共有用）

このファイルは team `companion-remote-design` の Round 2 cross-review 用に lead が architect の SendMessage 報告を転記したもの。teammate は CWD(workspace)内なので permission なしで読める。ux/security/devil は自分の Round 1 plan とこの architect plan を突き合わせて cross-review すること。

---

## 0. 確定前提
案B / ハイブリッド(v1-α〜6/2, v1-β 6/2後) / 案Z境界=「その操作が `claude -p` を起動し Max クレジット消費 + claude session に触るか」の静的1ビットで設計時1回判定 / M-14 は「未認証経路を作らない」趣旨ベースに改訂(Discord 経由文面は撤回, 認可は Tailscale ACL + アプリ層トークンで担保)。

## 1. 全体像
```
Pixel-6 Chrome PWA ──HTTPS(tailscale serve, MagicDNS cert)──> tailscaled ──> 127.0.0.1:<port> remote app server (systemd user)
                                                                                  ├─ F-1: bot remote socket への bridge (v1-β) ── companion-bot-remote.sock ─> bot run_claude
                                                                                  ├─ F-2: subprocess voice/scripts/say.sh (直叩き)
                                                                                  └─ F-3: read-only file 読み + OS status コマンド (直叩き)
```
claude 起動経路は bot の ClaudeRunner 1本のみ → §0 再発(CWD競合/session二重/quota二重)全回避。

## 2. §3 技術選択 確定理由
- **§3.1 サーバ実装**: lead 確定メモは FastAPI を列挙したが、architect は **stdlib `http.server`(ThreadingHTTPServer) を推奨**。根拠: (1)`dashboard/server` が既に stdlib http.server/127.0.0.1/単一クライアント低頻度で同型 precedent (2)RAM 3.7Gi+HDD で uvicorn+fastapi+pydantic 常駐 ~50-80MB を避けたい(bot+voice 268MB+dashboard+TVブラウザ同居), stdlib 常駐 ~15MB (3)v1 endpoint ~6本+bearer+JSON で framework 不要、bot socket bridge は dashboard `_mpv_get` と同じ blocking unix socket client で足る。**どちらでも plan のサブタスク構造は不変**。FastAPI 固定希望なら従う — Round 2 で lead/security 裁定を仰ぐ非ブロッキング項目。YAGNI 境界: endpoint ~8本超 or 入力 validation/OpenAPI 必要時に FastAPI 移行。
- **§3.2 PWA フロント**: 素 HTML/JS + manifest + 最小SW 採用。単一ユーザ・ビルド工程不要、`dashboard/web`(file:// fetch)と同方針。
- **§3.3 配信**: `tailscale serve https` 採用。SW は secure context 必須 → HTTPS 必要、MagicDNS cert で充足(tailscale 1.98.2 稼働確認済, serve config 現在未設定)。
- **§3.4 起動**: systemd user service 採用。bot/voice/dashboard と同 pattern、companion は auto-login で user unit 起動済(新規 linger 要件なし)。

## 3. 案Z 境界 whack-a-mole 対策（中核ルール）
endpoint ごとに「claude を叩くか」を設計時1回確定し runtime で再評価しない:
| 機能 | claude 起動 | 経路 | 根拠 |
|---|---|---|---|
| F-1 | Yes | bot 経由(remote socket) | quota+session の単一 owner=bot |
| F-2 voice | No | remote 直叩き | VOICEVOX ローカル無料・stateless |
| F-3 status | No | remote 直読/直叩き | read-only |

**派生原則(F-3 で適用)**: 「所有された状態は所有者から取得し、remote で再計算しない」。quota の月次集計は `quota.py`/CreditBudgetGuard が所有 → remote が `ledger.jsonl` を再集計するのは二重実装=whack-a-mole。よって:
- v1-α の F-3 = OS status(df/sensors/free 等 read-only) + `sessions/channels/*.json` の session lane 生情報(mtime/last_prompt_at) + `ledger.jsonl` の生の直近 N 件(再集計しない、cost/時刻をそのまま表示)。
- 月次合計/予算残% などの集計値は v1-β で bot 経路から取得(bot が read-only で返すか remote が quota.py を read-only import、Round 2 で security と詰める)。v1-α は bot.py 完全不可触を守りつつ集計の二重実装を回避。

## 4. q-3 / q-4 / q-8
- **q-3 SW スコープ**: installability 用 minimal SW(passthrough fetch handler), scope `/`, offline 非対応(Tailnet 切断時はサーバ到達不可でキャッシュ無価値), app shell precache もしない(YAGNI)。manifest は display: standalone + icons。
- **q-4 API バージョニング**: 暗黙 v1。`/api/v1` prefix なし。保険として `/api/health` に build 文字列1個。SW は network-first(precache なし)で stale client 問題も起きない。
- **q-8 tailscale serve persistent**: `tailscale serve --bg https / http://127.0.0.1:<port>` を1回だけ実行して tailscaled state に永続化(reboot 越え)。permissions.ask = user 1回承認の one-time setup として SETUP.md 手順化。**systemd unit の ExecStart には入れない**(stateful コマンド毎起動再実行 whack-a-mole 回避、app server unit と serve config 疎結合)。serve は app server 不在でも 502 を返すだけで無害。

## 5. v1-α サブタスク分割（〜6/2, bot.service 非依存、1サブタスク=1commit）
- **RA-1**: remote/ scaffold + server skeleton。server/app.py(http.server, 127.0.0.1:<port>, /api/health のみ) + .env.example(REMOTE_PORT 等) + .gitignore 追補(.state/, tokens.json)。
- **RA-2**: アプリ層トークン認証。server/auth.py(secrets.token_urlsafe(32) 発行 CLI + remote/.state/tokens.json 0o600 + Authorization: Bearer 検証, 不一致 401)。失効=SSH で tokens.json 編集の手動手順(UI 経由は循環参照不可)。
- **RA-3**: F-3 status endpoint /api/status。OS status(read-only コマンド)+ session lane 生情報 + ledger 生直近 N 件(派生原則: 再集計しない)。
- **RA-4**: F-2 voice endpoint POST /api/say。voice/scripts/say.sh "TEXT" [SPEAKER] を argv 直叩き(shell 経由しない=injection 面排除)、exit code(0/1..5)を JSON 化。MAX_TEXT_LEN=2000 は say.sh 側で確定済。
- **RA-5**: PWA フロント。web/index.html+app.js+manifest.json+sw.js(最小)+icons。F-2 発話フォーム + F-3 status 表示 + 初回トークン入力欄(SSH 発行トークンを1回 paste→localStorage 保存)。
- **RA-6**: systemd user service systemd/companion-remote.service(Type=simple, Restart=on-failure, 127.0.0.1 bind, After なしで独立) + SETUP.md に tailscale serve --bg one-time 手順 + トークン発行/revoke 手順。
- **RA-7**: docs/STATUS.md にサブタスク分割反映 + (B)GitHub 昇格判断(実装着手と同時, voice pattern 準拠)。

## 6. v1-β サブタスク分割（6/2 観察窓後、bot.service restart 伴う）
- **RB-1**: bot.py 最小双方向化。REMOTE_SOCKET(companion-bot-remote.sock 0o600) を setup_hook に2本目 start_unix_server で追加 + _handle_remote(request/response: prompt read→await run_claude(prompt, REMOTE_CHANNEL_ID)→socket write back→close) + REMOTE_CHANNEL_ID 定数(Discord snowflake 非衝突の小整数)。既存 _handle_notify/on_message/sessions 無改変。bot/tests/ に _handle_remote 単体テスト追加。bot.service restart は観察窓(〜6/2)後、健全性履歴に「実装過程の意図的 restart」明記。
- **RB-2**: remote 側 F-1 bridge。POST /api/ask→非同期ジョブ型: job_id 即返し、background スレッドが remote socket に connect/send/recv(read timeout は CLAUDE_TIMEOUT 300s+余裕の 320s)、結果を remote/.state/jobs/<id>.json 0o600 に保存。GET /api/ask/<job_id> で polling。fragile な mobile HTTP を信頼性ある local socket 待ちから分離。job TTL cleanup。
- **RB-3**: F-1 PWA UI。送信→job_id→polling で結果取得・表示、結果はサーバ保持(再起動跨ぎは jobs/ に残る)。会話継続は REMOTE_CHANNEL_ID の単一 lane。
- **RB-4**: docs/STATUS.md + remote-design.md v1.0 反映 + 健全性観察への影響記録。F-3 集計値の bot 経路接続(派生原則の残件)もここで確定。

## 7. ディレクトリ構成
```
remote/
├── docs/STATUS.md, SETUP.md
├── server/  app.py / auth.py / status.py / jobs.py(v1-β)
├── web/     index.html / app.js / manifest.json / sw.js / icons/
├── systemd/ companion-remote.service
├── .env.example / .gitignore
└── .state/  tokens.json(0o600) / jobs/(v1-β)
bot/  (v1-β のみ) bot.py 最小差分 + tests/
```

## 8. 採用前検証項目 / リスク(devil 引き継ぎ候補)
- (a) §3.1 stdlib vs FastAPI の最終裁定(非ブロッキング、lead/security)。
- (b) F-3 集計値の owner 取得方式(bot endpoint vs quota.py read-only import) — v1-β で確定、再集計禁止原則は不変。
- (c) PWA トークン bootstrap UX(SSH 発行→paste)の安全性 — security 領域。
- (d) tailscale serve をルート `/` にマウントできるか実機確認(SW scope `/` の前提) — 要 tailscale serve 実行(ask 承認)。
- (e) REMOTE_CHANNEL_ID の値選定(Discord snowflake 範囲と物理的非衝突)。
- (f) job 非同期型で bot 側 run_claude が単一 REMOTE_CHANNEL_ID lane を共有 → 同時 F-1 多重投入時の session 競合(単一ユーザなので実害低だが要明記)。

## 改版履歴
- v1.0 (2026-05-20): 初版 Round 1。案B + ハイブリッド + 案Z境界=「claude を叩くか」1ビット確定後の full plan。cross-review 比較対象はこの v1.0。
