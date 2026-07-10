"""
youtube_client.py の単体テスト
"""
from unittest import mock

from googleapiclient.errors import HttpError

from youtube_client import _fetch_video_details, fetch_subscriber_counts


def _make_channel_item(channel_id: str, subscriber_count: str | None = None,
                        hidden: bool = False) -> dict:
    """channels.list レスポンスの items 要素を組み立てるヘルパー"""
    statistics: dict = {}
    if hidden:
        statistics["hiddenSubscriberCount"] = True
    else:
        statistics["hiddenSubscriberCount"] = False
        if subscriber_count is not None:
            statistics["subscriberCount"] = subscriber_count
    return {"id": channel_id, "statistics": statistics}


def _make_youtube_mock(items_per_call: list[list[dict]]) -> mock.MagicMock:
    """
    youtube モックを組み立てる
    items_per_call の各要素が、channels().list().execute() の1回ぶんの items を表す
    """
    youtube = mock.MagicMock()
    execute_mock = mock.MagicMock()
    execute_mock.side_effect = [
        {"items": items} for items in items_per_call
    ]
    youtube.channels.return_value.list.return_value.execute = execute_mock
    return youtube


class TestFetchSubscriberCounts:
    """fetch_subscriber_counts のテスト"""

    def test_通常ケース_hiddenとそうでないチャンネルが混在(self):
        """hidden=False は int、hidden=True は None になる"""
        items = [
            _make_channel_item("UC_a", subscriber_count="12345"),
            _make_channel_item("UC_b", subscriber_count="678"),
            _make_channel_item("UC_c", hidden=True),
        ]
        youtube = _make_youtube_mock([items])

        result = fetch_subscriber_counts(youtube, ["UC_a", "UC_b", "UC_c"])

        assert result["UC_a"] == 12345
        assert result["UC_b"] == 678
        assert result["UC_c"] is None
        # 1バッチで完了
        assert youtube.channels.return_value.list.return_value.execute.call_count == 1

    def test_50件超は2バッチに分割される(self):
        """51件渡すと2回 execute が呼ばれる"""
        # 1バッチ目（50件）と2バッチ目（1件）を別々に返す
        first_batch_items = [
            _make_channel_item(f"UC_{i:03d}", subscriber_count=str(i * 100))
            for i in range(50)
        ]
        second_batch_items = [
            _make_channel_item("UC_050", subscriber_count="9999"),
        ]
        youtube = _make_youtube_mock([first_batch_items, second_batch_items])

        channel_ids = [f"UC_{i:03d}" for i in range(50)] + ["UC_050"]
        result = fetch_subscriber_counts(youtube, channel_ids)

        assert len(result) == 51
        assert result["UC_000"] == 0
        assert result["UC_049"] == 4900
        assert result["UC_050"] == 9999
        # 2回 execute が呼ばれている
        assert youtube.channels.return_value.list.return_value.execute.call_count == 2

    def test_APIエラー時は空dictもしくは部分結果を返す(self, caplog):
        """HttpError 発生バッチはスキップされ、警告ログが残る"""
        # HttpError をモックで発生させる（resp と content が必要）
        fake_resp = mock.MagicMock()
        fake_resp.status = 500
        fake_resp.reason = "Server Error"
        http_error = HttpError(resp=fake_resp, content=b"server error")

        youtube = mock.MagicMock()
        youtube.channels.return_value.list.return_value.execute.side_effect = http_error

        with caplog.at_level("WARNING"):
            result = fetch_subscriber_counts(youtube, ["UC_a", "UC_b"])

        # 失敗したバッチ分は dict に含まれない
        assert result == {}
        # WARNING が少なくとも1件出ている
        warning_messages = [r.message for r in caplog.records if r.levelname == "WARNING"]
        assert any("channels.list statistics" in m for m in warning_messages)

    def test_2バッチ目のみエラーでも1バッチ目の結果は残る(self, caplog):
        """部分的に失敗しても、成功したバッチの結果は返る"""
        first_batch_items = [
            _make_channel_item(f"UC_{i:03d}", subscriber_count=str(i + 1))
            for i in range(50)
        ]

        fake_resp = mock.MagicMock()
        fake_resp.status = 503
        fake_resp.reason = "Service Unavailable"
        http_error = HttpError(resp=fake_resp, content=b"unavailable")

        execute_mock = mock.MagicMock()
        execute_mock.side_effect = [
            {"items": first_batch_items},
            http_error,
        ]
        youtube = mock.MagicMock()
        youtube.channels.return_value.list.return_value.execute = execute_mock

        channel_ids = [f"UC_{i:03d}" for i in range(50)] + ["UC_extra"]
        with caplog.at_level("WARNING"):
            result = fetch_subscriber_counts(youtube, channel_ids)

        # 1バッチ目の50件は取得できている
        assert len(result) == 50
        assert result["UC_000"] == 1
        # 2バッチ目の "UC_extra" は失敗で含まれない
        assert "UC_extra" not in result

    def test_空リストを渡すと空dictが返る(self):
        """API を呼ばずに空 dict が返る"""
        youtube = mock.MagicMock()
        result = fetch_subscriber_counts(youtube, [])
        assert result == {}
        # API は呼ばれない
        youtube.channels.assert_not_called()

    def test_subscriberCountが文字列以外でも安全に処理される(self, caplog):
        """変換不能な値は None になり警告が出る"""
        items = [
            {"id": "UC_bad", "statistics": {"hiddenSubscriberCount": False, "subscriberCount": "not-a-number"}},
        ]
        youtube = _make_youtube_mock([items])

        with caplog.at_level("WARNING"):
            result = fetch_subscriber_counts(youtube, ["UC_bad"])

        assert result["UC_bad"] is None


class TestFetchVideoDetails:
    """_fetch_video_details の statistics（再生数）取得テスト（4-3）"""

    def _make_videos_mock(self, items: list[dict]) -> mock.MagicMock:
        """videos().list().execute() が items を返す youtube モック"""
        youtube = mock.MagicMock()
        youtube.videos.return_value.list.return_value.execute.return_value = {
            "items": items
        }
        return youtube

    def test_statisticsがpartに含まれviewCountがパースされる(self):
        """part=statistics 追加で view_count が int で取れる（欠落は None）"""
        items = [
            {
                "id": "v1",
                "contentDetails": {"duration": "PT10M"},
                "snippet": {"liveBroadcastContent": "none"},
                "statistics": {"viewCount": "12345"},
            },
            {
                # statistics フィールドごと欠落しているケース
                "id": "v2",
                "contentDetails": {"duration": "PT5M"},
                "snippet": {"liveBroadcastContent": "none"},
            },
        ]
        youtube = self._make_videos_mock(items)

        details = _fetch_video_details(youtube, ["v1", "v2"])

        assert details["v1"]["view_count"] == 12345
        assert details["v1"]["duration"] == "PT10M"  # 既存フィールドは維持
        assert details["v2"]["view_count"] is None
        # part に statistics が含まれる（videos.list は part 数非依存で 1 ユニット）
        kwargs = youtube.videos.return_value.list.call_args.kwargs
        assert "statistics" in kwargs["part"]
        assert "contentDetails" in kwargs["part"]
        assert "snippet" in kwargs["part"]

    def test_viewCountが不正でもNoneで続行(self, caplog):
        """変換不能な viewCount は None になり警告が出る（処理は継続）"""
        items = [
            {
                "id": "v_bad",
                "contentDetails": {},
                "snippet": {},
                "statistics": {"viewCount": "not-a-number"},
            },
        ]
        youtube = self._make_videos_mock(items)

        with caplog.at_level("WARNING"):
            details = _fetch_video_details(youtube, ["v_bad"])

        assert details["v_bad"]["view_count"] is None
