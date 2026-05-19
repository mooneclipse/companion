# companion-voice

Phase 3-2 (PROJECT.md L143-188) の TTS サブプロジェクト。VOICEVOX (CPU mode) で四国めたんの音声を合成し、**bot 駆動の `/say` slash command (24h 受付)** で発話する。朝自動発火 (morning-greeting) は Phase 4 punt。

確定設計: `~/companion/workspace/redesign/voice-design.md` v2.0 (2026-05-19, team `companion-voice-design` 仕切り直し議論 Round 1〜3 + lead 集約 + user 確定)

開発台帳: [docs/STATUS.md](docs/STATUS.md)

## 状態

- 2026-05-18: voice/ サブプロジェクト初期化、T-1 sprint #1 大部分 pass (発話確認のみ user 物理確認 pending)
- 2026-05-18〜19: T-1 sprint #2 V-1 pass / V-13 fail → voice-design v2.0 (case B: 朝自動発火 punt + bot 駆動先行) 確定
- 2026-05-19: 前倒し方針確定で voice/ 実装着手段に移行 (bot/ 側 voice_command.py 等は Phase 2.5 T-D 後半完了後 = 2026-06 中下旬の予定維持)
- voice/ git init は実装着手 1 件目の commit に揃える (PROJECT.md L46-59 のサブプロジェクト git 化手順)

## セットアップ

`SETUP.md` 参照 (公式 7z DL + 展開手順)。

## 使い方 (実装着手後に追記)

```bash
# 単発発話 (CLI 直接、bot 経由は voice_command.py 経路、Phase 2.5 T-D 後半完了後)
~/companion/voice/scripts/say.sh "テキスト" [speaker_id]
```

## ライセンス

- VOICEVOX 全体規約: <https://voicevox.hiroshiba.jp/term/>
- 四国めたん 個別規約: <https://zunko.jp/con_ongen_kiyaku.html>

companion 利用形態は完全個人使用 (外部公開なし)。クレジット記載対象なし。将来外部公開検討時 (Discord 公開サーバー / YouTube 配信 / GitHub public repo 等) は規約 URL を再確認し媒体に応じて記載判断する。
