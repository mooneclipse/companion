"""Per-channel Claude session-id persistence for companion-bot.

One channel = one JSON file under ``sessions/channels/<channel-id>.json``.
``--continue`` is not used anywhere; the first prompt for a channel is launched
with ``--session-id <new uuid4>`` and subsequent prompts use ``--resume``.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_SESSIONS_DIR = Path(__file__).resolve().parent / "sessions" / "channels"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _from_iso(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


@dataclass
class SessionMeta:
    channel_id: int
    session_id: str
    created_at: datetime
    last_used_at: datetime
    prompt_count: int
    last_prompt_at: datetime | None


def _path_for(channel_id: int) -> Path:
    return _SESSIONS_DIR / f"{channel_id}.json"


def load(channel_id: int) -> SessionMeta | None:
    path = _path_for(channel_id)
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    return SessionMeta(
        channel_id=int(data["channel_id"]),
        session_id=str(data["session_id"]),
        created_at=_from_iso(data["created_at"]),
        last_used_at=_from_iso(data["last_used_at"]),
        prompt_count=int(data.get("prompt_count", 0)),
        last_prompt_at=_from_iso(data.get("last_prompt_at")),
    )


def save(meta: SessionMeta) -> None:
    _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = _path_for(meta.channel_id)
    payload = {
        "channel_id": meta.channel_id,
        "session_id": meta.session_id,
        "created_at": _to_iso(meta.created_at),
        "last_used_at": _to_iso(meta.last_used_at),
        "prompt_count": meta.prompt_count,
        "last_prompt_at": _to_iso(meta.last_prompt_at),
    }
    fd, tmp = tempfile.mkstemp(dir=str(_SESSIONS_DIR), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def reset(channel_id: int) -> bool:
    """Delete the channel's session file. Return True if a file was removed."""
    path = _path_for(channel_id)
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def determine_args(channel_id: int) -> tuple[list[str], SessionMeta]:
    """Build claude CLI args for this channel and persist a fresh meta if new.

    First call for a channel allocates a uuid4 and writes the JSON before
    returning ``--session-id <uuid>``. Subsequent calls return
    ``--resume <stored uuid>`` without modifying the file.
    """
    meta = load(channel_id)
    if meta is None:
        new_id = str(uuid.uuid4())
        now = _now()
        meta = SessionMeta(
            channel_id=channel_id,
            session_id=new_id,
            created_at=now,
            last_used_at=now,
            prompt_count=0,
            last_prompt_at=None,
        )
        save(meta)
        return (["--session-id", new_id], meta)
    return (["--resume", meta.session_id], meta)


def record_usage(meta: SessionMeta) -> None:
    """Bump counters and last-used timestamps after a successful claude run."""
    now = _now()
    meta.last_used_at = now
    meta.last_prompt_at = now
    meta.prompt_count += 1
    save(meta)
