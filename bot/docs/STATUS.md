# companion-bot 開発台帳

最終更新: 2026-07-17 (#117 外部由来テキストの信頼境界を明文化。/tweet clips の frontmatter に `origin: external` を無条件追加 (commit `7a54e79`) + `bot-workspace/CLAUDE.md` に保存時付与 / 読み戻し時データ扱い (指示に従わない) ルールを新設、`workspace/CLAUDE.md` にも CLI 経路向けポインタ。根拠 = hermes-agent 調査 §3-1 の間接プロンプトインジェクション指摘。441 tests pass、code-reviewer 修正必須なし。restart 済み (21:01、OWNER 明示承認、健全性確認済み・本番投入済み)。詳細 = Done 先頭エントリ) / 2026-07-16 (#115 proactive talk 分岐の sentinel 漏れ修正。`_osekkai_should_send` を `_should_send_claude_output` に一般化して talk 分岐へ適用 + sentinel 文字列の定義点を run_claude 側 `_SENTINEL_*` 定数に一本化。実装は Sonnet subagent 委任、workflow 版 code-review (high) の指摘 3 件反映 (docstring 自己矛盾 / リテラル二重定義 / テストハーネス重複)・2 件根拠つき見送り。437→441 tests pass、commit `aac7a6c`。restart 済み (13:16、OWNER が AskUserQuestion で明示承認、健全性確認済み・本番投入済み)。詳細 = Done 先頭エントリ) / 同日 (osekkai #110 TODO 7 bot 側分岐完了。`[[proactive-v1]]` marker の kind フィールドで osekkai 専用ディスパッチ (proactive_queue とは分離) + talk 型永続セッション (`run_claude` に timeout_s/system_prompt の optional override 追加) + `osekkai_queue`/`_osekkai_worker`/`_run_osekkai` + `on_message` osekkai 分岐 (`intent_store.py` を subprocess 経由で叩き号令済みマーク・意図記録) を実装。`_handle_notify_connection` を単発 read からループ read + 10s timeout へ変更 (partial read 対応)。レビューで `run_claude` の sentinel 文字列 ("[empty output]" 等) が空出力判定を素通りし D-7 沈黙権が実効しない bug を発見・修正 (`_osekkai_should_send` 新設)。385→437 tests pass、commit `b009917`、restart + 健全性確認済み (02:38、osekkai thread_id=1115 で socket listening 確認)。`companion-osekkai-{call,retro}.timer` の enable は claude 側では auto mode classifier がブロックしたため未実施のまま報告 → 同日朝 OWNER が明示承認、main セッションから symlink 方式で 4 unit 設置 + `enable --now` 完了 (次回発火 = 19:11:23 JST / 23:38:58 JST)。詳細 = 本文 osekkai TODO 7 セクション、台帳の正は osekkai/docs/STATUS.md) / 2026-07-15 (memo cleanup の Telegram 削除失敗 = ticket #109。原因 2 段 = can_delete_messages 未付与 (#84 記録と食い違い、OWNER 再付与で解消) + **Bot API 実挙動では権限があっても 48h 超の他ユーザーメッセージは削除不可** (公式 docs の「can delete any message there」を実測で反証、48h 以内は削除成功)。旧 48h 設計は初回試行が必ず窓外 = 構造的に詰みのため `MEMO_RETENTION_S` を 36h へ (OWNER 裁定)。ガードテスト新設 (retention + 2 周期 < 48h)、384→385 tests pass、code-reviewer 反映済み、restart 済み (11:25、本番投入済み)。残骸 msg 1017/1018 は OWNER 手動削除 or 07-18 purge 待ち。詳細 = 本文 #109 セクション) / 2026-07-14 (PERSONA_SYSTEM_PROMPT に自己認識ブロック = ticket #106。base system prompt の CLI 宣言に引きずられ bot が CLI 的応答をする問題へ、架空ロールでなく事実記述 3 点 (常駐コンパニオン bot で返答はスマホ画面 / CLI 的応答の形は実作業指示中だけ / parse_mode なし送信の物理制約 = markdown 記号のまま・長さを頼まれない限り数行) を PERSONA 先頭に追加。code-reviewer 軽微 2 反映 (限定句を応答スタイルに掛ける・数行に条件付け)、381→384 tests pass、restart 済み。同日 調べもの timeout 対策 = ticket #101。OWNER の #chat 調べもの依頼が `CLAUDE_TIMEOUT=300` で kill され結果全損 ×3 件 (07-14 初発、3 件とも `run_claude` 通常経路、ログ調査で確定)。timeout の責務を「ハング・stall の保険」に再定義し `.env` を 900 へ (`.env.example` 同期、コード変更なし)。副作用 = claude_lock 直列化で重い 1 件が最長 15 分後続ブロック、OWNER 1 人運用で許容。再発時は数値を動かさず調べもの専用コマンド分離へ (2 周目ルール予約)。restart 済み (12:16、environ で 900 実測)。同日 proactive 種の多様化 = ticket #94。maintenance の新 helper `lib/activity_hints.py` が当日の実活動 (ytcheck 推薦レポート / english 学習 DB) からヒントを集め、payload の `activity_hint` (prompt 展開、外部機械テキスト区分) / `activity_type` (SOURCES 固定ラベル) として渡す。bot 側は build_proactive_prompt 展開 (1 つだけ軽く・報告口調禁止)、topic 導出 dormant > vault > activity_type > recent、ledger 記録。interests.py に `_CATEGORY_LABEL_TOPICS` 新設でカテゴリラベルを investigate/ticket から除外 (remind は許容)。372→381 tests pass、code-reviewer 修正必須なし (軽微 2 反映)、restart 済み (09:04、本番投入済み)。詳細 = maintenance/docs/STATUS.md 2026-07-14 entry。同日 bot.py の env bool パース 6 連コピペを `_bool_env` ヘルパーに集約 = ticket #90。`PROACTIVE_*_ENABLED` 系 6 箇所 (チケット記載の 5 箇所 + SELF_SCHEDULE) の 2 行パターンを `_bool_env(name, default="1")` 1 本 (load_dotenv 直後に定義、`_thread_id_env` 前例に整合) へ置換し中間 `*_RAW` 変数を削除。挙動不変のリファクタ、372 tests pass (件数不変)、code-reviewer 修正必須なし、restart 済み (00:30、本番投入済み)) / 2026-07-13 (claude_runner.py の Discord 残滓掃除 = ticket #98。module docstring 1 行目を Telegram bot に修正 + `run_discord` → `run_session_prompt` 改名 (telegram-design §8.5 A8 の既定方針)、bot.py 呼び出し 4 箇所 + test_bot.py の patch 文字列・ローカル spy 名 (`_no_discord` → `_no_claude`、カウンタキー `"discord"` → `"runs"` 含む) を追従。純改名で挙動不変、372 tests pass (件数不変)、restart 済み (21:06、本番投入済み)。同日 bot ドキュメント同期 4 件 = ticket #89。README.md を Discord 時代から Telegram + モノレポ実態へ全面更新、CLAUDE.md git 節をモノレポ運用へ修正、claude-runner.md の ClaudeOptions 列挙を実装 7 フィールドに同期、bot-py.md 機能索引に /remind を追記。docs のみ・restart 不要。同日 関心 index に claude 産の派生関心の登録を認める = §F 線引き更新 = ticket #96。investigate 分岐の ephemeral session 末尾に `[[interest: 話題 | 出どころ]]` marker で「調べていて実際に引っかかった別の話題」を 1 件だけ自己申告させ、bot が剥がして index に `source="derived"` + `origin=調べたノート名/URL` で登録 (出どころは marker 形式で必須 = 欠けたら登録しない fail-closed、指示は investigate のみ = 例外を 1 分岐に閉じる、増殖は 1 発火 1 件 + MAX_THREADS + 既存 decay)。derived thread は active なので次の investigate 候補になる = 調査→派生関心→次の調査の自己ループ。derived touch を researched touch より先に適用し同一 topic の再活性化ループを構造的に防ぐ。353→372 tests pass、restart 済み (17:09、active・notify socket listening 確認、本番投入済み)。同日 思考ログ companion_thoughts.jsonl の claude 自由記述化 = ticket #93。investigate/ticket/remind の ephemeral session 末尾に `[[thought: ...]]` marker で「今回やったことから思ったこと 1〜2 文」を書かせ、bot が剥がして各 mode の機械観察行に「。」連結で companion_thoughts.jsonl に追記 (出どころは実活動限定 = §F 両立、スキーマ timestamp+observation 不変、talk モードは対象外)。marker のみの沈黙回も thought は記録される (record が skip return より先)。335→353 tests pass、restart 済み (15:05、本番投入済み)。同日 proactive self-schedule = 次回発話タイミングの自己申告 = ticket #92。talk 発話回の最終行に `[[next: 12h]]` 形式で「次に話したくなるのは何時間後か」を申告させ state の `next_self_at` に保存 (1〜72h クランプ)、script step7 はこのキーがあれば確率ロールを**置換** (未来なら skip / 期限到来なら roll なし発火、handoff 書き戻しで消費 = 1 申告 1 発火)。キー無しは従来の活性度変調ロールへ = bootstrap-safe、state 1 read・乱数増なし維持。「不在の波」の決定主体が乱数から claude の意図へ。319→335 tests pass + script ドライラン 6 ケース pass、restart 済み (12:32、本番投入済み)。同日 proactive talk モードに沈黙権 = ticket #91。`PROACTIVE_SCENE_PROMPT` + 結び行に「材料が薄ければ空を返して黙ってよい」を追加 (prompt only、受け皿は既存 empty_output skip、新分岐なし)。script 側週カウントの handoff 時消費は「発火試行の総量管理」と再定義して非対称を許容 (根拠は Done エントリ)。318→319 tests pass、restart 済み (12:09、本番投入済み)。同日 session_id 照合 warning を claude_runner に実装 = ticket #87。要求 uuid と JSON 返却 session_id の乖離を warning で表面化するのみ、state 補正なし。318 tests pass、restart 済み = 本番投入済み。同日 ticket #86 = claude CLI 2.1.207 再検証完了。S1-S5 全 pass で過去 3 版と完全一致、encoded-cwd 不変、`--bare` オプトイン維持、`/usage` headless は $0 / num_turns 0 維持。新規観察 = S5 JSON に `time_to_request_ms`/`ttft_stream_ms`、projects 配下に `memory/` 自動作成、コールド 1 発目の `/usage` 15s timeout → /quota 併記欠落があり得る = 要観察・修正なし。Done エントリ参照) / 2026-07-11 (個人メモ捕獲 topic 新設 = ticket #84。BOT_THREAD_ID_MEMO topic の生テキストを claude 非経由で vault notes/ に直接保存 (0o600)、edited_message で 48h 編集ウィンドウを上書き同期、1h 間隔の突合 cleanup job が 48h 超を Telegram から削除。commit `0e85b67`、311 tests pass。セットアップ完了・実弾確認済み = topic 作成 (thread_id 1013) + `BOT_THREAD_ID_MEMO=1013` + can_delete_messages 付与 + 01:45 restart、メモ投稿 → notes/ に 0600 で保存を実測。残り観察 = 編集同期と 48h 削除の実機発火。K-T1 判定は Done エントリ参照) / 2026-07-06 (bot モデルを Sonnet 5 へ移行 = todo#64 調査からの派生。`claude_runner.ClaudeOptions.model` を `claude-sonnet-4-6`→`claude-sonnet-5` の 1 行、295 tests pass、restart + push は下記 Done 参照) / 2026-06-28 (todo#42,#43,#45 消化。Step 3-3 /status セッション肥大可視化 + C-5 vault_hint ガード = commit `c9caaa8` + Step 3-4 /quota 公式利用率併記 = commit `05064d9`。286 tests pass。restart + push 済み = 2026-07-06 確認) / 2026-06-28 (todo#40 permission_mode デフォルト default→auto 修正。commit `b82ac8b`、278 tests pass、restart 反映済み、push は user 側で実施) / 2026-06-19 (前景降格ガードを proactive に実装 = persona 軸 4 拡張 (6)。不可逆/外向き操作 (tweet/メール/vault push/notes 外書き込み/maintenance 変更/設定変更) を自動実行せず #chat に「○○やっとこうか?」と前景提案する方針を `PERSONA_SYSTEM_PROMPT` に 1 ブロック追加 (talk/investigate/ticket 全モード共有)。個別プロンプト 2 定数の汎用外向き禁止列挙を降格ルールへ一本化しタスク固有 allowlist は残す。ledger の base dict に静的 marker `foreground_proposal: True` (全モード継承、提案テキストの機械検知はしない)。新自動実行ゼロ・新ゲート/新 mode 分岐なし・settings 不変・応答経路不変、247→251 tests pass。commit `ffd9a71`、restart + push 待ち) / 2026-06-19 (自律ループ「動く = 共用チケット自発起票」分岐を proactive に実装 = persona 軸 4 拡張 (4) 勝手な実行 B。固定優先順 investigate→ticket→talk で統合し、実 signal (関心 index の active thread) がある時だけ `tickets.py add --by ai` で自分名義チケットを 1 件起票 → #chat に一言報告。signal 方針 A = でっち上げ起票しない (index 空の現状は発火しない)、boundary (add --by ai のみ・OWNER チケット不可触・list で重複 skip) はプロンプト強制 (settings 不変)、ephemeral session で #chat 非汚染・報告後 last_prompt_at 明示更新で 4h 保全。新 env `PROACTIVE_TICKET_ENABLED`/`PROACTIVE_TICKET_INTERVAL_DAYS`、226→247 tests pass。restart + push 済み、実機発火の実見待ち) / 2026-06-19 (自律ループ「動く = vault notes/ 自己調査」分岐を proactive に実装 = persona 軸 4 拡張 (3) 勝手な実行 A。発火回のうち条件成立時に関心スレッド 1 本を Web 調査 → vault notes/ に新規ノート作成 → #chat に一言報告。bot 側完結 (script 無改変)、ephemeral session (resume なし) で #chat 会話を汚さず budget_guard を通す、報告後に #chat session の last_prompt_at を明示更新して 4h 最低間隔を保全。新 env `PROACTIVE_INVESTIGATE_ENABLED`/`PROACTIVE_INVESTIGATE_INTERVAL_DAYS`、226 tests pass (interests should_investigate 8 + bot investigate 配線 5 + helper)。restart + push 済み、実機発火の実見待ち) / 2026-06-19 (interests.py に canonical 純関数 `activity_score` 追加 = 関心 index の活性度 [0,1] を新鮮さ重みで算出。maintenance の proactive-companion.sh が import して step7 確率を変調 (不在の可変ケイデンス、persona 軸 4 拡張 (2))。bot.py は非変更・挙動不変、212 tests pass (ActivityScoreTest 8 追加)。restart 不要・push 済み = 2026-07-06 確認) / 2026-06-16 (自発発話への声載せ = todo#22、proactive の Telegram 送信時に TV からも一言発話 (「生成と再生の分離」= fire-and-forget)。commit `612cec4`、184 tests pass。restart + push 済み、実機発火観察待ち) / 2026-06-12 (PLAY_ALLOWED_HOSTS に TVer 2 host 追加 = remote RV-11 のミラー同期。tver.jp / www.tver.jp + canonical ベクタ受理 2・拒否 2、47 tests pass。bot.py 変更はリスト追加のみで次回 restart 反映、急がない) / 2026-06-12 (voice bot 統合 **完了** = Phase 4、/say + /status voice 集計 + voice_ledger。restart + speaker 11 + V-S1/V-S2 実弾 pass 済み、以後この bot.py 大改変への様子見観察) / 2026-06-12 (テストログの本番 bot.log 混入を修正 = logger 冪等化、bot.py 変更は挙動不変で次回 restart 反映) / 2026-06-12 (自発発話の種「死蔵知識との再会」追加 = チケット #20、persona 軸 4 実装 (2)) / 2026-06-12 (C-3 改訂 = ticket #16: 課金窓アンカー集計 + /quota 公式 /usage 併記をプランに追加、実装は C-3 着手時) / 2026-06-12 (/play を xdg-open から remote 常駐 mpv (TV) 再生に切り替え = ticket #17、restart は user 操作待ち)

## 設計メモ

- Telegram supergroup ↔ `claude -p` 土管 bot (2026-05-28 cold cut で Discord から全面移行、設計 `~/companion/workspace/redesign/telegram-design.md`)
- supergroup の各 topic (#chat / #research / #maintenance / General) でユーザーメンションをトリガに `claude -p` を呼び、出力を同 topic に返す。topic = 1 session model (`(chat_id, thread_id)` 複合キーで session 分離)
- OWNER_ID (Telegram user.id、`@userinfobot` で取得) 以外の発言は完全に無視 (4 段防御: user.id / is_bot / chat.type / chat.id)
- 主要パス:
  - `bot.py` … 本体 (1 ファイル構成、PTB v22.7 Application + Unix socket listener、`chunk_telegram` / `send_text` / `_typing_action` 含む)
  - `companion-bot.service` … systemd user unit (`~/.config/systemd/user/` から symlink で配置 + `enable --now` 済)
  - `.env` … `TELEGRAM_BOT_TOKEN` / `OWNER_ID` (Telegram user.id) / `NOTIFY_CHAT_ID` (supergroup chat_id、負値) / `BOT_THREAD_ID_*` (各 topic の数値 ID) / `CLAUDE_BIN` / `CLAUDE_CWD` / `CLAUDE_TIMEOUT` / `BOT_BUDGET_GUARD` / `BOT_REQUESTS_PER_HOUR` (chmod 600)
  - `requirements.txt` … `python-telegram-bot[rate-limiter,job-queue]>=22.7,<23` + `python-dotenv>=1.0,<2.0`
  - `venv/` … Python 3.10 で 2026-05-28 cold cut 時に再構築 (旧 Discord 版 venv は rollback path として `venv-discord-backup/` に退避していたが、2026-06-09 に OWNER 削除承認で rm 済 = rollback path 撤去)
- 通知投入口: `$XDG_RUNTIME_DIR/companion-bot.sock` (permission 0600)。1 接続 1 メッセージ (UTF-8、EOF で確定)、本文は `.env` の `NOTIFY_CHAT_ID` + `BOT_THREAD_ID_MAINTENANCE` (空なら maintenance fallback) で指定した Telegram supergroup の #maintenance topic へ転送。`[critical] ` プレフィクス完全一致 (半角込み) で `disable_notification` 反転 (silent default、critical のみ音 ON)。例: `printf '%s' "..." | nc -U $XDG_RUNTIME_DIR/companion-bot.sock`
- 実行 CWD: `claude -p` は `~/companion/workspace` を CWD として起動
- ログ: `~/companion/logs/bot.log` (RotatingFileHandler, 5MB×3)
- `claude` CLI のパスは `.env` の `CLAUDE_BIN` と service ユニットの `Environment=PATH=...` の両方に nvm バージョン依存パスを書いている。Node 更新時は両方追従要
- git: ローカル `~/companion/bot/.git`、リモート `git@github.com:mooneclipse/companion-bot.git`（プライベート）
- pre-commit hook: `.git/hooks/pre-commit` で `~/bin/gitleaks git --pre-commit --staged --redact` を実行。秘密情報を含む commit は exit 1 で拒否される
- log 方針: `~/companion/logs/bot.log` は `os.umask(0o077)` + 起動時 chmod で 0o600 を維持。`/play` 等の URL を `%r` で本文記録する。**OWNER 限定経路前提**: 将来 OWNER 以外のコマンドを追加する際は URL / 本文 log の取り扱いを再評価すること (個別 mask / 集計のみに切替など)

## TODO

Telegram cold cut (2026-05-28) 後の **cleanup / 観察の残項目** を実態反映 (2026-06-09 棚卸し)。移行本体・各コマンド (`/vault_push` `/tweet` 自発発話) は Done に転記済で稼働中。残りは下記のみ:

- **A-1 (確定・作業不要)**: `sessions/channels/` の `.archive/` への退避 (旧 L163「切替 1 週間後 rename」) は **不要と確定**。`sessions/` は `.gitignore` 対象 = git 追跡外、かつ channels/ は**空**。保全対象ゼロのため移動しない (2026-06-09 棚卸しで判定、再検討不要)。
- ~~**B-1 (着手可能)**: `claude_runner.ClaudeOptions` 未使用 7 フィールド (`prompt_prefix` 等、B4-1) を実装するか削るかの判定。前提データ揃い済み — Telegram 窓 13 日間の cache hit 率 90.6% (B-3 締め実測、2026-06-10)。~~ → **2026-06-10 完了 (OWNER 承認で全削除、Done 転記済み)**。
- ~~**B-3 (期限 2026-06-11)**: cold cut +14 日の Telegram 観察締め~~ → **2026-06-10 前倒しクローズ (OWNER 承認)、Done 転記済み**。全項目クリーン。K-14 (Console vs ledger 差分点検、7/1 前後) のみ別項として継続:
- ~~**B-4 (7/1 前後)**: K-14 = Anthropic Console 累計使用量 vs ledger.jsonl 累計の差分点検~~ → **2026-06-16 凍結**: 6/15 新クレジット制は公式 pause で前提消失 (制度未開始 + ledger の金額記録も撤去済、subscription usage 消費前提に戻した)。Anthropic が制度を確定したら再設定する。

bot 改良プラン (2026-06-10 OWNER 合意、center of truth = `~/companion/workspace/redesign/bot-improvement-plan.md`、ステップ単位で着手・各 Step 完了時に Done 転記):

- ~~**C-1**: Step 1 閲覧自由化~~ → **2026-06-10 完了、Done 転記済み** (実弾検証 3 件 pass、消費観察起点 = 2026-06-10)。
- ~~**C-2**: Step 2 bot.py 小改変パック #1 — 画像応答 + permission_denials 記録~~ → **2026-06-10 完了、Done 転記済み** (restart + 実弾検証 2 件 pass、数日の様子見のみ継続)。
- **C-3 (一部凍結、独立項目完了)**: Step 3 予算計器 — 課金窓アンカー集計 (`BOT_CREDIT_ANCHOR_DAY`) / ソフト警告 50%/80% / /quota 窓終端着地予測 は **2026-06-15 のクレジット枠分離が公式 pause されたため凍結** (金額・課金窓を前提とするため。Anthropic が制度を確定したら再設計)。**2026-06-16**: budget guard は `requests_count` (1h 回数上限) に戻し、ledger の金額記録・/quota の金額表示は撤去済 (詳細は下記 Done「2026-06-16 credit guard 撤去」)。**2026-06-28**: クレジット枠と独立な 2 項目完了 — /status セッション肥大可視化 (Step 3-3、commit `c9caaa8`) + /quota 公式利用率併記 (Step 3-4、commit `05064d9`)、Done 転記済み。
- **C-4 (C-2/C-3 後、1 機能 = 1 着手)**: Step 4 機能追加 — /remind → チケット連携 の優先順。死蔵知識 proactive 拡張は persona 軸 4 実装 (2) として 2026-06-12 に前倒し完了 (チケット #20、Done 転記済み)。**2026-06-28**: /remind 実装完了 (commit `cc1734d`、Done 転記済み)。
- ~~**C-5 (次回 bot.py 改修時に同梱)**~~ → **2026-06-28 完了** (Step 3-3 と同梱、commit `c9caaa8`、Done 転記済み)。

(`/vault_push` 実装は下記「Done」セクションに転記済)

---

Phase 2.5「土管の耐久化（再設計）」T-A〜T-E 全完了 (T-D 後半 = 2026-05-19 即時前倒し)。Phase 2.5 redesign の残 TODO なし。

設計根拠:
- `~/companion/workspace/redesign/design.md` (v0.2.3, 2026-05-14; §4.2 / §4.5 / §4.6 / §15 に 2026-05-19 CreditBudgetGuard 即時前倒し追補を反映済)
- `~/companion/workspace/redesign/questions.md` (UQ-1〜UQ-10 全項目回答済)

### Phase 2.5 健全性観察 (2026-05-19 〜 2026-05-27、8 日で打ち切り、lead 単独判断)

CreditBudgetGuard 即時前倒し以降の bot.service NRestarts / bot.log ERROR/WARN / `/quota` `[guard: credit_usd]` 表示 / Discord 経由 prompt 計測値を観察。**2026-05-27 lead 単独判断で打ち切り、Phase 2.6 cold cut 前倒し実施**。詳細根拠は PROJECT.md 健全性チェック履歴「2026-05-27 (追): Phase 2.5 観察打ち切り + Phase 2.6 cold cut 前倒し判断」entry 参照。観察結果サマリ (打ち切り時点): NRestarts=0、ERROR/WARN/Traceback 0 件、`/quota` credit_usd 表示稼働、ledger 累計低消費継続、catch-up 経路二重実行で重複なし、vault sync 正常稼働 = 「実害ゼロ拡張ルール」(M-1) 適用条件 (i)(ii)(iii) すべて満たし。

追加観察項目 (2026-05-20 全体レビューで追記):
- **`claude_runner.ClaudeOptions` 未使用 7 フィールド + `to_sdk_kwargs()` の判定** (B4-1): `add_dir` / `no_session_persistence` / `disable_slash_commands` / `exclude_dynamic_system_prompt_sections` / `setting_sources` / `prompt_prefix` / `prompt_suffix` は SDK 移行耐性 / cache framing 用に T-B で先行設置、現状 bot.py からは `timeout_s` のみ代入。観察期間中に prompt-cache hit 率データ (`/quota` キャッシュ表示) が出揃ったタイミングで「`prompt_prefix` 実装するか、空のまま削るか」を判定。Phase 3 着手者の混乱コストを削るため期間内に決定する → **2026-06-10 全削除で完了、Done「ClaudeOptions 未使用フィールド削除 (B-1 完了)」参照**
- **`web/scripts/vault-sync-from-transcript.sh` の `vault-sync.log` 行数/サイズ** (B4-5): rotation 不在の意図設計 (年間数 MB 想定) の破綻有無チェック → **2026-06-10 実測完了、対応不要でクローズ** (Done「vault-sync.log rotation 不在調査 (B-2 完了)」参照)

軸 5 集約観察項目 (2026-05-20 軸 5 agent team で追加、19 件統合): 詳細は `~/companion/workspace/review-2026-05-20/axis-5-result.md` §4 (K-1〜K-19) 参照。集計タイミング別: 6/2 完了時点 (K-1〜K-12) / 月跨ぎ JST + 月末締め (K-13/K-14) / bot/ 側着手後 (K-15〜K-18) / 本 review 完了後最優先 (K-19 = CLI 2.1.145 再検証)。Round 4 (5/26 以降 or 6/2 完了後) で実観測再点検実施。

### Phase 2.6 Telegram 移行設計確定 + cold cut 実施 (2026-05-27)

Discord 土管 → Telegram supergroup (topic = 1 session model) 移行の **設計確定 + cold cut 当日実施**。agent team `companion-telegram-migration` (architect / devil / ux + lead) による mesh + lead approve 完了 → 同日内に実装着手前検証完了 → lead 単独判断で cold cut 前倒し採用 → cold cut 当日実施。

**設計 center of truth**: `~/companion/workspace/redesign/telegram-design.md` (2026-05-27 §9.1 改訂、cold cut 前倒し)
**cold cut 切替手順書**: `~/companion/bot/docs/telegram-setup.md` (BotFather セットアップ + supergroup 構築 + 実機検証 + cold cut step + rollback)
**実装着手日**: 2026-05-27 (当初 6/2 以降想定から lead 前倒し、PROJECT.md 2026-05-27 (追) entry 参照)

#### 実装着手前検証項目 (V-1〜V-25 + D-add-1〜D-add-12 + 追加)

実装着手 (2026-06-02 以降) 前に bot/ side で埋める必要がある:
- **V-1**: Telegram Bot API `Update` 全 type 一覧、telegram-design §4.5 allowlist (11 種類) を網羅確認
- **V-3 / V-22**: Bot API changelog 12-24 ヶ月分の breaking change 集計 (`https://core.telegram.org/bots/api-changelog`)、deprecation 履歴
- **V-4**: `message_thread_id` 削除後再利用挙動 (公式 doc 明記 or 実機検証 3 回)
- **V-5**: General topic (thread_id = None or 0) の確定、PTB type definition で確認
- **V-6**: `can_manage_topics: false` 時の bot 動作確認 (rc=403 ハンドリング)
- **V-11 / V-12**: PTB long polling offset 永続化 + bot.service 停止中の Update キューイング挙動
- **V-21**: PTB v22 / aiogram v3 maintainer 数 + リリース頻度 + breaking change 履歴
- **D-add-2**: Telegram (Android, Pixel-6) で reply chain 視認性 user 確認 (採用案 = chunk1 のみ reply の倒し直し trigger)
- **D-add-3**: Forum UI deprecation 履歴 12-24 ヶ月分検証
- **AIORateLimiter log level**: PTB v22 公式 doc spot check、`telegram.ext.AIORateLimiter` logger を INFO 以上に設定 (devil V-8「retry 沈黙」回避)
- **Bot API up 時の再点検運用**: `~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」と同方針、新 Update type 検知時の allowlist 再点検

#### 検証結果 (2026-05-27 公式 doc fetch 実施分、実機検証分は 6/2 当日)

公式 doc fetch で完結する V-1 / V-3 / V-22 / V-11 / V-12 / V-21 / AIORateLimiter / D-add-3 を 2026-05-27 に実施。実機検証 V-4 / V-5 / V-6 は `bot/docs/telegram-setup.md` §5 に手順を整備し、6/2 cold cut 当日に実施 (BotFather 経由の bot 作成 + supergroup 構築が必須前提)。

- **V-1**: Bot API 10.0 (2026-05-08 リリース) 時点で `Update` field は **25 種類**。telegram-design §4.5 allowlist 11 種類との差分 14 種類 (`edited_channel_post` / `business_*` 4 種 / `guest_message` / `message_reaction_count` / `chosen_inline_result` / `shipping_query` / `pre_checkout_query` / `purchased_paid_media` / `poll_answer` / `chat_boost` / `removed_chat_boost` / `managed_bot`) は "handler 未登録 = silently drop" (§4.5 末尾) で取りこぼし、N-T7 経路に乗る = 設計通り
  - 補強: `getUpdates` default で `chat_member` / `message_reaction` / `message_reaction_count` は **Telegram 側で除外** (Bot API doc 明記、`allowed_updates` 空指定の挙動)。design.md §4.5 で ✗ している `chat_member` / `message_reaction` の明示 filter は二重防御として継続妥当 (Telegram 側 default + bot 側 handler 未登録の両方で弾く)
  - PTB v22.7 が対応する Bot API バージョン = 9.5 (PTB CHANGELOG)、現行 Bot API 10.0 で 0.5 バージョン遅れ。v22.7 リリース時点で対応していない Update type (`guest_message` / `managed_bot` 等) は PTB から見えない可能性大、cold cut 時点で問題なし
- **V-3 / V-22**: 24 ヶ月分 (2024-05〜2026-05) で breaking change **3 件**、いずれも bot.py / sessions.py / quota.py が触らないフィールド (直接影響なし):
  1. Bot API 8.2 (2025-01-01): `InlineQueryResultArticle.hide_url` 削除
  2. Bot API 9.0 (2025-04-11): `BusinessConnection.can_reply` → `rights: BusinessBotRights`
  3. Bot API 9.6 (2026-04-03): `Poll.correct_option_id` → `correct_option_ids`
- **V-11 / V-12**: Telegram server-side Update **保持期間 = 24 時間** (Bot API getUpdates doc 明記、"will not be kept longer than 24 hours")。bot.service 停止が 24h 以内なら catch-up 経路で取りこぼしなし、24h 超え停止時のみ取りこぼし発生 (受容可能、観察項目 K-T14 に追加)
  - PTB `drop_pending_updates` default = **False** (起動時に pending Update を保持して処理) = 設計 §4.6 long polling stall 検知 + systemd Restart=on-failure の前提と整合
  - PTB の getUpdates **offset 永続化は公式 doc 明示なし** (`Application.persistence` は chat_data/user_data 用、offset は別レイヤ)。bot.service プロセス再起動時、Telegram 側 24h retention に依存して取りこぼし回避 = 仕様として受容、観察項目 K-T15 で監視
- **V-21**: lib リリースペース比較 (2026-05-27 時点):
  - PTB **v22.7 = 2025-03-16 リリース** = Bot API 9.5 対応、v23 系未リリース、**前回リリースから 14 ヶ月空き** (22.x series は元々 2-3 ヶ月間隔だった)
  - aiogram v3.28.2 = 2026-05-10 リリース = Bot API 10.0 対応、**毎月リリース**、活発
  - lead 判断: 設計時の PTB 採用根拠 (JobQueue 同梱 / discord.py 構造 / doc 厚さ) は維持できるが、開発ペース低下を新規観察項目 **K-T16** として追加。Phase 2.6 cold cut 開始 +6 ヶ月 (2026-12 目処) 時点で PTB v23 未リリース + Bot API 10.x で breaking change 発生があれば lib 切替議論を起動
- **AIORateLimiter log level** (PTB source 直接確認): logger 名 = `"AIORateLimiter"` (`get_logger(__name__, class_name="AIORateLimiter")`)、retry イベント = `_LOGGER.info("Rate limit hit. Retrying after %f seconds")`、max_retries 超過 = `_LOGGER.exception("Rate limit hit after maximum of %d retries")` (= ERROR + traceback)
  - **K-T4 確定方針**: bot.py 起動時に `logging.getLogger("AIORateLimiter").setLevel(logging.INFO)` を明示。root logger が INFO 以上なら不要だが、defensive に explicit 設定する。これで retry が沈黙せず bot.log に記録される (devil V-8 回避)
- **D-add-3** (Forum UI 関連の 24 ヶ月変更履歴):
  - 拡張方向のみ、**deprecation ゼロ**
  - 7.9 (2024-08-14): Super Channels サポート (sender が user/channel どちらも許可)
  - 9.3 (2025-12-31): **Topics in private chats** (private chat でも `message_thread_id` / `is_topic_message` 使用可、`has_topics_enabled` User field)
  - 9.4 (2026-02-09): bots に `createForumTopic` 権限拡張 (private chat 対応)、`allows_users_to_create_topics` User field
  - 9.5 (2026-03-01): `ChatMemberMember` / `ChatMemberRestricted` に `tag` field、`setChatMemberTag` method (forum 関連ではないが member 管理拡張)
  - lead 判断: Forum/Topic は Telegram 公式に **拡張投資中**、近い将来の deprecation リスク低。Phase 4 で private chat の topic 機能を活用する選択肢が広がっている (現状 supergroup topic で確定なので punt)
- **Bot API up 時の再点検運用**: 設計 §4.5 末尾通り、新 Update type 検知時の allowlist 再点検は `~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」と同方針で運用。Bot API 10.0 → 10.x / 11.0 への upgrade 時に PTB v23 リリース有無 + Update type 追加を確認

#### 観察項目追加 (Phase 2.6 観察項目 K-T13〜K-T16、telegram-design §14 K-T1〜K-T12 の続番)

設計 telegram-design §14 の lead 集約持ち越し 12 件 (K-T1〜K-T12) に加えて、2026-05-27 公式 doc 検証で出てきた 4 件を追加。axis-5 集約観察項目 K-1〜K-19 (本台帳 L40) とは別 namespace (K-T プレフィクスで Telegram 専用 namespace 明示):

13. **K-T13**: Bot API 10.x / 11.0 への upgrade 時に **Update type 追加 + PTB v23 リリース有無** を確認、§4.5 allowlist 再点検 (Bot API up 時の再点検運用と同方針、V-1 由来)
14. **K-T14**: bot.service 停止時間が 24 時間を超える運用が発生したら、Telegram retention 切れで Update 取りこぼし発生。観察期間中に発生したら回数記録、2 回目で systemd 起動ヘルス強化 (`Restart=always` 等) を再設計判断 (V-12 由来)
15. **K-T15**: PTB `getUpdates` offset 永続化を bot.py 側で実装する必要が出たら判断トリガ。観察期間中に「bot 再起動直後に旧 Update 大量処理で予算消費」発生したら設計引き直し (V-11 由来)
16. **K-T16**: PTB v22 系のリリース間隔監視。前回 v22.7 = 2025-03-16 から 18 ヶ月超え (2026-09 以降) + Bot API 10.x で PTB 未対応 breaking change 発生があれば aiogram v3 への切替議論を起動 (V-21 由来)

#### 実機検証 V-4 / V-5 / V-6 (2026-05-27 当日前倒し実施、全 pass)

user 側で BotFather による bot 作成 + supergroup `my group` + Topics (General / #chat / #research / #maintenance) + bot Administrator 追加 + privacy mode off まで完了済 (2026-05-27 夜)。claude 側で curl 経由 getUpdates / getMe / createForumTopic を直接叩いて検証実施 (`bot.service` 無関係、N-T3 違反なし)。

**getMe 結果** (bot 初期状態確認):
- username: `@companion_renbot`
- `can_read_all_group_messages: True` (privacy mode off、bot.py post_init の `sys.exit(1)` 条件回避済)
- `can_join_groups: True` / `supports_inline_queries: False`

**V-5 pass** (General topic thread_id 確定):
- supergroup `my group` (chat_id `<NOTIFY_CHAT_ID>`) の General topic で OWNER が `@companion_renbot test general` を送信 → getUpdates で `message_thread_id: None`, `is_topic_message: None` を確認
- 設計 §2.3 General topic 扱い (ファイル名 `<chat_id>_general.json` 固定 suffix、PTB の `update.effective_message.message_thread_id` も `None` で返る前提) と整合

**V-4 pass** (削除 thread_id 再利用なし):
- 手順: `#v4-delete` topic 作成 (forum_topic_created で thread_id=11 観察) + メッセージ送信 → topic 削除 → `#v4-new` topic 作成 (forum_topic_created で thread_id=13 観察) + メッセージ送信
- thread_id は **11 → 13 で連番増加**、削除した 11 は再利用されず、12 もスキップ (V-6 の createForumTopic 400 失敗時に内部 id allocator が前進した模様、Telegram 側 allocator は API 成否に関わらず単調増加と推定)
- 設計 §2.4 stale-thread-observation jsonl 運用 (1 回=許容、2 回=2 周目認定) の前提 = `(chat_id, thread_id)` 複合キー衝突なし、が成立

**V-6 pass** (can_manage_topics:false で 400):
- bot Administrator 権限 `can_manage_topics: false` の状態で `POST createForumTopic name=v6-test-should-fail` → `{"ok": false, "error_code": 400, "description": "Bad Request: not enough rights to create a topic"}`
- Telegram 側で物理的に弾かれること確認、副作用ゼロ (topic 作成されず)。bot.py 自体では `createForumTopic` を呼ばない設計 (telegram-design §6.1 topic 管理は OWNER 手動) だが、二重防御として成立
- 副次観察: 失敗 API 呼び出しでも内部 id allocator は前進する (V-4 で観察された 12 スキップの原因)

**取得確定値** (cold cut 当日 6/2 に `bot/.env` 記載予定):
- `NOTIFY_CHAT_ID=<NOTIFY_CHAT_ID>` (supergroup `my group`)
- `BOT_THREAD_ID_CHAT=3` / `BOT_THREAD_ID_RESEARCH=4` / `BOT_THREAD_ID_MAINTENANCE=5` / `BOT_THREAD_ID_VOICE_LOG=` (空、Phase 3-2 voice 着手時に追加)

**残作業** (cold cut 当日 6/2 以降):
- user 操作: 検証用 topic `#v4-new` の手動削除 (実害なし、当日 cleanup)
- claude 実装: telegram-setup.md §6.2 step に従い bot.py / sessions.py / quota.py / requirements.txt / .env.example / companion-bot.service の cold cut commit 作成
- user 操作: telegram-setup.md §6.2 step 0〜7 (commit pull → bot 停止 → venv swap → .env 追記 → bot 起動 → smoke test)
- 観察: cold cut +14 日 (2026-06-16 目処) で Telegram 観察完了、Phase 4 着手条件 #2 判定起点 (※2026-06-01 追加判断で条件 #2 は Phase 4 着手の門から外れた → Done「Phase 3 を畳んで Phase 4 へ」参照)

#### 実装着手後の運用ルール (lead 集約持ち越し 12 件 + K-* 観察項目への統合)

1. **K-T1**: ENV 5+ topic 再点検 trigger (`BOT_THREAD_ID_*` 増殖検出、5+ で対症療法 2 周目認定 → 設計引き直し議論起動、ax §1.1 boundary footnote / N-T11)
2. **K-T2**: stale-thread-observation jsonl 運用 (`bot/.state/stale-thread-observations.jsonl`、同 thread_id で 1 回 = 許容、2 回目 = 2 周目認定、devil A6)
3. **K-T3**: D-add-2 Pixel-6 reply chain 視認性 user 確認 (採用案 = chunk1 のみ reply で視認性低下時の不採用案倒し直し trigger)
4. **K-T4**: AIORateLimiter log level (INFO 以上設定、retry 沈黙回避、devil V-8)
5. **K-T5**: Bot API up 時の再点検運用 (新 Update type 検知時 → allowlist 再点検、CLAUDE CLI バージョン up と同方針)
6. **K-T6**: Forum UI deprecation 履歴監視 (D-add-3、Phase 4 trigger 候補)
7. **K-T7**: venv rollback path (`mv venv venv-discord-backup` + 1 週間運用後 rm、devil A7)
8. **K-T8**: catch-up worker rate 制御 (AIORateLimiter 1 層、素手 sleep 永続禁止、N-T12 違反監視)
9. **K-T9**: sentinel 種別上限 (1 種限定、2 種目要求 = 設計引き直し議論起動、W-6 / ax §7.2.1)
10. **K-T10**: `[critical]` プレフィクス上限 (完全一致 1 件、`startswith("[critical] ")` 半角スペース込み、2 種目要求 = 設計引き直し議論起動、W-6)
11. **K-T11**: edit event filter (`edited_message` 完全無視を維持、`MessageHandler(filters.UpdateType.MESSAGE & ~filters.UpdateType.EDITED_MESSAGE)`、W-6 / N-T7)
12. **K-T12**: 新 2 週間観察カウント条文 (cold cut 切替日から 14 日、Phase 4 着手条件 #2 PROJECT.md L228 改訂反映済) (※2026-06-01 追加判断で #2 は Phase 4 着手の門から外れ、bot.py 大改変時の様子見へ再定義 → Done「Phase 3 を畳んで Phase 4 へ」参照)

#### Phase 2.6 実装 TODO (cold cut 切替日に開始)

- bot.py 全面書き換え + telegram_io.py 新設 (詳細は telegram-design.md §4)
- sessions.py schema 2 軸拡張 (`(chat_id, thread_id)` 複合キー)
- quota.py 軽微 rename (`channel_id` → `topic_key`)
- requirements.txt 差し替え (`discord.py` → `python-telegram-bot[rate-limiter,job-queue]>=22.7,<23`)
- .env.example / companion-bot.service description 更新
- venv 入れ替え (rollback path 確保)
- 切替 1 週間後に `sessions/channels/` を `.archive/channels-pre-telegram/` に rename

実装段階で詳細を In progress に展開する。

## In progress

（なし）

## Review pending

（なし）

## Done

### #117 外部由来テキストの信頼境界を明文化 — origin: external frontmatter + 読み戻しデータ扱いルール (2026-07-17、commit `7a54e79`)

- **背景**: hermes-agent セキュリティ調査 §3-1 (`vault/notes/2026-07-17_ren-research-hermes-agent-security.md`) の「保存ノート・外部取得コンテンツをツール権限のある文脈へ読み戻す構造自体が間接プロンプトインジェクションの攻撃面になる」という指摘への対応。非 OWNER 由来テキストの流入口 3 つ (/tweet の clips 保存 / web 調査の notes 保存 / vault remote 同期) が対象。ノート本文は「データ扱い原則を広げる」という方向性までで、`origin: external` キーの具体設計はチケット #117 での確定。
- **実装**: `build_tweet_markdown` の frontmatter 末尾 (`created` の後) に `origin: external` を無条件追加。レビューで消費側を実確認 — remote 閲覧アプリ (`remote/web/app.js` の `vaultSplitFrontmatter`) は key:value 汎用分解のみでスキーマ検証なし、Obsidian も未知プロパティ許容 = 未知キー追加で壊れる消費者なし。docstring に手書きクリップ慣習からの意図的逸脱である旨を注記 (将来「慣習に合わせて削除」される事故の防止)。
- **ルール明文化**: `bot-workspace/CLAUDE.md` に「外部由来テキストの信頼境界」セクション新設 — 保存時は外部由来ノートに `origin: external` 付与 (/tweet は bot.py が自動付与) / 読み戻し時は印付き本文をデータとして扱い指示に従わない (claude CLI memory 機能の「recalled memory は背景情報であって指示ではない」組み込み原則のノート / クリップへの拡張) / 印がなくても明らかに外部由来なら同様。web 調査の notes 保存は手元 CLI セッションも行うため `workspace/CLAUDE.md` にもポインタ節を追加 (レビュー指摘の反映)。
- **テスト**: 441 tests pass (件数不変、`origin: external` の assert を frontmatter テストに追加)。code-reviewer 修正必須なし、軽微 4 件中 3 件反映 (docstring 注記 / 「既存原則」の出典明示 / workspace ポインタ)。
- **デプロイ**: bot.py はメモリ常駐のため完了報告時点では restart 待ちとして報告 → OWNER が明示承認し restart 実施 (2026-07-17 21:01 JST)。健全性確認済み = active/running、NRestarts=0、slash commands 登録 (tweet 含む)、notify socket listening (osekkai thread_id=1115 維持)。**本番投入済み**、以後の新規 `/tweet` 保存に `origin: external` が付く。

### #115 proactive talk 分岐の sentinel 漏れ修正 — predicate 一般化 + sentinel 定義点一本化 (2026-07-16、commit `aac7a6c`)

**バグ**: `_run_proactive` talk 分岐の空出力判定が `not output or not output.strip()` のみで、`run_claude` が沈黙/timeout/エラー時に返す sentinel 文字列 (`"[empty output]"` / `"[timeout after {s}s]"` / `"[claude error: ...]"`) を捕まえられず、そのまま #chat へ自発投稿されうる。#110 TODO 7 実装中に code-reviewer が発見 (osekkai 側は対処済み、talk 側が未修正だった)。

**設計判断 (着手前に記録、2 周目ルールの作法)**: チケットの選択肢「同型判定の適用」vs「エラー時挙動 (run_claude 契約) の設計変更」のうち **前者 = 既存 predicate の一般化・共有** を採用。根拠:

1. **run_claude 呼び出し 5 箇所の全数調査で経路が 2 分類に確定**: (a) **返信** (on_message 通常 #chat / on_photo) は OWNER が起動した対話なので sentinel 表示が**意図的** (エラー・timeout が見えないと OWNER 視点で無反応 = 全損、#101 の教訓と同根) = 触らない。(b) **沈黙権つき経路** (osekkai worker = 自発投稿 / osekkai on_message = 返信だが #110 D-7 で沈黙権を明示許可した記録済み判断 / talk 分岐 = 自発投稿) は sentinel を「送らない」に倒す。osekkai 2 箇所は対処済み、talk のみ残 = 本チケット。
2. **run_claude の契約変更 (エラー時空文字返し等) は不採用**: 返信経路の sentinel 表示を壊す。構造化戻り値への変更は osekkai 実弾検証 (#110 TODO 8) 当日に入れる変更として過大。契約は現状維持し、消費側が「沈黙権のある経路か」で送る/送らないを決めるのが責務分担として正しい。
3. **2 周目ルール非該当の理由**: sentinel prefix 3 種は bot 自身が生成する閉じた契約 (claude の stderr 文言分類ではない)。prefix 集合に case を増やさず、既存 predicate を汎用名に一般化して水平適用 = 判定機構は 1 本のまま。ephemeral 系 (`run_investigate`/`run_ticket`/`run_remind`) はエラー時空文字契約で穴なし = 変更しない。

**実装** (Sonnet subagent 委任、実装 → 高強度レビュー → 指摘反映の 2 往復): `_OSEKKAI_SILENT_OUTPUT_PREFIXES` → `_SILENT_OUTPUT_PREFIXES`、`_osekkai_should_send` → `_should_send_claude_output` に改名し talk 分岐 (旧 `not output.strip()` 判定) へ適用。sentinel 文字列の定義点を run_claude 直前の `_SENTINEL_EMPTY` / `_SENTINEL_TIMEOUT_PREFIX` / `_SENTINEL_ERROR_PREFIX` に一本化 (生成側と判定側の drift で判定が無音で素通しに戻る再発経路を閉じる。生成文字列は変更前後で完全一致を実測確認)。ledger の `reason: "empty_output"` は据え置き (沈黙/エラーを 1 状態に倒す既存思想、切り分けは bot.log)。

**レビュー** (workflow 版 code-review、high effort、finder 4 + verifier 8): 検証通過 5 件のうち反映 3 件 = (1) docstring が osekkai on_message を「自発投稿」と誤分類する自己矛盾 (CONFIRMED) → 3 箇所の分類を実態どおりに書き直し、(2) sentinel リテラル二重定義 → 上記定数一本化、(3) テストハーネス ~55 行の逐語コピー → `_ProactiveTalkHarnessBase` (test メソッドなし、二重収集なし) に抽出し `ProactiveSelfScheduleTest` と `ProactiveTalkSentinelTest` が継承。**見送り 2 件** (根拠つき受容) = (i) 正当本文が偶然 sentinel prefix で始まると黙殺 — prefix 判定は #110 の記録済み設計で persona 発話が該当する実確率ほぼゼロ、(ii) talk 経路で claude 恒常障害が #chat から不可視化 — sentinel を流さないのが本チケットの目的そのもので、障害は bot.log warning + 返信経路のエラー表示 (維持) で表面化する。refuted 2 件 (budget guard exceeded_message の TOCTOU 窓) は既存の受容済み設計。

**テスト**: 437→441 pass (talk 分岐の sentinel 3 種 skip + 対照 1 種を新設、純関数テストのリテラル直書きは契約 pin として維持)。

**デプロイ**: `systemctl --user restart companion-bot` は auto mode classifier が一度ブロック (本番デプロイは OWNER 名指し承認が要る判定、#110 timer enable と同型) → AskUserQuestion で OWNER が「restart していい」を明示選択し実施 (13:16 JST)。健全性確認済み: active/running、NRestarts=0、slash commands 登録、notify socket listening (osekkai thread_id=1115 維持)。**本番投入済み**、今夜 19:11 の osekkai 号令 (#110 TODO 8) は新コードで迎える。

### osekkai (#110 TODO 7) bot 側分岐 — kind ディスパッチ + osekkai topic 永続セッション (2026-07-16)

- **内容**: 台帳の正は `~/companion/osekkai/docs/STATUS.md` TODO 7 行 (実装詳細・設計判断はそちらに集約)。ここでは bot/ 側の commit・レビュー・デプロイの記録のみ。
- **変更ファイル**: `bot.py` (+約420行)、`tests/test_bot.py` (新規テストクラス、既存テストの一部改修)、`.env.example`、`.claude/rules/bot-py.md`。
- **要点**: `[[proactive-v1]]` marker の kind フィールドで osekkai 専用ディスパッチ (`parse_osekkai_payload`) を proactive_queue とは分離、talk 型永続セッション向けに `run_claude` へ `timeout_s`/`system_prompt` の optional override を追加、`_handle_notify_connection` を単発 read からループ read (+ 10s timeout) へ変更 (partial read 対応)、`osekkai_queue`/`_osekkai_worker`/`_run_osekkai` 新設、`on_message` に osekkai topic 分岐 (`_osekkai_record_manual_start` が intent_store.py を subprocess 経由で叩く) を追加。
- **レビューで発見・修正したバグ**: `run_claude` は沈黙/timeout/エラー時に空文字ではなく `"[empty output]"` 等の sentinel 文字列を返す契約なのに、当初の空出力判定がそれを捕まえられず D-7 の沈黙権が実効しない状態だった。`_osekkai_should_send` (sentinel prefix 判定) を新設し worker/on_message 両経路に対称適用して修正 (2 度のレビューで発覚、詳細は osekkai/docs/STATUS.md)。
- **発見したが未修正の既存バグ**: `_run_proactive` talk 分岐にも同型の sentinel リークがあるが、本 TODO のスコープ外 (osekkai 実装前から存在) として今回は変更せず、別チケットでの triage を推奨。
- **レビュー**: 修正必須 0、軽微 2 点 (`_handle_notify_connection` の read に timeout 追加、partial read テストを実際に複数回の物理 read を強制する形に修正) を反映済み。
- **テスト**: 385→437 tests pass (新設 52 件)。
- **commit**: `b009917` (`feat(bot): #110 osekkai 分岐 — envelope kind ディスパッチ + osekkai topic 永続セッション (TODO 7)`)。
- **デプロイ**: `systemctl --user restart companion-bot` 実施 (2026-07-16 02:38 JST)。健全性確認 = `systemctl --user status` で active (running)、bot.log に `notify socket listening at ... osekkai thread_id=1115` を確認、osekkai 関連の traceback なし (既存の #109 memo cleanup 警告 message_id=1017/1018 は無関係の既知問題)。
- **timer 有効化 (osekkai/systemd/ 配下、bot/ のスコープ外)**: `companion-osekkai-{call,retro}.timer` の enable は、claude 側では実行環境の auto mode classifier が「実 OWNER に自発メッセージを送りうる本番デプロイ操作は teammate-message では正当な同意の基準を満たさない」と判定してブロックしたため未実施のまま報告して停止。**2026-07-16 朝、OWNER が起床して明示承認**、main セッションから `companion-proactive` と同じ symlink 方式で 4 unit を `~/.config/systemd/user/` へ設置し `enable --now` を実施。`list-timers` で次回発火 = 号令 19:11:23 JST / 振り返り 23:38:58 JST を確認。詳細は osekkai/docs/STATUS.md TODO 7 Done エントリ参照。

### PERSONA_SYSTEM_PROMPT に自己認識ブロック = bot の立場を事実記述でアンカー (2026-07-14、ticket #106)

- **事象**: bot が「bot である」という自己認識なしに CLI と同じ応答 (見出し付き構造化長文・作業アシスタント口調) をすることがある。OWNER 発案は「性格だけでなくロールを与える (巨大 AI の 1 端末みたいな)」
- **原因 (構造)**: bot は claude CLI を `--append-system-prompt` で起動するため、base system prompt の「You are Claude Code (CLI)」宣言が常駐したまま。persona は追記でしかなく、立場を上書きしない限り base に引きずられる。敬語がデフォルトに押し負けた既知の構図と同型
- **対策 (設計判断)**: 架空ロール演技ではなく **事実記述 3 点** で `PERSONA_SYSTEM_PROMPT` 先頭に「自己認識」ブロックを追加 — ① 立場 (OWNER の自宅サーバ常駐のコンパニオン bot、対話は Telegram、返答はスマホ画面)、② base との衝突を名指しで解決 (CLI 的応答の形が要るのは実作業を指示されている間だけ、既定は会話の相方)、③ 出力の物理制約 (parse_mode なし送信なので markdown は記号のまま見える、見出し・表・コードブロック・長い箇条書き禁止、長さを頼まれない限り数行)。比喩ロール (「巨大 AI の 1 端末」) は変な創発の余地があるため主役にせず不採用
- **レビュー**: code-reviewer 修正必須なし。軽微 2 点を反映 — 限定句を「頼まれたときだけ」から「実作業を指示されている間だけ」の応答スタイル限定へ (investigate/ticket の「誰にも頼まれていない自分の時間」導入と字義衝突するため)、「数行で返す」に「長さを頼まれない限り」の条件付け (#chat の調べもの用途と衝突するため)。持ち越し 1 点 = `--resume` 継続中の既存 session は CLI 的応答履歴がアンカーに残る。効かない実例が出たら敬語ブロックと同じ「履歴に引きずられない」文言を自己認識側にも足す (今は足さない)
- **反映**: 384 tests pass (`SelfRecognitionBlockTest` 3 件新設、既存 `ForegroundDemotionRuleTest` と同型のキーワード検証)。restart 済み

### CLAUDE_TIMEOUT 300→900s = timeout の責務をハング保険に再定義 (2026-07-14、ticket #101)

- **事象**: OWNER が #chat で頼んだ調べものが 300s timeout で subprocess kill され `[timeout after 300s]` の 20 文字だけ返る事象が 2026-07-14 に 3 件 (00:37 / 00:42 = 同一 session に再送してまた timeout / 06:26)。bot.log 全期間 (2026-05-06〜) で `kind=timeout` はこの 3 件のみ = 初発。3 件とも `run_claude` (通常 #chat resume 経路) で、investigate/ticket/remind の ephemeral 経路ではない (logger プレフィックス「claude error kind=」+ 直後の `send len=20` で確定)。stderr は runner 自身が生成した 38 文字 (`[claude_runner] timed out after 300.0s`) のみ = claude CLI 側のエラーではなく、正常に作業中のプロセスを打ち切って結果を全損した構図
- **原因**: Web 調べもの (WebSearch/WebFetch 多段) は Sonnet 5 で正常でも 5 分を超え得るのに、`CLAUDE_TIMEOUT=300` (.env の設定値、default と同値) が「通信 stall・ハングの保険」と「作業時間の上限」を 1 つの値で兼ねていた。値の問題ではなく責務の混在
- **対策 (設計判断)**: timeout の責務を「ハング・stall の保険」に限定すると再定義し、`.env` の `CLAUDE_TIMEOUT` を 300→900 に変更 (`.env.example` も同期)。コード変更なし。初回の設計判断であり 2 周目ルール非該当 (300 は初期設計から一度も動かしていない)
- **副作用の許容**: `claude_runner.claude_lock` が spawn〜communicate を直列化するため、重い 1 件が後続メッセージ・proactive を最長 15 分ブロックする (従来 5 分)。OWNER 1 人運用で実害小と判断して許容
- **2 周目の予約**: 900s でも調べもの timeout が再発したら数値を再度動かさず (それは 2 周目)、調べもの専用コマンド分離 (OWNER が明示コマンドで選ぶ ephemeral session + 長 timeout。文言マッチでの経路判定はしない) を設計する
- **反映**: restart 済み (2026-07-14 12:16、active + `/proc/<pid>/environ` で `CLAUDE_TIMEOUT=900` 実測)。tests 影響なし (env 値のみの変更)

### proactive 種の多様化 = 「相手の一日」実活動ヒント (2026-07-14、ticket #94)

- **内容**: seed の recent_conversation 偏重 (38/46) を、既存機械出力の種追加で「相手の一日中心」へ広げる。script 側 = maintenance の新 helper `lib/activity_hints.py` (ytcheck 当日推薦レポートのタイトル + english.db 当日 attempts 件数、詳細・出自メモは maintenance/docs/STATUS.md 2026-07-14 entry が正) が payload に `activity_hint` / `activity_type` を足す。bot 側 = (1) `build_proactive_prompt` が activity_hint を「今日のあなたの身の回りで起きたこと」として展開 (str のみ、「触れたければ 1 つだけ軽く・報告口調にしない」の抑制付き。activity_type は prompt に流さない = topic/ledger 専用) (2) `_proactive_topic_from_payload` の優先順を dormant > vault > **activity_type** > recent_conversation に拡張 (OWNER が触れた具体 > 周辺機械出力の具体性順) = 関心 index に機械出力由来 thread が seeding される (3) `_run_proactive` の ledger base に activity_type 追加
- **investigate/ticket との整合 (code-reviewer 軽微の反映)**: カテゴリ固定ラベルの thread は investigate (カテゴリ名調査は具体性欠く)・ticket (actionable でない) から除外するため `interests.py` に `_CATEGORY_LABEL_TOPICS` (helper の SOURCES と相互参照コメントで同期維持) を新設。remind は言及のみで自然なので許容 (テストで明示)
- **検証**: 372→381 tests pass (prompt 展開 3 + topic 導出純関数 2 + wiring/ledger 1 + interests 除外 3)。script 側は bash -n + mock socket エンドツーエンド 3 ケース pass
- **レビュー (code-reviewer、commit 前)**: 修正必須なし。軽微 2 (カテゴリラベルの investigate 対象化 / 同日レポート辞書順 sort) はいずれも反映済み
- **反映**: restart 済み (2026-07-14 09:04、本番投入済み)。実機発火での activity 滲ませは観察待ち

### bot.py の env bool パース 6 連コピペを _bool_env に集約 (2026-07-14、ticket #90)

- **内容**: 2026-07-13 bot 全体レビュー (中) 指摘の消化。`os.environ.get(NAME, "1").strip().lower() in ("1", "true", "yes", "on")` の 2 行コピペを `_bool_env(name, default="1")` ヘルパー 1 本 (load_dotenv() 直後に定義) へ集約。対象はチケット記載の 5 箇所 (PROACTIVE_ENABLED / VOICE / INVESTIGATE / TICKET / REMIND) + 実装確認で見つけた同型 1 箇所 (SELF_SCHEDULE) の計 6 箇所。中間 `*_RAW` 変数は他参照ゼロを確認して削除。挙動不変のリファクタ (default・strip/lower・受理文字列は完全一致)
- **対象外**: `OWNER_ID_RAW` / `NOTIFY_CHAT_ID_RAW` は int パース用で別物、現状維持。`PROACTIVE_*_INTERVAL_DAYS` の try/except float パース 3 連は数値系で本チケット外 (次に増えるならヘルパー化を検討)
- **検証**: `venv/bin/python -m unittest discover -s tests` 372 件全 pass (件数不変)。tests は boolean 側モジュール定数のみ参照で `*_RAW` 非依存 (code-reviewer が grep + 実走で確認)
- **レビュー (code-reviewer、commit 前)**: 修正必須なし。軽微 2 (default を bool 化する案 = 挙動不変チケットの範囲では現状が正解と判定 / restart 反映の明記) のみ
- **反映**: restart 済み (2026-07-14 00:30、active 確認、本番投入済み)

### claude_runner.py の Discord 残滓掃除 = run_session_prompt 改名 (2026-07-13、ticket #98)

- **内容**: #89 ドキュメント同期レビューで検出した Discord 残滓 2 点の掃除 (純改名・挙動不変) — (1) claude_runner.py module docstring 1 行目「Discord bot」→「Telegram bot」 (2) `ClaudeRunner.run_discord` → `run_session_prompt` 改名。改名先は telegram-design.md §8.5 A8 (L112/L406) の既定方針に従う (Phase 2.6 cold cut 時に「platform 非依存なので無改変・別 commit 化」と繰り延べていた分の消化、本 STATUS 2026-05-28 エントリ参照)
- **追従**: bot.py 呼び出し 4 箇所 (`run_claude` / investigate / ticket / remind)、test_bot.py の `mock.patch.object` 対象文字列 + ローカル spy 名 `_fake_run_discord` → `_fake_run_session_prompt`。code-reviewer 軽微推奨でテスト内残存名 `_no_discord` (7 箇所) → `_no_claude`、カウンタキー `ran = {"discord": 0}` (3 箇所) → `{"runs": 0}` も同 commit で掃除 (掃除チケットとして grep 検出の種を残さない)
- **対象外 (意図的不変)**: sessions.py / voice_command.py / bot.py docstring / 本 STATUS の「Discord」言及は移行履歴の正確な記述なので現状維持。redesign 台帳 (design.md / telegram-design.md) は歴史記録。`.claude/rules/claude-runner.md` はメソッド名非言及で追従不要 (実測)
- **検証**: `venv/bin/python -m unittest discover -s tests` 372 件全 PASS (件数不変 = テスト意図非改変)、`grep -rn run_discord` は .py 全域ゼロ (残りは本 STATUS の日付付き歴史エントリのみ)
- **レビュー (code-reviewer、commit 前)**: 修正必須なし。軽微 2 — (a) テスト内残存名の同時掃除を推奨 → 反映済み (上記) (b) docstring 2 行目が改名で約 88 桁 → lint 未導入で実害なし・対応不要判定
- **反映**: restart 済み (2026-07-13 21:06:49、ActiveState=active・MainPID 427808・notify socket listening、本番投入済み)

### bot ドキュメント同期 4 件 (2026-07-13、ticket #89)

- **内容**: 2026-07-13 bot 全体レビューで検出したドキュメントの実装乖離 4 件を同期 (コード変更なし・docs のみ・restart 不要)
  - (1) `README.md`: Discord 時代 (DISCORD_TOKEN / Developer Portal / NOTIFY_CHANNEL_ID) のまま凍結 → Telegram + モノレポ実態に全面更新。env キーは実装から列挙 (TELEGRAM_BOT_TOKEN / OWNER_ID / NOTIFY_CHAT_ID / BOT_THREAD_ID_* / CLAUDE_* 必須 + budget・PROACTIVE 系任意)、BotFather / supergroup 構築は `docs/telegram-setup.md` への参照に委譲
  - (2) `CLAUDE.md` git 節: 独立 repo 前提 (`companion-bot.git` remote 記載) → モノレポ運用に修正 (repo root = `~/companion/`、パス明示 add、push は OWNER 1 コマンド、gitleaks はモノレポ hook 1 本。正は上位 `~/companion/CLAUDE.md` への参照)
  - (3) `.claude/rules/claude-runner.md`: ClaudeOptions フィールド列挙に `output_format` / `permission_mode` / `model` が欠落 → 実装 (claude_runner.py の 7 フィールド + 既定値 + session_id/resume_session 相互排他) と同期、`to_cli_args()` の組む CLI フラグも 6 種に更新
  - (4) `.claude/rules/bot-py.md`: `/remind` (2026-06-28 実装、commit `cc1734d`) が機能索引から漏れ → 節を追記 (claude 非経由の bot 内完結タイマー / `sessions/reminders.json` atomic 保存 / 再起動時再スケジュール / proactive の remind 分岐とは別物の注記)
- **検証**: 全記述を実物 (bot.py / claude_runner.py / companion-bot.service / .env キー構成 / telegram-setup.md) に照合してから記載

### 関心 index に claude 産の派生関心の登録を認める = §F 線引き更新 (2026-07-13、ticket #96)

- **内容**: interests.py の封鎖「topic/source の出どころは実活動由来のみ、claude に生成判断を持たせない」を **1 例外だけ**緩める (OWNER 2026-07-13 線引き承認) — 実際にやった調査の中で派生した関心 (「○○を調べてたら△△が引っかかった」) は実活動由来と見なし、investigate 分岐の ephemeral claude が `[[interest: 話題 | 出どころ]]` marker で index に自己登録できる。bot が marker を剥がして `source="derived"` + `origin=調べたノート名/URL` で登録。調査→派生関心→次の調査 (derived thread は state=active なので should_investigate の候補になる) の自己ループが回り、index が初めて claude 自身の関心を含む (2026-07-13 bot 全体レビュー・自律の心臓部、#93 思考ログ自由記述化とセット)
- **捏造との区別 (§F 両立)**: 出どころフィールドは marker 形式 (`_INTEREST_RE`) で**必須** — `|` 区切りの 2 フィールドがどちらも非空でなければ非マッチ = 登録しない (fail-closed、#92/#93 の malformed marker と同じ「そのまま残す」挙動)。指示 `PROACTIVE_DERIVED_INTEREST_INSTRUCTION` は investigate prompt だけに追加 (調査をしない ticket/remind/talk には出さない = 例外を 1 分岐に閉じる)。「調査で実際に出てこなかった話題をでっち上げて書かない。無ければこの行は書かない」を明示
- **増殖抑制**: 1 発火 1 件 (marker は 1 行だけ) + 既存 MAX_THREADS=5 押し出し + 既存 decay TTL のみ。新しい上限機構・条件分岐は足さない (2 周目ルール整合)
- **設計**: 純関数 `split_investigate_markers` = #92/#93 の「最終非空行のみ」を 2 marker に一般化 — 末尾の非空行から一致行 ([[thought]] / [[interest]]) を剥がし非一致行で止める。**順不同許容**は LLM が指示した並びを守らなくても marker 行を Telegram 本文に漏らさないため (同種複数は末尾に近いものを採用)。`interests.touch_thread` に `origin` 引数追加 (非 None のときだけキーを立てる、None は既存 origin を保持 = 後続 touch が来歴を消さない)。`record_investigate` は derived touch を researched touch より**先**に適用 = 派生 topic が調査対象と同一でも最終 state は researched が勝ち、同一 topic を調べ続ける再活性化ループを条件分岐なしで構造的に防ぐ。派生 topic が**別の researched 済み thread** と一致した場合の再活性化 (A→B 派生・B→A 派生の交互再調査が理論上回る) は**意図的仕様として許容** — 実調査で再度引っかかった = また気になったの正当な表現であり、interval (7 日) + 出どころ必須 + decay で自然減衰する (code-reviewer 軽微指摘の明文化)。観察行に「調べる中で ○○ が引っかかった (出どころ: ...)」を機械観察として連結 (スキーマ timestamp + observation 不変)
- **配線**: `_run_proactive_investigate` の `split_thought` を `split_investigate_markers` に置換、derived を record_investigate に渡すのみ。ticket/remind は `split_thought` のまま不変。ledger スキーマ・interval 消費モデル・応答経路・settings 不変
- **付随**: interests.py モジュール docstring の線引き記述を更新 (#93 レビュー軽微 (a) の「機械的な観察を 1 行追記」旧記述もあわせて解消)。persona/docs/STATUS.md 軸 4 拡張 機構 1 に「線引き更新」paragraph を記録 (チケット指定要件)
- **検証**: `SplitInvestigateMarkersTest` 11 件 / `DerivedInterestPromptTest` 2 件 / `TouchThreadTest` origin 3 件 / record_investigate derived 2 件 (登録 + 同一 topic は researched 勝ち) / 配線 1 件 (marker 剥がし送信 + index 登録 + 観察行) を追加、`venv/bin/python -m unittest discover -s tests` 353→372 件全 PASS
- **レビュー (code-reviewer、commit 前)**: 修正必須なし。軽微 3 件は全て本エントリまでに反映済み — (a) `_INTEREST_RE` capture 先頭 1 文字が区切り文字制約を抜ける穴 → 文字クラスで塞ぎ + 回帰テスト 1 件 (b) 派生 topic が別 researched thread と一致した場合の再活性化 → 意図的仕様として上記に明文化 (c) `build_investigate_prompt` docstring の「捏造トピックは入らない」が #96 後は不正確 → 派生関心を含む旨に更新
- **反映**: bot commit `9646168`、restart 済み (2026-07-13 17:09:36、ActiveState=active・新 MainPID 419150・notify socket listening、本番投入済み)。以後の観察点: 実機 investigate 発火時の `[[interest]]` 申告率と、index に `source="derived"` thread が現れて次の investigate 対象に選ばれるか (自己ループの実機初回転)

### 思考ログ companion_thoughts.jsonl の claude 自由記述化 (2026-07-13、ticket #93)

- **内容**: 自律ループ ephemeral 3 分岐 (investigate/ticket/remind) の session 末尾に「今回実際にやったこと・見たことから思ったこと 1〜2 文」を最終行 `[[thought: ...]]` 形式で claude に書かせ、bot が marker を剥がして各 mode の機械観察行に「。」で連結し companion_thoughts.jsonl に追記。「読まれない内面」の中身が初めて claude 産になる (2026-07-13 bot 全体レビュー・自律性 3 位、persona STATUS 軸 4 拡張 (1) の後続)。出どころが実活動 (今やった調査・起票・振り返り) に限定されるので §F (でっち上げ禁止) と両立 — 機械観察 (事実 anchor) を残したまま連結するので出どころが行内に残る
- **設計 (#92 と完全対称)**: 共通指示定数 `PROACTIVE_THOUGHT_INSTRUCTION` を 3 prompt 末尾に追加 (「感情の演技・無関係な話題は書かない」「内部連絡でユーザーには届かない」「黙って終える回もこの 1 行だけは添えてよい」)。純関数 `split_thought` は `split_next_self_hours` と同構造 — 最終非空行のみ判定 (全文走査しない、1 回で確定)・IGNORECASE (大文字揺れの Telegram 漏れ防止)。capture は `(\S.*?)` = 空白のみの `[[thought: ]]` を thought=" " と誤認しない (形式不一致は #92 の malformed marker と同じく「そのまま残す」)。record_* 3 関数に `thought: str | None = None` を追加、truthy なら連結 (思考ログのスキーマ timestamp + observation は不変)
- **配線**: 各 `_run_proactive_*` で `run_*` 直後に分離してから record に渡す。empty 判定・send_text・ledger `output_len` は分離後の本文 (marker 行は Telegram に流さない)。record は skip return より先に呼ぶので、本文空 + thought のみの沈黙回 (#91 沈黙権 / 「実体が無ければ空」と合成) でも thought は思考ログに残る = 意図した挙動。talk モードは対象外 ([[next]] marker と競合させない)。ledger スキーマ・interval 消費モデル (成否問わず 1 回) は不変
- **検証**: `SplitThoughtTest` 8 件 / `ProactiveThoughtPromptTest` 2 件 (3 prompt への指示文言 + talk 非対象) / record 連結 6 件 (3 mode × thought あり・なし) / 配線 2 件 (marker 剥がし送信 + 思考ログ連結、marker のみ沈黙回の skip + 記録) を追加、`venv/bin/python -m unittest discover -s tests` 335→353 件全 PASS
- **レビュー (code-reviewer、commit 後)**: 修正必須なし。セキュリティは差分外まで実見 — 思考ログは `remote/server/thoughts.py` 経由で PWA に配信されるが、クライアント `remote/web/app.js` は `textContent` 挿入で XSS 経路なし、jsonl は `json.dumps` エスケープで改行注入不可。軽微提案 2 (いずれも対応不要判定): (a) `interests.py` モジュール docstring 11 行目「機械的な観察を 1 行追記」が旧記述のまま (`append_thought` 側のみ更新済み) — 次回同ファイルを触るときに揃える (b) thought 長は無制限 (プロンプト指示のみ) だが逸脱してもログ肥大どまり・PWA は pre-wrap で安全劣化のため観察点で足りる
- **反映**: restart 済み (2026-07-13 15:05、active 確認、本番投入済み)。以後の観察点: companion_thoughts.jsonl の観察行に「。」連結の自由記述が現れる頻度 (thought 申告の定着度)

### proactive self-schedule = 次回発話タイミングの自己申告 (2026-07-13、ticket #92)

- **内容**: talk モードの発話回の最後に「次に自分から話したくなるのは何時間後か」を claude に最終行 `[[next: 12h]]` 形式で申告させ、bot が marker を剥がして共有 state (`maintenance/.state/proactive`) に `next_self_at=<epoch>` を保存。script (proactive-companion.sh) の step7 はこのキーを 1 read し、あれば**確率ロールを置換**する — 未来なら skip (claude の意図した静けさを乱数で破らない)、期限到来なら roll なしで発火。「不在の波」の決定主体が乱数から claude の意図に移る (軸 4 拡張「タイミングも自分で決める」の実体化、2026-07-13 bot 全体レビュー・自律性 2 位)
- **チケットの「置換/変調」は置換を採用**: 申告がある限り乱数は最終ロールごと不要になり (決定主体の移譲が完全)、gate 1〜6 (時間帯 / snooze / 沈黙 4h / 週上限 8 / 種) は不変なので鬱陶しさの安全弁はそのまま残る。キー無し / parse 不能 (非整数) は従来の活性度変調ロールへフォールバック = bootstrap-safe。script は state 1 read・乱数増なしのまま (2 周目ルール派生原則と両立、チケット指定要件)
- **消費モデル (1 申告 = 1 発火)**: script が handoff 成功時の書き戻しで `next_self_at` を**意図的に書かない** = 消費。次の申告は次の talk 発話回に claude が改めて出す。handoff 後に bot が talk 以外 (investigate/ticket/remind、申告なし) を選んだ場合や claude が申告を出さなかった場合、翌 tick は確率パスに倒れるだけ (欠落 = 従来挙動の 1 状態に正規化)。race も構造的に無し: 消費 (handoff 直後 ms オーダー) → 新申告 (claude 実行後の数十秒後) の順序が保証される (code-reviewer 確認)
- **bot 側の境界**: 申告は 1〜72h にクランプ (下限は沈黙ゲート 4h が支配するので実質飾り、上限 72h = 相方が 3 日を超えて自主的に消えるのは /snooze の領分)。marker は最終非空行のみ判定 (全文走査しない)・IGNORECASE (大文字揺れが本文として Telegram に漏れる破れ道を塞ぐ、code-reviewer 指摘)。本文なし + 申告のみの回 = 「今は黙るが次はこの頃」が成立し既存 empty_output skip に落ちる (#91 沈黙権と合成)。`PROACTIVE_SELF_SCHEDULE_ENABLED` (default 1) で off 可 — off でも marker 剥がしは維持 (--resume 履歴の自己強化対策)、state 書き込みだけ止める。**注意: ledger の `next_self_hours` は off 時は未クランプ生値の記録のみで state 未書き込み = 「ledger に値あり」≠「state に書いた」** (code-reviewer 指摘の読み違え防止)
- **state 書き込みの一般化**: `write_snooze_until` を `_write_state_values` (総なめ保持) に一般化し `write_next_self_at` と共用。state に届く値は固定キー + `str(int(...))` のみで改行注入不可、script 側も `^[0-9]+$` で再検証の二重壁
- **script のテスト容易性**: パス定数 7 個 (STATE_FILE / LOG / SOCK / SESSIONS_DIR / VAULT_NOTES_DIR / MORNING_REPORT / INTERESTS_INDEX / BOT_DIR) を env override 可に (本番は未設定 = 既定パス不変)。sandbox ドライラン 6 ケース (future skip / due roll なし発火 / キー無し確率パス / P=0 確率 skip / 実 Unix socket handoff で消費 + 他キー保持 + payload 到達 / ゴミ値 fallback) 全 PASS
- **検証**: `SplitNextSelfHoursTest` 9 件 / `ProactiveSelfScheduleTest` 5 件 (marker 剥がし送信・沈黙+申告・クランプ・off 境界) / prompt toggle 1 件 / `write_next_self_at` 総なめ保持 1 件を追加、`venv/bin/python -m unittest discover -s tests` 319→335 件全 PASS。code-reviewer 修正必須なし (軽微 2 件 = IGNORECASE + ledger 注記、本エントリまでに反映済み)
- **反映**: service restart 実施済み (2026-07-13 12:32:26、ActiveState=active・新 MainPID 406757・journal クリーン) = 本番投入済み。script 側は timer 発火ごとに新版を読むため restart 不要。以後の観察点: proactive_ledger の `next_self_hours` 出現率 (申告の定着度) と proactive-companion.log の `self-schedule not due` / `eff_p=self-schedule` 行
- **フォローアップ (同日、OWNER 依頼)**: 申告の判断を思考ログ (companion_thoughts.jsonl) の観察行にも残す — `record_proactive_interest` に `next_self_hours` を渡し「次に話したくなるのは約 N 時間後と申告した」を既存の観察 1 行に連結 (resume 時に自分のリズムを読み返せる材料。構造化データの正は ledger、思考ログは内省の写し)。沈黙回 (empty_output) は record 非到達 = 従来どおり index/思考ログとも非記録 (申告は ledger と state にのみ残る)。toggle off 時は clamp なし生値が写る非対称は ledger と同挙動で許容 (テストで固定、code-reviewer 軽微指摘)。335 tests pass、restart 済み

### proactive talk モードに沈黙権 (2026-07-13、ticket #91)

- **内容**: investigate/ticket/remind の「実体が無ければ何も返さない」と対称に、talk にも「話す材料が薄ければ空を返して黙ってよい」を prompt で許可 (§F でっち上げ禁止の延長)。`PROACTIVE_SCENE_PROMPT` に沈黙許可 1 文を追加し、`build_proactive_prompt` の結び行「では、相方として軽く一言、話しかけて。」も沈黙と矛盾しないよう「(話す材料が薄ければ、何も返さず黙って終えていい)」を併記。ledger 46 件全 sent:true = 沈黙判断が未行使だった状態の是正 (2026-07-13 bot 全体レビュー・自律性 1 位)
- **機構は不変 (prompt only)**: 空出力の受け皿は `_run_proactive` の既存 `empty_output` skip 経路 (sent:false + ledger) をそのまま使う。新分岐・新 enum・新 env なし。空出力 = 沈黙権行使 or claude エラーの切り分けは bot.log の run_claude 側ログで可能なため、ledger に分類 enum を増やさない (エラー分類 enum は表面化専用の原則)
- **週カウント非対称の扱い (チケット指定の先決事項、許容と確定)**: script 側 `proactive_fire_epochs` は socket handoff 成功時に消費済みで、bot 側沈黙でも払い戻さない。根拠 3 点: (1) investigate/ticket/remind も「claude 起動を決めた時点で interval 消費、成否問わず」の同思想で既に統一されており、handoff 時消費はこれと対称 = 週カウントは「送信数の上限」でなく「claude を起こす発火試行の総量管理」と再定義するのが一貫する (2) 消費を bot 側送信成功時へ移すと queue 滞留中に script が旧カウントで連続発火する race 窓が開く (handoff 時消費が構造的に防いでいる)。bot→script の払い戻し書き込みも共有 state file の競合源 (3) 沈黙で消費が戻らない副作用は「発話がやや減る」方向 = 鬱陶しさ安全弁として安全側。なお同種の非対称がもう 1 つある: 沈黙ターン (空出力・rc=0) も run_claude 内 record_usage (ErrorKind.OK、bot.py:617-618) で #chat の last_prompt_at が更新され、script 側沈黙ゲート (4h) のカウンタもリセットされる — 「発話が減る」同方向の副作用として同枠で許容 (code-reviewer 指摘)。将来、沈黙行使 (reason=empty_output) が高頻度で週枠を食い潰す・発火間隔が体感で倍化する等の実観測が出たら、そのとき週上限値でなく消費タイミングの設計を引き直す
- **検証**: `BuildProactivePromptTest.test_silence_option_always_present` 追加 (場面指示・結び行の両方に沈黙許可が乗ること)、`venv/bin/python -m unittest discover -s tests` 318→319 件全 PASS
- **反映**: service restart 実施済み (2026-07-13 12:09、ActiveState=active・新 MainPID 確認) = 本番投入済み。以後は proactive_ledger の reason=empty_output 出現 = 沈黙権行使の観察点

### session_id 照合 warning を claude_runner に実装 (2026-07-13、ticket #87)

- **内容**: 2026-05-14 T-0 の Watch 項目 (本 STATUS 下方「Watch 項目」参照) の実装。`claude_runner._warn_if_session_id_mismatch(options, result)` 新設、`run_discord` の return 直前で呼ぶ。要求 uuid (`options.session_id or options.resume_session`) と JSON 返却 `result.session_id` が**両方非 None かつ不一致**のときだけ `logger.warning` (文言に requested / returned 両 uuid)。text 出力・JSON parse 失敗・spawn 失敗・timeout 経路は `result.session_id` が None のため沈黙 = 誤発報なし
- **境界 (表面化専用)**: state 補正・リトライは一切しない。sessions JSON が唯一の正で、回復は state を持つ側の責務 (~/companion/CLAUDE.md「エラー分類 enum は表面化専用」/ design.md §3.2)。warning 文言にも「sessions JSON は requested のまま」と明記
- **検知網の効く範囲 (実測/仮定の切り分け)**: 現行 2.1.207 実測では `--resume` の返却 session_id は要求 uuid と同一 (本日実測、`bot-cli-verify-2026-07-13/results/s2b-resume-json.stdout`)、存在しない uuid の `--resume` は rc=1 + stderr で落ちる (S3) ため `ErrorKind.NO_PRIOR_SESSION` 側で表面化する — 7/13 幻セッション障害が実際に発覚した経路もこれ。本 warning が効くのは「CLI が将来、要求と異なる session_id を rc=0 で黙って返す」仕様変更ケース (Watch 項目の本来の懸念)。チケット #87 文言の「今回の障害を一発特定できた」は後者の挙動を仮定した場合の話で、現行 CLI 挙動では NO_PRIOR_SESSION が先に立つ
- **検証**: `test_claude_runner.py` に `WarnIfSessionIdMismatchTest` 5 件追加 (一致 2 形 / 乖離 warning + 両 uuid 含有 / returned None / requested None)、`venv/bin/python -m unittest discover -s tests` 313→318 件全 PASS。code-reviewer 修正必須なし (軽微 2 件 = Watch 項目の実装済み注記 + 実測/仮定切り分け、本エントリで反映)
- **反映**: service restart 実施済み (2026-07-13 10:57、起動 journal クリーン) = 検知網は本番投入済み

### claude CLI 2.1.207 再検証完了 — S1-S5 フル + /usage headless (2026-07-13、ticket #86)

- **背景**: CLI 2.1.149 → 2.1.207 無記録 up (7/13 09:14 実測)。同日の幻セッション障害調査で部分検証済み (--session-id 尊重 / --resume / persist / JSON 出力 / --bare オプトイン維持) の残りを完走
- **検証環境**: CWD `/tmp/bot-cli-verify-2026-07-13/`、env unset 5 件 (design.md §1.6 準拠)、model claude-haiku-4-5 (S5 cost $0.0102085)
- **結果 (2.1.207)**: S1-S5 全シナリオ pass、2.1.145 (5/20 M-7) / 2.1.141 (5/14 T-0) / design.md §1.5 (2.1.138) と完全一致:

  | シナリオ | コマンド | 結果 (2.1.207) | 過去一致 |
  |---|---|---|---|
  | S1 新規 | `--session-id $(uuidgen) "..."` | rc=0、`~/.claude/projects/-tmp-bot-cli-verify-2026-07-13/<uuid>.jsonl` 作成、stdout=`ALPHA` | ✓ |
  | S2 継続 | `--resume <uuid> "..."` | rc=0、直前 ALPHA を想起 = 文脈保持 | ✓ |
  | S3 lost | `--resume <存在しない uuid>` | rc=1、stderr `No conversation found with session ID: <uuid>` | ✓ 完全一致 |
  | S4 in-use | `--session-id <既存uuid>` | rc=1、stderr `Error: Session ID <uuid> is already in use.` | ✓ 完全一致 |
  | S5 json | `--output-format json --session-id <new> "..."` | rc=0、JSON 単一オブジェクト、`session_id` = 要求 uuid 一致 | ✓ + 新キー 2 |

- **encoded-cwd 規則**: `/tmp/bot-cli-verify-2026-07-13` → `-tmp-bot-cli-verify-2026-07-13` ✓ 不変。**新規観察**: projects/<encoded-cwd>/ 配下に `memory/` サブディレクトリが自動作成される (2.1.207 の auto-memory 由来と推定、`<uuid>.jsonl` の配置・命名には非干渉)
- **S5 JSON**: 確定 7 項目 + 2.1.145 までの観察キー (`ttft_ms` 含む) すべて維持 (過去 2 版の保管 JSON とキー照合済み)。stdout トップレベル新規: `time_to_request_ms` / `ttft_stream_ms`。ClaudeResult dataclass への設計影響なし。生データ: `bot/docs/reviews/2026-07-13-cli-2.1.207-S5-stdout.json`
- **`--bare`** (§1.8 #5、N4 監視): オプトインのまま、説明文 2.1.145 と同等 (Minimal mode / CLAUDE_CODE_SIMPLE=1 / OAuth・keychain 非読取)。N4「bot.py は明示的に `--bare` を使わない」継続
- **`/usage` headless** (Step 3-4 /quota 公式併記の前提検証): 引数渡し (`claude -p "/usage"`)・stdin パイプ (bot の `_fetch_official_usage` と同形) とも rc=0 (ウォーム時)、`--output-format json` で `num_turns: 0` / `total_cost_usd: 0` / `is_error: false` を確認 = $0 前提維持。出力は従来の利用率 (session / week 別) に加え「What's contributing to your limits usage?」要因内訳セクションが追加され長文化 (実測 983 字、/quota は既存 summary への append のため合算でも Telegram 4096 字制限内)
- **要観察 (修正はしない)**: コールド 1 発目の stdin 形 `/usage` が 15s で timeout (rc=124、stdout/stderr 空)、timeout 60s に伸ばした直後の再試行は rc=0 で全文出力 = コールドは壊れているのではなく 15〜60s かかる。その後のウォーム 15s 再試行も成功。bot の `_fetch_official_usage` は timeout=15 のため、コールド時に None = /quota の公式併記が欠ける回があり得る (None 時は併記なしで返る graceful degradation、壊れない)。timeout 延伸は「数値だけ動かす」対症療法にあたるため、実機で併記欠落が繰り返し観測されてから設計判断 (~/companion/CLAUDE.md 2 周目ルール)
- 検証 jsonl は `~/.claude/projects/-tmp-bot-cli-verify-2026-07-13/` に残置 (stderr 文言の事後確認用)

### proactive 幻セッション発番の根絶 + モノレポ root trust 設定 (2026-07-13、障害対応)

- **障害**: 7/13 09:21・09:22、#chat (thread 3) への発話に `[claude error: no_prior_session rc=1]` + 生 stderr 626 字がそのまま返る (bot.py:630 の仕様どおりの表面化)。機序: 7/12 10:00 の `/reset` で topic state が消えた後、7/13 09:17 の proactive ticket が送信後の沈黙ゲート touch (`start_or_resume` + `record_usage`) で **claude に一度も渡していない uuid (`6a01ff52`) を state に保存** (幻セッション) → 次のユーザー発話の `--resume` が "No conversation found" で必落。/reset 常用 + proactive がユーザー発話より先に来る、の稀な交差で初発症 (no_prior_session はログ全期間で初出)
- **切り分け**: claude CLI 2.1.149→2.1.207 up (7/13 09:14、無記録 auto-update) は 7 分差の同時刻だが**無関係**と実測で確定 (`--session-id` 尊重 / `--resume` / persist / JSON 出力すべて正常)
- **修正**: `sessions.record_usage_if_exists(chat_id, thread_id)` 新設 (state が無ければ発番せず False)。investigate / ticket / remind の 3 箇所を差し替え、uuid 発番は実際に claude を起動する run_claude 経路 (bot.py:599) のみに一本化。テスト: 旧仕様 (proactive が state 新規作成) を検証していた test_bot.py の 3 assert を新仕様の回帰ガードに更新、test_sessions.py に `RecordUsageIfExistsTest` 2 件追加。`venv/bin/python -m unittest discover -s tests` 313 件全 PASS
- **許容した残余 (対症療法ルールの合理化記録)**: /reset 直後 + 他 topic の last_prompt_at が 4h 超過去 + 複数 mode 同時 due の敵対条件では、touch skip 中に**異 mode が timer 2h 間隔で最大 3 連発**し得る (4h ゲートが進まないため。同一 mode は interval 7 日消費で連発不可)。4 発目の talk が run_claude 経由で正規 state を作り自己回復、週 8 上限 + 確率ロールもあり実害小と判断して許容 (code-reviewer 指摘、修正必須なし)。将来この 3 連発が実観測されたら、ゲートを proactive_ledger.jsonl の送信時刻併用に引き直す (touch 自体を廃せる設計代替として記録)
- **trust 設定 (併発問題)**: CLI 2.1.207 は workspace trust を**モノレポ root (`~/companion`) で判定**し、未 trust のため bot セッションの permissions.allow 35 件 + additionalDirectories (vault) が無視されていた (stderr の "Ignoring N permissions.allow entries" 警告を実測)。`~/.claude.json` の `projects["/home/miho/companion"].hasTrustDialogAccepted` を true に変更 (バックアップ `~/.claude.json.bak-20260713-trust`)、設定後の同条件実行で警告消滅を確認。クローズ済 #40 (WebSearch/vault Read が承認待ちのまま通らない) の真因もこれだった可能性が高い
- **起票**: #86 (CLI 2.1.207 再検証の残り: S1-S5 フル + `/usage` headless + 存在しない uuid 文言 + encoded-cwd)、#87 (JSON 返却 session_id と要求 uuid の照合 warning = 本 STATUS L938 Watch 項目の実装。今回の障害はこの検知網があれば一発特定だった)

### memo cleanup の Telegram 削除失敗 → retention 36h 化 (2026-07-15、ticket #109)

**症状**: memo cleanup job の `delete_message` が `BadRequest: Message can't be deleted` で毎時失敗し、48h 超のメモ (msg 1017/1018、07-11 保存) が topic に残り続けた (初回失敗 07-13 02:46 = 48h 経過直後の初回試行から全滅)。vault/notes/ 側の保存は無事。

- **調査 (実測 2 段)**: (1) `getChatMember` 実測で bot は administrator だが **can_delete_messages=False** — #84 セットアップ記録 (L331「can_delete_messages 付与」) と食い違い、実際には付与されていなかった。07-15 に OWNER が再付与し True を実測。(2) **付与後も 48h 超の削除は失敗**。48h 以内の OWNER メッセージ (message link で id 確定した実弾テスト) は削除成功 → **実挙動確定: can_delete_messages 管理者権限があっても、投稿から 48h を超えた他ユーザーのメッセージは bot からは削除できない**。公式 docs の「If the bot has can_delete_messages administrator right in a supergroup, it can delete any message there」は実挙動と食い違う (L328 の設計前提を反証)
- **構造的な詰み**: 旧設計「48h ちょうど待ってから消す」は、実挙動では**最初の試行が必ず 48h 超 = 権限があっても必ず失敗する**構造だった (権限付与漏れとは独立の欠陥)
- **対処**: `MEMO_RETENTION_S` 48h → **36h** (OWNER 裁定 2026-07-15)。編集ウィンドウの活用は 36h ぶんに縮小、cleanup 周期 1h + 余裕を見ても 48h 窓内に収まる。48h 前提のコメント / docstring を実挙動へ全訂正
- **検証**: 384→385 tests pass。ガードテスト新設 `test_retention_within_telegram_delete_window` (retention + 2 周期 < 48h を固定 — 将来 48h へ戻す変更を弾く)。テスト名 `test_over_48h_*` → `test_over_retention_*` にリネーム。code-reviewer 修正必須 1 件 (本 STATUS の 48h 前提訂正 = 本エントリ) + 軽微 2 件、全て反映
- **残骸**: msg 1017/1018 は既に 48h 超で bot からは削除不能。OWNER が Telegram クライアントから手動削除 (人間の管理者削除に 48h 制限はない) するか、07-18 の 7 日 purge で state から自然消滅 (それまで毎時 `memo cleanup delete failed` warning が出るのは既存設計どおりの許容挙動)。調査中に別 topic の bot 送信 1 通 (msg 1105) を N-1 推定ミスで誤削除 — bot 自身の通知メッセージのため実害なし、以後の特定は message link 方式に切替済み
- **restart 済み** (11:25、起動クリーン、本番投入済み)

### 個人メモ捕獲 topic 新設 (2026-07-11、ticket #84)

**目的**: Telegram supergroup に個人メモ専用 topic を新設し、鍵垢ツイートのような個人情報込みメモを投げて保存する。生テキスト投稿を claude セッション無し (コスト 0) で bot.py が直接 `vault/notes/` に日付ファイル保存し、見返しはメイン機 Obsidian 側。topic には直近 48h 分だけ残す (2026-07-11 チケット設計改訂: 即時削除でなく Telegram のユーザー編集ウィンドウ 48h を丸ごと活かす)。

- **変更**: bot.py に memo セクション追加 — `_save_memo` (`YYYY-MM-DD_memo-<message_id>.md`、umask + 明示 chmod で 0o600、ack は `set_message_reaction` 👌 best-effort) / `on_memo_edited` (edited_message → 保存済みノート上書き同期、frontmatter に edited 追記、notes/ 境界の resolve 検証付き) / `memo_cleanup_job` (1h 間隔 + 起動 60s 後、48h 超を `delete_message`)。message_id→ファイル対応は `sessions/memo_state.json` (atomic replace、0o600、bot が保存したメッセージのみ削除・同期対象)
- **edited_message の受信**: `allowed_updates` を `["message", "edited_message"]` に拡張。従来の「edited_message 物理取りこぼし (§4.5 / N-T7)」は memo topic のみ例外化 — 既存ハンドラ群は `~UpdateType.EDITED_MESSAGE` filter 済みのため挙動不変、他 topic の編集は `on_memo_edited` 内 thread 判定で無視
- **cleanup は突合型 (チケット要件)**: 削除失敗は個別検知せず次周期で自然再試行。7 日超は最後に 1 回試行して state から purge (打ち切りは saved_at = state を持つ側だけで確定、失敗文言マッチ分岐なし = 2 周目ルール準拠)。vault のノート自体は消さない。**前提: bot に supergroup の can_delete_messages 管理者権限** (Bot API 公式 doc 2026-07-11 確認: この権限があれば 48h 超・他ユーザーのメッセージも削除可) **← この括弧内は 2026-07-15 #109 の実測で反証済み。実挙動は権限があっても 48h 超は削除不可。下記 #109 セクション参照**
- **K-T1 判定 (BOT_THREAD_ID_* 5 個目の再点検 trigger 該当)**: `BOT_THREAD_ID_MEMO` で env 5 個目に到達。点検の結論 = **設計引き直し不要、topic ↔ 機能 1:1 マッピングの素直な追加として許容**。根拠: (1) OWNER 起票の新機能の構成パラメータであり対症療法 (条件の積み増し) ではない、(2) K-T1 が警戒する forward 経路の prefix マッチ / claude 経路の分岐増殖には一切触れず、既存経路への追加は on_message / on_photo の各 1 分岐のみ、(3) 実質稼働 topic は CHAT / RESEARCH / MAINTENANCE / MEMO の 4 つ (VOICE_LOG は空 = Phase 4 送りのまま)。**次の 6 個目が来たら env 個別変数 → 宣言的 topic ルーティングテーブルへの引き直しを議論する** (この行が trigger)
- **検証**: 311 tests pass (memo 16 追加: 純関数 11 + state roundtrip 4 相当 + cleanup job async 3 = MemoNoteFilename / BuildMemoNote / SelectMemoCleanup / MemoStateRoundtrip / MemoCleanupJob)。code-reviewer 修正必須 1 件反映 — cleanup 書き戻しの lost-update (delete await 中の新規保存が消える) → 書き戻し直前に再ロードして処理済み key のみ pop、回帰テスト付き。再レビュー全項目 OK
- **commit**: `0e85b67`。**セットアップ完了 (2026-07-11 01:45)**: memo topic 作成 (thread_id **1013**、旧コード稼働中の初回「test memo」が作った session ファイル `-1003851931893_1013.json` から特定 — この初回分はメモ未保存・削除対象外、session ファイルは無害な残置)、`.env` に `BOT_THREAD_ID_MEMO=1013` 追記、can_delete_messages 付与 (OWNER 操作)、service restart (journal クリーン)
- **実弾確認 (2026-07-11 01:47)**: メモ投稿 → `memo_state.json` に message_id 1017 登録 + `vault/notes/2026-07-11_memo-1017.md` 生成 (0o600) を実測。**残り観察**: 編集同期の実機確認 / 48h+1h 後に topic からメッセージが消えるか (can_delete_messages の実効確認、失敗時は bot.log に `memo cleanup delete failed` が 1h おきに出る) **← 削除は実際に失敗し続けた → #109 で原因確定・retention 36h 化 (下記セクション)**

### bot モデルを Sonnet 5 へ移行 (2026-07-06、todo#64 調査からの派生)

- `claude_runner.ClaudeOptions.model` を `claude-sonnet-4-6` → `claude-sonnet-5` (1 行変更のみ。UQ-10 の「Sonnet 固定・/model コマンドなし」方針は維持、参照先 questions.md L333 は回答アーカイブのため非改稿)
- **事前評価 (手元 workspace セッションで実測)**: CLI が model id を受理 / 4.6 で作成したセッションを `--model claude-sonnet-5 --resume` で継続でき文脈保持も確認 (既存 topic セッションはそのまま移行) / persona 口調 A/B 3 本 (雑談・技術質問・相談) を OWNER が比較して問題なし判定
- **effort はデフォルト維持 (OWNER 判断)**: bot の用途は単純指示が主で adaptive thinking がほぼ発火しないため。実測でも雑談は output 80→98 tok とほぼ同等、複雑質問のみ thinking 由来で 2〜3 倍 (607→1257 / 300→1029 tok)。#64 (effort ルーティング見送り) の判断と整合
- 新トークナイザで同一テキストのトークン数が約 +30% (単価は 4.6 と同額、Max quota 消費は微増方向)。budget guard は requests_count ベースでモデル非依存、波及なし
- 295 tests pass (ただし tests は model 値を assert していないため、実質の検証は上記 CLI 実測)。code-reviewer 修正必須なし

### /remind コマンド追加 (2026-06-28、Step 4-1、C-4)

**目的**: `/remind 30m 洗濯物` で指定時間後にリマインダを送信。claude を介さない (コスト 0)。

- **変更**: bot.py に duration パーサ (`parse_remind_duration`)、JSON 永続化 (`sessions/reminders.json`、atomic write)、list/cancel サブコマンド、JobQueue 連携 (`_remind_fire`)、post_init 再スケジュールを追加。テスト 8 ケース追加 (全 295+8=303 pass)
- **commit**: `cc1734d`。restart・push とも反映済み（2026-07-06 確認: origin/main 一致、service 起動 2026-07-06 22:38 が全 commit より後）

### /quota に公式利用率併記 (2026-06-28、Step 3-4、todo#43)

**目的**: `/quota` 実行時に `claude -p "/usage"` を subprocess で叩き、Anthropic サーバ側の公式プラン利用率 (5h セッション窓 / 週次窓の % と reset 時刻) を自前 ledger 集計の下に併記する。自前 = bot 経由のみ / 公式 = アカウント全体 (手元セッション込み) の違いを表示文言で明示。

- **変更**: bot.py に `_fetch_official_usage()` async 関数追加 (env クリーニング + 15s timeout + rc 判定で None/テキスト返却)。`slash_quota` で結果を末尾に追加。parse せず全文転記 (文言マッチ分岐をしない = 2 周目ルール整合)。取得失敗時は「公式利用率: 取得失敗」の 1 行のみ
- **検証**: 286 tests pass (FetchOfficialUsageTest 4 ケース追加: 成功/非0rc/timeout/空出力)
- **commit**: `05064d9`。restart・push とも反映済み（2026-07-06 確認、上記 cc1734d と同根拠）

### /status セッション肥大可視化 + vault_hint ガード (2026-06-28、Step 3-3 + C-5、todo#42 + todo#45)

**目的**: Step 3-3 = `/status` に直近呼び出しの `cache_read_input_tokens` を表示し、150k 超で `/reset` ヒントを出す (セッション肥大の可視化)。C-5 = `build_proactive_prompt` の `vault_hint` 展開に `isinstance(str)` ガードを追加し `dormant_hint` と対称にする。

- **変更**: bot.py に `cmd_status` で `quota.last_usage_for_topic` を参照して cache_read 表示 + 150k 超ヒント。quota.py に `last_usage_for_topic` 関数追加。vault_hint の `if vault_hint:` → `if isinstance(vault_hint, str) and vault_hint:`
- **検証**: 282 tests pass (CmdStatusTest 3 + VaultHintGuardTest 1)
- **commit**: `c9caaa8`。restart 済み (20:10 JST)、push 済み（2026-07-06 確認: origin/main 一致）

### permission_mode デフォルト修正 (2026-06-28、todo#40)

**目的**: `claude_runner.py` の `ClaudeOptions.permission_mode` デフォルト値 `"default"` が、`claude -p` (非対話モード) で `bot-workspace/.claude/settings.json` の `permissions.allow` リストを無効化していた。`"auto"` に変更することで allow/deny リストが正常に適用される。

- **変更**: `claude_runner.py` L45 `permission_mode: str = "default"` → `permission_mode: str = "auto"` (1 行)
- **deny リストへの影響なし**: auto モードでも `permissions.deny` は常に適用。`.env` / `.ssh` / 破壊的 git 操作等の拒否境界は維持
- **検証**: 278 tests pass (`venv/bin/python -m unittest discover -s tests`)
- **commit**: `b82ac8b`、restart 反映済み、Telegram 経由で実機確認 OK (WebSearch の permission denied 解消)
- **push**: user 側で実施

### 前景降格ガード (2026-06-19、persona 軸 4 拡張 (6)、restart + push 待ち)

**目的**: persona STATUS「軸 4 拡張: 不在と勝手さ」機構 3 の安全弁 = 不可逆/外向きの操作 (tweet/メール/vault push/notes 外書き込み/maintenance 変更/設定変更) を自律ループ中に「したくなっても」自動実行せず、#chat の報告に「○○やっとこうか?」と 1 行の前景提案として添えるだけにする (実行は OWNER の依頼ループ = 承認に降格)。「握りつぶし (何もしない)」を「対等な語気の前景提案」へ昇華する。新しい自動実行は一切解禁しない。設計確定は persona/docs/STATUS.md 機構 3 (L103-111)。

- **降格ルールの注入 = `PERSONA_SYSTEM_PROMPT` に 1 ブロック追加**: talk/investigate/ticket は全て `append_system_prompt=PERSONA_SYSTEM_PROMPT` 経由でこの定数を共有するため、1 ブロック足せば全モードに効く (モード別配線不要)。語気はタメ口・対等 (軸 1 整合)、「許可をください」ではなく「やっとこうか?」、催促も引き止めもしない投げっぱなし。
- **二重定義の整理**: `PROACTIVE_TICKET_PROMPT` にあった汎用外向き禁止列挙 (tweet/メール/vault push/notes 外書き込み) を降格ルールへ一本化して削除。**タスク固有 allowlist は残す** (ticket = add --by ai のみ・OWNER 不可触・1 件のみ・list で重複 skip / investigate = notes/ のみ・新規作成のみ・上書き禁止・手書きエリア不可触)。`PROACTIVE_INVESTIGATE_PROMPT` は元から汎用列挙を持たず notes/ 固有 allowlist のみのため非変更。
- **ledger 観測 = 静的 marker**: `_run_proactive` の `base` dict に `foreground_proposal: True` を追加。全モードが `base` を継承するので talk/investigate/ticket 全 ledger 行に乗る。意味は「降格ルールが system prompt に載った状態で起動した回 (= 外向き衝動が前景提案に降格される対象だった回)」の静的記録のみ。**提案テキストの有無は機械検知しない** (claude 自由生成の substring マッチ・操作分類 enum 分岐・能動検知を一切作らない = 2 周目ルール / 機構 3「能動検知コードを書かない」遵守)。
- **境界遵守**: 新しい自動実行ゼロ・不可逆/外向き実行は依然 0。新ゲート/新 mode 分岐/新 interval/新送信ルートなし (前景提案は既存の発話/報告経路に 1 行混ざる副次出力)。固定優先順 investigate→ticket→talk・4h 最低間隔・ephemeral session・bot-workspace settings (Write 境界 + tickets.py allowlist) は不変。応答経路 (`run_claude` の #chat 会話パス) も不変。
- **検証**: 247 → **251 tests pass** (`venv/bin/python -m unittest discover -s tests`)。追加 = `test_bot.py` ForegroundDemotionRuleTest 4 (降格キー文言 / 不可逆対象列挙 / ticket プロンプトの汎用禁止重複なし + タスク固有 allowlist 残存 / investigate プロンプトの notes allowlist 残存) + 既存 talk/investigate/ticket の送信成功 test 3 本に `foreground_proposal` marker アサートを 1 行追記。claude 実起動はモック。code-reviewer は本 context で Task 非対応のため diff を直接点検 (修正必須なし: 変更は bot.py + test のみ・ledger は gitignore・settings 不変)。
- **commit**: `ffd9a71` (降格ルール + 二重定義整理 + marker + test、1 語修正「notes/ の外」込み)。gitleaks pre-commit pass。
- **未消化**: **実機の前景提案発火 (#chat に「○○やっとこうか?」が滲む) を成果物で実見待ち** (関心 index に外向き衝動を誘う signal が溜まってから自然待ち)。restart は 2026-06-20 済み・push も済み（2026-07-06 確認: origin/main 一致）。bot.py 改変は非自明 = 様子見観察対象。

### 自律ループ「動く = 共用チケット自発起票」分岐 (2026-06-19、persona 軸 4 拡張 (4) 勝手な実行 B、restart + push 済み)

**目的**: persona STATUS「軸 4 拡張: 不在と勝手さ」機構 3 の B = 実活動由来の signal から「これやっといたら？」と言える具体タスクを勝手に共用チケットへ 1 件起票 → 一言事後報告。チケット起票は可逆・許可済み面 (既存 `tickets.py add --by ai` 枠) なので前景の許可を取りに来ない。investigate (A) に続く「動く」2 つ目の分岐。設計確定は persona/docs/STATUS.md 同 section (機構 3 の B、機構 1 の関心 state、§F でっち上げ禁止)。

- **3 分岐の固定優先順 (investigate → ticket → talk)**: `_run_proactive` の全ゲート通過後、`decide_investigate(now)` → 無ければ `decide_ticket(now)` → 無ければ talk へ、を state 1 read で決定的に確定 (確率でモードを選ばない、2 周目の分岐積み増しを作らない最小形)。各「動く」モードは独立 interval を持ち、due かつ実 signal ありのモードを上から 1 つ拾う。
- **起票判定 (`decide_ticket` / 純関数 `interests.should_ticket`)**: 全部満たすとき発火 — (1) `PROACTIVE_TICKET_ENABLED` (新 env 既定 1) on (2) 関心 index トップレベル `last_ticket` (ISO、`last_investigate` と別キー) から `PROACTIVE_TICKET_INTERVAL_DAYS` (新 env 既定 7) 日以上経過 (3) actionable な active thread が decay 後 1 本以上 (signal 方針 A = 実 signal が無ければ必ず起票しない、index 空・recent_conversation のみなら talk へフォールスルー)。investigate と違い `researched` state は除外しない (調べ終えた thread からも実タスクは出る、起票は調査でない)。
- **起票実行 (`run_ticket` / `build_ticket_prompt`)**: investigate と対称に ephemeral session (新規 uuid・#chat 非汚染・budget_guard 必須) で起動。boundary は allowlist が広い (`tickets.py *`) ため **プロンプトで強制** — (a) `tickets.py add "<text>" --by ai` のみ・1 件まで (b) `list --all`/`show` 読み取り可 (c) `--by user`/`done`/`start`/編集/OWNER (🙋) チケット操作は禁止 (d) 起票前に `list --all` で既存を読み同趣旨があれば skip (重複起票抑止) (e) 起票元は実活動 signal (思考ログ/関心 index/既存チケット) のみ・でっち上げ禁止・無ければ空で返す。起票したら stdout の `#N` を報告に載せ「○○やっといたらと思って #N 起票しといた」式の 1〜3 行を返す。
- **送信・記録・最小間隔の保全**: investigate と同型。報告を #chat (`send_text`) に送り、ephemeral は #chat session を更新しないため **送信後に `sessions.start_or_resume → record_usage` で last_prompt_at を明示更新** (4h 最低間隔の保全)。`record_ticket` は `last_ticket` を now で更新 (claude 起動を決めた時点で確定 = 空報告・budget 拒否でも interval 消費、場当たりリトライを作らない) + 思考ログに機械観察 1 行。**investigate と違い thread state を `researched` にしない** (同 thread から将来別タスクが出る余地を残す、重複は起票前の `list` 内容チェックで抑える)。proactive_ledger に `mode="ticket"` で区別記録。
- **境界遵守**: 自動実行は B (チケット起票) に閉じる。不可逆/外向き (tweet/mail/vault push/notes 外書き込み) は一切やらない。応答経路 (`run_claude` の #chat 会話パス) は完全に不変 — ticket は別ヘルパで本体を触らない。settings (allowlist/Write 境界) は変えない (機構 3「ask ゲート再設計不要」)。夜間沈黙・`/snooze`・1〜3 行・催促禁止は既存ゲート通過後に分岐するので自動整合。判定は index を 1 回引いて確定 (2 周目ルール非該当)。
- **検証**: 226 → **247 tests pass** (`venv/bin/python -m unittest discover -s tests`)。追加 = `test_interests.py` ShouldTicketTest 8 + `test_bot.py` ProactiveTicketTest 7 (固定優先順・ephemeral 起動・送信・index 更新・思考ログ・ledger・last_prompt_at 更新・空 index フォールスルー・budget 拒否 skip だが interval 消費・空報告 skip だが interval 消費・thread state 不変) + BuildTicketPromptTest 6 (boundary 文言 = add --by ai 限定・list 読み取り・重複 skip・OWNER 不可触・1 件のみ・でっち上げ禁止)。既存 talk/investigate class の setUp に `PROACTIVE_TICKET_ENABLED=False` を追加し isolate。claude 実起動はモック。
- **commit**: `6a8a0b7` (should_ticket 純関数) / `b6ceeba` (ticket 分岐配線) / `8af6c88` (.env.example に PROACTIVE_TICKET_* を investigate と対称追記)。signal 源 index/思考ログは現状未生成 = 当面ほぼ発火しない (配管先行・キャラ後のせ)。
- **未消化**: **実機の ticket 発火による共用 TODO 実起票 + #chat 報告の実見待ち** (関心 index に actionable thread が溜まってから = 発火窓 9-22 の確率発火 + interval due + 実 signal の合致を自然待ち、exit code でなく実チケットと報告で確定)。restart + push 済み (2026-06-19)。bot.py 改変は非自明 = 様子見観察対象。
- **付随事故**: 裏取り中に `tickets.py add --help` を誤実行しチケット #33 (`🙋 --help`) を誤起票 → user 承認のうえ `done 33` で解消済み。

### 自律ループ「動く = notes 自己調査」分岐 (2026-06-19、persona 軸 4 拡張 (3) 勝手な実行 A、restart + push 済み)

**目的**: persona STATUS「軸 4 拡張: 不在と勝手さ」機構 3 の A = 関心スレッドを勝手に Web 調査 → vault notes/ 化 → 一言事後報告。現状の proactive は「喋る」しかなかったので、自律ループに「動く」分岐を足す (可逆・低リスク・許可済み面なので前景の許可を取りに来ない = 本物の勝手さ)。設計確定は persona/docs/STATUS.md 同 section (機構 3 の A、機構 1 の関心 state)。

- **分岐は bot 側に置く (proactive-companion.sh は無改変)**: dormant は script 完結の「喋る種」だが investigate は claude ツール (Web + Write) = bot 固有能力。週ローリング予算は「1 発火 = 1 socket = 週カウント 1」で喋る/動くを選んでも自動共有されるので予算機構は不要。よって bot repo のみ 1 commit。
- **動く/喋るの判定 (state 1 回引き、場当たり確率 2 周目を作らない)**: `_run_proactive` の全ゲート (PROACTIVE_ENABLED / snooze / budget の二重防御) 通過後に `decide_investigate(now)` で確定。investigate するのは **全部**満たすとき: (1) `PROACTIVE_INVESTIGATE_ENABLED` (新 env 既定 1) が on (2) 関心 index トップレベル `last_investigate` (ISO) から `PROACTIVE_INVESTIGATE_INTERVAL_DAYS` (新 env 既定 7) 日以上経過 (未設定 = 一度も調査していない = due) (3) topic が `recent_conversation` でなく state が `researched` でない active thread が decay 後に 1 本以上 (freshest = last_touched 降順先頭を選ぶ)。どれか欠ければ従来の「喋る」パスへフォールスルー。判定は純関数 `interests.should_investigate` に切り出し unit-test 可 (file IO は呼び出し側)。
- **investigate 実行 (`run_investigate`)**: budget_guard を必ず通す (M-14 単一 guard 境界)。ただし #chat の会話 session は **resume しない** — 毎回新規 uuid の ephemeral session (`ClaudeOptions(session_id=<new uuid>, append_system_prompt=PERSONA_SYSTEM_PROMPT, timeout_s=CLAUDE_TIMEOUT)` → `runner.run_discord` → `budget_guard.record(topic_key="proactive_investigation", session_id=...)`) で起動し、調査のツール使用ターンで #chat 会話履歴・context を汚さない。`run_claude` (#chat resume 前提) は触らず investigate 専用ヘルパを別に作って core 会話パスを汚さない。`sessions.record_usage` は ephemeral には不要。guard 拒否 / claude エラー / 空報告は talk に fallback せず skip + ledger (この回は「動く」と決めた回、喋りに落とさない)。
- **調査プロンプト**: bot の claude (CWD=bot-workspace、WebSearch/WebFetch/Write(notes/**) allowlist 済み・vault read-guard なし) に多段ツール使用として明示指示 — (1) topic を Web で調べる (2) `~/companion/vault/notes/` に**新規ノートを 1 本書く (必須)**、既存・OWNER 手書きノートを絶対に上書きせず必ず新規作成、機械生成と分かる命名 (`notes/<YYYY-MM-DD>_ren-research-<slug>.md` 等を bot 自身が一意選択) + frontmatter (`source: companion-bot` / `type: auto-research` / `topic` / `created`)、vault 規約は実行時に `~/companion/vault/CLAUDE.md` を読んで従う (3) #chat 用 1〜3 行の事後報告だけ軸 1 口調で返す (「○○調べといた」式、前置き・演技なし)。topic 埋め込みは `str.format` でなく `{{TOPIC}}` 単純置換 (topic の波括弧で KeyError を起こさない)。
- **送信・記録・最小間隔の保全**: 報告を talk と同じ投げ先 (`send_text(NOTIFY_CHAT_ID, BOT_THREAD_ID_CHAT, disable_notification=True)`) に送る。investigate は ephemeral session で #chat session を更新しないため、**報告送信後に `sessions.start_or_resume(#chat) → sessions.record_usage` で last_prompt_at を明示更新** (これを欠くと script 沈黙ゲートの 4h 最低間隔が investigate 後に効かず暴走する。「bot が #chat に喋った」事実の正しい反映でもある)。関心 index は `touch_thread(state="researched")` で対象を記録 (last_touched 更新 + 二度調査回避) し `last_investigate` を now で更新して save。**`last_investigate` の更新は claude 起動を決めた時点で確定** (成否に関わらず interval 消費 = 場当たりリトライを作らない、dormant の handoff 消費と同思想)。思考ログに実活動の機械観察 1 行 (`<topic> について調べて notes に書いた`)。proactive_ledger に `mode="investigate"` / `investigate_topic` / `sent` / `reason` で talk と区別記録。
- **境界遵守**: 書き込みは vault notes/ のみ (bot-workspace settings の Write 境界、新規作成のみ・上書き禁止をプロンプトで強く明示)。不可逆/外向き (tweet/mail/vault push/notes 外書き込み) は一切やらない。応答経路 (`run_claude` の #chat 会話パス) は完全に不変 — investigate は別ヘルパで `run_claude` 本体を触らない。夜間沈黙・`/snooze`・1〜3 行・催促禁止は既存 7 ゲート通過後に分岐するので自動整合 + `PROACTIVE_ENABLED` off / `is_snoozed()` の二重防御も従来位置で効く。判定は index の `last_investigate`/`state` を 1 回引いて確定 (stderr 文言マッチ・確率閾値いじり・フォールバック積み増しをしない、2 周目ルール非該当)。
- **検証**: 212 → **226 tests pass** (`venv/bin/python -m unittest discover -s tests`)。追加 = `test_interests.py` ShouldInvestigateTest 8 (never/interval 未経過/経過 due/パース不能 due/freshest 選択/recent_conversation 除外/researched 除外/researched スキップで次選択/空 index) + `test_bot.py` ProactiveInvestigateTest 5 (分岐成立で ephemeral 起動・送信・index 更新・思考ログ・ledger・#chat last_prompt_at 更新 / disabled フォールスルー / 対象スレッド無しフォールスルー / 空報告 skip だが interval 消費 / run_investigate 内 budget 拒否 skip だが interval 消費) + `_ok_result` helper。既存 `ProactiveInterestWiringTest` は talk パス isolate のため setUp で `PROACTIVE_INVESTIGATE_ENABLED=False` を追加 (test 意図不変、investigate は別 class で検証)。claude 実起動 E2E はしない (budget/実 Web 消費を避け、`runner.run_discord` をモックして分岐・記録・送信・session 更新を検証)。
- **未消化**: restart (`systemctl --user restart companion-bot`) で本番反映。**実機の investigate 発火による notes 新規作成 + #chat 報告の実見待ち** (発火窓 9-22 の確率発火 + interval due の合致を自然待ち、exit code でなく実 notes ファイルと報告で確定)。restart + push 済み (2026-06-19)。bot.py 改変は非自明 = 様子見観察対象。

### 2026-06-16 credit guard 撤去 — 6/15 クレジット枠 pause を受け subscription 消費前提へ戻す

- **背景**: 2026-06-15 に予定されていた `claude -p` / Agent SDK の月次クレジット枠 ($100/月 for Max 5x) 分離が、6/15 当日に Anthropic 公式で **pause** された (support.claude.com「Use the Claude Agent SDK with your Claude plan」原文: "We're pausing the changes... For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits.")。手元 claude code セッションで一次情報を直接取得して確認 (二次情報の Zenn 記事 / vault W25 トレンドノートは「6/15 施行」と誤報のまま)。
- **判断**: 制度が発動しない以上、月次 $100 クレジット枠前提の CreditBudgetGuard は実態とずれる (ledger の `total_cost_usd` は subscription 消費では実課金と一致しない API 換算の理論値)。OWNER 指示「サブスク消費前提に書き換え、credit 枠は跡形なく消す (また方法が決まったら改修)」を受け、コード/設定からは撤去し git 履歴に残す方針。
- **変更**:
  - `quota.py`: `CreditBudgetGuard` 削除、`make_budget_guard()` default を `requests_count` に、`_record_common` から `total_cost_usd` / `modelUsage` 記録を撤去、`_aggregate` から金額集計を撤去、`BudgetSummary` から金額フィールド (`cost_last_5h` / `cost_month` / `monthly_budget_usd`) を削除、`format_summary` から金額行を撤去 (回数 + token 観測のみ)。
  - `bot.py`: budget guard 超過ログの cost 分岐を回数のみに簡素化、ledger の 0o600 コメントを金額非依存に修正。
  - `.env`: `BOT_BUDGET_GUARD=requests_count` / `BOT_REQUESTS_PER_HOUR=20`、`BOT_MONTHLY_CREDIT_USD` 削除。`.env.example` も同様にサブスク前提へ。
  - `tests/test_quota.py`: CreditBudgetGuard 系テストを撤去、ledger に金額が記録されないこと / `/quota` に `$` が出ないことの assert を追加。
- **検証**: `venv/bin/python -m unittest discover -s tests` で **180 件全 pass** (quota 15 件含む)、`py_compile` OK。
- **ledger 既存行**: 過去の `total_cost_usd` 入り行は実データとして残置 (回数 guard は行数のみ参照、改竄しない)。
- **2026-06-16 反映済**: restart で本番切替 (requests_count guard) 完了 (15:42 起動、journal/bot.log に例外なし)、`/quota` 実機確認済み (金額非表示・回数/token のみ)。

### 自発発話への声載せ (2026-06-16、todo#22、commit `612cec4`。restart + push 済み、実機発火観察待ち)

proactive companion messaging が #chat に一言送った直後、同じ一言を TV (VOICEVOX engine) からも声で流す (persona 軸 4「同じ部屋にいる相方」の声版)。設計起点は `voice/docs/STATUS.md` 2026-06-12 entry + persona 軸 4。

- **「生成と再生の分離」= 同期待ちしない呼び出し**: 自発発話は返事を期待しない一方通行で合成を待つ主体がいないため、`_run_proactive` の `send_text` 直後に `_dispatch_proactive_voice` → `asyncio.create_task(_proactive_voice_worker)` で detach。Telegram 送信はブロックせず裏で合成→再生 (warm 46s/cold +17s のレイテンシを UX 要件から外す)。土管は /say と同じ `voice_command.cmd_say` (engine 都度起動→合成→stop、`_say_lock` で /say と直列化済み) を流用。
- **在宅検知は持たない**: proactive の発火窓 9-22 JST (proactive-companion.sh 側ガード) を在宅前提の代用とする。追加ゲートなし。
- **設計判断**: env `PROACTIVE_VOICE_ENABLED` (既定 on、`PROACTIVE_ENABLED` と同パターン) / 長さ MAX_SAY_TEXT(100) 超は音声のみ skip = silent truncate しない (M-8)、Telegram 本文は残す。判定は長さ 1 回・成否は cmd_say の rc 1 回で確定 / fire-and-forget task は `bot_data["proactive_voice_tasks"]` (set) に保持し done callback で discard (GC 対策)、post_shutdown で他 background task と対称回収 (合成中再起動の engine 残留防止、code-reviewer 提案)。
- **ledger 分離**: proactive_ledger に `voice` フィールド (disabled/too_long/dispatched) を記録、**voice_ledger には書かない**。voice_ledger は /say = ユーザー実需 (Phase 4 常駐化 trigger) の集計元であり、自動の自発発話を混ぜると実需を水増しするため (集計の置き場所を分離)。声の rc は logger に出す。
- **検証**: 184 tests pass (`DispatchProactiveVoiceTest` 3 ケース追加 = disabled/too_long/dispatched)。restart 済み (2026-06-16 11:44、`proactive enabled=True` ログ確認) + push 済み。**実機の自発発話発火による声載せ観察のみ未消化** (発火窓 9-22 で確率発火のため自然待ち、違和感あれば OWNER から追報)。

### PLAY_ALLOWED_HOSTS に TVer 追加 (2026-06-12、remote RV-11 ミラー同期)

remote 側 RV-11 (TVer 再生対応、実エピソード 3 本 `-J` 検証済 = DRM 0 / HLS / 無ログイン) に伴う `remote/server/urlguard.py` とのミラー同期。`tver.jp` / `www.tver.jp` を PLAY_ALLOWED_HOSTS に追加 + test_bot.py に canonical ベクタ (受理 2 / 拒否 2 = userinfo 詐称・suffix 偽装) を追加、47 tests pass。remote 側の事前 DL (/api/dl) は TVer を別の門 `normalize_dl` で弾くが、bot に DL 経路はないため再生 allowlist のみが同期対象 (bot.py コメントに明記)。検証・裁定の詳細は `remote/docs/STATUS.md` 2026-06-12 RV-11 エントリと video-design §4.1。restart 不急 (リスト追加のみ、次回 restart で乗る)。

### テストログの本番 bot.log 混入を修正 (2026-06-12、logger 冪等化 + テスト handler 除去。bot.py 変更は挙動不変、次回 restart で乗る)

**発見経緯**: voice bot 統合の restart 後点検で bot.log に「proactive skip」同一行 16 連発 (18:14 / 21:29、各 32 行) を観測。切り分けで (a) 実イベントではなくユニットテスト実行由来 (b) proactive_ledger は tmp patch 済みで汚染なし (c) 21:19 の dormant_knowledge 送信はチケット #20 の正規初実弾、を確認。

- **原因 2 段**: (1) `unittest discover -s tests` は各テストファイルを top-level import し `tests/__init__.py` を実行しない (実測)。(2) test_bot.py の `_import_bot_with_stub_env` が `del sys.modules["bot"]` → 再 import するたび、同一の `companion-bot` logger (getLogger は同一インスタンス) に本番 bot.log 向き RotatingFileHandler が積み増され、Proactive 系テスト実行時点で 16 個 = 1 ログ 16 行に増幅して本番ログへ
- **修正**: bot.py の addHandler を `if not logger.handlers:` で冪等化 (本番挙動不変) + `_import_bot_with_stub_env` で import 直後に handler 除去。`logging.disable` のプロセスグローバル抑制は test_quota の `assertLogs("companion-bot")` を壊すため不採用 (1 度試して fail で検出、handler 除去ならレコードは生きるので assertLogs 無傷)
- **検証**: 179 tests 全 pass + discover 2 連走で bot.log 行数不変。混入済みの過去行は放置 (rotation で消える)
- tests/__init__.py に「discover では実行されない、共通セットアップを置かない」注意書きを残置

### voice bot 統合 (2026-06-12 実装 = Phase 4 残実装系、persona 軸 2 gate 開通。commit までで停止、restart / speaker 切替 / 実弾検証は user 操作)

**目的**: voice-design.md v2.0 §1.8 の bot/ 側統合 (2026-06-01 に Phase 3-2 から Phase 4 移送、persona 軸 2「玄野武宏」確定 = gate 開通で着手可)。Telegram `/say` で TV 発話 + `/status` に voice 集計 + voice_ledger.jsonl。**bot.py 大改変につき restart 後にこの変更への様子見観察を適用** (PROJECT.md 条件 #2 再定義、2 週間固定でなく変更規模相応)。

- **voice_command.py (新規)**: `cmd_say(text) -> (rc, msg)`。engine **on-demand 都度起動** (§1.3) を bot 側に配置 — `systemctl --user start companion-voice-engine.service` → `voice-engine-ready.sh` (30s benign give-up) → `say.sh` (`wait_for 90s`、M-8) → finally で `stop`。start/ready は best-effort (失敗は warning ログのみ)、**成否判定は say.sh の rc 1 回で確定** (リトライ・stderr 分岐なし)。rc 98 = say.sh spawn 不可 / 99 = TIMEOUT は表面化専用。`append_ledger` は `quota.append_ledger` 流用で `sessions/voice_ledger.jsonl` (gitignore 済) に 1 invoke 1 行 (`ts` / `text_prefix` 20 字 / `rc` / `duration_ms`)
  - **設計からの divergence 3 点** (voice-design.md v2.0.3 改版履歴にも記録): (1) engine start/stop は設計では say.sh 内想定だったが bot 側に配置 (検証済み say.sh の合成責務を変えない)。これに伴い設計が否決した asyncio.Lock を追加 — stop が say.sh 内 flock の外に出たため「先行の finally stop が後発の合成中 engine を落とす」競合を直列化で消す (否決時の前提が崩れた、2 周目対症療法ではなく前提変化への追従) (2) voice_ledger.jsonl は設計図の bot/ 直下でなく sessions/ 配下 (quota ledger 慣習優先) (3) Discord 前提 (defer / ephemeral / followup) を Telegram に読み替え (typing chat action = 案 W-silent 相当 / 通常 reply)
  - **engine 常駐 (enable) はしない**: 常駐化 trigger (1 日 5 回超 × 1 週間、voice_ledger 集計) 未達。on-demand の RAM 解放を優先 (3.7Gi 機)
- **voice_status.py (新規)**: `format_voice_summary(now)` — `voice/.state/last-result-{今日,昨日}` (ts 行は 24h フィルタ、padding skipped 行は ts なしのためファイル単位カウント) + voice_ledger から「voice (直近24h): OK n / FAIL n (内訳) / padding skipped n」+ 最終 /say を生成。集計は表面化専用 (判定・分岐に使わない)
- **bot.py**: import 2 行 + `slash_say` (空引数 / 100 字超は警告 reply = silent truncate しない、`_typing_action` で cold start 11-17s 吸収、ledger 追記) + `cmd_status` 末尾に voice 集計 append (try/except で /status 本体保護) + `CommandHandler("say")` + `BotCommand` 追加
- **maintenance 側 (`notify-system-report.sh`)**: 12:00 レポートに voice FAIL ≥ 3 件/24h または padding skipped ≥ 5 件/24h で警告行 (§1.5 (3)。今日+昨日ファイル合算 ≈ 24h、ファイル不在 = 0 件で素通り)。set -euo pipefail 下の 0 件 / 不在 / 閾値発火を単体検証済み
- **say.sh 追記化 (voice repo 側、code-reviewer 修正必須)**: last-result が atomic write (上書き = 日毎最終結果のみ) で 24h 件数集計が構造的に発火不能だったため 1 invoke 1 行追記に変更。設計書自体の内部矛盾 (§1.4 vs §1.5 (3)(4)) の解消。詳細・案 B 不採用根拠は `voice/docs/STATUS.md` 同日 Done
- **テスト**: 166 → **179 件全 pass**。追加 13 = `_format_say_result` 各 rc / `append_ledger` schema / `cmd_say` orchestration (fake systemctl + fake say.sh で start→say→stop 順序、rc passthrough、timeout kill、spawn 失敗でも finally stop) / `format_voice_summary` 6 ケース (空 / OK+FAIL+padding / 24h 境界 / socket 行除外 / ledger last say)
- **code-reviewer**: 修正必須 1 件 (上記 say.sh 追記化) 反映 + 再レビュー OK。軽微採用 2 件 (last-result 書き込みの O_APPEND 1 関数化 / 台帳の atomic write 残置訂正)、軽微見送り 1 件 (`proc.kill()` の SIGTERM 二段化 — 頻度極小 + /tmp 残置は無害、シンプル維持)
- **user 操作 3 点とも完了 (同日)**: (1) `voice/.env` は**未作成だったと判明** (say.sh 内デフォルト 2 で動作していた drift) → user が `VOICE_DEFAULT_SPEAKER=11` で新規作成 (2) restart 済み (21:55、起動ログ正常・/say 登録確認) (3) **V-S1 / V-S2 実弾 pass** (22:13 JST、rc=0 / duration_ms=19726、ledger + last-result + bot.log 全系統一致。`voice/docs/STATUS.md` V-S1/V-S2 entry 参照)。**ここから bot.py 大改変の様子見観察開始**
- **自発発話への声載せはスコープ外**: 「生成と再生の分離」(2026-06-12 確定、voice/docs/STATUS.md) に従う将来タスク。本統合は `/say` 対話経路 + 集計土管まで

### 自発発話の種「死蔵知識との再会」追加 (2026-06-12 実装 = チケット #20、persona 軸 4 実装 (2)、bot.py は小規模追加改変)

**目的**: persona 軸 4「同じ部屋にいる相方」(2026-06-12 OWNER 確定) の種 2 要素目。vault の読み返されない過去ノートを週 1 程度掘り起こし「昔これ気にしてたね」と軽く再会させる低頻度種。返信不要の一方通行声かけと整合 (読み流すだけで価値が出る)。

- **maintenance 側 (`proactive-companion.sh`)**: 判定順 1〜7 (発火条件) は不変、変えたのは §6「種を集める」のみ — 発火確定回の種の中身を週 1 で死蔵知識に切り替え。state の `last_dormant_date` 1 回引きで判定 (差が `PROACTIVE_DORMANT_INTERVAL_DAYS` (デフォルト 7) 以上で due)。候補 = notes 直下 *.md で mtime が `PROACTIVE_DORMANT_MIN_AGE_DAYS` (デフォルト 30) 日より古いもの、前回分 (`dormant_last`) 除外、ランダム 1 件。死蔵回は `seed_kind="dormant_knowledge"` + payload に `dormant_hint` (basename)、**当日 vault_hint は付けない** (1 メッセージ 1 話題)。候補ゼロは従来種で続行 + `last_dormant_date` 非更新 (次回再挑戦、リトライ loop なし)。state 書き戻し (キー明示列挙) に dormant 2 キーを追加、非死蔵回も既存値を保持
- **bot.py**: `build_proactive_prompt` に `dormant_hint` 展開を追加 — str のみ展開 (注入防止境界、docstring の bounded 列挙に追記)、文言は「今日触れていた話題ではなく、昔ユーザーが書いたノートの話題ヒント…『昔これ気にしてたね』くらいの軽い再会のさせ方で一言」(vault_hint の「今日」と文脈区別)。vault_hint と両方来ても両方展開 (分岐で握りつぶさない、script 側は同時に出さない設計)。proactive ledger の base に `dormant_hint` を追加 (vault_hint と対称の観測用)。`seed_kind` は従来どおり prompt に流さない (ledger 専用)
- **テスト**: 161 → **166 件全 pass** (`venv/bin/python -m unittest discover -s tests`)。追加 = parse 透過 1 件 + prompt 展開 4 件 (あり / なし / 非文字列の防御 / vault_hint 併存)。script は sandbox (HOME/XDG_RUNTIME_DIR 隔離 + 偽 sessions/vault + `nc -lU` ダミー socket + PROBABILITY=1) で 8 ケース全パス: (a) state なし + 古ノートあり → dormant 発火 + state 2 キー書込 (b) 昨日使用済み → 従来種 + キー保持 (c) 候補が dormant_last のみ → 従来種 + 非更新 (d) 古ノートゼロ → 従来種 (e) INTERVAL=1 / MIN_AGE=5 override + デフォルト 30 の境界 (f) 5 キー全保持 + count increment。結合確認 = script 実 payload → `parse_proactive_payload` → `build_proactive_prompt` を実 venv で 1 回通し
- bot.py の改変は `build_proactive_prompt` + ledger base の数行 = 小規模追加改変 (大改変の様子見観察の発火対象ではない)。maintenance repo 側 commit と対で適用 (timer unit / 判定順は無変更)

### /play を xdg-open から remote 常駐 mpv (TV) 再生に切り替え (2026-06-12 実装 = ticket #17、commit までで停止、restart は user 操作)

**目的**: `/play` が旧経路 (xdg-open → ブラウザ起動 = 再生後操作不能) のままで、F-video (remote 常駐 mpv + リモコン PWA 操作) と二系統併存していた。user 起票チケット #17 で remote 経路への一本化が確定 (2026-05-20 の据え置き判断は「F-video が実運用に乗るまで」の条件付きで、build 検証完了 + RV-10/RV-9 まで進んだ現在は条件を満たす)。

- **実装**: `cmd_play` の xdg-open subprocess を `remote/server/video.py` (mpv IPC クライアント、verb whitelist 固定テンプレート) の `play()` 呼び出しに置換。video.py は importlib (`_load_remote_video`、`spec_from_file_location`) で読み込み — **HTTP API 経由でなく mpv socket 直 (同一 uid 0o600) なので remote の Bearer token を bot に持ち込まない**。読込失敗 (remote 未配置等) でも bot 起動は止めず、/play 時に連携不可を返す + 起動時 warning log 1 行 (code-reviewer 軽微反映)。blocking socket (connect 2s + IO 5s) は `asyncio.to_thread` で event loop から逃がす
- **認可・allowlist は不変**: OWNER_ID gate + `_normalize_play_url` (PLAY_ALLOWED_HOSTS、remote urlguard とミラー同期済み) を従来どおり通過した URL のみが固定テンプレート `play()` に渡る。mpv socket 直叩きは fs パーミッションが gate する設計 (video-design §3.2) どおりで認可退行なし (code-reviewer セキュリティ OK)
- **設計上限ルール整合**: 旧コードの stderr 文言返し (xdg-open rc/stderr) と timeout 分岐が消え、mpv IPC 構造化応答の 1 回確定に置き換わった。`PLAY_TIMEOUT_S` 削除 (cmd_play のみで使用)
- **応答文言**: 成功 = 「TV で再生を開始します (読み込みに最大1分ほど)」+ PWA への誘導 / mpv unit 停止 = 接続不可 / IPC エラー = 受け付けず。リモコン PWA の Now Playing バーは既存の `GET /api/video/state` ポーリングが mpv state を写像するため bot 側の追加配線なしで連動する
- **テスト**: 34 件 (skip 27) 全 pass。実弾 = bot.py と同じ importlib 経路で本番 mpv に loadfile → playing 到達 → stop を確認 (YouTube 短尺)
- **restart は user 操作待ち** (bot.py はメモリ常駐、反映には bot.service restart)。反映後、数日 NRestarts / ERROR の様子見 (bot.py 改変時の運用どおり)。改変規模は cmd_play 差し替え + import 数行 = 小改変 (大改変の様子見観察の発火対象ではない判断)

### persona 口調の system prompt 配線 + 自発発話の蒸し返し抑止 + silence_hours 展開 (2026-06-11 実装、commit までで停止、restart は user 操作)

**目的**: (1) 口調がすぐ敬語に戻る — persona 軸 1「対等な相方」が通常会話に未配線で、CLAUDE.md の 1 行指示は敬語デフォルトに押し負け、`--resume` 履歴の敬語が自己強化アンカーになる。(2) 自発発話が終わった会話を蒸し返す — 旧 PROACTIVE_PERSONA_PROMPT の「直近の会話の流れに自然につながる一言を」が沈黙 6h+ 発火の設計と自己矛盾。OWNER 承認済みプラン (2026-06-11)。

- **6965cf1 口調配線**: `claude_runner.ClaudeOptions` に `append_system_prompt` フィールド追加 (`to_cli_args()` で `--append-system-prompt` 出力、フラグは `claude -p --help` で実機確認済み)。bot.py に `PERSONA_SYSTEM_PROMPT` (軸 1 確定内容 + **禁止形「です・ます調 (敬語) は使わない」を明示**、装飾 emoji 最小、過度なキャラ付けなし) を追加し、`run_claude` が組む全 ClaudeOptions に常時渡す (全 topic 共通)
- **daef093 proactive 改良**: `PROACTIVE_PERSONA_PROMPT` → `PROACTIVE_SCENE_PROMPT` (場面指示のみ) に痩せさせ、口調定義は system prompt 側に一本化 (二重定義なし)。「流れにつながる一言」を反転 = 直近のやり取りは完結したものとして扱い続き・確認・蒸し返しをしない。`build_proactive_prompt` で payload の `silence_hours` を**非負 int のときだけ**展開 (「最後の会話から約 N 時間経っている。」、bool 除外、欠落/非数値は黙って省略 = フォールバック分岐なし、docstring の注入防止境界に silence_hours 追記)
- **maintenance fe31d49**: `proactive-companion.sh` §4 の `max_last_prompt_epoch` から沈黙時間 (整数時間) を算出し payload に `"silence_hours": <int>` を追加、送信 log にも記録
- **persona/docs/STATUS.md**: 「配線は複数軸揃ってから一括」方針の前倒し変更 (軸 1 のみ、OWNER 承認、声以降は従来方針) を記録
- **テスト**: 151 → **159 件全 pass** (`venv/bin/python -m unittest discover -s tests`)。追加 = `to_cli_args()` の `--append-system-prompt` 出力 3 件 (tests/test_claude_runner.py 新規) + `run_claude` の persona 配線 spy 1 件 + silence_hours 展開 (int あり / 欠落 / 非数値・bool・負値) + 場面指示・口調二重定義なしの検証。結合確認 = script 出力形式 payload → `parse_proactive_payload` → `build_proactive_prompt` を実 venv で 1 回通し、sh は `bash -n` + payload スニペット単体実行で検証
- **restart は user 操作待ち**。反映後、数日 NRestarts / ERROR の様子見 (bot.py 改変時の運用どおり)。proactive の蒸し返し有無・口調維持は次回発火 / 実会話で観察

### bot-workspace allow に apt 照会 2 件追加 (2026-06-11 実装、OWNER 明示依頼)

**経緯**: OWNER が日次システムレポートの「apt 滞留」を bot に質問した際、bot セッションが `apt-mark showhold` / `dpkg --get-selections | grep hold` を実行できず permission denied (bot.log 2026-06-11 12:37、C-2 の permission_denials 記録が初仕事)。手元セッションで評価のうえ OWNER 依頼で追加。

- **追加 (bot-workspace/.claude/settings.json)**: `Bash(apt-mark showhold)` / `Bash(apt list --upgradable)` の **完全一致 2 件のみ**。read-only 照会で sudo 不要、bot は sudo 系 allow を持たないため二重に状態変更不可
- **ワイルドカード意図的回避**: `apt-mark:*` は `apt-mark hold` (状態変更)、`apt:*` は `apt install` を含むため採用しない。最小権限優先
- **完全一致ゆえの denied は仕様**: bot が `apt list --upgradable 2>/dev/null` や `| wc -l` 等の変形を打つと再び denied になるが、これは意図した挙動。再発しても対症療法 2 周目と誤認してワイルドカード化に流れないこと (拡張判断は OWNER + 手元セッション、C-2 の方針どおり)
- **code-reviewer**: OK (修正必須 0)。軽微提案 2 件 (denied は仕様の明文化 / STATUS.md への経緯記録) = 本エントリで両方反映

### ClaudeOptions 未使用フィールド削除 (B-1 完了、2026-06-10 実装、OWNER 承認済み判定 = 全削除)

**目的**: `claude_runner.ClaudeOptions` の未使用 7 フィールド + `to_sdk_kwargs()` を実装するか削るかの判定 (B4-1、2026-05-20 全体レビューで設定)。Phase 3 着手者の混乱コスト削減。

**判定根拠 (OWNER 承認済み: 全削除)**:
- `prompt_prefix` / `prompt_suffix` (cache framing 用、design.md §4.8): prefix なしの実運用 13 日間で **cache hit 率 90.6%** (baseline 30% を大幅超え、B-3 締め実測) — 実装する動機がデータ上消滅
- 他 5 フィールド (`add_dir` / `no_session_persistence` / `disable_slash_commands` / `exclude_dynamic_system_prompt_sections` / `setting_sources`) + `to_sdk_kwargs()` (NotImplementedError スタブ): SDK 移行耐性の先行設置だが bot.py からは `timeout_s` 等コアのみ代入で一切未使用。YAGNI、SDK 移行時に必要になったら再追加する

**実装 (2026-06-10)**:
- **5cddf6e**: 7 フィールド + `to_cli_args()` の対応分岐 + `to_sdk_kwargs()` + クラス docstring の SDK 言及を削除。`_compose_prompt` (prefix/suffix 組み立て専用) も削除し `run_discord` で prompt をそのまま使用
- **8ae9919**: `ClaudeResult.permission_denials` 型注釈を `list[str]` → `list[dict]` に修正 (実体は CLI JSON の dict リスト、C-2 code-reviewer 軽微提案の持ち越し対応)
- 削除前に bot.py / tests/ / quota.py / sessions.py を grep し削除対象への参照ゼロを確認 (bot.py は `ClaudeOptions(timeout_s=...)` のみ、tests/ に対象フィールドのテストなし)
- **テスト**: **151 件全 pass** (`venv/bin/python -m unittest discover -s tests`、件数増減なし)
- claude_runner.py はメモリ常駐 import 対象のため反映は**次回 restart 時** (純削除で挙動変化なしのため専用 restart は不要、次のデプロイ操作に同乗でよい)

### Step 2 bot.py 小改変パック #1: 画像応答 + permission_denials 記録 (C-2 完了、2026-06-10 実装 + restart + 実弾検証 2 件 pass)

**目的**: chat に送った画像を見て返答する機能 + permission deny の観察記録 (bot 改良プラン Step 2、center of truth = `~/companion/workspace/redesign/bot-improvement-plan.md`)。B-3 前倒し締め (同日) でゲート解除して着手。

- **2-1 画像応答** (0dcd926): `on_photo` ハンドラ追加 (`message_filter & filters.PHOTO`、`_authorized` 4 段防御は on_message と同一、caption 付き photo の on_message 二重発火なし = on_message は filters.TEXT 限定)。メンション不要、キャプションあれば prompt 本文・なければデフォルト文。`message.photo[-1]` → `download_to_drive()` で `bot-workspace/incoming/<topic_key>/<ts>_<file_unique_id>.jpg` 保存 (英数 `_.-` 安全化 + timestamp prefix、traversal 不可)。prompt に絶対パス + Read 指示で既存 run_claude 経路 (budget guard 込み) に乗せる。topic ごと最新 10 件超を download 時に prune — ファイル名 timestamp prefix の辞書順 sort 1 回で確定 (mtime 非依存、リトライ・文言マッチなし、2 周目ルール整合)。vault 非接触。document/album/動画は v1 スコープ外
- **2-2 permission_denials 記録** (a28772a): quota.py `_record_common` (ledger 書き込みの単一集約点) で非空時のみ entry に `"permission_denials"` 追加 + `logger.info("permission denied: %s", ...)` で bot.log 記録。空時は key 省略 = 既存 entry schema 非破壊。deny を見て自動 allow する仕組みは作らない (拡張判断は OWNER + 手元セッション)
- **テスト**: 133 → **151 件全 pass** (`venv/bin/python -m unittest discover -s tests`。純関数 16 件 = ファイル名生成/prune 選定/prune 実削除/prompt 組み立て + quota 2 件)
- **code-reviewer**: OK (修正必須 0、認可バイパス経路なし・traversal 不可・2 周目ルール整合を確認)。軽微提案 2 件 — (1) download 失敗時の部分ファイル unlink = **採用** (f0b648a、破損 jpg が世代 1 枠を占有し追い Read で当たる経路を防止) (2) claude_runner.py の `permission_denials: list[str]` 型注釈が実体 (dict のリスト) と乖離 = 差分外につき **B-1 (claude_runner.py 改修) で対応に見送り**
- `bot-workspace/.gitignore` の `incoming/` は登録済み (13c0ac5) で追加 commit 不要
- **実弾検証 (2026-06-10、restart 13:34 後に実施、2 件 pass)**: #chat へキャプションあり/なし各 1 枚 — (1) キャプションあり「このキャラだれ?」→ アクリルスタンド 3 体の名札・髪色に言及し読み切れない部分は自信なしと明示 (2) キャプションなし → デフォルト文発火、内容 (Epic Games Store の Monument Valley 3 無料配布) を認識した返答。incoming/ への保存・ファイル名安全化・ledger 記録 (completed $0.07/$0.06、denials 空 = key 省略) とも設計どおり。11 枚 prune の実弾は省略 (ユニットテスト 8 件で担保、OWNER 了承)
- **残る様子見**: bot.py 改変につき数日の NRestarts / ERROR 監視のみ (K-T12 再定義の運用どおり)

### Telegram 観察締め (B-3 完了、2026-06-10 前倒しクローズ、全項目クリーン)

**目的**: cold cut (2026-05-28) +14 日の Telegram 観察締め (期限 2026-06-11)。K-T13〜K-T16 + axis-5 K-1〜K-19 の実観測再点検。

**前倒し根拠**: 期限 1 日前 (13 日分データ) で全項目クリーン、最終日 1 日の追加情報価値がほぼゼロのため OWNER に前倒しを提案し承認 (2026-06-10、AskUserQuestion)。Phase 2.5 観察打ち切り (14→8 日) と同型だが今回は lead 単独でなく OWNER 承認済み。C-2 (Step 2 画像応答、OWNER 早期要望) のゲート解除が動機。

**実測 (2026-05-28 〜 2026-06-10、13 日間)**:
- **NRestarts=0** (異常再起動ゼロ)。journalctl 上の全 restart は user デプロイ操作 5 回 (5/28×2 / 5/30 / 6/1 / 6/8×3 のうち稼働反映分)、停止はいずれも数秒
- **bot.log ERROR/Traceback 0 件**。WARN 7 件 = 全件 `stall_check_job: get_me() failed (consecutive 1)` の一過性ネットワーク失敗、stall 未発展・自然回復
- **K-T14 (24h 超停止)**: 発生 0 回
- **K-T15 (再起動直後の旧 Update 大量処理)**: 全 restart で flood なし (例: 6/8 14:09 再起動後の次イベントは 6/9 05:30 proactive 通知)
- **ledger 79 呼び出し全件 `terminal_reason=completed`** (timeout 0 = K-10 クリア)、窓内消費 $4.40
- **cache hit 率 90.6%** (cache_read 4.69M / total input 5.18M tokens) — K-4 基準 (baseline 30% 以上) を大幅超え。**B-1 の判定材料が揃った** (副産物、TODO B-1 を着手可能に更新)
- **K-5 (JSON parse 失敗) / K-9 (`_STDERR_PATTERNS` 該当)**: bot.log 該当 0 件 (NO_PRIOR_SESSION / SESSION_ALREADY_IN_USE / parse failed とも grep 0)
- **K-T2 (stale-thread 観察)**: 0 件 (`bot/.state/stale-thread-observations.jsonl` 未作成 = 発生なし)
- **K-13 (月跨ぎ JST 境界)**: 実運用で確認 — ledger 月別集計が分離 (5 月 $3.15 / 6 月 $2.58)、CreditBudgetGuard 月次リセット正常
- **K-T13 (Bot API up 時 allowlist 再点検) / K-T16 (PTB リリース間隔)**: 観察期間中トリガ未発火。運用ルール常設項目として継続 (K-T16 の次チェックは 2026-09 以降)

**継続項目 (B-3 クローズ後も残る、消滅しない)**:
- **K-14**: Anthropic Console vs ledger 差分点検 → TODO **B-4** として分離 (7/1 前後実施)
- **K-15〜K-18** (voice 系): bot/ 側 voice 着手後 (Phase 4 移送済み、`voice/docs/STATUS.md` 側)
- **K-T1〜K-T12**: 期間観察でなく常設運用ルール (本台帳「実装着手後の運用ルール」section、変更なし)

### vault-sync.log rotation 不在調査 (B-2 完了、2026-06-10 実測、対応不要でクローズ)

**目的**: `web/scripts/vault-sync-from-transcript.sh` が書く `~/companion/logs/vault-sync.log` の rotation 不在設計 (年間数 MB 想定、B4-5 観察項目) が実運用で破綻していないか実測で確認する。

**実測 (2026-06-10)**:
- `vault-sync.log`: **101 行 / 6,073 bytes**。記録期間 2026-05-14T16:50 〜 2026-06-05T11:01 (約 22 日間)
- 内訳: commit 成功 (`ok: committed`) **15 回**、`error` / `skip` 行 **0 件** (grep で確認、flock 競合・git 失敗の発生なし)
- 年間換算: 6,073 bytes × (365/22) ≈ **100 KB/年**。設計想定「年間数 MB」の 1/30 以下

**結論**: rotation 不在の意図設計は破綻していない。**対応不要、B-2 クローズ**。ログ出力は commit 発生時のみ (変更なしなら無音 exit) のため、増加は実 commit 数に比例し上限が自然に抑制される構造。

### Step 1 閲覧自由化 (C-1 完了、2026-06-10 実装 + 実弾検証 3 件 pass)

**目的**: bot 経由 claude セッションに companion 配下の閲覧 + マシン状態確認を開放する (bot 改良プラン Step 1、center of truth = `~/companion/workspace/redesign/bot-improvement-plan.md`)。

- **bot-workspace/ を (C) ローカル git 化** (初回 commit 13c0ac5、gitleaks pre-commit hook 設置)。PROJECT.md / 上位 `~/companion/CLAUDE.md` の git 化 3 階層 (C) リストに追記
- **Step 1-1 deny 増強** (60e13a9): ブラウザ profile (`~/.mozilla` / chrome / chromium) / keyrings / gnupg / `~/.config/gh` / `~/.bash_history` / `~/companion/**/.env(.*)` 絶対パス形の 9 件を allow 拡張より先に commit
- **Step 1-2 allow 拡張** (95e7b1a): `Read(~/companion/**)` + 読み系/状態系 Bash 17 件 (`ls` `cat` `head` `tail` `find` `wc` `df` `du` `free` `ps` `uptime` `sensors` `systemctl --user status/list-units/list-timers` `journalctl --user`) + `additionalDirectories` を `/home/miho/companion` に置換
  - 手元セッションからの settings.json 編集は auto mode classifier に Self-Modification として拒否 (Edit / heredoc とも 2 回で打ち止め、heredoc 回避は 2026-05 の事例と異なり今回は**不通**)。ステージングファイル `settings.json.step1-2` を作成し user が `cp` で適用 → commit 後にステージング削除
- **code-reviewer 通過**: 修正必須 1 件 (classifier 拒否前に通った `Read(~/companion/**)` 迷子行の未 commit 残置 → `git restore` で解消)、軽微 3 件反映 (`find -delete` の削除能力をプラン受容リスク節に注記 / 冗長 vault Read 削除 / ステージング削除手順明記)
- **実弾検証 3 件 pass** (#chat 実弾):
  1. bot.py 行数質問 → 1736 行 (実測一致、Read 開通)
  2. ディスク + bot 稼働状況 → df pass。systemctl は初回 fail (bot が system 版 `systemctl status bot.service` を実行、--user なし + 誤 unit 名)。**settings 不備でなく環境知識欠如**と判定し、`bot-workspace/CLAUDE.md` に前提知識を追記 (f3a99a5: user unit 一覧 / `--user` 必須 / 複合コマンド分割) → 再検証で `systemctl --user status companion-bot.service` pass
  3. negative test `~/.ssh` → deny pass。**副次観測**: bot は `ls -la ~/.ssh/` (Bash 経由) を試みたがこれも拒否された = `Read(~/.ssh/**)` deny が Bash の読みにも効いている実測。プラン受容リスク (Bash 読み系の Read deny 素通り) は想定より限定的
- **消費観察起点 = 2026-06-10**。Step 3 (予算計器) は 1〜2 週間の消費観察後に着手 (C-3)

### Discord rollback 残骸の削除 (A-2 完了、2026-06-09、OWNER 削除承認)

**目的**: Telegram cold cut (2026-05-28) 当日に rollback path として残した Discord 時代の残骸 2 件を、移行安定を確認のうえ撤去する (K-T7「1 週間運用後 rm」の最終処理)。

**経緯**: K-T7 / setup.md §7 の「cold cut +1 週間 (≈6/4) で rm」期限は経過していたが、不可逆操作のため独断削除せず A-2 として OWNER 判断待ちにしていた。2026-06-09 に OWNER が rollback 不要と確定 (削除承認)。Telegram 移行は cold cut +12 日安定稼働 (NRestarts=0 / 各 topic session 分離・notify socket・budget guard とも正常) を確認済。

**実施内容**:
- `venv-discord-backup/` (35MB、Discord 版 venv = PTB 不要) を rm。
- `.env.discord-backup` (旧 DISCORD_TOKEN + 旧 OWNER_ID = Discord snowflake 含む、mode 600) を rm。
- 両者とも git 追跡外 (`.gitignore` 対象) のため削除自体に commit は不要、作業ツリーへの影響なし。
- これで Discord rollback path は完全撤去 (`venv` swap + `.env` OWNER_ID 切替の巻き戻し手段は消滅)。telegram-setup.md の rollback 用 mv/cp 手順は履歴手順として保持 (実態の残骸は撤去済)。

**STATUS.md 反映**: A-2 を TODO から削除しこの Done エントリへ転記。設計メモ L15 (venv 注記) + cold cut 当日 entry の「rollback path 残置」section を削除済の実態に更新。

### Telegram `/tweet <url>`: 本文 t.co 展開 + frontmatter url 正規化 + 既存ノート取り直し (2026-06-08 実装、commit までで停止、restart は user 操作)

**目的 (OWNER 依頼)**: (1) `/tweet` 全件に本文中の t.co 短縮 URL 展開を追加、(2) 旧形式で `notes/` に保存済の amarunavr ノート 1 件を新コードで取り直して `clips/` に移動。

**変更1 — 本文 URL 展開 (`bot.py`、全 `/tweet` に適用)**:
- `expand_tweet_text(text, entities)` を純関数として追加。`entities.urls` の各 `url`(t.co) を `expanded_url`(実 URL) に置換し、`entities.media` の各 `url`(t.co) を本文から除去、除去で生じた行末空白・末尾余分空行を整える。`entities` 無し/空でも安全に no-op。置換は 1 パスで確定 (条件分岐積み増し・stderr 文言マッチ・リトライなし、2 周目ルール遵守)。
- `canonical_tweet_url(handle, tweet_id)` を追加。frontmatter `url:` を `https://x.com/<handle>/status/<tweet_id>` 正規形で組み立て、ユーザー入力の `?s=20` 等トラッキングパラメータを持ち込まない。
- `build_tweet_markdown` のシグネチャを `(data, source_url, media, now)` → `(data, tweet_id, media, now)` に変更。本文に `expand_tweet_text` を適用 (HTML デコード前)、`url:` は `canonical_tweet_url` で生成。caller `cmd_tweet` は `tweet_id` を渡すよう更新。

**変更2 — 既存ノート取り直し & clips 移動 (本番 vault データ操作、OWNER 明示依頼で承認済)**:
- 旧 `notes/2026-06-08_tweet-amarunavr-2063267371713020257.md` (旧形式・本文 t.co のまま) を新コードで tweet id `2063267371713020257` から取り直し、`clips/2026-06-06 @amarunavr.md` (published=2026-06-06 JST) として書き出し、画像 `HKIyQfpbcAAEICT.jpg` を `attachments/` に DL。生成物で本文末尾 `https://t.co/3E7TXHPjKA` → `https://booth.pm/ja/items/4503244` 展開、媒体 `https://t.co/rYtonSwjkh` の本文消去、`![[HKIyQfpbcAAEICT.jpg]]` 埋め込み、正規 url を確認。
- 旧 notes ファイルを `git rm` で削除。clips ノート + attachments 画像の追加と旧ファイル削除を vault repo で **1 commit** (pathspec を `clips/` `attachments/` `notes/<旧ファイル>` に限定、flock 直列化、`GIT_TERMINAL_PROMPT=0`、push しない)。vault commit: `0e25d49 refactor: amarunavr tweet を新形式で取り直し notes/→clips/ 移動 (t.co 展開)`。

**テスト (`tests/test_bot.py`)**: 既存 `BuildTweetMarkdownTest` の `build_tweet_markdown` 呼び出しを新シグネチャ (`tweet_id`) へ更新 + canonical url / 本文 t.co 展開アサート追加。新規 `ExpandTweetTextTest` 6 件 (amarunavr 実 entities 模倣 / no-op / 空 / 複数 URL / 媒体除去の行末整形 / 不正エントリスキップ) + `CanonicalTweetUrlTest` 2 件 = 純関数のみ (ネットワーク非依存)。全 **133 tests pass**。

**設計判断 (記録)**:
1. **`build_tweet_markdown` のシグネチャ変更 (source_url → tweet_id)**: frontmatter `url:` を正規形で生成する責務を関数内に閉じるため、渡された生 URL を持ち回るより tweet_id から組み立てる方が「トラッキングパラメータを持ち込まない」契約に直結。既存慣習 (純関数で frontmatter を組む) に寄せた。
2. **取り直しノートのファイル名**: 既存 clips 慣習 `<published JST> @<handle>.md` に従い `2026-06-06 @amarunavr.md` (依頼指定どおり)。published は API created_at `2026-06-06T14:30:49Z` → JST `2026-06-06` で一致。

**実 API 確認 (一度だけ手で実施、bot.service 非接触、一時スクリプトで bot.py 関数を直接呼び作業ツリー非汚染)**: tweet id `2063267371713020257` を fetch → entities (urls 1 / media 1) 確認 → 画像 DL (`attachments/HKIyQfpbcAAEICT.jpg`、154KB JPEG) → 生成 clips ノートで booth.pm 展開・媒体 t.co 消去・`![[...]]` 埋め込み・正規 url を目視確認。一時スクリプトは削除済。

**未実施 (user 操作)**: bot.service restart は claude 側で実行しない (**restart 未実施**)。反映には `systemctl --user restart companion-bot.service` が必要。push もしない (bot repo / vault repo とも commit までで停止)。

### Telegram `/tweet <url>` 改修: clips/ 保存 + 画像ローカル DL + クリップ慣習 frontmatter (2026-06-08 実装、commit までで停止、restart は user 操作)

**目的 (OWNER 依頼)**: `/tweet` の保存先・frontmatter・メディア参照を Obsidian の単発ツイートクリップ慣習 (`clips/2026-03-27 @trickcal_GW 1.md`) に合わせる。(1) 保存先を `notes/` → `clips/` に変更、(2) ツイート画像 (photo) を `attachments/` にローカル DL、(3) frontmatter/本文を最新クリップ慣習に合わせる。

**実装内容 (`bot.py`)**:
- 保存先を `clips/<published JST> @<handle>.md` に変更。同名が既に存在する場合は ` <tweet_id>` suffix で衝突回避 (`_tweet_clip_filename`、`exists` callback 注入で純関数的にテスト)。published は投稿日 (JST 基準、取得不能なら now 日付)。
- 画像 DL: `_select_media` が `mediaDetails` を構造化 (`{kind:photo, filename, dl_url}` / `{kind:video, url}`)。photo は `media_url_https` の basename を `[A-Za-z0-9_.-]` 以外除去で安全化 (`_safe_attachment_name`、パストラバーサル防止)、`?name=large` で高解像度取得 (`_high_res_image_url`)。`_download_image` が httpx async で 1 取得・成否確定 (リトライループ/stderr 分岐なし、2 周目ルール遵守)、失敗はその画像だけスキップして `logger.warning`。video/animated_gif は DL せず本文に `[動画](url)` リンクとして残す。
- frontmatter/本文を `build_tweet_markdown(data, url, media, now)` で最新クリップ慣習に整形: `url`/`title` (本文先頭非空行を流用・長ければ truncate、無ければ `<handle>(<JST datetime>)`)/`author` リスト/`handle`/`tags` (`tweet`/`clippings`/`media` [メディアありのみ]/`processed`)/`published`/`created`/`image` (先頭 photo の `attachments/<basename>`、photo ありのみ)。本文は `## Tweet` → `## Media` (photo は `![[basename]]` 埋め込み wikilink、video は `[動画](url)`) → `## Notes`。HTML エンティティはデコード。
- **remote 閲覧アプリ契約**: DL 画像は `attachments/<basename>` に置き、本文では folder 名なしの `![[basename]]` で参照 (remote アプリが `attachments/` 配下と解釈して画像配信に解決する規約を遵守)。
- `_commit_tweet_clip` が `clips/<file>` + DL した `attachments/<各画像>` を同一 commit に含める (pathspec を両ディレクトリに限定、手書きエリア漏出なし)。flock (`companion-vault-sync.lock`) で vault-sync Stop フックと直列化、`GIT_TERMINAL_PROMPT=0`、push しない。commit メッセージは vault auto-sync スタイル `add: clips <date> (tweet @<handle> <id>)`。
- 旧 `_select_media_urls` / `_tweet_note_filename` / `_commit_tweet_note` / 旧 `build_tweet_markdown` シグネチャは新版に置換 (notes/ 経路は撤去)。

**テスト (`tests/test_bot.py`)**: 旧 `SelectMediaUrlsTest` / `BuildTweetMarkdownTest` を新仕様へ更新 + `_safe_attachment_name` 4 / `_high_res_image_url` 2 / `_select_media` 5 / `_tweet_title` 3 / `_tweet_clip_filename` 3 / `_tweet_published_date` 2 / `build_tweet_markdown` 4 = 純関数のみ (ネットワーク非依存)。全 **123 tests pass**。

**実 API 確認 (一度だけ手で実施、bot.service 非接触、tmp dir で作業ツリー非汚染)**: 画像付きツイート ID=1349129669258448897 で fetch → `_select_media` で photo 1 件 → `_download_image` で `attachments/ErkSSFgW4AMKude.jpg` (93KB) DL 成功 → frontmatter (`image: "attachments/ErkSSFgW4AMKude.jpg"`) + 本文 `![[ErkSSFgW4AMKude.jpg]]` 生成を確認。DL 画像と生成 Markdown は tmp dir で完結させ削除済 (作業ツリー clean)。

**設計判断 (記録)**:
1. **frontmatter は依頼書の新契約を正とする**: 既存 `clips/2026-03-27 @trickcal_GW 1.md` 等は `![](url)` の外部 URL 直参照 (旧形式) だが、依頼書がより新しい契約 (`attachments/` ローカル DL + `![[basename]]` 埋め込み + remote アプリ解決) を明示指定。依頼書に従い、外部 URL 直参照ではなくローカル DL + wikilink 埋め込みを採用。タグ/著者リスト/published/created の YAML 構造は既存クリップと一致させた。
2. **ファイル名衝突回避**: 既存 clips の ` 1` suffix 運用に寄せるが、依頼書指定どおり衝突時の suffix は ` <tweet_id>` を採用 (一意性が tweet_id で保証され連番管理が不要)。
3. **video の本文リンク URL**: variants の mp4 最高 bitrate (なければ `media_url_https` fallback)。video は DL せず `[動画](url)` リンクのみ。
4. **vault 書き込み境界**: 本来 `notes/` のみだが OWNER 明示依頼で `/tweet` が `clips/` + `attachments/` に書く例外 (CLAUDE.md 本体の境界記述更新は orc 側が実施、本タスクは STATUS.md 記録のみ)。

**未実施 (user 操作)**: bot.service restart は claude 側で実行しない (**restart 未実施**)。反映には `systemctl --user restart companion-bot.service` が必要。push もしない (commit までで停止)。

### Telegram `/tweet <url>` コマンド追加 (2026-06-08 実装、commit までで停止、restart は user 操作)

**目的**: ツイート/ポスト URL を渡すと本文・著者・投稿日時・メディア URL を取得して Obsidian vault `notes/` に Markdown 保存し、vault repo (branch develop) へ commit する。push はしない (GitHub 同期は既存 `/vault_push` の人手承認ゲートに委ねる)。`/play` / `/vault_push` の実装パターンに準拠。

**取得方式**: `https://cdn.syndication.twimg.com/tweet-result?id=<ID>&token=<TOKEN>&lang=en` (認証不要)。TOKEN は react-tweet 互換アルゴリズムを ID から算出 (`_syndication_token`、実機検証済の固定値 2 件をユニットテストで固定)。HTTP は PTB 同梱 httpx の async client (新規依存追加なし)、`TWEET_HTTP_TIMEOUT_S=10`、ブラウザ風 User-Agent。成否は 1 レスポンスで確定 (リトライループ・stderr 文言分岐なし、2 周目ルール遵守)。

**実装内容**:
- `bot.py`:
  - `_syndication_token(tid)` … react-tweet 互換トークン算出 (純関数)。
  - `extract_tweet_id(url)` … x.com / twitter.com (www./mobile. 接頭辞含む) の `/status/<digits>` から ID 抽出。userinfo 詐称 / 非 http / 制御文字 / 未対応ホストを弾く (純関数、`_normalize_play_url` の弾き方に準拠)。
  - `build_tweet_markdown(data, url, now)` / `_select_media_urls` / `_safe_screen_name` / `_tweet_note_filename` … frontmatter (type/created/tags/style/source/author) + 本文 (HTML エンティティデコード) + メディア URL を整形 (純関数)。photo は media_url_https、video/animated_gif は variants の mp4 最高 bitrate を 1 本。メディアは URL 記載のみ (バイナリ DL しない、vault 境界 notes/ のみ・YAGNI)。
  - `_fetch_tweet(tweet_id)` … syndication API を 1 回 GET。HTTP 非200 / 非 JSON / 例外は None。
  - `_commit_tweet_note()` … vault-sync Stop フックと同じ flock (`companion-vault-sync.lock`) で直列化。Stop フックは flock -n だが /tweet は取りこぼし回避のため短いタイムアウト付きブロッキング取得 (`VAULT_LOCK_TIMEOUT_S=15`)。`git add -- notes/<file>` 限定 (手書きエリア漏出防止) → `git commit`。`GIT_TERMINAL_PROMPT=0` で対話 hang 防止。push はしない。`asyncio.to_thread` 経由で event loop を塞がない。
  - `cmd_tweet(url)` … URL→ID→取得→`__typename=="Tweet"` 検査 (削除/鍵垢 tombstone を弾く)→同名ファイル存在チェック (重複 commit 回避)→保存→commit。異常系はファイルを書かずユーザー向け文言を返す。
  - `slash_tweet()` ハンドラ + `BotCommand("tweet", ...)` 登録 + `CommandHandler("tweet", ...)` 登録 (`_authorized` 4 段防御 + message_filter、`/play` の隣)。
- `tests/test_bot.py`: token 固定値 2 / URL 抽出 12 / safe_screen_name 3 / media 選択 4 / markdown 整形 2 = **23 件追加**。ネットワーク非依存 (純関数のみ)。全 **106 tests pass** (旧 83 + 23)。

**実 API 確認 (一度だけ手で実施、bot.service 非接触)**: ID=20 (jack 初ツイート) で `__typename=Tweet` / 本文 / created_at JST 変換 / frontmatter を確認。

**設計判断 (記録)**:
1. **httpx を requirements.txt に追加しない**: httpx は PTB の確定 transitive 依存で venv に 0.28.1 既存。ブリーフ指示「新規依存追加しない」に従い直接 import のみ (PTB が pin している前提)。
2. **ファイル名安全化 / frontmatter**: 既存 notes 慣習 (type: note / created / tags / style) に最も寄る形を独断採用。tweet 専用に `tags: [tweet, clip]` / `style: clip` / `source:` / `author:` を追加。
3. **commit メッセージ**: vault repo の auto-sync スタイル `add: notes <date> (...)` に揃え、tweet 識別子を括弧内に入れる。
4. **テストランナー**: ブリーフは pytest を想定するが venv に pytest 未導入。既存 test 群は unittest 前提 (`_import_bot_with_stub_env` の SkipTest 機構含む) のため unittest で実行・検証 (既存慣習に準拠)。

**未実施 (user 操作)**: bot.service restart は claude 側で実行しない。反映には `systemctl --user restart companion-bot.service` が必要。push もしない (commit までで停止)。

### Phase 4 自発発話 (proactive companion messaging) 最小初版 (2026-06-01 実装、commit までで停止、restart/timer enable は user 操作)

**目的**: bot 側から自発的に話しかける機能の最小初版。Phase 4 (相棒層) の能力タスク。設計 center of truth = `~/companion/vault/notes/2026-05-30_proactive-companion-messaging-design.md` (§3 blind spots / §4 推奨方向 / §5 最小スケッチ / §3.B budget guard 制約)。

**確定済パラメータ (user 確認済)**: 沈黙閾値 6h (全 topic 横断 max(last_prompt_at))、発火帯 9-22 JST (深夜除外)、1 日 1 回上限 (JST 日付)、投げ先 #chat、種 = 直近会話文脈中心 (能動 Web 調査なし、同日 vault 追記は任意で種ヒント)、確率で間引く、種ゼロなら発火しない、off/snooze 同梱、ペルソナ軸 1「対等な相方」。

**構成 (2 repo)**:
- **maintenance/** (commit `b12dfb6`): `scripts/proactive-companion.sh` (判定: グローバル on/off → 9-22 JST → snooze → 沈黙 6h → 1 日 1 回 → 種有無 → 確率、すべて state を 1 回引いて確定。条件成立時のみ bot socket に `[[proactive-v1]]`+JSON 依頼を送る。claude 起動はしない)、`systemd/companion-proactive.{service,timer}` (oneshot, After=companion-bot.service, Wants/Requires なし=socket 不在時 script skip に揃え。timer は 9,11,13,15,17,19,21 JST 発火 + RandomizedDelaySec=40min + Persistent=true、catch-up 連続発火は last_proactive_date で 1 回抑止)。
- **bot/** (commit `f57b049`): socket 接続ハンドラで構造化 envelope を 1 回判別し proactive 経路へ振り分け (既存 `[critical] ` 素通し forward 経路は無改変)。`_proactive_worker` / `_run_proactive` で **run_claude (budget guard を通る経路) を再利用**し #chat に送信。guard 拒否 / snooze / off / 空出力なら skip し `sessions/proactive_ledger.jsonl` に理由記録 (claude_runner 直叩きせず迂回しない、M-14 単一 guard 境界)。`/snooze <日数>` slash command (snooze_until を `.state/proactive` に書き script/bot 双方で skip 判定) + env `PROACTIVE_ENABLED` 全停止。

**設計判断 (記録)**:
1. **socket メッセージ形式**: `[[proactive-v1]]` 行マーカー + JSON envelope。K-T9 (sentinel 種別上限 = 文字列 forward 経路の prefix マッチ拡張禁止) には**非該当**と判断。理由: forward 経路の `[critical] ` prefix マッチ (挙動分岐) を一切増やさず、socket 受信段階で「素通し forward か / claude を起こす proactive 依頼か」を JSON decode で 1 回判別する別レイヤだから。proactive 経路の中で更に prefix マッチ分岐を生やすことは将来も禁止 (このルールをコードコメントにも明記)。
2. **種の集め方**: 最小初版は「直近会話の存在 (= max(last_prompt_at)>0)」を種の核とし、当日 mtime の vault ノート**ファイル名**を最大 3 件まで種ヒントに足す (本文は渡さない=プライバシー)。bot 能動 Web 調査はしない (次拡張)。会話実績ゼロ (session なし) は種ゼロ扱いで発火しない (Meta ガード (b) 翻訳)。
3. **guard 経路**: `_run_proactive` は `run_claude` を呼ぶ前に `budget_guard.allow()` を 1 回先読みする。これは迂回ではなく「guard 拒否時に run_claude が返す exceeded_message 文字列を #chat に誤送信しないため」。run_claude 内でも guard を再度通すので claude 起動は単一境界のまま。両 check とも同一 state (ledger) の読みで、stderr 分岐や場当たりリトライではない (2 周目ルール非該当)。
4. **1 日消費の確定点**: script は socket handoff 成功を以て last_proactive_date を当日に更新 (1 日分消費)。bot 側 guard 拒否 / claude 失敗でも script から再試行しない (場当たりリトライ禁止)。bot 側成否は proactive_ledger に残す。

**追加 env (`.env.example`)**: `PROACTIVE_ENABLED` (bot+script 双方参照、全停止)、`PROACTIVE_HOUR_START`/`PROACTIVE_HOUR_END`/`PROACTIVE_SILENCE_HOURS`/`PROACTIVE_PROBABILITY` (script 側調整)。

**テスト**: `tests/test_bot.py` に 17 件追加 (parse_proactive_payload 6 / build_proactive_prompt 3 / snooze 6 / guard 迂回しないこと 2)。全 **83 tests pass** (旧 66 + 17)。script 側はローカルで fake HOME + fake socket により全判定パス (no-session / not-silent / no-socket / disabled / full-fire / once-per-day) を実弾確認。

**様子見観察を開始 (PROJECT.md 2026-06-01 条件 #2 再定義「bot.py 大改変時の様子見」に従う)**。観察項目:
- 自発発話の発火回数 (proactive_ledger.jsonl sent=true 件数、想定 = 1 日最大 1)
- guard 通過 / 拒否の内訳 (ledger reason: ok / budget_guard / snoozed / disabled / empty_output)
- 連投・多重発火の有無 (同日 2 回以上 sent=true が出ていないか、last_prompt_at 更新で沈黙が再カウントされ連投しないか)
- off (PROACTIVE_ENABLED=0) と /snooze の効き (script log の skip 理由、ledger reason)
- bot.service NRestarts / bot.log ERROR/WARN/Traceback
- 自発メッセージの口調が「対等な相方」かつ空疎/引き止めでないか (内容の質的観察)

**配備済み (claude 側で実施・検証、2026-06-01 19:17 JST)**:

`systemctl --user` が到達可能だったため下記まで実施済み (当初ブリーフは Phase 2.6 / /vault_push 前例に倣い「commit で停止」想定だったが、実装環境でユーザ systemd に到達できたため配備まで完了。残る user 操作は git push のみ):

1. **timer 配置 + bot restart 完了**:
   - `~/.config/systemd/user/` に `companion-proactive.{service,timer}` を symlink 配置 → `daemon-reload` → `enable --now companion-proactive.timer`。timer は **enabled + active**、次回発火 **2026-06-01 21:11 JST**。
   - `companion-bot.service` restart 完了 (`ActiveEnter=2026-06-01 19:17:26 JST`、NRestarts=0、running)。新コード反映を bot.log で確認: `slash commands registered ... ['reset','quota','status','play','vault_push','snooze']` / `notify socket listening ... (proactive enabled=True)`、ERROR/Traceback なし。
   - 配備時の credit guard 状態: 6/1 00:00 JST 以降 credit 累計 **$0.00** (暦月リセット直後) → guard 許可。bot.log 19:13 の `budget guard not allowing (credit_usd)` ×9 + `snoozed` ×9 は実装者の deny/snooze 経路テスト痕跡 (本番 state file・proactive_ledger とも未生成 = 残置なし、production はクリーン)。
2. **timer の tz 前提 (運用注記、code-reviewer §5 指摘反映)**: timer の `OnCalendar` 発火時刻はホスト tz (= `Asia/Tokyo`) に暗黙依存する (script 側は `TZ=Asia/Tokyo` 明示だが timer は OnCalendar=ローカル tz)。Mint 機は JST 固定なので実害なし。**ホスト tz を変更すると発火帯 9-22 JST がずれる**点に注意。
3. **残る user 操作 = `git push` のみ** (maintenance/ repo・bot/ repo とも commit 済・未 push)。
4. **user 動作確認 (任意)**: 手動発火は `~/companion/maintenance/scripts/proactive-companion.sh` 直接実行 → `proactive-companion.log` で判定確認、発火時は #chat に短い自発メッセージ。`/snooze 1` で翌日まで停止、`/snooze 0` で解除。

**関連**: vault `notes/2026-05-30_proactive-companion-messaging-design.md` / `persona/docs/STATUS.md` (軸 1 確定) / PROJECT.md 健全性履歴 2026-06-01「条件 #2 再定義」。

### Phase 3 を畳んで Phase 4 へ (2026-06-01、user 方針転換) — voice bot 統合 Phase 4 移送 + 同日追加判断: 条件 #2 を Phase 4 着手の門から外す

**背景**: user 判断「voice は日常利用シーンが薄い (テレビ前は dashboard / YouTube)、bot/dashboard で土台確立、Phase 3 を畳んで Phase 4 へ」。center of truth = PROJECT.md 健全性履歴 2026-06-01 entry。

**bot 台帳での変更点** (本セッション編集分):
- **最終更新行 (a)**: 2026-05-30 → 2026-06-01 (Phase 3 を畳んで Phase 4 移送 = voice bot 統合 Phase 4 移送 + 条件 #2 判定日 6-11 確定)。
- **`BOT_THREAD_ID_VOICE_LOG` (b)**: 「未実施項目」の VOICE_LOG 環境変数設定を「Phase 4 voice bot 統合時に追加 (2026-06-01 に Phase 3-2 から Phase 4 移送)」へ更新。
- **Phase 4 着手条件 #2 観察カウント (c)**: 末尾の「Phase 4 着手目安 2026-06-25 +α (voice/ 統合 +14 日 = 6/25 目処)」を撤回。voice を Phase 4 移送したため「voice/ 統合 +14 日」律速は成立せず、bot.py の最後の大改変 = Telegram 移行 (5/28) として **条件 #2 判定日 = 2026-06-11** に戻す。前提 = 当面 bot.py を大きく触らない (remote v1-β 保留)。2026-06-11 完了予定の Telegram 観察 14 日カウントは継続。

**同日追加判断 (2026-06-01): 条件 #2 を Phase 4 着手の門から外す**: 上記 6/11 判定をさらに見直し。user 問題提起「個人活用で 2 週間観察してフェーズを止める実益が不明、何度も観察を止めてきた」を受け、「2 週間」の定量根拠が台帳に無いこと・起算日/打ち切りの反復による形骸化を確認。Phase 4 (キャラ層) は bot.py 土管を大きく触らない装飾のため、観察を装飾フェーズの門にするのは紐付けの筋違いと判断。**条件 #2 は Phase 4 着手の門から外す (bot.py 大改変時の様子見へ再定義)。Phase 4 は条件 #1 (vault 充足) + #3 (user 宣言) で着手可**。観察は撤廃せず、次に bot.py 土管を大改変するとき (voice bot 統合 / remote v1-β を Phase 4 中に入れる等) のその変更への様子見へ再定義 (2 週間固定にしない)。6/11 判定は撤回。根拠: PROJECT.md 健全性履歴 2026-06-01 entry「追加判断」section。

**code-reviewer**: PROJECT.md / voice / remote STATUS と一括で整合性点検 (同セッション)。

**次タスク**: Phase 4 着手は user 宣言 (#3) で随時可 (#1 vault 充足済)。残置観察項目 2 件 (vault-sync Stop hook exercise / stall→restart→catch-up) は次の自然使用で閉じる。次に bot.py 土管を大改変するときその変更を様子見観察する。

### Telegram `/vault_push` コマンド追加 (2026-05-30 実装、commit までで停止、検証/restart は user 操作)

**目的**: `web/scripts/vault-sync-from-transcript.sh` (Stop hook) は commit までで push は人手承認に委ねる設計 (design.md §5.2)。その人手承認 (手元端末での `git push`) をモバイル (Telegram) から起こせるようにした。**コマンド送信そのものが人手承認の置き換え** (bot 自律 push ではない、安全ゲートは保持)。

**コマンド名の実装事実 (ブリーフ呼称との差分)**: ブリーフ呼称は `/vault-push` だが、Telegram Bot API の BotCommand 制約 (`1-32 lowercase letters / digits / underscores`、ハイフン不可) + PTB `CommandHandler('vault-push', ...)` が `ValueError: not a valid bot command` で拒否することを実機確認。**Telegram 上の実コマンドは `/vault_push` (アンダースコア)** で実装。UX 表記とログ prefix は `[vault-push]` を維持。

**実装内容**:
- `bot.py`:
  - `classify_push_result(rc, stdout, stderr)` … **純関数**。成否は呼び出し側が rc 1 回で確定 (この関数は判定し直さない)。失敗時のみ stderr を分類して**報告文言だけ**整形 (回復行動を分岐させない = 2 周目ルール厳守)。reject (non-fast-forward / fetch first / [rejected]) → 「pull してから再実行、自動 rebase しない」、SSH 認証 (publickey / agent refused / auth agent 接続不可 / host key verification failed) → 「`ssh-add` 後再実行」、Everything up-to-date (rc 0) → 「既に同期済」、その他 → stderr 末尾添付。成功は push 範囲行 (`<old>..<new> develop -> develop`) を含めて報告。
  - `_extract_push_range()` … git 出力から範囲行 / `[new branch]` 行を拾う純関数。
  - `cmd_vault_push()` … `git -C ~/companion/vault push origin develop` を subprocess 実行。`GIT_SSH_COMMAND="ssh -o BatchMode=yes"` + `GIT_TERMINAL_PROMPT=0` で対話 hang を即 fail。`VAULT_PUSH_TIMEOUT_S=60` の wait_for 保険。成否は exit code 1 回で確定。
  - `slash_vault_push()` ハンドラ + `BotCommand("vault_push", ...)` 登録 + `CommandHandler("vault_push", ...)` 登録 (既存 `/quota` パターンに完全準拠、`_authorized` 4 段防御に乗せる)。
- `companion-bot.service`: `Environment=SSH_AUTH_SOCK=%t/keyring/ssh` を明示追加 (`%t` = XDG_RUNTIME_DIR = /run/user/1000)。GUI ログインセッション起動順への継承依存を排除し socket path を固定解決。socket 不在 / ロック時は BatchMode=yes で git push が即 fail し classify_push_result が SSH 認証エラーとして報告。
- `tests/test_bot.py`: `ClassifyPushResultTest` 12 case 追加 (success+range / new branch / range なし fallback / up-to-date / reject 2 種 / agent refused / publickey / host key / その他 / range 抽出 2 種)。PTB 未導入環境は既存同様 SkipTest。全 66 tests 全 pass。

**open question 決定 (orc 確定、実装反映済)**: コマンド名 = `/vault_push` (技術制約で `-`→`_`)、dry-run preview なし即 push (送信=承認)、reject と agent-lock は別メッセージで区別、対象は vault のみ (YAGNI)。

**設計制約の遵守**:
1. push は OWNER のみ起動 (`_authorized` 4 段防御)。
2. push reject → 報告して止める、自動 rebase / pull しない。
3. agent refused / keyring ロック / publickey → 明確に報告、リトライループなし (BatchMode=yes 即 fail)。
4. 1 push = 成否 1 回判定 (rc 1 回)。stderr 分類は失敗確定**後**の報告文言整形専用 (回復行動は分岐させない)。
5. `/quota` 登録パターンに揃え済。

**観察への影響**: bot.py 改変 = 新 14 日観察を発火する層。voice 統合と同時に入れていない (bot.py は本変更前 clean、同時 2 方向回避の N-T14 系原則を満たす)。

**未実施 (user 操作 — Phase 2.6 cold cut「commit までで停止、検証/restart は user 操作」前例に揃える)**:

実 push を伴う検証 + bot 再起動は claude 側では実行しない。下記を user が手元端末で実施する:

1. **bot 再起動 (service 変更反映)**:
   ```
   systemctl --user daemon-reload
   systemctl --user restart companion-bot.service
   systemctl --user status companion-bot.service   # active (running) 確認
   ```
   再起動後に bot プロセスの環境を確認 (SSH_AUTH_SOCK 固定解決の確認):
   ```
   systemctl --user show companion-bot.service -p Environment
   ```
2. **(i) bot 経由実 push**: vault に commit 済・未 push の変更がある状態で Telegram から `/vault_push` を送信 → push 範囲を含む成功メッセージが返ること。変更なしなら「既に同期済」が返ること。
3. **(ii) reject 経路**: メイン機 / Obsidian 側で先に origin/develop を ahead にした状態で `/vault_push` → 「reject: pull してから再実行、自動 rebase しない」メッセージが返り、**実際に rebase / pull が走らない** こと (`git -C ~/companion/vault log` で HEAD が動いていないこと)。
4. **(iii) keyring ロック時**: 鍵を agent から外す (`ssh-add -D`) か keyring ロック状態で `/vault_push` → 「SSH 認証に失敗、`ssh-add` 後再実行」が即返ること (hang しないこと)。検証後 `ssh-add ~/.ssh/id_ed25519` で復旧。

**2026-06-11 実機観測 (チケット #11「vaultpushがうごかない」)**: (iii) が本番で発生し、**想定と異なる経路でハング**した。観測事実:

- gnome-keyring の SSH socket は 2 段構成: `%t/keyring/ssh` (proxy、bot が参照) と `%t/keyring/.ssh` (実体 `ssh-agent -D`)。実体 agent が同日 14:42 に再起動され identities が消失 (proxy 側 `ssh-add -l` には公開鍵ファイル由来で鍵が**見え続ける**ため、リスト確認では検出できない)
- この状態で署名要求が来ると gnome-keyring proxy は **GUI パスフレーズプロンプトを出して応答を待つ**。`BatchMode=yes` / `GIT_TERMINAL_PROMPT=0` は agent 側プロンプトには効かず、「agent refused operation → SSH 認証エラー即報告」の想定経路 (上記 2026-05-30 entry の「ロック時は即 fail」前提) には乗らない
- 結果、`VAULT_PUSH_TIMEOUT_S=60` の wait_for 保険が効いてタイムアウト文言で報告された (bot.log 2026-06-11 18:52 `send len=61`)。**hang が無限に続かない点は設計どおり**だが、文言「ネットワーク / SSH 接続を確認」は実原因 (鍵未ロード) とずれる
- 復旧: user 端末で `SSH_AUTH_SOCK=/run/user/1000/keyring/ssh ssh-add ~/.ssh/id_ed25519` → bot 同等条件で GitHub 認証成功を確認。なお ssh-add は SSH_AUTH_SOCK 明示が必要 (`feedback_ssh_agent_lock` メモどおり)
- **判断 (2 周目ルール参照)**: タイムアウト文言への「鍵未ロードの可能性」追記は stderr 分岐の積み増しではなく表面化文言の改善であり許容範囲だが、発生頻度が低い (agent 再起動時のみ) ため当面は本 entry の記録のみで様子見。再発したら文言改善を bot 改良プラン (`workspace/redesign/bot-improvement-plan.md`) の C 系列に積む

(iii) のステータス: 本番で観測されたのは **agent 再起動による鍵消失経路** であり、元の検証手順 (`ssh-add -D` で鍵を外す → 即 fail 確認) とは別経路。`ssh-add -D` 経路の即 fail は未確認のままだが、ロック系の実挙動 (即 fail せずプロンプト待ちハング) が判明したため (iii) は本 entry をもって消化扱いとする。

**2026-06-11 (ii) reject 経路 実機検証 PASS**: 同日中に続けて実施。手順と結果:

- 発散状態の作成: ローカル `develop` にテストノート commit (`0c6bd83`、ahead 1、未 push) + GitHub web UI で `README.md` を直接編集し origin/develop を ahead に (`bd643f6`)
- Telegram `/vault_push` → **期待どおりの reject 文言** (「reject: メイン機 / Obsidian が先に push 済 … 自動 rebase / 自動 pull はしません」、bot.log 23:06:26 `send len=124`)。stderr 分類漏れの汎用文言には落ちなかった
- **副作用なし確認 PASS**: HEAD は `0c6bd83` のまま不変、reflog に pull/merge/rebase の痕跡なし、`MERGE_HEAD` / `rebase-merge` / `rebase-apply` 不在、working tree clean — 「止めて報告、自動回復しない」の設計どおり
- 後始末: `git pull --no-rebase origin develop` (merge `60a39b6`) → テストノート削除 commit (`a14b5cc`)。origin との一致復帰は user の `/vault_push` 実行待ち (本 entry 記録時点で ahead 3)

なお (i) bot 経由実 push は 2026-05-30 に消化済み (bot.log 12:00:05 `send len=58` = push 完了 + 12:01:23 `send len=35` = 既に同期済の両文言を確認)。本日 22:55:51 の成功 push (clips 2 commits、`send len=58`) でも再確認。

これで実機検証 3 経路 (i)(ii)(iii) すべて消化。`/vault_push` の残検証なし。

**`git push` は claude 側で未実施** (bot/ repo・vault repo とも)。bot/ repo の commit までで停止。

**関連**: design.md §5.2 / `web/scripts/vault-sync-from-transcript.sh` / PROJECT.md「vault push reject 観察ルール」+ 2026-05-30 健全性履歴 entry / `feedback_ssh_agent_lock` メモ。

- 2026-05-28 Phase 2.6 cold cut 切替完了 + smoke test 全 pass (Telegram 観察 14 日カウント開始)
  - **背景**: 2026-05-27 lead 単独判断で Phase 2.5 観察期間 8 日打ち切り + cold cut 前倒し採用 (PROJECT.md 2026-05-27 (追) entry 参照)、同日中に orc skill で implementer 委任 → code-reviewer 点検 → 3 commits 作成 (`19ca082` migrate Discord to Telegram supergroup topic model / `60c11d1` STATUS.md 実装 entry / `abaacea` review fixes)。直後に venv swap + systemctl restart + smoke test 一気通貫実施
  - **切替手順** (telegram-setup.md §6.2 通り、ただし OWNER_ID 上書き手順は本実施で漏れを発見 → setup.md §6.2 step 4 + §0 前提条件に補記済):
    - `systemctl --user stop companion-bot.service` (Discord bot 停止)
    - `mv venv venv-discord-backup` (rollback path、2026-06-04 cleanup 予定 = 切替 +1 週間)
    - `python3 -m venv venv` + `venv/bin/pip install --upgrade pip` + `venv/bin/pip install -r requirements.txt` (PTB v22.7 + aiolimiter 1.2.1 + apscheduler 3.11.2 + httpx 0.28.1 + dotenv 1.2.2 等 13 packages 導入)
    - `venv/bin/python -m unittest discover -s tests` → **54 tests 全 pass** (PTB skip 5 件が pass に転じた + 既存 quota 17 + 新規 sessions 12 + 新規 bot 5 + パラメータ展開分込)
    - `systemctl --user daemon-reload` + `systemctl --user start companion-bot.service`
  - **初回起動 (2026-05-28 00:18:41 JST) は OWNER 認可 4 段の段 1 で全 reject = 完全沈黙** = 想定通りの設計挙動だが原因切り分けに時間消費。原因: `.env` の `OWNER_ID=<旧 Discord OWNER_ID>` は Discord snowflake (18 桁) のまま、Telegram user.id (10 桁前後) ではなかった。setup.md §6.2 step 4 が「TELEGRAM_BOT_TOKEN / NOTIFY_CHAT_ID / BOT_THREAD_ID_* 追記」のみ示し OWNER_ID 上書きを明示していなかった手順穴 (本 entry で setup.md 修正反映済)
  - **OWNER_ID 修正** (00:26:33 再起動):
    - user が `@userinfobot` (Telegram 公式) で `/start` → Telegram user.id `<Telegram OWNER_ID>` 取得
    - `cp .env .env.discord-backup` (chmod 600、rollback path) + `sed -i 's/^OWNER_ID=.*/OWNER_ID=<Telegram OWNER_ID>/' .env`
    - `systemctl --user start companion-bot.service` で再起動 → `logged in as @companion_renbot (id=<bot id>)` / `notify chat verified: id=<NOTIFY_CHAT_ID> title='my group' type=supergroup` / `slash commands registered: ['reset', 'quota', 'status', 'play']` / `notify socket listening` の 4 行で正常起動
  - **smoke test 全 5 項目 + 1 catch-up 経路 pass** (2026-05-28 00:27〜00:30 JST):
    - `00:27:36 send len=10` → `#chat` (thread_id=3) で `@companion_renbot こんにちは` → claude 応答 + `sessions/topics/<NOTIFY_CHAT_ID>_3.json` 生成 (session_id=`71d8895f-3147-4dc4-876e-1b4b0f40abee`)
    - `00:28:11 send len=21` → `#research` (thread_id=4) で `@companion_renbot 何か検索して` → claude 応答 + `sessions/topics/<NOTIFY_CHAT_ID>_4.json` 生成 (session_id=`a73353cf-7202-45e6-99ed-5808ed89b601`) **= #chat と別 session として分離** ✓ (設計 §2.1 `(chat_id, thread_id)` 複合キー成立)
    - `00:28:36 cmd=/quota send len=319` → `/quota` slash command 動作 (BotCommandScopeChat 登録通り)
    - `00:29:01 cmd=/status send len=264` → `/status` slash command 動作
    - `00:29:23 cmd=/reset send len=68` → `/reset` で `#research` session 破棄
    - `00:30:02 send len=345` → /reset 後の `#research` で新 session (session_id=`feab1448-71ad-4480-9339-7c335d11e557`) で claude 応答
    - **catch-up 経路 (00:19:01)**: `notify forwarded len=117 critical=False` で `#maintenance` topic に system-report 通知が silent default で届いた = `_handle_notify` asyncio.Queue + worker (§5.2) 動作 + `[critical] ` プレフィクス非該当で `disable_notification=True` (silent) 通り
  - **ledger.jsonl 新 schema 動作確認**: `topic_key="<NOTIFY_CHAT_ID>_3"` / `topic_key="<NOTIFY_CHAT_ID>_4"` の文字列キーで 3 entries 追記、quota.py の `channel_id` → `topic_key` rename が ledger 経路でも整合 (modelUsage `claude-haiku-4-5-20251001` + `claude-sonnet-4-6` 両方記録、total_cost_usd 集計動作)
  - **rollback path (cold cut 当日に確保 → 2026-06-09 に撤去)**: `venv-discord-backup/` (PTB 不要、Discord 版 venv) + `.env.discord-backup` (旧 OWNER_ID + DISCORD_TOKEN 含む) を cold cut 当日に退避。2026-06-09 に OWNER 削除承認で両方 rm 済 (Telegram cold cut +12 日安定稼働を確認、A-2 → Done)。`sessions/channels/` (Discord 時代の session 群) は git 追跡外 + 空のため保全対象ゼロ = 移動不要と確定 (A-1)
  - **未実施項目** (別タスク、本 entry に含めない):
    - `sessions/channels/` の `.archive/channels-pre-telegram/` への rename (cold cut +1 週間 = 2026-06-04)
    - `claude_runner.py` の `run_discord` → `run_session_prompt` 改名 (telegram-design §8.5 commit 粒度 (4))、本 cold cut では platform 非依存なので無改変、別 commit 化
    - AIORateLimiter logger 2 名のうち 1 名削除判断 (実観測待ち、PTB v22 実機で retry 起きた時に bot.log でどちらの logger 名が出るか確認、不要な方を削る)
    - `BOT_THREAD_ID_VOICE_LOG` 環境変数設定 → Phase 4 voice bot 統合時に追加 (2026-06-01 に Phase 3-2 から Phase 4 移送)
  - **Phase 4 着手条件 #2 観察カウント**: 2026-05-28 起算 = **2026-06-11 完了予定** (Telegram 観察 14 日)、PROJECT.md 2026-05-27 (追) entry のタイムライン (cold cut 5/27 起算 = 6/10 完了予定) から 1 日遅延 (cold cut 切替が 5/27 23:00 から 5/28 00:18 にまたいだため)。**2026-06-01 更新**: voice を Phase 4 移送したため『voice/ 統合 +14 日』律速は撤回。bot.py の最後の大改変は Telegram 移行 (5/28) で、条件 #2 判定日 = 2026-06-11。Phase 4 着手目安は最短 6/11 +α (条件 #1 vault 充足 / #2 6/11 判定 / #3 user 宣言)。前提 = 当面 bot.py を大きく触らない (remote v1-β 保留)。**同日追加判断 (2026-06-01)**: 条件 #2 を Phase 4 着手の門から外す (bot.py 大改変時の様子見へ再定義、2 週間固定にしない)。Phase 4 は条件 #1 (vault 充足) + #3 (user 宣言) で着手可。6/11 判定は撤回。Telegram 観察は次の bot.py 大改変時の様子見の前例として扱い、フェーズの門にはしない

- 2026-05-28 Phase 2.6 cold cut 実装: Discord SDK → python-telegram-bot v22.7 全面書き換え (commit までで停止、venv swap / systemctl restart / push は orc 外の次タスク)
  - **設計 center of truth**: `~/companion/workspace/redesign/telegram-design.md` §1〜§8 確定版、実装ガード 16 項目 (OWNER 4 段防御 / privacy mode off / chunk_telegram TELEGRAM_MAX=4000 / AIORateLimiter 委譲 / parse_mode 未指定 / BotCommandScopeChat 限定 / edited_message filter / stall_check_job / `_handle_notify` queue + worker / sessions schema 2 軸 / sessions ファイル path / sessions/channels/ 残置 / ledger.jsonl `topic_key` field / catch-up 無改変 / AIORateLimiter logger INFO / stale-thread-observation jsonl は YAGNI で未実装) すべて反映
  - **変更ファイル (6 + 1)**:
    - `bot.py`: 全面書き換え (~410 行、PTB v22.7 ApplicationBuilder / handler / post_init / post_shutdown / notify queue worker / stall check job 等)
    - `sessions.py`: `(chat_id, thread_id)` 複合キー、`topic_key()` モジュール関数 + プロパティ、General topic = `'general'` 固定 suffix (§2.3)、`_SESSIONS_DIR` を `sessions/topics/` に変更
    - `quota.py`: `_record_common` / `BudgetGuard` ABC / `RequestsCountGuard` / `CreditBudgetGuard` の引数キーワード `channel_id` → `topic_key` rename (BudgetGuard ABC 本体ロジックは無改変)、ledger.jsonl field 名も `channel_id` → `topic_key`
    - `requirements.txt`: `discord.py>=2.3,<2.4` → `python-telegram-bot[rate-limiter,job-queue]>=22.7,<23`
    - `.env.example`: `DISCORD_TOKEN` / `NOTIFY_CHANNEL_ID` 削除、`TELEGRAM_BOT_TOKEN` / `NOTIFY_CHAT_ID` / `BOT_THREAD_ID_CHAT` / `BOT_THREAD_ID_RESEARCH` / `BOT_THREAD_ID_MAINTENANCE` / `BOT_THREAD_ID_VOICE_LOG` 追加
    - `companion-bot.service`: Description 1 行差し替えのみ (`Discord` → `Telegram`)、`ExecStart` / `ExecStartPost` 2 行 / `Environment` / `Restart` は完全無改変 (catch-up 経路無改変ガード遵守)
    - `tests/test_quota.py`: `_make_entry` の `channel_id` field → `topic_key` field rename、`test_record_appends_ledger` の `channel_id=42` 引数 → `topic_key="-1001234567890_2"` rename
  - **新規追加ファイル (2)**:
    - `tests/test_sessions.py`: 12 ケース (topic_key formatting / General topic suffix / General と numeric 0 が衝突しないこと / save/load round-trip / start_or_resume 新規発番 + 再呼び出し / 異なる thread_id で異なる session / reset)
    - `tests/test_bot.py`: bot.py 純関数のユニットテスト 5 case 群 (chunk_telegram 改行優先 fallback / _normalize_play_url allowlist / _fmt_duration / cmd_reset / _authorized 4 段防御)。PTB 未導入環境では `SkipTest` で自動 skip
  - **設計と実装の差分 1 件**:
    - telegram-design §4.1 では `telegram_io.py` を新規ファイルとして分離する案だったが、orc タスク指示の対象ファイル 6 件に `telegram_io.py` 含まれず、独断で新規ファイル追加せず `bot.py` 単体に統合 (`chunk_telegram` / `send_text` / `_typing_action` 等を bot.py 内に配置)。将来分割は YAGNI、必要になった時点で別 commit で抽出可能 (`chunk_telegram` は pure function、`send_text` も bot 引数注入なので分離コスト低い)
  - **動作確認**:
    - `venv/bin/python -m py_compile bot.py sessions.py quota.py` → 構文エラーなし
    - `venv/bin/python -m unittest discover -s tests -v`: 29 ケース全 pass + 5 ケース skip (PTB 未導入の bot.py 関連、venv swap (orc 外の次タスク) 後に解消)
      - 既存 quota テスト 17 件: 全 pass (`channel_id` → `topic_key` rename 整合)
      - 新規 sessions テスト 12 件: 全 pass (General topic suffix / numeric 0 衝突回避 / round-trip)
      - 新規 bot.py 関連テスト 5 件 (chunk_telegram / _normalize_play_url / _fmt_duration / cmd_reset / _authorized): SkipTest (PTB 未導入)
    - PTB v22 実機 import 検証: auto mode classifier で `/tmp` venv への pip install が拒否されたため未実施。`ast` で import 文を機械抽出し、PTB v22 公式 import パス (`telegram.{BotCommand, BotCommandScopeChat, ReplyParameters, Update, User, Chat, Message}` / `telegram.constants.ChatType` / `telegram.ext.{AIORateLimiter, Application, ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters}`) との整合は静的確認済。venv swap 時に `bot.service` 起動で post_init の `bot.get_me()` / `set_my_commands` が正常呼び出されるかは smoke test で最終確認
  - **commit までで停止 (次タスクは orc 外で user 側実施)**: `telegram-setup.md` §6.2 step 1〜7 (Discord bot 停止 / venv swap / .env 追記 / daemon-reload / start / smoke test)。`.env` の `TELEGRAM_BOT_TOKEN` 追記 + `NOTIFY_CHAT_ID=<NOTIFY_CHAT_ID>` / `BOT_THREAD_ID_CHAT=3` / `BOT_THREAD_ID_RESEARCH=4` / `BOT_THREAD_ID_MAINTENANCE=5` 追記は user 操作
- 2026-05-23 claude CLI 2.1.145 → 2.1.149 軽量再検証 + `~/.claude/CLAUDE.md` の Fast モード記述更新 (`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」運用ルール準拠、M-7 と同方針)
  - **経緯**: ユーザー手元 UI に update 通知。`claude update` は up-to-date 応答（ローカル既に 2.1.149、`npm view @anthropic-ai/claude-code dist-tags` で latest/next=2.1.149, stable=2.1.142 を確認）。前回検証 (M-7, 2.1.145, 2026-05-20) 後の 4 日で自動更新が走った後の通知だった可能性
  - **検証方針**: 軽量再検証 (S3 + `--help` / `--bare` 文言差分) で完了。フル S1/S2/S4/S5 は前回 2.1.145 で全 pass + 今回 `--help` 文言に bot.py 経路 (`--session-id` / `--resume <uuid>` 固定ルート) を脅かす差分なしと判定し、credit 抑制 (Max 5x プラン前提)
  - **結果**:
    - **S3 (存在しない uuid resume)**: `claude -p --resume 00000000-... "ignored"` → rc=0, stdout `No conversation found with session ID: <uuid>`。bot.py は `sessions/channels/<channel-id>.json` で session 存在を事前判定して `--resume` を非存在 uuid に呼ばない設計のため実害なし (design.md §1.4 stderr マッチ自動 fallback 禁止と整合)
    - **`--bare` 説明文**: M-7 (2.1.145) と完全同一文言 ("Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper..." )、オプトインのまま、デフォルト動作変更なし。Max 5x は OAuth 認証経由のため `--bare` は使用不能のままで、N4 監視「bot.py は明示的に `--bare` を使わない」継続妥当
    - **`--help` 新規フラグ**: `--fork-session` / `--from-pr [value]` / `-n, --name <name>` / `--no-chrome` を追加観測。いずれも bot.py 経路 (`--session-id <uuid>` / `--resume <uuid>` 固定) に影響なし。`--fork-session` は将来 bot 側で「同一 channel の継続を fork したい」要件が出た場合の活用候補だが現状 YAGNI、必要時に新規設計判断として再評価
    - **encoded-cwd 規則** (`/` → `-`): `~/.claude/projects/-home-miho-companion-bot-workspace/` 配下が bot 実運用で 5/14 以降生成され続けており、規則変更なし
  - **CLAUDE.md 修正**: `~/.claude/CLAUDE.md` L37 の「Fast モード（Opus 4.6 高速版）の場合も 4.6 ルールを適用する」を「Fast モードのデフォルトは claude CLI 2.1.142 から Opus 4.7 に変更（旧: Opus 4.6 高速版）。Fast セッションでも判定は冒頭の "powered by" 行に従い、宣言されたモデルのルールを適用する」に更新（2.1.142 リリースで Fast デフォルト = Opus 4.7 化、判定をモデル宣言ベースに明文化）。`~/.claude/CLAUDE.md` はユーザー私的 dotfile で git 管理外、本コミットには含めず本 entry に経緯を残す
  - **companion repo 側の修正対象**: `/simplify`→`/code-review` 改名 (2.1.147) / `/extra-usage`→`/usage-credits` 改名 (2.1.144) の旧名参照を `~/.claude/CLAUDE.md` / `~/companion/CLAUDE.md` / `~/companion/workspace/CLAUDE.md` / `~/companion/vault/CLAUDE.md` / `~/companion/bot-workspace/CLAUDE.md` で grep → **該当なし** (companion 側は既に新名運用 or そもそも参照なし)
  - **bot.py / claude_runner / sessions 側の変更**: なし。CLI フラグ追加・S3 stdout 文言・`--bare` 説明文すべてに bot.py の挙動を変える差分なし
- 2026-05-20 軸 5 設計 doc 耐久性レビュー (agent team `companion-durability-0520`) 集約結果
  - **概要**: 5/20 軸 5 を 5/26 推奨から前倒し起動 (lead 単独判断、devil D-C 致命級指摘の出発点)、3 teammate (architect / devil / ux) Round 1〜Round 2 で集約。集約成果物 = `~/companion/workspace/review-2026-05-20/axis-5-result.md` (center of truth、落とし穴 F 通り teammate plan ファイル消失防護のため lead 単独責任で転記済)
  - **修正必須 14 件 (M-1〜M-14) 反映済**: 詳細 axis-5-result.md §2 参照
    - M-1 (PROJECT.md 健全性履歴運用ルール昇格) / M-14 (PROJECT.md remote/ 同居境界原則) / S-1〜S-4 (PROJECT.md 設計判断履歴) / 観察期間定義精密化 → PROJECT.md 健全性履歴 5/20 entry 更新
    - M-2 (§0 主張訂正) / M-3 縮退 (§3 図 + §3.4 inline 注記強化、追加分割は YAGNI Phase 4 punt) / M-4 (§4.2 末尾実機 enable 確認手順) / M-5 (§4.7 末尾 4 段階拡張 2 周目明記) / M-6 (§10.2 末尾 `_STDERR_PATTERNS` 3 件目判定基準) → design.md 反映
    - M-8 (§1.4 引数長 multi-tier bot.py 100 字 + cmd_say wait_for 90s + 境界変更時判定基準) / M-9 (§1.9 起算日明示 = bot/ 側完了起算) / M-10 (§1.9 Phase 4 trigger 4 項目再構成) / M-11 (§5.3 末尾 maintenance/ 追記タイミング明示) → voice-design.md 反映
    - M-12 (vault-sync-from-transcript.sh 冒頭コメント rc!=0 後処理禁止事項明文化) → web/scripts/ 反映
    - **M-7 (claude CLI 2.1.145 STATUS.md 無記録 up 補正)**: 本 entry の **詳細 sub-entry** 参照 (本 review 完了後最優先タスク、lead 実機検証で 2.1.141 → 2.1.145 検出)
    - **M-13 (Discord 通知 1 行投稿、voice/ 側完了 + bot/ 6 月上旬目処)**: bot/ 側 ad-hoc 投稿、commit 不要
  - **3 teammate 一致確定 4 件**:
    - (a) 対症療法 2 周目候補警戒順序 **C-3 > C-2 > C-1** (architect Round 1 C-1 1 位から部分転換)
    - (b) **軸 5 二段階方式採用** (5/20 静的整合性完遂 + Round 4 = 5/26 以降 or 6/2 完了後の実観測再点検を別 session 予約、user 判断 (b) 今日完結と両立)
    - (c) **「実害ゼロ常態化」N=5 連続で仕切り直し境界化** (現状 4 回連続 = 5/9 / 5/14 / 5/18 / 5/20、devil D-A 自己訂正で 5 → 4 回に確定)
    - (d) architect M2-3 引数長 multi-tier RTF 超過確認 (warm RTF 0.463 秒/字 × 200 字 + cold 17 秒 = 103-110 秒で wait_for(60s) 圧倒的超過、ux Round 1 §2.5 計算混同を Round 2 で自己訂正)
  - **構造的指摘 8 件 (S-1〜S-8)**: 書面化先は axis-5-result.md §3 表参照。S-1〜S-4 は PROJECT.md 健全性履歴 5/20 entry「設計判断履歴」section に記録済、S-5 は design.md §0 末尾 + §11.4、S-6 (case A 5 案優先順序) は voice-design.md §5.1 末尾 (architect Round 1 たたき台残置)、S-7 は design.md §6.2 補足、S-8 は PROJECT.md L213 補足
  - **観察項目 19 件 (K-1〜K-19) 統合済**: 上記「Phase 2.5 健全性 2 週間観察」section 参照、Round 4 で実観測再点検実施
  - **Round 4 起動条件**: (i) 観察期間完了 2026-06-02 or 5/26 以降の早期点検判断 (ii) 観察データ初期メトリクス確定 (iii) 観察期間中発覚 issue + 判定保留軸の再点検 (axis-5-result.md §6)
  - **team cleanup**: 本 entry + axis-5-result.md 転記完了確認後、architect / devil / ux に shutdown_request → approve → TeamDelete 予定
  - **落とし穴 D 違反訂正の書面化**: lead 自身が axis-5 prompt 5/26 推奨を 5/20 に前倒し判断 = lead 単独責任で「user 判断 (b) と両立する形で実施」明示済 (PROJECT.md 健全性履歴 5/20 entry S-4)
  - **claude CLI 2.1.141 → 2.1.145 無記録 up 検出 + 再検証完了 (M-7、本 entry 詳細)**:
    - 5/20 軸 5 lead 実機検証で `claude --version` = **2.1.145** 確認、本 STATUS.md L234 (2026-05-14 T-0) の 2.1.141 記録から 4 バージョン分上昇が無記録で進行
    - design.md §1.5 / §10.4 + `~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」運用ルール違反、devil P1「実害ゼロ常態化」と方向は別軸だが補強材料
    - 観察期間 (2026-05-19〜2026-06-02) の bot.service が **2.1.141 想定設計で 2.1.145 実機運用** している差分あり、5/20 軸 5 完了直後に再検証実施
    - **再検証結果 (2026-05-20 軸 5 完了直後実施)**: S1-S5 全シナリオ pass + design.md §1.5 (2.1.138) / 5/14 T-0 (2.1.141) と完全一致:

  | シナリオ | コマンド | 結果 (2.1.145) | 5/14 T-0 (2.1.141) / design.md §1.5 (2.1.138) 一致 |
  |---|---|---|---|
  | S1 新規 | `--session-id $(uuidgen) "..."` | rc=0、`~/.claude/projects/-tmp-bot-cli-verify-2026-05-20/<uuid>.jsonl` 作成、stdout=`ALPHA` | ✓ |
  | S2 継続 | `--resume <uuid> "..."` | rc=0、直前 ALPHA を想起 = 文脈保持 | ✓ |
  | S3 lost | `--resume <存在しない uuid>` | rc=1、stderr `No conversation found with session ID: <uuid>` | ✓ 完全一致 |
  | S4 in-use | `--session-id <既存uuid>` | rc=1、stderr `Error: Session ID <uuid> is already in use.` | ✓ 完全一致 |
  | S5 json | `--output-format json --session-id <new> "..."` | rc=0、JSON 単一オブジェクト | ✓ + 追加情報 (`ttft_ms` 新規) |

    - 検証 CWD: `/tmp/bot-cli-verify-2026-05-20/`、env unset 5 件 (CLAUDECODE / CLAUDE_CODE_ENTRYPOINT / CLAUDE_CODE_EXECPATH / CLAUDE_CODE_SESSION_ID / ANTHROPIC_API_KEY)、Haiku 4.5 model (検証コスト最小化、S5 cost = $0.01370685)
    - encoded-cwd 規則 確認: `/tmp/bot-cli-verify-2026-05-20` → `-tmp-bot-cli-verify-2026-05-20`、JSONL 保存先 = `~/.claude/projects/-tmp-bot-cli-verify-2026-05-20/<uuid>.jsonl` ✓
    - **S5 stdout 新規観察 (2.1.145 で 5/14 T-0 2.1.141 から追加)**: `ttft_ms: 5875` (time to first token、cold start 計測材料)、その他は 2.1.141 と同等 (生データ: `bot/docs/reviews/2026-05-20-cli-2.1.145-S5-stdout.json` に保管)
    - **`--bare` 動作確認** (§1.8 #5、N4 監視): 説明文「Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read). 3P providers (Bedrock/Vertex/Foundry) use their own credentials. Skills still resolve via /skill-name.」 → オプトインのまま、デフォルト動作変更なし、5/14 T-0 (2.1.141) と同等。N4「bot.py は明示的に `--bare` を使わない」継続妥当
    - **design.md §1.5 への反映**: 末尾に「2.1.141 (5/14 T-0) + 2.1.145 (5/20 M-7) でも S1-S5 結果完全一致、`ttft_ms` 新規追加」追記 (別 commit、本 entry の commit と合わせて 2 commits)

- 2026-05-20 全体コードレビュー (Phase 2.5/3-2 直後 fresh-eye) で発覚した bot/ 側 修正必須 2 件 + 軽微 5 件 を反映
  - **背景**: 健全性 2 週間観察期間 (2026-05-19〜2026-06-02) の起点で、Phase 2.5 + Phase 3-2 voice/ 側完了直後の fresh-eye として全体レビュー (Claude 直接 + code-reviewer subagent × 3 並列 / agent team 1 軸 punt 可) を実施 (PROJECT.md 健全性履歴 2026-05-20 entry 参照)
  - **修正必須 A-1**: `bot/tests/test_quota.py` が repo 不在 → 新規追加 (17 テスト全 pass。`_aggregate` JST 正規化 / RequestsCountGuard `<` 境界 / CreditBudgetGuard 月初リセット境界 / make_budget_guard env 切替 + 値バリデーション / exceeded_message 文言を網羅)
  - **修正必須 A-2**: `bot/bot.py:101` の旧 `logger.warning` が credit_usd 経路で `count_1h=0/None` と読めない文字列を出力 → `guard_kind` 別の 2 分岐に修正、観察期間中の log S/N を回復
  - **軽微 B2-1**: `quota.py` `CreditBudgetGuard.allow` の float 直接比較 `<` に「丸め誤差は 1 セント未満で実質影響なし、Decimal 化までは過剰」コメント 1 行
  - **軽微 B2-2**: `quota.py` `_aggregate` 入口で `now = now.astimezone(JST)` 1 行正規化。bot.py 経由では JST 揃いだが、テスト / 将来 UTC 入力でも month_start / 1h / 5h window が JST 基準で揃う
  - **軽微 B2-4**: `quota.py` `make_budget_guard()` で `BOT_REQUESTS_PER_HOUR` / `BOT_MONTHLY_CREDIT_USD` の早期バリデーション (非数値 / 負値で `ValueError`)。誤設定で全 deny / allow() 呼び出し時遅延発火を防止
  - **軽微 B4-3**: `design.md` §3.4 `sessions.reset(channel_id) -> SessionMeta` 表記を `-> bool` に訂正 (実装は bool、bot.py L141 で bool 評価のみ、設計の単純化と整合)
  - **軽微 B4-4**: `bot/bot.py` `_handle_notify` の `reader.read()` を `reader.read(1_000_000)` 上限付与。同 UID bug / 暴走による無制限メモリ消費を物理的に止める
  - **不採用**: B2-3 (`last_call_at` dead carry → 将来 `/status` 拡張で使う可能性、残置) / B2-5 (.env.example 重複説明 → 読みやすさ優先)
  - **対症療法 2 周目候補 (事前警戒、修正対象外)**: (1) `claude_runner._STDERR_PATTERNS` 現 2 件、3 件目を増やしたら 2 周目 (CLAUDE.md「stderr 文言マッチ / エラー分類 enum case を増やす修正」)。次は「sessions JSON の state を引けば一意に決まらないか」を先に問う。(2) `bot.py CLAUDE_TIMEOUT` 既定 300s 1 周目、次に伸ばす修正が来たら設計に戻る。長時間応答は MCP/tool 起動が原因のことが多く、`permission_mode` / tool allowlist 側で短絡するのが筋。(3) `vault-sync-from-transcript.sh` rc!=0 後処理に「stderr マッチでリトライ」「自動 reset」追加は 2 周目
  - **作業範囲**: `bot/bot.py` + `bot/quota.py` + `bot/tests/__init__.py` (新) + `bot/tests/test_quota.py` (新) + `bot/docs/STATUS.md` 本エントリ + `workspace/redesign/design.md` §3 図差分追記 + §3.4 戻り型訂正。design.md / PROJECT.md 修正は workspace 直下 (git 化なし) で同期、bot/ commit には含まない
  - **code-reviewer**: 軸 2/3/4 で並列実施済 (本エントリ 反映の根拠)、再レビュー不要
  - **次タスク**: 観察期間 (2026-05-19〜2026-06-02) 継続観察、追加観察項目は本台帳 L37-39 参照

- 2026-05-19 STATUS.md L29 drift 解消 (design.md §4 反映済表記への更新、`2611ee9` push 済)
  - **背景**: 同日中の T-D 後半 CreditBudgetGuard 即時前倒し完了で design.md §4.2 / §4.5 / §4.6 / §15 が反映済になったが、本台帳 L29 設計根拠行が「§4 は ... voice 系作業と同じ commit で別途反映予定」のまま drift 残置
  - **更新内容**: L29 → 「§4.2 / §4.5 / §4.6 / §15 に 2026-05-19 CreditBudgetGuard 即時前倒し追補を反映済」
  - **作業範囲**: bot/docs/STATUS.md L29 1 行、計 1 ファイル
  - **code-reviewer**: 省略 (drift 整備のみ実装変更ゼロ、前回 5/19 「workspace/CLAUDE.md §B-2 反映済 drift 解消」エントリと同方針)
  - **次タスク**: Phase 2.5 健全性 2 週間観察期間 (2026-05-19 〜 2026-06-02) 継続観察

- 2026-05-19 Phase 2.5 T-D 後半 (CreditBudgetGuard) 実装 + 2026-05-19 即時前倒し有効化 (design.md §4.2 → §4.6)
  - **背景**: 元設計では T-D 後半 = 2026-06 上旬実施予定 (design.md §4.2「意図的に伸ばす、当時に新クレジット制の挙動詳細が公式 release で出揃う想定」)。voice/ 側前倒し完了後 (5/19 完了基準 (i) 達成) で空白期間 2〜3 週間が発生、user 確認で「6月の変更以外を前倒しできないか、そうしないと 1 ヶ月近く何もできない」→ ledger.jsonl 検証 (5/14〜5/19 で累計 $0.7961 = 月次 $100 の 0.80%) + user 認識訂正 (companion-bot は `claude -p` のみで Anthropic API キーは使わない、6/15 はカウント方式変更 (5h cycle → 月次クレジット制度)、Anthropic Max 5x プラン公式メールで $100/月確定) で **CreditBudgetGuard 実装 + 即時切替を採用**
  - **設計判断履歴 (空白期間活用)**:
    - design.md §4.5 「Anthropic クレジット残量の公式 API 経由照会」は Anthropic Console 使用量自動取得手段 (オプション拡張) を指す、bot 実装本体は `claude -p --output-format json` の `total_cost_usd` ledger 累計で完結。公式 release で前提が変わる手戻りリスクは実装本体には無関係 (将来オプション拡張で取り込み可、これは「対症療法」ではなく「機能拡張」)
    - `MONTHLY_BUDGET_ACTIVE_FROM = 2026-06-15` プレースホルダ境界は user 選択で (α) 撤廃、`format_summary()` の本月累計行を常時表示に簡素化
    - 月次クレジット枠 = $100 (Max 5x プラン、Anthropic 公式メール文面で確定、design.md §4.1 UQ-5 と整合)
    - devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) との衝突なし: voice/ 側完了済 + bot/ 側 voice は 6 月中下旬予定、CreditBudgetGuard は bot.py / quota.py のみで完結 = voice 側と独立
  - **実装内容** (3 ファイル):
    - **`bot/quota.py`** (≈340 行):
      - module docstring 更新 (CreditBudgetGuard 即時前倒しの設計参照 + プレースホルダ撤廃を明記)
      - `MONTHLY_BUDGET_ACTIVE_FROM` 定数撤廃、`BudgetSummary.monthly_budget_active: bool` フィールド撤廃
      - `_aggregate(ledger_path, now) -> dict` helper 新設 (両 guard が共通で使う ledger 集計、§4.6 共通スキーマ)、`_record_common(...)` helper 新設 (両 guard 共通の ledger append)
      - `BudgetGuard` ABC に `exceeded_message(summary) -> str` を abstract method 追加 (元 bot.py hardcode 文言を guard 側責務に集約)
      - `RequestsCountGuard` を `_aggregate` + `_record_common` 使用に refactor、`exceeded_message()` 追加 (回帰テスト pass)
      - `CreditBudgetGuard` 新規実装: `allow(now)` = 月初 (00:00 JST) 〜 now の累計 < `monthly_budget_usd`、`record()` = `_record_common` 経由、`summary()` = `guard_kind="credit_usd"` / `limit_per_hour=None`、`exceeded_message()` = 「月次予算 $X.XX / $100.00 到達、月初までクールダウン」(design.md §4.4 第 2 期文言)
      - `format_summary()`: `if s.monthly_budget_active:` 分岐削除、常時「本月累計 $X.XX / $100.00 (使用 N%, 残り $Y)」表示、`[guard: credit_usd / 本月 $X/$Y]` 表示分岐追加
      - `make_budget_guard()`: `credit_usd` 分岐を `NotImplementedError` から `CreditBudgetGuard(monthly_budget_usd=BOT_MONTHLY_CREDIT_USD default 100)` に切替
    - **`bot/bot.py`** (`run_claude` 周辺、約 5 行差分):
      - logger.warning フォーマット拡張 (`kind=%s ... cost_month=%.4f/%.2f` 追加、credit_usd 経路でも有意な観察値が残る)
      - hardcode 超過文言を `budget_guard.exceeded_message(summary)` 呼び出しに置換
    - **`bot/.env.example`**:
      - `BOT_BUDGET_GUARD` default を `requests_count` → `credit_usd` に変更 (即時切替方針)
      - `BOT_MONTHLY_CREDIT_USD=100` 新規追加 (Max 5x プラン枠の説明文付き)
      - 既存 `BOT_REQUESTS_PER_HOUR=20` は残置 (requests_count に戻す時のため、コメントで明示)
  - **単体テスト (venv 経由で 9 テスト全 pass)**:
    1. CreditBudgetGuard.allow() under/at/over budget (80/100=True, 100/100=False, 105/100=False)
    2. 月初リセット境界 (5/19 → 6/1 で過月分 200 がリセットされ True)
    3. summary() schema (guard_kind="credit_usd" / limit_per_hour=None / monthly_budget_active 属性なし)
    4. format_summary() 本月累計常時表示 (プレースホルダ文言「集計中」が出ないこと)
    5. exceeded_message() 文言確認
    6. make_budget_guard() env 切替 (credit_usd / requests_count / bogus → ValueError)
    7. RequestsCountGuard 回帰 (limit=3 で 3 件 deny)
    8. RequestsCountGuard.exceeded_message() 回帰
  - **適用手順** (user 操作):
    - `bot/.env` を `.env.example` 差分に倣って `BOT_BUDGET_GUARD=credit_usd` + `BOT_MONTHLY_CREDIT_USD=100` を追加 (`BOT_REQUESTS_PER_HOUR` は残置でも可、未使用になる)
    - `systemctl --user restart companion-bot.service` で反映
    - Discord で `/quota` 実弾、`[guard: credit_usd / 本月 $X.XX/$100.00]` 表示 + 本月累計行常時表示 + 「集計中」プレースホルダ消滅を確認
  - **code-reviewer**: 修正必須 1 件 (本台帳の TODO「T-D 後半 (2026-06 上旬実施)」記述を更新 = 本エントリで反映済)、軽微提案 2 件 ((i) `sessions/ledger.jsonl` 0o600 化 = bot.py L68 chmod ループに追加済 (ii) 月末枠到達時の手動引き上げ手順 = 本台帳「運用注記」section 新設で追加済) いずれも採用反映
  - **Phase 2.5 完全完了 = 健全性 2 週間観察カウント 2026-05-19 から開始**:
    - PROJECT.md L262 「Phase 4 着手条件 #2 観察カウントは Phase 2.5 完全完了 (T-D 後半含む) 後の 2026-06 中旬から開始」→ T-D 後半完了が 2026-05-19 に早まったため、観察カウント開始も 2026-05-19 に前倒し
    - 2 週間経過 = 2026-06-02、その後 voice bot/ 側実装 (devil T-D-1(d) 順序原則) → 2026-06 上旬目処
  - **次タスク**: 関連台帳 (design.md §4 訂正 / voice/docs/STATUS.md T-D 後半完了反映 + bot/ 側着手時期前倒し / PROJECT.md 健全性チェック履歴 + Phase 2.5 完了状況更新) を別 commit で反映

- 2026-05-14 `/play` 追加実装の周辺改善 (診断 log + log 権限厳格化)
  - **背景**: `/play` の allowlist 拒否時に bot.log で原 URL が判別できず原因切り分けが効かなかった (短縮 URL を渡して拒否されたが、log 側からは `cmd=/play send len=82` のみで内容不明)。
  - **`bot.py` `/play` log**: `logger.info("cmd=/play url=%r send len=%d", url, len(output))` で URL 本文を残す。`%r` で改行 / 制御文字 / 引用符を含む攻撃的入力でも 1 行に収まり log forging されない。
  - **`bot.py` log 権限**: `os.umask(0o077)` を起動時に設定し、RotatingFileHandler が作る初期 / rotation 後 active log を 0o600 で開かせる。起動時に既存 `bot.log` および `bot.log.*` rotated backup を explicit `os.chmod(..., 0o600)` で 0o600 へ寄せる。副次的に `sessions/` / `quota.py` の state file 新規作成分も 0o600 になる (内部 state なので破綻なし)。
  - **`docs/STATUS.md` 設計メモ**: 「log 方針」行を追加。URL log は OWNER 限定経路前提の方針であることを明記。将来 OWNER 以外コマンドを追加する際は再評価すること。
  - **code-reviewer 軽微提案 2 件反映済み**: log 権限 0o600 化、STATUS.md 注意書き追加。
  - **適用手順**: `systemctl --user restart companion-bot.service` で適用。新しい log は 0o600 で書かれ、既存 9KB 程度の bot.log も即座に 0o600 になる。

- 2026-05-14 `/play` slash command 追加 (Phase 2.5 ロードマップ外、ユーザー要望での追加実装)
  - **背景**: Discord メンション本文に URL を渡すと bot は `claude -p` セッションに食わせて応答する設計のため、再生用途には不向き。slash command であれば session 文脈と独立して扱える
  - **`bot.py`**: `urlparse` import / `PLAY_ALLOWED_HOSTS` (youtube.com, www.youtube.com, m.youtube.com, music.youtube.com, youtu.be) と `PLAY_TIMEOUT_S=10.0` 定数 / `_normalize_play_url()` (空白・制御文字拒否 + http/https のみ + userinfo (`https://evil@youtube.com/...`) 拒否 + hostname allowlist) / `async cmd_play()` (`asyncio.create_subprocess_exec("xdg-open", url, env=...)`、`DISPLAY=:0` と `XAUTHORITY=~/.Xauthority` を setdefault、`wait_for` timeout 時は `kill()+wait()` で zombie 回収) / `@client.tree.command(name="play", url:str)` slash command (OWNER チェック → `defer(thinking=True)` → `cmd_play` → `followup.send`)
  - **`companion-bot.service`**: systemd user unit に `Environment=DISPLAY=:0` と `Environment=XAUTHORITY=%h/.Xauthority` を追加 (デフォルト user unit には GUI セッションの X11 接続情報が無いため明示的に渡す必要がある)
  - **code-reviewer 軽微提案 2 件反映済み**: userinfo 詐称 URL 拒否、`wait_for` timeout 時 `proc.kill()+wait()` で subprocess の zombie 化を防止
  - **セキュリティ前提**: `subprocess_exec` (shell=False 相当) + allowlist で shell 注入の余地なし、OWNER_ID チェックは既存 `_reject_non_owner` と共通
  - **運用前提**: GUI セッションがログインしている前提。ログアウト中は xdg-open が失敗するが bot 側でその旨を返答する。複数 X seat 環境では `DISPLAY=:0` hardcode が破綻するが現状この PC は単一 GUI セッション
  - **適用手順**: `systemctl --user daemon-reload && systemctl --user restart companion-bot.service` で env 変更を反映。slash command 自体は bot 起動時に `on_ready` 内で guild 同期される

- 2026-05-14 Phase 2.5 T-E: bot 起動時 catch-up 発火 + CLAUDE.md 3 層分割を最終形へ (design.md §7.2 + §1.2)
  - **`~/companion/CLAUDE.md` (共通項)**: skeleton (2026-05-12) → 最終形 (2026-05-14)。「口調基準」章を追加 (手元 claude code セッション = 通常レビュー / 設計議論トーン、Discord 経由 bot セッション = フランクで短く emoji 最小 + Phase 4 で後のせ)、subordinate CLAUDE.md セクションの workspace 行ラベルを 3 層分割後の実体に整合 (Repository State / PROJECT.md 参照 / workspace 直下 git 化方針 / settings.json 解説 / Task Workflow / Agent Teams 運用方針)、最終更新と根拠 § を更新
  - **`~/companion/workspace/CLAUDE.md`**: 共通項 (Language / git 汎用ルール / Workspace Layout / Project Roadmap の汎用部分) を上位 `~/companion/CLAUDE.md` に移譲して削除。残置は Repository State / Project Roadmap (PROJECT.md 参照) / Workspace 直下の git 方針 (workspace 限定の話のみ) / Security Settings / Task Workflow / Agent Teams 運用方針 (公式仕様参照 + companion 固有の前提 + 落とし穴 A〜F)。冒頭で「上位 `~/companion/CLAUDE.md` 参照」「bot 経路は `~/companion/bot-workspace/CLAUDE.md` 側で動く」の境界を明示
  - **`~/companion/bot-workspace/CLAUDE.md`**: skeleton (2026-05-13) → 最終形 (2026-05-14)。Language 章の口調記述を上位 §口調基準への参照に縮退 (上位更新時の drift 回避)、それ以外は内容据え置き
  - **`bot/companion-bot.service` `[Service]` に `ExecStartPost` 2 行追加**: design.md §7.2 表の「過去 log 読取型 (unattended-upgrades)」「時点 snapshot 型 (system-report)」両方を bot 起動完了 + 15 秒 で 1 回発火。`systemd-run --user --on-active=15s --unit=companion-bot-catchup-{unattended-upgrades,system-report} --collect /usr/bin/systemctl --user start --no-block companion-notify-{...}.service` の形で transient timer から既存 oneshot service を蹴る (起動経路を既存日次 timer と一元化)。`-` prefix で ExecStartPost 失敗を無視、`--collect` で transient unit が走り切ったら自動 GC
  - **design.md §7.2 原案からの調整**: 設計文書では `systemd-run --user --on-active=15s --unit=companion-bot-catchup-... companion-notify-...service` の syntax だったが、これは COMMAND として `companion-notify-...service` を実行ファイルとして exec しようとして `Failed to find executable` で rc=1 になる (実機 2026-05-14 確認)。`--unit=既存ユニット名` で COMMAND 省略する case (既存ユニットを発火する transient timer 単体作成) も既存 `companion-notify-*.timer` (日次) と name 衝突するため不可。code-reviewer の経路一元化指摘 ((a)) を採用して transient unit の COMMAND を `systemctl --user start --no-block companion-notify-*.service` 経由に倒し、既存 oneshot 側の ExecStart 行を唯一の真実として保つ
  - **二重通知抑止**: `notify-system-report.sh` / `notify-unattended-upgrades.sh` 冒頭の `state_matches "$today"` で同日 2 回目以降は skip exit 0。catch-up 経路と日次 timer 経路が同じ日に併走しても Discord に重複は飛ばない (T-E 実装の前提)
  - **bot.service 再起動と transient unit 衝突**: Restart=on-failure で再起動した場合、catch-up 用 transient unit (`companion-bot-catchup-*`) が前回起動時のものとして残っていると同名作成で衝突する理屈上の懸念がある。`--collect` で transient unit は run-then-cleanup される + 通常起動完了から transient script 実行終了まで ~20 秒程度なので、bot が 30 秒未満で頻発再起動しない限り衝突しない想定。観察したら設計再考。Restart=on-failure 自体の発火頻度は実弾運用で T-A 以降 0 件
  - **実弾確認 OK** (2026-05-14 20:51:38 restart, channel `1501135556703424552`):
    - 20:51:38 `systemctl --user restart companion-bot.service` (rc=0)
    - 20:51:40 `notify socket listening at /run/user/1000/companion-bot.sock` (bot 起動完了)
    - 20:51:42 `logged in as renbot#8921` → `notify channel verified` → slash commands synced
    - 20:51:56 (起動 +18 秒、systemd-run の 15s + systemctl start のディレイ込) 両 transient catch-up が発火
      - `notify-unattended-upgrades.log`: `2026-05-14 20:51:56 skip: result not yet logged (2026-05-14 12:17:56,137)` (state は 06:54:06 のままで、ログ最新 12:17:56 と一致しないため別 skip 条件で抜けた、Discord 通知なし)
      - `notify-system-report.log`: `2026-05-14 20:51:56 skip: already notified today (2026-05-14)` (state_matches で skip、Discord 通知なし)
    - 20:52:03 確認時点: `systemctl --user list-units --all 'companion-bot-catchup-*'` → 0 units (`--collect` で auto GC 完了)
    - `bot.log` に新規 `notify forwarded` 行なし (Discord に重複通知が飛んでいないこと確認)
  - code-reviewer: 修正必須なし、軽微提案 3 件 (a) catch-up 経路を既存 oneshot service 経由に揃える / (b) bot-workspace §Language の口調記述を上位への参照に縮退 / (c) 上位 §subordinate CLAUDE.md の workspace 行ラベル更新 をすべて反映済
  - **既知の運用注意**:
    - notify-unattended-upgrades.sh の state ファイル (`maintenance/.state/last-notified-unattended-upgrades`) が `2026-05-14 06:54:06,187` で固まっていて、その後 unattended-upgrades の result log が `12:17:56,137` に更新されているため、catch-up でも日次 timer (09:06 走行) でも state 更新条件 (詳細は `maintenance/scripts/notify-unattended-upgrades.sh` 内) を満たさず skip。今日の挙動としては Discord に飛ばない方が安全な側なので problem 化しないが、状態が変なら maintenance 側のスクリプトロジックを別途レビューする候補 (T-E スコープ外)
    - **2026-05-14 追加観察 (T-E 後の skip ロジック検証)**: `/var/log/unattended-upgrades/unattended-upgrades.log` の 12:17:56 セグメントは 4 行 (開始マーカー + Initial blacklist/whitelist 2 行) で停止、`notify-unattended-upgrades.sh` の 3 つの結果マーカー (`更新対象なし` / `パッケージのアップグレードが終了しました` / `ERROR`) は全 0 件。これは同スクリプト L44-46 のコメント通り「apt-daily 起動で u-u 呼出されたが判定途中で停止する」ケースで、設計上の `skip: result not yet logged` 経路に正しく落ちている (state 不更新 = 次回再評価可能)。**catch-up は空打ちではない**: マーカー揃いを待つ待機 skip であり、翌朝の新規 unattended-upgrades 実行で `grep tail -n1` の latest 行が動けば自然解消する。Phase 3-2 着手前の skip ロジック動作確認として記録
    - design.md §7.2 原案 syntax の修正は本 STATUS.md にのみ記録、`workspace/redesign/design.md` 本文は historical record として手を入れない (Phase 2.5 完了時にまとめて見直す)

- 2026-05-14 Phase 2.5 T-D 前半: BudgetGuard / `/reset` `/quota` `/status` の Discord 公式 slash command 化 (design.md §4 全体 + §6.1)
  - **新規 `bot/quota.py`** (約 250 行): `BudgetGuard` ABC + `RequestsCountGuard` 単独実装 (1h スライディング window)、`ledger.jsonl` append/read、`BudgetSummary` dataclass (§4.6 R 案 z 表示用スキーマ)、`format_summary()` (Discord 文字列整形)、`make_budget_guard()` factory (ENV `BOT_BUDGET_GUARD` master、design.md §4.2 / §4.6 末尾)。`CreditBudgetGuard` は T-D 後半までは `NotImplementedError` で誘導文を返す
  - **ledger.jsonl スキーマ**: design.md §4.6 サンプル JSON と完全一致 (`timestamp` / `channel_id` / `session_id` / `total_cost_usd` / `usage.*` / `modelUsage` / `terminal_reason`)。書き込みは `claude_lock` 配下の `BudgetGuard.record()` から append-only、bot 単一プロセス前提で flock 等は省略 (§4.6 + quota.py 内 docstring 注記)
  - **6/15 切替プレースホルダ**: `MONTHLY_BUDGET_ACTIVE_FROM = datetime(2026, 6, 15, 0, 0, JST)` の境界判定 1 つで `format_summary()` が「本月累計 / $100」行を切替。**BudgetGuard 実装選択は ENV master と独立** (design.md §4.6 注記準拠)。実装ファイル間で日付ハードコードは `quota.py` 1 箇所のみ
  - **キャッシュヒット率**: `cache_read / (input_tokens + cache_read_input_tokens + cache_creation_input_tokens) * 100` で算出。分母 = Anthropic Messages API の `usage` 慣行に従う「課金対象 input 総量」。design.md §4.8 方針 4 のキャッシュ可視化を /quota 常時表示で実現
  - **Discord 公式 slash command 化** (途中での仕切り直し、ユーザー指摘 2026-05-14 20:10): 初回実装はメッセージ本文の文字列マッチで `/reset` 等を判定したが、メンション付き `@renbot /quota` で `clean_content` の先頭にメンションが残り SLASH_COMMANDS 集合に一致しない不具合が出た。これを契機に **`discord.app_commands.CommandTree` で 3 コマンド正規登録 + guild sync** へ切り替え:
    - `CompanionClient.__init__` で `tree = app_commands.CommandTree(self)` を保持、`_synced_guild_id` で起動毎 1 回 sync
    - `on_ready` で `NOTIFY_CHANNEL_ID` 経由で取れる `ch.guild` に対し `tree.copy_global_to(guild=guild)` → `tree.sync(guild=guild)` で即時反映 (1 サーバ運用前提、`.env` への `GUILD_ID` 追加なしで完結)
    - `@client.tree.command(name="reset|quota|status")` で 3 つを定義、内部で既存の `cmd_reset/cmd_quota/cmd_status` を呼ぶ。OWNER 認可違反は `interaction.response.send_message("not authorized", ephemeral=True)` で本人にのみ短文返答 (CLAUDE.md「OWNER 以外は完全無視 (沈黙)」との解釈: interaction プロトコルは Discord 仕様上応答必須なので ephemeral 化で他メンバーには見えない形に倒した、bot からの主体的発話とは別レイヤと整理)
    - `on_message` 側の文字列マッチ分岐 (`SLASH_COMMANDS` 集合) は完全撤去。通常 prompt 経路のみ残す
    - sync は最初に `tree.sync(guild=...)` 単独で叩いたところ `0 cmds: []` を返した (グローバル登録されたコマンドは guild sync では自動コピーされない discord.py 仕様)。`tree.copy_global_to(guild=...)` を先行させて解消、ログで `(3 cmds): ['reset', 'quota', 'status']` を確認
  - **bot.py 連動**: `runner` / `budget_guard` を起動時 1 個生成、`run_claude` で `budget_guard.allow(now)` 先行チェック (上限到達時は `[budget guard] 直近 1h あたり N 回の上限...` を即返却、claude 呼ばず)、OK 経路の後で `budget_guard.record()` を呼ぶ。`BOT_START_AT` を JST aware で保持 (`/status` の uptime 計算用)、`_fmt_duration()` で `1h23m` 等のヒト読み表示
  - **動作確認 (venv ユニット)**: `quota.py` の `allow()` 境界条件 (limit=3 で 0/1/2 件 OK, 3 件目で False)、1h window スライド、`record()` の append スキーマ、`summary()` 集計値、`format_summary()` の 6/15 前後表示分岐、`make_budget_guard()` ENV 切替 (requests_count / credit_usd は NotImplementedError / 不明値で ValueError) を全 pass。bot.py の cmd_* 関数 import スモークで `tree` に 3 コマンド登録済を確認
  - **実弾確認 OK** (2026-05-14 20:16〜20:22, channel `1501135556703424552`):
    - 20:16:18 通常 prompt → `send len=308`、`ledger.jsonl` に 1 行追加、`modelUsage` に `claude-sonnet-4-6` + Haiku 4.5 サブエージェント (WebSearch 1 回) まで記録、session_id は T-A 以来の `4df72438-2aec-46c4-a405-0935157c04ca` 継続
    - 20:21:29 `/quota` → 315 字 (プレースホルダ込みの想定長と整合)
    - 20:21:58 `/status` → 265 字 (current session 行あり)
    - 20:22:05 `/reset` → 70 字 (`[reset] 現 channel の session を破棄しました...` メッセージ長と一致)、`sessions/channels/<id>.json` 削除
    - 20:22:18 `/status` → 195 字 (current session 行が「なし」に縮んで -70 字)
    - 20:22:26 `/quota` → 315 字 (累積データは reset で変わらないので同長)
  - **code-reviewer**: 修正必須 1 件 (`cmd_status` の `last_prompt_at` が UTC 表示のまま、`BOT_START_AT` / `summary.last_call_at` は JST で並ぶと混在) 反映済 (`astimezone(quota.JST)`)。軽微提案 A〜F は実害なく未反映 (キャッシュ分母文言は API 慣行で OK、`read_ledger` 2 回呼びは run_claude allow + summary 連鎖だが ledger は単一プロセス append-only 想定 1 日 100 行未満で I/O 軽微、ledger 破損行スキップのログ詳細化は壊れたら追加、`summary()` への naive datetime ガードは YAGNI、SLASH_COMMANDS 完全一致は app_commands 化で moot、socket_ok 判定は Phase 2.5 では十分)
  - **OWNER 認可ポリシー判断**: slash command interaction で OWNER 以外は `ephemeral` で「not authorized」短文返答。CLAUDE.md「OWNER 以外は完全無視 (沈黙)」の厳密適用 (interaction 放置) だと Discord クライアントに「アプリが応答しませんでした」赤エラーが本人に出る UX 上の壊れに見えるため ephemeral 返答を採用。本人以外には何も見えず、guild メンバーへの存在露出は slash command 一覧表示 (Discord 仕様、bot が join している以上避けられない) と同程度に留まる
  - **環境変数**: `.env.example` に `BOT_BUDGET_GUARD=requests_count` / `BOT_REQUESTS_PER_HOUR=20` を追記。`GUILD_ID` は追加せず (`NOTIFY_CHANNEL_ID` から `ch.guild` で取得、ENV 増殖を回避)
  - **将来の見直し候補** (実弾運用で観察):
    - `BOT_REQUESTS_PER_HOUR=20` は default、1 週間運用で実測してから調整
    - DM で slash command が使えない (guild sync のみ)。DM で `/quota` を叩きたい需要が出たら `tree.sync()` で global sync 追加 (反映に最大 1h)
    - キャッシュヒット率の分母文言「total input C tokens」が API 用語 (`input + cache_read + cache_creation`) と読者解釈で乖離する可能性。混乱したら format_summary の文言を「課金対象 input 総量」等に書き換え
    - OWNER 認可違反時の ephemeral 返答が見えるのを更に隠したくなったら `interaction.response.defer(ephemeral=True)` 後 follow-up なしで実質沈黙化する選択肢あり

- 2026-05-14 Phase 2.5 T-C: Stop フック + vault 同期 (`vault-sync-from-transcript.sh`) (design.md §5 全体、案 A 採用)
  - `~/companion/web/scripts/vault-sync-from-transcript.sh` 新設 (約 50 行 bash、実行権限付き): Discord bot 経由 claude セッション (bot-workspace CWD) の Stop フックとして呼ばれ、claude が `~/companion/vault/notes/` に書いた未 commit 変更を `git add -- notes/` + `git commit` で回収する最終同期処理。push は `permissions.ask` の人手承認フローに任せる
  - **設計選択 (案 A 採用、ユーザー確認 2026-05-14)**: design.md §5.2 の「JSONL を読んで Web 検索 + summary 型を検出、重複チェック後 notes/<...>.md 書き出し」は claude session 内で完結する責務として外出し (§6.3 のフローと整合)。Stop フックは「claude が書いたが commit し忘れた未 commit 変更を回収する」最終同期に絞ることで、jq 依存・JSONL 解析の脆さを回避。design.md §5.2 本文の JSONL 解析記述は実弾運用で漏れが頻発した時点で再判断 (案 B / 案 C への倒し直し候補)
  - stdin の Stop フック入力 JSON (`transcript_path` 等) は現状読み捨て (`cat >/dev/null`)、将来必要になった時点で jq 等で抽出
  - 重複起動防止: `${XDG_RUNTIME_DIR:-/tmp}/companion-vault-sync.lock` で `flock -n` 非ブロッキング取得、並走セッションの Stop フック衝突を排他 (design.md §5.4 vault git 並行制御の cross-process 実装版)
  - **`vault_lock = asyncio.Lock()` は実装せず**: 案 A 採用で bot プロセスから vault git を直接触らないため、bot 内 asyncio Lock は不要。Stop フックの flock cross-process ロックで十分。design.md §3.3 / §5.4 の `vault_lock` は将来 bot プロセスから vault git を触る経路が出てきたタイミングで追加 (YAGNI)
  - 書き込み境界の二重防御 (design.md §5.3): claude session 側は `bot-workspace/.claude/settings.json` の `Edit/Write(~/companion/vault/notes/**)` のみ allow、Stop フック側は `git add -- notes/` で pathspec を notes/ 限定。手書きエリア (`aidiary/` / `clips/` / `inbox/` / vault ルート / `templates/` / `.obsidian/` / `CLAUDE.md`) には commit が漏出しない
  - **`bot.py` 側の `--allowedTools` ハードコード渡しは T-A / T-B 時点で既に廃止済** (`grep -rn 'allowedTools' bot/*.py` で no match 確認、2026-05-14)。settings.json への一本化は完了済
  - commit メッセージスタイル: vault repo の既存 log (`add: notes <YYYY-MM-DD> (<件名>)`) に揃え、`add: notes <today> (bot session auto-sync, N file(s))` 形式。`git log --oneline` で bot 由来 commit を件名で grep 可能
  - ログ出力先: `~/companion/logs/vault-sync.log` (append 専用、RotatingFileHandler 非経由)。1 セッション 1-2 行想定で年間でも数 MB 程度、bot.log と同じ手動 truncate 運用 (運用ルール参照)
  - vault repo の pre-commit hook (gitleaks) は staged diff 経由で Stop フック commit にも自動適用、秘密混入は git 側で止まり `git commit` rc != 0 → `error: git commit failed` がログに残る経路を確認
  - `bot-workspace/.claude/settings.json` に hooks セクション追加: `Stop` イベントで `/home/miho/companion/web/scripts/vault-sync-from-transcript.sh` を呼ぶ。matcher は空文字 (全 Stop event 対象)。command は絶対パスで記述 (`~` 展開のクライアント依存回避)
  - 動作確認: 空 vault (変更なし) で `echo '{...}' | vault-sync-from-transcript.sh` → rc=0 / ログ空で noop 抜け確認。一時 git repo で notes/ 配下に 2 ファイル変更 (新規 1 + 既存編集 1) を作って実行 → rc=0、commit `add: notes 2026-05-14 (bot session auto-sync, 2 file(s))` が作られ working tree clean。flock の lock ファイル (`/run/user/1000/companion-vault-sync.lock`) は exit 時に解放される (0 byte で残るのみ)
  - **実弾確認 OK** (2026-05-14 17:00, ユーザー側からの「別テーマでノート化」依頼で発火、お題: Notion developer platform):
    - `bot.log` 17:00:34: `send len=265` (claude session 完了で Discord 返信)
    - `vault-sync.log` 17:00:33: `ok: committed 1 file(s) under notes/` (Stop フック発火 + gitleaks `no leaks found` + commit 作成のフルパス)
    - vault repo: `1ec363d add: notes 2026-05-14 (bot session auto-sync, 1 file(s))`、`notes/2026-05-14_notion-developer-platform.md` (2682 bytes) 新規追加
    - `develop` ブランチが `origin/develop` に対して 1 commit ahead で **push 未実施** (今回の確認では claude session 内で commit / push までは行われず、Stop フックが「漏れた未 commit を回収」する案 A の挙動が事実そのまま観測された形)
    - 押さえどころ: claude が notes/ に書き込みだけで commit / push まで進めなかったケースでも、Stop フックが commit までは確実に回収する。push は引き続きユーザーの 1 回承認フロー (案 A 設計通り)。実弾運用で claude が頻繁に push まで行く / 行かないのパターンが見えてきたら、Stop フック側で push までやるか UX 上の判断点として再検討候補
  - code-reviewer: 修正必須 1 件 (commit メッセージスタイルを既存 log に揃え) を反映済。軽微提案 4 件のうち git config 前提と log 手動 truncate 運用は本 STATUS.md に明記、残り 2 件 (stdin `|| true` 削除 / `XDG_RUNTIME_DIR` fallback 注記) は実害なく未反映
  - 初回環境セットアップ前提: vault repo の `user.email` / `user.name` が `~/companion/vault/.git/config` に設定済であること (Phase 2.5 着手時点で設定済 = `git log` に既存 commit があるため確認不要)。新規環境構築時は vault repo の git config を先に整える運用

- 2026-05-14 Phase 2.5 T-B: ClaudeRunner 抽象 (ClaudeOptions / ClaudeResult / ErrorKind) (design.md §3.1 / §3.2 / §3.3 / §1.7 / §4.8 / §1.6)
  - `bot/claude_runner.py` 新設 (≈220 行): `ClaudeRunner` クラス、`ClaudeOptions` / `ClaudeResult` dataclass、`ErrorKind` enum。`run_discord(prompt, options) -> ClaudeResult` を提供、`run_oneshot` は `NotImplementedError` 雛形のみ (Phase 4 着手時に実装)
  - `claude_lock = asyncio.Lock()` を `ClaudeRunner` の instance attribute として所有 (bot.py の module-level lock を撤去、design.md §3.3)。lock は spawn + `communicate()` をまたいで保持し、subprocess 二重起動と Max プラン枠の競合を防ぐ
  - `ClaudeOptions.to_cli_args()`: `-p --session-id <uuid>` または `--resume <uuid>`、`--output-format json --permission-mode default --model claude-sonnet-4-6` をデフォルトで組み立て。`session_id` / `resume_session` を同時指定すると `ValueError`。CLI フラグは claude 2.1.141 で `--help` grep して実在確認済
  - `ErrorKind` (OK / NO_PRIOR_SESSION / SESSION_ALREADY_IN_USE / TIMEOUT / RATE_LIMIT / OTHER): **エラー表面化専用**、リトライ判定に使わない方針を docstring に明記 (design.md §3.2 / §10.3)。RATE_LIMIT は reserved (stderr 文言未確認、実弾で観察したら追加分類)
  - `_classify_stderr`: claude 2.1.141 で実機検証済の文言 (`No conversation found with session ID` / `is already in use`) のみマッチ。S3 / S4 以外は OTHER。**用途は ClaudeResult.error_kind を埋めるためだけで、`run_claude` のリトライ判定には一切使われない** (堂々巡り原因 #4 を構造的に排除)
  - subprocess の env から `ANTHROPIC_API_KEY` / `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_SESSION_ID` を pop (design.md §1.6)。`_claude_env` は claude_runner.py に集約、bot.py からは撤去
  - `--output-format json` の stdout を `_parse_json_stdout` で dict 化、`ClaudeResult` の `result_text` / `session_id` / `cost_usd` / `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` / `model_usage` / `permission_denials` / `terminal_reason` / `duration_ms` に展開。パース失敗時は `None` フォールバック、例外伝播なし
  - `ClaudeOptions.prompt_prefix` / `prompt_suffix` フィールドを追加 (design.md §4.8 方針 2 のキャッシュフレンドリ prefix 足場)。T-B 段階では両方とも空文字列、`_compose_prompt` が `prefix + body + suffix` で組み立てる構造のみ準備
  - `bot/sessions.py`: T-A の `determine_args(channel_id) -> (list[str], SessionMeta)` を撤去し `start_or_resume(channel_id) -> (SessionMeta, is_new: bool)` に置換 (caller が `ClaudeOptions.session_id` か `resume_session` のどちらに入れるかを `is_new` で決める形)
  - `bot/bot.py`: module-level `claude_lock` / `_claude_env` / `_exec_claude` を撤去、`runner = ClaudeRunner(CLAUDE_BIN, CLAUDE_CWD)` を起動時に 1 個生成。`run_claude` は `start_or_resume` → `ClaudeOptions` 組立 → `runner.run_discord` → `ClaudeResult.error_kind` ベースで Discord 返却文字列を組む形に。`on_message` の `except asyncio.TimeoutError` を削除 (TIMEOUT は `ClaudeResult(error_kind=TIMEOUT)` に畳まれるため呼び出し側で例外扱いしない)、`async with claude_lock` も runner 内へ移動済なので除去
  - 動作確認: `bot/venv` で `to_cli_args` の組立 (`--session-id` / `--resume` / mutex `ValueError`) と `_classify_stderr` の S3 / S4 / OTHER 振り分け、`_parse_json_stdout` の S5 sample 受け入れ、`_claude_env` の strip、`ClaudeRunner.claude_lock` の async with 全 7 件を実行、全 pass
  - **実弾確認 OK** (2026-05-14 16:41, channel `1501135556703424552`): bot.log は `send len=417` のみ (error 行なし)、`sessions/channels/<channel-id>.json` の `prompt_count` が T-A 直後の 2 から 3 へインクリメント、jsonl は 19327 → 25364 bytes に追記、`session_id` は `4df72438-...` のまま継続 (`--resume` 経路で文脈保持 + `--output-format json` の result_text を Discord に返却していることを送信長から確認)
  - **Watch 項目** (code-reviewer 軽微提案 → **2026-07-13 ticket #87 で実装済み**、同日 Done エントリ参照): `--session-id <uuid>` で渡した uuid と JSON 由来の `session_id` が将来 CLI 仕様変更で乖離した場合の検知が現状ない。`claude_runner.run_discord` 末尾で `result.session_id != options.session_id (or resume_session)` を warning するのは将来 enhancement 候補 (現状 uuid4 + `--session-id` ハンドオフが 2.1.141 実機通り動いているので過剰防御寄り、CLI up 時の再検証で乖離が出た時点で追加)

- 2026-05-14 Phase 2.5 T-A: bot 専用 CWD 分離 + sessions JSON (design.md §1 全体、§8.1)
  - bot.py の `CLAUDE_CWD` デフォルトを `~/companion/workspace` → `~/companion/bot-workspace` に変更、`.env` / `.env.example` も同値に揃えた (T-0 以前は `.env` で `bot/sessions` を CWD にする暫定対応で手元 claude code の jsonl 混入を回避していたが、本対応で正規の bot-workspace に統一)
  - `bot/sessions.py` 新設 (≈130 行): `SessionMeta` dataclass + `load(channel_id)` / `save(meta)` / `reset(channel_id)` / `determine_args(channel_id)` / `record_usage(meta)`。永続化先は `bot/sessions/channels/<channel-id>.json` (1 channel = 1 file、gitignore 済)。書き込みは `tempfile.mkstemp` + `os.replace` の atomic write
  - `--continue` 完全廃止、`_is_no_prior_session` も削除。初回 `--session-id <uuid4>` / 継続 `--resume <uuid4>` の 2 ルートに一本化、stderr マッチ / rc != 0 自動 fallback / subprocess 2 度呼び はすべて消した (design.md §1.4 禁止反パターン準拠、CLAUDE.md「対症療法 2 周目」ルールにも整合)
  - `_claude_env()` を追加し `_exec_claude` に `env=` 経由で渡すように変更。`ANTHROPIC_API_KEY` / `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_SESSION_ID` を pop し、bot 経路でのネスト claude 検出 / API キー誤混入を遮断 (design.md §1.6)
  - `run_claude(prompt, channel_id)` に署名変更、`on_message` で `message.channel.id` を渡す (DM / guild どちらも channel.id は一意なのでそのまま使える)
  - 動作確認: `sessions.py` の roundtrip スモークテスト (new → record_usage → resume → reset → new) と `_claude_env()` の strip 確認を `bot/venv` で実施、全 pass
  - **実弾確認 OK** (2026-05-14 14:50-14:51, channel `1501135556703424552`): Discord メンションで 2 ターン会話、`sessions/channels/<channel-id>.json` が `prompt_count: 2` / `last_prompt_at` 更新済で生成、`~/.claude/projects/-home-miho-companion-bot-workspace/<uuid>.jsonl` が `--session-id` の uuid そのままで作成 (encoded-cwd 規則 + uuid4 ハンドオフが design.md §1.3 / §1.5 通り)、bot.log は `send len=372` (1 ターン目) → `send len=699` (2 ターン目) で文脈保持を確認
  - **既知の運用注意** (code-reviewer 軽微提案 #1 + #3 反映):
    - T-A 単独完了時点では `/reset` コマンド未実装 (T-D で実装予定)。`SESSION_ALREADY_IN_USE` 等で sessions JSON が現実の jsonl と乖離した場合の自動回復経路はないため、復旧は `rm bot/sessions/channels/<channel-id>.json` の手動操作
    - `bot/sessions/` 配下の構造は将来 T-D の `ledger.jsonl` と共存予定。現状 `channels/` サブディレクトリに分離してあるので衝突しない
  - code-reviewer: 修正必須なし、軽微提案 3 件中 2 件 (運用注記) を本 STATUS に反映、残り 1 件 (`_from_iso` の Optional 分離) は実害なく未反映

- 2026-05-14 T-0: claude CLI 2.1.141 で S1-S5 全シナリオ再検証完了 (Phase 2.5 前提条件、`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」+ design.md §10.4 ルール準拠)
  - CLI バージョン: **2.1.141** (design.md 検証時 2.1.138、STATUS.md 前回確認 2.1.140 から更に 1 上昇)
  - 検証 CWD: `/tmp/bot-cli-verify-2026-05-14/` (bot-workspace / workspace の jsonl を汚さない)
  - 環境: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY` (design.md §1.6 準拠)
  - モデル: `--model claude-haiku-4-5` (検証コスト最小化、S5 で `total_cost_usd=0.01267595`)
  - 結果 (design.md §1.5 の表と完全一致):

  | シナリオ | コマンド | 結果 (2.1.141) | design.md 一致 |
  |---|---|---|---|
  | S1 新規 | `--session-id $(uuidgen) "..."` | rc=0、`~/.claude/projects/-tmp-bot-cli-verify-2026-05-14/<uuid>.jsonl` 作成、stdout=`ALPHA` | ✓ |
  | S2 継続 | `--resume <uuid> "..."` | rc=0、直前 ALPHA を想起 = 文脈保持 | ✓ |
  | S3 lost | `--resume <存在しない uuid>` | rc=1、stderr `No conversation found with session ID: <uuid>` | ✓ 完全一致 |
  | S4 in-use | `--session-id <既存uuid>` | rc=1、stderr `Error: Session ID <uuid> is already in use.` | ✓ 完全一致 |
  | S5 json | `--output-format json --session-id <new> "..."` | rc=0、JSON 単一オブジェクト | ✓ + 追加情報 |

  - encoded-cwd 規則: `/tmp/bot-cli-verify-2026-05-14` → `-tmp-bot-cli-verify-2026-05-14` 確認、JSONL 保存先 = `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`
  - S5 JSON キー実機観察 (`--output-format json` の **stdout 単一オブジェクト由来**、生データは `bot/docs/reviews/2026-05-14-cli-2.1.141-S5-stdout.json` に保管。transcript jsonl とは別レイヤなので混同しない):
    - design.md §1.5 で確定済キー (stdout): `result` / `session_id` / `total_cost_usd` / `usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` / `modelUsage` / `permission_denials` / `terminal_reason` / `duration_ms`
    - 2.1.141 で stdout トップレベルに追加観察: `type` / `subtype` / `is_error` / `api_error_status` / `duration_api_ms` / `num_turns` / `stop_reason` / `fast_mode_state` / `uuid`
    - 2.1.141 で stdout の `usage` 配下に追加観察: `server_tool_use.{web_search_requests, web_fetch_requests}` / `service_tier` / `cache_creation.{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}` / `inference_geo` / `iterations[]` (per-iteration tokens) / `speed`
    - 設計影響: ClaudeResult dataclass は design.md §3.1 の確定 7 項目で十分 (追加キーは将来必要になれば取り込む、現時点で未使用)
  - `claude -p --help` 確認 (§1.8 #5、`--bare` 監視): `--bare` の説明 = "Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)." → **オプトインのまま**、デフォルト動作変更なし。N4「bot.py は明示的に `--bare` を使わない」継続
  - 検証 jsonl は `~/.claude/projects/-tmp-bot-cli-verify-2026-05-14/` 配下に残置 (S3/S4 の stderr 文言を後から確認可能にするため、Phase 2.5 完了後に削除予定)。S5 stdout 生 JSON は `bot/docs/reviews/2026-05-14-cli-2.1.141-S5-stdout.json` に保管 (次回 CLI up 時の比較根拠)

- 2026-05-13 Phase 2.5「土管の耐久化」着手前の準備（bot-workspace 新設 + `--bare` 実機確認）
  - bot-workspace 新設（`~/companion/workspace/redesign/design.md` §1.1 / §1.2 / §2 確定済の内容）
    - `~/companion/bot-workspace/` ディレクトリ作成
    - `bot-workspace/CLAUDE.md`（Discord 経由セッション固有: 口調 / `--session-id` + `--resume` 運用 / 書き込み境界 / OWNER 認可 / 上位 `~/companion/CLAUDE.md` 参照）
    - `bot-workspace/.claude/settings.json`（§2 確定の bot 用 permissions: WebSearch / WebFetch / vault notes 書き込み / git 通常操作 allow、`git push` ask、deny は workspace と同等、`additionalDirectories` は vault / logs）
      - §2 確定リストに加え workspace 慣習からの補完 3 件を追補: `Bash(git status)` / `Bash(git diff)`（引数なし形、workspace settings line 42-45 に揃える）、`Bash(claude --version)`（CLI バージョン確認用、副作用なし）
  - bot.py の CWD は `~/companion/workspace` のまま未変更。bot-workspace は **Phase 2.5 メイン実装で bot.py 側の cwd 切替と同時に活性化** する。現状の bot 動作には影響なし
  - `--bare` 実機確認（design.md §1.8 #5 + §11.5、N4 の watch 基準値取得）
    - 実行: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH -u CLAUDE_CODE_SESSION_ID -u ANTHROPIC_API_KEY claude -p --bare "test"`
    - 結果: stderr `Not logged in · Please run /login`、rc=1
    - 観察: Max プラン環境では `--bare` が明示的にエラーで止まる。design.md は `ANTHROPIC_API_KEY not set` 系の文言を想定していたが実際は `Not logged in`（`--bare` が keychain reads を skip → OAuth credentials を読まない → 認証情報なし）。本質（`--bare` がデフォルト化された瞬間に bot 経路が無音破綻する将来リスク）は変わらず、N4「bot.py は明示的に `--bare` を使わない」を継続
  - claude CLI バージョン: design.md 検証時は 2.1.138、現在 **2.1.140**（2 バージョン分上昇）。S1〜S5 全シナリオの再検証は Phase 2.5 着手時に実施（`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」+ design.md §10.4 ルール準拠）

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

- `/vault_push`: gnome-keyring 実体 agent 再起動後の鍵未ロード状態では proxy が GUI プロンプト待ちでハング → 60s タイムアウトとなり、文言「ネットワーク / SSH 接続を確認」が実原因 (鍵未ロード) とずれる。対応は様子見 (再発したら文言改善を bot 改良プラン C 系列に積む)。詳細: Done「Telegram `/vault_push`」配下の 2026-06-11 実機観測 entry (チケット #11)

## 運用注記

- **budget guard は requests_count (1h 回数上限)**: bot 経由の claude -p 消費は subscription の usage limit から引かれる (2026-06-15 予定の月次クレジット枠分離は公式に pause)。`BOT_BUDGET_GUARD=requests_count` / `BOT_REQUESTS_PER_HOUR` (default 20) で 1h あたり呼び出し回数を上限化し、bot 経由暴走で usage limit を食い潰さない自衛とする。超過時は「古い記録が window から外れるまで待つ」メッセージ。1h 上限を緊急で上げたい場合は `bot/.env` の `BOT_REQUESTS_PER_HOUR` を上書き → `systemctl --user restart companion-bot.service`。クレジット枠前提の CreditBudgetGuard は 6/15 pause を受けて **2026-06-16 に撤去** (git 履歴に実装は残る、制度確定時に再実装)

## 運用ルール

- タスクの実装が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（仕様どおり / 想定外パターンの考慮）
  - セキュリティ（入力検証、秘密情報の扱い、権限境界）
  - 簡潔さ（不要な抽象・過剰な防御コード・コメントの過多）
  - 既存コード慣習との整合
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `bot/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
- `~/companion/logs/bot.log` は RotatingFileHandler で自動ローテーション (5MB×3)、`~/companion/logs/vault-sync.log` は append 専用で**手動 truncate 運用** (1 セッション 1-2 行想定、年間数 MB 程度なので逼迫したタイミングで `: > ~/companion/logs/vault-sync.log` でクリア。logrotate 化は maintenance 側で必要性が出た時点で判断)
- **vault push reject 観察ルール** (T-C 案 A 採用に伴う運用境界、`~/companion/CLAUDE.md`「対症療法 2 周目」と接続):
  - bot 経由 vault `git push` の non-fast-forward reject が **2 件目** に出た時点で対症療法 2 周目サインとして扱う
  - 1 件目 (2026-05-14 17:04, Notion ノート、メイン機側で 2026-05-10/05-12 に 3 commits 先行 push、reflog 確認で claude session 内 `git pull --ff-only` 未実施を観察) は web/docs/STATUS.md「失敗リカバリ手順 #1」通りに手動 rebase で復旧、設計仕切り直しは行わない
  - 2 件目発生時に取る行動: Stop フックでパッチ (`git pull --rebase` 追加 / `--ff-only` 先行試行) を直接当てず、**一段引いて「vault 同期の責務分担」(claude session 内の pull 励行 vs Stop フック側の責務拡張 vs 諦め線) を `bot/docs/STATUS.md` か別途設計議論 (agent teams 含む) で再設計**してから着手する
  - 監視は ledger 化せず、次回 reject を人間 (or Discord 上のエラー文面) が気付いた時点で本ルールを引いて判断する
  - 失敗種別の数え方: web/docs/STATUS.md「失敗リカバリ手順 #1」(non-fast-forward reject) のみカウント。#2 (`git pull --ff-only` 落ち) や #3 (frontmatter 規約違反) は別系統の問題なので本ルール対象外

## CLAUDE.md + パススコープ Rules 新設 (2026-06-22)

CWD=bot 起動時の **本体コード開発** 用に CLAUDE.md を新設。bot は `bot.py` 集中型で機能別 paths 分割が効かないため、恒常制約 (認可4段 / 秘密管理 / claude 起動 / 前景降格 / budget 単一 gate / git) を CLAUDE.md に集約し、`.claude/rules/` 6 本に切り出した: bot-py (cmd/proactive/socket/chunk 境界)・sessions・interests・quota+voice_status・voice・claude-runner。`bot-workspace/CLAUDE.md` (実行時セッション CWD=bot-workspace) との責務分担を冒頭に明記。全制約は実コードに照合、code-reviewer 修正必須なし。companion 横断の指示整備 (games/photos と同方式、claude.com steering 記事 + 公式 memory.md) の一環。
