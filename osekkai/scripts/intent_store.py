#!/usr/bin/env python3
"""osekkai 意図ストア — backlog.json / tonight.json の読み書き (#110 TODO 5)

計画正本 `workspace/redesign/osekkai-plan.md` v0.2 の D-5/D-8 を実装する:

- backlog.json: 週次バックログ + 締切アイテム。Phase 1 の登録は手書き JSON か
  この CLI 直叩き (`/tweet` の subprocess 書き込みと同型、§4 Phase 1 末尾)
- tonight.json: 今夜の意図・休むフラグ・号令済みマーク・振り返り送信済みマーク。
  **JST 日付キー付き** — 前日のフラグが今日の判定を誤らせない構造 (D-8)。夜ブロック
  は 19:00〜24:00 で日付を跨がないため「今夜」= 当日日付 (`_today_key`) でよい。
  日付境界の扱いを変える必要が出た場合はこの関数だけ差し替えれば済むよう分離する

書き込みは ytcheck `channel_store.py` の flock(LOCK_EX) + 同ディレクトリ tmp +
os.replace の atomic write を流用する。書き手は trigger の oneshot スクリプトと
bot プロセスの複数 (collector.py の SQLite busy_timeout とは別系統 — JSON は
busy_timeout に相当する仕組みがないため flock が必須)。channel_store と異なり
data/ は git 管理外 (osekkai/.gitignore) なので **git 自動 commit は行わない**。

判定用の「当日状態 1 発読み」(`tonight_status` / CLI `tonight-status`) は
atomic write により常に完全な内容が読めるためロックなし (channel_store の
`load()` と同型)。TODO 6 (trigger) / TODO 7 (bot) はこの CLI を subprocess
経由で叩くか、本モジュールを import して直接関数を呼ぶ。

ファイル不在時は空状態として安全に動く (初回書き込みで自然に生成)。JSON の
パース失敗 (壊れたファイル) は atomic write により実質発生しないため、発生時は
握りつぶさず例外のまま呼び出し元へ送る (CLI 層は json.JSONDecodeError を捕捉して
専用のエラーメッセージにする。ValueError のサブクラスなので --date 検証エラーの
catch より先に置く)。
"""
import argparse
import fcntl
import json
import logging
import os
import sys
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger("osekkai.intent_store")

JST = timezone(timedelta(hours=9))

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BACKLOG_PATH = Path(os.environ.get("OSEKKAI_BACKLOG", str(_DATA_DIR / "backlog.json")))
TONIGHT_PATH = Path(os.environ.get("OSEKKAI_TONIGHT", str(_DATA_DIR / "tonight.json")))

_EMPTY_BACKLOG: dict[str, Any] = {"items": []}
_EMPTY_TONIGHT: dict[str, Any] = {}


# ---- flock + atomic write (channel_store.py の型を流用、git commit なし) ----


@contextmanager
def _locked(path: Path) -> Iterator[None]:
    """path と同ディレクトリの `.<name>.lock` を flock(LOCK_EX) で保持する"""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(path.parent / f".{path.name}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def _read(path: Path, empty: dict[str, Any]) -> dict[str, Any]:
    """path を読む。不在は空状態 (JSON 破損は握りつぶさず例外のまま送る)"""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return json.loads(json.dumps(empty))  # deep copy


def _write_atomic(data: dict[str, Any], path: Path) -> None:
    """同ディレクトリ tmp に書いて os.replace (呼び出し元がロック保持前提)"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / (path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ---- backlog.json ----


def backlog_load(*, path: Path | None = None) -> dict[str, Any]:
    return _read(path or BACKLOG_PATH, _EMPTY_BACKLOG)


def backlog_add(
    text: str, deadline: str | None = None, *, path: Path | None = None
) -> dict[str, Any]:
    """バックログにアイテムを 1 件追加する。id は既存最大 +1 (1 始まり)"""
    target = path or BACKLOG_PATH
    with _locked(target):
        data = _read(target, _EMPTY_BACKLOG)
        items = data.setdefault("items", [])
        next_id = max((it["id"] for it in items), default=0) + 1
        item = {
            "id": next_id,
            "text": text,
            "deadline": deadline,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "done": False,
            "done_at": None,
        }
        items.append(item)
        _write_atomic(data, target)
    return item


def backlog_list(
    *, path: Path | None = None, include_done: bool = False
) -> list[dict[str, Any]]:
    items = backlog_load(path=path).get("items", [])
    if include_done:
        return list(items)
    return [it for it in items if not it.get("done")]


def backlog_complete(item_id: int, *, path: Path | None = None) -> dict[str, Any]:
    """id が一致するアイテムを完了にする。不在は KeyError、完了済みは冪等 (再書き込みなし)"""
    target = path or BACKLOG_PATH
    with _locked(target):
        data = _read(target, _EMPTY_BACKLOG)
        for it in data.get("items", []):
            if it["id"] == item_id:
                if not it.get("done"):
                    it["done"] = True
                    it["done_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    _write_atomic(data, target)
                return dict(it)
    raise KeyError(f"backlog item id が見つかりません: {item_id}")


# ---- tonight.json ----


def _today_key(day: str | None = None) -> str:
    """今夜の日付キー (JST、YYYY-MM-DD)。夜ブロックは 19:00〜24:00 で日付を跨がない
    ため単純な当日日付でよい (D-8)。day 指定時は形式検証のみ行い素通しする
    (テスト・trigger からの明示指定用)。"""
    if day is not None:
        date.fromisoformat(day)  # 形式検証。不正なら ValueError
        return day
    return datetime.now(JST).date().isoformat()


def _empty_tonight_entry(day: str) -> dict[str, Any]:
    return {
        "date": day,
        "intent": None,
        "intent_set_at": None,
        "resting": False,
        "resting_set_at": None,
        "called": False,
        "called_at": None,
        "retro_sent": False,
        "retro_sent_at": None,
        "updated_at": None,
    }


def tonight_status(day: str | None = None, *, path: Path | None = None) -> dict[str, Any]:
    """判定用の当日状態 1 発読み。ロックなし (atomic write により常に完全な内容が読める)。
    不在キーは空状態を返す (安全に動く)。"""
    key = _today_key(day)
    data = _read(path or TONIGHT_PATH, _EMPTY_TONIGHT)
    return data.get(key) or _empty_tonight_entry(key)


def _tonight_mutate(
    day: str | None, path: Path | None, mutate
) -> tuple[dict[str, Any], bool]:
    """tonight.json の当日エントリをロック下で読み→mutate(entry)→書き込みする共通処理。
    mutate は entry を書き換えて bool (実際に変更したか) を返す。変更なしなら書き込みしない。
    (entry, changed) を返す — changed は冪等マーク系が「今回の呼び出しが初回だったか」を
    判定するのに使う (tonight_mark_called / tonight_mark_retro_sent 参照)。"""
    target = path or TONIGHT_PATH
    key = _today_key(day)
    with _locked(target):
        data = _read(target, _EMPTY_TONIGHT)
        entry = data.get(key) or _empty_tonight_entry(key)
        changed = mutate(entry)
        if changed:
            entry["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            data[key] = entry
            _write_atomic(data, target)
    return entry, changed


def tonight_set_intent(
    text: str, day: str | None = None, *, path: Path | None = None
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def mutate(entry: dict[str, Any]) -> bool:
        entry["intent"] = text
        entry["intent_set_at"] = now
        return True

    entry, _changed = _tonight_mutate(day, path, mutate)
    return entry


def tonight_set_resting(
    resting: bool = True, day: str | None = None, *, path: Path | None = None
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def mutate(entry: dict[str, Any]) -> bool:
        if entry.get("resting") == resting:
            return False
        entry["resting"] = resting
        entry["resting_set_at"] = now
        return True

    entry, _changed = _tonight_mutate(day, path, mutate)
    return entry


def tonight_mark_called(day: str | None = None, *, path: Path | None = None) -> dict[str, Any]:
    """号令済みマーク。冪等 — 既に立っていれば no-op (二重発火防止、§4 Phase 1 末尾)。

    返り値には `first_call` (今回の呼び出しで初めてマークが立ったか) を含める。
    tonight.json には persist しない (read→判断→mark の 2 段だと read/mark 間に
    二重送信が起き得るため、消費側は「mark して first_call を見る」1 発で判定する)。"""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def mutate(entry: dict[str, Any]) -> bool:
        if entry.get("called"):
            return False
        entry["called"] = True
        entry["called_at"] = now
        return True

    entry, changed = _tonight_mutate(day, path, mutate)
    result = dict(entry)
    result["first_call"] = changed
    return result


def tonight_mark_retro_sent(day: str | None = None, *, path: Path | None = None) -> dict[str, Any]:
    """振り返り送信済みマーク。冪等 — 既に立っていれば no-op。
    tonight_mark_called と同型で `first_call` を返り値に含める (persist しない)。"""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def mutate(entry: dict[str, Any]) -> bool:
        if entry.get("retro_sent"):
            return False
        entry["retro_sent"] = True
        entry["retro_sent_at"] = now
        return True

    entry, changed = _tonight_mutate(day, path, mutate)
    result = dict(entry)
    result["first_call"] = changed
    return result


# ---- CLI ----


def _print_json(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("backlog-add", help="バックログにアイテムを追加")
    p_add.add_argument("text")
    p_add.add_argument("--deadline", help="締切 (YYYY-MM-DD、任意)")

    p_list = sub.add_parser("backlog-list", help="バックログ一覧を表示")
    p_list.add_argument("--all", action="store_true", help="完了済みも含めて表示")

    p_complete = sub.add_parser("backlog-complete", help="バックログアイテムを完了にする")
    p_complete.add_argument("id", type=int)

    p_intent = sub.add_parser("tonight-intent", help="今夜の意図を記録")
    p_intent.add_argument("text")
    p_intent.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST)")

    p_rest = sub.add_parser("tonight-rest", help="今夜は休むフラグを立てる/解除する")
    p_rest.add_argument("--off", action="store_true", help="フラグを解除する (既定は設定)")
    p_rest.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST)")

    p_called = sub.add_parser("tonight-called", help="号令済みマークを立てる (冪等)")
    p_called.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST)")

    p_retro = sub.add_parser("tonight-retro", help="振り返り送信済みマークを立てる (冪等)")
    p_retro.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST)")

    p_status = sub.add_parser("tonight-status", help="当日状態を JSON で出力 (判定用 1 発読み)")
    p_status.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST)")

    args = parser.parse_args()

    if args.cmd == "backlog-add":
        _print_json(backlog_add(args.text, args.deadline))
        return 0

    if args.cmd == "backlog-list":
        items = backlog_list(include_done=args.all)
        if not items:
            print("(バックログは空です)")
            return 0
        for it in items:
            mark = "x" if it.get("done") else " "
            deadline = f" (締切: {it['deadline']})" if it.get("deadline") else ""
            print(f"[{mark}] #{it['id']} {it['text']}{deadline}")
        return 0

    if args.cmd == "backlog-complete":
        try:
            _print_json(backlog_complete(args.id))
        except KeyError as e:
            logger.error(str(e))
            return 1
        return 0

    try:
        if args.cmd == "tonight-intent":
            _print_json(tonight_set_intent(args.text, args.date))
            return 0

        if args.cmd == "tonight-rest":
            _print_json(tonight_set_resting(not args.off, args.date))
            return 0

        if args.cmd == "tonight-called":
            _print_json(tonight_mark_called(args.date))
            return 0

        if args.cmd == "tonight-retro":
            _print_json(tonight_mark_retro_sent(args.date))
            return 0

        if args.cmd == "tonight-status":
            _print_json(tonight_status(args.date))
            return 0
    except json.JSONDecodeError as e:
        # ValueError のサブクラスなので --date 不正の catch より先に置く必要がある
        logger.error(f"データファイルが壊れています: {e}")
        return 1
    except ValueError as e:
        logger.error(f"--date が不正です (YYYY-MM-DD で指定): {e}")
        return 1

    return 2


if __name__ == "__main__":
    sys.exit(main())
