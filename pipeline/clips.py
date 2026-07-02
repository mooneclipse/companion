#!/usr/bin/env python3
"""companion-english パイプライン第3段 — クリップ切り出し + 穴埋め生成 (設計 §3.3)。

対象: episodes.sub_path が設定済み (= subs.py 済み) の各話について、対応する
`media/subs/<id>.sentences.json` ([{"text","start","end"}, ...]) から条件を満たす文を選び、
ffmpeg でクリップ動画を切り出し、穴埋め (tokens/blanks) を生成して DB に登録する。

対象文: 4〜12 秒 かつ 5〜25 語 (text.split() の語数)。エピソードあたり最大 40 本、
超過時は時系列順に等間隔サンプリングする。

トークン化は text.split() の 1 方式のみ。ここで確定した語配列を clips.tokens に保存し、
blanks.idx はこの配列の添字 (サーバ・UI は保存済み tokens をそのまま使い、text から
再トークン化しない — 規則がずれると空欄位置が壊れる)。

穴埋め対象の選定 (ルールベース、LLM 不使用):
  対象語プール = (wordlists/weak_forms.txt に載る語 [最優先] または
                  wordlists/common2000.txt に載る語 [次点]) かつ
                 (文中大文字始まり [固有名詞扱い] でない・13 文字未満・数字を含まない)
  eligible プールから weak_forms 優先で空欄を選び、既存の空欄と語順で 3 語以上離れているものだけ
  採用する (index 差 >= MIN_BLANK_GAP)。空欄数は語数 <=10 で1, <=18 で2, それ以上で3。
  eligible が空ならそのクリップは作らない。

誤答肢 (choices 4 択、blanks[].answer は正規化した canonical 小文字語 — 表示や採点の基準を
tokens の生テキストでなくここに揃える): wordlists/confusions.json の音韻混同グループ優先、
不足分は weak_forms+common2000 プールからランダム補充。正解位置はシャッフル。

confusions.json の形式: {"groups": [[word, word, ...], ...]} — 内側配列 1 つが
「聞き分けにくい語の集合」(大小無視でマッチ)。

`--rebuild <episode_id>` で指定 episode の clips (DB行+media/clips 実体) を集合で削除して
から再生成できる (wordlists/subs.py の清掃規則変更を既存クリップに反映させる作り直し用)。

日本語訳 (clips.translation、設計 english-design.md team-lead 指示):
  ingest.py が best-effort で取得した手動 ja 字幕 (`media/subs/raw/<id>.ja.vtt`、無ければ
  スキップされ翻訳は NULL のまま) から、クリップの [start_s, end_s] と重なる ja cue を
  開始時刻順に連結して 1 クリップぶんの訳文にする。重なり判定は
  `cue.start < end_s and cue.end > start_s` (半開区間の交差判定)。効果音注記除去・行頭残渣
  除去は en と同じ `subs._clean_clip_text` を連結後のテキストに 1 回適用する。
  `--fill-translations <episode_id>` で、既存クリップ (mp4 は変更しない) の translation 列
  だけを UPDATE で埋め直せる (再エンコードなしのバックフィル用)。
"""
import argparse
import json
import os
import pathlib
import random
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common  # noqa: E402
import subs    # noqa: E402  (ja cue の parse_vtt/dedupe_scroll/_clean_clip_text 再利用)

FFMPEG = os.environ.get("ENGLISH_FFMPEG", "ffmpeg")

MIN_DUR_S, MAX_DUR_S = 4.0, 12.0
MIN_WORDS, MAX_WORDS = 5, 25
PAD_S = 0.3
MAX_CLIPS_PER_EPISODE = 40
MIN_BLANK_GAP = 3          # 空欄同士の最小 index 差
MAX_TOKEN_LEN = 13         # これ以上は除外 (13 文字"以上"除外 = len >= 13)
NUM_CHOICES = 4
CLIP_TIMEOUT = 60

WORD_NORM_RE = re.compile(r"^[^a-zA-Z']+|[^a-zA-Z']+$")
HAS_DIGIT_RE = re.compile(r"\d")
# カーリーアポストロフィ (’ ‘) → 直立アポストロフィ (server/app.py normalize_answer の
# _APOSTROPHES と対称)。手動字幕は can’t のようにカーリーで来ることがあり、正規化しないと
# weak_forms/common2000 との完全一致に失敗して静かに脱落する。
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'"})


def _normalize_word(tok):
    """wordlist 照合用の正規化: カーリーアポストロフィを直立に統一してから、先頭・末尾の
    非英字/非アポストロフィを削り小文字化する。内部のアポストロフィ (can't, we're 等) は
    弱形語の核なので保持する。"""
    tok = tok.translate(_APOSTROPHES)
    return WORD_NORM_RE.sub("", tok).lower()


def _load_wordlist(path):
    words = set()
    if not path.is_file():
        return words
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                words.add(line.lower())
    return words


def _load_confusion_groups(path):
    if not path.is_file():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    groups = data.get("groups") or []
    return [[w.lower() for w in g] for g in groups if isinstance(g, list)]


def _eligible_indices(tokens, weak_forms, common2000):
    """空欄候補 index を [(index, tier)] で返す (tier: "weak" > "common")。"""
    out = []
    for i, tok in enumerate(tokens):
        if not tok:
            continue
        if tok[0].isupper():
            continue  # 固有名詞扱い (文頭の一般語も一律除外、設計 §3.3 の literal な規則)
        if len(tok) >= MAX_TOKEN_LEN:
            continue
        if HAS_DIGIT_RE.search(tok):
            continue
        norm = _normalize_word(tok)
        if not norm:
            continue
        if norm in weak_forms:
            out.append((i, "weak"))
        elif norm in common2000:
            out.append((i, "common"))
    return out


def _blank_target_count(n_tokens):
    if n_tokens <= 10:
        return 1
    if n_tokens <= 18:
        return 2
    return 3


def _pick_blanks(eligible, target, min_gap=MIN_BLANK_GAP):
    weak = [i for i, tier in eligible if tier == "weak"]
    common = [i for i, tier in eligible if tier == "common"]
    chosen = []
    for idx in weak + common:
        if len(chosen) >= target:
            break
        if all(abs(idx - c) >= min_gap for c in chosen):
            chosen.append(idx)
    return sorted(chosen)


def _build_choices(answer, other_answers, confusion_groups, fallback_pool, rng):
    group = None
    for g in confusion_groups:
        if answer in g:
            group = [w for w in g if w != answer]
            break
    candidates = list(group) if group else []
    rng.shuffle(candidates)
    exclude = {answer} | set(other_answers)
    choices = []
    for c in candidates:
        if c not in exclude and c not in choices:
            choices.append(c)
        if len(choices) >= NUM_CHOICES - 1:
            break
    pool = [w for w in fallback_pool if w not in exclude and w not in choices]
    while len(choices) < NUM_CHOICES - 1 and pool:
        pick = rng.choice(pool)
        choices.append(pick)
        pool.remove(pick)
    choices.append(answer)
    rng.shuffle(choices)
    return choices


def _select_candidate_sentences(sentences):
    """4-12秒 かつ 5-25語 の文を抽出し、40 本超は時系列順で等間隔サンプリングする。"""
    candidates = []
    for s in sentences:
        dur = s["end"] - s["start"]
        n_words = len(s["text"].split())
        if MIN_DUR_S <= dur <= MAX_DUR_S and MIN_WORDS <= n_words <= MAX_WORDS:
            candidates.append(s)
    if len(candidates) <= MAX_CLIPS_PER_EPISODE:
        return candidates
    n = len(candidates)
    k = MAX_CLIPS_PER_EPISODE
    idxs = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
    return [candidates[i] for i in idxs]


def _cut_clip(video_path, start, end, out_path):
    """ffmpeg で正確なカット位置の再エンコード切り出し (設計 §3.3 のコマンドそのもの)。"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    argv = [
        FFMPEG, "-y", "-nostdin", "-loglevel", "error",
        "-ss", "%.3f" % start, "-to", "%.3f" % end,
        "-i", str(video_path),
        "-vf", "scale=-2:480",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-c:a", "aac", "-b:a", "96k",
        str(out_path),
    ]
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, timeout=CLIP_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, "ffmpeg failed: %s" % exc
    if p.returncode != 0 or not out_path.is_file() or out_path.stat().st_size == 0:
        tail = (p.stderr or "").strip()[-200:]
        return False, "ffmpeg failed (rc=%s): %s" % (p.returncode, tail)
    return True, None


def build_clip_fields(text, weak_forms, common2000, confusion_groups, fallback_pool, rng):
    """1 文から tokens/blanks/feature_tags を組み立てる。空欄候補が無ければ None を返す。"""
    tokens = text.split()
    eligible = _eligible_indices(tokens, weak_forms, common2000)
    if not eligible:
        return None
    target = _blank_target_count(len(tokens))
    chosen = _pick_blanks(eligible, target)
    if not chosen:
        return None
    answers = [_normalize_word(tokens[i]) for i in chosen]
    blanks = []
    for pos, idx in enumerate(chosen):
        answer = answers[pos]
        other = answers[:pos] + answers[pos + 1:]
        choices = _build_choices(answer, other, confusion_groups, fallback_pool, rng)
        blanks.append({"idx": idx, "answer": answer, "choices": choices})
    feature_tags = ["weak_form"] if any(a in weak_forms for a in answers) else []
    return tokens, blanks, feature_tags


def _load_ja_cues(path):
    """ja raw VTT (path) があれば dedupe 済み cue リスト ([{"start","end","text"}]) を返す。
    ファイルが無い/cue が 1 本も無ければ None (呼び出し側は「訳なし」として扱う)。"""
    if not path.is_file():
        return None
    cues = subs.parse_vtt(path)
    if not cues:
        return None
    return subs.dedupe_scroll(cues)


def _extract_translation(ja_cues, start_s, end_s):
    """[start_s, end_s] と重なる ja cue (cue.start < end_s and cue.end > start_s) を
    開始時刻順に連結し、en と同じ効果音注記/先頭残渣清掃 (subs._clean_clip_text) を
    連結後のテキストに 1 回適用する。重なりが無い/清掃後に空なら None。"""
    if not ja_cues:
        return None
    overlapping = [c for c in ja_cues if c["start"] < end_s and c["end"] > start_s]
    if not overlapping:
        return None
    overlapping.sort(key=lambda c: c["start"])
    joined = " ".join(c["text"] for c in overlapping)
    cleaned = subs._clean_clip_text(joined)
    return cleaned or None


def process_episode(conn, ep, weak_forms, common2000, confusion_groups, fallback_pool):
    video_path = common.ROOT / ep["video_path"]
    sentences_path = common.SUBS_DIR / ("%s.sentences.json" % ep["id"])
    if not sentences_path.is_file():
        return 0, 0, "sentences json not found: %s" % sentences_path
    with open(sentences_path, encoding="utf-8") as f:
        sentences = json.load(f)
    ja_cues = _load_ja_cues(common.SUBS_RAW_DIR / ("%s.ja.vtt" % ep["id"]))
    candidates = _select_candidate_sentences(sentences)
    existing_ids = {row["id"] for row in
                    conn.execute("SELECT id FROM clips WHERE episode_id=?", (ep["id"],))}
    made = skipped_no_blank = 0
    for s in candidates:
        start_ms = int(round(s["start"] * 1000))
        clip_id = "%s-%d" % (ep["id"], start_ms)
        if clip_id in existing_ids:
            continue
        rng = random.Random(clip_id)  # クリップ単位で決定的 (再実行での再現性)
        fields = build_clip_fields(s["text"], weak_forms, common2000, confusion_groups,
                                    fallback_pool, rng)
        if fields is None:
            skipped_no_blank += 1
            continue
        tokens, blanks, feature_tags = fields
        pad_start = max(0.0, s["start"] - PAD_S)
        pad_end = min(float(ep["duration_s"]), s["end"] + PAD_S)
        out_path = common.CLIPS_DIR / ("%s.mp4" % clip_id)
        ok, err = _cut_clip(video_path, pad_start, pad_end, out_path)
        if not ok:
            common.log("FAILED clip %s: %s" % (clip_id, err))
            continue
        n_words = len(tokens)
        dur_min = max((s["end"] - s["start"]) / 60.0, 1e-6)
        wpm = int(round(n_words / dur_min))
        translation = _extract_translation(ja_cues, s["start"], s["end"])
        conn.execute(
            "INSERT INTO clips (id, episode_id, start_s, end_s, video_path, text, tokens, "
            "blanks, wpm, feature_tags, translation) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (clip_id, ep["id"], s["start"], s["end"],
             str(out_path.relative_to(common.ROOT)), s["text"],
             json.dumps(tokens, ensure_ascii=False), json.dumps(blanks, ensure_ascii=False),
             wpm, json.dumps(feature_tags, ensure_ascii=False), translation))
        conn.commit()
        made += 1
    return made, skipped_no_blank, None


def _delete_episode_clips(conn, episode_id):
    """episode の clips を削除し、対応する media/clips 実体を削除する。

    attempts (学習ログ、streak/正答率履歴の源泉) は消さない方針 (code-reviewer 指摘 + team-lead
    裁定)。attempts.clip_id は clips(id) を参照しており CASCADE 指定がないため、素の
    DELETE は attempts が 1 件でもあると FOREIGN KEY constraint failed で失敗する。
    このコネクションに限り (この DELETE の前後だけ) PRAGMA foreign_keys=OFF にして通し、
    該当 clip_id を持つ attempts 行は意図的に孤児として残す (削除しない・追跡もしない —
    attempts 側の FK は「delete 経路をブロックする」以外の意味を持たないため無効化して
    実害はない。なお clip id は episode_id+start_ms で決定的なので、文の開始時刻が変わって
    いなければ再生成後の新しい clips 行が同じ id を持ち、孤児だった attempts は自然に
    再び有効な参照に戻る)。

    削除順序は「DB 行削除 + commit → 実体 unlink」に固定する (逆順だと DELETE 失敗時に
    実体だけ消えて DB 行が残る、より気づきにくい壊れ方をする。実体だけ残ってしまう方の
    失敗は次回 rebuild で一掃されるので安全側)。
    """
    rows = conn.execute("SELECT id FROM clips WHERE episode_id=?", (episode_id,)).fetchall()
    ids = [row["id"] for row in rows]
    if not ids:
        return 0
    conn.execute("PRAGMA foreign_keys=OFF")
    try:
        conn.execute("DELETE FROM clips WHERE episode_id=?", (episode_id,))
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys=ON")
    for clip_id in ids:
        path = common.CLIPS_DIR / ("%s.mp4" % clip_id)
        try:
            path.unlink()
        except OSError:
            pass
    return len(ids)


def rebuild_episode(episode_id, db_path=None):
    """指定 episode の clips (DB行+実体) を削除してから再生成する
    (wordlists/清掃規則の変更を既存クリップに反映させる作り直し用)。"""
    conn = common.open_db(db_path)
    ep = conn.execute(
        "SELECT id, video_path, duration_s FROM episodes WHERE id=?", (episode_id,)).fetchone()
    if ep is None:
        raise ValueError("episode not found: %s" % episode_id)
    removed = _delete_episode_clips(conn, episode_id)
    common.log("rebuild %s: removed %d old clips" % (episode_id, removed))
    weak_forms = _load_wordlist(common.WORDLISTS_DIR / "weak_forms.txt")
    common2000 = _load_wordlist(common.WORDLISTS_DIR / "common2000.txt")
    confusion_groups = _load_confusion_groups(common.WORDLISTS_DIR / "confusions.json")
    fallback_pool = sorted(weak_forms | common2000)
    made, skipped, err = process_episode(conn, ep, weak_forms, common2000,
                                          confusion_groups, fallback_pool)
    if err:
        raise RuntimeError(err)
    common.log("rebuild %s: made=%d skipped_no_blank=%d" % (episode_id, made, skipped))
    return made, skipped


def fill_translations(episode_id, db_path=None):
    """再エンコードなしで既存クリップの translation だけ埋め直す (mp4 は触らない、UPDATE のみ)。
    ja raw VTT (`media/subs/raw/<episode_id>.ja.vtt`) が無ければ 0/0 で終わる (呼び出し側が
    事前に yt-dlp で ja 字幕だけ取得しておく運用、§3.1 ingest.py の best-effort 取得と同じ
    命名規則から見つける)。"""
    conn = common.open_db(db_path)
    ep = conn.execute("SELECT id FROM episodes WHERE id=?", (episode_id,)).fetchone()
    if ep is None:
        raise ValueError("episode not found: %s" % episode_id)
    ja_cues = _load_ja_cues(common.SUBS_RAW_DIR / ("%s.ja.vtt" % episode_id))
    if not ja_cues:
        common.log("fill-translations %s: no ja subtitle found" % episode_id)
        return 0, 0
    rows = conn.execute(
        "SELECT id, start_s, end_s FROM clips WHERE episode_id=?", (episode_id,)).fetchall()
    filled = skipped = 0
    for row in rows:
        translation = _extract_translation(ja_cues, row["start_s"], row["end_s"])
        if translation is None:
            skipped += 1
            continue
        conn.execute("UPDATE clips SET translation=? WHERE id=?", (translation, row["id"]))
        filled += 1
    conn.commit()
    common.log("fill-translations %s: filled=%d skipped=%d (total clips=%d)" %
               (episode_id, filled, skipped, len(rows)))
    return filled, skipped


def process_all(db_path=None):
    conn = common.open_db(db_path)
    weak_forms = _load_wordlist(common.WORDLISTS_DIR / "weak_forms.txt")
    common2000 = _load_wordlist(common.WORDLISTS_DIR / "common2000.txt")
    confusion_groups = _load_confusion_groups(common.WORDLISTS_DIR / "confusions.json")
    fallback_pool = sorted(weak_forms | common2000)
    rows = conn.execute(
        "SELECT id, video_path, duration_s FROM episodes WHERE sub_path IS NOT NULL").fetchall()
    total_made = total_skipped = 0
    for ep in rows:
        common.log("clipping %s" % ep["id"])
        made, skipped, err = process_episode(conn, ep, weak_forms, common2000,
                                              confusion_groups, fallback_pool)
        if err:
            common.log("FAILED episode %s: %s" % (ep["id"], err))
            continue
        total_made += made
        total_skipped += skipped
    common.log("clips done: made=%d skipped_no_blank=%d" % (total_made, total_skipped))
    return total_made, total_skipped


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None, help="DB パス (既定: data/english.db、テスト用に上書き可)")
    parser.add_argument("--rebuild", default=None, metavar="EPISODE_ID",
                         help="指定 episode の clips (DB行+実体) を削除してから再生成する")
    parser.add_argument("--fill-translations", default=None, metavar="EPISODE_ID",
                         help="指定 episode の既存クリップの translation 列だけ埋め直す "
                              "(mp4 は変更しない、UPDATE のみ)")
    args = parser.parse_args(argv)
    if args.rebuild:
        rebuild_episode(args.rebuild, db_path=args.db)
    elif args.fill_translations:
        fill_translations(args.fill_translations, db_path=args.db)
    else:
        process_all(db_path=args.db)


if __name__ == "__main__":
    main()
