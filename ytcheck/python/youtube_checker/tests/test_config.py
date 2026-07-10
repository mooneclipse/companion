"""
config.py の単体テスト
"""
import os
from unittest import mock

import pytest
from pydantic import ValidationError

from config import Settings


def test_config_validation_success():
    """
    正しい環境変数設定で検証が成功することを確認
    """
    with mock.patch.dict(os.environ, {
        "YOUTUBE_API_KEY": "dummy_youtube_key",
        "CHECK_DAYS": "5",
        "MAX_CONCURRENT_TASKS": "3"
    }, clear=True):
        settings = Settings()
        assert settings.YOUTUBE_API_KEY == "dummy_youtube_key"
        assert settings.CHECK_DAYS == 5
        assert settings.MAX_CONCURRENT_TASKS == 3

def test_config_validation_missing_key():
    """
    必須キー（YOUTUBE_API_KEY）が欠けている場合にエラーになることを確認
    """
    with mock.patch.dict(os.environ, {}, clear=True):
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

def test_config_validation_invalid_value():
    """
    無効な値（範囲外など）でエラーになることを確認
    """
    with mock.patch.dict(os.environ, {
        "YOUTUBE_API_KEY": "dummy",
        "CHECK_DAYS": "100"  # le=30 なのでエラーになるはず
    }, clear=True):
        with pytest.raises(ValidationError):
            Settings()

def test_config_pending_evaluation_dir_default():
    """
    PENDING_EVALUATION_DIR のデフォルト値が正しいことを確認
    """
    with mock.patch.dict(os.environ, {
        "YOUTUBE_API_KEY": "dummy",
    }, clear=True):
        settings = Settings()
        assert settings.PENDING_EVALUATION_DIR == "pending_evaluations"

def test_config_pending_evaluation_dir_custom():
    """
    PENDING_EVALUATION_DIR がカスタム値で設定できることを確認
    """
    with mock.patch.dict(os.environ, {
        "YOUTUBE_API_KEY": "dummy",
        "PENDING_EVALUATION_DIR": "/custom/path"
    }, clear=True):
        settings = Settings()
        assert settings.PENDING_EVALUATION_DIR == "/custom/path"


def test_tier_thresholds_default():
    """TIER_THRESHOLDS のデフォルト値（small=10000, mid=100000）を確認"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        assert settings.TIER_THRESHOLDS == {"small": 10_000, "mid": 100_000}
        assert settings.TIER_THRESHOLDS["small"] == 10_000
        assert settings.TIER_THRESHOLDS["mid"] == 100_000


def test_subscriber_cache_days_default():
    """SUBSCRIBER_CACHE_DAYS のデフォルト値が 7 日"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        assert settings.SUBSCRIBER_CACHE_DAYS == 7


def test_small_channel_threshold_map_default():
    """SMALL_CHANNEL_THRESHOLD_MAP のデフォルト値が設計書通りの値"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        assert settings.SMALL_CHANNEL_THRESHOLD_MAP == {1: 7, 2: 6, 3: 5, 4: 4, 5: 2}


def test_small_channel_prompt_template_content():
    """SMALL_CHANNEL_PROMPT_TEMPLATE が必要文言を含み、不要文言を含まない"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        prompt = settings.SMALL_CHANNEL_PROMPT_TEMPLATE
        # 「6以上で『拾い物候補』レベル」が含まれる
        assert "6以上で「拾い物候補」レベル" in prompt
        # 「8以上は『見逃し厳禁』」相当の文言は含まれない（QC提案5）
        assert "8以上は「見逃し厳禁」" not in prompt
        assert "見逃し厳禁" not in prompt
        # プレースホルダ整合性（既存 EVALUATION_PROMPT_TEMPLATE と同じキー）
        assert "{title}" in prompt
        assert "{excitement_summary}" in prompt
        assert "{subtitle_text}" in prompt


def test_small_channel_prompt_template_format_compatibility():
    """SMALL_CHANNEL_PROMPT_TEMPLATE が .format() で既存と同じプレースホルダで埋められる"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        rendered = settings.SMALL_CHANNEL_PROMPT_TEMPLATE.format(
            title="テスト動画",
            excitement_summary="盛り上がり: 中",
            subtitle_text="こんにちは",
        )
        assert "テスト動画" in rendered
        assert "盛り上がり: 中" in rendered
        assert "こんにちは" in rendered


def test_low_favorite_model_default():
    """LOW_FAVORITE_MODEL のデフォルト値が claude-haiku-4-5"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        assert settings.LOW_FAVORITE_MODEL == "claude-haiku-4-5"


def test_evaluation_prompt_template_format_compatibility():
    """EVALUATION_PROMPT_TEMPLATE の JSON 例（波括弧）が .format() を壊さない"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        rendered = settings.EVALUATION_PROMPT_TEMPLATE.format(
            title="テスト動画",
            excitement_summary="盛り上がり: 中",
            subtitle_text="こんにちは",
        )
        assert "テスト動画" in rendered
        # {{ }} エスケープが単一波括弧に展開されている（JSON 例が生きている）
        assert '{"score": 8' in rendered


def test_prompt_templates_have_json_output_instruction():
    """両テンプレートに JSON 出力指示が含まれる（2b）"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        for template in (
            settings.EVALUATION_PROMPT_TEMPLATE,
            settings.SMALL_CHANNEL_PROMPT_TEMPLATE,
        ):
            assert "JSON オブジェクト" in template
            assert '"score"' in template
            assert '"reason"' in template
            # 判断不可フラグの仕様は維持
            assert "字幕で判断不可" in template


def test_prompt_templates_have_sampling_note():
    """両テンプレートに字幕3点抜粋の注記が含まれる（3-1）"""
    with mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "dummy"}, clear=True):
        settings = Settings()
        for template in (
            settings.EVALUATION_PROMPT_TEMPLATE,
            settings.SMALL_CHANNEL_PROMPT_TEMPLATE,
        ):
            assert "冒頭・中盤・終盤の3箇所からの抜粋" in template
            assert "...(中略)..." in template
