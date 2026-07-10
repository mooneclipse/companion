#!/usr/bin/env bash
# voice/bin/voice-engine-ready.sh - VOICEVOX engine 起動完了を polling
# 仕様: voice-design.md v2.0 §1.6 (「/version 200 polling 30s benign give-up」)
# benign give-up: timeout でも exit 0、stdout に ready/timeout を出力
# 用途: 手動デバッグ (engine 起動直後の ready 確認)、将来 bot/他経路の共通部品

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
URL="http://${ENGINE_HOST}:${ENGINE_PORT}/version"

TIMEOUT_SEC="${VOICE_READY_TIMEOUT_SEC:-30}"
INTERVAL_SEC="${VOICE_READY_INTERVAL_SEC:-1}"

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sSf -m 2 "$URL" >/dev/null 2>&1; then
        echo "ready"
        exit 0
    fi
    sleep "$INTERVAL_SEC"
done

echo "timeout (${TIMEOUT_SEC}s)"
exit 0
