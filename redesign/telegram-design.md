# telegram-design.md — companion-bot Telegram 移行設計確定版

最終更新: 2026-05-27 (Phase 2.5 観察打ち切り + cold cut 前倒し改訂)
status: **設計確定 (plan_approval 完了)**、**cold cut 2026-05-27 実施 (lead 単独判断で前倒し、§9.1 改訂参照)**

## 0. 本書の位置付け

companion-bot を Discord から Telegram supergroup (topic = 1 session model) に移行する設計の center of truth。`companion-telegram-migration` agent team による mesh + lead approve 完了版を転記。

転記元:
- `~/.claude/plans/companion-telegram-migration/architect.md` (Round 2.1.1、992 行)
- 同 `ux.md` (Round 2.3、852 行)
- 同 `devil.md` (v1.0.8、530 行過)

→ team cleanup (shutdown_request → TeamDelete) で上記 plan ファイルは削除される。本書は永続成果物として lead 集約フェーズで作成 (CLAUDE.md 落とし穴 §F「保存したい情報は必ず lead 成果物に転記」原則)。

## 1. 移行の前提

| 項目 | 値 |
|---|---|
| 移行対象 | `~/companion/bot/` 配下の Discord bot 全体 (~1,170 行) |
| Discord 依存集約箇所 | `bot.py` (~220 行書き直し)、`claude_runner.py` / `quota.py` / `sessions.py` 等 ~900 行は platform-agnostic で再利用 |
| 移行戦略 | **cold cut** (並行運用しない、N-T2 違反禁止) |
| 切替日 | **2026-06-02 以降** (Phase 2.5 健全性 2 週間観察 5/19-6/2 完了後に開始、N-T3 違反禁止) |
| OWNER 認可 | `from_user.id == OWNER_ID` 単一、privacy mode off (起動時 `can_read_all_group_messages` 確認 → False なら `sys.exit(1)`) |
| 音声チャネル | 不使用 (voice message ネイティブ機能も Phase 3-2 punt) |
| モバイル中心 | OWNER (miho) は Android (Pixel-6) Telegram クライアントで片手操作 |

user 前提確認済: 「supergroup topic で確定」(2026-05-27 AskUserQuestion 実施、他選択肢 = Telegram private chat / Slack / Matrix / Signal Group / remote-design v1.0 PWA 拡張 では「topic で分けたい」要件を満たせない)。

## 2. supergroup topic ↔ session 帰属モデル

### 2.1 採用キー = `(chat_id, thread_id)` 複合キー

session ファイル path:
```
~/companion/bot/sessions/
├── topics/
│   ├── -1001234567890_2.json       # supergroup chat_id, thread_id 2 (#chat)
│   ├── -1001234567890_5.json       # supergroup chat_id, thread_id 5 (#research)
│   └── -1001234567890_general.json # General topic (thread_id = None → '_general' 固定 suffix)
├── channels/                        # 旧 Discord (cold cut 後に .archive/ へ rename)
└── ledger.jsonl                     # quota 記録 (`channel_id` field → `topic_key` (str) として読み替え)
```

### 2.2 SessionMeta schema

```python
@dataclass
class SessionMeta:
    chat_id: int            # supergroup chat_id (負値)
    thread_id: int | None   # forum topic id、None = General
    session_id: str         # uuid4 random
    created_at: datetime
    last_used_at: datetime
    prompt_count: int
    last_prompt_at: datetime | None
```

旧 `channel_id: int` 撤去、`topic_key()` プロパティで `(chat_id, thread_id)` を露出。

### 2.3 General topic 扱い

- ファイル名 = `<chat_id>_general.json` 固定文字列 (数値 0 衝突回避)
- 運用方針 (ux §1.3): **scratch / システム通知吸収用、運用 session は持たせない**
- コード経路は単一 (ax 観点で「特例 case 増殖」N-T8 回避)

### 2.4 topic 削除時の session 孤立

採用方針 = **手動 rm + `/reset`** (Phase 2.5 と同じ運用負荷)。

`forum_topic_deleted` Update は公式 doc に明示なし、`forum_topic_closed` / `forum_topic_reopened` のみ。bot は削除 event を取得しない。

stale-thread-observation 基準 (devil A6 採用):
- `bot/.state/stale-thread-observations.jsonl` に `No conversation found with session ID` 発生時刻 + thread_id を記録
- 同 thread_id で **1 回** = 許容 (手動 rm で復旧 + `/reset` で新 session)
- **2 回目** = 対症療法 2 周目認定、設計引き直し議論起動

### 2.5 既存 `sessions/channels/` migration = cold cut

1. Telegram 切替日に `sessions/channels/*.json` は **そのまま残置** (rm しない)
2. 新規 `sessions/topics/` ディレクトリ作成
3. 切替 1 週間後に `.archive/channels-pre-telegram/` に rename
4. `ledger.jsonl` は継続 (`channel_id` field を `topic_key` (str) として読み替え)

並行運用 (N-T2) は **絶対採用しない** (claude_lock 分裂 + sessions JSON race + CreditBudgetGuard 月次 $200 経路)。

## 3. Telegram bot framework = python-telegram-bot v22.7

| 軸 | 採用根拠 (PTB v22.7) |
|---|---|
| Telegram Bot API 追随 | 9.5 native support |
| 必須依存 | `httpx` のみ (本体軽量) |
| アーキ | `Application` / `Handler` (discord.py に近く `bot.py` 構造移植コスト最小) |
| Forum topic | `ForumTopic` 型 / `MessageHandler` で `message_thread_id` |
| rate limit | `[rate-limiter]` extra = `AIORateLimiter` 同梱 (per-chat 1 msg/sec 自動) |
| JobQueue | `[job-queue]` extra = APScheduler 統合 (catch-up 経路を Python 側に寄せる選択肢確保) |
| 公式 doc | 厚い (OWNER 1 人運用での保守コスト下げ) |

不採用: aiogram v3 (Router pattern の恩恵薄、JobQueue 同梱なし)。

接続モード = **long polling** (`run_polling()`)。webhook は remote-design v1.0 §2.1 Tailscale Funnel deny ルールと衝突するため不採用 (N-T1)。

## 4. event handler 再構築

### 4.1 ファイル構成

```
bot/
├── bot.py            # PTB Application 起動 / handler 登録 / post_init
├── telegram_io.py    # NEW: chat_id+thread_id 取得 / send_text / chunk(TELEGRAM_MAX=4000)
├── claude_runner.py  # 無改変 (run_discord → run_session_prompt に rename)
├── sessions.py       # schema 2 軸拡張 (§2.2)
├── quota.py          # channel_id → topic_key rename、本体無改変
├── companion-bot.service  # description + ENV 名差し替え
├── .env.example      # DISCORD_TOKEN → TELEGRAM_BOT_TOKEN
└── sessions/
    ├── topics/
    └── ledger.jsonl
```

### 4.2 メッセージ受信 + OWNER 認可 4 段防御

```python
async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    user = update.effective_user
    if user.id != OWNER_ID:           # 段 1: OWNER 認可
        return
    if user.is_bot:                   # 段 2: bot echo 防止
        return
    chat = update.effective_chat
    if chat.type != "supergroup":     # 段 3: chat type
        return
    if chat.id != NOTIFY_CHAT_ID:     # 段 4: 想定外 supergroup 巻き込み防止
        return
    thread_id = msg.message_thread_id  # None for General topic
    prompt = (msg.text or "").strip()
    if not prompt:
        return
    output = await run_claude(prompt, chat.id, thread_id)
    await send_text(context.bot, chat.id, thread_id, output, reply_to=msg.message_id)
```

privacy mode off 起動時確認:
```python
async def post_init(application):
    me = await application.bot.get_me()
    if not me.can_read_all_group_messages:
        logger.critical("privacy mode が ON、bot は全メッセージを受信できません")
        sys.exit(1)
```

OWNER 認可違反は **完全沈黙** (Telegram の構造的利得、Discord ephemeral から脱却、`~/companion/CLAUDE.md` OWNER 原則により忠実)。

### 4.3 メッセージ送信 (chunk1 のみ reply、chunk2-N plain)

```python
TELEGRAM_MAX = 4000  # 公式 4096 から 96 字マージン

async def send_text(bot, chat_id, thread_id, text, reply_to=None, disable_notification=False):
    """確定版 (lead 裁定 = ux 案採用):
    - AIORateLimiter (framework) 委譲で per-chat 1 msg/sec / 429 RetryAfter を吸う、素手 sleep なし
    - chunk1 のみ invoke 元 message へ reply、chunk2 以降は reply なし (連続 chain なし)
      (lead 裁定: mobile UI で reply プレビュー積層を回避、ux 実機検証 D-add-2 根拠)
    """
    pieces = chunk_telegram(text)
    for i, piece in enumerate(pieces):
        kwargs = {"chat_id": chat_id, "text": piece, "disable_notification": disable_notification}
        if thread_id is not None:
            kwargs["message_thread_id"] = thread_id
        if i == 0 and reply_to is not None:
            kwargs["reply_parameters"] = ReplyParameters(message_id=reply_to)
        await bot.send_message(**kwargs)  # AIORateLimiter が rate 制御
```

chunk 境界 = **改行優先** (段落 `\n\n` → 行 `\n` → 文字数固定の順 fallback)。
`parse_mode` = 指定しない (素文字列送信、MarkdownV2 escape は W-6 で永続不採用、HTML mode は Phase 4 でも採用しない)。

### 4.4 slash command (BotCommandScopeChat)

```python
async def post_init(application):
    bot = application.bot
    commands = [
        BotCommand("reset", "現 topic の claude セッションを破棄"),
        BotCommand("quota", "bot 経由 prompt の予算 / 集計を表示"),
        BotCommand("status", "bot 稼働状況 / current session を表示"),
        BotCommand("play", "YouTube URL をこの PC のブラウザで開く"),
    ]
    await bot.delete_my_commands()
    await bot.set_my_commands(
        commands=commands,
        scope=BotCommandScopeChat(chat_id=NOTIFY_CHAT_ID),
    )
```

per-topic 動作: handler 内で `msg.message_thread_id` を読み、`(chat_id, thread_id)` 複合キーで session を引く。OWNER 認可違反は完全沈黙。

### 4.5 Update type allowlist (11 種類、devil A4 採用)

| Update type | 採用 / 不採用 | 採用時の handler |
|---|---|---|
| `message` (非 edit) | ✓ | `on_message` (§4.2) |
| `edited_message` | ✗ (filter で取りこぼし) | なし (W-6 / N-T7、bot 再起動で budget 二重消費回避) |
| `callback_query` | ✓ | inline keyboard 経路 (§7.4) |
| `message_reaction` | ✗ | なし (Phase 3-2 では不採用) |
| `chat_member` | ✗ | なし (bot 自身の参加 event、log のみ) |
| `my_chat_member` | ✗ | なし |
| `channel_post` | ✗ | なし (channel と supergroup の区別) |
| `inline_query` | ✗ | なし (privacy mode off 前提で別経路) |
| `poll` | ✗ | なし |
| `chat_join_request` | ✗ | なし (OWNER 1 人運用) |
| その他 (新規追加) | ✗ | **handler 未登録 = silently drop** (Bot API up 時に再点検、`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」と同方針) |

```python
# filter で edited_message を取りこぼす明示
MessageHandler(filters.UpdateType.MESSAGE & ~filters.UpdateType.EDITED_MESSAGE, on_message)
```

### 4.6 long polling stall 検知 (devil A9 採用)

```python
# bot/health_check.py
async def stall_check_job(context):
    """5 分間隔で getMe() を叩く、連続 3 回 stall で sys.exit(1)"""
    try:
        await context.bot.get_me()
        context.bot_data["stall_count"] = 0
    except Exception:
        context.bot_data["stall_count"] = context.bot_data.get("stall_count", 0) + 1
        if context.bot_data["stall_count"] >= 3:
            await notify_critical(context.bot, "[critical] bot long polling stall 3回、再起動")
            sys.exit(1)
```

systemd `Restart=on-failure` で自動復帰、catch-up 経路で取りこぼし通知を回収。

## 5. socket 通知差し替え

### 5.1 ENV 設計 (lead 裁定 = ENV 維持)

旧:
```
NOTIFY_CHANNEL_ID=1501135177223508081   # Discord text channel
```

新:
```
NOTIFY_CHAT_ID=-1001234567890       # supergroup chat_id (負値)
BOT_THREAD_ID_CHAT=2                # #chat topic
BOT_THREAD_ID_RESEARCH=3            # #research topic
BOT_THREAD_ID_MAINTENANCE=5         # #maintenance topic (socket forward 先)
BOT_THREAD_ID_VOICE_LOG=            # 空 = MAINTENANCE 落ち (Phase 3-2 追加時に埋める)
```

**再点検 trigger**: Phase 4 で topic が **5+ 個** に増えたら ENV 増殖の対症療法 2 周目認知で設計引き直し議論起動 (ax §1.1 boundary footnote、N-T11 観察項目)。

### 5.2 `_handle_notify` 改修 (ax §6.2 + §8.2 + AIORateLimiter 委譲)

```python
class CompanionTelegram:
    def __init__(self, ...):
        self._notify_queue: asyncio.Queue = asyncio.Queue()

    async def _notify_worker(self):
        """1 worker で順序保証、rate 制御は AIORateLimiter framework に委譲。"""
        while True:
            text = await self._notify_queue.get()
            try:
                is_critical = text.startswith("[critical] ")  # 完全一致 (W-6 上限ルール)
                kwargs = {
                    "chat_id": NOTIFY_CHAT_ID,
                    "disable_notification": not is_critical,
                }
                thread_id = int(os.getenv("BOT_THREAD_ID_MAINTENANCE", "0")) or None
                if thread_id is not None:
                    kwargs["message_thread_id"] = thread_id
                for piece in chunk_telegram(text):
                    kwargs["text"] = piece
                    await self.bot.send_message(**kwargs)  # AIORateLimiter が per-chat 1msg/sec
                logger.info("notify forwarded len=%d critical=%s", len(text), is_critical)
            except Exception:
                logger.exception("notify forward failed")
            finally:
                self._notify_queue.task_done()
```

`maintenance/lib/notify.sh` の I/F **無改変** (lead 指示、socket protocol 不変)。

`[critical]` プレフィクスは **完全一致 1 件のみ** (`startswith("[critical] ")` 半角スペース込み)。`[warning]` `[info]` 等 2 種目が必要になった時点で対症療法 2 周目認定 → 設計引き直し議論起動 (W-6 上限ルール、ux §7.2.1 と同方針)。

### 5.3 catch-up 経路 (Phase 2.5 T-E 継承)

`companion-bot.service` の `ExecStartPost` 2 行は **無改変** (maintenance scripts は socket に流すだけ、Discord/Telegram 区別なし)。

bot 起動 + 15 秒で catch-up 2 通 (notify-unattended-upgrades + system-report) が queue 投入 → worker が AIORateLimiter で per-chat 1 msg/sec を守りつつ消化。

## 6. topic 構成 (ax §1.1 採用)

### 6.1 採用構成 (片手モバイル運用前提)

| # | topic | 役割 | session | 通知 default |
|---|---|---|---|---|
| 1 | **General** | scratch / システム通知吸収 | なし (stateless) | 音 ON (致命系のみ) |
| 2 | **#chat** | 既定の `claude -p` 対話 | 専用 1 つ | 音 ON |
| 3 | **#research** | Phase 3-1 Web 検索 → vault push、重複確認ラリー | 専用 1 つ (短命、`/reset` 頻度高) | 音 ON |
| 4 | **#maintenance** | 既存 `companion-notify-*` 系の出口 (`BOT_THREAD_ID_MAINTENANCE`) | なし | **silent default**、`[critical]` のみ音 ON |
| (将来) | #aidiary | Phase 4 想定の日記補助対話 | 予約 | mute |
| (将来) | #voice-log | `/say` invoke 結果 + voice FAIL サマリ | なし | silent default |

initial 4 つ (General / #chat / #research / #maintenance) を Phase 2.5 移行時に作成、#aidiary / #voice-log は **実需が出た時点で手動 topic 追加 + `bot/.env` の `BOT_THREAD_ID_*` 環境変数追記** (YAGNI 原則)。

topic 作成 / 管理は **OWNER の Telegram クライアント側で手動** (bot に `can_manage_topics` 権限を持たせない、whack-a-mole 回避)。

## 7. UX 設計 (ax 領域)

### 7.1 reply / pin / mute

- **reply default ON** (`reply_to_message_id` で invoke 元 message へ reply)、ただし chunk1 のみ (§4.3)
- pin = **bot 自動 pin なし**、user 手動 (Discord にない強み)
- per-topic mute = bot 側からは触らない (`disable_notification` で送信側抑制、§5.2)

### 7.2 voice message ネイティブ機能

Phase 3-2 では **入出力経路ともに実装しない** (`voice-design.md:48` text-only `/say` 維持)。Phase 3-3 STT 着手時に再評価。

### 7.3 通知制御 (`disable_notification` 振り分け)

| 用途 | topic | disable_notification | 理由 |
|---|---|---|---|
| `/say` `/play` `/reset` `/quota` `/status` followup | invoke 元 | false (音 ON) | 能動操作の応答、即時 ack |
| claude 通常対話返答 | invoke 元 | false | 対話継続性 |
| catch-up 通知 | #maintenance | **true (silent)** | 起動時バースト、user 注意割り込み回避 |
| 通常 maintenance 通知 | #maintenance | **true (silent)** | unattended-upgrades / system-report は受動情報 |
| 致命系通知 (`[critical]` プレフィクス) | #maintenance | false (音 ON) | reboot 必要等、actionable |

判定責務 = maintenance スクリプト側で `[critical] ` プレフィクスを付ける (state を持つ側で 1 回決定原則)。

### 7.4 重複確認フロー (Phase 3-1 vault push)

採用 = **inline keyboard 4 ボタン** (上書き / 別名で / 追記する / 中止)。

sentinel パターン (`[CONFIRM_VAULT_DUPLICATE]` 完全一致のみ):
- claude session 出力 last line が sentinel なら bot 側で inline keyboard 組み立て + 送信
- `callback_query` 受信 → 応答テキストを claude session に prompt 再投入 (`--resume <session_id>` で文脈保持)
- **sentinel 種別は 1 種限定**、2 種目要求が出た時点で対症療法 2 周目認定 → 設計引き直し議論起動 (W-6)
- `startswith('[CONFIRM_')` 等 prefix マッチ拡張は明示禁止 (完全一致のみ許容)

reply button (`ReplyKeyboardMarkup`) 不採用 (zombie keyboard 化リスク、ax §7.3)。

### 7.5 edit event 取り扱い

`edited_message` Update は **完全無視** (W-6 / N-T7 filter で物理取りこぼし)。

OWNER が typo 修正したい時は **新規 message 送信** で運用 (`bot-workspace/CLAUDE.md` に明文化)。

vault sync (`vault-sync-from-transcript.sh`) は claude transcript 内のターンしか見ない、Telegram message edit と独立 (W-3)。

## 8. ENV / systemd / requirements

### 8.1 `.env.example`

| 旧 | 新 |
|---|---|
| `DISCORD_TOKEN=` | `TELEGRAM_BOT_TOKEN=` (BotFather から取得) |
| `OWNER_ID=` | (維持、Telegram user.id、`https://t.me/userinfobot` で取得) |
| `NOTIFY_CHANNEL_ID=` | `NOTIFY_CHAT_ID=-100...` + `BOT_THREAD_ID_*` |
| `CLAUDE_BIN=`, `CLAUDE_CWD=`, `CLAUDE_TIMEOUT=` | 全維持 |
| `BOT_BUDGET_GUARD=credit_usd` | 維持 |
| `BOT_MONTHLY_CREDIT_USD=100` | 維持 |

### 8.2 `companion-bot.service`

```diff
-Description=Companion Discord bot (bridges Discord to `claude -p`)
+Description=Companion Telegram bot (bridges Telegram supergroup to `claude -p`)
```

それ以外 (`Environment` / `ExecStart` / `ExecStartPost` / `Restart` / `[Install]`) は **完全無改変**。

### 8.3 `requirements.txt`

```diff
-discord.py>=2.3,<2.4
+python-telegram-bot[rate-limiter,job-queue]>=22.7,<23
 python-dotenv>=1.0,<2.0
```

### 8.4 venv 入れ替え + rollback path (devil A7 採用)

```bash
cd ~/companion/bot
mv venv venv-discord-backup    # rollback path
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

切替 1 週間運用後に `rm -rf venv-discord-backup`。systemd `ExecStart` 無改変、venv 中身だけ swap。

### 8.5 git commit 粒度

1. `bot.py` 全面書き換え + `telegram_io.py` 追加 + `sessions.py` schema 2 軸 + `quota.py` rename + `requirements.txt` + `.env.example` + `companion-bot.service` description = **1 commit** ("migrate Discord to Telegram supergroup topic model")
2. `bot/docs/STATUS.md` 移行 entry + 既存 Phase 1〜2.5 履歴 status 更新 = **1 commit**
3. `sessions/channels/` の archive 移動 (切替 1 週間後) = **1 commit**
4. `run_discord` → `run_session_prompt` 改名 (commit 分離、A8) = **1 commit**

## 9. Phase 2.5 観察 + Phase 4 着手条件 #2 改訂

### 9.1 観察期間中の挙動 (2026-05-27 改訂、当初「絶対遵守」を lead 単独判断で打ち切り)

**(履歴) 当初制約 (絶対遵守)**:
- **2026-05-19 〜 2026-06-02**: Phase 2.5 健全性 2 週間観察期間
- 設計議論のみ (read-only)、`bot.service` / `bot.py` / `bot-workspace/.claude/settings.json` / maintenance 系の挙動変更を伴う commit / push は **禁止** (N-T3)
- cold cut 切替日は **観察期間をまたがない** (devil V-16)

**(2026-05-27 改訂、lead 単独判断)**:
- **Phase 2.5 観察期間を 5/19-5/27 (8 日) で打ち切り**、cold cut 切替を 6/2 → **5/27 当日実施** に前倒し
- 判断根拠: PROJECT.md 健全性履歴「2026-05-27 (追): Phase 2.5 観察打ち切り + Phase 2.6 cold cut 前倒し判断」entry に集約 ((a) 8 日経過実害ゼロ + (b) Phase 4 起点が Telegram 観察 14 日単独判定なので Phase 2.5 短縮は Phase 4 着手スケジュールに影響なし + (c) 実装着手前検証 V-1〜V-25 + V-4/V-5/V-6 実機検証全 pass + (d) user 確認 C 選択 + (e) lead 過剰防御寄り判定)
- N-T3「観察期間中の挙動変更禁止」と V-16「観察期間をまたがない」は本改訂で **解除** (Phase 2.5 観察打ち切り扱い)
- devil 不在の反証経路欠如を lead 自認、Telegram 14 日観察で issue 発覚した場合に事後検証を実施し、次回類似判断時の devil 起動必須化を運用ルール昇格候補 (PROJECT.md S-3「lead 単独責任 vs devil 必須」Round 4 議題)

### 9.2 Phase 4 着手条件 #2 改訂 (PROJECT.md L262 周辺、2026-05-27 (追) で再前倒し)

**改訂方針**:
- Phase 2.5 観察 (5/19-5/27、8 日で打ち切り) は **独立完了** として PROJECT.md 健全性履歴に記録
- Phase 4 着手判定は **Telegram 観察 14 日単独判定** (cold cut 切替日 2026-05-27 起算)
- voice/ 統合は **Telegram 観察 14 日完了後** に着手 (順序原則準拠、N-T14 違反禁止)

タイムライン (2026-05-27 改訂):
1. 2026-05-27: Phase 2.5 観察打ち切り (lead 前倒し、8 日で完了扱い)
2. 2026-05-27: cold cut 切替 (Telegram bot.service 起動)
3. 2026-06-10: Telegram 観察 14 日完了
4. その後: voice/ 統合着手 (bot/ 側)
5. voice/ 統合 +14 日 (2026-06-24 目処): Phase 4 着手条件 #2 充足候補
6. user 自身が Phase 4 着手を明示宣言 (条件 #3) で着手

Phase 4 着手は **2026-06-24 +α 以降** 想定 (当初 6/16 想定から voice/ 統合 +14 日まで含めて再計算)。

## 10. layer 別 platform-agnostic 引き継ぎ可否表

Phase 2.5 観察結果のうち何が Telegram に引き継げて、何が引き継げないかを layer 別に明示 (N-T10「observation reset 隠蔽」予防、devil V-20 採用)。

| layer | 引き継ぎ | 根拠 |
|---|---|---|
| `claude_runner.py` | ✓ | platform 非依存、同 binary を `asyncio.create_subprocess_exec` で起動 |
| `sessions.py` JSON file format + API | ✓ | uuid4 + 永続化 + 単一真実原則は platform 非依存、file path key 表現のみ変更 |
| `quota.py` (BudgetGuard / ledger.jsonl 集計) | ✓ | platform 非依存、ledger.jsonl `channel_id` → `topic_key` 読み替え |
| `CLAUDE.md` 3 層構造 | ✓ | claude CLI auto-discovery は platform 非依存 |
| `.claude/settings.json` (bot-workspace) | ✓ | permission 境界 + additionalDirectories は platform 非依存 |
| systemd unit (Environment / WorkingDirectory / Restart / ExecStartPost) | ✓ | description + ENV 名のみ差し替え |
| `bot.py` event handler | ✗ | Discord SDK ↔ Telegram lib 全置換 (~220 行)、観察 reset |
| `_handle_notify` forward 経路 | ✗ | Discord channel.send → Telegram bot.send_message + queue worker、新実装 |
| catch-up forward 先 | ✗ | systemd 起動部分は引き継ぎ可、forward 先は新実装 |
| vault-sync-from-transcript.sh Stop hook | ✓ | claude transcript 内のターン、Telegram edit と独立 |
| Phase 3-1 vault push 確認ラリー UX | ✗ (UX) / ✓ (vault git pipeline) | UX は inline keyboard に置換、git pipeline 無改変 |
| OWNER 認可方針 | ✓ (原則) / ✗ (実装) | 「OWNER 以外完全無視」原則不変、実装は Telegram 4 段防御 |
| voice/ 側 (`say.sh` / engine / `paplay`) | ✓ | voice CLI は platform 非依存、HDMI 音声と Telegram は独立 |

**結論**: bot.py 自体の安定性 (ERROR 0 件 / NRestarts 0 件) は Telegram 化で **観察 reset**、§9.2 の Telegram 14 日観察で取り直し。

## 11. 採用すべきでない設計 (N-T1〜N-T14 + W-1〜W-6)

### 11.1 罠リスト (N-T1〜N-T14)

| # | 設計 | 反証根拠 |
|---|---|---|
| N-T1 | Telegram webhook 経路 | remote-design v1.0 §2.1 funnel deny、long polling 一択 |
| N-T2 | Discord/Telegram 並行運用 | claude_lock 分裂 + ledger 衝突 + 月次 $200 経路 |
| N-T3 | 観察期間 (5/19-6/2) 中の bot.service 挙動変更を伴う実装着手 | Phase 2.5 観察カウント保護 |
| N-T4 | `_STDERR_PATTERNS` 3 件目追加 (Telegram lib 例外を詰める) | CLAUDE.md 2 周目 + design.md §10.2 M-6 |
| N-T5 | `CLAUDE_TIMEOUT` 4 段階拡張 (Telegram 用 timeout 追加) | design.md §4.7 M-5 |
| N-T6 | sessions JSON キー空間で `channel_id` (Discord) と `chat_id+thread_id` (Telegram) 共存 | キー空間分裂、cold cut 採用 |
| N-T7 | Telegram edit event を「再 prompt」変換する handler | edit case 増殖 = 2 周目 |
| N-T8 | General topic を「特例 case」として落とす設計 | 特例 case 増殖入口、`_general` suffix で第一級扱い |
| N-T9 | privacy mode off の前提を「OWNER 1 人運用」のみで受容 | future 招待 1 件で破綻、4 段防御で多層化 |
| N-T10 | platform-agnostic layer の「観察結果引き継げる」言説で observation reset 隠蔽 | §10 layer 別明示で正面回答 |
| N-T11 | topic 追加を `BOT_THREAD_ID_*` env で扱う設計 | permission whack-a-mole 2 周目、ただし lead 裁定で ENV 採用 + 5+ topic で再点検 trigger |
| N-T12 | library 内蔵 retry + 素手 sleep の二重発火 | AIORateLimiter 一本化 (§4.3) |
| N-T13 | Telegram 採用の正味メリットが inline keyboard 1 件で全土管移行 | user 確定済 (P3 closed)、構造軸として残置 |
| N-T14 | Telegram 観察期間中の voice/ bot 統合並走 | §9.2 順序原則準拠で voice/ は Telegram 観察完了後着手 |

### 11.2 対症療法 2 周目候補 (W-1〜W-6 不採用宣言)

| # | 候補 | 不採用根拠 |
|---|---|---|
| W-1 | `_STDERR_PATTERNS` 3 件目追加 | bot/docs/STATUS.md L112 (1) + design.md §10.2 M-6 明文化済 |
| W-2 | `CLAUDE_TIMEOUT` 4 段階拡張 | design.md §4.7 M-5 明文化済 |
| W-3 | `vault-sync-from-transcript.sh` rc!=0 後処理に Telegram 用分岐追加 | bot/docs/STATUS.md L112 (3) 明文化済 |
| W-4 | sessions JSON キー両対応 | cold cut で物理 case 消滅 |
| W-5 | Telegram lib 例外用の新規 enum (`TelegramErrorKind`) | bot.py 内 try/except + logger.exception で残す、enum 化しない |
| W-6 | sentinel / `[critical]` の prefix マッチ拡張 (`startswith('[CONFIRM_')`) | 完全一致 1 件のみ、2 種目要求は設計引き直し |

## 12. 実装着手前検証項目 (V-1〜V-25 + D-add-1〜D-add-12)

実装着手 (2026-06-02 以降) に必須の追加検証。詳細は `bot/docs/STATUS.md` Phase 2.6 section に転記。

主要項目:
- **V-1**: Telegram Bot API `Update` 全 type 一覧 (公式 docs 数) を取得、§4.5 allowlist を網羅確認
- **V-3**: Bot API changelog 12-24 ヶ月分の breaking change 集計 (`https://core.telegram.org/bots/api-changelog`)
- **V-4**: `message_thread_id` 削除後再利用挙動 (公式 doc 明記 or 実機検証 3 回)
- **V-5**: General topic (thread_id = None or 0) の確定
- **V-6**: `can_manage_topics: false` 時の bot 動作確認 (rc=403 ハンドリング)
- **V-21**: PTB v22 / aiogram v3 maintainer 数 + リリース頻度 + breaking change 履歴
- **V-22**: Telegram Bot API deprecation 履歴
- **D-add-2**: Pixel-6 で reply chain 視認性 user 確認 (案 B 採用後の不採用案倒し直し trigger)
- **D-add-3**: Forum UI deprecation 履歴 12-24 ヶ月分検証
- **AIORateLimiter log level**: PTB v22 公式 doc spot check、`telegram.ext.AIORateLimiter` logger を INFO 以上に設定 (devil V-8「retry を吸って沈黙」回避)
- **Bot API up 時の再点検運用**: `~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」と同方針

## 13. 議論経緯 (mesh + lead 裁定)

### 13.1 plan reject 候補 (R-1〜R-9 経緯)

| # | 内容 | 状態 |
|---|---|---|
| R-1 | 並行運用も視野 | クリア (architect Round 2 §2.5 cold cut 明示) |
| R-2 | webhook 経路検討 | クリア (architect Round 2 §3.3 long polling 採用) |
| R-3 | platform-agnostic layer 別明示なし | クリア (architect Round 2 §12 layer 別表) |
| R-4 | `_STDERR_PATTERNS` 3 件目 | クリア (architect §11.1 不採用宣言) |
| R-5 | `CLAUDE_TIMEOUT` 4 段階 | クリア (architect §11.2 不採用宣言) |
| R-6 | architect 改版履歴と本文の §10/§11/§12 不整合 | devil 自己撤回 (B-2 違反、中間状態誤認、§8.4.1 (1)(2)(3) 運用追加で再発防止) |
| R-7 | voice/ 統合並走 | クリア (architect Round 2.1 §7.2 voice/ 統合 = Telegram 観察 14 日完了後に厳格固定) |
| R-8 | AIORateLimiter + 素手 sleep 二重発火 | クリア (architect Round 2.1 §5.2 framework 委譲 1 層統一) |
| R-9 | cold cut vs 並走管理表記混同 | クリア (architect Round 2.1.1 §7.1/§7.2 冒頭に対象明示) |

### 13.2 lead 裁定 2 件

- **不整合 1 (env vs ファイル管理)**: ENV 採用 (architect 案、OWNER 1 人 + topic 追加頻度低、「state を持つ側で 1 回決定」原則整合、5+ topic で再点検 trigger)
- **不整合 2 (chunk reply)**: ux 案採用 (chunk2 以降 reply なし default、mobile UI で reply プレビュー積層回避)

### 13.3 P3 user 確認結果

「supergroup topic で確定」(2026-05-27 AskUserQuestion 実施)。他選択肢 (Telegram private chat / Slack / Matrix / Signal Group / remote-design v1.0 PWA 拡張) は「topic で分けたい」要件を満たせない。

### 13.4 devil 装置のミッション完了 (運用継承事例)

- A2-A9 (architect 構造的攻撃 9 件、全件 valid + 取り込み): +9
- Issue 1 (§5.3 重複、architect Round 2.1.1 で解消): +1
- Issue 2 (chunk reply、Round 2 時点 valid、Round 2.1 改訂で解消): +1
- R-6 (B-2 違反、自己訂正): -1
- **§8.4.1 (4) 拡張運用** (asynchronous 改訂中の引用 2 回 verify): +1 (構造的価値)

**正味 +11**。lead 認識違い (Issue 2 = 架空攻撃と誤判定) を devil が反証で訂正してくれた事例 = 装置の本来機能 (lead judgment ミス訂正) の典型成功事例。

asynchronous 配信すれ違い 3 度目発生 (architect Round 2.1.1 完了通知 + lead Round 3.1 mini fix 指示の double cross)、agent team の本質的限界として記録 → `workspace/CLAUDE.md` Agent Teams 運用方針 §B / §B-2 に追記候補。

## 14. 実装着手後の運用ルール (lead 集約持ち越し 12 件)

`bot/docs/STATUS.md` Phase 2.6 section に転記:

1. ENV 5+ topic 再点検 trigger
2. stale-thread-observation jsonl 運用 (1 回=許容、2 回=2 周目認定)
3. D-add-2 Pixel-6 reply chain 視認性 user 確認 (案 B 採用後の不採用案倒し直し trigger)
4. AIORateLimiter log level (INFO 以上設定、retry 沈黙回避)
5. Bot API up 時の再点検運用 (新 Update type 検知時の allowlist 再点検)
6. Forum UI deprecation 履歴監視 (D-add-3)
7. venv rollback path (`mv venv venv-discord-backup` + 1 週間運用後 rm)
8. catch-up worker rate 制御 (AIORateLimiter 1 層、素手 sleep 永続禁止)
9. sentinel 種別上限 (1 種限定、2 種目要求は設計引き直し)
10. `[critical]` プレフィクス上限 (完全一致 1 件、2 種目要求は設計引き直し)
11. edit event filter (`edited_message` 完全無視を維持)
12. V-19 新 2 週間観察カウント条文 (PROJECT.md L262 改訂、Telegram 観察 14 日単独判定)
