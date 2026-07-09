"""
タイトル正規化・連番抽出・コラボキー抽出ユーティリティ

評価対象外（歌・踊り・カバー）判定、シリーズ連番畳み込み、コラボ別視点畳み込み
の各機能で使う共通ロジックを提供する。
"""
import re

# 歌・踊り検出キーワード（タイトル部分一致で除外）
# 分かち書きされない日本語は単語境界判定ができないため部分一致のまま。
EXCLUDE_TITLE_KEYWORDS: tuple[str, ...] = (
    "歌ってみた", "踊ってみた", "オリジナル曲", "踊", "歌枠",
)

# 歌・踊り検出キーワード（タイトル単語境界一致で除外、大文字小文字無視）
# 部分一致だと "discovering"/"recovered"/"MVP" 等の無関係な単語に
# "cover"/"MV" が誤爆するため、英数字キーワードのみ単語境界を必須にする。
# Python の \b は日本語の漢字/かな/カナも word 文字とみなすため
# 「公式MV公開」のような正当な埋め込みまで境界扱いされず漏れてしまう。
# ASCII 英数字の前後だけを境界とみなす lookaround で判定する。
# "Covered by" は "covered" より前に置く（先にマッチさせ exclude_reason を
# 意味の狭い方に固定するため、実害は表示上の理由文字列のみだが順序を保つ）。
EXCLUDE_TITLE_KEYWORDS_WORD_BOUNDARY: tuple[str, ...] = (
    "Covered by", "covered", "cover", "MV", "original song", "original songs",
)
_WORD_BOUNDARY_PATTERNS: tuple[tuple[str, re.Pattern], ...] = tuple(
    (
        kw,
        re.compile(
            r"(?<![A-Za-z0-9])" + re.escape(kw) + r"(?![A-Za-z0-9])",
            re.IGNORECASE,
        ),
    )
    for kw in EXCLUDE_TITLE_KEYWORDS_WORD_BOUNDARY
)

# MV 同時視聴/リアクション企画の保護パターン
# 「○○のMVを見ましょう/見よう」「MV同時視聴会」「同時視聴〜MV」など、
# 実態は同時視聴/リアクション配信であり評価対象に残すべきタイトルを救出する。
MV_REACTION_PROTECTION = re.compile(
    r"(?:MV(?:を|の)?(?:見|み)(?:ましょう|よう|る|たい|た)"
    r"|MV(?:\s*同時視聴|\s*リアクション|\s*reaction)"
    r"|同時視聴.*MV"
    r")",
    re.IGNORECASE,
)
# AI が返したジャンルにマッチで除外
EXCLUDE_AI_GENRES: tuple[str, ...] = ("歌枠", "歌ってみた", "踊ってみた", "カバー曲")
# チャンネル単位除外（部分一致）
EXCLUDE_CHANNEL_NAMES: tuple[str, ...] = ("Cellmates",)

# 連番表記の網羅正規表現
# - 半角 #N / # N / 全角 ＃N / N✦
# - Part N / Part_N / part N
# - 第N回
# - 丸数字 ① 〜 ⑳
# - DAY N / DAY N.M
# - N枠目
SERIES_NUM_PATTERN = re.compile(
    r"(?:[#＃]\s*\d+(?:[✦]\s*)?)"      # #N, ＃N
    r"|(?:\d+\s*[✦])"                   # N✦
    r"|(?:\bPart\s*[_ ]?\s*\d+\b)"      # Part N / Part_N
    r"|(?:第\d+回)"
    r"|(?:[①-⑳])"
    r"|(?:\bDAY\s*\d+(?:\.\d+)?\b)"     # DAY 2 / DAY 2.1
    r"|(?:\d+枠目)",
    re.IGNORECASE,
)

# コラボ修飾語（除去対象）
COLLAB_ANNOTATIONS = re.compile(
    r"(?:ft\.|feat\.|with)[^】\]\)]*"   # ft.〜, feat.〜, with〜
    r"|【[^】]*視点】"                  # 【○○視点】
    r"|（[^）]*視点）"                  # （○○視点）
    r"|\([^)]*視点\)",
    re.IGNORECASE,
)

# 装飾の【...】タグ・[...]タグの除去
DECORATION_PATTERN = re.compile(r"【[^】]*】|\[[^\]]*\]")

# 最終的に英数+日本語+ひらがな+カタカナ+長音のみ残す
_FINAL_CLEAN_PATTERN = re.compile(r"[^\w一-龥ぁ-んァ-ンー]", flags=re.UNICODE)


def is_excluded_video(title: str, ai_genre: str, channel_name: str) -> tuple[bool, str]:
    """
    歌・踊り・カバー曲かを判定する。

    Args:
        title: 動画タイトル
        ai_genre: AI が返した推定ジャンル（評価前なら空文字 ""）
        channel_name: チャンネル名

    Returns:
        (除外フラグ, 除外理由文字列)

    例:
        >>> is_excluded_video("【歌ってみた】桜", "", "VTuberA")
        (True, '歌ってみた')
        >>> is_excluded_video("雑談配信 #5", "雑談", "VTuberA")
        (False, '')
    """
    # チャンネル単位除外（部分一致）
    for ch_name in EXCLUDE_CHANNEL_NAMES:
        if ch_name and ch_name in channel_name:
            return True, f"対象外チャンネル({ch_name})"

    # AI ジャンルベース判定（完全一致）
    if ai_genre:
        for g in EXCLUDE_AI_GENRES:
            if g == ai_genre.strip():
                return True, g

    # タイトルベース判定（部分一致、大文字小文字無視）— 日本語キーワード
    title_lower = title.lower()
    for kw in EXCLUDE_TITLE_KEYWORDS:
        if kw.lower() in title_lower:
            return True, kw

    # タイトルベース判定（単語境界一致、大文字小文字無視）— 英数字キーワード
    for kw, pattern in _WORD_BOUNDARY_PATTERNS:
        if pattern.search(title):
            # MV キーワードは同時視聴/リアクション企画の場合は保護してスキップ
            if kw == "MV" and MV_REACTION_PROTECTION.search(title):
                continue
            return True, kw

    return False, ""


def normalize_title_for_series(title: str) -> str:
    """
    連番表記・装飾を除去してシリーズキー比較用に正規化する。

    例:
        >>> normalize_title_for_series("【バイオRE:4】# 1 ハードモード初見")
        'バイオre4ハードモード初見'
        >>> normalize_title_for_series("【バイオRE:4】# 2 続き")
        'バイオre4続き'
    """
    s = title
    # 連番除去
    s = SERIES_NUM_PATTERN.sub("", s)
    # 装飾タグ除去（【】[]）
    s = DECORATION_PATTERN.sub("", s)
    # 大文字小文字無視
    s = s.lower()
    # 最終クリーニング（記号・絵文字・空白を全削除）
    s = _FINAL_CLEAN_PATTERN.sub("", s)
    return s


def extract_series_key(title: str, channel_id: str) -> str | None:
    """
    タイトルに連番表記が含まれていれば「(channel_id, 正規化タイトル)」のキーを返す。
    含まれない場合は None（畳み込み対象外）。

    例:
        >>> extract_series_key("バイオRE:4 #1", "UCabc") is not None
        True
        >>> extract_series_key("雑談配信", "UCabc") is None
        True
    """
    if not SERIES_NUM_PATTERN.search(title):
        return None
    normalized = normalize_title_for_series(title)
    if not normalized:
        return None
    return f"{channel_id}::{normalized}"


# シリーズプレフィックス抽出用パラメタ
# 正規化タイトル先頭 N 文字をプロジェクト名候補とみなす。
SERIES_COMMON_PREFIX_MIN = 3

# プレフィックスが汎用ワードのみだった場合に同シリーズ誤判定を避けるストップワード集
SERIES_PREFIX_STOPWORDS: frozenset[str] = frozenset({
    "雑談", "実況", "ゲーム", "歌枠", "配信", "朝活", "夜活",
    "メン限", "メンバー限定", "コラボ",
})


def extract_series_prefix(title: str) -> str | None:
    """
    タイトルの正規化済み先頭 N 文字（プロジェクト名候補）を返す。

    連番マーカー無しでも同シリーズと推定するための補助キー。
    SERIES_PREFIX_STOPWORDS にヒットしたら None を返す。
    正規化後の長さが SERIES_COMMON_PREFIX_MIN 未満も None。

    例:
        >>> extract_series_prefix("【マイクラ】はくクラ最終日")
        'はくクラ'  # doctest: +SKIP
        >>> extract_series_prefix("雑談配信")
        >>>
    """
    normalized = normalize_title_for_series(title)
    if len(normalized) < SERIES_COMMON_PREFIX_MIN:
        return None
    # 正規化タイトルがストップワードで始まる場合は汎用ワードのみとみなして None
    for stop in SERIES_PREFIX_STOPWORDS:
        if normalized.startswith(stop):
            return None
    prefix = normalized[:SERIES_COMMON_PREFIX_MIN]
    return prefix


def normalize_title_for_collab(title: str) -> str:
    """
    コラボ修飾（ft.・視点等）と装飾を除去してコラボキー比較用に正規化する。

    例:
        >>> normalize_title_for_collab("Pratfall ft. 山田太郎【鈴木視点】")
        'pratfall'
    """
    s = title
    # コラボ修飾を最初に除去（先に外しておかないと装飾と被る）
    s = COLLAB_ANNOTATIONS.sub("", s)
    # 装飾タグ除去
    s = DECORATION_PATTERN.sub("", s)
    # 大文字小文字無視
    s = s.lower()
    # 最終クリーニング
    s = _FINAL_CLEAN_PATTERN.sub("", s)
    return s


def extract_collab_key(title: str, published_at_bucket: str) -> str | None:
    """
    タイトルから「(正規化タイトル, 24h バケット)」のコラボキーを返す。

    コラボ修飾語（ft./feat./with/視点）の有無に依らずキーを生成する。
    同チャンネル連投を畳まないためのガード（distinct channel_id 件数）は
    呼び出し側（output_formatter）で行う。

    Args:
        title: 動画タイトル
        published_at_bucket: published_at を YYYY-MM-DD 単位に丸めた文字列

    Returns:
        コラボキー文字列、正規化後タイトルが空なら None

    例:
        >>> extract_collab_key("Pratfall ft. 山田", "2026-05-07") is not None
        True
        >>> extract_collab_key("ソロ実況", "2026-05-07") is not None
        True
        >>> extract_collab_key("", "2026-05-07") is None
        True
    """
    normalized = normalize_title_for_collab(title)
    if not normalized:
        return None
    return f"{normalized}::{published_at_bucket}"
