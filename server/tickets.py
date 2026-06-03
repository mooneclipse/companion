#!/usr/bin/env python3
"""companion-remote 共用 TODO/inbox — チケットのデータ層 + CLI。

user(PWA) と AI(claude セッション) が共用する inbox。両者が同じ
.state/tickets.json を読み書きするため、.state/tickets.lock の
flock(LOCK_EX) で read-modify-write 全体を囲み、採番(next_id)を 1 回
引いて確定する(条件分岐を積まず state 側で 1 回決める。~/companion/
CLAUDE.md 設計上限ルール準拠)。形式・運用フローは docs/STATUS.md 参照。

  tickets.json = {"next_id": int, "tickets": [
    {"id", "text", "by": user|ai, "status": todo|doing|done,
     "created": epoch, "updated": epoch}, ...]}

id は連番(再利用しない)。done は active() の一覧から外れるが履歴として残る。

CLI(claude セッション用):
  python3 tickets.py add "text" [--by ai|user]   # 起票(既定 --by user)
  python3 tickets.py list [--all]                # 一覧(既定 done 除外、--all で全件)
  python3 tickets.py show <id>                    # 1件の詳細
  python3 tickets.py start <id>                   # 着手中(doing)に
  python3 tickets.py done <id>                    # 完了(done、一覧から外れる)
"""
import contextlib
import fcntl
import json
import os
import sys
import time

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".state")
TICKETS_PATH = os.path.join(STATE_DIR, "tickets.json")
LOCK_PATH = os.path.join(STATE_DIR, "tickets.lock")

STATUSES = ("todo", "doing", "done")
BYS = ("user", "ai")
MAX_TEXT = 2000
_ACTIVE = ("todo", "doing")


class TicketError(ValueError):
    """入力不正 / 該当 id なし。CLI は exit 2、API は 400/404 に写像する。"""


def _now():
    return int(time.time())


@contextlib.contextmanager
def _locked():
    """tickets.lock を排他ロック(プロセス間/スレッド間)。RMW 全体を囲む。

    tokens.json と違い tickets.json は server(常駐) と claude CLI(別プロセス)が
    競合して書くため、専用ロックファイルで flock する(O_TRUNC 直書きと両立)。
    """
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _load():
    """tickets.json を {"next_id", "tickets"} 正規形で返す(壊れていれば復元)。"""
    try:
        with open(TICKETS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        data = {}
    tickets = data.get("tickets")
    if not isinstance(tickets, list):
        tickets = []
    next_id = data.get("next_id")
    if isinstance(next_id, bool) or not isinstance(next_id, int) or next_id < 1:
        max_id = max((t.get("id", 0) for t in tickets if isinstance(t, dict)), default=0)
        next_id = max_id + 1
    return {"next_id": next_id, "tickets": tickets}


def _save(data):
    fd = os.open(TICKETS_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.chmod(TICKETS_PATH, 0o600)


def add(text, by="user"):
    """起票して採番済みチケットを返す。text/by は flock 外で検証(早期 reject)。"""
    if not isinstance(text, str) or not text.strip():
        raise TicketError("text required")
    text = text.strip()
    if len(text) > MAX_TEXT:
        raise TicketError("text too long")
    if by not in BYS:
        raise TicketError("by must be user or ai")
    with _locked():
        data = _load()
        tid = data["next_id"]
        now = _now()
        ticket = {"id": tid, "text": text, "by": by, "status": "todo",
                  "created": now, "updated": now}
        data["tickets"].append(ticket)
        data["next_id"] = tid + 1
        _save(data)
    return ticket


def set_status(tid, status):
    """tid の状態を status に。返り値は更新後チケット。無ければ TicketError。"""
    if status not in STATUSES:
        raise TicketError("invalid status")
    with _locked():
        data = _load()
        for t in data["tickets"]:
            if isinstance(t, dict) and t.get("id") == tid:
                t["status"] = status
                t["updated"] = _now()
                _save(data)
                return t
    raise TicketError("no such ticket: #%s" % tid)


def get(tid):
    """tid のチケット(dict)、無ければ None。"""
    with _locked():
        data = _load()
    for t in data["tickets"]:
        if isinstance(t, dict) and t.get("id") == tid:
            return t
    return None


def active():
    """done を除いた一覧 + counts。PWA/CLI の主取得。"""
    with _locked():
        data = _load()
    items = [t for t in data["tickets"]
             if isinstance(t, dict) and t.get("status") in _ACTIVE]
    counts = {"todo": sum(1 for t in items if t.get("status") == "todo"),
              "doing": sum(1 for t in items if t.get("status") == "doing")}
    return {"tickets": items, "counts": counts}


def all_tickets():
    """done 含む全チケット(履歴閲覧・テスト用)。"""
    with _locked():
        data = _load()
    return data["tickets"]


# --- CLI ---
_BY_MARK = {"user": "🙋", "ai": "🤖"}
_ST_MARK = {"todo": "未着手", "doing": "着手中", "done": "完了"}


def _fmt(t):
    return "#%d [%s] %s %s" % (
        t.get("id", 0), _ST_MARK.get(t.get("status"), "?"),
        _BY_MARK.get(t.get("by"), "?"), t.get("text", ""))


def _parse_add(rest):
    """add の引数を (text, by) に。--by <val> を抜き、残りを text に連結。"""
    by = "user"
    words = []
    i = 0
    while i < len(rest):
        if rest[i] == "--by" and i + 1 < len(rest):
            by = rest[i + 1]
            i += 2
        else:
            words.append(rest[i])
            i += 1
    return " ".join(words), by


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    rest = argv[2:]
    try:
        if cmd == "add":
            text, by = _parse_add(rest)
            print(_fmt(add(text, by=by)))
        elif cmd == "list":
            items = all_tickets() if "--all" in rest else active()["tickets"]
            if not items:
                sys.stderr.write("(チケットなし)\n")
                return 0
            for t in items:
                print(_fmt(t))
        elif cmd == "show":
            t = get(int(rest[0]))
            if t is None:
                sys.stderr.write("該当チケットなし\n")
                return 2
            print(_fmt(t))
            created = time.strftime("%Y-%m-%d %H:%M", time.localtime(t.get("created", 0)))
            updated = time.strftime("%Y-%m-%d %H:%M", time.localtime(t.get("updated", 0)))
            print("  起票 %s / 更新 %s" % (created, updated))
        elif cmd == "start":
            print(_fmt(set_status(int(rest[0]), "doing")))
        elif cmd == "done":
            print(_fmt(set_status(int(rest[0]), "done")))
        else:
            sys.stderr.write(__doc__.split("CLI", 1)[-1])
            return 2
    except (TicketError, ValueError, IndexError) as e:
        sys.stderr.write("error: %s\n" % e)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
