#!/usr/bin/env python3
"""companion-english 配信サーバ (設計 english-design.md §1 / §4)。

127.0.0.1 バインドの stdlib ThreadingHTTPServer。静的 UI (web/)・JSON API (/api/*)・
メディア配信 (/media/*、HTTP Range 対応) を単一プロセスで受け持つ。tailnet への露出は
tailscale serve 前段のみ (photos / remote と同作法、0.0.0.0 直バインドは禁止)。

環境変数 (すべて任意、テスト用の差し替え):
  ENGLISH_PORT — bind ポート (既定 47827)
  ENGLISH_ROOT — web/ media/ を探すプロジェクトルート (既定 ~/companion/english)
  ENGLISH_DB   — SQLite ファイルパス (既定 store.DB_PATH)
"""
import contextlib
import json
import math
import mimetypes
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drill  # noqa: E402  (sys.path 設定後の import)
import store  # noqa: E402

ROOT = os.environ.get("ENGLISH_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_ROOT = os.path.realpath(os.path.join(ROOT, "web"))
MEDIA_ROOT = os.path.realpath(os.path.join(ROOT, "media"))
DB_PATH = os.environ.get("ENGLISH_DB") or None  # None なら store.DB_PATH を使う
HOST = "127.0.0.1"
PORT = int(os.environ.get("ENGLISH_PORT", "47827"))

mimetypes.add_type("application/json", ".json")
mimetypes.add_type("video/mp4", ".mp4")
mimetypes.add_type("text/vtt", ".vtt")
mimetypes.add_type("application/manifest+json", ".webmanifest")

EPISODE_PATH_RE = re.compile(r"^/api/episodes/([^/]+)$")

# 採点の正規化 (§9): 小文字化・句読点無視・アポストロフィ正規化後の一致
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'"})
_PUNCT_RE = re.compile(r"[^a-z0-9']+")


def normalize_answer(s):
    s = (s or "").translate(_APOSTROPHES).lower()
    s = _PUNCT_RE.sub("", s)
    return s


def get_conn():
    conn = store.connect(db_path=DB_PATH)
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def media_url(path_str):
    """clips/episodes の video_path/sub_path (絶対 or ROOT 相対) を /media/... URL に変換する。"""
    if path_str is None:
        return None
    p = path_str if os.path.isabs(path_str) else os.path.join(ROOT, path_str)
    p = os.path.realpath(p)
    if p != MEDIA_ROOT and not p.startswith(MEDIA_ROOT + os.sep):
        return None
    rel = os.path.relpath(p, MEDIA_ROOT)
    return "/media/" + rel.replace(os.sep, "/")


def _ja_sub_url(episode_id):
    """日本語字幕 (ingest.py `_download_ja_subtitle` が best-effort 取得する手動 ja 字幕、
    `media/subs/raw/<episode_id>.ja.vtt`) が実在すれば配信 URL を返す。episodes テーブルに
    ja 字幕パス専用の列は持たず (英語字幕の sub_path のようなクリーニング工程が ja 側には無い
    ため列を増やす理由が薄い)、episode_id = video_id の命名規則からリクエスト時に存在確認する。
    18 話中 5 話は元動画に手動 ja 字幕が無く、ここで None を返してフロント側のトグルを隠す。"""
    p = os.path.join(ROOT, "media", "subs", "raw", episode_id + ".ja.vtt")
    if not os.path.isfile(p):
        return None
    return media_url(os.path.relpath(p, ROOT))


def _safe_join(root_real, url_path):
    rel = url_path.lstrip("/")
    if rel == "":
        rel = "index.html"
    candidate = os.path.realpath(os.path.join(root_real, rel))
    if candidate != root_real and not candidate.startswith(root_real + os.sep):
        return None
    return candidate


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # journal を汚さない (photos 方式に合わせる)
        pass

    # ---- ルーティング --------------------------------------------------

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self._dispatch_api("GET", path)
        if path.startswith("/media/"):
            return self._serve_media(path[len("/media"):])
        return self._serve_static(path)

    def do_POST(self):
        path = urlsplit(self.path).path
        # dispatch 層の最上流で必ず1回だけ Content-Length ぶん読み切る。
        # ハンドラ側の読み忘れに依存する構造にしない — keep-alive 接続では
        # 未読の POST ボディが残ると次リクエストの先頭に混入し、直後の
        # リクエストラインが壊れる (実バグ: /api/drill/extra が読み捨てず
        # 直後の GET が壊れた事例)。
        raw_body = self._drain_body()
        if path.startswith("/api/"):
            return self._dispatch_api("POST", path, raw_body)
        self._send_json(404, {"error": "not found"})

    # ---- 静的配信 --------------------------------------------------

    def _serve_static(self, path):
        target = _safe_join(WEB_ROOT, path)
        if target is None or not os.path.isfile(target):
            self._send_json(404, {"error": "not found"})
            return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        size = os.path.getsize(target)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(target, "rb") as f:
            self._write_stream(f, size)

    # ---- メディア配信 (Range 対応、photos/server/app.py L34-82 相当を流用) --------

    def _serve_media(self, path):
        target = _safe_join(MEDIA_ROOT, path)
        if target is None or not os.path.isfile(target):
            self._send_json(404, {"error": "not found"})
            return
        rng = self.headers.get("Range")
        if rng:
            return self._serve_media_range(target, rng)
        size = os.path.getsize(target)
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        with open(target, "rb") as f:
            self._write_stream(f, size)

    @staticmethod
    def _parse_range(rng, size):
        if not rng.startswith("bytes="):
            return None, None
        spec = rng[6:].split(",")[0].strip()
        s, _, e = spec.partition("-")
        try:
            if s == "":  # suffix: bytes=-N
                n = int(e)
                start, end = max(0, size - n), size - 1
            else:
                start = int(s)
                end = int(e) if e else size - 1
        except ValueError:
            return None, None
        end = min(end, size - 1)
        if start > end or start >= size:
            return None, None
        return start, end

    def _serve_media_range(self, target, rng):
        size = os.path.getsize(target)
        start, end = self._parse_range(rng, size)
        if start is None:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return
        length = end - start + 1
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        with open(target, "rb") as f:
            f.seek(start)
            self._write_stream(f, length)

    def _write_stream(self, f, remaining):
        while remaining > 0:
            chunk = f.read(min(65536, remaining))
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                break
            remaining -= len(chunk)

    # ---- JSON ヘルパ --------------------------------------------------

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _drain_body(self):
        """Content-Length ぶんの POST ボディを読み切る (JSON パースはしない)。
        POST を受けたら経路に関わらず必ず1回呼ばれる (do_POST 参照)。"""
        length = int(self.headers.get("Content-Length", "0") or "0")
        return self.rfile.read(length) if length else b""

    @staticmethod
    def _parse_json(raw_body):
        if not raw_body:
            return {}
        return json.loads(raw_body.decode("utf-8"))

    # ---- API ルーティング --------------------------------------------------

    def _dispatch_api(self, method, path, raw_body=b""):
        try:
            body = self._parse_json(raw_body) if method == "POST" else {}
            if method == "GET" and path == "/api/home":
                return self._api_home()
            if method == "GET" and path == "/api/drill/today":
                return self._api_drill_today()
            if method == "POST" and path == "/api/drill/answer":
                return self._api_drill_answer(body)
            if method == "POST" and path == "/api/drill/flag":
                return self._api_drill_flag(body)
            if method == "POST" and path == "/api/drill/extra":
                return self._api_drill_extra()
            if method == "GET" and path == "/api/library":
                return self._api_library()
            if method == "POST" and path == "/api/watch":
                return self._api_watch(body)
            if method == "POST" and path == "/api/comprehension":
                return self._api_comprehension(body)
            m = EPISODE_PATH_RE.match(path)
            if method == "GET" and m:
                return self._api_episode(m.group(1))
            self._send_json(404, {"error": "not found"})
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid json"})
        except _ApiError as e:
            self._send_json(e.status, {"error": e.message})
        except Exception as e:  # 想定外は 500 + ログ (握りつぶさない)
            sys.stderr.write(f"api error {method} {path}: {e!r}\n")
            self._send_json(500, {"error": "internal error"})

    # ---- API 実装 --------------------------------------------------

    def _clip_public(self, row, done):
        tokens = json.loads(row["tokens"])
        blanks = json.loads(row["blanks"])
        masked = list(tokens)
        for b in blanks:
            if 0 <= b["idx"] < len(masked):
                masked[b["idx"]] = None
        return {
            "id": row["id"],
            "video_url": media_url(row["video_path"]),
            "tokens": masked,
            "blanks": [{"idx": b["idx"], "choices": b["choices"]} for b in blanks],
            "done": done,
            "episode_title": row["episode_title"],
            "episode_duration_s": row["episode_duration_s"],
            "start_s": row["start_s"],
            "end_s": row["end_s"],
        }

    def _api_home(self):
        with contextlib.closing(get_conn()) as conn:
            streak = drill.compute_streak(conn)
            today = drill.compute_today_summary(conn)
            cont = drill.get_continue_episode(conn)
            trend = drill.compute_trend(conn)
            analysis = drill.get_latest_analysis(conn)
        self._send_json(200, {"streak": streak, "today": today, "continue": cont,
                              "trend": trend, "analysis": analysis})

    def _api_drill_today(self):
        with contextlib.closing(get_conn()) as conn:
            daily = drill.get_or_create_daily_set(conn)
            all_ids = daily["clip_ids"] + daily["extra_ids"]
            clips = self._load_clips(conn, all_ids)
        self._send_json(200, {"clips": clips})

    def _load_clips(self, conn, clip_ids):
        if not clip_ids:
            return []
        placeholders = ",".join("?" for _ in clip_ids)
        rows = conn.execute(
            f"""
            SELECT c.id, c.video_path, c.tokens, c.blanks, c.start_s, c.end_s,
                   e.title AS episode_title, e.duration_s AS episode_duration_s
            FROM clips c JOIN episodes e ON e.id = c.episode_id
            WHERE c.id IN ({placeholders})
            """,
            clip_ids,
        ).fetchall()
        by_id = {r["id"]: r for r in rows}
        done_ids = drill.attempted_today_ids(conn)
        return [self._clip_public(by_id[cid], cid in done_ids) for cid in clip_ids if cid in by_id]

    def _api_drill_answer(self, body):
        clip_id = body.get("clip_id")
        answers = body.get("answers") or []
        flags = body.get("flags") or []
        replays = int(body.get("replays") or 0)
        duration_ms = int(body.get("duration_ms") or 0)
        if not clip_id:
            raise _ApiError(400, "clip_id required")

        with contextlib.closing(get_conn()) as conn:
            row = conn.execute(
                "SELECT id, episode_id, text, blanks, translation FROM clips WHERE id = ?", (clip_id,)
            ).fetchone()
            if not row:
                raise _ApiError(404, "clip not found")
            blanks = sorted(json.loads(row["blanks"]), key=lambda b: b["idx"])

            results = []
            for i, b in enumerate(blanks):
                chosen = answers[i] if i < len(answers) else ""
                correct = normalize_answer(chosen) == normalize_answer(b["answer"])
                results.append({"answer": b["answer"], "chosen": chosen, "correct": correct})

            cur = conn.execute(
                "INSERT INTO attempts (clip_id, ts, results, flags, replays, duration_ms) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (clip_id, int(time.time()), json.dumps(results, ensure_ascii=False),
                 json.dumps(flags, ensure_ascii=False), replays, duration_ms),
            )
            conn.commit()
            attempt_id = cur.lastrowid
            # 今回の attempt を含む累計カバレッジ (#72)。commit 後に引くので自分の回答も数に入る
            episode_progress = drill.episode_clip_progress(conn, row["episode_id"])

        self._send_json(200, {
            "attempt_id": attempt_id,
            "results": [r["correct"] for r in results],
            "text": row["text"],
            "blanks": [{"idx": b["idx"], "answer": b["answer"]} for b in blanks],
            "translation": row["translation"],
            "episode_progress": episode_progress,
        })

    def _api_drill_flag(self, body):
        """回答後にフラグだけ後送りする (§4.2 拡張)。該当 attempts 行の flags を上書き
        (INSERT しない、state を持つ側=attempts行を1回引いて確定)。"""
        attempt_id = body.get("attempt_id")
        flags = body.get("flags")
        if attempt_id is None or not isinstance(flags, list):
            raise _ApiError(400, "attempt_id and flags(list) required")

        with contextlib.closing(get_conn()) as conn:
            cur = conn.execute(
                "UPDATE attempts SET flags = ? WHERE id = ?",
                (json.dumps(flags, ensure_ascii=False), attempt_id),
            )
            conn.commit()
            if cur.rowcount == 0:
                raise _ApiError(404, "attempt not found")
        self._send_json(200, {"ok": True})

    def _api_drill_extra(self):
        with contextlib.closing(get_conn()) as conn:
            new_ids = drill.add_extra(conn)
            clips = self._load_clips(conn, new_ids)
        self._send_json(200, {"clips": clips})

    def _api_library(self):
        with contextlib.closing(get_conn()) as conn:
            series_rows = conn.execute(
                "SELECT id, title FROM series ORDER BY sort, id"
            ).fetchall()
            out = []
            for s in series_rows:
                eps = conn.execute(
                    """
                    SELECT e.id, e.title, e.duration_s, e.sort_key, e.sub_kind,
                           w.position_s, w.max_position_s, w.completed_at
                    FROM episodes e
                    LEFT JOIN watch w ON w.episode_id = e.id
                    WHERE e.series_id = ?
                    ORDER BY e.sort_key
                    """,
                    (s["id"],),
                ).fetchall()
                out.append({
                    "id": s["id"],
                    "title": s["title"],
                    "episodes": [
                        {
                            "id": e["id"],
                            "title": e["title"],
                            "duration_s": e["duration_s"],
                            "position_s": e["position_s"] or 0,
                            "completed": bool(e["completed_at"]),
                            "sub_kind": e["sub_kind"],
                        }
                        for e in eps
                    ],
                })
        self._send_json(200, {"series": out})

    def _api_episode(self, episode_id):
        with contextlib.closing(get_conn()) as conn:
            row = conn.execute(
                """
                SELECT e.title, e.duration_s, e.video_path, e.sub_path, w.position_s
                FROM episodes e
                LEFT JOIN watch w ON w.episode_id = e.id
                WHERE e.id = ?
                """,
                (episode_id,),
            ).fetchone()
        if not row:
            raise _ApiError(404, "episode not found")
        self._send_json(200, {
            "video_url": media_url(row["video_path"]),
            "sub_url": media_url(row["sub_path"]) if row["sub_path"] else None,
            "ja_sub_url": _ja_sub_url(episode_id),
            "position_s": row["position_s"] or 0,
            "title": row["title"],
            "duration_s": row["duration_s"],
        })

    def _api_watch(self, body):
        episode_id = body.get("episode_id")
        position_s = body.get("position_s")
        if not episode_id or position_s is None:
            raise _ApiError(400, "episode_id and position_s required")
        # bool は int のサブクラスなので明示的に弾く。json.loads は NaN/Infinity も
        # 通す (Python 拡張) ので isfinite で弾く。負値も不正 (再生位置として無意味)。
        if isinstance(position_s, bool) or not isinstance(position_s, (int, float)):
            raise _ApiError(400, "position_s must be a number")
        position_s = float(position_s)
        if not math.isfinite(position_s) or position_s < 0:
            raise _ApiError(400, "position_s must be a finite non-negative number")

        with contextlib.closing(get_conn()) as conn:
            ep = conn.execute(
                "SELECT duration_s FROM episodes WHERE id = ?", (episode_id,)
            ).fetchone()
            if not ep:
                raise _ApiError(404, "episode not found")

            existing = conn.execute(
                "SELECT max_position_s, completed_at FROM watch WHERE episode_id = ?",
                (episode_id,),
            ).fetchone()
            now = int(time.time())
            prev_max = existing["max_position_s"] if existing else 0.0
            max_position_s = max(prev_max, position_s)
            completed_at = existing["completed_at"] if existing else None
            if completed_at is None and ep["duration_s"] > 0 and max_position_s >= 0.9 * ep["duration_s"]:
                completed_at = now

            conn.execute(
                """
                INSERT INTO watch (episode_id, position_s, max_position_s, completed_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(episode_id) DO UPDATE SET
                    position_s = excluded.position_s,
                    max_position_s = excluded.max_position_s,
                    completed_at = excluded.completed_at,
                    updated_at = excluded.updated_at
                """,
                (episode_id, position_s, max_position_s, completed_at, now),
            )
            conn.commit()

        self._send_json(200, {"ok": True, "max_position_s": max_position_s, "completed": completed_at is not None})

    def _api_comprehension(self, body):
        episode_id = body.get("episode_id")
        level = body.get("level")
        if not episode_id or level not in (1, 2, 3, 4):
            raise _ApiError(400, "episode_id and level(1..4) required")

        with contextlib.closing(get_conn()) as conn:
            ep = conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone()
            if not ep:
                raise _ApiError(404, "episode not found")
            now = int(time.time())
            conn.execute(
                """
                INSERT INTO watch (episode_id, position_s, max_position_s, comprehension, updated_at)
                VALUES (?, 0, 0, ?, ?)
                ON CONFLICT(episode_id) DO UPDATE SET
                    comprehension = excluded.comprehension,
                    updated_at = excluded.updated_at
                """,
                (episode_id, level, now),
            )
            conn.commit()
        self._send_json(200, {"ok": True})


class _ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def main():
    if not os.path.isdir(WEB_ROOT):
        sys.stderr.write(f"web/ が無い: {WEB_ROOT}\n")
        sys.exit(1)
    os.makedirs(MEDIA_ROOT, exist_ok=True)
    with contextlib.closing(get_conn()) as conn:
        store.init_db(conn)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(f"companion-english serving on http://{HOST}:{PORT} (web={WEB_ROOT}, media={MEDIA_ROOT})\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
