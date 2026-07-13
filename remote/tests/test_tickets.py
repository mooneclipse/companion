#!/usr/bin/env python3
"""tickets(共用 TODO/inbox データ層)の単体テスト。

採番の連番性 / デフォルト / 状態遷移と done 除外 / 不正入力拒否 / counts /
flock 下の並行 add 衝突なし を検証する。tmpdir に tickets の path 定数を
差し替えて隔離する。実行: cd remote && python3 -m unittest discover -s tests
"""
import contextlib
import io
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


class TestEdit(TicketsTestBase):
    def test_edit_updates_text(self):
        tickets.add("original")
        updated = tickets.edit(1, "changed")
        self.assertEqual(updated["text"], "changed")
        self.assertEqual(tickets.get(1)["text"], "changed")

    def test_edit_updates_timestamp(self):
        t = tickets.add("x")
        before = t["updated"]
        edited = tickets.edit(1, "y")
        self.assertGreaterEqual(edited["updated"], before)

    def test_edit_strips_text(self):
        tickets.add("x")
        self.assertEqual(tickets.edit(1, "  spaced  ")["text"], "spaced")

    def test_edit_reject_empty(self):
        tickets.add("x")
        for bad in ("", "   ", None, 123):
            with self.subTest(text=bad):
                with self.assertRaises(tickets.TicketError):
                    tickets.edit(1, bad)

    def test_edit_reject_too_long(self):
        tickets.add("x")
        with self.assertRaises(tickets.TicketError):
            tickets.edit(1, "x" * (tickets.MAX_TEXT + 1))

    def test_edit_missing_ticket(self):
        with self.assertRaises(tickets.TicketError):
            tickets.edit(999, "nope")


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

    def test_history_only_done(self):
        tickets.add("a")            # 1 todo
        tickets.add("b")            # 2 todo
        tickets.add("c")            # 3 todo
        tickets.set_status(2, "doing")
        tickets.set_status(3, "done")
        res = tickets.history()
        ids = [t["id"] for t in res["tickets"]]
        self.assertEqual(ids, [3])              # done のみ(todo/doing は除外)

    def test_history_sorted_by_updated_desc(self):
        tickets.add("a")            # 1
        tickets.add("b")            # 2
        tickets.add("c")            # 3
        # updated を明示制御(秒粒度の同着を避けるため直接書き換え)。
        tickets.set_status(1, "done")
        tickets.set_status(2, "done")
        tickets.set_status(3, "done")
        with tickets._locked():
            data = tickets._load()
            for t in data["tickets"]:
                t["updated"] = {1: 100, 2: 300, 3: 200}[t["id"]]
            tickets._save(data)
        ids = [t["id"] for t in tickets.history()["tickets"]]
        self.assertEqual(ids, [2, 3, 1])        # updated 降順(新しい完了が先頭)

    def test_history_empty_when_no_done(self):
        tickets.add("a")
        tickets.set_status(1, "doing")
        self.assertEqual(tickets.history(), {"tickets": []})


class TestParseAdd(unittest.TestCase):
    # CLI 引数パース (純関数)。--help 誤起票の再発防止ガードを含む。
    def test_by_extracted(self):
        self.assertEqual(tickets._parse_add(["x", "--by", "ai"]), ("x", "ai"))

    def test_plain_text_joined(self):
        self.assertEqual(tickets._parse_add(["a", "b"]), ("a b", "user"))

    def test_reject_unknown_option(self):
        with self.assertRaises(tickets.TicketError):
            tickets._parse_add(["--help"])

    def test_reject_unknown_option_after_text(self):
        with self.assertRaises(tickets.TicketError):
            tickets._parse_add(["text", "--all"])

    def test_reject_by_without_value(self):
        with self.assertRaises(tickets.TicketError):
            tickets._parse_add(["text", "--by"])

    def test_dashes_inside_token_allowed(self):
        # トークン先頭のみ判定。本文中の -- は quoted 1 引数なら通る。
        self.assertEqual(tickets._parse_add(["claude の --bare を検証"]),
                         ("claude の --bare を検証", "user"))


class TestMainHelp(TicketsTestBase):
    # -h/--help はどの位置でも usage 表示のみで state に触らない。
    def _run(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = tickets.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_add_help_files_nothing(self):
        rc, out, _ = self._run(["tickets.py", "add", "--help"])
        self.assertEqual(rc, 0)
        self.assertIn("tickets.py add", out)
        self.assertEqual(tickets.all_tickets(), [])

    def test_top_level_help(self):
        for argv in (["tickets.py", "--help"], ["tickets.py", "-h"], ["tickets.py", "help"]):
            with self.subTest(argv=argv):
                rc, out, _ = self._run(argv)
                self.assertEqual(rc, 0)
                self.assertIn("tickets.py add", out)

    def test_add_unknown_option_files_nothing(self):
        rc, _, err = self._run(["tickets.py", "add", "text", "--nope"])
        self.assertEqual(rc, 2)
        self.assertIn("unknown option", err)
        self.assertEqual(tickets.all_tickets(), [])


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
