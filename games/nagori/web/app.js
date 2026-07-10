"use strict";
// なごり — 指でなぞって消えない道を描き、霧の淀みを全部つないで、最後に自分の一筆を
// 俯瞰する静かなゲーム。バニラ JS、フレームワーク無し。
// ランタイムで外部 API / claude を呼ばない(唯一の外部依存は CSS の和文フォント CDN)。
// OPENING / STILLS / ENDING / PALETTE は fragments.js から読む(global)。
//
// 核メカニクス:
//   なぞる = pointer ドラッグの軌跡を「消えない光る線(stroke)」として固定する。
//            strokes は配列で蓄積し、消去・上書き不可。何本でも足せる(詰みなし)。
//            ドラッグした帯(線の近傍半径)だけ霧のアルファが下がり、下の地形が立つ。
//            操作とその結果(霧が晴れ・線が光る)は同フレームで一対一 = 強フィードバック。
//   淀み   = 決定論配置 7 個(乱数禁止)。初期から薄く視認できる暗い染み。線の経路が
//            淀み中心から閾値内を通った瞬間に cleared = 霧が大きく退き、断章が一瞬浮く。
//   達成   = 全 7 淀み cleared で視点が静かにズームアウトし、引いた全軌跡が金の道として
//            俯瞰される。ending を静かに表示して終端(dismiss せず終わる)。
//   失敗なし・時間制限なし・スコアなし。引き直し不可だが線は何本でも足せる。

// ---- バージョン --------------------------------------------------------
// opening カードに薄く表示する版番号。**ゲーム本体に手を入れるたびに必ず上げる**。
// 実機で見える番号とこちらの番号がズレていれば「端末キャッシュに旧版が残存」、
// 一致していれば「こちらの認識・検証不足」と切り分けられる。
const VERSION = "v1.0.0";

// ---- 設定値 ------------------------------------------------------------
const SILT_COUNT = 7; // 淀みの数(progress = cleared / SILT_COUNT)。
const CLEAR_RADIUS_RATIO = 0.085; // 淀み判定半径(短辺比)。線がこの内を通れば cleared。
const REVEAL_RADIUS_RATIO = 0.05; // 線の近傍この半径(短辺比)で霧が晴れる。
const MIN_SEG_DIST = 3; // stroke を間引く最小セグメント距離(px)。
const STILL_LIFE = 5.2; // in-canvas 断章の寿命(秒)。フェードイン→保持→フェードアウト。
const FOG_CELL = 22; // 霧 reveal バッファのセル解像度(px)。粗いほど軽い。
const ZOOM_SECONDS = 2.6; // 達成時のズームアウト所要(秒)。

// ---- canvas / state ----------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const fragTitleEl = document.getElementById("frag-title");
const fragTextEl = document.getElementById("frag-text");
const hintEl = document.getElementById("hint");
const walkHintEl = document.getElementById("walkhint");
const fragVersionEl = document.getElementById("frag-version");

let DPR = 1;
let W = 0;
let H = 0;
let SHORT = 0; // min(W,H)。半径系をここ基準に取る。

let elapsed = 0; // 経過秒(アニメ位相)。
let lastT = 0;
let drawing = false; // いま指が触れていてなぞっている最中か。
let overlayShown = null; // "opening" / "ending" / null。overlay 表示状態。
let finished = false; // ending を出した終端。
let dismissTimer = 0; // overlay フェードアウト後の hidden 遅延 timer。

// 引いた線。strokes = 各 stroke の点列 [{x,y}, ...]。消去・上書き不可。
// テストから window.strokes / window.clearedCount で読める。
const strokes = [];
window.strokes = strokes;
let curStroke = null; // なぞり中の stroke(strokes の末尾を指す)。

// 霧 reveal バッファ。グリッド各セルの「晴れ度」0..1。線が通った近傍で 0→1 へ上がる。
// 決定論的・蓄積のみ(下がらない = 不可逆)。
let fogCols = 0;
let fogRows = 0;
let revealGrid = null; // Float32Array(fogCols*fogRows)。

// 達成ズーム。0→1 で全 strokes が画面に収まる俯瞰へ。
let zoomT = 0; // 0..1。
let zooming = false;

// ---- 淀み(澱) ---------------------------------------------------------
// 決定論配置(sin/定数ベース、乱数禁止。ともしびの SEEDS 流儀)。画面比率で配置し、
// resize 時に実ピクセルへ展開する。初期は薄い暗染みとして視認でき、cleared で晴れる。
const SILTS = [];
for (let i = 0; i < SILT_COUNT; i++) {
  // 一画面固定の俯瞰。中央寄りを避け画面全体へ決定論的に散らす(隣り合わせない)。
  const a = i * 2.39996; // 黄金角(rad)に近い定数で回す = 均等に散る。
  const rad = 0.16 + ((i * 3) % 5) * 0.06; // 中心からの距離(短辺比)。0.16〜0.40。
  const xr = 0.5 + Math.cos(a) * rad;
  const yr = 0.5 + Math.sin(a) * rad * 0.82; // 縦は少し詰める(横長画面想定)。
  SILTS.push({
    xr,
    yr,
    cleared: false,
    clearedAt: -1,
    stillIdx: i, // 対応する STILLS の index(配置順)。
  });
}
let clearedCount = 0;
window.clearedCount = 0;

// in-canvas 断章(淀みが cleared になった瞬間に浮く)。1 個ずつ表示。
let activeStill = null; // {text, x, y, born} or null。

function siltScreen(s) {
  return { x: s.xr * W, y: s.yr * H, r: SHORT * CLEAR_RADIUS_RATIO };
}

// ---- resize ------------------------------------------------------------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  SHORT = Math.min(W, H);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // 霧 reveal グリッドを張り直す。既に晴れた帯は strokes から再構築する(不可逆を保つ)。
  fogCols = Math.ceil(W / FOG_CELL) + 1;
  fogRows = Math.ceil(H / FOG_CELL) + 1;
  revealGrid = new Float32Array(fogCols * fogRows);
  for (const st of strokes) {
    for (const p of st) revealAround(p.x, p.y);
  }
}

// ---- 色補間(michiyuki / tomoshibi 踏襲) ------------------------------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mixHex(h1, h2, t) {
  const a = hexToRgb(h1);
  const b = hexToRgb(h2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(
    lerp(a[1], b[1], t)
  )},${Math.round(lerp(a[2], b[2], t))})`;
}
// PALETTE を progress でサンプリング。{fog, land, silt, line}。
function samplePalette(p) {
  let lo = PALETTE[0];
  let hi = PALETTE[PALETTE.length - 1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (p >= PALETTE[i].at && p <= PALETTE[i + 1].at) {
      lo = PALETTE[i];
      hi = PALETTE[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = Math.max(0, Math.min(1, (p - lo.at) / span));
  return {
    fog: mixHex(lo.fog, hi.fog, t),
    land: mixHex(lo.land, hi.land, t),
    silt: mixHex(lo.silt, hi.silt, t),
    line: mixHex(lo.line, hi.line, t),
  };
}
// 0..1 の知覚明度。前景(線・カーソル)のコントラスト追従に使う(tomoshibi の考え方)。
function luminance(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m) return 0;
  return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
}

// ---- 決定論的ノイズ(乱数禁止、再現可能な静かな地形) -------------------
// sin 和で「草・水・石・砂」が混じった静かな模様の明度を返す(0..1)。霧が晴れた
// セルだけ描く。world 座標は画面固定(俯瞰)なので screen 座標をそのまま入れる。
function terrainNoise(x, y) {
  const u = x * 0.013;
  const v = y * 0.013;
  let n = 0;
  n += Math.sin(u * 1.0 + 0.4) * Math.cos(v * 0.9 + 1.1) * 0.5;
  n += Math.sin(u * 2.3 + 1.7) * Math.cos(v * 2.1 + 0.3) * 0.28;
  n += Math.sin((u + v) * 3.7 + 2.2) * 0.16;
  return (n + 1) / 2; // 0..1。
}

// ---- 霧 reveal バッファ -------------------------------------------------
// 点(x,y)の周囲のグリッドセルの晴れ度を上げる(蓄積のみ、下がらない = 不可逆)。
function revealAround(x, y) {
  if (!revealGrid) return;
  const r = SHORT * REVEAL_RADIUS_RATIO;
  const r2 = r * r;
  const cx = x / FOG_CELL;
  const cy = y / FOG_CELL;
  const span = Math.ceil(r / FOG_CELL) + 1;
  const ci = Math.round(cx);
  const cj = Math.round(cy);
  for (let j = cj - span; j <= cj + span; j++) {
    if (j < 0 || j >= fogRows) continue;
    for (let i = ci - span; i <= ci + span; i++) {
      if (i < 0 || i >= fogCols) continue;
      const px = i * FOG_CELL;
      const py = j * FOG_CELL;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (d2 > r2) continue;
      const fall = 1 - Math.sqrt(d2) / r; // 中心ほど強く晴れる。
      const idx = j * fogCols + i;
      if (fall > revealGrid[idx]) revealGrid[idx] = fall;
    }
  }
}
function revealAt(i, j) {
  if (i < 0 || j < 0 || i >= fogCols || j >= fogRows) return 0;
  return revealGrid[j * fogCols + i];
}

// ---- progress ----------------------------------------------------------
function progress() {
  return clearedCount / SILT_COUNT;
}

// ---- 描画 --------------------------------------------------------------
// 達成ズーム: 全 strokes の bbox が画面に収まる scale/offset を返す。zoomT で補間。
function zoomTransform() {
  if (zoomT <= 0 || strokes.length === 0) {
    return { scale: 1, ox: 0, oy: 0 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const st of strokes)
    for (const p of st) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  const pad = SHORT * 0.12;
  const bw = Math.max(1, maxX - minX) + pad * 2;
  const bh = Math.max(1, maxY - minY) + pad * 2;
  const targetScale = Math.min(1, Math.min(W / bw, H / bh));
  const bcx = (minX + maxX) / 2;
  const bcy = (minY + maxY) / 2;
  // ズーム後、bbox 中心が画面中心へ来るよう平行移動。
  const targetOx = W / 2 - bcx * targetScale;
  const targetOy = H / 2 - bcy * targetScale;
  const e = easeInOut(zoomT);
  return {
    scale: lerp(1, targetScale, e),
    ox: lerp(0, targetOx, e),
    oy: lerp(0, targetOy, e),
  };
}
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// 霧が晴れたセルにだけ地形(草・水・石・砂の静かな模様)を描く。
function drawTerrain(pal) {
  const landRgb = pal.land.match(/\d+/g).map(Number);
  for (let j = 0; j < fogRows; j++) {
    for (let i = 0; i < fogCols; i++) {
      const rv = revealAt(i, j);
      if (rv <= 0.02) continue;
      const x = i * FOG_CELL;
      const y = j * FOG_CELL;
      const n = terrainNoise(x, y); // 0..1。模様の明暗。
      // land 色を明暗に振って草/水/石/砂の気配を出す。
      const k = 0.74 + n * 0.5; // 0.74〜1.24 の明度係数。
      const r = Math.min(255, Math.round(landRgb[0] * k));
      const g = Math.min(255, Math.round(landRgb[1] * k));
      const b = Math.min(255, Math.round(landRgb[2] * k));
      ctx.globalAlpha = Math.min(1, rv) * 0.96;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      // セルを少し重ねて塗り、グリッド目地を消す。
      ctx.fillRect(x - FOG_CELL * 0.6, y - FOG_CELL * 0.6, FOG_CELL * 1.4, FOG_CELL * 1.4);
    }
  }
  ctx.globalAlpha = 1;
}

// 淀みを描く。未 cleared は霧より一段暗い染み(初期から視認できる目印)。
// cleared 後は地形色へ溶ける淡い窪み。
function drawSilts(pal) {
  for (const s of SILTS) {
    const { x, y, r } = siltScreen(s);
    if (!s.cleared) {
      // 暗い染み。霧の明度から一段下げた色で、晴れていない場所でも見える。
      const fogRgb = pal.fog.match(/\d+/g).map(Number);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.3);
      const dk = (c) => Math.max(0, Math.round(c * 0.72));
      g.addColorStop(0, `rgba(${dk(fogRgb[0])},${dk(fogRgb[1])},${dk(fogRgb[2])},0.62)`);
      g.addColorStop(0.7, `rgba(${dk(fogRgb[0])},${dk(fogRgb[1])},${dk(fogRgb[2])},0.30)`);
      g.addColorStop(1, `rgba(${dk(fogRgb[0])},${dk(fogRgb[1])},${dk(fogRgb[2])},0)`);
      // かすかに脈打つ(まだ淀んでいる気配)。
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(elapsed * 0.9 + s.xr * 6);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // cleared: 晴れた瞬間の広がりが落ち着いた後の、淡い澄んだ窪み。
      const since = elapsed - s.clearedAt;
      const ripple = since < 1.4 ? 1 - since / 1.4 : 0; // 晴れた瞬間の光輪。
      const siltRgb = pal.silt.match(/\d+/g).map(Number);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.1);
      g.addColorStop(0, `rgba(${siltRgb[0]},${siltRgb[1]},${siltRgb[2]},0.42)`);
      g.addColorStop(1, `rgba(${siltRgb[0]},${siltRgb[1]},${siltRgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      if (ripple > 0) {
        ctx.globalAlpha = 0.5 * ripple;
        ctx.strokeStyle = `rgb(${pal.line.match(/\d+/g).join(",")})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * (0.6 + (1 - ripple) * 1.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}

// 引いた線を描く。前景視認性: 背景(その線の通る地点の land/霧)の明度を読み、線の
// 明度を反転気味に決める。明背景=濃い橙+暗い 1px 縁、暗背景=明るい金+淡い光彩。
function drawStrokes(pal) {
  const bgL = luminance(pal.fog); // 大局的な背景明度(霧の明度)で振る。
  const dark = bgL < 0.5; // 暗背景か。
  const lineRgb = pal.line.match(/\d+/g).map(Number);
  // 達成俯瞰では全線を金の筋へ寄せる。
  const goldMix = Math.min(1, zoomT * 1.2);
  const gold = [240, 200, 120];
  const col = lineRgb.map((c, i) => Math.round(lerp(c, gold[i], goldMix)));
  const stroke = `rgb(${col[0]},${col[1]},${col[2]})`;

  const lw = Math.max(2.4, SHORT * 0.008);
  for (const st of strokes) {
    if (st.length < 1) continue;
    // 暗背景: 線の外側に淡い光彩を一枚敷く。
    if (dark || zoomT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.32 + 0.3 * goldMix;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw * 2.4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      pathStroke(st);
      ctx.stroke();
      ctx.restore();
    }
    // 明背景: 線の下に暗い細縁を一枚(地形色に紛れない二重コントラスト)。
    if (!dark) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(28,22,16,0.9)";
      ctx.lineWidth = lw + 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      pathStroke(st);
      ctx.stroke();
      ctx.restore();
    }
    // 本体。
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pathStroke(st);
    ctx.stroke();
    ctx.restore();
  }
}
function pathStroke(st) {
  ctx.moveTo(st[0].x, st[0].y);
  for (let i = 1; i < st.length; i++) ctx.lineTo(st[i].x, st[i].y);
  if (st.length === 1) {
    // 単点はごく短い線分として見せる。
    ctx.lineTo(st[0].x + 0.1, st[0].y + 0.1);
  }
}

// 指カーソル(なぞっている間、指先に背景反転明度の光点)。
function drawCursor(pal) {
  if (!drawing || !curStroke || curStroke.length === 0) return;
  const p = curStroke[curStroke.length - 1];
  const bgL = luminance(pal.fog);
  const v = bgL < 0.5 ? 245 : 30; // 暗背景=明点、明背景=暗点。
  const r = Math.max(5, SHORT * 0.012);
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
  g.addColorStop(0, `rgba(${v},${v},${Math.round(v * 0.9 + 20)},0.9)`);
  g.addColorStop(1, `rgba(${v},${v},${v},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(${v},${v},${v},0.95)`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

// in-canvas 断章。その一文の背後にだけ一段濃い暗幕を敷いてから文字を置く
// (地形色と文字が混ざらないコントラスト確保)。
function drawStill() {
  if (!activeStill) return;
  const age = elapsed - activeStill.born;
  if (age >= STILL_LIFE) {
    activeStill = null;
    return;
  }
  const fadeIn = Math.min(1, age / 0.8);
  const fadeOut = Math.min(1, (STILL_LIFE - age) / 1.4);
  const a = Math.min(fadeIn, fadeOut);
  const fs = Math.max(15, Math.round(H * 0.028));
  ctx.save();
  ctx.font = `${fs}px "Zen Old Mincho", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(activeStill.text).width;
  // 画面内に収める位置。淀み付近だが端で切れないようクランプ。
  const tx = Math.max(W * 0.5 - W * 0.42 + tw / 2, Math.min(W * 0.5 + W * 0.42 - tw / 2, activeStill.x));
  const ty = Math.max(H * 0.12, Math.min(H * 0.88, activeStill.y - H * 0.05));
  // 背後の暗幕(その一文の帯だけ)。
  const padX = fs * 0.9;
  const padY = fs * 0.7;
  ctx.globalAlpha = a * 0.5;
  ctx.fillStyle = "rgba(18,16,24,1)";
  roundRect(tx - tw / 2 - padX, ty - fs / 2 - padY, tw + padX * 2, fs + padY * 2, fs * 0.5);
  ctx.fill();
  // 文字。
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(244,238,226,1)";
  ctx.fillText(activeStill.text, tx, ty);
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  const p = progress();
  const pal = samplePalette(p);
  // 霧(背景全面)。
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = pal.fog;
  ctx.fillRect(0, 0, W, H);

  // 達成ズーム変換(全体に effect)。
  const zt = zoomTransform();
  ctx.setTransform(
    DPR * zt.scale,
    0,
    0,
    DPR * zt.scale,
    DPR * zt.ox,
    DPR * zt.oy
  );

  drawTerrain(pal);
  drawSilts(pal);
  drawStrokes(pal);
  drawCursor(pal);

  // 断章は画面座標(ズーム非適用)で読みやすく。
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawStill();
}

// ---- 淀み cleared 判定 -------------------------------------------------
// 点 (x,y) が未 cleared の淀み中心から閾値内なら cleared にする。
function checkSilts(x, y) {
  for (const s of SILTS) {
    if (s.cleared) continue;
    const sc = siltScreen(s);
    if (Math.hypot(x - sc.x, y - sc.y) <= sc.r) {
      clearSilt(s);
    }
  }
}
function clearSilt(s) {
  s.cleared = true;
  s.clearedAt = elapsed;
  clearedCount++;
  window.clearedCount = clearedCount;
  // その淀み周辺の霧を大きく退かせる(線が通った帯より広く晴れる)。
  const sc = siltScreen(s);
  const big = sc.r * 1.8;
  const step = FOG_CELL * 0.8;
  for (let dy = -big; dy <= big; dy += step) {
    for (let dx = -big; dx <= big; dx += step) {
      if (dx * dx + dy * dy > big * big) continue;
      revealAround(sc.x + dx, sc.y + dy);
    }
  }
  // その淀みに紐づく断章を近くに一瞬フェードイン(本線の overlay 中は出さない)。
  if (overlayShown === null) {
    activeStill = {
      text: STILLS[s.stillIdx % STILLS.length],
      x: sc.x,
      y: sc.y,
      born: elapsed,
    };
  }
  // 全 7 cleared で達成へ。
  if (clearedCount >= SILT_COUNT && !zooming && !finished) {
    beginEnding();
  }
}

// ---- 達成(ズームアウト → ending) -------------------------------------
function beginEnding() {
  zooming = true;
  drawing = false;
  curStroke = null;
  updateWalkHint();
  // ズーム完了後に ending overlay を出す(setTimeout は描画ループとは独立)。
  const startZoom = elapsed;
  zoomStartAt = startZoom;
}
let zoomStartAt = -1;

// ---- 入力 --------------------------------------------------------------
function pressStart(x, y) {
  if (overlayShown !== null) {
    dismissOverlay();
    return;
  }
  if (finished || zooming) return;
  drawing = true;
  curStroke = [{ x, y }];
  strokes.push(curStroke);
  revealAround(x, y);
  checkSilts(x, y);
  updateWalkHint();
}
function pressMove(x, y) {
  if (!drawing || !curStroke) return;
  const last = curStroke[curStroke.length - 1];
  const d = Math.hypot(x - last.x, y - last.y);
  if (d < MIN_SEG_DIST) return;
  // 細かく補間して霧 reveal / 淀み判定に取りこぼしが出ないようにする。
  const steps = Math.ceil(d / (SHORT * REVEAL_RADIUS_RATIO * 0.6));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = last.x + (x - last.x) * t;
    const py = last.y + (y - last.y) * t;
    revealAround(px, py);
    checkSilts(px, py);
  }
  // 補間ループ中に最後の淀みが cleared → beginEnding() が drawing=false / curStroke=null
  // にしている場合がある(7 本目を貫いた瞬間)。その後の push で null 参照しないよう再確認。
  if (!drawing || !curStroke) return;
  curStroke.push({ x, y });
}
function pressEnd() {
  if (!drawing) return;
  drawing = false;
  updateWalkHint();
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  pressStart(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => {
  pressMove(e.clientX, e.clientY);
});
window.addEventListener("pointerup", () => pressEnd());
window.addEventListener("pointercancel", () => pressEnd());
overlay.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (overlayShown !== null) dismissOverlay();
});

// ---- overlay(opening / ending) ---------------------------------------
// michiyuki の showFragment/dismissFragment を流用。ending は dismiss せず終端。
function updateWalkHint() {
  const show = overlayShown === null && !finished && !zooming && !drawing && strokes.length === 0;
  walkHintEl.hidden = !show;
}

function showOverlay(kind) {
  const data = kind === "opening" ? OPENING : ENDING;
  overlayShown = kind;
  if (kind === "ending") finished = true;
  fragTitleEl.textContent = data.title || "";
  fragTitleEl.hidden = !data.title;
  fragTitleEl.classList.toggle("big-title", kind === "opening");
  fragTextEl.innerHTML = "";
  for (const line of data.text.split("\n")) {
    const pEl = document.createElement("p");
    pEl.textContent = line; // 空行も <p></p> として高さを残す。
    if (line === "") pEl.classList.add("blank");
    fragTextEl.appendChild(pEl);
  }
  hintEl.textContent = kind === "ending" ? "" : "タップではじめる";
  hintEl.hidden = kind === "ending";
  fragVersionEl.textContent = VERSION;
  fragVersionEl.hidden = kind !== "opening";
  clearTimeout(dismissTimer);
  overlay.hidden = false;
  overlay.classList.add("visible");
  updateWalkHint();
}

function dismissOverlay() {
  if (overlayShown === null) return;
  if (overlayShown === "ending") return; // ending は dismiss しない(静かに終端)。
  overlay.classList.remove("visible");
  dismissTimer = setTimeout(() => {
    overlay.hidden = true;
  }, 800);
  overlayShown = null;
  updateWalkHint();
}

// ---- メインループ ------------------------------------------------------
function tick(t) {
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  elapsed += dt;

  // 達成ズーム進行。7 本目の断章を少し読ませてからズーム開始。
  if (zooming) {
    const delay = 1.2; // 7 本目断章のフェードインを見せる猶予。
    if (zoomStartAt >= 0 && elapsed - zoomStartAt > delay) {
      zoomT = Math.min(1, zoomT + dt / ZOOM_SECONDS);
      if (zoomT >= 1 && overlayShown === null && !finished) {
        showOverlay("ending");
      }
    }
  }

  render();
  requestAnimationFrame(tick);
}

function start() {
  showOverlay("opening");
  requestAnimationFrame(tick);
}
resize();
window.addEventListener("resize", resize);
start();

// 開発フェーズ: Service Worker は使わない(みちゆきの教訓。最初から登録しない)。
// 過去に登録された SW とキャッシュが古い shell を返し続ける事故を防ぐため、
// 登録は行わず、既存の登録・キャッシュを掃除する。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (window.caches) {
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
