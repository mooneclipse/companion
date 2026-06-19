"""Unit tests for interests.py (関心 state 機構 1、純関数 + atomic IO)。

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

interests.py は env を読まないので import は無条件 (bot.py のような stub 不要)。
"""
from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import interests  # noqa: E402  (sys.path 調整後に import するため)

JST = timezone(timedelta(hours=9))


def _now() -> datetime:
    return datetime(2026, 6, 19, 12, 0, 0, tzinfo=JST)


class LoadSaveTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._path = Path(self._tmp.name) / "companion_interests.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_load_missing_returns_empty(self) -> None:
        self.assertEqual(interests.load_interests(self._path), {"threads": []})

    def test_load_corrupt_returns_empty(self) -> None:
        self._path.write_text("{not json", encoding="utf-8")
        self.assertEqual(interests.load_interests(self._path), {"threads": []})

    def test_load_wrong_shape_returns_empty(self) -> None:
        self._path.write_text('{"threads": "oops"}', encoding="utf-8")
        self.assertEqual(interests.load_interests(self._path), {"threads": []})

    def test_save_then_load_roundtrip(self) -> None:
        data = {"threads": [{"topic": "x", "source": "s", "last_touched": "t", "state": "active"}]}
        interests.save_interests(self._path, data)
        self.assertEqual(interests.load_interests(self._path), data)

    def test_save_is_atomic_no_tmp_left(self) -> None:
        interests.save_interests(self._path, {"threads": []})
        # tmp ファイルが残らない (os.replace で本体に置き換わる)。
        self.assertFalse((self._path.with_suffix(self._path.suffix + ".tmp")).exists())
        self.assertTrue(self._path.exists())

    def test_save_mode_is_0600_under_umask(self) -> None:
        old = os.umask(0o077)
        try:
            interests.save_interests(self._path, {"threads": []})
        finally:
            os.umask(old)
        mode = stat.S_IMODE(self._path.stat().st_mode)
        self.assertEqual(mode, 0o600)


class TouchThreadTest(unittest.TestCase):
    def test_adds_new_thread(self) -> None:
        out = interests.touch_thread({"threads": []}, "topicA", "vault", _now())
        self.assertEqual(len(out["threads"]), 1)
        t = out["threads"][0]
        self.assertEqual(t["topic"], "topicA")
        self.assertEqual(t["source"], "vault")
        self.assertEqual(t["last_touched"], _now().isoformat())
        self.assertEqual(t["state"], "active")

    def test_does_not_mutate_input(self) -> None:
        data = {"threads": []}
        interests.touch_thread(data, "topicA", "vault", _now())
        self.assertEqual(data, {"threads": []})

    def test_existing_topic_updates_in_place(self) -> None:
        old = _now() - timedelta(days=1)
        data = {"threads": [{
            "topic": "topicA", "source": "old", "last_touched": old.isoformat(), "state": "active",
        }]}
        out = interests.touch_thread(data, "topicA", "new", _now(), state="warm")
        self.assertEqual(len(out["threads"]), 1)
        t = out["threads"][0]
        self.assertEqual(t["source"], "new")
        self.assertEqual(t["state"], "warm")
        self.assertEqual(t["last_touched"], _now().isoformat())

    def test_caps_at_max_threads_drops_oldest(self) -> None:
        base = _now() - timedelta(days=10)
        threads = []
        for i in range(interests.MAX_THREADS):
            threads.append({
                "topic": f"t{i}", "source": "s",
                "last_touched": (base + timedelta(hours=i)).isoformat(),
                "state": "active",
            })
        data = {"threads": threads}
        # t0 が最古。新規追加で MAX 超過 → t0 が落ちる。
        out = interests.touch_thread(data, "new", "s", _now())
        topics = {t["topic"] for t in out["threads"]}
        self.assertEqual(len(out["threads"]), interests.MAX_THREADS)
        self.assertIn("new", topics)
        self.assertNotIn("t0", topics)


class DecayTest(unittest.TestCase):
    def test_removes_threads_past_ttl(self) -> None:
        old = (_now() - timedelta(days=20)).isoformat()
        fresh = (_now() - timedelta(days=2)).isoformat()
        data = {"threads": [
            {"topic": "old", "source": "s", "last_touched": old, "state": "active"},
            {"topic": "fresh", "source": "s", "last_touched": fresh, "state": "active"},
        ]}
        out = interests.decay(data, _now(), ttl_days=14)
        topics = {t["topic"] for t in out["threads"]}
        self.assertEqual(topics, {"fresh"})

    def test_does_not_mutate_input(self) -> None:
        old = (_now() - timedelta(days=20)).isoformat()
        data = {"threads": [{"topic": "old", "source": "s", "last_touched": old, "state": "active"}]}
        interests.decay(data, _now(), ttl_days=14)
        self.assertEqual(len(data["threads"]), 1)

    def test_drops_thread_without_parseable_timestamp(self) -> None:
        data = {"threads": [
            {"topic": "nots", "source": "s", "state": "active"},
            {"topic": "badts", "source": "s", "last_touched": "not-a-date", "state": "active"},
            {"topic": "ok", "source": "s", "last_touched": _now().isoformat(), "state": "active"},
        ]}
        out = interests.decay(data, _now(), ttl_days=14)
        self.assertEqual({t["topic"] for t in out["threads"]}, {"ok"})

    def test_boundary_at_exactly_ttl_kept(self) -> None:
        edge = (_now() - timedelta(days=14)).isoformat()
        data = {"threads": [{"topic": "edge", "source": "s", "last_touched": edge, "state": "active"}]}
        out = interests.decay(data, _now(), ttl_days=14)
        self.assertEqual(len(out["threads"]), 1)


class ActiveThreadsTest(unittest.TestCase):
    def test_returns_most_recent_first_limited(self) -> None:
        base = _now()
        threads = [
            {"topic": "a", "last_touched": (base - timedelta(days=3)).isoformat()},
            {"topic": "b", "last_touched": (base - timedelta(days=1)).isoformat()},
            {"topic": "c", "last_touched": (base - timedelta(days=2)).isoformat()},
        ]
        out = interests.active_threads({"threads": threads}, base, limit=2)
        self.assertEqual([t["topic"] for t in out], ["b", "c"])

    def test_limit_zero_returns_empty(self) -> None:
        threads = [{"topic": "a", "last_touched": _now().isoformat()}]
        self.assertEqual(interests.active_threads({"threads": threads}, _now(), limit=0), [])

    def test_empty_index(self) -> None:
        self.assertEqual(interests.active_threads({"threads": []}, _now(), limit=3), [])


class AppendThoughtTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._path = Path(self._tmp.name) / "companion_thoughts.jsonl"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_appends_one_line_per_call(self) -> None:
        interests.append_thought(self._path, "観察 1", _now())
        interests.append_thought(self._path, "観察 2", _now())
        lines = [l for l in self._path.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)
        rec = json.loads(lines[0])
        self.assertEqual(rec["observation"], "観察 1")
        self.assertEqual(rec["timestamp"], _now().isoformat())


if __name__ == "__main__":
    unittest.main()
