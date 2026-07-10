#!/usr/bin/env python3
"""ingest.py --inbox (ローカル持ち込み) の合成データ検証。yt-dlp を使わないので実弾なし。

mp4 (コンテナ変換なしの単純コピー経路) と mkv+srt (ffmpeg remux + 字幕変換経路) の
両方を検証する。一時ファイルは pipeline/tests/_scratch_inbox/ (.gitignore 済み) に作る。
"""
import pathlib
import shutil
import subprocess
import sys
import unittest

TESTS_DIR = pathlib.Path(__file__).resolve().parent
PIPELINE_DIR = TESTS_DIR.parent
SCRATCH = TESTS_DIR / "_scratch_inbox"

sys.path.insert(0, str(PIPELINE_DIR))
import common  # noqa: E402
import ingest  # noqa: E402

SRT_CONTENT = """1
00:00:00,000 --> 00:00:02,000
Hello there.

2
00:00:02,500 --> 00:00:05,000
This is a test.
"""


class IngestInboxTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        if shutil.which("ffmpeg") is None:
            raise unittest.SkipTest("ffmpeg not found")
        if SCRATCH.exists():
            shutil.rmtree(SCRATCH)
        SCRATCH.mkdir(parents=True)

        cls._orig = {
            "ROOT": common.ROOT, "MEDIA_DIR": common.MEDIA_DIR,
            "EPISODES_DIR": common.EPISODES_DIR, "SUBS_DIR": common.SUBS_DIR,
            "SUBS_RAW_DIR": common.SUBS_RAW_DIR, "CLIPS_DIR": common.CLIPS_DIR,
            "INBOX_DIR": common.INBOX_DIR,
        }
        common.ROOT = SCRATCH
        common.MEDIA_DIR = SCRATCH / "media"
        common.EPISODES_DIR = common.MEDIA_DIR / "episodes"
        common.SUBS_DIR = common.MEDIA_DIR / "subs"
        common.SUBS_RAW_DIR = common.SUBS_DIR / "raw"
        common.CLIPS_DIR = common.MEDIA_DIR / "clips"
        common.INBOX_DIR = SCRATCH / "inbox"
        common.INBOX_DIR.mkdir(parents=True)

        cls.db_path = SCRATCH / "test.db"

        # mp4 (単純コピー経路、字幕なし = sub_kind none)
        cls._make_dummy_video(common.INBOX_DIR / "ep01_plain.mp4", duration=3, codec_mp4=True)
        # mkv + srt (ffmpeg remux 経路 + 字幕変換)
        cls._make_dummy_video(common.INBOX_DIR / "ep02_with_sub.mkv", duration=4, codec_mp4=False)
        (common.INBOX_DIR / "ep02_with_sub.srt").write_text(SRT_CONTENT, encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        for key, value in cls._orig.items():
            setattr(common, key, value)
        shutil.rmtree(SCRATCH, ignore_errors=True)

    @staticmethod
    def _make_dummy_video(path, duration, codec_mp4):
        argv = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=%d:size=160x120:rate=10" % duration,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-shortest", "-c:v", "libx264", "-preset", "veryfast",
            "-c:a", "aac", "-t", str(duration), str(path),
        ]
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if p.returncode != 0 or not path.is_file():
            raise RuntimeError("dummy video creation failed: %s" % p.stderr[-500:])

    def test_inbox_ingest_mp4_and_mkv_with_srt(self):
        added, failed = ingest.ingest_from_inbox("test-series", "Test Series", db_path=str(self.db_path))
        self.assertEqual(failed, 0)
        self.assertEqual(added, 2)

        conn = common.open_db(str(self.db_path))
        rows = {r["title"]: r for r in conn.execute("SELECT * FROM episodes")}
        series_row = conn.execute("SELECT * FROM series WHERE id='test-series'").fetchone()
        conn.close()

        self.assertIsNotNone(series_row)
        self.assertEqual(series_row["title"], "Test Series")

        self.assertIn("ep01_plain", rows)
        r1 = rows["ep01_plain"]
        self.assertEqual(r1["sub_kind"], "none")
        self.assertIsNone(r1["sub_path"])
        self.assertEqual(r1["sort_key"], "ep01_plain")
        self.assertTrue((common.ROOT / r1["video_path"]).is_file())
        self.assertEqual(r1["duration_s"], 3)

        self.assertIn("ep02_with_sub", rows)
        r2 = rows["ep02_with_sub"]
        self.assertEqual(r2["sub_kind"], "local")
        self.assertIsNone(r2["sub_path"])  # subs.py がクリーニング後に設定する列 (ingest では未設定)
        self.assertTrue((common.ROOT / r2["video_path"]).is_file())
        self.assertEqual(r2["video_path"].split(".")[-1], "mp4")  # mkv → mp4 remux 済み
        raw_sub = common.SUBS_RAW_DIR / ("%s.en.vtt" % r2["id"])
        self.assertTrue(raw_sub.is_file())
        content = raw_sub.read_text(encoding="utf-8")
        self.assertTrue(content.startswith("WEBVTT"))
        self.assertIn("Hello there.", content)

        # 冪等性: 同じ inbox を再実行しても増えない (id はファイル名ハッシュで安定)
        added2, failed2 = ingest.ingest_from_inbox("test-series", db_path=str(self.db_path))
        self.assertEqual((added2, failed2), (0, 0))


if __name__ == "__main__":
    unittest.main()
