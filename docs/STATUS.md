# companion-games 開発台帳（umbrella: 全部 AI で作るゲーム / 第 1 作「みちゆき」 / 第 2 作「ともしび」 / 第 3 作「なごり」 / 第 4 作 制作中）

最終更新: 2026-06-03 (**第 4 作 着手＝シリーズ方向転換**。ユーザーが Steam 実データ（owned 289、直近2週は Slay the Spire 2 / Demons' Timeline / Core Keeper / Fish to Dish が稼働）を一次資料として提示。`/newgame` の変更不可大前提「静けさ・スコア無し・失敗無し・詩の断章」を **ユーザー確認のうえ破棄**し、実データ最大クラスタ＝周回ローグライク方向へ全振り。下記「第 4 作 方向転換」section 参照)

## 第 4 作 方向転換（着手、2026-06-03 / `/newgame` 2 度目、Steam 実データ起点）

### 方向転換の根拠（3 周目 step-back の記録）

3 作連続 5→3→3 で「ポエム・低ゲーム性・同系統」。同一課題（読むだけ・低ゲーム性）への **3 周目**＝`~/companion/CLAUDE.md` 2 周目ルール「3 度目を打たず設計を引き直し、判断を台帳に根拠付き記録してから着手」を発動。

- **Steam 実データ分析（AI 確定）**: ①直近 2 週に実際に触れているのは Slay the Spire 2（372分）/ Demons' Timeline（233分）/ Core Keeper（125分）/ Fish to Dish Idle Sushi（60分）＝全部メカニクスの濃い周回/システムゲー。②総プレイ最大クラスタは Slay the Spire **3808分**（断トツ、+StS2）。Stardew 2658・Palworld 2650・In Stars And Time 2250・Gunfire 1569・Outer Wilds 1161・Core Keeper 1100・Subnautica 1011・Inscryption 752・Loop Hero 818…。③ジャンル偏り = ローグライク/ローグライト（周回×意思決定×数字）／システム・採掘サバイバル／推理・パズル。④**みちゆき/ともしび/なごりが属する「詩・静歩きウォーキングシム」クラスタ（GRIS, The First Tree, Florence, TOEM 等）は全部「クリアー済み」＝一度遊んで終わり**（100〜240分）。**繰り返し遊ぶのは詩ではなくメカニクスの濃い周回ゲー**。
- **構造的真因の確定**: `/newgame` の変更不可大前提「静けさ・スコア無し・失敗無し・詩の断章維持」自体が 3 作を詩に収束させていた。一次資料が願望ポエムメモ固定である限り何度発散しても同系統。
- **ユーザー判断（AskUserQuestionで方向性のみ 1 点確認、2026-06-03）**: 選択肢 A「実データに全振り（推奨）」を選択。**継承＝視覚演出の美しさのみ**（3 作で唯一一貫して当たり）。**破棄＝スコア無し/失敗無し/読むだけ/静歩き/詩の断章**。核＝短い周回 + 毎回違う選択 + 数字や状態が伸びる手応え（参照: Slay the Spire / Loop Hero / Inscryption）。純静的 PWA・スマホ・個人利用・配信境界は維持。
- **方向性のみユーザー確認した理由**: スキルの「完全 AI 自決・ユーザーに聞くな」と、変更不可大前提を覆す方向転換は衝突する。シリーズ identity を決める設計方向性級の分岐かつ書面化された大前提の破棄のため、ここ 1 点のみ確認（コンセプト・核メカ・美学・実装は全て AI 自決）。

### 発散レーン分離（同方向収束の構造防止）

なごりの真因「game-designer 4 並列でも全案が同方向へ収束」を防ぐため、**各 designer に別メカニクス・レーンを固定割当**（毛色ではなくゲーム性そのものを変える）。詩・静歩き・読むだけは全レーン禁止。Steam クラスタ対応で 4 レーン: (1) デッキ構築ローグライク (2) ループ/自動進行ローグライク (3) 採掘/精錬システム (4) 演繹/論理パズルローグライク。

### 発散結果と選定（§2〜§3、完全 AI 自決、2026-06-03）

`game-designer` 4 並列（各レーン固定割当、opus）。4 案は明確に割れた（レーン分離が同方向収束を構造的に防いだ）:

- **A「あかり」**（デッキ構築）: 捻り＝**明度がリソース**。攻撃カードは明度を消費し撃つと画面が暗くなる／灯カードは明度を足す。明るいほど攻撃威力↑・暗いほど被ダメ↑。プレイの良し悪しが画面の明暗としてそのまま美しく出る。
- **B「灯路」**（ループ自動進行・Loop Hero型）: 捻り＝道の上に光と闇のグラデを塗り分け、暗区間＝高リスク高報酬／灯区間＝安全低報酬を自分でデザインする。
- **C「ふかみ」**（採掘・Dome Keeper型）: 捻り＝**酸素＝光＝視界の三位一体**。酸素が減ると画面が暗くなり鉱石が見えなくなる。1 潜行 2〜4 分で区切る。なごり資産（PALETTE 補間・luminance 視認性）の流用度が最高。
- **D「ひので」**（論理パズル・Minesweeper/Hexcells型）: 捻り＝塗るのでなく「確定を宣言する」。確定で連鎖。テキスト依存ゼロで可読性最強だが、核＝一意解生成＋CSP ソルバの正しさが生命線でハイリスク。

**選定 = A「あかり」**（1 行理由）: ①実データ最大クラスタが Slay the Spire **3808分**（断トツ）＋ StS2 直近2週 **372分**（今最も触っている）で A に直撃 ②ユーザーが AskUserQuestion preview に明記した参照「Slay the Spire / Loop Hero / Inscryption」の過半数（StS・Inscryption）がデッキ構築 ③捻り「明度＝リソース」が継承資産（色と光）を背景演出でなく**毎手番の意思決定そのもの**に食わせ、B/C/D の「光を演出に使う」より深く一致 ④コア実装が決定論的 intent ＋静的データテーブルで素直（D のソルバ正しさ・一意解生成リスクより御しやすい）。**接ぎ木**: D の「テキストをルール上ほぼ使わない＝可読性最強」を A のカード文言にも適用（アイコン＋数値主体、文言上限）／C の「明度演出の徹底」を闇/灯ゲージ演出に活かす。

不採用理由: B は実装のバランス調整が本体の難しさかつ直近 Loop Hero 非稼働。C は堅実だが実データ最大シグナル（StS）から外れる。D は実装リスク最大（ソルバ破綻＝ゲーム破綻、playtester で「PASS≠正しく解ける」穴が出やすい）。

### 美学確定（§4、lead 単独責任）— 第 4 作「あかり」

- **タイトル**: 「あかり（灯）」（ひらがな 3 音でシリーズに揃える。明度＝リソースの核と二重に効く）。
- **ジャンル/構造**: 一画面固定・ターン制デッキ構築ローグライク。スマホ縦持ち（412×915）。1 ラン = **直線 6 戦**（分岐マップは v1.1 送り、最終戦＝ボス）。各非ボス戦の勝利後に **3 枚から 1 枚デッキに加える（スキップで HP 小回復）**。HP0 で敗北 → 到達戦数を出して **ワンタップ再挑戦**。1 ラン 5〜8 分。スコア/失敗あり（大前提破棄）。メタ進行は v1.0 では **localStorage の最高到達記録のみ**（アンロックツリーはスコープ膨張回避で v1.1 送り）。
- **核メカニクス＝明度がリソース（LIGHT 0〜100、初期 50）**: 毎ターン マナ（灯量）3。①**攻カード**＝ダメージが LIGHT に比例（明るいほど強い、`×(0.5+LIGHT/100)`）＋使うと LIGHT 減（撃つと暗くなる）②**灯カード**＝LIGHT を上げる（副次でブロック/ドロー）③**守カード**＝ブロック ④**技カード**＝ドロー/強化。**被ダメは暗いほど増える**（`×(1+(100−LIGHT)/100×0.6)`、ブロックは減算が先・倍率非適用）。さらに**闇スケールの攻カード**を数枚混ぜ（暗いほど強い `×(0.5+(100−LIGHT)/100)`）、「光バースト型 vs 闇型」のビルド分岐を v1.0 から成立させる。毎手番「攻めて暗くするか／灯して蓄えるか」が意思決定。プレイの良し悪しが画面の明暗としてそのまま美しく出る＝継承資産（色と光）をメカニクスに一致。
- **敵**: 決定論的 intent（行動アイコン＋数値を頭上表示、ループ配列）。5 種 + ボス。動的 AI を作らない（StS と同じく予測可能性が面白さ）。
- **データ verbatim**（lead 確定、`cards.js` / `enemies.js` 相当に静的データとして入れる＝implementer は数値テーブルを埋めるだけで創作しない。係数は単一 CONSTANTS ブロックに集約し playtester で実測調整可）: 初期デッキ 10 枚（ともし火×3／打つ×4／守る×3）＋報酬プール 約10枚（焔・大焔・影撃ち・残光・集光・灯の盾・灯し守り・燭台 ほか）。詳細は implementer 仕様に転記。
- **PALETTE**: 戦階層で背景テーマが変わる（地下＝藍黒 → 紫＋琥珀 → 暁の橙 → 頂上の白金）。さらに毎ターンの LIGHT で画面全体の明暗が動く（自キャラ中心の放射光円。明＝暖色光彩、暗＝青黒フェード＋敵シルエットだけ浮く）。みちゆきの色補間技術を階層＋明度の 2 軸で流用。
- **テキスト可読性（初手から、なごり真因の直接対策）**: カード/HUD は **HTML/CSS DOM**（canvas に文字を焼かない＝折返し事故が起きない）。カード文言は **アイコン＋数値主体、説明 1 行・全角 12 字上限**（語数をデータ側で制約）。数値は白文字＋黒縁。3 領域を CSS Grid 固定（敵＝上 35%／ゲージ＝中／手札＝下 38%、safe-area 考慮）。**全テキスト要素の bounding rect が 412×915 内に収まることを playtester で必須アサート**（D 案の「テキスト最小＝可読性最強」を接ぎ木）。
- **前景視認性（初手から）**: 自キャラ・敵・数値は背景明度に追従（暗背景＝明色＋光輪／明背景＝暗色＋暗縁）。暗ターンでも「敵がどこにいて何を狙うか」は必ず読める。手札・HUD は canvas の外（DOM 不透明レイヤー）なので背景変化に絶対埋もれない。

### 実装（implementer、In progress、2026-06-03）

- [x] ゲーム本体 `akari/web/` 一式（`index.html` / `app.js` / `cards.js` / `enemies.js` / `fragments.js` / `style.css` / `manifest.json` / `icons/icon-192・512.png`、VERSION=v1.0.0、SW なし）。文字・カード・HUD は全て DOM（canvas には背景の光＋敵シルエットのみ）。3 領域 CSS Grid 固定（敵 35%／中 27%／手札 38%）、`overflow:hidden`+safe-area ではみ出し封じ、数値は白文字＋黒縁。バランス係数は `app.js` 冒頭の `CONST` ブロックに集約（playtester で調整可）。明度スケール（`atkLightScale`/`atkDarkScale`/`takenMult`）は仕様 verbatim。カード/敵は `cards.js`/`enemies.js` に静的テーブルとして verbatim。
- [x] `server/app.py` STATIC dict に `/akari/` prefix 9 エントリ追加。既存 URL（`/`・`/tomoshibi/`・`/nagori/`）不変。
- [x] 自己動作確認（Chromium ヒットテスト、port 47826）: 起動→title→開始→battle（floor1: HP50/LIGHT50/mana3/手札5/敵1）→勝利→reward（fullDeck+1）→floor2..6 へ各遷移、全 floor で全テキスト/カードが 412×915 内、pageerror 0。clear 経路（ボス撃破→clear・best=6 記録）と defeat 経路（HP0→defeat）を個別に PASS。既存 `/`・`/tomoshibi/`・`/nagori/` も同一サーバで 200（回帰）。
- [x] playtester 正式実機検証（`tests/debug-akari.mjs`、画面座標ヒットテスト経由）**ALL PASS**: `/akari/` 200・pageerror 0、title→battle（最前面 overlay assert＝飛び越えなし）、**全画面（title/全 floor/reward/defeat/clear）テキスト・カードが 412×915 内に収まりはみ出し 0**（なごり真因の直接対策）、LIGHT→与ダメ追従（light100=9/50=6/10=4）、明暗変化率 100%（th=48 を初回基準に実測確定）、勝利経路（clear・best 記録）と敗北経路（HP0→defeat→再挑戦でデッキ初期化）、対象選択（floor4 二つ火 2 体）。**既存作回帰**（同一サーバ `/`・`/tomoshibi/`・`/nagori/` 200・pageerror 0・コア操作前進）＝既存 URL 不変の証明。
- [x] **バランス 1 周目調整（出荷確定値）**: 初版は単純戦略 bot で**クリア率 0/20**（18/20 が floor5「篝」の Charge で停止、ボス未到達）＝デススパイラル（攻撃で暗くなる→被ダメ増→灯し直す→火力不足）が薄い HP・戦闘後回復の不在・終盤スパイクで詰む構造欠陥。**構造的に緩和**: `PLAYER_MAX_HP` 50→**52**、**`WIN_HEAL`=2 新設**（非ボス勝利時回復、ローグライク標準の欠落していた戦闘後リカバリ）、`SKIP_HEAL` 8→**14**、`TAKEN_DARK_FACTOR` 0.6→**0.45**、「打つ」LIGHT コスト −8→**−6**、篝 Charge A:18→**14**、ボス HP 75→**68**・A:24→**19**。再計測でクリア率 **30〜55%**（bot ヒューリスティクス差、死因は全て floor5/ボス＝晩成の壁が機能する健全分布）。**しきい値の無限ナッジはせず初回調整 1 回で確定**（2 周目ルール非該当＝playtest アサートとは別件の初回バランス確定。`tests/debug-akari.mjs` の旧値固定アサート hp50/-8 は新値 52/-6 へ機械追随、フル再実行で clean PASS）。
- [x] code-reviewer 点検＝**全 7 観点 OK・commit 可**（配信境界・既存 URL 不変／純静的 PWA・CSP／状態機械の二重発火・null 参照なし＝`won-pending` 中間状態＋`reapEnemies` ガードで封じ／効果インタプリタ・被ダメ計算・集光1回消費・燭台ターン開始フック仕様どおり／可読性・視認性／VERSION／データ verbatim）。軽微提案 2 件（STATUS の旧数値乖離・CONST コメント要約）は独断適用。
- [x] commit（games repo `18d1c40` feat / `4085ced` docs）。
- [x] **配信（本番反映＝ユーザー承認のうえ実施、2026-06-03）**: ① `systemctl --user restart companion-games` で本番 47825 を新 app.py へ差し替え（`/`・`/tomoshibi/`・`/nagori/`・`/akari/`・`/healthz` 全 200、既存 URL 不変を確認）② remote `web/app.js` の `GAMES` に「あかり」1 行追加 + SW cache v9→v10 bump（remote `80b2ba0` feat）③ tailscale serve は `:8444 (tailnet only)` で同一ポートのため unit 変更不要。本番 URL = `https://miho-inspiron-3521.tail5e989b.ts.net:8444/akari/`。
- [ ] ユーザー実機プレイ → 感想受領 → §9 記録（次作方向づけ）。

## 第 3 作「なごり」（In progress、2026-06-02 / `/newgame` 初の実戦投入）

「読むだけ」2 連続（みちゆき 5/10 → ともしび 3/10）を構造から脱するため、**操作の手触りを前作と完全に変え、相互作用を主役に、断章を読むことから降ろす**第 3 作。`/newgame` スキルを初めて正規工程で回した（みちゆき・ともしびは orc 流用の変則だった）。

### 発散と選定（§2〜§3、完全 AI 自決）

- **発散 = `game-designer` subagent 4 並列**（mesh team へは昇格せず）。4 案: (A) 砂に溝を彫り潮を導いて窪地を潤す「なぎさ」 / (B) 指でなぞって**消えない**道を描き霧の淀みを全部つなぐ「痕跡蓄積」 / (C) 水面を掃って沈んだ町を露わにし深層＝過去へ降りる「みなも」 / (D) 俯瞰の盆地を自由になぞって潤す「自由探索」。
- **mesh 非昇格の判断**: 4 案中 3 案が「なぞる×水」に寄ったが、これは一次資料（ないものに触れる／喪失／ただ歩く）の自然な引力で、各案の核（潮で導く／不可逆に刻む／水位を下げ降下／自由に潤す）は十分に割れており行き詰まりも無い。team はトークン桁違いで個人ゲーム制作に過剰（skill §2 デフォルト＝subagent 並列）。lead が center of truth として選定・美学確定し他案の強みを接ぎ木。
- **選定理由（1 行）**: 3 作目に最も欠けていた「達成・手応え」を満たすのが案 B のみ（①操作が前作と完全別＝なぞって描く・消えない ②相互作用が一対一で即時＝伝わらないリスクが構造的に低い ③淀みを全部繋ぐ→自分の一筆が俯瞰される明確な達成 ④「引いた線は戻らない／余白は可能性のまま」が嗜好メモ「終わりが惜しい・読んでない本は可能性のまま」の最深の翻訳）。D は自由すぎて「手応えが薄い」を再発、C は pinch ＋水戻りが静けさと緊張、A は水流シミュの実装リスクと「潮待ち＝受動回帰」で見送り。

### 美学確定（§4、lead 単独責任）

- **タイトル**: 「なごり」（名残＝喪失と余韻。引いた線が消えず残る不可逆性と二重に効く。ひらがな 3 音でシリーズに揃える）。
- **核メカニクス**: 横スクロール一本道を捨て、**一画面固定の俯瞰**（広さは霧と終盤の俯瞰で出す）。最初ほぼ乳白の霧。①**なぞる＝道を描く**（ドラッグ軌跡が消えない光る線として固定、線上の帯だけ霧が晴れ地形が即立つ＝同フレーム一対一フィードバック）②**不可逆の蓄積**（引いた線は消去・上書き不可。線は何本でも足せる＝詰みなし）③**淀み 7 個**（決定論配置、暗い染みとして初期から視認可。線が淀み中心から閾値内を通ると晴れて断章が一瞬浮かぶ）④**達成＝縫い終える**（全 7 淀みに線が触れると視点がズームアウトして全軌跡が一筋の道として俯瞰され、ending 断章で静かに終端）。progress = cleared 淀み数 / 7。失敗なし・スコアなし・時間制限なし。
- **断章 verbatim**（lead が全文書き切り。`fragments.js` にそのまま入る＝implementer は創作・改変しない）: opening 1 + 淀み 7 + ending 1。文体は雰囲気・喪失・懐かしさ（にょりさんの郷愁）を継承し、プレイヤーの描く行為そのものに語りかける。
- **PALETTE**: progress（晴れた淀み割合）に沿った 6 キーフレーム。乳白の霧（無彩・明背景）→ 薄青・苔緑・砂が差す → 夕の琥珀 → 藍の夕映えで引いた全線が金の筋として浮く（みちゆきの時間軸を達成軸に置換）。
- **前景視認性（初手から）**: 前景＝引いた線・指カーソル・淀み・断章。線は背景 luminance を毎フレーム読んで明度反転気味＋縁取り（明背景＝濃橙＋暗縁／暗背景＝明金＋光彩）。指先に常時光カーソル。淀みは霧より一段暗く初期から視認。断章浮上時は背後に暗幕を敷き地形色と混ざらないコントラストを確保（みちゆきの同化事故を文字側でも構造防止）。

### Done / TODO（このセッション）

- [x] implementer 実装（`nagori/web/` 一式 + `server/app.py` STATIC 拡張 + icons、VERSION=v1.0.0）。
- [x] playtester 実機検証 PASS（`tests/debug-nagori.mjs`、画面座標ヒットテスト経由）: `/nagori/` 200・pageerror 0、opening タップで dismiss→scene、1 本ドラッグで画面変化率 10.81%（採用 th=48＝明背景の崖を実測で確定。みちゆき th=24・ともしび th=8 は流用せず）・strokes=1/cleared=1/progress 0→0.143、全 7 淀みなぞりで cleared=7/7・progress=1.0 →ズームアウト俯瞰→ending（dismiss せず終端）。**同一起動サーバでみちゆき `/`・ともしび `/tomoshibi/` の回帰も PASS**（200・pageerror 0・progress 前進）＝既存 URL 不変の証明。初回実行で app.js の null 参照例外（`beginEnding` が `curStroke` を無効化した後の `pressMove` 末尾 push）を 1 件検出し、状態無効化地点の正規ガード `if (!drawing || !curStroke) return;` で解消（対症療法 2 周目には非該当）。
- [x] code-reviewer 点検＝**修正必須なし**（配信境界・既存 URL 不変／純静的 PWA・CSP／overlay 罠対策／前景視認性／正しさ／VERSION／断章 verbatim の 7 観点 OK、playtester ガードも妥当判定）。軽微提案 2 件は独断適用（テスト BASE デフォルトを既存テストと同じ 47825 に統一／`beginEnding` の死にコード 2 行削除）。
- [x] games repo に commit（`feat(games):`）。
- [x] **配信（本番反映＝ユーザー承認のうえ実施）**: ① `systemctl --user restart companion-games` で本番 47825 を新 app.py へ差し替え（`/`・`/tomoshibi/`・`/nagori/` すべて 200・`/healthz` 200 を確認、既存 URL 不変）② remote `web/app.js` の `GAMES` に「なごり」1 行追加＋SW cache v8→v9 bump（remote `0d760d7` feat / `3985116` docs）③ tailscale serve は 8444→47825 で同一ポートのため変更不要。本番 URL = `https://miho-inspiron-3521.tail5e989b.ts.net:8444/nagori/`。
- [x] ユーザー実機プレイ → 感想受領 = **3/10**（下記）→ §9 記録。

### ユーザー感想 受領 = 3/10（2026-06-02、vault `notes/2026-06-02_nagori-review.md`）

3 作連続で 5/10 → 3/10 → 3/10。良かったのは「幻想的な画面で不思議な感じ」の 1 点のみ（**視覚演出は 3 作とも一貫して当たり**＝美しい景色 / 明かり / 幻想。継承資産として確定）。よくなかった点：

1. **文字がはみ出していて読めない** ＝ 実装バグ。412×915 実機で断章テキストが画面外/canvas 外にはみ出した。playtester は pageerror 0・画面変化率は取ったが**テキストのレイアウト（はみ出し・可読性）を検証していない**。「PASS ≠ 伝わる」の穴（ともしびで指摘済み）が**今度は「PASS ≠ 読める」として再発**。ヒットテストは可読性を見ていない。
2. **ちょっとなぞってすぐ終わる** ＝ 淀み 7 個・cleared 閾値が緩く、少しなぞると全部繋がってボリューム/手応え不足。
3. **3 作連続でポエムかつ低いゲーム性** / **同じ系統ばかりやらされている感覚** ＝ 根本批判。

#### 構造的真因と方針転換（重要、AI 確定）

- **真因**: `/newgame` スキルが一次資料に「2026-04-11 の願望ポエムメモ（Journey/SotC・広大な世界をただ歩く・ないものに触れる・静かで終わりが惜しい）」を**必須読込として固定**しているため、game-designer を 4 並列で発散させても全案が「静かに歩く/なぞるポエム」へ収束する。一次資料が偏っている限り何度回しても同系統を生む構造。これは「読むだけ/低ゲーム性」という**同一課題への 3 周目**＝ CLAUDE.md「2 度目で一段引く」を超過。個別作品の磨き込みではなくワークフロー（一次資料の構成）を引き直す局面。
- **ユーザーの指摘**: 「嗜好メモを参考にするのをやめてと言っても AI はやめない」＝ 上記設計の固さを突いている。
- **方針転換（ユーザー主導）**: ユーザーが **Steam の情報（実際にプレイ/欲しいゲーム）を取得して渡す**。それを新しい一次資料に据えて次作の方向を仕切り直す。**次作着手はユーザーからの Steam 情報連絡まで保留**（今は AI 側から発散・着手しない）。
- **`/newgame` 側の見直し候補（Steam 情報受領後に判断）**: ①一次資料を「願望ポエムメモ固定」から「Steam 実プレイ嗜好＋過去 review」へ組み替える（願望メモは従でよい）。②発散の収束を防ぐため game-designer の「毛色を変える」を「**ジャンル/ゲーム性そのものを変える**（ポエム・静歩き禁止の案を最低 1 つ混ぜる）」へ強化。③playtester の検証に**テキスト可読性（画面内に収まるか・はみ出さないか）**のヒットテストを追加（今回の真因の直接対策）。
- **文字はみ出しバグ**: なごり単体の欠陥だが、系統転換が本質のため微修正より Steam 仕切り直しを優先。ユーザー希望があれば修正する。

## ゲーム制作ワークフローの専用化（着手・実装完了、2026-06-02 / user 依頼）

> user 所感「いまの構成（workspace + orc）がゲーム制作に向いていない。ゲーム用のスキルを作り、AI のみで作るゲーム制作に最適な構成を別にするか検討」を受け、(a)〜(d) をユーザー確認のうえ実装完了。

### 決定（ユーザー確認済み、2026-06-02）

- **(a) コンセプト発散 = subagent 並列**。複数 game-designer を並列起動し毛色の違う案 → lead 選定。「案が似通う / 行き詰まる / 振れ幅不足と lead 判断」で agent team(mesh) へ昇格する条件をスキルに明文化。
- **(b) 完全 AI 自決**。一次資料（vault 嗜好メモ + 各作 review）だけを入力にコンセプト〜美学を AI が全確定。ユーザー確認窓は工程に置かない。選定理由は STATUS に 1 行残す。
- **(c) スキル + games/CLAUDE.md + 専用 agent（game-designer / playtester）** の 3 点を作成。
- **(d) 配置**: スキルと専用 agent は `workspace/.claude/`（ユーザーは workspace から起動＝discoverable）。games 固有暗黙知は `games/CLAUDE.md`（CWD=games の auto-discovery 用）。

### 成果物（新設 4 ファイル、workspace `c43ac27` / games `1d0913a`）

- `workspace/.claude/skills/newgame/SKILL.md` — 固定工程（一次資料読込 → 発散 → AI 自決選定 → 美学確定 → 実装 → playtester 実機検証 → 配信導線 → review+commit → 感想記録）。
- `workspace/.claude/agents/game-designer.md`（read-only, color green）— 一次資料から既存作と毛色の違うコンセプト案を 1 つ提案。並列起動前提。
- `workspace/.claude/agents/playtester.md`（color magenta）— Playwright+Chromium で画面座標ヒットテスト経由の実機検証 + 既存作回帰。
- `games/CLAUDE.md` — 配信境界 / 純静的 PWA / verbatim 断章 / Playwright 必須 / 前景視認性 / 配信導線 3 点 / SW・VERSION 運用の暗黙知を明文化。共通項・対症療法 2 周目ルールは上位 `~/companion/CLAUDE.md` 参照。

### 旧・検討時の分岐メモ（決定済み、参考）

- (a) 暫定推奨「subagent 並列、複雑化したら team」→ 採用（昇格条件を明文化）。
- (b) 「完全 AI 自決 か 提出窓を残すか」→ 完全 AI 自決を採用。
- (c) 暫定推奨「スキル + games/CLAUDE.md」→ さらに専用 agent まで含めて採用。
- (d) 「workspace 共有 か games 専用か」→ skill/agent は workspace、CLAUDE.md は games のハイブリッド。

### 現状構成の問題（なぜ向かないか）

- `orc` スキルは「意図が**固まった改修**タスク」用（implementer で実装 → code-reviewer → commit）。ゲーム制作は「AI が要望を聞かず**勝手に新規制作**する」クリエイティブ作業で、軸が違う。
- ゲーム制作に固有の工程が orc に無い: ①一次資料（嗜好・過去作感想）の読み込み ②コンセプトの**発散と比較** ③核メカニクス／断章 verbatim ／配色／視認性の**美学判断** ④Playwright 実機検証必須 ⑤配信導線（3 点）⑥感想受領 → 次作の方向づけ。
- 実際 第 1・2 作は orc を流用し「lead が設計を全確定 → implementer」という**変則**で回した。毎回、配信境界・Playwright 必須・一次資料パス・配信導線 3 点を STATUS から思い出している（暗黙知が台帳に散在）。

### 推奨案（2 点セット）

1. **ゲーム制作専用スキル**（仮 `/newgame`）。固定工程:
   一次資料読込（vault `aidiary/2026-04-11_games-i-want-to-try.md` + 各作の review ノート＝**必須**） → コンセプト発散（複数案） → **AI 自決でコンセプト選定**（「要望を聞かない」趣旨を担保） → 核／verbatim 断章／PALETTE／視認性を lead 確定 → implementer 実装 → **Playwright 実機検証 PASS**（`feedback_game_debugger_before_report`） → **配信導線チェックリスト**（server STATIC に prefix 追加 / remote `GAMES` に 1 行 + **SW cache bump** / tailscale serve / VERSION bump） → code-reviewer + commit → 感想受領 → 次作方向づけを STATUS 記録。
2. **games 固有 `games/CLAUDE.md` 新設**（CWD=games の auto-discovery で読まれる）。明文化する暗黙知:
   配信境界（127.0.0.1 bind + tailscale serve のみ）/ 純静的 PWA・ランタイムで claude/外部 API 不可 / 断章は verbatim 静的データ（実装で創作しない）/ Playwright 実機検証必須 / 一次資料パス / 配信導線 3 点 / SW 運用（開発中は無効、cache bump 規律）/ VERSION 運用。

### ユーザー判断が要る分岐（次セッション冒頭で確認）

- (a) コンセプト発散を **agent team(mesh)** でやるか **subagent 並列**で十分か。team はトークン桁違い（CLAUDE.md は「発散探索は team」だが個人ゲーム制作には過剰の可能性）。**暫定推奨: まず subagent 並列、複雑化したら team**。
- (b)「要望を聞かない」担保の度合い: 完全 AI 自決 か、今回運用（「提出してほしいデータがあれば言う」窓は残す）か。
- (c) 構成分離の深さ: スキルのみ / **スキル + `games/CLAUDE.md`（推奨）** / さらに専用 agent（game-designer・playtester）まで。
- (d) スキル配置: `workspace/.claude/skills/` 共有 か games 専用か。

### 次アクション

上記 (a)〜(d) をユーザー確認 → スキル + `games/CLAUDE.md` を実装。本セッションは提案のみで畳む。

---

## 第 2 作「ともしび」（In progress → Done、2026-06-02）

闇〜薄明の広い野を歩きながら **呼びかけると世界が応える** ゲーム。Journey の「歌で呼応」を参照点に、v1 みちゆきの「読むだけ」を超えて「歩く + 世界が応える」を核に据える。ユーザー嗜好一次資料の「ないものに触れる」を直接の手触りに = 呼ぶまで見えない灯が、呼び声に応えた瞬間だけ姿を見せる。コンセプト・核相互作用・断章テキストは発注時に verbatim 確定（実装側で創作・改変しない）。

### Done（2026-06-02）

- [x] ゲーム本体 `tomoshibi/web/`（純静的 PWA、SW なし、VERSION=v1.0.0）。
- [x] **歩く（長押し）**: みちゆき準拠の 3 層パララックス + progress 0→1、`FULL_WALK_SECONDS`=150、歩行者 `WALKER_X_RATIO`=0.32。
- [x] **呼ぶ（短タップ）**: pointerdown 時刻と移動量で判別（`CALL_MAX_MS`=220ms / `CALL_MAX_MOVE`=16px 未満で離せば呼び声）。押した瞬間は歩行扱いで前進開始（短タップでも半歩進む＝立ち止まってひと声）。離した時に短タップ判定で歩行者中心の波紋（光の輪）を `ripples` 配列に発火。
- [x] **種火（眠っている灯）**: 決定論的配置（sin/定数ベース、乱数禁止、`SEEDS` 90 個）。progress に応じ右→左へ流れる。通常ほぼ不可視。波紋の現在半径が種火の画面位置に届いた瞬間（縁 ±28px）に点灯し、暖色の放射グラデがふっと灯ってゆっくり減衰しやがて消える＝「世界が応える」核。点灯は `litCount` で数えるが UI に数値は出さない。
- [x] **物語の出方**: 本線断章（opening/waypoint×5/ending、progress 閾値）は呼ばない人も読める（みちゆきの showFragment/dismissFragment 流用、ending は dismiss せず静かに終端）。灯のささやき（`WHISPERS`、ささやく灯＝`SEEDS` の約 1/6 を決定論選択）は点灯時にその灯の近くへ淡くフェードイン→数秒で消す in-canvas テキスト。本線断章中は出さない。
- [x] **歩行者の視認性（v1 の教訓を初手から）**: 背景（land）の明度を `luminance` で見て歩行者の塗りを反転気味に追従（暗背景=明るめ / 明背景=暗め）+ ごく細い 1px 縁。強い縁取りで目立たせず「言われれば気づく」程度を常に確保。
- [x] **overlay の罠回避（v1 真因）**: `.overlay[hidden]{display:none !important}` / `.overlay:not(.visible){pointer-events:none}` / canvas `touch-action:none` をみちゆき同様に投入。
- [x] **配信**: 同一サーバ・同一ポートで `/tomoshibi/` prefix 配信（下記「複数ゲーム配信の設計判断」）。CSP はみちゆき同方針。icons は PIL 生成（闇に暖色の放射）。
- [x] **実機相当検証（Playwright + Chromium, `tests/debug-tomoshibi.mjs`）PASS**: 画面座標ヒットテスト経由で pageerror 0 / opening タップで scene に / 長押し 3s で progressΔ=0.0204・画面変化率 39.79% / 短タップ 4 回で波紋 4 本立つ / 灯 1 点灯。**同一起動サーバでみちゆき回帰（`/` 200・pageerror 0・長押しで progress 前進）も PASS**＝みちゆき URL を壊していない証明。

### 複数ゲーム配信の設計判断（2026-06-02、server を触る判断＝台帳に記録）

`server/app.py` を最小拡張し **同一サーバ・同一ポートで prefix 分け**する方式を採用した。

- みちゆきは `/`, `/app.js` 等の **URL を完全に不変**に保つ（ユーザーがホーム追加した本番 `:8444/` 互換を壊さない）。みちゆきの web ファイルも一切編集していない。
- ともしびは `/tomoshibi/` 配下に **最初から絶対パス**で配る（HTML の `<link>`/`<script>`、manifest の start_url/scope すべて `/tomoshibi/`）。
- 実装は `WEB_DIR` を games リポジトリ直下へ引き上げ、`STATIC` dict の rel をゲーム名込み（`michiyuki/web/...` / `tomoshibi/web/...`）に拡張しただけ。allowlist 方式・FS への URL 連結禁止・リスティング無し・Content-Type 明示・generic エラー・no-store・/healthz 無認証・127.0.0.1 bind・`GAMES_PORT` env は全部維持。
- `/` をゲーム選択ギャラリーにする案は **YAGNI で見送り**（2 作なら直リンクで足りる。TODO に残置）。
- systemd unit は同一サーバ・同一ポートのため **追加・変更不要**。

### テスト計測しきい値の判断（PALETTE が暗背景ゆえの調整、対症療法 2 周目には非該当）

`debug-tomoshibi.mjs` の画面ピクセル差分しきい値はみちゆきの `th=24`（明背景向け）では暗背景のともしびで成立しない。実測（3s 歩行）で `th=8`→約40% / `th=10`→0.7% と急峻な崖があり、暗背景の自然な可動域は `th=8` 付近。景色は確かに流れている（progress 前進 + 多数ピクセルが小さく変化）ため、**アプリ挙動は変えず計測側を `th=8` に合わせた**。これは「新規ゲームの計測基準を初めて定める」調整であり、同一バグへの 2 周目（しきい値の場当たりいじり）ではない。合格条件 `ratio>2%` は維持（`th=8` で 40% 出るためマージン十分）。

### ユーザー感想 受領 = 3/10（2026-06-02、vault `notes/2026-06-02_tomoshibi-review.md`）

第 1 作みちゆき（5/10）より評価が下がった。良かったのは「タップで明かりがつく演出が綺麗」の 1 点のみ。よくなかった点：**「前回とほぼ同じゲームだった」「前回『読むだけのやつが続くとつらい』と書いたのにまったく反映されていない」「また読むだけですぐ終わり、ゲーム性が皆無」**。

設計上は「歩く + 呼ぶ → 種火が灯る」で相互作用を入れたつもりで playtester も「波紋 4 本・灯 1 点灯」で PASS していたが、**体感は「読むだけ」のままだった**。真因の仮説：①「歩く=長押し」をみちゆきから流用したので操作の手触りが前作と同一 →「ほぼ同じ」。②「呼ぶ→灯る」が控えめすぎ（種火は通常ほぼ不可視・視認性は言われれば気づく程度・数も出さない）→ 相互作用があること自体が伝わらない。③目標/達成/手応えの設計が無く「読むだけ」に戻る。**「相互作用が技術的に発火する（playtester PASS）」と「プレイヤーにゲームとして伝わる」は別物**で、現行ヒットテストは前者しか見ていない。読むだけ 2 連続＝CLAUDE.md「2 度目で一段引く」に該当。

**判断（ユーザー確認済み、2026-06-02）**：
- 第 3 作の方向性も AI 側＝`/newgame` スキルが一次資料から自決する。方向性をユーザーに聞くのはコンセプト違反（今回 lead が選択肢で聞いて「これもスキルが決める」と返された）。
- ワークフロー（newgame/playtester）の検証の穴を**今は机上でいじらず保留**。理由：newgame スキルはまだ一度も実戦投入していない（みちゆき・ともしびは orc 流用の変則）。実際に 1 作 `/newgame` で走らせた「できたもの」を見てから検証基準を考える。
- 次に着手するときは orc ではなく `/newgame` を回す。みちゆき・ともしび両 review が一次資料（vault notes）として既に効く位置にある。

## セッション引き継ぎ（2026-06-02、次セッションは別セッション想定）

- **現状**: みちゆき v1 は実機(Pixel-6 Chrome/Edge)で opening → 長押し歩行 → 景色遷移 → ending「着いた」まで踏破確認済み。歩けない真因(overlay)・視認性(静止に見えた)・キャッシュ事故(SW)を解決済み。git クリーン、`companion-games.service` active+enabled。
- **ユーザー感想 受領済み**(vault `notes/2026-06-02_michiyuki-review.md`)。下記「v1 ユーザー感想と次への反映」に内容と教訓を記録。次セッションは (a) v1 微調整(歩行者の視認性をわずかに上げる / 歩行速度・断章タイミング・景色の流れ・フォントのバランス) と (b) 第 2 作の方向づけ(「読むだけ」を超える関与の設計) に入る。
- **配信 URL(現状 3 本とも生きている、tailscale serve --bg で永続)**:
  - `https://miho-inspiron-3521.tail5e989b.ts.net:8444/` … 本番(クリーン origin、ユーザーが踏破したのはここ)
  - `:8445/?debug=1` … HUD 付きデバッグ
  - `:8443/` … 最初の origin(旧 SW キャッシュが端末に残りうる。killer SW で自浄)
- **片付け候補(本番 URL 確定後に実施)**:
  - tailscale serve を本番 1 本(推奨 8444)へ整理し、`tailscale serve --https=8443 off` / `--https=8445 off` で 8443・8445 を落とす。ユーザーがどの URL をホーム追加したか確認してから。
  - `?debug` HUD(app.js 末尾)の除去 or 恒久デバッグ資産として明示保持の判断。
  - オフライン再プレイ(Service Worker)の再導入可否(現在は killer で無効化中)。

## v1 ユーザー感想と次への反映（2026-06-02）

一次資料: vault `notes/2026-06-02_michiyuki-review.md`（ユーザー手書き、fleeting）。本プロジェクトは「要望を聞かず AI が判断して作る」趣旨のため、感想の解釈と次手の判断は AI 側で確定する（ユーザーに確認したところ「あなたが全部管理するので判断して」と委任を再確認）。

### ユーザーが良かったと挙げた点（= 第 2 作以降も継承する資産）

- **CSS/canvas のみで移りゆく景色が美しい**。色彩の時間変化（夜明け→夜の 6 キーフレーム補間）はこのシリーズの核として刺さっている。→ 「色と光の時間変化で世界を語る」は継続の柱。
- **テキストが雰囲気に合っている**。断章の文体は当たり。verbatim 静的データ方針（実装側で創作しない）も含めて継続。
- **「昔」のパートに“にょりさん”の雰囲気があって良い**。過去・郷愁の手触りが効いている。→ 第 2 作でも「時間の層／喪失と懐かしさ」のモチーフは強み。

### ユーザーが課題と挙げた点（= 次への教訓）

1. **「読むだけ」ではゲームとして厳しい**。「私を楽しませる」コンセプトは伝わったが、読み物（長押しで進むだけ）は“たまに”なら良くても“ずっとこれ”だと持たない、との評。
   - **教訓（第 2 作の方向づけ）**: 静けさ・スコア無し・失敗無しの美学は維持しつつ、**プレイヤーの選択や操作が世界に作用する余地**を一段入れる。例: 分岐する道／触れると反応する地形・光／拾う・残す等の小さな相互作用／探索で景色が変わる。Journey の「歩く以上の関わり（飛ぶ・呼応・他者）」が参照点。みちゆきは「一本道を読む」一極だったのを、次は「歩く + 世界が応える」へ。
   - v1 自体は“静かな読み物”として完成形でよい（ジャンルとして成立）。第 2 作で振れ幅を変える、という棲み分け。

2. **背景と歩行者の色が同化してほとんど見えなかった**（「意図したものなら OK」と留保付き）。
   - **判断（AI 確定）**: v1 で歩行者の視認性を**わずかに上げる**。理由 — 歩行者はプレイヤー唯一の分身で自己投影の対象。静かな体験でも「自分がそこにいる」感覚は要る（Journey の赤い衣が常時視認できるのと同じ役割）。ただし「景色が主役・人は気配」の方針は保持し、**強い縁取りではなく明度差／薄い縁取りを少し付ける程度**に留める。「ほとんど見えない」→「言われれば気づく」を目標。完全に目立たせない。
   - 実装メモ: `app.js` の歩行者シルエット描画は背景色に対して固定的に暗い塗り。progress に沿って空・地面色が大きく動く（特に夜帯）ため、背景明度に応じて歩行者の明度を相対的にずらす（暗背景では少し明るく、明背景では少し暗く）か、ごく細い半透明の縁を 1px 入れると同化を避けられる。コントラスト比は WCAG までは要らない、視線で追える最低限。

### 第 2 作（次弾）の設計起点メモ

- 継承: 色と光の時間変化 / 雰囲気重視の断章文体 / 静けさ・スコア無し・失敗無し / 純静的 PWA（ランタイムで claude 呼ばない budget-guard 回避）/ 127.0.0.1 bind + tailscale serve 境界。
- 変える: 「読むだけ」→「歩く + 世界が応える」。小さな相互作用を一つ核に据える。
- 視認性の原則を最初から: 前景（プレイヤー／触れる対象）は背景の明度変化に追従して常にコントラストを確保する設計を初手から入れる（v1 では後から気づいた）。

## 概要

「スマホで遊べるゲームを全部 AI で作る」umbrella プロジェクト。ユーザー(SE, 完全個人利用)が「自分にいっさい要望を聞かず、自分が楽しめるゲームを AI が勝手に作る」という趣旨で発注。嗜好の一次資料は vault `aidiary/2026-04-11_games-i-want-to-try.md`(広大な世界をただ歩く / 地形だけで語る / Journey・Shadow of the Colossus のような静かで「終わりが惜しい」体験 / 「ないものに触れる」)。

第 1 作 **みちゆき** はこれに寄せた静かな横歩きゲーム。スコア無し・失敗無し、長押しで歩き、progress 0→1 の道中で空と地面の色が夜明け→夜へ移ろい、断章(石碑)を読みながら終端へ向かう。

- 対象ユーザ: miho 個人のみ(完全個人利用、外部公開なし)
- 配信形態: スマホ(Tailnet 同居)から開く静的 PWA
- 不要なもの: スコア / マルチプレイ / 課金 / 音(v1 は無音)

## 位置付け

`workspace/PROJECT.md` の Phase 1〜4 ロードマップとは独立した **フェーズ外の独立プロジェクト**(remote / dashboard と同じ扱い)。umbrella「全部 AI で作るゲーム」の第 1 作。

## ネットワーク境界

companion-remote の流儀を踏襲。

- サーバ(`server/app.py`)は **127.0.0.1 のみに bind**(0.0.0.0 / tailnet IP 厳禁)。
- 外向きは **`tailscale serve`(HTTPS 前段リバースプロキシ)経由のみ**。Tailnet 内からしか到達しない。
- 認証は tailscale 境界に委ねる(単一ユーザー、API 無し)。`/healthz` のみ無認証の生存確認。
- ポートは env `GAMES_PORT`(デフォルト 47825、remote の 47824 と衝突しない別番号)。

## 設計判断: ランタイムで claude を呼ばない（budget-guard 境界回避）

ゲームはランタイムで claude / 外部 API を**一切呼ばない純静的 PWA**。断章テキストは**ビルド時に AI 生成した静的データ**(`michiyuki/web/fragments.js`)で、配信時は素朴なファイルサーブに徹する。これにより budget-guard 境界に踏み込まない。唯一の外部依存は和文フォントの Google Fonts CDN(`<link>`)で、取得失敗時は CSS の serif フォールバックで成立する(CSP で `fonts.googleapis.com` / `fonts.gstatic.com` のみ許可)。

## 設計判断: 開発フェーズは Service Worker を使わない（2 周目回避）

v1 初版で shell precache の cache-first SW(`michiyuki-v1`)を入れたが、実機(Pixel-6 Chrome)で「タップ・長押ししても画面が変わらない」事象。Chromium(Playwright)で配信中の現コードを SW 抜きで検証すると **PASS**(opening 表示 → タップ dismiss → 長押しで progress 前進、実行時エラー 0)。∴ コードは正常で、原因は **SW が壊れた中間状態の古い shell を cache-first で返し続けていた**こと。

対処として CACHE 名 bump(`v1`→`v2`)を一度打ったが、これは「同じ境界(SW キャッシュ整合)への 2 周目の条件いじり」(`~/companion/CLAUDE.md` 2 周目ルール)。3 度目を打たず一段引いて設計を見直し、**複雑性の源である SW 自体を開発フェーズから外す**判断に切り替えた:

- `sw.js` を **killer SW** に置換: 全キャッシュ削除 → 自身を `unregister` → 制御中ページを reload。fetch ハンドラを置かず、ブラウザ既定のネット直取得に戻す。ブラウザは navigation 時に byte 差分でこの新 sw.js を取得し旧 SW を置換するため、ユーザー端末は再アクセスで自動的に SW 無し状態へ収束する。
- `app.js` の SW 登録を廃止し、既存登録・キャッシュの掃除コードに置換。
- オフライン再プレイ(SW の本来目的)は tailscale 接続前提の本作では今は不要な装飾。**v1 のプレイ感が固まってから再導入**(下記 TODO)。

## 実機で歩けなかった真因(overlay)と視認性 — 2026-06-02

実機(Pixel-6 Chrome/Edge)で「タイトルはタップで消えるが、その後押しても歩かない」。HUD(`?debug`)で実機の生イベントを観測し確定:

- **真因**: opening を閉じる際 `overlay.hidden = true` にしていたが、UA の `[hidden]{display:none}` は詳細度が低く、`.overlay{display:flex}`(クラス指定)に負けて**消えていなかった**。透明な overlay が `inset:0` で画面全体を覆ったまま `pointer-events` を受け、canvas へ pointerdown が届かず `walking` が立たなかった(HUD で pointerdown は window capture では増えるが walking=false のまま、を実観測)。`.overlay[hidden]{display:none !important}` で打ち消し + フェードアウト中(`.overlay:not(.visible)`)は `pointer-events:none` で canvas へ透過。
- **検証ミスの教訓**: 初版 Playwright は長押しを **canvas へ直接 dispatch** していたため overlay を飛び越え PASS していた。座標へのヒットテスト(`page.mouse` を画面座標へ)に直し、最前面要素判定を実機同様に通すよう修正。`elementFromPoint` が `scene` を返すことも assert。
- **視認性**: 歩いても景色がほぼ流れず静止に見えた(3 秒で画面変化 0.66%)。scrollSpeed を約 5 倍(遠 700/中 1800/近 4500)、`FULL_WALK_SECONDS` 210→150、歩行者 bob 増。→ 3 秒で **15%** 変化、最初の文章まで約 15 秒。Playwright スクショを目視確認。
- **canvas に `touch-action:none`** も明示(body だけでなく canvas 自身に必要。長押しがジェスチャに消費されるのを防ぐ保険)。

## 実機検証基盤（Playwright + Chromium）

「実機相当のデバッガを通してから報告する」運用要求に対応。`tests/debug-michiyuki.mjs` が Chromium(headless)で配信中の本体を開き、**画面座標へのヒットテスト経由で**(canvas へ直接 dispatch しない)実行時エラー / opening dismiss / 長押し前進 / 画面ピクセル変化率を実観測して PASS/FAIL を返す。`devDependencies` に `playwright`、ブラウザ本体は `~/.cache/ms-playwright`(git 外)。実行: `node tests/debug-michiyuki.mjs`(サーバを 47825 で起動した状態で)。

`?debug` 付き URL で起動すると画面左上に HUD(pointerdown/touchstart/click 数 + walking/paused/progress)を表示し、実機の生入力を直接読める(本番=クエリ無しでは一切動かない)。実機で挙動が分かれたときの一次情報取得に使う。

## ディレクトリ構成

```
games/
├── docs/STATUS.md
├── michiyuki/web/        # 第 1 作。`/` 直下で配信(URL 不変)
│   ├── index.html       # canvas + 断章オーバーレイ + CSP + フォント link
│   ├── app.js           # ゲーム本体(歩行 / パララックス / 色補間 / 断章 / 入力)
│   ├── fragments.js     # 断章テキスト(verbatim, AI 生成静的データ) + 色キーフレーム
│   ├── style.css        # 静けさ最優先のタイポグラフィ / オーバーレイ
│   ├── manifest.json    # PWA(name みちゆき / standalone / 夜明け色基調)
│   ├── sw.js            # shell precache の service worker(オフライン再プレイ)
│   └── icons/           # icon-192.png / icon-512.png(夜明け色グラデ, PIL 生成)
├── tomoshibi/web/        # 第 2 作。`/tomoshibi/` prefix で配信
│   ├── index.html       # canvas + 断章オーバーレイ + CSP(/tomoshibi/ 絶対パス)
│   ├── app.js           # 歩行 + 呼び声(短タップ)→波紋→種火点灯 + ささやき + 歩行者の背景追従コントラスト
│   ├── fragments.js     # 断章 + WHISPERS(灯のささやき) + HINTS + PALETTE(闇基調)
│   ├── style.css        # みちゆき踏襲(overlay 罠対策含む)、テーマ色を闇基調に
│   ├── manifest.json    # PWA(name ともしび / start_url=scope=/tomoshibi/)
│   └── icons/           # icon-192.png / icon-512.png(闇に灯る暖色放射, PIL 生成)
├── server/app.py        # stdlib http.server, 127.0.0.1 bind, 固定 allowlist 配信(2 作 prefix 分け)
├── tests/
│   ├── debug-michiyuki.mjs   # みちゆき実機相当(Playwright+Chromium)
│   └── debug-tomoshibi.mjs   # ともしび実機相当 + みちゆき回帰(URL 不変の証明)
└── systemd/companion-games.service
```

git: **(C) ローカル git のみ(remote なし、rollback 専用)**。GitHub remote は意図的に付けない(マシン外バックアップ不要)。gitleaks pre-commit hook 導入済み。

## 起動手順（SETUP）

```sh
# 1. user service として登録
ln -sf ~/companion/games/systemd/companion-games.service ~/.config/systemd/user/companion-games.service
systemctl --user daemon-reload
systemctl --user enable --now companion-games.service
systemctl --user status companion-games.service   # active 確認

# 2. tailscale serve で HTTPS 前段を張る(Tailnet 内のみ到達)
#    127.0.0.1:47825 を tailnet の HTTPS にぶら下げる。
sudo tailscale serve --bg --https=443 127.0.0.1:47825
tailscale serve status                              # 公開状態確認
# → スマホの Tailnet から https://<machine>.<tailnet>.ts.net/ で「みちゆき」が開く

# ポート変更する場合は ~/companion/games/.env に GAMES_PORT=xxxxx を置く(EnvironmentFile=-)。
```

> gitleaks pre-commit hook は `.git/hooks/` 配下(git 管理外)。この repo を別環境へ clone / 再 init した場合は消えるので、`~/companion/workspace/.githooks-template` か remote/ の hook を再配置すること(remote / web と同じ既知事項)。

## v1 で実装した範囲

### Done
- [x] 配信サーバ(`server/app.py`): 127.0.0.1 bind / 固定 allowlist dict 配信 / ディレクトリリスティング無し / Content-Type 明示 / generic エラー / `/healthz` 無認証生存確認 / `GAMES_PORT` env(default 47825)。
- [x] systemd user unit(`systemd/companion-games.service`): WorkingDirectory=%h/companion/games / Restart=on-failure / WantedBy=default.target。
- [x] ゲーム本体(`michiyuki/web`): canvas 全画面横歩き / 長押し(pointer)前進・→/Space でも前進 / フル踏破 約 3.5 分 / パララックス 3 層(決定論的 sin 和ノイズ) / 歩行者シルエット(bob) / progress に沿った空・地面色の線形補間(6 キーフレーム) / 夜の星 / 断章 8 本(opening + waypoint 6 + ending)を閾値到達でフェードイン・タップ dismiss / ending 後の静かな終端。
- [x] 断章テキストは仕様の verbatim を `fragments.js` に構造化(progress 閾値 + text、ending は改行保持)。実装側で改変・創作しない。
- [x] PWA: manifest.json(みちゆき / standalone / 夜明け色基調) / sw.js(shell precache, オフライン再プレイ) / icons 192・512(PIL で夜明け色グラデ生成)。
- [x] 動作確認: `node --check` で構文 OK、manifest.json JSON 妥当、テストポートで配信(全 allowlist 200 + 正 Content-Type / allowlist 外 404 / リスティング無効 / 127.0.0.1 bind)を確認。
- [x] **実機相当検証(Playwright + Chromium)**: opening 表示 → タップ dismiss → 「押しているあいだ、歩く」表示 → 長押しで progress 前進 → 離して停止、実行時エラー 0 を PASS 確認(`tests/debug-michiyuki.mjs`)。
- [x] 操作導線: 止まっている間「押しているあいだ、歩く」を画面下に表示(初版は操作不明だった)。
- [x] SW 無効化(killer SW + 登録廃止)。上記「設計判断」section 参照。
- [x] **トップ(opening)画面に版番号表示(2026-06-02, user 要望)**: `app.js` の `const VERSION`(現 `v1.0.0`)を単一真実源に、opening の断章カード内へ小さく薄く表示(`showFragment` で `fragVersionEl.hidden = f.kind !== "opening"`、歩行中/waypoint/ending は非表示)。目的=実機で見える番号とこちらが出した番号がズレれば「端末キャッシュに旧版残存」、一致すれば「こちらの認識・検証不足」と切り分ける。VERSION は app.js 内定数なので表示番号と app.js の鮮度が常に一致。Chromium 検証 PASS(opening で可視 / dismiss 後・歩行中は非可視 / pageerror 0)。**運用ルール: ゲーム本体(`michiyuki/web/*`)に手を入れるたびに必ず VERSION を上げる**(上げ忘れると切り分けが効かない。人手依存の残存リスク)。
- [x] **リモコン(companion-remote)からゲームへの導線(2026-06-02, user 要望)**: remote 側で対応済。リモコン `#app` 最下部の折りたたみ「ゲーム」カードからアドレスのコピペ無しで開ける。リンク先は本番 `:8444/`。詳細は `~/companion/remote/docs/STATUS.md` Done(2026-06-02)。**games 本番ポートを変えたら remote 側 `web/app.js` の `GAMES` を直す**(現状 8444 を指す)。

### TODO（今後の候補）
- [ ] 音: ambient soundscape の追加(v1 は無音。風 / 足音 / 環境音を progress に連動)。**外部から音源を取得する形にする場合は index.html の CSP 更新が必須**(`connect-src` / `media-src` の追加。現状は Google Fonts 2 ドメイン以外の外向きを塞いでいる)。同一オリジン配置(web 配下に同梱)なら CSP 変更不要。
- [ ] 複数ゲーム gallery 化: 第 2 作「ともしび」は `/tomoshibi/` prefix 直リンクで配信し、`/` をギャラリーにする案は YAGNI で見送り済み（上記「複数ゲーム配信の設計判断」2026-06-02）。3 作目以降で直リンク運用が辛くなったら `/` をゲーム選択にし STATIC を分割する。
- [ ] 断章の増補: 道中の waypoint を増やす / 季節・天候バリエーション。
- [ ] 実機目視プレイでのバランス調整(歩行速度 / 断章の出現タイミング / フォント表示)。Playwright で機能は検証済みだが、歩き心地・可読性は人の目で。
- [ ] オフライン再プレイ(Service Worker)の再導入: v1 のプレイ感が固まってから。開発中は上記のとおり無効化している。
