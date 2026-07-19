// v0.17.0 埋没モンスター機構の原作合わせ 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.17.0 翻案判断 A〜F を実装関数(spawnBuriedMonsters/buriedTick/escapeBuriedMonster/
// activateBuriedAt/resolveCaveins/monsterAt/render)で確認する:
//  A. 生成時配置(startDive 2 回一致 + 全固体マス走査が buryMonsterAt と一対一)
//  B. 土中 tick(圏内 HP−1 蓄積 / bury100 種の覚醒後脱出 + 空間化 dug 入り / HP0 土中死 =
//     静かに除去 = EXP/ドロップ 0)
//  C. 活動範囲(圏外 Chebyshev>BURIED_WAKE_RANGE は hp/bt/buried とも不変 = 衰弱も脱出もしない)
//  D. 決定論(同一操作列 2 回で monsters/dug/fluid の全 state 一致 = 脱出タイミングも再現)
//  E. 掘り当てアクティブ化 + 非前進 / 崩落着地マスのアクティブ個体の再埋没
//  F. buried は bump(monsterAt)・描画(drawMonster)の対象外
//  非介入: tileType/girlPositions/oreAt/hazardAt の返り値不変(2 回読み一致)
// シナリオ構築は G.monsters/G.dug/G.fallen/G.px/G.py へのランタイム state 注入で行い、
// tileType/girlPositions/oreAt/hazardAt 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47878; // 本番(47825)・playtester(47860)・grow(47871)・companion(47873)・save(47874)・items(47875)・dig8(47876)・water(47877) と非衝突。
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
check("VERSION = v0.17.0", ver === "v0.17.0", { ver });

// シナリオ構築ヘルパー(各 evaluate に注入)。世界生成には非介入=ランタイム state のみ操作。
// - buriedList: 現在の埋没個体一覧を安定順シリアライズ。
// - pickBuried: 条件に合う埋没個体を 1 体選ぶ(seed 固定なので選択も決定論)。
// - failStreak: その個体の脱出抽選が bt=1..n で全部失敗するか(buryEscapeRoll を直接読む)。
const HELPERS = `
  function fkey(c, r) { return c + "," + r; }
  function buriedList() {
    return G.monsters.filter((m) => m.buried)
      .map((m) => m.key + "@" + m.col + "," + m.row + ":" + m.hp + ":" + (m.bt || 0))
      .sort().join("|");
  }
  function failStreak(m, n) {
    const bury = MONSTER[m.key].bury;
    for (let bt = 1; bt <= n; bt++) {
      if (buryEscapeRoll(m.origCol, m.origRow, G.seed, bt) < bury / 100) return false;
    }
    return true;
  }
  // その個体が(圏内に居続けた場合に)脱出する覚醒 tick 番号。上限内に成功が無ければ 0。
  function escapeBtOf(m, cap) {
    const bury = MONSTER[m.key].bury;
    for (let bt = 1; bt <= cap; bt++) {
      if (buryEscapeRoll(m.origCol, m.origRow, G.seed, bt) < bury / 100) return bt;
    }
    return 0;
  }
  function pickBuried(pred) {
    return G.monsters.find((m) => m.buried && pred(m)) || null;
  }
  function buildBox(c0, r0, w, h) {
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) { const k = c + "," + r; G.dug.delete(k); G.fallen.add(k); }
  }
  function carve(c, r) { const k = c + "," + r; G.fallen.delete(k); G.dug.add(k); }
`;

// ============================================================================
// 1. 生成時配置(判断 A): startDive 2 回一致 + 固体マス限定 + buryMonsterAt と一対一。
// ============================================================================
console.log("\n== 1. 生成時配置の決定論 ==");

const placement = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const list1 = buriedList();
  startDive();
  const list2 = buriedList();
  const o = { count: G.monsters.filter((m) => m.buried).length, same: list1 === list2 };
  // 全埋没個体が固体マス(SOIL/HARD/ROCK)上 + buryMonsterAt の返す種と一致 + buried=true/bt=0/HP verbatim。
  o.onSolid = G.monsters.filter((m) => m.buried).every((m) => {
    const t = tileType(m.col, m.row, G.seed);
    return t === TILE.SOIL || t === TILE.HARD || t === TILE.ROCK;
  });
  o.matchTable = G.monsters.filter((m) => m.buried).every(
    (m) => buryMonsterAt(m.col, m.row, G.seed) === m.key && m.hp === MONSTER[m.key].hp && (m.bt || 0) === 0
      && m.origCol === m.col && m.origRow === m.row
  );
  // 逆向き: buryMonsterAt が種を返す固体マスには必ず 1 体居る(取りこぼしなし)。
  let missing = 0, dup = 0;
  for (let r = 1; r <= CONST.DEPTH_ROWS; r++) {
    for (let c = 0; c < CONST.GRID_COLS; c++) {
      const t = tileType(c, r, G.seed);
      if (t !== TILE.SOIL && t !== TILE.HARD && t !== TILE.ROCK) continue;
      const sp = buryMonsterAt(c, r, G.seed);
      if (!sp) continue;
      const n = G.monsters.filter((m) => m.buried && m.col === c && m.row === r).length;
      if (n === 0) missing++;
      if (n > 1) dup++;
    }
  }
  o.missing = missing; o.dup = dup;
  // 空間スポーン(既存)は不変で共存している。
  o.spaceCount = G.monsters.filter((m) => !m.buried).length;
  o.spaceOnNone = G.monsters.filter((m) => !m.buried).every((m) => tileType(m.col, m.row, G.seed) === TILE.NONE);
  return o;
}, HELPERS);
check("1a 埋没個体が生成時に配置される(>0)+ startDive 2 回一致", placement.count > 0 && placement.same, placement);
check("1b 全個体が固体マス上 + buryMonsterAt/HP verbatim/bt=0/orig=配置マス", placement.onSolid && placement.matchTable, placement);
check("1c buryMonsterAt が返す固体マスと一対一(取りこぼし 0・重複 0)", placement.missing === 0 && placement.dup === 0, placement);
check("1d 空間スポーンは不変で共存(NONE マス上)", placement.spaceCount > 0 && placement.spaceOnNone, placement);

// ============================================================================
// 2. 活動範囲ゲート(判断 C): 圏外(Chebyshev>BURIED_WAKE_RANGE)は hp/bt とも不変 =
//    衰弱も脱出もしない。しきい値は CONST から読む(数値の見直しに機械追随)。
// ============================================================================
console.log("\n== 2. 圏外 tick 停止 ==");

const range = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const wake = CONST.BURIED_WAKE_RANGE;
  // 圏外になる深部の埋没個体を 1 体選び、自機を地表(7,0)に置く(row > wake なら Chebyshev > wake)。
  const b = pickBuried((m) => Math.max(Math.abs(m.col - 7), m.row) > wake + 1);
  if (!b) return { found: false };
  G.monsters = [b]; // 他個体の干渉を排除(純検証)。
  G.px = 7; G.py = 0;
  const before = { hp: b.hp, bt: b.bt || 0 };
  for (let i = 0; i < 5; i++) monstersAct();
  return {
    found: true, wake, dist: Math.max(Math.abs(b.col - 7), Math.abs(b.row - 0)),
    before, after: { hp: b.hp, bt: b.bt || 0 },
    stillBuried: b.buried === true, noDug: !G.dug.has(fkey(b.col, b.row)),
  };
}, HELPERS);
check("2a 圏外個体は 5 tick 後も hp/bt/buried 不変・脱出なし",
  range.found && range.dist > range.wake && range.after.hp === range.before.hp && range.after.bt === range.before.bt &&
  range.stillBuried && range.noDug, range);

// ============================================================================
// 3. 圏内 HP−1 蓄積(判断 B/D): 脱出予定 bt を buryEscapeRoll から事前計算し、その直前 tick まで
//    HP だけが毎 tick 減り(蓄積)、予定 bt ちょうどで脱出することを突き合わせる(分布非依存)。
// ============================================================================
console.log("\n== 3. 圏内 HP−1 蓄積 + 脱出 bt 一致 ==");

const decay = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  // bury<100 かつ 脱出予定 bt が 2 以上の個体(=最低 1 tick は「衰弱だけ」が観測できる)。
  // seed 固定なので選択も決定論。
  const b = pickBuried((m) => MONSTER[m.key].bury < 100 && escapeBtOf(m, 8) >= 2);
  if (!b) return { found: false };
  const escBt = escapeBtOf(b, 8);
  G.monsters = [b];
  G.px = b.col; G.py = Math.max(0, b.row - 2); // 圏内(Chebyshev 2)。
  const hp0 = b.hp;
  // 予定 bt の 1 tick 手前まで: 毎 tick HP−1 のみ(脱出しない)。
  for (let i = 0; i < escBt - 1; i++) monstersAct();
  const before = {
    hp: b.hp, bt: b.bt || 0, stillBuried: b.buried === true,
    noDug: !G.dug.has(fkey(b.col, b.row)),
  };
  // 予定 bt の tick: HP−1 + 脱出。
  monstersAct();
  return {
    found: true, key: b.key, hp0, escBt, before,
    after: { hp: b.hp, bt: b.bt || 0, escaped: b.buried === false, dug: G.dug.has(fkey(b.col, b.row)) },
  };
}, HELPERS);
check("3a 予定 bt 直前まで毎 tick HP−1 のみ(bt 蓄積・脱出なし)",
  decay.found && decay.before.hp === decay.hp0 - (decay.escBt - 1) && decay.before.bt === decay.escBt - 1 &&
  decay.before.stillBuried && decay.before.noDug, decay);
check("3b 事前計算した脱出予定 bt ちょうどで脱出(HP は bt ぶん減、dug 入り)",
  decay.found && decay.after.escaped && decay.after.hp === decay.hp0 - decay.escBt &&
  decay.after.bt === decay.escBt && decay.after.dug, decay);

// ============================================================================
// 4. bury100 種の覚醒後脱出 + 空間化(判断 B/E): WORM は圏内 1 tick で脱出し dug 入り。
// ============================================================================
console.log("\n== 4. bury100 種の脱出 + 空間化 ==");

const escape = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const b = pickBuried((m) => MONSTER[m.key].bury >= 100);
  if (!b) return { found: false };
  G.monsters = [b];
  G.px = b.col; G.py = Math.max(0, b.row - 2);
  const key = fkey(b.col, b.row);
  const hp0 = b.hp;
  const oreBefore = JSON.stringify(G.ore);
  const mushBefore = G.mushrooms || 0;
  monstersAct();
  return {
    found: true, key: b.key, escaped: b.buried === false, hp0, hp: b.hp,
    dug: G.dug.has(key), notFallen: !G.fallen.has(key),
    // 判断 E: 脱出は採取なし(collectOre/collectMushroom を通らない)。
    noCollect: JSON.stringify(G.ore) === oreBefore && (G.mushrooms || 0) === mushBefore,
    // 脱出後はアクティブ = monsterAt で引ける(bump/ブロック対象に戻る)。
    activeAt: !!monsterAt(b.col, b.row),
  };
}, HELPERS);
check("4a bury100 は圏内 1 tick で脱出(HP−1 済み)+ 自マス dug 入り",
  escape.found && escape.escaped && escape.hp === escape.hp0 - 1 && escape.dug && escape.notFallen, escape);
check("4b 脱出は採取なし(ore/キノコ不変)+ 脱出後は monsterAt で引ける", escape.noCollect && escape.activeAt, escape);

// ============================================================================
// 5. 土中死(判断 B): HP0 は静かに除去(EXP/ドロップ/dug なし)。
// ============================================================================
console.log("\n== 5. 土中死 ==");

const soilDeath = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const b = pickBuried((m) => true);
  if (!b) return { found: false };
  G.monsters = [b];
  b.hp = 1; // 次の圏内 tick の HP−1 で 0 = 土中死(脱出抽選より先に死ぬ)。
  G.px = b.col; G.py = Math.max(0, b.row - 2);
  G.exp = 0; G.kills = 0; G.drops = {};
  const key = fkey(b.col, b.row);
  monstersAct();
  return {
    found: true, removed: G.monsters.length === 0,
    exp: G.exp, kills: G.kills, drops: Object.keys(G.drops).length,
    noDug: !G.dug.has(key),
  };
}, HELPERS);
check("5a HP0 で静かに除去(リストから消える・EXP/kills/ドロップ 0・dug 入りしない)",
  soilDeath.found && soilDeath.removed && soilDeath.exp === 0 && soilDeath.kills === 0 &&
  soilDeath.drops === 0 && soilDeath.noDug, soilDeath);

// ============================================================================
// 6. 掘り当てアクティブ化 + 非前進(判断 E)。
// ============================================================================
console.log("\n== 6. 掘り当てアクティブ化 + 非前進 ==");

const digHit = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  // 任意の埋没個体でよい(bury100 でも可): act の掘りかけタップは resolveTurn を通らない=
  // 掘っている間に monstersAct(脱出抽選)は走らず、掘り抜きの瞬間 activateBuriedAt が
  // resolveTurn より先に発火するため、脱出に先回りされることは構造上ない。
  const b = pickBuried((m) => true);
  if (!b) return { found: false };
  G.monsters = [b];
  G.pick = "DIAMOND"; G.stamina = 100; G.hp = 30;
  // 個体の真上に自機を置く(足場は掘った跡として注入)。
  G.dug.add(fkey(b.col, b.row - 1));
  G.px = b.col; G.py = b.row - 1;
  const py0 = G.py;
  let taps = 0;
  while (b.buried && taps < 5 && G.screen === "dive") { act(0, 1); taps++; }
  return {
    found: true, key: b.key, activated: b.buried === false, taps,
    dug: G.dug.has(fkey(b.col, b.row)),
    noAdvance: G.px === b.col && G.py === py0, // 掘り抜いてもそのマスへ前進しない。
    blocksNow: !!monsterAt(b.col, b.row), // アクティブ化後は bump 対象。
  };
}, HELPERS);
check("6a 掘り抜きで「そこに居た」個体がアクティブ化 + 自機は前進しない",
  digHit.found && digHit.activated && digHit.dug && digHit.noAdvance && digHit.blocksNow, digHit);

// ============================================================================
// 7. buried 非 bump・非描画(判断 F)。
// ============================================================================
console.log("\n== 7. buried 非 bump・非描画 ==");

const boundary = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  const b = pickBuried((m) => true);
  if (!b) return { found: false };
  const o = { found: true };
  // 非 bump: monsterAt は buried を返さない(移動ブロック・bump 攻撃の対象外)。掘り当て判定用の
  // buriedMonsterAt では引ける。
  o.monsterAtNull = monsterAt(b.col, b.row) === null;
  o.buriedAtHit = buriedMonsterAt(b.col, b.row) === b;
  // 非描画: 可視化しても drawMonster が buried 個体で呼ばれない(描画関数を横取りして観測)。
  G.seen.add(fkey(b.col, b.row));
  const drawn = [];
  const orig = window.drawMonster;
  window.drawMonster = (m) => { drawn.push(m.buried ? "buried" : "active"); };
  render();
  window.drawMonster = orig;
  o.noBuriedDrawn = !drawn.includes("buried");
  return o;
}, HELPERS);
check("7a monsterAt は buried を返さず buriedMonsterAt で引ける",
  boundary.found && boundary.monsterAtNull && boundary.buriedAtHit, boundary);
check("7b 可視マスでも buried は描画されない", boundary.found && boundary.noBuriedDrawn, boundary);

// ============================================================================
// 8. 崩落再埋没(判断 E): 土塊の着地マスのアクティブ個体は buried へ戻る。
// ============================================================================
console.log("\n== 8. 崩落再埋没 ==");

const rebury = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  buildBox(5, 3, 5, 5); // cols 5..9 / rows 3..7 を固体化(女の子セルと非重複)。
  carve(7, 4); carve(7, 5); carve(7, 6); // (7,7) は固体=着地床。
  addMonster("SLIME", 7, 6, "space"); // 着地マスにアクティブ個体。
  const m = G.monsters[0];
  m.bt = 9; // 再埋没でリセットされることを見るための事前値。
  G.px = 5; G.py = 3; G.dug.add(fkey(5, 3)); // 崩落列の外。
  G.unstableDug = new Set([fkey(7, 4)]);
  resolveCaveins();
  return {
    fallenAt: G.fallen.has(fkey(7, 6)),
    reburied: m.buried === true,
    origMoved: m.origCol === 7 && m.origRow === 6,
    btReset: (m.bt || 0) === 0,
    stillListed: G.monsters.indexOf(m) >= 0,
  };
}, HELPERS);
check("8a 着地マスのアクティブ個体が buried へ戻る(orig=着地マス・bt リセット・除去されない)",
  rebury.fallenAt && rebury.reburied && rebury.origMoved && rebury.btReset && rebury.stillListed, rebury);

// ============================================================================
// 9. 決定論(判断 D): 同一操作列 2 回で全 state 一致(脱出タイミング・土中死とも再現)。
// ============================================================================
console.log("\n== 9. 決定論 2 回一致 ==");

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
    // 深部まで掘り下げる固定操作列(埋没 tick・脱出・戦闘も全て決定論のまま流す)。
    const seq = [];
    for (let i = 0; i < 10; i++) seq.push([0, 1]);
    seq.push([1, 0], [1, 1], [-1, 0], [0, -1], [1, 0], [0, 1], [0, 1], [-1, -1], [0, 1], [1, 0]);
    for (const [dc, dr] of seq) { if (G.screen !== "dive") break; act(dc, dr); }
    return JSON.stringify({
      px: G.px, py: G.py, hp: G.hp, sp: G.stamina, screen: G.screen,
      monsters: G.monsters.map((m) => `${m.key},${m.col},${m.row},${m.hp},${m.buried ? 1 : 0},${m.bt || 0}`).sort().join("|"),
      dug: [...G.dug].sort().join("|"),
      fallen: [...G.fallen].sort().join("|"),
      fluid: [...G.fluid.entries()].map(([k, f]) => `${k}:${f.k},${f.d}`).sort().join("|"),
      exp: G.exp, kills: G.kills,
    });
  });
  detResults.push(r);
}
const detOk = detResults[0] === detResults[1];
check("9a 決定論(埋没 tick/脱出/dug/流体を含む全 state 2 回一致)", detOk, { match: detOk, sample: (detResults[0] || "").slice(0, 160) });

// ============================================================================
// 10. 非介入: tileType/girlPositions/oreAt/hazardAt は不変(2 回読み一致)。
// ============================================================================
console.log("\n== 10. 世界生成レイヤー非介入 ==");

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
  const buryStable = buryMonsterAt(3, 5, seed) === buryMonsterAt(3, 5, seed);
  return { gp, tileHash, hazardStable, oreStable, buryStable };
});
const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
check("10a girlPositions verbatim 不変", nonIntervention.gp === EXPECTED_GIRLS, { gp: nonIntervention.gp });
check("10b tileType 全マス走査がエラーなく完了", Number.isInteger(nonIntervention.tileHash), { tileHash: nonIntervention.tileHash });
check("10c hazardAt/oreAt/buryMonsterAt 2 回読み一致(ハッシュ温存)", nonIntervention.hazardStable && nonIntervention.oreStable && nonIntervention.buryStable, nonIntervention);

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
