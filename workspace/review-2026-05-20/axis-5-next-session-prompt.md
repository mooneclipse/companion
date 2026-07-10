# 軸 5 別セッション実施用 prompt (設計 doc 耐久性レビュー、agent team)

このファイルは 2026-05-20 全体レビューの軸 5「設計 doc 耐久性レビュー」を **別セッションで** 実施するための self-contained 指示。本日 (2026-05-20) は軸 1-4 完了 + 修正必須 + 軽微採用分は 3 repo に commit + push 済 (PROJECT.md 健全性履歴 2026-05-20 entry 参照)、軸 5 のみ context / 時間都合で別セッション punt。

## 起動タイミング (推奨)

- **2026-05-26 以降**: 健全性 2 週間観察期間 (2026-05-19〜2026-06-02) の **初期 1 週間データ** (NRestarts / ERROR ログ / `/quota` credit_usd 表示 / vault-sync.log 行数 / `[guard: credit_usd]` ledger 累計) が出揃ったタイミング。これにより teammate が「観察初期データで設計の前提が崩れていないか」を実証的に検証できる
- **2026-05-19〜2026-05-25 の間**は punt 妥当 (観察データが薄い、agent team の負荷に対して費用対効果が低い)

## 「続きお願い」運用上の動線

別セッションで CWD = `~/companion/workspace/` で「続きお願い」と言われたら、Claude は PROJECT.md L329「続きお願い」運用に従い PROJECT.md → 各 STATUS.md を読む。PROJECT.md 健全性履歴 2026-05-20 entry に「軸 5 別セッション punt、prompt は `workspace/review-2026-05-20/axis-5-next-session-prompt.md`」と明記済なので、本ファイルを開いて以下の手順を実行する。

## 実行手順

### 1. 前提読み込み

以下を必ず先に読む。`~/companion/CLAUDE.md` の「Agent Teams 運用方針 / 落とし穴 A〜F」遵守 + companion CLAUDE.md「設計判断・対症療法の上限」遵守:

- `~/companion/CLAUDE.md` (全文、agent team 運用方針 + 落とし穴 A〜F)
- `~/companion/workspace/CLAUDE.md` (Agent Teams 運用方針セクション)
- `~/companion/workspace/PROJECT.md` (全フェーズ地図、特に健全性履歴 2026-05-20 entry)
- `~/companion/workspace/redesign/design.md` v0.2.3 (Phase 2.5 設計、§3 ディレクトリ図は 2026-05-20 で実装乖離追記済)
- `~/companion/workspace/redesign/voice-design.md` v2.0.2 (Phase 3-2 case B 採用根拠 + Round 1-3 議論)
- `~/companion/workspace/review-2026-05-20/questions.md` (軸 1-4 結果まとめ、軸 5 の D-2 section)

### 2. permission pre-approval (spawn 前に必須、落とし穴 E 遵守)

設計議論 team では実機検証で以下を多用する。spawn 後に `.claude/settings.json` の `permissions.allow` 追加は auto mode classifier に Self-Modification 拒否されるため、**spawn 前に** 以下を allow に入れる:

```
Bash(claude -p:*)
Bash(claude --help:*)
Bash(claude --version)
Bash(uuidgen)
Bash(ls:*)
Bash(cat:*)
Bash(head:*)
Bash(tail:*)
Bash(grep:*)
Bash(rg:*)
Bash(find:*)
```

`update-config` skill で `.claude/settings.json` に追加。すでに入っているものは重複追加不要。

### 3. team 起動 (plan mode + 複数 teammate)

`TeamCreate` で team を起動。teammate 構成:

- **architect**: 設計の長期耐久性 (Phase 4 着手後の bot.py / voice/ 同居 / dashboard 干渉 / Tailscale remote/ 拡張に向けた前提崩れ)
- **devil's advocate** (必須、落とし穴 C): 採用すべきでない罠リスト / 採用前に検証すべき項目を堂々巡りの構造的原因まで遡って攻撃的に反証
- **ux**: 運用ユーザーから見た破綻ポイント (体験の連続性 / 確認ラリーが再発しないか / Phase 3-2 voice の朝自動発火 punt が日常運用とどう紐づくか)

teammate モード: in-process (Linux Mint、`workspace/CLAUDE.md` 既定)。lead は plan mode + 計画承認必須で teammate を spawn (実装に勝手に踏み込まない)。

### 4. 議論軸 (lead から teammate に渡す)

複数視点で **長期見での破綻ポイント** を点検。具体的な議論軸:

1. **`design.md` v0.2.3 (Phase 2.5)**: 健全性 2 週間観察初期データを根拠に「§0 堂々巡り原因 7 点を構造的に解消した」が崩れていないか。特に E (Max プランクォータ可視性) は CreditBudgetGuard 即時前倒し後の実観測で十分か。§3.1 ClaudeOptions の未使用 7 フィールド (B4-1 で観察項目化) の判定材料が初期 1 週間で出揃ったか
2. **`voice-design.md` v2.0.2 (Phase 3-2)**: case B 採用 (朝自動発火 punt + bot 駆動先行) の長期耐久性。Phase 4 trigger 数値化 (週 5 回 × 2 週間 + voice_ledger.jsonl) が現実的か / 素声運用 2 ヶ月上限が守れる運用設計か / bot/ 側 voice_command.py 着手 (2026-06 上旬目処) が健全性 2 週間観察完了直後で順序原則 (devil T-D-1(d)) を破らないか
3. **`PROJECT.md`**: Phase 4 着手条件 #2「直近 2 週間」観察カウントの起点 (2026-05-19) が「観察前/期間中の実装過程で発覚した残置 issue は実害なし」の繰り返し運用と整合しているか (5/9 / 5/14 / 5/18 / 5/20 と 4 回目の追記)。`remote/` 新規追加 (Tailscale PWA、PROJECT.md L33-34) と既存 Phase 構成の整合
4. **対症療法 2 周目候補 3 件** (本日軸 4 で検出、bot/docs/STATUS.md 2026-05-20 entry): `_STDERR_PATTERNS` / `CLAUDE_TIMEOUT` / `vault-sync-from-transcript.sh` rc!=0 後処理。長期見でどれが先に「2 周目」に達するリスクが高いか、teammate 視点で警戒順序を付ける

### 5. 出力形式

- **修正必須** (運用流出リスクあり): 該当 § + 根拠 → 別 commit で反映 (1 commit / 1 軸、本日と同方針)
- **軽微提案** (将来の手戻り防止): 採否は lead が判断 (本日 軸 2-4 と同方針、user 確認 or lead 任せ)
- **構造的指摘** (堂々巡りの原因や落とし穴 A〜F に該当する設計判断ミス): plan ファイル + 該当 STATUS.md / design.md / PROJECT.md に「設計判断履歴」section として書き残す (落とし穴 F、plan ファイルは team cleanup で消えるため必ず lead 成果物に転記)
- **観察項目追加** (健全性 2 週間観察の追加 KPI): 該当 STATUS.md「Phase 2.5 健全性 2 週間観察」section に追記

### 6. team cleanup (議論完了後、必須)

lead 成果物に転記 完了 → 各 teammate に shutdown_request 送付 → approve 確認 → `TeamDelete`。teammate 残置のまま新 team は作成不可 (`workspace/CLAUDE.md` Agent Teams 運用方針)。

### 7. 健全性履歴への追記

PROJECT.md 健全性チェック履歴 2026-05-20 entry の「軸 5 設計 doc 耐久性 (agent team): [本セッション内で実施または別日 punt、結果は別途追記]」を、実施日 (例: 2026-05-26) の結果に書き換え。落とし穴 D「approve 前の最終整合チェック」を lead が単独責任で実施。

## 不採用にした選択肢 (本セッションで判断、別セッションで覆さないこと)

- (a) フル agent team で 2026-05-20 中に実施 — 深夜 + context 余裕 中で重い、本セッションでは punt
- (b) code-reviewer subagent 1 つで軽量版 — agent team の代替としては薄い (architect / devil / ux の 3 視点議論にならない)

別セッションでも (b) は **採用しない**。フル agent team でやる前提。

## 起動前チェック (lead 単独責任、落とし穴 D)

1. agent team 起動コマンド前に `.claude/settings.json` の permission pre-approval が反映済か確認 (上記 §2)
2. team config に devil's advocate が含まれているか確認 (落とし穴 C、外したら議論精度が落ちる)
3. plan ファイル (`~/.claude/plans/<name>.md`) と最終成果物 (`design.md` / `voice-design.md` / `PROJECT.md`) の役割分離を意識 (落とし穴 F)
4. 健全性 2 週間観察データが薄い段階 (5/19〜5/25) なら起動を見送り、5/26 以降に再判断 (推奨タイミング §「起動タイミング」)
