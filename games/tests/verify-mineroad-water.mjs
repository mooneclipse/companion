// verify-mineroad-water.mjs — マインロード v0.16.0「水/マグマ機構の原作合わせ」独立検証(playtester)。
//
// 実装側テスト(selfcheck-mineroad-water.mjs / debug-mineroad.mjs gate W3/W4)とは**別実装・別シナリオ**:
// selfcheck は state 注入でシナリオを構築するが、本テストは地表 (7,0) から**実タップのみ**で
// seed 41027(裏庭)の実測盤面 列 c=8 を掘り進み、row 12 の掘り当て水マスで全項目を踏む固定経路
// (盤面ダンプ + 外来播種水 CA シミュレーションで事前導出した決定論値を直接 assert)。
//
// 経路計画(seed 41027 実測、plan-water-path 導出):
//   - 列 8: rows 1..11 は SOIL/HARD/空間のみ(GIRL 無し・row>=11 の経路 hazard 無し)。
//   - (8,12): tileType=SOIL かつ hazardAt=WATER(row>=11 の深層掘り当てマス)。
//   - (8,13): SOIL + hazard NONE(下流動の受け皿)。(8,14)=GIRL 固体で底が閉じる。
//   - (9,12): SOIL + hazard NONE(横流動の受け皿)。(7,12)/(10,12)/(9,13) 固体で region が閉じる。
//   - 初期播種水は (13,15) の 1 マスのみ(孤立静止=経路非干渉を 80 ターン CA シムで確認済み)。
//
// 入力規律(tests/ ルール): 全入力は page.mouse の画面座標タップ + タップ直前に elementFromPoint で
// 最前面 = #scene(canvas) を assert(canvas への直接 dispatch なし = overlay 飛び越え PASS の穴を塞ぐ)。
//
// state 注入は 5 点(すべてシナリオノイズ除去 or 補助検証、または v0.20.0 追随。世界生成レイヤー
// tileType/oreAt/girlPositions/hazardAt/avalanche には非介入):
//   ①ダイブ開始時 G.monsters = [](空間スポーン敵の戦闘ノイズ除去。verify-dig8 ①と同じ)
//   ②G.pick 昇格 WOOD→STONE(経路 HARD 2 マスの通過。プレイヤー進行度 state。verify-dig8 ②)
//   ③G.spawned.add("8,12","9,12")(埋没スポーン抑止 2 マス。verify-dig8 ③)
//   ④【マグマ補助検証】G.fluid へ (8,10)/(8,11) {k:MAGMA,d:8} を直接注入→検証後 delete。
//     裏庭は magmaFrac=0 でマグマへ実タップ到達不能のため、親指示どおり G 直接操作の補助検証と明記。
//   ⑤v0.20.0 追随: climbUp ヘルパーが 0,-1 タップ毎に目的セルへ G.placedLadders を transient
//     注入→撤去(判断C でクライムが廃止されたため。詳細は climbUp 定義のコメント参照)。
//
// 検証項目(親指示):
//   V1 遷移: タイトル→裏庭ダイブ開始→HUD 表示
//   V2 掘り当て湧出: row12 の hazardAt=WATER マスを掘り抜いた瞬間 G.fluid d=8 + 画面の青ピクセル
//   V3 流動: 毎ターン 1 マス/1 密度ずつ 下→(下が満水後)左右 に広がる(d 増分を毎ターン実測)
//   V4 溺れ HP 直撃: 5 ターン(SWIM Lv0)無傷・SP のみ 1/ターン減 → 6 ターン目から HP−4/ターン
//     (SP 残存でも)。水から出ると息継ぎ(breath 0)、再突入で無傷ターン復活
//   V5 浮力: 水中で横移動しても沈まない + 空中から落ちると水面(最初の流体セル)で停止
//   V6 マグマ(補助検証④): 滞在 1 ターン目から猶予なし HP−6(=ceil(30/5))/ターン、息は使わない
//   V7 残り息表示: 水没中は自機頭上に残り息数字(canvas 直描画)、息切れで警告色、水から出る/
//     地表帰還で消える
//   V8 決定論: fresh コンテキスト 2 回で同一操作列 → G.fluid/HP/SP/seen/dug スナップショット完全一致
//   V9 回帰: 既存作 URL 全 200 + 短高 viewport 412x680/730 はみ出し 0 + pageerror 0
//
// 実行: 本番 47825 は使わない。別ポート(既定 47893)で server/app.py を自前起動してから
//   GAMES_BASE=http://127.0.0.1:47893 node tests/verify-mineroad-water.mjs
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47893";
const C = 8; // 経路列。
const W = 12; // 掘り当て水マスの行(row>=11 の深層)。
const failures = [];
const log = (k, v) => console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
function check(name, cond, detail) {
  log((cond ? "ok " : "NG ") + name, detail === undefined ? cond : detail);
  if (!cond) failures.push(name);
  return cond;
}

const browser = await chromium.launch();

async function openMineroad(vw, vh) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    hasTouch: true,
    serviceWorkers: "block",
  });
  await ctx.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      localStorage.setItem("mineroad_seen_howto", "1"); // 初回 howto はスキップ(検証対象外)。
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

const topAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return e ? e.id || e.className || e.tagName : "none";
  }, [x, y]);

// セレクタ中心を実マウスタップ(最前面 = 対象または内包を assert)。
async function tapEl(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { found: false, front: false };
  const front = await page.evaluate(([sel, x, y]) => {
    const el = document.querySelector(sel);
    const top = document.elementFromPoint(x, y);
    return !!el && !!top && (el === top || el.contains(top) || top.contains(el));
  }, [selector, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  return { found: true, front };
}

// カメラ lerp の整定を実測ポーリングで待つ(裏庭は世界が 1 画面に収まり camY=0 のまま=即収束)。
async function camSettle(page, timeoutMs = 3000) {
  const t0 = Date.now();
  let prev = await page.evaluate(() => window.__camY || 0);
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(100);
    const cur = await page.evaluate(() => window.__camY || 0);
    if (Math.abs(cur - prev) < 0.02) return cur;
    prev = cur;
  }
  return prev;
}

async function startDive(page) {
  const t = await tapEl(page, ".dungeon-btn:not([disabled])");
  if (!t.found || !t.front) return { ok: false, t };
  await page.waitForTimeout(400);
  const scr = await page.evaluate(() => G.screen);
  return { ok: scr === "dive", t, scr };
}

// 自機隣接オフセット(dc,dr)のタイル中心へ実マウスタップ。canvas rect + 実 camY から画面座標を算出。
async function tapTileOffset(page, dc, dr) {
  // v0.20.0 フレーク対策: タップ座標算出→クリック着弾の間にカメラ lerp が動くと着弾タイルが
  // ずれる。旧仕様は「隣接圏外タップ=無視」で無害だったが、ゾーン入力導入で「別方向の行動」に
  // 化けて run 間分岐する(V8 実測)。毎タップ前にカメラ収束を待って座標を確定させる。
  await camSettle(page);
  const p = await page.evaluate(([dc, dr]) => {
    const r = document.getElementById("scene").getBoundingClientRect();
    const cam = window.__camY || 0;
    const camx = window.__camX || 0;
    return {
      x: r.left + (G.px + dc - camx) * tile + tile / 2, // camX: 裏庭 0 で不変、広域で堅牢。
      y: r.top + (G.py + dr - cam) * tile + tile / 2,
    };
  }, [dc, dr]);
  const front = (await topAt(page, p.x, p.y)) === "scene";
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
  return { front, x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
}

// v0.20.0 追随(判断C): 真上への意図的クライム(noGravity)が廃止され、はしごマスのみ重力無効に
// なった。旧「0,-1 タップ = そのままクライム」は水中(浮力)セルへの移動には元々不要(fluidAt が
// 重力を止める)だが、乾いた(非流体)セルへの移動には登った先が即座に落ち戻ってしまう。
// このシナリオの経路は水没/退避/離脱を行き来する縦一直線なので、タップ直前だけ目的セルへ
// はしごを 1 個 transient に注入し、タップ直後に即撤去する(残すと次の下方向タップで
// 「そのマスはもう重力が効かない」まま固定されてしまい、T10 の浮力落下停止テスト等の後続
// 物理前提を壊す=verify-mineroad-dig8.mjs で実際に踏んだ落とし穴と同型)。水中セルへの移動は
// 元来はしご不要だが、注入しても fluidAt の早期 return が先に効くため無害(一律で通す)。
async function climbUp(page) {
  const target = await page.evaluate(() => ({ c: G.px, r: G.py - 1 }));
  await page.evaluate(([c, r]) => { G.placedLadders.add(c + "," + r); }, [target.c, target.r]);
  const t = await tapTileOffset(page, 0, -1);
  await page.evaluate(([c, r]) => { G.placedLadders.delete(c + "," + r); }, [target.c, target.r]);
  return t;
}

// state スナップショット(HUD テキストと内部値の両方 + 流体 region)。
// region = 経路近傍 |col-8|<=2, |row-12|<=3 の流体エントリ("col,row:kind:density" ソート連結)。
const snap = (page) =>
  page.evaluate(() => ({
    px: G.px,
    py: G.py,
    hp: G.hp,
    sp: G.stamina,
    hpHud: document.getElementById("hp-val").textContent,
    spHud: document.getElementById("stamina-val").textContent,
    breath: G.breath,
    drownNoted: G.drownNoted,
    fluidSize: G.fluid ? G.fluid.size : -1,
    region: G.fluid
      ? [...G.fluid.entries()]
          .filter(([k]) => {
            const [c, r] = k.split(",").map(Number);
            return Math.abs(c - 8) <= 2 && Math.abs(r - 12) <= 3;
          })
          .map(([k, f]) => `${k}:${f.k}:${f.d}`)
          .sort()
          .join("|")
      : "none",
    seenSize: G.seen ? G.seen.size : -1,
    dugSize: G.dug ? G.dug.size : -1,
    screen: G.screen,
  }));

// セル中心の canvas 実ピクセル(DPR 換算、canvas ローカル座標で getImageData)。
const cellPixel = (page, col, row) =>
  page.evaluate(([col, row]) => {
    const cv = document.getElementById("scene");
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const cam = window.__camY || 0;
    const x = Math.round((col + 0.5) * tile * dpr);
    const y = Math.round((row - cam + 0.5) * tile * dpr);
    const d = cv.getContext("2d").getImageData(x, y, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }, [col, row]);

// 自機頭上(残り息数字の描画位置 cy - 0.62*tile)周辺の走査。白青文字(#dff3ff)/警告赤(#ff7b6a)の
// 検出と最大輝度を返す(canvas 直描画の実在をピクセルで証明する)。
const headRegion = (page) =>
  page.evaluate(() => {
    const cv = document.getElementById("scene");
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const cam = window.__camY || 0;
    const cx = (G.px + 0.5) * tile;
    const cy = (G.py - cam + 0.5) * tile - tile * 0.62;
    const x0 = Math.max(0, Math.round((cx - tile * 0.4) * dpr));
    const y0 = Math.max(0, Math.round((cy - tile * 0.28) * dpr));
    const w = Math.round(tile * 0.8 * dpr);
    const h = Math.round(tile * 0.56 * dpr);
    const img = cv.getContext("2d").getImageData(x0, y0, w, h).data;
    let maxLum = 0;
    let whiteBlue = false;
    let warnRed = false;
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i], g = img[i + 1], b = img[i + 2];
      const lum = (r + g + b) / 3;
      if (lum > maxLum) maxLum = lum;
      if (r > 170 && g > 190 && b > 210) whiteBlue = true;
      if (r > 200 && g < 180 && b < 170) warnRed = true;
    }
    return { maxLum: Math.round(maxLum), whiteBlue, warnRed };
  });

const hintText = (page) =>
  page.evaluate(() => (document.getElementById("hud-hint").hidden ? "" : document.getElementById("hud-hint").textContent));
const warnPopupText = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".popup.warn")].map((p) => p.textContent).join(","));

// ============================================================================
// メインシナリオ(実タップ経路)。fail 記録は run 1 のみ(check)、run 2 は決定論照合用。
// ============================================================================
async function runScenario(recording) {
  const ck = recording ? check : () => {};
  const { ctx, page, errors } = await openMineroad(412, 915);
  const trace = [];
  const rec = async (step) => {
    const s = await snap(page);
    trace.push({ step, ...s });
    return s;
  };

  // ---- V1 遷移: タイトル(版数表示)→ダイブ→HUD ----
  const ver = await page.evaluate(() => {
    const el = document.getElementById("ov-version");
    return el ? el.textContent : "";
  });
  ck("V1 タイトルに v0.20.0 表示(機械追随)", ver.includes("v0.20.0"), ver);
  const dive = await startDive(page);
  ck("V1 ダンジョン選択タップ(最前面)→dive 遷移", dive.ok && dive.t.front, dive);
  // 注入①: 空間スポーン敵を除去 / ②: pick=STONE(経路 HARD 2 マス) / ③: 埋没スポーン抑止 2 マス。
  await page.evaluate(() => {
    G.monsters = [];
    G.pick = "STONE";
    G.spawned.add("8,12");
    G.spawned.add("9,12");
  });
  await camSettle(page);
  const s0 = await rec("start");
  ck("V1 HUD 表示(HP30/SP100)+開始位置(7,0)", s0.px === 7 && s0.py === 0 && s0.hpHud === "30" && s0.spHud === "100", s0);
  ck("V1 初期播種 = 外来水 (13,15) の 1 マスのみ(経路 region 空)",
    s0.fluidSize === 1 && s0.region === "" &&
      (await page.evaluate(() => G.fluid.has("13,15") && G.fluid.get("13,15").k === HAZARD.WATER && G.fluid.get("13,15").d === 8)),
    { fluidSize: s0.fluidSize, region: s0.region });
  // 掘り当てマスの決定論前提(読み取りのみ): hazardAt(8,12) = WATER, row>=11。
  const hz = await page.evaluate(([c, w]) => hazardAt(c, w, G.seed), [C, W]);
  ck("V2 前提: hazardAt(8,12)=WATER(row 12 >= 11 の深層)", hz === 1, hz);

  // ---- 降下: (7,0)→(8,0)→列 8 を (8,11) まで実タップで掘り進む ----
  // taps: r1 HARD=2, r2=1, r3 HARD=2, r4=1, r5=1(掘り抜き後の重力で初期空間 r6 まで自動落下),
  //       r7..r11=各1 → 計 12(盤面ダンプ + probe-descent 実測由来)。
  // SP 台帳: 地表歩行は moveTo→surfaceReturn の全回復で実質 0 消費(v0.16.0 時点の実装挙動を実測で
  // 確認)。降下 12 行動で (8,11) 到達時 SP=100-12=88。
  let t = await tapTileOffset(page, 1, 0);
  ck("降下 地表歩行タップ 最前面=scene", t.front, t);
  const downTaps = 12; // 2+1+2+1+1(重力で r6 込み)+5
  for (let i = 0; i < downTaps; i++) {
    t = await tapTileOffset(page, 0, 1);
    if (!t.front) ck(`降下タップ#${i + 1} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sD = await rec("descend");
  ck("降下 (8,11) 到達 + SP 台帳一致(100-12=88) + HP30 + 経路 region 無流体",
    sD.px === 8 && sD.py === 11 && sD.sp === 88 && sD.spHud === "88" && sD.hp === 30 && sD.region === "",
    { pos: `${sD.px},${sD.py}`, sp: sD.spHud, hp: sD.hpHud });
  // 湧出前の (8,12) ピクセル(固体 SOIL=暖色系)を記録。
  const preDig = await cellPixel(page, C, W);

  // ---- T1 / V2: 掘り当て湧出。(8,12) 掘り抜き→満水 d=8 湧出→自機は水中へ前進 ----
  t = await tapTileOffset(page, 0, 1);
  ck("T1 掘り当てタップ 最前面=scene", t.front, t);
  const hint1 = await hintText(page);
  const s1 = await rec("t1-release");
  ck("T1 V2 掘り抜いた瞬間 G.fluid へ満水 d=8 湧出 + 自機 (8,12) 水中 + breath=1 + HP30",
    s1.region === "8,12:1:8" && s1.px === 8 && s1.py === 12 && s1.breath === 1 && s1.hp === 30, s1);
  ck("T1 V2 水ヒント表示(cueWater)", hint1.includes("水の中"), hint1);

  // ---- T2 / V3: 下流動。(8,13) を掘り抜く→前進、次 fluidStep で水が 1 マス下へ d=1 ----
  t = await tapTileOffset(page, 0, 1);
  ck("T2 下掘りタップ 最前面=scene", t.front, t);
  const s2 = await rec("t2-flowdown");
  ck("T2 V3 下の空間へ 1 ターンで d=1 流入(hazard NONE マス=湧出でなく流動) + breath=2",
    s2.region === "8,12:1:8|8,13:1:1" && s2.px === 8 && s2.py === 13 && s2.breath === 2 && s2.hp === 30, s2);

  // ---- T3: クライムで (8,12) へ。増密 d=2 + 残り息数字の描画(白青ピクセル) ----
  t = await climbUp(page);
  ck("T3 クライムタップ 最前面=scene", t.front, t);
  const s3 = await rec("t3-densify");
  ck("T3 V3 合流増密 d=2(毎ターン+1) + breath=3 + HP30",
    s3.region === "8,12:1:8|8,13:1:2" && s3.px === 8 && s3.py === 12 && s3.breath === 3 && s3.hp === 30, s3);
  const head3 = await headRegion(page);
  ck("T3 V7 残り息数字が自機頭上に描画(白青 #dff3ff 系ピクセル検出)", head3.whiteBlue, head3);

  // ---- T4 / V2 ピクセル + V5 浮力(水セルへの移動で沈まない) ----
  t = await tapTileOffset(page, 0, 1);
  ck("T4 水中下移動タップ 最前面=scene", t.front, t);
  const s4 = await rec("t4");
  ck("T4 V3 d=3 + breath=4 + HP30", s4.region === "8,12:1:8|8,13:1:3" && s4.py === 13 && s4.breath === 4 && s4.hp === 30, s4);
  const wpix = await cellPixel(page, C, W); // 自機は (8,13) → (8,12) の満水セルを遮蔽なしで実測。
  ck("T4 V2 湧出セル (8,12) の画面ピクセルが青系へ変化(b>r+25 かつ 掘削前より青増)",
    wpix.b > wpix.r + 25 && wpix.b > preDig.b + 25, { pre: preDig, post: wpix });

  // ---- T5 / V4: 5 ターン目まで無傷 + SP のみ減(台帳: 100-12-5=83) ----
  t = await climbUp(page);
  ck("T5 クライムタップ 最前面=scene", t.front, t);
  const s5 = await rec("t5-grace");
  ck("T5 V4 水中 5 ターン(SWIM Lv0)は HP 無傷 + SP のみ 1/ターン減(83)",
    s5.breath === 5 && s5.hp === 30 && s5.hpHud === "30" && s5.sp === 83 && s5.spHud === "83" &&
      s5.region === "8,12:1:8|8,13:1:4",
    s5);

  // ---- T6 / V4: 6 ターン目から HP 直撃 -4(SP 残存でも) ----
  t = await tapTileOffset(page, 0, 1);
  ck("T6 タップ 最前面=scene", t.front, t);
  const pops6 = await warnPopupText(page);
  const hint6 = await hintText(page);
  const s6 = await rec("t6-drown");
  ck("T6 V4 6 ターン目で HP30→26(SP82 残存でも HP 直撃) + '-4' ポップ",
    s6.breath === 6 && s6.hp === 26 && s6.hpHud === "26" && s6.sp === 82 && pops6.includes("-4"),
    { ...s6, pops: pops6 });
  ck("T6 V4 息切れヒント表示(cueDrown)", hint6.includes("息が切れた"), hint6);

  // ---- T7: 2 ターン目の直撃 -4 + 残り息 0 の警告色(赤系ピクセル) ----
  t = await climbUp(page);
  ck("T7 クライムタップ 最前面=scene", t.front, t);
  const s7 = await rec("t7-drown2");
  ck("T7 V4 毎ターン -4 継続(26→22)", s7.breath === 7 && s7.hp === 22 && s7.py === 12, s7);
  const head7 = await headRegion(page);
  ck("T7 V7 息切れ中は残り息 0 が警告赤(#ff7b6a 系)で描画", head7.warnRed, head7);

  // ---- T8 / V4+V7: 水から出る→息継ぎ(breath 0)+ダメージ停止+数字消滅 ----
  t = await climbUp(page);
  ck("T8 離水クライムタップ 最前面=scene", t.front, t);
  const s8 = await rec("t8-breathe");
  ck("T8 V4 水から出ると息継ぎ(breath=0)+HP 減少停止(22 のまま)",
    s8.py === 11 && s8.breath === 0 && s8.hp === 22 && s8.region === "8,12:1:8|8,13:1:7", s8);
  const head8 = await headRegion(page);
  ck("T8 V7 離水で残り息数字が消える(白青/警告赤ピクセル無し)", !head8.whiteBlue && !head8.warnRed, head8);

  // ---- T9: さらに上がる(満水 cap d=8 到達を確認) ----
  t = await climbUp(page);
  ck("T9 クライムタップ 最前面=scene", t.front, t);
  const s9 = await rec("t9-cap");
  ck("T9 V3 下セル満水 cap d=8(それ以上増えない)", s9.py === 10 && s9.region === "8,12:1:8|8,13:1:8", s9);

  // ---- T10 / V5 浮力: 空中(8,10)から下タップ→(8,11)経由で落下→水面 (8,12) で停止 ----
  // (8,13) も空間+水だが、最初の流体セル (8,12) で止まる=沈み抜けない。息継ぎ後の再突入で
  // 無傷ターンが復活していること(HP 22 のまま)も同時に assert。
  t = await tapTileOffset(page, 0, 1);
  ck("T10 落下タップ 最前面=scene", t.front, t);
  const s10 = await rec("t10-floatstop");
  ck("T10 V5 落下が水面 (8,12) で停止(下の水空間へ沈み抜けない) + V4 息継ぎ後 breath=1 無傷",
    s10.px === 8 && s10.py === 12 && s10.breath === 1 && s10.hp === 22, s10);

  // ---- T11 / V3 横流動: (9,12) を掘り抜く→下が満水の水は左右へ d=1 展開 ----
  t = await tapTileOffset(page, 1, 0);
  ck("T11 横掘りタップ 最前面=scene", t.front, t);
  const s11 = await rec("t11-flowside");
  ck("T11 V3 下が満水になった後は左右の空間へ d=1 展開(hazard NONE マス=流動)",
    s11.px === 9 && s11.py === 12 && s11.region === "8,12:1:8|8,13:1:8|9,12:1:1" && s11.breath === 2 && s11.hp === 22,
    s11);

  // ---- T12 / V5: 水中横移動で沈まない(真下 (8,13) は空間+水だが py=12 のまま) ----
  t = await tapTileOffset(page, -1, 0);
  ck("T12 水中横移動タップ 最前面=scene", t.front, t);
  const s12 = await rec("t12-swim");
  ck("T12 V5 水中横移動で下に吸い込まれない(py=12 維持) + V3 横セル増密 d=2",
    s12.px === 8 && s12.py === 12 && s12.region === "8,12:1:8|8,13:1:8|9,12:1:2" && s12.breath === 3 && s12.hp === 22,
    s12);

  // ---- 離水して (8,9) まで上がる(マグマ補助検証の足場) ----
  for (const [i, er] of [[1, 11], [2, 10], [3, 9]]) {
    t = await climbUp(page);
    if (!t.front) ck(`退避クライム#${i} 最前面=scene`, false, t);
    const s = await snap(page);
    if (s.py !== er) ck(`退避クライム (8,${er}) 到達`, false, { py: s.py });
  }
  const s15 = await rec("t15-clear");
  ck("退避完了 (8,9)・breath=0・HP22 維持", s15.px === 8 && s15.py === 9 && s15.breath === 0 && s15.hp === 22, s15);

  // ---- V6 マグマ(補助検証: 注入④ G.fluid 直接操作。裏庭 magmaFrac=0 で実タップ到達不能) ----
  await page.evaluate(() => {
    G.fluid.set("8,10", { k: HAZARD.MAGMA, d: 8 });
    G.fluid.set("8,11", { k: HAZARD.MAGMA, d: 8 });
  });
  const sInj = await rec("magma-inject");
  ck("V6 マグマ注入(補助検証と明記): (8,10)/(8,11) d=8",
    sInj.region.includes("8,10:2:8") && sInj.region.includes("8,11:2:8"), sInj.region);
  // T16: マグマ 1 ターン目 = 猶予なし -6(=ceil(30/5))。息(breath)は使わない。
  t = await tapTileOffset(page, 0, 1);
  ck("T16 マグマ進入タップ 最前面=scene", t.front, t);
  const pops16 = await warnPopupText(page);
  const hint16 = await hintText(page);
  const s16 = await rec("t16-magma1");
  ck("T16 V6 マグマ滞在 1 ターン目から HP-6(22→16、猶予なし) + breath=0 のまま + '-6' ポップ",
    s16.py === 10 && s16.hp === 16 && s16.breath === 0 && pops16.includes("-6"), { ...s16, pops: pops16 });
  ck("T16 V6 マグマヒント表示(cueMagma)", hint16.includes("マグマ"), hint16);
  // T17: 2 ターン目 -6。マグマセル (8,10) の画面ピクセルは赤系(自機は (8,11) へ移動済み)。
  t = await tapTileOffset(page, 0, 1);
  ck("T17 マグマ下移動タップ 最前面=scene", t.front, t);
  const s17 = await rec("t17-magma2");
  ck("T17 V6 毎ターン -6 継続(16→10)", s17.py === 11 && s17.hp === 10, s17);
  const mpix = await cellPixel(page, 8, 10);
  ck("T17 V6 マグマセルの画面ピクセルが赤系(r>b+25)", mpix.r > mpix.b + 25, mpix);
  // T18-T19: 脱出クライム(通過 1 ターン -6)→空中で停止。
  t = await climbUp(page);
  ck("T18 脱出クライムタップ 最前面=scene", t.front, t);
  const s18 = await rec("t18-magma3");
  ck("T18 V6 3 ターン目 -6(10→4)", s18.py === 10 && s18.hp === 4, s18);
  t = await climbUp(page);
  ck("T19 離脱クライムタップ 最前面=scene", t.front, t);
  const s19 = await rec("t19-exit");
  ck("T19 V6 マグマ外へ出るとダメージ停止(HP4 維持)", s19.py === 9 && s19.hp === 4 && s19.screen === "dive", s19);
  // 注入④の後片付け: マグマを除去し、水 region が満水 3 マスで残ることを確認。
  await page.evaluate(() => {
    G.fluid.delete("8,10");
    G.fluid.delete("8,11");
  });
  const sClean = await rec("magma-clean");
  ck("V6 注入マグマ除去後、水 region は満水 3 マス(8,12|8,13|9,12 全て d=8)",
    sClean.region === "8,12:1:8|8,13:1:8|9,12:1:8", sClean.region);

  // ---- 地表帰還: (8,9)→クライム 9 回→row0 = surfaceReturn(全回復 + 息リセット) ----
  for (let i = 0; i < 9; i++) {
    t = await climbUp(page);
    if (!t.front) ck(`帰還クライム#${i + 1} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sSurf = await rec("surface");
  ck("V1/V7 地表帰還: py=0 + 全回復(HP30/SP100) + breath=0(残り息の地表残留なし)",
    sSurf.py === 0 && sSurf.hp === 30 && sSurf.sp === 100 && sSurf.breath === 0 && sSurf.screen === "dive",
    sSurf);
  const headS = await headRegion(page);
  ck("V7 地表で残り息数字が描画されない", !headS.whiteBlue && !headS.warnRed, headS);

  // ---- pageerror 0(シナリオ全体) ----
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  ck("シナリオ pageerror 0", pe.length === 0, pe);

  await ctx.close();
  return trace;
}

// ============================================================================
// 実行
// ============================================================================
console.log("== マインロード v0.16.0 水/マグマ 独立検証(verify-mineroad-water) ==");
console.log(`BASE=${BASE}`);

console.log("\n-- V1〜V7 メインシナリオ(実タップ経路 run 1) --");
const trace1 = await runScenario(true);

// V8 決定論: fresh コンテキストで同一操作列を再実行し全スナップショット照合。
console.log("\n-- V8 決定論(同一操作列 run 2 → トレース照合) --");
const trace2 = await runScenario(false);
const t1s = JSON.stringify(trace1);
const t2s = JSON.stringify(trace2);
check("V8 同一 seed 同一操作列で G.fluid/HP/SP/seen/dug 全スナップショット一致", t1s === t2s,
  { steps: trace1.length, match: t1s === t2s });
if (t1s !== t2s) {
  for (let i = 0; i < Math.max(trace1.length, trace2.length); i++) {
    if (JSON.stringify(trace1[i]) !== JSON.stringify(trace2[i])) {
      log("V8 初回不一致", { run1: trace1[i], run2: trace2[i] });
      break;
    }
  }
}

// V9a 既存作回帰(同一サーバで全 URL 200)。
console.log("\n-- V9a 既存作回帰(URL 200) --");
for (const path of ["/", "/tomoshibi/", "/nagori/", "/akari/", "/mineroad/", "/healthz"]) {
  const res = await fetch(`${BASE}${path}`);
  check(`V9a ${path} 200`, res.status === 200, res.status);
}

// V9b 短高 viewport(モバイル Chrome ツールバー表示相当)。headless は実ツールバーの svh 挙動を
// 完全再現できない(svh=vh=innerHeight)ため、innerHeight 内配置 + タップ機能で担保する。
console.log("\n-- V9b 短高 viewport 412x680 / 412x730 --");
for (const vh of [680, 730]) {
  const { ctx, page, errors } = await openMineroad(412, vh);
  const btnBox = await page.evaluate(() => {
    const el = document.querySelector(".dungeon-btn:not([disabled])");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight };
  });
  check(`V9b ${vh} タイトル: ダンジョンボタン in-view`, !!btnBox && btnBox.t >= 0 && btnBox.b <= btnBox.ih, btnBox);
  const dive = await startDive(page);
  check(`V9b ${vh} タイトル: ボタンタップ機能(dive 遷移)`, dive.ok && dive.t.front, dive);
  await camSettle(page);
  const btns = ["#btn-up", "#btn-down", "#btn-left", "#btn-right", "#btn-surface",
    "#btn-craft", "#btn-ladder", "#btn-antenna", "#btn-mute"];
  const btnRep = await page.evaluate((sels) => {
    const bad = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { bad.push({ sel, miss: true }); continue; }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const hit = !!top && (el === top || el.contains(top) || top.contains(el));
      if (!(r.top >= 0 && r.bottom <= window.innerHeight && hit))
        bad.push({ sel, t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight, hit });
    }
    return bad;
  }, btns);
  check(`V9b ${vh} dive: 必須ボタン ${btns.length} 個 in-view + ヒット可`, btnRep.length === 0, btnRep);
  const overflow = await page.evaluate(() => {
    const sels = [
      "#hud .top-row *", "#hud .gauge-row *", "#hud .counts *", "#depth-val",
      "#inventory *", ".dpad-btn", "#hud-hint",
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2", ".dungeon-btn",
    ];
    const bad = [];
    const seen = new Set();
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const eps = 0.5;
        if (r.left < -eps || r.top < -eps || r.right > window.innerWidth + eps || r.bottom > window.innerHeight + eps)
          bad.push({ sel, id: el.id || el.className, rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) } });
      }
    }
    return bad;
  });
  check(`V9b ${vh} dive: UI はみ出し 0`, overflow.length === 0, overflow.slice(0, 5));
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  check(`V9b ${vh} pageerror 0`, pe.length === 0, pe);
  await ctx.close();
}

await browser.close();

console.log("\n== 総合 ==");
if (failures.length) {
  console.log("  FAIL 項目:");
  for (const f of failures) console.log("   -", f);
}
console.log(`VERIFY RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} (fail=${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
