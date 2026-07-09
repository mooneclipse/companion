#!/usr/bin/env python3
"""vault(F-vault read-only 閲覧データ層)の単体テスト。

list が全 .md を再帰列挙 / 既知ファイルの get / パストラバーサル拒否(../ や
vault 外パス, 非.md, symlink 脱出) / search のファイル名・本文ヒット を検証する。
tmpdir に擬似 vault を作り VAULT_ROOT を差し替えて隔離する。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import vault  # noqa: E402


class VaultTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self._tmp.name)
        # 擬似 vault: ルート直下 + notes/ + clips/ + 除外対象 .obsidian/ .git/
        self._write("ようこそ.md", "# ようこそ\nこれはトップノート。")
        self._write("notes/alpha.md", "---\ntags: [aws, dns]\n---\n# Alpha\nroute53 の話。")
        self._write("notes/beta.md", "# Beta\n[[alpha]] を参照。検索ワード xyzzy。")
        self._write("clips/clip1.md", "# Clip\nクリップ本文。")
        self._write("notes/not-markdown.txt", "これは .md でない")
        self._write(".obsidian/workspace.md", "除外されるべき設定")
        self._write(".git/config.md", "除外されるべき git")
        # 埋め込みローカル画像(attachments/) — get_image 用。中身は擬似バイト列。
        self._write_bytes("attachments/pic.png", b"\x89PNG\r\n\x1a\nfakebytes")
        self._write_bytes("attachments/photo.jpg", b"\xff\xd8\xfffakejpeg")
        self._write_bytes("attachments/evil.exe", b"MZ binary")
        self._orig_root = vault.VAULT_ROOT
        vault.VAULT_ROOT = self.root

    def tearDown(self):
        vault.VAULT_ROOT = self._orig_root
        self._tmp.cleanup()

    def _write(self, rel, content):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def _write_bytes(self, rel, content):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(content)


class TestList(VaultTestBase):
    def test_lists_all_md(self):
        data = vault.list_notes()
        paths = set()
        for grp in data["folders"]:
            for n in grp["notes"]:
                paths.add(n["path"])
        # .md は4件(.txt / .obsidian / .git は除外)
        self.assertEqual(data["count"], 4)
        self.assertEqual(paths, {"ようこそ.md", "notes/alpha.md", "notes/beta.md", "clips/clip1.md"})

    def test_excludes_dotdirs(self):
        data = vault.list_notes()
        for grp in data["folders"]:
            self.assertFalse(grp["folder"].startswith("."))
            for n in grp["notes"]:
                self.assertNotIn(".obsidian", n["path"])
                self.assertNotIn(".git", n["path"])

    def test_grouped_by_folder(self):
        data = vault.list_notes()
        folders = {g["folder"] for g in data["folders"]}
        self.assertIn("", folders)        # ルート直下
        self.assertIn("notes", folders)
        self.assertIn("clips", folders)

    def test_notes_have_mtime(self):
        data = vault.list_notes()
        for grp in data["folders"]:
            for n in grp["notes"]:
                self.assertIn("mtime", n)
                self.assertIsInstance(n["mtime"], int)
                self.assertGreater(n["mtime"], 0)

    def test_mtime_reflects_modification(self):
        import time
        time.sleep(1.1)
        self._write("notes/alpha.md", "updated content")
        data = vault.list_notes()
        mtimes = {}
        for grp in data["folders"]:
            for n in grp["notes"]:
                mtimes[n["path"]] = n["mtime"]
        self.assertGreater(mtimes["notes/alpha.md"], mtimes["notes/beta.md"])

    def test_name_is_stem(self):
        data = vault.list_notes()
        for grp in data["folders"]:
            for n in grp["notes"]:
                self.assertFalse(n["name"].endswith(".md"))


class TestGet(VaultTestBase):
    def test_get_known_file(self):
        res = vault.get_note("notes/alpha.md")
        self.assertEqual(res["path"], "notes/alpha.md")
        self.assertIn("route53", res["content"])

    def test_get_root_file(self):
        self.assertIn("トップノート", vault.get_note("ようこそ.md")["content"])

    def test_missing_file_raises(self):
        with self.assertRaises(vault.VaultError) as cm:
            vault.get_note("notes/nope.md")
        self.assertEqual(str(cm.exception), "not found")


class TestTraversalRejection(VaultTestBase):
    def test_parent_escape(self):
        for bad in ("../secret.md", "../../etc/passwd.md", "notes/../../escape.md"):
            with self.subTest(path=bad):
                with self.assertRaises(vault.VaultError):
                    vault.get_note(bad)

    def test_absolute_path(self):
        with self.assertRaises(vault.VaultError):
            vault.get_note("/etc/passwd.md")

    def test_non_md_extension(self):
        # 実在する .txt でも拡張子で拒否(任意ファイル読み出し封じ)
        with self.assertRaises(vault.VaultError):
            vault.get_note("notes/not-markdown.txt")

    def test_empty_and_nonstring(self):
        for bad in ("", None, 123):
            with self.subTest(path=bad):
                with self.assertRaises(vault.VaultError):
                    vault.get_note(bad)

    def test_null_byte(self):
        with self.assertRaises(vault.VaultError):
            vault.get_note("notes/alpha.md\x00.png")

    def test_symlink_escape(self):
        # vault 外の .md を指す symlink を vault 内に置いても realpath 照合で弾く
        outside = os.path.join(os.path.dirname(self.root), "outside-secret.md")
        with open(outside, "w", encoding="utf-8") as f:
            f.write("vault 外の秘密")
        try:
            link = os.path.join(self.root, "notes", "link.md")
            os.symlink(outside, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unsupported")
        with self.assertRaises(vault.VaultError):
            vault.get_note("notes/link.md")

    def test_sibling_prefix_dir_not_matched(self):
        # VAULT_ROOT の prefix を共有する兄弟ディレクトリ(root + '-evil')を root 配下と誤認しない
        evil = self.root + "-evil"
        os.makedirs(evil, exist_ok=True)
        with open(os.path.join(evil, "x.md"), "w", encoding="utf-8") as f:
            f.write("外部")
        try:
            rel = os.path.relpath(os.path.join(evil, "x.md"), self.root)  # ../<root>-evil/x.md
            with self.assertRaises(vault.VaultError):
                vault.get_note(rel)
        finally:
            import shutil
            shutil.rmtree(evil, ignore_errors=True)


class TestSearch(VaultTestBase):
    def test_content_hit(self):
        res = vault.search("xyzzy")
        self.assertEqual(res["count"], 1)
        self.assertEqual(res["results"][0]["path"], "notes/beta.md")
        self.assertIn("xyzzy", res["results"][0]["snippet"])

    def test_filename_hit(self):
        res = vault.search("alpha")  # notes/alpha.md はファイル名 + beta 本文の wikilink にもヒット
        paths = {r["path"] for r in res["results"]}
        self.assertIn("notes/alpha.md", paths)

    def test_case_insensitive(self):
        self.assertEqual(vault.search("ROUTE53")["count"], 1)

    def test_empty_query(self):
        res = vault.search("   ")
        self.assertEqual(res["count"], 0)
        self.assertEqual(res["results"], [])

    def test_no_hit(self):
        self.assertEqual(vault.search("存在しない語句zzz")["count"], 0)


class TestImage(VaultTestBase):
    def test_get_png(self):
        res = vault.get_image("attachments/pic.png")
        self.assertEqual(res["content_type"], "image/png")
        self.assertTrue(res["bytes"].startswith(b"\x89PNG"))

    def test_get_jpg(self):
        res = vault.get_image("attachments/photo.jpg")
        self.assertEqual(res["content_type"], "image/jpeg")
        self.assertTrue(res["bytes"].startswith(b"\xff\xd8\xff"))

    def test_non_image_extension(self):
        # 実在する .exe でも拡張子で拒否(任意ファイル読み出し封じ)
        with self.assertRaises(vault.VaultError):
            vault.get_image("attachments/evil.exe")

    def test_md_is_not_image(self):
        # .md は画像エンドポイントからは取れない(拡張子 allowlist 外)
        with self.assertRaises(vault.VaultError):
            vault.get_image("notes/alpha.md")

    def test_missing_image_raises(self):
        with self.assertRaises(vault.VaultError) as cm:
            vault.get_image("attachments/nope.png")
        self.assertEqual(str(cm.exception), "not found")

    def test_parent_escape(self):
        for bad in ("../secret.png", "../../etc/shadow.png", "attachments/../../escape.png"):
            with self.subTest(path=bad):
                with self.assertRaises(vault.VaultError):
                    vault.get_image(bad)

    def test_absolute_path(self):
        with self.assertRaises(vault.VaultError):
            vault.get_image("/etc/passwd.png")

    def test_null_byte(self):
        with self.assertRaises(vault.VaultError):
            vault.get_image("attachments/pic.png\x00.md")

    def test_empty_and_nonstring(self):
        for bad in ("", None, 123):
            with self.subTest(path=bad):
                with self.assertRaises(vault.VaultError):
                    vault.get_image(bad)

    def test_symlink_escape(self):
        outside = os.path.join(os.path.dirname(self.root), "outside-secret.png")
        with open(outside, "wb") as f:
            f.write(b"outside-secret-image-bytes")
        try:
            link = os.path.join(self.root, "attachments", "link.png")
            os.symlink(outside, link)
        except (OSError, NotImplementedError):
            self.skipTest("symlink unsupported")
        with self.assertRaises(vault.VaultError):
            vault.get_image("attachments/link.png")


if __name__ == "__main__":
    unittest.main()
