---
paths:
  - "quota.py"
  - "voice_status.py"
---

# quota.py / voice_status.py（記録・集計）編集時ルール

- ledger は `sessions/ledger.jsonl`（append-only、エントリ単位 atomic）。記録項目は timestamp / topic_key / session_id / token 入出力 / cache / terminal_reason。
- **金額は記録しない**（subscription 消費前提で理論値は無意味）。`budget_guard` は回数（1h）ベースの gate のみ、金額 guard は撤去済み。
- voice_ledger（`sessions/voice_ledger.jsonl`）は bot 経由 `/say` 専用の記録先だったが、`/say` slash command 削除（2026-07-21）に伴い `append_ledger` ごと撤去済み（現在は記録しない）。`voice_status.format_voice_summary` は say.sh の `last-result`（`voice/.state/`）のみから集計する。
