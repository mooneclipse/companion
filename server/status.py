#!/usr/bin/env python3
"""companion-remote F-3 OS status — df/free/sensors/uptime を read-only 直叩きして JSON 化。

設計: ~/companion/workspace/redesign/remote-design.md §4(F-3 OS)、§7(RA-3)。
ledger/session 由来情報は含めない(H-2、集計は v1-β で bot socket 経由)。
各コマンドは固定 argv + 最小 env で1回だけ実行し、失敗時は該当フィールドを null にする
(リトライ・stderr 文言分岐をしない、CLAUDE.md「成否判定は1回で確定」)。
出力フォーマット前提は maintenance/scripts/notify-system-report.sh と同じ。
disk/mem は `-h` の単位付き文字列(例 "1.7Gi")をそのまま透過する。クライアント表示用で
あり集計用の数値ではない(v1-β で集計が要るなら数値化を別途検討)。
"""
import os
import subprocess

# user 入力は混ざらない(固定 argv のみ)が、PATH/locale を固定して環境依存を排除。
_ENV = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"}


def _run(argv, timeout=3):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=_ENV)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout if p.returncode == 0 else None


def _disk():
    out = _run(["df", "-h", "/"])
    if not out:
        return None
    lines = out.splitlines()
    if len(lines) < 2:
        return None
    f = lines[1].split()
    if len(f) < 5:
        return None
    return {"used": f[2], "total": f[1], "pct": f[4]}


def _mem():
    """free -h から Mem/Swap を取り出す。{'mem': ..., 'swap': ...}。"""
    out = _run(["free", "-h"])
    if not out:
        return {}
    res = {}
    for line in out.splitlines():
        f = line.split()
        if line.startswith("Mem:") and len(f) >= 7:
            res["mem"] = {"used": f[2], "total": f[1], "available": f[6]}
        elif line.startswith("Swap:") and len(f) >= 3:
            res["swap"] = {"used": f[2], "total": f[1]}
    return res


def _cpu_temp():
    """sensors の 'Package id 0:' 行から ℃ を float で。未導入/不在は None。"""
    out = _run(["sensors"])
    if not out:
        return None
    for line in out.splitlines():
        if line.startswith("Package id 0:"):
            toks = line.split()
            if len(toks) >= 4:
                num = "".join(c for c in toks[3] if c.isdigit() or c == ".")
                try:
                    return float(num)
                except ValueError:
                    return None
    return None


def _uptime():
    out = _run(["uptime", "-p"])
    return out.strip() if out else None


def _load():
    try:
        return list(os.getloadavg())
    except OSError:
        return None


def collect():
    m = _mem()
    return {
        "disk": _disk(),
        "mem": m.get("mem"),
        "swap": m.get("swap"),
        "cpu_temp_c": _cpu_temp(),
        "uptime": _uptime(),
        "load": _load(),
    }
