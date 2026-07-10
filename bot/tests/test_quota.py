"""Unit tests for bot/quota.py (RequestsCountGuard + format_summary + make_budget_guard).

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

Covered:
- RequestsCountGuard allow() boundary (1h sliding window)
- _aggregate JST month-boundary normalization for token totals (B2-2)
- format_summary() rendering (回数 + token 観測、金額は出さない)
- make_budget_guard() env switch + env-value validation (B2-4)
- exceeded_message() responsibility lives in the guard
- record() ledger schema (金額 / modelUsage は記録しない、permission_denials の有無)

2026-06-15 の月次クレジット枠分離は公式 pause のため CreditBudgetGuard /
credit_usd は撤去済 (subscription 消費前提)。旧テストは git 履歴に残る。
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


def _make_entry(ts: datetime, **usage: int) -> dict:
    """Compose one ledger.jsonl line matching `_record_common` schema (金額なし)."""
    return {
        "timestamp": ts.astimezone(JST).isoformat(),
        "topic_key": "-1001234567890_2",
        "session_id": "00000000-0000-0000-0000-000000000000",
        "usage": {
            "input_tokens": usage.get("input", 0),
            "output_tokens": usage.get("output", 0),
            "cache_creation_input_tokens": usage.get("cache_creation", 0),
            "cache_read_input_tokens": usage.get("cache_read", 0),
        },
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
    JST-based regardless of caller-supplied tz. Verified via token month-total."""

    def test_utc_now_uses_jst_month_boundary(self) -> None:
        # JST 2026-06-01 00:00 = UTC 2026-05-31 15:00. An entry on 2026-05-31
        # 14:00 UTC (JST 23:00, 5/31) must be excluded from "this month" when
        # `now` is UTC 2026-05-31 16:00 (JST 6/1 01:00).
        prev_month = datetime(2026, 5, 31, 14, 0, tzinfo=UTC)
        this_month = datetime(2026, 5, 31, 15, 30, tzinfo=UTC)  # JST 6/1 00:30
        _write_ledger(self.ledger_path, [
            _make_entry(prev_month, input=500),
            _make_entry(this_month, input=25),
        ])
        now_utc = datetime(2026, 5, 31, 16, 0, tzinfo=UTC)  # JST 6/1 01:00
        agg = quota._aggregate(self.ledger_path, now_utc)
        self.assertEqual(agg["input_tokens"], 25)


class RequestsCountGuardTest(TempLedgerCase):

    def _seed(self, count: int, *, now: datetime) -> None:
        entries = [
            _make_entry(now - timedelta(minutes=5 * i))
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
        _write_ledger(self.ledger_path, [
            _make_entry(now, input=10, output=20, cache_read=500)
            for _ in range(3)
        ])
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        s = guard.summary(now)
        self.assertEqual(s.guard_kind, "requests_count")
        self.assertEqual(s.limit_per_hour, 20)
        self.assertEqual(s.count_last_1h, 3)
        self.assertEqual(s.input_tokens_total, 30)
        self.assertEqual(s.output_tokens_total, 60)
        self.assertEqual(s.cache_read_tokens_total, 1500)
        # 金額フィールドは存在しない (subscription 消費前提)。
        self.assertFalse(hasattr(s, "cost_month"))
        self.assertFalse(hasattr(s, "monthly_budget_usd"))

    def test_record_appends_ledger_without_cost(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, input_tokens=10, output_tokens=20,
            cache_creation_input_tokens=0, cache_read_input_tokens=100,
            terminal_reason="ok",
        )
        guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertEqual(len(entries), 1)
        # 金額 / modelUsage は記録しない。
        self.assertNotIn("total_cost_usd", entries[0])
        self.assertNotIn("modelUsage", entries[0])
        self.assertEqual(entries[0]["usage"]["input_tokens"], 10)
        self.assertEqual(entries[0]["usage"]["cache_read_input_tokens"], 100)
        self.assertEqual(entries[0]["topic_key"], "-1001234567890_2")

    def test_record_includes_permission_denials_when_present(self) -> None:
        # Step 2-2: deny の観察 (記録のみ、自動 allow 拡張はしない)。
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        denials = [{"tool_name": "Read", "tool_input": {"file_path": "/home/miho/.ssh/id_ed25519"}}]
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, permission_denials=denials, terminal_reason="ok",
        )
        with self.assertLogs("companion-bot", level="INFO") as cm:
            guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertEqual(entries[0]["permission_denials"], denials)
        self.assertTrue(any("permission denied" in m for m in cm.output))

    def test_record_omits_permission_denials_when_empty(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        result = ClaudeResult(
            rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
            cost_usd=0.05, terminal_reason="ok",
        )
        guard.record(now, result, topic_key="-1001234567890_2", session_id="abc")
        entries = quota.read_ledger(self.ledger_path)
        self.assertNotIn("permission_denials", entries[0])


class FormatSummaryTest(TempLedgerCase):

    def test_requests_count_renders_guard_tag_no_money(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [
            _make_entry(now, input=100, output=200, cache_read=500)
        ])
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        out = quota.format_summary(guard.summary(now))
        self.assertIn("[guard: requests_count / 直近 1h 1/20]", out)
        self.assertIn("直近 5h: 1 回呼び出し", out)
        self.assertIn("token 内訳 (本月)", out)
        # 金額は一切出さない。
        self.assertNotIn("$", out)
        self.assertNotIn("本月累計", out)


class MakeBudgetGuardTest(unittest.TestCase):
    """Env-driven factory + value validation (B2-4)."""

    def setUp(self) -> None:
        self._env_snapshot = {
            k: os.environ.get(k)
            for k in ("BOT_BUDGET_GUARD", "BOT_REQUESTS_PER_HOUR")
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

    def test_env_switch_requests_count(self) -> None:
        self._set(BOT_BUDGET_GUARD="requests_count", BOT_REQUESTS_PER_HOUR="15")
        guard = quota.make_budget_guard()
        self.assertIsInstance(guard, quota.RequestsCountGuard)
        self.assertEqual(guard.limit_per_hour, 15)

    def test_default_is_requests_count(self) -> None:
        os.environ.pop("BOT_BUDGET_GUARD", None)
        os.environ.pop("BOT_REQUESTS_PER_HOUR", None)
        guard = quota.make_budget_guard()
        self.assertIsInstance(guard, quota.RequestsCountGuard)
        self.assertEqual(guard.limit_per_hour, 20)

    def test_invalid_requests_value_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="requests_count", BOT_REQUESTS_PER_HOUR="abc")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()

    def test_negative_requests_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="requests_count", BOT_REQUESTS_PER_HOUR="-5")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()

    def test_unknown_kind_raises(self) -> None:
        # credit_usd は撤去済 → unknown 扱いで raise する。
        self._set(BOT_BUDGET_GUARD="credit_usd")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()

    def test_bogus_kind_raises(self) -> None:
        self._set(BOT_BUDGET_GUARD="bogus")
        with self.assertRaises(ValueError):
            quota.make_budget_guard()


class ExceededMessageTest(TempLedgerCase):
    """`exceeded_message()` lives in the guard (bot.py hardcode 撤去)."""

    def test_requests_count_message_includes_limit(self) -> None:
        now = datetime(2026, 5, 20, 12, 0, tzinfo=JST)
        _write_ledger(self.ledger_path, [_make_entry(now) for _ in range(20)])
        guard = quota.RequestsCountGuard(limit_per_hour=20, ledger_path=self.ledger_path)
        msg = guard.exceeded_message(guard.summary(now))
        self.assertIn("20 回", msg)
        self.assertIn("window", msg)


if __name__ == "__main__":
    unittest.main()
