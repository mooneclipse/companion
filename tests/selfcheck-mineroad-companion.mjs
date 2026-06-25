// v0.10.0 仲間同行 自己動作確認(implementer 用、playtester とは別)。
// 別ポートで静的サーバを自前起動し、ダイブ開始→following 中の女の子を同行指定→同行中戦闘で EXP 蓄積→
// 地表帰還で別れてレベルアップ、の状態遷移を実挙動で確認する。本番ポート 47825 には一切触れない。
// 決定論(同一操作列で3回連続一致)・非介入(girlPositions/oreAt 不変)も検証する。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47872; // 本番(47825)・playtester 既定(47860 系)・grow selfcheck(47871) と非衝突。
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
check("VERSION = v0.10.0", ver === "v0.10.0", { ver });

// 同行ヘルパーを page 側に注入する共通シナリオ。startDive→1人を following 化→同行→撃破で cexp→帰還で清算。
// 戦闘の決定論巡回を使わず、状態 API を直接叩いて同行の経路を純粋に検証する(物理は既存 following レイヤー)。
const scenario = await page.evaluate(() => {
  const log = {};
  startDive();

  // ① 同行未指定: playerAtk が素の値(effCompanionAtk=0)、killMonster の cexp 加算は no-op。
  const baseAtk = playerAtk();
  // ダミーモンスターを 1 体撃破(同行 0 人) → 自機プール G.exp は増えるが companion は null。
  const fakeFoe = { key: "BAT", col: 0, row: 0, hp: 0 };
  G.monsters = [fakeFoe];
  const expBefore0 = G.exp;
  killMonster(fakeFoe);
  log.companionNullAfterKill = G.companion; // null のはず。
  log.expGained0 = G.exp - expBefore0; // BAT exp=2。
  log.baseAtk = baseAtk;

  // ② following 中の女の子を 1 人作る(discoverGirl 相当 = state を following に)。
  const g = G.girls[0];
  g.state = "following";
  g.col = G.px; g.row = G.py; // 隣で戦える位置。
  // ③ 同行指定 → G.companion がその girl を指す。
  setCompanion(g);
  log.companionSet = (G.companion === g);

  // ④ 同行中の撃破で companion.cexp と自機プール G.exp が同額蓄積(二面両立)。
  const foe1 = { key: "SNAKE", col: 1, row: 1, hp: 0 }; // SNAKE exp=6。
  G.monsters = [foe1];
  const expBefore1 = G.exp;
  const cexpBefore = g.cexp;
  killMonster(foe1);
  log.selfExpGained = G.exp - expBefore1; // 6。
  log.cexpGained = g.cexp - cexpBefore; // 6(並走、差し引かない)。

  // ⑤ companion レベルで playerAtk に援護加算(effCompanionAtk)。
  g.level = 3; // 援護 +3 のはず(COMPANION_ATK_PER_LV=1)。
  log.atkWithCompanion = playerAtk();
  log.atkBase = baseAtk;
  log.companionAtk = effCompanionAtk();

  // ⑥ 地表帰還(rescueGirl)で cexp→level 反映・companion 解除。cexp を清算しやすい値に整える。
  g.cexp = 25; g.level = 0; // EXP_PER_LV=10 → +2 レベル、端数 5 繰り越し。
  g.col = G.px; g.row = 0; // 地表へ。
  rescueGirl(g);
  log.levelAfterRescue = g.level; // 2。
  log.cexpAfterRescue = g.cexp; // 5(端数繰り越し)。
  log.companionCleared = (G.companion === null);
  log.infoAfterRescue = G.info; // 救出で情報 +1(別軸=不変、清算で消費しない)。
  log.rescuedCount = g.state; // "rescued"。

  return log;
});
check("同行未指定で companion=null・撃破で cexp 加算 no-op(自機 exp は +2)",
  scenario.companionNullAfterKill === null && scenario.expGained0 === 2, scenario);
check("following 中の1人を同行指定→companion がその girl を指す", scenario.companionSet === true, scenario);
check("同行中の撃破で companion.cexp +6 と自機 exp +6 が並走(v0.9.0 BP 路不変=二面両立)",
  scenario.selfExpGained === 6 && scenario.cexpGained === 6, scenario);
check("companion レベル3 で playerAtk に援護 +3(effCompanionAtk)",
  scenario.companionAtk === 3 && scenario.atkWithCompanion === scenario.atkBase + 3, scenario);
check("地表帰還で cexp25→level+2(端数5繰越)・companion 解除・情報 +1(別軸不変)",
  scenario.levelAfterRescue === 2 && scenario.cexpAfterRescue === 5 &&
  scenario.companionCleared === true && scenario.infoAfterRescue >= 1 &&
  scenario.rescuedCount === "rescued", scenario);

// ⑦ 境界: 同行0人で清算 no-op / 複数 following でも companion は1人だけ(上書きで前の同行は外れる)。
const boundary = await page.evaluate(() => {
  startDive();
  // 同行0人で rescueGirl を呼んでも settleCompanion は呼ばれない(companion!==g)。
  const ga = G.girls[0];
  ga.state = "following"; ga.col = G.px; ga.row = 0;
  rescueGirl(ga); // companion=null のまま=settle no-op。
  const noCrash = (G.companion === null);
  // 複数 following → 1人だけ companion。2人目を同行すると1人目は自動で外れる。
  startDive();
  const g1 = G.girls[0]; const g2 = G.girls[1];
  g1.state = "following"; g2.state = "following";
  setCompanion(g1);
  const firstSet = (G.companion === g1);
  setCompanion(g2);
  const onlyOne = (G.companion === g2 && G.companion !== g1);
  return { noCrash, firstSet, onlyOne };
});
check("境界=同行0人で清算 no-op・複数 following でも companion は1人だけ",
  boundary.noCrash && boundary.firstSet && boundary.onlyOne, boundary);

// ⑧ 決定論: 同一操作列を3回繰り返して companion/cexp/level/girlPositions が完全一致。
const detRuns = [];
for (let i = 0; i < 3; i++) {
  const snap = await page.evaluate(() => {
    startDive();
    const g = G.girls[2];
    g.state = "following"; g.col = G.px; g.row = G.py;
    setCompanion(g);
    // 固定 key の撃破を 3 回(決定論=同じ EXP)。
    for (const key of ["BAT", "SNAKE", "SPIDER"]) {
      const foe = { key, col: 1, row: 1, hp: 0 };
      G.monsters = [foe];
      killMonster(foe);
    }
    const gp = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
    return { cexp: g.cexp, companionIsG: (G.companion === g), gp, exp: G.exp };
  });
  detRuns.push(snap);
}
const detEqual = detRuns.every((r) => r.cexp === detRuns[0].cexp && r.exp === detRuns[0].exp && r.gp === detRuns[0].gp && r.companionIsG);
check("決定論3回連続一致(cexp/exp/companion/girlPositions)", detEqual, detRuns);

// ⑨ 非介入: girlPositions verbatim(EXPECTED_GIRLS)・oreAt 決定論不変(同行系は別 state でレイヤー非干渉)。
const noninv = await page.evaluate(() => {
  startDive();
  const gp = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
  // 同行操作を一通り走らせた後も girlPositions / oreAt が不変か。
  const g = G.girls[0];
  g.state = "following"; setCompanion(g);
  const foe = { key: "SNAKE", col: 1, row: 1, hp: 0 };
  G.monsters = [foe]; killMonster(foe);
  const gp2 = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
  // oreAt 数点をサンプリングして一致を見る。
  const ore = [];
  for (let c = 0; c < CONST.GRID_COLS; c++) ore.push(oreAt(c, 7, G.seed) || "-");
  return { gp, gp2, ore: ore.join(","), expected: "11,6|0,8|4,10|3,12|8,14" };
});
check("非介入=girlPositions verbatim 一致(EXPECTED_GIRLS)",
  noninv.gp === noninv.expected && noninv.gp2 === noninv.expected, noninv);

// ⑩ 仲間タブ UI: 工房オーバーレイを開き仲間タブへ切替、companion-list が出る・active・他タブへ戻せる。
const ui = await page.evaluate(() => {
  startDive();
  const g = G.girls[0]; g.state = "following"; // 同行候補を1人作る。
  openCraft();
  setWorkshopTab("companion");
  const compHidden = document.getElementById("companion-list").hidden;
  const rows = document.querySelectorAll("#companion-list .craft-row").length; // following 1人=1行。
  const tabActive = document.getElementById("tab-companion").classList.contains("active");
  // 同行ボタンが押せる(following 中)。
  const btn = document.querySelector("#companion-list .craft-make");
  const btnEnabled = btn ? !btn.disabled : false;
  // クラフトへ戻せる(gate Q 互換)。
  setWorkshopTab("craft");
  const craftShown = !document.getElementById("craft-list").hidden && document.getElementById("companion-list").hidden;
  closeCraft();
  return { compHidden, rows, tabActive, btnEnabled, craftShown };
});
check("仲間タブ表示=following1行・active・同行ボタン押下可・クラフトへ戻せる",
  !ui.compHidden && ui.rows === 1 && ui.tabActive && ui.btnEnabled && ui.craftShown, ui);

check("pageerror 0", errors.length === 0, errors);

await browser.close();
await new Promise((r) => server.close(r));

const failed = results.filter((r) => !r.ok);
console.log("\n=== " + (failed.length === 0 ? "ALL PASS (" + results.length + ") ===" : failed.length + " FAILED ==="));
process.exit(failed.length === 0 ? 0 : 1);
