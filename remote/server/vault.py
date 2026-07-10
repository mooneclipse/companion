#!/usr/bin/env python3
"""companion-remote F-vault — 出先からスマホで vault を閲覧する read-only データ層。

owner 専用・tailnet 内のみだが、`get` の path は任意ファイル読み出しの穴に直結する
ため urlguard と同じ厳密さで境界を1回で確定する(条件分岐を積まない。~/companion/
CLAUDE.md 設計上限ルール準拠):

  (1) VAULT_ROOT を realpath で正規化(symlink 解決)して canonical root を1つ固定。
  (2) 要求 path を root と join → realpath → root の realpath 配下にあること +
      拡張子が .md であること を検証してから open。外れたら例外 → API は 403。
  (3) open は read("r") のみ。書き込み・削除・mkdir は一切しない(read 専用)。

除外: ドットディレクトリ全般(.obsidian / .git / .claude 等)を walk から落とす。
列挙対象は .md のみ。markdown→HTML 変換はサーバでやらない(stdlib 縛り、描画は
クライアント側 marked + DOMPurify)。本モジュールは生 markdown を返すだけ。

VAULT_ROOT は環境変数 REMOTE_VAULT_ROOT で上書き可(既定 ~/companion/vault)。
"""
import os

# 既定は兄弟 vault/ プロジェクト。.env / EnvironmentFile で REMOTE_VAULT_ROOT 上書き可。
_DEFAULT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "vault")
VAULT_ROOT = os.path.realpath(os.environ.get("REMOTE_VAULT_ROOT") or _DEFAULT_ROOT)

MD_EXT = ".md"
SNIPPET_RADIUS = 40  # 検索ヒット箇所の前後文字数
SEARCH_MAX_RESULTS = 100  # 結果上限(列挙コスト/レスポンスサイズの頭打ち)

# ノート本文に埋め込まれたローカル画像(Obsidian ![[name.jpg]])を read 専用で配信するための
# 拡張子→content-type 写像。任意ファイル読み出しを画像種に限定する allowlist。
IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


class VaultError(Exception):
    """path 検証失敗 / 範囲外。API は 400/403 に写像する。"""


def _iter_md_files():
    """VAULT_ROOT 配下の .md を (相対パス, 絶対パス) で列挙。ドットディレクトリは除外。"""
    for dirpath, dirnames, filenames in os.walk(VAULT_ROOT):
        # in-place で書き換えると os.walk がその下に降りない(.obsidian/.git/.claude を落とす)。
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.endswith(MD_EXT):
                continue
            abspath = os.path.join(dirpath, name)
            rel = os.path.relpath(abspath, VAULT_ROOT)
            yield rel, abspath


def _resolve_in_vault(rel_path):
    """要求 path を VAULT_ROOT 配下の安全な絶対パスに解決(拡張子は問わない)。

    realpath で symlink/`..` を畳んでから root の realpath 配下にあることを照合する
    (prefix 文字列一致でなく os.path.commonpath で境界を厳密判定。`vault-evil` 誤判定回避)。
    範囲・traversal・symlink 脱出を realpath/commonpath で1回確定する(条件分岐を積まない。
    ~/companion/CLAUDE.md 設計上限ルール準拠)。拡張子の許否は呼び出し側が決める。
    """
    if not isinstance(rel_path, str) or not rel_path:
        raise VaultError("path required")
    if rel_path.startswith("/") or "\x00" in rel_path:
        raise VaultError("invalid path")
    candidate = os.path.realpath(os.path.join(VAULT_ROOT, rel_path))
    # root 自身か、root 配下にあること(commonpath で prefix 偽装 vault-evil を弾く)。
    if candidate != VAULT_ROOT and os.path.commonpath([VAULT_ROOT, candidate]) != VAULT_ROOT:
        raise VaultError("path outside vault")
    return candidate


def _safe_abspath(rel_path):
    """要求 path を VAULT_ROOT 配下の安全な .md 絶対パスに解決。外れたら VaultError。"""
    candidate = _resolve_in_vault(rel_path)
    if not candidate.endswith(MD_EXT):
        raise VaultError("not a markdown file")
    return candidate


def list_notes():
    """vault 配下の全 .md をフォルダ別にグルーピングして返す。

    返り値: {"root": <str>, "count": int, "folders": [
      {"folder": "<rel dir or ''>", "notes": [{"path": rel, "name": stem, "mtime": int}, ...]}, ...]}
    folder はルート直下を "" とし、それ以外は POSIX 区切りの相対ディレクトリ。
    """
    groups = {}
    for rel, abspath in _iter_md_files():
        rel_posix = rel.replace(os.sep, "/")
        folder = os.path.dirname(rel_posix)  # ルート直下は ""
        name = os.path.basename(rel_posix)
        stem = name[: -len(MD_EXT)]
        try:
            mtime = int(os.stat(abspath).st_mtime)
        except OSError:
            mtime = 0
        groups.setdefault(folder, []).append({"path": rel_posix, "name": stem, "mtime": mtime})
    folders = []
    count = 0
    for folder in sorted(groups):
        notes = sorted(groups[folder], key=lambda n: n["name"].lower())
        count += len(notes)
        folders.append({"folder": folder, "notes": notes})
    return {"root": VAULT_ROOT, "count": count, "folders": folders}


def get_note(rel_path):
    """検証済み .md 1ファイルの生 markdown を返す。範囲外/不在は VaultError。"""
    abspath = _safe_abspath(rel_path)
    try:
        with open(abspath, "r", encoding="utf-8") as f:  # read 専用(書き込みモード厳禁)
            content = f.read()
    except OSError:
        raise VaultError("not found")
    return {"path": rel_path.replace(os.sep, "/"), "content": content}


def search(query):
    """全 .md 横断の単純部分一致検索(ファイル名 + 本文、大小無視)。

    返り値: {"query": q, "count": int, "results": [
      {"path", "name", "snippet"}, ...]}(SEARCH_MAX_RESULTS で打ち切り)。
    本文ヒットは最初の出現箇所の前後を snippet に、ファイル名のみヒットは snippet 空。
    """
    if not isinstance(query, str):
        query = ""
    q = query.strip()
    results = []
    if not q:
        return {"query": q, "count": 0, "results": results}
    needle = q.lower()
    for rel, abspath in _iter_md_files():
        rel_posix = rel.replace(os.sep, "/")
        name = os.path.basename(rel_posix)[: -len(MD_EXT)]
        try:
            with open(abspath, "r", encoding="utf-8") as f:
                content = f.read()
        except OSError:
            continue
        lower = content.lower()
        idx = lower.find(needle)
        name_hit = needle in name.lower()
        if idx < 0 and not name_hit:
            continue
        snippet = ""
        if idx >= 0:
            start = max(0, idx - SNIPPET_RADIUS)
            end = min(len(content), idx + len(needle) + SNIPPET_RADIUS)
            snippet = ("…" if start > 0 else "") + content[start:end].replace("\n", " ") \
                + ("…" if end < len(content) else "")
        results.append({"path": rel_posix, "name": name, "snippet": snippet})
        if len(results) >= SEARCH_MAX_RESULTS:
            break
    results.sort(key=lambda r: r["name"].lower())
    return {"query": q, "count": len(results), "results": results}


def get_image(rel_path):
    """ノート本文に埋め込まれたローカル画像1枚を read 専用で返す。範囲外/不在は VaultError。

    .md と同じ realpath/commonpath で境界を1回確定し、拡張子は IMAGE_TYPES allowlist に
    限定する(任意ファイル読み出しを画像種に絞る)。返り値: {"bytes": <bytes>, "content_type"}。
    open は "rb" の read のみ(書き込み・削除・mkdir なし)。
    """
    candidate = _resolve_in_vault(rel_path)
    ext = os.path.splitext(candidate)[1].lower()
    content_type = IMAGE_TYPES.get(ext)
    if content_type is None:
        raise VaultError("not an image file")
    try:
        with open(candidate, "rb") as f:  # read 専用(書き込みモード厳禁)
            data = f.read()
    except OSError:
        raise VaultError("not found")
    return {"bytes": data, "content_type": content_type}
