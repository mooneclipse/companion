# companion-bot 開発台帳

最終更新: 2026-05-14 (T-C 完了)

## 設計メモ

- Discord ↔ `claude -p` 土管 bot
- DM またはサーバー内ユーザーメンションをトリガに `claude -p` を呼び、出力をチャンネル/DM へ返す
- OWNER_ID 以外の発言は完全に無視
- 主要パス:
  - `bot.py` … 本体（1ファイル構成、`CompanionClient` で Unix socket listener を兼務）
  - `companion-bot.service` … systemd user unit（`~/.config/systemd/user/` から symlink で配置 + `enable --now` 済み）
  - `.env` … トークン・OWNER_ID・CLAUDE_BIN・CLAUDE_CWD・CLAUDE_TIMEOUT（chmod 600）
  - `requirements.txt` … `discord.py>=2.3,<2.4`, `python-dotenv>=1.0,<2.0`
  - `venv/` … Python 3.10 で再構築済み
- 通知投入口: `$XDG_RUNTIME_DIR/companion-bot.sock`（permission 0600）。1 接続 1 メッセージ（UTF-8、EOF で確定）、本文は `.env` の `NOTIFY_CHANNEL_ID` で指定した Discord テキストチャンネルへ転送。例: `printf '%s' "..." | nc -U $XDG_RUNTIME_DIR/companion-bot.sock`
- 実行 CWD: `claude -p` は `~/companion/workspace` を CWD として起動
- ログ: `~/companion/logs/bot.log` (RotatingFileHandler, 5MB×3)
- `claude` CLI のパスは `.env` の `CLAUDE_BIN` と service ユニットの `Environment=PATH=...` の両方に nvm バージョン依存パスを書いている。Node 更新時は両方追従要
- git: ローカル `~/companion/bot/.git`、リモート `git@github.com:mooneclipse/companion-bot.git`（プライベート）
- pre-commit hook: `.git/hooks/pre-commit` で `~/bin/gitleaks git --pre-commit --staged --redact` を実行。秘密情報を含む commit は exit 1 で拒否される

## TODO

Phase 2.5「土管の耐久化（再設計）」T-C 完了、T-D から着手可能 (依存順序 T-D → T-E、各サブタスク = 1 commit)。

設計根拠:
- `~/companion/workspace/redesign/design.md` (v0.2.3, 2026-05-14)
- `~/companion/workspace/redesign/questions.md` (UQ-1〜UQ-10 全項目回答済)

### T-D: BudgetGuard / /quota コマンド (2 段階実装)

- T-D 前半 (Phase 2.5 着手時に実施):
  - `bot/quota.py` 新設: `BudgetGuard` ABC + `RequestsCountGuard` 実装 (ENV `BOT_REQUESTS_PER_HOUR=20` default、1h スライディング window)
  - `bot/sessions/ledger.jsonl` に各 prompt の `total_cost_usd` / `usage.*` / `modelUsage` を append
  - `/quota` `/reset` `/status` の 3 コマンドを実装 (UQ-4.4 案 k、design.md §6.1)
  - 表示は R 案 z (6/15 想定の表示骨格で書き、6/15 までは月次予算行をプレースホルダで覆う)
  - キャッシュメトリクス (`cache_creation_input_tokens` / `cache_read_input_tokens`) も集計表示
- T-D 後半 (2026-06 上旬に実施):
  - `CreditBudgetGuard` 実装 (月次クレジット $100、月初リセット)
  - 切替: `bot/.env` の `BOT_BUDGET_GUARD=requests_count|credit_usd` (ENV master)
- 対応 §: design.md §4 全体 (§4.2 / §4.6 / §4.8)

### T-E: catch-up + CLAUDE.md 3 層分割

- `~/companion/CLAUDE.md` 新設 (共通項: 口調 / vault 書き込み境界 / OWNER 認可 / git 運用 / commit ルール / 対症療法の上限)
- `~/companion/workspace/CLAUDE.md` を手元 claude code 固有のみに圧縮
- `~/companion/bot-workspace/CLAUDE.md` を Discord 経由セッション固有のみに圧縮 (2026-05-13 準備版を最終形に)
- bot 起動時 catch-up: `companion-bot.service` の `ExecStartPost=systemd-run --on-active=15s` で unattended-upgrades / system-report を 1 回発火
- 対応 §: design.md §7.2 + §1.2

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-05-14 Phase 2.5 T-C: Stop フック + vault 同期 (`vault-sync-from-transcript.sh`) (design.md §5 全体、案 A 採用)
  - `~/companion/web/scripts/vault-sync-from-transcript.sh` 新設 (約 50 行 bash、実行権限付き): Discord bot 経由 claude セッション (bot-workspace CWD) の Stop フックとして呼ばれ、claude が `~/companion/vault/notes/` に書いた未 commit 変更を `git add -- notes/` + `git commit` で回収する最終同期処理。push は `permissions.ask` の人手承認フローに任せる
  - **設計選択 (案 A 採用、ユーザー確認 2026-05-14)**: design.md §5.2 の「JSONL を読んで Web 検索 + summary 型を検出、重複チェック後 notes/<...>.md 書き出し」は claude session 内で完結する責務として外出し (§6.3 のフローと整合)。Stop フックは「claude が書いたが commit し忘れた未 commit 変更を回収する」最終同期に絞ることで、jq 依存・JSONL 解析の脆さを回避。design.md §5.2 本文の JSONL 解析記述は実弾運用で漏れが頻発した時点で再判断 (案 B / 案 C への倒し直し候補)
  - stdin の Stop フック入力 JSON (`transcript_path` 等) は現状読み捨て (`cat >/dev/null`)、将来必要になった時点で jq 等で抽出
  - 重複起動防止: `${XDG_RUNTIME_DIR:-/tmp}/companion-vault-sync.lock` で `flock -n` 非ブロッキング取得、並走セッションの Stop フック衝突を排他 (design.md §5.4 vault git 並行制御の cross-process 実装版)
  - **`vault_lock = asyncio.Lock()` は実装せず**: 案 A 採用で bot プロセスから vault git を直接触らないため、bot 内 asyncio Lock は不要。Stop フックの flock cross-process ロックで十分。design.md §3.3 / §5.4 の `vault_lock` は将来 bot プロセスから vault git を触る経路が出てきたタイミングで追加 (YAGNI)
  - 書き込み境界の二重防御 (design.md §5.3): claude session 側は `bot-workspace/.claude/settings.json` の `Edit/Write(~/companion/vault/notes/**)` のみ allow、Stop フック側は `git add -- notes/` で pathspec を notes/ 限定。手書きエリア (`aidiary/` / `clips/` / `inbox/` / vault ルート / `templates/` / `.obsidian/` / `CLAUDE.md`) には commit が漏出しない
  - **`bot.py` 側の `--allowedTools` ハードコード渡しは T-A / T-B 時点で既に廃止済** (`grep -rn 'allowedTools' bot/*.py` で no match 確認、2026-05-14)。settings.json への一本化は完了済
  - commit メッセージスタイル: vault repo の既存 log (`add: notes <YYYY-MM-DD> (<件名>)`) に揃え、`add: notes <today> (bot session auto-sync, N file(s))` 形式。`git log --oneline` で bot 由来 commit を件名で grep 可能
  - ログ出力先: `~/companion/logs/vault-sync.log` (append 専用、RotatingFileHandler 非経由)。1 セッション 1-2 行想定で年間でも数 MB 程度、bot.log と同じ手動 truncate 運用 (運用ルール参照)
  - vault repo の pre-commit hook (gitleaks) は staged diff 経由で Stop フック commit にも自動適用、秘密混入は git 側で止まり `git commit` rc != 0 → `error: git commit failed` がログに残る経路を確認
  - `bot-workspace/.claude/settings.json` に hooks セクション追加: `Stop` イベントで `/home/miho/companion/web/scripts/vault-sync-from-transcript.sh` を呼ぶ。matcher は空文字 (全 Stop event 対象)。command は絶対パスで記述 (`~` 展開のクライアント依存回避)
  - 動作確認: 空 vault (変更なし) で `echo '{...}' | vault-sync-from-transcript.sh` → rc=0 / ログ空で noop 抜け確認。一時 git repo で notes/ 配下に 2 ファイル変更 (新規 1 + 既存編集 1) を作って実行 → rc=0、commit `add: notes 2026-05-14 (bot session auto-sync, 2 file(s))` が作られ working tree clean。flock の lock ファイル (`/run/user/1000/companion-vault-sync.lock`) は exit 時に解放される (0 byte で残るのみ)
  - **実弾確認 OK** (2026-05-14 17:00, ユーザー側からの「別テーマでノート化」依頼で発火、お題: Notion developer platform):
    - `bot.log` 17:00:34: `send len=265` (claude session 完了で Discord 返信)
    - `vault-sync.log` 17:00:33: `ok: committed 1 file(s) under notes/` (Stop フック発火 + gitleaks `no leaks found` + commit 作成のフルパス)
    - vault repo: `1ec363d add: notes 2026-05-14 (bot session auto-sync, 1 file(s))`、`notes/2026-05-14_notion-developer-platform.md` (2682 bytes) 新規追加
    - `develop` ブランチが `origin/develop` に対して 1 commit ahead で **push 未実施** (今回の確認では claude session 内で commit / push までは行われず、Stop フックが「漏れた未 commit を回収」する案 A の挙動が事実そのまま観測された形)
    - 押さえどころ: claude が notes/ に書き込みだけで commit / push まで進めなかったケースでも、Stop フックが commit までは確実に回収する。push は引き続きユーザーの 1 回承認フロー (案 A 設計通り)。実弾運用で claude が頻繁に push まで行く / 行かないのパターンが見えてきたら、Stop フック側で push までやるか UX 上の判断点として再検討候補
  - code-reviewer: 修正必須 1 件 (commit メッセージスタイルを既存 log に揃え) を反映済。軽微提案 4 件のうち git config 前提と log 手動 truncate 運用は本 STATUS.md に明記、残り 2 件 (stdin `|| true` 削除 / `XDG_RUNTIME_DIR` fallback 注記) は実害なく未反映
  - 初回環境セットアップ前提: vault repo の `user.email` / `user.name` が `~/companion/vault/.git/config` に設定済であること (Phase 2.5 着手時点で設定済 = `git log` に既存 commit があるため確認不要)。新規環境構築時は vault repo の git config を先に整える運用

- 2026-05-14 Phase 2.5 T-B: ClaudeRunner 抽象 (ClaudeOptions / ClaudeResult / ErrorKind) (design.md §3.1 / §3.2 / §3.3 / §1.7 / §4.8 / §1.6)
  - `bot/claude_runner.py` 新設 (≈220 行): `ClaudeRunner` クラス、`ClaudeOptions` / `ClaudeResult` dataclass、`ErrorKind` enum。`run_discord(prompt, options) -> ClaudeResult` を提供、`run_oneshot` は `NotImplementedError` 雛形のみ (Phase 4 着手時に実装)
  - `claude_lock = asyncio.Lock()` を `ClaudeRunner` の instance attribute として所有 (bot.py の module-level lock を撤去、design.md §3.3)。lock は spawn + `communicate()` をまたいで保持し、subprocess 二重起動と Max プラン枠の競合を防ぐ
  - `ClaudeOptions.to_cli_args()`: `-p --session-id <uuid>` または `--resume <uuid>`、`--output-format json --permission-mode default --model claude-sonnet-4-6` をデフォルトで組み立て。`session_id` / `resume_session` を同時指定すると `ValueError`。CLI フラグは claude 2.1.141 で `--help` grep して実在確認済
  - `ErrorKind` (OK / NO_PRIOR_SESSION / SESSION_ALREADY_IN_USE / TIMEOUT / RATE_LIMIT / OTHER): **エラー表面化専用**、リトライ判定に使わない方針を docstring に明記 (design.md §3.2 / §10.3)。RATE_LIMIT は reserved (stderr 文言未確認、実弾で観察したら追加分類)
  - `_classify_stderr`: claude 2.1.141 で実機検証済の文言 (`No conversation found with session ID` / `is already in use`) のみマッチ。S3 / S4 以外は OTHER。**用途は ClaudeResult.error_kind を埋めるためだけで、`run_claude` のリトライ判定には一切使われない** (堂々巡り原因 #4 を構造的に排除)
  - subprocess の env から `ANTHROPIC_API_KEY` / `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_SESSION_ID` を pop (design.md §1.6)。`_claude_env` は claude_runner.py に集約、bot.py からは撤去
  - `--output-format json` の stdout を `_parse_json_stdout` で dict 化、`ClaudeResult` の `result_text` / `session_id` / `cost_usd` / `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` / `model_usage` / `permission_denials` / `terminal_reason` / `duration_ms` に展開。パース失敗時は `None` フォールバック、例外伝播なし
  - `ClaudeOptions.prompt_prefix` / `prompt_suffix` フィールドを追加 (design.md §4.8 方針 2 のキャッシュフレンドリ prefix 足場)。T-B 段階では両方とも空文字列、`_compose_prompt` が `prefix + body + suffix` で組み立てる構造のみ準備
  - `bot/sessions.py`: T-A の `determine_args(channel_id) -> (list[str], SessionMeta)` を撤去し `start_or_resume(channel_id) -> (SessionMeta, is_new: bool)` に置換 (caller が `ClaudeOptions.session_id` か `resume_session` のどちらに入れるかを `is_new` で決める形)
  - `bot/bot.py`: module-level `claude_lock` / `_claude_env` / `_exec_claude` を撤去、`runner = ClaudeRunner(CLAUDE_BIN, CLAUDE_CWD)` を起動時に 1 個生成。`run_claude` は `start_or_resume` → `ClaudeOptions` 組立 → `runner.run_discord` → `ClaudeResult.error_kind` ベースで Discord 返却文字列を組む形に。`on_message` の `except asyncio.TimeoutError` を削除 (TIMEOUT は `ClaudeResult(error_kind=TIMEOUT)` に畳まれるため呼び出し側で例外扱いしない)、`async with claude_lock` も runner 内へ移動済なので除去
  - 動作確認: `bot/venv` で `to_cli_args` の組立 (`--session-id` / `--resume` / mutex `ValueError`) と `_classify_stderr` の S3 / S4 / OTHER 振り分け、`_parse_json_stdout` の S5 sample 受け入れ、`_claude_env` の strip、`ClaudeRunner.claude_lock` の async with 全 7 件を実行、全 pass
  - **実弾確認 OK** (2026-05-14 16:41, channel `1501135556703424552`): bot.log は `send len=417` のみ (error 行なし)、`sessions/channels/<channel-id>.json` の `prompt_count` が T-A 直後の 2 から 3 へインクリメント、jsonl は 19327 → 25364 bytes に追記、`session_id` は `4df72438-...` のまま継続 (`--resume` 経路で文脈保持 + `--output-format json` の result_text を Discord に返却していることを送信長から確認)
  - **Watch 項目** (code-reviewer 軽微提案、コード未反映): `--session-id <uuid>` で渡した uuid と JSON 由来の `session_id` が将来 CLI 仕様変更で乖離した場合の検知が現状ない。`claude_runner.run_discord` 末尾で `result.session_id != options.session_id (or resume_session)` を warning するのは将来 enhancement 候補 (現状 uuid4 + `--session-id` ハンドオフが 2.1.141 実機通り動いているので過剰防御寄り、CLI up 時の再検証で乖離が出た時点で追加)

- 2026-05-14 Phase 2.5 T-A: bot 専用 CWD 分離 + sessions JSON (design.md §1 全体、§8.1)
  - bot.py の `CLAUDE_CWD` デフォルトを `~/companion/workspace` → `~/companion/bot-workspace` に変更、`.env` / `.env.example` も同値に揃えた (T-0 以前は `.env` で `bot/sessions` を CWD にする暫定対応で手元 claude code の jsonl 混入を回避していたが、本対応で正規の bot-workspace に統一)
  - `bot/sessions.py` 新設 (≈130 行): `SessionMeta` dataclass + `load(channel_id)` / `save(meta)` / `reset(channel_id)` / `determine_args(channel_id)` / `record_usage(meta)`。永続化先は `bot/sessions/channels/<channel-id>.json` (1 channel = 1 file、gitignore 済)。書き込みは `tempfile.mkstemp` + `os.replace` の atomic write
  - `--continue` 完全廃止、`_is_no_prior_session` も削除。初回 `--session-id <uuid4>` / 継続 `--resume <uuid4>` の 2 ルートに一本化、stderr マッチ / rc != 0 自動 fallback / subprocess 2 度呼び はすべて消した (design.md §1.4 禁止反パターン準拠、CLAUDE.md「対症療法 2 周目」ルールにも整合)
  - `_claude_env()` を追加し `_exec_claude` に `env=` 経由で渡すように変更。`ANTHROPIC_API_KEY` / `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_SESSION_ID` を pop し、bot 経路でのネスト claude 検出 / API キー誤混入を遮断 (design.md §1.6)
  - `run_claude(prompt, channel_id)` に署名変更、`on_message` で `message.channel.id` を渡す (DM / guild どちらも channel.id は一意なのでそのまま使える)
  - 動作確認: `sessions.py` の roundtrip スモークテスト (new → record_usage → resume → reset → new) と `_claude_env()` の strip 確認を `bot/venv` で実施、全 pass
  - **実弾確認 OK** (2026-05-14 14:50-14:51, channel `1501135556703424552`): Discord メンションで 2 ターン会話、`sessions/channels/<channel-id>.json` が `prompt_count: 2` / `last_prompt_at` 更新済で生成、`~/.claude/projects/-home-miho-companion-bot-workspace/<uuid>.jsonl` が `--session-id` の uuid そのままで作成 (encoded-cwd 規則 + uuid4 ハンドオフが design.md §1.3 / §1.5 通り)、bot.log は `send len=372` (1 ターン目) → `send len=699` (2 ターン目) で文脈保持を確認
  - **既知の運用注意** (code-reviewer 軽微提案 #1 + #3 反映):
    - T-A 単独完了時点では `/reset` コマンド未実装 (T-D で実装予定)。`SESSION_ALREADY_IN_USE` 等で sessions JSON が現実の jsonl と乖離した場合の自動回復経路はないため、復旧は `rm bot/sessions/channels/<channel-id>.json` の手動操作
    - `bot/sessions/` 配下の構造は将来 T-D の `ledger.jsonl` と共存予定。現状 `channels/` サブディレクトリに分離してあるので衝突しない
  - code-reviewer: 修正必須なし、軽微提案 3 件中 2 件 (運用注記) を本 STATUS に反映、残り 1 件 (`_from_iso` の Optional 分離) は実害なく未反映

- 2026-05-14 T-0: claude CLI 2.1.141 で S1-S5 全シナリオ再検証完了 (Phase 2.5 前提条件、`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」+ design.md §10.4 ルール準拠)
  - CLI バージョン: **2.1.141** (design.md 検証時 2.1.138、STATUS.md 前回確認 2.1.140 から更に 1 上昇)
  - 検証 CWD: `/tmp/bot-cli-verify-2026-05-14/` (bot-workspace / workspace の jsonl を汚さない)
  - 環境: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY` (design.md §1.6 準拠)
  - モデル: `--model claude-haiku-4-5` (検証コスト最小化、S5 で `total_cost_usd=0.01267595`)
  - 結果 (design.md §1.5 の表と完全一致):

  | シナリオ | コマンド | 結果 (2.1.141) | design.md 一致 |
  |---|---|---|---|
  | S1 新規 | `--session-id $(uuidgen) "..."` | rc=0、`~/.claude/projects/-tmp-bot-cli-verify-2026-05-14/<uuid>.jsonl` 作成、stdout=`ALPHA` | ✓ |
  | S2 継続 | `--resume <uuid> "..."` | rc=0、直前 ALPHA を想起 = 文脈保持 | ✓ |
  | S3 lost | `--resume <存在しない uuid>` | rc=1、stderr `No conversation found with session ID: <uuid>` | ✓ 完全一致 |
  | S4 in-use | `--session-id <既存uuid>` | rc=1、stderr `Error: Session ID <uuid> is already in use.` | ✓ 完全一致 |
  | S5 json | `--output-format json --session-id <new> "..."` | rc=0、JSON 単一オブジェクト | ✓ + 追加情報 |

  - encoded-cwd 規則: `/tmp/bot-cli-verify-2026-05-14` → `-tmp-bot-cli-verify-2026-05-14` 確認、JSONL 保存先 = `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`
  - S5 JSON キー実機観察 (`--output-format json` の **stdout 単一オブジェクト由来**、生データは `bot/docs/reviews/2026-05-14-cli-2.1.141-S5-stdout.json` に保管。transcript jsonl とは別レイヤなので混同しない):
    - design.md §1.5 で確定済キー (stdout): `result` / `session_id` / `total_cost_usd` / `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` / `modelUsage` / `permission_denials` / `terminal_reason` / `duration_ms`
    - 2.1.141 で stdout トップレベルに追加観察: `type` / `subtype` / `is_error` / `api_error_status` / `duration_api_ms` / `num_turns` / `stop_reason` / `fast_mode_state` / `uuid`
    - 2.1.141 で stdout の `usage` 配下に追加観察: `server_tool_use.{web_search_requests, web_fetch_requests}` / `service_tier` / `cache_creation.{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}` / `inference_geo` / `iterations[]` (per-iteration tokens) / `speed`
    - 設計影響: ClaudeResult dataclass は design.md §3.1 の確定 7 項目で十分 (追加キーは将来必要になれば取り込む、現時点で未使用)
  - `claude -p --help` 確認 (§1.8 #5、`--bare` 監視): `--bare` の説明 = "Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)." → **オプトインのまま**、デフォルト動作変更なし。N4「bot.py は明示的に `--bare` を使わない」継続
  - 検証 jsonl は `~/.claude/projects/-tmp-bot-cli-verify-2026-05-14/` 配下に残置 (S3/S4 の stderr 文言を後から確認可能にするため、Phase 2.5 完了後に削除予定)。S5 stdout 生 JSON は `bot/docs/reviews/2026-05-14-cli-2.1.141-S5-stdout.json` に保管 (次回 CLI up 時の比較根拠)

- 2026-05-13 Phase 2.5「土管の耐久化」着手前の準備（bot-workspace 新設 + `--bare` 実機確認）
  - bot-workspace 新設（`~/companion/workspace/redesign/design.md` §1.1 / §1.2 / §2 確定済の内容）
    - `~/companion/bot-workspace/` ディレクトリ作成
    - `bot-workspace/CLAUDE.md`（Discord 経由セッション固有: 口調 / `--session-id` + `--resume` 運用 / 書き込み境界 / OWNER 認可 / 上位 `~/companion/CLAUDE.md` 参照）
    - `bot-workspace/.claude/settings.json`（§2 確定の bot 用 permissions: WebSearch / WebFetch / vault notes 書き込み / git 通常操作 allow、`git push` ask、deny は workspace と同等、`additionalDirectories` は vault / logs）
      - §2 確定リストに加え workspace 慣習からの補完 3 件を追補: `Bash(git status)` / `Bash(git diff)`（引数なし形、workspace settings line 42-45 に揃える）、`Bash(claude --version)`（CLI バージョン確認用、副作用なし）
  - bot.py の CWD は `~/companion/workspace` のまま未変更。bot-workspace は **Phase 2.5 メイン実装で bot.py 側の cwd 切替と同時に活性化** する。現状の bot 動作には影響なし
  - `--bare` 実機確認（design.md §1.8 #5 + §11.5、N4 の watch 基準値取得）
    - 実行: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY claude -p --bare "test"`
    - 結果: stderr `Not logged in · Please run /login`、rc=1
    - 観察: Max プラン環境では `--bare` が明示的にエラーで止まる。design.md は `ANTHROPIC_API_KEY not set` 系の文言を想定していたが実際は `Not logged in`（`--bare` が keychain reads を skip → OAuth credentials を読まない → 認証情報なし）。本質（`--bare` がデフォルト化された瞬間に bot 経路が無音破綻する将来リスク）は変わらず、N4「bot.py は明示的に `--bare` を使わない」を継続
  - claude CLI バージョン: design.md 検証時は 2.1.138、現在 **2.1.140**（2 バージョン分上昇）。S1〜S5 全シナリオの再検証は Phase 2.5 着手時に実施（`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」+ design.md §10.4 ルール準拠）

- 2026-05-09 `claude -p` 呼び出しに `--continue` を導入し多ターン会話を可能化
  - Phase 3-1 を Discord 経由で動かしたとき、bot が会話を保持せず Phase 3-1 の確認ラリー（重複チェック / 書き込み判断）が破綻する問題が顕在化（claude が「許可します」を受け取っても直前文脈なしで「何の許可？」と返した）
  - `run_claude` を `_exec_claude` ヘルパーに分割、`--continue` で直近セッション継続を試行 → stderr に `no conversation` / `no previous` / `no session` のいずれかが含まれて rc != 0 のときだけ通常起動でフォールバック（`_is_no_prior_session`）
  - フォールバック条件を狭めた根拠: rc != 0 全件で再試行すると Web 検索拒否・タイムアウト・認証エラー等「ユーザーへ素直に返すべき失敗」も問答無用で 2 回目が走り、最悪 `CLAUDE_TIMEOUT × 2 = 600s` の待ちを食らう。`--continue` 由来の「直近セッション無し」と判別できる stderr 文言にだけ反応する形に倒した
  - 既知の制約: bot CWD = `~/companion/workspace` で `--continue` するため、手元 claude code セッションの jsonl が「直近」として拾われ得る。短い対話なら影響限定的、運用で気になったら bot 専用 CWD or session-id 管理（A2 案）への切り替えを検討
  - 実機 stderr 文言は未確認（実弾テストでパターン未マッチなら fallback されず `[claude exited rc]` が Discord に返る形になる、その時点で文言を観察して `_is_no_prior_session` の語彙を追加する運用）
  - workspace 側 `.claude/settings.json` の `permissions.allow` に `WebSearch` と `WebFetch` を追加（Phase 3-1 の Web 検索フローで「権限が必要」で詰まる問題の解消）。WebFetch は OWNER_ID 限定運用前提で全 URL 許可（domain 制限なし）。Phase 4 でスケジューラ等が prompt を組み立てるようになったら `WebFetch(domain:*)` の allowlist or `ask` への降格を再判定
  - code-reviewer: 修正必須 1 件（`rc != 0` 全件で fallback は危険、stderr 判定に絞れ）反映、軽微 2 件（WebFetch ドメイン制限 / `--continue` 側のみ短縮タイムアウト）はユーザー判断で現状維持

- 2026-05-07 起動時に通知チャンネルを verify するヘルスチェックを追加
  - `on_ready` で `get_channel(NOTIFY_CHANNEL_ID)` → ヒット外しなら `fetch_channel`、`isinstance(ch, discord.TextChannel)` で型確認、失敗時は ERROR ログを出して return（bot は止めず mention/DM 応答は維持）。成功時は `notify channel verified: #<name> (<id>)` の INFO ログ
  - 目的: チャンネル削除・権限変更・ID 設定ミス等で socket 通知が無音消失するのを早期検出する。`_handle_notify` 経路だけだと except に落ちるだけで Discord 側に何も出ず気づきにくいため、起動時にプロアクティブに検出する
  - 実弾テスト OK: 再起動後の bot.log に `notify channel verified: #通知 (1501135177223508081)` を確認、`logged in as` 直後 1ms（キャッシュヒットで fetch せず）
  - code-reviewer 再レビュー: 修正必須なし、軽微提案 2 件（① `TextChannel` 限定 → `Messageable` / `(TextChannel, Thread)` 拡張、② `_handle_notify` との resolve 処理共通化）はユーザー合意で未反映。① は単一テキストチャンネル運用前提に整合、② は 3 箇所目が出るまで保留
- 2026-05-07 socket 通知の宛先を OWNER DM → サーバーテキストチャンネルへ切り替え
  - `.env` に `NOTIFY_CHANNEL_ID` を追加（必須・isdigit バリデーション、`OWNER_ID` と同パターン）。`.env.example` / `README.md` セットアップ節にも追記
  - `bot.py` の `_handle_notify` で `client.get_channel(NOTIFY_CHANNEL_ID)`（キャッシュヒット）→ ヒット外しなら `fetch_channel` で取得、`await channel.send(piece)` で送信。OWNER DM への送信コードは削除（PROJECT.md / maintenance/STATUS.md の「切り替え」記述に整合）
  - 実弾テスト OK: bot 再起動後 `printf '...' | nc -U -N $XDG_RUNTIME_DIR/companion-bot.sock` で bot.log に `notify forwarded len=32`、対象チャンネルへ書き込み確認
  - code-reviewer: 修正必須なし、軽微提案 1 件（起動時に TextChannel か verify するヘルスチェック）は reference 実装の OWNER 取得と同程度のガード水準に揃えるため未反映、もう 1 件（`.env.example` 追記）は反映済み
- 2026-05-06 venv 再構築（Mint アップグレードで Python 3.8→3.10 になり ABI 不一致で壊れていた）
- 2026-05-06 `.env` の `DISCORD_TOKEN` 修正（Application ID 等が貼られていて 401 Unauthorized だった）
- 2026-05-06 診断ログ追加（`on_ready` の guilds 一覧 / `on_message` 冒頭の raw recv）— mention 不通の原因切り分け用
- 2026-05-06 動作確認: DM・サーバー内ユーザーメンション双方で `claude -p` 応答を確認
- 2026-05-06 退避フォルダ削除（`venv.broken-py38/`, `venv.halfbuilt/`）
- 2026-05-06 workspace 側 `CLAUDE.md` の `bot/` 説明を実態に更新（土管 bot として記述、`docs/STATUS.md` を参照先として明記）
- 2026-05-06 診断ログ削除（`on_ready` を 1 行版に戻す / `on_message` 冒頭の `raw recv` ログ削除 / 認可後の `recv from=...` ログも削除＝対の診断ログかつ `prompt[:40]` の漏出回避）。レビュー OK
- 2026-05-06 systemd 常駐化（`~/.config/systemd/user/companion-bot.service` を `~/companion/bot/companion-bot.service` への symlink で配置、`systemctl --user enable --now` で起動。Active running / `logged in as renbot#8921` 確認済み）
- 2026-05-06 linger は不要と判断（PC つけっぱなし + 自動ログイン有効のため、再起動後も user systemd が立ち上がり bot も復帰する）
- 2026-05-06 git 化完了。GitHub プライベート repo (`mooneclipse/companion-bot`) に push。pre-commit hook で gitleaks v8.30.1 による秘密情報チェックを自動化（`~/bin/gitleaks` 配置）。実弾テスト（`git add -f .env` で hook が exit 1 で commit 拒否）確認済み
- 2026-05-06 Unix socket listener 追加（`CompanionClient.setup_hook` で `$XDG_RUNTIME_DIR/companion-bot.sock` を 0600 で listen、EOF まで読んだ本文を OWNER の DM に転送、`close()` で sock を unlink、起動時に既存 sock を unlink）。実弾テスト: `printf ... | nc -U -N` で `notify forwarded len=65` ログ + DM 受信を確認。Phase 2 から `nc -U`/`socat` で書くだけで Discord に通知できる入口として運用開始。code-reviewer: 修正必須なし、軽微な提案（STATUS.md 主要パス欄に sock を追記）反映済み

## 既知の問題

（なし）

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮）
  - セキュリティ（入力検証、秘密情報の扱い、権限境界）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `bot/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
- `~/companion/logs/bot.log` は RotatingFileHandler で自動ローテーション (5MB×3)、`~/companion/logs/vault-sync.log` は append 専用で**手動 truncate 運用** (1 セッション 1-2 行想定、年間数 MB 程度なので逼迫したタイミングで `: > ~/companion/logs/vault-sync.log` でクリア。logrotate 化は maintenance 側で必要性が出た時点で判断)
