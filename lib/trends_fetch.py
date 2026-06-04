#!/usr/bin/env python3
"""AI トレンド週次収集の RSS/Atom 取得・パース・フィルタ・重複排除。

Python stdlib のみ (+ pyyaml) で動く。feedparser は使わない (未インストール)。
RSS2.0 (channel/item) と Atom (feed/entry) の両方をパースする。

呼び出し:
    python3 trends_fetch.py <config.yaml> <seen-urls.json> <out.json>

責務境界:
- この関数群は state (seen-urls.json) を **読むだけ** で書き換えない。
  state 更新は呼び出し元の shell が「全工程成功後」に行う (冪等性を保つため、
  途中失敗時に seen-urls が進んで記事を取りこぼすのを防ぐ)。
- feed 単位で部分失敗を許容する。1 つの feed が落ちても他は進め、失敗 feed 名は
  出力 JSON の failed_sources に載せる (レポートに収集失敗ソースを注記するため)。

出力 JSON 形式:
    {
      "items": [{source, title, url, published, summary}, ...],
      "failed_sources": [name, ...],
      "total_new": N
    }
"""

import datetime as dt
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

import yaml

USER_AGENT = "Mozilla/5.0"  # Zenn は UA が無いと弾かれる場合があるため必須
FETCH_TIMEOUT = 15  # 秒
SUMMARY_MAX = 300  # プレーン化した summary の最大文字数

# Atom 名前空間 (Qiita などは default namespace 付き)
ATOM_NS = "{http://www.w3.org/2005/Atom}"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def log_err(msg):
    """stderr に 1 行ログ (systemd journal に残す)。"""
    print(msg, file=sys.stderr)


def load_config(path):
    """YAML 設定を読む。将来 DB 化するならこの関数だけ差し替えればよい。"""
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_seen(path):
    """seen-urls.json を読む。無ければ空 dict。読むだけ (書き換えない)。"""
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as e:
        # state が壊れていても収集自体は続ける (dedup が効かないだけ)。
        log_err(f"warn: seen-urls 読み込み失敗 ({path}): {e}")
        return {}


def fetch(url):
    """URL を取得して bytes を返す。例外は呼び出し側で捕捉。

    Qiita タグ feed などパスに非 ASCII (日本語) を含む URL は、urllib が
    そのままだと 'ascii' codec error になるため path/query を percent-encode する。
    """
    url = encode_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return resp.read()


def encode_url(url):
    """URL の path/query 部の非 ASCII を UTF-8 percent-encode する。

    既に encode 済みの %xx は safe="%" で二重エンコードを避ける。
    scheme/host は ASCII 前提なのでそのまま。
    """
    from urllib.parse import quote, urlsplit, urlunsplit
    parts = urlsplit(url)
    path = quote(parts.path, safe="/%")
    query = quote(parts.query, safe="=&%")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def plain_text(raw):
    """HTML タグを除去しプレーン化、空白を畳んで切り詰める。"""
    if not raw:
        return ""
    text = html.unescape(raw)
    text = _TAG_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    if len(text) > SUMMARY_MAX:
        text = text[:SUMMARY_MAX].rstrip() + "…"
    return text


def _text(elem):
    return elem.text if elem is not None and elem.text else ""


def parse_date(value):
    """pubDate (RFC822) / updated (ISO8601) を aware datetime に。失敗時 None。"""
    if not value:
        return None
    value = value.strip()
    # RFC822 (RSS pubDate): "Wed, 03 Jun 2026 12:55:11 GMT" / "+0000"
    try:
        return parsedate_to_aware(value)
    except Exception:
        pass
    # ISO8601 (Atom updated): "2026-06-04T11:44:30+09:00" / "...Z"
    try:
        iso = value.replace("Z", "+00:00")
        d = dt.datetime.fromisoformat(iso)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d
    except ValueError:
        return None


def parsedate_to_aware(value):
    """email.utils で RFC822 をパースし aware datetime に。"""
    from email.utils import parsedate_to_datetime
    d = parsedate_to_datetime(value)
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def parse_rss(root):
    """RSS2.0 (channel/item) を [(title, link, summary, pubdate)] に。"""
    out = []
    for item in root.findall(".//channel/item"):
        title = _text(item.find("title"))
        link = _text(item.find("link"))
        summary = _text(item.find("description"))
        pub = _text(item.find("pubDate"))
        out.append((title, link, summary, pub))
    return out


def parse_atom(root):
    """Atom (feed/entry) を [(title, link, summary, updated)] に。"""
    out = []
    for entry in root.findall(f"{ATOM_NS}entry"):
        title = _text(entry.find(f"{ATOM_NS}title"))
        # link[@href]: rel="alternate" を優先、無ければ最初の link
        link = ""
        links = entry.findall(f"{ATOM_NS}link")
        for ln in links:
            if ln.get("rel") in (None, "alternate"):
                link = ln.get("href", "")
                break
        if not link and links:
            link = links[0].get("href", "")
        summary = _text(entry.find(f"{ATOM_NS}summary"))
        if not summary:
            summary = _text(entry.find(f"{ATOM_NS}content"))
        updated = _text(entry.find(f"{ATOM_NS}updated"))
        if not updated:
            updated = _text(entry.find(f"{ATOM_NS}published"))
        out.append((title, link, summary, updated))
    return out


def parse_feed(data):
    """RSS / Atom を自動判別してパース。root tag で分岐。"""
    root = ET.fromstring(data)
    tag = root.tag.lower()
    if tag.endswith("rss") or root.find(".//channel") is not None:
        return parse_rss(root)
    if tag.endswith("feed"):
        return parse_atom(root)
    # フォールバック: 両方試す
    rss = parse_rss(root)
    return rss if rss else parse_atom(root)


def keyword_match(text, keywords):
    """text に keywords のいずれかが (大文字小文字無視で) 含まれれば True。"""
    lowered = text.lower()
    return any(k.lower() in lowered for k in keywords)


def collect(config, seen):
    """全 feed を回し、フィルタ・dedup 済みの items と failed_sources を返す。"""
    keywords = config.get("keywords", []) or []
    lookback_days = int(config.get("lookback_days", 8))
    feeds = config.get("feeds", []) or []

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)

    items = []
    failed_sources = []
    seen_in_run = set()  # 同一実行内の重複も弾く (複数 feed に同一 URL)

    for feed in feeds:
        name = feed.get("name", feed.get("url", "unknown"))
        url = feed.get("url")
        use_filter = bool(feed.get("filter", False))
        if not url:
            log_err(f"skip feed (url 未指定): {name}")
            continue
        try:
            data = fetch(url)
            entries = parse_feed(data)
        except Exception as e:
            # 部分失敗許容: 1 行ログして continue、failed_sources に記録
            log_err(f"feed 取得/パース失敗: {name} ({url}): {e}")
            failed_sources.append(name)
            continue

        for title, link, summary, datestr in entries:
            title = (title or "").strip()
            link = (link or "").strip()
            if not link:
                continue
            if link in seen or link in seen_in_run:
                continue  # 既出 URL は除外 (dedup)

            published = parse_date(datestr)
            # 日付フィルタ: パースできた場合のみ判定。不能なら採用 (dedup に委ねる)
            if published is not None and published < cutoff:
                continue

            plain = plain_text(summary)
            # keyword フィルタ: filter:true のソースのみ
            if use_filter:
                haystack = f"{title} {plain}"
                if not keyword_match(haystack, keywords):
                    continue

            seen_in_run.add(link)
            items.append({
                "source": name,
                "title": title,
                "url": link,
                "published": published.isoformat() if published else "",
                "summary": plain,
            })

    return items, failed_sources


def main():
    if len(sys.argv) != 4:
        log_err("usage: trends_fetch.py <config.yaml> <seen-urls.json> <out.json>")
        return 2
    config_path, seen_path, out_path = sys.argv[1:4]

    config = load_config(config_path)
    seen = load_seen(seen_path)
    items, failed_sources = collect(config, seen)

    result = {
        "items": items,
        "failed_sources": failed_sources,
        "total_new": len(items),
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)

    log_err(
        f"trends_fetch: total_new={len(items)} "
        f"failed_sources={failed_sources}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
