#!/usr/bin/env python3
"""companion-remote F-2 voice — say.sh を固定最小 env で argv 直叩き。

設計: ~/companion/workspace/redesign/remote-design.md §4(F-2)、§7(RA-4)。
- text/speaker は **argv でのみ** 渡し、環境変数には一切流さない(env injection 面を塞ぐ)。
- subprocess には音声/ランタイムに必要な key のみ os.environ から透過した固定 env を渡し、
  サーバ自身の環境を say.sh に丸ごと継がせない。say.sh 自身の `source .env` は say.sh の責務。
- say.sh の exit code(0/1/2/3/4/5)をそのまま返す。判定は1回(リトライ・stderr 分岐なし)。
- 副作用(N-1): say.sh は失敗時に voice/.state と companion-bot socket へ [voice]FAIL を出す。
  つまり /api/say の失敗は Discord 通知に波及する(設計どおりの既知副作用)。
"""
import os
import subprocess

SAY_SH = os.environ.get(
    "REMOTE_SAY_SH",
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "voice", "scripts", "say.sh"
    ),
)
# 音声再生/ランタイムに要る key のみ透過。user 入力(text)は argv のみで env には流さない。
_ENV_KEYS = (
    "HOME", "PATH", "XDG_RUNTIME_DIR", "DISPLAY",
    "PULSE_SERVER", "PULSE_RUNTIME_PATH", "DBUS_SESSION_BUS_ADDRESS",
    "XDG_DATA_DIRS", "LANG",  # LANG は合成/ロケール依存のため透過(status.py の LC_ALL=C 固定とは逆方針)
)
TIMEOUT_SEC = 30


def _env():
    env = {k: os.environ[k] for k in _ENV_KEYS if k in os.environ}
    env.setdefault("PATH", "/usr/bin:/bin:/usr/local/bin")
    return env


def say(text, speaker=None):
    """say.sh を argv 直叩き。exit code を返す。起動不能/timeout は None。"""
    argv = [SAY_SH, text] if speaker is None else [SAY_SH, text, str(speaker)]
    try:
        p = subprocess.run(
            argv, env=_env(), capture_output=True, text=True, timeout=TIMEOUT_SEC
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return p.returncode
