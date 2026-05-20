#!/usr/bin/env python3
"""companion-remote F-video URL allowlist — 唯一の外向き境界(絶対死守)。

設計: ~/companion/workspace/redesign/video-design.md §4.1。
課金ゼロゆえ budget guard backstop が効かない → allowlist が唯一の門。

これは bot.py `_normalize_play_url` の **ミラー複製**(同期コメント)。
bot/remote は別 repo ゆえ物理共有は YAGNI 超過のため、canonical 攻撃ベクタを
video-design.md §4.1 に1箇所定義し、両 repo の test が mirror して drift を検出する。

--- 同期元 (mirror source) ---
companion/bot/bot.py `_normalize_play_url` / `PLAY_ALLOWED_HOSTS`
ロジック・allowlist を変えたら両 repo の test(canonical ベクタ)を必ず再走させること。

canonical 攻撃ベクタ(video-design §4.1):
- 拒否: userinfo 詐称(evil@youtube.com / youtube.com@evil.com) / 空白・制御文字 /
        file://・ftp:// 等 http(s) 以外 / 169.254.169.254 等 SSRF 起点 /
        suffix 偽装(youtube.com.evil.com) / 非 allowlist host(notyoutube.com)
- 受理: www.youtube.com/watch / youtu.be/<id> / music.youtube.com / m.youtube.com /
        www.youtube.com/live/<id>  ← hostname 照合のみ、path で分岐しない(攻撃面を増やさない)
"""
from urllib.parse import urlparse

ALLOWED_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
})


def normalize(url):
    """allowlist を通れば正規化済み URL、弾けば None。bot.py のミラー(判定は1回で確定)。"""
    if not isinstance(url, str):
        return None
    # 空白・制御文字(URL splitting / ヘッダ注入面)を先頭で弾く。
    if any(ch.isspace() or ord(ch) < 0x20 for ch in url):
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    # `https://evil@youtube.com/...` / `youtube.com@evil.com` の userinfo 詐称形を弾く。
    if parsed.username is not None or parsed.password is not None:
        return None
    # hostname 照合のみ(path で分岐しない = /live/<id> も watch も同じ門を通す)。
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        return None
    return parsed.geturl()
