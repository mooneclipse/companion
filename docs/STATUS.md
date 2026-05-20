# companion-remote 開発台帳（フェーズ外単発ユーティリティ: スマホ専用リモコン PWA）

最終更新: 2026-05-20 (設計議論完了 / remote-design.md v1.0 確定 / サブタスク分割反映)

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
├── server/   app.py(http.server) / auth.py / status.py / jobs.py(v1-β)
├── web/      index.html / app.js / manifest.json / sw.js / icons/
├── systemd/  companion-remote.service
├── .env.example / .gitignore
└── .state/   tokens.json(0o600) / jobs/(v1-β)
```

git の扱い: 現在 **(C) ローカル git のみ (remote なし、rollback 専用)**。**(B) GitHub バックアップ付きへの昇格**(= `remote add` + `push`)は voice/ パターンに揃え「実装着手と同時」(RA-7 で判断)。

## TODO

### 実装着手前に user 確認が要る4件（v1-α 着手直前にまとめて諮る）
- [ ] ACL allow-all 撤去(tailnet 全体 = m-gamepc 含む波及)
- [ ] ufw 化(既存 inbound 自己ロックアウトリスク、x11vnc 5900)— scope 外で見送りも可
- [ ] M-14 改訂文面の最終 OK(PROJECT.md L373 編集前、RA-7)
- [ ] H-1 認可退行の受容(F-1 認可が token+ACL+identity で Discord 経路の OWNER_ID 二重より一段弱い。budget guard で課金被害は月次 cap 頭打ち)

### v1-α サブタスク（〜6/2, bot.service 非依存、1サブタスク=1commit）
- [ ] RA-1: scaffold + server skeleton(http.server 127.0.0.1, /api/health, ガードレール土台, .env.example, .gitignore)
- [ ] RA-2: トークン認証(auth.py, token_urlsafe 発行 CLI, tokens.json 0o600, Bearer compare_digest, 401, Content-Length cap)
- [ ] RA-3: F-3 OS status のみ /api/status(df/free/sensors/uptime 直叩き。ledger/session 由来は含めない)
- [ ] RA-4: F-2 voice POST /api/say(say.sh argv 直叩き + env 隔離 + speaker 整数 validation + rate-limit)
- [ ] RA-5: PWA(index/app.js/manifest/sw[shell-only precache, API network-only]/icons, F-2 + F-3 OS + token paste, glance=接続+OS health)
- [ ] RA-6: systemd/companion-remote.service + SETUP.md(tailscale serve --bg one-time / トークン発行 / SSH revoke)
- [ ] RA-7: docs/STATUS.md 反映 + (B)GitHub 昇格判断 + brief §2.3 失効 endpoint 記述削除(N-3) + PROJECT.md L373 M-14 文面改訂(R1, user 確認後)

### v1-β サブタスク（6/2 観察窓後、bot.service restart 伴う）
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

- 2026-05-20 **設計議論完了 / remote-design.md v1.0 確定**
  - agent team `companion-remote-design`(architect/ux/security/devil + lead)で Round 1〜3。
  - 致命級 D-1/D-2(案Z+bot.py不可触+F-1会話の三つ巴矛盾)を devil が摘出 → user 差し戻しで対話完結型 + 案B 確定。H-1(認可退行)/H-2(派生原則自己違反)も cross-review で摘出・対処。lead 裁定13件、devil 最終確認 approve 可(致命級ゼロ、残課題 R1〜R4 は実装スコープに畳み済)。
  - 成果物: remote-design.md v1.0 + remote-arch-plan-v{1,2}.md(議論アーカイブ)。
- 2026-05-20 `remote/` をローカル git のみ (remote なし、rollback 専用) で先行 git 化
  - **やったこと**: `git init -b main` + user 設定 + gitleaks pre-commit フック配置 + `.gitignore` 作成 + `gitleaks dir` で no leaks 確認 + 初回 commit。**GitHub remote は意図的に付けない**

## 既知の問題

- **H-1 F-1 認可退行**(設計確定済・受容判断済): F-1 は run_claude 直呼びで on_message の OWNER_ID チェックを通らず、token+ACL(+identity header)の認可で Discord 経路の OWNER_ID 二重より一段弱い。緩和=identity header 二段化 + budget guard backstop(課金月次 cap)+ SSH 失効。実装着手前に user 受容確認(TODO 上記)。

## 運用注記

- **Tailscale funnel は絶対に叩かない** (外部公開コマンド、誤発射防止のため `.claude/settings.json` で deny 済)
- サーバは `127.0.0.1` バインドのみ、外向き口は `tailscale serve` 経由だけ
- スマホ紛失時の revoke 手順(2系統): ①Tailscale 管理画面で pixel-6 を device disable(第一手・最上流) ②SSH で `remote/.state/tokens.json` を空に + service restart。**UI 経由のトークン無効化 endpoint は作らない**(漏洩端末から叩ける循環参照のため、N-3 で確定)。
