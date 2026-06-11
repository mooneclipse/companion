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
from urllib.parse import parse_qs, urlsplit

import auth
import dlqueue
import status as os_status
import tickets
import urlguard
import vault
import version
import video
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


def api_version(handler):
    """GET /api/version — デプロイ中の版(git short hash + コミット日)。Bearer 必須。

    値は version.APP_VERSION(起動時に1回確定)を返すだけ。/api/health は無認証で
    情報を絞る既存方針を維持するため、版は authed 側に置く(home は token 設定済みで
    のみ版を取りに行く)。
    """
    return 200, {"version": version.APP_VERSION}


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


def _read_json(handler):
    """body を JSON dict としてパース。(data, None) か (None, (code, obj))。"""
    try:
        data = json.loads(handler._read_body() or b"{}")
    except ValueError:
        return None, (400, {"error": "invalid json"})
    if not isinstance(data, dict):
        return None, (400, {"error": "invalid json"})
    return data, None


def _is_num(val):
    """bool を除く int/float のみ True(JSON の true/false を数値扱いしない)。"""
    return isinstance(val, (int, float)) and not isinstance(val, bool)


def _video_result(resp, ok_body=None):
    """video.py の mpv 応答を HTTP へ写像。接続不能=503 / mpv エラー=502 / 成功=200。

    判定は構造化応答(mpv IPC の error フィールド)のみ。stderr パースはしない(§5.4 契約)。
    """
    if resp is None:
        return 503, {"error": "video unavailable"}  # mpv unit 停止/socket 不在
    if resp.get("error") != "success":
        return 502, {"error": "command failed"}
    return 200, (ok_body or {"status": "ok"})


def api_video_play(handler):
    """POST /api/video/play {url} — urlguard で normalize → loadfile replace。Bearer 必須。

    url は §4.1 allowlist(唯一の外向き境界)を通ったものだけが mpv へ届く。即 200 で返し、
    yt-dlp 解決(40〜70s)は mpv 内で非同期進行(PWA は GET /api/video/state でポーリング)。
    """
    data, err = _read_json(handler)
    if err:
        return err
    url = urlguard.normalize(data.get("url"))
    if url is None:
        return 400, {"error": "url rejected"}
    return _video_result(video.play(url))


def api_video_pause(handler):
    return _video_result(video.pause())


def api_video_resume(handler):
    return _video_result(video.resume())


def api_video_stop(handler):
    return _video_result(video.stop())


def api_video_seek(handler):
    """POST /api/video/seek — シーク(VOD のみ、live gate は PWA 側)。

    {pos}: 絶対シーク(秒, 非負)。{delta}: 相対シーク(±秒, RV-7 ±N スキップ)。
    delta は負も許可。範囲外は mpv が clamp(server は delta を受けるだけ、STATUS RV-7)。
    """
    data, err = _read_json(handler)
    if err:
        return err
    delta = data.get("delta")
    if delta is not None:
        if not _is_num(delta) or abs(delta) > 86400:
            return 400, {"error": "delta must be a number within +/-86400"}
        return _video_result(video.seek(delta, relative=True))
    pos = data.get("pos")
    if not _is_num(pos) or pos < 0:
        return 400, {"error": "pos must be a non-negative number"}
    return _video_result(video.seek(pos))


def api_video_volume(handler):
    """POST /api/video/volume {v} — mpv volume(0〜130)。PulseAudio sink は不可触(契約1)。"""
    data, err = _read_json(handler)
    if err:
        return err
    v = data.get("v")
    if not _is_num(v) or v < 0 or v > 130:
        return 400, {"error": "v must be a number in 0..130"}
    return _video_result(video.set_volume(v))


def api_video_state(handler):
    """GET /api/video/state — phase/title/pos/duration/pause/is_live/seekable を集約。"""
    s = video.state()
    if s is None:
        return 503, {"error": "video unavailable"}
    return 200, s


def api_video_play_local(handler):
    """POST /api/video/play_local {id} — DL 済み項目をローカル path で再生。Bearer 必須。

    HTTP から path は一切受けない (int id のみ)。id → path の解決と downloads/ 境界
    判定は dlqueue.local_path が realpath/commonpath で 1 回確定 (dlqueue-design §3.2)。
    ローカル絶対 path の loadfile は ytdl_hook 非経由 = RV-9 cookie 問題を構造ごと迂回。
    """
    data, err = _read_json(handler)
    if err:
        return err
    tid = data.get("id")
    if isinstance(tid, bool) or not isinstance(tid, int):
        return 400, {"error": "id must be an integer"}
    path = dlqueue.local_path(tid)
    if path is None:
        return 404, {"error": "not found"}
    return _video_result(video.play(path))


def api_dl_add(handler):
    """POST /api/dl {url} — 事前 DL キューへ投入。Bearer 必須。

    url は urlguard.normalize (§4.1 allowlist = F-video play と同一の門) を通った
    ものだけが queue に入る。容量上限 (20 GiB) は 507 に写像 (dlqueue-design §3.3)。
    """
    data, err = _read_json(handler)
    if err:
        return err
    url = urlguard.normalize(data.get("url"))
    if url is None:
        return 400, {"error": "url rejected"}
    try:
        return 200, dlqueue.enqueue(url)
    except dlqueue.QuotaExceeded:
        return 507, {"error": "storage limit reached"}


def api_dl_list(handler):
    """GET /api/dl — 全項目 (created 降順) + 使用量/上限。Bearer 必須。"""
    return 200, dlqueue.list_items()


def api_dl_delete(handler):
    """POST /api/dl/delete {id} — 項目 + 実ファイル削除。Bearer 必須。

    切り分けは state を引いた構造で確定 (文言マッチなし): id 不正=400 /
    該当なし=404 / downloading=409 (v1 はキャンセル機構を持たない)。
    """
    data, err = _read_json(handler)
    if err:
        return err
    tid = data.get("id")
    if isinstance(tid, bool) or not isinstance(tid, int):
        return 400, {"error": "id must be an integer"}
    try:
        return 200, dlqueue.delete(tid)
    except dlqueue.DlBusyError:
        return 409, {"error": "downloading"}
    except dlqueue.DlQueueError:
        return 404, {"error": "no such item"}


def api_todo_list(handler):
    """GET /api/todo — done を除いた一覧 + counts(todo/doing 件数)。Bearer 必須。"""
    return 200, tickets.active()


def api_todo_history(handler):
    """GET /api/todo/history — done のみを updated 降順で返す(閲覧専用)。Bearer 必須。"""
    return 200, tickets.history()


def api_todo_add(handler):
    """POST /api/todo {text} — 起票。UI 経由は常に by=user。Bearer 必須。"""
    data, err = _read_json(handler)
    if err:
        return err
    try:
        ticket = tickets.add(data.get("text"), by="user")
    except tickets.TicketError as e:
        return 400, {"error": str(e)}
    return 200, ticket


def api_todo_status(handler):
    """POST /api/todo/status {id, status} — 状態変更(done で一覧から外れる)。Bearer 必須。

    分岐は state を引く前に確定: id/status を先に検証して 400、その後の
    TicketError は「該当 id なし」=404 と一意に決まる(文言マッチで分岐しない)。
    """
    data, err = _read_json(handler)
    if err:
        return err
    tid = data.get("id")
    if isinstance(tid, bool) or not isinstance(tid, int):
        return 400, {"error": "id must be an integer"}
    if data.get("status") not in tickets.STATUSES:
        return 400, {"error": "invalid status"}
    try:
        return 200, tickets.set_status(tid, data["status"])
    except tickets.TicketError:
        return 404, {"error": "no such ticket"}


class _Binary:
    """ハンドラがバイナリ(画像)を返すときのラッパ。_dispatch がこの型を見て
    JSON でなく生バイトを送る(1回の型判定で送出経路を決める。条件分岐を積まない)。
    icon png の STATIC 配信と同じ _send のバイナリ対応を再利用する。"""
    __slots__ = ("body", "content_type")

    def __init__(self, body, content_type):
        self.body = body
        self.content_type = content_type


def _query(handler):
    """self.path の query string を {key: 最初の値} に。複数値・空は無視(単純取得用)。"""
    qs = urlsplit(handler.path).query
    return {k: v[0] for k, v in parse_qs(qs, keep_blank_values=True).items()}


def api_vault_list(handler):
    """GET /api/vault/list — vault 配下の全 .md をフォルダ別に列挙(read-only)。Bearer 必須。"""
    return 200, vault.list_notes()


def api_vault_get(handler):
    """GET /api/vault/get?path=<相対パス> — 指定 .md の生 markdown。Bearer 必須。

    path 検証は vault._safe_abspath が realpath で1回確定(traversal/範囲外/非.md を弾く)。
    VaultError は「path 不正/範囲外」=403、「not found」のみ 404 と一意に分ける
    (state を持つ FS 側を引いて確定、stderr/文言マッチで分岐しない)。
    """
    path = _query(handler).get("path", "")
    try:
        return 200, vault.get_note(path)
    except vault.VaultError as e:
        return (404, {"error": "not found"}) if str(e) == "not found" else (403, {"error": "forbidden"})


def api_vault_search(handler):
    """GET /api/vault/search?q=<語> — 全 .md 横断の単純部分一致検索。Bearer 必須。"""
    return 200, vault.search(_query(handler).get("q", ""))


def api_vault_image(handler):
    """GET /api/vault/image?path=<相対パス> — ノート埋め込みローカル画像を read 専用配信。Bearer 必須。

    path 検証は vault.get_image が realpath/commonpath で1回確定(traversal/範囲外/非画像を弾く)。
    VaultError は「path 不正/範囲外/非画像」=403、「not found」のみ 404 と一意に分ける
    (api_vault_get と同じ写像。state を持つ FS 側を引いて確定、stderr/文言マッチで分岐しない)。
    """
    path = _query(handler).get("path", "")
    try:
        img = vault.get_image(path)
    except vault.VaultError as e:
        return (404, {"error": "not found"}) if str(e) == "not found" else (403, {"error": "forbidden"})
    return 200, _Binary(img["bytes"], img["content_type"])


# (i) API 明示ルートテーブル。値は (handler, auth_required)。ここに無い (method, path) は 404。
#     self.path を FS に連結しない。auth_required=False は無認証 endpoint(生存確認のみ)、
#     それ以外の /api/* は (iv) Bearer 必須。
ROUTES = {
    ("GET", "/api/health"): (health, False),
    ("GET", "/api/status"): (api_status, True),
    ("GET", "/api/version"): (api_version, True),
    ("POST", "/api/say"): (api_say, True),
    # F-video(全て Bearer 必須)。state のみ GET、他は POST。
    ("POST", "/api/video/play"): (api_video_play, True),
    ("POST", "/api/video/pause"): (api_video_pause, True),
    ("POST", "/api/video/resume"): (api_video_resume, True),
    ("POST", "/api/video/stop"): (api_video_stop, True),
    ("POST", "/api/video/seek"): (api_video_seek, True),
    ("POST", "/api/video/volume"): (api_video_volume, True),
    ("GET", "/api/video/state"): (api_video_state, True),
    ("POST", "/api/video/play_local"): (api_video_play_local, True),
    # F-dl 事前ダウンロードキュー (RV-10)。全て Bearer 必須。
    ("POST", "/api/dl"): (api_dl_add, True),
    ("GET", "/api/dl"): (api_dl_list, True),
    ("POST", "/api/dl/delete"): (api_dl_delete, True),
    # 共用 TODO/inbox(F-todo、v1-α 系列 = bot.py 非依存)。全て Bearer 必須。
    ("GET", "/api/todo"): (api_todo_list, True),
    ("GET", "/api/todo/history"): (api_todo_history, True),
    ("POST", "/api/todo"): (api_todo_add, True),
    ("POST", "/api/todo/status"): (api_todo_status, True),
    # F-vault(出先からの read-only ノート閲覧)。全て GET / Bearer 必須。書き込み endpoint なし。
    ("GET", "/api/vault/list"): (api_vault_list, True),
    ("GET", "/api/vault/get"): (api_vault_get, True),
    ("GET", "/api/vault/search"): (api_vault_search, True),
    ("GET", "/api/vault/image"): (api_vault_image, True),
}

# (ii) 静的ファイル allowlist。{url_path: (web/ 配下の相対パス, content_type)}。
#      URL を FS に連結せず、この dict に列挙された固定パスのみ配信する(無認証 = §2.3)。
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    # F-vault: markdown 描画用に vendored(ビルド工程なし単一ファイル)。marked=parse / purify=sanitize。
    "/marked.min.js": ("marked.min.js", "application/javascript; charset=utf-8"),
    "/purify.min.js": ("purify.min.js", "application/javascript; charset=utf-8"),
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
            # バイナリ(画像)応答は icon png と同じ _send を再利用、それ以外は JSON。
            if isinstance(obj, _Binary):
                self._send(code, obj.body, obj.content_type)
            else:
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
    # 順序契約 (dlqueue-design §1.2): bind 成功 (= 単一インスタンス保証) → recovery →
    # worker 開始。bind 前に recovery すると 2 つ目のプロセス (デバッグ起動) が稼働中の
    # DL を failed 化してから bind 失敗で死ぬ不整合経路が開く。
    dlqueue.recover()
    dlqueue.start_worker()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
