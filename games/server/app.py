#!/usr/bin/env python3
"""companion-games server — 127.0.0.1 バインドの stdlib http.server。

「全部 AI で作るゲーム」umbrella の配信サーバ。第 1 作「みちゆき」を `/` 直下、
以降は prefix 分け(ともしび=/tomoshibi/、なごり=/nagori/、あかり=/akari/。いずれも静的 PWA)。
外向きは tailscale serve(HTTPS, 前段リバースプロキシ)経由のみで、本プロセスは
127.0.0.1 にしか bind しない(0.0.0.0 / tailnet IP 厳禁、companion-remote の流儀を踏襲)。

複数ゲーム配信の設計判断(2026-06-02): 同一サーバ・同一ポートで prefix 分けする方式を採用。
みちゆきの URL(`/`, `/app.js` 等)は完全に不変に保ち(ユーザーがホーム追加した本番互換を壊さない)、
ともしびは `/tomoshibi/` 配下に絶対パスで配る。`/` をゲーム選択ギャラリーにする案は YAGNI
で見送り(2 作なら直リンクで足りる、TODO に残置)。STATIC dict の rel をゲーム名込み
(michiyuki/web/... / tomoshibi/web/...)に拡張し、WEB_DIR を games ルートへ引き上げた。
allowlist 方式・FS への URL 連結禁止・リスティング無し・Content-Type 明示・generic エラーは不変。

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
# web ルートは games リポジトリ直下。各ゲームは <name>/web/ 配下に置く。
WEB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 静的ファイル allowlist。{url_path: (games ルート配下の相対パス, content_type)}。
# URL を FS に連結せず、この dict に列挙された固定パスのみ配信する(無認証)。
# みちゆき(`/` 直下)の URL は不変(本番互換)。ともしびは `/tomoshibi/` prefix。
STATIC = {
    # 第 1 作「みちゆき」(URL 不変、本番互換を壊さない)
    "/": ("michiyuki/web/index.html", "text/html; charset=utf-8"),
    "/index.html": ("michiyuki/web/index.html", "text/html; charset=utf-8"),
    "/app.js": ("michiyuki/web/app.js", "application/javascript; charset=utf-8"),
    "/fragments.js": ("michiyuki/web/fragments.js", "application/javascript; charset=utf-8"),
    "/style.css": ("michiyuki/web/style.css", "text/css; charset=utf-8"),
    "/manifest.json": ("michiyuki/web/manifest.json", "application/manifest+json"),
    "/sw.js": ("michiyuki/web/sw.js", "application/javascript; charset=utf-8"),
    "/icons/icon-192.png": ("michiyuki/web/icons/icon-192.png", "image/png"),
    "/icons/icon-512.png": ("michiyuki/web/icons/icon-512.png", "image/png"),
    # 第 2 作「ともしび」(/tomoshibi/ prefix)
    "/tomoshibi/": ("tomoshibi/web/index.html", "text/html; charset=utf-8"),
    "/tomoshibi/index.html": ("tomoshibi/web/index.html", "text/html; charset=utf-8"),
    "/tomoshibi/app.js": ("tomoshibi/web/app.js", "application/javascript; charset=utf-8"),
    "/tomoshibi/fragments.js": ("tomoshibi/web/fragments.js", "application/javascript; charset=utf-8"),
    "/tomoshibi/style.css": ("tomoshibi/web/style.css", "text/css; charset=utf-8"),
    "/tomoshibi/manifest.json": ("tomoshibi/web/manifest.json", "application/manifest+json"),
    "/tomoshibi/icons/icon-192.png": ("tomoshibi/web/icons/icon-192.png", "image/png"),
    "/tomoshibi/icons/icon-512.png": ("tomoshibi/web/icons/icon-512.png", "image/png"),
    # 第 3 作「なごり」(/nagori/ prefix)
    "/nagori/": ("nagori/web/index.html", "text/html; charset=utf-8"),
    "/nagori/index.html": ("nagori/web/index.html", "text/html; charset=utf-8"),
    "/nagori/app.js": ("nagori/web/app.js", "application/javascript; charset=utf-8"),
    "/nagori/fragments.js": ("nagori/web/fragments.js", "application/javascript; charset=utf-8"),
    "/nagori/style.css": ("nagori/web/style.css", "text/css; charset=utf-8"),
    "/nagori/manifest.json": ("nagori/web/manifest.json", "application/manifest+json"),
    "/nagori/icons/icon-192.png": ("nagori/web/icons/icon-192.png", "image/png"),
    "/nagori/icons/icon-512.png": ("nagori/web/icons/icon-512.png", "image/png"),
    # 第 4 作「あかり」(/akari/ prefix)。デッキ構築ローグライク。
    "/akari/": ("akari/web/index.html", "text/html; charset=utf-8"),
    "/akari/index.html": ("akari/web/index.html", "text/html; charset=utf-8"),
    "/akari/app.js": ("akari/web/app.js", "application/javascript; charset=utf-8"),
    "/akari/cards.js": ("akari/web/cards.js", "application/javascript; charset=utf-8"),
    "/akari/enemies.js": ("akari/web/enemies.js", "application/javascript; charset=utf-8"),
    "/akari/fragments.js": ("akari/web/fragments.js", "application/javascript; charset=utf-8"),
    "/akari/style.css": ("akari/web/style.css", "text/css; charset=utf-8"),
    "/akari/manifest.json": ("akari/web/manifest.json", "application/manifest+json"),
    "/akari/icons/icon-192.png": ("akari/web/icons/icon-192.png", "image/png"),
    "/akari/icons/icon-512.png": ("akari/web/icons/icon-512.png", "image/png"),
    # 第 7 作「マインロード」(/mineroad/ prefix)。Mine Road 忠実リメイクの縦切り(v0.1.0)。
    # 自由掘削サイドビュー探索 × スタミナ→体力の二段ゲージ × 地上全回復の撤退 × 女の子救出。
    "/mineroad/": ("mineroad/web/index.html", "text/html; charset=utf-8"),
    "/mineroad/index.html": ("mineroad/web/index.html", "text/html; charset=utf-8"),
    "/mineroad/app.js": ("mineroad/web/app.js", "application/javascript; charset=utf-8"),
    "/mineroad/tiles.js": ("mineroad/web/tiles.js", "application/javascript; charset=utf-8"),
    "/mineroad/style.css": ("mineroad/web/style.css", "text/css; charset=utf-8"),
    "/mineroad/manifest.json": ("mineroad/web/manifest.json", "application/manifest+json"),
    "/mineroad/icons/icon-192.png": ("mineroad/web/icons/icon-192.png", "image/png"),
    "/mineroad/icons/icon-512.png": ("mineroad/web/icons/icon-512.png", "image/png"),
    # フルリスキン(v0.2.0)アセット: Kenney CC0 タイル/キャラ + 効果音 + BGM(maou_14)。
    # 明示 allowlist なので 1 ファイルずつ登録(ディレクトリ配信はしない設計を維持)。
    "/mineroad/assets/tiles/surface.png": ("mineroad/web/assets/tiles/surface.png", "image/png"),
    "/mineroad/assets/tiles/soil.png": ("mineroad/web/assets/tiles/soil.png", "image/png"),
    "/mineroad/assets/tiles/hard.png": ("mineroad/web/assets/tiles/hard.png", "image/png"),
    "/mineroad/assets/tiles/rock.png": ("mineroad/web/assets/tiles/rock.png", "image/png"),
    "/mineroad/assets/chars/miner.png": ("mineroad/web/assets/chars/miner.png", "image/png"),
    "/mineroad/assets/chars/girl.png": ("mineroad/web/assets/chars/girl.png", "image/png"),
    "/mineroad/assets/sfx/dig1.ogg": ("mineroad/web/assets/sfx/dig1.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/dig2.ogg": ("mineroad/web/assets/sfx/dig2.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/blocked.ogg": ("mineroad/web/assets/sfx/blocked.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/found.ogg": ("mineroad/web/assets/sfx/found.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/heal.ogg": ("mineroad/web/assets/sfx/heal.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/clear.ogg": ("mineroad/web/assets/sfx/clear.ogg", "audio/ogg"),
    "/mineroad/assets/sfx/fail.ogg": ("mineroad/web/assets/sfx/fail.ogg", "audio/ogg"),
    "/mineroad/assets/bgm/theme.ogg": ("mineroad/web/assets/bgm/theme.ogg", "audio/ogg"),
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
