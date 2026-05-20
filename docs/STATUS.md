# companion-remote 開発台帳（フェーズ外単発ユーティリティ: スマホ専用リモコン PWA）

最終更新: 2026-05-20 (v1-α 実装完了 + 実機デプロイ / serve 疎通 d-1/d-3/TLS 検証済)

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

- 2026-05-20 **実機デプロイ + serve 疎通検証**
  - systemd user service 配置・`enable --now`(active、起動時自動起動も登録)。`ss` で 127.0.0.1:47824 のみ listen を確認。
  - `tailscale serve --bg 47824` で公開 → `https://miho-inspiron-3521.tail5e989b.ts.net/`(tailnet only)。**注意**: 初回に「Serve is not enabled on your tailnet」警告が出るが続けて Success し実際に稼働する(curl 実 CA 検証通過)。
  - **§9 検証済**: d-1 ルート `/` マウント(index/manifest/sw/icons 配信)✅ / d-3 ::1 疎通(serve→127.0.0.1)✅ / TLS 実 CA 証明書 ✅ / token 無 `/api/status` 401 ✅。
  - **§9 残**: d-2 identity header(echo endpoint が無く未確認、H-1 は token+ACL で受容済なので必須でない) / d-4 say.sh audio(voice engine 起動 + token 発行後に /api/say で要確認)。
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
