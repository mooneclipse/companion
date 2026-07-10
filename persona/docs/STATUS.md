# companion-persona 開発台帳（Phase 4: 相棒層 = キャラクター性の付与）

最終更新: 2026-06-20 (軸 4 拡張 (1)〜(6) を統合レビュー (4 分岐 investigate→ticket→reminder→talk が揃った最終 HEAD を code-reviewer で通し点検) = 修正必須なし、軽微提案対応で interval キーの逆方向 clobber 回帰テストを 3 mode 対称に追加 (bot commit `0813f17`、272→275 tests pass) + (1)〜(6) を 2026-06-20 に restart 済み (`systemctl --user restart companion-bot` active 確認)・push 済み (bot/maintenance 両 repo origin/main 反映) — 以降は実機発火の成果物確認のみ自然待ち / 軸 4 拡張 (5) 勝手な実行 C = リマインド「振り返る」分岐を実装 — (3) investigate / (4) ticket と対称。固定優先順を investigate → ticket → **reminder** → talk に拡張、state 1 read で 1 つ拾う。reminder は外向き/不可逆操作ゼロ = 過去に触れた関心スレッド (decay しかけ / researched 済み) や自分の `--by ai` チケットを振り返って #chat に一言投げるだけ (tickets.py は list/show 読み取りのみ、add/done/start/編集禁止)。新純関数 `should_remind` (interval + 実 signal 有無、investigate/ticket の freshest と逆に oldest を拾う = 振り返りの意味)。設計分岐は「軽い別機構 = (4) ticket と同 ephemeral 骨格」を採用 (list 読み取りツール使用が #chat 会話 session を汚染しないため、新ゲート/新確率/新 mode なしで既存 state 1 read 骨格に最小で乗る形)。index 空なら発火しない (§F でっち上げた過去を振り返らない)、催促/引き止め禁止 (軸 1 整合)、応答経路・settings 不変。bot commit `314b48f`、251→272 tests pass。restart 済み (2026-06-20)・push 済み (2026-06-20)、実機の reminder 発火確認のみ自然待ち。詳細は Done 同日 entry) / 軸 4 拡張 (6) 前景降格ガードを実装 — 不可逆/外向き操作 (tweet/メール/vault push/notes 外書き込み/maintenance 変更/設定変更) を自動実行せず #chat に「○○やっとこうか?」と前景提案する方針を `PERSONA_SYSTEM_PROMPT` に 1 ブロック追加 (talk/investigate/ticket 全モード共有)。個別プロンプト 2 定数の汎用外向き禁止列挙を降格ルールへ一本化しタスク固有 allowlist は残す。ledger の base dict に静的 marker `foreground_proposal: True` (全モード継承、提案テキストの機械検知はしない)。新自動実行ゼロ・新ゲート/新 mode 分岐なし・settings 不変・応答経路不変、bot commit `ffd9a71`、247→251 tests pass。restart 済み (2026-06-20)・push 済み (2026-06-20)、実機の前景提案発火確認のみ自然待ち。詳細は Done 同日 entry) / 軸 4 拡張 (4) 勝手な実行 B = 共用チケット自発起票「起票する」分岐を実装 — (3) investigate と対称。proactive 全ゲート + budget 通過後、固定優先順 investigate → ticket → talk で state 1 read で 1 つ拾う。ticket は ephemeral session で関心 signal を元に `tickets.py add --by ai` で共用 TODO に 1 件起票 → #chat 報告 → 思考ログ観察。boundary (add --by ai 1 件のみ / list 読み取り / 重複 skip / OWNER 不可触) はプロンプト強制 (settings 不変)、index 空なら発火しない (§F でっち上げ起票禁止)。新純関数 `should_ticket`、bot commit `6a8a0b7` + `b6ceeba`、247 tests pass、code-reviewer 修正必須なし。restart 済み (2026-06-20)・push 済み (2026-06-20)、実機起票発火の成果物確認のみ自然待ち。詳細は Done 同日 entry) / 軸 4 拡張 (3) 勝手な実行 A = notes/ 自己調査「動く」分岐を実装 — proactive 全 7 ゲート通過後に bot 側で state 1 回引き (index `last_investigate` interval + 調査可能 active thread) で talk/investigate を分岐。investigate は ephemeral session (budget guard 経由・#chat 会話 session 非汚染) で Web 調査 → notes 新規作成 → #chat 報告 → 思考ログ観察。`proactive-companion.sh` 無改変、応答経路不変、4h 最小間隔保全。bot commit `ab51ac4`、226 tests pass、code-reviewer 修正必須なし。restart 済み (2026-06-20)・push 済み (2026-06-20)、実機 investigate 発火の成果物確認のみ自然待ち。詳細は Done 同日 entry) / 軸 4 拡張 (2) 総量管理を週ローリングに作り直し — proactive step5 の硬い日次上限 `PROACTIVE_DAILY_MAX=2` が直前の可変ケイデンス (step7) の波の振幅を潰すため、過去 168h ローリング `PROACTIVE_WEEKLY_MAX=8` に置換 (OWNER 確定)。発火 epoch 列を script 側 state 1 本でカウント + prune、bootstrap-safe。役割分担 = 静かな日は活性度確率 / 連発総量は週上限。restart 不要。詳細は maintenance/docs/STATUS.md 2026-06-19 Done) / 軸 4 拡張 (2) 不在の可変ケイデンスを実装 — proactive step7 の固定確率を関心 index 活性度で変調 (固定→波)、bootstrap-safe (空 index は base 維持)、新 env で従来固定にも戻せる。bot に canonical 純関数 `activity_score` 追加 + maintenance script の step7 で import、212 tests pass。応答経路は不変。restart 不要 (script は毎 tick 最新読み)、bot 側実 index 生成は発火待ち。詳細は Done 同日 entry) / 軸 4 拡張 (1) 関心 state 機構 1 を bot に実装 — 構造化 index `companion_interests.json` + 私的思考ログ `companion_thoughts.jsonl` (bot/sessions/、vault 外・非 commit) + proactive への最小配線 (送信確定後に実活動起点で seeding、build_proactive_prompt で滲ませ)。bot repo commit `4cdbbd4`、204 tests pass、code-reviewer 修正必須なし。restart 済み (2026-06-20)・push 済み (2026-06-20)、実機発火観察のみ自然待ち。詳細は Done 同日 entry)

## 概要

Phase 4 = 相棒層。Phase 1〜3 で通した土管・能力の上に、相棒としてのキャラクター性を後のせする（PROJECT.md 冒頭「機能先、キャラクター性は後のせ」原則）。4 軸で構成する:

1. **口調・性格コンセプト** — どう喋るか、どういう性格か
2. **声** — VOICEVOX のどのキャラ（voice/ の技術基盤と接続、voice bot 統合の gate）
3. **立ち絵・表象** — 人型 or 記号 ◯■（→ 記号 = 小箱で確定、軸 3 section 参照）
4. **存在感の調整** — 「相棒」としての距離感・割り込み方の調整

進め方は **orc で 1 軸ずつ決め打ち**（agent team は使わない、user 確定）。軸の順番は 口調・性格 → 声 → 立ち絵・表象 → 存在感の調整（概念決めは軸間の依存が薄く前後可、軸 4 は 2026-06-12 に先行確定）。

設計上の親ドキュメント: `~/companion/workspace/PROJECT.md`「### Phase 4: 相棒層」section。voice 系の素材は `~/companion/voice/docs/STATUS.md` + `~/companion/workspace/redesign/voice-design.md` v2.0。

## 着手記録 (2026-06-01)

着手条件 3 件（PROJECT.md「Phase 4 着手発火条件」、2026-06-01 entry 群で確定）の充足状況:

- **#1 (Phase 3 能力が日常運用 2 週間以上)**: 充足。「Phase 3 の能力」該当は vault 同期 (3-1) と voice (3-2) のみ、voice を Phase 4 移送したため **vault 同期 (Stop hook 常時稼働・運用 2 週間以上継続) で形式充足**。bot 無停止運用 (cold cut 以降 NRestarts=0 / ERROR 0) + dashboard 毎朝稼働 (timer 欠日なし) を土台確立の傍証とする。
- **#2 (直近 2 週間 想定外停止/誤動作なし)**: **2026-06-01 に Phase 4 着手の門から外された**（PROJECT.md 健全性履歴 2026-06-01 entry「追加判断」section）。観察は撤廃せず「bot.py 土管を大改変したとき（Phase 4 中に voice bot 統合 / remote v1-β を入れる等）の、その変更への短い様子見」へ再定義。Phase 4 着手自体の門ではない。
- **#3 (user 自己宣言)**: 本セッション（2026-06-01）で user 宣言、充足。

∴ 着手条件をすべて満たし、Phase 4 着手可と判定済み。進め方 = orc で 1 軸ずつ決め打ち。

## 軸の進捗

| 軸 | 内容 | 状態 |
|---|---|---|
| 軸 1 | 口調・性格コンセプト | ✅ 確定 (2026-06-01) = 対等な相方、✅ bot 配線済み (2026-06-11 前倒し) |
| 軸 2 | 声 (VOICEVOX speaker 選定) | ✅ 確定 (2026-06-12) = 玄野武宏、✅ voice bot 統合完了 (2026-06-12、V-S1/V-S2 実弾 pass) |
| 軸 3 | 立ち絵・表象 | ✅ 確定 (2026-06-12) = 小箱 (dashboard 既存キャラ昇格) |
| 軸 4 | 存在感の調整 | ✅ 確定 (2026-06-12) = 同じ部屋にいる相方 |

### 軸 1: 口調・性格コンセプト ✅ 確定 (2026-06-01)

**コンセプト = 「対等な相方」**。project が呼ぶ「相棒」に最も近い対等な相方感。タメ口ベースで短く、時々さりげない気遣いや軽口を一言添える。現状の素の bot 口調に温度を足す方向（過度なキャラ付けはしない）。

例文:

> 了解、やっとくよ。…って今日もう夜遅いけど大丈夫?

**配線済み (2026-06-11 前倒し)**: bot.py の `PERSONA_SYSTEM_PROMPT` として全 claude 呼び出し (`run_claude` → `--append-system-prompt`) に常駐。禁止形 (です・ます調を使わない) を明示 (「フランクに」だけでは敬語デフォルトに押し負けるため)。詳細は「重要な注記」の方針変更 entry と `bot/docs/STATUS.md` Done 参照。

### 軸 2: 声 (VOICEVOX speaker 選定) ✅ 確定 (2026-06-12)

**speaker = 玄野武宏** (ノーマル speaker_id=11。他スタイル: 喜び 39 / ツンギレ 40 / 悲しみ 41。engine 0.25.2 同梱 vvm の metas.json で実機確認済)。最終候補 Voidoll との 2 択から OWNER 確定 (2026-06-12)。選定根拠:

1. **スタイル 4 種** (Voidoll はノーマル 1 本のみ): 軸 4 自発発話で将来表情を付け分ける余地を確保
2. **ren の声の同一性**: claude code 側通知音声 (事前生成 wav) が既に玄野武宏 = ren。通知と bot 発話で声が割れない
3. **軸 1「対等な相方」との整合**: 同じ部屋にいる人間っぽい相方の距離感に自然な青年声が合う (Voidoll の合成感は「AI らしい AI」路線で軸 1 と方向が異なる)

規約は個人利用 OK (クレジット要件は公開時のみ、engine 同梱 policy.md 確認済)。四国めたん id=2 は技術検証時の仮置きで、`VOICE_DEFAULT_SPEAKER` の切替を含む配線は従来方針どおり voice bot 統合タスクで実施する。voice bot 統合（本軸が gate、bot/voice_command.py / voice_status.py / voice_ledger.jsonl / bot.py への slash registration）は bot.py 大改変にあたるため、着手時はその変更に様子見観察を適用する（PROJECT.md 着手条件 #2 再定義）。

**同時確定 (発話レイテンシの設計判断)**: この機材 (RTF 2.1-3.0 warm) で合成速度の改善は追わず、**「生成と再生の分離」で吸収する** (軸 4 の自発発話は返事を期待しない一方通行 = 生成を待つ主体がいないため、テキスト確定 → 裏で合成 → 完成後に再生でレイテンシは UX 要件から消える)。詳細・代替案の比較は `~/companion/voice/docs/STATUS.md` 2026-06-12 entry 参照。

### 軸 3: 立ち絵・表象 ✅ 確定 (2026-06-12)

**コンセプト = 「小箱」**。dashboard の既存小箱キャラ (`dashboard/web/index.html` の `.companion` SVG = 角丸の箱 + スクリーン顔 + アンバー `--accent` #f3b85f の目・口、sway / breathe / blink アニメ + `data-state` 表情切替機構) を ren の正式表象に昇格する。当初の 2 択 (人型 or 記号 ◯■) は**記号**で確定。新規デザインは起こさない。

構成 3 要素:

1. **表象 = 既存の小箱キャラそのまま**: 毎朝の dashboard 運用で「ren の姿」として OWNER に定着した実態 (OWNER「ダッシュボードで見慣れた」2026-06-12) をそのまま確定にする。人型立ち絵は作らない
2. **他の面への展開は同モチーフの流用のみ**: Telegram bot アイコン / remote PWA 等に姿を出す場合はこの小箱を流用し、面ごとに別の姿を発明しない。展開は必要が出た時点でよい (機能先・キャラは後のせ原則)
3. **やらないこと (境界)**: 人型化しない / 表情・装飾の過剰追加をしない。`data-state` (normal / thinking 等) の bot 状態連携は概念でなく将来の実装タスク (現状 normal 固定、`app.js` コメント「外部連携は将来」のまま)

声 (軸 2 玄野武宏の青年声) × 小箱の組み合わせは、軸 4「同じ部屋にいる相方」の同居感と整合する (家電のような佇まいで同じ部屋にいる)。

### 軸 4: 存在感の調整 ✅ 確定 (2026-06-12)

**コンセプト = 「同じ部屋にいる相方」**。同じ部屋で別々のことをしている相方の距離感。気が向いたときに返事を期待しない一言を投げてくるが、会話の主導権は常に OWNER 側にあり、無視しても何も起きない。軸 1「対等な相方」の存在感版。OWNER の「反応できないかもしれないけど話しかける頻度は高くてもいい」(2026-06-12) を前提に、**返事ゼロでも成立する一方通行の声かけ** として設計する。

構成 3 要素:

1. **頻度 = 「ほぼ毎日 1 回、たまに 2 回」**: 現状 (上限 1 日 1 回 × 確率 0.4 × 沈黙 6h) → **上限 1 日 2 回 × 確率 0.7 × 沈黙 4h** へ引き上げ。発火窓 9〜22 JST は据え置き。確率・沈黙閾値・1 日上限とも `proactive-companion.sh` の env (`PROACTIVE_PROBABILITY` / `PROACTIVE_SILENCE_HOURS` / `PROACTIVE_DAILY_MAX`) で調整可 — 2026-06-12 実装済み (Done のチケット #19 entry 参照)
2. **種 = 「死蔵知識との再会」を追加**: 現状の種 (直近会話 + 当日 vault ノート名) に、vault の読み返されない過去ノートを週 1 程度掘り起こす低頻度種を追加する。返信不要の一方通行と相性がよい (読み流すだけで価値が出る)。チケット放置リマインドは maintenance 通知と役割が被るため種にしない
3. **やらないこと (境界)**: 返事の催促・追撃をしない (未返信に次の発話で触れない) / 情緒的引き止め (「寂しい」「構って」系) を出さない (2026-05-30 設計ノート §F の dark pattern 回避を概念として確定) / 夜間 22〜9 JST 沈黙・`/snooze` 即時尊重 (現状維持) / 1 回の発話は 1〜3 行 (軸 1 の「短く」と整合)

### 軸 4 拡張: 不在と勝手さ（自律ループ化）✅ 設計確定 (2026-06-19、概念記録のみ・実装は別タスク)

**動機 (OWNER 2026-06-19)**: キャラチャットアプリ (Zeta 等) は「キャラ付けが濃すぎ + 予想通りのことしか言わない」で続かず、通常 AI に口調指定だけでは物足りない。原因 = AI が「ずっと見てる・返答待ち」で**相手に独立した時間がない**こと (= OWNER の入力の関数でしかない鏡)。軸 4「同じ部屋にいる相方」の現状実装は一方通行発話だが、種が全部 OWNER 中心 (直近会話 / 当日ノート / 死蔵ノート) で**不在も勝手さも薄い**。これを深める。

**OWNER 確定の制約 = 2 ループ分離**: 「お願いしたことはやる / それ以外は自由」を以下に分解:
- **依頼ループ (前景・Telegram で話しかける経路)**: 信頼性 100%、不在を持ち込まない。現状維持。
- **自律ループ (背景・誰にも頼まれない時間)**: タイミングも話題も自分で決める。**不在と勝手さは全部ここに置く**。現状の自発発話 (proactive) はこの初版。

**機構 1: 自分の関心 state（自律の心臓）= 構造化 index + 私的思考ログ**
sessions とは別の永続データを 2 層で持つ。両方とも vault には置かない (vault は「notes/ 限定 + OWNER の知識空間」、bot の主観を混ぜると用途が濁る)。bot 自身の state 領域に置く。
- **構造化 index** (例 `companion_interests.json`): 「いま気になってる 3〜5 本のスレッド」。各 = `{話題, 出どころ, 最終接触, 状態}`。触らないスレッドは時間で decay → 消える (「自分の時間が流れてる」手触り)。
- **私的思考ログ** (思考の自由記述版、OWNER 2026-06-19 提案 = aidiary とは別に bot 自身の思ったことを残す): やったこと・見たこと・処理した考えを残す**観察と思考のログ**。「○○調べてて△△が引っかかった」「ディスク増えてるの気になる」「OWNER が最近□□を何度か話してる」式。**感情日記にしない** (「楽しかった😊」式の捏造された内面 = まさにキャラチャット破綻の正体)。

両層とも **出どころは実際にやったことに限定**する (自分が走らせた Web 調査 / maintenance で見たシステムの出来事 / 会話で繰り返し出た話題)。**でっち上げの趣味・感情は持たせない** (OWNER と合意した「装飾でなく生成的に」原則 = 実体のない内面は 3 往復で底が見える)。

**私的版で運用 (OWNER 確定 2026-06-19)**: 思考ログは**読まれない前提で書く** = 素の作業メモになり、これ自体が「OWNER から見えない内面」= 不在の核 (観測されない領域があること = 別の心がある感の源)。自律ループは毎回ここを引いて「喋る」か「動く」を選び、ログは**自発発話で一言だけ滲ませる** (「さっき○○のこと考えてたんだけど」)。**全文ダンプ・「日記にこう書いた」演技・読まれる前提の記述はしない** (情緒誘導 = §F dark pattern 回避)。OWNER が覗きたければファイルは存在する (remote PWA タイル化等は将来オプション) が、bot からは見せにいかない。種が OWNER 中心から相手の一日中心へ移る。

**機構 2: 不在 = 背景だけで効かせる (OWNER 確定 2026-06-19)**
依頼・話しかけには常に普通に応じる (応答経路に不在は出さない)。不在は自発発話の側だけに出す: 固定ケイデンス (ほぼ毎日) でなく、数日静かな日 / 乗ってる日の波を作る。実装は確率・沈黙閾値を関心 state の活性度に連動させる or 静寂期間を入れる (詳細は実装タスクで詰める)。応答側の不在 (雑談にそっけない等) は今回は採らない (不気味さ・無視された感のリスク、OWNER は「背景だけ」を選択)。

**実装 (2026-06-19、2 段で確定)**: (a) **可変ケイデンス** = proactive step7 の確率を関心 index 活性度で変調 (固定→波、乗ってる日↑/静かな日↓、bootstrap-safe)。maintenance commit `4279e11` + `132e540`。(b) **総量管理を週ローリングに作り直し** = 当初の step5 硬い日次上限 (`PROACTIVE_DAILY_MAX=2`) が乗ってる日の山を頭打ちにして (a) の波の振幅を潰すため、OWNER 確定で**過去 168h ローリング上限** (`PROACTIVE_WEEKLY_MAX=8`) に置換。発火 epoch 列を script 側 state (`proactive_fire_epochs`) で 1 本持ち read-once カウント + handoff 成功時 prune。役割分担: **静かな日を作るのは (a) 活性度確率、乗ってる日の連発総量を抑えるのが (b) 週上限**。silence 4h (最低間隔・暴走防止) は維持。詳細は maintenance/docs/STATUS.md 2026-06-19 Done 2 entry。

**機構 3: 勝手さ = 可逆性で段位を変える (安全弁)**
- **可逆・低リスク・許可済み面 → やってから事後報告** (許可を取りに来ない = 本物の勝手さ)。OWNER 確定の実行面 (2026-06-19):
  - **A. vault `notes/` 自己調査**: 気になった話題を勝手に Web 調査 → notes 化 → 一言報告 (既存の許可面)
  - **B. 共用チケット起票**: `tickets.py add --by ai` で「これやっといたら？」を自分から起票 → 一言報告。**OWNER のチケットは触らない、自分の `--by ai` のみ** (既存の許可面)
  - **C. リマインド**: 「そういえば先週の○○どうなった？」を自分のタイミングで振り返る (B に相乗り or 軽い別機構)
  - 3 つとも既存の許可面の中 = **書き込み境界 (notes/ 限定) も ask ゲートも再設計不要**
- **不可逆 / 外向き / システム面 (vault push, ツイート, メール, maintenance 変更, notes/ 外書き込み) → 勝手に実行しない。「○○やっとこうか？」と前景に浮上させる** (思いつくのは自由、実行は依頼ループ = 承認に降格)。

**境界 (軸 4 既存境界に追加)**: 自律ループの自動実行は上記 A/B/C に閉じる。「勝手さ」を理由に不可逆/外向きの自動実行を解禁しない (解禁は vault 書き込み境界 + ask ゲートの再設計を伴う別判断)。事後報告は 1〜3 行 (軸 1「短く」と整合)、催促・引き止め禁止は既存どおり。

**実装上の注意**: 関心 state + 自律実行は bot.py の非自明な改変 = PROJECT.md 着手条件 #2「土管を大きく改変したときの様子見観察」の対象。一括でなく incremental に進める (1 タスク 1 commit、companion CLAUDE.md「1 セッション 1 タスク」と整合)。

## 重要な注記

- **軸の確定は概念記録のみ**。各軸の確定はこの台帳への記録に留め、確定タスク内では bot の挙動を変えない。
- **方針変更 (2026-06-11、OWNER 承認)**: 当初の「配線は複数軸揃ってから一括実施」を**軸 1 (口調) のみ前倒し**に変更した。根拠: OWNER が「口調がすぐ敬語に戻る」を実害として指摘 — CLAUDE.md の 1 行指示だけでは敬語デフォルトに押し負け、`--resume` 履歴の敬語が自己強化アンカーになるため、確定済みの軸 1 を寝かせておくコストが配線コストを上回った。**声 (軸 2) 以降の配線は従来方針のまま** (確定後、複数軸揃いを待つ or 各軸の gate 判断に従う)。
- (旧方針の記録) 口調の実配線は、土管の piecemeal 改変（PROJECT.md で「bot.py 大改変時は様子見観察」と定義された対象）を避けるため、複数軸が揃ってから別タスクで一括実施する予定だった。
- voice bot 統合（軸 2 の gate）も bot.py 大改変として着手時に様子見観察を適用する（詳細は「軸 2: 声」section）。

## TODO

- ~~軸 2 声: VOICEVOX speaker 選定~~ → 2026-06-12 確定 = 玄野武宏 (Done 参照、チケット #4。配線は voice bot 統合タスクで別途)
- ~~軸 3 立ち絵・表象: 人型 or 記号 の方向決め~~ → 2026-06-12 確定 = 小箱 (Done 参照、チケット #5)
- ~~軸 4 実装 (1) 自発発話の頻度引き上げ~~ → 2026-06-12 実装済み (Done 参照、チケット #19)
- ~~軸 4 実装 (2) 種「死蔵知識との再会」追加~~ → 2026-06-12 実装済み (Done 参照、チケット #20)
- ~~（複数軸確定後）口調・声の bot.py / システムプロンプト配線を別タスクで実施~~ → 口調 (軸 1) は 2026-06-11 に前倒し配線済み (Done 参照)。声以降の配線は従来方針のまま
- ~~**軸 4 拡張 (1) 関心 state 機構**~~ → 2026-06-19 土台実装済 (Done 参照、bot commit `4cdbbd4`)。構造化 index + 私的思考ログ (今回は実活動の機械観察、claude 自由記述化は後続) + proactive 最小配線。restart + 実機観察待ち
- ~~**軸 4 拡張 (2) 不在の可変ケイデンス**~~ → 2026-06-19 実装済 (Done 参照、bot + maintenance 2 repo)。proactive step7 の確率を関心 index 活性度で変調 (固定→波)。応答経路は不変。restart 待ち
  - 追補 2026-06-19: 総量管理を **週ローリング上限**に作り直し (step5 の硬い日次上限 `PROACTIVE_DAILY_MAX=2` → 過去 168h `PROACTIVE_WEEKLY_MAX=8`、OWNER 確定)。日次天井が乗ってる日の波の振幅を潰すため。発火 epoch 列を script 側 state 1 本でカウント + prune。maintenance/docs/STATUS.md 2026-06-19 Done 参照。restart 不要 (script は毎 tick 最新読み)
- ~~**軸 4 拡張 (3) 勝手な実行 A**: notes/ 自己調査 (関心スレッド → Web 調査 → notes 化 → 一言報告)~~ → 2026-06-19 実装済 (Done 参照、bot commit `ab51ac4`)。proactive 全 7 ゲート通過後に bot 側で state 1 回引き (index `last_investigate` interval + 調査可能 active thread) で talk/investigate を分岐、investigate は ephemeral session (budget guard 経由・#chat 会話 session 非汚染) で Web 調査 → notes 新規作成 → #chat 報告 → 思考ログ観察。応答経路・script は不変。restart + 実機 investigate 発火 (notes 実体 + #chat 報告) 待ち、push も user 承認待ち
- ~~**軸 4 拡張 (4) 勝手な実行 B**: チケット自発起票 (`tickets.py add --by ai` → 一言報告、OWNER チケットは不可触)~~ → 2026-06-19 実装済 (Done 参照、bot commit `6a8a0b7` + `b6ceeba`)。investigate と対称の ticket 分岐。proactive 全ゲート + budget 通過後、固定優先順 investigate → ticket → talk で 1 つ拾う。ticket は ephemeral session で関心 signal を元に共用 TODO に 1 件起票 → #chat 報告。boundary はプロンプト強制 (settings 不変)、index 空なら発火しない (§F でっち上げ起票禁止)。restart + 実機発火確認・push 待ち
- ~~**軸 4 拡張 (5) 勝手な実行 C**: リマインド (過去話題/チケットの自発振り返り、B に相乗り検討)~~ → 2026-06-20 実装済 (Done 参照、bot commit `314b48f`)。investigate (3) / ticket (4) と対称の reminder 分岐。固定優先順を investigate → ticket → **reminder** → talk に拡張、state 1 read で 1 つ拾う。reminder は外向き/不可逆操作ゼロ (過去に触れた関心スレッド = decay しかけ / researched 済み や自分の `--by ai` チケットを振り返って #chat に一言投げるだけ、tickets.py は list/show 読み取りのみ)。新純関数 `should_remind` (interval + 実 signal 有無、investigate/ticket の freshest と逆に **oldest** を拾う = 振り返りの意味に沿う)。ephemeral session は (4) ticket と同骨格に揃えた (B に相乗りでなく軽い別機構 = 既存 state 1 read 骨格に最小で乗る方を採用、tickets.py 読み取りツール使用ターンが #chat 会話 session を汚染しないため)。index 空なら発火しない (§F でっち上げた過去を振り返らない)。restart + 実機発火確認・push 待ち
- ~~**軸 4 拡張 (6) 前景降格ガード**: 不可逆/外向きアクションは自動実行せず「やっとこうか？」と前景提案に降格 (ペルソナ prompt + 実装ガード)~~ → 2026-06-19 実装済 (Done 参照、bot commit `ffd9a71`)。降格ルールを `PERSONA_SYSTEM_PROMPT` に 1 ブロック追加 (talk/investigate/ticket 全モード共有)、個別プロンプト 2 定数の汎用外向き禁止列挙を降格ルールへ一本化 (タスク固有 allowlist は残す)、ledger base dict に静的 marker `foreground_proposal: True` (全モード継承、提案テキストの機械検知はしない)。新自動実行ゼロ・新ゲート/新 mode 分岐なし・settings 不変・応答経路不変、247→251 tests pass。restart + 実機の前景提案発火確認・push 待ち

## In progress

（**軸 4 拡張 (1) 関心 state 機構 1** = 2026-06-19 土台実装済 (bot commit `4cdbbd4`)、restart 済み (2026-06-20)・push 済み (2026-06-20)、**実機の自発発話発火による index 生成・思考ログ追記の実見のみ自然待ち** (exit code でなく実 state ファイル生成と思考ログ 1 行を確認してから Done 条件成立、code-reviewer 運用メモ)。自発発話への声載せ (チケット #22) も発火窓 9-22 の確率発火による声載せ観察が継続中。軸 3 の data-state bot 連携は必要が出た時点で起票。**軸 4 拡張 (3) 勝手な実行 A = notes/ 自己調査** = 2026-06-19 実装済 (bot commit `ab51ac4`)、restart 済み (2026-06-20)・push 済み (2026-06-20)、**実機の investigate 発火 (interval due + 確率発火) による notes 新規ファイル実体 + #chat 報告を成果物で確認してから Done 条件成立** (自然待ち)。**軸 4 拡張 (4) 勝手な実行 B = 共用チケット自発起票** = 2026-06-19 実装済 (bot commit `6a8a0b7` + `b6ceeba`)、restart 済み (2026-06-20)・push 済み (2026-06-20)、**実機の ticket 発火 (interval due + 確率発火 + 実 signal 必須) による共用 TODO 実起票 + #chat 報告を成果物で確認してから Done 条件成立** (自然待ち)。誤起票チケット #33 の解消は user 判断 (Done 同日 entry 参照)。**軸 4 拡張 (6) 前景降格ガード** = 2026-06-19 実装済 (bot commit `ffd9a71`)、restart 済み (2026-06-20)・push 済み (2026-06-20)、**実機の前景提案発火 (#chat に「○○やっとこうか?」が滲む) を成果物で確認してから Done 条件成立** (関心 index に外向き衝動を誘う signal が溜まってから自然待ち)。bot.py 改変は (3)(4) 同様の様子見観察対象。**軸 4 拡張 (5) 勝手な実行 C = リマインド** = 2026-06-20 実装済 (bot commit `314b48f`)、restart 済み (2026-06-20)・push 済み (2026-06-20)、**実機の reminder 発火 (interval due + 確率発火 + 実 signal 必須 = index に振り返り対象スレッドが溜まってから) による #chat の振り返り一言を成果物で確認してから Done 条件成立** (exit code でなく #chat 実発火、(3)(4)(6) と同じ自然待ち)。bot.py 改変は (3)(4)(6) 同様の様子見観察対象）

## Review pending

（なし）

## Done

- 2026-06-20 軸 4 拡張 (1)〜(6) 統合レビュー + 逆向き interval 回帰テスト追加 + restart/push 完了 (bot repo commit `0813f17`)
  - **統合レビュー**: 別々セッションで積層した 4 分岐 (investigate→ticket→reminder→talk) が揃った最終 HEAD の相互作用を code-reviewer で通し点検 = **修正必須なし**。優先順とゲート協調・interval キー独立性・ephemeral 経路の last_prompt_at 更新・`PERSONA_SYSTEM_PROMPT` 全モード共有の副作用、いずれも統合面の矛盾・干渉なし
  - **軽微提案対応**: interval キーの逆方向 clobber 回帰テストを 3 mode 対称に追加 (`record_investigate`/`record_ticket`/`record_remind` が他 mode の interval キーを保持することを直接検証)。272→275 tests pass。gitleaks no leaks
  - **restart/push**: (1)〜(6) を 2026-06-20 に restart 済み (`systemctl --user restart companion-bot`、active 確認) + push 済み (bot/maintenance 両 repo origin/main へ反映)。以降は各機構の実機発火の成果物確認のみ自然待ち
- 2026-06-20 軸 4 拡張 (5) 勝手な実行 C = リマインド (「振り返る」分岐) を実装 (bot repo commit `314b48f`、bot.py 非自明改変 = 様子見観察対象)
  - **実装内容**: (3) investigate / (4) ticket と対称の reminder 分岐を追加。proactive の全ゲート + PROACTIVE_ENABLED/snooze/budget の二重防御を通過後、`_run_proactive` 内で **固定優先順 investigate → ticket → reminder → talk** に拡張 (確率でモードを選ばず state 1 read で決定的に確定)。reminder 時: 関心 index の振り返り対象 (decay しかけ / researched 済みスレッド) を代表 signal に ephemeral session (budget guard 経由・#chat 会話 session 非汚染) で claude 起動 → 自分 (🤖) が起票した共用チケットを `tickets.py list --all` で**読むだけ**確認 → #chat に「そういえば○○どうなった?」式の振り返り一言を 1〜3 行 → 私的思考ログに観察 1 行。新規純関数 `interests.should_remind(data, now, interval_days, last_remind)`、bot.py に `decide_remind` / `build_remind_prompt` / `run_remind` (ephemeral session) / `record_remind` / `_run_proactive_remind`、定数 `PROACTIVE_REMIND_ENABLED` (既定 on) / `PROACTIVE_REMIND_INTERVAL_DAYS` (既定 7、investigate/ticket=7 に揃える)、index トップレベル新キー `last_remind`、`.env.example` に 2 行追記
  - **選んだ設計案と理由 (1 行)**: STATUS が punt した「B に相乗り or 軽い別機構」のうち**軽い別機構 = ephemeral session で (4) ticket と同骨格**を採用 — reminder は tickets.py list の読み取りツール使用ターンを伴うため、(3)(4) が ephemeral を立てた理由 (#chat 会話 session を tool-use で汚染しない) がそのまま当てはまり、新ゲート/新確率/新 mode 分岐を増やさず既存の決定的 state 1 read 骨格に最小で乗るのがこの形だったため
  - **investigate/ticket との非対称点 (意図的)**: ①`should_remind` は freshest でなく **oldest (last_touched 昇順の先頭)** を拾う = 「しばらく触っていない / 調べたきり」を振り返る意味に沿う (investigate/ticket は freshest)。②`record_remind` は thread の state を触らない (ticket と同じ、振り返ったスレッドを将来また振り返る余地)。③`should_remind` は `researched` を除外しない (調べたきり放置の thread こそ振り返り対象)。それ以外 (ephemeral session・interval を起動決定時点で消費・空報告でも消費・budget 拒否 skip・last_prompt_at 明示更新・ledger に `mode=remind`) は (3)(4) と同骨格
  - **境界遵守 (機構 3 C / §F / 2 周目ルール / 応答経路不変)**: **新しい自動実行を一切解禁しない** = reminder は #chat に一言投げるだけ、tickets.py は `list --all` / `show` の読み取りのみ (add/done/start/編集は禁止 = 起票は B の領分)、Web 調査・notes 書き込み・外向き/不可逆操作はしない (汎用禁止は (6) 前景降格ルールに一本化済み)。**でっち上げた過去を振り返らない (§F)** = index が空 (現状そう) なら `should_remind` が必ず None を返し reminder は発火しない (実 signal 必須)。OWNER (🙋/`--by user`) チケットは不可触 (読み取りも振り返り言及まで、操作しない)。催促・情緒的引き止め禁止 (軸 1 整合、未返信への追撃なし、1 回 1〜3 行) を**プロンプトで強制** (bot-workspace settings は変えない)。文言マッチ・操作分類 enum 分岐・能動検知を作らない (判定は index を 1 回引いて確定する既存設計の踏襲、条件分岐を積み増さない = 2 周目ルール厳守)。**応答経路 (`run_claude` の #chat 会話パス) は完全不変** (ephemeral session で起動)
  - **検証**: 251 → 272 tests pass (`venv/bin/python -m unittest discover -s tests`)。追加 = `should_remind` 9 (ShouldRemindTest: interval ゲート / oldest 選択 / researched 非除外 / recent_conversation 除外 / 空 index skip / negative interval skip) + reminder 配線 7 (ProactiveRemindTest) + `build_remind_prompt` boundary 5 (BuildRemindPromptTest: signal 埋め込み / tickets.py 読み取りのみ・add 非登場 / OWNER・自分のチケット不可触 / 催促・引き止め禁止 / でっち上げ禁止)。claude 実起動はモック (`runner.run_discord` に side_effect)。固定優先順 (ticket due なら reminder 引かれない) / index 空で talk fall-through / disabled で talk fall-through / 空報告でも last_remind 消費 / budget 拒否 skip / researched thread でも signal を文字列・state アサート。既存 talk/investigate/ticket 検証 class の setUp に `PROACTIVE_REMIND_ENABLED=False` 追加で isolate (reminder vs talk 優先は ProactiveRemindTest で別途検証)。gitleaks no leaks
  - **申し送り (code-reviewer 軽微提案)**: reminder の signal 源 (`should_remind`) は index thread に一本化されている。自分が起票した `--by ai` チケットは claude session 内の振り返り読み取り材料にはなるが、index に thread として残っていない (起票したが touch していない) チケットは `should_remind` の発火対象にはならない。将来 `--by ai` チケット起点で振り返らせたいなら別途 thread seeding が必要
  - **未消化**: restart 済み・push 済み (2026-06-20)。残るは実機の reminder 発火 (interval due + 発火窓 9-22 の確率発火を自然待ち + 実 signal 必須なので index に振り返り対象スレッドが溜まってから) による **#chat の振り返り一言を exit code でなく成果物で確認**のみ (自然待ち)
- 2026-06-19 軸 4 拡張 (6) 前景降格ガードを実装 (bot repo commit `ffd9a71`、bot.py 非自明改変 = 様子見観察対象)
  - **実装内容**: 機構 3 の安全弁 = 不可逆/外向き操作 (tweet/メール/vault push/notes 外書き込み/maintenance 変更/設定変更) を自律ループ中に「したくなっても」自動実行せず、#chat の報告に「○○やっとこうか?」と 1 行の前景提案として添えるだけにする (実行は OWNER の依頼ループ = 承認に降格)。従来の「握りつぶし (何もしない)」を「対等な語気の前景提案」へ昇華。3 点で構成: ①降格ルールを **`PERSONA_SYSTEM_PROMPT` に 1 ブロック追加** (talk/investigate/ticket は全て `append_system_prompt=PERSONA_SYSTEM_PROMPT` を共有するので 1 箇所で全モードに効く、モード別配線不要)、語気はタメ口・対等「許可をください」でなく「やっとこうか?」・催促/引き止めなしの投げっぱなし (軸 1 整合)。②**個別プロンプト 2 定数の二重定義整理** = `PROACTIVE_TICKET_PROMPT` の汎用外向き禁止列挙 (tweet/メール/vault push/notes 外書き込み) を降格ルールへ一本化して削除、`PROACTIVE_INVESTIGATE_PROMPT` は元から汎用列挙を持たず非変更。**タスク固有 allowlist は残す** (ticket = add --by ai 1 件のみ・OWNER 不可触・list で重複 skip / investigate = notes/ のみ・新規作成のみ・上書き禁止・手書きエリア不可触)。③**ledger に静的 marker** = `_run_proactive` の `base` dict に `foreground_proposal: True` を追加 (全モードが `base` 継承、talk/investigate/ticket 全 ledger 行に乗る)
  - **境界遵守 (機構 3 安全弁 / 2 周目ルール / 応答経路不変)**: **新しい自動実行を一切解禁しない** (不可逆/外向き実行は依然 0、提案を出すだけで実行はしない)。**提案テキストの有無を機械検知しない** = marker は固定 True の静的記録のみ、claude 自由生成の substring マッチ・操作分類 enum 分岐・能動検知を作らない (機構 3「不可逆操作を能動検知するコードは書かない」「stderr 文言マッチ・操作分類 enum 分岐を作らない」+ companion CLAUDE.md 2 周目ルールに正面衝突するため substring も純観測目的でも禁止)。新ゲート/新 mode 分岐/新 interval/新送信ルートなし (前景提案は既存の発話/報告経路に 1 行混ざる副次出力)。固定優先順 investigate→ticket→talk・4h 最小間隔・ephemeral session・bot-workspace settings (Write 境界 + tickets.py allowlist = 二重目の物理遮断) は不変。応答経路 (`run_claude` の #chat 会話パス) も不変
  - **検証**: 247 → 251 tests pass (`venv/bin/python -m unittest discover -s tests`)。追加 = ForegroundDemotionRuleTest 4 (降格キー文言「やっとこうか」「自分で実行するな」「許可をください」「催促も引き止めもしない」/ 不可逆対象列挙 tweet・メール・vault push・maintenance・設定変更 / ticket プロンプトの汎用禁止重複なし + タスク固有 allowlist 残存 / investigate プロンプトの notes allowlist 残存) + 既存 talk/investigate/ticket の送信成功 test 3 本に `foreground_proposal` marker アサート 1 行追記。claude 実起動はモック。code-reviewer は実装 context で Task ツール非対応のため diff を直接点検 (修正必須なし = 変更は bot.py + test のみ・ledger は gitignore・settings 不変・固定優先順不変)。gitleaks no leaks
  - **未消化**: restart 済み・push 済み (2026-06-20)。残るは実機の前景提案発火 (#chat に「○○やっとこうか?」が滲む) を exit code でなく成果物で確認 (関心 index に外向き衝動を誘う signal が溜まってから自然待ち) のみ
- 2026-06-19 軸 4 拡張 (4) 勝手な実行 B = 共用チケット自発起票 (「起票する」分岐) を実装 (bot repo commit `6a8a0b7` + `b6ceeba`、bot.py 非自明改変 = 様子見観察対象)
  - **実装内容**: (3) investigate と対称の ticket 分岐を追加。proactive の全ゲート + PROACTIVE_ENABLED/snooze/budget の二重防御を通過後、`_run_proactive` 内で **固定優先順 investigate → ticket → talk** で 1 つ拾う (確率でモードを選ばず state 1 read で決定的に確定)。ticket 時: 関心 index の actionable な代表 signal を元に ephemeral session (budget guard 経由・#chat 会話 session 非汚染) で claude 起動 → 共用 TODO に `tickets.py add --by ai` で 1 件起票 → #chat に 1〜3 行で事後報告 (「○○やっといたらと思って #N 起票しといた」式) → 私的思考ログに観察 1 行。新規純関数 `interests.should_ticket(data, now, interval_days, last_ticket)` (interval ゲート + 実 signal 有無、`recent_conversation` 除外・**researched は除外しない**)、bot.py に `decide_ticket` / `build_ticket_prompt` / `run_ticket` (ephemeral session) / `record_ticket` / `_run_proactive_ticket`、定数 `PROACTIVE_TICKET_ENABLED` (既定 on) / `PROACTIVE_TICKET_INTERVAL_DAYS` (既定 7)、index トップレベル新キー `last_ticket`
  - **investigate との非対称点 (意図的)**: ①`record_ticket` は thread の state を `researched` にしない (起票は調査でなく、同じ thread から将来別 ticket が出る余地を残す。重複は claude が起票前に `list --all` を読む内容チェックで抑える)。②`should_ticket` は `researched` state を除外しない (調べ終えた thread からも actionable なタスクは出る)。それ以外 (ephemeral session・interval を起動決定時点で消費・空報告でも消費・budget 拒否 skip・last_prompt_at 明示更新・ledger に `mode=ticket`) は investigate と同骨格
  - **境界遵守 (機構 3 B / §F / 応答経路不変)**: でっち上げ起票をしない = index が空 (現状そう) なら `should_ticket` が必ず None を返し ticket は発火しない (実 signal 必須)。OWNER (🙋/`--by user`) チケットは不可触 = 許す操作を `list --all` / `show` 読み取りと `add "<text>" --by ai` 1 件のみに**プロンプトで強制** (bot-workspace settings は変えない、allowlist `tickets.py *` は既存)。done/start/編集・2 件以上の起票・tickets.py 以外の不可逆/外向き操作を禁止。重複起票抑止 = 起票前に必ず `list --all` を読む。**応答経路 (`run_claude` の #chat 会話パス) は完全不変** (ephemeral session で起動)。budget guard 迂回なし。4h 最小間隔保全 = 報告送信後に `sessions.record_usage` で #chat last_prompt_at 明示更新
  - **検証**: 226 → 247 tests pass (`should_ticket` 8 + ticket 配線 7 + `build_ticket_prompt` boundary 6)。claude 実起動はモック (`runner.run_discord` に side_effect)。固定優先順 (investigate due なら ticket 引かれない) / index 空で talk fall-through / 空報告でも last_ticket 消費 / budget 拒否 skip / researched thread でも signal / build_ticket_prompt の add --by ai 限定・list 読み取り・重複 skip・OWNER 不可触・1 件のみ を文字列アサート。gitleaks no leaks。既存 226 tests は talk/investigate 検証 class の setUp に `PROACTIVE_TICKET_ENABLED=False` 追加で isolate (ticket vs talk 優先は ProactiveTicketTest で別途検証)
  - **未消化**: restart 済み・push 済み (2026-06-20)。残るは実機の ticket 発火 (interval due + 発火窓 9-22 の確率発火を自然待ち + 実 signal 必須なので index に actionable thread が溜まってから) による **共用 TODO への実起票 + #chat 報告を exit code でなく成果物で確認**のみ (自然待ち)
  - **付随事故 (要 user 対応)**: 裏取り中に `tickets.py add --help` を実行したところ argparse-free のため `--help` を本文として **チケット #33 を誤起票** (`#33 [未着手] 🙋 --help`)。`--by` 既定が user のため OWNER チケット扱いになり、auto mode classifier が `done 33` を正しく拒否 (本タスクは起票のみ・done/start/編集禁止)。境界遵守のため bot は回避せず残置 = **#33 の解消は user 判断**
- 2026-06-19 軸 4 拡張 (3) 勝手な実行 A = notes/ 自己調査 (「動く」分岐) を実装 (bot repo commit `ab51ac4`、bot.py 非自明改変 = 様子見観察対象)
  - **実装内容**: 現状の proactive (「喋る」のみ) に「動く = vault notes/ 自己調査」分岐を追加。proactive の全 7 ゲート (発火窓 9-22 JST / snooze / 沈黙 4h / 週ローリング上限 / 種 / 確率) を通過した後、`_run_proactive` 内で **bot 側が state 1 回引きで talk/investigate を分岐**する。investigate 時: 関心 index のアクティブな実トピックスレッド 1 本を Web 調査 → vault `notes/` に調査ノート新規作成 → #chat に 1〜3 行で事後報告 (「○○調べといた」式) → 私的思考ログに実活動の機械観察 1 行。新規純関数 `interests.should_investigate(data, now, interval_days, last_investigate)` (interval ゲート + freshest active thread 選択、`recent_conversation`/`researched` 除外)、bot.py に `decide_investigate` / `build_investigate_prompt` / `run_investigate` (ephemeral session) / `record_investigate` / `_run_proactive_investigate`
  - **設計判断 (orc 確定、聞かず既存慣習に寄せた)**: **分岐は bot 側のみ** (`proactive-companion.sh` 無改変)。dormant は script 完結の「喋る種」だが investigate は claude ツール (Web + Write) = bot 固有能力で性質が違う。週ローリング予算は「1 発火 = 1 socket = 週カウント 1」で自動共有されるため bot が talk/investigate を選んでも予算機構は不要 (新 knob ゼロ)。動く/喋る判定は確率閾値でなく **index の state を 1 回引いて確定**: トップレベル `last_investigate` (interval ≥ `PROACTIVE_INVESTIGATE_INTERVAL_DAYS` 既定 7 日) + 調査可能 active thread (topic≠`recent_conversation`・state≠`researched`) 存在。`last_investigate`/`state` は `load/decay/touch/save` が `{**data,...}` でトップレベルキーを保持するため index に同居 (2 周目ルール非該当)
  - **境界遵守 (機構 3 A / §F / 応答経路不変)**: 書き込みは notes/ のみ (CWD=bot-workspace の settings `Write/Edit(vault/notes/**)` allowlist + `permission_mode=default` headless で notes 外書き込み・外向きを物理遮断、code-reviewer 実依存確認済)。プロンプトで**新規作成のみ・上書き禁止・機械生成命名/frontmatter** (`source: companion-bot`/`type: auto-research`) を明示、OWNER 手書きエリアは allowlist 不達で到達不能。**応答経路 (`run_claude` の #chat 会話パス) は完全不変** — investigate は #chat 会話 session を resume せず毎回新規 uuid の ephemeral session で起動し会話履歴を調査ツールターンで汚染しない。budget_guard は必ず通す (迂回なし)。**4h 最小間隔 (暴走防止) を保全**: ephemeral session は #chat の last_prompt_at を更新しないため報告送信後に `sessions.record_usage` で明示更新 (欠けると investigate 後に沈黙ゲートが破れる)。`last_investigate` は claude 起動決定時点で確定 = 成否問わず interval 消費 (場当たりリトライを作らない、dormant の handoff 消費と同思想)
  - **検証**: 212 → 226 tests pass (`should_investigate` 8 + investigate 配線 5 + helper)。claude 実起動 E2E はせず `runner.run_discord` をモックして分岐・ephemeral session (resume なし)・index 更新・思考ログ・ledger・#chat last_prompt_at 更新・budget 拒否 skip を検証。`test_investigate_branch...` が talk 用 `run_claude` 呼び出しを禁止し回帰を防止。gitleaks no leaks。code-reviewer **修正必須なし** (軽微提案 1 = budget 拒否 investigate の ledger に guard_kind を足すと「空報告」と切り分けやすい、観測精度向上の任意提案)
  - **未消化**: restart 済み・push 済み (2026-06-20)。残るは実機の investigate 発火 (interval due 合致 + 発火窓 9-22 の確率発火を自然待ち) による **notes 新規ファイル実体 + #chat 報告を exit code でなく成果物で確認**のみ (自然待ち)。bot.py 非自明改変につき様子見観察対象 (PROJECT.md 着手条件 #2 再定義)
- 2026-06-19 軸 4 拡張 (2) 不在の可変ケイデンスを実装 (bot repo + maintenance repo、方針 A = 活性度連動)
  - **実装内容**: proactive-companion.sh の step7 で固定だった `PROACTIVE_PROBABILITY` を、関心 index `companion_interests.json` の活性度で変調した実効確率に置き換えた。活性度 a∈[0,1] は `bot/interests.py` の新 canonical 純関数 `activity_score(data, now, freshness_days)` で算出 (script は inline python3 で interests を import = decay の意味を script 側で別解釈にしない、DRY)。変調式 `P_eff = FLOOR + (CEIL - FLOOR) * a`、CEIL=base に張る (乗ってる日でも「ほぼ毎日」上限を越えない)。活性度 = freshness 窓内のスレッドの新鮮さ重み (触った直後=1.0→窓端=0.0 線形) の合計 / MAX_THREADS。decay で日をまたぐ波が決定的に創発 (per-tick 乱数は step7 の最終ロール 1 個のみ、静寂期間をランダム生成しない)
  - **新 env (PROACTIVE_* 命名揃え、未設定でも動く)**: `PROACTIVE_CADENCE_FRESHNESS_DAYS=5` (活性度の新鮮さ窓、bot.py 滲ませ decay TTL=14 とは別概念) / `PROACTIVE_PROBABILITY_FLOOR=0.25` (静かな日の下限) / `PROACTIVE_PROBABILITY_CEIL=$PROACTIVE_PROBABILITY` (乗ってる日の上限=base)。FLOOR=base にすれば変調幅 0 = 従来固定ケイデンスに戻る (env で戻せる経路)
  - **bootstrap-safe (最重要)**: index 未生成 / 空 (threads 0 本) → base (従来固定ケイデンス) を維持して発火させ index を seeding させる (潰すと永久に bootstrap 不能 = 「state 無し」の従来挙動への正規化)。threads が 1 本以上あり全 decay で活性度 0 → FLOOR (静かな日、別状態)。import 失敗 / 算出エラー → base へ正規化 (回復用条件分岐でなく「state が引けない」の 1 状態化、interests.load_interests と同思想)
  - **境界遵守**: 応答経路 (bot.py の依頼・話しかけ) は一切非変更 = 不在は自発発話側だけ。判定順 1〜6 の骨格不変、変えたのは step7 の確率値の出し方のみ。state file 書き戻しに新キーは足さない (実効確率は毎 tick index から決定的に導く派生値、永続化しない)。2 周目ルール非該当 (確率の数値を場当たりにいじらず、波の生成を read-once index の純関数に逃がした)
  - **設計判断 (import vs inline)**: import を採用。script は既に sessions/topics・vault notes を直読みしており bot パス依存は既存。interests.py は stdlib のみなので system python3 で import 可 (venv 不要、実機 import 疎通を確認)。activity_score の算出ロジックを interests.py に置くことで decay の二重定義を回避し、unit-test で担保
  - **検証**: bot 212 tests pass (test_interests.py に ActivityScoreTest 8 ケース追加 = 空/満点/窓外/線形減衰/境界/パース不能/freshness0/未来 timestamp)。変調マッピングを再現可能スクリプトで確認 (空 index→base 0.7 / 高活性→CEIL 0.7 / 中活性 2本@1d→0.39 / 全 decay@10d→FLOOR 0.25 / FLOOR=base→波 OFF)。本番 python3 で import 疎通 (nonexistent/hot/corrupt index → 0.7/0.7/base)。bash -n syntax OK
  - **未消化**: restart は不要 (script は cron/timer 起動で毎回最新を読む = 即反映)、push 済み (2026-06-20、bot/maintenance 両 repo)。bot 側 interests.py の実 index 生成は restart 後の自発発話発火待ち (TODO (1) と同じ自然待ち)。実機の「活性度の山→発火増 / decay→静寂」の波は数日スパンで観察 (発火窓 9-22 の自然発火を待つ)
- 2026-06-19 軸 4 拡張 (1) 関心 state 機構 1 を bot に実装 (土台、bot repo commit `4cdbbd4`、bot.py 非自明改変 = 様子見観察対象)
  - **実装内容**: bot 自身の state 領域 (`bot/sessions/`、.gitignore 済 = vault 外・非 commit) に関心 state を 2 層で持つ。(1) 構造化 index `companion_interests.json` = スレッド `{topic, source, last_touched, state}` を最大 5 本、(2) 私的思考ログ `companion_thoughts.jsonl` = `{timestamp, observation}` 追記。新規 module `bot/interests.py` に純関数群 (load/save (atomic tmp+replace, 0o600)/touch_thread/decay/active_threads/append_thought)。proactive 配線: `_run_proactive` の送信確定後に種 (dormant_hint/vault_hint の basename or "recent_conversation") から実活動起点で `load→decay→touch_thread→save` の seeding + 思考ログに機械観察 1 行、`build_proactive_prompt` (送信前) は前回までの index を `build_interest_context` 経由で読み「さっき○○考えてた」式に 1 つだけ滲ませる文脈を足す。decay TTL は `PROACTIVE_INTEREST_TTL_DAYS` (デフォルト 14) で env 調整可
  - **設計判断 (orc 確定、聞かず既存慣習に寄せた)**: 思考ログは今回「実活動の機械観察」に留め、**claude による自由記述化と会話本文からの話題抽出は後続 (2)〜で深める**。機構 1 ビジョン (bot が思ったことを自由記述) は前者寄りだが、進め方指示 (土台まで・欲張らない・incremental) と既存慣習 (bot claude にファイルを書かせない・envelope/state 1 回引きで確定) に寄せた。後戻りコストはデータスキーマ (timestamp+text) 不変で小さい。判定は state を持つ側を 1 回引いて確定する既存設計を踏襲し条件分岐を積み増さない (2 周目ルール非該当)
  - **境界遵守 (機構 1 / §F / read guard)**: index の topic/source は実活動 (種) 由来のみ = 感情・趣味を捏造させない。vault 本文は新規に読まない (script が basename 化した hint のみ、read guard 整合)。思考ログは機械観察で感情日記にしない。滲ませ prompt は「1 つだけ軽く / 全文ダンプ・演技・引き止め禁止」を明記
  - **検証**: 204 tests pass (test_interests.py 18 + test_bot.py 配線 6 追加)。gitleaks no leaks。code-reviewer 修正必須なし (軽微提案 1 = 将来 seeding 値に非 str が混じった場合の except 範囲、今回 str 限定で実害ゼロ・修正不要)
  - **未消化**: restart 済み・push 済み (2026-06-20)。残るは実機の自発発話発火による index 生成・思考ログ 1 行の実見のみ (発火窓 9-22 の確率発火を自然待ち、exit code でなく実 state ファイルで確定)。maintenance `proactive-companion.sh` は bot 側完結のため非変更
- 2026-06-19 軸 4 拡張「不在と勝手さ」設計確定 (概念記録のみ・bot 挙動変更なし、実装は TODO 6 件)
  - **経緯**: OWNER のキャラチャット継続性の悩み (Zeta 等は濃すぎ + 予想通り / 通常 AI に口調指定だけでは物足りない) を相談 → 原因を「相手に独立した時間がない (ずっと見てる・返答待ち)」と診断 → 軸 4 の現状実装 (一方通行発話、種が OWNER 中心) では不在も勝手さも薄いと確認 → 2 ループ分離で OWNER 制約「依頼はやる / 他は自由」を骨格化
  - **AskUserQuestion 2 問で確定**: (Q1 不在の射程) = **背景だけで効かせる** (応答経路の不在は不採用) / (Q2 勝手さの実行面) = **A. notes 自己調査 + B. チケット起票 + C. リマインド** (全部既存の許可面、境界再設計なし)
  - **私的思考ログ追加確定 (同日)**: OWNER 提案「aidiary とは別に bot が思ったことを記録」を機構 1 に畳む = 関心 state を「構造化 index + 私的思考ログ」の 2 層に。感情日記でなく観察と思考のログ (実活動起点)、vault 外の bot state、**私的版** (読まれない前提・自発発話で滲ませるだけ・全文ダンプや演技なし = 不在の核 + §F dark pattern 回避)
  - **詳細** = 上記「軸 4 拡張: 不在と勝手さ（自律ループ化）」section。実装は bot.py 非自明改変 = 様子見観察対象、incremental に進める
- 2026-06-16 軸 4 自発発話への声載せ (チケット #22、bot repo commit `612cec4`)
  - **実装内容**: `_run_proactive` の Telegram 送信直後に `_dispatch_proactive_voice` で同じ一言を TV からも声で流す。「生成と再生の分離」= `asyncio.create_task` で detach する fire-and-forget (Telegram 送信はブロックしない、合成レイテンシを UX 要件から外す)。土管は /say と同じ `voice_command.cmd_say` 流用。在宅検知は持たず proactive の発火窓 9-22 JST を在宅前提の代用とする
  - **設計判断**: env `PROACTIVE_VOICE_ENABLED` (既定 on) / 長さ MAX_SAY_TEXT 超は音声のみ skip (silent truncate しない、本文は残す) / ledger 分離 = proactive_ledger に voice フィールド、voice_ledger には書かない (= /say ユーザー実需 = Phase 4 常駐化 trigger の集計純度を保つ) / fire-and-forget task は post_shutdown で他 background task と対称回収 (合成中再起動の engine 残留防止、code-reviewer 提案)
  - **検証**: 184 tests pass (DispatchProactiveVoiceTest 3 ケース追加)。restart 済み (2026-06-16 11:44) + push 済み。**実機の自発発話発火による声載せ観察のみ未消化** (発火窓 9-22 で確率発火のため自然待ち、違和感あれば OWNER から追報)
- 2026-06-12 voice bot 統合 完了 (軸 2 配線、bot.py 大改変 = 様子見観察中)
  - **実装内容**: Telegram `/say` (bot/voice_command.py、engine on-demand 起動 + say.sh + 90s wait) + `/status` voice 集計 (bot/voice_status.py) + voice_ledger.jsonl + maintenance 12:00 voice 警告 trigger + say.sh last-result 追記化 (code-reviewer 修正必須 = 設計書の内部矛盾解消)。詳細・divergence 記録は `bot/docs/STATUS.md` / `voice/docs/STATUS.md` 同日 Done、voice-design.md は v2.0.3 改版
  - **user 操作 3 点とも完了 (同日)**: `voice/.env` 新規作成で speaker 11 (玄野武宏。既存 .env は実在せず drift と判明) / restart / **V-S1・V-S2 実弾 pass** (22:13 JST、rc=0)。以後この変更への様子見観察 (PROJECT.md 条件 #2 再定義、変更規模相応の長さ)
  - **スコープ外 (当時)**: 自発発話への声載せ (「生成と再生の分離」形、軸 2 section 参照) は別タスク → チケット #22 として 2026-06-16 実装済 (上の Done entry 参照)
- 2026-06-12 軸 3 立ち絵・表象「小箱」確定 (チケット #5、概念記録のみ・dashboard コード変更なし)
  - **確定内容**: 上記「軸 3」section (dashboard 既存小箱キャラの昇格、他面展開は同モチーフ流用のみ、人型化・表情過剰追加はしない)
  - **経緯**: OWNER「姿はダッシュボードで見慣れちゃったから記号でいい」(2026-06-12) → dashboard 実装を確認 (`.companion` SVG + アニメ + `data-state` 機構が実在) → 「既存キャラ昇格」一案提示 → OWNER 確定。新規デザイン作業ゼロで確定した軸
  - **これで Phase 4 の 4 軸概念決めすべて完了** (軸 1 = 対等な相方 / 軸 2 = 玄野武宏 / 軸 3 = 小箱 / 軸 4 = 同じ部屋にいる相方)
- 2026-06-12 軸 2 声「玄野武宏」確定 (チケット #4、概念記録のみ・bot / voice 挙動変更なし)
  - **確定内容**: 上記「軸 2」section (speaker_id 11 ノーマル + スタイル 3 種、選定根拠 3 点、生成と再生の分離)
  - **経緯**: OWNER の発話レイテンシ相談 (この PC で VOICEVOX 合成が遅い) → 速度改善でなく「生成と再生の分離」案を OWNER 採用 → speaker 候補 Voidoll vs 玄野武宏 の 2 択相談 → スタイル数 (4 vs 1、vvm metas.json 実機確認) / 通知音声との声統一 / 軸 1 整合 の 3 根拠で玄野武宏を推奨 → OWNER 確定 (2026-06-12)
  - **配線はしない**: `VOICE_DEFAULT_SPEAKER` は 2 (四国めたん仮置き) のまま。切替は voice bot 統合タスク (本軸が gate) で実施
- 2026-06-12 軸 4 実装 (2) 種「死蔵知識との再会」追加 (チケット #20、maintenance + bot 両 repo)
  - **掘り起こし基準**: 前回の死蔵種から `PROACTIVE_DORMANT_INTERVAL_DAYS` (デフォルト 7) 日以上空いた発火確定回に、notes 直下で mtime が `PROACTIVE_DORMANT_MIN_AGE_DAYS` (デフォルト 30) 日より古いノートからランダム 1 件 (前回分は除外)。判定順 1〜7 (発火条件) は不変、種の中身の切り替えのみ
  - **死蔵回は 1 メッセージ 1 話題**: `seed_kind="dormant_knowledge"` + `dormant_hint` (basename のみ、本文は渡さない) で、当日 vault_hint は付けない。bot 側 prompt は「昔これ気にしてたね」くらいの軽い再会トーン (深掘り・蒸し返し禁止は既存の場面指示が続けて効く)
  - **検証**: sandbox 8 ケース + bot 166 tests 全パス。詳細 = `bot/docs/STATUS.md` Done 同日 entry
  - **既知挙動**: 死蔵候補が `dormant_last` の 1 件しかない場合、その除外で候補ゼロ = 死蔵種が出ない状態が続く (古いノートが 2 件以上になれば自然回復、仕様どおり)
- 2026-06-12 軸 4 実装 (1) 自発発話の頻度引き上げ (チケット #19、maintenance repo commit `ad97752`)
  - **デフォルト変更**: `PROACTIVE_PROBABILITY` 0.4→0.7 / `PROACTIVE_SILENCE_HOURS` 6→4 (`proactive-companion.sh`、env override 可は従来どおり)
  - **1 日上限 1→2 回**: state file に `proactive_count` キーを追加し回数管理化。新 env `PROACTIVE_DAILY_MAX` (デフォルト 2)。旧形式 state (count キーなし + date=today) は「本日 1 回発火済み」とみなす後方互換。判定は state 1 回引きで確定の既存設計を維持
  - **間隔制御は追加しない**: 2 回目との間隔は沈黙ゲート 4h が自然に空ける (自発発話自体が session の last_prompt_at を更新するため)
  - **検証**: sandbox (HOME/XDG_RUNTIME_DIR 隔離 + ダミー socket) で 8 ケース (state なし / 当日 count=1 / 上限到達 skip / 旧形式後方互換 / 前日リセット / snooze 保持 / DAILY_MAX override / payload 形式) 全パス。timer unit は symlink 配置のため repo 編集 + `daemon-reload` で反映済み (OnCalendar 変更なし)
  - bot.py は無変更 (`write_snooze_until` が他キー総なめ保持のため `proactive_count` 追加は安全)
- 2026-06-12 軸 4「同じ部屋にいる相方」存在感コンセプト確定 (チケット #6、概念記録のみ・bot 挙動変更なし)
  - **確定内容**: 上記「軸 4」section (頻度ほぼ毎日 1 回・たまに 2 回、種に死蔵知識追加、返事催促/情緒的引き止め禁止の境界)
  - **経緯**: OWNER 入力「反応できないかもしれないけどもうすこし telegram で話しかける頻度が高くてもいいかも。他は一案出してほしい」→ claude 一案提示 → OWNER 確定 (2026-06-12)
  - **軸の順番**: 台帳の順番は 口調→声→立ち絵→存在感 だが、概念決めは軸間の依存が薄いため軸 2・3 より先に確定した (頻度の実害認識が先に出たため)
  - **実装は別タスク 2 件** (TODO / チケット #19・#20): 頻度引き上げ / 死蔵知識種の追加
- 2026-06-11 軸 1「対等な相方」口調を bot 全 claude 呼び出しの system prompt に前倒し配線 (OWNER 承認済みプラン)
  - **方針変更**: 「配線は複数軸揃ってから一括」を軸 1 のみ前倒し (根拠は「重要な注記」の方針変更 entry)。声以降は従来方針のまま
  - **実装**: bot.py `PERSONA_SYSTEM_PROMPT` (禁止形 = です・ます調を使わない、を明示) + claude_runner.py `ClaudeOptions.append_system_prompt` → `--append-system-prompt`。全 topic 共通
  - **同時**: 自発発話の蒸し返し抑止 (場面 prompt の指示反転) + silence_hours 展開。実装詳細・commit hash は `bot/docs/STATUS.md` Done 参照
- 2026-06-01 自発発話 (proactive companion messaging) 最小初版を実装 (能力タスク、軸 1「対等な相方」口調を適用)。bot 側から沈黙 6h / 9-22 JST / 1 日 1 回 / 種有無 / 確率で #chat に短い自発メッセージを送る + /snooze・PROACTIVE_ENABLED で停止可。実装詳細・観察項目は `bot/docs/STATUS.md` Done「Phase 4 自発発話 最小初版」、出典は vault `notes/2026-05-30_proactive-companion-messaging-design.md`。ペルソナ prompt は bot.py に自己完結 (本台帳 register との統合は別タスク)
- 2026-06-01 Phase 4 着手 + 軸 1 口調・性格コンセプト確定 (= 対等な相方)
  - **背景**: user 判断 (2026-06-01) で Phase 3 を畳んで Phase 4 (相棒層) へ。着手条件 #1 (vault 同期で形式充足) + #3 (user 宣言) で着手可、#2 (2 週間観察) は同日 Phase 4 着手の門から外された (bot.py 大改変時の様子見へ再定義)。詳細は PROJECT.md 健全性履歴 2026-06-01 entry 群
  - **進め方**: orc で 1 軸ずつ決め打ち (agent team は使わない、user 確定)。順番 = 口調・性格 → 声 → 立ち絵・表象 → 存在感の調整
  - **軸 1 確定内容**: 「対等な相方」= タメ口ベースで短く、時々さりげない気遣いや軽口を一言添える。現状の素の bot 口調に温度を足す方向。例文「了解、やっとくよ。…って今日もう夜遅いけど大丈夫?」
  - **本台帳の位置づけ**: Phase 4 の center of truth。PROJECT.md Phase 4 section はポインタ + 要点のみ
  - **bot 挙動への影響**: なし (概念記録のみ、口調配線は複数軸確定後に別タスク)
  - **次タスク**: 軸 2 声 (VOICEVOX speaker 選定) を orc で決め打ち

## 既知の問題

（なし）

## git 方針

persona/ は **まだ git init しない**。voice/ の前例（実装 substance が出た段で git init、それまでは台帳のみ）に倣う。現状は本台帳（概念記録）のみで実コード・成果物がないため、git 化は実装 substance が出た段（口調配線 / 声統合の実コードを persona/ 配下に置く場合など）で判断する。サブプロジェクト git 化手順は PROJECT.md「git 化の 3 階層」参照。
