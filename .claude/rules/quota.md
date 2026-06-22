---
paths:
  - "quota.py"
  - "voice_status.py"
---

# quota.py / voice_status.py（記録・集計）編集時ルール

- ledger は `sessions/ledger.jsonl`（append-only、エントリ単位 atomic）。記録項目は timestamp / topic_key / session_id / token 入出力 / cache / terminal_reason。
- **金額は記録しない**（subscription 消費前提で理論値は無意味）。`/quota` 表示も回数（1h/月）+ token のみ、金額は出さない。
- voice_ledger（`sessions/voice_ledger.jsonl`）は bot 経由 `/say` のみ。proactive_ledger とは別系統（自動発話と user 要求を分離）。`voice_status` は say.sh の `last-result`（`voice/.state/`）+ voice_ledger から集計する。
