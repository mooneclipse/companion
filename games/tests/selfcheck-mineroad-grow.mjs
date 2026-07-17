// v0.9.0 育成 自己動作確認(implementer 用、playtester とは別)。
// 別ポートで静的サーバを自前起動し、ダイブ開始→PER レベルアップ系の状態遷移を実挙動で確認する。
// 本番ポート 47825 には一切触れない。検証後にサーバを閉じる。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47871; // 本番(47825)・playtester 既定(47860 系)と非衝突。
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

const version = await page.evaluate(() => window.G ? document.getElementById("ov-version")?.textContent : null);
const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.15.0", ver === "v0.15.0", { ver }); // v0.15.0 掘削8方向(STATUS v0.15.0)へ機械追随。

// ダイブ開始。
await page.evaluate(() => startDive());
const init = await page.evaluate(() => ({
  hp: G.hp, sp: G.stamina, hpMax: effHpMax(), spMax: effStaminaMax(),
  atk: playerAtk(), def: playerDef(), digSoil: digTaps(TILE.SOIL), digHard: digTaps(TILE.HARD),
  per: { ...G.per }, bp: G.bp, info: G.info, exp: G.exp,
}));
check("初期 PER 全0で素の値(HP30/SP100/digSOIL1)", init.hpMax === 30 && init.spMax === 100 && init.digSoil === 1, init);

// 情報→BP→PER レベルアップの経路。情報を注入して変換し各 PER を上げる。
const grow = await page.evaluate(() => {
  // 情報・EXP を注入(救出/撃破の代替=育成経路の純粋検証)。
  G.info = 5; G.exp = 60;
  const log = {};
  // 情報→BP。
  convertInfoToBp();
  log.afterInfo = { info: G.info, bp: G.bp };
  // EXP→BP。
  convertExpToBp();
  log.afterExp = { exp: G.exp, bp: G.bp };
  // BP を潤沢に与えて各 PER を 1 レベルずつ上げ、effXxx の変化を観測。
  G.bp = 50;
  const before = { hpMax: effHpMax(), spMax: effStaminaMax(), atk: playerAtk(), def: playerDef(), digSoil: digTaps(TILE.SOIL), digHard: digTaps(TILE.HARD) };
  levelUpPer("HP"); levelUpPer("ST"); levelUpPer("ATTACK"); levelUpPer("DEFENCE"); levelUpPer("DIG"); levelUpPer("SWIM");
  const after = { hpMax: effHpMax(), spMax: effStaminaMax(), atk: playerAtk(), def: playerDef(), digSoil: digTaps(TILE.SOIL), digHard: digTaps(TILE.HARD), per: { ...G.per }, bp: G.bp, hp: G.hp, sp: G.stamina };
  return { log, before, after };
});
check("情報1→BP3 変換(消費)", grow.log.afterInfo.info === 4 && grow.log.afterInfo.bp === 3, grow.log.afterInfo);
check("EXP20→BP1 変換(消費)", grow.log.afterExp.exp === 40 && grow.log.afterExp.bp === 4, grow.log.afterExp);
check("PER_HP で HP_MAX 30→35", grow.after.hpMax === grow.before.hpMax + 5, { b: grow.before.hpMax, a: grow.after.hpMax });
check("PER_ST で SP_MAX 100→120", grow.after.spMax === grow.before.spMax + 20, { b: grow.before.spMax, a: grow.after.spMax });
check("PER_ATTACK で攻撃+1", grow.after.atk === grow.before.atk + 1, { b: grow.before.atk, a: grow.after.atk });
check("PER_DEFENCE で防御+1", grow.after.def === grow.before.def + 1, { b: grow.before.def, a: grow.after.def });
check("PER_DIG で SOIL 手数 1(最低頭打ち)・HARD 2→1", grow.after.digSoil === 1 && grow.after.digHard === grow.before.digHard - 1, { soil: grow.after.digSoil, hardB: grow.before.digHard, hardA: grow.after.digHard });
check("PER_HP レベルアップで現HPも実効最大へ底上げ", grow.after.hp === grow.after.hpMax && grow.after.sp === grow.after.spMax, { hp: grow.after.hp, sp: grow.after.sp });

// SWIM の効果: 浸水マスでの消耗倍率が軽減されるか(自機を水マスに置いて hazardSpMult を見る)。
const swim = await page.evaluate(() => {
  // PER_SWIM を 0 と現在(1)で hazardSpMult を比較。自機を水のあるマスへ移し dug 化して空間にする。
  // 決定論で hazardAt が WATER を返すマスを探す。
  let found = null;
  for (let c = 0; c < CONST.GRID_COLS && !found; c++)
    for (let r = 5; r <= CONST.DEPTH_ROWS && !found; r++)
      if (hazardAt(c, r, G.seed) === HAZARD.WATER) found = { c, r };
  if (!found) return { found: false };
  G.dug.add(found.c + "," + found.r); // 空間化(掘った跡)=浸水が現れる。
  G.px = found.c; G.py = found.r;
  const swimLv = G.per.SWIM;
  const withSwim = hazardSpMult();
  G.per.SWIM = 0;
  const noSwim = hazardSpMult();
  G.per.SWIM = swimLv;
  return { found: true, swimLv, withSwim, noSwim };
});
check("PER_SWIM で水中 SP 倍率が軽減(<無強化)", swim.found && swim.withSwim < swim.noSwim, swim);

// UI: 工房オーバーレイを開き育成タブへ切替、grow-list に変換2行+PER6行=8行出るか。
const ui = await page.evaluate(() => {
  G.info = 1; G.exp = 25; G.bp = 10;
  openCraft();
  setWorkshopTab("grow");
  const growHidden = document.getElementById("grow-list").hidden;
  const rows = document.querySelectorAll("#grow-list .craft-row").length;
  const tabActive = document.getElementById("tab-grow").classList.contains("active");
  // タブをクラフトへ戻せる(gate Q 互換)。
  setWorkshopTab("craft");
  const craftShown = !document.getElementById("craft-list").hidden && document.getElementById("grow-list").hidden;
  closeCraft();
  return { growHidden, rows, tabActive, craftShown };
});
check("育成タブ表示=8行(変換2+PER6)・active・クラフトへ戻せる", !ui.growHidden && ui.rows === 8 && ui.tabActive && ui.craftShown, ui);

check("pageerror 0", errors.length === 0, errors);

await browser.close();
await new Promise((r) => server.close(r));

const failed = results.filter((r) => !r.ok);
console.log("\n=== " + (failed.length === 0 ? "ALL PASS (" + results.length + ") ===" : failed.length + " FAILED ==="));
process.exit(failed.length === 0 ? 0 : 1);
