# 2026-05-20 全体レビュー 質問事項まとめ

明朝 user 判断用。Phase 2.5 完全完了 + Phase 3-2 voice/ 側完了直後の fresh-eye レビュー、進行中。

## 進捗

| 軸 | 内容 | 状態 |
|---|---|---|
| 1 | STATUS.md 群 drift 点検 (Claude 直接) | **未着手** (明朝判断) |
| 2 | T-D 後半 CreditBudgetGuard コードレビュー (code-reviewer subagent) | ✅ 完了 |
| 3 | voice/ 側実装レビュー (code-reviewer subagent) | ✅ 完了 |
| 4 | 既存 bot 実装 simplify 観点レビュー (code-reviewer subagent) | ✅ 完了 |
| 5 | 設計 doc 耐久性レビュー (agent team) | **未着手** (明朝判断) |
| 6 | 修正必須反映 + 健全性履歴追記 | 5 まで完了後 |

---

## A. 修正必須 (軸 2 結果)

軸 3 / 4 は修正必須なし。軸 2 のみ 2 件。

### A-1. `bot/tests/test_quota.py` が repo 不在

- **検出元**: 軸 2 subagent
- **症状**: STATUS.md L77-85 に「9 テスト全 pass」記録、commit `5d64ec2` の diff stat にも含まれない。`git ls-files` / `find` どちらでも見えない
- **影響**: 健全性 2 週間観察期間の起点で回帰検出装置が repo 不在。CreditBudgetGuard の月跨ぎ等エッジケース変更時に break を検出できない
- **追加注文**: 月末 23:59 → 月初 00:00 跨ぎ・タイムゾーン跨ぎ (UTC `now` が来た時の月境界引き) のテストケースが薄いので追加推奨
- **判断ポイント**:
  - (a) 即反映 (test_quota.py add + commit + push) — 観察期間中の commit 1 件追加、bot.service restart 1 回
  - (b) 健全性観察期間中は保留、6/2 以降にまとめて反映 — 期間中に CreditBudgetGuard を触る修正が来たら無防備
- **lead 推奨**: (a) 即反映。理由 = テスト追加のみで bot 本体ロジックゼロ、リスクは追加 commit 1 件 + restart 1 回のみ、健全性履歴 5/9/5/14/5/18 同方針で「観察期間中の test 追加は実装過程扱い」と明記すれば吸収できる

### A-2. `bot/bot.py:101` の logger.warning が credit_usd 経路で意味のない文字列

- **検出元**: 軸 2 subagent
- **症状**: 現状 `"... count_1h=%d/%s cost_month=%.4f/%.2f"` で credit_usd 時は `limit_per_hour=None` → `count_1h=0/None` と出力。健全性観察期間中の log S/N を下げる
- **修正案** (subagent 提示):
  ```python
  if summary.guard_kind == "requests_count":
      logger.warning("budget exceeded channel_id=%s kind=requests_count count_1h=%d/%d", ...)
  else:
      logger.warning("budget exceeded channel_id=%s kind=%s cost_month=%.4f/%.2f", ...)
  ```
- **判断ポイント**:
  - (a) 即反映 — 観察期間中の log 解析が綺麗になる
  - (b) 保留 — 観察期間中に予算超過が起きなければ実害ゼロ (5/14〜5/19 累計 $0.7961 = 月次 $100 の 0.8% なので踏まない見込み)
- **lead 推奨**: (a) 即反映。理由 = A-1 と同 commit に乗せれば追加 restart ゼロ、観察期間中に万一踏んだ時に log 可読性が回帰判定に直接効く

---

## B. 軽微提案 (採否判断、計 15 件)

### B-軸 2 (CreditBudgetGuard) — 5 件

| # | 内容 | トレードオフ |
|---|---|---|
| B2-1 | `quota.py:267` `cost_month < monthly_budget_usd` float 直接比較に 1 行コメント追加 | 採用=境界 1 セント挙動が STATUS.md で明示 / 不採用=現状維持で問題なし |
| B2-2 | `quota.py:107` `_aggregate` 入口で `now = now.astimezone(JST)` 正規化 | bot.py 経由では JST 揃いで実害なし、UTC で渡される将来テスト/手動呼出で境界がずれる予防 |
| B2-3 | `BudgetSummary.last_call_at` が `format_summary()` で未使用 → dead carry | `/status` 側で使う計画があるなら残置、なければ削減 |
| B2-4 | `make_budget_guard()` の env 値バリデーション欠如 (`BOT_MONTHLY_CREDIT_USD=-5` で起動時 ValueError or 全 deny) | 1 ユーザー運用で事故率低、`if budget <= 0: raise ValueError(...)` 1 行で誤設定事故防げる |
| B2-5 | `.env.example` L25 と L31 の重複説明を 1 ヶ所に寄せる | cosmetic、現状読みやすさ優先で残置可 |

### B-軸 3 (voice/) — 5 件

| # | 内容 | トレードオフ |
|---|---|---|
| B3-1 | `say.sh:65` `ts()` を ISO8601 厳密形式 (`+%Y-%m-%dT%H:%M:%S%:z`) に | bot/ 側 `voice_status.py` が `datetime.fromisoformat` で 1 行 parse できる / bot/ 側 regex 吸収するなら現状で OK |
| B3-2 | `say.sh:144,157` curl stderr 切詰めを `LANG=C curl ...` で英語固定化 | reason 文言完全一致集計が可 / 現状 v2.0 §1.4 は exit code 番号分類、reason は人間向け log、現状で OK |
| B3-3 | `say.sh:171` `paplay` を `if ! paplay ...` で if 文化、`ffmpeg` ブロックと統一 | スタイル統一で読みやすさ向上 / 意味変わらず |
| B3-4 | `voice-engine-up.sh:29` `cd "$ENGINE_DIR"` に「手動 invoke 時の保険、systemd 経由では WorkingDirectory= で同一」コメント | 将来読者が二重指定に困惑しない / コメント増 |
| B3-5 | systemd unit に `[Service] TimeoutStopSec=30` 明示 (現 default 90s) | Phase 4 常駐化 trigger 時に stop 中ハング対策 / 現状 punt 妥当 |

### B-軸 4 (既存 bot simplify) — 5 件

| # | 内容 | トレードオフ |
|---|---|---|
| B4-1 | `claude_runner.py:51-62` `ClaudeOptions` の未使用 7 フィールド + `to_sdk_kwargs()` の判定点を STATUS.md「健全性 2 週間観察」項目に追加 | Phase 3 着手時に「なぜ空のまま」が拾える / 残すと dead code として目に入り続ける |
| B4-2 | `design.md:193-201` §3 ディレクトリ図 (`notify_listener.py` / `config.py` 独立) と現実装 (bot.py inline) の乖離 → §3 末尾に 1 行追記 | 将来読者の混乱低減 / 履歴増 |
| B4-3 | `sessions.py:87-94` `reset` 戻り型 `bool` と `design.md:279` 表記 `SessionMeta` の乖離 → design.md 側を `bool` に揃える | 実装の方が単純で正しい (bot.py L141 は bool 評価のみ) |
| B4-4 | `bot.py:269` `_handle_notify` の `reader.read()` 上限なし → `reader.read(1_000_000)` 上限付与 | 自身のバグでの暴走防止 / 将来「長文ニュース要約 push」切捨て可能性 |
| B4-5 | `vault-sync-from-transcript.sh` のログ rotation 不在 → 観察期間中の判定材料として「2 週間観察」項目に `vault-sync.log` 行数/サイズチェックを追記 | 観察期間後の判断材料増 / logrotate を入れると設定箇所増 |

---

## C. 対症療法 2 周目候補 (軸 4、共有のみ・user 認識)

修正対象ではなく「次に同じ場所を 2 度目に触る修正が来たら設計に戻れ」という事前警戒。`~/companion/CLAUDE.md`「設計判断・対症療法の上限」に該当。

| # | 場所 | 警戒条件 |
|---|---|---|
| C-1 | `claude_runner._STDERR_PATTERNS` | 現在 2 件、3 件目を増やす修正が来たら 2 周目。次は「sessions JSON の state を引けば一意に決まらないか」を先に問う |
| C-2 | `bot.py CLAUDE_TIMEOUT` 既定値 (300s) | 1 周目、次に伸ばす修正が来たら設計に戻る。長時間応答は MCP/tool 起動が原因のことが多く、timeout より `permission_mode` / tool allowlist 側で短絡したほうが筋 |
| C-3 | `vault-sync-from-transcript.sh` の rc != 0 後処理 | 観察期間中に gitleaks 検出 / merge conflict / pre-commit hook 別失敗が出たとき、シェル内「stderr マッチでリトライ」「自動 reset」追加は 2 周目 |

---

## D. 残タスクの判断ポイント

### D-1. 軸 1 (STATUS.md drift 点検)

- 5 台帳 (bot/voice/maintenance/web/dashboard) + PROJECT.md の食い違いを Claude 直接で点検
- 軽量 (コード触らず)
- **判断**: 明朝着手で OK か / 不要か

### D-2. 軸 5 (設計 doc 耐久性レビュー、agent team)

- design.md v0.2.3 / voice-design.md v2.0.2 / PROJECT.md を architect / devil's advocate / ux の 3 視点
- `~/companion/CLAUDE.md` 落とし穴 A〜F 遵守、plan mode + permission pre-approval 必須
- **重い** (token / 時間)。今回の subagent 3 軸で既に長めの context を消費
- **判断オプション**:
  - (a) 明朝に軸 5 を実施
  - (b) 軸 5 は別日に切り出し (健全性観察期間中の余裕日に)
  - (c) 軸 5 は省略 (軸 2-4 の coverage で十分とみなす)
- **lead 推奨**: (b) 別日。理由 = 軸 1-4 で実装側の fresh-eye は十分、設計 doc 耐久性は健全性 2 週間観察データ (5/19〜6/2) が一部出揃った時点 (5/26 頃) で走らせると「観察初期データを参照して破綻ポイントを検証」できる

### D-3. 健全性履歴への追記文面 draft

PROJECT.md L289-314「2026-05-19 Phase 2.5 完全完了マイルストーン」エントリの下に追記する案 (案。明朝 user 確認):

```
### 2026-05-20: 全体コードレビュー (Phase 2.5/3-2 直後 fresh-eye)

Phase 2.5 完全完了 + Phase 3-2 voice/ 側完了直後の fresh-eye 点検として、健全性 2 週間観察期間 (2026-05-19〜2026-06-02) の起点で全体レビュー実施。

- 軸 1 STATUS.md drift 点検 (Claude 直接): [結果]
- 軸 2 T-D 後半 CreditBudgetGuard (code-reviewer subagent): 修正必須 2 件 (test_quota.py repo 不在 / bot.py:101 log 表記)
- 軸 3 voice/ 側実装 (code-reviewer subagent): 修正必須 0 件、軽微 5 件 (採否判断後)
- 軸 4 既存 bot simplify (code-reviewer subagent): 修正必須 0 件、軽微 5 件 + 対症療法 2 周目候補 3 件 (事前警戒)
- 軸 5 設計 doc 耐久性 (agent team): [実施/punt]

軸 2 修正必須 2 件は同 commit で反映、観察期間中の commit ノイズは「2026-05-09/5-14/5-18 同方針 = 観察前/期間中の実装過程で発覚した残置 issue は運用流出した誤動作に該当しない」扱いで継続観察。観察期間カウントは 2026-05-19〜06-02 を維持。
```

---

## E. 明朝の進行順序 (案)

user 判断後の流れ案：

1. A-1 / A-2 の判断確定 → 即反映 commit (lead 推奨は両方とも (a) 即反映)
2. 軸 1 STATUS.md drift を Claude が点検 (軽量、修正必須があれば同 commit に乗せる)
3. B 系 15 件の採否を user 1 件ずつ判断 (まとめて or 後日)
4. 軸 5 の punt/実施判断 (lead 推奨は別日 5/26 頃)
5. PROJECT.md 健全性履歴に「2026-05-20 全体レビュー」エントリ追記 (case D-3 文面 draft 反映)
6. bot/voice 各 STATUS.md にも Done エントリ追記

「続きお願い」と言われたら本ファイルを Claude 側で開いて確認するので、user 側は読まなくても済む構成。
