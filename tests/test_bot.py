"""Unit tests for bot.py pure helpers after the Telegram cold cut.

Standard-library only (unittest). Run from bot/ with:

    venv/bin/python -m unittest discover -s tests -v

bot.py reads env at import time (TELEGRAM_BOT_TOKEN / OWNER_ID /
NOTIFY_CHAT_ID); we stub them with dummy values via env before import so the
module loads. Helpers under test are pure (chunk_telegram, _normalize_play_url,
_fmt_duration, cmd_reset against a tmp sessions dir).
"""
from __future__ import annotations

import importlib
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
        return importlib.import_module("bot")
    except ModuleNotFoundError as e:
        raise unittest.SkipTest(f"bot module deps not installed: {e}")


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

    def test_unknown_host_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("https://evil.com/abc"))

    def test_userinfo_spoof_rejected(self) -> None:
        self.assertIsNone(self.bot._normalize_play_url("https://evil@youtube.com/abc"))

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


class BuildProactivePromptTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls) -> None:
        cls.bot = _import_bot_with_stub_env()

    def test_persona_always_present(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertIn("対等な相方", prompt)
        # 中身のない問いかけ / 引き止めを禁じる指示が prompt に乗ること
        self.assertIn("情緒で引き止める", prompt)

    def test_vault_hint_included_when_present(self) -> None:
        prompt = self.bot.build_proactive_prompt(
            {"seed_kind": "recent_conversation+vault", "vault_hint": "2026-06-01_topic"}
        )
        self.assertIn("2026-06-01_topic", prompt)

    def test_no_vault_hint_when_absent(self) -> None:
        prompt = self.bot.build_proactive_prompt({"seed_kind": "recent_conversation"})
        self.assertNotIn("ノート名", prompt)


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


if __name__ == "__main__":
    unittest.main()
