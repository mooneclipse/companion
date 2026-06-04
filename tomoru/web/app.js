"use strict";
// ともる — 灯量(ともしび)= 視界 = 酸素 = 帰路 の三位一体な縦坑ダイブ採掘サバイバル。
// バニラ JS、フレームワーク無し。ランタイムで外部 API / claude を呼ばない(唯一の外部
// 依存は CSS の和文フォント CDN)。TILE/tileType/UPGRADES/PALETTE/TEXT は別ファイルの global。
//
// 文字・灯量バー・鉱石カウントは全て DOM(なごり「文字がはみ出して読めない」真因の直接対策)。
// canvas には縦坑の断面(タイル矩形 + per-tile ライティング + 視界円グロー)だけを焼く。
//
// 核メカ: 隣接タップで掘る(前進)/長押しで灯を撒く(恒久光源・帰り道)。灯量は降下中つねに
// 減り、灯量に応じて視界円の半径が決まる。地表へ戻ると自動精錬 → 強化を 3 択から 1 つ。

// ---- バージョン --------------------------------------------------------
const VERSION = "v1.1.1";

// ---- CONSTANTS(初期値、playtester で実測調整可。バランスは全てここに集約) ----
const CONST = {
  GRID_COLS: 7, // 横の列数。
  VISIBLE_ROWS: 14, // 縦の可視行数(自機追従スクロール)。
  LIGHT_MAX: 100, // 灯量の最大(強化で増える基準値)。
  BASE_DRAIN: 0.4, // 灯量の基本減少(/秒)。
  DEPTH_DRAIN_K: 0.025, // 深さ依存の追加減少(/秒、depth * これ)。
  LANTERN_COST: 12, // 灯を 1 個撒くのに要る灯量。
  LANTERN_RADIUS: 2, // 撒いた灯が照らす半径(マス)。
  VISION_MIN: 1.5, // 灯量 0 側の視界円半径(マス)。
  VISION_MAX: 5.5, // 灯量満タン側の視界円半径(マス)。
  RETURN_COST_K: 1.0, // 帰路に要る灯量 = depth * これ。
  DIG_TAPS: { SOIL: 1, ROCK: 3, ORE: 2 }, // タイル種別の掘削タップ数。
  MAW_DRAIN: 25, // 喰らい闇が露出したときに吸う灯量。
  CORE_DEPTH: 40, // コア大鉱脈(目標)を置く row。
  BASE_SEED: 73101, // 決定論シードの基底(diveCount を足して毎ダイブ変える)。
  LONGPRESS_MS: 320, // この時間以上 + 移動小 なら長押し(灯まき)。
  TAP_MAX_MOVE: 18, // タップ/長押し判定の移動許容(px)。
  ORE_PER_TILE: 1, // 鉱石 1 マスで得る基本量。
  // 灯メカ再設計(v1.1.0): 撒いた灯の照射範囲内にいる間、灯量の減りを大きく減らす
  // (帰り道の保険)。0.3 = そばにいるとき drain を 3 割に。
  LANTERN_DRAIN_FACTOR: 0.3,
  // 深いほど視界円の上限を下げる(深部では撒いた灯の局所照明が頼り)。
  // 視界上限 = VISION_MAX - depth * これ。VISION_MIN は割らない(理不尽死回避)。
  VISION_DEPTH_PENALTY: 0.04,
};
// バランス計測 bot から係数を上書きできるよう公開(本番挙動は CONST の初期値で確定)。
if (typeof window !== "undefined") window.CONST = CONST;

const BEST_DEPTH_KEY = "tomoru_best_depth";
const BEST_SMELT_KEY = "tomoru_best_smelt";
const HOWTO_KEY = "tomoru_seen_howto";

// ---- DOM 参照 ----------------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const depthValEl = document.getElementById("depth-val");
const oreIronEl = document.getElementById("ore-iron");
const oreCrystEl = document.getElementById("ore-cryst");
const oreCoreEl = document.getElementById("ore-core");
const lightRailEl = document.querySelector(".light-rail");
const lightFillEl = document.getElementById("light-fill");
const returnMarkEl = document.getElementById("return-mark");
const lightValEl = document.getElementById("light-val");
const hudHintEl = document.getElementById("hud-hint");

const overlayEl = document.getElementById("overlay");
const panelEl = overlayEl.querySelector(".panel");
const ovTitleEl = document.getElementById("ov-title");
const ovSubEl = document.getElementById("ov-sub");
const ovHowtoEl = document.getElementById("ov-howto");
const ovUpgradesEl = document.getElementById("ov-upgrades");
const ovStockEl = document.getElementById("ov-stock");
const ovActionEl = document.getElementById("ov-action");
const ovAction2El = document.getElementById("ov-action2");
const ovVersionEl = document.getElementById("ov-version");

// 操作: 十字キー + 灯ボタン(canvas 外 DOM、タップ掘りと併用)。
const btnUpEl = document.getElementById("btn-up");
const btnDownEl = document.getElementById("btn-down");
const btnLeftEl = document.getElementById("btn-left");
const btnRightEl = document.getElementById("btn-right");
const btnLanternEl = document.getElementById("btn-lantern");

// ---- canvas / 描画状態 -------------------------------------------------
let DPR = 1;
let W = 0;
let H = 0;
let elapsed = 0;
let lastT = 0;
let tile = 58; // タイル一辺(px)。resize で W/GRID_COLS から決める。
let camY = 0; // カメラ縦オフセット(行単位、自機追従)。

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
  bakeGlow();
}

// ---- 色補間(なごり踏襲) ----------------------------------------------
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

// ---- 視界円グローの事前ベイク(毎フレーム gradient 再生成は禁止) --------
// 放射グラデを 1 枚だけ offscreen に焼き、描画時はスケールして使う。
let glowCanvas = null;
function bakeGlow() {
  const size = 256;
  glowCanvas = document.createElement("canvas");
  glowCanvas.width = size;
  glowCanvas.height = size;
  const gc = glowCanvas.getContext("2d");
  const g = gc.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const acc = hexToRgb(PALETTE.lantern);
  g.addColorStop(0, `rgba(${acc[0]},${acc[1]},${acc[2]},0.34)`);
  g.addColorStop(0.5, `rgba(${acc[0]},${acc[1]},${acc[2]},0.12)`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  gc.fillStyle = g;
  gc.fillRect(0, 0, size, size);
}

// ---- ゲーム状態 --------------------------------------------------------
// screen: "title" / "howto" / "dive" / "upgrade" / "fail" / "clear"。
const G = {
  screen: "title",
  diveCount: 0, // 累積ダイブ数(= シードの揺らぎ)。
  seed: CONST.BASE_SEED,
  px: 3, // 自機の列(0..GRID_COLS-1)。
  py: 0, // 自機の行(0 = 地表)。
  light: CONST.LIGHT_MAX,
  lightMax: CONST.LIGHT_MAX,
  dug: null, // Set("col,row") 掘り済みタイル(このダイブ限り)。
  lanterns: null, // Set("col,row") 撒いた灯(このダイブ限り)。
  maws: null, // Set("col,row") 露出済み喰らい闇(このダイブ限り、視界吸い)。
  digProgress: null, // Map("col,row" -> 残タップ数)。
  pending: { iron: 0, cryst: 0, core: 0 }, // このダイブの未精錬鉱石。
  stock: { iron: 0, cryst: 0, core: 0 }, // 精錬済み在庫(強化に使う、永続)。
  upg: null, // 永続強化の累積効果。
  gotCore: false, // このダイブでコア大鉱脈を掘り当てたか(勝利条件)。
  busy: false, // overlay 遷移中などの入力ロック。
  nearLantern: false, // 撒いた灯の照射範囲内にいるか(灯量の減りが緩む。演出用)。
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

// ---- 永続強化の集計 ----------------------------------------------------
// G.stock から取得済み強化を反映する。強化は取得時に G.appliedUpgrades に積み、
// ここで毎ダイブ開始時に upg(効果)へ畳み込む。
function freshUpg() {
  return {
    lightMaxAdd: 0,
    drainMult: 1,
    lanternRadiusAdd: 0,
    lanternCostAdd: 0,
    visionAdd: 0,
    digSpeedAdd: 0,
    oreBonusAdd: 0,
  };
}
function recomputeUpg() {
  const u = freshUpg();
  for (const id of G.appliedUpgrades) {
    const def = UPGRADES.find((x) => x.id === id);
    if (!def) continue;
    for (const k in def.apply) {
      if (k === "drainMult") u.drainMult *= def.apply[k];
      else u[k] += def.apply[k];
    }
  }
  G.upg = u;
  G.lightMax = CONST.LIGHT_MAX + u.lightMaxAdd;
}

// ---- 鉱石ティアのゲート判定(浅場ピストン無効化) ----------------------
function effDigTaps(tileVal) {
  const key = TILE_DIG_KEY[tileVal];
  let taps = CONST.DIG_TAPS[key] || 1;
  taps -= G.upg.digSpeedAdd; // 掘削速度+ でタップ減。
  return Math.max(1, taps);
}
function effLanternCost() {
  return Math.max(1, CONST.LANTERN_COST + G.upg.lanternCostAdd);
}
function effLanternRadius() {
  return CONST.LANTERN_RADIUS + G.upg.lanternRadiusAdd;
}
function effVisionMax() {
  return CONST.VISION_MAX + G.upg.visionAdd;
}
// 深部ほど視界円の上限を下げる(深部では撒いた灯の局所照明が頼り)。
// VISION_MIN は割らない(理不尽死回避)。depth = 現在の自機行。
function effVisionCap(depth) {
  const cap = effVisionMax() - depth * CONST.VISION_DEPTH_PENALTY;
  return Math.max(CONST.VISION_MIN, cap);
}

// ---- ダイブ開始 --------------------------------------------------------
function startDive() {
  G.diveCount += 1;
  G.seed = CONST.BASE_SEED + G.diveCount;
  recomputeUpg();
  G.px = Math.floor(CONST.GRID_COLS / 2);
  G.py = 0;
  G.light = G.lightMax;
  G.dug = new Set();
  G.lanterns = new Set();
  G.maws = new Set();
  G.digProgress = new Map();
  G.pending = { iron: 0, cryst: 0, core: 0 };
  G.gotCore = false;
  G.busy = false;
  G.screen = "dive";
  hideOverlay();
  hudEl.hidden = false;
  camY = 0;
  renderHud();
}

// ---- タイル参照(掘り済みは EMPTY) ------------------------------------
function tileAt(col, row) {
  if (col < 0 || col >= CONST.GRID_COLS || row < 0) return TILE.ROCK; // 範囲外は壁。
  if (G.dug.has(col + "," + row)) return TILE.EMPTY;
  return tileType(col, row, G.seed);
}

// ---- 灯量の帰路コスト・撤退予告 ----------------------------------------
function returnCost() {
  return G.py * CONST.RETURN_COST_K;
}
function effDrain() {
  let d = (CONST.BASE_DRAIN + G.py * CONST.DEPTH_DRAIN_K) * G.upg.drainMult;
  // 撒いた灯の照射範囲内にいる間は灯量の減りを大きく抑える(帰り道の保険)。
  if (G.nearLantern) d *= CONST.LANTERN_DRAIN_FACTOR;
  return d;
}
// 自機が撒いた灯のいずれかの照射範囲(LANTERN_RADIUS)内にいるか。
function isNearLantern() {
  if (!G.lanterns) return false;
  const rad = effLanternRadius();
  for (const k of G.lanterns) {
    const [lc, lr] = k.split(",").map(Number);
    if (Math.abs(lc - G.px) <= rad && Math.abs(lr - G.py) <= rad) return true;
  }
  return false;
}

// ---- 掘る(隣接タイルを 1 タップぶん掘削) ------------------------------
// 自機の上下左右の隣接タイルだけ掘れる。掘りきると自機がそのマスへ前進。
function digAdjacent(col, row) {
  if (G.screen !== "dive" || G.busy) return;
  const dc = Math.abs(col - G.px);
  const dr = Math.abs(row - G.py);
  if (dc + dr !== 1) return; // 上下左右の隣接 1 マスのみ。
  const key = col + "," + row;
  const t = tileAt(col, row);
  if (t === TILE.EMPTY) {
    // 既に空洞 → そのまま移動(掘る手数なし)。
    moveTo(col, row);
    return;
  }
  // 掘削進行(タイルごと残タップ)。
  let remain = G.digProgress.get(key);
  if (remain === undefined) remain = effDigTaps(t);
  remain -= 1;
  spawnPopupAt(col, row, "・"); // 掘った手応え(打点)。
  if (remain > 0) {
    G.digProgress.set(key, remain);
    return;
  }
  // 掘り抜けた。
  G.digProgress.delete(key);
  onTileBroken(col, row, t);
  G.dug.add(key);
  moveTo(col, row);
}

function onTileBroken(col, row, t) {
  // 鉱石なら手持ちへ。喰らい闇なら露出して灯量を吸う。
  const oreKey = TILE_ORE[t];
  if (oreKey) {
    let amt = CONST.ORE_PER_TILE;
    // コア大鉱脈は複数ぶん。
    if (t === TILE.COREBIG) amt = 3;
    // 目利き+(高品位出現+, oreBonusAdd): 整数部はそのまま加算、端数は決定論ハッシュで
    // 確率反映(Math.random 禁止)。掘った座標 + 地形生成と衝突しない固定ソルトで判定する
    // ため、同じマスは常に同じ結果になりフレーム非依存。
    const ob = G.upg.oreBonusAdd || 0;
    amt += Math.floor(ob);
    const frac = ob - Math.floor(ob);
    if (frac > 0 && tilesHash3(col, row, G.seed + 4242) < frac) amt += 1;
    G.pending[oreKey] += amt;
    spawnPopupAt(col, row, "＋" + amt, "cue");
    if (t === TILE.COREBIG) {
      G.gotCore = true;
      showHint(TEXT.clearSub, false);
    }
  } else if (t === TILE.MAW) {
    revealMaw(col, row);
  }
}

// 喰らい闇が露出: 周囲の灯量を吸い視界を急縮。打ち消すには灯を撒く(光を割く)。
function revealMaw(col, row) {
  G.maws.add(col + "," + row);
  G.light = Math.max(0, G.light - CONST.MAW_DRAIN);
  spawnPopupAt(col, row, "－" + CONST.MAW_DRAIN, "warn");
  showHint(TEXT.cueMaw, true);
  if (G.light <= 0) checkFail();
}

function moveTo(col, row) {
  G.px = col;
  G.py = row;
  // 地表(row 0)に戻ったら精錬 → 強化。
  if (row === 0) {
    surfaceReturn();
    return;
  }
  renderHud();
}

// ---- 灯を撒く(長押し) -------------------------------------------------
function dropLantern() {
  if (G.screen !== "dive" || G.busy) return;
  const cost = effLanternCost();
  if (G.light < cost) {
    showHint(TEXT.returnWarn, true);
    return;
  }
  const key = G.px + "," + G.py;
  if (G.lanterns.has(key)) return; // 既に灯がある。
  G.light -= cost;
  G.lanterns.add(key);
  // 近接の露出済み喰らい闇を打ち消す(光を割いて対処)。
  let dispelled = false;
  const rad = effLanternRadius();
  for (const m of Array.from(G.maws)) {
    const [mc, mr] = m.split(",").map(Number);
    if (Math.abs(mc - G.px) <= rad && Math.abs(mr - G.py) <= rad) {
      G.maws.delete(m);
      dispelled = true;
    }
  }
  spawnPopupAt(G.px, G.py, "灯", "cue");
  if (dispelled) showHint(TEXT.cueMawDispel, false);
  renderHud();
}

// ---- 地表帰還 = 精錬 + 強化 3 択 ---------------------------------------
function surfaceReturn() {
  // 未精錬鉱石を確定(在庫へ)。
  G.stock.iron += G.pending.iron;
  G.stock.cryst += G.pending.cryst;
  G.stock.core += G.pending.core;
  const smelted = { iron: G.pending.iron, cryst: G.pending.cryst, core: G.pending.core };
  const smeltTotal = G.pending.iron + G.pending.cryst + G.pending.core;
  G.pending = { iron: 0, cryst: 0, core: 0 };
  G.lastSmelt = smelted; // ショップで「＋N」演出に使う。
  // 精錬総量(累積)を記録。
  const newSmelt = getInt(BEST_SMELT_KEY) + smeltTotal;
  setInt(BEST_SMELT_KEY, newSmelt);
  // 到達最深度を記録。
  if (G.py === 0 && G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) {
    setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  }
  // コアを持ち帰っていれば勝利演出。
  if (G.gotCore) {
    showClear();
    return;
  }
  showUpgrade();
}

// ---- 失敗(灯量 0 で地表に戻れない) -----------------------------------
function checkFail() {
  if (G.light <= 0 && G.py > 0 && G.screen === "dive") {
    // 未精錬鉱石を全ロスト(在庫・強化は残る)。
    G.pending = { iron: 0, cryst: 0, core: 0 };
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
  ovUpgradesEl.innerHTML = "";
  ovHowtoEl.innerHTML = "";
  ovStockEl.innerHTML = "";
}
function resetOverlayParts() {
  panelEl.classList.remove("shop-mode"); // 他 overlay は通常 panel に戻す。
  ovTitleEl.hidden = true;
  ovTitleEl.classList.remove("small-title");
  ovSubEl.hidden = true;
  ovHowtoEl.hidden = true;
  ovHowtoEl.innerHTML = "";
  ovStockEl.hidden = true;
  ovStockEl.innerHTML = "";
  ovUpgradesEl.hidden = true;
  ovUpgradesEl.innerHTML = "";
  ovActionEl.hidden = true;
  ovAction2El.hidden = true;
  ovVersionEl.hidden = true;
  ovActionEl.onclick = null;
  ovAction2El.onclick = null;
}

function showTitle() {
  G.screen = "title";
  hudEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.title;
  ovTitleEl.hidden = false;
  const bd = getInt(BEST_DEPTH_KEY);
  const bs = getInt(BEST_SMELT_KEY);
  ovSubEl.textContent =
    TEXT.bestDepthPrefix + bd + TEXT.bestDepthSuffix + "　" + TEXT.bestSmeltPrefix + bs;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.start;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => onStartPressed();
  ovAction2El.textContent = TEXT.howtoButton;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => showHowto("title");
  ovVersionEl.textContent = VERSION;
  ovVersionEl.hidden = false;
  showOverlay();
}

function onStartPressed() {
  if (!seenHowto()) {
    showHowto("start");
  } else {
    startDive();
  }
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

// ---- 基地ショップ(v1.1.0) --------------------------------------------
// 地表帰還で表示。全強化を縦リスト一覧 → 在庫が足りる & ティア解放済み & 未取得なら
// タップで買い切り購入。購入後はその場で再描画(ショップは開いたまま)。「もぐる」で次ダイブ。
function showUpgrade() {
  G.screen = "upgrade";
  hudEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.upgradeTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  // 何も持ち帰っていない & 在庫も空(序盤)はヒントを出す。
  const totalStock = G.stock.iron + G.stock.cryst + G.stock.core;
  if (totalStock === 0) {
    ovSubEl.textContent = TEXT.upgradeNonePrefix;
    ovSubEl.hidden = false;
  }
  ovAction2El.textContent = TEXT.upgradeSkip;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => startDive();
  // panel を「スクロール領域(在庫+強化リスト) + 固定フッター(もぐる)」の 2 段にする。
  // リスト行が増えても最下部ボタンが常に clip 内で押せる(短高 viewport 対策)。
  panelEl.classList.add("shop-mode");
  renderShop(true); // 精錬の「＋N」演出は初回のみ。
  showOverlay();
}

// ショップ本体の再描画。在庫表示 + 強化一覧。afterSmelt = 精錬演出を出すか。
function renderShop(afterSmelt) {
  // 在庫表示(鉄/結晶/コアの持ち帰り総量)。
  ovStockEl.innerHTML = "";
  ovStockEl.hidden = false;
  const oreLabel = { iron: "鉄", cryst: "晶", core: "核" };
  for (const k of ["iron", "cryst", "core"]) {
    const span = document.createElement("span");
    span.className = "stock-ore " + k;
    const ico = document.createElement("span");
    ico.className = "stock-ico";
    ico.textContent = oreLabel[k];
    const num = document.createElement("span");
    num.textContent = G.stock[k];
    span.appendChild(ico);
    span.appendChild(num);
    // 精錬の「＋N」演出(初回表示時、持ち帰りがあった鉱石に付ける)。
    if (afterSmelt && G.lastSmelt && G.lastSmelt[k] > 0) {
      const plus = document.createElement("span");
      plus.className = "stock-plus";
      plus.textContent = TEXT.smeltPopupPrefix + G.lastSmelt[k];
      span.appendChild(plus);
    }
    ovStockEl.appendChild(span);
  }
  if (afterSmelt) G.lastSmelt = null; // 演出は 1 回だけ。

  // 強化一覧(縦リスト)。全 UPGRADES を出し、状態で見た目を分ける。
  ovUpgradesEl.innerHTML = "";
  ovUpgradesEl.hidden = false;
  for (const u of UPGRADES) {
    const owned = G.appliedUpgrades.includes(u.id);
    const unlocked = upgradeUnlocked(u, G.stock);
    const afford = upgradeCanAfford(u, G.stock);
    const buyable = !owned && unlocked && afford;
    const el = buildShopRow(u, { owned, unlocked, afford, buyable });
    if (buyable) {
      el.onclick = () => {
        for (const k in u.cost) G.stock[k] -= u.cost[k];
        G.appliedUpgrades.push(u.id);
        renderShop(false); // 在庫が減り、取得済みになった状態で即再描画。
      };
    }
    ovUpgradesEl.appendChild(el);
  }
}

// ショップ 1 行: アイコン(ティア) / 名前 / 効果数値 / コスト / 状態。
function buildShopRow(u, st) {
  const el = document.createElement("div");
  el.className = "shop-row";
  if (st.owned) el.classList.add("owned");
  else if (st.buyable) el.classList.add("buyable");
  else el.classList.add("locked"); // 未解放 or 在庫不足。

  const tierEl = document.createElement("span");
  tierEl.className = "upg-tier " + u.tier;
  tierEl.textContent = u.tier === "iron" ? "鉄" : u.tier === "cryst" ? "晶" : "核";

  const body = document.createElement("div");
  body.className = "shop-body";
  const nameEl = document.createElement("div");
  nameEl.className = "upg-name";
  nameEl.textContent = u.name;
  const descEl = document.createElement("div");
  descEl.className = "upg-desc";
  descEl.textContent = u.desc;
  body.appendChild(nameEl);
  body.appendChild(descEl);

  const right = document.createElement("div");
  right.className = "shop-right";
  if (st.owned) {
    const o = document.createElement("div");
    o.className = "shop-owned";
    o.textContent = TEXT.shopOwned;
    right.appendChild(o);
  } else {
    const costEl = document.createElement("div");
    costEl.className = "upg-cost";
    costEl.textContent = costStr(u.cost);
    right.appendChild(costEl);
    if (st.buyable) {
      const buy = document.createElement("div");
      buy.className = "shop-buy";
      buy.textContent = TEXT.shopBuy;
      right.appendChild(buy);
    }
  }

  el.appendChild(tierEl);
  el.appendChild(body);
  el.appendChild(right);
  return el;
}

function costStr(cost) {
  const parts = [];
  const label = { iron: "鉄", cryst: "晶", core: "核" };
  for (const k of ["iron", "cryst", "core"]) {
    if (cost[k]) parts.push(label[k] + cost[k]);
  }
  return parts.join(" ");
}

function showFail() {
  G.screen = "fail";
  hudEl.hidden = true;
  // 到達最深度を記録(失敗でも最深は伸びる)。
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) {
    setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  }
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.failTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovSubEl.textContent = TEXT.failReachPrefix;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.retry;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => startDive();
  showOverlay();
}

function showClear() {
  G.screen = "clear";
  hudEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.clearTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovSubEl.textContent = TEXT.clearSub;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.again;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => showUpgrade(); // 勝利後も強化を選んでエンドレス継続。
  showOverlay();
}

// ---- HUD レンダリング(DOM) --------------------------------------------
function renderHud() {
  depthValEl.textContent = TEXT.depthPrefix + G.py + TEXT.depthSuffix;
  oreIronEl.textContent = G.pending.iron;
  oreCrystEl.textContent = G.pending.cryst;
  oreCoreEl.textContent = G.pending.core;
  // 灯量バー(下から上)。
  const ratio = Math.max(0, Math.min(1, G.light / G.lightMax));
  lightFillEl.style.height = ratio * 100 + "%";
  lightValEl.textContent = Math.round(G.light);
  // 帰路目盛り(地表へ戻るのに要る灯量の高さ)。
  const rc = returnCost();
  const rcRatio = Math.max(0, Math.min(1, rc / G.lightMax));
  returnMarkEl.style.bottom = rcRatio * 100 + "%";
  // 残灯量が帰路を割ったら赤面。
  const warn = G.light < rc;
  returnMarkEl.classList.toggle("warn", warn);
  lightRailEl.classList.toggle("warn", warn);
  // 灯のそば(灯量が減りにくい)状態をバーに反映(利点を目に見せる)。
  lightRailEl.classList.toggle("safe", G.nearLantern && !warn);
  // 最深度の更新(このダイブ)。
  if (G.py > (G.maxDepthThisDive || 0)) G.maxDepthThisDive = G.py;
}

let hintTimer = null;
function showHint(text, warn) {
  hudHintEl.textContent = text;
  hudHintEl.classList.toggle("warn", !!warn);
  hudHintEl.hidden = false;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hudHintEl.hidden = true;
  }, 1600);
}

// ---- 数値ポップ(掘った/採取/灯/喰らい闇) -----------------------------
// タイル座標 → 画面座標へ変換してポップ。
function spawnPopupAt(col, row, text, cls) {
  const sx = col * tile + tile / 2;
  const sy = (row - camY) * tile + tile / 2;
  const p = document.createElement("div");
  p.className = "popup" + (cls ? " " + cls : "");
  p.style.left = sx + "px";
  p.style.top = sy + "px";
  p.textContent = text;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 850);
}

// ---- 入力(タップ = 掘る / 長押し = 灯を撒く) --------------------------
// ともしび由来: pointerdown 時刻 + 移動量でタップ/長押しを判別。
let pdStart = 0;
let pdX = 0;
let pdY = 0;
let pdMoved = 0;
let pdActive = false;
let lpTimer = null;
let lpFired = false;

function screenToTile(x, y) {
  // 行は描画と同じ基準で整数化する。タイルは (row - camY)*tile に描かれるので、
  // 画面 y のタイル行 = floor(y/tile + camY)。camY を floor の外で足すと非整数行になり
  // 隣接判定(dc+dr===1)が壊れるため、必ず加算後に floor する。
  const col = Math.floor(x / tile);
  const row = Math.floor(y / tile + camY);
  return { col, row };
}

canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (G.screen !== "dive" || G.busy) return;
    pdActive = true;
    lpFired = false;
    pdStart = performance.now();
    pdX = e.clientX;
    pdY = e.clientY;
    pdMoved = 0;
    // 長押しタイマー: 移動が小さいまま閾値を超えたら灯を撒く。
    if (lpTimer) clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      if (pdActive && pdMoved < CONST.TAP_MAX_MOVE) {
        lpFired = true;
        dropLantern();
      }
    }, CONST.LONGPRESS_MS);
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
  if (lpTimer) {
    clearTimeout(lpTimer);
    lpTimer = null;
  }
  if (lpFired) return; // 長押し(灯まき)済み → タップ処理しない。
  if (pdMoved >= CONST.TAP_MAX_MOVE) return; // 大きく動いた = スワイプ無視。
  // 短タップ = 掘る。pointerup 座標で方向決定。
  const { col, row } = screenToTile(e.clientX, e.clientY);
  digAdjacent(col, row);
}
canvas.addEventListener("pointerup", pointerEnd, { passive: true });
canvas.addEventListener("pointercancel", () => {
  pdActive = false;
  if (lpTimer) {
    clearTimeout(lpTimer);
    lpTimer = null;
  }
});

// ---- 十字キー + 灯ボタン(canvas 外 DOM、タップ掘りと併用) --------------
// 押した方向の自機隣接タイルを掘る/移動(タップ掘りと同じ digAdjacent 経路)。
function digDir(dc, dr) {
  if (G.screen !== "dive" || G.busy) return;
  digAdjacent(G.px + dc, G.py + dr);
}
btnUpEl.addEventListener("click", () => digDir(0, -1));
btnDownEl.addEventListener("click", () => digDir(0, 1));
btnLeftEl.addEventListener("click", () => digDir(-1, 0));
btnRightEl.addEventListener("click", () => digDir(1, 0));
btnLanternEl.addEventListener("click", () => dropLantern());

// ---- per-tile ライティング(per-pixel 禁止、タイル粒度) ----------------
// 各可視タイルの明度 = 視界円寄与(自機からの距離) + 撒いた灯/灯の島の寄与。
// 暖色 rgba の矩形で重畳。視界円の縁グローだけ事前ベイク 1 枚をスケールして重ねる。
function tileLight(col, row) {
  // 視界円寄与: 灯量で半径が決まる。中心(自機)で 1、縁で 0。
  // 深部ほど視界上限が下がる(effVisionCap)。VISION_MIN は割らない。
  const vmax = effVisionCap(G.py);
  const ratio = Math.max(0, Math.min(1, G.light / G.lightMax));
  const vr = lerp(CONST.VISION_MIN, vmax, ratio);
  const d = Math.hypot(col - G.px, row - G.py);
  let v = Math.max(0, 1 - d / vr);
  // 撒いた灯の寄与(恒久光源・減らない)。
  const lr = effLanternRadius();
  for (const k of G.lanterns) {
    const [lc, lrow] = k.split(",").map(Number);
    const dl = Math.hypot(col - lc, row - lrow);
    if (dl <= lr) v = Math.max(v, 0.85 * (1 - dl / (lr + 0.5)));
  }
  // 自機位置は常時最明(中心)。
  if (col === G.px && row === G.py) v = Math.max(v, 1);
  return Math.max(0, Math.min(1, v));
}

function bandColor(row) {
  // 深度帯ごとの地の色を隣帯と滑らかに補間。
  const surf = hexToRgb(PALETTE.surface.bg);
  const sh = hexToRgb(PALETTE.shallow.bg);
  const md = hexToRgb(PALETTE.mid.bg);
  const dp = hexToRgb(PALETTE.deep.bg);
  if (row <= 0) return surf;
  if (row <= 12) return mixRgb(surf, sh, Math.min(1, row / 4));
  if (row <= 26) return mixRgb(sh, md, (row - 12) / 14);
  return mixRgb(md, dp, Math.min(1, (row - 26) / 14));
}

function oreColor(tileVal, row) {
  if (tileVal === TILE.IRON) return hexToRgb(PALETTE.shallow.ore);
  if (tileVal === TILE.CRYST) return hexToRgb(PALETTE.mid.ore);
  if (tileVal === TILE.CORE) return hexToRgb(PALETTE.deep.ore);
  if (tileVal === TILE.COREBIG) {
    // 脈打つ橙金。
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3);
    return mixRgb(hexToRgb(PALETTE.deep.ore), hexToRgb(PALETTE.coreHi), pulse);
  }
  return null;
}

// ---- 縦坑の描画 --------------------------------------------------------
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (G.screen !== "dive") {
    // dive 以外は深い坑の地色で塗っておく(overlay が上に乗る)。
    ctx.fillStyle = "#05030a";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // カメラ追従: 自機を画面のやや上(行 4 付近)に置く。地表は上端で止める。
  const targetCam = Math.max(0, G.py - 4);
  camY += (targetCam - camY) * 0.18;
  if (typeof window !== "undefined") window.__camY = camY; // テスト用にカメラ位置を読めるよう露出。

  const rows = Math.ceil(H / tile) + 2;
  const startRow = Math.floor(camY) - 1;

  for (let ri = 0; ri < rows; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const sy = (row - camY) * tile;
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      const sx = col * tile;
      const t = tileAt(col, row);
      const light = tileLight(col, row);

      // 地の色。
      let base = bandColor(row);
      // 喰らい闇(露出済み)= 完全な黒の穴。
      const isMaw = G.maws.has(col + "," + row);
      if (isMaw) base = [0, 0, 0];

      // 採掘前の鉱石/岩/土 → 種別で微妙に色を変える(暗くても種が見える)。
      if (t === TILE.ROCK) base = mixRgb(base, [90, 92, 104], 0.35);
      else if (t === TILE.SOIL) base = mixRgb(base, [60, 50, 44], 0.25);
      else if (t === TILE.EMPTY) base = mixRgb(base, [0, 0, 0], 0.45); // 空洞は一段暗い。

      // 明度を掛ける(光が当たるほど明るい)。最低限の暗がりは残す。
      const lit = 0.12 + light * 0.88;
      let r = Math.round(base[0] * lit);
      let g = Math.round(base[1] * lit);
      let b = Math.round(base[2] * lit);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(sx, sy, tile + 1, tile + 1);

      // 鉱石の自発光(背景が暗いほど強く光る = 前景視認性)。
      const oc = oreColor(t, row);
      if (oc && light > 0.04) {
        // 暗いほど自発光を強める(反転気味追従)。
        const glowA = (0.35 + (1 - light) * 0.4) * Math.min(1, light * 2.2);
        ctx.fillStyle = `rgba(${oc[0]},${oc[1]},${oc[2]},${glowA})`;
        const pad = tile * 0.22;
        ctx.beginPath();
        ctx.arc(sx + tile / 2, sy + tile / 2, tile / 2 - pad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 撒いた灯のマーク(暖色の点。帰り道のブレッドクラム)。
      if (G.lanterns.has(col + "," + row)) {
        const lc = hexToRgb(PALETTE.lantern);
        ctx.fillStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`;
        ctx.beginPath();
        ctx.arc(sx + tile / 2, sy + tile / 2, tile * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }

      // 喰らい闇の縁取り(周囲の灯が縁になる)。
      if (isMaw && light > 0.04) {
        ctx.strokeStyle = `rgba(244,184,96,${0.3 * light})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 3, sy + 3, tile - 6, tile - 6);
      }
    }
  }

  // 視界円グロー(事前ベイク 1 枚をスケールして自機中心に重ねる)。深部で半径上限が下がる。
  const vmax = effVisionCap(G.py);
  const ratio = Math.max(0, Math.min(1, G.light / G.lightMax));
  const vr = lerp(CONST.VISION_MIN, vmax, ratio);
  const cx = G.px * tile + tile / 2;
  const cy = (G.py - camY) * tile + tile / 2;
  const gsz = vr * tile * 2;
  ctx.drawImage(glowCanvas, cx - gsz / 2, cy - gsz / 2, gsz, gsz);

  // 自機(採掘者)= 視界中心の常時最明 + 1px 縁。
  drawMiner(cx, cy);
}

function drawMiner(cx, cy) {
  const r = tile * 0.32;
  // 暖色の灯を抱えた採掘者。中心は最明。
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.8);
  g.addColorStop(0, "rgba(255,236,196,0.95)");
  g.addColorStop(0.6, "rgba(244,184,96,0.55)");
  g.addColorStop(1, "rgba(244,184,96,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  // 本体(暗いシルエット + 1px 縁で輪郭確保)。
  ctx.fillStyle = "#2a1c12";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,240,200,0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // 灯の芯(中央の暖点)。
  ctx.fillStyle = "#fff0c8";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

// ---- メインループ ------------------------------------------------------
function tick(t) {
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  elapsed += dt;
  // 灯のそば判定(灯量の減りに効く)。dive 中つねに更新。
  if (G.screen === "dive") {
    const was = G.nearLantern;
    G.nearLantern = isNearLantern();
    // そばに入った瞬間に 1 回だけヒント(利点が目に見えるように)。
    if (G.nearLantern && !was && G.py > 0) showHint(TEXT.lanternSafe, false);
  }
  // 灯量の減少(降下中つねに。地表 row 0 では減らない=基地で安全)。
  if (G.screen === "dive" && G.py > 0) {
    G.light = Math.max(0, G.light - effDrain() * dt);
    renderHud();
    checkFail();
  }
  render();
  requestAnimationFrame(tick);
}

// ---- 起動 --------------------------------------------------------------
G.appliedUpgrades = [];
G.maxDepthThisDive = 0;
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
