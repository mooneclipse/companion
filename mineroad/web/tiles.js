"use strict";
// Mine Road リメイク — タイル種 + 決定論地形生成 + PALETTE — verbatim 静的データ。
// 原作 jp.windbellrrr.app.minerroad の dungeon.csv ID0(裏庭)のブロック分布を忠実再現する
// 「数値設計のみ」の流用。原作のコード・画像・テキストは転用していない(メカニクス再現)。
//
// ランタイム乱数(Math.random / Date.now)は一切使わない。地形は tileType(col,row,seed) の
// 決定論ハッシュ関数で都度算出し、マップ配列は持たない(掘削差分だけ Set("col,row") で記録)。
// これにより力尽き → 同 BASE_SEED 再挑戦で同じ盤面が再現される("気を抜くとすぐ負ける")。
//
// タイル種(TILE):
//   NONE     空間(元から空 or 掘り抜いた跡)。通れる。重力が作用する穴。
//   SOIL     土。1 手で掘れる(DIG_SOIL)。
//   HARD     硬土。2 手で掘れる(DIG_HARD)。
//   ROCK     硬岩。掘れない(v1.1+ でツルハシ)。
//   GIRL     女の子(救出対象)。掘って到達 = 発見、追従。暖色自発光。
//   SURFACE  地表(最上部 1 行)。安全・スタミナ/体力 全回復・帰還地点。

const TILE = {
  NONE: 0,
  SOIL: 1,
  HARD: 2,
  ROCK: 3,
  GIRL: 4,
  SURFACE: 5,
};

// タイル種ごとの掘削手数キー(CONST.DIG_TAPS を単一真実源にするためのマップ)。
// 女の子は土と同じ手数で掘れる(掘ると発見が起きるだけ)。
const TILE_DIG_KEY = {
  [TILE.SOIL]: "SOIL",
  [TILE.HARD]: "HARD",
  [TILE.ROCK]: "ROCK", // v0.4.0: 鉄ツルハシ以上で掘れる(手数 DIG_TAPS.ROCK)。
  [TILE.GIRL]: "SOIL",
};

// ---- 整数ハッシュ(決定論・乱数非使用) --------------------------------
// 32bit 整数ハッシュ。col,row,seed から再現可能な疑似乱数 [0,1) を得る。
// マップ配列を持たず、同じ (col,row,seed) は常に同じ結果を返す。
function hash3(a, b, c) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}

// ---- 裏庭(dungeon ID0)のブロック分布 ---------------------------------
// dungeon.csv ID0 を忠実再現(合計100、floor帯別)。乱数禁止 = この累積確率を
// 決定論ハッシュ値と比較して分布を再現する(同じ col/row/seed は常に同じタイル)。
//   floor 1〜10 : 土 83 / 空間 5 / 硬土 10 / 硬岩 2
//   floor 11〜15: 土 81 / 空間 5 / 硬土 10 / 硬岩 2 / 水 2
//     → v0.1 は SWIM 未実装のため水 2 を土に丸める(floor11-15 も土 83 扱い)。
// 累積しきい値(0..1)。r < cum.none → 空間、< cum.hard → 硬土、< cum.rock → 硬岩、以降 土。
function blockThresholds(row) {
  // v0.1: floor 帯によらず統一(水を土に丸めた結果、両帯とも 土83/空間5/硬土10/硬岩2)。
  void row;
  const none = 0.05; // 空間 5%
  const hard = none + 0.1; // 硬土 10%
  const rock = hard + 0.02; // 硬岩 2%(残り 83% が土)
  return { none, hard, rock };
}

// ---- 女の子の決定論配置 ------------------------------------------------
// 裏庭(dungeon_info ID0)の girl num = 5 を忠実再現(一次データで確認)。深度を散らして
// 埋める(深いほど深部寄り、最深の 1 人は最下層付近 = 深追いと最下層到達の動線)。
// row は均等割りで全員 distinct なのでセル衝突なし(col が重複しても row 違いで別マス)。
// 救出体験を濃くするため敵スポーン抽選には混ぜず専用ロジック(仕様 §12 所見の通り)。
// 返り値: [{col, row}, ...](長さ = CONST.GIRL_COUNT)
function girlPositions(seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  const cols = C.GRID_COLS;
  const floors = C.DEPTH_ROWS;
  const count = (C.GIRL_COUNT | 0) || 5;
  const out = [];
  for (let i = 0; i < count; i++) {
    // 深度 40%〜95% に均等割り(count=5/floors=15 で row=6,8,10,12,14)。
    const frac = count > 1 ? 0.4 + (0.55 * i) / (count - 1) : 0.6;
    const row = Math.max(2, Math.min(floors - 1, Math.round(floors * frac)));
    const col = Math.floor(hash3(seed, 7001, 100 + i) * cols);
    out.push({ col, row });
  }
  return out;
}

// ある (col,row) が このダイブの女の子配置に一致するか。
function isGirlAt(col, row, seed) {
  if (row <= 0) return false;
  for (const g of girlPositions(seed)) {
    if (g.col === col && g.row === row) return true;
  }
  return false;
}

// ---- 決定論地形 --------------------------------------------------------
// tileType(col, row, seed) → TILE 値。
// row 0 = 地表(SURFACE、安全な帰還地点)。row < 0 / 範囲外は ROCK(掘れない壁)。
// それ以外は女の子・空間/硬土/硬岩/土を決定論で配置する。
function tileType(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return TILE.SURFACE; // 地表は安全な帰還地点。
  if (col < 0 || col >= C.GRID_COLS) return TILE.ROCK; // 横の壁。
  if (row > C.DEPTH_ROWS) return TILE.ROCK; // 最下層の底(掘れない岩盤)。

  // 女の子(専用配置)。最優先で返す(救出対象が硬岩等に潰されないよう)。
  if (isGirlAt(col, row, seed)) return TILE.GIRL;

  const r = hash3(col, row, seed); // このマスの基準乱数 [0,1)。
  const th = blockThresholds(row);
  if (r < th.none) return TILE.NONE;
  if (r < th.hard) return TILE.HARD;
  if (r < th.rock) return TILE.ROCK;
  return TILE.SOIL;
}

// ---- 鉱石(ore) — 原作 item.csv 忠実 + 決定論ドロップ(v0.4.0) -------------
// tileType には混ぜない(既存 girlPositions・determinism snapshot・タイル分布を一切
// 変えないため)。SOIL/HARD を掘り抜いた瞬間に oreAt(col,row,seed) を引き、含有なら
// インベントリへ加算する別レイヤー。鉱石種は深度帯で分布(深いほど高価)、含有率は控えめ。
//
// 原作 item.csv の鉱石(ore, 売値): 銅鉱石8 / 鉄鉱石15 / 金鉱石60 / ダイヤ原石300。
const ORE = {
  NONE: 0,
  COPPER: 1, // 銅鉱石(売値8)。浅層。
  IRON: 2, // 鉄鉱石(売値15)。中層。
  GOLD: 3, // 金鉱石(売値60)。深層。
  DIAMOND: 4, // ダイヤ原石(売値300)。最深層。
};
// 鉱石メタ(verbatim 売値 + 表示名 + HUD アイコン1字)。
const ORE_META = {
  [ORE.COPPER]: { key: "COPPER", name: "銅鉱石", price: 8, ico: "銅" },
  [ORE.IRON]: { key: "IRON", name: "鉄鉱石", price: 15, ico: "鉄" },
  [ORE.GOLD]: { key: "GOLD", name: "金鉱石", price: 60, ico: "金" },
  [ORE.DIAMOND]: { key: "DIAMOND", name: "ダイヤ原石", price: 300, ico: "ダ" },
};

// ある (col,row) を掘り抜いたとき産出する鉱石種(決定論・乱数禁止)。含有しないなら ORE.NONE。
// 深度帯で種を決め(浅=銅/中=鉄/深=金/最深=ダイヤ)、別シード位相のハッシュで含有率を絞る。
// GIRL マスは鉱石を出さない(救出対象)。同じ (col,row,seed) は常に同じ結果。
function oreAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return ORE.NONE;
  if (isGirlAt(col, row, seed)) return ORE.NONE; // 救出対象マスは鉱石なし。
  const floors = C.DEPTH_ROWS;
  // 深度帯(4 等分): 浅=銅 / 中=鉄 / 深=金 / 最深=ダイヤ。
  const frac = row / floors;
  let kind;
  if (frac <= 0.27) kind = ORE.COPPER;
  else if (frac <= 0.54) kind = ORE.IRON;
  else if (frac <= 0.8) kind = ORE.GOLD;
  else kind = ORE.DIAMOND;
  // 含有率(控えめ): 浅いほど出やすく、高価な深層ほど絞る。tileType と別位相のハッシュ。
  const RATE = { [ORE.COPPER]: 0.22, [ORE.IRON]: 0.16, [ORE.GOLD]: 0.1, [ORE.DIAMOND]: 0.06 };
  const h = hash3(col + 911, row + 733, seed + 5557); // tileType の hash3(col,row,seed) と非衝突。
  return h < RATE[kind] ? kind : ORE.NONE;
}

// ---- ツルハシ(pickaxe) — 原作 item.csv 忠実(v0.4.0) ----------------------
// power でタイル必要 power 以上なら掘れる。木(初期,岩掘れない)/石(rock=HARD)/鉄(hard=ROCK)/
// ダイヤ(何でも)。最強の所持ツルハシが常時有効。タイル必要 power: SOIL=1 / HARD=2 / ROCK=3。
const PICK = {
  WOOD: { key: "WOOD", name: "木のツルハシ", power: 1, ico: "木" },
  STONE: { key: "STONE", name: "石のツルハシ", power: 2, ico: "石" },
  IRON: { key: "IRON", name: "鉄のツルハシ", power: 3, ico: "鉄" },
  DIAMOND: { key: "DIAMOND", name: "ダイヤのツルハシ", power: 5, ico: "ダ" },
};
// タイル種ごとの必要 power(掘削ゲート、A の核)。GIRL は SOIL 相当=1(救出対象)。
const TILE_REQ_POWER = {
  [TILE.SOIL]: 1,
  [TILE.HARD]: 2,
  [TILE.ROCK]: 3,
  [TILE.GIRL]: 1,
};

// ---- クラフトレシピ — 原作 craft.csv 忠実(v0.4.0) -----------------------
// 材料(ore/品目→個数)→ 完成品。完成品は pick(ツルハシ段)/tool(はしご/アンテナ)/
// consumable(回復薬)。材料が足りていれば実行可、足りなければ disabled 表示。
//   石のツルハシ ← 銅鉱石3
//   鉄のツルハシ ← 鉄鉱石2 + 銅鉱石2
//   はしご       ← 銅鉱石1
//   回復薬       ← 鉄鉱石1
//   ダイヤのツルハシ ← ダイヤ原石1 + 鉄鉱石3
//   アンテナ     ← 金鉱石1
// cost のキーは ORE_META.key("COPPER"/"IRON"/"GOLD"/"DIAMOND")。
// result: { type:"pick"|"tool"|"consumable", id, name }
const CRAFT_RECIPES = [
  { id: "pick_stone", name: "石のツルハシ", result: { type: "pick", id: "STONE" }, cost: { COPPER: 3 } },
  { id: "pick_iron", name: "鉄のツルハシ", result: { type: "pick", id: "IRON" }, cost: { IRON: 2, COPPER: 2 } },
  { id: "ladder", name: "はしご", result: { type: "tool", id: "LADDER" }, cost: { COPPER: 1 } },
  { id: "potion", name: "回復薬", result: { type: "consumable", id: "POTION" }, cost: { IRON: 1 } },
  { id: "pick_diamond", name: "ダイヤのツルハシ", result: { type: "pick", id: "DIAMOND" }, cost: { DIAMOND: 1, IRON: 3 } },
  { id: "antenna", name: "アンテナ", result: { type: "tool", id: "ANTENNA" }, cost: { GOLD: 1 } },
];

// ---- モンスター — 原作 monster.csv 忠実(v0.5.0) -------------------------
// 死の緊張(撤退判断の重み)を設計から出す本命増分。浅層向けの忠実サブセット 6 種を採用
// (BAT/SLIME/SLIME HALF/SNAKE/WORM/SPIDER)。各ステータスは monster.csv verbatim
//   HP / SP / STR(攻撃) / DEF(防御) / SPD(行動頻度) / EXP / GIRLATK(女の子を狙うか=1) /
//   bury(埋没掘りper=掘り抜き時に出現する%) / space(空間スポーン可=1)。
// ドロップ表(ITEM, PER%)も verbatim。全 20 種ロスター・ボス級(SOIL DRAGON/BEAR 等)は次以降。
//
// 決定論厳守: スポーン配置・戦闘解決・行動すべて seed 由来ハッシュ(hash3)で決める。
// ランタイム乱数(Math.random/Date.now)は使わない。oreAt と同じく tileType/girlPositions・
// determinism snapshot・タイル分布には一切介入しない別レイヤー(非介入方針 v0.4.0 踏襲)。
const MON = {
  BAT: "BAT",
  SLIME: "SLIME",
  SLIME_HALF: "SLIME_HALF",
  SNAKE: "SNAKE",
  WORM: "WORM",
  SPIDER: "SPIDER",
};
// verbatim ステータス + ドロップ(monster.csv 一次データ)。drops は確率の高い順に並べ、
// 各 per は独立判定でなく「累積しきい値で 1 種だけ落とす」抽選(決定論ハッシュ)に使う。
const MONSTER = {
  [MON.BAT]: {
    key: MON.BAT, name: "コウモリ", ico: "蝙", hp: 5, sp: 20, str: 1, def: 0, spd: 2,
    exp: 2, girlatk: 1, bury: 0, space: 1,
    drops: [{ item: "動物の血", per: 50 }, { item: "動物の皮", per: 30 }, { item: "骨", per: 20 }],
  },
  [MON.SLIME]: {
    key: MON.SLIME, name: "スライム", ico: "粘", hp: 15, sp: 5, str: 3, def: 0, spd: 1,
    exp: 4, girlatk: 1, bury: 30, space: 1,
    drops: [{ item: "生肉", per: 70 }, { item: "海綿", per: 27 }, { item: "ルビー", per: 3 }],
  },
  [MON.SLIME_HALF]: {
    key: MON.SLIME_HALF, name: "小スライム", ico: "粘", hp: 8, sp: 5, str: 2, def: 0, spd: 1,
    exp: 2, girlatk: 1, bury: 15, space: 1,
    drops: [{ item: "生肉", per: 65 }, { item: "海綿", per: 32 }, { item: "ルビー", per: 3 }],
  },
  [MON.SNAKE]: {
    key: MON.SNAKE, name: "ヘビ", ico: "蛇", hp: 10, sp: 8, str: 5, def: 1, spd: 1,
    exp: 6, girlatk: 1, bury: 80, space: 1,
    drops: [{ item: "動物の血", per: 30 }, { item: "動物の皮", per: 25 }, { item: "生肉", per: 25 }, { item: "解毒薬", per: 20 }],
  },
  [MON.WORM]: {
    key: MON.WORM, name: "ミミズ", ico: "蟲", hp: 5, sp: 0, str: 1, def: 0, spd: 3,
    exp: 1, girlatk: 1, bury: 100, space: 0, // space=0: 埋没掘りでのみ出る(土の中の住人)。
    drops: [{ item: "生肉", per: 70 }, { item: "動物の皮", per: 20 }, { item: "動物の血", per: 10 }],
  },
  [MON.SPIDER]: {
    key: MON.SPIDER, name: "クモ", ico: "蛛", hp: 6, sp: 5, str: 2, def: 1, spd: 1,
    exp: 3, girlatk: 1, bury: 100, space: 1,
    drops: [{ item: "クモの糸", per: 70 }, { item: "解毒薬", per: 30 }],
  },
};
// 空間スポーン候補(space=1)を深度帯で並べる(浅いほど弱い種を出す難度カーブ)。
// 浅=小スライム/コウモリ、中=スライム/クモ、深=ヘビ。WORM は space=0 なので含めない。
const SPACE_SPAWN_BANDS = [
  { maxFrac: 0.34, species: [MON.SLIME_HALF, MON.BAT] },
  { maxFrac: 0.67, species: [MON.SLIME, MON.SPIDER] },
  { maxFrac: 1.01, species: [MON.SNAKE, MON.BAT] },
];
// 埋没掘りスポーン候補(掘り抜き時に bury% で出る種)。土の住人。bury が高い種ほど出やすい。
// 浅いほど弱い種に寄せる(難度カーブ)。各帯から 1 種を hash で選び、その種の bury% で判定。
const BURY_SPAWN_BANDS = [
  { maxFrac: 0.34, species: [MON.WORM, MON.SLIME_HALF] }, // 浅: ミミズ(bury100)/小スライム(15)
  { maxFrac: 0.67, species: [MON.WORM, MON.SLIME] }, //     中: ミミズ/スライム(30)
  { maxFrac: 1.01, species: [MON.SPIDER, MON.SNAKE] }, //    深: クモ(100)/ヘビ(80)
];

// 空間スポーン率(NONE マスにモンスターが居る確率)。決定論ハッシュしきい値。控えめに
// (空間の一部だけ)出し、深いほど気配が増す。tileType/oreAt と別位相のハッシュを使う。
const SPACE_SPAWN_RATE = 0.55;
// 埋没掘り「住人居住率」(掘り抜くマスのうちモンスターが潜んでいる割合)。掘りの何割で出るか
// を決める単一ノブ(密度)。各種の bury%(埋没掘りper, verbatim) は「住人が居るマスを掘ったとき
// 飛び出す確率」として住人居住の上に重ねる(WORM=100 は居れば必ず出る土の主)。密度を 1.0 に
// すると毎掘り出現で過密になるため、掘削テンポを保てる水準に絞る(対症療法でなく密度の設計値)。
const BURY_PRESENCE_RATE = 0.16;

// ある (col,row) の NONE 空間にモンスターが居るか(決定論)。居れば種キー、居なければ null。
// tileType が NONE のマスだけが対象(呼び出し側で保証)。GIRL マスは別レイヤーで対象外。
// 同じ (col,row,seed) は常に同じ結果(力尽き → 同盤面で同じ配置が再現)。
function spaceMonsterAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return null;
  if (isGirlAt(col, row, seed)) return null; // 救出対象マスにモンスターを置かない。
  // 出現有無(別位相ハッシュ。tileType の hash3(col,row,seed)・oreAt の +911/+733/+5557 と非衝突)。
  const h = hash3(col + 313, row + 197, seed + 8821);
  if (h >= SPACE_SPAWN_RATE) return null;
  // 深度帯から種を選ぶ(帯内は別ハッシュで 1 種選択)。
  const frac = row / C.DEPTH_ROWS;
  let band = SPACE_SPAWN_BANDS[SPACE_SPAWN_BANDS.length - 1];
  for (const b of SPACE_SPAWN_BANDS) { if (frac <= b.maxFrac) { band = b; break; } }
  const pick = Math.floor(hash3(col + 401, row + 89, seed + 8821) * band.species.length);
  return band.species[Math.min(pick, band.species.length - 1)];
}

// SOIL/HARD を掘り抜いた瞬間、埋没掘りスポーンが起きるか(決定論)。起きれば種キー、なければ null。
// 深度帯から候補種を 1 つ選び、その種の bury%(埋没掘りper) を決定論ハッシュしきい値で判定。
// これが「気を抜くと死ぬ」核(掘る手が止まらない緊張)。GIRL マスは呼び出し側で除外。
function buryMonsterAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return null;
  if (isGirlAt(col, row, seed)) return null;
  // ① 住人居住の有無(密度ノブ)。居なければ掘っても何も出ない(掘削テンポを保つ)。
  const presence = hash3(col + 233, row + 617, seed + 3001); // 他レイヤーと別位相。
  if (presence >= BURY_PRESENCE_RATE) return null;
  // ② 居住種を深度帯から 1 つ選ぶ(別位相ハッシュ)。
  const frac = row / C.DEPTH_ROWS;
  let band = BURY_SPAWN_BANDS[BURY_SPAWN_BANDS.length - 1];
  for (const b of BURY_SPAWN_BANDS) { if (frac <= b.maxFrac) { band = b; break; } }
  const pick = Math.floor(hash3(col + 557, row + 271, seed + 6173) * band.species.length);
  const key = band.species[Math.min(pick, band.species.length - 1)];
  const m = MONSTER[key];
  if (!m) return null;
  // ③ その種の bury%(埋没掘りper, verbatim)で飛び出すか判定。h < bury/100 なら出現。
  const h = hash3(col + 1019, row + 643, seed + 6173); // spaceMonster とも非衝突。
  return h < m.bury / 100 ? key : null;
}

// ---- 水/マグマ 浸水ハザード — 原作忠実(v0.6.0) -------------------------
// 原作仕様(MINE_ROAD_仕様まとめ 行34/104): 水中・マグマ中は泳げる(移動できる)がスタミナを
// 激しく消耗。マグマは特に危険。深く潜るほど水/マグマが増える難度カーブ。
//
// tileType には混ぜない(既存 girlPositions・determinism snapshot・oreAt・monster レイヤー・
// タイル分布を一切変えないため)。水/マグマは「空間(NONE=元空間 or 掘った跡)に被さる浸水フラグ」
// として別オーバーレイレイヤーで持つ(固体土の中は浸水しない=掘り抜いて初めて現れる)。自機/女の子は
// その空間に入れるが浸水ペナルティを受ける(原作「泳げるが激消耗」)。GIRL マス・地表(row0)・範囲外は
// NONE を返す(救出対象/帰還地点には浸水させない)。同じ (col,row,seed) は常に同じ結果(力尽き →
// 同盤面で同じ浸水配置が再現)。
const HAZARD = {
  NONE: 0,
  WATER: 1, // 水。中にいて行動するとスタミナ消耗が割増(WATER_SP_MULT)。中層帯(row>=5)から。
  MAGMA: 2, // マグマ。水より危険=激消耗 + 滞在で体力を直接 chip(MAGMA_HP_CHIP)。深層帯(row>=9)から。
};

// 深度ゲート(原作 行104 の難度カーブに忠実。v0.4.0 oreAt の深度4等分帯=浅1-4/中5-8/深9-12/最深
// 13-15 に揃える)。水は中層帯(row>=5)から、マグマは深層帯(row>=9)から。深いほど密度↑・マグマ比率↑。
const HAZARD_WATER_MIN_ROW = 5; // 水はこの row 以上に出る(浅層 row1-4 は安全)。
const HAZARD_MAGMA_MIN_ROW = 9; // マグマはこの row 以上に出る(深層帯から、特に危険)。
// 浸水存在率(NONE 空間がハザードで満たされる割合)。深いほど上げる(難度カーブ)。
const HAZARD_RATE_MID = 0.18; // 中層(5-8): 水のみ、控えめ。
const HAZARD_RATE_DEEP = 0.3; // 深層(9-15): 水+マグマ合算でこの割合(深いほど密度↑)。
// 深層でハザードが在るとき、マグマである確率(残りは水)。深いほどマグマ寄りに。
const HAZARD_MAGMA_FRAC = 0.45; // 深層帯のハザードのうちこの割合がマグマ(残りは水)。

// ある (col,row) の浸水ハザード種を返す(決定論・乱数禁止)。浸水しないなら HAZARD.NONE。
// tileType=NONE のマス("空間")にのみ意味を持つ(呼び出し側 hazardOf が isSpace で律速)。
// GIRL マス・地表・範囲外は NONE。tileType/oreAt/monster と別位相のハッシュ(+1597/+2389/+7919)。
function hazardAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row < HAZARD_WATER_MIN_ROW) return HAZARD.NONE; // 浅層帯は安全(水も出ない)。
  if (col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return HAZARD.NONE;
  if (isGirlAt(col, row, seed)) return HAZARD.NONE; // 救出対象マスは浸水させない。
  // 存在判定(別位相ハッシュ。既存 oreAt(+911/+733/+5557)・spaceMonster(+313/+197/+8821)・
  // buryMonster(+233/+617/+3001)・tileType(col,row,seed) と非衝突)。
  const presence = hash3(col + 1597, row + 2389, seed + 7919);
  if (row < HAZARD_MAGMA_MIN_ROW) {
    // 中層帯(5-8): 水のみ。
    return presence < HAZARD_RATE_MID ? HAZARD.WATER : HAZARD.NONE;
  }
  // 深層帯(9-15): 水+マグマ。在るときに種別を別ハッシュで分ける(マグマ比率は深層で固定)。
  if (presence >= HAZARD_RATE_DEEP) return HAZARD.NONE;
  const kindH = hash3(col + 2389, row + 7919, seed + 1597); // 種別用(存在ハッシュと別位相)。
  return kindH < HAZARD_MAGMA_FRAC ? HAZARD.MAGMA : HAZARD.WATER;
}

// 撃破ドロップ(決定論)。drops の per% を「累積しきい値で 1 種だけ落とす」抽選にする
// (原作 PSUM=100 系=合計100の重み付き 1 抽選)。落ちなければ null。kill ごとに固有の位相。
function monsterDrop(key, col, row, seed) {
  const m = MONSTER[key];
  if (!m || !m.drops || !m.drops.length) return null;
  const h = hash3(col + 1471, row + 829, seed + 4493); // [0,1)
  let acc = 0;
  for (const d of m.drops) {
    acc += d.per / 100;
    if (h < acc) return d.item;
  }
  return null; // per 合計 < 100 の端数 = 何も落とさない。
}

// app.js 未読込でも tiles.js 単体で node --check が通るフォールバック定数。
const TILES_FALLBACK_CONST = {
  GRID_COLS: 15,
  DEPTH_ROWS: 15,
  GIRL_COUNT: 5,
};

// ---- PALETTE(深度軸 + 掘った道) --------------------------------------
// 地表 = 明色(安全)。下へ深度で暗くなる質量。掘った空間は道として相対的に明るい。
// 女の子 = 暖色自発光。自機 = 常時最明。fog の黒に埋もれないよう前景は別系統で描く。
const PALETTE = {
  // 地表 = 夜明けの藍白(安全・全回復・帰還地点)。
  surface: "#cdd6e8",
  // 土(未掘削の質量): 浅 → 深 で暗くなる琥珀〜土褐。
  soilShallow: "#7a5836",
  soilDeep: "#3a2c1e",
  // 硬土 = 土より青灰寄りで硬さを示す。
  hard: "#5a5240",
  // 硬岩 = 掘れない灰青(明るめの質量で「壁」と分かる)。
  rock: "#7e8290",
  // 掘った空間(道) = 深部の闇よりわずかに明るい藍。地表に近いほど明るい。
  caveShallow: "#2a2f3e",
  caveDeep: "#14161f",
  // fog(未可視) = ほぼ黒。
  fog: "#070809",
  // 女の子 = 暖色自発光(朱寄りの暖橙)。
  girl: "#ffb86a",
  // 自機 = 暖白(常時最明)。
  miner: "#fff3d0",
  // 体力バー = 朱(危険ゾーン)。
  hp: "#d8392a",
  // スタミナバー = 暖橙。
  stamina: "#e6b25a",
  // 暁の光(救出 → 地表の勝利演出)。
  dawn: "#e7b98a",
  // v0.6.0 浸水ハザード(空洞の塗りに半透明で重ねる)。水=青系/マグマ=赤橙系。
  water: "#2f6fb0", // 水の浸水(青)。
  magma: "#d8542a", // マグマの浸水(赤橙、特に危険)。
};

if (typeof window !== "undefined") {
  window.TILE = TILE;
  window.TILE_DIG_KEY = TILE_DIG_KEY;
  window.tileType = tileType;
  window.blockThresholds = blockThresholds;
  window.girlPositions = girlPositions;
  window.isGirlAt = isGirlAt;
  window.tilesHash3 = hash3;
  window.PALETTE = PALETTE;
  // v0.4.0 アイテム/クラフト系。
  window.ORE = ORE;
  window.ORE_META = ORE_META;
  window.oreAt = oreAt;
  window.PICK = PICK;
  window.TILE_REQ_POWER = TILE_REQ_POWER;
  window.CRAFT_RECIPES = CRAFT_RECIPES;
  // v0.5.0 モンスター系(verbatim データ + 決定論スポーン/ドロップ)。
  window.MON = MON;
  window.MONSTER = MONSTER;
  window.spaceMonsterAt = spaceMonsterAt;
  window.buryMonsterAt = buryMonsterAt;
  window.monsterDrop = monsterDrop;
  // v0.6.0 水/マグマ 浸水ハザード(別オーバーレイレイヤー、決定論)。
  window.HAZARD = HAZARD;
  window.hazardAt = hazardAt;
}
