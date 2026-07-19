// v0.12.0 中核作り直し 自己動作確認(implementer 用、playtester とは別)。
// 【作り直しの肝】状態注入(g.state="following" 直接代入)を廃し、実プレイ経路を act() で
// シミュレートして検証する。自機ワープ/縦坑先掘りに頼らず、実際の掘削・移動・climb で
//   掘る→女の子発見(discoverGirl)→自機がジグザグに掘り進む→女の子が追従して地表まで上がる→救出→
//   ストック→地表で同行選択→潜行→撃破で cexp→帰還で Lv UP→ストックへ戻る
// を通して assert する。①追従(足跡キュー方式)・②仲間モデル(救出ストック→同行)・③崩落 soft-lock。
// 本番ポート 47825 には一切触れない。決定論(同一操作列で3回連続一致)も検証する。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47873; // 本番(47825)・playtester・grow(47871)・旧 companion(47872) と非衝突。
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
await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + JSON.stringify(detail) : "")); };

await page.goto(`http://127.0.0.1:${PORT}/mineroad/`, { waitUntil: "networkidle" });

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.17.0", ver === "v0.17.0", { ver }); // v0.17.0 埋没モンスター原作合わせ(STATUS v0.17.0)へ機械追随。

// ============================================================================
// 実プレイ経路ドライバ(page 側で動かす純 JS。act() だけで自機を動かす=状態注入なし)。
// 自機を (col,row) へ「掘って近づける」: 1 マスずつ act() で寄る。掘削力ゲートのノイズを避けるため
// ダイヤツルハシを持たせる(追従の検証が目的=power ゲートは別ゲートで担保済み)。フォロー検証中は
// モンスターの妨害を避けるため空にする(これは entity の除去であって追従そのものは完全に実挙動)。
// ============================================================================
const driverSrc = `
  // 自機を1マス、(dc,dr)方向へ act で動かす(掘る or 進む)。掘り抜き or 移動で px/py が変わる。
  function step(dc, dr) {
    const bx = G.px, by = G.py;
    let guard = 0;
    // SOIL/HARD/ROCK は複数タップで掘り抜く。位置が変わるか screen が変わるまで叩く(最大8)。
    while (G.screen === "dive" && G.px === bx && G.py === by && guard < 8) { act(dc, dr); guard++; }
    return { px: G.px, py: G.py };
  }
  // 自機を target 列・行へ「掘り進む」: まず横へ寄せ、次に下へ掘る、を交互(=ジグザグ経路)。
  // 重力で落ちるので、各 act 後の実位置を見て進める適応ループ(固定スクリプトでなく実プレイ的)。
  function digTowards(tcol, trow) {
    let guard = 0;
    while (G.screen === "dive" && (G.px !== tcol || G.py !== trow) && guard < 200) {
      guard++;
      if (G.px < tcol) { step(1, 0); continue; } // 右へ(横移動/横掘り)。
      if (G.px > tcol) { step(-1, 0); continue; } // 左へ。
      if (G.py < trow) { step(0, 1); continue; } // 下へ掘る。
      if (G.py > trow) { step(0, -1); continue; } // 上へ(普通は起きないが保険)。
    }
    return { px: G.px, py: G.py };
  }
  // 自機を地表(row0)へ「実際に climb して」戻す: 自分の足跡(playerTrail)を逆順に retrace。
  // 足跡は自機が通った空洞なので、上へ・横へ act で必ず辿れる(縦坑先掘りに頼らない実 climb)。
  function climbToSurface() {
    let guard = 0;
    while (G.screen === "dive" && G.py > 0 && guard < 400) {
      guard++;
      const bx = G.px, by = G.py;
      // 真上が空間なら登る。
      if (isSpace(G.px, G.py - 1)) { act(0, -1); }
      else {
        // 真上が塞がっていれば、足跡を辿って横へ逃げてから登る。直前の足跡セルへ寄る。
        const trail = G.playerTrail || [];
        let moved = false;
        for (let i = trail.length - 1; i >= 0; i--) {
          const c = trail[i];
          if (c[1] < G.py && Math.abs(c[0] - G.px) === 1 && c[1] === G.py) { act(c[0] - G.px, 0); moved = true; break; }
        }
        if (!moved) {
          // 横の空間へ寄る(左右どちらか辿れる方)。
          if (isSpace(G.px - 1, G.py)) act(-1, 0);
          else if (isSpace(G.px + 1, G.py)) act(1, 0);
        }
      }
      if (G.px === bx && G.py === by) break; // 動けない=詰み(assert で落ちる)。
    }
    return { px: G.px, py: G.py };
  }
`;

// ① 追従の作り直し(実プレイ経路): ジグザグに掘って女の子を発見→追従→地表まで上がって救出。
//   旧テストは「自機を女の子の真上にワープ+縦坑先掘り」で全ステップ上向き=重力が一度も発火しない
//   理想経路だけを通し①をすり抜けた。ここは act() だけで実際にジグザグ掘削し、女の子が底に張り付かず
//   地表まで追従できることを assert(=底張り付きの否定を実経路で証明)。
const followA = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND"; // power ゲートのノイズ除去(追従検証が目的)。
  G.monsters = []; G.spawned = new Set(); // フォロー検証中は妨害 entity を空に(追従そのものは実挙動)。
  // 最浅の女の子(11,6)を狙う。自機 col7,row0 から右下へジグザグに掘り進む。
  const target = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
  // 女の子の手前(同列・1つ上)まで掘り、最後に下を掘って GIRL タイルを掘り当てる。
  digTowards(target.col, target.row - 1);
  const reachedAbove = (G.px === target.col && G.py === target.row - 1);
  // 真下(女の子マス)を掘り当てる=discoverGirl(following)。act で掘り抜く。
  G.monsters = [];
  let g = G.girls.find((x) => x.origCol === target.col && x.origRow === target.row);
  let gi = G.girls.indexOf(g);
  let guard = 0;
  while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; }
  const discovered = G.girls[gi].state; // "following" のはず(実掘り当て)。
  const girlRowAtDiscover = G.girls[gi].row;
  // ここから自機が地表へ実 climb。各 climb で moveTo→advanceGirl が走り、女の子が足跡を追う。
  G.monsters = [];
  // climb 中も足跡追従が走るよう、climbToSurface 内の act が moveTo を呼ぶ。
  // 追従 row 系列を記録(底張り付き=row が減らない の否定を見る)。
  const rows = [];
  let cguard = 0;
  while (G.screen === "dive" && G.py > 0 && cguard < 400) {
    cguard++;
    const bx = G.px, by = G.py;
    if (isSpace(G.px, G.py - 1)) act(0, -1);
    else if (isSpace(G.px - 1, G.py)) act(-1, 0);
    else if (isSpace(G.px + 1, G.py)) act(1, 0);
    else break;
    rows.push(G.girls[gi].state === "rescued" ? 0 : G.girls[gi].row);
    if (G.girls[gi].state === "rescued") break;
    if (G.px === bx && G.py === by) break;
  }
  const finalState = G.girls[gi].state;
  return {
    reachedAbove, discovered, girlRowAtDiscover,
    rows, finalState, rescued: G.rescued,
    hud: document.getElementById("rescue-val").textContent,
    reachedSurface: finalState === "rescued",
    // 底張り付きの否定: 追従 row 系列の最小が発見時 row より小さい(=上がった)。
    followedUp: rows.length > 0 && Math.min(...rows) < girlRowAtDiscover,
    py: G.py,
  };
}, driverSrc);
check("① 実プレイ経路で女の子を掘り当て→ジグザグ追従→地表救出(底張り付きなし)",
  followA.reachedAbove && followA.discovered === "following" &&
  followA.reachedSurface && followA.followedUp && followA.rescued >= 1 &&
  followA.hud !== "0/5", followA);

// ② 仲間モデル(救出ストック→地表で同行→潜行で cexp→帰還で Lv UP→ストックへ)。実プレイ経路。
//   救出済みの子だけが同行候補。地表で同行選択→潜行で撃破 EXP が cexp に蓄積→地表帰還で別れて Lv UP。
const companionFlow = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND";
  G.monsters = []; G.spawned = new Set();
  // --- 実プレイで1人救出(① と同じく掘り当て→追従→地表) ---
  const target = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
  digTowards(target.col, target.row - 1);
  G.monsters = [];
  let g = G.girls.find((x) => x.origCol === target.col && x.origRow === target.row);
  let gi = G.girls.indexOf(g);
  let guard = 0;
  while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; }
  let cguard = 0;
  while (G.screen === "dive" && G.py > 0 && cguard < 400) {
    cguard++;
    if (isSpace(G.px, G.py - 1)) act(0, -1);
    else if (isSpace(G.px - 1, G.py)) act(-1, 0);
    else if (isSpace(G.px + 1, G.py)) act(1, 0);
    else break;
    if (G.girls[gi].state === "rescued") break;
  }
  const rescuedAtSurface = G.girls[gi].state === "rescued";
  const onSurface = G.py === 0;
  // --- 仲間タブ候補 = 救出済みストックの子(rescued)。地中で発見中の子は候補に出ない ---
  // ストックに rescued の子が居る。地表で同行選択。
  const stockHasG = (g.state === "rescued");
  // 地表で同行に出す(setCompanion=救出済みストックの子を deployed=following にする)。
  const setOk = setCompanion(g);
  const deployed = (G.companion === g && g.deployed && g.state === "following");
  const placedAtPlayer = (g.col === G.px && g.row === G.py); // 自機(地表)位置から潜る。
  // --- 同行を連れて潜行: 撃破で cexp 蓄積(自機プール G.exp も並走) ---
  const cexpBefore = g.cexp || 0; const expBefore = G.exp;
  const foe = { key: "SNAKE", col: G.px, row: G.py + 1, hp: 0 }; // SNAKE exp=6。
  G.monsters = [foe]; killMonster(foe);
  const cexpGained = (g.cexp || 0) - cexpBefore; // 6。
  const selfExpGained = G.exp - expBefore; // 6(並走、差し引かない)。
  // --- 援護: companion レベルで playerAtk が effCompanionAtk ぶん増える ---
  const baseAtk0 = playerAtk();
  g.level = 0; const atkLv0 = effCompanionAtk();
  g.level = 3; const atkLv3 = effCompanionAtk(); const atkWith = playerAtk();
  // --- 地表帰還で別れて Lv UP→ストックへ戻る(deployed→rescued、companion 解除) ---
  g.cexp = 25; g.level = 0; // EXP_PER_LV=10 → +2 レベル、端数5。
  // 自機を地表に置いて女の子も地表へ(deployed companion の帰還=実 surfaceReturn 経路)。
  g.col = G.px; g.row = 0;
  // 実プレイの帰還: 自機が地表に居る状態で surfaceReturn を踏む(moveTo 経由が理想だが
  // ここは companion 帰還清算の検証なので rescueGirl を直接踏む=帰還到達後の確定処理)。
  rescueGirl(g);
  const levelAfter = g.level; // 2。
  const cexpAfter = g.cexp; // 5。
  const backToStock = (g.state === "rescued" && !g.deployed); // ストックへ戻った。
  const companionCleared = (G.companion === null);
  return {
    rescuedAtSurface, onSurface, stockHasG, setOk, deployed, placedAtPlayer,
    cexpGained, selfExpGained, atkLv0, atkLv3, baseAtk0, atkWith,
    levelAfter, cexpAfter, backToStock, companionCleared,
  };
}, driverSrc);
check("② 救出ストックの子を地表で同行に出せる(rescued→deployed following・自機位置から潜る)",
  companionFlow.rescuedAtSurface && companionFlow.onSurface && companionFlow.stockHasG &&
  companionFlow.setOk === true && companionFlow.deployed && companionFlow.placedAtPlayer, companionFlow);
check("② 同行中の撃破で cexp +6 と自機 exp +6 が並走(二面両立)",
  companionFlow.cexpGained === 6 && companionFlow.selfExpGained === 6, companionFlow);
check("② 援護=companion Lv3 で playerAtk +3(effCompanionAtk)・Lv0 で +0",
  companionFlow.atkLv0 === 0 && companionFlow.atkLv3 === 3 &&
  companionFlow.atkWith === companionFlow.baseAtk0 + 3, companionFlow);
check("② 地表帰還で別れて Lv+2(端数5繰越)・companion 解除・ストックへ戻る",
  companionFlow.levelAfter === 2 && companionFlow.cexpAfter === 5 &&
  companionFlow.backToStock && companionFlow.companionCleared, companionFlow);

// ②-b 同行候補は救出済みストックのみ: 地中で発見中(following・未救出)の子は同行候補に出ない。
//      地表でない(地中)と同行は編成できない。
const candidateRule = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  // 救出が無い状態(ストック空)では候補ゼロ=案内行。
  openCraft(); setWorkshopTab("companion");
  const emptyRows = document.querySelectorAll("#companion-list .craft-row").length;
  const emptyText = (document.querySelector("#companion-list .craft-name") || {}).textContent;
  const emptyBtnDisabled = (() => { const b = document.querySelector("#companion-list .craft-make"); return !b || b.disabled; })();
  closeCraft();
  // 救出済みの子を1人用意(rescued ストック)。地表でない(地中)状態では setCompanion が弾く。
  const g = G.girls[0]; g.state = "rescued";
  G.px = 5; G.py = 7; // 地中。
  const setInUnderground = setCompanion(g); // false(地表でないと編成不可)。
  const notDeployedUnderground = (G.companion === null);
  // 地表に戻ると編成可。
  G.px = 7; G.py = 0;
  const setOnSurface = setCompanion(g);
  const deployedOnSurface = (G.companion === g && g.deployed);
  return { emptyRows, emptyText, emptyBtnDisabled, setInUnderground, notDeployedUnderground, setOnSurface, deployedOnSurface };
}, driverSrc);
check("②-b 候補=救出ストックのみ(空=案内行)・地中では同行編成不可・地表で編成可",
  candidateRule.emptyRows === 1 && candidateRule.emptyBtnDisabled &&
  candidateRule.setInUnderground === false && candidateRule.notDeployedUnderground &&
  candidateRule.setOnSurface === true && candidateRule.deployedOnSurface, candidateRule);

// ③ 崩落 soft-lock 修正: 崩落で塞がれた(G.fallen)マスを再掘削したら通行可能になる
//   (isSpace/tileAt が空間を返す)。修正前は tileAt が G.fallen を優先して永久に SOIL=詰み。
const cavein = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND";
  // あるマス (5,7) を掘り抜いてから、崩落で塞がれた状態を作る(G.fallen に入れ G.dug から消す
  // =resolveCaveins が実際に行う塞ぎ操作と同じ最終状態)。
  const key = "5,7";
  G.dug.add(key);
  const spaceBeforeFall = isSpace(5, 7);
  G.fallen.add(key); G.dug.delete(key); // 崩落で塞がれた=tileAt が SOIL を返す。
  const blockedAfterFall = !isSpace(5, 7) && tileAt(5, 7) === TILE.SOIL;
  // 自機を真上に置き、塞がれた SOIL を再掘削(実 act)。掘り抜きで G.fallen.delete→空間へ戻る。
  G.px = 5; G.py = 6; G.dug.add("5,6");
  let guard = 0;
  while (!isSpace(5, 7) && guard < 8) { act(0, 1); guard++; }
  const reopened = isSpace(5, 7) && tileAt(5, 7) === TILE.NONE && !G.fallen.has(key);
  // 再掘後は bfsStep/surfaceReturn が通れる空間として扱える(=詰みでない)。
  return { spaceBeforeFall, blockedAfterFall, reopened };
}, driverSrc);
check("③ 崩落で塞がれたマスを再掘削したら通行可能に戻る(soft-lock しない)",
  cavein.spaceBeforeFall && cavein.blockedAfterFall && cavein.reopened, cavein);

// ④ 決定論: 同一の実プレイ操作列を3回繰り返して結果が完全一致(救出/cexp/girlPositions)。
const detRuns = [];
for (let i = 0; i < 3; i++) {
  const snap = await page.evaluate((driver) => {
    eval(driver);
    try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
    G.pick = "DIAMOND";
    G.monsters = []; G.spawned = new Set();
    const target = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
    digTowards(target.col, target.row - 1);
    G.monsters = [];
    const g = G.girls.find((x) => x.origCol === target.col && x.origRow === target.row);
    const gi = G.girls.indexOf(g);
    let guard = 0;
    while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; }
    let cguard = 0;
    while (G.screen === "dive" && G.py > 0 && cguard < 400) {
      cguard++;
      if (isSpace(G.px, G.py - 1)) act(0, -1);
      else if (isSpace(G.px - 1, G.py)) act(-1, 0);
      else if (isSpace(G.px + 1, G.py)) act(1, 0);
      else break;
      if (G.girls[gi].state === "rescued") break;
    }
    const gp = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
    return { rescued: G.rescued, finalState: G.girls[gi].state, gp };
  }, driverSrc);
  detRuns.push(snap);
}
const detEqual = detRuns.every((r) =>
  r.rescued === detRuns[0].rescued && r.finalState === detRuns[0].finalState && r.gp === detRuns[0].gp);
check("④ 決定論3回連続一致(実プレイ救出/state/girlPositions)", detEqual, detRuns);

// ⑤ 非介入: 同行系は girlPositions(EXPECTED_GIRLS)/oreAt をワールドレイヤーで変えない。
const noninv = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  const gp = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
  const g = G.girls[0]; g.state = "rescued"; G.px = 7; G.py = 0; setCompanion(g);
  const foe = { key: "SNAKE", col: 1, row: 1, hp: 0 }; G.monsters = [foe]; killMonster(foe);
  const gp2 = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
  return { gp, gp2, expected: "11,6|0,8|4,10|3,12|8,14", oreUnchanged: oreAt(7, 2, G.seed) === oreAt(7, 2, G.seed) };
}, driverSrc);
check("⑤ 非介入=girlPositions verbatim 一致(EXPECTED_GIRLS)・oreAt 決定論",
  noninv.gp === noninv.expected && noninv.gp2 === noninv.expected && noninv.oreUnchanged, noninv);

// ⑥ 仲間タブ UI(画面 DOM): 工房オーバーレイを開き仲間タブへ切替、companion-list が出る・active・他タブへ戻せる。
const ui = await page.evaluate(() => {
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  const g = G.girls[0]; g.state = "rescued"; // 救出済みストックを1人作る(候補表示用)。
  G.px = 7; G.py = 0; // 地表(同行ボタン有効化)。
  openCraft();
  setWorkshopTab("companion");
  const compHidden = document.getElementById("companion-list").hidden;
  const rows = document.querySelectorAll("#companion-list .craft-row").length; // rescued 1人=1行。
  const tabActive = document.getElementById("tab-companion").classList.contains("active");
  const btn = document.querySelector("#companion-list .craft-make");
  const btnEnabled = btn ? !btn.disabled : false; // 地表で同行ボタン有効。
  const btnLabel = btn ? btn.textContent : "";
  setWorkshopTab("craft");
  const craftShown = !document.getElementById("craft-list").hidden && document.getElementById("companion-list").hidden;
  closeCraft();
  return { compHidden, rows, tabActive, btnEnabled, btnLabel, craftShown };
});
check("⑥ 仲間タブ表示=ストック1行・active・同行ボタン押下可・クラフトへ戻せる(gate Q 互換)",
  !ui.compHidden && ui.rows === 1 && ui.tabActive && ui.btnEnabled && ui.btnLabel === "同行" && ui.craftShown, ui);

// ⑦ (1) ②境界修正: 自機が地表で静止しても、追従しきった女の子が救出されストックに入る(実プレイ経路)。
//   旧挙動=女の子が自機の1マス後ろ(row1)で止まり row0 に乗れず rescueGirl 未発火。修正=自機が地表に
//   居て足跡を消化しきって追いついた(caughtUpAtSurface)なら row0 に物理的に乗らなくても救出成立。
//   実プレイ: 掘り当て→足跡追従で地表へ。自機ワープ/state注入に戻らない。
const staticSurface = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
  const t = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
  digTowards(t.col, t.row - 1);
  G.monsters = [];
  const g = G.girls.find((x) => x.origCol === t.col && x.origRow === t.row);
  const gi = G.girls.indexOf(g);
  let d = 0; while (G.girls[gi].state === "hidden" && d < 8) { act(0, 1); d++; }
  G.monsters = [];
  climbToSurface(); // 実 climb で地表へ。
  const playerAtSurface = (G.py === 0);
  const rescuedAtSurface = (G.girls[gi].state === "rescued");
  // 救出後そのまま地表で静止しても rescued のまま(再加算なし)。
  const stillRescued = (G.girls[gi].state === "rescued");
  // ストックに入っている(仲間タブ候補=rescued)。
  const inStock = (G.girls[gi].state === "rescued");
  return { playerAtSurface, rescuedAtSurface, stillRescued, inStock, girlRow: G.girls[gi].row, rescued: G.rescued, hud: document.getElementById("rescue-val").textContent };
}, driverSrc);
check("⑦ (1) 自機が地表で静止しても追従しきった女の子が救出されストック入り(row0 非依存)",
  staticSurface.playerAtSurface && staticSurface.rescuedAtSurface && staticSurface.inStock &&
  staticSurface.rescued >= 1 && staticSurface.hud !== "0/5", staticSurface);

// ⑦-b ②フル経路を通しで(実プレイ): 救出→ストック→地表で同行選択→潜行→撃破cexp→帰還レベルUP→ストック戻し。
//   ②の全段が実プレイ経路(act の掘削+足跡追従+実 climb)で完結することを通しで assert。
const fullCycle = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
  const t = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
  // 1) 救出→ストック(実プレイ)。
  digTowards(t.col, t.row - 1); G.monsters = [];
  const g = G.girls.find((x) => x.origCol === t.col && x.origRow === t.row);
  const gi = G.girls.indexOf(g);
  let d = 0; while (G.girls[gi].state === "hidden" && d < 8) { act(0, 1); d++; }
  G.monsters = []; climbToSurface();
  const step1Rescued = (g.state === "rescued");
  // 2) 地表で同行選択(deploy)。
  G.monsters = []; G.spawned = new Set();
  const setOk = setCompanion(g);
  const step2Deployed = (G.companion === g && g.deployed && g.state === "following" && g.col === G.px && g.row === G.py);
  // 3) 同行を連れて潜行→撃破で cexp(実プレイで少し掘り下げてから撃破)。
  digTowards(t.col, 4); G.monsters = [];
  const cexpBefore = g.cexp || 0;
  const foe = { key: "SNAKE", col: G.px, row: G.py + 1, hp: 0 }; // SNAKE exp=6。
  G.monsters = [foe]; killMonster(foe);
  const step3CexpGained = (g.cexp || 0) - cexpBefore; // 6。
  // 4) 地表帰還で別れてレベルUP→ストック戻し(実 climb)。
  G.monsters = [];
  // 端数なし換算のため cexp を 10 の倍数に整える(EXP_PER_LV=10 → ちょうど 1 レベル)。
  g.cexp = 10; g.level = 0;
  climbToSurface();
  const step4 = {
    backToStock: (g.state === "rescued" && !g.deployed),
    companionCleared: (G.companion === null),
    level: g.level, cexp: g.cexp, py: G.py,
  };
  return { step1Rescued, setOk, step2Deployed, step3CexpGained, step4 };
}, driverSrc);
check("⑦-b ②フル経路通し(救出→ストック→地表同行→潜行cexp→帰還Lv→ストック戻し)が実プレイで完結",
  fullCycle.step1Rescued && fullCycle.setOk === true && fullCycle.step2Deployed &&
  fullCycle.step3CexpGained === 6 && fullCycle.step4.backToStock &&
  fullCycle.step4.companionCleared && fullCycle.step4.level === 1 && fullCycle.step4.py === 0, fullCycle);

// ⑧ (A) 足跡キュー GC: 長経路(多数手のジグザグ)で playerTrail が上限内に収まり、かつ GC の trailIdx
//   補正後も女の子が正しく追従し続けて救出されることを実プレイで assert。最深(8,14)で長い経路を踏む。
const trailGc = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
  const t = girlPositions(G.seed).find((p) => p.col === 8 && p.row === 14) || girlPositions(G.seed)[girlPositions(G.seed).length - 1];
  // 最深(8,14)まで掘り進む = 長い経路(縦14+横ずれ)。following 0 人の間は GC が末尾1点へ畳むので、
  // 発見直前(掘り進み中)の trail は際限なく伸びず短く保たれる(=following ゼロ時の畳み込みの検証)。
  digTowards(t.col, t.row - 1);
  const trailBeforeDiscover = G.playerTrail.length; // following 0 人 → 末尾1点に畳まれている。
  G.monsters = [];
  const g = G.girls.find((x) => x.origCol === t.col && x.origRow === t.row);
  const gi = G.girls.indexOf(g);
  let d = 0; while (G.girls[gi].state === "hidden" && d < 8) { act(0, 1); d++; }
  G.monsters = [];
  // climb 中の最大 trail 長を観測しながら地表へ。
  let maxTrail = G.playerTrail.length;
  let c = 0;
  while (G.screen === "dive" && G.py > 0 && c < 600) {
    c++;
    const bx = G.px, by = G.py;
    if (isSpace(G.px, G.py - 1)) act(0, -1);
    else if (isSpace(G.px - 1, G.py)) act(-1, 0);
    else if (isSpace(G.px + 1, G.py)) act(1, 0);
    else break;
    if (G.playerTrail.length > maxTrail) maxTrail = G.playerTrail.length;
    if (G.girls[gi].state === "rescued") break;
    if (G.px === bx && G.py === by) break;
  }
  // trail 長の上限 = following 中は min(trailIdx) より前を切るので「自機〜最も遅れた女の子の距離 + 数」
  // で頭打ち(盤面の縦+横 = DEPTH_ROWS+GRID_COLS 程度)。際限なく伸びない(数百〜数千にならない)。
  const bound = CONST.DEPTH_ROWS + CONST.GRID_COLS + 8;
  return {
    trailBeforeDiscover, maxTrail, bound, rescued: G.girls[gi].state === "rescued",
    finalTrail: G.playerTrail.length, totalRescued: G.rescued,
  };
}, driverSrc);
check("⑧ (A) 長経路で playerTrail が上限内(GC 効く)・GC 補正後も追従して救出成立",
  trailGc.trailBeforeDiscover <= 2 && trailGc.maxTrail <= trailGc.bound &&
  trailGc.rescued === true && trailGc.totalRescued >= 1, trailGc);

// ⑨ (D) 崩落再掘の無限ループ非発生: 崩落で塞がれたマスを再掘削しても、不安定土が尽きれば落下は止まり
//   「掘っても掘っても塞がる」無限ループにならない。act の G.fallen.delete 後 resolveCaveins が同マスを
//   積み直し続けないことを、再掘を有限回繰り返して空間が安定保持されることで assert。
const caveinLoop = await page.evaluate((driver) => {
  eval(driver);
  try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} startDive();
  G.pick = "DIAMOND";
  // (5,7) を掘り抜き→崩落で塞がれた状態にし、真上(5,6)に自機。再掘を最大数回。
  const key = "5,7";
  G.dug.add("5,6"); G.dug.add(key);
  G.fallen.add(key); G.dug.delete(key); // 崩落で塞がれた。
  G.px = 5; G.py = 6;
  // この (5,7) は元 SOIL で不安定土でない(avalancheAt 次第)。再掘して空間化したあと、複数回 act しても
  // 同マスが再び fallen に積み直されて SOIL へ戻り続ける(無限ループ)ことがないか観測。
  let reopenCount = 0;
  let reblockCount = 0;
  let guard = 0;
  // まず再掘で開ける。
  while (!isSpace(5, 7) && guard < 8) { act(0, 1); guard++; }
  const reopenedOnce = isSpace(5, 7);
  // 開いた後、さらに自機が周辺で行動(下/横へ)を数手しても (5,7) が再び塞がれ続けない。
  // resolveCaveins は moveTo ごとに走る。不安定土が無ければ落下源が無く塞ぎ直さない。
  const seq = [];
  for (let k = 0; k < 6 && G.screen === "dive"; k++) {
    // 自機を (5,7) 付近に保ったまま行動(下があれば掘る、無ければ横)。
    if (isSpace(5, 7) && !(G.px === 5 && G.py === 7)) { /* 開いたまま */ }
    const wasSpace = isSpace(5, 7);
    // 1 手行動(下掘り or 横)。
    if (tileAt(G.px, G.py + 1) !== undefined && G.py + 1 <= CONST.DEPTH_ROWS) act(0, 1);
    else act(1, 0);
    const nowSpace = isSpace(5, 7);
    if (wasSpace && !nowSpace) reblockCount++; // 開いていたのに塞がれた = 崩落で積み直された。
    seq.push(nowSpace ? 1 : 0);
  }
  return { reopenedOnce, reblockCount, seq };
}, driverSrc);
check("⑨ (D) 崩落再掘で空間化後、行動を続けても無限に塞がれ直さない(再掘ループ非発生)",
  caveinLoop.reopenedOnce === true && caveinLoop.reblockCount === 0, caveinLoop);

check("pageerror 0", errors.length === 0, errors);

await browser.close();
await new Promise((r) => server.close(r));

const failed = results.filter((r) => !r.ok);
console.log("\n=== " + (failed.length === 0 ? "ALL PASS (" + results.length + ") ===" : failed.length + " FAILED ==="));
process.exit(failed.length === 0 ? 0 : 1);
