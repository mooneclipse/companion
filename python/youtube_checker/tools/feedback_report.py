"""
視聴フィードバックの月次集計スクリプト（3-2 / 3-3）

`tasks/viewing-YYYY-MM.md` をパースして以下を出力する:
- 見た(✔) / 当たり(○) / 外れ(×) の集計
- 「score>=8（見逃し厳禁帯）なのに未視聴」の一覧（閾値・プロンプト調整の根拠）
- 「score<=6（スキップ帯）なのに当たり(○)」の一覧（同上）
- 直近3ヶ月の視聴実績に基づく推し度補正の提案（3-3。提案のみ、JSON は書き換えない）

使い方:
    python tools/feedback_report.py                 # 当月を集計
    python tools/feedback_report.py --month 2026-06 # 対象月を指定

viewing ファイルの記法:
    - `- [x]` = 見た（チェックボックス）
    - 行末 `[feedback: ○]` = 当たり / `[feedback: ×]` = 外れ
    - feedback 欄の無い過去月の行も後方互換でパースできる

注意: config.py には依存しない（環境変数不要で単体実行できるようにするため）。
"""
import argparse
import io
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

# プロジェクトルート（tools/ -> youtube_checker/ -> python/ -> ルート）
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
# viewing 履歴の置き場は環境変数で上書き可（Obsidian vault 連携用）。
# チャンネルリストはリポジトリ内 tasks/ 固定
_TASKS_DIR = Path(os.environ.get("YTCHECK_VIEWING_DIR", _PROJECT_ROOT / "tasks"))
_CHANNEL_LIST_PATH = _PROJECT_ROOT / "tasks" / "youtube-channels.json"

# 「見逃し厳禁」帯（レポートの must_watch と同じ境界）
MUST_WATCH_SCORE = 8
# 「スキップ帯」の上限（標準推薦閾値 7 未満 = 6 以下）
SKIP_BAND_MAX_SCORE = 6
# 3-3: 推し度補正提案で参照する月数（対象月を含む直近3ヶ月）
LOOKBACK_MONTHS = 3
# 3-3: 外れ連発警告の閾値（×がこの数以上 かつ ○ゼロ）
MISS_STREAK_THRESHOLD = 2

# 動画行のパース用正規表現
# チェックボックスとタイトルは行頭固定、メタデータは [key: value] 形式
_LINE_RE = re.compile(r"^- \[(?P<checked>[ xX])\] ")
_VIDEO_ID_RE = re.compile(r"\[video_id:\s*([^\]]+)\]")
_SCORE_RE = re.compile(r"\[score:\s*(\d+)/10\]")
# feedback 欄は行末にある想定（reason 内の角括弧との誤マッチを避ける）
_FEEDBACK_RE = re.compile(r"\[feedback:\s*([^\]]*)\]\s*$")
_SECTION_RE = re.compile(r"^## \[(?P<channel>.+)\]\s*$")


@dataclass
class ViewingEntry:
    """viewing ファイルの動画1行分"""
    channel: str
    video_id: str
    score: int
    checked: bool        # チェックボックスが [x]
    feedback: str        # feedback 欄の中身（○ / × / 空。欄なしは空）
    line: str            # 元の行（レポート表示用）

    @property
    def watched(self) -> bool:
        """視聴済みか（チェックボックス or feedback 記入のいずれかで判定）"""
        return self.checked or bool(self.feedback)

    @property
    def is_hit(self) -> bool:
        """当たり（○）か"""
        return "○" in self.feedback or "◯" in self.feedback

    @property
    def is_miss(self) -> bool:
        """外れ（×）か"""
        return "×" in self.feedback or "x" in self.feedback.lower()


def parse_viewing_text(text: str) -> list[ViewingEntry]:
    """
    viewing ファイルのテキストから動画エントリを抽出する

    feedback 欄の無い行（過去月のフォーマット）も後方互換でパースする
    （その場合 feedback は空文字列になる）。
    """
    entries: list[ViewingEntry] = []
    current_channel = "不明"

    for line in text.splitlines():
        section_match = _SECTION_RE.match(line)
        if section_match:
            current_channel = section_match.group("channel")
            continue

        line_match = _LINE_RE.match(line)
        if not line_match:
            continue

        video_id_match = _VIDEO_ID_RE.search(line)
        if not video_id_match:
            # video_id の無い箇条書きは動画行ではない
            continue

        score_match = _SCORE_RE.search(line)
        score = int(score_match.group(1)) if score_match else 0

        feedback_match = _FEEDBACK_RE.search(line)
        feedback = feedback_match.group(1).strip() if feedback_match else ""

        entries.append(ViewingEntry(
            channel=current_channel,
            video_id=video_id_match.group(1).strip(),
            score=score,
            checked=line_match.group("checked").lower() == "x",
            feedback=feedback,
            line=line.strip(),
        ))

    return entries


def _shift_month(month: str, offset: int) -> str:
    """YYYY-MM 形式の月を offset ヶ月ずらす（offset は負で過去）"""
    dt = datetime.strptime(month, "%Y-%m")
    total = dt.year * 12 + (dt.month - 1) + offset
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def load_viewing_entries(tasks_dir: Path, month: str) -> list[ViewingEntry]:
    """対象月の viewing ファイルを読み込む（存在しなければ空リスト）"""
    path = tasks_dir / f"viewing-{month}.md"
    if not path.exists():
        return []
    return parse_viewing_text(path.read_text(encoding="utf-8"))


def load_channel_favorites(channel_list_path: Path) -> dict[str, int]:
    """
    チャンネルリスト JSON から {チャンネル名: favorite} を読み込む

    ファイルが無い・壊れている場合は空 dict
    （3-3 の提案が favorite 不明表示になるだけで集計は継続できる）。
    """
    try:
        with open(channel_list_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    channels: list[dict[str, Any]] = data.get("channels", [])
    return {
        ch["name"]: ch.get("favorite", 3)
        for ch in channels
        if ch.get("name")
    }


@dataclass
class MonthlySummary:
    """対象月の集計結果"""
    month: str
    total: int = 0
    watched: int = 0
    hits: int = 0
    misses: int = 0
    unwatched_must_watch: list[ViewingEntry] = field(default_factory=list)
    hit_in_skip_band: list[ViewingEntry] = field(default_factory=list)


def summarize_month(month: str, entries: list[ViewingEntry]) -> MonthlySummary:
    """対象月のエントリを集計する（3-2）"""
    summary = MonthlySummary(month=month, total=len(entries))
    for e in entries:
        if e.watched:
            summary.watched += 1
        if e.is_hit:
            summary.hits += 1
        elif e.is_miss:
            summary.misses += 1

        # 「見逃し厳禁帯なのに見なかった」（閾値・プロンプトが甘い可能性）
        if e.score >= MUST_WATCH_SCORE and not e.watched:
            summary.unwatched_must_watch.append(e)
        # 「スキップ帯なのに面白かった」（閾値・プロンプトが辛い可能性）
        if e.score <= SKIP_BAND_MAX_SCORE and e.is_hit:
            summary.hit_in_skip_band.append(e)

    return summary


def build_favorite_proposals(
    recent_entries: list[ViewingEntry],
    favorites: dict[str, int],
) -> list[str]:
    """
    直近数ヶ月の視聴実績から推し度補正の提案を作る（3-3）

    - 視聴実績ゼロのチャンネル → favorite-1 を提案（favorite 1 は除外）
    - 外れ連発（× が閾値以上 かつ ○ ゼロ）のチャンネル → 警告

    提案のみで、channels JSON の自動書き換えは行わない（確定済み設計判断）。
    """
    per_channel: dict[str, dict[str, int]] = {}
    for e in recent_entries:
        stats = per_channel.setdefault(
            e.channel, {"total": 0, "watched": 0, "hits": 0, "misses": 0}
        )
        stats["total"] += 1
        if e.watched:
            stats["watched"] += 1
        if e.is_hit:
            stats["hits"] += 1
        elif e.is_miss:
            stats["misses"] += 1

    proposals: list[str] = []
    for channel, stats in sorted(per_channel.items()):
        favorite = favorites.get(channel)
        fav_disp = f"favorite {favorite}" if favorite is not None else "favorite 不明"

        # 視聴実績ゼロ → favorite-1 提案（favorite 1 はこれ以上下げない）
        if stats["watched"] == 0 and (favorite is None or favorite >= 2):
            new_fav = f" → {favorite - 1}" if favorite is not None else ""
            proposals.append(
                f"[提案] {channel}（{fav_disp}{new_fav}）: "
                f"直近{LOOKBACK_MONTHS}ヶ月視聴実績なし（{stats['total']}本掲載）。"
                f"favorite を 1 下げることを検討"
            )

        # 外れ連発 → 警告
        if stats["misses"] >= MISS_STREAK_THRESHOLD and stats["hits"] == 0:
            proposals.append(
                f"[警告] {channel}（{fav_disp}）: "
                f"外れ連発（× {stats['misses']}本 / ○ 0本）。"
                f"閾値または favorite の見直しを検討"
            )

    return proposals


def build_report(
    month: str,
    tasks_dir: Path = _TASKS_DIR,
    channel_list_path: Path = _CHANNEL_LIST_PATH,
) -> str:
    """月次フィードバックレポートのテキストを組み立てる"""
    entries = load_viewing_entries(tasks_dir, month)
    summary = summarize_month(month, entries)

    lines: list[str] = []
    lines.append(f"# 視聴フィードバック月次集計 ({month})")
    lines.append("")
    lines.append(f"- 掲載動画数: {summary.total}")
    lines.append(f"- 見た(✔): {summary.watched}")
    lines.append(f"- 当たり(○): {summary.hits}")
    lines.append(f"- 外れ(×): {summary.misses}")
    lines.append("")

    lines.append(f"## 見逃し厳禁帯（score>={MUST_WATCH_SCORE}）なのに未視聴")
    lines.append("")
    if summary.unwatched_must_watch:
        for e in summary.unwatched_must_watch:
            lines.append(f"- {e.line}")
    else:
        lines.append("なし")
    lines.append("")

    lines.append(f"## スキップ帯（score<={SKIP_BAND_MAX_SCORE}）なのに当たり(○)")
    lines.append("")
    if summary.hit_in_skip_band:
        for e in summary.hit_in_skip_band:
            lines.append(f"- {e.line}")
    else:
        lines.append("なし")
    lines.append("")

    # 3-3: 直近3ヶ月（対象月を含む）の視聴実績から推し度補正を提案
    recent_entries: list[ViewingEntry] = []
    for offset in range(LOOKBACK_MONTHS):
        recent_entries.extend(
            load_viewing_entries(tasks_dir, _shift_month(month, -offset))
        )
    favorites = load_channel_favorites(channel_list_path)
    proposals = build_favorite_proposals(recent_entries, favorites)

    lines.append(f"## 推し度補正の提案（直近{LOOKBACK_MONTHS}ヶ月・提案のみ）")
    lines.append("")
    if proposals:
        lines.extend(proposals)
    else:
        lines.append("なし")
    lines.append("")
    lines.append("※ 提案は参考情報。channels JSON の書き換えは手動で行うこと。")

    return "\n".join(lines)


def main() -> None:
    """エントリポイント"""
    # Windows コンソール（cp932）でも ✔ / ○ / × を出力できるよう UTF-8 に切り替える
    # （main.py と同じ対応）
    if sys.platform == "win32":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    parser = argparse.ArgumentParser(description="視聴フィードバックの月次集計")
    parser.add_argument(
        "--month",
        default=None,
        help="対象月（YYYY-MM 形式。省略時は当月）",
    )
    args = parser.parse_args()

    month = args.month or datetime.now().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        parser.error(f"--month は YYYY-MM 形式で指定してください: {month}")

    print(build_report(month))


if __name__ == "__main__":
    main()
