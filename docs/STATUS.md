# companion-english STATUS

英語リスニング学習アプリ (チケット #61/#63)。設計台帳: `~/companion/workspace/redesign/english-design.md` (最新版が正)。
UI 確定案: **D 融合 (A 字幕の骨格 + ドリルのみ C の可読性)** — モック生成元 `~/companion/workspace/redesign/english-ui-mocks/build.py`。

## 構成 (設計 §1)

- `pipeline/` — ingest (yt-dlp) → subs (字幕クリーニング) → clips (切り出し+穴埋め生成)。v0 は手動実行
- `server/` — ThreadingHTTPServer 127.0.0.1:47827 (静的 + JSON API + /media Range)
- `web/` — vanilla SPA (D 案)。SW なし (photos と同じ、キャッシュ版すれ違い回避)
- `data/english.db` — SQLite (WAL)。`media/` `inbox/` とも .gitignore
- 公開: tailscale serve 8447 (443=remote / 8445=games / 8446=photos の次)

## 運用メモ

- yt-dlp は `~/bin/yt-dlp` (dlqueue と同一実体・同一 720p フォーマット)。破損対応は dlqueue の churn 台帳に相乗り
- 教材 (user 確定): TADC 本命 + Bee and PuppyCat 並走 (個別動画 ingest)。まず TADC Ep1 (HwAPLk_sQ3w) で pipeline を通す
- 対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` を参照

## In progress

- v0 実装 (#63): pipeline / server / web を implementer 並列で実装中 (2026-07-02)

## TODO

- [ ] TADC 残り 8 話 + Bee and PuppyCat を sources.json に追加して ingest
- [ ] 1〜2 週間 毎日使うか検証 (v0 完了条件、設計 §6)
- [ ] v1: 夜間バッチ化 / analyze.py (claude -p 傾向と対策) / 入力式解答 / db の USB バックアップ追加

## Done

- 2026-07-02: 設計 v0.6 確定 (workspace 側)、UI モック 4 案 → D 案 user 確定、english/ 雛形作成
