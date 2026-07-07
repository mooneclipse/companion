"""
main.py の単体テスト（--all 一括巡回機能を含む）
"""
import asyncio
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

import main as main_module
from config import settings
from evaluation_cache import EvaluationCache
from main import (
    _retry_pending_evaluations,
    _select_model,
    load_channel_list,
    process_single_channel,
    process_video,
    run_all_channels,
)
from models import EvaluationResult, RunStats, Video


class TestLoadChannelList:
    """load_channel_list のテスト"""

    def test_正常なJSONを読み込める(self):
        """正しい形式のJSONファイルを読み込めることを確認"""
        data = {
            "updated": "2026-02-18",
            "channels": [
                {
                    "name": "テストチャンネル",
                    "channel_id": "UC_test123",
                    "check_days": 3,
                    "note": "",
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            genres, channels = load_channel_list(path)
            assert len(channels) == 1
            assert channels[0]["channel_id"] == "UC_test123"
            assert channels[0]["name"] == "テストチャンネル"
            assert channels[0]["check_days"] == 3
        finally:
            path.unlink(missing_ok=True)

    def test_ファイルが存在しない場合はエラー(self):
        """存在しないファイルを指定した場合にFileNotFoundErrorが発生"""
        with pytest.raises(FileNotFoundError):
            load_channel_list(Path("/nonexistent/path/channels.json"))

    def test_空のチャンネルリスト(self):
        """チャンネルリストが空の場合は空リストを返す"""
        data = {"updated": "2026-02-18", "channels": []}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            genres, channels = load_channel_list(path)
            assert channels == []
        finally:
            path.unlink(missing_ok=True)

    def test_複数チャンネルの読み込み(self):
        """複数チャンネルを含むJSONを正しく読み込めることを確認"""
        data = {
            "channels": [
                {"name": "Ch1", "channel_id": "UC_1", "check_days": 3},
                {"name": "Ch2", "channel_id": "UC_2", "check_days": 7},
            ]
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            genres, channels = load_channel_list(path)
            assert len(channels) == 2
            assert channels[0]["check_days"] == 3
            assert channels[1]["check_days"] == 7
        finally:
            path.unlink(missing_ok=True)


class TestProcessSingleChannel:
    """process_single_channel の tier 連携テスト"""

    @pytest.mark.asyncio
    async def test_subscriber_countからtierが決定され結果辞書に含まれる(self):
        """SMALL/MID/LARGE の各層で正しい tier が辞書に入る"""
        # 動画ゼロ件のショートカットを利用してネットワーク呼び出しを避ける
        with mock.patch("main.youtube_client.get_recent_videos", return_value=[]):
            youtube = mock.MagicMock()

            # SMALL 層（< 10000）
            result_small = await process_single_channel(
                channel_id="UC_s", channel_name="S",
                days=3, output_format="json",
                youtube=youtube, subscriber_count=5000,
            )
            assert result_small["tier"] == "small"
            assert result_small["subscriber_count"] == 5000

            # MID 層（10000 <= < 100000）
            result_mid = await process_single_channel(
                channel_id="UC_m", channel_name="M",
                days=3, output_format="json",
                youtube=youtube, subscriber_count=50000,
            )
            assert result_mid["tier"] == "mid"

            # LARGE 層（>= 100000）
            result_large = await process_single_channel(
                channel_id="UC_l", channel_name="L",
                days=3, output_format="json",
                youtube=youtube, subscriber_count=200000,
            )
            assert result_large["tier"] == "large"

            # subscriber_count が None なら small にフォールバック
            result_none = await process_single_channel(
                channel_id="UC_n", channel_name="N",
                days=3, output_format="json",
                youtube=youtube, subscriber_count=None,
            )
            assert result_none["tier"] == "small"
            assert result_none["subscriber_count"] is None


class TestRunAllChannels:
    """run_all_channels のテスト"""

    @pytest.mark.asyncio
    async def test_全チャンネル巡回が実行される(self):
        """全チャンネルが順番に処理されることを確認"""
        data = {
            "channels": [
                {"name": "Ch1", "channel_id": "UC_1", "check_days": 3},
                {"name": "Ch2", "channel_id": "UC_2", "check_days": 5},
            ]
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            with mock.patch("main.process_single_channel") as mock_process, \
                 mock.patch("main.youtube_client.get_youtube_service") as mock_yt:
                mock_yt.return_value = mock.MagicMock()
                mock_process.return_value = {
                    "channel_name": "Test",
                    "channel_id": "UC_test",
                    "videos": [],
                }

                genres, results = await run_all_channels(path)

                assert len(results) == 2
                assert mock_process.call_count == 2

                # check_days が個別に渡されていることを確認
                calls = mock_process.call_args_list
                assert calls[0].kwargs["days"] == 3
                assert calls[1].kwargs["days"] == 5
        finally:
            path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_subscriber_countがprocess_single_channelに渡される(self):
        """JSON 内 subscriber_count が process_single_channel まで伝搬する"""
        data = {
            "channels": [
                {
                    "name": "Small",
                    "channel_id": "UC_small",
                    "check_days": 3,
                    "subscriber_count": 5000,
                    "subscriber_count_updated_at": "2026-04-26T00:00:00Z",
                },
                {
                    "name": "Large",
                    "channel_id": "UC_large",
                    "check_days": 3,
                    "subscriber_count": 500000,
                    "subscriber_count_updated_at": "2026-04-26T00:00:00Z",
                },
                {
                    # subscriber_count フィールドが欠落しているチャンネル（自動追加直後）
                    "name": "MissingField",
                    "channel_id": "UC_missing",
                    "check_days": 3,
                },
            ]
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            with mock.patch("main.process_single_channel") as mock_process, \
                 mock.patch("main.youtube_client.get_youtube_service") as mock_yt, \
                 mock.patch("main._refresh_subscriber_cache"):
                mock_yt.return_value = mock.MagicMock()
                mock_process.return_value = {
                    "channel_name": "Test",
                    "channel_id": "UC_test",
                    "videos": [],
                }

                await run_all_channels(path)

                calls = mock_process.call_args_list
                assert calls[0].kwargs["subscriber_count"] == 5000
                assert calls[1].kwargs["subscriber_count"] == 500000
                # フィールド欠落チャンネルは None になる（KeyError にならない）
                assert calls[2].kwargs["subscriber_count"] is None
        finally:
            path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_エラーがあっても他のチャンネルは続行(self):
        """1つのチャンネルでエラーが発生しても他は処理される"""
        data = {
            "channels": [
                {"name": "ErrorCh", "channel_id": "UC_err", "check_days": 3},
                {"name": "OkCh", "channel_id": "UC_ok", "check_days": 3},
            ]
        }
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            with mock.patch("main.process_single_channel") as mock_process, \
                 mock.patch("main.youtube_client.get_youtube_service") as mock_yt:
                mock_yt.return_value = mock.MagicMock()
                # 最初のチャンネルはエラー、2番目は成功
                mock_process.side_effect = [
                    Exception("API Error"),
                    {
                        "channel_name": "OkCh",
                        "channel_id": "UC_ok",
                        "videos": [],
                    },
                ]

                genres, results = await run_all_channels(path)

                assert len(results) == 2
                # エラーチャンネルの結果にerrorフィールドがある
                assert "error" in results[0]
                assert results[0]["error"] == "API Error"
                # 成功チャンネルは正常
                assert "error" not in results[1]
        finally:
            path.unlink(missing_ok=True)


def _make_video(video_id: str, title: str = "テスト実況動画") -> Video:
    """テスト用の Video を生成するヘルパー"""
    return Video(
        video_id=video_id,
        title=title,
        published_at=datetime(2026, 7, 4, 10, 0, 0, tzinfo=timezone.utc),
    )


def _make_cached_result(video_id: str) -> EvaluationResult:
    """キャッシュ登録用の確定評価結果を生成するヘルパー"""
    return EvaluationResult(
        video=_make_video(video_id),
        has_subtitles=True,
        score=7,
        reason="キャッシュ済みの評価",
        genre="雑談",
        tier="mid",
    )


class TestProcessSingleChannelCache:
    """process_single_channel の評価済みキャッシュ連携テスト（AC1）"""

    @pytest.mark.asyncio
    async def test_キャッシュヒットは字幕取得ごとスキップ(self, tmp_path: Path):
        """キャッシュ済み動画は字幕取得が呼ばれず、レポート対象にも入らない"""
        cache = EvaluationCache(tmp_path / "cache.json")
        cache.add(_make_cached_result("cached1"))

        videos = [_make_video("cached1"), _make_video("fresh1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(False, "", []),
            ) as mock_fetch,
        ):
            result = await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
                cache=cache,
            )

        # キャッシュヒット分はスキップされ、新規分のみが処理される
        assert result["cache_skipped"] == 1
        assert len(result["videos"]) == 1
        assert result["videos"][0]["video"]["video_id"] == "fresh1"
        # 字幕取得は新規分の1回のみ（キャッシュヒットは字幕取得ごとスキップ = AC1）
        assert mock_fetch.call_count == 1
        called_video_ids = [c.args[0] for c in mock_fetch.call_args_list]
        assert called_video_ids == ["fresh1"]

    @pytest.mark.asyncio
    async def test_新規評価の確定結果がキャッシュに登録される(self, tmp_path: Path):
        """評価成功した動画は次回実行でスキップされるようキャッシュに入る"""
        cache = EvaluationCache(tmp_path / "cache.json")
        videos = [_make_video("new1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", []),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(7, "面白い配信", "雑談", []),
            ),
        ):
            await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
                cache=cache,
            )

        assert cache.contains("new1") is True
        entry = cache.lookup("new1")
        assert entry is not None
        assert entry["score"] == 7

    @pytest.mark.asyncio
    async def test_字幕なし動画はキャッシュに登録されない(self, tmp_path: Path):
        """no_subtitles は翌日再挑戦させるためキャッシュしない"""
        cache = EvaluationCache(tmp_path / "cache.json")
        videos = [_make_video("nosub1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(False, "", []),
            ),
        ):
            await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
                cache=cache,
            )

        assert cache.contains("nosub1") is False

    @pytest.mark.asyncio
    async def test_cache省略時は従来動作(self):
        """cache=None（デフォルト）ではフィルタも登録も行われない"""
        videos = [_make_video("v1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(False, "", []),
            ) as mock_fetch,
        ):
            result = await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
            )

        assert result["cache_skipped"] == 0
        assert mock_fetch.call_count == 1


def _write_pending_file(
    pending_dir: Path,
    video_id: str = "pend1",
    channel_id: str = "UC_1",
) -> Path:
    """テスト用の pending ファイル（実データ version 1.0 形式）を作成するヘルパー"""
    data = {
        "version": "1.0",
        "type": "pending_evaluation",
        "created_at": "2026-07-04T00:00:00+00:00",
        "video": {
            "video_id": video_id,
            "title": "テスト実況動画",
            "published_at": "2026-07-01T10:00:00+00:00",
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "channel_id": channel_id,
        },
        "subtitle_text": "こんにちは今日も配信やっていきます",
        "evaluation_prompt": "（旧テンプレートで描画済みのプロンプト）",
        "status": "pending",
    }
    pending_dir.mkdir(parents=True, exist_ok=True)
    path = pending_dir / f"pending_20260704_000000_{video_id}.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


class TestRetryPendingEvaluations:
    """_retry_pending_evaluations（pending 自動リトライ）のテスト（AC3）"""

    @pytest.mark.asyncio
    async def test_成功時はファイル削除とキャッシュ登録が行われる(self, tmp_path: Path):
        """pending が翌日実行で自動解消される（AC3）"""
        pending_file = _write_pending_file(tmp_path / "pending", channel_id="UC_1")
        channels = [
            {
                "name": "Ch1",
                "channel_id": "UC_1",
                "favorite": 2,
                "genre": "indie",
                "subscriber_count": 50000,
            }
        ]
        cache = EvaluationCache(tmp_path / "cache.json")
        stats = RunStats()

        with (
            mock.patch.object(
                main_module.settings,
                "PENDING_EVALUATION_DIR",
                str(tmp_path / "pending"),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_with_claude_code",
                new_callable=mock.AsyncMock,
                return_value=(7, "[Claude評価] 面白い配信", "雑談", []),
            ),
        ):
            results = await _retry_pending_evaluations(
                channels, cache=cache, stats=stats
            )

        # 成功: pending ファイルが削除される（AC3）
        assert not pending_file.exists()
        # 結果がチャンネル単位の dict で返る（tier / favorite は channels から引き直し）
        assert len(results) == 1
        assert results[0]["channel_id"] == "UC_1"
        assert results[0]["favorite"] == 2
        assert results[0]["tier"] == "mid"  # subscriber_count=50000 → mid
        assert results[0]["videos"][0]["score"] == 7
        # キャッシュに登録され、後続の巡回で再評価されない
        assert cache.contains("pend1") is True
        # 統計が集計される
        assert stats.pending_retried == 1
        assert stats.pending_succeeded == 1
        assert stats.pending_failed == 0

    @pytest.mark.asyncio
    async def test_失敗時はファイルを保持して次回に持ち越す(self, tmp_path: Path):
        pending_file = _write_pending_file(tmp_path / "pending")
        stats = RunStats()

        with (
            mock.patch.object(
                main_module.settings,
                "PENDING_EVALUATION_DIR",
                str(tmp_path / "pending"),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_with_claude_code",
                new_callable=mock.AsyncMock,
                side_effect=RuntimeError("rate limited"),
            ),
        ):
            results = await _retry_pending_evaluations([], stats=stats)

        # 失敗: ファイルは残る（次回実行で再挑戦）
        assert pending_file.exists()
        assert results == []
        assert stats.pending_retried == 1
        assert stats.pending_succeeded == 0
        assert stats.pending_failed == 1

    @pytest.mark.asyncio
    async def test_チャンネル不明時はmidにフォールバック(self, tmp_path: Path):
        """チャンネルリストに存在しない channel_id は tier=mid / favorite=3"""
        _write_pending_file(tmp_path / "pending", channel_id="UC_unknown")

        with (
            mock.patch.object(
                main_module.settings,
                "PENDING_EVALUATION_DIR",
                str(tmp_path / "pending"),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_with_claude_code",
                new_callable=mock.AsyncMock,
                return_value=(6, "[Claude評価] まずまず", "雑談", []),
            ),
        ):
            results = await _retry_pending_evaluations([])

        assert len(results) == 1
        assert results[0]["tier"] == "mid"
        assert results[0]["favorite"] == 3

    @pytest.mark.asyncio
    async def test_pendingが無ければ何もしない(self, tmp_path: Path):
        empty_dir = tmp_path / "pending_empty"
        with mock.patch.object(
            main_module.settings, "PENDING_EVALUATION_DIR", str(empty_dir)
        ):
            results = await _retry_pending_evaluations([])
        assert results == []

    @pytest.mark.asyncio
    async def test_run_all_channelsのデフォルトではリトライしない(self):
        """retry_pending デフォルト False（既存呼び出しの後方互換）"""
        data = {"channels": [{"name": "Ch1", "channel_id": "UC_1", "check_days": 2}]}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            with (
                mock.patch("main.process_single_channel") as mock_process,
                mock.patch("main.youtube_client.get_youtube_service") as mock_yt,
                mock.patch("main._retry_pending_evaluations") as mock_retry,
            ):
                mock_yt.return_value = mock.MagicMock()
                mock_process.return_value = {
                    "channel_name": "Ch1",
                    "channel_id": "UC_1",
                    "videos": [],
                }

                await run_all_channels(path)

                mock_retry.assert_not_called()
        finally:
            path.unlink(missing_ok=True)


class TestRunAllChannelsStats:
    """run_all_channels の実行統計集計テスト（AC4 の入力データ）"""

    @pytest.mark.asyncio
    async def test_統計が結果dictから集計される(self):
        data = {"channels": [{"name": "Ch1", "channel_id": "UC_1", "check_days": 2}]}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            path = Path(f.name)

        try:
            with (
                mock.patch("main.process_single_channel") as mock_process,
                mock.patch("main.youtube_client.get_youtube_service") as mock_yt,
            ):
                mock_yt.return_value = mock.MagicMock()
                mock_process.return_value = {
                    "channel_name": "Ch1",
                    "channel_id": "UC_1",
                    "cache_skipped": 3,
                    "videos": [
                        {"score": 7, "is_excluded": False, "score_zero_reason": None},
                        {"score": 0, "is_excluded": True, "score_zero_reason": None},
                        {
                            "score": 0,
                            "is_excluded": False,
                            "score_zero_reason": "no_subtitles",
                        },
                        {
                            "score": 0,
                            "is_excluded": False,
                            "score_zero_reason": "ai_failed",
                        },
                    ],
                }

                stats = RunStats()
                genres, results = await run_all_channels(path, stats=stats)

                assert stats.processed == 4
                assert stats.cache_skipped == 3
                assert stats.excluded == 1
                assert stats.subtitle_failures == 1
                assert stats.ai_failures == 1
                assert stats.elapsed_seconds >= 0.0
                # 戻り値は従来どおり 2-tuple のまま
                assert len(results) == 1
        finally:
            path.unlink(missing_ok=True)


class TestSelectModel:
    """_select_model（好き度 → モデル振り分け）のテスト（AC5）"""

    def test_favorite2以下は軽量モデル(self):
        assert _select_model(1) == settings.LOW_FAVORITE_MODEL
        assert _select_model(2) == settings.LOW_FAVORITE_MODEL

    def test_favorite3以上はデフォルトモデル(self):
        """None = --model 指定なし（現行デフォルトモデル）"""
        assert _select_model(3) is None
        assert _select_model(4) is None
        assert _select_model(5) is None


class TestModelRouting:
    """favorite → モデルの貫通テスト（process_single_channel / pending リトライ）"""

    @pytest.mark.asyncio
    async def test_favorite2のチャンネルはHaikuで評価される(self):
        videos = [_make_video("low_fav1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", []),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(5, "まずまず", "雑談", []),
            ) as mock_eval,
        ):
            await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                favorite=2,
                youtube=mock.MagicMock(), subscriber_count=50000,
            )

        assert mock_eval.call_args.kwargs["model"] == settings.LOW_FAVORITE_MODEL

    @pytest.mark.asyncio
    async def test_favorite3のチャンネルはデフォルトモデル(self):
        videos = [_make_video("mid_fav1")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", []),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(5, "まずまず", "雑談", []),
            ) as mock_eval,
        ):
            await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                favorite=3,
                youtube=mock.MagicMock(), subscriber_count=50000,
            )

        assert mock_eval.call_args.kwargs["model"] is None

    @pytest.mark.asyncio
    async def test_pendingリトライでも振り分けが適用される(self, tmp_path: Path):
        """引き直した favorite<=2 なら Haiku（黒服補足1）"""
        _write_pending_file(tmp_path / "pending", channel_id="UC_low")
        channels = [
            {
                "name": "LowFav",
                "channel_id": "UC_low",
                "favorite": 1,
                "subscriber_count": 5000,
            }
        ]

        with (
            mock.patch.object(
                main_module.settings,
                "PENDING_EVALUATION_DIR",
                str(tmp_path / "pending"),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_with_claude_code",
                new_callable=mock.AsyncMock,
                return_value=(6, "[Claude評価] まずまず", "雑談", []),
            ) as mock_eval,
        ):
            await _retry_pending_evaluations(channels)

        assert mock_eval.call_args.kwargs["model"] == settings.LOW_FAVORITE_MODEL

    @pytest.mark.asyncio
    async def test_pendingリトライで不明時はデフォルトモデル(self, tmp_path: Path):
        """不明時は favorite=3 フォールバック = デフォルトモデル（黒服補足1）"""
        _write_pending_file(tmp_path / "pending", channel_id="UC_unknown")

        with (
            mock.patch.object(
                main_module.settings,
                "PENDING_EVALUATION_DIR",
                str(tmp_path / "pending"),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_with_claude_code",
                new_callable=mock.AsyncMock,
                return_value=(6, "[Claude評価] まずまず", "雑談", []),
            ) as mock_eval,
        ):
            await _retry_pending_evaluations([])

        assert mock_eval.call_args.kwargs["model"] is None


class TestSubtitleUndeterminableFlag:
    """「字幕で判断不可」フラグの評価対象外送りテスト（Phase 2 バグ修正の回帰）

    評価理由には "[Claude評価] " プレフィックスが付くため、
    プレフィックス除去後に比較しないと判定が機能しない（修正前の既存バグ）。
    """

    async def _evaluate_with_reason(
        self, video_id: str, reason: str
    ) -> EvaluationResult:
        """AI 評価が指定の理由を返したときの process_video 結果を得るヘルパー"""
        video = _make_video(video_id)
        with (
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", []),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(0, reason, "その他", []),
            ),
        ):
            return await process_video(
                video, asyncio.Semaphore(1),
                channel_id="UC_1", channel_name="Ch1",
            )

    @pytest.mark.asyncio
    async def test_判断不可フラグは評価対象外になる(self):
        """[Claude評価] プレフィックス付きでも評価対象外送りが機能する"""
        result = await self._evaluate_with_reason(
            "nd1", "[Claude評価] 字幕で判断不可"
        )
        assert result.is_excluded is True
        assert result.exclude_reason == "字幕で判断不可"
        assert result.score == 0

        # 句点付きバリエーション（「字幕で判断不可。」）も同様に評価対象外になる
        result2 = await self._evaluate_with_reason(
            "nd2", "[Claude評価] 字幕で判断不可。"
        )
        assert result2.is_excluded is True
        assert result2.exclude_reason == "字幕で判断不可"
        assert result2.score == 0


class TestHighlightSeconds:
    """見どころタイムスタンプの貫通テスト（4-1、AC7 の入力データ）"""

    @pytest.mark.asyncio
    async def test_cueから検出した見どころが結果に入る(self):
        """fetch_subtitle_timed の cue から highlight_seconds が検出・格納される"""
        videos = [_make_video("hl1")]
        # 65-70秒付近に笑い・驚きシグナルが集中している cue
        cues = [
            (10.0, "こんにちは"),
            (65.0, "wwww 面白すぎる"),
            (70.0, "えっ！マジ？やばい"),
        ]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", cues),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(7, "面白い配信", "雑談", []),
            ),
        ):
            result = await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
            )

        # 60-120秒の窓が唯一のシグナル集中箇所 → 代表秒は窓内最初のヒット秒 65
        assert result["videos"][0]["highlight_seconds"] == [65]

    @pytest.mark.asyncio
    async def test_シグナルなしなら空リスト(self):
        """シグナルが無い cue では highlight_seconds は空（デフォルト互換）"""
        videos = [_make_video("hl2")]
        cues = [(10.0, "こんにちは"), (20.0, "今日は雑談です")]
        with (
            mock.patch("main.youtube_client.get_recent_videos", return_value=videos),
            mock.patch(
                "main.subtitle_fetcher.fetch_subtitle_timed",
                new_callable=mock.AsyncMock,
                return_value=(True, "こんにちは今日も配信やっていきます", cues),
            ),
            mock.patch(
                "main.ai_evaluator.evaluate_subtitle",
                new_callable=mock.AsyncMock,
                return_value=(7, "面白い配信", "雑談", []),
            ),
        ):
            result = await process_single_channel(
                channel_id="UC_1", channel_name="Ch1",
                days=2, output_format="json",
                youtube=mock.MagicMock(), subscriber_count=50000,
            )

        assert result["videos"][0]["highlight_seconds"] == []

