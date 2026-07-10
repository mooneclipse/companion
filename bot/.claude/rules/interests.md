---
paths:
  - "interests.py"
---

# interests.py（関心 state 管理）編集時ルール

- state は `sessions/companion_interests.json`（gitignore、非 commit）。`MAX_THREADS=5`（超過は `last_touched` 最古を落とす）、`decay` は TTL（env `PROACTIVE_INTEREST_TTL_DAYS`、既定 14）で TTL 外を消す。
- **純関数 + 副作用分離**: 判定 / decay / touch は純関数（unit-test 対象）、副作用は `save_interests` / `append_thought` の atomic / append のみ。条件分岐や場当たりリトライを積まない。
- **実活動由来のみ**: topic / source は実際の活動（会話 / 照会）からのみ。bot が新しい関心 / 感情 / 趣味を捏造しない（このモジュールは記録専用）。
- decay は呼び出し側で先にかけて渡す前提（TTL で完全に消えたスレッドは振り返らない。TTL 内の「decay しかけ」が oldest として拾われる）。
