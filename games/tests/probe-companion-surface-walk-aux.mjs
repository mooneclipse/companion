// probe-companion-surface-walk-aux.mjs
// 補助確認(事実確認のみ): 本体 probe で「右1歩で別れる」が再現したので、
//  (A) 編成直後に何も動かさず観測すると別れていない(=トリガは横移動の入力であって編成自体ではない)
//  (B) 左方向の D-pad でも同様に別れる(方向非依存)
//  (C) 別れる瞬間に level UP 清算(settleCompanion)が走るか(cexp 0 なので Lv は据置だが「別れた」ヒントが出る)
// を確認する。state 直注入はせず、救出→画面操作編成→実 D-pad 入力で踏む。本番 47825 非接触。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47860";
const VW = 412, VH = 915;
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const MR_DRIVER = `
  function mrStep(dc, dr){const bx=G.px,by=G.py;let g=0;while(G.screen==="dive"&&G.px===bx&&G.py===by&&g<8){act(dc,dr);g++;}return{px:G.px,py:G.py};}
  function mrDigTowards(tc,tr){let g=0;while(G.screen==="dive"&&(G.px!==tc||G.py!==tr)&&g<200){g++;if(G.px<tc){mrStep(1,0);continue;}if(G.px>tc){mrStep(-1,0);continue;}if(G.py<tr){mrStep(0,1);continue;}if(G.py>tr){mrStep(0,-1);continue;}}return{px:G.px,py:G.py};}
  function mrClimbToSurface(mg){let g=0;while(G.screen==="dive"&&G.py>0&&g<(mg||400)){g++;const bx=G.px,by=G.py;if(isSpace(G.px,G.py-1))act(0,-1);else if(isSpace(G.px-1,G.py))act(-1,0);else if(isSpace(G.px+1,G.py))act(1,0);else break;if(G.px===bx&&G.py===by)break;}return{px:G.px,py:G.py};}
  function mrRescueGirlAt(tc,tr){G.pick="DIAMOND";G.monsters=[];G.spawned=new Set();mrDigTowards(tc,tr-1);G.monsters=[];const gg=G.girls.find(x=>x.origCol===tc&&x.origRow===tr);const gi=G.girls.indexOf(gg);let g=0;while(G.girls[gi].state==="hidden"&&g<8){act(0,1);g++;}G.monsters=[];mrClimbToSurface();return{gi,state:G.girls[gi].state};}
`;

const browser = await chromium.launch();
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}
async function tap(page, sel) {
  const box = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (!box) return false;
  await page.mouse.move(box.x, box.y); await page.mouse.click(box.x, box.y); await page.waitForTimeout(50); return true;
}
async function tapDpadTop(page, sel) {
  const box = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (!box) return { wasTop: false };
  const wasTop = await page.evaluate(([s, px, py]) => { const el = document.querySelector(s); const t = document.elementFromPoint(px, py); return !!el && !!t && (el === t || el.contains(t) || t.contains(el)); }, [sel, box.x, box.y]);
  await page.mouse.move(box.x, box.y); await page.mouse.click(box.x, box.y); await page.waitForTimeout(40); return { wasTop };
}
async function startToDive(page) {
  await tap(page, "#ov-action"); await page.waitForTimeout(300);
  if (await page.evaluate(() => G.screen) === "howto") { await tap(page, "#ov-action"); await page.waitForTimeout(300); }
  await page.waitForTimeout(400);
}
async function setupRescueAndDeploy(page) {
  await startToDive(page);
  const r = await page.evaluate((drv) => { eval(drv); return mrRescueGirlAt(11, 6); }, MR_DRIVER);
  await tap(page, "#btn-craft"); await page.waitForTimeout(120);
  await tap(page, "#tab-companion"); await page.waitForTimeout(120);
  // 「同行」ボタン(行0)を画面タップ。
  const box = await page.evaluate(() => { const b = document.querySelector("#companion-list .craft-row .craft-make"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.click(box.x, box.y); await page.waitForTimeout(80);
  await tap(page, "#craft-close"); await page.waitForTimeout(80);
  return r.gi;
}
const snap = (page, gi) => page.evaluate((gi) => { const g = G.girls[gi]; return { px: G.px, py: G.py, companion: G.companion === g, deployed: !!g.deployed, state: g.state, level: g.level || 0, trailIdx: g.trailIdx, trailLen: (G.playerTrail || []).length, hint: (document.getElementById("hud-hint") || {}).textContent || "" }; }, gi);

// (A) 編成直後、何も動かさず数百ms 待つ → 別れていないこと。
{
  console.log("== (A) 編成直後に静止 → 別れない(トリガは横移動入力であって編成自体ではない) ==");
  const { ctx, page, errors } = await openPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" }); await page.waitForTimeout(250);
  const gi = await setupRescueAndDeploy(page);
  const s0 = await snap(page, gi); out("just-deployed", s0);
  await page.waitForTimeout(600); // 何も入力しない。
  const s1 = await snap(page, gi); out("after-idle-600ms", s1);
  out("(A)still-companion-when-idle", s1.companion && s1.deployed && s1.state === "following");
  out("pageerrors", errors.length);
  await ctx.close();
}

// (B) 左 D-pad でも別れる(方向非依存)。px=11 なので左に動ける。
{
  console.log("== (B) 左 D-pad で横移動 → 別れる(方向非依存) ==");
  const { ctx, page, errors } = await openPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" }); await page.waitForTimeout(250);
  const gi = await setupRescueAndDeploy(page);
  const before = await snap(page, gi); out("before", before);
  const tap1 = await tapDpadTop(page, "#btn-left");
  const after = await snap(page, gi);
  out("dpad-left-wasTop", tap1.wasTop);
  out("after-left-1step", after);
  out("(B)separated-on-left", before.companion && before.deployed && after.state === "rescued" && !after.deployed && !after.companion);
  out("hint", after.hint);
  out("pageerrors", errors.length);
  await ctx.close();
}

await browser.close();
process.exit(0);
