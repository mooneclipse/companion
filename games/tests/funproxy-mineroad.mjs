// 面白さ代理レポート(gate 外、合否に含めない)。簡易戦略 bot で N ラン自走させ、到達分布を測る。
// 注意: マインロードは固定 BASE_SEED の決定論ゲーム(乱数なし)。盤面は毎ランほぼ同一なので、
// 「クリア率(15-40%帯)」の標準指標はそのままは当てはまらない。さらにクリア条件は探索率 100%
// (15x15 全マス踏破)+ 全5人 + 最下層 = フルコンプ習熟を要する高いバー。よって本レポートは
// クリア率ではなく「貪欲生存 bot が 1 ラン(力尽きるまで)でどこまで潜れ/何人救えるか + 撤退の
// 手応えが生じるか」を相関指標として出す。bot の質を測っているのであって面白さの保証ではない。
//
// bot 戦略(中庸): 真下を掘って潜行 → スタミナが閾値を切ったら掘った縦坑を登って地表へ撤退・全回復
// → 再潜行。女の子に隣接したら救出経路へ寄せる(縦坑追従)。HARD/ROCK で詰まったら横へ逸れる。
// 完全攻略は狙わない(pathfinding を作り込むと bot の質測定になる)。1 ラン = 力尽きるまで or 上限手数。
import { chromium } from "playwright";
const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47867";
const N = +(process.env.FP_N || 20);
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const browser = await chromium.launch();
const results = [];

for (let run = 0; run < N; run++) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(150);

  // bot を page 内で 1 ラン走らせる(内部関数で高速に。act/moveTo は実ゲームロジック)。
  const r = await page.evaluate(async () => {
    startDive();
    // 多少のラン間ばらつきを出すため、横移動の偏りだけ run ごとに変える擬似戦略(乱数は使わない)。
    const SP_RETREAT = 18; // スタミナがこの値を切ったら撤退。
    let actions = 0;
    let retreats = 0;
    const maxActions = 4000;
    let guard = 0;
    function climbToSurface() {
      // 掘った縦坑(自機列)を登って地表へ。掘り跡が無ければ上を掘りながら登る。
      let g = 0;
      while (G.py > 0 && G.screen === "dive" && g < 60) {
        const before = G.py;
        act(0, -1);
        actions++;
        g++;
        if (G.py === before) break; // 登れない(硬い土の上等)。
      }
      if (G.py === 0) { retreats++; }
    }
    while (G.screen === "dive" && actions < maxActions && guard < maxActions) {
      guard++;
      // 撤退判断: スタミナ低下で地表全回復へ。
      if (G.stamina <= SP_RETREAT && G.py > 0) {
        // まず自機列に地表までの掘り跡を確保(無い区間は下→上の順に既に掘ってあるはず)。
        climbToSurface();
        if (G.py !== 0) break; // 帰れない = 詰み(力尽きる前に break)。
        // 地表で全回復は moveTo(.,0) の surfaceReturn で起きる。明示的に呼ぶ。
        if (typeof surfaceReturn === "function") surfaceReturn();
        continue;
      }
      // 隣接に発見済み/追従中の女の子が居れば連れ帰り優先(縦坑を登る)。
      const following = G.girls.find((x) => x.state === "following");
      if (following) {
        // 地表へ向けて登る(追従ロジックは advanceGirl が moveTo 経由で回る)。
        const before = G.py;
        act(0, -1);
        actions++;
        if (G.py === 0) { surfaceReturn && surfaceReturn(); }
        if (G.py === before) {
          // 登れない → 横へ逸れて縦坑を作り直す。
          act(G.px > 0 ? -1 : 1, 0); actions++;
        }
        continue;
      }
      // 通常: 真下を掘って潜行。
      const beforePy = G.py;
      act(0, 1);
      actions++;
      if (G.py === beforePy) {
        // 真下が掘れない(HARD で power 不足/ROCK)→ 横へ逸れる。
        const dir = (G.px < CONST.GRID_COLS - 1) ? 1 : -1;
        act(dir, 0); actions++;
      }
    }
    return {
      screen: G.screen,
      rescued: G.rescued,
      maxDepth: G.maxDepthThisDive,
      exploredPct: Math.round(exploreRatio() * 100),
      mushrooms: G.mushrooms,
      actions,
      retreats,
      hp: G.hp,
      stamina: G.stamina,
      cleared: G.screen === "clear",
    };
  });
  results.push(r);
  await ctx.close();
}
await browser.close();

// 集計。
const cleared = results.filter((r) => r.cleared).length;
const depths = results.map((r) => r.maxDepth).sort((a, b) => a - b);
const rescues = results.map((r) => r.rescued);
const actionsArr = results.map((r) => r.actions);
const median = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
const rescueDist = {};
for (const r of rescues) rescueDist[r] = (rescueDist[r] || 0) + 1;
const depthDist = {};
for (const d of depths) { const bucket = d >= 15 ? "15(最下層)" : (d >= 10 ? "10-14" : (d >= 5 ? "5-9" : "0-4")); depthDist[bucket] = (depthDist[bucket] || 0) + 1; }

console.log("\n== 面白さ代理レポート(gate 外・合否非関与) ==");
out("N ラン", results.length);
out("クリア(全5人+最下層+探索100%)", { cleared, rate: Math.round((cleared / results.length) * 100) + "%" });
out("到達深度 分布", depthDist);
out("到達深度 中央値/最大", { median: median(depths), max: Math.max(...depths) });
out("救出人数 分布(人数:ラン数)", rescueDist);
out("救出人数 中央値", median(rescues));
out("1 ラン行動数 中央値/最大", { median: median(actionsArr), max: Math.max(...actionsArr) });
out("撤退回数 中央値(地表全回復の発生)", median(results.map((r) => r.retreats)));
out("キノコ採取 中央値(商人経済の供給)", median(results.map((r) => r.mushrooms)));
out("決定論ばらつき(救出のユニーク値数=ばらつき有無)", new Set(rescues).size);
console.log("\n注: 固定 seed の決定論ゲーム + クリア=探索100%フルコンプのため、標準のクリア率帯(15-40%)は");
console.log("    そのまま当てはまらない。本値は『貪欲生存 bot の手応え相関』であって面白さの保証ではない。");
