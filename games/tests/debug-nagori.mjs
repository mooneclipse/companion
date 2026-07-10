// なごり 実機相当デバッグ + ともしび/みちゆき回帰。
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す
// (canvas へ直接 dispatch しない。overlay が残っていれば canvas に届かないことを再現する)。
// 検証項目(なごり):
//   - pageerror 0 (ロード〜全 7 淀み cleared〜ending まで例外ゼロ)
//   - opening をタップで閉じられる(中央の最前面が scene になる)
//   - canvas をドラッグすると線が引かれ画面ピクセル変化率が有意に出る
//     (前作ともしびの「相互作用が控えめ」の逆。ドラッグ前後で明確に画面が変わる)
//   - 淀みに線を通すと cleared(=clearedCount/progress)が前進。全 7 cleared で
//     ズームアウト俯瞰 → ending overlay 到達(dismiss せず終端)
// さらに同じ起動サーバでともしび(`/tomoshibi/`)・みちゆき(`/`)の回帰: 200 + pageerror 0 +
// 長押しで progress 前進(なごり追加で既存 URL を壊していない証明)。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47825";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const VW = 412;
const VH = 915;

// canvas を 16px グリッドで RGB サンプリング(michiyuki/tomoshibi と同手法)。
const sample = (page) =>
  page.evaluate(() => {
    const c = document.getElementById("scene");
    const g = c.getContext("2d");
    const W = c.width,
      H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const o = [];
    for (let y = 0; y < H; y += 16)
      for (let x = 0; x < W; x += 16) {
        const i = (y * W + x) * 4;
        o.push(d[i], d[i + 1], d[i + 2]);
      }
    return o;
  });

// ピクセル差分しきい値 th(なごり初回基準を実測で確定する。みちゆき th=24/ともしび
// th=8 は流用しない)。なごりは乳白の霧(明背景)。1 本目を引くと cleared が増えて
// progress が 0→0.14 へ動き、PALETTE サンプリングで霧色が画面全面で薄く変わるため、
// 低 th では全面が「変化」と判定される。初回実測(412x915・淀み1個を貫く1本ドラッグ
// 前後)の th 曲線: th=16/24→100%, th=32→99.1%, th=48→10.8%, th=64→10.6%,
// th=80→10.2%, th=96→9.5%。th=32→48 に明確な崖があり、th=48 以降は ~10% で平坦に
// 安定する。この平坦域が「全面の微小な霧色シフト」を切り落とし「引いた線・晴れた地形・
// cleared 淀み」という局所の強い変化だけを拾う域。よって th=48 を採用し、合格条件は
// ratio>0.02(2%)とする(実測 10.8% で大きく上回る = 前作の控えめ相互作用の逆)。
// アプリ挙動(線が引かれ霧が退く)は正しく、計測側を局所変化を拾う域に置く調整。
// (この th は新ゲームの初回計測基準であり、同一バグへの 2 周目の場当たり調整ではない)
const TH = 48;
const changed = (a, b) => {
  let c = 0;
  for (let i = 0; i < a.length; i += 3)
    if (
      Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]) >
      TH
    )
      c++;
  return c / (a.length / 3);
};

// 淀み 7 個の画面座標(app.js の決定論配置を再現)。乱数禁止なので静的に計算できる。
//   a=i*2.39996, rad=0.16+((i*3)%5)*0.06, xr=0.5+cos(a)*rad, yr=0.5+sin(a)*rad*0.82
//   screen = {xr*W, yr*H}, 判定半径 r = min(W,H)*0.085
function siltScreens(W, H) {
  const SHORT = Math.min(W, H);
  const r = SHORT * 0.085;
  const arr = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996;
    const rad = 0.16 + ((i * 3) % 5) * 0.06;
    const xr = 0.5 + Math.cos(a) * rad;
    const yr = 0.5 + Math.sin(a) * rad * 0.82;
    arr.push({ x: Math.round(xr * W), y: Math.round(yr * H), r });
  }
  return arr;
}

// 画面座標で「なぞる」: move(始点)→down→中間点を複数 move→up。canvas へ直接
// dispatch せず page.mouse(画面座標→ヒットテスト)で送る。
async function dragLine(page, x0, y0, x1, y1, segs = 12) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    await page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
}

const browser = await chromium.launch();

async function openPage() {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

const topElAt = (page, x, y) =>
  page.evaluate(
    ([px, py]) => {
      const e = document.elementFromPoint(px, py);
      return e ? e.id || e.tagName : "none";
    },
    [x, y]
  );

// 最前面要素が overlay 自身 or その子孫か(= overlay を飛び越えて scene に当たっていない)。
// opening/ending 中は中央が overlay 内の <p>(断章テキスト)になり得るが、それでも
// overlay subtree なので「canvas を飛び越えていない」証明になる(子のクリックも overlay
// の pointerdown ハンドラへ bubble して dismiss される)。
const inOverlayAt = (page, x, y) =>
  page.evaluate(
    ([px, py]) => {
      const e = document.elementFromPoint(px, py);
      if (!e) return false;
      return !!e.closest && !!e.closest("#overlay");
    },
    [x, y]
  );

// ---- なごり ------------------------------------------------------------
let nagoriPass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/nagori/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;

  // opening 中の最前面(overlay subtree であるべき。canvas を飛び越えていない証明)。
  const topBeforeEl = await topElAt(page, VW / 2, VH / 2);
  const inOverlayBefore = await inOverlayAt(page, VW / 2, VH / 2);

  // opening を画面座標クリックで閉じる(最前面=overlay subtree に当たる→dismiss)。
  await page.mouse.click(VW / 2, VH / 2);
  await page.waitForTimeout(1000); // フェードアウト + hidden(800ms) 待ち
  const topAfter = await topElAt(page, VW / 2, VH / 2);

  // --- ドラッグ前後の画面ピクセル変化(最重要要件) ---
  // 淀み 0 (x=272,y=458) を貫く 1 本のドラッグで、線描画 + 霧 reveal + cleared を起こす。
  const silts = siltScreens(VW, VH);
  const s0pos = await page.evaluate(() => progress());
  const before = await sample(page);
  // 淀み0を中心に通る斜めの長い線。
  await dragLine(page, silts[0].x - 90, silts[0].y - 60, silts[0].x + 90, silts[0].y + 60, 14);
  await page.waitForTimeout(120);
  const after = await sample(page);
  const ratioOneDrag = changed(before, after);
  const strokeCount1 = await page.evaluate(() => window.strokes.length);
  const cleared1 = await page.evaluate(() => window.clearedCount);
  const p1 = await page.evaluate(() => progress());

  // --- 残り淀みを 1 個ずつ貫いて全 7 cleared を狙う ---
  // 各淀みを中心に通る短い直線を引く(中心±半径内を確実に通す)。
  for (let i = 1; i < silts.length; i++) {
    const s = silts[i];
    await dragLine(page, s.x - 50, s.y - 30, s.x + 50, s.y + 30, 10);
    await page.waitForTimeout(120);
  }
  const clearedAll = await page.evaluate(() => window.clearedCount);
  const pAll = await page.evaluate(() => progress());
  const strokeCountAll = await page.evaluate(() => window.strokes.length);

  // --- 達成: ズームアウト → ending overlay 到達を待つ ---
  // beginEnding 後、7本目断章 delay(1.2s) + ZOOM_SECONDS(2.6s) 経過で ending 表示。
  let endingShown = "n/a";
  let topAtEnding = "n/a";
  let inOverlayEnding = false;
  if (clearedAll >= 7) {
    await page.waitForTimeout(5200);
    endingShown = await page.evaluate(() => overlayShown);
    // ending overlay は dismiss せず終端。中央の最前面が overlay subtree(再び canvas を覆う)。
    topAtEnding = await topElAt(page, VW / 2, VH / 2);
    inOverlayEnding = await inOverlayAt(page, VW / 2, VH / 2);
  }

  console.log("== なごり 実機相当(画面座標ヒットテスト) ==");
  out("status(/nagori/)", status);
  out("pageerrors", errors);
  out("opening中の最前面要素", topBeforeEl);
  out("opening中 最前面が overlay subtree 内か", inOverlayBefore);
  out("dismiss後の最前面(scene であるべき)", topAfter);
  out("採用しきい値 th", TH);
  out("1本ドラッグ前後の画面変化率", +(ratioOneDrag * 100).toFixed(2) + "%");
  out("1本ドラッグ後の strokes 数", strokeCount1);
  out("1本ドラッグ後の clearedCount", cleared1);
  out("1本ドラッグ後の progress()", +p1.toFixed(3));
  out("全淀みなぞり後の clearedCount(/7)", clearedAll);
  out("全淀みなぞり後の progress()", +pAll.toFixed(3));
  out("全淀みなぞり後の strokes 数", strokeCountAll);
  out("ending overlayShown(達成後)", endingShown);
  out("ending時の最前面要素", topAtEnding);
  out("ending時 最前面が overlay subtree 内か", inOverlayEnding);

  nagoriPass =
    errors.length === 0 &&
    status === 200 &&
    inOverlayBefore === true &&
    topAfter === "scene" &&
    strokeCount1 >= 1 &&
    ratioOneDrag > 0.02 &&
    cleared1 >= 1 &&
    p1 > s0pos &&
    clearedAll >= 7 &&
    pAll >= 1 &&
    endingShown === "ending" &&
    inOverlayEnding === true;
  out("PASS(なごり: なぞる→淀み全 clear→俯瞰 ending)", nagoriPass);
  await ctx.close();
}

// ---- ともしび 回帰 -----------------------------------------------------
let tomoshibiPass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/tomoshibi/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;

  await page.mouse.click(206, 457);
  await page.waitForTimeout(1000);
  const topEl = await topElAt(page, 206, 457);

  await page.mouse.move(206, 457);
  const p0 = await page.evaluate(() => progress);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const wlk = await page.evaluate(() => walking);
  await page.waitForTimeout(3000);
  const p1 = await page.evaluate(() => progress);
  await page.mouse.up();
  const dP = p1 - p0;

  await page.waitForTimeout(200);
  const rip0 = await page.evaluate(() => window.ripples.length);
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(206, 500);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  const ripMax = await page.evaluate(() => window.ripples.length);

  console.log("== ともしび 回帰(URL 不変の証明) ==");
  out("status(/tomoshibi/)", status);
  out("pageerrors", errors);
  out("中央の最前面要素", topEl);
  out("down直後 walking", wlk);
  out("progressΔ(3s)", dP);
  out("呼び声 波紋数(短タップ4回直後)", ripMax);

  tomoshibiPass =
    errors.length === 0 &&
    status === 200 &&
    topEl === "scene" &&
    wlk === true &&
    dP > 0 &&
    ripMax > rip0;
  out("PASS(ともしび 回帰)", tomoshibiPass);
  await ctx.close();
}

// ---- みちゆき 回帰 -----------------------------------------------------
let michiyukiPass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;

  await page.mouse.click(206, 457);
  await page.waitForTimeout(1000);
  const topEl = await topElAt(page, 206, 457);

  await page.mouse.move(206, 457);
  const p0 = await page.evaluate(() => progress);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const wlk = await page.evaluate(() => walking);
  await page.waitForTimeout(3000);
  const p1 = await page.evaluate(() => progress);
  await page.mouse.up();
  const dP = p1 - p0;

  console.log("== みちゆき 回帰(URL 不変の証明) ==");
  out("status(/)", status);
  out("pageerrors", errors);
  out("中央の最前面要素", topEl);
  out("down直後 walking", wlk);
  out("progressΔ(3s)", dP);

  michiyukiPass =
    errors.length === 0 && status === 200 && topEl === "scene" && wlk === true && dP > 0;
  out("PASS(みちゆき 回帰)", michiyukiPass);
  await ctx.close();
}

await browser.close();
const allPass = nagoriPass && tomoshibiPass && michiyukiPass;
console.log("== 総合 ==");
out("ALL PASS", allPass);
process.exit(allPass ? 0 : 1);
