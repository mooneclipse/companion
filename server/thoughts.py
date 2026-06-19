#!/usr/bin/env python3
"""companion-remote 思考ログ — bot の私的思考ログを read-only で時系列に見せるデータ層。

設計境界(軸4拡張 機構1、~/companion/workspace/redesign に従う。最重要・厳守):
  - read 専用。書き込み・削除・既読管理・お気に入り等の双方向操作を一切持たない
    (open は "r" のみ、open のモードを増やさない)。
  - bot が書いた観察行を **無加工** でそのまま透過する。解釈・要約・感情ラベル付けを
    しない(機構1「機械観察・感情日記にしない」を表示層でも崩さない)。timestamp は
    クライアント側で読みやすく整形するが、observation 本文には触らない。
  - プッシュ・通知・未読件数・新着バッジを生む情報をここから出さない。件数は時系列
    描画に要る最小限(空判定)だけ。

読み出し対象: companion_thoughts.jsonl({timestamp, observation} の追記式 JSONL)。
**bot 発火前は実体が無い**ため、ファイル不在・空ファイルは graceful に空配列を返す
(エラーで他タイルを巻き込まない)。1 行ずつ json.loads し、壊れ行はスキップして全体を
落とさない(行単位の頑健性、~/companion/CLAUDE.md「成否判定は1回で確定」)。

THOUGHTS_PATH は環境変数 REMOTE_THOUGHTS_PATH で上書き可
(既定 ~/companion/bot/sessions/companion_thoughts.jsonl)。固定パス読みのため vault.py の
ような traversal 検証は不要(env で与えた1ファイルをそのまま open する)。
"""
import json
import os

# 既定は兄弟 bot/ プロジェクトの追記式 JSONL。.env / EnvironmentFile で上書き可。
_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "bot", "sessions", "companion_thoughts.jsonl"
)
THOUGHTS_PATH = os.environ.get("REMOTE_THOUGHTS_PATH") or _DEFAULT_PATH

# レスポンスサイズの頭打ち(vault search の SEARCH_MAX_RESULTS=100 に倣う)。直近 N 件のみ
# 返す。time series は最新が上なので「直近」= 末尾 N 行。
MAX_ENTRIES = 200


def list_entries():
    """思考ログを最新が先頭の時系列で返す(read 専用・無加工)。

    返り値: {"count": int, "entries": [{"timestamp": <透過>, "observation": <透過>}, ...]}。
    ファイル不在・空・全行壊れは {"count": 0, "entries": []}(graceful)。
    観察行は bot が書いたまま透過し、サーバ側で解釈・要約・整形しない。
    """
    try:
        with open(THOUGHTS_PATH, "r", encoding="utf-8") as f:  # read 専用(書き込みモード厳禁)
            lines = f.readlines()
    except OSError:
        # 不在含む読み取り不能はすべて空扱い(他タイルを巻き込まない)。
        return {"count": 0, "entries": []}

    entries = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue  # 壊れ行はスキップ(全体を落とさない)
        if not isinstance(obj, dict):
            continue
        # bot が書いた timestamp / observation をそのまま透過(無加工)。
        entries.append({
            "timestamp": obj.get("timestamp"),
            "observation": obj.get("observation"),
        })

    entries.reverse()  # 最新が上(ファイル末尾が最新の追記式)
    if len(entries) > MAX_ENTRIES:
        entries = entries[:MAX_ENTRIES]
    return {"count": len(entries), "entries": entries}
