#!/usr/bin/env python3
"""now-playing helper — 127.0.0.1:<PORT> で GET /np のみ提供。

mpv の IPC socket（$XDG_RUNTIME_DIR/dashboard-mpv.sock）から再生中の曲名・アーティストを読み、
JSON で返す（Access-Control-Allow-Origin: *、ダッシュボードは file:// から fetch する）。

設計（~/companion/CLAUDE.md 準拠）:
- mpv 不在 / socket 無し / 接続拒否 / タイムアウト ＝「再生していない」正常状態 → {"playing": false} を 200 で返す。
  500 やリトライにしない。1 回の connect-or-empty で確定。
- 1 クライアント・低頻度ポーリング（~2.5s）前提。リクエスト毎に接続して即閉じる。
"""
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
        if self.path.split("?", 1)[0] == "/np":
            try:
                self._send_json(now_playing())
            except Exception:
                self._send_json({"playing": False})
        else:
            self._send_json({"error": "not found"}, code=404)

    def log_message(self, *args):  # journal を汚さない
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
