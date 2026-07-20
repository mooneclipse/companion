#!/usr/bin/env bash
# ytcheck 日次実行ランチャー（systemd user timer / 手動共用）
# レポートと viewing 履歴は Obsidian vault (notes/ytcheck/) に出す
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# claude CLI は nvm 配下で systemd user の PATH に乗らないため、
# trends-weekly.sh と同じ手順で解決して PATH に前置する
# (ai_evaluator.py が shutil.which("claude") で探す)
CLAUDE_BIN="$(command -v claude || true)"
if [[ -z "$CLAUDE_BIN" ]]; then
    CLAUDE_BIN="$(ls "$HOME"/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1 || true)"
fi
if [[ -z "$CLAUDE_BIN" ]]; then
    echo "abort: claude バイナリが見つからない" >&2
    exit 1
fi
export PATH="$(dirname "$CLAUDE_BIN"):$PATH"

export YTCHECK_WRITING_DIR="$HOME/companion/vault/notes/ytcheck"
export YTCHECK_VIEWING_DIR="$HOME/companion/vault/notes/ytcheck"

# 並列数の機差調整 (.env より環境変数が優先される)。
# 移行元 Windows は 5 で問題なかったが、本機 (2 コア 1.8GHz) では並列 5 の
# yt-dlp が相互に遅延して 60 秒タイムアウト多発 + YouTube 側 429 も発生
# (2026-07-07 初回実行: 71 本中 34 本失敗、docs/STATUS.md 参照)
export MAX_CONCURRENT_TASKS=2

# Stop hook ボイスの発生源申告 (チケット #125): バッチ実行は手元で鳴らさない
export COMPANION_VOICE_SOURCE=batch

exec "$ROOT/.venv/bin/python" "$ROOT/python/youtube_checker/main.py" --all --output markdown "$@"
