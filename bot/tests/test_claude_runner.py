"""Unit tests for claude_runner.ClaudeOptions CLI argument composition.

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from claude_runner import ClaudeOptions


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
