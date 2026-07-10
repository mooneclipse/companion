# ytcheck 移行ノート（Windows → 常時起動 Linux 機）

作成: 2026-07-06 / 移行元: Windows 11（`C:\Users\fish_\ドキュメント\claudecode\`）
移行先での作業（パス調整・Obsidian 連携・定時実行）は移行先の Claude Code で実施する前提。
このノートは「向こうが迷わないための引き継ぎ」。

---

## 1. これは何か

**ytcheck** = YouTube 巡回・字幕解析・AI 推薦システム。

- チャンネルリスト（`tasks/youtube-channels.json`、**現在 56ch**）の各チャンネルを毎日巡回
- 直近 `check_days` 日（デフォルト **2 日**、取りこぼしマージン込み）の新着動画を取得
- 各動画の字幕を取得し、`claude -p`（Claude Code CLI）で「見る価値があるか」を評価
- 優先度別の Markdown レポート（`writing/ytcheck-YYYYMMDD-N.md`）を出力

毎日 1 回実行し、常時起動の Linux 機へ移すためのパッケージがこの zip。

### 主要ファイル（`python/youtube_checker/`）

| ファイル | 役割 |
|---|---|
| `main.py` | エントリポイント。巡回・pending 再評価・全体オーケストレーション |
| `config.py` | 設定（pydantic-settings）。`.env` と JSON の設定値を統合 |
| `models.py` | データモデル（pydantic） |
| `youtube_client.py` | YouTube Data API 呼び出し |
| `subtitle_fetcher.py` | yt-dlp で字幕取得 |
| `ai_evaluator.py` | `claude -p` を叩いて評価 |
| `title_normalizer.py` | タイトル正規化（シリーズ判定等） |
| `evaluation_cache.py` | 評価済みキャッシュ（`data/evaluated_cache.json` に記録、翌日以降スキップ） |
| `output_formatter.py` | Markdown レポート生成・viewing 履歴の更新 |
| `tools/feedback_report.py` | 視聴フィードバックの月次集計 |
| `tools/merge_takeout.py` | （補助）YouTube Takeout マージ用 |

---

## 2. 実行方法

```bash
python main.py --all --output markdown
```

- パスはすべて `__file__` 基準（後述の `_PROJECT_ROOT`）なので **cwd 非依存**。`cd` せずどこから叩いても動く。
- `--all` は「全チャンネル巡回 + pending 自動再評価」。

---

## 3. 依存インストール

**venv 推奨**（移行元は venv なしのグローバル運用だったが、Linux では venv を切ることを推奨）:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r python/youtube_checker/requirements.txt
```

主な依存: `yt-dlp` / `google-api-python-client` / `pydantic-settings` ほか（`requirements.txt` 参照）。

さらに **`claude` CLI（Claude Code）が PATH に必要**。`ai_evaluator.py` が `claude -p` をサブプロセスで呼ぶ。

---

## 4. 認証

- **Claude Code**: `claude -p "テスト"` が応答すれば OK。ログイン/API キー設定は移行先で済ませておく。
- **YouTube Data API キー**: 同梱の `python/youtube_checker/.env` の `YOUTUBE_API_KEY`（実キー入りでそのまま同梱済み）。
  - `.env` の鍵: `YOUTUBE_API_KEY` / `CLAUDE_API_KEY` / `GEMINI_API_KEY` / `CHECK_DAYS` / `MAX_CONCURRENT_TASKS`

---

## 5. ★要改修: 外部参照 3 点のハードコード（Obsidian 連携・配置最適化のため環境変数化を推奨）

コードは `youtube_checker/` の**外**（リポジトリルート）を 3 箇所参照している。
各ファイル冒頭で以下のようにルートを算出している:

```python
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
```

`__file__`（例: `.../python/youtube_checker/main.py`）から **3 階層上**をリポジトリルートとみなす。
つまり zip 内の相対構造（`python/youtube_checker/` の 2 つ上に `tasks/` と `writing/` がある）を前提にしている。

| 用途 | 場所 | 参照先（ルート基準） |
|---|---|---|
| 入力: チャンネルリスト | `main.py:34-35`（`_PROJECT_ROOT` → `_DEFAULT_CHANNEL_LIST`） | `tasks/youtube-channels.json` |
| **出力: レポート** ★Obsidian | `output_formatter.py:17-18`（`_PROJECT_ROOT` → `_WRITING_DIR`） | `writing/`（`ytcheck-YYYYMMDD-N.md`） |
| 入出力: viewing 履歴 | `output_formatter.py:17,19`（`_TASKS_DIR`）と `:809`（`viewing-{month}.md` の読み書き） | `tasks/viewing-YYYY-MM.md` |

補足の実参照行:
- `output_formatter.py:242` `_WRITING_DIR.glob(...)`（同日連番採番）
- `output_formatter.py:789/791` `_WRITING_DIR.mkdir` / レポート書き出し
- `output_formatter.py:805-809` viewing 履歴ファイルの解決

### 推奨改修

1. **レポート出力先（`_WRITING_DIR`）を Obsidian vault に向ける** ← 最優先。
   `output_formatter.py:18` を環境変数（例 `YTCHECK_WRITING_DIR`）で上書き可能にし、
   `.env` に vault 内のノートフォルダの絶対パスを設定する。
2. `main.py:35` のチャンネルリストと `output_formatter.py:19` の viewing 履歴ディレクトリも
   同様に環境変数化しておくと、配置の自由度が上がる。
3. **単体配置する場合の注意**: `youtube_checker/` だけを別の場所に置くと
   `parent.parent.parent` の 3 階層仮定が崩れ、`tasks/` と `writing/` を見失う。
   環境変数化するか、この zip の相対構造（`<root>/python/youtube_checker/` + `<root>/tasks/`）を維持すること。

---

## 6. Windows 依存で捨て/無視してよい部分

- **`ytcheck.bat`**: この zip には**同梱していない**（Windows 専用ランチャー）。
  移行先は cron 不使用とのことなので、**systemd timer 等 移行先流の定時実行**で `python main.py --all --output markdown` を叩く。
- **UTF-8 stdout 再設定ラッパー**: `main.py` 等の冒頭にある stdout/stderr の UTF-8 再設定は
  Windows の cp932 対策。Linux では**無害だが不要**。触らなくてよい（そのまま動く）。

---

## 7. 運用注意

1. **初回はキャッシュ空で全評価** — `data/evaluated_cache.json` が無い状態なので全動画を評価する。時間・API 消費が大きい。**2 日目から `evaluation_cache` が効いて高速化**（既評価はスキップ）。
2. **同梱の `pending_evaluations/` 41 件** — 過去（2026-03〜05）にレートリミット等で失敗した未評価データ。初回 `--all` の冒頭で**一括再評価**が走る（1 回きりの追い付きコスト、最大 41 回の追加 `claude` 呼び出し）。不要なら**実行前に `pending_evaluations/` の中身を削除**する。
3. **favorite 1-2 チャンネルは軽量モデル** — `config.py` の `LOW_FAVORITE_MODEL`（デフォルト `claude-haiku-4-5`）で評価される。ログに `model=claude-haiku-4-5` が出れば効いている。
4. **`check_days` デフォルト 2** — `config.py`（`.env` の `CHECK_DAYS` または JSON 側の個別 `check_days` で上書き可）。日次実行の取りこぼしマージン込み。
5. **レポート末尾に実行サマリー** — 処理本数 / キャッシュスキップ数 / 評価対象外数 / 失敗数（字幕・AI 別）/ pending 再評価結果 / 所要時間。日次で異常に気づくための指標。
6. **視聴フィードバック** — `tasks/viewing-YYYY-MM.md` の各行を見たら `[x]`、行末に ○（当たり）/ ×（外れ）を記入 →
   `python tools/feedback_report.py`（`--month YYYY-MM` 指定可）で月次集計。3 ヶ月分貯まると推し度補正の提案が意味を持つ。
   - 同梱済み履歴: `tasks/viewing-2026-02.md` 〜 `viewing-2026-05.md`

---

## 8. 移植後の健全性確認

```bash
cd python/youtube_checker
python -m pytest
```

**229 件が全パスすれば移植成功**。
（移行元の最新確認では pytest グリーン。テスト自体はネットワーク・API 非依存でモック化されている想定。）

---

## 同梱物一覧

```
ytcheck-migration/
  MIGRATION-NOTES.md              ← このファイル
  python/youtube_checker/         ← ソース一式（*.py / tests/ / tools/ / docs/）
    .env                          ← 実キー入り（YOUTUBE_API_KEY 等）
    .env.example
    requirements.txt / pyproject.toml / README.md
    pending_evaluations/          ← 未評価データ 41 件
  tasks/
    youtube-channels.json         ← 56ch
    viewing-2026-02.md 〜 viewing-2026-05.md
```

除外物: `__pycache__` / `.pytest_cache` / `.ruff_cache` / `.mypy_cache` / `*.pyc` / `data/`（キャッシュ）/ `ytcheck.bat` / `.git`。
