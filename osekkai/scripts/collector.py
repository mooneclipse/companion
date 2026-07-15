#!/usr/bin/env python3
"""osekkai collector — ActivityWatch REST pull + SQLite 蓄積 + F3 要約器

計画正本 `workspace/redesign/osekkai-plan.md` v0.2 の D-3/D-4/D-6 を実装する:

- pull: AW query API (AFK 補正済み canonical events) を「前回 pull 済み時刻〜現在」
  の範囲で on-demand 取得し `data/activity.db` へ蓄積。aw-server (Python v0.13.2)
  は timeperiod 境界でイベントをクリップして返す (2026-07-15 実測) ため、連続
  pull はタイル状に隙間なく蓄積され、「pull 開始時刻以降 delete → insert」で
  冪等。失敗時は last_pulled_at が進まないだけで、次回 pull が同範囲を含めて
  取り直す (これが唯一のリトライ機構。プロセス内リトライは組まない)
- D-6 境界はこの入口: イベントの data から exe 名 (app) / AFK 状態 (status) のみ
  取り出し、ウィンドウタイトルは蓄積もログ出力もしない
- 保持 90 日: pull 成功時に古い行を削除
- summary (F3): 指定範囲のアプリ別操作時間 + AFK 状態を日本語ダイジェストにする
  (claude -p のプロンプト素材。夜ブロック既定 = 当日 19:00 JST〜現在)

state は SQLite が一元で持つ (meta.last_pulled_at)。複数プロセス同時実行は
sqlite の busy_timeout で直列化されるため flock は不要 (flock+atomic write は
JSON 意図ストア側の型)。実行ログは stderr へ出す (timer 側でリダイレクト、D-9)。
"""
import argparse
import json
import logging
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("osekkai.collector")

AW_URL = os.environ.get("OSEKKAI_AW_URL", "http://100.100.152.68:5600")
DEVICE = os.environ.get("OSEKKAI_DEVICE", "m-gamepc")
DB_PATH = Path(
    os.environ.get(
        "OSEKKAI_DB",
        str(Path(__file__).resolve().parent.parent / "data" / "activity.db"),
    )
)
JST = timezone(timedelta(hours=9))
RETENTION_DAYS = 90
MAX_PULL_DAYS = 7  # 初回・長期停止後の遡り上限 (前夜 backfill 用途を大きく上回る幅)
HTTP_TIMEOUT_S = 20
NIGHT_START_HOUR = 19  # 夜ブロック開始 (JST)。要件 §3-1
SUMMARY_TOP_APPS = 15
SUMMARY_MIN_APP_S = 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS window_events (
    id INTEGER PRIMARY KEY,
    device TEXT NOT NULL,
    ts_utc TEXT NOT NULL,      -- ISO8601 UTC (timespec=milliseconds、全行同一書式)
    duration_s REAL NOT NULL,  -- AFK 補正済み (not-afk 期間との交差のみ)
    app TEXT NOT NULL          -- exe 名のみ。ウィンドウタイトルは蓄積しない (D-6)
);
CREATE TABLE IF NOT EXISTS afk_events (
    id INTEGER PRIMARY KEY,
    device TEXT NOT NULL,
    ts_utc TEXT NOT NULL,
    duration_s REAL NOT NULL,
    status TEXT NOT NULL       -- 'afk' | 'not-afk'
);
CREATE INDEX IF NOT EXISTS idx_window_ts ON window_events (device, ts_utc);
CREATE INDEX IF NOT EXISTS idx_afk_ts ON afk_events (device, ts_utc);
"""


def _iso(dt: datetime) -> str:
    """aware datetime → UTC ISO8601 (milliseconds)。DB 内の文字列比較の前提書式"""
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def _open_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.executescript(_SCHEMA)
    return conn


def _query_aw(start: datetime, end: datetime) -> dict:
    """query API 1 発で AFK 補正済み window イベントと AFK イベントを取る。

    失敗 (到達不可 / HTTP エラー / 応答不正) は例外のまま呼び出し元へ。
    """
    query = "".join(
        [
            f'window_events = flood(query_bucket(find_bucket("aw-watcher-window_{DEVICE}")));',
            f'afk_events = flood(query_bucket(find_bucket("aw-watcher-afk_{DEVICE}")));',
            'not_afk = filter_keyvals(afk_events, "status", ["not-afk"]);',
            "active = filter_period_intersect(window_events, not_afk);",
            'RETURN = {"window": active, "afk": afk_events};',
        ]
    )
    body = {"timeperiods": [f"{_iso(start)}/{_iso(end)}"], "query": [query]}
    req = urllib.request.Request(
        AW_URL + "/api/0/query/",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        result = json.loads(resp.read())
    return result[0]


def pull() -> tuple[int, int]:
    """前回 pull 済み時刻〜現在を取得して蓄積する。(window 件数, afk 件数) を返す"""
    conn = _open_db()
    try:
        now = datetime.now(timezone.utc)
        meta_key = f"last_pulled_at:{DEVICE}"
        row = conn.execute(
            "SELECT value FROM meta WHERE key = ?", (meta_key,)
        ).fetchone()
        floor = now - timedelta(days=MAX_PULL_DAYS)
        start = datetime.fromisoformat(row[0]) if row else floor
        if start < floor:
            start = floor
        if start >= now:
            logger.info("pull 範囲なし (last_pulled_at が現在以降)")
            return (0, 0)

        result = _query_aw(start, now)

        # D-6 境界: ここで app / status のみ取り出し、title は捨てる
        win_rows = [
            (DEVICE, _iso(datetime.fromisoformat(ev["timestamp"])),
             float(ev["duration"]), str(ev["data"].get("app") or "unknown"))
            for ev in result["window"]
        ]
        afk_rows = [
            (DEVICE, _iso(datetime.fromisoformat(ev["timestamp"])),
             float(ev["duration"]), str(ev["data"].get("status") or "unknown"))
            for ev in result["afk"]
        ]

        start_iso = _iso(start)
        retention_cutoff = _iso(now - timedelta(days=RETENTION_DAYS))
        with conn:
            conn.execute(
                "DELETE FROM window_events WHERE device = ? AND ts_utc >= ?",
                (DEVICE, start_iso),
            )
            conn.execute(
                "DELETE FROM afk_events WHERE device = ? AND ts_utc >= ?",
                (DEVICE, start_iso),
            )
            conn.executemany(
                "INSERT INTO window_events (device, ts_utc, duration_s, app)"
                " VALUES (?, ?, ?, ?)",
                win_rows,
            )
            conn.executemany(
                "INSERT INTO afk_events (device, ts_utc, duration_s, status)"
                " VALUES (?, ?, ?, ?)",
                afk_rows,
            )
            conn.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (meta_key, _iso(now)),
            )
            conn.execute(
                "DELETE FROM window_events WHERE ts_utc < ?", (retention_cutoff,)
            )
            conn.execute(
                "DELETE FROM afk_events WHERE ts_utc < ?", (retention_cutoff,)
            )
        logger.info(
            f"pull 完了: {start_iso} 〜 {_iso(now)}"
            f" window={len(win_rows)} afk={len(afk_rows)}"
        )
        return (len(win_rows), len(afk_rows))
    finally:
        conn.close()


def _fmt_duration(seconds: float) -> str:
    total = int(round(seconds))
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    if h:
        return f"{h}時間{m}分"
    if m:
        return f"{m}分"
    return f"{s}秒"


def _fmt_jst(dt: datetime) -> str:
    return dt.astimezone(JST).strftime("%m-%d %H:%M")


def summarize(since: datetime, until: datetime) -> str:
    """F3 要約: 範囲内のアプリ別操作時間 + AFK 状態の日本語ダイジェストを返す"""
    conn = _open_db()
    try:
        s_iso, u_iso = _iso(since), _iso(until)
        apps = conn.execute(
            "SELECT app, SUM(duration_s) FROM window_events"
            " WHERE device = ? AND ts_utc >= ? AND ts_utc < ?"
            " GROUP BY app ORDER BY SUM(duration_s) DESC",
            (DEVICE, s_iso, u_iso),
        ).fetchall()
        afk = dict(
            conn.execute(
                "SELECT status, SUM(duration_s) FROM afk_events"
                " WHERE device = ? AND ts_utc >= ? AND ts_utc < ?"
                " GROUP BY status",
                (DEVICE, s_iso, u_iso),
            ).fetchall()
        )
        meta_row = conn.execute(
            "SELECT value FROM meta WHERE key = ?", (f"last_pulled_at:{DEVICE}",)
        ).fetchone()
    finally:
        conn.close()

    period = f"{_fmt_jst(since)}〜{_fmt_jst(until)} JST"
    pulled = (
        f"最終取得 {_fmt_jst(datetime.fromisoformat(meta_row[0]))} JST"
        if meta_row
        else "未取得"
    )
    lines = [f"PC 活動ダイジェスト ({DEVICE}, {period} / {pulled})"]

    if not apps and not afk:
        lines.append("- この時間帯の活動データなし (PC 未使用か収集できていない)")
        return "\n".join(lines)

    active_s = afk.get("not-afk", 0.0)
    afk_s = afk.get("afk", 0.0)
    lines.append(f"- 操作 {_fmt_duration(active_s)} / 離席 {_fmt_duration(afk_s)}")

    shown = [(a, d) for a, d in apps[:SUMMARY_TOP_APPS] if d >= SUMMARY_MIN_APP_S]
    rest = [(a, d) for a, d in apps if (a, d) not in shown]
    if shown:
        lines.append("- アプリ別 (操作時間):")
        lines.extend(f"  - {app}: {_fmt_duration(dur)}" for app, dur in shown)
    if shown and rest:
        rest_total = sum(d for _, d in rest)
        lines.append(f"  - (その他 {len(rest)} 個: {_fmt_duration(rest_total)})")
    elif rest:
        rest_total = sum(d for _, d in rest)
        lines.append(f"- アプリ別: 1 分以上の項目なし (計 {_fmt_duration(rest_total)})")
    return "\n".join(lines)


def _default_since(now_jst: datetime) -> datetime:
    """夜ブロック既定の開始 = 当日 19:00 JST (深夜 0〜5 時は前日扱い)"""
    base = now_jst.date()
    if now_jst.hour < 5:
        base = base - timedelta(days=1)
    return datetime(base.year, base.month, base.day, NIGHT_START_HOUR, tzinfo=JST)


def _parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=JST)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pull", help="AW から前回 pull 以降を取得して蓄積")
    p_sum = sub.add_parser("summary", help="F3 ダイジェストを stdout へ出力")
    p_sum.add_argument("--since", type=_parse_dt, help="開始 (ISO8601、naive は JST)")
    p_sum.add_argument("--until", type=_parse_dt, help="終了 (同上)。既定 = 現在")
    sub.add_parser("status", help="last_pulled_at と蓄積行数を表示")
    args = parser.parse_args()

    if args.cmd == "pull":
        try:
            pull()
        except Exception as e:
            # PC オフ等の到達不可を含む。state は進んでおらず次回 pull が取り直す
            logger.error(f"pull 失敗 (次回 pull で同範囲を再取得): {e}")
            return 1
        return 0

    if args.cmd == "summary":
        now_jst = datetime.now(JST)
        since = args.since or _default_since(now_jst)
        until = args.until or now_jst
        print(summarize(since, until))
        return 0

    if args.cmd == "status":
        conn = _open_db()
        try:
            meta = conn.execute("SELECT key, value FROM meta").fetchall()
            n_win = conn.execute("SELECT COUNT(*) FROM window_events").fetchone()[0]
            n_afk = conn.execute("SELECT COUNT(*) FROM afk_events").fetchone()[0]
        finally:
            conn.close()
        for key, value in meta:
            print(f"{key} = {value} ({_fmt_jst(datetime.fromisoformat(value))} JST)")
        print(f"window_events = {n_win} 行 / afk_events = {n_afk} 行 ({DB_PATH})")
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
