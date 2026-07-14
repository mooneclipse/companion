# companion-ytcheck STATUS

YouTube 巡回・字幕解析・AI 推薦システム。チャンネルリスト 56ch を毎日巡回し、新着動画の字幕を yt-dlp で取得、`claude -p` で「見る価値があるか」を評価して優先度別 Markdown レポートを Obsidian vault に出す。

- **出自**: Windows 11 機の別 claude code ワークスペースで開発、2026-07-06 の zip (`ytcheck-migration-20260706.zip`) で本機へ移行。引き継ぎの正は `../MIGRATION-NOTES.md`
- **git**: 2026-07-11 から `~/companion/` モノレポ配下 (チケット #82、旧ローカル git は分割時代履歴ごと取り込み済み。自動 commit はパス限定方式でモノレポ適合、index.lock 衝突が頻発したらモノレポから外すことを OWNER に相談 — 2026-07-10 の約束)。Windows 側原本は 2026-07-13 に削除 GO 案内済み (#67、削除実施は OWNER)
- **台帳**: このファイル。コード詳細は `python/youtube_checker/README.md`

## 実行系

| 項目 | 値 |
|---|---|
| 定時実行 | systemd user timer `companion-ytcheck.timer` (毎日 05:00 JST, Persistent, RandomizedDelay 5min) |
| エントリ | `run.sh` (timer / 手動共用。claude CLI の nvm パス解決 + 出力先環境変数の設定 + venv python で `main.py --all --output markdown`) |
| venv | `.venv/` (Python 3.10.12, requirements.txt) |
| ログ | journald のみ (`journalctl --user -u companion-ytcheck.service`) |
| レポート出力先 | `~/companion/vault/notes/ytcheck/ytcheck-YYYYMMDD-N.md` (`YTCHECK_WRITING_DIR`) |
| viewing 履歴 | `~/companion/vault/notes/ytcheck/viewing-YYYY-MM.md` (`YTCHECK_VIEWING_DIR`)。視聴後 `[x]` + 行末 ○/× を記入 → `tools/feedback_report.py` で月次集計 |
| チャンネルリスト | `tasks/youtube-channels.json` (repo 内固定。書き込みは `channel_store.py` 経由 = flock + atomic write + git 自動 commit、#69) |
| 評価キャッシュ | `python/youtube_checker/data/evaluated_cache.json` (gitignore。翌日以降は既評価スキップ) |

**外部流用の注意**: `tools/feedback_report.py` の `build_report` / `parse_viewing_text` / `_LINE_RE` / `_VIDEO_ID_RE` / `_FEEDBACK_RE` は companion-remote (`remote/server/ytcheck.py`) が sys.path 追加の import で流用中 (#65)。`channel_store.py` も同じく remote の巡回チャンネル編集 API (**#71 で 2026-07-07 接続済み** = `load` / `add_channel` / `update_channel` / `remove_channel` を import、remote commit d92241f) が import する前提で stdlib のみ・config 非依存。いずれも改名・移動・シグネチャ変更・stdlib 外依存の追加は remote サーバの起動を壊すため、変更時は remote 側の追随が必要 (詳細 = remote/docs/STATUS.md F-ytcheck エントリ)。

## youtube-channels.json への機械書き込みの git 運用 (2026-07-07 決定、#69)

repo 管理下の `tasks/youtube-channels.json` には 2 系統の機械書き込みが入る (毎朝 05:00 の subscriber_count 書き戻し + 将来の remote 編集 API)。運用は **書き込み成功後に git 自動 commit** (OWNER 裁定 2026-07-07):

- 根拠: (C) repo は rollback 専用。diff を working tree に溜める方式だと編集前スナップショットが commit されず、remote からの誤編集を戻せない期間が生じる。自動 commit なら 1 操作単位で rollback 可能
- commit は `channel_store._git_commit()` が flock 保持中に pathspec 付き (`git commit -m msg -- <json>`) で実行 = 他ファイルの staged 変更を巻き込まない + channel_store 同士の 2 プロセス同時 commit の index.lock 競合は構造的に排除 (手動 git 操作との競合は warning に落ちるのみ)。頻度は登録者数キャッシュ 7 日期限 + 編集時のみ
- commit 失敗 (hook 拒否等) は warning ログのみで書き込みは成功扱い。リトライ・分岐なし (エラーループ防止ルール準拠)
- 変更ゼロ (同値書き戻し) は write も commit もスキップ = 空 commit・無意味な mtime 更新なし

## 移行時の判断 (2026-07-07)

- **出力先を vault へ** (MIGRATION-NOTES §5 の最優先推奨どおり): `output_formatter.py` / `tools/feedback_report.py` の出力パスを環境変数 (`YTCHECK_WRITING_DIR` / `YTCHECK_VIEWING_DIR`) で上書き可能にし、`run.sh` で vault/notes/ytcheck/ に固定。**デフォルト値は repo 相対のまま** (テスト 229 件が mock.patch 前提で無改変パス)。チャンネルリストは repo 内固定 (feedback_report の `_CHANNEL_LIST_PATH` は `_TASKS_DIR` から分離)
- **pending 41 件 (2026-03〜05) は削除**: 鮮度切れ + claude 呼び出し 41 回分の usage 節約 (OWNER 判断)
- **viewing-2026-02〜05.md は vault へ移設** (repo tasks/ から移動)
- **git は (C)**: 既存 GitHub repo に用途の合う載せ先がなく (maintenance はシステム保守用)、OWNER 指定「新規 private repo になるならローカル git」に従う
- 移植確認: pytest **229 件全パス** (2026-07-07、MIGRATION-NOTES §8 の成功基準)
- **並列数を 2 に機差調整** (`run.sh` の `MAX_CONCURRENT_TASKS=2`、env が .env より優先): 初回実行 (並列 5) で 71 本中 34 本が「yt-dlp 60 秒タイムアウト」で AI失敗扱い。切り分け — (1) 単発 yt-dlp は 3 秒で成功 = IPv6 既知問題ではない、(2) タイムアウトは実行全体に均等分布 = 後半で始まるレート制限型ではない、(3) 無負荷でも並列 5 の yt-dlp だけで最大 44 秒 + **429 Too Many Requests** を実測。原因は移行元ゲーミング PC 向けの並列 5 が本機 (2 コア 1.8GHz) に過大 + YouTube 字幕エンドポイントの同時要求制限。並列数は config.py が正式サポートする設定項目のため、コード改変でなく設定で吸収 (対症療法 1 周目。これで再発したら subtitle_fetcher の timeout=60 固定を含め設計レベルで見直す)

## 残課題: yt-dlp タイムアウトの残り (2 周目判定 → 観察待ちで合理化、2026-07-07)

並列 2 化後の再実行でも 38 本中 7 本が同じ「yt-dlp 60 秒タイムアウト」。同一症状への 2 度目の対処になるため上位 CLAUDE.md ルールに従い数値いじり (timeout 延長・リトライ追加) は打たず、以下の根拠で **明朝以降の定常実行の観察待ち** に倒した:

- 並列 2 でも実行序盤 35 分はクリーン、失敗は後半に集中 (09:57〜10:01 に 3 連続)。単発では成功する動画が実行後半に落ちる = 動画固有でない
- 手動並列テストで **429 Too Many Requests** を実測 → YouTube 字幕エンドポイントの per-IP スロットリング (積算量で発動) が本因
- 移行当日は初回 71 本 + 再実行 38 本と異常な量。**定常 (日次差分 10〜25 本) ではスロットル閾値に達しない見込み**。失敗分はキャッシュされずチェック窓内なら翌朝自動再試行される (自己回復)
- **定常でも失敗が続く場合の設計レベル対処 (数値いじりではなく)**: (a) `yt-dlp[curl-cffi]` で impersonation 対応 (実行ログに「impersonate target 不在」警告あり = YouTube のクライアント判定に非対応な状態)、または (b) subtitle_fetcher に字幕リクエスト間の間隔制御を入れる。判断材料は journalctl の日次サマリー (AI失敗数)
- **観察結果 2026-07-08 (定常初回)**: 見込みどおりスロットル閾値に達せず。処理 28 / キャッシュスキップ 34 / AI失敗 **0** / 字幕失敗 12 (全件「字幕なし」= shorts・配信直後等の字幕未生成でタイムアウト・429 は 0 件) / 所要 801 秒。設計レベル対処は不要のまま観察継続
- **観察クローズ 2026-07-13 (#67 判断時)**: 07-08〜07-13 の 6 日連続で毎朝完走。AI失敗は 0 / 19 / 0 / 1 / 0 / 0 — **yt-dlp タイムアウト・429 起因の失敗は定常 6 日間で 0 件**、見込みどおり定常量ではスロットル閾値に達しない。設計レベル対処 (curl_cffi / 間隔制御) は不要と確定。07-09 の 19 件は yt-dlp と無関係な Claude Code CLI の一時障害 (returncode=1・stderr 空、当日のみで再発なし)。この 19 件の pending がリトライされない別バグを発見 → **#100** 起票 (下記 TODO)

## Done

- 2026-07-14: **pending 再評価のパス不一致バグ修正 (共用 TODO #100) — 完了、07-14 05:04 定常実行で残存 19 件の回収を確認済み** (journalctl: 「pending 再評価が完了しました（成功: 19 / 19 件）」、実行サマリー pending_retried=19・失敗 0、`pending_evaluations/` 残ファイル 0。#100 done)。解決を `ai_evaluator.resolve_pending_dir()` 1 関数に統一 — `_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent` アンカー (channel_store.py / main.py / output_formatter.py の既存導出と同一)、絶対パス設定はそのまま通す。保存側 (`save_pending_evaluation`) の CWD 相対解決と、リトライ側 (`main._resolve_pending_dir` = 誤った `youtube_checker/` 直下アンカー、削除) の両方をこの関数に寄せた。実運用は systemd WorkingDirectory = repo ルートなので保存先は従来と同一 = 残存 19 件 (07-09 Claude CLI 障害分) はそのまま回収対象になる。検証 = pytest **253 件全パス** (既存テストは絶対パス patch のため無傷、`mock.patch("ai_evaluator.settings")` も module 内 settings 参照で有効) + CWD=/ からの import で `resolve_pending_dir()` = `~/companion/ytcheck/pending_evaluations` (19 件 glob 可視) を実測。code-reviewer 修正必須なし (軽微 = バグ痕跡の空 `youtube_checker/pending_evaluations/` を rmdir → 実施済み / `.gitignore` の `pending_evaluations/*.json` は修正で常時整合になったの確認のみ)。**残観察**: 07-14 05:04 の定常実行サマリーで pending_retried=19 と残ファイル 0 を確認したら #100 done
- 2026-07-13: **Windows 側原本の削除 GO 判断 (共用 TODO #67) — 両条件充足で GO**。条件 (1) 定常安定 = journalctl で 07-08〜07-13 の 6 日連続完走を確認 (AI失敗 0/19/0/1/0/0、yt-dlp タイムアウト・429 は 0 件。07-09 の 19 件は Claude CLI 一時障害で当日のみ)。条件 (2) USB バックアップ = 2026-07-12 の新設定 (companion 込み) 実行成功 (workspace commit bc69284、snapshot 06fa1bed・check エラーなし・restore 検証済み)。OWNER へ「Windows 側 `C:\Users\fish_\ドキュメント\claudecode\` 配下の ytcheck を消して OK」を案内。調査の副産物として pending 再評価のパス不一致バグを発見し **#100** 起票(OWNER 口頭報告、チケット番号なし)。「配信予定枠が cover に分類された」報告を調査 → `title_normalizer.is_excluded_video` の cover/MV 判定が単純な部分文字列一致で、無関係な英単語 (`discovering`/`recovered`/`MVP`) に誤爆すると判明 (実例: `【#NIJIENChanted2】...discovering the nether...` が `discovering` 内の `cover` にヒットして cover 扱い)。live/upcoming 状態は無関係と確認済み (upcoming 動画が cover ラベルを得る経路は `process_video` のタイトル早期判定・字幕なし一本のみ)。**却下した案**: upcoming/live を cover 除外から一律免除する設計 — 歌ってみた premiere は upcoming 状態で走るため、免除すると正当な除外対象が漏れる回帰を生む。**採用**: 英数字キーワード (`cover`/`Covered by`/`MV`/`original song` 等) のみ ASCII 英数字基準の単語境界 lookaround (`(?&lt;![A-Za-z0-9])kw(?![A-Za-z0-9])`) に変更、日本語キーワードは部分一致のまま維持 (分かち書きされず境界判定不可)。素の `re \b` は日本語の漢字/かな/カナも word 文字とみなすため「公式MV公開」のような正当な埋め込みが漏れる回帰があり不採用 (既存テストの失敗で発覚)。code-reviewer 指摘を反映し `covered`(byなし)/`original songs`(複数形) も真陽性として拾えるようキーワード追加。pytest **253 件全パス** (新規4件)
- 2026-07-08: **定常実行の初回確認 (共用 TODO #66) — 正常**。05:04 timer 起動、54ch 巡回・処理 28 本・AI失敗 0・タイムアウト/429 なし (詳細は上記「残課題」観察結果)。レポート `ytcheck-20260708-1.md` 出力確認。#66 done
- 2026-07-07: **youtube-channels.json の flock 排他 + 1ch 単位 CRUD を先行実装** (共用 TODO **#69** = #65 後段、remote 編集 UI 接続の前提整備)。`channel_store.py` 新設 (stdlib のみ・config 非依存 = remote が sys.path import する前提): `tasks/.channels.lock` の flock(LOCK_EX) で read→modify→write 全体を排他 (`.viewing.lock` と同パターン、blocking・リトライなし) + 同ディレクトリ tmp + `os.replace` の atomic write (途中クラッシュの JSON 破損 → 翌朝巡回全滅を防止) + 書き込み後 git 自動 commit (上記運用セクション参照)。CRUD は `load` / `get_channel` / `add_channel` (重複 ValueError) / `update_channel` (channel_id 不変・同値スキップ) / `remove_channel` / `merge_subscriber_counts`。**調査で判明した設計問題も同時に解消**: 従来の `main._refresh_subscriber_cache` は load 時点のメモリ上 channels 全体を `data["channels"] = channels` で上書きしており、flock を足すだけでは load〜書き戻し間 (pending リトライを挟み数秒〜数分) の並行編集が消える lost update が残る → 書き戻しを `merge_subscriber_counts` (ロック下 re-read + subscriber_count / subscriber_count_updated_at の 2 フィールドのみ merge) に置き換えて解消。`.gitignore` に `tasks/.channels.lock` / `tasks/*.tmp` 追加。検証 = pytest **250 件全パス** (新規 21 件: CRUD / lost update 防止 / lock 保持中ブロック / atomic / git commit 実弾 / repo 外 graceful) + system python3 (venv 外 = remote 相当の stdlib-only 環境) で本番 56ch JSON への read + no-op merge 実弾確認 (mtime 不変・merged=0)。remote 側編集 UI の接続は別チケットで起票 (2 段構えの後段)
- 2026-07-07: **viewing 履歴書き込みに cross-process flock を追加** (共用 TODO #65 = companion-remote の視聴フィードバック連携に伴う ytcheck 側唯一の改修)。remote の PWA が `viewing-YYYY-MM.md` の該当行 (`[ ]`→`[x]` / `[feedback: ○|×]`) を書き換える API を持ったため、`output_formatter.update_viewing_history()` の read→全文再構成→write を viewing ディレクトリ直下の共有ロックファイル `.viewing.lock` の flock(LOCK_EX) で囲んだ (remote/server/ytcheck.py と同一パス導出。remote 側だけのロックでは 05:00 巡回との lost update を防げない = remote/docs/STATUS.md R3)。blocking 取得・timeout リトライなし。本体は `_update_viewing_history_locked()` に切り出し、既存ロジック無改変。pytest 229 件全パス (tests は mock.patch の tmp_path 上で回帰なし)。remote 側の実装・検証詳細は remote/docs/STATUS.md 2026-07-07 F-ytcheck エントリ参照
- 2026-07-07: 移行完了 — zip 展開 (Windows 製 zip のバックスラッシュ区切りを Python zipfile で正規化)、(C) git 化 + gitleaks hook (検出 2 件は gitignore 済み .env 内キーで想定通り)、パス環境変数化、venv + pytest 229 パス、timer 登録 (次回 07-08 05:04 JST)
- 2026-07-07: 初回実行 (並列 5、34/71 失敗) → 並列 2 に機差調整 → 再実行で 33 件キャッシュスキップ + 失敗 7 件まで改善。レポート `ytcheck-20260707-1.md` / `-2.md` と `viewing-2026-07.md` が vault に出力されたのを確認。code-reviewer レビュー済み (修正必須なし、mkdir 追加 + feedback_report の env 前置注記を反映)

## TODO

- [ ] google api_core が 2026-10-04 以降 Python 3.11+ 要求 (FutureWarning)。Mint の python3 は 3.10 — 警告が実害化したら requirements 側を固定するか python3.11 venv を検討
- [ ] 視聴フィードバック 3 ヶ月分 (2026-08 頃) で月次集計を回す。viewing は vault にあるため env 前置が必須: `YTCHECK_VIEWING_DIR=~/companion/vault/notes/ytcheck .venv/bin/python python/youtube_checker/tools/feedback_report.py`

---
**最終更新**: 2026-07-14
