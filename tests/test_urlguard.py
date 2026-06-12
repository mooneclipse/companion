#!/usr/bin/env python3
"""urlguard / video の単体テスト。

urlguard は video-design §4.1 canonical 攻撃ベクタの mirror(bot.py 側 test と drift 検出)。
video._derive は socket 不要の純関数(phase 導出ロジック)を検証する。
実行: cd remote && python3 -m unittest discover -s tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

import urlguard  # noqa: E402
import video  # noqa: E402


class TestUrlguard(unittest.TestCase):
    # video-design §4.1 受理ベクタ(hostname 照合のみ、path で分岐しない)
    ACCEPT = [
        "https://www.youtube.com/watch?v=abc123",
        "https://youtu.be/abc123",
        "https://music.youtube.com/watch?v=abc123",
        "https://m.youtube.com/watch?v=abc123",
        "https://www.youtube.com/live/abc123",   # live も watch も同じ門
        "https://youtube.com/watch?v=abc123",
        "http://www.youtube.com/watch?v=abc123",  # http も受理(bot.py と同じ)
        "https://www.nicovideo.jp/watch/sm9",     # ニコニコ動画(2026-06-11 追加)
        "https://nico.ms/sm9",                    # ニコニコ短縮 URL
        "https://sp.nicovideo.jp/watch/sm9",      # ニコニコ SP 版
        "https://nicovideo.jp/watch/sm9",         # ニコニコ www なし
        "https://tver.jp/episodes/epi38mzxdc",    # TVer (2026-06-12 追加 = RV-11)
        "https://www.tver.jp/episodes/epi38mzxdc",  # TVer www あり
    ]
    # video-design §4.1 拒否ベクタ
    REJECT = [
        "https://evil@youtube.com/watch?v=x",       # userinfo 詐称
        "https://youtube.com@evil.com/watch?v=x",   # userinfo 詐称(host=evil.com)
        "https://www.youtube.com/watch?v=a b",      # 空白
        "https://www.youtube.com/watch?v=\x01",     # 制御文字
        "file:///etc/passwd",                       # http(s) 以外の scheme
        "ftp://youtube.com/x",                      # http(s) 以外の scheme
        "http://169.254.169.254/latest/meta-data",  # SSRF 起点(非 allowlist)
        "https://youtube.com.evil.com/watch?v=x",   # suffix 偽装
        "https://notyoutube.com/watch?v=x",         # 非 allowlist host
        "https://evil@nicovideo.jp/watch/sm9",      # userinfo 詐称(ニコニコ版)
        "https://nicovideo.jp.evil.com/watch/sm9",  # suffix 偽装(ニコニコ版)
        "https://nico.ms.evil.com/sm9",             # suffix 偽装(nico.ms 版)
        "https://embed.nicovideo.jp/watch/sm9",     # 非 allowlist サブドメイン
        "https://evil@tver.jp/episodes/x",          # userinfo 詐称(TVer 版)
        "https://tver.jp.evil.com/episodes/x",      # suffix 偽装(TVer 版)
        "",                                          # 空
        "not a url",                                 # 空白含む非 URL
    ]

    def test_accept(self):
        for u in self.ACCEPT:
            with self.subTest(url=u):
                self.assertIsNotNone(urlguard.normalize(u))

    def test_reject(self):
        for u in self.REJECT:
            with self.subTest(url=u):
                self.assertIsNone(urlguard.normalize(u))

    def test_non_string(self):
        self.assertIsNone(urlguard.normalize(None))
        self.assertIsNone(urlguard.normalize(123))

    def test_dl_rejects_stream_only(self):
        # 事前 DL の門: TVer は再生 OK でも DL は不可(RV-11 判断、期限付き見逃し配信)。
        self.assertIsNone(urlguard.normalize_dl("https://tver.jp/episodes/epi38mzxdc"))
        self.assertIsNone(urlguard.normalize_dl("https://www.tver.jp/episodes/epi38mzxdc"))

    def test_dl_accepts_downloadable(self):
        # YouTube / ニコニコは従来どおり DL 可。非 allowlist は normalize と同様に拒否。
        self.assertIsNotNone(urlguard.normalize_dl("https://www.youtube.com/watch?v=abc123"))
        self.assertIsNotNone(urlguard.normalize_dl("https://www.nicovideo.jp/watch/sm9"))
        self.assertIsNone(urlguard.normalize_dl("https://notyoutube.com/watch?v=x"))


class TestVideoDerive(unittest.TestCase):
    def test_idle(self):
        s = video._derive({"idle-active": True})
        self.assertEqual(s["phase"], "idle")
        self.assertFalse(s["is_live"])

    def test_resolving(self):
        # loadfile 直後: file あり(idle-active False)だが再生未開始(time-pos None)
        s = video._derive({"idle-active": False, "time-pos": None, "duration": None})
        self.assertEqual(s["phase"], "resolving")
        self.assertFalse(s["is_live"])

    def test_playing_vod(self):
        # VOD は seekable=True(V-A3 実測: シーク可) → is_live False
        s = video._derive({"idle-active": False, "time-pos": 12.0, "duration": 300.0,
                           "seekable": True, "pause": False})
        self.assertEqual(s["phase"], "playing")
        self.assertFalse(s["is_live"])
        self.assertEqual(s["pos"], 12.0)

    def test_paused_vod(self):
        s = video._derive({"idle-active": False, "time-pos": 12.0, "duration": 300.0,
                           "seekable": True, "pause": True})
        self.assertEqual(s["phase"], "paused")
        self.assertFalse(s["is_live"])

    def test_playing_live(self):
        # V-A3 実測(2026-05-20): live は DVR バッファ長を有限 duration で返すが seekable=False
        s = video._derive({"idle-active": False, "time-pos": 82.9, "duration": 103.9,
                           "seekable": False, "pause": False})
        self.assertEqual(s["phase"], "playing")
        self.assertTrue(s["is_live"])


if __name__ == "__main__":
    unittest.main()
