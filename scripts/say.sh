#!/usr/bin/env bash
# voice/scripts/say.sh - VOICEVOX 合成 + 発話 consumer API
# 仕様: ~/companion/workspace/redesign/voice-design.md v2.0 §1.4
# 合成フローは 1 回で確定 (リトライ自動化禁止、CLAUDE.md「1 回で確定」原則)

set -u

VOICE_HOME="${VOICE_HOME:-$HOME/companion/voice}"

if [ -f "$VOICE_HOME/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$VOICE_HOME/.env"
    set +a
fi

ENGINE_HOST="${ENGINE_HOST:-127.0.0.1}"
ENGINE_PORT="${ENGINE_PORT:-50021}"
ENGINE_URL="http://${ENGINE_HOST}:${ENGINE_PORT}"
DEFAULT_SPEAKER="${VOICE_DEFAULT_SPEAKER:-2}"

STATE_DIR="$VOICE_HOME/.state"
LOCK_FILE="$STATE_DIR/engine.lock"
SOCK="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/companion-bot.sock"

MAX_TEXT_LEN=2000
LOCK_TIMEOUT_SEC=5

usage() {
    cat <<EOF
Usage: ${0##*/} "TEXT" [SPEAKER_ID]
       ${0##*/} -h

VOICEVOX engine ($ENGINE_URL) で TEXT を合成 + 発話する。

Arguments:
  TEXT         発話テキスト (1..${MAX_TEXT_LEN} chars)
  SPEAKER_ID   VOICEVOX speaker_id (default: $DEFAULT_SPEAKER)

Exit codes:
  0  OK
  1  ENGINE_UNREACHABLE
  2  ARGS_INVALID
  3  LOCK_TIMEOUT
  4  SYNTHESIS_FAILED
  5  AUDIO_PLAYBACK_FAILED

副作用 (常時、exit code 問わず):
  voice/.state/last-result-YYYY-MM-DD に「OK | FAIL ...」を 1 invoke 1 行で追記
  (日次ファイル、初回作成は 0600 atomic。24h 件数集計の元: bot /status +
   maintenance 12:00 trigger、voice-design.md v2.0 §1.5 (3)(4))
  exit != 0 時 $SOCK へ「[voice] FAIL <reason> (exit N)」送信
  (socket 不在 / 送信失敗は last-result に追記して握りつぶす)
EOF
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
esac

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

TODAY="$(date +%F)"
LAST_RESULT="$STATE_DIR/last-result-$TODAY"

# ISO8601 厳密形式。bot/ 側 voice_status.py が datetime.fromisoformat() で
# 1 行 parse できるように `%:z` (`+09:00`) を使う (B3-1)。
ts() { date '+%Y-%m-%dT%H:%M:%S%:z'; }

append_last_result() {
    local body="$1"
    # O_APPEND 直書き (1 行 ≤ PIPE_BUF なので並行 invoke でも行が混ざらない)。
    # 不在時は umask 077 で 0600 作成、truncate しない。
    ( umask 077; printf '%s\n' "$body" >> "$LAST_RESULT" )
}

notify_socket() {
    local msg="$1"
    if [ ! -S "$SOCK" ]; then
        append_last_result "socket unreachable (no $SOCK) @ $(ts)"
        return
    fi
    if ! printf '%s' "$msg" | nc -U -N "$SOCK" 2>/dev/null; then
        append_last_result "socket send failed @ $(ts)"
    fi
}

fail() {
    local code="$1" reason="$2"
    append_last_result "FAIL $reason (exit $code) @ $(ts)"
    notify_socket "[voice] FAIL $reason (exit $code)"
    exit "$code"
}

if [ "$#" -lt 1 ]; then
    usage >&2
    fail 2 "ARGS_INVALID: TEXT required"
fi

TEXT="$1"
SPEAKER="${2:-$DEFAULT_SPEAKER}"

if [ -z "$TEXT" ]; then
    fail 2 "ARGS_INVALID: empty text"
fi
TEXT_LEN="${#TEXT}"
if [ "$TEXT_LEN" -gt "$MAX_TEXT_LEN" ]; then
    fail 2 "ARGS_INVALID: text too long ($TEXT_LEN > $MAX_TEXT_LEN)"
fi
if ! [[ "$SPEAKER" =~ ^[0-9]+$ ]]; then
    fail 2 "ARGS_INVALID: speaker_id not integer: $SPEAKER"
fi

exec 9>"$LOCK_FILE"
if ! flock -w "$LOCK_TIMEOUT_SEC" 9; then
    fail 3 "LOCK_TIMEOUT: flock -w $LOCK_TIMEOUT_SEC failed on $LOCK_FILE"
fi

TMP_DIR="$(mktemp -d -t voice-say.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

QUERY_JSON="$TMP_DIR/query.json"
SYNTH_WAV="$TMP_DIR/synth.wav"
PADDED_WAV="$TMP_DIR/padded.wav"
CURL_ERR="$TMP_DIR/curl.err"
FFMPEG_ERR="$TMP_DIR/ffmpeg.err"

HTTP_CODE="$(curl -sS \
    -X POST --get \
    --data-urlencode "speaker=$SPEAKER" \
    --data-urlencode "text=$TEXT" \
    -o "$QUERY_JSON" -w '%{http_code}' \
    "$ENGINE_URL/audio_query" 2>"$CURL_ERR")"
CURL_RC=$?
if [ "$CURL_RC" -ne 0 ]; then
    fail 1 "ENGINE_UNREACHABLE: audio_query curl rc=$CURL_RC ($(head -n1 "$CURL_ERR" 2>/dev/null))"
fi
if [ "$HTTP_CODE" != "200" ]; then
    fail 4 "SYNTHESIS_FAILED: audio_query http=$HTTP_CODE"
fi

HTTP_CODE="$(curl -sS \
    -H "Content-Type: application/json" \
    -X POST -d @"$QUERY_JSON" \
    -o "$SYNTH_WAV" -w '%{http_code}' \
    "$ENGINE_URL/synthesis?speaker=$SPEAKER" 2>"$CURL_ERR")"
CURL_RC=$?
if [ "$CURL_RC" -ne 0 ]; then
    fail 1 "ENGINE_UNREACHABLE: synthesis curl rc=$CURL_RC ($(head -n1 "$CURL_ERR" 2>/dev/null))"
fi
if [ "$HTTP_CODE" != "200" ]; then
    fail 4 "SYNTHESIS_FAILED: synthesis http=$HTTP_CODE"
fi

PADDING_SKIPPED=""
if ffmpeg -loglevel error -y -i "$SYNTH_WAV" -af "adelay=1000" "$PADDED_WAV" 2>"$FFMPEG_ERR"; then
    PLAY_WAV="$PADDED_WAV"
else
    PADDING_SKIPPED="$(head -n1 "$FFMPEG_ERR" 2>/dev/null || echo "ffmpeg unknown error")"
    PLAY_WAV="$SYNTH_WAV"
fi

if ! paplay "$PLAY_WAV"; then
    fail 5 "AUDIO_PLAYBACK_FAILED: paplay rc=$?"
fi

append_last_result "OK @ $(ts)"
if [ -n "$PADDING_SKIPPED" ]; then
    append_last_result "padding skipped: $PADDING_SKIPPED"
fi

exit 0
