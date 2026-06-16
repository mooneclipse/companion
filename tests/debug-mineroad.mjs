// マインロード v0.1.0 縦切り実機相当デバッグ + 既存 6 作回帰。
// Mine Road 忠実リメイク。自由掘削サイドビュー探索 × スタミナ→体力の二段ゲージ ×
// 地上全回復の撤退判断 × 女の子救出誘導。文字・数値・ゲージ・十字キーは全て DOM、
// canvas にはタイル矩形 + fog + 自機 + 女の子のみ。
//
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す
// (overlay/HUD が pointer を食っていればここで落ちる = みちゆき真因の検出器)。viewport 412x915。
//
// 縦切り判定ゲート(lead 指定):
//  A. /mineroad/ 200 + pageerror 0 + VERSION v0.1.0。title→(初回 あそびかた)→ダイブ遷移。
//     dive 中央の最前面が #scene。HUD が pointer を食わない。
//  B. 二段ゲージ × 地上全回復の撤退の手触り: 行動でスタミナ減 → 0 で体力減 → 体力 0 で力尽き、
//     地表帰還で全回復。決定論。
//  C. 女の子 1 人を掘って見つけて連れ帰る手応え: 発見→追従→地表で救出成功。
//  D. 重力("road"): 足元が空間なら落下。探索率%。
//  E. 十字キー hittable + タップ掘り併存。可読性(412x915 + 短高 412x680/730 はみ出し 0)。
//  F. 既存 6 作回帰(URL 不変・200・pageerror 0)。
//  G. 画面操作 end-to-end(検証専任 playtester 追加。B/C は内部関数直叩きの単体検証なので、
//     #btn-*/canvas タップだけで「掘った縦坑を辿って潜行→自力帰還→全回復」「掘り当て→following
//     →連れ帰り→clear」を最前面ヒットテスト常時で通す = みちゆき "overlay 飛び越え PASS" 同型の
//     穴を塞ぐ。clear overlay のはみ出しも検査)。
//  H. fail(defeat) overlay のはみ出し 0 + retry 押下可(全画面はみ出し 0 を満たすため追加)。
//  I. determinism 静的検査: 配信中の app.js/tiles.js に Math.random/Date.now/performance.now の
//     実呼び出しが無い(行コメント除去後に grep。コメント言及は許容)。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47827";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);
const VW = 412;
const VH = 915;

const browser = await chromium.launch();

async function openPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.vw || VW, height: opts.vh || VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  if (opts.seedHowto) {
    await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

const inOverlayAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && !!e.closest && !!e.closest("#overlay");
  }, [x, y]);

const isSceneAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && e.id === "scene";
  }, [x, y]);

const topElAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return e ? e.id || e.className || e.tagName : "none";
  }, [x, y]);

async function tapSelector(page, selector, nth = 0) {
  const box = await page.evaluate(([sel, n]) => {
    const el = document.querySelectorAll(sel)[n];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [selector, nth]);
  if (!box) return false;
  const ok = await page.evaluate(([sel, n, px, py]) => {
    const target = document.querySelectorAll(sel)[n];
    const top = document.elementFromPoint(px, py);
    return !!top && (target === top || target.contains(top) || top.contains(target));
  }, [selector, nth, box.x, box.y]);
  if (!ok) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  return true;
}

async function buttonHittable(page, selector, nth = 0) {
  return page.evaluate(([sel, n]) => {
    const el = document.querySelectorAll(sel)[n];
    if (!el) return { exists: false };
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) return { exists: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hit = !!top && (el === top || el.contains(top) || top.contains(el));
    return {
      exists: true,
      topInView: r.top >= -0.5,
      bottomInView: r.bottom <= window.innerHeight + 0.5,
      hit,
      rect: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) },
    };
  }, [selector, nth]);
}

async function tileCenter(page, col, row) {
  return page.evaluate(([col, row]) => {
    const t = tile;
    const cam = window.__camY || 0;
    return { x: col * t + t / 2, y: (row - cam) * t + t / 2 };
  }, [col, row]);
}

// 自機隣接 (dc,dr) を 1 タップ(掘る/進む)。最前面が #scene であることを確認。
async function actTap(page, dc, dr) {
  const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const pt = await tileCenter(page, cur.px + dc, cur.py + dr);
  const onScene = await isSceneAt(page, pt.x, pt.y);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
  return { onScene };
}

async function startToDive(page) {
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(300);
  const scr = await page.evaluate(() => G.screen);
  if (scr === "howto") {
    await tapSelector(page, "#ov-action");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
}

async function overflowReport(page, label, vw = VW, vh = VH) {
  return page.evaluate(([lbl, vw, vh]) => {
    const sels = [
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2",
      "#ov-howto", "#ov-howto .howto-line",
      "#depth-val", ".counts", ".count", ".count *",
      ".gauge", ".gauge-row", ".gauge-row *", "#hud-hint",
      ".dpad", ".dpad-btn",
    ];
    const bad = [];
    const seen = new Set();
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const eps = 0.5;
        if (r.left < -eps || r.top < -eps || r.right > vw + eps || r.bottom > vh + eps) {
          bad.push({
            sel,
            tag: (el.id || el.className || el.tagName).toString().slice(0, 40),
            text: (el.textContent || "").trim().slice(0, 24),
            rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) },
          });
        }
      }
    }
    return { label: lbl, overflowCount: bad.length, items: bad.slice(0, 8) };
  }, [label, vw, vh]);
}

const overflowFails = [];

// ============================================================================
// (A) コア遷移 + overlay 飛び越え検出 + 初回 howto + 可読性
// ============================================================================
let corePass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const status = resp ? resp.status() : 0;

  const version = await page.evaluate(() => document.getElementById("ov-version").textContent);
  const screenBefore = await page.evaluate(() => G.screen);
  const inOverlayTitle = await inOverlayAt(page, VW / 2, VH / 2);
  const titleButtons = await page.evaluate(() => ({
    start: document.getElementById("ov-action").textContent,
    howto: document.getElementById("ov-action2").textContent,
    startHidden: document.getElementById("ov-action").hidden,
    howtoHidden: document.getElementById("ov-action2").hidden,
  }));
  const titleOverflow = await overflowReport(page, "title");
  if (titleOverflow.overflowCount > 0) overflowFails.push(titleOverflow);

  const tappedStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(600);
  const screenHowto = await page.evaluate(() => G.screen);
  const howtoInfo = await page.evaluate(() => ({
    lines: document.querySelectorAll("#ov-howto .howto-line").length,
    howtoHidden: document.getElementById("ov-howto").hidden,
    action: document.getElementById("ov-action").textContent,
  }));
  const howtoOverflow = await overflowReport(page, "howto-firstrun");
  if (howtoOverflow.overflowCount > 0) overflowFails.push(howtoOverflow);

  const tappedHowtoStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(900);
  const screenAfter = await page.evaluate(() => G.screen);
  const seenFlag = await page.evaluate(() => localStorage.getItem("mineroad_seen_howto"));

  const sceneAtCenter = await isSceneAt(page, VW / 2, VH * 0.5);
  const topAtCanvasMid = await topElAt(page, VW / 2, VH * 0.55);
  const init = await page.evaluate(() => ({
    screen: G.screen, py: G.py, px: G.px,
    stamina: G.stamina, hp: G.hp, seed: G.seed,
    girlRow: G.girl.row, girlState: G.girl.state,
  }));
  const hudVisible = await page.evaluate(() => !document.getElementById("hud").hidden);
  const diveOverflow = await overflowReport(page, "dive-initial");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== マインロード コア遷移 ==");
  out("status(/mineroad/)", status);
  out("pageerrors", errors);
  out("VERSION 表示", version);
  out("title 中 screen", screenBefore);
  out("title 最前面が overlay subtree", inOverlayTitle);
  out("title ボタン", titleButtons);
  out("もぐる タップ成功", tappedStart);
  out("初回 howto へ", screenHowto);
  out("howto 情報", howtoInfo);
  out("howto もぐる タップ成功", tappedHowtoStart);
  out("howto後 screen", screenAfter);
  out("seen フラグ(=1)", seenFlag);
  out("dive 中央 最前面が #scene(飛び越えなし)", sceneAtCenter);
  out("断面の最前面(HUD が pointer 食わない)", topAtCanvasMid);
  out("HUD 表示", hudVisible);
  out("dive 初期状態", init);

  corePass =
    errors.length === 0 &&
    status === 200 &&
    version === "v0.1.0" &&
    screenBefore === "title" &&
    inOverlayTitle === true &&
    titleButtons.start === "もぐる" &&
    titleButtons.howto === "あそびかた" &&
    titleButtons.startHidden === false &&
    titleButtons.howtoHidden === false &&
    tappedStart === true &&
    screenHowto === "howto" &&
    howtoInfo.lines === 6 &&
    howtoInfo.howtoHidden === false &&
    howtoInfo.action === "もぐる" &&
    tappedHowtoStart === true &&
    screenAfter === "dive" &&
    seenFlag === "1" &&
    sceneAtCenter === true &&
    topAtCanvasMid === "scene" &&
    hudVisible === true &&
    init.py === 0 &&
    init.stamina === 100 &&
    init.hp === 30 &&
    init.girlRow >= 10 && init.girlRow <= 13 &&
    init.girlState === "hidden";
  out("PASS(コア遷移/初回howto/飛び越えなし/可読性)", corePass);
  await ctx.close();
}

// ============================================================================
// (B) 二段ゲージ × 地上全回復の撤退、(C) 女の子救出、(D) 重力 + 探索率、決定論
// ============================================================================
let mechPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { localStorage.removeItem("mineroad_best_depth"); localStorage.removeItem("mineroad_rescued_total"); } catch (e) {} });
  await startToDive(page);

  // --- (B1) 行動でスタミナが減る(実関数 act 経由)。---
  const spDrain = await page.evaluate(() => {
    startDive();
    const sp0 = G.stamina;
    // 真下を掘って進む(土なら 1 手で空間化 → 前進、各行動でスタミナ 1)。
    let acts = 0;
    for (let k = 0; k < 8; k++) {
      const py0 = G.py;
      act(0, 1);
      acts++;
      if (G.py === 0) break; // 地表へ戻ったら止める。
      if (G.py === py0 && G.stamina === sp0) break;
    }
    return { sp0, sp1: G.stamina, drained: G.stamina < sp0, acts };
  });

  // --- (B2) スタミナ 0 → 以降 体力が減る(二段ゲージの核)。---
  const twoStage = await page.evaluate(() => {
    startDive();
    G.py = 5; // 地中(地表で回復しない位置)。
    G.stamina = 2;
    const hp0 = G.hp;
    spendAction(); // sp 2->1
    spendAction(); // sp 1->0
    const spAtZero = G.stamina;
    const hpStill = G.hp; // まだ満タン(sp で吸収)。
    spendAction(); // sp 0 → hp 減る
    spendAction();
    return { spAtZero, hpStill, hpAfter: G.hp, hpDropped: G.hp < hp0, hp0 };
  });

  // --- (B3) 体力 0 で力尽き(地中)→ fail。---
  const failFlow = await page.evaluate(() => {
    startDive();
    G.py = 6;
    G.stamina = 0;
    G.hp = 2;
    spendAction();
    spendAction(); // hp 0
    checkFail();
    return { hp: G.hp, screen: G.screen, title: document.getElementById("ov-title").textContent };
  });

  // --- (B4) 地表帰還で全回復(撤退の報酬)。救出前の帰還は全回復して継続。---
  const recover = await page.evaluate(() => {
    startDive();
    G.py = 8;
    G.stamina = 10;
    G.hp = 12;
    // 地表まで掘り抜いた縦シャフトを用意し、上へ歩いて戻る経路を作る。
    for (let r = 1; r <= 8; r++) G.dug.add(G.px + "," + r);
    // moveTo で地表(row 0)へ。surfaceReturn が全回復するはず。
    G.py = 1;
    moveTo(G.px, 0, true);
    return { stamina: G.stamina, hp: G.hp, screen: G.screen, recovered: G.stamina === 100 && G.hp === 30 };
  });

  // --- (C) 女の子: 縦シャフトを掘って発見→追従→地表で救出成功(clear)。---
  const rescue = await page.evaluate(() => {
    startDive();
    const g = G.girl;
    // 女の子の列に縦シャフトを掘る(自機がその列を降りた帰り道)。
    for (let r = 1; r <= g.row; r++) G.dug.add(g.col + "," + r);
    G.px = g.col; G.py = g.row;
    discoverGirl(g.col, g.row);
    const discovered = G.girl.state;
    // 上へ 1 マスずつ戻る(掘った跡が帰り道)。女の子が追従して一緒に地表へ。
    let guard = 0;
    for (let r = g.row - 1; r >= 0 && guard < 60; r--) {
      G.px = g.col; G.py = r;
      advanceGirl();
      guard++;
      if (r === 0) { surfaceReturn(); break; }
    }
    return {
      discovered,
      girlState: G.girl.state,
      rescued: G.rescued,
      screen: G.screen, // clear
      clearTitle: document.getElementById("ov-title").textContent,
    };
  });

  // --- (C2) 実経路で女の子を掘り当てた直後、誤って「はぐれた」警告(cueGirlBlocked)が出ない。---
  // バグ再現経路: act で女の子マスを掘り抜く → discoverGirl が following + cueGirlFound →
  // moveTo(...,true) 内の advanceGirl が同マスで bfsStep null → 誤って cueGirlBlocked 表示。
  // 同マス早期 return の修正後は cueGirlFound 系のまま、追従も継続することを assert する。
  const discoverHint = await page.evaluate(() => {
    startDive();
    const g = G.girl;
    // 女の子の真上(g.col, g.row-1)へ自機を置き、縦坑を g.row-1 まで掘っておく。
    for (let r = 1; r < g.row; r++) G.dug.add(g.col + "," + r);
    G.px = g.col; G.py = g.row - 1;
    // 真下(=女の子マス)を掘る = 実経路の act(0,1)。土相当の手数で掘り抜き discoverGirl→moveTo。
    let guard = 0;
    while (G.girl.state === "hidden" && guard < 5) { act(0, 1); guard++; }
    const hint = document.getElementById("hud-hint").textContent;
    const hintHidden = document.getElementById("hud-hint").hidden;
    // 文言は app.js TEXT の verbatim(cueGirlFound / cueGirlBlocked)。
    return {
      girlState: G.girl.state,
      hint,
      hintHidden,
      isFoundHint: hint === "女の子を見つけた。地表へ連れ帰ろう",
      isBlockedHint: hint === "道がふさがって女の子がはぐれた。掘り直そう",
    };
  });

  // --- (D1) 重力: 足元が空間なら落下する(applyGravity)。---
  const gravity = await page.evaluate(() => {
    startDive();
    // 自機の真下 2 マスを空間化し、上のマスへ「移動」したら底まで落ちるか。
    const col = G.px;
    G.dug.add(col + ",1");
    G.dug.add(col + ",2");
    G.dug.add(col + ",3");
    G.py = 0;
    // row1 へ移動 → 足元(row2,3)が空間なので落ちる。
    moveTo(col, 1);
    return { landedRow: G.py, fell: G.py > 1 };
  });

  // --- (D2) 上移動 = 掘った縦坑を 1 マスずつ登って地表へ戻れる(全回復ループ)。
  //          固い土の上へは登れない(クライムで岩抜けしない)。---
  const upLimit = await page.evaluate(() => {
    startDive();
    const col = G.px;
    for (let r = 1; r <= 6; r++) G.dug.add(col + "," + r); // 縦坑 row1..6。
    G.py = 6; G.stamina = 50;
    const before = G.py;
    act(0, -1); // 1 マス登る。
    const after1 = G.py;
    act(0, -1); // もう 1 マス。
    const after2 = G.py;
    const climbsOne = after1 === before - 1 && after2 === after1 - 1; // 1 マスずつ確実に登る。
    // 固い土の上へは登れない。
    G.px = 3; G.py = 8; G.dug = new Set();
    const solidBefore = G.py;
    act(0, -1);
    const blockedBySolid = G.py === solidBefore;
    return { before, after1, after2, climbsOne, blockedBySolid, movedOne: climbsOne && blockedBySolid };
  });

  // --- (D3) 探索率%が増える。---
  const explore = await page.evaluate(() => {
    startDive();
    const e0 = exploreRatio();
    // 何マスか掘って可視を広げる。
    for (let k = 0; k < 5; k++) act(0, 1);
    const e1 = exploreRatio();
    return { e0: +(e0 * 100).toFixed(1), e1: +(e1 * 100).toFixed(1), increased: e1 > e0 };
  });

  // --- 決定論: 固定 BASE_SEED で盤面・女の子が毎回一致。---
  const det = await page.evaluate(() => {
    function snap() {
      const t = [];
      for (let r = 1; r <= CONST.DEPTH_ROWS; r++)
        for (let c = 0; c < CONST.GRID_COLS; c++) t.push(tileType(c, r, CONST.BASE_SEED));
      const g = girlPositions(CONST.BASE_SEED).map((x) => x.col + "," + x.row).join("|");
      return { t: t.join(""), g };
    }
    const a = snap(), b = snap();
    const noRandom = typeof Math.random === "function"; // 存在はするが使っていないことは静的検査で担保。
    return { same: a.t === b.t && a.g === b.g, noRandom };
  });

  console.log("== マインロード 核メカ ==");
  out("pageerrors", errors);
  out("(B1) 行動でスタミナ減", spDrain);
  out("(B2) スタミナ0→体力減(二段ゲージ)", twoStage);
  out("(B3) 体力0で力尽き(fail)", failFlow);
  out("(B4) 地表帰還で全回復", recover);
  out("(C) 女の子 発見→追従→地表救出(clear)", rescue);
  out("(C2) 発見直後の hint が cueGirlFound(誤 cueGirlBlocked 抑止)", discoverHint);
  out("(D1) 重力(足元空間で落下)", gravity);
  out("(D2) 上移動は 1 マス", upLimit);
  out("(D3) 探索率% 増加", explore);
  out("決定論(固定 seed 一致)", det);

  mechPass =
    errors.length === 0 &&
    spDrain.drained &&
    twoStage.spAtZero === 0 &&
    twoStage.hpStill === twoStage.hp0 && // sp がある間は hp 減らない
    twoStage.hpDropped && // sp 0 後に hp 減る
    failFlow.hp <= 0 &&
    failFlow.screen === "fail" &&
    failFlow.title === "力尽きた" &&
    recover.recovered &&
    rescue.discovered === "following" &&
    rescue.girlState === "rescued" &&
    rescue.rescued >= 1 &&
    rescue.screen === "clear" &&
    rescue.clearTitle === "救出成功" &&
    discoverHint.girlState === "following" && // 発見後は追従継続
    discoverHint.isFoundHint === true && // 発見直後の表示は cueGirlFound
    discoverHint.isBlockedHint === false && // 誤 cueGirlBlocked が出ていない
    gravity.fell &&
    upLimit.movedOne &&
    explore.increased &&
    det.same;
  out("PASS(二段ゲージ/撤退/救出/重力/探索率/決定論)", mechPass);
  await ctx.close();
}

// ============================================================================
// (E) 十字キー hittable + タップ掘り併存 + 可読性(412x915 + 短高 680/730)
// ============================================================================
let dpadPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  const btnDown = await buttonHittable(page, "#btn-down");
  const btnUp = await buttonHittable(page, "#btn-up");
  const btnLeft = await buttonHittable(page, "#btn-left");
  const btnRight = await buttonHittable(page, "#btn-right");

  // D-pad「下」を画面座標タップで掘って前進(最前面が btn か毎回確認)。
  let dpadMoved = false, dpadAllBtn = true;
  for (let k = 0; k < 8 && !dpadMoved; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    const tapped = await tapSelector(page, "#btn-down");
    if (!tapped) dpadAllBtn = false;
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => G.py);
    if (after !== before.py) dpadMoved = true;
  }

  // タップ掘り(canvas)併存で前進。
  let tapMoved = false, tapAllScene = true;
  for (let k = 0; k < 8 && !tapMoved; k++) {
    const before = await page.evaluate(() => ({ px: G.px, py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    // 下→無理なら横へ。
    let r = await actTap(page, 0, 1);
    if (!r.onScene) tapAllScene = false;
    await page.waitForTimeout(80);
    let after = await page.evaluate(() => ({ px: G.px, py: G.py }));
    if (after.px !== before.px || after.py !== before.py) { tapMoved = true; break; }
    r = await actTap(page, 1, 0);
    if (!r.onScene) tapAllScene = false;
    await page.waitForTimeout(80);
    after = await page.evaluate(() => ({ px: G.px, py: G.py }));
    if (after.px !== before.px || after.py !== before.py) { tapMoved = true; break; }
  }

  const diveOverflow = await overflowReport(page, "dive-hud");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== マインロード 十字キー + タップ掘り ==");
  out("pageerrors", errors);
  out("D-pad 上下左右 hittable", { btnUp, btnDown, btnLeft, btnRight });
  out("D-pad 掘り前進(最前面 btn)", { dpadMoved, dpadAllBtn });
  out("タップ掘り併存 前進(最前面 scene)", { tapMoved, tapAllScene });

  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  dpadPass =
    errors.length === 0 &&
    okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) &&
    dpadMoved && dpadAllBtn &&
    tapMoved && tapAllScene;
  out("PASS(十字キー/タップ掘り)", dpadPass);
  await ctx.close();
}

// ============================================================================
// (E2) 短高 viewport(412x680 / 412x730)で操作必須要素が innerHeight 内・押せる
// ============================================================================
let shortVpPass = false;
{
  async function shortGate(vh) {
    const { ctx, page, errors } = await openPage({ seedHowto: true, vw: VW, vh });
    await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const startBtn = await buttonHittable(page, "#ov-action");
    const howtoBtn = await buttonHittable(page, "#ov-action2");

    await startToDive(page);
    const diveScreen = await page.evaluate(() => G.screen);

    const btnUp = await buttonHittable(page, "#btn-up");
    const btnDown = await buttonHittable(page, "#btn-down");
    const btnLeft = await buttonHittable(page, "#btn-left");
    const btnRight = await buttonHittable(page, "#btn-right");
    const btnSurf = await buttonHittable(page, "#btn-surface");

    let dpadWorks = false;
    for (let k = 0; k < 8 && !dpadWorks; k++) {
      const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (before.scr !== "dive") break;
      await tapSelector(page, "#btn-down");
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => G.py);
      if (after !== before.py) dpadWorks = true;
    }

    const shortOverflow = await overflowReport(page, `dive-short-${vh}`, VW, vh);
    if (shortOverflow.overflowCount > 0) overflowFails.push(shortOverflow);

    const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
    const pass =
      errors.length === 0 &&
      okBtn(startBtn) && okBtn(howtoBtn) &&
      diveScreen === "dive" &&
      okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) && okBtn(btnSurf) &&
      dpadWorks &&
      shortOverflow.overflowCount === 0;

    console.log(`== マインロード 短高 viewport ${VW}x${vh} ==`);
    out("pageerrors", errors);
    out("title もぐる / あそびかた hittable", { startBtn, howtoBtn });
    out("dive 遷移", diveScreen);
    out("十字キー 上下左右/回 hittable", { btnUp, btnDown, btnLeft, btnRight, btnSurf });
    out("短高で D-pad 掘り前進", dpadWorks);
    out(`PASS(短高 ${vh})`, pass);
    await ctx.close();
    return pass;
  }
  const s680 = await shortGate(680);
  const s730 = await shortGate(730);
  shortVpPass = s680 && s730;
  out("PASS(短高 680 & 730)", shortVpPass);
}

// ============================================================================
// (F) 既存 6 作回帰(URL 不変・200・pageerror 0・コア表示)
// ============================================================================
let regressionPass = true;
{
  const games = [
    { url: "/", name: "michiyuki" },
    { url: "/tomoshibi/", name: "tomoshibi" },
    { url: "/nagori/", name: "nagori" },
    { url: "/akari/", name: "akari" },
    { url: "/tomoru/", name: "tomoru" },
    { url: "/saguri/", name: "saguri" },
  ];
  console.log("== 既存 6 作 回帰 ==");
  for (const g of games) {
    const { ctx, page, errors } = await openPage();
    const resp = await page.goto(`${BASE}${g.url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const status = resp ? resp.status() : 0;
    const hasCanvas = await page.evaluate(() => !!document.getElementById("scene"));
    const ok = status === 200 && errors.length === 0 && hasCanvas;
    out(g.name, { url: g.url, status, pageerrors: errors.length, hasCanvas, ok });
    if (!ok) regressionPass = false;
    await ctx.close();
  }
  out("PASS(既存 6 作 回帰)", regressionPass);
}

// ============================================================================
// (G) 画面操作主体の end-to-end(検証専任 playtester 追加)。
//   既存 (B)(C) は内部関数(act/moveTo/discoverGirl/G.dug 手動)を直叩きする単体検証で、
//   「掘った縦坑が実際に登れる帰り道になっているか」「掘り当てで女の子に到達できるか」を
//   画面操作で証明していない(みちゆき "overlay 飛び越え PASS" と同型の穴になり得る)。
//   ここでは #btn-* / canvas タップだけで 潜行→自力クライム帰還→全回復、
//   掘り当て→following→連れ帰り→clear を end-to-end で通す(最前面ヒットテスト常時)。
// ============================================================================
let e2ePass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 隣接マス (dc,dr) を画面座標タップで掘る/進む。掘る前の最前面が #scene であることを返す。
  async function tapTile(dc, dr) {
    const r = await page.evaluate(([dc, dr]) => {
      const t = tile, cam = window.__camY || 0;
      const x = (G.px + dc) * t + t / 2;
      const y = (G.py + dr - cam) * t + t / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, top: top ? top.id : "none" };
    }, [dc, dr]);
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await page.mouse.up();
    return r.top === "scene";
  }

  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(600);
  const startScreen = await page.evaluate(() => G.screen);

  // --- (G1) 撤退ループ: 画面操作で「一直線の縦坑」を掘って潜行 → その縦坑を真上に登って
  //     自力帰還 → 地表で全回復。"掘った縦坑が帰り道になる"(lead 最重要ゲート)を最も
  //     実機に近い形で検証する。蛇行(横穴)を作ると帰路で自分の掘った縦穴に落ちるのは物理的に
  //     正常挙動なので、ここでは縦坑掘り = プレイヤーが意図する帰還可能な掘り方を検証する。
  //     硬岩に当たらない列を地形から選び、その列の真下のみを掘り下げる。
  let allScene = startScreen === "dive";
  // 硬岩(ROCK)が深さ 1..D まで無い列を選ぶ(縦坑が R で詰まらない列)。
  const shaftCol = await page.evaluate(() => {
    const D = 9;
    for (let c = 0; c < CONST.GRID_COLS; c++) {
      let clear = true;
      for (let r = 1; r <= D; r++) if (tileAt(c, r) === TILE.ROCK) { clear = false; break; }
      if (clear) return c;
    }
    return G.px;
  });
  // 地表で目的列へ横移動(地表は安全・落下しない)。
  for (let i = 0; i < 20; i++) {
    const px = await page.evaluate(() => G.px);
    if (px === shaftCol) break;
    if (!(await tapTile(px < shaftCol ? 1 : -1, 0))) allScene = false;
    await page.waitForTimeout(45);
  }
  // 真下のみを掘って一直線の縦坑で潜行(py>=6 まで)。
  for (let k = 0; k < 30; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive" || before.py >= 6) break;
    if (!(await tapTile(0, 1))) allScene = false; // 真下のみ(縦坑を保つ)。
    await page.waitForTimeout(45);
    const afterPy = await page.evaluate(() => G.py);
    if (afterPy === before.py) {
      // HARD(2手)で 1 手目は py 不動 → もう一度真下を掘る(横へは折れない)。
      if (!(await tapTile(0, 1))) allScene = false;
      await page.waitForTimeout(45);
      if ((await page.evaluate(() => G.py)) === before.py) break; // それでも不動なら停止。
    }
  }
  const dived = await page.evaluate(() => ({ py: G.py, sp: G.stamina, px: G.px }));
  // 縦坑を真上に登って帰還(掘った跡が帰り道)。真上 act で 1 マスずつ登る。
  const climbTrace = [];
  for (let k = 0; k < 20; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive" || before.py <= 0) break;
    if (!(await tapTile(0, -1))) allScene = false;
    await page.waitForTimeout(45);
    const now = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    climbTrace.push(now.py);
    if (now.py === before.py) break; // 登れず詰み = 帰り道が成立しない(欠陥サイン)。
    if (now.scr !== "dive" || now.py <= 0) break;
  }
  const recovered = await page.evaluate(() => ({ py: G.py, sp: G.stamina, hp: G.hp, scr: G.screen }));
  const retreatLoopOk =
    dived.py >= 4 && // 実際に潜れた
    recovered.py === 0 && // 縦坑を辿って自力で地表へ戻れた
    recovered.sp === 100 && recovered.hp === 30 && // 全回復
    recovered.scr === "dive";

  // --- (G2) 救出 e2e: 女の子列へ寄せ → 真下掘りで掘り当て(following) → 上掘りで連れ帰り → clear ---
  const girl = await page.evaluate(() => ({ col: G.girl.col, row: G.girl.row }));
  // 女の子列へ横移動。
  for (let i = 0; i < 20; i++) {
    const px = await page.evaluate(() => G.px);
    if (px === girl.col) break;
    if (!(await tapTile(px < girl.col ? 1 : -1, 0))) allScene = false;
    await page.waitForTimeout(45);
  }
  // 真下掘りで掘り当て(列を保ったまま。HARD は 2 手かかるので py 不動でも掘り続ける)。
  let found = false;
  for (let k = 0; k < 40 && !found; k++) {
    const st = await page.evaluate(() => ({ scr: G.screen, gstate: G.girl.state, py: G.py }));
    if (st.scr !== "dive") break;
    if (st.gstate === "following") { found = true; break; }
    if (st.py >= 15) break; // 底まで来たら詰み(到達不能 = 欠陥のサイン)。
    if (!(await tapTile(0, 1))) allScene = false;
    await page.waitForTimeout(45);
  }
  const discovered = await page.evaluate(() => G.girl.state);
  // 連れ帰り(掘った一直線の縦坑を真上 act で 1 マスずつ登る。女の子が追従)。
  // 救出経路は同一列の縦坑なので真上が常に空間 = 登れる(横回避不要)。塞がれば即異常。
  if (found) {
    for (let k = 0; k < 40; k++) {
      const st = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (st.scr !== "dive" || st.py <= 0) break;
      if (!(await tapTile(0, -1))) allScene = false;
      await page.waitForTimeout(45);
      const after = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (after.scr !== "dive") break;
      if (after.py === st.py) break; // 登れず詰み = 帰り道が成立しない(欠陥サイン)。
    }
  }
  const rescueEnd = await page.evaluate(() => ({
    scr: G.screen, gstate: G.girl.state, rescued: G.rescued,
    title: document.getElementById("ov-title").textContent,
  }));
  // clear 画面のはみ出し検査(reward 画面 = lead 必須)。
  const clearOverflow = await overflowReport(page, "clear-overlay");
  if (clearOverflow.overflowCount > 0) overflowFails.push(clearOverflow);
  const rescueE2eOk =
    found && discovered === "following" &&
    rescueEnd.scr === "clear" && rescueEnd.gstate === "rescued" &&
    rescueEnd.rescued >= 1 && rescueEnd.title === "救出成功";

  console.log("== 画面操作 end-to-end(撤退ループ / 救出) ==");
  out("pageerrors", errors);
  out("(G1) 潜行 py/sp", dived);
  out("(G1) クライム帰還 py 列", climbTrace);
  out("(G1) 帰還後(全回復&地表)", recovered);
  out("(G1) 撤退ループ成立", retreatLoopOk);
  out("(G2) 女の子掘り当て(following)", { found, discovered, girl });
  out("(G2) 連れ帰り(clear/rescued)", rescueEnd);
  out("(G2) 救出 e2e 成立", rescueE2eOk);
  out("全操作で最前面が #scene", allScene);

  e2ePass = errors.length === 0 && allScene && retreatLoopOk && rescueE2eOk;
  out("PASS(画面操作 e2e: 撤退ループ + 救出)", e2ePass);
  await ctx.close();
}

// ============================================================================
// (H) fail 画面のはみ出し検査(defeat 画面 = lead 必須。既存は title/howto/dive のみ)
// ============================================================================
let failOverflowPass = true;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);
  // 地中で体力 0 → fail 画面を出す(内部関数で確実に到達。はみ出し検査が目的)。
  await page.evaluate(() => { startDive(); G.py = 6; G.stamina = 0; G.hp = 1; spendAction(); checkFail(); });
  await page.waitForTimeout(500);
  const failScreen = await page.evaluate(() => G.screen);
  const failOverflow = await overflowReport(page, "fail-overlay");
  if (failOverflow.overflowCount > 0) { overflowFails.push(failOverflow); failOverflowPass = false; }
  // retry が押せること。
  const retryBtn = await buttonHittable(page, "#ov-action");
  console.log("== fail 画面 はみ出し + retry ==");
  out("pageerrors", errors);
  out("fail 画面", failScreen);
  out("fail はみ出し件数", failOverflow.overflowCount);
  out("retry ボタン hittable", retryBtn);
  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  failOverflowPass = failOverflowPass && errors.length === 0 && failScreen === "fail" && okBtn(retryBtn);
  out("PASS(fail はみ出し0 + retry 押下可)", failOverflowPass);
  await ctx.close();
}

// ============================================================================
// (I) determinism 静的検査(lead 必須): app.js/tiles.js に Math.random/Date.now/
//     performance.now の実呼び出しが無い(コメント言及は可)。配信中のソースを取得して検査。
// ============================================================================
let determinismPass = true;
{
  console.log("== determinism 静的検査(Math.random/Date.now 実呼び出し) ==");
  for (const f of ["app.js", "tiles.js"]) {
    const src = await (await fetch(`${BASE}/mineroad/${f}`)).text();
    // 行コメント(//...)を除去してから危険トークンを探す(コメント言及は許容)。
    const code = src
      .split("\n")
      .map((ln) => ln.replace(/\/\/.*$/, ""))
      .join("\n");
    const hits = [];
    for (const re of [/Math\.random/g, /Date\.now/g, /performance\.now/g]) {
      const m = code.match(re);
      if (m) hits.push(...m);
    }
    out(`${f} 実呼び出し`, hits);
    if (hits.length > 0) determinismPass = false;
  }
  out("PASS(determinism: ランタイム乱数なし)", determinismPass);
}

// ============================================================================
// 総合
// ============================================================================
await browser.close();

console.log("\n== 総合 ==");
out("(A) コア遷移", corePass);
out("(B/C/D) 二段ゲージ/撤退/救出/重力/探索率/決定論[内部関数]", mechPass);
out("(E) 十字キー/タップ掘り", dpadPass);
out("(E2) 短高 viewport", shortVpPass);
out("(F) 既存 6 作 回帰", regressionPass);
out("(G) 画面操作 e2e[撤退ループ + 救出]", e2ePass);
out("(H) fail はみ出し0 + retry", failOverflowPass);
out("(I) determinism 静的検査", determinismPass);
if (overflowFails.length) {
  console.log("  はみ出し検出:");
  for (const f of overflowFails) console.log("   ", JSON.stringify(f));
}
const allPass =
  corePass && mechPass && dpadPass && shortVpPass && regressionPass &&
  e2ePass && failOverflowPass && determinismPass &&
  overflowFails.length === 0;
console.log(`\nRESULT: ${allPass ? "ALL PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
