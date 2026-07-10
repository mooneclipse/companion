#!/usr/bin/env python3
"""playlist.parse_entries の単体テスト (RV-12)。

実 yt-dlp は叩かず、flat-playlist -J が返す JSON dict のパース + urlguard 連携
(C4: allowlist 外 entry の skip) + title sanitize + limit cap を fixture で検証する。
実 yt-dlp 展開 (url 形式 / title 欠落 / 展開時間) はユーザー在席時に実プレイリストで実測。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import playlist  # noqa: E402


class TestParseEntries(unittest.TestCase):
    def test_youtube_playlist(self):
        data = {"_type": "playlist", "entries": [
            {"url": "https://www.youtube.com/watch?v=aaa", "title": "Song A"},
            {"url": "https://www.youtube.com/watch?v=bbb", "title": "Song B"},
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(r["total"], 2)
        self.assertEqual(len(r["entries"]), 2)
        self.assertEqual(r["entries"][0]["title"], "Song A")
        self.assertEqual(r["entries"][1]["url"], "https://www.youtube.com/watch?v=bbb")

    def test_nicovideo_mylist(self):
        data = {"entries": [
            {"url": "https://www.nicovideo.jp/watch/sm9", "title": "ニコ動画"},
            {"url": "https://nico.ms/sm10", "title": "短縮"},
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(len(r["entries"]), 2)
        self.assertEqual(r["entries"][1]["url"], "https://nico.ms/sm10")

    def test_single_video_no_entries(self):
        # list= 無しが play_playlist に来た等。entries 無し → data 1 件 (webpage_url)。
        data = {"webpage_url": "https://www.youtube.com/watch?v=zzz", "title": "Single"}
        r = playlist.parse_entries(data)
        self.assertEqual(r["total"], 1)
        self.assertEqual(len(r["entries"]), 1)
        self.assertEqual(r["entries"][0]["url"], "https://www.youtube.com/watch?v=zzz")

    def test_c4_reject_entries_are_skipped(self):
        # C4: allowlist 外 / url 無しの entry は 1 件だけ skip、展開全体は fail させない。
        data = {"entries": [
            {"url": "https://www.youtube.com/watch?v=aaa", "title": "ok"},
            {"url": "https://evil.com/watch?v=x", "title": "外部 host"},   # skip
            {"url": None, "title": "url 無し"},                            # skip
            {"title": "url キー欠落"},                                     # skip
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(r["total"], 4)       # 生件数は 4
        self.assertEqual(len(r["entries"]), 1)  # 通過は 1 (loaded で「4 件中 1 件」表示)
        self.assertEqual(r["entries"][0]["title"], "ok")

    def test_empty_playlist(self):
        r = playlist.parse_entries({"entries": []})
        self.assertEqual(r["total"], 0)
        self.assertEqual(r["entries"], [])

    def test_list_param_preserved(self):
        # C5: watch?v=X&list=PL... 形式の entry も normalize 通過 (host=youtube)。
        # url に list= が残っても mpv 側 service の no-playlist= 強制が無視する。
        data = {"entries": [
            {"url": "https://www.youtube.com/watch?v=x&list=PL123&index=1", "title": "t"},
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(len(r["entries"]), 1)
        self.assertIn("list=PL123", r["entries"][0]["url"])

    def test_title_sanitize(self):
        data = {"entries": [
            {"url": "https://youtu.be/x", "title": "a\x00b\x1fc"},  # 制御文字 → 空白
            {"url": "https://youtu.be/y", "title": "  "},          # 空白のみ → None
            {"url": "https://youtu.be/z"},                          # title キー無し → None
            {"url": "https://youtu.be/w", "title": "x" * 300},     # 200 字 cap
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(r["entries"][0]["title"], "a b c")
        self.assertIsNone(r["entries"][1]["title"])
        self.assertIsNone(r["entries"][2]["title"])
        self.assertEqual(len(r["entries"][3]["title"]), 200)

    def test_limit_cap(self):
        # C3: limit 件で頭切り (yt-dlp -I 側 cap の二重ガード)。total は cap 前の生件数。
        entries = [{"url": "https://youtu.be/v%d" % i, "title": "t%d" % i} for i in range(5)]
        r = playlist.parse_entries({"entries": entries}, limit=2)
        self.assertEqual(r["total"], 5)
        self.assertEqual(len(r["entries"]), 2)

    def test_invalid_json_shapes(self):
        with self.assertRaises(playlist.PlaylistError):
            playlist.parse_entries("not a dict")
        with self.assertRaises(playlist.PlaylistError):
            playlist.parse_entries({"entries": "not a list"})

    def test_non_dict_entry_skipped(self):
        data = {"entries": [
            "broken",                                              # 非 dict → skip
            {"url": "https://youtu.be/ok", "title": "ok"},
        ]}
        r = playlist.parse_entries(data)
        self.assertEqual(r["total"], 2)
        self.assertEqual(len(r["entries"]), 1)


if __name__ == "__main__":
    unittest.main()
