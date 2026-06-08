"use strict";
// さぐり — タイル種 + 決定論地形生成 + PALETTE + 強化リスト — verbatim 静的データ
// (lead 確定、implementer は数値テーブルを埋めるだけで創作・改変しない)。
// ランタイム乱数(Math.random)は使わない。地形は tileType(col,row,seed) の決定論関数で
// 都度算出し、マップ配列は持たない(掘削差分だけ Set("col,row") で記録)。
//
// タイル種(TILE):
//   EMPTY    空洞(掘り済み or 元から空)。通れる。光が通る道。
//   SOIL     土。1 タップで掘れる。
//   HARDROCK 硬岩。2 タップで掘れる(掘削速度+ 強化で 1 タップ)。
//   UNSTABLE 不安定岩。手がかり数字がカウントする落盤の正体。真下を掘ると次手番で落下。
//   GIRL     女の子(救出対象)。掘って到達=発見、追従。暖金の自発光。
//   SURFACE  地表(row 0)。安全・スタミナ全回復・基地。

const TILE = {
  EMPTY: 0,
  SOIL: 1,
  HARDROCK: 2,
  UNSTABLE: 3,
  GIRL: 4,
  SURFACE: 5,
};

// タイル種ごとの掘削タップ数キー(CONST.DIG_TAPS を単一真実源にするためのマップ)。
// 不安定岩・女の子は土と同じ手数で掘れる(掘ると露出/発見が起きるだけ)。
const TILE_DIG_KEY = {
  [TILE.SOIL]: "SOIL",
  [TILE.HARDROCK]: "HARDROCK",
  [TILE.UNSTABLE]: "SOIL",
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

// ---- 深度帯 ------------------------------------------------------------
// row 0 = 地表(安全・基地)。下へ深度層。浅 1-9 / 中 10-19 / 深 20+。
function depthBand(row) {
  if (row <= 0) return "surface";
  if (row <= 9) return "shallow";
  if (row <= 19) return "mid";
  return "deep";
}

// 不安定岩(落盤)の密度: 浅 0.08 → 深 0.22 へ深度で増える(§4 CONST 起点値)。
function unstableDensity(row) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  const lo = C.UNSTABLE_DENSITY_LO; // 浅
  const hi = C.UNSTABLE_DENSITY_HI; // 深
  const coreDepth = C.CORE_DEPTH;
  const t = Math.max(0, Math.min(1, row / coreDepth));
  return lo + (hi - lo) * t;
}

// ---- 女の子の決定論配置 ------------------------------------------------
// 各ダイブに 複数。深いほど深部寄り。決定論(seed 依存)で row/col を散らす。
// 最下層 CORE_DEPTH には必ず 1 人置く(一区切り目標)。
// 返り値: [{col,row}, ...]
function girlPositions(seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  const cols = C.GRID_COLS;
  const coreDepth = C.CORE_DEPTH;
  const out = [];
  // 浅・中・深に 1 人ずつ + 最下層に 1 人(計 4 人前後、seed で深さ/列が変わる)。
  const bands = [
    { lo: 3, hi: 8, salt: 11 }, // 浅
    { lo: 11, hi: 18, salt: 23 }, // 中
    { lo: 21, hi: coreDepth - 2, salt: 37 }, // 深
  ];
  for (const b of bands) {
    const span = Math.max(1, b.hi - b.lo);
    const row = b.lo + Math.floor(hash3(seed, b.salt, 7) * span);
    const col = Math.floor(hash3(seed, b.salt, 99) * cols);
    out.push({ col, row });
  }
  // 最下層(目標)の女の子。
  const coreCol = Math.floor(hash3(seed, 9991, 7) * cols);
  out.push({ col: coreCol, row: coreDepth });
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
// row 0(地表)は常に SURFACE(自機が立てる安全な基地)。
// それ以外は女の子・硬岩・不安定岩・既存空洞・土を決定論で配置する。
function tileType(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return TILE.SURFACE; // 地表は安全な基地。

  // 女の子(決定論配置)。最優先で返す(救出対象が硬岩等に潰されないよう)。
  if (isGirlAt(col, row, seed)) return TILE.GIRL;

  const band = depthBand(row);
  const r = hash3(col, row, seed); // このマスの基準乱数。

  // 不安定岩(落盤): 深度で密度が増える。手がかり数字がカウントする対象。
  const unstP = unstableDensity(row);
  const ru = hash3(col + 77, row + 13, seed + 9090);
  if (ru < unstP) return TILE.UNSTABLE;

  // 硬岩(読みの質を変える壁): どの深度でも一定確率。深いほどわずかに増える。
  const rockP = band === "shallow" ? 0.08 : band === "mid" ? 0.12 : 0.16;
  if (r < rockP) return TILE.HARDROCK;

  // 既存の空洞(最初から空いている隙間・別ルートの種): 一定確率。
  const r2 = hash3(col + 31, row, seed);
  if (r2 < 0.07) return TILE.EMPTY;

  // 既定 = 土。
  return TILE.SOIL;
}

// app.js 未読込でも tiles.js 単体で node --check が通るフォールバック定数。
const TILES_FALLBACK_CONST = {
  CORE_DEPTH: 30,
  GRID_COLS: 7,
  UNSTABLE_DENSITY_LO: 0.08,
  UNSTABLE_DENSITY_HI: 0.22,
};

// ---- PALETTE(深度軸 + 光の通り道) ------------------------------------
// なごり/ともしびの luminance 補間を「深度軸 + 掘削空洞の光の連結」へ流用する。
//   bg     = その深度帯の地の色(明るい断面)。app.js が深度で隣帯と補間する。
//   light  = 掘った空洞に通る暖色の光(安全に繋がった道=明、塞がれた区間=陰)。
//   girl   = 女の子の暖金自発光。
const PALETTE = {
  // 地表 = 夜明けの藍白(安全・全回復)。自機の光 = 暖橙。
  surface: { bg: "#cdd6e8" },
  // 浅層 = 土の琥珀 → 陰。
  shallow: { bg: "#b07a3e", shade: "#5a4632" },
  // 中層 = 藍灰。
  mid: { bg: "#3a4a5c" },
  // 深層 = 藍黒。
  deep: { bg: "#10131f" },
  // 自機の光(暖橙)。掘った空洞に通る光の色でもある。
  light: "#f4b860",
  // 不安定岩 = 鈍い赤錆の縁。
  unstable: "#8a4a3a",
  // 女の子 = 暖金自発光。
  girl: "#ffcf8a",
  // 印(旗) = 朱。
  flag: "#d8392a",
  // 勝利演出(最下層救出 → 地表): 藍白へ暁の光が差す。
  dawn: "#e7b98a",
};

if (typeof window !== "undefined") {
  window.TILE = TILE;
  window.TILE_DIG_KEY = TILE_DIG_KEY;
  window.tileType = tileType;
  window.depthBand = depthBand;
  window.unstableDensity = unstableDensity;
  window.girlPositions = girlPositions;
  window.isGirlAt = isGirlAt;
  window.tilesHash3 = hash3;
  window.PALETTE = PALETTE;
}
