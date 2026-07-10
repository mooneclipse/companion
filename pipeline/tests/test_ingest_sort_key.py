#!/usr/bin/env python3
"""ingest._entry_sort_key の話数順キー検証 (ネットワーク・DB なしの純粋関数テスト)。

背景: 単一動画 URL は playlist_index が無く upload_date フォールバックに落ちるが、
同日公開 (実測: Bee and PuppyCat Ep1/Ep2 = 20141107) で同値タイになり、
server の `ORDER BY e.sort_key` だけでは一覧の表示順が不定になる。
sources.json のエントリ順 (source_order) を 0 埋めサフィックスで焼き込み、
安定タイブレークとして効かせる。

実行: `python3 -m unittest pipeline.tests.test_ingest_sort_key -v` または
      `python3 pipeline/tests/test_ingest_sort_key.py`
"""
import pathlib
import sys
import unittest

TESTS_DIR = pathlib.Path(__file__).resolve().parent
PIPELINE_DIR = TESTS_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))
import ingest  # noqa: E402


class EntrySortKeyTest(unittest.TestCase):

    def test_playlist_index_wins(self):
        """playlist_index があれば source_order に依らずそれを使う (4 桁 0 埋め)。"""
        entry = {"playlist_index": 2, "upload_date": "20141107", "id": "zzz"}
        self.assertEqual(ingest._entry_sort_key(entry, source_order=99), "0002")

    def test_playlist_index_bool_is_ignored(self):
        """bool は int のサブクラスだが index として扱わない (既存挙動の維持)。"""
        entry = {"playlist_index": True, "upload_date": "20141107"}
        self.assertEqual(ingest._entry_sort_key(entry, source_order=3), "20141107-0003")

    def test_same_upload_date_tiebreak_by_source_order(self):
        """同日公開 (BPC Ep1/Ep2 実測ケース) でも sources.json のエントリ順で全順序が付く。"""
        ep1 = {"id": "KNs9shgQ2rI", "upload_date": "20141107"}   # Ep1 Food
        ep2 = {"id": "LugwQtPdkKU", "upload_date": "20141107"}   # Ep2 Farmer
        k1 = ingest._entry_sort_key(ep1, source_order=9)
        k2 = ingest._entry_sort_key(ep2, source_order=10)
        self.assertNotEqual(k1, k2)
        self.assertLess(k1, k2)
        # video_id 辞書順 (K... < L... はたまたま正順) に依存していないことを、
        # id を入れ替えても順序が変わらないことで確認する
        k1_swapped = ingest._entry_sort_key(dict(ep1, id=ep2["id"]), source_order=9)
        k2_swapped = ingest._entry_sort_key(dict(ep2, id=ep1["id"]), source_order=10)
        self.assertLess(k1_swapped, k2_swapped)

    def test_different_upload_date_dominates_source_order(self):
        """upload_date が違えばエントリ順に関係なく日付順 (サフィックスは prefix 順を壊さない)。"""
        older = ingest._entry_sort_key({"upload_date": "20141107"}, source_order=9999)
        newer = ingest._entry_sort_key({"upload_date": "20141114"}, source_order=0)
        self.assertLess(older, newer)

    def test_legacy_suffixless_key_keeps_position(self):
        """既存 DB 行 (サフィックスなし旧形式、例: TADC Ep1 = '20231013') は再計算せず、
        新形式キーと混在しても日付順が保たれる。同日なら旧形式が先 (短い prefix)。"""
        legacy_ep1 = "20231013"  # 実 DB の TADC Ep1 sort_key
        new_ep2 = ingest._entry_sort_key({"upload_date": "20240503"}, source_order=1)
        self.assertLess(legacy_ep1, new_ep2)
        same_day_new = ingest._entry_sort_key({"upload_date": "20231013"}, source_order=5)
        self.assertLess(legacy_ep1, same_day_new)

    def test_no_upload_date_falls_to_source_order_tail(self):
        """upload_date も無いエントリは id に依存せず、'~' prefix で日付付きの後ろに
        エントリ順で並ぶ。"""
        k = ingest._entry_sort_key({"id": "AAAAAAA"}, source_order=7)
        self.assertEqual(k, "~0007")
        dated = ingest._entry_sort_key({"upload_date": "29991231"}, source_order=0)
        self.assertLess(dated, k)

    def test_playlist_key_sorts_before_dated_key(self):
        """playlist_index 形式 ('0001') と日付形式の混在時、playlist 形式が先に来る
        (既存挙動の維持 — 同一シリーズで混在させない運用が前提)。"""
        self.assertLess(ingest._entry_sort_key({"playlist_index": 1}),
                        ingest._entry_sort_key({"upload_date": "20141107"}, source_order=0))


if __name__ == "__main__":
    unittest.main()
