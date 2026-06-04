// ともる 実機相当デバッグ + みちゆき/ともしび/なごり/あかり 回帰。
// リアルタイム採掘/精錬サバイバル(縦坑ダイブ)。灯量=視界=酸素=帰路の三位一体。
// 文字・灯量バー・鉱石カウント・強化3択は全て DOM(なごり「文字がはみ出して読めない」
// 真因の直接対策)。canvas には縦坑断面(タイル矩形 + per-tile ライティング + 視界円)のみ。
//
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す。
// 掘る/灯まきの操作は canvas が pointerdown/up で受けるが、送る前に必ず
// elementFromPoint で最前面が #scene(=overlay を飛び越えていない)であることを assert する
// (overlay が残って pointer を食っていればここで落ちる = みちゆき真因の検出器)。
// viewport 412x915。短高 viewport(412x680/730)gate は別 section。
//
// 検証項目(ともる):
//   1. /tomoru/ 200 + pageerror 0。title→(初回 howto)→もぐる=dive 遷移。
//      dive 中の最前面が #scene(overlay 飛び越えなし)。
//   2. 核メカ: 隣接タップで掘る(深度=py が増える/掘ると前進・画面が流れる)、長押しで灯を
//      撒く(灯数+1・灯量が LANTERN_COST 減)、時間経過で灯量減(深いほど速い)、鉱石取得
//      (深度帯で iron/cryst/core が変わる)、地表帰還で精錬+強化3択、鉱石ティアゲート
//      (結晶/コア在庫0なら cryst/core ティア強化が3択に出ない=浅場ピストン無効化)、
//      灯量0でダイブ失敗(未精錬鉱石ロスト・強化資産は残る)、2ダイブ目で地形が変わる
//      (決定論シード再生成)。
//   3. テキスト可読性: title/howto/dive HUD/強化3択/失敗/勝利 で全テキスト・数値・鉱石
//      カウント・強化カードの bounding rect が 412x915 内に収まりはみ出し 0。
//   4. 実機リアリズム: 短高 viewport(412x680/730)で灯量バー・あそびかた/強化ボタン・
//      帰路目盛りが innerHeight 内に収まり押せる。初見導線(howto 3 行)が可視。行動の
//      フィードバック(掘った打点 popup・灯 cue・喰らい闇の灯量吸い)が見える。
//   5. 既存作回帰: /・/tomoshibi/・/nagori/・/akari/ が 200・pageerror 0・コア操作前進。
//   6. (gate 外)簡易戦略 bot で到達最深度分布/帰還成功率/鉱石ロスト率/1ダイブ長 + 支配戦略
//      検出(灯を撒く vs 撒かず即帰還)。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47831";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const VW = 412;
const VH = 915;

// ---- canvas 背景の RGB サンプリング(16px グリッド、michiyuki/nagori/akari と同手法) ----
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

// 明暗変化率しきい値 th(ともる初回基準を実測で確定。他作の th=48 は流用しない)。
// ともるの canvas は深度帯の暗い地色(surface #2a3550 → deep #05030a)に per-tile
// ライティング(視界円 + 撒いた灯)を重ね、自機追従でカメラがスクロールする。掘って前進
// すると縦坑全面が 1 タイル分流れ、可視タイルの地色・明度が総入れ替わりする。
// 初回実測(dive・自機を下へ 6 回掘って前進、カメラ補間後)の th 曲線:
//   th=8 →54.5%, 16→51.9%, 24→48.4%, 32→46.0%, 48→39.7%, 64→33.0%, 96→20.9%, 128→13.1%
// 対照(操作なし 0.5s = 灯量減衰の微小明度変化のみ)は全 th で 0.0%。
// 暗背景ゲームなので akari(明背景含む)より絶対値は小さいが、掘削前進は全 th で 13%超、
// 静止対照は 0%。th=32 を採用(前進 46.0% / 対照 0.0% を綺麗に分離)、合格条件 ratio>0.15
// (対照 0% を大きく上回り、前進 46% で十分上回る)。
// (この th は新ゲームの初回計測基準であり、同一バグへの 2 周目の場当たり調整ではない)
const TH = 32;
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

// seedHowto=true なら tomoru_seen_howto=1 を navigation 前に仕込み、初回 howto をスキップ。
// vw/vh で短高 viewport を再現できる(v1.3.0 ツールバー切れ対策の gate 用)。
async function openPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.vw || VW, height: opts.vh || VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  if (opts.seedHowto) {
    await ctx.addInitScript(() => { try { localStorage.setItem("tomoru_seen_howto", "1"); } catch (e) {} });
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

// 画面座標タップ(overlay ボタン用。可視中心へ move→click。最前面が想定要素であることを確認)。
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
// 戻り値: { tappedScene: 最前面が scene だったか, pt }
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
// 岩は 3 タップ要るので最大 maxTaps 回繰り返す。各タップで最前面 scene を確認し、
// overlay 飛び越えが 1 度でもあれば false を返す。
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

// 自機タイル中心で長押し = 灯を撒く(LONGPRESS_MS=320 + 移動小)。送る前に最前面 scene を確認。
async function longPressLantern(page) {
  const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const pt = await tileCenter(page, cur.px, cur.py);
  const onScene = await isSceneAt(page, pt.x, pt.y);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.waitForTimeout(420); // LONGPRESS_MS=320 を超える。移動なし。
  await page.mouse.up();
  await page.waitForTimeout(60);
  return onScene;
}

// title → (初回 howto なら はじめる) → dive まで進める。
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

// ---- 可読性アサート: 全テキスト/数値要素が viewport 内に完全に収まるか ----------
async function overflowReport(page, label, vw = VW, vh = VH) {
  return page.evaluate(([lbl, vw, vh]) => {
    const sels = [
      // overlay
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2",
      "#ov-howto", "#ov-howto .howto-line",
      "#ov-upgrades", "#ov-upgrades .upg-card", "#ov-upgrades .upg-card *",
      // HUD
      "#depth-val", ".ore", ".ore *", ".light-cap", ".light-val",
      ".light-rail", ".light-bar", "#return-mark", "#hud-hint",
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
  const resp = await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
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
  const seenFlag = await page.evaluate(() => localStorage.getItem("tomoru_seen_howto"));

  // dive 遷移後、画面中央(自機付近)の最前面が #scene(overlay 飛び越えなし)。
  const sceneAtCenter = await isSceneAt(page, VW / 2, VH * 0.4);
  // HUD 領域(灯量バー付近)で HUD が pointer を食っていない(canvas が掘り操作を受ける)。
  const topAtBar = await topElAt(page, 18, VH * 0.5);

  const init = await page.evaluate(() => ({
    screen: G.screen, diveCount: G.diveCount, py: G.py, px: G.px,
    light: G.light, lightMax: G.lightMax,
    pending: G.pending,
  }));
  const hudVisible = await page.evaluate(() => !document.getElementById("hud").hidden);
  const diveOverflow = await overflowReport(page, "dive-initial");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== ともる コア遷移(画面座標ヒットテスト) ==");
  out("status(/tomoru/)", status);
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
  out("灯量バー付近の最前面(HUD が pointer を食わない)", topAtBar);
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
    howtoInfo.lines === 3 && // あそびかた 3 行(fragments.js)
    howtoInfo.howtoHidden === false &&
    howtoInfo.action === "もぐる" &&
    inOverlayHowto === true &&
    tappedHowtoStart === true &&
    screenAfter === "dive" &&
    seenFlag === "1" &&
    sceneAtCenter === true && // overlay 飛び越えなし(みちゆき真因の検出)
    topAtBar === "scene" && // HUD が pointer を食っていない
    hudVisible === true &&
    init.diveCount === 1 &&
    init.py === 0 && // 地表から開始
    init.light === init.lightMax &&
    init.lightMax === 100; // LIGHT_MAX
  out("PASS(コア遷移/初回howto/overlay飛び越えなし/可読性)", corePass);
  await ctx.close();
}

// ============================================================================
// (2) 核メカ: 掘る前進/灯まき/灯量減衰/鉱石取得/精錬+強化/ティアゲート/失敗/シード再生成
// ============================================================================
let mechPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  // best をリセット(後の確認の純度を上げる)。
  await page.evaluate(() => { try { localStorage.removeItem("tomoru_best_depth"); localStorage.removeItem("tomoru_best_smelt"); } catch (e) {} });
  await startToDive(page);

  // --- (a) 掘って前進: 深度 py が増える + 画面が流れる(変化率 > 0.15)。各タップで scene 確認 ---
  const beforePix = await sample(page);
  const pyBefore = await page.evaluate(() => G.py);
  let digSceneAllOk = true;
  let advanced = 0;
  for (let s = 0; s < 8 && advanced < 5; s++) {
    const r = await digUntilMove(page, 0, 1); // 下方向
    if (!r.allScene) digSceneAllOk = false;
    if (r.moved) advanced++;
    else break; // 岩 6 連打でも進めない=想定外。下で別方向を試す保険。
  }
  await page.waitForTimeout(450); // カメラ補間。
  const afterPix = await sample(page);
  const pyAfter = await page.evaluate(() => G.py);
  const digFlowRatio = changed(beforePix, afterPix);

  // --- (b) 長押しで灯を撒く: 灯数+1・灯量が effLanternCost 減 ---
  const beforeLamp = await page.evaluate(() => ({ lanterns: G.lanterns.size, light: G.light, cost: Math.max(1, CONST.LANTERN_COST + G.upg.lanternCostAdd) }));
  const lampOnScene = await longPressLantern(page);
  const afterLamp = await page.evaluate(() => ({ lanterns: G.lanterns.size, light: G.light }));
  const lampAdded = afterLamp.lanterns === beforeLamp.lanterns + 1;
  const lampCostOk = Math.abs((beforeLamp.light - afterLamp.light) - beforeLamp.cost) < 0.6;

  // --- (c) 時間経過で灯量が減る(深いほど速い): py>0 で減衰、深い py で effDrain 大 ---
  // 浅い depth と深い depth で同じ経過時間あたりの減少量を比較(実コードの effDrain 経路)。
  const drainShallow = await page.evaluate(async () => {
    G.py = 3; G.light = 90;
    const b = G.light;
    await new Promise((r) => setTimeout(r, 800));
    return b - G.light;
  });
  const drainDeep = await page.evaluate(async () => {
    G.py = 30; G.light = 90;
    const b = G.light;
    await new Promise((r) => setTimeout(r, 800));
    return b - G.light;
  });
  const drainDeeperFaster = drainDeep > drainShallow && drainShallow > 0;

  // --- (d) 鉱石取得が深度帯で変わる: 浅=iron / 中=cryst / 深=core を pending へ計上 ---
  // onTileBroken を実コードで通すため、自機を各帯へ置き、隣接に鉱石を仕込んで掘る…のは
  // 決定論地形依存で不安定。代わりに各帯の決定論 tileType を直接読み、帯ごとに採れる鉱石種が
  // 正しい(iron/cryst/core)ことを確認 + onTileBroken の実経路で pending が種別に積まれること
  // を 1 ケース実観測する。
  const tierMap = await page.evaluate(() => {
    // 各帯から鉱石タイルを 1 つ決定論探索し、種別が帯に整合するか。
    function findOre(rowFrom, rowTo) {
      for (let row = rowFrom; row <= rowTo; row++)
        for (let col = 0; col < CONST.GRID_COLS; col++) {
          const t = tileType(col, row, G.seed);
          if (t === TILE.IRON || t === TILE.CRYST || t === TILE.CORE) return { row, col, t };
        }
      return null;
    }
    const shallow = findOre(1, 12);
    const mid = findOre(13, 26);
    const deep = findOre(27, 39);
    return {
      shallowIsIron: shallow ? shallow.t === TILE.IRON : null,
      midIsCryst: mid ? mid.t === TILE.CRYST : null,
      deepIsCore: deep ? deep.t === TILE.CORE : null,
    };
  });
  // onTileBroken 実経路で iron が pending.iron へ積まれることを観測。
  const oreBrokeReal = await page.evaluate(() => {
    G.pending = { iron: 0, cryst: 0, core: 0 };
    const before = G.pending.iron;
    onTileBroken(G.px, 5, TILE.IRON); // 実コードの鉱石計上経路。
    return { before, after: G.pending.iron, gainedIron: G.pending.iron > before };
  });

  // --- (e) 地表帰還で精錬 + 強化3択。鉱石ティアゲート(結晶/コア在庫0で cryst/core 出ない) ---
  // pending に鉄だけ持たせて surfaceReturn → upgrade 画面。3 択が全て iron ティアであること。
  const upgradeGate = await page.evaluate(() => {
    G.stock = { iron: 0, cryst: 0, core: 0 };
    G.pending = { iron: 5, cryst: 0, core: 0 };
    G.py = 0;
    G.gotCore = false;
    surfaceReturn(); // 実経路: 精錬(stock へ)→ showUpgrade。
    const cards = [...document.querySelectorAll("#ov-upgrades .upg-card")];
    const tiers = cards.map((c) => c.querySelector(".upg-tier").className.replace("upg-tier ", ""));
    return {
      screen: G.screen,
      stockIron: G.stock.iron, // 5 精錬されたか
      cardCount: cards.length,
      tiers,
      anyNonIron: tiers.some((t) => t !== "iron"),
    };
  });
  const upgradeOverflow = await overflowReport(page, "upgrade-3choice");
  if (upgradeOverflow.overflowCount > 0) overflowFails.push(upgradeOverflow);

  // 結晶在庫を持たせると cryst ティアが解放され 3 択に現れる(ゲートの対偶確認)。
  const crystUnlocks = await page.evaluate(() => {
    G.stock = { iron: 5, cryst: 3, core: 0 };
    const unlocked = UPGRADES.filter((u) => upgradeUnlocked(u, G.stock));
    return {
      crystUnlockedNow: unlocked.some((u) => u.tier === "cryst"),
      coreStillLocked: !unlocked.some((u) => u.tier === "core"), // core 在庫 0 なので core ティアは未解放
    };
  });

  // 強化を 1 つ取って次ダイブ開始 → 強化が反映されたか(初期灯量+ なら lightMax 増)。
  const upgradeApplied = await page.evaluate(() => {
    G.stock = { iron: 10, cryst: 0, core: 0 };
    G.appliedUpgrades = [];
    const u = UPGRADES.find((x) => x.id === "iron_lightmax"); // 初期灯量+15
    for (const k in u.cost) G.stock[k] -= u.cost[k];
    G.appliedUpgrades.push(u.id);
    recomputeUpg();
    return { lightMax: G.lightMax, expected: CONST.LIGHT_MAX + 15 };
  });

  // --- (f) 灯量0でダイブ失敗: 未精錬鉱石ロスト・強化資産(stock/appliedUpgrades)は残る ---
  const failCase = await page.evaluate(() => {
    G.screen = "dive";
    G.py = 12; // 地表でない
    G.pending = { iron: 4, cryst: 1, core: 0 };
    G.stock = { iron: 7, cryst: 2, core: 1 };
    const appliedBefore = G.appliedUpgrades.length;
    G.light = 0;
    checkFail(); // 実経路: light<=0 && py>0 → showFail(pending 全ロスト)。
    return {
      screen: G.screen,
      pendingLost: G.pending.iron === 0 && G.pending.cryst === 0 && G.pending.core === 0,
      stockKept: G.stock.iron === 7 && G.stock.cryst === 2 && G.stock.core === 1,
      upgradesKept: G.appliedUpgrades.length === appliedBefore,
      action: document.getElementById("ov-action").textContent,
    };
  });
  const failOverflow = await overflowReport(page, "fail");
  if (failOverflow.overflowCount > 0) overflowFails.push(failOverflow);

  // --- (g) 2 ダイブ目で地形が変わる(決定論シード再生成 seed=BASE_SEED+diveCount) ---
  const seedRegen = await page.evaluate(() => {
    const seed1 = CONST.BASE_SEED + 1;
    const seed2 = CONST.BASE_SEED + 2;
    let diff = 0, total = 0;
    for (let row = 1; row <= 30; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        total++;
        if (tileType(col, row, seed1) !== tileType(col, row, seed2)) diff++;
      }
    return { diffTiles: diff, total, changedRatio: +(diff / total).toFixed(3), deterministic: tileType(3, 5, seed1) === tileType(3, 5, seed1) };
  });

  console.log("== ともる 核メカ ==");
  out("掘って前進: py", { before: pyBefore, after: pyAfter });
  out("掘削中 全タップで最前面が #scene(飛び越えなし)", digSceneAllOk);
  out("掘って前進: 画面変化率(th=32)", +(digFlowRatio * 100).toFixed(1) + "%");
  out("長押し灯まき: 最前面が #scene", lampOnScene);
  out("灯まき: 灯数+1", { before: beforeLamp.lanterns, after: afterLamp.lanterns, cost: beforeLamp.cost });
  out("灯まき: 灯量が cost ぶん減った", { lightBefore: +beforeLamp.light.toFixed(1), lightAfter: +afterLamp.light.toFixed(1), lampCostOk });
  out("灯量減衰: 浅(py3) vs 深(py30) の 0.8s 減少量", { shallow: +drainShallow.toFixed(2), deep: +drainDeep.toFixed(2), deeperFaster: drainDeeperFaster });
  out("鉱石ティア帯整合(浅iron/中cryst/深core)", tierMap);
  out("鉱石取得 実経路で pending.iron 増", oreBrokeReal);
  out("地表帰還: 精錬+強化3択, ティアゲート(鉄のみ→全iron)", upgradeGate);
  out("強化3択 可読性 overflow", upgradeOverflow.overflowCount);
  out("結晶在庫で cryst 解放/core は据置ロック", crystUnlocks);
  out("強化適用: 初期灯量+15 で lightMax 増", upgradeApplied);
  out("灯量0で失敗: pendingロスト/stock・強化は残る", failCase);
  out("失敗画面 可読性 overflow", failOverflow.overflowCount);
  out("2ダイブ目で地形変化(シード再生成)", seedRegen);

  mechPass =
    errors.length === 0 &&
    pyAfter > pyBefore && // 掘って深度が増えた
    digSceneAllOk === true && // 掘りタップが全て canvas に届いた(overlay/HUD 飛び越えなし)
    digFlowRatio > 0.15 && // 画面が流れた(対照 0% を大きく上回る)
    lampOnScene === true &&
    lampAdded === true && // 灯数+1
    lampCostOk === true && // 灯量が cost ぶん減った
    drainDeeperFaster === true && // 深いほど灯量減衰が速い
    tierMap.shallowIsIron === true &&
    tierMap.midIsCryst === true &&
    tierMap.deepIsCore === true &&
    oreBrokeReal.gainedIron === true &&
    upgradeGate.screen === "upgrade" &&
    upgradeGate.stockIron === 5 && // 精錬された
    upgradeGate.cardCount === 3 &&
    upgradeGate.anyNonIron === false && // 鉄のみ在庫 → 3 択は全 iron ティア(ゲート機能)
    upgradeOverflow.overflowCount === 0 &&
    crystUnlocks.crystUnlockedNow === true && // 結晶在庫で cryst 解放(対偶)
    crystUnlocks.coreStillLocked === true && // コア在庫 0 で core は未解放
    upgradeApplied.lightMax === upgradeApplied.expected && // 強化が次ダイブに反映
    failCase.screen === "fail" &&
    failCase.pendingLost === true && // 未精錬鉱石ロスト
    failCase.stockKept === true && // 在庫は残る
    failCase.upgradesKept === true && // 強化資産は残る
    failCase.action === "もう一度" &&
    failOverflow.overflowCount === 0 &&
    seedRegen.diffTiles > 0 && // 2 ダイブ目で地形が変わる
    seedRegen.deterministic === true; // 同 seed は同結果(決定論)
  out("PASS(核メカ: 掘る/灯/減衰/鉱石/精錬強化/ティアゲート/失敗/シード)", mechPass);
  await ctx.close();
}

// ============================================================================
// (2-cont) 勝利経路: コア大鉱脈を掘り当てて地表へ → clear。+ clear/howto可読性。
// ============================================================================
let clearPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // コア大鉱脈を掘り当てた状態(gotCore)を実経路で作り、地表帰還 → clear。
  const clearState = await page.evaluate(() => {
    // onTileBroken(COREBIG) 実経路で gotCore を立てる。
    G.pending = { iron: 0, cryst: 0, core: 0 };
    onTileBroken(G.px, 40, TILE.COREBIG); // 実経路: gotCore=true, pending.core += 3。
    const gotCore = G.gotCore;
    const coreAdded = G.pending.core;
    G.py = 0;
    surfaceReturn(); // gotCore → showClear → showOverlay(rAF で .visible 付与)。
    return { gotCore, coreAdded, screen: G.screen, title: document.getElementById("ov-title").textContent, action: document.getElementById("ov-action").textContent };
  });
  // showOverlay は requestAnimationFrame で .visible を付ける。付与前は overlay が
  // pointer-events:none で elementFromPoint が overlay を返さないため、付与完了を待つ。
  await page.waitForFunction(() => document.getElementById("overlay").classList.contains("visible"), { timeout: 3000 });
  const inOverlayClear = await inOverlayAt(page, VW / 2, VH / 2);
  const clearOverflow = await overflowReport(page, "clear");
  if (clearOverflow.overflowCount > 0) overflowFails.push(clearOverflow);

  // 勝利後「もっと深く」→ 強化画面でエンドレス継続(コア在庫があるので core ティアも解放)。
  const afterAgain = await page.evaluate(() => {
    // clear 画面の action は showUpgrade を呼ぶ。
    document.getElementById("ov-action").onclick();
    return { screen: G.screen };
  });

  console.log("== ともる 勝利経路(コア持ち帰り → clear) ==");
  out("コア大鉱脈 onTileBroken で gotCore", clearState);
  out("clear 中 最前面が overlay subtree か", inOverlayClear);
  out("clear 可読性 overflow", clearOverflow.overflowCount);
  out("もっと深く → 強化画面へ", afterAgain);

  clearPass =
    errors.length === 0 &&
    clearState.gotCore === true &&
    clearState.coreAdded === 3 && // コア大鉱脈は 3 ぶん
    clearState.screen === "clear" &&
    clearState.title === "暁が、差した" &&
    clearState.action === "もっと深く" &&
    inOverlayClear === true &&
    clearOverflow.overflowCount === 0 &&
    afterAgain.screen === "upgrade"; // エンドレス継続
  out("PASS(勝利経路 + clear 可読性)", clearPass);
  await ctx.close();
}

// ============================================================================
// (2-cont) 喰らい闇: 掘って露出 → 灯量を吸う(MAW_DRAIN) → 灯で打ち消す。行動フィードバック。
// ============================================================================
let mawPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // revealMaw 実経路: 灯量が MAW_DRAIN 減る + warn cue + maws へ登録。
  const mawReveal = await page.evaluate(() => {
    G.py = 20; G.light = 80; G.maws = new Set();
    const before = G.light;
    revealMaw(G.px + 1, G.py); // 実経路。
    const hint = document.getElementById("hud-hint");
    return {
      lightBefore: before, lightAfter: G.light,
      drained: before - G.light,
      mawCount: G.maws.size,
      hintShown: !hint.hidden, hintText: hint.textContent,
    };
  });
  // 灯で打ち消す: 近接 maw を dropLantern が消す(光を割いて対処)。
  const mawDispel = await page.evaluate(() => {
    G.light = 80; // 灯まきに足りる
    const mc = G.px + 1, mr = G.py;
    G.maws = new Set([mc + "," + mr]);
    G.lanterns = new Set();
    dropLantern(); // 実経路: 近接 maw を打ち消す。
    return { mawCountAfter: G.maws.size, lanternAdded: G.lanterns.size === 1 };
  });
  // 掘った打点 popup(行動フィードバック)が DOM に出る。
  const popupSeen = await page.evaluate(async () => {
    G.screen = "dive"; G.busy = false; G.py = 5; G.px = 3;
    const c0 = document.querySelectorAll(".popup").length;
    spawnPopupAt(3, 5, "・"); // 掘った手応えの打点。
    const c1 = document.querySelectorAll(".popup").length;
    return { before: c0, after: c1, gained: c1 > c0 };
  });

  console.log("== ともる 喰らい闇 + 行動フィードバック ==");
  out("喰らい闇 露出で灯量を吸う(MAW_DRAIN=25)", mawReveal);
  out("灯で喰らい闇を打ち消す", mawDispel);
  out("掘った打点 popup が出る(フィードバック可視)", popupSeen);

  mawPass =
    errors.length === 0 &&
    mawReveal.drained === 25 && // MAW_DRAIN
    mawReveal.mawCount === 1 &&
    mawReveal.hintShown === true &&
    mawReveal.hintText === "闇にのまれた" &&
    mawDispel.mawCountAfter === 0 && // 打ち消した
    mawDispel.lanternAdded === true &&
    popupSeen.gained === true;
  out("PASS(喰らい闇: 露出/吸光/打ち消し + フィードバック可視)", mawPass);
  await ctx.close();
}

// ============================================================================
// (3+2) dive を実走して各深度帯の HUD 可読性 + 帰路目盛り warn の挙動
// ============================================================================
let diveReadPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // 浅→中→深と深度を進めて各帯で HUD 可読性 + 鉱石カウントを描画させる。
  const readChecks = [];
  for (const depth of [4, 16, 30]) {
    await page.evaluate((d) => {
      G.py = d; G.light = 60;
      G.pending = { iron: 12, cryst: 8, core: 3 }; // 2 桁カウントで折返し確認。
      renderHud();
    }, depth);
    await page.waitForTimeout(80);
    const ov = await overflowReport(page, "dive-depth" + depth);
    readChecks.push({ depth, overflow: ov.overflowCount });
    if (ov.overflowCount > 0) overflowFails.push(ov);
  }

  // 帰路目盛り warn: 残灯量 < 帰路コスト(py*RETURN_COST_K) で赤面。
  const returnWarn = await page.evaluate(() => {
    G.py = 30; G.light = 10; // 帰路コスト 30 > 灯 10 → warn
    renderHud();
    const rail = document.querySelector(".light-rail");
    const mark = document.getElementById("return-mark");
    return { railWarn: rail.classList.contains("warn"), markWarn: mark.classList.contains("warn") };
  });
  const returnSafe = await page.evaluate(() => {
    G.py = 5; G.light = 90; // 帰路コスト 5 < 灯 90 → 安全
    renderHud();
    const rail = document.querySelector(".light-rail");
    return { railWarn: rail.classList.contains("warn") };
  });

  console.log("== ともる dive 各深度帯 HUD 可読性 + 帰路目盛り ==");
  out("各深度帯の HUD overflow", readChecks);
  out("帰路を割ると赤面(warn)", returnWarn);
  out("帰路に余裕があると warn 解除", returnSafe);

  diveReadPass =
    errors.length === 0 &&
    readChecks.every((c) => c.overflow === 0) &&
    returnWarn.railWarn === true &&
    returnWarn.markWarn === true &&
    returnSafe.railWarn === false;
  out("PASS(dive HUD 可読性 + 帰路目盛り warn)", diveReadPass);
  await ctx.close();
}

// ============================================================================
// (4) 実機リアリズム: 短高 viewport(412x680/730)で灯量バー/ボタン/帰路目盛りが可視・機能
// ============================================================================
// 実機バグ対策(あかり v1.3.0): モバイル Chrome のアドレスバーで可視高が縮むと、bottom 基準
// 配置だと最下部要素がツールバー裏に切れる。ともるは .hud/.overlay を top:0 + svh で組んで
// いる。headless は実ツールバーが無く svh=vh=innerHeight になる限界(あかり同様)を理解し、
// 修正後の受け入れ条件「短可視高でも 灯量バー(.light-bar)・帰路目盛り(#return-mark)・
// あそびかた/もぐる/強化ボタンが innerHeight 内・top>=0、ボタンが画面座標タップで機能」を
// 短高 viewport で必須化する。
const SHORT_VIEWPORTS = [
  { vw: 412, vh: 680 },
  { vw: 412, vh: 730 },
];
let shortVpPass = true;
const shortVpFails = [];
const shortVpLog = [];

function fullyVisible(rect, innerH, innerW) {
  if (!rect) return false;
  return rect.top >= -0.5 && rect.bottom <= innerH + 0.5 && rect.left >= -0.5 && rect.right <= innerW + 0.5;
}
async function measureRect(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1) };
  }, sel);
}

for (const VP of SHORT_VIEWPORTS) {
  const tag = `${VP.vw}x${VP.vh}`;
  const { ctx, page, errors } = await openPage({ vw: VP.vw, vh: VP.vh }); // フレッシュ(初回 howto 経由で導線可視も測る)
  await page.goto(`${BASE}/tomoru/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const innerH = await page.evaluate(() => window.innerHeight);
  const innerW = await page.evaluate(() => window.innerWidth);

  // (i) title: もぐる/あそびかた ボタンが innerHeight 内・タップ機能。
  const startRect = await measureRect(page, "#ov-action");
  const howtoBtnRect = await measureRect(page, "#ov-action2");
  const titleOv = await overflowReport(page, `${tag}-title`, VP.vw, VP.vh);
  const startVisible = fullyVisible(startRect, innerH, innerW);
  const howtoBtnVisible = fullyVisible(howtoBtnRect, innerH, innerW);

  // もぐる → 初回 howto(導線可視) → howto 行 3 行が innerHeight 内。
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(500);
  const howtoScreen = await page.evaluate(() => G.screen);
  const howtoOv = await overflowReport(page, `${tag}-howto`, VP.vw, VP.vh);
  const howtoStartRect = await measureRect(page, "#ov-action");
  const howtoStartVisible = fullyVisible(howtoStartRect, innerH, innerW);

  // howto の もぐる → dive。HUD(灯量バー・帰路目盛り・深度・鉱石)が innerHeight 内。
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(800);
  await page.evaluate(() => { G.py = 20; G.light = 50; G.pending = { iron: 9, cryst: 5, core: 2 }; renderHud(); });
  await page.waitForTimeout(80);
  const lightBarRect = await measureRect(page, ".light-bar");
  const lightValRect = await measureRect(page, "#light-val");
  const returnMarkRect = await measureRect(page, "#return-mark");
  const depthRect = await measureRect(page, "#depth-val");
  const diveOv = await overflowReport(page, `${tag}-dive`, VP.vw, VP.vh);
  const barVisible = fullyVisible(lightBarRect, innerH, innerW);
  const valVisible = fullyVisible(lightValRect, innerH, innerW);
  const markVisible = fullyVisible(returnMarkRect, innerH, innerW);
  const depthVisible = fullyVisible(depthRect, innerH, innerW);

  // 強化3択でボタン(そのまま もぐる)とカードが innerHeight 内・タップ機能。
  await page.evaluate(() => { G.stock = { iron: 0, cryst: 0, core: 0 }; G.pending = { iron: 6, cryst: 0, core: 0 }; G.py = 0; G.gotCore = false; surfaceReturn(); });
  await page.waitForTimeout(300);
  const upgScreen = await page.evaluate(() => G.screen);
  const upgOv = await overflowReport(page, `${tag}-upgrade`, VP.vw, VP.vh);
  const skipBtnRect = await measureRect(page, "#ov-action2");
  const skipVisible = fullyVisible(skipBtnRect, innerH, innerW);
  // 「そのまま もぐる」を実タップ → dive へ戻る(短高でボタンが機能)。
  const tappedSkip = await tapSelector(page, "#ov-action2");
  await page.waitForTimeout(400);
  const backToDive = await page.evaluate(() => G.screen);

  const checks = {
    innerH, startVisible, howtoBtnVisible, titleOverflow: titleOv.overflowCount,
    howtoScreen, howtoStartVisible, howtoOverflow: howtoOv.overflowCount,
    barVisible, valVisible, markVisible, depthVisible, diveOverflow: diveOv.overflowCount,
    upgScreen, skipVisible, upgradeOverflow: upgOv.overflowCount, tappedSkip, backToDive,
  };
  const ok =
    errors.length === 0 &&
    startVisible && howtoBtnVisible && titleOv.overflowCount === 0 &&
    howtoScreen === "howto" && howtoStartVisible && howtoOv.overflowCount === 0 &&
    barVisible && valVisible && markVisible && depthVisible && diveOv.overflowCount === 0 &&
    upgScreen === "upgrade" && skipVisible && upgOv.overflowCount === 0 &&
    tappedSkip === true && backToDive === "dive";
  shortVpLog.push({ tag, checks, ok });
  if (!ok) { shortVpPass = false; shortVpFails.push({ tag, checks, errors, titleOv, howtoOv, diveOv, upgOv }); }
  await ctx.close();
}
console.log("== ともる 短高 viewport(実機リアリズム: ツールバー切れ対策) ==");
for (const r of shortVpLog) out(r.tag, r);
out("短高 viewport FAIL 件数", shortVpFails.length);
for (const f of shortVpFails) out("  FAIL", f);
out("PASS(短高 viewport: バー/ボタン/帰路目盛り可視・機能)", shortVpPass);

// ============================================================================
// (6) 面白さ代理レポート(gate 外): 簡易戦略 bot で N ラン → 分布/帰還率/ロスト率/支配戦略
// ============================================================================
let botSummary = null;
{
  const N = 20;

  // strategy: "lantern"(灯を撒きながら潜る) / "piston"(灯を撒かず浅場で即帰還)。
  // bot は実プレイ経路(digAdjacent/dropLantern/surfaceReturn/checkFail)を JS から駆動する。
  // 入力イベントの往復はバランス計測には重いので、ここはゲームロジック関数を直接回す
  // (合否 gate ではない＝面白さの相関指標。操作の実機性は上の gate で担保済み)。
  async function runStrategy(strategy) {
    const reachedDepths = [];
    let returns = 0, fails = 0, oreLostRuns = 0;
    const diveDurations = [];
    let botErrors = 0;
    for (let run = 0; run < N; run++) {
      const { ctx, page, errors } = await openPage({ seedHowto: true });
      try {
        await page.goto(`${BASE}/tomoru/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(120);
        // 記録をリセットしてからダイブ開始(startDive を直接呼ぶ＝howto を挟まずダイブへ)。
        await page.evaluate(() => {
          try { localStorage.removeItem("tomoru_best_depth"); localStorage.removeItem("tomoru_best_smelt"); } catch (e) {}
          G.appliedUpgrades = [];
          G.stock = { iron: 0, cryst: 0, core: 0 };
          startDive();
        });
        await page.waitForTimeout(80);

        // 1 ダイブを strategy に従って自走。実時間の灯量減衰を使うと N×秒かかるので、
        // 灯量減衰は「1 マス掘るごとに effDrain*想定秒」を手動適用してリアルタイム性を縮約する
        // (本番の連続減衰と整合する近似。深いほど速い減衰・帰路コストは実関数で評価)。
        const result = await page.evaluate((strat) => {
          const STEP_SECONDS = 0.9; // 1 アクションあたりの想定経過秒(掘り+移動)。
          let maxDepth = 0;
          let returned = false, failed = false, oreLost = false;
          let actions = 0;
          const targetDepth = strat === "piston" ? 6 : 9999; // piston は浅場で即引き返す。

          function drainStep() {
            if (G.py > 0) {
              const drain = (CONST.BASE_DRAIN + G.py * CONST.DEPTH_DRAIN_K) * G.upg.drainMult;
              G.light = Math.max(0, G.light - drain * STEP_SECONDS);
            }
          }
          // 隣接を掘って前進(下優先、塞がれたら横)。岩は 3 タップ要るので前進するまで
          // 最大 3 回叩く。掘れた=前進したら true。各タップで灯量も減らす(リアルタイム近似)。
          function digStep(dc, dr) {
            const col = G.px + dc, row = G.py + dr;
            if (row < 0) return false;
            const before = G.py + "," + G.px;
            for (let t = 0; t < 3; t++) {
              digAdjacent(col, row); // 実経路(鉱石計上・maw 露出含む)。
              if (G.screen !== "dive") return (G.py + "," + G.px) !== before;
              if ((G.py + "," + G.px) !== before) return true;
              drainStep(); // 余分なタップでも時間は経過する。
            }
            return false;
          }

          let goingDown = true;
          while (actions < 400 && G.screen === "dive") {
            actions++;
            // 帰路チェック: 残灯量が帰路コスト+余裕を割りそうなら引き返す。
            const returnCost = G.py * CONST.RETURN_COST_K;
            const margin = G.py * (CONST.BASE_DRAIN + G.py * CONST.DEPTH_DRAIN_K) * STEP_SECONDS * 1.3;
            if (goingDown && (G.light < returnCost + margin || G.py >= targetDepth)) goingDown = false;

            if (goingDown) {
              // lantern 戦略: 数マスごとに灯を撒く(帰り道)。
              if (strat === "lantern" && G.py > 0 && G.py % 4 === 0 && G.light > CONST.LANTERN_COST + 5) {
                dropLantern();
              }
              if (!digStep(0, 1)) { if (!digStep(1, 0) && !digStep(-1, 0)) { goingDown = false; } }
            } else {
              // 帰還: 上へ。row 0 に着くと surfaceReturn が走る。
              if (!digStep(0, -1)) { if (!digStep(1, 0) && !digStep(-1, 0)) break; }
            }
            if (G.py > maxDepth) maxDepth = G.py;
            drainStep();
            if (G.light <= 0) { checkFail(); }
            // 地表帰還で upgrade/clear に遷移したら 1 ダイブ終了。
            if (G.screen === "upgrade" || G.screen === "clear") { returned = true; break; }
            if (G.screen === "fail") { failed = true; oreLost = (true); break; }
          }
          return { maxDepth, returned, failed, oreLost, actions };
        }, strategy);

        reachedDepths.push(result.maxDepth);
        if (result.returned) returns++;
        if (result.failed) { fails++; oreLostRuns++; }
        diveDurations.push(result.actions * 0.9); // 想定秒。
        if (errors.length) botErrors += errors.length;
      } catch (e) {
        botErrors++;
      }
      try { await ctx.close(); } catch (e) {}
    }
    const dist = {};
    const buckets = [[0,3],[4,6],[7,12],[13,20],[21,30],[31,99]];
    for (const [lo, hi] of buckets) dist[`${lo}-${hi}`] = reachedDepths.filter((d) => d >= lo && d <= hi).length;
    const avg = (arr) => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
    return {
      strategy, N,
      returnRate: +((returns / N) * 100).toFixed(1) + "%",
      failRate: +((fails / N) * 100).toFixed(1) + "%",
      oreLostRate: +((oreLostRuns / N) * 100).toFixed(1) + "%",
      maxDepthDist: dist,
      avgMaxDepth: avg(reachedDepths),
      maxReached: Math.max(...reachedDepths, 0),
      avgDiveSeconds: avg(diveDurations),
      botErrors,
    };
  }

  const lantern = await runStrategy("lantern");
  const piston = await runStrategy("piston");

  // 支配戦略の検出: piston(灯撒かず浅場即帰還)が lantern(灯撒いて深く)より到達深度・帰還率
  // で明確に優位なら単調化リスクとして名指し。判定: piston の到達深度が lantern を上回り、かつ
  // piston の帰還率が同等以上なら「浅場ピストン支配」のフラグ。
  const pistonDominant =
    piston.avgMaxDepth >= lantern.avgMaxDepth &&
    parseFloat(piston.returnRate) >= parseFloat(lantern.returnRate) &&
    piston.maxReached <= lantern.maxReached; // piston は深部に届かないのが健全(届くなら浅場で十分=支配)

  botSummary = { lantern, piston, pistonDominant };
  console.log("== ともる 面白さ代理レポート(gate 外・lead のバランス判断材料) ==");
  out("灯を撒く戦略(lantern)", lantern);
  out("灯撒かず浅場即帰還(piston)", piston);
  out("浅場ピストンが支配的か(単調化リスク)", pistonDominant);
}

// ============================================================================
// (5) 既存作回帰: みちゆき / ともしび / なごり / あかり(同一サーバ・URL 不変の証明)
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
  // 初回 howto をスキップして title→battle 直行。
  await page.addInitScript(() => { try { localStorage.setItem("akari_seen_howto", "1"); } catch (e) {} });
  const resp = await page.goto(`${BASE}/akari/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const status = resp ? resp.status() : 0;
  const inOv = await inOverlayAt(page, VW / 2, VH / 2);
  await tapSelector(page, "#ov-action"); // タップではじめる(seen 済みで直行)
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

const michiyukiPass = await walkRegression("/", "みちゆき");
const tomoshibiPass = await walkRegression("/tomoshibi/", "ともしび");
const nagoriPass = await nagoriRegression();
const akariPass = await akariRegression();

await browser.close();

console.log("\n== 総合 ==");
out("ともる コア(遷移/初回howto/overlay飛び越えなし/可読性)", corePass);
out("ともる 核メカ(掘る/灯/減衰/鉱石/精錬強化/ティアゲート/失敗/シード)", mechPass);
out("ともる 勝利経路(clear)", clearPass);
out("ともる 喰らい闇 + フィードバック可視", mawPass);
out("ともる dive HUD 可読性 + 帰路目盛り", diveReadPass);
out("ともる 短高 viewport(実機リアリズム)", shortVpPass);
out("みちゆき 回帰", michiyukiPass);
out("ともしび 回帰", tomoshibiPass);
out("なごり 回帰", nagoriPass);
out("あかり 回帰", akariPass);
out("テキスト可読性 overflow 検出合計", overflowFails.length);
for (const f of overflowFails) out("  overflow", f);
out("面白さ代理レポート(参考)", botSummary);

const allPass =
  corePass && mechPass && clearPass && mawPass && diveReadPass && shortVpPass &&
  michiyukiPass && tomoshibiPass && nagoriPass && akariPass && overflowFails.length === 0;
out("ALL PASS", allPass);
process.exit(allPass ? 0 : 1);
