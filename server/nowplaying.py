"""NowPlaying TV 画面の Firefox ライフサイクル管理。

HDMI-1 に NowPlaying HTML を kiosk 表示する Firefox プロセスの起動・停止。
ユーザーの通常 Firefox と分離するため専用 profile を使う。
"""
import os
import subprocess
import threading

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".state")
PROFILE_DIR = os.path.join(STATE_DIR, "np-profile")
PID_FILE = os.path.join(STATE_DIR, "np-firefox.pid")

_proc = None
_lock = threading.Lock()


def show(port):
    global _proc
    with _lock:
        if _proc and _proc.poll() is None:
            return
        os.makedirs(PROFILE_DIR, exist_ok=True)
        prefs_path = os.path.join(PROFILE_DIR, "user.js")
        if not os.path.exists(prefs_path):
            with open(prefs_path, "w") as f:
                f.write('user_pref("datareporting.policy.dataSubmissionEnabled", false);\n')
                f.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')
                f.write('user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\n')
                f.write('user_pref("browser.aboutConfig.showWarning", false);\n')
                f.write('user_pref("browser.rights.3.shown", true);\n')
                f.write('user_pref("browser.startup.homepage_override.mstone", "ignore");\n')
        env = dict(os.environ)
        env["DISPLAY"] = ":0"
        url = "http://127.0.0.1:{}/nowplaying.html".format(port)
        _proc = subprocess.Popen(
            ["firefox", "--new-instance", "--profile", PROFILE_DIR, "--kiosk", url],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            with open(PID_FILE, "w") as f:
                f.write(str(_proc.pid))
        except OSError:
            pass
        t = threading.Thread(target=_position_window, daemon=True)
        t.start()


def _position_window():
    import time
    for _ in range(30):
        time.sleep(0.5)
        try:
            result = subprocess.run(
                ["wmctrl", "-l"], capture_output=True, text=True, timeout=3,
            )
            for line in result.stdout.splitlines():
                if "NowPlaying" in line:
                    parts = line.split(None, 1)
                    wid = parts[0] if parts else None
                    if wid:
                        # --kiosk は起動時点でフルスクリーンになっており、Marco は
                        # フルスクリーンウィンドウへの移動要求を無視する。
                        # 一旦解除してから HDMI-1 (+0+0) へ移動し、再フルスクリーン化する。
                        subprocess.run(["wmctrl", "-i", "-r", wid, "-b", "remove,fullscreen"], timeout=3)
                        time.sleep(0.3)
                        subprocess.run(["wmctrl", "-i", "-r", wid, "-e", "0,0,0,1920,1080"], timeout=3)
                        time.sleep(0.3)
                        subprocess.run(["wmctrl", "-i", "-r", wid, "-b", "add,fullscreen"], timeout=3)
                        return
        except (subprocess.TimeoutExpired, OSError):
            continue


def hide():
    global _proc
    with _lock:
        if _proc and _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _proc.kill()
                _proc.wait(timeout=3)
        _proc = None
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass


def is_active():
    return _proc is not None and _proc.poll() is None


def cleanup_stale():
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, 15)
    except (OSError, ValueError):
        pass
    try:
        os.unlink(PID_FILE)
    except OSError:
        pass
