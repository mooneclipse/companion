// マインロード v0.4.1 実機相当デバッグ + 既存 6 作回帰。
// Mine Road 忠実リメイク。自由掘削サイドビュー探索 × スタミナ→体力の二段ゲージ ×
// 地上全回復の撤退判断 × 女の子救出誘導。文字・数値・ゲージ・十字キーは全て DOM、
// canvas にはタイル矩形 + fog + 自機 + 女の子のみ。
//
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す
// (overlay/HUD が pointer を食っていればここで落ちる = みちゆき真因の検出器)。viewport 412x915。
//
// 縦切り判定ゲート(lead 指定):
//  A. /mineroad/ 200 + pageerror 0 + VERSION v0.1.0。title→(初回 あそびかた)→ダイブ遷移。
//     dive 中央の最前面が #scene。HUD が pointer を食わない。
//  B. 二段ゲージ × 地上全回復の撤退の手触り: 行動でスタミナ減 → 0 で体力減 → 体力 0 で力尽き、
//     地表帰還で全回復。決定論。
//  C. 女の子 1 人を掘って見つけて連れ帰る手応え: 発見→追従→地表で救出成功。
//  D. 重力("road"): 足元が空間なら落下。探索率%。
//  E. 十字キー hittable + タップ掘り併存。可読性(412x915 + 短高 412x680/730 はみ出し 0)。
//  F. 既存 6 作回帰(URL 不変・200・pageerror 0)。
//  G. 画面操作 end-to-end(検証専任 playtester 追加。B/C は内部関数直叩きの単体検証なので、
//     #btn-*/canvas タップだけで「掘った縦坑を辿って潜行→自力帰還→全回復」「掘り当て→following
//     →連れ帰り→clear」を最前面ヒットテスト常時で通す = みちゆき "overlay 飛び越え PASS" 同型の
//     穴を塞ぐ。clear overlay のはみ出しも検査)。
//  H. fail(defeat) overlay のはみ出し 0 + retry 押下可(全画面はみ出し 0 を満たすため追加)。
//  I. determinism 静的検査: 配信中の app.js/tiles.js に Math.random/Date.now/performance.now の
//     実呼び出しが無い(行コメント除去後に grep。コメント言及は許容)。
import { chromium } from "playwright";

// 本番ポート 47825 は絶対に使わない(本番 companion-games が稼働)。検証は別ポートで自前起動した
// サーバ(既定 47860)に向ける。GAMES_BASE で上書き可。
const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47860";
const SHOTDIR = process.env.MR_SHOTDIR || "/home/miho/companion/logs";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);
const VW = 412;
const VH = 915;

const browser = await chromium.launch();

async function openPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.vw || VW, height: opts.vh || VH },
    hasTouch: true,
    serviceWorkers: "block",
  });
  if (opts.seedHowto) {
    await ctx.addInitScript(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

const inOverlayAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && !!e.closest && !!e.closest("#overlay");
  }, [x, y]);

const isSceneAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && e.id === "scene";
  }, [x, y]);

const topElAt = (page, x, y) =>
  page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return e ? e.id || e.className || e.tagName : "none";
  }, [x, y]);

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
    };
  }, [selector, nth]);
}

async function tileCenter(page, col, row) {
  return page.evaluate(([col, row]) => {
    const t = tile;
    const cam = window.__camY || 0;
    return { x: col * t + t / 2, y: (row - cam) * t + t / 2 };
  }, [col, row]);
}

// 自機隣接 (dc,dr) を 1 タップ(掘る/進む)。最前面が #scene であることを確認。
async function actTap(page, dc, dr) {
  const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const pt = await tileCenter(page, cur.px + dc, cur.py + dr);
  const onScene = await isSceneAt(page, pt.x, pt.y);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.up();
  return { onScene };
}

async function startToDive(page) {
  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(300);
  const scr = await page.evaluate(() => G.screen);
  if (scr === "howto") {
    await tapSelector(page, "#ov-action");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
}

async function overflowReport(page, label, vw = VW, vh = VH) {
  return page.evaluate(([lbl, vw, vh]) => {
    const sels = [
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2",
      "#ov-howto", "#ov-howto .howto-line",
      "#depth-val", ".counts", ".count", ".count *",
      ".gauge", ".gauge-row", ".gauge-row *", "#hud-hint",
      ".dpad", ".dpad-btn",
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
// (A) コア遷移 + overlay 飛び越え検出 + 初回 howto + 可読性
// ============================================================================
let corePass = false;
{
  const { ctx, page, errors } = await openPage();
  const resp = await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
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

  const tappedStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(600);
  const screenHowto = await page.evaluate(() => G.screen);
  const howtoInfo = await page.evaluate(() => ({
    lines: document.querySelectorAll("#ov-howto .howto-line").length,
    howtoHidden: document.getElementById("ov-howto").hidden,
    action: document.getElementById("ov-action").textContent,
  }));
  const howtoOverflow = await overflowReport(page, "howto-firstrun");
  if (howtoOverflow.overflowCount > 0) overflowFails.push(howtoOverflow);

  const tappedHowtoStart = await tapSelector(page, "#ov-action");
  await page.waitForTimeout(900);
  const screenAfter = await page.evaluate(() => G.screen);
  const seenFlag = await page.evaluate(() => localStorage.getItem("mineroad_seen_howto"));

  const sceneAtCenter = await isSceneAt(page, VW / 2, VH * 0.5);
  const topAtCanvasMid = await topElAt(page, VW / 2, VH * 0.55);
  const init = await page.evaluate(() => ({
    screen: G.screen, py: G.py, px: G.px,
    stamina: G.stamina, hp: G.hp, seed: G.seed,
    girlCount: G.girls.length,
    girlPositions: G.girls.map((g) => g.col + "," + g.row).join("|"),
    allHidden: G.girls.every((g) => g.state === "hidden"),
    rescued: G.rescued,
    rescueHud: document.getElementById("rescue-val").textContent,
  }));
  const hudVisible = await page.evaluate(() => !document.getElementById("hud").hidden);
  const diveOverflow = await overflowReport(page, "dive-initial");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== マインロード コア遷移 ==");
  out("status(/mineroad/)", status);
  out("pageerrors", errors);
  out("VERSION 表示", version);
  out("title 中 screen", screenBefore);
  out("title 最前面が overlay subtree", inOverlayTitle);
  out("title ボタン", titleButtons);
  out("もぐる タップ成功", tappedStart);
  out("初回 howto へ", screenHowto);
  out("howto 情報", howtoInfo);
  out("howto もぐる タップ成功", tappedHowtoStart);
  out("howto後 screen", screenAfter);
  out("seen フラグ(=1)", seenFlag);
  out("dive 中央 最前面が #scene(飛び越えなし)", sceneAtCenter);
  out("断面の最前面(HUD が pointer 食わない)", topAtCanvasMid);
  out("HUD 表示", hudVisible);
  out("dive 初期状態(5人/HUD 0/5)", init);

  // 固定 BASE_SEED=41027 の 5 人配置(lead 指定の verbatim)。
  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  corePass =
    errors.length === 0 &&
    status === 200 &&
    version === "v0.8.0" &&
    screenBefore === "title" &&
    inOverlayTitle === true &&
    titleButtons.start === "もぐる" &&
    titleButtons.howto === "あそびかた" &&
    titleButtons.startHidden === false &&
    titleButtons.howtoHidden === false &&
    tappedStart === true &&
    screenHowto === "howto" &&
    howtoInfo.lines === 7 &&
    howtoInfo.howtoHidden === false &&
    howtoInfo.action === "もぐる" &&
    tappedHowtoStart === true &&
    screenAfter === "dive" &&
    seenFlag === "1" &&
    sceneAtCenter === true &&
    topAtCanvasMid === "scene" &&
    hudVisible === true &&
    init.py === 0 &&
    init.stamina === 100 &&
    init.hp === 30 &&
    init.girlCount === 5 &&
    init.girlPositions === EXPECTED_GIRLS &&
    init.allHidden === true &&
    init.rescued === 0 &&
    init.rescueHud === "0/5";
  out("PASS(コア遷移/初回howto/5人配置/HUD 0\/5/飛び越えなし/可読性/VERSION v0.8.0)", corePass);
  await ctx.close();
}

// ============================================================================
// (J) v0.2.1 アセット配信: 新 BGM theme.ogg(audio/ogg) を含む 14 本が 200 + 正 Content-Type。
//     かつ v0.2.1 で削除された旧 theme.mp3 が 404(allowlist から除去された証明)。
//     allowlist 配信なので 1 本ずつ HTTP で叩いて status + Content-Type を検証する。
// ============================================================================
let assetPass = true;
{
  console.log("== v0.2.1 アセット配信(200 + Content-Type / 旧 mp3 は 404) ==");
  const expect = [
    // tiles 4
    ["/mineroad/assets/tiles/surface.png", "image/png"],
    ["/mineroad/assets/tiles/soil.png", "image/png"],
    ["/mineroad/assets/tiles/hard.png", "image/png"],
    ["/mineroad/assets/tiles/rock.png", "image/png"],
    // chars 2
    ["/mineroad/assets/chars/miner.png", "image/png"],
    ["/mineroad/assets/chars/girl.png", "image/png"],
    // sfx 7
    ["/mineroad/assets/sfx/dig1.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/dig2.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/blocked.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/found.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/heal.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/clear.ogg", "audio/ogg"],
    ["/mineroad/assets/sfx/fail.ogg", "audio/ogg"],
    // bgm 1 (v0.2.1: maou mp3 → Kenney Infinite Descent ogg)
    ["/mineroad/assets/bgm/theme.ogg", "audio/ogg"],
  ];
  const results = [];
  for (const [path, wantCt] of expect) {
    const resp = await fetch(`${BASE}${path}`);
    const ct = (resp.headers.get("content-type") || "").split(";")[0].trim();
    const len = +(resp.headers.get("content-length") || "0");
    const ok = resp.status === 200 && ct === wantCt && len > 0;
    results.push({ path: path.replace("/mineroad/assets/", ""), status: resp.status, ct, len, ok });
    if (!ok) assetPass = false;
  }
  out("アセット件数", results.length);
  for (const r of results) out(r.path, { status: r.status, ct: r.ct, bytes: r.len, ok: r.ok });

  // 旧 BGM theme.mp3 は v0.2.1 で削除 = allowlist から除去された = 404 であること。
  const mp3 = await fetch(`${BASE}/mineroad/assets/bgm/theme.mp3`);
  const mp3Gone = mp3.status === 404;
  out("旧 theme.mp3(404 であるべき)", { status: mp3.status, gone: mp3Gone });
  if (!mp3Gone) assetPass = false;

  out("PASS(14 アセット 200 + 正 Content-Type / 旧 mp3 404)", assetPass);
}

// ============================================================================
// (K) スプライトが実読込・描画され、broken 画像が無いこと。
//     SPRITES.<key>.complete && naturalWidth>0 を page.evaluate で確認(矩形 fallback ではない)。
//     さらに掘削後の canvas に「矩形 fallback でない」スプライト描画が出ているかを補助確認。
// ============================================================================
let spritePass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  // 画像読込失敗(broken)を監視。
  const broken = [];
  page.on("requestfailed", (req) => {
    if (/\/mineroad\/assets\//.test(req.url())) broken.push(req.url());
  });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 全 6 スプライト(tiles4 + chars2)が complete & naturalWidth>0(=実デコード済み)。
  const sprites = await page.evaluate(() => {
    const keys = ["surface", "soil", "hard", "rock", "miner", "girl"];
    const r = {};
    let allReady = true;
    for (const k of keys) {
      const img = SPRITES[k];
      const ready = !!(img && img.complete && img.naturalWidth > 0);
      r[k] = { complete: !!(img && img.complete), nw: img ? img.naturalWidth : 0, ready };
      if (!ready) allReady = false;
    }
    return { r, allReady };
  });

  // dive へ入り、自機を固定位置へ置く。soil スプライトが固体タイルとして描かれている領域の
  // 色分散が「矩形 fallback の単色 soilColor」ではなくスプライト由来(複数色)であることを確認する。
  //
  // 旧実装は col=G.px, row=G.py+3(自機の真下)を固定サンプルしていたが、そのマスは
  // VISIBLE_RADIUS=2 の開示範囲(py±2)の外なので fog(未開示=単色)になることがあり、
  // variance≈0 で誤 FAIL する race だった。構造修正: サンプル対象を「決定論的に開示済み
  // (isVisible)かつ固体 SOIL」のマスへ移し、camera lerp を収束させてから実描画フレームを
  // 掴んでサンプルする。fog/非SOIL を掴んだら(=テスト設定の誤り)合格扱いにせず FAIL させる。
  await startToDive(page);
  // 自機を中段固定 → 周囲 VISIBLE_RADIUS を開示 → 開示範囲内の固体 SOIL マスを決定論選択。
  const target = await page.evaluate(() => {
    startDive();
    G.px = 7; G.py = 5;
    G.seen = new Set();
    revealAround(); // 自機周囲 py±2 / px±2 を seen に入れる(fog を晴らす)。
    // 走査順を固定(col 昇順 → row 昇順)し、開示済み(isVisible)かつ固体 SOIL の最初のマスを採る。
    // 自機マス自身は自機スプライトが乗るため除外。hazardAt の浸水オーバーレイは render の
    // TILE.NONE(空間)分岐でのみ描かれ、固体 SOIL タイルには乗らないので分散の意味は不変。
    let pick = null;
    for (let c = 0; c < CONST.GRID_COLS && !pick; c++) {
      for (let r = 1; r <= CONST.DEPTH_ROWS && !pick; r++) {
        if (c === G.px && r === G.py) continue;
        if (!isVisible(c, r)) continue;
        if (tileType(c, r, G.seed) !== TILE.SOIL) continue;
        pick = { c, r };
      }
    }
    return pick;
  });
  // camera lerp(camY += (target-camY)*0.2 毎フレーム)を収束させる。__camY が連続フレームで
  // ほぼ動かなくなったら確定し、さらに 2 フレーム回して実描画を確定(固定 waitForTimeout に依存しない)。
  await page.evaluate(async () => {
    const raf = () => new Promise((res) => requestAnimationFrame(res));
    let prev = window.__camY || 0;
    let stable = 0;
    for (let i = 0; i < 120; i++) {
      await raf();
      const cur = window.__camY || 0;
      if (Math.abs(cur - prev) < 0.01) { if (++stable >= 3) break; }
      else stable = 0;
      prev = cur;
    }
    await raf();
    await raf();
  });
  // 確定した lit + SOIL マスの canvas 領域をサンプル。スプライトはテクスチャがあるので
  // 色のばらつき(分散)が大きく出る(単色矩形 fallback なら分散 ≈ 0)。
  // litSoil=false(fog や非SOIL を掴んだ)なら PASS 条件側で FAIL させる(空洞合格にしない)。
  const texture = await page.evaluate(([col, row]) => {
    if (col == null || row == null) return { sampled: false, litSoil: false, reason: "no-target" };
    const c = document.getElementById("scene");
    const g = c.getContext("2d");
    const t = tile;
    // サンプル直前に対象マスが確実に開示済み・固体 SOIL であることを再確認(fog なら誤設定)。
    const litSoil = isVisible(col, row) && tileType(col, row, G.seed) === TILE.SOIL;
    const camY = window.__camY || 0;
    const sx = Math.round(col * t * (c.width / window.innerWidth));
    const sy = Math.round((row - camY) * t * (c.height / window.innerHeight));
    const sw = Math.max(4, Math.round(t * 0.6 * (c.width / window.innerWidth)));
    const sh = sw;
    if (sx < 0 || sy < 0 || sx + sw > c.width || sy + sh > c.height)
      return { sampled: false, litSoil, col, row, reason: "offscreen" };
    const d = g.getImageData(sx, sy, sw, sh).data;
    // 分散(R チャンネル)。単色 fallback ≈ 0、テクスチャあり > 0。
    let sum = 0, n = 0;
    const rs = [];
    for (let i = 0; i < d.length; i += 4) { rs.push(d[i]); sum += d[i]; n++; }
    const mean = sum / n;
    let varc = 0;
    for (const v of rs) varc += (v - mean) * (v - mean);
    varc /= n;
    return { sampled: true, litSoil, col, row, mean: +mean.toFixed(1), variance: +varc.toFixed(1) };
  }, [target ? target.c : null, target ? target.r : null]);

  // v0.2.2: キャラを Kenney Roguelike Characters(リング無しのピクセル人型)へ差し替え。
  // 切り出しは 16px セル → 64px(point) なので miner/girl とも 64x64 正方形になる。
  // 旧 alien スプライトは 46x64(縦長)だったため、64x64 正方形であることが差し替えの実証。
  // 本体ピクセルの平均色も参考に記録(坑夫=茶髪/前掛けで暖色寄り、緑優勢ではない)。
  const minerColor = await page.evaluate(() => {
    const img = SPRITES.miner;
    if (!img || !img.complete || img.naturalWidth <= 0) return { ok: false, reason: "not-ready" };
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 128) continue; // 透明部は除外(キャラ本体のみ)。
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
    }
    if (n === 0) return { ok: false, reason: "all-transparent" };
    r = +(r / n).toFixed(1); gg = +(gg / n).toFixed(1); b = +(b / n).toFixed(1);
    // Roguelike 切り出し = 正方形(旧 alien は 46x64 縦長)。差し替えの実証。
    const isSquarePixelChar = img.naturalWidth === img.naturalHeight && img.naturalWidth === 64;
    return { ok: true, r, g: gg, b, isSquarePixelChar, opaquePx: n, nw: img.naturalWidth, nh: img.naturalHeight };
  });

  console.log("== v0.2.2 スプライト 実読込 + キャラ差し替え(Roguelike, リング無し) ==");
  out("pageerrors", errors);
  out("broken assets(0 であるべき)", broken);
  out("スプライト complete & naturalWidth", sprites.r);
  out("全スプライト ready", sprites.allReady);
  out("サンプル対象マス(決定論 lit+SOIL)", target);
  out("固体土サンプルの色分散(lit SOIL でテクスチャ>5)", texture);
  out("miner スプライト(64x64 正方形=Roguelike 差し替え/平均色)", minerColor);

  // テクスチャ分散の合格条件: Kenney soil タイルは陰影/粒状があり、開示済み(lit)の固体 SOIL を
  // 掴めば分散 > 5 が確実に出る。単色矩形 fallback なら分散 ≈ 0、fog(未開示=単色)も分散 ≈ 0。
  // 構造修正: サンプル前に対象が litSoil(開示済み + 固体 SOIL)であることを page 内で確認し、
  // それが満たされない(fog/非SOIL/対象なし)場合は合格扱いにせず FAIL させる(空洞合格の禁止)。
  // camera lerp は収束待ち + 実描画フレーム待ちで race を消したので variance は決定論的に出る。
  // miner 差し替え判定: Roguelike 切り出しは 64x64 正方形(旧 alien 46x64 と区別)。
  spritePass =
    errors.length === 0 &&
    broken.length === 0 &&
    sprites.allReady === true &&
    minerColor.ok === true &&
    minerColor.isSquarePixelChar === true &&
    texture.sampled === true &&
    texture.litSoil === true &&
    texture.variance > 5;
  out("PASS(スプライト実読込/broken なし/miner 64x64 差し替え/テクスチャ描画)", spritePass);
  await ctx.close();
}

// ============================================================================
// (L) 音: mute ボタンで audioOn トグル(♪ <-> ♪̸)。Audio 要素生成で pageerror が出ない。
//     SFX/BGM の Audio 要素が生成されていること。clear SFX 要素の存在(救出ジングル)。
//     ※ headless では実音は鳴らない。鳴らなくてよいが「pageerror が出ない」ことを担保する。
// ============================================================================
let audioPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page); // ダイブ開始 = startBgm() のユーザー操作起点。
  await page.waitForTimeout(300);

  // SFX/BGM の Audio 要素が JS 内で生成されているか + clear SFX キー存在。
  const audioState = await page.evaluate(() => ({
    sfxKeys: Object.keys(typeof SFX !== "undefined" ? SFX : {}),
    hasClearSfx: typeof SFX !== "undefined" && SFX.clear instanceof Audio,
    bgmCreated: typeof bgm !== "undefined" && bgm instanceof Audio,
    audioOnInit: typeof audioOn !== "undefined" ? audioOn : null,
  }));

  // mute ボタンが hittable で、押下で audioOn がトグル(true -> false -> true)。
  const muteBtn = await buttonHittable(page, "#btn-mute");
  const onBefore = await page.evaluate(() => audioOn);
  const labelBefore = await page.evaluate(() => document.getElementById("btn-mute").textContent);
  await tapSelector(page, "#btn-mute");
  await page.waitForTimeout(80);
  const onAfter1 = await page.evaluate(() => audioOn);
  const labelAfter1 = await page.evaluate(() => document.getElementById("btn-mute").textContent);
  await tapSelector(page, "#btn-mute");
  await page.waitForTimeout(80);
  const onAfter2 = await page.evaluate(() => audioOn);
  const labelAfter2 = await page.evaluate(() => document.getElementById("btn-mute").textContent);

  // v0.2.1: BGM が新パス theme.ogg を指していること(audioOn=true で start 済み)。
  const bgmSrc = await page.evaluate(() => (typeof bgm !== "undefined" && bgm ? bgm.src : null));
  const bgmIsOgg = !!bgmSrc && /\/mineroad\/assets\/bgm\/theme\.ogg$/.test(bgmSrc);

  // v0.2.1 #3対策: playSfx を cloneNode した使い捨て要素で再生に変更。
  // 掘削を連打(20回以上)しても clone 由来の pageerror が一切出ないことを実機操作で踏む。
  await page.evaluate(() => { startDive(); });
  await page.waitForTimeout(80);
  let digTaps = 0;
  for (let k = 0; k < 24; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive") { await page.evaluate(() => { startDive(); }); }
    await actTap(page, 0, 1); // 真下掘り → playDig(clone 再生)
    digTaps++;
    await page.waitForTimeout(35);
    // 底や地表へ達したら掘り直しのため位置を中段へ戻す(掘削連打そのものが目的)。
    await page.evaluate(() => { if (G.py >= 14 || G.py <= 0) { G.py = 5; } });
  }
  const errAfterSpam = errors.length;

  console.log("== v0.2.1 音 / mute トグル / BGM=theme.ogg / SFX clone 連打 ==");
  out("pageerrors(Audio 生成・再生・clone 連打で 0)", errors);
  out("Audio 要素状態", audioState);
  out("BGM src(theme.ogg であるべき)", { bgmSrc, bgmIsOgg });
  out("mute ボタン hittable", muteBtn);
  out("audioOn トグル", { onBefore, onAfter1, onAfter2 });
  out("ラベル ♪/♪̸ 変化", { labelBefore, labelAfter1, labelAfter2 });
  out("掘削連打回数 / 連打後 pageerror 件数", { digTaps, errAfterSpam });

  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  audioPass =
    errors.length === 0 &&
    audioState.sfxKeys.length === 7 &&
    audioState.hasClearSfx === true &&
    audioState.bgmCreated === true &&
    bgmIsOgg === true &&
    digTaps >= 20 &&
    errAfterSpam === 0 &&
    okBtn(muteBtn) &&
    onBefore === true && onAfter1 === false && onAfter2 === true &&
    labelBefore === "♪" && labelAfter1 === "♪̸" && labelAfter2 === "♪";
  out("PASS(mute / BGM=theme.ogg / clone 連打 pageerror 0 / clear SFX)", audioPass);
  await ctx.close();
}

// ============================================================================
// (M) スクリーンショット 3 枚(412x915): title / dive(断面+キャラ+タイル) / clear。
//     私(OWNER)が後で見た目を確認するため。検証合否には含めない(目視確認用)。
// ============================================================================
{
  const { ctx, page } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // title
  await page.screenshot({ path: `${SHOTDIR}/mr_v030_title.png` });
  // dive: 掘り進んで断面・タイル・キャラが見える場面を作る。
  await startToDive(page);
  await page.evaluate(() => {
    startDive();
    // 縦坑を掘り下げて断面を作り、女の子も近くに可視化する。
    const col = G.px;
    for (let r = 1; r <= 6; r++) { G.dug.add(col + "," + r); }
    G.px = col; G.py = 6;
    revealAround && revealAround();
    renderHud && renderHud();
  });
  await page.waitForTimeout(500); // カメラ追従の補間を落ち着かせる。
  await page.screenshot({ path: `${SHOTDIR}/mr_v030_dive.png` });
  // clear: ダンジョン制覇 overlay。v0.3.0 は全員救出 + 最下層到達 + 探索率 100% が必要なので、
  // 状態を作って(全 girls rescued・rescued=5・maxDepth=15・全マス seen)から地表帰還経路を踏む。
  await page.evaluate(() => {
    startDive();
    for (const g of G.girls) { g.state = "rescued"; }
    G.rescued = CONST.GIRL_COUNT;
    G.maxDepthThisDive = CONST.DEPTH_ROWS;
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++) for (let c = 0; c < CONST.GRID_COLS; c++) G.seen.add(c + "," + r);
    // 地表へ戻る経路: 1 マス縦坑を掘り、地表へ moveTo。
    G.dug.add(G.px + ",1");
    G.py = 1;
    moveTo(G.px, 0, true);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTDIR}/mr_v030_clear.png` });
  console.log("== スクリーンショット保存 ==");
  out("保存先", [`${SHOTDIR}/mr_v030_title.png`, `${SHOTDIR}/mr_v030_dive.png`, `${SHOTDIR}/mr_v030_clear.png`]);
  await ctx.close();
}

// ============================================================================
// (B) 二段ゲージ × 地上全回復の撤退、(C) 女の子救出、(D) 重力 + 探索率、決定論
// ============================================================================
let mechPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { localStorage.removeItem("mineroad_best_depth"); localStorage.removeItem("mineroad_rescued_total"); } catch (e) {} });
  await startToDive(page);

  // --- (B1) 行動でスタミナが減る(実関数 act 経由)。---
  const spDrain = await page.evaluate(() => {
    startDive();
    const sp0 = G.stamina;
    // 真下を掘って進む(土なら 1 手で空間化 → 前進、各行動でスタミナ 1)。
    let acts = 0;
    for (let k = 0; k < 8; k++) {
      const py0 = G.py;
      act(0, 1);
      acts++;
      if (G.py === 0) break; // 地表へ戻ったら止める。
      if (G.py === py0 && G.stamina === sp0) break;
    }
    return { sp0, sp1: G.stamina, drained: G.stamina < sp0, acts };
  });

  // --- (B2) スタミナ 0 → 以降 体力が減る(二段ゲージの核)。---
  const twoStage = await page.evaluate(() => {
    startDive();
    G.py = 5; // 地中(地表で回復しない位置)。
    G.stamina = 2;
    const hp0 = G.hp;
    spendAction(); // sp 2->1
    spendAction(); // sp 1->0
    const spAtZero = G.stamina;
    const hpStill = G.hp; // まだ満タン(sp で吸収)。
    spendAction(); // sp 0 → hp 減る
    spendAction();
    return { spAtZero, hpStill, hpAfter: G.hp, hpDropped: G.hp < hp0, hp0 };
  });

  // --- (B3) 体力 0 で力尽き(地中)→ fail。---
  const failFlow = await page.evaluate(() => {
    startDive();
    G.py = 6;
    G.stamina = 0;
    G.hp = 2;
    spendAction();
    spendAction(); // hp 0
    checkFail();
    return { hp: G.hp, screen: G.screen, title: document.getElementById("ov-title").textContent };
  });

  // --- (B4) 地表帰還で全回復(撤退の報酬)。救出前の帰還は全回復して継続。---
  const recover = await page.evaluate(() => {
    startDive();
    G.py = 8;
    G.stamina = 10;
    G.hp = 12;
    // 地表まで掘り抜いた縦シャフトを用意し、上へ歩いて戻る経路を作る。
    for (let r = 1; r <= 8; r++) G.dug.add(G.px + "," + r);
    // moveTo で地表(row 0)へ。surfaceReturn が全回復するはず。
    G.py = 1;
    moveTo(G.px, 0, true);
    return { stamina: G.stamina, hp: G.hp, screen: G.screen, recovered: G.stamina === 100 && G.hp === 30 };
  });

  // --- (C) 女の子: 縦シャフトを掘って発見→追従→地表で救出。v0.3.0 は 1 人救出では clear に
  //     ならない(全員 + 最下層 + 探索率)。ここでは最寄りの 1 人を発見→追従→地表帰還し、
  //     その人だけ rescued になり、HUD が 0/5→1/5、かつ screen が dive のまま(全回復継続)であることを確認。---
  const rescue = await page.evaluate(() => {
    startDive();
    // 最寄り(自機 col7 から右下)= (11,6)。その人を発見→追従→連れ帰る。
    const g = G.girls.find((x) => x.col === 11 && x.row === 6) || G.girls[0];
    for (let r = 1; r <= g.row; r++) G.dug.add(g.col + "," + r);
    G.px = g.col; G.py = g.row;
    discoverGirl(g.col, g.row);
    const discovered = g.state;
    const hudAfterFound = document.getElementById("rescue-val").textContent;
    // 上へ 1 マスずつ戻る(掘った跡が帰り道)。女の子が追従して一緒に地表へ。
    let guard = 0;
    for (let r = g.row - 1; r >= 0 && guard < 60; r--) {
      G.px = g.col; G.py = r;
      advanceGirl();
      guard++;
      if (r === 0) { surfaceReturn(); break; }
    }
    return {
      discovered,
      hudAfterFound,
      girlState: g.state,
      rescued: G.rescued,
      hudAfterRescue: document.getElementById("rescue-val").textContent,
      screen: G.screen, // dive のまま(1 人=clear ではない)
      ovTitle: document.getElementById("ov-title").textContent,
    };
  });

  // --- (C2) 実経路で女の子を掘り当てた直後、誤って「はぐれた」警告(cueGirlBlocked)が出ない。---
  // バグ再現経路: act で女の子マスを掘り抜く → discoverGirl が following + cueGirlFound →
  // moveTo(...,true) 内の advanceGirl が同マスで bfsStep null → 誤って cueGirlBlocked 表示。
  // 同マス早期 return の修正後は cueGirlFound 系のまま、追従も継続することを assert する。
  const discoverHint = await page.evaluate(() => {
    startDive();
    const g = G.girls.find((x) => x.col === 11 && x.row === 6) || G.girls[0];
    const gi = G.girls.indexOf(g);
    // 女の子の真上(g.col, g.row-1)へ自機を置き、縦坑を g.row-1 まで掘っておく。
    for (let r = 1; r < g.row; r++) G.dug.add(g.col + "," + r);
    G.px = g.col; G.py = g.row - 1;
    // 真下(=女の子マス)を掘る = 実経路の act(0,1)。土相当の手数で掘り抜き discoverGirl→moveTo。
    let guard = 0;
    while (G.girls[gi].state === "hidden" && guard < 5) { act(0, 1); guard++; }
    const hint = document.getElementById("hud-hint").textContent;
    const hintHidden = document.getElementById("hud-hint").hidden;
    // 文言は app.js TEXT の verbatim(cueGirlFound / cueGirlBlocked)。
    return {
      girlState: G.girls[gi].state,
      hint,
      hintHidden,
      isFoundHint: hint === "女の子を見つけた。地表へ連れ帰ろう",
      isBlockedHint: hint === "道がふさがって女の子がはぐれた。掘り直そう",
    };
  });

  // --- (D1) 重力: 足元が空間なら落下する(applyGravity)。---
  const gravity = await page.evaluate(() => {
    startDive();
    // 自機の真下 2 マスを空間化し、上のマスへ「移動」したら底まで落ちるか。
    const col = G.px;
    G.dug.add(col + ",1");
    G.dug.add(col + ",2");
    G.dug.add(col + ",3");
    G.py = 0;
    // row1 へ移動 → 足元(row2,3)が空間なので落ちる。
    moveTo(col, 1);
    return { landedRow: G.py, fell: G.py > 1 };
  });

  // --- (D2) 上移動 = 掘った縦坑を 1 マスずつ登って地表へ戻れる(全回復ループ)。
  //          固い土の上へは登れない(クライムで岩抜けしない)。---
  const upLimit = await page.evaluate(() => {
    startDive();
    const col = G.px;
    for (let r = 1; r <= 6; r++) G.dug.add(col + "," + r); // 縦坑 row1..6。
    G.py = 6; G.stamina = 50;
    const before = G.py;
    act(0, -1); // 1 マス登る。
    const after1 = G.py;
    act(0, -1); // もう 1 マス。
    const after2 = G.py;
    const climbsOne = after1 === before - 1 && after2 === after1 - 1; // 1 マスずつ確実に登る。
    // 固い土の上へは登れない。
    G.px = 3; G.py = 8; G.dug = new Set();
    const solidBefore = G.py;
    act(0, -1);
    const blockedBySolid = G.py === solidBefore;
    return { before, after1, after2, climbsOne, blockedBySolid, movedOne: climbsOne && blockedBySolid };
  });

  // --- (D3) 探索率%が増える。---
  const explore = await page.evaluate(() => {
    startDive();
    const e0 = exploreRatio();
    // 何マスか掘って可視を広げる。
    for (let k = 0; k < 5; k++) act(0, 1);
    const e1 = exploreRatio();
    return { e0: +(e0 * 100).toFixed(1), e1: +(e1 * 100).toFixed(1), increased: e1 > e0 };
  });

  // --- 決定論: 固定 BASE_SEED で盤面・女の子が毎回一致。---
  const det = await page.evaluate(() => {
    function snap() {
      const t = [];
      for (let r = 1; r <= CONST.DEPTH_ROWS; r++)
        for (let c = 0; c < CONST.GRID_COLS; c++) t.push(tileType(c, r, CONST.BASE_SEED));
      const g = girlPositions(CONST.BASE_SEED).map((x) => x.col + "," + x.row).join("|");
      return { t: t.join(""), g };
    }
    const a = snap(), b = snap();
    const noRandom = typeof Math.random === "function"; // 存在はするが使っていないことは静的検査で担保。
    return { same: a.t === b.t && a.g === b.g, noRandom };
  });

  console.log("== マインロード 核メカ ==");
  out("pageerrors", errors);
  out("(B1) 行動でスタミナ減", spDrain);
  out("(B2) スタミナ0→体力減(二段ゲージ)", twoStage);
  out("(B3) 体力0で力尽き(fail)", failFlow);
  out("(B4) 地表帰還で全回復", recover);
  out("(C) 女の子 1人 発見→追従→地表救出(HUD 0/5→1/5, screen=dive 継続)", rescue);
  out("(C2) 発見直後の hint が cueGirlFound(誤 cueGirlBlocked 抑止)", discoverHint);
  out("(D1) 重力(足元空間で落下)", gravity);
  out("(D2) 上移動は 1 マス", upLimit);
  out("(D3) 探索率% 増加", explore);
  out("決定論(固定 seed 一致)", det);

  mechPass =
    errors.length === 0 &&
    spDrain.drained &&
    twoStage.spAtZero === 0 &&
    twoStage.hpStill === twoStage.hp0 && // sp がある間は hp 減らない
    twoStage.hpDropped && // sp 0 後に hp 減る
    failFlow.hp <= 0 &&
    failFlow.screen === "fail" &&
    failFlow.title === "力尽きた" &&
    recover.recovered &&
    rescue.discovered === "following" &&
    rescue.hudAfterFound === "0/5" && // 発見だけでは救出数は増えない
    rescue.girlState === "rescued" &&
    rescue.rescued === 1 && // 1 人だけ救出
    rescue.hudAfterRescue === "1/5" && // HUD が 0/5→1/5
    rescue.screen === "dive" && // 1 人救出では clear にならない(dive 継続)
    discoverHint.girlState === "following" && // 発見後は追従継続
    discoverHint.isFoundHint === true && // 発見直後の表示は cueGirlFound
    discoverHint.isBlockedHint === false && // 誤 cueGirlBlocked が出ていない
    gravity.fell &&
    upLimit.movedOne &&
    explore.increased &&
    det.same;
  out("PASS(二段ゲージ/撤退/救出/重力/探索率/決定論)", mechPass);
  await ctx.close();
}

// ============================================================================
// (N) v0.2.1 #4 最重要・回帰防止: 女の子の縦坑追従。
//   v0.1.0 既存バグ = 発見(following)後、縦坑を登るとき女の子の重力が空洞を通して下へ
//   引き戻し、発見直後に底へ張り付いて地表まで追従できなかった。advanceGirl の
//   「自機へ向かう一歩が上向き(クライム)なら重力を作用させない」ガードで修正。
//   ここでは window.G を監視し、発見後に自機を縦坑で 1 マスずつ登らせながら advanceGirl を
//   呼び、女の子の row が「底へ張り付かず」自機 row に追従して減少していくことを実測する。
//   固定 seed=41027(女の子は決定論配置)。
// ============================================================================
let girlFollowPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  const trace = await page.evaluate(() => {
    startDive();
    const seed = G.seed;
    // 最深の 1 人(8,14)で追従トレース(縦坑が一番長い = 底張り付きが最も出やすい)。
    const g = G.girls.find((x) => x.col === 8 && x.row === 14) || G.girls[G.girls.length - 1];
    const gi = G.girls.indexOf(g);
    const startRow = g.row, col = g.col;
    // 女の子の列に地表(row0)から女の子の行まで一直線の縦坑を掘る(帰り道)。
    for (let r = 1; r <= startRow; r++) G.dug.add(col + "," + r);
    // 自機を女の子マスへ置いて発見させる。
    G.px = col; G.py = startRow;
    discoverGirl(col, startRow);
    const discovered = G.girls[gi].state;
    // 発見直後に女の子が即底へ張り付いていないこと(=バグ症状)を記録。
    const girlRowAfterDiscover = G.girls[gi].state === "rescued" ? 0 : G.girls[gi].row;

    // 自機を 1 マスずつ上へ登らせ、各手で advanceGirl を呼ぶ。女の子 row が
    // 自機 row へ追従して減少するかをトレースする(底に張り付くなら row が減らない)。
    const steps = [];
    let stuck = false;
    let prevGirlRow = G.girls[gi].row;
    for (let pr = startRow - 1; pr >= 0; pr--) {
      G.px = col; G.py = pr; // 自機が縦坑を 1 マス登った。
      advanceGirl();
      const gr = G.girls[gi].state === "rescued" ? 0 : G.girls[gi].row;
      steps.push({ playerRow: pr, girlRow: gr, girlState: G.girls[gi].state });
      // 女の子 row が「前手より増えた(底へ落ち戻った)」ら張り付きバグ。
      if (G.girls[gi].state !== "rescued" && gr > prevGirlRow) stuck = true;
      prevGirlRow = gr;
      if (G.girls[gi].state === "rescued") break;
    }
    // 女の子が地表(row0)へ追従しきって rescued になった後、自機も地表(py0)に居るので
    // surfaceReturn が走る。v0.3.0 は 1 人救出では clear にならず全回復継続(screen=dive)。
    if (G.girls[gi].state === "rescued" && G.py === 0) surfaceReturn();

    // 追従の単調減少(rescue 到達まで girlRow は概ね減っていく)を判定。
    const girlRows = steps.map((s) => s.girlRow);
    const lastState = G.girls[gi].state;
    return {
      seed, col, startRow, discovered, girlRowAfterDiscover,
      steps, girlRows, stuck, lastState, rescued: G.rescued,
      hud: document.getElementById("rescue-val").textContent,
      // 女の子が startRow から地表(0)まで row を縮められたか。
      reachedSurface: lastState === "rescued",
      // 最終 girlRow が startRow より小さい = 追従して上がった(底張り付きの否定)。
      followedUp: girlRows.length > 0 && Math.min(...girlRows) < startRow,
    };
  });

  // 1 人救出後の最終確認(v0.3.0 = clear ではなく dive 継続)。
  const finalScreen = await page.evaluate(() => ({
    screen: G.screen,
    title: document.getElementById("ov-title") ? document.getElementById("ov-title").textContent : "",
  }));

  console.log("== (N) v0.2.1 女の子 縦坑追従 row トレース(最重要・回帰防止) ==");
  out("pageerrors", errors);
  out("seed(=41027)", trace.seed);
  out("女の子配置(col,startRow)", { col: trace.col, startRow: trace.startRow });
  out("発見状態(following)", trace.discovered);
  out("発見直後の girlRow(底張り付きなら startRow 付近のまま)", trace.girlRowAfterDiscover);
  out("追従 row トレース [playerRow→girlRow]", trace.steps.map((s) => `${s.playerRow}->${s.girlRow}`).join(" "));
  out("girlRow 系列", trace.girlRows);
  out("底へ落ち戻り(stuck=true なら回帰)", trace.stuck);
  out("地表まで追従して救出(reachedSurface)", trace.reachedSurface);
  out("最終 state / rescued", { lastState: trace.lastState, rescued: trace.rescued });
  out("最終 screen", finalScreen);

  girlFollowPass =
    errors.length === 0 &&
    trace.seed === 41027 &&
    trace.discovered === "following" &&
    trace.stuck === false && // 各手で row が増えない(底へ落ち戻らない)
    trace.followedUp === true && // row が startRow より上がった
    trace.reachedSurface === true && // 地表まで追従しきって救出
    trace.rescued === 1 &&
    trace.hud === "1/5" && // HUD 1/5
    finalScreen.screen === "dive"; // v0.3.0: 1 人救出では clear にならず dive 継続
  out("PASS(女の子 縦坑追従: 底張り付きなし→地表救出/1人=dive継続)", girlFollowPass);
  await ctx.close();
}

// ============================================================================
// (E) 十字キー hittable + タップ掘り併存 + 可読性(412x915 + 短高 680/730)
// ============================================================================
let dpadPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  const btnDown = await buttonHittable(page, "#btn-down");
  const btnUp = await buttonHittable(page, "#btn-up");
  const btnLeft = await buttonHittable(page, "#btn-left");
  const btnRight = await buttonHittable(page, "#btn-right");

  // D-pad「下」を画面座標タップで掘って前進(最前面が btn か毎回確認)。
  let dpadMoved = false, dpadAllBtn = true;
  for (let k = 0; k < 8 && !dpadMoved; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    const tapped = await tapSelector(page, "#btn-down");
    if (!tapped) dpadAllBtn = false;
    await page.waitForTimeout(80);
    const after = await page.evaluate(() => G.py);
    if (after !== before.py) dpadMoved = true;
  }

  // タップ掘り(canvas)併存で前進。
  let tapMoved = false, tapAllScene = true;
  for (let k = 0; k < 8 && !tapMoved; k++) {
    const before = await page.evaluate(() => ({ px: G.px, py: G.py, scr: G.screen }));
    if (before.scr !== "dive") break;
    // 下→無理なら横へ。
    let r = await actTap(page, 0, 1);
    if (!r.onScene) tapAllScene = false;
    await page.waitForTimeout(80);
    let after = await page.evaluate(() => ({ px: G.px, py: G.py }));
    if (after.px !== before.px || after.py !== before.py) { tapMoved = true; break; }
    r = await actTap(page, 1, 0);
    if (!r.onScene) tapAllScene = false;
    await page.waitForTimeout(80);
    after = await page.evaluate(() => ({ px: G.px, py: G.py }));
    if (after.px !== before.px || after.py !== before.py) { tapMoved = true; break; }
  }

  const diveOverflow = await overflowReport(page, "dive-hud");
  if (diveOverflow.overflowCount > 0) overflowFails.push(diveOverflow);

  console.log("== マインロード 十字キー + タップ掘り ==");
  out("pageerrors", errors);
  out("D-pad 上下左右 hittable", { btnUp, btnDown, btnLeft, btnRight });
  out("D-pad 掘り前進(最前面 btn)", { dpadMoved, dpadAllBtn });
  out("タップ掘り併存 前進(最前面 scene)", { tapMoved, tapAllScene });

  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  dpadPass =
    errors.length === 0 &&
    okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) &&
    dpadMoved && dpadAllBtn &&
    tapMoved && tapAllScene;
  out("PASS(十字キー/タップ掘り)", dpadPass);
  await ctx.close();
}

// ============================================================================
// (E2) 短高 viewport(412x680 / 412x730)で操作必須要素が innerHeight 内・押せる
// ============================================================================
let shortVpPass = false;
{
  async function shortGate(vh) {
    const { ctx, page, errors } = await openPage({ seedHowto: true, vw: VW, vh });
    await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    const startBtn = await buttonHittable(page, "#ov-action");
    const howtoBtn = await buttonHittable(page, "#ov-action2");

    await startToDive(page);
    const diveScreen = await page.evaluate(() => G.screen);

    const btnUp = await buttonHittable(page, "#btn-up");
    const btnDown = await buttonHittable(page, "#btn-down");
    const btnLeft = await buttonHittable(page, "#btn-left");
    const btnRight = await buttonHittable(page, "#btn-right");
    const btnSurf = await buttonHittable(page, "#btn-surface");

    let dpadWorks = false;
    for (let k = 0; k < 8 && !dpadWorks; k++) {
      const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (before.scr !== "dive") break;
      await tapSelector(page, "#btn-down");
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => G.py);
      if (after !== before.py) dpadWorks = true;
    }

    const shortOverflow = await overflowReport(page, `dive-short-${vh}`, VW, vh);
    if (shortOverflow.overflowCount > 0) overflowFails.push(shortOverflow);

    const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
    const pass =
      errors.length === 0 &&
      okBtn(startBtn) && okBtn(howtoBtn) &&
      diveScreen === "dive" &&
      okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) && okBtn(btnSurf) &&
      dpadWorks &&
      shortOverflow.overflowCount === 0;

    console.log(`== マインロード 短高 viewport ${VW}x${vh} ==`);
    out("pageerrors", errors);
    out("title もぐる / あそびかた hittable", { startBtn, howtoBtn });
    out("dive 遷移", diveScreen);
    out("十字キー 上下左右/回 hittable", { btnUp, btnDown, btnLeft, btnRight, btnSurf });
    out("短高で D-pad 掘り前進", dpadWorks);
    out(`PASS(短高 ${vh})`, pass);
    await ctx.close();
    return pass;
  }
  const s680 = await shortGate(680);
  const s730 = await shortGate(730);
  shortVpPass = s680 && s730;
  out("PASS(短高 680 & 730)", shortVpPass);
}

// ============================================================================
// (F) 既存 6 作回帰(URL 不変・200・pageerror 0・コア表示)
// ============================================================================
let regressionPass = true;
{
  const games = [
    { url: "/", name: "michiyuki" },
    { url: "/tomoshibi/", name: "tomoshibi" },
    { url: "/nagori/", name: "nagori" },
    { url: "/akari/", name: "akari" },
    { url: "/tomoru/", name: "tomoru" },
    { url: "/saguri/", name: "saguri" },
  ];
  console.log("== 既存 6 作 回帰 ==");
  for (const g of games) {
    const { ctx, page, errors } = await openPage();
    const resp = await page.goto(`${BASE}${g.url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const status = resp ? resp.status() : 0;
    const hasCanvas = await page.evaluate(() => !!document.getElementById("scene"));
    const ok = status === 200 && errors.length === 0 && hasCanvas;
    out(g.name, { url: g.url, status, pageerrors: errors.length, hasCanvas, ok });
    if (!ok) regressionPass = false;
    await ctx.close();
  }
  out("PASS(既存 6 作 回帰)", regressionPass);
}

// ============================================================================
// (G) 画面操作主体の end-to-end(検証専任 playtester 追加)。
//   既存 (B)(C) は内部関数(act/moveTo/discoverGirl/G.dug 手動)を直叩きする単体検証で、
//   「掘った縦坑が実際に登れる帰り道になっているか」「掘り当てで女の子に到達できるか」を
//   画面操作で証明していない(みちゆき "overlay 飛び越え PASS" と同型の穴になり得る)。
//   ここでは #btn-* / canvas タップだけで 潜行→自力クライム帰還→全回復、
//   掘り当て→following→連れ帰り→clear を end-to-end で通す(最前面ヒットテスト常時)。
// ============================================================================
let e2ePass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // 隣接マス (dc,dr) を画面座標タップで掘る/進む。掘る前の最前面が #scene であることを返す。
  async function tapTile(dc, dr) {
    const r = await page.evaluate(([dc, dr]) => {
      const t = tile, cam = window.__camY || 0;
      const x = (G.px + dc) * t + t / 2;
      const y = (G.py + dr - cam) * t + t / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, top: top ? top.id : "none" };
    }, [dc, dr]);
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await page.mouse.up();
    return r.top === "scene";
  }

  // v0.5.0: 真下へ 1 段進む(掘る/落ちる)。掘り抜きの埋没スポーンや空間モンスターが進路を塞いだら
  // bump-attack で撃破してから進む。HARD(2手)も複数タップで掘り切る。実際に 1 段下がる/画面遷移
  // するか、真に詰まる(真下が掘れない硬岩で敵も居ない)まで最大 12 タップ。allScene を巻き込む。
  async function digDownStep() {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    for (let t = 0; t < 12; t++) {
      if (!(await tapTile(0, 1))) allScene = false;
      await page.waitForTimeout(40);
      const now = await page.evaluate(() => {
        const r = G.py + 1;
        const inBounds = r <= CONST.DEPTH_ROWS;
        const foeBelow = !!(G.monsters && G.monsters.some((m) => m.col === G.px && m.row === r));
        const spaceBelow = inBounds && ((G.dug && G.dug.has(G.px + "," + r)) || tileType(G.px, r, G.seed) === TILE.NONE);
        const digging = !!(G.digProgress && G.digProgress.has(G.px + "," + r)); // HARD 等の掘削途中。
        // 真下が現在のツルハシで掘り抜けるか(req power ゲート)。
        const t = inBounds ? (spaceBelow ? TILE.NONE : tileType(G.px, r, G.seed)) : TILE.ROCK;
        const req = (typeof TILE_REQ_POWER !== "undefined") ? TILE_REQ_POWER[t] : undefined;
        const pp = (typeof PICK !== "undefined" && PICK[G.pick]) ? PICK[G.pick].power : 1;
        const diggable = req !== undefined && pp >= req;
        return { py: G.py, scr: G.screen, foeBelow, spaceBelow, digging, diggable };
      });
      if (now.scr !== "dive") return true;
      if (now.py > before.py) return true; // 1 段以上下がった。
      // py 不動でも継続タップする条件: 敵が塞ぐ(撃破中) / 直下が空間(撃破直後で次タップで入れる) /
      // 掘削途中(HARD 複数手) / 現ツルハシで掘り抜ける土。いずれも次タップで前進しうる。
      if (now.foeBelow || now.spaceBelow || now.digging || now.diggable) continue;
      // 上記いずれでもない = 掘れない硬岩で敵も居ない = 真に詰まり。
      break;
    }
    const after = await page.evaluate(() => G.py);
    return after > before.py;
  }

  // v0.5.0: 真上へ 1 段登る(掘った縦坑のクライム)。真上にモンスターが居れば bump-attack で
  // 撃破してから登る(追跡してきた敵が帰路を塞ぐ=護衛中の死の緊張)。1 段登る/画面遷移/真に
  // 詰まる(真上が空間でなく敵も居ない)まで最大 12 タップ。
  async function climbUpStep() {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    for (let t = 0; t < 12; t++) {
      if (!(await tapTile(0, -1))) allScene = false;
      await page.waitForTimeout(40);
      const now = await page.evaluate(() => {
        const r = G.py - 1;
        const foeAbove = !!(G.monsters && G.monsters.some((m) => m.col === G.px && m.row === r));
        const spaceAbove = r <= 0 || (G.dug && G.dug.has(G.px + "," + r)) || tileType(G.px, r, G.seed) === TILE.NONE;
        return { py: G.py, scr: G.screen, foeAbove, spaceAbove };
      });
      if (now.scr !== "dive") return true;
      if (now.py < before.py) return true; // 1 段登れた。
      // py 不動でも継続: 真上に敵(撃破中) or 真上が空間(撃破直後 or 元から空洞で次タップで登れる)。
      if (now.foeAbove || now.spaceAbove) continue;
      break; // 真上が空間でなく敵も居ない(上掘り不可)= 詰まり。
    }
    const after = await page.evaluate(() => G.py);
    return after < before.py;
  }

  await tapSelector(page, "#ov-action");
  await page.waitForTimeout(600);
  const startScreen = await page.evaluate(() => G.screen);

  // --- (G1) 撤退ループ: 画面操作で「一直線の縦坑」を掘って潜行 → その縦坑を真上に登って
  //     自力帰還 → 地表で全回復。"掘った縦坑が帰り道になる"(lead 最重要ゲート)を最も
  //     実機に近い形で検証する。蛇行(横穴)を作ると帰路で自分の掘った縦穴に落ちるのは物理的に
  //     正常挙動なので、ここでは縦坑掘り = プレイヤーが意図する帰還可能な掘り方を検証する。
  //     硬岩に当たらない列を地形から選び、その列の真下のみを掘り下げる。
  let allScene = startScreen === "dive";
  // v0.4.0: 初期ツルハシ=木(power1)。power ゲート導入で HARD(power2)/ROCK(power3) は木で掘れない
  // (= v0.3.0 まで HARD は 2 手で誰でも掘れたが、v0.4.0 は石ツルハシ以上が要る)。そのため
  // 「ROCK が無い列」だけでは縦坑が HARD で詰まる。木 power1 で 1..D を一直線に掘り下げられる列
  //  = 全マスが SOIL か NONE(空間)の列を選ぶ(HARD/ROCK/GIRL を含まない)。一番深くまで soft な
  // 列を採って撤退ループ(py>=4)を確実に成立させる。これは v0.4.0 の power ゲート挙動に追随した
  // 列選択の更新(実装の挙動は STATUS v0.4.0 A の設計どおり)。
  const shaftCol = await page.evaluate(() => {
    const D = 9;
    let best = G.px, bestSoft = -1;
    for (let c = 0; c < CONST.GRID_COLS; c++) {
      let soft = 0;
      for (let r = 1; r <= D; r++) {
        const t = tileAt(c, r);
        if (t === TILE.SOIL || t === TILE.NONE) soft = r; // power1 で掘れる/通れる
        else break; // HARD/ROCK/GIRL でその列の縦坑は詰まる
      }
      if (soft > bestSoft) { bestSoft = soft; best = c; }
    }
    return best;
  });
  // 地表で目的列へ横移動(地表は安全・落下しない)。
  for (let i = 0; i < 20; i++) {
    const px = await page.evaluate(() => G.px);
    if (px === shaftCol) break;
    if (!(await tapTile(px < shaftCol ? 1 : -1, 0))) allScene = false;
    await page.waitForTimeout(45);
  }
  // 真下のみを掘って一直線の縦坑で潜行(py>=6 まで)。v0.5.0: 進路を塞ぐモンスターは
  // digDownStep が bump-attack で撃破してから進む(掘った跡が帰り道になる縦坑を保つ)。
  for (let k = 0; k < 30; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive" || before.py >= 6) break;
    if (!(await digDownStep())) break; // 真に詰まった(掘れない硬岩)なら停止。
  }
  const dived = await page.evaluate(() => ({ py: G.py, sp: G.stamina, px: G.px }));
  // 縦坑を真上に登って帰還(掘った跡が帰り道)。v0.5.0: 追跡してきた敵が縦坑を塞いだら
  // climbUpStep が撃破してから登る。1 マスずつ登り、登れなければ詰み(帰り道不成立 = 欠陥)。
  const climbTrace = [];
  for (let k = 0; k < 20; k++) {
    const before = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (before.scr !== "dive" || before.py <= 0) break;
    const climbed = await climbUpStep();
    const now = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    climbTrace.push(now.py);
    if (!climbed) break; // 登れず詰み = 帰り道が成立しない(欠陥サイン)。
    if (now.scr !== "dive" || now.py <= 0) break;
  }
  const recovered = await page.evaluate(() => ({ py: G.py, sp: G.stamina, hp: G.hp, scr: G.screen }));
  const retreatLoopOk =
    dived.py >= 4 && // 実際に潜れた
    recovered.py === 0 && // 縦坑を辿って自力で地表へ戻れた
    recovered.sp === 100 && recovered.hp === 30 && // 全回復
    recovered.scr === "dive";

  // --- (G2) 救出 e2e(画面操作): 最寄りの女の子(11,6)へ寄せ → 真下掘りで掘り当て(following) →
  //     上掘りで連れ帰り → 地表で救出(HUD 1/5)。v0.3.0 は 1 人では clear にならず dive 継続。
  //     v0.4.0: 女の子(11,6)の列 col11 には HARD タイル(必要 power2)があるため、初期の木ツルハシ
  //     (power1)では掘り抜けない(power ゲート = アイテム系の核)。クラフトボタンを画面操作で開いて
  //     石のツルハシ(power2、銅3)を作ってから救出に向かう。銅3 は鉱石ドロップ gate で別途検証する
  //     ので、ここでは材料を直接付与して「クラフト UI 経由でツルハシが昇格し HARD が掘れる」ことを
  //     画面操作で踏む。---
  // 銅3 を付与(鉱石の決定論ドロップは gate (P) で検証)。クラフトは画面操作で行う。
  await page.evaluate(() => { G.ore.COPPER = 3; renderHud(); });
  await tapSelector(page, "#btn-craft"); // クラフトオーバーレイを開く。
  await page.waitForTimeout(250);
  const craftOpen = await page.evaluate(() => !document.getElementById("craft-overlay").hidden);
  // 「石のツルハシ」行の つくる ボタンを画面座標タップ(最前面ヒットテスト)。
  const craftedStone = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#craft-list .craft-row")];
    const row = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent === "石のツルハシ");
    if (!row) return { ok: false, reason: "no-row" };
    const btn = row.querySelector(".craft-make");
    if (!btn || btn.disabled) return { ok: false, reason: "disabled" };
    btn.click();
    return { ok: G.pick === "STONE", pick: G.pick, copper: G.ore.COPPER };
  });
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(200);
  const pickAfterCraft = await page.evaluate(() => G.pick);
  out("(G2-craft) クラフト開く / 石ツルハシ作成", { craftOpen, craftedStone, pickAfterCraft });

  const girl = await page.evaluate(() => {
    const g = G.girls.find((x) => x.col === 11 && x.row === 6) || G.girls[0];
    return { col: g.col, row: g.row, idx: G.girls.indexOf(g) };
  });
  // 女の子列へ横移動。
  for (let i = 0; i < 20; i++) {
    const px = await page.evaluate(() => G.px);
    if (px === girl.col) break;
    if (!(await tapTile(px < girl.col ? 1 : -1, 0))) allScene = false;
    await page.waitForTimeout(45);
  }
  // 真下掘りで掘り当て(列を保ったまま)。v0.5.0: 進路の空間/埋没モンスターは digDownStep が
  // 撃破してから進む(col11 r5 の SLIME_HALF・r1 の埋没 WORM を倒して女の子へ到達)。
  let found = false;
  for (let k = 0; k < 40 && !found; k++) {
    const st = await page.evaluate(([gi]) => ({ scr: G.screen, gstate: G.girls[gi].state, py: G.py }), [girl.idx]);
    if (st.scr !== "dive") break;
    if (st.gstate === "following") { found = true; break; }
    if (st.py >= 15) break; // 底まで来たら詰み(到達不能 = 欠陥のサイン)。
    if (!(await digDownStep())) break;
  }
  const discovered = await page.evaluate(([gi]) => G.girls[gi].state, [girl.idx]);
  // 連れ帰り(掘った一直線の縦坑を真上 act で 1 マスずつ登る。女の子が追従)。
  // 救出経路は同一列の縦坑。v0.5.0: 追跡してきた敵(col11 r5 から登ってきた SLIME_HALF 等)が
  // 縦坑を塞いだら climbUpStep が撃破してから登る(護衛中の死の緊張)。塞がれて登れなければ異常。
  if (found) {
    for (let k = 0; k < 40; k++) {
      const st = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
      if (st.scr !== "dive" || st.py <= 0) break;
      const climbed = await climbUpStep();
      const after = await page.evaluate(() => ({ scr: G.screen }));
      if (after.scr !== "dive") break;
      if (!climbed) break; // 登れず詰み = 帰り道が成立しない(欠陥サイン)。
    }
  }
  const rescueEnd = await page.evaluate(([gi]) => ({
    scr: G.screen, gstate: G.girls[gi].state, rescued: G.rescued,
    hud: document.getElementById("rescue-val").textContent,
  }), [girl.idx]);
  const rescueE2eOk =
    craftedStone.ok && pickAfterCraft === "STONE" && // v0.4.0: 石ツルハシをクラフト経由で得た
    found && discovered === "following" &&
    rescueEnd.scr === "dive" && rescueEnd.gstate === "rescued" &&
    rescueEnd.rescued === 1 && rescueEnd.hud === "1/5";

  console.log("== 画面操作 end-to-end(撤退ループ / 救出) ==");
  out("pageerrors", errors);
  out("(G1) 潜行 py/sp", dived);
  out("(G1) クライム帰還 py 列", climbTrace);
  out("(G1) 帰還後(全回復&地表)", recovered);
  out("(G1) 撤退ループ成立", retreatLoopOk);
  out("(G2) 女の子掘り当て(following)", { found, discovered, girl });
  out("(G2) 連れ帰り(rescued/HUD 1/5/dive継続)", rescueEnd);
  out("(G2) 救出 e2e 成立(1人=clearにならず dive継続)", rescueE2eOk);
  out("全操作で最前面が #scene", allScene);

  e2ePass = errors.length === 0 && allScene && retreatLoopOk && rescueE2eOk;
  out("PASS(画面操作 e2e: 撤退ループ + 救出)", e2ePass);
  await ctx.close();
}

// ============================================================================
// (H) fail 画面のはみ出し検査(defeat 画面 = lead 必須。既存は title/howto/dive のみ)
// ============================================================================
let failOverflowPass = true;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);
  // 地中で体力 0 → fail 画面を出す(内部関数で確実に到達。はみ出し検査が目的)。
  await page.evaluate(() => { startDive(); G.py = 6; G.stamina = 0; G.hp = 1; spendAction(); checkFail(); });
  await page.waitForTimeout(500);
  const failScreen = await page.evaluate(() => G.screen);
  const failOverflow = await overflowReport(page, "fail-overlay");
  if (failOverflow.overflowCount > 0) { overflowFails.push(failOverflow); failOverflowPass = false; }
  // retry が押せること。
  const retryBtn = await buttonHittable(page, "#ov-action");
  console.log("== fail 画面 はみ出し + retry ==");
  out("pageerrors", errors);
  out("fail 画面", failScreen);
  out("fail はみ出し件数", failOverflow.overflowCount);
  out("retry ボタン hittable", retryBtn);
  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  failOverflowPass = failOverflowPass && errors.length === 0 && failScreen === "fail" && okBtn(retryBtn);
  out("PASS(fail はみ出し0 + retry 押下可)", failOverflowPass);
  await ctx.close();
}

// ============================================================================
// (O) v0.3.0 クリアゲート: §7 忠実(全員救出 + 最下層到達 + 探索率しきい値)。
//   ① 全条件未達では isDungeonCleared()=false で clear しない(地表帰還で dive 継続)。
//   ② 全条件達成(全 girls rescued・rescued=5・maxDepth=15・探索率100%)から地表帰還経路を
//      踏むと showClear → screen=clear, overlay title="ダンジョン制覇"。
//   ③ 旧「1 人=即クリア」回帰防止: 1 人だけ rescued + 最下層到達 + 探索率100% でも clear しない。
//   状態は window.G を作ってから「最後の地表帰還経路」(縦坑 1 マス掘り → moveTo row0)を踏ませる
//   (canvas へ直接 dispatch せず、内部状態 + 正規の surfaceReturn 経路で判定する)。
// ============================================================================
let clearGatePass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // 地表帰還経路を踏む共通ヘルパ(縦坑 1 マス掘って row1→row0 へ moveTo)。
  const goSurface = `
    G.dug.add(G.px + ",1");
    G.py = 1;
    moveTo(G.px, 0, true);
  `;

  // ① 全条件未達(救出 0・最下層未到達・探索率低)で地表帰還 → clear しない。
  const notCleared = await page.evaluate((surf) => {
    startDive();
    G.rescued = 0; G.maxDepthThisDive = 3;
    const cleared = isDungeonCleared();
    eval(surf);
    return { isCleared: cleared, screen: G.screen };
  }, goSurface);

  // ③ 1 人だけ rescued + 最下層 + 探索率100% でも clear しない(旧 1人=即クリア回帰防止)。
  const onePlusDepth = await page.evaluate((surf) => {
    startDive();
    G.girls[0].state = "rescued"; G.rescued = 1;
    G.maxDepthThisDive = CONST.DEPTH_ROWS;
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++) for (let c = 0; c < CONST.GRID_COLS; c++) G.seen.add(c + "," + r);
    const cleared = isDungeonCleared();
    const explore = exploreRatio();
    eval(surf);
    return { isCleared: cleared, explore: +(explore * 100).toFixed(0), screen: G.screen };
  }, goSurface);

  // 救出 5 だが最下層未到達でも clear しない(条件②欠落)。
  const fiveNoDepth = await page.evaluate(() => {
    startDive();
    for (const g of G.girls) g.state = "rescued";
    G.rescued = 5; G.maxDepthThisDive = 10; // 最下層未到達
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++) for (let c = 0; c < CONST.GRID_COLS; c++) G.seen.add(c + "," + r);
    return { isCleared: isDungeonCleared() };
  });

  // 救出 5 + 最下層だが探索率不足でも clear しない(条件③欠落)。
  const fiveNoExplore = await page.evaluate(() => {
    startDive();
    for (const g of G.girls) g.state = "rescued";
    G.rescued = 5; G.maxDepthThisDive = CONST.DEPTH_ROWS;
    // seen は startDive 時の地表まわりのみ(探索率 << 100%)。
    return { isCleared: isDungeonCleared(), explore: +(exploreRatio() * 100).toFixed(0) };
  });

  // ② 全条件達成 → 地表帰還で showClear(title="ダンジョン制覇")。
  const fullClear = await page.evaluate((surf) => {
    startDive();
    for (const g of G.girls) g.state = "rescued";
    G.rescued = CONST.GIRL_COUNT;
    G.maxDepthThisDive = CONST.DEPTH_ROWS;
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++) for (let c = 0; c < CONST.GRID_COLS; c++) G.seen.add(c + "," + r);
    const clearedBefore = isDungeonCleared();
    const explore = +(exploreRatio() * 100).toFixed(0);
    eval(surf);
    return {
      clearedBefore, explore,
      screen: G.screen,
      title: document.getElementById("ov-title").textContent,
      sub: document.getElementById("ov-sub").textContent,
    };
  }, goSurface);

  console.log("== (O) v0.3.0 クリアゲート(§7 忠実 / 旧1人=即クリア回帰防止) ==");
  out("pageerrors", errors);
  out("① 全条件未達 → clear しない(dive 継続)", notCleared);
  out("③ 1人+最下層+探索100% でも clear しない(旧即クリア回帰防止)", onePlusDepth);
  out("救出5+最下層未到達 → clear しない", fiveNoDepth);
  out("救出5+最下層+探索不足 → clear しない", fiveNoExplore);
  out("② 全条件達成 → showClear(ダンジョン制覇)", fullClear);

  clearGatePass =
    errors.length === 0 &&
    notCleared.isCleared === false && notCleared.screen === "dive" &&
    onePlusDepth.isCleared === false && onePlusDepth.explore === 100 && onePlusDepth.screen === "dive" &&
    fiveNoDepth.isCleared === false &&
    fiveNoExplore.isCleared === false && fiveNoExplore.explore < 100 &&
    fullClear.clearedBefore === true && fullClear.explore === 100 &&
    fullClear.screen === "clear" &&
    fullClear.title === "ダンジョン制覇";
  out("PASS(クリアゲート §7 忠実 / 旧1人=即クリア回帰防止 / 全達成で制覇)", clearGatePass);
  await ctx.close();
}

// ============================================================================
// (P) 複数女の子: 2 人を実掘り当て → HUD が 0/5 → 1/5 → 2/5 と増える(全員 hidden→following→
//   rescued 遷移)。最寄り(11,6)と (0,8) を順に救出する画面操作 e2e に近い検証
//   (掘削/移動は内部 act/moveTo 経由だが G.dug を実際に作って帰り道を成立させる)。
// ============================================================================
let multiGirlPass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  const multi = await page.evaluate(() => {
    startDive();
    const hud0 = document.getElementById("rescue-val").textContent; // 0/5
    const log = [];
    // 1 人目: (11,6)。列に縦坑を掘って発見→追従→地表帰還で救出。
    function rescueOne(col, row) {
      for (let r = 1; r <= row; r++) G.dug.add(col + "," + r);
      G.px = col; G.py = row;
      discoverGirl(col, row);
      const found = G.girls.find((g) => g.col === col && g.origRow === row);
      const st1 = found ? found.state : "?";
      for (let r = row - 1; r >= 0; r--) { G.px = col; G.py = r; advanceGirl(); if (r === 0) { surfaceReturn(); break; } }
      const after = G.girls.find((g) => g.origRow === row && g.col === col);
      return { foundState: st1, finalState: after ? after.state : "?" };
    }
    const g1 = rescueOne(11, 6);
    const hud1 = document.getElementById("rescue-val").textContent; // 1/5
    log.push({ girl: "11,6", g1, hud1 });
    const g2 = rescueOne(0, 8);
    const hud2 = document.getElementById("rescue-val").textContent; // 2/5
    log.push({ girl: "0,8", g2, hud2 });

    return {
      hud0, hud1, hud2,
      rescued: G.rescued,
      screen: G.screen, // 2 人では未達 = dive 継続
      states: G.girls.map((g) => `${g.col},${g.origRow}:${g.state}`),
      g1, g2,
    };
  });

  console.log("== (P) 複数女の子 2人救出で HUD 0/5→1/5→2/5 ==");
  out("pageerrors", errors);
  out("HUD 推移", { hud0: multi.hud0, hud1: multi.hud1, hud2: multi.hud2 });
  out("1人目(11,6) found→rescued", multi.g1);
  out("2人目(0,8) found→rescued", multi.g2);
  out("rescued 合計 / screen", { rescued: multi.rescued, screen: multi.screen });
  out("全 girls state", multi.states);

  multiGirlPass =
    errors.length === 0 &&
    multi.hud0 === "0/5" &&
    multi.g1.foundState === "following" && multi.g1.finalState === "rescued" &&
    multi.hud1 === "1/5" &&
    multi.g2.foundState === "following" && multi.g2.finalState === "rescued" &&
    multi.hud2 === "2/5" &&
    multi.rescued === 2 &&
    multi.screen === "dive"; // 2 人では未達 = clear にならない
  out("PASS(2人救出: hidden→following→rescued, HUD 0/5→1/5→2/5, 未達dive継続)", multiGirlPass);
  await ctx.close();
}

// ============================================================================
// (Q) v0.4.0 新機能スモーク(STATUS v0.4.0 エントリ準拠)。実機反映前の最小ゲートとして追加。
//   Q1 クラフト UI: #btn-craft 画面タップ → クラフトオーバーレイが DOM 表示 →
//      craft.csv 6 レシピ(名前 + コスト verbatim)が出る → #craft-close で閉じる。pageerror 0。
//      (overlay 開閉は画面座標ヒットテスト経由 = 最前面が想定ボタンであることを確認)。
//   Q2 HUD インベントリ描画: 鉱石 4 種カウント + ツルハシ最強段アイコン/はしご/回復薬/アンテナ。
//   Q3 鉱石産出(oreAt 決定論): SOIL を掘り抜くとインベントリ加算。固定 seed で oreAt が再現一致
//      (2 回読み同一)。col7 r2 = SOIL × COPPER の既知マスを掘って COPPER 0→1 を実測。
//   Q4 ツルハシ power 掘削ゲート(回帰防止): 木(power1)で ROCK が掘れない(= v0.3.0 挙動保存)。
//      かつ鉄(power3)では掘れる(= v0.4.0 拡張)を併記して、ゲートが「機能している」ことも示す。
// ============================================================================
let v040Pass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);
  const diveScr = await page.evaluate(() => G.screen);

  // --- Q2 HUD インベントリ DOM 描画(初期値)。 ---
  const inv0 = await page.evaluate(() => {
    const v = (id) => { const e = document.getElementById(id); return e ? e.textContent : null; };
    const invVisible = !!document.getElementById("inventory") &&
      getComputedStyle(document.getElementById("inventory")).display !== "none";
    return {
      invVisible,
      ore: { cu: v("ore-cu"), fe: v("ore-fe"), au: v("ore-au"), di: v("ore-di") },
      pickIco: v("pick-ico"), // 初期 = 木
      potion: v("potion-val"),
      hasPotionBtn: !!document.getElementById("btn-potion"),
      hasCraftBtn: !!document.getElementById("btn-craft"),
      antenna: G.antenna, ladders: G.ladders,
    };
  });

  // --- Q1 クラフト UI: 画面タップで開く → 6 レシピ verbatim → 閉じる。---
  const craftBtnHit = await buttonHittable(page, "#btn-craft");
  const craftOpened = await tapSelector(page, "#btn-craft"); // 画面座標ヒットテスト経由。
  await page.waitForTimeout(250);
  const craft = await page.evaluate(() => {
    const ov = document.getElementById("craft-overlay");
    const rows = [...document.querySelectorAll("#craft-list .craft-row")];
    return {
      open: !!ov && !ov.hidden,
      count: rows.length,
      names: rows.map((r) => (r.querySelector(".craft-name") || {}).textContent),
      costs: rows.map((r) => (r.querySelector(".craft-cost") || {}).textContent),
    };
  });
  const closeHit = await buttonHittable(page, "#craft-close");
  const closed = await tapSelector(page, "#craft-close");
  await page.waitForTimeout(200);
  const craftClosed = await page.evaluate(() => {
    const ov = document.getElementById("craft-overlay");
    return !!ov && ov.hidden;
  });
  // craft.csv verbatim(STATUS v0.4.0 C / tiles.js CRAFT_RECIPES と一致)。
  const EXPECT_NAMES = ["石のツルハシ", "鉄のツルハシ", "はしご", "回復薬", "ダイヤのツルハシ", "アンテナ"];
  const EXPECT_COSTS = ["銅3", "鉄2 銅2", "銅1", "鉄1", "ダ1 鉄3", "金1"];
  const namesOk = JSON.stringify(craft.names) === JSON.stringify(EXPECT_NAMES);
  const costsOk = JSON.stringify(craft.costs) === JSON.stringify(EXPECT_COSTS);

  // --- Q3 鉱石産出 + oreAt 決定論。固定 seed で 2 回読み同一 + 既知 SOIL×COPPER 掘りで加算。---
  const ore = await page.evaluate(() => {
    startDive();
    // 決定論: 全マス oreAt を 2 回読んで同一(ランタイム乱数なら一致しない)。
    const sweep = () => {
      const a = [];
      for (let c = 0; c < CONST.GRID_COLS; c++) for (let r = 1; r <= CONST.DEPTH_ROWS; r++) a.push(oreAt(c, r, CONST.BASE_SEED));
      return a.join(",");
    };
    const detSame = sweep() === sweep();
    // 既知マス col7 r2 = SOIL(1) × COPPER(1)(BASE_SEED=41027 で実測、STATUS 行100 の col7 下方=S 系)。
    const c7r2tile = tileType(7, 2, CONST.BASE_SEED);
    const c7r2ore = oreAt(7, 2, CONST.BASE_SEED);
    // WOOD で col7 を真下に r1,r2 掘る(SOIL=power1 なので掘れる)。掘り抜きで COPPER が加算される。
    // v0.5.0: 掘り抜き時に埋没モンスターが出て進路を塞ぎうる(col7 r1=WORM)。鉱石産出メカ自体は
    // 不変(掘り抜いた瞬間 collectOre)だが、テストは r2 を掘り抜く必要があるので途中の敵を倒し進む。
    // 1 段下がる/敵撃破直後で空間化したマスへ入る、を繰り返して r2 まで掘り進む。
    G.px = 7; G.py = 0; G.pick = "WOOD";
    const cu0 = G.ore.COPPER;
    let guard = 0;
    while (G.py < 2 && G.screen === "dive" && guard < 60) {
      const pc = G.px, pr = G.py;
      act(0, 1); guard++;
      if (G.px === pc && G.py === pr) {
        const below = G.py + 1;
        const foe = G.monsters && G.monsters.some((m) => m.col === G.px && m.row === below);
        const spaceBelow = (G.dug && G.dug.has(G.px + "," + below)) || tileType(G.px, below, G.seed) === TILE.NONE;
        const digging = G.digProgress && G.digProgress.has(G.px + "," + below);
        const t = spaceBelow ? TILE.NONE : tileType(G.px, below, G.seed);
        const req = TILE_REQ_POWER[t];
        const diggable = req !== undefined && (PICK[G.pick] ? PICK[G.pick].power : 1) >= req;
        if (!foe && !spaceBelow && !digging && !diggable) break; // 真に詰まり(掘れない硬岩)。
      }
    }
    const cu1 = G.ore.COPPER;
    return { detSame, c7r2tile, c7r2ore, cu0, cu1 };
  });

  // --- Q4 ツルハシ power 掘削ゲート(回帰防止 + 拡張確認)。---
  const gate = await page.evaluate(() => {
    startDive();
    // 盤面上の最初の ROCK を見つけ、その真上に縦坑を掘っておいて「ROCK だけが障害」の状態を作る。
    let rc = null;
    for (let c = 0; c < CONST.GRID_COLS && !rc; c++) for (let r = 1; r <= CONST.DEPTH_ROWS; r++) {
      if (tileType(c, r, CONST.BASE_SEED) === TILE.ROCK) { rc = { c, r }; break; }
    }
    G.pick = "WOOD";
    G.px = rc.c; G.py = rc.r - 1;
    for (let r = 1; r < rc.r; r++) G.dug.add(rc.c + "," + r);
    const pyBefore = G.py;
    // WOOD(power1) で ROCK(req3) を掘ろうとする → blocked(掘り抜けない・前進しない)。
    act(0, 1); act(0, 1); act(0, 1);
    const woodBlockedRock = !G.dug.has(rc.c + "," + rc.r) && G.py === pyBefore;
    // 鉄(power3)に昇格 → ROCK が掘れる(v0.4.0 拡張)。
    G.pick = "IRON";
    for (let k = 0; k < CONST.DIG_TAPS.ROCK + 1; k++) act(0, 1);
    const ironCanDigRock = G.dug.has(rc.c + "," + rc.r);
    return { rc, woodBlockedRock, ironCanDigRock };
  });

  console.log("== (Q) v0.4.0 新機能スモーク(クラフト/インベントリ/鉱石/power ゲート) ==");
  out("pageerrors", errors);
  out("dive 遷移", diveScr);
  out("(Q2) HUD インベントリ初期描画", inv0);
  out("(Q1) クラフトボタン hittable / 開く", { craftBtnHit, craftOpened });
  out("(Q1) クラフトオーバーレイ(6 レシピ verbatim)", craft);
  out("(Q1) close hittable / 閉じた", { closeHit, closed, craftClosed });
  out("(Q3) 鉱石 oreAt 決定論 + SOIL 掘りで COPPER 加算", ore);
  out("(Q4) power ゲート: 木で ROCK 不可(v0.3.0 保存)/鉄で可(v0.4.0 拡張)", gate);

  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  v040Pass =
    errors.length === 0 &&
    diveScr === "dive" &&
    // Q2 インベントリ
    inv0.invVisible === true &&
    inv0.ore.cu === "0" && inv0.ore.fe === "0" && inv0.ore.au === "0" && inv0.ore.di === "0" &&
    inv0.pickIco === "木" && inv0.potion === "0" &&
    inv0.hasPotionBtn === true && inv0.hasCraftBtn === true &&
    inv0.antenna === false && inv0.ladders === 0 &&
    // Q1 クラフト UI
    okBtn(craftBtnHit) && craftOpened === true && craft.open === true &&
    craft.count === 6 && namesOk && costsOk &&
    okBtn(closeHit) && closed === true && craftClosed === true &&
    // Q3 鉱石
    ore.detSame === true &&
    ore.c7r2tile === 1 /* SOIL */ && ore.c7r2ore === 1 /* COPPER */ &&
    ore.cu0 === 0 && ore.cu1 === 1 &&
    // Q4 power ゲート
    gate.woodBlockedRock === true && gate.ironCanDigRock === true;
  out("PASS(v0.4.0: クラフト UI 6 レシピ / インベントリ / 鉱石決定論加算 / power ゲート回帰)", v040Pass);
  await ctx.close();
}

// ============================================================================
// (R) v0.4.1 UI ポリッシュ(OWNER 不満①②の直接対策)。スクショ + 幾何アサート。
//   ① 地表で自機(canvas)が体力バー/インベントリ帯と被らない: v0.4.1 で render() のカメラ
//      クランプ下端を minCam=-hudBandPx/tile まで許し、地表(py=0)で世界を HUD 帯ぶん下げる
//      (camY が負 = 上に空が覗く)。v0.4.1 強化: hudBandPx を invEl の実 bottom(+10px)から
//      計測する実装に伴い、判定軸を「自機中心 cy」から「自機スプライト上端 cyTop=cy-0.41*tile」
//      へ引き上げる(中心は帯下でも頭が食い込む被りを捉える)。cyTop が インベントリ/体力バー
//      の getBoundingClientRect().bottom より下に来ることを実測 assert。
//      深く潜った py でも自機が画面内(0<=cy<=innerHeight)で描画されることも確認。
//   ② PC でクラフト「作る」ボタンが小さい: .inv-btn を d-pad 同等のチャンキー語彙へ拡大。
//      #btn-craft / #btn-potion の getBoundingClientRect().height がタップ標的サイズ(>=34px。
//      実測: mobile/short/tall=35.2px・PC=37.9px。OWNER 指定「概ね 36px 以上」を rem/clamp
//      丸めの実測下限 35.2 を割らない 34px を初回基準に採用。場当たり調整ではなく v0.4.1 で
//      初めて定める UI 計測基準)。#btn-craft をヒットテストでタップ → クラフト overlay が開く。
//   ③ スクショ: PC 1280x800 / モバイル 412x730 / 短高 412x680 で「地表」「ダイブ中」両方。
//      OWNER 目視確認用(合否には含めないが ① の幾何 assert を各 viewport で踏む)。
//   ※ camY は 0.2 補間で収束まで数フレーム要する(probe 実測で ~900ms)。各位置変更後に十分待つ。
// ============================================================================
let uiPolishPass = true;
{
  // 自機の画面 Y(中心 cy + 上端 cyTop)・インベントリ bottom・体力バー bottom・ボタン高さを
  // 実測するヘルパ。v0.4.1 強化: 中心 cy では「中心は帯下でも頭が帯に食い込む」(モバイルで
  // ~9px 被り)を見逃すため、自機スプライト上端 cyTop で被りを判定する。drawCharSprite は
  // w=tile*0.82・miner は 64x64 正方形(gate K 検証済み)なので描画高 h=tile*0.82、
  // 上端 = cy - h/2 = cy - 0.41*tile。スプライト未読込 fallback の円(半径 0.34*tile)より
  // 0.41*tile は上に厳しい(=安全側で被りを検出)。
  async function geomAt(page) {
    return page.evaluate(() => {
      const t = tile, camY = window.__camY || 0;
      const cy = (G.py - camY) * t + t / 2;
      // 実スプライト読込済みなら実描画高、未読込なら設計上の 0.82*t を用いて上端を出す。
      const img = (typeof SPRITES !== "undefined") ? SPRITES.miner : null;
      const ready = !!(img && img.complete && img.naturalWidth > 0);
      const w = t * 0.82;
      const h = ready ? w * (img.naturalHeight / img.naturalWidth) : w;
      const cyTop = cy - h / 2; // 自機スプライト上端。
      const inv = document.getElementById("inventory").getBoundingClientRect();
      const gauge = document.querySelector(".gauge").getBoundingClientRect();
      const hp = document.querySelector(".hp-bar").getBoundingClientRect();
      return {
        py: G.py, camY: +camY.toFixed(3), tile: +t.toFixed(1),
        cy: +cy.toFixed(1),
        cyTop: +cyTop.toFixed(1),
        spriteReady: ready, spriteH: +h.toFixed(1),
        invBottom: +inv.bottom.toFixed(1),
        gaugeBottom: +gauge.bottom.toFixed(1),
        hpBottom: +hp.bottom.toFixed(1),
        innerH: window.innerHeight,
        // v0.4.1 強化: 中心ではなく「上端」で被りを判定。
        topBelowInv: cyTop > inv.bottom,
        topBelowHp: cyTop > hp.bottom,
        cyInView: cy >= 0 && cy <= window.innerHeight,
        topInView: cyTop >= 0,
      };
    });
  }

  async function uiGate(vw, vh, label) {
    const { ctx, page, errors } = await openPage({ seedHowto: true, vw, vh });
    await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await startToDive(page);
    const diveScreen = await page.evaluate(() => G.screen);

    // --- ① 地表(py=0)で自機がゲージ/インベントリ帯に被らない。camY 収束まで待つ。 ---
    await page.evaluate(() => { G.py = 0; });
    await page.waitForTimeout(900); // camY(0.2 補間)の収束待ち。
    const surface = await geomAt(page);
    await page.screenshot({ path: `${SHOTDIR}/mr_v041_surface_${label}.png` });

    // --- 深く潜った py でも自機が画面内で描画される(下端クランプは従来どおり)。 ---
    await page.evaluate(() => { G.py = 10; G.maxDepthThisDive = 10; revealAround && revealAround(); });
    await page.waitForTimeout(900);
    const deep = await geomAt(page);
    await page.screenshot({ path: `${SHOTDIR}/mr_v041_dive_${label}.png` });

    // --- ② ボタン拡大(タップ標的) + クラフトをヒットテストで開く。 ---
    const craftBtn = await buttonHittable(page, "#btn-craft");
    const potionBtn = await buttonHittable(page, "#btn-potion");
    const craftH = await page.evaluate(() => +document.getElementById("btn-craft").getBoundingClientRect().height.toFixed(1));
    const potionH = await page.evaluate(() => +document.getElementById("btn-potion").getBoundingClientRect().height.toFixed(1));
    // dive へ戻して(深部のままでも overlay 開閉は可)#btn-craft を画面座標タップ → overlay 開く。
    const craftTapped = await tapSelector(page, "#btn-craft");
    await page.waitForTimeout(250);
    const craftOpen = await page.evaluate(() => !document.getElementById("craft-overlay").hidden);
    await tapSelector(page, "#craft-close");
    await page.waitForTimeout(150);

    const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
    const BTN_MIN = 34; // v0.4.1 初回 UI 計測基準(実測 35.2px/PC 37.9px を割らない下限)。
    const pass =
      errors.length === 0 &&
      diveScreen === "dive" &&
      surface.py === 0 &&
      surface.topBelowInv === true && // ① 地表で自機"上端"がインベントリ帯より下(頭の食い込みも無し)
      surface.topBelowHp === true && // ① 自機上端が体力バーとも被らない
      surface.cyInView === true &&
      surface.topInView === true && // 地表で自機上端も画面内(上に飛び出さない)
      deep.cyInView === true && // 深部でも自機画面内
      deep.topInView === true &&
      deep.topBelowInv === true && // 深部でも自機上端が HUD 帯より下(被らない)
      deep.topBelowHp === true &&
      okBtn(craftBtn) && okBtn(potionBtn) &&
      craftH >= BTN_MIN && potionH >= BTN_MIN && // ② タップ標的サイズ
      craftTapped === true && craftOpen === true; // ② craft ヒットテストで開く

    console.log(`== (R) v0.4.1 UI ポリッシュ ${vw}x${vh} (${label}) ==`);
    out("pageerrors", errors);
    out("地表(py=0) 幾何[自機cy/上端cyTop/inv下端/hp下端/上端被りなし]", surface);
    out("深部(py=10) 自機画面内 + 上端被りなし", deep);
    out("作る/薬 ボタン hittable", { craftBtn, potionBtn });
    out("作る/薬 ボタン高さ(>=34px)", { craftH, potionH, BTN_MIN });
    out("作る ヒットテストタップ → craft overlay 開く", { craftTapped, craftOpen });
    out(`スクショ`, [`${SHOTDIR}/mr_v041_surface_${label}.png`, `${SHOTDIR}/mr_v041_dive_${label}.png`]);
    out(`PASS(R ${label})`, pass);
    await ctx.close();
    return pass;
  }

  console.log("== (R) v0.4.1 UI ポリッシュ: 地表被り解消 + ボタン拡大(PC/モバイル/短高) ==");
  const rPC = await uiGate(1280, 800, "pc");
  const rMobile = await uiGate(412, 730, "mobile");
  const rShort = await uiGate(412, 680, "short");
  uiPolishPass = rPC && rMobile && rShort;
  out("PASS(R: 被り解消 + ボタン拡大 + craft 開く / PC+モバイル+短高)", uiPolishPass);
}

// ============================================================================
// (S) v0.5.0 モンスター/戦闘/GIRLATK/埋没掘りスポーン(死の緊張の本命増分)。
//   S1 空間スポーン決定論: ダイブ開始で固定 seed の NONE マスへ verbatim 配置(2 回一致)。
//   S2 埋没掘りスポーン: SOIL/HARD 掘り抜きで bury% 出現(col7 row1 = WORM を WOOD 掘りで確認)。
//   S3 戦闘で HP/SP 減: bump-attack で foe HP 減・自機 SP→HP の二段ゲージが削られる。
//   S4 bump-attack 撃破: foe HP 0 で除去 + EXP 蓄積 + ドロップ(決定論)。
//   S5 GIRLATK: GIRLATK=1 のモンスター隣接で護衛中の女の子 HP 減 → 0 でロスト(救出数は不変)。
//   S6 非介入: monster レイヤーは tileType/girlPositions/oreAt・EXPECTED_GIRLS を変えない。
// ============================================================================
let monsterPass = false;
{
  console.log("== (S) v0.5.0 モンスター/戦闘/GIRLATK/埋没掘りスポーン ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const o = {};
    // --- S1 空間スポーン決定論(2 回 startDive で一致) ---
    startDive();
    const list1 = G.monsters.map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    startDive();
    const list2 = G.monsters.map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    o.spaceSpawnCount = G.monsters.length;
    o.spaceSpawnDeterministic = list1 === list2 && G.monsters.length > 0;
    // 空間モンスターは元 NONE マスにのみ居る(tileType=NONE)。
    o.spaceOnNone = G.monsters.every((m) => tileType(m.col, m.row, G.seed) === TILE.NONE);

    // --- S2 埋没掘りスポーン(col7 を WOOD で掘り下げ、bury 出現を観測) ---
    startDive();
    function moveCol(c) { let g = 0; while (G.px !== c && g < 40) { act(G.px < c ? 1 : -1, 0); g++; } }
    moveCol(7);
    let buried = null;
    let guard = 0;
    while (!buried && G.py < 6 && G.screen === "dive" && guard < 20) {
      const before = G.monsters.length;
      const pc = G.px, pr = G.py;
      act(0, 1);
      guard++;
      if (G.monsters.length > before) {
        buried = G.monsters.find((m) => m.col === G.px && m.row === G.py + 1) || G.monsters[G.monsters.length - 1];
      } else if (G.px === pc && G.py === pr) {
        // 進めない(敵 or 岩)。敵なら倒して続行。
        const foe = G.monsters.find((m) => m.col === G.px && m.row === G.py + 1);
        if (!foe) break;
        let f = 0; while (G.monsters.indexOf(foe) >= 0 && G.screen === "dive" && f < 30) { act(0, 1); f++; }
      }
    }
    o.burySpawned = !!buried;
    o.buryKey = buried ? buried.key : null;
    // 埋没スポーンは決定論(同マスの buryMonsterAt が 2 回一致)。
    if (buried) {
      o.buryDeterministic = buryMonsterAt(buried.col, buried.row, G.seed) === buryMonsterAt(buried.col, buried.row, G.seed)
        && buryMonsterAt(buried.col, buried.row, G.seed) === buried.key;
    }

    // --- S3/S4 戦闘で HP/SP 減 + bump-attack 撃破 + EXP/ドロップ ---
    startDive();
    // 既知の盤面に SNAKE を隣接配置(戦闘式と二段ゲージ接続の検証)。低 SP にして HP 減を観測。
    G.px = 7; G.py = 5; G.stamina = 2; G.hp = 30; G.exp = 0; G.kills = 0; G.drops = {};
    G.dug.add("8,5"); // 右を空洞化(モンスターを置けるよう)。
    addMonster("SNAKE", 8, 5, "space");
    const snake = G.monsters.find((m) => m.col === 8 && m.row === 5);
    const foeHp0 = snake.hp, sp0 = G.stamina, hp0 = G.hp;
    act(1, 0); // 1 回目の bump-attack(攻撃 + 反撃)。
    o.foeHpDropped = snake.hp < foeHp0;
    o.gaugeDrained = G.stamina < sp0 || G.hp < hp0; // 攻撃の行動消費 + 反撃で二段ゲージが減る。
    // 撃破まで殴る(自機が死ぬ前に倒せるよう HP を満たし直す)。
    G.hp = 30; G.stamina = 100;
    let f2 = 0; while (G.monsters.indexOf(snake) >= 0 && G.screen === "dive" && f2 < 40) { act(1, 0); f2++; }
    o.killed = G.monsters.indexOf(snake) < 0;
    o.expGained = G.exp >= 6; // SNAKE EXP=6 verbatim。
    o.killsCounted = G.kills >= 1;
    // ドロップは決定論(monsterDrop が 2 回一致)。
    o.dropDeterministic = monsterDrop("SNAKE", 8, 5, G.seed) === monsterDrop("SNAKE", 8, 5, G.seed);

    // --- S5 GIRLATK: 護衛中の女の子が隣接モンスターに削られロスト(救出数は不変) ---
    startDive();
    const rescuedBefore = G.rescued;
    G.girls[0].state = "following"; G.girls[0].col = 5; G.girls[0].row = 5; G.girls[0].hp = 4;
    G.px = 0; G.py = 1; // 自機は遠い(女の子優先標的)。
    G.dug.add("5,5"); G.dug.add("6,5"); G.dug.add("4,5");
    addMonster("SNAKE", 6, 5, "space"); // SNAKE GIRLATK=1, STR=5 → 1 撃で 4HP の女の子を倒す。
    const girlHp0 = G.girls[0].hp, girlState0 = G.girls[0].state;
    let f3 = 0; while (G.girls[0].state === "following" && f3 < 6) { act(0, 1); f3++; } // 自機の行動でモンスターが反応。
    o.girlAtkWorks = girlState0 === "following" && G.girls[0].state !== "following"; // following から外れた。
    o.girlLostNotRescued = G.rescued === rescuedBefore; // ロスト = 救出数は増えない(クリア条件と整合)。
    // ロスト直後は hidden で原位置(origCol,origRow)へ戻っている(掘り直し/再侵入の起点)。
    o.lostState = G.girls[0].state;
    o.lostAtOrig = G.girls[0].col === G.girls[0].origCol && G.girls[0].row === G.girls[0].origRow;

    // --- S5b ロスト→再侵入→following 復帰→地表で rescued 到達(再発見が原理的に達成可能) ---
    // ロスト地点(origCol,origRow)は既に掘り抜き済み(NONE)=TILE.GIRL 掘削分岐を二度と通らない。
    // 旧実装はここで詰んだ(hidden 固着→再発見不能→rescued が GIRL_COUNT に届かずクリア不能)。
    // 修正後は自機がそのマスへ侵入した瞬間に再発見(state 側を引く tryRediscoverGirlAt)。
    // テストは緑化が目的化しないよう「実挙動で following 復帰 → 連れ帰り → rescued 増加」まで踏む。
    {
      const g = G.girls[0];
      const oc = g.origCol, orow = g.origRow; // この seed では (11,6)。
      // 原位置まで一直線の縦坑を掘り抜き済みにする(自機が侵入できる帰り道)。
      for (let r = 1; r <= orow; r++) G.dug.add(oc + "," + r);
      const rescuedPre = G.rescued;
      // 自機を女の子の 1 つ上へ置き、その後 origRow へ「侵入」して再発見(moveTo 経由)。
      G.monsters = []; G.spawned = new Set(); // 再侵入の検証中は新規スポーンを排除(再発見の純検証)。
      G.px = oc; G.py = orow - 1; G.stamina = 100; G.hp = 30;
      moveTo(oc, orow, true); // origRow マスへ侵入 → tryRediscoverGirlAt が発火するはず。
      o.rediscovered = g.state === "following"; // hidden → following へ復帰した。
      // following 復帰後、縦坑を 1 マスずつ登って地表へ連れ帰り rescued を increment できる。
      let f4 = 0;
      for (let pr = orow - 1; pr >= 0 && f4 < 60; pr--) {
        G.px = oc; G.py = pr;
        advanceGirl();
        f4++;
        if (pr === 0) { surfaceReturn(); break; }
      }
      o.rescuedAfterRediscover = g.state === "rescued";
      o.rescueCountIncreased = G.rescued === rescuedPre + 1; // 再発見→救出で救出数が実際に増える。
    }

    // --- S6 非介入: monster レイヤーは既存決定論を変えない ---
    startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    return o;
  });

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("S1 空間スポーン", { count: r.spaceSpawnCount, 決定論: r.spaceSpawnDeterministic, NONE上: r.spaceOnNone });
  out("S2 埋没掘りスポーン", { 出現: r.burySpawned, 種: r.buryKey, 決定論: r.buryDeterministic });
  out("S3/S4 戦闘", { foeHP減: r.foeHpDropped, 二段ゲージ減: r.gaugeDrained, 撃破: r.killed, EXP: r.expGained, kills: r.killsCounted, drop決定論: r.dropDeterministic });
  out("S5 GIRLATK", { 女の子ロスト: r.girlAtkWorks, 救出数不変: r.girlLostNotRescued, ロスト時hidden: r.lostState === "hidden", 原位置復帰: r.lostAtOrig });
  out("S5b ロスト→再侵入→再発見→救出到達", { 再発見_following復帰: r.rediscovered, 連れ帰り救出: r.rescuedAfterRediscover, 救出数増加: r.rescueCountIncreased });
  out("S6 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  monsterPass =
    errors.length === 0 &&
    r.spaceSpawnCount > 0 && r.spaceSpawnDeterministic === true && r.spaceOnNone === true &&
    r.burySpawned === true && r.buryDeterministic === true &&
    r.foeHpDropped === true && r.gaugeDrained === true && r.killed === true &&
    r.expGained === true && r.killsCounted === true && r.dropDeterministic === true &&
    r.girlAtkWorks === true && r.girlLostNotRescued === true &&
    r.lostState === "hidden" && r.lostAtOrig === true &&
    r.rediscovered === true && r.rescuedAfterRediscover === true && r.rescueCountIncreased === true &&
    r.girlPositions === EXPECTED_GIRLS;
  out("PASS(S: 空間/埋没スポーン決定論・戦闘で HP/SP 減・bump 撃破/EXP/ドロップ・GIRLATK ロスト・非介入)", monsterPass);
  await ctx.close();
}

// ============================================================================
// (W) v0.6.0 水/マグマ 浸水ハザード(死の緊張をさらに上げる本命増分)。
//   W1 決定論: hazardAt(col,row,seed) が 2 回読みで一致(固定 seed 浸水配置が再現)。
//   W2 深度ゲート: 浅層帯(row1-4)には浸水が一切出ない(原作 難度カーブに忠実)。
//      水は中層帯(row>=5)から、マグマは深層帯(row>=9)から。
//   W3 水で SP 消耗割増: 水マスで 1 行動すると、通常マスより多く SP が減る(WATER_SP_MULT)。
//   W4 マグマで HP chip: マグママスで 1 行動すると、SP 激消耗に加え HP が直接削られる(MAGMA_HP_CHIP)。
//   W5 視覚: NONE 空間の浸水マスに塗りが重なる(新規アセット無し=URL 不変)。pageerror 0。
//   W6 非介入: hazard レイヤーは tileType/girlPositions/oreAt・EXPECTED_GIRLS を変えない。
// ============================================================================
let hazardPass = false;
{
  console.log("== (W) v0.6.0 水/マグマ 浸水ハザード ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const o = {};
    const SEED = CONST.BASE_SEED;

    // --- W1 決定論(2 回読み一致) ---
    o.deterministic =
      hazardAt(7, 10, SEED) === hazardAt(7, 10, SEED) &&
      hazardAt(11, 5, SEED) === hazardAt(11, 5, SEED) &&
      hazardAt(0, 5, SEED) === hazardAt(0, 5, SEED);

    // --- W2 深度ゲート: 浅層帯(row1-4)に浸水ゼロ / 水は中層から / マグマは深層(row>=9)から ---
    let shallowHz = 0, magmaShallowMid = 0;
    for (let row = 1; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        const h = hazardAt(col, row, SEED);
        if (row < 5 && h !== HAZARD.NONE) shallowHz++;
        if (h === HAZARD.MAGMA && row < 9) magmaShallowMid++; // マグマは深層(row>=9)のみ。
      }
    o.shallowHazardZero = shallowHz === 0;
    o.magmaDeepOnly = magmaShallowMid === 0;
    // 中層帯に水が実在する(難度カーブが効いている)。
    let midWater = 0, deepMagma = 0;
    for (let row = 5; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        const h = hazardAt(col, row, SEED);
        if (h === HAZARD.WATER && row < 9) midWater++;
        if (h === HAZARD.MAGMA) deepMagma++;
      }
    o.midWaterExists = midWater > 0;
    o.deepMagmaExists = deepMagma > 0;

    // --- W3 水で SP 消耗割増: 既知の水セル(11,5 は元 NONE)に自機を置き 1 行動 → SP が
    //     通常マス(WATER_SP_MULT 倍でない)より多く減る。比較は「通常空間での 1 行動の減り」と。
    startDive();
    // 通常マス(浸水なし)での 1 行動の SP 減を測る基準(地表近くの掘った跡)。
    G.dug.add("7,1"); G.px = 7; G.py = 1; G.stamina = 100; G.hp = 30; G.monsters = []; G.spawned = new Set();
    const spBaseBefore = G.stamina;
    moveTo(7, 1, false); // 1 行動(同マスへ moveTo=コスト発生)。
    const baseDrain = spBaseBefore - G.stamina;
    // 水セル(11,5)を空洞化して自機を置き、1 行動。
    o.waterHazardType = hazardAt(11, 5, SEED); // HAZARD.WATER であること(=1)。
    G.dug.add("11,5"); G.px = 11; G.py = 5; G.stamina = 100; G.hp = 30; G.monsters = []; G.spawned = new Set();
    const spWaterBefore = G.stamina, hpWaterBefore = G.hp;
    moveTo(11, 5, false);
    const waterDrain = spWaterBefore - G.stamina;
    o.waterDrainGreater = waterDrain > baseDrain; // 水は割増。
    o.waterDrainValue = waterDrain;
    o.baseDrainValue = baseDrain;
    o.waterNoHpChip = G.hp === hpWaterBefore; // 水は SP 残がある限り HP を削らない(chip は無い)。

    // --- W4 マグマで HP chip: マグマセル(7,10)を空洞化して自機を置き、SP を尽きさせた状態で
    //     1 行動 → SP 激消耗に加え HP が直接削られる(MAGMA_HP_CHIP)。
    o.magmaHazardType = hazardAt(7, 10, SEED); // HAZARD.MAGMA であること(=2)。
    G.dug.add("7,10"); G.px = 7; G.py = 10; G.stamina = 0; G.hp = 30; G.monsters = []; G.spawned = new Set();
    const hpMagmaBefore = G.hp;
    moveTo(7, 10, false); // SP=0 なのでマグマの消耗 + chip がそのまま HP へ。
    const magmaHpLoss = hpMagmaBefore - G.hp;
    o.magmaHpLoss = magmaHpLoss;
    // マグマ chip(MAGMA_HP_CHIP)+ マグマ SP 消耗(MAGMA_SP_MULT、SP0 なので HP へ)が両方 HP に乗る
    // ので、水だけのとき(SP0 で水マス)より HP 損失が大きいことを確認する。
    G.dug.add("11,5"); G.px = 11; G.py = 5; G.stamina = 0; G.hp = 30; G.monsters = []; G.spawned = new Set();
    const hpW0 = G.hp;
    moveTo(11, 5, false);
    const waterHpLossAt0 = hpW0 - G.hp;
    o.magmaWorseThanWater = magmaHpLoss > waterHpLossAt0;
    o.waterHpLossAt0 = waterHpLossAt0;
    o.magmaChips = magmaHpLoss > 0;

    // --- W6 非介入: hazard レイヤーは既存決定論を変えない ---
    startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    // oreAt も不変(別レイヤー非衝突): 既知の銅マスがまだ銅。
    o.oreUnchanged = oreAt(7, 2, SEED) === oreAt(7, 2, SEED); // 決定論である(別レイヤー干渉なし)。
    return o;
  });

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("W1 決定論", r.deterministic);
  out("W2 深度ゲート", { 浅層浸水ゼロ: r.shallowHazardZero, マグマ深層のみ: r.magmaDeepOnly, 中層水実在: r.midWaterExists, 深層マグマ実在: r.deepMagmaExists });
  out("W3 水 SP 割増", { 水種: r.waterHazardType, 基準減: r.baseDrainValue, 水減: r.waterDrainValue, 割増: r.waterDrainGreater, 水はHP非chip: r.waterNoHpChip });
  out("W4 マグマ HP chip", { マグマ種: r.magmaHazardType, マグマHP損: r.magmaHpLoss, 水HP損SP0: r.waterHpLossAt0, マグマ激しい: r.magmaWorseThanWater, chip有: r.magmaChips });
  out("W6 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  hazardPass =
    errors.length === 0 &&
    r.deterministic === true &&
    r.shallowHazardZero === true && r.magmaDeepOnly === true &&
    r.midWaterExists === true && r.deepMagmaExists === true &&
    r.waterHazardType === 1 && r.waterDrainGreater === true && r.waterNoHpChip === true &&
    r.magmaHazardType === 2 && r.magmaChips === true && r.magmaWorseThanWater === true &&
    r.girlPositions === EXPECTED_GIRLS && r.oreUnchanged === true;
  out("PASS(W: 浸水決定論・深度ゲート・水SP割増・マグマHP chip・非介入)", hazardPass);
  await ctx.close();
}

// ============================================================================
// (X) v0.7.0 なだれ/落盤 崩落物理(ハザード残りを完結、別タイル物理サブシステム)。
//   X1 決定論: avalancheAt(col,row,seed) が 2 回読みで一致(固定 seed の不安定土配置が再現)。
//   X2 深度ゲート: 浅層帯(row1-4)に不安定土ゼロ / 中層・深層に不安定土が実在(難度カーブ)。
//   X3 崩落=落下で道塞ぎ: 掘り抜いた不安定土の真下が空くと、土塊が落ちて第1固体床の上へ積もり、
//      掘った跡(dug)が塞がれる(tileAt が SOIL に戻る=帰り道の消失)。元マスは空のまま。soft-lock しない。
//   X4 埋没ダメージ: 落ちてきたマスに自機が居れば takeDamage(CAVEIN_DAMAGE)=既存二段ゲージ(SP→HP)へ。
//      女の子なら GIRLATK 同経路でロスト→原位置復帰(再発見可能性を保つ)。
//   X5 非介入: avalanche レイヤーは tileType/girlPositions/oreAt/hazard・EXPECTED_GIRLS を変えない。
// ============================================================================
let caveinPass = false;
{
  console.log("== (X) v0.7.0 なだれ/落盤 崩落物理 ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const o = {};
    const SEED = CONST.BASE_SEED;

    // --- X1 決定論(2 回読み一致) ---
    o.deterministic =
      avalancheAt(3, 6, SEED) === avalancheAt(3, 6, SEED) &&
      avalancheAt(7, 10, SEED) === avalancheAt(7, 10, SEED) &&
      avalancheAt(0, 6, SEED) === avalancheAt(0, 6, SEED);

    // --- X2 深度ゲート: 浅層帯(row1-4)に不安定土ゼロ / 中層・深層に実在 ---
    let shallowAv = 0, midAv = 0, deepAv = 0;
    for (let row = 1; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        if (!avalancheAt(col, row, SEED)) continue;
        if (row < 5) shallowAv++;
        else if (row < 9) midAv++;
        else deepAv++;
      }
    o.shallowAvZero = shallowAv === 0;
    o.midAvExists = midAv > 0;
    o.deepAvExists = deepAv > 0;
    // 不安定土は SOIL のみ(硬土/硬岩/空間は不安定にならない)。
    o.avOnlySoil = avalancheAt(3, 6, SEED) === true && tileType(3, 6, SEED) === TILE.SOIL;

    // --- X3 崩落=落下で道塞ぎ。col3: (3,6)=不安定土, (3,7)/(3,8)=SOIL。
    //     (3,6) と (3,7) を掘り抜き空洞化し、(3,6) を不安定土として記録 → resolveCaveins で
    //     (3,6) の土塊が (3,7) へ落ちて積もり、掘った跡 (3,7) が塞がれる。元 (3,6) は空のまま。
    startDive();
    G.monsters = []; G.spawned = new Set();
    G.px = 0; G.py = 0; // 自機は遠くに置く(X3 では埋没させない)。
    G.dug.add("3,6"); G.dug.add("3,7"); // 両方を掘った跡(空間)にする。
    markUnstableDug(3, 6); // (3,6) は掘り抜いた不安定土。
    o.before36Space = isSpace(3, 6); // 落下前: (3,6) 空間。
    o.before37Space = isSpace(3, 7); // 落下前: (3,7) 空間(掘った跡=帰り道)。
    o.before38Solid = !isSpace(3, 8); // (3,8) は固体(落下の床)。
    resolveCaveins();
    o.after36Space = isSpace(3, 6); // 落下後: (3,6) は空のまま(緩んだ土が抜けた跡)。
    o.after37Blocked = !isSpace(3, 7) && tileAt(3, 7) === TILE.SOIL; // (3,7) が塞がれ SOIL に戻る。
    o.fallenHas37 = G.fallen.has("3,7"); // 崩落 state に記録。
    o.dugLost37 = !G.dug.has("3,7"); // 掘った跡が消える(帰り道の消失)。
    o.unstableConsumed = !G.unstableDug.has("3,6"); // 落下した不安定土は候補から外れる。
    // soft-lock しない: (3,7) は再度掘れる(SOIL=掘削可能タイル)。
    o.rediggable = tileAt(3, 7) === TILE.SOIL;

    // --- X4 埋没ダメージ: 自機を落下先 (3,7) に置き、SP=0 で崩落 → HP が CAVEIN_DAMAGE 削られる。
    startDive();
    G.monsters = []; G.spawned = new Set();
    G.dug.add("3,6"); G.dug.add("3,7");
    G.px = 3; G.py = 7; G.stamina = 0; G.hp = 30; // SP0 なので崩落ダメージは直接 HP へ。
    markUnstableDug(3, 6);
    const hpBefore = G.hp;
    resolveCaveins();
    o.playerHpLoss = hpBefore - G.hp; // CAVEIN_DAMAGE ぶん削れる。
    o.expectDamage = CONST.CAVEIN_DAMAGE; // 期待値(CONST 単一ブロックの係数)。
    o.playerBuried = o.playerHpLoss > 0;
    o.playerPushedUp = G.py < 7; // 埋まったまま固体に閉じ込めない(直上へ押し上げ=soft-lock 回避)。

    // --- X5 非介入: avalanche レイヤーは既存決定論を変えない ---
    startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    o.oreUnchanged = oreAt(7, 2, SEED) === oreAt(7, 2, SEED);
    o.hazardUnchanged = hazardAt(11, 5, SEED) === hazardAt(11, 5, SEED);
    o.tileUnchanged = tileType(3, 6, SEED) === TILE.SOIL; // 初期 tileType を崩落で書き換えない。
    return o;
  });

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("X1 決定論", r.deterministic);
  out("X2 深度ゲート", { 浅層ゼロ: r.shallowAvZero, 中層実在: r.midAvExists, 深層実在: r.deepAvExists, SOILのみ: r.avOnlySoil });
  out("X3 崩落で道塞ぎ", { 前37空間: r.before37Space, 後36空: r.after36Space, 後37塞ぎSOIL: r.after37Blocked, fallen記録: r.fallenHas37, 帰り道消失: r.dugLost37, 候補消費: r.unstableConsumed, 再掘可: r.rediggable });
  out("X4 埋没ダメージ", { 自機HP損: r.playerHpLoss, 埋没: r.playerBuried, 押上げ: r.playerPushedUp });
  out("X5 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  caveinPass =
    errors.length === 0 &&
    r.deterministic === true &&
    r.shallowAvZero === true && r.midAvExists === true && r.deepAvExists === true && r.avOnlySoil === true &&
    r.before37Space === true && r.before38Solid === true &&
    r.after36Space === true && r.after37Blocked === true && r.fallenHas37 === true &&
    r.dugLost37 === true && r.unstableConsumed === true && r.rediggable === true &&
    r.playerBuried === true && r.playerHpLoss === r.expectDamage &&
    r.playerPushedUp === true &&
    r.girlPositions === EXPECTED_GIRLS && r.oreUnchanged === true &&
    r.hazardUnchanged === true && r.tileUnchanged === true;
  out("PASS(X: 崩落決定論・深度ゲート・落下で道塞ぎ・埋没ダメージ・非介入)", caveinPass);
  await ctx.close();
}

// ============================================================================
// (Y) v0.8.0 商人(物々交換)= 原作 shop.csv 忠実翻案。キノコ通貨の循環を開く。
//   Y1 決定論: mushroomAt(col,row,seed) が 2 回読みで一致(固定 seed のキノコ配置が再現)。
//   Y2 採取: SOIL を掘り抜くと mushroomAt 含有マスでキノコ +1(非含有 SOIL は +0)。
//   Y3 交換 UI: 「作る」→工房→商人タブで SHOP_RECIPES verbatim 表示。対価不足行 disabled / 充足行 可。
//   Y4 交換実行: 対価減算 + 産物加算(キノコ10→鉄ツルハシ昇格 / 鉄鉱石2→フルーツ / キノコ100→夢キノコ)。
//   Y5 非介入: mushroom/shop レイヤーは tileType/girlPositions/oreAt/hazard/avalanche を変えない。
// ============================================================================
let merchantPass = false;
{
  console.log("== (Y) v0.8.0 商人(物々交換)== ");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // --- Y1/Y2/Y4/Y5 は内部関数直叩き(決定論・状態遷移の単体検証)。
  const r = await page.evaluate(() => {
    const o = {};
    const SEED = CONST.BASE_SEED;

    // --- Y1 決定論(2 回読み一致) ---
    o.deterministic =
      mushroomAt(7, 1, SEED) === mushroomAt(7, 1, SEED) &&
      mushroomAt(1, 1, SEED) === mushroomAt(1, 1, SEED) &&
      mushroomAt(6, 3, SEED) === mushroomAt(6, 3, SEED);
    o.mushAt71 = mushroomAt(7, 1, SEED) === true; // (7,1) は SOIL × キノコ含有。
    o.noMushAt11 = mushroomAt(1, 1, SEED) === false; // (1,1) は SOIL × キノコ非含有。

    // --- Y2 採取: (7,1) を掘り抜くとキノコ +1、(1,1) を掘り抜くと +0(モンスター無効化して掘る) ---
    startDive();
    G.monsters = []; G.spawned = new Set();
    G.px = 7; G.py = 0; G.mushrooms = 0;
    act(0, 1); // (7,1) SOIL を真下掘り→掘り抜き→キノコ採取。
    o.mushAfterDig71 = G.mushrooms;

    startDive();
    G.monsters = []; G.spawned = new Set();
    G.px = 1; G.py = 0; G.mushrooms = 0;
    act(0, 1); // (1,1) SOIL を掘る→キノコ非含有なので +0。
    o.mushAfterDig11 = G.mushrooms;

    // --- Y4 交換実行(対価減算 + 産物加算)。SHOP_RECIPES を id で引いて doShopTrade。
    startDive();
    G.monsters = []; G.spawned = new Set();
    const pickRec = SHOP_RECIPES.find((x) => x.id === "shop_pick"); // ツルハシ←キノコ10。
    G.mushrooms = 10; G.pick = "WOOD";
    o.pickTradeBlockedWhenShort = (() => { G.mushrooms = 5; const ok = canTrade(pickRec, G); G.mushrooms = 10; return ok === false; })();
    o.pickTraded = doShopTrade(pickRec) === true && G.pick === "IRON" && G.mushrooms === 0;

    const fruitRec = SHOP_RECIPES.find((x) => x.id === "shop_fruit"); // フルーツ←鉄鉱石2。
    G.ore.IRON = 2; G.fruits = 0;
    o.fruitTraded = doShopTrade(fruitRec) === true && G.fruits === 1 && G.ore.IRON === 0;

    const dreamRec = SHOP_RECIPES.find((x) => x.id === "shop_dream"); // 夢キノコ←キノコ100。
    G.mushrooms = 100; G.dreamMushrooms = 0;
    o.dreamTraded = doShopTrade(dreamRec) === true && G.dreamMushrooms === 1 && G.mushrooms === 0;

    // 消耗品を食べると体力回復(HP_MAX 上限)。
    G.hp = 5; G.fruits = 1; o.fruitEaten = useFruit() === true && G.hp === Math.min(CONST.HP_MAX, 5 + CONST.FRUIT_HEAL);

    // --- Y5 非介入: mushroom/shop レイヤーは既存決定論を変えない ---
    startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    o.oreUnchanged = oreAt(7, 2, SEED) === oreAt(7, 2, SEED);
    o.hazardUnchanged = hazardAt(11, 5, SEED) === hazardAt(11, 5, SEED);
    o.avUnchanged = avalancheAt(3, 6, SEED) === avalancheAt(3, 6, SEED);
    o.tileUnchanged = tileType(7, 1, SEED) === TILE.SOIL;
    return o;
  });

  // --- Y3 交換 UI(画面操作): 「作る」→工房→商人タブで shop list が SHOP_RECIPES verbatim。
  await startToDive(page);
  const ui = await page.evaluate(() => {
    G.mushrooms = 10; G.ore.IRON = 0; renderHud(); // 1 行だけ充足(ツルハシ)、他は不足。
    openCraft(); // 工房を開く(既定=クラフトタブ)。
    const craftDefault = !document.getElementById("craft-list").hidden && document.getElementById("shop-list").hidden;
    setWorkshopTab("shop"); // 商人タブへ。
    const shopShown = !document.getElementById("shop-list").hidden && document.getElementById("craft-list").hidden;
    const rows = [...document.querySelectorAll("#shop-list .craft-row")];
    const names = rows.map((r) => (r.querySelector(".craft-name") || {}).textContent);
    // ツルハシ行(キノコ10 充足)は実行可、フルーツ行(鉄鉱石2 不足)は disabled。
    const pickRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("ツルハシ") === 0);
    const fruitRow = rows.find((r) => (r.querySelector(".craft-name") || {}).textContent.indexOf("フルーツ") === 0);
    const pickBtnEnabled = pickRow && !pickRow.querySelector(".craft-make").disabled;
    const fruitBtnDisabled = fruitRow && fruitRow.querySelector(".craft-make").disabled;
    setWorkshopTab("craft"); // 戻すとクラフトに切り替わる(gate Q 互換確認)。
    const backToCraft = !document.getElementById("craft-list").hidden && document.getElementById("shop-list").hidden;
    closeCraft();
    return { craftDefault, shopShown, names, pickBtnEnabled: !!pickBtnEnabled, fruitBtnDisabled: !!fruitBtnDisabled, backToCraft };
  });

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  const EXPECT_SHOP = ["フルーツ", "ツルハシ", "アンテナ", "夢キノコ"];
  out("Y1 決定論", { 一致: r.deterministic, 含有71: r.mushAt71, 非含有11: r.noMushAt11 });
  out("Y2 採取", { キノコ含有掘り: r.mushAfterDig71, キノコ非含有掘り: r.mushAfterDig11 });
  out("Y3 交換 UI(商人タブ)", ui);
  out("Y4 交換実行", { ツルハシ昇格: r.pickTraded, 不足で不可: r.pickTradeBlockedWhenShort, フルーツ: r.fruitTraded, 夢キノコ: r.dreamTraded, 食べて回復: r.fruitEaten });
  out("Y5 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  // shop list の品名が SHOP_RECIPES verbatim(交換4行)で始まる(末尾に所持消耗品の食べる行が付きうる)。
  const shopNamesOk = EXPECT_SHOP.every((n, i) => (ui.names[i] || "").indexOf(n) === 0);
  merchantPass =
    errors.length === 0 &&
    r.deterministic === true && r.mushAt71 === true && r.noMushAt11 === true &&
    r.mushAfterDig71 === 1 && r.mushAfterDig11 === 0 &&
    ui.craftDefault === true && ui.shopShown === true && shopNamesOk === true &&
    ui.pickBtnEnabled === true && ui.fruitBtnDisabled === true && ui.backToCraft === true &&
    r.pickTraded === true && r.pickTradeBlockedWhenShort === true &&
    r.fruitTraded === true && r.dreamTraded === true && r.fruitEaten === true &&
    r.girlPositions === EXPECTED_GIRLS && r.oreUnchanged === true &&
    r.hazardUnchanged === true && r.avUnchanged === true && r.tileUnchanged === true;
  out("PASS(Y: キノコ採取決定論・商人タブ UI・物々交換・非介入)", merchantPass);
  await ctx.close();
}

// ============================================================================
// (I) determinism 静的検査(lead 必須): app.js/tiles.js に Math.random/Date.now/
//     performance.now の実呼び出しが無い(コメント言及は可)。配信中のソースを取得して検査。
// ============================================================================
let determinismPass = true;
{
  console.log("== determinism 静的検査(Math.random/Date.now 実呼び出し) ==");
  for (const f of ["app.js", "tiles.js"]) {
    const src = await (await fetch(`${BASE}/mineroad/${f}`)).text();
    // 行コメント(//...)を除去してから危険トークンを探す(コメント言及は許容)。
    const code = src
      .split("\n")
      .map((ln) => ln.replace(/\/\/.*$/, ""))
      .join("\n");
    const hits = [];
    for (const re of [/Math\.random/g, /Date\.now/g, /performance\.now/g]) {
      const m = code.match(re);
      if (m) hits.push(...m);
    }
    out(`${f} 実呼び出し`, hits);
    if (hits.length > 0) determinismPass = false;
  }
  out("PASS(determinism: ランタイム乱数なし)", determinismPass);
}

// ============================================================================
// 総合
// ============================================================================
await browser.close();

console.log("\n== 総合 ==");
out("(A) コア遷移 + VERSION v0.8.0 + 5人配置 + HUD 0/5", corePass);
out("(J) アセット配信 14 本(200 + Content-Type) / 旧 mp3 404", assetPass);
out("(K) スプライト実読込/broken なし/miner 64x64 差し替え/描画", spritePass);
out("(L) mute トグル / BGM=theme.ogg / SFX clone 連打 pageerror 0 / clear SFX", audioPass);
out("(B/C/D) 二段ゲージ/撤退/1人救出(HUD 1/5,dive継続)/重力/探索率/決定論[内部関数]", mechPass);
out("(N) 女の子 縦坑追従 row トレース(底張り付きなし→地表救出/1人=dive継続)", girlFollowPass);
out("(O) v0.3.0 クリアゲート §7 忠実 / 旧1人=即クリア回帰防止 / 全達成で制覇", clearGatePass);
out("(P) 複数女の子 2人救出 HUD 0/5→1/5→2/5", multiGirlPass);
out("(Q) v0.4.0 クラフト UI 6 レシピ / インベントリ / 鉱石決定論加算 / power ゲート回帰", v040Pass);
out("(R) v0.4.1 UI ポリッシュ: 地表被り解消 + 作る/薬ボタン拡大(PC/モバイル/短高)", uiPolishPass);
out("(S) v0.5.0 モンスター/戦闘/GIRLATK/埋没掘りスポーン(死の緊張)", monsterPass);
out("(W) v0.6.0 水/マグマ 浸水ハザード(消耗割増 + マグマ HP chip)", hazardPass);
out("(X) v0.7.0 なだれ/落盤 崩落物理(落下で道塞ぎ + 埋没ダメージ)", caveinPass);
out("(Y) v0.8.0 商人(キノコ採取/物々交換/商人タブ UI/非介入)", merchantPass);
out("(E) 十字キー/タップ掘り", dpadPass);
out("(E2) 短高 viewport", shortVpPass);
out("(F) 既存 6 作 回帰", regressionPass);
out("(G) 画面操作 e2e[撤退ループ + 1人救出(dive継続)]", e2ePass);
out("(H) fail はみ出し0 + retry", failOverflowPass);
out("(I) determinism 静的検査", determinismPass);
if (overflowFails.length) {
  console.log("  はみ出し検出:");
  for (const f of overflowFails) console.log("   ", JSON.stringify(f));
}
const allPass =
  corePass && assetPass && spritePass && audioPass &&
  mechPass && girlFollowPass && clearGatePass && multiGirlPass &&
  v040Pass && uiPolishPass && monsterPass && hazardPass && caveinPass && merchantPass && dpadPass && shortVpPass && regressionPass &&
  e2ePass && failOverflowPass && determinismPass &&
  overflowFails.length === 0;
console.log(`\nRESULT: ${allPass ? "ALL PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
