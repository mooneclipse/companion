#!/usr/bin/env python3
"""proactive の種にする「相手の一日」実活動ヒントの収集 (チケット #94)。

Python stdlib のみで動く。proactive-companion.sh から発火確定後に 1 回だけ
呼ばれ、当日 (JST) の既存機械出力から短いヒントを集めて JSON 1 行を stdout に
出す。関心 index の材料を「OWNER の会話・ノート中心」から「相手の一日中心」へ
広げるための供給源 (§F 境界内 = すべて実活動由来の機械出力、でっち上げない)。

呼び出し:
    python3 activity_hints.py

出力 JSON 形式 (1 行):
    {"activity_hint": "行1\n行2", "activity_type": "ytcheck"}
    ヒントが 1 つも取れなければ {} (空 dict)。

フィールドの責務 (bot 側 bot.py と対で維持):
- activity_hint: prompt 展開用の機械生成文 (改行区切り、供給源ごとに 1 行)。
  中身に YouTube タイトル等の外部由来文字列を含むが、出どころは ytcheck が
  既に claude 評価 prompt に流している機械出力レポート = morning_hint の
  NHK RSS 見出しと同じ「外部機械テキスト」区分 (ユーザー由来の自由文ではない)。
- activity_type: 関心 index の topic にする bounded な短い文字列
  (供給源リスト内で定義した固定ラベル、自由文はここに入れない)。

責務境界:
- 供給源ごとに独立 fail-safe: 読めない / 当日分なし / parse 不能はその供給源を
  黙って落とす (行を出さないだけ、リトライ・フォールバック分岐は作らない)。
  全滅なら {} を出して rc 0 (「ヒントなし」は正常な 1 状態)。
- state は読むだけで書かない。発火判定にも関与しない (判定は sh 側 step1-7)。
- 供給源を足すときはこのファイルの _collect_* 関数 + SOURCES に足す
  (sh 側・bot 側は activity_hint/activity_type の 2 フィールド固定で無改変)。

env override (sandbox でのドライラン検証用。本番 = 未設定で既定パス):
    ACTIVITY_YTCHECK_DIR   ytcheck レポートディレクトリ
    ACTIVITY_ENGLISH_DB    english の SQLite DB パス
    ACTIVITY_TODAY         当日扱いする日付 (YYYY-MM-DD、JST 既定)
"""

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

_JST = timezone(timedelta(hours=9))

_YTCHECK_DIR = Path(
    os.environ.get("ACTIVITY_YTCHECK_DIR")
    or Path.home() / "companion" / "vault" / "notes" / "ytcheck"
)
_ENGLISH_DB = Path(
    os.environ.get("ACTIVITY_ENGLISH_DB")
    or Path.home() / "companion" / "english" / "data" / "english.db"
)

# レポートの動画エントリ行 (output_formatter._format_video_entry):
#   "1. **[タイトル](URL)** - スコア: ..." / "- **[タイトル](URL)** - ..."
_YTCHECK_ENTRY_RE = re.compile(r"^(?:\d+\.|-) \*\*\[(.+?)\]\(")

_TITLE_MAX_CHARS = 60


def _today_jst() -> str:
    override = os.environ.get("ACTIVITY_TODAY", "").strip()
    if override:
        return override
    return datetime.now(_JST).strftime("%Y-%m-%d")


def collect_ytcheck(today: str) -> str | None:
    """当日の ytcheck レポートから推薦タイトルのヒント 1 行を返す。

    当日レポート (ytcheck-YYYYMMDD-N.md、N 最大 = 最新) の動画エントリ行から
    タイトルを重複排除で拾い、先頭 2 件 (= 👑 ベスト → 🔥 見逃し厳禁 の順) +
    総数で 1 行にする。当日分なし / エントリ 0 件なら None。
    """
    date_compact = today.replace("-", "")

    # レポート番号 N は数値で比較する (辞書順だと -9 が -10 より後になり
    # N>=10 の日に最新を取り違える)。
    def _report_num(p: Path) -> int:
        m = re.search(r"-(\d+)\.md$", p.name)
        return int(m.group(1)) if m else 0

    reports = sorted(
        _YTCHECK_DIR.glob(f"ytcheck-{date_compact}-*.md"), key=_report_num
    )
    if not reports:
        return None
    text = reports[-1].read_text(encoding="utf-8")
    titles: list[str] = []
    for line in text.splitlines():
        m = _YTCHECK_ENTRY_RE.match(line)
        if not m:
            continue
        title = m.group(1).strip()[:_TITLE_MAX_CHARS]
        if title and title not in titles:
            titles.append(title)
    if not titles:
        return None
    samples = "」「".join(titles[:2])
    return (
        f"今日の YouTube 巡回レポートにおすすめ動画が {len(titles)} 本"
        f" (「{samples}」など)"
    )


def collect_english(today: str) -> str | None:
    """english.db の当日 attempts 件数から学習ヒント 1 行を返す。0 件なら None。

    DB は WAL モードだが read-only の軽い COUNT 1 発なので server と競合しない。
    """
    if not _ENGLISH_DB.exists():
        return None
    con = sqlite3.connect(f"file:{_ENGLISH_DB}?mode=ro", uri=True)
    try:
        n = con.execute(
            "SELECT COUNT(*) FROM attempts"
            " WHERE date(ts, 'unixepoch', '+9 hours') = ?",
            (today,),
        ).fetchone()[0]
    finally:
        con.close()
    if not n:
        return None
    return f"ユーザーは今日、英語のディクテーション練習を {n} 問やっている"


# 供給源リスト: (activity_type ラベル, 収集関数)。足すときはここに 1 行 +
# collect 関数 1 本 (sh 側・bot 側の payload 配線は無改変)。activity_type は
# 先頭の取れた供給源のものを使う (関心 index の topic になる固定ラベル)。
# ラベルを変更・追加したら bot/interests.py の _CATEGORY_LABEL_TOPICS も同期する
# (カテゴリ名を investigate/ticket 対象から外すための対応リスト)。
SOURCES = [
    ("ytcheck 巡回のおすすめ", collect_ytcheck),
    ("英語ディクテーション", collect_english),
]


def main() -> None:
    today = _today_jst()
    lines: list[str] = []
    activity_type = ""
    for label, collector in SOURCES:
        try:
            hint = collector(today)
        except Exception:
            # 供給源単位の fail-safe: 読めない/壊れているはその供給源を落とすだけ。
            hint = None
        if hint:
            lines.append(hint)
            if not activity_type:
                activity_type = label
    if lines:
        obj = {"activity_hint": "\n".join(lines), "activity_type": activity_type}
    else:
        obj = {}
    print(json.dumps(obj, ensure_ascii=False))


if __name__ == "__main__":
    main()
