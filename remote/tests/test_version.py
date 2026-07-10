#!/usr/bin/env python3
"""version(デプロイ版解決)の単体テスト。

git に依存しない純関数 format_version の文字列生成を検証する。subprocess 自体は
mock せず、純関数の境界(hash あり/なし、date あり/なし、空白除去)のみ確認する。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import version  # noqa: E402


class FormatVersionTest(unittest.TestCase):
    def test_hash_and_date(self):
        self.assertEqual(version.format_version("9b60fe9", "2026-06-08"), "9b60fe9 (2026-06-08)")

    def test_hash_only(self):
        self.assertEqual(version.format_version("9b60fe9", ""), "9b60fe9")
        self.assertEqual(version.format_version("9b60fe9", None), "9b60fe9")

    def test_no_hash_falls_back_to_unknown(self):
        self.assertEqual(version.format_version("", "2026-06-08"), version.UNKNOWN)
        self.assertEqual(version.format_version(None, None), version.UNKNOWN)

    def test_strips_whitespace(self):
        self.assertEqual(version.format_version("  9b60fe9\n", " 2026-06-08 "), "9b60fe9 (2026-06-08)")

    def test_app_version_is_nonempty_string(self):
        # 起動時に1回確定する定数。git 解決でも unknown フォールバックでも非空文字列。
        self.assertIsInstance(version.APP_VERSION, str)
        self.assertTrue(version.APP_VERSION)


if __name__ == "__main__":
    unittest.main()
