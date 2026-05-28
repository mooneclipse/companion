#!/usr/bin/env python3
"""dashboard-notify-ren-quotes.py — 5:30 dashboard 起動時に「今朝の ren セリフ集」を
bot 経由で Telegram #maintenance topic に silent 通知する。

dashboard-start.sh から `&` でバックグラウンド起動される想定。
通知失敗（bot socket 不在 / Open-Meteo 障害 / RSS 障害等）が dashboard 本流
（mpv / firefox / sleep infinity）を倒さないよう、全例外を最上位で握って exit 0。

セリフ内容は web/app.js のセリフ枠ロジックと同等概念:
  平日 = 1 日の天気 + 朝の天気 + 夜の天気 + 占い + ニュース×3
  土日 = 1 日の天気 + 占い + ニュース×3

服装ワード (_clothes_phrase) はどの slot でも「その日の最高気温 (all slot [6,21) の hi)」で
判定する (朝枠でも夜枠でも dayHi 基準で固定)。気温表示は slot ごとの hi/lo を出してよく、
傘ワード (_umbrella_phrase) も slot ごとの pop_max を使う。

dashboard と bot で時点ズレがあっても可（同じ意図のセリフが届けば足りる）。

重複防止: `.state/last-notify-date` に YYYY-MM-DD（JST）を書き、同日内の再起動では skip。
同日に何度も Telegram topic に届くと過剰なため。観察やテストで強制再送したいときは
`.state/last-notify-date` を削除するか中身を書き換えればよい。

bot socket 仕様 (~/companion/bot/docs/STATUS.md):
  - `$XDG_RUNTIME_DIR/companion-bot.sock` (permission 0600)
  - 1 接続 1 メッセージ、UTF-8、EOF で確定
  - 本文は #maintenance topic へ転送
  - `[critical] ` プレフィクス完全一致で disable_notification 反転（今回は silent なので付けない）
"""
import datetime
import json
import os
import random
import re
import socket
import sys
import urllib.error
import urllib.request
from xml.etree import ElementTree as ET

DASH_DIR = os.path.expanduser("~/companion/dashboard")
CONFIG_JS = os.path.join(DASH_DIR, "web", "dashboard-config.js")
STATE_DIR = os.path.join(DASH_DIR, ".state")
LAST_NOTIFY_FILE = os.path.join(STATE_DIR, "last-notify-date")

# Open-Meteo（web/app.js と同設定）
WEATHER_TIMEOUT = 4.0
# NHK NEWS WEB 主要ニュース RSS（server/nowplaying-helper.py と同じ取得元・取得理由）
NEWS_RSS_URL = "https://www.nhk.or.jp/rss/news/cat0.xml"
NEWS_MAX_ITEMS = 3
NEWS_TIMEOUT = 3.0
USER_AGENT = "companion-dashboard/1.0 (+local kiosk)"

BOT_SOCK = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR") or ("/run/user/%d" % os.getuid()),
    "companion-bot.sock",
)


# ─── dashboard-config.js から weather 座標を取り出す ──────────────────
# 厳密な JS パーサは持ち込まず、想定フォーマットの `lat: <float>,` `lon: <float>,`
# `tz: '...'` を正規表現で拾う。中村区固定運用なので失敗時は東京駅でフォールバック
# せず weather 行を諦める（送信側で天気行スキップ）。
def _read_weather_config():
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


# ─── 天気: Open-Meteo に直接 fetch ────────────────────────────────
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
    except (OSError, ValueError, urllib.error.URLError):
        return None


def _wx_band_stats(data, today_ymd, hour_from, hour_to):
    """data.hourly から today_ymd の [hour_from, hour_to) 区間の hi/lo/popMax を集約。

    web/app.js の _wxBandStats と同等。半開区間 [from, to)。
    該当データが 1 件もなければ None。
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
    の時間帯固有の意味を残す）。day_hi が None（all slot stats 不在）なら服装パートを省略。
    """
    if not stats:
        return None
    parts = []
    if stats["hi"] is not None:
        t = f"最高 {round(stats['hi'])}°"
        if stats["lo"] is not None and round(stats["lo"]) != round(stats["hi"]):
            t += f" / 最低 {round(stats['lo'])}°"
        parts.append(t)
    clothes = _clothes_phrase(day_hi)
    if clothes:
        parts.append(clothes)
    umb = _umbrella_phrase(stats["pop_max"])
    if umb:
        parts.append(umb)
    if not parts:
        return None
    return f"{label}：{', '.join(parts)}"


def build_weather_lines(now):
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


# ─── 占い: 日付 seed の deterministic 生成（双子座固定） ───────────────
# 注意: web/app.js の FORTUNE_LUCK / FORTUNE_LEVEL / FORTUNE_COLOR / FORTUNE_TIP と
# 同じ phrase pool を保持している。ロジック移植のため二重管理になっており、将来
# pool 更新時は両方追従が必要（STATUS.md に明記、設計判断保留）。
# Mulberry32 / seed 関数は JS と同じハッシュアルゴリズムを 32bit 演算で再現するが、
# JS と Python で完全一致させる必要はない（同じ意図のセリフが届けば足りる、STATUS.md
# 「dashboard と bot で時点ズレがあっても可」原則と同様）。Python 標準 random を date
# seed で driven するだけで deterministic 性は確保できる。
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


def build_fortune_line(now):
    seed = now.year * 10000 + now.month * 100 + now.day
    rnd = random.Random(seed)
    luck = rnd.choice(FORTUNE_LUCK)
    level = rnd.choice(FORTUNE_LEVEL)
    color = rnd.choice(FORTUNE_COLOR)
    tip = rnd.choice(FORTUNE_TIP)
    return f"きょうの双子座：{luck}運が{level}。ラッキーカラーは{color}。{tip}。"


# ─── ニュース: NHK NEWS WEB RSS を直接 fetch ──────────────────────────
def build_news_lines():
    try:
        req = urllib.request.Request(NEWS_RSS_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=NEWS_TIMEOUT) as resp:
            raw = resp.read(1024 * 1024)
    except (OSError, ValueError, urllib.error.URLError):
        return []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    items = []
    for item in root.iter("item"):
        title_el = item.find("title")
        if title_el is None or not title_el.text:
            continue
        text = re.sub(r"\s+", " ", title_el.text).strip()
        if text:
            items.append(f"ニュース：{text}")
        if len(items) >= NEWS_MAX_ITEMS:
            break
    return items


# ─── 通知本文の組み立て ──────────────────────────────────────────
def build_message(now):
    """5:30 起動時の「今朝の ren セリフ集」を 1 通分のテキストに組む。

    どれか 1 つでも組めれば送る。占いは無条件で出るので最低 1 行は確保される。
    """
    header_date = now.strftime("%Y-%m-%d (%a) %H:%M")
    lines = []
    try:
        lines.extend(build_weather_lines(now))
    except Exception as e:
        # 個別 sub-source の失敗は他を倒さない（dashboard 本流原則の踏襲）
        print(f"dashboard-notify: weather failed: {e}", file=sys.stderr)
    try:
        lines.append(build_fortune_line(now))
    except Exception as e:
        print(f"dashboard-notify: fortune failed: {e}", file=sys.stderr)
    try:
        lines.extend(build_news_lines())
    except Exception as e:
        print(f"dashboard-notify: news failed: {e}", file=sys.stderr)
    if not lines:
        return None
    body = "今朝の ren セリフ集（" + header_date + "）\n\n" + "\n\n".join(lines)
    return body


# ─── bot socket への投入 ─────────────────────────────────────────
def send_to_bot(text):
    """$XDG_RUNTIME_DIR/companion-bot.sock に 1 接続 1 メッセージで投入し EOF で確定。

    silent default（[critical] プレフィクスを付けない）。
    socket 不在 / 接続拒否は OSError として戻り値 False で返す。
    """
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(3.0)
            s.connect(BOT_SOCK)
            s.sendall(text.encode("utf-8"))
            s.shutdown(socket.SHUT_WR)  # EOF 送出で送信完了を bot に伝える（応答は無し）
        return True
    except (OSError, socket.timeout) as e:
        print(f"dashboard-notify: bot socket send failed: {e}", file=sys.stderr)
        return False


# ─── 重複防止 ──────────────────────────────────────────────────
def already_sent_today(today_ymd):
    try:
        with open(LAST_NOTIFY_FILE, "r", encoding="utf-8") as f:
            return f.read().strip() == today_ymd
    except OSError:
        return False


def mark_sent_today(today_ymd):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(LAST_NOTIFY_FILE, "w", encoding="utf-8") as f:
            f.write(today_ymd + "\n")
    except OSError as e:
        # 書き込み失敗 = 次回再送される（過剰送信になるが、本来送れたメッセージは届いた）。
        print(f"dashboard-notify: failed to mark sent: {e}", file=sys.stderr)


def main():
    now = datetime.datetime.now()
    today_ymd = now.strftime("%Y-%m-%d")
    if already_sent_today(today_ymd):
        print(f"dashboard-notify: already sent for {today_ymd}, skipping")
        return 0
    body = build_message(now)
    if not body:
        print("dashboard-notify: no lines built (all sources empty), skipping", file=sys.stderr)
        return 0
    if not send_to_bot(body):
        # 失敗時は mark しない（次回起動で再試行可能）。dashboard 本流は exit 0 で抜ける。
        return 0
    mark_sent_today(today_ymd)
    print(f"dashboard-notify: sent ({len(body)} bytes) for {today_ymd}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        # 想定外の例外でも dashboard 本流を倒さないため exit 0
        print(f"dashboard-notify: unexpected error: {e}", file=sys.stderr)
        sys.exit(0)
