"""screensaver.service のオン/オフ制御。"""
import subprocess


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
        subprocess.run(
            ["systemctl", "--user", "start", "screensaver.service"],
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def stop():
    try:
        subprocess.run(
            ["systemctl", "--user", "stop", "screensaver.service"],
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        pass
