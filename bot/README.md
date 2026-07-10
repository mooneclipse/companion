# companion-bot

Discord ↔ `claude -p` 土管 bot。DM か mention を受け取って、`~/companion/workspace/` を CWD にした `claude -p` の出力を Discord に返す。

## セットアップ

```bash
cd ~/companion/bot
python3 -m venv venv
venv/bin/pip install -U pip
venv/bin/pip install -r requirements.txt
```

`.env` の `DISCORD_TOKEN` / `OWNER_ID` / `NOTIFY_CHANNEL_ID` を埋める（chmod 600 推奨）:

`NOTIFY_CHANNEL_ID` は socket 経由通知（Phase 2 のシステムレポート等）の宛先テキストチャンネル ID。Discord の開発者モードを ON にしてチャンネル右クリック → 「ID をコピー」で取得する。bot がそのギルドに参加していて、対象チャンネルへの送信権限が必要。

```bash
chmod 600 .env
$EDITOR .env
```

Discord Developer Portal で **Privileged Gateway Intents → MESSAGE CONTENT INTENT** を有効化しておく。

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
