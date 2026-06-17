#!/usr/bin/env bash
# companion vault/logs 読み取りガード (PreToolUse hook)
#
# 目的: 手元 claude code セッション (CWD = ~/companion/workspace) が
#       ~/companion/vault と ~/companion/logs の "中身" をコンテキストに
#       読み込むのを抑止する (指示が歪む現象の対策)。
#   - 読み取り (Read / Grep / Glob / Bash の cat,grep 等) を検出したら ask に落とす
#       = ユーザー承認が要る → 勝手読みは止まり、検索指示時は承認で読める
#   - 書き込み (Write は別 allow / Bash の cp,redirect,node 等) は妨げない
#       = playtester・probe の logs 出力を壊さない
#   - 判断目的で読むときは foreground サブエージェント経由 (中身はサブに隔離)
#
# 設計根拠: ~/companion/workspace/docs/ および本リポジトリの設計議論。
#   permission の Bash パス deny は引数順序等で抜けるため (公式が "fragile" と明記)、
#   hook でパスを正規化判定する方式を採用 (公式が deny の代替として推奨)。
#   sandbox は network/write/コマンド互換の副作用が甚大なため不採用。

input=$(cat)

# JSON 検証 — 壊れていたら fail-closed (ask) で安全側に倒す
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"guard-companion-read: 入力 JSON の解析に失敗 (fail-closed で ask)"}}\n'
  exit 0
fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')

# 対象パス: companion 配下の vault / logs
#   絶対 (/home/miho/companion/…), チルダ (~/companion/…), 相対 (companion/… , ../…)
#   末尾は区切り文字で確定し vaultage 等の誤検出を防ぐ
PATHRE='(/home/miho/companion/|~/companion/|companion/|\.\./)(vault|logs)(/|$|[^A-Za-z0-9_])'

ask() {
  # permissionDecisionReason は JSON 文字列なのでダブルクオート等を避けた素の文言にする
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

case "$tool" in
  Read)
    target=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    if printf '%s' "$target" | grep -Eq "$PATHRE"; then
      ask "guard: vault/logs の読み取り (Read) は承認が必要。判断目的なら foreground サブエージェント経由で読むこと。"
    fi
    ;;
  Grep)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.glob // "")')
    if printf '%s' "$target" | grep -Eq "$PATHRE"; then
      ask "guard: vault/logs への Grep は承認が必要。判断目的なら foreground サブエージェント経由で。"
    fi
    ;;
  Glob)
    target=$(printf '%s' "$input" | jq -r '(.tool_input.path // "") + " " + (.tool_input.pattern // "")')
    if printf '%s' "$target" | grep -Eq "$PATHRE"; then
      ask "guard: vault/logs への Glob は承認が必要。判断目的なら foreground サブエージェント経由で。"
    fi
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    # vault/logs パスを含み、かつ "中身を stdout/pipe に出す" 読み取りコマンドのときだけ ask。
    # cp / mv / tee / リダイレクト / node / bash script.sh 等の書き込み系は素通り。
    if printf '%s' "$cmd" | grep -Eq "$PATHRE"; then
      READRE='(^|[|;&]|[[:space:]])(cat|tac|nl|head|tail|less|more|grep|egrep|fgrep|rg|ag|ack|awk|gawk|mawk|sed|cut|od|xxd|hexdump|strings|jq|yq|sort|uniq|comm|diff|colordiff|wc|fold|column|paste|join|bat|batcat|view|tr|rev|expand|fmt|look|pr|shuf|base64|base32)([[:space:]]|$)'
      if printf '%s' "$cmd" | grep -Eq "$READRE"; then
        ask "guard: vault/logs を読むコマンドは承認が必要。判断目的なら foreground サブエージェント経由で。"
      fi
    fi
    ;;
esac

# 該当なし — decision を返さず通常の permission フローへ委譲
exit 0
