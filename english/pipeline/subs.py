#!/usr/bin/env python3
"""companion-english パイプライン第2段 — 字幕クリーニング (設計 english-design.md §3.2)。

対象: episodes.sub_kind が manual/auto/local (= 生字幕がある) かつ episodes.sub_path が
まだ NULL (= 未処理) の行。生字幕は ingest.py の固定命名規則により常に
`media/subs/raw/<episode_id>.en.vtt` にある (DB に別途パスを持たない、subs.py 側で組み立てる)。

処理:
1. 自動字幕のロールアップ重複 (直前 cue の全文がそのまま/接頭辞として次 cue に再掲される
   パターン) を 1 本の cue に畳み込む
2. cue を文単位に結合/分割する (終端 `.?!` または 2.5 秒以上のギャップで区切る)
3. (a) プレイヤー用クリーン WebVTT を書き、episodes.sub_path をそこに更新する
      (角括弧/丸括弧のト書き注記はここでは残す — 聴覚情報として有用)
   (b) 文リスト (text, start, end) を clips.py の入力として `*.sentences.json` に書く。
      こちらは (a) からさらに (i) `[drum roll]` `(laughs)` 等の角括弧/丸括弧注記、
      (ii) 行頭の話者ダッシュ・コロン・セミコロン・カンマ (`-Welcome` の `-`、
      `[Kinger]:` の角括弧除去後に残る `:` 等、ラベル除去後の先頭残渣) を除去し、
      清掃後に空になった文は捨てる
      (トークン化前の text 段階での除去なので tokens/blanks.idx の整合は崩れない)

冪等性: episodes.sub_path が既に設定済みの行は再処理しない (state = DB の 1 列で確定)。
`--force` で既存 sub_path を無視して raw から再クリーニングする (清掃規則を直した後の
作り直し用)。`--episode <id>` と併用すると対象を 1 話に絞れる。
"""
import argparse
import html
import json
import os
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import common  # noqa: E402

TS_RE = re.compile(r"(?P<start>[\d:.]+)\s*-->\s*(?P<end>[\d:.]+)")
TAG_RE = re.compile(r"<[^>]+>")
TERMINAL_RE = re.compile(r"(?<=[.?!])\s+")
TERMINAL_END_RE = re.compile(r"[.?!]$")
GAP_S = 2.5  # 文境界とみなすギャップ (秒、設計 §3.2)
# clips.py 入力専用の追加清掃 (プレイヤー用クリーン VTT には適用しない、team-lead 指示)。
BRACKET_RE = re.compile(r"\[[^\]]*\]|\([^)]*\)")  # [drum roll] (laughs) 等の効果音/ト書き注記
# 行頭の話者ダッシュ ("-Welcome" の "-") + ラベル除去後に残る先頭のコロン/セミコロン/カンマ
# ("[Kinger]:" の角括弧除去後に残る ":" 等)。'"' や "'" ("'Cause..." 等) は対象外。
LEADING_JUNK_RE = re.compile(r"^[-:;,]+\s*")


def _parse_ts(ts):
    parts = ts.strip().split(":")
    if len(parts) == 3:
        h, m, s = parts
    elif len(parts) == 2:
        h, m, s = "0", parts[0], parts[1]
    else:
        raise ValueError("bad timestamp: %s" % ts)
    return int(h) * 3600 + int(m) * 60 + float(s)


def parse_vtt(path):
    """WebVTT を cue リスト [{"start":float,"end":float,"text":str}] に変換する。

    インライン tag (<c>, <b>, <00:00:01.000> 等の word-timing tag) は除去し、HTML entity は
    デコードする。ヘッダ・NOTE・cue 識別子行は (タイムスタンプ行でないので) 自然に無視される。
    """
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.read().splitlines()
    cues = []
    i, n = 0, len(lines)
    while i < n:
        m = TS_RE.search(lines[i])
        if not m:
            i += 1
            continue
        start = _parse_ts(m.group("start"))
        end = _parse_ts(m.group("end"))
        i += 1
        text_lines = []
        while i < n and lines[i].strip() != "":
            text_lines.append(lines[i])
            i += 1
        text = TAG_RE.sub("", " ".join(text_lines))
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text).strip()
        if text and end > start:
            cues.append({"start": start, "end": end, "text": text})
    return cues


def dedupe_scroll(cues):
    """自動字幕のロールアップ重複を 1 本の cue に畳み込む (設計 §3.2 スクロール重複行除去)。

    直前 cue と完全一致 / 直前 cue が今回の接頭辞 (成長型ロールアップ) / 今回が直前の接頭辞
    (縮小方向の再掲、まれ) のいずれかなら畳み込み、区間は [先頭 start, 最後の end] にする。
    """
    out = []
    for cue in cues:
        text, start, end = cue["text"], cue["start"], cue["end"]
        if out and text == out[-1]["text"]:
            out[-1]["end"] = end
            continue
        if out and out[-1]["text"] and text.startswith(out[-1]["text"]):
            out[-1]["text"] = text
            out[-1]["end"] = end
            continue
        if out and text and out[-1]["text"].startswith(text):
            out[-1]["end"] = end
            continue
        out.append({"start": start, "end": end, "text": text})
    return out


def _split_terminal(text):
    parts = [p.strip() for p in TERMINAL_RE.split(text.strip())]
    return [p for p in parts if p]


def to_sentences(cues):
    """dedup 済み cue を文単位に結合/分割する (終端 .?! または 2.5s 以上のギャップで区切る)。

    cue 内部に複数文がある場合は文字数比で cue の時間幅を按分する近似を使う (単語単位の
    タイムスタンプはロールアップ畳み込みの時点で失っているため、これが実用上の限界)。
    """
    atoms = []
    for cue in cues:
        parts = _split_terminal(cue["text"])
        if len(parts) <= 1:
            atoms.append((cue["text"], cue["start"], cue["end"]))
            continue
        total_chars = sum(len(p) for p in parts) or 1
        t = cue["start"]
        dur = cue["end"] - cue["start"]
        for idx, p in enumerate(parts):
            is_last_part = idx == len(parts) - 1
            seg_end = cue["end"] if is_last_part else t + dur * (len(p) / total_chars)
            atoms.append((p, t, seg_end))
            t = seg_end

    sentences = []
    buf_text = buf_start = buf_end = None
    for i, (text, start, end) in enumerate(atoms):
        text = text.strip()
        if not text:
            continue
        if buf_text is None:
            buf_text, buf_start, buf_end = text, start, end
        else:
            buf_text = buf_text + " " + text
            buf_end = end
        is_last_atom = i == len(atoms) - 1
        gap_next = (atoms[i + 1][1] - end) if not is_last_atom else None
        if TERMINAL_END_RE.search(buf_text) or is_last_atom or (gap_next is not None and gap_next >= GAP_S):
            sentences.append({"text": buf_text, "start": buf_start, "end": buf_end})
            buf_text = None
    return sentences


def _clean_clip_text(text):
    """clips.py 入力用の追加清掃: 角括弧/丸括弧の効果音・ト書き注記と、行頭の話者ダッシュ/
    ラベル除去後に残るコロン・セミコロン・カンマ等の先頭残渣を除去する。

    括弧はテキスト中の全出現を 1 回のグローバル置換で除去する (これは冪等)。先頭残渣は
    "-[Kaufmo growls] -Uh, ..." (ダッシュ+注記+ダッシュ) や "[Kinger]: Well, ..."
    (角括弧除去後にコロンが残る) のように除去の連鎖が起きる実データ (TADC Ep1 実測) が
    あるため、変化がなくなるまで同じループで繰り返し除去する (新しい分岐は増やさず
    LEADING_JUNK_RE の文字集合を拡張する形で対応)。
    """
    text = BRACKET_RE.sub(" ", text).strip()
    prev = None
    while prev != text:
        prev = text
        text = LEADING_JUNK_RE.sub("", text).strip()
    return re.sub(r"\s+", " ", text).strip()


def to_clip_sentences(sentences):
    """プレイヤー用 sentences から clips.py 入力用 (注記除去済み・空文除去済み) を作る。"""
    out = []
    for s in sentences:
        text = _clean_clip_text(s["text"])
        if text:
            out.append({"text": text, "start": s["start"], "end": s["end"]})
    return out


def _fmt_ts(t):
    t = max(0.0, t)
    h = int(t // 3600)
    rem = t - h * 3600
    m = int(rem // 60)
    sec = rem - m * 60
    return "%02d:%02d:%06.3f" % (h, m, sec)


def write_clean_vtt(sentences, out_path):
    lines = ["WEBVTT", ""]
    for i, s in enumerate(sentences, start=1):
        lines.append(str(i))
        lines.append("%s --> %s" % (_fmt_ts(s["start"]), _fmt_ts(s["end"])))
        lines.append(s["text"])
        lines.append("")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    os.replace(tmp, out_path)  # atomic write (dlqueue.py と同じ契約)


def write_sentences_json(sentences, out_path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sentences, f, ensure_ascii=False, indent=2)
    os.replace(tmp, out_path)


def process_episode(conn, ep):
    """1 話分を処理する。成功で True、スキップ/失敗で (False, reason) を返す。"""
    raw_path = common.SUBS_RAW_DIR / ("%s.en.vtt" % ep["id"])
    if not raw_path.is_file():
        return False, "raw subtitle not found: %s" % raw_path
    cues = parse_vtt(raw_path)
    if not cues:
        return False, "no cues parsed from raw subtitle"
    cues = dedupe_scroll(cues)
    sentences = to_sentences(cues)
    if not sentences:
        return False, "no sentences produced"
    clip_sentences = to_clip_sentences(sentences)
    if not clip_sentences:
        return False, "no sentences left after annotation cleanup"
    clean_vtt_path = common.SUBS_DIR / ("%s.vtt" % ep["id"])
    sentences_path = common.SUBS_DIR / ("%s.sentences.json" % ep["id"])
    write_clean_vtt(sentences, clean_vtt_path)              # 注記を残したまま (聴覚情報として有用)
    write_sentences_json(clip_sentences, sentences_path)    # clips.py 入力は注記除去済み
    conn.execute("UPDATE episodes SET sub_path=? WHERE id=?",
                 (str(clean_vtt_path.relative_to(common.ROOT)), ep["id"]))
    conn.commit()
    return True, None


def process_all(db_path=None, force=False, episode_id=None):
    conn = common.open_db(db_path)
    where = ["sub_kind IN ('manual','auto','local')"]
    params = []
    if not force:
        where.append("sub_path IS NULL")
    if episode_id:
        where.append("id = ?")
        params.append(episode_id)
    rows = conn.execute(
        "SELECT id, sub_kind, sub_path FROM episodes WHERE " + " AND ".join(where),
        params).fetchall()
    done = failed = 0
    for ep in rows:
        common.log("cleaning subs for %s" % ep["id"])
        ok, err = process_episode(conn, ep)
        if ok:
            done += 1
        else:
            failed += 1
            common.log("FAILED subs %s: %s" % (ep["id"], err))
    common.log("subs done: cleaned=%d failed=%d" % (done, failed))
    return done, failed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None, help="DB パス (既定: data/english.db、テスト用に上書き可)")
    parser.add_argument("--force", action="store_true",
                         help="sub_path が既に設定済みでも raw から再クリーニングする")
    parser.add_argument("--episode", default=None, help="対象を1話に絞る (--force と併用想定)")
    args = parser.parse_args(argv)
    process_all(db_path=args.db, force=args.force, episode_id=args.episode)


if __name__ == "__main__":
    main()
