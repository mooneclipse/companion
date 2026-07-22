"""OWNER からの口調指摘を state として持ち、次回以降の prompt に載せる (改善案 #2)。

指摘のたびにプロンプトへ場当たりで書き足す対症療法を避け、口調ルールを 1 箇所の
永続 state (sessions/companion_style_notes.json) に集約する。書き込みは
「OWNER が直近の自分の話し方を名指しで訂正した」ときだけ、claude 自身が
``[[style-note: ...]]`` marker で申告した内容に限定する (bot.py 側で marker を
剥がして呼び出す、実活動由来限定の原則は interests.py と同じ)。

設計境界 (~/companion/CLAUDE.md 設計判断・対症療法の上限、bot/docs/STATUS.md
2026-07-22 着手前設計メモ):
- read-back (このルールを守れという既存データ) と emit-instruction (新しい
  ルールを marker で申告させる指示) を分離する。read-back は
  PERSONA_SYSTEM_PROMPT のような全経路共通の system prompt 定数には入れず、
  build_proactive_prompt / compose_chat_prompt 側で bounded な文字列リストとして
  展開する (interests.py の interest_topics と同じパターン)。emit-instruction は
  marker を剥がす経路 (on_message の既定 #chat 分岐) にだけ持たせる。
- 純関数 (load_style_notes 以外) + 副作用分離: 判定/追加は純関数 (unit-test
  対象)、副作用は save_style_notes の atomic write のみ。
- 誤った/過度に一般化されたルールが載ると全プロンプトに影響する。専用の削除
  コマンドは作らない。OWNER が sessions/companion_style_notes.json を直接編集
  すれば訂正・削除できる (tickets.json のような専用 CLI ではなく、規模的に
  直接編集で足りると判断)。
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

# 保持するルール上限。増やしすぎても prompt を圧迫するだけなので
# interests.MAX_THREADS (5) と同水準に揃える。
MAX_NOTES = 5


def load_style_notes(path: Path) -> dict:
    """state を読む。未作成 / 壊れている場合は空構造を返す (フォールバック分岐は作らない)。

    壊れた JSON は「無かった」と同じに扱う (interests.load_interests と同じ正規化)。
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"notes": []}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"notes": []}
    if not isinstance(data, dict) or not isinstance(data.get("notes"), list):
        return {"notes": []}
    return data


def save_style_notes(path: Path, data: dict) -> None:
    """state を atomic write する (tmp + os.replace、interests.save_interests に倣う)。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def add_note(data: dict, rule: str, now: datetime) -> dict:
    """rule を追加/更新して返す (純関数、新 dict、入力は破壊しない)。

    同一 rule 文字列が既存にあれば last_touched のみ更新 (重複を増やさない)。
    無ければ追加、MAX_NOTES 超過時は last_touched が最古のものを落とす
    (interests.touch_thread と同じ「触らないと押し出される」パターン)。
    """
    notes = [dict(n) for n in data.get("notes", []) if isinstance(n, dict)]
    now_iso = now.isoformat()
    for n in notes:
        if n.get("rule") == rule:
            n["last_touched"] = now_iso
            break
    else:
        notes.append({"rule": rule, "last_touched": now_iso})
    if len(notes) > MAX_NOTES:
        notes.sort(key=lambda n: n.get("last_touched") or "")
        notes = notes[len(notes) - MAX_NOTES:]
    return {**data, "notes": notes}


def note_rules(data: dict) -> list[str]:
    """prompt へ展開してよい rule 文字列のみを順序維持で返す (bounded、純関数)。

    build_proactive_prompt / compose_chat_prompt はこの戻りを「str のみ展開」
    する既存パターンにそのまま渡せる。
    """
    return [
        n.get("rule") for n in data.get("notes", [])
        if isinstance(n, dict) and isinstance(n.get("rule"), str) and n.get("rule")
    ]
