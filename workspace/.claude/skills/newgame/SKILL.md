---
name: newgame
description: AI が要望を聞かず一次資料だけから新規ゲームを勝手に制作するクリエイティブ専用スキル。game-designer で発散 → AI 自決 → implementer 実装 → playtester 実機検証 → 配信 → 感想記録 まで自走する。companion-games 用、改修用の orc とは軸が違う。
---

# newgame — 新規ゲーム制作のオーケストレーション

ユーザーに要望を聞かず、一次資料（嗜好メモ＋各作 review）だけを入力に、新しいゲームを **AI が勝手に制作する** クリエイティブ専用スキル。コンセプト発散（game-designer 並列）→ AI 自決での選定 → 美学確定（lead）→ implementer 実装 → playtester 実機検証 → 配信 → 感想受領、までを 1 本の工程として回す。

`orc` は「意図が固まった改修」用（implementer → code-reviewer → commit）。本スキルは「意図そのものを AI が生む」新規制作で軸が違う。第 1・2 作（みちゆき / ともしび）は orc を変則流用したが、固有工程（一次資料・発散・美学判断・実機検証・配信導線・感想反映）が orc に無いため専用化した。

## 大前提（変更不可）

- **完全 AI 自決**: コンセプト〜美学までを一次資料だけから AI が全確定する。ユーザーへの確認窓を工程に置かない。「自分にいっさい要望を聞かず、自分が楽しめるゲームを AI が勝手に作る」という発注趣旨そのものを担保する。選定理由・美学判断は STATUS に残してユーザーが後から追えるようにする（確認ではなく事後記録）。
- **純静的 PWA**。ランタイムで claude / 外部 API を呼ばない（budget-guard 境界回避）。

## 美学は固定しない（2026-06-03 方向転換）

詩 3 作（みちゆき 5／ともしび 3／なごり 3）は「静けさ・スコア無し・失敗無し・読むだけ」を**変更不可の美学として固定していたことが真因**で、ジャンルが詩に収束し凡庸に着地した。ユーザー承認のうえこの固定を**破棄**（第 4 作あかり＝デッキ構築ローグライク＝スコア/失敗あり、で初の好感触）。以後:

- **継承するのは「視覚の美しさ」のみ**（色と光。3 作＋あかりで一貫して当たった唯一の資産）。
- **静けさ・スコア無し・失敗無し・詩・静歩き・読むだけ には戻さない**。ジャンル/ゲーム性は **Steam 実プレイ嗜好（行動データ）から選ぶ**。周回・意思決定・数字や状態の手応え・失敗と再挑戦を恐れない。
- 何を継承し何を変えるかは毎回 §1 の一次資料から**フレッシュに再判断**する（過去の解釈・前作の美学に固定されない）。

## 固定工程

### 1. 一次資料読込（必須）

着手したら、まず次を必ず全部読む。読まずにコンセプトへ進まない。

- **主資料 = Steam 実プレイ嗜好（行動データ）**: `~/companion/games/docs/steam-library-2026-06-02.json`（owned 289、`playtime_forever`/`playtime_2weeks`/`rtime_last_played`/collections）。**毎回フレッシュに再分析**する（過去の解釈に引きずられない）。読み方の要点＝①直近 2 週に触れているもの（今の興味）②総プレイ最大クラスタ③「一度クリアして終わり」と「何百時間も繰り返す」の差（繰り返し遊ぶジャンルこそ本命）。
- 従資料: vault `aidiary/2026-04-11_games-i-want-to-try.md`（願望ポエムメモ。**願望であって行動ではない**。詩・静歩きへ過収束させない＝3 作凡庸着地の真因なので主資料にしない）。
- 各既存作の review ノート: vault `notes/*-review.md`（例 `notes/2026-06-02_michiyuki-review.md`、`<date>-akari-review.md`）。
- `~/companion/games/docs/STATUS.md` の「方向転換」「ユーザー感想」「設計起点メモ」。

ここから判断軸を 2 列で確定する（毎回フレッシュに）:

- **継承資産（残す）**: 視覚の美しさ（色と光）／純静的 PWA。
- **課題（次で乗り越える）**: 詩・静歩き・読むだけ・スコア無し・失敗無しには戻さない。Steam 実データのクラスタに沿って**周回・意思決定・数字や状態の手応え・失敗と再挑戦**のある「本物のゲーム」を作る。前作と**ゲーム性そのもの**を変える。

### 2. コンセプト発散（subagent 並列、レーン分離）

`Task` ツールで `subagent_type: game-designer` を **複数並列起動**する。「毛色を変えろ」だけでは弱い（3 作とも詩へ収束した）。**各 agent に別メカニクス・レーンを固定割当し、ジャンル/ゲーム性そのものを変えさせる**（例: Steam クラスタに沿って デッキ構築／ループ自動進行／採掘システム／論理パズル のように 1 体 1 レーン）。各 prompt で「詩・静歩き・読むだけ・なぞって読む系は禁止」「他レーンと被らせない」を明示。read-only なので案の提案だけが返る（あかり発散ではこのレーン分離が同方向収束を構造的に防いだ）。

**agent team(mesh) への昇格条件**: 並列 subagent の案が ①互いに似通う ②全員が行き詰まる ③振れ幅が足りないと lead が判断した、のいずれかに該当したときだけ、`workspace/CLAUDE.md` の mesh 手順（発散ラウンド＝teammate 同士が直接 SendMessage で反証、devil's advocate を必ず spawn、改版履歴 section）に昇格する。デフォルトは subagent 並列で済ます（team はトークンが桁で高く、個人ゲーム制作には基本過剰）。

### 2.5. 面白さ批評（game-critic devil、常時・必須）

選定（§3）の前に、`Task` ツールで `subagent_type: game-critic` を起動し、§2 で出た**全案を攻撃的に反証**させる（read-only）。これは lead 単独選定の単一障害点を反証で訂正する構造的装置（`~/companion/CLAUDE.md` C「仕様議論で devil's advocate を必ず起用」をゲーム企画に常時適用。詩 3 作はこの企画段階の面白さ批評が無く、作る前に潰せる罠を作ってから気づいた）。critic に出させるもの:

- 各案の **面白さを殺す構造**: どこで飽きる／詰まる／単調になるか。意思決定が毎手番効くか（無いなら指摘）。**支配的な 1 手・1 枚・1 戦略**で作業ゲー化しないか。
- **前作の轍リスク**: なぜこの案が「読むだけ／低ゲーム性／同系統」の再発でないと言えるか（言えないなら名指し）。
- **スマホ片手・短時間**で成立するか（重すぎ／長すぎ）。
- 採用前に検証すべき項目・採用すべきでない罠リスト。

lead は critic の罠リストを §3 の選定と §4 の美学確定に反映する（critic は判断主体ではない＝最終判断は lead。`workspace/CLAUDE.md` center of truth）。critic が全案を地雷判定したら §2 をレーンを変えてやり直す。

### 3. AI 自決でコンセプト選定

返ってきた案を lead が比較し、完全 AI 自決で 1 案を選ぶ。ユーザーに振らない（`AskUserQuestion` を使わない）。**選定理由を STATUS に 1 行記録**する（どの案をなぜ選んだか。事後にユーザーが追えるように）。

### 4. 美学確定（lead）

選んだコンセプトを lead が center of truth として詰め、次を確定する。teammate / implementer に委ねない（収束は lead 単独責任）。

- **核メカニクス**: 「読むだけ」を超える相互作用を一段（みちゆき＝読む、ともしび＝呼ぶと応える、の系譜で次の一手）。
- **断章 verbatim テキスト**: lead がここで全文を書き切る。**実装側で創作・改変しない静的データ**として渡す（`fragments.js` に入る本文）。
- **PALETTE（配色キーフレーム）**: progress に沿った空・地面（あるいは闇・薄明）の色補間キーフレーム。
- **前景視認性**: プレイヤー・触れる対象は背景明度変化に追従し、常にコントラストを確保する（暗背景では明るめ・明背景では暗めへ相対的にずらす + ごく細い縁取り程度）。**初手から設計に入れる**（v1 で後から気づいた教訓。強い縁取りで目立たせず「言われれば気づく」を目標）。

### 5. implementer 実装

`Task` ツールで `subagent_type: implementer` を起動し、§4 で確定した美学（核メカニクス／verbatim 断章／PALETTE／視認性）を prompt に転記して実装させる。

- **純静的 PWA**。ランタイムで claude / 外部 API を一切呼ばない（budget-guard 境界回避）。
- 断章は §4 で渡した verbatim をそのまま `fragments.js` に入れる（implementer 側で書き換えない）。
- 配信境界・SW 運用・VERSION 規律など games 固有制約は `~/companion/games/CLAUDE.md`（CWD=games で auto-discovery される）に従う。

### 6. playtester で実機検証 PASS（必須）

`Task` ツールで `subagent_type: playtester` を起動し、`tests/debug-<game>.mjs` を書かせて回させる。

- **本番ポート 47825 を絶対に使わない**（あかり検証で 47825 に自前サーバを立てるため本番プロセスを kill→検証後に再起動せず本番が 502 になった事故）。**別ポート（47826 等）で検証**し、検証後も本番 `companion-games`（47825）には一切触れない。
- **画面座標ヒットテスト経由**で検証する（canvas へ直接 dispatch 禁止＝overlay を飛び越える検証ミスを防ぐ。みちゆきの真因がここだった）。`elementFromPoint` で最前面要素を assert。
- pageerror 0 / opening タップで scene 遷移 / 核メカニクス挙動 / 画面変化率を確認。
- **テキスト可読性（必須）**: 全画面（title/各シーン/reward/defeat 等）で全テキスト・カード・数値の bounding rect が画面内に収まり**はみ出し 0**（なごり「文字がはみ出して読めない」3/10 の直接対策）。
- **実機リアリズム（必須、"PASS≠実機/伝わる" の穴対策）**:
  - **ブラウザツールバーを再現した短高 viewport**（例 412×680 / 412×730＝モバイル Chrome アドレスバー表示時）で、**操作に必須な要素（ボタン等）の bounding rect が `innerHeight` 内に収まり押せる**ことを assert（あかり v1.3.0＝`100vh` で最下部ボタンがツールバー裏に切れた実機バグの再発防止）。headless は実ツールバーを完全再現できない（svh=vh になる）限界を理解し、**受け入れ条件（可視高で収まる・top 基準・タップ機能）**で担保する。
  - **初見が次の操作に迷わない**: カードを使い切った／手番終了などの局面で「次に何を押すか」の導線（ボタン/ヒント）が可視で機能すること（あかり v1.1.0「ターン終了が分からず詰まる」対策）。
  - **行動のフィードバックが見える**: 自他の行動・状態変化が見える形で起きること（あかり v1.2.0「敵が一瞬で行動し見えない」対策）。同期一括で潰さず、間/演出で可視化されているか。
- **既存作の回帰（URL 不変の証明）も同一起動サーバで通す**（みちゆき `/` 200・pageerror 0・コア操作前進 等）。
- **面白さ代理レポート（gate 外、lead のバランス/手応え判断材料）**: 簡易戦略 bot で N ラン自走させ **クリア率（手応え帯の目安 15〜40%。0%＝理不尽 / 高すぎ＝手応え不足）・到達分布・支配戦略の有無・1 ラン長**を報告する。合否には含めない（最終の面白さ判定は遊ぶユーザー）。
- PASS が出るまで配信に進まない。

### 7. 配信導線チェックリスト

実機検証 PASS 後、次の 4 点を順に処理する。

1. `server/app.py` の `STATIC` dict に新ゲームの prefix エントリを追加（index.html / app.js / fragments.js / style.css / manifest.json / icons を `<game>/web/...` rel で、絶対パス prefix `/<game>/` で）。既存作の URL は完全不変に保つ。
2. remote 側 `~/companion/remote/web/app.js` の `GAMES` 配列に 1 行追加（タイトル + 本番 URL の `/<game>/`）+ SW cache bump。
3. `tailscale serve` 状態を確認（同一サーバ・同一ポートのため systemd unit は変更不要）。
4. VERSION bump（ゲーム本体 `<game>/web/*` を触ったら必ず上げる。実機キャッシュ残存と検証不足の切り分けに必須）。

### 8. code-reviewer + commit

`Task` ツールで `subagent_type: code-reviewer` を起動して差分を点検。修正必須が出たら implementer に反映 → 再レビュー（再委任は 1 往復まで）。OK 後に commit する。

- commit メッセージは **games repo の既存ログスタイルに揃える**（`feat(games):` / `docs(games):` 等）。
- **Co-Authored-By trailer は付けない**（companion 配下 repo の共通方針）。
- games repo（`~/companion/games`）と、もし server prefix 以外で workspace 側を触ったらそれぞれ別 commit。push はしない。

### 9. 感想受領 → 次作方向づけを STATUS に記録

ユーザーがプレイした感想（vault `notes/<date>-<game>-review.md` 等）を受領したら、継承資産（次作以降も残す）と課題（次の教訓）を `~/companion/games/docs/STATUS.md` に記録し、次作の設計起点メモを残す。感想の解釈・次手の判断は AI 側で確定する（ユーザーは管理を委任済み）。

## 確認の作法

完全 AI 自決ゆえ、基本ユーザー確認なしで全工程を自走する。停止してユーザー承認を仰ぐのは、orc と同じ **例外操作** に踏み込むときだけ:

- `git push` / タグ push / PR 作成
- 本番デプロイコマンド
- 外部 API 課金が発生する操作
- 既存データの削除（DB レコード、ファイル削除、`rm -rf` 系）
- 外部公開境界の変更（127.0.0.1 bind / tailscale serve 境界を緩める等）

これら以外は確認不要。コンセプト・美学・実装方針・テスト方針の分岐はすべて AI 側で決める。

## agent team との関係

- **発散ラウンド**: subagent 並列が基本。§2 の昇格条件を満たすときのみ team(mesh) へ上げる（`workspace/CLAUDE.md` の mesh 手順・devil's advocate 必須・改版履歴規律に従う）。
- **収束・成果物確定**: lead 単独責任。コンセプト選定（§3）・美学確定（§4）・STATUS への確定記録は lead が center of truth として一元管理する（`workspace/CLAUDE.md` の center of truth 原則）。teammate を議論パートナーとして扱い、判断主体としては扱わない。

## 関連ドキュメント

- `~/companion/games/CLAUDE.md` — games 固有の暗黙知（配信境界 / 純静的 PWA / verbatim 断章 / Playwright 必須 / 一次資料パス / 配信導線 / SW・VERSION 運用 / 前景視認性）
- `~/companion/games/docs/steam-library-2026-06-02.json` — **一次資料 主**（Steam 実プレイ嗜好＝行動データ、owned 289）
- `~/companion/games/docs/STATUS.md` — 開発台帳（既存作の設計判断・感想・方向転換・次作方向づけの正本）
- `~/companion/workspace/.claude/agents/game-designer.md` — コンセプト発散 sub-agent（レーン分離で起動）
- `~/companion/workspace/.claude/agents/game-critic.md` — 面白さ批評 devil sub-agent（§2.5、選定前に全案を反証）
- `~/companion/workspace/.claude/agents/playtester.md` — 実機検証 sub-agent（本番ポート非接触・実機リアリズム・面白さ代理レポート）
- `~/companion/workspace/.claude/agents/implementer.md` — 実装 sub-agent
- `~/companion/workspace/.claude/agents/code-reviewer.md` — レビュアー sub-agent
- `~/companion/CLAUDE.md` — 設計判断・対症療法の上限（2 周目ルール）
- `~/companion/workspace/CLAUDE.md` — Task Workflow / Agent Teams 運用（mesh/star 切り替え・center of truth）
