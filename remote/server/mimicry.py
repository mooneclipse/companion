#!/usr/bin/env python3
"""companion-remote F-mimicry — 出先からスマホで小説ワークスペース(~/around-mimicry)を
閲覧する read-only データ層。

path 検証(realpath + commonpath の境界判定)は F-vault と共有のため notestore.py に
1本化済み(~/companion/CLAUDE.md 設計上限ルール: security-critical な判定を複製しない)。
本ファイルは MIMICRY_ROOT を固定した薄いラッパー + 小説向けタイトル抽出のみを持つ。

MIMICRY_ROOT は環境変数 REMOTE_MIMICRY_ROOT で上書き可(既定 ~/around-mimicry)。
vault(companion モノレポの兄弟プロジェクト)と違い、around-mimicry は `~/` 直下の
別 repo なので __file__ からの相対計算は使わず expanduser で解決する。
"""
import os
import re

import notestore

_DEFAULT_ROOT = os.path.expanduser("~/around-mimicry")
MIMICRY_ROOT = os.path.realpath(os.environ.get("REMOTE_MIMICRY_ROOT") or _DEFAULT_ROOT)

MimicryError = notestore.NoteError

_FRONTMATTER_RE = re.compile(r"^---\n.*?\n---\n?", re.S)
_HEADING_RE = re.compile(r"^#\s+(.+)$", re.M)


def _title_from_text(text, stem):
    """frontmatter を落としてから最初の `# 見出し` をタイトルに採る。無ければファイル名幹。

    ファイル名は `sN-{slug}.md`(CLAUDE.md 命名規則)で季節 prefix が付くため、そのまま
    一覧・本文ヘッダに出すと "s1-宛先" のような二重表示になる。本文先頭の見出しの方が
    人間向けの正式タイトルなので、それを優先する。
    """
    body = _FRONTMATTER_RE.sub("", text, count=1)
    m = _HEADING_RE.search(body)
    return m.group(1).strip() if m else stem


def _title_for_list(rel_path, abspath, stem):
    try:
        with open(abspath, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return stem
    return _title_from_text(text, stem)


def _title_for_search(rel_path, content, stem):
    return _title_from_text(content, stem)


def list_notes():
    """around-mimicry 配下の全 .md をフォルダ別にグルーピングして返す(表示名は本文見出し)。"""
    return notestore.list_notes(MIMICRY_ROOT, title_fn=_title_for_list)


def get_note(rel_path):
    """検証済み .md 1ファイルの生 markdown を返す。範囲外/不在は MimicryError。"""
    return notestore.get_note(MIMICRY_ROOT, rel_path)


def search(query):
    """全 .md 横断の単純部分一致検索(ファイル名 + 本文、大小無視。表示名は本文見出し)。"""
    return notestore.search(MIMICRY_ROOT, query, title_fn=_title_for_search)
