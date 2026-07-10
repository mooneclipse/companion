#!/usr/bin/env python3
"""subs.py / clips.py の合成データ検証 (実弾 yt-dlp ダウンロードはしない、ffmpeg testsrc のみ使用)。

一時ファイルは pipeline/tests/_scratch/ (.gitignore 済み) に作る。common モジュールの
ROOT/EPISODES_DIR/SUBS_DIR/SUBS_RAW_DIR/CLIPS_DIR をテスト中だけ差し替えて実プロジェクトの
media/ を汚さない (WORDLISTS_DIR は実ファイルのまま、実運用の wordlists を検証対象にする)。

実行: `python3 -m unittest pipeline.tests.test_pipeline -v` または
      `python3 pipeline/tests/test_pipeline.py`
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

TESTS_DIR = pathlib.Path(__file__).resolve().parent
PIPELINE_DIR = TESTS_DIR.parent
SCRATCH = TESTS_DIR / "_scratch"

sys.path.insert(0, str(PIPELINE_DIR))
import common  # noqa: E402
import subs    # noqa: E402
import clips   # noqa: E402

RAW_VTT = """WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
a long time ago

00:00:02.000 --> 00:00:02.010
a long time ago

00:00:02.010 --> 00:00:05.000
a long time ago in a galaxy far far away.

00:00:08.000 --> 00:00:10.000
gonna need a bigger boat

00:00:10.000 --> 00:00:10.010
gonna need a bigger boat

00:00:10.010 --> 00:00:13.000
gonna need a bigger boat kinda thing right for the crew

00:00:13.000 --> 00:00:16.000
gonna need a bigger boat kinda thing right for the crew we're gonna be here.

00:00:20.000 --> 00:00:22.000
nothing else matters

00:00:26.000 --> 00:00:28.000
the end

00:00:32.000 --> 00:00:34.000
[drum roll] -Well hello there.

00:00:36.000 --> 00:00:37.000
(laughs)
"""

# sentence1 ([0.0,5.0]) / sentence2 ([8.0,16.0]) の区間にちょうど重なる ja 手動字幕。
# clips.translation の抽出 (cue 重なり判定 + en と同じ効果音注記清掃) を実データ経路で検証する。
JA_RAW_VTT = """WEBVTT

00:00:00.000 --> 00:00:05.000
むかしむかし、遠い銀河で。

00:00:08.000 --> 00:00:16.000
もっと大きい船が要るぞ、って感じだよね [笑い]
"""


class PipelineSyntheticTest(unittest.TestCase):
    """subs.py → clips.py を合成 VTT + ffmpeg testsrc のダミー動画で実走させる。"""

    @classmethod
    def setUpClass(cls):
        if shutil.which("ffmpeg") is None:
            raise unittest.SkipTest("ffmpeg not found")
        if SCRATCH.exists():
            shutil.rmtree(SCRATCH)
        SCRATCH.mkdir(parents=True)

        # common モジュールのパス定数をスクラッチ配下に差し替える (WORDLISTS_DIR は実ファイルのまま)
        cls._orig = {
            "ROOT": common.ROOT, "MEDIA_DIR": common.MEDIA_DIR,
            "EPISODES_DIR": common.EPISODES_DIR, "SUBS_DIR": common.SUBS_DIR,
            "SUBS_RAW_DIR": common.SUBS_RAW_DIR, "CLIPS_DIR": common.CLIPS_DIR,
        }
        common.ROOT = SCRATCH
        common.MEDIA_DIR = SCRATCH / "media"
        common.EPISODES_DIR = common.MEDIA_DIR / "episodes"
        common.SUBS_DIR = common.MEDIA_DIR / "subs"
        common.SUBS_RAW_DIR = common.SUBS_DIR / "raw"
        common.CLIPS_DIR = common.MEDIA_DIR / "clips"
        for d in (common.EPISODES_DIR, common.SUBS_RAW_DIR, common.CLIPS_DIR):
            d.mkdir(parents=True, exist_ok=True)

        cls.db_path = SCRATCH / "test.db"
        cls.video_path = common.EPISODES_DIR / "ep1.mp4"
        cls._make_dummy_video(cls.video_path, duration=40)

        raw_vtt_path = common.SUBS_RAW_DIR / "ep1.en.vtt"
        raw_vtt_path.write_text(RAW_VTT, encoding="utf-8")
        ja_vtt_path = common.SUBS_RAW_DIR / "ep1.ja.vtt"
        ja_vtt_path.write_text(JA_RAW_VTT, encoding="utf-8")

        conn = common.open_db(str(cls.db_path))
        conn.execute("INSERT INTO series (id, title, sort) VALUES ('test','Test Series',0)")
        conn.execute(
            "INSERT INTO episodes (id, series_id, title, source_url, duration_s, video_path, "
            "sub_path, sub_kind, sort_key, ingested_at) VALUES "
            "('ep1','test','Test Ep1',NULL,40,?,NULL,'auto','0001',0)",
            (str(cls.video_path.relative_to(common.ROOT)),))
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        for key, value in cls._orig.items():
            setattr(common, key, value)
        shutil.rmtree(SCRATCH, ignore_errors=True)

    @staticmethod
    def _make_dummy_video(path, duration):
        argv = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=%d:size=320x240:rate=15" % duration,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-shortest", "-c:v", "libx264", "-preset", "veryfast",
            "-c:a", "aac", "-t", str(duration), str(path),
        ]
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if p.returncode != 0 or not path.is_file():
            raise RuntimeError("dummy video creation failed: %s" % p.stderr[-500:])

    def test_01_subs_produces_clean_vtt_and_sentences(self):
        done, failed = subs.process_all(db_path=str(self.db_path))
        self.assertEqual((done, failed), (1, 0))

        clean_vtt = common.SUBS_DIR / "ep1.vtt"
        sentences_path = common.SUBS_DIR / "ep1.sentences.json"
        self.assertTrue(clean_vtt.is_file())
        self.assertTrue(sentences_path.is_file())

        with open(sentences_path, encoding="utf-8") as f:
            sentences = json.load(f)
        # raw VTT には注記のみの cue ("(laughs)") が 1 本あり、清掃後に空文になって
        # clips.py 入力からは除外される (6 cue 由来 → 5 文)。
        self.assertEqual(len(sentences), 5)
        self.assertEqual(sentences[0]["text"], "a long time ago in a galaxy far far away.")
        self.assertAlmostEqual(sentences[0]["start"], 0.0, places=2)
        self.assertAlmostEqual(sentences[0]["end"], 5.0, places=2)

        self.assertTrue(sentences[1]["text"].startswith("gonna need a bigger boat"))
        self.assertTrue(sentences[1]["text"].endswith("we're gonna be here."))
        self.assertAlmostEqual(sentences[1]["start"], 8.0, places=2)
        self.assertAlmostEqual(sentences[1]["end"], 16.0, places=2)

        # gap (>=2.5s) 区切りで閉じた文と is_last で閉じた文
        self.assertEqual(sentences[2]["text"], "nothing else matters")
        self.assertEqual(sentences[3]["text"], "the end")

        # 角括弧注記 + 行頭話者ダッシュの除去 ("[drum roll] -Well hello there." → "Well hello there.")
        self.assertEqual(sentences[4]["text"], "Well hello there.")
        for s in sentences:
            self.assertNotIn("[", s["text"])
            self.assertNotIn("(", s["text"])
            self.assertFalse(s["text"].startswith("-"))

        # プレイヤー用クリーン VTT 側は注記を残す (聴覚情報として有用、team-lead 指示)
        vtt_text = clean_vtt.read_text(encoding="utf-8")
        self.assertIn("[drum roll]", vtt_text)
        self.assertIn("(laughs)", vtt_text)

        conn = common.open_db(str(self.db_path))
        row = conn.execute("SELECT sub_path FROM episodes WHERE id='ep1'").fetchone()
        conn.close()
        self.assertEqual(row["sub_path"], "media/subs/ep1.vtt")

        # 冪等性: 2 回目は 0/0 (sub_path 済みなので再処理しない)
        done2, failed2 = subs.process_all(db_path=str(self.db_path))
        self.assertEqual((done2, failed2), (0, 0))

        # --force: sub_path 済みでも raw から再クリーニングする
        done3, failed3 = subs.process_all(db_path=str(self.db_path), force=True, episode_id="ep1")
        self.assertEqual((done3, failed3), (1, 0))

    def test_02_clips_generates_expected_blanks_and_choices(self):
        made, skipped = clips.process_all(db_path=str(self.db_path))
        # sentence1 (10語/5秒) と sentence2 (15語/8秒) の 2 本が対象文条件を満たす。
        # sentence3/4 は 5 語未満で候補から外れる (skipped_no_blank にはカウントされない)。
        self.assertEqual(made, 2)

        conn = common.open_db(str(self.db_path))
        clip_rows = {r["id"]: r for r in conn.execute("SELECT * FROM clips WHERE episode_id='ep1'")}
        conn.close()
        self.assertEqual(len(clip_rows), 2)
        self.assertIn("ep1-0", clip_rows)      # sentence1 start=0.0s -> start_ms=0
        self.assertIn("ep1-8000", clip_rows)   # sentence2 start=8.0s -> start_ms=8000

        for clip_id, row in clip_rows.items():
            with self.subTest(clip_id=clip_id):
                video_path = common.ROOT / row["video_path"]
                self.assertTrue(video_path.is_file())
                self.assertGreater(video_path.stat().st_size, 0)

                tokens = json.loads(row["tokens"])
                self.assertEqual(tokens, row["text"].split())
                blanks = json.loads(row["blanks"])
                self.assertGreaterEqual(len(blanks), 1)
                self.assertLessEqual(len(blanks), 3)
                for b in blanks:
                    self.assertIn(b["idx"], range(len(tokens)))
                    self.assertEqual(len(b["choices"]), 4)
                    self.assertEqual(len(set(b["choices"])), 4)
                    self.assertIn(b["answer"], b["choices"])
                # 空欄同士は index 差 3 以上
                idxs = sorted(b["idx"] for b in blanks)
                for a, bb in zip(idxs, idxs[1:]):
                    self.assertGreaterEqual(bb - a, 3)

        s1 = clip_rows["ep1-0"]
        blanks1 = json.loads(s1["blanks"])
        self.assertEqual(blanks1, [{"idx": 0, "answer": "a",
                                     "choices": blanks1[0]["choices"]}])
        # ja raw VTT の重なり cue から抽出 (§3.3 の重なり判定 + en と同じ注記清掃)
        self.assertEqual(s1["translation"], "むかしむかし、遠い銀河で。")

        s2 = clip_rows["ep1-8000"]
        blanks2 = json.loads(s2["blanks"])
        self.assertEqual([b["idx"] for b in blanks2], [0, 5])
        self.assertEqual([b["answer"] for b in blanks2], ["gonna", "kinda"])
        self.assertIn("going", blanks2[0]["choices"])   # confusions.json: gonna/going
        self.assertIn("kind", blanks2[1]["choices"])    # confusions.json: kinda/kind
        self.assertEqual(json.loads(s2["feature_tags"]), ["weak_form"])
        self.assertEqual(s2["translation"], "もっと大きい船が要るぞ、って感じだよね")  # 注記除去

        # 冪等性: 2 回目は新規クリップを作らない
        made2, _ = clips.process_all(db_path=str(self.db_path))
        self.assertEqual(made2, 0)
        conn = common.open_db(str(self.db_path))
        count = conn.execute("SELECT COUNT(*) AS c FROM clips WHERE episode_id='ep1'").fetchone()["c"]
        conn.close()
        self.assertEqual(count, 2)

    def test_03_clips_rebuild_replaces_existing_clips(self):
        conn = common.open_db(str(self.db_path))
        before = conn.execute("SELECT COUNT(*) AS c FROM clips WHERE episode_id='ep1'").fetchone()["c"]
        conn.close()
        self.assertEqual(before, 2)

        old_video_paths = [common.CLIPS_DIR / "ep1-0.mp4", common.CLIPS_DIR / "ep1-8000.mp4"]
        for p in old_video_paths:
            self.assertTrue(p.is_file())
            p.write_bytes(b"garbage")  # 実体が「削除して作り直された」ことを確認するための細工

        made, skipped = clips.rebuild_episode("ep1", db_path=str(self.db_path))
        self.assertEqual(made, 2)

        conn = common.open_db(str(self.db_path))
        after = conn.execute("SELECT COUNT(*) AS c FROM clips WHERE episode_id='ep1'").fetchone()["c"]
        conn.close()
        self.assertEqual(after, 2)  # 重複登録されない (削除してから作り直す契約どおり)

        for p in old_video_paths:
            self.assertTrue(p.is_file())
            self.assertGreater(p.stat().st_size, len(b"garbage"))  # garbage でなく実際の mp4 に戻っている

        with self.assertRaises(ValueError):
            clips.rebuild_episode("no-such-episode", db_path=str(self.db_path))

    def test_04_rebuild_with_attempts_does_not_violate_fk_and_keeps_attempts(self):
        # code-reviewer 指摘の再現: attempts が clips を参照している状態で rebuild しても
        # FOREIGN KEY constraint failed で落ちない・attempts は消えない・孤児 mp4 も残らない。
        conn = common.open_db(str(self.db_path))
        conn.execute(
            "INSERT INTO attempts (clip_id, ts, results, flags, replays, duration_ms) "
            "VALUES ('ep1-0', 0, '[]', '[]', 0, 0)")
        conn.execute(
            "INSERT INTO attempts (clip_id, ts, results, flags, replays, duration_ms) "
            "VALUES ('ep1-8000', 0, '[]', '[]', 0, 0)")
        conn.commit()
        attempts_before = conn.execute("SELECT COUNT(*) AS c FROM attempts").fetchone()["c"]
        conn.close()
        self.assertEqual(attempts_before, 2)

        made, skipped = clips.rebuild_episode("ep1", db_path=str(self.db_path))
        self.assertEqual(made, 2)  # FK 違反なく再生成できる

        conn = common.open_db(str(self.db_path))
        attempts_after = conn.execute("SELECT COUNT(*) AS c FROM attempts").fetchone()["c"]
        clip_ids_after = {r["id"] for r in
                           conn.execute("SELECT id FROM clips WHERE episode_id='ep1'")}
        fk_ok = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        conn.close()
        self.assertEqual(attempts_after, 2)                    # attempts は消えない
        self.assertEqual(clip_ids_after, {"ep1-0", "ep1-8000"})  # 同一 id で再生成される
        self.assertEqual(fk_ok, 1)  # コネクションの FK enforcement は ON に戻っている

        # 孤児 mp4 なし (CLIPS_DIR の実体は現在の clips 行と過不足なく対応する)
        disk_ids = {p.stem for p in common.CLIPS_DIR.glob("*.mp4")}
        self.assertEqual(disk_ids, clip_ids_after)

    def test_05_fill_translations_updates_without_touching_mp4(self):
        # translation 列を一旦 NULL に落としてから --fill-translations で埋め直し、
        # 「再エンコードなし・UPDATE のみ」(mp4 の mtime/内容が変わらない) を確認する。
        conn = common.open_db(str(self.db_path))
        conn.execute("UPDATE clips SET translation=NULL WHERE episode_id='ep1'")
        conn.commit()
        conn.close()

        mp4_path = common.CLIPS_DIR / "ep1-0.mp4"
        before_mtime = mp4_path.stat().st_mtime_ns
        before_bytes = mp4_path.read_bytes()

        filled, skipped = clips.fill_translations("ep1", db_path=str(self.db_path))
        self.assertEqual((filled, skipped), (2, 0))

        conn = common.open_db(str(self.db_path))
        rows = {r["id"]: r["translation"] for r in
                conn.execute("SELECT id, translation FROM clips WHERE episode_id='ep1'")}
        conn.close()
        self.assertEqual(rows["ep1-0"], "むかしむかし、遠い銀河で。")
        self.assertEqual(rows["ep1-8000"], "もっと大きい船が要るぞ、って感じだよね")

        self.assertEqual(mp4_path.stat().st_mtime_ns, before_mtime)  # mp4 は re-encode されない
        self.assertEqual(mp4_path.read_bytes(), before_bytes)

        with self.assertRaises(ValueError):
            clips.fill_translations("no-such-episode", db_path=str(self.db_path))

    def test_06_fill_translations_no_ja_subtitle_returns_zero(self):
        # ep2: en 字幕のみ (ja raw VTT を置かない) の episode で fill-translations を叩くと
        # 0/0 で終わる (例外にしない、§3.3 docstring どおり)。
        conn = common.open_db(str(self.db_path))
        conn.execute(
            "INSERT INTO series (id, title, sort) VALUES ('test2','Test Series 2',1)")
        conn.execute(
            "INSERT INTO episodes (id, series_id, title, source_url, duration_s, video_path, "
            "sub_path, sub_kind, sort_key, ingested_at) VALUES "
            "('ep2','test2','Test Ep2',NULL,10,'media/episodes/ep1.mp4',NULL,'auto','0001',0)")
        conn.commit()
        conn.close()

        filled, skipped = clips.fill_translations("ep2", db_path=str(self.db_path))
        self.assertEqual((filled, skipped), (0, 0))


class ClipsUnitTest(unittest.TestCase):
    """ffmpeg/DB を使わない純粋ロジックの単体テスト。"""

    def test_eligible_indices_exclusion_rules(self):
        weak_forms = {"gonna", "kinda"}
        common2000 = {"averylongword"}  # 13 文字ちょうど (>=13 除外の境界テスト)
        tokens = ["Gonna", "kinda", "cann0t", "averylongword", "ok"]
        eligible = clips._eligible_indices(tokens, weak_forms, common2000)
        self.assertEqual(eligible, [(1, "weak")])

    def test_normalize_word_converts_curly_apostrophe(self):
        # server/app.py normalize_answer の _APOSTROPHES と対称にする (team-lead 指示)
        self.assertEqual(clips._normalize_word("can’t"), "can't")
        self.assertEqual(clips._normalize_word("we’re"), "we're")
        self.assertEqual(clips._normalize_word("‘sup"), "'sup")
        # 直立アポストロフィの既存挙動は変わらない
        self.assertEqual(clips._normalize_word("can't"), "can't")

    def test_eligible_indices_recognizes_curly_apostrophe_weak_form(self):
        # Bee and PuppyCat 等の手動字幕で can’t (カーリー) が weak_forms (can't, 直立) に
        # 一致せず静かに脱落する不具合の回帰テスト
        weak_forms = {"can't"}
        common2000 = set()
        tokens = ["I", "can’t", "go"]
        eligible = clips._eligible_indices(tokens, weak_forms, common2000)
        self.assertEqual(eligible, [(1, "weak")])

    def test_extract_translation_joins_overlapping_cues_and_cleans(self):
        ja_cues = [
            {"start": 0.0, "end": 2.0, "text": "むかしむかし"},
            {"start": 2.0, "end": 5.0, "text": "遠い銀河で。 [ため息]"},
            {"start": 8.0, "end": 10.0, "text": "-もっと大きい船が要る"},
        ]
        # クリップ区間 [0.0, 5.0] に完全に重なる先頭2 cue のみ結合、効果音注記も除去される
        self.assertEqual(clips._extract_translation(ja_cues, 0.0, 5.0),
                          "むかしむかし 遠い銀河で。")
        # 重なりなし
        self.assertIsNone(clips._extract_translation(ja_cues, 20.0, 25.0))
        # 部分重なり (cue.start < end_s and cue.end > start_s) + 先頭ダッシュ除去
        self.assertEqual(clips._extract_translation(ja_cues, 9.0, 12.0), "もっと大きい船が要る")
        # cue が無い (ja 字幕自体が無い) 場合は None
        self.assertIsNone(clips._extract_translation(None, 0.0, 5.0))
        self.assertIsNone(clips._extract_translation([], 0.0, 5.0))

    def test_load_ja_cues_missing_file_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(clips._load_ja_cues(pathlib.Path(d) / "missing.ja.vtt"))

    def test_load_ja_cues_parses_and_dedupes_scroll(self):
        vtt = (
            "WEBVTT\n\n"
            "00:00:00.000 --> 00:00:02.000\nこんにちは\n\n"
            "00:00:02.000 --> 00:00:02.010\nこんにちは\n\n"
            "00:00:02.010 --> 00:00:04.000\nこんにちは、元気ですか。\n"
        )
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "ep.ja.vtt"
            path.write_text(vtt, encoding="utf-8")
            cues = clips._load_ja_cues(path)
            self.assertEqual(len(cues), 1)  # ロールアップ重複が畳み込まれる
            self.assertEqual(cues[0]["text"], "こんにちは、元気ですか。")

    def test_select_candidate_sentences_filters_and_samples(self):
        # 4-12s かつ 5-25 語のみ通過する
        sentences = [
            {"text": "too short a clip", "start": 0, "end": 1},          # 1s: 短すぎる
            {"text": " ".join(["word"] * 30), "start": 0, "end": 8},     # 30語: 多すぎる
            {"text": " ".join(["word"] * 6), "start": 0, "end": 5},      # OK
        ]
        picked = clips._select_candidate_sentences(sentences)
        self.assertEqual(len(picked), 1)
        self.assertIs(picked[0], sentences[2])

    def test_select_candidate_sentences_caps_at_40_even_sampling(self):
        sentences = [{"text": " ".join(["word"] * 6), "start": i * 10, "end": i * 10 + 5}
                     for i in range(100)]
        picked = clips._select_candidate_sentences(sentences)
        self.assertLessEqual(len(picked), 40)
        self.assertEqual(picked[0], sentences[0])
        self.assertEqual(picked[-1], sentences[-1])


class SubsAnnotationCleanupUnitTest(unittest.TestCase):
    """subs._clean_clip_text / to_clip_sentences の純粋ロジック単体テスト。"""

    def test_removes_bracket_and_paren_annotations(self):
        self.assertEqual(subs._clean_clip_text("Hello [drum roll] there my friend."),
                          "Hello there my friend.")
        self.assertEqual(subs._clean_clip_text("Hello (laughs) there."), "Hello there.")

    def test_removes_leading_speaker_dash(self):
        self.assertEqual(subs._clean_clip_text("-Welcome to the show."), "Welcome to the show.")
        # 角括弧除去で初めて行頭に来るダッシュも拾う
        self.assertEqual(subs._clean_clip_text("[music] -Welcome to the show."),
                          "Welcome to the show.")

    def test_annotation_only_text_becomes_empty(self):
        self.assertEqual(subs._clean_clip_text("[drum roll]"), "")
        self.assertEqual(subs._clean_clip_text("(laughs)"), "")

    def test_dash_inside_word_not_touched(self):
        # 行頭以外のハイフン (複合語等) は除去対象ではない
        self.assertEqual(subs._clean_clip_text("a well-known fact."), "a well-known fact.")

    def test_removes_compound_dash_bracket_dash(self):
        # TADC Ep1 実データで見つかったパターン: 角括弧除去で新たな行頭ダッシュが露出する
        self.assertEqual(
            subs._clean_clip_text("-[Kaufmo growls] -Uh, it might be that terrible thing."),
            "Uh, it might be that terrible thing.")
        # 全部が注記 (ダッシュ+角括弧のみ) の場合は空文字になる
        self.assertEqual(
            subs._clean_clip_text("[panting] [Kaufmo roars] -[yelps] -[shouting, panting]"), "")

    def test_removes_leading_colon_after_label_bracket(self):
        # team-lead 裁定: [Kinger]: のようなラベル角括弧除去後に残るコロンも同じ先頭清掃対象
        self.assertEqual(
            subs._clean_clip_text("[Kinger]: Well, as a royal myself, I would like to ask."),
            "Well, as a royal myself, I would like to ask.")

    def test_removes_leading_semicolon_and_comma(self):
        self.assertEqual(subs._clean_clip_text("; leftover semicolon."), "leftover semicolon.")
        self.assertEqual(subs._clean_clip_text(", leftover comma."), "leftover comma.")

    def test_leading_apostrophe_not_touched(self):
        # 'Cause... のような正当な省略形の先頭アポストロフィは対象外
        self.assertEqual(subs._clean_clip_text("'Cause if it's a new character."),
                          "'Cause if it's a new character.")

    def test_to_clip_sentences_filters_empty_and_preserves_timing(self):
        sentences = [
            {"text": "[drum roll] -Well hello there.", "start": 1.0, "end": 3.0},
            {"text": "(laughs)", "start": 4.0, "end": 5.0},
            {"text": "plain sentence here.", "start": 6.0, "end": 8.0},
        ]
        out = subs.to_clip_sentences(sentences)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {"text": "Well hello there.", "start": 1.0, "end": 3.0})
        self.assertEqual(out[1], {"text": "plain sentence here.", "start": 6.0, "end": 8.0})


if __name__ == "__main__":
    unittest.main()
