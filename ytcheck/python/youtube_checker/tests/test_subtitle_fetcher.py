"""
subtitle_fetcher.py の単体テスト
"""
import tempfile
from pathlib import Path

from subtitle_fetcher import (
    analyze_excitement_signals,
    detect_highlight_seconds,
    extract_cues_from_vtt,
    extract_text_from_vtt,
)


class TestExtractTextFromVtt:
    """extract_text_from_vtt のテスト"""

    def _write_vtt(self, content: str) -> Path:
        """一時VTTファイルを作成するヘルパー"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".vtt", delete=False, encoding="utf-8"
        ) as f:
            f.write(content)
            return Path(f.name)

    def test_基本的なVTTからテキスト抽出(self):
        """VTT形式からタイムスタンプ等を除いた本文が抽出される"""
        vtt_content = """WEBVTT
Kind: captions
Language: ja

00:00:01.000 --> 00:00:03.000
こんにちは

00:00:03.000 --> 00:00:05.000
今日はゲームをします
"""
        path = self._write_vtt(vtt_content)
        try:
            result = extract_text_from_vtt(path)
            assert "こんにちは" in result
            assert "今日はゲームをします" in result
            # タイムスタンプは含まれない
            assert "00:00:01" not in result
        finally:
            path.unlink(missing_ok=True)

    def test_重複行が除去される(self):
        """同じテキストが複数回現れても1回だけ含まれる"""
        vtt_content = """WEBVTT

00:00:01.000 --> 00:00:02.000
重複するテキスト

00:00:02.000 --> 00:00:03.000
重複するテキスト

00:00:03.000 --> 00:00:04.000
別のテキスト
"""
        path = self._write_vtt(vtt_content)
        try:
            result = extract_text_from_vtt(path)
            lines = [l for l in result.split("\n") if l.strip()]
            assert lines.count("重複するテキスト") == 1
            assert "別のテキスト" in result
        finally:
            path.unlink(missing_ok=True)

    def test_HTMLタグが除去される(self):
        """<c>タグなどのHTMLタグが除去される"""
        vtt_content = """WEBVTT

00:00:01.000 --> 00:00:03.000
<c.colorE5E5E5>テキスト内容</c>
"""
        path = self._write_vtt(vtt_content)
        try:
            result = extract_text_from_vtt(path)
            assert "テキスト内容" in result
            assert "<c" not in result
        finally:
            path.unlink(missing_ok=True)

    def test_空のVTTは空文字列を返す(self):
        """ヘッダーのみのVTTは空文字列を返す"""
        vtt_content = "WEBVTT\nKind: captions\nLanguage: ja\n"
        path = self._write_vtt(vtt_content)
        try:
            result = extract_text_from_vtt(path)
            assert result == ""
        finally:
            path.unlink(missing_ok=True)


class TestExtractCuesFromVtt:
    """extract_cues_from_vtt（見どころ検出用 cue 抽出）のテスト"""

    def _write_vtt(self, content: str) -> Path:
        """一時VTTファイルを作成するヘルパー"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".vtt", delete=False, encoding="utf-8"
        ) as f:
            f.write(content)
            return Path(f.name)

    def test_開始秒とテキストが抽出される(self):
        """cue の開始タイムスタンプが秒に変換されて対応テキストと組になる"""
        vtt_content = """WEBVTT
Kind: captions
Language: ja

00:00:01.500 --> 00:00:03.000
こんにちは

00:01:02.000 --> 00:01:05.000
今日はゲームをします
"""
        path = self._write_vtt(vtt_content)
        try:
            cues = extract_cues_from_vtt(path)
            assert cues == [(1.5, "こんにちは"), (62.0, "今日はゲームをします")]
        finally:
            path.unlink(missing_ok=True)

    def test_時間単位のタイムスタンプが秒に変換される(self):
        """1時間超の配信でも開始秒が正しく計算される（長時間配信対応）"""
        vtt_content = """WEBVTT

01:02:03.500 --> 01:02:05.000
終盤のコメント
"""
        path = self._write_vtt(vtt_content)
        try:
            cues = extract_cues_from_vtt(path)
            assert len(cues) == 1
            assert cues[0][0] == 3723.5
        finally:
            path.unlink(missing_ok=True)

    def test_HTMLタグ除去と重複行除去(self):
        """タグは除去され、同じテキストは最初の cue だけが残る"""
        vtt_content = """WEBVTT

00:00:01.000 --> 00:00:02.000
<c.colorE5E5E5>重複するテキスト</c>

00:00:02.000 --> 00:00:03.000
重複するテキスト

00:00:03.000 --> 00:00:04.000
別のテキスト
"""
        path = self._write_vtt(vtt_content)
        try:
            cues = extract_cues_from_vtt(path)
            assert cues == [(1.0, "重複するテキスト"), (3.0, "別のテキスト")]
        finally:
            path.unlink(missing_ok=True)

    def test_ヘッダーのみは空リスト(self):
        """cue が無い VTT は空リストを返す"""
        path = self._write_vtt("WEBVTT\nKind: captions\nLanguage: ja\n")
        try:
            assert extract_cues_from_vtt(path) == []
        finally:
            path.unlink(missing_ok=True)


class TestDetectHighlightSeconds:
    """detect_highlight_seconds（笑い・驚きシグナルのクラスタリング）のテスト"""

    def test_シグナルなしは空リスト(self):
        """盛り上がりシグナルの無い cue では見どころゼロ"""
        cues = [(10.0, "こんにちは"), (20.0, "本日の予定を説明します")]
        assert detect_highlight_seconds(cues) == []

    def test_空のcueリストは空リスト(self):
        assert detect_highlight_seconds([]) == []

    def test_シグナル集中窓が検出される(self):
        """60秒窓にヒットが集中している箇所の先頭秒が返る"""
        cues = [
            (5.0, "こんにちは"),
            (100.0, "wwww"),          # 笑い1ヒット
            (110.0, "やばい！！"),      # 驚き2ヒット（やばい + ！！）
            (200.0, "普通の話です"),
        ]
        # ヒットは 60-120秒 の窓のみ → 窓内最初のヒット秒 100
        assert detect_highlight_seconds(cues) == [100]

    def test_上位3窓までに制限され時刻昇順で返る(self):
        """4窓にヒットがある場合、ヒット数下位の窓が落ち、結果は昇順"""
        cues = [
            # 窓0（0-60秒）: 1ヒット（最弱 → 落選）
            (10.0, "草"),
            # 窓2（120-180秒）: 3ヒット
            (130.0, "えっ！マジ？やばい"),
            # 窓5（300-360秒）: 2ヒット
            (310.0, "wwww 草"),
            # 窓8（480-540秒）: 2ヒット
            (490.0, "うそ！ナイス"),
        ]
        result = detect_highlight_seconds(cues, window_seconds=60, max_highlights=3)
        assert result == [130, 310, 490]

    def test_代表秒は窓内最初のヒット秒(self):
        """同一窓に複数 cue がヒットした場合、最も早い秒が代表になる"""
        cues = [
            (65.0, "www"),
            (70.0, "やばい"),
            (110.0, "えっ！"),
        ]
        assert detect_highlight_seconds(cues) == [65]


class TestAnalyzeExcitementSignals:
    """analyze_excitement_signals のテスト"""

    def test_空文字列は全ゼロを返す(self):
        """空文字列を渡した場合のデフォルト値"""
        result = analyze_excitement_signals("")
        assert result["laugh_count"] == 0
        assert result["surprise_count"] == 0
        assert result["exclamation_density"] == 0.0
        assert result["excitement_summary"] == "字幕なし"

    def test_笑いシグナルを検出する(self):
        """（笑）やwwwなどの笑いシグナルを検出する"""
        text = "うわー（笑）やばすぎwww\nハハハ面白い\n"
        result = analyze_excitement_signals(text)
        assert result["laugh_count"] > 0

    def test_驚きシグナルを検出する(self):
        """えっ！やマジ？などの驚きシグナルを検出する"""
        text = "えっ！なにこれ\nマジ？うそ！\nヤバい！！\n"
        result = analyze_excitement_signals(text)
        assert result["surprise_count"] > 0

    def test_感嘆符密度を計算する(self):
        """感嘆符の密度が正しく計算される"""
        text = "やばい！！！すごい！！"  # 感嘆符が多い
        result = analyze_excitement_signals(text)
        assert result["exclamation_density"] > 0.0

    def test_平均行長が計算される(self):
        """平均行長が正しく計算される"""
        text = "短い\n少し長いテキスト\nもっと長いテキストです"
        result = analyze_excitement_signals(text)
        assert result["avg_line_length"] > 0.0

    def test_excitement_summaryが文字列を返す(self):
        """excitement_summary が非空の文字列を返す"""
        text = "普通のテキストです"
        result = analyze_excitement_signals(text)
        assert isinstance(result["excitement_summary"], str)
        assert len(result["excitement_summary"]) > 0

    def test_盛り上がりレベルが分類される(self):
        """盛り上がりシグナルが多い場合は「高」に分類される"""
        # 笑い・驚きシグナルが多い文章
        text = (
            "やばい！！！えっ！うそ！マジ？！！"
            "（笑）www（笑）www（笑）www"
            "やばい！ヤバい！マジで！えっ！"
        )
        result = analyze_excitement_signals(text)
        assert "高" in result["excitement_summary"]
