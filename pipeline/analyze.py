#!/usr/bin/env python3
"""companion-english 夜間バッチ — 回答記録の傾向分析「傾向と対策」(設計 §3.4、v1)。

直近 14 日の attempts × clips join (誤答語 / 選んだ誤答肢 / feature_tags / wpm / replays /
flags) を JSON 集計し、`claude -p --output-format json` に 1 回だけ渡して
  1. report_md — 日本語の「傾向と対策」短文 (ホームのレポートカードに表示)
  2. weights   — feature_tag・混同ペアごとの出題重み (server/drill.py の選定に反映)
を得る。結果は analysis テーブル (date PK) に INSERT OR REPLACE で確定保存し、
source に "llm" / "fallback" を記録する。

weights の契約スキーマ (llm / fallback 共通、これ以外の形を許さない — §3.4):
  {"feature_tags": {"weak_form": 1.5}, "pairs": {"can|can't": 2.0}}
  (ペアキーはソート済み "|" 連結。LLM 出力が未ソートの場合はソートに正規化して保存する)

フォールバック (必須): claude -p の失敗 (rc≠0 / envelope 不正 / 本文 JSON 不正 /
スキーマ検証 NG) はいずれも **1 回の判定で fallback に確定** する。リトライも
stderr 文言による分岐もしない (上位 CLAUDE.md の 2 周目ルール)。fallback は
feature_tag 別誤答率の単純集計から weights を算出し、report_md は定型文。
学習ループは LLM なしでも完全に回る。

窓内に attempts が 1 件も無い日は分析対象がないので何も書かずに正常終了する
(analysis 行が増えず、ホームのカードは前回分のまま / 一度も無ければ非表示)。

実行: `python3 pipeline/analyze.py [--db PATH] [--date YYYY-MM-DD] [--fallback]`
  --fallback は claude -p を呼ばず fallback 経路を強制する (動作確認・クォータ節約用)。
claude バイナリは $ENGLISH_CLAUDE → PATH → ~/.nvm/versions/node/*/bin/claude の順で
解決する (systemd user timer の PATH に nvm が乗らない問題への ytcheck run.sh と同じ手当)。
"""
import argparse
import glob
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common  # noqa: E402  (server/ を sys.path に足す副作用込み)
import drill   # noqa: E402  (JST 日付ヘルパを共用、server/drill.py)

WINDOW_DAYS = 14
CLAUDE_TIMEOUT = 300  # 秒。夜間バッチなので余裕を持たせ、無限ハングだけ止める

_FENCE_RE = re.compile(r"^```(?:json)?\s*\n(.*)\n```\s*$", re.DOTALL)

PROMPT_TEMPLATE = """あなたは英語リスニング学習アプリの学習コーチ。以下は学習者の直近{days}日間の穴埋めドリル回答の集計 (JSON)。blanks はドリルの空欄、misses は「正解 answer に対して誤答肢 chosen を選んだ」記録、feature_tag_stats は特徴タグ別の空欄数と誤答数、wpm はクリップの発話速度。

{stats_json}

この集計を分析し、次の形の JSON だけを出力すること (コードフェンス・説明文・前置きは一切付けない):
{{"report_md": "...", "weights": {{"feature_tags": {{...}}, "pairs": {{...}}}}}}

- report_md: 日本語の「傾向と対策」短文 (2〜4 文、プレーンテキストで学習者に直接語りかける)。誤答の音声的な傾向 (弱形・否定形の聞き分けなど) と、明日から使える具体的な練習アドバイスを含める
- weights.feature_tags: 重点的に出題すべき feature_tag → 出題重み。1.0 が標準で、大きいほど優先 (0.5〜3.0 の範囲)。feature_tag_stats に現れたタグだけを使う
- weights.pairs: 聞き分けを間違えている語ペア → 出題重み (0.5〜3.0 の範囲)。キーは 2 語をアルファベット順に "|" で連結する (例 "can|can't")。misses に現れた answer/chosen の組だけを使う
- 該当がなければ feature_tags / pairs は空オブジェクト {{}} でよい"""


# ---- 集計 (claude -p への入力 / fallback の材料を共用) ----------------------

def collect_stats(conn, today_str):
    """直近 WINDOW_DAYS 日 (JST、today_str 含む) の attempts × clips join を集計する。
    生ログは返さない (クォータ最小化、§3.4) — misses / feature_tag_stats / flags に
    畳み込んだ dict を返す。"""
    since_str = drill._shift_date(today_str, -(WINDOW_DAYS - 1))
    start_ts, _ = drill.jst_day_range_ts(since_str)
    _, end_ts = drill.jst_day_range_ts(today_str)
    rows = conn.execute(
        """
        SELECT a.results, a.flags, a.replays, c.feature_tags, c.wpm
        FROM attempts a JOIN clips c ON c.id = a.clip_id
        WHERE a.ts BETWEEN ? AND ?
        """,
        (start_ts, end_ts),
    ).fetchall()

    attempts = len(rows)
    blank_total = blank_correct = replays_total = 0
    misses = {}       # (answer, chosen) -> {"count", "feature_tags", "wpm_sum"}
    tag_stats = {}    # tag -> {"total", "wrong"}
    flag_counts = {}  # flag -> count
    for r in rows:
        try:
            results = json.loads(r["results"])
        except (TypeError, ValueError):
            results = []
        try:
            tags = json.loads(r["feature_tags"] or "[]")
        except (TypeError, ValueError):
            tags = []
        try:
            flags = json.loads(r["flags"] or "[]")
        except (TypeError, ValueError):
            flags = []
        replays_total += r["replays"] or 0
        for flag in flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1
        for entry in results:
            blank_total += 1
            correct = bool(entry.get("correct"))
            if correct:
                blank_correct += 1
            for tag in tags:
                st = tag_stats.setdefault(tag, {"total": 0, "wrong": 0})
                st["total"] += 1
                if not correct:
                    st["wrong"] += 1
            if not correct:
                answer = entry.get("answer") or ""
                chosen = entry.get("chosen") or ""
                if answer and chosen:
                    m = misses.setdefault((answer, chosen),
                                          {"count": 0, "feature_tags": set(), "wpm_sum": 0})
                    m["count"] += 1
                    m["feature_tags"].update(tags)
                    m["wpm_sum"] += r["wpm"] or 0

    miss_list = [
        {
            "answer": answer,
            "chosen": chosen,
            "count": m["count"],
            "feature_tags": sorted(m["feature_tags"]),
            "avg_wpm": int(round(m["wpm_sum"] / m["count"])) if m["count"] else 0,
        }
        for (answer, chosen), m in sorted(
            misses.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
    ]
    return {
        "window_days": WINDOW_DAYS,
        "since": since_str,
        "until": today_str,
        "attempts": attempts,
        "blank_total": blank_total,
        "blank_correct": blank_correct,
        "misses": miss_list,
        "feature_tag_stats": tag_stats,
        "replays_total": replays_total,
        "flag_counts": flag_counts,
    }


# ---- claude -p 経路 ---------------------------------------------------------

def _resolve_claude():
    """$ENGLISH_CLAUDE → PATH → nvm 配下 の順で claude バイナリを解決 (無ければ None)。"""
    env_bin = os.environ.get("ENGLISH_CLAUDE")
    if env_bin:
        return env_bin
    found = shutil.which("claude")
    if found:
        return found
    candidates = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin/claude")))
    return candidates[-1] if candidates else None


def _run_claude(prompt):
    """claude -p を 1 回だけ呼び、(rc, stdout) を返す。起動不能/タイムアウトは rc=-1
    (rc≠0 として fallback に確定させる。ここでリトライしない)。テストはこの関数を差し替える。"""
    bin_path = _resolve_claude()
    if bin_path is None:
        common.log("claude バイナリが見つからない")
        return -1, ""
    try:
        p = subprocess.run(
            [bin_path, "-p", prompt, "--output-format", "json"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            timeout=CLAUDE_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        common.log("claude -p 実行失敗: %s" % exc)
        return -1, ""
    if p.returncode != 0:
        common.log("claude -p rc=%d stderr(tail): %s"
                   % (p.returncode, (p.stderr or "").strip()[-200:]))
    return p.returncode, p.stdout


def build_prompt(stats):
    return PROMPT_TEMPLATE.format(
        days=stats["window_days"],
        stats_json=json.dumps(stats, ensure_ascii=False),
    )


def _strip_code_fence(text):
    """モデルがコードフェンス付きで返した場合の防御 (ytcheck ai_evaluator と同型)。"""
    stripped = text.strip()
    m = _FENCE_RE.match(stripped)
    return m.group(1) if m else stripped


def validate_output(data):
    """LLM 本文 JSON を §3.4 の契約スキーマに対して検証し、(report_md, weights) を返す。
    NG は None (呼び出し側が fallback に確定)。ペアキーはソート済み "|" 連結に正規化する
    (未ソートは型不正ではないため正規化して受ける。"|" が 1 個でない/空要素は型不正 = NG)。"""
    if not isinstance(data, dict):
        return None
    report = data.get("report_md")
    weights = data.get("weights")
    if not isinstance(report, str) or not report.strip():
        return None
    if not isinstance(weights, dict):
        return None
    tags = weights.get("feature_tags")
    pairs = weights.get("pairs")
    if not isinstance(tags, dict) or not isinstance(pairs, dict):
        return None

    def _valid_weight(v):
        return (not isinstance(v, bool) and isinstance(v, (int, float))
                and math.isfinite(v) and v > 0)

    def _clamp(v):
        # プロンプト指示レンジ (0.5〜3.0) を検証側でも強制。範囲逸脱は NG でなく
        # クランプで受ける (極端値 1 つで analysis 全体を fallback に落とさない)
        return min(3.0, max(0.5, float(v)))

    norm_tags = {}
    for k, v in tags.items():
        if not isinstance(k, str) or not k or not _valid_weight(v):
            return None
        norm_tags[k] = _clamp(v)
    norm_pairs = {}
    for k, v in pairs.items():
        if not isinstance(k, str) or not _valid_weight(v):
            return None
        parts = [p.strip() for p in k.split("|")]
        if len(parts) != 2 or not parts[0] or not parts[1]:
            return None
        norm_pairs["|".join(sorted(parts))] = _clamp(v)
    return report.strip(), {"feature_tags": norm_tags, "pairs": norm_pairs}


def llm_analyze(stats):
    """claude -p 経路。成功時 (report_md, weights)、失敗はすべて None (fallback 確定)。
    判定は rc → envelope → 本文 JSON → スキーマ の各 1 回のみで、リトライしない。"""
    rc, stdout = _run_claude(build_prompt(stats))
    if rc != 0:
        return None
    try:
        envelope = json.loads(stdout)
    except ValueError:
        common.log("claude -p エンベロープが JSON でない -> fallback")
        return None
    result = envelope.get("result") if isinstance(envelope, dict) else None
    if not isinstance(result, str):
        common.log("claude -p エンベロープに result 文字列がない -> fallback")
        return None
    try:
        data = json.loads(_strip_code_fence(result))
    except ValueError:
        common.log("claude -p 本文が JSON でない -> fallback")
        return None
    validated = validate_output(data)
    if validated is None:
        common.log("claude -p 出力がスキーマ検証 NG -> fallback")
        return None
    return validated


# ---- ルールベースフォールバック ----------------------------------------------

def fallback_analyze(stats):
    """feature_tag 別誤答率の単純集計から weights を算出し、report_md は定型文 (§3.4)。
    混同ペアの洞察は LLM の付加価値に限定するため pairs は常に空。"""
    tag_weights = {}
    weak_parts = []
    for tag, st in sorted(stats["feature_tag_stats"].items()):
        if st["total"] <= 0 or st["wrong"] <= 0:
            continue
        rate = st["wrong"] / st["total"]
        tag_weights[tag] = round(1.0 + rate, 2)
        weak_parts.append("%s (誤答率 %d%%)" % (tag, round(rate * 100)))
    total = stats["blank_total"]
    correct = stats["blank_correct"]
    pct = round(correct / total * 100) if total else 0
    head = "直近%d日の正答率 %d%% (%d/%d)。" % (stats["window_days"], pct, correct, total)
    if weak_parts:
        report = head + "よく落とす特徴: " + "、".join(weak_parts) + "。"
    else:
        report = head + "よく落とす特徴はありません。この調子で続けましょう。"
    return report, {"feature_tags": tag_weights, "pairs": {}}


# ---- 保存・エントリポイント ---------------------------------------------------

def save_analysis(conn, date_str, report_md, weights, source):
    conn.execute(
        "INSERT OR REPLACE INTO analysis (date, report_md, weights, source) VALUES (?, ?, ?, ?)",
        (date_str, report_md, json.dumps(weights, ensure_ascii=False), source),
    )
    conn.commit()


def analyze(conn, date_str=None, force_fallback=False):
    """1 日 1 回の分析本体。書いた source ("llm"/"fallback") を返す。
    窓内に attempts が無ければ何も書かず None を返す。"""
    date_str = date_str or drill.jst_today_str()
    stats = collect_stats(conn, date_str)
    if stats["attempts"] == 0:
        common.log("analyze %s: 窓内 (%s..%s) に attempts なし、何も書かない"
                   % (date_str, stats["since"], stats["until"]))
        return None
    result = None if force_fallback else llm_analyze(stats)
    if result is not None:
        source = "llm"
        report_md, weights = result
    else:
        source = "fallback"
        report_md, weights = fallback_analyze(stats)
    save_analysis(conn, date_str, report_md, weights, source)
    common.log("analyze %s: source=%s attempts=%d blanks=%d/%d weights: tags=%d pairs=%d"
               % (date_str, source, stats["attempts"], stats["blank_correct"],
                  stats["blank_total"], len(weights["feature_tags"]), len(weights["pairs"])))
    return source


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None, help="DB パス (既定: data/english.db、テスト用に上書き可)")
    parser.add_argument("--date", default=None, metavar="YYYY-MM-DD",
                        help="分析対象日 (既定: JST 今日。窓はこの日を右端とする 14 日間)")
    parser.add_argument("--fallback", action="store_true",
                        help="claude -p を呼ばずルールベース fallback を強制する")
    args = parser.parse_args(argv)
    conn = common.open_db(args.db)
    try:
        analyze(conn, date_str=args.date, force_fallback=args.fallback)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
