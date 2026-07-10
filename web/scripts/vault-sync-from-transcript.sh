#!/bin/bash
# Discord bot 経由 claude セッション (bot-workspace CWD) の Stop フック。
# claude が ~/companion/vault/notes/ に書いた未 commit 変更を回収して commit する。
# stdin の JSON (transcript_path 等) は現状参照しない (将来必要になれば追加)。
# push は permissions.ask の人手承認フローに任せる (design.md §5.2)。
#
# rc != 0 後処理の禁止事項 (2026-05-20 軸 5 集約 M-12、devil M-6 採用、CLAUDE.md §10.2 + design.md §1.4 と整合):
#   - rc != 0 時のリトライ・auto reset・pull --rebase --autostash 等の自動回復追加禁止
#   - stderr マッチ系の TODO コメントすら残さない (Python 側より気付きにくい bash 経由で踏むリスク)
#   - rc != 0 時は Discord 通知 + 手動介入のみ (notify socket + log 残置で運用ルール完結)
#   - vault push reject 観察ルール (bot/docs/STATUS.md): 2 件目から設計仕切り直しサイン扱い、本 script の自動回復追加で隠さない

set -euo pipefail

VAULT_DIR="${HOME}/companion/vault"
LOG_FILE="${HOME}/companion/logs/vault-sync.log"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/companion-vault-sync.lock"

# Stop フック入力 (stdin JSON) を読み捨て。jq に依存しない設計。
cat >/dev/null 2>&1 || true

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    printf '[%s] %s\n' "$(date -Iseconds)" "$*" >>"$LOG_FILE"
}

# 並走するセッションの Stop フックと vault index を奪い合わないよう非ブロッキング flock。
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "skip: another vault-sync is running"
    exit 0
fi

if [ ! -d "$VAULT_DIR/.git" ]; then
    log "error: $VAULT_DIR is not a git repo"
    exit 1
fi

cd "$VAULT_DIR"

if [ -z "$(git status --porcelain -- notes/)" ]; then
    exit 0
fi

git add -- notes/

staged=$(git diff --cached --name-only -- notes/)
if [ -z "$staged" ]; then
    exit 0
fi

count=$(printf '%s\n' "$staged" | wc -l)
today=$(date +%Y-%m-%d)
msg="add: notes ${today} (bot session auto-sync, ${count} file(s))"

if git commit -m "$msg" >>"$LOG_FILE" 2>&1; then
    log "ok: committed $count file(s) under notes/"
else
    log "error: git commit failed"
    exit 1
fi
