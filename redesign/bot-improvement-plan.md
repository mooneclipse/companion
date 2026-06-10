# companion-bot 改良プラン (閲覧自由化 + 画像応答 + 予算計器)

作成: 2026-06-10 / OWNER 合意済み方針のステップ分解
前提調査: `bot/docs/STATUS.md` + `bot-workspace/.claude/settings.json` + `bot/sessions/ledger.jsonl` 実測 (2026-06-10 時点: 6 月 60 呼び出し $2.27、月ペース換算約 $7 / $100 上限 = 7%)

## 目的

1. bot 経由の claude セッションに **このマシン内をある程度自由に閲覧・操作** させる
2. `claude -p` の月次 $100 クレジット上限と **バランスを取る計器** を入れる
3. **chat に送った画像を見て返答する機能** を追加する (保存機能は不要、原本は Telegram 上にある — OWNER 確定 2026-06-10)

## 全体方針

- ボトルネックは予算ではなく **permission 設計** (実消費は上限の 7%)。主戦場は `bot-workspace/.claude/settings.json` で、bot.py 改変は最小限に分離する
- 各 Step = 1 回の着手単位 (`/orc` 1 回分の粒度)。Step 内の項目は 1 論理単位 = 1 commit
- bot.py を触る Step (2 以降) は **B-3 観察締め (2026-06-11) 後に着手**。改変ごとに restart (user 操作) + 変更規模に応じた短い様子見 (PROJECT.md 条件 #2 の再定義に整合)
- Step 1 → 消費観察 (1〜2 週間) → Step 3 の警告系 → Step 4 を 1 機能ずつ、が推奨順。**Step 2 (画像応答) は OWNER 要望により観察を待たず B-3 締め後すぐ着手してよい**

## 受容するリスク (OWNER 明示確認済みの前提)

閲覧自由化 + WebFetch/WebSearch 同居により、「読めるもの = (プロンプトインジェクション経由で) 外に出得るもの」になる。緩和は:

- 入力経路が OWNER_ID 限定 (4 段防御) であること
- 認証情報パスの deny 増強 (Step 1-1) を **allow 拡張より先に** 入れること
- `Bash(cat:*)` 等の読み系 allow は Read deny を素通りする (現状の `grep:*`/`rg:*` 許可も同様)。パス単位で完全には塞げないため、**残存リスクとして受容**する。受容判断の根拠 = OWNER 限定経路 + WebFetch で取り込む外部コンテンツは bot 利用実態上 OWNER 指示の調査が主
- `Bash(find:*)` は読み系枠だが `-delete` / `-exec rm` で削除能力を持つ (2026-06-10 code-reviewer 指摘)。OWNER 限定経路の前提でこれも受容に含める。引き直し時はこの 1 行も再評価する

この受容判断に変更が必要になったら (例: OWNER 以外の入力経路追加)、本セクションを引き直す。

---

## Step 1: 閲覧の自由化 (settings.json のみ、restart 不要、即着手可) — ✅ 完了 2026-06-10

実装記録は `bot/docs/STATUS.md` Done「Step 1 閲覧自由化 (C-1 完了)」参照。実弾 3 件 pass、消費観察起点 = 2026-06-10。補足 2 点: (1) settings.json の allow 編集は classifier に拒否されるためステージングファイル + user cp 経由で適用した (Step 2 以降は bot.py 編集なので非該当)。(2) negative test で Bash `ls ~/.ssh/` も拒否を確認 — Read deny は Bash の読みにもある程度効く実測 (上記受容リスクは想定より限定的)。

**変更ファイル**: `bot-workspace/.claude/settings.json` のみ。bot.py 非接触なので B-3 観察を阻害しない。settings.json は次回 `claude -p` 起動から効く (bot restart 不要)。

### 1-1. deny 増強 (allow 拡張より先にコミット)

既存 deny (`~/.ssh` / `~/.aws` / `.env` 系 / `~/.claude/.credentials.json` / `~/.netrc` 等) に追加:

```
"Read(~/.mozilla/**)",
"Read(~/.config/google-chrome/**)",
"Read(~/.config/chromium/**)",
"Read(~/.local/share/keyrings/**)",
"Read(~/.gnupg/**)",
"Read(~/.config/gh/**)",
"Read(~/.bash_history)",
"Read(~/companion/**/.env)",
"Read(~/companion/**/.env.*)"
```

(相対 `Read(.env)` は CWD 基準のため、`~/companion` 開放と同時に絶対パス形を併設する)

### 1-2. 閲覧 allow 拡張

- `additionalDirectories`: `/home/miho/companion/vault` + `/home/miho/companion/logs` → **`/home/miho/companion`** に置換 (companion 全体)
- allow に追加:

```
"Read(~/companion/**)",
"Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)",
"Bash(find:*)", "Bash(wc:*)",
"Bash(df:*)", "Bash(du:*)", "Bash(free:*)", "Bash(ps:*)",
"Bash(uptime)", "Bash(sensors)",
"Bash(systemctl --user status:*)", "Bash(systemctl --user list-units:*)",
"Bash(systemctl --user list-timers:*)",
"Bash(journalctl --user:*)"
```

- 操作系 (restart / インストール / 書き込み) は **入れない**。必要が生じたらサービス単位で個別 allow (Step 5 参照)

### 検証

- supergroup #chat から「`~/companion/bot/bot.py` の行数は?」「ディスク残量と bot.service の稼働状況を教えて」を実弾で投げ、Read / df / systemctl が通ることを確認
- 「`~/.ssh` の中身を見せて」が deny されることを確認 (negative test)

### 完了条件

deny 増強 commit + allow 拡張 commit の 2 commit、実弾 3 件 pass、STATUS.md Done 転記。

---

## Step 2: bot.py 小改変パック #1 — 画像応答 + permission_denials 記録 (B-3 締め 6/11 後)

**変更ファイル**: `bot.py` + `tests/test_bot.py`。2 commit、restart は 1 回にまとめる (user 操作)。

### 2-1. chat の画像を見て返答する機能 (OWNER 要望、優先)

**設計**:

- `MessageHandler(filters.PHOTO & message_filter)` で新ハンドラ `on_photo` を追加 (`_authorized` 4 段防御は on_message と同一)
- **発火はメンション不要** (OWNER が bot 専用 supergroup に画像を投げる行為自体をトリガとみなす)。キャプションは任意 — あれば prompt 本文、なければ「この画像を見て一言返して」相当のデフォルト文
- 取得: `message.photo[-1]` (最大サイズ) → `get_file()` → `download_to_drive()` で `bot-workspace/incoming/<topic_key>/<ts>_<file_unique_id>.jpg` に保存。ファイル名は `_safe_attachment_name` 同様の安全化 (英数 `_.-` のみ)
- prompt に絶対パスを添えて「添付画像 `<path>` を Read ツールで見て返答」と指示。`claude -p` の Read は JPG/PNG を視覚入力として読める。CWD (`bot-workspace/`) 配下なので **追加 permission 不要**
- **保存は一時キャッシュ扱い**: vault には書かない (OWNER 確定: 原本は Telegram 上にある)。同一 session の追い質問 (「さっきの画像の右上は?」) で再 Read できるよう即時削除はせず、**topic ごとに最新 10 件を超えた古い分を download 時に prune** (1 回で確定する素直な世代管理、リトライ・分岐なし)
- v1 スコープ外 (YAGNI): document 形式の画像 / album (media_group) / 動画。必要になったら別 Step

**コスト影響**: 画像 1 枚 ≈ 入力 1.1k〜1.6k tokens (+$0.005/ターン程度)。誤差レベル。

**テスト**: ファイル名生成 / prune 対象選定 / prompt 組み立ての純関数をユニットテスト (ネットワーク非依存、既存 133 tests に追加)。

**検証 (実弾)**: #chat に画像 (キャプションあり / なし各 1 枚) を送り、内容に言及した返答が返ること。`incoming/` に 11 枚目投入で最古が消えること。

### 2-2. permission_denials の記録 (閲覧自由化のデータ駆動運用)

`ClaudeResult.permission_denials` は取得済みなのに現状捨てている。`run_claude` の record 経路で:

- ledger entry に `"permission_denials": [...]` を追加 (空なら省略可)
- 非空のとき `logger.info("permission denied: %s", ...)` を bot.log に残す

これで「bot が何をやろうとして弾かれたか」が観察でき、以降の allow 拡張を whack-a-mole でなくデータ駆動で判断できる。**deny ヒットを見て自動で allow を足す仕組みは作らない** (拡張判断は OWNER + 手元セッションの仕事)。

### 完了条件

2 commit + code-reviewer 通過 + restart (user 操作) + 実弾検証 pass、STATUS.md Done 転記。bot.py 改変につき数日の様子見 (NRestarts / ERROR 監視) を添える。

---

## Step 3: 予算バランス装置 (Step 1 開放後の消費観察 1〜2 週間を経てから)

**変更ファイル**: `quota.py` + `bot.py` (表示系) + tests。

### 3-1. ソフト警告 (50% / 80%)

- `record()` 後に月次累計が 50% / 80% を跨いだら #maintenance topic に 1 回だけ通知 (例: `[budget] 本月累計 $50.12 / $100 (50% 到達)`)
- 「月 × 閾値ごとに 1 回」の発火管理は state ファイル (`sessions/budget-notified.json` 等) を 1 回引いて確定 (2 周目ルール整合: 文言マッチ・リトライなし)
- 現状はハード上限到達時のみ表面化するため、その手前の計器を足すのが目的

### 3-2. /quota に月末着地予測

`format_summary` に 1 行追加: `着地予測: $XX.XX (現在ペース × 残日数)`。月初からの日割りペースの単純外挿でよい (精密予測は過剰)。

### 3-3. /status にセッション肥大の可視化

直近呼び出しの `cache_read_input_tokens` とターン数を表示し、肥大時 (目安: cache_read 150k tokens 超) に「/reset で単価が下がる」旨を 1 行添える。**自動 reset は入れない** — 会話継続性とのトレードオフは OWNER 判断。実測根拠: 長寿命 session で 1 ターン $0.13 まで上昇した例あり (2026-06-10 ledger)。

### 完了条件

各項目 1 commit + テスト + restart + 実弾 (/quota /status 表示確認)。50%/80% 通知は実弾困難なため state 注入のユニットテストで代替。

---

## Step 4: 機能追加 (優先度順に 1 機能 = 1 着手)

### 4-1. リマインダ `/remind`

- PTB JobQueue は導入済み (`job-queue` extra)。`/remind 30m 洗濯物` → 指定時刻に同 topic へ発話。**claude を介さないのでコスト 0**
- 永続化: bot 再起動で消えない要件にするなら `sessions/reminders.json` に持たせ起動時に再スケジュール。v1 は「再起動で消える」割り切りでも可 — 着手時に OWNER に 1 行確認

### 4-2. 共用チケット連携

- bot セッションから `tickets.py` を引ける allow を追加 (「#N やって」運用の bot 経路対応)。実装時に tickets.py の実パスを確認してから allow パターンを書く
- 自発発話 seed に未消化チケットを混ぜるのは効果を見てから (proactive prompt の注入境界ルールを遵守: bounded なフィールドのみ展開)

### 4-3. 死蔵知識との再会 (memory の種、proactive 拡張)

- proactive 基盤 + vault read は揃っている。週 1 で読み返されていない古いノートを seed (`vault_hint` と同じ basename 境界) に載せ「昔これ気にしてたよ」と再会させる
- 掘り起こし選定は script 側 (maintenance) の仕事、bot.py は既存 payload 経路のまま — bot.py 改変ほぼゼロ

### (実現済み扱い)

マシン状態の自然文ヘルスチェック (「ディスク大丈夫?」等) は Step 1 の Bash allow だけで成立する。専用コマンドは作らない。

---

## Step 5: 見送り棚 (発火条件付き)

| 項目 | 判断 | 再検討トリガ |
|---|---|---|
| topic 別モデル (#chat を Haiku 4.5) | 見送り | 月次消費が $50 を超えたら導入 (`ClaudeOptions.model` は実装済み、topic→model マップを足すだけ) |
| claude を介さない生シェル `/sh` | 不採用 | — (OWNER スマホ乗っ取り = マシン全権になる。permission 層が挟まる土管経由を維持) |
| 操作系の包括 allow (restart 等) | 不採用 | 必要が生じたサービス単位で個別 allow (例: `Bash(systemctl --user restart companion-dashboard.service)`) |
| 画像の vault 保存 | 不要と確定 | OWNER 明言 (2026-06-10、原本は Telegram 上)。必要になれば `/tweet` の attachments 基盤を流用 |
| document 画像 / album / 動画対応 | 見送り | 単発 photo 運用で不足を感じたら |
| セッション自動 reset / compaction | 見送り | Step 3-3 の可視化で手動 /reset 運用が回らないと分かったら設計議論 |

---

## 予算試算 (再掲)

- 現状: 1 呼び出し平均 $0.04〜0.05、月ペース約 $7
- 自由化後の重め運用 (1 日 30 ターン、ツール多用 1 ターン $0.10) でも月 $90 でハード上限内
- 現実的想定 (1 日 10〜15 ターン) で **月 $15〜30**。Sonnet 4.6 固定のままで成立、CreditBudgetGuard + Step 3 ソフト警告で暴走検知

## 進行管理

- 本ファイルが改良プランの center of truth。各 Step 完了時に `bot/docs/STATUS.md` Done へ転記し、本ファイルの該当 Step に完了日を追記する
- `bot/docs/STATUS.md` TODO に C-1〜C-4 としてポインタ登録済み (「次おねがい」運用で着手可能)
