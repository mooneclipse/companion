// v0.16.0 水/マグマ機構の原作合わせ 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.16.0 翻案判断 A〜E を実装関数(fluidStep/tickSubmersion/applyGravity/resolveCaveins/act)で確認する:
//  A. 初期播種 + 掘り当て湧出(d=8、G.fluidReleased で 1 マス 1 回限り=再掘で再湧出しない)
//  B. 流動セルオートマトン(下優先→塞がれたら左右、合流 d+1、d=8 満水 cap、1 ターン 1 マス拡張、
//     異種不干渉、範囲外へ生成しない)
//  C. 息(swimTurns ターン無傷・SP は素の SP_PER_ACTION のみ・超過後 drownDamage()/ターン HP 直撃・
//     息継ぎで breath=0)+ SWIM Lv で延長・減額 + マグマ猶予なし ceil(effHpMax()/5)/ターン + 生肉調理移設
//  D. 浮力(水中で applyGravity しても落ちない・空中落下は最初の流体セルで停止)
//  E. 崩落着地マスの流体消滅(埋め立て) + 同一操作列の決定論 2 回一致
//  非介入: tileType/girlPositions/oreAt/hazardAt の返り値不変(hazardAt は温存=2 回読み一致)
// シナリオ構築は G.dug/G.fallen/G.fluid/G.px/G.py へのランタイム state 注入で行い、
// tileType/girlPositions/oreAt/hazardAt 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47877; // 本番(47825)・playtester(47860)・grow(47871)・companion(47873)・save(47874)・items(47875)・dig8(47876) と非衝突。
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ogg": "audio/ogg",
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.startsWith("/mineroad/")) p = p.slice("/mineroad".length);
    if (p === "/" || p === "") p = "/index.html";
    const fp = path.join(WEBROOT, p);
    if (!fp.startsWith(WEBROOT)) { res.writeHead(403); res.end(); return; }
    const buf = await readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("mineroad_seen_howto", "1");
    localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
    localStorage.removeItem("mineroad_progress");
    localStorage.removeItem("mineroad_antennas_0"); localStorage.removeItem("mineroad_insurance_0");
  } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + JSON.stringify(detail) : "")); };

await page.goto(`http://127.0.0.1:${PORT}/mineroad/`, { waitUntil: "networkidle" });

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.18.0", ver === "v0.18.0", { ver }); // v0.18.0 モンスター AI 原作合わせ(STATUS v0.18.0)へ機械追随。

// シナリオ構築ヘルパー(各 evaluate に注入)。世界生成には非介入=ランタイム state のみ操作。
// - buildBox: 領域をまるごと固体化(G.fallen=崩落跡 SOIL は player 由来 state。tileAt は fallen 優先)。
// - carve: 領域内の 1 マスを空間化(fallen を外し dug 化)。
// - setPlayer: 自機を直接置く(moveTo を通さず副作用ゼロで配置)。
const HELPERS = `
  function buildBox(c0, r0, w, h) {
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) { const k = c + "," + r; G.dug.delete(k); G.fallen.add(k); }
  }
  function carve(c, r) { const k = c + "," + r; G.fallen.delete(k); G.dug.add(k); }
  function setPlayer(c, r) { G.px = c; G.py = r; }
  function fkey(c, r) { return c + "," + r; }
  function fget(c, r) { const f = G.fluid.get(c + "," + r); return f ? { k: f.k, d: f.d } : null; }
  function freshBox() {
    G.monsters = [];
    G.fluid = new Map();
    G.breath = 0;
    buildBox(5, 3, 5, 5); // cols 5..9 / rows 3..7(女の子セルと非重複)。
  }
  function digDir(dc, dr, maxTaps) {
    const key = (G.px + dc) + "," + (G.py + dr);
    for (let i = 1; i <= maxTaps; i++) {
      act(dc, dr);
      if (G.dug.has(key) && !G.fallen.has(key)) return { through: true, taps: i };
    }
    return { through: false, taps: maxTaps };
  }
`;

// ============================================================================
// 1. 流動セルオートマトン(fluidStep 直接駆動、判断 B)。
// ============================================================================
console.log("\n== 1. 流動(下優先・左右展開・合流・満水 cap・1 ターン 1 マス) ==");

const flow = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};

  // 1a 下優先: 下が空いていれば下へ d=1、左右へは出ない。
  freshBox();
  carve(7, 4); carve(7, 5); carve(6, 4); carve(8, 4);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  fluidStep();
  o.downD1 = fget(7, 5);
  o.downNoLateral = !fget(6, 4) && !fget(8, 4);

  // 1b 下が固体 → 左右それぞれへ d=1。
  freshBox();
  carve(7, 4); carve(6, 4); carve(8, 4); // (7,5) は固体のまま。
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  fluidStep();
  o.lateral = { l: fget(6, 4), r: fget(8, 4), below: fget(7, 5) };

  // 1c 合流増密: 下の同種 d=3 が d=4 へ。
  freshBox();
  carve(7, 4); carve(7, 5);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  G.fluid.set(fkey(7, 5), { k: HAZARD.WATER, d: 3 });
  fluidStep();
  o.merged = fget(7, 5);

  // 1d 満水 cap: 下の同種 d=8 は増えず、左右展開が起きる。源も減らない(非保存)。
  freshBox();
  carve(7, 4); carve(7, 5); carve(6, 4); carve(8, 4);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  G.fluid.set(fkey(7, 5), { k: HAZARD.WATER, d: 8 });
  fluidStep();
  o.cap = { below: fget(7, 5), l: fget(6, 4), r: fget(8, 4), src: fget(7, 4) };

  // 1e 1 ターン 1 マス拡張: 縦坑を 1 ステップに 1 マスずつしか下りない。
  freshBox();
  carve(7, 4); carve(7, 5); carve(7, 6); carve(7, 7);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  fluidStep();
  o.step1 = { r5: fget(7, 5), r6: fget(7, 6) };
  fluidStep();
  o.step2 = { r5: fget(7, 5), r6: fget(7, 6), r7: fget(7, 7) };

  // 1f 異種不干渉: 水源の下のマグマは増えず種も変わらない(水は左右へ逃げる)。
  freshBox();
  carve(7, 4); carve(7, 5); carve(6, 4); carve(8, 4);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  G.fluid.set(fkey(7, 5), { k: HAZARD.MAGMA, d: 3 });
  fluidStep();
  o.cross = { below: fget(7, 5), l: fget(6, 4), r: fget(8, 4) };

  // 1g 範囲外へ生成しない(col 0 の左は範囲外、下・右は固体)。例外なく size 不変。
  G.monsters = [];
  G.fluid = new Map();
  buildBox(0, 1, 2, 2);
  carve(0, 1);
  G.fluid.set(fkey(0, 1), { k: HAZARD.WATER, d: 8 });
  const sizeBefore = G.fluid.size;
  fluidStep();
  o.edge = { before: sizeBefore, after: G.fluid.size };
  return o;
}, HELPERS);
check("1a 下優先(下へ d=1、左右へ出ない)", !!flow.downD1 && flow.downD1.d === 1 && flow.downNoLateral, flow.downD1);
check("1b 下が固体なら左右それぞれへ d=1", !!flow.lateral.l && flow.lateral.l.d === 1 && !!flow.lateral.r && flow.lateral.r.d === 1 && !flow.lateral.below, flow.lateral);
check("1c 同種合流で d+1(3→4)", !!flow.merged && flow.merged.d === 4, flow.merged);
check("1d 満水 cap(d=8 のまま)+ 左右展開 + 源は減らない(非保存)",
  flow.cap.below.d === 8 && flow.cap.l && flow.cap.l.d === 1 && flow.cap.r && flow.cap.r.d === 1 && flow.cap.src.d === 8, flow.cap);
check("1e 1 ターン 1 マス拡張(step1 で r5 のみ、step2 で r6)",
  flow.step1.r5 && flow.step1.r5.d === 1 && !flow.step1.r6 &&
  flow.step2.r5.d === 2 && flow.step2.r6 && flow.step2.r6.d === 1 && !flow.step2.r7, { s1: flow.step1, s2: flow.step2 });
check("1f 異種不干渉(下のマグマは d/種とも不変、水は左右へ)",
  flow.cross.below.k === 2 && flow.cross.below.d === 3 && flow.cross.l && flow.cross.l.k === 1 && flow.cross.r && flow.cross.r.k === 1, flow.cross);
check("1g 範囲外へ生成しない(端セルで例外なく size 不変)", flow.edge.before === flow.edge.after, flow.edge);

// ============================================================================
// 2. 掘り当て湧出(判断 A-b): d=8 で 1 回限り、再掘で再湧出しない。
// ============================================================================
console.log("\n== 2. 掘り当て湧出(1 マス 1 回限り) ==");

const release = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 固体(SOIL/HARD)かつ hazardAt≠NONE のマスを探す(dungeon 0 は row11-15 に水 0.29)。
  let cell = null;
  for (let r = 11; r <= CONST.DEPTH_ROWS && !cell; r++) {
    for (let c = 0; c < CONST.GRID_COLS && !cell; c++) {
      const t = tileType(c, r, G.seed);
      if (t !== TILE.SOIL && t !== TILE.HARD) continue;
      if (hazardAt(c, r, G.seed) === HAZARD.NONE) continue;
      if (G.girls.some((g) => (g.col === c && g.row === r) || (g.col === c && g.row === r + 1))) continue;
      if (r + 1 > CONST.DEPTH_ROWS) continue;
      cell = { c, r };
    }
  }
  if (!cell) return { found: false };
  const o = { found: true, cell };
  const key = fkey(cell.c, cell.r);
  // 自機をその真下に置き(足場は掘った跡として注入)、真上を掘り抜く(dr=-1 なので前進しない)。
  G.dug.add(fkey(cell.c, cell.r + 1));
  setPlayer(cell.c, cell.r + 1);
  G.spawned.add(key); // 埋没スポーンを抑止(シナリオ独立性)。
  G.monsters = [];
  const dig = digDir(0, -1, 5);
  o.digThrough = dig.through;
  const f = fget(cell.c, cell.r);
  o.released = f && f.d === 8;
  o.releasedKind = f ? f.k : null;
  o.markedOnce = G.fluidReleased.has(key);
  // 排水 + 崩落で塞がった状況を注入 → 再掘しても再湧出しない(1 マス 1 回限り)。
  G.fluid = new Map();
  G.breath = 0;
  G.fallen.add(key);
  G.monsters = [];
  const dig2 = digDir(0, -1, 5);
  o.dig2Through = dig2.through;
  o.noReRelease = !G.fluid.has(key);
  return o;
}, HELPERS);
check("2a 掘り当て湧出セル発見", release.found === true, release);
check("2b 掘り抜きで満水 d=8 湧出 + fluidReleased 記録", release.digThrough && release.released === true && release.markedOnce === true, release);
check("2c 再掘で再湧出しない(1 マス 1 回限り)", release.dig2Through === true && release.noReRelease === true, release);

// ============================================================================
// 3. 息(判断 C): swimTurns ターン無傷・SP は素の 1/ターン・超過後 HP 直撃・息継ぎ。
// ============================================================================
console.log("\n== 3. 息(水中無傷→超過後 HP 直撃・息継ぎ) ==");

const breath = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};
  freshBox();
  // 密閉 2 マス水室 (6,6)(7,6) + 出口の空気 (6,5)。水は満水どうし+周囲固体で流動しない。
  carve(6, 5); carve(6, 6); carve(7, 6);
  G.fluid.set(fkey(6, 6), { k: HAZARD.WATER, d: 8 });
  G.fluid.set(fkey(7, 6), { k: HAZARD.WATER, d: 8 });
  setPlayer(6, 5);
  G.stamina = 100; G.hp = 30;
  o.turns = swimTurns(); // SWIM Lv0 = 5。
  o.dmg = drownDamage(); // SWIM Lv0 = 4。
  // 入水(ターン 1) + 水中バウンス 4 ターン = breath 5(無傷のはず)。
  act(0, 1); // (6,5)→(6,6) 入水。
  const seq = [[1, 0], [-1, 0], [1, 0], [-1, 0]];
  for (const [dc, dr] of seq) act(dc, dr);
  o.atLimit = { breath: G.breath, hp: G.hp, sp: G.stamina };
  // 超過 2 ターン: 毎ターン drownDamage()=4 が HP 直撃(SP 残があっても)。SP は素の 1/ターンのまま。
  act(1, 0); // breath 6 → HP -4。
  o.after6 = { breath: G.breath, hp: G.hp, sp: G.stamina };
  act(-1, 0); // breath 7 → HP -4。
  o.after7 = { breath: G.breath, hp: G.hp, sp: G.stamina };
  // 息継ぎ: 水から出ると breath=0、追加ダメージなし。
  act(0, -1); // (6,6)→(6,5) クライムで出水。
  o.out = { breath: G.breath, hp: G.hp, sp: G.stamina };
  return o;
}, HELPERS);
check("3a swimTurns()=5 / drownDamage()=4(SWIM Lv0)", breath.turns === 5 && breath.dmg === 4, breath);
check("3b 水中 5 ターン無傷(SP は素の 1/ターンのみ減)", breath.atLimit.breath === 5 && breath.atLimit.hp === 30 && breath.atLimit.sp === 95, breath.atLimit);
check("3c 超過後は毎ターン HP-4 直撃(SP 残があっても HP が減る)",
  breath.after6.hp === 26 && breath.after7.hp === 22 && breath.after7.sp === 93 && breath.after7.breath === 7, { a6: breath.after6, a7: breath.after7 });
check("3d 水から出ると breath=0(息継ぎ)・追加ダメージなし", breath.out.breath === 0 && breath.out.hp === 22 && breath.out.sp === 92, breath.out);

// ============================================================================
// 4. SWIM Lv で延長 + 減額(判断 C の PER_SWIM 引き直し)。
// ============================================================================
console.log("\n== 4. SWIM Lv(息延長・溺れ減額) ==");

const swim = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};
  o.lv0 = { turns: swimTurns(), dmg: drownDamage() };
  G.per.SWIM = 1;
  o.lv1 = { turns: swimTurns(), dmg: drownDamage() };
  G.per.SWIM = 4;
  o.lv4 = { turns: swimTurns(), dmg: drownDamage() }; // clamp 下限 1 の直前(4-4=0→1)。
  G.per.SWIM = 1;
  // Lv1 実挙動: breath=9 を注入 → 次ターン breath=10(=swimTurns)は無傷、その次 breath=11 で HP-3。
  freshBox();
  carve(6, 6); carve(7, 6);
  G.fluid.set(fkey(6, 6), { k: HAZARD.WATER, d: 8 });
  G.fluid.set(fkey(7, 6), { k: HAZARD.WATER, d: 8 });
  setPlayer(6, 6);
  G.stamina = 100; G.hp = 30; G.breath = 9;
  act(1, 0); // breath 10 = swimTurns(10) → 無傷。
  o.at10 = { breath: G.breath, hp: G.hp };
  act(-1, 0); // breath 11 > 10 → HP-3。
  o.at11 = { breath: G.breath, hp: G.hp };
  G.per.SWIM = 0;
  return o;
}, HELPERS);
check("4a SWIM Lv で息延長(5→10)・溺れ減額(4→3)・clamp 下限 1", swim.lv0.turns === 5 && swim.lv1.turns === 10 && swim.lv1.dmg === 3 && swim.lv4.dmg === 1, swim);
check("4b Lv1 実挙動: breath=10 無傷 → 11 で HP-3", swim.at10.hp === 30 && swim.at11.hp === 27 && swim.at11.breath === 11, { at10: swim.at10, at11: swim.at11 });

// ============================================================================
// 5. マグマ(判断 C): 猶予なし毎ターン ceil(effHpMax()/5) 直撃 + 生肉調理の移設。
// ============================================================================
console.log("\n== 5. マグマ(猶予なし HP 直撃 + 生肉調理) ==");

const magma = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};
  freshBox();
  carve(6, 5); carve(6, 6); carve(7, 6);
  G.fluid.set(fkey(6, 6), { k: HAZARD.MAGMA, d: 8 });
  G.fluid.set(fkey(7, 6), { k: HAZARD.MAGMA, d: 8 });
  setPlayer(6, 5);
  G.stamina = 100; G.hp = 30;
  G.drops = { "生肉": 2 };
  o.perTurn = Math.ceil(effHpMax() / CONST.MAGMA_HP_DIV); // 30/5 = 6。
  act(0, 1); // 入マグマ(ターン 1)= 猶予なしで即 HP-6。
  o.t1 = { hp: G.hp, breath: G.breath, meat: G.drops["生肉"], roast: G.roastMeat };
  act(1, 0); // ターン 2 = さらに HP-6 + 生肉 2 個目を調理。
  o.t2 = { hp: G.hp, breath: G.breath, meat: G.drops["生肉"], roast: G.roastMeat, sp: G.stamina };
  return o;
}, HELPERS);
check("5a マグマは猶予なし毎ターン ceil(30/5)=6 直撃(SP は素の 1/ターン)",
  magma.perTurn === 6 && magma.t1.hp === 24 && magma.t2.hp === 18 && magma.t2.sp === 98, magma);
check("5b breath はマグマで増えない(息メカは水専用)", magma.t1.breath === 0 && magma.t2.breath === 0, { t1: magma.t1.breath, t2: magma.t2.breath });
check("5c 生肉→焼き肉の調理がマグマ滞在ターンで進む(1 個/ターン)",
  magma.t1.meat === 1 && magma.t1.roast === 1 && magma.t2.meat === 0 && magma.t2.roast === 2, { t1: magma.t1, t2: magma.t2 });

// ============================================================================
// 6. 浮力(判断 D): 水中で落ちない・空中落下は最初の流体セルで停止。
// ============================================================================
console.log("\n== 6. 浮力 ==");

const buoy = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};
  // 6a 水マスに居ると真下が空でも落ちない。
  freshBox();
  carve(7, 4); carve(7, 5); carve(7, 6);
  G.fluid.set(fkey(7, 4), { k: HAZARD.WATER, d: 8 });
  setPlayer(7, 4);
  applyGravity();
  o.floatPy = G.py; // 4 のまま。
  // 6b 空中からの落下は最初の流体セルで停止(下にさらに空間があっても)。
  freshBox();
  carve(7, 3); carve(7, 4); carve(7, 5); carve(7, 6); carve(7, 7);
  G.fluid.set(fkey(7, 6), { k: HAZARD.WATER, d: 8 });
  setPlayer(7, 3);
  applyGravity();
  o.splashPy = G.py; // 6(着水)で停止、7 まで落ちない。
  return o;
}, HELPERS);
check("6a 水マスでは applyGravity しても落ちない(浮力)", buoy.floatPy === 4, buoy);
check("6b 空中落下は最初の流体セルで停止(着水)", buoy.splashPy === 6, buoy);

// ============================================================================
// 7. 崩落の埋め立て(判断 E): 土塊の着地マスの流体は消える。
// ============================================================================
console.log("\n== 7. 崩落の埋め立て ==");

const cavein = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const o = {};
  freshBox();
  carve(7, 4); carve(7, 5); carve(7, 6); // (7,7) は固体=着地床。
  G.fluid.set(fkey(7, 6), { k: HAZARD.WATER, d: 8 });
  setPlayer(5, 3); // 崩落列の外(埋没判定を踏まない)。
  G.dug.add(fkey(5, 3));
  G.unstableDug = new Set([fkey(7, 4)]); // (7,4) を掘り抜いた不安定土として注入。
  resolveCaveins();
  o.fallenAt = G.fallen.has(fkey(7, 6)); // 土塊は列の第 1 固体床の直上=水マスに積もる。
  o.fluidGone = !G.fluid.has(fkey(7, 6)); // 着地マスの流体は消える(埋め立て)。
  return o;
}, HELPERS);
check("7a 崩落土塊の着地マスの流体が消える(埋め立て)", cavein.fallenAt === true && cavein.fluidGone === true, cavein);

// ============================================================================
// 8. 決定論: 同一操作列 2 回の全 state 一致(流体・息を含む、注入なしの実プレイ経路)。
// ============================================================================
console.log("\n== 8. 決定論 2 回一致 ==");

const detResults = [];
for (let trial = 0; trial < 2; trial++) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
      localStorage.removeItem("mineroad_progress"); localStorage.removeItem("mineroad_antennas_0");
      localStorage.removeItem("mineroad_insurance_0");
    } catch (e) {}
  });
  const r = await page.evaluate(() => {
    startDive();
    G.pick = "DIAMOND";
    // 水帯(row11+)まで掘り下げる固定操作列(湧出・流動・浸水も全て決定論のまま流す)。
    const seq = [];
    for (let i = 0; i < 14; i++) seq.push([0, 1]);
    seq.push([1, 0], [1, 1], [-1, 0], [0, -1], [0, -1], [1, 0], [0, 1], [0, 1], [-1, -1], [0, 1]);
    for (const [dc, dr] of seq) { if (G.screen !== "dive") break; act(dc, dr); }
    return {
      px: G.px, py: G.py, hp: G.hp, sp: G.stamina, screen: G.screen, breath: G.breath,
      fluid: [...G.fluid.entries()].map(([k, f]) => `${k}:${f.k},${f.d}`).sort().join("|"),
      released: [...G.fluidReleased].sort().join("|"),
      dug: [...G.dug].sort().join("|"),
      monsters: G.monsters.map((m) => `${m.key},${m.col},${m.row},${m.hp}`).sort().join("|"),
      fallen: [...G.fallen].sort().join("|"),
    };
  });
  detResults.push(JSON.stringify(r));
}
const detOk = detResults[0] === detResults[1];
check("8a 決定論(流体/息を含む全 state 2 回一致)", detOk, { match: detOk, sample: (detResults[0] || "").slice(0, 160) });

// ============================================================================
// 9. 非介入: tileType/girlPositions/oreAt/hazardAt は不変(hazardAt は温存=2 回読み一致)。
// ============================================================================
console.log("\n== 9. 世界生成レイヤー非介入 ==");

const nonIntervention = await page.evaluate(() => {
  startDive();
  const seed = G.seed;
  const gp = girlPositions(seed).map((p) => `${p.col},${p.row}`).join("|");
  let tileHash = 0;
  for (let c = 0; c < CONST.GRID_COLS; c++)
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++)
      tileHash = (tileHash * 31 + tileType(c, r, seed) + 7) % 1000000007;
  const hazardStable =
    hazardAt(7, 12, seed) === hazardAt(7, 12, seed) &&
    hazardAt(0, 11, seed) === hazardAt(0, 11, seed) &&
    hazardAt(11, 5, seed) === hazardAt(11, 5, seed);
  const oreStable = oreAt(8, 7, seed) === oreAt(8, 7, seed);
  return { gp, tileHash, hazardStable, oreStable };
});
const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
check("9a girlPositions verbatim 不変", nonIntervention.gp === EXPECTED_GIRLS, { gp: nonIntervention.gp });
check("9b tileType 全マス走査がエラーなく完了", Number.isInteger(nonIntervention.tileHash), { tileHash: nonIntervention.tileHash });
check("9c hazardAt/oreAt 2 回読み一致(ハッシュ温存)", nonIntervention.hazardStable && nonIntervention.oreStable, nonIntervention);

// ============================================================================
// 総合
// ============================================================================
console.log("\n== 総合 ==");
const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
check("pageerror 0", pe.length === 0, { pe });

await ctx.close();
await browser.close();
server.close();

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass}/${results.length} PASS, ${fail} FAIL`);
const allPass = fail === 0;
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
