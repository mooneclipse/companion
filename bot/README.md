# companion-bot

Telegram ↔ `claude -p` 土管 bot。OWNER の supergroup 発話を受け取り、`~/companion/bot-workspace/` を CWD にした `claude -p` の出力を Telegram に返す常駐サービス（python-telegram-bot）。

開発時の制約と全体地図は `CLAUDE.md`、運用台帳は `docs/STATUS.md` を参照。

## セットアップ

```bash
cd ~/companion/bot
python3 -m venv venv
venv/bin/pip install -U pip
venv/bin/pip install -r requirements.txt
```

Telegram bot の新規作成（BotFather）・supergroup / topic の構築手順は `docs/telegram-setup.md` を参照。

`.env` に以下を設定する（chmod 600 必須）:

- `TELEGRAM_BOT_TOKEN` — BotFather が発行する bot token
- `OWNER_ID` — 受理する唯一の Telegram user ID（それ以外の発話は完全無視）
- `NOTIFY_CHAT_ID` — socket 経由通知（システムレポート等）の宛先 chat ID（supergroup）
- `BOT_THREAD_ID_MAINTENANCE` / `BOT_THREAD_ID_CHAT` / `BOT_THREAD_ID_MEMO` — supergroup 内 topic の thread ID（MEMO 未設定ならメモ機能無効、MAINTENANCE 空なら General topic 宛て）
- `CLAUDE_BIN` / `CLAUDE_CWD` / `CLAUDE_TIMEOUT` — claude CLI のパス / 実行 CWD（`~/companion/bot-workspace`）/ timeout 秒（既定 300）
- 任意: `BOT_BUDGET_GUARD` / `BOT_REQUESTS_PER_HOUR`（budget gate）、`PROACTIVE_*`（自発発話の有効化スイッチ・間隔）

```bash
chmod 600 .env
$EDITOR .env
```

## 手動起動（動作確認用）

```bash
venv/bin/python bot.py
```

## systemd user service として常駐させる

```bash
mkdir -p ~/.config/systemd/user
cp companion-bot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now companion-bot.service

# ログイン中以外でも自動起動するように
sudo loginctl enable-linger "$USER"
```

状態確認・ログ:

```bash
systemctl --user status companion-bot
journalctl --user -u companion-bot -f
tail -f ~/companion/logs/bot.log
```

## 注意

- bot は OWNER_ID 以外の発言を完全に無視する（応答もしない）
- `claude` のパスは `.env` の `CLAUDE_BIN` と unit の `Environment=PATH=...` の両方に nvm のバージョン依存パスを書いている。Node を更新したら両方追従する
- `.env` は git 管理外（`.gitignore` 済み）
- このディレクトリは `~/companion/` モノレポの 1 サブディレクトリ（独立 repo ではない）。commit のパス明示・push 運用など git 方針は上位 `~/companion/CLAUDE.md` を参照
