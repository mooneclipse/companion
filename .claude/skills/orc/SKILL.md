---
name: orc
description: 既存コードベースの改修タスクを意図確認 1 回で自走させる。implementer sub-agent に委任し、完了後に code-reviewer で点検する。ダッシュボードや bot の修正・機能追加に使う。
---

# orc — 改修タスクのオーケストレーション

意図が固まった改修タスクを最小確認で自走させるためのスキル。implementer に委任 → code-reviewer で点検 → 完了報告、の 2 層構成。

## 動作フロー

### 1. 意図確認（1 回だけ）

ユーザーから依頼を受けたら、以下の 3 点を 1 回だけ確認する。AskUserQuestion 推奨。

- **何を変えるか**: 機能追加 / 修正 / リファクタ / 削除 のいずれか + 具体内容
- **対象**: リポジトリ / ファイル / システム範囲（"dashboard の起動フロー" など）
- **成功条件**: 動作確認方法（テスト合格 / 起動して画面確認 / コマンド実行で期待出力 等）

確認しないこと: 設計細部、ライブラリ選定、実装方針、命名規則。これらは implementer の独断領域。

### 2. 委任

ユーザーから「OK」「進めて」相当の返答 → `Task` ツールで `subagent_type: implementer` 起動。

`prompt` には意図確認 3 点をそのまま転記する。lead 側からの追加指示や設計細部の予断は書かない。

委任後、ユーザーへの中間報告はしない。implementer が完了を返すまで待つ。

### 3. レビュー（必須）

implementer 完了 → 続けて `Task` ツールで `subagent_type: code-reviewer` を起動する。レビュー観点は `code-reviewer.md` に定義済みなので、orc 側は対象差分の指定だけ渡す。

**レビュー結果による分岐**:

- **OK のみ**: そのまま完了報告へ
- **軽微な提案**: 完了報告に併記し、対応するかをユーザーに 1 行で確認（`feedback_review_minor_proposals.md` と整合）
- **修正必須あり**: implementer に再委任（指摘内容を prompt に転記）。再委任は **1 往復まで**。2 回目の修正必須が出たらユーザーに状況を報告し、判断を仰ぐ

### 4. 完了報告

以下のフォーマットでユーザーに返す。

- **変更ファイル**: リポジトリ相対パスで列挙
- **動作確認**: 実施した確認内容と結果（テスト / 起動 / 目視のいずれか）
- **レビュー**: code-reviewer の結論サマリ（OK / 軽微提案あり / 修正必須あり → 対応済み）
- **commit**: hash と 1 行メッセージ（複数あれば全部）
- **意図との差分**: 委任時の意図と異なる対応があれば明記。なければ「なし」

## 事前にユーザー確認が必須の例外操作

以下を implementer が行う必要が出た場合、orc は委任を一時停止してユーザーに承認を求める。

- `git push` / タグ push / PR 作成
- 本番デプロイコマンド
- 外部 API 課金が発生する操作
- 既存データの削除（DB レコード、ファイル削除、`rm -rf` 系）

これら以外は確認不要。

## agent team との関係

orc 内では agent team は **使わない**。理由:

- 実装タスクは議論より実行が主眼。teammate 同士の反証が本質的に不要
- agent team の真価は発散・反証ラウンド（仕様検討 / 設計レビュー）にあり、用途が違う
- star に潰れたら subagent と同じだが、コストは桁で高い

implementer が「設計判断が複数案あって決められない」と報告してきた場合、orc は再委任せずユーザーに状況を返す。agent team 起動の要否はユーザー判断とする。

## 関連ドキュメント

- `~/companion/workspace/.claude/agents/implementer.md` — 委任先 sub-agent の動作仕様
- `~/companion/workspace/.claude/agents/code-reviewer.md` — レビュアー sub-agent の観点
- `~/companion/workspace/CLAUDE.md` — Task Workflow / コミット粒度の指針
- `~/companion/CLAUDE.md` — 設計判断・対症療法の上限（2 周目ルール）
