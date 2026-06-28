"""Unit tests for bot.py pure helpers after the Telegram cold cut.

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

bot.py reads env at import time (TELEGRAM_BOT_TOKEN / OWNER_ID /
NOTIFY_CHAT_ID); we stub them with dummy values via env before import so the
module loads. Helpers under test are pure (chunk_telegram, _normalize_play_url,
_fmt_duration, cmd_reset against a tmp sessions dir).
"""
from __future__ import annotations

import asyncio
import importlib
import logging
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _import_bot_with_stub_env():
    """Import bot module fresh with required env vars stubbed.

    python-telegram-bot のインストールに依存するため、未導入環境では import
    自体が失敗する。その場合は SkipTest として該当テストをスキップする。
    """
    os.environ.setdefault("TELEGRAM_BOT_TOKEN", "stub:token")
    os.environ.setdefault("OWNER_ID", "1")
    os.environ.setdefault("NOTIFY_CHAT_ID", "-1001234567890")
    try:
        if "bot" in sys.modules:
            del sys.modules["bot"]
        mod = importlib.import_module("bot")
    except ModuleNotFoundError as e:
        raise unittest.SkipTest(f"bot module deps not installed: {e}")
    # import 時に付く本番 bot.log 向き RotatingFileHandler を外す。テスト中の
    # logger 出力が本番ログに混入するのを防ぐ (2026-06-12 に同一行 16 連発として
    # 観測)。logging.disable はプロセスグローバルで assertLogs 系テストを壊すため
    # 使わない。レコード自体は生きるので assertLogs はそのまま動く。
    for h in list(mod.logger.handlers):
        mod.logger.removeHandler(h)
        h.close()
    # NullHandler を残す: 再 import 時に bot.py 側の `if not logger.handlers`
    # ガードが効いて本番 bot.log 向き handler の再生成 (file open) 自体を抑止し、
    # WARNING+ が lastResort 経由で stderr に漏れるノイズも消す。
    mod.logger.addHandler(logging.NullHandler())
    return mod


def _ok_result(text: str):
    """投資調査テスト用の OK な ClaudeResult を組む (run_discord の戻り値モック)。"""
    from claude_runner import ClaudeResult, ErrorKind
    return ClaudeResult(
        rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
        result_text=text, session_id="dummy",
    )


class ChunkTelegramTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_empty_returns_empty_list(self) -> None:
        self.assertEqual(self.bot.chunk_telegram(""), [])

    def test_short_returns_single_piece(self) -> None:
        self.assertEqual(self.bot.chunk_telegram("hi"), ["hi"])

    def test_within_limit_no_split(self) -> None:
        text = "a" * 4000
        out = self.bot.chunk_telegram(text)
        self.assertEqual(out, [text])

    def test_just_over_limit_splits(self) -> None:
        text = "a" * 4001
        out = self.bot.chunk_telegram(text)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], "a" * 4000)
        self.assertEqual(out[1], "a")

    def test_prefers_paragraph_break(self) -> None:
        # 段落境界 (\n\n) が size 内にあれば、そこで切ること
        head = "a" * 3000 + "\n\n" + "b" * 500
        tail = "c" * 800
        text = head + "\n\n" + tail
        out = self.bot.chunk_telegram(text, size=4000)
        # chunk1 は最後の \n\n (head の中の) で切れる
        self.assertGreaterEqual(len(out), 2)
        # chunk1 の末尾に改行残らないこと (rstrip)
        self.assertFalse(out[0].endswith("\n"))

    def test_falls_back_to_line_break(self) -> None:
        # \n\n が無いが \n は size 内にある場合は \n で切ること
        text = ("a" * 100 + "\n") * 50 + "z" * 4000  # 50 行 + 長い tail
        out = self.bot.chunk_telegram(text, size=4000)
        self.assertGreaterEqual(len(out), 2)
        # chunk1 は元の text の prefix
        self.assertTrue(text.startswith(out[0]))

    def test_falls_back_to_fixed_slice(self) -> None:
        # 改行ゼロ、size を超える → 強制 fixed slice
        text = "x" * 9000
        out = self.bot.chunk_telegram(text, size=4000)
        self.assertEqual(len(out), 3)
        self.assertEqual(len(out[0]), 4000)
        self.assertEqual(len(out[1]), 4000)
        self.assertEqual(len(out[2]), 1000)
        self.assertEqual("".join(out), text)


class NormalizePlayUrlTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_youtube_https_accepted(self) -> None:
        url = "https://www.youtube.com/watch?v=abc"
        self.assertEqual(self.bot._normalize_play_url(url), url)

    def test_youtu_be_short_accepted(self) -> None:
        url = "https://youtu.be/abc"
        self.assertEqual(self.bot._normalize_play_url(url), url)

    def test_music_youtube_accepted(self) -> None:
        url = "https://music.youtube.com/watch?v=abc"
        self.assertEqual(self.bot._normalize_play_url(url), url)

    def test_nicovideo_accepted(self) -> None:
        # ニコニコ動画 (2026-06-11 追加、video-design §4.1 canonical mirror)
        for url in (
            "https://www.nicovideo.jp/watch/sm9",
            "https://nico.ms/sm9",
            "https://sp.nicovideo.jp/watch/sm9",
            "https://nicovideo.jp/watch/sm9",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.bot._normalize_play_url(url), url)

    def test_tver_accepted(self) -> None:
        # TVer (2026-06-12 追加、video-design §4.1 canonical mirror)
        for url in (
            "https://tver.jp/episodes/epi38mzxdc",
            "https://www.tver.jp/episodes/epi38mzxdc",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.bot._normalize_play_url(url), url)

    def test_unknown_host_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("https://evil.com/abc"))

    def test_userinfo_spoof_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("https://evil@youtube.com/abc"))

    def test_nicovideo_spoof_rejected(self) -> None:
        # ニコニコ版 canonical 拒否ベクタ (video-design §4.1 mirror)
        for url in (
            "https://evil@nicovideo.jp/watch/sm9",      # userinfo 詐称
            "https://nicovideo.jp.evil.com/watch/sm9",  # suffix 偽装
            "https://nico.ms.evil.com/sm9",             # suffix 偽装(nico.ms 版)
            "https://embed.nicovideo.jp/watch/sm9",     # 非 allowlist サブドメイン
        ):
            with self.subTest(url=url):
                self.assertIsNone(self.bot._normalize_play_url(url))

    def test_tver_spoof_rejected(self) -> None:
        # TVer 版 canonical 拒否ベクタ (video-design §4.1 mirror)
        for url in (
            "https://evil@tver.jp/episodes/x",      # userinfo 詐称
            "https://tver.jp.evil.com/episodes/x",  # suffix 偽装
        ):
            with self.subTest(url=url):
                self.assertIsNone(self.bot._normalize_play_url(url))

    def test_non_http_scheme_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("javascript:alert(1)"))
        self.assertIsNone(self.bot._normalize_play_url("file:///etc/passwd"))

    def test_whitespace_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("https://youtu.be/abc def"))


class FmtDurationTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_seconds_only(self) -> None:
        self.assertEqual(self.bot._fmt_duration(timedelta(seconds=42)), "42s")

    def test_minutes_seconds(self) -> None:
        self.assertEqual(self.bot._fmt_duration(timedelta(seconds=125)), "2m05s")

    def test_hours_minutes(self) -> None:
        self.assertEqual(self.bot._fmt_duration(timedelta(seconds=3665)), "1h01m")

    def test_negative_clamped(self) -> None:
        self.assertEqual(self.bot._fmt_duration(timedelta(seconds=-5)), "0s")


class CmdResetTest(unittest.TestCase):
    """cmd_reset against a tmp sessions dir."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()
        import sessions as sessions_mod  # bot 経由で再 import 済
        cls.sessions = sessions_mod

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._orig = self.sessions._SESSIONS_DIR
        self.sessions._SESSIONS_DIR = Path(self._tmp.name) / "topics"

    def tearDown(self) -> None:
        self.sessions._SESSIONS_DIR = self._orig
        self._tmp.cleanup()

    def test_reset_no_session(self) -> None:
        out = self.bot.cmd_reset(-1001234567890, 2)
        self.assertIn("no-op", out)

    def test_reset_existing_session(self) -> None:
        self.sessions.start_or_resume(-1001234567890, 2)
        out = self.bot.cmd_reset(-1001234567890, 2)
        self.assertIn("破棄しました", out)
        # 2 回目は no-op
        out2 = self.bot.cmd_reset(-1001234567890, 2)
        self.assertIn("no-op", out2)


class ClassifyPushResultTest(unittest.TestCase):
    """classify_push_result / _extract_push_range の純関数検証。

    成否は呼び出し側が rc 1 回で確定済 = この関数は rc を判定し直さず、stderr
    分類は **報告文言の整形だけ** に使う (回復行動を分岐させない)。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_success_with_range(self) -> None:
        # git は fast-forward push の範囲行を stderr に出す。
        stderr = (
            "To github.com:mooneclipse/obsidian-vault.git\n"
            "   9867b22..460a35c  develop -> develop\n"
        )
        out = self.bot.classify_push_result(0, "", stderr)
        self.assertIn("push 完了", out)
        self.assertIn("9867b22..460a35c  develop -> develop", out)

    def test_success_new_branch(self) -> None:
        stderr = (
            "To github.com:mooneclipse/obsidian-vault.git\n"
            " * [new branch]      develop -> develop\n"
        )
        out = self.bot.classify_push_result(0, "", stderr)
        self.assertIn("push 完了", out)
        self.assertIn("[new branch]", out)

    def test_success_without_range_line(self) -> None:
        # 範囲行が拾えなくても rc==0 は成功扱い (フォールバック文言)。
        out = self.bot.classify_push_result(0, "", "")
        self.assertIn("push 完了", out)

    def test_everything_up_to_date(self) -> None:
        out = self.bot.classify_push_result(0, "", "Everything up-to-date\n")
        self.assertIn("既に同期済", out)
        self.assertIn("push する変更はありません", out)

    def test_reject_non_fast_forward(self) -> None:
        stderr = (
            " ! [rejected]        develop -> develop (non-fast-forward)\n"
            "error: failed to push some refs to "
            "'github.com:mooneclipse/obsidian-vault.git'\n"
            "hint: Updates were rejected because the tip of your current branch is behind\n"
        )
        out = self.bot.classify_push_result(1, "", stderr)
        self.assertIn("reject", out)
        self.assertIn("pull", out)
        # 自動 rebase をしない旨が明示されること
        self.assertIn("自動 rebase", out)

    def test_reject_fetch_first(self) -> None:
        stderr = (
            " ! [rejected]        develop -> develop (fetch first)\n"
            "error: failed to push some refs\n"
        )
        out = self.bot.classify_push_result(1, "", stderr)
        self.assertIn("reject", out)

    def test_agent_refused(self) -> None:
        stderr = "sign_and_send_pubkey: signing failed: agent refused operation\n"
        out = self.bot.classify_push_result(128, "", stderr)
        self.assertIn("ssh-add", out)
        self.assertIn("SSH 認証", out)

    def test_permission_denied_publickey(self) -> None:
        stderr = (
            "git@github.com: Permission denied (publickey).\n"
            "fatal: Could not read from remote repository.\n"
        )
        out = self.bot.classify_push_result(128, "", stderr)
        self.assertIn("ssh-add", out)

    def test_host_key_verification_failed(self) -> None:
        stderr = "Host key verification failed.\nfatal: Could not read from remote repository.\n"
        out = self.bot.classify_push_result(128, "", stderr)
        self.assertIn("SSH 認証", out)

    def test_other_failure_includes_stderr_tail(self) -> None:
        stderr = "fatal: some unexpected git error happened\n"
        out = self.bot.classify_push_result(1, "", stderr)
        self.assertIn("push 失敗", out)
        self.assertIn("rc=1", out)
        self.assertIn("unexpected git error", out)

    def test_extract_range_fast_forward(self) -> None:
        text = "To x\n   9867b22..460a35c  develop -> develop\n"
        self.assertEqual(
            self.bot._extract_push_range(text), "9867b22..460a35c  develop -> develop"
        )

    def test_extract_range_none_when_absent(self) -> None:
        self.assertIsNone(self.bot._extract_push_range("Everything up-to-date\n"))


class AuthorizedTest(unittest.TestCase):
    """OWNER 認可 4 段防御 (§4.2) を _authorized() レベルで検証する。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _make_update(self, *, user_id: int, is_bot: bool, chat_id: int, chat_type: str):
        # telegram.User / Chat / Update を最小スタブする (PTB v22 は dataclass 風)
        from telegram import Chat, Message, Update, User
        from datetime import datetime, timezone
        user = User(id=user_id, is_bot=is_bot, first_name="x")
        chat = Chat(id=chat_id, type=chat_type)
        msg = Message(
            message_id=1,
            date=datetime.now(timezone.utc),
            chat=chat,
            from_user=user,
            text="hi",
        )
        return Update(update_id=1, message=msg)

    def test_owner_in_correct_supergroup_accepted(self) -> None:
        upd = self._make_update(
            user_id=self.bot.OWNER_ID,
            is_bot=False,
            chat_id=self.bot.NOTIFY_CHAT_ID,
            chat_type="supergroup",
        )
        self.assertTrue(self.bot._authorized(upd))

    def test_non_owner_rejected(self) -> None:
        upd = self._make_update(
            user_id=self.bot.OWNER_ID + 1,
            is_bot=False,
            chat_id=self.bot.NOTIFY_CHAT_ID,
            chat_type="supergroup",
        )
        self.assertFalse(self.bot._authorized(upd))

    def test_bot_user_rejected(self) -> None:
        upd = self._make_update(
            user_id=self.bot.OWNER_ID,
            is_bot=True,
            chat_id=self.bot.NOTIFY_CHAT_ID,
            chat_type="supergroup",
        )
        self.assertFalse(self.bot._authorized(upd))

    def test_wrong_chat_type_rejected(self) -> None:
        # private DM (Telegram の chat.type='private') は許可しない
        upd = self._make_update(
            user_id=self.bot.OWNER_ID,
            is_bot=False,
            chat_id=self.bot.NOTIFY_CHAT_ID,
            chat_type="private",
        )
        self.assertFalse(self.bot._authorized(upd))

    def test_wrong_chat_id_rejected(self) -> None:
        upd = self._make_update(
            user_id=self.bot.OWNER_ID,
            is_bot=False,
            chat_id=self.bot.NOTIFY_CHAT_ID + 1,
            chat_type="supergroup",
        )
        self.assertFalse(self.bot._authorized(upd))


class ParseProactivePayloadTest(unittest.TestCase):
    """自発発話 socket message の判別 (構造化 envelope の 1 回デコード)。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_valid_proactive_marker(self) -> None:
        text = '[[proactive-v1]]\n{"kind": "proactive", "version": 1, "seed_kind": "recent_conversation"}'
        out = self.bot.parse_proactive_payload(text)
        self.assertIsNotNone(out)
        self.assertEqual(out["seed_kind"], "recent_conversation")

    def test_plain_text_is_not_proactive(self) -> None:
        # 既存の素通し通知文字列は proactive 経路に乗らない (None を返す)。
        self.assertIsNone(self.bot.parse_proactive_payload("システムレポート 2026-06-01"))

    def test_critical_prefix_is_not_proactive(self) -> None:
        self.assertIsNone(self.bot.parse_proactive_payload("[critical] bot stall"))

    def test_marker_with_invalid_json_returns_none(self) -> None:
        self.assertIsNone(self.bot.parse_proactive_payload("[[proactive-v1]]\nnot json"))

    def test_marker_with_wrong_kind_returns_none(self) -> None:
        text = '[[proactive-v1]]\n{"kind": "something_else"}'
        self.assertIsNone(self.bot.parse_proactive_payload(text))

    def test_vault_hint_passed_through(self) -> None:
        text = '[[proactive-v1]]\n{"kind": "proactive", "seed_kind": "recent_conversation+vault", "vault_hint": "2026-06-01_x"}'
        out = self.bot.parse_proactive_payload(text)
        self.assertEqual(out["vault_hint"], "2026-06-01_x")

    def test_dormant_hint_passed_through(self) -> None:
        text = '[[proactive-v1]]\n{"kind": "proactive", "seed_kind": "dormant_knowledge", "dormant_hint": "2026-04-01_old-topic"}'
        out = self.bot.parse_proactive_payload(text)
        self.assertEqual(out["dormant_hint"], "2026-04-01_old-topic")


class BuildProactivePromptTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_scene_instructions_always_present(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        # 直近の会話を蒸し返さない指示 (完結扱い) が prompt に乗ること
        self.assertIn("完結したもの", prompt)
        # 中身のない問いかけ / 引き止めを禁じる指示が prompt に乗ること
        self.assertIn("情緒で引き止める", prompt)

    def test_tone_definition_not_duplicated(self) -> None:
        # 口調定義は PERSONA_SYSTEM_PROMPT (system prompt 側) に常駐するため、
        # proactive prompt 側に二重定義を残さない
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("タメ口", prompt)

    def test_vault_hint_included_when_present(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation+vault", "vault_hint": "2026-06-01_topic"}
        )
        self.assertIn("2026-06-01_topic", prompt)

    def test_no_vault_hint_when_absent(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("ノート名", prompt)

    def test_silence_hours_included_when_int(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation", "silence_hours": 7}
        )
        self.assertIn("約 7 時間", prompt)

    def test_silence_hours_omitted_when_absent(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("時間経っている", prompt)

    def test_silence_hours_omitted_when_not_numeric(self) -> None:
        # 文字列 / bool / 負値は展開しない (注入防止境界: 数値検証済み int のみ)
        for bad in ("7", "7時間だよ", True, -1, 6.5, None):
            prompt = self.bot.build_proactive_prompt(
                {"seed_kind": "recent_conversation", "silence_hours": bad}
            )
            self.assertNotIn("時間経っている", prompt, msg=f"silence_hours={bad!r}")

    def test_dormant_hint_included_when_present(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "dormant_knowledge", "dormant_hint": "2026-04-01_old-topic"}
        )
        self.assertIn("2026-04-01_old-topic", prompt)
        # vault_hint (今日触れていた話題) とは別文脈であることが prompt から読めること
        self.assertIn("昔これ気にしてたね", prompt)
        self.assertNotIn("今日ユーザーが触れていた話題", prompt)

    def test_no_dormant_hint_when_absent(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("昔これ気にしてたね", prompt)

    def test_dormant_hint_omitted_when_not_string(self) -> None:
        # 注入防止境界: script 側で basename 化された str のみ展開する
        for bad in (123, True, 6.5, ["2026-04-01_x"], {"a": 1}):
            prompt = self.bot.build_proactive_prompt(
                {"seed_kind": "dormant_knowledge", "dormant_hint": bad}
            )
            self.assertNotIn("昔これ気にしてたね", prompt, msg=f"dormant_hint={bad!r}")

    def test_dormant_and_vault_hint_both_expanded(self) -> None:
        # script 側は同時に出さない設計だが、両方来ても分岐で握りつぶさず両方展開する
        prompt = self.bot.build_proactive_prompt(
            {
                "seed_kind": "dormant_knowledge",
                "vault_hint": "2026-06-12_today",
                "dormant_hint": "2026-04-01_old-topic",
            }
        )
        self.assertIn("2026-06-12_today", prompt)
        self.assertIn("2026-04-01_old-topic", prompt)

    def test_interest_topics_smeared_when_present(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation"},
            interest_topics=["2026-06-01_topic", "dormant-x"],
        )
        self.assertIn("最近あなたが気にしてること", prompt)
        self.assertIn("2026-06-01_topic", prompt)
        self.assertIn("dormant-x", prompt)
        # 「1 つだけ軽く滲ませる」指示と「読まれる前提でない」境界が乗ること
        self.assertIn("1 つだけ軽く滲ませてよい", prompt)
        self.assertIn("演技はしない", prompt)

    def test_interest_topics_omitted_when_absent(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("最近あなたが気にしてること", prompt)

    def test_interest_topics_empty_list_omitted(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation"}, interest_topics=[]
        )
        self.assertNotIn("最近あなたが気にしてること", prompt)

    def test_interest_topics_non_string_filtered(self) -> None:
        # bounded: str のみ展開 (注入防止境界)。全部非文字列なら section ごと省く。
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation"}, interest_topics=[123, None, ["x"]]
        )
        self.assertNotIn("最近あなたが気にしてること", prompt)

    def test_current_time_injected_when_now_given(self) -> None:
        # 現在時刻 (JST) を渡すと「今が何時か」が prompt に乗り、時間帯ラベルも付く
        # (LLM 側の時間帯推測 = 夜固定の例文への引っ張られを根から断つ)。
        from datetime import datetime

        now = datetime(2026, 6, 21, 8, 0, 0, tzinfo=self.bot.quota.JST)
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation"}, now=now
        )
        self.assertIn("今は JST で約 8 時頃", prompt)
        self.assertIn("朝", prompt)

    def test_current_time_omitted_when_now_absent(self) -> None:
        # now を渡さない呼び出しでは時刻文を省くだけ (フォールバック分岐は作らない)。
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("今は JST で約", prompt)

    def test_jst_time_band_boundaries(self) -> None:
        # 境界値の時間帯ラベル割り当て (純関数)。
        cases = {
            4: "深夜", 5: "朝", 10: "朝", 11: "昼", 13: "昼",
            14: "夕方", 17: "夕方", 18: "夜", 22: "夜", 23: "深夜", 0: "深夜",
        }
        for hour, band in cases.items():
            self.assertEqual(
                self.bot._jst_time_band(hour), band, msg=f"hour={hour}"
            )


class SnoozeTest(unittest.TestCase):
    """/snooze の日数→snooze_until 計算と state 読み書き、snooze 中判定。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._state = Path(self._tmp.name) / "proactive"
        self._orig = self.bot.PROACTIVE_STATE_FILE
        self.bot.PROACTIVE_STATE_FILE = self._state

    def tearDown(self) -> None:
        self.bot.PROACTIVE_STATE_FILE = self._orig
        self._tmp.cleanup()

    def test_snooze_usage_when_no_args(self) -> None:
        out = self.bot.cmd_snooze([])
        self.assertIn("使い方", out)

    def test_snooze_non_integer_rejected(self) -> None:
        out = self.bot.cmd_snooze(["abc"])
        self.assertIn("整数", out)

    def test_snooze_sets_future_until_and_is_snoozed(self) -> None:
        now = 1_000_000.0
        out = self.bot.cmd_snooze(["3"], now_epoch=now)
        self.assertIn("3 日間", out)
        # snooze 中判定: now+1日 はまだ snooze 内
        self.assertTrue(self.bot.is_snoozed(now_epoch=now + 86400))
        # now+4日 は snooze 明け
        self.assertFalse(self.bot.is_snoozed(now_epoch=now + 4 * 86400))

    def test_snooze_zero_clears(self) -> None:
        now = 1_000_000.0
        self.bot.cmd_snooze(["3"], now_epoch=now)
        out = self.bot.cmd_snooze(["0"], now_epoch=now)
        self.assertIn("解除", out)
        self.assertFalse(self.bot.is_snoozed(now_epoch=now))

    def test_is_snoozed_false_when_no_state(self) -> None:
        self.assertFalse(self.bot.is_snoozed(now_epoch=1_000_000.0))

    def test_write_snooze_preserves_last_proactive_date(self) -> None:
        # script が書く last_proactive_date 行を snooze 設定で潰さないこと。
        self._state.write_text("last_proactive_date=2026-06-01\n", encoding="utf-8")
        self.bot.write_snooze_until(2_000_000)
        content = self._state.read_text(encoding="utf-8")
        self.assertIn("last_proactive_date=2026-06-01", content)
        self.assertIn("snooze_until=2000000", content)


class ProactiveGuardNotBypassedTest(unittest.IsolatedAsyncioTestCase):
    """_run_proactive が budget guard を迂回しないことの構造検証 (M-14 境界)。

    guard.allow() が False のとき claude_runner を一切叩かず skip し、ledger に
    reason=budget_guard を残すことを確認する。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._ledger = Path(self._tmp.name) / "proactive_ledger.jsonl"
        self._orig_ledger = self.bot.PROACTIVE_LEDGER_PATH
        self.bot.PROACTIVE_LEDGER_PATH = self._ledger
        self._orig_state = self.bot.PROACTIVE_STATE_FILE
        self.bot.PROACTIVE_STATE_FILE = Path(self._tmp.name) / "proactive"

    def tearDown(self) -> None:
        self.bot.PROACTIVE_LEDGER_PATH = self._orig_ledger
        self.bot.PROACTIVE_STATE_FILE = self._orig_state
        self._tmp.cleanup()

    async def test_guard_denied_skips_without_running_claude(self) -> None:
        import json as _json
        from unittest import mock

        called = {"run_discord": 0}

        async def _fake_run_discord(*a, **kw):
            called["run_discord"] += 1
            raise AssertionError("claude_runner must not be invoked when guard denies")

        # guard.allow を False に固定、runner.run_discord を監視 spy に差し替え。
        with mock.patch.object(self.bot.budget_guard, "allow", return_value=False), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord):
            app = mock.MagicMock()
            await self.bot._run_proactive(app, {"kind": "proactive", "seed_kind": "recent_conversation"})

        self.assertEqual(called["run_discord"], 0)
        # ledger に budget_guard で skip した記録が残ること
        lines = [l for l in self._ledger.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 1)
        rec = _json.loads(lines[0])
        self.assertFalse(rec["sent"])
        self.assertEqual(rec["reason"], "budget_guard")

    async def test_snoozed_skips_without_running_claude(self) -> None:
        import json as _json
        from unittest import mock

        # snooze 中は guard を引くまでもなく skip。
        self.bot.write_snooze_until(int(__import__("time").time()) + 86400)

        async def _fake_run_discord(*a, **kw):
            raise AssertionError("claude_runner must not be invoked when snoozed")

        with mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord):
            app = mock.MagicMock()
            await self.bot._run_proactive(app, {"kind": "proactive", "seed_kind": "recent_conversation"})

        lines = [l for l in self._ledger.read_text(encoding="utf-8").splitlines() if l.strip()]
        rec = _json.loads(lines[-1])
        self.assertFalse(rec["sent"])
        self.assertEqual(rec["reason"], "snoozed")


class ProactiveInterestWiringTest(unittest.IsolatedAsyncioTestCase):
    """関心 state (機構 1) の最小配線。

    - 送信確定後に index へ topic が seeding され、思考ログに観察が 1 行残ること。
    - prompt 構築時に「前回までに溜まった」index が滲ませ候補として読まれること。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self._orig = (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
        )
        self.bot.PROACTIVE_LEDGER_PATH = d / "proactive_ledger.jsonl"
        self.bot.PROACTIVE_STATE_FILE = d / "proactive"
        self.bot.INTERESTS_INDEX_PATH = d / "companion_interests.json"
        self.bot.THOUGHTS_LOG_PATH = d / "companion_thoughts.jsonl"
        # この class は talk パス (滲ませ + seeding) を検証する。investigate / ticket /
        # remind 分岐は別 class で検証するため、ここでは全て off にして talk パスを isolate
        # する (default on だと active thread 仕込みで動く側へ分岐してしまう)。
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = False
        self.bot.PROACTIVE_TICKET_ENABLED = False
        self.bot.PROACTIVE_REMIND_ENABLED = False

    def tearDown(self) -> None:
        (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
        ) = self._orig
        self._tmp.cleanup()

    async def test_send_seeds_index_and_thought(self) -> None:
        import json as _json
        from datetime import datetime
        from unittest import mock

        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)

        async def _fake_run_claude(prompt, chat_id, thread_id):
            return "やあ、ちょっと一息どう"

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app,
                {"kind": "proactive", "seed_kind": "dormant_knowledge",
                 "dormant_hint": "2026-04-01_old-topic"},
            )

        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        topics = [t["topic"] for t in index["threads"]]
        self.assertIn("2026-04-01_old-topic", topics)
        t = index["threads"][0]
        self.assertEqual(t["source"], "dormant_knowledge")
        self.assertEqual(t["last_touched"], now.isoformat())

        thoughts = [
            l for l in self.bot.THOUGHTS_LOG_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        self.assertEqual(len(thoughts), 1)
        rec = _json.loads(thoughts[0])
        self.assertIn("2026-04-01_old-topic", rec["observation"])

        # 軸 4 拡張 (6): 前景降格 marker が talk 経路の ledger にも乗る (base 継承)。
        ledger = [
            _json.loads(l)
            for l in self.bot.PROACTIVE_LEDGER_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        self.assertTrue(ledger[-1]["sent"])
        self.assertTrue(ledger[-1]["foreground_proposal"])

    async def test_prompt_reads_prior_index_then_records_new(self) -> None:
        from datetime import datetime, timedelta
        from unittest import mock

        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        earlier = now - timedelta(days=1)
        # 前回までに溜まった index を仕込む。
        seeded = self.bot.interests.touch_thread(
            {"threads": []}, "2026-06-10_prior", "vault", earlier
        )
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, seeded)

        captured = {}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            captured["prompt"] = prompt
            return "ちょっと一息どう"

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app,
                {"kind": "proactive", "seed_kind": "recent_conversation+vault",
                 "vault_hint": "2026-06-19_today"},
            )

        # prompt は「前回までに溜まった」prior を滲ませ候補として読む。
        self.assertIn("2026-06-10_prior", captured["prompt"])
        # 送信後に今回の種 (today) が新たな接触として記録される。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        topics = {t["topic"] for t in index["threads"]}
        self.assertIn("2026-06-10_prior", topics)
        self.assertIn("2026-06-19_today", topics)


class ProactiveInvestigateTest(unittest.IsolatedAsyncioTestCase):
    """自律ループ「動く」分岐 (persona 軸 4 拡張 (3) = notes 自己調査) の配線。

    - 条件成立 (enabled + interval due + active thread) で investigate ブランチに
      入り、ephemeral session で claude を起動 → #chat に報告送信 → index 更新
      (state=researched + last_investigate) → #chat session の last_prompt_at 更新。
    - enabled off / interval 未経過 / 対象スレッド無し は talk パスへフォールスルー。
    - budget guard 拒否 / 空報告は talk に落とさず skip + ledger。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self._orig = (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        )
        self.bot.PROACTIVE_LEDGER_PATH = d / "proactive_ledger.jsonl"
        self.bot.PROACTIVE_STATE_FILE = d / "proactive"
        self.bot.INTERESTS_INDEX_PATH = d / "companion_interests.json"
        self.bot.THOUGHTS_LOG_PATH = d / "companion_thoughts.jsonl"
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = True
        # ticket / remind 分岐はこのクラスでは isolate (investigate / talk の検証のため off)。
        self.bot.PROACTIVE_TICKET_ENABLED = False
        self.bot.PROACTIVE_REMIND_ENABLED = False
        # #chat session の last_prompt_at 更新を tmp に隔離 (本番 sessions/ を汚さない)。
        self.bot.sessions._SESSIONS_DIR = d / "topics"

    def tearDown(self) -> None:
        (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        ) = self._orig
        self._tmp.cleanup()

    def _seed_active(self, topic, days_ago=1):
        from datetime import datetime, timedelta
        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        touched = now - timedelta(days=days_ago)
        data = self.bot.interests.touch_thread({"threads": []}, topic, "vault", touched)
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        return now

    def _ledger(self):
        import json as _json
        lines = [
            l for l in self.bot.PROACTIVE_LEDGER_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        return [_json.loads(l) for l in lines]

    async def test_investigate_branch_runs_records_and_sends(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        ran = {"discord": 0}

        async def _fake_run_discord(prompt, options):
            ran["discord"] += 1
            ran["prompt"] = prompt
            ran["session_id"] = options.session_id
            ran["resume"] = options.resume_session
            return _ok_result("ディスク管理のこと調べといた。notes に残しといたよ")

        async def _fail_run_claude(*a, **kw):
            raise AssertionError("talk パスの run_claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        sent = mock.AsyncMock()
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fail_run_claude), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # ephemeral session で起動 (resume しない、新規 session_id)。
        self.assertEqual(ran["discord"], 1)
        self.assertIsNotNone(ran["session_id"])
        self.assertIsNone(ran["resume"])
        self.assertIn("ディスク管理", ran["prompt"])
        # #chat に報告送信。
        sent.assert_awaited_once()
        # index: 対象が researched + last_investigate が now で更新。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        t = index["threads"][0]
        self.assertEqual(t["topic"], "ディスク管理")
        self.assertEqual(t["state"], "researched")
        self.assertEqual(index["last_investigate"], now.isoformat())
        # 思考ログに観察 1 行。
        thoughts = [
            l for l in self.bot.THOUGHTS_LOG_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        self.assertEqual(len(thoughts), 1)
        # ledger は investigate モードで sent。
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "investigate")
        self.assertEqual(rec["investigate_topic"], "ディスク管理")
        self.assertTrue(rec["sent"])
        # 軸 4 拡張 (6): 前景降格 marker が investigate 経路の ledger に乗る。
        self.assertTrue(rec["foreground_proposal"])
        # #chat session の last_prompt_at が更新された (4h 最低間隔保全)。
        meta = self.bot.sessions.load(self.bot.NOTIFY_CHAT_ID, self.bot.BOT_THREAD_ID_CHAT)
        self.assertIsNotNone(meta)
        self.assertIsNotNone(meta.last_prompt_at)

    async def test_disabled_falls_through_to_talk(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = False
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ、ちょっと一息どう"

        async def _no_investigate(prompt, options):
            raise AssertionError("disabled 時に investigate claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_investigate), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)
        rec = self._ledger()[-1]
        self.assertNotIn("mode", rec)

    async def test_no_active_thread_falls_through_to_talk(self) -> None:
        from unittest import mock
        from datetime import datetime

        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        # 対象スレッドが recent_conversation のみ = investigate 候補ゼロ。
        data = self.bot.interests.touch_thread(
            {"threads": []}, "recent_conversation", "conv", now
        )
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ"

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)

    async def test_empty_report_skips_but_consumes_interval(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _fake_run_discord(prompt, options):
            return _ok_result("   ")  # 空白のみ = 空報告

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # 送信されない。
        sent.assert_not_awaited()
        # interval は消費 (last_investigate が更新、二度調査回避 state=researched)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_investigate"], now.isoformat())
        self.assertEqual(index["threads"][0]["state"], "researched")
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "investigate")
        self.assertFalse(rec["sent"])
        self.assertEqual(rec["reason"], "empty_or_denied")

    async def test_budget_denied_in_run_investigate_skips(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _no_discord(prompt, options):
            raise AssertionError("budget 拒否時に claude を起動してはいけない")

        # _run_proactive 入口の guard は通すが、run_investigate 内の allow を False に。
        allow_calls = {"n": 0}

        def _allow(now_arg):
            allow_calls["n"] += 1
            # 1 回目 (_run_proactive 入口) は True、2 回目 (run_investigate) は False。
            return allow_calls["n"] == 1

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", side_effect=_allow), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="requests_count")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        sent.assert_not_awaited()
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "investigate")
        self.assertFalse(rec["sent"])
        # interval は起動を決めた時点で消費する設計 (budget 拒否でも record_investigate は走る)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_investigate"], now.isoformat())

    def test_record_investigate_preserves_other_mode_intervals(self) -> None:
        # 先に ticket / remind の interval がある index で investigate を record しても、
        # 他 mode の interval が残り、自分の interval が新しく入る (逆向き clobber 回帰)。
        now = self._seed_active("ディスク管理")
        data = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        data = {
            **data,
            "last_ticket": "2026-06-01T00:00:00+09:00",
            "last_remind": "2026-06-02T00:00:00+09:00",
        }
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        self.bot.record_investigate("ディスク管理", now)
        idx = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(idx["last_ticket"], "2026-06-01T00:00:00+09:00")
        self.assertEqual(idx["last_remind"], "2026-06-02T00:00:00+09:00")
        self.assertEqual(idx["last_investigate"], now.isoformat())


class ProactiveTicketTest(unittest.IsolatedAsyncioTestCase):
    """自律ループ「起票する」分岐 (persona 軸 4 拡張 (4) = 共用チケット自発起票) の配線。

    ProactiveInvestigateTest と対称:
    - 条件成立 (ticket enabled + investigate なし + interval due + 実 signal) で ticket
      ブランチに入り、ephemeral session で claude を起動 → #chat に報告送信 → index 更新
      (last_ticket、thread state は触らない) → #chat session の last_prompt_at 更新。
    - 固定優先順: investigate due なら ticket は引かれない / index 空 / signal 無し /
      enabled off は talk へフォールスルー。
    - budget guard 拒否 / 空報告は talk に落とさず skip + ledger。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self._orig = (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        )
        self.bot.PROACTIVE_LEDGER_PATH = d / "proactive_ledger.jsonl"
        self.bot.PROACTIVE_STATE_FILE = d / "proactive"
        self.bot.INTERESTS_INDEX_PATH = d / "companion_interests.json"
        self.bot.THOUGHTS_LOG_PATH = d / "companion_thoughts.jsonl"
        # ticket 分岐を検証するクラス。investigate / remind は off にして固定優先順を
        # 切り分け (investigate の優先確認をするテストでだけ局所的に True へ戻す)。
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = False
        self.bot.PROACTIVE_TICKET_ENABLED = True
        self.bot.PROACTIVE_REMIND_ENABLED = False
        self.bot.sessions._SESSIONS_DIR = d / "topics"

    def tearDown(self) -> None:
        (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        ) = self._orig
        self._tmp.cleanup()

    def _seed_active(self, topic, days_ago=1, state="active"):
        from datetime import datetime, timedelta
        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        touched = now - timedelta(days=days_ago)
        data = self.bot.interests.touch_thread(
            {"threads": []}, topic, "vault", touched, state=state
        )
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        return now

    def _ledger(self):
        import json as _json
        lines = [
            l for l in self.bot.PROACTIVE_LEDGER_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        return [_json.loads(l) for l in lines]

    async def test_ticket_branch_runs_records_and_sends(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        ran = {"discord": 0}

        async def _fake_run_discord(prompt, options):
            ran["discord"] += 1
            ran["prompt"] = prompt
            ran["session_id"] = options.session_id
            ran["resume"] = options.resume_session
            return _ok_result("ディスク掃除のタスク #42 起票しといた")

        async def _fail_run_claude(*a, **kw):
            raise AssertionError("talk パスの run_claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        sent = mock.AsyncMock()
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fail_run_claude), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # ephemeral session で起動 (resume しない、新規 session_id)。
        self.assertEqual(ran["discord"], 1)
        self.assertIsNotNone(ran["session_id"])
        self.assertIsNone(ran["resume"])
        self.assertIn("ディスク管理", ran["prompt"])
        # #chat に報告送信。
        sent.assert_awaited_once()
        # index: last_ticket が now で更新、thread state は触らない (researched にしない)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_ticket"], now.isoformat())
        self.assertEqual(index["threads"][0]["state"], "active")
        self.assertNotIn("last_investigate", index)
        # 思考ログに観察 1 行。
        thoughts = [
            l for l in self.bot.THOUGHTS_LOG_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        self.assertEqual(len(thoughts), 1)
        # ledger は ticket モードで sent。
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "ticket")
        self.assertEqual(rec["ticket_signal"], "ディスク管理")
        self.assertTrue(rec["sent"])
        # 軸 4 拡張 (6): 前景降格 marker が ticket 経路の ledger に乗る。
        self.assertTrue(rec["foreground_proposal"])
        # #chat session の last_prompt_at が更新された (4h 最低間隔保全)。
        meta = self.bot.sessions.load(self.bot.NOTIFY_CHAT_ID, self.bot.BOT_THREAD_ID_CHAT)
        self.assertIsNotNone(meta)
        self.assertIsNotNone(meta.last_prompt_at)

    async def test_researched_thread_still_signals_ticket(self) -> None:
        # investigate 済み (researched) thread でも ticket signal にはなる (起票は調査でない)。
        from unittest import mock

        now = self._seed_active("ディスク管理", state="researched")

        async def _fake_run_discord(prompt, options):
            return _ok_result("掃除タスク #7 起票した")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "ticket")
        self.assertEqual(rec["ticket_signal"], "ディスク管理")

    async def test_investigate_takes_priority_over_ticket(self) -> None:
        # 固定優先順: investigate due なら investigate を引き、ticket は引かれない。
        from unittest import mock

        now = self._seed_active("ディスク管理")
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = True
        seen = {"prompts": []}

        async def _fake_run_discord(prompt, options):
            seen["prompts"].append(prompt)
            return _ok_result("調べといた")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # investigate ブランチが走った (1 回だけ、ticket は引かれない)。
        self.assertEqual(len(seen["prompts"]), 1)
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "investigate")
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertIn("last_investigate", index)
        self.assertNotIn("last_ticket", index)

    async def test_empty_index_falls_through_to_talk(self) -> None:
        # §F の核: index 空 = 実 signal 無し → 起票せず talk へ (でっち上げ起票をしない)。
        from datetime import datetime
        from unittest import mock

        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ"

        async def _no_discord(prompt, options):
            raise AssertionError("signal 無しで起票 claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)
        rec = self._ledger()[-1]
        self.assertNotIn("mode", rec)

    async def test_disabled_falls_through_to_talk(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        self.bot.PROACTIVE_TICKET_ENABLED = False
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ"

        async def _no_discord(prompt, options):
            raise AssertionError("disabled 時に起票 claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)
        rec = self._ledger()[-1]
        self.assertNotIn("mode", rec)

    async def test_empty_report_skips_but_consumes_interval(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _fake_run_discord(prompt, options):
            return _ok_result("   ")  # 空白のみ = 起票せず空報告

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # 送信されない。
        sent.assert_not_awaited()
        # interval は消費 (last_ticket が更新)。thread state は触らない。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_ticket"], now.isoformat())
        self.assertEqual(index["threads"][0]["state"], "active")
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "ticket")
        self.assertFalse(rec["sent"])
        self.assertEqual(rec["reason"], "empty_or_denied")

    async def test_budget_denied_in_run_ticket_skips(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _no_discord(prompt, options):
            raise AssertionError("budget 拒否時に claude を起動してはいけない")

        allow_calls = {"n": 0}

        def _allow(now_arg):
            allow_calls["n"] += 1
            # 1 回目 (_run_proactive 入口) は True、2 回目 (run_ticket) は False。
            return allow_calls["n"] == 1

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", side_effect=_allow), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="requests_count")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        sent.assert_not_awaited()
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "ticket")
        self.assertFalse(rec["sent"])
        # interval は起動を決めた時点で消費する設計 (budget 拒否でも record_ticket は走る)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_ticket"], now.isoformat())

    def test_record_ticket_preserves_other_mode_intervals(self) -> None:
        # 先に investigate / remind の interval がある index で ticket を record しても、
        # 他 mode の interval が残り、自分の interval が新しく入る (逆向き clobber 回帰)。
        now = self._seed_active("ディスク管理")
        data = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        data = {
            **data,
            "last_investigate": "2026-06-01T00:00:00+09:00",
            "last_remind": "2026-06-02T00:00:00+09:00",
        }
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        self.bot.record_ticket(now)
        idx = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(idx["last_investigate"], "2026-06-01T00:00:00+09:00")
        self.assertEqual(idx["last_remind"], "2026-06-02T00:00:00+09:00")
        self.assertEqual(idx["last_ticket"], now.isoformat())


class BuildTicketPromptTest(unittest.TestCase):
    """build_ticket_prompt の boundary 文字列を検証 (settings でなくプロンプトで強制)。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_signal_is_embedded(self) -> None:
        prompt = self.bot.build_ticket_prompt("ディスク管理")
        self.assertIn("ディスク管理", prompt)

    def test_add_by_ai_only(self) -> None:
        prompt = self.bot.build_ticket_prompt("topic")
        # 起票コマンドは add ... --by ai の形 (1 行に共在する)。
        self.assertIn("tickets.py add", prompt)
        add_line = next(
            (l for l in prompt.splitlines() if "tickets.py add" in l), ""
        )
        self.assertIn("--by ai", add_line)
        self.assertNotIn("--by user", add_line)
        # --by user は「付けない」という禁止文脈でのみ登場する。
        self.assertIn("`--by user` を付けない", prompt)

    def test_list_read_allowed(self) -> None:
        prompt = self.bot.build_ticket_prompt("topic")
        self.assertIn("list --all", prompt)

    def test_single_ticket_and_dup_suppression(self) -> None:
        prompt = self.bot.build_ticket_prompt("topic")
        self.assertIn("1 件", prompt)
        self.assertIn("2 件以上は絶対に起票しない", prompt)
        # 重複起票抑止 = 既存があれば起票しない。
        self.assertIn("既にあれば起票しない", prompt)

    def test_owner_ticket_untouchable(self) -> None:
        prompt = self.bot.build_ticket_prompt("topic")
        # done/start/編集 と OWNER 不可触が明記される。
        self.assertIn("done", prompt)
        self.assertIn("start", prompt)
        self.assertIn("一切触らない", prompt)

    def test_no_fabrication(self) -> None:
        prompt = self.bot.build_ticket_prompt("topic")
        self.assertIn("でっち上げ", prompt)


class ProactiveRemindTest(unittest.IsolatedAsyncioTestCase):
    """自律ループ「振り返る」分岐 (persona 軸 4 拡張 (5) = リマインド) の配線。

    ProactiveInvestigateTest / ProactiveTicketTest と対称:
    - 条件成立 (remind enabled + investigate/ticket なし + interval due + 実 signal) で
      remind ブランチに入り、ephemeral session で claude を起動 → #chat に報告送信 →
      index 更新 (last_remind、thread state は触らない) → #chat session の last_prompt_at 更新。
    - 固定優先順: ticket due なら remind は引かれない / index 空 / signal 無し /
      enabled off は talk へフォールスルー。
    - budget guard 拒否 / 空報告は talk に落とさず skip + ledger。
    - reminder は外向き/不可逆操作ゼロ (run_remind 内で起こす tool 使用は読み取りのみ)。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self._orig = (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        )
        self.bot.PROACTIVE_LEDGER_PATH = d / "proactive_ledger.jsonl"
        self.bot.PROACTIVE_STATE_FILE = d / "proactive"
        self.bot.INTERESTS_INDEX_PATH = d / "companion_interests.json"
        self.bot.THOUGHTS_LOG_PATH = d / "companion_thoughts.jsonl"
        # remind 分岐を検証するクラス。investigate / ticket は off にして固定優先順を
        # 切り分け (上位優先の確認をするテストでだけ局所的に True へ戻す)。
        self.bot.PROACTIVE_INVESTIGATE_ENABLED = False
        self.bot.PROACTIVE_TICKET_ENABLED = False
        self.bot.PROACTIVE_REMIND_ENABLED = True
        self.bot.sessions._SESSIONS_DIR = d / "topics"

    def tearDown(self) -> None:
        (
            self.bot.PROACTIVE_LEDGER_PATH,
            self.bot.PROACTIVE_STATE_FILE,
            self.bot.INTERESTS_INDEX_PATH,
            self.bot.THOUGHTS_LOG_PATH,
            self.bot.PROACTIVE_INVESTIGATE_ENABLED,
            self.bot.PROACTIVE_TICKET_ENABLED,
            self.bot.PROACTIVE_REMIND_ENABLED,
            self.bot.sessions._SESSIONS_DIR,
        ) = self._orig
        self._tmp.cleanup()

    def _seed_active(self, topic, days_ago=3, state="active"):
        from datetime import datetime, timedelta
        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        touched = now - timedelta(days=days_ago)
        data = self.bot.interests.touch_thread(
            {"threads": []}, topic, "vault", touched, state=state
        )
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        return now

    def _ledger(self):
        import json as _json
        lines = [
            l for l in self.bot.PROACTIVE_LEDGER_PATH.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        return [_json.loads(l) for l in lines]

    async def test_remind_branch_runs_records_and_sends(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        ran = {"discord": 0}

        async def _fake_run_discord(prompt, options):
            ran["discord"] += 1
            ran["prompt"] = prompt
            ran["session_id"] = options.session_id
            ran["resume"] = options.resume_session
            return _ok_result("そういえばディスク管理どうなった?")

        async def _fail_run_claude(*a, **kw):
            raise AssertionError("talk パスの run_claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        sent = mock.AsyncMock()
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fail_run_claude), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        # ephemeral session で起動 (resume しない、新規 session_id)。
        self.assertEqual(ran["discord"], 1)
        self.assertIsNotNone(ran["session_id"])
        self.assertIsNone(ran["resume"])
        self.assertIn("ディスク管理", ran["prompt"])
        # #chat に報告送信。
        sent.assert_awaited_once()
        # index: last_remind が now で更新、thread state は触らない (調査でも起票でもない)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_remind"], now.isoformat())
        self.assertEqual(index["threads"][0]["state"], "active")
        self.assertNotIn("last_investigate", index)
        self.assertNotIn("last_ticket", index)
        # ledger は remind モードで sent。
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "remind")
        self.assertEqual(rec["remind_signal"], "ディスク管理")
        self.assertTrue(rec["sent"])
        self.assertTrue(rec["foreground_proposal"])
        # #chat session の last_prompt_at が更新された (4h 最低間隔保全)。
        meta = self.bot.sessions.load(self.bot.NOTIFY_CHAT_ID, self.bot.BOT_THREAD_ID_CHAT)
        self.assertIsNotNone(meta)
        self.assertIsNotNone(meta.last_prompt_at)

    async def test_researched_thread_still_signals_remind(self) -> None:
        # 調べたきり放置 (researched) thread こそ「あれどうなった?」の振り返り対象。
        from unittest import mock

        now = self._seed_active("ディスク管理", state="researched")

        async def _fake_run_discord(prompt, options):
            return _ok_result("ディスク管理の件、その後どう?")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "remind")
        self.assertEqual(rec["remind_signal"], "ディスク管理")

    async def test_ticket_takes_priority_over_remind(self) -> None:
        # 固定優先順: ticket due なら ticket を引き、remind は引かれない。
        from unittest import mock

        now = self._seed_active("ディスク管理")
        self.bot.PROACTIVE_TICKET_ENABLED = True

        async def _fake_run_discord(prompt, options):
            return _ok_result("#42 起票しといた")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "ticket")
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertIn("last_ticket", index)
        self.assertNotIn("last_remind", index)

    async def test_empty_index_falls_through_to_talk(self) -> None:
        # §F の核: index 空 = 実 signal 無し → 振り返らず talk へ (でっち上げた過去を振り返らない)。
        from datetime import datetime
        from unittest import mock

        now = datetime(2026, 6, 19, 12, 0, 0, tzinfo=self.bot.quota.JST)
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ"

        async def _no_discord(prompt, options):
            raise AssertionError("signal 無しで振り返り claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)
        rec = self._ledger()[-1]
        self.assertNotIn("mode", rec)

    async def test_disabled_falls_through_to_talk(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        self.bot.PROACTIVE_REMIND_ENABLED = False
        talk = {"called": 0}

        async def _fake_run_claude(prompt, chat_id, thread_id):
            talk["called"] += 1
            return "やあ"

        async def _no_discord(prompt, options):
            raise AssertionError("disabled 時に振り返り claude を呼んではいけない")

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "run_claude", side_effect=_fake_run_claude), \
             mock.patch.object(self.bot, "send_text", new=mock.AsyncMock()), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        self.assertEqual(talk["called"], 1)
        rec = self._ledger()[-1]
        self.assertNotIn("mode", rec)

    async def test_empty_report_skips_but_consumes_interval(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _fake_run_discord(prompt, options):
            return _ok_result("   ")  # 空白のみ = 振り返る実体なく空報告

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="none")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        sent.assert_not_awaited()
        # interval は消費 (last_remind が更新)。thread state は触らない。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_remind"], now.isoformat())
        self.assertEqual(index["threads"][0]["state"], "active")
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "remind")
        self.assertFalse(rec["sent"])
        self.assertEqual(rec["reason"], "empty_or_denied")

    async def test_budget_denied_in_run_remind_skips(self) -> None:
        from unittest import mock

        now = self._seed_active("ディスク管理")
        sent = mock.AsyncMock()

        async def _no_discord(prompt, options):
            raise AssertionError("budget 拒否時に claude を起動してはいけない")

        allow_calls = {"n": 0}

        def _allow(now_arg):
            allow_calls["n"] += 1
            # 1 回目 (_run_proactive 入口) は True、2 回目 (run_remind) は False。
            return allow_calls["n"] == 1

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "datetime") as dt, \
             mock.patch.object(self.bot.budget_guard, "allow", side_effect=_allow), \
             mock.patch.object(self.bot.budget_guard, "summary",
                               return_value=mock.MagicMock(guard_kind="requests_count")), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_no_discord), \
             mock.patch.object(self.bot, "send_text", new=sent), \
             mock.patch.object(self.bot, "_dispatch_proactive_voice", return_value="disabled"):
            dt.now.return_value = now
            await self.bot._run_proactive(
                app, {"kind": "proactive", "seed_kind": "recent_conversation"}
            )

        sent.assert_not_awaited()
        rec = self._ledger()[-1]
        self.assertEqual(rec["mode"], "remind")
        self.assertFalse(rec["sent"])
        # interval は起動を決めた時点で消費する設計 (budget 拒否でも record_remind は走る)。
        index = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(index["last_remind"], now.isoformat())

    def test_record_remind_preserves_other_mode_intervals(self) -> None:
        # 先に investigate / ticket の interval がある index で remind を record しても、
        # 他 mode の interval が残り、自分の interval が新しく入る (逆向き clobber 回帰)。
        now = self._seed_active("ディスク管理")
        data = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        data = {
            **data,
            "last_investigate": "2026-06-01T00:00:00+09:00",
            "last_ticket": "2026-06-02T00:00:00+09:00",
        }
        self.bot.interests.save_interests(self.bot.INTERESTS_INDEX_PATH, data)
        self.bot.record_remind(now)
        idx = self.bot.interests.load_interests(self.bot.INTERESTS_INDEX_PATH)
        self.assertEqual(idx["last_investigate"], "2026-06-01T00:00:00+09:00")
        self.assertEqual(idx["last_ticket"], "2026-06-02T00:00:00+09:00")
        self.assertEqual(idx["last_remind"], now.isoformat())


class BuildRemindPromptTest(unittest.TestCase):
    """build_remind_prompt の boundary 文字列を検証 (settings でなくプロンプトで強制)。

    reminder は外向き/不可逆操作ゼロ = tickets.py は読み取りのみ、起票・編集は禁止、
    催促・引き止め禁止 (軸 1 整合)。これらをプロンプト文言として確認する。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_signal_is_embedded(self) -> None:
        prompt = self.bot.build_remind_prompt("ディスク管理")
        self.assertIn("ディスク管理", prompt)

    def test_tickets_read_only(self) -> None:
        prompt = self.bot.build_remind_prompt("topic")
        # 読み取りは list --all まで。add は登場せず、add/done/start/編集は禁止文脈で明記。
        self.assertIn("list --all", prompt)
        self.assertNotIn("tickets.py add", prompt)
        self.assertIn("add/done/start/編集は一切しない", prompt)

    def test_owner_and_own_ticket_untouchable(self) -> None:
        prompt = self.bot.build_remind_prompt("topic")
        self.assertIn("OWNER", prompt)
        self.assertIn("触らない", prompt)

    def test_no_nagging(self) -> None:
        # 催促・情緒的引き止め禁止 (軸 1 整合、未返信への追撃をしない)。
        prompt = self.bot.build_remind_prompt("topic")
        self.assertIn("催促", prompt)
        self.assertIn("引き止め", prompt)

    def test_no_fabrication(self) -> None:
        prompt = self.bot.build_remind_prompt("topic")
        self.assertIn("でっち上げ", prompt)


class DispatchProactiveVoiceTest(unittest.IsolatedAsyncioTestCase):
    """_dispatch_proactive_voice の判定 (disabled / too_long / dispatched)。

    「生成と再生の分離」(todo#22): 声は別 task に投げて proactive worker を
    ブロックしない。ここでは判定戻り値と cmd_say 呼び出し有無を検証する。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    async def test_disabled_returns_disabled_without_task(self) -> None:
        from unittest import mock

        app = mock.MagicMock()
        app.bot_data = {}
        with mock.patch.object(self.bot, "PROACTIVE_VOICE_ENABLED", False), \
             mock.patch.object(self.bot.voice_command, "cmd_say") as say:
            state = self.bot._dispatch_proactive_voice(app, "やあ")

        self.assertEqual(state, "disabled")
        say.assert_not_called()
        self.assertNotIn("proactive_voice_tasks", app.bot_data)

    async def test_too_long_returns_too_long_without_task(self) -> None:
        from unittest import mock

        app = mock.MagicMock()
        app.bot_data = {}
        long_text = "あ" * (self.bot.voice_command.MAX_SAY_TEXT + 1)
        with mock.patch.object(self.bot, "PROACTIVE_VOICE_ENABLED", True), \
             mock.patch.object(self.bot.voice_command, "cmd_say") as say:
            state = self.bot._dispatch_proactive_voice(app, long_text)

        self.assertEqual(state, "too_long")
        say.assert_not_called()

    async def test_dispatched_invokes_cmd_say_in_background(self) -> None:
        from unittest import mock

        app = mock.MagicMock()
        app.bot_data = {}

        async def _fake_say(text):
            return 0, "[say] ✓ 発話完了"

        with mock.patch.object(self.bot, "PROACTIVE_VOICE_ENABLED", True), \
             mock.patch.object(self.bot.voice_command, "cmd_say",
                               side_effect=_fake_say) as say:
            state = self.bot._dispatch_proactive_voice(app, "ちょっと一息どう")
            # detach した task を待ってから cmd_say の呼び出しを確認する。
            tasks = list(app.bot_data["proactive_voice_tasks"])
            self.assertEqual(len(tasks), 1)
            await asyncio.gather(*tasks)

        self.assertEqual(state, "dispatched")
        say.assert_awaited_once_with("ちょっと一息どう")
        # 完了した task は done callback で集合から除かれる。
        self.assertEqual(len(app.bot_data["proactive_voice_tasks"]), 0)


class RunClaudePersonaWiringTest(unittest.IsolatedAsyncioTestCase):
    """run_claude が組む ClaudeOptions に persona system prompt が常に乗ること。

    口調 (軸 1「対等な相方」) は全 claude 呼び出し共通の配線。runner.run_discord を
    spy に差し替えて options.append_system_prompt を捕捉する。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    async def test_options_carry_persona_system_prompt(self) -> None:
        from unittest import mock

        from claude_runner import ClaudeResult, ErrorKind

        captured = {}

        async def _fake_run_discord(prompt, options):
            captured["options"] = options
            return ClaudeResult(
                rc=0, error_kind=ErrorKind.OK, raw_stdout="", raw_stderr="",
                result_text="ok", session_id="dummy",
            )

        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(self.bot.sessions, "_SESSIONS_DIR", Path(tmp) / "topics"), \
             mock.patch.object(self.bot.budget_guard, "allow", return_value=True), \
             mock.patch.object(self.bot.budget_guard, "record"), \
             mock.patch.object(self.bot.runner, "run_discord", side_effect=_fake_run_discord):
            out = await self.bot.run_claude("hi", -1001234567890, 5)

        self.assertEqual(out, "ok")
        self.assertEqual(
            captured["options"].append_system_prompt,
            self.bot.PERSONA_SYSTEM_PROMPT,
        )


class ForegroundDemotionRuleTest(unittest.TestCase):
    """軸 4 拡張 (6): 前景降格ルールが PERSONA_SYSTEM_PROMPT に載ること。

    不可逆/外向きの自動実行を解禁せず「やっとこうか?」と前景提案に降格させる方針を
    全モード共通層 (PERSONA_SYSTEM_PROMPT、talk/investigate/ticket が共有) で 1 度だけ
    定義する。降格ルールはこの定数に乗るので、個別タスクプロンプト側では汎用禁止を
    重複列挙しない (二重定義整理)。
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_demotion_keywords_present(self) -> None:
        sp = self.bot.PERSONA_SYSTEM_PROMPT
        # 対等な語気の前景提案 + 自動実行禁止のキー文言。
        self.assertIn("やっとこうか", sp)
        self.assertIn("自分で実行するな", sp)
        # 「許可をください」ではなく対等に、を明示。
        self.assertIn("許可をください", sp)
        # 投げっぱなし (催促・引き止めしない)。
        self.assertIn("催促も引き止めもしない", sp)

    def test_irreversible_targets_enumerated(self) -> None:
        sp = self.bot.PERSONA_SYSTEM_PROMPT
        # 降格対象の不可逆/外向き操作が PERSONA 側に列挙される (一本化先)。
        for kw in ("tweet", "メール", "vault push", "maintenance", "設定変更"):
            self.assertIn(kw, sp)

    def test_generic_prohibition_not_duplicated_in_ticket_prompt(self) -> None:
        # 汎用「tweet/メール/vault push をやるな」列挙は PERSONA へ一本化済。
        # ticket プロンプトには重複させない (タスク固有 allowlist は残す)。
        prompt = self.bot.build_ticket_prompt("topic")
        self.assertNotIn("ツイート/メール/vault push", prompt)
        # タスク固有 allowlist は維持されている。
        self.assertIn("--by ai", prompt)
        self.assertIn("`--by user` を付けない", prompt)
        self.assertIn("2 件以上は絶対に起票しない", prompt)

    def test_investigate_prompt_keeps_notes_allowlist(self) -> None:
        # investigate のタスク固有 allowlist (notes/ のみ・新規作成のみ・手書き不可触)
        # は降格ルール一本化の影響を受けず残る。
        prompt = self.bot.build_investigate_prompt("topic")
        self.assertIn("新規作成", prompt)
        self.assertIn("上書き", prompt)
        self.assertIn("notes/ 以外", prompt)


class SyndicationTokenTest(unittest.TestCase):
    """`_syndication_token` の固定値検証 (react-tweet 互換、実機検証済の 2 ID)。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_token_for_id_20(self) -> None:
        self.assertEqual(self.bot._syndication_token("20"), "6dq1a2xwd93jfti9")

    def test_token_for_long_id(self) -> None:
        self.assertEqual(
            self.bot._syndication_token("1349129669258448897"),
            "39qeyy97t9wsjr4724t2o6r",
        )


class ExtractTweetIdTest(unittest.TestCase):
    """URL → tweet id 抽出: 各受理形式と弾く形式。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_x_com_https(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("https://x.com/user/status/1349129669258448897"),
            "1349129669258448897",
        )

    def test_twitter_com_https(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("https://twitter.com/user/status/20"),
            "20",
        )

    def test_www_prefix(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("https://www.twitter.com/user/status/20"),
            "20",
        )

    def test_mobile_prefix(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("https://mobile.x.com/user/status/20"),
            "20",
        )

    def test_query_string_ignored(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("https://x.com/user/status/20?s=20&t=abc"),
            "20",
        )

    def test_http_scheme_accepted(self) -> None:
        self.assertEqual(
            self.bot.extract_tweet_id("http://x.com/user/status/20"),
            "20",
        )

    def test_unknown_host_rejected(self) -> None:
        self.assertIsNone(
            self.bot.extract_tweet_id("https://evil.com/user/status/20")
        )

    def test_userinfo_spoof_rejected(self) -> None:
        self.assertIsNone(
            self.bot.extract_tweet_id("https://evil@x.com/user/status/20")
        )

    def test_non_http_scheme_rejected(self) -> None:
        self.assertIsNone(self.bot.extract_tweet_id("ftp://x.com/user/status/20"))

    def test_no_status_path_rejected(self) -> None:
        self.assertIsNone(self.bot.extract_tweet_id("https://x.com/user"))

    def test_non_numeric_status_rejected(self) -> None:
        self.assertIsNone(self.bot.extract_tweet_id("https://x.com/user/status/abc"))

    def test_whitespace_rejected(self) -> None:
        self.assertIsNone(self.bot.extract_tweet_id("https://x.com/user/status/2 0"))


class SafeScreenNameTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_alnum_kept(self) -> None:
        self.assertEqual(self.bot._safe_screen_name("Jack_2024"), "Jack_2024")

    def test_unsafe_chars_stripped(self) -> None:
        self.assertEqual(self.bot._safe_screen_name("a/b\\c.d e"), "abcde")

    def test_empty_falls_back(self) -> None:
        self.assertEqual(self.bot._safe_screen_name(""), "unknown")


class SafeAttachmentNameTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_basename_from_pbs_url(self) -> None:
        self.assertEqual(
            self.bot._safe_attachment_name(
                "https://pbs.twimg.com/media/ErkSSFgW4AMKude.jpg"
            ),
            "ErkSSFgW4AMKude.jpg",
        )

    def test_query_stripped(self) -> None:
        self.assertEqual(
            self.bot._safe_attachment_name(
                "https://pbs.twimg.com/media/AbC_1-2.png?format=png&name=large"
            ),
            "AbC_1-2.png",
        )

    def test_traversal_chars_removed(self) -> None:
        # basename を取った後に残る危険文字を除去 (パストラバーサル防止)。
        self.assertEqual(
            self.bot._safe_attachment_name("https://pbs/media/a b/c$%d.jpg"),
            "cd.jpg",
        )

    def test_empty_or_dot_only_returns_none(self) -> None:
        self.assertIsNone(self.bot._safe_attachment_name(""))
        self.assertIsNone(self.bot._safe_attachment_name("https://pbs/media/"))
        self.assertIsNone(self.bot._safe_attachment_name("https://pbs/media/..."))


class HighResImageUrlTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_appends_name_large(self) -> None:
        self.assertEqual(
            self.bot._high_res_image_url("https://pbs.twimg.com/media/x.jpg"),
            "https://pbs.twimg.com/media/x.jpg?name=large",
        )

    def test_leaves_existing_query_alone(self) -> None:
        url = "https://pbs.twimg.com/media/x.jpg?format=jpg"
        self.assertEqual(self.bot._high_res_image_url(url), url)


class SelectMediaTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_photo_structured(self) -> None:
        details = [{
            "type": "photo",
            "media_url_https": "https://pbs.twimg.com/media/ErkSSFgW4AMKude.jpg",
        }]
        out = self.bot._select_media(details)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["kind"], "photo")
        self.assertEqual(out[0]["filename"], "ErkSSFgW4AMKude.jpg")
        self.assertEqual(
            out[0]["dl_url"],
            "https://pbs.twimg.com/media/ErkSSFgW4AMKude.jpg?name=large",
        )

    def test_video_picks_highest_mp4_bitrate(self) -> None:
        details = [{
            "type": "video",
            "video_info": {"variants": [
                {"content_type": "application/x-mpegURL", "url": "https://v/playlist.m3u8"},
                {"content_type": "video/mp4", "bitrate": 256000, "url": "https://v/low.mp4"},
                {"content_type": "video/mp4", "bitrate": 2176000, "url": "https://v/high.mp4"},
            ]},
        }]
        out = self.bot._select_media(details)
        self.assertEqual(out, [{"kind": "video", "url": "https://v/high.mp4"}])

    def test_animated_gif_mp4(self) -> None:
        details = [{
            "type": "animated_gif",
            "video_info": {"variants": [
                {"content_type": "video/mp4", "bitrate": 0, "url": "https://v/gif.mp4"},
            ]},
        }]
        out = self.bot._select_media(details)
        self.assertEqual(out, [{"kind": "video", "url": "https://v/gif.mp4"}])

    def test_photo_without_basename_skipped(self) -> None:
        details = [{"type": "photo", "media_url_https": "https://pbs/media/"}]
        self.assertEqual(self.bot._select_media(details), [])

    def test_empty_and_none(self) -> None:
        self.assertEqual(self.bot._select_media([]), [])
        self.assertEqual(self.bot._select_media(None), [])


class TweetTitleTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _now(self):
        from datetime import datetime
        import quota
        return datetime(2026, 6, 8, 12, 0, tzinfo=quota.JST)

    def test_first_nonblank_line(self) -> None:
        text = "\n\n  最初の行  \n二行目"
        self.assertEqual(
            self.bot._tweet_title(text, "jack", "2026-06-08T01:00:00.000Z", self._now()),
            "最初の行",
        )

    def test_truncates_long_line(self) -> None:
        text = "あ" * 200
        out = self.bot._tweet_title(text, "jack", "", self._now(), max_len=80)
        self.assertTrue(out.endswith("…"))
        self.assertLessEqual(len(out), 81)

    def test_empty_text_falls_back_to_handle_datetime(self) -> None:
        out = self.bot._tweet_title("", "jack", "2026-06-08T01:00:00.000Z", self._now())
        # created_at は JST に変換される (01:00 UTC → 10:00 JST)
        self.assertEqual(out, "jack(2026-06-08 10:00)")


class TweetClipFilenameTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_no_collision_plain_name(self) -> None:
        out = self.bot._tweet_clip_filename(
            "jack", "20", "2026-06-08", lambda f: False
        )
        self.assertEqual(out, "2026-06-08 @jack.md")

    def test_collision_suffixes_tweet_id(self) -> None:
        existing = {"2026-06-08 @jack.md"}
        out = self.bot._tweet_clip_filename(
            "jack", "20", "2026-06-08", lambda f: f in existing
        )
        self.assertEqual(out, "2026-06-08 @jack 20.md")

    def test_unsafe_handle_sanitized(self) -> None:
        out = self.bot._tweet_clip_filename(
            "a/b c", "20", "2026-06-08", lambda f: False
        )
        self.assertEqual(out, "2026-06-08 @abc.md")


class TweetPublishedDateTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _now(self):
        from datetime import datetime
        import quota
        return datetime(2026, 6, 8, 12, 0, tzinfo=quota.JST)

    def test_jst_conversion(self) -> None:
        # 2026-06-08 16:00 UTC → 2026-06-09 01:00 JST (日付が繰り上がる)
        self.assertEqual(
            self.bot._tweet_published_date("2026-06-08T16:00:00.000Z", self._now()),
            "2026-06-09",
        )

    def test_fallback_to_now_when_missing(self) -> None:
        self.assertEqual(self.bot._tweet_published_date("", self._now()), "2026-06-08")


class BuildTweetMarkdownTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _now(self):
        from datetime import datetime
        import quota
        return datetime(2026, 6, 8, 12, 0, tzinfo=quota.JST)

    def test_frontmatter_and_body_with_photo(self) -> None:
        data = {
            "__typename": "Tweet",
            "text": "hello &amp; world",
            "user": {"name": "Jack", "screen_name": "jack"},
            "created_at": "2026-06-08T01:00:00.000Z",
        }
        media = [{"kind": "photo", "filename": "ErkSSFgW4AMKude.jpg",
                  "dl_url": "https://pbs/x.jpg?name=large"}]
        md = self.bot.build_tweet_markdown(
            data, "20", media, self._now()
        )
        self.assertIn('url: "https://x.com/jack/status/20"', md)
        self.assertIn('title: "hello & world"', md)  # 本文先頭行を流用 + デコード
        self.assertIn("author:", md)
        self.assertIn('  - "Jack"', md)
        self.assertIn('handle: "jack"', md)
        self.assertIn('  - "tweet"', md)
        self.assertIn('  - "clippings"', md)
        self.assertIn('  - "media"', md)  # 画像ありなので media タグ
        self.assertIn('  - "processed"', md)
        self.assertIn("published: 2026-06-08", md)  # 01:00 UTC → 10:00 JST、同日
        self.assertIn("created: 2026-06-08", md)
        self.assertIn('image: "attachments/ErkSSFgW4AMKude.jpg"', md)
        self.assertIn("## Tweet", md)
        # HTML エンティティがデコードされること
        self.assertIn("hello & world", md)
        self.assertNotIn("&amp;", md)
        # Obsidian 埋め込み wikilink (folder 名なし) で参照
        self.assertIn("## Media", md)
        self.assertIn("![[ErkSSFgW4AMKude.jpg]]", md)
        self.assertIn("## Notes", md)

    def test_video_link_not_embedded(self) -> None:
        data = {
            "__typename": "Tweet",
            "text": "vid",
            "user": {"name": "X", "screen_name": "x"},
            "created_at": "2026-06-08T01:00:00.000Z",
        }
        media = [{"kind": "video", "url": "https://v/high.mp4"}]
        md = self.bot.build_tweet_markdown(data, "1", media, self._now())
        self.assertIn('  - "media"', md)  # 動画も media タグ対象
        self.assertIn("[動画](https://v/high.mp4)", md)
        self.assertNotIn("![[", md)  # 動画は埋め込まない
        self.assertNotIn("image:", md)  # photo なしなので image フィールドなし

    def test_no_media_section_when_absent(self) -> None:
        data = {
            "__typename": "Tweet",
            "text": "no media",
            "user": {"name": "X", "screen_name": "x"},
            "created_at": "2026-06-08T01:00:00.000Z",
        }
        md = self.bot.build_tweet_markdown(data, "1", [], self._now())
        self.assertNotIn("## Media", md)
        self.assertNotIn('  - "media"', md)
        self.assertNotIn("image:", md)

    def test_empty_text_title_falls_back(self) -> None:
        data = {
            "__typename": "Tweet",
            "text": "",
            "user": {"name": "X", "screen_name": "x"},
            "created_at": "2026-06-08T01:00:00.000Z",
        }
        md = self.bot.build_tweet_markdown(data, "1", [], self._now())
        self.assertIn('title: "x(2026-06-08 10:00)"', md)

    def test_canonical_url_in_frontmatter(self) -> None:
        # tweet_id から正規 URL を組み立て、トラッキングパラメータは持ち込まない。
        data = {
            "__typename": "Tweet",
            "text": "hi",
            "user": {"name": "X", "screen_name": "amarunavr"},
            "created_at": "2026-06-08T01:00:00.000Z",
        }
        md = self.bot.build_tweet_markdown(data, "2063267371713020257", [], self._now())
        self.assertIn(
            'url: "https://x.com/amarunavr/status/2063267371713020257"', md
        )

    def test_body_expands_and_strips_tco(self) -> None:
        # amarunavr の実 entities を模す: 外部リンク t.co → booth.pm 展開、媒体 t.co 除去。
        data = {
            "__typename": "Tweet",
            "text": "本文だよ\n\nhttps://t.co/3E7TXHPjKA https://t.co/rYtonSwjkh",
            "user": {"name": "天江るな", "screen_name": "amarunavr"},
            "created_at": "2026-06-06T14:30:00.000Z",
            "entities": {
                "urls": [
                    {
                        "url": "https://t.co/3E7TXHPjKA",
                        "expanded_url": "https://booth.pm/ja/items/4503244",
                        "display_url": "booth.pm/ja/items/4503244",
                    }
                ],
                "media": [{"url": "https://t.co/rYtonSwjkh"}],
            },
        }
        md = self.bot.build_tweet_markdown(data, "2063267371713020257", [], self._now())
        self.assertIn("https://booth.pm/ja/items/4503244", md)
        self.assertNotIn("https://t.co/3E7TXHPjKA", md)
        self.assertNotIn("https://t.co/rYtonSwjkh", md)


class ExpandTweetTextTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_expand_url_and_strip_media(self) -> None:
        # amarunavr の実 entities を模したケース (ネットワーク非依存)。
        text = "対応めっちゃ楽になる😭🩶\n\nhttps://t.co/3E7TXHPjKA https://t.co/rYtonSwjkh"
        entities = {
            "urls": [
                {
                    "url": "https://t.co/3E7TXHPjKA",
                    "expanded_url": "https://booth.pm/ja/items/4503244",
                    "display_url": "booth.pm/ja/items/4503244",
                }
            ],
            "media": [{"url": "https://t.co/rYtonSwjkh"}],
        }
        out = self.bot.expand_tweet_text(text, entities)
        self.assertEqual(
            out,
            "対応めっちゃ楽になる😭🩶\n\nhttps://booth.pm/ja/items/4503244",
        )

    def test_no_entities_is_noop(self) -> None:
        text = "ただの本文\n\n末尾"
        self.assertEqual(self.bot.expand_tweet_text(text, {}), text)
        self.assertEqual(self.bot.expand_tweet_text(text, None), text)

    def test_empty_text(self) -> None:
        self.assertEqual(self.bot.expand_tweet_text("", {}), "")
        self.assertEqual(self.bot.expand_tweet_text(None, {}), "")

    def test_multiple_urls_expanded(self) -> None:
        text = "a https://t.co/AAA b https://t.co/BBB"
        entities = {
            "urls": [
                {"url": "https://t.co/AAA", "expanded_url": "https://example.com/1"},
                {"url": "https://t.co/BBB", "expanded_url": "https://example.com/2"},
            ]
        }
        out = self.bot.expand_tweet_text(text, entities)
        self.assertEqual(out, "a https://example.com/1 b https://example.com/2")

    def test_media_only_strip_trims_trailing_whitespace(self) -> None:
        # 媒体 t.co 除去で行末に空白が残らず、末尾の余分な空行も畳まれること。
        text = "本文\n\nhttps://t.co/MEDIA"
        entities = {"media": [{"url": "https://t.co/MEDIA"}]}
        out = self.bot.expand_tweet_text(text, entities)
        self.assertEqual(out, "本文")

    def test_malformed_entities_entries_skipped(self) -> None:
        text = "x https://t.co/AAA"
        entities = {"urls": ["not a dict", {"url": "https://t.co/AAA"}]}
        # expanded_url 欠落 / 非 dict は no-op (落ちない)。
        out = self.bot.expand_tweet_text(text, entities)
        self.assertEqual(out, "x https://t.co/AAA")


class IncomingPhotoFilenameTest(unittest.TestCase):
    """chat 画像の保存ファイル名生成 (`<ts>_<file_unique_id>.jpg`、英数 _.- のみ)。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _now(self):
        from datetime import datetime
        import quota
        return datetime(2026, 6, 10, 12, 34, 56, tzinfo=quota.JST)

    def test_basic_format(self) -> None:
        out = self.bot.incoming_photo_filename(self._now(), "AgADBAADr6cxG2hP")
        self.assertEqual(out, "20260610-123456_AgADBAADr6cxG2hP.jpg")

    def test_unsafe_chars_stripped(self) -> None:
        out = self.bot.incoming_photo_filename(self._now(), "a/b c$%..d-1_x")
        self.assertEqual(out, "20260610-123456_abc..d-1_x.jpg")

    def test_empty_id_falls_back(self) -> None:
        out = self.bot.incoming_photo_filename(self._now(), "")
        self.assertEqual(out, "20260610-123456_photo.jpg")

    def test_dot_only_id_falls_back(self) -> None:
        # 安全化後にドットしか残らない退化形は photo に倒す (パストラバーサル防止)。
        out = self.bot.incoming_photo_filename(self._now(), "../..")
        self.assertEqual(out, "20260610-123456_photo.jpg")


class SelectPruneTargetsTest(unittest.TestCase):
    """prune 対象選定: timestamp prefix の辞書順 = 時系列、sort 1 回で世代確定。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _names(self, count: int) -> list[str]:
        # 20260610-000000_a.jpg, 20260610-000001_a.jpg, ... (古い順)
        return [f"20260610-{i:06d}_a.jpg" for i in range(count)]

    def test_under_keep_returns_empty(self) -> None:
        self.assertEqual(self.bot.select_prune_targets(self._names(9), keep=10), [])

    def test_at_keep_returns_empty(self) -> None:
        self.assertEqual(self.bot.select_prune_targets(self._names(10), keep=10), [])

    def test_over_keep_returns_oldest(self) -> None:
        names = self._names(12)
        out = self.bot.select_prune_targets(names, keep=10)
        self.assertEqual(out, names[:2])  # 最古 2 件だけが削除対象

    def test_unordered_input_sorted_first(self) -> None:
        names = self._names(11)
        shuffled = list(reversed(names))
        out = self.bot.select_prune_targets(shuffled, keep=10)
        self.assertEqual(out, [names[0]])

    def test_empty_returns_empty(self) -> None:
        self.assertEqual(self.bot.select_prune_targets([], keep=10), [])


class PruneIncomingTest(unittest.TestCase):
    """prune_incoming の実ファイル削除 (tmpdir、最新 keep 件だけ残る)。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.topic_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_keeps_newest_files(self) -> None:
        names = [f"20260610-{i:06d}_a.jpg" for i in range(12)]
        for n in names:
            (self.topic_dir / n).write_bytes(b"x")
        self.bot.prune_incoming(self.topic_dir, keep=10)
        remaining = sorted(p.name for p in self.topic_dir.glob("*.jpg"))
        self.assertEqual(remaining, names[2:])

    def test_noop_when_under_keep(self) -> None:
        for i in range(3):
            (self.topic_dir / f"20260610-{i:06d}_a.jpg").write_bytes(b"x")
        self.bot.prune_incoming(self.topic_dir, keep=10)
        self.assertEqual(len(list(self.topic_dir.glob("*.jpg"))), 3)

    def test_non_jpg_untouched(self) -> None:
        # 世代管理対象は *.jpg のみ (download 形式固定)。他のファイルは触らない。
        (self.topic_dir / "note.txt").write_bytes(b"x")
        for i in range(11):
            (self.topic_dir / f"20260610-{i:06d}_a.jpg").write_bytes(b"x")
        self.bot.prune_incoming(self.topic_dir, keep=10)
        self.assertTrue((self.topic_dir / "note.txt").exists())
        self.assertEqual(len(list(self.topic_dir.glob("*.jpg"))), 10)


class BuildPhotoPromptTest(unittest.TestCase):
    """画像応答 prompt 組み立て: 保存先パス + Read 指示 + キャプション/デフォルト文。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_caption_used_as_body(self) -> None:
        prompt = self.bot.build_photo_prompt(
            "/home/miho/companion/bot-workspace/incoming/k/x.jpg", "これ何の花?"
        )
        self.assertIn("/home/miho/companion/bot-workspace/incoming/k/x.jpg", prompt)
        self.assertIn("Read ツール", prompt)
        self.assertIn("これ何の花?", prompt)
        self.assertNotIn(self.bot.PHOTO_DEFAULT_PROMPT, prompt)

    def test_default_body_when_no_caption(self) -> None:
        prompt = self.bot.build_photo_prompt("/tmp/x.jpg", None)
        self.assertIn(self.bot.PHOTO_DEFAULT_PROMPT, prompt)

    def test_whitespace_caption_falls_back_to_default(self) -> None:
        prompt = self.bot.build_photo_prompt("/tmp/x.jpg", "   \n ")
        self.assertIn(self.bot.PHOTO_DEFAULT_PROMPT, prompt)

    def test_path_object_accepted(self) -> None:
        prompt = self.bot.build_photo_prompt(Path("/tmp/y.jpg"), "見て")
        self.assertIn("/tmp/y.jpg", prompt)


class CmdStatusTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def _call(self, usage_return):
        from unittest import mock
        from datetime import datetime as dt
        now = dt(2026, 6, 28, 12, 0, 0, tzinfo=self.bot.quota.JST)
        summary = mock.MagicMock()
        summary.last_call_at = now
        with mock.patch.object(self.bot.sessions, "load", return_value=None), \
             mock.patch.object(self.bot.budget_guard, "summary", return_value=summary), \
             mock.patch.object(self.bot.voice_status, "format_voice_summary", return_value="voice: ok"), \
             mock.patch.object(self.bot.quota, "last_usage_for_topic", return_value=usage_return), \
             mock.patch.object(self.bot, "BOT_START_AT", now):
            return self.bot.cmd_status(-100, 3, socket_ok=True)

    def test_reset_hint_shown_when_cache_read_exceeds_150k(self) -> None:
        result = self._call({"cache_read_input_tokens": 200_000})
        self.assertIn("cache_read 200,000 tokens", result)
        self.assertIn("/reset", result)

    def test_no_reset_hint_when_cache_read_below_150k(self) -> None:
        result = self._call({"cache_read_input_tokens": 45_000})
        self.assertIn("cache_read 45,000 tokens", result)
        self.assertNotIn("/reset", result)

    def test_no_context_line_when_usage_none(self) -> None:
        result = self._call(None)
        self.assertNotIn("session context", result)


class FetchOfficialUsageTest(unittest.IsolatedAsyncioTestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    async def test_success_returns_stdout(self) -> None:
        from unittest import mock

        fake_proc = mock.AsyncMock()
        fake_proc.communicate = mock.AsyncMock(
            return_value=(b"Session usage: 42%\nWeekly: 10%", b"")
        )
        fake_proc.returncode = 0

        with mock.patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await self.bot._fetch_official_usage()

        self.assertEqual(result, "Session usage: 42%\nWeekly: 10%")

    async def test_nonzero_rc_returns_none(self) -> None:
        from unittest import mock

        fake_proc = mock.AsyncMock()
        fake_proc.communicate = mock.AsyncMock(return_value=(b"error", b""))
        fake_proc.returncode = 1

        with mock.patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await self.bot._fetch_official_usage()

        self.assertIsNone(result)

    async def test_timeout_kills_process_and_returns_none(self) -> None:
        from unittest import mock

        fake_proc = mock.AsyncMock()
        fake_proc.kill = mock.Mock()
        fake_proc.wait = mock.AsyncMock()

        with mock.patch("asyncio.create_subprocess_exec", return_value=fake_proc), \
             mock.patch("asyncio.wait_for", side_effect=asyncio.TimeoutError):
            result = await self.bot._fetch_official_usage()

        self.assertIsNone(result)
        fake_proc.kill.assert_called_once()
        fake_proc.wait.assert_awaited_once()

    async def test_spawn_failure_returns_none(self) -> None:
        from unittest import mock

        with mock.patch(
            "asyncio.create_subprocess_exec",
            side_effect=FileNotFoundError("claude not found"),
        ):
            result = await self.bot._fetch_official_usage()

        self.assertIsNone(result)

    async def test_empty_stdout_returns_none(self) -> None:
        from unittest import mock

        fake_proc = mock.AsyncMock()
        fake_proc.communicate = mock.AsyncMock(return_value=(b"  \n  ", b""))
        fake_proc.returncode = 0

        with mock.patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await self.bot._fetch_official_usage()

        self.assertIsNone(result)


class VaultHintGuardTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_vault_hint_omitted_when_not_string(self) -> None:
        for bad in (123, True, 6.5, ["2026-06-01_x"], {"a": 1}):
            prompt = self.bot.build_proactive_prompt(
                {"seed_kind": "recent_conversation+vault", "vault_hint": bad}
            )
            self.assertNotIn("ノート名", prompt, msg=f"vault_hint={bad!r}")


class CanonicalTweetUrlTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_build_canonical(self) -> None:
        self.assertEqual(
            self.bot.canonical_tweet_url("amarunavr", "2063267371713020257"),
            "https://x.com/amarunavr/status/2063267371713020257",
        )

    def test_handle_sanitized(self) -> None:
        # handle に不正文字が混じっても英数字 / _ / - のみ残す。
        self.assertEqual(
            self.bot.canonical_tweet_url("ab/cd", "20"),
            "https://x.com/abcd/status/20",
        )


if __name__ == "__main__":
    unittest.main()
