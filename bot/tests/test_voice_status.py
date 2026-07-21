"""Unit tests for voice_status.py (/status の voice 集計)。

Run from bot/ with: venv/bin/python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import voice_status  # noqa: E402

JST = timezone(timedelta(hours=9))
NOW = datetime(2026, 6, 12, 21, 0, 0, tzinfo=JST)


def _ts(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


class FormatVoiceSummaryTest(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.state_dir = tmp / ".state"
        self.state_dir.mkdir()
        self._orig_state = voice_status.VOICE_STATE_DIR
        voice_status.VOICE_STATE_DIR = self.state_dir

    def tearDown(self) -> None:
        voice_status.VOICE_STATE_DIR = self._orig_state
        self._tmp.cleanup()

    def _write_state(self, day: datetime, lines: list[str]) -> None:
        path = self.state_dir / f"last-result-{day.strftime('%Y-%m-%d')}"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_no_files_returns_zeroes(self) -> None:
        out = voice_status.format_voice_summary(NOW)
        self.assertIn("OK 0", out)
        self.assertIn("FAIL 0", out)
        self.assertIn("padding skipped 0", out)

    def test_counts_ok_fail_and_padding(self) -> None:
        self._write_state(NOW, [
            f"OK @ {_ts(NOW - timedelta(hours=1))}",
            f"OK @ {_ts(NOW - timedelta(hours=2))}",
            "padding skipped: ffmpeg unknown error",
            f"FAIL ENGINE_UNREACHABLE: audio_query curl rc=7 (msg) (exit 1) @ {_ts(NOW - timedelta(hours=3))}",
        ])
        out = voice_status.format_voice_summary(NOW)
        self.assertIn("OK 2", out)
        self.assertIn("FAIL 1 (ENGINE_UNREACHABLE 1)", out)
        self.assertIn("padding skipped 1", out)

    def test_older_than_24h_excluded(self) -> None:
        yesterday = NOW - timedelta(days=1)
        self._write_state(yesterday, [
            # 24h 境界より古い → 除外
            f"OK @ {_ts(NOW - timedelta(hours=30))}",
            # 昨日のファイルでも 24h 以内 → 集計
            f"FAIL LOCK_TIMEOUT: flock -w 5 (exit 3) @ {_ts(NOW - timedelta(hours=23))}",
        ])
        out = voice_status.format_voice_summary(NOW)
        self.assertIn("OK 0", out)
        self.assertIn("FAIL 1 (LOCK_TIMEOUT 1)", out)

    def test_socket_lines_ignored(self) -> None:
        self._write_state(NOW, [
            f"FAIL SYNTHESIS_FAILED: http=500 (exit 4) @ {_ts(NOW)}",
            f"socket unreachable (no /run/user/1000/companion-bot.sock) @ {_ts(NOW)}",
        ])
        out = voice_status.format_voice_summary(NOW)
        self.assertIn("FAIL 1 (SYNTHESIS_FAILED 1)", out)


if __name__ == "__main__":
    unittest.main()
