---
paths:
  - "claude_runner.py"
---

# claude_runner.py（claude CLI ラッパ）編集時ルール

- `ClaudeOptions` のフィールドは `timeout_s`（既定 300）/ `session_id` / `resume_session` / `append_system_prompt` のみ。`to_cli_args()` が `claude -p` の `--session-id` / `--resume` / `--append-system-prompt` を組む。
- subprocess は同期 await、timeout 超過 = `ErrorKind.TIMEOUT`。
- **stderr 分類は表面化専用**: `_classify_stderr` は `NO_PRIOR_SESSION` / `SESSION_ALREADY_IN_USE` を識別するが、それ以外は `ErrorKind.OTHER` に倒す。enum 値で if 分岐して自動回復を組まない（分類は通知 / ログ / state 確定のための表面化であって、回復は state 引き or ユーザー介入に委ねる＝上位 CLAUDE.md 派生原則）。
