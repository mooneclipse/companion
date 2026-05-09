# companion-bot 開発台帳

最終更新: 2026-05-09 19:10

## 設計メモ

- Discord ↔ `claude -p` 土管 bot
- DM またはサーバー内ユーザーメンションをトリガに `claude -p` を呼び、出力をチャンネル/DM へ返す
- OWNER_ID 以外の発言は完全に無視
- 主要パス:
  - `bot.py` … 本体（1ファイル構成、`CompanionClient` で Unix socket listener を兼務）
  - `companion-bot.service` … systemd user unit（`~/.config/systemd/user/` から symlink で配置 + `enable --now` 済み）
  - `.env` … トークン・OWNER_ID・CLAUDE_BIN・CLAUDE_CWD・CLAUDE_TIMEOUT（chmod 600）
  - `requirements.txt` … `discord.py>=2.3,<2.4`, `python-dotenv>=1.0,<2.0`
  - `venv/` … Python 3.10 で再構築済み
- 通知投入口: `$XDG_RUNTIME_DIR/companion-bot.sock`（permission 0600）。1 接続 1 メッセージ（UTF-8、EOF で確定）、本文は `.env` の `NOTIFY_CHANNEL_ID` で指定した Discord テキストチャンネルへ転送。例: `printf '%s' "..." | nc -U $XDG_RUNTIME_DIR/companion-bot.sock`
- 実行 CWD: `claude -p` は `~/companion/workspace` を CWD として起動
- ログ: `~/companion/logs/bot.log` (RotatingFileHandler, 5MB×3)
- `claude` CLI のパスは `.env` の `CLAUDE_BIN` と service ユニットの `Environment=PATH=...` の両方に nvm バージョン依存パスを書いている。Node 更新時は両方追従要
- git: ローカル `~/companion/bot/.git`、リモート `git@github.com:mooneclipse/companion-bot.git`（プライベート）
- pre-commit hook: `.git/hooks/pre-commit` で `~/bin/gitleaks git --pre-commit --staged --redact` を実行。秘密情報を含む commit は exit 1 で拒否される

## TODO

（なし）

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-05-09 `claude -p` 呼び出しに `--continue` を導入し多ターン会話を可能化
  - Phase 3-1 を Discord 経由で動かしたとき、bot が会話を保持せず Phase 3-1 の確認ラリー（重複チェック / 書き込み判断）が破綻する問題が顕在化（claude が「許可します」を受け取っても直前文脈なしで「何の許可？」と返した）
  - `run_claude` を `_exec_claude` ヘルパーに分割、`--continue` で直近セッション継続を試行 → stderr に `no conversation` / `no previous` / `no session` のいずれかが含まれて rc != 0 のときだけ通常起動でフォールバック（`_is_no_prior_session`）
  - フォールバック条件を狭めた根拠: rc != 0 全件で再試行すると Web 検索拒否・タイムアウト・認証エラー等「ユーザーへ素直に返すべき失敗」も問答無用で 2 回目が走り、最悪 `CLAUDE_TIMEOUT × 2 = 600s` の待ちを食らう。`--continue` 由来の「直近セッション無し」と判別できる stderr 文言にだけ反応する形に倒した
  - 既知の制約: bot CWD = `~/companion/workspace` で `--continue` するため、手元 claude code セッションの jsonl が「直近」として拾われ得る。短い対話なら影響限定的、運用で気になったら bot 専用 CWD or session-id 管理（A2 案）への切り替えを検討
  - 実機 stderr 文言は未確認（実弾テストでパターン未マッチなら fallback されず `[claude exited rc]` が Discord に返る形になる、その時点で文言を観察して `_is_no_prior_session` の語彙を追加する運用）
  - workspace 側 `.claude/settings.json` の `permissions.allow` に `WebSearch` と `WebFetch` を追加（Phase 3-1 の Web 検索フローで「権限が必要」で詰まる問題の解消）。WebFetch は OWNER_ID 限定運用前提で全 URL 許可（domain 制限なし）。Phase 4 でスケジューラ等が prompt を組み立てるようになったら `WebFetch(domain:*)` の allowlist or `ask` への降格を再判定
  - code-reviewer: 修正必須 1 件（`rc != 0` 全件で fallback は危険、stderr 判定に絞れ）反映、軽微 2 件（WebFetch ドメイン制限 / `--continue` 側のみ短縮タイムアウト）はユーザー判断で現状維持

- 2026-05-07 起動時に通知チャンネルを verify するヘルスチェックを追加
  - `on_ready` で `get_channel(NOTIFY_CHANNEL_ID)` → ヒット外しなら `fetch_channel`、`isinstance(ch, discord.TextChannel)` で型確認、失敗時は ERROR ログを出して return（bot は止めず mention/DM 応答は維持）。成功時は `notify channel verified: #<name> (<id>)` の INFO ログ
  - 目的: チャンネル削除・権限変更・ID 設定ミス等で socket 通知が無音消失するのを早期検出する。`_handle_notify` 経路だけだと except に落ちるだけで Discord 側に何も出ず気づきにくいため、起動時にプロアクティブに検出する
  - 実弾テスト OK: 再起動後の bot.log に `notify channel verified: #通知 (1501135177223508081)` を確認、`logged in as` 直後 1ms（キャッシュヒットで fetch せず）
  - code-reviewer 再レビュー: 修正必須なし、軽微提案 2 件（① `TextChannel` 限定 → `Messageable` / `(TextChannel, Thread)` 拡張、② `_handle_notify` との resolve 処理共通化）はユーザー合意で未反映。① は単一テキストチャンネル運用前提に整合、② は 3 箇所目が出るまで保留
- 2026-05-07 socket 通知の宛先を OWNER DM → サーバーテキストチャンネルへ切り替え
  - `.env` に `NOTIFY_CHANNEL_ID` を追加（必須・isdigit バリデーション、`OWNER_ID` と同パターン）。`.env.example` / `README.md` セットアップ節にも追記
  - `bot.py` の `_handle_notify` で `client.get_channel(NOTIFY_CHANNEL_ID)`（キャッシュヒット）→ ヒット外しなら `fetch_channel` で取得、`await channel.send(piece)` で送信。OWNER DM への送信コードは削除（PROJECT.md / maintenance/STATUS.md の「切り替え」記述に整合）
  - 実弾テスト OK: bot 再起動後 `printf '...' | nc -U -N $XDG_RUNTIME_DIR/companion-bot.sock` で bot.log に `notify forwarded len=32`、対象チャンネルへ書き込み確認
  - code-reviewer: 修正必須なし、軽微提案 1 件（起動時に TextChannel か verify するヘルスチェック）は reference 実装の OWNER 取得と同程度のガード水準に揃えるため未反映、もう 1 件（`.env.example` 追記）は反映済み
- 2026-05-06 venv 再構築（Mint アップグレードで Python 3.8→3.10 になり ABI 不一致で壊れていた）
- 2026-05-06 `.env` の `DISCORD_TOKEN` 修正（Application ID 等が貼られていて 401 Unauthorized だった）
- 2026-05-06 診断ログ追加（`on_ready` の guilds 一覧 / `on_message` 冒頭の raw recv）— mention 不通の原因切り分け用
- 2026-05-06 動作確認: DM・サーバー内ユーザーメンション双方で `claude -p` 応答を確認
- 2026-05-06 退避フォルダ削除（`venv.broken-py38/`, `venv.halfbuilt/`）
- 2026-05-06 workspace 側 `CLAUDE.md` の `bot/` 説明を実態に更新（土管 bot として記述、`docs/STATUS.md` を参照先として明記）
- 2026-05-06 診断ログ削除（`on_ready` を 1 行版に戻す / `on_message` 冒頭の `raw recv` ログ削除 / 認可後の `recv from=...` ログも削除＝対の診断ログかつ `prompt[:40]` の漏出回避）。レビュー OK
- 2026-05-06 systemd 常駐化（`~/.config/systemd/user/companion-bot.service` を `~/companion/bot/companion-bot.service` への symlink で配置、`systemctl --user enable --now` で起動。Active running / `logged in as renbot#8921` 確認済み）
- 2026-05-06 linger は不要と判断（PC つけっぱなし + 自動ログイン有効のため、再起動後も user systemd が立ち上がり bot も復帰する）
- 2026-05-06 git 化完了。GitHub プライベート repo (`mooneclipse/companion-bot`) に push。pre-commit hook で gitleaks v8.30.1 による秘密情報チェックを自動化（`~/bin/gitleaks` 配置）。実弾テスト（`git add -f .env` で hook が exit 1 で commit 拒否）確認済み
- 2026-05-06 Unix socket listener 追加（`CompanionClient.setup_hook` で `$XDG_RUNTIME_DIR/companion-bot.sock` を 0600 で listen、EOF まで読んだ本文を OWNER の DM に転送、`close()` で sock を unlink、起動時に既存 sock を unlink）。実弾テスト: `printf ... | nc -U -N` で `notify forwarded len=65` ログ + DM 受信を確認。Phase 2 から `nc -U`/`socat` で書くだけで Discord に通知できる入口として運用開始。code-reviewer: 修正必須なし、軽微な提案（STATUS.md 主要パス欄に sock を追記）反映済み

## 既知の問題

（なし）

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮）
  - セキュリティ（入力検証、秘密情報の扱い、権限境界）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `bot/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
