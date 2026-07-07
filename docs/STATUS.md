# companion-ytcheck STATUS

YouTube 巡回・字幕解析・AI 推薦システム。チャンネルリスト 56ch を毎日巡回し、新着動画の字幕を yt-dlp で取得、`claude -p` で「見る価値があるか」を評価して優先度別 Markdown レポートを Obsidian vault に出す。

- **出自**: Windows 11 機の別 claude code ワークスペースで開発、2026-07-06 の zip (`ytcheck-migration-20260706.zip`) で本機へ移行。引き継ぎの正は `../MIGRATION-NOTES.md`
- **git**: (C) ローカル git のみ・remote なし・rollback 専用。Windows 側原本はこちらが軌道に乗ったら削除予定 (OWNER 判断 2026-07-07)
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
| チャンネルリスト | `tasks/youtube-channels.json` (repo 内固定。main.py が登録者数キャッシュを毎回更新 = repo に diff が出るのは正常) |
| 評価キャッシュ | `python/youtube_checker/data/evaluated_cache.json` (gitignore。翌日以降は既評価スキップ) |

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

## Done

- 2026-07-07: **viewing 履歴書き込みに cross-process flock を追加** (共用 TODO #65 = companion-remote の視聴フィードバック連携に伴う ytcheck 側唯一の改修)。remote の PWA が `viewing-YYYY-MM.md` の該当行 (`[ ]`→`[x]` / `[feedback: ○|×]`) を書き換える API を持ったため、`output_formatter.update_viewing_history()` の read→全文再構成→write を viewing ディレクトリ直下の共有ロックファイル `.viewing.lock` の flock(LOCK_EX) で囲んだ (remote/server/ytcheck.py と同一パス導出。remote 側だけのロックでは 05:00 巡回との lost update を防げない = remote/docs/STATUS.md R3)。blocking 取得・timeout リトライなし。本体は `_update_viewing_history_locked()` に切り出し、既存ロジック無改変。pytest 229 件全パス (tests は mock.patch の tmp_path 上で回帰なし)。remote 側の実装・検証詳細は remote/docs/STATUS.md 2026-07-07 F-ytcheck エントリ参照
- 2026-07-07: 移行完了 — zip 展開 (Windows 製 zip のバックスラッシュ区切りを Python zipfile で正規化)、(C) git 化 + gitleaks hook (検出 2 件は gitignore 済み .env 内キーで想定通り)、パス環境変数化、venv + pytest 229 パス、timer 登録 (次回 07-08 05:04 JST)
- 2026-07-07: 初回実行 (並列 5、34/71 失敗) → 並列 2 に機差調整 → 再実行で 33 件キャッシュスキップ + 失敗 7 件まで改善。レポート `ytcheck-20260707-1.md` / `-2.md` と `viewing-2026-07.md` が vault に出力されたのを確認。code-reviewer レビュー済み (修正必須なし、mkdir 追加 + feedback_report の env 前置注記を反映)

## TODO

- [ ] 明朝 05:00 の定常実行のサマリー確認 (AI失敗数。残るようなら上記「残課題」の設計レベル対処へ) — 共用 TODO **#66**
- [ ] Windows 側原本の削除 GO 判断 — 共用 TODO **#67**。条件: 定常 2〜3 日安定 + companion 込み新設定での USB バックアップ成功 1 回 (usb-backup.sh への companion 追加は maintenance repo `255e872` で対応済み・push は OWNER 待ち)
- [ ] google api_core が 2026-10-04 以降 Python 3.11+ 要求 (FutureWarning)。Mint の python3 は 3.10 — 警告が実害化したら requirements 側を固定するか python3.11 venv を検討
- [ ] 視聴フィードバック 3 ヶ月分 (2026-08 頃) で月次集計を回す。viewing は vault にあるため env 前置が必須: `YTCHECK_VIEWING_DIR=~/companion/vault/notes/ytcheck .venv/bin/python python/youtube_checker/tools/feedback_report.py`

---
**最終更新**: 2026-07-07
