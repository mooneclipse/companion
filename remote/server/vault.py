#!/usr/bin/env python3
"""companion-remote F-vault — 出先からスマホで vault を閲覧する read-only データ層。

owner 専用・tailnet 内のみだが、`get` の path は任意ファイル読み出しの穴に直結する。
path 検証(realpath + commonpath の境界判定)は F-mimicry と共有の security-critical
ロジックのため notestore.py に1本化済み(~/companion/CLAUDE.md 設計上限ルール: 同種の
境界判定を複製しない)。本ファイルは VAULT_ROOT を固定した薄いラッパーのみを持つ。

VAULT_ROOT は環境変数 REMOTE_VAULT_ROOT で上書き可(既定 ~/companion/vault)。
"""
import os

import notestore

# 既定は兄弟 vault/ プロジェクト。.env / EnvironmentFile で REMOTE_VAULT_ROOT 上書き可。
_DEFAULT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "vault")
VAULT_ROOT = os.path.realpath(os.environ.get("REMOTE_VAULT_ROOT") or _DEFAULT_ROOT)

VaultError = notestore.NoteError


def list_notes():
    """vault 配下の全 .md をフォルダ別にグルーピングして返す(表示名はファイル名幹)。"""
    return notestore.list_notes(VAULT_ROOT)


def get_note(rel_path):
    """検証済み .md 1ファイルの生 markdown を返す。範囲外/不在は VaultError。"""
    return notestore.get_note(VAULT_ROOT, rel_path)


def search(query):
    """全 .md 横断の単純部分一致検索(ファイル名 + 本文、大小無視)。"""
    return notestore.search(VAULT_ROOT, query)


def get_image(rel_path):
    """ノート本文に埋め込まれたローカル画像1枚を read 専用で返す。範囲外/不在は VaultError。"""
    return notestore.get_image(VAULT_ROOT, rel_path)
