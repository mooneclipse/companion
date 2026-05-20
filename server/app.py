#!/usr/bin/env python3
"""companion-remote server skeleton — 127.0.0.1 バインドの stdlib http.server。

スマホ専用リモコン PWA の配信 + API サーバ。外向きは tailscale serve(HTTPS, 前段
リバースプロキシ)経由のみで、本プロセスは 127.0.0.1 にしか bind しない
(0.0.0.0 / tailnet IP 厳禁、x11vnc の tailnet IP 直バインドは反面教師)。
設計: ~/companion/workspace/redesign/remote-design.md v1.0。

ガードレール(design §3.1。本ファイル RA-1 では (i)(ii)(v) を土台化):
 (i)  API は明示ルートテーブル {(method, path): handler} のみ。self.path を FS に連結しない。
 (ii) 静的ファイルは固定 allowlist dict 配信。URL→FS join しない(PWA 本体は RA-5 で追加)。
 (v)  ディレクトリリスティング無し / Content-Type 明示 / エラーは generic(内部パス・スタック非漏洩)。
RA-2 で (iii) Content-Length cap + (iv) Bearer 認証(/api/* 必須)を追加する。
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("REMOTE_PORT", "47824"))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


def health(handler):
    """GET /api/health — 認証不要の生存確認。"""
    return 200, {"status": "ok"}


# (i) API 明示ルートテーブル。ここに無い (method, path) は 404。self.path を FS に連結しない。
ROUTES = {
    ("GET", "/api/health"): health,
}

# (ii) 静的ファイル allowlist。{url_path: (web/ 配下の相対パス, content_type)}。
#      URL を FS に連結せず、この dict に列挙された固定パスのみ配信する。PWA 本体は RA-5 で追加。
STATIC = {}


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

    def _send_json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def _serve_static(self, entry):
        rel, content_type = entry
        try:
            with open(os.path.join(WEB_DIR, rel), "rb") as f:
                body = f.read()
        except OSError:
            self._send_json(404, {"error": "not found"})
            return
        self._send(200, body, content_type)

    def _dispatch(self, method):
        path = self.path.split("?", 1)[0]
        handler = ROUTES.get((method, path))
        if handler is not None:
            try:
                code, obj = handler(self)
            except Exception:
                # (v) 内部例外はスタック/パスを出さず generic 500
                self._send_json(500, {"error": "internal error"})
                return
            self._send_json(code, obj)
            return
        if method == "GET":
            entry = STATIC.get(path)
            if entry is not None:
                self._serve_static(entry)
                return
        self._send_json(404, {"error": "not found"})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

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
