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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import auth
import status as os_status
import voice

HOST = "127.0.0.1"
PORT = int(os.environ.get("REMOTE_PORT", "47824"))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
MAX_BODY = 64 * 1024  # (iii) JSON body 上限。F-1 prompt の別枠拡張は v1-β。
SAY_MAX_TEXT = 2000  # say.sh の MAX_TEXT_LEN と一致(事前 reject 用)
SAY_MIN_INTERVAL = 1.5  # 簡易 rate-limit(秒)。連打抑止。並行は say.sh flock(exit 3→409)が吸収
_say_lock = threading.Lock()
_last_say = 0.0
# say.sh exit code → (HTTP status, body)
_SAY_EXIT_MAP = {
    0: (200, {"status": "ok"}),
    1: (503, {"error": "engine unreachable"}),
    2: (400, {"error": "invalid args"}),
    3: (409, {"error": "busy, retry"}),
    4: (502, {"error": "synthesis failed"}),
    5: (500, {"error": "playback failed"}),
}


def health(handler):
    """GET /api/health — 無認証の生存確認(情報を漏らさず liveness のみ)。"""
    return 200, {"status": "ok"}


def api_status(handler):
    """GET /api/status — F-3 OS status(df/free/sensors/uptime)。Bearer 必須。"""
    return 200, os_status.collect()


def api_say(handler):
    """POST /api/say — F-2 voice 発話。{"text": str, "speaker": int?}。Bearer 必須。

    text/speaker は argv で say.sh に渡す(env には流さない)。簡易 rate-limit +
    say.sh exit code を HTTP に写像。失敗は say.sh 側で Discord 通知に波及する(N-1)。
    """
    try:
        data = json.loads(handler._read_body() or b"{}")
    except ValueError:
        return 400, {"error": "invalid json"}
    if not isinstance(data, dict):
        return 400, {"error": "invalid json"}
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        return 400, {"error": "text required"}
    if len(text) > SAY_MAX_TEXT:
        return 400, {"error": "text too long"}
    speaker = data.get("speaker")
    if speaker is not None and (isinstance(speaker, bool) or not isinstance(speaker, int) or speaker < 0):
        return 400, {"error": "speaker must be a non-negative integer"}

    # 簡易 rate-limit(連打抑止)。タイムスタンプのみ lock で守り、say 実行は lock 外。
    global _last_say
    with _say_lock:
        now = time.monotonic()
        if now - _last_say < SAY_MIN_INTERVAL:
            return 429, {"error": "too many requests"}
        _last_say = now

    rc = voice.say(text, speaker)
    if rc is None:
        return 503, {"error": "voice unavailable"}  # 起動不能/timeout
    return _SAY_EXIT_MAP.get(rc, (500, {"error": "voice failed"}))


# (i) API 明示ルートテーブル。値は (handler, auth_required)。ここに無い (method, path) は 404。
#     self.path を FS に連結しない。auth_required=False は無認証 endpoint(生存確認のみ)、
#     それ以外の /api/* は (iv) Bearer 必須。
ROUTES = {
    ("GET", "/api/health"): (health, False),
    ("GET", "/api/status"): (api_status, True),
    ("POST", "/api/say"): (api_say, True),
}

# (ii) 静的ファイル allowlist。{url_path: (web/ 配下の相対パス, content_type)}。
#      URL を FS に連結せず、この dict に列挙された固定パスのみ配信する(無認証 = §2.3)。
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
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
