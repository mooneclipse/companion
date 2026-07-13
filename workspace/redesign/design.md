# companion-bot 再設計 design (v0.2.3 questions.md 反映済)

**状態**: approved + questions.md (UQ-1〜UQ-10) 反映済
**承認日**: 2026-05-12 (v0.2.2 plan approve)
**questions.md 反映日**: 2026-05-14 (全項目回答完了反映、v0.2.3 へ)
**lead**: team-lead@companion-redesign
**承認元 plan**: `/home/miho/.claude/plans/wild-dreaming-peach.md` (architect / v0.2.2)
**判定基準**: lead approve 判定 8 項目 (B 妥協は 4+1 条件)、全項目内容反映済を読み合わせで確認

本文書は v0.2.2 plan + UX 暫定詳細 + devil 反証反映履歴 + 採用判断 + 検証項目を統合し、さらに 2026-05-14 の questions.md 全項目回答 (UQ-1〜UQ-10) を反映した最終設計書 (v0.2.3)。Phase 2.5 着手時はこの design.md と `questions.md` の回答サマリを根拠にコード実装を始める。**本セッションは設計確定までで停止、実装には進まない**。

---

## 0. Why redesign (堂々巡り原因 7 点)

現状の bot は単純な「Discord メッセージ → `claude -p --continue` → 返却」土管。Phase 3-1 (Web 検索 → vault 保存) で確認ラリー破綻と権限 whack-a-mole が連続し、ユーザーが「修正とバグが堂々巡り」と宣言、設計から仕切り直すに至った。構造的原因 7 点:

**A. セッション帰属が CWD 依存で曖昧**: `--continue` は CWD 単位で直近 jsonl を継ぐ。bot CWD `~/companion/workspace` は手元 claude code セッションと同じ。手元で claude を触った直後の Discord 発話で bot は手元セッションを掴み、Phase 3-1 ラリーが破綻。

**B. 会話状態を bot が持たない**: session-id を管理せず、状態は外部 (claude jsonl) 任せ。再起動・別 channel 移動・時間差で「どのセッションが続くか」不確定。

**C. 権限が後追い (whack-a-mole)**: WebSearch/WebFetch が permission に無くて止まる → settings.json に追加、を新能力追加のたびに繰り返す。bot 経路と手元 claude code が同じ settings を共有し責務境界が崩れる。

**D. 責務の混在**: 1 ファイル bot.py (~210 行) で Discord 受信 / 認可 / claude 起動 / chunk 分割 / socket listener / 通知チャンネル検証を全部抱える。能力追加で改変範囲が広がり続ける。

**E. Max プランクォータの可視性ゼロ**: 5h cycle / 週次クォータの状態を bot は知らない。`--continue` フォールバックでクォータを倍消費する設計が残っていた。

**F. 書き込み境界が claude 任せ**: `Edit/Write(vault/notes/**)` は bot.py で渡すが、`Bash(mv/rm)` 経由の境界外操作は workspace settings 任せ。prompt injection の余地が claude 側のガード頼み。

**G. タイムアウト戦略が単一**: 全 prompt が `CLAUDE_TIMEOUT=300s`。Web 調査 4 並列と短質問が同閾値で、長文系は寸前、短文系は無駄待ち。

これらを構造的に解消するのが本設計の目的。

**主張の現状整理 (2026-05-20 軸 5 集約、M-2)**: 設計レベルで A / B / C / D / F / G の構造的解消は T-A〜T-E 全 commit 済。ただし観察初期 2 日 (5/19+5/20) の評価では **5/7 完全解消 + 1/7 部分達成 + 1/7 グレーゾーン残置**:

- **完全解消 (5/7)**: A (CWD 依存) / B (会話状態) / C (permission whack-a-mole) / F (書き込み境界) — 静的整合性 OK
- **部分達成 (1/7)**: D (責務分解) — §3 図と実装乖離あり (B4-2 で末尾追記 + M-3 で §3.1/§3.4 inline 注記強化、独立ファイル化は Phase 4 で再判定)
- **グレーゾーン (1/7)**: G (タイムアウト 3 段階) — 単一閾値からの拡張で「条件分岐の case を増やす + タイムアウト閾値を 3 つに分けた数値」の合成、devil W-A グレーゾーン残置採用、4 段階拡張 / 境界変更は明確に 2 周目 (M-5 / §4.7 末尾参照)
- **実観測未到達 (1/7)**: E (Max クォータ可視性) — CreditBudgetGuard 即時前倒し有効化 (5/19) で形式解消、観察期間中の実観測検証は 2 日分のみ + Anthropic Console 累計表示との一致性は 6/15 新クレジット制初月締め後の 7/1 前後で点検必須 (devil D-B / K-14 / §11.4 観察項目)

---

## 1. CWD とセッション分離 (最優先)

### 1.1 bot 専用 CWD 新設

```
~/companion/
├── workspace/       # 手元 claude code 用 (既存維持)
├── bot-workspace/   # NEW: bot 経由 claude セッション専用
├── vault/, maintenance/, web/, logs/  # 既存維持
```

`~/companion/workspace/.claude/settings.json` (手元用) と `~/companion/bot-workspace/.claude/settings.json` (bot 用) を完全分離。bot 経路と手元経路で permission の意味を取り戻す (C を解消)。

### 1.2 CLAUDE.md 3 層構造

公式仕様: claude CLI は CWD から親階層へ遡上探索する (researcher 公式 doc 確認済)。これを活かして:

```
~/companion/CLAUDE.md            # NEW: 共通項
~/companion/workspace/CLAUDE.md  # 手元 claude code 固有のみ
~/companion/bot-workspace/CLAUDE.md  # bot 経由セッション固有のみ
```

`~/companion/CLAUDE.md` の内容: 口調基準 / vault 書き込み境界の上位ルール / OWNER 認可方針 / git 運用方針 / commit ルール / **設計判断・対症療法の上限** (devil T10、本 design.md §10 で詳述)。

`--add-dir` は CWD 外権限追加であって CLAUDE.md auto-discovery メカニズムではない (devil D 訂正)。`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` も使わない。CWD 近いほど後勝ち (実質上書き)。

### 1.3 session-id 設計 (uuid4 random + sessions JSON 永続化)

`--continue` を**完全廃止**、`--session-id <uuid>` 初回 + `--resume <uuid>` 継続に一本化 (A/B を解消)。

```python
import uuid
from dataclasses import dataclass
from datetime import datetime

@dataclass
class SessionMeta:
    channel_id: int          # Discord channel.id
    session_id: str          # uuid4 random、初回 prompt 時に発番
    created_at: datetime
    last_used_at: datetime
    prompt_count: int
    last_prompt_at: datetime | None
```

永続化先: `~/companion/bot/sessions/channels/<channel-id>.json` (1 channel = 1 file、gitignore)。

**注**: deterministic uuid5 (channel_id ベース) は `/reset` UX と本質的に矛盾するため不採用 (devil 第四次反証 #1 + lead 訂正)。「reset で同 uuid を引いて `already in use` エラー」を避ける唯一の道は uuid4 random + 永続化。古い jsonl の手動削除は B 妥協領域 (claude CLI 側 GC 任せ、bot は触らない)。

### 1.4 3-state 判定 (sessions JSON flag track 一本)

```python
def determine_args(channel_id: int) -> tuple[list[str], SessionMeta]:
    meta = sessions.load(channel_id)
    if meta is None:
        # 新規発番ルート
        new_id = str(uuid.uuid4())
        meta = SessionMeta(channel_id, new_id, now(), now(), 0, None)
        sessions.save(meta)
        return (["--session-id", new_id], meta)
    else:
        # 継続ルート
        return (["--resume", meta.session_id], meta)
```

**禁止反パターン** (devil 第四次反証 #2、approve 判定 #7 の核):
- ❌ `--session-id <uuid>` 先試行 → `already in use` なら `--resume` リトライ (subprocess 2 回呼び、堂々巡り原因 #4 の再生産)
- ❌ stderr 文言マッチで挙動分岐
- ❌ `rc != 0` での自動 fallback リトライ
- ❌ ErrorKind enum 値でリトライ判定分岐 (判定 #8、文字列マッチが enum マッチに置き換わっただけで本質変わらず)

**原則**: subprocess は 1 prompt = 1 回呼び。振り分けは bot 側 sessions JSON の flag 引きだけで決める。`already in use` エラーは bot 側 state 不整合の事故ケース、エラーログ + Discord 報告で終わり、リトライしない。

### 1.5 実機検証で確定した CLI 挙動 (claude 2.1.138)

S1〜S5 全シナリオ実機検証済:

| シナリオ | コマンド | 結果 |
|---|---|---|
| S1 新規 | `claude -p --session-id $(uuidgen) "..."` | rc=0、新規 jsonl 作成 |
| S2 継続 | `claude -p --resume <uuid> "..."` | rc=0、文脈保持 |
| S3 lost | `claude -p --resume <存在しない uuid>` | rc=1、stderr `No conversation found with session ID: <uuid>` |
| S4 already-in-use | `claude -p --session-id <既存uuid>` | rc=1、stderr `Error: Session ID <uuid> is already in use.` |
| S5 json | `claude -p --session-id <new> --output-format json "..."` | 単一 JSON: `result` / `session_id` / `total_cost_usd` (0.06805275、**Max プランでも値取得可**) / `usage.{input_tokens, output_tokens, cache_*}` / `modelUsage` (haiku 4.5 + opus 4.7[1m] 混在) / `permission_denials` / `terminal_reason` / `duration_ms` |

**encoded-cwd 規則**: CWD の `/` → `-` 置換。例: `/tmp` → `-tmp`、`/home/miho/companion/workspace` → `-home-miho-companion-workspace`。jsonl 保存先 = `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` (researcher b で公式根拠確認、JSONL 保存先は UUID でなく CWD で決まる)。

**CLI バージョン up 時の再検証履歴** (2026-05-20 軸 5 M-7 追加、`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」運用ルール準拠):

- 2026-05-14 T-0 (CLI 2.1.141): S1-S5 全シナリオ pass、design.md 表 (2.1.138) と完全一致、`--bare` オプトインのまま (bot/docs/STATUS.md 2026-05-14 T-0 entry 参照)
- 2026-05-20 軸 5 M-7 (CLI 2.1.145): S1-S5 全シナリオ pass、design.md 表 + 5/14 T-0 と完全一致、`--bare` オプトインのまま継続。S5 stdout に `ttft_ms` (time to first token) 新規追加観察、ClaudeResult dataclass (§3.1 既存 7 項目) は十分 (bot/docs/STATUS.md 2026-05-20 軸 5 entry 参照)
- 2026-07-13 ticket #86 (CLI 2.1.207): S1-S5 全シナリオ pass、過去 3 版と完全一致、`--bare` オプトインのまま継続。S5 stdout に `time_to_request_ms` / `ttft_stream_ms` 新規追加観察、encoded-cwd 不変 + projects/<encoded-cwd>/ に `memory/` サブディレクトリ新規作成を観察 (jsonl 非干渉)。`/usage` headless は $0 / num_turns 0 維持だがコールド 1 発目 15s timeout あり (bot/docs/STATUS.md 2026-07-13 #86 entry 参照)
- 次回 CLI up 検出時は同様に S1-S5 再走 + STATUS.md 追記、design.md §1.5 タイトル「(claude 2.1.138)」の version pin は表本体の確定値、追加版での pass 結果は本 sub-section に追記する形で管理

### 1.6 環境変数強制 (researcher P3 + devil W6 採用)

bot 経由 subprocess の環境で以下を必ず unset:

```python
env = os.environ.copy()
env.pop("ANTHROPIC_API_KEY", None)   # Max プラン専有を強制
env.pop("CLAUDECODE", None)          # ネスト claude 検出回避
env.pop("CLAUDE_CODE_ENTRYPOINT", None)
proc = await asyncio.create_subprocess_exec(..., env=env, ...)
```

`.env` の内容に依存しない設計。systemd `Environment=` 設定は不要 (subprocess 側で pop すれば service 経由のリーク経路も塞がる)。

**`.env` の現状確認** (UQ-6, 2026-05-14): `ANTHROPIC_API_KEY` 行は存在しない (ユーザー側で `grep -i 'ANTHROPIC_API_KEY' ~/companion/bot/.env` 実行確認済)。env.pop と二重に安全。

### 1.7 cron 系 vs Discord 系 実行モード分離 (researcher P2 採用)

`claude_runner.py` で関数化:

**Discord 会話系** (`claude_runner.run_discord`):
```
claude -p --session-id <uuid> [--resume <uuid> 継続時]
         --model claude-sonnet-4-6
         --output-format json
         --permission-mode default
```

**cron / scheduled 系** (`claude_runner.run_oneshot`、Phase 4 着手時に実装):
```
claude -p --no-session-persistence
         --disable-slash-commands
         --exclude-dynamic-system-prompt-sections
         --setting-sources ""
         --output-format json
```

Phase 2.5 では `run_discord` のみ実装、`run_oneshot` は雛形のみ (YAGNI)。

**デフォルトモデル固定** (UQ-10 確定、2026-05-14): `run_discord` は `--model claude-sonnet-4-6` をハードコードで渡す。`/model` コマンドは提供しない (UQ-4.4 最小 3 コマンド方針と整合)。bot 用途では Opus 4.7 は能力過剰・Haiku 4.5 は能力不足、月次クレジット $100 の枠で月 1,000〜2,200 回の余裕運用ができる Sonnet 4.6 が中庸。モデル変更が必要になった時点で `ClaudeOptions.model` のデフォルト値を編集する判断点として残す (ENV 変数による外出しは「実質コマンド代替」になるため不採用)。`run_oneshot` はモデル未指定、Phase 4 着手時に cron 用途別 (要約系 = Haiku / 複雑系 = Sonnet) で再判断。

### 1.8 jsonl 直接 stat 妥協の許容条件 5 点 (B、approve 判定 #2)

1. **CLI version pin**: `bot/docs/STATUS.md` に `claude CLI version + 検証日` 必須記録
2. **CLI up 時の再検証手順**: F 検証 3 シナリオ + encoded-cwd 規則 + stderr 文言を再走、STATUS.md に検証結果を追記してから本番投入
3. **outsourcing 条件**: `claude --list-sessions` 相当が判明したら即廃止 (researcher b で「存在しない」確認済、当面発火しない、stat 妥協は中長期維持)
4. **encoded-cwd 実機根拠で記録**: 推測コード禁止、F 検証で実機確認した結果を採用
5. **`--bare` 監視 (NEW、devil 第七次)**: CLI up 時に `claude -p --help` の release note / CHANGELOG で `--bare` のデフォルト動作変更を必ず確認。Max プランは OAuth → `--bare` 不可、デフォルト化された瞬間に **無音破綻** (systemd Active のまま、Discord で `ANTHROPIC_API_KEY not set` エラー、健全性チェックすり抜け)。bot.py は `--bare` を明示的に使わない (N4 不採用)

---

## 2. 権限プロファイル分離

`bot-workspace/.claude/settings.json` (workspace から独立):

- `allow`: WebSearch, WebFetch, `Read(~/companion/vault/**)`, `Edit(~/companion/vault/notes/**)`, `Write(~/companion/vault/notes/**)`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(git pull --ff-only:*)`, `Bash(git add notes/*:*)`, `Bash(git commit:*)`, `Bash(grep:*)`, `Bash(rg:*)`
- `ask`: `Bash(git push:*)`、書き込み系の境界外
- `deny`: `Read(.env)`, `Read(~/.ssh/**)`, 既存 deny 一式 (破壊系 git / rm -rf 系)
- `additionalDirectories`: `~/companion/vault`, `~/companion/logs` (workspace 由来は持ち込まない)

**手元 workspace 側 settings の WebSearch/WebFetch は剥がす** (UQ-1 案 X 確定、2026-05-14)。剥がした結果、手元での Web 調べ物で承認待ちが頻発するようなら case by case で `settings.local.json` or `--add-dir` で個別救済する (UQ-1 回答末尾の retry 条件)。bot-workspace 側 settings には WebSearch/WebFetch を allow として維持、bot 経路のみが Web 系を扱う責務境界に固定する。

---

## 3. bot.py 責務分解と SDK 耐性抽象 (W3)

**注**: 「論理は変えない」は撤回 (devil E)。責務分解は必ず lock の所在 / err mapping / subprocess cwd 等の logical 変更を伴うことを明示。

```
bot/
├── bot.py              # Discord 接続 / on_message / 認可 / chunk 分割 (lifecycle)
│                       # 2026-05-20 軸 5 集約 (M-3): Phase 2.5 では config / notify_listener も inline
├── (config 機能)        # Phase 2.5 では bot.py module-level ENV パースに inline (将来 Phase 4 で config.py 独立判断)
├── claude_runner.py    # subprocess 起動 / stderr 分類 / timeout 判定
│                       # claude_lock = asyncio.Lock() を ClaudeRunner instance attribute として所有
├── sessions.py         # channel ↔ session_id 永続化 (JSON)
├── (notify 機能)        # Phase 2.5 では bot.py の CompanionClient._handle_notify に inline (将来 Phase 4 で notify_listener.py 独立判断)
├── quota.py            # BudgetGuard 抽象 (RequestsCountGuard / CreditBudgetGuard) + /quota 集計 + キャッシュメトリクス (§4)
└── sessions/           # channel↔session_id JSON (gitignore)
```

**Phase 2.5 完了時点の実装乖離 (2026-05-20 全体レビュー B4-2 + 軸 5 M-3 で図書き換え)**: `config.py` / `notify_listener.py` は独立ファイル化せず、それぞれ `bot.py` の module-level ENV パース / `CompanionClient._handle_notify` に inline 実装されている。`bot.py` 単体で済む規模 (現状 ~400 行) なので分割しない判断を維持、将来 Phase 4 で bot.py が膨らんだ段階で再判定する。図そのものを上記書き換えで実装と整合 (落とし穴 D「両表記混在」回避)。

### 3.1 dataclass + ClaudeOptions / ClaudeResult / ErrorKind (W3)

SDK 移行コスト最小化のため subprocess 引数を dataclass 化、stdout/stderr を構造化、エラーを enum 分類:

```python
from enum import Enum
from dataclasses import dataclass, field

class ErrorKind(Enum):
    OK = "ok"
    NO_PRIOR_SESSION = "no_prior_session"            # --resume <存在しない uuid>
    SESSION_ALREADY_IN_USE = "session_already_in_use"  # --session-id <既存uuid>
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    OTHER = "other"

@dataclass
class ClaudeOptions:
    """subprocess 引数を dict 化、SDK 移行時は to_sdk_kwargs() を追加するだけ。"""
    session_id: str | None = None       # 新規発番用
    resume_session: str | None = None   # 継続用
    output_format: str = "json"
    permission_mode: str = "default"
    model: str = "claude-sonnet-4-6"    # UQ-10: bot デフォルトは Sonnet 4.6 固定、/model コマンド非提供
    add_dir: list[str] = field(default_factory=list)
    no_session_persistence: bool = False
    disable_slash_commands: bool = False
    exclude_dynamic_system_prompt_sections: bool = False
    setting_sources: str | None = None
    timeout_s: float = 300.0

    def to_cli_args(self) -> list[str]: ...
    def to_sdk_kwargs(self) -> dict: ...  # 将来 SDK 移行用

@dataclass
class ClaudeResult:
    rc: int
    error_kind: ErrorKind
    raw_stdout: str
    raw_stderr: str
    # --output-format json でパース可能だった場合のみ以下が入る
    result_text: str | None = None
    session_id: str | None = None
    cost_usd: float | None = None                 # Max でも値取得可 (S5 実測)
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_creation_input_tokens: int | None = None   # JSON usage.cache_creation_input_tokens に一致
    cache_read_input_tokens: int | None = None       # JSON usage.cache_read_input_tokens に一致
    model_usage: dict[str, dict] | None = None
    permission_denials: list[str] = field(default_factory=list)
    terminal_reason: str | None = None
    duration_ms: int | None = None
```

### 3.2 ErrorKind の用途明示 (approve 判定 #8)

`ErrorKind` は **エラー表面化 (ユーザー通知文面 / 状態確定 / ログ分類) 専用**。**リトライ判定の分岐ではない**。

- ✅ `notify_user_with_error(error_kind)` の文面差し替え
- ✅ ログ分類 / error reporter のカテゴリ分け
- ❌ `if error_kind == SESSION_ALREADY_IN_USE: rerun_with_resume(...)` ← stderr 文字列マッチが enum マッチに置き換わっただけで本質的に堂々巡り原因 #4 の再生産

リトライは bot 側 sessions JSON の flag 引きだけで決める。CLAUDE.md / code-reviewer.md に禁止規則として明文化 (§10)。

### 3.3 lock の所在 (devil E 採用)

- `claude_lock = asyncio.Lock()`: `ClaudeRunner` の instance attribute として所有。claude プロセス起動の直列化責務
- `vault_lock = asyncio.Lock()`: vault git index 操作の排他 (`git pull --ff-only` から `git push` まで)。`claude_lock` とは責務分離 (devil W4 採用)
- 将来 maintenance 側から vault を触る場合は cross-process lockfile (`~/companion/vault/.git/companion.lock` 等) を別途実装、Phase 2.5 スコープ外

### 3.4 公開関数シグネチャ

- `config.load() -> Config` (Phase 2.5 では bot.py module-level に inline、将来 Phase 4 で独立判断、M-3)
- `sessions.load(channel_id) -> SessionMeta | None`
- `sessions.save(meta) -> None`
- `sessions.reset(channel_id) -> bool`   # /reset コマンド用 (削除した場合 True、元から無ければ False。2026-05-20 B4-3 で `SessionMeta` 返却案から訂正、呼び出し側は bool 評価のみ)
- `claude_runner.run_discord(prompt, options) -> ClaudeResult`
- `claude_runner.run_oneshot(prompt, options) -> ClaudeResult`  # Phase 4 で実装
- `quota.BudgetGuard.allow(now) -> bool` / `record(now, result)` / `summary() -> dict` / `exceeded_message(summary) -> str` (実装: `RequestsCountGuard` + `CreditBudgetGuard` 両方、2026-05-19 即時前倒し有効化、§4.2)
- `notify_listener.NotifyListener.start(on_message)` / `stop()` (Phase 2.5 では bot.py CompanionClient._handle_notify に inline、将来 Phase 4 で独立判断、M-3)

---

## 4. 予算管理と /quota (D5 + C 自衛 framing)

> **2026-06-16 撤回ヘッダ**: 2026-06-15 に予定されていた `claude -p` / Agent SDK の月次クレジット枠分離 (UQ-5) は、6/15 当日に Anthropic が公式に **pause** した (support.claude.com「Use the Claude Agent SDK with your Claude plan」: "We're pausing the changes... For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits.")。これを受け 2026-06-16 に CreditBudgetGuard を撤去し、**`requests_count` (1h 回数上限) + subscription 消費前提**に戻した。ledger の金額記録・/quota の金額表示も撤去。本 §4 以下のクレジット枠 ($100/月) 前提の記述は、Anthropic が制度を確定したときの再実装の参考として歴史的に残す (実装は git 履歴に存在)。

### 4.1 目的の明示 (用語「自衛」一本に統一、devil C 採用)

bot 内予算管理は **「bot 経由 (Discord メッセージ起点) の暴走で自爆クレジット枯渇を起こさない自衛策」**。

- **2026-06-15 以降**: Anthropic 新クレジット制 ($100/月、UQ-5 確定) 下では、月次クレジット枠を bot 経由で食い潰さないための自衛が直接の目的
- **2026-06-14 まで (暫定)**: Max プラン 5h cycle 枠を bot 経由暴走で枯渇させない暫定自衛
- **防がない**: 手元 `claude code` セッションとの予算協調、サブスクリプション全体の使用量管理 (責務外、bot からは見えない)
- 「保護 / 管理 / 監視」の語は使わず「自衛」で統一 (読者の誤解防止)

**framing 切替の公式根拠** (UQ-5):
- Anthropic ヘルプ「Claude プランで Claude Agent SDK を使用する」(2026-06-15 開始、Pro / Max / Team / Enterprise 適用) で `claude -p` 非対話モード / Agent SDK 経由のサブスクリプション認証アプリが ToS 許諾範囲内と明記
- → 2026-06-15 以降は companion-bot が ToS 明示許諾範囲内で動作、`total_cost_usd` 集計も **proxy ではなく正確な消費指標** になる

### 4.2 予算管理 2 期構造 (BudgetGuard 抽象、UQ-8 案 iv 整合)

2026-06-15 のクレジット制移行をまたぐため、`BudgetGuard` インタフェース化で実装切替可能に組む:

```python
from abc import ABC, abstractmethod

class BudgetGuard(ABC):
    @abstractmethod
    def allow(self, now: datetime) -> bool: ...
    @abstractmethod
    def record(self, now: datetime, result: ClaudeResult) -> None: ...
    @abstractmethod
    def summary(self) -> dict: ...   # 両実装で共通スキーマ (§4.6 で詳述)
```

**第 1 期 (〜2026-06-14): `RequestsCountGuard` 実装**
- ENV 変数 `BOT_REQUESTS_PER_HOUR` (default `20`、未確定)、1h スライディング window でリクエスト数カウント
- Jarvis 報告値 (1 日 150 / 5h 900) は採用しない: macOS 実測 + 自己宣言値、Linux + Inspiron 3521 + Max プランで再検証要 (devil W2 + researcher 出所確認)
- Phase 2.5 着手後の実弾運用 1 週間で実測してから ENV 値を確定 (`bot/docs/STATUS.md` に実測値記録)

**第 2 期 (2026-06-15〜): `CreditBudgetGuard` 実装 (2026-05-19 即時前倒し有効化)**
- 月次クレジット $100 を「予算」として扱い、`total_cost_usd` を ledger.jsonl から累計して残量を引く
- ENV 変数 `BOT_MONTHLY_CREDIT_USD` (default `100`)、月初 (1日 00:00 +09:00) リセット
- 切替方法: `bot/.env` の `BOT_BUDGET_GUARD=requests_count|credit_usd` で選択 (**ENV が master**)。`.env.example` の default は 2026-05-19 即時切替で `credit_usd`、実機 enable は user が `bot/.env` を編集して `BOT_BUDGET_GUARD=credit_usd` を反映した時点
- 表示プレースホルダ (`MONTHLY_BUDGET_ACTIVE_FROM = 2026-06-15`) は 2026-05-19 で撤廃、`/quota` 本月累計行は常時表示

**Phase 2.5 (UQ-9 T-D) の射程**:
- **インタフェース抽象化 + RequestsCountGuard + CreditBudgetGuard 両方実装**
- CreditBudgetGuard 実装は **2026-05-19 即時前倒し有効化** (元設計では「2026-06 上旬に追加、T-D を意図的に伸ばす、当時に新クレジット制の挙動詳細が公式 release で出揃う想定」だったが、bot 実装本体は `claude -p --output-format json` の `total_cost_usd` ledger 累計で完結する設計のため公式 release を待つ必要がない判定。voice/ 側前倒し完了後の空白期間活用、user 確認 + ledger 実消費検証 ($0.80/$100、0.8%) で即時切替方針確定)

**実機 enable 確認手順 (2026-05-20 軸 5 M-4 追加、将来 user の `.env` 編集時の center of truth)**:

- (a) `bot/.env` の `BOT_BUDGET_GUARD` 現在値を確認: `grep -E "^BOT_BUDGET_GUARD|^BOT_MONTHLY_CREDIT_USD" ~/companion/bot/.env`
- (b) bot.service restart 後の `/quota` 出力に `[guard: credit_usd / 本月 $X.XX/$100.00]` 行が出ているかを user 物理確認 (確認できない場合は `bot/.env` 編集 → `systemctl --user restart companion-bot.service` → `/quota` 再実行)
- (c) 実機 enable 確定日を `bot/docs/STATUS.md` に「BOT_BUDGET_GUARD=credit_usd 実機反映確認: YYYY-MM-DD」として記録
- 観察期間 (5/19〜6/2) の場合は (i)〜(iii) 確認結果を健全性履歴 entry に「BOT_BUDGET_GUARD 実機 enable 確認: <日付> (反映後 / 反映前)」と併記

### 4.3 対象範囲

- bot の `on_message` ハンドラから claude を呼ぶ全経路
- socket 通知経路 (`notify_listener`) は対象外 (claude 呼び出しが発生しない)

### 4.4 超過時の挙動

- silent drop **禁止**
- Discord に超過通知:
  - 第 1 期: 「予算上限 (1h あたり N 回) 到達、残り M 分待機」
  - 第 2 期: 「月次予算 $X / $100 到達、月初までクールダウン」
- 失敗時の自動リトライは全廃 (`--continue` フォールバックが二重消費の温床だった)

### 4.5 Phase 2.5 で意図的にやらないこと (scope creep 防止)

- 手元 `claude code` セッションの監視
- Anthropic Console 累計使用量の自動取得手段 (= Anthropic 提供の usage 照会経路、API キー API ではない)。2026-05-14 時点で公式提供なし、UQ-2 案 P で 6/15 以降の release note 継続監視確定、提供されたら即時 `/quota` に取り込む。bot 実装本体は `claude -p --output-format json` の `total_cost_usd` ledger 累計で完結するため、この照会手段の有無は実装本体に影響しない (将来オプション拡張、2026-05-19 即時前倒し判断の根拠)
- `claude /usage` 相当 CLI 提供の獲得 (researcher c 確定: 2026-05-14 時点で存在しない、UQ-2 案 P で監視継続)

### 4.6 `/quota` 可視化 (researcher P4 採用、R 案 z: 6/15 想定統一表示)

各 prompt 実行時に `--output-format json` の `total_cost_usd` / `usage.*` / `modelUsage` を `bot/sessions/ledger.jsonl` に append:

```json
{"timestamp": "2026-05-12T09:00:00+09:00", "channel_id": 12345, "session_id": "abc...", "total_cost_usd": 0.068, "usage": {"input_tokens": 1234, "output_tokens": 567, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}, "modelUsage": {...}, "terminal_reason": "completed"}
```

**返却 UX** (R 案 z 採用、本月累計行を常時表示):

```
[bot 経由 prompt の集計]
直近 5h: 12 回呼び出し / 累計 cost: $0.84
本月累計: $X.XX / $100.00 (使用 N%, 残り $Y.YY)
prompt キャッシュ ヒット率: A% (cache_read B tokens / total input C tokens)
token 内訳: input total Z, output total W

(これは bot 経由 prompt の集計値です。
 手元 claude code セッション分は含みません)
[guard: credit_usd / 本月 $X.XX/$100.00]   ← または [guard: requests_count / 直近 1h N/20]
```

**MONTHLY_BUDGET_ACTIVE_FROM プレースホルダ撤廃 (2026-05-19)**:
- 元案では「6/15 までは『集計中 (新クレジット制 2026-06-15 から有効)』」と表示分岐する想定だったが、CreditBudgetGuard 即時前倒し有効化に伴い user 選択で **(α) 撤廃** に確定 (2026-05-19)
- `format_summary()` の本月累計行は常時 `cost_month / monthly_budget_usd` 表示
- BudgetSummary から `monthly_budget_active: bool` フィールドも撤廃済 (quota.py)
- 計測ロジック (`cache_creation_input_tokens` / `cache_read_input_tokens` / `total_cost_usd` 記録) は変更なし、ledger.jsonl 仕様も変更なし

**禁止表示** (framing が変わってもこのルールは維持):
- 「Max プラン quota の N %」「残り時間 N 分で reset」など、bot で取得できない情報を代理推測した表示は禁止 (実測手段なし、誤情報リスク)

### 4.7 タイムアウト分離 (G 解消)

- 短文 (< 200 字 / コマンド系): 120s
- 通常: 300s
- Web 調査 fragment 検出時: 600s
- ENV `CLAUDE_TIMEOUT_SHORT` / `_NORMAL` / `_LONG`、実測で調整

**2 周目境界明示 (2026-05-20 軸 5 M-5 追加、devil W-A グレーゾーン残置採用)**:

- 現状 3 段階分割は「単一閾値 → 用途別分離」の YAGNI 範囲内 (短文 / 通常 / Web 調査) で許容
- **以下は明確に 2 周目該当**: (i) 3 段階を 4 段階以上に拡張する修正 (条件分岐の case を増やす) (ii) 既存閾値 (200 字 / 300s / 600s) の数値だけを動かす修正 (リトライ回数 / タイムアウト閾値 / バッファサイズ等の数値だけを動かす) (iii) fragment 検出ルールの境界変更
- 2 周目該当修正が提案された場合: CLAUDE.md「2 周目で取る行動」#1「該当箇所の修正をその場で打たない」を厳守、設計引き直し議論を起動。代替方針は long-running の根本原因 (MCP / tool 起動が多い) を `permission_mode` / tool allowlist 側で短絡する形を先に検討 (questions.md C-2 警戒条件と整合)

### 4.8 prompt キャッシュ設計 (NEW、UQ-10 確定)

**背景** (UQ-10 + UQ-5 試算):
- prompt キャッシュは cache 読み込みが input 単価の約 1/10、月次 $100 クレジット下で実消費を大きく減らす効果あり
- claude CLI / API は cache_control 機構を裏で扱う、`--output-format json` の `usage.cache_creation_input_tokens` / `cache_read_input_tokens` で効果計測可能
- bot 側で明示的に cache を制御するインタフェースは無いが、**prompt 組み立て方とセッション運用で cache ヒット率を最大化できる**

**Phase 2.5 で意識する 4 方針**:

1. **CLAUDE.md の安定化** — `~/companion/CLAUDE.md` / `~/companion/bot-workspace/CLAUDE.md` は頻繁編集を避ける。CLAUDE.md 変更は cache miss を生む。大規模編集は計画的に、編集前にユーザー判断点として明示
2. **prompt prefix の安定化** — `bot.py` が prompt を組み立てる際、prefix (system instructions / 約束事) は session 内で固定する。動的部分 (今日の日付 / 直近の vault grep 結果など) は prompt 末尾に置く
3. **session 継続を活用** — §1 の `--resume <session-id>` で同一セッションを引き続けることで、jsonl 上のターン累積が cache 候補になる。`/reset` は明示的にユーザーが指示した時のみ (UQ-4.1 案 d 整合、自動 fork なしと整合)
4. **計測と可視化** — ledger.jsonl の `cache_creation_input_tokens` / `cache_read_input_tokens` を集計、§4.6 `/quota` で「キャッシュヒット率」常時表示。Phase 2.5 着手後の実弾運用で目標ヒット率を実測ベースで設定

**Phase 2.5 で意図的にやらないこと** (scope creep 防止):
- 明示的な `cache_control` API 呼び出し (claude CLI 経由ではアクセス不可、SDK 直叩きが必要、Max プラン専有方針と衝突)
- prompt 内容を意図的に「キャッシュフレンドリ」に再構築する事前最適化 (実測ヒット率が低かった時点で再判断、YAGNI)

**実装位置**:
- `claude_runner.py` で prompt 組立時に方針 1-3 を実装 (prefix / suffix の明示的分離)
- `quota.py` で方針 4 のキャッシュメトリクス集計

---

## 5. Web 調査 → Obsidian 保存フロー (researcher P5 採用、Stop フック方式)

**現状の脆さ**: ラリー (「上書きする？別名にする？」「○○と重複しそう、追記する？」) が `--continue` 任せ、session 帰属揺らぎで破綻。

**再設計の 2 段防御**:

### 5.1 ラリーは session 内に閉じ込め

§1 の uuid4 + sessions JSON 永続化で channel 単位に session 固定。確認ラリーは同 session-id 上で必ず完結する (`--resume` で文脈保持)。`--continue` 由来の混在はそもそも起きない。

### 5.2 Stop フックで自動同期 (researcher P5)

`bot-workspace/.claude/settings.json` の hooks セクション:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/companion/web/scripts/vault-sync-from-transcript.sh"
          }
        ]
      }
    ]
  }
}
```

`vault-sync-from-transcript.sh` (新設、`~/companion/web/scripts/`):
- 入力: stdin JSON で `transcript_path` を受け取る
- 処理: JSONL を読み「Web 検索 + summary」型 (frontmatter `style: reference` 等) を検出 → 重複チェック (`notes/` を grep) → `notes/<YYYY-MM-DD>_<slug>.md` 書き出し → git add + commit
- push は手動 (`permissions.ask` の 1 回承認通過時のみ)

### 5.3 書き込み境界の二重防御 (T8 先行対応)

- bot.py 側で `--allowedTools` ハードコード渡しは **廃止**、`bot-workspace/.claude/settings.json` に一本化
- `additionalDirectories` を `~/companion/vault` 限定、`Edit/Write(/home/miho/companion/vault/notes/**)` のみ allow、他エリア (`aidiary/`, `clips/`, `inbox/`, ルート, `templates/`, `.obsidian/`, `CLAUDE.md` 等) は ask or deny
- `git push` は permissions.ask で人手承認を維持

### 5.4 vault git の並行制御 (devil W4)

```python
vault_lock = asyncio.Lock()  # bot プロセス内、git pull → push の排他
```

`claude_lock` (claude プロセス起動の直列化) とは責務分離。配置: `bot/vault_ops.py` or `claude_runner` 内。

---

## 6. UX (lead 暫定埋め)

**注記**: 本セクション §6.1〜§6.6 は lead 暫定埋め + UQ-4 ユーザー判断 (2026-05-14) で確定。ux teammate は再 spawn しない (UQ-7 案 3)。Phase 2.5 実弾運用 1-2 週間後のフィードバックループで UX 再検討予定。実弾運用で見直す可能性のある項目と現時点で確定の項目は §6.7 に列挙。

### 6.1 最小コマンド体系 (3 個)

| コマンド | 動作 | 失敗時 |
|---|---|---|
| `/reset` | 現 channel の `SessionMeta` を破棄、次の prompt で新規 uuid4 + 新規 jsonl 発番 | 失敗ケースなし (state JSON への書き込みのみ) |
| `/quota` | 直近 5h 集計 (回数 + 累計 cost) + 本月累計 vs 月次予算 $100 (6/15 まではプレースホルダ) + キャッシュヒット率 (詳細は §4.6) | ledger.jsonl 未存在なら「集計データなし」を返却 |
| `/status` | bot health: 起動時刻、最終 claude 呼び出し時刻、socket listener 状態、現 channel の session_id (uuid4)、最終アクセス時刻 | bot 応答可能時点で常に成功 |

OpenClaw の `/new` `/think` `/verbose` `/trace` `/usage` は 1 ユーザー 1 サーバ運用では過剰、不採用。

### 6.2 セッション境界 UX (UQ-4.1 案 d 確定: 自動 fork 無効、明示 `/reset` のみ)

**基本動作**:
- セッション切替は **明示 `/reset` のみ** (UQ-4.1 案 d)。bot 側で時間経過による自動 fork は実装しない
- 話題切替の自動検出も不採用 (UQ-4.3 案 h)
- 長期放置した古い session を継続するリスクは `/status` で気付ける形でカバー: `/status` 表示の「現 channel の session_id (uuid4) / 最終アクセス時刻」を見てユーザーが必要なら `/reset` する責任分担 (§6.1 既定の延長、追加実装なし)
- ENV 変数 `SESSION_AUTO_FORK_HOURS` は廃止

**設計判断の根拠**:
- ユーザーは claude code でも `/clear` を明示的にかけて運用しており、bot 側でも同じリズムを保つことで「いつセッションが切れたか分からない」状態を排除
- 自動 fork は実装複雑度を増やし、誤切替で文脈消失のリスクを生む。明示制御の方が UX として一貫
- Phase 2.5 実弾運用で `/reset` 発動頻度を実測し、極端に高ければ自動 fork 再検討の判断材料、低ければ明示のみで十分の確証 (§6.7 見直し候補)

### 6.3 調査 → vault 保存ラリー破綻防止 (Stop フック方式)

§5 の通り。`--session-id <uuid>` で session 内にラリーを閉じ込め、bot 側で会話状態を持つ必要なし。

具体的な流れ:
1. user が Discord で「○○調べてノートにして」
2. bot → claude `--session-id <uuid>` で WebSearch + grep 重複チェック
3. claude が重複候補を Discord 返答 (同一 session 内、state 保持)
4. user が「上書き」「別名」「追記」「中止」を Discord で返答 (同一 session、`--resume` で文脈保持)
5. claude が判断確定後に notes/ へ書き込み、Stop フックで `transcript_path` → notes/ Markdown 変換
6. `git add` → `git commit` → `git push` (`permissions.ask` で 1 回 user 承認)

### 6.4 定期通知 UX (既存維持 + catch-up)

既存 maintenance の Unix socket protocol は不変 (D4 確定)。bot 側 catch-up trigger 追加のみ。

**通知文面テンプレート** (現状維持):
- unattended-upgrades: `[YYYY-MM-DD HH:MM] unattended-upgrades 完了 / N 件のアップデート / M 件のセキュリティ修正 / 再起動 要 or 不要`
- system-report: `[YYYY-MM-DD HH:MM] disk: X% / mem: Y MB free / temp: Z°C`

**bot ダウン中の取り扱い** (A-(2) 確定表):
- 過去 log 読取型 (unattended-upgrades): catch-up で復元、user は気づかない
- 時点 snapshot 型 (system-report): 諦め、user に明示せず (STATUS.md にのみ「永久消失」明記)

### 6.5 失敗 UX 一覧

| 失敗種別 | Discord 表示 | bot.log への追加 |
|---|---|---|
| claude timeout (default 300s) | `[timeout 300s] 検索処理が時間内に終わりませんでした。クエリを絞って再試行するか、user 側で別経路を試してください` | timeout タイムスタンプ + session_id + 引数 |
| Web 検索拒否 (permission) | `[permission denied: WebSearch] settings.json に WebSearch が allow されているか確認してください` | stderr verbatim |
| vault push reject | `[push rejected: non-fast-forward] vault repo の最新を確認してください。STATUS.md 失敗リカバリ手順 #1 を参照` | git stderr verbatim |
| gitleaks 検出 | `[secret detected by gitleaks] commit 拒否、ファイル内容を確認してください` | gitleaks 出力 |
| `Error: Session ID ... is already in use` | `[session state mismatch] bot 側 state JSON と claude 側 jsonl が不整合、復旧には /reset または管理者操作が必要` | stderr verbatim + sessions JSON dump |
| その他 (rc != 0 + unknown stderr) | `[claude exited rc=N] (stderr 抜粋 1500 char)` | stderr full |

全失敗ケースで Discord に返す情報量は 1500 char 以下に抑制、詳細は bot.log で見る運用。

### 6.6 Discord 対話シナリオ 5 件

**シナリオ A: 重複なし、通常完了**
```
[user] Tailscale の最新動向調べてノートにして

[bot] 調査開始 (session 8a3f-...)
WebSearch x 4: latest news / acl grants / linux headless / exit node + mullvad
vault grep: 重複候補なし
書き込み先: notes/2026-05-12_tailscale-overview-2026.md
内容を準備して push する直前で確認します。続行で良い？

[user] 続行

[bot] [push pending] git push origin develop の承認をユーザー側で 1 回お願いします
... (Discord 外で承認)

[bot] [completed] notes/2026-05-12_tailscale-overview-2026.md (commit a1b2c3d4) push 完了
```

**シナリオ B: 部分類似、追記/新規ラリー**
```
[user] VOICEVOX のエンジンを最新まで調べて

[bot] 重複候補発見: notes/2026-05-09_voicevox-engine-cpu-and-recent-trends.md (3 日前)
追記する? それとも別ノートとして新規にする?

[user] 別ノートで

[bot] 新規 notes/2026-05-12_voicevox-engine-2026.md に書き込みます
... (シナリオ A と同じ完了フロー)
```

**シナリオ C: 同名完全一致、上書き/別名ラリー**
```
[user] Tailscale を調べてノートにして

[bot] 完全一致発見: notes/2026-05-12_tailscale-overview-2026.md (今日作成)
上書きする? 別名にする? それとも今日のノートに追記?

[user] 別名で

[bot] notes/2026-05-12_tailscale-overview-2026-v2.md に書き込みます
... (完了)
```

**シナリオ D: 定期通知 (unattended-upgrades)**
```
[bot in #通知 channel]
[2026-05-12 09:01] unattended-upgrades 完了
- アップデート: 8 件
- セキュリティ修正: 1 件 (linux-image-generic)
- 再起動: 不要
詳細: ~/companion/logs/maintenance/notify-unattended-upgrades.log
```

**シナリオ E: 失敗 (claude timeout)**
```
[user] AI 業界の最新動向を全部まとめて

[bot] 調査開始 (session 9c4d-...)
... (5 分経過)

[bot] [timeout 300s] 検索処理が時間内に終わりませんでした
クエリ範囲が広すぎる可能性があります。テーマを絞って再試行してください
詳細は bot.log で確認可能
```

### 6.7 実弾運用フィードバックで見直し候補 / 現時点で確定項目

**実弾運用フィードバックで見直し候補** (Phase 2.5 実弾運用 1-2 週間後、UQ-7 案 3 に従いユーザー観察で再判断):
- 6.5 失敗 UX 表の文面細部 (テキストが Discord で読みやすいか)
- 6.6 シナリオの細部 (5 シナリオで足りるか、追加・拡張あり)
- §4.6 /quota 表示の情報密度 (どの行が頻繁に参照されるか実測)
- /reset の発動頻度 (高ければ自動 fork 再検討の判断材料、低ければ明示のみで十分の確証)
- キャッシュヒット率の目標値 (実測してから ENV 化するか判断、現状は表示のみ)

**現時点で確定項目** (UQ-4 / UQ-7 / UQ-10 ユーザー判断確定、当面 revise しない):
- 6.1 最小コマンド体系 3 個 (`/reset` `/quota` `/status`)、UQ-4.4 案 k
- 6.2 セッション境界: 明示 `/reset` のみ、自動 fork なし、話題切替自動検出なし (UQ-4.1 案 d + UQ-4.3 案 h)
- 6.3 Stop フック方式によるラリー破綻防止
- 6.4 既存 maintenance 通知維持 + catch-up
- 6.5 失敗 UX の **種類**
- デフォルトモデル Sonnet 4.6 固定、`/model` コマンド非提供 (UQ-10、§1.7 で確定)

---

## 7. 定期通知 (maintenance/) — socket 不変 + bot 起動時 catch-up 発火

### 7.1 socket プロトコル不変 (D4)

`maintenance/lib/notify.sh` + systemd timer 構成は健全 (2026-05-09 健全性チェック `Result=success`)。インタフェースを変える ROI 無し。bot.py 側のリスナーを `notify_listener.py` に切り出すのは内部リファクタで、socket protocol は不変。

### 7.2 bot 起動時 catch-up + 諦め線 (A-(2) 確定表)

| タスク種別 | 例 | catch-up 復元可能性 | Phase 2.5 採用 |
|---|---|---|---|
| 過去 log 読取型 | unattended-upgrades (ログから状態を組み立て) | **復元可能** (catch-up 発火 → 既存 state_matches で自動復元) | catch-up 採用、既存スクリプト無変更 |
| 時点 snapshot 型 | system-report (df/free/sensors の現時点値) | **復元不可能** (過去 snapshot 記録なし、catch-up は「現時点」を 1 回送るのみ) | **諦め線採用**、STATUS.md に「bot ダウン中の system-report は永久消失」明記 |
| イベント駆動型 | bot 内エラー (将来想定) | 揮発、復元不可 | 諦め、別途設計時に検討 |

**責任所在**:
- 復元可能性はタスク本質を知る maintenance 側で判断 (既存 `state_matches` で冪等性確保)
- bot 側は共通基盤の catch-up trigger のみ
- snapshot 保存案 (`.state/snapshots/`) は YAGNI で**不採用**

**bot 側実装** (`bot/companion-bot.service` の `[Service]` 追加):
```ini
ExecStartPost=systemd-run --user --on-active=15s --unit=companion-bot-catchup-unattended-upgrades companion-notify-unattended-upgrades.service
ExecStartPost=systemd-run --user --on-active=15s --unit=companion-bot-catchup-system-report companion-notify-system-report.service
```

bot 起動完了 (= socket listen 開始) の **15 秒後** に 1 回だけ各 maintenance script を発火 (race 回避マージン)。

### 7.3 補強策

健全性チェックに「期間中の通知 skip 件数を `~/companion/logs/maintenance/*.log` から集計、うち永久消失分を別カウント」を必須項目化 (PROJECT.md 健全性チェックセクション更新)。

---

## 8. ディレクトリ構成と PROJECT.md / Phase 再定義

### 8.1 ディレクトリ構成

```
~/companion/
├── CLAUDE.md                   # NEW: 共通項 + 対症療法 2 周目ルール
├── bot/
│   ├── bot.py                  # 既存リファクタ
│   ├── config.py               # NEW
│   ├── claude_runner.py        # NEW
│   ├── sessions.py             # NEW
│   ├── notify_listener.py      # NEW
│   ├── quota.py                # NEW
│   ├── sessions/               # NEW: channel↔session_id JSON (gitignore)
│   └── docs/STATUS.md
├── bot-workspace/              # NEW: bot 専用 CWD
│   ├── CLAUDE.md               # Discord 経由セッション固有
│   └── .claude/settings.json   # bot 用 permissions
├── workspace/                  # 手元 claude code 用 (既存維持)
│   ├── CLAUDE.md               # 手元固有のみ
│   └── .claude/settings.json
├── vault/, maintenance/, web/, logs/  # 既存維持
```

### 8.2 PROJECT.md / Phase 再定義 (UQ-3 案 R 確定: Phase 2.5 新設)

- **Phase 1 / 2 / 3-1 の Done 履歴は維持** (消さない、巻き戻しじゃない)
- **Phase 2.5「土管の耐久化 (再設計)」を新設** (UQ-3 案 R 確定、2026-05-14)。本 design.md の実施物をぶら下げる。Phase 1 Done と再設計を時系列で読み分ける構造
- Phase 3 残 (3-2 TTS, 3-3 STT, 3-4 browser) と Phase 4 着手条件は不変

**Phase 2.5 サブタスク分割** (UQ-9 案 k 確定、依存順序):

| サブタスク | 内容 | 対応 § |
|---|---|---|
| T-0 | claude CLI 2.1.140 で S1-S5 全シナリオ再検証 (前提条件) | §1.5 / §10.4 |
| T-A | bot 専用 CWD 分離 + sessions JSON | §1 / §8.1 |
| T-B | ClaudeRunner 抽象 | §3.1 |
| T-C | Stop フック + vault 同期 | §5 |
| T-D | rate-limit / クレジット消費 + /quota コマンド | §4 |
| T-E | catch-up + CLAUDE.md 3 層分割 | §7.2 + §1.2 |

依存順は T-0 → T-A → T-B → T-C → T-D → T-E。T-0 は CLI バージョン up 時の再検証 (`~/companion/CLAUDE.md` ルール + §10.4) を独立サブタスクとして切り出したもの、結果を `bot/docs/STATUS.md` に記録してから T-A 着手。

- T-D は **2 段階**: Phase 2.5 着手時に BudgetGuard 抽象 + RequestsCountGuard 実装 (T-D 前半、2026-05-14)、続いて CreditBudgetGuard 実装を追加 (T-D 後半、UQ-8 案 iv 整合、§4.2 第 2 期)。元案では T-D 後半を 2026-06 上旬実施としていたが、bot 実装本体は ledger 累計で完結する設計のため voice/ 側前倒し完了後の空白期間活用 + user 確認で 2026-05-19 即時前倒し有効化に変更
- prompt キャッシュ計測 (§4.8 方針 4) は T-D 内で扱う
- prompt キャッシュ運用 (§4.8 方針 1-3) は T-B (ClaudeRunner) と T-E (CLAUDE.md 3 層) に跨がる、両サブタスクで意識して実装

1 サブタスク = 1 commit、companion CLAUDE.md「1 セッション 1 タスク」運用と整合。各 commit で動作確認してから次に進む。

---

## 9. 採用判断と禁止判断

### 9.1 採用パターン (researcher P1-P5、P1 のみ撤回)

- ❌ **P1 deterministic uuid5 撤回** (devil 第四次反証 #1 + lead 訂正): `/reset` UX と本質的に矛盾。回避には reset_count 永続化が要りメリット消失。Jarvis のように `/reset` 概念がない常駐型では成立、companion の Discord UX には不適合。**v0.1.5 当初案 (uuid4 random + sessions JSON 永続化) に戻す**
- ✅ **P2 cron vs Discord 分離**: `run_discord` / `run_oneshot` で関数化 (§1.7)
- ✅ **P3 ANTHROPIC_API_KEY 明示 unset**: subprocess env で API キー誤混入を排除 (§1.6)
- ✅ **P4 --output-format json 集計で /quota**: `total_cost_usd` / `usage.*` を ledger 化 (§4.6)
- ✅ **P5 Stop フックで vault 自動同期**: ラリーは session 内に閉じ込め、出力 transcript を Stop フックで notes/ に書き出し (§5)

### 9.2 禁止パターン (N1-N4)

- ❌ **N1 OpenClaw Gateway**: Anthropic API 直叩き前提、Max 非対応、Inspiron 3521 には過剰 (3 層構成)
- ❌ **N2 Jarvis の `@anthropic-ai/claude-agent-sdk` 全面移行**: API key 必要化のリスク、Max 専有方針と衝突
- ❌ **N3 PicoClaw ContextManager の Python 移植**: `--session-id` で claude CLI 側に委譲すれば不要、車輪再発明
- ❌ **N4 `--bare` モード** (devil 第七次 + lead 警告): Max プランは OAuth 認証 → `--bare` は `ANTHROPIC_API_KEY` 必須で使用不可。bot.py は明示的に `--bare` を使わない。将来デフォルト化リスクは §1.8 #5 で watch

### 9.3 採用判断の理由

- **session-id 固定 vs --continue 継続**: `--continue` は CWD 単位グローバル状態で混在が必然。`--session-id` + `--resume` は bot が状態を持てる唯一の手段
- **bot 専用 CWD 分離 vs settings ファイル分離だけ**: settings 分離だけだと `--continue` 問題が残る。CWD 分離が前提なら settings 分離は副次的にタダで付いてくる
- **bot.py 全書き換え vs 部分分解**: 全書き換えは Phase 2 動作中のリスク大、部分分解採用
- **API キー導入 vs Max プラン専有**: ユーザー宣言「Max プランのみ」絶対
- **MCP / skills 導入 vs CLI 引数だけ**: 1 ユーザー 1 サーバ運用には CLI 引数 (`--session-id`, `--resume`, `--allowedTools`, `--output-format json`) で十分。MCP は Phase 4 で必要になった時点で再判断
- **OpenClaw 風 Gateway+プラグイン**: 1 ユーザー運用には過剰、採用しない

---

## 10. メタ運用ルール (lead 引き取り、`~/companion/CLAUDE.md` に明文化)

### 10.1 対症療法 2 周目で必ず一段引いて再設計 (devil 罠 T10)

- 同一バグ・同一機能で 2 度目のパッチ (stderr マッチ追加 / try/except 追加 / フォールバック条件追加など) を入れる前に、設計仕切り直しを proactive に提案する
- 3 周目を勝手に打たない
- 設計プロセスへの提言は lead 経由で運用ルールに昇格 (本文書がその昇格行為)

### 10.2 stderr マッチ / fallback リトライ全面禁止 (approve 判定 #7)

- 「stderr 文言で挙動分岐」「`rc != 0` での自動 fallback リトライ」「ErrorKind enum でのリトライ判定」は禁止
- subprocess 呼び出しは **1 prompt = 1 回が原則**
- 振り分けは bot 側 sessions JSON の flag 引きだけで決める
- 2026-05-09 の `_is_no_prior_session` フォールバックを構造的に再生産しないための核 (堂々巡り原因 #4)

**`_STDERR_PATTERNS` 3 件目追加時の判定基準 (2026-05-20 軸 5 M-6 追加、devil M-5 採用)**:

- 現状 2 件 (`NO_PRIOR_SESSION` / `SESSION_ALREADY_IN_USE`) は claude CLI 自体の構造的必要文言、対症療法ではなく state 引き不可能な分類用
- **3 件目を追加する修正提案が来たら、対症療法 2 周目認知で停止、設計仕切り直し議論を起動** (CLAUDE.md「2 周目で取る行動」#1 厳守)
- 先に問うべき: 「sessions JSON の state を引いて 1 回で決められないか」「`--resume` 前の sessions.load() 結果と subprocess rc の組み合わせで判定できないか」
- claude CLI バージョン up 時に既存 2 件の stderr 文言が変わった場合は **再検証ルール** (§10.4) で stderr マッチ廃止可能か (state 引きで完結可能か) を再点検してから 3 件目を追加判断 (Anthropic 側 error message 変更リスク、claude CLI 2.1.140 → 2.1.145 のような無記録 up と接続)

### 10.3 ErrorKind enum はエラー分類専用 (approve 判定 #8)

- ErrorKind 値で `if/elif` 分岐してリトライ・自動回復を実装しない
- 回復は state 引き or user 介入のいずれかで決定
- enum はユーザー通知文面 / 状態ログ / error reporter 分類専用

### 10.4 claude CLI up 時の再検証 (D6 + B 妥協 #5)

claude CLI バージョン up 時、`bot/docs/STATUS.md` の運用ルールに従い以下を再走:
- F 検証 3 シナリオ (S1-S3)
- encoded-cwd 規則
- stderr 文言
- `claude -p --help` で `--bare` デフォルト動作変更の確認

検証結果を STATUS.md に「claude CLI version + 検証日 + 結果」として追記してから本番投入。

---

## 11. 検証項目

### 11.1 公式仕様で確定済 (researcher 公式 doc 確認)

- ✅ a: CLAUDE.md auto-discovery 親階層遡上、CWD 近いほど後勝ち
- ✅ b: `--session-id` の JSONL 保存先は CWD で決まる、`--list-sessions` は存在しない
- ✅ c: Max クォータ外部取得手段なし、`claude /usage` 相当 CLI も存在しない、`total_cost_usd` は Max でも値取得可 (S5 実測 0.06805275)

### 11.2 `--help` で確認済 (claude 2.1.138 ローカル CLI 出力)

- ✅ `--session-id <uuid>` 存在、UUID 制約
- ✅ `-r, --resume [value]` 存在、`-p` 併用で picker 出ない
- ✅ `--fork-session` 存在 (UQ-4.1 案 d 確定で当面未使用、明示 `/reset` のみ運用)
- ✅ `--max-budget-usd` は API key users only、Max プラン非対応
- ✅ `--output-format stream-json` 存在、`--include-partial-messages` でリアルタイム出力長監視可能
- ✅ `--bare` の挙動: hooks / LSP / plugin sync / auto-memory / keychain reads / CLAUDE.md auto-discovery を skip + `CLAUDE_CODE_SIMPLE=1`
- ✅ `--no-session-persistence` は `--print` 専用、`--resume` と非両立
- ✅ `--exclude-dynamic-system-prompt-sections` は cwd/env/memory/git status を first user message に移すフラグ

### 11.3 実機で確認済 (claude 2.1.138)

§1.5 参照 (S1-S5 全シナリオ確認済、encoded-cwd 規則 `/` → `-` 実測)。

### 11.4 Phase 2.5 内検証 (実装着手後)

- [ ] **bot-workspace ↔ workspace 2 CWD 並行運用で jsonl が分離される** ことの実機確認 (devil W1)。期待: `~/.claude/projects/-home-miho-companion-bot-workspace/` と `~/.claude/projects/-home-miho-companion-workspace/` に別々の jsonl 生成、混在なし
- [ ] bot-workspace と workspace で別 settings.json が独立に読まれることの確認
- [ ] claude jsonl の GC タイミング (保存期間、自動削除の有無) — B 妥協策の fragility 評価
- [ ] systemd user service の `Restart=always` 挙動 (claude 子プロセスの SIGTERM 30s timeout 中の socket 状態)
- [ ] systemd `ExecStartPost=systemd-run --on-active=15s` の catch-up 発火タイミング (bot 起動完了 = socket listen 開始の 15 秒後)
- [ ] permission allow と OWNER 認可の組み合わせ (regression test: OWNER 以外の Discord user が DM/mention した時に沈黙)
- [ ] Max プラン 5h cycle 境界跨ぎの長時間 prompt 挙動
- [ ] vault git push reject 時の Discord 通知 → ユーザー指示待ち UX

### 11.5 CLI up 時の継続監視

- [ ] `claude -p --help` の release note / CHANGELOG で `--bare` のデフォルト動作変更がないか必須確認
- [ ] Max プラン環境で `claude -p --bare "..."` を 1 回叩いて `ANTHROPIC_API_KEY not set` 系のエラーが返ることを実機確認 (OAuth 認証の依存確認、副作用なし)

---

## 12. devil 反証反映履歴 (要約)

devil は 7 phase の attack で本設計を補強した。要点:

| phase | 主な指摘 | 反映先 |
|---|---|---|
| 1 (A-G) | 7 原因の整理、session lost 通知、rate-limit framing、CLAUDE.md drift、責務分解の logical 変更明示、F 実機検証要請 | §1, §3, §4, §10 |
| 2 (A-(2)/D/B/C) | maintenance 永久消失 catch-up、`--add-dir` ≠ auto-discovery 訂正、jsonl stat 妥協 4 条件、C 自衛 framing | §7, §1.2, §1.8, §4.1 |
| 3 (W1-W6 researcher 弱点転用) | F の 2 CWD 検証、Jarvis 数値 ToS グレー、Jarvis SDK 移行先例 (W3)、vault git lock、`.env` 触らず env.pop | §3.1, §3.3, §4.2, §1.6 |
| 4 (致命 #1/#2) | deterministic uuid5 + `/reset` 不整合 (撤回)、3-state (a) リトライ反パターン禁止 | §1.3, §1.4, §10.2 |
| 5 (ErrorKind 境界 / ux 注記) | ErrorKind enum はエラー分類専用、ux 着で revise 明示 | §3.2, §10.3, §6.7 |
| 6 (確認 1/2) | 判定 #8 ErrorKind リトライ判定外、解釈 A (ux なし approve → ux 着 revise) | §10.3, §6 冒頭 |
| 7 (`--bare` warning) | 将来 `-p` のデフォルトが `--bare` 化された時の無音破綻、B 妥協 #5 追加、N4 不採用 | §1.8 #5, §9.2 N4, §10.4 |

**lead judgment ミスの訂正記録**: phase 5 で lead は researcher P1 (deterministic uuid5) を採用しろと architect に push したが、devil の致命 #1 反証で `/reset` UX 不整合が露呈、即訂正。devil の鋭い反証が v0.2.2 確定前に介入できた。

---

## 13. approve 判定 8 項目 (B は 4+1 条件) 読み合わせ結果

| # | 項目 | 結果 | 反映箇所 |
|---|---|---|---|
| 1 | F 実機検証反映 | ✅ | §1.5 S1-S5 |
| 2 | B 回復ポリシー + 妥協 4+1 条件 | ✅ | §1.8 (#1 CLI pin / #2 up 再検証 / #3 outsourcing / #4 encoded-cwd 実機 / #5 `--bare` watch) |
| 3 | D `~/companion/CLAUDE.md` 新設で確定 | ✅ | §1.2 + researcher a 公式根拠 |
| 4 | A-(2) catch-up + 諦め線確定表 | ✅ | §7.2 3 分類 + 責任分担 |
| 5 | UX 反映可能状態 | ✅ | §6 (lead 暫定埋め + ux 着 revise 候補明示) |
| 6 | ClaudeRunner SDK 耐性抽象 (W3) | ✅ | §3.1 ClaudeOptions / ClaudeResult / ErrorKind |
| 7 | stderr マッチ / fallback リトライ排除 | ✅ | §1.4 + §10.2 |
| 8 | ErrorKind enum リトライ判定外 | ✅ | §3.2 + §10.3 |

---

## 14. Phase 2.5 着手前のユーザー判断項目 (2026-05-14 全項目回答完了)

`questions.md` 末尾の「回答サマリ」に全 13 サブ項目 (UQ-1〜UQ-10、UQ-4 は 4 サブ) の確定内容を集約済。**Phase 2.5 着手可能** (UQ-8 案 iv: 即着手 + クレジットベース移行可能な抽象で組む)。

主な確定内容 (詳細は questions.md 参照):

| UQ | 確定 | 反映先 |
|---|---|---|
| UQ-1 | workspace settings から WebSearch/WebFetch を剥がす | §2 |
| UQ-2 | Phase 2.5 で CLI usage 機能継続監視、実現不可なら早期切り | §4.5 |
| UQ-3 | PROJECT.md に Phase 2.5 新設 | §8.2 |
| UQ-4 | 自動 fork 無効、最小 3 コマンド (/reset /quota /status) | §6 |
| UQ-5 | 2026-06-15 新クレジット制 ($100/月) 移行確定、ToS 明示許諾範囲内 | §4 全体 |
| UQ-6 | `.env` に ANTHROPIC_API_KEY 行なし (env.pop と二重に安全) | §1.6 整合 |
| UQ-7 | ux teammate 再 spawn せず、実弾運用 1-2 週間後フィードバックで再検討 | §6 注記 |
| UQ-8 | 即着手 + rate-limit はクレジットベース移行可能な抽象 (案 iv) | §4.2 |
| UQ-9 | T-A → T-B → T-C → T-D → T-E サブタスク分割 | §8.2 |
| UQ-10 | prompt キャッシュ設計 + デフォルトモデル Sonnet 4.6 固定 | §4.8 / §1.7 |

---

## 15. 本設計の射程外 (Phase 2.5 で意図的にやらないこと)

**設計境界 (運用面)**:
- 手元 `claude code` セッションの監視 / 予算協調
- Anthropic Console 累計使用量の自動取得手段 (= Anthropic 提供の usage 照会経路、API キー API ではない)。2026-05-14 時点で公式提供なし、UQ-2 案 P で 6/15 以降の release note 継続監視、提供されたら即時取り込み。bot 実装本体は ledger 累計で完結するため照会手段の有無は無関係
- `claude /usage` 相当 CLI 提供の獲得 (researcher c 確定: 2026-05-14 時点で存在しない、UQ-2 案 P で監視継続)
- 長期セッションの「圧縮」(Jarvis session-handoff + injectedSummary)、必要が出たら Phase 3/4 で検討

**UX 拡張 (UQ-4 / UQ-10 確定で射程外)**:
- `/model` コマンド (UQ-10 確定、Sonnet 4.6 固定、変更時は `ClaudeOptions.model` 編集で対応)
- 話題切替の自動検出 (UQ-4.3 案 h 確定)
- 時間経過による session 自動 fork (UQ-4.1 案 d 確定)

**prompt キャッシュ拡張 (§4.8 確定で射程外)**:
- 明示的な `cache_control` API 呼び出し (claude CLI 経由ではアクセス不可、SDK 直叩きが必要、Max プラン専有方針と衝突)
- prompt 内容のキャッシュフレンドリ事前最適化 (実測ヒット率が低かった時点で再判断、YAGNI)

**実装基盤 (規模 / 性能で射程外)**:
- MCP server 独自実装 (1 ユーザー 1 サーバ運用には過剰、Max プラン単独利点を毀損)
- 会話履歴を SQLite/JSON に大規模永続化 (uuid4 + sessions JSON で揮発容認、再起動で channel state 失われたら新規発番ルートで自然回復)
- bot を Go / Rust で書き直す (discord.py が問題になっている事実なし、性能最適化先送り)
- claude プロセスをデーモン化 (CLI が daemon mode 未サポート、tty/pipe バッファ問題)
- bot を「土管」以外に拡張する (ロギング / バリデーション / hook / workflow を bot.py に詰める)

将来必要が出てきた段階で別途設計判断。

---

**承認日**: 2026-05-12 (v0.2.2 plan approve)
**questions.md 反映日**: 2026-05-14 (v0.2.3 へ)
**lead**: team-lead@companion-redesign
**承認方法**: agent teams で companion-redesign team を立ち上げ、architect / devil / researcher / ux (反応無し、lead 暫定埋め) の 4 teammate と議論、devil 7 phase の attack を経て v0.2.2 plan を判定 8 項目で読み合わせて approve

**改版履歴**:
- v0.2.2 (2026-05-12): agent teams 議論 + devil 7 phase 反証反映で approve
- v0.2.3 (2026-05-14): questions.md 全項目回答 (UQ-1〜UQ-10) 反映、§2 / §1.7 / §3.1 / §4 全面書き換え / §6 / §8.2 / §14 / §15 を確定形に更新
- v0.2.3 (2026-05-14, レビュー反映): code-reviewer 指摘の修正必須 2 件 (§11.2 `--fork-session` 表現 / §4.1 ToS 表現) + 軽微提案 α (§3.1 cache フィールド名 JSON キー一致) / β (§4.2-§4.6 切替軸 ENV master 明示) / δ (§1.6 末尾に UQ-6 確認結果追記) を反映
