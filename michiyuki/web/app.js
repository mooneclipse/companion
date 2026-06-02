"use strict";
// みちゆき — 静かな歩行ゲーム。バニラ JS、フレームワーク無し。
// ランタイムで外部 API / claude を呼ばない(唯一の外部依存は CSS の和文フォント CDN)。
// FRAGMENTS / PALETTE / 配色は fragments.js から読む(global)。

// ---- 設定値 ------------------------------------------------------------
// フル踏破に長押し約 2.5 分。progress は 0→1。
const FULL_WALK_SECONDS = 150;
const PROGRESS_PER_SEC = 1 / FULL_WALK_SECONDS;
// waypoint 到達判定の許容幅(progress)。フレーム間で飛んでも取りこぼさない。
const WALKER_X_RATIO = 0.32; // 歩行者は画面のやや左寄りに固定。

// ---- canvas / state ----------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const fragTitleEl = document.getElementById("frag-title");
const fragTextEl = document.getElementById("frag-text");
const hintEl = document.getElementById("hint");
const walkHintEl = document.getElementById("walkhint");

// 「押しているあいだ、歩く」ヒント。断章が出ておらず・終端でなく・いま歩いて
// いないとき(=止まっているとき)だけ薄く出す。歩き出すと消える。
function updateWalkHint() {
  walkHintEl.hidden = !(activeFrag === null && !finished && !walking);
}

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

// 表示済み断章の index 集合(再表示しない)。opening は起動時に出す。
const shownIdx = new Set();
let activeFrag = null; // 現在オーバーレイ表示中の断章 index(null=非表示)
let overlayAlpha = 0; // フェードイン用 0→1

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
// 夜の度合い(星の出方)。宵以降で 0→1。
function nightFactor(p) {
  if (p < 0.78) return 0;
  return Math.min(1, (p - 0.78) / 0.22);
}

// ---- 決定論的ノイズ(乱数ライブラリ不要、再現可能) ---------------------
// sin の和で滑らかな起伏を作る。x はワールド座標(scroll に応じて流れる)。
function ridge(x, amp, base, freqs) {
  let y = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    y += Math.sin(x * f.k + f.phase) * f.w;
  }
  return base - y * amp;
}

// 各層のスクロール基準(progress に比例して景色が流れる)。
function worldOffset(p, speed) {
  return p * speed;
}

// ---- 描画 --------------------------------------------------------------
const STAR_SEEDS = [];
for (let i = 0; i < 70; i++) {
  // 決定論的な星の配置(seed 固定)。
  STAR_SEEDS.push({
    x: ((i * 73.13) % 100) / 100,
    y: ((i * 31.7) % 55) / 100,
    r: 0.6 + ((i * 17) % 10) / 10,
    tw: (i % 7) * 0.9,
  });
}

function drawSky(pal, night) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (night > 0) {
    ctx.save();
    for (const s of STAR_SEEDS) {
      const tw = 0.5 + 0.5 * Math.sin(bobPhase * 0.5 + s.tw);
      ctx.globalAlpha = night * (0.35 + 0.45 * tw);
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
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(
    b * factor
  )})`;
}

function drawWalker() {
  const x = W * WALKER_X_RATIO;
  const groundY = H * 0.82;
  const bob = walking && !paused ? Math.sin(bobPhase * 6) * 4 : 0;
  const baseY = groundY + bob;
  const h = Math.max(38, H * 0.072);
  const w = h * 0.34;
  ctx.save();
  ctx.fillStyle = "rgba(20,18,26,0.9)";
  // 胴(角丸の縦長)
  ctx.beginPath();
  ctx.ellipse(x, baseY - h * 0.55, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭
  ctx.beginPath();
  ctx.arc(x, baseY - h * 1.05, w * 0.42, 0, Math.PI * 2);
  ctx.fill();
  // 脚(歩行で前後に開く)
  const legSwing = walking && !paused ? Math.sin(bobPhase * 6) * w * 0.6 : w * 0.15;
  ctx.lineWidth = w * 0.32;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(20,18,26,0.9)";
  ctx.beginPath();
  ctx.moveTo(x, baseY - h * 0.18);
  ctx.lineTo(x - legSwing, baseY + h * 0.12);
  ctx.moveTo(x, baseY - h * 0.18);
  ctx.lineTo(x + legSwing, baseY + h * 0.12);
  ctx.stroke();
  ctx.restore();
}

// 石碑/標(次の未踏 waypoint が近づくと右手に現れる)。
function drawMarker(pal) {
  const next = nextWaypoint();
  if (!next) return;
  const dist = next.frag.at - progress;
  if (dist < 0 || dist > 0.05) return; // 手前 progress 0.05 ぶんで出現
  const appear = 1 - dist / 0.05; // 0→1
  const x = W * (WALKER_X_RATIO + 0.45 + (1 - appear) * 0.3);
  const groundY = H * 0.82;
  const h = Math.max(46, H * 0.085);
  ctx.save();
  ctx.globalAlpha = 0.7 + 0.3 * appear;
  ctx.fillStyle = shade(pal.land, 0.6);
  ctx.beginPath();
  ctx.moveTo(x - h * 0.12, groundY);
  ctx.lineTo(x - h * 0.1, groundY - h);
  ctx.lineTo(x + h * 0.1, groundY - h);
  ctx.lineTo(x + h * 0.12, groundY);
  ctx.closePath();
  ctx.fill();
  // 上部の小さな笠
  ctx.fillRect(x - h * 0.18, groundY - h - h * 0.06, h * 0.36, h * 0.08);
  ctx.restore();
}

function render() {
  const pal = samplePalette(progress);
  const night = nightFactor(progress);
  drawSky(pal, night);
  // 遠景の稜線(ゆっくり) → 中景の丘 → 近景の地面(速い)。
  // scrollSpeed は「歩いている」視認性のため大きめ(小さいと景色が流れず静止に見える)。
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
  drawMarker(pal);
  drawWalker();
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
  // 改行(\n)を保持して段落化する。
  fragTextEl.innerHTML = "";
  for (const line of f.text.split("\n")) {
    const p = document.createElement("p");
    p.textContent = line;
    fragTextEl.appendChild(p);
  }
  hintEl.textContent = f.kind === "ending" ? "" : "タップでつづける";
  hintEl.hidden = f.kind === "ending";
  overlayAlpha = 0;
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
  // フェードアウト後に非表示。CSS transition と揃える。再表示時は showFragment が
  // この timer をキャンセルするので、遅延 hidden が新しい断章を消すことはない。
  dismissTimer = setTimeout(() => {
    overlay.hidden = true;
  }, 800);
  activeFrag = null;
  paused = false;
  updateWalkHint();
}

// ---- 入力 --------------------------------------------------------------
function pressStart() {
  if (activeFrag !== null) {
    dismissFragment();
    return;
  }
  if (finished) return;
  walking = true;
  updateWalkHint();
}
function pressEnd() {
  walking = false;
  updateWalkHint();
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  pressStart();
});
window.addEventListener("pointerup", () => pressEnd());
window.addEventListener("pointercancel", () => pressEnd());
overlay.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (activeFrag !== null) dismissFragment();
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "ArrowRight" || e.key === " " || e.code === "Space") {
    e.preventDefault();
    pressStart();
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

  if (walking && !paused && !finished) {
    progress = Math.min(1, progress + PROGRESS_PER_SEC * dt);
    bobPhase += dt;
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

// 開発フェーズ: Service Worker は使わない(オフライン再プレイは v1 安定後に再導入)。
// 過去に登録された SW とキャッシュが古い shell を返し続ける事故を防ぐため、
// 登録は行わず、既存の登録・キャッシュを掃除する。sw.js 側も killer に置換済み。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (window.caches) {
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}

// 一時デバッグ HUD(?debug 付き URL のときだけ)。実機で入力が届くか観測する。
// 本番(クエリ無し)では一切動かない。原因特定後に削除する。
if (new URLSearchParams(location.search).has("debug")) {
  const hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;top:0;left:0;z-index:99;background:rgba(0,0,0,.78);" +
    "color:#0f0;font:13px/1.5 monospace;padding:8px 10px;white-space:pre;" +
    "pointer-events:none;border-bottom-right-radius:8px;";
  document.body.appendChild(hud);
  const ev = { pd: 0, pu: 0, ts: 0, tm: 0, click: 0 };
  addEventListener("pointerdown", () => ev.pd++, true);
  addEventListener("pointerup", () => ev.pu++, true);
  addEventListener("touchstart", () => ev.ts++, true);
  addEventListener("touchmove", () => ev.tm++, true);
  addEventListener("click", () => ev.click++, true);
  const upd = () => {
    hud.textContent =
      "BUILD michiyuki-dbg1 (新版)\n" +
      `pointerdown:${ev.pd}  pointerup:${ev.pu}\n` +
      `touchstart:${ev.ts}  touchmove:${ev.tm}  click:${ev.click}\n` +
      `walking:${walking}  paused:${paused}  finished:${finished}\n` +
      `progress:${progress.toFixed(4)}  active:${activeFrag}`;
    requestAnimationFrame(upd);
  };
  upd();
}
