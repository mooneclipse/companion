---
paths:
  - "server/**"
---

# 配信境界（厳守）— `server/` 編集時ルール

配信レイヤ（`server/app.py` ほか）を触るときに必ず守る。全体地図は `CLAUDE.md`、台帳の正本は `docs/STATUS.md`。

- サーバ（`server/app.py`）は **127.0.0.1 のみに bind**。`0.0.0.0` / tailnet IP への bind は厳禁。
- 外向きは **`tailscale serve`（HTTPS 前段リバースプロキシ）経由のみ**。Tailnet 内からしか到達しない。
- 認証は tailscale 境界に委任（単一ユーザー、API 無し）。`/healthz` のみ無認証の生存確認。
- ポートは env `GAMES_PORT`（default 47825）。
- 配信は固定 allowlist 方式（`STATIC` dict）。FS への URL 連結禁止・ディレクトリリスティング無し・Content-Type 明示・generic エラー・no-store を維持する。
