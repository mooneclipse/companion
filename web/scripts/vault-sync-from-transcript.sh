#!/bin/bash
# Discord bot 経由 claude セッション (bot-workspace CWD) の Stop フック。
# claude が ~/companion/vault/notes/ に書いた未 commit 変更を回収して commit する。
# stdin の JSON (transcript_path 等) は現状参照しない (将来必要になれば追加)。
# commit 成功後は push まで自動実行する (2026-07-10 OWNER 合意、チケット #83、
# monorepo-migration.md §11。design.md §5.2 の人手承認フローを置き換え)。
# push 機構は bot.py cmd_vault_push で実証済みの構成を踏襲:
# BatchMode=yes + GIT_TERMINAL_PROMPT=0 で対話 hang を即 fail、timeout 併設。
# timeout は 50s (60s ではない): Stop hook 自体が claude code デフォルト 60s で
# kill されるため、それより先に自前の error ログパスを必ず通す。
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

# push (チケット #83)。branch は /vault_push (bot.py VAULT_BRANCH) と同じ develop 固定。
# 失敗しても commit はローカルに残り、回復は /vault_push (人手) に委ねる
# (ヘッダの rc != 0 禁止事項どおり、リトライ・分類・自動回復は追加しない)。
export GIT_SSH_COMMAND="ssh -o BatchMode=yes"
export GIT_TERMINAL_PROMPT=0
if timeout 50 git push origin develop >>"$LOG_FILE" 2>&1; then
    log "ok: pushed to origin/develop"
else
    log "error: git push failed (commit remains local; recover via /vault_push)"
    exit 1
fi
