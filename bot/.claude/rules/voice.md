---
paths:
  - "voice_command.py"
---

# voice_command.py（自発発話の声実体）編集時ルール

- `cmd_say` は VOICEVOX engine の **on-demand 起動** + `say.sh` 実行。呼び出し元は自発発話（`bot.py` の `_proactive_voice_worker`）のみ（`/say` slash command は 2026-07-21 削除、以後 `cmd_say` の唯一の呼び出し元）。engine 起動（`systemctl --user start companion-voice-engine.service`）と ready polling は best-effort（`_run_quiet`、失敗は warning のみ）。
- **成否は say.sh の exit code 1 回で確定**（retry / stderr 分岐で自動回復しない＝上位 CLAUDE.md「1 回で確定」原則）。`SAY_TIMEOUT_S=90s`。
- 合成責任は say.sh 側（検証済み・無変更）。本モジュールは bot 経路の wrapper のみ（engine on-demand 起動を担い、合成はしない）。
- **記録は行わない**（`voice_ledger.jsonl` / `append_ledger` は `/say` 専用だったため 2026-07-21 削除済み）。声の rc は呼び出し元 (`_proactive_voice_worker`) が logger にのみ出し、発火有無は `proactive_ledger` の `voice` フィールドに残す（集計の置き場所は proactive 側）。engine start/stop は `_say_lock` で直列化（先行 `finally` stop が後発の合成中 engine を落とす競合を消す）。
