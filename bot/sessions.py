"""Per-topic Claude session-id persistence for companion-bot.

One Telegram forum topic = one JSON file under
``sessions/topics/<chat_id>_<thread_id or 'general'>.json``. ``--continue`` is
not used anywhere; the first prompt for a topic is launched with
``--session-id <new uuid4>`` and subsequent prompts use ``--resume``.

Key migration from Phase 2.5 (Discord):
- single ``channel_id: int`` → composite ``(chat_id, thread_id)`` (see
  telegram-design §2.1 / §2.2). ``thread_id is None`` represents the
  supergroup's General topic and serializes to the literal suffix
  ``"_general"`` so numeric ``0`` cannot collide (§2.3).
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_SESSIONS_DIR = Path(__file__).resolve().parent / "sessions" / "topics"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _from_iso(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


def _thread_suffix(thread_id: int | None) -> str:
    """Return the file-name suffix for a thread_id.

    General topic (``thread_id is None``) is encoded as the literal string
    ``"general"`` to keep code paths uniform (§2.3, N-T8 回避) and to avoid the
    numeric-0 collision that would happen if we serialized ``None`` as ``0``.
    """
    if thread_id is None:
        return "general"
    return str(thread_id)


def topic_key(chat_id: int, thread_id: int | None) -> str:
    """Stable string key for ``(chat_id, thread_id)`` used in ledger.jsonl.

    Format: ``"<chat_id>_<thread_id or 'general'>"``. Reads ``channel_id`` as
    ``topic_key`` (str) per telegram-design §2.1.
    """
    return f"{chat_id}_{_thread_suffix(thread_id)}"


@dataclass
class SessionMeta:
    chat_id: int
    thread_id: int | None
    session_id: str
    created_at: datetime
    last_used_at: datetime
    prompt_count: int
    last_prompt_at: datetime | None

    @property
    def topic_key(self) -> str:
        return topic_key(self.chat_id, self.thread_id)


def _path_for(chat_id: int, thread_id: int | None) -> Path:
    return _SESSIONS_DIR / f"{topic_key(chat_id, thread_id)}.json"


def load(chat_id: int, thread_id: int | None) -> SessionMeta | None:
    path = _path_for(chat_id, thread_id)
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    raw_thread = data.get("thread_id")
    return SessionMeta(
        chat_id=int(data["chat_id"]),
        thread_id=int(raw_thread) if raw_thread is not None else None,
        session_id=str(data["session_id"]),
        created_at=_from_iso(data["created_at"]),
        last_used_at=_from_iso(data["last_used_at"]),
        prompt_count=int(data.get("prompt_count", 0)),
        last_prompt_at=_from_iso(data.get("last_prompt_at")),
    )


def save(meta: SessionMeta) -> None:
    _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = _path_for(meta.chat_id, meta.thread_id)
    payload = {
        "chat_id": meta.chat_id,
        "thread_id": meta.thread_id,
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


def reset(chat_id: int, thread_id: int | None) -> bool:
    """Delete the topic's session file. Return True if a file was removed."""
    path = _path_for(chat_id, thread_id)
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def start_or_resume(chat_id: int, thread_id: int | None) -> tuple[SessionMeta, bool]:
    """Return ``(meta, is_new)`` for the next claude invocation on this topic.

    On first call for a topic a uuid4 is allocated and persisted before
    returning ``is_new=True``; the caller wires it up as
    ``ClaudeOptions.session_id``. On subsequent calls the stored uuid is
    returned with ``is_new=False`` and the caller passes it as
    ``ClaudeOptions.resume_session``.
    """
    meta = load(chat_id, thread_id)
    if meta is None:
        new_id = str(uuid.uuid4())
        now = _now()
        meta = SessionMeta(
            chat_id=chat_id,
            thread_id=thread_id,
            session_id=new_id,
            created_at=now,
            last_used_at=now,
            prompt_count=0,
            last_prompt_at=None,
        )
        save(meta)
        return meta, True
    return meta, False


def record_usage(meta: SessionMeta) -> None:
    """Bump counters and last-used timestamps after a successful claude run."""
    now = _now()
    meta.last_used_at = now
    meta.last_prompt_at = now
    meta.prompt_count += 1
    save(meta)


def record_usage_if_exists(chat_id: int, thread_id: int | None) -> bool:
    """State があるときだけ record_usage する (無ければ何もせず False)。

    ephemeral session で送る proactive 経路 (investigate / ticket / remind) が
    沈黙ゲートの last_prompt_at を進める専用。ここで start_or_resume を使うと、
    claude に一度も --session-id で渡していない uuid が state に保存され、次の
    ユーザー発話の --resume が "No conversation found" で必ず落ちる
    (2026-07-13 実障害: /reset 直後に proactive が先行したケース)。発番は
    実際に claude を起動する経路 (bot.py の run_claude 呼び出し側) だけが行う。
    """
    meta = load(chat_id, thread_id)
    if meta is None:
        return False
    record_usage(meta)
    return True
