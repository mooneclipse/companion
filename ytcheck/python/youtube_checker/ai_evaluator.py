"""
Claude Code CLI を使った字幕評価モジュール

Claude Code CLI がレートリミットに達した場合は、未評価データをファイルに出力し、
後からスキル経由で評価できるようにする。
"""
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from config import settings
from subtitle_fetcher import analyze_excitement_signals

logger = logging.getLogger(__name__)


def truncate_text(text: str, max_tokens: int) -> str:
    """
    テキストを指定トークン数（概算）に切り詰める

    日本語は1文字≒1トークン〜2トークンだが、安全策として文字数で制限する。
    ここでは簡易的に 1文字 = 1トークン とみなして、余裕を持って切り詰める。
    """
    limit_chars = int(max_tokens * 0.8)

    if len(text) <= limit_chars:
        return text

    return text[:limit_chars] + "\n...(以下省略)"


def sample_subtitle_segments(text: str, total_chars: int) -> str:
    """
    字幕テキストを冒頭・中盤・終盤の3点からサンプリングする

    total_chars を3等分したセグメント長で冒頭・中盤（中央付近）・終盤を切り出し、
    「...(中略)...」で連結して返す。text が total_chars 以下なら全文をそのまま返す。

    truncate_text（先頭のみ・0.8係数）の置き換え。係数は適用しない
    （確定判断: 500字×3 = 合計1500字 = MAX_INPUT_TOKENS）。
    長時間配信が冒頭挨拶だけで判定される問題への対策で、
    評価入力に終盤の内容を必ず含める（AC6）。

    Args:
        text: 字幕テキスト全文
        total_chars: サンプリング合計文字数（連結マーカー分は含まない）

    Returns:
        サンプリング済みテキスト（全文 or 3セグメント連結）
    """
    if len(text) <= total_chars:
        return text

    segment_len = total_chars // 3
    separator = "\n...(中略)...\n"

    head = text[:segment_len]
    tail = text[-segment_len:]

    # 中盤: 冒頭・終盤と重複しない残り範囲の中央から切り出す
    # （len(text) > total_chars が保証されるため範囲は必ず segment_len 以上ある）
    avail_start = segment_len
    avail_end = len(text) - segment_len
    mid_start = avail_start + max(0, (avail_end - avail_start - segment_len) // 2)
    middle = text[mid_start:mid_start + segment_len]

    return separator.join([head, middle, tail])


def _strip_code_fence(text: str) -> str:
    """
    テキストを囲むコードフェンス（``` / ```json）を除去する

    JSON のみ出力するようプロンプトで指示しているが、
    モデルがフェンス付きで返すケースへの防御。
    """
    stripped = text.strip()
    match = re.match(r"^```(?:json)?\s*\n(.*)\n```\s*$", stripped, re.DOTALL)
    if match:
        return match.group(1)
    return stripped


def _extract_result_from_envelope(stdout_text: str) -> str:
    """
    `claude -p --output-format json` のエンベロープ JSON から評価本文を取り出す

    エンベロープは {"result": "<本文>", ...} 形式。
    エンベロープとして解釈できない場合（プレーンテキスト等）は
    stdout をそのまま返す（後段のパーサに委ねる）。
    """
    try:
        envelope = json.loads(stdout_text)
    except json.JSONDecodeError:
        return stdout_text

    if isinstance(envelope, dict):
        result_field = envelope.get("result")
        if isinstance(result_field, str):
            return result_field

    # result キーを持たない JSON（評価本文が直接 JSON で返ったケース等）はそのまま
    return stdout_text


def parse_evaluation_json(response_text: str) -> tuple[int, str, str, list[str]] | None:
    """
    AI の評価レスポンス（JSON 形式）をパースする

    Args:
        response_text: 評価本文。{"score": ..., "genre": ..., "highlights": [...],
            "reason": ...} 形式を想定（コードフェンス付きも許容）

    Returns:
        (スコア, 理由, ジャンル, 盛り上がりリスト)。
        JSON として解釈できない場合は None を返し、
        呼び出し側で parse_evaluation_response（正規表現パース）にフォールバックする。
    """
    try:
        data = json.loads(_strip_code_fence(response_text))
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict) or "score" not in data:
        return None

    try:
        score = int(data["score"])
    except (TypeError, ValueError):
        return None
    score = max(0, min(10, score))

    # 理由（改行を空白に正規化。既存テキストパーサと同じ扱い）
    reason = " ".join(str(data.get("reason") or "").split())
    if not reason:
        reason = "評価理由の抽出に失敗しました"

    genre = str(data.get("genre") or "").strip()

    highlights_raw = data.get("highlights")
    highlights: list[str] = []
    if isinstance(highlights_raw, list):
        highlights = [str(h).strip() for h in highlights_raw if str(h).strip()][:3]

    return score, reason, genre, highlights


def parse_evaluation_response(response_text: str) -> tuple[int, str, str, list[str]]:
    """
    AI の評価レスポンス（テキスト形式）をパースする

    JSON 出力化（Phase 2）以降は parse_evaluation_json 失敗時のフォールバック。

    Returns:
        tuple[int, str, str, list[str]]: (スコア, 理由, ジャンル, 盛り上がりリスト)
    """
    # スコアを抽出（"スコア: 8" or "スコア: 8/10" 形式を想定）
    # パース失敗時は中立値 5 をデフォルトとする（0 だと「最低評価」と区別できないため）
    score_match = re.search(r"スコア[:：]\s*(\d+)", response_text)
    if score_match:
        try:
            score = int(score_match.group(1))
            score = max(0, min(10, score))
        except ValueError:
            logger.warning(f"スコア数値の変換に失敗しました: {score_match.group(1)}")
            score = 5
    else:
        logger.warning(f"スコアのパースに失敗しました: {response_text[:50]}...")
        score = 5

    # ジャンルを抽出
    genre_match = re.search(r"ジャンル[:：]\s*(.+)", response_text)
    if genre_match:
        genre = genre_match.group(1).strip()
        genre = genre.split("\n")[0].strip()
    else:
        genre = ""

    # 盛り上がりポイントを抽出
    highlights: list[str] = []
    highlights_match = re.search(
        r"盛り上がり[:：]\s*(.+?)(?=\n理由[:：]|\Z)", response_text, re.DOTALL
    )
    if highlights_match:
        highlights_text = highlights_match.group(1).strip()
        for line in highlights_text.split("\n"):
            cleaned = re.sub(r"^[\-・\*\d\.]+\s*", "", line.strip())
            if cleaned:
                highlights.append(cleaned)
        highlights = highlights[:3]

    # 理由を抽出
    reason_match = re.search(r"理由[:：]\s*(.+)", response_text, re.DOTALL)
    if reason_match:
        reason = reason_match.group(1).strip()
        reason = " ".join(reason.split())
    else:
        reason = "評価理由の抽出に失敗しました"

    return score, reason, genre, highlights


def save_pending_evaluation(
    video_id: str,
    title: str,
    published_at: str,
    subtitle_text: str,
    channel_id: str = "",
    model: str | None = None,
) -> Path:
    """
    評価失敗時に未評価データをJSONファイルに保存する

    Args:
        video_id: YouTube動画ID
        title: 動画タイトル
        published_at: 公開日時（ISO形式）
        subtitle_text: 字幕テキスト
        channel_id: チャンネルID（省略可）
        model: 評価に使う予定だったモデル（None はデフォルトモデル）。
            記録用であり、リトライ時は favorite から引き直して再決定する

    Returns:
        Path: 保存したファイルのパス
    """
    output_dir = Path(settings.PENDING_EVALUATION_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_video_id = re.sub(r"[^\w\-]", "_", video_id)
    filename = f"pending_{timestamp}_{safe_video_id}.json"
    filepath = output_dir / filename

    pending_data = {
        "version": "1.0",
        "type": "pending_evaluation",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "video": {
            "video_id": video_id,
            "title": title,
            "published_at": published_at,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "channel_id": channel_id,
        },
        "subtitle_text": subtitle_text,
        "model": model,
        "evaluation_prompt": settings.EVALUATION_PROMPT_TEMPLATE.format(
            title=title,
            # 3点サンプリング（冒頭・中盤・終盤）で終盤の内容も評価入力に含める
            subtitle_text=sample_subtitle_segments(
                subtitle_text, settings.MAX_INPUT_TOKENS
            ),
            excitement_summary=analyze_excitement_signals(subtitle_text)["excitement_summary"],
        ),
        "status": "pending",
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(pending_data, f, ensure_ascii=False, indent=2)

    logger.info(f"未評価データを保存しました: {filepath}")
    return filepath


async def evaluate_with_claude_code(
    subtitle_text: str,
    title: str = "",
    tier: Literal["small", "mid", "large"] = "mid",
    model: str | None = None,
) -> tuple[int, str, str, list[str]]:
    """
    Claude Code CLI (`claude -p`) を使った評価

    Args:
        subtitle_text: 字幕テキスト
        title: 動画タイトル
        tier: 評価層。`"small"` の場合は SMALL_CHANNEL_PROMPT_TEMPLATE を使用、
              それ以外（`"mid"` / `"large"`）は既存 EVALUATION_PROMPT_TEMPLATE を使用。
        model: `--model` に渡すモデル名。None の場合は指定なし（デフォルトモデル）。
               favorite 1-2 チャンネルは settings.LOW_FAVORITE_MODEL が渡される。

    Returns:
        tuple[int, str, str, list[str]]: (スコア 0-10, 推薦理由, ジャンル, 盛り上がりリスト)

    Raises:
        RuntimeError: claude コマンドが見つからない場合、またはCLI実行エラー
    """
    if shutil.which("claude") is None:
        raise RuntimeError(
            "claude コマンドが見つかりません（Claude Code がインストールされていない可能性があります）"
        )

    signals = analyze_excitement_signals(subtitle_text)
    excitement_summary = signals["excitement_summary"]
    # 3点サンプリング（冒頭・中盤・終盤）で終盤の内容も評価入力に含める（AC6）
    truncated_text = sample_subtitle_segments(subtitle_text, settings.MAX_INPUT_TOKENS)
    # tier に応じてプロンプトテンプレートを切り替える
    template = (
        settings.SMALL_CHANNEL_PROMPT_TEMPLATE
        if tier == "small"
        else settings.EVALUATION_PROMPT_TEMPLATE
    )
    prompt = template.format(
        title=title,
        subtitle_text=truncated_text,
        excitement_summary=excitement_summary,
    )

    # CLAUDECODE 環境変数を除いた環境変数を作成（ネストセッション禁止を回避）
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    # コマンド組み立て。prompt は index 2 を維持し、--model は末尾に後置する
    cmd = ["claude", "-p", prompt, "--output-format", "json"]
    if model:
        cmd += ["--model", model]

    # AC5 検証用: どのモデルで評価したかを必ずログに出す
    logger.info(
        f"Claude Code CLI で評価します "
        f"(tier={tier}, model={model or 'デフォルト'}): {title}"
    )
    try:
        # asyncio.to_thread + subprocess.run を使う
        # asyncio.create_subprocess_exec はWindowsでstdout/stderr両方PIPEにするとデッドロックする既知バグあり
        result = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
            env=env,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Claude Code CLI がタイムアウトしました（120秒）")

    if result.returncode != 0:
        raise RuntimeError(
            f"Claude Code CLI エラー (returncode={result.returncode}): {result.stderr[:200]}"
        )

    # --output-format json のエンベロープから評価本文を取り出す
    response_text = _extract_result_from_envelope(result.stdout)
    logger.debug(f"Claude Code CLI Response: {response_text[:100]}...")

    # JSON パース → 失敗時は正規表現パースにフォールバック（再評価コスト削減）
    parsed = parse_evaluation_json(response_text)
    if parsed is None:
        logger.debug("JSON パースに失敗したため正規表現パースにフォールバックします")
        parsed = parse_evaluation_response(response_text)
    score, reason, genre, highlights = parsed
    return score, f"[Claude評価] {reason}", genre, highlights


async def evaluate_subtitle(
    subtitle_text: str,
    video_id: str = "",
    title: str = "",
    published_at: str = "",
    channel_id: str = "",
    tier: Literal["small", "mid", "large"] = "mid",
    model: str | None = None,
) -> tuple[int, str, str, list[str]]:
    """
    字幕を評価する（Claude Code CLI を使用、失敗時は pending ファイルに保存）

    Args:
        subtitle_text: 字幕テキスト
        video_id: 動画ID（失敗時のファイル出力用）
        title: 動画タイトル
        published_at: 公開日時（失敗時のファイル出力用）
        channel_id: チャンネルID（失敗時のファイル出力用）
        tier: 評価層（"small" / "mid" / "large"）。デフォルトは "mid" で
              既存呼び出し箇所の後方互換を維持する。"small" 指定時のみ
              SMALL_CHANNEL_PROMPT_TEMPLATE を使用。
        model: `--model` に渡すモデル名。None はデフォルトモデル（後方互換）。

    Returns:
        tuple[int, str, str, list[str]]: (スコア 0-10, 推薦理由, ジャンル, 盛り上がりリスト)
    """
    try:
        return await evaluate_with_claude_code(
            subtitle_text, title=title, tier=tier, model=model
        )

    except Exception as e:
        logger.error(f"Claude Code CLI 失敗。未評価データをファイルに保存します: {e}")
        filepath = save_pending_evaluation(
            video_id=video_id,
            title=title,
            published_at=published_at,
            subtitle_text=subtitle_text,
            channel_id=channel_id,
            model=model,
        )
        return 0, f"評価失敗（データ保存先: {filepath}）", "", []
