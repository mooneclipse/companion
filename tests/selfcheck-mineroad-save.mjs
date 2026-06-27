// v0.12.0 セーブ/永続 自己動作確認(implementer 用、playtester とは別)。
// 別ポートで静的サーバを自前起動し、永続化の状態遷移を実挙動で確認する。
// 本番ポート 47825 には一切触れない。検証後にサーバを閉じる。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47874; // 本番(47825)・playtester・grow(47871)・companion(47873) と非衝突。
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
await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + JSON.stringify(detail) : "")); };

await page.goto(`http://127.0.0.1:${PORT}/mineroad/`, { waitUntil: "networkidle" });

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.12.0", ver === "v0.12.0", { ver });

// ============================================================================
// 1. fail→retry で永続 state 復元
// ============================================================================
console.log("\n== 1. fail→retry で永続 state 復元 ==");

// 初回ダイブ: 1人救出 + PER を振る + surfaceReturn でセーブ。
const run1 = await page.evaluate(() => {
  startDive();
  G.pick = "DIAMOND";
  G.monsters = [];
  G.spawned = new Set();
  // 最寄りの女の子(11,6) へ掘り進む。
  while (G.px < 11) act(1, 0);
  while (G.py < 6) act(0, 1);
  const girl = G.girls.find(g => g.origRow === 6);
  if (!girl || girl.state !== "following") return { err: "girl not following" };
  // 地表へ戻る(surfaceReturn が自動発火)。
  while (G.py > 0) act(0, -1);
  // 育成: 情報→BP→PER_HP。
  convertInfoToBp();
  if (G.bp >= bpCostFor("HP", 0)) levelUpPer("HP");
  return {
    rescued: G.rescued, per: { ...G.per }, info: G.info, bp: G.bp, pick: G.pick,
  };
});
check("1a 初回ダイブで1人救出+PER_HP", run1.rescued >= 1 && run1.per && run1.per.HP >= 1, run1);

// surfaceReturn でセーブされたか。
const save1 = await page.evaluate(() => {
  // py===0 に到達した時点で surfaceReturn は act 内で自動発火しているが、
  // 育成(convertInfo/growPer)は surfaceReturn の後なので、育成後の状態をセーブするために
  // 再度手動で surfaceReturn を呼ぶ。ただし既に py===0 なので girls 追従は no-op、全回復+セーブ。
  surfaceReturn();
  try { return JSON.parse(localStorage.getItem("mineroad_save")); } catch (e) { return null; }
});
check("1b surfaceReturn でセーブデータ存在", save1 && save1.v === 1, save1);
check("1c セーブデータに rescued/per/pick", save1 && save1.rescued >= 1 && save1.per && save1.per.HP >= 1 && save1.pick === "DIAMOND", save1);

// 力尽きさせて retry。地中(py>0)でないと checkFail が発火しないので 1 マス掘り下げてから。
const retry1 = await page.evaluate(() => {
  act(0, 1); // 地中へ 1 マス降りる。
  G.hp = 0;
  G.stamina = 0;
  checkFail();
  if (G.screen !== "fail") return { err: "not fail", screen: G.screen, py: G.py };
  startDive();
  return {
    rescued: G.rescued,
    per: { ...G.per },
    info: G.info,
    bp: G.bp,
    pick: G.pick,
    girlRescued: G.girls.filter(g => g.state === "rescued").length,
    girlLevels: G.girls.map(g => ({ level: g.level, cexp: g.cexp })),
  };
});
check("1d retry 後に rescued 復元", retry1.rescued >= 1, retry1);
check("1e retry 後に per 復元", retry1.per && retry1.per.HP >= 1, retry1);
check("1f retry 後に pick 復元", retry1.pick === "DIAMOND", retry1);
check("1g retry 後に girls[rescued] 復元", retry1.girlRescued >= 1, retry1);

// ============================================================================
// 2. surfaceReturn でセーブされ localStorage に保存
// ============================================================================
console.log("\n== 2. surfaceReturn で localStorage に保存 ==");

const save2 = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("mineroad_save")); } catch (e) { return null; }
});
check("2a セーブデータのバージョン", save2 && save2.v === 1, save2);
check("2b セーブデータの永続対象", save2 && typeof save2.rescued === "number" && save2.per && typeof save2.pick === "string", save2);
check("2c セーブデータの girls 配列", save2 && Array.isArray(save2.girls), save2);

// ============================================================================
// 3. クリア後にセーブ消去
// ============================================================================
console.log("\n== 3. クリア後にセーブ消去 ==");

const clear3 = await page.evaluate(() => {
  showClear();
  try { return localStorage.getItem("mineroad_save"); } catch (e) { return "error"; }
});
check("3a クリア後にセーブデータ消去", clear3 === null, { clear3 });

// ============================================================================
// 4. ランごとリセット state は復元されない
// ============================================================================
console.log("\n== 4. ランごとリセット state は復元されない ==");

// 新しいダイブで鉱石やアイテムを持った状態にする。
const run4 = await page.evaluate(() => {
  try { localStorage.removeItem("mineroad_save"); } catch (e) {}
  startDive();
  G.pick = "DIAMOND";
  G.monsters = [];
  G.spawned = new Set();
  G.ore.COPPER = 10;
  G.ore.IRON = 5;
  G.mushrooms = 20;
  G.potions = 3;
  G.ladders = 2;
  G.antenna = true;
  G.exp = 50;
  G.kills = 10;
  // 1人救出して永続 state に値を入れる。
  while (G.px < 11) act(1, 0);
  while (G.py < 6) act(0, 1);
  while (G.py > 0) act(0, -1);
  // surfaceReturn は自動発火済み。
  return { saved: true };
});
check("4a 事前準備(鉱石/アイテム所持+救出)", run4.saved, run4);

const retry4 = await page.evaluate(() => {
  act(0, 1); // 地中へ(checkFail は py>0 が条件)。
  G.hp = 0;
  G.stamina = 0;
  checkFail();
  startDive();
  return {
    ore: { ...G.ore },
    mushrooms: G.mushrooms,
    potions: G.potions,
    ladders: G.ladders,
    antenna: G.antenna,
    exp: G.exp,
    kills: G.kills,
    rescued: G.rescued,
  };
});
check("4b ore リセット", retry4.ore && retry4.ore.COPPER === 0 && retry4.ore.IRON === 0, retry4);
check("4c mushrooms/potions/ladders リセット", retry4.mushrooms === 0 && retry4.potions === 0 && retry4.ladders === 0, retry4);
check("4d antenna リセット", retry4.antenna === false, retry4);
check("4e exp/kills リセット", retry4.exp === 0 && retry4.kills === 0, retry4);
check("4f rescued は永続(リセットされない)", retry4.rescued >= 1, retry4);

// ============================================================================
// 5. 決定論: 3 回連続一致
// ============================================================================
console.log("\n== 5. 決定論: 3回連続一致 ==");

const detResults = [];
for (let trial = 0; trial < 3; trial++) {
  await page.evaluate(() => {
    try { localStorage.removeItem("mineroad_save"); } catch (e) {}
  });
  const r = await page.evaluate(() => {
    startDive();
    G.pick = "DIAMOND";
    G.monsters = [];
    G.spawned = new Set();
    while (G.px < 11) act(1, 0);
    while (G.py < 6) act(0, 1);
    while (G.py > 0) act(0, -1);
    convertInfoToBp();
    if (G.bp >= bpCostFor("HP", 0)) levelUpPer("HP");
    surfaceReturn();
    try { return JSON.parse(localStorage.getItem("mineroad_save")); } catch (e) { return null; }
  });
  detResults.push(JSON.stringify(r));
}
const detOk = detResults[0] === detResults[1] && detResults[1] === detResults[2] && detResults[0] !== "null";
check("5a 決定論(セーブデータ 3回連続一致)", detOk, { match: detOk, first30: (detResults[0] || "").slice(0, 80) });

// ============================================================================
// 6. 非介入: ワールドレイヤーに変更なし
// ============================================================================
console.log("\n== 6. 非介入: ワールドレイヤーに変更なし ==");

const nonIntervention = await page.evaluate(() => {
  startDive();
  const seed = G.seed;
  const cols = 15, rows = 15;
  for (let c = 0; c < cols; c++) {
    for (let r = 1; r <= rows; r++) {
      const t = tileType(c, r, seed);
      if (t === undefined) return "tileType undefined at " + c + "," + r;
    }
  }
  const gp = girlPositions(seed);
  if (gp.length !== 5) return "girlPositions count " + gp.length;
  return true;
});
check("6a tileType/girlPositions 不変", nonIntervention === true, { nonIntervention });

// ============================================================================
// 総合
// ============================================================================
console.log("\n== 総合 ==");
const pe = errors.filter(e => !e.includes("net::ERR_") && !e.includes("favicon"));
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
