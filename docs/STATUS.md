# companion-maintenance 開発台帳

最終更新: 2026-06-04 12:40

## 設計メモ

- Linux 機自身の OS / リソース面倒を相棒経由で見るための保守スクリプト群
- 定期実行は **systemd user timer**（bot と同じ user セッション文脈で動かし、`$XDG_RUNTIME_DIR/companion-bot.sock` に直接書き込む）
- 通知経路: bot 側の Unix socket listener (`$XDG_RUNTIME_DIR/companion-bot.sock`) に nc / socat で本文を流し込む。bot 本体の責務は土管に閉じる
- timer の発火時刻は OS 側 `apt-daily-upgrade.timer`（朝 6 時前後）の **2〜3 時間後** に揃える方針（unattended-upgrades 完了後のログを安定して拾うため）
- 主要パス:
  - `~/companion/maintenance/scripts/` … 実体スクリプト
  - `~/companion/maintenance/systemd/` … user timer/service 設定（`~/.config/systemd/user/` から symlink で配置）
  - `~/companion/maintenance/.state/` … 二重通知抑止用の state ファイル（git 管理外）
  - ログ: `~/companion/logs/maintenance/` 配下にタスク別 log

## TODO

（なし）

※ Obsidian vault 同期は **PROJECT.md Phase 3 に移管**（Web 検索 → md 蓄積と接続するため）。本 repo の管轄になるかは Phase 3 着手時に判断。

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-06-04 AI トレンド週次収集レポート基盤
  - 週 1 回 systemd user timer で起動 → RSS から AI 関連記事を収集 → 重複排除 → `claude -p` で要約 → Obsidian vault に Markdown ノート 1 枚を書く。放置運用前提 (冪等・部分失敗許容・budget bound)。
  - 構成:
    - `config/trends-sources.yaml` … 手編集する収集ソース設定 (keywords / lookback_days=8 / feeds)。シード feed = Zenn AI・Zenn LLM・Qiita 生成AI (filter:false)。企業ブログは 2026-06-04 に `curl -w "%{http_code}"` で 200 確認したもの (OpenAI News `/news/rss.xml`・Google DeepMind・Hugging Face Blog) のみ採用。Anthropic は公開 RSS 未提供 (404) のためコメントで明示、旧 OpenAI Blog `/blog/rss.xml` は 307 でコメント残置。将来 SQLite 等への差し替え点 (`lib/trends_fetch.py` の `load_config`) を冒頭コメントに明記
    - `lib/trends_fetch.py` … RSS2.0 (channel/item) + Atom (feed/entry) を Python stdlib のみ (+pyyaml) でパース (feedparser 不使用)。UA=Mozilla/5.0・timeout 15s。feed 単位 try/except で部分失敗許容 (失敗ソース名を `failed_sources` に載せる)、HTML タグ除去 + 300 字切り詰め、lookback_days 日付フィルタ (パース不能は採用)、filter:true は keyword 一致のみ採用、seen-urls.json で dedup。**state は読むだけで書き換えない** (冪等性は shell が成功後に更新)。Qiita のような非 ASCII パス URL は path/query を percent-encode して取得
    - `.claude/skills/trends-report/SKILL.md` … `new-items.json` を Read → テーマ別クラスタリングで日本語要約 → `report.md` を Write する skill。featured 最大 12〜15 件 + 残りは「他 N 件」、frontmatter `tags:[ai-trends]`/`week`/`created`、`## 今週のまとめ` (俯瞰) + `## 主なトピック` (テーマ別)。Web 取得・長時間処理なし
    - `scripts/trends-weekly.sh` … オーケストレーション (set -euo pipefail)。CLAUDE_BIN 解決 (node バージョン非ハードコード)、ISO 週ラベル `date +%G-W%V`、対象 vault ノート既存なら no-op の冪等ゲート、0 件時は claude を呼ばず shell が最小ノートを直接書く (budget 節約)、1 件以上は `timeout 600 claude -p "/trends-report ..." --output-format json --permission-mode acceptEdits --allowedTools "Read Write Edit" --max-budget-usd 1.0`。rc 判定は 1 回で確定 (失敗時 state 未更新で exit 1 = 冪等、CLAUDE.md 2 周目ルール準拠で stderr 文言マッチ/場当たりリトライをしない)。vault 配置は shell が一元管理 (claude に vault 権限を渡さない = 書き込み境界遵守)。state 更新は成功後のみ + 26 週より古いエントリを prune (一時ファイル + mv で原子的)。Discord 通知は socket 在席時のみ best-effort (不在/送信失敗でも本体は成功扱い)
    - `systemd/companion-trends.service` (oneshot, `After=companion-bot.service`、Wants/Requires なし) + `.timer` (`OnCalendar=Sat 08:00:00`, `Persistent=true`, `RandomizedDelaySec=15min`)
  - 実弾テスト OK: `python3 lib/trends_fetch.py` で実 RSS から total_new=66・failed_sources 空を確認 (Zenn AI 20 / Zenn LLM 15 / Qiita 4 / OpenAI 20 / HF 7。DeepMind は直近 8 日に新着なしで 0)。dedup は seen 投入で 66→36 に減ることを確認。`bash -n` 構文 OK (shellcheck 未インストール)。実機 dry-run でフル経路成功 (fetch → claude -p → vault に `2026-W23 AIトレンド.md` 生成 → state 66 件記録 → 通知送信)。生成ノートは 4 クラスタ + featured 14 件 + 「他 52 件」で書式どおり。再実行は冪等ゲートで no-op (claude 非再呼出)。0 件分岐の最小ノート生成と failed_sources 注記、26 週 prune を単体検証で確認。claude -p 1 回のコストは実測 $0.40 (Opus)、`--max-budget-usd 1.0` で bound
  - **2026-06-15 以降は Max 5x プランの claude -p 月次 $100 クレジット枠 (bot と共有プール) を消費する**。週 1・要約 1 回・budget bound 済みで影響軽微
  - **timer 有効化はユーザー最終承認**。`~/.config/systemd/user/` から symlink 配置 + enable 手順:
    ```
    ln -s ~/companion/maintenance/systemd/companion-trends.service ~/.config/systemd/user/
    ln -s ~/companion/maintenance/systemd/companion-trends.timer   ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now companion-trends.timer
    systemctl --user list-timers companion-trends.timer   # 次回発火確認
    ```
- 2026-05-08 `lib/notify.sh` 共通化
  - `lib/notify.sh` を新設し、`log()` / `state_matches` / `notify_send`（socket 存在チェック + `nc -U -N` 送信 + state 更新 + ログ）を抽出。呼び出し側は `STATE_FILE` / `OUR_LOG` を設定して `source "$(dirname "$0")/../lib/notify.sh"` する形式
  - `scripts/notify-unattended-upgrades.sh`（82→61 行）と `scripts/notify-system-report.sh`（62→44 行）を lib 経由に書き換え。タスク固有の本文構築だけが残る形に
  - 実弾テスト OK: skip パス（state あり）と発火パス（state 退避 → system-report 実行で bot.log に `notify forwarded len=117`）両方確認、state 復元後の skip も再確認
  - code-reviewer: 修正必須なし、軽微提案 2 件反映（ライブラリ冒頭で `${STATE_FILE:?...}` / `${OUR_LOG:?...}` ガード、`STATE_DIR` 廃止して `mkdir -p "$(dirname "$STATE_FILE")"` に揃える）。`exit` をライブラリ内で呼ぶ件は YAGNI で据置、systemd の絶対パス前提コメントは実弾テスト済みのため未追加
- 2026-05-07 通知先を OWNER DM → サーバー通知チャンネルへ切り替え（実装は bot 側、`bot/docs/STATUS.md` 2026-05-07 エントリ参照）。maintenance 配下のスクリプト・systemd unit は無変更（socket protocol が変わらないため）。実弾テストで対象チャンネルへの書き込みを確認、bot.log に `notify forwarded len=32`
- 2026-05-06 ディスク・メモリ・CPU 温度の日次レポート
  - `scripts/notify-system-report.sh`: `df -h /`、`free -h`（Mem / Swap）、`sensors`（Package id 0）を集約し、本文を `$XDG_RUNTIME_DIR/companion-bot.sock` に nc -U で流し込む。state ファイル `maintenance/.state/last-notified-system-report` に当日日付を記録し同日 2 回目以降は skip
  - `systemd/companion-notify-system-report.service`（oneshot）+ `.timer`（OnCalendar=*-*-* 12:00:00, RandomizedDelaySec=10min, Persistent=true）。`~/.config/systemd/user/` から symlink で配置、`enable --now` 済み。次回発火: 2026-05-07 12:06:50 JST
  - 実弾テスト OK: 手動 1 回目で bot ログに `notify forwarded len=116`、2 回目で `skip: already notified today (2026-05-06)`。code-reviewer: 修正必須なし、軽微提案 1 件（swap 行欠損時の末尾空行混入）は `free -h` が swap 無効時も `Swap: 0B 0B 0B` を出力するため実機で発生せず、reference 実装と同構造維持のため未反映
- 2026-05-06 git 化完了。GitHub プライベート repo (`mooneclipse/companion-maintenance`) を作成し `main` を push。pre-commit hook (`gitleaks git --pre-commit --staged --redact --no-banner`) を `.git/hooks/` に配置、初回 commit で gitleaks `no leaks found` 確認済み。`.gitignore` で `.env` / `.state/` / `venv/` / `__pycache__/` 等を除外
- 2026-05-06 OS アップデート通知（unattended-upgrades）
  - `scripts/notify-unattended-upgrades.sh`: `/var/log/unattended-upgrades/unattended-upgrades.log` から最新の「自動アップグレードスクリプトを開始します」以降を切り出し、状態（更新対象なし / 更新完了 / エラー / 不明）と再起動要否（`/var/run/reboot-required` 有無 + `.pkgs` 中身）をまとめ、`$XDG_RUNTIME_DIR/companion-bot.sock` に nc -U で流し込む。state ファイル `maintenance/.state/last-notified-unattended-upgrades` で同一実行の二重通知を抑止
  - `systemd/companion-notify-unattended-upgrades.service` (oneshot) + `.timer` (OnCalendar=*-*-* 09:00:00, RandomizedDelaySec=15min, Persistent=true)。`~/.config/systemd/user/` から symlink で配置、`enable --now` 済み。次回発火: 2026-05-07 09:12:50 JST
  - 実弾テスト OK: 手動実行で bot ログに `notify forwarded len=57`、再実行で `skip: already notified`。code-reviewer: 修正必須なし、軽微指摘 4 件（`|| true` 位置 / service の意図コメント / ロケール前提コメント / ERROR 行 1→3 件）すべて反映済み
  - 実弾テストで判明した追加修正: 「状態: 不明」分岐を削除し、結果マーカー（更新対象なし / 更新完了 / ERROR）が揃っていなければ `skip: result not yet logged` で sock 送信も state 更新もしない方針に変更。原因は `apt-daily.timer`（メタデータ取得用、朝以外にも発火）が unattended-upgrades を呼ぶと判定途中でログが「Initial whitelist」止まりのまま結果マーカー未記入となるパターンがあるため。本物の結果は `apt-daily-upgrade.timer`（朝 6 時前後）の実行で記録される

## 既知の問題

（なし）

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮 / 失敗時の挙動）
  - セキュリティ（webhook URL 等の秘密情報の扱い、権限境界、root 権限が必要なものは sudoers の最小化）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合（`bot/` で確立したパターンを踏襲）
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `maintenance/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
- AI トレンド: `config/trends-sources.yaml` に企業ブログ等の feed を追加する際は、`trends_fetch.py` を手動実行して `new-items.json` にその source の `url` が取れているか確認する。`parse_rss` は `<link>` を要素テキストで取るため、Atom の `<link href="...">` 形式や名前空間混在フィードでは link を取りこぼし得る (取れていなければ item が dedup 用 URL 無しで落ちる)
