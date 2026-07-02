#!/usr/bin/env python3
"""server/app.py の動作確認スクリプト (本番 47827 / 本番 DB には一切触らない)。

一時ディレクトリに web/ media/ と一時 SQLite DB を作り、ffmpeg testsrc のダミー mp4 を
配置してから app.py を空きポートで起動し、全 API を叩いて JSON 形状 / Range 応答 /
path traversal 拒否を確認する。実行: `python3 server/tests/test_api.py`
"""
import contextlib
import http.client as http_client
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVER_DIR)
import store  # noqa: E402

FAILURES = []


def check(label, cond, detail=""):
    if cond:
        print(f"PASS {label}")
    else:
        print(f"FAIL {label} {detail}")
        FAILURES.append(label)


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http(method, base, path, body=None, headers=None):
    url = base + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, dict(resp.getheaders()), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


def keepalive_post_then_get(base, post_path, post_body, get_path):
    """同一 TCP 接続 (keep-alive) 上で POST → 直後に GET を発行する。
    POST ハンドラがボディを読み捨てていないと、未読バイトが次リクエストの
    先頭に混入して GET が壊れる (実バグ再現用、urllib は接続を使い回さないため
    http.client で明示的に同一接続を使う)。
    """
    parts = urlsplit(base)
    conn = http_client.HTTPConnection(parts.hostname, parts.port, timeout=5)
    try:
        raw = json.dumps(post_body).encode("utf-8")
        conn.request("POST", post_path, body=raw, headers={"Content-Type": "application/json"})
        resp1 = conn.getresponse()
        status1 = resp1.status
        resp1.read()

        conn.request("GET", get_path)
        resp2 = conn.getresponse()
        status2 = resp2.status
        resp2.read()
        return status1, status2
    finally:
        conn.close()


def make_dummy_mp4(path, duration=2):
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=64x64:rate=5",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            path,
        ],
        check=True,
    )


def main():
    root = tempfile.mkdtemp(prefix="english-server-test-")
    try:
        run(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    root_empty = tempfile.mkdtemp(prefix="english-server-test-empty-")
    try:
        run_empty_clips(root_empty)
    finally:
        shutil.rmtree(root_empty, ignore_errors=True)

    if FAILURES:
        print(f"\n{len(FAILURES)} 件失敗: {FAILURES}")
        sys.exit(1)
    print("\n全件 PASS")


def run(root):
    web = os.path.join(root, "web")
    media = os.path.join(root, "media")
    os.makedirs(web)
    os.makedirs(os.path.join(media, "episodes"))
    os.makedirs(os.path.join(media, "clips"))
    os.makedirs(os.path.join(media, "subs"))
    with open(os.path.join(web, "index.html"), "w") as f:
        f.write("<!doctype html><title>english test</title>")
    with open(os.path.join(web, "app.js"), "w") as f:
        f.write("// placeholder")

    ep1_video = os.path.join(media, "episodes", "ep1.mp4")
    make_dummy_mp4(ep1_video)
    clip_video = os.path.join(media, "clips", "sample.mp4")
    shutil.copyfile(ep1_video, clip_video)
    for cid in ("c1", "c2", "c3", "c4"):
        shutil.copyfile(ep1_video, os.path.join(media, "clips", f"{cid}.mp4"))
    with open(os.path.join(media, "subs", "ep1.vtt"), "w") as f:
        f.write("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\ntest\n")

    db_path = os.path.join(root, "test.db")
    conn = store.connect(db_path=db_path)
    store.init_db(conn)
    now = int(time.time())
    conn.execute("INSERT INTO series (id, title, sort) VALUES ('tadc','The Amazing Digital Circus',0)")
    conn.execute(
        "INSERT INTO episodes (id, series_id, title, source_url, duration_s, video_path, sub_path, "
        "sub_kind, sort_key, ingested_at) VALUES "
        "('ep1','tadc','Ep1','http://example/ep1',390,?,?,'manual','001',?)",
        ("media/episodes/ep1.mp4", "media/subs/ep1.vtt", now),
    )
    conn.execute(
        "INSERT INTO watch (episode_id, position_s, max_position_s, completed_at, comprehension, updated_at) "
        "VALUES ('ep1', 200, 250, NULL, NULL, ?)",
        (now,),
    )
    clips = [
        ("c1", 10, 16, "I can't believe it's you",
         ["I", "can't", "believe", "it's", "you"],
         [{"idx": 1, "answer": "can't", "choices": ["can't", "can", "cant", "kinda"]}]),
        ("c2", 30, 38, "We're gonna be late for the show",
         ["We're", "gonna", "be", "late", "for", "the", "show"],
         [{"idx": 1, "answer": "gonna", "choices": ["gonna", "going", "gotta", "wanna"]}]),
        ("c3", 50, 58, "I don't know what you mean",
         ["I", "don't", "know", "what", "you", "mean"],
         [{"idx": 1, "answer": "don't", "choices": ["don't", "dont", "doesn't", "didn't"]}]),
        ("c4", 300, 306, "This part hasn't been watched yet",
         ["This", "part", "hasn't", "been", "watched", "yet"],
         [{"idx": 2, "answer": "hasn't", "choices": ["hasn't", "hasnt", "wasn't", "isn't"]}]),
    ]
    for cid, start_s, end_s, text, tokens, blanks in clips:
        conn.execute(
            "INSERT INTO clips (id, episode_id, start_s, end_s, video_path, text, tokens, blanks, "
            "wpm, feature_tags) VALUES (?, 'ep1', ?, ?, ?, ?, ?, ?, 140, '[\"weak_form\"]')",
            (cid, start_s, end_s, f"media/clips/{cid}.mp4", text, json.dumps(tokens), json.dumps(blanks)),
        )
    conn.commit()
    conn.close()

    with _running_server(root, db_path) as base:
        _run_checks(base, root, db_path)


def run_empty_clips(root):
    """clips が 0 本の状態で /api/drill/today を叩き、空セットが daily_sets に
    確定保存されない (レビュー指摘 #1) ことを確認する専用 fixture。
    """
    web = os.path.join(root, "web")
    media = os.path.join(root, "media")
    os.makedirs(web)
    os.makedirs(media)
    with open(os.path.join(web, "index.html"), "w") as f:
        f.write("<!doctype html><title>english test (empty)</title>")

    db_path = os.path.join(root, "test.db")
    conn = store.connect(db_path=db_path)
    store.init_db(conn)  # series/episodes/watch/clips とも 0 行のまま
    conn.commit()
    conn.close()

    with _running_server(root, db_path) as base:
        status, _, body = http("GET", base, "/api/drill/today")
        today = json.loads(body)
        check("clips 0本: drill/today 200", status == 200, status)
        check("clips 0本: clips は空配列", today["clips"] == [], today)

        conn = sqlite3.connect(db_path)
        count = conn.execute("SELECT COUNT(*) FROM daily_sets").fetchone()[0]
        conn.close()
        check("clips 0本: daily_sets に行が残らない (再生成の余地を残す)", count == 0, count)


@contextlib.contextmanager
def _running_server(root, db_path):
    port = free_port()
    env = dict(os.environ)
    env["ENGLISH_PORT"] = str(port)
    env["ENGLISH_ROOT"] = root
    env["ENGLISH_DB"] = db_path
    log_path = os.path.join(root, "server.log")
    log_f = open(log_path, "w")
    proc = subprocess.Popen(
        [sys.executable, os.path.join(SERVER_DIR, "app.py")],
        cwd=SERVER_DIR, env=env, stdout=log_f, stderr=log_f,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_for_server(base)
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        log_f.close()
        if FAILURES:
            print("---- server.log ----")
            print(open(log_path).read())


def _wait_for_server(base, attempts=30, interval=0.1):
    for _ in range(attempts):
        try:
            urllib.request.urlopen(base + "/", timeout=1)
            return
        except Exception:
            time.sleep(interval)
    raise RuntimeError("server did not come up")


def _run_checks(base, root, db_path):
    # 静的配信
    status, headers, body = http("GET", base, "/")
    check("static / -> 200", status == 200, status)
    check("static no-cache header", headers.get("Cache-Control") == "no-cache", headers.get("Cache-Control"))

    status, _, _ = http("GET", base, "/../../../../etc/passwd")
    check("static path traversal -> 404", status == 404, status)

    # /api/home (daily_sets 生成の副作用込み)
    status, _, body = http("GET", base, "/api/home")
    home = json.loads(body)
    check("home 200", status == 200, status)
    check("home streak==0 (未回答)", home["streak"] == 0, home["streak"])
    check("home today.total==3", home["today"]["total"] == 3, home["today"])
    check("home today.done==0", home["today"]["done"] == 0, home["today"])
    check("home continue.episode_id==ep1", home["continue"] and home["continue"]["episode_id"] == "ep1", home["continue"])
    check("home trend has 14 entries", len(home["trend"]) == 14, len(home["trend"]))

    # /api/drill/today: daily_sets が固定されていること (DB 直読みと突合)
    status, _, body = http("GET", base, "/api/drill/today")
    today = json.loads(body)
    check("drill/today 200", status == 200, status)
    ids = [c["id"] for c in today["clips"]]
    check("drill/today 3 clips (c4 は視聴範囲外で除外)", set(ids) == {"c1", "c2", "c3"}, ids)

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT clip_ids FROM daily_sets").fetchone()
    conn.close()
    check("daily_sets が drill/today と一致 (日内固定)", set(json.loads(row[0])) == set(ids), row)

    c1 = next(c for c in today["clips"] if c["id"] == "c1")
    check("tokens の blank 位置は null (正解漏れなし)", c1["tokens"][1] is None, c1["tokens"])
    check("blanks に answer を含まない", "answer" not in c1["blanks"][0], c1["blanks"])
    check("blanks に choices を含む", c1["blanks"][0]["choices"] == ["can't", "can", "cant", "kinda"], c1["blanks"])
    check("video_url は /media/ 配下", c1["video_url"] == "/media/clips/c1.mp4", c1["video_url"])
    check("done は未回答なので False", c1["done"] is False, c1["done"])
    check("episode_title が入る", c1["episode_title"] == "Ep1", c1["episode_title"])
    check("start_s/end_s が入る", (c1["start_s"], c1["end_s"]) == (10, 16), (c1["start_s"], c1["end_s"]))

    # /api/drill/answer: c1 正解、c2 誤答 (誤答肢を記録)
    status, _, body = http("POST", base, "/api/drill/answer", {
        "clip_id": "c1", "answers": ["can't"], "flags": [], "replays": 0, "duration_ms": 1200,
    })
    ans1 = json.loads(body)
    check("answer c1 200", status == 200, status)
    check("answer c1 正解", ans1["results"] == [True], ans1)
    check("answer に attempt_id が入る", isinstance(ans1.get("attempt_id"), int), ans1)

    status, _, body = http("POST", base, "/api/drill/answer", {
        "clip_id": "c2", "answers": ["gotta"], "flags": ["unheard"], "replays": 2, "duration_ms": 3000,
    })
    ans2 = json.loads(body)
    check("answer c2 誤答", ans2["results"] == [False], ans2)

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT results, flags FROM attempts WHERE clip_id='c2'").fetchone()
    conn.close()
    results_json = json.loads(row[0])
    check("誤答時に選んだ誤答肢を記録", results_json[0]["chosen"] == "gotta" and results_json[0]["answer"] == "gonna", results_json)
    check("flags 保存", json.loads(row[1]) == ["unheard"], row[1])

    status, _, body = http("POST", base, "/api/drill/answer", {
        "clip_id": "c3", "answers": ["don't"], "flags": [], "replays": 0, "duration_ms": 900,
    })
    check("answer c3 200", status == 200, status)

    # /api/drill/flag: フラグの後送り (既存 attempt 行を UPDATE、INSERT しない)
    status, _, body = http("POST", base, "/api/drill/flag", {"attempt_id": ans1["attempt_id"], "flags": ["sub_suspect"]})
    check("drill/flag 200", status == 200, status)
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT flags FROM attempts WHERE id = ?", (ans1["attempt_id"],)).fetchone()
    count = conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
    conn.close()
    check("flag 後送りで flags が上書きされる", json.loads(row[0]) == ["sub_suspect"], row)
    check("flag 後送りで新規行が増えない", count == 3, count)

    status, _, _ = http("POST", base, "/api/drill/flag", {"attempt_id": 999999, "flags": ["unheard"]})
    check("drill/flag 未知 attempt_id -> 404", status == 404, status)

    # 回答済みクリップは drill/today で done==True になる
    status, _, body = http("GET", base, "/api/drill/today")
    today2 = json.loads(body)
    done_map = {c["id"]: c["done"] for c in today2["clips"]}
    check("回答済みクリップは done==True", done_map == {"c1": True, "c2": True, "c3": True}, done_map)

    # /api/home: 3/3 done, streak==1 (今日達成)
    status, _, body = http("GET", base, "/api/home")
    home2 = json.loads(body)
    check("home today.done==3 after answering all", home2["today"]["done"] == 3, home2["today"])
    check("home today.completed==True", home2["today"]["completed"] is True, home2["today"])
    check("home streak==1 (今日分すべて回答)", home2["streak"] == 1, home2["streak"])

    # /api/drill/extra: 除外後 c4 のみ残る (pool フォールバック確認)
    status, _, body = http("POST", base, "/api/drill/extra", None)
    extra = json.loads(body)
    check("drill/extra 200", status == 200, status)
    extra_ids = [c["id"] for c in extra["clips"]]
    check("extra は c4 のみ (視聴範囲外だが全クリップにフォールバック)", extra_ids == ["c4"], extra_ids)

    # keep-alive 再現: POST /api/drill/extra がボディを読み捨てないと直後の GET が壊れる実バグ
    status1, status2 = keepalive_post_then_get(base, "/api/drill/extra", {"unused": "body"}, "/api/home")
    check("keep-alive: POST extra (ボディ付き) 200", status1 == 200, status1)
    check("keep-alive: 直後の GET が 501 に壊れない", status2 == 200, status2)

    # 他の POST ハンドラも同じ穴が無いか (watch/comprehension/flag/answer)
    status1, status2 = keepalive_post_then_get(
        base, "/api/watch", {"episode_id": "ep1", "position_s": 200}, "/api/home"
    )
    check("keep-alive: POST watch 直後の GET 200", (status1, status2) == (200, 200), (status1, status2))

    status1, status2 = keepalive_post_then_get(
        base, "/api/comprehension", {"episode_id": "ep1", "level": 2}, "/api/home"
    )
    check("keep-alive: POST comprehension 直後の GET 200", (status1, status2) == (200, 200), (status1, status2))

    status1, status2 = keepalive_post_then_get(
        base, "/api/drill/answer",
        {"clip_id": "c1", "answers": ["can't"], "flags": [], "replays": 0, "duration_ms": 500},
        "/api/home",
    )
    check("keep-alive: POST answer 直後の GET 200", (status1, status2) == (200, 200), (status1, status2))

    status1, status2 = keepalive_post_then_get(
        base, "/api/drill/flag", {"attempt_id": ans1["attempt_id"], "flags": ["sub_suspect"]}, "/api/home"
    )
    check("keep-alive: POST flag 直後の GET 200", (status1, status2) == (200, 200), (status1, status2))

    # /api/library
    status, _, body = http("GET", base, "/api/library")
    lib = json.loads(body)
    check("library 200", status == 200, status)
    check("library に tadc シリーズ", lib["series"][0]["id"] == "tadc", lib)
    check("library episode position_s==200", lib["series"][0]["episodes"][0]["position_s"] == 200, lib)
    check("library episode completed==False", lib["series"][0]["episodes"][0]["completed"] is False, lib)
    check("library episode sub_kind==manual", lib["series"][0]["episodes"][0]["sub_kind"] == "manual", lib)

    # /api/episodes/<id>
    status, _, body = http("GET", base, "/api/episodes/ep1")
    ep = json.loads(body)
    check("episode 200", status == 200, status)
    check("episode video_url", ep["video_url"] == "/media/episodes/ep1.mp4", ep)
    check("episode sub_url", ep["sub_url"] == "/media/subs/ep1.vtt", ep)

    status, _, _ = http("GET", base, "/api/episodes/nope")
    check("episode 404 for unknown id", status == 404, status)

    # /api/watch: position_s の型・値検証 (json.loads は NaN/Infinity も通すので要注意)
    for bad_value, label in [
        ("not-a-number", "文字列"),
        (True, "bool (int のサブクラス)"),
        (float("nan"), "NaN"),
        (float("inf"), "Infinity"),
        (-5, "負値"),
    ]:
        status, _, _ = http("POST", base, "/api/watch", {"episode_id": "ep1", "position_s": bad_value})
        check(f"watch position_s 不正値({label}) -> 400", status == 400, (bad_value, status))

    # /api/watch: 巻き戻しで max_position_s は減らない、90% 到達で completed
    status, _, body = http("POST", base, "/api/watch", {"episode_id": "ep1", "position_s": 100})
    w1 = json.loads(body)
    check("watch 巻き戻し後も max_position_s 単調 (250 のまま)", w1["max_position_s"] == 250, w1)
    check("watch まだ未完了", w1["completed"] is False, w1)

    status, _, body = http("POST", base, "/api/watch", {"episode_id": "ep1", "position_s": 360})
    w2 = json.loads(body)
    check("watch 90%到達で completed", w2["completed"] is True, w2)
    check("watch max_position_s==360", w2["max_position_s"] == 360, w2)

    status, _, body = http("GET", base, "/api/home")
    home3 = json.loads(body)
    check("home continue==null (全エピソード完了)", home3["continue"] is None, home3["continue"])

    # /api/comprehension
    status, _, body = http("POST", base, "/api/comprehension", {"episode_id": "ep1", "level": 3})
    check("comprehension 200", status == 200, status)
    status, _, body = http("POST", base, "/api/comprehension", {"episode_id": "ep1", "level": 9})
    check("comprehension level 範囲外 -> 400", status == 400, status)

    # /media Range 対応
    size = os.path.getsize(os.path.join(root, "media", "clips", "c1.mp4"))
    status, headers, body = http("GET", base, "/media/clips/c1.mp4", headers={"Range": "bytes=0-99"})
    check("media range 206", status == 206, status)
    check("media range Content-Length==100", headers.get("Content-Length") == "100", headers.get("Content-Length"))
    check("media range body len==100", len(body) == 100, len(body))
    check("media range Content-Range", headers.get("Content-Range") == f"bytes 0-99/{size}", headers.get("Content-Range"))

    status, headers, _ = http("GET", base, "/media/clips/c1.mp4", headers={"Range": f"bytes={size + 1000}-{size + 2000}"})
    check("media range 不正 -> 416", status == 416, status)

    status, headers, body = http("GET", base, "/media/clips/c1.mp4")
    check("media 全体 200", status == 200, status)
    check("media 全体 Content-Length==size", headers.get("Content-Length") == str(size), (headers.get("Content-Length"), size))
    check("media cache-control public/max-age", headers.get("Cache-Control") == "public, max-age=604800", headers.get("Cache-Control"))

    status, _, _ = http("GET", base, "/media/../../../../etc/passwd")
    check("media path traversal -> 404", status == 404, status)

    status, _, _ = http("GET", base, "/media/clips/does-not-exist.mp4")
    check("media 未知ファイル -> 404", status == 404, status)


if __name__ == "__main__":
    main()
