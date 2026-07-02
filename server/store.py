#!/usr/bin/env python3
"""SQLite アクセス層 (設計 english-design.md §2 のスキーマを唯一の定義としてここに置く)。

- server (app.py / drill.py) はこのモジュールの connect()/init_db() を使う
- pipeline (ingest.py / subs.py / clips.py) も sys.path 経由で import して使う。
  スキーマをここ以外に重複定義しない (pipeline 側は本モジュールを変更しないこと)
"""
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parent.parent  # ~/companion/english
DB_PATH = ROOT / "data" / "english.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id),
  title TEXT NOT NULL,
  source_url TEXT,
  duration_s INTEGER NOT NULL,
  video_path TEXT NOT NULL,
  sub_path TEXT,
  sub_kind TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  ingested_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watch (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id),
  position_s REAL NOT NULL DEFAULT 0,
  max_position_s REAL NOT NULL DEFAULT 0,
  completed_at INTEGER,
  comprehension INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  start_s REAL NOT NULL, end_s REAL NOT NULL,
  video_path TEXT NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT NOT NULL,
  blanks TEXT NOT NULL,
  wpm INTEGER NOT NULL,
  feature_tags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id TEXT NOT NULL REFERENCES clips(id),
  ts INTEGER NOT NULL,
  results TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT '[]',
  replays INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis (
  date TEXT PRIMARY KEY,
  report_md TEXT NOT NULL,
  weights TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_sets (
  date TEXT PRIMARY KEY,
  clip_ids TEXT NOT NULL,
  extra_ids TEXT NOT NULL DEFAULT '[]'
);
"""


def connect(db_path=None):
    """WAL + foreign_keys + Row factory で開く。呼び出し側スレッドごとに 1 接続。"""
    path = pathlib.Path(db_path) if db_path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn):
    conn.executescript(SCHEMA)
    conn.commit()
