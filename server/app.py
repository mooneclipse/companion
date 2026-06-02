#!/usr/bin/env python3
"""companion-games server — 127.0.0.1 バインドの stdlib http.server。

「全部 AI で作るゲーム」umbrella の配信サーバ。v1 は静的 PWA「みちゆき」一本を配る。
外向きは tailscale serve(HTTPS, 前段リバースプロキシ)経由のみで、本プロセスは
127.0.0.1 にしか bind しない(0.0.0.0 / tailnet IP 厳禁、companion-remote の流儀を踏襲)。

ガードレール(remote/server/app.py RA-1 と同じ土台):
 - 静的ファイルは固定 allowlist dict 配信。URL を FS に連結しない / ディレクトリ
   リスティング無し / Content-Type 明示 / エラーは generic(内部パス・スタック非漏洩)。
 - API は不要(純静的、認証も tailscale 境界に委ねる単一ユーザー)。生存確認のみ無認証。

ランタイムで claude / 外部 API を呼ばない(budget-guard 境界に踏み込まない)。ゲームの
断章はビルド時に AI 生成した静的データで、配信時は素朴なファイルサーブに徹する。
"""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("GAMES_PORT", "47825"))
# web ルートは michiyuki/web。umbrella で複数ゲームになったら STATIC を増やす方針。
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "michiyuki", "web")

# 静的ファイル allowlist。{url_path: (web/ 配下の相対パス, content_type)}。
# URL を FS に連結せず、この dict に列挙された固定パスのみ配信する(無認証)。
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/fragments.js": ("fragments.js", "application/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/manifest.json": ("manifest.json", "application/manifest+json"),
    "/sw.js": ("sw.js", "application/javascript; charset=utf-8"),
    "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
    "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, content_type):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_text(self, code, msg, content_type="text/plain; charset=utf-8"):
        self._send(code, msg, content_type)

    def _serve_static(self, entry):
        rel, content_type = entry
        try:
            with open(os.path.join(WEB_DIR, rel), "rb") as f:
                body = f.read()
        except OSError:
            self._send_text(404, "not found")
            return
        self._send(200, body, content_type)

    def _dispatch(self, method):
        path = self.path.split("?", 1)[0]
        # 生存確認(無認証、情報を漏らさず liveness のみ)。
        if method == "GET" and path == "/healthz":
            self._send_text(200, "ok")
            return
        if method == "GET":
            static = STATIC.get(path)
            if static is not None:
                self._serve_static(static)
                return
        self._send_text(404, "not found")

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def log_message(self, *args):  # journal を汚さない
        pass


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
