#!/usr/bin/env python3
"""出題選定 + streak/trend 集計 (設計 english-design.md §2 streak 定義 / §4.3 出題選定)。

daily_sets (JST 日付キー) の生成・読み出しと、attempts からの streak/trend 計算を
一手に引き受ける。server/app.py はここの公開関数だけを呼ぶ (SQL を直接書かない)。
"""
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")

DAILY_SET_SIZE = 3
EXTRA_SET_SIZE = 3


# ---- JST 日付ヘルパ -------------------------------------------------

def jst_today_str(now=None):
    dt = now or datetime.now(JST)
    return dt.strftime("%Y-%m-%d")


def jst_day_range_ts(date_str):
    """"YYYY-MM-DD" (JST) の [start_ts, end_ts] (unix 秒、両端含む) を返す。"""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=JST)
    start = int(dt.timestamp())
    end = int((dt + timedelta(days=1)).timestamp()) - 1
    return start, end


def jst_date_of_ts(ts):
    return datetime.fromtimestamp(ts, JST).strftime("%Y-%m-%d")


def _shift_date(date_str, delta_days):
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=JST)
    return (dt + timedelta(days=delta_days)).strftime("%Y-%m-%d")


# ---- 出題プール・重み ------------------------------------------------

def _all_clips(conn):
    return conn.execute(
        "SELECT id, episode_id, blanks, feature_tags FROM clips"
    ).fetchall()


def _eligible_pool(conn):
    """視聴済み範囲内のクリップ (clip.end_s <= watch.max_position_s または completed)。
    空なら全クリップにフォールバック (§4.3-1)。
    """
    rows = conn.execute(
        """
        SELECT c.id, c.episode_id, c.blanks, c.feature_tags
        FROM clips c
        JOIN watch w ON w.episode_id = c.episode_id
        WHERE c.end_s <= w.max_position_s OR w.completed_at IS NOT NULL
        """
    ).fetchall()
    if rows:
        return rows
    return _all_clips(conn)


def _most_recent_episode(conn):
    row = conn.execute(
        "SELECT episode_id FROM watch ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    return row["episode_id"] if row else None


def _attempted_ids(conn):
    rows = conn.execute("SELECT DISTINCT clip_id FROM attempts").fetchall()
    return {r["clip_id"] for r in rows}


def _last_attempt_ts(conn):
    rows = conn.execute(
        "SELECT clip_id, MAX(ts) AS last_ts FROM attempts GROUP BY clip_id"
    ).fetchall()
    return {r["clip_id"]: r["last_ts"] for r in rows}


def _load_weights(conn):
    """analysis 最新行の weights (§3.4 契約スキーマ) を読む。
    行が無い/JSON 不正/スキーマ不正はいずれも「重みなし」= None として扱う
    (analyze.py 側で fallback 確定済みのはずだが、drill 側も 1 回で確定し分岐を増やさない)。
    """
    row = conn.execute(
        "SELECT weights FROM analysis ORDER BY date DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    try:
        w = json.loads(row["weights"])
    except (TypeError, ValueError):
        return None
    if not isinstance(w, dict):
        return None
    if not isinstance(w.get("feature_tags"), dict) or not isinstance(w.get("pairs"), dict):
        return None
    return w


def _clip_weight(weights, clip_row):
    """feature_tags / 混同ペアの一致で重みを乗算するスコア (weights が無ければ常に 1.0)。"""
    if not weights:
        return 1.0
    score = 1.0
    try:
        tags = json.loads(clip_row["feature_tags"] or "[]")
    except (TypeError, ValueError):
        tags = []
    for tag in tags:
        score *= weights["feature_tags"].get(tag, 1.0)
    try:
        blanks = json.loads(clip_row["blanks"] or "[]")
    except (TypeError, ValueError):
        blanks = []
    for blank in blanks:
        answer = blank.get("answer")
        for choice in blank.get("choices", []):
            if choice == answer:
                continue
            pair_key = "|".join(sorted([answer, choice]))
            if pair_key in weights["pairs"]:
                score *= weights["pairs"][pair_key]
    return score


def _rank_key(weights, attempted, last_ts, clip_row):
    """§4.3 の (未出題優先 → 最終attempt古い順) に weights の重み付けを重ねた並び替えキー。
    weights が無い (v0 既定) 場合は tie が全部 1.0 になるので純粋に §4.3-3 の規則のまま動く。
    """
    is_attempted = 1 if clip_row["id"] in attempted else 0
    weight = _clip_weight(weights, clip_row)
    ts = last_ts.get(clip_row["id"], 0)
    return (is_attempted, -weight, ts, clip_row["id"])


def select_clips(conn, n, exclude=None):
    """§4.3 のクリップ選定規則そのもの。返り値は clip_id のリスト (最大 n 本)。"""
    exclude = set(exclude or [])
    pool = [r for r in _eligible_pool(conn) if r["id"] not in exclude]
    if not pool:
        pool = [r for r in _all_clips(conn) if r["id"] not in exclude]
    if not pool:
        return []

    weights = _load_weights(conn)
    attempted = _attempted_ids(conn)
    last_ts = _last_attempt_ts(conn)

    def pick_one(candidates):
        return min(candidates, key=lambda r: _rank_key(weights, attempted, last_ts, r))

    chosen = []
    recent_ep = _most_recent_episode(conn)
    if recent_ep:
        recent_candidates = [r for r in pool if r["episode_id"] == recent_ep]
        if recent_candidates:
            chosen.append(pick_one(recent_candidates))

    remaining = [r for r in pool if r["id"] not in {c["id"] for c in chosen}]
    while len(chosen) < n and remaining:
        best = pick_one(remaining)
        chosen.append(best)
        remaining = [r for r in remaining if r["id"] != best["id"]]

    return [c["id"] for c in chosen]


# ---- daily_sets -------------------------------------------------------

def get_or_create_daily_set(conn, date_str=None):
    """今日 (JST) の daily_sets 行を返す ({"clip_ids": [...], "extra_ids": [...]})。
    無ければ選定して確定保存する (§4.3-3: 日内は固定)。
    """
    date_str = date_str or jst_today_str()
    row = conn.execute(
        "SELECT clip_ids, extra_ids FROM daily_sets WHERE date = ?", (date_str,)
    ).fetchone()
    if row:
        return {"clip_ids": json.loads(row["clip_ids"]), "extra_ids": json.loads(row["extra_ids"])}

    clip_ids = select_clips(conn, DAILY_SET_SIZE)
    if not clip_ids:
        # 適格クリップが 0 本の日を空セットのまま確定保存しない。
        # 確定してしまうと当日中に ingest が追いついても翌日まで空固定になるため、
        # 未確定のまま返し次回リクエストで再度生成を試みる。
        return {"clip_ids": [], "extra_ids": []}

    conn.execute(
        "INSERT OR IGNORE INTO daily_sets (date, clip_ids, extra_ids) VALUES (?, ?, '[]')",
        (date_str, json.dumps(clip_ids)),
    )
    conn.commit()
    # INSERT OR IGNORE で他リクエストと競合した場合は確定済みの行を読み直す
    row = conn.execute(
        "SELECT clip_ids, extra_ids FROM daily_sets WHERE date = ?", (date_str,)
    ).fetchone()
    return {"clip_ids": json.loads(row["clip_ids"]), "extra_ids": json.loads(row["extra_ids"])}


def add_extra(conn, date_str=None):
    """「もう1セット」: 既存 daily_sets に無いクリップを追加し extra_ids に固定する。
    追加分の clip_id リストを返す。
    """
    date_str = date_str or jst_today_str()
    daily = get_or_create_daily_set(conn, date_str)
    exclude = daily["clip_ids"] + daily["extra_ids"]
    new_ids = select_clips(conn, EXTRA_SET_SIZE, exclude=exclude)
    if new_ids:
        merged = daily["extra_ids"] + new_ids
        conn.execute(
            "UPDATE daily_sets SET extra_ids = ? WHERE date = ?",
            (json.dumps(merged), date_str),
        )
        conn.commit()
    return new_ids


# ---- streak / trend ----------------------------------------------------

def attempted_today_ids(conn, date_str=None):
    """当日 (JST) に attempts が記録された clip_id の集合 (GET /api/drill/today の done 判定用)。"""
    date_str = date_str or jst_today_str()
    start, end = jst_day_range_ts(date_str)
    rows = conn.execute(
        "SELECT DISTINCT clip_id FROM attempts WHERE ts BETWEEN ? AND ?", (start, end)
    ).fetchall()
    return {r["clip_id"] for r in rows}


def _achieved(conn, date_str):
    """その日の daily_sets.clip_ids 全件に、その日 (JST) 内の attempts があるか (§2 streak 定義)。"""
    row = conn.execute(
        "SELECT clip_ids FROM daily_sets WHERE date = ?", (date_str,)
    ).fetchone()
    if not row:
        return False
    clip_ids = json.loads(row["clip_ids"])
    if not clip_ids:
        return False
    start, end = jst_day_range_ts(date_str)
    placeholders = ",".join("?" for _ in clip_ids)
    attempted_today = conn.execute(
        f"SELECT DISTINCT clip_id FROM attempts WHERE ts BETWEEN ? AND ? AND clip_id IN ({placeholders})",
        (start, end, *clip_ids),
    ).fetchall()
    return {r["clip_id"] for r in attempted_today} >= set(clip_ids)


def compute_streak(conn, today_str=None):
    """連続達成日数。今日がまだ未達成でも streak は途切れない (今日はまだ猶予がある)。"""
    today_str = today_str or jst_today_str()
    day = today_str
    if not _achieved(conn, day):
        day = _shift_date(day, -1)
    count = 0
    while _achieved(conn, day):
        count += 1
        day = _shift_date(day, -1)
    return count


def compute_today_summary(conn, date_str=None):
    date_str = date_str or jst_today_str()
    daily = get_or_create_daily_set(conn, date_str)
    clip_ids = daily["clip_ids"]
    total = len(clip_ids)
    if total == 0:
        return {"done": 0, "total": 0, "completed": True}
    start, end = jst_day_range_ts(date_str)
    placeholders = ",".join("?" for _ in clip_ids)
    rows = conn.execute(
        f"SELECT DISTINCT clip_id FROM attempts WHERE ts BETWEEN ? AND ? AND clip_id IN ({placeholders})",
        (start, end, *clip_ids),
    ).fetchall()
    done = len(rows)
    return {"done": done, "total": total, "completed": done >= total}


def compute_trend(conn, days=14, today_str=None):
    """直近 days 日分 (JST、今日含む) の正答率トレンド。attempts が無い日は acc: None。"""
    today_str = today_str or jst_today_str()
    dates = [_shift_date(today_str, -offset) for offset in range(days - 1, -1, -1)]
    start, _ = jst_day_range_ts(dates[0])
    _, end = jst_day_range_ts(dates[-1])
    rows = conn.execute(
        "SELECT ts, results FROM attempts WHERE ts BETWEEN ? AND ?", (start, end)
    ).fetchall()

    correct_by_date = {d: 0 for d in dates}
    total_by_date = {d: 0 for d in dates}
    for r in rows:
        d = jst_date_of_ts(r["ts"])
        if d not in correct_by_date:
            continue
        try:
            results = json.loads(r["results"])
        except (TypeError, ValueError):
            results = []
        for entry in results:
            total_by_date[d] += 1
            if entry.get("correct"):
                correct_by_date[d] += 1

    trend = []
    for d in dates:
        total = total_by_date[d]
        acc = round(correct_by_date[d] / total, 3) if total else None
        trend.append({"date": d, "acc": acc})
    return trend


def get_continue_episode(conn):
    """未完了で直近に視聴したエピソード (§4.2 /api/home continue)。無ければ None。"""
    row = conn.execute(
        """
        SELECT w.episode_id, w.position_s, e.title, e.duration_s
        FROM watch w
        JOIN episodes e ON e.id = w.episode_id
        WHERE w.completed_at IS NULL
        ORDER BY w.updated_at DESC
        LIMIT 1
        """
    ).fetchone()
    if not row:
        return None
    return {
        "episode_id": row["episode_id"],
        "title": row["title"],
        "position_s": row["position_s"],
        "duration_s": row["duration_s"],
    }
