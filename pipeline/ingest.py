#!/usr/bin/env python3
"""companion-english パイプライン第1段 — 動画+字幕の取り込み (設計 english-design.md §3.1)。

2 つのモード:
- 通常モード (既定): `sources.json` ({series,title,url} の配列、url は単一動画/プレイリスト両対応)
  を読み、各 URL を yt-dlp で 1 回メタデータ取得 (-j、フル抽出) してエントリ一覧+字幕可用性+
  duration をまとめて確定し、DB に未登録のエントリだけ実ダウンロードする。
- inbox モード (`--inbox --series <slug>`): `inbox/` 直下の動画 + 同名 .srt/.vtt を取り込む。

yt-dlp は remote/dlqueue.py (companion-remote) と同一実体・同一フォーマット文字列を使う
(720p 上限、HDD/2 コア機での自己 DoS 回避の実績値)。IPv4 強制 (-4) もこの網の IPv6 全損実測
(reference_ipv6_dead_network) に合わせて全呼び出しに付ける。

設計契約 (破ると壊れる一線):
- 成否判定は rc==0 + 出力ファイルの実在確認で 1 回確定する。リトライ・stderr 文言分岐をしない
  (dlqueue.py と同型)。失敗したエントリはログして次へ進む (その場で 1 回だけ再試行等もしない)。
- 冪等性は「DB に同 id の episodes 行があれば skip」のみで担保する。宛先ファイルの有無では
  判定しない (中断で中途半端なファイルが残っていても、DB に行が無ければ再ダウンロードで上書き
  = -y 相当の再実行安全性は yt-dlp 側の -o 固定パスで担保される)。
- 字幕種別 (sub_kind) は「-j で取れた subtitles/automatic_captions に 'en' キーがあるか」で
  ダウンロード前に確定する。ダウンロード後に実ファイルが無ければ sub_kind を "none" に落として
  視聴専用として登録する (rc==0 でも字幕生成に失敗するケースへの実測ベースの防御)。
"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common  # noqa: E402

YTDLP = os.environ.get("ENGLISH_YTDLP", os.path.expanduser("~/bin/yt-dlp"))
FFMPEG = os.environ.get("ENGLISH_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("ENGLISH_FFPROBE", "ffprobe")
# remote/dlqueue.py の --ytdl-format と同一文字列 (720p 上限、AVX1+HDD 自己 DoS 回避の実績値)。
FORMAT = "bestvideo[height<=?720]+bestaudio/best[height<=?720]/best"
PROBE_TIMEOUT = 300    # メタデータ取得 (-j) の backstop。プレイリスト全体でも数十話規模のため十分
DL_TIMEOUT = 3600      # 1 話 DL の backstop (dlqueue と同値)
ERROR_TAIL = 200        # stderr 末尾の表面化幅 (分岐には使わない、ログ用)
VIDEO_EXTS = (".mp4", ".mkv", ".webm", ".mov", ".avi")


class IngestError(Exception):
    """メタデータ取得など、個別ファイルより広い単位での確定失敗。"""


def _env():
    """yt-dlp/ffmpeg 用の固定最小 env (dlqueue.py と同じ隔離方針)。"""
    env = {k: os.environ[k] for k in ("HOME", "PATH") if k in os.environ}
    env.setdefault("PATH", "/home/miho/bin:/usr/bin:/bin")
    return env


def _probe_entries(source_url, env):
    """source_url (単一動画 or プレイリスト) のエントリ一覧を字幕可用性込みで取得する (DL なし)。

    1 回の `yt-dlp -j` で enumeration + subtitles/automatic_captions + duration をまとめて
    取る (--flat-playlist だと字幕情報が欠けるため、あえてフル抽出を使う。対象プレイリストは
    高々十数話規模なので許容できるコスト)。
    """
    argv = [YTDLP, "--ignore-config", "--no-warnings", "-4", "-j", source_url]
    try:
        p = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=PROBE_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IngestError("metadata probe failed: %s" % exc)
    if p.returncode != 0:
        tail = (p.stderr or "").strip()[-ERROR_TAIL:]
        raise IngestError("metadata probe failed (rc=%d): %s" % (p.returncode, tail))
    entries = []
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except ValueError:
            continue  # yt-dlp が警告等を stdout に混ぜた行は無視 (壊れた行を落とすだけ)
    return entries


def _entry_sub_kind(entry):
    subs = entry.get("subtitles") or {}
    auto = entry.get("automatic_captions") or {}
    if isinstance(subs, dict) and "en" in subs:
        return "manual"
    if isinstance(auto, dict) and "en" in auto:
        return "auto"
    return "none"


def _entry_has_manual_ja(entry):
    """手動 ja 字幕があるか (自動翻訳字幕の automatic_captions は見ない、日本語訳は
    手動字幕のみ使う方針、team-lead 指示)。"""
    subs = entry.get("subtitles") or {}
    return isinstance(subs, dict) and "ja" in subs


def _entry_sort_key(entry, source_order=0):
    """話数順キー。プレイリスト index を 4 桁 0 埋め (10 話超での字句ソート崩れ対策)。

    単一動画 URL は playlist_index が無く upload_date フォールバックに落ちるが、同日公開
    (実測: Bee and PuppyCat Ep1/Ep2 = 20141107) で同値タイになり一覧の表示順が不定になる。
    sources.json のエントリ順 (source_order、= 話数順に列挙する運用) を 0 埋めサフィックスで
    安定タイブレークとして焼き込む (video_id 辞書順のような偶然依存キーは使わない)。
    sort_key は INSERT 時 1 回確定で既存行は再計算しない — サフィックスなしの既存行
    ("20231013") は同一 prefix の新形式 ("20231013-0005") より字句順で先に並び互換。
    upload_date も無い場合は "~" prefix (全英数字より後) + エントリ順で末尾に確定させる。"""
    idx = entry.get("playlist_index")
    if isinstance(idx, int) and not isinstance(idx, bool):
        return "%04d" % idx
    upload_date = entry.get("upload_date")
    if isinstance(upload_date, str) and upload_date:
        return "%s-%04d" % (upload_date, source_order)
    return "~%04d" % source_order


def _ffprobe_duration_s(path, env):
    argv = [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]
    try:
        p = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if p.returncode != 0:
        return None
    try:
        return float((p.stdout or "").strip())
    except ValueError:
        return None


def _download_episode(entry, sub_kind, env):
    """1 話を yt-dlp で DL する。成否は rc + 出力ファイル実在で呼び出し側が確定する。"""
    vid = entry["id"]
    url = entry.get("webpage_url") or ("https://www.youtube.com/watch?v=" + vid)
    argv = [
        YTDLP, "--ignore-config", "--no-playlist", "--no-progress", "-4",
        "-f", FORMAT,
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",  # bestvideo+bestaudio でない (単一フォーマット) 場合も mp4 に確定
        "-P", "home:%s" % common.EPISODES_DIR,
        "-P", "subtitle:%s" % common.SUBS_RAW_DIR,
        "-o", "%(id)s.%(ext)s",
    ]
    if sub_kind == "manual":
        argv += ["--write-subs", "--sub-langs", "en"]
    elif sub_kind == "auto":
        argv += ["--write-auto-subs", "--sub-langs", "en"]
    if sub_kind in ("manual", "auto"):
        argv += ["--sub-format", "vtt", "--convert-subs", "vtt"]
    argv += ["--no-simulate", url]
    try:
        p = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, start_new_session=True)
    except OSError as exc:
        return False, "yt-dlp not executable: %s" % exc
    try:
        out, err = p.communicate(timeout=DL_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        p.communicate()
        return False, "timeout (%ds)" % DL_TIMEOUT
    if p.returncode != 0:
        tail = (err or "").strip()[-ERROR_TAIL:]
        return False, tail or "yt-dlp failed (rc=%d)" % p.returncode
    video_path = common.EPISODES_DIR / ("%s.mp4" % vid)
    if not video_path.is_file():
        return False, "video file not found after download"
    return True, None


def _download_ja_subtitle(entry, env):
    """手動 ja 字幕を best-effort で取得する (`media/subs/raw/<id>.ja.vtt`)。動画は
    既に DL 済みなので --skip-download。失敗しても ingest 全体は失敗させない (呼び出し側に
    真偽を返さずログのみ、1 回確定・リトライしない — dlqueue と同型の設計契約)。
    sub_kind (en 専用) には一切影響させない。"""
    vid = entry["id"]
    url = entry.get("webpage_url") or ("https://www.youtube.com/watch?v=" + vid)
    argv = [
        YTDLP, "--ignore-config", "--no-playlist", "--no-progress", "-4",
        "--skip-download", "--write-subs", "--sub-langs", "ja",
        "--sub-format", "vtt", "--convert-subs", "vtt",
        "-P", "subtitle:%s" % common.SUBS_RAW_DIR,
        "-o", "%(id)s.%(ext)s",
        "--no-simulate", url,
    ]
    try:
        p = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=DL_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as exc:
        common.log("ja subtitle fetch failed for %s: %s" % (vid, exc))
        return
    if p.returncode != 0:
        tail = (p.stderr or "").strip()[-ERROR_TAIL:]
        common.log("ja subtitle fetch failed (rc=%d) for %s: %s" % (p.returncode, vid, tail))


def _insert_episode_row(conn, id_, series_id, title, source_url, duration_s,
                         video_path, sub_path, sub_kind, sort_key):
    conn.execute(
        "INSERT INTO episodes (id, series_id, title, source_url, duration_s, video_path, "
        "sub_path, sub_kind, sort_key, ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (id_, series_id, title, source_url, int(round(duration_s)),
         str(video_path.relative_to(common.ROOT)),
         str(sub_path.relative_to(common.ROOT)) if sub_path else None,
         sub_kind, sort_key, int(time.time())))
    conn.commit()


def _ensure_series(conn, series_id, title, sort):
    conn.execute("INSERT OR IGNORE INTO series (id, title, sort) VALUES (?,?,?)",
                 (series_id, title, sort))
    conn.commit()


def _existing_episode_ids(conn):
    return {row["id"] for row in conn.execute("SELECT id FROM episodes")}


def _ingest_one_entry(conn, entry, series_id, source_url, env, source_order=0):
    vid = entry["id"]
    sub_kind = _entry_sub_kind(entry)
    common.log("downloading %s: %s" % (vid, entry.get("title")))
    ok, err = _download_episode(entry, sub_kind, env)
    if not ok:
        return False, err
    if _entry_has_manual_ja(entry):
        _download_ja_subtitle(entry, env)
    video_path = common.EPISODES_DIR / ("%s.mp4" % vid)
    duration_s = entry.get("duration")
    if not isinstance(duration_s, (int, float)) or duration_s <= 0:
        duration_s = _ffprobe_duration_s(video_path, env)
    if not duration_s:
        return False, "duration unknown"
    if sub_kind in ("manual", "auto"):
        candidate = common.SUBS_RAW_DIR / ("%s.en.vtt" % vid)
        if not candidate.is_file():
            sub_kind = "none"  # rc==0 でも字幕ファイルが無い実測ケースへの防御、視聴専用に確定
    # episodes.sub_path は「クリーン済みプレイヤー用 WebVTT」専用の列 (設計 §2 コメント) なので
    # ここでは NULL のまま登録する。生字幕は media/subs/raw/<id>.en.vtt に固定命名で置かれ、
    # subs.py がその命名規則から見つけてクリーニング後に sub_path を確定させる。
    _insert_episode_row(conn, vid, series_id, entry.get("title") or vid, source_url,
                         duration_s, video_path, None, sub_kind,
                         _entry_sort_key(entry, source_order))
    return True, None


def ingest_from_sources(sources_path=None, db_path=None):
    sources_path = pathlib.Path(sources_path) if sources_path else common.SOURCES_JSON
    with open(sources_path, encoding="utf-8") as f:
        sources = json.load(f)
    if not isinstance(sources, list):
        raise IngestError("sources.json must be a JSON array")
    common.ensure_media_dirs()
    conn = common.open_db(db_path)
    env = _env()
    added = failed = 0
    for i, src in enumerate(sources):
        series_id = src["series"]
        series_title = src.get("title") or series_id
        source_url = src["url"]
        _ensure_series(conn, series_id, series_title, i)
        common.log("probing %s: %s" % (series_id, source_url))
        try:
            entries = _probe_entries(source_url, env)
        except IngestError as exc:
            common.log("FAILED probe %s: %s" % (series_id, exc))
            failed += 1
            continue
        existing = _existing_episode_ids(conn)
        for entry in entries:
            vid = entry.get("id")
            if not vid or vid in existing:
                continue
            ok, err = _ingest_one_entry(conn, entry, series_id, source_url, env, source_order=i)
            if ok:
                added += 1
            else:
                failed += 1
                common.log("FAILED episode %s (%s): %s" % (vid, series_id, err))
    common.log("ingest done: added=%d failed=%d" % (added, failed))
    return added, failed


def _ingest_inbox_file(conn, src_path, vid, series_id, env):
    dest = common.EPISODES_DIR / ("%s.mp4" % vid)
    if src_path.suffix.lower() == ".mp4":
        try:
            shutil.copy2(src_path, dest)
        except OSError as exc:
            return False, "copy failed: %s" % exc
    else:
        # コンテナのみ変換 (再エンコードはしない。コーデック非互換で失敗したら 1 回確定で
        # 諦める — 自動再エンコードへのフォールバック積み増しはしない。user が手動変換する)。
        argv = [FFMPEG, "-y", "-nostdin", "-loglevel", "error", "-i", str(src_path),
                "-c", "copy", str(dest)]
        try:
            p = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=DL_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return False, "remux failed: %s" % exc
        if p.returncode != 0 or not dest.is_file():
            tail = (p.stderr or "").strip()[-ERROR_TAIL:]
            return False, "remux failed (rc=%s): %s" % (p.returncode, tail)
    duration_s = _ffprobe_duration_s(dest, env)
    if not duration_s:
        return False, "duration unknown"
    sub_kind = "none"
    for ext in (".vtt", ".srt"):
        sidecar = src_path.with_suffix(ext)
        if not sidecar.is_file():
            continue
        # media/subs/raw/<id>.en.vtt に固定命名で置く (yt-dlp 経由と同じ命名規則。subs.py は
        # ここから見つける。episodes.sub_path はクリーン化後に subs.py が設定する、上と同型)。
        sub_dest = common.SUBS_RAW_DIR / ("%s.en.vtt" % vid)
        if ext == ".vtt":
            try:
                shutil.copy2(sidecar, sub_dest)
            except OSError as exc:
                return False, "subtitle copy failed: %s" % exc
        else:
            argv = [FFMPEG, "-y", "-nostdin", "-loglevel", "error", "-i", str(sidecar), str(sub_dest)]
            try:
                p = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, timeout=60)
            except (OSError, subprocess.TimeoutExpired) as exc:
                return False, "subtitle convert failed: %s" % exc
            if p.returncode != 0 or not sub_dest.is_file():
                return False, "subtitle convert failed (rc=%s)" % p.returncode
        sub_kind = "local"
        break
    _insert_episode_row(conn, vid, series_id, src_path.stem, None, duration_s,
                         dest, None, sub_kind, src_path.stem)
    return True, None


def ingest_from_inbox(series_slug, series_title=None, db_path=None):
    common.ensure_media_dirs()
    conn = common.open_db(db_path)
    env = _env()
    row = conn.execute("SELECT title FROM series WHERE id=?", (series_slug,)).fetchone()
    if row is None:
        title = series_title or series_slug.replace("-", " ").replace("_", " ").title()
        _ensure_series(conn, series_slug, title, 999)
        common.log("series '%s' not found, auto-created with title '%s'" % (series_slug, title))
    if not common.INBOX_DIR.is_dir():
        common.log("inbox dir not found: %s" % common.INBOX_DIR)
        return 0, 0
    existing = _existing_episode_ids(conn)
    added = failed = 0
    for path in sorted(common.INBOX_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTS:
            continue
        vid = "local-" + hashlib.md5(path.name.encode("utf-8")).hexdigest()[:12]
        if vid in existing:
            continue
        ok, err = _ingest_inbox_file(conn, path, vid, series_slug, env)
        if ok:
            added += 1
        else:
            failed += 1
            common.log("FAILED inbox %s: %s" % (path.name, err))
    common.log("inbox ingest done: added=%d failed=%d" % (added, failed))
    return added, failed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", default=None, help="sources.json のパス (既定: pipeline/sources.json)")
    parser.add_argument("--db", default=None, help="DB パス (既定: data/english.db、テスト用に上書き可)")
    parser.add_argument("--inbox", action="store_true", help="inbox/ からのローカル持ち込み取り込みに切替")
    parser.add_argument("--series", default=None, help="--inbox 時の対象シリーズ slug (必須)")
    parser.add_argument("--series-title", default=None, help="--inbox で新規シリーズを作る場合のタイトル")
    args = parser.parse_args(argv)
    if args.inbox:
        if not args.series:
            parser.error("--inbox には --series が必須")
        ingest_from_inbox(args.series, args.series_title, db_path=args.db)
    else:
        ingest_from_sources(args.sources, db_path=args.db)


if __name__ == "__main__":
    main()
