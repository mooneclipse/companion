"""bot 自身の「関心 state」(persona 軸 4 拡張 機構 1、TODO (1))。

自律ループ (自発発話) の種を OWNER 中心から「相手の一日 + 自分が触れた話題」へ
移すための土台。vault には置かない (vault は notes/ 限定 + OWNER の知識空間)。
bot 自身の state 領域 = sessions/ 配下 (.gitignore 済み = 非 commit state、
proactive_ledger.jsonl と同居) に 2 層で持つ:

- 構造化 index (companion_interests.json): いま気になってる 3〜5 本のスレッド。
  各 = {topic, source, last_touched, state}。触らないと decay で消える
  (「自分の時間が流れてる」手触り)。
- 私的思考ログ (companion_thoughts.jsonl): 実活動の機械観察 (事実 anchor) に
  claude の自由記述 (今回やったことから思ったこと、チケット #93) を連結した 1 行を追記。
  感情日記にしない (でっち上げの内面を持たせない)。読まれない前提で書き、
  自発発話では一言だけ滲ませるだけ (全文ダンプ・演技なし = §F dark pattern 回避)。

設計境界 (~/companion/CLAUDE.md 設計判断・対症療法の上限):
- 判定は load した data 1 つに decay → touch を純関数適用 → save 1 回で確定する。
  条件分岐・リトライの積み増し (対症療法 2 周目) を作らない。
- topic/source の出どころは実活動由来が原則。claude に新しい関心・感情・趣味を
  捏造させない (このモジュールは記録専用、生成判断は持たない)。例外は 1 つだけ
  (チケット #96、OWNER 2026-07-13 線引き承認): 実際にやった調査の中で派生した
  関心 (「○○を調べてたら△△が引っかかった」) は実活動由来と見なし、investigate
  分岐からの登録を認める。その場合も出どころ (調べたノート名/URL) を origin
  フィールドで必須記録して実体のない捏造と区別する。増殖は 1 発火 1 件 +
  MAX_THREADS + 既存 decay で抑制 (新しい上限機構は足さない)。

純関数 (load/touch_thread/decay/active_threads) は unit-test 対象。
副作用は save_interests / append_thought の atomic / append のみ。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

# index に保持するスレッド上限。機構 1 の「3〜5 本」の上限側。超過時は最古を落とす。
MAX_THREADS = 5


def load_interests(path: Path) -> dict:
    """index を読む。未作成 / 壊れている場合は空構造を返す (フォールバック分岐は作らない)。

    壊れた JSON は「無かった」と同じに扱う (空 index から作り直す)。これは
    回復のための条件分岐ではなく「state が無い」の 1 状態への正規化。
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"threads": []}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"threads": []}
    if not isinstance(data, dict) or not isinstance(data.get("threads"), list):
        return {"threads": []}
    return data


def save_interests(path: Path, data: dict) -> None:
    """index を atomic write する (tmp + os.replace、write_snooze_until に倣う)。

    umask 0o077 環境なので tmp は 0o600 で出る (snooze state と同基準)。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def touch_thread(
    data: dict, topic: str, source: str, now: datetime, state: str = "active",
    origin: str | None = None,
) -> dict:
    """topic 一致スレッドを最新接触に更新、無ければ追加して返す (純関数、新 dict)。

    - topic が既存に一致 → last_touched=now、source/state を更新。
    - 無ければ追加。MAX_THREADS 超過時は last_touched が最古のものを落とす
      (「触らないと押し出される」= decay と同じ「自分の時間が流れる」手触り)。
    origin は claude 産派生関心 (チケット #96) の出どころ (調べたノート名/URL)。
    非 None のときだけ thread に origin キーを立てる/更新する (None は既存 origin を
    保持 = 後続の seed touch が来歴を消さない)。
    入力 data は破壊しない (新しい dict を返す)。判定は呼び出し側で decay → touch
    の順に 1 回適用して save する前提。
    """
    threads = [dict(t) for t in data.get("threads", []) if isinstance(t, dict)]
    now_iso = now.isoformat()
    for t in threads:
        if t.get("topic") == topic:
            t["source"] = source
            t["last_touched"] = now_iso
            t["state"] = state
            if origin is not None:
                t["origin"] = origin
            break
    else:
        new_thread = {
            "topic": topic,
            "source": source,
            "last_touched": now_iso,
            "state": state,
        }
        if origin is not None:
            new_thread["origin"] = origin
        threads.append(new_thread)
    if len(threads) > MAX_THREADS:
        # 最古 (last_touched 昇順) を落とす。値欠落は最古扱い (空文字は ISO より小さい)。
        threads.sort(key=lambda t: t.get("last_touched") or "")
        threads = threads[len(threads) - MAX_THREADS:]
    return {**data, "threads": threads}


def decay(data: dict, now: datetime, ttl_days: float) -> dict:
    """last_touched から ttl_days 超のスレッドを除去して返す (純関数、新 dict)。

    last_touched が無い / パースできないスレッドは消す (state を引けない =
    保持の根拠が無い → 「自分の時間が流れる」側に倒す)。これは回復用の分岐では
    なく「保持期限を引けるか」の 1 判定。
    """
    cutoff = now - timedelta(days=ttl_days)
    kept = []
    for t in data.get("threads", []):
        if not isinstance(t, dict):
            continue
        last = t.get("last_touched")
        if not isinstance(last, str):
            continue
        try:
            ts = datetime.fromisoformat(last)
        except ValueError:
            continue
        if ts >= cutoff:
            kept.append(t)
    return {**data, "threads": kept}


def active_threads(data: dict, now: datetime, limit: int) -> list:
    """最近触れた上位 limit 本を返す (滲ませ用、純関数)。

    now は将来の活性度連動 (機構 2) のため受けるが、今は順序付けのみに使う
    (現時点では未使用引数。decay 済み data を渡す前提なので now で再フィルタしない)。

    ``state == "researched"`` (調べ終えた過去) は非 researched より後ろに回す。
    sort が stable なことを利用し、先に last_touched 降順で並べてから
    state 昇順 (False < True で非 researched が先) を安定ソートする 2 段構成
    (各グループ内の降順は保たれる)。これは滲ませ (自発発話の話題選び) 専用の
    優先順位調整で、should_investigate/should_ticket/should_remind の signal 選定
    には影響しない (それらは data を直接読み、この関数を経由しない)。調べ終えた
    話題が interval 更新のたびに last_touched を更新して枠を占有し、新しい話題が
    滲ませ候補に入らなくなる問題への対応。
    """
    threads = [t for t in data.get("threads", []) if isinstance(t, dict)]
    threads.sort(key=lambda t: t.get("last_touched") or "", reverse=True)
    threads.sort(key=lambda t: t.get("state") == "researched")
    return threads[:max(0, limit)]


# investigate の対象から除外する topic / state。直近会話起点は実トピックでない
# (種が basename でなく "recent_conversation")、researched は既に一度調べた印。
_INVESTIGATE_SKIP_TOPIC = "recent_conversation"
_INVESTIGATE_DONE_STATE = "researched"

# 機械出力カテゴリの固定ラベル (チケット #94)。maintenance/lib/activity_hints.py の
# SOURCES で定義される activity_type と同期して維持する (ラベルの変更・追加時は両方)。
# カテゴリ名の Web 調査 (investigate) / 起票 (ticket) は具体性を欠くため対象から
# 除外する。remind (言及して振り返るだけ、外向き操作ゼロ) は「そういえば最近の
# おすすめ見た?」として自然なので除外しない。
_CATEGORY_LABEL_TOPICS = frozenset({"ytcheck 巡回のおすすめ", "英語ディクテーション"})


def should_investigate(
    data: dict, now: datetime, interval_days: float, last_investigate: str | None,
) -> tuple[bool, str | None]:
    """「今 investigate するか + 対象 topic」を index と now から決める (純関数)。

    state を持つ側 (index) を 1 回引いて確定する設計。file IO・claude 起動・
    save は呼び出し側の責務。ここは判定だけ (条件分岐・リトライの積み増しをしない)。

    investigate するのは次を全部満たすとき (どれか欠ければ ``(False, None)``):
      1. interval 経過: ``last_investigate`` (ISO) から ``interval_days`` 日以上
         経過。``last_investigate`` が None / パース不能 = 一度も調査していない =
         due (「state を引けない」を due の 1 状態へ正規化、回復分岐は作らない)。
      2. 対象スレッドが 1 本以上: topic が ``recent_conversation`` でも機械出力
         カテゴリラベル (``_CATEGORY_LABEL_TOPICS``、#94) でもなく、state が
         ``researched`` でない active thread。freshest (last_touched 降順の先頭)
         を選ぶ。

    decay は呼び出し側で先にかけて渡す前提 (期限切れスレッドは候補に含めない)。
    enable フラグ (PROACTIVE_INVESTIGATE_ENABLED) は呼び出し側で別途引く。
    """
    if interval_days < 0:
        return (False, None)
    if not _interval_elapsed(last_investigate, now, interval_days):
        return (False, None)
    candidates = [
        t for t in data.get("threads", [])
        if isinstance(t, dict)
        and isinstance(t.get("topic"), str)
        and t.get("topic")
        and t.get("topic") != _INVESTIGATE_SKIP_TOPIC
        and t.get("topic") not in _CATEGORY_LABEL_TOPICS
        and t.get("state") != _INVESTIGATE_DONE_STATE
    ]
    if not candidates:
        return (False, None)
    candidates.sort(key=lambda t: t.get("last_touched") or "", reverse=True)
    return (True, candidates[0]["topic"])


def should_ticket(
    data: dict, now: datetime, interval_days: float, last_ticket: str | None,
) -> tuple[bool, str | None]:
    """「今 ticket 起票するか + 起票材料の signal」を index と now から決める (純関数)。

    should_investigate と対称の判定。state を持つ側 (index) を 1 回引いて確定する。
    file IO・claude 起動・save は呼び出し側の責務。ここは判定だけ。

    起票するのは次を全部満たすとき (どれか欠ければ ``(False, None)``):
      1. interval 経過: ``last_ticket`` (ISO) から ``interval_days`` 日以上経過。
         None / パース不能 = 一度も起票していない = due (``_interval_elapsed`` 共用)。
      2. 実 signal が 1 本以上: actionable な active thread (topic が
         ``recent_conversation`` でも機械出力カテゴリラベル (#94) でもない =
         実トピック) が存在する。これが §F の核 = **でっち上げたタスクを起票
         しない**。index が空 / recent_conversation だけなら signal なし →
         ``(False, None)`` (index が空の現状では絶対に発火しない)。

    signal 部分は build_ticket_prompt に渡す材料。freshest な actionable thread の
    topic を代表として返す (investigate が topic を返すのと対称)。``researched`` 除外は
    しない (起票は調査でなく、調べ終えた thread からも actionable なタスクは出るため。
    重複は呼び出し側の list --all チェックで抑える)。

    decay は呼び出し側で先にかけて渡す前提 (期限切れスレッドは signal に含めない)。
    enable フラグ (PROACTIVE_TICKET_ENABLED) は呼び出し側で別途引く。
    """
    if interval_days < 0:
        return (False, None)
    if not _interval_elapsed(last_ticket, now, interval_days):
        return (False, None)
    candidates = [
        t for t in data.get("threads", [])
        if isinstance(t, dict)
        and isinstance(t.get("topic"), str)
        and t.get("topic")
        and t.get("topic") != _INVESTIGATE_SKIP_TOPIC
        and t.get("topic") not in _CATEGORY_LABEL_TOPICS
    ]
    if not candidates:
        return (False, None)
    candidates.sort(key=lambda t: t.get("last_touched") or "", reverse=True)
    return (True, candidates[0]["topic"])


def should_remind(
    data: dict, now: datetime, interval_days: float, last_remind: str | None,
) -> tuple[bool, str | None]:
    """「今 reminder で振り返るか + 振り返り材料の signal」を index と now から決める (純関数)。

    should_investigate / should_ticket と対称の判定。state を持つ側 (index) を 1 回
    引いて確定する。file IO・claude 起動・save は呼び出し側の責務。ここは判定だけ
    (条件分岐・リトライの積み増しをしない)。

    reminder は外向き/不可逆操作を一切伴わない (過去を振り返って #chat に一言投げる
    だけ)。signal 源 = 自分が過去に触れた実スレッド (decay しかけ = 古いが TTL 内、
    researched 済み = 一度調べたきり放置)。「そういえば先週の○○どうなった?」式の
    振り返りは、まさに調べ終えた / しばらく触っていない thread から自然に出るため、
    ``researched`` を除外しない (should_ticket と同じく除外せず、investigate とは逆)。
    呼び出し側の claude session は自分の ``--by ai`` チケットも振り返り材料として
    読むが (read-only)、この純関数の signal 源は index の実スレッドに一本化する
    (起票チケットは index に thread として残っているのが通常で、判定は index 1 read
    で確定する設計を踏襲)。

    振り返るのは次を全部満たすとき (どれか欠ければ ``(False, None)``):
      1. interval 経過: ``last_remind`` (ISO) から ``interval_days`` 日以上経過。
         None / パース不能 = 一度も振り返っていない = due (``_interval_elapsed`` 共用)。
      2. 実 signal が 1 本以上: 過去に触れた実スレッド (topic が ``recent_conversation``
         でない = 実トピック) が存在する。これが §F の核 = **でっち上げた過去を振り返ら
         ない**。index が空 / recent_conversation だけなら signal なし → ``(False, None)``
         (index が空の現状では絶対に発火しない)。

    振り返り対象は「しばらく触っていない / 調べたきり」が自然なので、freshest ではなく
    **oldest (last_touched 昇順の先頭)** な実スレッドを代表として返す (investigate /
    ticket が freshest を選ぶのと逆向き = 振り返りの意味に沿う)。

    decay は呼び出し側で先にかけて渡す前提 (TTL で完全に消えたスレッドは振り返らない。
    まだ TTL 内で「decay しかけ」の古いスレッドが oldest として拾われる)。
    enable フラグ (PROACTIVE_REMIND_ENABLED) は呼び出し側で別途引く。
    """
    if interval_days < 0:
        return (False, None)
    if not _interval_elapsed(last_remind, now, interval_days):
        return (False, None)
    candidates = [
        t for t in data.get("threads", [])
        if isinstance(t, dict)
        and isinstance(t.get("topic"), str)
        and t.get("topic")
        and t.get("topic") != _INVESTIGATE_SKIP_TOPIC
    ]
    if not candidates:
        return (False, None)
    candidates.sort(key=lambda t: t.get("last_touched") or "")
    return (True, candidates[0]["topic"])


def _interval_elapsed(last_investigate: str | None, now: datetime, interval_days: float) -> bool:
    """``last_investigate`` から ``interval_days`` 日以上経過したか (パース不能 = 経過扱い)。"""
    if not isinstance(last_investigate, str) or not last_investigate:
        return True
    try:
        last = datetime.fromisoformat(last_investigate)
    except ValueError:
        return True
    return now - last >= timedelta(days=interval_days)


def activity_score(data: dict, now: datetime, freshness_days: float) -> float:
    """index の「新鮮でアクティブさ」を 0.0〜1.0 で返す (純関数、機構 2 の活性度)。

    各スレッドの last_touched が freshness_days 窓内なら、新鮮さに比例した
    重み (触った直後 = 1.0、窓の端 = 0.0 へ線形に減衰) を与え、その合計を
    MAX_THREADS で割って正規化する。窓外 / パース不能なスレッドは寄与 0。

    - 空 index / 全スレッド窓外 → 0.0 (「静かな日」)。
    - MAX_THREADS 本すべてを今この瞬間に触った → 1.0 (「乗ってる日」)。
    decay 済み data を渡す前提だが、freshness_days < ttl_days で「decay より
    手前の新鮮さ窓」を別概念として測れる (ケイデンス用の窓は decay TTL と独立)。

    波の生成は決定的: スコアは read-once の index から純粋に導かれ、ここに
    乱数を持ち込まない (per-tick の追加乱数で静寂をランダム生成しない)。
    日をまたぐ波は last_touched が時間で古くなる = スコアが自然に下がることで
    創発する (場当たりな静寂期間の挿入ではない)。
    """
    if freshness_days <= 0:
        return 0.0
    total = 0.0
    for t in data.get("threads", []):
        if not isinstance(t, dict):
            continue
        last = t.get("last_touched")
        if not isinstance(last, str):
            continue
        try:
            ts = datetime.fromisoformat(last)
        except ValueError:
            continue
        age_days = (now - ts).total_seconds() / 86400.0
        if age_days < 0:
            age_days = 0.0  # 未来の timestamp は「今触った」に丸める
        if age_days >= freshness_days:
            continue
        total += 1.0 - (age_days / freshness_days)
    score = total / MAX_THREADS
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return score


def append_thought(path: Path, observation: str, now: datetime) -> None:
    """私的思考ログに 1 行追記する (proactive_ledger と同じ append-only jsonl)。

    実活動の観察が基本 (機械観察の事実 anchor)。チケット #93 以降、ephemeral 分岐の
    観察行には claude の自由記述 (今回やったことから思ったこと) が連結され得るが、
    出どころは実活動限定 (§F 両立)。読まれない前提の素メモ。スキーマは
    timestamp + observation の 2 キーで不変。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {"timestamp": now.isoformat(), "observation": observation}
    line = json.dumps(entry, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
