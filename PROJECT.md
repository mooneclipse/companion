# Linux Mint 機 AI 相棒構築プロジェクト

Dell Inspiron 3521 (Linux Mint MATE) に、Discord 越しに対話・指示できる AI 相棒を常駐させる。LLM 推論は Claude Code に委譲し、この機は **Claude Code の Linux 実行環境＋外部インターフェース** として機能する。

## 設計方針

- **機能先、キャラクター性は後のせ**。土管を通してから装飾する
- 各層は独立して動くように作る。下の層が壊れても上が暴走しない構造
- 一気に作らず段階的に。各段階で「動いて使える」状態を保つ
- フェーズが進むときに先回りして雛形を増やさない（YAGNI）。台帳・ディレクトリは着手時に作る

## マシン制約

- Dell Inspiron 3521 (2013), Ivy Bridge 2 コア (i3-3217U 1.8GHz / 4 logical / **AVX1 only**), RAM **3.7Gi total** (過去版「8GB」は事実誤認、2026-05-18 実機確認で訂正、Phase 3-2 着手前の `~/companion/workspace/redesign/voice-design.md` §6 根拠), Swap 2.0Gi, Storage **HDD ST500LT012** (ROTA=1, 回転 HDD), GPU なし, docker 未インストール
- Linux Mint 21.3 MATE
- TV 出力で YouTube/d アニメ視聴に常用中（≠ 専用サーバー）
- メイン機から x11vnc 経由で遠隔操作可（ユーザー名 miho）
- **ローカル LLM 運用は実用域に届かない前提**（CPU 推論で数 tok/s が限界）

## ディレクトリ構成

```
~/companion/
├── bot/          # Discord bot（Phase 1 成果物）
│   └── docs/STATUS.md      # Phase 1 台帳
├── maintenance/  # Phase 2 成果物（cron スクリプト等）
│   └── docs/STATUS.md      # Phase 2 台帳
├── web/          # Phase 3-1 成果物（Web 検索 → md 蓄積運用、台帳のみ。スクリプトは YAGNI で未配置）
│   └── docs/STATUS.md      # Phase 3-1 台帳
├── vault/        # Obsidian vault clone（Phase 3-1。書き込みは notes/ のみ）
├── dashboard/    # 朝の TV ダッシュボード自動起動アプリ（フェーズ外の単発ユーティリティ。systemd user timer で 5:30 起動 / 9:00 終了）
│   └── docs/STATUS.md      # 確定設計 + 実機検証チェックリスト
├── remote/       # スマホ専用リモコン PWA（フェーズ外の単発ユーティリティ。Tailscale 経由、Pixel-6 から PC 操作）
│   └── docs/STATUS.md      # 設計議論待ち（brief: workspace/redesign/remote-design.md）
├── workspace/    # Claude Code の CWD（相棒の作業領域 / このファイルもここ）
├── logs/         # bot 動作ログ
└── (将来追加)
    ├── voice/              # Phase 3 の TTS/STT 関連
    └── persona/            # Phase 4 のキャラクター層
```

## セキュリティ境界

- bot トークン・API キー類は環境変数 or `.env`、絶対に git/ログに出さない
- Discord 認可: miho の User ID 以外の発言は無視（Phase 1 で実装済み）
- ブラウザ認証系は相棒に触らせない（自分で操作 or ブラウザ内部完結）

## git 化の 3 階層

companion 配下の git 化は用途別に 3 階層ある。フォルダごとにどれを使うか判断する:

- **(A) `companion/` 直下 = git 化しない**: 用途の違うプロジェクトの履歴を混ぜないため。
- **(B) GitHub バックアップ付きサブプロジェクト**: マシン外バックアップ・将来の共有/復元が要るもの。`bot/` `dashboard/` `maintenance/` `vault/` `voice/` が該当。下記「(B) の手順」。
- **(C) ローカル git のみ（remote なし、rollback 専用）**: 複数セッション/agent team で大幅改稿される設計台帳など、「やり直し」が効けば十分でマシン外バックアップは不要なもの。`workspace/` `web/` `remote/` が該当。下記「(C) の手順」。**GitHub に上げ忘れているのではなく意図的に remote なし**。誤って remote を足さないこと。

### (B) GitHub バックアップ付きサブプロジェクトの手順

新しいサブプロジェクト（例: `~/companion/maintenance/`）を git 化するときは以下を順に実行:

1. `git init -b main`
2. `git config user.email "1870071+mooneclipse@users.noreply.github.com"`（メアド非公開、commit に晒さない）
3. `git config user.name "mooneclipse"`
4. `cp ~/companion/workspace/.githooks-template/pre-commit .git/hooks/`
5. `chmod +x .git/hooks/pre-commit`
6. `.gitignore` を repo 用途に合わせて作成（最低限: `.env`, `.env.*`, `__pycache__/`, `*.pyc`, `venv/`, `node_modules/` 等）
7. 初回 commit 前に `~/bin/gitleaks dir . --no-banner` でクリーンを確認（`.env` がある場合の検出は想定通り、`.gitignore` で除外されていれば実害なし）
8. 初回 commit → GitHub にプライベート repo 作成 → `git remote add origin git@github.com:mooneclipse/<repo-name>.git` → `git push -u origin main`

### (C) ローカル git のみ（rollback 専用）の手順

(B) の 1〜7 と同じ。**8 は実行しない**（GitHub repo 作成・`remote add`・`push` をしない）。初回 commit で止める。以降も commit のみで rollback 履歴を貯める。マシン外バックアップにはならない点を承知のうえで使う。

`.git/hooks/pre-commit` は git 管理外で `git clone` についてこないため、新環境で repo を持ってきた場合は **再度 5-6 を実行**して hook を再配置する必要がある。

---

## ロードマップ

### Phase 1: 土管を通す ✅ 開通済み

Discord ↔ Linux 機 ↔ Claude Code の往復ループを閉じる。

- [x] Discord bot 最小構成（discord.py / venv / `.env`）
- [x] DM・サーバー内メンション → `claude -p` 実行 → 応答返却
- [x] 認可（OWNER_ID 以外無視）
- [x] systemd user service 常駐化（auto-login で再起動後も復帰）
- [x] Discord 2000 文字制限の chunk 分割
- [x] 動作確認（DM / サーバー双方）
- [x] `bot/` 配下を `git init`、GitHub プライベート repo に push、pre-commit hook で gitleaks による秘密情報チェック

**台帳**: `~/companion/bot/docs/STATUS.md`
**続きを進めるとき**: 上記台帳の TODO / In progress を見て一作業ずつ。

---

### Phase 2: 保守層 ✅ 完了

Linux 機自身の面倒を相棒経由で見られるようにする。リポジトリ: `mooneclipse/companion-maintenance`（プライベート）

- [x] OS アップデート結果通知（unattended-upgrades）
- [x] ディスク使用量・温度・メモリの定期レポート
- [x] 通知先を OWNER DM → サーバー通知チャンネルへ切り替え（実装は bot 側、`.env` の `NOTIFY_CHANNEL_ID` で指定）

**Obsidian vault 同期は Phase 3 に移管**（Web 検索 → md 蓄積と接続するため）。

**台帳**: `~/companion/maintenance/docs/STATUS.md`

**保守タスク追加のテンプレ構造**（OS アップデート通知が reference 実装）:

- `scripts/<task>.sh` … bash 実体スクリプト。bot の Unix socket (`$XDG_RUNTIME_DIR/companion-bot.sock`) に `nc -U -N` で本文を流して通知
- `systemd/companion-<task>.service` … oneshot service。`After=companion-bot.service` のみで Wants/Requires は付けない（socket 不在時はスクリプト側で skip する設計に揃える）
- `systemd/companion-<task>.timer` … 定期 timer。`Persistent=true` + `RandomizedDelaySec` 推奨
- `~/.config/systemd/user/` から symlink で配置 → `systemctl --user daemon-reload && enable --now`
- 二重通知抑止が要るなら `.state/<task>` にタイムスタンプ等を保存（`.gitignore` で除外済み）
- ログは `~/companion/logs/maintenance/<task>.log`

**共通化のしきい値**: 同じ「socket 送信＋ログ追記」コードが 2 件目のタスクで繰り返されたら `lib/notify.sh` に抽出する（YAGNI を破らない範囲で 2 回目で抽象化、3 回目を待たない）。

---

### Phase 2.5: 土管の耐久化（再設計） ⬜ 着手可能

Phase 3-1 (Web 検索 → vault 保存) で確認ラリー破綻と権限 whack-a-mole が連続したため、bot.py の根本構造を仕切り直す。Phase 3 着手前にやる。

**設計根拠**:
- `~/companion/workspace/redesign/design.md` (v0.2.3, 2026-05-14 questions.md 反映済 + code-reviewer 通過)
- `~/companion/workspace/redesign/questions.md` (UQ-1〜UQ-10 全項目回答済、Phase 2.5 着手可)

**目的** (design.md §0 堂々巡り原因 7 点を構造的に解消):
- A. セッション帰属が CWD 依存で曖昧 → bot 専用 CWD + `--session-id`/`--resume` で session 固定
- B. 会話状態を bot が持たない → sessions JSON 永続化
- C. 権限が後追い (whack-a-mole) → bot-workspace と workspace で settings 分離
- D. 責務の混在 → bot.py を `claude_runner` / `sessions` / `notify_listener` / `quota` に責務分解
- E. Max プランクォータの可視性ゼロ → `/quota` コマンド (`total_cost_usd` self-counting)
- F. 書き込み境界が claude 任せ → `additionalDirectories` で vault notes 限定
- G. タイムアウト戦略が単一 → 短文 / 通常 / Web 調査で 3 段階

**サブタスク分割** (UQ-9 案 k 確定、依存順序):

| # | 内容 | 対応 design.md § |
|---|---|---|
| T-0 | claude CLI 2.1.140 で S1-S5 全シナリオ再検証 (前提条件) | §1.5 / §10.4 |
| T-A | bot 専用 CWD 分離 + sessions JSON | §1 / §8.1 |
| T-B | ClaudeRunner 抽象 (ClaudeOptions / ClaudeResult / ErrorKind) | §3.1 |
| T-C | Stop フック + vault 同期 (`vault-sync-from-transcript.sh`) | §5 |
| T-D | BudgetGuard / `/quota` コマンド (2 段階: 前半 RequestsCountGuard 2026-05-14、後半 CreditBudgetGuard 即時前倒し 2026-05-19) | §4 |
| T-E | catch-up + CLAUDE.md 3 層分割 (`~/companion/CLAUDE.md` 共通項) | §7.2 + §1.2 |

各サブタスク = 1 commit、companion CLAUDE.md「1 セッション 1 タスク」運用と整合。

**「次おねがい」運用**: 別セッションで `~/companion/workspace` を CWD に「次おねがい」と指示すれば、claude は `bot/docs/STATUS.md` の TODO 欄を見て次の未着手サブタスクから着手 (T-0 → T-A → ... の順)。

**台帳**: `~/companion/bot/docs/STATUS.md` (Phase 1 と共用、サブタスク進捗を TODO / In progress / Done で追跡)

---

### Phase 2.6: Telegram 移行 ✅ cold cut 2026-05-27 / 観察打ち切り 2026-05-30 (user 判断)

Phase 1 で開通した Discord 土管を Telegram supergroup (topic = 1 session model) に置き換える。bot 指示はモバイル中心 + topic で分けたい要件 (user 確定済) に応える。

**設計確定版**: `~/companion/workspace/redesign/telegram-design.md` (2026-05-27、agent team `companion-telegram-migration` による plan_approval 完了)

**主要決定**:
- framework: **python-telegram-bot v22.7** (PTB)、long polling、`AIORateLimiter` extra
- session 帰属: `(chat_id, thread_id)` 複合キー、`sessions/topics/<chat_id>_<thread_id|general>.json`
- 移行戦略: **cold cut** (並行運用しない、claude_lock 分裂 + CreditBudgetGuard 月次 $200 経路回避)
- 切替日: **2026-05-27** (lead 単独判断で Phase 2.5 観察期間 8 日打ち切り、健全性チェック履歴 2026-05-27 entry §「Phase 2.5 観察打ち切り + cold cut 前倒し判断」参照)
- OWNER 認可: `from_user.id == OWNER_ID` + privacy mode off (起動時 `can_read_all_group_messages` 確認、False なら `sys.exit(1)`) + 4 段防御
- topic 構成 (initial 4): General / #chat / #research / #maintenance (#aidiary / #voice-log は実需時に追加、YAGNI)
- voice/ 統合: Telegram 観察は **2026-05-30 打ち切り** (健全性履歴 2026-05-30 entry、user 判断 + S-1 5 回目境界化判定) で voice bot/ 側統合 着手可。着手 (bot.py 改変) で新 14 日観察が発火、Phase 4 #2 はそこに再基準化 (順序原則、bot.py 同時 2 方向回避は維持)
- 採用すべきでない設計 14 件 (N-T1〜N-T14) + 対症療法 2 周目候補 6 件 (W-1〜W-6) 明示的不採用宣言

**実装着手前検証**: 25+ 項目 (V-1〜V-25 + D-add-1〜D-add-12 + AIORateLimiter log level + Bot API up 監視等)、詳細は `bot/docs/STATUS.md` Phase 2.6 section

**台帳**: `~/companion/bot/docs/STATUS.md` Phase 2.6 section (実装着手と同時に TODO/In progress/Done 追跡開始)

---

### Phase 3: 能力層 ⬜ 未着手

相棒に「できること」を増やす。**着手順序は軽 → 重で上から固定**（Phase 3 内なら次の項目への着手は合意不要、順に消化）:

1. **Web 検索 → md 蓄積 + Obsidian vault 同期** ✅ TODO 全消化 (2026-05-17)
   - リソース負荷ほぼなし、Claude Code 経由で動く最軽量タスク
   - 蓄積先 vault は既に GitHub プライベート repo (`mooneclipse/obsidian-vault`, `develop` ブランチ) として運用中。**rsync ではなく git で同期**する
   - ディレクトリ: `~/companion/vault/`（vault repo の clone、書き込み専用領域）。台帳・運用フローは `~/companion/web/docs/STATUS.md`。Web 検索専用の作業スクリプトが要る段で `~/companion/web/scripts/` を切る（YAGNI、現時点では未作成）
   - **台帳**: `~/companion/web/docs/STATUS.md`
   - **完了状況**: TODO「重複チェック手段の確定」「Discord 側の発火 UX 確認」とも 2026-05-17 に決着済み（いずれも自然文継続 + 再判定トリガ明文化）。実弾は計 7 件 (うち Discord 経由 2 件)。詳細・再判定トリガは台帳側

   **書き込み範囲**: `notes/` 配下のみ。手書きノート (`aidiary/`, `clips/`, `inbox/`, vault ルート) には触らない。整理・タグ運用はメイン機側で行う。

   **ファイル規約**（vault 既存 `CLAUDE.md` + `templates/note.md` を正とする。詳細はそちらを参照）:
   - ファイル名: `YYYY-MM-DD_slug.md`（slug は英語 kebab-case）
   - frontmatter: `type: note` / `created: YYYY-MM-DD HH:mm`（vault テンプレ準拠）/ `tags: [...]` / `style: fleeting | reference` 等
   - タグは vault `CLAUDE.md` の既存タグ一覧から選択。新規タグは作らない
   - Obsidian の `[[wikilink]]` と frontmatter は壊さない

   **書き込みフロー**（Discord 経由の調査指示で発火）:
   1. `git pull --ff-only origin develop` で最新化
   2. **重複チェック**: `notes/` 内をファイル名（同日 slug）と内容（タイトル・キーワード）で grep
      - 完全一致 (同名 .md): 必ず Discord で「上書きする？別名？」と確認
      - 部分類似 (タイトル・キーワード重なり): Discord で「○○ と重複しそう、追記する？新規にする？」と確認
      - 重複なし: そのまま書き込みへ
   3. `notes/<YYYY-MM-DD>_<slug>.md` を作成
   4. `git add notes/<file>` + `git commit`
   5. `git push origin develop`（`.claude/settings.json` の `permissions.ask` で 1 回承認）
   6. メイン機側は手動で `git pull`（または Obsidian Git plugin）して取り込み

   **初期セットアップ**（2026-05-08 完了済み。手順は再現用に残す）:
   - `git clone -b develop git@github.com:mooneclipse/obsidian-vault.git ~/companion/vault`
   - `cd ~/companion/vault`
   - `git config user.email "1870071+mooneclipse@users.noreply.github.com"` + `git config user.name "mooneclipse"`（repo ローカル）
   - `cp ~/companion/workspace/.githooks-template/pre-commit .git/hooks/ && chmod +x .git/hooks/pre-commit`
   - `~/bin/gitleaks dir . --no-banner` で初期スキャン確認
   - `git push --dry-run origin develop` で SSH 認証 + push 権限確認
2. **TTS（VOICEVOX）: bot 駆動先行 + 朝自動発火 Phase 4 punt** ⬜ 設計確定 (v2.0.2, 2026-05-19)
   - CPU 軽量モードで実用域 (VOICEVOX 0.25.2 / 四国めたん speaker_id=2、AVX1 適合 + RTF 2.1-3.0 warm / RAM RSS 268MB 実測済)
   - 駆動: bot `/say` slash command (24h 受付)、朝自動発火 (旧 voice-greeting.timer) は Phase 4 punt
     (TV hot standby で xrandr gate 機能せず確定、case B 採用根拠は `voice/docs/STATUS.md` 参照)
   - 着手順序 (v2.0.2 で voice/ 側前倒し):
     - **voice/ 側 (bot.py を触らない部分: say.sh / bin/ / systemd/companion-voice-engine.service / git init)**: 2026-05 中下旬から前倒し着手
     - **bot/ 側 (voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration)**: Phase 2.5 T-D 後半 (CreditBudgetGuard, 2026-05-19 即時前倒し完了) + 健全性 2 週間観察 (5/19〜6/2) 完了後、2026-06 上旬目処
     - 前倒し根拠: voice/ 側単独は bot.py / bot.service を一切触らないため devil T-D-1(d) 構造原則 (bot.py 同時 2 方向回避 + Phase 2.5 健全性 2 週間観察) と独立。新規設計判断ではなく運用上の前倒し
   - 確定設計: `~/companion/workspace/redesign/voice-design.md` v2.0.2 (2026-05-19、§5.3 voice/ 側前倒し反映)
   - ディレクトリ: `~/companion/voice/` (台帳 + SETUP.md + engine 配置済、git init は voice/ 側実装着手と同時)
   - 台帳: `~/companion/voice/docs/STATUS.md`
3. **STT（whisper.cpp tiny/base）: 音声入力受付**
   - CPU でも動くが応答性は要実測。マイク調達も含めて着手時に検討
   - ディレクトリ: `~/companion/voice/` 配下に同居
4. **ブラウザ操作（YouTube 視聴等）の指示対応**
   - メモリ食い、TV 出力（YouTube/d アニメ常用）と画面競合の可能性あり、headless 前提で着手
   - ディレクトリ: 着手時に決定（`~/companion/browser/` 候補）

**着手時**: 各ディレクトリに `docs/STATUS.md` を切り、サブプロジェクト git 化手順に従う。

---

### Phase 4: 相棒層 ⬜ 未着手

キャラクター性の付与。

- 立ち絵（人型 or 記号 ◯■ 未定）
- 声の確定（VOICEVOX のどのキャラ or 自作音声モデル）
- 口調・キャラクター性の付与
- 「相棒」としての存在感の調整

**着手発火条件**（全部満たすまで Phase 4 には進まない。「次へ次へ」で土台が整わないうちに装飾が始まるのを防ぐため明文化）:

1. **Phase 3 の能力が最低 1 つ、日常運用に自然に組み込まれている**（ユーザーが普段の生活で意識せず使う頻度があり、2 週間以上継続）
2. **直近 2 週間、Phase 1〜3 のいずれかで「想定外の停止 / 誤動作 / 修正必須レベルの不具合」が発生していない**
   - **Phase 2.6 (Telegram 移行) 反映 (2026-05-30 更新)**: Phase 2.5 観察 (5/19-5/27、8 日) と Telegram 観察 (5/27-5/30、user 判断で打ち切り、健全性履歴 2026-05-30 entry) はいずれも独立完了として記録。**Phase 4 着手判定の主基準は voice bot/ 側統合 (bot.py 改変) +14 日の新観察**に再基準化 (bot.py 同時 2 方向回避の原則上これが真の最終律速、Telegram 単独観察では引き継げない layer がある)。voice 統合観察は event-based exit (bot.py 置換パスのイベント実観測カバレッジ) で締める (S-1 5 回目境界化判定の結論)
   - 「Phase 2.5 観察結果を Telegram 経路に引き継ぐ」は **採用しない** (N-T10 違反禁止、bot.py event handler は引き継げない layer)
3. **ユーザー自身が「土台が落ち着いた、Phase 4 へ進む」と明示的に宣言している**

3 が最終ゲート。1〜2 が満たされていなければ Claude 側から「まだ条件未達です」と差し戻す。条件達成判定は PROJECT.md / 各 STATUS.md / bot ログを根拠に Claude が報告し、最終判断はユーザーが下す。

**着手時**: `~/companion/persona/` に `docs/STATUS.md`。

---

## 健全性チェック履歴

Phase 4 着手発火条件 #2「直近 2 週間、Phase 1〜3 のいずれかで想定外の停止 / 誤動作 / 修正必須レベルの不具合が発生していない」を後で根拠付きで報告するための記録。フェーズ完了タイミング、または Phase 4 着手判断前に実施する。

### 2026-05-09: Phase 1〜2 健全性チェック

対象期間: 2026-05-06（Phase 1 開通）〜 2026-05-09（実測時点で 3 日強）。

- **bot.service (Phase 1)**: `ActiveState=active` / `SubState=running`、`ActiveEnterTimestamp=2026-05-09 02:50:52 JST` から再起動・異常停止なし（`NRestarts=0`）。`bot.log` は INFO のみで ERROR / WARN / Exception / Traceback の出現なし。各起動で `logged in as renbot#8921` と `notify channel verified: #通知 (1501135177223508081)` が記録され想定通り
- **systemd user timers (Phase 2)**:
  - `companion-notify-unattended-upgrades.timer` … `Result=success`、直近 service 実行の `ExecMainStatus=0`、最終発火 2026-05-09 09:01 JST
  - `companion-notify-system-report.timer` … `Result=success`、直近 service 実行の `ExecMainStatus=0`、最終発火 2026-05-09 12:08 JST
- **maintenance ログ**:
  - `notify-system-report.log`: 5 件 notified、3 件 skip（同日 2 回目以降の抑止、設計通り）
  - `notify-unattended-upgrades.log`: 4 件 notified、5 件 skip（内訳: `already notified` 2 件 / `result not yet logged` 3 件。後者は設計通りの意図的 skip、詳細は `maintenance/docs/STATUS.md` 2026-05-06 エントリ）
- **各 STATUS.md「既知の問題」**: `bot/docs/STATUS.md` / `maintenance/docs/STATUS.md` / `web/docs/STATUS.md` すべて「（なし）」

**結論**: Phase 1〜2 単独視点では想定外の停止 / 誤動作 / 修正必須レベルの不具合なし。ただし観察期間が 3 日強と短く、Phase 4 着手発火条件 #2 の「直近 2 週間」基準には未到達。次回チェック目安は 2026-05-20 以降。

**2026-05-09 同日追記**: 本チェック完了直後に Phase 3-1 の TODO 2「Discord 発火 UX 確認」着手で 2 件の設計上の不具合を観測した—(1) bot が会話を保持せず Phase 3-1 の確認ラリーが破綻、(2) `workspace/.claude/settings.json` に WebSearch / WebFetch 権限が無く Web 検索フローが止まる。両件とも当日中に修正済み（`bot/docs/STATUS.md` および `web/docs/STATUS.md` 同日エントリ）。Phase 4 着手発火条件 #2 を将来判定するときは「Phase 3 を実運用に乗せる前に発覚した設計欠陥であり、運用中の停止 / 誤動作には該当しない」扱いとする。

### 2026-05-14: Phase 1〜2.5 健全性チェック

対象期間: 2026-05-09（前回チェック）〜 2026-05-14（実測時点で 5 日強）。Phase 2.5「土管の耐久化（再設計）」のサブタスク T-0 / T-A / T-B / T-C / T-D 前半 / T-E が 2026-05-14 中に集中して完了したタイミング。

- **bot.service (Phase 1)**: `ActiveState=active` / `SubState=running`、`NRestarts=0`（Restart=on-failure による自動再起動 0 件）。期間内の `Stopped` / `Started` 9 ペアはすべて手動 restart（Phase 2.5 サブタスク反映時の bot 入れ替え）。現在 `ExecMainStartTimestamp=2026-05-14 20:51:38 JST`（T-E 実弾確認のための restart）から active 連続。`bot.log` の ERROR / Exception / Traceback / failed ログは **0 件**
- **systemd user timers (Phase 2)**:
  - `companion-notify-unattended-upgrades.timer` … `Result=success` 継続、最終発火 2026-05-14 09:06、加えて T-E catch-up 経路で 20:51 に手動相当の trigger 1 回（`skip: result not yet logged` で設計通り）
  - `companion-notify-system-report.timer` … `Result=success` 継続、最終発火 2026-05-14 12:08。T-E catch-up は state_matches で skip exit 0
- **maintenance ログ** (2026-05-09 〜 2026-05-14):
  - `notify-system-report.log`: 5/9 〜 5/14 すべて `notified for YYYY-MM-DD` 記録、欠日なし
  - `notify-unattended-upgrades.log`: 5/9, 5/11, 5/12, 5/13, 5/14 に `notified for ...` 記録。5/10 と 5/14 catch-up の `skip: result not yet logged` は同スクリプト L44-46 のコメント通り「判定途中停止セグメント」の待機 skip（誤動作ではない、`bot/docs/STATUS.md` T-E Done エントリの 2026-05-14 追加観察で詳細）
- **Phase 2.5 サブタスク (5/14 同日完了)**:
  - code-reviewer 「修正必須」反映済 2 件（T-C commit message スタイル / T-D 前半 cmd_status の時刻表示混在）
  - T-D 前半で「メンション付き `@renbot /quota` でメッセージ本文文字列マッチが一致しない」を実弾で発見、同日内に Discord 公式 slash command (`app_commands.CommandTree`) 正規登録へ切替で根本対応 → **運用に流出する前の実装過程で発見・修正**したため Phase 4 着手条件 #2 の「運用中の停止 / 誤動作」には該当しない扱い（2026-05-09 同日追記の方針と整合）
  - vault push reject 1 件（5/14 17:04, Notion ノート, メイン機側で 3 commits 先行）を観察、`bot/docs/STATUS.md` 「vault push reject 観察ルール」通り手動 rebase で復旧。設計仕切り直しサインは **2 件目から**（現状 1 件目 = 観察ルール内、想定外不具合ではない）
- **vault-sync.log (Phase 3-1, Stop フック)**: 5/14 16:50 / 17:00 に発火、2 commits 作成 + gitleaks `no leaks found` pass、設計通り
- **各 STATUS.md「既知の問題」**: `bot/docs/STATUS.md` / `maintenance/docs/STATUS.md` / `web/docs/STATUS.md` すべて「（なし）」継続

**結論**: 期間内に想定外の停止 / 運用流出した誤動作・修正必須レベル不具合 **0 件**。bot 自動再起動 0 件、ERROR ログ 0 件、Phase 1〜2 / Phase 3-1 (vault 同期) 共に健全。Phase 2.5 は実装中だが安定運用カウントには未投入（T-D 後半 = `CreditBudgetGuard` 実装が 2026-06 上旬に残）。**Phase 4 着手条件 #2 の「直近 2 週間」カウントは Phase 2.5 完全完了 (T-D 後半含む) 後の 2026-06 中旬から開始するのが妥当**。~~次回チェック目安: 2026-06-15 前後~~（**2026-05-19 entry で T-D 後半即時前倒しに伴い更新、新基準は 2026-06-02 = 健全性 2 週間観察完了タイミング**、その後 voice bot/ 側着手前に条件 #2 を判定する）。

### 2026-05-18: Phase 1〜3 健全性チェック (Phase 3-2 着手日)

対象期間: 2026-05-14（前回チェック）〜 2026-05-18（実測時点で 4 日強）。Phase 3-2 着手 + T-1 sprint #1 (B-voice-15 AVX1 適合実機検証) 当日。

- **bot.service (Phase 1)**: `NRestarts=0`、`ActiveEnterTimestamp=2026-05-14 22:10:40 JST` から 4 日弱 active 連続。期間内 `bot.log` の ERROR / WARN / Exception / Traceback 出現 **0 件**。5/14 catch-up セッション (T-E 実弾確認) 以降の手動 restart なし、`Restart=on-failure` の自動再起動 0 件
- **systemd user timers (Phase 2)**:
  - `companion-notify-unattended-upgrades.timer` … `Result=success` 継続、最終発火 2026-05-18 09:04:14 (`notified for 2026-05-18 06:03:21,347`)。5/15-5/18 すべて欠日なく notified 記録
  - `companion-notify-system-report.timer` … `Result=success` 継続、最終発火 2026-05-18 12:07:14 (`notified for 2026-05-18`)。5/15-5/18 すべて欠日なく notified 記録
  - `dashboard-start.timer` / `dashboard-stop.timer` … 共に `Result=success`、5/18 朝 05:30:00 起動 + 09:00:00 停止 正常完走、`dashboard.service NRestarts=0`
- **maintenance ログ**: 5/14 の `notify-unattended-upgrades.sh skip: result not yet logged` 3 件 (前回チェックで観察済「判定途中停止セグメント待機 skip」、設計通り) を除けば、5/15-5/18 すべて `notified for ...` で正常完走
- **Phase 3-1 (Web 検索 → md 蓄積)**: 期間中 Discord 経由の vault push なし (2026-05-17 Phase 3-1 全 TODO 消化後、追加発火なし)。重複チェック手段 grep / 発火 UX 自然文継続の確定方針 (`web/docs/STATUS.md` 5/17 エントリ) が実運用に乗る前段
- **Phase 3-2 着手 (2026-05-18)**:
  - voice/ サブプロジェクト初期化 (`docs/STATUS.md` + `README.md` + `SETUP.md`)、git init は T-1 sprint pass 後に分離 (`workspace/redesign/voice-design.md` §10 step 2 整合)
  - T-1 sprint #1 (B-voice-15 AVX1 適合実機検証) **大部分 pass**: V-0a / V-15 / V-2 / V-3 / V-3a の 5 項目 pass、**発話確認のみ user 物理確認 pending** (外出中の user 帰宅後に TV 音声を物理確認)
  - VOICEVOX engine 0.25.2 を `~/companion/voice/engine/linux-cpu-x64/` に展開 (1.69 GB)、warm 合成計測 9 件完走 (短/中/長 各 3 回、RTF 2.1-3.0)、engine 停止クリーン完了 (RAM/Swap 解放確認)
  - **drift 5 件発見・記録**: `voice-design.md` v1.0.1 改版で center of truth 訂正、`voice/SETUP.md` / `voice/docs/STATUS.md` と整合した状態を維持。実装着手段で修正適用する
  - これらは「Phase 3 着手前の実装過程で発覚した設計・前提齟齬」であり、運用流出した誤動作には該当しない (2026-05-09 同日追記の方針 / 2026-05-14 T-D 前半の slash command 発見と整合)
  - T-1 sprint #2 (V-13 HDMI EDID + V-1 cold start) **V-1 pass / V-13 fail 確定**: V-1 真の cold start 3 回 11-17 秒 (推定 33-65 秒の 1/3 以下、drift 6 件目)、V-13 リモコン TV 電源 OFF でも `HDMI-1 connected` 維持で xrandr gate 機能せず確定。voice-design.md §0 案 A T2 (6:30 固定自動発火) / §1.7 morning-greeting.sh xrandr gate / §1.8 failure mode 4 段階保険 (2)(3) の前提崩れ
  - **設計仕切り直し議論起動準備 (2026-05-18 同日)**: user 提案「自動で鳴らす設計をやめて、いったんその時間帯に Discord から声をかけたときのみに絞る」を team `companion-voice-design` 再起動で正式議論する方針確定。voice-design.md v1.0.2 → v2.0 改版範囲は voice/docs/STATUS.md「設計仕切り直し議論 brief」section に整理。devil's advocate 起用 + plan mode + permission pre-approval 必須 (CLAUDE.md「Agent Teams 運用方針 / 落とし穴 A〜F」遵守)
  - V-13 fail も「Phase 3 着手前の実装過程で発覚した設計前提崩れ」扱い、運用流出した誤動作には該当しない (2026-05-09 / 2026-05-14 T-D 前半の方針と整合)
  - **voice-design v2.0 確定 (2026-05-19、Round 1〜3 議論 + lead 集約)**: team `companion-voice-design` v2.0 仕切り直し議論で **case B 採用 (朝自動発火 punt + bot 駆動先行)** 確定、`workspace/redesign/voice-design.md` v2.0 書き起こし完了 + `voice/docs/STATUS.md` v2.0 反映完了 + team cleanup (shutdown_request → approve → TeamDelete) 完了。主要確定事項: bot 駆動 `/say` slash command (24h 受付) / voice_command.py 分離 (devil T-D-1(b) 採用) / cold start UX 案 W-silent / 引数長 multi-tier (bot.py 200 / say.sh CLI 2000) / failure mode 4 → 3 段階 (9:00 サマリ + dashboard ExecStopPost 例外承認とも撤回) / Phase 4 trigger 数値化 (週 5 回 × 2 週間 + voice_ledger.jsonl) / 素声運用 2 ヶ月上限 / **Phase 2.5 T-D 後半 (2026-06 上旬) との順序確定: voice 実装着手は T-D 後半完了後**。Round 3 衝突 2 件 (W-imm vs W-silent / 300 vs 2000 字) は lead 裁定で確定。devil 致命級指摘 5 件 (Phase 2.5 順序 / テキスト口調仕込み後のせ違反 / voice_command.py 分離 / padding skipped trigger 化 / engine 常駐数値化) すべて v2.0 反映
  - **設計判断履歴の書面化**: case B 採用根拠 5 項目を `voice/docs/STATUS.md`「設計判断履歴」section + `voice-design.md` v2.0 §5.1 に書面化 (devil §4.7 lead 責務 #1 採用)。case A 検証 (cec-client / PulseAudio sink / TV IP API / Requires のみ / 諦め) は Phase 4「morning-greeting 復活」trigger で再検証候補として残置
  - **v2.0 議論で得た workspace/CLAUDE.md 補強候補**: cross-review 精度向上 / 改版履歴 section の Round 2/3 必須化 / 比較対象 plan version 明示書式 / lead Round 2 SendMessage で「相手の latest version 読み直し」明示指示 (lead orchestration ミス自認、ux 自己反省 3 件と統合)。`workspace/CLAUDE.md` §B-2 として 2026-05-19 反映済 (Phase 3-2 完了を待たず drift 整備で前倒し)
- **各 STATUS.md「既知の問題」**: `bot/docs/STATUS.md` / `maintenance/docs/STATUS.md` / `web/docs/STATUS.md` / `dashboard/docs/STATUS.md` すべて「（なし）」継続 (voice/ は新設のため未記載カウント対象外)

**結論**: 期間内に想定外の停止 / 運用流出した誤動作・修正必須レベル不具合 **0 件**。Phase 1〜2 / Phase 3-1 / dashboard すべて健全運用継続、Phase 3-2 は着手当日で T-1 sprint #1 大部分 pass (発話確認 user pending) + T-1 sprint #2 で V-1 pass / V-13 fail 確定 (設計仕切り直し議論起動準備へ移行)。Phase 4 着手条件 #2「直近 2 週間」観察カウントは前回記載通り **Phase 2.5 完全完了 (T-D 後半 = 2026-06 上旬) 後の 2026-06 中旬から開始する方針を維持**。Phase 3-2 の voice-design v2.0 確定後の運用観察は別軸でカウント。次回チェック目安: 2026-06-15 前後 (T-D 後半反映タイミング)、その後 2 週間運用を観察して条件 #2 を判定する。

### 2026-05-19: Phase 2.5 完全完了マイルストーン (T-D 後半即時前倒し)

対象期間: 2026-05-18 (前回) 〜 2026-05-19 (本日)、Phase 3-2 voice/ 側前倒し完了 + Phase 2.5 T-D 後半 (CreditBudgetGuard) 即時前倒し完了が同日内に集中したマイルストーン。

- **bot.service (Phase 1)**: 前回 entry 時点で `ActiveEnterTimestamp=2026-05-14 22:10:40 JST`、本 entry 時点で 5 日強 active 連続 (`NRestarts=0`)、`bot.log` の ERROR / WARN / Traceback 0 件継続。本日中の T-D 後半反映 commit `5d64ec2` 後に user 側で `systemctl --user restart` 実施想定 (実施完了は別途記録)
- **systemd user timers (Phase 2)**: `companion-notify-unattended-upgrades.timer` / `companion-notify-system-report.timer` / `dashboard-start.timer` / `dashboard-stop.timer` いずれも `Result=success` 継続、欠日なし
- **Phase 3-2 voice/ 側完了** (本日、TODO #1 全消化):
  - V-S1 CLI 実弾 pass + T-1 sprint #1 残「発話確認 user 物理確認」消化 → 完了基準 (i) 達成 (21:45 JST「テスト発話、聞こえますか」全文 TV 物理確認 pass)
  - voice/ git init + GitHub プライベート repo (`mooneclipse/companion-voice`) 初回 push 完了
  - voice/scripts/say.sh / voice/bin/voice-engine-up.sh / voice-engine-ready.sh / voice/systemd/companion-voice-engine.service 実装完了
  - 詳細: `~/companion/voice/docs/STATUS.md` 2026-05-19 Done エントリ群参照
- **workspace/CLAUDE.md §B-2 反映済 drift 解消** (本日、空白期間 (a) 消化):
  - voice-design v2.0 議論で得た cross-review 精度向上 4 項目を `workspace/CLAUDE.md` L101-110 §「運用上の落とし穴と回避策」B-2 として 2026-05-19 反映済 (実コンテンツ反映は本セッション前から、本セッションは台帳 drift 整備)
  - subordinate CLAUDE.md (workspace / bot-workspace) の「設計判断・対症療法の上限」上位参照行確認、追加変更不要
  - 詳細: voice/docs/STATUS.md 2026-05-19 「workspace/CLAUDE.md §B-2 反映済 drift 解消」Done エントリ参照
- **Phase 2.5 T-D 後半 (CreditBudgetGuard) 即時前倒し完了** (本日、空白期間 (b) 消化、bot/ commit `5d64ec2`):
  - 元案では 2026-06 上旬実施予定だったが、ledger.jsonl 検証 (5/14〜5/19 累計 $0.7961 = $100 の 0.8%) + user 認識訂正 (companion-bot は `claude -p` のみ、API キー API は無関係、6/15 はカウント方式変更) + Anthropic Max 5x プラン公式メール ($100/月確定) で即時前倒し方針が user 確定
  - 実装: `bot/quota.py` に CreditBudgetGuard + `_aggregate` / `_record_common` helper + `exceeded_message()` ABC method、`bot/bot.py` の超過通知を guard 側責務に移譲、`bot/.env.example` を `BOT_BUDGET_GUARD=credit_usd` default に切替、`MONTHLY_BUDGET_ACTIVE_FROM` プレースホルダ (α) 撤廃
  - 単体テスト 9 テスト全 pass (CreditBudgetGuard.allow 境界、月初リセット、format_summary 常時表示、make_budget_guard env 切替、RequestsCountGuard 回帰)
  - design.md §4.2 / §4.5 / §4.6 / §15 を 2026-05-19 即時前倒しに合わせて訂正、「Anthropic クレジット残量の公式 API 経由照会」表現を「Anthropic Console 累計使用量の自動取得手段 (API キー API ではない)」に明確化
  - 詳細: `~/companion/bot/docs/STATUS.md` 2026-05-19 Done エントリ参照
- **各 STATUS.md「既知の問題」**: `bot/docs/STATUS.md` / `maintenance/docs/STATUS.md` / `web/docs/STATUS.md` / `dashboard/docs/STATUS.md` / `voice/docs/STATUS.md` すべて「（なし）」継続 (bot/ には新規「運用注記」section 1 項目追加 = CreditBudgetGuard 月末枠到達時の手動引き上げ手順、運用上の落とし穴予防、実害未発生)

**結論**: 期間内に想定外の停止 / 運用流出した誤動作・修正必須レベル不具合 **0 件**。**Phase 2.5 完全完了** (T-A〜T-E 全 commit 済、T-D 後半は 2026-05-19 即時前倒しで完了)。**Phase 4 着手条件 #2「直近 2 週間」観察カウント開始日を 2026-05-19 に確定** (前回 entry「2026-06 中旬から開始」方針から T-D 後半即時前倒しに伴い前倒し)。観察期間 2026-05-19 〜 2026-06-02、その後 voice bot/ 側実装 (devil T-D-1(d) 順序原則) → 2026-06 上旬目処。次回チェック目安: 2026-06-02 (健全性 2 週間観察完了タイミング)、その後 voice bot/ 側着手前に条件 #2 を判定する。

### 2026-05-20: 全体コードレビュー (Phase 2.5/3-2 直後 fresh-eye)

Phase 2.5 完全完了 + Phase 3-2 voice/ 側完了直後の fresh-eye 点検として、健全性 2 週間観察期間 (2026-05-19〜2026-06-02) の起点で全体レビュー実施。観察カウント開始日 (2026-05-19) は維持、本レビュー発覚分は「2026-05-09/5-14/5-18 同方針 = 観察前/期間中の実装過程で発覚した残置 issue は運用流出した誤動作に該当しない」扱い。

- **軸 1 STATUS.md drift 点検 (Claude 直接)**: drift 3 件検出。(i) dashboard 5/17-19 観察 In progress 放置 → 3 朝とも TV 物理確認で機能成功確認 (journal の `firefox window not found within timeout — leaving as-is` は predicate 課題で残置候補だが TV 表示は OK)、Done 移管。(ii) PROJECT.md L262 「次回チェック 6/15 前後」古い記述 → 2026-05-19 即時前倒しに伴い 2026-06-02 へ訂正。(iii) dashboard ゴミ収集ルール TODO 状態 → user 実機作業として残置、In progress とは別欄管理
- **軸 2 T-D 後半 CreditBudgetGuard (code-reviewer subagent)**: 修正必須 2 件すべて反映済。(i) `bot/tests/test_quota.py` が repo 不在 → 17 テスト全 pass で新規追加 (月跨ぎ JST 境界 / `_aggregate` JST 正規化 / env-value validation を含む)。(ii) `bot/bot.py:101` 旧 log が credit_usd 経路で `count_1h=0/None` を出力 → `guard_kind` 別の分岐に修正
- **軸 3 voice/ 側実装 (code-reviewer subagent)**: 修正必須 0 件、軽微 5 件 (採用 3 件 = ts ISO8601 化 / paplay if 文化 / cd コメント明示、不採用 2 件 = `LANG=C curl` punt / `TimeoutStopSec` Phase 4 punt)
- **軸 4 既存 bot simplify (code-reviewer subagent)**: 修正必須 0 件、軽微 5 件 (全採用 = `ClaudeOptions` 未使用 7 フィールド判定点を観察項目に追加 / design.md §3 図と実装乖離 1 行追記 / sessions.reset 戻り型 `SessionMeta` → `bool` 訂正 / `reader.read(1_000_000)` 上限付与 / vault-sync.log 観察項目追加) + 対症療法 2 周目候補 3 件 (事前警戒のみ: `_STDERR_PATTERNS` 3 件目 / `CLAUDE_TIMEOUT` 2 周目 / vault-sync.sh の rc!=0 後処理) + 軸 2 で B2-3 (`last_call_at` dead carry) / B2-5 (.env.example 重複) は不採用残置
- **軸 5 設計 doc 耐久性 (agent team)**: 2026-05-20 同日に実施完了 (team `companion-durability-0520`、architect / devil / ux + lead)。詳細は `~/companion/workspace/review-2026-05-20/axis-5-result.md`。修正必須 14 件 (M-1〜M-14) + 構造的指摘 8 件 (S-1〜S-8) + 観察項目 19 件 (K-1〜K-19) を集約。3 teammate 一致確定 4 件 = (a) 対症療法 2 周目候補警戒順序 C-3 > C-2 > C-1 / (b) 軸 5 二段階方式採用 (5/20 静的整合性完遂 + Round 4 = 5/26 以降 or 6/2 完了後の実観測再点検を別 session 予約) / (c)「実害ゼロ常態化」N=5 連続で仕切り直し境界化 (現状 4 回) / (d) architect M2-3 引数長 multi-tier RTF 超過確認 (200 字 = 103-110 秒 で wait_for(60s) 超過、bot.py /say 100 字 + wait_for 90s 修正)。新規発覚: claude CLI 2.1.145 STATUS.md 無記録 up = 再検証ルール取りこぼし (M-7、本 review 完了後最優先 lead 実施)。落とし穴 D「approve 前の最終整合チェック」を lead 自身が破った経路 (軸 5 起動推奨 5/26 → 5/20 前倒し) は二段階方式採用で構造的救済、user 判断 (b) 今日完結と両立。

#### 2026-05-20 設計判断履歴 (軸 5 agent team)

- **S-1**: パターン P1「実害ゼロ宣言の常態化」4 回連続 (5/9 / 5/14 / 5/18 / 5/20)、5 回到達で運用ルール仕切り直し境界化。devil D-A 自己訂正 (Round 1 で 5 回、Round 2 で 4 回に訂正 = 5/19 は issue 発覚でなく台帳更新でカウント対象外)
- **S-2**: パターン P2「即時前倒し」連鎖累積 (5/19 マイルストーン集中 + 5/20 軸 5 起動前倒し)、観察対象が「同時起動の総合観察」になっている自認
- **S-3**: パターン P3「lead 単独責任 vs devil 必須」の起動タイミング判断は devil unspawn のうちは反証経路なし、workspace/CLAUDE.md §B-2 補強候補として Round 4 で正式判断
- **S-4**: 軸 5 5/20 起動 = lead 自身が axis-5-next-session-prompt 5/26 推奨を破った plan misdirection、二段階方式採用 (5/20 = 静的整合性 + 構造的妥当性 / Round 4 = 6/2 完了後 or 5/26 以降の実観測再点検) で構造的救済、user 判断 (b) 今日完結と両立

#### 「実害ゼロ拡張ルール」境界 (運用ルール昇格、M-1 反映)

- 適用条件: (i) 観察期間中に発覚した issue が運用流出 (Discord に返答 / vault 書き込み等) 前であること (ii) 修正 commit が観察カウントの起算日リセットを発火させないこと (iii) STATUS.md 健全性履歴に「実装過程発覚」明記
- 非適用条件: bot.service NRestarts > 0、ERROR ログ Discord 流出、user 物理確認で機能不全観測
- 境界数値: 5 回連続到達 = 6 回目で「実装過程発覚扱い」を停止、設計仕切り直しサイン扱いに転換
- 判定 owner: Claude 初判定 → lead 確認 → user 最終裁定 (落とし穴 D「approve 前の最終整合チェック」継承)

#### 観察期間定義の精密化 (M-1 補足)

- 観察カウント起点 = 2026-05-19 維持 (devil 防護柵「健全性カウント開始日 5/19 は覆さない」)
- 但し bot.service ActiveEnter = 2026-05-20 00:57:34 JST (本日 commit `5d64ec2` 後 restart) で T-D 後半反映前/後の区別あり: 5/19 〜 5/20 00:57 = RequestsCountGuard 想定設計の bot、5/20 00:57 〜 6/2 = CreditBudgetGuard 想定設計の bot
- 実質的な CreditBudgetGuard 観察期間 = 5/20 00:57 〜 6/2 = 12 日 23 時間 (2 週間ではない)、6/2 完了 entry で明示

#### Round 4 (5/26 以降 or 6/2 完了後) 起動条件

- (i) 観察期間完了 (2026-06-02) または 5/26 以降の早期点検判断
- (ii) 観察データ初期メトリクス確定 (K-1〜K-12 集計)
- (iii) 対象 = 観察期間中に発覚した issue + 6/2 完了時点で判定保留だった軸 (axis-5-result.md §6)
- 起動手順: `~/companion/workspace/review-2026-05-20/axis-5-result.md` を center of truth として lead 単独で再起動判断、必要なら agent team `companion-durability-0602` 等で再起動

次回チェック目安: 2026-06-02 (健全性 2 週間観察完了タイミング) を維持。

### 2026-05-27: Phase 2.6 Telegram 移行設計確定 (agent team companion-telegram-migration)

Phase 2.5 健全性 2 週間観察期間中 (5/19-6/2) の **read-only 設計議論** として実施。bot.service / bot.py / settings.json / maintenance 系の挙動変更を伴う commit / push は **一切なし** (N-T3 違反回避、観察カウント保護)。

- **目的**: Discord 土管 → Telegram supergroup (topic = 1 session model) への移行設計確定。bot 指示はモバイル中心 + topic で分けたい要件 (user 確定)。
- **agent team 構成**: architect (Telegram Bot API + session 設計本体) / devil (構造的反証) / ux (mobile UX) + lead (companion-telegram-migration)
- **mesh 議論**: Round 1 → Round 2.3 (ux) / Round 2.1.1 (architect) / v1.0.8 (devil)、devil 反証 19 件 + 罠リスト N-T1〜N-T14 + 検証項目 V-1〜V-25 + D-add-1〜D-add-12 + plan reject 候補 R-1〜R-9 すべて整理 + 取り込み or 撤回
- **lead 裁定 2 件**: (a) ENV vs ファイル管理 → ENV 採用 (state 1 回決定原則整合、5+ topic で再点検 trigger) / (b) chunk reply → ux 案採用 (chunk2 以降 reply なし default、mobile UI 視認性)
- **P3 user 確認**: supergroup topic で確定 (他選択肢 = private chat / Slack / Matrix / Signal / PWA 拡張では「topic で分けたい」要件を満たせない)
- **3 plan 同時 approve 完了** + 確定設計を `~/companion/workspace/redesign/telegram-design.md` (center of truth) に転記
- **実装着手予定**: 2026-06-02 以降の cold cut 切替日 (Phase 2.5 観察完了後)
- **Phase 4 着手条件 #2 反映**: Telegram 観察 14 日単独判定 + voice/ 統合 +14 日、Phase 4 着手目安は 2026-06-16 +α 想定

**運用継承事例 (将来 team 向け)**:
- devil 装置が lead 認識違い (Issue 2 = 架空攻撃と誤判定) を反証で訂正 = 装置の本来機能 (lead judgment ミス訂正) 成功事例
- devil v1.0.3 で B-2 違反 (中間状態誤認、R-6 架空攻撃) を自己訂正 + §8.4.1 plan version 確認運用 (wc/stat/完了マーカー + 引用コード実物検証 + asynchronous 改訂中の 2 回 verify) を装置側に追加
- asynchronous 配信すれ違い 3 度目発生 (architect Round 2.1.1 完了通知 + lead Round 3.1 mini fix 指示の double cross) = agent team の本質的限界として記録、`workspace/CLAUDE.md` Agent Teams 運用方針 §B / §B-2 に「asynchronous 配信すれ違い実例」追記候補

**実害ゼロ拡張ルール (M-1) との関係**: 本 entry は **設計議論 read-only**、bot.service / bot.py 挙動変更ゼロ、「5 回連続境界」(2026-05-20 entry §設計判断履歴 S-1) には **発火しない** (適用条件 (ii)「修正 commit が観察カウント起算日リセットを発火させない」に該当)。

次回チェック目安: 2026-06-10 (cold cut 5/27 +14 日 = Telegram 観察完了タイミング、2026-05-27 (追) entry で前倒し)。

### 2026-05-27 (追): Phase 2.5 観察打ち切り + Phase 2.6 cold cut 前倒し判断

**判断**: lead 単独判断で Phase 2.5 健全性 2 週間観察 (5/19-6/2 予定) を **5/19-5/27 の 8 日で打ち切り**、Phase 2.6 cold cut 切替を 2026-06-02 → **2026-05-27 当日実施** に前倒し。user が選択肢 C「今すぐ cold cut 切替」を明示選択した経緯を受けた lead 確定。

**判断根拠** (覆し前提となる telegram-design.md §9.1「絶対遵守」を上書き):

- (a) Phase 2.5 観察 8 日経過時点で実害ゼロ確認: `bot.service` NRestarts=0、`bot.log` ERROR / WARN / Traceback 0 件、`/quota` credit_usd 表示稼働、ledger 累計は monthly $100 の 1% 未満想定 (前回 entry 5/19 時点 $0.7961 = 0.80% から 8 日経過、低消費継続) = low-frequency events なので残り 6 日待っても観察結論は同等の見込み
- (b) Phase 4 着手条件 #2 起点は telegram-design.md §9.2 で **Telegram 観察 14 日単独判定** に改訂済 (Phase 2.5 観察は「独立完了」として記録するのみ) = Phase 2.5 短縮は Phase 4 着手スケジュールに影響なし、むしろ cold cut 前倒しで Telegram 観察 14 日が前倒しされ Phase 4 着手判定が 6 日早まる (6/16 → 6/10)
- (c) 実装着手前検証 V-1〜V-25 + D-add-* + AIORateLimiter + Bot API up 監視運用 + V-4/V-5/V-6 実機検証すべて 2026-05-27 同日完了 (`bot/docs/STATUS.md` Phase 2.6 section 参照)、cold cut 前提条件成立
- (d) user 確認 (AskUserQuestion 「Phase 2.6 cold cut の前倒し方針は?」で選択肢 C「今すぐ cold cut 切替」明示選択、5/27 22時台)
- (e) lead 判断: agent team 再起動コスト (devil + architect で覆し議論 30 分以上) vs 前倒し利得 (Phase 4 着手 6 日前倒し + 観察期間中の lead 認知負荷削減) の秤、user C 選択尊重 + 過剰防御寄りと判定して前倒し採用

**落とし穴 D「approve 前の最終整合チェック」継承**: 観察期間打ち切り判断は設計レベル覆しだが、(b) で Phase 4 起点が独立、(c) で前提条件成立、(a) で観察データが残り 6 日待っても変化乏しいと推定、(d) で user 確認 = 仕切り直しは過剰防御と判定。

**仕切り直し境界 (S-1「実害ゼロ常態化」5 回連続) との関係**: 本判断は新規 issue 検出ではない (観察対象を Phase 2.5 → Telegram に切替えるだけ)、S-1 カウント (現状 4 回 = 5/9 / 5/14 / 5/18 / 5/20) は据え置き。Telegram 観察期間 5/27-6/10 で次回 entry が 5 回目に該当する場合は仕切り直し境界化判定を実施。

**devil 不在の反証経路欠如 (lead 自認)**: 本判断は devil 装置を起動せず lead 単独で実施 (telegram-design.md §13.4 で devil 装置の本来機能 = lead judgment ミス訂正 が機能した事例を経験した直後の判断としてはやや矛盾)。falsification: Phase 2.5 観察 8 日で十分根拠の脆弱性は、cold cut 後の Telegram 14 日観察で issue 発覚した場合 (Phase 2.5 を 14 日完走させていれば検出できたか) で事後検証する。事後検証で問題があれば次回類似判断時に devil 起動を必須化する運用ルールへ昇格 (S-3「lead 単独責任 vs devil 必須」起動タイミング判断の Round 4 議題に追加)。

**Phase 2.5 観察期間の最終結果 (5/19-5/27、8 日)**:
- bot.service: ActiveEnter `2026-05-20 00:57:34 JST` から 7 日強 active 連続、NRestarts=0、ERROR/WARN/Traceback 0 件
- CreditBudgetGuard (5/20 00:57 以降): 実弾運用、`/quota` credit_usd 表示稼働、ledger 累計低消費継続
- vault sync: `vault-sync-from-transcript.sh` Stop hook 正常稼働、commit 漏出なし
- maintenance 通知: catch-up 経路 + 日次 timer 経路の二重実行で重複なし (T-E state_matches で skip 動作確認済)
- 「実害ゼロ拡張ルール」(M-1) の適用条件 (i)(ii)(iii) すべて満たし

**時系列影響**:
- Phase 2.5 観察完了 → 5/27 (8 日)
- cold cut 切替 → 5/27 当日実施
- Telegram 観察 14 日カウント → 5/27 起算 = 6/10 完了予定
- voice/ 統合着手 → 6/10 以降 (順序原則、N-T14 違反禁止)
- voice/ 統合 +14 日 → 6/24 目処
- Phase 4 着手判定 → 条件 #1 / #3 と合わせて user 宣言時 (最短 6/24 +α)

次回チェック目安: 2026-06-10 (Telegram 観察 14 日完了タイミング)、その後 voice/ 統合着手前に条件 #2 を再判定する。

### 2026-05-30: Telegram 観察を 5/30 で打ち切り (user 判断) + S-1 5 回目 境界化判定 (agent team companion-obs-truncation-0530)

**判断**: user (SE, 最終決定者) が「Telegram 観察を前倒し打ち切りしたい。なんどかやり取りして問題ないと思った」と判断。lead は即追従せず、5/27(追) entry で予約した「次回 entry が 5 回目に該当したら仕切り直し境界化判定を実施」に従い devil レビュー (agent team) を起動。最終的に **観察を 2026-05-30 で打ち切り確定** (cold cut 5/28 00:26 起算 ≒ 実効 2 日強)。

**客観健全性データ (lead 採取、5/28 00:26〜5/30)**:
- `companion-bot.service`: NRestarts=0 / active 連続、ActiveEnter=2026-05-28 00:26:33 JST、ERROR/Traceback **0 件**
- `bot.log` WARNING 2 件 = `stall_check_job: get_me() failed (consecutive 1)` (5/29 ×2)、再起動閾値 3 連続未達・自己回復
- timer (system-report / unattended-upgrades / dashboard) 正常、ledger cold cut 以降 7 件 (`topic_key` schema 移行成功)・疎、最後 5/29 12:43
- vault-sync.log 最終 5/16 = **Telegram 期 未稼働**

**agent team companion-obs-truncation-0530 (devil + architect, mesh 3 巡で完全収束) の推奨と、その後の user 訂正**:
- team 推奨は「即打ち切りでなく event-based exit (6/1 月跨ぎ correctness + vault-sync/重複確認 能動 exercise、最短 6/2)」だった。主柱は「6/1 budget guard 月跨ぎが window 内で決定的に発火する唯一の未観測 correctness パス」。
- **user 訂正で主柱を撤回**: (a) 課金/クレジットの切れ目は暦の月初と別で、プラン更新で請求日が動く (先週更新済 = 既に別請求サイクル扱い)。`quota.py` の guard は暦月リセット (`_month_start` = day 1, 00:00 JST) で実請求サイクルと不整合 → 6/1 暦リセット観測の価値は薄い。(b) lead コード再確認: 月跨ぎ集計は `timestamp` と `total_cost_usd` のみ読み、`topic_key` を読まない → スキーマ移行は月境界ロジックに無関係、「新 schema で月境界が壊れる」懸念は的外れ (team の過大評価、lead 確認漏れ)。(c) 公式 $100 クレジット枠の運用開始は 6/15 から、現状 guard は前倒しの自衛自己上限で揃えるべき公式サイクルが未存在。
- ∴ **6/1 月跨ぎは「打ち切りを止める理由」にならないと確定**、team 推奨の時間依存 blocker は消滅。実務リスクも小 (消費 ≒$0.5/月 vs $100 cap)。

**S-1 5 回目 境界化判定の結論**: 本 entry は 5/9 / 5/14 / 5/18 / 5/20 に続く 5 回目 (5/27 cold cut は M-1 適用条件 (ii) で非該当)。境界判定の実体 = **「実害ゼロか (主観再評価)」を打ち切り基準に使うのを止める**。観察短縮 2 連続 (Phase2.5 14→8、Telegram 14→2強) の ratchet を自認し、今後 (特に voice 統合観察) の exit は「会話成立回数」や「消費額の小ささ」でなく **bot.py 置換パスのイベント実観測カバレッジ** で締める。team が提案した event-based exit の枠組みは、6/1 月跨ぎ項を除いた残り (下記残置観察項目) と voice 統合観察への pre-commit として採用。

**残置観察項目 (打ち切りの blocker にしない、次の自然使用で 1 回ずつ閉じる)**:
- vault-sync Stop hook + Phase 3-1 重複確認フロー (§7.4) を Telegram 経路で能動 exercise 各 1 回 (user 操作起動、時間非依存)
- stall 3 連続→`sys.exit(1)`→systemd restart→catch-up 経路 (確率的、本番能動検証は危険ゆえ継続観察 + code review)

**設計メモ (低優先, 将来の保留事項候補)**: `CreditBudgetGuard` は暦月リセットだが実 Anthropic 課金は請求日基準 (プラン更新で移動) + 公式枠は 6/15 開始。自衛用途では実害小だが、6/15 以降に実枠と揃えるなら billing-cycle aware な集計境界へ寄せる検討余地あり。

**時系列影響 (更新)**:
- Telegram 観察打ち切り → 5/30 (実効 2 日強)
- voice bot/ 側統合 (bot.py 改変) 着手 → 5/30 以降 unblock (N-T14 = Telegram 観察完了後着手、を充足)。**着手で bot.py 改変による新 14 日観察が発火** (§10 観察 reset)
- もう 1 つの bot.py 改変タスク `/vault-push` コマンド追加 (Telegram から手動 push をモバイル化、Option A) を別セッション実装用にブリーフ化 (`bot/docs/STATUS.md` TODO、feasibility 検証済 2026-05-30)。voice 統合とは **同時に入れない** (bot.py 同時 2 方向回避)、着手順序は着手時に user 確認
- **Phase 4 着手条件 #2 の観察基準は voice 統合 +14 日に再基準化** (Telegram 単独観察でなく、bot.py 同時 2 方向回避の原則上 voice 統合観察が真の最終律速)。voice 統合観察にも event-based exit を pre-commit
- Phase 4 着手判定 → 条件 #1 / #3 と合わせて user 宣言時

**team cleanup**: shutdown_request → devil/architect 終了 → TeamDelete 完了。plan ファイル (devil `fluffy-stargazing-graham.md` / architect `modular-sprouting-widget.md`) は cleanup 削除済、要点は本 entry に転記 (落とし穴 F)。

次回チェック目安: voice bot/ 側統合 着手時 (= 新観察カウント起点)。着手前に残置観察項目 2 件の exercise 計画を bot/docs/STATUS.md に落とす。

---

## 将来の保留事項

- **自宅外アクセス**: Tailscale 導入済 (2026-05 以前完了。`miho-inspiron-3521` / `m-gamepc` / `pixel-6` が tailnet 同居)。Tailscale 起点の単発ユーティリティとしてスマホ専用リモコン PWA (`~/companion/remote/`) を 2026-05-20 初期化 (フェーズ外、ロードマップ独立)。設計確定 (remote-design.md v1.0) + v1-α 実装完了 (2026-05-20、F-2 voice / F-3 OS status / token 認証 / PWA / systemd)。**境界原則** (M-14、軸 5 集約 → 2026-05-20 remote-design v1.0 で改訂): 認可外経路で機能を露出しない & **claude を起動する操作 (Max クレジット消費 + session 触接) はすべて単一 budget guard を通す**。経路振り分けは「`claude -p` を起動するか」の静的 1 ビットで設計時に確定 (design §5、runtime で再評価しない)。F-1 (claude 起動) = bot.service Unix socket 経由 + budget guard 必須 (v1-β)、F-2 voice / F-3 OS status (claude 非起動) = remote 直叩き (v1-α)。認可は Tailscale ACL + アプリ層トークン (+可能なら identity header)。旧文面「remote/ から bot.service/voice を直接叩かない・Discord 経由 + OWNER_ID で統一」は撤回 (対話完結型へ変更、bot.py 最小双方向化 = 案 B、F-1 認可退行 H-1 は design §6 で受容判断済)。詳細は `~/companion/workspace/redesign/remote-design.md`
- **音声モデル自作**: メイン機で学習、Linux 機で推論。スペック次第で諦める
- **メイン機側の整理運用**: `notes/` への機械書き込み ↔ `aidiary/`/`clips/`/`inbox/` の手書きノートを統合する作法（タグ整理、MOC、`unprocessed` → `processed` 移行）。Phase 3-1 が運用に入って必要が見えたタイミングで明文化する
- **companion repo 群の monorepo 化（someday）**: 現状 `bot/` `maintenance/` `web/` `dashboard/` を個別 private repo にしているが、全部「この 1 台の身の回りのもの・オーナー 1 人・独立公開なし・相互参照あり」なので monorepo（`companion` or `companion-machine`、`vault/` は別物なので除外）の方がオーバーヘッドが少ない。統合は単発の整理タスクとして（`git filter-repo` で履歴マージ or 新 repo に集約して旧 repo はアーカイブ）。動いてるものを触るので急がない。ハイブリッド（`bot/` だけ独立のまま、`maintenance/+web/+dashboard/` を集約）も可。

着手時期は未定。必要が出てきたフェーズの中で吸収するか、独立させる。

---

## 「続きお願い」の運用

ユーザーが「続きお願い」「次のタスクお願い」と言った場合の進め方:

1. **PROJECT.md（この文書）でフェーズの現在地を確認**
2. **該当フェーズの `docs/STATUS.md` を開く**
3. **In progress があればそれを継続。なければ TODO の先頭を 1 件 In progress に移して着手**
4. **タスク完了 → subagent でレビュー（観点は STATUS.md の運用ルール参照）→ Done へ移動 → 「最終更新」日付更新**
5. **1 タスク完了したら一旦止まってユーザーに報告**。次のタスクへは指示を待つ

**1 セッションで 1 タスク**。複数タスクを連続で消化しない。土管を通したあとも、各フェーズで同じリズムで進める。

フェーズをまたぐ着手（例: Phase 1 → Phase 2 開始）は必ず宣言して合意を取る。
