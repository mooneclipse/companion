// 面白さ代理レポート(gate 外、lead のバランス判断材料)。v0.3.0 はクリア条件が
// 「5人全員救出 + 最下層(15)到達 + 探索率 100%」に変わった(1人=即クリア廃止)。
// 固定 seed=41027 の決定論盤面なので RNG 揺らぎは無い。代わりに「行動予算(撤退ループの
// 上限ダイブ数)」と policy を振って、最適行動でどれくらいクリアできるか・何手かかるか・
// 支配戦略の有無・到達分布を測る。これは面白さの相関指標(合否には含めない)。
//
// bot は内部 act/move を方向決めで叩く高速自走。各 policy で「掘り進め方」「撤退判断」を変える。
//
// v0.5.0(モンスター増分): 死の緊張を測る主指標 = 力尽き率。bot を戦闘対応に更新
//  (進路を塞ぐモンスターは bump-to-attack で交戦)。policy 別に「無策/深追いは敵で死にうる /
//  慎重撤退は生き延びる」を出す。数値の単独いじりでなく敵コンテンツで死の緊張を出せたかの裏取り。
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
    // careful = 危険な殴り合いを途中で見切って撤退する(慎重プレイ)。reckless は false(無策)。
    const careful = policy !== "reckless";
    let bailFight = false; // careful 時、撃破できそうにない戦闘を見切ったフラグ(caller が撤退)。

    // モンスターが (col,row) に居るか(出現中リスト走査、内部 monsterAt 相当)。
    function foeAt(c, r) { return G.monsters && G.monsters.some((m) => m.col === c && m.row === r); }
    function foeObjAt(c, r) { return (G.monsters || []).find((m) => m.col === c && m.row === r); }
    // 進路 (dc,dr) を解決して 1 マス前進(or 交戦)する。掘り抜いた瞬間の埋没スポーンで進路が
    // 塞がれたら撃破してから前進し直す(=死の緊張: 撃破できず死ぬこともある)。進めなくなったら
    // (硬岩 or 撃破不能 or 画面遷移 or careful 見切り)終了。前進した/画面遷移したら true。
    function stepOnce(dc, dr) {
      const c0 = G.px, r0 = G.py;
      let g = 0;
      while (G.screen === "dive" && g < 60) {
        g++;
        const tc = G.px + dc, tr = G.py + dr;
        // 進路にモンスターが居れば bump-attack(撃破するか自機が死ぬまで)。
        const foe = foeObjAt(tc, tr);
        if (foe) {
          // careful: 今の体力で撃破まで持ちこたえられそうになければ戦わず見切る(撤退判断)。
          // 必要打撃数 = ceil(foeHP / 自機ATK)。その間の想定被弾(STR-DEF)× 概算で HP を超えるなら退く。
          if (careful) {
            const atk = Math.max(1, CONST.ATK_BASE + PICK[G.pick].power - (MONSTER[foe.key].def || 0));
            const hits = Math.ceil(foe.hp / atk);
            const inc = Math.max(1, (MONSTER[foe.key].str || 1) - (CONST.DEF_BASE + Math.floor((PICK[G.pick].power - 1) / 2)));
            const expDmg = hits * inc; // 隣接応酬は毎ターン=概算上限。
            if (expDmg >= G.stamina + G.hp - 2) { bailFight = true; break; }
          }
          act(dc, dr); steps++; continue;
        }
        // モンスターが居なければ移動 or 掘り。掘り抜きで埋没スポーンが起きると前進せず留まる
        // → 次ループで上の attack 分岐に入り、撃破後に前進(これで「掘ったら敵が出て止まる」緊張)。
        const pc = G.px, pr = G.py;
        act(dc, dr); steps++;
        if (G.px !== pc || G.py !== pr) break; // 前進した。
        // 前進せず・進路に新たな敵も居ない = 硬岩等で詰まり。
        if (!foeAt(G.px + dc, G.py + dr)) break;
      }
      return G.px !== c0 || G.py !== r0 || G.screen !== "dive";
    }
    function digDownOnce() { return stepOnce(0, 1); }
    function climbUpOnce() { const py0 = G.py; stepOnce(0, -1); return G.py !== py0; }
    function moveCol(c) { let g = 0; while (G.px !== c && g < 40 && G.screen === "dive") { stepOnce(G.px < c ? 1 : -1, 0); g++; } }
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
      let bails = 0; // 同じ列で危険戦闘を続けて見切った回数(進めない=その列を諦める)。
      while (G.py < target && G.screen === "dive" && steps < MAX && g < 80) {
        bailFight = false;
        const depthBefore = G.py;
        const ok = digDownOnce();
        // 危険な戦闘を見切った or スタミナ+体力が細った → 撤退して全回復(撤退ループの肝)。
        if (bailFight || (G.stamina <= 0 && G.hp <= 8)) {
          retreat(); if (G.screen !== "dive") return;
          moveCol(col);
          if (G.py >= target) break;
          // 撤退で深度が進まないなら列が手詰まり(撃破不能の敵が塞ぐ)。2 回で諦める。
          if (G.py <= depthBefore) { bails++; if (bails >= 2) break; }
          continue;
        }
        if (!ok) break; // ROCK 等で詰まり。
        g++;
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
      // 無策(撤退も回復も一切せず、全列を掘り進み塞ぐ敵に突っ込み続ける)。死の緊張の確認。
      // careful=false なので stepOnce は危険戦闘を見切らず必ず殴り合う。全列を上から下へ掘り
      // 抜く過程で空間/埋没モンスターと累積戦闘 → 回復しないので二段ゲージが累積で削られ力尽きうる。
      for (let c = 0; c < CONST.GRID_COLS && G.screen === "dive" && steps < MAX; c++) {
        moveCol(c);
        let g = 0;
        while (G.py < CONST.DEPTH_ROWS && G.screen === "dive" && g < 80 && steps < MAX) {
          const py0 = G.py;
          if (!digDownOnce()) break; // 硬岩等で詰まり → 次の列へ(撤退も回復もしない)。
          if (G.py === py0) break;
          g++;
        }
        // 撤退しない: 縦坑を登らず、次の列へ地中を横移動で渡る(掘った道経由)。戻れる時だけ上へ。
        if (G.screen === "dive") {
          // 浅い段まで地中を登って次列へ(地表には戻らない=全回復しない)。
          let up = 0;
          while (G.py > 1 && G.screen === "dive" && up < 6) { if (!climbUpOnce()) break; up++; }
        }
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

console.log("== 面白さ代理レポート v0.5.0(固定 seed=41027 決定論・policy 4種×5・モンスター戦闘あり) ==");
console.log("   クリア条件 = 5人救出 + 最下層(15)到達 + 探索率 100% / 主指標 = 力尽き率(死の緊張)");
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
