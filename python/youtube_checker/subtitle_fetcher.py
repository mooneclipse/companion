"""
yt-dlp を使った字幕取得モジュール
"""
import asyncio
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def fetch_subtitle(video_id: str, sub_lang: str = "ja") -> tuple[bool, str]:
    """
    YouTube動画の字幕を取得する（非同期版）

    タイムスタンプ付き cue も必要な場合は fetch_subtitle_timed() を使う。
    本関数の戻り値 tuple[bool, str] は後方互換のため変更しない。

    Args:
        video_id: YouTube動画ID
        sub_lang: 字幕言語コード（例: "ja", "ja,en"）。デフォルトは日本語のみ

    Returns:
        tuple[bool, str]: (字幕が取得できたか, 字幕テキスト)

    Raises:
        RuntimeError: yt-dlpの実行エラーなど
    """
    has_subtitles, subtitle_text, _cues = await fetch_subtitle_timed(video_id, sub_lang)
    return has_subtitles, subtitle_text


async def fetch_subtitle_timed(
    video_id: str, sub_lang: str = "ja"
) -> tuple[bool, str, list[tuple[float, str]]]:
    """
    YouTube動画の字幕をタイムスタンプ付き cue と一緒に取得する（非同期版）

    見どころタイムスタンプリンク（レポートの `&t=NNNNs` ジャンプ）の検出に
    cue の開始秒が必要なため、テキストと cue の両方を返す。

    Args:
        video_id: YouTube動画ID
        sub_lang: 字幕言語コード（例: "ja", "ja,en"）。デフォルトは日本語のみ

    Returns:
        tuple[bool, str, list[tuple[float, str]]]:
            (字幕が取得できたか, 字幕テキスト, (開始秒, テキスト) の cue リスト)

    Raises:
        RuntimeError: yt-dlpの実行エラーなど
    """
    # 一時ディレクトリの作成
    # tempfile.TemporaryDirectory はコンテキストマネージャとして使うと同期IOが発生するが、
    # 作成・削除のコストは許容範囲内。
    with tempfile.TemporaryDirectory() as temp_dir:
        output_template = os.path.join(temp_dir, "subtitle")

        # yt-dlpで字幕をダウンロード
        command = [
            "yt-dlp",
            "--write-auto-sub",  # 自動生成字幕を取得
            "--sub-lang", sub_lang,  # 取得する字幕言語（引数で制御）
            "--skip-download",   # 動画本体はダウンロードしない
            "--output", output_template,
            f"https://www.youtube.com/watch?v={video_id}"
        ]

        logger.debug(f"yt-dlpを実行中: {video_id} (sub_lang={sub_lang})")

        # asyncio.create_subprocess_exec は Windows の ProactorEventLoop で
        # stdout/stderr 両方 PIPE にするとデッドロックするケースがあるため、
        # ai_evaluator.py と同様に asyncio.to_thread + subprocess.run で統一する
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                command,
                capture_output=True,
                timeout=60,
            )
        except FileNotFoundError:
            # yt-dlp コマンド自体が存在しない場合（OS問わず確実に検知）
            error_msg = "yt-dlp が見つかりません。インストールしてください: pip install yt-dlp またはPATHを通してください"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"yt-dlp がタイムアウトしました（60秒）: {video_id}")

        if result.returncode != 0:
            stderr_decoded = result.stderr.decode(errors="replace")
            # returncode != 0 は字幕がないケースが多いため続行してファイルチェックを行う
            logger.debug(f"yt-dlp finished with code {result.returncode} for {video_id}. Stderr: {stderr_decoded[:200]}...")

        # 字幕ファイルを探す
        temp_path = Path(temp_dir)

        # 複数言語対応のため "*.vtt" でワイルドカード検索する
        subtitle_files = list(temp_path.glob("*.vtt"))

        if not subtitle_files:
            logger.debug(f"字幕ファイルが見つかりませんでした: {video_id}")
            return False, "", []

        # VTTファイルからテキストと cue を抽出（非同期ランナーで実行）
        loop = asyncio.get_running_loop()
        subtitle_text = await loop.run_in_executor(None, extract_text_from_vtt, subtitle_files[0])
        cues = await loop.run_in_executor(
            None, extract_cues_from_vtt, subtitle_files[0]
        )

        logger.debug(
            f"字幕取得成功: {video_id} ({len(subtitle_text)}文字, cue {len(cues)}件)"
        )
        return True, subtitle_text, cues


def extract_text_from_vtt(vtt_path: Path) -> str:
    """
    VTTファイルからテキストを抽出する
    """
    try:
        with open(vtt_path, encoding="utf-8") as f:
            lines = f.readlines()
    except Exception as e:
        logger.error(f"VTTファイル読み込みエラー: {e}")
        return ""

    text_lines = []
    # 重複行を除去するためのセット（YouTubeの自動字幕は重複が多い）
    seen_lines: set[str] = set()

    for line in lines:
        line = line.strip()

        # ヘッダー、空行、タイムスタンプをスキップ
        if not line:
            continue
        if line.startswith("WEBVTT"):
            continue
        if line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r"\d{2}:\d{2}:\d{2}\.\d{3}", line):
            continue

        # HTMLタグを除去
        line = re.sub(r"<[^>]+>", "", line)

        # 記号のみの行などをスキップ（オプション）
        if not line:
            continue

        # 重複行の簡易排除
        if line in seen_lines:
             continue

        seen_lines.add(line)
        text_lines.append(line)

    return "\n".join(text_lines)


# VTT の cue タイミング行（例: "00:01:02.500 --> 00:01:05.000 align:start ..."）
# 時間部分は "MM:SS.mmm" の省略形も許容する
_VTT_CUE_TIMING_RE = re.compile(r"^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s*-->")


def extract_cues_from_vtt(vtt_path: Path) -> list[tuple[float, str]]:
    """
    VTTファイルから cue（開始秒 + テキスト）のリストを抽出する

    見どころタイムスタンプの検出用。ヘッダー・HTMLタグ・重複行の除去は
    extract_text_from_vtt と同じ規則で行うため、cue のテキスト内訳は
    既存のテキスト抽出結果と一致する（既存パイプラインは変更しない）。

    Args:
        vtt_path: VTTファイルのパス

    Returns:
        list[tuple[float, str]]: (開始秒, テキスト) のリスト（出現順）
    """
    try:
        with open(vtt_path, encoding="utf-8") as f:
            lines = f.readlines()
    except Exception as e:
        logger.error(f"VTTファイル読み込みエラー: {e}")
        return []

    cues: list[tuple[float, str]] = []
    current_start: float | None = None
    seen_lines: set[str] = set()

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # タイミング行なら現在の開始秒を更新する
        match = _VTT_CUE_TIMING_RE.match(line)
        if match:
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2))
            seconds = int(match.group(3))
            millis = int(match.group(4))
            current_start = hours * 3600 + minutes * 60 + seconds + millis / 1000
            continue

        # ヘッダーをスキップ
        if line.startswith("WEBVTT"):
            continue
        if line.startswith("Kind:") or line.startswith("Language:"):
            continue

        # HTMLタグを除去
        line = re.sub(r"<[^>]+>", "", line)
        if not line:
            continue

        # タイミング行より前のテキスト（想定外）は開始秒が不明なのでスキップ
        if current_start is None:
            continue

        # 重複行の簡易排除（YouTubeの自動字幕は重複が多い）
        if line in seen_lines:
            continue

        seen_lines.add(line)
        cues.append((current_start, line))

    return cues


def detect_highlight_seconds(
    cues: list[tuple[float, str]],
    window_seconds: int = 60,
    max_highlights: int = 3,
) -> list[int]:
    """
    cue リストから盛り上がりシグナルの集中箇所（見どころ）を検出する

    笑い・驚きパターンのヒット位置を window_seconds 秒の窓でクラスタリングし、
    ヒット数の多い上位 max_highlights 窓の代表秒（窓内で最初にヒットした秒）を
    返す。レポートの「見どころジャンプ」リンク（`&t=NNNNs`）に使う。

    Args:
        cues: (開始秒, テキスト) の cue リスト（extract_cues_from_vtt の出力）
        window_seconds: クラスタリングの窓幅（秒）
        max_highlights: 返す見どころの最大件数

    Returns:
        list[int]: 見どころの開始秒リスト（時刻昇順、最大 max_highlights 件）
    """
    patterns = _LAUGH_PATTERNS + _SURPRISE_PATTERNS

    # 窓番号 -> ヒットした開始秒のリスト（同一 cue 内の複数ヒットは重みとして数える）
    buckets: dict[int, list[float]] = {}
    for start, text in cues:
        hit_count = sum(len(re.findall(p, text)) for p in patterns)
        if hit_count <= 0:
            continue
        bucket = int(start // window_seconds)
        buckets.setdefault(bucket, []).extend([start] * hit_count)

    if not buckets:
        return []

    # ヒット数降順（同数なら早い窓を優先）で上位窓を選ぶ
    top_windows = sorted(
        buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])
    )[:max_highlights]

    # 代表秒 = 窓内で最初にヒットした秒。表示用に時刻昇順で返す
    return sorted(int(min(seconds)) for _, seconds in top_windows)


# 笑いシグナル: （笑）, www, ははは/ふふふ, 草, kusa, lol, lmao 等
# （analyze_excitement_signals と detect_highlight_seconds で共用する）
_LAUGH_PATTERNS = [
    r"（笑）",
    r"w{3,}",                    # www以上
    r"[はははふふふヘヘヘへへへ]{3,}",
    r"[あいうえおアイウエオ]{3,}",   # 母音の繰り返し（ただし歌・相槌もノイズとして混入する場合あり）
    r"笑笑",
    r"ｗｗ",
    r"草",                        # VTuber文化特有
    r"芝",                        # 草の言い換え
    r"[Kk][Uu][Ss][Aa]",         # kusa (ローマ字)
    r"[Ll][Oo][Ll]",             # lol
    r"[Ll][Mm][Aa][Oo]",         # lmao
]

# 驚き・興奮・賞賛シグナル
_SURPRISE_PATTERNS = [
    r"えっ[!！]",
    r"うそ[!！]",
    r"マジ[?？]",
    r"やばい",
    r"ヤバい",
    r"ヤバ[!！]",
    r"まじか",
    r"なんで[!！]",
    r"[!！]{2,}",               # 複数感嘆符
    r"てぇてぇ",                 # VTuber: 尊い・感動
    r"助かる|たすかる",          # 賞賛・感謝
    r"ナイス",
    r"[Pp][Oo][Gg]",            # pog (英語圏でのすごい)
    r"[Ll][Ee][Tt]'?[Ss]\s[Gg][Oo]",  # let's go
    r"ぎゃあ{2,}",              # 悲鳴・驚き
    r"うわあ{2,}",              # 驚き
    r"[Oo][Mm][Gg]",            # omg (英語チャンネル)
    r"[Ww][Oo][Ww]",            # wow (英語チャンネル)
]


def analyze_excitement_signals(subtitle_text: str) -> dict[str, Any]:
    """
    字幕テキストから盛り上がりシグナルを検出して数値化する

    Args:
        subtitle_text: 字幕テキスト（extract_text_from_vtt の出力）

    Returns:
        dict: 各シグナルの集計値
            - laugh_count: 笑いシグナルの検出数
            - surprise_count: 驚きシグナルの検出数
            - exclamation_density: 感嘆符の密度（文字数あたり）
            - avg_line_length: 平均行長（短いほどリアクションが多い傾向）
            - excitement_summary: プロンプト埋め込み用の要約文字列
    """
    if not subtitle_text:
        return {
            "laugh_count": 0,
            "surprise_count": 0,
            "exclamation_density": 0.0,
            "avg_line_length": 0.0,
            "excitement_summary": "字幕なし",
        }

    lines = [ln for ln in subtitle_text.split("\n") if ln.strip()]
    total_chars = len(subtitle_text)

    # 笑いシグナル（パターン定義は detect_highlight_seconds と共用のモジュール定数）
    laugh_count = sum(
        len(re.findall(p, subtitle_text)) for p in _LAUGH_PATTERNS
    )

    # 驚き・興奮・賞賛シグナル
    surprise_count = sum(
        len(re.findall(p, subtitle_text)) for p in _SURPRISE_PATTERNS
    )

    # 感嘆符密度（！!？? の出現頻度 / 総文字数）
    exclamation_count = len(re.findall(r"[!！?？]", subtitle_text))
    exclamation_density = exclamation_count / total_chars if total_chars > 0 else 0.0

    # 平均行長（短いほどリアクション発言が多い傾向）
    avg_line_length = (
        sum(len(ln) for ln in lines) / len(lines) if lines else 0.0
    )

    # プロンプト埋め込み用の要約
    excitement_level = "低"
    total_signals = laugh_count + surprise_count
    if total_signals >= 10 or exclamation_density >= 0.05:
        excitement_level = "高"
    elif total_signals >= 4 or exclamation_density >= 0.02:
        excitement_level = "中"

    excitement_summary = (
        f"盛り上がり指標: 笑いシグナル={laugh_count}回 / "
        f"驚きシグナル={surprise_count}回 / "
        f"感嘆符密度={exclamation_density:.3f} / "
        f"平均行長={avg_line_length:.1f}文字 / "
        f"総合盛り上がりレベル={excitement_level}"
    )

    return {
        "laugh_count": laugh_count,
        "surprise_count": surprise_count,
        "exclamation_density": exclamation_density,
        "avg_line_length": avg_line_length,
        "excitement_summary": excitement_summary,
    }


async def async_main() -> None:
    """
    単体テスト用のメイン関数（非同期）
    """
    if len(sys.argv) < 2:
        print("使用方法: python subtitle_fetcher.py <動画ID>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]

    # ログ設定
    logging.basicConfig(level=logging.DEBUG)

    try:
        has_subtitle, subtitle_text = await fetch_subtitle(video_id)

        if has_subtitle:
            print(f"動画 {video_id} の字幕:")
            print("-" * 40)
            print(subtitle_text[:500])  # 最初の500文字のみ表示
            print("-" * 40)
            print(f"字幕長: {len(subtitle_text)} 文字")
        else:
            print(f"動画 {video_id} には字幕がありません", file=sys.stderr)
            sys.exit(1)

    except RuntimeError as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
