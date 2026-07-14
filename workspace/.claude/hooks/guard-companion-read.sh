#!/usr/bin/env bash
# companion vault 読み取りガード (PreToolUse hook)
#
# 目的: 手元 claude code セッション (CWD = ~/companion/workspace) が手書きノート /
#       日記 (aidiary) / persona プローズを承認なしにコンテキストへ読み込まないようにする。
#
#   ゲート対象 (読み取り時 ask):
#     - ~/companion/vault 全体 (手書きノート / aidiary / clips / persona 系)
#   素通り (allow):
#     - 書き込み (Write は別 allow / Bash の cp,redirect,node 等) は妨げない
#   判断目的で読むときは foreground サブエージェント経由 (中身はサブに隔離、結論だけ受領)。
#
# 設計根拠: ~/companion/workspace/CLAUDE.md (vault 読み取りガード節)。
#   permission の Bash パス deny は引数順序等で抜けるため (公式が "fragile" と明記)、
#   hook でパスを正規化判定する方式を採用。
#   logs のゲート (fail-safe allowlist、2026-06-22) は 2026-07-14 チケット #107 で撤去:
#   導入動機だった「指示・口調の歪み」観測 (2026-06-17) は Opus 4.8 劣化期間 (6/5-18、
#   status page / GitHub issues 多数) と交絡していた可能性が高いと再評価。健全なモデル
#   運用 (Fable / Opus 4.6) では bot.log 等のデバッグ読みの承認摩擦が上回るため。
#   vault は「私的ノートの勝手読み抑止」という別目的が立つので維持。

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

ask() {
  # permissionDecisionReason は JSON 文字列なのでダブルクオート等を避けた素の文言にする
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# 対象文字列 (単一パス or Bash コマンド) が vault を参照していれば "ask" を、そうでなければ空を返す。
gated() {
  local t="$1"
  if printf '%s' "$t" | grep -Eq "$VAULTRE"; then echo ask; fi
}

case "$tool" in
  Read)
    target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    [ "$(gated "$target")" = ask ] && ask "guard: vault (手書きノート/日記/persona) の読み取り (Read) は承認が必要。判断目的なら foreground サブエージェント経由で。"
    ;;
  Grep)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.glob // "")')
    [ "$(gated "$target")" = ask ] && ask "guard: vault (手書きノート/日記/persona) への Grep は承認が必要。判断目的なら foreground サブエージェント経由で。"
    ;;
  Glob)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.pattern // "")')
    [ "$(gated "$target")" = ask ] && ask "guard: vault (手書きノート/日記/persona) への Glob は承認が必要。判断目的なら foreground サブエージェント経由で。"
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    # "中身を stdout/pipe に出す" 読み取りコマンドのときだけ判定。
    # cp / mv / tee / リダイレクト / node / bash script.sh 等の書き込み系は素通り。
    READRE='(^|[|;&]|[[:space:]])(cat|tac|nl|head|tail|less|more|grep|egrep|fgrep|rg|ag|ack|awk|gawk|mawk|sed|cut|od|xxd|hexdump|strings|jq|yq|sort|uniq|comm|diff|colordiff|wc|fold|column|paste|join|bat|batcat|view|tr|rev|expand|fmt|look|pr|shuf|base64|base32)([[:space:]]|$)'
    if printf '%s' "$cmd" | grep -Eq "$READRE"; then
      [ "$(gated "$cmd")" = ask ] && ask "guard: vault (手書きノート/日記/persona) を読むコマンドは承認が必要。判断目的なら foreground サブエージェント経由で。"
    fi
    ;;
esac

# 該当なし — decision を返さず通常の permission フローへ委譲
exit 0
