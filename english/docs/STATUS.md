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
- pipeline テスト: `python3 -m unittest discover -s pipeline/tests -p "test_*.py"` (60 本)

## 運用メモ・設計判断の記録

- yt-dlp は `~/bin/yt-dlp` (dlqueue と同一実体・同一 720p フォーマット)。破損対応は dlqueue の churn 台帳に相乗り
- **`clips.py --rebuild` は attempts を意図的に残す** (2026-07-02 レビュー裁定): attempts は streak/正答率履歴の源泉のため削除しない。rebuild 時のみ FK を明示 OFF して clips 行を削除 → commit 後に mp4 を unlink。clip id は決定的 (`<episode_id>-<start_ms>`) なので、開始時刻が変わらないクリップの attempts は再生成後に自然と有効参照に戻る
- clip id が end を含まないため、清掃規則変更後の rebuild で「同 id・別内容」の mp4 があり得る (Cache 7 日、rebuild は稀なので許容 — レビュー記録)
- **誤答肢は confusion group → 同文法カテゴリ → 全プールランダムの 3 段フォールバック** (2026-07-14 #80、カテゴリ未所属の content word は従来どおりランダム)。カテゴリ定義は `pipeline/wordlists/categories.json`、weak_forms 全語カバーは回帰テストで担保
- 対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` を参照

## TODO

- [ ] TADC Ep 4 (Q9KWcWKo2T8) の再取込 — 2026-07-10 の一括 ingest で唯一 DL 失敗 (HTTP 403 Forbidden、yt-dlp impersonation 案内。設計契約どおり 1 回確定・リトライせず)。yt-dlp 更新 or impersonation 依存導入後に run_all.sh 再走で冪等に拾える
  (注: sources.json は**追記のみ**。既存エントリの前に行を挿入すると未取込分の source_order がずれ、同日公開の既存行と sort_key 衝突 (順序不定) の余地がある — 2026-07-10 レビュー指摘)
- [ ] v1 残り: 新エピソード自動巡回の夜間バッチ化 / 入力式解答 / 弱点タグ統計画面 / english.db の USB バックアップ追加
- [ ] #80 レビュー軽微 3 件 (2026-07-14 code-reviewer、対応任意・OWNER 判断待ち): ① `refresh_blanks` に空欄 idx/answer 不一致の skip guard 追加 (現状は tokens 一致のみコード強制。wordlists 編集後に叩くと idx/answer が黙って変わり得る) ② categories.json の 2 カテゴリに文法スロット混載 (quantifiers_degree に限定詞系と程度副詞、casual_reductions に動詞句と数量 — 'some' の誤答肢に 'very' が出る余地) ③ `_load_categories` にアポストロフィ正規化なし (現ファイルは ASCII で実害ゼロ、カーリー付き追記時に無音不一致)

## Done

- 2026-07-21: **エピソード視聴プレイヤーに日本語字幕の同時表示** (OWNER 要望「英語字幕と一緒に日本語字幕もでてほしい。それぞれ on/off できると尚良し」)。`/api/episodes/<id>` に `ja_sub_url` を追加 — episodes テーブルに ja 専用列は増やさず、`media/subs/raw/<episode_id>.ja.vtt` (ingest.py `_download_ja_subtitle` が手動 ja 字幕のみ best-effort 取得、18 話中 13 話ぶんあり) の実在をリクエスト時にチェックして返す (無い 5 話は null)。raw ja vtt は実データ確認 (HwAPLk_sQ3w) で改行・句読点とも視聴に十分な品質のため清掃なしでそのまま配信。web 側は英語 track と同型の 2 本目 hidden track + 専用行 (`.sub-line-ja`、英語行より一段小さく muted) + 独立トグルボタン (ja_sub_url が null の話はトグル自体を出さない)。検証: `python3 server/tests/test_api.py` 全 PASS (ja あり/なし両ケース追加) + pipeline unittest 60 本 (無関係、退行なし) + 隔離ポート (47828、本番DBのコピーを ENGLISH_DB に指定・本番 47827 は無変更のはずが後述の事故で結果的に触れた) で Playwright E2E (412x915、実データ HwAPLk_sQ3w): EN/JA 字幕が実テキストで独立描画・独立トグル (EN off でも JA 残る) を確認、ja_sub_url null 話 (BwYcdNKY7N8) でトグル非表示を確認。**運用事故**: 隔離テスト用サーバ停止のため `pkill -f "server/app.py"` を実行したところパターンが本番 systemd プロセス (PID 1158) にも一致し、OWNER 視聴中の本番 companion-english を約12秒誤って停止 (23:42:41 停止 → 23:42:53 `systemctl --user start` で復旧、視聴位置は直前の watch 保存 (1387s) で無事)。**restart しない制約に抵触** — 意図せず新コード (本変更の app.py 差分) が本番へ反映済み。OWNER 側でブラウザのリロードのみ必要 (再 restart 不要、既に反映済み)。原因: バックグラウンドテストプロセスの停止は `$!` 等の PID 捕捉で行うべきだった。web/app.js・style.css はリロードのみで反映される既存の運用前提どおり
- 2026-07-14: **誤答肢の品質改善 — 文法カテゴリ第 2 フォールバック導入 + 全クリップ backfill** (#80「もっと学習によさそうな出題に」)。従来は confusion group 非所属の空欄 (弱形機能語が大半) の誤答肢が weak_forms+common2000 全プールランダムで、「聞き取らなくても文法だけで解ける」問題が大半だった (実測例: answer='an' に choices=['references','an','appear','secretary'])。`pipeline/wordlists/categories.json` 新設 (16 カテゴリ、weak_forms 全 58 語カバー + common2000 の頻出機能語、1 語複数所属可で候補は合併) し、`_build_choices` を confusion group → 同カテゴリ (クリップ単位決定的 rng、sort→shuffle) → 全プールランダムの 3 段に変更。`--refresh-blanks <EPISODE_ID|all>` 新設 (fill_translations と同じ UPDATE のみバックフィル、mp4/attempts 無変更、tokens 不一致・None は skip してログ) で全 15 話 377 クリップを埋め直し。検証: pipeline テスト 60 本 (9 本追加: カテゴリカバー回帰ガード/3 段フォールバック/決定性/refresh 不変性) + test_api 全 PASS、backup DB との全行比較で tokens/空欄 idx/answer/feature_tags の不変性違反ゼロ・662 空欄中 640 で choices 改善 (残 22 は confusion group で 3 語揃済み)、after 実例: 'an'→['another','this','every','an']、'but'→['if','unless','or','but']、'you'→['it','we','she','you']。server はキャッシュなし (リクエスト毎 DB 読み) のため restart 不要、loopback /api/home 200 確認
- 2026-07-10: **weights レンジクランプ** (v1 レビュー軽微指摘の反映、user 承認)。validate_output で 0.5〜3.0 を強制 (範囲逸脱は NG でなくクランプ、極端値 1 つで analysis 全体を fallback に落とさない) + ペアキーの空白 strip 正規化。pipeline テスト 51 本 (2 本追加) 全 PASS
- 2026-07-10: **教材一括追加 — TADC Ep2-9 + Bee and PuppyCat Ep1-10 (18 本) を sources.json に追記して ingest** (TODO「TADC 残り 8 話 + Bee and PuppyCat」消化、設計 v0.11)。結果: added=17 / failed=1 (TADC Ep4 Q9KWcWKo2T8 が HTTP 403、1 回確定でログのみ・リトライなし)、subs cleaned=17/17、clips made=337 (総計 377 本)。既存 TADC Ep1 は冪等 skip を実測確認。BPC は Ep5/6/8/9/10 が auto 字幕 (設計どおり sub_kind=auto)。**auto 字幕 3 話 (BPC Ep5/6/9) はクリップ 0 本** — 2018 再アップの自動字幕に句読点がなく文分割が 4〜12 秒 / 5〜25 語基準を全て外れるため (視聴専用ではなく sub_kind=auto のままライブラリ視聴可、クリップ選定基準による自然な結果として許容)。media 総量 1.4GB (+1.3GB)。あわせて**表示順タイブレーク修正**: 単一動画 URL は playlist_index がなく upload_date フォールバックが BPC Ep1/Ep2 (同日 20141107 公開) で同値タイ → sources.json のエントリ順を 0 埋めサフィックスで sort_key に焼き込み (state 側 1 回確定、server 無変更・video_id 辞書順は不採用)。検証: pipeline 49 本 (sort_key 7 本追加)・test_api 全 PASS、/api/library 実レスポンスで BPC Ep1→Ep2 正順、クリップ 3 本 ffprobe 健全 (h264+aac)

- 2026-07-10: **v0 検証 (1〜2 週間毎日使うか、設計 §6 v0 完了条件) は user 判断でクリア扱い**、v1 GO。TODO から検証項目を除去 (code-reviewer 指摘への判断記録)

- 2026-07-10: **v1「傾向と対策」実装・稼働開始** (#61 続き、設計 §3.4 / v0.10)。`pipeline/analyze.py` 新設 — 直近 14 日の attempts×clips を JSON 集計し `claude -p --output-format json` 1 回で report_md + weights (契約スキーマ `{"feature_tags":{...},"pairs":{...}}`、ペアキーはソート済み `|` 連結・未ソートは正規化受理) を生成、失敗 (rc≠0/JSON 不正/スキーマ NG) は 1 回確定でルールベース fallback (feature_tag 誤答率→weights、pairs は LLM 限定で常に空)、analysis へ INSERT OR REPLACE。窓内 attempts 0 件は何も書かない。`/api/home` に `analysis:{date,report_md,source}|null` を追加しホームにレポートカード (行なしは非表示 = v0 挙動)。drill.py の weights 受け口は v0 実装済みで無変更。夜間 timer (03:10+ゆらぎ 30 分、WorkingDirectory=english/ 固定、Nice 19/ionice idle) install/enable 済み。検証: pipeline 42 本 (analyze 18 本追加)・test_api 88 チェック全 PASS、実弾 llm/fallback 両経路 + systemd 経由実走 OK、DB コピーで weights が選定順位に効くこと (we're/were 誤答クリップの繰り上がり) を実測

- 2026-07-08: **本編内の位置バー + エピソード消化カバレッジ** (#72、設計 v0.9)。drill クリップ応答に `episode_duration_s`、answer 応答に `episode_progress:{attempted,total}` (全期間 DISTINCT、drill.episode_clip_progress) を追加。出題・答え合わせ画面のクリップ直下に本編内位置マーカー + `本編 MM:SS / MM:SS`、答え合わせ画面に `N / M 回答済み` バー (全問到達で緑「通しで見てOK」— 目安表示でありロックではない)。テスト: test_api 83 チェック全 PASS + 隔離 fixture の Playwright E2E (実プレイ経路で 1/4→4/4、位置バー描画・complete 切替を実観測)

- 2026-07-06: **Pixel 6 実機で縦切り確認 OK** (§8 チェックリスト最後の 1 項目)。user が実機 (縦持ち) で ホーム / ドリル 1 セット / 動画再生 (シーク・動画外字幕) / クリップ音声 を確認、崩れ・問題なし。§8 は全項目消化 (tailscale serve 8447 の実見も Pixel 6 からの tailnet アクセス成功で充足)

- 2026-07-03: **日本語訳 + 動画外字幕** (user 要望、設計 v0.8)。clips.translation (公式 ja 字幕から抽出、Ep1 40/40 バックフィル済み) を答え合わせ応答でのみ返す。プレイヤー字幕は track hidden + cuechange で動画直下に自前描画。テスト: pipeline unittest / server test_api 全 PASS + 隔離 E2E

- 2026-07-02: **v0 実装完了・本番稼働開始** (#63)。implementer 3 体 (pipeline/server/web) 並列実装 + code-reviewer 全体レビュー反映 (修正必須 1: rebuild FK 違反 / 軽微: 空 daily_set 非固定・watch 入力検証・カーリーアポストロフィ対称化)。検証: pipeline unittest 19 本 / server test_api 69 チェック / 実データ E2E (Playwright 412x915、隔離 DB) / tailnet 8447 疎通
- 2026-07-02: TADC Ep1 実弾 ingest (sub_kind=manual 判定、字幕注記・話者ダッシュ・ラベル残渣の清掃を実データで確定、クリップ 40 本)
- 2026-07-02: 設計 v0.6 確定 (workspace 側)、UI モック 4 案 → D 案 user 確定、english/ 雛形作成
