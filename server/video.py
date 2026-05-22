#!/usr/bin/env python3
"""companion-remote F-video — 常駐 mpv の IPC クライアント(verb whitelist)。

設計: ~/companion/workspace/redesign/video-design.md §3.4 / §6(契約2,3) / §7(live)。

設計契約(破ると壊れる一線):
- **固定テンプレートのみ**(loadfile replace / set pause / stop / seek abs / set volume /
  get_property 固定リスト)を `json.dumps` 構築で mpv に送る。
  `run`/`load-script`/任意 `set_property` を **HTTP 層から一切受けない**(RCE 面の一線)。
- socket は同一権限(miho-uid)からのみ到達(0o600 + /run/user/1000 が 0700/miho)。
  HTTP token は RCE verb を gate しない = fs パーミッションが gate する。
- **PulseAudio sink 不可触**(契約1): 音量は mpv `volume` プロパティのみ。pactl/sink を触らない。
- 成否判定は1回で確定(リトライ・stderr 文言分岐をしない)。接続不能/timeout は None。
- ytdl_hook 方式ゆえ server は署名付き stream URL(googlevideo 時限 token)を見ない(§4.4 ログ安全)。
"""
import json
import os
import socket

SOCKET_PATH = os.environ.get(
    "REMOTE_VIDEO_SOCKET",
    os.path.join(
        os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000"), "companion-video-mpv.sock"
    ),
)
CONNECT_TIMEOUT = 2.0  # mpv unit 停止時に即 503 へ落とす
IO_TIMEOUT = 5.0       # loadfile/get_property は即応(yt-dlp 解決は mpv 内で非同期)

# state() で読む property の固定リスト(verb whitelist の read 側)。
_STATE_PROPS = (
    "idle-active", "core-idle", "time-pos", "duration", "pause", "media-title", "seekable",
)


def _send(commands):
    """commands=[(request_id, [verb, ...]), ...] を1接続で送り {request_id: 応答dict} を返す。

    接続/通信失敗は None(判定1回)。mpv の非請求 event 行(request_id 無)は読み飛ばす。
    """
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.settimeout(CONNECT_TIMEOUT)
        s.connect(SOCKET_PATH)
    except OSError:
        s.close()
        return None
    f = None
    try:
        s.settimeout(IO_TIMEOUT)
        payload = b"".join(
            json.dumps({"command": verb, "request_id": rid}).encode("utf-8") + b"\n"
            for rid, verb in commands
        )
        s.sendall(payload)
        wanted = {rid for rid, _ in commands}
        results = {}
        f = s.makefile("rb")
        while wanted:
            line = f.readline()
            if not line:  # 切断
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            rid = msg.get("request_id")
            if rid in wanted:
                results[rid] = msg
                wanted.discard(rid)
        return results
    except OSError:
        return None
    finally:
        if f is not None:
            f.close()
        s.close()


def _command(verb):
    """単一 verb を送って mpv 応答 dict を返す。接続不能は None。"""
    res = _send([(1, verb)])
    if res is None:
        return None
    return res.get(1)


# --- HTTP 層から呼ぶ固定テンプレート(verb whitelist) ---

def play(url):
    """loadfile <url> replace。url は urlguard.normalize 済みのみが届く前提。"""
    return _command(["loadfile", url, "replace"])


def pause():
    return _command(["set_property", "pause", True])


def resume():
    return _command(["set_property", "pause", False])


def stop():
    return _command(["stop"])


def seek(amount, relative=False):
    """シーク(VOD のみ。live のシーク無効化は PWA 側 is_live で gate)。

    relative=False: 絶対(秒)。relative=True: 相対(±秒, RV-7 ±N スキップ)。
    どちらも verb whitelist「seek abs+rel」内(video-design.md §3.4)で RCE 面を増やさない。
    範囲外は mpv が clamp する(成否1回確定の原則を崩さない)。
    """
    return _command(["seek", amount, "relative" if relative else "absolute"])


def set_volume(v):
    """mpv volume プロパティのみ(PulseAudio sink は不可触 = 契約1)。"""
    return _command(["set_property", "volume", v])


def _derive(v):
    """get_property 群から PWA 向け state を導出。phase は core-idle/再生開始で1回判定(§7)。

    - idle-active=True → idle(ファイル無し)
    - time-pos が数値 → 再生開始済 → pause で playing/paused 分岐
    - どちらでもない(loadfile 後 time-pos=None)→ resolving(yt-dlp 解決中, 40〜70s)
    is_live: 再生中に **seek 不可** なら live。当初の duration=None 前提(§7 LIVE-1)は
    V-A3 実測(2026-05-20)で外れた — YouTube live は DVR バッファ長を有限 duration で返す
    (46→104s と伸びる)。実測では live=seekable False / partially-seekable False、
    VOD=seekable True。UX が gate したいのは「seek できるか」そのものゆえ seekable を直接
    主シグナルにする(設計「補助で seekable」を1回引き直し。条件を積む2周目を打たない)。
    """
    idle = v.get("idle-active")
    time_pos = v.get("time-pos")
    seekable = bool(v.get("seekable"))
    pause = bool(v.get("pause"))
    if idle:
        phase, is_live = "idle", False
    elif time_pos is not None:
        phase = "paused" if pause else "playing"
        is_live = not seekable
    else:
        phase, is_live = "resolving", False
    return {
        "phase": phase,
        "title": v.get("media-title"),
        "pos": time_pos,
        "duration": v.get("duration"),
        "pause": pause,
        "is_live": is_live,
        "seekable": seekable,
    }


def state():
    """固定 property リストを1接続で集約し PWA 向け state dict を返す。接続不能は None。"""
    cmds = [(i + 1, ["get_property", p]) for i, p in enumerate(_STATE_PROPS)]
    res = _send(cmds)
    if res is None:
        return None
    vals = {}
    for i, p in enumerate(_STATE_PROPS):
        msg = res.get(i + 1) or {}
        # property unavailable(live の duration 等)は None に寄せる(stderr 分岐しない)。
        vals[p] = msg.get("data") if msg.get("error") == "success" else None
    return _derive(vals)
