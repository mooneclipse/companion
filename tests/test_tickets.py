#!/usr/bin/env python3
"""tickets(共用 TODO/inbox データ層)の単体テスト。

採番の連番性 / デフォルト / 状態遷移と done 除外 / 不正入力拒否 / counts /
flock 下の並行 add 衝突なし を検証する。tmpdir に tickets の path 定数を
差し替えて隔離する。実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import tickets  # noqa: E402


class TicketsTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        d = self._tmp.name
        self._orig = (tickets.STATE_DIR, tickets.TICKETS_PATH, tickets.LOCK_PATH)
        tickets.STATE_DIR = d
        tickets.TICKETS_PATH = os.path.join(d, "tickets.json")
        tickets.LOCK_PATH = os.path.join(d, "tickets.lock")

    def tearDown(self):
        tickets.STATE_DIR, tickets.TICKETS_PATH, tickets.LOCK_PATH = self._orig
        self._tmp.cleanup()


class TestAdd(TicketsTestBase):
    def test_sequential_ids(self):
        a = tickets.add("one")
        b = tickets.add("two")
        c = tickets.add("three")
        self.assertEqual([a["id"], b["id"], c["id"]], [1, 2, 3])

    def test_ids_not_reused_after_done(self):
        tickets.add("one")
        tickets.set_status(1, "done")
        # done にしても next_id は進んだまま(再利用しない)
        self.assertEqual(tickets.add("two")["id"], 2)

    def test_defaults(self):
        t = tickets.add("hello")
        self.assertEqual(t["by"], "user")
        self.assertEqual(t["status"], "todo")
        self.assertEqual(t["text"], "hello")
        self.assertIn("created", t)
        self.assertIn("updated", t)

    def test_by_ai(self):
        self.assertEqual(tickets.add("x", by="ai")["by"], "ai")

    def test_strips_text(self):
        self.assertEqual(tickets.add("  spaced  ")["text"], "spaced")

    def test_reject_empty(self):
        for bad in ("", "   ", None, 123):
            with self.subTest(text=bad):
                with self.assertRaises(tickets.TicketError):
                    tickets.add(bad)

    def test_reject_too_long(self):
        with self.assertRaises(tickets.TicketError):
            tickets.add("x" * (tickets.MAX_TEXT + 1))

    def test_reject_bad_by(self):
        with self.assertRaises(tickets.TicketError):
            tickets.add("x", by="robot")


class TestStatus(TicketsTestBase):
    def test_transition_updates_timestamp(self):
        t = tickets.add("x")
        before = t["updated"]
        # set_status の updated は _now() 秒粒度。粒度内でも値が入ることを確認。
        moved = tickets.set_status(1, "doing")
        self.assertEqual(moved["status"], "doing")
        self.assertGreaterEqual(moved["updated"], before)

    def test_invalid_status(self):
        tickets.add("x")
        with self.assertRaises(tickets.TicketError):
            tickets.set_status(1, "wip")

    def test_missing_ticket(self):
        with self.assertRaises(tickets.TicketError):
            tickets.set_status(999, "done")


class TestQueries(TicketsTestBase):
    def test_active_excludes_done(self):
        tickets.add("a")            # 1 todo
        tickets.add("b")            # 2 todo
        tickets.add("c")            # 3 todo
        tickets.set_status(2, "doing")
        tickets.set_status(3, "done")
        res = tickets.active()
        ids = [t["id"] for t in res["tickets"]]
        self.assertEqual(ids, [1, 2])           # 3(done) は除外
        self.assertEqual(res["counts"], {"todo": 1, "doing": 1})

    def test_get(self):
        tickets.add("findme")
        self.assertEqual(tickets.get(1)["text"], "findme")
        self.assertIsNone(tickets.get(42))

    def test_all_includes_done(self):
        tickets.add("a")
        tickets.set_status(1, "done")
        self.assertEqual(len(tickets.all_tickets()), 1)


class TestConcurrency(TicketsTestBase):
    def test_parallel_add_no_collision(self):
        # flock が効いていれば同時 add でも id 重複しない / 件数一致。
        N = 30
        errors = []

        def worker(i):
            try:
                tickets.add("t%d" % i)
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        self.assertEqual(errors, [])
        all_t = tickets.all_tickets()
        ids = [t["id"] for t in all_t]
        self.assertEqual(len(all_t), N)
        self.assertEqual(len(set(ids)), N)          # 重複なし
        self.assertEqual(sorted(ids), list(range(1, N + 1)))


if __name__ == "__main__":
    unittest.main()
