#!/usr/bin/env python3
"""companion-remote ytcheck フィードバック連携 — 月次集計の read + viewing への記入 write。

ytcheck (毎朝 05:00 巡回) が vault/notes/ytcheck/viewing-YYYY-MM.md に出力する
視聴履歴に対し、(1) 月次集計レポート + 動画エントリ一覧の read、(2) 該当 video_id 行の
視聴チェック `[ ]`→`[x]` / 行末 `[feedback: ○|×|]` 記入の write を提供する (#65 案 B)。

設計境界:
  - 集計・行パースは ytcheck 側 `tools/feedback_report.py` (stdlib のみ・config 非依存を
    一次確認済) を sys.path 追加で import して流用する。パーサを二重実装しない。
  - **remote 初の外部 write**。書き込み先は viewing ディレクトリ配下の
    `viewing-YYYY-MM.md` 1 点に閉じる。パスは fullmatch 検証済みの month 文字列からのみ
    組み立て、ユーザー入力 (video_id 等) をパスに一切入れない。
  - **cross-process ロック** (docs/STATUS.md R3): ytcheck の update_viewing_history() は
    同ファイルを read→全文再構成→write するため、remote 側だけロックしても lost update は
    防げない。viewing ディレクトリ直下の共有ロックファイル `.viewing.lock` を両プロセスが
    flock(LOCK_EX) する (データの隣 = 両者が同じパスを導出できる場所が正)。blocking で
    取ってよい (書き込みは ms オーダー、競合は実質 05:00 の一瞬のみ。timeout リトライ・
    エラー分類分岐は作らない = 設計上限ルール)。read (get_month) はロック不要
    (行単位パースで torn read の実害なし、本番 GET が vault に書かない性質も保つ)。
  - パスは env で上書き可の固定デフォルト (thoughts.py の REMOTE_THOUGHTS_PATH と同型)。
    テスト・隔離検証はこの env / モジュール属性差し替えで本番非接触にする。
"""
import contextlib
import fcntl
import os
import re
import sys
from datetime import datetime
from pathlib import Path

_HOME = os.path.expanduser("~")
# viewing ファイルの実体は vault/notes/ytcheck/ (ytcheck/run.sh の YTCHECK_VIEWING_DIR と同じ)
_DEFAULT_VIEWING_DIR = os.path.join(_HOME, "companion", "vault", "notes", "ytcheck")
# チャンネルリスト (read のみ。favorite を集計レポートの提案に使う)
_DEFAULT_CHANNELS_JSON = os.path.join(_HOME, "companion", "ytcheck", "tasks", "youtube-channels.json")
# feedback_report.py の置き場 (import 元)
_DEFAULT_TOOLS_DIR = os.path.join(_HOME, "companion", "ytcheck", "python", "youtube_checker", "tools")

VIEWING_DIR = os.environ.get("REMOTE_YTCHECK_VIEWING_DIR") or _DEFAULT_VIEWING_DIR
CHANNELS_JSON = os.environ.get("REMOTE_YTCHECK_CHANNELS_JSON") or _DEFAULT_CHANNELS_JSON
_TOOLS_DIR = os.environ.get("REMOTE_YTCHECK_TOOLS_DIR") or _DEFAULT_TOOLS_DIR

# append (insert 0 でなく): server/ 直下のモジュール解決を tools/ 配下に奪わせない。
if _TOOLS_DIR not in sys.path:
    sys.path.append(_TOOLS_DIR)
import feedback_report  # noqa: E402  (stdlib のみ・config 非依存、ytcheck venv 不要)

# ytcheck と共有するロックファイル名 (output_formatter.update_viewing_history と同名)
LOCK_NAME = ".viewing.lock"
# 受理する feedback 値。空文字は取り消し (欄を空に戻す)。
FEEDBACKS = ("○", "×", "")

_MONTH_RE = re.compile(r"\d{4}-\d{2}")
# video_id の長さ上限 (YouTube 実 ID は 11 文字。行照合前の入力 cap、app.py が検証に使う)
MAX_VIDEO_ID = 100


class YtcheckError(ValueError):
    """該当 video_id 行なし / ファイルなし。API は 404 に写像する (入力検証は app.py 側で 400)。"""


def valid_month(month):
    """month が YYYY-MM 形式か (パス組み立てに使うため fullmatch 必須 = traversal 防止)。"""
    return isinstance(month, str) and _MONTH_RE.fullmatch(month) is not None


def current_month():
    return datetime.now().strftime("%Y-%m")


def _viewing_path(month):
    """検証済み month からのみ組み立てる (ユーザー入力を直接パスに入れない)。"""
    if not valid_month(month):
        raise YtcheckError("invalid month")
    return os.path.join(VIEWING_DIR, "viewing-%s.md" % month)


@contextlib.contextmanager
def _locked():
    """viewing ディレクトリ直下の共有ロックを flock(LOCK_EX)。RMW 全体を囲む。

    ytcheck の update_viewing_history() が同じロックを取る (cross-process の一線)。
    """
    fd = os.open(os.path.join(VIEWING_DIR, LOCK_NAME), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _title_of(line):
    """動画行からタイトルを抽出 (チェックボックス直後〜最初の [video_id: の手前)。"""
    id_match = feedback_report._VIDEO_ID_RE.search(line)
    head = line[:id_match.start()] if id_match else line
    box_match = feedback_report._LINE_RE.match(head)
    return head[box_match.end():].strip() if box_match else head.strip()


def _entry_dict(e):
    """feedback_report.ViewingEntry → API 応答の dict (title は行から抽出)。"""
    return {
        "channel": e.channel,
        "video_id": e.video_id,
        "title": _title_of(e.line),
        "score": e.score,
        "checked": e.checked,
        "feedback": e.feedback,
    }


def get_month(month):
    """対象月の集計レポート + 動画エントリ一覧。ファイル不在は entries 空 (report は集計 0)。"""
    path = _viewing_path(month)
    report = feedback_report.build_report(
        month, tasks_dir=Path(VIEWING_DIR), channel_list_path=Path(CHANNELS_JSON))
    entries = []
    try:
        with open(path, "r", encoding="utf-8") as f:  # read 専用
            text = f.read()
    except OSError:
        text = ""
    for e in feedback_report.parse_viewing_text(text):
        entries.append(_entry_dict(e))
    return {"month": month, "report": report, "entries": entries}


def set_feedback(month, video_id, checked=None, feedback=None):
    """該当 video_id 行の `[ ]`/`[x]` と `[feedback: ...]` を書き換え、更新後 entry を返す。

    入力検証 (month 形式 / video_id 型 / feedback 値 / checked 型) は app.py が先に確定する。
    ここで残る失敗は「ファイルなし / 該当行なし」= YtcheckError (404) のみ。
    書き換えは flock 下の read→行書き換え→write で 1 回確定する。
    """
    path = _viewing_path(month)
    if not os.path.isfile(path):
        raise YtcheckError("not found")
    with _locked():
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        lines = text.splitlines()
        idx = _find_line(lines, video_id)
        if idx is None:
            raise YtcheckError("not found")
        lines[idx] = _rewrite_line(lines[idx], checked=checked, feedback=feedback)
        out = "\n".join(lines)
        if text.endswith("\n"):
            out += "\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
    # 更新後 entry を返す (channel はセクション見出しから引き直す)
    for e in feedback_report.parse_viewing_text("\n".join(lines)):
        if e.video_id == video_id:
            return _entry_dict(e)
    # ここには来ない (直前に書き換えた行が必ずパースされる) が、契約上の保険
    raise YtcheckError("not found")


def _find_line(lines, video_id):
    """video_id に一致する動画行の index。video_id は必ず escape して既存行と照合する。"""
    id_re = re.compile(r"\[video_id:\s*" + re.escape(video_id) + r"\s*\]")
    for i, line in enumerate(lines):
        if feedback_report._LINE_RE.match(line) and id_re.search(line):
            return i
    return None


def _rewrite_line(line, checked=None, feedback=None):
    """動画行 1 本のチェックボックス / feedback 欄を書き換える (None は不変)。"""
    if checked is not None:
        box = "- [x] " if checked else "- [ ] "
        line = feedback_report._LINE_RE.sub(box, line, count=1)
    if feedback is not None:
        # 行末の [feedback: ...] を置換。欄の無い過去月フォーマットの行は末尾に付加する。
        repl = "[feedback: %s]" % feedback
        if feedback_report._FEEDBACK_RE.search(line):
            line = feedback_report._FEEDBACK_RE.sub(repl, line)
        else:
            line = line.rstrip() + " " + repl
    return line
