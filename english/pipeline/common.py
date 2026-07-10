#!/usr/bin/env python3
"""pipeline 共通ヘルパー — パス定数 / ログ / server.store の import 経路。

server/store.py がスキーマの唯一の定義。pipeline 側はここから import して使うのみで
CREATE TABLE を書かない (english-design.md §2、team 指示)。
"""
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent  # ~/companion/english
PIPELINE_DIR = ROOT / "pipeline"
WORDLISTS_DIR = PIPELINE_DIR / "wordlists"
MEDIA_DIR = ROOT / "media"
EPISODES_DIR = MEDIA_DIR / "episodes"
SUBS_DIR = MEDIA_DIR / "subs"
SUBS_RAW_DIR = SUBS_DIR / "raw"
CLIPS_DIR = MEDIA_DIR / "clips"
INBOX_DIR = ROOT / "inbox"
SOURCES_JSON = PIPELINE_DIR / "sources.json"

sys.path.insert(0, str(ROOT / "server"))
import store  # noqa: E402  (sys.path 設定後の import、pipeline 各スクリプト共通経路)


def log(msg):
    """[HH:MM:SS] 付きの進捗ログ (バッチ実行時に流れを追えるように、stdout に出す)。"""
    print("[%s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def ensure_media_dirs():
    for d in (EPISODES_DIR, SUBS_RAW_DIR, CLIPS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def open_db(db_path=None):
    """store.connect + init_db をまとめたショートカット (pipeline 各スクリプト共通)。"""
    conn = store.connect(db_path)
    store.init_db(conn)
    return conn
