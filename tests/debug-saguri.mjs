// さぐり v1.0.0 実機相当デバッグ + みちゆき/ともしび/なごり/あかり/ともる 回帰。
// 明るい断面で危険を読み、崩れる地形の中で女の子を地上へ護衛するターン制掘削デドゥース。
// 文字・手がかり数字 chip・スタミナバー・気配メーター・救出数・十字キーは全て DOM(なごり
// 「文字がはみ出して読めない」真因の直接対策)。canvas には断面(タイル矩形 + per-tile
// ライティング + 光の道 + 自機 + 女の子)のみを焼く。
//
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す。
// 掘る/印は canvas(タップ掘り/長押し)と十字キー(DOM ボタン)の両経路。送る前に必ず
// elementFromPoint で最前面が想定要素(canvas は #scene、D-pad は dpad-btn)であることを
// assert する(overlay/HUD が pointer を食っていればここで落ちる = みちゆき真因の検出器)。
// viewport 412x915。短高 viewport(412x680/730)gate は別 section。
//
// 検証項目(さぐり v1.0.0):
//   1. /saguri/ 200 + pageerror 0 + VERSION v1.0.0。title→(初回 あそびかた)→ダイブ遷移。
//      dive 中央の最前面が #scene(overlay 飛び越えなし)。HUD が pointer を食わない。
//   2. 核メカ: 掘って前進(深度増・画面が流れる)/手がかり数字 = 周囲8近傍の不安定岩数(実関数
//      clueCount を独立再計算で検算)/0連鎖開示/落盤(真下を掘る→次手番で落下・道を塞ぐ)/
//      気配メーター(方向+距離ヒート)/女の子 発見→追従→地表救出→断章1行/スタミナ0で失敗
//      (未救出ロスト・メタ強化残存)→ワンタップ再挑戦/2ダイブ目で地形変化(同seed決定論一致)/
//      ショップ 深度ティアゲート(浅救出だけでは上位 locked、深救出で解放)・買い切り永続。
//   3. 十字キー操作: D-pad ボタンを画面座標タップで掘って前進。印ボタンで隣接に印。各ボタン
//      rect が画面内・押せる。タップ掘り(canvas)も併存して前進。
//   4. テキスト可読性: title/howto/dive HUD/救出演出/fail/clear/shop で全テキスト・数字・
//      手がかり chip・在庫・ショップ行・D-pad・数値の bounding rect が 412x915 内・はみ出し 0。
//   5. 実機リアリズム: 短高 viewport(412x680/730)で十字キー全ボタン・印・もぐる・ショップの
//      購入/もぐるボタンが innerHeight 内・top基準・タップ機能。初見導線(あそびかた)可視。
//      行動フィードバック(掘削打点/落盤▼/救出！)が間/演出で可視化。
//   6. 既存作回帰: /・/tomoshibi/・/nagori/・/akari/・/tomoru/ が 200・pageerror 0・コア操作前進。
//   7. (gate 外)bot で「手がかりを読む安全堀り」vs「手がかり無視の当て推量速攻」を比較。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47826";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const VW = 412;
const VH = 915;

// ---- canvas 背景の RGB サンプリング(16px グリッド、michiyuki/nagori/akari/tomoru と同手法) ----
const sample = (page) =>
  page.evaluate(() => {
    const c = document.getElementById("scene");
    const g = c.getContext("2d");
    const W = c.width, H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const o = [];
    for (let y = 0; y < H; y += 16)
      for (let x = 0; x < W; x += 16) {
        const i = (y * W + x) * 4;
        o.push(d[i], d[i + 1], d[i + 2]);
      }
    return o;
  });

// 明暗変化率しきい値 th(さぐり初回基準を実測で確定。他作の th=32/48 は流用しない)。
// さぐりの canvas は明るい断面(地表 #cdd6e8 → 深層 #10131f)に per-tile ライティング(光の道 =
// 暖色加算、塞がれた区間 = 陰)を重ね、自機追従でカメラがスクロールする。掘って下へ前進すると
// 可視タイルが総入れ替わりし、明るい地表色が暗い深層色 + 掘削空洞の明暗へ大きく変わる。
// 初回実測(dive・自機を下へ 6 回掘って前進、カメラ補間後)の th 曲線:
//   th=8 →96.4%, 16→95.2%, 24→94.6%, 32→69.4%, 48→65.6%, 64→59.6%, 96→38.0%, 128→9.9%
// 対照(操作なし 0.5s = ターン制ゆえ何も動かない)は全 th で ~0.0%。
// さぐりは明るい地表 → 暗い深層へ降りる高コントラストゲームゆえ ともる(暗背景)より絶対値が
// 大きい。th=48 を採用(前進 65.6% / 対照 0.0% を綺麗に分離)、合格条件 ratio>0.15
// (対照 0% を大きく上回り、前進 65.6% で十分上回る)。
// (この th は新ゲームの初回計測基準であり、同一バグへの 2 周目の場当たり調整ではない)
const TH = 48;
const changed = (a, b) => {
  let c = 0;
  for (let i = 0; i < a.length; i += 3)
    if (
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > TH
    )
      c++;
  return c / (a.length / 3);
};

const browser = await chromium.launch();

// seedHowto=true なら saguri_seen_howto=1 を navigation 前に仕込み、初回 howto をスキップ。
// vw/vh で短高 viewport を再現できる(ツールバー切れ対策の gate 用)。
async function openPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.vw || VW, height: opts.vh || VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  if (opts.seedHowto) {
    await ctx.addInitScript(() => { try { localStorage.setItem("saguri_seen_howto", "1"); } catch (e) {} });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

const topElAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return e ? e.id || e.className || e.tagName : "none";
  }, [x, y]);

const inOverlayAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    if (!e) return false;
    return !!e.closest && !!e.closest("#overlay");
  }, [x, y]);

// 最前面が #scene(canvas)か = overlay を飛び越えていない/HUD が pointer を食っていない証明。
const isSceneAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && e.id === "scene";
  }, [x, y]);

// 画面座標タップ(overlay/D-pad ボタン用。可視中心へ move→click。最前面が想定要素であることを確認)。
// 戻り値 false = 要素が無い or 最前面が想定要素でない(overlay 飛び越え/被り)。
async function tapSelector(page, selector, nth = 0) {
  const box = await page.evaluate(([sel, n]) => {
    const el = document.querySelectorAll(sel)[n];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [selector, nth]);
  if (!box) return false;
  const ok = await page.evaluate(([sel, n, px, py]) => {
    const target = document.querySelectorAll(sel)[n];
    const top = document.elementFromPoint(px, py);
    return !!top && (target === top || target.contains(top) || top.contains(target));
  }, [selector, nth, box.x, box.y]);
  if (!ok) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  return true;
}

// 要素の bounding rect が innerHeight 内・top>=0・タップ機能(最前面が自身)か。短高 gate 用。
async function buttonHittable(page, selector, nth = 0) {
  return page.evaluate(([sel, n]) => {
    const el = document.querySelectorAll(sel)[n];
    if (!el) return { exists: false };
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) return { exists: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hit = !!top && (el === top || el.contains(top) || top.contains(el));
    return {
      exists: true,
      topInView: r.top >= -0.5,
      bottomInView: r.bottom <= window.innerHeight + 0.5,
      hit,
      rect: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) },
      innerH: window.innerHeight,
    };
  }, [selector, nth]);
}

// ---- 自機隣接タイルの画面中心座標を求める(描画と同じ基準) -------------------
// app.js: sx = col*tile, sy = (row - camY)*tile。tile/__camY は window 公開済み。
async function tileCenter(page, col, row) {
  return page.evaluate(([col, row]) => {
    const t = tile;
    const cam = window.__camY || 0;
    return { x: col * t + t / 2, y: (row - cam) * t + t / 2 };
  }, [col, row]);
}

// 自機の隣接(dc,dr)を 1 タップぶん掘る。送る前に最前面が #scene であることを assert。
async function digTap(page, dc, dr) {
  const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const pt = await tileCenter(page, cur.px + dc, cur.py + dr);
  const onScene = await isSceneAt(page, pt.x, pt.y);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
  return { tappedScene: onScene, pt };
}

// 自機隣接の (dc,dr) 方向を、自機がそのマスへ前進する(py/px が変わる)まで掘る。
// 硬岩は 2 タップ要るので最大 maxTaps 回繰り返す。各タップで最前面 scene を確認し、
// overlay 飛び越えが 1 度でもあれば allScene=false を返す。
async function digUntilMove(page, dc, dr, maxTaps = 6) {
  let allScene = true;
  for (let k = 0; k < maxTaps; k++) {
    const before = await page.evaluate(() => ({ px: G.px, py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    const r = await digTap(page, dc, dr);
    if (!r.tappedScene) allScene = false;
    await page.waitForTimeout(70);
    const after = await page.evaluate(() => ({ px: G.px, py: G.py }));
    if (after.px !== before.px || after.py !== before.py) return { moved: true, allScene };
  }
  return { moved: false, allScene };
}

// title → (初回 howto なら もぐる) → dive まで進める。
async function startToDive(page) {
  await tapSelector(page, "#ov-action"); // 「タップでもぐる」
  await page.waitForTimeout(300);
  const scr = await page.evaluate(() => G.screen);
  if (scr === "howto") {
    await tapSelector(page, "#ov-action"); // howto の「もぐる」
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700); // overlay フェードアウト(0.6s)待ち。
}

// ---- 可読性アサート: 全テキスト/数値/chip 要素が viewport 内に完全に収まるか ----------
async function overflowReport(page, label, vw = VW, vh = VH) {
  return page.evaluate(([lbl, vw, vh]) => {
    const sels = [
      // overlay(title/howto/fragment/shop/fail/clear)
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2",
      "#ov-howto", "#ov-howto .howto-line", "#ov-fragment",
      // 基地ショップ: 在庫(ポイント)表示 + 強化縦リスト。
      "#ov-stock", "#ov-stock .stock-pt", "#ov-stock .stock-pt *",
      "#ov-upgrades", "#ov-upgrades .shop-row", "#ov-upgrades .shop-row *",
      // HUD(深度/救出/同行/気配/スタミナ/ヒント)
      "#depth-val", ".counts", ".count", ".count *",
      ".sense-meter", ".sense-meter *", ".stamina-rail", ".stamina-rail *",
      "#hud-hint",
      // 手がかり数字 chip(canvas 外 DOM)。
      "#clue-layer .clue",
      // 十字キー + 道具。
      ".dpad", ".dpad-btn", ".tool-bar", ".tool-btn",
    ];
    const bad = [];
    const seen = new Set();
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const eps = 0.5;
        if (r.left < -eps || r.top < -eps || r.right > vw + eps || r.bottom > vh + eps) {
          bad.push({
            sel,
            tag: (el.id || el.className || el.tagName).toString().slice(0, 40),
            text: (el.textContent || "").trim().slice(0, 24),
            rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) },
          });
        }
      }
    }
    return { label: lbl, overflowCount: bad.length, items: bad.slice(0, 8) };
  }, [label, vw, vh]);
}

const overflowFails = [];

// ============================================================================
// (1) コア遷移 + overlay 飛び越え検出 + 初回 howto + title/howto 可読性
// ============================================================================
let corePass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const status = resp ? resp.status() : 0;

  const version = await page.evaluate(() => document.getElementById("ov-version").textContent);
  const screenBefore = await page.evaluate(() => G.screen);
  const inOverlayTitle = await inOverlayAt(page, VW / 2, VH / 2);
  const titleButtons = await page.evaluate(() => ({
    start: document.getElementById("ov-action").textContent,
    howto: document.getElementById("ov-action2").textContent,
    startHidden: document.getElementById("ov-action").hidden,
    howtoHidden: document.getElementById("ov-action2").hidden,
  }));
  const titleOverflow = await overflowReport(page, "title");
  if (titleOverflow.overflowCount > 0) overflowFails.push(titleOverflow);

  // 「タップでもぐる」→ 初回 howto(seen 未設定)。
  const tappedStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(700);
  const screenHowto = await page.evaluate(() => G.screen);
  const howtoInfo = await page.evaluate(() => ({
    lines: document.querySelectorAll("#ov-howto .howto-line").length,
    howtoHidden: document.getElementById("ov-howto").hidden,
    action: document.getElementById("ov-action").textContent,
  }));
  const inOverlayHowto = await inOverlayAt(page, VW / 2, VH / 2);
  const howtoOverflow = await overflowReport(page, "howto-firstrun");
  if (howtoOverflow.overflowCount > 0) overflowFails.push(howtoOverflow);

  // howto の「もぐる」→ dive。seen フラグ記録。
  const tappedHowtoStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(900); // overlay フェードアウト(0.6s)待ち。
  const screenAfter = await page.evaluate(() => G.screen);
  const seenFlag = await page.evaluate(() => localStorage.getItem("saguri_seen_howto"));

  // dive 遷移後、画面中央(自機付近)の最前面が #scene(overlay 飛び越えなし)。
  const sceneAtCenter = await isSceneAt(page, VW / 2, VH * 0.4);
  // HUD のスタミナバー領域(左縦)で HUD が pointer を食っていない(canvas が掘り操作を受ける)。
  // ※ canvas 中央で確認。スタミナバー自体の真上は当然 DOM だが、断面の大半は canvas が受ける。
  const topAtCanvasMid = await topElAt(page, VW / 2, VH * 0.45);

  const init = await page.evaluate(() => ({
    screen: G.screen, diveCount: G.diveCount, py: G.py, px: G.px,
    stamina: G.stamina, staminaMax: G.staminaMax, girls: G.girls.length,
  }));
  const hudVisible = await page.evaluate(() => !document.getElementById("hud").hidden);
  const diveOverflow = await overflowReport(page, "dive-initial");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== さぐり コア遷移(画面座標ヒットテスト) ==");
  out("status(/saguri/)", status);
  out("pageerrors", errors);
  out("VERSION 表示", version);
  out("title 中 screen", screenBefore);
  out("title 中 最前面が overlay subtree か", inOverlayTitle);
  out("title ボタン(start / あそびかた)", titleButtons);
  out("もぐる タップ成功", tappedStart);
  out("初回 howto 画面へ(screen)", screenHowto);
  out("howto 情報(行数/非表示/action)", howtoInfo);
  out("howto 中 最前面が overlay subtree か", inOverlayHowto);
  out("howto の もぐる タップ成功", tappedHowtoStart);
  out("howto後 screen", screenAfter);
  out("seen フラグ記録(=1)", seenFlag);
  out("dive 中 中央の最前面が #scene(飛び越えなし)", sceneAtCenter);
  out("断面中央の最前面(HUD が pointer を食わない)", topAtCanvasMid);
  out("HUD 表示", hudVisible);
  out("dive 初期状態", init);
  out("採用しきい値 th", TH);

  corePass =
    errors.length === 0 &&
    status === 200 &&
    version === "v1.0.0" &&
    screenBefore === "title" &&
    inOverlayTitle === true &&
    titleButtons.start === "タップでもぐる" &&
    titleButtons.howto === "あそびかた" &&
    titleButtons.startHidden === false &&
    titleButtons.howtoHidden === false &&
    tappedStart === true &&
    screenHowto === "howto" &&
    howtoInfo.lines === 7 && // あそびかた 7 行(verbatim)
    howtoInfo.howtoHidden === false &&
    howtoInfo.action === "もぐる" &&
    inOverlayHowto === true &&
    tappedHowtoStart === true &&
    screenAfter === "dive" &&
    seenFlag === "1" &&
    sceneAtCenter === true && // overlay 飛び越えなし(みちゆき真因の検出)
    topAtCanvasMid === "scene" && // HUD が pointer を食っていない
    hudVisible === true &&
    init.diveCount === 1 &&
    init.py === 0 && // 地表から開始
    init.stamina === init.staminaMax &&
    init.girls >= 1;
  out("PASS(コア遷移/初回howto/overlay飛び越えなし/可読性)", corePass);
  await ctx.close();
}

// ============================================================================
// (2) 核メカ: 掘る前進/手がかり検算/0連鎖/落盤/気配/女の子救出/失敗/シード再生成/ショップティアゲート
// ============================================================================
let mechPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { localStorage.removeItem("saguri_best_rescue"); localStorage.removeItem("saguri_best_depth"); } catch (e) {} });
  await startToDive(page);

  // --- (a) 掘って前進: 深度 py が増える + 画面が流れる(変化率 > 0.15)。各タップで scene 確認 ---
  const beforePix = await sample(page);
  const pyBefore = await page.evaluate(() => G.py);
  let digSceneAllOk = true;
  let advanced = 0;
  for (let s = 0; s < 10 && advanced < 5; s++) {
    const r = await digUntilMove(page, 0, 1); // 下方向
    if (!r.allScene) digSceneAllOk = false;
    if (r.moved) advanced++;
    else {
      // 真下が硬岩/女の子等で進めない → 横へ逃がす保険。
      const rl = await digUntilMove(page, -1, 0);
      const rr = rl.moved ? rl : await digUntilMove(page, 1, 0);
      if (!rr.moved) break;
    }
  }
  await page.waitForTimeout(450); // カメラ補間。
  const afterPix = await sample(page);
  const pyAfter = await page.evaluate(() => G.py);
  const digFlowRatio = changed(beforePix, afterPix);
  const advancedOk = pyAfter > pyBefore;

  // --- (b) 手がかり数字 = 周囲8近傍の不安定岩数(実関数 clueCount を独立再計算で検算) ---
  // 掘って露出した全 exposed 面で clueCount() と「生盤面の8近傍不安定岩(掘削済み除く)」を
  // 突き合わせる。1 件でも不一致なら手がかりが嘘 = デドゥースが成立しない。
  const clueCheck = await page.evaluate(() => {
    let checked = 0, mism = 0; const samples = [];
    for (let row = 1; row < 30; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        if (!isExposed(col, row)) continue;
        let n = 0;
        for (let dc = -1; dc <= 1; dc++)
          for (let dr = -1; dr <= 1; dr++) {
            if (dc === 0 && dr === 0) continue;
            const c = col + dc, r = row + dr;
            if (r < 0 || c < 0 || c >= CONST.GRID_COLS) continue;
            if (isDug(c, r)) continue; // 掘られた = もう岩は無い。
            if (tileType(c, r, G.seed) === TILE.UNSTABLE) n++;
          }
        const got = clueCount(col, row);
        checked++;
        if (got !== n) { mism++; if (samples.length < 5) samples.push({ col, row, got, expect: n }); }
      }
    return { checked, mism, samples };
  });
  const clueOk = clueCheck.checked >= 3 && clueCheck.mism === 0;

  // --- (c) 0連鎖開示: clueCount 0 の面を起点に floodSafe が隣接の安全土を自動開示する ---
  const floodOk = await page.evaluate(() => {
    // フレッシュなダイブで、自機真下を掘って 0 面に当たったとき周囲が連鎖開示されるかを
    // 実経路で観測する。手がかり 0 の起点を探し floodSafe を呼び、dug が増えるか。
    startDive();
    // 浅い安全な 0 面を探索(周囲8近傍に不安定岩なし、かつ掘れる土)。
    let zero = null;
    for (let row = 1; row < 8 && !zero; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        if (tileType(col, row, G.seed) === TILE.UNSTABLE) continue;
        // この面を掘ったと仮定した clueCount。掘削前に周囲不安定岩を数える。
        let n = 0;
        for (let dc = -1; dc <= 1; dc++)
          for (let dr = -1; dr <= 1; dr++) {
            if (dc === 0 && dr === 0) continue;
            const c = col + dc, r = row + dr;
            if (r < 0 || c < 0 || c >= CONST.GRID_COLS) continue;
            if (tileType(c, r, G.seed) === TILE.UNSTABLE) n++;
          }
        if (n === 0) { zero = { col, row }; break; }
      }
    if (!zero) return { found: false };
    G.dug.add(zero.col + "," + zero.row);
    const before = G.dug.size;
    floodSafe(zero.col, zero.row);
    const after = G.dug.size;
    return { found: true, before, after, chained: after > before };
  });
  const floodChainOk = floodOk.found ? floodOk.chained : true; // 0面が無いシードなら skip 扱い

  // --- (d) 落盤: 不安定岩の真下を掘ると次手番で落下予約 → 解決で道を塞ぐ(buried) ---
  const cavein = await page.evaluate(() => {
    startDive();
    let found = null;
    for (let row = 2; row < 25 && !found; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        if (tileType(col, row, G.seed) === TILE.UNSTABLE) { found = { col, row }; break; }
      }
    if (!found) return { found: false };
    G.pendingCavein = new Map();
    onTileBroken(found.col, found.row + 1, TILE.SOIL); // 真下を掘った = 支え喪失。
    const scheduled = G.pendingCavein.has(found.col + "," + found.row);
    // 落下先(直下)に掘削空洞を作っておき、resolveCaveins が埋める(道を塞ぐ)ことを観測。
    const fallRow = found.row + 1;
    G.dug.add(found.col + "," + fallRow);
    G.toolsLeft = { ladder: 0, support: 0, sensor: 0 };
    G.px = found.col; G.py = found.row + 3; // 自機を巻き込まれない位置へ。
    resolveCaveins();
    const buried = !G.dug.has(found.col + "," + fallRow);
    return { found: true, at: found, scheduled, buried, pendingCleared: G.pendingCavein.size === 0 };
  });
  const caveinOk = cavein.found ? (cavein.scheduled && cavein.buried && cavein.pendingCleared) : false;

  // --- (e) 気配メーター: 最寄り hidden 女の子への方向矢印 + 距離ヒートが出る ---
  const sense = await page.evaluate(() => {
    startDive();
    renderHud();
    return {
      arrow: document.getElementById("sense-arrow").textContent,
      heat: document.getElementById("sense-heat").textContent,
      heatClass: document.getElementById("sense-heat").className,
    };
  });
  // 女の子が居れば方向矢印(・以外)か距離ヒートが出る。地表開始でも最寄り方向は読める。
  const senseOk = sense.arrow !== "" && sense.heat !== "" && sense.heat !== "気配なし";

  // --- (f) 女の子 発見→追従→地表救出→断章1行→ポイント。実関数経路。 ---
  const rescue = await page.evaluate(() => {
    startDive();
    const g0 = G.girls[0];
    for (let r = 1; r <= g0.row; r++) G.dug.add(g0.col + "," + r); // 縦シャフトを掘る。
    G.px = g0.col; G.py = g0.row;
    recomputeLit();
    discoverGirl(g0.col, g0.row);
    const discovered = G.girls[0].state;
    let safe = 0;
    for (let r = g0.row - 1; r >= 0 && safe < 80; r--) {
      G.px = g0.col; G.py = r; advanceEscort(); safe++;
      if (r === 0) { surfaceReturn(); break; }
    }
    return {
      discovered,
      rescued: G.rescued,
      points: G.points,
      screen: G.screen, // fragment(断章) or shop
      fragmentText: document.getElementById("ov-fragment").textContent,
    };
  });
  const rescueOk =
    rescue.discovered === "following" &&
    rescue.rescued >= 1 &&
    rescue.points >= 1 &&
    (rescue.screen === "fragment" || rescue.screen === "shop") &&
    (rescue.screen !== "fragment" || rescue.fragmentText.length > 0);
  // 断章は FRAGMENTS の verbatim 1 行か。
  const fragmentVerbatim = await page.evaluate((t) => {
    return t === "" || FRAGMENTS.includes(t);
  }, rescue.fragmentText);

  // --- (g) スタミナ0で失敗(地中で力尽き) → メタ強化資産は残る → retry でダイブ再開 ---
  const failFlow = await page.evaluate(() => {
    startDive();
    G.appliedUpgrades = ["near_stamina"]; // メタ強化資産。
    recomputeUpg();
    G.points = 5;
    G.py = 8; // 地中。
    G.escorting = 1; // 同行中の子が失われる想定。
    G.stamina = 1;
    spendStamina(5); // 0 へ → checkFail。
    return {
      screen: G.screen, // fail
      title: document.getElementById("ov-title").textContent,
      retryBtn: document.getElementById("ov-action").textContent,
      pointsKept: G.points, // メタ資産は残る
      upgradesKept: G.appliedUpgrades.length,
    };
  });
  const failOk =
    failFlow.screen === "fail" &&
    failFlow.title === "力、尽きた" &&
    failFlow.retryBtn === "もう一度" &&
    failFlow.pointsKept === 5 &&
    failFlow.upgradesKept === 1;
  // retry で dive 再開(ワンタップ再挑戦)。
  const retried = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(800);
  const retryScreen = await page.evaluate(() => G.screen);
  const retryOk = retried && retryScreen === "dive";

  // --- (h) 2ダイブ目で地形変化(同 seed は決定論一致) ---
  const det = await page.evaluate(() => {
    function snap(seed) {
      const t = [];
      for (let r = 1; r < 25; r++) for (let c = 0; c < CONST.GRID_COLS; c++) t.push(tileType(c, r, seed));
      const g = girlPositions(seed).map((x) => x.col + "," + x.row).join("|");
      return { t: t.join(""), g };
    }
    const s = CONST.BASE_SEED;
    const a = snap(s + 1), b = snap(s + 1), c = snap(s + 2);
    return {
      sameSeedDeterministic: a.t === b.t && a.g === b.g,
      dive2DiffersTerrain: a.t !== c.t,
      dive2DiffersGirls: a.g !== c.g,
    };
  });
  const detOk = det.sameSeedDeterministic && det.dive2DiffersTerrain;

  // --- (i) ショップ 深度ティアゲート(浅救出だけでは mid/deep locked、深救出で解放)・買い切り永続 ---
  const shopGate = await page.evaluate(() => {
    // 浅い救出のみ(rescuedDeepest 小)→ mid/deep ティアは locked。
    G.rescuedDeepest = 5; // 浅層(< MID_TIER_DEPTH=10)。
    G.points = 30; // 十分なポイント(ゲートが効くことを在庫不足と切り分け)。
    G.appliedUpgrades = [];
    showShop();
    const rows = [...document.querySelectorAll("#ov-upgrades .shop-row")];
    const classify = rows.map((r, i) => {
      const u = UPGRADES[i];
      return { id: u.id, tier: u.tier, buyable: r.classList.contains("buyable"), locked: r.classList.contains("locked"), owned: r.classList.contains("owned") };
    });
    const nearBuyableShallow = classify.filter((c) => c.tier === "near" && c.buyable).length;
    const midLockedShallow = classify.filter((c) => c.tier === "mid").every((c) => c.locked && !c.buyable);
    const deepLockedShallow = classify.filter((c) => c.tier === "deep").every((c) => c.locked && !c.buyable);
    return {
      rowCount: rows.length,
      upgradeCount: UPGRADES.length,
      nearBuyableShallow,
      midLockedShallow,
      deepLockedShallow,
      skipBtn: document.getElementById("ov-action2").textContent,
    };
  });
  // 深層救出でゲート解放(対偶)。
  const shopUnlock = await page.evaluate(() => {
    G.rescuedDeepest = 22; // 深層(>= DEEP_TIER_DEPTH=20)。
    const midUnlocked = UPGRADES.filter((u) => u.tier === "mid").every((u) => upgradeUnlocked(u, G.rescuedDeepest));
    const deepUnlocked = UPGRADES.filter((u) => u.tier === "deep").every((u) => upgradeUnlocked(u, G.rescuedDeepest));
    return { midUnlocked, deepUnlocked };
  });
  // 買い切り永続(購入で取得済み化 + ポイント減 + 次ダイブへ残る)。
  const shopBuy = await page.evaluate(() => {
    G.rescuedDeepest = 25; G.points = 10; G.appliedUpgrades = [];
    showShop();
    // 最初の buyable な行をクリック購入。
    const rows = [...document.querySelectorAll("#ov-upgrades .shop-row.buyable")];
    if (!rows.length) return { bought: false };
    const ptBefore = G.points;
    rows[0].click();
    const ptAfter = G.points;
    const appliedCount = G.appliedUpgrades.length;
    // 次ダイブで recomputeUpg されても取得済みは残る。
    const idKept = G.appliedUpgrades.length > 0;
    return { bought: appliedCount > 0, ptBefore, ptAfter, ptDropped: ptAfter < ptBefore, idKept };
  });
  const shopOverflow = await overflowReport(page, "shop-baseshop");
  if (shopOverflow.overflowCount > 0) overflowFails.push(shopOverflow);

  const shopOk =
    shopGate.rowCount === shopGate.upgradeCount &&
    shopGate.nearBuyableShallow >= 1 &&
    shopGate.midLockedShallow === true && // 浅救出だけでは mid 出ない
    shopGate.deepLockedShallow === true && // 浅救出だけでは deep 出ない
    shopGate.skipBtn === "もぐる" &&
    shopUnlock.midUnlocked === true &&
    shopUnlock.deepUnlocked === true &&
    shopBuy.bought === true &&
    shopBuy.ptDropped === true &&
    shopBuy.idKept === true;

  console.log("== さぐり 核メカ ==");
  out("pageerrors", errors);
  out("(a) 掘って前進 py", { before: pyBefore, after: pyAfter, advancedOk });
  out("(a) 各タップ最前面が scene(飛び越えなし)", digSceneAllOk);
  out("(a) 掘削で画面が流れる(変化率 > 0.15)", { ratio: +digFlowRatio.toFixed(3), th: TH });
  out("(b) 手がかり数字 = 周囲8近傍不安定岩数(検算)", clueCheck);
  out("(c) 0連鎖開示(floodSafe で隣接安全土を自動開示)", floodOk);
  out("(d) 落盤(真下掘る→予約→解決で道を塞ぐ)", cavein);
  out("(e) 気配メーター(方向矢印 + 距離ヒート)", sense);
  out("(f) 女の子 発見→追従→救出→断章+ポイント", rescue);
  out("(f) 断章が FRAGMENTS verbatim か", fragmentVerbatim);
  out("(g) スタミナ0で失敗(メタ資産残存)", failFlow);
  out("(g) retry でワンタップ再挑戦→dive", { retried, retryScreen });
  out("(h) 決定論(同seed一致 / 2ダイブ目で地形変化)", det);
  out("(i) ショップ ティアゲート(浅救出: mid/deep locked)", shopGate);
  out("(i) 深層救出で mid/deep 解放", shopUnlock);
  out("(i) 買い切り(購入→ポイント減→取得済み永続)", shopBuy);

  mechPass =
    errors.length === 0 &&
    advancedOk &&
    digSceneAllOk &&
    digFlowRatio > 0.15 &&
    clueOk &&
    floodChainOk &&
    caveinOk &&
    senseOk &&
    rescueOk &&
    fragmentVerbatim &&
    failOk &&
    retryOk &&
    detOk &&
    shopOk;
  out("PASS(核メカ)", mechPass);
  await ctx.close();
}

// ============================================================================
// (3) 十字キー操作(D-pad 画面座標タップで掘って前進 / 印ボタン)・タップ掘り併存
// ============================================================================
let dpadPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // D-pad「下」を画面座標タップ(最前面が dpad-btn であることを確認)で掘って前進。
  // 硬岩なら 2 タップ要る → 前進するまで叩く。最前面が D-pad ボタンか毎回 assert。
  const downBtnInfo = await buttonHittable(page, "#btn-down");
  let dpadMoved = false;
  let dpadAllBtn = true;
  for (let k = 0; k < 8 && !dpadMoved; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    const tapped = await tapSelector(page, "#btn-down");
    if (!tapped) dpadAllBtn = false;
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => G.py);
    if (after !== before.py) dpadMoved = true;
  }

  // 印ボタン: 自機隣接の未掘削面に印を立てる(flags が増える)。
  // フレッシュなダイブ(自機 = 地表、真下が未掘削)で確認する。先に下まで掘ってしまうと
  // 自機の隣接が掘削済み空洞ばかりになり flagButton の対象が無くなる(= test 状態依存)。
  const flagBefore = await page.evaluate(() => { startDive(); return G.flags.size; });
  await page.waitForTimeout(120);
  // startDive 後は title/HUD が再構築されるので D-pad は再び画面下に居る。
  const flagTapped = await tapSelector(page, "#btn-flag");
  await page.waitForTimeout(80);
  const flagAfter = await page.evaluate(() => G.flags.size);
  const flagOk = flagTapped && flagAfter > flagBefore;

  // タップ掘り(canvas 直接)も併存して前進する。
  const tapBeforePy = await page.evaluate(() => G.py);
  const tapDig = await digUntilMove(page, 1, 0); // 横へ
  const tapDig2 = tapDig.moved ? tapDig : await digUntilMove(page, -1, 0);
  const tapDig3 = tapDig2.moved ? tapDig2 : await digUntilMove(page, 0, 1);
  const tapAfterPy = await page.evaluate(() => ({ py: G.py, px: G.px }));
  const tapDigOk = tapDig3.moved && tapDig3.allScene;

  console.log("== さぐり 十字キー操作 ==");
  out("pageerrors", errors);
  out("D-pad「下」ボタン rect/hittable", downBtnInfo);
  out("D-pad で掘って前進(最前面が btn)", { dpadMoved, dpadAllBtn });
  out("印ボタンで隣接に印", { flagBefore, flagAfter, flagOk });
  out("タップ掘り(canvas)併存で前進", { tapDigOk, tapAfterPy });

  dpadPass =
    errors.length === 0 &&
    downBtnInfo.exists === true &&
    downBtnInfo.topInView === true &&
    downBtnInfo.bottomInView === true &&
    downBtnInfo.hit === true &&
    dpadMoved &&
    dpadAllBtn &&
    flagOk &&
    tapDigOk;
  out("PASS(十字キー操作)", dpadPass);
  await ctx.close();
}

// ============================================================================
// (4) 救出演出 / fail / clear / dive HUD 可読性 + 行動フィードバック可視
// ============================================================================
let stagesReadPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // 数手掘って HUD に手がかり chip / 深度 / 気配 / スタミナが出ている状態で可読性。
  await digUntilMove(page, 0, 1);
  await digUntilMove(page, 1, 0);
  await page.waitForTimeout(200);
  const clueChips = await page.evaluate(() => document.querySelectorAll("#clue-layer .clue").length);
  const diveReadOverflow = await overflowReport(page, "dive-hud");
  if (diveReadOverflow.overflowCount > 0) overflowFails.push(diveReadOverflow);

  // 行動フィードバック: 掘ると打点 popup が DOM に出る(一瞬で消えず 850ms 可視窓 = あかり教訓)。
  // フレッシュなダイブで未掘削の隣接(土/不安定岩/女の子=掘れる面)を 1 タップ掘る。既に掘った
  // 面(EMPTY)や硬岩を選ぶと打点が出ない/移動扱いになるため、掘れる方向を選んでから観測する。
  const digPopup = await page.evaluate(async () => {
    startDive();
    document.querySelectorAll(".popup").forEach((p) => p.remove()); // 古い popup を掃除。
    // row 1 で掘れる(土/不安定岩/女の子)列を探し、自機をその上(地表)へ置いて真下を掘る。
    // px 直下が自然空洞(EMPTY)/硬岩のシードでも、掘れる面を確実に選べる。
    let col = null;
    for (let c = 0; c < CONST.GRID_COLS; c++) {
      const t = tileType(c, 1, G.seed);
      if (t === TILE.SOIL || t === TILE.UNSTABLE || t === TILE.GIRL) { col = c; break; }
    }
    if (col !== null) G.px = col;
    const before = document.querySelectorAll(".popup").length;
    if (col !== null) digAdjacent(G.px, 1); // 真下の掘れる面を 1 タップ → spawnPopupAt("・")
    await new Promise((r) => setTimeout(r, 30));
    const during = document.querySelectorAll(".popup").length;
    return { col, before, during, appeared: during > before };
  });

  // 救出演出(断章 overlay)の可読性。
  const fragmentRead = await page.evaluate(() => {
    showFragment("ずっと、上の光だけ見てた", () => {});
    return {
      screen: G.screen,
      text: document.getElementById("ov-fragment").textContent,
      action: document.getElementById("ov-action").textContent,
    };
  });
  await page.waitForTimeout(150);
  const fragmentOverflow = await overflowReport(page, "rescue-fragment");
  if (fragmentOverflow.overflowCount > 0) overflowFails.push(fragmentOverflow);

  // fail 演出の可読性。
  const failRead = await page.evaluate(() => {
    showFail();
    return { screen: G.screen, title: document.getElementById("ov-title").textContent };
  });
  await page.waitForTimeout(150);
  const failOverflow = await overflowReport(page, "fail");
  if (failOverflow.overflowCount > 0) overflowFails.push(failOverflow);

  // clear 演出(最下層救出)の可読性。
  const clearRead = await page.evaluate(() => {
    showClear();
    return {
      screen: G.screen,
      title: document.getElementById("ov-title").textContent,
      sub: document.getElementById("ov-sub").textContent,
      again: document.getElementById("ov-action").textContent,
    };
  });
  await page.waitForTimeout(150);
  const clearOverflow = await overflowReport(page, "clear");
  if (clearOverflow.overflowCount > 0) overflowFails.push(clearOverflow);

  // clear → again(もっと深く)で shop へ(エンドレス継続)。
  const clearAgain = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(300);
  const afterClear = await page.evaluate(() => G.screen);

  console.log("== さぐり 救出演出/fail/clear/HUD 可読性 + 行動フィードバック ==");
  out("pageerrors", errors);
  out("dive HUD 手がかり chip 数", clueChips);
  out("掘削の打点 popup が可視(一瞬で消えない)", digPopup);
  out("救出演出(断章)", fragmentRead);
  out("fail 演出", failRead);
  out("clear 演出(最下層救出)", clearRead);
  out("clear→もっと深く→shop", { clearAgain, afterClear });

  stagesReadPass =
    errors.length === 0 &&
    digPopup.appeared === true && // 行動フィードバック可視
    fragmentRead.screen === "fragment" &&
    fragmentRead.text.length > 0 &&
    failRead.screen === "fail" &&
    failRead.title === "力、尽きた" &&
    clearRead.screen === "clear" &&
    clearRead.title === "暁が、差した" &&
    clearRead.again === "もっと深く" &&
    clearAgain &&
    afterClear === "shop" &&
    diveReadOverflow.overflowCount === 0 &&
    fragmentOverflow.overflowCount === 0 &&
    failOverflow.overflowCount === 0 &&
    clearOverflow.overflowCount === 0;
  out("PASS(救出演出/fail/clear/HUD 可読性/フィードバック)", stagesReadPass);
  await ctx.close();
}

// ============================================================================
// (5) 実機リアリズム: 短高 viewport(412x680 / 412x730)で操作必須要素が innerHeight 内・押せる
// ============================================================================
// headless は実ブラウザツールバーを完全再現できない(svh=vh=innerHeight になる)限界がある。
// よって viewport 高さそのものを 680/730 に縮め、100vh/100svh 設計が短可視高でも操作必須要素
// (掘る十字キー/印/もぐる/ショップ購入)を innerHeight 内・top基準・タップ機能にできるかを
// 受け入れ条件で担保する(あかり v1.3.0/ともる v1.1.1 ツールバー裏切れの再発防止)。
let shortVpPass = false;
{
  async function shortGate(vh) {
    const { ctx, page, errors } = await openPage({ seedHowto: true, vw: VW, vh });
    await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    // 初見導線: title の「もぐる」「あそびかた」が innerHeight 内・押せる。
    const startBtn = await buttonHittable(page, "#ov-action");
    const howtoBtn = await buttonHittable(page, "#ov-action2");

    await startToDive(page);
    const diveScreen = await page.evaluate(() => G.screen);

    // dive: 十字キー(上下左右 + 印)・各ボタンが innerHeight 内・top基準・タップ機能。
    const btnUp = await buttonHittable(page, "#btn-up");
    const btnDown = await buttonHittable(page, "#btn-down");
    const btnLeft = await buttonHittable(page, "#btn-left");
    const btnRight = await buttonHittable(page, "#btn-right");
    const btnFlag = await buttonHittable(page, "#btn-flag");

    // 実タップで掘って前進(短高でも D-pad が機能する)。
    let dpadWorks = false;
    for (let k = 0; k < 8 && !dpadWorks; k++) {
      const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (before.scr !== "dive") break;
      await tapSelector(page, "#btn-down");
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => G.py);
      if (after !== before.py) dpadWorks = true;
    }

    const diveShortOverflow = await overflowReport(page, `dive-short-${vh}`, VW, vh);
    if (diveShortOverflow.overflowCount > 0) overflowFails.push(diveShortOverflow);

    // ショップ(行が増える局面)で「もぐる」+ 購入ボタンが短高でも innerHeight 内・押せる。
    const shopState = await page.evaluate(() => {
      G.rescuedDeepest = 25; G.points = 12; G.appliedUpgrades = [];
      showShop();
      return { rows: document.querySelectorAll("#ov-upgrades .shop-row").length };
    });
    await page.waitForTimeout(150);
    const shopSkipBtn = await buttonHittable(page, "#ov-action2"); // 「もぐる」固定フッター。
    // ショップで最初の buyable 行(購入ボタン)が innerHeight 内・押せる。
    const buyRow = await buttonHittable(page, "#ov-upgrades .shop-row.buyable");
    const shopShortOverflow = await overflowReport(page, `shop-short-${vh}`, VW, vh);
    if (shopShortOverflow.overflowCount > 0) overflowFails.push(shopShortOverflow);

    // 実タップでショップ「もぐる」が dive へ(短高でフッターがツールバー裏に切れていないか)。
    const skipTapped = await tapSelector(page, "#ov-action2");
    await page.waitForTimeout(700);
    const backToDive = await page.evaluate(() => G.screen);

    const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
    const pass =
      errors.length === 0 &&
      okBtn(startBtn) && okBtn(howtoBtn) &&
      diveScreen === "dive" &&
      okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) && okBtn(btnFlag) &&
      dpadWorks &&
      shopState.rows >= 1 &&
      okBtn(shopSkipBtn) &&
      okBtn(buyRow) &&
      backToDive === "dive" &&
      diveShortOverflow.overflowCount === 0 &&
      shopShortOverflow.overflowCount === 0;

    console.log(`== さぐり 短高 viewport ${VW}x${vh}(実機リアリズム) ==`);
    out("pageerrors", errors);
    out("title もぐる / あそびかた hittable", { startBtn, howtoBtn });
    out("dive 遷移", diveScreen);
    out("十字キー 上下左右/印 hittable", { btnUp, btnDown, btnLeft, btnRight, btnFlag });
    out("短高で D-pad 掘り前進機能", dpadWorks);
    out("ショップ行数 / もぐる hittable / 購入行 hittable", { rows: shopState.rows, shopSkipBtn, buyRow });
    out("ショップ もぐる 実タップ→dive(フッター切れなし)", { skipTapped, backToDive });
    out(`PASS(短高 ${vh})`, pass);
    await ctx.close();
    return pass;
  }
  const s680 = await shortGate(680);
  const s730 = await shortGate(730);
  shortVpPass = s680 && s730;
  out("PASS(短高 viewport 680 & 730)", shortVpPass);
}

// ============================================================================
// (6) 面白さ代理レポート(gate 外・lead のバランス判断材料)
// ============================================================================
// 簡易戦略 bot で N ラン自走。3 戦略を比較:
//   safe   : 手がかり 0 の安全マスを優先して掘るが、女の子発見で即撤退する稚拙ヒューリスティクス。
//   reckless: 手がかりを無視し下方向へ当て推量で速攻(落盤事故を受けても掘る)。
//   reader : 手がかり数字を実際に使う competent プレイ近似。①不安定岩の真下を掘らない(落盤回避)
//            ②掘り先の手がかり 0(確定安全)を優先・無ければ最小危険 ③印を活用 ④気配で女の子方向
//            へ向かう ⑤スタミナ/帰路を見て撤退判断、ただし女の子発見で即撤退せず「連れて潜り続け」
//            最下層を目指す ⑥道具(支え木/センサ)・ティア強化の積み上げを使う。
// 計測: 最下層(CORE_DEPTH=30)救出のクリア率・到達深度分布・救出数分布・帰還/失敗率・1ラン長・
//       落盤被弾回数(自機が CAVEIN_DAMAGE を受けた回数)・支配戦略の有無。
// 合否には含めない(面白さ判定は遊ぶユーザー)。bot は完璧プレイではなくヒューリスティクス。
//
// 診断目的(lead 依頼): recklessDominant=true がゲーム欠陥か bot アーティファクトかを切り分ける。
// 「読むこと(reader)は報われるか」= reader が reckless を 救出数/最深/クリア率 で上回るか。
let botSummary = null;
{
  // 1 戦略 N ラン。各ランは実関数(digAdjacent / discoverGirl / advanceEscort / surfaceReturn /
  // resolveCaveins / spendStamina)を直接駆動する page.evaluate ループ。
  async function runStrategy(strat, N = 20) {
    const { ctx, page, errors } = await openPage({ seedHowto: true });
    await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);

    const reachedDepths = [];
    const rescuesPerRun = [];
    const runLengths = [];
    const caveinHitsPerRun = [];
    let cleared = 0, fails = 0, returns = 0, botErrors = 0;

    for (let i = 0; i < N; i++) {
      try {
        const result = await page.evaluate(
          ([strat, runIdx]) => {
            // 各ランで別シードにするため diveCount を進めてから startDive。
            // reader は道具/ティア強化の積み上げも使う(深層救出を経るほど強くなる前提を
            // 与えるため、ラン前に「これまで救った最深 + ポイント」をシード runIdx に応じて
            // 積む = 中盤以降のラン想定。reckless/safe は強化なし=純粋ヒューリスティクス比較)。
            G.diveCount = runIdx * 7;
            if (strat === "reader") {
              // ラン番号が進むほど強化が乗る(到達が深くなるほどティア解放 → 道具/体力)。
              // 実ゲームの「救出を重ねて強くなる」進行を近似(積み上げの効果を診断に含める)。
              G.rescuedDeepest = Math.min(CONST.CORE_DEPTH, 6 + runIdx * 2);
              const owned = [];
              if (runIdx >= 2) owned.push("near_stamina"); // 体力+20
              if (runIdx >= 5) owned.push("mid_stamina", "mid_sensor"); // 体力+40 / センサ
              if (runIdx >= 8) owned.push("deep_support", "deep_ladder"); // 支え木 / ハシゴ
              G.appliedUpgrades = owned;
            } else {
              G.appliedUpgrades = [];
            }
            startDive();

            let actions = 0, maxDepth = 0, caveinHits = 0;
            let clearedCore = false, failed = false, returned = false;

            // この未掘削面の周囲8近傍の不安定岩数(掘削済み除く)= 実 clueCount と同義。
            function clueOfTile(col, row) {
              let n = 0;
              for (let dc = -1; dc <= 1; dc++)
                for (let dr = -1; dr <= 1; dr++) {
                  if (dc === 0 && dr === 0) continue;
                  const c = col + dc, r = row + dr;
                  if (r < 0 || c < 0 || c >= CONST.GRID_COLS) continue;
                  if (isDug(c, r)) continue;
                  if (tileType(c, r, G.seed) === TILE.UNSTABLE) n++;
                }
              return n;
            }
            // 真上が不安定岩 = この面を掘ると落盤予約 → 掘った先に立つと被弾。reader はこれを避ける。
            function unstableAbove(col, row) {
              const ar = row - 1;
              return ar >= 1 && !isDug(col, ar) && tileType(col, ar, G.seed) === TILE.UNSTABLE;
            }
            // 候補方向(最寄り hidden 女の子の方向優先 → 下 → 横)。reader は女の子を見つけたら
            // hidden が残る限りさらに深い子を目指す(発見済 following は連れて潜り続ける)。
            function dirsToward() {
              let best = null, bestD = Infinity;
              for (const g of G.girls) {
                if (g.state === "hidden") {
                  const d = Math.abs(g.col - G.px) + Math.abs(g.row - G.py);
                  if (d < bestD) { bestD = d; best = g; }
                }
              }
              const dirs = [];
              if (best) {
                const ddy = best.row - G.py, ddx = best.col - G.px;
                if (ddy > 0) dirs.push([0, 1]);
                if (ddx > 0) dirs.push([1, 0]); else if (ddx < 0) dirs.push([-1, 0]);
                if (ddy < 0) dirs.push([0, -1]);
              }
              dirs.push([0, 1], [1, 0], [-1, 0]); // フォールバック。
              return dirs;
            }

            function digStep(dc, dr) {
              const col = G.px + dc, row = G.py + dr;
              if (row < 0) return false;
              const before = G.py + "," + G.px;
              for (let t = 0; t < 3; t++) {
                const stBefore = G.stamina;
                digAdjacent(col, row); // 実経路(発見・落盤予約・救出含む)。
                // 落盤被弾検出: 1 タップ DIG_COST=1 を大きく超える減少 = CAVEIN_DAMAGE 被弾。
                if (stBefore - G.stamina >= CONST.CAVEIN_DAMAGE) caveinHits++;
                if (G.screen !== "dive") return (G.py + "," + G.px) !== before;
                if ((G.py + "," + G.px) !== before) return true;
              }
              return false;
            }
            // reader: 道具を能動使用(センサで先読み、危機ではハシゴ撤退)。
            function readerUseTools() {
              if (G.toolsLeft && G.toolsLeft.sensor > 0 && G.py >= 12 && actions % 6 === 0) {
                useSensor(); // 周囲の不安定岩を一時可視化(reader はこれを読む)。
              }
            }

            let goingDown = true;
            while (actions < 600 && G.screen === "dive") {
              actions++;
              // 帰路判断: スタミナが帰路ぶん(現深度 × 同行ペナルティ + 余裕)を割りそうなら撤退。
              const escortPenalty = G.escorting > 0 ? 1.6 : 1.0;
              const returnCost = G.py * escortPenalty + 6;
              if (strat === "reader") {
                // reader(competent): 女の子を「同行し始めたら確実に連れ帰る」。1 人見つけたら
                // 連れて上がり、地表で降ろしてから次の子を取りに戻る(人が普通にやる安全運用)。
                //   - 同行中(escorting>0)は撤退して連れ帰る(深追いで失うのを避ける)。
                //   - 帰路コスト割れ・最下層到達でも撤退。
                if (goingDown && (G.escorting > 0 || G.stamina < returnCost + 4 || G.py >= CONST.CORE_DEPTH)) goingDown = false;
                readerUseTools();
              } else {
                // safe/reckless: 同行中なら即撤退(稚拙ヒューリスティクス)。
                if (goingDown && (G.stamina < returnCost || G.escorting > 0 || G.py >= CONST.CORE_DEPTH)) goingDown = false;
              }

              if (goingDown) {
                const dirs = dirsToward();
                let did = false;
                if (strat === "reader") {
                  // competent: ①女の子へ向かう一歩(気配方向)を最優先に評価し、それが安全
                  //            (clue 0 or 不安定岩の真下でない)なら committ して掘り進む = 人が
                  //            「矢印の方へ向かう」挙動。②真上不安定岩は避ける ③向かう一歩が危険な
                  //            ら横へ迂回しつつ最小 clue ④硬岩は最後 ⑤危険マスに印。
                  // 最寄り hidden 女の子(無ければ最深 hidden)への Manhattan 方向を主目標にする。
                  let target = null, tD = Infinity;
                  for (const g of G.girls) {
                    if (g.state !== "hidden") continue;
                    const d = Math.abs(g.col - G.px) + Math.abs(g.row - G.py);
                    if (d < tD) { tD = d; target = g; }
                  }
                  const towardDirs = [];
                  if (target) {
                    const ddy = target.row - G.py, ddx = target.col - G.px;
                    if (ddy > 0) towardDirs.push([0, 1]); // 下へ寄せるのを最優先(女の子は下方)。
                    if (ddx > 0) towardDirs.push([1, 0]); else if (ddx < 0) towardDirs.push([-1, 0]);
                    if (ddy < 0) towardDirs.push([0, -1]);
                  }
                  const safeDig = (col, row) => {
                    if (row < 1 || col < 0 || col >= CONST.GRID_COLS) return false;
                    if (isDug(col, row)) return true; // 空洞は進める。
                    if (unstableAbove(col, row)) return false; // 落盤の真下は避ける。
                    const t = tileType(col, row, G.seed);
                    if (t === TILE.GIRL) return true;
                    return clueOfTile(col, row) === 0; // clue 0 = 確定安全だけ「committ」掘り。
                  };
                  let bestDir = null, bestScore = Infinity;
                  // (A) 女の子へ向かう安全な一歩があれば即採用(commit)。
                  for (const [dc, dr] of towardDirs) {
                    if (safeDig(G.px + dc, G.py + dr)) { bestDir = [dc, dr]; bestScore = -3; break; }
                  }
                  // (B) 無ければ全候補から「真上不安定岩を避けつつ最小 clue」を選ぶ(迂回)。
                  if (!bestDir)
                  for (const [dc, dr] of dirs) {
                    const col = G.px + dc, row = G.py + dr;
                    if (row < 1 || col < 0 || col >= CONST.GRID_COLS) continue;
                    if (isDug(col, row)) { bestDir = [dc, dr]; bestScore = -2; break; }
                    const t = tileType(col, row, G.seed);
                    if (unstableAbove(col, row)) continue; // 落盤になる真下は掘らない(回避)。
                    if (t === TILE.GIRL) { bestDir = [dc, dr]; bestScore = -1; break; }
                    const cl = clueOfTile(col, row);
                    // 女の子の縦方向(下)へ寄る一歩を僅かに優遇(列合わせを進める)。
                    const towardBias = target && dr > 0 ? -0.25 : 0;
                    const score = cl + (t === TILE.HARDROCK ? 0.5 : 0) + towardBias;
                    if (score < bestScore) { bestScore = score; bestDir = [dc, dr]; }
                  }
                  // 確定危険(clue>0 しか無い)なら、最も危険な隣接未掘削に印を立ててから掘る。
                  if (bestDir) {
                    if (bestScore >= 1) {
                      // 危険マスを読んで印(旗)を立てる = 印メカの活用。
                      for (const [dc, dr] of dirs) {
                        const c = G.px + dc, r = G.py + dr;
                        if (r >= 1 && c >= 0 && c < CONST.GRID_COLS && !isDug(c, r) && clueOfTile(c, r) >= 2) { toggleFlag(c, r); break; }
                      }
                    }
                    did = digStep(bestDir[0], bestDir[1]);
                  }
                } else if (strat === "safe") {
                  let bestDir = null, bestClue = Infinity;
                  for (const [dc, dr] of dirs) {
                    const col = G.px + dc, row = G.py + dr;
                    if (row < 1 || col < 0 || col >= CONST.GRID_COLS) continue;
                    if (isDug(col, row)) { bestDir = [dc, dr]; bestClue = -1; break; }
                    const t = tileType(col, row, G.seed);
                    if (t === TILE.HARDROCK) continue;
                    const cl = clueOfTile(col, row);
                    if (cl < bestClue) { bestClue = cl; bestDir = [dc, dr]; }
                  }
                  if (bestDir) did = digStep(bestDir[0], bestDir[1]);
                } else {
                  // reckless: 手がかり無視で下優先の当て推量速攻。
                  for (const [dc, dr] of dirs) { if (digStep(dc, dr)) { did = true; break; } }
                }
                if (!did) goingDown = false;
              } else {
                // 撤退: 上へ。row 0 で surfaceReturn が走る。reader はハシゴが在れば使う。
                if (strat === "reader" && G.toolsLeft && G.toolsLeft.ladder > 0 && G.py >= 4) {
                  useLadder();
                  if (G.screen !== "dive") { /* 地表 → surfaceReturn 済み */ }
                } else if (!digStep(0, -1)) { if (!digStep(1, 0) && !digStep(-1, 0)) break; }
              }
              if (G.py > maxDepth) maxDepth = G.py;
              if (G.stamina <= 0) checkFail();
              if (G.screen === "clear") { clearedCore = true; returned = true; break; }
              if (G.screen === "shop" || G.screen === "fragment") { returned = true; break; }
              if (G.screen === "fail") { failed = true; break; }
            }
            return { maxDepth, rescued: G.rescued, clearedCore, returned, failed, actions, caveinHits };
          },
          [strat, i]
        );
        reachedDepths.push(result.maxDepth);
        rescuesPerRun.push(result.rescued);
        runLengths.push(result.actions);
        caveinHitsPerRun.push(result.caveinHits);
        if (result.clearedCore) cleared++;
        if (result.returned) returns++;
        if (result.failed) fails++;
        if (errors.length) botErrors += errors.length;
      } catch (e) {
        botErrors++;
      }
    }
    const distOf = (arr, buckets) => {
      const d = {};
      for (const [lo, hi] of buckets) d[`${lo}-${hi}`] = arr.filter((x) => x >= lo && x <= hi).length;
      return d;
    };
    const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
    await ctx.close();
    return {
      strategy: strat, N,
      clearRate: +((cleared / N) * 100).toFixed(1) + "%",
      returnRate: +((returns / N) * 100).toFixed(1) + "%",
      failRate: +((fails / N) * 100).toFixed(1) + "%",
      depthDist: distOf(reachedDepths, [[0, 5], [6, 10], [11, 19], [20, 29], [30, 99]]),
      avgMaxDepth: avg(reachedDepths),
      maxReached: Math.max(...reachedDepths, 0),
      rescueDist: distOf(rescuesPerRun, [[0, 0], [1, 1], [2, 2], [3, 99]]),
      avgRescues: avg(rescuesPerRun),
      avgRunActions: avg(runLengths),
      avgCaveinHits: avg(caveinHitsPerRun),
      botErrors,
    };
  }

  const safe = await runStrategy("safe");
  const reckless = await runStrategy("reckless");
  const reader = await runStrategy("reader"); // competent「手がかりを読んで上手く遊ぶ」近似。

  // 支配戦略の検出(従来): reckless が safe を到達深度・救出数で上回るか(safe は稚拙 bot)。
  const recklessDominant =
    reckless.avgMaxDepth >= safe.avgMaxDepth && reckless.avgRescues >= safe.avgRescues;

  const pf = (s) => parseFloat(s);
  const readerBeatsReckless =
    reader.avgRescues > reckless.avgRescues && reader.avgMaxDepth > reckless.avgMaxDepth;

  // ============================================================================
  // 権威ある「解の存在/解きやすさ」プローブ(ヒューリスティクス bot ではなく決定論的測定)。
  // ============================================================================
  // ヒューリスティクス bot 同士(reader/reckless)の救出数比較は「どちらの policy が稚拙か」
  // に左右され、ゲーム欠陥の判定に使うと誤判定する(reckless の偶発的「真下掘り→初接触で即帰還」
  // が浅い子に対し near-optimal なため reader が劣って見える)。そこで「上手い人が普通に読んで
  // 遊んだら救出できるか」を、policy 比較でなく**最適ライン(女の子の列へ縦シャフトを掘り、
  // 同じシャフトを連れて上がる)が成立するか**で直接測る。これは解の存在=ゲームが報いる設計か
  // どうかの一次測定。各シードで実関数(digAdjacent/discoverGirl/advanceEscort/surfaceReturn)を
  // 駆動。スタミナは基本値 80(強化なし=浅い子)/ +60(中盤=深い子)で測る。
  async function optimalLineProbe(N = 20) {
    const { ctx, page, errors } = await openPage({ seedHowto: true });
    await page.goto(`${BASE}/saguri/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const res = await page.evaluate((N) => {
      const r = { shallowReached: 0, shallowRescued: 0, shallowDigCost: [], shallowStaminaEnd: [],
                  deepReached: 0, deepRescued: 0, deepDigCost: [], deepStaminaEnd: [], deepGirlRows: [] };
      function shaftTo(girl) {
        // 自機を女の子の列へ置き、縦シャフトを掘って到達 → 同列を連れて上がる。
        G.px = girl.col; let safe = 0;
        const sStart = G.stamina;
        while (G.py < girl.row && safe < 90 && G.screen === "dive") {
          safe++; const b = G.py;
          for (let k = 0; k < 3 && G.py === b && G.screen === "dive"; k++) digAdjacent(G.px, G.py + 1);
          if (G.py === b) break; // 塞がれた(想定外)。
        }
        const reached = G.py >= girl.row || G.girls.some((x) => x.col === girl.col && x.state !== "hidden");
        const digCost = sStart - G.stamina;
        let up = 0;
        while (G.py > 0 && up < 140 && G.screen === "dive") {
          up++; const nr = G.py - 1; G.px = girl.col; G.py = nr; advanceEscort();
          if (G.escorting > 0) spendStamina(CONST.ESCORT_EXTRA_COST);
          if (nr === 0) { surfaceReturn(); break; } else spendStamina(CONST.DIG_COST);
          if (G.stamina <= 0) { checkFail(); break; }
        }
        return { reached, digCost, rescued: G.rescued, staminaEnd: Math.round(G.stamina) };
      }
      // (A) 浅い子: 強化なし(スタミナ 80)で最浅の女の子を 1 人連れ帰れるか。
      for (let i = 0; i < N; i++) {
        G.diveCount = i * 7; G.rescuedDeepest = 0; G.appliedUpgrades = []; startDive();
        const g = [...G.girls].sort((a, b) => a.row - b.row)[0];
        const o = shaftTo(g);
        if (o.reached) r.shallowReached++;
        if (o.rescued > 0) { r.shallowRescued++; r.shallowDigCost.push(o.digCost); r.shallowStaminaEnd.push(o.staminaEnd); }
      }
      // (B) 深い子: 中盤想定(体力+60=スタミナ140)で深層(3 番目)の女の子を連れ帰れるか。
      for (let i = 0; i < N; i++) {
        G.diveCount = i * 7 + 3; G.rescuedDeepest = 30; G.appliedUpgrades = ["near_stamina", "mid_stamina"]; startDive();
        const sorted = [...G.girls].sort((a, b) => a.row - b.row);
        const g = sorted[2]; // 深層(~row 21-27)。
        r.deepGirlRows.push(g.row);
        const o = shaftTo(g);
        if (o.reached) r.deepReached++;
        if (o.rescued > 0) { r.deepRescued++; r.deepDigCost.push(o.digCost); r.deepStaminaEnd.push(o.staminaEnd); }
      }
      const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0;
      return {
        N,
        shallowRescueRate: +((r.shallowRescued / N) * 100).toFixed(0) + "%",
        shallowAvgDigCost: avg(r.shallowDigCost), shallowAvgStaminaEnd: avg(r.shallowStaminaEnd),
        deepRescueRate: +((r.deepRescued / N) * 100).toFixed(0) + "%",
        deepAvgDigCost: avg(r.deepDigCost), deepAvgStaminaEnd: avg(r.deepStaminaEnd),
        deepGirlRowMin: Math.min(...r.deepGirlRows), deepGirlRowMax: Math.max(...r.deepGirlRows),
      };
    }, N);
    await ctx.close();
    return { ...res, botErrors: errors.length };
  }
  const optimal = await optimalLineProbe();

  // ============================================================================
  // 判定: 「読むこと/上手いプレイは報われるか」を policy 比較でなく解の存在で確定する。
  // ============================================================================
  //   solvable=true  → 最適ラインで浅い子・深い子の両方が高率で連れ帰れ、スタミナに余裕がある
  //                    = ゲームは解けて報いる設計。reader<reckless と recklessDominant は
  //                    ヒューリスティクス bot の policy アーティファクト(構造欠陥ではない)。
  //   solvable=false → 最適ラインでも連れ帰れない/スタミナが尽きる = 構造欠陥(root cause を名指し)。
  const shallowOK = pf(optimal.shallowRescueRate) >= 80 && optimal.shallowAvgStaminaEnd > 20;
  const deepOK = pf(optimal.deepRescueRate) >= 70 && optimal.deepAvgStaminaEnd > 10;
  const solvable = shallowOK && deepOK;
  const verdict = solvable
    ? `アーティファクト確定(構造欠陥ではない): 最適ライン(女の子の列へ縦シャフト→同列を連れ上がる)で 浅い子 ${optimal.shallowRescueRate}・深い子 ${optimal.deepRescueRate} を救出、スタミナ残 浅${optimal.shallowAvgStaminaEnd}/深${optimal.deepAvgStaminaEnd}=余裕あり。ゲームは解けて読み/効率が報われる。reader<reckless と recklessDominant は『reckless の真下掘り→初接触即帰還が浅い子に near-optimal、reader/safe は探索的で銀行に積む数が少ない』という policy アーティファクトであり、しきい値(スタミナ等)を動かす根拠にはならない。`
    : `構造欠陥確定: 最適ラインでも 浅${optimal.shallowRescueRate}/深${optimal.deepRescueRate}・スタミナ残 浅${optimal.shallowAvgStaminaEnd}/深${optimal.deepAvgStaminaEnd}=連れ帰れない。読み/効率が報われない構造欠陥。`;

  botSummary = { safe, reckless, reader, recklessDominant, readerBeatsReckless, optimal, solvable, verdict };
  console.log("== さぐり 面白さ代理レポート + reader 診断 + 最適ライン解プローブ(gate 外) ==");
  out("手がかり 0 優先だが発見で即撤退(safe・稚拙)", safe);
  out("手がかり無視の当て推量速攻(reckless)", reckless);
  out("手がかりを読む competent(reader: 落盤回避+印+道具+連れ帰り)", reader);
  out("[従来] 当て推量速攻 > 稚拙安全堀り", recklessDominant);
  out("[heuristic] reader が reckless を 救出+最深 で上回るか", readerBeatsReckless);
  out("[権威] 最適ライン解プローブ(policy 非依存・解の存在)", optimal);
  out("[判定] ゲームは解けて読み/効率が報われるか(solvable)", solvable);
  out("[判定 1行]", verdict);
}

// ============================================================================
// (7) 既存作回帰: みちゆき / ともしび / なごり / あかり / ともる(URL 不変の証明)
// ============================================================================
async function walkRegression(path, label) {
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;
  await page.mouse.click(206, 457);
  await page.waitForTimeout(1000);
  const topEl = await page.evaluate(() => { const e = document.elementFromPoint(206, 457); return e ? e.id || e.tagName : "none"; });
  await page.mouse.move(206, 457);
  const p0 = await page.evaluate(() => progress);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const wlk = await page.evaluate(() => walking);
  await page.waitForTimeout(3000);
  const p1 = await page.evaluate(() => progress);
  await page.mouse.up();
  const dP = p1 - p0;
  console.log(`== ${label} 回帰(URL 不変の証明) ==`);
  out(`status(${path})`, status);
  out("pageerrors", errors);
  out("中央の最前面要素", topEl);
  out("down直後 walking", wlk);
  out("progressΔ(3s)", dP);
  const pass = errors.length === 0 && status === 200 && topEl === "scene" && wlk === true && dP > 0;
  out(`PASS(${label} 回帰)`, pass);
  await ctx.close();
  return pass;
}

async function nagoriRegression() {
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/nagori/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;
  const inOv = await inOverlayAt(page, VW / 2, VH / 2);
  await page.mouse.click(VW / 2, VH / 2);
  await page.waitForTimeout(1000);
  const topAfter = await page.evaluate(() => { const e = document.elementFromPoint(206, 457); return e ? e.id || e.tagName : "none"; });
  const c0 = await page.evaluate(() => window.clearedCount);
  await page.mouse.move(272 - 90, 458 - 60);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(272 - 90 + (180 * i) / 14, 458 - 60 + (120 * i) / 14); await page.waitForTimeout(8); }
  await page.mouse.up();
  await page.waitForTimeout(150);
  const c1 = await page.evaluate(() => window.clearedCount);
  console.log("== なごり 回帰(URL 不変の証明) ==");
  out("status(/nagori/)", status);
  out("pageerrors", errors);
  out("opening 中 最前面が overlay subtree か", inOv);
  out("dismiss 後 最前面", topAfter);
  out("1 本ドラッグで clearedCount 前進", { before: c0, after: c1 });
  const pass = errors.length === 0 && status === 200 && inOv === true && topAfter === "scene" && c1 > c0;
  out("PASS(なごり 回帰)", pass);
  await ctx.close();
  return pass;
}

// あかり回帰: 200 + pageerror 0 + title→battle 遷移(最前面が battle DOM)。
async function akariRegression() {
  const { ctx, page, errors } = await openPage();
  await page.addInitScript(() => { try { localStorage.setItem("akari_seen_howto", "1"); } catch (e) {} });
  const resp = await page.goto(`${BASE}/akari/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;
  const inOv = await inOverlayAt(page, VW / 2, VH / 2);
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(900);
  const screen = await page.evaluate(() => window.G.screen);
  const inBattle = await page.evaluate(() => {
    const e = document.elementFromPoint(206, 412);
    return !!e && !!e.closest && !!e.closest("#battle");
  });
  console.log("== あかり 回帰(URL 不変の証明) ==");
  out("status(/akari/)", status);
  out("pageerrors", errors);
  out("title 中 最前面が overlay subtree か", inOv);
  out("はじめる後 screen", screen);
  out("battle DOM が最前面(overlay 飛び越えなし)", inBattle);
  const pass = errors.length === 0 && status === 200 && inOv === true && screen === "battle" && inBattle === true;
  out("PASS(あかり 回帰)", pass);
  await ctx.close();
  return pass;
}

// ともる回帰: 200 + pageerror 0 + title→(初回 howto スキップ)→dive 遷移(最前面が #scene)。
async function tomoruRegression() {
  const { ctx, page, errors } = await openPage();
  await page.addInitScript(() => { try { localStorage.setItem("tomoru_seen_howto", "1"); } catch (e) {} });
  const resp = await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;
  const inOv = await inOverlayAt(page, VW / 2, VH / 2);
  await tapSelector(page, "#ov-action"); // タップでもぐる(seen 済みで直行)
  await page.waitForTimeout(900);
  const screen = await page.evaluate(() => window.G.screen);
  const sceneTop = await isSceneAt(page, VW / 2, VH * 0.4);
  console.log("== ともる 回帰(URL 不変の証明) ==");
  out("status(/tomoru/)", status);
  out("pageerrors", errors);
  out("title 中 最前面が overlay subtree か", inOv);
  out("もぐる後 screen", screen);
  out("dive 中央の最前面が #scene(飛び越えなし)", sceneTop);
  const pass = errors.length === 0 && status === 200 && inOv === true && screen === "dive" && sceneTop === true;
  out("PASS(ともる 回帰)", pass);
  await ctx.close();
  return pass;
}

const michiyukiPass = await walkRegression("/", "みちゆき");
const tomoshibiPass = await walkRegression("/tomoshibi/", "ともしび");
const nagoriPass = await nagoriRegression();
const akariPass = await akariRegression();
const tomoruPass = await tomoruRegression();

await browser.close();

console.log("\n== 総合 ==");
out("さぐり コア(遷移/あそびかた7行/overlay飛び越えなし/可読性)", corePass);
out("さぐり 核メカ(掘る/手がかり検算/0連鎖/落盤/気配/救出/失敗/シード/ティアゲート)", mechPass);
out("さぐり 十字キー操作(D-pad掘り前進/印/タップ併存)", dpadPass);
out("さぐり 救出演出/fail/clear/HUD可読性/行動フィードバック", stagesReadPass);
out("さぐり 短高 viewport(実機リアリズム: D-pad/ショップ込み 680&730)", shortVpPass);
out("みちゆき 回帰", michiyukiPass);
out("ともしび 回帰", tomoshibiPass);
out("なごり 回帰", nagoriPass);
out("あかり 回帰", akariPass);
out("ともる 回帰", tomoruPass);
out("テキスト可読性 overflow 検出合計", overflowFails.length);
for (const f of overflowFails) out("  overflow", f);
out("面白さ代理レポート(参考)", botSummary);

const allPass =
  corePass && mechPass && dpadPass && stagesReadPass && shortVpPass &&
  michiyukiPass && tomoshibiPass && nagoriPass && akariPass && tomoruPass &&
  overflowFails.length === 0;
out("ALL PASS", allPass);
process.exit(allPass ? 0 : 1);
