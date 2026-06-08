"use strict";
// さぐり — 明るい断面で危険を読み、崩れる地形の中で女の子を地上へ護衛するターン制デドゥース。
// バニラ JS、フレームワーク無し。ランタイムで外部 API / claude を呼ばない(唯一の外部依存は
// CSS の和文フォント CDN)。TILE/tileType/UPGRADES/PALETTE/TEXT/FRAGMENTS は別ファイルの global。
//
// 文字・手がかり数字 chip・スタミナバー・気配メーターは全て DOM(なごり「文字がはみ出して
// 読めない」真因の直接対策)。canvas には断面(タイル矩形 + タイル粒度ライティング + 光の道 +
// 自機 + 女の子)だけを焼く。Service Worker は使わない(開発フェーズ)。
//
// 核メカ(§4): 隣接タップ/十字キーで掘る(前進・スタミナ1消費・ターン制)。掘って露出した
// 未掘削面に「周囲8近傍の不安定岩(落盤)数」を DOM chip で表示(0 なら安全連鎖開示)。長押しで
// 危険マスに印(旗)。気配メーターで最寄りの女の子の方向+距離ヒート。不安定岩の真下を掘ると
// 次の自分の手番で落盤(自機/女の子を潰す・道を塞ぐ)。女の子に触れると追従(掘った空洞を
// BFS で辿る)、地表へ導くと救出成功 → 断章 1 行。光の道 = 地表からの掘削空洞の連結成分(明)。

// ---- バージョン --------------------------------------------------------
const VERSION = "v1.0.0";

// ---- CONSTANTS(§4 起点値、playtester で実測調整可。バランスは全てここに集約) ----
const CONST = {
  GRID_COLS: 7, // 横の列数。
  VISIBLE_ROWS: 13, // 縦の可視行数(VIS_ROWS、自機追従スクロール)。
  STAMINA_MAX: 80, // スタミナの最大(強化で増える基準値)。
  DIG_COST: 1, // 1 マス掘るのに消費するスタミナ。
  ESCORT_EXTRA_COST: 1, // 女の子を 1 人以上同行中、行動ごとの追加スタミナ消費。
  HARD_ROCK_TAPS: 2, // 硬岩の掘削タップ数(掘削速度+ 強化で 1 に)。
  CAVEIN_DAMAGE: 20, // 落盤事故で減るスタミナ(自機が巻き込まれたとき)。
  // タイル種別の掘削タップ数(TILE_DIG_KEY と整合)。
  DIG_TAPS: { SOIL: 1, HARDROCK: 2 },
  UNSTABLE_DENSITY_LO: 0.08, // 浅層の不安定岩密度。
  UNSTABLE_DENSITY_HI: 0.22, // 深層の不安定岩密度。
  CORE_DEPTH: 30, // 最下層(最深の女の子を置く row)。一区切り目標。
  BASE_SEED: 58219, // 決定論シードの基底(diveCount を足して毎ダイブ変える)。
  LONGPRESS_MS: 320, // この時間以上 + 移動小 なら長押し(印)。
  TAP_MAX_MOVE: 18, // タップ/長押し判定の移動許容(px)。
  // 気配メーターの距離ヒート段階(マンハッタン距離の閾値)。解像度+ 強化で段階が細かくなる。
  SENSE_NEAR: 3, // これ以下 = すぐそば。
  SENSE_MID: 8, // これ以下 = ちかい。
  SENSE_FAR: 18, // これ以下 = とおい。これ超 = 気配あり(方向のみ)。
  // 強化ティアの深度ゲート(救った女の子の row でティア解放)。
  MID_TIER_DEPTH: 10, // 中層以深救出で mid ティア解放。
  DEEP_TIER_DEPTH: 20, // 深層救出で deep ティア解放。
  SENSOR_RADIUS: 2, // センサで一時可視化する不安定岩の範囲(マス)。
  LADDER_RISE: 4, // ハシゴで上がる段数(地表方向)。
};
// バランス計測 bot から係数を上書きできるよう公開(本番挙動は CONST の初期値で確定)。
if (typeof window !== "undefined") window.CONST = CONST;

const BEST_RESCUE_KEY = "saguri_best_rescue";
const BEST_DEPTH_KEY = "saguri_best_depth";
const HOWTO_KEY = "saguri_seen_howto";

// ---- DOM 参照 ----------------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const clueLayerEl = document.getElementById("clue-layer");
const hudEl = document.getElementById("hud");
const depthValEl = document.getElementById("depth-val");
const rescueValEl = document.getElementById("rescue-val");
const escortValEl = document.getElementById("escort-val");
const senseArrowEl = document.getElementById("sense-arrow");
const senseHeatEl = document.getElementById("sense-heat");
const staminaFillEl = document.getElementById("stamina-fill");
const staminaValEl = document.getElementById("stamina-val");
const staminaRailEl = document.querySelector(".stamina-rail");
const hudHintEl = document.getElementById("hud-hint");

const overlayEl = document.getElementById("overlay");
const panelEl = overlayEl.querySelector(".panel");
const ovTitleEl = document.getElementById("ov-title");
const ovSubEl = document.getElementById("ov-sub");
const ovHowtoEl = document.getElementById("ov-howto");
const ovFragmentEl = document.getElementById("ov-fragment");
const ovStockEl = document.getElementById("ov-stock");
const ovUpgradesEl = document.getElementById("ov-upgrades");
const ovActionEl = document.getElementById("ov-action");
const ovAction2El = document.getElementById("ov-action2");
const ovVersionEl = document.getElementById("ov-version");

const btnUpEl = document.getElementById("btn-up");
const btnDownEl = document.getElementById("btn-down");
const btnLeftEl = document.getElementById("btn-left");
const btnRightEl = document.getElementById("btn-right");
const btnFlagEl = document.getElementById("btn-flag");
const toolBarEl = document.getElementById("tool-bar");
const btnToolLadderEl = document.getElementById("btn-tool-ladder");
const btnToolSensorEl = document.getElementById("btn-tool-sensor");

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
}

// ---- 色補間(なごり/ともる踏襲) --------------------------------------
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
// screen: "title" / "howto" / "dive" / "shop" / "fail" / "clear" / "fragment"。
const G = {
  screen: "title",
  diveCount: 0, // 累積ダイブ数(= シードの揺らぎ)。
  seed: CONST.BASE_SEED,
  px: 3, // 自機の列(0..GRID_COLS-1)。
  py: 0, // 自機の行(0 = 地表)。
  stamina: CONST.STAMINA_MAX,
  staminaMax: CONST.STAMINA_MAX,
  dug: null, // Set("col,row") 掘削済みタイル(このダイブ限り)。
  flags: null, // Set("col,row") 印(旗)を立てたタイル(このダイブ限り)。
  digProgress: null, // Map("col,row" -> 残タップ数)。
  pendingCavein: null, // Map("col,row" -> true) 次手番で落ちる予約(真下を掘った不安定岩)。
  litSet: null, // Set("col,row") 地表から連結した掘削空洞(光の道)。掘削変化時のみ再計算。
  girls: null, // [{col,row,state}] state: "hidden"(未発見)/"following"(追従)/"rescued"(救出済)。
  escorting: 0, // 追従中の女の子数。
  rescued: 0, // このダイブで救出した数。
  rescuedDeepest: 0, // これまで(累積)に救った女の子の最深 row(ティアゲート判定)。
  points: 0, // 救出ポイント(強化通貨、永続)。
  appliedUpgrades: null, // 取得済み強化 id。
  upg: null, // 強化効果の集計。
  toolsLeft: null, // { ladder, support, sensor } ラン中の残使用回数。
  sensorReveal: null, // Set("col,row") センサで一時可視化中の不安定岩。
  clearedCore: false, // このダイブで最下層の女の子を救ったか(勝利条件)。
  busy: false, // overlay 遷移中などの入力ロック。
  maxDepthThisDive: 0,
  pendingFragment: null, // 救出で表示待ちの断章(地表帰還時にまとめて出す)。
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
function freshUpg() {
  return {
    staminaMaxAdd: 0,
    senseResAdd: 0,
    digSpeedAdd: 0,
    tools: { ladder: false, support: false, sensor: false },
  };
}
function recomputeUpg() {
  const u = freshUpg();
  for (const id of G.appliedUpgrades) {
    const def = UPGRADES.find((x) => x.id === id);
    if (!def) continue;
    for (const k in def.apply) {
      if (k === "tool") u.tools[def.apply[k]] = true;
      else u[k] += def.apply[k];
    }
  }
  G.upg = u;
  G.staminaMax = CONST.STAMINA_MAX + u.staminaMaxAdd;
}

// 効果適用ヘルパ。
function effDigTaps(tileVal) {
  const key = TILE_DIG_KEY[tileVal];
  let taps = CONST.DIG_TAPS[key] || 1;
  if (key === "HARDROCK") taps = Math.max(1, taps - G.upg.digSpeedAdd); // 掘削速度+。
  return taps;
}

// ---- ダイブ開始 --------------------------------------------------------
function startDive() {
  G.diveCount += 1;
  G.seed = CONST.BASE_SEED + G.diveCount;
  recomputeUpg();
  G.px = Math.floor(CONST.GRID_COLS / 2);
  G.py = 0;
  G.stamina = G.staminaMax;
  G.dug = new Set();
  G.flags = new Set();
  G.digProgress = new Map();
  G.pendingCavein = new Map();
  G.litSet = new Set();
  G.sensorReveal = new Set();
  // 女の子をこのダイブのシードで決定論配置(state=hidden)。
  // origRow = 発見前の元の深さ(ティアゲート判定 + 最下層=勝利判定に使う。col/row は追従で動く)。
  G.girls = girlPositions(G.seed).map((g) => ({
    col: g.col,
    row: g.row,
    origRow: g.row,
    state: "hidden",
  }));
  G.escorting = 0;
  G.rescued = 0;
  G.clearedCore = false;
  G.busy = false;
  G.maxDepthThisDive = 0;
  G.pendingFragment = null;
  // 道具の残使用回数(取得済みのみ)。
  G.toolsLeft = {
    ladder: G.upg.tools.ladder ? 1 : 0,
    support: G.upg.tools.support ? 1 : 0,
    sensor: G.upg.tools.sensor ? 3 : 0,
  };
  G.screen = "dive";
  hideOverlay();
  hudEl.hidden = false;
  clueLayerEl.hidden = false;
  camY = 0;
  recomputeLit();
  refreshToolBar();
  renderHud();
}

// ---- タイル参照(掘削済みは EMPTY) ------------------------------------
function tileAt(col, row) {
  if (col < 0 || col >= CONST.GRID_COLS || row < 0) return TILE.HARDROCK; // 範囲外は壁。
  if (G.dug && G.dug.has(col + "," + row)) return TILE.EMPTY;
  return tileType(col, row, G.seed);
}
// 掘削済み(空洞)か。
function isDug(col, row) {
  if (row <= 0) return true; // 地表は通れる空洞扱い(光源)。
  return !!(G.dug && G.dug.has(col + "," + row));
}

// ---- 手がかり数字: 周囲 8 近傍の不安定岩(落盤)数 ----------------------
// 掘って露出した「未掘削タイル面」に表示する。掘削済み空洞や地表は対象外。
function clueCount(col, row) {
  let n = 0;
  for (let dc = -1; dc <= 1; dc++)
    for (let dr = -1; dr <= 1; dr++) {
      if (dc === 0 && dr === 0) continue;
      // 元の地形(掘削前)の不安定岩を数える。掘っても下に岩があった事実は消えないが、
      // 掘削済み(EMPTY 化)した不安定岩はもう落盤源でないので数えない。
      const c = col + dc, r = row + dr;
      if (r < 0 || c < 0 || c >= CONST.GRID_COLS) continue;
      if (isDug(c, r)) continue; // 掘られた = もう岩は無い。
      if (tileType(c, r, G.seed) === TILE.UNSTABLE) n++;
    }
  return n;
}

// ある未掘削タイルが「露出している」= 上下左右いずれかの隣接が掘削済み空洞、か。
function isExposed(col, row) {
  if (row <= 0) return false;
  if (isDug(col, row)) return false; // 掘られた面には数字を出さない。
  const t = tileType(col, row, G.seed);
  if (t === TILE.GIRL) return false; // 女の子面には数字を出さない。
  const nb = [
    [col, row - 1],
    [col, row + 1],
    [col - 1, row],
    [col + 1, row],
  ];
  for (const [c, r] of nb) if (isDug(c, r)) return true;
  return false;
}

// ---- 安全連鎖開示(手がかり 0 の面から隣接 0 面を自動で露出させる) ------
// Minesweeper の 0 連鎖。掘った先が手がかり 0 だったら、隣接の未掘削で
// 不安定岩でない土も自動で掘り抜く(安全が連鎖的に確定するため)。
function floodSafe(startCol, startRow) {
  const stack = [[startCol, startRow]];
  const seen = new Set();
  let guard = 0;
  while (stack.length && guard < 400) {
    guard++;
    const [col, row] = stack.pop();
    const key = col + "," + row;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row <= 0) continue;
    if (clueCount(col, row) !== 0) continue; // 0 の面だけ連鎖を広げる。
    // この 0 面の周囲 8 近傍の未掘削・非危険タイルを自動で掘り抜く。
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const c = col + dc, r = row + dr;
        if (r <= 0 || c < 0 || c >= CONST.GRID_COLS) continue;
        if (isDug(c, r)) continue;
        const t = tileType(c, r, G.seed);
        if (t === TILE.UNSTABLE || t === TILE.HARDROCK || t === TILE.GIRL) continue;
        // 安全な土/空洞 → 掘り抜く(スタミナ消費なし=確定した安全の自動開示)。
        G.dug.add(c + "," + r);
        if (clueCount(c, r) === 0) stack.push([c, r]);
      }
  }
}

// ---- 光の道 BFS(地表からの掘削空洞の連結成分) ------------------------
// 掘削変化時のみ呼ぶ(毎フレーム不要)。地表(row 0)から上下左右に連結した
// 掘削済み空洞を litSet に集める。落盤で塞がれた区間は連結が切れ litSet から外れる=陰。
function recomputeLit() {
  const lit = new Set();
  const q = [];
  // 地表の自機列まわりを起点(地表は全列が空洞=光源)。
  for (let c = 0; c < CONST.GRID_COLS; c++) {
    // row 0 直下の掘削済み空洞を起点に積む。
    if (isDug(c, 1)) {
      const k = c + ",1";
      if (!lit.has(k)) {
        lit.add(k);
        q.push([c, 1]);
      }
    }
  }
  let guard = 0;
  while (q.length && guard < 5000) {
    guard++;
    const [col, row] = q.pop();
    const nb = [
      [col, row - 1],
      [col, row + 1],
      [col - 1, row],
      [col + 1, row],
    ];
    for (const [c, r] of nb) {
      if (r <= 0 || c < 0 || c >= CONST.GRID_COLS) continue;
      const k = c + "," + r;
      if (lit.has(k)) continue;
      if (!isDug(c, r)) continue; // 空洞だけが光を通す。
      lit.add(k);
      q.push([c, r]);
    }
  }
  G.litSet = lit;
}

// ---- 掘る(隣接タイルを 1 タップぶん掘削、ターン制) --------------------
function digAdjacent(col, row) {
  if (G.screen !== "dive" || G.busy) return;
  const dc = Math.abs(col - G.px);
  const dr = Math.abs(row - G.py);
  if (dc + dr !== 1) return; // 上下左右の隣接 1 マスのみ。
  if (col < 0 || col >= CONST.GRID_COLS || row < 0) return;
  const key = col + "," + row;
  const t = tileAt(col, row);

  if (t === TILE.EMPTY) {
    // 既に空洞 → 移動(掘る手数なし)。移動も 1 ターン消費。
    stepInto(col, row, false);
    return;
  }
  if (t === TILE.GIRL) {
    // 女の子に触れた → 掘って到達=発見、移動 → 発見処理。
    G.dug.add(key);
    discoverGirl(col, row);
    spendStamina(CONST.DIG_COST);
    stepInto(col, row, true);
    return;
  }

  // 掘削進行(タイルごと残タップ)。
  let remain = G.digProgress.get(key);
  if (remain === undefined) remain = effDigTaps(t);
  remain -= 1;
  spawnPopupAt(col, row, "・"); // 掘った手応え(打点)。
  spendStamina(CONST.DIG_COST);
  if (remain > 0) {
    G.digProgress.set(key, remain);
    renderHud();
    return;
  }
  // 掘り抜けた。
  G.digProgress.delete(key);
  G.dug.add(key);
  onTileBroken(col, row, t);
  stepInto(col, row, true);
}

// 不安定岩の「真下のタイル」を掘ったら、その不安定岩を次手番の落盤に予約する。
function onTileBroken(col, row, t) {
  // 掘った位置の真上が不安定岩なら、その岩の支えを失う = 次手番で落ちる。
  const aboveRow = row - 1;
  if (aboveRow >= 1 && !isDug(col, aboveRow) && tileType(col, aboveRow, G.seed) === TILE.UNSTABLE) {
    G.pendingCavein.set(col + "," + aboveRow, true);
  }
  // 不安定岩そのものを掘った場合は手がかり構造が変わるだけ(EMPTY 化済み)。
  void t;
}

// 掘った先へ前進(掘削後の移動)。dug が変わったので光の道・連鎖を更新。
function stepInto(col, row, terrainChanged) {
  // 移動先が手がかり 0 なら安全連鎖開示(掘り済みになっている前提でなく、
  // 移動先の周囲を 0 連鎖で広げる)。
  G.px = col;
  G.py = row;
  if (terrainChanged) {
    // 掘った面の手がかりが 0 なら安全連鎖開示。
    floodSafe(col, row);
    recomputeLit();
  }
  // 追従中の女の子を BFS で追従させる(掘った空洞を辿る)。
  advanceEscort();
  if (row === 0) {
    surfaceReturn();
    return;
  }
  // 移動も追従も無ければ、移動 1 ターンのスタミナ(掘らずに空洞へ移動した場合)。
  if (!terrainChanged) spendStamina(CONST.DIG_COST);
  if (G.escorting > 0) spendStamina(CONST.ESCORT_EXTRA_COST); // 追従中は消費増。
  renderHud();
  // 落盤予約があれば、この手番の終わりに落とす(「次の自分の手番で落ちる」)。
  resolveCaveins();
}

function spendStamina(n) {
  G.stamina = Math.max(0, G.stamina - n);
  if (G.stamina <= 0) checkFail();
}

// ---- 落盤の解決(予約された不安定岩を落とす) --------------------------
// 真下を掘られた不安定岩は次の手番の終わりに落下する。落下先(直下)に自機/女の子が
// いれば潰す(大ダメージ or 女の子ロスト)。落下後は掘った道を塞ぐ(EMPTY を岩で埋める)。
function resolveCaveins() {
  if (!G.pendingCavein || G.pendingCavein.size === 0) return;
  const fired = [];
  for (const k of Array.from(G.pendingCavein.keys())) {
    const [col, row] = k.split(",").map(Number);
    // 既に掘られている(プレイヤーが先に処理した)なら落盤しない。
    if (isDug(col, row)) {
      G.pendingCavein.delete(k);
      continue;
    }
    fired.push([col, row]);
    G.pendingCavein.delete(k);
  }
  if (fired.length === 0) return;

  let hitSelf = false;
  let buried = false;
  for (const [col, row] of fired) {
    // 支え木(道具)があれば 1 個だけ止める。
    if (G.toolsLeft.support > 0) {
      G.toolsLeft.support -= 1;
      refreshToolBar();
      showHint(TEXT.cueSupportUsed, false);
      continue;
    }
    const fallRow = row + 1; // 直下へ落ちる。
    // 落下先に自機。
    if (col === G.px && fallRow === G.py) {
      hitSelf = true;
    }
    // 落下先に追従中の女の子 → ロスト。
    for (const g of G.girls) {
      if (g.state === "following" && g.col === col && g.row === fallRow) {
        g.state = "lost";
        G.escorting = Math.max(0, G.escorting - 1);
      }
    }
    // 落盤は掘った道(直下の空洞)を塞ぐ = 掘削済み空洞を岩で埋める(dug から外す)。
    if (fallRow >= 1 && G.dug.has(col + "," + fallRow)) {
      G.dug.delete(col + "," + fallRow);
      buried = true;
    }
    // 不安定岩自体は落下後その場(元 row)に残土として埋まる扱い → 既に未掘削なのでそのまま。
    spawnPopupAt(col, row, "▼", "warn");
  }
  if (hitSelf) {
    G.stamina = Math.max(0, G.stamina - CONST.CAVEIN_DAMAGE);
    showHint(TEXT.cueCaveinWarn, true);
    spawnPopupAt(G.px, G.py, "－" + CONST.CAVEIN_DAMAGE, "warn");
  } else if (buried) {
    showHint(TEXT.cueCaveinBuried, true);
  }
  recomputeLit(); // 道が塞がれたので光の道を更新。
  renderHud();
  if (G.stamina <= 0) checkFail();
}

// ---- 女の子: 発見と追従 ------------------------------------------------
function discoverGirl(col, row) {
  for (const g of G.girls) {
    if (g.state === "hidden" && g.col === col && g.row === row) {
      g.state = "following";
      G.escorting += 1;
      showHint(TEXT.cueRescued + " — " + TEXT.cueEscortStart, false);
      spawnPopupAt(col, row, "！", "cue");
    }
  }
}

// 追従中の女の子を 1 歩、自機に近づける(掘った空洞を BFS で辿る)。
// 道が塞がれて経路が無ければその場で待機(掘り直しが要る)。
function advanceEscort() {
  if (G.escorting === 0) return;
  for (const g of G.girls) {
    if (g.state !== "following") continue;
    const next = bfsStep(g.col, g.row, G.px, G.py);
    if (next) {
      g.col = next[0];
      g.row = next[1];
      // 自機が地表に着いていれば、追従の女の子も地表に着いたら救出。
      if (g.row === 0) {
        rescueGirl(g);
      }
    } else {
      // 経路なし = 道が塞がれた。待機(掘り直しを促す)。
      showHint(TEXT.cueEscortBlocked, true);
    }
  }
}

// 掘った空洞(+地表)を辿って (sc,sr) から (tc,tr) へ 1 歩進む BFS。最初の 1 歩を返す。
function bfsStep(sc, sr, tc, tr) {
  if (sc === tc && sr === tr) return null;
  const start = sc + "," + sr;
  const goal = tc + "," + tr;
  const prev = new Map();
  const q = [[sc, sr]];
  const seen = new Set([start]);
  let guard = 0;
  let found = false;
  while (q.length && guard < 4000) {
    guard++;
    const [col, row] = q.shift();
    if (col === tc && row === tr) {
      found = true;
      break;
    }
    const nb = [
      [col, row - 1],
      [col, row + 1],
      [col - 1, row],
      [col + 1, row],
    ];
    for (const [c, r] of nb) {
      if (r < 0 || c < 0 || c >= CONST.GRID_COLS) continue;
      const k = c + "," + r;
      if (seen.has(k)) continue;
      // 通れる = 掘削済み空洞 or 地表 or 目標(自機)位置。
      if (!isDug(c, r) && !(c === tc && r === tr)) continue;
      seen.add(k);
      prev.set(k, col + "," + row);
      q.push([c, r]);
    }
  }
  if (!found) return null;
  // goal から逆に辿って start の次の 1 歩を得る。
  let cur = goal;
  let step = null;
  while (cur && cur !== start) {
    step = cur;
    cur = prev.get(cur);
  }
  if (!step) return null;
  return step.split(",").map(Number);
}

function rescueGirl(g) {
  if (g.state === "rescued") return;
  g.state = "rescued";
  G.escorting = Math.max(0, G.escorting - 1);
  G.rescued += 1;
  G.points += 1;
  // ティアゲート: 救った女の子の元の深さ(origRow)を累積記録(深層救出で上位ティア解放)。
  // 救出時点の row は 0 だが、ティア判定はもとの深さで行う(浅場ピストン無効化)。
  if (g.origRow !== undefined && g.origRow > G.rescuedDeepest) G.rescuedDeepest = g.origRow;
  // 断章を 1 行(救出累計 - 1 を index に、循環)。
  const idx = (getInt(BEST_RESCUE_KEY) + G.rescued - 1) % FRAGMENTS.length;
  G.pendingFragment = FRAGMENTS[idx];
  // 最下層(目標)の女の子なら勝利フラグ。
  if (g.origRow !== undefined && g.origRow >= CONST.CORE_DEPTH) G.clearedCore = true;
}

// ---- 地表帰還 = 精算 + 強化ショップ ------------------------------------
function surfaceReturn() {
  // この時点で自機は地表(row 0)。追従中の女の子も地表に着いていれば救出。
  for (const g of G.girls) {
    if (g.state === "following" && g.row === 0) rescueGirl(g);
  }
  // best 記録。
  const totalRescue = getInt(BEST_RESCUE_KEY) + G.rescued;
  setInt(BEST_RESCUE_KEY, totalRescue);
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  // 救出があれば断章 → ショップ。最下層救出なら勝利演出。
  if (G.clearedCore) {
    showClear();
    return;
  }
  if (G.pendingFragment) {
    showFragment(G.pendingFragment, () => showShop());
    G.pendingFragment = null;
    return;
  }
  showShop();
}

// ---- 失敗(スタミナ 0 で地中) -----------------------------------------
function checkFail() {
  if (G.stamina <= 0 && G.py > 0 && G.screen === "dive") {
    // 未救出(同行中)の女の子を失う(メタ強化資産=points/appliedUpgrades は残る)。
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
  panelEl.classList.remove("shop-mode");
  ovTitleEl.hidden = true;
  ovTitleEl.classList.remove("small-title");
  ovSubEl.hidden = true;
  ovHowtoEl.hidden = true;
  ovHowtoEl.innerHTML = "";
  ovFragmentEl.hidden = true;
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
  clueLayerEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.title;
  ovTitleEl.hidden = false;
  const br = getInt(BEST_RESCUE_KEY);
  const bd = getInt(BEST_DEPTH_KEY);
  ovSubEl.textContent =
    TEXT.bestRescuePrefix + br + TEXT.bestRescueSuffix + "　" +
    TEXT.bestDepthPrefix + bd + TEXT.bestDepthSuffix;
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
  if (!seenHowto()) showHowto("start");
  else startDive();
}

function showHowto(returnTo) {
  G.screen = "howto";
  hudEl.hidden = true;
  clueLayerEl.hidden = true;
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

// 救出の断章を 1 行表示してから次へ(地表帰還時)。
function showFragment(text, next) {
  G.screen = "fragment";
  hudEl.hidden = true;
  clueLayerEl.hidden = true;
  resetOverlayParts();
  ovFragmentEl.textContent = text;
  ovFragmentEl.hidden = false;
  ovActionEl.textContent = TEXT.howtoBack === "もどる" ? "つづける" : "つづける";
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => next();
  showOverlay();
}

// ---- 基地ショップ(救出ポイントで買い切り、深度ティアゲート) -----------
function showShop() {
  G.screen = "shop";
  hudEl.hidden = true;
  clueLayerEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.shopTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  if (G.points === 0 && (!G.appliedUpgrades || G.appliedUpgrades.length === 0)) {
    ovSubEl.textContent = TEXT.shopNonePrefix;
    ovSubEl.hidden = false;
  }
  ovAction2El.textContent = TEXT.shopSkip;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => startDive();
  panelEl.classList.add("shop-mode");
  renderShop();
  showOverlay();
}

function renderShop() {
  // ポイント在庫表示。
  ovStockEl.innerHTML = "";
  ovStockEl.hidden = false;
  const span = document.createElement("span");
  span.className = "stock-pt";
  const ico = document.createElement("span");
  ico.className = "stock-ico";
  ico.textContent = "P";
  const num = document.createElement("span");
  num.textContent = G.points;
  span.appendChild(ico);
  span.appendChild(num);
  const lbl = document.createElement("span");
  lbl.className = "stock-lbl";
  lbl.textContent = TEXT.shopStockLabel;
  span.appendChild(lbl);
  ovStockEl.appendChild(span);

  // 強化一覧(縦リスト)。全 UPGRADES を出し、状態で見た目を分ける。
  ovUpgradesEl.innerHTML = "";
  ovUpgradesEl.hidden = false;
  for (const u of UPGRADES) {
    const owned = G.appliedUpgrades.includes(u.id);
    const unlocked = upgradeUnlocked(u, G.rescuedDeepest);
    const afford = upgradeCanAfford(u, G.points);
    const buyable = !owned && unlocked && afford;
    const el = buildShopRow(u, { owned, unlocked, afford, buyable });
    if (buyable) {
      el.onclick = () => {
        G.points -= u.cost;
        G.appliedUpgrades.push(u.id);
        renderShop();
      };
    }
    ovUpgradesEl.appendChild(el);
  }
}

function buildShopRow(u, st) {
  const el = document.createElement("div");
  el.className = "shop-row";
  if (st.owned) el.classList.add("owned");
  else if (st.buyable) el.classList.add("buyable");
  else el.classList.add("locked");

  const tierEl = document.createElement("span");
  tierEl.className = "upg-tier " + u.tier;
  tierEl.textContent = u.tier === "near" ? "浅" : u.tier === "mid" ? "中" : "深";

  const body = document.createElement("div");
  body.className = "shop-body";
  const nameEl = document.createElement("div");
  nameEl.className = "upg-name";
  nameEl.textContent = u.name;
  const descEl = document.createElement("div");
  descEl.className = "upg-desc";
  descEl.textContent = st.unlocked ? u.desc : TEXT.shopLockedTier;
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
    costEl.textContent = "P" + u.cost;
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

function showFail() {
  G.screen = "fail";
  hudEl.hidden = true;
  clueLayerEl.hidden = true;
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
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
  clueLayerEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.clearTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovSubEl.textContent = TEXT.clearSub;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.again;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => showShop(); // 勝利後も強化を選んでエンドレス継続。
  showOverlay();
}

// ---- 印(旗): 長押し / 印ボタンで隣接の危険マスに付ける --------------
function toggleFlag(col, row) {
  if (G.screen !== "dive" || G.busy) return;
  if (col < 0 || col >= CONST.GRID_COLS || row < 1) return;
  if (isDug(col, row)) return; // 掘られた面には印を付けない。
  const key = col + "," + row;
  if (G.flags.has(key)) G.flags.delete(key);
  else G.flags.add(key);
}
// 印ボタン: 自機の真下(最も危険を読みたい方向)を優先、無ければ周囲未掘削に付ける。
function flagButton() {
  if (G.screen !== "dive" || G.busy) return;
  // 自機の上下左右で未掘削の面のうち、印が無いものに付ける(下優先)。
  const cand = [
    [G.px, G.py + 1],
    [G.px - 1, G.py],
    [G.px + 1, G.py],
    [G.px, G.py - 1],
  ];
  for (const [c, r] of cand) {
    if (r < 1) continue;
    if (c < 0 || c >= CONST.GRID_COLS) continue;
    if (isDug(c, r)) continue;
    toggleFlag(c, r);
    return;
  }
}

// ---- 道具(ハシゴ / センサ) -------------------------------------------
function useLadder() {
  if (G.screen !== "dive" || G.busy) return;
  if (G.toolsLeft.ladder <= 0) {
    showHint(TEXT.cueNoStamina, true);
    return;
  }
  G.toolsLeft.ladder -= 1;
  // 地表方向へ LADDER_RISE 段、空洞を掘り抜いて上がる(撤退の保険)。
  const targetRow = Math.max(0, G.py - CONST.LADDER_RISE);
  for (let r = G.py - 1; r >= targetRow; r--) {
    if (r >= 1) G.dug.add(G.px + "," + r);
  }
  G.py = targetRow;
  recomputeLit();
  floodSafe(G.px, G.py);
  advanceEscort();
  refreshToolBar();
  showHint(TEXT.cueLadderUsed, false);
  if (G.py === 0) {
    surfaceReturn();
    return;
  }
  renderHud();
}
function useSensor() {
  if (G.screen !== "dive" || G.busy) return;
  if (G.toolsLeft.sensor <= 0) {
    showHint(TEXT.cueNoStamina, true);
    return;
  }
  G.toolsLeft.sensor -= 1;
  // 周囲 SENSOR_RADIUS の不安定岩を一時可視化。
  G.sensorReveal = new Set();
  const rad = CONST.SENSOR_RADIUS;
  for (let dc = -rad; dc <= rad; dc++)
    for (let dr = -rad; dr <= rad; dr++) {
      const c = G.px + dc, r = G.py + dr;
      if (r < 1 || c < 0 || c >= CONST.GRID_COLS) continue;
      if (!isDug(c, r) && tileType(c, r, G.seed) === TILE.UNSTABLE) {
        G.sensorReveal.add(c + "," + r);
      }
    }
  refreshToolBar();
  showHint(TEXT.cueSensorUsed, false);
  // センサの可視化は数秒で消える。
  if (window.__sensorTimer) clearTimeout(window.__sensorTimer);
  window.__sensorTimer = setTimeout(() => {
    G.sensorReveal = new Set();
  }, 4000);
}
// 道具バー表示を取得状況で切り替える。
function refreshToolBar() {
  if (!G.upg) {
    toolBarEl.hidden = true;
    return;
  }
  const hasLadder = G.upg.tools.ladder;
  const hasSensor = G.upg.tools.sensor;
  btnToolLadderEl.hidden = !hasLadder;
  btnToolSensorEl.hidden = !hasSensor;
  if (hasLadder) btnToolLadderEl.textContent = "ハシゴ" + (G.toolsLeft.ladder > 0 ? "" : "×");
  if (hasSensor) btnToolSensorEl.textContent = "センサ" + (G.toolsLeft.sensor > 0 ? "" : "×");
  toolBarEl.hidden = !(hasLadder || hasSensor);
}

// ---- HUD レンダリング(DOM) --------------------------------------------
function renderHud() {
  depthValEl.textContent = TEXT.depthPrefix + G.py + TEXT.depthSuffix;
  rescueValEl.textContent = G.rescued;
  escortValEl.textContent = G.escorting;
  const ratio = Math.max(0, Math.min(1, G.stamina / G.staminaMax));
  staminaFillEl.style.height = ratio * 100 + "%";
  staminaValEl.textContent = Math.round(G.stamina);
  const low = ratio < 0.25;
  staminaRailEl.classList.toggle("warn", low);
  if (G.py > (G.maxDepthThisDive || 0)) G.maxDepthThisDive = G.py;
  renderSense();
  renderClues();
}

// 気配メーター: 最寄りの hidden な女の子への方向(矢印) + 距離ヒート。
// 解像度+ 強化で段階閾値が緩む(より遠くから「ちかい」と分かる)。
function renderSense() {
  let best = null;
  let bestD = Infinity;
  for (const g of G.girls) {
    if (g.state !== "hidden") continue;
    const d = Math.abs(g.col - G.px) + Math.abs(g.row - G.py);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (!best) {
    senseArrowEl.textContent = "・";
    senseHeatEl.textContent = TEXT.senseNone;
    senseHeatEl.className = "sense-heat";
    return;
  }
  // 方向矢印(主成分)。
  const dx = best.col - G.px;
  const dy = best.row - G.py;
  let arrow = "・";
  if (Math.abs(dx) > Math.abs(dy)) arrow = dx > 0 ? "▶" : "◀";
  else if (dy !== 0 || dx !== 0) arrow = dy > 0 ? "▼" : "▲";
  senseArrowEl.textContent = arrow;
  // 距離ヒート(解像度+ で閾値拡大)。
  const res = G.upg ? G.upg.senseResAdd : 0;
  const near = CONST.SENSE_NEAR + res;
  const mid = CONST.SENSE_MID + res * 2;
  let heat, cls;
  if (bestD <= near) {
    heat = TEXT.senseNear;
    cls = "heat-near";
  } else if (bestD <= mid) {
    heat = TEXT.senseMid;
    cls = "heat-mid";
  } else {
    heat = TEXT.senseFar;
    cls = "heat-far";
  }
  senseHeatEl.textContent = heat;
  senseHeatEl.className = "sense-heat " + cls;
}

// ---- 手がかり数字 chip(DOM、canvas に焼かない) -----------------------
// 露出した未掘削タイル面に「周囲8近傍の落盤数」を白文字+黒縁の chip で重ねる。
// 0 は安全連鎖で開いているので基本出ないが、念のため "0" も淡色で出す。
function renderClues() {
  if (G.screen !== "dive") {
    clueLayerEl.innerHTML = "";
    return;
  }
  clueLayerEl.innerHTML = "";
  const rows = Math.ceil(H / tile) + 2;
  const startRow = Math.floor(camY) - 1;
  for (let ri = 0; ri < rows; ri++) {
    const row = startRow + ri;
    if (row < 1) continue;
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      if (!isExposed(col, row)) continue;
      const n = clueCount(col, row);
      const sx = col * tile + tile / 2;
      const sy = (row - camY) * tile + tile / 2;
      const chip = document.createElement("div");
      chip.className = "clue clue-" + Math.min(n, 8);
      chip.style.left = sx + "px";
      chip.style.top = sy + "px";
      chip.textContent = String(n);
      clueLayerEl.appendChild(chip);
    }
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
  }, 1600);
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
  setTimeout(() => p.remove(), 850);
}

// ---- 入力(タップ = 掘る / 長押し = 印) --------------------------------
let pdStart = 0;
let pdX = 0;
let pdY = 0;
let pdMoved = 0;
let pdActive = false;
let lpTimer = null;
let lpFired = false;

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
    lpFired = false;
    pdStart = performance.now();
    pdX = e.clientX;
    pdY = e.clientY;
    pdMoved = 0;
    if (lpTimer) clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      if (pdActive && pdMoved < CONST.TAP_MAX_MOVE) {
        lpFired = true;
        const { col, row } = screenToTile(pdX, pdY);
        // 長押し位置が自機の隣接未掘削なら印を付ける。
        // 隣接でなくても、読んだ危険マスには印を付けられる。
        toggleFlag(col, row);
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
  if (lpFired) return; // 長押し(印)済み → タップ処理しない。
  if (pdMoved >= CONST.TAP_MAX_MOVE) return;
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

// ---- 十字キー + 印ボタン + 道具(canvas 外 DOM、タップと併用) ----------
function digDir(dc, dr) {
  if (G.screen !== "dive" || G.busy) return;
  digAdjacent(G.px + dc, G.py + dr);
}
btnUpEl.addEventListener("click", () => digDir(0, -1));
btnDownEl.addEventListener("click", () => digDir(0, 1));
btnLeftEl.addEventListener("click", () => digDir(-1, 0));
btnRightEl.addEventListener("click", () => digDir(1, 0));
btnFlagEl.addEventListener("click", () => flagButton());
btnToolLadderEl.addEventListener("click", () => useLadder());
btnToolSensorEl.addEventListener("click", () => useSensor());

// ---- タイル粒度ライティング(per-pixel 禁止) --------------------------
// 明るい断面。各可視タイルの明度 = 地の明度(深度帯) + 光の道(litSet にあれば暖色加算)。
// 掘削空洞のうち地表連結成分(litSet)は明、塞がれた区間は陰。
function bandColor(row) {
  const surf = hexToRgb(PALETTE.surface.bg);
  const sh = hexToRgb(PALETTE.shallow.bg);
  const md = hexToRgb(PALETTE.mid.bg);
  const dp = hexToRgb(PALETTE.deep.bg);
  if (row <= 0) return surf;
  if (row <= 9) return mixRgb(surf, sh, Math.min(1, row / 3));
  if (row <= 19) return mixRgb(sh, md, (row - 9) / 10);
  return mixRgb(md, dp, Math.min(1, (row - 19) / 11));
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (G.screen !== "dive") {
    ctx.fillStyle = "#10131f";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // カメラ追従: 自機を画面のやや上(行 4 付近)に。地表は上端で止める。
  const targetCam = Math.max(0, G.py - 4);
  camY += (targetCam - camY) * 0.18;
  if (typeof window !== "undefined") window.__camY = camY;

  const rows = Math.ceil(H / tile) + 2;
  const startRow = Math.floor(camY) - 1;
  const litCol = hexToRgb(PALETTE.light);
  const shade = hexToRgb(PALETTE.shallow.shade);

  for (let ri = 0; ri < rows; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const sy = (row - camY) * tile;
    for (let col = 0; col < CONST.GRID_COLS; col++) {
      const sx = col * tile;
      const t = tileAt(col, row);
      let base = bandColor(row);

      const dugHere = isDug(col, row) || row <= 0;
      const lit = G.litSet && G.litSet.has(col + "," + row);

      if (row <= 0) {
        // 地表(明るい安全地帯)。
        base = hexToRgb(PALETTE.surface.bg);
      } else if (dugHere) {
        // 掘った空洞。光の道(地表連結)なら暖色で明るく、塞がれていれば陰。
        if (lit) base = mixRgb(base, litCol, 0.45);
        else base = mixRgb(base, shade, 0.55); // 陰(命綱が切れた区間)。
      } else if (t === TILE.HARDROCK) {
        base = mixRgb(base, [120, 124, 136], 0.4); // 硬岩は明るめの質量。
      } else if (t === TILE.SOIL || t === TILE.UNSTABLE || t === TILE.GIRL) {
        base = mixRgb(base, shade, 0.22); // 未掘削の土は少し陰る質量。
      }

      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(sx, sy, tile + 1, tile + 1);

      // タイル境界の薄い格子(断面の読みやすさ)。
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tile, tile);

      // 不安定岩(未掘削): センサ可視化中のみ赤錆の縁で表示(通常は手がかり数字から推理する)。
      const showUnstable =
        t === TILE.UNSTABLE &&
        !dugHere &&
        (G.sensorReveal.has(col + "," + row));
      if (showUnstable) {
        const u = hexToRgb(PALETTE.unstable);
        ctx.strokeStyle = `rgb(${u[0]},${u[1]},${u[2]})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(sx + 3, sy + 3, tile - 6, tile - 6);
      }

      // 落盤予約(真下を掘った不安定岩)を朱で予告(危険の可視化)。
      if (G.pendingCavein && G.pendingCavein.has(col + "," + row)) {
        const f = hexToRgb(PALETTE.flag);
        ctx.strokeStyle = `rgb(${f[0]},${f[1]},${f[2]})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(sx + 2, sy + 2, tile - 4, tile - 4);
      }

      // 印(旗): 朱の三角。
      if (G.flags && G.flags.has(col + "," + row)) {
        const f = hexToRgb(PALETTE.flag);
        ctx.fillStyle = `rgb(${f[0]},${f[1]},${f[2]})`;
        ctx.beginPath();
        ctx.moveTo(sx + tile * 0.32, sy + tile * 0.26);
        ctx.lineTo(sx + tile * 0.7, sy + tile * 0.4);
        ctx.lineTo(sx + tile * 0.32, sy + tile * 0.54);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgb(${f[0]},${f[1]},${f[2]})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + tile * 0.32, sy + tile * 0.26);
        ctx.lineTo(sx + tile * 0.32, sy + tile * 0.74);
        ctx.stroke();
      }
    }
  }

  // 女の子(暖金の自発光。背景が暗いほど強く光る = 前景視認性)。
  for (const g of G.girls) {
    if (g.state === "rescued" || g.state === "lost") continue;
    drawGirl(g);
  }

  // 自機(掘削者) = 常時最明 + 1px 縁。
  const cx = G.px * tile + tile / 2;
  const cy = (G.py - camY) * tile + tile / 2;
  drawMiner(cx, cy);
}

function drawGirl(g) {
  const gx = g.col * tile + tile / 2;
  const gy = (g.row - camY) * tile + tile / 2;
  if (gy < -tile || gy > H + tile) return;
  // 発見前(hidden)は微かな自発光のみ(気配)。発見後は強く光る。
  const strong = g.state === "following";
  const col = hexToRgb(PALETTE.girl);
  const r = tile * 0.3;
  const glow = ctx.createRadialGradient(gx, gy, 1, gx, gy, r * 2);
  const a0 = strong ? 0.95 : 0.5;
  glow.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a0})`);
  glow.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},${a0 * 0.4})`);
  glow.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(gx, gy, r * 2, 0, Math.PI * 2);
  ctx.fill();
  // 本体(暖金の小円 + 細い縁)。
  ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
  ctx.beginPath();
  ctx.arc(gx, gy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(60,40,20,0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawMiner(cx, cy) {
  const r = tile * 0.32;
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.8);
  g.addColorStop(0, "rgba(255,236,196,0.95)");
  g.addColorStop(0.6, "rgba(244,184,96,0.5)");
  g.addColorStop(1, "rgba(244,184,96,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  // 本体(暗いシルエット + 1px 縁で輪郭確保 = 明背景でもコントラスト)。
  ctx.fillStyle = "#2a1c12";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,240,200,0.95)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fff0c8";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

// ---- メインループ ------------------------------------------------------
// ターン制なのでゲーム進行はイベント駆動。tick は描画 + 手がかり chip の追従だけ。
function tick(t) {
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  elapsed += dt;
  render();
  // カメラがスクロールするので手がかり chip の位置を毎フレーム追従させる。
  if (G.screen === "dive") renderClues();
  requestAnimationFrame(tick);
}

// ---- 起動 --------------------------------------------------------------
G.appliedUpgrades = [];
G.upg = freshUpg();
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
