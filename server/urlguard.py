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
- 拒否: userinfo 詐称(evil@youtube.com / youtube.com@evil.com / evil@nicovideo.jp /
        evil@tver.jp) / 空白・制御文字 / file://・ftp:// 等 http(s) 以外 /
        169.254.169.254 等 SSRF 起点 / suffix 偽装(youtube.com.evil.com /
        nicovideo.jp.evil.com / nico.ms.evil.com / tver.jp.evil.com) /
        非 allowlist host(notyoutube.com) / 非 allowlist サブドメイン(embed.nicovideo.jp)
- 受理: www.youtube.com/watch / youtu.be/<id> / music.youtube.com / m.youtube.com /
        www.youtube.com/live/<id> / (www|sp).nicovideo.jp/watch / nicovideo.jp/watch /
        nico.ms/<id> / tver.jp/episodes/<id> / www.tver.jp/episodes/<id>
        ← hostname 照合のみ、path で分岐しない(攻撃面を増やさない)
- DL の門(normalize_dl): 再生 allowlist のうち STREAM_ONLY_HOSTS(TVer)を除外。
  TVer は期限付き見逃し配信でローカル保存は期限・権利の両面を迂回するため、
  事前 DL(RV-10)には流さない(RV-11 判断 2026-06-12)。
"""
from urllib.parse import urlparse

ALLOWED_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    # ニコニコ動画 (2026-06-11 追加。yt-dlp 2026.03.17 NiconicoIE 実弾検証済)。
    # embed.nicovideo.jp はユーザーが貼る共有 URL でないため除外(攻撃面を増やさない)。
    "nicovideo.jp",
    "www.nicovideo.jp",
    "sp.nicovideo.jp",
    "nico.ms",
    # TVer (2026-06-12 追加 = RV-11。yt-dlp 2026.03.17 TVerIE で実エピソード 3 本
    # [3 系列局] を -J 解決検証済: DRM 0 / HLS m3u8_native / 無ログイン)。
    "tver.jp",
    "www.tver.jp",
})

# 再生(ストリーミング)のみ許可し事前 DL(/api/dl)には流さない host。
# TVer は期限付き見逃し配信のためローカル保存しない(RV-11 判断 2026-06-12)。
STREAM_ONLY_HOSTS = frozenset({
    "tver.jp",
    "www.tver.jp",
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


def normalize_dl(url):
    """事前 DL(/api/dl)の門。再生 allowlist から STREAM_ONLY_HOSTS を除外して判定。"""
    ok = normalize(url)
    if ok is None:
        return None
    if (urlparse(ok).hostname or "").lower() in STREAM_ONLY_HOSTS:
        return None
    return ok
