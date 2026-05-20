# companion-bot 再設計 questions (ユーザー判断項目)

**状態**: 全項目回答済 (Phase 2.5 着手可)
**作成日**: 2026-05-12
**回答完了日**: 2026-05-14
**lead**: team-lead@companion-redesign
**根拠 design**: `workspace/redesign/design.md` (v0.2.2 approved)

本文書は **Phase 2.5 着手前にユーザー判断が必要な項目** をまとめたもの。各質問に返信欄を用意したので、判断結果を書き込んでから Phase 2.5 着手を指示してください。

判断項目は大きく分けて 3 群:

- **Group A: 設計仕上げ** (UQ-1〜UQ-4): design.md で「両案併記」のまま残した選択肢、ユーザー判断で確定する
- **Group B: 外部根拠が必要** (UQ-5〜UQ-7): Anthropic 公式確認 or user 環境への直接アクセスが必要
- **Group C: 運用判断** (UQ-8〜UQ-10): UX 細部・team 運用・着手タイミングの判断

---

## Group A: 設計仕上げ

### UQ-1. workspace settings.json から WebSearch/WebFetch を剥がすか

**背景**: 現状 `~/companion/workspace/.claude/settings.json` の `permissions.allow` に `WebSearch` / `WebFetch` が入っている。design.md §2 で `bot-workspace/.claude/settings.json` を新設し WebSearch/WebFetch をそちらに入れる方針が確定したが、**手元 workspace 側からも剥がすかは独立の判断**。

- **案 X: 剥がす**
  - 手元 claude code の settings からは WebSearch/WebFetch を除き、bot-workspace 側 settings のみに残す
  - 手元で Web 調べたいときは `--add-dir` で都度付ける or `settings.local.json` に追加
  - 利点: 権限境界が明確、bot 経路と手元経路で responsibility 分離
  - リスク: 手元での調べ物が即時にできず、毎回オプション付ける運用負荷

- **案 Y: 剥がさない (現状維持)**
  - workspace と bot-workspace の両方で WebSearch/WebFetch を許可
  - bot-workspace は subset を持つだけ
  - 利点: 手元の利便性維持
  - リスク: bot 経路と手元が同じ settings を見る前提に戻りやすく、permission の意味が薄れる (堂々巡り原因 C の再発リスク)

**lead 個人見解**: 案 X 推奨 (権限境界の明確化が C 解消の本質)、ただし手元利便性は user 主観なので独断不可。

**ユーザー回答**:
```
回避策があるならそれに越したことはないので案 X
ただし、案Xで運用して前回のように承認で詰まるようなことがあればまた検討する
```

---

### UQ-2. claude CLI usage 取得機能調査スコープ

**背景**: design.md §4.6 で `/quota` は `--output-format json` の `total_cost_usd` self-counting で実装確定。ただし researcher c で「`claude /usage` 相当 CLI は存在しない」と確認済。**Max プラン 5h cycle 残量 / 週次クォータ残量を CLI 経由で取れるかは現状不明**、将来 CLI 提供される可能性はある。

- **案 P: Phase 2.5 内で取り込む**
  - Phase 2.5 着手後の実弾運用中に Anthropic CLI release notes / docs を継続監視
  - もし `claude /usage` 相当が提供されたら即時 `/quota` に取り込む (実装 1-2 時間程度の追加)

- **案 Q: Phase 3 / 4 へ送る**
  - 当面は `prompt_count` + `total_cost_usd` ledger 集計だけで運用
  - Max クォータ可視化は Phase 3 (能力層) 着手時に再判断
  - Phase 2.5 のスコープを最小に保つ

**lead 個人見解**: 案 Q 推奨 (Phase 2.5 スコープを膨らませない、CLI 提供が来てから判断)、ただし「便利だから入れたい」場合は案 P もアリ。

**ユーザー回答**:
```
案 P
早期に実現可能性を判断し、実現不可と分かった時点でさっさと切る運用とする
(Phase 2.5 着手後にリリースノート監視を継続、CLI 機能未提供のままなら無理に粘らず Phase 3 送り)
```

---

### UQ-3. Phase 2.5「土管の耐久化」新設 vs Phase 1 内吸収

**背景**: PROJECT.md のロードマップに本設計をどう載せるかの判断。

- **案 R: Phase 2.5 新設 (lead 個人推し)**
  - PROJECT.md に Phase 2.5 を追加し、design.md の実施物をぶら下げる
  - Phase 1 Done 履歴と再設計を時系列で読み分けられる、運用ログとして健全
  - Phase 番号が増える分、ロードマップ全体の見通しが少し細かくなる

- **案 S: Phase 1 内吸収**
  - 既存 Phase 1 セクションに「再設計差分」サブ節を追加し、Done 履歴と並走させる
  - Phase 数を増やさない、ロードマップが簡潔
  - Phase 1 セクションが Done + 再設計で長くなる

**lead 個人見解**: 案 R 推奨 (時系列の読み分けが将来の健全性チェックに効く)、ただし PROJECT.md 全体の段組ポリシーは user の好み次第。

**ユーザー回答**:
```
案 R
Phase 2.5 を新フェーズとして PROJECT.md に追加する
(Phase 1 Done と再設計を時系列で読み分けたい)
```

---

### UQ-4. セッション境界 UX 詳細 (4 サブ質問)

**背景**: design.md §6.2 は lead 暫定で「明示 `/reset` + 48h auto-fork + Discord 通知」を採った。**ux teammate 不在のため lead 暫定**で、ux 着で revise 候補。各サブ質問にユーザーが判断を入れれば暫定が確定する。

#### UQ-4.1 自動 fork の閾値 (SESSION_AUTO_FORK_HOURS)

- 案 a: 24h (1 日 1 セッション、忘れた頃のラリー継続を避ける)
- 案 b: **48h (lead 暫定)** (週末挟みで 2 日空きを許容)
- 案 c: 72h (週末を完全に挟む)
- 案 d: 0 (自動切替無効、明示 `/reset` のみ)

**ユーザー回答**:
```
案 d
自動切替は無効、明示的な /reset でのみセッション切り替え
(claude code でも意識的に /clear をかけている運用と整合する)
```

#### UQ-4.2 自動 fork 時の通知

- 案 e: Discord 通知 (lead 暫定) — 「前回 X 時間前のセッションを継続せず新規セッションで開始しました」
- 案 f: 沈黙 (bot.log にのみ記録)
- 案 g: そもそも自動 fork しない (UQ-4.1 で案 d 選択時)

**ユーザー回答**:
```
案 g
UQ-4.1 で案 d (自動 fork 無効) を選択したため、本項目は自動的に g 確定
(自動 fork が発生しないので通知設計自体が不要)
```

#### UQ-4.3 話題切替自動検出

- 案 h: 不採用 (lead 暫定) — 過剰検出リスク高、誤発火で UX 悪化
- 案 i: Phase 2.5 で実装 (簡易検出: 前回 prompt との semantic distance 等)
- 案 j: Phase 3 以降で再判断

**ユーザー回答**:
```
案 h
話題切替の自動検出は不採用
(UQ-4.1 で自動切替を無効にした方針と整合、切り替えはユーザーの /reset に委ねる)
```

#### UQ-4.4 最小コマンド体系 (`/reset` `/quota` `/status`) で十分か

- 案 k: 十分 (lead 暫定、3 個以内に絞る方針)
- 案 l: 不足、追加コマンド希望 (具体的に列挙)

**ユーザー回答**:
```
案 k
最小 3 コマンド (/reset /quota /status) で開始
(不足が見えたら Phase 3 以降で追加判断)
```

---

## Group B: 外部根拠が必要

### UQ-5. Anthropic 公式の Max プラン rate limit 確認

**背景**: design.md §4.2 で `BOT_RATE_LIMIT_PER_HOUR=20` を暫定値として設定したが、Jarvis 報告値 (1 日 150 / 5h 900) は **macOS 実測 + Jarvis 自己宣言値 (researcher 出所確認済、Anthropic 公式根拠なし)**。Anthropic 公式の Max プラン rate limit と bot 経由の自動化使用が ToS で許可されているかは **lead からは確認手段なし**。

**ユーザーへのお願い**:
- Anthropic ヘルプ ([support.claude.com](https://support.claude.com)) / Max プラン terms を直接確認
- Max プラン 5h cycle の具体的なリクエスト上限 / 週次クォータの公式値 (もしあれば)
- bot 経由の自動化使用 (Discord bot として常駐 + ユーザーの Discord 発話を起点に `claude -p` を実行) が ToS で許諾範囲内か
- 結果を本欄に記入してもらえれば、design.md §4.2 に「Anthropic 公式: ...」として根拠を追加します

**ユーザー回答**:
```
2026-06-15 から開始される新クレジット制 (Max プラン $100/月) に合わせる方針で確定。

【公式根拠】
- Anthropic ヘルプ「Claude プランで Claude Agent SDK を使用する」
  https://support.claude.com/ja/articles/15036540-claude-プランで-claude-agent-sdk-を使用する
- 開始日: 2026-06-15 (Pro / Max / Team / Enterprise 適用)
- 対象に「Claude Code の `claude -p` コマンド (非対話モード)」「Agent SDK 経由で
  サブスクリプション認証するサードパーティアプリ」が明記
  → companion-bot (Discord 起点で claude -p を実行) は ToS 許諾範囲内
- クレジットはユーザー単位、月次更新、繰り越し不可
- クレジット超過時は追加使用量 (従量) へ移行

【$100 の体感試算 (2026-05-14 時点の公式 API 価格ベース)】
現行 API 価格 (1M tokens あたり):
| モデル        | input | output |
|---------------|-------|--------|
| Opus 4.7      | $5    | $25    |
| Sonnet 4.6    | $3    | $15    |
| Haiku 4.5     | $1    | $5     |

1 リクエスト = input 5K + output 2K と仮定:
| モデル        | 単価     | 月 $100 で可能な回数 |
|---------------|----------|----------------------|
| Opus 4.7      | $0.075   | 約 1,300 回           |
| Sonnet 4.6    | $0.045   | 約 2,200 回           |
| Haiku 4.5     | $0.015   | 約 6,600 回           |

履歴累積で input 20K tokens に膨らんだ場合:
| モデル        | 単価     | 月 $100 で可能な回数 |
|---------------|----------|----------------------|
| Opus 4.7      | $0.150   | 約 660 回             |
| Sonnet 4.6    | $0.090   | 約 1,100 回           |
| Haiku 4.5     | $0.030   | 約 3,300 回           |

bot の現実的ペース (1 日 10〜30 往復 × 30 日 = 月 300〜900 回) では:
- Opus 4.7 メイン: $100 ギリギリ〜やや余裕 (履歴量に比例)
- Sonnet 4.6 メイン: 十分余裕
- Haiku 4.5 メイン: 持て余す
- prompt キャッシュ活用で実消費はさらに減る (cache 読み込みは input 単価の 1/10 程度)

【design.md 反映】
- §4.2 の rate limit ベース設計 (1h 20 リクエスト) は 6/15 以降は無効。
  Phase 2.5 の最初のサブタスクでクレジット消費トラッキング設計に組み替える。
- /quota の self-counting は total_cost_usd ベースで継続、$100 月次予算と
  比較して残量を Discord で表示できるようにする。
```

---

### UQ-6. `~/companion/bot/.env` の ANTHROPIC_API_KEY 行確認

**背景**: design.md §1.6 で `env.pop('ANTHROPIC_API_KEY', None)` を bot subprocess で強制する設計に倒したため、**`.env` の内容に依存せず動作可能**。ただし `.env` に `ANTHROPIC_API_KEY` 行が残っているかは設計とは独立の運用衛生面の話。

**lead からの確認は不可** (`Read(.env)` は workspace settings で deny):
```
[ ユーザー側で確認してください ]
$ grep -i 'ANTHROPIC_API_KEY' ~/companion/bot/.env
```

**ユーザー回答**:
- 行があり、削除する → 削除実行後この欄に「削除済」と記入
- 行があり、残す → 設計上は問題なし (env.pop で除外される)、ただし衛生上削除推奨
- 行が無い → 「行なし」と記入

```
行なし
2026-05-14 ユーザー側で `grep -i 'ANTHROPIC_API_KEY' ~/companion/bot/.env` を
実行したが何も出力されなかった。
→ .env に該当行は存在せず、env.pop も含めて二重に安全。
```

---

### UQ-7. ux teammate 再 spawn 判断

**背景**: team companion-redesign の ux teammate は spawn から長時間 idle 通知すら届かない異常状態が継続。lead は §6 を暫定埋めで approve 進めた。

**ユーザーへの質問**:
- (1) このセッションで ux teammate を諦めて team cleanup に進む (Phase 2.5 着手は §6 lead 暫定で開始、必要に応じて Phase 2.5 内で UX 再検討)
- (2) 別セッションで ux teammate を再 spawn してから Phase 2.5 着手
- (3) ux 関連の確定は次回のフィードバックループ (Phase 2.5 実弾運用 1-2 週間後の見直し) で行う、現状の暫定で開始

**lead 個人見解**: 案 (3) 推奨 (実弾運用で見えるものが多い、机上の ux teammate 議論より優先度低)。案 (2) は ux teammate が機能していない (spawn 失敗の可能性) ので、別セッションで仕切り直す価値は限定的。

**ユーザー回答**:
```
案 (3)
現状の暫定 (UQ-4 で確定済) で Phase 2.5 着手し、
1〜2 週間の実弾運用後のフィードバックループで UX を再検討する。
(机上の議論より実運用で見えるものを優先)
```

---

## Group C: 運用判断

### UQ-8. Phase 2.5 着手タイミング

**背景**: design.md / questions.md でユーザー判断が確定したら Phase 2.5 (土管の耐久化) 着手可能。

- 案 (i): 本ユーザー判断完了後、即座に Phase 2.5 着手 (別セッション)
- 案 (ii): 数日寝かせて design.md を再読してから着手 (sleep 効果)
- 案 (iii): Phase 2.5 着手前に design.md / questions.md に対する追加レビュー (code-reviewer subagent 等) を入れる
- 案 (iv) [本判断時に追加]: 即座に着手しつつ、rate-limit 部分は 2026-06-15 の新クレジット制移行を見越して「クレジットベース移行可能」な抽象に最初から倒す

**ユーザー回答**:
```
案 (iv)
本判断完了後、即座に Phase 2.5 着手 (別セッション)。
ただし design.md §4.2 の rate limit 部分は 2026-06-15 の新クレジット制を
見越し、最初からクレジットベース移行可能な抽象で組む。
6/15 までは暫定値で動かし、6/15 以降は閾値だけ差し替える形で二度手間を回避する。
```

---

### UQ-9. Phase 2.5 内のタスク分割粒度

**背景**: Phase 2.5 着手時に、設計を 1 つの大きな PR でやるか、サブタスクに分割するかの判断。

- 案 (j): 1 PR で全部入り (CWD 分離 + sessions JSON + claude_runner + quota + Stop フック + catch-up + CLAUDE.md 3 層)
  - 利点: 部分実装による中途半端な状態を避ける
  - リスク: PR が巨大化、レビュー困難
- 案 (k): サブタスクに分割 (例: T-A 「bot 専用 CWD + sessions JSON」, T-B 「ClaudeRunner 抽象」, T-C 「Stop フック + vault 同期」, T-D 「rate-limit + /quota」, T-E 「catch-up + CLAUDE.md 3 層」)
  - 利点: 1 タスク = 1 commit で見通しが良い
  - リスク: 部分実装中の bot 動作が不安定

**lead 個人見解**: 案 (k) 推奨 (companion CLAUDE.md「1 セッション 1 タスク」運用ルールに整合)、ただしサブタスク間の依存順序は user 判断が要る。

**ユーザー回答**:
```
案 (k)
サブタスクに分割、依存順序は以下の通り:
  T-A: bot 専用 CWD 分離 + sessions JSON
   ↓
  T-B: ClaudeRunner 抽象
   ↓
  T-C: Stop フック + vault 同期
   ↓
  T-D: rate-limit / クレジット消費 + /quota コマンド
       (2026-06-15 新クレジット制移行を見越した抽象 - UQ-8 案 iv と整合)
   ↓
  T-E: catch-up + CLAUDE.md 3 層分割

1 サブタスク = 1 commit、companion CLAUDE.md「1 セッション 1 タスク」運用と整合。
各 commit で動作確認してから次に進む。
```

---

### UQ-10. その他の懸念事項

**背景**: 上記 9 項目以外で気になる点・追加で確認したい点があれば本欄に。lead が design.md / 別途検討して返答します。

**ユーザー回答**:
```
以下 2 点を Phase 2.5 設計に明記して扱うこと。

(1) prompt キャッシュ設計
  - クレジット消費を実質減らす効果が大きい (cache 読み込みは input 単価の約 1/10)。
  - Phase 2.5 内で ClaudeRunner / セッション管理層と合わせて設計する。
  - 6/15 以降の新クレジット制下でも有効に効く前提で組む。

(2) デフォルトモデルを Sonnet に固定
  - /model コマンドは入れない (UQ-4.4 案 k で最小コマンド体系を選択した方針と整合)。
  - 代わりに bot のデフォルトモデルを Claude Sonnet 4.6 (claude-sonnet-4-6) に固定する。
  - 理由: $100/月のクレジットで月 1,000〜2,200 回程度の余裕運用ができる (UQ-5 試算)、
    bot 用途では Opus 4.7 ほどの能力は不要、Haiku 4.5 だと過剰に余る。
  - モデル変更が必要になった時点で改めて /model 導入 or 設定値変更で対応する。
```

---

## 返信ガイド

1. 各 UQ の「ユーザー回答」欄に判断を書き込む (案 X / Y / 自由記述、どれでも可)
2. 判断が即決できない項目は「保留、後日」と書いて構わない (Phase 2.5 着手をその項目だけ送る形でも可)
3. UQ-5 (Anthropic ヘルプ確認) と UQ-6 (`.env` 確認) は user の手作業が要るため後回しでも OK、その他は design.md を読み返して即決可能
4. 全項目埋まったら本ファイルをそのまま lead に渡してください (claude -p で「`questions.md` 埋まったから Phase 2.5 着手」と振れば次フェーズに移行)

---

**最終更新**: 2026-05-14 (全項目回答完了)
**lead**: team-lead@companion-redesign
**次のフェーズ**: Phase 2.5 着手 (別セッション、新 chat / `--continue` どちらでも可、ただし design.md と questions.md を context として読み直すこと)

## 回答サマリ (2026-05-14)

| 項目 | 回答 |
|---|---|
| UQ-1  | 案 X (workspace から WebSearch/WebFetch を剥がす) |
| UQ-2  | 案 P (Phase 2.5 で CLI usage 機能を継続監視、実現不可なら早期に切る) |
| UQ-3  | 案 R (PROJECT.md に Phase 2.5 新設) |
| UQ-4.1 | 案 d (自動 fork 無効、明示 /reset のみ) |
| UQ-4.2 | 案 g (自動 fork 通知不要、UQ-4.1 連動) |
| UQ-4.3 | 案 h (話題切替自動検出 不採用) |
| UQ-4.4 | 案 k (最小 3 コマンド /reset /quota /status) |
| UQ-5  | 2026-06-15 新クレジット制 ($100/月) 移行確定、ToS 明示許諾範囲内 |
| UQ-6  | 行なし (.env に ANTHROPIC_API_KEY 行なし、env.pop と二重に安全) |
| UQ-7  | 案 (3) (ux teammate 再 spawn せず、実弾運用フィードバックで再検討) |
| UQ-8  | 案 (iv) (即着手 + rate-limit はクレジットベース移行可能な抽象で組む) |
| UQ-9  | 案 (k) T-A → T-B → T-C → T-D → T-E のサブタスク分割 |
| UQ-10 | prompt キャッシュ設計を Phase 2.5 で扱う / デフォルトモデルを Sonnet 4.6 固定 |
