"""
output_formatter.py の単体テスト
"""
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import pytest

from models import RunStats
from output_formatter import (
    _format_subscriber_count,
    _format_timestamp_link,
    _is_boosted_recommendation,
    format_markdown_report,
    is_buzzing,
    is_recommended,
    is_small_channel_pickup,
    update_viewing_history,
)


class TestIsRecommended:
    """is_recommended のテスト"""

    def test_閾値以上のスコアなら推薦(self):
        """スコアが閾値以上なら推薦と判定される"""
        video = {"score": 8}
        assert is_recommended(video, favorite=1, threshold_map={1: 8}) is True

    def test_閾値未満なら推薦されない(self):
        """スコアが閾値未満なら推薦されない"""
        video = {"score": 7}
        assert is_recommended(video, favorite=1, threshold_map={1: 8}) is False

    def test_好き度が高いほど閾値が下がる(self):
        """好き度5は閾値3なので低スコアでも推薦される"""
        threshold_map = {1: 8, 2: 7, 3: 6, 4: 5, 5: 3}
        video = {"score": 4}
        assert is_recommended(video, favorite=5, threshold_map=threshold_map) is True
        assert is_recommended(video, favorite=4, threshold_map=threshold_map) is False

    def test_マッピングにない好き度はデフォルト7(self):
        """マッピングにない好き度の場合はデフォルト閾値7を使用"""
        video = {"score": 7}
        assert is_recommended(video, favorite=99, threshold_map={}) is True
        video_low = {"score": 6}
        assert is_recommended(video_low, favorite=99, threshold_map={}) is False

    def test_スコアがない場合は0として扱う(self):
        """video に score キーがない場合は0として扱う"""
        video = {}
        assert is_recommended(video, favorite=3, threshold_map={3: 6}) is False


class TestIsBoostedRecommendation:
    """_is_boosted_recommendation のテスト"""

    def test_標準閾値未満かつ好き度閾値以上なら補正推薦(self):
        """スコア5が好き度5の閾値（3）は超えるが標準閾値（7）は超えない場合は補正推薦"""
        threshold_map = {1: 8, 2: 7, 3: 6, 4: 5, 5: 3}
        assert _is_boosted_recommendation(5, favorite=5, threshold_map=threshold_map) is True

    def test_標準閾値以上なら補正推薦ではない(self):
        """スコアが標準閾値以上なら補正ではなく通常推薦"""
        threshold_map = {2: 7, 5: 3}
        assert _is_boosted_recommendation(7, favorite=5, threshold_map=threshold_map) is False

    def test_好き度閾値未満なら補正推薦でない(self):
        """好き度閾値（3）も下回る場合は補正推薦にならない"""
        threshold_map = {2: 7, 5: 3}
        assert _is_boosted_recommendation(2, favorite=5, threshold_map=threshold_map) is False


def _make_all_results(
    score: int = 8,
    has_subtitles: bool = True,
    genre: str = "indie",
    favorite: int = 3,
    highlights: list[str] | None = None,
) -> list[dict]:
    """テスト用のチャンネル結果データを生成するヘルパー"""
    return [
        {
            "channel_name": "テストチャンネル",
            "genre": genre,
            "favorite": favorite,
            "videos": [
                {
                    "video": {
                        "title": "テスト動画",
                        "url": "https://www.youtube.com/watch?v=test123",
                        "video_id": "test123",
                        "published_at": "2026-02-26T10:00:00+00:00",
                    },
                    "score": score,
                    "reason": "テスト理由",
                    "has_subtitles": has_subtitles,
                    "error": None,
                    "genre": "雑談",
                    "highlights": highlights or ["盛り上がりポイント1"],
                }
            ],
        }
    ]


class TestFormatMarkdownReport:
    """format_markdown_report のテスト"""

    def test_見逃し厳禁セクションに高スコア動画が表示される(self, tmp_path: Path):
        """スコア8以上の動画は見逃し厳禁セクションに表示される"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8, favorite=3)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, output_path = format_markdown_report(genres, all_results)

        assert "## 🔥 今日の見逃し厳禁！" in markdown_text
        assert "テスト動画" in markdown_text
        assert "8/10" in markdown_text

    def test_ファイルが保存される(self, tmp_path: Path):
        """format_markdown_report がファイルを writing/ 下に保存する"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            _, output_path = format_markdown_report(genres, all_results)

        assert Path(output_path).exists()
        content = Path(output_path).read_text(encoding="utf-8")
        assert "YouTube巡回レポート" in content

    def test_見逃し厳禁が空の場合のメッセージ(self, tmp_path: Path):
        """スコア8未満なら見逃し厳禁に「ありませんでした」と表示"""
        genres = {"indie": "個人勢"}
        # スコア3は閾値6未満なので推薦されない
        all_results = _make_all_results(score=3, favorite=3)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "見逃し厳禁の動画はありませんでした" in markdown_text

    def test_優先度別セクションが含まれる(self, tmp_path: Path):
        """優先度別の3セクション（見逃し厳禁・時間があれば・スキップOK）がMarkdownに含まれる"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8, genre="indie")

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 🔥 今日の見逃し厳禁！" in markdown_text
        assert "## 📺 時間があるなら見たい" in markdown_text
        assert "## 📋 今回スキップしてOK" in markdown_text

    def test_サマリーセクションが含まれる(self, tmp_path: Path):
        """巡回サマリーセクションが含まれる"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 巡回サマリー" in markdown_text
        assert "巡回チャンネル数" in markdown_text
        assert "取得動画数" in markdown_text


# === フェーズE: 拾い物候補 / tier 関連テスト ===


def _make_pickup_video(
    *,
    video_id: str = "vid_pickup",
    title: str = "拾い物候補動画",
    score: int = 6,
    tier: str = "small",
    subscriber_count: int | None = 8500,
    favorite: int = 3,
    has_subtitles: bool = True,
    highlights: list[str] | None = None,
    reason: str = "本気度高め",
) -> dict:
    """拾い物候補テスト用の動画辞書"""
    return {
        "video": {
            "title": title,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "video_id": video_id,
            "published_at": "2026-04-26T10:00:00+00:00",
        },
        "score": score,
        "reason": reason,
        "has_subtitles": has_subtitles,
        "error": None,
        "genre": "雑談",
        "highlights": highlights or ["熱量たっぷりの語り"],
        "tier": tier,
        "subscriber_count": subscriber_count,
    }


class TestIsSmallChannelPickup:
    """is_small_channel_pickup の判定テスト"""

    SMALL_MAP = {1: 7, 2: 6, 3: 5, 4: 4, 5: 2}
    BASE_MAP = {1: 8, 2: 7, 3: 6, 4: 5, 5: 3}

    def test_true_when_tier_small_and_above_small_threshold(self):
        """tier=small / score>=small閾値 / 既存推薦未到達 → True"""
        # favorite=3 → small_threshold=5, base_threshold=6
        # score=5 は SMALL クリア・既存未到達
        v = {"tier": "small", "score": 5, "favorite": 3}
        assert is_small_channel_pickup(v, 3, self.SMALL_MAP, self.BASE_MAP) is True

    def test_false_when_in_existing_recommendation(self):
        """既存推薦（base 閾値クリア）に入る場合は False（重複回避）"""
        # favorite=3 → base_threshold=6
        # score=6 は既存「時間があれば」を満たす
        v = {"tier": "small", "score": 6, "favorite": 3}
        assert is_small_channel_pickup(v, 3, self.SMALL_MAP, self.BASE_MAP) is False

    def test_false_when_score_above_must_watch(self):
        """score>=8 は見逃し厳禁に倒れるため拾い物候補から除外"""
        v = {"tier": "small", "score": 9, "favorite": 3}
        assert is_small_channel_pickup(v, 3, self.SMALL_MAP, self.BASE_MAP) is False

    def test_false_when_tier_not_small(self):
        """tier=mid / large は拾い物候補対象外"""
        v_mid = {"tier": "mid", "score": 5, "favorite": 3}
        v_large = {"tier": "large", "score": 5, "favorite": 3}
        assert is_small_channel_pickup(v_mid, 3, self.SMALL_MAP, self.BASE_MAP) is False
        assert is_small_channel_pickup(v_large, 3, self.SMALL_MAP, self.BASE_MAP) is False

    def test_false_when_below_small_threshold(self):
        """SMALL 閾値未達なら False"""
        # favorite=3 → small_threshold=5, score=4 は未達
        v = {"tier": "small", "score": 4, "favorite": 3}
        assert is_small_channel_pickup(v, 3, self.SMALL_MAP, self.BASE_MAP) is False

    def test_false_when_tier_missing(self):
        """tier フィールド欠落時は False（後方互換、想定外データの安全動作）"""
        v = {"score": 5, "favorite": 3}
        assert is_small_channel_pickup(v, 3, self.SMALL_MAP, self.BASE_MAP) is False


class TestFormatSubscriberCount:
    """_format_subscriber_count の表記テスト"""

    def test_None_は非公開(self):
        assert _format_subscriber_count(None) == "非公開"

    def test_1000未満は素のままK表記なし(self):
        assert _format_subscriber_count(500) == "~500"

    def test_数千は小数1桁K(self):
        assert _format_subscriber_count(8500) == "~8.5K"

    def test_万単位は整数K(self):
        assert _format_subscriber_count(12000) == "~12K"

    def test_百万単位はM表記(self):
        assert _format_subscriber_count(1_500_000) == "~1.5M"


class TestFormatMarkdownReportSmallPickup:
    """拾い物候補セクション・サマリー拡張のテスト"""

    def test_拾い物候補セクションが出力される(self, tmp_path: Path):
        """SMALL 層 + SMALL 閾値クリアの動画が拾い物候補セクションに表示される"""
        genres = {"indie": "個人勢"}
        all_results = [
            {
                "channel_name": "小規模個人勢",
                "channel_id": "UC_small",
                "genre": "indie",
                "favorite": 3,
                "tier": "small",
                "subscriber_count": 8500,
                "videos": [_make_pickup_video(video_id="vid_pickup_a", score=5)],
            }
        ]

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 🌱 拾い物候補（小規模チャンネル）" in markdown_text
        assert "拾い物候補動画" in markdown_text
        assert "登録者: ~8.5K" in markdown_text
        assert "（SMALL基準）" in markdown_text

    def test_既存推薦の動画は拾い物候補に重複しない(self, tmp_path: Path):
        """既存「見逃し厳禁」を満たす SMALL 層動画は拾い物候補には出ない"""
        genres = {"indie": "個人勢"}
        all_results = [
            {
                "channel_name": "小規模個人勢",
                "channel_id": "UC_small",
                "genre": "indie",
                "favorite": 3,
                "tier": "small",
                "subscriber_count": 8500,
                "videos": [_make_pickup_video(video_id="vid_must", score=9)],  # 8以上
            }
        ]

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        # 見逃し厳禁には出る
        assert "## 🔥 今日の見逃し厳禁！" in markdown_text
        # 拾い物候補セクションは存在するが「なし」表示
        assert "## 🌱 拾い物候補（小規模チャンネル）" in markdown_text
        # 拾い物候補セクション内で動画が重複していないことを確認するため
        # セクション位置を取得して、その直後にだけ「なし」が来ることを検証
        pickup_idx = markdown_text.index("## 🌱 拾い物候補（小規模チャンネル）")
        skip_idx = markdown_text.index("## 📋 今回スキップしてOK")
        pickup_section = markdown_text[pickup_idx:skip_idx]
        assert "なし" in pickup_section

    def test_サマリーに層別チャンネル数と拾い物候補数が含まれる(self, tmp_path: Path):
        """巡回サマリーに SMALL/MID/LARGE 数 + 拾い物候補数が出る"""
        genres = {"indie": "個人勢"}
        all_results = [
            {
                "channel_name": "Small Ch", "genre": "indie", "favorite": 3,
                "tier": "small", "subscriber_count": 8500,
                "videos": [_make_pickup_video(video_id="vp1", score=5, tier="small")],
            },
            {
                "channel_name": "Mid Ch", "genre": "indie", "favorite": 3,
                "tier": "mid", "subscriber_count": 50000,
                "videos": [],
            },
            {
                "channel_name": "Large Ch", "genre": "indie", "favorite": 3,
                "tier": "large", "subscriber_count": 200000,
                "videos": [],
            },
        ]

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "層別チャンネル数: SMALL 1 / MID 1 / LARGE 1" in markdown_text
        assert "拾い物候補: 1本" in markdown_text


class TestUpdateViewingHistoryTier:
    """update_viewing_history の tier メタデータテスト"""

    def test_update_viewing_history_includes_tier_in_metadata(self, tmp_path: Path):
        """viewing 履歴の各動画行に [tier: small|mid|large] が含まれる"""
        all_results = [
            {
                "channel_name": "TestCh",
                "tier": "small",
                "subscriber_count": 8500,
                "videos": [_make_pickup_video(video_id="vid_history_a", score=5, tier="small")],
            },
            {
                "channel_name": "MidCh",
                "tier": "mid",
                "subscriber_count": 50000,
                "videos": [_make_pickup_video(video_id="vid_history_b", score=7, tier="mid")],
            },
        ]

        with mock.patch("output_formatter._TASKS_DIR", tmp_path):
            history_path = update_viewing_history(all_results)

        assert history_path is not None
        text = Path(history_path).read_text(encoding="utf-8")
        assert "[tier: small]" in text
        assert "[tier: mid]" in text
        assert "vid_history_a" in text
        assert "vid_history_b" in text


class TestUpdateViewingHistoryFeedback:
    """update_viewing_history のフィードバック欄テスト（3-2）"""

    def test_動画行の行末にfeedback欄が付く(self, tmp_path: Path):
        all_results = [
            {
                "channel_name": "FbCh",
                "tier": "mid",
                "videos": [
                    _make_pickup_video(video_id="vid_fb_1", score=7, tier="mid")
                ],
            },
        ]

        with mock.patch("output_formatter._TASKS_DIR", tmp_path):
            history_path = update_viewing_history(all_results)

        assert history_path is not None
        text = Path(history_path).read_text(encoding="utf-8")
        # 動画行の行末に空の feedback 欄が付く
        video_line = next(
            line for line in text.splitlines() if "vid_fb_1" in line
        )
        assert video_line.endswith("[feedback: ]")
        # 新規ファイルには記入方法の説明が入る
        assert "記入方法" in text

    def test_feedback欄があってもvideo_id重複チェックが機能する(self, tmp_path: Path):
        """黒服補足2: 行フォーマット拡張後も既存の重複チェックを壊さない"""
        all_results = [
            {
                "channel_name": "FbCh",
                "tier": "mid",
                "videos": [
                    _make_pickup_video(video_id="vid_fb_dup", score=7, tier="mid")
                ],
            },
        ]

        with mock.patch("output_formatter._TASKS_DIR", tmp_path):
            first = update_viewing_history(all_results)
            # 同じ動画で2回目 → 追記なし（None）
            second = update_viewing_history(all_results)

        assert first is not None
        assert second is None
        text = Path(first).read_text(encoding="utf-8")
        assert text.count("vid_fb_dup") == 1


# === v2 畳み込み修正（バグ1 + バグ2）の結合テスト ===


def _make_video_entry(
    *,
    video_id: str,
    title: str,
    published_at: str = "2026-05-11T10:00:00+00:00",
    score: int = 7,
    has_subtitles: bool = True,
    collab_key: str | None = None,
    series_key: str | None = None,
    is_excluded: bool = False,
    exclude_reason: str = "",
) -> dict:
    """畳み込みテスト用の単一動画 dict（EvaluationResult 相当）"""
    return {
        "video": {
            "title": title,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "video_id": video_id,
            "published_at": published_at,
        },
        "score": score,
        "reason": "テスト理由",
        "has_subtitles": has_subtitles,
        "error": None,
        "genre": "雑談",
        "highlights": [],
        "is_excluded": is_excluded,
        "exclude_reason": exclude_reason,
        "series_key": series_key,
        "collab_key": collab_key,
        "laugh_signal_count": 0,
        "surprise_signal_count": 0,
        "duration_minutes": 30,
    }


def _make_channel_result(
    *,
    channel_name: str,
    channel_id: str,
    videos: list[dict],
    favorite: int = 3,
    tier: str = "mid",
    subscriber_count: int = 50000,
) -> dict:
    """単一チャンネル結果 dict（run_all_channels の戻り値 1 要素相当）"""
    return {
        "channel_name": channel_name,
        "channel_id": channel_id,
        "genre": "indie",
        "favorite": favorite,
        "tier": tier,
        "subscriber_count": subscriber_count,
        "videos": videos,
    }


class TestCollabFoldingFallback:
    """バグ1: コラボ畳み込みフォールバック結合テスト"""

    def test_nmrih_same_day_two_channels_folds(self, tmp_path: Path):
        """NMRiH2 同日 2 チャンネル → コラボ畳み込み 1 件"""
        # 表記揺れあり: 「Hell2」と「Hell 2」
        v1 = _make_video_entry(
            video_id="nmrih_a",
            title="No More Room in Hell2",
            published_at="2026-05-11T20:00:00+00:00",
            collab_key="nomoreroominhell2::2026-05-11",
        )
        v2 = _make_video_entry(
            video_id="nmrih_b",
            title="No More Room in Hell 2",
            published_at="2026-05-11T20:30:00+00:00",
            collab_key="nomoreroominhell2::2026-05-11",
        )
        all_results = [
            _make_channel_result(channel_name="佐伯", channel_id="UC_saeki", videos=[v1]),
            _make_channel_result(channel_name="星導", channel_id="UC_seido", videos=[v2]),
        ]
        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)
        assert "コラボ別視点畳み込み: 1本" in markdown_text

    def test_same_channel_same_collab_key_not_folded(self, tmp_path: Path):
        """同タイトル同チャンネル連投 2 件 → 畳み込まれない（distinct_channels<2）"""
        v1 = _make_video_entry(
            video_id="same_a",
            title="同企画タイトル",
            published_at="2026-05-11T10:00:00+00:00",
            collab_key="同企画タイトル::2026-05-11",
        )
        v2 = _make_video_entry(
            video_id="same_b",
            title="同企画タイトル",
            published_at="2026-05-11T11:00:00+00:00",
            collab_key="同企画タイトル::2026-05-11",
        )
        all_results = [
            _make_channel_result(
                channel_name="単独Ch",
                channel_id="UC_one",
                videos=[v1, v2],
            ),
        ]
        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)
        assert "コラボ別視点畳み込み: 0本" in markdown_text


class TestSeriesPrefixFolding:
    """バグ2: シリーズ連番プレフィックスフォールバック結合テスト"""

    def test_haku_kura_two_videos_same_channel_folds(self, tmp_path: Path):
        """はくクラ 2 本（同チャンネル、連番ナシ、7 日内）→ シリーズ畳み込み 1 件"""
        # series_key は None（連番マーカーなし）、prefix フォールバックでマッチ想定
        v1 = _make_video_entry(
            video_id="haku_a",
            title="はくクラ最終日",
            published_at="2026-05-10T10:00:00+00:00",
            series_key=None,
        )
        v2 = _make_video_entry(
            video_id="haku_b",
            title="はくクラ妖怪、クイズ王の称号を取りにいきます",
            published_at="2026-05-11T10:00:00+00:00",
            series_key=None,
        )
        all_results = [
            _make_channel_result(
                channel_name="天雲ナガト",
                channel_id="UC_nagato",
                videos=[v1, v2],
            ),
        ]
        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)
        assert "シリーズ連番畳み込み: 1本" in markdown_text

    def test_same_prefix_but_over_seven_days_not_folded(self, tmp_path: Path):
        """同プレフィックスでも 8 日以上空いたら別シリーズ扱い（畳まない）"""
        v1 = _make_video_entry(
            video_id="haku_old",
            title="はくクラ最終日",
            published_at="2026-05-01T10:00:00+00:00",
        )
        v2 = _make_video_entry(
            video_id="haku_new",
            title="はくクラ復活回",
            published_at="2026-05-10T10:00:00+00:00",
        )
        all_results = [
            _make_channel_result(
                channel_name="天雲ナガト",
                channel_id="UC_nagato",
                videos=[v1, v2],
            ),
        ]
        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)
        assert "シリーズ連番畳み込み: 0本" in markdown_text

    def test_series_and_collab_no_double_folding(self, tmp_path: Path):
        """プレフィックスで畳まれた非代表動画がコラボ畳み込み候補に上がらない"""
        # 同チャンネル 2 本（はくクラ系・3 日以内）+ 同チャンネル別動画 1 本
        # プレフィックスで haku_a/haku_b が畳まれる。
        # haku_b に collab_key を付与し、別チャンネルにも同 collab_key の動画を 1 本置く。
        # 二重畳み込み回避が効いていれば、コラボ畳み込みは発火しない（haku_b は collab 候補から除外）
        v1 = _make_video_entry(
            video_id="haku_a",
            title="はくクラ最終日",
            published_at="2026-05-10T10:00:00+00:00",
        )
        v2 = _make_video_entry(
            video_id="haku_b",
            title="はくクラ妖怪、クイズ王の称号を取りにいきます",
            published_at="2026-05-11T10:00:00+00:00",
            collab_key="collab_x::2026-05-11",
        )
        v3 = _make_video_entry(
            video_id="other",
            title="別企画動画",
            published_at="2026-05-11T10:00:00+00:00",
            collab_key="collab_x::2026-05-11",
        )
        all_results = [
            _make_channel_result(
                channel_name="天雲ナガト",
                channel_id="UC_nagato",
                videos=[v1, v2],
            ),
            _make_channel_result(
                channel_name="別チャンネル",
                channel_id="UC_other",
                videos=[v3],
            ),
        ]
        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)
        # シリーズ畳み込みは 1 件発火
        assert "シリーズ連番畳み込み: 1本" in markdown_text
        # コラボ畳み込みは発火しない（haku_b が候補から除外されたため）
        assert "コラボ別視点畳み込み: 0本" in markdown_text


class TestRunStatsSummary:
    """format_markdown_report の実行サマリー出力テスト（AC4）"""

    def test_run_stats指定時にレポート末尾へ実行サマリーが出る(self, tmp_path: Path):
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)
        stats = RunStats(
            processed=10,
            cache_skipped=5,
            excluded=2,
            subtitle_failures=1,
            ai_failures=1,
            pending_retried=3,
            pending_succeeded=2,
            pending_failed=1,
            elapsed_seconds=12.34,
        )

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(
                genres, all_results, run_stats=stats
            )

        assert "## 実行サマリー" in markdown_text
        assert "- 処理本数（新規評価）: 10" in markdown_text
        assert "- キャッシュスキップ: 5" in markdown_text
        assert "- 評価対象外: 2" in markdown_text
        assert "- 失敗（字幕取得）: 1" in markdown_text
        assert "- 失敗（AI評価）: 1" in markdown_text
        assert "- pending 再評価: 試行 3 / 成功 2 / 失敗 1" in markdown_text
        assert "- 所要時間: 12.3 秒" in markdown_text
        # 実行サマリーはレポート末尾（巡回サマリーの後）に置かれる
        assert markdown_text.index("## 巡回サマリー") < markdown_text.index(
            "## 実行サマリー"
        )

    def test_run_stats省略時は実行サマリーが出ない(self, tmp_path: Path):
        """省略可能引数のデフォルトでは現行出力のまま（既存テスト保護）"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 実行サマリー" not in markdown_text


# === Phase 4: 見どころリンク / ベスト1本 / バズ検知 ===


class TestFormatTimestampLink:
    """_format_timestamp_link の URL 形式テスト（AC7）"""

    def test_t_パラメータ付きURL形式(self):
        """クリックで該当時刻から再生される &t=NNNNs 形式になる"""
        link = _format_timestamp_link("abc123", 754)
        assert link == "[▶ 0:12:34](https://www.youtube.com/watch?v=abc123&t=754s)"

    def test_1時間超の表記(self):
        """3723秒 → 1:02:03 / &t=3723s"""
        link = _format_timestamp_link("abc123", 3723)
        assert "[▶ 1:02:03]" in link
        assert "&t=3723s" in link

    def test_0秒(self):
        link = _format_timestamp_link("abc123", 0)
        assert "[▶ 0:00:00]" in link
        assert "&t=0s" in link


class TestHighlightLinksInReport:
    """レポートの見どころジャンプリンク表示テスト（4-1）"""

    def test_highlight_secondsがあるとリンクが出る(self, tmp_path: Path):
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)
        all_results[0]["videos"][0]["highlight_seconds"] = [754, 3723]

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "⏱ 見どころジャンプ" in markdown_text
        assert "https://www.youtube.com/watch?v=test123&t=754s" in markdown_text
        assert "&t=3723s" in markdown_text

    def test_highlight_secondsが無い場合はリンク行なし(self, tmp_path: Path):
        """既存データ（フィールド欠落）でも壊れず、リンク行が出ないだけ"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "⏱ 見どころジャンプ" not in markdown_text
        assert "&t=" not in markdown_text

    def test_リンクは最大3つまで(self, tmp_path: Path):
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)
        all_results[0]["videos"][0]["highlight_seconds"] = [10, 70, 130, 190]

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "&t=10s" in markdown_text
        assert "&t=130s" in markdown_text
        # 4件目は表示されない
        assert "&t=190s" not in markdown_text


class TestBestOfDay:
    """今日のベスト1本セクションのテスト（4-2）"""

    def test_must_watchの先頭がベスト1本になる(self, tmp_path: Path):
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=8)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 👑 今日のベスト1本" in markdown_text
        # ベスト1本はレポート先頭（見逃し厳禁より前）に置かれる
        assert markdown_text.index("## 👑 今日のベスト1本") < markdown_text.index(
            "## 🔥 今日の見逃し厳禁！"
        )

    def test_must_watchが空ならwatch_if_time先頭(self, tmp_path: Path):
        """スコア7（favorite 3 の閾値6クリア、8未満）は watch_if_time からベスト選出"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=7, favorite=3)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 👑 今日のベスト1本" in markdown_text
        assert "テスト動画" in markdown_text

    def test_両方空ならセクション省略(self, tmp_path: Path):
        """推薦動画ゼロの日はベスト1本を出さない"""
        genres = {"indie": "個人勢"}
        all_results = _make_all_results(score=3, favorite=3)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report(genres, all_results)

        assert "## 👑 今日のベスト1本" not in markdown_text


class TestIsBuzzing:
    """is_buzzing（バズ検知判定）のテスト（4-3）"""

    NOW = datetime(2026, 7, 6, 12, 0, 0, tzinfo=timezone.utc)

    def test_48時間以内かつ比率超えはTrue(self):
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=6000,
            subscriber_count=10000,
            now=self.NOW,
        ) is True

    def test_48時間より古い動画はFalse(self):
        assert is_buzzing(
            "2026-07-01T00:00:00+00:00",
            view_count=6000,
            subscriber_count=10000,
            now=self.NOW,
        ) is False

    def test_比率未満はFalse(self):
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=1000,
            subscriber_count=10000,
            now=self.NOW,
        ) is False

    def test_view_countがNoneはFalse(self):
        """statistics 未取得の動画はバッジ対象外（None 防御）"""
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=None,
            subscriber_count=10000,
            now=self.NOW,
        ) is False

    def test_subscriber_countがNoneはFalse(self):
        """登録者数非公開・未取得はバッジ対象外（None 防御）"""
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=6000,
            subscriber_count=None,
            now=self.NOW,
        ) is False

    def test_subscriber_countが0はFalse(self):
        """ゼロ除算防御"""
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=6000,
            subscriber_count=0,
            now=self.NOW,
        ) is False

    def test_境界_ちょうど48時間と比率ちょうどはTrue(self):
        assert is_buzzing(
            "2026-07-04T12:00:00+00:00",  # ちょうど48時間前
            view_count=5000,               # 比率ちょうど 0.5
            subscriber_count=10000,
            now=self.NOW,
        ) is True

    def test_未来のpublished_atはFalse(self):
        assert is_buzzing(
            "2026-07-07T00:00:00+00:00",
            view_count=6000,
            subscriber_count=10000,
            now=self.NOW,
        ) is False

    def test_不正なpublished_atはFalse(self):
        assert is_buzzing(
            "", view_count=6000, subscriber_count=10000, now=self.NOW
        ) is False
        assert is_buzzing(
            "not-a-date", view_count=6000, subscriber_count=10000, now=self.NOW
        ) is False

    def test_閾値の引数上書き(self):
        """view_ratio / window_hours の注入（config 化した閾値の差し替え）"""
        # デフォルト 0.5 では False の比率も、閾値 0.05 なら True
        assert is_buzzing(
            "2026-07-06T00:00:00+00:00",
            view_count=1000,
            subscriber_count=10000,
            now=self.NOW,
            view_ratio=0.05,
        ) is True
        # 窓を12時間に縮めると同じ動画でも False
        assert is_buzzing(
            "2026-07-05T12:00:00+00:00",
            view_count=6000,
            subscriber_count=10000,
            now=self.NOW,
            window_hours=12,
        ) is False


class TestBuzzBadgeInReport:
    """レポートのバズバッジ表示テスト（4-3）"""

    def _make_buzz_results(
        self, published_at: str, view_count: int | None
    ) -> list[dict]:
        return [
            {
                "channel_name": "テストチャンネル",
                "genre": "indie",
                "favorite": 3,
                "tier": "mid",
                "subscriber_count": 10000,
                "videos": [
                    {
                        "video": {
                            "title": "バズ判定対象動画",
                            "url": "https://www.youtube.com/watch?v=buzz1",
                            "video_id": "buzz1",
                            "published_at": published_at,
                            "view_count": view_count,
                        },
                        "score": 8,
                        "reason": "テスト理由",
                        "has_subtitles": True,
                        "error": None,
                        "genre": "雑談",
                        "highlights": [],
                        "tier": "mid",
                        "subscriber_count": 10000,
                    }
                ],
            }
        ]

    def test_バズ動画にバッジが付く(self, tmp_path: Path):
        # 1時間前投稿・再生数/登録者数 = 0.9 → バッジ対象
        published = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        all_results = self._make_buzz_results(published, view_count=9000)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)

        assert "🚀 伸びてる" in markdown_text

    def test_古い動画にはバッジが付かない(self, tmp_path: Path):
        published = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        all_results = self._make_buzz_results(published, view_count=9000)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)

        assert "🚀 伸びてる" not in markdown_text

    def test_view_count未取得ならバッジなし(self, tmp_path: Path):
        published = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        all_results = self._make_buzz_results(published, view_count=None)

        with (
            mock.patch("output_formatter._WRITING_DIR", tmp_path),
            mock.patch("output_formatter._TASKS_DIR", tmp_path),
        ):
            markdown_text, _ = format_markdown_report({"indie": "個人勢"}, all_results)

        assert "🚀 伸びてる" not in markdown_text
