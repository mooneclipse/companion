#!/usr/bin/env python3
"""Claude サービス稼働状況 (status.claude.com) をポーリングし、状態変化を
companion-bot の Unix socket 経由で #maintenance topic に通知する。

- 監視対象は実利用分のみ: claude.ai / Claude API / Claude Code (Console/Cowork/Gov は除外)。
- state ファイル (.state/claude-status.json) に前回状態を持ち、diff があるときだけ通知。
  条件分岐は state を持つ側を 1 回引いて確定する (CLAUDE.md 対症療法ルール)。
- 初回 (state なし) は通知せず baseline を記録するだけ (初回通知爆発の回避)。
- impact=major/critical の incident、または component の major_outage 悪化があれば
  本文先頭に CRITICAL_PREFIX を付け、bot 側で通知音を鳴らす (bot.py L1676)。
- 取得失敗 (curl 失敗 / JSON 不正) と socket 不在は state を据え置いて exit 0。
  次回 timer 発火で再取得する (リトライ loop を積まない / 成否判定は 1 回)。
- 送信失敗のみ exit 1 (state は据え置き)。

依存: curl (IPv4 強制でこの網の IPv6 100% loss を回避)。Python は標準ライブラリのみ。
"""

import json
import os
import socket
import subprocess
import sys
from datetime import datetime

SUMMARY_URL = "https://status.claude.com/api/v2/summary.json"

# 監視対象 component (id → 表示名)。id は summary.json の components[].id。
TARGET_COMPONENTS = {
    "rwppv331jlwc": "claude.ai",
    "k8w3r06qmzrp": "Claude API",
    "yyzkbfz2thpt": "Claude Code",
}

# 本文先頭がこの完全一致 prefix だと bot が disable_notification を反転 (音 ON)。
# bot.py L205 CRITICAL_PREFIX と必ず一致させる。
CRITICAL_PREFIX = "[critical] "
# critical 扱いにする重大度。
CRITICAL_IMPACTS = {"major", "critical"}
CRITICAL_COMPONENT_STATUSES = {"major_outage"}

# Statuspage の状態ラベル (値が enum で固定) のみ日本語化する。Anthropic が書く
# 自由文 (incident の name / latest_body) は機械翻訳でニュアンスが変わるのを避け、
# 英語原文のまま維持する (OWNER 選択、todo#38)。未知の値は dict.get で原文フォールバック
# (Statuspage が将来値を増やしても KeyError で落とさない fail-safe)。
COMPONENT_STATUS_JA = {
    "operational": "稼働中",
    "under_maintenance": "メンテナンス中",
    "degraded_performance": "性能低下",
    "partial_outage": "一部障害",
    "major_outage": "大規模障害",
}
INCIDENT_STATUS_JA = {
    "investigating": "調査中",
    "identified": "原因特定",
    "monitoring": "経過観察",
    "resolved": "解決済み",
    "postmortem": "事後検証",
}
IMPACT_JA = {
    "none": "影響なし",
    "minor": "軽微",
    "major": "重大",
    "critical": "致命的",
    "maintenance": "メンテナンス",
}


def ja(table: dict, value) -> str:
    """enum 値を日本語化。未知の値は原文をそのまま返す (fail-safe)。"""
    return table.get(value, value)

HOME = os.path.expanduser("~")
STATE_FILE = os.path.join(HOME, "companion/maintenance/.state/claude-status.json")
LOG_FILE = os.path.join(HOME, "companion/logs/maintenance/notify-claude-status.log")

_uid = os.getuid()
_runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{_uid}"
SOCK = os.environ.get("COMPANION_BOT_SOCK") or os.path.join(_runtime, "companion-bot.sock")


def log(msg: str) -> None:
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"{ts} {msg}\n")


def fetch_summary():
    """curl -4 で summary.json を取得。失敗時は None。"""
    try:
        proc = subprocess.run(
            ["curl", "-4", "-sS", "--max-time", "15", SUMMARY_URL],
            capture_output=True, text=True, timeout=20,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        log(f"fetch failed: curl error: {e}")
        return None
    if proc.returncode != 0:
        log(f"fetch failed: curl rc={proc.returncode} stderr={proc.stderr.strip()[:200]}")
        return None
    try:
        return json.loads(proc.stdout)
    except (json.JSONDecodeError, ValueError) as e:
        log(f"fetch failed: json parse: {e}")
        return None


def extract_current(summary):
    """summary から対象 component 状態と、対象に関わる incident を抽出。"""
    components = {}
    for c in summary.get("components", []):
        cid = c.get("id")
        if cid in TARGET_COMPONENTS:
            components[cid] = c.get("status", "unknown")

    incidents = {}
    for inc in summary.get("incidents", []):
        iid = inc.get("id")
        if iid is None:
            continue  # id 欠落 incident は state キーにできず追跡不能なので skip
        affected = {cc.get("id") for cc in inc.get("components", [])}
        if not (affected & TARGET_COMPONENTS.keys()):
            continue  # 対象 component に無関係な incident は無視
        ups = inc.get("incident_updates") or []
        latest_body = ups[0].get("body", "").strip() if ups else ""
        incidents[iid] = {
            "status": inc.get("status", "unknown"),
            "impact": inc.get("impact", "none"),
            "updated_at": inc.get("updated_at", ""),
            "name": inc.get("name", "(no name)"),
            "latest_body": latest_body,
        }
    return {"components": components, "incidents": incidents}


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, ValueError) as e:
        # 壊れた state は「記録なし」扱い (= baseline 再確立)。次回から再び diff を取る。
        log(f"state unreadable, treating as baseline: {e}")
        return None


def save_state(current):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)  # atomic


def diff_lines(old, current):
    """old → current の差分から通知行リストと critical フラグを返す。"""
    lines = []
    critical = False

    old_comp = old.get("components", {})
    cur_comp = current["components"]
    # status 変化のみ通知する。対象 component が API から消える/増える (o か n が
    # None) ことは Statuspage 運用上まず起きないため、incident の解決検知と違い
    # component 側は出現/消失を非対称に無視する。
    for cid, name in TARGET_COMPONENTS.items():
        o = old_comp.get(cid)
        n = cur_comp.get(cid)
        if n is not None and o is not None and o != n:
            lines.append(f"{name}: {ja(COMPONENT_STATUS_JA, o)} → {ja(COMPONENT_STATUS_JA, n)}")
            if n in CRITICAL_COMPONENT_STATUSES:
                critical = True

    old_inc = old.get("incidents", {})
    cur_inc = current["incidents"]
    for iid, inc in cur_inc.items():
        prev = old_inc.get(iid)
        if prev is None:
            tag = "新規"
        elif prev.get("status") != inc["status"] or prev.get("updated_at") != inc["updated_at"]:
            tag = "更新"
        else:
            continue  # 変化なし
        lines.append(
            f"[{tag}] {inc['name']} "
            f"({ja(IMPACT_JA, inc['impact'])}, {ja(INCIDENT_STATUS_JA, inc['status'])})"
        )
        if inc["latest_body"]:
            lines.append(f"  {inc['latest_body']}")
        if inc["impact"] in CRITICAL_IMPACTS:
            critical = True

    # 前回あって今回消えた incident = 解決 (unresolved リストから外れた)。
    for iid, prev in old_inc.items():
        if iid not in cur_inc:
            lines.append(f"[解決] {prev.get('name', iid)}")

    return lines, critical


def send(body: str) -> bool:
    """socket に body を送信。socket 不在は skip (exit 0)、送信失敗は exit 1。"""
    if not os.path.exists(SOCK):
        log(f"skip send: socket not present ({SOCK})")
        sys.exit(0)
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(10)
        s.connect(SOCK)
        s.sendall(body.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)  # bot の reader.read() に EOF を伝える
        s.close()
        return True
    except OSError as e:
        log(f"send failed: {e}")
        sys.exit(1)


def main():
    summary = fetch_summary()
    if summary is None:
        sys.exit(0)  # 取得失敗は state 据え置きで次 tick 再取得

    current = extract_current(summary)
    old = load_state()

    if old is None:
        save_state(current)
        log(f"baseline established: {len(current['components'])} components, "
            f"{len(current['incidents'])} incidents")
        sys.exit(0)

    lines, critical = diff_lines(old, current)
    if not lines:
        log("no change")
        sys.exit(0)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = f"Claude status 変化 {now}"
    if critical:
        header = CRITICAL_PREFIX + header
    body = header + "\n" + "\n".join(lines)

    send(body)  # 失敗時はここで exit する
    save_state(current)  # 送信成功後にのみ state 確定
    log(f"notified critical={critical} lines={len(lines)}")


if __name__ == "__main__":
    main()
