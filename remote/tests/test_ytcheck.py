#!/usr/bin/env python3
"""ytcheck(F-ytcheck 視聴フィードバック連携 + #71 巡回チャンネル編集)の単体テスト。

month 検証(パス組み立ての門) / get_month の集計+エントリ / set_feedback の行書き換え
(チェックボックス・feedback 欄・過去月フォーマット付加・video_id の regex escape) /
該当なし・ファイルなしの YtcheckError / flock 下 write(ロック保持中はブロック) /
チャンネル編集(parse_channel_id の受理・拒否、channel_store 委譲 CRUD) を検証する。
tmpdir に擬似 viewing ディレクトリを作り VIEWING_DIR / CHANNELS_JSON を差し替えて隔離する
(本番 vault / ytcheck tasks には非接触。tmpdir は git repo 外のため自動 commit は
warning のみで素通り = channel_store の契約どおり)。
実行: cd remote && python3 -m unittest discover -s tests
"""
import fcntl
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import ytcheck  # noqa: E402

MONTH = "2026-07"

VIEWING_TEXT = """---
title: YouTube視聴履歴
month: 2026-07
---

# YouTube視聴履歴 (2026-07)

記入方法: 見た動画はチェックボックスを `[x]` にする。行末の `[feedback: ]` に ○（当たり）/ ×（外れ）を記入する。

## [チャンネルA]
- [ ] 動画その1 [video_id: vid001] [published: 2026-07-01T00:00:00Z] [score: 9/10] [tier: small] [reason: 理由A] [feedback: ]
- [x] 動画その2 [video_id: vid.002] [published: 2026-07-02T00:00:00Z] [score: 5/10] [tier: mid] [reason: 理由B] [feedback: ○]
- [ ] 動画その3 [video_id: vidX002] [published: 2026-07-03T00:00:00Z] [score: 6/10] [tier: mid] [reason: 理由C] [feedback: ]

## [チャンネルB]
- [ ] 過去月フォーマットの動画 [video_id: legacy01] [published: 2026-07-04T00:00:00Z] [score: 7/10] [tier: large] [reason: 理由D]
"""


class YtcheckTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self._tmp.name)
        self.viewing_path = os.path.join(self.root, "viewing-%s.md" % MONTH)
        with open(self.viewing_path, "w", encoding="utf-8") as f:
            f.write(VIEWING_TEXT)
        self.channels_path = os.path.join(self.root, "youtube-channels.json")
        with open(self.channels_path, "w", encoding="utf-8") as f:
            json.dump({"channels": [{"name": "チャンネルA", "favorite": 4},
                                    {"name": "チャンネルB", "favorite": 2}]}, f)
        self._orig = (ytcheck.VIEWING_DIR, ytcheck.CHANNELS_JSON)
        ytcheck.VIEWING_DIR = self.root
        ytcheck.CHANNELS_JSON = self.channels_path

    def tearDown(self):
        ytcheck.VIEWING_DIR, ytcheck.CHANNELS_JSON = self._orig
        self._tmp.cleanup()

    def read_lines(self):
        with open(self.viewing_path, encoding="utf-8") as f:
            return f.read().splitlines()

    def line_of(self, video_id):
        for line in self.read_lines():
            if "[video_id: %s]" % video_id in line:
                return line
        raise AssertionError("video_id %s not found" % video_id)


class TestMonthValidation(YtcheckTestBase):
    def test_valid(self):
        self.assertTrue(ytcheck.valid_month("2026-07"))
        self.assertTrue(ytcheck.valid_month("1999-12"))

    def test_invalid(self):
        for bad in ("2026-7", "2026-007", "202607", "2026-07-01", "../etc", "", None, 202607):
            with self.subTest(month=bad):
                self.assertFalse(ytcheck.valid_month(bad))

    def test_viewing_path_rejects_invalid(self):
        # month はパス組み立てに使うため不正形式は例外(traversal 防止の門)
        with self.assertRaises(ytcheck.YtcheckError):
            ytcheck._viewing_path("../../evil")


class TestGetMonth(YtcheckTestBase):
    def test_entries(self):
        data = ytcheck.get_month(MONTH)
        self.assertEqual(data["month"], MONTH)
        self.assertEqual(len(data["entries"]), 4)
        e = data["entries"][0]
        self.assertEqual(e["channel"], "チャンネルA")
        self.assertEqual(e["video_id"], "vid001")
        self.assertEqual(e["title"], "動画その1")
        self.assertEqual(e["score"], 9)
        self.assertFalse(e["checked"])
        self.assertEqual(e["feedback"], "")

    def test_checked_and_feedback_parsed(self):
        data = ytcheck.get_month(MONTH)
        e = data["entries"][1]
        self.assertTrue(e["checked"])
        self.assertEqual(e["feedback"], "○")

    def test_legacy_line_without_feedback_field(self):
        data = ytcheck.get_month(MONTH)
        e = data["entries"][3]
        self.assertEqual(e["channel"], "チャンネルB")
        self.assertEqual(e["feedback"], "")

    def test_report_counts(self):
        data = ytcheck.get_month(MONTH)
        self.assertIn("掲載動画数: 4", data["report"])
        self.assertIn("当たり(○): 1", data["report"])

    def test_missing_month_is_empty_not_error(self):
        data = ytcheck.get_month("2026-01")
        self.assertEqual(data["entries"], [])
        self.assertIn("掲載動画数: 0", data["report"])

    def test_invalid_month_raises(self):
        with self.assertRaises(ytcheck.YtcheckError):
            ytcheck.get_month("../../evil")


class TestSetFeedback(YtcheckTestBase):
    def test_check(self):
        e = ytcheck.set_feedback(MONTH, "vid001", checked=True)
        self.assertTrue(e["checked"])
        self.assertTrue(self.line_of("vid001").startswith("- [x] 動画その1"))

    def test_uncheck(self):
        e = ytcheck.set_feedback(MONTH, "vid.002", checked=False)
        self.assertFalse(e["checked"])
        self.assertTrue(self.line_of("vid.002").startswith("- [ ] 動画その2"))

    def test_feedback_hit(self):
        e = ytcheck.set_feedback(MONTH, "vid001", feedback="×")
        self.assertEqual(e["feedback"], "×")
        self.assertTrue(self.line_of("vid001").endswith("[feedback: ×]"))

    def test_feedback_clear(self):
        e = ytcheck.set_feedback(MONTH, "vid.002", feedback="")
        self.assertEqual(e["feedback"], "")
        self.assertTrue(self.line_of("vid.002").endswith("[feedback: ]"))

    def test_feedback_appended_to_legacy_line(self):
        # feedback 欄の無い過去月フォーマットの行は末尾に付加される
        e = ytcheck.set_feedback(MONTH, "legacy01", feedback="○")
        self.assertEqual(e["feedback"], "○")
        line = self.line_of("legacy01")
        self.assertTrue(line.endswith("[reason: 理由D] [feedback: ○]"))

    def test_check_and_feedback_together(self):
        e = ytcheck.set_feedback(MONTH, "vid001", checked=True, feedback="○")
        self.assertTrue(e["checked"])
        self.assertEqual(e["feedback"], "○")
        line = self.line_of("vid001")
        self.assertTrue(line.startswith("- [x] ") and line.endswith("[feedback: ○]"))

    def test_video_id_is_regex_escaped(self):
        # "vid.002" の "." が任意一致にならないこと(vidX002 の行を巻き込まない)
        before = self.line_of("vidX002")
        ytcheck.set_feedback(MONTH, "vid.002", feedback="×")
        self.assertEqual(self.line_of("vidX002"), before)
        self.assertTrue(self.line_of("vid.002").endswith("[feedback: ×]"))

    def test_other_lines_untouched(self):
        before = self.read_lines()
        ytcheck.set_feedback(MONTH, "vid001", checked=True)
        after = self.read_lines()
        self.assertEqual(len(before), len(after))
        diffs = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
        self.assertEqual(len(diffs), 1)
        self.assertIn("vid001", after[diffs[0]])

    def test_trailing_newline_preserved(self):
        ytcheck.set_feedback(MONTH, "vid001", checked=True)
        with open(self.viewing_path, encoding="utf-8") as f:
            self.assertTrue(f.read().endswith("\n"))

    def test_unknown_video_id_raises(self):
        with self.assertRaises(ytcheck.YtcheckError):
            ytcheck.set_feedback(MONTH, "nope999", checked=True)

    def test_missing_file_raises(self):
        with self.assertRaises(ytcheck.YtcheckError):
            ytcheck.set_feedback("2026-01", "vid001", checked=True)


class TestLock(YtcheckTestBase):
    def test_lock_file_created(self):
        ytcheck.set_feedback(MONTH, "vid001", checked=True)
        self.assertTrue(os.path.exists(os.path.join(self.root, ytcheck.LOCK_NAME)))

    def test_write_blocks_while_lock_held(self):
        # 外部プロセス(= ytcheck timer)役として先にロックを握り、write がブロックすることを確認
        fd = os.open(os.path.join(self.root, ytcheck.LOCK_NAME), os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        done = threading.Event()

        def writer():
            ytcheck.set_feedback(MONTH, "vid001", checked=True)
            done.set()

        t = threading.Thread(target=writer, daemon=True)
        t.start()
        time.sleep(0.3)
        self.assertFalse(done.is_set())  # ロック保持中は書けない
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        t.join(timeout=5)
        self.assertTrue(done.is_set())   # 解放後に完走する
        self.assertTrue(self.line_of("vid001").startswith("- [x] "))


UC1 = "UC" + "a" * 22
UC2 = "UC" + "b" * 22
UC3 = "UC" + "c" * 22

CHANNELS_JSON_FULL = {
    "updated": "2026-07-07",
    "genres": {"corporate_female": "企業勢女子", "indie": "個人勢"},
    "channels": [
        {"name": "チャンネルA", "channel_id": UC1, "check_days": 4,
         "genre": "corporate_female", "favorite": 4, "note": "",
         "subscriber_count": 1000, "subscriber_count_updated_at": "2026-07-06T00:00:00Z"},
        {"name": "チャンネルB", "channel_id": UC2, "check_days": 3,
         "genre": "indie", "favorite": 2, "note": "メモ"},
    ],
}


class ChannelEditTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.channels_path = os.path.join(os.path.realpath(self._tmp.name), "youtube-channels.json")
        with open(self.channels_path, "w", encoding="utf-8") as f:
            json.dump(CHANNELS_JSON_FULL, f, ensure_ascii=False)
        self._orig = ytcheck.CHANNELS_JSON
        ytcheck.CHANNELS_JSON = self.channels_path

    def tearDown(self):
        ytcheck.CHANNELS_JSON = self._orig
        self._tmp.cleanup()

    def read_json(self):
        with open(self.channels_path, encoding="utf-8") as f:
            return json.load(f)


class TestParseChannelId(unittest.TestCase):
    def test_bare_id(self):
        self.assertEqual(ytcheck.parse_channel_id(UC1), UC1)
        self.assertEqual(ytcheck.parse_channel_id("  %s\n" % UC1), UC1)

    def test_channel_url(self):
        for host in ("www.youtube.com", "youtube.com", "m.youtube.com"):
            with self.subTest(host=host):
                self.assertEqual(
                    ytcheck.parse_channel_id("https://%s/channel/%s" % (host, UC1)), UC1)
        # 後続パス(/videos 等)が付いていても channel セグメントから取れる
        self.assertEqual(
            ytcheck.parse_channel_id("https://www.youtube.com/channel/%s/videos" % UC1), UC1)

    def test_rejects(self):
        bad = [
            None, 123, "",
            "UCshort",                                        # 長さ不足
            UC1 + "x",                                        # 長さ超過
            "見てた %s すごい" % UC1,                          # 文中の UC 風部分文字列
            "https://www.youtube.com/@somehandle",            # @handle は非対応
            "https://www.youtube.com/watch?v=abc12345678",    # 動画 URL
            "https://evil.example/channel/%s" % UC1,          # allowlist 外 host
            "ftp://www.youtube.com/channel/%s" % UC1,         # 非 http(s)
        ]
        for text in bad:
            with self.subTest(text=text):
                self.assertIsNone(ytcheck.parse_channel_id(text))

    def test_valid_channel_id_is_fullmatch_only(self):
        self.assertTrue(ytcheck.valid_channel_id(UC1))
        for bad in (None, "", "https://www.youtube.com/channel/%s" % UC1, UC1 + "x"):
            with self.subTest(value=bad):
                self.assertFalse(ytcheck.valid_channel_id(bad))


class TestChannelCrud(ChannelEditTestBase):
    def test_list_channels(self):
        data = ytcheck.list_channels()
        self.assertEqual(len(data["channels"]), 2)
        self.assertEqual(data["genres"]["indie"], "個人勢")

    def test_genre_ids_from_json(self):
        self.assertEqual(ytcheck.genre_ids(), {"corporate_female", "indie"})

    def test_add_channel(self):
        entry = {"name": "新規", "channel_id": UC3, "check_days": 4,
                 "genre": "indie", "favorite": 3, "note": ""}
        with self.assertLogs("channel_store", level="WARNING"):  # tmpdir は repo 外 = commit warning のみ
            got = ytcheck.add_channel(entry)
        self.assertEqual(got["channel_id"], UC3)
        after = self.read_json()
        self.assertEqual(len(after["channels"]), 3)
        self.assertEqual(after["channels"][2]["name"], "新規")

    def test_add_duplicate_raises(self):
        entry = {"name": "重複", "channel_id": UC1, "check_days": 4,
                 "genre": "indie", "favorite": 3, "note": ""}
        with self.assertRaises(ValueError):
            ytcheck.add_channel(entry)
        self.assertEqual(len(self.read_json()["channels"]), 2)

    def test_update_channel(self):
        with self.assertLogs("channel_store", level="WARNING"):
            got = ytcheck.update_channel(UC1, {"favorite": 5, "note": "推し"})
        self.assertEqual(got["favorite"], 5)
        ch = self.read_json()["channels"][0]
        self.assertEqual((ch["favorite"], ch["note"]), (5, "推し"))
        self.assertEqual(ch["name"], "チャンネルA")  # 非対象フィールドは不変

    def test_update_missing_raises(self):
        with self.assertRaises(KeyError):
            ytcheck.update_channel(UC3, {"favorite": 5})

    def test_remove_channel(self):
        with self.assertLogs("channel_store", level="WARNING"):
            got = ytcheck.remove_channel(UC2)
        self.assertEqual(got["name"], "チャンネルB")
        after = self.read_json()["channels"]
        self.assertEqual([ch["channel_id"] for ch in after], [UC1])

    def test_remove_missing_raises(self):
        with self.assertRaises(KeyError):
            ytcheck.remove_channel(UC3)


if __name__ == "__main__":
    unittest.main()
