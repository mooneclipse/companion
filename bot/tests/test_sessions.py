"""Unit tests for bot/sessions.py after the Telegram cold cut.

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

Covered:
- topic_key() formatting (General topic = ``_general`` suffix, §2.3)
- SessionMeta.topic_key property mirrors module function
- save/load round-trip preserves chat_id + thread_id + None handling
- start_or_resume allocates uuid4 on first call, returns existing on second
- reset() removes file and returns True/False appropriately
- General topic (thread_id=None) and numeric thread_id=0 do not collide
"""
from __future__ import annotations

import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402


class SessionsCase(unittest.TestCase):
    """Common fixture: redirect _SESSIONS_DIR to a tmpdir for each test."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_dir = sessions._SESSIONS_DIR
        sessions._SESSIONS_DIR = Path(self._tmp.name) / "topics"

    def tearDown(self) -> None:
        sessions._SESSIONS_DIR = self._orig_dir
        self._tmp.cleanup()


class TopicKeyTest(unittest.TestCase):

    def test_general_topic_uses_general_suffix(self) -> None:
        # thread_id=None → '_general' literal suffix (§2.3, 数値 0 衝突回避)
        self.assertEqual(sessions.topic_key(-1001234567890, None), "-1001234567890_general")

    def test_numeric_thread_id_formats_as_int(self) -> None:
        self.assertEqual(sessions.topic_key(-1001234567890, 2), "-1001234567890_2")
        self.assertEqual(sessions.topic_key(-1001234567890, 5), "-1001234567890_5")

    def test_thread_id_zero_distinct_from_none(self) -> None:
        # 設計 §2.3: General(None) と numeric 0 が衝突しないこと
        self.assertNotEqual(
            sessions.topic_key(-1001234567890, None),
            sessions.topic_key(-1001234567890, 0),
        )


class RoundTripTest(SessionsCase):

    def test_save_load_with_thread_id(self) -> None:
        meta, is_new = sessions.start_or_resume(-1001234567890, 2)
        self.assertTrue(is_new)
        self.assertEqual(meta.chat_id, -1001234567890)
        self.assertEqual(meta.thread_id, 2)
        # uuid4 string
        uuid.UUID(meta.session_id)

        loaded = sessions.load(-1001234567890, 2)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.chat_id, -1001234567890)
        self.assertEqual(loaded.thread_id, 2)
        self.assertEqual(loaded.session_id, meta.session_id)
        self.assertEqual(loaded.topic_key, "-1001234567890_2")

    def test_save_load_general_topic(self) -> None:
        meta, is_new = sessions.start_or_resume(-1001234567890, None)
        self.assertTrue(is_new)
        self.assertIsNone(meta.thread_id)
        self.assertEqual(meta.topic_key, "-1001234567890_general")

        loaded = sessions.load(-1001234567890, None)
        self.assertIsNotNone(loaded)
        self.assertIsNone(loaded.thread_id)
        self.assertEqual(loaded.session_id, meta.session_id)

    def test_start_or_resume_returns_existing(self) -> None:
        meta1, is_new1 = sessions.start_or_resume(-1001234567890, 3)
        meta2, is_new2 = sessions.start_or_resume(-1001234567890, 3)
        self.assertTrue(is_new1)
        self.assertFalse(is_new2)
        self.assertEqual(meta1.session_id, meta2.session_id)

    def test_distinct_threads_get_distinct_sessions(self) -> None:
        meta_chat, _ = sessions.start_or_resume(-1001234567890, 2)
        meta_research, _ = sessions.start_or_resume(-1001234567890, 3)
        self.assertNotEqual(meta_chat.session_id, meta_research.session_id)

    def test_general_and_thread_zero_get_distinct_files(self) -> None:
        meta_general, _ = sessions.start_or_resume(-1001234567890, None)
        meta_zero, _ = sessions.start_or_resume(-1001234567890, 0)
        self.assertNotEqual(meta_general.session_id, meta_zero.session_id)
        # 別 file として永続化されていること
        self.assertTrue((sessions._SESSIONS_DIR / "-1001234567890_general.json").exists())
        self.assertTrue((sessions._SESSIONS_DIR / "-1001234567890_0.json").exists())


class ResetTest(SessionsCase):

    def test_reset_removes_file(self) -> None:
        sessions.start_or_resume(-1001234567890, 2)
        self.assertTrue(sessions.reset(-1001234567890, 2))
        self.assertIsNone(sessions.load(-1001234567890, 2))

    def test_reset_missing_returns_false(self) -> None:
        self.assertFalse(sessions.reset(-1001234567890, 99))

    def test_reset_general_topic(self) -> None:
        sessions.start_or_resume(-1001234567890, None)
        self.assertTrue(sessions.reset(-1001234567890, None))
        self.assertIsNone(sessions.load(-1001234567890, None))


class RecordUsageTest(SessionsCase):

    def test_record_usage_increments_count(self) -> None:
        meta, _ = sessions.start_or_resume(-1001234567890, 2)
        self.assertEqual(meta.prompt_count, 0)
        sessions.record_usage(meta)
        loaded = sessions.load(-1001234567890, 2)
        self.assertEqual(loaded.prompt_count, 1)
        self.assertIsNotNone(loaded.last_prompt_at)


class RecordUsageIfExistsTest(SessionsCase):

    def test_absent_state_returns_false_and_creates_nothing(self) -> None:
        # 幻 session 防止の本体: state が無いとき発番・保存を一切しない
        # (2026-07-13 実障害: proactive が /reset 後に幻 uuid を保存し、次の
        # ユーザー発話の --resume が no_prior_session で落ちた)
        self.assertFalse(sessions.record_usage_if_exists(-1001234567890, 2))
        self.assertIsNone(sessions.load(-1001234567890, 2))

    def test_existing_state_updates_and_returns_true(self) -> None:
        meta, _ = sessions.start_or_resume(-1001234567890, 2)
        self.assertTrue(sessions.record_usage_if_exists(-1001234567890, 2))
        loaded = sessions.load(-1001234567890, 2)
        self.assertEqual(loaded.prompt_count, 1)
        self.assertIsNotNone(loaded.last_prompt_at)
        self.assertEqual(loaded.session_id, meta.session_id)


class PendingContextTest(SessionsCase):
    """append/pop_pending_context (チケット #126、ephemeral 自発発話の未読控え)。"""

    def setUp(self) -> None:
        super().setUp()
        self._orig_pending = sessions._PENDING_DIR
        sessions._PENDING_DIR = Path(self._tmp.name) / "pending"

    def tearDown(self) -> None:
        sessions._PENDING_DIR = self._orig_pending
        super().tearDown()

    def test_pop_without_append_returns_empty(self) -> None:
        self.assertEqual(sessions.pop_pending_context(-1001234567890, 3), [])

    def test_append_then_pop_round_trip(self) -> None:
        sessions.append_pending_context(-1001234567890, 3, "そういえばRoute53の件")
        entries = sessions.pop_pending_context(-1001234567890, 3)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["text"], "そういえばRoute53の件")
        self.assertIn("at", entries[0])

    def test_pop_consumes_entries(self) -> None:
        # read + delete を 1 回で確定 (2 回目は空)
        sessions.append_pending_context(-1001234567890, 3, "a")
        self.assertEqual(len(sessions.pop_pending_context(-1001234567890, 3)), 1)
        self.assertEqual(sessions.pop_pending_context(-1001234567890, 3), [])

    def test_entries_capped_at_max_keeping_newest(self) -> None:
        for i in range(sessions._PENDING_MAX_ENTRIES + 2):
            sessions.append_pending_context(-1001234567890, 3, f"msg{i}")
        entries = sessions.pop_pending_context(-1001234567890, 3)
        self.assertEqual(len(entries), sessions._PENDING_MAX_ENTRIES)
        self.assertEqual(entries[-1]["text"], f"msg{sessions._PENDING_MAX_ENTRIES + 1}")

    def test_text_capped_at_max_length(self) -> None:
        sessions.append_pending_context(-1001234567890, 3, "x" * 1000)
        entries = sessions.pop_pending_context(-1001234567890, 3)
        self.assertEqual(len(entries[0]["text"]), sessions._PENDING_MAX_TEXT)

    def test_topics_are_isolated(self) -> None:
        sessions.append_pending_context(-1001234567890, 3, "chat側")
        self.assertEqual(sessions.pop_pending_context(-1001234567890, 4), [])
        self.assertEqual(len(sessions.pop_pending_context(-1001234567890, 3)), 1)

    def test_corrupt_file_is_discarded(self) -> None:
        # 壊れた控えは補助情報なので捨てて空扱い (復旧リトライを作らない)
        sessions._PENDING_DIR.mkdir(parents=True, exist_ok=True)
        path = sessions._pending_path_for(-1001234567890, 3)
        path.write_text("not json", encoding="utf-8")
        self.assertEqual(sessions.pop_pending_context(-1001234567890, 3), [])
        self.assertFalse(path.exists())
        path.write_text("not json", encoding="utf-8")
        sessions.append_pending_context(-1001234567890, 3, "recovered")
        entries = sessions.pop_pending_context(-1001234567890, 3)
        self.assertEqual([e["text"] for e in entries], ["recovered"])


if __name__ == "__main__":
    unittest.main()
