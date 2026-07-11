# companion-web 開発台帳（Phase 3-1: Web 検索 → md 蓄積 + Obsidian vault 同期）

最終更新: 2026-07-11 (vault push 自動化 — vault-sync-from-transcript.sh に commit 後 push を追加、チケット #83)

## 設計メモ

- Phase 3-1（PROJECT.md の Phase 3 ロードマップを参照）。**Web 検索 → notes 化 → vault 同期** を Discord 経由で実行できる状態にする
- 軽量タスク。リソース消費はほぼなく、Claude Code が WebSearch ＋ vault 書き込みをワンショットで処理する運用が基本。常駐プロセスや専用スクリプトは現時点では作らない（YAGNI）
- 発火経路: Discord で「○○調べてノートにして」等の自然文 → 既存土管 (`bot/`) 経由で `claude -p` → Claude Code が WebSearch + vault 書き込みフロー実行 → Discord に結果報告
- 書き込み対象は `~/companion/vault/notes/` のみ。手書きエリア（`aidiary/` / `clips/` / `inbox/` / vault ルート）には絶対に触らない
- vault 側規約は `~/companion/vault/CLAUDE.md` と `~/companion/vault/templates/note.md` を**書き込みのたびに参照**して整合させる（タグ・frontmatter・ファイル名）

### ファイル規約（vault 既存規約に従う）

- ファイル名: `notes/<YYYY-MM-DD>_<slug>.md`、slug は英語 kebab-case
- frontmatter:
  - `type: note`
  - `created: YYYY-MM-DD HH:mm`（vault `templates/note.md` に準拠、時刻まで含む）
  - `tags: [...]`
  - `style: reference`（Web 検索ベースのまとまった資料）または `fleeting`（雑記・未整理）。`reference` は Phase 3-1 で機械書き込みノート向けに運用上導入する慣習。vault `CLAUDE.md` 側にも追記して根拠を一本化する（TODO 参照）
- 既存タグ一覧から選ぶ: `tech, ai, creative, life, work, media, philosophy, vrchat, unprocessed, processed, starred`。新規タグは作らない
- Obsidian の `[[wikilink]]` と frontmatter は壊さない

### 書き込みフロー（PROJECT.md と整合）

1. `cd ~/companion/vault && git pull --ff-only origin develop`
2. **重複チェック**: `notes/` をファイル名（同日 slug）と内容（タイトル・キーワード）で grep（手段の詳細は後述「### 重複チェック手段」）
   - 完全一致（同名 .md）: 「上書きする？別名にする？」を Discord で必ず確認
   - 部分類似（タイトル・キーワード重なり）: 「○○ と重複しそう、追記する？新規にする？」を Discord で確認
   - 重複なし: そのまま書き込みへ
3. ノート作成 `notes/<YYYY-MM-DD>_<slug>.md`
4. `git add notes/<file>` + `git commit`（commit は別 repo なので Co-Authored-By trailer なし、commit メッセージのスタイルは vault repo の既存 log に揃える）
5. `git push origin develop`（`.claude/settings.json` の `permissions.ask` で 1 回承認）
6. メイン機側は手動 `git pull` または Obsidian Git plugin で取り込み

### 重複チェック手段（2026-05-17 確定）

**方針**: Claude judge + `grep -ril -i "<英語+日本語キーワードの OR 列挙>" notes/` を継続。スクリプト化は YAGNI で見送り。

**根拠** (Phase 3-1 実弾 3 件の観察):

- 重複見落とし 0 件 / 誤検出 0 件 / 部分類似ヒット 1 件（5/17 日本語 TTS 選択肢 → 5/9 VOICEVOX、Discord ラリーで「新規採用」判断）
- クエリ選定はテーマ + 周辺概念 2〜4 語の OR 形式で 3 件とも妥当（破綻なし）
- `notes/` 現状 26 件で grep の体感負荷ゼロ

**再判定トリガ**（いずれかが満たされたらスクリプト化 / 厳密化を再検討）:

- 重複見落とし（既存ノートと実質的に内容が重なる新規ノートが push 後に発覚）が 2 件以上発生
- `notes/` 件数が 100 件超で grep の体感負荷が出る
- Claude のクエリ選定の質が落ちて Discord ラリー（追記 / 新規 / 別名）が 1 件あたり 3 ラリー超になる

### 発火 UX（2026-05-17 確定）

**方針**: Discord での発火は自然文継続（例:「○○調べてノートにして」「△△について整理して `notes/` に置いて」）。特殊コマンド・タグ引数等の導入は YAGNI で見送り。

**根拠** (Phase 3-1 実弾観察、5/8 着手以降の `notes/` commits 計 7 件):

- うち Discord 経由実弾 2 件（5/14 notion-developer-platform / 5/16 dashboard-character-design、commit message が "bot session auto-sync"）。両件とも自然文発火で完走、タグ指定・スコープ引数なしで 1 ファイル commit に収まった
- 発火 → 着手までのラリー数（ユーザー記憶ベース、`bot.log` は発火文本文を記録しない設計のため自動集計不可）: 5/14 notion = 4 ラリー / 5/16 dashboard = 1 ラリー。現状最大 4
- ユーザー観察: 自然文で問題なし、タグ自動推定（Claude judge）も意図と外れず

**再判定トリガ**（いずれかが満たされたらコマンド化 / 引数化を再検討）:

- タグ自動推定が意図と外れ、メイン機側で frontmatter `tags:` 修正が必要なケースが 2 件以上発生 → `tags` 引数化（例: 自然文 + `#tech #ai` 指定）を検討
- 発火 → 着手までのラリー（ユーザー体感、または bot.log にタスク境界アノテーションを付ける別途仕組みを後付けして数えた数）が 1 件あたり 5 ラリー超になる → スコープ指定コマンド / テンプレ化コマンドを検討
- 同一テーマで複数の発火パターンが混在して UX が一貫しなくなった → コマンド化で正規入口を一本化検討

**注記**: 確定時点の Discord 経由実弾は N=2 で薄い。Phase 3-2 (TTS) 着手後に Discord 経由実弾が N=5 以上に増えた段階で、上記トリガの妥当性 (特に「タグ修正 2 件以上」の閾値) を見直す。

### 主要パス

- `~/companion/web/docs/STATUS.md` … 本台帳
- `~/companion/vault/` … 書き込み先 repo（`mooneclipse/obsidian-vault`、`develop` ブランチ）
- `~/companion/vault/notes/` … 機械書き込み許可エリア
- `~/companion/vault/CLAUDE.md` / `templates/note.md` … 書き込み規約の正
- `~/companion/web/scripts/` … スクリプト配置先（bot Phase 2.5 T-C で切り出し、未 git 化）
  - `vault-sync-from-transcript.sh` … Discord bot 経由 claude セッション (bot-workspace CWD) の Stop フックから呼ばれ、claude が `~/companion/vault/notes/` に書いた未 commit 変更を `git add -- notes/` + `git commit` で回収する最終同期処理。commit 成功後は `git push origin develop` まで自動実行 (2026-07-11 チケット #83、BatchMode=yes + timeout 60s、失敗時はログのみで自動回復なし → 回復は `/vault_push`)。詳細は `bot/docs/STATUS.md` の T-C エントリ + 本台帳 2026-07-11 エントリ
  - web/ 配下の git 化は次にスクリプトを 1 本以上追加するタイミングで判断（vault-sync 単体では web/ 内に履歴を持つメリットが薄い、bot 側 STATUS.md と vault 側 commit 履歴で追跡可能）

### 失敗リカバリ手順

書き込みフロー上で発生しうるエラーの対処指針。**いずれの場合も `git push --force*` / `git reset --hard` 系は使わない**（`.claude/settings.json` で deny 済み、履歴改変は vault の同期相手が壊れる）。判断に迷う段は独断で resolve せず Discord で 1 行確認。

#### 1. `git push origin develop` が non-fast-forward で reject

メイン機側で先に commit / push が走ったケース。

1. `git fetch origin develop`
2. `git log --oneline HEAD..origin/develop` で相手側の差分内容を確認
3. **rebase の安全条件**: ローカル側の commit が `notes/<新規ファイル>` の追加 1 件のみで、`origin/develop` の差分が `notes/` 以外（`aidiary/`, `clips/`, vault ルート等）なら conflict 不発の見込みが立つ。同一 `notes/<同名ファイル>` を双方が触っている場合は conflict 確実なので即停止 → Discord 報告
4. `git pull --rebase origin develop`
5. conflict が発生したら `git rebase --abort` で完全に戻す → Discord で状況報告（独断で resolve しない）
6. rebase 成功 → `git push origin develop`（`permissions.ask` で 1 回承認）

#### 2. 書き込みフロー手順 1 の `git pull --ff-only` が落ちる

通常はローカル側に未 push の commit が残留している場合のみ。

1. `git status` でローカル変更・未 push commit の有無を確認
2. ローカルワーキングツリーがクリーンで未 push commit のみが原因 → 上記 1. と同じ rebase 手順で解消
3. ワーキングツリーに未コミット変更がある → 想定外（書き込みフローは pull の前にローカルを汚さない設計）。状況不明なので即停止 → Discord 報告して指示を仰ぐ

#### 3. frontmatter / タグ規約違反、`[[wikilink]]` 破損のロールバック

事後チェック・code-reviewer・メイン機側 Obsidian で気づくケース。気づいた段階に応じて対処を分ける。

A. **commit 前**（`git add` 済み・未 commit 含む）: ファイルを直接編集 → 必要なら `git add` で上書き

B. **commit 済み・push 前**: ファイル修正 → `git add` → `git commit --amend`（vault の 1 ノート 1 commit を保つ）

C. **push 済み**: 修正 commit を新規に作って push（force push は使わない）
- 軽微な修正（タグ追加・frontmatter 1 フィールド修正等）: `git commit -m "fix: <file> frontmatter ..."` → `git push origin develop`
- ノート全体を撤回する判断: `git rm notes/<file>` → 削除理由を message に書いて新規 commit → push

#### 4. その他の境界違反

- **gitleaks 検出**（Web 検索結果に API キー風文字列が混入）: pre-commit hook で commit 自体が止まるので、ファイルを修正してから再 add。push 後に気づいた場合は private repo でも exposure 想定で扱い、混入元の secret rotation を別途検討
- **書き込み境界違反**（`notes/` 以外を編集してしまった）: commit 前は `git restore <file>`（新規追加してしまった場合は `git restore --staged <file>` → `rm <file>`）、commit 後 push 前は該当ファイルを元の状態に戻して `git add` → `git commit --amend`（B と同じ流儀）、push 後は C と同じく取り消し commit を新規作成

## TODO

（なし）

## In progress

（なし）

## Review pending

（なし）

## Done

- 2026-07-11 vault push 自動化 — `vault-sync-from-transcript.sh` の commit 成功後に push を追加 (チケット #83)
  - **背景**: 2026-07-10 OWNER 合意 (`workspace/redesign/monorepo-migration.md` §11)。従来 push は `/vault_push` (Telegram 人手承認) に委ねていたが、notes/ auto-sync 分は commit 直後の自動 push に切替
  - **実装**: commit 成功後に `git push origin develop` を実行。push 機構は bot.py `cmd_vault_push` の実証済み構成を踏襲 — `GIT_SSH_COMMAND="ssh -o BatchMode=yes"` (keyring ロック時は対話待ちせず即 fail) + `GIT_TERMINAL_PROMPT=0` + `timeout 50`。timeout を 50s にしたのは code-reviewer 指摘の反映 (Stop hook 自体が claude code デフォルト 60s で kill されるため、それより先に自前の error ログパスを通す)。失敗時はログ記録 + exit 1 のみで、リトライ・stderr 分類・自動回復は追加しない (スクリプトヘッダの rc != 0 禁止事項を維持)。回復経路は `/vault_push`
  - **レビュー見送り 2 件 (code-reviewer 軽微提案)**: (1) flock (fd 9) を push 前に解放する案 — push stall 時に `/tweet` の 15s ブロッキング lock 取得と競合する窓はあるが、通常 push は数秒で発生確率が低く追加しない。頻発したら再検討。(2) ヘッダ既存文言「rc != 0 時は Discord 通知 + notify socket」と実体 (ログのみ) の乖離 — 既存 drift のため本タスクでは触らず、次回整理候補
  - **branch は develop**: チケット文言は `git push origin main` だったが vault repo に main は存在せず (`git branch -vv` で確認)、実証済み経路 (bot.py `VAULT_BRANCH = "develop"`) に合わせて develop とした
  - **restart 不要の確認** (§11 の実装時確認事項): 呼び出し元は `bot-workspace/.claude/settings.json` の Stop hook で、スクリプトは claude セッション終了ごとに新規実行される。remote server は経路に関与しない
  - **検証**: `bash -n` 構文 OK + `git push --dry-run origin develop` (BatchMode=yes 付き) で SSH 認証・疎通確認済み。実弾は次回 bot セッションの notes/ 書き込みで観察 (チケット #85 ① の vault auto-sync 観察と同じタイミング)
  - **連動更新**: bot.py の `/vault_push` 設計境界コメント (「Stop hook は commit までで止まる設計」→ 手動回復 + clips/ 同期用に役割変更、コメントのみで動作変更なし・restart 不要)、本台帳「主要パス」の該当行

- 2026-05-20 `web/` をローカル git のみ (remote なし、rollback 専用) で git 化
  - **背景**: companion 配下 git 化を 3 階層に整理 (`~/companion/CLAUDE.md` git 運用方針 / `workspace/PROJECT.md`「git 化の 3 階層」)。`web/` は実体あるサブプロジェクトだが、マシン外バックアップ不要・rollback が効けば十分のため (C) ローカルのみを採用
  - **やったこと**: `git init -b main` + user 設定 + gitleaks pre-commit フック配置 + `.gitignore` 作成 + `gitleaks dir` で no leaks 確認 + 初回 commit。**GitHub remote は意図的に付けない**（上げ忘れと誤認して remote を足さないこと）
  - 将来 (B) GitHub バックアップ付きに昇格させたくなったら `remote add` + `push` するだけ

- 2026-05-17 Phase 3-1 TODO「Discord 側の発火 UX 確認」を自然文継続で確定
  - **背景**: 重複チェック手段の確定に続く Phase 3-1 残 TODO。Phase 3-1 着手 (5/8) 以降の `notes/` commits 計 7 件のうち Discord 経由実弾 2 件 (5/14 notion-developer-platform / 5/16 dashboard-character-design、commit message が "bot session auto-sync") の運用観察データが揃ったため判定可能になった
  - **判定材料**:
    - 経路判別: vault git log の commit message 形式 ("bot session auto-sync" = `vault-sync-from-transcript.sh` の Stop フック経由 = Discord 経由)、それ以外 5 件 (5/9 voicevox / 5/9 tailscale / 5/12 windows-tmux / 5/12 ui-design / 5/17 japanese-tts) は手元 CLI 経路
    - ラリー数 (`bot.log` の `send len=N` カウント): 5/14 notion = 4 ラリー / 5/16 dashboard = 1 ラリー。現状最大 4
    - bot.log は send 長のみ記録、発火文本文は記録しない設計 (OWNER 限定 + プライバシー配慮で妥当、Phase 3-1 観察にはユーザー記憶を併用)
    - ユーザー観察 (2026-05-17): 自然文で問題なし、タグ指定等の引数化は不要との回答
  - **結論**: (A) Discord 発火は自然文継続。特殊コマンド・タグ引数導入は YAGNI で見送り
  - **再判定トリガ**: タグ自動推定が意図と外れて修正必要が 2 件以上 / 発火 → 着手までラリー 5 超 / 同一テーマで発火パターン混在、のいずれか
  - **STATUS.md 変更**: 「### 発火 UX（2026-05-17 確定）」セクションを「### 重複チェック手段」直下に新設、TODO から本項を削除
  - 残 TODO は「（なし）」。Phase 3-1 全 TODO (重複チェック / 発火 UX) を本日中に決着

- 2026-05-17 Phase 3-1 TODO「重複チェック手段の確定」を Claude judge + `grep -ril -i` 継続で確定
  - **背景**: Phase 3-1 実弾 3 件（5/9 VOICEVOX / 5/9 Tailscale / 5/17 日本語 TTS 選択肢）の運用観察データが揃ったため、初期方針の評価と再判定が可能になった
  - **判定材料**: 重複見落とし 0 件 / 誤検出 0 件、部分類似ヒット 1 件（5/17 が 5/9 VOICEVOX を拾い、Discord ラリーで新規採用へ）。クエリ選定は「テーマ + 周辺概念 2〜4 語の OR」で 3 件とも妥当。`notes/` 26 件で grep の体感負荷ゼロ
  - **結論**: (A) Claude judge + `grep -ril -i "<英語+日本語キーワード OR>" notes/` を継続。スクリプト化（補助・厳密化）は YAGNI で見送り
  - **再判定トリガ**: 重複見落とし 2 件以上 / `notes/` 100 件超で grep 負荷顕在 / Discord ラリーが 1 件あたり 3 ラリー超、のいずれか
  - **STATUS.md 変更**: 「### 重複チェック手段（2026-05-17 確定）」セクションを「### 書き込みフロー」と「### 主要パス」の間に新設、TODO から本項を削除
  - 残 TODO は「Discord 側の発火 UX 確認」のみ

- 2026-05-17 Phase 3-1 実弾テスト 3 件目完了（VOICEVOX 以外の日本語 OSS TTS 選択肢、Phase 3-2 着手前の下調べ）
  - テーマ「VOICEVOX 以外の日本語 OSS TTS 選択肢（2026 年・CPU 実用性とライセンス整理）」を `notes/2026-05-17_japanese-tts-alternatives-to-voicevox.md` として書き込み、`origin/develop` に push 済み（commit `a0c05a2`、message: `add: notes 2026-05-17 (japanese tts alternatives to voicevox)`）
  - 位置づけ: [[2026-05-09_voicevox-engine-cpu-and-recent-trends]] の続編。Phase 3-2 (TTS) 着手時の意思決定材料 + Phase 4 (キャラ声確定) の比較資料。比較対象は Style-Bert-VITS2 / AivisSpeech / GPT-SoVITS / Fish Speech / Coqui XTTS（参考）の 5 + α
  - フロー疎通: `git pull --ff-only` で divergent 検出（ローカル 5/16 ahead 1 + リモート 5/17 aidiary ahead 1）→ 失敗リカバリ手順 #2 → 安全条件確認 (notes vs aidiary で被らず) → `git pull --rebase` で conflict 不発で解消 → 重複 grep（5/9 VOICEVOX 単体ノート部分類似、ユーザー判断で新規ファイル採用）→ `WebSearch` 5 クエリで材料収集 → ノート作成 → code-reviewer レビュー → 軽微提案 1 件 + 事実誤認 1 件発覚 → ノート修正 → `gitleaks dir` クリーン → `git add` + `git commit` → `git push origin develop`（2 commits、5/16 dashboard-character-design 同梱）
  - frontmatter: `type=note` / `created=2026-05-17 20:34` / `tags=[tech, ai]` / `style=reference`。書き込み境界 `notes/` のみを遵守
  - code-reviewer: 修正必須なし、軽微提案 2 件—(a) 表「学習 (fine-tune)」VOICEVOX 行を `× (基本不可)` → `× (機構なし)` に言い回し改善、(b) Coqui XTTS の清算時期 2025/12 が二次情報出典、裏取り要請。(b) は自分で追加検索したところ事実誤認（公式アナウンス 2024-01-04 / SaaS 停止 2023-12-11 が正）と判明し**修正必須に格上げ**、(a) と合わせて 2 件反映
  - 学び 1: WebSearch で拾った二次情報の数値（特に日付）は code-reviewer の裏取り提案を軽微扱いせず一次出典を引きに行くべき。今回は qcall.ai の二次情報で「2025/12」と誤った記述が出ていた。`reference` ノートでは出典の一次・二次を意識する
  - 学び 2: `git pull --ff-only` 失敗 → rebase の安全条件判定（ローカル / リモートの差分ファイル群が被らない）はノート間で互いに干渉しないユースケースでは安定して通る。今回 ahead 1 + remote 1 のクロス divergent をリカバリ手順通り解消できた
  - 残課題: Phase 3-2 着手時に Inspiron 3521 上で AivisSpeech / Style-Bert-VITS2 の合成 RTF 実測。本ノート「残課題 / 要実測項目」セクションに将来の自分向けの観測項目リストを残してある

- 2026-05-14 `~/companion/web/scripts/vault-sync-from-transcript.sh` を bot Phase 2.5 T-C で新設（本台帳は連動更新のみ、実装根拠は `bot/docs/STATUS.md` の T-C エントリ）
  - 経緯: bot Phase 2.5 再設計 (`~/companion/workspace/redesign/design.md` v0.2.3 §5) で「Discord bot 経由 claude セッションが終わったタイミングで vault notes/ の未 commit を回収する Stop フック」を切る方針が確定したため、スクリプト本体を `~/companion/web/scripts/` 配下に配置
  - 責務: Phase 3-1 で確立した書き込みフロー（vault `git pull --ff-only` → notes/ 重複チェック → 書き込み → commit → push）のうち、claude session 内で完結する責務 (pull / 重複チェック / 書き込み) には触らず、**最後の `git add` + `git commit` の漏れ回収のみ**を担う。push は引き続き `permissions.ask` の人手承認フロー
  - 影響: Phase 3-1 で発生していた「claude が notes/ に書いたが commit / push が忘れられて vault repo に反映されない」シナリオを Stop フックで回収可能に。実弾運用での効果計測は次の Discord 経由発火時から

- 2026-05-09 Phase 3-1 を Discord 経由で動かして見つかった 2 件の不具合を修正
  - Phase 3-1 の TODO 2「Discord 発火 UX 確認」着手で実弾を打ったところ、(1) bot が会話を保持しないため確認ラリーが破綻、(2) WebSearch / WebFetch が permission に無く検索フロー自体が止まる、の 2 件が顕在化
  - 対処 (1): `bot/bot.py` の `run_claude` に `--continue` フォールバック導入（詳細は `bot/docs/STATUS.md` 同日エントリ）
  - 対処 (2): `workspace/.claude/settings.json` の `permissions.allow` に `WebSearch` / `WebFetch` を追加。WebFetch は OWNER 認可前提で全 URL 許可（domain 制限なし）。Phase 4 でスケジューラ等が prompt を組み立てるようになったタイミングで domain allowlist or `ask` への降格を再判定
  - 影響: Phase 3-1 のラリー型フロー（重複チェックで「上書きする？別名にする？」、書き込み判断で「○○と重複しそう、追記する？新規にする？」）が Discord 経由でも機能する状態になった
  - 残課題: 手元 claude code セッションと bot 経由セッションの混在リスクは A1 案（`--continue`）では残置。当面は短い対話で影響限定的の判断、必要が出たら A2（bot 専用 CWD or session-id 管理）に切り替え
  - 実弾再テストは未実施（bot 再起動済み、Discord 側でユーザーが発火する次の機会に動作確認）

- 2026-05-09 Phase 3-1 実弾テスト 2 件目完了（Tailscale 概要・家庭内運用パターン）
  - テーマ「Tailscale 概要と家庭内運用パターン（2025–2026）」を `notes/2026-05-09_tailscale-overview-and-home-usage.md` として書き込み、`origin/develop` に push 済み（commit `bd05acb`、message: `add: notes 2026-05-09 (tailscale overview and home usage)`）
  - 位置づけ: PROJECT.md「将来の保留事項：自宅外アクセス（Tailscale）」の下調べ。即時導入対象ではない（現状は Discord 経由の土管で外部指示が成立しているため必要性は低い）
  - フロー疎通: 開始時に GNOME keyring の ssh-agent が鍵への署名を拒否（`agent refused operation`）→ ユーザー側別ペインで `SSH_AUTH_SOCK=/run/user/1000/keyring/ssh; ssh-add ~/.ssh/id_ed25519` 実行 → 解除 → vault `git pull --ff-only`（既に最新）→ vault `CLAUDE.md` / `templates/note.md` 参照 → `grep -ril -E "tailscale|wireguard|vpn|mesh.network" notes/` で重複 0 件 → `WebSearch` 4 クエリ並列（最新動向 / ACL 家族設定 / Linux ヘッドレス / exit node + Mullvad）→ ノート作成 → code-reviewer レビュー → 軽微提案 (a) 反映 → `gitleaks dir` クリーン → `git add` + `git commit` → `git push origin develop`
  - frontmatter: `type=note` / `created=2026-05-09 16:37` / `tags=[tech, ai]`（軽微提案 (a) 反映、Aperture by Tailscale 等 AI 連携機能に触れているため `ai` タグを付与）/ `style=reference`。書き込み境界 `notes/` のみを遵守、手書きエリア（`aidiary/`, `clips/`, `inbox/`, vault ルート）は触らず
  - code-reviewer: 修正必須なし。軽微提案 2 件—(a) `[tech]` 単独 → `[tech, ai]` 化はユーザー判断で採用、(b) 自宅トポロジ記述（Inspiron 3521 / Mint 21.3 / x11vnc / exit node 等）の抽象化は private repo 前提のままでよい判断で不採用
  - 学び 1: Claude Code 環境（非対話シェル）からは GNOME keyring の ssh-agent 解除パスフレーズを入力できない。鍵がロックされた状態で `ssh-add -l` は鍵を表示するが、署名段階で `agent refused operation` で拒否される。回避はユーザー側ターミナルで `SSH_AUTH_SOCK=/run/user/1000/keyring/ssh ssh-add <鍵>` を 1 回実行する運用。tmux 別ペインを開く場合は `SSH_AUTH_SOCK` の継承が落ちるので明示的に export してから `ssh-add` する必要がある
  - 学び 2: Tailscale は ACL から Grants へ推奨が移行中、Funnel／Subnet router／Exit node の使い分けは「公開範囲」と「クライアント導入可否」で割れる。家庭内 + 家族共有では `tag:home-services` 等のタグ単位 + deny-by-default が標準形

- 2026-05-09 失敗リカバリ手順を STATUS.md に明文化
  - 「### 失敗リカバリ手順」セクションを「### 主要パス」と「## TODO」の間に新設。push reject / `git pull --ff-only` 衝突 / frontmatter 規約違反 / その他境界違反（gitleaks・書き込み境界）の 4 ケースを記述
  - 共通方針: `git push --force*` / `reset --hard` 系を使わない（`.claude/settings.json` deny と整合）、判断に迷う段は独断 resolve せず Discord で 1 行確認
  - push reject 時は `git pull --rebase` を基本に、conflict 出たら `--abort` で完全に戻して報告。`notes/` 同名ファイル双方更新は conflict 確実なので即停止
  - frontmatter 違反は気づいた段階で commit 前 / commit 後 push 前 / push 後 の 3 段階に分岐。push 後は force push せず修正 commit を新規追加
  - code-reviewer: 修正必須 1 件（手順 #4 の `git reset HEAD~1 -- <file>` が誤り。実際は index しか戻らず HEAD もワーキングツリーも動かない。`git commit --amend` 流儀に揃えて B と一貫させる修正を反映）。軽微提案 2 件はユーザー判断で不採用、現状の状況分岐記述を保持
  - 学び: `git reset HEAD~1 -- <path>` は HEAD 移動なしの index リセットで、commit を取り消す動作ではない。push 前のロールバックは `--amend` 一本に倒すほうが流儀が揃う
- 2026-05-09 vault `CLAUDE.md` に `style` フィールドの運用指針を追記（fleeting / reference の使い分け）
  - vault repo (`mooneclipse/obsidian-vault`, develop) の `CLAUDE.md` 「ノート作成」セクションに 1 行追加。`fleeting`（雑記・日記・断片）と `reference`（Web 検索結果や外部情報をまとめた参照用ノート）の使い分けを明文化
  - `style: reference` の運用根拠が web/docs/STATUS.md にしかなかった状態を解消、vault 側の正規ドキュメントに一本化
  - フロー: vault `git pull --ff-only` → CLAUDE.md 編集 → code-reviewer レビュー（修正必須なし、軽微提案 1 件「`reference` 条件を内容の性質ベースに簡潔化」を採用）→ `git diff` + gitleaks クリーン確認 → `git commit` (`update: CLAUDE.md add style field guidance (fleeting / reference)`) → `git push origin develop`
  - 学び: vault は Obsidian 全般の汎用文書という位置づけなので、Phase 3-1 / companion 等の固有名は持ち込まず「機械書き込み経由の参照用ノート」も最終的に「内容の性質」で定義する形（`Web 検索結果や外部情報をまとめた参照用ノート`）に落とした。vault 側の正規ドキュメントは特定システムへの過結合を避けるのが今後も基本
- 2026-05-09 Phase 3-1 実弾テスト 1 件目完了（手元 `claude -p` 経路、Discord 経由の発火確認は別途）
  - テーマ「VOICEVOX エンジンの CPU 動作と最近の動向（2025-2026）」を `notes/2026-05-09_voicevox-engine-cpu-and-recent-trends.md` として書き込み、`origin/develop` に push 済み
  - フロー疎通: vault `git pull --ff-only` → vault `CLAUDE.md` / `templates/note.md` 参照 → `grep -i voicevox|tts|音声合成` で重複チェック（一致なし）→ `WebSearch` 4 クエリ並列 → ノート作成 → code-reviewer レビュー → 軽微提案反映 → `git add` + `git commit`（gitleaks クリーン）→ `git push origin develop`
  - frontmatter: `type=note` / `created=2026-05-09 01:52` / `tags=[tech, ai]` / `style=reference`。書き込み境界 `notes/` のみを遵守、手書きエリア（`aidiary/`, `clips/`, `inbox/`, vault ルート）は触らず
  - code-reviewer: 修正必須なし。軽微提案 1 件「`creative` タグ要否」→ ユーザー判断で `[tech, ai]` に絞った
  - 学び: 重複チェックは `grep -ril -i "<英語キーワード>|<日本語キーワード>" notes/` で十分機能（今回は 0 件マッチ）。長文テーマでもファイル名規約 + frontmatter 順は templates/note.md に揃えれば破綻しない
- 2026-05-08 Phase 3-1 着手 + 台帳作成
  - `~/companion/web/docs/STATUS.md` を新設（本ファイル）。書き込みフロー・ファイル規約を vault 既存規約と PROJECT.md から転記し、Phase 3-1 の運用根拠をここに集約
  - `~/companion/web/` ディレクトリは台帳のみで開始。スクリプト・git 化は YAGNI で先送り（実弾テスト後に必要性を再判定）
  - PROJECT.md のディレクトリ構成と Phase 3-1 セクションに本台帳のパスを追記
  - code-reviewer: 修正必須なし、軽微提案 3 件すべて反映（① `created` を `YYYY-MM-DD HH:mm` に揃え vault テンプレ準拠、② `style: reference` の Phase 3-1 新設根拠を本台帳に明記し vault `CLAUDE.md` への正規追記は TODO へ、③ `web/docs/reviews/...` 分割行を運用ルールに追加して bot/maintenance と一致）

## 既知の問題

（なし）

## 運用ルール

- ノート 1 件書き込みごとに **vault 側の `CLAUDE.md` とテンプレートを必ず参照**する（タグ運用・frontmatter のズレは毎回チェック）
- 書き込み対象は `notes/` のみ。手書きノート領域に触れたら境界違反として即ロールバック
- 重複が疑わしいときは独断で進めず Discord で必ず確認を取る（PROJECT.md 明記）
- 実弾ノート書き込みの Done エントリには **Discord ラリー回数を 1 語添える**（「重複ラリー 0」「重複ラリー 2 (追記 / 別名)」等）。「### 重複チェック手段」の再判定トリガ「1 件あたり 3 ラリー超」を定量化するための運用記録
- タスクの実装・運用変更が一段落したら、Claude（Code）が subagent でレビューを実行する。観点:
  - 正しさ（書き込みフローの手順遵守、frontmatter / タグ規約遵守、書き込み境界）
  - セキュリティ（vault repo の境界、push 認証情報の扱い、検索結果のサニタイズ）
  - 簡潔さ（不要な抽象・過剰な防御コード）
  - 既存慣習との整合（bot/, maintenance/ で確立したパターン）
- レビュー結果は **Review pending** 欄に追記 → 必要な修正を実施 → 該当タスクを **Done** へ移動
- レビュー量が多くなったら `web/docs/reviews/YYYY-MM-DD-<task>.md` に分割
- 1 タスク完了ごとに「最終更新」日付を更新
