"""
出力フォーマッタ（JSON / Markdown / viewing履歴）
ジャンル別レポート生成・好き度閾値判定に対応
"""
import fcntl
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from config import settings
from models import RunStats
from title_normalizer import extract_series_prefix

# プロジェクトルート
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
# 出力先は環境変数で上書き可（Obsidian vault 連携用。未設定ならリポジトリ相対）
_WRITING_DIR = Path(os.environ.get("YTCHECK_WRITING_DIR", _PROJECT_ROOT / "writing"))
_TASKS_DIR = Path(os.environ.get("YTCHECK_VIEWING_DIR", _PROJECT_ROOT / "tasks"))


class EnhancedJSONEncoder(json.JSONEncoder):
    """
    datetimeなどをJSONシリアライズ可能にするエンコーダ
    """
    def default(self, o: Any) -> Any:
        if hasattr(o, "model_dump"):
            return o.model_dump(mode="json")
        if hasattr(o, "isoformat"):
            return o.isoformat()
        return super().default(o)


def is_recommended(video: dict[str, Any], favorite: int, threshold_map: dict[int, int]) -> bool:
    """
    好き度に応じた閾値で推薦判定する

    Args:
        video: 動画情報の辞書
        favorite: チャンネルの好き度（1-5）
        threshold_map: 好き度 -> 推薦閾値のマッピング

    Returns:
        推薦対象かどうか
    """
    threshold = threshold_map.get(favorite, 7)  # デフォルト7
    return video.get("score", 0) >= threshold


def is_small_channel_pickup(
    video_dict: dict[str, Any],
    favorite: int,
    small_threshold_map: dict[int, int],
    base_threshold_map: dict[int, int],
) -> bool:
    """
    SMALL 層チャンネルの動画が「拾い物候補」に該当するかを判定する

    拾い物候補の条件（設計書 §3 と整合）:
        1. ``tier == "small"``
        2. ``score >= small_threshold_map[favorite]``（SMALL 用甘め閾値）
        3. 既存推薦（base_threshold_map）には含まれない（重複回避）

    既存推薦に既に該当する場合は False を返し、既存「見逃し厳禁 / 時間があれば」
    セクションに倒す（重複表示しない）。スコア 8 以上は無条件で「見逃し厳禁」扱いに
    なるため、ここでも同条件で除外する。

    Args:
        video_dict: 動画情報の辞書（tier, score, favorite を含む想定）
        favorite: チャンネルの好き度（1-5）
        small_threshold_map: SMALL 層用 好き度 -> 推薦閾値マップ
        base_threshold_map: 既存（標準）の好き度 -> 推薦閾値マップ

    Returns:
        拾い物候補に該当するなら True、しないなら False
    """
    if video_dict.get("tier") != "small":
        return False

    score = video_dict.get("score", 0)
    # SMALL 閾値マップに該当好き度がなければ標準デフォルト 7 をフォールバック
    small_threshold = small_threshold_map.get(favorite, 7)
    if score < small_threshold:
        return False

    # スコア 8 以上は「見逃し厳禁」へ倒すため拾い物候補から除外
    if score >= 8:
        return False

    # 既存推薦（好き度閾値クリア）に該当する場合は既存セクションに倒す
    if is_recommended(video_dict, favorite, base_threshold_map):
        return False

    return True


def _format_subscriber_count(subscriber_count: int | None) -> str:
    """
    登録者数を人間に優しい丸め表記にする

    Args:
        subscriber_count: 登録者数。None は「非公開/未取得」を意味する

    Returns:
        例: 8500 → ``"~8.5K"`` / 12000 → ``"~12K"`` / 1500000 → ``"~1.5M"`` /
        None → ``"非公開"``
    """
    if subscriber_count is None:
        return "非公開"
    if subscriber_count < 1000:
        return f"~{subscriber_count}"
    if subscriber_count < 10_000:
        # 1,000〜9,999 は小数1桁の K 表記（8500 → ~8.5K）
        return f"~{subscriber_count / 1000:.1f}K"
    if subscriber_count < 1_000_000:
        # 10,000〜999,999 は整数 K 表記（12000 → ~12K）
        return f"~{subscriber_count // 1000}K"
    if subscriber_count < 10_000_000:
        return f"~{subscriber_count / 1_000_000:.1f}M"
    return f"~{subscriber_count // 1_000_000}M"


def _get_favorite_label(favorite: int) -> str:
    """
    好き度に応じたラベル（神/推し/通常/興味薄）を返す。

    v2 以降は全セクションで必ず4種のいずれかを返す（空文字を返さない）。

    Args:
        favorite: 好き度（1-5）

    Returns:
        ラベル文字列（神/推し/通常/興味薄 のいずれか）
    """
    labels = {1: "興味薄", 2: "興味薄", 3: "通常", 4: "推し", 5: "神"}
    return labels.get(favorite, "通常")


def _is_boosted_recommendation(score: int, favorite: int, threshold_map: dict[int, int]) -> bool:
    """
    好き度補正による推薦かどうかを判定する
    （スコア7未満だが好き度閾値で推薦された場合）

    Args:
        score: 動画のスコア
        favorite: チャンネルの好き度
        threshold_map: 好き度 -> 推薦閾値のマッピング

    Returns:
        好き度補正による推薦かどうか
    """
    base_threshold = settings.BASE_RECOMMEND_THRESHOLD  # 設定値から標準閾値を取得
    channel_threshold = threshold_map.get(favorite, base_threshold)
    return score < base_threshold and score >= channel_threshold


def _format_timestamp_link(video_id: str, seconds: int) -> str:
    """
    見どころタイムスタンプの Markdown リンクを生成する（AC7）

    クリックすると該当時刻から再生される `&t=NNNNs` 形式の URL を使う。

    Args:
        video_id: YouTube動画ID
        seconds: ジャンプ先の開始秒

    Returns:
        例: ``[▶ 0:12:34](https://www.youtube.com/watch?v=abc&t=754s)``
    """
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return (
        f"[▶ {h}:{m:02d}:{s:02d}]"
        f"(https://www.youtube.com/watch?v={video_id}&t={seconds}s)"
    )


def is_buzzing(
    published_at: str,
    view_count: int | None,
    subscriber_count: int | None,
    now: datetime | None = None,
    view_ratio: float | None = None,
    window_hours: int | None = None,
) -> bool:
    """
    「🚀 伸びてる」バッジ（バズ検知）の判定を行う

    published_at から window_hours 時間以内 かつ
    view_count / subscriber_count >= view_ratio の場合に True。
    推し度が低いチャンネルでも「今バズってる回」を拾うためのバッジ表示専用で、
    スコアへの加点はしない。

    Args:
        published_at: 動画の公開日時（ISO 8601 文字列。naive は UTC とみなす）
        view_count: 取得時点の再生数（未取得 None は False）
        subscriber_count: 登録者数（非公開・未取得 None / 0 以下はゼロ除算防御で False）
        now: 判定基準時刻。省略時は現在時刻（UTC）。テスト用に注入可能
        view_ratio: 再生数/登録者数 比の閾値。省略時は settings.BUZZ_VIEW_RATIO
        window_hours: 投稿からの経過時間の窓。省略時は settings.BUZZ_WINDOW_HOURS
    """
    # None / 0 防御（登録者数 0 以下はゼロ除算になるため False に倒す）
    if view_count is None or subscriber_count is None or subscriber_count <= 0:
        return False

    if not published_at:
        return False
    try:
        published = datetime.fromisoformat(str(published_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)

    effective_now = now if now is not None else datetime.now(timezone.utc)
    if effective_now.tzinfo is None:
        effective_now = effective_now.replace(tzinfo=timezone.utc)

    effective_window = (
        window_hours if window_hours is not None else settings.BUZZ_WINDOW_HOURS
    )
    elapsed = effective_now - published
    # 未来の published_at（時計ずれ等）と窓超えは対象外
    if elapsed < timedelta(0) or elapsed > timedelta(hours=effective_window):
        return False

    effective_ratio = view_ratio if view_ratio is not None else settings.BUZZ_VIEW_RATIO
    return view_count / subscriber_count >= effective_ratio


def _get_next_report_number(date_str: str) -> int:
    """
    同日のレポート連番を取得する

    Args:
        date_str: YYYYMMDD形式の日付文字列

    Returns:
        次の連番（1始まり）
    """
    existing = list(_WRITING_DIR.glob(f"ytcheck-{date_str}-*.md"))
    if not existing:
        return 1
    numbers: list[int] = []
    for p in existing:
        match = re.search(r"-(\d+)\.md$", p.name)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def format_markdown_report(
    genres: dict[str, str],
    all_results: list[dict[str, Any]],
    run_stats: RunStats | None = None,
) -> tuple[str, str]:
    """
    ジャンル別にセクション分けしたMarkdownレポートを生成する

    Args:
        genres: ジャンルID -> 表示名のマッピング
        all_results: run_all_channels() の戻り値（各要素にgenre, favoriteが含まれる）
        run_stats: 実行統計。指定時はレポート末尾に「実行サマリー」セクションを追加する
            （省略時は従来どおりのレポート・後方互換）

    Returns:
        (markdown_text, output_path) のタプル
    """
    now = datetime.now()
    date_str = now.strftime("%Y%m%d")
    date_display = now.strftime("%Y-%m-%d")
    report_num = _get_next_report_number(date_str)
    threshold_map = settings.FAVORITE_THRESHOLD_MAP
    small_threshold_map = settings.SMALL_CHANNEL_THRESHOLD_MAP

    # 全動画をフラットに収集（チャンネル情報付き）
    all_videos: list[dict[str, Any]] = []
    channel_count = len(all_results)
    subtitle_success = 0
    subtitle_fail = 0
    # 層別チャンネル数（hidden / 未取得は SMALL 扱いに倒される、main.py の determine_tier で解決済み）
    tier_channel_counts: dict[str, int] = {"small": 0, "mid": 0, "large": 0}

    for ch_result in all_results:
        channel_name = ch_result.get("channel_name", "不明")
        channel_id = ch_result.get("channel_id", "")
        genre = ch_result.get("genre", "indie")
        favorite = ch_result.get("favorite", 3)
        # 後方互換: tier 欠落チャンネル（未改修系）は small 扱いに倒す
        tier = ch_result.get("tier", "small")
        subscriber_count = ch_result.get("subscriber_count")
        if tier in tier_channel_counts:
            tier_channel_counts[tier] += 1
        else:
            tier_channel_counts["small"] += 1

        for v in ch_result.get("videos", []):
            video_info = v.get("video", {})
            entry = {
                "title": video_info.get("title", "不明"),
                "url": video_info.get("url", ""),
                "video_id": video_info.get("video_id", ""),
                "published_at": video_info.get("published_at", ""),
                "channel_name": channel_name,
                "channel_id": channel_id,
                "genre": genre,
                "favorite": favorite,
                "score": v.get("score", 0),
                "reason": v.get("reason", ""),
                "has_subtitles": v.get("has_subtitles", False),
                "error": v.get("error"),
                "ai_genre": v.get("genre", ""),        # AIが推定した配信ジャンル
                "highlights": v.get("highlights", []), # 盛り上がりポイント
                # tier 情報は EvaluationResult 側にも入っているが、チャンネルレベルの値を優先
                "tier": v.get("tier") or tier,
                "subscriber_count": v.get("subscriber_count") if v.get("subscriber_count") is not None else subscriber_count,
                # v2 拡張フィールド（評価対象外フィルタ・畳み込み・タイブレーカー・スコア0分類用）
                "is_excluded": v.get("is_excluded", False),
                "exclude_reason": v.get("exclude_reason", ""),
                "series_key": v.get("series_key"),
                "collab_key": v.get("collab_key"),
                "laugh_signal_count": v.get("laugh_signal_count", 0),
                "surprise_signal_count": v.get("surprise_signal_count", 0),
                "duration_minutes": v.get("duration_minutes"),
                "score_zero_reason": v.get("score_zero_reason"),
                # 見どころタイムスタンプ（開始秒、4-1）とバズ検知用の再生数（4-3）
                "highlight_seconds": v.get("highlight_seconds", []),
                "view_count": video_info.get("view_count"),
            }
            all_videos.append(entry)
            if entry["has_subtitles"]:
                subtitle_success += 1
            else:
                subtitle_fail += 1

    total_videos = len(all_videos)
    scores = [v["score"] for v in all_videos if v["has_subtitles"]]
    avg_score = sum(scores) / len(scores) if scores else 0.0

    # === D-1: シリーズ連番畳み込み（HIGH-3） ===
    # パス1: series_key（明示的な連番マーカー）ベースのグルーピング
    # パス2: 同チャンネル + 共通プレフィックス + 投稿日 7 日以内 のフォールバック
    series_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for v in all_videos:
        if v.get("is_excluded"):
            continue
        key = v.get("series_key")
        if key:
            series_groups[key].append(v)

    # パス2: プレフィックスフォールバック候補（series_key 未使用 かつ is_excluded でない）
    prefix_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for v in all_videos:
        if v.get("is_excluded"):
            continue
        if v.get("series_key"):
            continue
        prefix = extract_series_prefix(v.get("title", ""))
        if not prefix:
            continue
        ch_id = v.get("channel_id", "")
        prefix_groups[f"{ch_id}::prefix::{prefix}"].append(v)

    def _parse_published(s: str) -> datetime | None:
        """published_at 文字列を datetime にパースする（不正値は None）"""
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    representative_ids: set[str] = set()
    # プレフィックスパスで代表落ちした video_id（コラボ畳み込みから除外する）
    prefix_non_rep_ids: set[str] = set()
    series_folded_count = 0

    def _fold_series_group(group: list[dict[str, Any]], note_template: str) -> None:
        """シリーズグループから代表を選出し reason に他話注記を追加する"""
        nonlocal series_folded_count
        group.sort(key=lambda x: (
            -x["score"],
            -(x.get("laugh_signal_count", 0) + x.get("surprise_signal_count", 0)),
            x.get("published_at", ""),
        ))
        rep = group[0]
        representative_ids.add(rep["video_id"])
        series_folded_count += len(group) - 1
        other_titles = [g["title"] for g in group[1:]]
        note = note_template.format(others=", ".join(other_titles))
        rep["reason"] = (rep.get("reason", "") + " " + note).strip()

    # パス1: series_key ベース
    for key, group in series_groups.items():
        if len(group) <= 1:
            if group:
                representative_ids.add(group[0]["video_id"])
            continue
        _fold_series_group(
            group,
            "（このシリーズの他話: {others} も同期間配信）",
        )

    # パス2: プレフィックスベース（投稿日範囲 ≤ 7 日 のみ採用）
    for key, group in prefix_groups.items():
        if len(group) < 2:
            if group:
                representative_ids.add(group[0]["video_id"])
            continue
        dates = [_parse_published(g.get("published_at", "")) for g in group]
        valid_dates = [d for d in dates if d is not None]
        if len(valid_dates) < 2:
            # 投稿日が比較不能ならフォールバック不適用（誤畳み込み回避）
            for g in group:
                representative_ids.add(g["video_id"])
            continue
        span = (max(valid_dates) - min(valid_dates)).days
        if span > 7:
            for g in group:
                representative_ids.add(g["video_id"])
            continue
        _fold_series_group(
            group,
            "（同シリーズと推定: {others} も同期間配信）",
        )
        # 非代表 video_id を集める（コラボ二重畳み込み回避用）
        rep_id = next(iter(representative_ids & {g["video_id"] for g in group}))
        for g in group:
            if g["video_id"] != rep_id:
                prefix_non_rep_ids.add(g["video_id"])

    # === D-2: コラボ別視点畳み込み（HIGH-4） ===
    # シリーズ畳み込み（パス1/2）で代表落ちした動画は collab 畳み込み対象から除外
    collab_eligible = [
        v for v in all_videos
        if not v.get("is_excluded")
        and (v.get("series_key") is None or v["video_id"] in representative_ids)
        and v["video_id"] not in prefix_non_rep_ids
    ]

    collab_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for v in collab_eligible:
        key = v.get("collab_key")
        if key:
            collab_groups[key].append(v)

    collab_representative_ids: set[str] = set()
    collab_folded_count = 0
    for key, group in collab_groups.items():
        # コラボ畳み込み採用条件: 同企画に複数チャンネルが参加していること
        # 同チャンネル連投は誤畳み込みになるため除外
        distinct_channel_ids = {g.get("channel_id", "") for g in group if g.get("channel_id")}
        if len(group) <= 1 or len(distinct_channel_ids) < 2:
            if group:
                collab_representative_ids.add(group[0]["video_id"])
            continue
        # コラボ代表選出: 推し度降順 → スコア降順 → 投稿日昇順
        group.sort(key=lambda x: (
            -x.get("favorite", 3),
            -x["score"],
            x.get("published_at", ""),
        ))
        rep = group[0]
        collab_representative_ids.add(rep["video_id"])
        collab_folded_count += len(group) - 1
        other_channels = [g["channel_name"] for g in group[1:]]
        note = f"（同企画を {', '.join(other_channels)} 視点でも配信）"
        rep["reason"] = (rep.get("reason", "") + " " + note).strip()

    # === D-3: 候補判定（評価対象外 + 畳み込み代表落ち を除外） ===
    def _is_candidate(v: dict[str, Any]) -> bool:
        """series/collab/prefix のグループに属する場合は代表のみ通過させる"""
        if v.get("is_excluded"):
            return False
        if v.get("series_key") and v["video_id"] not in representative_ids:
            return False
        # プレフィックスパスで代表落ちした動画も除外
        if v["video_id"] in prefix_non_rep_ids:
            return False
        if v.get("collab_key") and v["video_id"] not in collab_representative_ids:
            return False
        return True

    # === E-1: 7点帯タイブレーカー（HIGH-5） ===
    def _tiebreaker_key(v: dict[str, Any]) -> tuple[int, int, int]:
        """
        7点帯（およびスコア同点動画）の表示順を細分化するためのソートキー。

        優先順位:
            1. 推し度（神 5 > 推し 4 > 通常 3 > 興味薄 1-2）- favorite 降順
            2. 笑い+驚きシグナル数 - 降順
            3. 動画尺 × 字幕取得率（情報密度）- 降順
               ここでは duration_minutes（字幕未取得時 0）を代理指標に使う
        """
        favorite = v.get("favorite", 3)
        signal_total = v.get("laugh_signal_count", 0) + v.get("surprise_signal_count", 0)
        info_density = (v.get("duration_minutes") or 0) if v.get("has_subtitles") else 0
        return (-favorite, -signal_total, -info_density)

    # 評価対象外（歌・踊り・カバー・字幕で判断不可・チャンネル単位除外）
    excluded: list[dict[str, Any]] = sorted(
        [v for v in all_videos if v.get("is_excluded")],
        key=lambda x: (x["channel_name"], x["title"]),
    )

    # 拾い物候補: SMALL 層 かつ SMALL 閾値クリア かつ 既存推薦に未到達（評価対象外・畳み込み代表落ちを除く）
    # E-2: スコア降順を主キー、_tiebreaker_key を副キーに適用
    small_pickups: list[dict[str, Any]] = sorted(
        [
            v for v in all_videos
            if _is_candidate(v)
            and is_small_channel_pickup(v, v["favorite"], small_threshold_map, threshold_map)
        ],
        key=lambda x: (-x["score"],) + _tiebreaker_key(x),
    )
    # 拾い物候補に該当する video_id を除外用セット化（スキップOK との重複回避）
    pickup_ids: set[str] = {v["video_id"] for v in small_pickups}

    # 優先度別に動画を分類（いずれも評価対象外・畳み込み代表落ちを除く）
    # 見逃し厳禁: スコア8以上（好き度に関わらず）
    must_watch: list[dict[str, Any]] = sorted(
        [v for v in all_videos if _is_candidate(v) and v["score"] >= 8],
        key=lambda x: (-x["score"],) + _tiebreaker_key(x),
    )
    # 時間があれば: 好き度閾値を超えているがスコア8未満
    watch_if_time: list[dict[str, Any]] = sorted(
        [
            v for v in all_videos
            if _is_candidate(v)
            and v["score"] < 8
            and is_recommended(v, v["favorite"], threshold_map)
        ],
        key=lambda x: (-x["score"],) + _tiebreaker_key(x),
    )
    # スキップOK: 好き度閾値を超えていない かつ 拾い物候補にも該当しない
    skip_ok: list[dict[str, Any]] = sorted(
        [
            v for v in all_videos
            if _is_candidate(v)
            and not is_recommended(v, v["favorite"], threshold_map)
            and v["score"] < 8
            and v["video_id"] not in pickup_ids
        ],
        key=lambda x: (-x["score"],) + _tiebreaker_key(x),
    )

    # ジャンル別の動画数を集計
    genre_video_counts: dict[str, int] = {}
    for genre_id in genres:
        genre_video_counts[genre_id] = sum(
            1 for v in all_videos if v.get("genre") == genre_id
        )

    def _format_video_entry(
        v: dict[str, Any],
        index: int | None = None,
        show_subscriber: bool = False,
    ) -> list[str]:
        """
        動画エントリを優先度別セクション向けにフォーマット。

        v2 以降は推し度ラベルを必ず付与する（神/推し/通常/興味薄）。
        show_subscriber=True の場合、SMALL 拾い物候補向けに登録者数とSMALL基準注記を付ける。
        """
        entry_lines: list[str] = []
        fav_label = _get_favorite_label(v["favorite"])
        channel_display = f"{v['channel_name']}（{fav_label}）"
        ai_genre = v.get("ai_genre", "")
        genre_suffix = f" ({ai_genre})" if ai_genre else ""

        boosted = _is_boosted_recommendation(v["score"], v["favorite"], threshold_map)
        score_suffix = " (推し補正)" if boosted else ""

        # バズ検知バッジ（4-3）: 48h以内 かつ 再生数/登録者数が閾値超え。
        # 表示のみでスコアには加点しない
        buzzing = is_buzzing(
            v.get("published_at", ""),
            v.get("view_count"),
            v.get("subscriber_count"),
        )
        buzz_suffix = " 🚀 伸びてる" if buzzing else ""

        prefix = f"{index}. " if index is not None else "- "
        entry_lines.append(
            f"{prefix}**[{v['title']}]({v['url']})** - "
            f"スコア: {v['score']}/10{score_suffix}{genre_suffix}{buzz_suffix}"
        )
        if show_subscriber:
            sub_disp = _format_subscriber_count(v.get("subscriber_count"))
            entry_lines.append(f"   - チャンネル: {channel_display} (登録者: {sub_disp})")
        else:
            entry_lines.append(f"   - チャンネル: {channel_display}")
        # 見どころタイムスタンプリンク（4-1）: &t=NNNNs 形式、最大3つ
        highlight_seconds = v.get("highlight_seconds", [])[:3]
        if highlight_seconds:
            links = " / ".join(
                _format_timestamp_link(v["video_id"], sec) for sec in highlight_seconds
            )
            entry_lines.append(f"   - ⏱ 見どころジャンプ: {links}")
        for h in v.get("highlights", []):
            entry_lines.append(f"   - 🎯 {h}")
        if v.get("reason"):
            reason_suffix = "（SMALL基準）" if show_subscriber else ""
            entry_lines.append(f"   - 💬 {v['reason']}{reason_suffix}")
        return entry_lines

    # --- Markdown 組み立て ---
    lines: list[str] = []
    # F-3: v2 仕様マーカー（HTML コメントなのでレンダリング時には見えない）
    lines.append("<!-- ytcheck-spec: v2 -->")
    lines.append("")
    lines.append(f"# YouTube巡回レポート {date_display} (#{report_num})")
    lines.append("")

    # 👑 今日のベスト1本（4-2）: must_watch 先頭（既存ソート順の最上位）、
    # 空なら watch_if_time 先頭、両方空ならセクションごと省略
    best_video: dict[str, Any] | None = None
    if must_watch:
        best_video = must_watch[0]
    elif watch_if_time:
        best_video = watch_if_time[0]
    if best_video is not None:
        lines.append("## 👑 今日のベスト1本")
        lines.append("")
        lines.extend(_format_video_entry(best_video))
        lines.append("")

    # 🔥 見逃し厳禁（スコア8以上）
    lines.append("## 🔥 今日の見逃し厳禁！")
    lines.append("")
    if must_watch:
        for i, v in enumerate(must_watch, 1):
            lines.extend(_format_video_entry(v, index=i))
            lines.append("")
    else:
        lines.append("今回は見逃し厳禁の動画はありませんでした。")
        lines.append("")

    # 📺 時間があれば（推薦対象だがスコア8未満）
    lines.append("## 📺 時間があるなら見たい")
    lines.append("")
    if watch_if_time:
        for i, v in enumerate(watch_if_time, 1):
            lines.extend(_format_video_entry(v, index=i))
            lines.append("")
    else:
        lines.append("なし")
        lines.append("")

    # 🌱 拾い物候補（SMALL 層、原石探し用、誤検知許容）
    lines.append("## 🌱 拾い物候補（小規模チャンネル）")
    lines.append("")
    if small_pickups:
        for i, v in enumerate(small_pickups, 1):
            lines.extend(_format_video_entry(v, index=i, show_subscriber=True))
            lines.append("")
    else:
        lines.append("なし")
        lines.append("")

    # 📋 評価対象外（歌・踊り・カバー・字幕で判断不可・チャンネル単位除外）
    lines.append("## 📋 評価対象外（歌・踊り・カバー）")
    lines.append("")
    if excluded:
        for v in excluded:
            fav_label = _get_favorite_label(v["favorite"])
            channel_display = f"{v['channel_name']}（{fav_label}）"
            lines.append(f"- [{v['title']}]({v['url']}) - {channel_display}")
            lines.append(f"  - 種別: {v.get('exclude_reason', '不明')}")
        lines.append("")
    else:
        lines.append("なし")
        lines.append("")

    # 📋 スキップOK
    # F-1/F-2: スコア0 を理由別に分類し、本体リスト（score 1-6）と折りたたみ（score 0）に分ける
    score_zero = [v for v in skip_ok if v["score"] == 0]
    score_zero_normal = [v for v in skip_ok if v["score"] > 0]

    reason_labels: dict[str | None, str] = {
        "no_subtitles": "字幕未取得",
        "ai_failed": "AI評価失敗",
        "unhandled_exception": "処理エラー",
        "low_signal": "低シグナル",
        None: "理由不明",
    }
    reason_counter: Counter[str] = Counter(
        reason_labels.get(v.get("score_zero_reason"), "理由不明")
        for v in score_zero
    )

    lines.append("## 📋 今回スキップしてOK")
    lines.append("")
    if skip_ok:
        # スコア1-6（本体リスト）
        lines.append(f"スコア1-6（{len(score_zero_normal)}本）:")
        lines.append("")
        if score_zero_normal:
            for v in score_zero_normal:
                ai_genre = v.get("ai_genre", "")
                genre_suffix = f" ({ai_genre})" if ai_genre else ""
                fav_label = _get_favorite_label(v["favorite"])
                channel_display = f"{v['channel_name']}（{fav_label}）"
                lines.append(
                    f"- [{v['title']}]({v['url']}) - スコア: {v['score']}/10{genre_suffix} ({channel_display})"
                )
            lines.append("")
        else:
            lines.append("なし")
            lines.append("")

        # スコア0 の内訳サマリー + 折りたたみ詳細
        if score_zero:
            # 表示順を固定（字幕未取得 / AI評価失敗 / 処理エラー / 低シグナル / 理由不明）
            ordered_labels = ["字幕未取得", "AI評価失敗", "処理エラー", "低シグナル", "理由不明"]
            breakdown_parts = [
                f"{label} {reason_counter[label]}本"
                for label in ordered_labels
                if reason_counter.get(label, 0) > 0
            ]
            if breakdown_parts:
                lines.append(f"スコア0の内訳: {' / '.join(breakdown_parts)}")
                lines.append("")

            lines.append(f"<details>")
            lines.append(f"<summary>スコア0動画リスト（{len(score_zero)}本）</summary>")
            lines.append("")
            for v in score_zero:
                fav_label = _get_favorite_label(v["favorite"])
                channel_display = f"{v['channel_name']}（{fav_label}）"
                reason_label = reason_labels.get(v.get("score_zero_reason"), "理由不明")
                lines.append(
                    f"- [{v['title']}]({v['url']}) - {channel_display} — {reason_label}"
                )
            lines.append("")
            lines.append("</details>")
            lines.append("")
    else:
        lines.append("なし")
        lines.append("")

    # サマリー
    lines.append("## 巡回サマリー")
    lines.append("")
    lines.append(f"- 巡回チャンネル数: {channel_count}")
    lines.append(f"- 取得動画数: {total_videos}")

    # ジャンル別の動画数を表示
    genre_count_parts = [
        f"{genre_name} {genre_video_counts.get(genre_id, 0)}本"
        for genre_id, genre_name in genres.items()
    ]
    lines.append(f"- ジャンル別: {' / '.join(genre_count_parts)}")
    lines.append(f"- 平均スコア: {avg_score:.1f}")
    # 層別チャンネル数（SMALL/MID/LARGE）と拾い物候補数を末尾に追加
    lines.append(
        f"- 層別チャンネル数: SMALL {tier_channel_counts['small']} / "
        f"MID {tier_channel_counts['mid']} / "
        f"LARGE {tier_channel_counts['large']}"
    )
    lines.append(f"- 拾い物候補: {len(small_pickups)}本")
    lines.append(f"- 評価対象外（歌・踊り・カバー）: {len(excluded)}本")
    lines.append(f"- シリーズ連番畳み込み: {series_folded_count}本")
    lines.append(f"- コラボ別視点畳み込み: {collab_folded_count}本")
    # F-3: レポート仕様タグ
    lines.append("- レポート仕様: v2")
    lines.append("")

    # 実行サマリー（run_stats 指定時のみ。日次運用で失敗多発に気づけるようにする）
    if run_stats is not None:
        lines.append("## 実行サマリー")
        lines.append("")
        lines.append(f"- 処理本数（新規評価）: {run_stats.processed}")
        lines.append(f"- キャッシュスキップ: {run_stats.cache_skipped}")
        lines.append(f"- 評価対象外: {run_stats.excluded}")
        lines.append(f"- 失敗（字幕取得）: {run_stats.subtitle_failures}")
        lines.append(f"- 失敗（AI評価）: {run_stats.ai_failures}")
        lines.append(
            f"- pending 再評価: 試行 {run_stats.pending_retried} / "
            f"成功 {run_stats.pending_succeeded} / 失敗 {run_stats.pending_failed}"
        )
        lines.append(f"- 所要時間: {run_stats.elapsed_seconds:.1f} 秒")
        lines.append("")

    markdown_text = "\n".join(lines)

    # ファイル出力
    _WRITING_DIR.mkdir(parents=True, exist_ok=True)
    output_filename = f"ytcheck-{date_str}-{report_num}.md"
    output_path = _WRITING_DIR / output_filename
    output_path.write_text(markdown_text, encoding="utf-8")

    return markdown_text, str(output_path)


def update_viewing_history(all_results: list[dict[str, Any]]) -> str | None:
    """
    月別視聴履歴ファイルに巡回結果を追記する（重複チェック付き）

    Args:
        all_results: run_all_channels() の戻り値

    Returns:
        更新したファイルパス（更新なしの場合はNone）
    """
    now = datetime.now()
    month_str = now.strftime("%Y-%m")
    history_file = _TASKS_DIR / f"viewing-{month_str}.md"
    # _TASKS_DIR が _WRITING_DIR と別の場所に向いた場合でも自前で作れるようにする
    _TASKS_DIR.mkdir(parents=True, exist_ok=True)

    # cross-process ロック: companion-remote の視聴フィードバック記入 API が同ファイルを
    # 書き換えるため、read→全文再構成→write の全体を viewing ディレクトリ直下の共有
    # ロックファイル .viewing.lock の flock(LOCK_EX) で囲む（remote/server/ytcheck.py と
    # 同じパスを両プロセスが導出する）。blocking で取る（書き込みは ms オーダー、
    # 競合は実質 05:00 の一瞬のみ。timeout リトライは作らない）
    lock_fd = os.open(_TASKS_DIR / ".viewing.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        return _update_viewing_history_locked(all_results, month_str, history_file)
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def _update_viewing_history_locked(
    all_results: list[dict[str, Any]], month_str: str, history_file: Path
) -> str | None:
    """update_viewing_history の本体（呼び出し元が .viewing.lock を保持している前提）"""
    # 既存ファイルの読み込みまたは新規作成
    if history_file.exists():
        existing_text = history_file.read_text(encoding="utf-8")
    else:
        # 新規ファイルにはフィードバック欄の記入方法を載せる
        # （月次集計は tools/feedback_report.py が行う）
        existing_text = (
            f"---\ntitle: YouTube視聴履歴\nmonth: {month_str}\n---\n\n"
            f"# YouTube視聴履歴 ({month_str})\n\n"
            "記入方法: 見た動画はチェックボックスを `[x]` にする。"
            "行末の `[feedback: ]` に ○（当たり）/ ×（外れ）を記入する。\n"
        )

    # 既存の video_id を抽出して重複チェック用セットを作成
    existing_ids: set[str] = set()
    for match in re.finditer(r"\[video_id:\s*([^\]]+)\]", existing_text):
        existing_ids.add(match.group(1).strip())

    # チャンネルごとに追記内容を構築
    additions_by_channel: dict[str, list[str]] = {}
    added_count = 0

    for ch_result in all_results:
        channel_name = ch_result.get("channel_name", "不明")
        # チャンネルレベルの tier をフォールバックとして拾う（後方互換: 欠落時 small）
        channel_tier = ch_result.get("tier", "small")
        for v in ch_result.get("videos", []):
            video_info = v.get("video", {})
            video_id = video_info.get("video_id", "")
            if not video_id or video_id in existing_ids:
                continue

            title = video_info.get("title", "不明")
            published = video_info.get("published_at", "")
            score = v.get("score", 0)
            reason = v.get("reason", "")
            # 動画レベルの tier を優先、なければチャンネルレベルにフォールバック
            tier = v.get("tier") or channel_tier

            # 行末の [feedback: ] は姫が後から ○（当たり）/ ×（外れ）を記入する欄。
            # 欄の無い過去月の行も tools/feedback_report.py が後方互換でパースする
            line = (
                f"- [ ] {title} "
                f"[video_id: {video_id}] "
                f"[published: {published}] "
                f"[score: {score}/10] "
                f"[tier: {tier}] "
                f"[reason: {reason}] "
                f"[feedback: ]"
            )

            if channel_name not in additions_by_channel:
                additions_by_channel[channel_name] = []
            additions_by_channel[channel_name].append(line)
            added_count += 1

    if added_count == 0:
        return None

    # 既存ファイルにチャンネルセクションごとに追記
    updated_text = existing_text.rstrip("\n")

    for channel_name, lines in additions_by_channel.items():
        section_header = f"## [{channel_name}]"
        if section_header in updated_text:
            # 既存セクションの末尾に追記
            # セクションの終わりは次の ## か EOF
            pattern = re.escape(section_header) + r"(.*?)(?=\n## |\Z)"
            match = re.search(pattern, updated_text, re.DOTALL)
            if match:
                section_end = match.end()
                insert_text = "\n" + "\n".join(lines)
                updated_text = updated_text[:section_end] + insert_text + updated_text[section_end:]
        else:
            # 新しいセクションを追加
            updated_text += f"\n\n{section_header}\n" + "\n".join(lines)

    updated_text += "\n"
    history_file.write_text(updated_text, encoding="utf-8")

    return str(history_file)
