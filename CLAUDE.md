# CLAUDE.md (companion 共通)

このファイルは `~/companion/` 配下の全 CWD (workspace / bot-workspace / vault / 各サブプロジェクト) から claude CLI の auto-discovery で拾われる。**共通項のみ** を書く。CWD 固有の制約は各 subordinate `CLAUDE.md` (例: `workspace/CLAUDE.md`, `bot-workspace/CLAUDE.md`) に書く。

## Language / 応答言語

ユーザーとのすべてのやり取り (テキスト出力、要約、質問、確認メッセージ) は **日本語** で行う。コード内の識別子・コメント・コミットメッセージの言語は既存ファイルの慣習に従う (既存がない場合は英語をデフォルト)。

## companion プロジェクト全体地図

詳細は `~/companion/workspace/PROJECT.md` を参照 (Phase 1〜4 の構成、各フェーズの台帳パス、「続きお願い」運用ルール)。新しいタスクに着手する前に必ず一読する。

## 口調基準

- 共通: 応答冒頭にモデル宣言や共感の前置きを置かない。事実と次のアクションを直接述べる
- 手元 claude code セッション (CWD = `~/companion/workspace/`): 通常のレビュー / 設計議論トーン。長文 / 構造化見出しを使う場面あり
- Telegram 経由 bot セッション (CWD = `~/companion/bot-workspace/`): Telegram 表示の都合上、口調はフランクで短く、装飾 emoji は最小。キャラクター性は Phase 4 で後のせ (`~/companion/workspace/PROJECT.md` 設計方針参照)

## vault 書き込み境界

`~/companion/vault/notes/` のみ書き込み許可。手書きノートエリア (`aidiary/`, `clips/`, `inbox/`, vault ルート, `templates/`, `.obsidian/`, `CLAUDE.md`) には触らない。整理・タグ運用はメイン機側で行う。詳細は `~/companion/vault/CLAUDE.md` と `~/companion/web/docs/STATUS.md` を参照。

**例外 (OWNER 明示依頼 2026-06-08)**: companion-bot の `/tweet` コマンド (Python 直書き、claude セッションの Edit/Write ではない) は **`clips/` にツイートノート + `attachments/` に DL 画像** を書く。これは OWNER がツイート保存先として明示指定した正規の例外であり、境界違反として「修正」しない。claude セッション側の書き込み境界 (`bot-workspace/.claude/settings.json` の Edit/Write は notes/** のみ) は従来どおり notes/ 限定で維持 (この例外は `/tweet` の subprocess 書き込みにのみ適用)。

## OWNER 認可 (Telegram 経由)

Telegram bot 経由の発話は OWNER_ID 一致のもののみ受理、それ以外は完全無視 (沈黙)。bot 設計の詳細は `~/companion/bot/docs/STATUS.md` を参照。

## git 運用方針

- `~/companion/` は **モノレポ** (2026-07-11 切替。根拠・手順・rollback は `~/companion/workspace/redesign/monorepo-migration.md`)。remote は `github.com/mooneclipse/companion` (private)。旧 3 階層 (A)(B)(C) 区分は廃止
- **境界外は 3 つだけ**: `vault/` (独立 repo + 専用 remote obsidian-vault + bot auto-sync)、`photos/` (独立ローカル repo)、`logs/` (repo なし)。root `.gitignore` で明文化済み
- **push**: claude は実行しない。commit 完了時に `cd ~/companion && git push origin main` を 1 行表示し OWNER が叩く。頻度は OWNER の任意 (溜まっても push 1 発で全域バックアップされるのがモノレポの利点)
- **commit はパス明示**: `git add <対象パス>` のみ。`git add -A` / `git add .` は他プロジェクトの dirty を巻き込むため禁止 (自動系: ytcheck はパス限定実装済みで適合)
- **同時 commit の index.lock 衝突**: bot session / ytcheck timer / 手元セッションが同一 index を共有するため理論上あり得る。衝突したら片方が fail するだけなのでリトライで対処。頻発するようなら bot-workspace / ytcheck をモノレポから外すことを OWNER に相談する (2026-07-10 の約束)
- **新規プロジェクト**: `~/companion/<name>/` を掘るだけ。git init も hook コピーも不要
- secret 検出は `~/bin/gitleaks` (モノレポの pre-commit hook 1 本で全域カバー。`.git/hooks/` は git 管理外なので再配置時は要コピー)
- `git push --force*` / `reset --hard` / `rebase -i` などの破壊的 git 操作は deny
- commit に Co-Authored-By trailer は付けない (companion 配下 repo は識別目的が薄い)
- commit メッセージスタイルは既存 log に揃える (サブプロジェクトごとの `feat(games):` 等 scope prefix 慣習は継続)

## 設計判断・対症療法の上限

同じ場所・同じ原因への修正が 2 度目になったら、3 度目を打たずに一段引いて設計を見直す（global `~/.claude/CLAUDE.md` のエラーループ防止と同根、ここはその具体定義）。

**2 周目の判定** — 同一バグ / 機能 / 境界への 2 度目の差分が次のいずれかなら 2 周目:
- try/except・`if rc != 0`・フォールバック分岐の **条件を増やす**
- stderr 文言マッチ / エラー分類 enum の case を **増やす**
- リトライ回数・閾値・バッファサイズ等の **数値だけ動かす**
- 「直前の修正の補強」「漏れたケースのカバー」と書きたくなる

**2 周目で取る行動** — その場で打たず、想定漏れを設計レベル（責務分担 / 状態の置き場所 / 抽象境界）まで遡る。「設計を引き直す」か「2 周目を許容して合理化する」かを該当 `docs/STATUS.md` に根拠付きで記録してから着手。subagent / lint による自動修正で 2 周目を打つのも禁止。

**派生原則** — 条件分岐は state を持つ側（永続化 JSON / DB）を 1 回引いて決める。stderr 文言マッチで挙動分岐や fallback リトライを自動化しない。エラー分類 enum は表面化（通知 / ログ / state 確定）専用で、enum 値で if/elif 分岐して自動回復を組まない。1 つの外部呼び出しの成否判定は 1 回で確定し、回復は state 引き or ユーザー介入のいずれか。

### 適用範囲

`~/companion/` 配下の全サブプロジェクト。上記に該当する設計議論があるたびに本セクションを引き、判断根拠を該当 `docs/STATUS.md` に書き残す。各サブプロジェクトの `CLAUDE.md` からは「対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` を参照」とだけ書く。

### claude CLI バージョン up 時の再検証

claude CLI バージョン up 時、`bot/docs/STATUS.md` の運用ルールに従い以下を再走:

- `--session-id` / `--resume` / 存在しない uuid の rc + stderr 文言
- encoded-cwd 規則 (`/` → `-`)
- `claude -p --help` で `--bare` デフォルト動作変更の確認 (Max プランで `--bare` 不可、デフォルト化されたら無音破綻)

検証結果を STATUS.md に「claude CLI version + 検証日 + 結果」として追記してから本番投入。

## subordinate CLAUDE.md

CWD 固有の制約は以下に書く (claude CLI auto-discovery が CWD 近いほど後勝ち):

- `~/companion/workspace/CLAUDE.md`: 手元 claude code 固有 (Repository State / PROJECT.md 参照 / settings.json 解説 / Task Workflow / Agent Teams 概要)。team の詳細運用は `~/companion/workspace/redesign/agent-teams-playbook.md` に退避 (team 起動時のみ参照)
- `~/companion/bot-workspace/CLAUDE.md`: Telegram 経由セッション固有 (Phase 2.5 で新設、bot 経路の口調 / 書き込み境界 / session 動作)
- `~/companion/games/CLAUDE.md`: companion-games 固有 (配信境界 / 純静的 PWA / 実機検証 / 配信導線)
- `~/companion/vault/CLAUDE.md`: Obsidian vault 固有 (タグ運用 / frontmatter / wikilink / 機械書き込み境界)

---

**最終更新**: 2026-07-21 (claude CLI 再検証チェックリストから `claude -p "/usage"` 項目を削除 — 前提だった bot の /quota コマンドを撤去したため。前回 2026-07-11: git 運用方針をモノレポ前提に全面改稿 — 3 階層 (A)(B)(C) 廃止、境界外 3 つ (vault/photos/logs)、push は OWNER 1 コマンド。チケット #82、手順書 `workspace/redesign/monorepo-migration.md` Phase 4。前回 2026-07-08: (C) 列挙追記)
**根拠**: `~/companion/workspace/redesign/design.md` §1.2 (v0.2.3, 2026-05-14)
**設計判断・対症療法の上限**: devil teammate (companion-redesign team) からの叩き台 30 行を採用
