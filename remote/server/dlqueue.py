#!/usr/bin/env python3
"""companion-remote RV-10 事前ダウンロードキュー (F-dl) — データ層 + DL worker。

外出先から URL をキュー投入 → 自宅機で yt-dlp が 720p 上限でローカル保存 →
PWA の DL 済みリストから loadfile でローカル即再生 (yt-dlp 解決待ちと再生中のネットワーク依存が消える)。
設計: ~/companion/workspace/redesign/dlqueue-design.md v1.1。

設計契約 (破ると壊れる一線):
- state は .state/dlqueue.json + flock(dlqueue.lock) の read-modify-write で 1 回確定
  (tickets.py 同型)。**lock fd は取得のたびに毎回 open する** — fd をキャッシュすると
  同一 open file description 上の flock は再入可能になり、worker thread と HTTP handler
  thread の排他が無音で消える。
- _save は atomic write (os.replace)。tickets.py の O_TRUNC 直書きからの意図的逸脱:
  JSON 破損 → _load 空復元で downloads/ の実体 (重い・再取得数十分) が UI から
  削除不能になる事故を、破損自体を塞いで防ぐ (§1.3)。
- 成否判定は rc==0 + FS glob の 1 回確定。リトライ・stderr 文言分岐をしない。
  error フィールドは表面化専用 (この値で分岐しない)。
- 失敗 (rc≠0 / timeout / glob 不一致 / 内部例外 / 中断) の確定時は経路を問わず
  dl-<id>.* を削除する (UI から見えないゴミを容量実測に算入させない、§1.2)。
- DL 完了/失敗の通知は state 確定 (flock 下) → flock 解放 → timeout 付き送信の順。
  flock 保持のまま socket 送信すると bot 側無応答で全 endpoint がハングする (§5)。
- 自動リトライ / queued への自動復帰 / 自動掃除 (evict) はしない。回復は user 介入。
"""
import fcntl
import glob
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time

STATE_DIR = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".state"))
QUEUE_PATH = os.path.join(STATE_DIR, "dlqueue.json")
LOCK_PATH = os.path.join(STATE_DIR, "dlqueue.lock")
# downloads_dir は realpath で 1 回確定 (vault.py VAULT_ROOT と同じ前例。非正規形のまま
# commonpath すると字句比較で全件 reject = fail-closed 側だが機能不全になる、§3.1)。
DOWNLOADS_DIR = os.path.realpath(
    os.environ.get("REMOTE_DL_DIR", os.path.join(STATE_DIR, "downloads")))

# yt-dlp は mpv unit と同一実体・同一 known-good 版を固定 (churn 台帳は STATUS.md、§2.1)。
YTDLP = os.environ.get("REMOTE_YTDLP", "/home/miho/bin/yt-dlp")
# mpv unit の --ytdl-format と同一文字列 (720p 上限の根拠も同一 = AVX1+HDD 自己 DoS 回避)。
FORMAT = "bestvideo[height<=?720]+bestaudio/best[height<=?720]/best"
DL_TIMEOUT = 3600  # 1 件の backstop。超過は failed 1 回確定 (リトライなし)。
LIMIT_BYTES = 20 * 1024 ** 3  # 容量上限 20 GiB (1 回確定、刻まない。§3.3)
TITLE_MAX = 200  # title は外部サイト制御の文字列 — 制御文字 strip + cap (§1.3)
ERROR_TAIL = 200  # stderr 末尾の表面化幅 (分岐には使わない)

NOTIFY_SOCKET = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"), "companion-bot.sock")
NOTIFY_TIMEOUT = 5.0

STATUSES = ("queued", "downloading", "done", "failed")

_event = threading.Event()  # enqueue → worker 起床 (ポーリングしない、§1.1)


class QuotaExceeded(Exception):
    """容量上限到達。API は 507 に写像する。"""


class DlQueueError(ValueError):
    """該当 id なし等。API は 404 に写像する。"""


class DlBusyError(ValueError):
    """downloading 項目への削除。API は 409 に写像する (v1 はキャンセル機構なし)。"""


def _now():
    return int(time.time())


def _locked():
    """dlqueue.lock の排他ロック (tickets._locked 同型、fd は毎回 open = 契約)。"""
    return _LockCtx()


class _LockCtx:
    def __enter__(self):
        os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
        self._fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        fcntl.flock(self._fd, fcntl.LOCK_UN)
        os.close(self._fd)
        return False


def _load():
    """dlqueue.json を {"next_id", "items"} 正規形で返す (壊れていれば復元)。"""
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        data = {}
    items = data.get("items")
    if not isinstance(items, list):
        items = []
    next_id = data.get("next_id")
    if isinstance(next_id, bool) or not isinstance(next_id, int) or next_id < 1:
        max_id = max((t.get("id", 0) for t in items if isinstance(t, dict)), default=0)
        next_id = max_id + 1
    return {"next_id": next_id, "items": items}


def _save(data):
    """atomic write (tmp → os.replace)。途中 kill での JSON 破損を構造で塞ぐ (§1.3)。"""
    tmp = QUEUE_PATH + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, QUEUE_PATH)


def _find(data, tid):
    for t in data["items"]:
        if isinstance(t, dict) and t.get("id") == tid:
            return t
    return None


def _item_files(tid):
    """該当 id の実ファイル群 (dl-<id>.* = 完成品 / .part / 中間 .f137.mp4 等)。"""
    return glob.glob(os.path.join(DOWNLOADS_DIR, "dl-%d.*" % tid))


def _cleanup_files(tid):
    """failed 確定・削除時のファイル掃除 (経路を問わず一般規則、§1.2)。"""
    for p in _item_files(tid):
        try:
            os.remove(p)
        except OSError:
            pass


def usage_bytes():
    """downloads/ の実ファイル合計 (実測のみ。推定予約は持ち込まない、§3.3)。"""
    total = 0
    try:
        with os.scandir(DOWNLOADS_DIR) as it:
            for e in it:
                if e.is_file(follow_symlinks=False):
                    total += e.stat(follow_symlinks=False).st_size
    except OSError:
        pass
    return total


def sanitize_title(s):
    """制御文字 strip + 200 字 cap。空は None (表示は URL で代替)。"""
    if not isinstance(s, str):
        return None
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s).strip()
    return s[:TITLE_MAX] or None


def enqueue(url):
    """normalize 済み URL を起票して項目を返す (検証は app.py の urlguard が門、§2.3)。

    dedup: 同一 URL の queued/downloading が既にあればそれを返す (再試行二度押しの
    二重 DL・二重通知を防ぐ)。done/failed との重複は許容 (意図的な再 DL があり得る)。
    容量上限はここ (投入時) と worker 着手直前の二重ガード (§3.3)。
    """
    with _locked():
        if usage_bytes() >= LIMIT_BYTES:
            raise QuotaExceeded("storage limit reached")
        data = _load()
        for t in data["items"]:
            if (isinstance(t, dict) and t.get("url") == url
                    and t.get("status") in ("queued", "downloading")):
                return t
        tid = data["next_id"]
        now = _now()
        item = {"id": tid, "url": url, "title": None, "status": "queued",
                "file": None, "size": None, "error": None,
                "created": now, "updated": now}
        data["items"].append(item)
        data["next_id"] = tid + 1
        _save(data)
    _event.set()
    return item


def list_items():
    """全項目 (id 降順 = 新しい投入が先頭。created は同一秒で同値になり安定しない) + 使用量。"""
    with _locked():
        data = _load()
        usage = usage_bytes()
    items = [t for t in data["items"] if isinstance(t, dict)]
    items.sort(key=lambda t: t.get("id", 0), reverse=True)
    return {"items": items, "usage_bytes": usage, "limit_bytes": LIMIT_BYTES}


def delete(tid):
    """項目 + 実ファイルを削除。downloading は 409 (worker と競合させない、§3.3)。"""
    with _locked():
        data = _load()
        item = _find(data, tid)
        if item is None:
            raise DlQueueError("no such item")
        if item.get("status") == "downloading":
            raise DlBusyError("downloading")
        data["items"].remove(item)
        _save(data)
        _cleanup_files(tid)
    return item


def local_path(tid):
    """play_local 用: done 項目の実ファイル絶対 path を返す。該当なし/未完了/境界外は None。

    HTTP からは int id のみが届く (path を一切受けない)。file は basename のみ保存だが、
    state 改竄・symlink 差し替えに備え realpath + commonpath で downloads/ 境界を
    1 回確定する (vault._resolve_in_vault と同じ判定、§3.2)。
    """
    with _locked():
        data = _load()
        item = _find(data, tid)
    if item is None or item.get("status") != "done":
        return None
    name = item.get("file")
    if not isinstance(name, str) or not name or os.sep in name or name.startswith("."):
        return None
    candidate = os.path.realpath(os.path.join(DOWNLOADS_DIR, name))
    try:
        if os.path.commonpath([DOWNLOADS_DIR, candidate]) != DOWNLOADS_DIR:
            return None
    except ValueError:
        return None
    if not os.path.isfile(candidate):
        return None
    return candidate


# --- worker (単一 DL lane、§1.1) ---

def recover():
    """起動時 1 回: downloading 残骸を failed に確定 + ファイル掃除 (§1.2)。

    呼び出し順は app.py 側で「bind 成功 → recover() → start_worker()」に固定する。
    bind 前に走らせると 2 つ目のプロセス (デバッグ起動) が稼働中の DL を failed 化
    してから bind 失敗で死ぬ不整合経路が開く。
    """
    with _locked():
        data = _load()
        changed = False
        for t in data["items"]:
            if isinstance(t, dict) and t.get("status") == "downloading":
                t["status"] = "failed"
                t["error"] = "interrupted by restart"
                t["updated"] = _now()
                _cleanup_files(t.get("id", 0))
                changed = True
        if changed:
            _save(data)


def start_worker():
    """DL worker thread (daemon, 単一) を開始。起動直後に 1 回起床して残置 queued を drain。"""
    t = threading.Thread(target=_worker_loop, name="dl-worker", daemon=True)
    t.start()
    _event.set()
    return t


def _worker_loop():
    """queued を 1 件ずつ処理。項目単位の未捕捉例外は failed 確定でループ継続 (§1.1)。

    単一 daemon thread は systemd の監視外 (スレッドだけ死ぬと enqueue 200 +
    永久 queued の無音破綻) のため、ループを死なせないことが生存の唯一の砦。
    """
    while True:
        _event.wait()
        _event.clear()
        while True:
            # claim/finish の state 層異常 (disk full 等) でも thread を死なせない。
            # worker 死は systemd に見えず「enqueue 200 + 永久 queued」の無音破綻になる。
            try:
                item = _claim_next()
            except Exception:
                break  # hot spin せず次の enqueue 起床まで待つ
            if item is None:
                break
            try:
                _process(item)
            except Exception:
                try:
                    _finish(item["id"], ok=False, error="internal error")
                except Exception:
                    pass


def _claim_next():
    """最古の queued を downloading に遷移して返す (flock 下で 1 回確定)。無ければ None。"""
    with _locked():
        data = _load()
        for t in data["items"]:
            if isinstance(t, dict) and t.get("status") == "queued":
                t["status"] = "downloading"
                t["updated"] = _now()
                _save(data)
                return dict(t)
    return None


def _env():
    """yt-dlp 用の固定最小 env (voice/scripts/say.sh と同じ env 隔離方針)。PROXY 系・user shell env 非継承 (§2.1)。"""
    env = {k: os.environ[k] for k in ("HOME", "PATH") if k in os.environ}
    env.setdefault("PATH", "/home/miho/bin:/usr/bin:/bin")
    return env


def _process(item):
    """1 件の DL を実行し done/failed を 1 回確定する。"""
    tid = item["id"]
    # 着手直前の容量ガード (enqueue 時だけでは N 件連続投入で際限なく積み上がる、§3.3)。
    # flock 外の実測で足りる: DL を実行するのは単一 worker の自分だけで、他スレッドは
    # downloads/ を増やさない (delete は減らす方向のみ)。
    if usage_bytes() >= LIMIT_BYTES:
        _finish(tid, ok=False, error="over capacity")
        return
    os.makedirs(DOWNLOADS_DIR, mode=0o700, exist_ok=True)
    argv = [
        YTDLP, "--ignore-config", "--no-playlist", "--no-progress",
        # -4 (IPv4 強制): この網は IPv6 が 100% loss (RV-8 実測) なのに CDN
        # (delivery.domand.nicovideo.jp 等) が AAAA を返すため、fragment ごとの
        # IPv6 connect timeout (~40s) → IPv4 fallback で実測 2.5KB/s に落ちていた。
        # -4 で 3.35MiB/s (約 90 倍、2026-06-12 実測)。新規オプション 1 つ = 1 周目。
        "-4",
        "-f", FORMAT,
        "-o", os.path.join(DOWNLOADS_DIR, "dl-%d.%%(ext)s" % tid),
        # stdout は title 取得専用 (filepath は FS glob で確定する、§2.2)。
        "--print", "after_move:title", "--no-simulate",
        item["url"],
    ]
    # start_new_session でプロセスグループを分離し、timeout 時は killpg で merge 中の
    # ffmpeg (yt-dlp の子) ごと止める (subprocess の timeout は直接の子しか殺さない、§2.1)。
    try:
        p = subprocess.Popen(argv, env=_env(), stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True,
                             start_new_session=True)
    except OSError:
        _finish(tid, ok=False, error="yt-dlp not executable")
        return
    try:
        out, err = p.communicate(timeout=DL_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        p.communicate()
        _finish(tid, ok=False, error="timeout (%ds)" % DL_TIMEOUT)
        return
    if p.returncode != 0:
        tail = (err or "").strip()[-ERROR_TAIL:]
        _finish(tid, ok=False, error=tail or "yt-dlp failed (rc=%d)" % p.returncode)
        return
    # 成否の真実は rc + FS。glob で完成品を 1 回確定 (.part は未完成として除外)。
    files = [f for f in _item_files(tid) if not f.endswith(".part")]
    if len(files) != 1:
        _finish(tid, ok=False, error="output file not found" if not files
                else "multiple output files")
        return
    path = files[0]
    title = sanitize_title((out or "").strip().splitlines()[0] if (out or "").strip() else None)
    try:
        size = os.path.getsize(path)
    except OSError:
        size = None
    _finish(tid, ok=True, file=os.path.basename(path), size=size, title=title)


def _finish(tid, ok, error=None, file=None, size=None, title=None):
    """done/failed を flock 下で確定 → flock 解放後に通知 (順序契約、§5)。"""
    with _locked():
        data = _load()
        item = _find(data, tid)
        if item is None:  # 確定前に delete された等。確定先がないだけで異常ではない。
            if not ok:
                _cleanup_files(tid)
            return
        item["status"] = "done" if ok else "failed"
        item["error"] = None if ok else error
        item["file"] = file
        item["size"] = size
        if title is not None:
            item["title"] = title
        item["updated"] = _now()
        _save(data)
        if not ok:
            _cleanup_files(tid)
        url = item.get("url", "")
        kept_title = item.get("title")
    label = kept_title or url[:80]
    _notify(("[dl] 完了: %s" if ok else "[dl] 失敗: %s") % label)


def _notify(msg):
    """companion-bot.sock へ平文 1 ショット (say.sh notify_socket 同型、bot.py 無改変)。

    ベストエフォート: socket 不在/timeout/失敗はすべて握りつぶす (リトライなし)。
    状態の真実は PWA の DL リスト側にある (§5)。
    """
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.settimeout(NOTIFY_TIMEOUT)
        s.connect(NOTIFY_SOCKET)
        s.sendall(msg.encode("utf-8"))
    except OSError:
        pass
    finally:
        s.close()
