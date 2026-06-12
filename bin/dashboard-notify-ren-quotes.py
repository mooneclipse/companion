#!/usr/bin/env python3
"""dashboard-notify-ren-quotes.py — 5:30 dashboard 起動時に「今朝の ren セリフ集」を
bot 経由で Telegram #maintenance topic に silent 通知する。

dashboard-start.sh から `&` でバックグラウンド起動される想定。
通知失敗（bot socket 不在 / helper 不在 / parse 失敗等）が dashboard 本流
（mpv / firefox / sleep infinity）を倒さないよう、全例外を最上位で握って exit 0。

セリフ内容: helper (`server/nowplaying-helper.py`) の `GET /quotes` を fetch して取得。
返り値 JSON `{"date": "YYYY-MM-DD", "weather": [...], "fortune": "...", "news": [...],
"anthropic": [...]}` を `weather + [fortune] + news + anthropic` の順で並べて本文を組む。

  平日 = 1 日の天気 + 朝の天気 + 夜の天気 + 占い + ニュース×1〜3 (+ Anthropic 新着)
  土日 = 1 日の天気 + 占い + ニュース×1〜3 (+ Anthropic 新着)

anthropic は anthropic.com/news の Product カテゴリ新着タイトル（通常 0 件、新モデル/製品
発表があった朝だけ 1〜数件）。helper が前回 build 以降の新着を差分検出して入れる。

helper 側が JST 当日の日付を key に同日 1 回だけ build → cache するため、bot 通知と
dashboard ブラウザ表示で「同じ占い文 / 同じニュース並び / 同じ天気行（降水確率付き）」が
完全一致で出る。占い random seed / 天気 fetch 時点 / news fetch 時点のズレは helper 側で
吸収される。

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
import re
import socket
import sys
import urllib.error
import urllib.request

DASH_DIR = os.path.expanduser("~/companion/dashboard")
CONFIG_JS = os.path.join(DASH_DIR, "web", "dashboard-config.js")
STATE_DIR = os.path.join(DASH_DIR, ".state")
LAST_NOTIFY_FILE = os.path.join(STATE_DIR, "last-notify-date")

# helper /quotes の fetch timeout（helper は in-memory cache なので 2 回目以降は即返。
# 初回 build 時に Open-Meteo + NHK RSS + Anthropic news を直列 fetch するため、helper 側の
# 最悪 timeout 合算を見て余裕を取る:
#   urllib の timeout は socket 1 op ごとの stall 検出で、fetch 総時間の上限ではない
#   (この回線では index ~390KB の wall time 実測 3.4〜13.0s)。そこで式は timeout 合算
#   でなく観測 wall worst で組む:
#   weather 4 + news 3 + Anthropic index 13 + 記事 og:title 13 × 最大 3 件 ≒ worst 59 秒。
#   余裕を含め 90.0 秒で吸収する (本 script は dashboard-start.sh から detach 起動の
#   fire-and-forget で、遅延に依存する後続処理はない)。
# （ANTHROPIC_FETCH_TIMEOUT 3.0→10.0 の実測ベース再確定に連動した再計算。今回は旧式が
#   想定していなかった「新着 3 件」worst も式に含めた。2 度目の数値変更にあたるため、
#   2 周目合理化の判断根拠を dashboard/docs/STATUS.md 2026-06-12 に記録済み）
QUOTES_TIMEOUT = 90.0

BOT_SOCK = os.path.join(
    os.environ.get("XDG_RUNTIME_DIR") or ("/run/user/%d" % os.getuid()),
    "companion-bot.sock",
)


# ─── dashboard-config.js から helper port を取り出す ──────────────────
# web/app.js と同じ regex で nowPlaying.port を拾う。port を変えるなら
# server/nowplaying-helper.py の PORT も追従する必要があるが、ここでは
# config の値を正として helper にぶつける（既存 web 側と整合）。失敗時は
# helper のデフォルト 47823 にフォールバック。
def _read_helper_port():
    try:
        with open(CONFIG_JS, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return 47823
    # nowPlaying: { port: 47823 } のような JS リテラルから port 値だけ拾う。
    # nowPlaying ブロック内に限定するため簡易検索（多重定義は想定外）。
    m = re.search(r"nowPlaying\s*:\s*\{[^}]*\bport\s*:\s*(\d+)", text, re.DOTALL)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return 47823
    return 47823


# ─── helper /quotes を fetch ─────────────────────────────────────
def fetch_quotes():
    port = _read_helper_port()
    url = f"http://127.0.0.1:{port}/quotes"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "companion-dashboard/1.0 (+local notify)"})
        with urllib.request.urlopen(req, timeout=QUOTES_TIMEOUT) as resp:
            raw = resp.read(1024 * 1024)
        return json.loads(raw.decode("utf-8", "replace"))
    except (OSError, ValueError, urllib.error.URLError) as e:
        print(f"dashboard-notify: helper /quotes fetch failed: {e}", file=sys.stderr)
        return None


# ─── 通知本文の組み立て ──────────────────────────────────────────
def build_message(now):
    """5:30 起動時の「今朝の ren セリフ集」を 1 通分のテキストに組む。

    helper /quotes から取得した weather + fortune + news を順に並べる。
    weather が空でも fortune が出ていれば最低 1 行は確保される（helper 側で fortune は
    無条件 deterministic 生成）。helper 自体が unreachable なら None を返す（送信せず exit）。
    """
    payload = fetch_quotes()
    if not isinstance(payload, dict):
        return None
    header_date = now.strftime("%Y-%m-%d (%a) %H:%M")
    lines = []
    weather = payload.get("weather") or []
    for w in weather:
        if isinstance(w, str) and w:
            lines.append(w)
    fortune = payload.get("fortune") or ""
    if isinstance(fortune, str) and fortune:
        lines.append(fortune)
    news = payload.get("news") or []
    for n in news:
        if isinstance(n, str) and n:
            lines.append(n)
    anthropic = payload.get("anthropic") or []
    for a in anthropic:
        if isinstance(a, str) and a:
            lines.append(a)
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
        print("dashboard-notify: no lines built (helper unreachable or empty), skipping", file=sys.stderr)
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
