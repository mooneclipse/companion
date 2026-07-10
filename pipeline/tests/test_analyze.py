#!/usr/bin/env python3
"""analyze.py の検証 (claude -p は _run_claude のモック差し替え、実弾呼び出しはしない)。

一時 SQLite DB に合成 attempts/clips を入れ、
  - 集計 (14 日窓、窓外除外)
  - llm 成功経路 (エンベロープ → 本文 JSON → スキーマ検証 → ペアキー正規化)
  - 失敗 3 態 (rc≠0 / JSON 不正 / スキーマ NG) がすべて 1 回確定で fallback に落ちること
  - fallback の weights 算出と定型 report_md
  - attempts ゼロで何も書かないこと / 同日再実行の INSERT OR REPLACE
  - 書いた weights が server/drill.py の受け口 (_load_weights) の契約を満たすこと
を確認する。

実行: `python3 -m unittest pipeline.tests.test_analyze -v` または
      `python3 pipeline/tests/test_analyze.py`
"""
import json
import pathlib
import sys
import tempfile
import time
import unittest
from unittest import mock

TESTS_DIR = pathlib.Path(__file__).resolve().parent
PIPELINE_DIR = TESTS_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))
import common   # noqa: E402
import analyze  # noqa: E402
import drill    # noqa: E402  (common が server/ を sys.path に足している)


def _envelope(result_str):
    """claude -p --output-format json のエンベロープを模す。"""
    return json.dumps({"type": "result", "is_error": False, "result": result_str})


VALID_BODY = {
    "report_md": "can/can't の聞き分けで落としています。否定形は直後の動詞で判断する練習を。",
    # ペアキーは意図的に未ソート ("can't|can") — ソート正規化されて保存されることを見る
    "weights": {"feature_tags": {"weak_form": 1.8}, "pairs": {"can't|can": 2.0}},
}


class AnalyzeDbTest(unittest.TestCase):
    """一時 DB に合成データを入れて analyze() の各経路を通す。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="english-analyze-test-")
        self.db_path = str(pathlib.Path(self.tmp.name) / "test.db")
        self.conn = common.open_db(self.db_path)
        self.today = drill.jst_today_str()
        self._seed()

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def _seed(self):
        now = int(time.time())
        c = self.conn
        c.execute("INSERT INTO series (id, title, sort) VALUES ('s1','S1',0)")
        c.execute(
            "INSERT INTO episodes (id, series_id, title, duration_s, video_path, sub_kind, "
            "sort_key, ingested_at) VALUES ('ep1','s1','Ep1',300,'media/episodes/ep1.mp4',"
            "'manual','001',?)", (now,))
        clips = [
            ("c1", '["weak_form"]', 150),
            ("c2", '[]', 120),
        ]
        for cid, tags, wpm in clips:
            c.execute(
                "INSERT INTO clips (id, episode_id, start_s, end_s, video_path, text, tokens, "
                "blanks, wpm, feature_tags) VALUES (?,'ep1',0,5,?,?,?,?,?,?)",
                (cid, "media/clips/%s.mp4" % cid, "text", '["a"]',
                 '[{"idx":0,"answer":"can\'t","choices":["can\'t","can","kinda","cant"]}]',
                 wpm, tags))
        attempts = [
            # 窓内: c1 で can't→can を誤答 + 1 正解 (weak_form total 2 / wrong 1)
            ("c1", now, '[{"answer":"can\'t","chosen":"can","correct":false},'
                        '{"answer":"you","chosen":"you","correct":true}]', '["sub_suspect"]', 2),
            # 窓内: c2 で of→off を誤答 (タグなし)
            ("c2", now - 3600, '[{"answer":"of","chosen":"off","correct":false}]', '[]', 1),
            # 窓外 (20 日前): 集計に入らないこと
            ("c1", now - 20 * 86400, '[{"answer":"and","chosen":"end","correct":false}]', '[]', 0),
        ]
        for clip_id, ts, results, flags, replays in attempts:
            c.execute(
                "INSERT INTO attempts (clip_id, ts, results, flags, replays, duration_ms) "
                "VALUES (?,?,?,?,?,1000)", (clip_id, ts, results, flags, replays))
        c.commit()

    def _analysis_rows(self):
        return self.conn.execute(
            "SELECT date, report_md, weights, source FROM analysis").fetchall()

    # ---- 集計 ----

    def test_collect_stats_window_and_aggregation(self):
        stats = analyze.collect_stats(self.conn, self.today)
        self.assertEqual(stats["attempts"], 2)          # 窓外 1 件は除外
        self.assertEqual(stats["blank_total"], 3)
        self.assertEqual(stats["blank_correct"], 1)
        self.assertEqual(stats["feature_tag_stats"], {"weak_form": {"total": 2, "wrong": 1}})
        misses = {(m["answer"], m["chosen"]): m["count"] for m in stats["misses"]}
        self.assertEqual(misses, {("can't", "can"): 1, ("of", "off"): 1})
        self.assertEqual(stats["flag_counts"], {"sub_suspect": 1})
        self.assertEqual(stats["replays_total"], 3)

    # ---- llm 成功経路 ----

    def test_llm_success_writes_normalized_weights(self):
        with mock.patch.object(analyze, "_run_claude",
                               return_value=(0, _envelope(json.dumps(VALID_BODY, ensure_ascii=False)))):
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "llm")
        rows = self._analysis_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["date"], self.today)
        self.assertEqual(rows[0]["source"], "llm")
        weights = json.loads(rows[0]["weights"])
        # ペアキーはソート済み "|" 連結に正規化される (§3.4 契約)
        self.assertEqual(weights, {"feature_tags": {"weak_form": 1.8},
                                   "pairs": {"can|can't": 2.0}})
        self.assertIn("can/can't", rows[0]["report_md"])

    def test_llm_success_with_code_fence(self):
        fenced = "```json\n%s\n```" % json.dumps(VALID_BODY, ensure_ascii=False)
        with mock.patch.object(analyze, "_run_claude", return_value=(0, _envelope(fenced))):
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "llm")

    def test_llm_weights_satisfy_drill_contract(self):
        with mock.patch.object(analyze, "_run_claude",
                               return_value=(0, _envelope(json.dumps(VALID_BODY, ensure_ascii=False)))):
            analyze.analyze(self.conn, self.today)
        w = drill._load_weights(self.conn)
        self.assertIsNotNone(w)  # drill の受け口スキーマ検証を通る
        # c1 は blank answer can't + choices に can を含む → pairs 重みが乗る
        clip = self.conn.execute(
            "SELECT id, blanks, feature_tags FROM clips WHERE id='c1'").fetchone()
        self.assertAlmostEqual(drill._clip_weight(w, clip), 1.8 * 2.0)

    # ---- 失敗 3 態 → fallback 1 回確定 ----

    def test_rc_nonzero_falls_back(self):
        with mock.patch.object(analyze, "_run_claude", return_value=(1, "")) as m:
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "fallback")
        self.assertEqual(m.call_count, 1)  # リトライしない
        self.assertEqual(self._analysis_rows()[0]["source"], "fallback")

    def test_invalid_result_json_falls_back(self):
        with mock.patch.object(analyze, "_run_claude",
                               return_value=(0, _envelope("すみません、JSON では出せません"))) as m:
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "fallback")
        self.assertEqual(m.call_count, 1)

    def test_schema_ng_falls_back(self):
        body = {"report_md": "ok", "weights": {"feature_tags": {"weak_form": 1.5}}}  # pairs 欠落
        with mock.patch.object(analyze, "_run_claude",
                               return_value=(0, _envelope(json.dumps(body)))) as m:
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "fallback")
        self.assertEqual(m.call_count, 1)

    def test_broken_envelope_falls_back(self):
        with mock.patch.object(analyze, "_run_claude", return_value=(0, "not-an-envelope")):
            source = analyze.analyze(self.conn, self.today)
        self.assertEqual(source, "fallback")

    # ---- fallback の中身 ----

    def test_fallback_weights_and_report(self):
        source = analyze.analyze(self.conn, self.today, force_fallback=True)
        self.assertEqual(source, "fallback")
        row = self._analysis_rows()[0]
        weights = json.loads(row["weights"])
        # weak_form: total 2 / wrong 1 → 1 + 0.5
        self.assertEqual(weights, {"feature_tags": {"weak_form": 1.5}, "pairs": {}})
        self.assertIn("正答率 33% (1/3)", row["report_md"])
        self.assertIn("weak_form", row["report_md"])
        # fallback weights も drill の受け口を通る
        self.assertIsNotNone(drill._load_weights(self.conn))

    def test_same_day_rerun_replaces_row(self):
        analyze.analyze(self.conn, self.today, force_fallback=True)
        with mock.patch.object(analyze, "_run_claude",
                               return_value=(0, _envelope(json.dumps(VALID_BODY, ensure_ascii=False)))):
            analyze.analyze(self.conn, self.today)
        rows = self._analysis_rows()
        self.assertEqual(len(rows), 1)  # date PK の INSERT OR REPLACE
        self.assertEqual(rows[0]["source"], "llm")

    # ---- attempts ゼロ ----

    def test_no_attempts_writes_nothing(self):
        self.conn.execute("DELETE FROM attempts")
        self.conn.commit()
        with mock.patch.object(analyze, "_run_claude") as m:
            source = analyze.analyze(self.conn, self.today)
        self.assertIsNone(source)
        self.assertEqual(m.call_count, 0)  # claude を呼ばない (クォータ節約)
        self.assertEqual(self._analysis_rows(), [])


class ValidateOutputUnitTest(unittest.TestCase):
    """validate_output のスキーマ契約 (§3.4) を単体で見る。"""

    def _base(self, **over):
        data = {"report_md": "r", "weights": {"feature_tags": {}, "pairs": {}}}
        data.update(over)
        return data

    def test_accepts_minimal_valid(self):
        report, weights = analyze.validate_output(self._base())
        self.assertEqual(report, "r")
        self.assertEqual(weights, {"feature_tags": {}, "pairs": {}})

    def test_rejects_non_dict(self):
        self.assertIsNone(analyze.validate_output(["not", "dict"]))

    def test_rejects_empty_report(self):
        self.assertIsNone(analyze.validate_output(self._base(report_md="  ")))

    def test_rejects_missing_weights_keys(self):
        self.assertIsNone(analyze.validate_output(
            {"report_md": "r", "weights": {"feature_tags": {}}}))

    def test_rejects_bad_weight_values(self):
        for bad in (0, -1, True, "1.5", float("nan"), float("inf")):
            data = self._base(weights={"feature_tags": {"weak_form": bad}, "pairs": {}})
            self.assertIsNone(analyze.validate_output(data), repr(bad))

    def test_rejects_bad_pair_keys(self):
        for bad_key in ("can", "can|", "|can't", "a|b|c"):
            data = self._base(weights={"feature_tags": {}, "pairs": {bad_key: 1.5}})
            self.assertIsNone(analyze.validate_output(data), bad_key)

    def test_normalizes_unsorted_pair_key(self):
        data = self._base(weights={"feature_tags": {}, "pairs": {"they're|their": 1.5}})
        _, weights = analyze.validate_output(data)
        self.assertEqual(weights["pairs"], {"their|they're": 1.5})


if __name__ == "__main__":
    unittest.main()
