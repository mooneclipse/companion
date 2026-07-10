# youtube_checker

YouTube 巡回・字幕解析・AI 推薦システム。
チャンネルリスト（`tasks/youtube-channels.json`）の各チャンネルを巡回し、
新着動画の字幕を `claude -p` で評価して Markdown レポート（`writing/ytcheck-YYYYMMDD-N.md`）を出力する。

## 日次実行の仕組み（Phase 1 で追加）

### 評価済みキャッシュ

- 評価が確定した動画は `data/evaluated_cache.json` に記録され、翌日以降の実行では**字幕取得ごとスキップ**される（同じ動画を2日連続で評価しない）
- キャッシュ対象: 字幕ありで評価が完了した動画（AI評価失敗・処理エラーを除く）と、評価対象外（歌・踊り・カバー等）の確定判定
- 字幕なし（no_subtitles）はキャッシュ**しない**。自動字幕の生成遅延で翌日には取得できる可能性があるため、毎回再挑戦する
- 90日より古いエントリは起動時に自動削除される（肥大化対策）
- キャッシュヒットした動画は当日のレポートに再掲されない（前日以前のレポートに掲載済みのため）

### pending 自動リトライ

- `claude -p` の評価がレートリミット等で失敗すると `pending_evaluations/pending_*.json` に未評価データが保存される
- `--all` 実行の冒頭で pending ファイルを走査して自動的に再評価する
  - 成功: pending ファイルを削除し、結果を当日レポートに掲載 + キャッシュに登録
  - 失敗: ファイルを残して次回実行に持ち越す

### 実行サマリー

レポート末尾の「## 実行サマリー」セクションとコンソールログに、
処理本数 / キャッシュスキップ数 / 評価対象外数 / 失敗数（字幕・AI別）/ pending 再評価結果 / 所要時間 が出力される。
「今日は失敗が多い」等の異常に日次で気づくための仕組み。

## 手動実行

リポジトリ直下の `ytcheck.bat` をダブルクリック（または専用ターミナルから実行）。

```
ytcheck.bat
  → cd python\youtube_checker
  → python main.py --all --output markdown
```

注意:

- **Claude Code セッション内から起動しない**こと（長時間タスクはセッション内で強制終了される）
- グローバル Python を使用する（venv 運用なし、現行運用に合わせている）

## Windows タスクスケジューラ登録手順

毎朝定時に `ytcheck.bat` を自動実行するための手順。**登録作業は手動で行う**（実行時刻は運用者が決める）。

### 事前準備: 無人実行用ラッパーの作成（推奨）

`ytcheck.bat` は末尾に `pause` があるため、無人実行するとコンソールウィンドウが閉じずに残り続ける。
対処案は次のいずれか:

1. **（推奨）無人実行用ラッパー bat を作る**: リポジトリ直下に `ytcheck-scheduled.bat` を作成し、
   標準入力を NUL にリダイレクトして `pause` を即時通過させる

   ```bat
   @echo off
   rem Scheduled launcher for ytcheck.bat (skips the trailing pause)
   call "%~dp0ytcheck.bat" < NUL
   ```

2. スケジューラのタスクを「ユーザーがログオンしているかどうかにかかわらず実行する」に設定する
   （ウィンドウ自体が表示されなくなるため pause で止まっても実害はないが、プロセスは残る）

### 方法A: schtasks コマンドで登録

管理者でないコマンドプロンプト / PowerShell から実行できる（時刻 `07:00` は例。運用者が決定する）:

```bat
schtasks /Create /TN "ytcheck-daily" ^
  /TR "\"C:\Users\fish_\ドキュメント\claudecode\ytcheck-scheduled.bat\"" ^
  /SC DAILY /ST 07:00
```

- 確認: `schtasks /Query /TN "ytcheck-daily"`
- 手動テスト実行: `schtasks /Run /TN "ytcheck-daily"`
- 削除: `schtasks /Delete /TN "ytcheck-daily" /F`

補足: PC がスリープ中は実行されない。スリープ解除して実行したい場合は方法B（GUI）で
「タスクの実行時にスリープを解除する」を有効にする（schtasks コマンドでは指定できない）。

### 方法B: GUI（タスクスケジューラ）で登録

1. `Win + R` → `taskschd.msc` で「タスクスケジューラ」を開く
2. 右ペインの「基本タスクの作成...」をクリック
3. 名前: `ytcheck-daily`（任意）→ 次へ
4. トリガー: 「毎日」→ 開始時刻を入力（運用者が決定）→ 次へ
5. 操作: 「プログラムの開始」→ プログラム/スクリプトに
   `C:\Users\fish_\ドキュメント\claudecode\ytcheck-scheduled.bat` を指定 → 次へ → 完了
6. 作成したタスクのプロパティを開き、必要に応じて以下を調整:
   - 「条件」タブ: 「タスクの実行時にスリープを解除する」に必要ならチェック
   - 「設定」タブ: 「スケジュールされた時刻にタスクを開始できなかった場合、すぐにタスクを実行する」にチェック（起動遅れの取りこぼし対策）

### 二重起動時の挙動（現行仕様）

同日に複数回実行した場合、**スキップはされず**レポートが連番で出力される
（`writing/ytcheck-YYYYMMDD-1.md`, `-2.md`, ...）。
2回目以降は評価済みキャッシュが効くため、新規評価は初回実行以降の新着分のみになる。

## 開発

- テスト: `python -m pytest`（`python/youtube_checker/` で実行）
- 規約: 型ヒント必須（mypy `disallow_untyped_defs=true`）、ruff（line-length 88）
- 詳細な手動実行ガイド: `docs/manual_execution_guide.md`
