"use strict";
// ともる — タイル種定義 + 決定論地形生成 — verbatim 静的データ(lead 確定、implementer は
// 創作・改変しない)。ランタイム乱数(Math.random)は使わない。地形は tileType(col,row,seed)
// の決定論関数で都度算出し、マップ配列は持たない(掘られたかだけ Set で差分記録)。
//
// タイル種(TILE):
//   EMPTY  空洞(掘り済み or 元から空)。通れる。
//   SOIL   土。1 タップで掘れる。
//   ROCK   岩。3 タップで掘れる(硬い壁)。
//   IRON   鉄鉱。2 タップ。浅層(row 1-12)。鈍い赤錆の点光。
//   CRYST  結晶鉱。2 タップ。中層(row 13-26)。青白自発光。
//   CORE   コア鉱。2 タップ。深層(row 27+)。脈打つ橙金。
//   MAW    喰らい闇。掘ると露出し周囲の灯量を吸う。光(灯)で打ち消すか避ける。
//   COREBIG コア大鉱脈(目標)。最深部 row ≈ CORE_DEPTH に置く決定論配置。

const TILE = {
  EMPTY: 0,
  SOIL: 1,
  ROCK: 2,
  IRON: 3,
  CRYST: 4,
  CORE: 5,
  MAW: 6,
  COREBIG: 7,
};

// タイル種ごとの掘削タップ数(CONST 側の DIG_TAPS と整合。空洞は 0)。
// app.js の CONST.DIG_TAPS を単一真実源にするため、ここでは種別→キー名のマップだけ持つ。
const TILE_DIG_KEY = {
  [TILE.SOIL]: "SOIL",
  [TILE.ROCK]: "ROCK",
  [TILE.IRON]: "ORE",
  [TILE.CRYST]: "ORE",
  [TILE.CORE]: "ORE",
  [TILE.MAW]: "SOIL", // 喰らい闇自体は土と同じ手数で掘れる(露出が起きるだけ)。
  [TILE.COREBIG]: "ORE",
};

// 鉱石種 → 手持ち資源キー(鉄/結晶/コア)。
const TILE_ORE = {
  [TILE.IRON]: "iron",
  [TILE.CRYST]: "cryst",
  [TILE.CORE]: "core",
  [TILE.COREBIG]: "core",
};

// ---- 整数ハッシュ(決定論・乱数非使用) --------------------------------
// 32bit 整数ハッシュ。col,row,seed から再現可能な疑似乱数 [0,1) を得る。
// マップ配列を持たず、同じ (col,row,diveSeed) は常に同じ結果を返す。
function hash3(a, b, c) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}

// ---- 深度帯 ------------------------------------------------------------
// row 0 = 地表(安全・基地)。row 1-12 = 浅(鉄)、13-26 = 中(結晶)、27+ = 深(コア)。
function depthBand(row) {
  if (row <= 0) return "surface";
  if (row <= 12) return "shallow";
  if (row <= 26) return "mid";
  return "deep";
}

// ---- 決定論地形 --------------------------------------------------------
// tileType(col, row, seed) → TILE 値。
// row 0(地表)は常に EMPTY(自機が立てる安全な基地)。
// それ以外は深度帯ごとの鉱石種・岩・喰らい闇・コア大鉱脈を決定論で配置する。
// CONST は app.js で定義されるが、CORE_DEPTH/GRID_COLS は地形にも要るため引数を介さず
// window.CONST 経由で読む(テスト・本番とも app.js 読込後に呼ばれる)。
function tileType(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return TILE.EMPTY; // 地表は空(基地)。

  const coreDepth = C.CORE_DEPTH;
  const cols = C.GRID_COLS;

  // コア大鉱脈(目標): 最深部 row = CORE_DEPTH の中央付近 1 マスに決定論配置。
  // 列は seed で 1 マスだけ揺らす(毎ダイブで核の横位置が変わる)。
  if (row === coreDepth) {
    const coreCol = Math.floor((hash3(seed, 9991, 7) * cols));
    if (col === coreCol) return TILE.COREBIG;
  }

  const band = depthBand(row);
  const r = hash3(col, row, seed); // このマスの基準乱数。

  // 硬い壁(岩): どの深度でも一定確率。深いほどわずかに増える。
  const rockP = band === "shallow" ? 0.1 : band === "mid" ? 0.14 : 0.18;
  if (r < rockP) return TILE.ROCK;

  // 空洞(既存の隙間=落とし穴/通路): 一定確率で最初から空いている。
  const r2 = hash3(col + 31, row, seed);
  if (r2 < 0.12) return TILE.EMPTY;

  // 鉱脈(鉱石): 深度帯ごとの種を、塊で出やすいよう近傍ハッシュで判定。
  // 鉱脈の芯 + 隣接で塊感を出す(縦坑断面の鉱脈らしさ)。
  const vein = hash3(Math.floor(col / 1), Math.floor(row / 2), seed + 555);
  const oreP = band === "shallow" ? 0.16 : band === "mid" ? 0.17 : 0.18;
  if (vein < oreP) {
    if (band === "shallow") return TILE.IRON;
    if (band === "mid") return TILE.CRYST;
    return TILE.CORE;
  }

  // 喰らい闇: 深層(mid 後半以降)のみ決定論配置。掘ると露出する。
  if (row >= 18) {
    const mawP = row >= 27 ? 0.06 : 0.035;
    const rm = hash3(col + 77, row + 13, seed + 9090);
    if (rm < mawP) return TILE.MAW;
  }

  // 既定 = 土。
  return TILE.SOIL;
}

// app.js 未読込でも tiles.js 単体で node --check が通るようフォールバック定数。
const TILES_FALLBACK_CONST = { CORE_DEPTH: 40, GRID_COLS: 7 };

if (typeof window !== "undefined") {
  window.TILE = TILE;
  window.TILE_DIG_KEY = TILE_DIG_KEY;
  window.TILE_ORE = TILE_ORE;
  window.tileType = tileType;
  window.depthBand = depthBand;
  window.tilesHash3 = hash3;
}
