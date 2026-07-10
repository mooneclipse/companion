"""
tools/feedback_report.py の単体テスト（3-2 / 3-3）
"""
import json
from pathlib import Path

from tools.feedback_report import (
    _shift_month,
    build_favorite_proposals,
    build_report,
    load_channel_favorites,
    parse_viewing_text,
    summarize_month,
)

# 新フォーマット（feedback 欄あり）のサンプル
_SAMPLE_VIEWING = """---
title: YouTube視聴履歴
month: 2026-07
---

# YouTube視聴履歴 (2026-07)

記入方法: 見た動画はチェックボックスを `[x]` にする。

## [チャンネルA]
- [x] 動画1 [video_id: vid1] [score: 8/10] [tier: mid] [reason: 面白い] [feedback: ○]
- [ ] 動画2 [video_id: vid2] [score: 9/10] [tier: mid] [reason: すごい] [feedback: ]
- [ ] 動画3 [video_id: vid3] [score: 5/10] [tier: mid] [reason: 普通] [feedback: ○]

## [チャンネルB]
- [ ] 動画4 [video_id: vid4] [score: 6/10] [tier: mid] [reason: まあ] [feedback: ×]
- [ ] 動画5 [video_id: vid5] [score: 4/10] [tier: small] [reason: 低調] [feedback: ×]
"""

# 旧フォーマット（feedback 欄なし・過去月の後方互換確認用）
_LEGACY_VIEWING = """# YouTube視聴履歴 (2026-06)

## [チャンネルC]
- [x] 旧動画1 [video_id: old1] [score: 7/10] [tier: mid] [reason: ふつう]
- [ ] 旧動画2 [video_id: old2] [score: 8/10] [tier: mid] [reason: よい]
"""


class TestParseViewingText:
    """parse_viewing_text（viewing ファイルのパース）のテスト"""

    def test_新フォーマットをパースできる(self):
        entries = parse_viewing_text(_SAMPLE_VIEWING)
        assert len(entries) == 5

        by_id = {e.video_id: e for e in entries}
        # チェックボックス + feedback ○
        assert by_id["vid1"].checked is True
        assert by_id["vid1"].watched is True
        assert by_id["vid1"].is_hit is True
        assert by_id["vid1"].score == 8
        assert by_id["vid1"].channel == "チャンネルA"
        # 未視聴（feedback 空）
        assert by_id["vid2"].watched is False
        # feedback のみで視聴扱い
        assert by_id["vid3"].checked is False
        assert by_id["vid3"].watched is True
        assert by_id["vid3"].is_hit is True
        # 外れ
        assert by_id["vid4"].is_miss is True
        assert by_id["vid4"].channel == "チャンネルB"

    def test_feedback欄なしの旧フォーマットも落ちない(self):
        """黒服補足2: 過去月ファイルの後方互換パース"""
        entries = parse_viewing_text(_LEGACY_VIEWING)
        assert len(entries) == 2

        by_id = {e.video_id: e for e in entries}
        assert by_id["old1"].feedback == ""
        assert by_id["old1"].checked is True
        assert by_id["old1"].watched is True  # チェックボックスのみで視聴扱い
        assert by_id["old2"].watched is False
        assert by_id["old2"].is_hit is False
        assert by_id["old2"].is_miss is False

    def test_動画行以外は無視される(self):
        text = "# 見出し\n\n- 箇条書きだが動画行ではない\n- [ ] video_idなしの行\n"
        assert parse_viewing_text(text) == []


class TestShiftMonth:
    """_shift_month（月演算）のテスト"""

    def test_年をまたぐ引き算(self):
        assert _shift_month("2026-01", -1) == "2025-12"
        assert _shift_month("2026-02", -2) == "2025-12"

    def test_同年内の演算(self):
        assert _shift_month("2026-07", -1) == "2026-06"
        assert _shift_month("2026-07", 0) == "2026-07"


class TestSummarizeMonth:
    """summarize_month（月次集計）のテスト（3-2）"""

    def test_集計値が正しい(self):
        entries = parse_viewing_text(_SAMPLE_VIEWING)
        summary = summarize_month("2026-07", entries)

        assert summary.total == 5
        assert summary.watched == 4  # vid1(✔○), vid3(○), vid4(×), vid5(×)
        assert summary.hits == 2     # vid1, vid3
        assert summary.misses == 2   # vid4, vid5

    def test_見逃し厳禁帯なのに未視聴を検出(self):
        entries = parse_viewing_text(_SAMPLE_VIEWING)
        summary = summarize_month("2026-07", entries)

        # vid2 = score 9 未視聴。vid1 は score 8 だが視聴済みなので対象外
        assert [e.video_id for e in summary.unwatched_must_watch] == ["vid2"]

    def test_スキップ帯なのに当たりを検出(self):
        entries = parse_viewing_text(_SAMPLE_VIEWING)
        summary = summarize_month("2026-07", entries)

        # vid3 = score 5 で ○。vid1 は score 8 なのでスキップ帯ではない
        assert [e.video_id for e in summary.hit_in_skip_band] == ["vid3"]


class TestBuildFavoriteProposals:
    """build_favorite_proposals（推し度補正提案）のテスト（3-3）"""

    def test_視聴実績ゼロのチャンネルにfavorite減を提案(self):
        entries = parse_viewing_text(
            "## [放置チャンネル]\n"
            "- [ ] 動画A [video_id: a1] [score: 6/10] [feedback: ]\n"
            "- [ ] 動画B [video_id: a2] [score: 5/10] [feedback: ]\n"
        )
        proposals = build_favorite_proposals(entries, {"放置チャンネル": 3})

        assert len(proposals) == 1
        assert "[提案]" in proposals[0]
        assert "放置チャンネル" in proposals[0]
        assert "favorite 3 → 2" in proposals[0]

    def test_favorite1のチャンネルはこれ以上下げない(self):
        entries = parse_viewing_text(
            "## [最低チャンネル]\n"
            "- [ ] 動画A [video_id: b1] [score: 6/10] [feedback: ]\n"
        )
        proposals = build_favorite_proposals(entries, {"最低チャンネル": 1})
        assert proposals == []

    def test_視聴実績があれば提案しない(self):
        entries = parse_viewing_text(
            "## [視聴チャンネル]\n"
            "- [x] 動画A [video_id: c1] [score: 7/10] [feedback: ]\n"
        )
        proposals = build_favorite_proposals(entries, {"視聴チャンネル": 4})
        assert proposals == []

    def test_外れ連発チャンネルに警告(self):
        entries = parse_viewing_text(
            "## [外れチャンネル]\n"
            "- [ ] 動画A [video_id: d1] [score: 7/10] [feedback: ×]\n"
            "- [ ] 動画B [video_id: d2] [score: 6/10] [feedback: ×]\n"
        )
        proposals = build_favorite_proposals(entries, {"外れチャンネル": 3})

        warnings = [p for p in proposals if "[警告]" in p]
        assert len(warnings) == 1
        assert "外れ連発" in warnings[0]
        assert "× 2本" in warnings[0]

    def test_当たりがあれば外れ連発警告は出ない(self):
        entries = parse_viewing_text(
            "## [混合チャンネル]\n"
            "- [ ] 動画A [video_id: e1] [score: 7/10] [feedback: ×]\n"
            "- [ ] 動画B [video_id: e2] [score: 6/10] [feedback: ×]\n"
            "- [ ] 動画C [video_id: e3] [score: 8/10] [feedback: ○]\n"
        )
        proposals = build_favorite_proposals(entries, {"混合チャンネル": 3})
        assert [p for p in proposals if "[警告]" in p] == []


class TestLoadChannelFavorites:
    """load_channel_favorites のテスト"""

    def test_チャンネルリストから読み込める(self, tmp_path: Path):
        path = tmp_path / "channels.json"
        path.write_text(json.dumps({
            "channels": [
                {"name": "Ch1", "channel_id": "UC_1", "favorite": 5},
                {"name": "Ch2", "channel_id": "UC_2"},  # favorite 欠落 → 3
            ]
        }, ensure_ascii=False), encoding="utf-8")

        favorites = load_channel_favorites(path)
        assert favorites == {"Ch1": 5, "Ch2": 3}

    def test_ファイルがなければ空dict(self, tmp_path: Path):
        assert load_channel_favorites(tmp_path / "nonexistent.json") == {}


class TestBuildReport:
    """build_report（月次レポート組み立て）の結合テスト"""

    def test_レポートに全セクションが含まれる(self, tmp_path: Path):
        (tmp_path / "viewing-2026-07.md").write_text(_SAMPLE_VIEWING, encoding="utf-8")
        # 過去月は旧フォーマット（後方互換の結合確認）
        (tmp_path / "viewing-2026-06.md").write_text(_LEGACY_VIEWING, encoding="utf-8")
        channels_path = tmp_path / "channels.json"
        channels_path.write_text(json.dumps({
            "channels": [
                {"name": "チャンネルA", "favorite": 4},
                {"name": "チャンネルB", "favorite": 3},
                {"name": "チャンネルC", "favorite": 3},
            ]
        }, ensure_ascii=False), encoding="utf-8")

        report = build_report(
            "2026-07", tasks_dir=tmp_path, channel_list_path=channels_path
        )

        assert "# 視聴フィードバック月次集計 (2026-07)" in report
        assert "- 掲載動画数: 5" in report
        assert "- 見た(✔): 4" in report
        assert "- 当たり(○): 2" in report
        assert "- 外れ(×): 2" in report
        # 見逃し検知（vid2）
        assert "vid2" in report
        # 拾い逃し検知（vid3）
        assert "vid3" in report
        # 3-3: チャンネルB は直近3ヶ月で × 2 / ○ 0 → 警告
        assert "[警告] チャンネルB" in report
        # 提案のみである注記
        assert "書き換えは手動" in report

    def test_対象月ファイルがなくても落ちない(self, tmp_path: Path):
        report = build_report(
            "2026-01",
            tasks_dir=tmp_path,
            channel_list_path=tmp_path / "nonexistent.json",
        )
        assert "- 掲載動画数: 0" in report
