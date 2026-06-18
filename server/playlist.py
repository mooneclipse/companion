#!/usr/bin/env python3
"""companion-remote RV-12 プレイリスト展開 — flat-playlist メタ取得 (再生キュー供給)。

ユーザーが貼った YouTube/ニコニコ等のプレイリスト URL を yt-dlp --flat-playlist -J で
展開し、各動画の (url, title) 一覧を返す。再生制御 state は mpv が所有 (video.py の
playlist verb)、本 module は「投入時に 1 回 flat 展開してメタを供給する」だけ
(video-design §1 server stateless を崩さない)。title はレスポンスで PWA へ渡し PWA が保持。

dlqueue.py の yt-dlp 直叩きと同型 (env 隔離 / start_new_session / killpg / timeout / -4)。
yt-dlp は flat メタのみ取得し署名付き stream URL を見ない (video-design §3.3 の
「server は stream URL を見ない」に抵触しない)。

設計契約 (plans/RV-12):
- C3: 先頭 LIMIT 件で 1 回確定 (YouTube Mix `list=RD...` の疑似無限対策)。数値は刻まない。
- C4: 各 entry url を urlguard.normalize に通し、None は 1 件だけ skip (展開全体を fail させない)。
- 成否は rc + JSON の 1 回確定 (stderr 文言分岐なし)。展開 Lock で二重投入を単一化。
"""
import json
import os
import re
import signal
import subprocess
import threading

import urlguard

# yt-dlp は dlqueue.py / mpv unit と同一実体・同一 known-good 版を固定。
YTDLP = os.environ.get("REMOTE_YTDLP", "/home/miho/bin/yt-dlp")
LIMIT = 100              # C3: 先頭 N 件 cap (1 回確定、刻まない)。
EXPAND_TIMEOUT = 60      # 展開の backstop。超過は失敗 1 回確定 (killpg)。
TITLE_MAX = 200          # title は外部サイト制御の文字列 — cap (dlqueue.sanitize_title 同型)。

_expand_lock = threading.Lock()  # 二重投入の単一化 (展開 subprocess を 1 本に保つ)。


class PlaylistError(Exception):
    """展開失敗 (rc≠0 / timeout / JSON 壊れ / entries 不正)。API は 400/502 に写像。"""


def _env():
    """yt-dlp 用の固定最小 env (dlqueue._env と同型、PROXY 系・user shell env 非継承)。"""
    env = {k: os.environ[k] for k in ("HOME", "PATH") if k in os.environ}
    env.setdefault("PATH", "/home/miho/bin:/usr/bin:/bin")
    return env


def _sanitize_title(s):
    """制御文字 strip + 200 字 cap。空は None (PWA 側で filename フォールバック)。"""
    if not isinstance(s, str):
        return None
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s).strip()
    return s[:TITLE_MAX] or None


def parse_entries(data, limit=LIMIT):
    """flat-playlist -J の JSON dict から正規化済み [{url, title}] と生件数を返す (純関数)。

    - playlist: data["entries"] の各項目。single (entries 無し) は data 1 件として扱う
      (list= 無しが play_playlist に来た等の防御。通常は PWA の list= 判定で play へ流れる)。
    - 各 url は urlguard.normalize 通過分のみ (C4: reject は skip、展開全体を fail させない)。
      flat-playlist の url フィールド (動画ページ URL)、無ければ webpage_url を見る。
    """
    if not isinstance(data, dict):
        raise PlaylistError("invalid json")
    raw = data.get("entries")
    if raw is None:
        raw = [data]            # 単一動画
    if not isinstance(raw, list):
        raise PlaylistError("invalid entries")
    total = len(raw)
    entries = []
    for e in raw[:limit]:
        if not isinstance(e, dict):
            continue
        norm = urlguard.normalize(e.get("url") or e.get("webpage_url"))
        if norm is None:
            continue            # C4: allowlist 外 / 形式不正の 1 件を skip
        entries.append({"url": norm, "title": _sanitize_title(e.get("title"))})
    return {"entries": entries, "total": total}


def expand(url, limit=LIMIT):
    """url を flat 展開して {entries:[{url,title}], total, loaded} を返す。失敗は PlaylistError。

    url は呼び出し側 (app.py) で urlguard.normalize 済みが前提 (門は urlguard)。
    total = flat が返した生件数 (cap 前)、loaded = allowlist 通過してキューに載る件数。
    """
    argv = [
        YTDLP, "--ignore-config", "--flat-playlist", "-J",
        "-I", "1:%d" % limit, "--no-warnings", "--no-progress",
        # -4 (IPv4 強制): この網は IPv6 が 100% loss (RV-8 実測)。dlqueue の -4 と同根拠。
        "-4",
        url,
    ]
    # start_new_session でプロセスグループを分離し、timeout 時は killpg で子ごと止める。
    with _expand_lock:
        try:
            p = subprocess.Popen(argv, env=_env(), stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True,
                                 start_new_session=True)
        except OSError:
            raise PlaylistError("yt-dlp not executable")
        try:
            out, _err = p.communicate(timeout=EXPAND_TIMEOUT)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
            p.communicate()
            raise PlaylistError("expand timeout")
    # 成否は rc + JSON parse の 1 回確定 (stderr 文言で分岐しない、video-design §5.4)。
    if p.returncode != 0:
        raise PlaylistError("yt-dlp failed")
    try:
        data = json.loads(out)
    except ValueError:
        raise PlaylistError("invalid json")
    result = parse_entries(data, limit)
    result["loaded"] = len(result["entries"])
    return result
