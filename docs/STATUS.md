# companion-maintenance 開発台帳

最終更新: 2026-05-06 13:20

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

- (後で) Obsidian vault をメイン機からこの機に同期
- (後で) 通知先を OWNER DM → サーバー通知チャンネルに切り替え

## In progress

（なし）

## Review pending

（なし）

## Done

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
