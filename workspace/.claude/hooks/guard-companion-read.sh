#!/usr/bin/env bash
# companion vault/logs 読み取りガード (PreToolUse hook)
#
# 目的: 手元 claude code セッション (CWD = ~/companion/workspace) が persona/会話
#       プローズをコンテキストに読み込み、指示・口調が歪むのを抑止する。
#
#   ゲート対象 (読み取り時 ask):
#     - ~/companion/vault 全体 (手書きノート / aidiary / clips / persona 系)
#     - ~/companion/logs のうち "機械出力 allowlist 以外すべて" (fail-safe)
#         persona プローズを含むログ (bot.log 会話 / maintenance/proactive-companion.log
#         先回り発話 / notify-claude-status.log 等) と、将来 logs に増える未知ログは
#         既定でゲートに落ちる。filename を列挙して塞ぐ (fail-open) のではなく、
#         未知は既定ゲート (fail-safe) にして漏れの方向に倒れないようにする。
#   素通り (allow):
#     - logs の機械出力 allowlist (probe lid_* / playtester mr_* / *.png /
#         *-verify-server.log / vault-sync.log / maintenance の machine-audit-* /
#         notify-system-report.log / notify-unattended-upgrades.log /
#         trends-weekly.log / usb-backup-*)
#     - 書き込み (Write は別 allow / Bash の cp,redirect,node 等) は妨げない
#   判断目的で読むときは foreground サブエージェント経由 (中身はサブに隔離、結論だけ受領)。
#
# 設計根拠: ~/companion/workspace/CLAUDE.md (vault/logs 読み取りガード節)。
#   permission の Bash パス deny は引数順序等で抜けるため (公式が "fragile" と明記)、
#   hook でパスを正規化判定する方式を採用。
#   logs を一律ゲートから fail-safe allowlist に絞ったのは 2026-06-22:
#   機械出力ログ (mr_* 等) の承認摩擦を消しつつ、persona ログの漏れを既定で塞ぐため。
#   既知の残り穴: 1 つの Bash 読みコマンドが機械出力ログと persona ログを同時に参照した
#   場合のみ allowlist 側にマッチして素通りしうる (自己セッションでの意図的構成のみ、実用上ゼロ)。

input=$(cat)

# JSON 検証 — 壊れていたら fail-closed (ask) で安全側に倒す
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"guard-companion-read: 入力 JSON の解析に失敗 (fail-closed で ask)"}}\n'
  exit 0
fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')

# パス接頭辞: 絶対 (/home/miho/companion/…), チルダ (~/companion/…), 相対 (companion/… , ../…)
prefix='(/home/miho/companion/|~/companion/|companion/|\.\./)'
# vault は全体をゲート。末尾を区切り文字で確定し vaultage 等の誤検出を防ぐ
VAULTRE="${prefix}"'vault(/|$|[^A-Za-z0-9_])'
# logs を参照すれば候補 (VAULTRE と対称な境界。bare dir 指定の Grep 等も拾う)。
# allowlist にマッチしないものはゲート (fail-safe)
LOGSRE="${prefix}"'logs(/|$|[^A-Za-z0-9_])'
# logs 機械出力 allowlist (logs/ 直下または maintenance/ 直下の許可 basename + 区切り)。
#   末尾境界は / を除外する: basename 後の / は "サブディレクトリ継続" なので区切りと見なさず、
#   logs/mr_foo/persona.log のようなプレフィックス偽装を allowlist 不成立=ゲートに倒す。
#   空白・パイプ・EOL は区切りとして許すので Bash のパイプ (cat …mr_x | head) は素通りのまま。
LOGS_ALLOW="${prefix}"'logs/(maintenance/)?(mr_[A-Za-z0-9_.-]*|lid_[A-Za-z0-9_.-]*|[A-Za-z0-9_.-]*\.png|[A-Za-z0-9_.-]*-verify-server\.log|vault-sync\.log|machine-audit-[A-Za-z0-9_.-]*|notify-system-report\.log|notify-unattended-upgrades\.log|trends-weekly\.log|usb-backup-[A-Za-z0-9_.-]*)($|[^A-Za-z0-9_./-])'

ask() {
  # permissionDecisionReason は JSON 文字列なのでダブルクオート等を避けた素の文言にする
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# 対象文字列 (単一パス or Bash コマンド) がゲート対象なら "ask" を、そうでなければ空を返す。
#   - vault を参照 → 常にゲート
#   - logs を参照 → 機械出力 allowlist にマッチすれば素通り、しなければゲート (fail-safe)
gated() {
  local t="$1"
  if printf '%s' "$t" | grep -Eq "$VAULTRE"; then echo ask; return; fi
  if printf '%s' "$t" | grep -Eq "$LOGSRE"; then
    printf '%s' "$t" | grep -Eq "$LOGS_ALLOW" && return
    echo ask
  fi
}

case "$tool" in
  Read)
    target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    [ "$(gated "$target")" = ask ] && ask "guard: vault または logs の persona/未分類ログの読み取り (Read) は承認が必要。機械出力ログ (mr_*/lid_*/*.png 等) は素通り。判断目的なら foreground サブエージェント経由で。"
    ;;
  Grep)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.glob // "")')
    [ "$(gated "$target")" = ask ] && ask "guard: vault または logs の persona/未分類ログへの Grep は承認が必要。判断目的なら foreground サブエージェント経由で。"
    ;;
  Glob)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.pattern // "")')
    [ "$(gated "$target")" = ask ] && ask "guard: vault または logs の persona/未分類ログへの Glob は承認が必要。判断目的なら foreground サブエージェント経由で。"
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    # "中身を stdout/pipe に出す" 読み取りコマンドのときだけ判定。
    # cp / mv / tee / リダイレクト / node / bash script.sh 等の書き込み系は素通り。
    READRE='(^|[|;&]|[[:space:]])(cat|tac|nl|head|tail|less|more|grep|egrep|fgrep|rg|ag|ack|awk|gawk|mawk|sed|cut|od|xxd|hexdump|strings|jq|yq|sort|uniq|comm|diff|colordiff|wc|fold|column|paste|join|bat|batcat|view|tr|rev|expand|fmt|look|pr|shuf|base64|base32)([[:space:]]|$)'
    if printf '%s' "$cmd" | grep -Eq "$READRE"; then
      [ "$(gated "$cmd")" = ask ] && ask "guard: vault または logs の persona/未分類ログを読むコマンドは承認が必要。機械出力ログは素通り。判断目的なら foreground サブエージェント経由で。"
    fi
    ;;
esac

# 該当なし — decision を返さず通常の permission フローへ委譲
exit 0
