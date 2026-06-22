---
paths:
  - "bot.py"
---

# bot.py（Telegram ハンドラ集約）編集時ルール

`bot.py`（リポジトリ最大のファイル）に Telegram コマンド・proactive ループ・通知が集中する。全体地図は `CLAUDE.md`、台帳は `docs/STATUS.md`。恒常制約（認可 / 秘密管理 / claude 起動 / 前景降格 / budget gate）は CLAUDE.md 側。ここは機能別境界。

## メッセージ分割
- `chunk_telegram`: `TELEGRAM_MAX=4000` 字上限、改行優先 fallback。素手 sleep / 二重 retry を永続させない（rate limit は AIORateLimiter に委譲）。

## socket 通知（Telegram 間接入力）
- Unix socket `$XDG_RUNTIME_DIR/companion-bot.sock`（0o600）、1 接続 1 メッセージ（UTF-8、EOF 完了）。
- prefix `[critical] `（半角スペース込み・完全一致、`CRITICAL_PREFIX`）でのみ通知音を反転。既定は silent。prefix マッチの拡張はしない。

## `/play`（映像再生）
- `PLAY_ALLOWED_HOSTS` の固定 allowlist のみ受理（remote 側 urlguard とミラー）。URL 正規化で userinfo 詐称 / 非 http / 制御文字 / 未対応ホストを弾く。
- remote mpv へは IPC 直叩き（Bearer token を bot に反入しない）。remote 未配置でも bot 起動は継続、`/play` 実行時のみ接続不可を返す。

## `/vault_push`（GitHub push）
- vault repo は `VAULT_BRANCH="develop"`（vault-sync Stop hook と同関係）。`flock`（`companion-vault-sync.lock`）で vault-sync と git index 競合を直列化。
- `ssh -o BatchMode=yes`（対話プロンプト hang 回避、即 fail）、timeout 60s。git commit 後の push はせず `/vault_push` の手動承認ゲートに委任。

## `/tweet <url>`（クリップ）
- syndication API で取得（認証不要）。本文は vault `clips/`、画像は `attachments/` にローカル DL し `![[basename]]` 埋め込み参照。
- commit は `clips/` + `attachments/` 限定（手書きエリア無漏出、`GIT_TERMINAL_PROMPT=0`）。push はしない（`/vault_push` に委任）。この subprocess 書き込みは上位 CLAUDE.md vault 境界の OWNER 明示例外。

## photo 受信（`on_photo`）
- 保存は `INCOMING_DIR`（= bot-workspace/incoming/<topic>/、vault 無接触）。ファイル名は安全化 + timestamp prefix（traversal 防止）。最新 10 件超は filename timestamp 辞書順で自動 prune。document/album/video はスコープ外。

## proactive 3 分岐（investigate / ticket / remind）
- 各 env スイッチ `PROACTIVE_*_ENABLED`（既定 1）+ `PROACTIVE_*_INTERVAL_DAYS`（既定 7）。毎回新規 ephemeral session（resume なし）で `#chat` セッションを汚さない。budget gate 必須。
- **境界はプロンプトで強制**（bot-workspace settings は変えない）: investigate は vault `notes/` 新規生成のみ（既存/手書きノート上書き禁止）。ticket は `tickets.py add --by ai` 1 件のみ（OWNER 分は不可触、list/show は読み取り）。remind は read-only（tickets list/show のみ、起票・編集なし）。
- **signal 政策 A**: 実 signal が無ければ動かない（index 空なら発話へフォールスルー）。`#chat last_prompt_at` を明示更新（最小間隔維持）。
