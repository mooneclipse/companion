#!/usr/bin/env python3
"""osekkai trigger — 号令 (call) / 振り返り (retro) の判定 + bot socket envelope 送信

計画正本 `workspace/redesign/osekkai-plan.md` v0.2 の D-2/D-8/D-9、および
`docs/STATUS.md` TODO 6 の申し送りを実装する:

- **共通ゲート** (両モード共通、モード固有処理より先に評価する): 平日判定
  (JST、土日は無音 exit 0) → 休むフラグ (`intent_store.tonight_status` の
  1 発読みのみで判定、read→書き込みの 2 段にしない)。休むなら無音 exit 0
- **号令モード** (19 時台): `collector.pull()` を先に実行 (前夜分 backfill を
  兼ねる。失敗しても続行 — 活動データゼロでも号令は出せる、N3)。続いて
  `intent_store.tonight_mark_called()` を呼び、返り値の `first_call` を見て
  1 発判定する (read→判断→mark の 2 段は read/mark 間に二重送信の余地が
  生まれるため禁止、TODO 5 申し送り)。`first_call=True` のときだけ backlog +
  今夜の状態を載せた envelope を bot socket へ送る
- **振り返りモード** (23:30): `collector.pull()` → `collector.summarize()` で
  当夜ダイジェスト生成 (失敗時は「データなし」を明示する文言で続行) →
  `intent_store.tonight_mark_retro_sent()` の `first_call` で同型判定 → 送信
- **送信失敗時**: エラーログを出して rc=1 で終了するだけ。マークの巻き戻し・
  リトライ機構・pending ファイルは作らない (上位 `~/companion/CLAUDE.md` の
  派生原則「1 つの外部呼び出しの成否判定は 1 回で確定し、回復は state 引き
  or ユーザー介入のいずれか」、collector.py の pull 失敗時と同じ型)。結果
  マークが立ったまま当夜沈黙する = 押し付けない方向への安全劣化として許容
  (2026-07-16 実装時の判断、STATUS.md に記録)
- envelope は bot 既存の `[[proactive-v1]]` マーカーをそのまま使い、JSON の
  `kind` フィールドで判別する (D-2。マーカーを増やさない)。ただし
  `backlog[].text` / `tonight.intent` は OWNER 自身が書いた自由文であり、
  bot.py 既存の proactive 経路 (`build_proactive_prompt` のサニタイズ済み
  フィールドのみ展開する規約) とは前提が異なる — OWNER 自身の入力なので
  通常のチャット入力と同格に扱ってよい。TODO 7 はこの envelope 専用の
  ディスパッチ (kind=="osekkai" を proactive_queue とは別に振り分ける) を
  実装する前提で、proactive 用の whitelist ロジックを流用しない
- D-9: ログは自前で `~/companion/logs/osekkai/trigger.log` に書く
  (mkdir -p を自己完結、proactive-companion.sh の OUR_LOG と同型。
  systemd の `StandardError=append:` は親ディレクトリを自動生成しないため
  timer 側リダイレクトには頼らない)。stderr にも出す (手動実行 / journal
  両対応)。生ウィンドウタイトルは扱わない (collector 側で既に破棄済み)

trigger.py は collector.py / intent_store.py と同じ `scripts/` に置き、
python が実行スクリプトのディレクトリを自動で sys.path[0] に入れる挙動に
乗って `import collector` / `import intent_store` する (このプロジェクトの
既存 2 スクリプトが互いに import せず定数を重複させている慣習に倣い、
trigger.py も両モジュールの公開定数以外には依存しない)。
"""
import argparse
import json
import logging
import os
import socket
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import collector
import intent_store

logger = logging.getLogger("osekkai.trigger")

JST = timezone(timedelta(hours=9))
ENVELOPE_MARKER = "[[proactive-v1]]"

LOG_DIR = Path(
    os.environ.get(
        "OSEKKAI_LOG_DIR", str(Path.home() / "companion" / "logs" / "osekkai")
    )
)
LOG_FILE = LOG_DIR / "trigger.log"


def _default_sock_path() -> str:
    """bot.py 本体 (bot.py:500-506) と同じフォールバック規則に揃える。
    XDG_RUNTIME_DIR が無いとき `/run/user/<uid>` ではなく
    `~/.cache/companion-bot/` を見る (bot 側がその場所で listen するため、
    ここがズレると XDG_RUNTIME_DIR 未設定環境で socket が見つからない)。
    ディレクトリの mkdir はしない — 作るのは listen する bot 側の責務で、
    trigger 側は無ければ connect 失敗として _send_envelope の送信失敗
    パスに落ちるだけでよい。"""
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir:
        return str(Path(runtime_dir) / "companion-bot.sock")
    return str(Path.home() / ".cache" / "companion-bot" / "companion-bot.sock")


SOCK_PATH = os.environ.get("OSEKKAI_SOCK", _default_sock_path())


def _setup_logging() -> None:
    """自前で mkdir -p してファイルへ書く (D-9)。stderr にも出す (手動実行 /
    systemd journal 両対応。journal 側は timer 側リダイレクトに頼らない)。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(sys.stderr),
        ],
    )


def _today(date_arg: str | None) -> date:
    if date_arg is not None:
        return date.fromisoformat(date_arg)
    return datetime.now(JST).date()


def _is_weekday(d: date) -> bool:
    return d.weekday() < 5  # Mon=0 ... Sun=6


def _night_start(day: date) -> datetime:
    """夜ブロック開始 = 対象日 19:00 JST (`collector._default_since` と同型の
    定義だが、trigger 側は `--date` で指定された対象日を軸に取るので
    「現在時刻の深夜 0〜5 時なら前日扱い」の補正は行わない — 対象日は既に
    共通ゲートで確定済みの値だから)。"""
    return datetime(day.year, day.month, day.day, collector.NIGHT_START_HOUR, tzinfo=JST)


def _try_pull() -> bool:
    """collector.pull() を試みる。失敗しても例外を外へ出さない (N3、両モードとも継続)。
    成否は envelope の pull_ok に反映するのみで、リトライはしない
    (次回 pull が last_pulled_at から取り直す = collector.py 自身のリトライ機構)。"""
    try:
        collector.pull()
        return True
    except Exception as e:
        logger.warning(f"collector pull 失敗 (続行、次回 pull で同範囲を再取得): {e}")
        return False


def _send_envelope(obj: dict) -> bool:
    """bot socket へ `[[proactive-v1]]\\n<json>` を送る (nc -U -N と同型:
    書き込み後に半クローズして相手に EOF を伝える)。失敗は False を返すのみ、
    呼び出し元は rc=1 で終わるだけでリトライ・巻き戻しはしない。"""
    message = ENVELOPE_MARKER + "\n" + json.dumps(obj, ensure_ascii=False)
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.connect(SOCK_PATH)
            sock.sendall(message.encode("utf-8"))
            sock.shutdown(socket.SHUT_WR)
        return True
    except OSError as e:
        logger.error(f"bot socket 送信失敗 ({SOCK_PATH}): {e}")
        return False


def _backlog_payload() -> list[dict]:
    return [
        {"id": it["id"], "text": it["text"], "deadline": it.get("deadline")}
        for it in intent_store.backlog_list()
    ]


def _common_gate(day: date) -> str | None:
    """平日判定 → 休むフラグの共通ゲート。skip する理由文字列を返す (None なら通過)。"""
    if not _is_weekday(day):
        return f"週末 ({day.isoformat()})"
    status = intent_store.tonight_status(day.isoformat())
    if status.get("resting"):
        return f"休むフラグ ({day.isoformat()})"
    return None


def run_call(date_arg: str | None) -> int:
    today = _today(date_arg)
    day = today.isoformat()

    skip_reason = _common_gate(today)
    if skip_reason is not None:
        logger.info(f"号令 skip: {skip_reason}")
        return 0

    pull_ok = _try_pull()

    marked = intent_store.tonight_mark_called(day)
    if not marked["first_call"]:
        logger.info(f"号令 skip: 号令済み ({day})")
        return 0

    envelope = {
        "kind": "osekkai",
        "version": 1,
        "mode": "call",
        "date": day,
        "pull_ok": pull_ok,
        "backlog": _backlog_payload(),
        "tonight": intent_store.tonight_status(day),
    }
    if not _send_envelope(envelope):
        return 1
    logger.info(f"号令 envelope 送信完了 ({day}, pull_ok={pull_ok})")
    return 0


def run_retro(date_arg: str | None) -> int:
    today = _today(date_arg)
    day = today.isoformat()

    skip_reason = _common_gate(today)
    if skip_reason is not None:
        logger.info(f"振り返り skip: {skip_reason}")
        return 0

    pull_ok = _try_pull()

    try:
        activity_summary = collector.summarize(_night_start(today), datetime.now(JST))
    except Exception as e:
        logger.warning(f"summary 生成失敗 (データなしとして続行): {e}")
        activity_summary = "PC 活動ダイジェスト: データなし (集計に失敗しました)"

    marked = intent_store.tonight_mark_retro_sent(day)
    if not marked["first_call"]:
        logger.info(f"振り返り skip: 送信済み ({day})")
        return 0

    envelope = {
        "kind": "osekkai",
        "version": 1,
        "mode": "retro",
        "date": day,
        "pull_ok": pull_ok,
        "activity_summary": activity_summary,
        "backlog": _backlog_payload(),
        "tonight": intent_store.tonight_status(day),
    }
    if not _send_envelope(envelope):
        return 1
    logger.info(f"振り返り envelope 送信完了 ({day}, pull_ok={pull_ok})")
    return 0


def main() -> int:
    _setup_logging()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_call = sub.add_parser("call", help="号令 (19時台) の判定 + envelope 送信")
    p_call.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST。検証用)")

    p_retro = sub.add_parser("retro", help="振り返り (23:30) の判定 + envelope 送信")
    p_retro.add_argument("--date", help="対象日付 (YYYY-MM-DD、既定は当日 JST。検証用)")

    args = parser.parse_args()

    try:
        if args.cmd == "call":
            return run_call(args.date)
        if args.cmd == "retro":
            return run_retro(args.date)
    except ValueError as e:
        logger.error(f"--date が不正です (YYYY-MM-DD で指定): {e}")
        return 1

    return 2


if __name__ == "__main__":
    sys.exit(main())
