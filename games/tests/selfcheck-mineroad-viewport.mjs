// v0.20.0 ビューポート/5等分ゾーン入力/クライム廃止 自己動作確認(implementer 用、playtester とは別)。
// STATUS v0.20.0 判断 A〜C を実装関数・画面座標タップの両面で確認する:
//  a. VIEW_COLS = min(17, GRID_COLS) と tile = W / VIEW_COLS(裏庭 15 列は全幅のまま、
//     広域ダンジョン「孤独な山」dungeonId=6・80 列は 17 列窓が開く)。
//  b. camXTarget(px) の clamp(左端 0・右端 GRID_COLS-VIEW_COLS・中央は自機センター)。
//  c. 画面 5 等分ゾーン→(dx,dy) 対応表(25 ゾーン網羅、中央ゾーンのみ無反応)。
//  d. 真上移動は足場/はしごが無ければ moveTo 内の applyGravity で即座に落ち戻る(クライム不能)。
//  e. はしごマス(placedLadders)では重力が働かず落下しない(着はしご含む)。
// シナリオ構築は G.dug/G.placedLadders/G.px/G.py へのランタイム state 注入 + act() 直叩きで行い、
// tileType/girlPositions/DUNGEON_DATA 等の世界生成レイヤーには一切触れない。
// 本番ポート 47825 には一切触れない。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47881; // 本番(47825)・playtester(47860)・funproxy(47867)・selfcheck 群(47871..47880) と非衝突。
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

const VW = 412, VH = 915;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, serviceWorkers: "block" });
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
// (a) VIEW_COLS = min(17, GRID_COLS) と tile 計算。裏庭(15列)は全幅のまま、広域(80列)は17列窓。
// ============================================================================
console.log("\n== (a) VIEW_COLS / tile ==");

const viewSmall = await page.evaluate(() => {
  startDive(); // dungeonId 既定 0 = 裏庭(15列)。
  return { gridCols: CONST.GRID_COLS, viewCols: VIEW_COLS, tile, W };
});
check("a1 裏庭(15列): VIEW_COLS=min(17,15)=15(全幅のまま)", viewSmall.viewCols === 15 && viewSmall.gridCols === 15, viewSmall);
check("a2 裏庭: tile = W/VIEW_COLS", Math.abs(viewSmall.tile - viewSmall.W / viewSmall.viewCols) < 0.01, viewSmall);

const viewLarge = await page.evaluate(() => {
  G.dungeonId = 6; // 「孤独な山」80x80(広域)。
  startDive();
  return { gridCols: CONST.GRID_COLS, viewCols: VIEW_COLS, tile, W };
});
check("a3 広域(80列, id=6): VIEW_COLS=min(17,80)=17(窓が開く)", viewLarge.viewCols === 17 && viewLarge.gridCols === 80, viewLarge);
check("a4 広域: tile = W/17(全幅表示の裏庭より小さくならない=窓の分だけ大きい)", Math.abs(viewLarge.tile - viewLarge.W / 17) < 0.01, viewLarge);
check("a5 広域は裏庭より tile が小さい(17列窓 > 裏庭15列全幅、W同一なら列数が多いほど1マスは小さい)", viewLarge.tile < viewSmall.tile, { small: viewSmall.tile, large: viewLarge.tile });

// ============================================================================
// (b) camXTarget(px) の clamp。左端 0・右端 GRID_COLS-VIEW_COLS・中央は自機センター。
// ============================================================================
console.log("\n== (b) camXTarget clamp ==");

const camXChecks = await page.evaluate(() => {
  G.dungeonId = 6;
  startDive(); // GRID_COLS=80, VIEW_COLS=17, maxCamX=63。
  return {
    left: camXTarget(0), // 左端: 0 - 17/2 = 負 → clamp 0。
    left2: camXTarget(3), // 依然として左端寄り(3-8.5<0) → clamp 0。
    center: camXTarget(40), // 中央: 40 - 8.5 = 31.5(自機センター、clamp 内)。
    right: camXTarget(79), // 右端: 79-8.5=70.5 > maxCamX(63) → clamp 63。
    right2: camXTarget(76), // 依然として右端寄り(76-8.5=67.5>63) → clamp 63。
    maxCamX: CONST.GRID_COLS - VIEW_COLS,
  };
});
check("b1 左端 clamp(px=0 → camX=0)", camXChecks.left === 0, camXChecks);
check("b2 左端寄り clamp(px=3 → camX=0)", camXChecks.left2 === 0, camXChecks);
check("b3 中央は自機センター(px=40 → camX=40-17/2=31.5)", Math.abs(camXChecks.center - 31.5) < 0.001, camXChecks);
check("b4 右端 clamp(px=79 → camX=maxCamX=63)", camXChecks.right === camXChecks.maxCamX && camXChecks.maxCamX === 63, camXChecks);
check("b5 右端寄り clamp(px=76 → camX=63)", camXChecks.right2 === 63, camXChecks);

const camXSmall = await page.evaluate(() => {
  G.dungeonId = 0; // 直前の camXChecks で id=6 のままなので裏庭へ明示的に戻す。
  startDive(); // 裏庭(15列): GRID_COLS<=VIEW_COLS なので常に 0。
  return { center: camXTarget(7), left: camXTarget(0), right: camXTarget(14), maxCamX: Math.max(0, CONST.GRID_COLS - VIEW_COLS) };
});
check("b6 裏庭(GRID_COLS<=VIEW_COLS)は常に camX=0(全幅表示・既存互換)",
  camXSmall.center === 0 && camXSmall.left === 0 && camXSmall.right === 0 && camXSmall.maxCamX === 0, camXSmall);

// ============================================================================
// (c) 画面 5 等分ゾーン → (dx,dy) 対応表(25 ゾーン網羅、中央ゾーンのみ無反応)。
//     act() をモンキーパッチして呼び出し引数を記録し、画面座標タップで実際に発火するか見る。
//     自機は隣接 8 マス判定に絶対に引っかからない盤面中央深部へ固定する(優先判定との混線防止)。
// ============================================================================
console.log("\n== (c) 5等分ゾーン → (dx,dy) 対応表 ==");

await page.evaluate(() => {
  G.dungeonId = 6;
  startDive();
  G.px = 40; G.py = 40; G.monsters = []; // 隣接 8 マス圏外を確実に踏むための深部中央固定。
  camY = 40; camX = camXTarget(40); // カメラを自機中心へ即時合わせる(lerp 待ちなし)。
  window.__zoneCalls = [];
  window.__origAct = window.act; // 復元用に退避(このテストのみ内でモンキーパッチする)。
  window.act = (dc, dr) => { window.__zoneCalls.push([dc, dr]); return window.__origAct(dc, dr); };
});

const zoneResults = [];
for (let zr = 0; zr < 5; zr++) {
  for (let zc = 0; zc < 5; zc++) {
    const x = (zc + 0.5) * (VW / 5);
    const y = (zr + 0.5) * (VH / 5);
    // 前のタップで実際に移動/掘削が起きて自機位置がずれると、後続タップが偶然「隣接8マス判定」
    // に巻き込まれ act 呼び出しが化ける(実測で確認済み=旧実装ミス)。毎回クリーンな盤面へ startDive
    // し直してから自機を深部中央へ固定する(25 ゾーンを独立条件で検証)。
    await page.evaluate(() => {
      startDive();
      G.px = 40; G.py = 40; G.monsters = [];
      camY = 40; camX = camXTarget(40);
      window.__zoneCalls.length = 0;
    });
    await page.waitForTimeout(30); // HUD 帯の実測(hudBandMeasured)確定を待つ(startDive 直後は未確定)。
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(15);
    const calls = await page.evaluate(() => window.__zoneCalls.slice());
    const expDc = Math.sign(zc - 2), expDr = Math.sign(zr - 2);
    zoneResults.push({ zc, zr, expDc, expDr, calls });
  }
}
// 中央ゾーン(zc=2,zr=2)は無反応(act 呼び出しなし)。
const centerZone = zoneResults.find((z) => z.zc === 2 && z.zr === 2);
check("c1 中央ゾーン(自マス相当)タップは無反応(act 呼び出しなし)", centerZone.calls.length === 0, centerZone);
// 既知の HUD 重複ゾーン(#btn-ladder / #btn-surface、pointer-events:auto の HUD ボタンが画面上その
// 位置で canvas より前面にある)は 5 等分ゾーン判定にそもそも到達しない。これは実機の正しい挙動
// (D-pad と同じ「補助 UI が最前面」の設計、STATUS v0.20.0 判断B 「4方向ボタンUIは補助として温存」
// と同根)なので、無反応(calls:[])を正として別扱いする。
const HUD_OVERLAP_ZONES = new Set(["3,0", "2,4"]); // 実測(elementFromPoint)で確認済み。
const nonCenter = zoneResults.filter((z) => !(z.zc === 2 && z.zr === 2));
const canvasZones = nonCenter.filter((z) => !HUD_OVERLAP_ZONES.has(`${z.zc},${z.zr}`));
const hudZones = nonCenter.filter((z) => HUD_OVERLAP_ZONES.has(`${z.zc},${z.zr}`));
const allMatch = canvasZones.every((z) => z.calls.length === 1 && z.calls[0][0] === z.expDc && z.calls[0][1] === z.expDr);
const mismatches = canvasZones.filter((z) => !(z.calls.length === 1 && z.calls[0][0] === z.expDc && z.calls[0][1] === z.expDr));
check("c2 canvas領域22ゾーンが原作 bf.java:530-532 verbatim の (dx,dy) と一致", allMatch, { mismatches });
const hudBlocked = hudZones.every((z) => z.calls.length === 0);
check("c3 HUDボタンと重なる2ゾーン(はしご/もぐる)はHUD優先で無反応(実機の正しい挙動)", hudBlocked, { hudZones });

await page.evaluate(() => { window.act = window.__origAct; }); // モンキーパッチ解除(元の act へ復元)。

// ============================================================================
// (d) 真上移動は足場/はしごが無ければ即座に落ち戻る(クライム不能=v0.20.0 判断C)。
// ============================================================================
console.log("\n== (d) クライム不能(はしご無しでは落ち戻る) ==");

const climbBlocked = await page.evaluate(() => {
  startDive(); // 裏庭。
  G.monsters = [];
  const col = G.px;
  for (let r = 1; r <= 6; r++) G.dug.add(col + "," + r); // 縦坑(はしごなし)。
  G.py = 6;
  const before = G.py;
  act(0, -1);
  const after = G.py;
  return { before, after, blocked: after === before };
});
check("d1 縦坑(はしご無し)で真上入力しても登れず落ち戻る", climbBlocked.blocked === true, climbBlocked);

const stairClimb = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  G.pick = "DIAMOND";
  // 横隣(px+1,py)が固体(足場)・斜め上ターゲットが空間なら、斜め移動(階段登り)は成立する
  // (真上移動だけが不能で、原作ジャンプ+足場の階段登りは判断C 後も不変)。
  const c = G.px, r = 5;
  G.py = r; G.dug.add(c + "," + (r - 1)); G.dug.add((c + 1) + "," + (r - 1));
  const before = G.py;
  act(1, -1);
  return { before, after: G.py, climbedViaStair: G.px === c + 1 && G.py === r - 1 };
});
check("d2 階段登り(横に足場)は真上クライムと違い引き続き成立する(退行なし)", stairClimb.climbedViaStair === true, stairClimb);

// ============================================================================
// (e) はしごマスでは重力が働かず落下しない(着はしご含む)。
// ============================================================================
console.log("\n== (e) はしごマスで落下しない ==");

const ladderStop = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  const col = G.px;
  for (let r = 1; r <= 6; r++) G.dug.add(col + "," + r); // 縦穴(空間)。
  G.placedLadders.add(col + ",4"); // 中間の1マスだけはしご。
  G.px = col; G.py = 1;
  applyGravity(); // 足元(2..6)は空間なので、はしごマス(4)まで落ちて止まるはず。
  return { landedAt: G.py, stoppedAtLadder: G.py === 4 };
});
check("e1 落下ループ中にはしごマスへ入ったら着はしごで停止(素通りしない)", ladderStop.stoppedAtLadder === true, ladderStop);

const ladderNoFall = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  const col = G.px;
  G.dug.add(col + ",1"); G.dug.add(col + ",2"); // (col,1)(col,2) は空間。
  G.placedLadders.add(col + ",1");
  G.px = col; G.py = 1;
  applyGravity(); // 自機マス自体がはしごなら、真下が空間でも即 return(重力無効)。
  return { py: G.py, stayed: G.py === 1 };
});
check("e2 自機マス自体がはしごなら真下が空間でも重力無効(即 return)", ladderNoFall.stayed === true, ladderNoFall);

const fluidStillWorks = await page.evaluate(() => {
  startDive();
  G.monsters = [];
  const col = G.px;
  G.dug.add(col + ",1"); G.dug.add(col + ",2");
  G.fluid.set(col + ",1", { k: HAZARD.WATER, d: 8 }); // 流体(既存 v0.16.0 判断D)。
  G.placedLadders = new Set(); // はしごは絡めない(浮力単体の非退行確認)。
  G.px = col; G.py = 1;
  applyGravity();
  return { py: G.py, stayed: G.py === 1 };
});
check("e3 はしご導入後も既存の浮力(流体中は重力無効)は不変(非退行)", fluidStillWorks.stayed === true, fluidStillWorks);

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
