"""`/status` 末尾に表示する voice 集計 (voice-design v2.0 §1.5 (4))。

集計元 2 系統 (§1.6):
- ``voice/.state/last-result-YYYY-MM-DD`` (今日 + 昨日): say.sh が CLI 直接
  invoke も含めて全 invoke で書く。OK/FAIL 行は ISO8601 timestamp 付き
  (`@ <ts>` 形式、say.sh B3-1)、padding skipped 行は timestamp なしのため
  ファイル単位 (今日 + 昨日 ≈ 直近 24h) で数える。
- ``sessions/voice_ledger.jsonl``: bot 経由 /say のみ。最終発話の表示元。

表示は読み取り専用の集計で、判定・分岐には使わない (エラー分類は表面化専用、
CLAUDE.md 原則)。
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from pathlib import Path

import quota
from voice_command import VOICE_LEDGER_PATH

logger = logging.getLogger(__name__)

VOICE_STATE_DIR = Path.home() / "companion" / "voice" / ".state"

# say.sh の last-result 行: 「OK @ <ts>」「FAIL <reason>: <detail> (exit N) @ <ts>」
_RESULT_RE = re.compile(
    r"^(OK\b[^@]*|FAIL\s+(?P<reason>[A-Z_]+)[^@]*)@\s*(?P<ts>\S+)\s*$"
)


def _read_state_lines(now: datetime) -> list[str]:
    lines: list[str] = []
    for day in (now - timedelta(days=1), now):
        path = VOICE_STATE_DIR / f"last-result-{day.strftime('%Y-%m-%d')}"
        try:
            lines.extend(path.read_text(encoding="utf-8").splitlines())
        except FileNotFoundError:
            continue
        except OSError:
            logger.warning("voice last-result read failed: %s", path, exc_info=True)
    return lines


def format_voice_summary(now: datetime | None = None) -> str:
    now = now or datetime.now(quota.JST)
    threshold = now - timedelta(hours=24)

    ok = 0
    fail_reasons: dict[str, int] = {}
    padding_skipped = 0
    for line in _read_state_lines(now):
        if line.startswith("padding skipped:"):
            padding_skipped += 1
            continue
        m = _RESULT_RE.match(line)
        if m is None:
            continue
        try:
            ts = datetime.fromisoformat(m.group("ts"))
        except ValueError:
            continue
        if ts < threshold:
            continue
        if line.startswith("OK"):
            ok += 1
        else:
            reason = m.group("reason") or "UNKNOWN"
            fail_reasons[reason] = fail_reasons.get(reason, 0) + 1

    fail_total = sum(fail_reasons.values())
    if fail_total:
        detail = ", ".join(f"{r} {n}" for r, n in sorted(fail_reasons.items()))
        fail_part = f"FAIL {fail_total} ({detail})"
    else:
        fail_part = "FAIL 0"
    summary = f"voice (直近24h): OK {ok} / {fail_part} / padding skipped {padding_skipped}"

    last = None
    for entry in reversed(quota.read_ledger(VOICE_LEDGER_PATH)):
        if "text_prefix" in entry:
            last = entry
            break
    if last is not None:
        summary += (
            f"\nlast /say: 「{last.get('text_prefix', '')}」"
            f" rc={last.get('rc')} @ {last.get('ts', '?')}"
        )
    return summary
