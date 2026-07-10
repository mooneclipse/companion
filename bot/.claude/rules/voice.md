---
paths:
  - "voice_command.py"
---

# voice_command.py（/say 音声発話）編集時ルール

- `/say` は VOICEVOX engine の **on-demand 起動** + `say.sh` 実行。engine 起動（`systemctl --user start companion-voice-engine.service`）と ready polling は best-effort（`_run_quiet`、失敗は warning のみ）。
- **成否は say.sh の exit code 1 回で確定**（retry / stderr 分岐で自動回復しない＝上位 CLAUDE.md「1 回で確定」原則）。`SAY_TIMEOUT_S=90s`。
- 合成責任は say.sh 側（検証済み・無変更）。本モジュールは bot 経路の wrapper のみ（engine on-demand 起動を担い、合成はしない）。
- 記録は `voice_ledger.jsonl` のみ（proactive_ledger ではない）。engine start/stop は bot 層 flock で直列化（先行 `finally` stop が後発の合成中 engine を落とす競合を消す）。
