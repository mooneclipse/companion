#!/usr/bin/env bash
# voice/bin/voice-engine-up.sh - VOICEVOX engine (CPU mode) を foreground 実行
# 仕様: voice-design.md v2.0 §1.6 + §1.6.1
# systemd companion-voice-engine.service の ExecStart= から呼ばれる。
# 手動デバッグでもこれ 1 行で engine が立つ (Ctrl-C で停止)。

set -u

VOICE_HOME="${VOICE_HOME:-$HOME/companion/voice}"

if [ -f "$VOICE_HOME/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$VOICE_HOME/.env"
    set +a
fi

ENGINE_DIR="${ENGINE_DIR:-$VOICE_HOME/engine/linux-cpu-x64}"
ENGINE_HOST="${ENGINE_HOST:-127.0.0.1}"
ENGINE_PORT="${ENGINE_PORT:-50021}"
ENGINE_THREADS="${VOICE_ENGINE_THREADS:-2}"

if [ ! -x "$ENGINE_DIR/run" ]; then
    echo "error: VOICEVOX engine binary not found or not executable: $ENGINE_DIR/run" >&2
    echo "see $VOICE_HOME/SETUP.md (公式 7z DL + 展開手順)" >&2
    exit 1
fi

cd "$ENGINE_DIR"
exec ./run \
    --host="$ENGINE_HOST" \
    --port="$ENGINE_PORT" \
    --cpu_num_threads="$ENGINE_THREADS" \
    --output_log_utf8
