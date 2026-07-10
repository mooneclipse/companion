// probe-companion-surface-walk.mjs
// 目的(事実確認のみ・修正しない): 静的解析が「論理上起きうる」と指摘した現象——
//   「救出済みの女の子を地表(py=0)で同行編成したまま、潜らずに地表を左右に横移動すると、
//    その同行者が即座に別れて清算され(deployed→rescued, settleCompanion で Lv→ストック復帰)、
//    潜行していないのに帰還が成立する」——が、実機相当(Playwright + Chromium, headless)の
//   通常プレイ入力経路で実際に再現するかを観測する。
//
// 検証方針(指示準拠):
//  - state 直注入で「編成済み」状態を作らない。実プレイ経路で踏む:
//      ① act() 入力で実際に掘って女の子を1人救出しストック(rescued)へ入れる(mrRescueGirlAt は
//         act() のみで掘る=following/rescued の state 直代入なし。重い救出経路の現実的最小版として使う)。
//      ② 地表(py=0)に戻る(救出成立時点で自機は地表)。
//      ③ 同行編成は「画面操作」: 工房を #btn-craft で開き #tab-companion を画面座標タップ→
//         #companion-list の「同行」ボタンを画面座標タップ(elementFromPoint で最前面=そのボタンを assert)。
//      ④ 潜らずに地表で左右移動を「実入力経路」で送る: #btn-right / #btn-left を画面座標タップ
//         (タップ前に elementFromPoint で最前面=その D-pad ボタンを assert=overlay/HUD を飛び越えていない)。
//  - 観測: ④の各タップ直後に G.companion / girl.deployed / girl.state / G.rescued / settle ヒントを記録し、
//    「何歩で別れたか」を判定する。
//
// 既存回帰(同一サーバ): 潜行→掘削→追従→救出→地表帰還の通常経路が壊れていないかも軽く確認。
//
// canvas へ直接 dispatch しない(D-pad/overlay の画面座標ヒットテスト経由のみ)。本番 47825 非接触。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47860";
const VW = 412;
const VH = 915;
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

// debug-mineroad.mjs と同じ act() ベースの実プレイ駆動 driver(movement は act 入力、state 直代入なし)。
const MR_DRIVER = `
  function mrStep(dc, dr) {
    const bx = G.px, by = G.py;
    let guard = 0;
    while (G.screen === "dive" && G.px === bx && G.py === by && guard < 8) { act(dc, dr); guard++; }
    return { px: G.px, py: G.py };
  }
  function mrDigTowards(tcol, trow) {
    let guard = 0;
    while (G.screen === "dive" && (G.px !== tcol || G.py !== trow) && guard < 200) {
      guard++;
      if (G.px < tcol) { mrStep(1, 0); continue; }
      if (G.px > tcol) { mrStep(-1, 0); continue; }
      if (G.py < trow) { mrStep(0, 1); continue; }
      if (G.py > trow) { mrStep(0, -1); continue; }
    }
    return { px: G.px, py: G.py };
  }
  function mrClimbToSurface(maxGuard) {
    let guard = 0;
    while (G.screen === "dive" && G.py > 0 && guard < (maxGuard || 400)) {
      guard++;
      const bx = G.px, by = G.py;
      if (isSpace(G.px, G.py - 1)) act(0, -1);
      else if (isSpace(G.px - 1, G.py)) act(-1, 0);
      else if (isSpace(G.px + 1, G.py)) act(1, 0);
      else break;
      if (G.px === bx && G.py === by) break;
    }
    return { px: G.px, py: G.py };
  }
  function mrRescueGirlAt(tcol, trow) {
    G.pick = "DIAMOND";
    G.monsters = []; G.spawned = new Set();
    mrDigTowards(tcol, trow - 1);
    G.monsters = [];
    const g = G.girls.find((x) => x.origCol === tcol && x.origRow === trow);
    const gi = G.girls.indexOf(g);
    let guard = 0;
    while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; }
    G.monsters = [];
    mrClimbToSurface();
    return { gi, state: G.girls[gi].state };
  }
`;

const browser = await chromium.launch();

async function openPage() {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

async function tapSelector(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { tapped: false, wasTop: false };
  const wasTop = await page.evaluate(([sel, px, py]) => {
    const el = document.querySelector(sel);
    const top = document.elementFromPoint(px, py);
    return !!el && !!top && (el === top || el.contains(top) || top.contains(el));
  }, [selector, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(40);
  return { tapped: true, wasTop };
}

// #companion-list の rowIdx 行の .craft-make(「同行」)ボタンを画面座標タップ。最前面=そのボタンを assert。
async function tapCompanionRowBtn(page, rowIdx) {
  const box = await page.evaluate((n) => {
    const rows = document.querySelectorAll("#companion-list .craft-row");
    const row = rows[n];
    if (!row) return null;
    const btn = row.querySelector(".craft-make");
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.textContent };
  }, rowIdx);
  if (!box) return { tapped: false, wasTopBtn: false, label: null };
  const wasTopBtn = await page.evaluate(([n, px, py]) => {
    const rows = document.querySelectorAll("#companion-list .craft-row");
    const btn = rows[n] && rows[n].querySelector(".craft-make");
    const top = document.elementFromPoint(px, py);
    return !!btn && !!top && (top === btn || btn.contains(top) || top.contains(btn));
  }, [rowIdx, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(80);
  return { tapped: true, wasTopBtn, label: box.label };
}

// D-pad の指定ボタンを画面座標タップ。タップ前に最前面=その D-pad ボタンであることを assert(overlay 飛び越え検出)。
async function tapDpad(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { tapped: false, wasTop: false, topEl: "none" };
  const probe = await page.evaluate(([sel, px, py]) => {
    const el = document.querySelector(sel);
    const top = document.elementFromPoint(px, py);
    return {
      wasTop: !!el && !!top && (el === top || el.contains(top) || top.contains(el)),
      topEl: top ? (top.id || top.className || top.tagName) : "none",
    };
  }, [selector, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(30);
  return { tapped: true, wasTop: probe.wasTop, topEl: probe.topEl };
}

async function startToDive(page) {
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(300);
  const scr = await page.evaluate(() => G.screen);
  if (scr === "howto") {
    await tapSelector(page, "#ov-action");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
}

// girl(gi)+companion の観測スナップショット。
async function snap(page, gi) {
  return page.evaluate((gi) => {
    const g = G.girls[gi];
    return {
      px: G.px, py: G.py,
      rescued: G.rescued,
      companionIsGi: G.companion === g,
      companionNull: G.companion === null,
      deployed: !!g.deployed,
      state: g.state,
      level: g.level || 0,
      cexp: g.cexp || 0,
      trailIdx: g.trailIdx,
      trailLen: (G.playerTrail || []).length,
      hint: (document.getElementById("hud-hint") || {}).textContent || "",
    };
  }, gi);
}

// ============================================================================
// 本題: 地表編成 → 潜らず地表横移動(実入力)で同行者が別れるか
// ============================================================================
let reproduced = null; // true / false
let reproStep = null;  // 何歩目で別れたか(1始まり)
const log = [];
{
  console.log("== probe: 救出ストック→地表で同行編成→潜らず地表横移動(実D-pad入力)で別れるか ==");
  const { ctx, page, errors } = await openPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // ① 実プレイ経路で女の子1人を救出(act() のみで掘る。state 直代入なし)。AA/N で使われる既知の到達点 (11,6)。
  const rescue = await page.evaluate((drv) => {
    eval(drv);
    return mrRescueGirlAt(11, 6);
  }, MR_DRIVER);
  out("rescue-result", rescue);
  const afterRescue = await page.evaluate(() => ({
    py: G.py, rescued: G.rescued, giState: G.girls.find((x) => x.origCol === 11 && x.origRow === 6).state,
    companion: G.companion,
  }));
  out("after-rescue", afterRescue);

  const gi = rescue.gi;
  // 救出が実プレイ経路で成立し、自機が地表に居ること(編成の前提)を確認。
  const rescuedOk = afterRescue.rescued >= 1 && afterRescue.giState === "rescued" && afterRescue.py === 0;
  out("rescued-precondition-ok", rescuedOk);

  // ③ 同行編成を画面操作で行う(#btn-craft → #tab-companion → 「同行」ボタンを画面座標タップ)。
  const tapCraft = await tapSelector(page, "#btn-craft");
  await page.waitForTimeout(150);
  const tapTab = await tapSelector(page, "#tab-companion");
  await page.waitForTimeout(120);
  // companion-list の該当行を探す(救出済みの子 = rescued)。1行のみのはず。
  const rowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#companion-list .craft-row")];
    return rows.map((r) => ({
      name: (r.querySelector(".craft-name") || {}).textContent,
      btn: (r.querySelector(".craft-make") || {}).textContent,
    }));
  });
  out("companion-rows", rowInfo);
  const deploy = await tapCompanionRowBtn(page, 0); // 「同行」ボタン画面タップ。
  out("deploy-tap", deploy);
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(100);

  const deployed = await snap(page, gi);
  out("after-deploy", deployed);
  // 編成の前提: companion=その子・deployed=true・following・地表 py=0。
  const deployOk =
    deploy.tapped && deploy.wasTopBtn && deploy.label === "同行" &&
    deployed.companionIsGi && deployed.deployed && deployed.state === "following" && deployed.py === 0;
  out("deploy-precondition-ok", deployOk);

  // ④ 潜らずに地表を横移動(実 D-pad 入力)。各タップ後に別れたか観測する。
  //    地表(行0)は左右に SURFACE/空間が続くので act(±1,0)=moveTo で横歩きできる。
  //    現在の px を見て、盤内に収まる方向を選ぶ。最大 6 歩まで往復で歩いてみる。
  const startPx = deployed.px;
  // 右に動けるなら右、端なら左から始める。盤幅 GRID_COLS は debug 側で取得。
  const cols = await page.evaluate(() => CONST.GRID_COLS);
  const seq = [];
  // px を中央寄りに保ちつつ右→右→左→左… と歩く方向列を作る(端で詰まらない)。
  let dirs = [];
  for (let i = 0; i < 6; i++) {
    // 右端近くなら左、左端近くなら右、それ以外は右優先。
    dirs.push("right");
  }
  // 右端に居る場合は左から。
  const nearRight = startPx >= cols - 2;

  let curState = deployed;
  let separated = false;
  let stepIdx = 0;
  const dpadSeq = nearRight
    ? ["#btn-left", "#btn-left", "#btn-right", "#btn-right", "#btn-left", "#btn-left"]
    : ["#btn-right", "#btn-right", "#btn-left", "#btn-left", "#btn-right", "#btn-right"];

  for (const sel of dpadSeq) {
    stepIdx++;
    const before = await snap(page, gi);
    const tap = await tapDpad(page, sel);
    await page.waitForTimeout(40);
    const after = await snap(page, gi);
    const stepRec = {
      step: stepIdx, dpad: sel,
      tappedTopWasDpad: tap.wasTop, topElAtTap: tap.topEl,
      pxBefore: before.px, pxAfter: after.px, py: after.py,
      companionBefore: before.companionIsGi, companionAfter: after.companionIsGi,
      deployedAfter: after.deployed, stateAfter: after.state,
      level: after.level, hint: after.hint,
    };
    log.push(stepRec);
    out("walk-step", stepRec);
    // 「別れた」判定: 編成中(companion=その子, deployed)だったのが、横移動後に companion=null かつ
    //   deployed=false かつ state=rescued(settleCompanion による清算)になった。
    if (before.companionIsGi && before.deployed && after.companionNull && !after.deployed && after.state === "rescued") {
      separated = true;
      reproStep = stepIdx;
      break;
    }
    // 自機が地表から潜ってしまったら(py>0)、この観測の前提(地表横移動)を外れるので中断。
    if (after.py > 0) {
      out("aborted-left-surface", { step: stepIdx, py: after.py });
      break;
    }
  }

  reproduced = separated;
  out("REPRODUCED", reproduced);
  out("repro-at-step", reproStep);
  out("pageerrors", errors.length);
  if (errors.length) out("pageerror-samples", errors.slice(0, 3));

  await ctx.close();
}

// ============================================================================
// 既存回帰: 通常プレイ経路(潜行→掘削→追従→救出→地表帰還)が壊れていないか(同一サーバ)
// ============================================================================
let regressionOk = false;
let regressionDetail = null;
{
  console.log("== regression: 通常プレイ経路(潜行→掘削→追従→救出→地表帰還)が成立するか ==");
  const { ctx, page, errors } = await openPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);
  const res = await page.evaluate((drv) => {
    eval(drv);
    const before = G.rescued;
    const r = mrRescueGirlAt(11, 6);
    return {
      giState: G.girls[r.gi].state,
      rescuedBefore: before,
      rescuedAfter: G.rescued,
      py: G.py,
      hp: G.hp, stamina: G.stamina,
      hpMax: effHpMax(), stMax: effStaminaMax(),
    };
  }, MR_DRIVER);
  // 救出成立 = state rescued + rescued+1 + 自機地表 + 地表帰還で全回復(hp/stamina が max)。
  regressionOk =
    res.giState === "rescued" && res.rescuedAfter === res.rescuedBefore + 1 &&
    res.py === 0 && res.hp === res.hpMax && res.stamina === res.stMax && errors.length === 0;
  regressionDetail = { ...res, pageerrors: errors.length };
  out("regression", regressionDetail);
  out("regression-ok", regressionOk);
  await ctx.close();
}

await browser.close();

// ============================================================================
// 結論
// ============================================================================
console.log("\n================ 結論 ================");
console.log(`現象の再現: ${reproduced ? "再現する" : "再現しない"}`);
if (reproduced) console.log(`  別れた歩数: ${reproStep} 歩目(地表横移動の入力 ${reproStep} 回目)`);
console.log(`既存回帰(通常救出→帰還): ${regressionOk ? "OK(壊れていない)" : "NG"}`);
console.log("\n--- 横移動ステップ詳細 ---");
for (const s of log) console.log(JSON.stringify(s));
console.log("======================================");

// このスクリプトは事実確認専用。PASS/FAIL ゲートではなく観測値を返すのが目的。
process.exit(0);
