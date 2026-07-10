"""channel_store のテスト（#69: flock 排他 + 1ch 単位 CRUD + merge 書き戻し）"""
import fcntl
import json
import os
import subprocess
import threading
from pathlib import Path

import pytest

import channel_store


def _make_store(tmp_path: Path) -> Path:
    """テスト用の youtube-channels.json を tmp_path に作る"""
    data = {
        "updated": "2026-04-26",
        "genres": {"indie": "個人勢"},
        "channels": [
            {
                "name": "チャンネルA",
                "channel_id": "UC_aaa",
                "check_days": 3,
                "genre": "indie",
                "favorite": 4,
                "note": "",
                "subscriber_count": 1000,
                "subscriber_count_updated_at": "2026-07-01T00:00:00Z",
            },
            {
                "name": "チャンネルB",
                "channel_id": "UC_bbb",
                "check_days": 4,
                "genre": "indie",
                "favorite": 3,
                "note": "",
                "subscriber_count": 2000,
                "subscriber_count_updated_at": "2026-07-01T00:00:00Z",
            },
        ],
    }
    path = tmp_path / "youtube-channels.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


class TestLoadGet:
    def test_load_returns_whole_data(self, tmp_path: Path):
        path = _make_store(tmp_path)
        data = channel_store.load(path)
        assert data["genres"] == {"indie": "個人勢"}
        assert len(data["channels"]) == 2

    def test_get_channel_found(self, tmp_path: Path):
        path = _make_store(tmp_path)
        ch = channel_store.get_channel("UC_bbb", path)
        assert ch is not None
        assert ch["name"] == "チャンネルB"

    def test_get_channel_missing_returns_none(self, tmp_path: Path):
        path = _make_store(tmp_path)
        assert channel_store.get_channel("UC_zzz", path) is None


class TestAddChannel:
    def test_add_persists_and_keeps_top_level(self, tmp_path: Path):
        path = _make_store(tmp_path)
        entry = {"name": "チャンネルC", "channel_id": "UC_ccc", "favorite": 5}
        channel_store.add_channel(entry, path=path, commit=False)
        data = json.loads(path.read_text(encoding="utf-8"))
        assert [c["channel_id"] for c in data["channels"]] == ["UC_aaa", "UC_bbb", "UC_ccc"]
        # トップレベルキー (genres / updated) が保持される
        assert data["genres"] == {"indie": "個人勢"}
        assert data["updated"] == "2026-04-26"

    def test_add_duplicate_raises(self, tmp_path: Path):
        path = _make_store(tmp_path)
        with pytest.raises(ValueError, match="重複"):
            channel_store.add_channel(
                {"name": "重複", "channel_id": "UC_aaa"}, path=path, commit=False
            )

    def test_add_without_channel_id_raises(self, tmp_path: Path):
        path = _make_store(tmp_path)
        with pytest.raises(ValueError, match="必須"):
            channel_store.add_channel({"name": "IDなし"}, path=path, commit=False)


class TestUpdateChannel:
    def test_update_merges_fields_only_for_target(self, tmp_path: Path):
        path = _make_store(tmp_path)
        updated = channel_store.update_channel(
            "UC_aaa", {"favorite": 5, "note": "推し"}, path=path, commit=False
        )
        assert updated["favorite"] == 5
        data = json.loads(path.read_text(encoding="utf-8"))
        ch_a = data["channels"][0]
        ch_b = data["channels"][1]
        assert ch_a["favorite"] == 5 and ch_a["note"] == "推し"
        assert ch_a["check_days"] == 3  # 未指定フィールドは保持
        assert ch_b["favorite"] == 3  # 他 entry は不変

    def test_update_missing_raises_keyerror(self, tmp_path: Path):
        path = _make_store(tmp_path)
        with pytest.raises(KeyError):
            channel_store.update_channel("UC_zzz", {"favorite": 1}, path=path, commit=False)

    def test_update_channel_id_is_immutable(self, tmp_path: Path):
        path = _make_store(tmp_path)
        with pytest.raises(ValueError, match="書き換え不可"):
            channel_store.update_channel(
                "UC_aaa", {"channel_id": "UC_new"}, path=path, commit=False
            )

    def test_update_with_same_values_skips_write(self, tmp_path: Path):
        path = _make_store(tmp_path)
        before = path.stat().st_mtime_ns
        channel_store.update_channel("UC_aaa", {"favorite": 4}, path=path, commit=False)
        assert path.stat().st_mtime_ns == before


class TestRemoveChannel:
    def test_remove_deletes_and_returns_entry(self, tmp_path: Path):
        path = _make_store(tmp_path)
        removed = channel_store.remove_channel("UC_aaa", path=path, commit=False)
        assert removed["name"] == "チャンネルA"
        data = json.loads(path.read_text(encoding="utf-8"))
        assert [c["channel_id"] for c in data["channels"]] == ["UC_bbb"]

    def test_remove_missing_raises_keyerror(self, tmp_path: Path):
        path = _make_store(tmp_path)
        with pytest.raises(KeyError):
            channel_store.remove_channel("UC_zzz", path=path, commit=False)


class TestMergeSubscriberCounts:
    def test_merge_updates_only_two_fields(self, tmp_path: Path):
        path = _make_store(tmp_path)
        merged = channel_store.merge_subscriber_counts(
            {"UC_aaa": 1500}, "2026-07-07T00:00:00Z", path=path, commit=False
        )
        assert merged == 1
        data = json.loads(path.read_text(encoding="utf-8"))
        ch_a = data["channels"][0]
        assert ch_a["subscriber_count"] == 1500
        assert ch_a["subscriber_count_updated_at"] == "2026-07-07T00:00:00Z"
        assert ch_a["favorite"] == 4  # 他フィールドは不変
        assert data["channels"][1]["subscriber_count"] == 2000  # 対象外は不変

    def test_merge_preserves_concurrent_edits(self, tmp_path: Path):
        """load 後に他プロセスが行った追加・編集を書き戻しが消さない (lost update 防止)"""
        path = _make_store(tmp_path)
        # 巡回プロセスが load した後を模擬: 別プロセスがチャンネル追加 + favorite 編集
        channel_store.add_channel(
            {"name": "追加チャンネル", "channel_id": "UC_new"}, path=path, commit=False
        )
        channel_store.update_channel("UC_bbb", {"favorite": 1}, path=path, commit=False)
        # 巡回プロセスの書き戻し (load 時点の counts のみ持っている)
        channel_store.merge_subscriber_counts(
            {"UC_aaa": 1500}, "2026-07-07T00:00:00Z", path=path, commit=False
        )
        data = json.loads(path.read_text(encoding="utf-8"))
        ids = [c["channel_id"] for c in data["channels"]]
        assert "UC_new" in ids  # 追加が生き残る
        ch_b = next(c for c in data["channels"] if c["channel_id"] == "UC_bbb")
        assert ch_b["favorite"] == 1  # 編集が生き残る

    def test_merge_ignores_unknown_channel_id(self, tmp_path: Path):
        path = _make_store(tmp_path)
        merged = channel_store.merge_subscriber_counts(
            {"UC_deleted": 9999}, "2026-07-07T00:00:00Z", path=path, commit=False
        )
        assert merged == 0

    def test_merge_no_change_skips_write(self, tmp_path: Path):
        path = _make_store(tmp_path)
        merged = channel_store.merge_subscriber_counts(
            {"UC_aaa": 1000}, "2026-07-01T00:00:00Z", path=path, commit=False
        )
        assert merged == 0
        # 変更ゼロなら書かない
        before = path.stat().st_mtime_ns
        channel_store.merge_subscriber_counts(
            {"UC_aaa": 1000}, "2026-07-01T00:00:00Z", path=path, commit=False
        )
        assert path.stat().st_mtime_ns == before


class TestAtomicWriteAndLock:
    def test_no_tmp_file_left_behind(self, tmp_path: Path):
        path = _make_store(tmp_path)
        channel_store.update_channel("UC_aaa", {"favorite": 5}, path=path, commit=False)
        assert not (tmp_path / "youtube-channels.json.tmp").exists()

    def test_lock_blocks_second_acquirer(self, tmp_path: Path):
        """ロック保持中は別 fd の flock(LOCK_NB) が失敗する"""
        path = _make_store(tmp_path)
        acquired_inside = {}

        def try_lock_nonblocking():
            fd = os.open(tmp_path / ".channels.lock", os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired_inside["ok"] = True
                fcntl.flock(fd, fcntl.LOCK_UN)
            except BlockingIOError:
                acquired_inside["ok"] = False
            finally:
                os.close(fd)

        with channel_store._locked(path):
            t = threading.Thread(target=try_lock_nonblocking)
            t.start()
            t.join(timeout=5)
        assert acquired_inside["ok"] is False
        # 解放後は取れる
        t2 = threading.Thread(target=try_lock_nonblocking)
        t2.start()
        t2.join(timeout=5)
        assert acquired_inside["ok"] is True


class TestGitAutoCommit:
    def _init_repo(self, tmp_path: Path) -> None:
        for cmd in (
            ["git", "init", "-q"],
            ["git", "config", "user.email", "test@example.com"],
            ["git", "config", "user.name", "test"],
        ):
            subprocess.run(cmd, cwd=tmp_path, check=True, capture_output=True)

    def test_write_creates_commit(self, tmp_path: Path):
        self._init_repo(tmp_path)
        path = _make_store(tmp_path)
        subprocess.run(
            ["git", "add", "-A"], cwd=tmp_path, check=True, capture_output=True
        )
        subprocess.run(
            ["git", "commit", "-q", "-m", "init"], cwd=tmp_path, check=True, capture_output=True
        )
        channel_store.merge_subscriber_counts(
            {"UC_aaa": 1500}, "2026-07-07T00:00:00Z", path=path, commit=True
        )
        log = subprocess.run(
            ["git", "log", "--oneline"], cwd=tmp_path, check=True,
            capture_output=True, text=True,
        ).stdout
        assert "登録者数キャッシュ自動書き戻し (1 件)" in log

    def test_commit_failure_does_not_break_write(self, tmp_path: Path):
        """repo 外 (git init なし) でも書き込み自体は成功する"""
        path = _make_store(tmp_path)
        updated = channel_store.update_channel(
            "UC_aaa", {"favorite": 5}, path=path, commit=True
        )
        assert updated["favorite"] == 5
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["channels"][0]["favorite"] == 5
