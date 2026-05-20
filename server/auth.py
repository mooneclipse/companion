#!/usr/bin/env python3
"""companion-remote 認証 — トークン発行 CLI + Bearer 検証。

設計: ~/companion/workspace/redesign/remote-design.md §2.3。
- `secrets.token_urlsafe(32)` を発行(print-once)、SHA-256 ダイジェストのみ
  `.state/tokens.json`(0o600)に保存する。平文トークンはディスクに残さない
  (ファイル流出時に使えるトークンが漏れない)。
- 検証は提示トークンの SHA-256 を `secrets.compare_digest` で定数時間比較。
- 失効 = SSH で tokens.json を空配列に(UI 経由の失効 endpoint は循環参照で作らない、N-3)。

CLI:
  python3 auth.py issue [label]   # 新規トークン発行(stdout に1回だけ表示)
  python3 auth.py list            # 発行済みトークンの label/作成日(ハッシュ・平文は出さない)
  python3 auth.py revoke-all      # 全失効(tokens.json を空に)
"""
import hashlib
import json
import os
import secrets
import sys
import time

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".state")
TOKENS_PATH = os.path.join(STATE_DIR, "tokens.json")


def _digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load():
    try:
        with open(TOKENS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save(entries):
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    fd = os.open(TOKENS_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    os.chmod(TOKENS_PATH, 0o600)


def _valid_digests():
    return [e["hash"] for e in _load() if isinstance(e, dict) and "hash" in e]


def verify(token):
    """提示された Bearer トークンが有効なら True(定数時間比較)。"""
    if not token:
        return False
    presented = _digest(token)
    # any() は最初の一致で短絡するが、比較対象はハッシュなのでトークン値は漏れない
    return any(secrets.compare_digest(presented, h) for h in _valid_digests())


def _issue(label):
    token = secrets.token_urlsafe(32)
    entries = _load()
    entries.append({"label": label or "remote", "hash": _digest(token), "created": int(time.time())})
    _save(entries)
    print(token)  # print-once: stdout に平文を1回だけ
    sys.stderr.write(
        "上のトークンを PWA に paste してください。再表示されません(紛失時は再発行)。\n"
    )


def _list():
    entries = _load()
    if not entries:
        sys.stderr.write("(発行済みトークンなし)\n")
        return
    for e in entries:
        if not isinstance(e, dict):
            continue
        created = time.strftime("%Y-%m-%d %H:%M", time.localtime(e.get("created", 0)))
        print("%s\t%s" % (e.get("label", "?"), created))


def _revoke_all():
    _save([])
    sys.stderr.write("全トークンを失効しました(tokens.json を空に)。\n")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "issue":
        _issue(argv[2] if len(argv) > 2 else None)
    elif cmd == "list":
        _list()
    elif cmd == "revoke-all":
        _revoke_all()
    else:
        sys.stderr.write(__doc__.split("CLI:", 1)[-1])
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
