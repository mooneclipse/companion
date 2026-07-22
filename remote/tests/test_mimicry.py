#!/usr/bin/env python3
"""mimicry(F-mimicry read-only 閲覧データ層)の単体テスト。

境界判定(realpath/commonpath)の核は notestore 経由で vault と共有なのでカバレッジは
test_vault.py が担保する。ここでは mimicry 固有のふるまい(タイトル抽出: frontmatter を
落として最初の `# 見出し` を採る/無ければファイル名幹)と、MIMICRY_ROOT を差し替えても
共有コアの境界判定が同じく効くことだけを確認する。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import mimicry  # noqa: E402


class MimicryTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self._tmp.name)
        self._write(
            "s1/s1-宛先.md",
            "---\nseason: 1\nepisode: 2\nstatus: done\n---\n\n# 宛先\n\n本文。route53 の話。",
        )
        self._write("s1/s1-見出しなし.md", "frontmatter も見出しも無い本文だけのファイル。")
        self._write("_world/連作設定マスター.md", "# 連作短編 設定マスター\n\n設定本文。")
        self._write(".git/config.md", "除外されるべき git")
        self._orig_root = mimicry.MIMICRY_ROOT
        mimicry.MIMICRY_ROOT = self.root

    def tearDown(self):
        mimicry.MIMICRY_ROOT = self._orig_root
        self._tmp.cleanup()

    def _write(self, rel, content):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)


class TestList(MimicryTestBase):
    def test_title_from_heading_strips_frontmatter_and_prefix(self):
        data = mimicry.list_notes()
        names = {n["path"]: n["name"] for grp in data["folders"] for n in grp["notes"]}
        # ファイル名幹("s1-宛先")ではなく本文見出し("宛先")がタイトルになる
        self.assertEqual(names["s1/s1-宛先.md"], "宛先")

    def test_title_falls_back_to_stem_without_heading(self):
        data = mimicry.list_notes()
        names = {n["path"]: n["name"] for grp in data["folders"] for n in grp["notes"]}
        self.assertEqual(names["s1/s1-見出しなし.md"], "s1-見出しなし")

    def test_excludes_dotdirs(self):
        data = mimicry.list_notes()
        for grp in data["folders"]:
            for n in grp["notes"]:
                self.assertNotIn(".git", n["path"])


class TestGet(MimicryTestBase):
    def test_get_known_file(self):
        res = mimicry.get_note("s1/s1-宛先.md")
        self.assertIn("route53", res["content"])

    def test_missing_file_raises(self):
        with self.assertRaises(mimicry.MimicryError) as cm:
            mimicry.get_note("s1/nope.md")
        self.assertEqual(str(cm.exception), "not found")


class TestTraversalRejection(MimicryTestBase):
    def test_parent_escape(self):
        for bad in ("../secret.md", "../../etc/passwd.md", "s1/../../escape.md"):
            with self.subTest(path=bad):
                with self.assertRaises(mimicry.MimicryError):
                    mimicry.get_note(bad)

    def test_absolute_path(self):
        with self.assertRaises(mimicry.MimicryError):
            mimicry.get_note("/etc/passwd.md")

    def test_symlink_escape(self):
        outside = os.path.join(os.path.dirname(self.root), "outside-secret.md")
        with open(outside, "w", encoding="utf-8") as f:
            f.write("root 外の秘密")
        try:
            link = os.path.join(self.root, "s1", "link.md")
            os.symlink(outside, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unsupported")
        with self.assertRaises(mimicry.MimicryError):
            mimicry.get_note("s1/link.md")


class TestSearch(MimicryTestBase):
    def test_content_hit(self):
        res = mimicry.search("route53")
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["results"][0]["path"], "s1/s1-宛先.md")

    def test_result_name_is_heading_title(self):
        res = mimicry.search("route53")
        self.assertEqual(res["results"][0]["name"], "宛先")

    def test_no_hit(self):
        self.assertEqual(mimicry.search("存在しない語句zzz")["count"], 0)


if __name__ == "__main__":
    unittest.main()
