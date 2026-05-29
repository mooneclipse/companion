#!/usr/bin/env python3
"""dashboard helper — 127.0.0.1:<PORT> で GET /np / GET /news / GET /quotes を提供。

- /np: mpv の IPC socket（$XDG_RUNTIME_DIR/dashboard-mpv.sock）から再生中の曲名・
  アーティストを読み、JSON で返す（Access-Control-Allow-Origin: *、ダッシュボードは
  file:// から fetch する）。
- /news: NHK NEWS WEB RSS (主要ニュース) を proxy 取得し、見出しを 1〜3 件 JSON で返す。
  file:// origin から外部 RSS への直 fetch は CORS で弾かれるため helper 経由（既存
  /np と同じ pattern、STATUS.md 「天気」B5 contingency と同方針）。**現在は debug 用途
  に残置**: web/app.js / bin/dashboard-notify-ren-quotes.py は両者とも /quotes を使う。
- /quotes: 「ren セリフ集」の一日分（weather lines + fortune line + news lines）を
  まとめて JSON で返す。JST 当日の日付を key に同日 1 回だけ build → cache。同じ JSON
  を 1 日中返すので、bot 通知 (notify script) と dashboard ブラウザ (web/app.js) で
  完全一致が保証される（占い random seed / 天気 fetch 時点 / news fetch 時点のズレを
  helper 側で吸収）。

設計（~/companion/CLAUDE.md 準拠）:
- mpv 不在 / socket 無し / 接続拒否 / タイムアウト ＝「再生していない」正常状態 → {"playing": false} を 200 で返す。
  500 やリトライにしない。1 回の connect-or-empty で確定。
- /news も同じく fetch 失敗 / parse 失敗 = {"items": []} を 200 で返す。retry/backoff は無し
  （client 側で 1 時間ごとに再ポーリングするのみ）。
- /news レスポンスは helper メモリ内で TTL=30 分キャッシュ（NHK RSS への過剰アクセス回避、
  client が多重に叩いても外部 fetch は最大 30 分に 1 回）。
- /quotes は JST 当日の日付を key にした in-memory cache。同日内は同じ JSON を返す。
  日付ロールオーバーで cache を破棄して次の呼び出しで再 build。failure は静かに空配列で
  返す（retry なし、既存 /np / /news と同方針）。
- 1 クライアント・低頻度ポーリング（~2.5s）前提。リクエスト毎に接続して即閉じる。
"""
import datetime
import html
import json
import os
import random
import re
import socket
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.etree import ElementTree as ET

PORT = 47823  # web/dashboard-config.js の nowPlaying.port と一致させること
SOCK_PATH = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR") or ("/run/user/%d" % os.getuid()),
    "dashboard-mpv.sock",
)
DASH_DIR = os.path.expanduser("~/companion/dashboard")
CONFIG_JS = os.path.join(DASH_DIR, "web", "dashboard-config.js")


def _mpv_get(prop):
    """mpv IPC で 1 プロパティ取得。失敗は None。"""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.8)
        s.connect(SOCK_PATH)
        s.sendall(json.dumps({"command": ["get_property", prop], "request_id": 1}).encode() + b"\n")
        buf = b""
        # mpv は非同期イベントも流すので request_id 一致の行を探す
        for _ in range(50):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.decode("utf-8", "replace"))
                except ValueError:
                    continue
                if msg.get("request_id") == 1:
                    s.close()
                    if msg.get("error") == "success":
                        return msg.get("data")
                    return None
        s.close()
    except OSError:
        return None
    return None


def now_playing():
    title = _mpv_get("media-title")
    if not title:
        return {"playing": False}
    artist = None
    meta = _mpv_get("metadata")
    if isinstance(meta, dict):
        for k in ("artist", "ARTIST", "Artist", "album_artist", "ALBUM_ARTIST"):
            if meta.get(k):
                artist = meta[k]
                break
    return {"playing": True, "title": title, "artist": artist}


# ─── /news: NHK NEWS WEB RSS proxy ─────────────────────────────────
# 取得元: NHK NEWS WEB 主要ニュース RSS。選定理由: 認証不要・日本語主要ニュースで
# 安定運用、公開 RSS で API key 不要、CORS proxy 1 段のみで完結（STATUS.md 参照）。
NEWS_RSS_URL = "https://www.nhk.or.jp/rss/news/cat0.xml"
NEWS_MAX_ITEMS = 3
NEWS_FETCH_TIMEOUT = 3.0
NEWS_CACHE_TTL = 1800  # 30 分（client 側 1 時間ポーリングと合わせ過剰 fetch を防ぐ）

_news_cache = {"ts": 0.0, "items": []}


def _fetch_news_rss():
    """NHK RSS を fetch → title を 1〜3 件抽出。失敗は []。"""
    try:
        req = urllib.request.Request(
            NEWS_RSS_URL,
            headers={"User-Agent": "companion-dashboard/1.0 (+local kiosk)"},
        )
        with urllib.request.urlopen(req, timeout=NEWS_FETCH_TIMEOUT) as resp:
            raw = resp.read(1024 * 1024)  # 1MB 上限（配信元事故対策）
    except (OSError, ValueError):
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    items = []
    # RSS 2.0: rss > channel > item > title
    for item in root.iter("item"):
        title_el = item.find("title")
        if title_el is None or not title_el.text:
            continue
        text = re.sub(r"\s+", " ", title_el.text).strip()
        if text:
            items.append(text)
        if len(items) >= NEWS_MAX_ITEMS:
            break
    return items


def news_items():
    """TTL キャッシュ越しに見出しを返す。fetch 失敗時は空配列。"""
    now = time.time()
    if now - _news_cache["ts"] < NEWS_CACHE_TTL and _news_cache["items"]:
        return _news_cache["items"]
    items = _fetch_news_rss()
    if items:
        _news_cache["ts"] = now
        _news_cache["items"] = items
        return items
    # 失敗時は前回成功値があれば（古くても 1 時間程度まで）流用、無ければ空。
    # retry/backoff はしない（次の client ポーリングで再試行）。
    if _news_cache["items"] and now - _news_cache["ts"] < 3600:
        return _news_cache["items"]
    return []


# ─── Anthropic 公式 news の「新着リリース」見出し ───────────────────────
# 取得元: https://www.anthropic.com/news（公式 RSS / Atom / sitemap いずれも無いので
# HTML をパースする）。改版に強い要素のみに依存する設計:
#   - href="/news/<slug>" … ルーティング由来。記事の一意キー（CSS module ハッシュに非依存）。
#   - 各 <a> ブロック内のテキストノードに [日付, カテゴリ, タイトル] が並ぶ。既知カテゴリ語
#     (Product / Announcements / ...) を 1 つ拾って「製品・モデル発表」を判定する。
#   - タイトルは記事ページの <meta property="og:title">（SEO 必須で最も安定）から取得。
# Cloudflare がブラウザ以外の UA を 403 で弾く（default urllib UA = 403 を実測。
# memory: reference_mintupgrade_cloudflare と同系）ため、ブラウザ UA を明示する。
#
# 「製品・モデル発表のみ」要件 → カテゴリ Product だけ通す。資金調達/採用 (Announcements)・
# オフィス開設・ポリシー等は弾く。launch が Product 以外のカテゴリで出た場合は拾えないので、
# その時は ANTHROPIC_CATEGORIES を広げる（経緯は docs/STATUS.md に記録）。
ANTHROPIC_NEWS_URL = "https://www.anthropic.com/news"
ANTHROPIC_ARTICLE_BASE = "https://www.anthropic.com/news/"
# Cloudflare 回避用のブラウザ UA（companion-dashboard UA だと 403）。
ANTHROPIC_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
ANTHROPIC_CATEGORIES = {"Product"}  # 通すカテゴリ。広げる時はここに追加（STATUS 参照）。
# index ブロックから拾う既知カテゴリ語（タイトルとカテゴリを区別するための語彙）。
ANTHROPIC_KNOWN_CATEGORIES = {
    "Product", "Announcements", "Policy", "Societal Impacts",
    "Interpretability", "Research", "Company", "Alignment", "Education",
}
ANTHROPIC_MAX_TITLES = 3       # 1 朝に出す上限（通常 0〜1 件。多発時のフラッド防止）。
ANTHROPIC_FETCH_TIMEOUT = 3.0  # index / 記事 1 本あたり。/quotes 全体の予算は notify 側参照。
ANTHROPIC_SEEN_CAP = 100       # state に保持する既出 slug 数（index 表示は ~11 件なので十分）。
ANTHROPIC_STATE_FILE = os.path.join(DASH_DIR, ".state", "anthropic-news-state.json")


def _anthropic_fetch_html(url):
    """ブラウザ UA で 1 URL を取得して本文を返す。失敗は ValueError/OSError を投げる。"""
    req = urllib.request.Request(url, headers={"User-Agent": ANTHROPIC_UA})
    with urllib.request.urlopen(req, timeout=ANTHROPIC_FETCH_TIMEOUT) as resp:
        raw = resp.read(2 * 1024 * 1024)  # 2MB 上限（配信元事故対策）
    return raw.decode("utf-8", "replace")


def _anthropic_index():
    """news index を fetch し [(slug, category), ...] を掲載順で返す。失敗時 []。
    同一 slug（featured と list の重複等）は最初の 1 件のみ採用。category は不明なら None。
    """
    try:
        page = _anthropic_fetch_html(ANTHROPIC_NEWS_URL)
    except (OSError, ValueError):
        return []
    out = []
    seen = set()
    # 記事リンクブロック <a href="/news/slug" ...> ... </a> を非貪欲で切り出す。
    for m in re.finditer(r'<a\s+href="/news/([a-z0-9-]+)"[^>]*>(.*?)</a>', page, re.DOTALL):
        slug = m.group(1)
        if slug in seen:
            continue
        seen.add(slug)
        category = None
        for t in re.findall(r'>([^<>]+)<', m.group(2)):
            t = html.unescape(t).strip()
            if t in ANTHROPIC_KNOWN_CATEGORIES:
                category = t
                break
        out.append((slug, category))
    return out


def _anthropic_title(slug):
    """記事ページの og:title を返す。取得 / 抽出失敗時 None。"""
    try:
        page = _anthropic_fetch_html(ANTHROPIC_ARTICLE_BASE + slug)
    except (OSError, ValueError):
        return None
    m = re.search(r'<meta\s+property="og:title"\s+content="([^"]*)"', page)
    if not m:
        return None
    title = html.unescape(m.group(1)).strip()
    return title or None


def _load_anthropic_state():
    try:
        with open(ANTHROPIC_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_anthropic_state(state):
    """atomic 書き込み（tmp + os.replace）。失敗は握り潰す（次回再試行、無音破綻させない）。"""
    try:
        os.makedirs(os.path.dirname(ANTHROPIC_STATE_FILE), exist_ok=True)
        tmp = ANTHROPIC_STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, ANTHROPIC_STATE_FILE)
    except OSError:
        pass


def _anthropic_new_titles(today_ymd):
    """JST 当日に「前回 build 以降 新規に出た Product カテゴリ記事」のタイトル一覧を返す。

    state を 1 回引いて確定する（CLAUDE.md「state を持つ側を引いて 1 回で決める」準拠）:
      - state.date が今日なら shown をそのまま返す（同日再 build / helper 再起動でも不変）。
      - 初回（seen 未保有）は現状の全 slug を seen に取り込むだけで何も出さない
        （初回デプロイ時に過去記事を一斉通知しないため）。
      - index fetch 失敗時は state を進めず [] を返す（次回起動で再試行。retry ループは作らない）。
    new 判定は slug 差分（日付パース・TZ に依存しない）。新着のうち Product のみ og:title を引く。
    """
    state = _load_anthropic_state()
    if state.get("date") == today_ymd and isinstance(state.get("shown"), list):
        return state["shown"]
    index = _anthropic_index()
    if not index:
        return []  # 取得失敗: state を進めない（既存 /np /news と同じ no-retry 方針）
    first_run = "seen" not in state
    seen = list(state.get("seen", []))
    seen_set = set(seen)
    titles = []
    if not first_run:
        for slug, category in index:
            if slug in seen_set or category not in ANTHROPIC_CATEGORIES:
                continue
            t = _anthropic_title(slug)
            if t:
                titles.append(t)
            if len(titles) >= ANTHROPIC_MAX_TITLES:
                break
    # 現状の全 slug を「評価済み」として seen に取り込む（カテゴリ問わず）。
    for slug, _ in index:
        if slug not in seen_set:
            seen.append(slug)
            seen_set.add(slug)
    # ThreadingHTTPServer で同日初回に複数リクエストが同時 build しても benign:
    # 両者とも同じ index を見て同じ titles / 同じ seen を算出し os.replace で後勝ち統合。
    # 各リクエストは自分の payload に同一 titles を得るので二重通知・重複行は起きない
    # （weather/news の既存 race 許容と同方針。lock は導入しない）。
    _save_anthropic_state({"date": today_ymd, "shown": titles, "seen": seen[-ANTHROPIC_SEEN_CAP:]})
    return titles


# ─── /quotes: 一日分の ren セリフ集を同日 cache で返す ──────────────────
# notify script (bin/dashboard-notify-ren-quotes.py) と web/app.js が両方 fetch する。
# JST 当日の日付を key にした in-memory cache で「同日同一 JSON」を保証する。
# 占い random seed / 天気 fetch 時点 / news fetch 時点のズレを helper 側で吸収。
#
# build 内訳:
#   weather:   Open-Meteo に直接 fetch。平日 3 行 (きょう / 朝 / 夜) / 土日 1 行 (きょう)
#   fortune:   日付 seed で random.Random deterministic 生成（双子座固定）
#   news:      news_items() 流用（NHK RSS + 30 分 TTL）
#   anthropic: anthropic.com/news の Product カテゴリ新着タイトル（_anthropic_new_titles）。
#              通常 0 件、新モデル/製品発表があった朝だけ 1〜数件。
#
# 失敗時は該当配列を空で返す（retry なし、既存 /np / /news と同方針）。

WEATHER_TIMEOUT = 4.0
USER_AGENT = "companion-dashboard/1.0 (+local kiosk)"

# 占い phrase pool（web/app.js / bin/dashboard-notify-ren-quotes.py の旧持ち分から
# helper に集約。重複管理を解消するため、移植後は notify / app.js 側の同名定数を撤去）
FORTUNE_LUCK = ["仕事", "勉強", "恋愛", "健康", "対人", "金銭", "創作", "趣味"]
FORTUNE_LEVEL = ["絶好調", "好調", "まずまず", "穏やか", "一息つくとよさそう"]
FORTUNE_COLOR = ["青", "緑", "黄", "橙", "赤", "紫", "白", "黒", "金", "銀", "桃", "水色"]
FORTUNE_TIP = [
    "小さな約束を守ると流れが整う",
    "深呼吸を 3 回するだけで視界が広がる",
    "誰かに一言「ありがとう」を伝えてみよう",
    "机の上を 5 分だけ片付けるといい",
    "迷ったら静かな方を選ぶと吉",
    "いつもより 5 分早く出ると拾い物がある",
    "無理せず休む勇気が今日の運を呼ぶ",
    "誰かの話を最後まで聞くと運が回る",
]

# 当日 cache。{"date": "YYYY-MM-DD", "payload": {...}} を保持。
_quotes_cache = {"date": None, "payload": None}


def _read_weather_config():
    """dashboard-config.js から lat / lon / tz を正規表現で抽出。
    失敗時は None（呼び出し側で weather 行を空にする）。中村区固定運用なので
    座標フォールバック（東京駅等）は意図的に持たない。
    """
    try:
        with open(CONFIG_JS, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    m_lat = re.search(r"\blat\s*:\s*(-?\d+(?:\.\d+)?)", text)
    m_lon = re.search(r"\blon\s*:\s*(-?\d+(?:\.\d+)?)", text)
    m_tz = re.search(r"\btz\s*:\s*['\"]([^'\"]+)['\"]", text)
    if not m_lat or not m_lon:
        return None
    return {
        "lat": float(m_lat.group(1)),
        "lon": float(m_lon.group(1)),
        "tz": m_tz.group(1) if m_tz else "Asia/Tokyo",
    }


def _fetch_weather():
    cfg = _read_weather_config()
    if not cfg:
        return None
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={cfg['lat']}&longitude={cfg['lon']}"
        "&hourly=temperature_2m,weather_code,precipitation_probability"
        "&current=temperature_2m,weather_code"
        f"&timezone={urllib.request.quote(cfg['tz'])}"
        "&forecast_days=1"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=WEATHER_TIMEOUT) as resp:
            raw = resp.read(1024 * 1024)
        return json.loads(raw.decode("utf-8", "replace"))
    except (OSError, ValueError):
        return None


def _wx_band_stats(data, today_ymd, hour_from, hour_to):
    """data.hourly から today_ymd の [hour_from, hour_to) 区間の hi/lo/popMax を集約。

    半開区間 [from, to)。該当データが 1 件もなければ None。
    """
    if not data or "hourly" not in data:
        return None
    hourly = data["hourly"]
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    pops = hourly.get("precipitation_probability") or []
    t_hi = None
    t_lo = None
    pop_max = None
    for i, ts in enumerate(times):
        # Open-Meteo は timezone=Asia/Tokyo 指定時、無タイムゾーンの ISO local（"YYYY-MM-DDTHH:MM"）を返す
        if len(ts) < 13 or ts[:10] != today_ymd:
            continue
        try:
            h = int(ts[11:13])
        except ValueError:
            continue
        if h < hour_from or h >= hour_to:
            continue
        if i < len(temps) and isinstance(temps[i], (int, float)):
            tv = temps[i]
            if t_hi is None or tv > t_hi:
                t_hi = tv
            if t_lo is None or tv < t_lo:
                t_lo = tv
        if i < len(pops) and isinstance(pops[i], (int, float)):
            pv = pops[i]
            if pop_max is None or pv > pop_max:
                pop_max = pv
    if t_hi is None and pop_max is None:
        return None
    return {"hi": t_hi, "lo": t_lo, "pop_max": pop_max}


def _clothes_phrase(hi):
    # 「その日の最高気温」→ 服装の一言。slot (1日/朝/夜) を問わず判定対象は固定で all slot
    # [6,21) の hi を使う（朝 20° / 日中 26° の日に「半袖で十分」が出るよう、_build_weather_line
    # 側で渡す hi は dayHi に統一されている）。web/app.js の _clothesPhrase と同じ閾値・同じ文言。
    if hi is None:
        return ""
    if hi >= 30:
        return "半袖でも暑そう"
    if hi >= 25:
        return "半袖で十分"
    if hi >= 20:
        return "長袖シャツで"
    if hi >= 15:
        return "薄手の上着があると安心"
    if hi >= 10:
        return "上着をしっかり"
    if hi >= 5:
        return "コートで"
    return "厚手のコートで"


def _umbrella_phrase(pop_max):
    # web/app.js の _umbrellaPhrase と同じ閾値・同じ文言
    if pop_max is None:
        return ""
    if pop_max >= 70:
        return "傘は必須"
    if pop_max >= 50:
        return "傘があった方がいいよ"
    if pop_max >= 30:
        return "折りたたみ傘があると安心"
    return "傘はいらなさそう"


def _build_weather_line(label, stats, day_hi):
    """気温表示は slot ごとの hi/lo（朝枠なら朝の最高/最低）、服装ワードは day_hi（その日の
    最高気温 = all slot [6,21) の hi）で固定判定。傘ワードは slot ごとの pop_max（朝に傘・夜に傘
    の時間帯固有の意味を残す）。降水確率の数値表示「降水 N%」を温度の次に追加（傘ワードの
    根拠を可視化、傘がいらない日でも数字が出る）。pop_max が None のときは降水パートを省略。
    """
    if not stats:
        return None
    parts = []
    if stats["hi"] is not None:
        t = f"最高 {round(stats['hi'])}°"
        if stats["lo"] is not None and round(stats["lo"]) != round(stats["hi"]):
            t += f" / 最低 {round(stats['lo'])}°"
        parts.append(t)
    if stats["pop_max"] is not None:
        parts.append(f"降水 {round(stats['pop_max'])}%")
    clothes = _clothes_phrase(day_hi)
    if clothes:
        parts.append(clothes)
    umb = _umbrella_phrase(stats["pop_max"])
    if umb:
        parts.append(umb)
    if not parts:
        return None
    return f"{label}：{'、'.join(parts)}"


def _build_weather_lines(now):
    """平日 [1 日 6-21, 朝 7-9, 夜 18-22] / 土日 [1 日 6-21] の順。data 不在は空 list。
    服装ワードはどの slot でも 1 日 6-21 の hi (day_hi) で判定する。
    """
    data = _fetch_weather()
    if not data:
        return []
    today_ymd = now.strftime("%Y-%m-%d")
    dow = now.weekday()  # Mon=0 .. Sun=6
    is_weekend = dow >= 5
    all_band = _wx_band_stats(data, today_ymd, 6, 21)
    day_hi = all_band["hi"] if (all_band and all_band["hi"] is not None) else None
    out = []
    all_line = _build_weather_line("きょうの天気", all_band, day_hi)
    if all_line:
        out.append(all_line)
    if not is_weekend:
        morning = _wx_band_stats(data, today_ymd, 7, 9)
        ml = _build_weather_line("朝の天気", morning, day_hi)
        if ml:
            out.append(ml)
        evening = _wx_band_stats(data, today_ymd, 18, 22)
        el = _build_weather_line("夜の天気", evening, day_hi)
        if el:
            out.append(el)
    return out


def _build_fortune_line(now):
    """日付 seed で deterministic 生成（双子座固定）。同日内は何度呼んでも同じ文字列。"""
    seed = now.year * 10000 + now.month * 100 + now.day
    rnd = random.Random(seed)
    luck = rnd.choice(FORTUNE_LUCK)
    level = rnd.choice(FORTUNE_LEVEL)
    color = rnd.choice(FORTUNE_COLOR)
    tip = rnd.choice(FORTUNE_TIP)
    return f"きょうの双子座：{luck}運が{level}。ラッキーカラーは{color}。{tip}。"


def _build_news_lines():
    """news_items() を流用し「ニュース：<title>」形式に整形。失敗時は []。"""
    items = news_items()
    return [f"ニュース：{t}" for t in items]


def _build_anthropic_lines(today_ymd):
    """Anthropic 新着リリースを「Anthropic：<title>」形式に整形。新着無し / 失敗時は []。"""
    return [f"Anthropic：{t}" for t in _anthropic_new_titles(today_ymd)]


def _jst_today_ymd():
    """JST 当日の YYYY-MM-DD。helper を tz=Asia/Tokyo 運用の Linux Mint で動かしている前提だが、
    将来 TZ が変わっても JST 固定で日付を決められるように +9h を明示計算する。
    """
    # datetime.timezone(datetime.timedelta(hours=9)) は Python 3.7+ で利用可能
    jst = datetime.timezone(datetime.timedelta(hours=9))
    return datetime.datetime.now(jst).strftime("%Y-%m-%d")


def quotes_payload():
    """JST 当日の cache を返す。日付が変わったら build し直す。

    返り値（JSON 用 dict）:
      {"date": "YYYY-MM-DD", "weather": [...lines...], "fortune": "...",
       "news": [...lines...], "anthropic": [...lines...]}
    """
    today_ymd = _jst_today_ymd()
    if _quotes_cache["date"] == today_ymd and _quotes_cache["payload"] is not None:
        return _quotes_cache["payload"]
    # build 用には JST の naive datetime を渡したい（weekday / month / day を JST で判定）
    jst = datetime.timezone(datetime.timedelta(hours=9))
    now_jst = datetime.datetime.now(jst).replace(tzinfo=None)
    payload = {
        "date": today_ymd,
        "weather": _build_weather_lines(now_jst),
        "fortune": _build_fortune_line(now_jst),
        "news": _build_news_lines(),
        "anthropic": _build_anthropic_lines(today_ymd),
    }
    _quotes_cache["date"] = today_ymd
    _quotes_cache["payload"] = payload
    return payload


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/np":
            try:
                self._send_json(now_playing())
            except Exception:
                self._send_json({"playing": False})
        elif path == "/news":
            try:
                self._send_json({"items": news_items()})
            except Exception:
                self._send_json({"items": []})
        elif path == "/quotes":
            try:
                self._send_json(quotes_payload())
            except Exception:
                # 失敗時は date だけ入れて空配列で返す（既存 /np / /news の方針と整合）
                self._send_json({"date": _jst_today_ymd(), "weather": [], "fortune": "", "news": [], "anthropic": []})
        else:
            self._send_json({"error": "not found"}, code=404)

    def log_message(self, *args):  # journal を汚さない
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
