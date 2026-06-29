#!/usr/bin/env python3
"""companion-remote F-video — 常駐 mpv の IPC クライアント(verb whitelist)。

設計: ~/companion/workspace/redesign/video-design.md §3.4 / §6(契約2,3) / §7(live)。

設計契約(破ると壊れる一線):
- **固定テンプレートのみ**(loadfile replace / loadfile append / set pause / stop /
  seek abs / set volume / playlist-next / playlist-prev / set playlist-pos /
  get_property 固定リスト)を `json.dumps` 構築で mpv に送る。
  `run`/`load-script`/任意 `set_property` を **HTTP 層から一切受けない**(RCE 面の一線)。
  playlist verb (RV-12) は再生キューの index 操作のみで、外部由来文字列を property に
  流さない (title は PWA 保持 = 契約 C2、force-media-title は使わない)。
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
# playlist-pos / playlist-count は RV-12 再生キュー (PWA がキュー UI と現在曲を描く)。
_STATE_PROPS = (
    "idle-active", "core-idle", "time-pos", "duration", "pause", "media-title", "seekable",
    "playlist-pos", "playlist-count",
    "path", "metadata/by-key/artist", "metadata/by-key/uploader",
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

def play(url, music=False):
    """loadfile <url> replace pause=no。url は urlguard.normalize 済みのみが届く前提。

    pause は mpv の global property で loadfile をまたいで保持されるため、前回 pause の
    まま閉じると次の再生も pause で始まる。per-file option `pause=no` で継承を断ち、
    再生開始は必ず再生状態にする(mpv 0.34.1 で構文確認済)。
    music=True のとき vid=no を per-file option で付与(映像出力抑止、NowPlaying TV 用)。
    """
    opts = "pause=no,vid=no" if music else "pause=no"
    return _command(["loadfile", url, "replace", opts])


def play_playlist_load(urls, music=False):
    """urls を mpv 内部 playlist に積む(RV-12)。先頭=loadfile replace(即再生)/残り=append。

    urls は app.py で playlist.expand → urlguard.normalize 済みのみが届く前提(非空)。
    eof 自動 advance は mpv keep-open=no がネイティブに行う(監視スレッド不要 = stateless 維持)。
    投入後 playlist の構成を server から変更しない(契約 C1: index と PWA 保持 title が
    1:1 固定。次/前/ジャンプは queue_next/prev/jump のみ)。返り値は先頭 replace の応答
    (再生開始の成否を _video_result が写像)。append は即応(yt-dlp 解決は再生時まで遅延)。

    **全エントリに per-file `pause=no` を付ける**(先頭の replace だけでなく append も):
    実 vo + ytdl 環境では、per-file pause 指定の無いエントリが current になると paused で
    読み込まれる(本番 TV 実測 2026-06-18: pause=no を持つ entry は解決中も再生継続、持たない
    entry は次へ/自動 advance で pause=true)。pause=no が無いと **eof 自動 advance が各曲で
    一時停止して止まる = 中核機能 (1 曲終わったら自動で次へ) が壊れる**。headless (vo=null)
    では再現しないため headless 検証ではなく本番 TV 検証で確定。pause はグローバル property
    だが per-file 指定はそのエントリが current の間だけ適用され、指定の無いエントリへ移ると
    その既定に戻るため、全エントリに明示する(reactive に queue_next 後へ set pause を足す案は
    自動 advance を救えず 2 周目の温床ゆえ採らない)。
    music=True のとき vid=no を per-file option で全エントリに付与(NowPlaying TV 用)。
    """
    if not urls:
        return None
    base_opts = "pause=no,vid=no" if music else "pause=no"
    cmds = [(1, ["loadfile", urls[0], "replace", base_opts])]
    for i, u in enumerate(urls[1:], start=2):
        cmds.append((i, ["loadfile", u, "append", base_opts]))
    res = _send(cmds)
    if res is None:
        return None
    return res.get(1)


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


def queue_next():
    """再生キューを次の曲へ(RV-12)。末尾で打つと mpv は idle に戻る(成否1回確定)。"""
    return _command(["playlist-next"])


def queue_prev():
    """再生キューを前の曲へ(RV-12)。"""
    return _command(["playlist-prev"])


def queue_jump(pos):
    """playlist-pos へ絶対ジャンプ(RV-12、index)。範囲外は mpv が弾く(成否1回確定)。

    pos は app.py で int 検証済み。固定テンプレート(set playlist-pos)で外部文字列を
    property に流さない(verb whitelist の一線、契約 C2/C3)。
    """
    return _command(["set_property", "playlist-pos", pos])


def _derive(v):
    """get_property 群から PWA 向け state を導出。phase は core-idle/再生開始で1回判定(§7)。

    - idle-active=True → idle(ファイル無し)
    - time-pos が数値 → 再生開始済 → pause で playing/paused 分岐
    - どちらでもない(loadfile 後 time-pos=None)→ resolving(yt-dlp 解決中, 通常10s前後)
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
        # RV-12 再生キュー: PWA が現在曲(pos)とキュー長(count)を描く。単一再生は count=1、
        # idle は count=0/pos=None(unavailable→None)。title 一覧は PWA 保持(契約 C2)。
        "playlist_pos": v.get("playlist-pos"),
        "playlist_count": v.get("playlist-count"),
        "path": v.get("path"),
        "artist": v.get("metadata/by-key/artist"),
        "uploader": v.get("metadata/by-key/uploader"),
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
