// v0.15.0 掘削 8 方向の原作合わせ 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.15.0 翻案判断 A〜F を実プレイ経路(act/moveTo 等の内部関数直叩き)で確認する:
//  A. 入力 Chebyshev 1(act が斜め dc,dr を受ける。pointerEnd の画面タップ経路は debug gate AF が担う)
//  B. 真上掘り=はしご前提ゲート撤去(power ゲートのみ)、掘り抜きで自機非移動、既存クライム不変
//  C. 斜め上/斜め下の前提条件(横隣 or 縦隣が空間)の正例・負例、階段登り、ジャンプ落ち戻り、斜め下前進
//  D. bump-to-attack 8 方向(前提条件より先に成立=壁越しでも隣接攻撃)
//  F. 決定論(同一操作列 3 回連続一致)・世界生成レイヤー非介入
// シナリオ構築は G.dug/G.fallen/G.spawned への注入(player 操作由来 state のみ)で行い、
// tileType/girlPositions/oreAt 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47876; // 本番(47825)・playtester(47860)・grow(47871)・companion(47873)・save(47874)・items(47875) と非衝突。
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
check("VERSION = v0.19.0", ver === "v0.19.0", { ver }); // v0.19.0 ランタイムスポーンの原作合わせ(STATUS v0.19.0)へ機械追随。

// シナリオ構築ヘルパー(各 evaluate に注入)。
// - findCell(pred): 世界レイヤーを読み取り専用で走査して条件セルを探す(生成には非介入)。
// - placeAt(c,r): (c,r) を掘った跡として自機を置く(player state 注入 + 既存 moveTo)。
// - suppressSpawn(c,r): そのマスの埋没掘りスポーンを「発火済み」扱いにする(G.spawned は player 由来 state)。
const HELPERS = `
  function findCell(pred) {
    for (let r = 2; r <= CONST.DEPTH_ROWS - 2; r++)
      for (let c = 0; c < CONST.GRID_COLS - 1; c++)
        if (pred(c, r)) return { c, r };
    return null;
  }
  function solidAt(c, r) {
    const t = tileAt(c, r);
    return t !== TILE.NONE && t !== TILE.SURFACE;
  }
  function placeAt(c, r) {
    G.dug.add(c + "," + r);
    moveTo(c, r, true, true);
  }
  function suppressSpawn(c, r) { G.spawned.add(c + "," + r); }
  function digDir(dc, dr, maxTaps) {
    // 掘り抜けるまで act を叩く(叩数は返す)。掘り抜けたら true。
    const key = (G.px + dc) + "," + (G.py + dr);
    for (let i = 1; i <= maxTaps; i++) {
      act(dc, dr);
      if (G.dug.has(key)) return { through: true, taps: i };
    }
    return { through: false, taps: maxTaps };
  }
`;

// ============================================================================
// 1. 真上掘り: はしご無しで power ゲートのみ。掘り抜きで自機非移動 → 次タップの既存クライムで登る。
// ============================================================================
console.log("\n== 1. 真上掘り(はしご前提ゲート撤去) ==");

const up = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  // 真上が HARD(power2 が要る)のセルを探す(power 負例と正例を同じセルで検証)。
  const cell = findCell((c, r) =>
    tileAt(c, r - 1) === TILE.HARD && !G.girls.some((g) => g.col === c && g.row === r));
  if (!cell) return { found: false };
  const { c, r } = cell;
  suppressSpawn(c, r - 1);
  placeAt(c, r);
  const o = { found: true, c, r, laddersPlaced: G.placedLadders.size, pyBefore: G.py };
  // 負例: WOOD(power1) では HARD(req2) を真上でも掘れない(power ゲート維持)。行動消費もしない。
  G.pick = "WOOD";
  const spBeforeBlocked = G.stamina;
  act(0, -1);
  o.blockedNoDig = !G.digProgress.has(c + "," + (r - 1)) && !G.dug.has(c + "," + (r - 1));
  o.blockedNoCost = G.stamina === spBeforeBlocked;
  o.blockedNoMove = G.py === r;
  // 正例: DIAMOND なら真上を掘れる(はしご未所持・未設置のまま)。
  G.pick = "DIAMOND";
  const spBeforeDig = G.stamina;
  const dig = digDir(0, -1, 5);
  o.digThrough = dig.through;
  o.digTaps = dig.taps; // HARD = digTaps 2 のはず。
  o.digCost = spBeforeDig - G.stamina; // 掘りは行動消費する。
  o.noMoveOnDigThrough = G.px === c && G.py === r; // 掘り抜いても自機は動かない(原作=掘削と移動は別)。
  // 既存クライム(変更なし): 空間化した真上へ次タップで 1 マス登る。
  act(0, -1);
  o.climbedAfter = G.px === c && G.py === r - 1;
  return o;
}, HELPERS);
check("1a シナリオセル発見(真上=HARD)", up.found === true, up);
check("1b はしご未設置(placedLadders 0)のまま検証", up.laddersPlaced === 0, up);
check("1c power 不足(WOOD vs HARD)は真上でも掘れない・行動消費なし", up.blockedNoDig && up.blockedNoCost && up.blockedNoMove, up);
check("1d はしご無しで真上を掘り抜ける(power ゲートのみ)", up.digThrough === true && up.digTaps === 2, up);
check("1e 掘り抜いても自機は移動しない", up.noMoveOnDigThrough === true, up);
check("1f 掘り抜き後の次タップは既存クライムで 1 マス登る(変更なし)", up.climbedAfter === true, up);
check("1g 掘りは行動消費する(タップ数ぶん)", up.digCost >= up.digTaps, up);

// ============================================================================
// 2. 斜め上: 前提条件(横隣 or 真上が空間)の負例・正例、階段登り、ジャンプ落ち戻り。
// ============================================================================
console.log("\n== 2. 斜め上(前提条件・階段登り・落ち戻り) ==");

const diagUp = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  // 負例セル: 横隣・真上・斜め上ターゲットが全て固体(完全な壁中へのねじ込み)。
  const neg = findCell((c, r) =>
    solidAt(c + 1, r) && solidAt(c, r - 1) && solidAt(c + 1, r - 1) &&
    !G.girls.some((g) => (g.col === c && g.row === r)));
  if (!neg) return { found: false };
  const o = { found: true, neg };
  placeAt(neg.c, neg.r);
  G.pick = "DIAMOND";
  const spBefore = G.stamina;
  act(1, -1);
  o.negNoDig = !G.digProgress.has((neg.c + 1) + "," + (neg.r - 1)) && !G.dug.has((neg.c + 1) + "," + (neg.r - 1));
  o.negNoCost = G.stamina === spBefore; // 行動消費もしない。
  o.negNoMove = G.px === neg.c && G.py === neg.r;
  return o;
}, HELPERS);
check("2a 負例セル発見(横隣・真上・斜め先が全固体)", diagUp.found === true, diagUp);
check("2b 前提条件を満たさない斜め上は何もしない(掘らない・動かない・行動消費なし)",
  diagUp.negNoDig && diagUp.negNoCost && diagUp.negNoMove, diagUp);

const stair = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 階段登りセル: 横隣(足場)が固体・斜め上ターゲットが固体掘削可(女の子でない)。
  // 真上を掘った跡(空間)にして前提条件を「真上が空間」側で満たす。
  const cell = findCell((c, r) =>
    solidAt(c + 1, r) && solidAt(c, r - 1) && solidAt(c + 1, r - 1) &&
    tileAt(c + 1, r - 1) !== TILE.GIRL &&
    !G.girls.some((g) => (g.col === c && g.row === r)));
  if (!cell) return { found: false };
  const { c, r } = cell;
  const o = { found: true, c, r };
  suppressSpawn(c, r - 1); suppressSpawn(c + 1, r - 1);
  placeAt(c, r);
  G.dug.add(c + "," + (r - 1)); // 真上を掘った跡に(前提条件の「真上が空間」正例)。
  const dig = digDir(1, -1, 5);
  o.digThrough = dig.through;
  o.noMoveOnDigThrough = G.px === c && G.py === r; // 斜め上も掘り抜きで移動しない。
  G.unstableDug = new Set(); // なだれ土の遅延崩落でシナリオが乱れないよう明示クリア(player state)。
  // 次タップ: 斜め上ターゲットは空間 → 重力ありの moveTo。横隣(c+1,r) が固体の足場なので 1 段上がる。
  act(1, -1);
  o.stairClimbed = G.px === c + 1 && G.py === r - 1;
  return o;
}, HELPERS);
check("2c 階段登りセル発見", stair.found === true, stair);
check("2d 斜め上掘削(前提=真上が空間)・掘り抜きで移動しない", stair.digThrough === true && stair.noMoveOnDigThrough === true, stair);
check("2e 斜め移動で 1 段上がる(足場あり=階段登り成立)", stair.stairClimbed === true, stair);

const jump = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  // ジャンプ落ち戻りセル: 斜め先も横隣も真上も空間にするが、横隣の真下が固体(そこへ落ちる)。
  const cell = findCell((c, r) =>
    solidAt(c + 1, r + 1) &&
    !G.girls.some((g) => (g.col === c && g.row === r)));
  if (!cell) return { found: false };
  const { c, r } = cell;
  const o = { found: true, c, r };
  placeAt(c, r);
  G.dug.add(c + "," + (r - 1));
  G.dug.add((c + 1) + "," + r);
  G.dug.add((c + 1) + "," + (r - 1));
  G.unstableDug = new Set();
  // 斜め上は空間 → 重力あり moveTo。足場(c+1,r)も空間なので飛びついても落ちる=原作ジャンプと同型。
  act(1, -1);
  o.px = G.px; o.py = G.py;
  o.fellBack = G.px === c + 1 && G.py === r; // (c+1,r-1) へ動いた後、重力で (c+1,r) へ落ち戻る。
  return o;
}, HELPERS);
check("2f ジャンプ落ち戻り(足場なし=斜め上移動しても重力で戻る)", jump.found === true && jump.fellBack === true, jump);

// ============================================================================
// 3. 斜め下: 前提条件(横隣 or 真下が空間)の負例、移動、掘削で前進。
// ============================================================================
console.log("\n== 3. 斜め下(前提条件・移動・掘削前進) ==");

const diagDown = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 負例: 横隣・真下・斜め下ターゲットが全固体。
  const neg = findCell((c, r) =>
    solidAt(c + 1, r) && solidAt(c, r + 1) && solidAt(c + 1, r + 1) &&
    !G.girls.some((g) => (g.col === c && g.row === r)));
  if (!neg) return { found: false };
  const o = { found: true, neg };
  placeAt(neg.c, neg.r);
  const spBefore = G.stamina;
  act(1, 1);
  o.negNoDig = !G.digProgress.has((neg.c + 1) + "," + (neg.r + 1)) && !G.dug.has((neg.c + 1) + "," + (neg.r + 1));
  o.negNoCost = G.stamina === spBefore;
  o.negNoMove = G.px === neg.c && G.py === neg.r;
  return o;
}, HELPERS);
check("3a 負例(横隣・真下・斜め先が全固体)は何もしない", diagDown.found === true && diagDown.negNoDig && diagDown.negNoCost && diagDown.negNoMove, diagDown);

const digDown = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 掘削前進セル: 斜め下ターゲットが固体掘削可・その真下が固体(落ちずに止まる)・女の子でない。
  const cell = findCell((c, r) =>
    solidAt(c + 1, r + 1) && tileAt(c + 1, r + 1) !== TILE.GIRL &&
    solidAt(c + 1, r + 2) &&
    !G.girls.some((g) => (g.col === c && g.row === r) || (g.col === c + 1 && g.row === r + 1)));
  if (!cell) return { found: false };
  const { c, r } = cell;
  const o = { found: true, c, r };
  suppressSpawn(c + 1, r + 1);
  placeAt(c, r);
  G.dug.add((c + 1) + "," + r); // 横隣を空間に(前提条件の正例)。
  G.unstableDug = new Set();
  const dig = digDir(1, 1, 5);
  o.digThrough = dig.through;
  // 斜め下は掘り抜きで前進する(既存の下掘り・横掘りと同じ「掘って進む」)。真下(c+1,r+2)固体なので止まる。
  o.advanced = G.px === c + 1 && G.py === r + 1;
  // 斜め下移動(空間への踏み込み): さらに横隣を空間化して落ち先の床が固体のセルで確認する代わりに、
  // いま立っているマスから元のマス(c,r)へ斜め上... ではなく、掘った跡 (c,r) へ (−1,−1) で戻れるか
  // =斜め移動の対称性を同時に確認(横隣 (c,r+1)? 真上 (c+1,r)=掘った跡が空間で前提成立)。
  act(-1, -1);
  o.diagMoveBack = G.px === c && G.py === r; // (c,r) は掘った跡=空間、真下(c,r+1)? 落ちない条件は問わず px 一致を確認。
  return o;
}, HELPERS);
check("3b 斜め下掘削で前進(掘り抜き=moveTo、既存下掘りと同型)", digDown.found === true && digDown.digThrough === true && digDown.advanced === true, digDown);
check("3c 斜め移動の対称性(掘った跡へ斜めに戻れる)", digDown.diagMoveBack === true, digDown);

// ============================================================================
// 4. bump-to-attack 8 方向(前提条件より先に成立=壁中でも隣接攻撃できる)。
// ============================================================================
console.log("\n== 4. 斜め bump-to-attack ==");

const bump = await page.evaluate((helpers) => {
  eval(helpers);
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 負例セル(全固体)を流用: 前提条件を満たさない壁中でも、斜め隣のモンスターには攻撃が成立する
  // (=攻撃判定が前提条件より先、STATUS v0.15.0 判断 D の実装値)。
  const cell = findCell((c, r) =>
    solidAt(c + 1, r) && solidAt(c, r - 1) && solidAt(c + 1, r - 1) &&
    !G.girls.some((g) => (g.col === c && g.row === r)));
  if (!cell) return { found: false };
  const { c, r } = cell;
  const o = { found: true, c, r };
  placeAt(c, r);
  addMonster(MON.SLIME, c + 1, r - 1, "space"); // SLIME hp15(1 撃では倒れない)。
  const foe = monsterAt(c + 1, r - 1);
  const hpBefore = foe.hp;
  const spBefore = G.stamina;
  act(1, -1);
  o.attacked = foe.hp < hpBefore; // 斜め bump 攻撃が入った。
  o.costPaid = G.stamina < spBefore; // 攻撃は 1 行動。
  o.noMove = G.px === c && G.py === r; // 攻撃では動かない。
  o.tileIntact = !G.dug.has((c + 1) + "," + (r - 1)); // 掘りは発生していない。
  G.monsters = [];
  return o;
}, HELPERS);
check("4a 斜め隣のモンスターへ bump 攻撃(前提条件より先に成立・移動なし・掘りなし)",
  bump.found === true && bump.attacked === true && bump.costPaid === true && bump.noMove === true && bump.tileIntact === true, bump);

// ============================================================================
// 5. act の入力面: (0,0) 相当や範囲外は無反応(Chebyshev 1 の 8 方向が対象)。
//    ※ pointerEnd の画面タップ経路(Chebyshev 判定)は debug gate AF で画面座標から検証する。
// ============================================================================
console.log("\n== 5. 入力境界 ==");

const inputEdge = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  const spBefore = G.stamina;
  const px = G.px, py = G.py;
  act(-1, -1); // 地表(row0)で斜め上 → row=-1 は「地表より上は無い」で無反応。
  const o = { upFromSurfaceNoop: G.px === px && G.py === py && G.stamina === spBefore };
  return o;
});
check("5a 地表からの斜め上(row<0)は無反応", inputEdge.upFromSurfaceNoop === true, inputEdge);

// ============================================================================
// 6. はしごメカ温存(設置/回収は非改変で残る)。
// ============================================================================
console.log("\n== 6. はしごメカ温存 ==");

const ladder = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 地中(py>=2)へ掘り下げる(v0.13.1 の既存挙動。埋没スポーンで塞がれたら払って続ける)。
  let guard = 0;
  while (G.py < 2 && G.screen === "dive" && guard < 12) { G.monsters = []; act(0, 1); guard++; }
  G.monsters = [];
  G.ladders = 1;
  const placed = placeLadder() === true && G.placedLadders.size === 1 && G.ladders === 0;
  const recovered = recoverLadder() === true && G.placedLadders.size === 0 && G.ladders === 1;
  return { placed, recovered };
});
check("6a はしご設置/回収が従来どおり動く(メカ非改変)", ladder.placed === true && ladder.recovered === true, ladder);

// ============================================================================
// 7. 決定論: 8 方向を含む同一操作列で 3 回連続一致(注入なしの実プレイ経路)。
// ============================================================================
console.log("\n== 7. 決定論 3 回連続一致 ==");

const detResults = [];
for (let trial = 0; trial < 3; trial++) {
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
    // 斜めを含む固定操作列(モンスター遭遇・埋没スポーン・なだれも含め全て決定論のまま流す)。
    const seq = [[0, 1], [0, 1], [0, 1], [1, 1], [1, -1], [1, -1], [0, -1], [-1, 1], [-1, 1], [0, 1], [1, 0], [-1, -1], [0, -1], [1, 1], [1, 1]];
    for (const [dc, dr] of seq) { if (G.screen !== "dive") break; act(dc, dr); }
    return {
      px: G.px, py: G.py, hp: G.hp, sp: G.stamina, screen: G.screen,
      ore: { ...G.ore }, mushrooms: G.mushrooms, kills: G.kills, exp: G.exp,
      dug: [...G.dug].sort().join("|"),
      digProgress: [...G.digProgress.entries()].sort().map((e) => e.join(":")).join("|"),
      monsters: G.monsters.map((m) => `${m.key},${m.col},${m.row},${m.hp}`).sort().join("|"),
      fallen: [...G.fallen].sort().join("|"),
      unstable: [...G.unstableDug].sort().join("|"),
    };
  });
  detResults.push(JSON.stringify(r));
}
const detOk = detResults[0] === detResults[1] && detResults[1] === detResults[2];
check("7a 決定論(8 方向操作列の全 state 3 回連続一致)", detOk, { match: detOk, sample: (detResults[0] || "").slice(0, 160) });

// ============================================================================
// 8. 非介入: tileType/girlPositions は v0.14.0 と不変。
// ============================================================================
console.log("\n== 8. 世界生成レイヤー非介入 ==");

const nonIntervention = await page.evaluate(() => {
  startDive();
  const seed = G.seed;
  const gp = girlPositions(seed).map((p) => `${p.col},${p.row}`).join("|");
  let tileHash = 0;
  for (let c = 0; c < CONST.GRID_COLS; c++)
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++)
      tileHash = (tileHash * 31 + tileType(c, r, seed) + 7) % 1000000007;
  return { gp, tileHash };
});
const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
check("8a girlPositions verbatim 不変", nonIntervention.gp === EXPECTED_GIRLS, { gp: nonIntervention.gp });
check("8b tileType 全マス走査がエラーなく完了(生成ロジック非改変の煙テスト)", Number.isInteger(nonIntervention.tileHash), nonIntervention);

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
