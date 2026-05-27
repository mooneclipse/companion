#!/usr/bin/env python3
"""dashboard helper — 127.0.0.1:<PORT> で GET /np と GET /news を提供。

- /np: mpv の IPC socket（$XDG_RUNTIME_DIR/dashboard-mpv.sock）から再生中の曲名・
  アーティストを読み、JSON で返す（Access-Control-Allow-Origin: *、ダッシュボードは
  file:// から fetch する）。
- /news: NHK NEWS WEB RSS (主要ニュース) を proxy 取得し、見出しを 1〜3 件 JSON で返す。
  file:// origin から外部 RSS への直 fetch は CORS で弾かれるため helper 経由（既存
  /np と同じ pattern、STATUS.md 「天気」B5 contingency と同方針）。

設計（~/companion/CLAUDE.md 準拠）:
- mpv 不在 / socket 無し / 接続拒否 / タイムアウト ＝「再生していない」正常状態 → {"playing": false} を 200 で返す。
  500 やリトライにしない。1 回の connect-or-empty で確定。
- /news も同じく fetch 失敗 / parse 失敗 = {"items": []} を 200 で返す。retry/backoff は無し
  （client 側で 1 時間ごとに再ポーリングするのみ）。
- /news レスポンスは helper メモリ内で TTL=30 分キャッシュ（NHK RSS への過剰アクセス回避、
  client が多重に叩いても外部 fetch は最大 30 分に 1 回）。
- 1 クライアント・低頻度ポーリング（~2.5s）前提。リクエスト毎に接続して即閉じる。
"""
import json
import os
import re
import socket
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.etree import ElementTree as ET

PORT = 47823  # web/dashboard-config.js の nowPlaying.port と一致させること
SOCK_PATH = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR") or ("/run/user/%d" % os.getuid()),
    "dashboard-mpv.sock",
)


def _mpv_get(prop):
    """mpv IPC で 1 プロパティ取得。失敗は None。"""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.8)
        s.connect(SOCK_PATH)
        s.sendall(json.dumps({"command": ["get_property", prop], "request_id": 1}).encode() + b"\n")
        buf = b""
        # mpv は非同期イベントも流すので request_id 一致の行を探す
        for _ in range(50):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.decode("utf-8", "replace"))
                except ValueError:
                    continue
                if msg.get("request_id") == 1:
                    s.close()
                    if msg.get("error") == "success":
                        return msg.get("data")
                    return None
        s.close()
    except OSError:
        return None
    return None


def now_playing():
    title = _mpv_get("media-title")
    if not title:
        return {"playing": False}
    artist = None
    meta = _mpv_get("metadata")
    if isinstance(meta, dict):
        for k in ("artist", "ARTIST", "Artist", "album_artist", "ALBUM_ARTIST"):
            if meta.get(k):
                artist = meta[k]
                break
    return {"playing": True, "title": title, "artist": artist}


# ─── /news: NHK NEWS WEB RSS proxy ─────────────────────────────────
# 取得元: NHK NEWS WEB 主要ニュース RSS。選定理由: 認証不要・日本語主要ニュースで
# 安定運用、公開 RSS で API key 不要、CORS proxy 1 段のみで完結（STATUS.md 参照）。
NEWS_RSS_URL = "https://www.nhk.or.jp/rss/news/cat0.xml"
NEWS_MAX_ITEMS = 3
NEWS_FETCH_TIMEOUT = 3.0
NEWS_CACHE_TTL = 1800  # 30 分（client 側 1 時間ポーリングと合わせ過剰 fetch を防ぐ）

_news_cache = {"ts": 0.0, "items": []}


def _fetch_news_rss():
    """NHK RSS を fetch → title を 1〜3 件抽出。失敗は []。"""
    try:
        req = urllib.request.Request(
            NEWS_RSS_URL,
            headers={"User-Agent": "companion-dashboard/1.0 (+local kiosk)"},
        )
        with urllib.request.urlopen(req, timeout=NEWS_FETCH_TIMEOUT) as resp:
            raw = resp.read(1024 * 1024)  # 1MB 上限（配信元事故対策）
    except (OSError, ValueError):
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    items = []
    # RSS 2.0: rss > channel > item > title
    for item in root.iter("item"):
        title_el = item.find("title")
        if title_el is None or not title_el.text:
            continue
        text = re.sub(r"\s+", " ", title_el.text).strip()
        if text:
            items.append(text)
        if len(items) >= NEWS_MAX_ITEMS:
            break
    return items


def news_items():
    """TTL キャッシュ越しに見出しを返す。fetch 失敗時は空配列。"""
    now = time.time()
    if now - _news_cache["ts"] < NEWS_CACHE_TTL and _news_cache["items"]:
        return _news_cache["items"]
    items = _fetch_news_rss()
    if items:
        _news_cache["ts"] = now
        _news_cache["items"] = items
        return items
    # 失敗時は前回成功値があれば（古くても 1 時間程度まで）流用、無ければ空。
    # retry/backoff はしない（次の client ポーリングで再試行）。
    if _news_cache["items"] and now - _news_cache["ts"] < 3600:
        return _news_cache["items"]
    return []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/np":
            try:
                self._send_json(now_playing())
            except Exception:
                self._send_json({"playing": False})
        elif path == "/news":
            try:
                self._send_json({"items": news_items()})
            except Exception:
                self._send_json({"items": []})
        else:
            self._send_json({"error": "not found"}, code=404)

    def log_message(self, *args):  # journal を汚さない
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
