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

import auth

HOST = "127.0.0.1"
PORT = int(os.environ.get("REMOTE_PORT", "47824"))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
MAX_BODY = 64 * 1024  # (iii) JSON body 上限。F-1 prompt の別枠拡張は v1-β。


def health(handler):
    """GET /api/health — 無認証の生存確認(情報を漏らさず liveness のみ)。"""
    return 200, {"status": "ok"}


# (i) API 明示ルートテーブル。値は (handler, auth_required)。ここに無い (method, path) は 404。
#     self.path を FS に連結しない。auth_required=False は無認証 endpoint(生存確認のみ)、
#     それ以外の /api/* は (iv) Bearer 必須。
ROUTES = {
    ("GET", "/api/health"): (health, False),
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

    def _authorized(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            return False
        return auth.verify(h[7:].strip())

    def _read_body(self, max_bytes=MAX_BODY):
        """検証済み Content-Length 分の body を読む(_dispatch で cap 済)。"""
        try:
            clen = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return b""
        if clen <= 0 or clen > max_bytes:
            return b""
        return self.rfile.read(clen)

    def _dispatch(self, method):
        path = self.path.split("?", 1)[0]
        # (iii) Content-Length 手動 cap(全リクエスト共通)。body 読込前に弾く。
        # body 未読で応答する分岐は keep-alive 再利用での desync を避けるため接続を閉じる。
        # chunked は未サポート(制御下のクライアントは Content-Length 送出)。未読 body の
        # desync を避けるため明示拒否する。
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            self.close_connection = True
            self._send_json(400, {"error": "bad request"})
            return
        try:
            clen = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            self.close_connection = True
            self._send_json(400, {"error": "bad request"})
            return
        if clen < 0 or clen > MAX_BODY:
            self.close_connection = True
            self._send_json(413, {"error": "payload too large"})
            return
        route = ROUTES.get((method, path))
        if route is not None:
            handler, auth_required = route
            # (iv) Bearer 必須 endpoint
            if auth_required and not self._authorized():
                if clen:
                    self.close_connection = True
                self._send_json(401, {"error": "unauthorized"})
                return
            try:
                code, obj = handler(self)
            except Exception:
                # (v) 内部例外はスタック/パスを出さず generic 500
                self._send_json(500, {"error": "internal error"})
                return
            self._send_json(code, obj)
            return
        if method == "GET":
            static = STATIC.get(path)
            if static is not None:
                self._serve_static(static)
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
