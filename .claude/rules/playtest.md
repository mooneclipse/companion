---
paths:
  - "tests/**"
---

# 実機検証（`tests/`）ルール — Playwright + Chromium

ゲームの検証スクリプトを書く/回すときに必ず守る。全体地図は `CLAUDE.md`、台帳の正本は `docs/STATUS.md`。

- 構文 OK / 200 応答だけで「動く」と言わない。`tests/debug-<game>.mjs` を Chromium（headless）で回し PASS を取ってから報告・配信する。
- **画面座標ヒットテスト経由**で検証する（`page.mouse` を画面座標へ）。**canvas へ直接 dispatch しない**＝画面全体を覆う透明 overlay を飛び越えるとみちゆきの真因（overlay が pointer を食う）を見逃す。`elementFromPoint` で最前面要素を assert する。
- **既存作の回帰も同一起動サーバで通す**（既存 URL が不変＝壊していない証明）。
- 実行: **本番ポート 47825 は使わず**、別ポート（例 `GAMES_PORT=47826`）で検証用サーバを自前起動した状態で `node tests/debug-<game>.mjs`。検証後は検証サーバのみ PID 直指定で kill し、本番 `companion-games`（47825）には一切触れない（あかり検証で本番 kill→復帰忘れ 502 の事故）。`playwright` は `devDependencies`、ブラウザ本体は `~/.cache/ms-playwright`（git 外）。
- 計測しきい値（画面差分の `th` / 変化率合格条件）は PALETTE の明暗で成立域が変わるため、新ゲームごとに初回基準を実測で定めてよい（同一バグへの 2 周目ではない）。同じ計測を 2 度目に動かすときは 2 周目ルールを先に発動させる。
