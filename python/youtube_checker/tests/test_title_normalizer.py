"""
title_normalizer.py の単体テスト

カバレッジ:
- is_excluded_video の MV 同時視聴保護（バグ3）
- extract_collab_key の修飾語フォールバック（バグ1）
- extract_series_prefix のプレフィックス抽出 + ストップワード（バグ2）
"""
from title_normalizer import (
    extract_collab_key,
    extract_series_prefix,
    is_excluded_video,
    normalize_title_for_collab,
)


class TestIsExcludedVideoMvProtection:
    """MV 同時視聴/リアクション保護のテスト（バグ3）"""

    def test_is_excluded_video_mv_reaction_protection_positive(self):
        """同時視聴系の表現を含む MV は除外しない（False）"""
        cases = [
            "The HeartiesのMVを見ましょうかね",
            "MV同時視聴会",
            "同時視聴企画 ○○のMV",
            "○○のMVを見よう",
            "MVリアクション配信",
            "MV reaction stream",
        ]
        for title in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is False, f"保護されなかった: {title} (reason={reason})"

    def test_is_excluded_video_mv_normal_exclusion(self):
        """通常の MV リリース動画は引き続き除外される（True）"""
        cases = [
            "【MV】新曲リリース",
            "公式MV公開",
        ]
        for title in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is True, f"除外されなかった: {title}"
            assert reason == "MV", f"理由が MV ではない: {title} -> {reason}"

    def test_is_excluded_video_other_keywords_unaffected(self):
        """歌・踊りの除外キーワードは影響を受けない（True）"""
        cases = [
            ("【歌ってみた】桜", "歌ってみた"),
            ("踊ってみた○○", "踊ってみた"),
        ]
        for title, expected_reason in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is True, f"除外されなかった: {title}"
            assert reason == expected_reason


class TestIsExcludedVideoCoverWordBoundary:
    """"cover"/"MV" 等英数字キーワードの単語境界判定（誤爆修正、2026-07-09）"""

    def test_is_excluded_video_substring_false_positive_not_excluded(self):
        """"cover" を内包するだけの無関係な単語では除外されない（False）"""
        cases = [
            "【#NIJIENChanted2】minecraft stream discovering the nether"
            " in MC Eternal 2 with Nijisanji EN friends!!",
            "配信中にPCが recovered した話",
            "MVP を獲得しました",
        ]
        for title in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is False, f"誤って除外された: {title} (reason={reason})"

    def test_is_excluded_video_real_cover_still_excluded(self):
        """独立した単語としての cover は引き続き除外される（True、真陽性維持）"""
        cases = [
            ("【加賀美ハヤト Cover】", "cover"),
            ("新曲 Covered by 鈴木", "Covered by"),
        ]
        for title, expected_reason in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is True, f"除外されなかった: {title}"
            assert reason.lower() == expected_reason.lower()

    def test_is_excluded_video_inflected_forms_still_excluded(self):
        """"by" を伴わない covered や複数形 songs も引き続き除外される（True）"""
        cases = [
            "夜に駆ける covered",
            "My Original Songs",
        ]
        for title in cases:
            excluded, reason = is_excluded_video(title, "", "テストチャンネル")
            assert excluded is True, f"除外されなかった: {title} (reason={reason})"


class TestExtractCollabKeyFallback:
    """コラボキーのフォールバック（バグ1）"""

    def test_extract_collab_key_no_annotation_returns_key(self):
        """修飾語ナシでもコラボキーが返る（旧仕様では None だった）"""
        key = extract_collab_key("No More Room in Hell2", "2026-05-11")
        assert key is not None
        assert key.endswith("::2026-05-11")

    def test_extract_collab_key_normalize_spacing(self):
        """半角スペース有無は同一キーに正規化される"""
        k1 = extract_collab_key("No More Room in Hell2", "2026-05-11")
        k2 = extract_collab_key("No More Room in Hell 2", "2026-05-11")
        assert k1 is not None
        assert k2 is not None
        assert k1 == k2

    def test_extract_collab_key_empty_title_returns_none(self):
        """空文字列や記号のみは None"""
        assert extract_collab_key("", "2026-05-11") is None
        assert extract_collab_key("【】", "2026-05-11") is None
        # 装飾だけで実体ナシ
        assert extract_collab_key("[ ]", "2026-05-11") is None

    def test_extract_collab_key_with_annotation_still_works(self):
        """修飾語があっても従来通りキーが返る（後方互換）"""
        key = extract_collab_key("Pratfall ft. 山田", "2026-05-07")
        assert key is not None

    def test_normalize_title_for_collab_strips_annotation(self):
        """ft./feat./視点 等の修飾は引き続き除去される"""
        s = normalize_title_for_collab("Pratfall ft. 山田太郎【鈴木視点】")
        assert "pratfall" in s
        assert "山田" not in s
        assert "鈴木" not in s


class TestExtractSeriesPrefix:
    """シリーズプレフィックス抽出（バグ2）"""

    def test_extract_series_prefix_normal(self):
        """通常タイトルは正規化済み先頭 3 文字を返す"""
        # 「【マイクラ】はくクラ最終日」→ 装飾除去後「はくクラ最終日」
        # 先頭 3 文字「はくク」が返る想定
        prefix = extract_series_prefix("【マイクラ】はくクラ最終日")
        assert prefix == "はくク"

    def test_extract_series_prefix_stopword_blocks(self):
        """ストップワード（雑談/実況/ゲーム/歌枠 等）は None"""
        assert extract_series_prefix("雑談配信") is None
        assert extract_series_prefix("実況プレイ") is None
        assert extract_series_prefix("【ゲーム】配信スタート") is None
        assert extract_series_prefix("歌枠です") is None

    def test_extract_series_prefix_short_title(self):
        """2 文字以下のタイトルは None"""
        assert extract_series_prefix("ab") is None
        assert extract_series_prefix("【】") is None
        assert extract_series_prefix("") is None

    def test_extract_series_prefix_same_project_yields_same_prefix(self):
        """同シリーズの 2 本は同じプレフィックスを返す（はくクラ系）"""
        p1 = extract_series_prefix("はくクラ最終日")
        p2 = extract_series_prefix("はくクラ妖怪、クイズ王の称号を取りにいきます")
        assert p1 is not None
        assert p1 == p2
