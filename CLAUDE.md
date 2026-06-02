# CLAUDE.md (games, CWD=games 固有)

このファイルは CWD=`~/companion/games/` で claude CLI を起動したときに auto-discovery で読まれる、companion-games 固有の制約。**共通項は上位 `~/companion/CLAUDE.md` を参照**（応答言語 / 口調 / vault 書き込み境界 / OWNER 認可 / git 運用方針）。**対症療法 2 周目ルールも上位 `~/companion/CLAUDE.md`「設計判断・対症療法の上限」を参照**。

開発ワークフローは `~/companion/workspace/.claude/skills/newgame/SKILL.md`（新規ゲーム制作の固定工程）が正本。本ファイルは「どの工程でも踏み外してはいけない games 固有の暗黙知」を明文化する。台帳の正本は `~/companion/games/docs/STATUS.md`。

## 配信境界（厳守）

- サーバ（`server/app.py`）は **127.0.0.1 のみに bind**。`0.0.0.0` / tailnet IP への bind は厳禁。
- 外向きは **`tailscale serve`（HTTPS 前段リバースプロキシ）経由のみ**。Tailnet 内からしか到達しない。
- 認証は tailscale 境界に委任（単一ユーザー、API 無し）。`/healthz` のみ無認証の生存確認。
- ポートは env `GAMES_PORT`（default 47825）。
- 配信は固定 allowlist 方式（`STATIC` dict）。FS への URL 連結禁止・ディレクトリリスティング無し・Content-Type 明示・generic エラー・no-store を維持する。

## 純静的 PWA（budget-guard 境界回避）

- ゲームはランタイムで claude / 外部 API を **一切呼ばない**。配信時は素朴なファイルサーブに徹する（budget-guard 境界に踏み込まない）。
- 唯一許す外部依存は和文フォントの **Google Fonts CDN のみ**（CSP で `fonts.googleapis.com` / `fonts.gstatic.com` の 2 ドメインだけ許可）。取得失敗時は CSS の serif フォールバックで成立させる。
- 音源など新たな外部取得を足す場合は index.html の CSP（`connect-src` / `media-src`）更新が必須。同一オリジン同梱なら CSP 変更不要。

## 断章は verbatim 静的データ

- 断章テキストは `<game>/web/fragments.js` に **verbatim 静的データ** として置く。**実装側で創作・改変しない**（lead が美学確定の工程で書き切ったものをそのまま入れる）。progress 閾値 + text の構造、改行は保持。

## 実機検証必須（Playwright + Chromium）

- 構文 OK / 200 応答だけで「動く」と言わない。`tests/debug-<game>.mjs` を Chromium（headless）で回し PASS を取ってから報告・配信する。
- **画面座標ヒットテスト経由**で検証する（`page.mouse` を画面座標へ）。**canvas へ直接 dispatch しない**＝画面全体を覆う透明 overlay を飛び越えるとみちゆきの真因（overlay が pointer を食う）を見逃す。`elementFromPoint` で最前面要素を assert する。
- **既存作の回帰も同一起動サーバで通す**（既存 URL が不変＝壊していない証明）。
- 実行: サーバを `GAMES_PORT`（default 47825）で起動した状態で `node tests/debug-<game>.mjs`。`playwright` は `devDependencies`、ブラウザ本体は `~/.cache/ms-playwright`（git 外）。
- 計測しきい値（画面差分の `th` / 変化率合格条件）は PALETTE の明暗で成立域が変わるため、新ゲームごとに初回基準を実測で定めてよい（同一バグへの 2 周目ではない）。同じ計測を 2 度目に動かすときは 2 周目ルールを先に発動させる。

## 前景視認性の原則

- 前景（プレイヤー／触れる対象）は背景の明度変化に追従し、**常にコントラストを確保**する（暗背景では明るめ・明背景では暗めへ相対的にずらす + ごく細い 1px 縁取り程度）。**初手から設計に入れる**（v1 みちゆきでは後から気づいた教訓）。「景色が主役・人は気配」を保ち、強い縁取りで目立たせない＝「ほとんど見えない」を「言われれば気づく」へ。

## 一次資料パス

新規ゲームの判断軸（継承資産・課題）は次から引く:

- vault `aidiary/2026-04-11_games-i-want-to-try.md`（嗜好の正本）
- vault `notes/*-review.md`（各作の感想、例 `notes/2026-06-02_michiyuki-review.md`）
- `~/companion/games/docs/STATUS.md` の感想・設計起点メモ

## 配信導線（新ゲーム追加時の 3 点 + VERSION）

1. `server/app.py` の `STATIC` dict に新ゲームの prefix エントリを追加（`/<game>/...` 絶対パス、rel は `<game>/web/...`）。既存作の URL は完全不変に保つ。
2. remote 側 `~/companion/remote/web/app.js` の `GAMES` 配列に 1 行追加 + SW cache bump。
3. `tailscale serve` 状態を確認（同一サーバ・同一ポートのため systemd unit は変更不要）。
4. **VERSION bump**: ゲーム本体（`<game>/web/*`）に手を入れるたびに **必ず** VERSION を上げる（app.js 内定数を単一真実源に opening へ薄く表示）。上げ忘れると実機キャッシュ残存と検証不足の切り分けが効かない（人手依存の残存リスク）。

## SW（Service Worker）運用

- **開発フェーズは Service Worker を使わない**。cache-first SW が壊れた中間状態の古い shell を返し続ける罠（killer SW で自浄）を踏むため。再導入はプレイ感が固まってから。
- SW を使う局面では cache 名 bump を規律として守る（ただし bump の積み増しは 2 周目になりうる。同じ境界の修正が 2 度目なら一段引いて設計を見直す）。

## 複数ゲーム配信

- 同一サーバ・同一ポートで **prefix 分け**（`/` = 第 1 作、`/<game>/` = 以降）。既存作の URL は完全不変に保つ（ユーザーがホーム追加した本番互換を壊さない）。
- `/` をゲーム選択ギャラリーにする案は **YAGNI で見送り**（3 作目以降で直リンク運用が辛くなったら `/` をギャラリー化し `STATIC` を分割）。

## git

- **(C) ローカル git のみ**（remote なし、rollback 専用）。GitHub remote は意図的に付けない（マシン外バックアップ不要、上げ忘れではない）。
- gitleaks pre-commit hook 必須（`.git/hooks/` 配下＝git 管理外なので、clone / 再 init 時は再配置する）。
- commit メッセージは既存ログスタイル（`feat(games):` / `docs(games):` / `refactor(games):`）に揃える。Co-Authored-By trailer は付けない。

## 対象ユーザー

miho 個人のみ（完全個人利用、外部公開なし）。スコア / マルチプレイ / 課金は不要。発注趣旨は「要望を聞かず AI が判断して作る」＝感想の解釈・次手の判断は AI 側で確定する（ユーザーは管理を委任済み）。
