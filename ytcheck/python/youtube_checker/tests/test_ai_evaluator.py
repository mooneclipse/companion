"""
ai_evaluator.py の単体テスト
"""
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

import pytest

from ai_evaluator import (
    _extract_result_from_envelope,
    evaluate_subtitle,
    evaluate_with_claude_code,
    parse_evaluation_json,
    parse_evaluation_response,
    sample_subtitle_segments,
    save_pending_evaluation,
    truncate_text,
)


class TestTruncateText:
    """truncate_text のテスト"""

    def test_短いテキストはそのまま返す(self):
        text = "短いテキスト"
        result = truncate_text(text, 5000)
        assert result == text

    def test_長いテキストは切り詰める(self):
        text = "あ" * 5000
        result = truncate_text(text, 5000)
        # 5000 * 0.8 = 4000文字 + 省略表記
        assert len(result) < 5000
        assert result.endswith("...(以下省略)")

    def test_ちょうど制限の場合はそのまま(self):
        text = "あ" * 4000  # 5000 * 0.8 = 4000
        result = truncate_text(text, 5000)
        assert result == text


class TestParseEvaluationResponse:
    """parse_evaluation_response のテスト"""

    def test_正常なレスポンスをパース(self):
        response = "スコア: 8\n理由: とても面白い動画です"
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 8
        assert "とても面白い動画です" in reason

    def test_全角コロンのレスポンス(self):
        response = "スコア：7\n理由：技術的に参考になる"
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 7
        assert "技術的に参考になる" in reason

    def test_スコアが範囲外の場合は制限(self):
        response = "スコア: 15\n理由: 最高"
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 10  # max(0, min(10, 15))

    def test_スコアが負の場合はゼロ(self):
        # 正規表現は負の数にマッチしないのでデフォルト5になる
        response = "スコア: -1\n理由: ひどい"
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 5  # パース失敗のデフォルト

    def test_パース不能なレスポンス(self):
        response = "この動画は面白いです"
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 5  # デフォルト
        assert reason == "評価理由の抽出に失敗しました"

    def test_ジャンルと盛り上がりをパース(self):
        """ジャンルと盛り上がりポイントが正しくパースされることを確認"""
        response = (
            "スコア: 9\n"
            "ジャンル: ゲーム実況\n"
            "盛り上がり:\n"
            "- ボス撃破でテンション爆上がり\n"
            "- リスナーとの掛け合いが最高\n"
            "理由: 非常に盛り上がった配信でした"
        )
        score, reason, genre, highlights = parse_evaluation_response(response)
        assert score == 9
        assert genre == "ゲーム実況"
        assert len(highlights) <= 3
        assert any("ボス撃破" in h for h in highlights)
        assert "非常に盛り上がった" in reason


class TestSavePendingEvaluation:
    """save_pending_evaluation のテスト"""

    def test_ファイルが正しく保存される(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch("ai_evaluator.settings") as mock_settings:
                mock_settings.PENDING_EVALUATION_DIR = tmpdir
                mock_settings.EVALUATION_PROMPT_TEMPLATE = "タイトル: {title}\nテスト: {subtitle_text}\n{excitement_summary}"
                mock_settings.MAX_INPUT_TOKENS = 5000

                filepath = save_pending_evaluation(
                    video_id="test123",
                    title="テスト動画",
                    published_at="2026-02-18T00:00:00+00:00",
                    subtitle_text="テスト字幕テキスト",
                    channel_id="UC_test",
                )

                assert filepath.exists()
                assert filepath.suffix == ".json"

                with open(filepath, encoding="utf-8") as f:
                    data = json.load(f)

                assert data["type"] == "pending_evaluation"
                assert data["version"] == "1.0"
                assert data["status"] == "pending"
                assert data["video"]["video_id"] == "test123"
                assert data["video"]["title"] == "テスト動画"
                assert data["video"]["channel_id"] == "UC_test"
                assert data["subtitle_text"] == "テスト字幕テキスト"
                assert "evaluation_prompt" in data

    def test_ディレクトリが自動作成される(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            new_dir = os.path.join(tmpdir, "nested", "dir")
            with mock.patch("ai_evaluator.settings") as mock_settings:
                mock_settings.PENDING_EVALUATION_DIR = new_dir
                mock_settings.EVALUATION_PROMPT_TEMPLATE = "タイトル: {title}\nテスト: {subtitle_text}\n{excitement_summary}"
                mock_settings.MAX_INPUT_TOKENS = 5000

                filepath = save_pending_evaluation(
                    video_id="test456",
                    title="テスト",
                    published_at="2026-02-18T00:00:00+00:00",
                    subtitle_text="字幕",
                )

                assert filepath.exists()
                assert Path(new_dir).exists()


class TestEvaluateSubtitle:
    """evaluate_subtitle のテスト"""

    @pytest.mark.asyncio
    async def test_Claude評価失敗時にファイル出力(self):
        """Claude Code CLI 失敗時にpendingファイルに保存されることを確認"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch("ai_evaluator.evaluate_with_claude_code") as mock_claude, \
                 mock.patch("ai_evaluator.settings") as mock_settings:

                mock_settings.PENDING_EVALUATION_DIR = tmpdir
                mock_settings.EVALUATION_PROMPT_TEMPLATE = "タイトル: {title}\nテスト: {subtitle_text}\n{excitement_summary}"
                mock_settings.MAX_INPUT_TOKENS = 5000

                mock_claude.side_effect = Exception("Claude Code CLI エラー")

                score, reason, genre, highlights = await evaluate_subtitle(
                    subtitle_text="テスト字幕",
                    video_id="claude_fail_test",
                    title="Claudeエラーテスト",
                    published_at="2026-02-18T00:00:00+00:00",
                    channel_id="UC_test",
                )

                assert score == 0
                assert "評価失敗" in reason
                assert genre == ""
                assert highlights == []

                json_files = list(Path(tmpdir).glob("*.json"))
                assert len(json_files) == 1

    @pytest.mark.asyncio
    async def test_正常時はClaude結果を返す(self):
        """正常時にClaude Code CLIの結果が返されることを確認"""
        with mock.patch("ai_evaluator.evaluate_with_claude_code") as mock_claude:
            mock_claude.return_value = (8, "[Claude評価] 面白い動画", "ゲーム実況", ["盛り上がりシーン1"])

            score, reason, genre, highlights = await evaluate_subtitle(subtitle_text="テスト字幕")

            assert score == 8
            assert "面白い動画" in reason
            assert genre == "ゲーム実況"
            assert highlights == ["盛り上がりシーン1"]

    @pytest.mark.asyncio
    async def test_evaluate_subtitle_default_tier_is_mid(self):
        """tier 引数省略時は内部で tier='mid' で呼ばれる（後方互換）"""
        with mock.patch("ai_evaluator.evaluate_with_claude_code") as mock_claude:
            mock_claude.return_value = (5, "[Claude評価] 普通", "雑談", [])
            await evaluate_subtitle(subtitle_text="テスト")
            # キーワード引数 tier="mid" で呼ばれていること
            _, kwargs = mock_claude.call_args
            assert kwargs.get("tier") == "mid"

    @pytest.mark.asyncio
    async def test_evaluate_subtitle_uses_small_prompt_when_tier_small(self):
        """tier='small' のとき SMALL_CHANNEL_PROMPT_TEMPLATE が使われる"""
        # evaluate_with_claude_code は本物を呼ばせ、subprocess.run をモックして prompt 引数を確認
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            mock_settings.SMALL_CHANNEL_PROMPT_TEMPLATE = "[SMALL] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.EVALUATION_PROMPT_TEMPLATE = "[MID/LARGE] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.MAX_INPUT_TOKENS = 5000

            fake_result = mock.MagicMock()
            fake_result.returncode = 0
            fake_result.stdout = "スコア: 7\n理由: ok"
            fake_result.stderr = ""
            mock_thread.return_value = fake_result

            await evaluate_subtitle(subtitle_text="サンプル字幕", title="t", tier="small")

            # subprocess.run の呼び出し引数からプロンプト文字列を取得
            args, kwargs = mock_thread.call_args
            # args[0]=subprocess.run, args[1]=コマンドリスト
            cmd_list = args[1]
            # ["claude", "-p", prompt, "--output-format", "text"]
            assert cmd_list[0] == "claude"
            prompt_text = cmd_list[2]
            assert prompt_text.startswith("[SMALL]")
            assert "[MID/LARGE]" not in prompt_text

    @pytest.mark.asyncio
    async def test_evaluate_subtitle_uses_default_prompt_when_tier_mid(self):
        """tier='mid' のとき既存 EVALUATION_PROMPT_TEMPLATE が使われる"""
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            mock_settings.SMALL_CHANNEL_PROMPT_TEMPLATE = "[SMALL] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.EVALUATION_PROMPT_TEMPLATE = "[MID/LARGE] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.MAX_INPUT_TOKENS = 5000

            fake_result = mock.MagicMock()
            fake_result.returncode = 0
            fake_result.stdout = "スコア: 7\n理由: ok"
            fake_result.stderr = ""
            mock_thread.return_value = fake_result

            await evaluate_subtitle(subtitle_text="サンプル字幕", title="t", tier="mid")
            cmd_list = mock_thread.call_args[0][1]
            prompt_text = cmd_list[2]
            assert prompt_text.startswith("[MID/LARGE]")
            assert "[SMALL]" not in prompt_text

    @pytest.mark.asyncio
    async def test_evaluate_subtitle_uses_default_prompt_when_tier_large(self):
        """tier='large' のとき既存 EVALUATION_PROMPT_TEMPLATE が使われる"""
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            mock_settings.SMALL_CHANNEL_PROMPT_TEMPLATE = "[SMALL] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.EVALUATION_PROMPT_TEMPLATE = "[MID/LARGE] {title}|{subtitle_text}|{excitement_summary}"
            mock_settings.MAX_INPUT_TOKENS = 5000

            fake_result = mock.MagicMock()
            fake_result.returncode = 0
            fake_result.stdout = "スコア: 9\n理由: ok"
            fake_result.stderr = ""
            mock_thread.return_value = fake_result

            await evaluate_subtitle(subtitle_text="サンプル字幕", title="t", tier="large")
            cmd_list = mock_thread.call_args[0][1]
            prompt_text = cmd_list[2]
            assert prompt_text.startswith("[MID/LARGE]")
            assert "[SMALL]" not in prompt_text


class TestParseEvaluationJson:
    """parse_evaluation_json（JSON 形式レスポンスのパース）のテスト"""

    def test_正常なJSONをパース(self):
        response = (
            '{"score": 8, "genre": "ゲーム実況", '
            '"highlights": ["ボス撃破", "掛け合い"], "reason": "面白い配信"}'
        )
        parsed = parse_evaluation_json(response)
        assert parsed is not None
        score, reason, genre, highlights = parsed
        assert score == 8
        assert reason == "面白い配信"
        assert genre == "ゲーム実況"
        assert highlights == ["ボス撃破", "掛け合い"]

    def test_コードフェンス付きJSONをパース(self):
        response = (
            "```json\n"
            '{"score": 6, "genre": "雑談", "highlights": [], '
            '"reason": "落ち着いた構成"}\n'
            "```"
        )
        parsed = parse_evaluation_json(response)
        assert parsed is not None
        assert parsed[0] == 6
        assert parsed[1] == "落ち着いた構成"

    def test_スコアが範囲外はクランプ(self):
        parsed = parse_evaluation_json('{"score": 15, "reason": "最高"}')
        assert parsed is not None
        assert parsed[0] == 10

        parsed_neg = parse_evaluation_json('{"score": -3, "reason": "ひどい"}')
        assert parsed_neg is not None
        assert parsed_neg[0] == 0

    def test_盛り上がりは最大3つに制限(self):
        response = '{"score": 7, "reason": "r", "highlights": ["a", "b", "c", "d"]}'
        parsed = parse_evaluation_json(response)
        assert parsed is not None
        assert len(parsed[3]) == 3

    def test_不正なJSONはNoneを返す(self):
        """None 返却 → 呼び出し側で正規表現パースにフォールバックする"""
        assert parse_evaluation_json("スコア: 8\n理由: テキスト形式") is None
        assert parse_evaluation_json("{ 壊れたJSON") is None

    def test_scoreキー欠落はNoneを返す(self):
        assert parse_evaluation_json('{"reason": "スコアがない"}') is None

    def test_scoreが数値でない場合はNoneを返す(self):
        assert parse_evaluation_json('{"score": "高い", "reason": "r"}') is None

    def test_reason欠落はデフォルト文言(self):
        parsed = parse_evaluation_json('{"score": 5}')
        assert parsed is not None
        assert parsed[1] == "評価理由の抽出に失敗しました"

    def test_判断不可フラグの理由が維持される(self):
        """「字幕で判断不可」フラグの仕様維持(後段で評価対象外送りされる)"""
        parsed = parse_evaluation_json(
            '{"score": 0, "genre": "その他", "highlights": [], '
            '"reason": "字幕で判断不可"}'
        )
        assert parsed is not None
        assert parsed[0] == 0
        assert parsed[1] == "字幕で判断不可"


class TestExtractResultFromEnvelope:
    """_extract_result_from_envelope（エンベロープ JSON の本文抽出）のテスト"""

    def test_エンベロープからresultを抽出(self):
        envelope = json.dumps({
            "type": "result",
            "result": '{"score": 8, "reason": "面白い"}',
            "session_id": "xxx",
        })
        extracted = _extract_result_from_envelope(envelope)
        assert extracted == '{"score": 8, "reason": "面白い"}'

    def test_プレーンテキストはそのまま返す(self):
        text = "スコア: 7\n理由: ok"
        assert _extract_result_from_envelope(text) == text

    def test_resultキーがないJSONはそのまま返す(self):
        """評価本文が直接 JSON で返ったケースは後段のパーサに委ねる"""
        body = '{"score": 8, "reason": "面白い"}'
        assert _extract_result_from_envelope(body) == body


class TestEvaluateWithClaudeCodeCommand:
    """evaluate_with_claude_code のコマンド組み立て・パース経路のテスト（AC5 関連）"""

    def _make_fake_result(self, stdout: str) -> mock.MagicMock:
        fake_result = mock.MagicMock()
        fake_result.returncode = 0
        fake_result.stdout = stdout
        fake_result.stderr = ""
        return fake_result

    def _patch_settings(self, mock_settings: mock.MagicMock) -> None:
        template = "P: {title}|{subtitle_text}|{excitement_summary}"
        mock_settings.EVALUATION_PROMPT_TEMPLATE = template
        mock_settings.SMALL_CHANNEL_PROMPT_TEMPLATE = "S: " + template
        mock_settings.MAX_INPUT_TOKENS = 5000

    @pytest.mark.asyncio
    async def test_output_formatがjsonでpromptはindex2を維持(self):
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            self._patch_settings(mock_settings)
            mock_thread.return_value = self._make_fake_result("スコア: 7\n理由: ok")

            await evaluate_with_claude_code("字幕", title="t", tier="mid")

            cmd_list = mock_thread.call_args[0][1]
            assert cmd_list[0] == "claude"
            assert cmd_list[1] == "-p"
            # prompt は index 2 を維持（既存テストとの互換要件）
            assert cmd_list[2].startswith("P:")
            assert cmd_list[3:5] == ["--output-format", "json"]

    @pytest.mark.asyncio
    async def test_model指定時は末尾にmodelオプションが付く(self):
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            self._patch_settings(mock_settings)
            mock_thread.return_value = self._make_fake_result("スコア: 7\n理由: ok")

            await evaluate_with_claude_code(
                "字幕", title="t", tier="mid", model="claude-haiku-4-5"
            )

            cmd_list = mock_thread.call_args[0][1]
            assert cmd_list[2].startswith("P:")  # prompt は index 2 のまま
            assert cmd_list[-2:] == ["--model", "claude-haiku-4-5"]

    @pytest.mark.asyncio
    async def test_model未指定時はmodelオプションなし(self):
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            self._patch_settings(mock_settings)
            mock_thread.return_value = self._make_fake_result("スコア: 7\n理由: ok")

            await evaluate_with_claude_code("字幕", title="t", tier="mid")

            cmd_list = mock_thread.call_args[0][1]
            assert "--model" not in cmd_list

    @pytest.mark.asyncio
    async def test_エンベロープJSONから評価結果を取得(self):
        """--output-format json のエンベロープ → 本文 JSON の二段パース"""
        body = '{"score": 8, "genre": "雑談", "highlights": ["A"], "reason": "面白い"}'
        envelope = json.dumps({"type": "result", "result": body})
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            self._patch_settings(mock_settings)
            mock_thread.return_value = self._make_fake_result(envelope)

            score, reason, genre, highlights = await evaluate_with_claude_code(
                "字幕", title="t", tier="mid"
            )

            assert score == 8
            assert reason == "[Claude評価] 面白い"
            assert genre == "雑談"
            assert highlights == ["A"]

    @pytest.mark.asyncio
    async def test_JSONパース失敗時はテキストパースにフォールバック(self):
        """プレーンテキスト応答でも従来の正規表現パースで評価が取れる"""
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            self._patch_settings(mock_settings)
            mock_thread.return_value = self._make_fake_result(
                "スコア: 9\nジャンル: 雑談\n理由: テキスト形式の応答"
            )

            score, reason, genre, highlights = await evaluate_with_claude_code(
                "字幕", title="t", tier="mid"
            )

            assert score == 9
            assert "テキスト形式の応答" in reason
            assert genre == "雑談"


class TestSavePendingEvaluationModel:
    """save_pending_evaluation の model 記録テスト"""

    def test_modelが記録される(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch("ai_evaluator.settings") as mock_settings:
                mock_settings.PENDING_EVALUATION_DIR = tmpdir
                mock_settings.EVALUATION_PROMPT_TEMPLATE = (
                    "{title}|{subtitle_text}|{excitement_summary}"
                )
                mock_settings.MAX_INPUT_TOKENS = 5000

                filepath = save_pending_evaluation(
                    video_id="model_test",
                    title="モデル記録テスト",
                    published_at="2026-07-05T00:00:00+00:00",
                    subtitle_text="字幕",
                    model="claude-haiku-4-5",
                )

                with open(filepath, encoding="utf-8") as f:
                    data = json.load(f)
                assert data["model"] == "claude-haiku-4-5"

    def test_model省略時はNoneが記録される(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch("ai_evaluator.settings") as mock_settings:
                mock_settings.PENDING_EVALUATION_DIR = tmpdir
                mock_settings.EVALUATION_PROMPT_TEMPLATE = (
                    "{title}|{subtitle_text}|{excitement_summary}"
                )
                mock_settings.MAX_INPUT_TOKENS = 5000

                filepath = save_pending_evaluation(
                    video_id="model_none",
                    title="モデル未指定",
                    published_at="2026-07-05T00:00:00+00:00",
                    subtitle_text="字幕",
                )

                with open(filepath, encoding="utf-8") as f:
                    data = json.load(f)
                assert data["model"] is None


class TestSampleSubtitleSegments:
    """sample_subtitle_segments（字幕3点サンプリング）のテスト（AC6）"""

    def test_短いテキストは全文をそのまま返す(self):
        text = "あ" * 1500
        assert sample_subtitle_segments(text, 1500) == text

    def test_長いテキストは3セグメントに分割される(self):
        # 冒頭=A、中盤=B、終盤=C が判別できるテキスト
        text = "A" * 1000 + "B" * 1000 + "C" * 1000
        result = sample_subtitle_segments(text, 1500)

        # 冒頭500字 + 終盤500字 が含まれる（終盤含有 = AC6 の核心）
        assert result.startswith("A" * 500)
        assert result.endswith("C" * 500)
        # 中盤（中央付近）が含まれる
        assert "B" * 500 in result
        # 連結マーカーが2つ
        assert result.count("...(中略)...") == 2

    def test_合計文字数はセグメント3つ分(self):
        text = "あ" * 10000
        result = sample_subtitle_segments(text, 1500)
        marker_len = len("\n...(中略)...\n") * 2
        assert len(result) == 1500 + marker_len

    def test_境界直上でもセグメントが重複しない(self):
        """1501字（total+1）でも冒頭・中盤・終盤が重ならない"""
        text = "A" * 500 + "B" * 501 + "C" * 500
        result = sample_subtitle_segments(text, 1500)
        segments = result.split("\n...(中略)...\n")
        assert len(segments) == 3
        assert segments[0] == "A" * 500
        assert segments[2] == "C" * 500
        # 中盤は B の範囲から取られる（A/C とは重複しない）
        assert set(segments[1]) == {"B"}

    def test_truncate_textと異なり08係数を適用しない(self):
        """1500字ちょうどは全文（truncate_text だと 1200 字で切られる）"""
        text = "あ" * 1500
        assert sample_subtitle_segments(text, 1500) == text
        assert len(truncate_text(text, 1500)) < 1500

    @pytest.mark.asyncio
    async def test_評価プロンプトに終盤の字幕が含まれる(self):
        """長時間配信でも終盤の内容が評価入力に入る（AC6 統合確認）"""
        subtitle = "冒頭" * 500 + "中盤" * 500 + "終盤" * 500  # 3000字
        with mock.patch("ai_evaluator.shutil.which", return_value="/usr/bin/claude"), \
             mock.patch("ai_evaluator.asyncio.to_thread") as mock_thread, \
             mock.patch("ai_evaluator.settings") as mock_settings:
            mock_settings.EVALUATION_PROMPT_TEMPLATE = (
                "P: {title}|{subtitle_text}|{excitement_summary}"
            )
            mock_settings.MAX_INPUT_TOKENS = 1500

            fake_result = mock.MagicMock()
            fake_result.returncode = 0
            fake_result.stdout = "スコア: 7\n理由: ok"
            fake_result.stderr = ""
            mock_thread.return_value = fake_result

            await evaluate_with_claude_code(subtitle, title="t", tier="mid")

            prompt_text = mock_thread.call_args[0][1][2]
            # 終盤セグメント（末尾500字）がプロンプトに含まれる
            assert "終盤" * 100 in prompt_text
            assert "...(中略)..." in prompt_text
