"use strict";
// Mine Road リメイク — 自由掘削サイドビュー探索 × スタミナ→体力の二段ゲージ ×
// 地上全回復の撤退判断 × 女の子救出誘導(原作 jp.windbellrrr.app.minerroad の忠実再現)。
// バニラ JS、フレームワーク無し。ランタイムで外部 API / claude を呼ばない(唯一の外部依存は
// CSS の和文フォント CDN)。TILE/tileType/girlPositions/PALETTE は tiles.js の global。
//
// 文字・数値・ボタンは全て HTML/CSS DOM(canvas に文字を焼かない)。canvas にはタイル矩形 +
// fog + 自機 + 女の子だけを焼く。Service Worker は使わない(開発フェーズ)。
//
// 核メカ(仕様まとめ §3/§5/§10):
//  - 隣接タップ / 十字キーで方向指定 → 空間なら移動・土/硬土なら掘る・硬岩は無反応。
//  - 重力("road"の核): 足元(真下)が空間なら毎ステップ 1 マス落下。上移動は 1 マスだけ。
//  - 二段ゲージ: 全行動でスタミナ 1 消費 → スタミナ 0 で以降は体力消費 → 体力 0 で力尽き。
//    地表行に戻るとスタミナ・体力 全回復(撤退判断の中心)。
//  - 探索率: 可視/掘ったタイル ÷ 全タイル を % 表示。fog で未可視は黒。
//  - 女の子: 深部に決定論で 1 人。掘って発見 → 追従(掘った空洞を BFS で辿る、重力作用)。
//    地表まで連れ帰る = 救出成功。

// ---- バージョン(縦切り + Kenney フルリスキン。単一真実源) --------------
// v0.2.1: 実機 FB 反映 — 自機=緑キャラ+グロー除去(白光輪解消)、BGM=Infinite Descent
// (低音量)、SFX clone-per-play(連打停止対策)、女の子の縦坑追従(クライム時 重力ガード)。
// v0.2.2: 宇宙服リングが変との FB → キャラを Kenney Roguelike Characters(リング無しの
// ピクセル人型)へ。自機=髭の坑夫、女の子=金髪三つ編み。描画は smoothing off で crisp。
// v0.3.0: 全コンテンツ拡張の第1増分 — 裏庭を本物のダンジョン化。女の子 1→5 人(dungeon_info
// ID0 girl num=5 に忠実)、クリア条件を §7 忠実へ(全員救出+最下層到達+探索率しきい値)。
// 1 人救出=即クリアを廃し、地表帰還で全回復しつつ複数ダイブで全条件を満たす撤退ループへ。
// v0.4.0: アイテム/クラフト系の第2増分(原作 item.csv/craft.csv 忠実)。ツルハシ power による
// タイル掘削ゲート(SOIL1/HARD2/ROCK3、木で岩掘れず石/鉄/ダイヤで段階開放)、決定論 oreAt の
// 鉱石ドロップ(深度帯=銅/鉄/金/ダイヤ)、クラフト 6 レシピ UI、アイテム使用(回復薬+50/
// アンテナ透視/はしご)、HUD インベントリ。tileType/girlPositions には非介入(決定論 snapshot 不変)。
// v0.5.0: モンスター/戦闘/GIRLATK/埋没掘りスポーンの第3増分(原作 monster.csv 忠実サブセット)。
// 死の緊張(撤退判断の重み)を設計から出す本命。bump-to-attack 戦闘、被ダメは既存二段ゲージへ
// 接続(SP を削り SP0 で HP=これで初めて死ねる)、撃破で EXP/素材ドロップ(verbatim/決定論)。
// 空間スポーン(NONE マスへ決定論配置)+ 埋没掘りスポーン(SOIL/HARD 掘り抜き時 bury% で出現)。
// GIRLATK=1 のモンスターは追従中の女の子も標的にしうる(誘導難度=死の緊張の核)。
// tileType/girlPositions/oreAt・determinism snapshot には非介入(v0.4.0 oreAt 流儀)。
// v0.8.0: 商人(物々交換)の第6増分(原作 shop.csv 忠実翻案)。キノコ通貨の循環を開く=SOIL 掘り
// 抜き時の決定論 `mushroomAt` でキノコ採取(oreAt 流儀の別レイヤー、非介入)、商人オーバーレイで
// shop.csv 忠実サブセット(フルーツ←鉄鉱石2 / ツルハシ←キノコ10 / アンテナ←キノコ20 / 夢キノコ←
// キノコ100)を物々交換。対価充足の行だけ実行可・不足は disabled、実行で対価減算+産物加算(決定論、
// 状態遷移のみ)。アクセス導線は既存クラフトと同じ HUD ボタン+オーバーレイ流儀に寄せる(「商」ボタン)。
// v0.9.0: 育成(原作 §4 キャラクター育成=パラメータのレベルアップ制)。救出した女の子の「情報」と撃破
// EXP をボーナスポイント(BP)に変換し、PER_*(HP/ST/DIG/ATTACK/DEFENCE/SWIM)をレベルアップする。
// 裏庭=BP100%(dungeon_info ID0)に忠実に BP 単一通貨路を開く。レベルは既に切り出し済みの育成フック
// (HP_MAX/STAMINA_MAX/掘削手数/ATK_BASE/DEF_BASE/SWIM_MITIGATION)の有効値を effXxx ヘルパー経由で動かす
// (新たな分岐を散らさずフックの消費先を開く)。UI は工房オーバーレイに第3タブ「育成」を足す(上部バーの
// ボタンは増やさない=gate G の地表タップ前提を壊さない)。tileType/girlPositions・determinism には非介入。
// v0.10.0: 仲間同行(原作 §5「1人だけ仲間として連れて潜れる→一緒に戦い EXP 蓄積→地上で別れてレベルアップ
// →別れると再び情報としてストック」)。following 中(護衛中)の女の子1人を G.companion に指定する翻案=新
// state を作らず既存 following の追従/重力/GIRLATK/ロスト物理を非介入で再利用。撃破 EXP を companion.cexp に
// 並走で貯め(自機プール G.exp=v0.9.0 BP 路は不変=二面両立)、地表帰還(rescueGirl)で cexp→level に反映して
// 別れる。companion レベルで playerAtk に援護(effCompanionAtk)が乗る(原作「一緒に戦う」)。UI は工房第4タブ
// 「仲間」(上部バーのボタンは増やさない=gate G 非退行)。tileType/girlPositions・determinism には非介入。
// v0.11.0: 中核の作り直し(実機 FB で中核破綻が判明)。①女の子追従を「自機足跡履歴(G.playerTrail)を
// 1手ずつ消化する snake 追従」へ引き直し(旧 bfsStep+独立重力の底張り付きを設計から消す)。②仲間モデルを
// 「救出済みストック(rescued)を地表で1人選び次の潜行へ同行(deployed=following)→帰還で別れて Lv→ストックへ」
// へ作り直し(旧 following 同行モデルを廃止)。③崩落で塞がれた(G.fallen)マスを再掘で空間へ戻す
// soft-lock 修正(act の掘り抜きで G.fallen.delete)。tileType/girlPositions/oreAt/monster/hazard/avalanche の
// ワールドレイヤーには引き続き非介入。
// v0.12.0: セーブ/永続(力尽き跨ぎで rescued/per/bp/info/pick/girls level を永続化)。保存=地上帰還時、
// ロード=startDive 冒頭、クリアで消去。localStorage JSON 方式(既存 getInt/setInt と同じ try/catch)。
// v0.13.0: 残り8ダンジョン + 解放連結チェーン(DUNGEON_DATA/DUNGEON_BANDS の per-dungeon×per-band 動的化)。
// v0.13.1: はしご設置/回収 + 上掘り(placedLadders)。
// v0.14.0: アイテム拡充(item.csv 全45種カタログ、工房「アイテム」タブ) + 鉱石名寄せ(独自4種→原作実名
// 6種=石炭/鉄鉱石/化石/鋼/ルビー/ダイヤ) + craft/shop 実レシピ化 + 回復薬(原作に無い独自)を飲食
// (焼き肉/動物の血)へ置換 + アンテナ設置型化(電波網 R0/R の連結判定) + 保険(電波圏内の力尽きは
// 携行アイテムを1回だけ持ち越す、mineroad_insurance_N キー)。
// v0.15.0: 掘削 8 方向の原作合わせ(bc.java の 8 方向入力/cm.java の上・斜めハンドラ準拠)。タップの
// 隣接判定を Chebyshev 1(隣接 8 マス)へ、真上掘りのはしご前提ゲート撤去(power ゲートのみ、掘り抜き
// でも自機は移動しない)、斜め=横隣 or 縦隣が空間のとき可(空間なら重力あり moveTo=階段登り/ジャンプ
// 同型、掘削可なら掘る。斜め下の掘り抜きは前進)、bump-to-attack を 8 方向へ。世界生成レイヤー非介入。
// v0.16.0: 水/マグマ機構の原作合わせ(正本 spec §4/§2、STATUS v0.16.0 判断 A〜G、チケット #120)。
// 固定オーバーレイ hazardAt + SP×3/×4 割増 + マグマ HP chip 2 を総取り替え:
//  A. ランタイム流体 state G.fluid(Map "col,row"→{k,d:1..8})。hazardAt は流体の初期配置・掘り当て
//     抽選として温存(ハッシュ・位相 非介入)。startDive で初期空間へ d=8 播種 + 掘り抜きで湧出
//     (G.fluidReleased で 1 マス 1 回限り)。
//  B. 毎ターンのセルオートマトン fluidStep(スナップショット row→col 昇順、下優先→塞がれたら左右、
//     合流 d+1、d=8 満水 cap、非保存、毎ターン 1 マス拡張、決定論)。
//  C. 浸水は HP 直撃(SP 割増全廃=spendAction は素の SP_PER_ACTION)。水= G.breath が swimTurns() を
//     超えるまで無傷→超過後 drownDamage()/ターン直接減算・水から出ると息継ぎ。マグマ=猶予なし
//     ceil(effHpMax()/MAGMA_HP_DIV)/ターン直接減算 + 生肉調理を滞在ターンへ移設。
//  D. 浮力=水/マグマ中は重力無効(applyGravity は流体セルで停止=着水)。
//  E. ターン解決を resolveTurn() 1 本に集約(fluidStep→tickSubmersion→ヒント→checkFail→monstersAct)。
//     崩落土塊の着地マスは流体を消す(埋め立て)。
// v0.17.0: 埋没モンスター機構の原作合わせ(正本 spec §5 bk.java:140-151、STATUS v0.17.0 判断 A〜G、
// チケット #121)。v0.5.0 の掘削時抽選スポーン(trySpawnBuryMonster)を総取り替え:
//  A. 生成時配置: startDive で全固体マス(SOIL/HARD/ROCK)を走査し、buryMonsterAt が種を返すマスへ
//     埋没個体(buried=true)を配置=最初からそこに居る。配置 = BURY_PRESENCE_RATE(人口密度 0.05)×
//     帯別重みのみで、bury% は脱出抽選専用(STATUS v0.17.0 設計見直し 2026-07-19 裁定①②の役割分離。
//     当初の「bury% 込みテーブル温存=遭遇率保存」は掘りイベント率と人口密度の取り違えだったため改稿)。
//  B. 土中 tick: 埋没個体は毎ターン HP−1(土中で衰弱)+ bury% の決定論抽選(buryEscapeRoll、覚醒
//     カウンタ bt)に単発成功で覆い土を自力破壊して脱出。HP 0 は土中死=静かに除去(EXP/ドロップ/
//     演出なし)。
//  C. 活動範囲: 自機から Chebyshev 距離 BURIED_WAKE_RANGE(=4)圏内の個体のみ土中 tick(小マップでの
//     一斉孵化防止=原作 by.java:189「16 マス以内のみ処理」の埋没個体への限定導入。初期値 8 は
//     実測で一斉覚醒したため 4 へ一段見直し=CONST の根拠コメント参照)。
//  E. 脱出の空間化はプレイヤー掘削の掘り抜きと同順(dug.add→fallen.delete→なだれ土なら
//     markUnstableDug→releaseFluidAt。採取なし)。掘り当て=アクティブ化(activateBuriedAt、非前進の
//     手触り不変)。崩落土塊の着地マスのアクティブ個体は buried へ戻す(再埋没、spec §6)。
//  F. buried は bump 攻撃・移動ブロック(monsterAt)・描画の対象外(土の中は見えない)。
// v0.18.0: モンスター AI/活動範囲の原作合わせ(正本 spec §5(2026-07-19 訂正済み)、STATUS v0.18.0
// 判断 A〜H、チケット #123)。bfsStep 追跡(v0.5.0 以来のリメイク独自)を総取り替え:
//  A/B. 原作モンスターは自機へ接近しない。移動は種別の徘徊のみ(BAT=8方向ランダム飛行 /
//     SLIME・HALF=重力落下優先+dx∈{-1,0,1}·dy∈{-1,0} / SNAKE=方向持続パトロール(反転・1段登降) /
//     SPIDER=dx∈{-1,0,1}·dy=75%:0/25%:−1 / WORM=落下+横ランダム(tk%SPD(=3) ターンのみ))。攻撃は
//     2 層: ①偶発バンプ=徘徊/落下の移動先が自機セルなら移動せず攻撃(bo.java:359-367、WORM 含む
//     全種) ②意図的バンプゲート=8方向隣接時に種別確率・種別順序(BUMP_GATE)。斜めは corner-cut
//     規則(両直交隣が塞がりなら不可=v0.15.0 斜め掘り規則と同型)。ゲート失敗時は徘徊へ落ちる=
//     交戦ロックしない。女の子攻撃対象は following のみ、ダメージ現行式 max(1,STR) 維持。
//  C. SP-睡眠サイクル: 徘徊移動 1 歩=SP−1、SP0 で入眠。眠り中は行動なし+毎ターン sprec 回復、
//     満タン覚醒、被弾即覚醒(attackMonster)。WORM は SP 消費なし=眠らない。
//  D. 現行の spd≦1 隔ターン cd スロットルは撤去。SPD 剰余は WORM の tk%3 が唯一の適用。
//  E. 活動範囲: 自機から両軸 ±16 の箱(MONSTER_ACTIVE_RANGE、by.java:227-229 verbatim)内の個体
//     のみターン処理(徘徊・攻撃・SP回復・睡眠・土中 tick)。圏外は完全凍結(tk/rc も進まない)。
//     BURIED_WAKE_RANGE(4) は撤去しこの活動箱へ統一。despawn=x・y 両軸とも ±28 圏外のとき
//     splice(MONSTER_DESPAWN_RANGE、by.java:170-172 の逐語 AND。片軸のみでは消えない)。毎ターン
//     全個体対象、補充なし。
//  F. 決定論: 徘徊方向・全確率ゲートは個体別ロールカウンタ rc の monsterAiRoll(tiles.js)で確定。
//  G. 接地種(BAT 以外)に重力導入(下が空間なら徘徊より先に 1 マス落下、落下ターンは攻撃しない。
//     落下先が自機セルなら偶発バンプ経路で攻撃)。tileType/girlPositions/oreAt/hazardAt/流体/
//     なだれ/埋没機構(v0.17.0)/moveTo/act/女の子追従/崩落再埋没は不変。
// v0.19.0: ランタイムスポーンの原作合わせ(正本 spec §5 by.java:204-211、STATUS v0.19.0 判断
// A〜D、チケット #124、差分台帳キュー 3 位)。v0.18.0 で導入した despawn(両軸 AND ±28 圏外)には
// 補充源がなく大マップで人口が漸減する片肺状態だった。原作はこの 30% 追加湧きとセットで人口が
// 回る設計:
//  A. resolveTurn 末尾(monstersAct の直後、原作 by.a() 末尾と同位置)でプレイヤー行動ごとに 30%
//     判定 → 自機位置基準の非対称オフセット(rand[0,55]+player−28 → 実効レンジ [-28,+27] verbatim)
//     → x∈[1,GRID_COLS-2]/y∈[11,DEPTH_ROWS-2] へ clamp(by.java:205-206 verbatim。y≧11 はクランプの
//     帰結であり「11 未満なら不成立」ではない)→ 活動箱 16 のいずれかの軸が圏外(OR)なら成立
//     (by.java:207 verbatim。despawn の両軸 AND とは非対称=原作の癖をそのまま採る)。
//  B. 未占有判定: 対象マス中心 Chebyshev 2(5x5)以内にモンスター(埋没含む)/未救出の女の子が
//     居ないこと(by.java:207 !a(nVar,iA,iA2) verbatim)。ah()(overlay 層空きチェック)は port に
//     同型レイヤーが無いため対象外(翻案)。
//  C. 地形分岐: 対象マスが NONE(空間)なら生成時の空間テーブルと同一重み(runtimeSpawnSpecies
//     wantBury=false)で可視個体を追加、SOIL/HARD/ROCK(固体)なら埋没テーブル(wantBury=true)で
//     埋没個体(buried=true、spawnBuriedMonsters と同じ state 構造)を追加。by.java 自体は地形で
//     絞っていない(nVar.f.a() が対象セルの地形を見て解決する)。advisor 指摘: 大マップの 16〜28
//     リングはほぼ未掘の固体なので、NONE 限定にすると湧きがほぼ発生せず despawn を相殺できない。
//  D. 決定論: spaceMonsterAt/buryMonsterAt の位置(col,row,seed)固定 presence ハッシュは流用しない
//     (使い回すと既存個体と同一セルへの重複配置か、despawn 済み個体の決定論復活にしかならず新規
//     人口を足せない=advisor 指摘)。行動カウンタ G.spawnRollCount(resolveTurn ごとに+1、
//     startDive で 0 リセット)を鍵にした専用ストリーム(tiles.js runtimeSpawnChanceRoll 等)を新設。
const VERSION = "v0.19.0";

// ---- CONSTANTS(lead 確定値。単一ブロックに集約。playtester 実測で微調整は可だが構造不変) ----
const CONST = {
  GRID_COLS: 15, // 裏庭 WIDTH(dungeon_info ID0)。横の列数。
  DEPTH_ROWS: 15, // 裏庭 FLOOR。地表行(row 0)とは別に深度 1..15。
  STAMINA_MAX: 100, // スタミナ最大(普段これで動く)。
  HP_MAX: 30, // 体力最大(スタミナ切れ後の緊張ゾーン)。
  DIG_SOIL: 1, // 土の掘削手数。
  DIG_HARD: 2, // 硬土の掘削手数。硬岩は掘れない。
  SP_PER_ACTION: 1, // 移動 1 / 掘り 1 手ごとに 1 消費(SP 切れなら HP が減る)。
  // タイル種別の掘削手数(TILE_DIG_KEY と整合)。ROCK は v0.4.0 で鉄ツルハシ以上が掘れる。
  DIG_TAPS: { SOIL: 1, HARD: 2, ROCK: 3 },
  GIRL_COUNT: 5, // 裏庭(dungeon_info ID0)= 5 人(一次データで確認)。
  CLEAR_EXPLORE: 1.0, // クリアに要る探索率(§7=100%。実機計測で到達可能性を確認し調整)。
  BASE_SEED: 41027, // 決定論シードの基底(Math.random/Date.now 厳禁)。
  VISIBLE_RADIUS: 2, // 自機周囲この半径を可視化(fog を晴らす)。
  LONGPRESS_MS: 320, // 予備(将来の長押し操作用、現状未使用)。
  TAP_MAX_MOVE: 18, // タップ判定の移動許容(px)。
  // v0.4.0 アイテム系。
  INIT_PICK: "WOOD", // 初期ツルハシ(木 power1、岩は掘れない)。
  // v0.14.0: 回復薬(原作に無い独自アイテム)は廃し、item.csv 実在の飲食で置換(判断B)。
  ROAST_HEAL: 40, // 焼き肉の体力回復量(item.csv HP40 verbatim、HP_MAX で頭打ち)。
  BLOOD_HEAL: 30, // 動物の血の体力回復量(item.csv HP30 verbatim、HP_MAX で頭打ち)。
  // v0.5.0 戦闘(CSV→実装の翻案。厳密式は原作資料に明記なし=忠実意図に沿わせた自前式)。
  // 自機は原作の STR/DEF/PER_ATTACK/PER_DEFENCE を持たない(育成未実装)ため、所持ツルハシ
  // power を戦力の代理にする。power1(木)→ATK2/DEF0、段が上がるほど攻防が増える(掘削と戦闘の
  // 強化が一本=「強い道具で深く潜れる」原作の手触りに沿う)。
  ATK_BASE: 1, // 自機攻撃力 = ATK_BASE + pickPower()。木=2 / 石=3 / 鉄=4 / ダイヤ=6。
  DEF_BASE: 0, // 自機防御力 = DEF_BASE + floor((pickPower()-1)/2)。木=0 / 石=0 / 鉄=1 / ダイヤ=2。
  GIRL_HP: 30, // 護衛中の女の子の HP(monster.csv GIRL 行 verbatim=30)。GIRLATK で削られる。
  // v0.18.0 モンスター活動範囲/despawn(原作 verbatim、STATUS v0.18.0 判断 E)。v0.17.0 の
  // BURIED_WAKE_RANGE(4、原作 16 の半分スケール前提)は、DUNGEONS 寸法が原作 dungeon_info.csv と
  // 同一と照合されて前提が崩れたため撤去し、原作の活動箱 1 本(土中 tick 含む全ターン処理を律速)
  // へ統一した。
  MONSTER_ACTIVE_RANGE: 16, // 活動箱: 自機から両軸 ±16(Chebyshev 16、by.java:227-229 verbatim)内の
  // 個体のみターン処理(徘徊・攻撃・SP回復・睡眠・土中 tick)。圏外は完全凍結(tk/rc も進まない)。
  MONSTER_DESPAWN_RANGE: 28, // despawn: x・y 両軸とも ±28 圏外のとき除去(by.java:170-172 の逐語
  // AND=片軸のみ圏外では消えない、という原作の癖をそのまま)。毎ターン全個体対象、補充なし。
  // v0.16.0 水/マグマ(原作合わせ、spec §4)。旧 v0.6.0 の SP 割増(WATER_SP_MULT/MAGMA_SP_MULT/
  // MAGMA_HP_CHIP/SWIM_MITIGATION)は撤去=移動コスト側の割増は原作に無い。浸水の消耗は HP 直撃:
  // 水は swimTurns() ターンまで無傷→超過後 drownDamage()/ターン、マグマは猶予なし maxHP/5 /ターン。
  SWIM_BREATH_BASE: 5, // 息の基礎ターン数(原作 SWIM 初期値は jadx 欠落=「掘り抜き水没から 1 往復戻れる猶予」の翻案)。
  SWIM_BREATH_PER_LV: 5, // PER_SWIM 1 Lv あたりの息延長ターン(原作 SWIM 値 0..20 を Lv0..4 ×5 に直写像)。
  DROWN_DMG_BASE: 4, // 息切れ後の毎ターン HP 直撃量の基礎(原作 clamp(4 − SWIM/5, 1, 4) の 4)。
  MAGMA_HP_DIV: 5, // マグマの毎ターン HP 直撃 = ceil(effHpMax()/これ)(原作 maxHP/5 = 5 ターンで死)。
  // v0.7.0 なだれ/落盤 崩落物理(原作: なだれ土=支えを失うと崩れ落ちる不安定な土。落下で自機/女の子を
  // 埋めてダメージ + 掘った道を塞ぐ)。崩落ダメージ係数は CONST 単一ブロックに集約し、将来の育成
  // (支え木/落盤回避)増分が CAVEIN_MITIGATION を 1 点で割れるよう caveinDamage() ヘルパーへ切り出す。
  CAVEIN_DAMAGE: 8, // 落ちてきた不安定土に自機が埋まったときの被ダメージ(takeDamage 経路=二段ゲージへ)。
  CAVEIN_MITIGATION: 1.0, // 崩落軽減(未実装の別増分=ベースライン 1.0 固定、軽減なし=育成フック)。
  // v0.8.0 商人(物々交換)。キノコ採取で得た商品(消耗品)の回復量。原作 item.csv の HP 値に寄せる
  // (フルーツ HP25 / 夢キノコ HP10 だが本実装は HP_MAX=30 のため min で頭打ち=回復薬と同じ翻案)。
  FRUIT_HEAL: 25, // フルーツの体力回復量(原作 HP+25、HP_MAX=30 で頭打ち)。
  DREAM_HEAL: 30, // 夢キノコの体力回復量(高級回復=実質全回復、HP_MAX で頭打ち)。
  // v0.10.0 仲間同行(原作 §5: 一緒に戦い EXP 蓄積→地上で別れて EXP に応じてレベルアップ)。同行 EXP の
  // レベル換算・援護攻撃力・レベル上限を CONST 単一ブロックに集約し、将来増分(永続/別ダンジョン)が
  // 1 点で動かせるよう effCompanionAtk()/companionLevelGain() のヘルパーへ切り出す(ハードコードを散らさない)。
  COMPANION_EXP_PER_LV: 10, // 同行中に貯めた経験値 10 ごとに仲間が 1 レベル上がる(地表で別れた瞬間に清算)。
  COMPANION_ATK_PER_LV: 1, // 同行中の仲間レベル 1 につき自機攻撃力へ +1 援護(原作「一緒に戦う」=戦力になる)。
  COMPANION_LV_MAX: 9, // 仲間レベルの上限(ランごとリセット=save 永続は §2-5 番の別増分)。
  // v0.14.0 アンテナ(設置型 + 電波網 + 保険、item.csv ID3「設置すると地上からの電波がより遠くまで
  // 届く。電波が届く範囲にいれば力尽きてもアイテムをロストしない」)。R0/R の実数値は原作資料に
  // 明記が無いため翻案(実装時記録): 全9ダンジョンは深度(DEPTH_ROWS)が15〜99と大きく異なるため
  // 固定値では小さいダンジョンで過大・大きいダンジョンで過小になる。→ 深度比例(ANTENNA_R0_FRAC/
  // ANTENNA_R_FRAC)で applyDungeonConst が動的に ANTENNA_R0/ANTENNA_R を算出する(下限あり)。
  ANTENNA_MAX: 20, // 1 ダンジョンに設置できるアンテナの上限(仕様まとめ §8 忠実)。
  ANTENNA_R0_FRAC: 0.2, // 地表からの基礎電波到達深度 = DEPTH_ROWS のこの割合(最低 ANTENNA_R0_MIN)。
  ANTENNA_R0_MIN: 3,
  ANTENNA_R_FRAC: 0.28, // アンテナ1本の中継半径 = DEPTH_ROWS のこの割合(最低 ANTENNA_R_MIN)。
  ANTENNA_R_MIN: 4,
  ANTENNA_R0: 3, // 実値は applyDungeonConst で上書き(ここはフォールバック=裏庭相当)。
  ANTENNA_R: 4,
};
// 計測 bot から係数を上書きできるよう公開(本番挙動は CONST の初期値で確定)。
if (typeof window !== "undefined") window.CONST = CONST;

// ---- アセット(Kenney CC0 スプライト + 効果音 + BGM) ---------------------
// フルリスキン(v0.2.0): 矩形塗りを Kenney タイル/キャラスプライトに差し替える。
// 画像は同一オリジン(/mineroad/assets/)。読込前 or 失敗時は PALETTE 矩形へ自動 fallback
// するので、画像なしでもゲームは成立する(描画は壊れない)。
// fog(未可視は暗い)は原作忠実(「掘ると視界が開ける」仕様 L20/L107)なので維持。
const SPRITE_SRC = {
  surface: "/mineroad/assets/tiles/surface.png", // 地表(緑トップ・安全行)
  soil: "/mineroad/assets/tiles/soil.png", // 土(1 手・茶)
  hard: "/mineroad/assets/tiles/hard.png", // 硬土(2 手・ティール灰で別素材感)
  rock: "/mineroad/assets/tiles/rock.png", // 硬岩(掘れない・灰石)
  miner: "/mineroad/assets/chars/miner.png", // 自機(alienBeige)
  girl: "/mineroad/assets/chars/girl.png", // 女の子(alienPink・暖色グロー併用)
};
const SPRITES = {};
function loadSprites() {
  if (typeof Image === "undefined") return;
  for (const k of Object.keys(SPRITE_SRC)) {
    const img = new Image();
    img.src = SPRITE_SRC[k];
    SPRITES[k] = img;
  }
}
// 描画可能(読込完了 & デコード成功)か。未完了なら呼び出し側が矩形 fallback。
function spriteReady(k) {
  const img = SPRITES[k];
  return !!(img && img.complete && img.naturalWidth > 0);
}

// 効果音: 意味の確実なものだけ採用。clear/fail のジングルは聴取不能のため暫定
// (NES 系、差し替え可)。同一オリジン ogg。読込/再生失敗は握りつぶす(無音で成立)。
const SFX_SRC = {
  dig1: "/mineroad/assets/sfx/dig1.ogg",
  dig2: "/mineroad/assets/sfx/dig2.ogg",
  blocked: "/mineroad/assets/sfx/blocked.ogg",
  found: "/mineroad/assets/sfx/found.ogg",
  heal: "/mineroad/assets/sfx/heal.ogg",
  clear: "/mineroad/assets/sfx/clear.ogg",
  fail: "/mineroad/assets/sfx/fail.ogg",
};
const SFX_VOL = { dig1: 0.4, dig2: 0.4, blocked: 0.5, found: 0.6, heal: 0.5, clear: 0.7, fail: 0.6 };
const SFX = {};
let audioOn = true; // mute トグル(BGM + SFX をまとめて on/off)。
let digToggle = 0; // dig1/dig2 を交互に鳴らして単調さを避ける。
function loadAudio() {
  if (typeof Audio === "undefined") return;
  for (const k of Object.keys(SFX_SRC)) {
    const a = new Audio(SFX_SRC[k]);
    a.preload = "auto";
    SFX[k] = a;
  }
}
function playSfx(k) {
  if (!audioOn) return;
  const base = SFX[k];
  if (!base) return;
  // 単一 Audio 要素を currentTime=0 で連打すると一部モバイルで途中から鳴らなくなる
  // ため、毎回 cloneNode した使い捨て要素で鳴らす(再生後 GC)。プリロード済みの base を
  // 複製するのでキャッシュから即時再生。
  try {
    const a = base.cloneNode(true);
    a.volume = SFX_VOL[k] != null ? SFX_VOL[k] : 0.5;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    /* 再生不可環境でも進行は可能 */
  }
}
function playDig() {
  playSfx(digToggle++ % 2 === 0 ? "dig1" : "dig2");
}

// BGM(maou_14 shining star、ループ・低音量)。モバイル autoplay 制約のため初回の
// ユーザー操作(ダイブ開始ボタン)起点でのみ start する。
let bgm = null;
function startBgm() {
  if (typeof Audio === "undefined") return;
  if (!bgm) {
    bgm = new Audio("/mineroad/assets/bgm/theme.ogg");
    bgm.loop = true;
    bgm.volume = 0.18;
  }
  if (!audioOn) return;
  try {
    const p = bgm.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    /* 自動再生不可でも進行は可能 */
  }
}
function setAudioOn(on) {
  audioOn = on;
  if (bgm) {
    if (on) {
      try {
        const p = bgm.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* noop */
      }
    } else {
      bgm.pause();
    }
  }
}

const BEST_DEPTH_KEY = "mineroad_best_depth";
const RESCUE_KEY = "mineroad_rescued_total";
const HOWTO_KEY = "mineroad_seen_howto";

// ---- 日本語テキスト(verbatim、canvas に焼かず DOM へ) -----------------
const TEXT = {
  title: "マインロード",
  start: "もぐる",
  howtoButton: "あそびかた",
  howtoTitle: "あそびかた",
  howto: [
    "十字キー、または画面のとなりのマスをタップして掘る／進む。",
    "土と硬土は掘ると道になる。硬岩は掘れない。",
    "足元が空（くう）になると落ちる。掘った跡が帰り道になる。",
    "行動するたびスタミナが減る。スタミナが尽きると体力が減りはじめる。体力ゼロで力尽きる。",
    "地表（いちばん上の明るい行）に戻るとスタミナも体力も全回復。どこまで潜って引き返すかが肝。",
    "深くに女の子が5人埋まっている。掘り当てると付いてくる。地表まで連れ帰ろう。",
    "5人すべて救出し、最下層まで掘り進み、探索率を100%にして地表へ戻るとダンジョン制覇。",
  ],
  howtoStart: "もぐる",
  howtoBack: "もどる",
  depthPrefix: "深度 ",
  depthSuffix: " 層",
  rescueLabel: "救",
  exploreLabel: "探索",
  staminaCap: "スタミナ",
  hpCap: "体力",
  cueGirlFound: "女の子を見つけた。地表へ連れ帰ろう",
  cueGirlBlocked: "道がふさがって女の子がはぐれた。掘り直そう",
  cueHpZone: "スタミナ切れ。ここから体力が減る",
  cueSurface: "地表。全回復した",
  cueRockHit: "硬岩は掘れない",
  cueWater: "水の中。息が続く間は無事。息が切れると体力が削られる",
  cueMagma: "マグマの中。体力が激しく削られる。長居は死ぬ",
  cueDrown: "息が切れた。体力が削られていく。早く水から出よう",
  cueShop: "商人。キノコや鉱石を道具と交換できる",
  failTitle: "力尽きた",
  failSub: "地表へ戻れなかった",
  retry: "もういちど",
  clearTitle: "ダンジョン制覇",
  clearSub: "裏庭の女の子5人を全員救出・最下層到達・探索率100%",
  again: "もういちど潜る",
  bestDepthPrefix: "最深 ",
  bestDepthSuffix: " 層",
  bestRescuePrefix: "救出 ",
  bestRescueSuffix: " 人",
  nextDungeon: "次のダンジョンへ",
  backToTitle: "タイトルへ",
  dungeonUnlocked: "新しいダンジョンが解放された",
  selectDungeon: "ダンジョンを選ぶ",
};

// ---- DOM 参照 ----------------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const depthValEl = document.getElementById("depth-val");
const rescueValEl = document.getElementById("rescue-val");
const exploreValEl = document.getElementById("explore-val");
const expValEl = document.getElementById("exp-val");
const staminaFillEl = document.getElementById("stamina-fill");
const staminaValEl = document.getElementById("stamina-val");
const hpFillEl = document.getElementById("hp-fill");
const hpValEl = document.getElementById("hp-val");
const gaugeEl = document.querySelector(".gauge");
const hudHintEl = document.getElementById("hud-hint");

const overlayEl = document.getElementById("overlay");
const panelEl = overlayEl.querySelector(".panel");
const ovTitleEl = document.getElementById("ov-title");
const ovSubEl = document.getElementById("ov-sub");
const ovHowtoEl = document.getElementById("ov-howto");
const ovActionEl = document.getElementById("ov-action");
const ovAction2El = document.getElementById("ov-action2");
const ovVersionEl = document.getElementById("ov-version");

const btnUpEl = document.getElementById("btn-up");
const btnDownEl = document.getElementById("btn-down");
const btnLeftEl = document.getElementById("btn-left");
const btnRightEl = document.getElementById("btn-right");
const btnSurfaceEl = document.getElementById("btn-surface");
const btnMuteEl = document.getElementById("btn-mute");

// v0.4.0 インベントリ + クラフト DOM 参照。v0.14.0: 鉱石 4 種→原作実名 6 種(石炭/鉄鉱石/化石/鋼/ルビー/ダイヤ)へ。
const invEl = document.getElementById("inventory");
const oreCoalEl = document.getElementById("ore-coal");
const oreIronEl = document.getElementById("ore-iron");
const oreFossilEl = document.getElementById("ore-fossil");
const oreSteelEl = document.getElementById("ore-steel");
const oreRubyEl = document.getElementById("ore-ruby");
const oreDiamondEl = document.getElementById("ore-diamond");
const pickIcoEl = document.getElementById("pick-ico");
const btnCraftEl = document.getElementById("btn-craft");
const ladderValEl = document.getElementById("ladder-val");
const btnLadderEl = document.getElementById("btn-ladder");
// v0.14.0: アンテナは設置型(はしごと同じ設置/回収トグル)。回復薬(btn-potion)は判断Bにより廃止。
const antennaValEl = document.getElementById("antenna-val");
const btnAntennaEl = document.getElementById("btn-antenna");
const craftOverlayEl = document.getElementById("craft-overlay");
const craftListEl = document.getElementById("craft-list");
const craftCloseEl = document.getElementById("craft-close");

// v0.8.0 商人(物々交換)DOM 参照。クラフトと同じ工房オーバーレイにタブで同居(上部バーにボタンを
// 増やさない=既存ボタン x 位置/地表タップ前提を壊さない)。商人タブ・キノコ通貨表示・消耗品を扱う。
const mushValEl = document.getElementById("mush-val");
const shopListEl = document.getElementById("shop-list");
const tabCraftEl = document.getElementById("tab-craft");
const tabShopEl = document.getElementById("tab-shop");

// v0.9.0 育成(Lv.UP)DOM 参照。工房オーバーレイの第3タブに同居(上部バーのボタンは増やさない)。
const infoValEl = document.getElementById("info-val");
const growListEl = document.getElementById("grow-list");
const tabGrowEl = document.getElementById("tab-grow");

// v0.10.0 仲間同行 DOM 参照。工房オーバーレイの第4タブに同居(上部バーのボタンは増やさない=gate G 非退行)。
const companionListEl = document.getElementById("companion-list");
const tabCompanionEl = document.getElementById("tab-companion");

// v0.14.0 アイテムタブ DOM 参照。工房オーバーレイの第5タブに同居(45種カタログの読み取り専用 BAG ビュー)。
const itemListEl = document.getElementById("item-list");
const tabItemsEl = document.getElementById("tab-items");

// ---- canvas / 描画状態 -------------------------------------------------
let DPR = 1;
let W = 0;
let H = 0;
let lastT = 0;
let tile = 28; // タイル一辺(px)。resize で W/GRID_COLS から決める。
let camY = 0; // カメラ縦オフセット(行単位、自機追従)。
// 上部 HUD 帯(深度 / 二段ゲージ / インベントリ)の高さ(px)。地表でこの帯ぶん世界を下げ、
// 自機・体力バー・インベントリとの被りを無くす(カメラに負ヘッドルームを許す)。
// インベントリは clamp+vw でスケールし rem 推定とずれるため、実値は render で invEl の実
// bottom から確定する(下記 hudBandMeasured)。ここでは計測前のフォールバック推定のみ。
const HUD_BAND_REM = 8;
let hudBandPx = HUD_BAND_REM * 16;
let hudBandMeasured = false;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  tile = W / CONST.GRID_COLS;
  // フォールバック: root font-size 基準の概算。実値は render で invEl bottom から確定。
  const remPx =
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  hudBandPx = HUD_BAND_REM * remPx;
  hudBandMeasured = false; // viewport 変化で再計測。
}

// ---- 色補間 ------------------------------------------------------------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

// ---- ゲーム状態 --------------------------------------------------------
// screen: "title" / "howto" / "dive" / "fail" / "clear"。
const G = {
  screen: "title",
  seed: CONST.BASE_SEED, // 縦切りは固定シード(力尽き → 同じ盤面で再挑戦)。
  px: 7, // 自機の列(0..GRID_COLS-1)。
  py: 0, // 自機の行(0 = 地表)。
  stamina: CONST.STAMINA_MAX,
  hp: CONST.HP_MAX,
  dug: null, // Set("col,row") 掘削済み(空間化した)タイル。
  digProgress: null, // Map("col,row" -> 残り掘削手数)。
  seen: null, // Set("col,row") 一度でも可視になったタイル(探索率 + fog 解除)。
  girls: null, // [{col,row,origRow,state}, ...] state: "hidden"/"following"/"rescued"。
  rescued: 0, // このランで救出した数(全員 = CONST.GIRL_COUNT でクリア要件①)。
  maxDepthThisDive: 0,
  busy: false, // overlay 遷移中などの入力ロック。
  enteredHpZone: false, // スタミナ切れ通知を一度だけ出すフラグ。
  totalTiles: 0, // 探索率の分母(GRID_COLS * DEPTH_ROWS)。
  // ---- v0.4.0 インベントリ(ランごと初期化。fail/再挑戦でリセット、save モデルは次増分) ----
  ore: null, // { COAL, IRON_ORE, FOSSIL, STEEL, RUBY, DIAMOND } 鉱石所持数(v0.14.0 原作実名6種)。
  pick: "WOOD", // 所持する最強ツルハシの段(PICK のキー)。power ゲートに直結。
  ladders: 0, // はしご所持数(縦穴を登る移動補助。クラフトで増える)。
  // ---- v0.14.0 アンテナ(設置型)。所持数 + 設置済み位置。1 ダンジョン上限 ANTENNA_MAX(仕様まとめ §8
  // 「1ダンジョン最大20本、連結で範囲拡張」)。fail を跨いで位置が残る(保険の実用性の核、判断C)。クリアで消去。 ----
  antennaItems: 0, // 未設置の所持アンテナ数(設置で消費)。
  placedAntennas: null, // Set("col,row") 設置済みアンテナ位置。fail を跨いで残す(startDive ではクリアしない)。
  // ---- v0.5.0 モンスター系(ランごと初期化。fail/再挑戦でリセット = 既存スコープ境界踏襲) ----
  monsters: null, // [{key,col,row,hp,kind}, ...] 出現中のモンスター。kind: "space"/"bury"。
  spawned: null, // Set("col,row") 既に空間/埋没スポーンを解決したマス(二重スポーン防止)。
  exp: 0, // 撃破で蓄積する EXP(育成未実装のため表示のみ)。
  kills: 0, // 撃破数(参考表示)。
  drops: null, // { 素材名: 個数 } 撃破ドロップ(表示のみ、商人/クラフト連携は次増分)。
  // ---- v0.6.0 浸水ハザード(自機が今いるマスの浸水種。種が変わった時だけヒントを 1 回出す) ----
  lastHazard: 0, // 直前の自機マスの HAZARD 種(HAZARD.NONE/WATER/MAGMA)。連続滞在でヒント連発を抑止。
  // ---- v0.16.0 流体(ダイブ内ランタイム state。セーブ対象外=savePersistent に入れない) ----
  fluid: null, // Map("col,row" → {k: HAZARD.WATER|MAGMA, d: 1..8})。流動セルオートマトンの実体。
  fluidReleased: null, // Set("col,row") 掘り当て湧出を解決済みのマス(再掘での無限湧き防止=1 マス 1 回限り)。
  breath: 0, // 水中滞在ターンカウンタ(原作 c[34])。swimTurns() 超過で毎ターン HP 直撃、水から出ると 0。
  drownNoted: false, // 息切れヒントの 1 回フラグ(lastHazard 流儀)。水から出るとリセット。
  // ---- v0.7.0 なだれ/落盤 崩落物理(掘削後に動的にタイル状態が変わる。初期生成系列には触れない) ----
  unstableDug: null, // Set("col,row") 掘り抜いた不安定土(なだれ土)マス。真下が空くと落下する候補。
  fallen: null, // Set("col,row") 崩落で塞がれた(土に戻った)マス。掘り直し可だが帰り道は消える。
  // ---- v0.8.0 商人(物々交換)。キノコ通貨はランごと初期化(fail/再挑戦でリセット = 既存スコープ境界踏襲) ----
  mushrooms: 0, // キノコ所持数(交換通貨。SOIL 掘り抜きで採取、商人で道具/夢キノコと交換)。
  dreamMushrooms: 0, // 夢キノコ所持数(キノコ100→1 で統合した高額通貨/高級回復実)。
  fruits: 0, // フルーツ所持数(商人で鉄鉱石2 と交換した回復消耗品)。
  roastMeat: 0, // v0.14.0: 焼き肉所持数(商人で鋼2と交換 or 生肉のマグマ変化で得る回復消耗品)。
  // ---- v0.9.0 育成(PER_* レベルアップ。ランごと初期化=セーブ永続は §2-5 番の別増分) ----
  info: 0, // 救出した女の子の「情報」ストック(救出成立で +1、BP へ変換すると消費)。
  bp: 0, // ボーナスポイント(裏庭=BP100% に忠実な汎用ポイント。情報/EXP から変換、PER_* に振る)。
  per: null, // { HP, ST, DIG, ATTACK, DEFENCE, SWIM } 各 PER の現レベル(0 始まり)。effXxx が参照。
  // ---- v0.10.0 仲間同行(ランごと初期化=セーブ永続は §2-5 番の別増分) ----
  // companion は following 中の女の子1人への参照(1人だけ=原作忠実)。EXP の帰属先 + 帰還清算対象を
  // 指すだけで、移動/戦闘巻き込まれ/ロストの物理は既存 following レイヤーがそのまま担う(非介入)。
  // 各 girl は level(同行レベル)/cexp(同行中に貯めた経験値) を持つ(startDive 初期化)。
  companion: null, // 同行中の女の子(G.girls の要素を指す)。未指定なら null=既存挙動に完全一致。
  // ---- v0.13.0 ダンジョン選択・解放チェーン ----
  dungeonId: 0,
  cleared: null, // Set(dungeonId) クリア済みダンジョン。
  unlocked: null, // Set(dungeonId) 解放済みダンジョン。
};
window.G = G;

// ---- localStorage ------------------------------------------------------
function getInt(key) {
  try {
    return parseInt(localStorage.getItem(key) || "0", 10) || 0;
  } catch (e) {
    return 0;
  }
}
function setInt(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch (e) {
    /* localStorage 不可環境でもゲームは成立(記録のみ諦める) */
  }
}
function seenHowto() {
  try {
    return localStorage.getItem(HOWTO_KEY) === "1";
  } catch (e) {
    return false;
  }
}
function markHowtoSeen() {
  try {
    localStorage.setItem(HOWTO_KEY, "1");
  } catch (e) {
    /* 記録できなくても進行は可能 */
  }
}

// ---- v0.13.0 ダンジョン CONST 動的設定 ----------------------------------
function applyDungeonConst(id) {
  const d = DUNGEON_DATA[id];
  if (!d) return;
  CONST.GRID_COLS = d.cols;
  CONST.DEPTH_ROWS = d.rows;
  CONST.GIRL_COUNT = d.girls;
  CONST.DUNGEON_ID = id;
  // v0.14.0: アンテナの電波範囲はダンジョン深度(15〜99)に比例させる(固定値は規模差で破綻するため)。
  CONST.ANTENNA_R0 = Math.max(CONST.ANTENNA_R0_MIN, Math.round(d.rows * CONST.ANTENNA_R0_FRAC));
  CONST.ANTENNA_R = Math.max(CONST.ANTENNA_R_MIN, Math.round(d.rows * CONST.ANTENNA_R_FRAC));
}

// ---- v0.13.0 ダンジョン進捗(クリア/解放チェーン) -------------------------
const PROGRESS_KEY = "mineroad_progress";
function saveDungeonProgress() {
  try {
    const data = {
      v: 1,
      cleared: G.cleared ? [...G.cleared] : [],
      unlocked: G.unlocked ? [...G.unlocked] : [0],
      currentDungeon: G.dungeonId,
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch (e) { /* noop */ }
}
function loadDungeonProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return;
    G.cleared = new Set(data.cleared || []);
    G.unlocked = new Set(data.unlocked || [0]);
    G.dungeonId = data.currentDungeon || 0;
  } catch (e) { /* noop */ }
}

// ---- v0.12.0 セーブ/永続(力尽き跨ぎ。ダンジョンごとに分離) ---------------
const SAVE_KEY_PREFIX = "mineroad_save_";
function saveKeyForDungeon(id) { return SAVE_KEY_PREFIX + id; }
function savePersistent() {
  try {
    const girls = (G.girls || [])
      .map((g, i) => (g.state === "rescued" ? { i, level: g.level || 0, cexp: g.cexp || 0 } : null))
      .filter(Boolean);
    const data = {
      v: 1,
      rescued: G.rescued || 0,
      per: G.per ? { ...G.per } : { HP: 0, ST: 0, DIG: 0, ATTACK: 0, DEFENCE: 0, SWIM: 0 },
      info: G.info || 0,
      bp: G.bp || 0,
      pick: G.pick || CONST.INIT_PICK,
      girls: girls,
    };
    localStorage.setItem(saveKeyForDungeon(G.dungeonId), JSON.stringify(data));
  } catch (e) {
    /* localStorage 不可環境でもゲームは成立(保存のみ諦める) */
  }
}
function loadPersistent() {
  try {
    let raw = localStorage.getItem(saveKeyForDungeon(G.dungeonId));
    if (!raw && G.dungeonId === 0) {
      raw = localStorage.getItem("mineroad_save");
      if (raw) localStorage.removeItem("mineroad_save");
    }
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return;
    G.rescued = data.rescued || 0;
    G.per = data.per || { HP: 0, ST: 0, DIG: 0, ATTACK: 0, DEFENCE: 0, SWIM: 0 };
    G.info = data.info || 0;
    G.bp = data.bp || 0;
    if (data.pick && PICK[data.pick]) G.pick = data.pick;
    if (data.girls && G.girls) {
      for (const sg of data.girls) {
        if (sg.i >= 0 && sg.i < G.girls.length) {
          G.girls[sg.i].state = "rescued";
          G.girls[sg.i].level = sg.level || 0;
          G.girls[sg.i].cexp = sg.cexp || 0;
        }
      }
    }
    G.stamina = effStaminaMax();
    G.hp = effHpMax();
  } catch (e) {
    /* 破損/不正データでも進行可能(永続なし扱い) */
  }
}
function clearPersistent() {
  try {
    localStorage.removeItem(saveKeyForDungeon(G.dungeonId));
  } catch (e) {
    /* noop */
  }
}

// ---- ダイブ開始 --------------------------------------------------------
function startDive() {
  applyDungeonConst(G.dungeonId);
  resize();
  G.seed = CONST.BASE_SEED + G.dungeonId;
  G.px = Math.floor(CONST.GRID_COLS / 2);
  G.py = 0;
  // v0.9.0 育成初期化(ランごと。fail/再挑戦でリセット=既存スコープ境界踏襲、save モデルは次増分)。
  // hp/stamina の満タン充填より先に per を 0 へ戻し、effHpMax/effStaminaMax が素の CONST を返すように
  // する(育成前=既存挙動に完全一致。全 PER レベル 0 で既存ゲート A〜Y が不変)。
  G.info = 0;
  G.bp = 0;
  G.per = { HP: 0, ST: 0, DIG: 0, ATTACK: 0, DEFENCE: 0, SWIM: 0 };
  G.stamina = effStaminaMax();
  G.hp = effHpMax();
  G.dug = new Set();
  G.digProgress = new Map();
  G.seen = new Set();
  G.girls = girlPositions(G.seed).map((p) => ({
    col: p.col,
    row: p.row,
    origCol: p.col, // v0.5.0: ロスト時に元の埋没位置へ戻すため保持(再発見可能性を担保)。
    origRow: p.row,
    state: "hidden",
    hp: CONST.GIRL_HP, // v0.5.0: 護衛中に GIRLATK で削られうる(monster.csv GIRL=30)。
    level: 0, // v0.10.0: 同行レベル(地表で別れた瞬間 cexp から清算。ランごとリセット)。
    cexp: 0, // v0.10.0: 同行中に貯めた経験値(撃破ごとに加算、帰還で level へ変換)。
    trailIdx: 0, // v0.11.0: 追従中に消化した自機足跡履歴のインデックス。
  }));
  G.rescued = 0;
  G.maxDepthThisDive = 0;
  G.busy = false;
  G.enteredHpZone = false;
  G.totalTiles = CONST.GRID_COLS * CONST.DEPTH_ROWS;
  // v0.4.0 インベントリ初期化(ランごと。fail/再挑戦でリセット = v0.3.0 スコープ境界踏襲)。
  G.ore = { COAL: 0, IRON_ORE: 0, FOSSIL: 0, STEEL: 0, RUBY: 0, DIAMOND: 0 };
  G.pick = CONST.INIT_PICK;
  G.ladders = 0;
  G.antennaItems = 0; // v0.14.0: アンテナ所持数(ランごとリセット。設置済み位置は別途 loadAntennas で復元)。
  // v0.5.0 モンスター初期化。空間スポーンは盤面確定時に決定論で配置(NONE マス全走査)。
  G.monsters = [];
  G.spawned = new Set();
  G.spawnRollCount = 0; // v0.19.0: ランタイムスポーンの行動カウンタ(resolveTurn ごとに+1)。
  G.exp = 0;
  G.kills = 0;
  G.drops = {};
  G.lastHazard = HAZARD.NONE; // v0.6.0: 地表スタートは浸水なし。
  // v0.16.0 流体初期化(ダイブ内ランタイム state=セーブ対象外)。初期空間(tileType NONE)かつ
  // hazardAt≠NONE のマスへ満水 d=8 で播種(判断 A。hazardAt は初期配置抽選として温存=非介入)。
  G.fluid = new Map();
  G.fluidReleased = new Set();
  G.breath = 0;
  G.drownNoted = false;
  seedFluids();
  G.unstableDug = new Set(); // v0.7.0: 掘り抜いた不安定土(落下候補)。
  G.fallen = new Set(); // v0.7.0: 崩落で塞がれたマス。
  G.mushrooms = 0; // v0.8.0: キノコ通貨(SOIL 掘り抜きで採取)。
  G.dreamMushrooms = 0; // v0.8.0: 夢キノコ(キノコ100 から統合)。
  G.fruits = 0; // v0.8.0: フルーツ(商人で鉄鉱石2 と交換)。
  G.roastMeat = 0; // v0.14.0: 焼き肉(商人交換 or 生肉のマグマ変化)。
  G.placedLadders = new Set(); // v0.13.1: 設置済みはしご位置("col,row")。ランごとリセット。
  // v0.14.0: 設置済みアンテナは fail を跨いで残す(判断C)ため、まず空で初期化し loadAntennas で
  // 永続 state から復元する(クリア済みで消去済みなら空のまま=新規ダイブと同じ)。
  G.placedAntennas = new Set();
  G.companion = null; // v0.10.0: 同行指定はランごとリセット(level/cexp は girls 配列の初期化で 0 へ)。
  G.playerTrail = [[G.px, G.py]]; // v0.11.0: 自機足跡履歴(追従の正本)。地表スタート位置を起点に。
  // 女の子に HP を持たせる(GIRLATK で削られうる。救出/退避で消える)。state は維持。
  spawnSpaceMonsters(); // 元から空間(NONE)のマスへ決定論配置(掘る前の初期気配)。
  spawnBuriedMonsters(); // v0.17.0: 固体マスの土中へ埋没個体を決定論配置(最初からそこに居る、判断 A)。
  loadPersistent(); // v0.12.0: 永続 state を復元(rescued/per/bp/info/pick/girls level)。
  loadAntennas(); // v0.14.0: 設置済みアンテナ位置を復元(fail を無条件で跨ぐ、判断C)。
  loadInsurance(); // v0.14.0: 直前 fail 時に電波圏内だった場合のみ携行アイテムを1回だけ持ち越す(保険)。
  G.screen = "dive";
  hideOverlay();
  hudEl.hidden = false;
  camY = 0;
  revealAround(); // 開始時の地表まわりを可視化。
  startBgm(); // ダイブ開始(ユーザー操作起点)で BGM。モバイル autoplay 制約を満たす。
  renderHud();
}

// ---- タイル参照(掘削済みは NONE 空間) --------------------------------
function tileAt(col, row) {
  if (col < 0 || col >= CONST.GRID_COLS || row < 0) return TILE.ROCK; // 範囲外は壁。
  if (row > CONST.DEPTH_ROWS) return TILE.ROCK;
  // v0.7.0: 崩落で塞がれたマスは(掘った跡でも)不安定土(SOIL)に戻っている=道が消える。dug より優先。
  if (G.fallen && G.fallen.has(col + "," + row)) return TILE.SOIL;
  if (G.dug && G.dug.has(col + "," + row)) return TILE.NONE;
  return tileType(col, row, G.seed);
}
// (col,row) が通れる空間か(地表 or 元から空間 or 掘り抜いた跡)。
function isSpace(col, row) {
  if (row <= 0) return true; // 地表は通れる。
  if (col < 0 || col >= CONST.GRID_COLS) return false;
  if (row > CONST.DEPTH_ROWS) return false;
  return tileAt(col, row) === TILE.NONE;
}
// 掘り抜き済み(自機が通った跡 = 帰り道)か。
function isDug(col, row) {
  if (row <= 0) return true;
  return !!(G.dug && G.dug.has(col + "," + row));
}

// ---- 探索率 + fog: 自機周囲を可視化 ------------------------------------
// 自機を中心に VISIBLE_RADIUS のタイルを seen に入れる(掘った範囲は別途 dug で常時可視)。
// 探索率 = seen ÷ 全タイル。掘削/移動が起きたときだけ呼ぶ(毎フレーム全走査しない)。
function revealAround() {
  const rad = CONST.VISIBLE_RADIUS;
  for (let dc = -rad; dc <= rad; dc++)
    for (let dr = -rad; dr <= rad; dr++) {
      const c = G.px + dc;
      const r = G.py + dr;
      if (c < 0 || c >= CONST.GRID_COLS) continue;
      if (r < 1 || r > CONST.DEPTH_ROWS) continue;
      G.seen.add(c + "," + r);
    }
}
// あるタイルが可視か(掘った跡 or 一度でも可視になった or 地表)。
function isVisible(col, row) {
  if (row <= 0) return true;
  if (isDug(col, row)) return true;
  return !!(G.seen && G.seen.has(col + "," + row));
}
function exploreRatio() {
  if (!G.seen || G.totalTiles === 0) return 0;
  return Math.min(1, G.seen.size / G.totalTiles);
}

// ---- v0.14.0 電波網(判断C: player 操作由来の state のみで決定論。ハッシュ不要) -----------
// 地表からの基礎電波(深度 ANTENNA_R0 以内は常時圏内)+ 設置済みアンテナが連結すると圏内が広がる
// (圏内から半径 ANTENNA_R 以内のアンテナが新たに圏内に入る、を不動点まで繰り返すグラフ伝播)。
// アンテナ位置は自機の設置操作でのみ増減する純 state なので、乱数・ハッシュは一切使わない。
// アンテナ数は上限 ANTENNA_MAX=20 のため O(n^2) の不動点計算でも計算量は問題にならない。
function antennaDist(ac, ar, bc, br) {
  return Math.hypot(ac - bc, ar - br);
}
// 地表基礎範囲(row<=ANTENNA_R0)の縁までの距離(縁の内側なら 0)。垂直距離のみで足りる
// (基礎範囲は「深度 ANTENNA_R0 以内」という帯状の領域なので、最短点は真上)。
function distToBaseZone(row) {
  return row <= CONST.ANTENNA_R0 ? 0 : row - CONST.ANTENNA_R0;
}
// 現在設置されている全アンテナのうち電波網に連結している([col,row] 一覧)。
// 「連結」= 地表基礎範囲の縁から半径 ANTENNA_R 以内、または既に連結している別アンテナから
// 半径 ANTENNA_R 以内(不動点まで繰り返すグラフ伝播=中継chainで範囲が伸びる、item.csv
// 「連結で範囲拡張」に忠実)。基礎範囲の外に単独で置いたアンテナは中継元が無く機能しない
// (現実の無線中継と同じ=受信できない中継機は再送できない)。
function coveredAntennas() {
  const list = G.placedAntennas ? [...G.placedAntennas].map((k) => k.split(",").map(Number)) : [];
  const inCov = new Array(list.length).fill(false);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      if (inCov[i]) continue;
      const [ac, ar] = list[i];
      const nearBase = distToBaseZone(ar) <= CONST.ANTENNA_R; // 基礎範囲の縁から中継届く距離。
      const nearCovered = list.some((b, j) => inCov[j] && antennaDist(ac, ar, b[0], b[1]) <= CONST.ANTENNA_R);
      if (nearBase || nearCovered) { inCov[i] = true; changed = true; }
    }
  }
  return list.filter((_, i) => inCov[i]);
}
// (col,row) が電波圏内か(地表基礎範囲、または電波網に連結したアンテナから半径 ANTENNA_R 以内)。
function inRadioCoverage(col, row) {
  if (row <= CONST.ANTENNA_R0) return true;
  for (const [ac, ar] of coveredAntennas()) {
    if (antennaDist(col, row, ac, ar) <= CONST.ANTENNA_R) return true;
  }
  return false;
}

// ---- v0.14.0 アンテナ位置の永続(fail を無条件で跨ぐ、判断C) -------------
// mineroad_save_N(v0.12.0 セーブ)とは別キー(スキーマ非改変)。設置/回収のたびに保存し、
// startDive 冒頭で復元。クリアで消去(clearAntennas、showClear から呼ぶ)。
const ANTENNA_KEY_PREFIX = "mineroad_antennas_";
function antennaKeyForDungeon(id) { return ANTENNA_KEY_PREFIX + id; }
function saveAntennas() {
  try {
    const data = { v: 1, positions: G.placedAntennas ? [...G.placedAntennas] : [] };
    localStorage.setItem(antennaKeyForDungeon(G.dungeonId), JSON.stringify(data));
  } catch (e) {
    /* localStorage 不可環境でもゲームは成立(保存のみ諦める) */
  }
}
function loadAntennas() {
  try {
    const raw = localStorage.getItem(antennaKeyForDungeon(G.dungeonId));
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.positions)) return;
    G.placedAntennas = new Set(data.positions);
  } catch (e) {
    /* 破損/不正データでも進行可能(未設置扱い) */
  }
}
function clearAntennas() {
  try {
    localStorage.removeItem(antennaKeyForDungeon(G.dungeonId));
  } catch (e) {
    /* noop */
  }
}

// ---- v0.14.0 保険(携行アイテムの持ち越し、判断C本丸) ---------------------
// 力尽き時に自機が電波圏内なら、そのランの携行アイテム(ore/drops/mushrooms/dreamMushrooms/fruits/
// roastMeat/ladders/antennaItems/pick)を1回だけ次回 startDive へ持ち越す。圏外なら従来どおり全ロスト
// (何もしない=既存の「新しいダイブで全リセット」がそのまま効く、v0.12.0「消耗品は力尽きロスト」と
// 矛盾しない=原作自身がアンテナを保険として提供しており、保険の追加こそが忠実)。
// mineroad_save_N(v0.12.0、rescued/per/bp/info/pick/girls level の永続)とは別キー(スキーマ非改変)。
const INSURANCE_KEY_PREFIX = "mineroad_insurance_";
function insuranceKeyForDungeon(id) { return INSURANCE_KEY_PREFIX + id; }
function saveInsurance() {
  try {
    const data = {
      v: 1,
      ore: G.ore ? { ...G.ore } : null,
      drops: G.drops ? { ...G.drops } : null,
      mushrooms: G.mushrooms || 0,
      dreamMushrooms: G.dreamMushrooms || 0,
      fruits: G.fruits || 0,
      roastMeat: G.roastMeat || 0,
      ladders: G.ladders || 0,
      antennaItems: G.antennaItems || 0,
      pick: G.pick || CONST.INIT_PICK,
    };
    localStorage.setItem(insuranceKeyForDungeon(G.dungeonId), JSON.stringify(data));
  } catch (e) {
    /* localStorage 不可環境でもゲームは成立(保険なし扱い) */
  }
}
// 1 回だけ持ち越し=読んだら即座に消す(次に力尽きたときまた圏内なら改めて保存される)。
function loadInsurance() {
  try {
    const raw = localStorage.getItem(insuranceKeyForDungeon(G.dungeonId));
    if (!raw) return;
    localStorage.removeItem(insuranceKeyForDungeon(G.dungeonId));
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return;
    if (data.ore && G.ore) for (const k of Object.keys(G.ore)) if (data.ore[k] != null) G.ore[k] = data.ore[k];
    if (data.drops) G.drops = { ...data.drops };
    G.mushrooms = data.mushrooms || 0;
    G.dreamMushrooms = data.dreamMushrooms || 0;
    G.fruits = data.fruits || 0;
    G.roastMeat = data.roastMeat || 0;
    G.ladders = data.ladders || 0;
    G.antennaItems = data.antennaItems || 0;
    if (data.pick && PICK[data.pick] && pickRank(data.pick) > pickRank(G.pick)) G.pick = data.pick;
    showHint("電波が届いていたので持ち物は失われなかった", false);
  } catch (e) {
    /* 破損/不正データでも進行可能(保険なし扱い) */
  }
}

// ---- v0.16.0 水/マグマ 流体ヘルパー(原作合わせ、spec §4。判断 A〜C) --------
// 旧 v0.6.0 の hazardOf/hazardSpMult/hazardHpChip(固定オーバーレイ + SP 割増)は撤去。
// 流体の実体はランタイム state G.fluid(Map "col,row"→{k,d})。hazardAt(tiles.js)は
// 「初期配置・掘り当て抽選」の決定論ソースとして温存(ハッシュ・位相 非介入)。

// 自機や任意マスの流体種(HAZARD.NONE/WATER/MAGMA)。流体が無ければ NONE。
function fluidAt(col, row) {
  if (!G.fluid) return HAZARD.NONE;
  const f = G.fluid.get(col + "," + row);
  return f ? f.k : HAZARD.NONE;
}
// 息が続くターン数(原作 SWIM 値 c[33] 相当)。PER_SWIM Lv で延長。
function swimTurns() {
  return CONST.SWIM_BREATH_BASE + perLv("SWIM") * CONST.SWIM_BREATH_PER_LV;
}
// 息切れ後の毎ターン HP 直撃量(原作 clamp(4 − SWIM/5, 1, 4)。SWIM/5 → perLv 直写像)。
function drownDamage() {
  return Math.max(1, Math.min(CONST.DROWN_DMG_BASE, CONST.DROWN_DMG_BASE - perLv("SWIM")));
}

// startDive の流体播種(判断 A-a): 初期空間(tileType NONE)かつ hazardAt≠NONE のマスへ満水 d=8。
// 掘削前の isSpace は tileType===NONE と等価(dug/fallen とも空)なので tileType を直接引く
// (spawnSpaceMonsters と同じ走査流儀)。
function seedFluids() {
  for (let row = 1; row <= CONST.DEPTH_ROWS; row++) {
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      if (tileType(col, row, G.seed) !== TILE.NONE) continue;
      const hz = hazardAt(col, row, G.seed);
      if (hz === HAZARD.NONE) continue;
      G.fluid.set(col + "," + row, { k: hz, d: 8 });
    }
  }
}

// 掘り抜き成立マスの湧出(判断 A-b): hazardAt≠NONE なら満水 d=8 で流体を置く。1 マス 1 回限り
// (G.fluidReleased)=崩落埋め立て後の再掘や排水後の再掘で無限に湧かない。act の掘り抜き
// (GIRL 分岐は対象外)から呼ぶ。
function releaseFluidAt(col, row) {
  if (!G.fluid || !G.fluidReleased) return;
  const key = col + "," + row;
  if (G.fluidReleased.has(key)) return;
  G.fluidReleased.add(key);
  const hz = hazardAt(col, row, G.seed);
  if (hz === HAZARD.NONE) return;
  G.fluid.set(key, { k: hz, d: 8 });
}

// ---- v0.16.0 流動セルオートマトン(判断 B。毎ターン 1 回、決定論) ------------
// スナップショット走査(row 昇順→col 昇順)。そのターンに新規生成されたセルはスナップショットに
// 居ないので同ターンは流動源にならない=毎ターン 1 マスずつ広がる(原作の落下 1 マス/ターンの律)。
// 各流体セル: 真下が isSpace なら「流体なし→d=1 生成 / 同種 d<8→d+1(合流増密) / 異種→何もしない」。
// 真下が固体 or 満水同種 or 異種なら左右それぞれへ同規則。非保存(源は減らない)。row0(地表)と
// 範囲外へは生成しない。水/マグマは相互不干渉(翻案注記=原作 P() の走査範囲は jadx 欠落)。
function fluidStep() {
  if (!G.fluid || !G.fluid.size) return;
  const snapshot = [];
  for (const [key, f] of G.fluid) {
    const [c, r] = key.split(",").map(Number);
    snapshot.push({ c, r, k: f.k });
  }
  snapshot.sort((a, b) => (a.r - b.r) || (a.c - b.c));
  // 1 ターゲットマスへの流入規則。流れ込めたら true(=下方向が成立し左右展開は不要)。
  const flowInto = (c, r, kind) => {
    if (r < 1 || r > CONST.DEPTH_ROWS || c < 0 || c >= CONST.GRID_COLS) return false;
    if (!isSpace(c, r)) return false; // 固体へは流れ込まない。
    const key = c + "," + r;
    const f = G.fluid.get(key);
    if (!f) { G.fluid.set(key, { k: kind, d: 1 }); return true; }
    if (f.k !== kind) return false; // 異種→何もしない(相互不干渉)。
    if (f.d < 8) { f.d += 1; return true; } // 同種合流で増密。
    return false; // 満水 cap。
  };
  for (const cell of snapshot) {
    if (!flowInto(cell.c, cell.r + 1, cell.k)) {
      // 真下が固体/満水同種/異種 → 左右それぞれへ同規則(独立判定)。
      flowInto(cell.c - 1, cell.r, cell.k);
      flowInto(cell.c + 1, cell.r, cell.k);
    }
  }
}

// ---- v0.16.0 浸水判定(判断 C。毎ターン 1 回、HP 直撃=takeDamage の SP カスケードを通さない) ----
// 水: G.breath を毎ターン +1、swimTurns() を超えるまで無傷、超過後は drownDamage()/ターンを HP へ
// 直接減算。水から出ると G.breath=0(息継ぎ、cm.java:1082-1084)。マグマ: 猶予なし毎ターン
// ceil(effHpMax()/MAGMA_HP_DIV) を HP へ直接減算(cm.java:1224-1226) + 生肉調理(行動時→滞在ターンへ
// 移設=等価)。力尽き判定は resolveTurn の checkFail に委ねる。
function tickSubmersion() {
  const f = fluidAt(G.px, G.py);
  if (f === HAZARD.WATER) {
    G.breath += 1;
    if (G.breath > swimTurns()) {
      const dmg = drownDamage();
      G.hp = Math.max(0, G.hp - dmg);
      spawnPopupAt(G.px, G.py, "-" + dmg, "warn");
      if (!G.drownNoted) {
        G.drownNoted = true;
        showHint(TEXT.cueDrown, true);
      }
    }
    return;
  }
  // 水でなければ息継ぎ(マグマ含む=マグマは息でなく即時 HP 直撃)。
  G.breath = 0;
  G.drownNoted = false;
  if (f === HAZARD.MAGMA) {
    const dmg = Math.ceil(effHpMax() / CONST.MAGMA_HP_DIV);
    G.hp = Math.max(0, G.hp - dmg);
    spawnPopupAt(G.px, G.py, "-" + dmg, "warn");
    cookMeatInMagma(); // v0.14.0 生肉→焼き肉変換をマグマ滞在ターンへ移設(行動時→滞在ターンで等価)。
  }
}

// ---- v0.16.0 ターン解決(判断 E。旧 3 箇所の monstersAct() 直呼びを 1 本に集約) ----
// 順序 = 流動(fluidStep)→浸水(tickSubmersion=水が自分へ流れ込んだターンから浸水扱い)→浸水ヒント
// (noteHazardEntry=静止していても水が流れ込んでくる動的化に伴い moveTo から移設)→checkFail→
// (dive 継続なら)monstersAct→runtimeSpawnStep(v0.19.0: プレイヤー行動ごと 30% の追加湧き、
// #124。原作 by.a() 末尾の by.java:204-211 と同位置)。呼び出し元 = moveTo / act の非前進経路 /
// attackMonster。
function resolveTurn() {
  if (G.screen !== "dive") return;
  fluidStep();
  tickSubmersion();
  noteHazardEntry();
  checkFail();
  if (G.screen !== "dive") return; // 溺れ/マグマで力尽きたら離脱。
  monstersAct();
  runtimeSpawnStep(); // v0.19.0: プレイヤー行動ごと 30% の追加湧き(#124、判断 A)。
}

// ---- 行動 1 回ぶんのコスト(スタミナ → 体力の二段) --------------------
// SP がある間は SP を減らす。SP が 0 なら HP を減らす(二段ゲージの核)。HP が 0 になったら力尽き。
// v0.16.0: 浸水の SP 割増は全廃=常に素の SP_PER_ACTION(移動コスト側の割増は原作に無い、spec §4)。
// 浸水の消耗は tickSubmersion の HP 直撃が担う。
function spendAction() {
  const cost = CONST.SP_PER_ACTION;
  if (G.stamina > 0) {
    G.stamina = Math.max(0, G.stamina - cost);
    if (G.stamina === 0 && !G.enteredHpZone) {
      G.enteredHpZone = true;
      showHint(TEXT.cueHpZone, true);
    }
  } else {
    G.hp = Math.max(0, G.hp - cost);
  }
}

// ---- v0.5.0 被ダメージ = 既存二段ゲージへ接続(SP を削り、SP0 で HP を削る) ----
// モンスターの反撃。dmg を SP から削り、SP が尽きたら残りを HP へ回す(既存の撤退構造と整合=
// これで初めて死ねる)。SP_PER_ACTION とは別経路(行動消費でなく被弾)なので spendAction とは
// 分離。HP 0 の力尽き判定は呼び出し側の checkFail に委ねる。
function takeDamage(dmg) {
  let d = Math.max(0, dmg | 0);
  if (d <= 0) return;
  if (G.stamina > 0) {
    const absorbed = Math.min(G.stamina, d);
    G.stamina -= absorbed;
    d -= absorbed;
    if (G.stamina === 0 && !G.enteredHpZone) {
      G.enteredHpZone = true;
      showHint(TEXT.cueHpZone, true);
    }
  }
  if (d > 0) G.hp = Math.max(0, G.hp - d);
}

// ---- 入力 = 方向 1 つを解決(移動 or 掘り) ----------------------------
// dc,dr は各 -1/0/1(v0.15.0 で斜めを含む 8 方向。原作 bc.java exchangeTapToDirection が
// dx/dy 独立の 8 方向であることに合わせた。STATUS v0.15.0 翻案判断 A〜D)。
// ①空間 → そのマスへ移動(1 行動) ②掘削可タイル → 1 手掘る(1 行動、規定手数で空間化)
// ③硬岩(power 不足) → 無反応(軽フィードバック)。
// v0.15.0 上掘り: v0.13.1 の「はしご設置済みが前提」ゲートを撤去し、原作どおり power ゲート
// のみで真上/斜め上も掘れる(cm.java:349-407 = 真上の付帯条件 w(i,i2) は常に真)。はしごの
// 設置/回収メカ自体(placedLadders)は原作にも存在するアイテムなので非改変で温存。
// 上方向(dr=-1)の掘り抜きでは自機は移動しない(原作は掘削と移動が別アクション。登るのは
// 次タップの既存クライム)。
function act(dc, dr) {
  if (G.screen !== "dive" || G.busy) return;
  const col = G.px + dc;
  const row = G.py + dr;
  if (col < 0 || col >= CONST.GRID_COLS) return;
  if (row < 0) return; // 地表より上は無い。

  // v0.5.0 bump-to-attack: 進もうとした先にモンスターが居れば、移動/掘りでなく攻撃(1 戦闘ターン)。
  // v0.15.0: 斜めを含む 8 方向で成立。斜めの前提条件(下記)より先に判定する=原作の入力観
  // 「隣接タップはその方向へのアクション」に沿い、壁越しでも隣接モンスターへ反撃できる方が
  // 遊びやすい(STATUS v0.15.0 判断 D、順序の選択は実装値として記録)。
  const foe = monsterAt(col, row);
  if (foe) {
    attackMonster(foe);
    return;
  }

  // v0.15.0 斜め(dc≠0 かつ dr≠0)の前提条件: 横隣(px+dc,py) または 縦隣(px,py+dr) が空間。
  // どちらも固体の「完全な壁中への斜めねじ込み」だけは不可(原作 cm.java の w() 判定と同型。
  // 斜め下は上と鏡映の翻案=STATUS 判断 C)。満たさないときは行動消費もしない。
  if (dc !== 0 && dr !== 0) {
    if (!isSpace(G.px + dc, G.py) && !isSpace(G.px, G.py + dr)) return;
  }

  // 空間 → 移動。真上(0,-1)だけは意図的なクライム=noGravity(掘った縦坑/階段を 1 マスよじ登る
  // 「掘った跡が帰り道」の核。v0.1.0 以来の設計判断: この 1 歩は重力で引き戻さない=ledge を
  // 掴んだ扱い。1 行動 1 マスのスロットルで連続上昇はしない)。
  // 斜め上(±1,-1)は重力ありの通常 moveTo=原作ジャンプと同型(横隣に足場があれば階段登りが
  // 成立し、なければ moveTo 内の applyGravity で落ち戻る)。横/下/斜め下も重力あり。
  // 地表(row<=0)は isSpace=true なので SURFACE の横歩き/帰還もここで成立
  // (v0.4.0 の power ゲートに SURFACE を落とすと地表を歩けなくなる退行の回避と同じ整合)。
  if (isSpace(col, row)) {
    moveTo(col, row, false, dc === 0 && dr === -1);
    return;
  }

  // v0.4.0 A: ツルハシ power ゲート。所持する最強ツルハシの power がタイル必要 power 未満なら
  // 掘れない(blocked 演出/SFX を流用)。木 power1 では HARD(2)/ROCK(3) が掘れず、石で HARD、
  // 鉄で ROCK、ダイヤで全部。GIRL は SOIL 相当=1(救出対象)。req が無いタイルは掘削不能扱い。
  // v0.15.0: 真上/斜め上もこの共通ゲートだけで掘れる(原作 n.h() 共通掘削エンジンと同型)。
  const t = tileAt(col, row);
  const req = TILE_REQ_POWER[t];
  if (req === undefined || pickPower() < req) {
    showHint(TEXT.cueRockHit, false);
    spawnPopupAt(col, row, "×", "warn");
    playSfx("blocked");
    return;
  }
  // 土 / 硬土 / 硬岩 / 女の子 → 掘る。
  const key = col + "," + row;
  let remain = G.digProgress.get(key);
  if (remain === undefined) remain = digTaps(t);
  remain -= 1;
  spawnPopupAt(col, row, "・");
  playDig();
  spendAction();
  if (remain > 0) {
    G.digProgress.set(key, remain);
    renderHud();
    checkFail();
    return;
  }
  // 掘り抜けた → 空間化。
  G.digProgress.delete(key);
  G.dug.add(key);
  // v0.11.0 ③ 崩落ソフトロック修正: 崩落で塞がれた(G.fallen 入り)マスを再掘削した場合、tileAt は
  // G.fallen を G.dug より先に評価して SOIL を返すため、G.dug.add だけでは永久に SOIL のまま通れず
  // 地表へ戻れなかった(詰みの核)。掘り抜き成立で G.fallen から外し、再掘した跡が空間に戻る
  // (plan §2「塞がれた SOIL は再掘可・soft-lock しない」の前提を実装で守る)。
  G.fallen.delete(key);
  let buried = null;
  if (t === TILE.GIRL) discoverGirl(col, row);
  else {
    // v0.7.0: 掘り抜いたのが不安定土(なだれ土)なら落下候補として記録(真下が空くと崩れる)。
    if (t === TILE.SOIL && avalancheAt(col, row, G.seed)) markUnstableDug(col, row);
    collectOre(col, row); // v0.4.0 B: 掘り抜いたマスの鉱石を決定論で産出(GIRL は除外)。
    if (t === TILE.SOIL) collectMushroom(col, row); // v0.8.0: SOIL 掘り抜きでキノコ通貨を採取(決定論)。
    buried = activateBuriedAt(col, row); // v0.17.0 掘り当て: 生成時から潜む埋没個体をアクティブ化。
    releaseFluidAt(col, row); // v0.16.0: 掘り当て湧出(hazardAt≠NONE なら満水 d=8、1 マス 1 回限り)。
  }
  // 前進しないケース 2 つ:
  // ①埋没個体の掘り当て(v0.17.0): そのマスは露出した個体が塞ぐ。前進せずその場に留まる
  //   (次の入力 = bump-to-attack)。旧 埋没掘りスポーンと同じ手触り。
  // ②上方向(dr=-1、真上/斜め上)の掘り抜き: 原作は掘削と移動が別アクションなので自機は動かない
  //   (登るのは次タップのクライム/斜め移動)。なだれ土(markUnstableDug)の崩落解決は次の moveTo の
  //   resolveCaveins に委ねる=①の遅延解決と同じで、v0.13.1 はしご上掘り「掘り抜き後に登った時点で
  //   崩れる」と等価のタイミング。
  // 掘りの行動コストは払い済み(spendAction)。
  if (buried || dr === -1) {
    revealAround();
    resolveTurn(); // v0.16.0: 流動→浸水→ヒント→checkFail→モンスター反応(判断 E の 1 本化)。
    renderHud();
    checkFail();
    return;
  }
  // 横/下/斜め下に掘ったらそのマスへ前進(原作: 土なら自動で掘って進む)。掘りで行動コストは
  // 払い済みなので、前進では二重に取らない(costPaid=true)。
  moveTo(col, row, true);
}

function digTaps(t) {
  const k = TILE_DIG_KEY[t];
  const base = CONST.DIG_TAPS[k] || 1;
  // v0.9.0 PER_DIG: 掘削手数を Lv × DIG_PER_LV ぶん減らす(最低 1 で頭打ち=掘削力レベルアップ)。
  // レベル 0 では base そのまま=既存の掘削決定論(remain 初期値)が不変。
  return Math.max(1, base - perLv("DIG") * PER_GAIN.DIG_PER_LV);
}

// ---- v0.9.0 育成 実効値ヘルパー(PER レベルで既存フックの有効値を動かす) -----
// 既存の育成フック(HP_MAX/STAMINA_MAX/掘削手数/ATK_BASE/DEF_BASE/SWIM_MITIGATION)を、各 PER の
// 現レベル ×PER_GAIN で押し上げた「実効値」へ通す。これが本増分の核=既に CONST/ヘルパー1点に切り出して
// あったフックの「消費先を開く」(新たな if/elif や閾値積み増しをせず、フックを使う)。
// per が未初期化(タイトル前など)でも 0 扱いで素の CONST を返す=育成前は既存挙動に完全一致。
function perLv(key) {
  return (G.per && G.per[key]) || 0;
}
// PER_HP: HP 最大値 = HP_MAX + Lv × HP_PER_LV。
function effHpMax() {
  return CONST.HP_MAX + perLv("HP") * PER_GAIN.HP_PER_LV;
}
// PER_ST: スタミナ最大値 = STAMINA_MAX + Lv × ST_PER_LV。
function effStaminaMax() {
  return CONST.STAMINA_MAX + perLv("ST") * PER_GAIN.ST_PER_LV;
}
// PER_ATTACK: 攻撃基礎値 = ATK_BASE + Lv × ATK_PER_LV(playerAtk が pickPower と合算)。
function effAtkBase() {
  return CONST.ATK_BASE + perLv("ATTACK") * PER_GAIN.ATK_PER_LV;
}
// PER_DEFENCE: 防御基礎値 = DEF_BASE + Lv × DEF_PER_LV(playerDef が pickPower 由来と合算)。
function effDefBase() {
  return CONST.DEF_BASE + perLv("DEFENCE") * PER_GAIN.DEF_PER_LV;
}
// PER_SWIM: v0.16.0 で消費先を swimTurns()/drownDamage()(息の延長 + 溺れダメージ減額=原作の
// 減算系)へ引き直した。旧 effSwimMitigation(乗算軽減)は撤去(原作 spec §4=乗算軽減ではない)。
// v0.10.0 仲間同行: 同行中の仲間がレベルに応じて自機攻撃力へ乗せる援護(原作「一緒に戦う」=戦力になる)。
// 同行が following 中(=実際に隣で戦える)ときだけ効く。未指定/ロスト/帰還後は 0=既存挙動に完全一致。
function effCompanionAtk() {
  const c = G.companion;
  if (!c || c.state !== "following") return 0;
  return (c.level || 0) * CONST.COMPANION_ATK_PER_LV;
}

// ---- v0.4.0 アイテム/クラフト系ヘルパー --------------------------------
// 所持する最強ツルハシの power(掘削ゲート A の判定値)。
function pickPower() {
  const p = PICK[G.pick];
  return p ? p.power : 1;
}
// 掘り抜いたマスの鉱石を決定論で産出しインベントリへ加算(B)。GIRL は呼び出し側で除外済み。
function collectOre(col, row) {
  if (!G.ore) return;
  const o = oreAt(col, row, G.seed);
  if (o === ORE.NONE) return;
  const meta = ORE_META[o];
  if (!meta) return;
  G.ore[meta.key] = (G.ore[meta.key] || 0) + 1;
  spawnPopupAt(col, row, "+" + meta.ico, "cue"); // 産出を暖色ポップで明示。
}
// v0.8.0: 掘り抜いた SOIL マスのキノコ通貨を決定論で採取しインベントリへ加算。GIRL/非 SOIL は呼び出し
// 側で除外済み。oreAt と同じ別レイヤー(mushroomAt)で非介入(tileType/girlPositions 不変)。
function collectMushroom(col, row) {
  if (!mushroomAt(col, row, G.seed)) return;
  G.mushrooms = (G.mushrooms || 0) + 1;
  spawnPopupAt(col, row, "+茸", "cue"); // 採取を暖色ポップで明示(キノコ=茸)。
}
// クラフトレシピ rec の材料が現在のインベントリで足りているか(v0.14.0: cost を SHOP_RECIPES と
// 同じ { ore:{...}, item:{...} } 形へ統一し tiles.js canTrade へ委譲。判定ロジックの二重化を避ける)。
function canCraft(rec) {
  return canTrade(rec, G);
}
// ツルハシ段の強さ比較(クラフトで弱い段に "ダウングレード" しないため)。
function pickRank(key) {
  return PICK[key] ? PICK[key].power : 0;
}
// v0.14.0: クラフト/商人で共通化した「対価を払う」ヘルパー(cost 形は canTrade と同じ)。
function payCost(cost) {
  const c = cost || {};
  if (c.ore) for (const k of Object.keys(c.ore)) G.ore[k] -= c.ore[k];
  if (c.item) for (const k of Object.keys(c.item)) G.drops[k] -= c.item[k];
  if (c.mushroom) G.mushrooms -= c.mushroom;
  if (c.dreamMushroom) G.dreamMushrooms -= c.dreamMushroom;
}
// v0.14.0: クラフト/商人で共通化した「産物を付与する」ヘルパー(result.type = pick/tool/consumable)。
// アンテナは v0.14.0 で設置型(placeAntenna)へ引き直したため、ここでは所持数を増やすだけ。
function grantResult(r) {
  if (r.type === "pick") {
    // 最強の段だけを保持(より強い段を作ったら昇格、弱い段は無意味なので据え置き)。
    if (pickRank(r.id) > pickRank(G.pick)) G.pick = r.id;
  } else if (r.type === "tool") {
    if (r.id === "LADDER") G.ladders += 1;
    else if (r.id === "ANTENNA") G.antennaItems = (G.antennaItems || 0) + 1;
  } else if (r.type === "consumable") {
    if (r.id === "FRUIT") G.fruits += 1;
    else if (r.id === "DREAM_MUSHROOM") G.dreamMushrooms += 1;
    else if (r.id === "ROAST_MEAT") G.roastMeat += 1;
  }
}
// レシピを実行: 材料を消費し完成品を付与。実行できたら true。
function doCraft(rec) {
  if (!canCraft(rec)) return false;
  payCost(rec.cost);
  grantResult(rec.result);
  playSfx("heal"); // クラフト成功の合図(専用 SFX 無し、heal を流用)。
  renderHud();
  renderCraft(); // パネルの可否表示を更新。
  return true;
}
// v0.13.1 はしご設置(消耗品を 1 個消費して自機位置にはしごを置く)。
function placeLadder() {
  if (G.screen !== "dive") return false;
  if ((G.ladders || 0) <= 0) return false;
  const key = G.px + "," + G.py;
  if (!isSpace(G.px, G.py) || G.py <= 0) return false;
  if (G.placedLadders.has(key)) return false;
  G.ladders -= 1;
  G.placedLadders.add(key);
  playSfx("heal");
  showHint("はしごを設置した", false);
  renderHud();
  return true;
}
// v0.13.1 はしご回収(自機位置の設置済みはしごを拾って所持に戻す)。
function recoverLadder() {
  if (G.screen !== "dive") return false;
  const key = G.px + "," + G.py;
  if (!G.placedLadders || !G.placedLadders.has(key)) return false;
  G.placedLadders.delete(key);
  G.ladders += 1;
  playSfx("heal");
  showHint("はしごを回収した", false);
  renderHud();
  return true;
}

// ---- v0.14.0 アンテナ(設置型 + 電波網 + 保険) --------------------------
// 判断C: v0.4.0 の「所持フラグで女の子全域透視」を廃し、原作忠実(item.csv ID3)の設置型へ引き直す。
// 設置は placeLadder と同じ流儀(所持1個消費・isSpace かつ地中でのみ・重複設置不可)。1 ダンジョン
// 上限 CONST.ANTENNA_MAX(仕様まとめ §8「1ダンジョン最大20本」)。設置済み位置は fail を無条件で跨いで
// 残す(判断C「固定 seed 同一盤面で位置が意味を保つ=保険の実用性の核」、saveAntennas で永続化)。
function placeAntenna() {
  if (G.screen !== "dive") return false;
  if ((G.antennaItems || 0) <= 0) return false;
  if (!G.placedAntennas) G.placedAntennas = new Set();
  if (G.placedAntennas.size >= CONST.ANTENNA_MAX) {
    showHint("アンテナは上限(" + CONST.ANTENNA_MAX + "本)まで設置済み", true);
    return false;
  }
  const key = G.px + "," + G.py;
  if (!isSpace(G.px, G.py) || G.py <= 0) return false;
  if (G.placedAntennas.has(key)) return false;
  G.antennaItems -= 1;
  G.placedAntennas.add(key);
  saveAntennas();
  playSfx("heal");
  showHint("アンテナを設置した", false);
  renderHud();
  return true;
}
// アンテナ回収(自機位置の設置済みアンテナを拾って所持に戻す)。
function recoverAntenna() {
  if (G.screen !== "dive") return false;
  const key = G.px + "," + G.py;
  if (!G.placedAntennas || !G.placedAntennas.has(key)) return false;
  G.placedAntennas.delete(key);
  G.antennaItems = (G.antennaItems || 0) + 1;
  saveAntennas();
  playSfx("heal");
  showHint("アンテナを回収した", false);
  renderHud();
  return true;
}

// ---- v0.8.0 商人(物々交換) -------------------------------------------
// 商人レシピ rec の対価(ore/drops/mushroom)が現在の所持で足りるか(tiles.js canTrade を G で評価)。
function canTradeRec(rec) {
  return canTrade(rec, G);
}
// 商人レシピを実行: 対価を消費し産物を付与。実行できたら true(不足/非 dive は false)。
// v0.14.0: 対価の消費/産物の付与は doCraft と共通の payCost/grantResult ヘルパーへ委譲(cost 形統一)。
function doShopTrade(rec) {
  if (G.screen !== "dive" || !canTradeRec(rec)) return false;
  payCost(rec.cost);
  grantResult(rec.result);
  playSfx("heal"); // 交換成立の合図(専用 SFX 無し、heal を流用=doCraft 流儀)。
  showHint(rec.name + "を交換した", false);
  renderHud();
  renderShop(); // パネルの可否表示を更新。
  return true;
}

// ---- v0.14.0 飲食(食べる)の汎用化 --------------------------------------
// 回復薬(原作に無い v0.4.0 独自アイテム)は判断Bにより廃止し、item.csv 実在の飲食(フルーツ/夢キノコ/
// 焼き肉/動物の血)へ置換。個々の usePotion/useFruit... の重複実装を作らず、所持元(G の専用フィールド
// or G.drops)の違いを get/spend で吸収した単一経路 useConsumable に集約する(HP_MAX 上限は共通)。
const CONSUMABLES = {
  FRUIT: { name: "フルーツ", heal: () => CONST.FRUIT_HEAL, get: () => G.fruits || 0, spend: () => { G.fruits -= 1; } },
  DREAM_MUSHROOM: { name: "夢キノコ", heal: () => CONST.DREAM_HEAL, get: () => G.dreamMushrooms || 0, spend: () => { G.dreamMushrooms -= 1; } },
  ROAST_MEAT: { name: "焼き肉", heal: () => CONST.ROAST_HEAL, get: () => G.roastMeat || 0, spend: () => { G.roastMeat -= 1; } },
  BLOOD: { name: "動物の血", heal: () => CONST.BLOOD_HEAL, get: () => (G.drops && G.drops["動物の血"]) || 0, spend: () => { G.drops["動物の血"] -= 1; } },
};
// 消耗品 id を 1 個消費して体力を回復する共通経路。所持無し/満タン/非 dive なら false。
function useConsumable(id) {
  const c = CONSUMABLES[id];
  if (!c || G.screen !== "dive" || c.get() <= 0) return false;
  if (G.hp >= effHpMax()) { showHint("体力は満タン", false); return false; } // v0.9.0 実効最大値で判定。
  c.spend();
  G.hp = Math.min(effHpMax(), G.hp + c.heal());
  playSfx("heal");
  showHint(c.name + "を食べた", false);
  renderHud();
  return true;
}
// 既存呼び出し元(テスト含む)の関数名を維持したラッパー(useConsumable への薄い委譲)。
function useFruit() { return useConsumable("FRUIT"); }
function useDreamMushroom() { return useConsumable("DREAM_MUSHROOM"); }
function useRoastMeat() { return useConsumable("ROAST_MEAT"); }
function useBlood() { return useConsumable("BLOOD"); }

// v0.14.0: 生肉のマグマ変化(item.csv MAGMA 変化列 verbatim=生肉→焼き肉)。マグマ中で行動する
// たび、所持する生肉を1個ずつ焼き肉へ変換する(決定論・状態遷移のみ、ランタイム乱数不使用)。
function cookMeatInMagma() {
  if (!G.drops || !(G.drops["生肉"] > 0)) return;
  G.drops["生肉"] -= 1;
  G.roastMeat = (G.roastMeat || 0) + 1;
  showHint("生肉が焼けた", false);
}

// ---- v0.9.0 育成(情報/EXP → BP → PER_* レベルアップ) -------------------
// 原作 §4: 救出した女の子の「情報」を変換して BP/スキルポイントを得る(変換すると情報は消費)。
// 裏庭=BP100%(dungeon_info ID0)に忠実に BP 単一通貨路を開く。EXP(v0.5.0 で蓄積のみ)も BP へ変換し
// 自機育成に使う(仲間同行は対象外=EXP の行き先を自機育成とする翻案)。決定論=状態遷移のみ。
// 情報を 1 消費して BP を INFO_TO_BP 得る。情報が無ければ false。
function convertInfoToBp() {
  if (G.screen !== "dive" || (G.info || 0) <= 0) return false;
  G.info -= 1;
  G.bp = (G.bp || 0) + GROW_RATE.INFO_TO_BP;
  playSfx("heal");
  showHint("情報を変換して BP +" + GROW_RATE.INFO_TO_BP, false);
  renderHud();
  renderGrow();
  return true;
}
// EXP を EXP_TO_BP 消費して BP を +1 得る。EXP が足りなければ false。
function convertExpToBp() {
  if (G.screen !== "dive" || (G.exp || 0) < GROW_RATE.EXP_TO_BP) return false;
  G.exp -= GROW_RATE.EXP_TO_BP;
  G.bp = (G.bp || 0) + 1;
  playSfx("heal");
  showHint("経験値を変換して BP +1", false);
  renderHud();
  renderGrow();
  return true;
}
// PER perKey を 1 レベル上げる。BP が逓増コスト(bpCostFor)に足り、上限未満なら実行(BP 消費)。
// レベルアップで effXxx ヘルパー経由の有効値(HP_MAX/STAMINA_MAX/掘削手数/ATK/DEF/SWIM)が即時上がる。
// PER_HP/PER_ST のレベルアップ時は現ゲージも実効最大まで底上げする(育成の手触りを即時に出す)。
function levelUpPer(perKey) {
  if (G.screen !== "dive" || !G.per || !(perKey in G.per)) return false;
  const def = PER_DEFS.find((d) => d.key === perKey);
  if (!def) return false;
  const lvl = G.per[perKey];
  if (lvl >= def.max) { showHint(def.label + "は最大レベル", false); return false; }
  const cost = bpCostFor(perKey, lvl);
  if ((G.bp || 0) < cost) { showHint("ボーナスポイントが足りない", true); return false; }
  G.bp -= cost;
  G.per[perKey] = lvl + 1;
  // 最大値が増える PER は現ゲージを実効最大へ底上げ(レベルアップの効果を即体感させる)。
  if (perKey === "HP") G.hp = effHpMax();
  else if (perKey === "ST") G.stamina = effStaminaMax();
  playSfx("heal");
  showHint(def.label + " を Lv." + (lvl + 1) + " に強化した", false);
  renderHud();
  renderGrow();
  return true;
}

// ---- v0.5.0 モンスター/戦闘/GIRLATK ------------------------------------
// 設計(CSV→実装の翻案、STATUS に記録):
//  - スポーン 2 系統: 空間スポーン(ダイブ開始時に元 NONE マスへ決定論配置)+ 埋没配置
//    (v0.17.0: ダイブ開始時に固体マスの土中へ決定論配置=最初からそこに居る。旧「掘り抜いた瞬間
//    bury% で出現」は機構替えで廃止)。配置は tiles.js の決定論関数で確定。
//  - 戦闘: bump-to-attack。1 ターンダメージ = max(1, 攻撃力 - 相手DEF)。自機攻撃力は
//    ATK_BASE + pickPower()(ツルハシ段=戦力の代理、育成未実装の翻案)。被ダメは takeDamage で
//    既存二段ゲージ(SP→HP)へ接続。SPD を行動頻度に反映(spd>=2 は毎ターン、spd1 は隔ターン)。
//  - 撃破で EXP 蓄積(育成未実装=表示のみ)+ 素材ドロップ(monster.csv 表 verbatim・決定論)。
//  - GIRLATK=1 のモンスターは隣接する追従中の女の子も標的にしうる(HP 0 でロスト=誘導難度)。

// 自機の攻撃力/防御力(ツルハシ段=戦力の代理)。
// v0.9.0: ATK_BASE/DEF_BASE は PER_ATTACK/PER_DEFENCE レベルで押し上げた実効基礎値を使う
// (effAtkBase/effDefBase。レベル 0 では素の CONST と一致=既存挙動不変)。
// v0.10.0: 同行中の仲間レベルに応じた援護(effCompanionAtk)を上乗せ(レベル0/未同行で +0=既存一致)。
function playerAtk() { return effAtkBase() + pickPower() + effCompanionAtk(); }
function playerDef() { return effDefBase() + Math.floor((pickPower() - 1) / 2); }

// (col,row) に居る出現中のモンスターを返す(無ければ null)。
// v0.17.0 判断 F: 埋没個体(buried)は返さない=bump 攻撃・移動ブロック・重力の対象外(土の中に
// 居るだけで世界に干渉しない)。掘り当て判定は buriedMonsterAt で別に引く。
function monsterAt(col, row) {
  if (!G.monsters) return null;
  for (const m of G.monsters) {
    if (m.buried) continue;
    if (m.col === col && m.row === row) return m;
  }
  return null;
}

// (col,row) の土中に潜む埋没個体を返す(無ければ null)。act の掘り当て判定専用(判断 F)。
function buriedMonsterAt(col, row) {
  if (!G.monsters) return null;
  for (const m of G.monsters) {
    if (m.buried && m.col === col && m.row === row) return m;
  }
  return null;
}

// ダイブ開始時、元から空間(NONE)のマスへ決定論でモンスターを配置(掘る前の初期気配)。
// 既に dug 済み/spawned 済みのマスは対象外。tileType が NONE のマスのみ(GIRL/oreは別レイヤー)。
function spawnSpaceMonsters() {
  if (!G.monsters || !G.spawned) return;
  for (let row = 1; row <= CONST.DEPTH_ROWS; row++) {
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      if (tileType(col, row, G.seed) !== TILE.NONE) continue; // 元から空間のマスだけ。
      const key = col + "," + row;
      if (G.spawned.has(key)) continue;
      const sp = spaceMonsterAt(col, row, G.seed);
      if (!sp) { G.spawned.add(key); continue; }
      G.spawned.add(key);
      addMonster(sp, col, row, "space");
    }
  }
}

// v0.17.0 生成時配置(判断 A 改稿、q.java:349-385): ダイブ開始時に全固体マス(SOIL/HARD/ROCK)を
// 走査し、buryMonsterAt(配置 = 人口密度 BURY_PRESENCE_RATE × 帯別重みのみ。bury% は脱出抽選専用=
// STATUS v0.17.0 設計見直し裁定①の役割分離)が種を返すマスへ埋没個体(buried=true)を配置する=
// 「最初からそこに居る」。GIRL マスは buryMonsterAt 側で除外。
// origCol/origRow は脱出抽選(buryEscapeRoll)の位相の起点、bt は覚醒 tick カウンタ(判断 D)。
// fail/retry の再列挙は決定論で同一配置を再現(力尽きを跨いで「そこに居る」が成立)。
// 旧 trySpawnBuryMonster(掘削時抽選スポーン)はこの機構替えで廃止(G.spawned は space 用途のみ残る)。
function spawnBuriedMonsters() {
  if (!G.monsters) return;
  for (let row = 1; row <= CONST.DEPTH_ROWS; row++) {
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      const t = tileType(col, row, G.seed);
      if (t !== TILE.SOIL && t !== TILE.HARD && t !== TILE.ROCK) continue;
      const sp = buryMonsterAt(col, row, G.seed);
      if (!sp) continue;
      const meta = MONSTER[sp];
      if (!meta) continue;
      G.monsters.push({
        key: sp, col, row, hp: meta.hp, kind: "bury", buried: true, bt: 0, origCol: col, origRow: row,
        // v0.18.0: SP-睡眠(判断 C)+ AI ロール(判断 F)の個体 state。spawnCol/spawnRow はロール
        // ストリームの恒久 ID(rebury で動く origCol/origRow とは別に、生成マスで固定)。
        sp: meta.sp, sleeping: false, tk: 0, rc: 0, spawnCol: col, spawnRow: row, dir: 0,
      });
    }
  }
}

// v0.17.0 土中 tick(判断 B/D、原作 bk.java:140-151)。monsterStep 冒頭から毎ターン呼ばれる:
// 毎ターン HP−1(土中で衰弱)、HP 0 は土中死=静かに除去(EXP/ドロップ/演出なし=自機が関与して
// いない撃破ではない)。生きていれば覚醒カウンタ bt を進め、bury%(PER_BROKEN_SOIL 本来の意味=
// 覆い土の自力破壊率)の決定論抽選に単発成功したら脱出。
// v0.18.0 判断 E ③: 距離ゲート(旧 BURIED_WAKE_RANGE)はここから撤去し、monstersAct の活動箱 16
// (MONSTER_ACTIVE_RANGE)が全ターン処理と共通で律速する。圏外は衰弱も脱出もしない(bt も進まない
// =近づいた時から動き出す)のは同じで、しきい値だけ原作の単一ゲートへ統一。
function buriedTick(m, meta) {
  m.hp -= 1;
  if (m.hp <= 0) {
    const i = G.monsters.indexOf(m);
    if (i >= 0) G.monsters.splice(i, 1);
    return;
  }
  m.bt = (m.bt || 0) + 1;
  if (buryEscapeRoll(m.origCol, m.origRow, G.seed, m.bt) < meta.bury / 100) escapeBuriedMonster(m);
}

// v0.17.0 脱出=覆い土の自力破壊(判断 E)。世界への作用はプレイヤー掘削の掘り抜きと同順
// (digProgress 破棄→dug.add→fallen.delete→なだれ土なら markUnstableDug→releaseFluidAt)。ただし
// collectOre/collectMushroom は呼ばない=埋没個体が破った土の採取物は失われる(翻案)。G.dug 入りで
// 脱出跡は fog 越しに可視化されるが「土が崩れた場所は分かる」演出として許容(判断 E)。
// 演出の裁量判断(判断 F、記録): SFX は常に鳴らす(見えない場所からの気配)、popup は脱出セルが
// 既に可視(seen)のときだけ(見えていない出現にアイコンを出さない)。ヒント文は出さない=hint 枠は
// 自機を主語とするイベント(発見/浸水/なだれ/掘り当て)専用で、非同期の脱出が直前の重要ヒント
// (例: 女の子発見 cueGirlFound)を上書きしないため(掘り当て activateBuriedAt 側のヒントは維持)。
function escapeBuriedMonster(m) {
  const col = m.col, row = m.row;
  const key = col + "," + row;
  const seenBefore = isVisible(col, row); // dug 入り前に判定(dug 入り後は必ず可視になるため)。
  const t = tileAt(col, row); // なだれ土判定は空間化前のタイル種で(act の掘り抜きと同じ)。
  m.buried = false;
  G.digProgress.delete(key); // 自機の掘りかけは空間化で無意味になる(act の掘り抜きと同じ)。
  G.dug.add(key);
  G.fallen.delete(key);
  if (t === TILE.SOIL && avalancheAt(col, row, G.seed)) markUnstableDug(col, row);
  releaseFluidAt(col, row);
  const meta = MONSTER[m.key];
  playSfx("blocked"); // 専用 SFX 無し=出現の警告音を流用(旧 trySpawnBuryMonster 移設)。
  if (seenBefore) spawnPopupAt(col, row, meta ? meta.ico : "敵", "warn");
}

// v0.17.0 掘り当て(判断 E): 自機が埋没個体のマスを掘り抜いた瞬間、その個体をアクティブ化する。
// 旧 trySpawnBuryMonster(掘削時抽選)の置き換え=個体は生成時から居て、掘り当ては「そこに居た」
// 個体を露出させるだけ。空間化は act の掘り抜きが済ませているのでここでは状態と演出のみ
// (popup/SFX/ヒントと「前進しない」分岐は旧実装の手触りを流用)。出たら種キー、居なければ null。
function activateBuriedAt(col, row) {
  const m = buriedMonsterAt(col, row);
  if (!m) return null;
  m.buried = false;
  spawnPopupAt(col, row, MONSTER[m.key] ? MONSTER[m.key].ico : "敵", "warn");
  playSfx("blocked"); // 専用 SFX 無し=出現の警告音を流用。
  showHint((MONSTER[m.key] ? MONSTER[m.key].name : "敵") + "が飛び出した", true);
  return m.key;
}

// モンスターを 1 体出現リストへ追加(HP/SP は monster.csv verbatim)。
// v0.18.0: cd(隔ターン追跡スロットル)は判断 D で撤去。SP-睡眠 + AI ロールの個体 state を持つ。
function addMonster(key, col, row, kind) {
  const meta = MONSTER[key];
  if (!meta) return;
  G.monsters.push({
    key, col, row, hp: meta.hp, kind,
    sp: meta.sp, sleeping: false, tk: 0, rc: 0, spawnCol: col, spawnRow: row, dir: 0,
  });
}

// 自機が foe を攻撃する 1 戦闘ターン。撃破するまで前進できない(死の緊張の核)。
function attackMonster(foe) {
  const meta = MONSTER[foe.key];
  if (!meta) return;
  spendAction(); // 攻撃も 1 行動(SP/HP を 1 消費=既存の行動コスト)。
  const dmg = Math.max(1, playerAtk() - meta.def);
  foe.hp -= dmg;
  foe.sleeping = false; // v0.18.0 判断 C: 被弾で即覚醒(各 AI クラスの j() 相当)。
  spawnPopupAt(foe.col, foe.row, "-" + dmg);
  playDig(); // 打撃音(専用 SFX 無し=掘削音を流用)。
  if (foe.hp <= 0) {
    killMonster(foe);
  }
  // 自機の 1 行動に対する解決(v0.16.0: 流動→浸水→生き残った foe の反撃含むモンスター反応)。
  resolveTurn();
  renderHud();
  checkFail();
}

// foe を撃破: リストから除去、EXP 蓄積、ドロップ(決定論)。
function killMonster(foe) {
  const meta = MONSTER[foe.key];
  const i = G.monsters.indexOf(foe);
  if (i >= 0) G.monsters.splice(i, 1);
  if (meta) {
    G.exp += meta.exp; // 自機プール(v0.9.0 BP 路)。仲間と並走で太る=差し引かない(二面両立)。
    // v0.10.0: 同行中(following)の仲間が居れば、同じ撃破 EXP を仲間の cexp にも貯める(原作「一緒に
    // 戦い EXP 蓄積」)。帰還(rescueGirl)で cexp→level に清算する。同行 0 人なら no-op=既存挙動一致。
    if (G.companion && G.companion.state === "following") {
      G.companion.cexp = (G.companion.cexp || 0) + meta.exp;
    }
    G.kills += 1;
    const item = monsterDrop(foe.key, foe.col, foe.row, G.seed);
    if (item) {
      G.drops[item] = (G.drops[item] || 0) + 1;
      spawnPopupAt(foe.col, foe.row, "+" + item, "cue");
    }
    spawnPopupAt(foe.col, foe.row, "×", "cue");
  }
  playSfx("found"); // 撃破の合図(専用 SFX 無し=発見音を流用)。
}

// 出現中の全モンスターが自機の 1 行動に反応(v0.18.0 判断 E)。個体ごとに:
// ①despawn 判定(毎ターン全個体対象、活動圏外・buried 含む): x・y 両軸とも ±MONSTER_DESPAWN_RANGE
//   圏外なら splice(by.java:170-172 の逐語 AND。片軸のみ圏外では消えない)。補充なし=ランタイム
//   スポーン導入(次増分候補)までは大マップ遠方の人口が漸減する片肺状態(STATUS 判断 E 明記)。
// ②活動箱: Chebyshev MONSTER_ACTIVE_RANGE 圏内の個体のみターン処理。圏外は完全凍結
//   (tk/rc/SP/睡眠/土中 tick すべて進まない=by.java:227-229 verbatim)。
function monstersAct() {
  if (!G.monsters || !G.monsters.length) return;
  // splice 中の添字ズレを避けるためスナップショットを走査。撃破等での除去は indexOf で安全。
  for (const m of G.monsters.slice()) {
    if (G.monsters.indexOf(m) < 0) continue; // 既に除去済み。
    const meta = MONSTER[m.key];
    if (!meta) continue;
    if (Math.abs(m.col - G.px) > CONST.MONSTER_DESPAWN_RANGE && Math.abs(m.row - G.py) > CONST.MONSTER_DESPAWN_RANGE) {
      const i = G.monsters.indexOf(m);
      if (i >= 0) G.monsters.splice(i, 1); // despawn(静かに除去。EXP/ドロップ/演出なし)。
      continue;
    }
    if (Math.max(Math.abs(m.col - G.px), Math.abs(m.row - G.py)) > CONST.MONSTER_ACTIVE_RANGE) continue;
    m.tk = (m.tk || 0) + 1; // 活動ターンカウンタ(圏内でのみ進む。WORM の SPD 剰余ゲートが参照)。
    monsterStep(m, meta);
    if (G.screen !== "dive") return; // 力尽き等で離脱。
  }
}

// v0.19.0 ランタイムスポーン(#124、原作 by.java:204-211 verbatim)。despawn(v0.18.0、両軸 AND
// ±28 圏外で除去)と対になる補充源=大マップでの人口漸減を解消する片肺状態の解消
// (STATUS v0.18.0 follow-up・差分台帳キュー 3 位)。resolveTurn からプレイヤー行動ごとに 1 回呼ぶ。
// 決定論は tiles.js の専用ストリーム(runtimeSpawnChanceRoll 等)。spaceMonsterAt/buryMonsterAt の
// 位置決定論(presence ハッシュ)は流用しない(advisor 指摘: 使い回すと既存個体との重複配置か
// despawn 済み個体の決定論復活にしかならず新規人口を足せない)。行動カウンタ G.spawnRollCount は
// resolveTurn 呼び出しごとに進む(startDive で 0 リセット)。
function runtimeSpawnStep() {
  if (G.screen !== "dive" || !G.monsters) return;
  G.spawnRollCount = (G.spawnRollCount || 0) + 1;
  if (runtimeSpawnChanceRoll(G.px, G.py, G.seed, G.spawnRollCount) >= 0.30) return; // 30% ゲート。
  // 非対称オフセット: rand[0,55] + player − 28 → 実効レンジ [-28, +27](o.b(56)+i-28 verbatim。
  // ±28 は原作の実装が非対称なので +28 側が 1 マス広い翻案ではなく逐語)。
  const offX = Math.floor(runtimeSpawnOffsetXRoll(G.px, G.py, G.seed, G.spawnRollCount) * 56);
  const offY = Math.floor(runtimeSpawnOffsetYRoll(G.px, G.py, G.seed, G.spawnRollCount) * 56);
  // clamp: x∈[1,GRID_COLS-2] / y∈[11,DEPTH_ROWS-2](by.java:205-206 verbatim)。y 下限はクランプの
  // 帰結(spec §5「y≧11」はここが根拠。「11 未満なら不成立」ではなく「11 未満は 11 に丸められる」)。
  const col = Math.min(Math.max(G.px + offX - 28, 1), CONST.GRID_COLS - 2);
  const row = Math.min(Math.max(G.py + offY - 28, 11), CONST.DEPTH_ROWS - 2);
  // 16 マス圏外(いずれかの軸、OR)チェック。両軸とも 16 以内なら不成立(by.java:207 verbatim。
  // despawn の両軸 AND とは非対称な原作の癖 — STATUS v0.18.0 判断 E と同様、翻案せずそのまま採る)。
  if (Math.abs(col - G.px) <= CONST.MONSTER_ACTIVE_RANGE && Math.abs(row - G.py) <= CONST.MONSTER_ACTIVE_RANGE) return;
  // 未占有: 対象マス中心 Chebyshev 2(5x5)以内にモンスター(埋没含む)/未救出の女の子が居ないこと
  // (by.java:207 !a(nVar,iA,iA2) verbatim。girls も §8「モンスターと同経路で type=3 生成」=同じ
  // entity 層のため対象に含める)。ah()(overlay 層空きチェック)は port に同型レイヤーが無いため
  // 対象外(翻案、STATUS 先記録)。
  if (runtimeSpawnOccupied(col, row)) return;
  const t = tileAt(col, row);
  if (t === TILE.NONE) {
    const sp = runtimeSpawnSpecies(row, G.seed, G.spawnRollCount, G.px, G.py, false);
    if (sp) addMonster(sp, col, row, "runtime");
  } else if (t === TILE.SOIL || t === TILE.HARD || t === TILE.ROCK) {
    // 固体マスは埋没個体として配置(spawnBuriedMonsters と同じ state 構造。GIRL/SURFACE マスは
    // runtimeSpawnOccupied 側で実質除外済み=女の子セルは entity 占有ゲートに掛かる)。
    const sp = runtimeSpawnSpecies(row, G.seed, G.spawnRollCount, G.px, G.py, true);
    const meta = sp ? MONSTER[sp] : null;
    if (meta) {
      G.monsters.push({
        key: sp, col, row, hp: meta.hp, kind: "runtime-bury", buried: true, bt: 0, origCol: col, origRow: row,
        sp: meta.sp, sleeping: false, tk: 0, rc: 0, spawnCol: col, spawnRow: row, dir: 0,
      });
    }
  }
}

// (col,row) を中心に Chebyshev 2(5x5)以内にモンスター(埋没含む)/未救出の女の子が居るか
// (runtimeSpawnStep 専用。ゲート判定のみで描画/攻撃対象化はしない)。
function runtimeSpawnOccupied(col, row) {
  if (G.monsters) {
    for (const m of G.monsters) {
      if (Math.abs(m.col - col) <= 2 && Math.abs(m.row - row) <= 2) return true;
    }
  }
  if (G.girls) {
    for (const g of G.girls) {
      if (g.state === "rescued") continue;
      if (Math.abs(g.col - col) <= 2 && Math.abs(g.row - row) <= 2) return true;
    }
  }
  return false;
}

// ---- v0.18.0 モンスター AI(種別徘徊 + 2 層バンプ攻撃 + SP-睡眠。判断 A〜D/F/G) ----
// 意図的バンプゲートの種別確率・種別順序(原作 AI クラス verbatim: bl.java:28 / ce.java:31 /
// cf.java:29 / cg.java:24-31 / ci.a)。girl 優先種は 女→自、自機優先種は 自→女 の順に試行し、
// 各試行は「対象が 8 方向隣接(corner-cut 可)している場合のみ」ロールを 1 回引く。ゲート失敗時は
// 徘徊へ落ちる=隣接しても交戦ロックしない(原作どおり出入りする)。WORM はゲートなし(cj に攻撃
// 呼び出しなし=無害な土の住人。偶発バンプのみ)。
const BUMP_GATE = {
  [MON.BAT]: { order: "girl", girl: 80, self: 80 },
  [MON.SLIME]: { order: "girl", girl: 100, self: 80 },
  [MON.SLIME_HALF]: { order: "girl", girl: 100, self: 80 },
  [MON.SNAKE]: { order: "self", self: 100, girl: 50 },
  [MON.SPIDER]: { order: "self", self: 100, girl: 50 },
};
// BAT の 8 方向ランダム飛行の方向表(monsterAiRoll の [0,1) を 8 等分で引く)。
const DIRS8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// 個体 m のロールを 1 回引く(rc を進める)。monsterStep 系からのみ呼ばれる=活動箱 16 圏内で
// しか rc が進まない(判断 F の「活動圏内でのみ進む」を呼び出し構造で担保)。
function aiRoll(m) {
  m.rc = (m.rc || 0) + 1;
  return monsterAiRoll(m.spawnCol, m.spawnRow, G.seed, m.rc);
}

// (mc,mr) から (dc,dr) 方向へ移動/攻撃できるか(corner-cut 規則、判断 B)。斜めは両直交隣が
// どちらも塞がりなら不可(原作 n.c = v0.15.0 斜め掘り規則と同型)。直交方向は常に可。
function monsterDiagPassable(mc, mr, dc, dr) {
  if (dc === 0 || dr === 0) return true;
  return isSpace(mc + dc, mr) || isSpace(mc, mr + dr);
}

// m が自機を攻撃(偶発バンプ/意図的ゲートの共通実行)。ダメージ現行式 max(1, STR − 自機DEF)、
// 被ダメは二段ゲージへ(判断 B: 乱数幅式は台帳④既知の別翻案のまま非介入)。
function monsterAttackPlayer(m, meta) {
  const dmg = Math.max(1, meta.str - playerDef());
  takeDamage(dmg);
  spawnPopupAt(G.px, G.py, "-" + dmg, "warn");
}

// m が追従中の女の子 g を攻撃。ダメージ現行式 max(1, STR)(女の子は DEF を別に持たない)。
function monsterAttackGirl(m, meta, g) {
  const dmg = Math.max(1, meta.str);
  g.hp -= dmg;
  spawnPopupAt(g.col, g.row, "-" + dmg, "warn");
  if (g.hp <= 0) loseGirl(g);
}

// m に 8 方向隣接(corner-cut 可)している追従中の女の子を収集(判断 B: 攻撃対象は following のみ。
// hidden は土中で別レイヤーのため対象外=v0.17.0 と同じ前提)。
function adjacentFollowingGirls(m) {
  const out = [];
  if (!G.girls) return out;
  for (const g of G.girls) {
    if (g.state !== "following") continue;
    const dc = g.col - m.col, dr = g.row - m.row;
    if (Math.max(Math.abs(dc), Math.abs(dr)) !== 1) continue;
    if (!monsterDiagPassable(m.col, m.row, dc, dr)) continue;
    out.push(g);
  }
  return out;
}

// 意図的バンプゲート(判断 B ②)。攻撃を実行したら true、両ゲート不成立なら false(徘徊へ落ちる)。
function tryBumpGate(m, meta) {
  const gate = BUMP_GATE[m.key];
  if (!gate) return false; // WORM: 攻撃なし。
  const tryGirl = () => {
    const cands = adjacentFollowingGirls(m);
    if (!cands.length) return false;
    if (aiRoll(m) >= gate.girl / 100) return false;
    // 複数隣接時は周囲から収集してランダム 1 体(bk.java:44-56 と同型。1 体なら追加ロールなし)。
    const g = cands.length === 1 ? cands[0] : cands[Math.floor(aiRoll(m) * cands.length)];
    monsterAttackGirl(m, meta, g);
    return true;
  };
  const trySelf = () => {
    const dc = G.px - m.col, dr = G.py - m.row;
    if (Math.max(Math.abs(dc), Math.abs(dr)) !== 1) return false;
    if (!monsterDiagPassable(m.col, m.row, dc, dr)) return false;
    if (aiRoll(m) >= gate.self / 100) return false;
    monsterAttackPlayer(m, meta);
    return true;
  };
  return gate.order === "girl" ? tryGirl() || trySelf() : trySelf() || tryGirl();
}

// 徘徊 1 歩ぶんの SP 消費(判断 C: 徘徊移動 1 歩 = SP−1、SP0 で入眠)。落下・方向反転・攻撃は
// 消費しない(SP コストは bk の徘徊移動ヘルパー由来=移動成立時のみ)。WORM は SP 0 =消費なし・
// 眠らない(cj に SP コスト呼び出しなし)。
function spendMonsterSp(m, meta) {
  if (!meta.sp || meta.sp <= 0) return;
  m.sp = Math.max(0, (m.sp === undefined ? meta.sp : m.sp) - 1);
  if (m.sp <= 0) m.sleeping = true;
}

// 徘徊候補 (dc,dr) を 1 つ解決する。移動先が自機セルなら移動せず攻撃(偶発バンプ、bo.java:359-367
// verbatim=WORM 含む全種)。移動が成立したら SP を消費して true。盤外/固体/他個体/corner-cut
// 不可なら false(何もしない)。女の子セルはブロックしない(既存挙動どおり=偶発バンプは自機のみ)。
function tryWanderStep(m, meta, dc, dr) {
  if (dc === 0 && dr === 0) return false;
  const c = m.col + dc, r = m.row + dr;
  if (c < 0 || c >= CONST.GRID_COLS || r < 0 || r > CONST.DEPTH_ROWS) return false;
  if (!monsterDiagPassable(m.col, m.row, dc, dr)) return false;
  if (c === G.px && r === G.py) {
    monsterAttackPlayer(m, meta); // 偶発バンプ: 移動せず攻撃。
    return true;
  }
  if (!isSpace(c, r) || monsterAt(c, r)) return false;
  m.col = c;
  m.row = r;
  spendMonsterSp(m, meta);
  return true;
}

// 種別徘徊(判断 A/B。方向・確率はすべて aiRoll = 個体別決定論ストリーム)。
function monsterWander(m, meta) {
  if (m.key === MON.BAT) {
    // BAT: 8 方向ランダム飛行(bl。重力なし)。
    const [dc, dr] = DIRS8[Math.min(7, Math.floor(aiRoll(m) * 8))];
    tryWanderStep(m, meta, dc, dr);
    return;
  }
  if (m.key === MON.SNAKE) {
    // SNAKE: 方向持続パトロール(cg)。持続方向へ 平行→1 段登→1 段降 の順に試し、全部塞がりなら
    // 反転(このターンは移動なし。反転は SP 非消費)。初期方向はロールで確定。
    if (!m.dir) m.dir = aiRoll(m) < 0.5 ? -1 : 1;
    if (tryWanderStep(m, meta, m.dir, 0)) return;
    if (tryWanderStep(m, meta, m.dir, -1)) return;
    if (tryWanderStep(m, meta, m.dir, 1)) return;
    m.dir = -m.dir;
    return;
  }
  if (m.key === MON.SPIDER) {
    // SPIDER: dx∈{-1,0,1}・dy=75%:0 / 25%:−1(ci。糸・天井状態機械はスコープ外=既知残差分)。
    const dc = Math.min(2, Math.floor(aiRoll(m) * 3)) - 1;
    const dr = aiRoll(m) < 0.25 ? -1 : 0;
    tryWanderStep(m, meta, dc, dr);
    return;
  }
  if (m.key === MON.WORM) {
    // WORM: 空間では横ランダム(cj。落下は monsterStep の共通重力が先に済ませる)。
    const dc = Math.min(2, Math.floor(aiRoll(m) * 3)) - 1;
    tryWanderStep(m, meta, dc, 0);
    return;
  }
  // SLIME / SLIME_HALF: dx∈{-1,0,1}・dy∈{-1,0} ランダム(ce/cf。重力落下優先は共通重力が担う)。
  const dc = Math.min(2, Math.floor(aiRoll(m) * 3)) - 1;
  const dr = Math.min(1, Math.floor(aiRoll(m) * 2)) - 1;
  tryWanderStep(m, meta, dc, dr);
}

// モンスター 1 体の行動(v0.18.0 機構替え、判断 A〜D/G)。分岐順は原作準拠:
// 埋没(土中 tick)→ 眠り(回復のみ)→ WORM の SPD 剰余ゲート → 重力落下(接地種、落下ターンは
// 攻撃しない)→ 意図的バンプゲート → 種別徘徊(移動先が自機なら偶発バンプ)。
function monsterStep(m, meta) {
  // v0.17.0 判断 F: 埋没中は土中 tick(衰弱+脱出抽選)のみ。bump も徘徊もしない(土の中に居る)。
  if (m.buried) {
    buriedTick(m, meta);
    return;
  }
  // 判断 C: 眠り中は行動なし(攻撃もしない)+ 毎ターン sprec 回復、満タンで覚醒。被弾即覚醒は
  // attackMonster 側(各 j() 相当)。
  if (m.sleeping) {
    m.sp = Math.min(meta.sp, (m.sp || 0) + (meta.sprec || 0));
    if (m.sp >= meta.sp) m.sleeping = false;
    return;
  }
  // 判断 D: SPD 剰余ゲートは WORM のみ(cj.java:31-33/72-74 が唯一の一次確認)。行動関数の冒頭
  // ゲートなので落下含む全行動を律速する。tk % SPD(=3) == 0 のターンだけ動く。他 5 種は毎ターン。
  if (m.key === MON.WORM && meta.spd > 1 && m.tk % meta.spd !== 0) return;
  // 判断 G: 接地種(BAT 以外)は下が空間なら徘徊より先に 1 マス落下し、そのターンは攻撃しない
  // (原作の分岐順)。落下先が自機セルなら偶発バンプ経路で攻撃(上から降ってくる)。BAT は飛行=
  // 重力なし。流体との相互作用は未実装のまま(既知残差分=流体セルも空間として落ち抜ける)。
  if (m.key !== MON.BAT) {
    const below = m.row + 1;
    if (below <= CONST.DEPTH_ROWS) {
      if (G.px === m.col && G.py === below) {
        monsterAttackPlayer(m, meta); // 落下バンプ(bo.a 経路)。移動しない。
        return;
      }
      if (isSpace(m.col, below) && !monsterAt(m.col, below)) {
        m.row = below; // 1 マス落下(SP 非消費)。落下ターンは攻撃しない。
        return;
      }
    }
  }
  // 判断 B ②: 意図的バンプゲート(種別確率・種別順序)。失敗時は徘徊へ落ちる。
  if (tryBumpGate(m, meta)) return;
  // 判断 A: 種別徘徊(移動先が自機セルなら偶発バンプ=判断 B ①)。
  monsterWander(m, meta);
}

// 護衛中の女の子が HP 0 でロスト。following → hidden へ戻し、元の埋没位置(col, origRow)へ戻す。
// 救出済みカウント(G.rescued)とは独立=未救出のまま盤面に残る。
//
// 再発見の責務(v0.5.0 修正): 初回発見は act の GIRL タイル掘り抜きで discoverGirl が発火するが、
// 一度発見した元マスは掘り抜き時点で G.dug 入り(=tileAt が NONE)になっているため、二度と
// TILE.GIRL 掘削分岐を通らない。よってロスト後の再発見は「掘り直し」では原理的に起こらず、
// hidden の女の子がそのマスへ"戻る"だけでは詰む。再発見の真の条件は state(その人が hidden で
// そのマスに居る)であって tile レイヤ(tileType=GIRL)ではないので、再発見は自機がそのマスへ
// 侵入したとき(moveTo で確定する自機位置)に state 側を 1 回引いて発火させる(tryRediscoverGirlAt)。
// loseGirl は state を hidden へ戻して原位置へ置くだけ(tile/dug は触らない=dug 不変条件を保つ)。
// EXPECTED_GIRLS(初期配置)とも矛盾しない(原位置に戻るだけ、別マスへ移さない)。
function loseGirl(g) {
  g.hp = CONST.GIRL_HP;
  spawnPopupAt(g.col, g.row, "！", "warn");
  // v0.10.0: 同行中の仲間がロストしたら同行も解除(地表で別れていない=清算しない)。貯めた cexp/level は
  // girl に残るので、再発見/再同行で続きから戦える(原作の「護衛中も狙われる」誘導難度=死の緊張の二面)。
  detachCompanion(g);
  if (g.deployed) {
    // v0.11.0 ②: 救出済みストックから同行に出した子がロスト = 同行が崩れただけ。ストック(rescued)へ
    // 戻す(既に救出済みなので地中に hidden で再配置はしない=世界の女の子に戻さない)。cexp/level は残す。
    g.deployed = false;
    g.state = "rescued";
    showHint("仲間が傷つき、同行を解いた。地上の仲間に戻った", true);
    return;
  }
  // 初回発見の子がロスト: hidden へ戻し原位置へ置く(tile/dug は触らない=dug 不変条件・再発見を保つ)。
  g.state = "hidden";
  g.col = g.origCol !== undefined ? g.origCol : g.col;
  g.row = g.origRow;
  showHint("女の子が傷つき、地中へ取り残された。もう一度その場所へ行って助け直そう", true);
}

// 自機が (col,row) へ侵入した瞬間の女の子再発見。元マスが既に掘り抜き済み(NONE)で TILE.GIRL 掘削
// 分岐を通らなくなった hidden の女の子を、自機がそのマスを踏んだら再発見する(discoverGirl は
// hidden を col/row で引くので、初回発見と同じ経路へ合流=following へ復帰)。発見条件を tile では
// なく state(hidden の所在)に置くことで、ロスト→再侵入→再誘導が原理的に成立しクリア可能を保つ。
function tryRediscoverGirlAt(col, row) {
  if (!G.girls) return;
  for (const g of G.girls) {
    if (g.state === "hidden" && g.col === col && g.row === row) {
      discoverGirl(col, row);
      return;
    }
  }
}

// ---- 移動 + 重力解決 ---------------------------------------------------
// 指定マスへ移動した後、重力で足元が空間の間 1 マスずつ落下する。
// 落下も追従もまとめて 1 行動(掘り/移動)としてコストは呼び出し側で済んでいる前提だが、
// 移動単体(空間への踏み込み)はここで spendAction する。
function moveTo(col, row, costPaid, noGravity) {
  G.px = col;
  G.py = row;
  if (!costPaid) spendAction(); // 移動/掘り後の前進。掘りは act 側で消費済みなので二重にしない。
  // 重力: 足元が空間なら 1 マスずつ落下(落下中は入力解決を 1 マスずつ)。
  // ただし上移動(クライム)の 1 歩は引き戻さない(noGravity)。
  if (!noGravity) applyGravity();
  revealAround();
  resolveCaveins(); // v0.7.0: 支えを失った不安定土(なだれ土)が崩れ落ちて道を塞ぎ、自機/女の子を埋める。
  if (G.screen !== "dive") return; // 崩落の埋没ダメージで力尽きたら離脱。
  recordPlayerStep(); // v0.11.0 ①: 重力で落ち着いた自機セルを足跡履歴へ記録(追従の single source of truth)。
  tryRediscoverGirlAt(G.px, G.py); // ロスト後 hidden の女の子が居るマスへ侵入したら再発見(following 復帰)。
  advanceGirl();
  if (G.py === 0) {
    surfaceReturn();
    return;
  }
  if (G.py > G.maxDepthThisDive) G.maxDepthThisDive = G.py;
  // v0.16.0: noteHazardEntry は resolveTurn へ移設(静止していても水が流れ込んでくる動的化)。
  resolveTurn(); // 流動→浸水→ヒント→checkFail→モンスター反応(判断 E の 1 本化)。
  renderHud();
  checkFail();
}

// ---- v0.7.0 なだれ/落盤 崩落物理 --------------------------------------
// 崩落ダメージ係数を 1 箇所に集約(将来の育成=支え木/落盤回避が CAVEIN_MITIGATION を 1 点で割る)。
function caveinDamage() {
  return Math.max(0, Math.round(CONST.CAVEIN_DAMAGE / CONST.CAVEIN_MITIGATION));
}

// 掘り抜いたのが不安定土(なだれ土)なら落下候補として記録(真下が空くと崩れる)。
function markUnstableDug(col, row) {
  if (!G.unstableDug) return;
  G.unstableDug.add(col + "," + row);
}

// 支えを失った不安定土(なだれ土)を崩落させる。掘り抜いた不安定土マス(unstableDug)の真下が空間に
// なっていれば、緩んだ土塊がその列を落ちて第 1 の固体床の上へ積もる(=道を塞ぐ)。落ちてきたマスに
// 自機/女の子が居れば埋没ダメージ。決定論(全 unstableDug を列・行で安定順走査、ランタイム乱数なし)。
// 崩落しても soft-lock しない(掘り直せる・別ルートあり・撤退は続く)=非破壊の崩落圧。
function resolveCaveins() {
  if (!G.unstableDug || !G.unstableDug.size) return;
  // 安定した決定論順(row 昇順 → col 昇順)で走査。落下の連鎖が起きてもこの 1 パスで列ごと解決する
  // (上の不安定土から順に落とすので、下に積もった土の上へ更に上の土が乗る整合が取れる)。
  const keys = [...G.unstableDug].map((k) => k.split(",").map(Number));
  keys.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  for (const [col, srcRow] of keys) {
    // 既に塞がれた/まだ空間でない元マスはスキップ(掘り直して再度不安定化したケースは別途記録される)。
    if (G.fallen.has(col + "," + srcRow)) continue;
    if (!isSpace(col, srcRow)) continue; // 元マスが空間でなければ落ちる土が無い。
    // 真下が固体なら支えがある=崩れない。空間なら落ちる先(その列の第 1 固体床の直上)を探す。
    let dest = srcRow;
    let guard = 0;
    while (guard < CONST.DEPTH_ROWS + 2) {
      guard++;
      const below = dest + 1;
      if (below > CONST.DEPTH_ROWS) break; // 底=これ以上落ちない。
      if (isSpace(col, below)) dest = below; // 真下が空間=さらに落ちる。
      else break; // 真下が固体=ここで止まる。
    }
    if (dest === srcRow) continue; // 真下が固体で支えあり=崩れない。
    // dest へ土塊が積もる(固体 SOIL に戻る=道を塞ぐ)。元マス srcRow は空のまま(緩んだ土が抜けた跡)。
    G.fallen.add(col + "," + dest);
    G.unstableDug.delete(col + "," + srcRow);
    G.dug.delete(col + "," + dest); // 掘った跡だったマスが塞がれる(帰り道の消失)。
    if (G.fluid) G.fluid.delete(col + "," + dest); // v0.16.0: 着地マスの流体は消す(土での埋め立て、判断 E)。
    spawnPopupAt(col, dest, "▼", "warn"); // 崩落の視覚合図。
    playSfx("blocked"); // 専用 SFX 無し=塞がりの警告音を流用。
    // v0.17.0 判断 E: 着地マスのアクティブ個体は土中へ戻す(spec §6「崩落で埋まった個体は土中個体化」。
    // v0.16.0 まで「土に取り残されたまま行動し続ける」既存エッジの解消)。埋没起点(origCol/origRow)と
    // 覚醒カウンタ bt は着地マスで再スタート(実装値: 脱出抽選の位相を今埋まっている土に合わせる。
    // 空間スポーン個体は origCol/origRow 未設定のためここで初めて持つ)。
    const reburied = monsterAt(col, dest);
    if (reburied) {
      reburied.buried = true;
      reburied.origCol = col;
      reburied.origRow = dest;
      reburied.bt = 0;
    }
    // 埋没判定: 落ちてきたマスに自機/女の子が居れば埋まる。
    buryUnitsAt(col, dest);
    if (G.screen !== "dive") return; // 自機の埋没で力尽きたら離脱。
  }
}

// 崩落したマス(col,row)に居る自機/女の子を埋める。自機は二段ゲージへ被ダメ、女の子はロスト(原位置復帰)。
function buryUnitsAt(col, row) {
  // 自機の埋没。
  if (G.px === col && G.py === row) {
    takeDamage(caveinDamage()); // 既存二段ゲージ(SP→HP)へ接続=独自 HP 経路を作らない。
    showHint("なだれに巻き込まれた。土をどかして抜け出そう", true);
    // 自機は土の上(直上)へ押し上げる(埋まったまま固体に閉じ込めない=soft-lock 回避)。
    if (isSpace(col, row - 1) || row - 1 <= 0) G.py = Math.max(0, row - 1);
    checkFail();
    if (G.screen !== "dive") return;
  }
  // 女の子の埋没(GIRLATK のロストと同経路=原位置復帰で再発見可能性を保つ)。
  if (G.girls) {
    for (const g of G.girls) {
      if (g.state === "following" && g.col === col && g.row === row) {
        g.hp -= caveinDamage();
        spawnPopupAt(col, row, "-" + caveinDamage(), "warn");
        if (g.hp <= 0) loseGirl(g);
      }
    }
  }
}

// v0.6.0→v0.16.0: 自機マスの浸水種(fluidAt=流体 state ベース)が変わったとき(NONE→水/マグマ、
// 水↔マグマ)だけ 1 回ヒントを出す(連続滞在でヒント連発しないよう lastHazard と比較)。
// v0.16.0 で moveTo から resolveTurn へ移設(静止していても水が流れ込んでくる)。
function noteHazardEntry() {
  const h = fluidAt(G.px, G.py);
  if (h === G.lastHazard) return;
  G.lastHazard = h;
  if (h === HAZARD.WATER) showHint(TEXT.cueWater, true);
  else if (h === HAZARD.MAGMA) showHint(TEXT.cueMagma, true);
}

// 自機の重力落下(足元が空間の間、底まで落ちる)。落下はコスト無し(原作の落下と同様)。
// 地表(row 0)は安全な地面 = 立てる帰還地点なので重力は作用しない(掘った縦坑へ吸い込まれない)。
// v0.16.0 浮力(判断 D、原作 n.y()=水/マグマ上は重力無効): 現在マスに流体があれば落下しない。
// 落下ループ中も流体セルへ入った時点で停止(着水して浮く)。上移動は既存クライム/斜め上 moveTo が
// そのまま泳ぎとして機能(新規分岐なし)。女の子・モンスターは非介入。
function applyGravity() {
  if (G.py <= 0) return; // 地表に立っている間は落ちない。
  if (fluidAt(G.px, G.py) !== HAZARD.NONE) return; // 浮力: 流体中は落ちない。
  let guard = 0;
  while (guard < CONST.DEPTH_ROWS + 2) {
    guard++;
    const below = G.py + 1;
    if (below > CONST.DEPTH_ROWS) break; // 底。
    // v0.5.0: 真下にモンスターが居れば、その上で踏み止まる(モンスターはマスを塞ぐ)。
    if (isSpace(G.px, below) && !monsterAt(G.px, below)) {
      G.py = below;
      if (G.py > G.maxDepthThisDive) G.maxDepthThisDive = G.py;
      if (fluidAt(G.px, G.py) !== HAZARD.NONE) break; // 着水: 流体セルに入ったらそこで浮いて停止。
    } else break;
  }
}

// ---- 女の子: 発見と追従(v0.11.0 足跡キュー方式へ作り直し) ----------------
// 【作り直しの核】旧 advanceOneGirl は bfsStep(女の子→自機の最初の1歩)+ 独立重力で追従を組んでおり、
// ジグザグ掘削で女の子が自機を追うのに横移動が要るとき、その横一歩が上向きでないため毎手 重力で
// 縦坑の底へ落とし戻され「発見後ずっと底に張り付く」破綻があった(実機 FB で確定)。重力条件いじり
// /bfs guard 追加は同一原因への 2 周目になるため、追従の責務を「自機が実際に通った足跡履歴」という
// single source of truth へ引き直す: 自機が掘って通った経路は必ず空洞なので、その履歴を 1 手ずつ
// 消化する追従は経路探索失敗も横移動での重力落とし戻しも原理的に発火しない(底張り付き同時消滅)。
// → 女の子は独立に落下しない(足跡が空洞である保証で重力責務を足跡記録側へ移す)。

// 自機の足跡履歴 G.playerTrail へ「重力で落ち着いた現在セル」を 1 件追記(連続重複は畳む)。
// この履歴を following 中の女の子が g.trailIdx を進めながら消化して追う(追従の正本)。
function recordPlayerStep() {
  if (!G.playerTrail) G.playerTrail = [];
  const last = G.playerTrail[G.playerTrail.length - 1];
  if (last && last[0] === G.px && last[1] === G.py) return; // 同セルは積まない。
  G.playerTrail.push([G.px, G.py]);
  gcPlayerTrail();
}

// v0.11.0 (A) 足跡キューの GC(リングバッファ的切り詰め): 長い潜行で playerTrail が際限なく伸びるのを
// 防ぐ。全 following 中の女の子の min(trailIdx) より前の古い足跡はもう誰も消化しないので切り捨て、
// 切った分(cut)だけ playerTrail を前詰めし全 girl の trailIdx を -cut 補正する(trailIdx の意味=
// 「その girl が今どこまで消化したか」が切り詰め後もずれない)。following が 0 人なら現在の自機セル
// 1 点へ畳む(誰も追っていないので履歴不要)。決定論=状態遷移のみ(乱数なし)。
function gcPlayerTrail() {
  const trail = G.playerTrail;
  if (!trail || trail.length === 0) return;
  const followers = (G.girls || []).filter((g) => g.state === "following");
  if (followers.length === 0) {
    // 追従者ゼロ: 末尾(現在の自機セル)1 点だけ残す。次の発見/同行は startFollowing で trailIdx を
    // この末尾(length)に合わせるので整合する。
    if (trail.length > 1) G.playerTrail = [trail[trail.length - 1]];
    return;
  }
  // 全追従者がまだ消化していない最小インデックス。これより前は誰も参照しないので捨てられる。
  let cut = trail.length;
  for (const g of followers) {
    const idx = g.trailIdx === undefined ? trail.length : g.trailIdx;
    if (idx < cut) cut = idx;
  }
  if (cut <= 0) return; // 切れる余地なし。
  G.playerTrail = trail.slice(cut); // 前 cut 件を捨てて前詰め。
  for (const g of G.girls) {
    if (g.trailIdx === undefined) continue;
    g.trailIdx = Math.max(0, g.trailIdx - cut); // 切った分だけ全 girl の参照位置を補正。
  }
}

// 女の子を「自機の足跡を追う」状態へ入れる(発見/再発見/再同行の共通入口)。
// trailIdx は現在の足跡末尾に合わせる = 以降に自機が刻む足跡を順に消化して付いてくる。
function startFollowing(g) {
  g.state = "following";
  if (!G.playerTrail) G.playerTrail = [];
  g.trailIdx = G.playerTrail.length; // 発見時点では自機と同セル(掘り当て直後)=ここから後ろを追う。
}

function discoverGirl(col, row) {
  if (!G.girls) return;
  for (const g of G.girls) {
    if (g.state === "hidden" && g.col === col && g.row === row) {
      startFollowing(g);
      showHint(TEXT.cueGirlFound, false);
      spawnPopupAt(col, row, "！", "cue");
      playSfx("found");
      return;
    }
  }
}

// 追従中の女の子を全員 1 歩ずつ自機の足跡に沿って進める(per-girl は advanceOneGirl)。
function advanceGirl() {
  if (!G.girls) return;
  for (const g of G.girls) {
    if (g.state === "following") advanceOneGirl(g);
  }
}

// v0.11.0 ②境界修正: 救出の発火を「女の子自身が row0 セルに乗る」依存から外す。
// 自機が地表(py=0)に居て、追従中の女の子が足跡を消化しきって自機の直後まで来ている
// (trailIdx が末尾-1 以上=snake 追従でこれ以上前へ詰められない位置)なら、その子は地表帰還=救出成立。
// これが無いと「自機が地表で静止していると女の子が 1 マス後ろ(row1)で止まり救出されない」(実機 FB)。
// advanceOneGirl(通常の追従)と surfaceReturn(帰還ドレイン)の両合流点でこの 1 つの述語に集約する。
function caughtUpAtSurface(g) {
  if (G.py !== 0) return false; // 自機が地表に居るときだけ(撤退の報酬は地表帰還が条件)。
  const trail = G.playerTrail || [];
  // 末尾-1 まで消化済み = 自機の 1 マス後ろまで詰めている(snake 追従の限界)= 追いついた。
  return g.trailIdx >= trail.length - 1;
}

// 追従中の女の子 1 人を、自機の足跡履歴(G.playerTrail)に沿って 1 マス前進させる。
// 足跡末尾(自機の最新セル)の 1 つ手前まで追う = 自機に重ならず 1 マス後ろを保つ(snake 追従)。
// 足跡セルは自機が実際に通った空洞なので必ず通行可 = 経路探索失敗も独立重力も無い(底張り付き解消)。
// 次の足跡セルにモンスターが居れば踏み込まず待機(GIRLATK で削られうる誘導難度=既存仕様を保つ)。
function advanceOneGirl(g) {
  const trail = G.playerTrail || [];
  if (g.trailIdx === undefined) g.trailIdx = trail.length;
  // 自機の最新セル(末尾)は自機が居るので、その手前(length-1)まで消化して 1 マス後ろに付く。
  const target = trail.length - 1;
  if (g.trailIdx >= target) {
    // これ以上前へは詰められない。自機が地表に居て追いついていれば救出成立(row1 で止まらせない)。
    if (caughtUpAtSurface(g)) rescueGirl(g);
    return;
  }
  const next = trail[g.trailIdx];
  if (!next) { g.trailIdx++; return; }
  // モンスターが足跡上に居れば踏み込まず待機(交戦で退くまで足止め=誘導難度)。trailIdx は進めない。
  if (monsterAt(next[0], next[1])) { showHint(TEXT.cueGirlBlocked, true); return; }
  g.col = next[0];
  g.row = next[1];
  g.trailIdx++;
  if (g.row === 0 || caughtUpAtSurface(g)) rescueGirl(g);
}

// (v0.18.0 判断 B: 旧 bfsStep(モンスター追跡 BFS)は機構替えで参照が無くなったため削除。
//  女の子追従は v0.11.0 から足跡キュー方式で bfsStep 非依存。)

// 追従中の女の子が地表(row0)へ到達したときの処理(advanceOneGirl / surfaceReturn の合流点)。
// v0.11.0 ②: 2 経路に分かれる。
//   (a) 救出済みストックから同行に出した子(deployed)が帰還 = 「別れてレベルアップ→ストックへ戻る」
//       (原作 §5)。rescued/info は二重計上しない(初回救出で計上済み)、settleCompanion で清算し
//       state を rescued へ戻す。
//   (b) 地中で初めて発見した子が帰還 = 初回救出。rescued/info を +1 してストック入り(rescued)。
function rescueGirl(g) {
  if (g.state === "rescued") return;
  if (g.deployed) {
    // (a) 同行に出した救出済みの子が地表へ戻った = 別れてレベルアップ→ストックへ。
    g.deployed = false;
    g.state = "rescued";
    if (G.companion === g) settleCompanion(g); // cexp→level 清算 + companion 解除。
    return;
  }
  // (b) 初回救出。
  g.state = "rescued";
  G.rescued += 1;
  G.info = (G.info || 0) + 1; // v0.9.0: 救出成立で「情報」を +1(育成資源。Lv.UP 画面で BP へ変換=消費)。
  setInt(RESCUE_KEY, getInt(RESCUE_KEY) + 1); // 生涯救出数(タイトル表示)。各人 1 回だけ加算。
  if (G.companion === g) settleCompanion(g);
}

// 清算なしの同行解除(地表で別れていない経路): cexp→level の繰り上げをせずに companion を手放す。
// 呼び出し側で g === G.companion を確認してから渡す。loseGirl(ロスト)/surfaceReturn(帰れず地中残留)が使う。
// settleCompanion(地表帰還の清算) とは別系統=援護持ち越しの抜け道を作らないため、解除の 1 点集約として置く。
function detachCompanion(g) {
  if (G.companion === g) G.companion = null;
}

// 同行中の仲間が地表へ帰還した瞬間の清算: cexp→level へ変換し、companion を解除(別れる)。
// 端数 cexp は繰り越し残す(次の同行で続きから貯まる)。レベルは上限 COMPANION_LV_MAX で頭打ち。
function settleCompanion(g) {
  const gain = companionLevelGain(g.cexp, CONST.COMPANION_EXP_PER_LV, CONST.COMPANION_LV_MAX, g.level || 0);
  if (gain > 0) {
    g.level = (g.level || 0) + gain;
    g.cexp -= gain * CONST.COMPANION_EXP_PER_LV;
    showHint("仲間と地上で別れた。レベルが " + g.level + " に上がった", false);
    playSfx("heal");
  } else {
    showHint("仲間と地上で別れた", false);
  }
  G.companion = null;
}

// クリア判定(§7 忠実): 全員救出 かつ 最下層到達 かつ 探索率がしきい値以上。
function isDungeonCleared() {
  return (
    G.rescued >= CONST.GIRL_COUNT &&
    G.maxDepthThisDive >= CONST.DEPTH_ROWS &&
    exploreRatio() >= CONST.CLEAR_EXPLORE
  );
}

// 地表帰還時、未クリアなら残りのクリア要件を簡潔に示すヒント文。
function surfaceProgressText() {
  const need = [];
  if (G.rescued < CONST.GIRL_COUNT) need.push("救出 " + G.rescued + "/" + CONST.GIRL_COUNT);
  if (G.maxDepthThisDive < CONST.DEPTH_ROWS) need.push("最下層 未到達");
  if (exploreRatio() < CONST.CLEAR_EXPLORE) need.push("探索 " + Math.round(exploreRatio() * 100) + "%");
  if (!need.length) return TEXT.cueSurface;
  return "地表。全回復。残り → " + need.join("・");
}

// ---- 地表帰還 = 全回復(撤退の報酬) -----------------------------------
function surfaceReturn() {
  // 追従中の女の子は自機の足跡を 1 マス後ろから辿っている。自機が地表に着いたら、残った足跡
  // (末尾=地表の自機セルまで)を一気に消化して全員が地表へ上がりきる(v0.11.0: bfsStep でなく
  // 足跡履歴を最後まで消化する=追従の正本に一貫させる。足跡は自機が実際に通った空洞なので必ず到達可)。
  const trail = G.playerTrail || [];
  if (G.girls) {
    for (const g of G.girls) {
      if (g.state !== "following") continue;
      if (g.trailIdx === undefined) g.trailIdx = trail.length;
      let guard = 0;
      // 残りの足跡(末尾=自機の地表セルを含む)を順に消化する。モンスターが足跡上に居れば
      // そこで足止め(地中残留=掘り直し)。消化しきって自機に追いつけば救出(row0 到達 or 追いつき)。
      while (g.state === "following" && g.trailIdx < trail.length && guard < trail.length + 4) {
        guard++;
        const next = trail[g.trailIdx];
        if (!next) { g.trailIdx++; continue; }
        if (monsterAt(next[0], next[1])) break; // 足跡上の敵で足止め(地中残留)。
        g.col = next[0];
        g.row = next[1];
        g.trailIdx++;
        if (g.row === 0) { rescueGirl(g); break; }
      }
      // v0.11.0 ②境界修正: 自機が地表で、足跡を消化しきって追いついた(末尾-1 以上)子は、row0 セルに
      // 物理的に乗っていなくても地表帰還=救出成立(自機が地表に戻りさえすれば追従しきった子は救出)。
      if (g.state === "following" && caughtUpAtSurface(g)) rescueGirl(g);
      // 上がりきれず地中に残った同行者は地表で別れていない = 同行解除(清算しない)。これを欠くと
      // companion が地中残留 following を指したまま全回復→継続し、次の潜行で援護(effCompanionAtk)が乗り
      // cexp が再加算される抜け道になる(rescueGirl 成立時は settleCompanion で解除済=ここは no-op)。
      if (g.state === "following") detachCompanion(g);
    }
  }
  // best 記録。
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  // クリア(§7): 全員救出 + 最下層到達 + 探索率しきい値 を満たして地表 = ダンジョン制覇。
  if (isDungeonCleared()) {
    showClear();
    return;
  }
  // 未クリアの撤退 = 全回復して継続(救出済み・掘った跡・探索率・最深度はランで保持)。
  // v0.9.0: PER_HP/PER_ST で上がった実効最大値まで回復(育成前は素の CONST と一致)。
  G.stamina = effStaminaMax();
  G.hp = effHpMax();
  G.enteredHpZone = false;
  // v0.16.0: 地表 = 水の外なので息継ぎ(moveTo は surfaceReturn で early return し resolveTurn の
  // tickSubmersion を通らないため、ここで明示リセット。残り息表示の地表残留も防ぐ)。
  G.breath = 0;
  G.drownNoted = false;
  savePersistent(); // v0.12.0: 地上帰還時に永続 state を保存(力尽きたら前回の地上帰還時点に戻る)。
  showHint(surfaceProgressText(), false);
  playSfx("heal");
  renderHud();
}

// ---- 失敗(体力 0) ----------------------------------------------------
function checkFail() {
  if (G.hp <= 0 && G.py > 0 && G.screen === "dive") {
    // v0.14.0 判断C(保険本丸): 力尽きた瞬間の自機位置が電波圏内なら携行アイテムを1回だけ持ち越す。
    if (inRadioCoverage(G.px, G.py)) saveInsurance();
    showFail();
  }
}

// ---- 画面遷移(overlay) -----------------------------------------------
function showOverlay() {
  overlayEl.hidden = false;
  requestAnimationFrame(() => overlayEl.classList.add("visible"));
}
function hideOverlay() {
  overlayEl.classList.remove("visible");
  overlayEl.hidden = true;
  ovHowtoEl.innerHTML = "";
}
function resetOverlayParts() {
  ovTitleEl.hidden = true;
  ovTitleEl.classList.remove("small-title");
  ovSubEl.hidden = true;
  ovHowtoEl.hidden = true;
  ovHowtoEl.innerHTML = "";
  ovActionEl.hidden = true;
  ovAction2El.hidden = true;
  ovVersionEl.hidden = true;
  ovActionEl.onclick = null;
  ovAction2El.onclick = null;
}

function showTitle() {
  G.screen = "title";
  hudEl.hidden = true;
  loadDungeonProgress();
  if (!G.cleared) G.cleared = new Set();
  if (!G.unlocked) G.unlocked = new Set([0]);
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.title;
  ovTitleEl.hidden = false;
  // ダンジョン選択リストを ovHowto 領域に動的生成。
  ovHowtoEl.innerHTML = "";
  for (let i = 0; i < DUNGEON_DATA.length; i++) {
    const d = DUNGEON_DATA[i];
    const isUnlocked = G.unlocked.has(i);
    const isCleared = G.cleared.has(i);
    const btn = document.createElement("button");
    btn.className = "dungeon-btn" + (isUnlocked ? "" : " locked");
    btn.type = "button";
    if (isUnlocked) {
      btn.textContent = (isCleared ? "✓ " : "▶ ") + d.name;
      const did = i;
      btn.onclick = () => { G.dungeonId = did; onStartPressed(); };
    } else {
      btn.textContent = "🔒 " + d.name;
      btn.disabled = true;
    }
    ovHowtoEl.appendChild(btn);
  }
  ovHowtoEl.hidden = false;
  ovAction2El.textContent = TEXT.howtoButton;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => showHowto("title");
  ovVersionEl.textContent = VERSION;
  ovVersionEl.hidden = false;
  showOverlay();
}

function onStartPressed() {
  if (!seenHowto()) showHowto("start");
  else startDive();
}

function showHowto(returnTo) {
  G.screen = "howto";
  hudEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.howtoTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovHowtoEl.innerHTML = "";
  for (const line of TEXT.howto) {
    const p = document.createElement("p");
    p.className = "howto-line";
    p.textContent = line;
    ovHowtoEl.appendChild(p);
  }
  ovHowtoEl.hidden = false;
  if (returnTo === "start") {
    ovActionEl.textContent = TEXT.howtoStart;
    ovActionEl.onclick = () => {
      markHowtoSeen();
      startDive();
    };
  } else {
    ovActionEl.textContent = TEXT.howtoBack;
    ovActionEl.onclick = () => showTitle();
  }
  ovActionEl.hidden = false;
  showOverlay();
}

function showFail() {
  G.screen = "fail";
  hudEl.hidden = true;
  playSfx("fail");
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  const d = DUNGEON_DATA[G.dungeonId];
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.failTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  const dname = d ? d.name : "";
  ovSubEl.textContent = (dname ? dname + " — " : "") + TEXT.failSub + "　" + TEXT.depthPrefix + G.maxDepthThisDive + TEXT.depthSuffix;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.retry;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => startDive();
  ovAction2El.textContent = TEXT.backToTitle;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => showTitle();
  showOverlay();
}

function showClear() {
  G.screen = "clear";
  hudEl.hidden = true;
  playSfx("clear");
  clearPersistent();
  clearAntennas(); // v0.14.0: 設置済みアンテナはクリアで消去(判断C)。
  if (!G.cleared) G.cleared = new Set();
  if (!G.unlocked) G.unlocked = new Set([0]);
  G.cleared.add(G.dungeonId);
  const nextId = G.dungeonId + 1;
  const hasNext = nextId < DUNGEON_DATA.length;
  if (hasNext) G.unlocked.add(nextId);
  saveDungeonProgress();
  const d = DUNGEON_DATA[G.dungeonId];
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.clearTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  const sub = d ? d.name + " 制覇" : TEXT.clearSub;
  ovSubEl.textContent = hasNext ? sub + " — " + TEXT.dungeonUnlocked : sub;
  ovSubEl.hidden = false;
  if (hasNext) {
    ovActionEl.textContent = TEXT.nextDungeon;
    ovActionEl.hidden = false;
    ovActionEl.onclick = () => { G.dungeonId = nextId; startDive(); };
    ovAction2El.textContent = TEXT.backToTitle;
    ovAction2El.hidden = false;
    ovAction2El.onclick = () => showTitle();
  } else {
    ovActionEl.textContent = TEXT.backToTitle;
    ovActionEl.hidden = false;
    ovActionEl.onclick = () => showTitle();
  }
  showOverlay();
}

// ---- HUD レンダリング(DOM) --------------------------------------------
function renderHud() {
  const d = DUNGEON_DATA[G.dungeonId];
  const dname = d ? d.name : "";
  depthValEl.textContent = (dname ? dname + " " : "") + TEXT.depthPrefix + G.py + TEXT.depthSuffix;
  rescueValEl.textContent = G.rescued + "/" + CONST.GIRL_COUNT;
  exploreValEl.textContent = Math.round(exploreRatio() * 100) + "%";
  if (expValEl) expValEl.textContent = G.exp || 0; // v0.5.0 EXP 蓄積(育成未実装=表示のみ)。
  const spRatio = Math.max(0, Math.min(1, G.stamina / effStaminaMax())); // v0.9.0: 実効最大値でバー比率。
  staminaFillEl.style.width = spRatio * 100 + "%";
  staminaValEl.textContent = Math.round(G.stamina);
  const hpRatio = Math.max(0, Math.min(1, G.hp / effHpMax()));
  hpFillEl.style.width = hpRatio * 100 + "%";
  hpValEl.textContent = Math.round(G.hp);
  // スタミナ切れ(体力ゾーン)で警告色。
  gaugeEl.classList.toggle("hp-zone", G.stamina <= 0);
  renderInventory();
}

// ---- v0.4.0 インベントリ表示(鉱石数 + 所持道具)。canvas 外 DOM。 ---------
function renderInventory() {
  if (!invEl || !G.ore) return;
  // 鉱石 6 種(石炭/鉄鉱石/化石/鋼/ルビー/ダイヤ、v0.14.0 原作実名へ名寄せ)。
  if (oreCoalEl) oreCoalEl.textContent = G.ore.COAL || 0;
  if (oreIronEl) oreIronEl.textContent = G.ore.IRON_ORE || 0;
  if (oreFossilEl) oreFossilEl.textContent = G.ore.FOSSIL || 0;
  if (oreSteelEl) oreSteelEl.textContent = G.ore.STEEL || 0;
  if (oreRubyEl) oreRubyEl.textContent = G.ore.RUBY || 0;
  if (oreDiamondEl) oreDiamondEl.textContent = G.ore.DIAMOND || 0;
  // 道具: ツルハシ最強段アイコン / はしご数 / アンテナ数。
  const p = PICK[G.pick];
  if (pickIcoEl) pickIcoEl.textContent = p ? p.ico : "木";
  // v0.13.1 はしご: 所持数表示 + 設置/回収トグルの disabled 制御。
  if (ladderValEl) ladderValEl.textContent = G.ladders || 0;
  if (btnLadderEl) {
    const onLadder = G.placedLadders && G.placedLadders.has(G.px + "," + G.py);
    const dis = (G.ladders || 0) <= 0 && !onLadder;
    btnLadderEl.disabled = dis;
    btnLadderEl.classList.toggle("disabled", dis);
  }
  // v0.14.0 アンテナ: 所持数表示 + 設置/回収トグルの disabled 制御(はしごと同じ流儀)。
  if (antennaValEl) antennaValEl.textContent = G.antennaItems || 0;
  if (btnAntennaEl) {
    const onAntenna = G.placedAntennas && G.placedAntennas.has(G.px + "," + G.py);
    const dis = (G.antennaItems || 0) <= 0 && !onAntenna;
    btnAntennaEl.disabled = dis;
    btnAntennaEl.classList.toggle("disabled", dis);
  }
  // v0.8.0 商人通貨: キノコ所持数を HUD バーに表示(夢キノコ/フルーツは工房=商人タブで扱う)。
  if (mushValEl) mushValEl.textContent = G.mushrooms || 0;
  // v0.9.0 育成: 救出した女の子の「情報」ストックを HUD バーに表示(BP/PER 操作は工房=育成タブ)。
  if (infoValEl) infoValEl.textContent = G.info || 0;
}

// ---- v0.4.0 クラフト + v0.8.0 商人(工房オーバーレイ。タブで同居) -------
// craft.csv 6 レシピ + shop.csv 物々交換を 1 パネルに同居。材料/対価充足なら実行可、不足は disabled。
// dive 中に開ける。開いた直後は常にクラフトタブ(gate Q の #btn-craft→craft-list 検証を保つ)。
let craftOpen = false;
let workshopTab = "craft"; // "craft" | "shop" | "grow" | "companion"。開くたびクラフトへ戻す(既定)。
function openCraft() {
  if (G.screen !== "dive") return;
  craftOpen = true;
  setWorkshopTab("craft"); // 既定はクラフトタブ(gate Q 互換)。
  renderCraft();
  if (craftOverlayEl) {
    craftOverlayEl.hidden = false;
    requestAnimationFrame(() => craftOverlayEl.classList.add("visible"));
  }
}
function closeCraft() {
  craftOpen = false;
  if (craftOverlayEl) {
    craftOverlayEl.classList.remove("visible");
    craftOverlayEl.hidden = true;
  }
}
// 工房タブ切り替え(クラフト/商人/育成/仲間/アイテム)。リスト表示とタブ active 状態を同期し、選んだ側を再描画。
// v0.9.0: 育成タブを第3タブとして追加。v0.14.0: アイテムタブを第5タブとして追加(いずれも上部バーの
// ボタンは増やさない=工房内タブ同居=gate G 非退行)。
function setWorkshopTab(tab) {
  workshopTab = ["shop", "grow", "companion", "items"].includes(tab) ? tab : "craft";
  if (craftListEl) craftListEl.hidden = workshopTab !== "craft";
  if (shopListEl) shopListEl.hidden = workshopTab !== "shop";
  if (growListEl) growListEl.hidden = workshopTab !== "grow";
  if (companionListEl) companionListEl.hidden = workshopTab !== "companion";
  if (itemListEl) itemListEl.hidden = workshopTab !== "items";
  if (tabCraftEl) tabCraftEl.classList.toggle("active", workshopTab === "craft");
  if (tabShopEl) tabShopEl.classList.toggle("active", workshopTab === "shop");
  if (tabGrowEl) tabGrowEl.classList.toggle("active", workshopTab === "grow");
  if (tabCompanionEl) tabCompanionEl.classList.toggle("active", workshopTab === "companion");
  if (tabItemsEl) tabItemsEl.classList.toggle("active", workshopTab === "items");
  if (workshopTab === "shop") renderShop();
  else if (workshopTab === "grow") renderGrow();
  else if (workshopTab === "companion") renderCompanion();
  else if (workshopTab === "items") renderItems();
  else renderCraft();
}
// 材料コストを「鉄2 骨1」等の verbatim 文字列に(v0.14.0: CRAFT_RECIPES/SHOP_RECIPES で cost 形を
// 統一したため、旧 costText/tradeCostText の重複実装を 1 本化。ore=アイコン1字、item=日本語名、
// mushroom=茸、dreamMushroom=夢)。
function costText(cost) {
  const c = cost || {};
  const parts = [];
  if (c.ore) {
    for (const k of Object.keys(c.ore)) {
      let ico = "?";
      for (const o of Object.keys(ORE_META)) {
        if (ORE_META[o].key === k) { ico = ORE_META[o].ico; break; }
      }
      parts.push(ico + c.ore[k]);
    }
  }
  if (c.item) for (const k of Object.keys(c.item)) parts.push(k + c.item[k]);
  if (c.mushroom) parts.push("茸" + c.mushroom);
  if (c.dreamMushroom) parts.push("夢" + c.dreamMushroom);
  return parts.join(" ");
}
// 既に最強段のツルハシを持っている pick レシピは「所持済み」で実質無効化(混乱防止。クラフト/商人共通)。
function recipeRedundant(rec) {
  return rec.result.type === "pick" && pickRank(rec.result.id) <= pickRank(G.pick);
}
function renderCraft() {
  if (!craftListEl || !G.ore) return;
  craftListEl.innerHTML = "";
  for (const rec of CRAFT_RECIPES) {
    const row = document.createElement("div");
    row.className = "craft-row";
    const info = document.createElement("div");
    info.className = "craft-info";
    const nm = document.createElement("span");
    nm.className = "craft-name";
    nm.textContent = rec.name;
    const cost = document.createElement("span");
    cost.className = "craft-cost";
    cost.textContent = costText(rec.cost);
    info.appendChild(nm);
    info.appendChild(cost);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craft-make";
    const redundant = recipeRedundant(rec);
    const ok = canCraft(rec) && !redundant;
    btn.textContent = redundant ? "所持済み" : "つくる";
    btn.disabled = !ok;
    btn.classList.toggle("disabled", !ok);
    btn.onclick = () => { doCraft(rec); };
    row.appendChild(info);
    row.appendChild(btn);
    craftListEl.appendChild(row);
  }
}

// ---- v0.8.0 商人オーバーレイ(物々交換) --------------------------------
// shop.csv 忠実サブセット(SHOP_RECIPES)を表示。対価充足なら「交換」可、不足は disabled。dive 中に
// 開ける。アクセス導線はクラフトと同じ「作る」ボタン→工房オーバーレイ→商人タブ(上部バーにボタンを
// 増やさず既存の地表タップ/カメラ前提を壊さない)。
function renderShop() {
  if (!shopListEl) return;
  shopListEl.innerHTML = "";
  for (const rec of SHOP_RECIPES) {
    const row = document.createElement("div");
    row.className = "craft-row"; // クラフトと同じ行スタイルを共用(CSS 追加を増やさない)。
    const info = document.createElement("div");
    info.className = "craft-info";
    const nm = document.createElement("span");
    nm.className = "craft-name";
    nm.textContent = rec.desc ? rec.name + "（" + rec.desc + "）" : rec.name;
    const cost = document.createElement("span");
    cost.className = "craft-cost";
    cost.textContent = costText(rec.cost);
    info.appendChild(nm);
    info.appendChild(cost);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craft-make";
    const redundant = recipeRedundant(rec);
    const ok = canTradeRec(rec) && !redundant;
    btn.textContent = redundant ? "所持済み" : "交換";
    btn.disabled = !ok;
    btn.classList.toggle("disabled", !ok);
    btn.onclick = () => { doShopTrade(rec); };
    row.appendChild(info);
    row.appendChild(btn);
    shopListEl.appendChild(row);
  }
  // 交換/ドロップで得た消耗品を食べる行。所持している間だけ表示(HUD バーにボタンを増やさずここから
  // 使う=上部バーの x 位置を動かさない設計)。v0.14.0: 回復薬(廃止)の代わりに焼き肉/動物の血を追加。
  appendEatRow("フルーツ", G.fruits || 0, "体力+" + CONST.FRUIT_HEAL, useFruit);
  appendEatRow("夢キノコ", G.dreamMushrooms || 0, "体力+" + CONST.DREAM_HEAL, useDreamMushroom);
  appendEatRow("焼き肉", G.roastMeat || 0, "体力+" + CONST.ROAST_HEAL, useRoastMeat);
  appendEatRow("動物の血", (G.drops && G.drops["動物の血"]) || 0, "体力+" + CONST.BLOOD_HEAL, useBlood);
}
// 所持消耗品 name を「食べる」行として shopList に足す(数が 0 なら何も追加しない)。
function appendEatRow(name, count, desc, useFn) {
  if (count <= 0 || !shopListEl) return;
  const row = document.createElement("div");
  row.className = "craft-row";
  const info = document.createElement("div");
  info.className = "craft-info";
  const nm = document.createElement("span");
  nm.className = "craft-name";
  nm.textContent = name + "（" + desc + "）";
  const c = document.createElement("span");
  c.className = "craft-cost";
  c.textContent = "所持 " + count;
  info.appendChild(nm);
  info.appendChild(c);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "craft-make";
  btn.textContent = "食べる";
  const ok = G.hp < effHpMax(); // v0.9.0: 実効最大値で満タン判定。
  btn.disabled = !ok;
  btn.classList.toggle("disabled", !ok);
  btn.onclick = () => { useFn(); renderShop(); };
  row.appendChild(info);
  row.appendChild(btn);
  shopListEl.appendChild(row);
}

// ---- v0.9.0 育成タブ(Lv.UP 画面) -------------------------------------
// 原作 BAG「Lv.UP」画面に相当。工房オーバーレイ第3タブ。①情報/EXP→BP 変換行、②各 PER の
// 現レベル/コスト/Lv.UP ボタン。クラフト/商人と同じ .craft-row スタイルを共用(CSS を増やさない)。
// 1 行ぶんの DOM(名前+サブ説明 / ボタン)を生成して growList に足す共通ヘルパー。
function appendGrowRow(name, sub, btnLabel, enabled, onClick) {
  if (!growListEl) return;
  const row = document.createElement("div");
  row.className = "craft-row";
  const info = document.createElement("div");
  info.className = "craft-info";
  const nm = document.createElement("span");
  nm.className = "craft-name";
  nm.textContent = name;
  const c = document.createElement("span");
  c.className = "craft-cost";
  c.textContent = sub;
  info.appendChild(nm);
  info.appendChild(c);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "craft-make";
  btn.textContent = btnLabel;
  btn.disabled = !enabled;
  btn.classList.toggle("disabled", !enabled);
  btn.onclick = () => { onClick(); };
  row.appendChild(info);
  row.appendChild(btn);
  growListEl.appendChild(row);
}
function renderGrow() {
  if (!growListEl) return;
  growListEl.innerHTML = "";
  // 変換行: 情報→BP / EXP→BP。所持の数とレートを明示。BP 残高もここで見せる。
  appendGrowRow(
    "情報 → BP（所持 " + (G.info || 0) + "・BP " + (G.bp || 0) + "）",
    "情報1 → ボーナスポイント" + GROW_RATE.INFO_TO_BP,
    "変換",
    (G.info || 0) > 0,
    () => { convertInfoToBp(); },
  );
  appendGrowRow(
    "経験値 → BP（経験値 " + (G.exp || 0) + "）",
    "経験値" + GROW_RATE.EXP_TO_BP + " → ボーナスポイント1",
    "変換",
    (G.exp || 0) >= GROW_RATE.EXP_TO_BP,
    () => { convertExpToBp(); },
  );
  // 各 PER のレベルアップ行。現レベル/上限/次レベルの BP コストを出す。
  for (const def of PER_DEFS) {
    const lvl = (G.per && G.per[def.key]) || 0;
    const maxed = lvl >= def.max;
    const cost = bpCostFor(def.key, lvl);
    const sub = maxed
      ? "Lv." + lvl + " / " + def.max + "（最大・" + def.effect + "）"
      : "Lv." + lvl + " / " + def.max + "（" + def.effect + "・次 BP" + cost + "）";
    appendGrowRow(
      def.label,
      sub,
      maxed ? "最大" : "Lv.UP",
      !maxed && (G.bp || 0) >= cost,
      () => { levelUpPer(def.key); },
    );
  }
}

// ---- v0.11.0 仲間同行(作り直し: 救出済みストック→地表で1人を同行選択→次の潜行に追従) -------
// 【作り直し】v0.10.0 は「地中で護衛中(following)の子を同行指定」だったが、ユーザー確定方針で
// 「救出して地表に持ち帰った子(rescued=ストック)を地表で1人選んで次の潜行に連れていく→一緒に戦い
// EXP 蓄積→地表帰還で別れてレベルアップ→再びストックへ戻る」(原作 §5)へ作り直す。
// 同行候補 = 救出済み(rescued)の子。選ぶと deployed=true + state="following" で自機(地表)位置へ
// 配置し、足跡を追って一緒に潜る。同行中の子を再選択すると同行を取り消し(ストックへ戻す、清算なし)。
function setCompanion(g) {
  if (G.screen !== "dive" || !g) return false;
  // 既に同行に出している子(deployed companion)を再選択 = 同行取り消し(ストックへ戻す、清算しない)。
  if (G.companion === g && g.deployed) {
    g.deployed = false;
    g.state = "rescued";
    G.companion = null;
    showHint("同行をやめた。仲間は地上に戻った", false);
    playSfx("heal");
    renderCompanion();
    return true;
  }
  // 同行候補は救出済みストックの子のみ(原作「別れると再び情報としてストック→また連れられる」)。
  if (g.state !== "rescued") { showHint("地上に連れ帰った仲間だけ同行できる", true); return false; }
  // 地表に居るときだけ新しい潜行へ同行を編成できる(地中で編成すると追従の起点が定まらない)。
  if (G.py !== 0) { showHint("地表で仲間を選んでから潜ろう", true); return false; }
  // 既に別の子を同行に出していたらストックへ戻す(1人だけ=原作忠実)。
  if (G.companion && G.companion !== g && G.companion.deployed) {
    G.companion.deployed = false;
    G.companion.state = "rescued";
  }
  G.companion = g;
  g.deployed = true;
  g.state = "following"; // 救出済みの子を同行のため追従状態へ(deployed フラグで初回救出と区別)。
  g.col = G.px;
  g.row = G.py; // 自機(地表)位置から足跡を追って潜る。
  g.trailIdx = (G.playerTrail || []).length; // 以降に自機が刻む足跡を消化する起点。
  // v0.11.0 (C): g.cexp/g.level はここでリセットしない(意図的=端数繰り越し)。前回の地表帰還清算
  // (settleCompanion)で cexp→level に繰り上げた残りの端数 cexp はこの子に残り、再同行で続きから貯まる
  // (原作「レベルアップは積み上がる」=同じ子を育て続けられる)。level も累積で援護が強くなる。
  showHint("仲間と一緒に潜る。地上で別れるとレベルが上がる", false);
  playSfx("heal");
  renderCompanion();
  return true;
}
function appendCompanionRow(name, sub, btnLabel, enabled, onClick) {
  if (!companionListEl) return;
  const row = document.createElement("div");
  row.className = "craft-row";
  const info = document.createElement("div");
  info.className = "craft-info";
  const nm = document.createElement("span");
  nm.className = "craft-name";
  nm.textContent = name;
  const c = document.createElement("span");
  c.className = "craft-cost";
  c.textContent = sub;
  info.appendChild(nm);
  info.appendChild(c);
  row.appendChild(info);
  if (btnLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craft-make";
    btn.textContent = btnLabel;
    btn.disabled = !enabled;
    btn.classList.toggle("disabled", !enabled);
    btn.onclick = () => { onClick(); };
    row.appendChild(btn);
  }
  companionListEl.appendChild(row);
}
function renderCompanion() {
  if (!companionListEl) return;
  companionListEl.innerHTML = "";
  // v0.11.0: 同行候補 = 救出済みストック(rescued)+ いま同行に出している子(deployed=following)。
  // 「女の子 N」の番号は G.girls の固定インデックスで安定させる(救出順で並べ替えない)。
  const candidates = [];
  (G.girls || []).forEach((g, i) => {
    if (g.state === "rescued" || (g.deployed && g.state === "following")) candidates.push({ g, n: i + 1 });
  });
  if (!candidates.length) {
    appendCompanionRow(
      "同行できる仲間がいない",
      "地中で女の子を救出して地上へ連れ帰るとストックに貯まる",
      "",
      false,
      () => {},
    );
    return;
  }
  const onSurface = G.py === 0;
  for (const { g, n } of candidates) {
    const isCompanion = G.companion === g && g.deployed;
    const lvl = g.level || 0;
    const cexp = g.cexp || 0;
    const atk = lvl * CONST.COMPANION_ATK_PER_LV;
    const sub = isCompanion
      ? "同行中・Lv." + lvl + "（経験値 " + cexp + "・援護 +" + atk + "）"
      : "ストック・Lv." + lvl + "（同行で +" + atk + " 援護・経験値 " + cexp + "）";
    // 同行中の子は「やめる」を常時押せる。ストックの子は地表でだけ「同行」を編成できる。
    const btnLabel = isCompanion ? "やめる" : "同行";
    const enabled = isCompanion || onSurface;
    appendCompanionRow(
      "女の子 " + n,
      sub,
      btnLabel,
      enabled,
      () => { setCompanion(g); },
    );
  }
}

// ---- v0.14.0 アイテムタブ(item.csv 全45種カタログの読み取り専用 BAG ビュー) ------------
// 工房第5タブ。判断B: dead-item(open=false)はボタン無しの非インタラクティブ表示に留め、45行の
// 操作 UI は作らない(取得/使用の実操作は既存のクラフト/商人/HUD/食べる行が担う。ここは所持の一覧性
// だけを担当)。所持数は既存 state(G.ore/G.drops/専用フィールド)から読むだけで新規 state は増やさない。
function itemOwnedText(item) {
  if (!item.open) return "—";
  switch (item.name) {
    case "石炭": return String((G.ore && G.ore.COAL) || 0);
    case "鉄鉱石": return String((G.ore && G.ore.IRON_ORE) || 0);
    case "化石": return String((G.ore && G.ore.FOSSIL) || 0);
    case "鋼": return String((G.ore && G.ore.STEEL) || 0);
    case "ルビー": return String((G.ore && G.ore.RUBY) || 0);
    case "ダイヤ": return String((G.ore && G.ore.DIAMOND) || 0);
    case "ツルハシ": { const p = PICK[G.pick]; return p ? p.name : "木のツルハシ"; }
    case "ハシゴ": return (G.ladders || 0) + "(設置 " + ((G.placedLadders && G.placedLadders.size) || 0) + ")";
    case "アンテナ": return (G.antennaItems || 0) + "(設置 " + ((G.placedAntennas && G.placedAntennas.size) || 0) + ")";
    case "キノコ": return String(G.mushrooms || 0);
    case "夢キノコ": return String(G.dreamMushrooms || 0);
    case "フルーツ": return String(G.fruits || 0);
    case "焼き肉": return String(G.roastMeat || 0);
    default: return String((G.drops && G.drops[item.name]) || 0);
  }
}
function renderItems() {
  if (!itemListEl) return;
  itemListEl.innerHTML = "";
  for (const item of ITEM_DATA) {
    const row = document.createElement("div");
    row.className = "craft-row" + (item.open ? "" : " item-dead");
    const info = document.createElement("div");
    info.className = "craft-info";
    const nm = document.createElement("span");
    nm.className = "craft-name";
    nm.textContent = item.name;
    const note = document.createElement("span");
    note.className = "craft-cost";
    note.textContent = item.note;
    info.appendChild(nm);
    info.appendChild(note);
    const val = document.createElement("span");
    val.className = "item-owned";
    val.textContent = itemOwnedText(item);
    row.appendChild(info);
    row.appendChild(val);
    itemListEl.appendChild(row);
  }
}

let hintTimer = null;
function showHint(text, warn) {
  hudHintEl.textContent = text;
  hudHintEl.classList.toggle("warn", !!warn);
  hudHintEl.hidden = false;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hudHintEl.hidden = true;
  }, 1700);
}

// ---- 数値ポップ --------------------------------------------------------
function spawnPopupAt(col, row, text, cls) {
  const sx = col * tile + tile / 2;
  const sy = (row - camY) * tile + tile / 2;
  const p = document.createElement("div");
  p.className = "popup" + (cls ? " " + cls : "");
  p.style.left = sx + "px";
  p.style.top = sy + "px";
  p.textContent = text;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 700);
}

// ---- 入力(タップ = 隣接マスを掘る/進む) ------------------------------
let pdX = 0;
let pdY = 0;
let pdMoved = 0;
let pdActive = false;

function screenToTile(x, y) {
  const col = Math.floor(x / tile);
  const row = Math.floor(y / tile + camY);
  return { col, row };
}

canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (G.screen !== "dive" || G.busy) return;
    pdActive = true;
    pdX = e.clientX;
    pdY = e.clientY;
    pdMoved = 0;
  },
  { passive: true }
);
canvas.addEventListener(
  "pointermove",
  (e) => {
    if (!pdActive) return;
    pdMoved = Math.max(pdMoved, Math.hypot(e.clientX - pdX, e.clientY - pdY));
  },
  { passive: true }
);
function pointerEnd(e) {
  if (!pdActive) return;
  pdActive = false;
  if (pdMoved >= CONST.TAP_MAX_MOVE) return;
  const { col, row } = screenToTile(e.clientX, e.clientY);
  // タップしたマスが自機の隣接 8 マス(Chebyshev 距離 1)なら、その方向を解決。
  // v0.15.0: 上下左右(Manhattan 1)→ 斜めを含む 8 方向へ(原作 bc.java の 8 方向入力に合わせる。
  // 原作の画面 5 分割象限入力は遠隔タップの誤爆を招くため不採用=STATUS v0.15.0 判断 A)。
  // 自マス(0,0)は除外。方向ボタン UI は 4 方向のまま(斜めはタップで)。
  const dc = col - G.px;
  const dr = row - G.py;
  if (dc === 0 && dr === 0) return;
  if (Math.abs(dc) > 1 || Math.abs(dr) > 1) return;
  act(dc, dr);
}
canvas.addEventListener("pointerup", pointerEnd, { passive: true });
canvas.addEventListener("pointercancel", () => {
  pdActive = false;
});

// ---- 十字キー(canvas 外 DOM、タップと併用) ---------------------------
btnUpEl.addEventListener("click", () => act(0, -1));
btnDownEl.addEventListener("click", () => act(0, 1));
btnLeftEl.addEventListener("click", () => act(-1, 0));
btnRightEl.addEventListener("click", () => act(1, 0));
// もぐる/地表へ = 一時的な撤退補助ではなく、ヒント(地表回復の周知)。実際の帰還は掘って戻る。
btnSurfaceEl.addEventListener("click", () => {
  if (G.screen !== "dive") return;
  showHint(TEXT.cueSurface.replace("。全回復した", "へ戻ると全回復"), false);
});
// 音のオン/オフ(BGM + SFX をまとめて)。
if (btnMuteEl) {
  btnMuteEl.addEventListener("click", () => {
    setAudioOn(!audioOn);
    btnMuteEl.textContent = audioOn ? "♪" : "♪̸";
    btnMuteEl.classList.toggle("muted", !audioOn);
  });
}
// v0.4.0: クラフトを開く / 閉じる。
if (btnCraftEl) btnCraftEl.addEventListener("click", () => openCraft());
if (craftCloseEl) craftCloseEl.addEventListener("click", () => closeCraft());
if (btnLadderEl) btnLadderEl.addEventListener("click", () => {
  const key = G.px + "," + G.py;
  if (G.placedLadders && G.placedLadders.has(key)) recoverLadder();
  else placeLadder();
});
// v0.14.0: アンテナ設置/回収トグル(はしごと同じ流儀)。
if (btnAntennaEl) btnAntennaEl.addEventListener("click", () => {
  const key = G.px + "," + G.py;
  if (G.placedAntennas && G.placedAntennas.has(key)) recoverAntenna();
  else placeAntenna();
});
// v0.8.0: 工房のタブ切り替え(クラフト / 商人)。商人は「作る」ボタン→工房→商人タブで開く
// (上部バーに 3 つ目のボタンを足さない=既存ボタン x 位置/地表タップ前提を壊さない)。
if (tabCraftEl) tabCraftEl.addEventListener("click", () => setWorkshopTab("craft"));
if (tabShopEl) tabShopEl.addEventListener("click", () => setWorkshopTab("shop"));
if (tabGrowEl) tabGrowEl.addEventListener("click", () => setWorkshopTab("grow")); // v0.9.0 育成タブ。
if (tabCompanionEl) tabCompanionEl.addEventListener("click", () => setWorkshopTab("companion")); // v0.10.0 仲間タブ。
if (tabItemsEl) tabItemsEl.addEventListener("click", () => setWorkshopTab("items")); // v0.14.0 アイテムタブ。

// ---- 描画(タイル粒度、per-pixel 禁止) --------------------------------
function caveColor(row) {
  const cs = hexToRgb(PALETTE.caveShallow);
  const cd = hexToRgb(PALETTE.caveDeep);
  const t = Math.max(0, Math.min(1, row / CONST.DEPTH_ROWS));
  return mixRgb(cs, cd, t);
}
function soilColor(row) {
  const ss = hexToRgb(PALETTE.soilShallow);
  const sd = hexToRgb(PALETTE.soilDeep);
  const t = Math.max(0, Math.min(1, row / CONST.DEPTH_ROWS));
  return mixRgb(ss, sd, t);
}

// 深度による暗化アルファ(深いほど暗い。明るい Kenney スプライトでも「深い=暗い」を保つ)。
function depthShade(row) {
  const t = Math.max(0, Math.min(1, row / CONST.DEPTH_ROWS));
  return t * 0.5; // 地表 0 → 最下層 0.5。
}
// タイルスプライトを 1 マスへ描く。読込済みなら true(=矩形 fallback 不要)。
function drawTileSprite(key, sx, sy) {
  if (!spriteReady(key)) return false;
  ctx.drawImage(SPRITES[key], sx, sy, tile + 1, tile + 1);
  return true;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (G.screen !== "dive") {
    ctx.fillStyle = "#10131f";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // HUD 帯の実高さを、インベントリ(clamp+vw でスケールし rem 推定とずれる)の実 bottom
  // から一度だけ確定する。+10px = 自機スプライト(高さ ~0.82*tile)の頭まで帯の下へ収める余白。
  if (!hudBandMeasured && !invEl.hidden) {
    const b = invEl.getBoundingClientRect().bottom;
    if (b > 0) {
      hudBandPx = b + 10;
      hudBandMeasured = true;
    }
  }

  // カメラ追従: 自機の画面上端を常に HUD 帯(深度/二段ゲージ/インベントリ)より下に保つ。
  // 追従距離を固定「4 行」にすると、tile が小さいモバイルでは 4 行 < 帯高 となり自機の頭が
  // 帯に食い込む(地表でも潜行中でも、自機は画面上端から followRows 行に居るため)。そこで
  // followRows を「帯の行数換算 + 余白」に引き上げ、自機上端 ((followRows-0.41)*tile) が
  // hudBandPx を超えるようにする(PC は tile が大きく従来の 4 行で足りる)。底(maxCam)は超えず、
  // 地表側は targetCam が負(上に空が覗く)。row<0 はタイルループ skip で空描画。
  const maxCam = Math.max(0, CONST.DEPTH_ROWS + 1 - Math.floor(H / tile));
  const followRows = Math.max(4, hudBandPx / tile + 0.5);
  const targetCam = Math.min(maxCam, G.py - followRows);
  camY += (targetCam - camY) * 0.2;
  if (typeof window !== "undefined") window.__camY = camY;

  const fog = hexToRgb(PALETTE.fog);
  const surf = hexToRgb(PALETTE.surface);
  const hardC = hexToRgb(PALETTE.hard);
  const rockC = hexToRgb(PALETTE.rock);

  // 空(地表より上)。明るいリスキンの「外」。地表行が画面下方にある時だけ覗く。
  const surfaceY = (0 - camY) * tile;
  if (surfaceY > 0) {
    const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
    sky.addColorStop(0, "#bfe0f2");
    sky.addColorStop(1, "#e8eecf");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, surfaceY);
  }

  const rows = Math.ceil(H / tile) + 2;
  const startRow = Math.floor(camY) - 1;

  for (let ri = 0; ri < rows; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const sy = (row - camY) * tile;
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      const sx = col * tile;

      if (row === 0) {
        // 地表(明るい安全行) = 緑トップのタイル。
        if (!drawTileSprite("surface", sx, sy)) {
          ctx.fillStyle = `rgb(${surf[0]},${surf[1]},${surf[2]})`;
          ctx.fillRect(sx, sy, tile + 1, tile + 1);
        }
        continue;
      }
      if (row > CONST.DEPTH_ROWS) {
        // 探索可能な世界(深度 1..DEPTH_ROWS)より下 = 到達不能な岩盤の闇。
        // 世界は縦に短く縦長画面へ全て収まる(camera は上端固定)。ここに明るい石スプライト
        // を敷くと画面下半分が無意味な灰スラブになり fog 美学と衝突するため、暗い基盤色で
        // 「世界の下へ続く闇」として描く(リスキンの設計判断、ロジック不変)。
        ctx.fillStyle = PALETTE.fog;
        ctx.fillRect(sx, sy, tile + 1, tile + 1);
        continue;
      }
      if (!isVisible(col, row)) {
        // 未可視 = fog(暗い)。原作「掘ると視界が開ける」を維持。
        ctx.fillStyle = `rgb(${fog[0]},${fog[1]},${fog[2]})`;
        ctx.fillRect(sx, sy, tile + 1, tile + 1);
        continue;
      }

      const t = tileAt(col, row);
      if (t === TILE.NONE) {
        // 掘った道/空間 = 暗い空洞(スプライトなし。帰り道として相対的に明るい藍)。
        const cc = caveColor(row);
        ctx.fillStyle = `rgb(${cc[0]},${cc[1]},${cc[2]})`;
        ctx.fillRect(sx, sy, tile + 1, tile + 1);
        // v0.16.0 流体(判断 F): hazardAt 直読み→G.fluid(ランタイム流体 state)読みへ差し替え。
        // 密度 d(1..8)で alpha を変調(浅い水は薄く・満水は濃く)。PALETTE.water/magma は不変。
        const fl = G.fluid ? G.fluid.get(col + "," + row) : null;
        if (fl) {
          const hc = hexToRgb(fl.k === HAZARD.MAGMA ? PALETTE.magma : PALETTE.water);
          const fa = fl.k === HAZARD.MAGMA ? 0.3 + (fl.d / 8) * 0.3 : 0.2 + (fl.d / 8) * 0.35;
          ctx.fillStyle = `rgba(${hc[0]},${hc[1]},${hc[2]},${fa})`;
          ctx.fillRect(sx, sy, tile + 1, tile + 1);
        }
        // v0.13.1 設置済みはしご(木の色で縦2本+横段3本の簡素はしご)。
        if (G.placedLadders && G.placedLadders.has(col + "," + row)) {
          ctx.strokeStyle = "rgba(180,160,120,0.7)";
          ctx.lineWidth = Math.max(2, tile * 0.08);
          const lx1 = sx + tile * 0.3;
          const lx2 = sx + tile * 0.7;
          ctx.beginPath();
          ctx.moveTo(lx1, sy + tile * 0.1); ctx.lineTo(lx1, sy + tile * 0.9);
          ctx.moveTo(lx2, sy + tile * 0.1); ctx.lineTo(lx2, sy + tile * 0.9);
          for (let ri2 = 0; ri2 < 3; ri2++) {
            const ry = sy + tile * (0.25 + ri2 * 0.25);
            ctx.moveTo(lx1, ry); ctx.lineTo(lx2, ry);
          }
          ctx.stroke();
        }
        // v0.14.0 設置済みアンテナ(電波色の縦棒+先端の輪、電波網の起点であることを視覚的に示す)。
        if (G.placedAntennas && G.placedAntennas.has(col + "," + row)) {
          const ax = sx + tile * 0.5;
          const topY = sy + tile * 0.12;
          ctx.strokeStyle = "rgba(120,220,200,0.85)";
          ctx.lineWidth = Math.max(2, tile * 0.07);
          ctx.beginPath();
          ctx.moveTo(ax, sy + tile * 0.85);
          ctx.lineTo(ax, topY);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ax, topY, tile * 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // 固体タイル = スプライト(SOIL/HARD/ROCK、女の子マスは soil で描き上に重ねる)。
        const key = t === TILE.HARD ? "hard" : t === TILE.ROCK ? "rock" : "soil";
        if (!drawTileSprite(key, sx, sy)) {
          const fc = t === TILE.HARD ? hardC : t === TILE.ROCK ? rockC : soilColor(row);
          ctx.fillStyle = `rgb(${fc[0]},${fc[1]},${fc[2]})`;
          ctx.fillRect(sx, sy, tile + 1, tile + 1);
        }
        // 深度暗化(明るいスプライトに「深い=暗い」を重ねる)。
        ctx.fillStyle = `rgba(0,0,0,${depthShade(row)})`;
        ctx.fillRect(sx, sy, tile + 1, tile + 1);
        // v0.7.0 なだれ/落盤: 不安定土(なだれ土) or 崩落で塞がったマスは赤錆オーバーレイで「崩れそう」を
        // 示す(新規アセット無し=URL 不変)。SOIL のときだけ(硬土/硬岩は崩れない)。
        const unstable =
          t === TILE.SOIL &&
          ((G.fallen && G.fallen.has(col + "," + row)) || avalancheAt(col, row, G.seed));
        if (unstable) {
          const av = hexToRgb(PALETTE.avalanche);
          ctx.fillStyle = `rgba(${av[0]},${av[1]},${av[2]},0.4)`;
          ctx.fillRect(sx, sy, tile + 1, tile + 1);
        }
      }

      // タイル境界の薄い格子(断面の読みやすさ。fog には引かない)。
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tile, tile);
    }
  }

  // 女の子(暖色自発光。未発見でも可視マスなら気配として淡く光る)。全員ぶん描く。
  // v0.14.0 判断C: 全域透視(所持フラグ)を廃し、電波圏内(地表基礎範囲 or 連結アンテナ半径内)の
  // 女の子だけ透視表示へ引き直す(探索率/fog=seen には非介入、難度が原作方向へ戻る変更)。
  if (G.girls) {
    for (const g of G.girls) {
      if (g.state === "rescued") continue;
      if (isVisible(g.col, g.row) || g.state === "following" || inRadioCoverage(g.col, g.row)) drawGirl(g);
    }
  }

  // v0.5.0 モンスター(可視マスのみ)。冷色の脅威色 + 名称頭文字 + HP バー。
  // v0.17.0 判断 F: 埋没個体は描画しない(土の中は見えない=テレグラフなしも原作どおり)。
  if (G.monsters) {
    for (const m of G.monsters) {
      if (!m.buried && isVisible(m.col, m.row)) drawMonster(m);
    }
  }

  // 自機(暖色グロー + スプライト)。
  const cx = G.px * tile + tile / 2;
  const cy = (G.py - camY) * tile + tile / 2;
  drawMiner(cx, cy);

  // v0.16.0 残り息(判断 F): 水没中(G.breath>0)は自機頭上に残り息ターンを canvas 直描画(DOM 追加
  // なし)。残 0(息切れ=HP 直撃中)は警告色。小さい数字 + 黒縁で可読性を確保。
  if (G.breath > 0) {
    const remainBreath = Math.max(0, swimTurns() - G.breath);
    ctx.font = `bold ${Math.max(10, Math.round(tile * 0.36))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const bx = cx;
    const by = cy - tile * 0.62;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(String(remainBreath), bx, by);
    ctx.fillStyle = remainBreath > 0 ? "#dff3ff" : "#ff7b6a";
    ctx.fillText(String(remainBreath), bx, by);
  }
}

// セル中央にキャラスプライトを描く(縦長アスペクト維持・足元をマス中央付近に)。
// fog/明背景どちらでも輪郭が出るよう背後にソフトな縁取りグローを置く。
function drawCharSprite(key, cx, cy) {
  const img = SPRITES[key];
  if (!(img && img.complete && img.naturalWidth > 0)) return false;
  const w = tile * 0.82;
  const h = w * (img.naturalHeight / img.naturalWidth);
  // キャラはピクセルアート(Roguelike Characters)。タイルは smooth のまま、キャラ描画の
  // 間だけ smoothing を切ってドットをくっきり保つ(位置も整数化)。
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
  ctx.imageSmoothingEnabled = prevSmooth;
  return true;
}

function drawGirl(g) {
  const gx = g.col * tile + tile / 2;
  const gy = (g.row - camY) * tile + tile / 2;
  if (gy < -tile || gy > H + tile) return;
  const strong = g.state === "following";
  const col = hexToRgb(PALETTE.girl);
  const r = tile * 0.34;
  // 暖色グロー(救出対象を闇でも見つけられる前景視認性。なごり方式)。スプライト本体が
  // 白っぽくならないよう、本体の外側リング状に控えめに置く(中心は透明寄り)。
  const glow = ctx.createRadialGradient(gx, gy, r * 0.5, gx, gy, r * 1.9);
  const a0 = strong ? 0.6 : 0.32;
  glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  glow.addColorStop(0.45, `rgba(${col[0]},${col[1]},${col[2]},${a0})`);
  glow.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(gx, gy, r * 1.9, 0, Math.PI * 2);
  ctx.fill();
  // スプライト(読込前は暖色の円で fallback)。
  if (!drawCharSprite("girl", gx, gy)) {
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.beginPath();
    ctx.arc(gx, gy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,30,10,0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// v0.5.0 モンスター描画(専用スプライト無し=冷色の脅威マーカー + 名称頭文字 + HP バー)。
// 暖色の女の子/自機と画面上で明確に弁別できるよう寒色(青緑)に振る。
function drawMonster(m) {
  const mx = m.col * tile + tile / 2;
  const my = (m.row - camY) * tile + tile / 2;
  if (my < -tile || my > H + tile) return;
  const meta = MONSTER[m.key];
  const r = tile * 0.36;
  // 寒色の本体(角丸の塊)。
  ctx.fillStyle = "#3a6b78";
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180,230,235,0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 名称頭文字(漢字 1 字、可読性の核は DOM だが識別用に小さく焼く)。
  ctx.fillStyle = "#eaffff";
  ctx.font = `${Math.round(tile * 0.42)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(meta ? meta.ico : "敵", mx, my + tile * 0.02);
  // v0.18.0 判断 C(眠り描画は実装裁量として記録): 専用スプライトは無いので、眠り個体は本体の
  // 右上に淡色の「z」を重ねる最小表現(識別はできるが目立たせない=脅威が下がっている合図)。
  if (m.sleeping) {
    ctx.fillStyle = "rgba(200,220,255,0.9)";
    ctx.font = `${Math.round(tile * 0.3)}px serif`;
    ctx.fillText("z", mx + r * 0.9, my - r * 0.9);
  }
  // HP バー(上辺に細く)。残 HP 比で朱→寒色。
  if (meta && meta.hp > 0) {
    const ratio = Math.max(0, Math.min(1, m.hp / meta.hp));
    const bw = tile * 0.62;
    const bx = mx - bw / 2;
    const by = my - r - tile * 0.14;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, bw, tile * 0.08);
    ctx.fillStyle = ratio > 0.4 ? "#7fd4a0" : "#d8392a";
    ctx.fillRect(bx, by, bw * ratio, tile * 0.08);
  }
}

function drawMiner(cx, cy) {
  const r = tile * 0.34;
  // 自機は緑キャラスプライトで描く。以前は背後に暖色グローを敷いていたが、白い宇宙服
  // リングと相まって「白い光の輪」に見えたため除去。代わりに足元に薄い影を置いて接地感
  // と前景の浮きを出す(白飛びさせない)。
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.85, r * 0.7, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  // スプライト(読込前は暗いシルエット + 明縁で fallback)。
  if (!drawCharSprite("miner", cx, cy)) {
    ctx.fillStyle = "#241810";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,243,208,0.95)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = PALETTE.miner;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- メインループ(イベント駆動。tick は描画のみ) ---------------------
function tick(t) {
  if (!lastT) lastT = t;
  lastT = t;
  render();
  requestAnimationFrame(tick);
}

// ---- 起動 --------------------------------------------------------------
loadSprites(); // Kenney タイル/キャラ(読込前は矩形 fallback)。
loadAudio(); // 効果音(BGM はダイブ開始まで遅延)。
resize();
window.addEventListener("resize", () => resize());
showTitle();
requestAnimationFrame(tick);

// 開発フェーズ: Service Worker は使わない。既存登録・キャッシュを掃除。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (window.caches) {
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
