# CLAUDE.md (workspace, 手元 claude code 固有)

このファイルは手元 claude code (Linux Mint 機の端末から起動する claude CLI、CWD = `~/companion/workspace/`) の auto-discovery で読まれる。**手元セッション固有** の制約のみを書く。応答言語 / vault 書き込み境界 / OWNER 認可 / git 運用方針 / 設計判断・対症療法の上限 など共通項は上位 `~/companion/CLAUDE.md` を参照。

Telegram 経由セッション (bot 経由、CWD = `~/companion/bot-workspace/`) は `~/companion/bot-workspace/CLAUDE.md` 側のルールで動く。本ファイルは bot 経路の制約には関与しない。

## Repository State

このリポジトリにはコードはなく、設計台帳（`PROJECT.md` / `redesign/` / `review-*/`）と claude 設定（`.claude/settings.json`、skills: `orc` / `newgame`、agents: code-reviewer / implementer / game-designer / game-critic / playtester）を置いている。ビルド・lint・テストコマンド、アーキテクチャに関する記述は、コードが追加され次第このファイルに追記すること。

## Project Roadmap

`PROJECT.md` がこのワークスペース全体の地図（Phase 1〜4 の構成、各フェーズの台帳パス、「続きお願い」運用ルール）。新しいタスクに着手する前に必ず一読する。フェーズの現在地・着手時のディレクトリ作成手順・1 セッション 1 タスクのリズムはここに記載。

## Workspace 直下の git 方針

workspace 直下は **(C) ローカル git のみ（remote なし、rollback 専用）** で管理する。当初は「git 化しない」方針だったが、想定していた `workspace/<project-name>/` 配下のサブプロジェクトは実際には `~/companion/` 直下に兄弟配置され、`workspace/` には複数セッション/agent team で大幅改稿される設計台帳（`PROJECT.md` / `redesign/` / `review-*/`）しか残らなかった。他プロジェクトの履歴が混ざる懸念がなくなり、rollback の価値が大きいためローカル git を導入した。**GitHub remote は意図的に付けない**（マシン外バックアップ不要、上げ忘れではない）。git 化 3 階層の詳細は `~/companion/CLAUDE.md` git 運用方針 / `PROJECT.md`「git 化の 3 階層」、破壊的 git 操作の deny / commit ルール / Co-Authored-By trailer の扱い等も上位 `~/companion/CLAUDE.md` を参照。

新しいコードやツールを導入する際は、その時点で:
- 主要なコマンド（実行・テスト・lint・ビルド）
- ディレクトリ構成と責務分担
- 複数ファイルにまたがる設計上の前提

を本ファイルに追記する。

## Security Settings

`.claude/settings.json` に拒否・確認・許可ルールを定義済み:
- **deny**: `rm -rf` 系、認証情報の読み取り（`~/.ssh/**` / `~/.aws/**` / `.env` 等）、`curl | sh` 系、`git push --force*` / `reset --hard` / `rebase -i` などの破壊的 git 操作
- **ask**: `git push:*`、`npm publish:*`、`rm -rf:*` — ユーザー側で 1 回承認が要る
- **allow**: 通常の `git add` / `commit` / `status` / `diff` / `log` / `show` / `branch` / `restore --staged` / `remote` / `config` / `fetch` / `init` — 確認なしで実行可

追加の許可・拒否が必要になった場合は `settings.json` を直接編集する。

## Task Workflow

新しいタスクを進めるときの定型リズム（自動的にこの流れで動く）:

1. **着手** — 該当サブプロジェクトの `docs/STATUS.md` の TODO / In progress を確認、対象を In progress へ
2. **実装** — 必要な編集・テスト
3. **レビュー** — `code-reviewer` subagent を呼び差分を点検（`.claude/agents/code-reviewer.md`）。修正必須が出れば反映 → 再レビュー
4. **コミット** — 適切な粒度（1 論理単位 = 1 commit）で `git add` → `git commit`。`permissions.allow` で確認なく通る
5. **プッシュ** — `git push`。`permissions.ask` なのでユーザー側で 1 回承認が必要（誤りの最終ゲート、完全自動化はしない）
6. **STATUS.md / PROJECT.md 更新** — Done エントリ追加、最終更新日時更新

### コミット粒度の指針

- 1 commit = 1 論理単位（機能追加 / バグ修正 / リファクタ / ドキュメント更新は別コミット）
- 関連するファイル群は同じ commit にまとめる（実装 + そのテスト等）
- 無関係な変更を 1 commit に混ぜない
- レビューと commit の間で過度に細切れにしない（一塊のタスクは 1 コミットでよい）

### 自動化の境界

- 完全自動 push はしない。Anthropic 公式も推奨していない（意図しない操作リスク）
- レビューを飛ばしてのコミット禁止。subagent レビューが OK を出してから commit
- ユーザーが「レビューなしでいい」と明示した場合のみ skip 可

## Agent Teams 運用方針

`.claude/settings.json` で agent teams 機能を有効化済み（`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）。公式仕様: <https://code.claude.com/docs/en/agent-teams>

### subagent との使い分け

- **agent teams を選ぶ**: teammate 同士が議論・反証を交わすことが本質的に必要な場面。具体例:
  - `PROJECT.md` の Phase 1〜4 仕様検討・棚卸し（アーキ / UX 運用 / 悪魔の代弁者 等の役割で並走）
  - 既存設計の耐久性レビュー（companion-bot の Phase 2〜4 拡張時の破綻ポイント点検など、アーキ / セキュリティ / 運用視点で互いにツッコミ）
  - 複数の根本原因仮説が並列に立つ incident デバッグ（仮説同士で反証し合うことで anchoring を回避）
  - 新フェーズ着手前の発散探索（UX 体験 / 技術アーキ / コスト & 運用負荷 を並走させて衝突）
- **subagent で済ます**: 並列に報告を集めるだけ・議論不要のとき。既存の `code-reviewer` の延長（軸別レビュー、単発の grep 探索、Explore agent）はこちらで継続。トークン消費が桁で違う

### 通信トポロジー（star / mesh のフェーズ切り替え）

agent teams は「全員が lead 経由で報告する star 型」と「teammate 同士が直接 SendMessage で反証し合う mesh 型」のどちらにもなる。**spawn prompt で mesh を明示しないと自動的に star に潰れる**（2026-05-20 video-design で実測: teammate 同士の直接メッセージ 0、全員 lead 経由）。star に潰れた team はトークンを払ってサブエージェント形の価値しか出さない。

判断基準は「網羅されて戻りの少ない設計が出るか」。star 単独は devil が当事者へ直接ぶつけられず網羅性を取りこぼし、mesh 単独は version すれ違いで戻る（B-2 の voice-design v2.0 事故）。したがって**フェーズで切り替える**:

- **発散・反証ラウンド = mesh**: spawn prompt で「各 teammate は自分の plan を**互いに直接 SendMessage で送り合い**、相手の弱点を名指しで反証してから lead に集約せよ。lead 経由の伝言で済ませない」を明示する。anchoring 回避と設計衝突の早期表面化はここでしか出ない
- **収束・成果物書き起こし = star**: 最終判断・整合確認・`design.md` 等の確定は lead が center of truth として単独責任（共通根本対策のとおり）
- **mesh の発火条件**: B-2 の version 規律（cross-review 着手前に相手の Round N 最新版を読み切る／各 plan に改版履歴 section を付ける）を満たすときのみ mesh を許可。満たせない局面は star に倒す（無秩序 mesh は戻りを増やす）

spawn prompt テンプレ（発散ラウンド用、ロール名は適宜差し替え）:

> 「architect / security / devil / ux を spawn。各自 read-only plan mode で自分の軸の plan を作ったら、**他メンバー全員へ直接 SendMessage で plan を送り、相手の最新版を読み切った上で弱点を名指し反証**せよ。反証往復が一巡してから lead に集約。lead 経由の伝言で cross-review を代替しない。各 plan には Round ごとの改版履歴 section を必ず付ける」

### companion 固有の前提

- 表示モードは in-process。Linux Mint の通常端末で tmux/iTerm2 を常用しないため、`teammateMode` は明示せず公式デフォルトの `auto`（tmux 外なら自動的に in-process）に任せる
- 仕様議論・設計レビュー系で teammate を起こすときは **plan mode + 計画承認必須** で spawn する。lead が plan を承認するまで teammate は read-only に留まる（実装に勝手に踏み込まないため）
- 並行編集の衝突を避けるため、teammate ごとに担当ファイル群を分離するか、書き込み権限は lead に集約する
- 1 ラン終了時は lead に明示的に team の cleanup を指示してから次の team を立ち上げる（teammate 残置のまま新 team は作成不可）

### 運用上の落とし穴と回避策（2026-05-12 仕切り直し議論より）

#### A. teammate 沈黙への対処順序

spawn 後 30 分以上 idle 通知が来ない teammate に対しては、以下の段階で対処する。判断基準を暗黙化しない。

1. SendMessage で状況確認を 1 回送る（「現在の作業状況・詰まりがあれば 1 行で返答」）
2. 応答無ければ shutdown_request を送付（理由を明記、teammate が reject すれば理由が出る）
3. shutdown が approve されたら、必要に応じて別 name で replacement teammate を spawn（公式 Troubleshooting「Teammates stopping on errors」参照）
4. それでも進まなければ lead 暫定埋めへ移行、`workspace/redesign/design.md` 等の最終成果物に「該当 teammate plan 不着、ux 着で revise 候補」と明記して進める

#### B. 重要判断前に inbox + 最新 plan を再読

agent teams の Mailbox は asynchronous 配信。lead が前ターンに送った訂正と、teammate が前ターンに作った報告は **常にすれ違っている可能性がある**。

approve / reject / 致命判断を出す前に必ず:
- その時点での最新 plan ファイル全体を読み直す
- inbox の最新メッセージ（自分発信分も含む）を読み直す
- 自分の判断が「相手の前ターンの状態」に基づいているかチェック

一拍置いてから判断する習慣を持つ。

##### B-2. teammate 同士の cross-review 精度向上（2026-05-19 voice-design v2.0 議論より追加）

B の lead 視点に加えて、teammate 同士の cross-review でも version すれ違いが起きる。「相手の最新版でなく古い版を見て自己整合チェックを報告する」事故を防ぐため、以下を運用に組み込む:

- teammate Round N の cross-review 着手前に「他 teammate の Round N 最新 plan を読み切る」を明文化（cross-review 開始 prompt に明示）
- 各 plan の改版履歴 section を Round 2 / Round 3 ごとに必ず付ける運用。どの Round の version を読んでいるか teammate 側が判定できる材料を残す
- ux 等「自己整合チェック報告」を出す teammate には、比較対象 plan version (Round N) を明示する書式で報告させる
- lead の Round 2 SendMessage で teammate に「相手の latest version を読み直してから cross-review」を明示指示する prompt 設計

経緯: voice-design v2.0 議論 (2026-05-19) で ux Round 2「自己整合チェック報告」が他 teammate の古い Round 1 plan に基づいており、最新版との食い違いを lead が approve 直前まで気付けなかった。devil's advocate が指摘して修正できたが、devil 不在なら plan misdirection に至る経路。落とし穴 D「approve 前の最終整合チェック」を 1 ラウンド前に倒すための補強として B 系列に位置付ける。

#### C. 仕様議論で devil's advocate を必ず起用

設計・仕様議論の team では Architect / Researcher / UX 等に加えて **devil's advocate role を必ず spawn** する。

これは偶発的な「念のため」ではなく、**lead 自身の judgment ミスを反証で訂正してもらう構造的装置**。今回の uuid5 push ミスは devil 反証で訂正できた、devil 不在なら 500k+ tokens の手戻り (TIPs ["plan misdirection costs"](https://getpushtoprod.substack.com/p/30-tips-for-claude-code-agent-teams) と整合) になっていた。

devil の spawn 時 prompt には:
- 既存 STATUS.md / 過去議論を時系列で読み込ませ、堂々巡りの構造的原因を特定させる
- architect / ux の plan が approval request まで進む前に攻撃的に反証させる
- 「採用すべきでない罠リスト」「採用前に検証すべき項目」を plan ファイルに残させる

#### D. approve 前の最終整合チェック

lead は plan_approval_response で approve を返す直前に、**plan ファイル全体を改めて読み直して内部矛盾をチェック**する。

具体的に拾うべき矛盾:
- 撤回したはずの案が別 section に残置（例: §1 で uuid5 撤回確定、§5 で uuid5 言及が残る）
- 決定事項と検証項目の不一致（例: N4 不採用確定、`--help` 確認セクションに「有用候補」と残る）
- 「採用」表記と「不採用」表記の同じものへの併存
- 改版履歴と本文の整合（履歴では撤回、本文では生きている）

今回 v0.2.2 で lead approve 後に devil が整合性破綻 2 件を発見した（approve 前に拾うべきだった）。

#### E. spawn 前の permission pre-approval

teammate spawn 前に「議論中に実機検証が必要そうな Bash コマンド」を予想して `.claude/settings.json` の `permissions.allow` に入れておく。spawn 後に追加しようとすると auto mode classifier に **Self-Modification として拒否される**（permission 拡張は明示的な user authorization が要る）。

設計議論 team なら最低限以下を事前 allow:

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

特に `claude -p` 系は実機検証で使う頻度が高い。

#### F. plan ファイル vs 最終成果物の役割分離

- **plan ファイル** (`~/.claude/plans/<name>.md`): 議論アーカイブ、肥大化を許容（今回 4 万字超）。teammate 間の改版履歴・反証ログ・反映の根拠を時系列で残す
- **最終成果物** (`workspace/redesign/design.md` 等): lead が要約書き起こす確定形ドキュメント。teammate が cleanup で消えた後も Phase 2.5 着手者が読める

team cleanup で plan ファイルは team config と共に削除されるため、**保存したい情報は必ず lead 成果物に転記**する。teammate plan の場所に依存して後続フェーズが情報を引こうとしてはいけない。

#### 共通する根本対策

A〜F に共通するのは「**lead が center of truth として一元管理する**」という構造原則。teammate 同士の asynchronous 議論は richness を生むが、最終判断・整合確認・成果物書き起こしは lead が単独責任で行う。teammate を「議論パートナー」と扱い「判断主体」と扱わない。
