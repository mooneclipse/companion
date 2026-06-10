"""Unit tests for bot/quota.py (BudgetGuard + format_summary + make_budget_guard).

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

Covered:
- RequestsCountGuard / CreditBudgetGuard allow() boundary
- CreditBudgetGuard JST month-boundary (B2-2 normalization)
- format_summary() rendering for both guard_kinds
- make_budget_guard() env switch + env-value validation (B2-4)
- exceeded_message() responsibility lives in each guard (T-D 後半 移譲)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import quota  # noqa: E402
from claude_runner import ClaudeResult, ErrorKind  # noqa: E402

JST = quota.JST
UTC = timezone.utc


def _make_entry(ts: datetime, cost: float, **usage: int) -> dict:
    """Compose one ledger.jsonl line matching `_record_common` schema."""
    return {
        "timestamp": ts.astimezone(JST).isoformat(),
        "topic_key": "-1001234567890_2",
        "session_id": "00000000-0000-0000-0000-000000000000",
        "total_cost_usd": cost,
        "usage": {
            "input_tokens": usage.get("input", 0),
            "output_tokens": usage.get("output", 0),
            "cache_creation_input_tokens": usage.get("cache_creation", 0),
            "cache_read_input_tokens": usage.get("cache_read", 0),
        },
        "modelUsage": {},
        "terminal_reason": "ok",
    }


def _write_ledger(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


class TempLedgerCase(unittest.TestCase):
    """Common fixture: each test gets a fresh ledger.jsonl in a tmpdir."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.ledger_path = Path(self._tmp.name) / "ledger.jsonl"

    def tearDown(self) -> None:
        self._tmp.cleanup()


class AggregateJstNormalizationTest(TempLedgerCase):
    """B2-2: `_aggregate` normalizes `now` to JST so the month-boundary is
    JST-based regardless of caller-supplied tz."""

    def test_utc_now_uses_jst_month_boundary(self) -> None:
        # JST 2026-06-01 00:00 = UTC 2026-05-31 15:00. Entries on 2026-05-31
        # 14:00 UTC (JST 23:00, 5/31) must be excluded from "this month" when
        # `now` is UTC 2026-05-31 16:00 (JST 6/1 01:00).
        prev_month = datetime(2026, 5, 31, 14, 0, tzinfo=UTC)
        this_month = datetime(2026, 5, 31, 15, 30, tzinfo=UTC)  # JST 6/1 00:30
        _write_ledger(self.ledger_path, [
            _make_entry(prev_month, 50.0),
            _make_entry(this_month, 2.5),
        ])
        now_utc = datetime(2026, 5, 31, 16, 0, tzinfo=UTC)  # JST 6/1 01:00
        agg = quota._aggregate(self.ledger_path, now_utc)
        self.assertAlmostEqual(agg["cost_month"], 2.5, places=4)


class RequestsCountGuardTest(TempLedgerCase):

    def _seed(self, count: int, *, now: datetime, cost_each: float = 0.0) -> None:
        entries = [
            _make_entry(now - timedelta(minutes=5 * i), cost_each)
            for i in range(count)
        ]
        _write_ledger(self.ledger_path, entries)

    def test_under_limit_allows(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        self._seed(5, now=now)
        guard = quota.RequestsCountGuard(limit_per_hour=10, ledger_path=self.ledger_path)
        self.assertTrue(guard.allow(now))

    def test_at_limit_rejects(self) -> None:
        # `< limit_per_hour` semantics: exactly-at-limit must reject.
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        self._seed(10, now=now)
        guard = quota.RequestsCountGuard(limit_per_hour=10, ledger_path=self.ledger_path)
        self.assertFalse(guard.allow(now))

    def test_summary_schema(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        self._seed(3, now=now, cost_each=0.1)
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        s = guard.summary(now)
        self.assertEqual(s.guard_kind, "requests_count")
        self.assertEqual(s.limit_per_hour, 20)
        self.assertEqual(s.count_last_1h, 3)
        self.assertAlmostEqual(s.cost_month, 0.3, places=4)


class CreditBudgetGuardTest(TempLedgerCase):

    def test_under_budget_allows(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 50.0)])
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        self.assertTrue(guard.allow(now))

    def test_at_budget_rejects(self) -> None:
        # `<` semantics: cost_month == monthly_budget_usd must reject.
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 100.0)])
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        self.assertFalse(guard.allow(now))

    def test_month_reset_at_jst_midnight(self) -> None:
        # JST 5/31 23:59 entry (over budget) must NOT count after JST 6/1 00:00.
        prev_month = datetime(2026, 5, 31, 23, 59, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(prev_month, 100.0)])
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        # Just before reset: rejected.
        self.assertFalse(guard.allow(prev_month))
        # 1 minute after reset: allowed (cost_month resets to 0).
        new_month = datetime(2026, 6, 1, 0, 1, tzinfo=JST)
        self.assertTrue(guard.allow(new_month))

    def test_record_appends_ledger(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, input_tokens=10, output_tokens=20,
            cache_creation_input_tokens=0, cache_read_input_tokens=100,
            terminal_reason="ok",
        )
        guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertEqual(len(entries), 1)
        self.assertAlmostEqual(entries[0]["total_cost_usd"], 0.05, places=4)
        self.assertEqual(entries[0]["topic_key"], "-1001234567890_2")

    def test_record_includes_permission_denials_when_present(self) -> None:
        # Step 2-2: deny の観察 (記録のみ、自動 allow 拡張はしない)。
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        denials = [{"tool_name": "Read", "tool_input": {"file_path": "/home/miho/.ssh/id_ed25519"}}]
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, permission_denials=denials, terminal_reason="ok",
        )
        with self.assertLogs("companion-bot", level="INFO") as cm:
            guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertEqual(entries[0]["permission_denials"], denials)
        # 非空のとき bot.log (companion-bot logger) に INFO で残ること。
        self.assertTrue(any("permission denied" in m for m in cm.output))

    def test_record_omits_permission_denials_when_empty(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, terminal_reason="ok",
        )
        guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertNotIn("permission_denials", entries[0])


class FormatSummaryTest(TempLedgerCase):

    def test_credit_usd_kind_renders_guard_tag(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 12.34, input=100, output=200, cache_read=500)])
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        out = quota.format_summary(guard.summary(now))
        self.assertIn("[guard: credit_usd / 本月 $12.34/$100.00]", out)
        self.assertIn("本月累計: $12.34 / $100.00", out)

    def test_requests_count_kind_renders_guard_tag(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 0.05)])
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        out = quota.format_summary(guard.summary(now))
        self.assertIn("[guard: requests_count / 直近 1h 1/20]", out)


class MakeBudgetGuardTest(unittest.TestCase):
    """Env-driven factory + value validation (B2-4)."""

    def setUp(self) -> None:
        self._env_snapshot = {
            k: os.environ.get(k)
            for k in ("BOT_BUDGET_GUARD", "BOT_REQUESTS_PER_HOUR", "BOT_MONTHLY_CREDIT_USD")
        }

    def tearDown(self) -> None:
        for k, v in self._env_snapshot.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _set(self, **env: str) -> None:
        for k, v in env.items():
            os.environ[k] = v

    def test_env_switch_credit_usd(self) -> None:
        self._set(BOT_BUDGET_GUARD="credit_usd", BOT_MONTHLY_CREDIT_USD="50")
        guard = quota.make_budget_guard()
        self.assertIsInstance(guard, quota.CreditBudgetGuard)
        self.assertAlmostEqual(guard.monthly_budget_usd, 50.0)

    def test_env_switch_requests_count(self) -> None:
        self._set(BOT_BUDGET_GUARD="requests_count", BOT_REQUESTS_PER_HOUR="15")
        guard = quota.make_budget_guard()
        self.assertIsInstance(guard, quota.RequestsCountGuard)
        self.assertEqual(guard.limit_per_hour, 15)

    def test_invalid_credit_value_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="credit_usd", BOT_MONTHLY_CREDIT_USD="abc")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()

    def test_negative_credit_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="credit_usd", BOT_MONTHLY_CREDIT_USD="-5")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()

    def test_unknown_kind_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="bogus")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()


class ExceededMessageTest(TempLedgerCase):
    """T-D 後半: `exceeded_message()` lives in each guard (bot.py hardcode 撤去)."""

    def test_requests_count_message_includes_limit(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 0.01) for _ in range(20)])
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        msg = guard.exceeded_message(guard.summary(now))
        self.assertIn("20 回", msg)
        self.assertIn("window", msg)

    def test_credit_usd_message_includes_cost_and_budget(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now, 100.0)])
        guard = quota.CreditBudgetGuard(monthly_budget_usd=100.0, ledger_path=self.ledger_path)
        msg = guard.exceeded_message(guard.summary(now))
        self.assertIn("$100.00", msg)
        self.assertIn("月初", msg)


if __name__ == "__main__":
    unittest.main()
