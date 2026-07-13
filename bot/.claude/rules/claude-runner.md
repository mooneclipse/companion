---
paths:
  - "claude_runner.py"
---

# claude_runner.py（claude CLI ラッパ）編集時ルール

- `ClaudeOptions` のフィールドは `session_id` / `resume_session`（相互排他、両方指定は ValueError）/ `output_format`（既定 `"json"`）/ `permission_mode`（既定 `"auto"`）/ `model`（既定 `"claude-sonnet-5"`、UQ-10 の Sonnet 固定方針）/ `timeout_s`（既定 300）/ `append_system_prompt` のみ。`to_cli_args()` が `claude -p` の `--session-id` / `--resume` / `--output-format` / `--permission-mode` / `--model` / `--append-system-prompt` を組む。
- subprocess は同期 await、timeout 超過 = `ErrorKind.TIMEOUT`。
- **stderr 分類は表面化専用**: `_classify_stderr` は `NO_PRIOR_SESSION` / `SESSION_ALREADY_IN_USE` を識別するが、それ以外は `ErrorKind.OTHER` に倒す。enum 値で if 分岐して自動回復を組まない（分類は通知 / ログ / state 確定のための表面化であって、回復は state 引き or ユーザー介入に委ねる＝上位 CLAUDE.md 派生原則）。
