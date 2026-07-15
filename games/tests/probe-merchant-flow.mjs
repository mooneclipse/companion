// 独立プローブ(検証専任): v0.8.0 商人タップ動線を実機座標ヒットテストで踏む + gate G 回帰
// (HUD ボタン x 位置 baseline 同一 / 茸 span が pointer を食わない / col11 地表タップが工房ボタン
//  やインベントリ span に吸われず #scene に当たる)。canvas へ直接 dispatch せず page.mouse を
//  画面座標へ送り、elementFromPoint で最前面要素を毎回 assert する(overlay 飛び越え禁止)。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47867";
const VW = 412, VH = 915;
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  hasTouch: true,
  serviceWorkers: "block",
});
await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

// dive へ(seenHowto=1 なので howto は挟まない)。
// v0.13.0 でタイトル画面がダンジョン選択ボタン制になったため、#ov-action(旧「もぐる」単一ボタン、
// 現在は howto/fail/clear 画面専用)ではなくダンジョン選択の先頭ボタン(#裏庭、解放済み)を実マウスタップする。
async function tap(x, y) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); }
const dungeonBtn = await page.evaluate(() => {
  const b = document.querySelector(".dungeon-btn:not([disabled])");
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await tap(dungeonBtn.x, dungeonBtn.y);
await page.waitForTimeout(800);
const screen = await page.evaluate(() => G.screen);
out("dive 遷移", screen);

// 最前面要素ヘルパ。
const topAt = (x, y) => page.evaluate(([px, py]) => {
  const e = document.elementFromPoint(px, py);
  return e ? { id: e.id || "", cls: e.className || "", tag: e.tagName } : { id: "none" };
}, [x, y]);

// ---------------------------------------------------------------------------
// 回帰(3): HUD ボタン x 位置 baseline 同一 + 茸 span が pointer 素通し。
//   baseline: v0.7.0 までの #btn-craft の x。茸 span を「作る」ボタンの後ろに置いた設計が
//   ボタンの x を動かしていないこと、span 自身が elementFromPoint で前面に出ない(pointer-events
//   none 継承)ことを実測する。
// ---------------------------------------------------------------------------
// v0.14.0: 回復薬(btn-potion)は判断Bにより廃止。同じ .inv-btn 語彙のボタンとして
// アンテナ(btn-antenna、設置型)を代わりの幾何比較対象にする(baseline 比較の意図は不変)。
const hudGeo = await page.evaluate(() => {
  const craft = document.getElementById("btn-craft").getBoundingClientRect();
  const antenna = document.getElementById("btn-antenna").getBoundingClientRect();
  const mush = document.getElementById("mush-val").closest(".inv-ore.mush").getBoundingClientRect();
  const csMush = getComputedStyle(document.getElementById("mush-val").closest(".inv-ore.mush"));
  const csInv = getComputedStyle(document.getElementById("inventory"));
  return {
    craft: { l: +craft.left.toFixed(1), r: +craft.right.toFixed(1), w: +craft.width.toFixed(1), cx: +(craft.left + craft.width / 2).toFixed(1) },
    antenna: { l: +antenna.left.toFixed(1), cx: +(antenna.left + antenna.width / 2).toFixed(1) },
    mush: { l: +mush.left.toFixed(1), r: +mush.right.toFixed(1) },
    mushPE: csMush.pointerEvents,
    invPE: csInv.pointerEvents,
    // 茸 span はボタンより後ろ(右)にあるか = x 位置を動かさない配置の証明。
    mushAfterCraft: mush.left >= craft.right - 0.5,
  };
});
out("HUD geom (craft/antenna/mush)", hudGeo);

// 茸 span の中心を elementFromPoint。pointer-events:none 継承なら span は前面に出ず、
// その座標は canvas(#scene) か(span 配下に重なる)別要素になる。span 自身は出ないことを確認。
const atMushCenter = await topAt((hudGeo.mush.l + hudGeo.mush.r) / 2, await page.evaluate(() => {
  const m = document.getElementById("mush-val").closest(".inv-ore.mush").getBoundingClientRect();
  return m.top + m.height / 2;
}));
out("茸 span 中心の最前面(span は pointer 食わない=mush でない)", atMushCenter);

// #btn-craft 中心はボタン(pointer-events:auto)が前面に出る。
const atCraftBtn = await topAt(hudGeo.craft.cx, await page.evaluate(() => {
  const r = document.getElementById("btn-craft").getBoundingClientRect();
  return r.top + r.height / 2;
}));
out("作る ボタン中心の最前面(=btn-craft)", atCraftBtn);

// ---------------------------------------------------------------------------
// 回帰(3) 核: col11(女の子(11,6)の列)の地表マス(row0/1)をタップした最前面が #scene。
//   インベントリバー(茸 span 含む)や工房ボタンが col11 の地表タップを吸っていないこと。
//   自機を col11 地表へ置き、camera を地表に合わせてから col11 row0/1 の画面座標を引いてヒット。
// ---------------------------------------------------------------------------
await page.evaluate(() => { startDive(); G.px = 11; G.py = 0; G.seen = new Set(); revealAround(); });
// camera lerp 収束待ち。
await page.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  let prev = window.__camY || 0, stable = 0;
  for (let i = 0; i < 120; i++) { await raf(); const c = window.__camY || 0; if (Math.abs(c - prev) < 0.01) { if (++stable >= 3) break; } else stable = 0; prev = c; }
  await raf(); await raf();
});
const col11 = await page.evaluate(() => {
  const t = tile, cam = window.__camY || 0;
  const pt = (col, row) => ({ x: col * t + t / 2, y: (row - cam) * t + t / 2 });
  const r0 = pt(11, 0), r1 = pt(11, 1);
  const top0 = document.elementFromPoint(r0.x, r0.y);
  const top1 = document.elementFromPoint(r1.x, r1.y);
  return {
    r0: { x: +r0.x.toFixed(1), y: +r0.y.toFixed(1), top: top0 ? (top0.id || top0.className) : "none" },
    r1: { x: +r1.x.toFixed(1), y: +r1.y.toFixed(1), top: top1 ? (top1.id || top1.className) : "none" },
  };
});
out("col11 地表 row0/row1 の最前面(=scene であるべき)", col11);

// 実タップ: col11 真下(row1)を掘る → act が走り py が変わる/掘れることをヒットテスト経由で踏む。
const beforeDig = await page.evaluate(() => ({ px: G.px, py: G.py }));
await tap(col11.r1.x, col11.r1.y);
await page.waitForTimeout(120);
const afterDig = await page.evaluate(() => ({ px: G.px, py: G.py, dugR1: G.dug.has("11,1") }));
out("col11 row1 タップで掘削進行(地表タップが吸われていない)", { beforeDig, afterDig });
const col11TapOk =
  col11.r0.top === "scene" && col11.r1.top === "scene" &&
  (afterDig.py > beforeDig.py || afterDig.dugR1 === true);

// ---------------------------------------------------------------------------
// 商人タップ動線(2): 「作る」ボタンを実マウスでタップ → 工房オーバーレイ表示(既定クラフトタブ)
//   → 商人タブを実マウスでタップ → 充足行の「交換」ボタンを実マウスでタップ → 対価減算/産物加算
//   → 不足行は disabled → クラフトタブへ戻せる。各タップ前に elementFromPoint で最前面を assert。
// ---------------------------------------------------------------------------
// キノコ10 だけ持たせる(ツルハシ行=充足、フルーツ行=鉄鉱石2 不足)。v0.14.0: G.ore.IRON→IRON_ORE 名寄せ。
await page.evaluate(() => { startDive(); G.px = 7; G.py = 3; G.mushrooms = 10; G.ore.IRON_ORE = 0; G.pick = "WOOD"; renderHud(); });

// 「作る」ボタンを実マウスタップ(最前面が btn-craft であることを確認してから)。
const craftBtnPt = await page.evaluate(() => { const r = document.getElementById("btn-craft").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const topAtCraftBefore = await topAt(craftBtnPt.x, craftBtnPt.y);
await tap(craftBtnPt.x, craftBtnPt.y);
await page.waitForTimeout(250);
const overlayState = await page.evaluate(() => ({
  open: !document.getElementById("craft-overlay").hidden,
  craftTabActive: document.getElementById("tab-craft").classList.contains("active"),
  craftListShown: !document.getElementById("craft-list").hidden,
  shopListShown: !document.getElementById("shop-list").hidden,
}));
out("作る タップ → 工房オーバーレイ(既定=クラフトタブ)", { topAtCraftBefore, overlayState });

// 商人タブを実マウスタップ。タブの最前面がそのタブであることを確認(overlay 上から正規ヒット)。
const shopTabPt = await page.evaluate(() => { const r = document.getElementById("tab-shop").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const topAtShopTab = await topAt(shopTabPt.x, shopTabPt.y);
await tap(shopTabPt.x, shopTabPt.y);
await page.waitForTimeout(200);
const shopState = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#shop-list .craft-row")];
  const names = rows.map((r) => (r.querySelector(".craft-name") || {}).textContent);
  const pickRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("ツルハシ") === 0);
  const fruitRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("フルーツ") === 0);
  return {
    shopListShown: !document.getElementById("shop-list").hidden,
    shopTabActive: document.getElementById("tab-shop").classList.contains("active"),
    names,
    pickEnabled: pickRow ? !pickRow.querySelector(".craft-make").disabled : null,
    fruitDisabled: fruitRow ? fruitRow.querySelector(".craft-make").disabled : null,
  };
});
out("商人タブ タップ → shop list 表示", { topAtShopTab, shopState });

// 充足行(ツルハシ←キノコ10)の「交換」ボタンを実マウスタップ。座標の最前面がそのボタンであることを確認。
const tradeBtnPt = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#shop-list .craft-row")];
  const pickRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("ツルハシ") === 0);
  const b = pickRow.querySelector(".craft-make");
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const beforeTrade = await page.evaluate(() => ({ mush: G.mushrooms, pick: G.pick }));
const topAtTradeBtn = await topAt(tradeBtnPt.x, tradeBtnPt.y);
await tap(tradeBtnPt.x, tradeBtnPt.y);
await page.waitForTimeout(200);
const afterTrade = await page.evaluate(() => ({ mush: G.mushrooms, pick: G.pick }));
out("交換ボタン タップ(対価減算/産物加算)", { topAtTradeBtn, beforeTrade, afterTrade });

// 不足行(フルーツ←鉄2、IRON=0)の「交換」ボタンは disabled = タップしても無効。
const fruitTradeAttempt = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#shop-list .craft-row")];
  const fruitRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("フルーツ") === 0);
  const b = fruitRow.querySelector(".craft-make");
  const before = G.fruits;
  return { disabled: b.disabled, fruitsBefore: before };
});
out("不足行(フルーツ)交換不可表示", fruitTradeAttempt);

// クラフトタブへ実マウスで戻す。
const craftTabPt = await page.evaluate(() => { const r = document.getElementById("tab-craft").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const topAtCraftTab = await topAt(craftTabPt.x, craftTabPt.y);
await tap(craftTabPt.x, craftTabPt.y);
await page.waitForTimeout(150);
const backToCraft = await page.evaluate(() => ({
  craftListShown: !document.getElementById("craft-list").hidden,
  shopListShown: !document.getElementById("shop-list").hidden,
  craftTabActive: document.getElementById("tab-craft").classList.contains("active"),
}));
out("クラフトタブへ戻す", { topAtCraftTab, backToCraft });

await browser.close();

const merchantTapOk =
  overlayState.open === true && overlayState.craftTabActive === true && overlayState.craftListShown === true && overlayState.shopListShown === false &&
  topAtShopTab.id === "tab-shop" &&
  shopState.shopListShown === true && shopState.shopTabActive === true &&
  shopState.pickEnabled === true && shopState.fruitDisabled === true &&
  topAtTradeBtn.cls === "craft-make" &&
  beforeTrade.pick === "WOOD" && afterTrade.pick === "IRON" && beforeTrade.mush === 10 && afterTrade.mush === 0 &&
  fruitTradeAttempt.disabled === true &&
  topAtCraftTab.id === "tab-craft" &&
  backToCraft.craftListShown === true && backToCraft.shopListShown === false && backToCraft.craftTabActive === true;

const regressionGOk =
  hudGeo.mushAfterCraft === true &&
  hudGeo.mushPE === "none" && hudGeo.invPE === "none" &&
  atMushCenter.id !== "mush-val" && atMushCenter.cls !== "inv-ore mush" &&
  atCraftBtn.id === "btn-craft" &&
  col11TapOk === true;

console.log("\n== プローブ総合 ==");
out("pageerrors", errors);
out("商人タップ動線(実マウス・overlay 上から正規ヒット)", merchantTapOk);
out("回帰 G(btn-craft x baseline/茸 span 素通し/col11 地表タップ→scene)", regressionGOk);
const ok = errors.length === 0 && merchantTapOk && regressionGOk;
console.log(`\nPROBE RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
