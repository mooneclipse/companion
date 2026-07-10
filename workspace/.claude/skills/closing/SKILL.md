---
name: closing
description: セッションを閉じる前の後始末を定型チェックリストで実行する。「セッションを閉じる」「クローズするから処理お願い」「後始末お願い」と言われたら発動。台帳 (STATUS.md) 更新 → commit → チケット確認 → memory 更新要否の明示判断 → 最終報告まで。処理対象がなければ「なし」と報告して終わる。
---

# closing — セッションクローズの後始末

セッション終了時の定型後始末。目的は「更新漏れ・commit 漏れ・memory 更新の場当たり判断をなくす」こと。過去実績 (2026-06-15〜07-08 の 11 回) で毎回共通だったコアと、回によって漏れていた条件ステップをチェックリスト化した。

処理は済んでいることも多い (タスク完了時に Task Workflow で反映済みのケース)。その場合は各ステップを「確認して該当なし」で通過し、**何もないなら何もしない** と報告して終わる。クローズのために新しい作業を発明しない。

## チェックリスト (順に実行)

### 1. 対象 repo の棚卸し

このセッションで触った repo をすべて挙げ、それぞれ `git status --short` で未コミット差分を確認する。workspace 自体 (台帳・memory 以外に .claude/ 配下を触った場合) も対象に含める。

### 2. 台帳 (docs/STATUS.md) の反映

各サブプロジェクトの `docs/STATUS.md` に、このセッションの結果を反映する:

- 完了タスクを Done へ (実機確認の結果・ユーザーの受け入れ発言もここで反映)
- In progress で持ち越すものは、次セッションが読んで分かる状態か確認
- 「最終更新」日付の更新
- フェーズ・構成レベルの変化があれば `PROJECT.md` も更新

台帳が存在しないサブプロジェクトで反映すべき実体があるなら、この時点で `docs/STATUS.md` を新設する (photos の前例)。

### 3. commit

差分を論理単位で commit する。メッセージは各 repo の既存 log に揃える (台帳のみなら `docs:` プレフィックスが実績)。粒度・レビュー要否は `workspace/CLAUDE.md` の Task Workflow に従う — クローズ処理で発生する差分は通常ドキュメントのみなので code-reviewer は不要。**コード差分が未コミットで残っていた場合はレビューを飛ばして commit しない** (Task Workflow どおり code-reviewer を通す)。

### 4. チケット (共用 TODO) の確認

`python3 ~/companion/remote/server/tickets.py` で:

- このセッションで消化したチケットがあれば `done N` (クローズ前に `show N` で実物確認)
- 積み残し・次にやるべき作業が生まれていれば `add --by ai` で起票 (次セッションへの申し送りはチケットに残す。台帳の In progress と二重になるなら台帳優先)

該当がなければ何もしない。

### 5. memory 更新の要否を明示判断

「更新するかどうか」を毎回 **明示的に** 判断し、結果を最終報告に 1 行残す (過去実績で最も揺れていたステップ。暗黙スキップにしない):

- このセッションで得た恒久的な教訓・訂正 (プロジェクト現況の変化、ユーザーからの働き方フィードバック、ハマった罠) があれば該当 memory ファイルを更新 or 新設 + `MEMORY.md` 索引更新
- 既存 memory と食い違う事実が判明していたら該当ファイルを訂正
- 何もなければ「memory 更新なし」と報告 (それで正しい回の方が多い)

repo の git 履歴・STATUS.md から再現できる事実は memory に書かない (システムプロンプトの memory 規約どおり)。

### 6. push 判定

`workspace/CLAUDE.md` Task Workflow ステップ 5 に従う:

- **(C) ローカル git のみ**: commit で完結。push 行も出さない
- **(B) GitHub remote 付き**: claude は push を実行せず `cd <repo> && git push origin <branch>` を 1 行表示するのみ

(B)/(C) の判別は `git remote -v` で毎回確定する (空 = (C))。repo の列挙は `~/companion/CLAUDE.md` git 運用方針が正で、本スキルには複製しない。**claude 自身が push を打たない** (auto mode classifier が push を構造的に block するため、試みること自体が無駄ターン — Task Workflow ステップ 5)。

### 7. 最終報告

以下を列挙してセッションを締める:

- 更新したファイルと commit (repo ごとに hash + 1 行メッセージ)
- チケット操作 (done / 起票 / なし)
- memory 更新 (した内容 / 「なし」)
- (B) repo で push が要る場合はそのコマンド行
- 全 repo clean を確認した旨

## 関連ドキュメント

- `~/companion/workspace/CLAUDE.md` — Task Workflow (レビュー・commit・push の正はこちら)
- `~/companion/workspace/PROJECT.md` — 「続きお願い」の運用 / 1 セッション 1 タスク
- `~/companion/CLAUDE.md` — git 運用方針 (3 階層 / 破壊的操作 deny / Co-Authored-By なし)
