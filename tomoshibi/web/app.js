"use strict";
// ともしび — 呼びかけると世界が応える静かな歩行ゲーム。バニラ JS、フレームワーク無し。
// ランタイムで外部 API / claude を呼ばない(唯一の外部依存は CSS の和文フォント CDN)。
// FRAGMENTS / WHISPERS / HINTS / PALETTE は fragments.js から読む(global)。
//
// 核メカニクス:
//   歩く  = 長押し(押している間 progress 0→1 前進、3 層パララックス)
//   呼ぶ  = 止まっている状態での短タップ(< CALL_MAX_MS かつ移動量小)。歩行者を中心に
//           「呼び声の波紋(光の輪)」が同心円状に広がる。波紋が届いた種火(眠っている灯)が
//           点灯し暖色がふっと灯ってゆっくり減衰する = 世界が応える。
//   物語  = 本線断章(progress 閾値、呼ばなくても読める) + 灯のささやき(呼んだ人だけ)。

// ---- バージョン --------------------------------------------------------
// トップ(opening)画面に表示する版番号。**ゲームに手を入れるたびに必ず上げる**。
// 目的: 実機で見える番号と、こちらが出した番号がズレていれば「端末のキャッシュに
// 旧版が残っている」、一致していれば「こちらの認識・検証不足」と切り分けられる。
const VERSION = "v1.0.1";

// ---- 設定値 ------------------------------------------------------------
// フル踏破に長押し約 2.5 分。progress は 0→1。
const FULL_WALK_SECONDS = 150;
const PROGRESS_PER_SEC = 1 / FULL_WALK_SECONDS;
const WALKER_X_RATIO = 0.32; // 歩行者は画面のやや左寄りに固定。
// 短タップ(呼び声)判別。pointerdown からの経過と移動量で歩行/呼び声を分ける。
const CALL_MAX_MS = 220; // これ未満で離せば「呼ぶ」候補。
const CALL_MAX_MOVE = 16; // 移動量(px)がこれ以下なら「ちょん」とみなす。
// 波紋(呼び声の輪)。
const RIPPLE_SPEED = 520; // px/s で半径拡大。
const RIPPLE_MAX_R = 1400; // この半径で消滅。
const RIPPLE_LIFE = 2.6; // 秒。寿命で減衰しきる。

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

let progress = 0;
let walking = false; // 入力(押している)状態
let paused = false; // 断章表示中は前進を止める
let finished = false; // ending を出し切った終端
let dismissTimer = 0; // フェードアウト後に overlay を隠す遅延 timer(再表示時にキャンセル)
let lastT = 0;
let bobPhase = 0; // 歩行者の上下 bob 用位相
let elapsed = 0; // 経過秒(波紋・灯のアニメ位相)

// 表示済み断章の index 集合(再表示しない)。opening は起動時に出す。
const shownIdx = new Set();
let activeFrag = null; // 現在オーバーレイ表示中の断章 index(null=非表示)

// 呼び声の波紋。{born} の配列(中心は常に歩行者なので座標は持たず、描画時に算出)。
// テストから window.ripples で読める。
const ripples = [];
window.ripples = ripples;
let litCount = 0; // 点灯した種火の延べ数(UI には出さない)。テストから読める。

// 入力(押し下げ)の追跡。短タップ判別用。
let pointerDownT = 0;
let pointerDownX = 0;
let pointerDownY = 0;
let pointerMoved = 0;

// ヒント文面の出し分け(止まっている時だけ)。最初は歩き方、少し進んだら呼び方。
function currentHintText() {
  return progress < 0.08 ? HINTS.walk : HINTS.call;
}
function updateWalkHint() {
  const show = activeFrag === null && !finished && !walking;
  walkHintEl.hidden = !show;
  if (show) walkHintEl.textContent = currentHintText();
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---- 色補間 ------------------------------------------------------------
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
// PALETTE を progress でサンプリング。{skyTop, skyBottom, land}。
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
    skyTop: mixHex(lo.skyTop, hi.skyTop, t),
    skyBottom: mixHex(lo.skyBottom, hi.skyBottom, t),
    land: mixHex(lo.land, hi.land, t),
  };
}
// 0..1 の知覚明度(おおまか)。歩行者のコントラスト追従に使う。
function luminance(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m) return 0;
  return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
}
// 夜の度合い(星の出方)。ともしびは全体に暗いので、両端の夜帯で星を出す。
function nightFactor(p) {
  const dawn = p < 0.18 ? 1 - p / 0.18 : 0; // 夜明け前
  const night = p > 0.82 ? (p - 0.82) / 0.18 : 0; // 宵〜夜
  return Math.min(1, Math.max(dawn, night));
}

// ---- 決定論的ノイズ(乱数ライブラリ不要、再現可能) ---------------------
function ridge(x, amp, base, freqs) {
  let y = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    y += Math.sin(x * f.k + f.phase) * f.w;
  }
  return base - y * amp;
}
function worldOffset(p, speed) {
  return p * speed;
}

// ---- 星(夜帯のみ) -----------------------------------------------------
const STAR_SEEDS = [];
for (let i = 0; i < 70; i++) {
  STAR_SEEDS.push({
    x: ((i * 73.13) % 100) / 100,
    y: ((i * 31.7) % 55) / 100,
    r: 0.6 + ((i * 17) % 10) / 10,
    tw: (i % 7) * 0.9,
  });
}

// ---- 種火(眠っている灯) ------------------------------------------------
// 決定論的に配置(みちゆきの STAR_SEEDS と同じ sin/定数ベース、乱数禁止)。
// world 座標 wx(progress*SEED_SPEED が引く)に沿って右→左へ流れる。
// 各種火: lit(点灯済みか) / litAt(点灯時刻) / whisper(ささやく灯なら WHISPERS の index)。
const SEED_SPEED = 2600; // 種火スクロール速度(中景〜近景の間)。
const SEED_COUNT = 64;
// 想定画面幅の概算(px)。実際の描画は実 W を使うが、種火の world 配置は描画前に
// 一度だけ決める(乱数禁止の決定論配置)ため、ここでは代表値で射程を見積もる。
const NOMINAL_SCREEN_W = 412;
// 種火が画面に流れ込む world 範囲。progress 0→1 で off=worldOffset は 0→SEED_SPEED、
// 画面 x は (W + wx - off)。踏破全行程で右→左へ順に現れるよう、wx をこの射程
// [0, SEED_SPEED + W] に決定論的に均等分散させる(乱数禁止、sin で揺らぎだけ付与)。
const SEED_SPAN = SEED_SPEED + 0.9 * NOMINAL_SCREEN_W; // 概算画面幅ぶん上乗せ(実 W は描画時に効く)。
const SEEDS = [];
for (let i = 0; i < SEED_COUNT; i++) {
  // 等間隔 + sin の決定論的揺らぎ(隣り合わせず自然にばらける)。
  const base = (i + 0.5) * (SEED_SPAN / SEED_COUNT);
  const wx = base + Math.sin(i * 1.7) * (SEED_SPAN / SEED_COUNT) * 0.4;
  const yr = 0.46 + ((Math.sin(i * 2.3 + 0.5) + 1) / 2) * 0.34; // 画面高 0.46〜0.80。
  // ささやく灯: 決定論的に約 1/6 を選ぶ。WHISPERS の index は順送り。
  const isWhisper = i % 6 === 2;
  SEEDS.push({
    wx,
    yr,
    lit: false,
    litAt: -1,
    whisperIdx: isWhisper ? null : -1, // null=ささやく灯(点灯時に index 割当), -1=普通の灯
    baseHue: 28 + ((i * 13) % 22), // 暖色(橙〜黄)。
  });
}
let whisperAssignCursor = 0; // ささやく灯に WHISPERS を順番に割り当てるカーソル。

// 種火の現在の画面 x(progress に応じて右→左へ流れる)。可視域外は null。
function seedScreenX(seed, p) {
  const off = worldOffset(p, SEED_SPEED);
  // world を画面右端付近から左へ流す。+W で初期位置を右にずらす。
  let sx = W + seed.wx - off;
  // world 全長で巻き戻し(範囲を超えたら再登場)させず、一方向に流れて消える方が
  // 「歩いて通り過ぎる」感に合う。可視判定だけ返す。
  return sx;
}

// 灯のささやき表示。{text, x, y, born} を 1 個ずつ。フェードイン→数秒で消える。
let activeWhisper = null;
const WHISPER_LIFE = 4.2; // 秒。

function tryIgnite(seed, sx, sy) {
  if (seed.lit) return;
  seed.lit = true;
  seed.litAt = elapsed;
  litCount++;
  window.litCount = litCount;
  // ささやく灯なら短句を出す(本線断章中は出さない)。
  if (seed.whisperIdx === null && activeFrag === null) {
    const idx = whisperAssignCursor % WHISPERS.length;
    whisperAssignCursor++;
    activeWhisper = { text: WHISPERS[idx], x: sx, y: sy, born: elapsed };
  }
}
window.litCount = 0;

// ---- 描画 --------------------------------------------------------------
function drawSky(pal, night) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (night > 0) {
    ctx.save();
    for (const s of STAR_SEEDS) {
      const tw = 0.5 + 0.5 * Math.sin(elapsed * 0.7 + s.tw);
      ctx.globalAlpha = night * (0.3 + 0.4 * tw);
      ctx.fillStyle = "#f5f3e8";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLayer(p, scrollSpeed, baseRatio, amp, freqs, color, alpha) {
  const off = worldOffset(p, scrollSpeed);
  const baseY = H * baseRatio;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  const step = 8;
  for (let sx = 0; sx <= W + step; sx += step) {
    const wx = (sx + off) * 0.01;
    ctx.lineTo(sx, ridge(wx, amp, baseY, freqs));
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function shade(hex, factor) {
  const m = hex.match(/\d+/g);
  let r, g, b;
  if (hex[0] === "#") {
    [r, g, b] = hexToRgb(hex);
  } else {
    r = +m[0];
    g = +m[1];
    b = +m[2];
  }
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(
    b * factor
  )})`;
}

const WALKER_GROUND_RATIO = 0.82;
function walkerScreen() {
  const x = W * WALKER_X_RATIO;
  const groundY = H * WALKER_GROUND_RATIO;
  return { x, groundY };
}

function drawWalker(pal) {
  const { x, groundY } = walkerScreen();
  const bob = walking && !paused ? Math.sin(bobPhase * 6) * 4 : 0;
  const baseY = groundY + bob;
  const h = Math.max(38, H * 0.072);
  const w = h * 0.34;

  // 視認性: 背景(地面)の明度を見て歩行者の塗りを反転気味に追従させる。
  // 暗背景では少し明るく、明背景では少し暗く。「景色が主役・人は気配」を保ち、
  // 言われれば気づく程度のコントラストを常に確保(v1 で歩行者が夜帯に同化した教訓)。
  const bgL = luminance(pal.land);
  // 目標明度 = 背景の反対側へ寄せる(暗背景=明るめ 0.78, 明背景=暗め 0.18)。
  const targetL = bgL < 0.5 ? 0.62 + (0.5 - bgL) * 0.5 : 0.28 - (bgL - 0.5) * 0.3;
  const v = Math.round(Math.max(0.12, Math.min(0.82, targetL)) * 255);
  const bodyFill = `rgba(${v},${Math.round(v * 0.96)},${Math.round(v * 0.92)},0.92)`;
  // ごく細い縁(背景と逆方向)で同化を完全には消さず最低限のエッジを確保。
  const edge = bgL < 0.5 ? "rgba(10,8,14,0.55)" : "rgba(245,242,232,0.5)";

  ctx.save();
  ctx.fillStyle = bodyFill;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  // 胴(角丸の縦長)
  ctx.beginPath();
  ctx.ellipse(x, baseY - h * 0.55, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 頭
  ctx.beginPath();
  ctx.arc(x, baseY - h * 1.05, w * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 脚(歩行で前後に開く)
  const legSwing = walking && !paused ? Math.sin(bobPhase * 6) * w * 0.6 : w * 0.15;
  ctx.lineWidth = w * 0.32;
  ctx.lineCap = "round";
  ctx.strokeStyle = bodyFill;
  ctx.beginPath();
  ctx.moveTo(x, baseY - h * 0.18);
  ctx.lineTo(x - legSwing, baseY + h * 0.12);
  ctx.moveTo(x, baseY - h * 0.18);
  ctx.lineTo(x + legSwing, baseY + h * 0.12);
  ctx.stroke();
  ctx.restore();
}

// 呼び声の波紋(歩行者中心の光の輪)。半径拡大 + 寿命で減衰。
function drawRipples() {
  const { x, groundY } = walkerScreen();
  const cx = x;
  const cy = groundY - Math.max(38, H * 0.072) * 0.55; // 胴の高さ中心。
  ctx.save();
  for (const r of ripples) {
    const age = elapsed - r.born;
    const rad = age * RIPPLE_SPEED;
    const life = 1 - age / RIPPLE_LIFE;
    if (life <= 0) continue;
    ctx.globalAlpha = 0.35 * life;
    ctx.strokeStyle = "rgba(255,224,168,1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    // 内側にもう一本、薄く。
    ctx.globalAlpha = 0.18 * life;
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 0.82, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// 種火を描く + 波紋が届いた瞬間に点灯判定。
function drawSeeds(p) {
  const { x, groundY } = walkerScreen();
  const cx = x;
  const cy = groundY - Math.max(38, H * 0.072) * 0.55;
  ctx.save();
  for (const seed of SEEDS) {
    const sx = seedScreenX(seed, p);
    if (sx < -80 || sx > W + 80) continue; // 可視域外。
    const sy = seed.yr * H;

    // 点灯判定: いずれかの波紋の現在半径が種火位置に届いた瞬間。
    if (!seed.lit) {
      const dist = Math.hypot(sx - cx, sy - cy);
      for (const r of ripples) {
        const age = elapsed - r.born;
        if (age >= RIPPLE_LIFE) continue;
        const rad = age * RIPPLE_SPEED;
        // 輪の縁(±28px)に種火がかかった瞬間に応える。
        if (Math.abs(rad - dist) < 28) {
          tryIgnite(seed, sx, sy);
          break;
        }
      }
    }

    if (seed.lit) {
      // 点灯: 暖色がふっと灯り、にじみ(放射グラデ)を出してゆっくり減衰。
      const since = elapsed - seed.litAt;
      const rise = Math.min(1, since / 0.5); // 立ち上がり 0.5s。
      const decay = Math.exp(-since / 6.0); // ゆっくり減衰。
      const a = rise * (0.25 + 0.75 * decay); // やがてまた薄れて消える。
      if (a > 0.02) {
        const glow = Math.max(18, H * 0.05) * (0.7 + 0.3 * Math.sin(elapsed * 1.6 + seed.wx));
        const col = `hsl(${seed.baseHue}, 85%, 62%)`;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, glow);
        g.addColorStop(0, `hsla(${seed.baseHue},90%,72%,${a})`);
        g.addColorStop(0.4, `hsla(${seed.baseHue},85%,58%,${a * 0.5})`);
        g.addColorStop(1, `hsla(${seed.baseHue},80%,45%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, glow, 0, Math.PI * 2);
        ctx.fill();
        // 芯。
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, H * 0.006), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else {
      // 眠り: ほぼ不可視。ごくかすかな点だけ(呼ばれるまで「ない」)。
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "rgba(255,220,160,1)";
      ctx.beginPath();
      ctx.arc(sx, sy, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// 灯のささやき(呼んだ人だけの短句)を淡く描く。in-canvas テキスト。
function drawWhisper() {
  if (!activeWhisper) return;
  const age = elapsed - activeWhisper.born;
  if (age >= WHISPER_LIFE) {
    activeWhisper = null;
    return;
  }
  // フェードイン(0.6s)→保持→フェードアウト。
  const fadeIn = Math.min(1, age / 0.6);
  const fadeOut = Math.min(1, (WHISPER_LIFE - age) / 1.2);
  const a = Math.min(fadeIn, fadeOut) * 0.85;
  const tx = Math.max(W * 0.12, Math.min(W * 0.88, activeWhisper.x));
  const ty = Math.max(H * 0.18, activeWhisper.y - H * 0.06);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(248,236,220,1)";
  ctx.font = `${Math.max(14, Math.round(H * 0.024))}px "Zen Old Mincho", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(activeWhisper.text, tx, ty);
  ctx.restore();
}

function render() {
  const pal = samplePalette(progress);
  const night = nightFactor(progress);
  drawSky(pal, night);
  drawLayer(
    progress,
    700,
    0.62,
    18,
    [
      { k: 0.6, phase: 0.0, w: 1.0 },
      { k: 1.7, phase: 1.3, w: 0.35 },
    ],
    shade(pal.skyTop, 0.7),
    0.55
  );
  drawLayer(
    progress,
    1800,
    0.72,
    34,
    [
      { k: 0.9, phase: 2.1, w: 1.0 },
      { k: 2.3, phase: 0.4, w: 0.4 },
    ],
    shade(pal.land, 1.15),
    0.8
  );
  drawSeeds(progress); // 種火は近景の地面より奥(歩行者の足元〜中景)に。
  drawLayer(
    progress,
    4500,
    0.84,
    26,
    [
      { k: 1.4, phase: 0.7, w: 1.0 },
      { k: 3.1, phase: 2.6, w: 0.35 },
    ],
    pal.land,
    1.0
  );
  drawRipples();
  drawWalker(pal);
  drawWhisper();
}

// ---- 断章ロジック ------------------------------------------------------
function nextWaypoint() {
  for (let i = 0; i < FRAGMENTS.length; i++) {
    const f = FRAGMENTS[i];
    if (f.kind === "opening") continue;
    if (!shownIdx.has(i)) return { idx: i, frag: f };
  }
  return null;
}

function showFragment(idx) {
  const f = FRAGMENTS[idx];
  activeFrag = idx;
  shownIdx.add(idx);
  paused = true;
  if (f.kind === "ending") finished = true;
  fragTitleEl.textContent = f.title || "";
  fragTitleEl.hidden = !f.title;
  fragTitleEl.classList.toggle("big-title", f.kind === "opening");
  fragTextEl.innerHTML = "";
  for (const line of f.text.split("\n")) {
    const p = document.createElement("p");
    p.textContent = line;
    fragTextEl.appendChild(p);
  }
  hintEl.textContent = f.kind === "ending" ? "" : "タップでつづける";
  hintEl.hidden = f.kind === "ending";
  fragVersionEl.textContent = VERSION;
  fragVersionEl.hidden = f.kind !== "opening";
  clearTimeout(dismissTimer); // 直前 dismiss の遅延 hidden が新断章を消さないように
  overlay.hidden = false;
  overlay.classList.add("visible");
  updateWalkHint();
}

function dismissFragment() {
  if (activeFrag === null) return;
  const f = FRAGMENTS[activeFrag];
  if (f.kind === "ending") return; // ending は dismiss しない(静かに終端)
  overlay.classList.remove("visible");
  dismissTimer = setTimeout(() => {
    overlay.hidden = true;
  }, 800);
  activeFrag = null;
  paused = false;
  updateWalkHint();
}

// ---- 入力 --------------------------------------------------------------
// 押し下げ: 即座に歩行扱いで前進開始(短タップでも一瞬だけ半歩進む = 立ち止まって
// ひと声かける感)。離した時に「短タップ(呼ぶ)」だったか経過時間・移動量で判定する。
function pressStart(x, y) {
  if (activeFrag !== null) {
    dismissFragment();
    return;
  }
  if (finished) return;
  pointerDownT = elapsed;
  pointerDownX = x;
  pointerDownY = y;
  pointerMoved = 0;
  walking = true;
  updateWalkHint();
}

function pressMove(x, y) {
  if (!walking) return;
  pointerMoved = Math.max(
    pointerMoved,
    Math.hypot(x - pointerDownX, y - pointerDownY)
  );
}

function emitRipple() {
  ripples.push({ born: elapsed });
  // 寿命切れの掃除は tick() 側の毎フレーム掃除に一本化(ここでは push のみ)。
}

function pressEnd() {
  if (!walking) return;
  const heldMs = (elapsed - pointerDownT) * 1000;
  walking = false;
  // 短タップ(立ち止まって「ちょん」)= 呼び声。歩行が始まっていない静止状態からの
  // 短い接触だったときだけ発火させる(進みすぎていれば歩行と見なす)。
  if (heldMs < CALL_MAX_MS && pointerMoved < CALL_MAX_MOVE) {
    emitRipple();
  }
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
  if (activeFrag !== null) dismissFragment();
});

// キーボード操作(PC 用)。長押し=歩く、単押し(keyup が早い)=呼ぶ、は pointer と
// 同じ heldMs 判定で兼ねる。
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "ArrowRight" || e.key === " " || e.code === "Space") {
    e.preventDefault();
    const { x, groundY } = walkerScreen();
    pressStart(x, groundY);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowRight" || e.key === " " || e.code === "Space") {
    pressEnd();
  }
});

// ---- メインループ ------------------------------------------------------
function tick(t) {
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  elapsed += dt;

  if (walking && !paused && !finished) {
    progress = Math.min(1, progress + PROGRESS_PER_SEC * dt);
    bobPhase += dt;
  }

  // 波紋の寿命切れを掃除(配列肥大化防止)。
  for (let i = ripples.length - 1; i >= 0; i--) {
    if (elapsed - ripples[i].born > RIPPLE_LIFE) ripples.splice(i, 1);
  }

  // waypoint 到達判定(取りこぼし防止に未踏で at を越えたものを順に出す)。
  if (activeFrag === null && !finished) {
    const next = nextWaypoint();
    if (next && progress >= next.frag.at) {
      walking = false;
      showFragment(next.idx);
    }
  }

  render();
  requestAnimationFrame(tick);
}

// 起動時に opening を出す(タイトル)。
function start() {
  showFragment(0); // opening は index 0
  requestAnimationFrame(tick);
}
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
