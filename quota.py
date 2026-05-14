"""Budget guard and `/quota` formatting for companion-bot.

Design references:
- design.md §4.1: framing = "自衛" (bot-routed credit/quota burn protection)
- design.md §4.2: BudgetGuard ABC + RequestsCountGuard (Phase 2.5),
  CreditBudgetGuard is reserved for T-D 後半 (2026-06 上旬)
- design.md §4.6: /quota display schema (R 案 z, 6/15-unified layout with
  placeholder for the monthly-credit line until 2026-06-15)
- design.md §4.8: prompt-cache metrics (cache_creation / cache_read tokens)
  are aggregated here, never displayed as a Max-plan quota proxy
"""
from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from claude_runner import ClaudeResult

logger = logging.getLogger("companion-bot")

JST = timezone(timedelta(hours=9))
# Switchover for the placeholder on the monthly-credit line. This is a display
# concern only; BudgetGuard implementation selection is governed by the
# BOT_BUDGET_GUARD env var (design.md §4.6 last note).
MONTHLY_BUDGET_ACTIVE_FROM = datetime(2026, 6, 15, 0, 0, tzinfo=JST)

DEFAULT_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "ledger.jsonl"


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def append_ledger(entry: dict, path: Path = DEFAULT_LEDGER_PATH) -> None:
    """Append one JSON line. Atomic under POSIX for writes ≤ PIPE_BUF on a
    local fs; ledger entries are well under that, and the bot is single-process
    with claude_lock serializing record() calls so concurrent writers are not a
    concern here."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def read_ledger(path: Path = DEFAULT_LEDGER_PATH) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("ledger: skipping malformed line")
                continue
    return out


def _entries_since(entries: Iterable[dict], threshold: datetime) -> list[dict]:
    out = []
    for e in entries:
        ts = _parse_ts(e.get("timestamp"))
        if ts is not None and ts >= threshold:
            out.append(e)
    return out


def _month_start(now: datetime) -> datetime:
    """First instant of the current month in the same tz as ``now``."""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@dataclass
class BudgetSummary:
    """Common schema returned by ``BudgetGuard.summary()`` (design.md §4.6)."""

    guard_kind: str
    limit_per_hour: int | None
    count_last_1h: int
    count_last_5h: int
    cost_last_5h: float
    cost_month: float
    monthly_budget_usd: float
    monthly_budget_active: bool
    cache_creation_tokens_total: int
    cache_read_tokens_total: int
    input_tokens_total: int
    output_tokens_total: int
    last_call_at: datetime | None


class BudgetGuard(ABC):
    @abstractmethod
    def allow(self, now: datetime) -> bool: ...

    @abstractmethod
    def record(
        self,
        now: datetime,
        result: ClaudeResult,
        *,
        channel_id: int | None = None,
        session_id: str | None = None,
    ) -> None: ...

    @abstractmethod
    def summary(self, now: datetime | None = None) -> BudgetSummary: ...


class RequestsCountGuard(BudgetGuard):
    """1h sliding-window request-count guard (Phase 2.5, ~2026-06-14).

    The 1h window decides ``allow()``; ``summary()`` aggregates the wider
    windows (5h / month) required by §4.6 R 案 z and is unaffected by the
    guard kind.
    """

    def __init__(
        self,
        limit_per_hour: int = 20,
        ledger_path: Path = DEFAULT_LEDGER_PATH,
        monthly_budget_usd: float = 100.0,
    ):
        self.limit_per_hour = limit_per_hour
        self.ledger_path = ledger_path
        self.monthly_budget_usd = monthly_budget_usd

    def allow(self, now: datetime) -> bool:
        window_start = now - timedelta(hours=1)
        recent = _entries_since(read_ledger(self.ledger_path), window_start)
        return len(recent) < self.limit_per_hour

    def record(
        self,
        now: datetime,
        result: ClaudeResult,
        *,
        channel_id: int | None = None,
        session_id: str | None = None,
    ) -> None:
        entry = {
            "timestamp": now.astimezone(JST).isoformat(),
            "channel_id": channel_id,
            "session_id": session_id,
            "total_cost_usd": result.cost_usd,
            "usage": {
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "cache_creation_input_tokens": result.cache_creation_input_tokens,
                "cache_read_input_tokens": result.cache_read_input_tokens,
            },
            "modelUsage": result.model_usage,
            "terminal_reason": result.terminal_reason,
        }
        append_ledger(entry, self.ledger_path)

    def summary(self, now: datetime | None = None) -> BudgetSummary:
        now = now or datetime.now(JST)
        entries = read_ledger(self.ledger_path)
        recent_1h = _entries_since(entries, now - timedelta(hours=1))
        recent_5h = _entries_since(entries, now - timedelta(hours=5))
        month_entries = _entries_since(entries, _month_start(now.astimezone(JST)))

        cost_5h = sum(float(e.get("total_cost_usd") or 0.0) for e in recent_5h)
        cost_month = sum(float(e.get("total_cost_usd") or 0.0) for e in month_entries)
        cache_creation = sum(
            int((e.get("usage") or {}).get("cache_creation_input_tokens") or 0)
            for e in month_entries
        )
        cache_read = sum(
            int((e.get("usage") or {}).get("cache_read_input_tokens") or 0)
            for e in month_entries
        )
        input_tokens = sum(
            int((e.get("usage") or {}).get("input_tokens") or 0) for e in month_entries
        )
        output_tokens = sum(
            int((e.get("usage") or {}).get("output_tokens") or 0) for e in month_entries
        )
        last_call_at = _parse_ts(entries[-1].get("timestamp")) if entries else None

        return BudgetSummary(
            guard_kind="requests_count",
            limit_per_hour=self.limit_per_hour,
            count_last_1h=len(recent_1h),
            count_last_5h=len(recent_5h),
            cost_last_5h=cost_5h,
            cost_month=cost_month,
            monthly_budget_usd=self.monthly_budget_usd,
            monthly_budget_active=now.astimezone(JST) >= MONTHLY_BUDGET_ACTIVE_FROM,
            cache_creation_tokens_total=cache_creation,
            cache_read_tokens_total=cache_read,
            input_tokens_total=input_tokens,
            output_tokens_total=output_tokens,
            last_call_at=last_call_at,
        )


def format_summary(s: BudgetSummary) -> str:
    """Render BudgetSummary as the Discord-facing /quota message (R 案 z)."""
    lines = ["[bot 経由 prompt の集計]"]
    lines.append(
        f"直近 5h: {s.count_last_5h} 回呼び出し / 累計 cost: ${s.cost_last_5h:.4f}"
    )
    if s.monthly_budget_active:
        remaining = max(s.monthly_budget_usd - s.cost_month, 0.0)
        pct = (s.cost_month / s.monthly_budget_usd * 100.0) if s.monthly_budget_usd else 0.0
        lines.append(
            f"本月累計: ${s.cost_month:.2f} / ${s.monthly_budget_usd:.2f} "
            f"(使用 {pct:.1f}%, 残り ${remaining:.2f})"
        )
    else:
        lines.append(
            f"本月累計: ${s.cost_month:.4f} (集計中 / 新クレジット制 2026-06-15 から有効)"
        )

    total_input = (
        s.input_tokens_total
        + s.cache_read_tokens_total
        + s.cache_creation_tokens_total
    )
    if total_input > 0:
        hit_rate = s.cache_read_tokens_total / total_input * 100.0
        lines.append(
            f"prompt キャッシュ ヒット率: {hit_rate:.1f}% "
            f"(cache_read {s.cache_read_tokens_total} tokens / "
            f"total input {total_input} tokens)"
        )
    else:
        lines.append("prompt キャッシュ ヒット率: 集計データなし")
    lines.append(
        f"token 内訳: input total {s.input_tokens_total}, "
        f"output total {s.output_tokens_total}"
    )
    lines.append("")
    lines.append(
        "(これは bot 経由 prompt の集計値です。"
        "手元 claude code セッション分は含みません)"
    )
    if s.guard_kind == "requests_count" and s.limit_per_hour is not None:
        lines.append(
            f"[guard: requests_count / 直近 1h {s.count_last_1h}/{s.limit_per_hour}]"
        )
    return "\n".join(lines)


def make_budget_guard() -> BudgetGuard:
    """Construct the BudgetGuard configured via env (design.md §4.2)."""
    kind = os.environ.get("BOT_BUDGET_GUARD", "requests_count").strip()
    if kind == "requests_count":
        limit = int(os.environ.get("BOT_REQUESTS_PER_HOUR", "20"))
        return RequestsCountGuard(limit_per_hour=limit)
    if kind == "credit_usd":
        raise NotImplementedError(
            "CreditBudgetGuard is scheduled for T-D 後半 (2026-06 上旬); "
            "set BOT_BUDGET_GUARD=requests_count until then"
        )
    raise ValueError(f"unknown BOT_BUDGET_GUARD: {kind!r}")
