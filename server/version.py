#!/usr/bin/env python3
"""companion-remote バージョン解決 — デプロイ中の git short hash + コミット日を確定する。

ビルド工程を持たない(vendored 資産 + stdlib http.server)プロジェクトのため、
版は git の HEAD から起動時に1回だけ読む。OWNER が「今スマホに乗っているのが
最新か」を一目で確認するための表示用途で、`GET /api/version` が返す。

設計上限ルール(~/companion/CLAUDE.md)準拠:
 - git 呼び出しの成否は1回で確定する。失敗時は "unknown" にフォールバックし、
   リトライ/stderr 文言マッチ/分岐の積み増しはしない。
 - 文字列生成は git に依存しない純関数 format_version に切り出してテスト可能にする。
"""
import os
import subprocess

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
UNKNOWN = "unknown"


def format_version(short_hash, date):
    """git の short hash とコミット日から表示用バージョン文字列を作る純関数。

    両方そろえば "<hash> (<date>)"、hash だけなら "<hash>"、hash が無ければ
    "unknown"。前後空白は落とす(subprocess 出力の改行対策)。
    """
    h = (short_hash or "").strip()
    d = (date or "").strip()
    if not h:
        return UNKNOWN
    return "{} ({})".format(h, d) if d else h


def _git(args):
    """git を1回実行し stdout を返す。失敗(git 不在/非 repo/非ゼロ終了)は None。"""
    try:
        out = subprocess.run(
            ["git", "-C", REPO_ROOT, *args],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def resolve():
    """HEAD の short hash + コミット日から版文字列を確定する(起動時に1回呼ぶ)。"""
    return format_version(_git(["rev-parse", "--short", "HEAD"]), _git(["show", "-s", "--format=%cs", "HEAD"]))


# 起動時に1回だけ確定。以降のリクエストはこの定数を返す(再実行しない)。
APP_VERSION = resolve()
