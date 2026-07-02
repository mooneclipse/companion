# companion-english STATUS

英語リスニング学習アプリ (チケット #61/#63)。設計台帳: `~/companion/workspace/redesign/english-design.md` (最新版が正、v0.7 で実装確定差分を反映済み)。
UI 確定案: **D 融合 (A 字幕の骨格 + ドリルのみ C の可読性)** — モック生成元 `~/companion/workspace/redesign/english-ui-mocks/build.py`。

## 稼働情報

- systemd user service `companion-english` → 127.0.0.1:47827
- 公開: `https://miho-inspiron-3521.tail5e989b.ts.net:8447/` (tailscale serve、2026-07-02 設定)
- リモコン PWA タイル「♪ 09 耳ならし」から遷移 (remote repo 側)
- 教材: TADC Ep1 (HwAPLk_sQ3w、手動 en 字幕、クリップ 40 本) 取込済み

## 構成 (設計 §1)

- `pipeline/` — ingest (yt-dlp) → subs (字幕クリーニング) → clips (切り出し+穴埋め生成)。v0 は手動実行 (`run_all.sh`)
- `server/` — ThreadingHTTPServer (静的 + JSON API + /media Range)。テスト: `python3 server/tests/test_api.py` (69 チェック)
- `web/` — vanilla SPA (D 案)。SW なし (photos と同じ、キャッシュ版すれ違い回避)
- `data/english.db` — SQLite (WAL)。`media/` `inbox/` とも .gitignore
- pipeline テスト: `python3 -m unittest discover -s pipeline/tests -p "test_*.py"` (19 本)

## 運用メモ・設計判断の記録

- yt-dlp は `~/bin/yt-dlp` (dlqueue と同一実体・同一 720p フォーマット)。破損対応は dlqueue の churn 台帳に相乗り
- **`clips.py --rebuild` は attempts を意図的に残す** (2026-07-02 レビュー裁定): attempts は streak/正答率履歴の源泉のため削除しない。rebuild 時のみ FK を明示 OFF して clips 行を削除 → commit 後に mp4 を unlink。clip id は決定的 (`<episode_id>-<start_ms>`) なので、開始時刻が変わらないクリップの attempts は再生成後に自然と有効参照に戻る
- clip id が end を含まないため、清掃規則変更後の rebuild で「同 id・別内容」の mp4 があり得る (Cache 7 日、rebuild は稀なので許容 — レビュー記録)
- 対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` を参照

## TODO

- [ ] **Pixel 6 実機で縦切り確認** (§8 チェックリスト最後の 1 項目、user の実機で)
- [ ] TADC 残り 8 話 + Bee and PuppyCat (個別動画 URL) を sources.json に追加して ingest
- [ ] 1〜2 週間 毎日使うか検証 (v0 完了条件、設計 §6)
- [ ] v1: 夜間バッチ化 / analyze.py (claude -p 傾向と対策) / 入力式解答 / english.db の USB バックアップ追加

## Done

- 2026-07-02: **v0 実装完了・本番稼働開始** (#63)。implementer 3 体 (pipeline/server/web) 並列実装 + code-reviewer 全体レビュー反映 (修正必須 1: rebuild FK 違反 / 軽微: 空 daily_set 非固定・watch 入力検証・カーリーアポストロフィ対称化)。検証: pipeline unittest 19 本 / server test_api 69 チェック / 実データ E2E (Playwright 412x915、隔離 DB) / tailnet 8447 疎通
- 2026-07-02: TADC Ep1 実弾 ingest (sub_kind=manual 判定、字幕注記・話者ダッシュ・ラベル残渣の清掃を実データで確定、クリップ 40 本)
- 2026-07-02: 設計 v0.6 確定 (workspace 側)、UI モック 4 案 → D 案 user 確定、english/ 雛形作成
