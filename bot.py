"""Discord bot that pipes DMs / mentions to `claude -p` and returns the output."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

import discord
from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN", "").strip()
OWNER_ID_RAW = os.environ.get("OWNER_ID", "").strip()
NOTIFY_CHANNEL_ID_RAW = os.environ.get("NOTIFY_CHANNEL_ID", "").strip()
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude").strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", str(Path.home() / "companion" / "workspace")).strip()
CLAUDE_TIMEOUT = float(os.environ.get("CLAUDE_TIMEOUT", "300"))

LOG_DIR = Path.home() / "companion" / "logs"
LOG_FILE = LOG_DIR / "bot.log"
DISCORD_MAX = 1900  # leave margin under the hard 2000-char limit

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
logger = logging.getLogger("companion-bot")
logger.setLevel(logging.INFO)
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logger.addHandler(_handler)
logger.propagate = False

intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True
claude_lock = asyncio.Lock()


def chunk(text: str, size: int = DISCORD_MAX):
    if not text:
        return []
    return [text[i : i + size] for i in range(0, len(text), size)]


async def run_claude(prompt: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        CLAUDE_BIN,
        "-p",
        cwd=CLAUDE_CWD,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode("utf-8")), timeout=CLAUDE_TIMEOUT
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise

    out = stdout.decode("utf-8", errors="replace").strip()
    err = stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0:
        logger.warning("claude exited %s, stderr_len=%d", proc.returncode, len(err))
        return out or f"[claude exited {proc.returncode}]\n{err[:1500]}"
    return out or "[empty output]"


class CompanionClient(discord.Client):
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


@client.event
async def on_ready():
    logger.info("logged in as %s", client.user)


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

    async with claude_lock:
        try:
            async with message.channel.typing():
                output = await run_claude(prompt)
        except asyncio.TimeoutError:
            logger.warning("claude timed out")
            await message.channel.send(f"[timeout after {int(CLAUDE_TIMEOUT)}s]")
            return
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
