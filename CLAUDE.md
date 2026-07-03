# CLAUDE.md (workspace, 手元 claude code 固有)

このファイルは手元 claude code (Linux Mint 機の端末から起動する claude CLI、CWD = `~/companion/workspace/`) の auto-discovery で読まれる。**手元セッション固有** の制約のみを書く。応答言語 / vault 書き込み境界 / OWNER 認可 / git 運用方針 / 設計判断・対症療法の上限 など共通項は上位 `~/companion/CLAUDE.md` を参照。

Telegram 経由セッション (bot 経由、CWD = `~/companion/bot-workspace/`) は `~/companion/bot-workspace/CLAUDE.md` 側のルールで動く。本ファイルは bot 経路の制約には関与しない。

## Repository State

このリポジトリにはコードはなく、設計台帳（`PROJECT.md` / `redesign/` / `review-*/`）と claude 設定（`.claude/settings.json`、skills: `orc` / `newgame`、agents: code-reviewer / implementer / game-designer / game-critic / playtester）を置いている。ビルド・lint・テストコマンド、アーキテクチャに関する記述は、コードが追加され次第このファイルに追記すること。

## Project Roadmap

`PROJECT.md` がこのワークスペース全体の地図（Phase 1〜4 の構成、各フェーズの台帳パス、「続きお願い」運用ルール）。新しいタスクに着手する前に必ず一読する。フェーズの現在地・着手時のディレクトリ作成手順・1 セッション 1 タスクのリズムはここに記載。

## Workspace 直下の git 方針

workspace 直下は **(C) ローカル git のみ（remote なし、rollback 専用）** で管理する。当初は「git 化しない」方針だったが、想定していた `workspace/<project-name>/` 配下のサブプロジェクトは実際には `~/companion/` 直下に兄弟配置され、`workspace/` には複数セッション/agent team で大幅改稿される設計台帳（`PROJECT.md` / `redesign/` / `review-*/`）しか残らなかった。他プロジェクトの履歴が混ざる懸念がなくなり、rollback の価値が大きいためローカル git を導入した。**GitHub remote は意図的に付けない**（マシン外バックアップ不要、上げ忘れではない）。git 化 3 階層の詳細は `~/companion/CLAUDE.md` git 運用方針 / `PROJECT.md`「git 化の 3 階層」、破壊的 git 操作の deny / commit ルール / Co-Authored-By trailer の扱い等も上位 `~/companion/CLAUDE.md` を参照。

新しいコードやツールを導入する際は、その時点で:
- 主要なコマンド（実行・テスト・lint・ビルド）
- ディレクトリ構成と責務分担
- 複数ファイルにまたがる設計上の前提

を本ファイルに追記する。

## Security Settings

`.claude/settings.json` に拒否・確認・許可ルールを定義済み:
- **deny**: `rm -rf` 系、認証情報の読み取り（`~/.ssh/**` / `~/.aws/**` / `.env` 等）、`curl | sh` 系、`git push --force*` / `reset --hard` / `rebase -i` などの破壊的 git 操作
- **ask**: `git push:*`、`npm publish:*`、`rm -rf:*` — ユーザー側で 1 回承認が要る
- **allow**: 通常の `git add` / `commit` / `status` / `diff` / `log` / `show` / `branch` / `restore --staged` / `remote` / `config` / `fetch` / `init` — 確認なしで実行可

追加の許可・拒否が必要になった場合は `settings.json` を直接編集する。

## vault / logs 読み取りガード (PreToolUse hook)

手元セッション (CWD = workspace) が persona/会話プローズを **中身** ごとコンテキストに読み込むと指示・口調が歪むため、`.claude/hooks/guard-companion-read.sh` を PreToolUse hook (matcher: `Bash|Read|Grep|Glob`) で噛ませている。

- **読み取り** (Read / Grep / Glob、Bash の `cat`/`grep`/`head`/`tail` 等の出力系コマンド) のゲート対象は **`vault` 全体 + `logs` の機械出力 allowlist 以外すべて**。該当すると `ask` (承認待ち) に落ちる。→ 勝手読みは止まり、**検索を指示したときだけ承認して読む**。
- **logs は fail-safe allowlist 方式** (2026-06-22 変更)。`logs` の機械出力 (playtester `mr_*` / probe `lid_*` / `*.png` / `*-verify-server.log` / `vault-sync.log` / `maintenance` の `machine-audit-*`・`notify-system-report.log`・`notify-unattended-upgrades.log`・`trends-weekly.log`・`usb-backup-*`) は **素通り** (auto mode の承認摩擦を除去)。persona プローズを含むログ (`bot.log` 会話 / `maintenance/proactive-companion.log` 先回り発話 / `notify-claude-status.log`) と **将来の未知ログは既定でゲート** = 漏れの方向に倒れない。allowlist を増やすより未知は既定ゲートが原則 (fail-open にしない)。
- **書き込み** (Write、Bash の `cp`/リダイレクト/`node`/`bash script.sh` 等) は素通り。playtester・probe の logs 出力を壊さない。
- **判断目的で vault/logs を読むときは foreground サブエージェント経由**で読み、結論だけ受け取る (中身をこのセッションのコンテキストに入れない)。**非同期 (background) サブは `ask` が auto-deny される**ため、読ませるなら同期起動。
- `additionalDirectories` から vault/logs は外した (メインの作業ディレクトリ扱いを解除)。書き込みは `permissions.allow` の `Write(...)` ルールで維持。bot 経由セッション (`bot-workspace`) は別 settings なので無関係。
- **不採用案の記録**: sandbox は network 全 deny / write が CWD+tmp のみ / docker・Chromium・systemctl 非互換と副作用が甚大なため見送り。permission の Bash パス deny は引数順序・オプション挿入・パイプ迂回で抜ける (公式が "fragile" と明記) ため不採用。hook でパスを正規化判定する方式を採った (公式が deny の代替として推奨)。残る穴は (1) 意図的な難読化、(2) 1 つの Bash 読みコマンドが機械出力ログと persona ログを同時参照した場合のみ allowlist 側にマッチして素通り — いずれも自セッションでの意図的構成のみで実用上ゼロ。

## Task Workflow

新しいタスクを進めるときの定型リズム（自動的にこの流れで動く）:

1. **着手** — 該当サブプロジェクトの `docs/STATUS.md` の TODO / In progress を確認、対象を In progress へ
2. **実装** — 必要な編集・テスト
3. **レビュー** — `code-reviewer` subagent を呼び差分を点検（`.claude/agents/code-reviewer.md`）。修正必須が出れば反映 → 再レビュー
4. **コミット** — 適切な粒度（1 論理単位 = 1 commit）で `git add` → `git commit`。`permissions.allow` で確認なく通る
5. **プッシュ** — claude 側で `git push` を実行しない。**(B) GitHub remote 付き repo のみ** `cd <repo> && git push origin <branch>` を 1 行表示し、ユーザーが自分のターミナルで叩く（誤りの最終ゲート）。**(C) ローカル git のみ repo（workspace / web / remote / bot-workspace / games 等）は commit で完結**、push 行も出さない。判別は `git remote -v`（空 = (C)）。auto mode classifier は push を構造的に block するため claude 側で試みること自体が無駄ターン（2026-06-16 協働判断で確定）
6. **STATUS.md / PROJECT.md 更新** — Done エントリ追加、最終更新日時更新

### コミット粒度の指針

- 1 commit = 1 論理単位（機能追加 / バグ修正 / リファクタ / ドキュメント更新は別コミット）
- 関連するファイル群は同じ commit にまとめる（実装 + そのテスト等）
- 無関係な変更を 1 commit に混ぜない
- レビューと commit の間で過度に細切れにしない（一塊のタスクは 1 コミットでよい）

### 自動化の境界

- 完全自動 push はしない。Anthropic 公式も推奨していない（意図しない操作リスク）
- レビューを飛ばしてのコミット禁止。subagent レビューが OK を出してから commit
- ユーザーが「レビューなしでいい」と明示した場合のみ skip 可

## Agent Teams

agent team 機能は有効（`.claude/settings.json` の `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）。

**使い分け**: teammate 同士の議論・反証が本質的に要る場面（仕様検討・設計の耐久性レビュー・根本原因が並列に立つデバッグ・新フェーズの発散探索）だけ team を使う。並列に報告を集めるだけなら subagent（`code-reviewer` / Explore 等）で済ます — トークン消費が桁で違う。

team を実際に起こすと決めたら、通信トポロジー・spawn テンプレ・運用上の落とし穴（teammate 沈黙対処 / 判断前の最新 plan 再読 / devil 起用 / approve 前整合チェック / permission 事前 allow / 成果物転記）は **`redesign/agent-teams-playbook.md` を開いて従う**。常時読み込みからは外してある。
