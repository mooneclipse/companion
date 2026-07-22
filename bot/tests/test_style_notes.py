"""Unit tests for style_notes.py (口調フィードバック state、純関数 + atomic IO)。

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

style_notes.py は env を読まないので import は無条件 (bot.py のような stub 不要、
interests.py と同様)。
"""
from __future__ import annotations

import os
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import style_notes  # noqa: E402  (sys.path 調整後に import するため)

JST = timezone(timedelta(hours=9))


def _now() -> datetime:
    return datetime(2026, 7, 22, 12, 0, 0, tzinfo=JST)


class LoadSaveTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._path = Path(self._tmp.name) / "companion_style_notes.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_load_missing_returns_empty(self) -> None:
        self.assertEqual(style_notes.load_style_notes(self._path), {"notes": []})

    def test_load_corrupt_returns_empty(self) -> None:
        self._path.write_text("{not json", encoding="utf-8")
        self.assertEqual(style_notes.load_style_notes(self._path), {"notes": []})

    def test_load_wrong_shape_returns_empty(self) -> None:
        self._path.write_text('{"notes": "oops"}', encoding="utf-8")
        self.assertEqual(style_notes.load_style_notes(self._path), {"notes": []})

    def test_save_then_load_roundtrip(self) -> None:
        data = {"notes": [{"rule": "x", "last_touched": "t"}]}
        style_notes.save_style_notes(self._path, data)
        self.assertEqual(style_notes.load_style_notes(self._path), data)

    def test_save_is_atomic_no_tmp_left(self) -> None:
        style_notes.save_style_notes(self._path, {"notes": []})
        self.assertFalse((self._path.with_suffix(self._path.suffix + ".tmp")).exists())
        self.assertTrue(self._path.exists())

    def test_save_mode_is_0600_under_umask(self) -> None:
        old = os.umask(0o077)
        try:
            style_notes.save_style_notes(self._path, {"notes": []})
        finally:
            os.umask(old)
        mode = stat.S_IMODE(self._path.stat().st_mode)
        self.assertEqual(mode, 0o600)


class AddNoteTest(unittest.TestCase):
    def test_adds_new_note(self) -> None:
        out = style_notes.add_note({"notes": []}, "「さっき」を多用しない", _now())
        self.assertEqual(len(out["notes"]), 1)
        n = out["notes"][0]
        self.assertEqual(n["rule"], "「さっき」を多用しない")
        self.assertEqual(n["last_touched"], _now().isoformat())

    def test_does_not_mutate_input(self) -> None:
        data = {"notes": []}
        style_notes.add_note(data, "rule-a", _now())
        self.assertEqual(data, {"notes": []})

    def test_duplicate_rule_touches_instead_of_duplicating(self) -> None:
        old = _now() - timedelta(days=1)
        data = {"notes": [{"rule": "rule-a", "last_touched": old.isoformat()}]}
        out = style_notes.add_note(data, "rule-a", _now())
        self.assertEqual(len(out["notes"]), 1)
        self.assertEqual(out["notes"][0]["last_touched"], _now().isoformat())

    def test_caps_at_max_notes_drops_oldest(self) -> None:
        base = _now() - timedelta(days=10)
        notes = []
        for i in range(style_notes.MAX_NOTES):
            notes.append({
                "rule": f"r{i}",
                "last_touched": (base + timedelta(hours=i)).isoformat(),
            })
        data = {"notes": notes}
        out = style_notes.add_note(data, "new-rule", _now())
        rules = {n["rule"] for n in out["notes"]}
        self.assertEqual(len(out["notes"]), style_notes.MAX_NOTES)
        self.assertIn("new-rule", rules)
        self.assertNotIn("r0", rules)


class NoteRulesTest(unittest.TestCase):
    def test_returns_rule_strings_in_order(self) -> None:
        data = {"notes": [{"rule": "a"}, {"rule": "b"}]}
        self.assertEqual(style_notes.note_rules(data), ["a", "b"])

    def test_empty_when_no_notes(self) -> None:
        self.assertEqual(style_notes.note_rules({"notes": []}), [])

    def test_non_string_or_empty_rule_filtered(self) -> None:
        data = {"notes": [
            {"rule": "ok"}, {"rule": ""}, {"rule": None}, {}, "not-a-dict",
        ]}
        self.assertEqual(style_notes.note_rules(data), ["ok"])


if __name__ == "__main__":
    unittest.main()
