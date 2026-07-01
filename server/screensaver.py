"""screensaver.service のオン/オフ制御。"""
import subprocess
import time


def is_active():
    try:
        r = subprocess.run(
            ["systemctl", "--user", "is-active", "--quiet", "screensaver.service"],
            timeout=5,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def start():
    try:
        r = subprocess.run(
            ["systemctl", "--user", "start", "screensaver.service"],
            timeout=10,
            check=False,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def stop():
    try:
        r = subprocess.run(
            ["systemctl", "--user", "stop", "screensaver.service"],
            timeout=10,
            check=False,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
