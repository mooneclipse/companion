"""Unit tests for voice_command.py (自発発話の声実体)。

cmd_say の engine orchestration は fake バイナリで検証する:
- systemctl: PATH 先頭に fake を置いて呼び出しを log に記録
- say.sh / ready.sh: モジュール属性を一時 patch

Run from bot/ with: venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import asyncio
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import voice_command  # noqa: E402


def _write_script(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


class FormatSayResultTest(unittest.TestCase):

    def test_ok(self) -> None:
        self.assertEqual(voice_command._format_say_result(0), "[say] ✓ 発話完了")

    def test_known_reasons(self) -> None:
        self.assertIn("ENGINE_UNREACHABLE", voice_command._format_say_result(1))
        self.assertIn("ARGS_INVALID", voice_command._format_say_result(2))
        self.assertIn("LOCK_TIMEOUT", voice_command._format_say_result(3))
        self.assertIn("SYNTHESIS_FAILED", voice_command._format_say_result(4))
        self.assertIn("AUDIO_PLAYBACK_FAILED", voice_command._format_say_result(5))

    def test_unknown_rc(self) -> None:
        out = voice_command._format_say_result(42)
        self.assertIn("UNKNOWN", out)
        self.assertIn("exit 42", out)


class CmdSayTest(unittest.TestCase):
    """fake systemctl/say.sh/ready.sh で start → say → stop の orchestration を検証。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.ctl_log = tmp / "systemctl.log"
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        _write_script(
            bin_dir / "systemctl",
            f'echo "$@" >> "{self.ctl_log}"\nexit 0\n',
        )
        self._orig_path = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{self._orig_path}"

        self._orig_say = voice_command.SAY_SH
        self._orig_ready = voice_command.READY_SH
        voice_command.READY_SH = _write_script(tmp / "ready.sh", "exit 0\n")
        self.tmp = tmp

    def tearDown(self) -> None:
        os.environ["PATH"] = self._orig_path
        voice_command.SAY_SH = self._orig_say
        voice_command.READY_SH = self._orig_ready
        self._tmp.cleanup()

    def _ctl_calls(self) -> list[str]:
        if not self.ctl_log.exists():
            return []
        return self.ctl_log.read_text(encoding="utf-8").strip().splitlines()

    def test_success_starts_and_stops_engine(self) -> None:
        voice_command.SAY_SH = _write_script(self.tmp / "say.sh", "exit 0\n")
        rc, msg = asyncio.run(voice_command.cmd_say("テスト"))
        self.assertEqual(rc, 0)
        self.assertIn("発話完了", msg)
        calls = self._ctl_calls()
        self.assertEqual(len(calls), 2)
        self.assertIn("start", calls[0])
        self.assertIn("stop", calls[1])

    def test_failure_rc_passthrough_and_engine_stopped(self) -> None:
        voice_command.SAY_SH = _write_script(self.tmp / "say.sh", "exit 4\n")
        rc, msg = asyncio.run(voice_command.cmd_say("テスト"))
        self.assertEqual(rc, 4)
        self.assertIn("SYNTHESIS_FAILED", msg)
        self.assertIn("stop", self._ctl_calls()[-1])

    def test_timeout_kills_and_stops_engine(self) -> None:
        voice_command.SAY_SH = _write_script(self.tmp / "say.sh", "sleep 30\n")
        orig_timeout = voice_command.SAY_TIMEOUT_S
        voice_command.SAY_TIMEOUT_S = 0.2
        try:
            rc, msg = asyncio.run(voice_command.cmd_say("テスト"))
        finally:
            voice_command.SAY_TIMEOUT_S = orig_timeout
        self.assertEqual(rc, 99)
        self.assertIn("TIMEOUT", msg)
        self.assertIn("stop", self._ctl_calls()[-1])

    def test_missing_say_sh_returns_98(self) -> None:
        voice_command.SAY_SH = self.tmp / "no-such-say.sh"
        rc, msg = asyncio.run(voice_command.cmd_say("テスト"))
        self.assertEqual(rc, 98)
        self.assertIn("say.sh", msg)
        # spawn 失敗でも finally の stop は走る
        self.assertIn("stop", self._ctl_calls()[-1])


if __name__ == "__main__":
    unittest.main()
