"""
evaluation_cache.py の単体テスト
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from evaluation_cache import CACHE_VERSION, PRUNE_DAYS, EvaluationCache
from models import EvaluationResult, Video


def _make_result(
    video_id: str = "vid1",
    has_subtitles: bool = True,
    score: int = 7,
    is_excluded: bool = False,
    score_zero_reason: str | None = None,
) -> EvaluationResult:
    """テスト用の評価結果を生成するヘルパー"""
    video = Video(
        video_id=video_id,
        title="テスト実況動画",
        published_at=datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc),
    )
    return EvaluationResult(
        video=video,
        has_subtitles=has_subtitles,
        score=score,
        reason="テスト理由",
        genre="雑談",
        highlights=["盛り上がり1"],
        tier="mid",
        is_excluded=is_excluded,
        exclude_reason="歌・踊り" if is_excluded else "",
        score_zero_reason=score_zero_reason,
    )


class TestIsCacheable:
    """is_cacheable（キャッシュ対象判定）のテスト"""

    def test_字幕あり評価成功はキャッシュ対象(self):
        result = _make_result(has_subtitles=True, score=7)
        assert EvaluationCache.is_cacheable(result) is True

    def test_字幕なしはキャッシュしない(self):
        """no_subtitles は翌日再挑戦させるためキャッシュ対象外"""
        result = _make_result(
            has_subtitles=False, score=0, score_zero_reason="no_subtitles"
        )
        assert EvaluationCache.is_cacheable(result) is False

    def test_AI評価失敗はキャッシュしない(self):
        result = _make_result(
            has_subtitles=True, score=0, score_zero_reason="ai_failed"
        )
        assert EvaluationCache.is_cacheable(result) is False

    def test_処理エラーはキャッシュしない(self):
        result = _make_result(
            has_subtitles=True, score=0, score_zero_reason="unhandled_exception"
        )
        assert EvaluationCache.is_cacheable(result) is False

    def test_低シグナルのスコア0は確定結果としてキャッシュする(self):
        result = _make_result(
            has_subtitles=True, score=0, score_zero_reason="low_signal"
        )
        assert EvaluationCache.is_cacheable(result) is True

    def test_評価対象外は字幕なしでもキャッシュする(self):
        """タイトル早期除外（has_subtitles=False, is_excluded=True）も確定結果"""
        result = _make_result(has_subtitles=False, score=0, is_excluded=True)
        assert EvaluationCache.is_cacheable(result) is True


class TestEvaluationCache:
    """EvaluationCache の登録・参照・永続化テスト"""

    def test_確定結果を登録してlookupできる(self, tmp_path: Path):
        cache = EvaluationCache(tmp_path / "cache.json")
        assert cache.add(_make_result("vid1")) is True

        assert cache.contains("vid1") is True
        entry = cache.lookup("vid1")
        assert entry is not None
        assert entry["score"] == 7
        assert entry["genre"] == "雑談"
        assert entry["tier"] == "mid"
        assert entry["evaluated_at"]  # 登録日時が記録される

    def test_キャッシュ対象外は登録されない(self, tmp_path: Path):
        cache = EvaluationCache(tmp_path / "cache.json")
        result = _make_result(
            "vid_ng", has_subtitles=False, score=0, score_zero_reason="no_subtitles"
        )
        assert cache.add(result) is False
        assert cache.contains("vid_ng") is False

    def test_未登録のlookupはNone(self, tmp_path: Path):
        cache = EvaluationCache(tmp_path / "cache.json")
        assert cache.lookup("unknown") is None
        assert cache.contains("unknown") is False

    def test_保存して再読み込みできる(self, tmp_path: Path):
        path = tmp_path / "cache.json"
        cache = EvaluationCache(path)
        cache.add(_make_result("vid1"))
        cache.save()

        reloaded = EvaluationCache(path)
        assert reloaded.contains("vid1") is True
        assert len(reloaded) == 1

    def test_変更がなければファイルを作成しない(self, tmp_path: Path):
        """dirty フラグ管理: 空のまま save してもファイルを書かない"""
        path = tmp_path / "cache.json"
        cache = EvaluationCache(path)
        cache.save()
        assert not path.exists()

    def test_90日より古いエントリは読み込み時に剪定される(self, tmp_path: Path):
        path = tmp_path / "cache.json"
        now = datetime.now(timezone.utc)
        old_date = (now - timedelta(days=PRUNE_DAYS + 1)).isoformat()
        fresh_date = (now - timedelta(days=1)).isoformat()
        data = {
            "version": CACHE_VERSION,
            "entries": {
                "old_vid": {"score": 5, "evaluated_at": old_date},
                "fresh_vid": {"score": 7, "evaluated_at": fresh_date},
            },
        }
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        cache = EvaluationCache(path)
        assert cache.contains("old_vid") is False
        assert cache.contains("fresh_vid") is True

        # 剪定は dirty 扱いになり save で永続化される
        cache.save()
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert "old_vid" not in saved["entries"]
        assert "fresh_vid" in saved["entries"]

    def test_evaluated_atが不正なエントリは剪定される(self, tmp_path: Path):
        path = tmp_path / "cache.json"
        data = {
            "version": CACHE_VERSION,
            "entries": {"broken_vid": {"score": 5, "evaluated_at": "invalid-date"}},
        }
        path.write_text(json.dumps(data), encoding="utf-8")

        cache = EvaluationCache(path)
        assert cache.contains("broken_vid") is False

    def test_壊れたJSONは空から再構築する(self, tmp_path: Path):
        path = tmp_path / "cache.json"
        path.write_text("{ これはJSONではない", encoding="utf-8")

        cache = EvaluationCache(path)
        assert len(cache) == 0

        # 再構築後は通常どおり登録・保存できる
        cache.add(_make_result("vid1"))
        cache.save()
        reloaded = EvaluationCache(path)
        assert reloaded.contains("vid1") is True

    def test_バージョン不一致の旧キャッシュは破棄する(self, tmp_path: Path):
        path = tmp_path / "cache.json"
        data = {
            "version": "0.9",
            "entries": {
                "vid1": {
                    "score": 7,
                    "evaluated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        }
        path.write_text(json.dumps(data), encoding="utf-8")

        cache = EvaluationCache(path)
        assert len(cache) == 0
