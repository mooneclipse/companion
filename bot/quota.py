"""Budget guard and `/quota` formatting for companion-bot.

bot 経由の `claude -p` 消費は Anthropic subscription の usage limit から引かれる
(2026-06-15 に予定された `claude -p` / Agent SDK の月次クレジット枠への分離は
公式に pause された。当面 subscription 消費前提)。ここでの guard は「bot 経由
暴走で usage limit を食い潰さない自衛」として 1h スライディング window の呼び出し
回数を見る。

金額 (total_cost_usd) は subscription 消費では実課金と一致しない API 換算の理論値に
なるため、ledger に記録せず /quota にも表示しない。観測は呼び出し回数と token 量
(input / output / cache) のみ。将来 Anthropic がクレジット枠方式を確定したら、その
時点の仕様に合わせて改めて実装する (git 履歴に旧 CreditBudgetGuard 実装が残る)。

Design references:
- design.md §4.1: framing = "自衛" (bot-routed usage-limit burn protection)
- design.md §4.2: BudgetGuard ABC + RequestsCountGuard (ENV master switch)
- design.md §4.6: /quota display schema (回数 + token 観測、金額は非表示)
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


def last_usage_for_topic(
    topic_key: str, path: Path = DEFAULT_LEDGER_PATH
) -> dict | None:
    """Return the ``usage`` dict of the most recent ledger entry for *topic_key*, or None."""
    for entry in reversed(read_ledger(path)):
        if entry.get("topic_key") == topic_key:
            return entry.get("usage")
    return None


def _entries_since(entries: Iterable[dict], threshold: datetime) -> list[dict]:
    out = []
    for e in entries:
        ts = _parse_ts(e.get("timestamp"))
        if ts is not None and ts >= threshold:
            out.append(e)
    return out


def _month_start(now: datetime) -> datetime:
    """First instant of the current month in the same tz as ``now``.

    金額集計はなくなったが、/quota の token 内訳は「本月累計」として出すため
    月初境界は引き続き使う。"""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@dataclass
class BudgetSummary:
    """Common schema returned by ``BudgetGuard.summary()`` (design.md §4.6).

    金額フィールドは持たない (subscription 消費前提、§4.6 で金額非表示)。"""

    guard_kind: str
    limit_per_hour: int | None
    count_last_1h: int
    count_last_5h: int
    cache_creation_tokens_total: int
    cache_read_tokens_total: int
    input_tokens_total: int
    output_tokens_total: int
    last_call_at: datetime | None


def _aggregate(ledger_path: Path, now: datetime) -> dict:
    """Aggregate ledger entries into the shared §4.6 schema fields."""
    # 入口で JST 正規化。CLI / テスト経由で UTC aware datetime が渡された場合でも、
    # month_start / 1h / 5h window が JST 基準で揃う (B2-2)。
    now = now.astimezone(JST)
    entries = read_ledger(ledger_path)
    recent_1h = _entries_since(entries, now - timedelta(hours=1))
    recent_5h = _entries_since(entries, now - timedelta(hours=5))
    month_entries = _entries_since(entries, _month_start(now))

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
    return {
        "count_1h": len(recent_1h),
        "count_5h": len(recent_5h),
        "cache_creation": cache_creation,
        "cache_read": cache_read,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "last_call_at": last_call_at,
    }


def _record_common(
    ledger_path: Path,
    now: datetime,
    result: ClaudeResult,
    topic_key: str | None,
    session_id: str | None,
) -> None:
    # 金額 (total_cost_usd) / modelUsage (costUSD を内包) は記録しない
    # (subscription 消費前提、§4.6)。回数 guard は ledger の行数、/quota の
    # 集計は usage tokens のみを使う。
    entry = {
        "timestamp": now.astimezone(JST).isoformat(),
        "topic_key": topic_key,
        "session_id": session_id,
        "usage": {
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cache_creation_input_tokens": result.cache_creation_input_tokens,
            "cache_read_input_tokens": result.cache_read_input_tokens,
        },
        "terminal_reason": result.terminal_reason,
    }
    # permission deny の観察 (bot-improvement-plan.md Step 2-2)。記録のみ —
    # deny ヒットを見て自動で allow を足す仕組みは作らない (拡張判断は OWNER +
    # 手元セッションの仕事)。空なら ledger entry に key を持たせない。
    if result.permission_denials:
        entry["permission_denials"] = result.permission_denials
        logger.info("permission denied: %s", result.permission_denials)
    append_ledger(entry, ledger_path)


class BudgetGuard(ABC):
    @abstractmethod
    def allow(self, now: datetime) -> bool: ...

    @abstractmethod
    def record(
        self,
        now: datetime,
        result: ClaudeResult,
        *,
        topic_key: str | None = None,
        session_id: str | None = None,
    ) -> None: ...

    @abstractmethod
    def summary(self, now: datetime | None = None) -> BudgetSummary: ...

    @abstractmethod
    def exceeded_message(self, summary: BudgetSummary) -> str: ...


class RequestsCountGuard(BudgetGuard):
    """1h sliding-window request-count guard (requests_count).

    The 1h window decides ``allow()``; ``summary()`` aggregates the wider
    windows (5h / month token totals) required by §4.6 and is unaffected by
    the guard kind.
    """

    def __init__(
        self,
        limit_per_hour: int = 20,
        ledger_path: Path = DEFAULT_LEDGER_PATH,
    ):
        self.limit_per_hour = limit_per_hour
        self.ledger_path = ledger_path

    def allow(self, now: datetime) -> bool:
        window_start = now - timedelta(hours=1)
        recent = _entries_since(read_ledger(self.ledger_path), window_start)
        return len(recent) < self.limit_per_hour

    def record(
        self,
        now: datetime,
        result: ClaudeResult,
        *,
        topic_key: str | None = None,
        session_id: str | None = None,
    ) -> None:
        _record_common(self.ledger_path, now, result, topic_key, session_id)

    def summary(self, now: datetime | None = None) -> BudgetSummary:
        now = now or datetime.now(JST)
        agg = _aggregate(self.ledger_path, now)
        return BudgetSummary(
            guard_kind="requests_count",
            limit_per_hour=self.limit_per_hour,
            count_last_1h=agg["count_1h"],
            count_last_5h=agg["count_5h"],
            cache_creation_tokens_total=agg["cache_creation"],
            cache_read_tokens_total=agg["cache_read"],
            input_tokens_total=agg["input_tokens"],
            output_tokens_total=agg["output_tokens"],
            last_call_at=agg["last_call_at"],
        )

    def exceeded_message(self, summary: BudgetSummary) -> str:
        return (
            f"[budget guard] 直近 1h あたり {summary.limit_per_hour} 回の上限に到達しました "
            f"(現在 {summary.count_last_1h} 回)。"
            "古い記録が window から外れるまでお待ちください。"
        )


def format_summary(s: BudgetSummary) -> str:
    """Render BudgetSummary as the Telegram-facing /quota message (§4.6).

    金額は出さない (subscription 消費前提)。回数と token 量のみを観測値として表示。"""
    lines = ["[bot 経由 prompt の集計]"]
    lines.append(f"直近 5h: {s.count_last_5h} 回呼び出し")

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
        f"token 内訳 (本月): input total {s.input_tokens_total}, "
        f"output total {s.output_tokens_total}"
    )
    lines.append("")
    lines.append(
        "(これは bot 経由 prompt の集計値です。"
        "subscription の usage limit に対する公式利用率ではありません。"
        "手元 claude code セッション分も含みません)"
    )
    if s.guard_kind == "requests_count" and s.limit_per_hour is not None:
        lines.append(
            f"[guard: requests_count / 直近 1h {s.count_last_1h}/{s.limit_per_hour}]"
        )
    return "\n".join(lines)


def make_budget_guard() -> BudgetGuard:
    """Construct the BudgetGuard configured via env (design.md §4.2).

    `BOT_REQUESTS_PER_HOUR` は正の整数の early validation を行う。誤設定
    (負値・非数値) で bot が黙って全 deny に倒れたり、ValueError を遅延発火
    (allow() 呼び出し時) するのを防ぐ (B2-4)。
    """
    kind = os.environ.get("BOT_BUDGET_GUARD", "requests_count").strip()
    if kind == "requests_count":
        limit_raw = os.environ.get("BOT_REQUESTS_PER_HOUR", "20")
        try:
            limit = int(limit_raw)
        except ValueError as e:
            raise ValueError(
                f"BOT_REQUESTS_PER_HOUR must be a positive integer, got: {limit_raw!r}"
            ) from e
        if limit <= 0:
            raise ValueError(
                f"BOT_REQUESTS_PER_HOUR must be > 0, got: {limit}"
            )
        return RequestsCountGuard(limit_per_hour=limit)
    raise ValueError(f"unknown BOT_BUDGET_GUARD: {kind!r}")
