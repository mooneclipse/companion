#!/usr/bin/env python3
"""read-only .md ストアの共通コア(root をパラメータ化)。

vault(既存ノート)と mimicry(小説ワークスペース)は同じ security-critical な path 検証
(realpath + commonpath で境界を1回確定)を必要とする。ここを2箇所に複製すると、将来の
境界修正で片方だけ直して片方忘れる欠陥に直結するため、判定ロジックはこのモジュールに
1本化する(~/companion/CLAUDE.md 設計上限ルール準拠)。呼び出し側(vault.py/mimicry.py)は
root(自分の realpath 済み canonical root)を固定して各関数へ渡す薄いラッパーに徹する。

境界判定の方針(旧 vault.py から踏襲):
  (1) root は呼び出し側で realpath 正規化済み(symlink 解決)の1つに固定。
  (2) 要求 path を root と join → realpath → root の realpath 配下にあること +
      (.md 系関数は)拡張子が .md であること を検証してから open。外れたら例外。
  (3) open は read 専用("r"/"rb")。書き込み・削除・mkdir は一切しない。

除外: ドットディレクトリ全般(.obsidian / .git / .claude 等)を walk から落とす。
列挙対象は .md のみ。markdown→HTML 変換はここでは行わない(呼び出し側/クライアントの責務)。
"""
import os

MD_EXT = ".md"
SNIPPET_RADIUS = 40  # 検索ヒット箇所の前後文字数
SEARCH_MAX_RESULTS = 100  # 結果上限(列挙コスト/レスポンスサイズの頭打ち)

# ノート本文に埋め込まれたローカル画像を read 専用で配信するための拡張子→content-type
# 写像。任意ファイル読み出しを画像種に限定する allowlist。
IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


class NoteError(Exception):
    """path 検証失敗 / 範囲外。呼び出し側 API がこれを 400/403/404 に写像する。"""


def iter_md_files(root):
    """root 配下の .md を (相対パス, 絶対パス) で列挙。ドットディレクトリは除外。"""
    for dirpath, dirnames, filenames in os.walk(root):
        # in-place で書き換えると os.walk がその下に降りない(.obsidian/.git/.claude を落とす)。
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.endswith(MD_EXT):
                continue
            abspath = os.path.join(dirpath, name)
            rel = os.path.relpath(abspath, root)
            yield rel, abspath


def resolve_in_root(root, rel_path):
    """要求 path を root 配下の安全な絶対パスに解決(拡張子は問わない)。

    realpath で symlink/`..` を畳んでから root の realpath 配下にあることを照合する
    (prefix 文字列一致でなく os.path.commonpath で境界を厳密判定。`<root>-evil` のような
    prefix 共有兄弟ディレクトリの誤判定を回避)。範囲・traversal・symlink 脱出を
    realpath/commonpath で1回確定する(条件分岐を積まない)。拡張子の許否は呼び出し側が決める。
    """
    if not isinstance(rel_path, str) or not rel_path:
        raise NoteError("path required")
    if rel_path.startswith("/") or "\x00" in rel_path:
        raise NoteError("invalid path")
    candidate = os.path.realpath(os.path.join(root, rel_path))
    if candidate != root and os.path.commonpath([root, candidate]) != root:
        raise NoteError("path outside root")
    return candidate


def safe_abspath(root, rel_path):
    """要求 path を root 配下の安全な .md 絶対パスに解決。外れたら NoteError。"""
    candidate = resolve_in_root(root, rel_path)
    if not candidate.endswith(MD_EXT):
        raise NoteError("not a markdown file")
    return candidate


def list_notes(root, title_fn=None):
    """root 配下の全 .md をフォルダ別にグルーピングして返す。

    返り値: {"root": <str>, "count": int, "folders": [
      {"folder": "<rel dir or ''>", "notes": [{"path": rel, "name": <表示名>, "mtime": int}, ...]}, ...]}
    folder はルート直下を "" とし、それ以外は POSIX 区切りの相対ディレクトリ。
    表示名は既定でファイル名幹(拡張子抜き)。title_fn(rel_posix, abspath, stem) を渡すと
    ファイルごとに表示名を差し替えられる(呼び出し側固有のタイトル抽出、例: 本文先頭見出し)。
    """
    groups = {}
    for rel, abspath in iter_md_files(root):
        rel_posix = rel.replace(os.sep, "/")
        folder = os.path.dirname(rel_posix)  # ルート直下は ""
        name = os.path.basename(rel_posix)
        stem = name[: -len(MD_EXT)]
        try:
            mtime = int(os.stat(abspath).st_mtime)
        except OSError:
            mtime = 0
        title = title_fn(rel_posix, abspath, stem) if title_fn else stem
        groups.setdefault(folder, []).append({"path": rel_posix, "name": title, "mtime": mtime})
    folders = []
    count = 0
    for folder in sorted(groups):
        notes = sorted(groups[folder], key=lambda n: n["name"].lower())
        count += len(notes)
        folders.append({"folder": folder, "notes": notes})
    return {"root": root, "count": count, "folders": folders}


def get_note(root, rel_path):
    """検証済み .md 1ファイルの生 markdown を返す。範囲外/不在は NoteError。"""
    abspath = safe_abspath(root, rel_path)
    try:
        with open(abspath, "r", encoding="utf-8") as f:  # read 専用(書き込みモード厳禁)
            content = f.read()
    except OSError:
        raise NoteError("not found")
    return {"path": rel_path.replace(os.sep, "/"), "content": content}


def search(root, query, title_fn=None):
    """全 .md 横断の単純部分一致検索(ファイル名 + 本文、大小無視)。

    返り値: {"query": q, "count": int, "results": [
      {"path", "name", "snippet"}, ...]}(SEARCH_MAX_RESULTS で打ち切り)。
    本文ヒットは最初の出現箇所の前後を snippet に、ファイル名のみヒットは snippet 空。
    表示名は既定でファイル名幹。title_fn(rel_posix, content, stem) を渡すと差し替えられる
    (list_notes の title_fn と違い、既に読み込み済みの content を渡せるので追加 I/O は無い)。
    """
    if not isinstance(query, str):
        query = ""
    q = query.strip()
    results = []
    if not q:
        return {"query": q, "count": 0, "results": results}
    needle = q.lower()
    for rel, abspath in iter_md_files(root):
        rel_posix = rel.replace(os.sep, "/")
        stem = os.path.basename(rel_posix)[: -len(MD_EXT)]
        try:
            with open(abspath, "r", encoding="utf-8") as f:
                content = f.read()
        except OSError:
            continue
        name = title_fn(rel_posix, content, stem) if title_fn else stem
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


def get_image(root, rel_path):
    """ノート本文に埋め込まれたローカル画像1枚を read 専用で返す。範囲外/不在は NoteError。

    .md と同じ realpath/commonpath で境界を1回確定し、拡張子は IMAGE_TYPES allowlist に
    限定する(任意ファイル読み出しを画像種に絞る)。返り値: {"bytes": <bytes>, "content_type"}。
    open は "rb" の read のみ(書き込み・削除・mkdir なし)。
    """
    candidate = resolve_in_root(root, rel_path)
    ext = os.path.splitext(candidate)[1].lower()
    content_type = IMAGE_TYPES.get(ext)
    if content_type is None:
        raise NoteError("not an image file")
    try:
        with open(candidate, "rb") as f:  # read 専用(書き込みモード厳禁)
            data = f.read()
    except OSError:
        raise NoteError("not found")
    return {"bytes": data, "content_type": content_type}
