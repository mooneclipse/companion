# CLAUDE.md (bot-workspace, bot 経由セッション専用)

このファイルは bot.py が `--session-id` / `--resume` で claude CLI を起動する際の CWD (`~/companion/bot-workspace/`) から auto-discovery で読まれる。**bot 経由セッション固有** の制約のみを書き、共通項は `~/companion/CLAUDE.md` を参照。

**Phase 2.6 (Telegram 移行) は 2026-05-28 cold cut 実施済み**。bot は Telegram supergroup + topic (1 topic = 1 session) で稼働中。設計 center of truth は `~/companion/workspace/redesign/telegram-design.md`、運用は `~/companion/bot/docs/STATUS.md`。

## Language / 応答言語

ユーザーとのすべてのやり取り (Telegram 上の応答) は **日本語** で行う。口調 / emoji 方針は上位 `~/companion/CLAUDE.md` §「口調基準」を参照 (Telegram 表示の都合上フランクで短く装飾 emoji は最小、キャラクター性は Phase 4 で後のせ)。

## セッション管理

このセッションは bot.py が `~/companion/bot/sessions/topics/<chat_id>_<thread_id or 'general'>.json` で管理する `session_id` (uuid4) で起動される (1 topic = 1 session)。

- `--continue` は使わない (CWD 単位グローバル状態で混在が必然、再設計で全廃)
- 初回は `--session-id <uuid>`、継続は `--resume <uuid>` で 1 prompt = 1 subprocess 呼び
- `Error: Session ID ... is already in use` は bot 側 state JSON と claude 側 jsonl の不整合事故、リトライしない (Telegram に報告 + 復旧は `/reset` or 管理者操作)
- 詳細設計は `~/companion/workspace/redesign/design.md` §1.3-§1.5、運用は `~/companion/bot/docs/STATUS.md`

## 長期タスク / 調査の扱い (2026-07-17)

bot 経由セッションは reset / session 切り替え / subprocess 終了でバックグラウンド作業ごと落ちる。**長時間かかる調査・バックグラウンドタスクをこのセッションで走らせない。**

- 自分でバックグラウンド調査を起動しない (走らせても reset で消え、notes 保存前にロストする)
- 話題が調査に値すると思ったら、**自分で調べず OWNER に振る**。振り方は「手元 CLI セッション (CWD=`~/companion/workspace/`) で "◯◯をこう調べて" と頼んでください」と、**具体的な調査指示の形** を添えて提案する
- 調査するほどでもなければ、その場の短い応答で完結させ調査自体を行わない
- 根拠: 2026-07-17 hermes-agent のセキュリティ深掘り調査をバックグラウンド起動 → 直後の reset でタスクごと消失、notes 保存前にロスト。task handle も残らず復旧不能だった

## 書き込み境界

- `~/companion/vault/notes/` のみ書き込み許可（`.claude/settings.json` で enforce）
- 手書きノートエリア (`aidiary/`, `clips/`, `inbox/`, vault ルート, `templates/`, `.obsidian/`, `CLAUDE.md`) には触らない
- 詳細は `~/companion/vault/CLAUDE.md` と `~/companion/web/docs/STATUS.md`

## OWNER 認可

bot.py 側で OWNER_ID 一致のメッセージのみ subprocess を起動する。本 CWD で動く claude セッションは全て OWNER 発話起点が保証されている前提。詳細は `~/companion/bot/docs/STATUS.md`。

## マシン状態の確認 (Step 1 閲覧自由化、2026-06-10)

`~/companion` 全体の Read と読み系 / 状態系 Bash (`ls` `cat` `df` `du` `free` `ps` `systemctl --user status` 等) が allow 済み。確認時の前提知識:

- **companion 系サービスは全て systemd user unit** (`companion-bot.service`, `companion-proactive.service` 等、`~/.config/systemd/user/`)。`systemctl` / `journalctl` は必ず **`--user` を付ける** — system 版 (`systemctl status ...`) は allow 外で permission 待ちになる
- 「bot の稼働状況」と言われたら unit 名は `companion-bot.service` (× `bot.service`)
- 複合コマンド (`A && B`) は全体が allow にマッチしないと止まる。allow 済みコマンドでも 1 呼び出し 1 コマンドで分けて打つ

## 共用 TODO (チケット) の操作

OWNER と AI が共用する TODO/inbox。実体は `~/companion/remote/server/tickets.py` (CLI) + `remote/.state/tickets.json` (flock 排他、PWA と同居)。「todo に入れて」「#N 終わった」等の依頼はこの CLI で操作する:

```
python3 /home/miho/companion/remote/server/tickets.py add "本文" --by user   # 起票 (OWNER の依頼分)
python3 /home/miho/companion/remote/server/tickets.py add "本文" --by ai     # AI 自身の思いつき
python3 /home/miho/companion/remote/server/tickets.py list                   # 一覧 (done 除外)
python3 /home/miho/companion/remote/server/tickets.py show <id>              # 詳細
python3 /home/miho/companion/remote/server/tickets.py start <id>             # 着手中に
python3 /home/miho/companion/remote/server/tickets.py done <id>              # 完了
```

- OWNER の発話起点で入れるチケットは `--by user`、自分発案は `--by ai`
- done は一覧から消えるだけで履歴は残る。誤 done は `start <id>` で着手中に戻せる (todo へ直接戻すコマンドはない)。どれを done にするか曖昧なら実行前に番号を確認する
- tickets.json を直接編集しない (採番・排他は CLI 側が管理)

## 上位ルール

`~/companion/CLAUDE.md` (共通項) を参照:
- 設計判断・対症療法の上限 (2 周目で設計仕切り直し)
- git 運用方針 (破壊操作 deny、Co-Authored-By 不付与)
- vault 書き込み境界 (上位ルール)

CLAUDE.md auto-discovery は CWD 近いほど後勝ち（design.md §1.2 / researcher a 公式根拠）。

---

**最終更新**: 2026-07-17 (「長期タスク / 調査の扱い」セクションを追加 — bot は長期調査を走らせず CLI に具体指示で振る。hermes-agent 調査が reset で消失した件が契機、OWNER 依頼)。前回 2026-06-11 (共用 TODO の tickets.py 操作セクションを追加 — Telegram から起票/done できるように、OWNER 依頼)
**根拠**: `~/companion/workspace/redesign/design.md` §1.2 (v0.2.3, 2026-05-14) + `~/companion/workspace/redesign/telegram-design.md` (Phase 2.6 設計確定版)
