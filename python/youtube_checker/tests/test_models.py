"""
models.py の単体テスト
"""
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from models import EvaluationResult, Video, determine_tier


def test_video_model():
    """Videoモデルの生成とプロパティ確認"""
    now = datetime.now(timezone.utc)
    video = Video(
        video_id="video123",
        title="Test Video",
        published_at=now
    )
    assert video.video_id == "video123"
    assert video.title == "Test Video"
    assert video.url == "https://www.youtube.com/watch?v=video123"

def test_evaluation_result_model():
    """EvaluationResultモデルの生成確認"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    result = EvaluationResult(
        video=video,
        has_subtitles=True,
        score=8,
        reason="Good"
    )
    assert result.score == 8
    assert result.reason == "Good"

def test_evaluation_result_score_validation():
    """スコアの範囲検証確認"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    with pytest.raises(ValidationError):
        EvaluationResult(
            video=video,
            has_subtitles=True,
            score=11, # 0-10
            reason="Too high"
        )


def test_evaluation_result_tier_default_none():
    """tier / subscriber_count を指定しない場合は None になる（後方互換）"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    result = EvaluationResult(
        video=video,
        has_subtitles=True,
        score=5,
    )
    assert result.tier is None
    assert result.subscriber_count is None


def test_evaluation_result_tier_and_subscriber_count_set():
    """tier と subscriber_count を渡すと正しく保持される"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    result = EvaluationResult(
        video=video,
        has_subtitles=True,
        score=7,
        tier="small",
        subscriber_count=8500,
    )
    assert result.tier == "small"
    assert result.subscriber_count == 8500


def test_evaluation_result_tier_invalid_value():
    """tier に許容外の文字列を渡すと ValidationError"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    with pytest.raises(ValidationError):
        EvaluationResult(
            video=video,
            has_subtitles=True,
            tier="huge",  # 許可: small / mid / large のみ
        )


def test_video_view_count_default_none():
    """view_count を指定しない場合は None（後方互換、4-3）"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)
    assert video.view_count is None

    video2 = Video(video_id="v2", title="t2", published_at=now, view_count=12345)
    assert video2.view_count == 12345


def test_evaluation_result_highlight_seconds_default_empty():
    """highlight_seconds を指定しない場合は空リスト（後方互換、4-1）"""
    now = datetime.now(timezone.utc)
    video = Video(video_id="v1", title="t1", published_at=now)

    result = EvaluationResult(video=video, has_subtitles=True, score=5)
    assert result.highlight_seconds == []

    result2 = EvaluationResult(
        video=video, has_subtitles=True, score=7, highlight_seconds=[65, 754]
    )
    assert result2.highlight_seconds == [65, 754]


class TestDetermineTier:
    """determine_tier の境界値テスト"""

    THRESHOLDS = {"small": 10_000, "mid": 100_000}

    def test_None_は_smallに倒す(self):
        assert determine_tier(None, self.THRESHOLDS) == "small"

    def test_0_は_small(self):
        assert determine_tier(0, self.THRESHOLDS) == "small"

    def test_9999_は_small(self):
        assert determine_tier(9999, self.THRESHOLDS) == "small"

    def test_10000_は_mid_境界(self):
        # < small ではないので small ではなく mid に該当
        assert determine_tier(10000, self.THRESHOLDS) == "mid"

    def test_99999_は_mid(self):
        assert determine_tier(99999, self.THRESHOLDS) == "mid"

    def test_100000_は_large_境界(self):
        assert determine_tier(100000, self.THRESHOLDS) == "large"

    def test_1000000_は_large(self):
        assert determine_tier(1_000_000, self.THRESHOLDS) == "large"
