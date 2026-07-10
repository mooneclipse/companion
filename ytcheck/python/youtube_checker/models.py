"""
データモデル - アプリケーションで使用するデータ構造の定義
"""
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field


class Video(BaseModel):
    """YouTube動画情報"""
    video_id: str
    title: str
    published_at: datetime
    duration: str | None = None        # ISO 8601 形式 (例: PT1H23M45S)
    is_live_archive: bool = False      # ライブ配信のアーカイブか
    view_count: int | None = None      # 取得時点の再生数（バズ検知用。未取得は None）

    @computed_field  # type: ignore[misc]
    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"

    @computed_field  # type: ignore[misc]
    @property
    def duration_minutes(self) -> int | None:
        """ISO 8601 duration を分に変換（例: PT1H23M45S → 83）"""
        if not self.duration:
            return None
        match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", self.duration)
        if not match:
            return None
        h, m, s = (int(x or 0) for x in match.groups())
        return h * 60 + m + (1 if s > 0 else 0)


class EvaluationResult(BaseModel):
    """AIによる評価結果

    score_zero_reason のリテラル候補:
        - "no_subtitles": 字幕未取得でスコア0
        - "ai_failed": AI評価がレートリミット等で失敗
        - "unhandled_exception": 想定外の例外
        - "low_signal": AI評価成功だがスコア0（低シグナルのフォールバック）
        - None: 上記いずれにも該当しない（評価対象外 is_excluded=True 等）
    """
    video: Video
    has_subtitles: bool
    score: int = Field(default=0, ge=0, le=10)
    reason: str = ""
    error: str | None = None
    genre: str = ""  # 推定ジャンル（雑談/ゲーム実況/歌枠/コラボ/企画/その他）
    highlights: list[str] = Field(default_factory=list)  # 盛り上がりポイント最大3つ
    # 評価時に適用された層（小規模 / 中堅 / 大手）。後付け追加のためデフォルト None で後方互換維持
    tier: Literal["small", "mid", "large"] | None = None
    # 評価時点の登録者数。hidden や未取得の場合は None
    subscriber_count: int | None = None
    # === v2 拡張フィールド（全て後方互換のためデフォルト値あり） ===
    # 評価対象外（歌・踊り・カバー・字幕で判断不可等）。True の場合 score / reason は使われない
    is_excluded: bool = False
    exclude_reason: str = ""  # 「歌・踊り」「字幕で判断不可」等
    # 畳み込みキー（同じ値を持つ動画は同シリーズ / 同コラボとみなす）
    series_key: str | None = None
    collab_key: str | None = None
    # タイブレーカー用シグナル（output_formatter で参照）
    laugh_signal_count: int = 0
    surprise_signal_count: int = 0
    duration_minutes: int | None = None  # 情報密度算出用（Video 側にもあるが欠損保険）
    # スコア0 の発生理由（"no_subtitles" / "ai_failed" / "unhandled_exception" / "low_signal" のいずれか or None）
    score_zero_reason: str | None = None
    # 見どころタイムスタンプ（開始秒、最大3件）。字幕 cue の盛り上がりシグナルから
    # 検出し、レポートで `&t=NNNNs` ジャンプリンクにする。後方互換のためデフォルト空
    highlight_seconds: list[int] = Field(default_factory=list)


@dataclass
class RunStats:
    """1回の巡回実行の統計情報（実行サマリー出力用）

    run_all_channels() が集計し、レポート末尾とコンソールに出力する。
    既存の戻り値 (genres, results) 2-tuple を維持するため、
    呼び出し側で生成したインスタンスを渡してインプレースで更新する方式を採る。
    """
    processed: int = 0            # 新規に評価処理した動画数（キャッシュスキップを除く）
    cache_skipped: int = 0        # キャッシュヒットで字幕取得ごとスキップした動画数
    excluded: int = 0             # 評価対象外（歌・踊り・カバー・字幕で判断不可等）
    subtitle_failures: int = 0    # 字幕取得失敗数（no_subtitles）
    ai_failures: int = 0          # AI評価失敗数（ai_failed / unhandled_exception）
    pending_retried: int = 0      # pending 再評価を試行した件数
    pending_succeeded: int = 0    # pending 再評価に成功した件数（ファイル削除済み）
    pending_failed: int = 0       # pending 再評価に失敗した件数（次回持ち越し）
    elapsed_seconds: float = 0.0  # 巡回全体の所要時間（秒）

    def as_dict(self) -> dict[str, int | float]:
        """JSON 出力用の辞書に変換する"""
        return asdict(self)


def determine_tier(
    subscriber_count: int | None,
    thresholds: dict[str, int],
) -> Literal["small", "mid", "large"]:
    """
    登録者数から層（small / mid / large）を判定する

    Args:
        subscriber_count: 登録者数。hidden や未取得は None
        thresholds: 層境界値。例 ``{"small": 10_000, "mid": 100_000}``

    Returns:
        ``"small"`` / ``"mid"`` / ``"large"`` のいずれか。

    判定規則:
        - ``None`` → ``"small"``（登録者数非公開や未取得は誤検知許容で拾い上げ寄りに倒す）
        - ``< thresholds["small"]`` → ``"small"``
        - ``< thresholds["mid"]`` → ``"mid"``
        - 上記以外 → ``"large"``
    """
    if subscriber_count is None:
        return "small"
    if subscriber_count < thresholds["small"]:
        return "small"
    if subscriber_count < thresholds["mid"]:
        return "mid"
    return "large"
