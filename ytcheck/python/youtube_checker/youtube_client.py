"""
YouTube Data API v3 クライアント
チャンネルの動画リスト取得を担当
"""
import logging
import sys
from datetime import datetime, timedelta, timezone

from googleapiclient.discovery import Resource, build
from googleapiclient.errors import HttpError

from config import settings
from models import Video

logger = logging.getLogger(__name__)


def get_youtube_service() -> Resource:
    """YouTube API サービスオブジェクトを作成"""
    return build("youtube", "v3", developerKey=settings.YOUTUBE_API_KEY)


def fetch_subscriber_counts(
    youtube: Resource, channel_ids: list[str]
) -> dict[str, int | None]:
    """
    複数チャンネルの登録者数を一括取得する

    Args:
        youtube: YouTube API クライアント
        channel_ids: 取得対象のチャンネルIDリスト（50件単位でバッチ処理）

    Returns:
        dict: channel_id → 登録者数（int）/ 非公開（None）のマッピング。
              リクエスト失敗時はそのバッチ分は dict に含まれない（呼び元で「未取得」と判定可能）。
    """
    counts: dict[str, int | None] = {}
    if not channel_ids:
        return counts

    # YouTube API は1リクエスト最大50件
    batch_size = 50
    for i in range(0, len(channel_ids), batch_size):
        batch = channel_ids[i:i + batch_size]
        try:
            response = youtube.channels().list(
                part="statistics",
                id=",".join(batch)
            ).execute()
        except HttpError as e:
            # 致命化させず、このバッチをスキップ（呼び元で未取得と扱える）
            logger.warning(f"YouTube APIエラー (channels.list statistics): {e}")
            continue
        except Exception as e:
            logger.warning(f"登録者数取得で予期せぬエラー: {e}")
            continue

        for item in response.get("items", []):
            ch_id = item.get("id")
            if not ch_id:
                continue
            statistics = item.get("statistics", {})
            # hiddenSubscriberCount=True のチャンネルは登録者数非公開
            if statistics.get("hiddenSubscriberCount"):
                counts[ch_id] = None
                continue

            sub_count_raw = statistics.get("subscriberCount")
            if sub_count_raw is None:
                # 想定外だがフィールド欠落なら None 扱いで続行
                logger.warning(f"subscriberCount が取得できませんでした: {ch_id}")
                counts[ch_id] = None
                continue

            try:
                counts[ch_id] = int(sub_count_raw)
            except (TypeError, ValueError):
                logger.warning(f"subscriberCount を int 変換できませんでした: {ch_id}={sub_count_raw}")
                counts[ch_id] = None

    return counts


def get_channel_uploads_playlist_id(youtube: Resource, channel_id: str) -> str:
    """
    チャンネルのアップロードプレイリストIDを取得

    Raises:
        ValueError: チャンネルが見つからない場合
        HttpError: APIエラーの場合
    """
    logger.debug(f"チャンネル {channel_id} のプレイリストIDを取得中...")
    try:
        request = youtube.channels().list(
            part="contentDetails",
            id=channel_id
        )
        response = request.execute()
    except HttpError as e:
        logger.error(f"YouTube APIエラー (channels.list): {e}")
        raise

    if not response.get("items"):
        error_msg = f"チャンネル {channel_id} が見つかりません"
        logger.error(error_msg)
        raise ValueError(error_msg)

    return response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]


def _fetch_video_details(youtube: Resource, video_ids: list[str]) -> dict[str, dict]:
    """
    動画IDリストの詳細情報（duration, liveBroadcastContent, viewCount）を一括取得

    part に statistics を含めても videos.list のクォータは 1コール=1ユニットで
    変わらない（part 数非依存、公式リファレンス確認済み）。

    Args:
        youtube: YouTube API クライアント
        video_ids: 動画IDのリスト（最大50件ずつバッチ処理）

    Returns:
        dict: video_id → {duration, is_live_archive, view_count} のマッピング
    """
    details: dict[str, dict] = {}
    # YouTube API は1リクエスト最大50件
    batch_size = 50
    for i in range(0, len(video_ids), batch_size):
        batch = video_ids[i:i + batch_size]
        try:
            response = youtube.videos().list(
                part="contentDetails,snippet,statistics",
                id=",".join(batch)
            ).execute()
        except HttpError as e:
            logger.error(f"YouTube APIエラー (videos.list): {e}")
            continue

        for item in response.get("items", []):
            vid = item["id"]
            content_details = item.get("contentDetails", {})
            snippet = item.get("snippet", {})
            # liveBroadcastContent: "live" | "none" | "upcoming"
            live_content = snippet.get("liveBroadcastContent", "none")

            # 再生数（バズ検知バッジ用）。欠落・変換不能は None で続行
            view_count_raw = item.get("statistics", {}).get("viewCount")
            view_count: int | None
            try:
                view_count = int(view_count_raw) if view_count_raw is not None else None
            except (TypeError, ValueError):
                logger.warning(
                    f"viewCount を int 変換できませんでした: {vid}={view_count_raw}"
                )
                view_count = None

            details[vid] = {
                "duration": content_details.get("duration"),
                # アーカイブ済みライブ配信は liveBroadcastContent が "none" になるが
                # actualEndTime が snippet に含まれないため、
                # contentDetails.contentRating やタイトル判定で補完するより、
                # 公開済みで duration が長い動画をライブアーカイブと推定する実装は複雑なため
                # ここでは snippet の liveBroadcastContent を参考値として保持
                "is_live_archive": live_content == "live",
                "view_count": view_count,
            }
    return details


def get_recent_videos(youtube: Resource, channel_id: str, days: int | None = None) -> list[Video]:
    """
    指定チャンネルの直近N日の動画リストを取得

    Args:
        youtube: YouTube API クライアント
        channel_id: YouTubeチャンネルID
        days: 取得する日数（Noneの場合は設定値を使用）

    Returns:
        list[Video]: 動画情報のリスト
    """
    target_days = days if days is not None else settings.CHECK_DAYS

    # アップロードプレイリストIDを取得
    try:
        playlist_id = get_channel_uploads_playlist_id(youtube, channel_id)
    except Exception:
        # ログは下位関数で出力済み
        raise

    # 公開日フィルタ（直近N日）
    published_after = datetime.now(timezone.utc) - timedelta(days=target_days)
    published_after_str = published_after.isoformat().replace("+00:00", "Z")

    logger.info(f"直近 {target_days} 日 ({published_after_str} 以降) の動画を取得します")

    # まず基本情報（video_id, title, published_at）を収集
    raw_videos: list[dict] = []
    next_page_token: str | None = None

    # 取得上限（無限ループ防止）
    max_pages = 10
    page = 0

    while page < max_pages:
        request = youtube.playlistItems().list(
            part="snippet",
            playlistId=playlist_id,
            maxResults=50,
            pageToken=next_page_token
        )
        try:
            response = request.execute()
        except HttpError as e:
            logger.error(f"YouTube APIエラー (playlistItems.list): {e}")
            raise

        for item in response.get("items", []):
            snippet = item["snippet"]
            published_at_str = snippet["publishedAt"]

            # ISO format handling with Z
            try:
                published_at = datetime.fromisoformat(published_at_str.replace("Z", "+00:00"))
            except ValueError:
                logger.warning(f"日付形式のパースに失敗: {published_at_str}")
                continue

            # 公開日フィルタ
            if published_at < published_after:
                logger.debug("指定期間外の動画に到達しました。取得を終了します。")
                # 以降の動画も古いので即返却（詳細取得フェーズへ）
                next_page_token = None
                break

            raw_videos.append({
                "video_id": snippet["resourceId"]["videoId"],
                "title": snippet["title"],
                "published_at": published_at,
            })

        # 次のページがあれば取得
        next_page_token = response.get("nextPageToken")
        if not next_page_token:
            break

        page += 1

    if not raw_videos:
        return []

    # 動画IDリストで duration / is_live_archive を一括取得
    video_ids = [v["video_id"] for v in raw_videos]
    details = _fetch_video_details(youtube, video_ids)

    videos: list[Video] = []
    for v in raw_videos:
        vid = v["video_id"]
        detail = details.get(vid, {})
        videos.append(Video(
            video_id=vid,
            title=v["title"],
            published_at=v["published_at"],
            duration=detail.get("duration"),
            is_live_archive=detail.get("is_live_archive", False),
            view_count=detail.get("view_count"),
        ))

    return videos


def main() -> None:
    """
    単体テスト用のメイン関数
    """
    if len(sys.argv) < 2:
        print("使用方法: python youtube_client.py <チャンネルID>", file=sys.stderr)
        sys.exit(1)

    channel_id = sys.argv[1]

    # コンソールログの設定（単体テスト時のみ）
    if not logger.handlers:
        logging.basicConfig(level=logging.INFO)

    try:
        youtube = get_youtube_service()
        videos = get_recent_videos(youtube, channel_id)

        print(f"チャンネル {channel_id} の直近 {settings.CHECK_DAYS} 日の動画:")
        for video in videos:
            print(f"  - {video.title} ({video.video_id})")
        print(f"\n合計: {len(videos)}件")

    except HttpError as e:
        logger.error(f"YouTube API エラー: {e}")
        sys.exit(1)
    except ValueError as e:
        logger.error(f"エラー: {e}")
        sys.exit(1)
    except Exception as e:
        logger.exception(f"予期せぬエラー: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
