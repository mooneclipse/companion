// 面白さ代理レポート(gate 外、lead 判断材料)。固定 seed 1 人救出の縦切りなので、
// policy バリエーションで「理不尽でない(最適で救出可)/手応えがある(無策で力尽きる)」を測る。
// N=20 を 4 policy ×5 で走らせ クリア率・到達深度・1 ラン手数を集計。内部関数で高速自走。
import { chromium } from "playwright";
const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47827";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
const page = await ctx.newPage();
await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// ブラウザ内で 1 ラン自走する bot(内部 act を方向決めで叩く=高速)。policy で振る舞いを変える。
const runs = await page.evaluate(() => {
  const results = [];
  // policy: greedy=女の子へ最短掘り下げ+連れ帰り / reckless=深部へ闇雲掘り(撤退しない) /
  //         cautious=途中で地表撤退を挟む / timid=浅く掘って即撤退(救出狙わない)。
  function runBot(policy) {
    startDive();
    const gcol = G.girl.col, grow = G.girl.row;
    let steps = 0;
    const MAX = 400;
    // 女の子列へ寄せる(地表)。
    function alignTo(c) { while (G.px !== c && steps < MAX) { act(G.px < c ? 1 : 0, 0) === undefined ? null : 0; act(G.px < c ? 1 : 0, 0); steps++; if (steps > 30) break; } }
    function moveCol(c) { let g = 0; while (G.px !== c && g < 30) { act(G.px < c ? 1 : -1, 0); g++; steps++; } }
    function digDownOnce() { const py0 = G.py; act(0, 1); steps++; return G.py !== py0; }
    function climbUpOnce() { const py0 = G.py; act(0, -1); steps++; return G.py !== py0; }

    if (policy === "greedy") {
      moveCol(gcol);
      // 女の子まで掘り下げ(HARD は 2 手)。
      let g = 0;
      while (G.girl.state === "hidden" && G.py < CONST.DEPTH_ROWS && G.screen === "dive" && g < 60) { digDownOnce(); g++; }
      // 連れ帰り(縦坑を登る)。
      g = 0;
      while (G.py > 0 && G.screen === "dive" && g < 60) { if (!climbUpOnce()) break; g++; }
    } else if (policy === "reckless") {
      // 闇雲に深部へ掘り続ける(撤退しない)→ 二段ゲージを使い切って力尽きるか。
      let g = 0;
      while (G.screen === "dive" && g < 200) {
        if (!digDownOnce()) { act(1, 0); steps++; } // 詰まれば横へ。
        g++;
      }
    } else if (policy === "cautious") {
      // 5 層潜って撤退(全回復)を 2 回 → その後女の子へ。
      for (let cyc = 0; cyc < 2; cyc++) {
        let g = 0; while (G.py < 5 && G.screen === "dive" && g < 30) { digDownOnce(); g++; }
        g = 0; while (G.py > 0 && G.screen === "dive" && g < 30) { if (!climbUpOnce()) break; g++; }
      }
      moveCol(gcol);
      let g = 0; while (G.girl.state === "hidden" && G.py < CONST.DEPTH_ROWS && G.screen === "dive" && g < 60) { digDownOnce(); g++; }
      g = 0; while (G.py > 0 && G.screen === "dive" && g < 60) { if (!climbUpOnce()) break; g++; }
    } else { // timid
      let g = 0; while (G.py < 3 && G.screen === "dive" && g < 20) { digDownOnce(); g++; }
      g = 0; while (G.py > 0 && G.screen === "dive" && g < 20) { if (!climbUpOnce()) break; g++; }
    }
    return {
      policy,
      screen: G.screen,
      rescued: G.rescued,
      clear: G.screen === "clear",
      fail: G.screen === "fail",
      maxDepth: G.maxDepthThisDive,
      steps,
      spLeft: G.stamina,
      hpLeft: G.hp,
      girlState: G.girl.state,
    };
  }
  for (const p of ["greedy", "reckless", "cautious", "timid"]) {
    for (let i = 0; i < 5; i++) results.push(runBot(p));
  }
  return results;
});

// 集計。
const byPolicy = {};
for (const r of runs) {
  (byPolicy[r.policy] ||= []).push(r);
}
console.log("== 面白さ代理レポート(N=20, 固定 seed 決定論・policy 4種×5) ==");
for (const [p, arr] of Object.entries(byPolicy)) {
  const clear = arr.filter((r) => r.clear).length;
  const fail = arr.filter((r) => r.fail).length;
  const avgDepth = (arr.reduce((s, r) => s + r.maxDepth, 0) / arr.length).toFixed(1);
  const avgSteps = (arr.reduce((s, r) => s + r.steps, 0) / arr.length).toFixed(0);
  out(p, { クリア: `${clear}/5`, 力尽き: `${fail}/5`, 平均最深: avgDepth, 平均手数: avgSteps, sample: arr[0] });
}
const total = runs.length;
const clears = runs.filter((r) => r.clear).length;
const fails = runs.filter((r) => r.fail).length;
out("全体", { クリア率: `${((clears / total) * 100).toFixed(0)}% (${clears}/${total})`, 力尽き率: `${((fails / total) * 100).toFixed(0)}%` });
await browser.close();
