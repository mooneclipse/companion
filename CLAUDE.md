# CLAUDE.md (bot, CWD=bot 固有)

このファイルは CWD=`~/companion/bot/` で claude CLI を起動して **bot 本体コードを開発する** ときに auto-discovery で読まれる、companion-bot 固有の制約。**共通項は上位 `~/companion/CLAUDE.md` を参照**（応答言語 / 口調 / OWNER 認可 / git 運用方針 / 設計判断・対症療法の上限）。台帳の正本は `docs/STATUS.md`。

**bot-workspace との違い**: 本ファイルは bot **本体コード**（`bot.py` ほか）の開発制約。Telegram 経由で bot が claude を回すときの実行時セッション（CWD=`~/companion/bot-workspace`）の口調・書き込み境界は `~/companion/bot-workspace/CLAUDE.md` 側のルールで、別物。混同しない。

companion-bot は Telegram bot（python-telegram-bot）。OWNER の発話を受け、CWD=bot-workspace で `claude -p` を回して応答する常駐サービス。ロジックの大半は `bot.py`（リポジトリ最大のファイル）に集中し、`sessions.py` / `interests.py` / `quota.py` / `voice_command.py` / `voice_status.py` / `claude_runner.py` が分離モジュール。

## 認可境界（厳守）

- 受理するのは OWNER のみ。`user.id == OWNER_ID` かつ `not user.is_bot` の 4 段防御（user.id / is_bot / chat.type / chat.id）。OWNER 以外の発話は完全に無視（沈黙）。

## 秘密情報の管理

- `.env`（TELEGRAM_BOT_TOKEN / OWNER_ID / NOTIFY_CHAT_ID 等）はパーミッション 0o600。
- `bot.log` は OWNER 限定経路の URL/session を含むため 0o600（起動時 `os.umask(0o077)` + 既存ファイルは chmod 0o600 へ寄せる）。socket（`companion-bot.sock`）も 0o600。
- gitleaks pre-commit hook 必須（token/key 混入を自動拒否）。

## claude 起動の不変条件

- CWD は常に `~/companion/bot-workspace` 固定（env `CLAUDE_CWD`）。セッション分離のため。
- **全 claude 呼び出しに `append_system_prompt=PERSONA_SYSTEM_PROMPT` を付加**（口調を全話題共通で維持、敬語回帰防止）。
- timeout は env `CLAUDE_TIMEOUT`（既定 300s）で統一。迂回しない。

## 前景降格（不可逆/外向き作業）

- tweet 投稿 / email / vault push / notes 外への vault 書き込み / maintenance 変更 / 設定変更 などの不可逆・外向き作業は **自動実行しない**。`#chat` に「○○ してみようか?」の前景提案へ降格する（`PERSONA_SYSTEM_PROMPT` 内の降格ルールで全モード共有）。新たな自動実行解除・モード分岐の追加・設定変更をしない。

## budget guard（単一 gate）

- claude を回す全経路で `budget_guard.allow(now)` を通す（rolling 1h 呼び出し回数上限、env 設定）。**この単一 gate を迂回しない**（2026-06-15 の金額枠分離停止で金額 guard は撤去、呼び出し回数 guard に一本化）。

## パス別ルール（`.claude/rules/`）

該当パスのファイルをコンテキストに入れたときだけ自動ロードされる詳細制約:

- `bot.py` → `.claude/rules/bot-py.md`（cmd_play allowlist / vault_push / tweet / photo / proactive 3 分岐 / socket / chunk の各境界）
- `sessions.py` → `.claude/rules/sessions.md`（topic 複合キー / general suffix / record_usage）
- `interests.py` → `.claude/rules/interests.md`（純関数+副作用分離 / decay TTL / MAX_THREADS / 実活動由来のみ）
- `quota.py` / `voice_status.py` → `.claude/rules/quota.md`（ledger append-only / 金額非記録 / voice_ledger 分離）
- `voice_command.py` → `.claude/rules/voice.md`（engine on-demand / 成否 1 回判定 / voice_ledger）
- `claude_runner.py` → `.claude/rules/claude-runner.md`（ClaudeOptions / to_cli_args / stderr 分類は表面化専用）

## git

- **(B) GitHub remote 付き**（`git@github.com:mooneclipse/companion-bot.git`）。push はユーザー承認ゲート（`permissions.ask`）。
- gitleaks pre-commit hook 必須。
- commit メッセージは既存ログスタイル（`feat(proactive):` / `fix(...)` / `docs(status):` / `test(...)` = scope 付き）に揃える。Co-Authored-By trailer は付けない。

## 対象ユーザー

OWNER（miho）のみ。Telegram OWNER_ID 一致のみ受理、それ以外は沈黙。
