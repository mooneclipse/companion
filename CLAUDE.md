# CLAUDE.md (bot-workspace, bot 経由セッション専用)

このファイルは bot.py が `--session-id` / `--resume` で claude CLI を起動する際の CWD (`~/companion/bot-workspace/`) から auto-discovery で読まれる。**bot 経由セッション固有** の制約のみを書き、共通項は `~/companion/CLAUDE.md` を参照。

**Phase 2.6 (Telegram 移行) 設計確定 (2026-05-27)**: 本書の「Discord 経由」記述は cold cut 切替日 (2026-06-02 以降) に Telegram (supergroup + topic) ベースに改訂予定。設計 center of truth は `~/companion/workspace/redesign/telegram-design.md`、実装着手前は **現状の Discord bot 動作前提を維持** (観察期間 5/19-6/2 中の挙動変更禁止、N-T3 違反回避)。

## Language / 応答言語

ユーザーとのすべてのやり取り (Discord 上の応答) は **日本語** で行う。口調 / emoji 方針は上位 `~/companion/CLAUDE.md` §「口調基準」を参照 (Discord 表示の都合上フランクで短く装飾 emoji は最小、キャラクター性は Phase 4 で後のせ)。

## セッション管理

このセッションは bot.py が `~/companion/bot/sessions/channels/<channel-id>.json` で管理する `session_id` (uuid4) で起動される。

- `--continue` は使わない (CWD 単位グローバル状態で混在が必然、再設計で全廃)
- 初回は `--session-id <uuid>`、継続は `--resume <uuid>` で 1 prompt = 1 subprocess 呼び
- `Error: Session ID ... is already in use` は bot 側 state JSON と claude 側 jsonl の不整合事故、リトライしない (Discord に報告 + 復旧は `/reset` or 管理者操作)
- 詳細設計は `~/companion/workspace/redesign/design.md` §1.3-§1.5、運用は `~/companion/bot/docs/STATUS.md`

## 書き込み境界

- `~/companion/vault/notes/` のみ書き込み許可（`.claude/settings.json` で enforce）
- 手書きノートエリア (`aidiary/`, `clips/`, `inbox/`, vault ルート, `templates/`, `.obsidian/`, `CLAUDE.md`) には触らない
- 詳細は `~/companion/vault/CLAUDE.md` と `~/companion/web/docs/STATUS.md`

## OWNER 認可

bot.py 側で OWNER_ID 一致のメッセージのみ subprocess を起動する。本 CWD で動く claude セッションは全て OWNER 発話起点が保証されている前提。詳細は `~/companion/bot/docs/STATUS.md`。

## 上位ルール

`~/companion/CLAUDE.md` (共通項) を参照:
- 設計判断・対症療法の上限 (2 周目で設計仕切り直し)
- git 運用方針 (破壊操作 deny、Co-Authored-By 不付与)
- vault 書き込み境界 (上位ルール)

CLAUDE.md auto-discovery は CWD 近いほど後勝ち（design.md §1.2 / researcher a 公式根拠）。

---

**最終更新**: 2026-05-27 (Phase 2.6 Telegram 移行設計確定、本格改訂は cold cut 切替日 2026-06-02 以降に実施)
**根拠**: `~/companion/workspace/redesign/design.md` §1.2 (v0.2.3, 2026-05-14) + `~/companion/workspace/redesign/telegram-design.md` (Phase 2.6 設計確定版)
