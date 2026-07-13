"""Unit tests for claude_runner.ClaudeOptions CLI argument composition.

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from claude_runner import (
    ClaudeOptions,
    ClaudeResult,
    ErrorKind,
    _warn_if_session_id_mismatch,
)


def _ok_result(session_id: str | None) -> ClaudeResult:
    return ClaudeResult(
        rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
        session_id=session_id,
    )


class WarnIfSessionIdMismatchTest(unittest.TestCase):
    """ticket #87: 要求 uuid と JSON 返却 session_id の照合 warning (表面化専用)。"""

    def test_session_id_match_is_silent(self) -> None:
        opts = ClaudeOptions(session_id="uuid-a")
        with self.assertNoLogs("companion-bot", level="WARNING"):
            _warn_if_session_id_mismatch(opts, _ok_result("uuid-a"))

    def test_resume_session_match_is_silent(self) -> None:
        opts = ClaudeOptions(resume_session="uuid-a")
        with self.assertNoLogs("companion-bot", level="WARNING"):
            _warn_if_session_id_mismatch(opts, _ok_result("uuid-a"))

    def test_mismatch_warns_with_both_uuids(self) -> None:
        opts = ClaudeOptions(resume_session="uuid-a")
        with self.assertLogs("companion-bot", level="WARNING") as cm:
            _warn_if_session_id_mismatch(opts, _ok_result("uuid-b"))
        self.assertEqual(len(cm.output), 1)
        self.assertIn("uuid-a", cm.output[0])
        self.assertIn("uuid-b", cm.output[0])

    def test_no_returned_session_id_is_silent(self) -> None:
        # JSON parse 失敗 / text 出力時は result.session_id が None のまま。
        opts = ClaudeOptions(session_id="uuid-a")
        with self.assertNoLogs("companion-bot", level="WARNING"):
            _warn_if_session_id_mismatch(opts, _ok_result(None))

    def test_no_requested_uuid_is_silent(self) -> None:
        with self.assertNoLogs("companion-bot", level="WARNING"):
            _warn_if_session_id_mismatch(ClaudeOptions(), _ok_result("uuid-b"))


class ToCliArgsTest(unittest.TestCase):

    def test_default_has_no_append_system_prompt(self) -> None:
        args = ClaudeOptions().to_cli_args()
        self.assertNotIn("--append-system-prompt", args)

    def test_append_system_prompt_emits_flag_and_value(self) -> None:
        args = ClaudeOptions(append_system_prompt="persona text").to_cli_args()
        i = args.index("--append-system-prompt")
        self.assertEqual(args[i + 1], "persona text")

    def test_session_id_and_resume_are_mutually_exclusive(self) -> None:
        opts = ClaudeOptions(session_id="a", resume_session="b")
        with self.assertRaises(ValueError):
            opts.to_cli_args()


if __name__ == "__main__":
    unittest.main()
