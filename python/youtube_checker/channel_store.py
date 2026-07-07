"""
youtube-channels.json の cross-process 排他付き CRUD ストア（#69）

毎朝 05:00 巡回の subscriber_count 書き戻し（main._refresh_subscriber_cache）と
companion-remote の巡回チャンネル編集 API（#69 後段で接続予定）が同一 JSON を
書き換えるため、書き込みは全てここを経由する:

- tasks/ 直下の共有ロックファイル `.channels.lock` の flock(LOCK_EX) で
  read→modify→write 全体を排他（.viewing.lock と同パターン。blocking 取得・
  timeout リトライなし。競合は実質 05:00 の一瞬のみ）
- 書き込みは同ディレクトリ tmp + os.replace の atomic write
  （途中クラッシュで JSON が壊れると翌朝の巡回全体が落ちるため）
- 書き込み成功後に git 自動 commit（youtube-channels.json は repo 管理下。
  誤編集を 1 操作単位で rollback できるよう機械書き込みも commit する。
  2026-07-07 user 裁定、docs/STATUS.md 参照）。commit 失敗は warning のみで
  書き込み自体は成功扱い（リトライ・分岐なし）

注意: config.py には依存しない（stdlib のみ）。companion-remote が
sys.path append で直接 import する前提（feedback_report.py と同じ制約）。
関数の改名・移動時は remote 側の追随が必要。
"""
import fcntl
import json
import logging
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger(__name__)

# main.py と同じ導出（プロジェクトルート/tasks/youtube-channels.json）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_PATH = _PROJECT_ROOT / "tasks" / "youtube-channels.json"

_LOCK_FILENAME = ".channels.lock"

# channel_id は entry の主キー。update での書き換えは禁止する
_IMMUTABLE_FIELDS = frozenset({"channel_id"})


def _resolve(path: Path | None) -> Path:
    return Path(path) if path is not None else _DEFAULT_PATH


@contextmanager
def _locked(path: Path) -> Iterator[None]:
    """path と同ディレクトリの .channels.lock を flock(LOCK_EX) で保持する"""
    lock_fd = os.open(path.parent / _LOCK_FILENAME, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def _read(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _write_atomic(data: dict[str, Any], path: Path) -> None:
    """同ディレクトリ tmp に書いて os.replace（呼び出し元がロック保持前提）"""
    tmp = path.parent / (path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _git_commit(path: Path, message: str) -> None:
    """書き込み済み path を git add + commit する（呼び出し元がロック保持前提）。

    失敗（repo 外・hook 拒否・git 不在等）は warning ログのみで例外にしない。
    書き込み本体は既に成功しており、commit は rollback 用の記録に過ぎないため。
    """
    abs_path = str(path.resolve())
    workdir = str(path.parent)
    try:
        add = subprocess.run(
            ["git", "-C", workdir, "add", "--", abs_path],
            capture_output=True, text=True, timeout=30,
        )
        if add.returncode != 0:
            logger.warning(f"git add に失敗（書き込みは成功済み）: {add.stderr.strip()}")
            return
        commit = subprocess.run(
            ["git", "-C", workdir, "commit", "-m", message, "--", abs_path],
            capture_output=True, text=True, timeout=60,
        )
        if commit.returncode != 0:
            logger.warning(
                f"git commit に失敗（書き込みは成功済み）: {commit.stderr.strip() or commit.stdout.strip()}"
            )
    except (OSError, subprocess.SubprocessError) as e:
        logger.warning(f"git 自動 commit に失敗（書き込みは成功済み）: {e}")


def load(path: Path | None = None) -> dict[str, Any]:
    """JSON 全体（genres / channels を含む dict）を返す。

    書き込みが atomic write のためロックなしでも常に完全な内容が読める。
    """
    return _read(_resolve(path))


def get_channel(channel_id: str, path: Path | None = None) -> dict[str, Any] | None:
    """channel_id が一致する entry を返す（なければ None）"""
    for ch in load(path).get("channels", []):
        if ch.get("channel_id") == channel_id:
            return ch
    return None


def add_channel(
    entry: dict[str, Any],
    *,
    path: Path | None = None,
    commit: bool = True,
    message: str | None = None,
) -> dict[str, Any]:
    """チャンネルを 1 件追加する。channel_id 必須・既存と重複で ValueError"""
    channel_id = entry.get("channel_id")
    if not channel_id:
        raise ValueError("channel_id は必須です")
    target = _resolve(path)
    with _locked(target):
        data = _read(target)
        channels = data.setdefault("channels", [])
        if any(ch.get("channel_id") == channel_id for ch in channels):
            raise ValueError(f"channel_id が重複しています: {channel_id}")
        channels.append(dict(entry))
        _write_atomic(data, target)
        if commit:
            _git_commit(
                target, message or f"tasks: チャンネル追加 {entry.get('name', channel_id)}"
            )
    return dict(entry)


def update_channel(
    channel_id: str,
    fields: dict[str, Any],
    *,
    path: Path | None = None,
    commit: bool = True,
    message: str | None = None,
) -> dict[str, Any]:
    """channel_id が一致する entry に fields を上書き merge する。

    不在は KeyError。channel_id 自体の書き換えは ValueError。
    fields が現値と同一なら書き込み・commit ともスキップする。
    """
    banned = _IMMUTABLE_FIELDS & fields.keys()
    if banned:
        raise ValueError(f"書き換え不可のフィールドです: {sorted(banned)}")
    target = _resolve(path)
    with _locked(target):
        data = _read(target)
        for ch in data.get("channels", []):
            if ch.get("channel_id") == channel_id:
                old = dict(ch)
                ch.update(fields)
                if ch != old:
                    _write_atomic(data, target)
                    if commit:
                        _git_commit(
                            target,
                            message or f"tasks: チャンネル更新 {ch.get('name', channel_id)}",
                        )
                return dict(ch)
    raise KeyError(f"channel_id が見つかりません: {channel_id}")


def remove_channel(
    channel_id: str,
    *,
    path: Path | None = None,
    commit: bool = True,
    message: str | None = None,
) -> dict[str, Any]:
    """channel_id が一致する entry を削除して返す。不在は KeyError"""
    target = _resolve(path)
    with _locked(target):
        data = _read(target)
        channels = data.get("channels", [])
        for i, ch in enumerate(channels):
            if ch.get("channel_id") == channel_id:
                removed = channels.pop(i)
                _write_atomic(data, target)
                if commit:
                    _git_commit(
                        target,
                        message or f"tasks: チャンネル削除 {removed.get('name', channel_id)}",
                    )
                return removed
    raise KeyError(f"channel_id が見つかりません: {channel_id}")


def merge_subscriber_counts(
    counts: dict[str, int],
    updated_at: str,
    *,
    path: Path | None = None,
    commit: bool = True,
) -> int:
    """subscriber_count / subscriber_count_updated_at だけをロック下で merge する。

    05:00 巡回の書き戻し用。ロック下で JSON を読み直し、counts に channel_id が
    ある entry の 2 フィールドのみ更新する（load 後に他プロセスが行った
    追加・削除・編集を上書きで消さない = lost update 防止）。
    counts にあって JSON に無い channel_id は無視。実際に値が変わった件数を返し、
    変更ゼロなら書き込み・commit ともスキップする。
    """
    target = _resolve(path)
    with _locked(target):
        data = _read(target)
        changed = 0
        for ch in data.get("channels", []):
            ch_id = ch.get("channel_id")
            if ch_id not in counts:
                continue
            if (
                ch.get("subscriber_count") == counts[ch_id]
                and ch.get("subscriber_count_updated_at") == updated_at
            ):
                continue
            ch["subscriber_count"] = counts[ch_id]
            ch["subscriber_count_updated_at"] = updated_at
            changed += 1
        if changed:
            _write_atomic(data, target)
            if commit:
                _git_commit(target, f"tasks: 登録者数キャッシュ自動書き戻し ({changed} 件)")
    return changed
