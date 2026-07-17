// verify-mineroad-dig8.mjs — マインロード v0.15.0「掘削 8 方向の原作合わせ」独立検証(playtester)。
//
// 実装側テスト(selfcheck-mineroad-dig8.mjs / debug-mineroad.mjs gate AF)とは**別実装・別シナリオ**:
// gate AF は afFindCell 探索 + moveTo/G.dug 注入でシナリオを構築するが、本テストは
// 地表スタート (7,0) から**実タップのみ**で掘り進む固定経路(seed 41027 = BASE_SEED+dungeon0 の
// 実測盤面に基づく約 30 手)で全項目を踏む。期待位置・期待 state は盤面ダンプから事前導出した
// 決定論値を直接 assert する。
//
// 入力規律(tests/ ルール): 全入力は page.mouse の画面座標タップ + **タップ直前に elementFromPoint で
// 最前面 = #scene(canvas) を assert**(canvas への直接 dispatch なし = overlay 飛び越え PASS の穴を塞ぐ)。
// タップ座標は canvas getBoundingClientRect + 実 camY(window.__camY、lerp 整定をポーリングで待つ)から
// 独自に算出(debug-mineroad の tileCenter とは別実装)。
//
// state 注入は 3 点のみ(すべてシナリオノイズ除去。世界生成レイヤー tileType/oreAt/girlPositions/
// hazard/avalanche には非介入):
//   ①ダイブ開始時 G.monsters = [](空間スポーン敵の戦闘ノイズ除去)
//   ②G.pick 昇格 WOOD→STONE(プレイヤー進行度 state。power ゲート正負の検証用)
//   ③G.spawned.add("7,8")(埋没スポーン抑止 1 マス。ROCK 真上負例の足場作り)
//
// 検証項目(親指示):
//   V1 斜め隣接タップで行動(斜め下掘り/斜め移動) + 非隣接(Chebyshev 2)タップ無反応
//   V2 はしご無し真上掘り: 複数タップで掘り抜け(HARD 2 タップ)、SP 減を HUD で確認、掘り抜き非移動
//   V3 掘り抜いた真上へ次タップでクライム
//   V4 階段登り: 斜め上を掘る→斜め上へ移動で 1 段上がる
//   V5 負例: 横隣も真上も固体のとき斜め上タップ無反応(SP 不変)
//   V6 power 不足(WOOD vs HARD / STONE vs ROCK)は真上でも掘れない(×ポップ、SP 不変)
//   V7 決定論: 同一 seed で同一操作列を 2 コンテキストで実行し全手のトレース一致
//   V8 既存作回帰: 同一サーバで / /tomoshibi/ /nagori/ /akari/ /mineroad/ /healthz 全 200
//   V9 短高 viewport 412x680 / 412x730 で UI はみ出し 0 + 必須ボタン in-view + タップ機能
//
// 実行: 本番 47825 は使わない。別ポート(既定 47862)で server/app.py を自前起動してから
//   GAMES_BASE=http://127.0.0.1:47862 node tests/verify-mineroad-dig8.mjs
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47862";
const failures = [];
const log = (k, v) => console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
function check(name, cond, detail) {
  log((cond ? "ok " : "NG ") + name, detail === undefined ? cond : detail);
  if (!cond) failures.push(name);
  return cond;
}

const browser = await chromium.launch();

async function openMineroad(vw, vh) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    hasTouch: true,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      localStorage.setItem("mineroad_seen_howto", "1"); // 初回 howto はスキップ(検証対象外)。
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

// 最前面要素の記述子(id 優先)。
const topAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return e ? e.id || e.className || e.tagName : "none";
  }, [x, y]);

// セレクタ中心を実マウスタップ。直前に最前面 = 対象(または内包)を assert。
async function tapEl(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { found: false, front: false };
  const front = await page.evaluate(([sel, x, y]) => {
    const el = document.querySelector(sel);
    const top = document.elementFromPoint(x, y);
    return !!el && !!top && (el === top || el.contains(top) || top.contains(el));
  }, [selector, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  return { found: true, front };
}

// カメラ lerp(camY += Δ*0.2/frame)の整定を実測で待つ(固定 sleep でなく収束ポーリング)。
async function camSettle(page, timeoutMs = 4000) {
  const t0 = Date.now();
  let prev = await page.evaluate(() => window.__camY || 0);
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(120);
    const cur = await page.evaluate(() => window.__camY || 0);
    if (Math.abs(cur - prev) < 0.02) return cur;
    prev = cur;
  }
  return prev;
}

// タイトル(ダンジョン選択)→ダイブ。実マウスタップで最初の解放済みボタンを押す。
async function startDive(page) {
  const t = await tapEl(page, ".dungeon-btn:not([disabled])");
  if (!t.found || !t.front) return { ok: false, t };
  await page.waitForTimeout(400);
  const scr = await page.evaluate(() => G.screen);
  return { ok: scr === "dive", t, scr };
}

// 自機隣接オフセット(dc,dr)のタイル中心へ実マウスタップ。canvas rect + 実 camY から画面座標を独自算出。
// 戻り値 front: タップ点の最前面が #scene だったか(毎手 assert する)。
async function tapTileOffset(page, dc, dr) {
  const p = await page.evaluate(([dc, dr]) => {
    const r = document.getElementById("scene").getBoundingClientRect();
    const cam = window.__camY || 0;
    return {
      x: r.left + (G.px + dc) * tile + tile / 2,
      y: r.top + (G.py + dr - cam) * tile + tile / 2,
    };
  }, [dc, dr]);
  const front = (await topAt(page, p.x, p.y)) === "scene";
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(70);
  return { front, x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
}

// state スナップショット(HUD テキストと内部値の両方。HUD で行動消費を確認するのが V2 の要件)。
const snap = (page) =>
  page.evaluate(() => ({
    px: G.px,
    py: G.py,
    spHud: document.getElementById("stamina-val").textContent,
    hpHud: document.getElementById("hp-val").textContent,
    sp: G.stamina,
    hp: G.hp,
    dugSize: G.dug.size,
    prog: [...G.digProgress.entries()].map((e) => e.join(":")).sort().join("|"),
    ladders: G.ladders,
    placedLadders: G.placedLadders.size,
    screen: G.screen,
  }));

const hasDug = (page, c, r) => page.evaluate(([c, r]) => G.dug.has(c + "," + r), [c, r]);
const warnPopupText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".popup.warn")].map((p) => p.textContent).join(","));
const popupCount = (page) => page.evaluate(() => document.querySelectorAll(".popup").length);

// ============================================================================
// メインシナリオ(実タップ経路)。fail 記録は run 1 のみ(check)、run 2 はトレース照合用に走らせる。
// 戻り値: 全手のトレース(V7 決定論比較に使う)。
// ============================================================================
async function runScenario(recording) {
  const ck = recording ? check : () => {};
  const { ctx, page, errors } = await openMineroad(412, 915);
  const trace = [];
  const rec = async (step) => {
    const s = await snap(page);
    trace.push({ step, ...s });
    return s;
  };

  const dive = await startDive(page);
  ck("シナリオ: ダンジョン選択タップ(最前面)→dive 遷移", dive.ok && dive.t.front, dive);
  // 注入①: 空間スポーン敵を除去(戦闘は本増分の検証対象外。世界生成レイヤー非介入)。
  await page.evaluate(() => { G.monsters = []; });
  await camSettle(page);
  const s0 = await rec("start");
  ck("シナリオ: 開始位置 (7,0)・WOOD・はしご0", s0.px === 7 && s0.py === 0 && s0.ladders === 0 && s0.placedLadders === 0, s0);

  // ---- V1-neg: Chebyshev 距離 2 タップ無反応(dc=+2 / dc=-2,dr=+1 の 2 点) ----
  await page.waitForTimeout(800); // 既存ポップの寿命(700ms)を跨いでから「ポップ 0」を assert する。
  for (const [dc, dr] of [[2, 0], [-2, 1]]) {
    const before = await snap(page);
    const t = await tapTileOffset(page, dc, dr);
    ck(`V1-neg 距離2タップ(${dc},${dr}) 最前面=scene`, t.front, t);
    await page.waitForTimeout(200);
    const after = await snap(page);
    const pops = await popupCount(page);
    ck(`V1-neg 距離2タップ(${dc},${dr}) 完全無反応`,
      JSON.stringify(before) === JSON.stringify(after) && pops === 0,
      { before: `${before.px},${before.py} sp=${before.spHud}`, after: `${after.px},${after.py} sp=${after.spHud}`, pops });
  }
  await rec("v1neg");

  // ---- 地表を左へ 4 歩 (7,0)→(3,0)(タップ移動の基礎動作) ----
  for (let i = 0; i < 4; i++) {
    const t = await tapTileOffset(page, -1, 0);
    ck(`地表歩行${i + 1} 最前面=scene`, t.front, t);
    await camSettle(page, 1500);
  }
  const sWalk = await rec("walk");
  ck("地表歩行 (7,0)→(3,0)", sWalk.px === 3 && sWalk.py === 0, { px: sWalk.px, py: sWalk.py });

  // ---- V1-pos: 斜め下掘り (3,0)→タップ(-1,+1)→(2,1) を掘って前進 ----
  const spA = (await snap(page)).sp;
  let t = await tapTileOffset(page, -1, 1);
  ck("V1 斜め下タップ 最前面=scene", t.front, t);
  let s = await rec("diagDownDig");
  ck("V1 斜め下掘りで (2,1) へ前進 + SP 減(HUD)", s.px === 2 && s.py === 1 && s.sp < spA && s.spHud === String(Math.round(s.sp)),
    { pos: `${s.px},${s.py}`, spHud: s.spHud });
  await camSettle(page);

  // ---- 掘削経路: (2,1)→(3,1)→(3,2)→(3,3)→(3,4)→(4,4) ----
  for (const [dc, dr, ec, er] of [[1, 0, 3, 1], [0, 1, 3, 2], [0, 1, 3, 3], [0, 1, 3, 4], [1, 0, 4, 4]]) {
    t = await tapTileOffset(page, dc, dr);
    if (!t.front) ck(`経路タップ(${dc},${dr}) 最前面=scene`, false, t);
    await camSettle(page, 1500);
    s = await snap(page);
    if (s.px !== ec || s.py !== er) ck(`経路 (${ec},${er}) 到達`, false, { px: s.px, py: s.py });
  }
  s = await rec("path44");
  ck("経路 (4,4) 到達", s.px === 4 && s.py === 4, { px: s.px, py: s.py });

  // ---- V5: 斜め上の前提条件 負例。(4,4) で右(5,4)も真上(4,3)も固体 → (+1,-1) 無反応 ----
  await page.waitForTimeout(800);
  const before5 = await snap(page);
  t = await tapTileOffset(page, 1, -1);
  ck("V5 斜め上タップ(壁中) 最前面=scene", t.front, t);
  await page.waitForTimeout(200);
  const after5 = await snap(page);
  const pops5 = await popupCount(page);
  ck("V5 横隣も真上も固体 → 斜め上タップ完全無反応(SP 不変)",
    JSON.stringify(before5) === JSON.stringify(after5) && pops5 === 0,
    { spBefore: before5.spHud, spAfter: after5.spHud, pos: `${after5.px},${after5.py}`, pops: pops5 });
  await rec("v5neg");

  // ---- V2a: はしご無し真上掘り(SOIL 1 タップ)。掘り抜き後も (4,4) に留まる ----
  const sp2a = (await snap(page)).sp;
  t = await tapTileOffset(page, 0, -1);
  ck("V2a 真上タップ 最前面=scene", t.front, t);
  s = await rec("upDigSoil");
  ck("V2a 真上(4,3)掘り抜き + 自機非移動 + SP 減(HUD) + はしご0",
    (await hasDug(page, 4, 3)) && s.px === 4 && s.py === 4 && s.sp < sp2a &&
    s.spHud === String(Math.round(s.sp)) && s.ladders === 0 && s.placedLadders === 0,
    { pos: `${s.px},${s.py}`, spHud: s.spHud, ladders: s.ladders });

  // ---- V3a: 次タップで掘り抜いた真上へクライム ----
  t = await tapTileOffset(page, 0, -1);
  ck("V3a クライムタップ 最前面=scene", t.front, t);
  s = await rec("climb43");
  ck("V3a クライムで (4,3) へ", s.px === 4 && s.py === 3, { px: s.px, py: s.py });
  await camSettle(page);

  // ---- V4: 階段登り。真上(4,2)を掘る→斜め上(5,2)を掘る(非移動)→斜め上へ移動で 1 段上がる ----
  t = await tapTileOffset(page, 0, -1); // (4,2) 掘り(前提条件「真上が空間」を実掘削で作る)。
  ck("V4 真上(4,2)掘りタップ 最前面=scene", t.front, t);
  s = await snap(page);
  ck("V4 (4,2) 掘り抜き + 非移動", (await hasDug(page, 4, 2)) && s.px === 4 && s.py === 3, { px: s.px, py: s.py });
  t = await tapTileOffset(page, 1, -1); // 斜め上(5,2) 掘削(掘り抜きは非移動)。
  ck("V4 斜め上(5,2)掘りタップ 最前面=scene", t.front, t);
  s = await snap(page);
  ck("V4 斜め上(5,2) 掘り抜き + 非移動", (await hasDug(page, 5, 2)) && s.px === 4 && s.py === 3, { px: s.px, py: s.py });
  t = await tapTileOffset(page, 1, -1); // 空いた斜め上へ移動 = 階段登り(足場(5,3)で重力が止まる)。
  ck("V4 斜め上移動タップ 最前面=scene", t.front, t);
  s = await rec("stairUp");
  ck("V4 階段登りで 1 段上 (5,2)", s.px === 5 && s.py === 2, { px: s.px, py: s.py });
  await camSettle(page);

  // ---- V1: 斜め移動(空間へ)。(5,2)→(-1,+1)→(4,3) は空間 → 重力で (4,4) に落ち着く(決定論) ----
  t = await tapTileOffset(page, -1, 1);
  ck("V1 斜め移動タップ 最前面=scene", t.front, t);
  s = await rec("diagMoveFall");
  ck("V1 斜め移動(空間) + 重力落下で (4,4)", s.px === 4 && s.py === 4, { px: s.px, py: s.py });
  await camSettle(page);

  // ---- HARD 真下の足場へ: (4,4)→(3,5)→(3,6)→(4,6)掘→重力落下(4,7)→(5,7)。(5,6)=HARD の真下に立つ ----
  // ((4,7) は元から空間のため (4,6) を掘ると自機は (4,7) へ落ち着く=盤面ダンプ由来の決定論)。
  for (const [dc, dr, ec, er] of [[-1, 1, 3, 5], [0, 1, 3, 6], [1, 0, 4, 7], [1, 0, 5, 7]]) {
    t = await tapTileOffset(page, dc, dr);
    if (!t.front) ck(`HARD 下段経路タップ(${dc},${dr}) 最前面=scene`, false, t);
    await camSettle(page, 1500);
    s = await snap(page);
    if (s.px !== ec || s.py !== er) ck(`HARD 下段経路 (${ec},${er}) 到達`, false, { px: s.px, py: s.py });
  }
  s = await rec("path57");
  ck("HARD(5,6) 真下 (5,7) に到達", s.px === 5 && s.py === 7, { px: s.px, py: s.py });

  // ---- V6a: WOOD(power1) では真上の HARD(req2) が掘れない(×ポップ、SP 不変) ----
  await page.waitForTimeout(800);
  const before6a = await snap(page);
  t = await tapTileOffset(page, 0, -1);
  ck("V6a 真上 HARD タップ 最前面=scene", t.front, t);
  await page.waitForTimeout(100);
  const warn6a = await warnPopupText(page);
  const after6a = await snap(page);
  ck("V6a WOOD で真上 HARD 掘れず(×表示 + SP 不変 + 非掘削)",
    warn6a.includes("×") && after6a.spHud === before6a.spHud && after6a.sp === before6a.sp &&
    !(await hasDug(page, 5, 6)) && after6a.prog === "" && after6a.px === 5 && after6a.py === 7,
    { warn: warn6a, spHud: after6a.spHud, prog: after6a.prog });
  await rec("v6aHardBlocked");

  // ---- V2b: 注入② pick=STONE(power2)。真上 HARD は 2 タップで掘り抜け(複数タップ+HUD で SP 減) ----
  await page.evaluate(() => { G.pick = "STONE"; });
  const sp2b = (await snap(page)).sp;
  t = await tapTileOffset(page, 0, -1);
  ck("V2b 真上 HARD 1 タップ目 最前面=scene", t.front, t);
  s = await snap(page);
  ck("V2b 1 タップ目: 掘り進み中(progress=1) + 未貫通 + SP 減(HUD) + 非移動",
    s.prog === "5,6:1" && !(await hasDug(page, 5, 6)) && s.sp < sp2b &&
    s.spHud === String(Math.round(s.sp)) && s.px === 5 && s.py === 7,
    { prog: s.prog, spHud: s.spHud });
  t = await tapTileOffset(page, 0, -1);
  ck("V2b 真上 HARD 2 タップ目 最前面=scene", t.front, t);
  s = await rec("upDigHard");
  ck("V2b 2 タップ目で掘り抜け + 自機非移動 + はしご0",
    (await hasDug(page, 5, 6)) && s.px === 5 && s.py === 7 && s.prog === "" && s.ladders === 0 && s.placedLadders === 0,
    { pos: `${s.px},${s.py}`, spHud: s.spHud });

  // ---- V3b: クライムで (5,6) へ ----
  t = await tapTileOffset(page, 0, -1);
  ck("V3b クライムタップ 最前面=scene", t.front, t);
  s = await rec("climb56");
  ck("V3b クライムで (5,6) へ", s.px === 5 && s.py === 6, { px: s.px, py: s.py });
  await camSettle(page);

  // ---- ROCK(7,7) 真下の足場へ: (5,6)→(5,7)→(6,7)H→(6,8)→(7,8) ----
  // (6,7) は HARD=STONE で 2 タップ(1 タップ目は掘り進み非移動)。
  // 注入③: (7,8) の埋没スポーン(SPIDER)を抑止(シナリオ安定化。掘削・移動の検証には非関与)。
  await page.evaluate(() => { G.spawned.add("7,8"); });
  for (const [dc, dr, ec, er, taps] of [
    [0, 1, 5, 7, 1], [1, 0, 6, 7, 2], [0, 1, 6, 8, 1], [1, 0, 7, 8, 1],
  ]) {
    for (let i = 0; i < taps; i++) {
      t = await tapTileOffset(page, dc, dr);
      if (!t.front) ck(`ROCK 下段経路タップ(${dc},${dr})#${i + 1} 最前面=scene`, false, t);
      await camSettle(page, 1500);
    }
    s = await snap(page);
    if (s.px !== ec || s.py !== er) ck(`ROCK 下段経路 (${ec},${er}) 到達`, false, { px: s.px, py: s.py });
  }
  s = await rec("path78");
  ck("ROCK(7,7) 真下 (7,8) に到達", s.px === 7 && s.py === 8, { px: s.px, py: s.py });

  // ---- V6b: STONE(power2) では真上の ROCK(req3) が掘れない(×ポップ、SP 不変) ----
  await page.waitForTimeout(800);
  const before6b = await snap(page);
  t = await tapTileOffset(page, 0, -1);
  ck("V6b 真上 ROCK タップ 最前面=scene", t.front, t);
  await page.waitForTimeout(100);
  const warn6b = await warnPopupText(page);
  const after6b = await snap(page);
  ck("V6b STONE で真上 ROCK 掘れず(×表示 + SP 不変 + 非掘削)",
    warn6b.includes("×") && after6b.spHud === before6b.spHud && after6b.sp === before6b.sp &&
    !(await hasDug(page, 7, 7)) && after6b.prog === "" && after6b.px === 7 && after6b.py === 8,
    { warn: warn6b, spHud: after6b.spHud });
  await rec("v6bRockBlocked");

  // ---- pageerror 0(シナリオ全体) ----
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  ck("シナリオ pageerror 0", pe.length === 0, pe);

  await ctx.close();
  return trace;
}

// ============================================================================
// 実行
// ============================================================================
console.log("== マインロード v0.15.0 掘削 8 方向 独立検証(verify-mineroad-dig8) ==");
console.log(`BASE=${BASE}`);

// V1〜V6: メインシナリオ(run 1、assert 記録あり)。
console.log("\n-- V1〜V6 メインシナリオ(実タップ経路 run 1) --");
const trace1 = await runScenario(true);

// V7: 決定論。fresh コンテキストで同一操作列を再実行し全手トレース照合。
console.log("\n-- V7 決定論(同一操作列 run 2 → トレース照合) --");
const trace2 = await runScenario(false);
const t1s = JSON.stringify(trace1);
const t2s = JSON.stringify(trace2);
check("V7 同一 seed 同一操作列で全手トレース一致(2 回照合)", t1s === t2s,
  { steps: trace1.length, match: t1s === t2s });
if (t1s !== t2s) {
  for (let i = 0; i < Math.max(trace1.length, trace2.length); i++) {
    if (JSON.stringify(trace1[i]) !== JSON.stringify(trace2[i])) {
      log("V7 初回不一致", { run1: trace1[i], run2: trace2[i] });
      break;
    }
  }
}

// V8: 既存作回帰(同一サーバで全 URL 200)。
console.log("\n-- V8 既存作回帰(URL 200) --");
for (const path of ["/", "/tomoshibi/", "/nagori/", "/akari/", "/mineroad/", "/healthz"]) {
  const res = await fetch(`${BASE}${path}`);
  check(`V8 ${path} 200`, res.status === 200, res.status);
}

// V9: 短高 viewport(モバイル Chrome ツールバー表示相当)。headless は実ツールバーの svh 挙動を
// 完全再現できない(svh=vh=innerHeight)ため、innerHeight 内配置 + タップ機能で担保する。
console.log("\n-- V9 短高 viewport 412x680 / 412x730 --");
for (const vh of [680, 730]) {
  const { ctx, page, errors } = await openMineroad(412, vh);
  // タイトル: ダンジョンボタンが in-view + 最前面 + タップで dive 遷移。
  const btnBox = await page.evaluate(() => {
    const el = document.querySelector(".dungeon-btn:not([disabled])");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight };
  });
  check(`V9 ${vh} タイトル: ダンジョンボタン in-view`,
    !!btnBox && btnBox.t >= 0 && btnBox.b <= btnBox.ih, btnBox);
  const dive = await startDive(page);
  check(`V9 ${vh} タイトル: ボタンタップ機能(dive 遷移)`, dive.ok && dive.t.front, dive);
  await camSettle(page);
  // dive: 操作必須ボタンが in-view + 最前面ヒット。
  const btns = ["#btn-up", "#btn-down", "#btn-left", "#btn-right", "#btn-surface",
    "#btn-craft", "#btn-ladder", "#btn-antenna", "#btn-mute"];
  const btnRep = await page.evaluate((sels) => {
    const bad = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { bad.push({ sel, miss: true }); continue; }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const hit = !!top && (el === top || el.contains(top) || top.contains(el));
      if (!(r.top >= 0 && r.bottom <= window.innerHeight && hit))
        bad.push({ sel, t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight, hit });
    }
    return bad;
  }, btns);
  check(`V9 ${vh} dive: 必須ボタン ${btns.length} 個 in-view + ヒット可`, btnRep.length === 0, btnRep);
  // dive: UI テキスト・ボタンのはみ出し 0(可視要素の bounding rect が viewport 内)。
  const overflow = await page.evaluate(() => {
    const sels = [
      "#hud .top-row *", "#hud .gauge-row *", "#hud .counts *", "#depth-val",
      "#inventory *", ".dpad-btn", "#hud-hint",
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2", ".dungeon-btn",
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
        if (r.left < -eps || r.top < -eps || r.right > window.innerWidth + eps || r.bottom > window.innerHeight + eps)
          bad.push({ sel, id: el.id || el.className, rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) } });
      }
    }
    return bad;
  });
  check(`V9 ${vh} dive: UI はみ出し 0`, overflow.length === 0, overflow.slice(0, 5));
  // dive: dpad 左ボタンの実タップで動作(地表 (7,0)→(6,0))。
  const preTap = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const tl = await tapEl(page, "#btn-left");
  await page.waitForTimeout(150);
  const postTap = await page.evaluate(() => ({ px: G.px, py: G.py }));
  check(`V9 ${vh} dive: #btn-left 実タップで移動`,
    tl.front && postTap.px === preTap.px - 1, { front: tl.front, preTap, postTap });
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  check(`V9 ${vh} pageerror 0`, pe.length === 0, pe);
  await ctx.close();
}

await browser.close();

console.log("\n== 総合 ==");
if (failures.length) {
  console.log("  FAIL 項目:");
  for (const f of failures) console.log("   -", f);
}
console.log(`VERIFY RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} (fail=${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
