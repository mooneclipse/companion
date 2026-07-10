#!/usr/bin/env bash
# companion-english パイプライン一括実行 (ingest → subs → clips を直列)。
# v0 は手動実行 (設計 §3)。HDD/2 コア機で TV 視聴等と競合させないよう nice 19 + ionice -c3 で回す。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPELINE="${ROOT}/pipeline"
PY="python3"

run_step() {
    echo "=== $1 ==="
    nice -n 19 ionice -c3 "${PY}" "${PIPELINE}/$1" "${@:2}"
}

run_step ingest.py
run_step subs.py
run_step clips.py
