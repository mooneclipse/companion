// v0.18.0 モンスター AI/活動範囲の原作合わせ 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.18.0 翻案判断 A〜G を実装関数(monstersAct/monsterStep/tryBumpGate/monsterWander/
// buriedTick/attackMonster)で確認する(判断 H の項目列挙どおり):
//  ・活動箱 16(MONSTER_ACTIVE_RANGE): 圏外個体の座標/SP/tk/rc/hp 完全凍結(active・buried とも)
//  ・despawn AND 条件(MONSTER_DESPAWN_RANGE): 片軸 29+ 離れのみでは残存・両軸で除去
//    (孤独な山 80×80 相当の盤で構成。buried も毎ターン対象)
//  ・徘徊の決定論 fresh 2 回一致 / バンプゲート確率の決定論再現
//  ・SP0 入眠→sprec 回復→満タン覚醒→被弾即覚醒
//  ・WORM tk%3(SPD 剰余ゲート)と攻撃なし(意図的ゲートを持たない)
//  ・接地種の重力落下(落下ターンは攻撃しない/落下先=自機セルは落下バンプ)・BAT 非落下
//  ・斜め corner-cut(両直交隣が塞がりなら攻撃不可)
//  ・女の子攻撃の種別順序(SLIME=女100%先行 / SNAKE=自100%先行)
//  ・buried tick が活動箱 16 で律速される(旧 BURIED_WAKE_RANGE(4) 圏外でも 16 圏内なら衰弱)
// シナリオ構築は G.monsters/G.dug/G.fallen/G.px/G.py へのランタイム state 注入で行い、
// tileType/girlPositions/oreAt/hazardAt 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47879; // 本番(47825)・playtester(47860)・funproxy(47867)・selfcheck 群(47871..47878) と非衝突。
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
    localStorage.removeItem("mineroad_save_6");
    localStorage.removeItem("mineroad_progress");
    localStorage.removeItem("mineroad_antennas_0"); localStorage.removeItem("mineroad_insurance_0");
    localStorage.removeItem("mineroad_antennas_6"); localStorage.removeItem("mineroad_insurance_6");
  } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + JSON.stringify(detail) : "")); };

await page.goto(`http://127.0.0.1:${PORT}/mineroad/`, { waitUntil: "networkidle" });

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.18.0", ver === "v0.18.0", { ver });

// シナリオ構築ヘルパー(各 evaluate に注入)。世界生成には非介入=ランタイム state のみ操作。
const HELPERS = `
  function fkey(c, r) { return c + "," + r; }
  function buildBox(c0, r0, w, h) {
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) { const k = c + "," + r; G.dug.delete(k); G.fallen.add(k); }
  }
  function carve(c, r) { const k = c + "," + r; G.fallen.delete(k); G.dug.add(k); }
  function snapMon(m) {
    return [m.key, m.col, m.row, m.hp, m.sp, m.tk || 0, m.rc || 0, m.sleeping ? 1 : 0, m.buried ? 1 : 0, m.bt || 0, m.dir || 0].join(",");
  }
  function mkBuried(key, c, r) {
    addMonster(key, c, r, "bury");
    const m = G.monsters[G.monsters.length - 1];
    m.buried = true; m.bt = 0; m.origCol = c; m.origRow = r;
    return m;
  }
`;

// ============================================================================
// 1. 活動箱 16(判断 E): 圏外個体は座標/SP/tk/rc/hp/sleeping すべて凍結(active も buried も)。
//    裏庭は全域が箱内になるため、孤独な山(id6、80×80)の盤で構成する。
// ============================================================================
console.log("\n== 1. 活動箱 16 圏外の完全凍結 ==");

const freeze = await page.evaluate((helpers) => {
  eval(helpers);
  G.dungeonId = 6;
  startDive();
  G.monsters = [];
  G.px = 0; G.py = 0;
  // active 個体(40,5): dx40>16 で圏外・despawn は dy5≦28 のため対象外。
  addMonster("BAT", 40, 5, "space");
  const act1 = G.monsters[0];
  // buried 個体(0,20): dy20>16 で圏外・despawn 対象外。
  const bur1 = mkBuried("SLIME", 0, 20);
  const before = [snapMon(act1), snapMon(bur1)];
  for (let i = 0; i < 5; i++) monstersAct();
  const out = {
    range: CONST.MONSTER_ACTIVE_RANGE,
    frozenActive: snapMon(act1) === before[0],
    frozenBuried: snapMon(bur1) === before[1],
    bothListed: G.monsters.indexOf(act1) >= 0 && G.monsters.indexOf(bur1) >= 0,
    before, after: [snapMon(act1), snapMon(bur1)],
  };
  G.dungeonId = 0;
  return out;
}, HELPERS);
check("1a 圏外(>16)の active/buried は 5 ターンで全 state 凍結・除去なし",
  freeze.range === 16 && freeze.frozenActive && freeze.frozenBuried && freeze.bothListed, freeze);

// ============================================================================
// 2. despawn AND 条件(判断 E): x・y 両軸とも ±28 圏外のときだけ除去(逐語 AND)。
//    片軸のみ 29+ 離れでは消えない。buried も毎ターン対象。
// ============================================================================
console.log("\n== 2. despawn 逐語 AND ==");

const despawn = await page.evaluate((helpers) => {
  eval(helpers);
  G.dungeonId = 6;
  startDive();
  G.monsters = [];
  G.px = 0; G.py = 0;
  addMonster("BAT", 29, 0, "space"); // dx29>28・dy0 → 残存(片軸のみ)。
  addMonster("BAT", 0, 29, "space"); // dx0・dy29>28 → 残存(片軸のみ)。
  addMonster("BAT", 29, 29, "space"); // 両軸 >28 → 除去。
  const burFar = mkBuried("SLIME", 30, 30); // buried も両軸 >28 → 除去。
  monstersAct();
  const keys = G.monsters.map((m) => fkey(m.col, m.row)).sort().join("|");
  const out = {
    desp: CONST.MONSTER_DESPAWN_RANGE,
    count: G.monsters.length, keys,
    xOnlySurvives: keys.includes("29,0"),
    yOnlySurvives: keys.includes("0,29"),
    bothGone: !keys.includes("29,29"),
    buriedGone: G.monsters.indexOf(burFar) < 0,
  };
  G.dungeonId = 0;
  return out;
}, HELPERS);
check("2a 片軸 29 のみは残存・両軸 29 は除去(buried 含む)",
  despawn.desp === 28 && despawn.count === 2 && despawn.xOnlySurvives && despawn.yOnlySurvives &&
  despawn.bothGone && despawn.buriedGone, despawn);

// ============================================================================
// 3. 徘徊の決定論(判断 F): fresh 2 回の同一操作列で全 state 一致(rc/tk/sp/dir/座標とも)。
// ============================================================================
console.log("\n== 3. 徘徊決定論 fresh 2 回一致 ==");

const detResults = [];
for (let trial = 0; trial < 2; trial++) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
      localStorage.removeItem("mineroad_progress"); localStorage.removeItem("mineroad_antennas_0");
      localStorage.removeItem("mineroad_insurance_0");
    } catch (e) {}
  });
  const r = await page.evaluate((helpers) => {
    eval(helpers);
    G.dungeonId = 0;
    startDive();
    G.pick = "DIAMOND";
    const seq = [];
    for (let i = 0; i < 8; i++) seq.push([0, 1]);
    seq.push([1, 0], [1, 1], [-1, 0], [0, -1], [1, 0], [0, 1], [0, 1], [-1, -1], [0, 1], [1, 0]);
    for (const [dc, dr] of seq) { if (G.screen !== "dive") break; act(dc, dr); }
    for (let i = 0; i < 10 && G.screen === "dive"; i++) monstersAct(); // 静止中も徘徊は進む。
    return JSON.stringify({
      px: G.px, py: G.py, hp: G.hp, sp: G.stamina, screen: G.screen,
      monsters: G.monsters.map(snapMon).sort().join("|"),
      dug: [...G.dug].sort().join("|"),
    });
  }, HELPERS);
  detResults.push(r);
}
check("3a 同一操作列 2 回で徘徊/rc/tk/sp/dir を含む全 state 一致", detResults[0] === detResults[1],
  { match: detResults[0] === detResults[1], sample: (detResults[0] || "").slice(0, 160) });

// ============================================================================
// 4. バンプ攻撃ゲート(判断 B): SNAKE 自100% 毎ターン応酬 / WORM 攻撃なし /
//    斜め corner-cut / 女の子攻撃の種別順序 / BAT ゲートの決定論再現。
// ============================================================================
console.log("\n== 4. バンプゲート ==");

const gates = await page.evaluate((helpers) => {
  eval(helpers);
  const o = {};
  // --- 4a SNAKE 自100%(cg.java:24-31): 直交隣接中は毎ターン攻撃(交戦ロックなしでも隣接し続ける限り応酬) ---
  G.dungeonId = 0;
  startDive();
  G.monsters = [];
  buildBox(3, 3, 5, 5); // cols3..7 × rows3..7 を固体化。
  carve(5, 4); carve(5, 5); // 自機(5,4)の真下に SNAKE(5,5)。足元(5,6)は固体。
  G.px = 5; G.py = 4; G.stamina = 50; G.hp = 30;
  addMonster("SNAKE", 5, 5, "space");
  const snake = G.monsters[0];
  const spTimeline = [];
  for (let i = 0; i < 3; i++) { monstersAct(); spTimeline.push(G.stamina); }
  o.snakeEveryTurn = spTimeline.join(",") === "45,40,35"; // STR5−DEF0=5/ターン × 3。
  o.snakeStays = snake.col === 5 && snake.row === 5;

  // --- 4b WORM 攻撃なし(cj に攻撃呼び出しなし): 直交隣接でも意図的ゲートを持たない ---
  startDive();
  G.monsters = [];
  buildBox(3, 3, 5, 5);
  carve(5, 4); carve(5, 5);
  G.px = 5; G.py = 4; G.stamina = 50; G.hp = 30;
  addMonster("WORM", 5, 5, "space"); // 上に自機。WORM は上へ動けない=偶発バンプも起きない。
  for (let i = 0; i < 9; i++) monstersAct(); // tk%3 の活動ターンを 3 回含む。
  o.wormNoAttack = G.stamina === 50 && G.hp === 30;
  o.wormNoSleep = G.monsters[0].sleeping !== true; // SP0=消費なし・眠らない。

  // --- 4c 斜め corner-cut(n.c 同型): 両直交隣が塞がりなら斜め攻撃不可、片方が空けば可 ---
  startDive();
  G.monsters = [];
  buildBox(3, 3, 6, 6); // cols3..8 × rows3..8。
  carve(5, 5); carve(6, 6); // SNAKE(5,5) と自機(6,6) が斜め隣接。(6,5)/(5,6) は固体。
  G.px = 6; G.py = 6; G.stamina = 50; G.hp = 30;
  addMonster("SNAKE", 5, 5, "space");
  for (let i = 0; i < 3; i++) monstersAct();
  o.diagBlockedNoDamage = G.stamina === 50; // 両直交隣塞がり=自100% でも攻撃不可。
  carve(6, 5); // 直交隣を 1 つ開ける → corner-cut 解除。
  monstersAct();
  o.diagOpenAttacks = G.stamina === 45; // 次ターンに斜め攻撃が通る。

  // --- 4d 女の子攻撃の種別順序: SLIME=女100%先行(ce.java:31) / SNAKE=自100%先行(cg.java:24-31) ---
  startDive();
  G.monsters = [];
  buildBox(3, 3, 5, 5);
  carve(4, 5); carve(5, 5); carve(6, 5); // 女の子(4,5)・モンスター(5,5)・自機(6,5) の一列。
  G.girls[0].state = "following"; G.girls[0].col = 4; G.girls[0].row = 5; G.girls[0].hp = 30;
  G.girls[0].trailIdx = (G.playerTrail || []).length;
  G.px = 6; G.py = 5; G.stamina = 50; G.hp = 30;
  addMonster("SLIME", 5, 5, "space");
  monstersAct();
  o.slimeHitsGirlFirst = G.girls[0].hp === 27 && G.stamina === 50; // 女100% 先行 → 自機無傷。
  G.monsters = [];
  addMonster("SNAKE", 5, 5, "space");
  monstersAct();
  o.snakeHitsSelfFirst = G.stamina === 45 && G.girls[0].hp === 27; // 自100% 先行 → 女の子無傷。

  // --- 4e BAT ゲート(女80→自80、bl.java:28)の決定論再現: fresh 2 回で結果と rc が一致 ---
  const batTrial = () => {
    startDive();
    G.monsters = [];
    buildBox(3, 3, 5, 5);
    carve(5, 4); carve(5, 5);
    G.px = 5; G.py = 4; G.stamina = 50; G.hp = 30;
    addMonster("BAT", 5, 5, "space");
    const timeline = [];
    for (let i = 0; i < 5; i++) { monstersAct(); timeline.push(G.stamina + ":" + (G.monsters[0] ? snapMon(G.monsters[0]) : "gone")); }
    return timeline.join("|");
  };
  const t1 = batTrial();
  const t2 = batTrial();
  o.batDeterministic = t1 === t2;
  o.batSample = t1.slice(0, 80);
  return o;
}, HELPERS);
check("4a SNAKE 自100%: 隣接中は毎ターン応酬(5/ターン)・その場に留まる", gates.snakeEveryTurn && gates.snakeStays, gates);
check("4b WORM: 隣接 9 ターンでも攻撃なし・眠らない", gates.wormNoAttack && gates.wormNoSleep, gates);
check("4c 斜め corner-cut: 両直交隣塞がりで攻撃不可 → 片方を開けると通る", gates.diagBlockedNoDamage && gates.diagOpenAttacks, gates);
check("4d 種別順序: SLIME は女の子先行・SNAKE は自機先行", gates.slimeHitsGirlFirst && gates.snakeHitsSelfFirst, gates);
check("4e BAT 確率ゲートの決定論再現(fresh 2 回一致)", gates.batDeterministic, { sample: gates.batSample });

// ============================================================================
// 5. SP-睡眠サイクル(判断 C): 徘徊 1 歩=SP−1、SP0 入眠 → sprec 回復 → 満タン覚醒 → 被弾即覚醒。
// ============================================================================
console.log("\n== 5. SP-睡眠サイクル ==");

const sleep = await page.evaluate((helpers) => {
  eval(helpers);
  const o = {};
  G.dungeonId = 0;
  startDive();
  G.monsters = [];
  buildBox(3, 4, 7, 3); // cols3..9 × rows4..6 を固体化。
  for (let c = 4; c <= 8; c++) carve(c, 5); // row5 に横回廊。
  G.px = 0; G.py = 1; // 圏内(裏庭は全域 ≤16)だが隣接しない位置。
  addMonster("SLIME", 6, 5, "space");
  const m = G.monsters[0];
  m.sp = 1; // 次の徘徊 1 歩で SP0 → 入眠。
  let moved = false, turns = 0;
  const pos0 = fkey(m.col, m.row);
  while (!moved && turns < 30) { monstersAct(); turns++; moved = fkey(m.col, m.row) !== pos0; }
  o.movedOnce = moved;
  o.sleptAtSp0 = m.sp === 0 && m.sleeping === true; // 移動即入眠。
  // 眠り中: 行動なし + sprec(SLIME=2)ずつ回復、満タン(5)で覚醒。
  const posSleep = fkey(m.col, m.row);
  const spSeq = [];
  for (let i = 0; i < 3; i++) { monstersAct(); spSeq.push(m.sp + ":" + (m.sleeping ? 1 : 0)); }
  o.spSeq = spSeq.join("|");
  o.recovers = o.spSeq === "2:1|4:1|5:0"; // 0→2→4→5(満タン min cap)で覚醒。
  o.noMoveWhileSleeping = fkey(m.col, m.row) === posSleep;
  // 被弾即覚醒(各 j() 相当): 眠らせ直して自機の攻撃 1 発 → sleeping false。
  m.sleeping = true; m.sp = 0;
  G.px = m.col; G.py = m.row - 1; // 隣接(攻撃可能位置)。
  const hpBefore = m.hp;
  attackMonster(m);
  o.wokeOnHit = m.sleeping === false && m.hp < hpBefore;
  return o;
}, HELPERS);
check("5a 徘徊 1 歩で SP0 → 即入眠", sleep.movedOnce && sleep.sleptAtSp0, sleep);
check("5b 眠り中は動かず sprec=2 ずつ回復 → 満タン(5)で覚醒", sleep.recovers && sleep.noMoveWhileSleeping, sleep);
check("5c 被弾で即覚醒", sleep.wokeOnHit, sleep);

// ============================================================================
// 6. WORM の SPD 剰余ゲート(判断 D): tk % SPD(=3) == 0 のターンのみ行動(落下含む)。
// ============================================================================
console.log("\n== 6. WORM tk%3 ==");

const worm = await page.evaluate((helpers) => {
  eval(helpers);
  G.dungeonId = 0;
  startDive();
  G.monsters = [];
  buildBox(3, 8, 5, 4); // cols3..7 × rows8..11 を固体化。
  carve(5, 9); carve(5, 10); // WORM(5,9) の下(5,10)は空間=落下できる。
  G.px = 0; G.py = 1;
  addMonster("WORM", 5, 9, "space");
  const m = G.monsters[0];
  const rows = [];
  for (let i = 0; i < 3; i++) { monstersAct(); rows.push(m.row); }
  return { rows: rows.join(","), spd: MONSTER.WORM.spd };
}, HELPERS);
check("6a WORM は tk=1,2 で不動・tk=3(SPD=3)で初めて落下", worm.spd === 3 && worm.rows === "9,9,10", worm);

// ============================================================================
// 7. 重力(判断 G): 接地種は 1 マス/ターン落下(落下ターンは攻撃しない)・落下先=自機セルは
//    落下バンプ・BAT は落下しない。
// ============================================================================
console.log("\n== 7. 接地種の重力落下 / BAT 非落下 ==");

const gravity = await page.evaluate((helpers) => {
  eval(helpers);
  const o = {};
  G.dungeonId = 0;
  startDive();
  G.monsters = [];
  buildBox(3, 4, 5, 5); // cols3..7 × rows4..8。
  carve(5, 5); carve(5, 6); carve(5, 7); // 縦坑。SLIME(5,5) は 2 ターンで底(5,7)へ。
  G.px = 0; G.py = 1; G.stamina = 50; G.hp = 30;
  addMonster("SLIME", 5, 5, "space");
  const m = G.monsters[0];
  monstersAct();
  const r1 = m.row;
  monstersAct();
  o.fallSeq = r1 + "," + m.row;
  o.grounded = o.fallSeq === "6,7"; // 1 マス/ターン落下。
  o.noDamageWhileFalling = G.stamina === 50 && G.hp === 30;
  o.fallNoSp = m.sp === MONSTER.SLIME.sp; // 落下は SP 非消費。
  // 落下先=自機セル → 落下バンプ(bo.a 経路): 移動せず攻撃。
  startDive();
  G.monsters = [];
  buildBox(3, 4, 5, 5);
  carve(5, 5); carve(5, 6);
  G.px = 5; G.py = 6; G.stamina = 50; G.hp = 30; // 自機が SLIME の真下。
  addMonster("SLIME", 5, 5, "space");
  const m2 = G.monsters[0];
  monstersAct();
  o.fallBump = G.stamina === 47 && m2.col === 5 && m2.row === 5; // STR3 で攻撃・移動しない。
  // BAT 非落下: 下が空間でも落ちない(徘徊ロールが (0,1) 以外を指すセルで確認)。
  startDive();
  G.monsters = [];
  let bc = -1;
  for (let c = 4; c <= 8; c++) {
    const idx = Math.floor(monsterAiRoll(c, 5, G.seed, 1) * 8);
    if (idx !== 6) { bc = c; break; } // DIRS8[6] = (0,1) 以外の初手ロールを持つセルを選ぶ。
  }
  buildBox(3, 4, 7, 4); // cols3..9 × rows4..7。
  carve(bc, 5); carve(bc, 6); // BAT(bc,5) の下(bc,6)は空間。他の周囲は固体。
  G.px = 0; G.py = 1;
  addMonster("BAT", bc, 5, "space");
  const bat = G.monsters[0];
  monstersAct();
  o.batCell = bc;
  o.batNoFall = !(bat.col === bc && bat.row === 6); // 重力では落ちない(徘徊先も塞がり=その場)。
  return o;
}, HELPERS);
check("7a 接地種(SLIME)は 1 マス/ターン落下・落下ターンは攻撃なし・SP 非消費",
  gravity.grounded && gravity.noDamageWhileFalling && gravity.fallNoSp, gravity);
check("7b 落下先=自機セルは落下バンプ(移動せず攻撃)", gravity.fallBump, gravity);
check("7c BAT は下が空間でも落下しない(飛行)", gravity.batNoFall, gravity);

// ============================================================================
// 8. buried tick の律速が活動箱 16(判断 E ③): 旧 BURIED_WAKE_RANGE(4) の圏外(距離 5..16)でも
//    衰弱が進む=距離ゲートが 16 へ統一されたことの直接確認。
// ============================================================================
console.log("\n== 8. buried tick 律速 = 16 ==");

const buried16 = await page.evaluate((helpers) => {
  eval(helpers);
  G.dungeonId = 0;
  startDive();
  const b = G.monsters.find((m) => m.buried && m.row >= 7);
  if (!b) return { found: false };
  G.monsters = [b];
  G.px = b.col; G.py = Math.max(0, b.row - 6); // Chebyshev 6 = 旧 4 の圏外・新 16 の圏内。
  const hp0 = b.hp;
  monstersAct();
  return {
    found: true, dist: Math.max(Math.abs(b.col - G.px), Math.abs(b.row - G.py)),
    decayed: b.hp === hp0 - 1,
  };
}, HELPERS);
check("8a 距離 6(旧 4 圏外)でも buried は毎ターン HP−1", buried16.found && buried16.dist === 6 && buried16.decayed, buried16);

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
