"""Subprocess runner for ``claude -p`` invocations from the Telegram bot.

The bot's call site stays free of CLI strings: ``bot.py`` builds a
:class:`ClaudeOptions`, awaits :meth:`ClaudeRunner.run_session_prompt`, and inspects a
:class:`ClaudeResult`. A future migration to the Anthropic Agent SDK can
replace the subprocess body without touching the call site.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger("companion-bot")


class ErrorKind(Enum):
    """Error categories for surfacing only.

    Routing retries off these enum values is banned (design.md §3.2 / §10.3):
    it is stderr string matching with extra steps and reintroduces the very
    loop bug the redesign exists to kill. Sessions JSON is the single source
    of truth for what the next invocation should look like.
    """

    OK = "ok"
    NO_PRIOR_SESSION = "no_prior_session"  # --resume <missing uuid>
    SESSION_ALREADY_IN_USE = "session_already_in_use"  # --session-id <existing>
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"  # reserved, classifier TBD on real-world stderr
    OTHER = "other"


@dataclass
class ClaudeOptions:
    """Bundle of CLI arguments for one ``claude -p`` invocation."""

    session_id: str | None = None       # for first prompt of a channel
    resume_session: str | None = None   # for subsequent prompts
    output_format: str = "json"
    permission_mode: str = "auto"
    model: str = "claude-sonnet-5"      # UQ-10 の Sonnet 固定方針を踏襲、2026-07-06 に 4.6 から移行
    timeout_s: float = 300.0
    # ペルソナ等の常駐指示を default system prompt に追記する (--append-system-prompt)。
    append_system_prompt: str | None = None

    def to_cli_args(self) -> list[str]:
        if self.session_id and self.resume_session:
            raise ValueError("session_id and resume_session are mutually exclusive")
        args: list[str] = ["-p"]
        if self.session_id:
            args += ["--session-id", self.session_id]
        if self.resume_session:
            args += ["--resume", self.resume_session]
        if self.output_format:
            args += ["--output-format", self.output_format]
        if self.permission_mode:
            args += ["--permission-mode", self.permission_mode]
        if self.model:
            args += ["--model", self.model]
        if self.append_system_prompt:
            args += ["--append-system-prompt", self.append_system_prompt]
        return args


@dataclass
class ClaudeResult:
    rc: int
    error_kind: ErrorKind
    raw_stdout: str
    raw_stderr: str
    # Populated only when --output-format=json parsed successfully.
    result_text: str | None = None
    session_id: str | None = None
    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None
    model_usage: dict | None = None
    permission_denials: list[dict] = field(default_factory=list)
    terminal_reason: str | None = None
    duration_ms: int | None = None


# Stderr patterns sourced from claude CLI 2.1.141 verification (STATUS.md T-0).
# Updates require re-running S1-S5 and updating this map and STATUS.md together.
_STDERR_PATTERNS: tuple[tuple[str, ErrorKind], ...] = (
    ("No conversation found with session ID", ErrorKind.NO_PRIOR_SESSION),
    ("is already in use", ErrorKind.SESSION_ALREADY_IN_USE),
)


def _classify_stderr(stderr: str) -> ErrorKind:
    if not stderr:
        return ErrorKind.OTHER
    for needle, kind in _STDERR_PATTERNS:
        if needle in stderr:
            return kind
    return ErrorKind.OTHER


def _parse_json_stdout(stdout: str) -> dict | None:
    s = stdout.strip()
    if not s:
        return None
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _warn_if_session_id_mismatch(options: ClaudeOptions, result: ClaudeResult) -> None:
    """Surface (log only) a divergence between the requested uuid and the JSON-returned one.

    STATUS.md Watch 項目の実装 (ticket #87)。将来の CLI 仕様変更で
    `--session-id` / `--resume` に渡した uuid と JSON の session_id が乖離した
    場合の検知網。warning 止まりで state 補正・リトライはしない — 回復は
    sessions JSON を持つ側の責務 (design.md §3.2、ErrorKind docstring と同根)。
    """
    requested = options.session_id or options.resume_session
    if requested and result.session_id and result.session_id != requested:
        logger.warning(
            "claude session_id mismatch: requested=%s returned=%s (sessions JSON は requested のまま)",
            requested,
            result.session_id,
        )


def _claude_env() -> dict[str, str]:
    """Strip host auth and nested-claude markers (design.md §1.6)."""
    env = os.environ.copy()
    for key in (
        "ANTHROPIC_API_KEY",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_CODE_SESSION_ID",
    ):
        env.pop(key, None)
    return env


class ClaudeRunner:
    """Owns the asyncio Lock that serializes claude subprocess starts.

    One instance per bot process. The lock is intentionally held across both
    spawn and ``communicate()`` so we never have two ``claude -p`` processes
    fighting for credentials, output, or Max-plan quota.
    """

    def __init__(self, claude_bin: str, cwd: str | Path):
        self.claude_bin = claude_bin
        self.cwd = str(cwd)
        self.claude_lock = asyncio.Lock()

    async def run_session_prompt(self, prompt: str, options: ClaudeOptions) -> ClaudeResult:
        args = options.to_cli_args()
        async with self.claude_lock:
            try:
                proc = await asyncio.create_subprocess_exec(
                    self.claude_bin,
                    *args,
                    cwd=self.cwd,
                    env=_claude_env(),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except Exception as exc:
                logger.exception("claude subprocess failed to spawn")
                return ClaudeResult(
                    rc=-1,
                    error_kind=ErrorKind.OTHER,
                    raw_stdout="",
                    raw_stderr=f"[claude_runner] spawn failed: {exc!r}",
                )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(input=prompt.encode("utf-8")),
                    timeout=options.timeout_s,
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return ClaudeResult(
                    rc=-1,
                    error_kind=ErrorKind.TIMEOUT,
                    raw_stdout="",
                    raw_stderr=f"[claude_runner] timed out after {options.timeout_s}s",
                )

        rc = proc.returncode if proc.returncode is not None else -1
        raw_stdout = stdout_b.decode("utf-8", errors="replace").strip()
        raw_stderr = stderr_b.decode("utf-8", errors="replace").strip()
        parsed = _parse_json_stdout(raw_stdout) if options.output_format == "json" else None
        result = ClaudeResult(
            rc=rc,
            error_kind=ErrorKind.OK if rc == 0 else _classify_stderr(raw_stderr),
            raw_stdout=raw_stdout,
            raw_stderr=raw_stderr,
        )
        if parsed:
            usage = parsed.get("usage") or {}
            result.result_text = parsed.get("result")
            result.session_id = parsed.get("session_id")
            result.cost_usd = parsed.get("total_cost_usd")
            result.input_tokens = usage.get("input_tokens")
            result.output_tokens = usage.get("output_tokens")
            result.cache_creation_input_tokens = usage.get("cache_creation_input_tokens")
            result.cache_read_input_tokens = usage.get("cache_read_input_tokens")
            result.model_usage = parsed.get("modelUsage")
            result.permission_denials = parsed.get("permission_denials") or []
            result.terminal_reason = parsed.get("terminal_reason")
            result.duration_ms = parsed.get("duration_ms")
        _warn_if_session_id_mismatch(options, result)
        return result

    async def run_oneshot(self, prompt: str, options: ClaudeOptions) -> ClaudeResult:
        """Reserved for Phase 4 cron-side use; not implemented in Phase 2.5."""
        raise NotImplementedError("run_oneshot is reserved for Phase 4 cron-side use")
