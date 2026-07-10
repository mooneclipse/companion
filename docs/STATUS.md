# companion-english STATUS

英語リスニング学習アプリ (チケット #61/#63)。設計台帳: `~/companion/workspace/redesign/english-design.md` (最新版が正、v0.7 で実装確定差分を反映済み)。
UI 確定案: **D 融合 (A 字幕の骨格 + ドリルのみ C の可読性)** — モック生成元 `~/companion/workspace/redesign/english-ui-mocks/build.py`。

## 稼働情報

- systemd user service `companion-english` → 127.0.0.1:47827
- systemd user timer `companion-english-analyze` → 毎晩 03:10 JST + ゆらぎ 30 分で `pipeline/analyze.py` (傾向と対策、claude -p + fallback)。enable 済み 2026-07-10
- 公開: `https://miho-inspiron-3521.tail5e989b.ts.net:8447/` (tailscale serve、2026-07-02 設定)
- リモコン PWA タイル「♪ 09 KIKITORI」から遷移 (remote repo 側)
- 教材: 18 話・クリップ 377 本 (TADC Ep1-9 の 8 話 — Ep4 は DL 403 失敗で未取込 / Bee and PuppyCat Ep1-10 の 10 話、2026-07-10 取込)

## 構成 (設計 §1)

- `pipeline/` — ingest (yt-dlp) → subs (字幕クリーニング) → clips (切り出し+穴埋め生成) は手動実行 (`run_all.sh`)。analyze (傾向と対策、§3.4) は夜間 timer
- `server/` — ThreadingHTTPServer (静的 + JSON API + /media Range)。テスト: `python3 server/tests/test_api.py` (88 チェック)
- `web/` — vanilla SPA (D 案)。SW なし (photos と同じ、キャッシュ版すれ違い回避)
- `data/english.db` — SQLite (WAL)。`media/` `inbox/` とも .gitignore
- pipeline テスト: `python3 -m unittest discover -s pipeline/tests -p "test_*.py"` (42 本)

## 運用メモ・設計判断の記録

- yt-dlp は `~/bin/yt-dlp` (dlqueue と同一実体・同一 720p フォーマット)。破損対応は dlqueue の churn 台帳に相乗り
- **`clips.py --rebuild` は attempts を意図的に残す** (2026-07-02 レビュー裁定): attempts は streak/正答率履歴の源泉のため削除しない。rebuild 時のみ FK を明示 OFF して clips 行を削除 → commit 後に mp4 を unlink。clip id は決定的 (`<episode_id>-<start_ms>`) なので、開始時刻が変わらないクリップの attempts は再生成後に自然と有効参照に戻る
- clip id が end を含まないため、清掃規則変更後の rebuild で「同 id・別内容」の mp4 があり得る (Cache 7 日、rebuild は稀なので許容 — レビュー記録)
- 対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` を参照

## TODO

- [ ] TADC Ep 4 (Q9KWcWKo2T8) の再取込 — 2026-07-10 の一括 ingest で唯一 DL 失敗 (HTTP 403 Forbidden、yt-dlp impersonation 案内。設計契約どおり 1 回確定・リトライせず)。yt-dlp 更新 or impersonation 依存導入後に run_all.sh 再走で冪等に拾える
  (注: sources.json は**追記のみ**。既存エントリの前に行を挿入すると未取込分の source_order がずれ、同日公開の既存行と sort_key 衝突 (順序不定) の余地がある — 2026-07-10 レビュー指摘)
- [ ] v1 残り: 新エピソード自動巡回の夜間バッチ化 / 入力式解答 / 弱点タグ統計画面 / english.db の USB バックアップ追加

## Done

- 2026-07-10: **教材一括追加 — TADC Ep2-9 + Bee and PuppyCat Ep1-10 (18 本) を sources.json に追記して ingest** (TODO「TADC 残り 8 話 + Bee and PuppyCat」消化、設計 v0.11)。結果: added=17 / failed=1 (TADC Ep4 Q9KWcWKo2T8 が HTTP 403、1 回確定でログのみ・リトライなし)、subs cleaned=17/17、clips made=337 (総計 377 本)。既存 TADC Ep1 は冪等 skip を実測確認。BPC は Ep5/6/8/9/10 が auto 字幕 (設計どおり sub_kind=auto)。**auto 字幕 3 話 (BPC Ep5/6/9) はクリップ 0 本** — 2018 再アップの自動字幕に句読点がなく文分割が 4〜12 秒 / 5〜25 語基準を全て外れるため (視聴専用ではなく sub_kind=auto のままライブラリ視聴可、クリップ選定基準による自然な結果として許容)。media 総量 1.4GB (+1.3GB)。あわせて**表示順タイブレーク修正**: 単一動画 URL は playlist_index がなく upload_date フォールバックが BPC Ep1/Ep2 (同日 20141107 公開) で同値タイ → sources.json のエントリ順を 0 埋めサフィックスで sort_key に焼き込み (state 側 1 回確定、server 無変更・video_id 辞書順は不採用)。検証: pipeline 49 本 (sort_key 7 本追加)・test_api 全 PASS、/api/library 実レスポンスで BPC Ep1→Ep2 正順、クリップ 3 本 ffprobe 健全 (h264+aac)

- 2026-07-10: **v0 検証 (1〜2 週間毎日使うか、設計 §6 v0 完了条件) は user 判断でクリア扱い**、v1 GO。TODO から検証項目を除去 (code-reviewer 指摘への判断記録)

- 2026-07-10: **v1「傾向と対策」実装・稼働開始** (#61 続き、設計 §3.4 / v0.10)。`pipeline/analyze.py` 新設 — 直近 14 日の attempts×clips を JSON 集計し `claude -p --output-format json` 1 回で report_md + weights (契約スキーマ `{"feature_tags":{...},"pairs":{...}}`、ペアキーはソート済み `|` 連結・未ソートは正規化受理) を生成、失敗 (rc≠0/JSON 不正/スキーマ NG) は 1 回確定でルールベース fallback (feature_tag 誤答率→weights、pairs は LLM 限定で常に空)、analysis へ INSERT OR REPLACE。窓内 attempts 0 件は何も書かない。`/api/home` に `analysis:{date,report_md,source}|null` を追加しホームにレポートカード (行なしは非表示 = v0 挙動)。drill.py の weights 受け口は v0 実装済みで無変更。夜間 timer (03:10+ゆらぎ 30 分、WorkingDirectory=english/ 固定、Nice 19/ionice idle) install/enable 済み。検証: pipeline 42 本 (analyze 18 本追加)・test_api 88 チェック全 PASS、実弾 llm/fallback 両経路 + systemd 経由実走 OK、DB コピーで weights が選定順位に効くこと (we're/were 誤答クリップの繰り上がり) を実測

- 2026-07-08: **本編内の位置バー + エピソード消化カバレッジ** (#72、設計 v0.9)。drill クリップ応答に `episode_duration_s`、answer 応答に `episode_progress:{attempted,total}` (全期間 DISTINCT、drill.episode_clip_progress) を追加。出題・答え合わせ画面のクリップ直下に本編内位置マーカー + `本編 MM:SS / MM:SS`、答え合わせ画面に `N / M 回答済み` バー (全問到達で緑「通しで見てOK」— 目安表示でありロックではない)。テスト: test_api 83 チェック全 PASS + 隔離 fixture の Playwright E2E (実プレイ経路で 1/4→4/4、位置バー描画・complete 切替を実観測)

- 2026-07-06: **Pixel 6 実機で縦切り確認 OK** (§8 チェックリスト最後の 1 項目)。user が実機 (縦持ち) で ホーム / ドリル 1 セット / 動画再生 (シーク・動画外字幕) / クリップ音声 を確認、崩れ・問題なし。§8 は全項目消化 (tailscale serve 8447 の実見も Pixel 6 からの tailnet アクセス成功で充足)

- 2026-07-03: **日本語訳 + 動画外字幕** (user 要望、設計 v0.8)。clips.translation (公式 ja 字幕から抽出、Ep1 40/40 バックフィル済み) を答え合わせ応答でのみ返す。プレイヤー字幕は track hidden + cuechange で動画直下に自前描画。テスト: pipeline unittest / server test_api 全 PASS + 隔離 E2E

- 2026-07-02: **v0 実装完了・本番稼働開始** (#63)。implementer 3 体 (pipeline/server/web) 並列実装 + code-reviewer 全体レビュー反映 (修正必須 1: rebuild FK 違反 / 軽微: 空 daily_set 非固定・watch 入力検証・カーリーアポストロフィ対称化)。検証: pipeline unittest 19 本 / server test_api 69 チェック / 実データ E2E (Playwright 412x915、隔離 DB) / tailnet 8447 疎通
- 2026-07-02: TADC Ep1 実弾 ingest (sub_kind=manual 判定、字幕注記・話者ダッシュ・ラベル残渣の清掃を実データで確定、クリップ 40 本)
- 2026-07-02: 設計 v0.6 確定 (workspace 側)、UI モック 4 案 → D 案 user 確定、english/ 雛形作成
