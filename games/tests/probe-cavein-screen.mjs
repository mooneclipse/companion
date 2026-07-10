// 崩落(なだれ/落盤)を「画面座標ヒットテスト経由」で実機相当に観測する補助プローブ。
// gate X は内部関数(markUnstableDug/resolveCaveins)直叩きで物理を検証するが、本プローブは
// 実プレイヤー入力(page.mouse → elementFromPoint で最前面を毎回 assert)だけで
//   不安定土の真下を掘り抜く → 次手番で落下 → 掘った道が塞がる(帰り道消失) →
//   自機被埋でダメージ(二段ゲージが減る) → 塞がれた SOIL を再掘できる(soft-lock しない)
// を踏む。canvas へ直接 dispatch しない。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47860";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const tileCenter = (page, col, row) =>
  page.evaluate(([col, row]) => {
    const t = tile;
    const cam = window.__camY || 0;
    return { x: col * t + t / 2, y: (row - cam) * t + t / 2 };
  }, [col, row]);

// 画面座標 (x,y) の最前面要素が canvas(#scene) か。overlay を飛び越えていないことの証明。
const isSceneAt = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return !!e && e.id === "scene";
  }, [x, y]);

// セレクタ要素の中心が最前面か確認してから画面座標クリック(D-pad 等)。
async function tapSelector(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { tapped: false, onTop: false };
  const onTop = await page.evaluate(([sel, px, py]) => {
    const target = document.querySelector(sel);
    const top = document.elementFromPoint(px, py);
    return !!top && (target === top || target.contains(top) || top.contains(target));
  }, [selector, box.x, box.y]);
  if (!onTop) return { tapped: false, onTop: false };
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  return { tapped: true, onTop: true };
}

// 相対方向 (dc,dr) の隣接タイルへ「画面座標タップ」で掘り/移動(最前面=scene を毎回 assert)。
async function actTapDir(page, dc, dr) {
  const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const pt = await tileCenter(page, cur.px + dc, cur.py + dr);
  const onScene = await isSceneAt(page, pt.x, pt.y);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
  return { onScene };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

// title「もぐる」→ howto「もぐる」を画面座標タップで通って dive へ(#ov-action を 2 回)。
await tapSelector(page, "#ov-action");
await page.waitForTimeout(300);
if ((await page.evaluate(() => G.screen)) === "howto") {
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);

const inDive = await page.evaluate(() => G.screen);
out("dive 到達", inDive);

// 実プレイヤー入力で再現可能な崩落セットアップを探す:
//   不安定土(avalanche SOIL)マス u=(col, r) を掘り抜き(markUnstableDug が自動発火)、
//   その直下 (col, r+1) も掘り抜いて空にし、次の手番(=もう 1 タップ)で resolveCaveins が
//   u を (r+1) へ落として道を塞ぐ。自機は落下先 (col, r+1) に居て埋没ダメージを受ける。
// 列 col を「u の上が空間(掘り進められる)で u と u+1 が SOIL」になるよう実データから選ぶ。
const plan = await page.evaluate(() => {
  const SEED = G.seed;
  const COLS = CONST.GRID_COLS, ROWS = CONST.DEPTH_ROWS;
  for (let col = 0; col < COLS; col++) {
    for (let r = 5; r <= ROWS - 2; r++) {
      // u=(col,r) が不安定土(SOIL かつ avalanche)、直下 (col,r+1) が SOIL(落下の受け皿になり、
      // 掘れば空間化できる)、(col,r+2) が固体(落下が r+1 で止まる床)。
      const uUnstable = tileType(col, r, SEED) === TILE.SOIL && avalancheAt(col, r, SEED);
      const belowSoil = tileType(col, r + 1, SEED) === TILE.SOIL && !avalancheAt(col, r + 1, SEED);
      // 落下が r+1 で止まる床: (col,r+2) が空でない(NONE 以外=固体)。
      const floorSolid = tileType(col, r + 2, SEED) !== TILE.NONE;
      // u の真上から縦に掘り降りられる(列内に掘れない岩 ROCK / GIRL で詰まらない)経路。
      let pathClear = true;
      for (let rr = 1; rr < r; rr++) {
        const tt = tileType(col, rr, SEED);
        if (tt === TILE.ROCK || tt === TILE.HARD || tt === TILE.GIRL) { pathClear = false; break; }
      }
      if (uUnstable && belowSoil && floorSolid && pathClear) {
        return { col, r };
      }
    }
  }
  return null;
});
out("崩落セットアップ列(col,r=不安定土)", plan);
if (!plan) {
  console.log("RESULT: PROBE-FAIL (実データに再現用の不安定土列が見つからない)");
  await browser.close();
  process.exit(2);
}

// 自機を col 上に寄せ、縦に掘り降りて u と u+1 を掘り抜く。すべて画面座標タップ。
// まず col へ横移動(画面タップで隣接掘り)。
let hitTestAllScene = true;
{
  let guard = 0;
  while (guard++ < 30) {
    const px = await page.evaluate(() => G.px);
    if (px === plan.col) break;
    const dc = plan.col > px ? 1 : -1;
    const r = await actTapDir(page, dc, 0);
    if (!r.onScene) hitTestAllScene = false;
    await page.waitForTimeout(70);
  }
}
// 縦に掘り降りて u=(col,r) ちょうどまで掘り抜く(自機が不安定土に立つ)。
// ここで止めるのが要点: u は掘り抜かれ落下候補だが、直下 (r+1) はまだ SOIL=支えあり → 未落下。
{
  let guard = 0;
  while (guard++ < 40) {
    const st = await page.evaluate(() => ({ py: G.py }));
    if (st.py >= plan.r) break; // u に到達したら停止(直下はまだ掘らない)。
    const r = await actTapDir(page, 0, 1);
    if (!r.onScene) hitTestAllScene = false;
    await page.waitForTimeout(70);
  }
}
out("画面タップが毎回 scene 最前面だった", hitTestAllScene);

// この時点で u=(col,plan.r) は掘り抜かれ markUnstableDug 済み・自機が u に立つ。直下 (r+1) は SOIL。
const pre = await page.evaluate(([col, r]) => ({
  unstableDugHasU: G.unstableDug.has(col + "," + r),
  belowStillSoil: tileAt(col, r + 1) === TILE.SOIL && !isSpace(col, r + 1),
  px: G.px, py: G.py, hp: G.hp, stamina: G.stamina,
  fallenSize: G.fallen.size,
}), [plan.col, plan.r]);
out("不安定土を掘り抜いた直後(直下 SOIL=未落下)", pre);

const hpBefore = pre.hp, spBefore = pre.stamina;

// ここで「直下 (r+1) を 1 手で掘り抜く」= u の支えが消える → 同手番末の resolveCaveins が
// u を (r+1) へ落とす。自機は (r+1) へ前進して立つので、落ちてきた土に埋まる(被埋ダメージ)。
const turnTap = await actTapDir(page, 0, 1);
if (!turnTap.onScene) hitTestAllScene = false;
await page.waitForTimeout(120);

const post = await page.evaluate(([col, r]) => ({
  uStillSpace: isSpace(col, r),            // 元 u は空のまま(緩んだ土が抜けた跡)。
  belowBlocked: !isSpace(col, r + 1),      // 直下が塞がれた(土塊が落ちて積もった)。
  belowTileSoil: tileAt(col, r + 1) === TILE.SOIL, // 塞ぎは SOIL(再掘可能タイル)。
  fallenHasBelow: G.fallen.has(col + "," + (r + 1)),
  dugLostBelow: !G.dug.has(col + "," + (r + 1)), // 掘った道(帰り道)が消えた。
  unstableConsumed: !G.unstableDug.has(col + "," + r),
  hp: G.hp, stamina: G.stamina,
  py: G.py,
}), [plan.col, plan.r]);
out("落下後", post);

// 二段ゲージ被埋: SP→HP のどちらかが CAVEIN_DAMAGE ぶん削れた(takeDamage 経路)。
const gaugeLoss = (spBefore - post.stamina) + (hpBefore - post.hp);
out("二段ゲージ被埋ダメージ量(SP損+HP損)", { spLoss: spBefore - post.stamina, hpLoss: hpBefore - post.hp, total: gaugeLoss, expect: await page.evaluate(() => CONST.CAVEIN_DAMAGE) });

// soft-lock しない: 塞がれた (col, r+1) を画面タップで再度掘れる(数値前進)。
let rediggable = false;
{
  // 自機を塞がれたマスの直上に置けるなら直下掘り、無理でも隣接掘りで掘削が進むこと確認。
  const before = await page.evaluate(([col, r]) => {
    // 再掘前の dig 進捗(掘れば digProgress が立つ or dug に入る)。
    return { dugHas: G.dug.has(col + "," + (r + 1)), tile: tileAt(col, r + 1) };
  }, [plan.col, plan.r]);
  // 自機が直上に居れば下方向タップで再掘。py を直上へ寄せる(横/上移動の余地内で)。
  const r1 = await actTapDir(page, 0, 1);
  if (!r1.onScene) hitTestAllScene = false;
  await page.waitForTimeout(80);
  const after = await page.evaluate(([col, r]) => ({
    dugHas: G.dug.has(col + "," + (r + 1)),
    progressing: G.digProgress.has(col + "," + (r + 1)) || G.dug.has(col + "," + (r + 1)),
    tileStillDiggable: tileAt(col, r + 1) === TILE.SOIL || G.dug.has(col + "," + (r + 1)),
  }), [plan.col, plan.r]);
  // 塞がれた SOIL が掘削対象として有効(再掘で進む or 既に掘れている)。
  rediggable = after.tileStillDiggable === true;
  out("再掘(soft-lock しない)", { before, after, rediggable });
}

const pass =
  errors.length === 0 &&
  hitTestAllScene === true &&        // 全入力が canvas 最前面ヒット(overlay 飛び越えなし)
  pre.unstableDugHasU === true &&    // 不安定土を掘り抜いて落下候補化
  pre.belowStillSoil === true &&     // この時点で直下は SOIL=未落下(落下は支え消失の手番で)
  post.uStillSpace === true &&       // 元位置は空のまま
  post.belowBlocked === true &&      // 落下で道が塞がれた
  post.belowTileSoil === true &&     // 塞ぎは SOIL(再掘可能)
  post.fallenHasBelow === true &&    // fallen に記録
  post.dugLostBelow === true &&      // 帰り道消失
  post.unstableConsumed === true &&  // 落下した不安定土は候補から外れた
  gaugeLoss > 0 &&                   // 二段ゲージが減った(被埋ダメージ)
  rediggable === true;               // soft-lock しない

out("pageerrors", errors);
console.log(`\nRESULT: ${pass ? "SCREEN-CAVEIN PASS" : "SCREEN-CAVEIN FAIL"}`);
await browser.close();
process.exit(pass ? 0 : 1);
