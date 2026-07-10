#!/usr/bin/env python3
"""dlqueue(事前ダウンロードキュー RV-10)の単体テスト。

enqueue(採番/dedup/容量上限) / 遷移(claim・done・failed) / recovery(中断 failed 化 +
ファイル掃除) / delete(downloading 409・ファイル削除) / local_path のパス境界
(state 改竄・symlink 脱出 reject) / worker の fake yt-dlp 実行(rc/glob/title) を検証。
tmpdir に dlqueue の path 定数を差し替えて隔離(本番 .state 非接触)。yt-dlp は
fake スクリプトに差し替え、実ネットワーク・実 DL は行わない。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import dlqueue  # noqa: E402

URL1 = "https://www.youtube.com/watch?v=aaa"
URL2 = "https://www.youtube.com/watch?v=bbb"

# fake yt-dlp: -o テンプレートから出力先を解決して動画ファイルを偽造し、title を print する。
# 環境変数でなく argv 先頭の挙動指示ファイルは使わず、スクリプト自体を mode 別に書き分ける。
FAKE_OK = """#!/usr/bin/env python3
import sys
args = sys.argv[1:]
out = args[args.index("-o") + 1]
path = out.replace("%(ext)s", "mp4")
with open(path, "wb") as f:
    f.write(b"x" * 1024)
print("Fake Title \\t with tab")
"""

FAKE_FAIL = """#!/usr/bin/env python3
import sys
sys.stderr.write("ERROR: unable to download video data: HTTP Error 403\\n")
sys.exit(1)
"""

FAKE_NO_OUTPUT = """#!/usr/bin/env python3
print("Title Without File")
"""


class DlQueueTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = self._tmp.name
        self._orig = (dlqueue.STATE_DIR, dlqueue.QUEUE_PATH, dlqueue.LOCK_PATH,
                      dlqueue.DOWNLOADS_DIR, dlqueue.YTDLP, dlqueue.NOTIFY_SOCKET)
        dlqueue.STATE_DIR = d
        dlqueue.QUEUE_PATH = os.path.join(d, "dlqueue.json")
        dlqueue.LOCK_PATH = os.path.join(d, "dlqueue.lock")
        dlqueue.DOWNLOADS_DIR = os.path.realpath(os.path.join(d, "downloads"))
        os.makedirs(dlqueue.DOWNLOADS_DIR, mode=0o700)
        # 通知は不在 socket に向ける(接続失敗 → 握りつぶし経路を毎回通す)
        dlqueue.NOTIFY_SOCKET = os.path.join(d, "no-such-bot.sock")

    def tearDown(self):
        (dlqueue.STATE_DIR, dlqueue.QUEUE_PATH, dlqueue.LOCK_PATH,
         dlqueue.DOWNLOADS_DIR, dlqueue.YTDLP, dlqueue.NOTIFY_SOCKET) = self._orig
        self._tmp.cleanup()

    def _fake_ytdlp(self, script):
        path = os.path.join(self._tmp.name, "fake-yt-dlp")
        with open(path, "w", encoding="utf-8") as f:
            f.write(script)
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
        dlqueue.YTDLP = path

    def _put_file(self, name, size=10):
        path = os.path.join(dlqueue.DOWNLOADS_DIR, name)
        with open(path, "wb") as f:
            f.write(b"x" * size)
        return path


class TestEnqueue(DlQueueTestBase):
    def test_sequential_ids_and_defaults(self):
        a = dlqueue.enqueue(URL1)
        b = dlqueue.enqueue(URL2)
        self.assertEqual([a["id"], b["id"]], [1, 2])
        self.assertEqual(a["status"], "queued")
        self.assertIsNone(a["title"])
        self.assertIsNone(a["file"])

    def test_dedup_returns_existing_queued(self):
        a = dlqueue.enqueue(URL1)
        b = dlqueue.enqueue(URL1)
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(len(dlqueue.list_items()["items"]), 1)

    def test_dedup_ignores_done_and_failed(self):
        a = dlqueue.enqueue(URL1)
        item = dlqueue._claim_next()
        dlqueue._finish(item["id"], ok=False, error="x")
        b = dlqueue.enqueue(URL1)  # failed との重複は許容(意図的な再 DL)
        self.assertNotEqual(a["id"], b["id"])

    def test_quota_rejects_enqueue(self):
        self._put_file("dl-0.mp4", size=10)
        orig = dlqueue.LIMIT_BYTES
        dlqueue.LIMIT_BYTES = 10
        try:
            with self.assertRaises(dlqueue.QuotaExceeded):
                dlqueue.enqueue(URL1)
        finally:
            dlqueue.LIMIT_BYTES = orig

    def test_list_newest_first_with_usage(self):
        dlqueue.enqueue(URL1)
        dlqueue.enqueue(URL2)
        data = dlqueue.list_items()
        self.assertEqual([t["url"] for t in data["items"]][-1], URL1)
        self.assertIn("usage_bytes", data)
        self.assertEqual(data["limit_bytes"], dlqueue.LIMIT_BYTES)


class TestTransitions(DlQueueTestBase):
    def test_claim_oldest_queued(self):
        dlqueue.enqueue(URL1)
        dlqueue.enqueue(URL2)
        item = dlqueue._claim_next()
        self.assertEqual(item["url"], URL1)
        self.assertEqual(item["status"], "downloading")

    def test_claim_empty_returns_none(self):
        self.assertIsNone(dlqueue._claim_next())

    def test_finish_done_keeps_file(self):
        t = dlqueue.enqueue(URL1)
        dlqueue._claim_next()
        path = self._put_file("dl-%d.mp4" % t["id"])
        dlqueue._finish(t["id"], ok=True, file="dl-%d.mp4" % t["id"], size=10, title="T")
        item = dlqueue.list_items()["items"][0]
        self.assertEqual(item["status"], "done")
        self.assertEqual(item["title"], "T")
        self.assertTrue(os.path.exists(path))

    def test_finish_failed_cleans_files(self):
        t = dlqueue.enqueue(URL1)
        dlqueue._claim_next()
        p1 = self._put_file("dl-%d.mp4.part" % t["id"])
        p2 = self._put_file("dl-%d.f137.mp4" % t["id"])
        dlqueue._finish(t["id"], ok=False, error="boom")
        item = dlqueue.list_items()["items"][0]
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error"], "boom")
        self.assertFalse(os.path.exists(p1))
        self.assertFalse(os.path.exists(p2))

    def test_recover_marks_downloading_failed_and_cleans(self):
        t = dlqueue.enqueue(URL1)
        dlqueue.enqueue(URL2)
        dlqueue._claim_next()
        part = self._put_file("dl-%d.mp4.part" % t["id"])
        dlqueue.recover()
        items = {x["id"]: x for x in dlqueue.list_items()["items"]}
        self.assertEqual(items[t["id"]]["status"], "failed")
        self.assertEqual(items[t["id"]]["error"], "interrupted by restart")
        self.assertFalse(os.path.exists(part))
        # queued は recovery の対象外(自動では触らない)
        self.assertEqual(items[2]["status"], "queued")


class TestDelete(DlQueueTestBase):
    def test_delete_queued(self):
        t = dlqueue.enqueue(URL1)
        dlqueue.delete(t["id"])
        self.assertEqual(dlqueue.list_items()["items"], [])

    def test_delete_done_removes_file(self):
        t = dlqueue.enqueue(URL1)
        dlqueue._claim_next()
        path = self._put_file("dl-%d.mp4" % t["id"])
        dlqueue._finish(t["id"], ok=True, file="dl-%d.mp4" % t["id"], size=10)
        dlqueue.delete(t["id"])
        self.assertFalse(os.path.exists(path))
        self.assertEqual(dlqueue.list_items()["items"], [])

    def test_delete_downloading_busy(self):
        t = dlqueue.enqueue(URL1)
        dlqueue._claim_next()
        with self.assertRaises(dlqueue.DlBusyError):
            dlqueue.delete(t["id"])

    def test_delete_missing(self):
        with self.assertRaises(dlqueue.DlQueueError):
            dlqueue.delete(99)


class TestLocalPath(DlQueueTestBase):
    def _done_item(self, fname):
        t = dlqueue.enqueue(URL1)
        dlqueue._claim_next()
        dlqueue._finish(t["id"], ok=True, file=fname, size=1)
        return t["id"]

    def _force_file(self, tid, value):
        """state の file を直接改竄(攻撃シミュレーション)。"""
        with dlqueue._locked():
            data = dlqueue._load()
            for x in data["items"]:
                if x["id"] == tid:
                    x["file"] = value
            dlqueue._save(data)

    def test_done_resolves(self):
        self._put_file("dl-1.mp4")
        tid = self._done_item("dl-1.mp4")
        path = dlqueue.local_path(tid)
        self.assertEqual(path, os.path.join(dlqueue.DOWNLOADS_DIR, "dl-1.mp4"))

    def test_missing_id(self):
        self.assertIsNone(dlqueue.local_path(99))

    def test_not_done_rejected(self):
        t = dlqueue.enqueue(URL1)
        self.assertIsNone(dlqueue.local_path(t["id"]))

    def test_file_gone_returns_none(self):
        tid = self._done_item("dl-1.mp4")  # state は done だがファイル不在
        self.assertIsNone(dlqueue.local_path(tid))

    def test_separator_in_file_rejected(self):
        self._put_file("dl-1.mp4")
        tid = self._done_item("dl-1.mp4")
        self._force_file(tid, "sub/dl-1.mp4")
        self.assertIsNone(dlqueue.local_path(tid))

    def test_dotdot_rejected(self):
        tid = self._done_item("dl-1.mp4")
        self._force_file(tid, "..")
        self.assertIsNone(dlqueue.local_path(tid))

    def test_absolute_path_rejected(self):
        outside = self._put_file("dl-1.mp4")  # 実在する path を absolute で仕込む
        tid = self._done_item("dl-1.mp4")
        self._force_file(tid, os.path.join(self._tmp.name, "etc-passwd"))
        self.assertIsNone(dlqueue.local_path(tid))
        self.assertTrue(os.path.exists(outside))

    def test_symlink_escape_rejected(self):
        secret = os.path.join(self._tmp.name, "secret.mp4")
        with open(secret, "wb") as f:
            f.write(b"s")
        os.symlink(secret, os.path.join(dlqueue.DOWNLOADS_DIR, "dl-1.mp4"))
        tid = self._done_item("dl-1.mp4")
        self.assertIsNone(dlqueue.local_path(tid))


class TestWorkerProcess(DlQueueTestBase):
    def _run_one(self):
        item = dlqueue._claim_next()
        dlqueue._process(item)
        return dlqueue.list_items()["items"][0]

    def test_success_sets_done_file_size_title(self):
        self._fake_ytdlp(FAKE_OK)
        t = dlqueue.enqueue(URL1)
        item = self._run_one()
        self.assertEqual(item["status"], "done")
        self.assertEqual(item["file"], "dl-%d.mp4" % t["id"])
        self.assertEqual(item["size"], 1024)
        # title はサニタイズ済み(タブ → 空白圧縮はしないが制御文字は空白化)
        self.assertEqual(item["title"], "Fake Title   with tab")
        self.assertIsNotNone(dlqueue.local_path(t["id"]))

    def test_failure_sets_failed_with_stderr_tail(self):
        self._fake_ytdlp(FAKE_FAIL)
        dlqueue.enqueue(URL1)
        item = self._run_one()
        self.assertEqual(item["status"], "failed")
        self.assertIn("403", item["error"])

    def test_no_output_file_is_failed(self):
        self._fake_ytdlp(FAKE_NO_OUTPUT)
        dlqueue.enqueue(URL1)
        item = self._run_one()
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error"], "output file not found")

    def test_capacity_guard_before_start(self):
        self._fake_ytdlp(FAKE_OK)
        dlqueue.enqueue(URL1)
        self._put_file("dl-0.mp4", size=10)
        orig = dlqueue.LIMIT_BYTES
        dlqueue.LIMIT_BYTES = 10
        try:
            item = self._run_one()
        finally:
            dlqueue.LIMIT_BYTES = orig
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error"], "over capacity")

    def test_ytdlp_missing_is_failed(self):
        dlqueue.YTDLP = os.path.join(self._tmp.name, "no-such-binary")
        dlqueue.enqueue(URL1)
        item = self._run_one()
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error"], "yt-dlp not executable")


class TestSanitizeTitle(DlQueueTestBase):
    def test_strips_control_and_caps(self):
        self.assertEqual(dlqueue.sanitize_title("a\x00b\nc"), "a b c")
        self.assertEqual(dlqueue.sanitize_title("  x  "), "x")
        self.assertIsNone(dlqueue.sanitize_title(""))
        self.assertIsNone(dlqueue.sanitize_title(None))
        self.assertEqual(len(dlqueue.sanitize_title("y" * 500)), dlqueue.TITLE_MAX)


if __name__ == "__main__":
    unittest.main()
