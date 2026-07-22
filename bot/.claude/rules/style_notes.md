---
paths:
  - "style_notes.py"
---

# style_notes.py（口調フィードバック state 管理）編集時ルール

- state は `sessions/companion_style_notes.json`（gitignore、非 commit）。`MAX_NOTES=5`（超過は `last_touched` 最古を落とす）。interests.py の state 管理パターン（純関数 + atomic write 分離）を踏襲する。
- **read-back と emit-instruction を分離する**（bot/docs/STATUS.md 2026-07-22 着手前設計メモ）: `note_rules()` の戻り（read-back = 既存ルールを守れというデータ）は `PERSONA_SYSTEM_PROMPT` のような全経路共通の system prompt 定数に入れない。`build_proactive_prompt`/`compose_chat_prompt` 側で bounded な文字列リストとして展開する（interests.py の `interest_topics` と同じパターン）。`[[style-note: ...]]` marker を出させる emit-instruction は、marker を剥がす経路（on_message の既定 #chat 分岐）にだけ持たせる。他経路（osekkai/proactive talk/investigate/ticket/remind）に同じ指示を持たせると「marker を出してよいと指示されるのに剥がされない」経路が生まれ、marker が Telegram 本文に漏れる事故を作る。
- **実活動由来のみ**: rule は「OWNER が bot 自身の話し方を名指しで訂正した」ときだけ、claude 自身が marker で申告した内容に限定する。bot が新しいルールを捏造しない。
- 誤ったルールの訂正・削除は専用コマンドを作らず `sessions/companion_style_notes.json` の直接編集で足りる（OWNER 向け導線として state ファイルパスを明示しておく）。
