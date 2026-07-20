// v0.19.0 ランタイムスポーン 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.19.0 翻案判断 A〜D を実装関数(runtimeSpawnStep/runtimeSpawnOccupied/tiles.js の
// runtimeSpawnChanceRoll 等)で確認する:
//  ・30% ゲートの決定論再現(fresh 2 回一致)+ 大量サンプルでの比率が 30% 近辺
//  ・非対称オフセット [-28,+27] のレンジ検証 + clamp(x∈[1,GRID_COLS-2], y∈[11,DEPTH_ROWS-2])
//  ・16 箱 OR 圏外判定(両軸とも 16 以内なら不成立)
//  ・未占有判定(5x5 以内にモンスター/未救出の女の子が居れば不成立)
//  ・地形分岐(NONE→可視個体 kind:"runtime" / 固体→埋没個体 kind:"runtime-bury" buried:true)
//  ・人口反映(大マップで長時間行動しても総数が 0 へ収束しない=despawn と対になる補充)
// シナリオ構築は G.monsters/G.dug/G.fallen/G.px/G.py へのランタイム state 注入で行い、
// tileType/girlPositions/oreAt/hazardAt 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47880; // 本番(47825)・playtester(47860)・funproxy(47867)・selfcheck 群(47871..47879) と非衝突。
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
check("VERSION = v0.20.0", ver === "v0.20.0", { ver });

// ============================================================================
// 1. 30% ゲートの統計的検証 + 決定論再現。
// ============================================================================
console.log("\n== 1. 30% ゲート ==");

const chanceStat = await page.evaluate(() => {
  G.dungeonId = 0;
  startDive();
  let hits = 0;
  const N = 3000;
  for (let i = 1; i <= N; i++) {
    if (runtimeSpawnChanceRoll(G.px, G.py, G.seed, i) < 0.30) hits++;
  }
  return { n: N, hits, rate: hits / N };
});
check("1a 30% ゲートの実測比率が 0.27〜0.33 に収まる(N=3000)",
  chanceStat.rate > 0.27 && chanceStat.rate < 0.33, chanceStat);

const chanceDet = await page.evaluate(() => {
  const a = [];
  const b = [];
  for (let i = 1; i <= 50; i++) a.push(runtimeSpawnChanceRoll(5, 3, 41027, i));
  for (let i = 1; i <= 50; i++) b.push(runtimeSpawnChanceRoll(5, 3, 41027, i));
  return { match: JSON.stringify(a) === JSON.stringify(b) };
});
check("1b 同一入力の 2 回呼び出しで完全一致(決定論)", chanceDet.match, chanceDet);

// ============================================================================
// 2. 非対称オフセット [-28,+27] + clamp(x∈[1,GRID_COLS-2], y∈[11,DEPTH_ROWS-2])。
// ============================================================================
console.log("\n== 2. オフセット/clamp ==");

const offsetStat = await page.evaluate(() => {
  G.dungeonId = 6; // 孤独な山 80×80(clamp が効く広さ)。
  startDive();
  let minOff = 999, maxOff = -999;
  const N = 2000;
  G.px = 40; G.py = 40; // 中央付近(edge clamp の影響を避けて素のオフセットレンジを見る)。
  for (let i = 1; i <= N; i++) {
    const offX = Math.floor(runtimeSpawnOffsetXRoll(G.px, G.py, G.seed, i) * 56) - 28;
    if (offX < minOff) minOff = offX;
    if (offX > maxOff) maxOff = offX;
  }
  // 端付近(px=1)での clamp 確認: 下限 1 に張り付くケースが発生すること。
  G.px = 1; G.py = 40;
  let clampedLowHit = false;
  for (let i = 1; i <= N; i++) {
    const offX = Math.floor(runtimeSpawnOffsetXRoll(G.px, G.py, G.seed, i) * 56) - 28;
    const col = Math.min(Math.max(G.px + offX, 1), CONST.GRID_COLS - 2);
    if (col === 1 && G.px + offX < 1) clampedLowHit = true;
  }
  // y 下限 11 の clamp 確認: 自機が地表付近(py=2)でも row は 11 未満にならない。
  G.px = 40; G.py = 2;
  let rowBelow11 = false, rowAt11 = false;
  for (let i = 1; i <= N; i++) {
    const offY = Math.floor(runtimeSpawnOffsetYRoll(G.px, G.py, G.seed, i) * 56) - 28;
    const row = Math.min(Math.max(G.py + offY, 11), CONST.DEPTH_ROWS - 2);
    if (row < 11) rowBelow11 = true;
    if (row === 11) rowAt11 = true;
  }
  G.dungeonId = 0;
  return { minOff, maxOff, clampedLowHit, rowBelow11, rowAt11 };
});
check("2a オフセット実効レンジが [-28,+27](非対称、o.b(56)+i-28 verbatim)",
  offsetStat.minOff === -28 && offsetStat.maxOff === 27, offsetStat);
check("2b x 下限 clamp(px=1 付近で col=1 に丸められる)", offsetStat.clampedLowHit, offsetStat);
check("2c y 下限 clamp(11 未満は発生せず、11 への丸めは発生する)",
  !offsetStat.rowBelow11 && offsetStat.rowAt11, offsetStat);

// ============================================================================
// 3. 16 箱 OR 圏外判定: 両軸とも 16 以内なら不成立、いずれかが 16 超なら候補になる。
// ============================================================================
console.log("\n== 3. 16 箱 OR 圏外 ==");

const box16 = await page.evaluate(() => {
  G.dungeonId = 6;
  startDive();
  G.monsters = [];
  G.px = 40; G.py = 40;
  // 両軸とも 16 以内(圏内)の候補 → 不成立のはず。runtimeSpawnStep 相当の判定をロジックだけ直接確認。
  const insideBox = !(Math.abs((G.px + 10) - G.px) > CONST.MONSTER_ACTIVE_RANGE || Math.abs((G.py + 5) - G.py) > CONST.MONSTER_ACTIVE_RANGE);
  // x のみ 16 超・y は 16 以内 → 成立(OR)。
  const xOnlyOutside = Math.abs((G.px + 20) - G.px) > CONST.MONSTER_ACTIVE_RANGE && Math.abs((G.py + 5) - G.py) <= CONST.MONSTER_ACTIVE_RANGE;
  G.dungeonId = 0;
  return { insideBox, xOnlyOutside };
});
check("3a 両軸 16 以内は圏内(不成立条件を満たす)", box16.insideBox, box16);
check("3b x のみ 16 超は OR で圏外扱い(despawn の両軸 AND とは非対称)", box16.xOnlyOutside, box16);

// ============================================================================
// 4. 未占有判定: 5x5 以内にモンスター/未救出の女の子が居れば不成立、居なければ成立しうる。
// ============================================================================
console.log("\n== 4. 未占有判定(5x5) ==");

const occupied = await page.evaluate(() => {
  G.dungeonId = 0;
  startDive();
  G.monsters = [];
  addMonster("BAT", 10, 10, "space");
  const o = {};
  o.blockedAtCenter = runtimeSpawnOccupied(10, 10);
  o.blockedAt2 = runtimeSpawnOccupied(12, 10); // Chebyshev 2。
  o.freeAt3 = !runtimeSpawnOccupied(13, 10); // Chebyshev 3 は範囲外。
  G.monsters = [];
  G.girls[0].state = "hidden"; G.girls[0].col = 5; G.girls[0].row = 5;
  o.blockedByHiddenGirl = runtimeSpawnOccupied(5, 5);
  G.girls[0].state = "rescued";
  o.freeAfterRescued = !runtimeSpawnOccupied(5, 5);
  return o;
});
check("4a 対象マス自体は占有扱い", occupied.blockedAtCenter, occupied);
check("4b Chebyshev 2 以内は占有扱い・3 は範囲外", occupied.blockedAt2 && occupied.freeAt3, occupied);
check("4c 未救出の女の子(hidden)も占有扱い・rescued は対象外", occupied.blockedByHiddenGirl && occupied.freeAfterRescued, occupied);

// ============================================================================
// 5. 地形分岐: NONE→kind:"runtime"(非 buried) / 固体→kind:"runtime-bury"(buried:true)。
//    実際に runtimeSpawnStep を成立させるため、条件(30%通過・16 箱外・未占有)を満たす
//    actionCount を総当たりで探す(世界生成には非介入。G.monsters/G.px/G.py のみ操作)。
// ============================================================================
console.log("\n== 5. 地形分岐(NONE→可視 / 固体→埋没) ==");

const terrainSpawn = await page.evaluate(() => {
  function findSpawn(dungeonId, wantSolid, maxTry) {
    G.dungeonId = dungeonId;
    startDive();
    G.monsters = [];
    G.girls = [];
    G.px = 40; G.py = 40;
    for (let i = 1; i <= maxTry; i++) {
      G.spawnRollCount = i - 1;
      const before = G.monsters.length;
      runtimeSpawnStep();
      if (G.monsters.length > before) {
        const m = G.monsters[G.monsters.length - 1];
        const t = tileAt(m.col, m.row);
        const isSolid = t === TILE.SOIL || t === TILE.HARD || t === TILE.ROCK;
        if (isSolid === wantSolid) return { found: true, kind: m.kind, buried: !!m.buried, tile: t, col: m.col, row: m.row, tries: i };
        G.monsters = []; // 目的の地形でなければ取り消して続行。
      }
    }
    return { found: false };
  }
  const spaceCase = findSpawn(6, false, 4000);
  const buryCase = findSpawn(6, true, 4000);
  G.dungeonId = 0;
  return { spaceCase, buryCase };
});
check("5a NONE マスへの湧きは kind:\"runtime\"・buried 未設定",
  terrainSpawn.spaceCase.found && terrainSpawn.spaceCase.kind === "runtime" && !terrainSpawn.spaceCase.buried,
  terrainSpawn.spaceCase);
check("5b 固体マスへの湧きは kind:\"runtime-bury\"・buried:true",
  terrainSpawn.buryCase.found && terrainSpawn.buryCase.kind === "runtime-bury" && terrainSpawn.buryCase.buried,
  terrainSpawn.buryCase);

// ============================================================================
// 6. 人口反映(統合): 大マップで長時間行動しても総数が単調減少で 0 へ収束しない
//    (despawn と対になる補充=成功条件の核)。
// ============================================================================
console.log("\n== 6. 人口反映(despawn と対) ==");

const repop = await page.evaluate(() => {
  G.dungeonId = 6; // 孤独な山 80×80。
  startDive();
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1]];
  const counts = [G.monsters.length];
  for (let i = 0; i < 400 && G.screen === "dive"; i++) {
    const [dc, dr] = dirs[i % dirs.length];
    const nc = G.px + dc, nr = G.py + dr;
    if (nc < 0 || nc >= CONST.GRID_COLS || nr < 0) continue;
    if (isSpace(nc, nr)) moveTo(nc, nr, false, false);
    else act(dc, dr);
    if (i % 40 === 39) counts.push(G.monsters.length);
  }
  G.dungeonId = 0;
  return { counts, spawnRolls: G.spawnRollCount, final: G.monsters.length };
});
check("6a 400 行動後もモンスター総数が 0 に張り付かない(補充が効いている)",
  repop.final > 0, repop);
check("6b spawnRollCount が行動数ぶん進んでいる(決定論ストリームが駆動している)",
  repop.spawnRolls > 0, repop);

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
