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
const VERSION = "v0.2.1";

// ---- CONSTANTS(lead 確定値。単一ブロックに集約。playtester 実測で微調整は可だが構造不変) ----
const CONST = {
  GRID_COLS: 15, // 裏庭 WIDTH(dungeon_info ID0)。横の列数。
  DEPTH_ROWS: 15, // 裏庭 FLOOR。地表行(row 0)とは別に深度 1..15。
  STAMINA_MAX: 100, // スタミナ最大(普段これで動く)。
  HP_MAX: 30, // 体力最大(スタミナ切れ後の緊張ゾーン)。
  DIG_SOIL: 1, // 土の掘削手数。
  DIG_HARD: 2, // 硬土の掘削手数。硬岩は掘れない。
  SP_PER_ACTION: 1, // 移動 1 / 掘り 1 手ごとに 1 消費(SP 切れなら HP が減る)。
  // タイル種別の掘削手数(TILE_DIG_KEY と整合)。
  DIG_TAPS: { SOIL: 1, HARD: 2 },
  GIRL_COUNT: 1, // 縦切りは 1 人(裏庭 5 人は拡張フェーズ)。
  BASE_SEED: 41027, // 決定論シードの基底(Math.random/Date.now 厳禁)。
  VISIBLE_RADIUS: 2, // 自機周囲この半径を可視化(fog を晴らす)。
  LONGPRESS_MS: 320, // 予備(将来の長押し操作用、現状未使用)。
  TAP_MAX_MOVE: 18, // タップ判定の移動許容(px)。
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
    "深くに女の子が埋まっている。掘り当てると付いてくる。地表まで連れ帰れば救出成功。",
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
  failTitle: "力尽きた",
  failSub: "地表へ戻れなかった",
  retry: "もういちど",
  clearTitle: "救出成功",
  clearSub: "女の子を地表へ連れ帰った",
  again: "もういちど潜る",
  bestDepthPrefix: "最深 ",
  bestDepthSuffix: " 層",
  bestRescuePrefix: "救出 ",
  bestRescueSuffix: " 人",
};

// ---- DOM 参照 ----------------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const hudEl = document.getElementById("hud");
const depthValEl = document.getElementById("depth-val");
const rescueValEl = document.getElementById("rescue-val");
const exploreValEl = document.getElementById("explore-val");
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

// ---- canvas / 描画状態 -------------------------------------------------
let DPR = 1;
let W = 0;
let H = 0;
let lastT = 0;
let tile = 28; // タイル一辺(px)。resize で W/GRID_COLS から決める。
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
  girl: null, // {col,row,state} state: "hidden"/"following"/"rescued"。
  rescued: 0, // このダイブで救出した数。
  maxDepthThisDive: 0,
  busy: false, // overlay 遷移中などの入力ロック。
  enteredHpZone: false, // スタミナ切れ通知を一度だけ出すフラグ。
  totalTiles: 0, // 探索率の分母(GRID_COLS * DEPTH_ROWS)。
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

// ---- ダイブ開始 --------------------------------------------------------
function startDive() {
  G.seed = CONST.BASE_SEED; // 縦切りは固定(決定論再挑戦)。
  G.px = Math.floor(CONST.GRID_COLS / 2);
  G.py = 0;
  G.stamina = CONST.STAMINA_MAX;
  G.hp = CONST.HP_MAX;
  G.dug = new Set();
  G.digProgress = new Map();
  G.seen = new Set();
  const gp = girlPositions(G.seed)[0];
  G.girl = { col: gp.col, row: gp.row, origRow: gp.row, state: "hidden" };
  G.rescued = 0;
  G.maxDepthThisDive = 0;
  G.busy = false;
  G.enteredHpZone = false;
  G.totalTiles = CONST.GRID_COLS * CONST.DEPTH_ROWS;
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

// ---- 行動 1 回ぶんのコスト(スタミナ → 体力の二段) --------------------
// SP がある間は SP を 1 減らす。SP が 0 なら HP を 1 減らす(二段ゲージの核)。
// HP が 0 になったら力尽き。
function spendAction() {
  if (G.stamina > 0) {
    G.stamina = Math.max(0, G.stamina - CONST.SP_PER_ACTION);
    if (G.stamina === 0 && !G.enteredHpZone) {
      G.enteredHpZone = true;
      showHint(TEXT.cueHpZone, true);
    }
  } else {
    G.hp = Math.max(0, G.hp - CONST.SP_PER_ACTION);
  }
}

// ---- 入力 = 方向 1 つを解決(移動 or 掘り) ----------------------------
// dc,dr は -1/0/1 のいずれか(上下左右の単位方向)。
// ①空間 → そのマスへ移動(1 行動) ②土/硬土 → 1 手掘る(1 行動、規定手数で空間化し前進)
// ③硬岩 → 無反応(軽フィードバック)。上移動は 1 マスだけ(足場がある時)。
function act(dc, dr) {
  if (G.screen !== "dive" || G.busy) return;
  const col = G.px + dc;
  const row = G.py + dr;
  if (col < 0 || col >= CONST.GRID_COLS) return;
  if (row < 0) return; // 地表より上は無い。

  // 上移動 = 掘った縦坑/階段を 1 マスよじ登る(「掘った跡が帰り道」の核)。真上が空間の時だけ。
  // 上掘りは不可(土を上へは掘れない=はしご未実装)。1 行動で 1 マスのみ(連続上昇不可)。
  // 設計判断(重力解決の順序、implementer 裁量): 上移動は意図的なクライム = この 1 歩は重力で
  // 引き戻さない(ledge を掴んだ扱い)。重力は横移動・下掘り・落下の後にだけ作用させる。
  // こうしないと単軸移動 + 全重力では掘った縦坑を登れず地表へ戻れない(= 全回復の撤退ループが
  // 成立しない)ため。「上移動は 1 マスだけ」のスロットルは 1 行動 1 マスで担保。
  if (dr === -1) {
    if (!isSpace(col, row)) return; // 真上が固い = 登れない(上掘り不可)。
    moveTo(col, row, false, true); // noGravity = true。
    return;
  }

  const t = tileAt(col, row);
  if (t === TILE.NONE) {
    // 空間 → 移動。
    moveTo(col, row);
    return;
  }
  if (t === TILE.ROCK) {
    // 硬岩は掘れない(軽フィードバック)。
    showHint(TEXT.cueRockHit, false);
    spawnPopupAt(col, row, "×", "warn");
    playSfx("blocked");
    return;
  }
  // 土 / 硬土 / 女の子 → 掘る。
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
  if (t === TILE.GIRL) discoverGirl(col, row);
  // 横/下方向に掘ったらそのマスへ前進(原作: 土なら自動で掘って進む)。掘りで行動コストは
  // 払い済みなので、前進では二重に取らない(costPaid=true)。
  if (dr === 1 || dc !== 0) {
    moveTo(col, row, true);
  } else {
    // 真上を掘る経路は上で弾いているのでここは来ない。保険で再描画。
    revealAround();
    renderHud();
    checkFail();
  }
}

function digTaps(t) {
  const k = TILE_DIG_KEY[t];
  return CONST.DIG_TAPS[k] || 1;
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
  advanceGirl();
  if (G.py === 0) {
    surfaceReturn();
    return;
  }
  if (G.py > G.maxDepthThisDive) G.maxDepthThisDive = G.py;
  renderHud();
  checkFail();
}

// 自機の重力落下(足元が空間の間、底まで落ちる)。落下はコスト無し(原作の落下と同様)。
// 地表(row 0)は安全な地面 = 立てる帰還地点なので重力は作用しない(掘った縦坑へ吸い込まれない)。
function applyGravity() {
  if (G.py <= 0) return; // 地表に立っている間は落ちない。
  let guard = 0;
  while (guard < CONST.DEPTH_ROWS + 2) {
    guard++;
    const below = G.py + 1;
    if (below > CONST.DEPTH_ROWS) break; // 底。
    if (isSpace(G.px, below)) {
      G.py = below;
      if (G.py > G.maxDepthThisDive) G.maxDepthThisDive = G.py;
    } else break;
  }
}

// ---- 女の子: 発見と追従 ------------------------------------------------
function discoverGirl(col, row) {
  const g = G.girl;
  if (g && g.state === "hidden" && g.col === col && g.row === row) {
    g.state = "following";
    showHint(TEXT.cueGirlFound, false);
    spawnPopupAt(col, row, "！", "cue");
    playSfx("found");
  }
}

// 追従中の女の子を 1 歩、自機へ近づける(掘った空洞を BFS で辿る)→ そのあと重力で落とす。
// 経路が無ければ(道が塞がれた)その場で待機し、掘り直しを促す。
function advanceGirl() {
  const g = G.girl;
  if (!g || g.state !== "following") return;
  // 自機と同マス(発見直後など)はまだ寄せる必要がない。bfsStep が同点 null を返すのを
  // 「はぐれた(経路なし)」と取り違えて cueGirlBlocked を出すのを抑止する(発見演出の直後に
  // 矛盾警告で上書きしない)。
  if (g.col === G.px && g.row === G.py) return;
  // 自機の 1 つ手前(直前にいた経路上のマス)へ寄せる: BFS で自機までの最初の 1 歩。
  const next = bfsStep(g.col, g.row, G.px, G.py);
  if (next) {
    const climbedUp = next[1] < g.row; // 自機へ向かう一歩が上向き = 縦坑のクライム。
    g.col = next[0];
    g.row = next[1];
    // 女の子にも重力(足元が空間なら落ちる)。ただし自機を追って縦坑を登る一歩は
    // 「掘った空洞を辿って一緒に地上へ」(原作仕様)の意図的クライムなので引き戻さない
    // (自機の上移動が noGravity なのと同じ責務)。これが無いと中空の縦坑で毎手 gr が
    // 落ち戻り、女の子が地表まで追従できない(発見後ずっと底に張り付く)。
    if (!climbedUp) {
      let guard = 0;
      while (guard < CONST.DEPTH_ROWS + 2) {
        guard++;
        const below = g.row + 1;
        if (below > CONST.DEPTH_ROWS) break;
        if (isSpace(g.col, below) && !(g.col === G.px && below === G.py)) {
          // 自機の真上には乗らない(同じマスへ落ちない)。自機がいるなら止まる。
          g.row = below;
        } else break;
      }
    }
    if (g.row === 0) rescueGirl(g);
  } else {
    showHint(TEXT.cueGirlBlocked, true);
  }
}

// 掘った空間(+地表)を辿って (sc,sr) から (tc,tr) へ 1 歩進む BFS。最初の 1 歩を返す。
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
      if (r > CONST.DEPTH_ROWS) continue;
      const k = c + "," + r;
      if (seen.has(k)) continue;
      // 通れる = 空間(掘った跡 or 元空間) or 地表 or 目標(自機)位置。
      if (!isSpace(c, r) && !(c === tc && r === tr)) continue;
      seen.add(k);
      prev.set(k, col + "," + row);
      q.push([c, r]);
    }
  }
  if (!found) return null;
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
  G.rescued += 1;
}

// ---- 地表帰還 = 全回復(撤退の報酬) -----------------------------------
function surfaceReturn() {
  // 追従中の女の子は自機の 1 マス後ろを辿っている。自機が地表に着いたら、女の子も
  // 残りの帰り道を歩いて地表へ上がりきる(掘った縦坑を 1 歩ずつ詰める)。
  if (G.girl && G.girl.state === "following") {
    let guard = 0;
    while (G.girl.state === "following" && G.girl.row > 0 && guard < CONST.DEPTH_ROWS + 4) {
      guard++;
      const next = bfsStep(G.girl.col, G.girl.row, G.px, G.py);
      if (!next) break; // 道が塞がれていて上がれない。
      G.girl.col = next[0];
      G.girl.row = next[1];
      if (G.girl.row === 0) rescueGirl(G.girl);
    }
  }
  // best 記録。
  if (G.maxDepthThisDive > getInt(BEST_DEPTH_KEY)) setInt(BEST_DEPTH_KEY, G.maxDepthThisDive);
  // 救出して地表 = 縦切りの一区切り(勝利演出)。
  if (G.rescued > 0 && G.girl && G.girl.state === "rescued") {
    setInt(RESCUE_KEY, getInt(RESCUE_KEY) + G.rescued);
    showClear();
    return;
  }
  // 救出前の撤退 = 全回復して継続(力尽きていない)。
  G.stamina = CONST.STAMINA_MAX;
  G.hp = CONST.HP_MAX;
  G.enteredHpZone = false;
  showHint(TEXT.cueSurface, false);
  playSfx("heal");
  renderHud();
}

// ---- 失敗(体力 0) ----------------------------------------------------
function checkFail() {
  if (G.hp <= 0 && G.py > 0 && G.screen === "dive") {
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
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.title;
  ovTitleEl.hidden = false;
  const bd = getInt(BEST_DEPTH_KEY);
  const br = getInt(RESCUE_KEY);
  ovSubEl.textContent =
    TEXT.bestDepthPrefix + bd + TEXT.bestDepthSuffix + "　" +
    TEXT.bestRescuePrefix + br + TEXT.bestRescueSuffix;
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
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.failTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovSubEl.textContent = TEXT.failSub + "　" + TEXT.depthPrefix + G.maxDepthThisDive + TEXT.depthSuffix;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.retry;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => startDive();
  showOverlay();
}

function showClear() {
  G.screen = "clear";
  hudEl.hidden = true;
  playSfx("clear");
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.clearTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("small-title");
  ovSubEl.textContent = TEXT.clearSub;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.again;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => startDive();
  showOverlay();
}

// ---- HUD レンダリング(DOM) --------------------------------------------
function renderHud() {
  depthValEl.textContent = TEXT.depthPrefix + G.py + TEXT.depthSuffix;
  rescueValEl.textContent = G.rescued;
  exploreValEl.textContent = Math.round(exploreRatio() * 100) + "%";
  const spRatio = Math.max(0, Math.min(1, G.stamina / CONST.STAMINA_MAX));
  staminaFillEl.style.width = spRatio * 100 + "%";
  staminaValEl.textContent = Math.round(G.stamina);
  const hpRatio = Math.max(0, Math.min(1, G.hp / CONST.HP_MAX));
  hpFillEl.style.width = hpRatio * 100 + "%";
  hpValEl.textContent = Math.round(G.hp);
  // スタミナ切れ(体力ゾーン)で警告色。
  gaugeEl.classList.toggle("hp-zone", G.stamina <= 0);
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
  // タップしたマスが自機の上下左右隣接なら、その方向を解決。
  const dc = col - G.px;
  const dr = row - G.py;
  if (Math.abs(dc) + Math.abs(dr) !== 1) return;
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

  // カメラ追従: 自機を画面のやや上(行 4 付近)に。地表は上端で止め、底も超えない。
  const maxCam = Math.max(0, CONST.DEPTH_ROWS + 1 - Math.floor(H / tile));
  let targetCam = G.py - 4;
  targetCam = Math.max(0, Math.min(maxCam, targetCam));
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
      }

      // タイル境界の薄い格子(断面の読みやすさ。fog には引かない)。
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tile, tile);
    }
  }

  // 女の子(暖色自発光。未発見でも可視マスなら気配として淡く光る)。
  const g = G.girl;
  if (g && g.state !== "rescued") {
    if (isVisible(g.col, g.row) || g.state === "following") drawGirl(g);
  }

  // 自機(暖色グロー + スプライト)。
  const cx = G.px * tile + tile / 2;
  const cy = (G.py - camY) * tile + tile / 2;
  drawMiner(cx, cy);
}

// セル中央にキャラスプライトを描く(縦長アスペクト維持・足元をマス中央付近に)。
// fog/明背景どちらでも輪郭が出るよう背後にソフトな縁取りグローを置く。
function drawCharSprite(key, cx, cy) {
  const img = SPRITES[key];
  if (!(img && img.complete && img.naturalWidth > 0)) return false;
  const w = tile * 0.78;
  const h = w * (img.naturalHeight / img.naturalWidth);
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
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
