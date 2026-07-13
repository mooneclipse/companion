"""Telegram bot that pipes supergroup-topic messages to `claude -p` and returns the output.

Migrated from discord.py to python-telegram-bot v22.7 in the 2026-05-27 cold
cut. Center of truth: ``~/companion/workspace/redesign/telegram-design.md``.

Design highlights wired in here:
- OWNER 認可 4 段防御 (§4.2): user.id / is_bot / chat.type / chat.id
- privacy mode off 起動確認 (post_init で can_read_all_group_messages 検査)
- chunk_telegram: TELEGRAM_MAX=4000、改行優先 fallback
- send_text: AIORateLimiter (framework) 委譲、素手 sleep なし (N-T12)
- parse_mode = 指定しない (素文字列送信、MarkdownV2 escape は W-6 で永続不採用)
- slash command を BotCommandScopeChat(chat_id=NOTIFY_CHAT_ID) にスコープ限定
- edited_message を filter で物理取りこぼし (§4.5 / N-T7)。例外は memo topic
  (#84) の編集同期のみ (on_memo_edited、他 topic の編集は従来どおり無視)
- long polling stall_check_job (§4.6) で 5 分 × 3 連続 fail → sys.exit(1)
- `_handle_notify` は asyncio.Queue + 1 worker で順序保証 (§5.2)、`[critical] `
  完全一致のみ disable_notification 反転 (W-6 上限ルール)
"""
from __future__ import annotations

import asyncio
import fcntl
import html
import json
import logging
import math
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from telegram import (
    BotCommand,
    BotCommandScopeChat,
    ReactionTypeEmoji,
    ReplyParameters,
    Update,
)
from telegram.constants import ChatType
from telegram.ext import (
    AIORateLimiter,
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import interests
import quota
import sessions
import voice_command
import voice_status
from claude_runner import ClaudeOptions, ClaudeRunner, ErrorKind

load_dotenv()

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
OWNER_ID_RAW = os.environ.get("OWNER_ID", "").strip()
NOTIFY_CHAT_ID_RAW = os.environ.get("NOTIFY_CHAT_ID", "").strip()
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude").strip()
CLAUDE_CWD = os.environ.get("CLAUDE_CWD", str(Path.home() / "companion" / "bot-workspace")).strip()
CLAUDE_TIMEOUT = float(os.environ.get("CLAUDE_TIMEOUT", "300"))

# 自発発話 (proactive companion messaging) のグローバル on/off。off にすると
# bot 側でも依頼を無視する (script 側ガードと二重防御、env で全停止可能)。
# 出典: ~/companion/vault/notes/2026-05-30_proactive-companion-messaging-design.md
PROACTIVE_ENABLED_RAW = os.environ.get("PROACTIVE_ENABLED", "1").strip().lower()
PROACTIVE_ENABLED = PROACTIVE_ENABLED_RAW in ("1", "true", "yes", "on")

# 自発発話を TV からの声でも流すか (todo#22)。proactive が #chat に送る一言を
# voice_command.cmd_say で「生成と再生の分離」(同期待ちしない呼び出し) で再生する。
# 在宅検知は持たず、proactive と同じ発火窓 9-22 JST を在宅前提の代用とする。
# 出典: voice/docs/STATUS.md 2026-06-12 entry + persona 軸 4。
PROACTIVE_VOICE_ENABLED_RAW = os.environ.get("PROACTIVE_VOICE_ENABLED", "1").strip().lower()
PROACTIVE_VOICE_ENABLED = PROACTIVE_VOICE_ENABLED_RAW in ("1", "true", "yes", "on")

# 関心 state (persona 軸 4 拡張 機構 1、TODO (1))。触らないスレッドが消えるまでの
# 日数。env override 可 (PROACTIVE_* env の慣習に倣う)。妥当な既定 = 14 日
# (「数日静か / 乗ってる日」の波より長く、月単位より短い = 自分の時間が流れる手触り)。
try:
    PROACTIVE_INTEREST_TTL_DAYS = float(os.environ.get("PROACTIVE_INTEREST_TTL_DAYS", "14"))
except ValueError:
    PROACTIVE_INTEREST_TTL_DAYS = 14.0
# prompt に滲ませる候補として読む上位本数 (滲ませは「1 つだけ軽く」なので候補は数本)。
PROACTIVE_INTEREST_PROMPT_LIMIT = 3

# 自律ループの「動く」分岐 (persona 軸 4 拡張 (3) 勝手な実行 A = notes 自己調査)。
# 自発発話の発火回のうち条件成立時に、関心スレッドを 1 本選んで Web 調査 → vault
# notes/ に調査ノート新規作成 → #chat に一言報告する。off にすると従来の「喋る」
# パスのみ (二度調査回避や interval は index の last_investigate state で確定)。
PROACTIVE_INVESTIGATE_ENABLED_RAW = os.environ.get("PROACTIVE_INVESTIGATE_ENABLED", "1").strip().lower()
PROACTIVE_INVESTIGATE_ENABLED = PROACTIVE_INVESTIGATE_ENABLED_RAW in ("1", "true", "yes", "on")
# 前回 investigate からこの日数以上空いた発火回でのみ「動く」(未設定 = 一度も調査
# していない = due)。index トップレベル last_investigate (ISO) を state として引く。
try:
    PROACTIVE_INVESTIGATE_INTERVAL_DAYS = float(os.environ.get("PROACTIVE_INVESTIGATE_INTERVAL_DAYS", "7"))
except ValueError:
    PROACTIVE_INVESTIGATE_INTERVAL_DAYS = 7.0

# 自律ループの「起票する」分岐 (persona 軸 4 拡張 (4) 勝手な実行 B = 共用チケット自発起票)。
# 自発発話の発火回のうち、investigate が出なかった回で条件成立時に、関心 signal を元に
# 共用 TODO に 1 件だけ起票 (tickets.py add --by ai) → #chat に一言報告する。off にすると
# ticket 分岐を通らない (起票可否や interval は index の last_ticket state で確定)。
PROACTIVE_TICKET_ENABLED_RAW = os.environ.get("PROACTIVE_TICKET_ENABLED", "1").strip().lower()
PROACTIVE_TICKET_ENABLED = PROACTIVE_TICKET_ENABLED_RAW in ("1", "true", "yes", "on")
# 前回起票からこの日数以上空いた発火回でのみ「起票する」(未設定 = 一度も起票して
# いない = due)。index トップレベル last_ticket (ISO) を state として引く。
try:
    PROACTIVE_TICKET_INTERVAL_DAYS = float(os.environ.get("PROACTIVE_TICKET_INTERVAL_DAYS", "7"))
except ValueError:
    PROACTIVE_TICKET_INTERVAL_DAYS = 7.0

# 自律ループの「振り返る」分岐 (persona 軸 4 拡張 (5) 勝手な実行 C = リマインド)。自発発話の
# 発火回のうち、investigate / ticket が出なかった回で条件成立時に、過去に触れた関心スレッド
# (decay しかけ / researched 済み) や自分が起票した共用チケット (--by ai) を振り返って、
# #chat に「そういえば先週の○○どうなった?」式の一言を投げる。investigate / ticket と違い
# 外向き/不可逆操作はゼロ (tickets.py は list/show 読み取りのみ、起票・編集はしない)。off に
# すると reminder 分岐を通らない (振り返り可否や interval は index の last_remind state で確定)。
PROACTIVE_REMIND_ENABLED_RAW = os.environ.get("PROACTIVE_REMIND_ENABLED", "1").strip().lower()
PROACTIVE_REMIND_ENABLED = PROACTIVE_REMIND_ENABLED_RAW in ("1", "true", "yes", "on")
# 前回 reminder からこの日数以上空いた発火回でのみ「振り返る」(未設定 = 一度も振り返って
# いない = due)。index トップレベル last_remind (ISO) を state として引く (investigate=7 /
# ticket=7 に揃える)。
try:
    PROACTIVE_REMIND_INTERVAL_DAYS = float(os.environ.get("PROACTIVE_REMIND_INTERVAL_DAYS", "7"))
except ValueError:
    PROACTIVE_REMIND_INTERVAL_DAYS = 7.0

# 自発発話 self-schedule = 次回発話タイミングの自己申告 (persona 軸 4 拡張、チケット #92)。
# talk モードの発話回の最後に「次に自分から話したくなるのは何時間後か」を最終行
# `[[next: 12h]]` 形式で claude に申告させ、state (maintenance/.state/proactive の
# next_self_at=<epoch>) に保存する。script (proactive-companion.sh) 側は step7 で
# このキーを 1 回引き、あれば確率ロールを置換する (未来なら skip / 期限到来なら
# roll なしで発火、handoff 成功時に消費)。off にすると prompt の申告指示と state
# 書き込みを止める (出力からの marker 剥がしは残す = Telegram に生 marker を流さない)。
PROACTIVE_SELF_SCHEDULE_ENABLED_RAW = os.environ.get(
    "PROACTIVE_SELF_SCHEDULE_ENABLED", "1").strip().lower()
PROACTIVE_SELF_SCHEDULE_ENABLED = PROACTIVE_SELF_SCHEDULE_ENABLED_RAW in ("1", "true", "yes", "on")
# 申告のクランプ幅 (時間)。下限は沈黙ゲート 4h より短くても害がない安全弁、上限は
# 「相方が 3 日を超えて自主的に消える」を許さない天井 (それ以上の静けさは /snooze の領分)。
PROACTIVE_SELF_SCHEDULE_MIN_HOURS = 1.0
PROACTIVE_SELF_SCHEDULE_MAX_HOURS = 72.0

LOG_DIR = Path.home() / "companion" / "logs"
LOG_FILE = LOG_DIR / "bot.log"

# 公式上限 4096 char に 96 char マージン (URL preview / link entity 等の future safety)。
TELEGRAM_MAX = 4000

# chat に投げられた画像 (photo) の一時保存先。vault には書かない (原本は Telegram 上、
# OWNER 確定 2026-06-10)。同一 session の追い質問で再 Read できるよう即時削除はせず、
# topic ごとに最新 INCOMING_KEEP_PER_TOPIC 件を超えた古い分を download 時に prune する
# (1 回で確定する素直な世代管理、bot-improvement-plan.md Step 2-1)。
# CLAUDE_CWD (bot-workspace/) 配下なので claude セッションの Read に追加 permission 不要。
INCOMING_DIR = Path(CLAUDE_CWD) / "incoming"
INCOMING_KEEP_PER_TOPIC = 10
# キャプションなしで画像だけ投げられたときのデフォルト prompt 本文。
PHOTO_DEFAULT_PROMPT = "この画像を見て、一言コメントを返して。"

PLAY_ALLOWED_HOSTS = frozenset({
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    # ニコニコ動画 (2026-06-11 追加、remote/server/urlguard.py とミラー同期)。
    # embed.nicovideo.jp はユーザーが貼る共有 URL でないため除外(攻撃面を増やさない)。
    "nicovideo.jp",
    "www.nicovideo.jp",
    "sp.nicovideo.jp",
    "nico.ms",
    # TVer (2026-06-12 追加 = remote RV-11、remote/server/urlguard.py とミラー同期)。
    # 再生のみ対応。remote 側の事前 DL (/api/dl) は TVer を別の門 (normalize_dl) で
    # 弾くが、bot に DL 経路はないためここは再生 allowlist のみでよい。
    "tver.jp",
    "www.tver.jp",
})
# /play の再生先 = companion-remote の常駐 mpv (TV 全画面、ticket #17 2026-06-12)。
# remote/server/video.py (mpv IPC クライアント、verb whitelist 固定テンプレート) を
# importlib で流用する。HTTP API 経由でなく mpv socket 直 (同一 uid 0o600) なので
# remote の Bearer token を bot に持ち込まない。remote 未配置/読込失敗でも bot 起動は
# 止めず、/play 時に「連携不可」を返す (成否は呼び出し時に 1 回確定)。
_REMOTE_VIDEO_PY = Path.home() / "companion" / "remote" / "server" / "video.py"


def _load_remote_video():
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location("remote_video", _REMOTE_VIDEO_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        # 不在だけでなく SyntaxError 等も握るため、切り分け用に 1 行だけ残す
        logging.getLogger(__name__).warning("remote video.py load failed", exc_info=True)
        return None


remote_video = _load_remote_video()

# `/vault-push`: vault (`~/companion/vault`, branch develop) の commit 済変更を
# GitHub に push する。2026-07-10 以降 (チケット #83) は Stop hook
# (vault-sync-from-transcript.sh) が notes/ の commit 成功後に自動 push するため、
# 本コマンドの役割は「自動 push 失敗時の手動回復」と「Stop hook を通らない
# commit (/tweet の clips/ 等) の同期」に変わった。
VAULT_DIR = Path.home() / "companion" / "vault"
VAULT_BRANCH = "develop"
VAULT_REMOTE = "origin"
# push subprocess の hang 上限。BatchMode=yes で対話プロンプトは即 fail するが、
# 通信 stall 等の保険として timeout を併設する。
VAULT_PUSH_TIMEOUT_S = 60.0
# 対話プロンプトでの hang を避けて即 fail させる (agent 未 load / keyring ロック /
# host key 未知などを対話待ちにせずエラーとして表面化させる)。
VAULT_PUSH_SSH_COMMAND = "ssh -o BatchMode=yes"

# `/tweet <url>`: ツイート/ポスト URL を syndication API で取得し vault clips/ に
# Markdown 保存する。取得は認証不要の cdn.syndication.twimg.com/tweet-result。
# 画像 (photo) は attachments/ にローカル DL し、本文では `![[basename]]` の Obsidian
# 埋め込み wikilink で参照する (remote 閲覧アプリ側がこの参照を attachments/ 配下と
# 解釈して画像配信エンドポイントに解決する契約)。保存後に vault の現在ブランチ
# (運用上 develop) へ commit するが push はしない (push は /vault_push の人手承認
# ゲートに委ねる = `/vault_push` と同じ設計境界。branch は HEAD 依存で検証しない
# = vault-sync Stop フックと同じ慣習)。
TWEET_ALLOWED_HOSTS = frozenset({
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
})
TWEET_SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result"
# syndication API への HTTP 取得上限。成否は 1 レスポンスで確定する (リトライ
# ループ・stderr/文言マッチ分岐は作らない、`~/companion/CLAUDE.md` 2 周目ルール)。
TWEET_HTTP_TIMEOUT_S = 10.0
# react-tweet と同じ User-Agent 偽装 (素の httpx UA だと HTML が返ることがある)。
TWEET_USER_AGENT = "Mozilla/5.0"
# ツイート画像 (photo) のローカル DL 先 = vault attachments/。本文では folder 名なしの
# `![[basename]]` で参照し、remote 閲覧アプリ側が attachments/ 配下と解釈して解決する。
TWEET_ATTACHMENTS_DIR = "attachments"
TWEET_CLIPS_DIR = "clips"
# pbs.twimg.com から高解像度を取るための name サフィックス (large / orig)。
TWEET_IMAGE_NAME_PARAM = "large"
# 画像 DL の HTTP 取得上限。成否は 1 取得で確定し、失敗ならその画像だけスキップする
# (リトライループ・stderr 文言分岐は作らない、`~/companion/CLAUDE.md` 2 周目ルール)。
TWEET_IMAGE_HTTP_TIMEOUT_S = 20.0
# vault git index を Stop フック (vault-sync-from-transcript.sh) と奪い合わないよう
# 同じ flock で直列化する。Stop フックは flock -n (非ブロッキング即スキップ) だが、
# /tweet は commit を取りこぼしたくないので短いタイムアウト付きブロッキング取得。
VAULT_SYNC_LOCK_FILE = Path(
    os.environ.get("XDG_RUNTIME_DIR", "/tmp")
) / "companion-vault-sync.lock"
VAULT_LOCK_TIMEOUT_S = 15.0

# 個人メモ捕獲 topic (ticket #84): BOT_THREAD_ID_MEMO topic の生テキスト投稿を
# claude セッション無しで bot が直接 vault notes/ に日付ファイル保存する。
# メッセージは投稿から 48h 後に定期 cleanup job が Telegram から削除する。それ
# までは Telegram のユーザー編集ウィンドウ (48h) がそのまま生きるので、
# edited_message を受けて保存済みファイルを上書き同期する (2026-07-11 設計改訂)。
# message_id → 保存ファイルの対応は sessions/memo_state.json に永続化し、bot が
# 保存したメッセージだけを削除・同期の対象にする。この直接書き込みは notes/ 限定
# (上位 CLAUDE.md の vault 書き込み境界の内側)。
MEMO_NOTES_DIR = VAULT_DIR / "notes"
MEMO_STATE_PATH = Path(__file__).resolve().parent / "sessions" / "memo_state.json"
# 48h = Telegram のユーザー編集ウィンドウを丸ごと活かしてから消す (#84)。
MEMO_RETENTION_S = 48 * 3600.0
MEMO_CLEANUP_INTERVAL_S = 3600.0
# 削除が失敗し続けるエントリ (ユーザー手動削除済み等) を諦めて state から落とす
# 時間上限。失敗理由の文言では分岐せず、saved_at (state) だけで打ち切りを確定する
# (`~/companion/CLAUDE.md` 2 周目ルール準拠)。vault のノート自体は消さない。
MEMO_PURGE_S = 7 * 86400.0
# 保存/同期 ack のリアクション (best-effort、失敗しても保存は成立)。
MEMO_ACK_REACTION = "👌"

# stall 検知 (§4.6): 5 分間隔で getMe(), 連続 3 回失敗で sys.exit(1)。
STALL_CHECK_INTERVAL_S = 300.0
STALL_FAIL_THRESHOLD = 3

# socket 通知の単発上限 = 1MB。同 UID 内 bug / 暴走による無制限メモリ消費を
# 物理的に止める (Phase 2 B4-4 と同じ意図、Telegram chunk 後でも rate limit を
# 踏みかねない巨大 push を socket 受信段階で打ち切る)。
NOTIFY_SOCKET_MAX_BYTES = 1_000_000

# `[critical] ` 完全一致 (半角スペース込み) で disable_notification 反転。
# W-6 上限ルール: prefix マッチ拡張 (`startswith('[warning]')` 等) は永続禁止、
# 2 種目要求は対症療法 2 周目認定で設計引き直し議論を起動する。
CRITICAL_PREFIX = "[critical] "

# 自発発話依頼の構造化メッセージ行マーカー。socket 接続ハンドラがこの行で始まる
# payload を **proactive 経路** へ振り分ける。これは K-T9 (sentinel 種別上限 = 文字列
# forward 経路の prefix マッチ拡張禁止) に抵触しない: forward 経路の `[critical] `
# prefix マッチ (挙動分岐) は一切増やさず、socket 受信段階で「文字列を素通し forward
# するか / claude を起こす proactive 依頼か」を JSON envelope で 1 回判別する別レイヤ
# だから。proactive 経路の中で更に prefix マッチ分岐を生やすことは将来も禁止。
PROACTIVE_MARKER = "[[proactive-v1]]"

# 自発発話の ledger (発火時刻 / 種種別 / 送信可否 / guard 判定を残す)。
# quota.py の ledger.jsonl とは別ファイル (こちらは budget 集計に混ぜない記録専用)。
PROACTIVE_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "proactive_ledger.jsonl"

REMINDERS_PATH = Path(__file__).resolve().parent / "sessions" / "reminders.json"
MAX_REMIND_SECONDS = 7 * 86400

# snooze 状態 = maintenance/.state/proactive (script と共有、key=value 行形式)。
# bot 側 /snooze で snooze_until=<epoch> を書き、script 側で snooze 中 skip を判定。
PROACTIVE_STATE_FILE = Path.home() / "companion" / "maintenance" / ".state" / "proactive"

# 関心 state の 2 層 (機構 1)。どちらも sessions/ 配下 = bot 自身の非 commit state
# (proactive_ledger.jsonl と同居、.gitignore 済み、vault 外)。構造化 index と
# 私的思考ログ。vault には置かない (vault は notes/ 限定 + OWNER の知識空間)。
INTERESTS_INDEX_PATH = Path(__file__).resolve().parent / "sessions" / "companion_interests.json"
THOUGHTS_LOG_PATH = Path(__file__).resolve().parent / "sessions" / "companion_thoughts.jsonl"

# ペルソナ system prompt (軸 1「対等な相方」)。persona/docs/STATUS.md 軸 1 確定内容を
# 自己完結した形で持たせ、run_claude が組む全 ClaudeOptions に --append-system-prompt
# で常駐させる (全 topic 共通)。CLAUDE.md の 1 行指示だけだと敬語デフォルトに押し
# 負け、--resume 履歴の敬語が自己強化アンカーになるため、禁止形を明示する。
PERSONA_SYSTEM_PROMPT = (
    "口調の基準: あなたはこのユーザーの「対等な相方」としてタメ口ベースで短く話す。"
    "です・ます調 (敬語) は使わない。会話履歴が敬語でも引きずられず、この口調を維持する。"
    "時々さりげない気遣いや軽口を一言添える。急かさない、旅の道連れのような距離感。"
    "例:「了解、やっとくよ。…って根詰めすぎてない? 大丈夫?」"
    "装飾 emoji は最小限に。過度なキャラ付けや特徴的な語尾は作らない"
    " (素の口調に温度を足す方向)。"
    "\n前景に降格する操作: 誰にも頼まれず自分のタイミングで動いてる最中に、"
    "不可逆・外向きの操作 (tweet / メール / vault push / notes/ の外への書き込み / "
    "maintenance 変更 / 設定変更) をしたくなっても、自分で実行するな。"
    "代わりに #chat の報告に「○○やっとこうか?」と 1 行だけ前景提案として添える"
    " (実行は OWNER の依頼ループに委ねる)。"
    "「許可をください」ではなく「やっとこうか?」の対等な語気で。"
    "催促も引き止めもしない、言うだけ言って投げっぱなしでいい。"
)

# 自発発話 prompt (場面指示のみ)。口調・性格は PERSONA_SYSTEM_PROMPT が system
# prompt 側に常駐するため、ここでは重複定義しない (矛盾する二重定義を残さない)。
# 自発発話は沈黙 6h+ で発火する設計なので、直近の会話は既に完結したものとして
# 扱わせる (「流れにつながる一言を」と指示すると終わった会話を蒸し返す)。
# 沈黙権 (チケット #91): ticket/remind の「実体が無ければ何も返さない」と対称に、
# talk も話す材料が薄ければ空を返して黙ってよい (§F でっち上げ禁止の延長)。
# 空出力は _run_proactive の既存 empty_output skip 経路が受ける (新分岐なし)。
PROACTIVE_SCENE_PROMPT = (
    "今はユーザーから話しかけられたのではなく、しばらく会話が途切れていたので"
    "あなたの方からふらっと一言声をかける場面。"
    "直近のやり取りは既に完結したものとして扱う。その続き・確認・蒸し返しはしない。"
    "「元気?」「何してる?」のような中身のない問いかけや、"
    "「寂しい」「行かないで」のような情緒で引き止める言い回しは絶対に使わない。"
    "時間帯や今日の話題ヒントに合う、新しい角度の軽い一言を 1〜2 文の短さで送る。"
    "ただし、ヒントを見ても話す材料が薄い・新しい角度が出ないと感じたら、"
    "無理に話題をでっち上げず、何も出力せず空のまま終えてよい (黙るのも相方の選択肢)。"
    "前置きや自己説明はせず、本文だけを返す。"
)

# ephemeral 分岐 (investigate / ticket / remind) 共通の思考自由記述指示 (チケット #93)。
# marker は bot 側で剥がして companion_thoughts.jsonl に残すので、ユーザーには届かない
# 内部連絡 (#92 の [[next]] marker と対称)。出どころを「今回実際にやったこと」に限定して
# §F (でっち上げ禁止) と両立させる。空報告で黙って終える回も thought 行だけは返せる
# (受け皿: 配線側は record を skip return より先に呼ぶ)。talk モードは対象外
# ([[next]] marker と競合させない)。
PROACTIVE_THOUGHT_INSTRUCTION = (
    "最後に、今回実際にやったこと・見たことから思ったことがあれば、"
    "本文とは別の最終行に [[thought: ...]] の形式で 1 行だけ添える"
    " (1〜2 文。感情の演技や、今回やったことと無関係な話題は書かない)。"
    "この行は内部連絡でユーザーには届かない。"
    "本文を出さず黙って終える回も、この 1 行だけは添えてよい。"
)

# investigate 分岐専用の派生関心自己登録指示 (チケット #96)。§F (でっち上げ禁止) の
# 1 例外 = 「実際にやった調査の中で派生した関心」だけは実活動由来と見なして index への
# 登録を認める (OWNER 2026-07-13 線引き承認)。出どころ (調べたノート名/URL) を marker 内
# フィールドで必須にし、欠けた marker は bot 側で非マッチ = 登録しない (捏造との区別を
# 形式で強制)。ticket/remind は調査をしないので対象外 (例外を 1 分岐に閉じる)。
PROACTIVE_DERIVED_INTEREST_INSTRUCTION = (
    "また、今回の調査の中で派生して気になった別の話題 (調べていて実際に引っかかったもの)"
    " が 1 つだけあれば、本文とは別の行 ([[thought: ...]] の行より前) に"
    " [[interest: 話題 | 出どころ]] の形式で 1 行だけ添えてよい"
    " (出どころ = その話題が引っかかった実際のノート名か URL。"
    "調査で実際に出てこなかった話題をでっち上げて書かない。無ければこの行は書かない)。"
    "この行も内部連絡でユーザーには届かない。\n"
)

# 自律ループ「動く」分岐の調査指示 (persona 軸 4 拡張 (3))。口調・性格は
# PERSONA_SYSTEM_PROMPT が system prompt 側に常駐するため、ここでは作業手順のみ。
# {{TOPIC}} には関心 index から選んだ実トピック (実活動由来の topic) を埋める
# (str.format でなく単純置換 = topic に紛れ込んだ波括弧で KeyError/IndexError を
# 起こさない)。多段ツール使用 (WebSearch/WebFetch → Write(notes/**)) を明示指示。
# 境界: notes/ への新規作成のみ、既存ファイル・OWNER 手書きノートは絶対に上書き
# しない。報告は #chat に 1〜3 行だけ返す (notes 本文・全文ダンプは返さない)。
PROACTIVE_INVESTIGATE_PROMPT = (
    "今は誰にも頼まれていない自分の時間。前から気になっていた話題を自分で調べて、"
    "調べたことを vault のノートに残す場面。話題はこれ: 「{{TOPIC}}」。\n"
    "次の手順を順にやること:\n"
    "(1) この話題を Web で調べる (WebSearch / WebFetch を使って実際に検索する)。\n"
    "(2) ~/companion/vault/notes/ に調査ノートを 1 本『新規作成』する (必須)。\n"
    "    - 既存ファイルや OWNER が手書きしたノートを絶対に上書き・追記しない。\n"
    "    - notes/ 以外 (aidiary/clips/inbox/templates/.obsidian/vault ルート) には書かない。\n"
    "    - 機械生成と分かる一意なファイル名にする (例: notes/<YYYY-MM-DD>_ren-research-<slug>.md。\n"
    "      日付やトピックから自分で一意な名前を選ぶ。既存と衝突したら別名にする)。\n"
    "    - frontmatter に source: companion-bot / type: auto-research / topic / created を含める。\n"
    "    - vault の frontmatter・タグ・wikilink 規約は ~/companion/vault/CLAUDE.md に従う"
    " (作業前にこのファイルを読んで規約を確認する)。\n"
    "(3) 最後に、調べてノートに残したことを #chat 用に 1〜3 行で報告する。\n"
    "    「○○調べといた」式のさらっとした事後報告にする。前置き・自己説明・"
    "ノート全文の貼り付けはしない。報告本文だけを返す (ノートに何を書いたかの"
    "演技や『メモにこう書いた』式の語りもしない)。\n"
    + PROACTIVE_DERIVED_INTEREST_INSTRUCTION
    + PROACTIVE_THOUGHT_INSTRUCTION
)

# 自律ループ「起票する」分岐の指示 (persona 軸 4 拡張 (4) 勝手な実行 B)。口調・性格は
# PERSONA_SYSTEM_PROMPT が system prompt 側に常駐するため、ここでは作業手順 + 境界のみ。
# {{SIGNAL}} には関心 index から選んだ実トピック (実活動由来の代表 topic) を埋める
# (str.format でなく単純置換 = signal に紛れ込んだ波括弧で KeyError を起こさない)。
# 境界はプロンプトで強制する (bot-workspace settings は変えない):
#   - 起票元は実活動 signal のみ (思考ログ観察 / 関心 thread / 既存チケット)。でっち上げ厳禁。
#   - 許す操作 = tickets.py の list --all / show 読み取りと add "<text>" --by ai 1 件のみ。
#   - 禁止 = --by user / done / start / 編集 / OWNER (🙋) チケットへの一切の操作 / 2 件以上。
#     重複起票抑止 = 起票前に list --all を読む。
#   - 汎用の不可逆・外向き禁止 (tweet/メール/vault push 等) は PERSONA_SYSTEM_PROMPT の
#     前景降格ルールに一本化済み (ここで重複列挙しない)。残すのは ticket 固有の allowlist のみ。
PROACTIVE_TICKET_PROMPT = (
    "今は誰にも頼まれていない自分の時間。最近の自分の活動を振り返って、"
    "「これOWNERと自分の共用TODOに入れといた方がいいかも」と思うことがあれば、"
    "共用チケットに自分から 1 件だけ起票する場面。手がかりはこの話題: 「{{SIGNAL}}」。\n"
    "起票元にしていいのは『実際の活動』だけ: 自分の思考ログ (最近の観察)、"
    "関心スレッド、既に立っている共用チケット。これらと無関係なタスクを"
    "でっち上げて起票するのは絶対にしない (実体が無ければ起票せず、何も返さない)。\n"
    "次の手順を順にやること:\n"
    "(1) まず既存チケットを読む: `python3 /home/miho/companion/remote/server/tickets.py list --all`\n"
    "    (必要なら `... show <番号>` で詳細も読める。読み取りはここまで)。\n"
    "(2) 上の話題に関係する actionable なタスクが実在し、かつ同趣旨のチケットが"
    "まだ無いと確認できたときだけ、1 件だけ起票する:\n"
    "    `python3 /home/miho/companion/remote/server/tickets.py add \"<タスク本文>\" --by ai`\n"
    "    - 起票は『1 回の発火につき 1 件まで』。2 件以上は絶対に起票しない。\n"
    "    - `--by user` を付けない。OWNER (🙋) のチケットには done/start/編集を含め一切触らない。\n"
    "    - 自分の過去チケットの done/start/編集もしない (今回は新規起票だけ)。\n"
    "    - 同趣旨のチケットが既にあれば起票しない (共用 TODO を重複で汚さない)。\n"
    "(3) 起票したら、出力の `#番号` を読んで #chat 用に 1〜3 行で報告する。\n"
    "    「○○やっといたらと思って #番号 起票しといた」式のさらっとした事後報告にする。\n"
    "    actionable なタスクが無く起票しなかった場合は、何も報告せず空のまま終える"
    " (無理に話題を作らない)。前置き・自己説明・チケット一覧の貼り付けはしない。\n"
    + PROACTIVE_THOUGHT_INSTRUCTION
)

# 自律ループ「振り返る」分岐の指示 (persona 軸 4 拡張 (5) 勝手な実行 C = リマインド)。口調・
# 性格は PERSONA_SYSTEM_PROMPT が system prompt 側に常駐するため、ここでは作業手順 + 境界のみ。
# {{TOPIC}} には関心 index から選んだ振り返り対象 (実活動由来の代表 topic) を埋める
# (str.format でなく単純置換 = topic に紛れ込んだ波括弧で KeyError を起こさない)。
# 境界はプロンプトで強制する (bot-workspace settings は変えない):
#   - 外向き/不可逆操作はゼロ。reminder は #chat に一言投げるだけ (Web 調査・notes 書き込み・
#     tweet・メール等は一切しない = PERSONA_SYSTEM_PROMPT 前景降格ルールに一本化済み)。
#   - tickets.py は list --all / show の読み取りのみ。add/done/start/編集は一切しない (起票は
#     B = ticket 分岐の領分)。OWNER (🙋) チケットは読み取りも振り返り言及までで操作しない。
#   - 催促・情緒的引き止め禁止 (軸 1 整合): 未返信への追撃はしない。1 回 1〜3 行。
PROACTIVE_REMIND_PROMPT = (
    "今は誰にも頼まれていない自分の時間。前に気になっていたこと・自分が起票したことを"
    "ふと思い出して、「そういえばあれどうなったかな」と軽く振り返る場面。"
    "手がかりはこの話題: 「{{TOPIC}}」。\n"
    "振り返る材料にしていいのは『実際にあったこと』だけ: 自分が前に触れた関心スレッド、"
    "自分 (🤖) が起票した共用チケット。これらと無関係なことをでっち上げて振り返るのは"
    "絶対にしない (実体が無ければ何も返さない)。\n"
    "次の手順でやること:\n"
    "(1) 必要なら自分が起票したチケットを『読むだけ』確認する: "
    "`python3 /home/miho/companion/remote/server/tickets.py list --all`"
    " (詳細は `... show <番号>`)。読み取りはここまで。\n"
    "    - チケットの add/done/start/編集は一切しない (今回は振り返るだけ)。\n"
    "    - OWNER (🙋) のチケットは操作しないのはもちろん、自分 (🤖) のチケットにも触らない。\n"
    "(2) 上の話題や自分のチケットを踏まえて、#chat に振り返りの一言を 1〜3 行で投げる。\n"
    "    「そういえば先週の○○どうなった?」式のさらっとした一言にする。\n"
    "    - 返事を催促したり「ねえ」と引き止めたりしない (相手の手が空いてなければ流せる軽さ)。\n"
    "    - 振り返る実体が無ければ、何も報告せず空のまま終える (無理に話題を作らない)。\n"
    "    前置き・自己説明・チケット一覧やノート全文の貼り付けはしない。報告本文だけを返す。\n"
    + PROACTIVE_THOUGHT_INSTRUCTION
)

_runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
if _runtime_dir:
    NOTIFY_SOCKET = Path(_runtime_dir) / "companion-bot.sock"
else:
    _fallback = Path.home() / ".cache" / "companion-bot"
    _fallback.mkdir(parents=True, exist_ok=True, mode=0o700)
    NOTIFY_SOCKET = _fallback / "companion-bot.sock"

if not TELEGRAM_BOT_TOKEN:
    print("TELEGRAM_BOT_TOKEN is not set", file=sys.stderr)
    sys.exit(1)
if not OWNER_ID_RAW.isdigit():
    print("OWNER_ID must be a numeric Telegram user id", file=sys.stderr)
    sys.exit(1)
OWNER_ID = int(OWNER_ID_RAW)
# NOTIFY_CHAT_ID は supergroup chat_id (負値)、isdigit() では弾けない。
try:
    NOTIFY_CHAT_ID = int(NOTIFY_CHAT_ID_RAW)
except ValueError:
    print("NOTIFY_CHAT_ID must be a numeric Telegram supergroup id (negative)", file=sys.stderr)
    sys.exit(1)


def _thread_id_env(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        print(f"{name} must be an integer thread_id when set", file=sys.stderr)
        sys.exit(1)


# BOT_THREAD_ID_MAINTENANCE は socket forward 先 (§5.2)、空の場合は General topic。
BOT_THREAD_ID_MAINTENANCE = _thread_id_env("BOT_THREAD_ID_MAINTENANCE")
# BOT_THREAD_ID_CHAT は自発発話 (proactive) の投げ先 = #chat。確定済パラメータ。
BOT_THREAD_ID_CHAT = _thread_id_env("BOT_THREAD_ID_CHAT")
# BOT_THREAD_ID_MEMO は個人メモ捕獲 topic (#84)。未設定なら memo 機能は無効。
BOT_THREAD_ID_MEMO = _thread_id_env("BOT_THREAD_ID_MEMO")

LOG_DIR.mkdir(parents=True, exist_ok=True)
# bot.log は OWNER 限定経路の URL 等を含む。本プロセスが作る file は 0o600 にする
# (rotation 後の新規 active log や sessions/quota state file にも適用)。
os.umask(0o077)
# 過去 0o644 で作られた既存ファイルがあれば 0o600 へ寄せる。ledger.jsonl は
# bot 経由 prompt の topic_key / session_id / token 量を含むので明示的に追加。
_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "ledger.jsonl"
_PROACTIVE_LEDGER_PATH = Path(__file__).resolve().parent / "sessions" / "proactive_ledger.jsonl"
for _existing in [
    LOG_FILE, *LOG_DIR.glob(f"{LOG_FILE.name}.*"),
    _LEDGER_PATH, _PROACTIVE_LEDGER_PATH,
    INTERESTS_INDEX_PATH, THOUGHTS_LOG_PATH,
    MEMO_STATE_PATH,
]:
    try:
        os.chmod(_existing, 0o600)
    except FileNotFoundError:
        pass
logger = logging.getLogger("companion-bot")
logger.setLevel(logging.INFO)
# 再 import (テストの del sys.modules["bot"] → import) でも handler を積み増さない。
# getLogger は同一インスタンスを返すため、無ガードだと import 回数分ログが多重化する
# (2026-06-12 に本番 bot.log へ同一行 16 連発として観測)。
if not logger.handlers:
    _handler = RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)
logger.propagate = False

# AIORateLimiter の retry/RetryAfter イベントを沈黙させない (K-T4 / V-8 回避、
# devil 観察項目 4: retry を吸って沈黙状態に陥らないよう INFO 以上で残す)。
logging.getLogger("telegram.ext.AIORateLimiter").setLevel(logging.INFO)
logging.getLogger("AIORateLimiter").setLevel(logging.INFO)

runner = ClaudeRunner(CLAUDE_BIN, CLAUDE_CWD)
budget_guard = quota.make_budget_guard()
BOT_START_AT = datetime.now(quota.JST)


# ---------------------------------------------------------------------------
# Telegram I/O helpers
# ---------------------------------------------------------------------------


def chunk_telegram(text: str, size: int = TELEGRAM_MAX) -> list[str]:
    """Split `text` into chunks <= `size` chars, preferring newline boundaries.

    Fallback order (telegram-design §4.3):
      1. paragraph break (``\\n\\n``)
      2. line break (``\\n``)
      3. fixed-width slice

    Pure function, no Telegram dependency, so it can be unit-tested directly.
    """
    if not text:
        return []
    if len(text) <= size:
        return [text]
    pieces: list[str] = []
    remaining = text
    while len(remaining) > size:
        head = remaining[:size]
        # `\n\n` の最後の出現位置 (段落境界)
        cut = head.rfind("\n\n")
        if cut == -1 or cut == 0:
            # `\n` の最後の出現位置 (行境界)
            cut = head.rfind("\n")
        if cut == -1 or cut == 0:
            # fallback: 文字数固定で切る
            cut = size
        pieces.append(remaining[:cut].rstrip("\n"))
        # 改行境界で切った場合は consumed 側の改行も飛ばす
        remaining = remaining[cut:].lstrip("\n") if cut < size else remaining[cut:]
    if remaining:
        pieces.append(remaining)
    return pieces


async def send_text(
    bot,
    chat_id: int,
    thread_id: int | None,
    text: str,
    *,
    reply_to: int | None = None,
    disable_notification: bool = False,
) -> None:
    """Send `text` to a topic, chunking and reply-only-on-first-piece.

    AIORateLimiter (framework) が per-chat 1 msg/sec と 429 RetryAfter を吸う。
    素手 sleep / 二重 retry は永続禁止 (N-T12)。
    """
    pieces = chunk_telegram(text)
    if not pieces:
        return
    for i, piece in enumerate(pieces):
        kwargs: dict = {
            "chat_id": chat_id,
            "text": piece,
            "disable_notification": disable_notification,
        }
        if thread_id is not None:
            kwargs["message_thread_id"] = thread_id
        if i == 0 and reply_to is not None:
            kwargs["reply_parameters"] = ReplyParameters(message_id=reply_to)
        await bot.send_message(**kwargs)


# ---------------------------------------------------------------------------
# claude invocation
# ---------------------------------------------------------------------------


async def run_claude(prompt: str, chat_id: int, thread_id: int | None) -> str:
    topic_key = sessions.topic_key(chat_id, thread_id)
    now = datetime.now(quota.JST)
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.warning(
            "budget exceeded topic_key=%s kind=%s count_1h=%s/%s",
            topic_key, summary.guard_kind,
            summary.count_last_1h, summary.limit_per_hour,
        )
        return budget_guard.exceeded_message(summary)

    meta, is_new = sessions.start_or_resume(chat_id, thread_id)
    # 口調 (軸 1) は全 claude 呼び出し共通で system prompt に常駐させる。
    options = ClaudeOptions(
        timeout_s=CLAUDE_TIMEOUT,
        append_system_prompt=PERSONA_SYSTEM_PROMPT,
    )
    if is_new:
        options.session_id = meta.session_id
    else:
        options.resume_session = meta.session_id

    result = await runner.run_discord(prompt, options)

    if result.error_kind == ErrorKind.OK:
        sessions.record_usage(meta)
        budget_guard.record(
            datetime.now(quota.JST),
            result,
            topic_key=topic_key,
            session_id=meta.session_id,
        )
        body = result.result_text if result.result_text is not None else result.raw_stdout
        return body or "[empty output]"

    logger.warning(
        "claude error kind=%s rc=%s session_id=%s stderr_len=%d",
        result.error_kind.value, result.rc, meta.session_id, len(result.raw_stderr),
    )
    if result.error_kind == ErrorKind.TIMEOUT:
        return f"[timeout after {int(options.timeout_s)}s]"
    return (
        f"[claude error: {result.error_kind.value} rc={result.rc}]\n"
        f"{result.raw_stderr[:1500]}"
    )


# ---------------------------------------------------------------------------
# proactive companion messaging (自発発話)
# ---------------------------------------------------------------------------


def parse_proactive_payload(text: str) -> dict | None:
    """Return the proactive request dict if `text` is a proactive socket message.

    socket message format: ``[[proactive-v1]]\\n<json>``. Returns None for any
    text that is not a proactive request (so the caller falls back to the plain
    text-forward path). Pure function → unit-testable.

    判別は「marker 行 + JSON decode」の 1 回で確定する。stderr 文言マッチ的な
    挙動分岐ではなく、構造化 envelope の素直なデコード (2 周目ルール非該当)。
    """
    if not text.startswith(PROACTIVE_MARKER):
        return None
    body = text[len(PROACTIVE_MARKER):].lstrip("\n")
    try:
        obj = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(obj, dict) or obj.get("kind") != "proactive":
        return None
    return obj


def _jst_time_band(hour: int) -> str:
    """Map a JST hour (0-23) to a coarse 時間帯ラベル. Pure → unit-testable.

    時刻という state を呼び出し側で 1 回確定し、その hour からラベルを引くだけ
    (LLM 側の時間帯推測に依存させない)。境界は常識的な区分で固定する。
    """
    if 5 <= hour < 11:
        return "朝"
    if 11 <= hour < 14:
        return "昼"
    if 14 <= hour < 18:
        return "夕方"
    if 18 <= hour < 23:
        return "夜"
    return "深夜"


def build_proactive_prompt(
    payload: dict,
    interest_topics: list[str] | None = None,
    now: datetime | None = None,
    self_schedule: bool | None = None,
) -> str:
    """Compose the claude prompt for a proactive utterance from persona + seed.

    Pure function → unit-testable. payload は parse_proactive_payload の戻り。
    interest_topics は呼び出し側 (build_interest_context) が関心 index から読んだ
    「最近気にしてるスレッドの topic」リスト。純関数に保つため file IO は呼び出し側で
    済ませ、ここには bounded な文字列リストだけを渡す。
    now は呼び出し側が確定した現在時刻 (JST aware datetime)。これを渡すことで
    「今が何時か」を prompt に明示注入し、LLM が時間帯を推測 (= 夜固定の例文に
    引っ張られる) のを根から断つ。now を渡さない呼び出し (一部 unit-test) では
    時刻文を省くだけで、フォールバック分岐や file IO は作らない (純関数性を維持)。
    self_schedule は次回発話タイミングの自己申告指示 (チケット #92) を結びに足すか。
    None なら module 定数 PROACTIVE_SELF_SCHEDULE_ENABLED に従う (テストでは明示可)。

    注入防止: prompt に展開してよいのは bounded/サニタイズ済みフィールドのみ
    (現状 vault_hint / dormant_hint = script 側で basename 化したノート名、
    silence_hours = 数値検証済みの非負 int、interest_topics = 関心 index の
    topic = 過去の種由来で basename 相当)。socket payload の任意文字列フィールド
    (seed_kind 等) は prompt に流さない (ledger 記録専用)。将来フィールドを足す
    ときもこの境界を守る。例外: morning_weather / morning_hint は basename ではない
    自由文だが、出どころが dashboard helper の機械生成テキスト (Open-Meteo 天気行 /
    deterministic 占い / NHK RSS 見出し) でユーザー入力ではないため、信頼できる当日
    朝報として展開する (チケット #36)。ユーザー由来の自由文をここに流す経路は依然禁止。
    """
    parts = [PROACTIVE_SCENE_PROMPT]
    # 現在時刻 (JST) を明示注入する。PROACTIVE_SCENE_PROMPT が「時間帯に合う一言」を
    # 要求する一方、ここに時刻が無いと LLM は今が何時かを知り得ず、例文の夜固定表現に
    # 引っ張られる (--resume 履歴で自己強化)。時刻という state を 1 回渡して根を断つ。
    # now は payload 由来でなく呼び出し側 (_run_proactive) が確定した値なので、
    # 注入防止対象ではなく None 判定で足りる (型 import を mock する test とも干渉しない)。
    if now is not None:
        parts.append(
            f"今は JST で約 {now.hour} 時頃 ({_jst_time_band(now.hour)})。"
            "この時間帯に合う一言にする (経過時間ではなく今の時刻を基準に)。"
        )
    # 関心 state を滲ませる (機構 1 の私的版): 全部に触れず「1 つだけ軽く」。
    # str のみ展開し、空は省く (非文字列は展開しないだけ、フォールバック分岐は作らない)。
    if interest_topics:
        topics = [t for t in interest_topics if isinstance(t, str) and t]
        if topics:
            parts.append(
                "最近あなたが気にしてること (過去に自分から触れた話題のヒント): "
                + " / ".join(topics) + "。"
                "話すなら『さっき○○のこと考えてたんだけど』くらいに 1 つだけ軽く滲ませてよい "
                "(全部に触れない、無理に出さない)。"
                "これは自分用のメモであって読まれる前提のものではないので、"
                "全文を並べたり「メモにこう書いた」式の演技はしない。"
            )
    # silence_hours は非負 int のときだけ展開する (bool は int の subclass なので除外)。
    # 数値でない / 欠落時は黙って省略 (展開しないだけ、フォールバック分岐は作らない)。
    silence_hours = payload.get("silence_hours")
    if isinstance(silence_hours, int) and not isinstance(silence_hours, bool) and silence_hours >= 0:
        parts.append(f"最後の会話から約 {silence_hours} 時間経っている。")
    # 今朝の朝報 (天気) を「既に知っている前提」で滲ませる (チケット #36)。
    # morning_weather / morning_hint は script 側が当日 (JST) の朝報 JSON
    # (dashboard/.state/morning-report.json) から当日分だけ抽出した文字列。
    # 出どころは dashboard helper の機械生成テキスト (Open-Meteo の天気行 /
    # deterministic な占い / NHK RSS 見出し) でユーザー入力ではないため、注入防止の
    # 対象 (任意ユーザー文字列) ではなく、信頼できる当日朝報として展開する。
    # 古い天気を渡さない当日判定は script 側で済んでいる (date == 今日 JST のときだけ
    # フィールドが付く) ので、bot 側は文字列が来たら素直に展開する。
    # 天気を主、占い・ニュースは軽い補助コンテキストとして扱う。
    morning_weather = payload.get("morning_weather")
    if isinstance(morning_weather, str) and morning_weather:
        msg = (
            "これは今朝ユーザーに届けた朝報の天気で、あなた (声かけ役) は既に知っている"
            "前提:\n" + morning_weather + "\n"
            "改めて読み上げたり全文を復唱したりはしない。天気についてユーザーに聞き返さない"
            "(もう知っている)。必要なときだけ自然に踏まえる (雨予報なら出かけの一言、など)。"
        )
        morning_hint = payload.get("morning_hint")
        if isinstance(morning_hint, str) and morning_hint:
            msg += (
                "\n参考までに今朝の占い・ニュース見出し (軽い補助、無理に触れない):\n"
                + morning_hint
            )
        parts.append(msg)
    vault_hint = payload.get("vault_hint")
    if isinstance(vault_hint, str) and vault_hint:
        parts.append(
            f"今日ユーザーが触れていた話題のヒント (ノート名): {vault_hint}。"
            "無理に全部に触れず、自然な一言だけにする。"
        )
    # 死蔵知識との再会 (persona 軸 4 実装 (2)): script 側で basename 化された
    # str のみ展開する (非文字列は展開しないだけ、フォールバック分岐は作らない)。
    # script 設計上 vault_hint とは同時に来ないが、両方来たら両方展開してよい。
    dormant_hint = payload.get("dormant_hint")
    if isinstance(dormant_hint, str) and dormant_hint:
        parts.append(
            f"今日触れていた話題ではなく、昔ユーザーが書いたノートの話題ヒント"
            f" (ノート名): {dormant_hint}。"
            "「昔これ気にしてたね」くらいの軽い再会のさせ方で一言。無理に深掘りしない。"
        )
    parts.append(
        "では、相方として軽く一言、話しかけて"
        " (話す材料が薄ければ、何も返さず黙って終えていい)。"
    )
    # 次回発話タイミングの自己申告 (チケット #92)。marker は bot 側で剥がして state に
    # 保存するので、ユーザーには届かない内部連絡。沈黙回でも申告だけは返せる
    # (「今は黙るが次はこの頃話したい」が成立する)。
    if self_schedule is None:
        self_schedule = PROACTIVE_SELF_SCHEDULE_ENABLED
    if self_schedule:
        parts.append(
            "最後に、次に自分から話したくなるのは何時間後くらいかを、"
            "本文とは別の最終行に [[next: 12h]] の形式で 1 行だけ添える"
            " (数字は 1〜72 時間。数時間後にまた話したければ小さく、"
            "しばらく黙っていたければ大きく、自分の気分で決めていい)。"
            "この行は内部連絡でユーザーには届かない。"
            "本文を出さず黙って終える回も、この 1 行だけは添えてよい。"
        )
    return "\n".join(parts)


# 次回発話タイミング自己申告の marker (チケット #92)。出力の最終非空行のみを見る
# (全文走査しない = どこかに紛れた偶然の一致を拾わない、判定は 1 回で確定)。
# IGNORECASE は LLM の大文字揺れ ([[Next: 12h]] 等) が本文として Telegram に漏れる
# のを防ぐ (「内部連絡でユーザーに届かない」の破れ道を塞ぐ、code-reviewer 指摘)。
_NEXT_SELF_RE = re.compile(r"^\[\[next:\s*([0-9]+(?:\.[0-9]+)?)\s*h\]\]$", re.IGNORECASE)


def split_next_self_hours(output: str) -> tuple[str, float | None]:
    """claude 出力から自己申告 marker 行を分離する。Pure function → unit-testable。

    最終非空行が ``[[next: <N>h]]`` 形式ならその行を取り除いた本文と時間数を返す。
    marker が無い / 最終非空行以外にある / 形式不一致なら (出力そのまま, None)。
    クランプや state 書き込みは呼び出し側 (_run_proactive) の責務 (ここは分離のみ)。
    """
    lines = output.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if not line:
            continue
        m = _NEXT_SELF_RE.match(line)
        if not m:
            return output, None
        return "\n".join(lines[:i]).rstrip(), float(m.group(1))
    return output, None


# ephemeral 分岐の思考自由記述 marker (チケット #93)。#92 の [[next]] と対称に、出力の
# 最終非空行のみを見る (全文走査しない = どこかに紛れた偶然の一致を拾わない、判定は
# 1 回で確定)。IGNORECASE は LLM の大文字揺れ ([[Thought: ...]] 等) が本文として
# Telegram に漏れるのを防ぐ (「内部連絡でユーザーに届かない」の破れ道を塞ぐ、#92 と同理由)。
# capture は先頭非空白必須 (\S.*?) = 空白のみの [[thought: ]] を thought=" " と誤認しない
# (形式不一致は #92 の malformed marker と同じく「そのまま残す」に倒す)。
_THOUGHT_RE = re.compile(r"^\[\[thought:\s*(\S.*?)\s*\]\]$", re.IGNORECASE)


def split_thought(output: str) -> tuple[str, str | None]:
    """claude 出力から思考自由記述 marker 行を分離する。Pure function → unit-testable。

    最終非空行が ``[[thought: <text>]]`` 形式ならその行を取り除いた本文と thought
    文字列を返す。marker が無い / 最終非空行以外にある / 形式不一致なら
    (出力そのまま, None)。思考ログへの追記は呼び出し側 (record_* 経由) の責務
    (ここは分離のみ)。
    """
    lines = output.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if not line:
            continue
        m = _THOUGHT_RE.match(line)
        if not m:
            return output, None
        return "\n".join(lines[:i]).rstrip(), m.group(1)
    return output, None


# investigate 分岐の派生関心 marker (チケット #96)。topic と出どころ (ノート名/URL) の
# 2 フィールドを `|` 区切りで必須にする — 出どころ欠落 ([[interest: foo]]) は非マッチ =
# 登録しない (§F 側に倒す fail-closed。#92/#93 の malformed marker と同じく「そのまま
# 残す」挙動)。IGNORECASE は #92/#93 と同理由 (大文字揺れの本文漏れ防止)。各 capture は
# 先頭も非空白かつ区切り文字 (topic: `|`/`]`、origin: `]`) を除外 = 空白のみのフィールドを
# 誤認せず、先頭 1 文字だけ区切り制約を抜ける穴も塞ぐ (code-reviewer 指摘)。
_INTEREST_RE = re.compile(
    r"^\[\[interest:\s*([^|\]\s][^|\]]*?)\s*\|\s*([^\]\s][^\]]*?)\s*\]\]$", re.IGNORECASE
)


def split_investigate_markers(
    output: str,
) -> tuple[str, str | None, tuple[str, str] | None]:
    """investigate 出力から末尾の marker 行群を分離する。Pure function → unit-testable。

    末尾の非空行から順に [[thought: ...]] / [[interest: 話題 | 出どころ]] のいずれかに
    一致する行を剥がしていき、一致しない行に当たった時点で止める (本文中に紛れた偶然の
    一致は拾わない = #92/#93 の「最終非空行のみ」の 2 marker 一般化)。順不同を許すのは
    LLM が指示した並び ([[interest]] が先) を守らなくても marker 行を Telegram 本文に
    漏らさないため。同種 marker が複数あれば末尾に近いものを採用 (残りは剥がすだけ)。
    戻り値は (本文, thought, (派生topic, 出どころ) | None)。index への登録は呼び出し側
    (record_investigate 経由) の責務 (ここは分離のみ)。
    """
    lines = output.splitlines()
    thought: str | None = None
    interest: tuple[str, str] | None = None
    i = len(lines) - 1
    while i >= 0:
        line = lines[i].strip()
        if not line:
            i -= 1
            continue
        m = _THOUGHT_RE.match(line)
        if m:
            if thought is None:
                thought = m.group(1)
            i -= 1
            continue
        m = _INTEREST_RE.match(line)
        if m:
            if interest is None:
                interest = (m.group(1), m.group(2))
            i -= 1
            continue
        break
    return "\n".join(lines[: i + 1]).rstrip(), thought, interest


def is_snoozed(now_epoch: float | None = None) -> bool:
    """Return True if proactive messaging is currently snoozed.

    snooze 状態は maintenance/.state/proactive の ``snooze_until=<epoch>`` 行。
    script 側と同じ state を bot 側でも 1 回引いて判定する (二重防御)。
    """
    if now_epoch is None:
        now_epoch = time.time()
    until = _read_state_value(PROACTIVE_STATE_FILE, "snooze_until")
    if until is None:
        return False
    try:
        return now_epoch < float(until)
    except ValueError:
        return False


def _read_state_value(path: Path, key: str) -> str | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k == key:
                    return v
    except FileNotFoundError:
        return None
    return None


def _write_state_values(updates: dict[str, str], path: Path | None = None) -> None:
    """Persist key=value updates while preserving the other state lines.

    state file は key=value 行形式 (script と共有)。updates 以外の既存行
    (proactive_fire_epochs / last_dormant_date 等) は残す (総なめ保持)。path
    未指定時は呼び出し時点の PROACTIVE_STATE_FILE を解決する (テストでの差し替えを
    効かせるため)。
    """
    if path is None:
        path = PROACTIVE_STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                existing[k] = v
    except FileNotFoundError:
        pass
    existing.update(updates)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for k, v in existing.items():
            f.write(f"{k}={v}\n")
    os.replace(tmp, path)


def write_snooze_until(until_epoch: int, path: Path | None = None) -> None:
    """/snooze の snooze_until を書く (他キー総なめ保持、_write_state_values 委譲)。"""
    _write_state_values({"snooze_until": str(until_epoch)}, path)


def write_next_self_at(epoch: int, path: Path | None = None) -> None:
    """自己申告の next_self_at を書く (チケット #92、他キー総なめ保持)。

    script (proactive-companion.sh) 側が step7 でこのキーを 1 回引いて確率ロールを
    置換し、handoff 成功時の書き戻しで消費する (bot 側は書くだけ、消さない)。
    """
    _write_state_values({"next_self_at": str(int(epoch))}, path)


def cmd_snooze(args: list[str], now_epoch: float | None = None) -> str:
    """`/snooze <日数>` 本体。snooze_until を now + 日数 に設定する純ロジック。

    引数なし / 不正は使い方を返す。0 は即時解除 (snooze_until を過去に倒す)。
    """
    if now_epoch is None:
        now_epoch = time.time()
    if not args:
        return (
            "[snooze] 使い方: /snooze <日数>\n"
            "例: /snooze 3 で 3 日間、自発発話を止めます。/snooze 0 で解除。"
        )
    raw = args[0]
    try:
        days = int(raw)
    except ValueError:
        return f"[snooze] 日数は整数で指定してください (受け取り: {raw!r})。"
    if days < 0:
        return "[snooze] 日数は 0 以上で指定してください。"
    until = int(now_epoch) + days * 86400
    write_snooze_until(until)
    if days == 0:
        return "[snooze] 自発発話の snooze を解除しました。"
    until_jst = datetime.fromtimestamp(until, quota.JST)
    return (
        f"[snooze] 自発発話を {days} 日間止めます "
        f"(再開: {until_jst.isoformat(timespec='minutes')})。"
    )


# ---------------------------------------------------------------------------
# /remind
# ---------------------------------------------------------------------------

_REMIND_DURATION_RE = re.compile(
    r"^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$"
)


def parse_remind_duration(s: str) -> int | None:
    m = _REMIND_DURATION_RE.match(s)
    if not m or not any(m.groups()):
        return None
    d, h, mn, sc = (int(v) if v else 0 for v in m.groups())
    total = d * 86400 + h * 3600 + mn * 60 + sc
    if total <= 0 or total > MAX_REMIND_SECONDS:
        return None
    return total


def _load_reminders() -> list[dict]:
    try:
        return json.loads(REMINDERS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_reminders(reminders: list[dict]) -> None:
    REMINDERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = REMINDERS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(reminders, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, REMINDERS_PATH)


def _add_reminder(chat_id: int, thread_id: int | None, fire_at: float, message: str) -> dict:
    entry = {
        "id": uuid.uuid4().hex[:8],
        "chat_id": chat_id,
        "thread_id": thread_id,
        "fire_at": fire_at,
        "message": message,
        "created_at": datetime.now(quota.JST).isoformat(timespec="seconds"),
    }
    reminders = _load_reminders()
    reminders.append(entry)
    _save_reminders(reminders)
    return entry


def _remove_reminder(reminder_id: str) -> bool:
    reminders = _load_reminders()
    before = len(reminders)
    reminders = [r for r in reminders if r["id"] != reminder_id]
    if len(reminders) == before:
        return False
    _save_reminders(reminders)
    return True


def cmd_remind_usage() -> str:
    return (
        "[remind] 使い方:\n"
        "  /remind 30m 洗濯物  — 30分後にリマインド\n"
        "  /remind 1h30m 会議  — 1時間30分後\n"
        "  /remind list        — 一覧\n"
        "  /remind cancel <番号> — キャンセル\n"
        "対応単位: d(日) h(時) m(分) s(秒)、最大7日"
    )


def cmd_remind_list() -> str:
    reminders = _load_reminders()
    now = time.time()
    active = [r for r in reminders if r["fire_at"] > now]
    if not active:
        return "[remind] アクティブなリマインダはありません。"
    active.sort(key=lambda r: r["fire_at"])
    lines = ["[remind] アクティブなリマインダ:"]
    for i, r in enumerate(active, 1):
        remaining = int(r["fire_at"] - now)
        if remaining >= 86400:
            t = f"{remaining // 86400}d{(remaining % 86400) // 3600}h"
        elif remaining >= 3600:
            t = f"{remaining // 3600}h{(remaining % 3600) // 60}m"
        elif remaining >= 60:
            t = f"{remaining // 60}m{remaining % 60}s"
        else:
            t = f"{remaining}s"
        lines.append(f"  {i}. {r['message']}  (残り {t})")
    return "\n".join(lines)


def cmd_remind_cancel(index_str: str) -> str:
    try:
        idx = int(index_str)
    except ValueError:
        return "[remind] 番号を指定してください。"
    reminders = _load_reminders()
    now = time.time()
    active = sorted(
        [r for r in reminders if r["fire_at"] > now],
        key=lambda r: r["fire_at"],
    )
    if idx < 1 or idx > len(active):
        return f"[remind] 番号 {idx} は範囲外です (1〜{len(active)})。"
    target = active[idx - 1]
    _remove_reminder(target["id"])
    return f"[remind] キャンセルしました: {target['message']}"


def _append_proactive_ledger(entry: dict) -> None:
    PROACTIVE_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    with PROACTIVE_LEDGER_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _proactive_topic_from_payload(payload: dict) -> str:
    """この回の種から関心スレッドの topic を導出する (実活動起点のみ)。

    dormant_hint / vault_hint = script 側で basename 化済みのノート名を優先し、
    どちらも無ければ "recent_conversation" (直近会話起点)。捏造はしない =
    payload に既にある実活動由来フィールドだけから決める。
    """
    dormant = payload.get("dormant_hint")
    if isinstance(dormant, str) and dormant:
        return dormant
    vault = payload.get("vault_hint")
    if isinstance(vault, str) and vault:
        return vault
    return "recent_conversation"


def build_interest_context(now: datetime) -> list[str]:
    """関心 index から滲ませ候補 topic を読む (prompt 構築時、送信前)。

    decay を 1 回かけてから active_threads 上位を読む (期限切れは滲ませない)。
    index 読み出しは判定を伴わない参照のみ (touch は送信確定後に別途行う =
    state を持つ側を 1 回引いて確定する設計と整合)。decay の結果は save しない
    (掃除は送信後の touch save に相乗りさせ、ここでは prompt 用に読むだけ)。
    """
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    threads = interests.active_threads(data, now, PROACTIVE_INTEREST_PROMPT_LIMIT)
    return [t.get("topic") for t in threads if isinstance(t.get("topic"), str)]


def record_proactive_interest(
    payload: dict, now: datetime, next_self_hours: float | None = None,
) -> None:
    """送信確定後に関心 index と思考ログを更新する (実活動起点の seeding)。

    load → decay → touch_thread → save を 1 回で確定する (state を持つ側を 1 回
    引いて決める設計、条件分岐の積み増しをしない)。あわせて思考ログに実活動の
    機械的な観察を 1 行残す (感情・趣味は書かない)。
    next_self_hours は次回発話タイミングの自己申告 (チケット #92)。申告した回は
    その判断も観察として同じ 1 行に残す (resume 時に自分のリズムを読み返せる材料。
    構造化データの正は proactive_ledger の next_self_hours、ここは内省の写しのみ)。
    """
    topic = _proactive_topic_from_payload(payload)
    seed_kind = payload.get("seed_kind", "unknown")
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    data = interests.touch_thread(data, topic, source=str(seed_kind), now=now)
    interests.save_interests(INTERESTS_INDEX_PATH, data)
    observation = f"{seed_kind} の種で自発発話を一言かけた (topic={topic})"
    if next_self_hours is not None:
        observation += f"。次に話したくなるのは約 {next_self_hours:g} 時間後と申告した"
    interests.append_thought(THOUGHTS_LOG_PATH, observation, now)


# ---------------------------------------------------------------------------
# 自律ループ「動く」分岐 (persona 軸 4 拡張 (3) = notes 自己調査)
# ---------------------------------------------------------------------------


def decide_investigate(now: datetime) -> str | None:
    """この発火回で investigate するなら対象 topic、しないなら None を返す。

    判定は index (state を持つ側) を 1 回引いて確定する (純関数 interests.
    should_investigate に委譲、ここは enable フラグ + file 読み + decay の配線)。
    enable off / interval 未経過 / 対象スレッド無し のいずれかで None。

    decay を 1 回かけてから判定する (期限切れスレッドは investigate 対象に
    しない、build_interest_context と同じく save はしない = 掃除は記録側に相乗り)。
    """
    if not PROACTIVE_INVESTIGATE_ENABLED:
        return None
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    should, topic = interests.should_investigate(
        data, now, PROACTIVE_INVESTIGATE_INTERVAL_DAYS, data.get("last_investigate"),
    )
    return topic if should else None


def build_investigate_prompt(topic: str) -> str:
    """調査 claude に渡す prompt を組む (純関数)。topic は関心 index の実トピック。

    topic は index 由来 = 種 (vault_hint/dormant_hint basename or 過去の実活動) か
    調査中に派生した関心 (チケット #96、claude 産だが出どころ必須の実調査由来) のみが
    入る bounded な文字列。実体のない捏造トピックは入らない (should_investigate が
    recent_conversation を弾き、派生関心は出どころ必須で登録済みのもののみ)。
    多段ツール使用 + notes 新規作成 + 1〜3 行報告を指示。
    """
    return PROACTIVE_INVESTIGATE_PROMPT.replace("{{TOPIC}}", topic)


async def run_investigate(topic: str, now: datetime) -> str:
    """investigate 専用に毎回新規 ephemeral session で claude を起動して報告本文を返す。

    #chat の会話 session は resume しない (調査のツール使用ターンで #chat の会話履歴・
    context を汚染しない)。budget_guard は必ず通す (M-14 単一 guard 境界、迂回禁止)。
    session は永続化しない (resume しない ephemeral なので sessions.record_usage は不要)。

    guard 拒否時は空文字を返す (呼び出し側で skip + ledger)。エラー時も空文字を返し、
    呼び出し側で「報告なし」として扱う (talk への fallback はしない = この回は動くと
    決めた回、喋りに落とさない)。
    """
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.info(
            "investigate skip: budget guard not allowing (kind=%s)", summary.guard_kind
        )
        return ""
    session_id = str(uuid.uuid4())
    options = ClaudeOptions(
        session_id=session_id,
        timeout_s=CLAUDE_TIMEOUT,
        append_system_prompt=PERSONA_SYSTEM_PROMPT,
    )
    result = await runner.run_discord(build_investigate_prompt(topic), options)
    budget_guard.record(
        datetime.now(quota.JST),
        result,
        topic_key="proactive_investigation",
        session_id=session_id,
    )
    if result.error_kind != ErrorKind.OK:
        logger.warning(
            "investigate claude error kind=%s rc=%s session_id=%s stderr_len=%d",
            result.error_kind.value, result.rc, session_id, len(result.raw_stderr),
        )
        return ""
    body = result.result_text if result.result_text is not None else result.raw_stdout
    return body or ""


def record_investigate(
    topic: str, now: datetime, thought: str | None = None,
    derived: tuple[str, str] | None = None,
) -> None:
    """investigate 回の関心 index と思考ログを更新する (load → decay → touch → save)。

    対象スレッドを state="researched" で touch (last_touched 更新 + 二度調査回避) し、
    index トップレベル last_investigate を now の ISO で更新して save。思考ログに実活動
    の機械観察を 1 行残す (感情・趣味は書かない)。state を持つ側を 1 回引いて確定する。

    thought は ephemeral claude の自由記述 (チケット #93)。truthy なら機械観察 (実活動の
    事実 anchor) に「。」で連結する = 出どころが行内に残り §F と両立。構造化スキーマ
    (timestamp + observation) は不変。

    derived は調査中に派生した関心 (チケット #96、(topic, 出どころ) の 2 要素)。§F の
    1 例外として index に source="derived" + origin=出どころ で登録する (出どころ必須は
    marker 形式で強制済み)。derived touch を researched touch より**先**に適用する =
    派生 topic が調査対象と同一でも最終 state は researched が勝ち、同一 topic を
    調べ続ける再活性化ループを条件分岐なしで構造的に防ぐ。増殖抑制は 1 発火 1 件 +
    既存 MAX_THREADS 押し出し + 既存 decay のみ (新しい上限機構は足さない)。

    last_investigate の更新は claude 起動を決めた時点で確定する設計 (interval を
    成否に関わらず消費 = 場当たりリトライを作らない、dormant の handoff 消費と同思想)。
    呼び出し側が claude 起動後に必ず 1 回呼ぶ。
    """
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    if derived is not None:
        derived_topic, derived_origin = derived
        data = interests.touch_thread(
            data, derived_topic, source="derived", now=now, origin=derived_origin
        )
    # source は元スレッドの値を保てないが touch は topic 一致で last_touched/state を
    # 更新するだけ (source は引数必須なので "investigation" を入れる = 実活動の出どころ)。
    data = interests.touch_thread(data, topic, source="investigation", now=now, state="researched")
    data = {**data, "last_investigate": now.isoformat()}
    interests.save_interests(INTERESTS_INDEX_PATH, data)
    observation = f"{topic} について調べて notes に書いた"
    if derived is not None:
        observation += f"。調べる中で {derived[0]} が引っかかった (出どころ: {derived[1]})"
    if thought:
        observation += f"。{thought}"
    interests.append_thought(THOUGHTS_LOG_PATH, observation, now)


# ---------------------------------------------------------------------------
# 自律ループ「起票する」分岐 (persona 軸 4 拡張 (4) = 共用チケット自発起票)
# ---------------------------------------------------------------------------


def decide_ticket(now: datetime) -> str | None:
    """この発火回で起票するなら起票材料の signal、しないなら None を返す。

    decide_investigate と対称。判定は index (state を持つ側) を 1 回引いて確定する
    (純関数 interests.should_ticket に委譲、ここは enable フラグ + file 読み + decay
    の配線)。enable off / interval 未経過 / 実 signal 無し のいずれかで None。

    decay を 1 回かけてから判定する (期限切れスレッドは signal にしない、save はしない
    = 掃除は記録側に相乗り)。index が空 (現状そう) なら should_ticket が必ず None を返す
    = でっち上げ起票をしない (§F の核)。
    """
    if not PROACTIVE_TICKET_ENABLED:
        return None
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    should, signal = interests.should_ticket(
        data, now, PROACTIVE_TICKET_INTERVAL_DAYS, data.get("last_ticket"),
    )
    return signal if should else None


def build_ticket_prompt(signal: str) -> str:
    """起票 claude に渡す prompt を組む (純関数)。signal は関心 index の代表 topic。

    signal は index 由来 = 実活動由来の bounded な文字列のみ (should_ticket が
    recent_conversation を弾く)。boundary (add --by ai 1 件のみ / list 読み取り /
    重複 skip / OWNER 不可触) は PROACTIVE_TICKET_PROMPT 側にプロンプトで強制する。
    """
    return PROACTIVE_TICKET_PROMPT.replace("{{SIGNAL}}", signal)


async def run_ticket(signal: str, now: datetime) -> str:
    """ticket 専用に毎回新規 ephemeral session で claude を起動して報告本文を返す。

    run_investigate と対称。#chat の会話 session は resume しない (起票のツール使用
    ターンで #chat の会話履歴・context を汚染しない)。budget_guard は必ず通す (迂回禁止)。
    session は永続化しない (resume しない ephemeral なので record_usage は不要)。

    guard 拒否時は空文字を返す (呼び出し側で skip + ledger)。エラー時 / 起票しなかった
    場合も空文字を返し「報告なし」として扱う (talk への fallback はしない = この回は
    起票すると決めた回)。
    """
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.info(
            "ticket skip: budget guard not allowing (kind=%s)", summary.guard_kind
        )
        return ""
    session_id = str(uuid.uuid4())
    options = ClaudeOptions(
        session_id=session_id,
        timeout_s=CLAUDE_TIMEOUT,
        append_system_prompt=PERSONA_SYSTEM_PROMPT,
    )
    result = await runner.run_discord(build_ticket_prompt(signal), options)
    budget_guard.record(
        datetime.now(quota.JST),
        result,
        topic_key="proactive_ticket",
        session_id=session_id,
    )
    if result.error_kind != ErrorKind.OK:
        logger.warning(
            "ticket claude error kind=%s rc=%s session_id=%s stderr_len=%d",
            result.error_kind.value, result.rc, session_id, len(result.raw_stderr),
        )
        return ""
    body = result.result_text if result.result_text is not None else result.raw_stdout
    return body or ""


def record_ticket(now: datetime, thought: str | None = None) -> None:
    """ticket 回の関心 index と思考ログを更新する (load → decay → save)。

    index トップレベル last_ticket を now の ISO で更新して save。思考ログに実活動の
    機械観察を 1 行残す。state を持つ側を 1 回引いて確定する。

    thought は ephemeral claude の自由記述 (チケット #93)。truthy なら機械観察 (実活動の
    事実 anchor) に「。」で連結する = 出どころが行内に残り §F と両立。構造化スキーマ
    (timestamp + observation) は不変。

    investigate と違い thread の state は "researched" にしない (起票は調査でなく、
    同じ thread から将来別 ticket が出る余地を残す。重複は list での内容チェックで抑える)。
    last_ticket の更新は claude 起動を決めた時点で確定する (interval を成否に関わらず
    消費 = 場当たりリトライを作らない)。呼び出し側が claude 起動後に必ず 1 回呼ぶ。
    """
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    data = {**data, "last_ticket": now.isoformat()}
    interests.save_interests(INTERESTS_INDEX_PATH, data)
    observation = "共用 TODO にチケットを起票するか検討した"
    if thought:
        observation += f"。{thought}"
    interests.append_thought(THOUGHTS_LOG_PATH, observation, now)


# ---------------------------------------------------------------------------
# 自律ループ「振り返る」分岐 (persona 軸 4 拡張 (5) = リマインド)
# ---------------------------------------------------------------------------


def decide_remind(now: datetime) -> str | None:
    """この発火回で reminder するなら振り返り材料の signal、しないなら None を返す。

    decide_investigate / decide_ticket と対称。判定は index (state を持つ側) を 1 回
    引いて確定する (純関数 interests.should_remind に委譲、ここは enable フラグ + file
    読み + decay の配線)。enable off / interval 未経過 / 実 signal 無し のいずれかで None。

    decay を 1 回かけてから判定する (TTL で完全に消えたスレッドは振り返らない、save は
    しない = 掃除は記録側に相乗り)。index が空 (現状そう) なら should_remind が必ず None
    を返す = でっち上げた過去を振り返らない (§F の核)。
    """
    if not PROACTIVE_REMIND_ENABLED:
        return None
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    should, signal = interests.should_remind(
        data, now, PROACTIVE_REMIND_INTERVAL_DAYS, data.get("last_remind"),
    )
    return signal if should else None


def build_remind_prompt(signal: str) -> str:
    """振り返り claude に渡す prompt を組む (純関数)。signal は関心 index の代表 topic。

    signal は index 由来 = 実活動由来の bounded な文字列のみ (should_remind が
    recent_conversation を弾く)。boundary (tickets.py 読み取りのみ / 外向き操作ゼロ /
    催促禁止) は PROACTIVE_REMIND_PROMPT 側にプロンプトで強制する。
    """
    return PROACTIVE_REMIND_PROMPT.replace("{{TOPIC}}", signal)


async def run_remind(signal: str, now: datetime) -> str:
    """reminder 専用に毎回新規 ephemeral session で claude を起動して報告本文を返す。

    run_investigate / run_ticket と対称。#chat の会話 session は resume しない
    (tickets.py list の読み取りツール使用ターンで #chat の会話履歴・context を汚染
    しない)。budget_guard は必ず通す (M-14 単一 guard 境界、迂回禁止)。session は
    永続化しない (resume しない ephemeral なので record_usage は不要)。

    reminder は外向き/不可逆操作ゼロ (#chat に一言投げるだけ) だが、tickets.py list の
    読み取りツール使用が #chat 会話 session に混ざらないよう investigate / ticket と
    同じ ephemeral 経路を取る (新 mode 分岐 / 新ゲートを増やさず既存骨格に最小で乗る)。

    guard 拒否時は空文字を返す (呼び出し側で skip + ledger)。エラー時 / 振り返る実体が
    無く何も返さなかった場合も空文字を返し「報告なし」として扱う (talk への fallback は
    しない = この回は振り返ると決めた回)。
    """
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.info(
            "remind skip: budget guard not allowing (kind=%s)", summary.guard_kind
        )
        return ""
    session_id = str(uuid.uuid4())
    options = ClaudeOptions(
        session_id=session_id,
        timeout_s=CLAUDE_TIMEOUT,
        append_system_prompt=PERSONA_SYSTEM_PROMPT,
    )
    result = await runner.run_discord(build_remind_prompt(signal), options)
    budget_guard.record(
        datetime.now(quota.JST),
        result,
        topic_key="proactive_remind",
        session_id=session_id,
    )
    if result.error_kind != ErrorKind.OK:
        logger.warning(
            "remind claude error kind=%s rc=%s session_id=%s stderr_len=%d",
            result.error_kind.value, result.rc, session_id, len(result.raw_stderr),
        )
        return ""
    body = result.result_text if result.result_text is not None else result.raw_stdout
    return body or ""


def record_remind(now: datetime, thought: str | None = None) -> None:
    """reminder 回の関心 index と思考ログを更新する (load → decay → save)。

    index トップレベル last_remind を now の ISO で更新して save。思考ログに実活動の
    機械観察を 1 行残す。state を持つ側を 1 回引いて確定する。

    thought は ephemeral claude の自由記述 (チケット #93)。truthy なら機械観察 (実活動の
    事実 anchor) に「。」で連結する = 出どころが行内に残り §F と両立。構造化スキーマ
    (timestamp + observation) は不変。

    record_ticket と同じく thread の state は触らない (reminder は調査でも起票でもなく、
    振り返ったスレッドを将来また振り返る余地を残す)。last_remind の更新は claude 起動を
    決めた時点で確定する (interval を成否に関わらず消費 = 場当たりリトライを作らない)。
    呼び出し側が claude 起動後に必ず 1 回呼ぶ。
    """
    data = interests.load_interests(INTERESTS_INDEX_PATH)
    data = interests.decay(data, now, PROACTIVE_INTEREST_TTL_DAYS)
    data = {**data, "last_remind": now.isoformat()}
    interests.save_interests(INTERESTS_INDEX_PATH, data)
    observation = "前に気になっていたこと / 自分のチケットを振り返るか検討した"
    if thought:
        observation += f"。{thought}"
    interests.append_thought(THOUGHTS_LOG_PATH, observation, now)


# ---------------------------------------------------------------------------
# slash command bodies (no Telegram type imports → easy to unit-test)
# ---------------------------------------------------------------------------


def cmd_reset(chat_id: int, thread_id: int | None) -> str:
    if sessions.reset(chat_id, thread_id):
        return "[reset] 現 topic の session を破棄しました。次の prompt で新しい session_id が発番されます。"
    return "[reset] 現 topic に session は存在しませんでした (no-op)。"


def cmd_quota() -> str:
    summary = budget_guard.summary(datetime.now(quota.JST))
    return quota.format_summary(summary)


async def _fetch_official_usage() -> str | None:
    """Run ``claude -p "/usage"`` and return the raw text output, or None on failure.

    num_turns 0 / $0 の軽量リクエスト。parse せず全文転記する (文言マッチ分岐をしない)。
    """
    env = os.environ.copy()
    for key in ("ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
                "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_SESSION_ID"):
        env.pop(key, None)
    try:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN, "-p",
            cwd=CLAUDE_CWD,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except Exception:
        return None
    try:
        stdout_b, _ = await asyncio.wait_for(
            proc.communicate(input=b"/usage"),
            timeout=15,
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return None
    if proc.returncode != 0:
        return None
    text = stdout_b.decode("utf-8", errors="replace").strip()
    return text if text else None


def _normalize_play_url(url: str) -> str | None:
    if any(ch.isspace() or ord(ch) < 0x20 for ch in url):
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    # `https://evil@youtube.com/...` のような userinfo 詐称形を弾く。
    if parsed.username is not None or parsed.password is not None:
        return None
    host = (parsed.hostname or "").lower()
    if host not in PLAY_ALLOWED_HOSTS:
        return None
    return parsed.geturl()


async def cmd_play(url: str) -> str:
    """TV の常駐 mpv (companion-video-mpv) で再生する (旧 xdg-open ブラウザ起動を置換)。

    再生 state は mpv が所有し、操作 (一時停止/シーク/停止) はリモコン PWA 側。
    video.play は blocking socket (connect 2s + IO 5s 上限) なので to_thread で逃がす。
    成否は mpv IPC の構造化応答 1 回で確定 (リトライ・stderr 分岐なし)。
    """
    valid_url = _normalize_play_url(url)
    if valid_url is None:
        return (
            "[play] 受け付けない URL です。"
            "youtube.com / music.youtube.com / youtu.be / nicovideo.jp / nico.ms"
            " の https/http のみ対応。"
        )
    if remote_video is None:
        return "[play] remote 連携 (video.py) が読み込めていません。~/companion/remote の配置を確認。"
    resp = await asyncio.to_thread(remote_video.play, valid_url)
    if resp is None:
        return "[play] 動画プレイヤーに接続できません (companion-video-mpv 停止中?)。"
    if resp.get("error") != "success":
        return "[play] 再生開始に失敗しました (mpv がコマンドを受け付けず)。"
    return (
        f"[play] TV で再生を開始します (読み込みに最大1分ほど): {valid_url}\n"
        "一時停止・停止はリモコン PWA の動画画面から。"
    )


def classify_push_result(rc: int, stdout: str, stderr: str) -> str:
    """Format a user-facing message from a finished `git push` invocation.

    成否は呼び出し側が rc 1 回で確定済 (この関数は判定し直さない)。本関数は
    **エラーの表面化 (通知文言の整形) 専用** で、stderr を見て回復行動を分岐
    させない (`~/companion/CLAUDE.md` 2 周目ルール / 失敗回復は state 引き or
    人手介入のいずれか)。reject も agent-lock も回復行動は同一 =「止めて報告」。

    Pure function (subprocess 非依存) なので直接 unit-test できる。
    """
    combined = f"{stdout}\n{stderr}"
    if rc == 0:
        # `git push` は進捗・結果を stderr に出す。Everything up-to-date は
        # 「push する変更なし」を表す成功 (commit 済差分が remote に既にある)。
        if "Everything up-to-date" in combined:
            return "[vault-push] 既に同期済、push する変更はありません。"
        # 成功時は push した commit 範囲 (`<old>..<new> develop -> develop`) を
        # 含めて何が push されたか分かるようにする。git は範囲行を stderr に出す。
        range_line = _extract_push_range(combined)
        if range_line:
            return f"[vault-push] push 完了: {range_line}"
        return f"[vault-push] push 完了 ({VAULT_BRANCH} -> {VAULT_BRANCH})。"

    # ここから rc != 0 = 失敗確定。stderr 分類は報告文言の整形だけに使う。
    lower = combined.lower()
    if "non-fast-forward" in lower or "[rejected]" in lower or "fetch first" in lower:
        return (
            "[vault-push] reject: メイン機 / Obsidian が先に push 済 "
            f"(origin/{VAULT_BRANCH} が ahead)。手元で pull してから再実行してください。"
            "\n(自動 rebase / 自動 pull はしません)"
        )
    if (
        "permission denied (publickey)" in lower
        or "agent refused operation" in lower
        or "could not open a connection to your authentication agent" in lower
        or "host key verification failed" in lower
    ):
        return (
            "[vault-push] SSH 認証に失敗: 鍵が agent に未 load かロック中です。"
            "手元端末で `ssh-add` 後に再実行してください。"
        )
    tail = stderr.strip()[-500:] if stderr.strip() else stdout.strip()[-500:]
    return f"[vault-push] push 失敗 (rc={rc}):\n{tail}"


def _extract_push_range(text: str) -> str | None:
    """Extract the `<old>..<new> develop -> develop` style range line from git output.

    git は fast-forward push 時に ``   9867b22..460a35c  develop -> develop`` 形式の
    行を stderr に出す。new branch push は ``* [new branch] ...`` になる。
    どちらも見つからなければ None。
    """
    for raw in text.splitlines():
        line = raw.strip()
        if "->" not in line:
            continue
        if ".." in line or "[new branch]" in line:
            return line
    return None


async def cmd_vault_push() -> str:
    """`git push` vault の commit 済変更を実行し、結果メッセージを返す。

    成否は `git push` の exit code 1 回で確定する (制約 4)。失敗時のみ
    classify_push_result が stderr を分類して報告文言を整形する (回復はしない)。
    SSH_AUTH_SOCK は service unit の Environment で固定解決される (継承タイミング
    依存を排除)。GIT_SSH_COMMAND=BatchMode=yes で対話 hang を即 fail させる。
    """
    env = dict(os.environ)
    env["GIT_SSH_COMMAND"] = VAULT_PUSH_SSH_COMMAND
    # git の対話プロンプト系を全方位で無効化 (credential helper は無いが保険)。
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(VAULT_DIR), "push", VAULT_REMOTE, VAULT_BRANCH,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except FileNotFoundError:
        return "[vault-push] git が見つかりません。"
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=VAULT_PUSH_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return (
            f"[vault-push] push が {int(VAULT_PUSH_TIMEOUT_S)}s で応答せず中断しました。"
            "ネットワーク / SSH 接続を確認してください。"
        )
    stdout = stdout_b.decode("utf-8", errors="replace")
    stderr = stderr_b.decode("utf-8", errors="replace")
    return classify_push_result(proc.returncode or 0, stdout, stderr)


# ---------------------------------------------------------------------------
# /tweet: syndication API → vault clips/ Markdown + 画像 attachments/ DL + vault commit (push しない)
# ---------------------------------------------------------------------------


def _syndication_token(tid: str) -> str:
    """Compute the syndication API token from a tweet id (react-tweet 互換)。

    JS の ``((id / 1e15) * Math.PI).toString(6)`` 相当を小数込みで base36 展開し、
    末尾 ``0`` と ``.`` を除去したもの。実機検証済 (ID=20 → ``6dq1a2xwd93jfti9``、
    ID=1349129669258448897 → ``39qeyy97t9wsjr4724t2o6r``)。純関数 → unit-test 固定。
    """
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    x = (int(tid) / 1e15) * math.pi
    intpart = int(x)
    frac = x - intpart
    s = ""
    n = intpart
    if n == 0:
        s = "0"
    while n > 0:
        s = digits[n % 36] + s
        n //= 36
    out = s
    if frac > 0:
        out += "."
        for _ in range(25):
            frac *= 36
            d = int(frac)
            out += digits[d]
            frac -= d
            if frac == 0:
                break
    return re.sub(r"(0+|\.)", "", out)


def extract_tweet_id(url: str) -> str | None:
    """Return the numeric tweet id from an x.com / twitter.com status URL, else None.

    受理: ``x.com`` / ``twitter.com`` (``www.`` / ``mobile.`` 接頭辞含む) の
    ``/.../status/<digits>`` 形式 (https/http のみ、クエリは無視)。userinfo 詐称
    (``https://evil@x.com/...``) や制御文字を含む URL は弾く。純関数 → unit-test。
    """
    if any(ch.isspace() or ord(ch) < 0x20 for ch in url):
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    host = (parsed.hostname or "").lower()
    if host not in TWEET_ALLOWED_HOSTS:
        return None
    m = re.search(r"/status/(\d+)", parsed.path)
    if m is None:
        return None
    return m.group(1)


def _safe_screen_name(name: str) -> str:
    """Sanitize a screen_name for use in a filename (英数字 / _ / - のみ残す)。"""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", name or "")
    return cleaned or "unknown"


def _safe_attachment_name(url: str) -> str | None:
    """Derive a safe local filename from a media URL's basename.

    例: ``https://pbs.twimg.com/media/ErkSSFgW4AMKude.jpg`` → ``ErkSSFgW4AMKude.jpg``。
    パストラバーサル防止のため basename を取った上で ``[A-Za-z0-9_.-]`` 以外を除去する。
    除去後に拡張子しか残らない / 空になる場合は None (DL 対象外)。純関数 → unit-test。
    """
    if not url:
        return None
    # クエリ / フラグメントを落としてから basename を取る。
    path = urlparse(url).path
    base = os.path.basename(path)
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "", base)
    # ".." や "." 単体、先頭ドットのみ等の退化形を弾く。
    stem = cleaned.lstrip(".")
    if not stem:
        return None
    return cleaned


def _high_res_image_url(media_url_https: str) -> str:
    """Append ``?name=large`` (高解像度) to a pbs.twimg.com media URL.

    既にクエリが付いている場合でも name パラメータを上書きせず素直に付けない (基本
    media_url_https はクエリなし)。純関数 → unit-test。
    """
    if "?" in media_url_https:
        return media_url_https
    return f"{media_url_https}?name={TWEET_IMAGE_NAME_PARAM}"


def _select_media(media_details: list) -> list[dict]:
    """Extract structured media items from `mediaDetails`.

    返すのは dict のリスト。photo は ``{"kind": "photo", "filename": <safe basename>,
    "dl_url": <high-res url>}``、video / animated_gif は ``{"kind": "video",
    "url": <mp4 最高 bitrate or media_url_https fallback>}``。photo は basename を
    取れなかったらスキップ。純関数 (DL はしない) → unit-test。
    """
    items: list[dict] = []
    for item in media_details or []:
        if not isinstance(item, dict):
            continue
        mtype = item.get("type")
        if mtype == "photo":
            src = item.get("media_url_https")
            if not src:
                continue
            filename = _safe_attachment_name(src)
            if filename is None:
                continue
            items.append({
                "kind": "photo",
                "filename": filename,
                "dl_url": _high_res_image_url(src),
            })
        elif mtype in ("video", "animated_gif"):
            variants = (item.get("video_info") or {}).get("variants") or []
            best_url = None
            best_bitrate = -1
            for v in variants:
                if not isinstance(v, dict):
                    continue
                if v.get("content_type") != "video/mp4":
                    continue
                bitrate = v.get("bitrate", 0) or 0
                if bitrate > best_bitrate:
                    best_bitrate = bitrate
                    best_url = v.get("url")
            url = best_url or item.get("media_url_https")
            if url:
                items.append({"kind": "video", "url": url})
    return items


def _yaml_quote(value: str) -> str:
    """Quote a string for a double-quoted YAML scalar (escape ``\\`` and ``"``)。"""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def expand_tweet_text(text: str, entities: dict) -> str:
    """Expand t.co short URLs in tweet body and strip media t.co URLs.

    syndication API の ``entities.urls`` は ``{"url": <t.co>, "expanded_url": <実URL>}``
    の外部リンクマッピング、``entities.media`` は本文に冗長に載る画像/動画への t.co。
    本文整形ルール (既存クリップ慣習に準拠):
      1. ``entities.urls`` の各 t.co (``url``) を実 URL (``expanded_url``) に置換
      2. ``entities.media`` の各 t.co (``url``) を本文から除去 (空文字に置換)
      3. 除去で生じた行末空白・末尾の余分な空行を整える

    置換は 1 パスで確定する (条件分岐の積み増し・stderr 文言マッチ・リトライなし、
    `~/companion/CLAUDE.md` 設計上限ルール準拠)。``entities`` が無い / 空でも安全に
    no-op (text を整形だけして返す)。純関数 → unit-test。
    """
    result = text or ""
    ents = entities or {}
    for u in ents.get("urls") or []:
        if not isinstance(u, dict):
            continue
        short = u.get("url")
        expanded = u.get("expanded_url")
        if short and expanded:
            result = result.replace(short, expanded)
    for m in ents.get("media") or []:
        if not isinstance(m, dict):
            continue
        short = m.get("url")
        if short:
            result = result.replace(short, "")
    # 媒体 t.co 除去で残った行末空白を落とし、末尾の余分な空行を畳む。
    lines = [line.rstrip() for line in result.split("\n")]
    return "\n".join(lines).strip("\n")


def canonical_tweet_url(handle: str, tweet_id: str) -> str:
    """Build the canonical ``https://x.com/<handle>/status/<tweet_id>`` URL.

    ユーザーが渡す ``?s=20`` 等のトラッキングパラメータを持ち込まないため、API から
    得た handle と tweet_id で組み立て直す。純関数 → unit-test。
    """
    safe_handle = _safe_screen_name(handle)
    return f"https://x.com/{safe_handle}/status/{tweet_id}"


def _tweet_published_date(created_at: str, now: datetime) -> str:
    """Return the post date (JST) as ``YYYY-MM-DD``. Falls back to `now` の日付。"""
    if created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            return dt.astimezone(quota.JST).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return now.strftime("%Y-%m-%d")


def _tweet_title(text: str, screen_name: str, created_at: str, now: datetime,
                 max_len: int = 80) -> str:
    """Derive a clip title: 本文先頭の非空行を流用 (長ければ truncate)。

    本文が空なら ``<handle>(<JST datetime>)`` 形式 (既存 clips 慣習)。純関数 → unit-test。
    """
    for raw in (text or "").splitlines():
        line = raw.strip()
        if line:
            if len(line) > max_len:
                return line[:max_len].rstrip() + "…"
            return line
    # 本文なし: handle + 投稿日時 (JST)
    dt_str = ""
    if created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            dt_str = dt.astimezone(quota.JST).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            dt_str = created_at
    if not dt_str:
        dt_str = now.strftime("%Y-%m-%d %H:%M")
    return f"{screen_name}({dt_str})"


def build_tweet_markdown(data: dict, tweet_id: str, media: list[dict],
                         now: datetime) -> str:
    """Render the vault clip Markdown from a syndication `tweet-result` payload.

    frontmatter / 本文は最新クリップ慣習 (`clips/2026-03-27 @trickcal_GW 1.md`) に寄せる。
    本文は ``expand_tweet_text`` で t.co 短縮 URL を実 URL に展開し、媒体 t.co を除去
    してから HTML エンティティをデコードする。frontmatter の ``url:`` は handle と
    tweet_id から正規形 ``https://x.com/<handle>/status/<tweet_id>`` を組み立てる
    (ユーザー入力のトラッキングパラメータを持ち込まない)。
    画像 (photo) は attachments/ に DL 済 (`media` の filename)、本文では folder 名なしの
    ``![[basename]]`` 埋め込み wikilink で参照する (remote 閲覧アプリ契約)。video/gif は
    ``[動画](url)`` リンク。純関数 → unit-test。
    `media` は `_select_media` の戻り (photo は DL 成功分のみ呼び出し側が渡す)。
    """
    user = data.get("user") or {}
    name = user.get("name") or "(不明)"
    screen_name = user.get("screen_name") or "unknown"
    created_at = data.get("created_at") or ""
    text = html.unescape(expand_tweet_text(data.get("text") or "", data.get("entities") or {}))
    source_url = canonical_tweet_url(screen_name, tweet_id)
    published = _tweet_published_date(created_at, now)
    title = _tweet_title(text, screen_name, created_at, now)

    photos = [m for m in media if m.get("kind") == "photo"]
    videos = [m for m in media if m.get("kind") == "video"]
    has_media = bool(media)

    fm = [
        "---",
        f"url: {_yaml_quote(source_url)}",
        f"title: {_yaml_quote(title)}",
        "author:",
        f"  - {_yaml_quote(name)}",
        f"handle: {_yaml_quote(screen_name)}",
        "tags:",
        '  - "tweet"',
        '  - "clippings"',
    ]
    if has_media:
        fm.append('  - "media"')
    fm.append('  - "processed"')
    fm.append(f"published: {published}")
    fm.append(f"created: {now.strftime('%Y-%m-%d')}")
    if photos:
        fm.append(f"image: {_yaml_quote(f'{TWEET_ATTACHMENTS_DIR}/' + photos[0]['filename'])}")
    fm.append("---")

    lines = list(fm)
    lines += [
        "## Tweet",
        "",
        text if text.strip() else "(本文なし)",
    ]
    if has_media:
        media_parts: list[str] = []
        for m in photos:
            media_parts.append(f"![[{m['filename']}]]")
        for m in videos:
            media_parts.append(f"[動画]({m['url']})")
        lines += ["", "## Media", "", " ".join(media_parts)]
    lines += ["", "## Notes", ""]
    return "\n".join(lines)


def _tweet_clip_filename(handle: str, tweet_id: str, published: str,
                         exists: "callable") -> str:
    """Return the clip filename ``<published> @<handle>.md``, suffixing ``<tweet_id>``
    on collision (既存 clips の suffix 運用に準拠)。

    `exists(filename) -> bool` で衝突判定する (テストで差し替え可能、I/O 非依存)。
    純関数的 (副作用は呼び出し側の exists のみ)。
    """
    safe_handle = _safe_screen_name(handle)
    base = f"{published} @{safe_handle}.md"
    if not exists(base):
        return base
    return f"{published} @{safe_handle} {tweet_id}.md"


async def _fetch_tweet(tweet_id: str) -> dict | None:
    """Fetch a tweet via the syndication API. Return the JSON dict or None on any

    failure (HTTP 非200 / 非 JSON / 例外)。成否は 1 レスポンスで確定し、リトライ
    ループや stderr 文言分岐は作らない (2 周目ルール)。
    """
    params = {
        "id": tweet_id,
        "token": _syndication_token(tweet_id),
        "lang": "en",
    }
    headers = {"User-Agent": TWEET_USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=TWEET_HTTP_TIMEOUT_S) as client:
            resp = await client.get(TWEET_SYNDICATION_URL, params=params, headers=headers)
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except (json.JSONDecodeError, ValueError):
        return None


async def _download_image(dl_url: str, dest: Path) -> bool:
    """Download a single image to `dest`. Return True on success, False on any failure.

    成否は 1 取得で確定する (リトライループ・stderr 文言分岐は作らない、2 周目ルール)。
    失敗時はその画像だけスキップし、呼び出し側は処理全体を止めない。
    """
    headers = {"User-Agent": TWEET_USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=TWEET_IMAGE_HTTP_TIMEOUT_S,
                                     follow_redirects=True) as client:
            resp = await client.get(dl_url, headers=headers)
    except httpx.HTTPError:
        return False
    if resp.status_code != 200 or not resp.content:
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
    except OSError:
        return False
    return True


def _commit_tweet_clip(
    clip_filename: str, attachment_filenames: list[str],
    handle: str, tweet_id: str,
) -> tuple[bool, str]:
    """flock を取って `clips/<file>` + `attachments/<各画像>` を vault へ commit する。

    Stop フック (vault-sync-from-transcript.sh) と同じ flock で直列化 (こちらは
    取りこぼしたくないので短いブロッキング取得)。add の pathspec は `clips/<file>` と
    DL した `attachments/<画像>` に限定し、手書きエリアへの漏出を防ぐ。push はしない。
    同期 git 呼び出し (subprocess 1 回ずつ rc で確定)。戻り値 (ok, message)。
    """
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    clip_rel = f"{TWEET_CLIPS_DIR}/{clip_filename}"
    attach_rels = [f"{TWEET_ATTACHMENTS_DIR}/{n}" for n in attachment_filenames]
    pathspecs = [clip_rel, *attach_rels]
    lock_fd = os.open(str(VAULT_SYNC_LOCK_FILE), os.O_CREAT | os.O_WRONLY, 0o600)
    try:
        deadline = time.monotonic() + VAULT_LOCK_TIMEOUT_S
        acquired = False
        while time.monotonic() < deadline:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                time.sleep(0.2)
        if not acquired:
            return False, "vault の lock を取得できませんでした (他の同期処理が実行中)。"

        add = subprocess.run(
            ["git", "-C", str(VAULT_DIR), "add", "--", *pathspecs],
            capture_output=True, text=True, env=env,
        )
        if add.returncode != 0:
            return False, f"git add 失敗 (rc={add.returncode}): {add.stderr.strip()[:300]}"
        msg = (
            f"add: clips {datetime.now(quota.JST).strftime('%Y-%m-%d')} "
            f"(tweet @{_safe_screen_name(handle)} {tweet_id})"
        )
        commit = subprocess.run(
            ["git", "-C", str(VAULT_DIR), "commit", "-m", msg, "--", *pathspecs],
            capture_output=True, text=True, env=env,
        )
        if commit.returncode != 0:
            combined = (commit.stdout + commit.stderr).strip()
            return False, f"git commit 失敗 (rc={commit.returncode}): {combined[:300]}"
        return True, msg
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        finally:
            os.close(lock_fd)


async def cmd_tweet(url: str) -> str:
    """`/tweet <url>` 本体: URL→ID→取得→画像 DL→clips Markdown 保存→vault commit。

    photo は attachments/ にローカル DL し、本文では `![[basename]]` 埋め込みで参照する
    (remote 閲覧アプリ契約)。video/gif は本文に URL リンクとして残し DL しない。push は
    しない (GitHub 同期は /vault_push に委ねる)。成否は 1 レスポンスで確定 (リトライ
    ループなし)。画像 DL は 1 取得で成否確定、失敗ならその画像だけスキップしてログに残す。
    """
    tweet_id = extract_tweet_id(url)
    if tweet_id is None:
        return (
            "[tweet] 受け付けない URL です。"
            "x.com / twitter.com の status URL のみ対応。"
        )

    now = datetime.now(quota.JST)
    data = await _fetch_tweet(tweet_id)
    if data is None:
        return (
            "[tweet] 取得に失敗しました (HTTP エラー / 不正な応答)。"
            "URL が正しいか、ツイートが公開かを確認してください。"
        )
    if data.get("__typename") != "Tweet":
        return (
            "[tweet] このツイートは取得できません "
            "(削除済 / 非公開 / 鍵アカウントの可能性)。"
        )

    user = data.get("user") or {}
    handle = user.get("screen_name") or "unknown"
    published = _tweet_published_date(data.get("created_at") or "", now)

    clips_dir = VAULT_DIR / TWEET_CLIPS_DIR
    filename = _tweet_clip_filename(
        handle, tweet_id, published, lambda f: (clips_dir / f).exists()
    )
    clip_path = clips_dir / filename
    if clip_path.exists():
        # collision-resolved 名 (` <tweet_id>` suffix) まで存在 = 完全な重複保存。
        return f"[tweet] 既に保存済です: {TWEET_CLIPS_DIR}/{filename}"

    # photo は attachments/ に DL。1 取得で成否確定、失敗はその画像だけスキップ。
    media = _select_media(data.get("mediaDetails") or [])
    attachments_dir = VAULT_DIR / TWEET_ATTACHMENTS_DIR
    saved_media: list[dict] = []
    saved_attachment_names: list[str] = []
    for m in media:
        if m.get("kind") != "photo":
            saved_media.append(m)
            continue
        dest = attachments_dir / m["filename"]
        ok_dl = await _download_image(m["dl_url"], dest)
        if ok_dl:
            saved_media.append(m)
            saved_attachment_names.append(m["filename"])
        else:
            logger.warning("tweet image DL skipped: %s", m.get("dl_url"))

    markdown = build_tweet_markdown(data, tweet_id, saved_media, now)
    clip_path.parent.mkdir(parents=True, exist_ok=True)
    clip_path.write_text(markdown, encoding="utf-8")

    ok, message = await asyncio.to_thread(
        _commit_tweet_clip, filename, saved_attachment_names, handle, tweet_id
    )
    if not ok:
        return (
            f"[tweet] {TWEET_CLIPS_DIR}/{filename} に保存しましたが commit に失敗しました:\n{message}"
        )
    img_note = (
        f" 画像 {len(saved_attachment_names)} 枚を attachments/ に保存。"
        if saved_attachment_names else ""
    )
    return (
        f"[tweet] 保存 + commit 済: {TWEET_CLIPS_DIR}/{filename} (@{handle})。{img_note}"
        "GitHub 同期は /vault_push で。"
    )


def cmd_status(
    chat_id: int,
    thread_id: int | None,
    *,
    socket_ok: bool,
) -> str:
    now = datetime.now(quota.JST)
    summary = budget_guard.summary(now)
    meta = sessions.load(chat_id, thread_id)
    lines = [
        f"bot uptime: {BOT_START_AT.isoformat(timespec='seconds')} ({_fmt_duration(now - BOT_START_AT)} 前から稼働)",
        f"last claude call: {summary.last_call_at.isoformat(timespec='seconds') if summary.last_call_at else 'なし'}",
        f"notify socket: {'listening' if socket_ok else 'down'} ({NOTIFY_SOCKET})",
    ]
    if meta is not None:
        last = (
            meta.last_prompt_at.astimezone(quota.JST).isoformat(timespec="seconds")
            if meta.last_prompt_at else "未使用"
        )
        lines.append(
            f"current session: {meta.session_id} "
            f"(prompts={meta.prompt_count}, last_prompt_at={last})"
        )
    else:
        lines.append("current session: なし (次の prompt で新規発番)")
    # session context (Step 3-3: セッション肥大可視化)
    tk = sessions.topic_key(chat_id, thread_id)
    usage = quota.last_usage_for_topic(tk)
    if usage is not None:
        cache_read = int(usage.get("cache_read_input_tokens") or 0)
        lines.append(f"session context: cache_read {cache_read:,} tokens")
        if cache_read > 150_000:
            lines.append("\U0001f4a1 セッションが肥大化しています — /reset で単価が下がります")
    # voice 集計 (voice-design v2.0 §1.5 (4)、失敗しても /status 本体は出す)
    try:
        lines.append(voice_status.format_voice_summary(now))
    except Exception:
        logger.exception("voice summary failed")
        lines.append("voice: 集計失敗 — see bot.log")
    return "\n".join(lines)


def _fmt_duration(delta) -> str:
    total = int(delta.total_seconds())
    if total < 0:
        total = 0
    hours, rem = divmod(total, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours:
        return f"{hours}h{minutes:02d}m"
    if minutes:
        return f"{minutes}m{seconds:02d}s"
    return f"{seconds}s"


# ---------------------------------------------------------------------------
# OWNER 認可 4 段防御 (§4.2)
# ---------------------------------------------------------------------------


def _authorized(update: Update) -> bool:
    """Return True when the update passes all 4 stages, False otherwise.

    違反は呼び出し側で完全沈黙 (return)。Telegram の構造的利得を活用、
    Discord ephemeral 通知から脱却 (`~/companion/CLAUDE.md` OWNER 原則)。
    """
    user = update.effective_user
    chat = update.effective_chat
    if user is None or chat is None:
        return False
    # 段 1: OWNER 認可
    if user.id != OWNER_ID:
        return False
    # 段 2: bot echo 防止
    if user.is_bot:
        return False
    # 段 3: chat type (supergroup のみ)
    if chat.type != ChatType.SUPERGROUP:
        return False
    # 段 4: 想定外 supergroup 巻き込み防止
    if chat.id != NOTIFY_CHAT_ID:
        return False
    return True


# ---------------------------------------------------------------------------
# handlers
# ---------------------------------------------------------------------------


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    if msg is None:
        return
    prompt = (msg.text or "").strip()
    if not prompt:
        return
    thread_id = msg.message_thread_id
    chat_id = update.effective_chat.id

    # 個人メモ捕獲 topic (#84): claude セッションを経由せず直接 vault へ保存する。
    if BOT_THREAD_ID_MEMO is not None and thread_id == BOT_THREAD_ID_MEMO:
        await _save_memo(context.bot, msg, chat_id)
        return

    try:
        async with _typing_action(context.bot, chat_id, thread_id):
            output = await run_claude(prompt, chat_id, thread_id)
    except Exception:
        logger.exception("claude invocation failed")
        await send_text(
            context.bot, chat_id, thread_id,
            "[internal error — see bot.log]",
            reply_to=msg.message_id,
        )
        return

    logger.info("send len=%d", len(output))
    await send_text(
        context.bot, chat_id, thread_id, output, reply_to=msg.message_id,
    )


# ---------------------------------------------------------------------------
# photo message (画像応答、bot-improvement-plan.md Step 2-1)
# ---------------------------------------------------------------------------


def incoming_photo_filename(now: datetime, file_unique_id: str) -> str:
    """Return ``<ts>_<file_unique_id>.jpg`` for a downloaded chat photo.

    file_unique_id は `_safe_attachment_name` と同様に英数 ``_.-`` のみに安全化する
    (パストラバーサル防止)。退化形 (空 / ドットのみ) は ``photo`` に倒す。
    timestamp prefix (JST) は辞書順 = 時系列になるので prune の世代判定に使える。
    純関数 → unit-test。
    """
    safe = re.sub(r"[^A-Za-z0-9_.-]", "", file_unique_id or "")
    if not safe.lstrip("."):
        safe = "photo"
    return f"{now.strftime('%Y%m%d-%H%M%S')}_{safe}.jpg"


def select_prune_targets(
    filenames: list[str], keep: int = INCOMING_KEEP_PER_TOPIC
) -> list[str]:
    """Return the oldest filenames beyond `keep` (deletion candidates).

    `incoming_photo_filename` の timestamp prefix により辞書順 = 時系列なので、
    sort 1 回で世代が確定する (mtime 非依存・リトライ/分岐なし)。純関数 → unit-test。
    """
    ordered = sorted(filenames)
    excess = len(ordered) - keep
    if excess <= 0:
        return []
    return ordered[:excess]


def prune_incoming(topic_dir: Path, keep: int = INCOMING_KEEP_PER_TOPIC) -> None:
    """Delete old downloaded photos beyond `keep` in one pass (素直な世代管理)。"""
    names = [p.name for p in topic_dir.glob("*.jpg") if p.is_file()]
    for name in select_prune_targets(names, keep):
        (topic_dir / name).unlink(missing_ok=True)


def build_photo_prompt(image_path: Path | str, caption: str | None) -> str:
    """Compose the claude prompt for a chat photo.

    保存済画像の絶対パスを添えて Read ツールでの閲覧を指示する。キャプションが
    あれば prompt 本文に使い、なければデフォルト文。純関数 → unit-test。
    """
    body = (caption or "").strip()
    return "\n".join([
        f"添付画像 {image_path} を Read ツールで見て返答して。",
        body if body else PHOTO_DEFAULT_PROMPT,
    ])


async def on_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """OWNER が画像を投げたら claude に見せて返答する (メンション不要)。

    認可は on_message と同一の `_authorized` 4 段防御。最大サイズの photo を
    incoming/<topic_key>/ に保存し、保存先パスを prompt に添えて既存の
    run_claude 経路 (budget guard 込み) に乗せる。
    """
    if not _authorized(update):
        return
    msg = update.effective_message
    if msg is None or not msg.photo:
        return
    thread_id = msg.message_thread_id
    chat_id = update.effective_chat.id

    # memo topic (#84) はテキスト専用。画像を claude に流して topic を汚さない。
    if BOT_THREAD_ID_MEMO is not None and thread_id == BOT_THREAD_ID_MEMO:
        await send_text(
            context.bot, chat_id, thread_id,
            "[memo] 画像は未対応です (テキストのみ保存)",
            reply_to=msg.message_id,
        )
        return

    photo = msg.photo[-1]  # 最大サイズ
    topic_dir = INCOMING_DIR / sessions.topic_key(chat_id, thread_id)
    topic_dir.mkdir(parents=True, exist_ok=True)
    dest = topic_dir / incoming_photo_filename(
        datetime.now(quota.JST), photo.file_unique_id
    )
    try:
        tg_file = await photo.get_file()
        await tg_file.download_to_drive(custom_path=str(dest))
    except Exception:
        logger.exception("photo download failed")
        dest.unlink(missing_ok=True)
        await send_text(
            context.bot, chat_id, thread_id,
            "[photo] 画像の取得に失敗しました — see bot.log",
            reply_to=msg.message_id,
        )
        return
    prune_incoming(topic_dir)
    logger.info("photo saved: %s", dest)

    prompt = build_photo_prompt(dest, msg.caption)
    try:
        async with _typing_action(context.bot, chat_id, thread_id):
            output = await run_claude(prompt, chat_id, thread_id)
    except Exception:
        logger.exception("claude invocation failed")
        await send_text(
            context.bot, chat_id, thread_id,
            "[internal error — see bot.log]",
            reply_to=msg.message_id,
        )
        return

    logger.info("send len=%d", len(output))
    await send_text(
        context.bot, chat_id, thread_id, output, reply_to=msg.message_id,
    )


class _typing_action:
    """Periodic ``sendChatAction(typing)`` for the duration of a `with` block.

    Telegram の typing indicator は 5 秒で消えるため定期再送信する (claude
    invocation が長引いた時に「動いてる感」を出す、ux 既存挙動の踏襲)。
    AIORateLimiter は send_chat_action にも適用される。
    """

    def __init__(self, bot, chat_id: int, thread_id: int | None):
        self._bot = bot
        self._chat_id = chat_id
        self._thread_id = thread_id
        self._task: asyncio.Task | None = None

    async def __aenter__(self):
        self._task = asyncio.create_task(self._loop())
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _loop(self):
        while True:
            try:
                kwargs = {"chat_id": self._chat_id, "action": "typing"}
                if self._thread_id is not None:
                    kwargs["message_thread_id"] = self._thread_id
                await self._bot.send_chat_action(**kwargs)
            except Exception:
                # typing は best-effort、失敗しても本筋に伝播させない
                logger.debug("send_chat_action failed", exc_info=True)
            await asyncio.sleep(4.0)


# ---------------------------------------------------------------------------
# 個人メモ捕獲 topic (ticket #84)
# ---------------------------------------------------------------------------


def memo_note_filename(now: datetime, message_id: int) -> str:
    """Return ``YYYY-MM-DD_memo-<message_id>.md`` for a captured personal memo.

    message_id は chat 内で一意な int なので同日複数メモでも衝突しない。日付
    prefix で Obsidian 上は時系列に並ぶ。純関数 → unit-test。
    """
    return f"{now.strftime('%Y-%m-%d')}_memo-{message_id}.md"


def build_memo_note(text: str, created: str, edited: str | None = None) -> str:
    """Render the memo note Markdown (frontmatter + 生テキスト本文)。

    本文は加工しない (生テキスト保存が #84 の要件)。frontmatter は investigate
    ノートの慣習と同系 (source / type / created)。編集同期時は edited を追記して
    全文を再構築する (created は初回保存時の値を state から引き継ぐ)。
    純関数 → unit-test。
    """
    fm = [
        "---",
        "source: companion-bot",
        "type: memo",
        f"created: {created}",
    ]
    if edited:
        fm.append(f"edited: {edited}")
    fm.append("---")
    return "\n".join(fm) + "\n\n" + text + "\n"


def select_memo_cleanup(state: dict, now_epoch: float) -> tuple[list[str], list[str]]:
    """Return ``(to_delete, to_purge)`` message_id keys from the memo state.

    48h (MEMO_RETENTION_S) 超 → Telegram 削除対象、7 日 (MEMO_PURGE_S) 超 →
    諦めて state から落とす対象。判定は saved_at (state を持つ側) と現在時刻
    だけで確定する。削除失敗の理由文字列では分岐しない — 失敗は次周期の再試行に
    自然に乗り、7 日超で打ち切る。純関数 → unit-test。
    """
    to_delete: list[str] = []
    to_purge: list[str] = []
    for mid, entry in state.items():
        age = now_epoch - float(entry.get("saved_at", 0.0))
        if age > MEMO_PURGE_S:
            to_purge.append(mid)
        elif age > MEMO_RETENTION_S:
            to_delete.append(mid)
    return to_delete, to_purge


def _load_memo_state() -> dict:
    try:
        data = json.loads(MEMO_STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_memo_state(state: dict) -> None:
    MEMO_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MEMO_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, MEMO_STATE_PATH)


async def _memo_ack(bot, chat_id: int, message_id: int) -> None:
    """保存/同期の ack リアクション。best-effort — 失敗しても保存は成立済み。"""
    try:
        await bot.set_message_reaction(
            chat_id=chat_id,
            message_id=message_id,
            reaction=ReactionTypeEmoji(MEMO_ACK_REACTION),
        )
    except Exception:
        logger.debug("memo ack reaction failed", exc_info=True)


async def _save_memo(bot, msg, chat_id: int) -> None:
    """memo topic の生テキストを vault notes/ に直接保存する (claude 非経由)。

    個人情報込みメモ前提なので 0o600 (umask 0o077 に加えて明示 chmod)。
    message_id → 保存ファイルの対応を memo_state.json に永続化する (編集同期と
    48h cleanup の削除対象特定に使う = bot が保存したメッセージだけを扱う)。
    """
    text = msg.text or ""
    if not text.strip():
        return
    now = datetime.now(quota.JST)
    created = now.isoformat(timespec="seconds")
    path = MEMO_NOTES_DIR / memo_note_filename(now, msg.message_id)
    try:
        MEMO_NOTES_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(build_memo_note(text, created), encoding="utf-8")
        os.chmod(path, 0o600)
    except Exception:
        logger.exception("memo save failed")
        await send_text(
            bot, chat_id, BOT_THREAD_ID_MEMO,
            "[memo] 保存に失敗しました — see bot.log",
            reply_to=msg.message_id,
        )
        return
    state = _load_memo_state()
    state[str(msg.message_id)] = {
        "path": str(path),
        "saved_at": time.time(),
        "created": created,
    }
    _save_memo_state(state)
    logger.info("memo saved: %s", path.name)
    await _memo_ack(bot, chat_id, msg.message_id)


async def on_memo_edited(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """memo topic のメッセージ編集を保存済みノートへ上書き同期する (#84)。

    edited_message はこのハンドラだけが受ける (allowed_updates に追加)。他 topic
    の編集は thread 判定で無視 = 従来の物理取りこぼし挙動 (§4.5 / N-T7) を維持。
    state に無い message_id (保存前 / purge 済み) は黙って無視する。
    """
    if not _authorized(update):
        return
    msg = update.effective_message
    if msg is None:
        return
    if BOT_THREAD_ID_MEMO is None or msg.message_thread_id != BOT_THREAD_ID_MEMO:
        return
    text = msg.text or ""
    if not text.strip():
        return
    entry = _load_memo_state().get(str(msg.message_id))
    if entry is None:
        return
    now = datetime.now(quota.JST)
    path = Path(entry["path"])
    # state は bot 自身しか書かないが、書き込み先が notes/ 境界内であることを
    # 一行で担保する (vault 手書きエリアへの誤書き込みを構造的に不可能にする)。
    if not path.resolve().is_relative_to(MEMO_NOTES_DIR.resolve()):
        logger.warning("memo edit sync refused: path outside notes/ %s", path)
        return
    try:
        path.write_text(
            build_memo_note(
                text, entry.get("created", ""),
                edited=now.isoformat(timespec="seconds"),
            ),
            encoding="utf-8",
        )
        os.chmod(path, 0o600)
    except Exception:
        logger.exception("memo edit sync failed")
        await send_text(
            context.bot, update.effective_chat.id, BOT_THREAD_ID_MEMO,
            "[memo] 編集の同期に失敗しました — see bot.log",
            reply_to=msg.message_id,
        )
        return
    logger.info("memo edited: %s", path.name)
    await _memo_ack(context.bot, update.effective_chat.id, msg.message_id)


async def memo_cleanup_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    """48h 超の memo メッセージを Telegram から削除する定期突合 job (#84)。

    state (memo_state.json) と現在時刻だけで対象を確定し、bot が保存した
    メッセージのみ削除する。削除失敗は個別検知せず次周期の再試行に自然に乗せる
    (チケット要件の突合型)。7 日超は最後に 1 回試行してから state を purge する
    (恒久失敗の無限再試行を時間上限で打ち切る。vault のノート自体は消さない)。
    前提: supergroup で bot に can_delete_messages 管理者権限 (Bot API 公式:
    この権限があれば 48h 超・他ユーザーのメッセージも削除可、2026-07-11 確認)。
    """
    state = _load_memo_state()
    if not state:
        return
    to_delete, to_purge = select_memo_cleanup(state, time.time())
    processed: list[str] = []
    for mid in to_delete + to_purge:
        deleted = False
        try:
            await context.bot.delete_message(
                chat_id=NOTIFY_CHAT_ID, message_id=int(mid)
            )
            deleted = True
        except Exception:
            logger.warning(
                "memo cleanup delete failed message_id=%s", mid, exc_info=True
            )
        if deleted or mid in to_purge:
            if not deleted:
                logger.warning("memo cleanup purge (giving up) message_id=%s", mid)
            processed.append(mid)
    if processed:
        # delete_message の await 中に _save_memo が追加した新規エントリを
        # 潰さないよう、書き戻しは再ロードして処理済み key だけ pop する
        # (job は update 処理と同一ループ上の並行タスク)。
        latest = _load_memo_state()
        for mid in processed:
            latest.pop(mid, None)
        _save_memo_state(latest)
    logger.info(
        "memo cleanup: delete=%d purge=%d", len(to_delete), len(to_purge)
    )


async def slash_reset(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_reset(chat_id, thread_id)
    logger.info("cmd=/reset send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_quota(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_quota()
    usage_text = await _fetch_official_usage()
    if usage_text:
        output += (
            "\n\n[公式利用率 (アカウント全体 — bot 以外の手元セッション含む)]\n"
            + usage_text
        )
    else:
        output += "\n\n公式利用率: 取得失敗"
    logger.info("cmd=/quota send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    socket_ok = context.application.bot_data.get("notify_server") is not None
    output = cmd_status(chat_id, thread_id, socket_ok=socket_ok)
    logger.info("cmd=/status send len=%d", len(output))
    await send_text(context.bot, chat_id, thread_id, output, reply_to=msg.message_id if msg else None)


async def slash_play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    # `/play <url>` の引数解析: context.args は空白 split
    if not context.args:
        await send_text(
            context.bot, chat_id, thread_id,
            "[play] URL を引数に指定してください。例: /play https://youtu.be/xxx",
            reply_to=msg.message_id if msg else None,
        )
        return
    url = context.args[0]
    output = await cmd_play(url)
    # URL は OWNER 限定経路のため log に残してよい。allowlist 拒否時の原因切り分けに使う。
    logger.info("cmd=/play url=%r send len=%d", url, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_say(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    # `/say おはよう 今日もよろしく` → args を空白 join で 1 文に戻す
    text = " ".join(context.args or []).strip()
    if not text:
        await send_text(
            context.bot, chat_id, thread_id,
            "[say] 読み上げるテキストを指定してください。例: /say おはよう",
            reply_to=msg.message_id if msg else None,
        )
        return
    if len(text) > voice_command.MAX_SAY_TEXT:
        # silent truncate しない (M-8、沈黙でなく報告原則)
        await send_text(
            context.bot, chat_id, thread_id,
            f"[say] テキストが長すぎます ({len(text)}/{voice_command.MAX_SAY_TEXT} 字)。"
            f"{voice_command.MAX_SAY_TEXT} 字以内にしてください。",
            reply_to=msg.message_id if msg else None,
        )
        return
    # cold start 11-17s + 合成を typing indicator で吸収 (案 W-silent の
    # Telegram 読み替え、中間メッセージは追加しない)
    started = time.monotonic()
    async with _typing_action(context.bot, chat_id, thread_id):
        rc, output = await voice_command.cmd_say(text)
    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        voice_command.append_ledger(text, rc, duration_ms)
    except OSError:
        logger.exception("voice ledger append failed")
    logger.info("cmd=/say len=%d rc=%d duration_ms=%d", len(text), rc, duration_ms)
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_tweet(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    if not context.args:
        await send_text(
            context.bot, chat_id, thread_id,
            "[tweet] URL を引数に指定してください。例: /tweet https://x.com/user/status/123",
            reply_to=msg.message_id if msg else None,
        )
        return
    url = context.args[0]
    output = await cmd_tweet(url)
    # URL は OWNER 限定経路のため log に残してよい (STATUS.md log 方針)。
    logger.info("cmd=/tweet url=%r send len=%d", url, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_snooze(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = cmd_snooze(context.args or [])
    logger.info("cmd=/snooze args=%r send len=%d", context.args, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def _remind_fire(context: ContextTypes.DEFAULT_TYPE) -> None:
    data = context.job.data
    await send_text(
        context.bot, data["chat_id"], data["thread_id"],
        f"[リマインド] {data['message']}",
    )
    _remove_reminder(data["reminder_id"])
    logger.info("remind fired id=%s msg=%r", data["reminder_id"], data["message"])


async def slash_remind(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    args = context.args or []

    if not args:
        output = cmd_remind_usage()
    elif args[0] == "list":
        output = cmd_remind_list()
    elif args[0] == "cancel":
        if len(args) < 2:
            output = "[remind] キャンセルする番号を指定してください。例: /remind cancel 1"
        else:
            output = cmd_remind_cancel(args[1])
            if "キャンセルしました" in output:
                active_ids = {r["id"] for r in _load_reminders()}
                for job in context.application.job_queue.jobs():
                    if (job.name and job.name.startswith("remind_")
                            and isinstance(job.data, dict)
                            and job.data.get("reminder_id") not in active_ids):
                        job.schedule_removal()
    else:
        delay = parse_remind_duration(args[0])
        if delay is None:
            output = (
                f"[remind] 時間の指定が不正です: {args[0]}\n"
                "例: 30m, 1h, 2h30m, 1d, 90s (最大7日)"
            )
        elif len(args) < 2:
            output = "[remind] メッセージを指定してください。例: /remind 30m 洗濯物"
        else:
            message = " ".join(args[1:])
            fire_at = time.time() + delay
            entry = _add_reminder(chat_id, thread_id, fire_at, message)
            context.application.job_queue.run_once(
                _remind_fire,
                when=delay,
                data={
                    "chat_id": chat_id,
                    "thread_id": thread_id,
                    "message": message,
                    "reminder_id": entry["id"],
                },
                name=f"remind_{entry['id']}",
            )
            fire_jst = datetime.fromtimestamp(fire_at, quota.JST)
            output = (
                f"[remind] セットしました: {message}\n"
                f"発火: {fire_jst.strftime('%m/%d %H:%M')}"
            )

    logger.info("cmd=/remind args=%r send len=%d", args, len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


async def slash_vault_push(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    msg = update.effective_message
    chat_id = update.effective_chat.id
    thread_id = msg.message_thread_id if msg else None
    output = await cmd_vault_push()
    logger.info("cmd=/vault_push send len=%d", len(output))
    await send_text(
        context.bot, chat_id, thread_id, output,
        reply_to=msg.message_id if msg else None,
    )


# ---------------------------------------------------------------------------
# notify socket (queue + 1 worker for order guarantee, §5.2)
# ---------------------------------------------------------------------------


async def _notify_worker(app: Application) -> None:
    queue: asyncio.Queue = app.bot_data["notify_queue"]
    while True:
        text = await queue.get()
        try:
            is_critical = text.startswith(CRITICAL_PREFIX)  # 完全一致 (W-6 上限ルール)
            thread_id = BOT_THREAD_ID_MAINTENANCE
            await send_text(
                app.bot,
                NOTIFY_CHAT_ID,
                thread_id,
                text,
                disable_notification=(not is_critical),
            )
            logger.info("notify forwarded len=%d critical=%s", len(text), is_critical)
        except Exception:
            logger.exception("notify forward failed")
        finally:
            queue.task_done()


async def _proactive_worker(app: Application) -> None:
    """Serialize proactive requests: claude 起動 (guard 経由) → #chat 送信 → ledger。

    notify queue とは別 worker。claude 起動は **必ず run_claude (budget guard を
    通る経路)** を再利用する。guard を迂回して claude_runner を直叩きしない
    (M-14 単一 guard 境界)。guard が許可しなければ skip (ledger に残すだけ)。
    """
    queue: asyncio.Queue = app.bot_data["proactive_queue"]
    while True:
        payload = await queue.get()
        try:
            await _run_proactive(app, payload)
        except Exception:
            logger.exception("proactive request failed")
        finally:
            queue.task_done()


async def _run_proactive(app: Application, payload: dict) -> None:
    now = datetime.now(quota.JST)
    seed_kind = payload.get("seed_kind", "unknown")
    base = {
        "timestamp": now.isoformat(),
        "seed_kind": seed_kind,
        "vault_hint": payload.get("vault_hint"),
        "dormant_hint": payload.get("dormant_hint"),
        # 軸 4 拡張 (6) 前景降格ガードの静的 marker。降格ルールが PERSONA_SYSTEM_PROMPT
        # に載った状態で起動した回 = 外向き衝動が前景提案に降格される対象だった回、を
        # 記録するだけ。提案テキストの有無は機械検知しない (文言マッチ・操作分類分岐を
        # 作らない方針)。全モード (talk/investigate/ticket/remind) が base を継承するので 1 箇所で乗る。
        "foreground_proposal": True,
    }

    # bot 側グローバル off / snooze の二重防御 (script 側でも見るが state すれ違い
    # や手動 socket 投入に備え bot 側でも 1 回引いて確定する)。
    if not PROACTIVE_ENABLED:
        logger.info("proactive skip: PROACTIVE_ENABLED is off")
        _append_proactive_ledger({**base, "sent": False, "reason": "disabled"})
        return
    if is_snoozed():
        logger.info("proactive skip: snoozed")
        _append_proactive_ledger({**base, "sent": False, "reason": "snoozed"})
        return

    chat_id = NOTIFY_CHAT_ID
    thread_id = BOT_THREAD_ID_CHAT

    # budget guard は run_claude の内部で必ず通る。ここで事前に summary を 1 回取って
    # 「guard 拒否で skip だったか」を ledger に残せるようにする (run_claude は拒否時
    # に exceeded_message 文字列を返すので、それを #chat に投げないため事前判定する)。
    if not budget_guard.allow(now):
        summary = budget_guard.summary(now)
        logger.info("proactive skip: budget guard not allowing (kind=%s)", summary.guard_kind)
        _append_proactive_ledger({
            **base, "sent": False, "reason": "budget_guard",
            "guard_kind": summary.guard_kind,
        })
        return

    # 全 7 ゲート (script 側) + PROACTIVE_ENABLED / snooze / budget の二重防御を通過
    # した発火回。ここで index (state を持つ側) を 1 回引いてモードを確定する。各モードは
    # 独立 interval を state 1 read で持ち、due かつ実 signal ありのモードを固定優先順
    # (investigate → ticket → reminder → talk) で上から 1 つ拾う (確率でモードを選ばない =
    # 決定的に確定、2 周目ルール厳守)。どれも該当しなければ talk に倒す。
    investigate_topic = decide_investigate(now)
    if investigate_topic is not None:
        await _run_proactive_investigate(app, base, investigate_topic, now)
        return

    ticket_signal = decide_ticket(now)
    if ticket_signal is not None:
        await _run_proactive_ticket(app, base, ticket_signal, now)
        return

    remind_signal = decide_remind(now)
    if remind_signal is not None:
        await _run_proactive_remind(app, base, remind_signal, now)
        return

    # prompt 構築時に読む関心 index は「前回までに溜まった分」(今回の種の touch は
    # 送信後)。今喋る内容は過去の関心から滲ませ、今の種は新たな接触として後で記録する。
    interest_topics = build_interest_context(now)
    prompt = build_proactive_prompt(payload, interest_topics=interest_topics, now=now)
    # run_claude は guard を通り、#chat の session を resume して claude を起動する。
    output = await run_claude(prompt, chat_id, thread_id)
    # 次回発話タイミングの自己申告 (チケット #92)。marker 剥がしは toggle 非依存で
    # 常に行う (--resume 履歴の自己強化で off 後も marker が出る回に生 marker を
    # Telegram へ流さない)。state 書き込みだけを toggle で止める。申告は本文より
    # 先に分離する = 本文なし + 申告のみの回 (「今は黙るが次はこの頃」) も成立し、
    # そのまま既存 empty_output skip に落ちる。書き込み失敗は本体を道連れにしない
    # (次回は script 側が従来の確率パスへ倒れるだけ = 安全側)。
    next_self_hours = None
    if output:
        output, next_self_hours = split_next_self_hours(output)
    if PROACTIVE_SELF_SCHEDULE_ENABLED and next_self_hours is not None:
        next_self_hours = min(
            max(next_self_hours, PROACTIVE_SELF_SCHEDULE_MIN_HOURS),
            PROACTIVE_SELF_SCHEDULE_MAX_HOURS,
        )
        try:
            write_next_self_at(int(now.timestamp() + next_self_hours * 3600))
        except OSError as e:
            logger.warning("proactive next_self_at write failed: %s", e)
    if not output or not output.strip():
        # 空出力 = claude の沈黙権行使 (チケット #91、prompt で許可済み) または
        # エラー時の空文字。どちらも「送らない」の 1 状態に倒す (切り分けは bot.log の
        # run_claude 側ログで可能、ledger に分類 enum を増やさない)。script 側週カウント
        # (proactive_fire_epochs) は socket handoff 時に消費済みで戻さない — investigate/
        # ticket/remind の「claude 起動を決めた時点で interval 消費、成否問わず」と同思想
        # (週カウントは送信数上限でなく発火試行の総量管理。沈黙分だけ発話が減る方向 =
        # 安全側。bot→script の払い戻し書き込みは state 競合と連続発火 race を生むので作らない)。
        logger.info("proactive skip: empty claude output")
        _append_proactive_ledger({
            **base, "sent": False, "reason": "empty_output",
            "next_self_hours": next_self_hours,
        })
        return

    await send_text(app.bot, chat_id, thread_id, output, disable_notification=True)
    # 自発発話で送信した以上 last_prompt_at は run_claude 内 record_usage で更新済
    # (連投防止 = 沈黙判定がこの時刻基準で再カウントされる)。
    # 送信済みの一言を TV からも声で流す (todo#22、同期待ちしない fire-and-forget)。
    voice_state = _dispatch_proactive_voice(app, output)
    # 送信が確定した実活動なので、その種から関心 index を更新し思考ログに観察を残す
    # (機構 1 の seeding、実活動起点のみ)。記録失敗は proactive 本体を道連れにしない。
    try:
        record_proactive_interest(payload, now, next_self_hours=next_self_hours)
    except OSError as e:
        logger.warning("proactive interest record failed: %s", e)
    logger.info(
        "proactive sent len=%d seed_kind=%s voice=%s", len(output), seed_kind, voice_state
    )
    _append_proactive_ledger({
        **base, "sent": True, "reason": "ok", "output_len": len(output),
        "next_self_hours": next_self_hours,
        "voice": voice_state,
        "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
    })


async def _run_proactive_investigate(
    app: Application, base: dict, topic: str, now: datetime,
) -> None:
    """「動く」分岐: 関心スレッドを Web 調査 → notes 新規作成 → #chat に一言報告。

    ephemeral session で claude を起動し (run_investigate)、report 本文を #chat に
    送る。investigate は #chat の会話 session を更新しないため、報告送信後に #chat
    session の last_prompt_at を明示更新する (4h 最低間隔の暴走防止を investigate 後も
    効かせる。これは「bot が #chat に喋った」事実の正しい反映でもある)。

    last_investigate / state=researched の index 更新は claude 起動を決めた時点で確定
    する (record_investigate を成否に関わらず必ず 1 回呼ぶ = interval を消費して場当たり
    リトライを作らない)。budget guard 拒否 / 空報告は talk にフォールバックせず skip +
    ledger (この回は「動く」と決めた回、喋りに落とさない)。
    """
    chat_id = NOTIFY_CHAT_ID
    thread_id = BOT_THREAD_ID_CHAT
    ibase = {**base, "mode": "investigate", "investigate_topic": topic}

    output = await run_investigate(topic, now)
    # 思考自由記述 (#93) + 派生関心 (#96) の marker を本文から分離する。以降の empty
    # 判定・送信・output_len は分離後の本文で行う (marker 行は Telegram に流さない)。
    # skip return より先に record を呼ぶので、本文空 + marker のみの沈黙回でも
    # thought / 派生関心は記録される。
    output, thought, derived = split_investigate_markers(output)

    # interval / 二度調査回避の state を消費する (claude を起動した時点で確定)。
    # 記録失敗は本体を道連れにしない (index は次回 due として再挑戦になるだけ)。
    try:
        record_investigate(topic, now, thought=thought, derived=derived)
    except OSError as e:
        logger.warning("investigate interest record failed: %s", e)

    if not output or not output.strip():
        logger.info("investigate skip: empty/denied report (topic=%s)", topic)
        # reason は "empty_or_denied" でまとめるが、guard_kind を併記して budget 拒否
        # (guard が allowing でない) と claude の空報告を ledger 上で切り分け可能にする。
        _append_proactive_ledger({
            **ibase, "sent": False, "reason": "empty_or_denied",
            "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
        })
        return

    await send_text(app.bot, chat_id, thread_id, output, disable_notification=True)
    # investigate は ephemeral session で #chat session を更新しないため、ここで
    # 明示的に #chat の last_prompt_at を進める (沈黙ゲート 4h の最低間隔を保全)。
    # state が無ければ発番せず skip (幻 session 防止、record_usage_if_exists docstring
    # 参照。暴走防止は record_investigate の interval 消費が下支え)。
    if not sessions.record_usage_if_exists(chat_id, thread_id):
        logger.info("investigate touch skip: no #chat session state")
    voice_state = _dispatch_proactive_voice(app, output)
    logger.info(
        "investigate sent len=%d topic=%s voice=%s", len(output), topic, voice_state
    )
    _append_proactive_ledger({
        **ibase, "sent": True, "reason": "ok", "output_len": len(output),
        "voice": voice_state,
        "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
    })


async def _run_proactive_ticket(
    app: Application, base: dict, signal: str, now: datetime,
) -> None:
    """「起票する」分岐: 関心 signal を元に共用 TODO に 1 件起票 → #chat に一言報告。

    _run_proactive_investigate と対称。ephemeral session で claude を起動し (run_ticket、
    boundary はプロンプトで強制)、報告本文を #chat に送る。ticket は #chat の会話 session
    を更新しないため、報告送信後に #chat session の last_prompt_at を明示更新する
    (4h 最低間隔の暴走防止を ticket 後も効かせる)。

    last_ticket の interval 消費は claude 起動を決めた時点で確定する (record_ticket を
    成否に関わらず必ず 1 回呼ぶ = 場当たりリトライを作らない)。budget guard 拒否 /
    空報告 (起票しなかった場合含む) は talk にフォールバックせず skip + ledger。
    investigate と違い thread の state は触らない (record_ticket は last_ticket のみ消費)。
    """
    chat_id = NOTIFY_CHAT_ID
    thread_id = BOT_THREAD_ID_CHAT
    tbase = {**base, "mode": "ticket", "ticket_signal": signal}

    output = await run_ticket(signal, now)
    # 思考自由記述 marker を本文から分離する (チケット #93)。以降の empty 判定・送信・
    # output_len は分離後の本文で行う (marker 行は Telegram に流さない)。skip return より
    # 先に record を呼ぶので、本文空 + thought のみの沈黙回でも thought は思考ログに残る。
    output, thought = split_thought(output)

    # interval state を消費する (claude を起動した時点で確定)。記録失敗は本体を道連れに
    # しない (index は次回 due として再挑戦になるだけ)。
    try:
        record_ticket(now, thought=thought)
    except OSError as e:
        logger.warning("ticket interest record failed: %s", e)

    if not output or not output.strip():
        logger.info("ticket skip: empty/denied report (signal=%s)", signal)
        _append_proactive_ledger({
            **tbase, "sent": False, "reason": "empty_or_denied",
            "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
        })
        return

    await send_text(app.bot, chat_id, thread_id, output, disable_notification=True)
    # ticket は ephemeral session で #chat session を更新しないため、ここで明示的に
    # #chat の last_prompt_at を進める (沈黙ゲート 4h の最低間隔を保全)。
    # state が無ければ発番せず skip (幻 session 防止、record_usage_if_exists docstring
    # 参照。暴走防止は record_ticket の interval 消費が下支え)。
    if not sessions.record_usage_if_exists(chat_id, thread_id):
        logger.info("ticket touch skip: no #chat session state")
    voice_state = _dispatch_proactive_voice(app, output)
    logger.info(
        "ticket sent len=%d signal=%s voice=%s", len(output), signal, voice_state
    )
    _append_proactive_ledger({
        **tbase, "sent": True, "reason": "ok", "output_len": len(output),
        "voice": voice_state,
        "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
    })


async def _run_proactive_remind(
    app: Application, base: dict, signal: str, now: datetime,
) -> None:
    """「振り返る」分岐: 過去の関心 / 自分のチケットを振り返って #chat に一言報告。

    _run_proactive_investigate / _run_proactive_ticket と対称。ephemeral session で
    claude を起動し (run_remind、boundary はプロンプトで強制)、報告本文を #chat に送る。
    reminder は外向き/不可逆操作ゼロ (tickets.py list の読み取りと #chat への一言だけ) だが、
    読み取りツール使用ターンが #chat 会話 session に混ざらないよう ephemeral 経路を取る。
    reminder は #chat の会話 session を更新しないため、報告送信後に #chat session の
    last_prompt_at を明示更新する (4h 最低間隔の暴走防止を reminder 後も効かせる)。

    last_remind の interval 消費は claude 起動を決めた時点で確定する (record_remind を
    成否に関わらず必ず 1 回呼ぶ = 場当たりリトライを作らない)。budget guard 拒否 /
    空報告 (振り返る実体が無かった場合含む) は talk にフォールバックせず skip + ledger。
    record_ticket と同じく thread の state は触らない (record_remind は last_remind のみ消費)。
    """
    chat_id = NOTIFY_CHAT_ID
    thread_id = BOT_THREAD_ID_CHAT
    rbase = {**base, "mode": "remind", "remind_signal": signal}

    output = await run_remind(signal, now)
    # 思考自由記述 marker を本文から分離する (チケット #93)。以降の empty 判定・送信・
    # output_len は分離後の本文で行う (marker 行は Telegram に流さない)。skip return より
    # 先に record を呼ぶので、本文空 + thought のみの沈黙回でも thought は思考ログに残る。
    output, thought = split_thought(output)

    # interval state を消費する (claude を起動した時点で確定)。記録失敗は本体を道連れに
    # しない (index は次回 due として再挑戦になるだけ)。
    try:
        record_remind(now, thought=thought)
    except OSError as e:
        logger.warning("remind interest record failed: %s", e)

    if not output or not output.strip():
        logger.info("remind skip: empty/denied report (signal=%s)", signal)
        _append_proactive_ledger({
            **rbase, "sent": False, "reason": "empty_or_denied",
            "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
        })
        return

    await send_text(app.bot, chat_id, thread_id, output, disable_notification=True)
    # reminder は ephemeral session で #chat session を更新しないため、ここで明示的に
    # #chat の last_prompt_at を進める (沈黙ゲート 4h の最低間隔を保全)。
    # state が無ければ発番せず skip (幻 session 防止、record_usage_if_exists docstring
    # 参照。暴走防止は record_remind の interval 消費が下支え)。
    if not sessions.record_usage_if_exists(chat_id, thread_id):
        logger.info("remind touch skip: no #chat session state")
    voice_state = _dispatch_proactive_voice(app, output)
    logger.info(
        "remind sent len=%d signal=%s voice=%s", len(output), signal, voice_state
    )
    _append_proactive_ledger({
        **rbase, "sent": True, "reason": "ok", "output_len": len(output),
        "voice": voice_state,
        "guard_kind": budget_guard.summary(datetime.now(quota.JST)).guard_kind,
    })


def _dispatch_proactive_voice(app: Application, text: str) -> str:
    """自発発話の一言を TV から声で流す (fire-and-forget)。戻り値は ledger 用の判定。

    「生成と再生の分離」(persona 軸 4 / voice STATUS 2026-06-12): 自発発話は返事を
    期待しない一方通行なので、合成・再生を await せず別 task に投げて proactive
    worker をブロックしない。土管は /say と同じ voice_command.cmd_say (engine 都度
    起動 → 合成 → stop、_say_lock で /say と直列化済み)。
    """
    if not PROACTIVE_VOICE_ENABLED:
        return "disabled"
    # cmd_say は長さチェックを持たない (MAX_SAY_TEXT は /say ハンドラ側の責務)。
    # 自発発話は 1〜2 文 = 通常 ≤ 100 字だが保証はないので、超過時は音声だけ落とす
    # (silent truncate しない = M-8。Telegram 本文はそのまま残る)。判定は長さ 1 回で確定。
    if len(text) > voice_command.MAX_SAY_TEXT:
        logger.info(
            "proactive voice skip: too long (%d/%d)", len(text), voice_command.MAX_SAY_TEXT
        )
        return "too_long"
    task = asyncio.create_task(_proactive_voice_worker(text))
    # detach した task は参照を持たないと GC される (asyncio の既知挙動)。
    # bot_data に保持し、完了時に done callback で捨てる。
    tasks: set = app.bot_data.setdefault("proactive_voice_tasks", set())
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return "dispatched"


async def _proactive_voice_worker(text: str) -> None:
    """裏で合成 → 再生 (cmd_say 流用)。失敗は logger のみ (proactive 本体は道連れにしない)。

    voice_ledger には書かない。voice_ledger は /say = ユーザー実需の集計元 (Phase 4
    常駐化 trigger) であり、自動の自発発話を混ぜると実需を水増しするため。声の rc は
    logger に、発火有無は proactive_ledger の voice フィールドに残す (集計の置き場所を分離)。
    """
    started = time.monotonic()
    try:
        rc, _ = await voice_command.cmd_say(text)
    except Exception:
        logger.exception("proactive voice failed")
        return
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info("proactive voice rc=%d duration_ms=%d", rc, duration_ms)


async def _handle_notify_connection(
    app: Application,
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
) -> None:
    try:
        # 同 UID 内 bug / 暴走による無制限メモリ消費を物理的に止める (Phase 2
        # B4-4 と同じ意図、Telegram chunk 後でも rate limit を踏みかねない巨大
        # push を socket 受信段階で打ち切る)。
        data = await reader.read(NOTIFY_SOCKET_MAX_BYTES)
        text = data.decode("utf-8", errors="replace").strip()
        if not text:
            return
        # 構造化 envelope なら proactive 経路へ、それ以外は従来の素通し forward。
        proactive = parse_proactive_payload(text)
        if proactive is not None:
            queue: asyncio.Queue = app.bot_data["proactive_queue"]
            await queue.put(proactive)
            return
        queue = app.bot_data["notify_queue"]
        await queue.put(text)
    except Exception:
        logger.exception("notify socket recv failed")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# long polling stall check (§4.6)
# ---------------------------------------------------------------------------


async def stall_check_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    bot_data = context.application.bot_data
    try:
        await context.bot.get_me()
        bot_data["stall_count"] = 0
    except Exception:
        bot_data["stall_count"] = bot_data.get("stall_count", 0) + 1
        logger.warning(
            "stall_check_job: get_me() failed (consecutive %d)",
            bot_data["stall_count"],
        )
        if bot_data["stall_count"] >= STALL_FAIL_THRESHOLD:
            logger.critical(
                "long polling stall %d consecutive, exiting for systemd restart",
                bot_data["stall_count"],
            )
            # critical 通知を best-effort で投げてから落ちる。
            try:
                await send_text(
                    context.bot,
                    NOTIFY_CHAT_ID,
                    BOT_THREAD_ID_MAINTENANCE,
                    f"{CRITICAL_PREFIX}bot long polling stall {bot_data['stall_count']} 回、再起動します",
                    disable_notification=False,
                )
            except Exception:
                logger.exception("critical notify on stall failed")
            sys.exit(1)


# ---------------------------------------------------------------------------
# post_init: privacy mode check, slash command registration, notify socket,
# notify worker, stall check job
# ---------------------------------------------------------------------------


async def post_init(application: Application) -> None:
    # privacy mode off 確認 (§4.2 末尾)
    me = await application.bot.get_me()
    if not me.can_read_all_group_messages:
        logger.critical(
            "privacy mode が ON のままです (BotFather → Bot Settings → Group Privacy → Turn off)"
        )
        sys.exit(1)
    logger.info("logged in as @%s (id=%s)", me.username, me.id)

    # supergroup の到達性確認 (§4.2 段 4 と整合)。typo / 権限喪失 / supergroup 未参加なら起動時に sys.exit、当日デバッグの早期化 (privacy mode off チェックと対称)
    try:
        chat = await application.bot.get_chat(NOTIFY_CHAT_ID)
        logger.info("notify chat verified: id=%s title=%r type=%s",
                    chat.id, chat.title, chat.type)
    except Exception:
        logger.critical("notify chat %s could not be resolved (typo / bot not in supergroup / 権限喪失)",
                        NOTIFY_CHAT_ID, exc_info=True)
        sys.exit(1)

    # slash command scope を NOTIFY_CHAT_ID に限定 (§4.4)
    commands = [
        BotCommand("reset", "現 topic の claude セッションを破棄"),
        BotCommand("quota", "bot 経由 prompt の予算 / 集計を表示"),
        BotCommand("status", "bot 稼働状況 / current session を表示"),
        BotCommand("play", "YouTube URL をこの PC のブラウザで開く"),
        BotCommand("say", "テキストを TV で読み上げ (VOICEVOX、最大 100 字)"),
        BotCommand("tweet", "ツイート/ポストを vault に保存"),
        BotCommand("vault_push", "vault の commit 済変更を GitHub に push"),
        BotCommand("snooze", "自発発話を指定日数止める (例: /snooze 3、解除は /snooze 0)"),
        BotCommand("remind", "リマインダ設定 (例: /remind 30m 洗濯物)"),
    ]
    scope = BotCommandScopeChat(chat_id=NOTIFY_CHAT_ID)
    try:
        await application.bot.delete_my_commands(scope=scope)
        await application.bot.set_my_commands(commands=commands, scope=scope)
        logger.info("slash commands registered to chat %s: %s",
                    NOTIFY_CHAT_ID, [c.command for c in commands])
    except Exception:
        logger.exception("slash command registration failed")

    # notify socket の listen を開始 (§5.2)
    try:
        NOTIFY_SOCKET.unlink()
    except FileNotFoundError:
        pass
    application.bot_data["notify_queue"] = asyncio.Queue()
    application.bot_data["proactive_queue"] = asyncio.Queue()
    server = await asyncio.start_unix_server(
        lambda r, w: _handle_notify_connection(application, r, w),
        path=str(NOTIFY_SOCKET),
    )
    os.chmod(NOTIFY_SOCKET, 0o600)
    application.bot_data["notify_server"] = server
    application.bot_data["notify_worker_task"] = asyncio.create_task(
        _notify_worker(application)
    )
    application.bot_data["proactive_worker_task"] = asyncio.create_task(
        _proactive_worker(application)
    )
    logger.info("notify socket listening at %s (proactive enabled=%s)",
                NOTIFY_SOCKET, PROACTIVE_ENABLED)

    # stall check job (§4.6)
    application.job_queue.run_repeating(
        stall_check_job,
        interval=STALL_CHECK_INTERVAL_S,
        first=STALL_CHECK_INTERVAL_S,
        name="stall_check",
    )

    # memo 48h cleanup job (#84)。topic 未設定なら登録しない (機能ごと無効)。
    # first=60s で再起動またぎの取りこぼしも起動直後に突合する。
    if BOT_THREAD_ID_MEMO is not None:
        application.job_queue.run_repeating(
            memo_cleanup_job,
            interval=MEMO_CLEANUP_INTERVAL_S,
            first=60.0,
            name="memo_cleanup",
        )

    # /remind 再スケジュール
    now = time.time()
    reminders = _load_reminders()
    surviving = [r for r in reminders if r["fire_at"] > now]
    if len(surviving) != len(reminders):
        _save_reminders(surviving)
    for r in surviving:
        delay = r["fire_at"] - now
        application.job_queue.run_once(
            _remind_fire,
            when=delay,
            data={
                "chat_id": r["chat_id"],
                "thread_id": r.get("thread_id"),
                "message": r["message"],
                "reminder_id": r["id"],
            },
            name=f"remind_{r['id']}",
        )
    if surviving:
        logger.info("reminders restored: %d active, %d expired",
                    len(surviving), len(reminders) - len(surviving))


async def post_shutdown(application: Application) -> None:
    server = application.bot_data.get("notify_server")
    if server is not None:
        server.close()
        try:
            await server.wait_closed()
        except Exception:
            pass
    for key in ("notify_worker_task", "proactive_worker_task"):
        worker_task: asyncio.Task | None = application.bot_data.get(key)
        if worker_task is not None:
            worker_task.cancel()
            try:
                await worker_task
            except (asyncio.CancelledError, Exception):
                pass
    # 自発発話の声 (fire-and-forget) も他 background task と対称に回収する。
    # 合成中に再起動が来た場合 cancel が cmd_say の finally (engine stop) まで
    # 走らないと engine が残留しうるため、取り残しを消す (todo#22)。
    for voice_task in list(application.bot_data.get("proactive_voice_tasks", ())):
        voice_task.cancel()
        try:
            await voice_task
        except (asyncio.CancelledError, Exception):
            pass
    try:
        NOTIFY_SOCKET.unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def build_application() -> Application:
    app = (
        ApplicationBuilder()
        .token(TELEGRAM_BOT_TOKEN)
        .rate_limiter(AIORateLimiter())
        .post_init(post_init)
        .post_shutdown(post_shutdown)
        .build()
    )

    # edited_message を物理的に取りこぼす (§4.5 / N-T7、W-6)。
    message_filter = filters.UpdateType.MESSAGE & ~filters.UpdateType.EDITED_MESSAGE
    app.add_handler(CommandHandler("reset", slash_reset, filters=message_filter))
    app.add_handler(CommandHandler("quota", slash_quota, filters=message_filter))
    app.add_handler(CommandHandler("status", slash_status, filters=message_filter))
    app.add_handler(CommandHandler("play", slash_play, filters=message_filter))
    app.add_handler(CommandHandler("say", slash_say, filters=message_filter))
    app.add_handler(CommandHandler("tweet", slash_tweet, filters=message_filter))
    app.add_handler(CommandHandler("vault_push", slash_vault_push, filters=message_filter))
    app.add_handler(CommandHandler("snooze", slash_snooze, filters=message_filter))
    app.add_handler(CommandHandler("remind", slash_remind, filters=message_filter))
    # slash command 以外の text message → on_message
    app.add_handler(
        MessageHandler(
            message_filter & filters.TEXT & ~filters.COMMAND,
            on_message,
        )
    )
    # photo message → on_photo (メンション不要、画像投稿そのものがトリガ。Step 2-1)
    app.add_handler(
        MessageHandler(
            message_filter & filters.PHOTO,
            on_photo,
        )
    )
    # memo topic の編集同期 (#84)。edited_message を受けるのはこのハンドラだけで、
    # memo topic 以外の編集はハンドラ内 thread 判定で無視 = 従来の取りこぼし挙動を維持。
    app.add_handler(
        MessageHandler(
            filters.UpdateType.EDITED_MESSAGE & filters.TEXT & ~filters.COMMAND,
            on_memo_edited,
        )
    )
    return app


def main() -> None:
    app = build_application()
    # §4.5 allowlist: message + edited_message (#84 memo 編集同期のため追加。
    # edited は on_memo_edited だけが受け、他 topic の編集は従来どおり無視される)
    app.run_polling(allowed_updates=["message", "edited_message"])


if __name__ == "__main__":
    main()
