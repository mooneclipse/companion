"""Discord bot that pipes DMs / mentions to `claude -p` and returns the output."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse

import discord
from discord import app_commands
from dotenv import load_dotenv

import quota
import sessions
from claude_runner import ClaudeOptions, ClaudeRunner, ErrorKind

load_dotenv()

DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN", "").strip()
OWNER_ID_RAW = os.environ.get("OWNER_ID", "").strip()
NOTIFY_CHANNEL_ID_RAW = os.environ.get("NOTIFY_CHANNEL_ID", "").strip()
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude").strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", str(Path.home() / "companion" / "bot-workspace")).strip()
CLAUDE_TIMEOUT = float(os.environ.get("CLAUDE_TIMEOUT", "300"))

LOG_DIR = Path.home() / "companion" / "logs"
LOG_FILE = LOG_DIR / "bot.log"
DISCORD_MAX = 1900  # leave margin under the hard 2000-char limit

PLAY_ALLOWED_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
})
PLAY_TIMEOUT_S = 10.0

_runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
if _runtime_dir:
    NOTIFY_SOCKET = Path(_runtime_dir) / "companion-bot.sock"
else:
    _fallback = Path.home() / ".cache" / "companion-bot"
    _fallback.mkdir(parents=True, exist_ok=True, mode=0o700)
    NOTIFY_SOCKET = _fallback / "companion-bot.sock"

if not DISCORD_TOKEN:
    print("DISCORD_TOKEN is not set", file=sys.stderr)
    sys.exit(1)
if not OWNER_ID_RAW.isdigit():
    print("OWNER_ID must be a numeric Discord user id", file=sys.stderr)
    sys.exit(1)
OWNER_ID = int(OWNER_ID_RAW)
if not NOTIFY_CHANNEL_ID_RAW.isdigit():
    print("NOTIFY_CHANNEL_ID must be a numeric Discord channel id", file=sys.stderr)
    sys.exit(1)
NOTIFY_CHANNEL_ID = int(NOTIFY_CHANNEL_ID_RAW)

LOG_DIR.mkdir(parents=True, exist_ok=True)
# bot.log は OWNER 限定経路の URL 等を含む。本プロセスが作る file は 0o600 にする
# (rotation 後の新規 active log や sessions/quota state file にも適用)。
os.umask(0o077)
# 過去 0o644 で作られた既存ファイルがあれば 0o600 へ寄せる。
for _existing in [LOG_FILE, *LOG_DIR.glob(f"{LOG_FILE.name}.*")]:
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

intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True
runner = ClaudeRunner(CLAUDE_BIN, CLAUDE_CWD)
budget_guard = quota.make_budget_guard()
BOT_START_AT = datetime.now(quota.JST)


def chunk(text: str, size: int = DISCORD_MAX):
    if not text:
        return []
    return [text[i : i + size] for i in range(0, len(text), size)]


async def run_claude(prompt: str, channel_id: int) -> str:
    now = datetime.now(quota.JST)
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.warning(
            "budget exceeded channel_id=%s count_1h=%d/%s",
            channel_id, summary.count_last_1h, summary.limit_per_hour,
        )
        return (
            f"[budget guard] 直近 1h あたり {summary.limit_per_hour} 回の上限に到達しました "
            f"(現在 {summary.count_last_1h} 回)。"
            "古い記録が window から外れるまでお待ちください。"
        )

    meta, is_new = sessions.start_or_resume(channel_id)
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
            channel_id=channel_id,
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


def cmd_reset(channel_id: int) -> str:
    if sessions.reset(channel_id):
        return "[reset] 現 channel の session を破棄しました。次の prompt で新しい session_id が発番されます。"
    return "[reset] 現 channel に session は存在しませんでした (no-op)。"


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


def cmd_status(channel_id: int) -> str:
    now = datetime.now(quota.JST)
    summary = budget_guard.summary(now)
    socket_ok = getattr(client, "_notify_server", None) is not None
    meta = sessions.load(channel_id)
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


class CompanionClient(discord.Client):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tree = app_commands.CommandTree(self)
        self._synced_guild_id: int | None = None

    async def setup_hook(self):
        try:
            NOTIFY_SOCKET.unlink()
        except FileNotFoundError:
            pass
        self._notify_server = await asyncio.start_unix_server(
            self._handle_notify, path=str(NOTIFY_SOCKET)
        )
        os.chmod(NOTIFY_SOCKET, 0o600)
        logger.info("notify socket listening at %s", NOTIFY_SOCKET)

    async def close(self):
        server = getattr(self, "_notify_server", None)
        if server is not None:
            server.close()
            await server.wait_closed()
        try:
            NOTIFY_SOCKET.unlink()
        except FileNotFoundError:
            pass
        await super().close()

    async def _handle_notify(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            data = await reader.read()
            text = data.decode("utf-8", errors="replace").strip()
            if not text:
                return
            channel = self.get_channel(NOTIFY_CHANNEL_ID) or await self.fetch_channel(NOTIFY_CHANNEL_ID)
            for piece in chunk(text):
                await channel.send(piece)
            logger.info("notify forwarded len=%d", len(text))
        except Exception:
            logger.exception("notify forward failed")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


client = CompanionClient(intents=intents)


async def _reject_non_owner(interaction: discord.Interaction) -> bool:
    """Send an ephemeral rejection if the caller isn't the OWNER. Returns True
    when rejected (handler should bail). Keeps OWNER-only authorization
    consistent with `on_message`."""
    if interaction.user.id != OWNER_ID:
        await interaction.response.send_message("not authorized", ephemeral=True)
        return True
    return False


@client.tree.command(name="reset", description="現 channel の claude セッションを破棄")
async def slash_reset(interaction: discord.Interaction):
    if await _reject_non_owner(interaction):
        return
    output = cmd_reset(interaction.channel_id or 0)
    logger.info("cmd=/reset send len=%d", len(output))
    await interaction.response.send_message(output)


@client.tree.command(name="quota", description="bot 経由 prompt の予算 / 集計を表示")
async def slash_quota(interaction: discord.Interaction):
    if await _reject_non_owner(interaction):
        return
    output = cmd_quota()
    logger.info("cmd=/quota send len=%d", len(output))
    await interaction.response.send_message(output)


@client.tree.command(name="status", description="bot 稼働状況 / current session を表示")
async def slash_status(interaction: discord.Interaction):
    if await _reject_non_owner(interaction):
        return
    output = cmd_status(interaction.channel_id or 0)
    logger.info("cmd=/status send len=%d", len(output))
    await interaction.response.send_message(output)


@client.tree.command(name="play", description="YouTube / YouTube Music URL をこの PC のブラウザで開く")
@app_commands.describe(url="YouTube / YouTube Music の URL")
async def slash_play(interaction: discord.Interaction, url: str):
    if await _reject_non_owner(interaction):
        return
    await interaction.response.defer(thinking=True)
    output = await cmd_play(url)
    # URL は OWNER 限定経路のため log に残してよい。allowlist 拒否時の原因切り分けに使う。
    logger.info("cmd=/play url=%r send len=%d", url, len(output))
    await interaction.followup.send(output)


@client.event
async def on_ready():
    logger.info("logged in as %s", client.user)
    try:
        ch = client.get_channel(NOTIFY_CHANNEL_ID) or await client.fetch_channel(NOTIFY_CHANNEL_ID)
    except Exception:
        logger.exception("notify channel %s could not be resolved", NOTIFY_CHANNEL_ID)
        return
    if not isinstance(ch, discord.TextChannel):
        logger.error("notify channel %s is not a TextChannel: %r", NOTIFY_CHANNEL_ID, ch)
        return
    logger.info("notify channel verified: #%s (%s)", ch.name, NOTIFY_CHANNEL_ID)

    guild = ch.guild
    if client._synced_guild_id != guild.id:
        try:
            client.tree.copy_global_to(guild=guild)
            synced = await client.tree.sync(guild=guild)
            logger.info(
                "slash commands synced to guild #%s (%d cmds): %s",
                guild.id, len(synced), [c.name for c in synced],
            )
            client._synced_guild_id = guild.id
        except Exception:
            logger.exception("slash command sync failed for guild %s", guild.id)


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    is_dm = isinstance(message.channel, discord.DMChannel)
    is_mention = client.user in message.mentions if client.user else False

    if message.author.id != OWNER_ID:
        return
    if not (is_dm or is_mention):
        return

    prompt = message.clean_content.strip()
    if not prompt:
        return

    try:
        async with message.channel.typing():
            output = await run_claude(prompt, message.channel.id)
    except Exception:
        logger.exception("claude invocation failed")
        await message.channel.send("[internal error — see bot.log]")
        return

    logger.info("send len=%d", len(output))
    for piece in chunk(output):
        await message.channel.send(piece)


def main():
    client.run(DISCORD_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
