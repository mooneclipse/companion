"""
YouTube巡回・字幕解析・AI推薦 メインスクリプト
"""
import argparse
import asyncio
import io
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from googleapiclient.discovery import Resource
from googleapiclient.errors import HttpError

import ai_evaluator
import channel_store
import output_formatter
import subtitle_fetcher
import youtube_client
from config import settings
from evaluation_cache import EvaluationCache
from models import EvaluationResult, RunStats, Video, determine_tier
from title_normalizer import (
    extract_collab_key,
    extract_series_key,
    is_excluded_video,
)

logger = logging.getLogger(__name__)

# プロジェクトルートからのチャンネルリストJSONパス
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_CHANNEL_LIST = _PROJECT_ROOT / "tasks" / "youtube-channels.json"


def load_channel_list(path: Path | None = None) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """
    チャンネルリストJSONを読み込む

    Args:
        path: JSONファイルのパス（省略時はデフォルトパス）

    Returns:
        tuple[dict[str, str], list[dict[str, Any]]]: (ジャンルマッピング, チャンネル情報リスト)

    Raises:
        FileNotFoundError: ファイルが見つからない場合
        json.JSONDecodeError: JSONパースエラーの場合
    """
    target_path = path or _DEFAULT_CHANNEL_LIST
    logger.info(f"チャンネルリストを読み込み中: {target_path}")

    if not target_path.exists():
        raise FileNotFoundError(f"チャンネルリストが見つかりません: {target_path}")

    with open(target_path, encoding="utf-8") as f:
        data = json.load(f)

    # ジャンルマッピングの読み込み（存在しない場合はデフォルト使用）
    genres: dict[str, str] = data.get("genres", settings.DEFAULT_GENRES)
    channels: list[dict[str, Any]] = data.get("channels", [])
    if not channels:
        logger.warning("チャンネルリストが空です")

    return genres, channels


def _refresh_subscriber_cache(
    youtube: Resource,
    channels: list[dict[str, Any]],
    channel_list_path: Path,
    force: bool = False,
    cache_days: int | None = None,
) -> None:
    """
    チャンネルリストの登録者数キャッシュを必要に応じて更新し、JSON を上書き保存する

    更新対象は次のいずれか:
    - subscriber_count_updated_at が None または `cache_days` 日より前
    - force=True（全件再取得）

    取得失敗時は古い値を保持し、警告ログを出す。

    Args:
        youtube: YouTube API クライアント
        channels: load_channel_list 戻り値の channels リスト（インプレースで更新される）
        channel_list_path: 書き戻し先の JSON パス
        force: True で全チャンネル強制更新
        cache_days: 何日以上前のキャッシュを再取得対象とするか。
            None の場合は `settings.SUBSCRIBER_CACHE_DAYS` を使用
    """
    effective_cache_days = cache_days if cache_days is not None else settings.SUBSCRIBER_CACHE_DAYS
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=effective_cache_days)

    targets: list[str] = []
    for ch in channels:
        ch_id = ch.get("channel_id")
        if not ch_id:
            continue
        if force:
            targets.append(ch_id)
            continue

        updated_at_str = ch.get("subscriber_count_updated_at")
        if not updated_at_str:
            targets.append(ch_id)
            continue

        try:
            # ISO 8601 (末尾 Z は +00:00 に置換してパース)
            parsed = datetime.fromisoformat(str(updated_at_str).replace("Z", "+00:00"))
        except ValueError:
            logger.warning(f"subscriber_count_updated_at のパースに失敗: {ch_id}={updated_at_str}")
            targets.append(ch_id)
            continue

        # 自然なタイムゾーン補正（古い記録が naive だった場合は UTC とみなす）
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)

        if parsed < threshold:
            targets.append(ch_id)

    if not targets:
        logger.info("登録者数キャッシュは全件最新です（更新スキップ）")
        return

    logger.info(f"登録者数キャッシュを更新します（{len(targets)} 件）")
    counts = youtube_client.fetch_subscriber_counts(youtube, targets)

    if not counts:
        logger.warning("登録者数の取得に失敗しました（全バッチ）。古い値を保持します。")
        return

    now_iso = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for ch in channels:
        ch_id = ch.get("channel_id")
        if ch_id in counts:
            ch["subscriber_count"] = counts[ch_id]
            ch["subscriber_count_updated_at"] = now_iso

    # 取得対象だが counts に含まれないチャンネル（=バッチ失敗）
    missing = [c for c in targets if c not in counts]
    if missing:
        logger.warning(f"登録者数を取得できなかったチャンネル: {len(missing)} 件（古い値を保持）")

    # JSON への書き戻しは channel_store 経由（flock + atomic write + 自動 commit、#69）。
    # load_channel_list 後に他プロセス (companion-remote の編集 API) が行った
    # 追加・削除・編集を消さないよう、メモリ上の channels 全体は書かず
    # subscriber_count / subscriber_count_updated_at の 2 フィールドだけ merge する
    try:
        merged = channel_store.merge_subscriber_counts(
            counts, now_iso, path=channel_list_path
        )
        logger.info(f"登録者数キャッシュを更新しました（更新: {merged} 件、保存先: {channel_list_path}）")
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(f"チャンネルリスト JSON の書き戻しに失敗: {e}")


def _select_model(favorite: int) -> str | None:
    """
    チャンネルの好き度から評価に使うモデルを決定する

    favorite 1-2（推薦閾値 7-8 で期待値が低い層）は軽量モデル
    （settings.LOW_FAVORITE_MODEL）に振り分けてコストを下げる。
    favorite 3 以上は None を返し、--model 指定なし = 現行デフォルトモデルを使う。
    """
    if favorite <= 2:
        return settings.LOW_FAVORITE_MODEL
    return None


def _build_success_result(
    video: Video,
    channel_name: str,
    subtitle_text: str,
    score: int,
    reason: str,
    genre: str,
    highlights: list[str],
    tier: Literal["small", "mid", "large"],
    subscriber_count: int | None,
    series_key: str | None,
    collab_key: str | None,
    highlight_seconds: list[int] | None = None,
) -> EvaluationResult:
    """
    AI評価成功後の後処理を行い EvaluationResult を組み立てる

    後処理の内容（process_video と pending 再評価で共通）:
    - AI返却ジャンルベースの評価対象外再判定（歌枠等を AI が返したケース）
    - 「字幕で判断不可」判定による評価対象外送り
    - 盛り上がりシグナル集計（タイブレーカー用）
    - スコア0 のフォールバック理由判定

    highlight_seconds は字幕 cue から検出した見どころ開始秒（4-1）。
    pending 再評価は cue を保存していないため省略可能（デフォルト空）。
    """
    # AI返却ジャンルベースで再判定（歌枠等を AI が返したケース）
    excluded2, exclude_reason2 = is_excluded_video(
        video.title, ai_genre=genre, channel_name=channel_name
    )
    if excluded2:
        logger.info(f"AI返却ジャンルで評価対象外: {video.title} - 理由: {exclude_reason2}")
        return EvaluationResult(
            video=video,
            has_subtitles=True,
            score=0,
            reason="",
            genre=genre,
            highlights=highlights,
            tier=tier,
            subscriber_count=subscriber_count,
            is_excluded=True,
            exclude_reason=exclude_reason2,
            series_key=series_key,
            collab_key=collab_key,
            duration_minutes=video.duration_minutes,
        )

    # AI が「字幕で判断不可」と返した場合は評価対象外送り（MEDIUM-6）
    # 評価理由には "[Claude評価] " プレフィックスが付くため、除去してから比較する
    # （従来の完全一致はプレフィックス付きでは成立せず判定が機能していなかった）
    reason_core = reason.strip()
    if reason_core.startswith("[Claude評価]"):
        reason_core = reason_core[len("[Claude評価]"):].strip()
    if reason_core.rstrip("。．.").strip() == "字幕で判断不可":
        logger.info(f"AI判定で字幕で判断不可: {video.title}")
        return EvaluationResult(
            video=video,
            has_subtitles=True,
            score=0,
            reason="",
            genre=genre,
            highlights=highlights,
            tier=tier,
            subscriber_count=subscriber_count,
            is_excluded=True,
            exclude_reason="字幕で判断不可",
            series_key=series_key,
            collab_key=collab_key,
            duration_minutes=video.duration_minutes,
        )

    # 盛り上がりシグナル数を取得（タイブレーカー用）
    signals = subtitle_fetcher.analyze_excitement_signals(subtitle_text)
    laugh_count = int(signals.get("laugh_count", 0) or 0)
    surprise_count = int(signals.get("surprise_count", 0) or 0)

    # スコア0 のフォールバック理由判定
    score_zero_reason: str | None = None
    if score == 0:
        if reason.startswith("評価失敗（データ保存先:"):
            score_zero_reason = "ai_failed"
        else:
            score_zero_reason = "low_signal"

    return EvaluationResult(
        video=video,
        has_subtitles=True,
        score=score,
        reason=reason,
        genre=genre,
        highlights=highlights,
        tier=tier,
        subscriber_count=subscriber_count,
        laugh_signal_count=laugh_count,
        surprise_signal_count=surprise_count,
        duration_minutes=video.duration_minutes,
        series_key=series_key,
        collab_key=collab_key,
        score_zero_reason=score_zero_reason,
        highlight_seconds=highlight_seconds or [],
    )


async def process_video(
    video: Video,
    semaphore: asyncio.Semaphore,
    channel_id: str = "",
    channel_name: str = "",
    sub_lang: str = "ja",
    tier: Literal["small", "mid", "large"] = "mid",
    subscriber_count: int | None = None,
    model: str | None = None,
) -> EvaluationResult:
    """
    1つの動画を処理する（評価対象外フィルタ -> 字幕取得 -> AI評価）

    Args:
        video: 動画情報
        semaphore: 同時実行数制御用セマフォ
        channel_id: チャンネルID（レートリミット時のファイル出力用）
        channel_name: チャンネル名（評価対象外フィルタで使用）
        sub_lang: 字幕言語コード（例: "ja", "ja,en"）。デフォルトは日本語のみ
        tier: 評価層。"small" の場合は SMALL 用プロンプトで評価する。
              デフォルトは "mid"（既存挙動）。
        model: AI評価に使うモデル名（claude -p --model）。None はデフォルトモデル。
        subscriber_count: 評価時点の登録者数。EvaluationResult に保存される。

    Returns:
        EvaluationResult: 評価結果
    """
    async with semaphore:
        logger.info(f"処理開始: {video.title} ({video.video_id}) tier={tier}")

        # 投稿日バケット（コラボキー用、YYYY-MM-DD）
        published_at_bucket = video.published_at.strftime("%Y-%m-%d")
        series_key = extract_series_key(video.title, channel_id)
        collab_key = extract_collab_key(video.title, published_at_bucket)

        # 評価対象外（歌・踊り・カバー・チャンネル単位除外）の早期判定
        excluded, exclude_reason = is_excluded_video(
            video.title, ai_genre="", channel_name=channel_name
        )
        if excluded:
            logger.info(f"評価対象外: {video.title} - 理由: {exclude_reason}")
            return EvaluationResult(
                video=video,
                has_subtitles=False,
                score=0,
                reason="",
                tier=tier,
                subscriber_count=subscriber_count,
                is_excluded=True,
                exclude_reason=exclude_reason,
                series_key=series_key,
                collab_key=collab_key,
                duration_minutes=video.duration_minutes,
            )

        try:
            # 1. 字幕取得（指定された言語コードで取得）
            # 見どころタイムスタンプ検出（4-1）に cue の開始秒が必要なため
            # タイムスタンプ付き版を使う（fetch_subtitle 自体は互換維持で存置）
            has_subtitles, subtitle_text, cues = await subtitle_fetcher.fetch_subtitle_timed(
                video.video_id, sub_lang
            )

            if not has_subtitles:
                logger.warning(f"字幕なし: {video.title}")
                return EvaluationResult(
                    video=video,
                    has_subtitles=False,
                    reason="字幕が取得できませんでした",
                    tier=tier,
                    subscriber_count=subscriber_count,
                    score_zero_reason="no_subtitles",
                    series_key=series_key,
                    collab_key=collab_key,
                    duration_minutes=video.duration_minutes,
                )

            # 2. AI評価（タイトル・tier・モデルを渡す）
            score, reason, genre, highlights = await ai_evaluator.evaluate_subtitle(
                subtitle_text=subtitle_text,
                video_id=video.video_id,
                title=video.title,
                published_at=video.published_at.isoformat(),
                channel_id=channel_id,
                tier=tier,
                model=model,
            )
            logger.info(f"評価完了: {video.title} - スコア: {score}/10 (tier={tier})")

            # 見どころタイムスタンプの検出（笑い・驚きシグナルの集中箇所、最大3件）
            highlight_seconds = subtitle_fetcher.detect_highlight_seconds(cues)

            # 評価後の共通後処理（除外再判定・判断不可判定・シグナル集計）
            return _build_success_result(
                video=video,
                channel_name=channel_name,
                subtitle_text=subtitle_text,
                score=score,
                reason=reason,
                genre=genre,
                highlights=highlights,
                tier=tier,
                subscriber_count=subscriber_count,
                series_key=series_key,
                collab_key=collab_key,
                highlight_seconds=highlight_seconds,
            )

        except Exception as e:
            logger.error(f"処理エラー ({video.video_id}): {e}")
            return EvaluationResult(
                video=video,
                has_subtitles=False,
                error=str(e),
                reason=f"エラーが発生しました: {str(e)}",
                tier=tier,
                subscriber_count=subscriber_count,
                score_zero_reason="unhandled_exception",
                series_key=series_key,
                collab_key=collab_key,
                duration_minutes=video.duration_minutes,
            )


async def process_single_channel(
    channel_id: str,
    channel_name: str,
    days: int,
    output_format: str,
    genre: str = "indie",
    favorite: int = 3,
    sub_lang: str = "ja",
    youtube: Resource | None = None,
    subscriber_count: int | None = None,
    cache: EvaluationCache | None = None,
) -> dict[str, Any]:
    """
    単一チャンネルを処理し、結果を辞書で返す

    Args:
        channel_id: YouTubeチャンネルID
        channel_name: チャンネル名
        days: 取得する日数
        output_format: 出力形式（"json" or "text"）
        genre: ジャンルID（デフォルト: "indie"）
        favorite: 好き度（1-5、デフォルト: 3）
        sub_lang: 字幕言語コード（例: "ja", "ja,en"）。デフォルトは日本語のみ
        youtube: YouTube API クライアント。None の場合は内部で生成（後方互換）
        subscriber_count: 登録者数。None の場合は層判定で SMALL 扱い（拾い上げ寄り）。
        cache: 評価済みキャッシュ。None の場合はキャッシュ無効（従来動作・後方互換）。
            指定時はキャッシュヒット動画を字幕取得ごとスキップし、
            新規評価の確定結果をキャッシュへ登録する。

    Returns:
        dict[str, Any]: チャンネルの巡回結果
            （genre, favorite, tier, subscriber_count, cache_skipped を含む）
    """
    # YouTube API クライアントが渡されなかった場合のみ生成（後方互換を保つ）
    if youtube is None:
        youtube = youtube_client.get_youtube_service()

    # 登録者数から層を判定する（None は small 扱い）
    tier = determine_tier(subscriber_count, settings.TIER_THRESHOLDS)

    # 直近の動画リスト取得（同期I/Oをスレッドプールで実行してイベントループをブロックしない）
    logger.info(
        f"チャンネル {channel_name} ({channel_id}) の直近 {days} 日の動画を取得中... "
        f"(tier={tier}, subscriber_count={subscriber_count})"
    )
    videos = await asyncio.to_thread(youtube_client.get_recent_videos, youtube, channel_id, days)
    logger.info(f"{len(videos)} 件の動画を取得しました")

    # 評価済みキャッシュヒットのフィルタ（字幕取得の前段で除外 = 字幕取得ごとスキップ）
    # キャッシュヒット動画はレポートに再掲しない方針のため results には入れない
    cache_skipped = 0
    if cache is not None:
        fresh_videos: list[Video] = []
        for video in videos:
            if cache.contains(video.video_id):
                cache_skipped += 1
                logger.info(
                    f"キャッシュヒットでスキップ: {video.title} ({video.video_id})"
                )
            else:
                fresh_videos.append(video)
        videos = fresh_videos

    if not videos:
        return {
            "channel_name": channel_name,
            "channel_id": channel_id,
            "genre": genre,
            "favorite": favorite,
            "tier": tier,
            "subscriber_count": subscriber_count,
            "videos": [],
            "cache_skipped": cache_skipped,
        }

    # 好き度からモデルを決定（favorite 1-2 は軽量モデル、3 以上はデフォルト）
    model = _select_model(favorite)

    # 並列処理の準備（sub_lang / tier / subscriber_count / model を各動画処理に渡す）
    semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_TASKS)
    tasks = [
        process_video(
            video, semaphore, channel_id,
            channel_name=channel_name,
            sub_lang=sub_lang,
            tier=tier, subscriber_count=subscriber_count,
            model=model,
        )
        for video in videos
    ]

    # 全タスク実行（return_exceptions=True で1件の失敗が全体に波及しない）
    logger.info(f"動画の解析を開始します（同時実行数: {settings.MAX_CONCURRENT_TASKS}）...")
    raw_results: list[EvaluationResult | BaseException] = await asyncio.gather(
        *tasks, return_exceptions=True
    )

    # 例外を EvaluationResult(error=...) に正規化
    results: list[EvaluationResult] = []
    for video, result in zip(videos, raw_results):
        if isinstance(result, BaseException):
            logger.error(f"動画処理中に未捕捉例外 ({video.video_id}): {result}")
            results.append(EvaluationResult(
                video=video,
                has_subtitles=False,
                error=str(result),
                reason=f"予期せぬエラーが発生しました: {result}",
                tier=tier,
                subscriber_count=subscriber_count,
                score_zero_reason="unhandled_exception",
            ))
        else:
            results.append(result)

    # 新規評価の確定結果をキャッシュへ登録（失敗系・字幕なしは is_cacheable で弾かれる）
    if cache is not None:
        for r in results:
            cache.add(r)

    return {
        "channel_name": channel_name,
        "channel_id": channel_id,
        "genre": genre,
        "favorite": favorite,
        "tier": tier,
        "subscriber_count": subscriber_count,
        "videos": [r.model_dump(mode="json") for r in results],
        "cache_skipped": cache_skipped,
    }


def _resolve_pending_dir() -> Path:
    """
    pending_evaluations ディレクトリの絶対パスを解決する

    settings.PENDING_EVALUATION_DIR は相対パス（CWD 依存）で保存側
    （ai_evaluator.save_pending_evaluation）が使っているが、
    リトライ側は CWD に依存しないようモジュール位置でアンカーする。
    ytcheck.bat はプロジェクトディレクトリへ cd してから実行するため両者は一致する。
    """
    p = Path(settings.PENDING_EVALUATION_DIR)
    if p.is_absolute():
        return p
    return Path(__file__).resolve().parent / p


async def _retry_pending_evaluations(
    channels: list[dict[str, Any]],
    cache: EvaluationCache | None = None,
    stats: RunStats | None = None,
) -> list[dict[str, Any]]:
    """
    pending_evaluations/ の未評価データ（レートリミット等での失敗分）を再評価する

    成功した pending はファイルを削除してキャッシュへ登録する。
    結果は既存チャンネル結果へのマージではなく、チャンネル単位の独立した
    結果 dict（run_all_channels の結果と同形式）として返す。
    レポートは全チャンネルの動画をフラットに集計するため表示上の差異はなく、
    当該チャンネルの巡回結果と突き合わせる必要がない分こちらの方が単純なため。
    失敗した pending はファイルを残し、次回実行時に再挑戦する。

    Args:
        channels: チャンネルリスト（tier / favorite の引き直し用）
        cache: 評価済みキャッシュ（None の場合は登録しない）
        stats: 実行統計（None の場合は集計しない）

    Returns:
        list[dict[str, Any]]: チャンネル単位の再評価結果リスト（成功分のみ）
    """
    pending_dir = _resolve_pending_dir()
    files = sorted(pending_dir.glob("pending_*.json")) if pending_dir.exists() else []
    if not files:
        return []

    logger.info(f"pending 再評価を開始します（{len(files)} 件）")

    # channel_id -> チャンネル情報の索引（pending は tier / favorite を持たないため引き直す）
    channel_index: dict[str, dict[str, Any]] = {
        ch["channel_id"]: ch for ch in channels if ch.get("channel_id")
    }
    semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_TASKS)

    async def _retry_one(filepath: Path) -> dict[str, Any] | None:
        """1件の pending を再評価する（成功時はチャンネル情報付き dict を返す）"""
        try:
            with open(filepath, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(
                f"pending ファイルの読み込みに失敗（スキップ・保持）: {filepath.name}: {e}"
            )
            return None

        video_info = data.get("video", {})
        video_id: str = video_info.get("video_id", "")
        subtitle_text: str = data.get("subtitle_text", "")
        if not video_id or not subtitle_text:
            logger.warning(
                f"pending ファイルに必要な情報がありません（スキップ・保持）: {filepath.name}"
            )
            return None

        if stats is not None:
            stats.pending_retried += 1

        title: str = video_info.get("title", "")
        channel_id: str = video_info.get("channel_id", "")

        # チャンネルリストから tier / favorite を引き直す
        # 不明時（リストから削除済み等）は tier="mid" / favorite=3 にフォールバック
        ch = channel_index.get(channel_id)
        if ch is not None:
            channel_name: str = ch.get("name", channel_id)
            favorite: int = ch.get("favorite", 3)
            genre: str = ch.get("genre", "indie")
            subscriber_count: int | None = ch.get("subscriber_count")
            tier: Literal["small", "mid", "large"] = determine_tier(
                subscriber_count, settings.TIER_THRESHOLDS
            )
        else:
            channel_name = channel_id or "不明"
            favorite = 3
            genre = "indie"
            subscriber_count = None
            tier = "mid"

        # published_at のパース（不正値は現在時刻でフォールバック）
        published_raw = str(video_info.get("published_at", ""))
        try:
            published_at = datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
        except ValueError:
            logger.warning(
                f"pending の published_at をパースできません: {published_raw}"
            )
            published_at = datetime.now(timezone.utc)

        video = Video(video_id=video_id, title=title, published_at=published_at)

        # 引き直した favorite からモデルを決定（favorite<=2 は軽量モデル、
        # チャンネル不明時は favorite=3 フォールバック = デフォルトモデル）
        model = _select_model(favorite)
        logger.info(
            f"pending 再評価: {title} (tier={tier}, model={model or 'デフォルト'})"
        )

        async with semaphore:
            try:
                # 保存済みの evaluation_prompt は旧テンプレートで描画済みのため使わず、
                # subtitle_text から最新テンプレートでプロンプトを再生成して評価する。
                # evaluate_subtitle 経由だと失敗時に pending が二重保存されるため
                # evaluate_with_claude_code を直接呼ぶ（失敗時は元ファイルを保持）。
                evaluated = await ai_evaluator.evaluate_with_claude_code(
                    subtitle_text, title=title, tier=tier, model=model
                )
                score, reason, ai_genre, highlights = evaluated
            except Exception as e:
                logger.warning(
                    f"pending 再評価に失敗（ファイル保持・次回持ち越し）: {filepath.name}: {e}"
                )
                if stats is not None:
                    stats.pending_failed += 1
                return None

        # 評価後の共通後処理（除外再判定・判断不可判定・シグナル集計）
        series_key = extract_series_key(title, channel_id)
        collab_key = extract_collab_key(title, published_at.strftime("%Y-%m-%d"))
        result = _build_success_result(
            video=video,
            channel_name=channel_name,
            subtitle_text=subtitle_text,
            score=score,
            reason=reason,
            genre=ai_genre,
            highlights=highlights,
            tier=tier,
            subscriber_count=subscriber_count,
            series_key=series_key,
            collab_key=collab_key,
        )

        # 成功: pending ファイルを削除してキャッシュへ登録
        try:
            filepath.unlink()
        except OSError as e:
            logger.warning(f"pending ファイルの削除に失敗: {filepath.name}: {e}")
        if cache is not None:
            cache.add(result)
        if stats is not None:
            stats.pending_succeeded += 1
        logger.info(f"pending 再評価成功: {title} - スコア: {result.score}/10")

        return {
            "channel_id": channel_id,
            "channel_name": channel_name,
            "genre": genre,
            "favorite": favorite,
            "tier": tier,
            "subscriber_count": subscriber_count,
            "result": result,
        }

    raw_items = await asyncio.gather(*(_retry_one(f) for f in files))

    # チャンネル単位にグルーピングして run_all_channels の結果と同形式にする
    grouped: dict[str, dict[str, Any]] = {}
    for item in raw_items:
        if item is None:
            continue
        key = item["channel_id"] or item["channel_name"]
        if key not in grouped:
            grouped[key] = {
                "channel_name": item["channel_name"],
                "channel_id": item["channel_id"],
                "genre": item["genre"],
                "favorite": item["favorite"],
                "tier": item["tier"],
                "subscriber_count": item["subscriber_count"],
                "videos": [],
                # pending 再評価由来であることの目印（レポート整形には影響しない）
                "from_pending_retry": True,
            }
        grouped[key]["videos"].append(item["result"].model_dump(mode="json"))

    succeeded = sum(len(g["videos"]) for g in grouped.values())
    logger.info(f"pending 再評価が完了しました（成功: {succeeded} / {len(files)} 件）")
    return list(grouped.values())


async def run_all_channels(
    channel_list_path: Path | None = None,
    refresh_subscribers: bool = False,
    cache: EvaluationCache | None = None,
    retry_pending: bool = False,
    stats: RunStats | None = None,
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """
    チャンネルリストJSONから全チャンネルを一括巡回する

    Args:
        channel_list_path: チャンネルリストJSONのパス（省略時はデフォルト）
        refresh_subscribers: True で全チャンネルの登録者数を強制再取得する
        cache: 評価済みキャッシュ。None の場合はキャッシュ無効（従来動作・後方互換）
        retry_pending: True で巡回冒頭に pending_evaluations/ の自動リトライを行う
        stats: 実行統計。渡された場合はインプレースで集計する
            （戻り値の 2-tuple を維持するため別経路で受け渡す）

    Returns:
        tuple[dict[str, str], list[dict[str, Any]]]: (ジャンルマッピング, 全チャンネル巡回結果)
    """
    started = time.monotonic()
    target_path = channel_list_path or _DEFAULT_CHANNEL_LIST
    genres, channels = load_channel_list(target_path)
    all_results: list[dict[str, Any]] = []

    # pending 自動リトライ
    # （キャッシュ登録が先に走るため、後続の巡回で同一動画はスキップされる）
    if retry_pending:
        pending_results = await _retry_pending_evaluations(
            channels, cache=cache, stats=stats
        )
        all_results.extend(pending_results)
        if cache is not None:
            cache.save()

    # YouTube API クライアントをループ外で1回だけ生成して使い回す
    youtube = youtube_client.get_youtube_service()

    # 登録者数キャッシュを必要に応じて更新（cache_days のデフォルトは settings.SUBSCRIBER_CACHE_DAYS）
    _refresh_subscriber_cache(
        youtube,
        channels,
        target_path,
        force=refresh_subscribers,
    )

    for ch in channels:
        channel_id: str = ch["channel_id"]
        channel_name: str = ch.get("name", channel_id)
        check_days: int = ch.get("check_days", settings.CHECK_DAYS)
        genre: str = ch.get("genre", "indie")
        favorite: int = ch.get("favorite", 3)
        # 新フィールド未追加チャンネル（自動追加直後など）に備えて .get() で安全に読む
        subscriber_count: int | None = ch.get("subscriber_count")

        # 英語チャンネルは日本語字幕が存在しないため ja,en の両方を試みる
        sub_lang = "ja,en" if genre == "english" else "ja"

        logger.info(
            f"--- チャンネル巡回開始: {channel_name} "
            f"(期間: {check_days}日, ジャンル: {genre}, 好き度: {favorite}, "
            f"字幕言語: {sub_lang}, 登録者数: {subscriber_count}) ---"
        )

        try:
            result = await process_single_channel(
                channel_id=channel_id,
                channel_name=channel_name,
                days=check_days,
                output_format="json",
                genre=genre,
                favorite=favorite,
                sub_lang=sub_lang,
                youtube=youtube,
                subscriber_count=subscriber_count,
                cache=cache,
            )
            all_results.append(result)

            # 実行統計の集計（process_single_channel の結果 dict から算出する）
            if stats is not None:
                stats.cache_skipped += result.get("cache_skipped", 0)
                for v in result.get("videos", []):
                    stats.processed += 1
                    if v.get("is_excluded"):
                        stats.excluded += 1
                    zero_reason = v.get("score_zero_reason")
                    if zero_reason == "no_subtitles":
                        stats.subtitle_failures += 1
                    elif zero_reason in ("ai_failed", "unhandled_exception"):
                        stats.ai_failures += 1

            # 途中クラッシュ時も評価済み分を失わないようチャンネルごとに保存する
            if cache is not None:
                cache.save()
        except Exception as e:
            logger.error(f"チャンネル {channel_name} の巡回中にエラー: {e}")
            # エラーが発生しても他のチャンネルは続行する
            all_results.append({
                "channel_name": channel_name,
                "channel_id": channel_id,
                "genre": genre,
                "favorite": favorite,
                "tier": determine_tier(subscriber_count, settings.TIER_THRESHOLDS),
                "subscriber_count": subscriber_count,
                "videos": [],
                "error": str(e),
            })

    if stats is not None:
        stats.elapsed_seconds = time.monotonic() - started

    return genres, all_results


async def async_main() -> None:
    """
    非同期メイン処理
    """
    parser = argparse.ArgumentParser(
        description="YouTube巡回・字幕解析・AI推薦システム"
    )

    # --all と --channel は相互排他（どちらか一方が必須）
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--all",
        action="store_true",
        help="チャンネルリストJSONから全チャンネルを一括巡回する",
    )
    group.add_argument(
        "--channel",
        help="YouTubeチャンネルID (UCxxxx形式)",
    )

    parser.add_argument(
        "--channel-name",
        default="",
        help="チャンネル名（--channel使用時、省略可）"
    )
    parser.add_argument(
        "--days",
        type=int,
        default=settings.CHECK_DAYS,
        help=f"取得する日数（デフォルト: {settings.CHECK_DAYS}日、--all時は各チャンネルのcheck_daysを優先）"
    )
    parser.add_argument(
        "--output",
        choices=["json", "text", "markdown"],
        default="json",
        help="出力形式（デフォルト: json）。markdownは--all専用"
    )
    parser.add_argument(
        "--refresh-subscribers",
        action="store_true",
        help="登録者数キャッシュを全チャンネル強制再取得する（--all 時のみ意味あり）",
    )

    args = parser.parse_args()

    # --output markdown は --all 専用
    if args.output == "markdown" and not args.all:
        parser.error("--output markdown は --all モード専用です")

    try:
        if args.all:
            # 全チャンネル一括巡回モード
            # 評価済みキャッシュ・pending 自動リトライ・実行統計を有効化する
            run_stats = RunStats()
            cache = EvaluationCache()
            genres, all_results = await run_all_channels(
                refresh_subscribers=args.refresh_subscribers,
                cache=cache,
                retry_pending=True,
                stats=run_stats,
            )
            # チャンネルごとに保存済みだが、未保存の変更が残っていた場合に備えて最終保存
            cache.save()

            # 実行サマリーをコンソールにも出す（日次運用で失敗多発に気づけるように）
            logger.info(
                "実行サマリー: 処理 %d / キャッシュスキップ %d / 対象外 %d / "
                "字幕失敗 %d / AI失敗 %d / pending 成功 %d・失敗 %d / 所要 %.1f 秒",
                run_stats.processed,
                run_stats.cache_skipped,
                run_stats.excluded,
                run_stats.subtitle_failures,
                run_stats.ai_failures,
                run_stats.pending_succeeded,
                run_stats.pending_failed,
                run_stats.elapsed_seconds,
            )

            if args.output == "markdown":
                # Markdownレポート生成 + viewing履歴追記
                _markdown_text, report_path = output_formatter.format_markdown_report(
                    genres, all_results, run_stats=run_stats
                )
                viewing_path = output_formatter.update_viewing_history(all_results)

                # おすすめ動画数を集計（チャンネルごとの好き度を考慮）
                recommended_count = sum(
                    1 for ch in all_results
                    for v in ch.get("videos", [])
                    if output_formatter.is_recommended(
                        v, ch.get("favorite", 3), settings.FAVORITE_THRESHOLD_MAP
                    )
                )

                # サマリーJSONを標準出力に出力
                summary = {
                    "mode": "all_channels_markdown",
                    "report_path": report_path,
                    "viewing_history_path": viewing_path,
                    "channel_count": len(all_results),
                    "total_videos": sum(len(ch.get("videos", [])) for ch in all_results),
                    "recommended_count": recommended_count,
                    "run_stats": run_stats.as_dict(),
                }
                print(json.dumps(summary, ensure_ascii=False, indent=2))
            else:
                # 従来のJSON出力
                output_data = {
                    "mode": "all_channels",
                    "genres": genres,
                    "channels": all_results,
                    "run_stats": run_stats.as_dict(),
                }
                print(json.dumps(output_data, ensure_ascii=False, indent=2))
        else:
            # 単一チャンネルモード（従来の動作）
            result = await process_single_channel(
                channel_id=args.channel,
                channel_name=args.channel_name or args.channel,
                days=args.days,
                output_format=args.output,
            )

            if args.output == "json":
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                # テキスト形式
                print(f"\nチャンネル: {result['channel_name']}")
                print(f"取得期間: 直近 {args.days} 日")
                print(f"動画数: {len(result['videos'])} 件\n")

                # スコア順にソート
                sorted_videos = sorted(
                    result["videos"],
                    key=lambda x: x.get("score", 0),
                    reverse=True,
                )

                for v in sorted_videos:
                    video_info = v.get("video", {})
                    print(f"[{v.get('score', 0)}/10] {video_info.get('title', '不明')}")
                    print(f"  理由: {v.get('reason', '')}")
                    print(f"  URL: {video_info.get('url', '')}")
                    if v.get("error"):
                        print(f"  エラー: {v['error']}")
                    print()

    except HttpError as e:
        logger.critical(f"YouTube APIエラー: {e}")
        sys.exit(1)
    except Exception as e:
        logger.critical(f"実行エラー: {e}")
        sys.exit(1)


def main() -> None:
    """
    エントリポイント
    """
    # ロギング初期化はエントリポイントで一元管理（ライブラリ層でのbasicConfig呼び出しを避ける）
    logging.basicConfig(
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        level=settings.LOG_LEVEL,
    )

    # Windows環境でのUTF-8出力対応（絵文字等のUnicode文字を正しく出力するため）
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
        # 注意: WindowsSelectorEventLoopPolicy は create_subprocess_exec 非対応のため使用しない
        # デフォルトの ProactorEventLoop を使う

    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        print("\n中断されました")
        sys.exit(0)


if __name__ == "__main__":
    main()
