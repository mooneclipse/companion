"""`/say` コマンド実体: VOICEVOX engine の on-demand 起動 + say.sh 実行。

仕様: ~/companion/workspace/redesign/voice-design.md v2.0 §1.3 / §1.4 / §1.8
(Discord slash command 前提の設計を Telegram CommandHandler に読み替え)。

責務分担:
- say.sh (voice/ 側、検証済み・無変更) = 合成 + 発話 + last-result 書き込み。
  engine の起動はしない (engine 不在なら rc=1 ENGINE_UNREACHABLE)。
- 本モジュール = bot 経路の engine on-demand 起動 (§1.3「都度起動、合成完了後
  stop」)。常駐 (enable) は Phase 4 trigger (1 日 5 回超 × 1 週間) 未達のため
  しない (voice/docs/STATUS.md 2026-05-19「常駐は bot/ 側着手段階で判断」)。

成否判定は say.sh の exit code 1 回で確定 (CLAUDE.md「1 回で確定」原則)。
systemctl start / ready polling は best-effort で、失敗しても say.sh の
ENGINE_UNREACHABLE がそのまま表面化する (分岐・リトライを足さない)。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path

import quota

logger = logging.getLogger(__name__)

VOICE_HOME = Path.home() / "companion" / "voice"
SAY_SH = VOICE_HOME / "scripts" / "say.sh"
READY_SH = VOICE_HOME / "bin" / "voice-engine-ready.sh"
ENGINE_UNIT = "companion-voice-engine.service"

# M-8 (voice-design v2.0 §1.4): 100 字 = warm 46s + cold 17s = 63s ≤ 90s。
# 数値だけの再調整は 2 周目ガード対象、判断材料は K-16 (rc=99 発火率 1% 超)。
MAX_SAY_TEXT = 100
SAY_TIMEOUT_S = 90.0
# ready.sh は自前で 30s benign give-up するため、これらは hang 保険のみ。
_CTL_TIMEOUT_S = 15.0
_READY_TIMEOUT_S = 40.0

# append-only ledger (quota.py パターン継承、Phase 4 trigger / /status 集計元)。
# 設計図 (§1.6) は bot/ 直下表記だが、runtime データは sessions/ 配下に置く
# 既存慣習 (ledger.jsonl) に揃えた。
VOICE_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "voice_ledger.jsonl"

_REASONS = {
    1: "ENGINE_UNREACHABLE",
    2: "ARGS_INVALID",
    3: "LOCK_TIMEOUT",
    4: "SYNTHESIS_FAILED",
    5: "AUDIO_PLAYBACK_FAILED",
}

# engine start/stop が say.sh 内 flock の外に出たため、bot 層の同時 /say で
# 「先行の finally stop が後発の合成中 engine を落とす」競合を直列化で消す。
_say_lock = asyncio.Lock()


async def _run_quiet(cmd: list[str], timeout: float) -> None:
    """Best-effort 実行。失敗は warning ログのみ (判定は say.sh rc に委ねる)。"""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            logger.warning("voice helper timeout: %s", cmd[0])
    except OSError:
        logger.warning("voice helper failed to spawn: %s", cmd, exc_info=True)


def _format_say_result(rc: int) -> str:
    if rc == 0:
        return "[say] ✓ 発話完了"
    return f"[say] ✗ FAIL {_REASONS.get(rc, 'UNKNOWN')} (exit {rc})"


async def cmd_say(text: str) -> tuple[int, str]:
    """say.sh を 1 回実行し (rc, user-facing message) を返す。

    engine は呼び出しごとに start → 合成 → stop (on-demand、§1.3)。
    stop は finally で無条件 (CLI 手動デバッグで engine を立てている最中に
    /say が来ると落とす点は許容、個人利用で併用は稀)。
    """
    async with _say_lock:
        await _run_quiet(
            ["systemctl", "--user", "start", ENGINE_UNIT], _CTL_TIMEOUT_S
        )
        await _run_quiet([str(READY_SH)], _READY_TIMEOUT_S)
        try:
            try:
                proc = await asyncio.create_subprocess_exec(
                    str(SAY_SH), text,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except OSError:
                logger.exception("say.sh spawn failed")
                return 98, "[say] ✗ say.sh を起動できません (voice/ の配置を確認)"
            try:
                await asyncio.wait_for(proc.wait(), timeout=SAY_TIMEOUT_S)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                return 99, f"[say] ✗ TIMEOUT ({int(SAY_TIMEOUT_S)}s)"
            return proc.returncode, _format_say_result(proc.returncode)
        finally:
            await _run_quiet(
                ["systemctl", "--user", "stop", ENGINE_UNIT], _CTL_TIMEOUT_S
            )


def append_ledger(text: str, rc: int, duration_ms: int) -> None:
    """1 invoke 1 行 (§1.6 schema: ts / text_prefix / rc / duration_ms)。"""
    quota.append_ledger(
        {
            "ts": datetime.now(quota.JST).isoformat(timespec="seconds"),
            "text_prefix": text[:20],
            "rc": rc,
            "duration_ms": duration_ms,
        },
        VOICE_LEDGER_PATH,
    )
