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
}
