"""Telegram bot that pipes supergroup-topic messages to `claude -p` and returns the output.

Migrated from discord.py to python-telegram-bot v22.7 in the 2026-05-27 cold
cut. Center of truth: ``~/companion/workspace/redesign/telegram-design.md``.

Design highlights wired in here:
- OWNER 認可 4 段防御 (§4.2): user.id / is_bot / chat.type / chat.id
- privacy mode off 起動確認 (post_init で can_read_all_group_messages 検査)
- chunk_telegram: TELEGRAM_MAX=4000、改行優先 fallback
- send_text: AIORateLimiter (framework) 委譲、素手 sleep なし (N-T12)
- parse_mode = 指定しない (素文字列送信、MarkdownV2 escape は W-6 で永続不採用)
- slash command を BotCommandScopeChat(chat_id=NOTIFY_CHAT_ID) にスコープ限定
- edited_message を filter で物理取りこぼし (§4.5 / N-T7)
- long polling stall_check_job (§4.6) で 5 分 × 3 連続 fail → sys.exit(1)
- `_handle_notify` は asyncio.Queue + 1 worker で順序保証 (§5.2)、`[critical] `
  完全一致のみ disable_notification 反転 (W-6 上限ルール)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from telegram import (
    BotCommand,
    BotCommandScopeChat,
    ReplyParameters,
    Update,
)
from telegram.constants import ChatType
from telegram.ext import (
    AIORateLimiter,
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import quota
import sessions
from claude_runner import ClaudeOptions, ClaudeRunner, ErrorKind

load_dotenv()

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
OWNER_ID_RAW = os.environ.get("OWNER_ID", "").strip()
NOTIFY_CHAT_ID_RAW = os.environ.get("NOTIFY_CHAT_ID", "").strip()
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude").strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", str(Path.home() / "companion" / "bot-workspace")).strip()
CLAUDE_TIMEOUT = float(os.environ.get("CLAUDE_TIMEOUT", "300"))

# 自発発話 (proactive companion messaging) のグローバル on/off。off にすると
# bot 側でも依頼を無視する (script 側ガードと二重防御、env で全停止可能)。
# 出典: ~/companion/vault/notes/2026-05-30_proactive-companion-messaging-design.md
PROACTIVE_ENABLED_RAW = os.environ.get("PROACTIVE_ENABLED", "1").strip().lower()
PROACTIVE_ENABLED = PROACTIVE_ENABLED_RAW in ("1", "true", "yes", "on")

LOG_DIR = Path.home() / "companion" / "logs"
LOG_FILE = LOG_DIR / "bot.log"

# 公式上限 4096 char に 96 char マージン (URL preview / link entity 等の future safety)。
TELEGRAM_MAX = 4000

PLAY_ALLOWED_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
})
PLAY_TIMEOUT_S = 10.0

# `/vault-push`: vault (`~/companion/vault`, branch develop) の commit 済変更を
# GitHub に push する。コマンド送信そのものが push の人手承認の置き換え
# (vault-sync-from-transcript.sh = Stop hook は commit までで止まる設計)。
# bot 自律 push ではなく安全ゲートは保持する。
VAULT_DIR = Path.home() / "companion" / "vault"
VAULT_BRANCH = "develop"
VAULT_REMOTE = "origin"
# push subprocess の hang 上限。BatchMode=yes で対話プロンプトは即 fail するが、
# 通信 stall 等の保険として timeout を併設する。
VAULT_PUSH_TIMEOUT_S = 60.0
# 対話プロンプトでの hang を避けて即 fail させる (agent 未 load / keyring ロック /
# host key 未知などを対話待ちにせずエラーとして表面化させる)。
VAULT_PUSH_SSH_COMMAND = "ssh -o BatchMode=yes"

# stall 検知 (§4.6): 5 分間隔で getMe(), 連続 3 回失敗で sys.exit(1)。
STALL_CHECK_INTERVAL_S = 300.0
STALL_FAIL_THRESHOLD = 3

# socket 通知の単発上限 = 1MB。同 UID 内 bug / 暴走による無制限メモリ消費を
# 物理的に止める (Phase 2 B4-4 と同じ意図、Telegram chunk 後でも rate limit を
# 踏みかねない巨大 push を socket 受信段階で打ち切る)。
NOTIFY_SOCKET_MAX_BYTES = 1_000_000

# `[critical] ` 完全一致 (半角スペース込み) で disable_notification 反転。
# W-6 上限ルール: prefix マッチ拡張 (`startswith('[warning]')` 等) は永続禁止、
# 2 種目要求は対症療法 2 周目認定で設計引き直し議論を起動する。
CRITICAL_PREFIX = "[critical] "

# 自発発話依頼の構造化メッセージ行マーカー。socket 接続ハンドラがこの行で始まる
# payload を **proactive 経路** へ振り分ける。これは K-T9 (sentinel 種別上限 = 文字列
# forward 経路の prefix マッチ拡張禁止) に抵触しない: forward 経路の `[critical] `
# prefix マッチ (挙動分岐) は一切増やさず、socket 受信段階で「文字列を素通し forward
# するか / claude を起こす proactive 依頼か」を JSON envelope で 1 回判別する別レイヤ
# だから。proactive 経路の中で更に prefix マッチ分岐を生やすことは将来も禁止。
PROACTIVE_MARKER = "[[proactive-v1]]"

# 自発発話の ledger (発火時刻 / 種種別 / 送信可否 / guard 判定を残す)。
# quota.py の ledger.jsonl とは別ファイル (こちらは budget 集計に混ぜない記録専用)。
PROACTIVE_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "proactive_ledger.jsonl"

# snooze 状態 = maintenance/.state/proactive (script と共有、key=value 行形式)。
# bot 側 /snooze で snooze_until=<epoch> を書き、script 側で snooze 中 skip を判定。
PROACTIVE_STATE_FILE = Path.home() / "companion" / "maintenance" / ".state" / "proactive"

# ペルソナ prompt (軸 1「対等な相方」)。persona/docs/STATUS.md 軸 1 確定内容を
# 自己完結した形で持たせる (vault CLAUDE.md には依存しない、register 統合は別タスク)。
PROACTIVE_PERSONA_PROMPT = (
    "あなたはこのユーザーの「対等な相方」として振る舞う。"
    "タメ口ベースで短く、時々さりげない気遣いや軽口を一言添える。"
    "急かさない、旅の道連れのような距離感。"
    "今はユーザーから話しかけられたのではなく、しばらく会話が途切れていたので"
    "あなたの方からふらっと一言声をかける場面。"
    "「元気?」「何してる?」のような中身のない問いかけや、"
    "「寂しい」「行かないで」のような情緒で引き止める言い回しは絶対に使わない。"
    "直近の会話の流れに自然につながる一言を、1〜2 文の短さで送る。"
    "前置きや自己説明はせず、本文だけを返す。"
)

_runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
if _runtime_dir:
    NOTIFY_SOCKET = Path(_runtime_dir) / "companion-bot.sock"
else:
    _fallback = Path.home() / ".cache" / "companion-bot"
    _fallback.mkdir(parents=True, exist_ok=True, mode=0o700)
    NOTIFY_SOCKET = _fallback / "companion-bot.sock"

if not TELEGRAM_BOT_TOKEN:
    print("TELEGRAM_BOT_TOKEN is not set", file=sys.stderr)
    sys.exit(1)
if not OWNER_ID_RAW.isdigit():
    print("OWNER_ID must be a numeric Telegram user id", file=sys.stderr)
    sys.exit(1)
OWNER_ID = int(OWNER_ID_RAW)
# NOTIFY_CHAT_ID は supergroup chat_id (負値)、isdigit() では弾けない。
try:
    NOTIFY_CHAT_ID = int(NOTIFY_CHAT_ID_RAW)
except ValueError:
    print("NOTIFY_CHAT_ID must be a numeric Telegram supergroup id (negative)", file=sys.stderr)
    sys.exit(1)


def _thread_id_env(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        print(f"{name} must be an integer thread_id when set", file=sys.stderr)
        sys.exit(1)


# BOT_THREAD_ID_MAINTENANCE は socket forward 先 (§5.2)、空の場合は General topic。
BOT_THREAD_ID_MAINTENANCE = _thread_id_env("BOT_THREAD_ID_MAINTENANCE")
# BOT_THREAD_ID_CHAT は自発発話 (proactive) の投げ先 = #chat。確定済パラメータ。
BOT_THREAD_ID_CHAT = _thread_id_env("BOT_THREAD_ID_CHAT")

LOG_DIR.mkdir(parents=True, exist_ok=True)
# bot.log は OWNER 限定経路の URL 等を含む。本プロセスが作る file は 0o600 にする
# (rotation 後の新規 active log や sessions/quota state file にも適用)。
os.umask(0o077)
# 過去 0o644 で作られた既存ファイルがあれば 0o600 へ寄せる。ledger.jsonl は
# CreditBudgetGuard の cost データを含むので明示的に追加 (T-D 後半 2026-05-19)。
_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "ledger.jsonl"
_PROACTIVE_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "proactive_ledger.jsonl"
for _existing in [LOG_FILE, *LOG_DIR.glob(f"{LOG_FILE.name}.*"), _LEDGER_PATH, _PROACTIVE_LEDGER_PATH]:
    try:
        os.chmod(_existing, 0o600)
    except FileNotFoundError:
        pass
logger = logging.getLogger("companion-bot")
logger.setLevel(logging.INFO)
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logger.addHandler(_handler)
logger.propagate = False

# AIORateLimiter の retry/RetryAfter イベントを沈黙させない (K-T4 / V-8 回避、
# devil 観察項目 4: retry を吸って沈黙状態に陥らないよう INFO 以上で残す)。
logging.getLogger("telegram.ext.AIORateLimiter").setLevel(logging.INFO)
logging.getLogger("AIORateLimiter").setLevel(logging.INFO)

runner = ClaudeRunner(CLAUDE_BIN, CLAUDE_CWD)
budget_guard = quota.make_budget_guard()
BOT_START_AT = datetime.now(quota.JST)


# ---------------------------------------------------------------------------
# Telegram I/O helpers
# ---------------------------------------------------------------------------


def chunk_telegram(text: str, size: int = TELEGRAM_MAX) -> list[str]:
    """Split `text` into chunks <= `size` chars, preferring newline boundaries.

    Fallback order (telegram-design §4.3):
      1. paragraph break (``\\n\\n``)
      2. line break (``\\n``)
      3. fixed-width slice

    Pure function, no Telegram dependency, so it can be unit-tested directly.
    """
    if not text:
        return []
    if len(text) <= size:
        return [text]
    pieces: list[str] = []
    remaining = text
    while len(remaining) > size:
        head = remaining[:size]
        # `\n\n` の最後の出現位置 (段落境界)
        cut = head.rfind("\n\n")
        if cut == -1 or cut == 0:
            # `\n` の最後の出現位置 (行境界)
            cut = head.rfind("\n")
        if cut == -1 or cut == 0:
            # fallback: 文字数固定で切る
            cut = size
        pieces.append(remaining[:cut].rstrip("\n"))
        # 改行境界で切った場合は consumed 側の改行も飛ばす
        remaining = remaining[cut:].lstrip("\n") if cut < size else remaining[cut:]
    if remaining:
        pieces.append(remaining)
    return pieces


async def send_text(
    bot,
    chat_id: int,
    thread_id: int | None,
    text: str,
    *,
    reply_to: int | None = None,
    disable_notification: bool = False,
) -> None:
    """Send `text` to a topic, chunking and reply-only-on-first-piece.

    AIORateLimiter (framework) が per-chat 1 msg/sec と 429 RetryAfter を吸う。
    素手 sleep / 二重 retry は永続禁止 (N-T12)。
    """
    pieces = chunk_telegram(text)
    if not pieces:
        return
    for i, piece in enumerate(pieces):
        kwargs: dict = {
            "chat_id": chat_id,
            "text": piece,
            "disable_notification": disable_notification,
        }
        if thread_id is not None:
            kwargs["message_thread_id"] = thread_id
        if i == 0 and reply_to is not None:
            kwargs["reply_parameters"] = ReplyParameters(message_id=reply_to)
        await bot.send_message(**kwargs)


# ---------------------------------------------------------------------------
# claude invocation
# ---------------------------------------------------------------------------


async def run_claude(prompt: str, chat_id: int, thread_id: int | None) -> str:
    topic_key = sessions.topic_key(chat_id, thread_id)
    now = datetime.now(quota.JST)
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        if summary.guard_kind == "requests_count":
            logger.warning(
                "budget exceeded topic_key=%s kind=requests_count count_1h=%d/%d",
                topic_key, summary.count_last_1h, summary.limit_per_hour,
            )
        else:
            logger.warning(
                "budget exceeded topic_key=%s kind=%s cost_month=%.4f/%.2f",
                topic_key, summary.guard_kind,
                summary.cost_month, summary.monthly_budget_usd,
            )
        return budget_guard.exceeded_message(summary)

    meta, is_new = sessions.start_or_resume(chat_id, thread_id)
    options = ClaudeOptions(timeout_s=CLAUDE_TIMEOUT)
    if is_new:
        options.session_id = meta.session_id
    else:
        options.resume_session = meta.session_id

    result = await runner.run_discord(prompt, options)

    if result.error_kind == ErrorKind.OK:
        sessions.record_usage(meta)
        budget_guard.record(
            datetime.now(quota.JST),
            result,
            topic_key=topic_key,
            session_id=meta.session_id,
        )
        body = result.result_text if result.result_text is not None else result.raw_stdout
        return body or "[empty output]"

    logger.warning(
        "claude error kind=%s rc=%s session_id=%s stderr_len=%d",
        result.error_kind.value, result.rc, meta.session_id, len(result.raw_stderr),
    )
    if result.error_kind == ErrorKind.TIMEOUT:
        return f"[timeout after {int(options.timeout_s)}s]"
    return (
        f"[claude error: {result.error_kind.value} rc={result.rc}]\n"
        f"{result.raw_stderr[:1500]}"
    )


# ---------------------------------------------------------------------------
# proactive companion messaging (自発発話)
# ---------------------------------------------------------------------------


def parse_proactive_payload(text: str) -> dict | None:
    """Return the proactive request dict if `text` is a proactive socket message.

    socket message format: ``[[proactive-v1]]\\n<json>``. Returns None for any
    text that is not a proactive request (so the caller falls back to the plain
    text-forward path). Pure function → unit-testable.

    判別は「marker 行 + JSON decode」の 1 回で確定する。stderr 文言マッチ的な
    挙動分岐ではなく、構造化 envelope の素直なデコード (2 周目ルール非該当)。
    """
    if not text.startswith(PROACTIVE_MARKER):
        return None
    body = text[len(PROACTIVE_MARKER):].lstrip("\n")
    try:
        obj = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict) or obj.get("kind") != "proactive":
        return None
    return obj


def build_proactive_prompt(payload: dict) -> str:
    """Compose the claude prompt for a proactive utterance from persona + seed.

    Pure function → unit-testable. payload は parse_proactive_payload の戻り。

    注入防止: prompt に展開してよいのは bounded/サニタイズ済みフィールドのみ
    (現状 vault_hint = script 側で basename 化したノート名)。socket payload の
    任意文字列フィールド (seed_kind 等) は prompt に流さない (ledger 記録専用)。
    将来フィールドを足すときもこの境界を守る。
    """
    parts = [PROACTIVE_PERSONA_PROMPT]
    vault_hint = payload.get("vault_hint")
    if vault_hint:
        parts.append(
            f"今日ユーザーが触れていた話題のヒント (ノート名): {vault_hint}。"
            "無理に全部に触れず、自然な一言だけにする。"
        )
    parts.append("では、相方として軽く一言、話しかけて。")
    return "\n".join(parts)


def is_snoozed(now_epoch: float | None = None) -> bool:
    """Return True if proactive messaging is currently snoozed.

    snooze 状態は maintenance/.state/proactive の ``snooze_until=<epoch>`` 行。
    script 側と同じ state を bot 側でも 1 回引いて判定する (二重防御)。
    """
    if now_epoch is None:
        now_epoch = time.time()
    until = _read_state_value(PROACTIVE_STATE_FILE, "snooze_until")
    if until is None:
        return False
    try:
        return now_epoch < float(until)
    except ValueError:
        return False


def _read_state_value(path: Path, key: str) -> str | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k == key:
                    return v
    except FileNotFoundError:
        return None
    return None


def write_snooze_until(until_epoch: int, path: Path | None = None) -> None:
    """Persist ``snooze_until`` while preserving ``last_proactive_date``.

    state file は key=value 行形式 (script と共有)。snooze_until 以外の既存行
    (last_proactive_date 等) は残す。path 未指定時は呼び出し時点の
    PROACTIVE_STATE_FILE を解決する (テストでの差し替えを効かせるため)。
    """
    if path is None:
        path = PROACTIVE_STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                existing[k] = v
    except FileNotFoundError:
        pass
    existing["snooze_until"] = str(until_epoch)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for k, v in existing.items():
            f.write(f"{k}={v}\n")
    os.replace(tmp, path)


def cmd_snooze(args: list[str], now_epoch: float | None = None) -> str:
    """`/snooze <日数>` 本体。snooze_until を now + 日数 に設定する純ロジック。

    引数なし / 不正は使い方を返す。0 は即時解除 (snooze_until を過去に倒す)。
    """
    if now_epoch is None:
        now_epoch = time.time()
    if not args:
        return (
            "[snooze] 使い方: /snooze <日数>\n"
            "例: /snooze 3 で 3 日間、自発発話を止めます。/snooze 0 で解除。"
        )
    raw = args[0]
    try:
        days = int(raw)
    except ValueError:
        return f"[snooze] 日数は整数で指定してください (受け取り: {raw!r})。"
    if days < 0:
        return "[snooze] 日数は 0 以上で指定してください。"
    until = int(now_epoch) + days * 86400
    write_snooze_until(until)
    if days == 0:
        return "[snooze] 自発発話の snooze を解除しました。"
    until_jst = datetime.fromtimestamp(until, quota.JST)
    return (
        f"[snooze] 自発発話を {days} 日間止めます "
        f"(再開: {until_jst.isoformat(timespec='minutes')})。"
    )


def _append_proactive_ledger(entry: dict) -> None:
    PROACTIVE_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    with PROACTIVE_LEDGER_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


# ---------------------------------------------------------------------------
# slash command bodies (no Telegram type imports → easy to unit-test)
# ---------------------------------------------------------------------------


def cmd_reset(chat_id: int, thread_id: int | None) -> str:
    if sessions.reset(chat_id, thread_id):
        return "[reset] 現 topic の session を破棄しました。次の prompt で新しい session_id が発番されます。"
    return "[reset] 現 topic に session は存在しませんでした (no-op)。"


def cmd_quota() -> str:
    summary = budget_guard.summary(datetime.now(quota.JST))
    return quota.format_summary(summary)


def _normalize_play_url(url: str) -> str | None:
    if any(ch.isspace() or ord(ch) < 0x20 for ch in url):
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    # `https://evil@youtube.com/...` のような userinfo 詐称形を弾く。
    if parsed.username is not None or parsed.password is not None:
        return None
    host = (parsed.hostname or "").lower()
    if host not in PLAY_ALLOWED_HOSTS:
        return None
    return parsed.geturl()


async def cmd_play(url: str) -> str:
    valid_url = _normalize_play_url(url)
    if valid_url is None:
        return (
            "[play] 受け付けない URL です。"
            "youtube.com / music.youtube.com / youtu.be の https/http のみ対応。"
        )
    env = dict(os.environ)
    env.setdefault("DISPLAY", ":0")
    env.setdefault("XAUTHORITY", str(Path.home() / ".Xauthority"))
    try:
        proc = await asyncio.create_subprocess_exec(
            "xdg-open", valid_url,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        return "[play] xdg-open が見つかりません。"
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=PLAY_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return f"[play] xdg-open が {int(PLAY_TIMEOUT_S)}s で応答せず。browser 起動中の可能性: {valid_url}"
    if proc.returncode == 0:
        return f"[play] ブラウザで開きました: {valid_url}"
    return (
        f"[play] xdg-open rc={proc.returncode}\n"
        f"{stderr.decode('utf-8', errors='replace')[:500]}"
    )


def classify_push_result(rc: int, stdout: str, stderr: str) -> str:
    """Format a user-facing message from a finished `git push` invocation.

    成否は呼び出し側が rc 1 回で確定済 (この関数は判定し直さない)。本関数は
    **エラーの表面化 (通知文言の整形) 専用** で、stderr を見て回復行動を分岐
    させない (`~/companion/CLAUDE.md` 2 周目ルール / 失敗回復は state 引き or
    人手介入のいずれか)。reject も agent-lock も回復行動は同一 =「止めて報告」。

    Pure function (subprocess 非依存) なので直接 unit-test できる。
    """
    combined = f"{stdout}\n{stderr}"
    if rc == 0:
        # `git push` は進捗・結果を stderr に出す。Everything up-to-date は
        # 「push する変更なし」を表す成功 (commit 済差分が remote に既にある)。
        if "Everything up-to-date" in combined:
            return "[vault-push] 既に同期済、push する変更はありません。"
        # 成功時は push した commit 範囲 (`<old>..<new> develop -> develop`) を
        # 含めて何が push されたか分かるようにする。git は範囲行を stderr に出す。
        range_line = _extract_push_range(combined)
        if range_line:
            return f"[vault-push] push 完了: {range_line}"
        return f"[vault-push] push 完了 ({VAULT_BRANCH} -> {VAULT_BRANCH})。"

    # ここから rc != 0 = 失敗確定。stderr 分類は報告文言の整形だけに使う。
    lower = combined.lower()
    if "non-fast-forward" in lower or "[rejected]" in lower or "fetch first" in lower:
        return (
            "[vault-push] reject: メイン機 / Obsidian が先に push 済 "
            f"(origin/{VAULT_BRANCH} が ahead)。手元で pull してから再実行してください。"
            "\n(自動 rebase / 自動 pull はしません)"
        )
    if (
        "permission denied (publickey)" in lower
        or "agent refused operation" in lower
        or "could not open a connection to your authentication agent" in lower
        or "host key verification failed" in lower
    ):
        return (
            "[vault-push] SSH 認証に失敗: 鍵が agent に未 load かロック中です。"
            "手元端末で `ssh-add` 後に再実行してください。"
        )
    tail = stderr.strip()[-500:] if stderr.strip() else stdout.strip()[-500:]
    return f"[vault-push] push 失敗 (rc={rc}):\n{tail}"


def _extract_push_range(text: str) -> str | None:
    """Extract the `<old>..<new> develop -> develop` style range line from git output.

    git は fast-forward push 時に ``   9867b22..460a35c  develop -> develop`` 形式の
    行を stderr に出す。new branch push は ``* [new branch] ...`` になる。
    どちらも見つからなければ None。
    """
    for raw in text.splitlines():
        line = raw.strip()
        if "->" not in line:
            continue
        if ".." in line or "[new branch]" in line:
            return line
    return None


async def cmd_vault_push() -> str:
    """`git push` vault の commit 済変更を実行し、結果メッセージを返す。

    成否は `git push` の exit code 1 回で確定する (制約 4)。失敗時のみ
    classify_push_result が stderr を分類して報告文言を整形する (回復はしない)。
    SSH_AUTH_SOCK は service unit の Environment で固定解決される (継承タイミング
    依存を排除)。GIT_SSH_COMMAND=BatchMode=yes で対話 hang を即 fail させる。
    """
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = VAULT_PUSH_SSH_COMMAND
    # git の対話プロンプト系を全方位で無効化 (credential helper は無いが保険)。
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(VAULT_DIR), "push", VAULT_REMOTE, VAULT_BRANCH,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        return "[vault-push] git が見つかりません。"
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=VAULT_PUSH_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return (
            f"[vault-push] push が {int(VAULT_PUSH_TIMEOUT_S)}s で応答せず中断しました。"
            "ネットワーク / SSH 接続を確認してください。"
        )
    stdout = stdout_b.decode("utf-8", errors="replace")
    stderr = stderr_b.decode("utf-8", errors="replace")
    return classify_push_result(proc.returncode or 0, stdout, stderr)


def cmd_status(
    chat_id: int,
    thread_id: int | None,
    *,
    socket_ok: bool,
) -> str:
    now = datetime.now(quota.JST)
    summary = budget_guard.summary(now)
    meta = sessions.load(chat_id, thread_id)
    lines = [
        f"bot uptime: {BOT_START_AT.isoformat(timespec='seconds')} ({_fmt_duration(now - BOT_START_AT)} 前から稼働)",
        f"last claude call: {summary.last_call_at.isoformat(timespec='seconds') if summary.last_call_at else 'なし'}",
        f"notify socket: {'listening' if socket_ok else 'down'} ({NOTIFY_SOCKET})",
    ]
    if meta is not None:
        last = (
            meta.last_prompt_at.astimezone(quota.JST).isoformat(timespec="seconds")
            if meta.last_prompt_at else "未使用"
        )
        lines.append(
            f"current session: {meta.session_id} "
            f"(prompts={meta.prompt_count}, last_prompt_at={last})"
        )
    else:
        lines.append("current session: なし (次の prompt で新規発番)")
    return "\n".join(lines)


def _fmt_duration(delta) -> str:
    total = int(delta.total_seconds())
    if total < 0:
        total = 0
    hours, rem = divmod(total, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours:
        return f"{hours}h{minutes:02d}m"
    if minutes:
        return f"{minutes}m{seconds:02d}s"
    return f"{seconds}s"


# ---------------------------------------------------------------------------
# OWNER 認可 4 段防御 (§4.2)
# ---------------------------------------------------------------------------


def _authorized(update: Update) -> bool:
    """Return True when the update passes all 4 stages, False otherwise.

    違反は呼び出し側で完全沈黙 (return)。Telegram の構造的利得を活用、
    Discord ephemeral 通知から脱却 (`~/companion/CLAUDE.md` OWNER 原則)。
    """
    user = update.effective_user
    chat = update.effective_chat
    if user is None or chat is None:
        return False
    # 段 1: OWNER 認可
    if user.id != OWNER_ID:
        return False
    # 段 2: bot echo 防止
    if user.is_bot:
        return False
    # 段 3: chat type (supergroup のみ)
    if chat.type != ChatType.SUPERGROUP:
        return False
    # 段 4: 想定外 supergroup 巻き込み防止
    if chat.id != NOTIFY_CHAT_ID:
        return False
    return True


# ---------------------------------------------------------------------------
# handlers
# ---------------------------------------------------------------------------


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    if msg is None:
        return
    prompt = (msg.text or "").strip()
    if not prompt:
        return
    thread_id = msg.message_thread_id
    chat_id = update.effective_chat.id

    try:
        async with _typing_action(context.bot, chat_id, thread_id):
            output = await run_claude(prompt, chat_id, thread_id)
    except Exception:
        logger.exception("claude invocation failed")
        await send_text(
            context.bot, chat_id, thread_id,
            "[internal error — see bot.log]",
            reply_to=msg.message_id,
        )
        return

    logger.info("send len=%d", len(output))
    await send_text(
        context.bot, chat_id, thread_id, output, reply_to=msg.message_id,
    )


class _typing_action:
    """Periodic ``sendChatAction(typing)`` for the duration of a `with` block.

    Telegram の typing indicator は 5 秒で消えるため定期再送信する (claude
    invocation が長引いた時に「動いてる感」を出す、ux 既存挙動の踏襲)。
    AIORateLimiter は send_chat_action にも適用される。
    """

    def __init__(self, bot, chat_id: int, thread_id: int | None):
        self._bot = bot
        self._chat_id = chat_id
        self._thread_id = thread_id
        self._task: asyncio.Task | None = None

    async def __aenter__(self):
        self._task = asyncio.create_task(self._loop())
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _loop(self):
        while True:
            try:
                kwargs = {"chat_id": self._chat_id, "action": "typing"}
                if self._thread_id is not None:
                    kwargs["message_thread_id"] = self._thread_id
                await self._bot.send_chat_action(**kwargs)
            except Exception:
                # typing は best-effort、失敗しても本筋に伝播させない
                logger.debug("send_chat_action failed", exc_info=True)
            await asyncio.sleep(4.0)


async def slash_reset(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_reset(chat_id, thread_id)
    logger.info("cmd=/reset send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_quota(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_quota()
    logger.info("cmd=/quota send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    socket_ok = context.application.bot_data.get("notify_server") is not None
    output = cmd_status(chat_id, thread_id, socket_ok=socket_ok)
    logger.info("cmd=/status send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    # `/play <url>` の引数解析: context.args は空白 split
    if not context.args:
        await send_text(
            context.bot, chat_id, thread_id,
            "[play] URL を引数に指定してください。例: /play https://youtu.be/xxx",
            reply_to=msg.message_id if msg else None,
        )
        return
    url = context.args[0]
    output = await cmd_play(url)
    # URL は OWNER 限定経路のため log に残してよい。allowlist 拒否時の原因切り分けに使う。
    logger.info("cmd=/play url=%r send len=%d", url, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_snooze(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_snooze(context.args or [])
    logger.info("cmd=/snooze args=%r send len=%d", context.args, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_vault_push(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = await cmd_vault_push()
    logger.info("cmd=/vault_push send len=%d", len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


# ---------------------------------------------------------------------------
# notify socket (queue + 1 worker for order guarantee, §5.2)
# ---------------------------------------------------------------------------


async def _notify_worker(app: Application) -> None:
    queue: asyncio.Queue = app.bot_data["notify_queue"]
    while True:
        text = await queue.get()
        try:
            is_critical = text.startswith(CRITICAL_PREFIX)  # 完全一致 (W-6 上限ルール)
            thread_id = BOT_THREAD_ID_MAINTENANCE
            await send_text(
                app.bot,
                NOTIFY_CHAT_ID,
                thread_id,
                text,
                disable_notification=(not is_critical),
            )
            logger.info("notify forwarded len=%d critical=%s", len(text), is_critical)
        except Exception:
            logger.exception("notify forward failed")
        finally:
            queue.task_done()


async def _proactive_worker(app: Application) -> None:
    """Serialize proactive requests: claude 起動 (guard 経由) → #chat 送信 → ledger。

    notify queue とは別 worker。claude 起動は **必ず run_claude (budget guard を
    通る経路)** を再利用する。guard を迂回して claude_runner を直叩きしない
    (M-14 単一 guard 境界)。guard が許可しなければ skip (ledger に残すだけ)。
    """
    queue: asyncio.Queue = app.bot_data["proactive_queue"]
    while True:
        payload = await queue.get()
        try:
            await _run_proactive(app, payload)
        except Exception:
            logger.exception("proactive request failed")
        finally:
            queue.task_done()


async def _run_proactive(app: Application, payload: dict) -> None:
    now = datetime.now(quota.JST)
    seed_kind = payload.get("seed_kind", "unknown")
    base = {
        "timestamp": now.isoformat(),
        "seed_kind": seed_kind,
        "vault_hint": payload.get("vault_hint"),
    }

    # bot 側グローバル off / snooze の二重防御 (script 側でも見るが state すれ違い
    # や手動 socket 投入に備え bot 側でも 1 回引いて確定する)。
    if not PROACTIVE_ENABLED:
        logger.info("proactive skip: PROACTIVE_ENABLED is off")
        _append_proactive_ledger({**base, "sent": False, "reason": "disabled"})
        return
    if is_snoozed():
        logger.info("proactive skip: snoozed")
        _append_proactive_ledger({**base, "sent": False, "reason": "snoozed"})
        return

    chat_id = NOTIFY_CHAT_ID
    thread_id = BOT_THREAD_ID_CHAT

    # budget guard は run_claude の内部で必ず通る。ここで事前に summary を 1 回取って
    # 「guard 拒否で skip だったか」を ledger に残せるようにする (run_claude は拒否時
    # に exceeded_message 文字列を返すので、それを #chat に投げないため事前判定する)。
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.info("proactive skip: budget guard not allowing (kind=%s)", summary.guard_kind)
        _append_proactive_ledger({
            **base, "sent": False, "reason": "budget_guard",
            "guard_kind": summary.guard_kind,
        })
        return

    prompt = build_proactive_prompt(payload)
    # run_claude は guard を通り、#chat の session を resume して claude を起動する。
    output = await run_claude(prompt, chat_id, thread_id)
    if not output or not output.strip():
        logger.info("proactive skip: empty claude output")
        _append_proactive_ledger({**base, "sent": False, "reason": "empty_output"})
        return

    await send_text(app.bot, chat_id, thread_id, output, disable_notification=True)
    # 自発発話で送信した以上 last_prompt_at は run_claude 内 record_usage で更新済
    # (連投防止 = 沈黙判定がこの時刻基準で再カウントされる)。
    logger.info("proactive sent len=%d seed_kind=%s", len(output), seed_kind)
    _append_proactive_ledger({
        **base, "sent": True, "reason": "ok", "output_len": len(output),
        "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
    })


async def _handle_notify_connection(
    app: Application,
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    try:
        # 同 UID 内 bug / 暴走による無制限メモリ消費を物理的に止める (Phase 2
        # B4-4 と同じ意図、Telegram chunk 後でも rate limit を踏みかねない巨大
        # push を socket 受信段階で打ち切る)。
        data = await reader.read(NOTIFY_SOCKET_MAX_BYTES)
        text = data.decode("utf-8", errors="replace").strip()
        if not text:
            return
        # 構造化 envelope なら proactive 経路へ、それ以外は従来の素通し forward。
        proactive = parse_proactive_payload(text)
        if proactive is not None:
            queue: asyncio.Queue = app.bot_data["proactive_queue"]
            await queue.put(proactive)
            return
        queue = app.bot_data["notify_queue"]
        await queue.put(text)
    except Exception:
        logger.exception("notify socket recv failed")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# long polling stall check (§4.6)
# ---------------------------------------------------------------------------


async def stall_check_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    bot_data = context.application.bot_data
    try:
        await context.bot.get_me()
        bot_data["stall_count"] = 0
    except Exception:
        bot_data["stall_count"] = bot_data.get("stall_count", 0) + 1
        logger.warning(
            "stall_check_job: get_me() failed (consecutive %d)",
            bot_data["stall_count"],
        )
        if bot_data["stall_count"] >= STALL_FAIL_THRESHOLD:
            logger.critical(
                "long polling stall %d consecutive, exiting for systemd restart",
                bot_data["stall_count"],
            )
            # critical 通知を best-effort で投げてから落ちる。
            try:
                await send_text(
                    context.bot,
                    NOTIFY_CHAT_ID,
                    BOT_THREAD_ID_MAINTENANCE,
                    f"{CRITICAL_PREFIX}bot long polling stall {bot_data['stall_count']} 回、再起動します",
                    disable_notification=False,
                )
            except Exception:
                logger.exception("critical notify on stall failed")
            sys.exit(1)


# ---------------------------------------------------------------------------
# post_init: privacy mode check, slash command registration, notify socket,
# notify worker, stall check job
# ---------------------------------------------------------------------------


async def post_init(application: Application) -> None:
    # privacy mode off 確認 (§4.2 末尾)
    me = await application.bot.get_me()
    if not me.can_read_all_group_messages:
        logger.critical(
            "privacy mode が ON のままです (BotFather → Bot Settings → Group Privacy → Turn off)"
        )
        sys.exit(1)
    logger.info("logged in as @%s (id=%s)", me.username, me.id)

    # supergroup の到達性確認 (§4.2 段 4 と整合)。typo / 権限喪失 / supergroup 未参加なら起動時に sys.exit、当日デバッグの早期化 (privacy mode off チェックと対称)
    try:
        chat = await application.bot.get_chat(NOTIFY_CHAT_ID)
        logger.info("notify chat verified: id=%s title=%r type=%s",
                    chat.id, chat.title, chat.type)
    except Exception:
        logger.critical("notify chat %s could not be resolved (typo / bot not in supergroup / 権限喪失)",
                        NOTIFY_CHAT_ID, exc_info=True)
        sys.exit(1)

    # slash command scope を NOTIFY_CHAT_ID に限定 (§4.4)
    commands = [
        BotCommand("reset", "現 topic の claude セッションを破棄"),
        BotCommand("quota", "bot 経由 prompt の予算 / 集計を表示"),
        BotCommand("status", "bot 稼働状況 / current session を表示"),
        BotCommand("play", "YouTube URL をこの PC のブラウザで開く"),
        BotCommand("vault_push", "vault の commit 済変更を GitHub に push"),
        BotCommand("snooze", "自発発話を指定日数止める (例: /snooze 3、解除は /snooze 0)"),
    ]
    scope = BotCommandScopeChat(chat_id=NOTIFY_CHAT_ID)
    try:
        await application.bot.delete_my_commands(scope=scope)
        await application.bot.set_my_commands(commands=commands, scope=scope)
        logger.info("slash commands registered to chat %s: %s",
                    NOTIFY_CHAT_ID, [c.command for c in commands])
    except Exception:
        logger.exception("slash command registration failed")

    # notify socket の listen を開始 (§5.2)
    try:
        NOTIFY_SOCKET.unlink()
    except FileNotFoundError:
        pass
    application.bot_data["notify_queue"] = asyncio.Queue()
    application.bot_data["proactive_queue"] = asyncio.Queue()
    server = await asyncio.start_unix_server(
        lambda r, w: _handle_notify_connection(application, r, w),
        path=str(NOTIFY_SOCKET),
    )
    os.chmod(NOTIFY_SOCKET, 0o600)
    application.bot_data["notify_server"] = server
    application.bot_data["notify_worker_task"] = asyncio.create_task(
        _notify_worker(application)
    )
    application.bot_data["proactive_worker_task"] = asyncio.create_task(
        _proactive_worker(application)
    )
    logger.info("notify socket listening at %s (proactive enabled=%s)",
                NOTIFY_SOCKET, PROACTIVE_ENABLED)

    # stall check job (§4.6)
    application.job_queue.run_repeating(
        stall_check_job,
        interval=STALL_CHECK_INTERVAL_S,
        first=STALL_CHECK_INTERVAL_S,
        name="stall_check",
    )


async def post_shutdown(application: Application) -> None:
    server = application.bot_data.get("notify_server")
    if server is not None:
        server.close()
        try:
            await server.wait_closed()
        except Exception:
            pass
    for key in ("notify_worker_task", "proactive_worker_task"):
        worker_task: asyncio.Task | None = application.bot_data.get(key)
        if worker_task is not None:
            worker_task.cancel()
            try:
                await worker_task
            except (asyncio.CancelledError, Exception):
                pass
    try:
        NOTIFY_SOCKET.unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def build_application() -> Application:
    app = (
        ApplicationBuilder()
        .token(TELEGRAM_BOT_TOKEN)
        .rate_limiter(AIORateLimiter())
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )

    # edited_message を物理的に取りこぼす (§4.5 / N-T7、W-6)。
    message_filter = filters.UpdateType.MESSAGE & ~filters.UpdateType.EDITED_MESSAGE
    app.add_handler(CommandHandler("reset", slash_reset, filters=message_filter))
    app.add_handler(CommandHandler("quota", slash_quota, filters=message_filter))
    app.add_handler(CommandHandler("status", slash_status, filters=message_filter))
    app.add_handler(CommandHandler("play", slash_play, filters=message_filter))
    app.add_handler(CommandHandler("vault_push", slash_vault_push, filters=message_filter))
    app.add_handler(CommandHandler("snooze", slash_snooze, filters=message_filter))
    # slash command 以外の text message → on_message
    app.add_handler(
        MessageHandler(
            message_filter & filters.TEXT & ~filters.COMMAND,
            on_message,
        )
    )
    return app


def main() -> None:
    app = build_application()
    # §4.5 allowlist: 受信そのものを message に絞る (handler 未登録 type の getUpdates 帯域 / log ノイズを削減、callback_query は §7.4 sentinel 経路採用時に追加)
    app.run_polling(allowed_updates=["message"])


if __name__ == "__main__":
    main()
