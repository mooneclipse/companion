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

    def test_origin_set_on_new_thread(self) -> None:
        # チケット #96: origin (派生関心の出どころ) は非 None のときだけキーを立てる。
        out = interests.touch_thread(
            {"threads": []}, "topicA", "derived", _now(), origin="notes/2026-07-13_x.md"
        )
        self.assertEqual(out["threads"][0]["origin"], "notes/2026-07-13_x.md")

    def test_origin_absent_by_default(self) -> None:
        out = interests.touch_thread({"threads": []}, "topicA", "vault", _now())
        self.assertNotIn("origin", out["threads"][0])

    def test_origin_none_preserves_existing_origin(self) -> None:
        # origin=None (既定) の後続 touch は既存 origin を保持する (来歴を消さない)。
        data = interests.touch_thread(
            {"threads": []}, "topicA", "derived", _now(), origin="notes/x.md"
        )
        out = interests.touch_thread(
            data, "topicA", "investigation", _now(), state="researched"
        )
        t = out["threads"][0]
        self.assertEqual(t["origin"], "notes/x.md")
        self.assertEqual(t["state"], "researched")

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


class ActivityScoreTest(unittest.TestCase):
    def test_empty_index_is_zero(self) -> None:
        self.assertEqual(
            interests.activity_score({"threads": []}, _now(), freshness_days=7),
            0.0,
        )

    def test_all_touched_now_is_one(self) -> None:
        # MAX_THREADS 本すべてを今この瞬間に触った = 満点。
        threads = [
            {"topic": f"t{i}", "last_touched": _now().isoformat()}
            for i in range(interests.MAX_THREADS)
        ]
        self.assertAlmostEqual(
            interests.activity_score({"threads": threads}, _now(), freshness_days=7),
            1.0,
        )

    def test_threads_outside_window_dont_contribute(self) -> None:
        # 窓 (7日) より古いスレッドは寄与 0。新鮮 1 本のみが効く。
        old = (_now() - timedelta(days=10)).isoformat()
        fresh = _now().isoformat()
        threads = [
            {"topic": "old", "last_touched": old},
            {"topic": "fresh", "last_touched": fresh},
        ]
        score = interests.activity_score({"threads": threads}, _now(), freshness_days=7)
        # fresh 1 本 (重み 1.0) / MAX_THREADS。
        self.assertAlmostEqual(score, 1.0 / interests.MAX_THREADS)

    def test_freshness_decays_linearly(self) -> None:
        # 窓のちょうど半分の age なら重み 0.5。
        half = (_now() - timedelta(days=3.5)).isoformat()
        threads = [{"topic": "half", "last_touched": half}]
        score = interests.activity_score({"threads": threads}, _now(), freshness_days=7)
        self.assertAlmostEqual(score, 0.5 / interests.MAX_THREADS)

    def test_boundary_at_exactly_window_is_zero(self) -> None:
        edge = (_now() - timedelta(days=7)).isoformat()
        threads = [{"topic": "edge", "last_touched": edge}]
        self.assertEqual(
            interests.activity_score({"threads": threads}, _now(), freshness_days=7),
            0.0,
        )

    def test_unparseable_or_missing_timestamp_ignored(self) -> None:
        threads = [
            {"topic": "nots"},
            {"topic": "badts", "last_touched": "not-a-date"},
            {"topic": "ok", "last_touched": _now().isoformat()},
        ]
        score = interests.activity_score({"threads": threads}, _now(), freshness_days=7)
        self.assertAlmostEqual(score, 1.0 / interests.MAX_THREADS)

    def test_zero_freshness_days_is_zero(self) -> None:
        threads = [{"topic": "t", "last_touched": _now().isoformat()}]
        self.assertEqual(
            interests.activity_score({"threads": threads}, _now(), freshness_days=0),
            0.0,
        )

    def test_future_timestamp_clamped_to_full_weight(self) -> None:
        future = (_now() + timedelta(days=1)).isoformat()
        threads = [{"topic": "future", "last_touched": future}]
        score = interests.activity_score({"threads": threads}, _now(), freshness_days=7)
        self.assertAlmostEqual(score, 1.0 / interests.MAX_THREADS)


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


class ShouldInvestigateTest(unittest.TestCase):
    """should_investigate (純関数): interval ゲート + 対象スレッド選択。"""

    def _thread(self, topic, days_ago, state="active"):
        return {
            "topic": topic,
            "source": "vault",
            "last_touched": (_now() - timedelta(days=days_ago)).isoformat(),
            "state": state,
        }

    def test_never_investigated_and_active_thread_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 1)]}
        should, topic = interests.should_investigate(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(topic, "topic-a")

    def test_interval_not_elapsed_skips(self) -> None:
        last = (_now() - timedelta(days=3)).isoformat()
        data = {"threads": [self._thread("topic-a", 1)]}
        should, topic = interests.should_investigate(data, _now(), 7, last)
        self.assertFalse(should)
        self.assertIsNone(topic)

    def test_interval_elapsed_due(self) -> None:
        last = (_now() - timedelta(days=8)).isoformat()
        data = {"threads": [self._thread("topic-a", 1)]}
        should, topic = interests.should_investigate(data, _now(), 7, last)
        self.assertTrue(should)
        self.assertEqual(topic, "topic-a")

    def test_unparsable_last_investigate_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 1)]}
        should, _ = interests.should_investigate(data, _now(), 7, "not-a-date")
        self.assertTrue(should)

    def test_picks_freshest_active_thread(self) -> None:
        data = {"threads": [
            self._thread("old", 5),
            self._thread("fresh", 1),
            self._thread("mid", 3),
        ]}
        should, topic = interests.should_investigate(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(topic, "fresh")

    def test_recent_conversation_topic_excluded(self) -> None:
        data = {"threads": [self._thread("recent_conversation", 1)]}
        should, topic = interests.should_investigate(data, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(topic)

    def test_researched_state_excluded(self) -> None:
        data = {"threads": [self._thread("done-topic", 1, state="researched")]}
        should, topic = interests.should_investigate(data, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(topic)

    def test_freshest_skips_researched_picks_next(self) -> None:
        data = {"threads": [
            self._thread("done", 1, state="researched"),
            self._thread("open", 2),
        ]}
        should, topic = interests.should_investigate(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(topic, "open")

    def test_empty_index_skips(self) -> None:
        should, topic = interests.should_investigate({"threads": []}, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(topic)


class ShouldTicketTest(unittest.TestCase):
    """should_ticket (純関数): interval ゲート + 実 signal 有無 (§F でっち上げ禁止)。

    should_investigate と対称。違い = researched state を除外しない (起票は調査でない)。
    """

    def _thread(self, topic, days_ago, state="active"):
        return {
            "topic": topic,
            "source": "vault",
            "last_touched": (_now() - timedelta(days=days_ago)).isoformat(),
            "state": state,
        }

    def test_never_ticketed_and_active_thread_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 1)]}
        should, signal = interests.should_ticket(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "topic-a")

    def test_interval_not_elapsed_skips(self) -> None:
        last = (_now() - timedelta(days=3)).isoformat()
        data = {"threads": [self._thread("topic-a", 1)]}
        should, signal = interests.should_ticket(data, _now(), 7, last)
        self.assertFalse(should)
        self.assertIsNone(signal)

    def test_interval_elapsed_due(self) -> None:
        last = (_now() - timedelta(days=8)).isoformat()
        data = {"threads": [self._thread("topic-a", 1)]}
        should, signal = interests.should_ticket(data, _now(), 7, last)
        self.assertTrue(should)
        self.assertEqual(signal, "topic-a")

    def test_unparsable_last_ticket_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 1)]}
        should, _ = interests.should_ticket(data, _now(), 7, "not-a-date")
        self.assertTrue(should)

    def test_picks_freshest_active_thread(self) -> None:
        data = {"threads": [
            self._thread("old", 5),
            self._thread("fresh", 1),
            self._thread("mid", 3),
        ]}
        should, signal = interests.should_ticket(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "fresh")

    def test_recent_conversation_topic_excluded(self) -> None:
        data = {"threads": [self._thread("recent_conversation", 1)]}
        should, signal = interests.should_ticket(data, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(signal)

    def test_researched_state_NOT_excluded(self) -> None:
        # investigate と違い、調べ終えた thread からも actionable なタスクは出る。
        data = {"threads": [self._thread("done-topic", 1, state="researched")]}
        should, signal = interests.should_ticket(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "done-topic")

    def test_empty_index_skips(self) -> None:
        # §F の核: 実 signal が無ければ絶対に発火しない (でっち上げ起票をしない)。
        should, signal = interests.should_ticket({"threads": []}, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(signal)


class ShouldRemindTest(unittest.TestCase):
    """should_remind (純関数): interval ゲート + 振り返り signal 有無 (§F でっち上げ禁止)。

    should_ticket と対称。違い = freshest でなく oldest (last_touched 昇順の先頭) を
    選ぶ (振り返りは「しばらく触っていない / 調べたきり」の thread が自然なため)。
    researched state は除外しない (調べたきり放置の thread こそ振り返り対象)。
    """

    def _thread(self, topic, days_ago, state="active"):
        return {
            "topic": topic,
            "source": "vault",
            "last_touched": (_now() - timedelta(days=days_ago)).isoformat(),
            "state": state,
        }

    def test_never_reminded_and_thread_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 3)]}
        should, signal = interests.should_remind(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "topic-a")

    def test_interval_not_elapsed_skips(self) -> None:
        last = (_now() - timedelta(days=3)).isoformat()
        data = {"threads": [self._thread("topic-a", 3)]}
        should, signal = interests.should_remind(data, _now(), 7, last)
        self.assertFalse(should)
        self.assertIsNone(signal)

    def test_interval_elapsed_due(self) -> None:
        last = (_now() - timedelta(days=8)).isoformat()
        data = {"threads": [self._thread("topic-a", 3)]}
        should, signal = interests.should_remind(data, _now(), 7, last)
        self.assertTrue(should)
        self.assertEqual(signal, "topic-a")

    def test_unparsable_last_remind_is_due(self) -> None:
        data = {"threads": [self._thread("topic-a", 3)]}
        should, _ = interests.should_remind(data, _now(), 7, "not-a-date")
        self.assertTrue(should)

    def test_picks_oldest_thread_for_lookback(self) -> None:
        # 振り返りは investigate / ticket と逆向き = oldest (しばらく触っていない方) を拾う。
        data = {"threads": [
            self._thread("old", 5),
            self._thread("fresh", 1),
            self._thread("mid", 3),
        ]}
        should, signal = interests.should_remind(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "old")

    def test_recent_conversation_topic_excluded(self) -> None:
        data = {"threads": [self._thread("recent_conversation", 3)]}
        should, signal = interests.should_remind(data, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(signal)

    def test_researched_state_NOT_excluded(self) -> None:
        # 調べたきり放置の thread こそ「そういえばあれどうなった?」の振り返り対象。
        data = {"threads": [self._thread("done-topic", 4, state="researched")]}
        should, signal = interests.should_remind(data, _now(), 7, None)
        self.assertTrue(should)
        self.assertEqual(signal, "done-topic")

    def test_empty_index_skips(self) -> None:
        # §F の核: 実 signal が無ければ絶対に発火しない (でっち上げた過去を振り返らない)。
        should, signal = interests.should_remind({"threads": []}, _now(), 7, None)
        self.assertFalse(should)
        self.assertIsNone(signal)

    def test_negative_interval_skips(self) -> None:
        data = {"threads": [self._thread("topic-a", 3)]}
        should, signal = interests.should_remind(data, _now(), -1, None)
        self.assertFalse(should)
        self.assertIsNone(signal)


if __name__ == "__main__":
    unittest.main()
