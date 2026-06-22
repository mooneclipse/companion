---
paths:
  - "sessions.py"
---

# sessions.py（セッション永続化）編集時ルール

- 1 topic = 1 JSON（`sessions/topics/<chat_id>_<thread_id or 'general'>.json`）。`(chat_id, thread_id)` の複合キーで 1:1 マッピング。
- General topic（thread_id=None）はファイル名 suffix を文字列 `"general"` にする（数値 0 衝突回避、§2.3 / N-T8 回避）。
- session_id は初回 prompt で uuid 割当、以降は `--resume`。
- `record_usage` は claude 成功後のみ `last_prompt_at` / `last_used_at` / `prompt_count` を更新する（失敗時は触らない）。
