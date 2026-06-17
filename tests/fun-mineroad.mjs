// 面白さ代理レポート(gate 外、lead のバランス判断材料)。v0.3.0 はクリア条件が
// 「5人全員救出 + 最下層(15)到達 + 探索率 100%」に変わった(1人=即クリア廃止)。
// 固定 seed=41027 の決定論盤面なので RNG 揺らぎは無い。代わりに「行動予算(撤退ループの
// 上限ダイブ数)」と policy を振って、最適行動でどれくらいクリアできるか・何手かかるか・
// 支配戦略の有無・到達分布を測る。これは面白さの相関指標(合否には含めない)。
//
// bot は内部 act/move を方向決めで叩く高速自走。各 policy で「掘り進め方」「撤退判断」を変える。
import { chromium } from "playwright";
const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47860";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
const page = await ctx.newPage();
await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const runs = await page.evaluate(() => {
  const results = [];

  // 共通: 1 歩掘り/移動/登りユーティリティ(内部 act 経由・行動コストは本物)。
  // policy:
  //  optimal   = 全 girl を浅い順に救出しつつ、各列を掘って探索率を上げ、最下層へも到達してから帰る(全力)。
  //  rescueOnly= 5人救出だけ狙う(最下層到達・探索 100% は無視)→ クリア要件②③欠落で未クリアのはず。
  //  greedyDepth=ひたすら最下層へ最短掘り(救出・探索率は副次)→ ①欠落で未クリアのはず。
  //  reckless  = 撤退せず掘り続ける(力尽きやすさ=手応えの確認)。
  function runBot(policy) {
    startDive();
    const girls = G.girls.map((g) => ({ col: g.col, row: g.origRow }));
    let steps = 0;
    const MAX = 6000;
    let dives = 1;

    function digDownOnce() { const py0 = G.py; act(0, 1); steps++; return G.py !== py0 || G.screen !== "dive"; }
    function climbUpOnce() { const py0 = G.py; act(0, -1); steps++; return G.py !== py0; }
    function moveCol(c) { let g = 0; while (G.px !== c && g < 40 && G.screen === "dive") { act(G.px < c ? 1 : -1, 0); g++; steps++; } }
    // 地表へ帰還(掘った縦坑を登る)。戻れたら全回復(surfaceReturn)。
    function retreat() {
      let g = 0;
      while (G.py > 0 && G.screen === "dive" && g < 60) { if (!climbUpOnce()) break; g++; }
      if (G.py === 0) dives++;
    }
    // ある列を row=target まで掘り下げる(その列の縦坑を作る = 帰り道 + 探索)。
    function digColumnTo(col, target) {
      moveCol(col);
      let g = 0;
      while (G.py < target && G.screen === "dive" && steps < MAX && g < 80) {
        const ok = digDownOnce();
        if (!ok) break; // ROCK 等で詰まり。
        g++;
        // スタミナ+体力が細ったら一旦撤退して全回復(撤退ループの肝)。
        if (G.stamina <= 0 && G.hp <= 8) { retreat(); if (G.screen !== "dive") return; moveCol(col); }
      }
    }

    if (policy === "rescueOnly" || policy === "optimal") {
      // 女の子を row 浅い順に救出。各列の縦坑を掘り下げ → 発見 → 連れ帰り。
      const order = girls.slice().sort((a, b) => a.row - b.row);
      for (const gp of order) {
        if (G.screen !== "dive") break;
        digColumnTo(gp.col, gp.row);
        if (G.screen !== "dive") break;
        retreat(); // 連れ帰り(追従が一緒に上がる)。
      }
    }
    if (policy === "greedyDepth" || policy === "optimal") {
      // 最下層(DEPTH_ROWS)まで 1 列掘り下げて到達(探索率も多少上がる)。
      digColumnTo(G.px, CONST.DEPTH_ROWS);
      if (G.screen === "dive") retreat();
    }
    if (policy === "optimal") {
      // 探索率 100% へ: 全列を最下層まで掘り下げ、各列で撤退を挟みつつ seen を広げる。
      for (let c = 0; c < CONST.GRID_COLS && G.screen === "dive" && steps < MAX; c++) {
        digColumnTo(c, CONST.DEPTH_ROWS);
        if (G.screen !== "dive") break;
        retreat();
      }
      // 最後に地表へ戻ってクリア判定を踏ませる。
      if (G.screen === "dive") retreat();
    }
    if (policy === "reckless") {
      // 撤退せず掘り続ける(力尽きやすさ = 手応えの確認)。
      let g = 0;
      while (G.screen === "dive" && g < 400) {
        if (!digDownOnce()) { act(1, 0); steps++; }
        g++;
      }
    }

    const explore = Math.round((G.seen ? Math.min(1, G.seen.size / G.totalTiles) : 0) * 100);
    return {
      policy,
      screen: G.screen,
      clear: G.screen === "clear",
      fail: G.screen === "fail",
      rescued: G.rescued,
      maxDepth: G.maxDepthThisDive,
      explore,
      dives,
      steps,
    };
  }

  for (const p of ["optimal", "rescueOnly", "greedyDepth", "reckless"]) {
    for (let i = 0; i < 5; i++) results.push(runBot(p));
  }
  return results;
});

const byPolicy = {};
for (const r of runs) (byPolicy[r.policy] ||= []).push(r);

console.log("== 面白さ代理レポート v0.3.0(固定 seed=41027 決定論・policy 4種×5) ==");
console.log("   クリア条件 = 5人救出 + 最下層(15)到達 + 探索率 100%");
for (const [p, arr] of Object.entries(byPolicy)) {
  const clear = arr.filter((r) => r.clear).length;
  const fail = arr.filter((r) => r.fail).length;
  const avg = (f) => (arr.reduce((s, r) => s + f(r), 0) / arr.length).toFixed(1);
  out(p, {
    クリア: `${clear}/5`, 力尽き: `${fail}/5`,
    平均救出: avg((r) => r.rescued) + "/5",
    平均最深: avg((r) => r.maxDepth),
    平均探索率: avg((r) => r.explore) + "%",
    平均ダイブ数: avg((r) => r.dives),
    平均手数: Math.round(+avg((r) => r.steps)),
    sample: arr[0],
  });
}
const total = runs.length;
const clears = runs.filter((r) => r.clear).length;
const fails = runs.filter((r) => r.fail).length;
out("全体", {
  クリア率: `${((clears / total) * 100).toFixed(0)}% (${clears}/${total})`,
  力尽き率: `${((fails / total) * 100).toFixed(0)}%`,
});
await browser.close();
