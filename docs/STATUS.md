# companion-bot 開発台帳

最終更新: 2026-05-06 10:20

## 設計メモ

- Discord ↔ `claude -p` 土管 bot
- DM またはサーバー内ユーザーメンションをトリガに `claude -p` を呼び、出力をチャンネル/DM へ返す
- OWNER_ID 以外の発言は完全に無視
- 主要パス:
  - `bot.py` … 本体（約140行、1ファイル構成）
  - `companion-bot.service` … systemd user unit（未デプロイ）
  - `.env` … トークン・OWNER_ID・CLAUDE_BIN・CLAUDE_CWD・CLAUDE_TIMEOUT（chmod 600）
  - `requirements.txt` … `discord.py>=2.3,<2.4`, `python-dotenv>=1.0,<2.0`
  - `venv/` … Python 3.10 で再構築済み
- 実行 CWD: `claude -p` は `~/companion/workspace` を CWD として起動
- ログ: `~/companion/logs/bot.log` (RotatingFileHandler, 5MB×3)
- `claude` CLI のパスは `.env` の `CLAUDE_BIN` と service ユニットの `Environment=PATH=...` の両方に nvm バージョン依存パスを書いている。Node 更新時は両方追従要

## TODO

- [ ] git 化検討（CLAUDE.md の方針に沿って `bot/` 配下を `git init`）

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-05-06 venv 再構築（Mint アップグレードで Python 3.8→3.10 になり ABI 不一致で壊れていた）
- 2026-05-06 `.env` の `DISCORD_TOKEN` 修正（Application ID 等が貼られていて 401 Unauthorized だった）
- 2026-05-06 診断ログ追加（`on_ready` の guilds 一覧 / `on_message` 冒頭の raw recv）— mention 不通の原因切り分け用
- 2026-05-06 動作確認: DM・サーバー内ユーザーメンション双方で `claude -p` 応答を確認
- 2026-05-06 退避フォルダ削除（`venv.broken-py38/`, `venv.halfbuilt/`）
- 2026-05-06 workspace 側 `CLAUDE.md` の `bot/` 説明を実態に更新（土管 bot として記述、`docs/STATUS.md` を参照先として明記）
- 2026-05-06 診断ログ削除（`on_ready` を 1 行版に戻す / `on_message` 冒頭の `raw recv` ログ削除 / 認可後の `recv from=...` ログも削除＝対の診断ログかつ `prompt[:40]` の漏出回避）。レビュー OK
- 2026-05-06 systemd 常駐化（`~/.config/systemd/user/companion-bot.service` を `~/companion/bot/companion-bot.service` への symlink で配置、`systemctl --user enable --now` で起動。Active running / `logged in as renbot#8921` 確認済み）
- 2026-05-06 linger は不要と判断（PC つけっぱなし + 自動ログイン有効のため、再起動後も user systemd が立ち上がり bot も復帰する）

## 既知の問題

（なし）

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮）
  - セキュリティ（入力検証、秘密情報の扱い、権限境界）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `bot/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
