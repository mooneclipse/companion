# 軸 5 設計 doc 耐久性レビュー Round 3 lead 集約結果

**実施日**: 2026-05-20
**team**: `companion-durability-0520` (architect / devil / ux + lead = team-lead)
**対象**: design.md v0.2.3 (Phase 2.5) / voice-design.md v2.0.2 (Phase 3-2) / PROJECT.md / 対症療法 2 周目候補 3 件
**経緯**: 2026-05-20 全体レビュー軸 5 を `axis-5-next-session-prompt.md` §起動タイミング推奨 5/26 → 5/20 に lead 単独判断で前倒し起動 (devil D-C 致命級指摘の出発点)

---

## 0. 本 review の構造 (Round 1〜Round 3 + Round 4 二段階方式)

### 0.1 二段階方式採用 (3 teammate 一致確定、devil D-C 致命級指摘の構造的救済)

| 段階 | 時期 | 範囲 | 担当 |
|---|---|---|---|
| 本 review (Round 1〜3) | 2026-05-20 | 静的整合性 + 構造的妥当性 + 観察項目立案 | architect / devil / ux + lead (team companion-durability-0520) |
| Round 4 (後半 session) | 6/2 観察完了後 (or 5/26 以降の早期点検候補あり) | 実観測再点検 | 別 session で再起動 (本書を center of truth として lead が判定) |

### 0.2 二段階方式の発火条件 (Round 4 起動条件)

- (i) 観察期間完了 (2026-06-02)
- (ii) 観察データ初期メトリクス確定 (キャッシュヒット率 7 日移動平均 / vault-sync.log 行数 / NRestarts 累計 / ledger 累計 / claude --version 再検証結果)
- (iii) Round 4 対象 = 観察期間中に発覚した issue + 6/2 完了時点で判定保留だった軸 (本書 §6 で列挙)

### 0.3 user 判断 (b) との両立

user は 5/20 起動時に「(b) 今日完結」を選択。devil D-C 反証 + 二段階方式採用は **「本 5/20 session を terminate せず、後半 session を予約する」運用** で user 判断と両立可能と確定 (architect R2-2.4 / ux R2.1.2)。

---

## 1. 3 teammate 一致確定事項 (lead 裁定不要、Round 3 で confirm)

### 1.1 対症療法 2 周目候補 警戒順序: **C-3 > C-2 > C-1**

| 順位 | 候補 | 統合根拠 |
|---|---|---|
| 1 位 | **C-3** `vault-sync-from-transcript.sh` rc!=0 後処理 | (a) shell 内構造的バリア弱 (devil) + (b) 人手書きデータ混在で致命的データ喪失 (ux) + (c) Phase 4 persona/ 自発 push 段で顕在化最大 (architect) |
| 2 位 | **C-2** `bot.py CLAUDE_TIMEOUT` 既定値 (300s) | (a) 観察期間中の発火確率高 (ux) + (b) 3 段階分割の境界変更 / 4 段階拡張は 2 周目グレーゾーン (devil W-A) + (c) 短文/通常/Web case 分割は「stderr/enum case 増やす」パターンと類似 |
| 3 位 | **C-1** `claude_runner._STDERR_PATTERNS` | CLAUDE.md §10.2 + design.md §1.4 禁止反パターン #2 が構造的バリアとして既に明文化済 |

Round 1 architect 立場 (C-1 > C-3 > C-2) は Round 2 で部分転換 (構造的バリア過小評価を自認)。3 teammate Round 2 全員 C-3 > C-2 > C-1 で確定。

### 1.2 「実害ゼロ常態化」運用境界: **N=5 連続で仕切り直し** (現状 4 回連続)

| 回 | 日付 | 内容 |
|---|---|---|
| 1 | 2026-05-09 | Phase 3-1 ラリー破綻 + WebSearch/WebFetch 権限漏れ「Phase 3 実運用前」扱い |
| 2 | 2026-05-14 | T-D 前半 slash command 発見「実装過程発覚」扱い |
| 3 | 2026-05-18 | V-13 fail + T-1 sprint drift「Phase 3 着手前実装過程」扱い |
| 4 | 2026-05-20 | 軸 2 修正必須 2 件「観察期間中実装過程」扱い |
| **境界** | **5** | **5 回到達時 = 運用ルール仕切り直し** |

devil Round 2 で 5 回 → 4 回 自己訂正 (5/19 = issue 発覚でなく台帳更新、カウント対象外)、3 teammate 4 回連続で確定。

### 1.3 architect M2-3 引数長 multi-tier RTF 超過: **指摘正しい**

voice/docs/STATUS.md 実機計測値 (warm RTF 0.463 秒/字、長文 85 字 39.35 秒) で確認:
- 200 字 = 92.6 秒 (warm 合成)
- + cold start 11-17 秒 = **103-110 秒**
- wait_for(60s) **圧倒的超過**

voice-design.md §1.4 の「warm RTF 0.50 秒/字 + cold 17 秒で wait_for(60s) 内」主張は **数値整合しない**。3 teammate cross-check pass (ux Round 1 §2.5 計算混同を Round 2 で自己訂正、devil R2.7 で実機計測値検証)。

### 1.4 軸 5 5/20 起動 = 落とし穴 D 違反: **二段階方式採用で救済** (§0.1)

devil D-C 致命級指摘: lead 自身が `axis-5-next-session-prompt.md` 5/26 推奨を 5/20 に前倒し = 設計者自身が approve 前の最終整合チェックを破った plan misdirection (voice-design v2.0 議論の uuid5 訂正と同型構造)。

3 teammate Round 2 全員「二段階方式採用」で収束。本 review 本体は terminate せず、後半 session を Round 4 として予約。

### 1.5 claude CLI 2.1.145 無記録バージョン up: **再検証ルール取りこぼし** (新規致命級)

lead 実機検証 #7 で発覚: `claude --version` = 2.1.145、design.md §1.5 は 2.1.138、`~/companion/CLAUDE.md`「claude CLI バージョン up 時の再検証」運用ルール違反 (2.1.140 → 2.1.145 が STATUS.md に無記録で進行)。

修正必須 M-7 (= architect M1-3 = devil D-D の M-7) で本 review 完了後に S1-S5 再検証 + encoded-cwd 規則確認 + `claude -p --help` で `--bare` デフォルト動作変更確認を lead 実施。

---

## 2. 修正必須統合リスト (M-1〜M-14、本 review 確定)

### 2.1 確定 (3 teammate 一致 or lead 単独責任で文面確定可能)

| # | 対象 | 内容 | 由来 |
|---|---|---|---|
| M-1 | PROJECT.md 健全性履歴 5/20 entry | 「実害ゼロ拡張ルール」境界 (適用 3 / 非適用 3 / N=5 / 判定 owner) 追記 | architect M3-1 = devil M-1 = ux UX-S5 |
| M-2 | design.md §0 末尾 | 主張訂正「5/7 完全解消 + 1/7 部分達成 (D 責務分解) + 1/7 グレーゾーン (G timeout 3 段階)」 | devil M-2 + architect S1-1 強化 |
| M-3 | design.md §3 全体 | ディレクトリ図 + §3.4 公開関数シグネチャを Phase 2.5 完了時点の実装 (bot.py inline / claude_runner.py / sessions.py / quota.py + voice 系は voice-design.md 側) に揃える書き換え | architect M1-2 強化 + devil §4.1 D 部分達成評価で追認 |
| M-4 | design.md §4.2 末尾 | 実機 enable 確認手順 1 ブロック追記 ((a) bot/.env grep / (b) /quota 表示 user 確認 / (c) bot/docs/STATUS.md 確定日記録) | architect M1-1 後半 (前半は lead 実機検証 #1 で解消) |
| M-5 | design.md §4.7 末尾 | 「3 段階を 4 段階に拡張する修正は明確に 2 周目、境界変更も同様」明記 | devil M-4 + architect R2-4.2 |
| M-6 | design.md §10.2 末尾 | `_STDERR_PATTERNS` 3 件目追加時の判定基準明記 (sessions JSON state 引きで完結可能か先に問う) | devil M-5 |
| M-7 | bot/docs/STATUS.md + design.md §1.5 + 本 review 完了後実施 | claude CLI 2.1.138 → 2.1.140 → 2.1.145 バージョン up 履歴追記 + S1-S5 再検証 + encoded-cwd 規則確認 + `claude -p --help` で `--bare` デフォルト動作変更確認、再検証 pass 後に design.md §1.5 version pin を 2.1.145 に更新 | architect M1-3 = devil D-D の M-7 |
| M-8 | voice-design.md §1.4 + 末尾 | (i) multi-tier 表の bot.py /say text 上限を **100 字に修正 + cmd_say wait_for を 90s に拡張** (= ux UX-4 案、cold 17 + warm 100×0.463 = 63 秒で 90s 内余裕 27 秒)。(ii) §1.4 末尾に「境界変更時の判定基準: 数値変更のみは 2 周目、テキスト構造見直し / 複数文分割が筋」追記 (devil M-3 統合) | architect M2-3 + ux UX-4 + devil M-3 + devil M-8 統合 |
| M-9 | voice-design.md §1.9 末尾 | 起算日明示「= 完了基準 (ii)(iii) 達成 = bot 経由 /say invoke の実弾運用開始日 (2026-06 中下旬目処)」。CLI 直接 invoke のみで 2 ヶ月過ぎても素声運用上限とみなさない | architect M2-1 + ux UX-S2 統合 |
| M-10 | voice-design.md §1.9 Phase 4 trigger 表 | 4 項目再構成: (i) 集計対象 = bot 駆動 /say invoke のみ (voice_ledger.jsonl)、CLI 直接 invoke は last-result-YYYY-MM-DD 経由で §1.10 縮退判断材料 (ii) 起算日 = bot/ 着手後 + Phase 3-2 完了 (iii) bot/ 完了から 2 週間実測値で「週 N 回 × M 週」の N/M 再キャリブレーション運用ルール (iv) 1 日 invoke 1 回未満 = 縮退判断 or 早期 Phase 4 着手判断ゲート | devil M-10 = architect L2-1 強化 = ux UX-S3 統合 |
| M-11 | voice-design.md §5.3 末尾 | 「maintenance/scripts/notify-system-report.sh 5 行追加は bot/ 側着手 (2026-06 中下旬) と同時 commit で実施、voice/ 側前倒しでは maintenance に触らない」明示 | architect M2-2 |
| M-12 | `~/companion/web/scripts/vault-sync-from-transcript.sh` 冒頭コメント | rc != 0 後処理禁止事項明文化 (リトライ・auto reset・stderr マッチ系の TODO コメントすら残さない、Discord 通知 + 手動介入のみ、CLAUDE.md §10.2 と整合) | devil M-6 |
| M-13 | bot/ Discord 通知チャンネル 1 行投稿 (ドキュメント追記) | 「voice/ 側完了 (5/19)、bot/ 側着手は 6 月上旬目処、それまで `/say` は使えない」を 1 行明示 (user 自己リマインダ) | devil M-9 = ux UX-3 |
| M-14 | PROJECT.md L334 末尾 (将来の保留事項 remote/) | 「remote/ PWA から bot.service / voice/ engine を直接叩く経路は採用しない (Discord 経由 + OWNER_ID 認可で統一)」原則明示 | architect L3-1 (修正必須に格上げ、devil W-E + ux §3.3 と方向一致) |

### 2.2 条件付き / 実機検証待ち

| # | 対象 | 条件 |
|---|---|---|
| (M-8 後半) | voice-design.md §1.4 実機検証 | bot/ 側着手後 (2026-06 中下旬) に M-8 で確定した 100 字 + wait_for 90s が実機で wait_for timeout 1% 未満を保つか cmd_say rc=99 集計で確認、超過時は 80 字 + 120s 案に修正 |
| (M-7 再検証) | S1-S5 再検証 + `--bare` 動作確認 | 本 review 完了後の最優先タスク、lead 実施。pass 後に design.md §1.5 version pin 更新 |

### 2.3 commit 単位

- **commit 1**: M-1 / M-2 / M-3 / M-4 / M-5 / M-6 (design.md 統合修正)
- **commit 2**: M-8 / M-9 / M-10 / M-11 (voice-design.md 統合修正)
- **commit 3**: M-12 (vault-sync.sh 修正、web/scripts/ なら別 repo の web/ commit)
- **commit 4**: M-14 (PROJECT.md 修正)
- **commit 5**: PROJECT.md 健全性履歴 5/20 entry に軸 5 結果追記 (本書 §5)
- **その他**: M-7 (CLI 2.1.145 再検証) は本 review 完了後の別タスク、M-13 (Discord 通知) は bot/ 側 ad-hoc 投稿 (commit 不要)

---

## 3. 構造的指摘の書面化先 (S-1〜S-8)

| # | 内容 | 書面化先 |
|---|---|---|
| S-1 | パターン P1「実害ゼロ宣言の常態化」4 回連続 = 落とし穴 D を lead 自身が体系的に破る経路 | PROJECT.md 健全性履歴 5/20 entry「設計判断履歴」section |
| S-2 | パターン P2「即時前倒し」連鎖累積 = 健全性カウント観察対象が「同時起動の総合観察」になっている | PROJECT.md 健全性履歴 5/20 entry「設計判断履歴」section |
| S-3 | パターン P3「lead 単独責任 vs devil 必須」の同時成立が起動タイミング判断に反映されない | workspace/CLAUDE.md §B-2 (or §G 新規) 補強候補、Round 4 で正式反映判断 |
| S-4 | 軸 5 5/20 起動が lead 自身による落とし穴 D 違反 = 二段階方式採用で構造的救済 | PROJECT.md 健全性履歴 5/20 entry「設計判断履歴」section |
| S-5 | §0 (E Max クォータ可視性) 解消主張の実観測検証は 6/2 + 7/1 待ち (Anthropic Console 累計と ledger 累計の一致性 = devil D-B / K-1) | design.md §0 末尾 + design.md §11.4 |
| S-6 | case A 検証 5 案の Phase 4 復活時優先順序候補 (architect たたき台) を voice-design.md §5.1 末尾に残置、Phase 4 着手判断時に persona/ 担当 + lead が再評価 | voice-design.md §5.1 末尾 |
| S-7 | `/reset` 押し忘れリスク (UQ-4.1 案 d 自動 fork 無効で構造的に開いたまま)、観察期間中の /reset 発動率を観察項目化 | design.md §6.2 補足 + bot/docs/STATUS.md 観察項目 (K-7 統合) |
| S-8 | Phase 4 着手条件 #1 (日常運用に組み込まれている、2 週間以上継続) を満たすのは現状 Phase 3-1 のみ。観察カウント起点を Phase 2.5 完全完了 (2026-05-19) に再設定、5/8-5/17 の 7 件は過去実績として参照 | PROJECT.md L213 補足 |

---

## 4. 観察項目重複統合 (K-1〜K-19、Round 3 集約後の最終 list)

### 4.1 6/2 観察完了時点で集計

| # | 観察項目 | 集計元 | 追加先 |
|---|---|---|---|
| K-1 | bot.service NRestarts (期待 0、現状 5/19 entry 時点 0、5/20 00:57 restart 後継続) | `systemctl --user show companion-bot.service --property=NRestarts` | bot/docs/STATUS.md |
| K-2 | bot.log ERROR/WARN/Traceback 件数 (期待 0) | `journalctl --user -u companion-bot.service --since "2026-05-19" --until "2026-06-02" \| grep -cE "(ERROR\|WARN\|Traceback)"` | bot/docs/STATUS.md |
| K-3 | `/quota` credit_usd 累計 (期待 $1-2) | ledger.jsonl 集計 + `/quota` 表示 | bot/docs/STATUS.md |
| K-4 | `cache_read_input_tokens / total_input_tokens` ヒット率 7 日間移動平均 (初期 1 週間 + 後期 1 週間比較、base line 30% 以上 / 10% 以下で見直し) | ledger.jsonl 集計 | design.md §4.8 方針 4 + bot/docs/STATUS.md (architect O1-2 = ux UX-O5 統合) |
| K-5 | `--output-format json` パース失敗時の `result_text` / `session_id` / `total_cost_usd` = None 件数 | bot.log の「JSON parse failed」相当ログ | bot/docs/STATUS.md (architect O1-3) |
| K-6 | vault-sync.log での「claude 自発 commit/push」vs「Stop フック回収」比率 + rc != 0 件数 + 内訳分類 (push reject / gitleaks / pre-commit hook 別失敗) | vault-sync.log | bot/docs/STATUS.md (ux UX-O3 + devil C-3 先制策 #2 統合) |
| K-7 | `/reset` 発動頻度 (1 日 / 1 週間) + session_id 24h 跨ぎ使用率 | bot.log + bot/sessions/channels/*.json | bot/docs/STATUS.md (ux UX-O1 + UX-O2 + devil K-3 統合) |
| K-8 | `/quota` 叩く頻度 (1 日 / 1 週間) | bot.log DEBUG | bot/docs/STATUS.md (ux UX-O4) |
| K-9 | `_STDERR_PATTERNS` 該当頻度 (NO_PRIOR_SESSION / SESSION_ALREADY_IN_USE 各回数) + ErrorKind.OTHER 分類された raw_stderr 1 件ずつ転記 (3 件目以降が出てたら 2 周目に達した可能性) | bot.log | bot/docs/STATUS.md (devil K-5 + ux UX-O9 統合) |
| K-10 | bot.log の `[claude exited rc=N]` で `terminal_reason=timeout` 件数 (C-2 trigger) | bot.log | bot/docs/STATUS.md (ux UX-O9 + 拡張) |
| K-11 | §6.7 KPI 閾値 (失敗 UX 文面反応件数 / シナリオ非該当件数 / 等) | bot.log + Discord 観察 | design.md §6.7 補足 + bot/docs/STATUS.md (ux UX-O6) |
| K-12 | 観察期間中に得た新規メトリクス値の全列挙 (運用ルール化、6/2 完了 entry での集計手順明文化) | 上記 K-1〜K-11 統合 | PROJECT.md 健全性履歴 6/2 完了 entry の運用ルール (architect O3-1 + ux UX-O10 + devil K-7 統合) |

### 4.2 月跨ぎ JST 0:00 境界 + 月末締め

| # | 観察項目 | 集計タイミング | 追加先 |
|---|---|---|---|
| K-13 | CreditBudgetGuard 月跨ぎ JST 0:00 境界の手動シミュレーション (5/31 23:59 JST と 6/1 00:01 JST で /quota 実行、cost_month リセット確認) | 2026-06-01 | bot/docs/STATUS.md (architect O1-1 + devil O-D 統合) |
| K-14 | Anthropic Console 累計使用量 vs ledger.jsonl 累計の差分点検 | 7/1 前後 (6/15 新クレジット制初月の月末締め後) | bot/docs/STATUS.md (devil K-1 + V-1) |

### 4.3 bot/ 側着手後 (2026-06 中下旬目処)

| # | 観察項目 | 集計タイミング | 追加先 |
|---|---|---|---|
| K-15 | voice_ledger.jsonl の append-only race condition 実測 (2 channel 同時 /say invoke を 1 回手動シミュレーション、各行 JSON parse 可能か) | bot/ 側着手後 1 回 | voice/docs/STATUS.md (architect O2-1) |
| K-16 | cmd_say rc=99 (TIMEOUT) 発火率 (M-8 評価データ)、1% 超で M-8 修正 (100 字 → 80 字 or wait_for 90s → 120s) | bot/ 側着手後 + 1 週間 | voice/docs/STATUS.md (architect O2-2 + ux UX-O12 統合) |
| K-17 | bot 駆動 /say invoke 1 週間集計 (Phase 4 trigger 再キャリブレーション材料、M-10 起算日) | bot/ 側着手 + 1 週間 | voice/docs/STATUS.md (ux UX-O7) |
| K-18 | cold start Discord「考え中…」表示秒数の user 体感記録 (30 秒超 5 件で engine 常駐化 Phase 4 trigger 前倒し検討) | V-S1 実弾 + 1 週間 | voice/docs/STATUS.md (ux UX-O8) |

### 4.4 本 review 完了後 (最優先)

| # | 観察項目 | 集計タイミング | 追加先 |
|---|---|---|---|
| K-19 | claude CLI 2.1.140 → 2.1.145 バージョン up の S1-S5 再検証 + encoded-cwd 規則 + `--bare` デフォルト動作変更確認 (M-7 = M-1-3 = devil D-D の M-7) | 本 review 完了直後 | bot/docs/STATUS.md + design.md §1.5 (architect M1-3 = ux UX-O11 = devil M-7 統合) |

### 4.5 観察対象範囲明示 (devil K-7 = ux UX-O10 強化)

健全性 2 週間観察 (5/19〜6/2) の観察対象:
- ✅ Phase 1 (bot.service)
- ✅ Phase 2 (maintenance timers: notify-unattended-upgrades / notify-system-report)
- ✅ Phase 3-1 (vault Web 検索、Stop フック)
- ✅ dashboard (5:30-9:00 timer)
- ⚠ Phase 3-2 voice: voice/ 側 CLI のみ (bot/ 側未着手) → Phase 4 着手条件 #1 カウント外
- ❌ remote/ (フェーズ外、Tailscale PWA、設計議論待ち) → 観察対象外

---

## 5. PROJECT.md 健全性履歴 2026-05-20 entry に追記する文面案

既存 entry (workspace/PROJECT.md L268-281 周辺、5/20 entry「全体コードレビュー (Phase 2.5/3-2 直後 fresh-eye)」) の **軸 5 設計 doc 耐久性 (agent team)** 行を以下に置き換える:

```markdown
- 軸 5 設計 doc 耐久性 (agent team): 2026-05-20 同日に実施完了 (team `companion-durability-0520`、architect / devil / ux + lead)。詳細は `~/companion/workspace/review-2026-05-20/axis-5-result.md`。修正必須 14 件 (M-1〜M-14) + 構造的指摘 8 件 (S-1〜S-8) + 観察項目 19 件 (K-1〜K-19) を集約。3 teammate 一致確定 4 件 = (a) 対症療法 2 周目候補警戒順序 C-3 > C-2 > C-1 / (b) 軸 5 二段階方式採用 (5/20 静的整合性完遂 + Round 4 = 5/26 以降 or 6/2 完了後の実観測再点検を別 session 予約) / (c) 「実害ゼロ常態化」N=5 連続で仕切り直し境界化 (現状 4 回) / (d) architect M2-3 引数長 multi-tier RTF 超過確認 (200 字 = 103-110 秒 で wait_for(60s) 超過、bot.py /say 100 字 + wait_for 90s 修正)。新規発覚: claude CLI 2.1.145 STATUS.md 無記録 up = 再検証ルール取りこぼし (M-7、本 review 完了後最優先 lead 実施)。落とし穴 D「approve 前の最終整合チェック」を lead 自身が破った経路 (軸 5 起動推奨 5/26 → 5/20 前倒し) は二段階方式採用で構造的救済、user 判断 (b) 今日完結と両立。

### 2026-05-20 設計判断履歴 (軸 5 agent team)

- S-1: パターン P1「実害ゼロ宣言の常態化」4 回連続 (5/9 / 5/14 / 5/18 / 5/20)、5 回到達で運用ルール仕切り直し境界化。devil D-A 自己訂正 (Round 1 で 5 回、Round 2 で 4 回に訂正)
- S-2: パターン P2「即時前倒し」連鎖累積 (5/19 マイルストーン集中 + 5/20 軸 5 起動前倒し)、観察対象が「同時起動の総合観察」になっている自認
- S-3: パターン P3「lead 単独責任 vs devil 必須」の起動タイミング判断は devil unspawn のうちは反証経路なし、workspace/CLAUDE.md §B-2 補強候補として Round 4 で正式判断
- S-4: 軸 5 5/20 起動 = lead 自身が axis-5 prompt 5/26 推奨を破った plan misdirection、二段階方式採用 (5/20 = 静的整合性 + 構造的妥当性 / Round 4 = 6/2 完了後 or 5/26 以降の実観測再点検) で構造的救済、user 判断 (b) 今日完結と両立

### 「実害ゼロ拡張ルール」境界 (運用ルール昇格、M-1 反映)

- 適用条件: (i) 観察期間中に発覚した issue が運用流出 (Discord に返答 / vault 書き込み等) 前であること (ii) 修正 commit が観察カウントの起算日リセットを発火させないこと (iii) STATUS.md 健全性履歴に「実装過程発覚」明記
- 非適用条件: bot.service NRestarts > 0、ERROR ログ Discord 流出、user 物理確認で機能不全観測
- 境界数値: 5 回連続到達 = 6 回目で「実装過程発覚扱い」を停止、設計仕切り直しサイン扱いに転換
- 判定 owner: Claude 初判定 → lead 確認 → user 最終裁定 (落とし穴 D「approve 前の最終整合チェック」継承)

### 観察期間定義の精密化 (M-1 の補足)

- 観察カウント起点 = 2026-05-19 維持 (devil 防護柵「健全性カウント開始日 5/19 は覆さない」)
- 但し bot.service ActiveEnter = 2026-05-20 00:57:34 JST (本日 commit `5d64ec2` 後 restart) で T-D 後半反映前/後の区別あり: 5/19 〜 5/20 00:57 = RequestsCountGuard 想定設計の bot、5/20 00:57 〜 6/2 = CreditBudgetGuard 想定設計の bot
- 実質的な CreditBudgetGuard 観察期間 = 5/20 00:57 〜 6/2 = 12 日 23 時間 (2 週間ではない)、6/2 完了 entry で明示

### Round 4 (5/26 以降 or 6/2 完了後) 起動条件

- (i) 観察期間完了 (2026-06-02) または 5/26 以降の早期点検判断
- (ii) 観察データ初期メトリクス確定 (K-1〜K-12 集計)
- (iii) 対象 = 観察期間中に発覚した issue + 6/2 完了時点で判定保留だった軸 (本書 §6)
- 起動手順: `~/companion/workspace/review-2026-05-20/axis-5-result.md` を center of truth として lead 単独で再起動判断、必要なら agent team `companion-durability-0602` 等で再起動
```

---

## 6. Round 4 (5/26 以降 or 6/2 完了後) で実施する項目

### 6.1 観察データ集計 (K-1〜K-12)

§4.1 通り、6/2 観察完了時点で集計。各 STATUS.md「Phase 2.5 健全性 2 週間観察」section に書面化。

### 6.2 月末締め / 月跨ぎ境界実測 (K-13 / K-14)

§4.2 通り、6/1 00:00 JST 跨ぎと 7/1 前後で実施。

### 6.3 bot/ 側着手後の voice 観察 (K-15〜K-18)

§4.3 通り、bot/ 側 voice 実装着手 (2026-06 中下旬目処) + V-S1 実弾後の観察。M-8 (cmd_say wait_for) 実機検証の確定判定もここ。

### 6.4 Round 4 再点検対象

- 5 件の判定保留軸 (devil §0.3 + architect §0 観察データ薄):
  - §0 堂々巡り原因 7 点 (特に E) の実観測解消確認
  - §3.1 ClaudeOptions 未使用 7 フィールドの判定材料 (Phase 3-3 STT 着手前判定に倒す可能性)
  - CreditBudgetGuard の Anthropic Console 表示一致性 (K-14)
  - voice_ledger.jsonl 集計の現実性 (Phase 4 trigger 数値再キャリブレーション、M-10 の N/M 値確定)
  - 素声運用 2 ヶ月上限の使用感判定 (bot/ 側着手後の bot 駆動運用観察ベース)
- M-7 CLI 2.1.145 再検証結果の design.md §1.5 反映
- 観察期間中に発覚した新規 issue (本日時点で予測不能)
- 健全性履歴運用ルール (M-1 反映) の実運用評価

### 6.5 Round 4 起動判断

5/26 以降 / 6/2 完了後どちらでも起動可。trigger:
- 観察期間中に **想定外停止 / ERROR Discord 流出 / user 物理確認機能不全** が 1 件以上発生 → 即時 Round 4 起動
- 上記なしで 6/2 健全性チェック実施時 → 通常 Round 4 として並走

---

## 7. 本 review で扱えなかった範囲 (Round 4 punt)

- M-7 CLI 2.1.145 再検証 (本 review 完了後の最優先タスク、lead 実施)
- M-8 後半 cmd_say wait_for 実機検証 (bot/ 側着手後)
- 観察項目 K-1〜K-18 の実測 (集計タイミング別)
- S-3 workspace/CLAUDE.md §B-2 補強 (Round 4 で正式判断)
- §0 堂々巡り原因 E (Max クォータ可視性) 実観測解消確認

---

## 8. 落とし穴 D「approve 前の最終整合チェック」結果 (lead 単独責任)

本 axis-5-result.md 作成時に lead 単独で内部矛盾チェック実施:

| 確認項目 | 結果 |
|---|---|
| 警戒順序 C-3 > C-2 > C-1 (§1.1) と本書 §2 M-12 (C-3 先制策) の整合 | ✅ 整合 |
| 二段階方式採用 (§0.1) と user 判断 (b) との両立明示 (§0.3) の整合 | ✅ 整合、ux R2.1.2 + architect R2-2.4 の経路を採用 |
| 「実害ゼロ常態化」N=5 (§1.2) と M-1 文面 (§5) の整合 | ✅ 整合、4 回現状 + 5 回境界 + 6 回目仕切り直しで一貫 |
| M-7 (CLI 2.1.145 再検証) と S-1 (P1 5 回連続パターン) の関係 | ✅ 整合、M-7 は別軸 (再検証ルール遵守失敗) と扱い、P1 カウントには含めない (devil D-D + architect R2-5.4 + ux UX-S8 と方向一致) |
| M-3 (§3 全体書き換え) と防護柵「Phase 2.5 T-D 後半 5d64ec2 5/19 確定」の整合 | ✅ 整合、§3 書き換えは「実装と設計の整合性回復」で観察カウント影響なし |
| 観察期間定義精密化 (§5 ActiveEnter ずれ) と起算日 5/19 維持 (devil 防護柵) の整合 | ✅ 整合、起算日変更ではなく区間内の subset 明示 |
| voice-design v2.0 §5.1 case A 検証 5 案 (S-6) を本書で確定するか punt するか | punt: voice-design.md §5.1 末尾に「architect Round 1 たたき台」として残置、Phase 4 着手判断時に persona/ 担当 + lead が再評価 |
| 修正必須 M-1〜M-14 と防護柵 §7 (Round 2 で過去議論確定事項覆さない) の整合 | ✅ 整合、防護柵 7 件すべて維持 (case B 採用 / voice_command.py 分離 / W-silent / CLI 2000 字 / N4 `--bare` 不採用 / uuid5 不採用 / stderr マッチ全面禁止) |
| ux R2.7 「軽微提案 4 件」(UX-1〜4) と本書修正必須 M-13 (UX-3 採用) / 未採用 (UX-1 / UX-2 / UX-4 = M-8 統合) の整合 | ✅ UX-1 / UX-2 は Round 4 で再評価対象として残置 (採否は user 単独判断)、UX-3 は M-13 で採用、UX-4 は M-8 で統合採用 |

矛盾なし、本書を lead 集約結果として確定。

---

## 9. team cleanup 手順 (本書確定後)

落とし穴 F (plan ファイル消失で情報ロスト) 防護のため、本書転記完了を確認してから cleanup:

1. lead が本書 §1〜§8 を確認、矛盾なし
2. user に lead 集約結果報告 + 修正必須反映の承認確認 (本書を見せる)
3. 修正必須 commit 反映 (commit 1〜4 + PROJECT.md 健全性履歴更新 commit 5)
4. M-7 CLI 2.1.145 再検証 (lead 実施、本 review 完了直後)
5. M-13 Discord 通知 (bot/ 側 ad-hoc 投稿、commit 不要)
6. team cleanup:
   - 各 teammate (architect / devil / ux) に shutdown_request 送付
   - approve 受領確認
   - TeamDelete 実行
7. PROJECT.md 健全性履歴 5/20 entry の軸 5 行を §5 文面案に書き換え (commit 5 と同時)

---

## 10. 改版履歴

- **Round 3 lead 集約 (2026-05-20)**: 初版。3 teammate Round 2 plan 全文読み切り + lead 整理 + 落とし穴 D 最終整合チェック実施後の center of truth として転記。teammate plan ファイル (`~/.claude/plans/*-durability-0520-*.md` / system 割当パス) は team cleanup で消失するため、本書が center of truth として残る (落とし穴 F)。
