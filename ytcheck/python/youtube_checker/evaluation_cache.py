"""
評価結果キャッシュモジュール

同じ動画を日をまたいで再評価しない（字幕取得ごとスキップする）ための
JSON 永続化キャッシュ。`data/evaluated_cache.json` に保存する。

キャッシュ対象（確定結果のみ）:
- has_subtitles=True かつ score_zero_reason が失敗系
  （ai_failed / unhandled_exception）でない評価結果
- is_excluded=True の評価対象外判定

字幕なし（no_subtitles）は自動字幕の生成遅延で翌日には取得できる可能性があるため
キャッシュしない（翌日の実行で再挑戦させる）。
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from models import EvaluationResult

logger = logging.getLogger(__name__)

# キャッシュファイルのデフォルトパス（CWD に依存しないようモジュール位置でアンカーする）
DEFAULT_CACHE_PATH = Path(__file__).resolve().parent / "data" / "evaluated_cache.json"

# キャッシュファイルのフォーマットバージョン（不一致の旧キャッシュは破棄する）
CACHE_VERSION = "1.0"

# 起動時にこの日数より古いエントリを削除する（肥大化対策）
PRUNE_DAYS = 90

# キャッシュしない score_zero_reason（翌日以降に再評価の余地がある失敗系）
_NON_CACHEABLE_REASONS = ("ai_failed", "unhandled_exception")


class EvaluationCache:
    """評価済み動画のキャッシュ（video_id -> 確定評価結果）

    生成時にファイルを読み込み、90日より古いエントリを剪定する。
    変更があった場合のみ save() でファイルへ書き戻す（dirty フラグ管理）。
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or DEFAULT_CACHE_PATH
        self._entries: dict[str, dict[str, Any]] = {}
        self._dirty = False
        self._load()

    def _load(self) -> None:
        """キャッシュファイルを読み込み、古いエントリを剪定する"""
        if not self._path.exists():
            return

        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            # 壊れたキャッシュは捨てて空から再構築する（評価が1回余分に走るだけで実害なし）
            logger.warning(
                f"評価キャッシュの読み込みに失敗（空から再構築します）: {e}"
            )
            self._dirty = True
            return

        if data.get("version") != CACHE_VERSION:
            logger.warning(
                f"評価キャッシュのバージョン不一致"
                f"（{data.get('version')} != {CACHE_VERSION}）。破棄します。"
            )
            self._dirty = True
            return

        entries = data.get("entries", {})
        if not isinstance(entries, dict):
            logger.warning("評価キャッシュの entries が不正です。破棄します。")
            self._dirty = True
            return

        # 90日より古いエントリ・日時をパースできないエントリを剪定する
        cutoff = datetime.now(timezone.utc) - timedelta(days=PRUNE_DAYS)
        pruned = 0
        for video_id, entry in entries.items():
            evaluated_at = self._parse_evaluated_at(entry)
            if evaluated_at is None or evaluated_at < cutoff:
                pruned += 1
                continue
            self._entries[video_id] = entry

        if pruned > 0:
            self._dirty = True
            logger.info(f"評価キャッシュの古いエントリを剪定しました（{pruned} 件）")

        logger.info(f"評価キャッシュを読み込みました（{len(self._entries)} 件）")

    @staticmethod
    def _parse_evaluated_at(entry: dict[str, Any]) -> datetime | None:
        """エントリの evaluated_at をパースする（不正値は None）"""
        raw = entry.get("evaluated_at")
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None
        # naive な日時は UTC とみなす
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    @staticmethod
    def is_cacheable(result: EvaluationResult) -> bool:
        """キャッシュ対象の確定結果かを判定する

        - 評価対象外（is_excluded=True）は確定結果としてキャッシュする
        - 字幕あり かつ 失敗系でない（ai_failed / unhandled_exception 以外）なら
          キャッシュする
        - 字幕なし（no_subtitles）はキャッシュしない（翌日再挑戦させる）
        """
        if result.is_excluded:
            return True
        if not result.has_subtitles:
            return False
        return result.score_zero_reason not in _NON_CACHEABLE_REASONS

    def contains(self, video_id: str) -> bool:
        """video_id がキャッシュ済みかを返す"""
        return video_id in self._entries

    def lookup(self, video_id: str) -> dict[str, Any] | None:
        """video_id のキャッシュエントリを返す（未登録は None）"""
        return self._entries.get(video_id)

    def add(self, result: EvaluationResult) -> bool:
        """確定結果をキャッシュに登録する

        Returns:
            登録した場合 True、キャッシュ対象外で登録しなかった場合 False
        """
        if not self.is_cacheable(result):
            return False

        now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        # レポート再掲はしない方針のため保存内容は最小限
        # （再掲判断=存在確認と、デバッグ時の追跡に十分な情報のみ持つ）
        self._entries[result.video.video_id] = {
            "title": result.video.title,
            "score": result.score,
            "reason": result.reason,
            "genre": result.genre,
            "highlights": result.highlights,
            "tier": result.tier,
            "is_excluded": result.is_excluded,
            "exclude_reason": result.exclude_reason,
            "evaluated_at": now_iso,
        }
        self._dirty = True
        return True

    def save(self) -> None:
        """変更がある場合のみキャッシュファイルへ書き戻す"""
        if not self._dirty:
            return

        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            data = {"version": CACHE_VERSION, "entries": self._entries}
            with open(self._path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
            self._dirty = False
            logger.debug(f"評価キャッシュを保存しました（{len(self._entries)} 件）")
        except OSError as e:
            # 保存失敗は致命的ではない（次回また評価されるだけ）ので警告に留める
            logger.warning(f"評価キャッシュの保存に失敗: {e}")

    def __len__(self) -> int:
        return len(self._entries)
