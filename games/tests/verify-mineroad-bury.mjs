// verify-mineroad-bury.mjs — マインロード v0.17.0「埋没モンスター機構の原作合わせ」独立検証(playtester)。
//
// 実装側テスト(selfcheck-mineroad-bury.mjs / debug-mineroad.mjs gate S2)とは**別実装・別シナリオ**:
// selfcheck は G.monsters/G.px への state 注入でシナリオを構築するが、本テストは seed 41027(裏庭)の
// 実盤面から事前導出した固定経路を**実タップのみ**で踏む(state 注入 0 件。世界生成にもランタイム state
// にも一切触れない)。期待値は probe-bury-board(盤面ダンプ)で導出した決定論リテラルを直接 assert。
//
// 経路計画(seed 41027 実測、2026-07-19 導出。wake=CONST.BURIED_WAKE_RANGE=4):
//   - 埋没 17 体 = SPIDER11(bury100)/WORM3(bury100)/SLIME3(bury30)。全 bury100 種は圏内 1 tick で
//     必ず脱出(escBt=1)。SLIME は (5,6)H escBt=1 / (2,8)S escBt=2 / (1,12)H escBt=1。
//   - 掘り当ての成立条件: 深部からの接近は Chebyshev 4→1 で最低 4 回の圏内 resolveTurn を踏むため
//     escBt<=2 のこの盤面では不可能。唯一の例外 = 地表行(row0)は moveTo→surfaceReturn 早期 return で
//     resolveTurn を通らない → (7,0)→(4,0) を歩き (4,1)SPIDER を tick 0 回で直掘りできる。
//   - 自力脱出の分離観測: col3 は r1..r11 全 SOIL(木ツルハシで掘れる)。直下掘りで
//     (3,4) 到達 = (2,8)SLIME の圏内 tick1(衰弱のみ hp15→14, bt1, roll 失敗)、
//     (3,5) 到達 = tick2(hp→13, bt2, roll 成功=脱出・空間化)。(3,6) へ進むと (0,10)SPIDER の圏
//     (cols0-4,rows6-14)に入るため (3,5) で停止。
//   - 道中の副次脱出(決定論): (3,2) 到達で (5,6)SLIME 脱出(hp14,bt1)、(3,4) 到達で (5,8)SPIDER
//     脱出(hp5,bt1)。脱出後 3 体はいずれも周囲全固体の閉鎖ポケット=bfsStep 経路なしで静止。
//   - 空間スポーン 7 体((12,4)(11,5)BAT/(4,7)SPIDER/(12,8)BAT/(11,14)BAT/(6,15)BAT/(13,15)SNAKE)は
//     全て閉鎖ポケットで経路非干渉。なだれ土 0(崩落なし)。水 hazard は全て row>=11(経路外)、
//     初期播種水は (13,15) の 1 マス孤立静止。
//   - SP 台帳(HP30 は不変): 地表歩行 = surfaceReturn 全回復で実質 0。掘り当てタップ 100-1-2(反撃)=97。
//     bump 攻撃 6 回(playerAtk2 - SPIDER def1 = 1 ダメ/回、hp6→0。生存 5 回ぶん反撃 2/回):
//     94,91,88,85,82,81(6 回目は撃破で反撃なし)。(3,0) 帰還で 100。降下 5 掘りで 99..95。
//     クライム 4 回で 94..91、(3,0) 帰還で 100。
//
// 入力規律(tests/ ルール): 全入力は page.mouse の画面座標タップ + タップ直前に elementFromPoint で
// 最前面 = #scene(canvas) を assert(canvas への直接 dispatch なし = overlay 飛び越え PASS の穴を塞ぐ)。
//
// 検証項目(親指示):
//   V1 生成時配置: ダイブ開始直後 G.monsters に埋没 17 体(リテラル一致)+ 配置マスは固体のまま +
//      可視化された埋没マスの画面ピクセルが素の SOIL マスと同一(非描画)+ 地表歩行では tick が走らない
//   V2 掘り当てアクティブ化: (4,1) を実タップ掘削 → そこに居た個体が hp 満タンのまま即アクティブ化 +
//      自機非前進 + popup/ヒント演出 + 直後の resolveTurn で隣接反撃(アクティブ化の実効)
//   V3 自力脱出: (2,8)SLIME の圏内 tick1 = HP-1 のみ(bt1・buried 維持・dug なし)→ tick2 = 決定論
//      どおり脱出(セル空間化 = dug 入り・アクティブ化・画面ピクセル変化)。bury100 種の即時脱出も
//      道中 2 体((5,6)(5,8))で確認
//   V4 圏外静止: wake range 外の 13 体は全行程を通じて hp/bt/buried/位置が初期値のまま不変
//   V5 buried 非 bump: 隣から埋没マスへのタップが攻撃でなく掘削になる(アクティブ化時 hp6 無傷。
//      攻撃なら playerAtk2-def1=1 ダメで hp5 になるはず)。アクティブ化後は bump 攻撃対象に戻る(対比)
//   V6 決定論: fresh コンテキスト 2 回で同一操作列 → 全スナップショット(monsters/dug/fluid/HP/SP)一致
//   V7 回帰: 既存 5 URL + healthz 全 200 / 短高 viewport 412x680・730 で必須ボタン in-view + はみ出し 0 /
//      pageerror 0
//
// 実行: 本番 47825 は使わない。別ポート(既定 47894)で server/app.py を自前起動してから
//   GAMES_BASE=http://127.0.0.1:47894 node tests/verify-mineroad-bury.mjs
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47894";
const failures = [];
const log = (k, v) => console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
function check(name, cond, detail) {
  log((cond ? "ok " : "NG ") + name, detail === undefined ? cond : detail);
  if (!cond) failures.push(name);
  return cond;
}

// 期待値リテラル(probe-bury-board 導出、seed 41027 裏庭)。key@col,row:hp:bt でソート連結。
const EXPECTED_BURIED_17 = [
  "SPIDER@4,1", "WORM@13,1", "SPIDER@10,5", "WORM@12,5", "SLIME@5,6", "SPIDER@14,6",
  "SLIME@2,8", "SPIDER@5,8", "SPIDER@0,10", "SPIDER@7,11", "SPIDER@9,11", "SPIDER@13,11",
  "SPIDER@0,12", "SLIME@1,12", "WORM@7,12", "SPIDER@13,12", "SPIDER@4,13",
];
const HP_OF = { SPIDER: 6, WORM: 5, SLIME: 15 };
// 全行程で圏外のまま残るべき 13 体(V4)。
const UNTOUCHED_13 = EXPECTED_BURIED_17.filter(
  (s) => !["SPIDER@4,1", "SLIME@5,6", "SLIME@2,8", "SPIDER@5,8"].includes(s)
);

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

// カメラ lerp の整定を実測ポーリングで待つ(裏庭は maxCam=0 だが地表側は負 camY へ lerp する)。
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
  const p = await page.evaluate(([dc, dr]) => {
    const r = document.getElementById("scene").getBoundingClientRect();
    const cam = window.__camY || 0;
    return {
      x: r.left + (G.px + dc) * tile + tile / 2,
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

// 埋没機構スナップショット: 全モンスター("key@c,r:hp:bt:buried:cd" ソート連結)+ 主要 state。
const snap = (page) =>
  page.evaluate(() => ({
    px: G.px,
    py: G.py,
    hp: G.hp,
    sp: G.stamina,
    spHud: document.getElementById("stamina-val").textContent,
    monsters: G.monsters
      .map((m) => `${m.key}@${m.col},${m.row}:${m.hp}:${m.bt || 0}:${m.buried ? 1 : 0}:${m.cd || 0}`)
      .sort()
      .join("|"),
    buriedCount: G.monsters.filter((m) => m.buried).length,
    dug: [...G.dug].sort().join("|"),
    fluid: [...G.fluid.entries()].map(([k, f]) => `${k}:${f.k},${f.d}`).sort().join("|"),
    exp: G.exp,
    kills: G.kills,
    drops: Object.entries(G.drops).sort().map(([k, v]) => `${k}:${v}`).join("|"),
    seenSize: G.seen.size,
    screen: G.screen,
  }));

// 個体 1 体の状態を読む(位置キーで特定)。
const monState = (page, col, row) =>
  page.evaluate(([c, r]) => {
    const m = G.monsters.find((m) => (m.origCol !== undefined ? m.origCol : m.col) === c && (m.origRow !== undefined ? m.origRow : m.row) === r) ||
      G.monsters.find((m) => m.col === c && m.row === r);
    if (!m) return null;
    return { key: m.key, col: m.col, row: m.row, hp: m.hp, bt: m.bt || 0, buried: m.buried === true };
  }, [col, row]);

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
const pixDiff = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));

const hintText = (page) =>
  page.evaluate(() => (document.getElementById("hud-hint").hidden ? "" : document.getElementById("hud-hint").textContent));
const popupText = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".popup")].map((p) => p.textContent).join(","));

// ============================================================================
// メインシナリオ(実タップ経路、state 注入 0 件)。fail 記録は run 1 のみ(check)、run 2 は決定論照合用。
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

  // ---- 遷移: タイトル(版数)→ダイブ ----
  const ver = await page.evaluate(() => {
    const el = document.getElementById("ov-version");
    return el ? el.textContent : "";
  });
  ck("遷移 タイトルに v0.17.0 表示", ver.includes("v0.17.0"), ver);
  const dive = await startDive(page);
  ck("遷移 ダンジョン選択タップ(最前面)→dive", dive.ok && dive.t.front, dive);
  await camSettle(page);

  // ---- V1 生成時配置 ----
  const s0 = await rec("start");
  const buriedList0 = await page.evaluate(() =>
    G.monsters.filter((m) => m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|")
  );
  ck("V1 埋没 17 体がダイブ開始直後から存在(リテラル一致)",
    buriedList0 === [...EXPECTED_BURIED_17].sort().join("|") && s0.buriedCount === 17,
    { count: s0.buriedCount });
  const initOk = await page.evaluate(() =>
    G.monsters.filter((m) => m.buried).every(
      (m) => m.hp === MONSTER[m.key].hp && (m.bt || 0) === 0 &&
        m.origCol === m.col && m.origRow === m.row &&
        tileAt(m.col, m.row) !== TILE.NONE && !G.dug.has(m.col + "," + m.row)
    )
  );
  ck("V1 全埋没個体: hp 満タン・bt0・配置マスは固体のまま(dug 外)", initOk, initOk);
  ck("V1 開始 state(7,0)/HP30/SP100/空間スポーン 7 体/流体は外来 (13,15) 1 マスのみ",
    s0.px === 7 && s0.py === 0 && s0.hp === 30 && s0.sp === 100 &&
      s0.monsters.split("|").length === 24 && s0.fluid === "13,15:1,8",
    { pos: `${s0.px},${s0.py}`, fluid: s0.fluid });

  // ---- 地表歩行 (7,0)→(4,0): surfaceReturn 早期 return で resolveTurn なし = tick 0 回 ----
  for (const i of [1, 2, 3]) {
    const t = await tapTileOffset(page, -1, 0);
    if (!t.front) ck(`地表歩行#${i} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sW = await rec("walk-to-4,0");
  const m41w = await monState(page, 4, 1);
  ck("V1 地表歩行後 (4,0)・SP100(地表全回復)・(4,1)SPIDER は tick が走らず hp6/bt0/buried のまま",
    sW.px === 4 && sW.py === 0 && sW.sp === 100 &&
      m41w && m41w.buried && m41w.hp === 6 && m41w.bt === 0,
    { pos: `${sW.px},${sW.py}`, sp: sW.sp, m41: m41w });
  // V1 非描画: (4,1) は可視化済み(radius2)の埋没マス。素の SOIL マス (3,1)(同行・可視・非埋没)と
  // 画面ピクセルが一致する = モンスターが描かれていない。しきい値 12 は同一スプライトのサブピクセル
  // 揺れ許容(初回基準、実測 diff は detail に記録)。
  const pxBuried = await cellPixel(page, 4, 1);
  const pxPlain = await cellPixel(page, 3, 1);
  const dNoDraw = pixDiff(pxBuried, pxPlain);
  ck("V1 可視の埋没マス (4,1) のピクセルが素 SOIL (3,1) と一致(非描画、diff<=12)",
    dNoDraw <= 12, { buried: pxBuried, plain: pxPlain, diff: dNoDraw });

  // ---- V2/V5 掘り当て: (4,0) から (4,1) を直掘り(SOIL 1 タップ) ----
  let t = await tapTileOffset(page, 0, 1);
  ck("T1 掘り当てタップ 最前面=scene", t.front, t);
  const pops1 = await popupText(page);
  const hint1 = await hintText(page);
  const s1 = await rec("t1-dighit");
  const m41 = await monState(page, 4, 1);
  ck("T1 V2 掘り抜きで「そこに居た」SPIDER が即アクティブ化(buried=false)+ セル空間化(dug 入り)",
    m41 && !m41.buried && s1.dug.includes("4,1"), m41);
  ck("T1 V5 タップは攻撃でなく掘削(hp6 無傷。bump 攻撃なら playerAtk2-def1=1 ダメで hp5 のはず)",
    m41 && m41.hp === 6, { hp: m41 && m41.hp });
  ck("T1 V2 自機は前進しない(4,0 のまま)+ SP 台帳 100-1(掘り)-2(隣接反撃)=97",
    s1.px === 4 && s1.py === 0 && s1.sp === 97 && s1.spHud === "97",
    { pos: `${s1.px},${s1.py}`, sp: s1.sp });
  ck("T1 V2 演出: popup に SPIDER アイコン(蛛)+ ヒント「飛び出した」", pops1.includes("蛛") && hint1.includes("飛び出した"),
    { pops: pops1, hint: hint1 });
  const pxActive = await cellPixel(page, 4, 1);
  const dActive = pixDiff(pxActive, pxPlain);
  ck("V1/V2 アクティブ化後は (4,1) のピクセルが素 SOIL から変化(描画対象に戻る、diff>25)",
    dActive > 25, { active: pxActive, plain: pxPlain, diff: dActive });

  // ---- V5 対比: アクティブ化後は bump 攻撃対象。6 回攻撃で撃破(1 ダメ/回、生存中は反撃 2/回) ----
  const expHp = [5, 4, 3, 2, 1, 0];
  const expSp = [94, 91, 88, 85, 82, 81];
  for (let i = 0; i < 6; i++) {
    t = await tapTileOffset(page, 0, 1);
    if (!t.front) ck(`T${2 + i} 攻撃タップ 最前面=scene`, false, t);
    const s = await rec(`t${2 + i}-attack`);
    const m = await monState(page, 4, 1);
    const hpNow = m ? m.hp : 0;
    if (hpNow !== expHp[i] || s.sp !== expSp[i])
      ck(`T${2 + i} V5 bump 攻撃 hp=${expHp[i]}/SP=${expSp[i]}`, false, { hp: hpNow, sp: s.sp });
  }
  const s7 = await rec("t7-killed");
  ck("T7 V5 撃破: リストから除去(23 体)+ EXP3 + kills1(土中死と違い報酬あり)",
    s7.monsters.split("|").length === 23 && s7.exp === 3 && s7.kills === 1,
    { n: s7.monsters.split("|").length, exp: s7.exp, kills: s7.kills });

  // ---- V3 自力脱出: (3,0) へ歩き col3 を (3,5) まで直下掘り ----
  t = await tapTileOffset(page, -1, 0);
  ck("W4 地表歩行 (3,0) 最前面=scene", t.front, t);
  const sW4 = await rec("walk-3,0");
  ck("W4 地表帰還で全回復(SP100)", sW4.px === 3 && sW4.py === 0 && sW4.sp === 100, { sp: sW4.sp });

  // D1 → (3,1): 全個体圏外。
  t = await tapTileOffset(page, 0, 1);
  ck("D1 降下タップ 最前面=scene", t.front, t);
  const sD1 = await rec("d1");
  const m56a = await monState(page, 5, 6);
  ck("D1 (3,1) 到達・SP99・(5,6)SLIME まだ圏外(hp15/bt0/buried)",
    sD1.py === 1 && sD1.sp === 99 && m56a && m56a.buried && m56a.hp === 15 && m56a.bt === 0, m56a);

  // D2 → (3,2): (5,6)SLIME(bury30, escBt=1)が圏内 tick1 で脱出。
  t = await tapTileOffset(page, 0, 1);
  ck("D2 降下タップ 最前面=scene", t.front, t);
  const sD2 = await rec("d2");
  const m56b = await monState(page, 5, 6);
  ck("D2 V3 (5,6)SLIME が圏内 tick1 で脱出(hp15→14・bt1・dug 入り)",
    sD2.py === 2 && m56b && !m56b.buried && m56b.hp === 14 && m56b.bt === 1 && sD2.dug.includes("5,6"),
    m56b);

  // D3 → (3,3): (2,8) はまだ圏外(dist5)。
  t = await tapTileOffset(page, 0, 1);
  ck("D3 降下タップ 最前面=scene", t.front, t);
  const sD3 = await rec("d3");
  const m28a = await monState(page, 2, 8);
  ck("D3 (3,3) 到達・(2,8)SLIME まだ圏外(hp15/bt0/buried)",
    sD3.py === 3 && m28a && m28a.buried && m28a.hp === 15 && m28a.bt === 0, m28a);

  // D4 → (3,4): (2,8) 圏内 tick1 = 衰弱のみ(escBt=2 なので脱出しない)。(5,8)SPIDER は tick1 脱出。
  t = await tapTileOffset(page, 0, 1);
  ck("D4 降下タップ 最前面=scene", t.front, t);
  const sD4 = await rec("d4");
  const m28b = await monState(page, 2, 8);
  const m58 = await monState(page, 5, 8);
  ck("D4 V3 (2,8)SLIME 圏内 tick1 = HP-1 の衰弱のみ(hp14/bt1/buried 維持・dug 外)",
    sD4.py === 4 && m28b && m28b.buried && m28b.hp === 14 && m28b.bt === 1 && !sD4.dug.includes("2,8"),
    m28b);
  ck("D4 V3 (5,8)SPIDER(bury100)は圏内 tick1 で即脱出(hp5/bt1/dug 入り)",
    m58 && !m58.buried && m58.hp === 5 && m58.bt === 1 && sD4.dug.includes("5,8"), m58);
  const pxFog28 = await cellPixel(page, 2, 8); // (2,8) は未可視 fog のまま。

  // D5 → (3,5): (2,8) 圏内 tick2 = 事前導出 escBt=2 ちょうどで脱出。
  t = await tapTileOffset(page, 0, 1);
  ck("D5 降下タップ 最前面=scene", t.front, t);
  const sD5 = await rec("d5");
  const m28c = await monState(page, 2, 8);
  ck("D5 V3 (2,8)SLIME が事前導出 escBt=2 ちょうどで脱出(hp13/bt2/セル空間化=dug 入り)",
    sD5.py === 5 && m28c && !m28c.buried && m28c.hp === 13 && m28c.bt === 2 && sD5.dug.includes("2,8"),
    m28c);
  const activeNow = await page.evaluate(() => !!monsterAt(2, 8));
  ck("D5 V3 脱出後は monsterAt で引ける(bump/ブロック対象に復帰)", activeNow, activeNow);
  const pxOpen28 = await cellPixel(page, 2, 8);
  const dEscape = pixDiff(pxFog28, pxOpen28);
  ck("D5 V3 脱出セル (2,8) の画面ピクセルが fog から変化(空間化+個体描画、diff>25)",
    dEscape > 25, { fog: pxFog28, open: pxOpen28, diff: dEscape });
  ck("D5 SP 台帳一致(降下 5 掘りで 95)・HP30 無傷・流体不変(脱出は湧出なし)",
    sD5.sp === 95 && sD5.hp === 30 && sD5.fluid === "13,15:1,8", { sp: sD5.sp, fluid: sD5.fluid });

  // ---- 帰還: クライム 5 回で (3,0) = 地表全回復。道中 tick は起きない(全て圏外 or アクティブ) ----
  for (const i of [1, 2, 3, 4, 5]) {
    t = await tapTileOffset(page, 0, -1);
    if (!t.front) ck(`帰還クライム#${i} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sSurf = await rec("surface");
  ck("帰還 (3,0)・全回復(HP30/SP100)", sSurf.px === 3 && sSurf.py === 0 && sSurf.hp === 30 && sSurf.sp === 100, {
    pos: `${sSurf.px},${sSurf.py}`, sp: sSurf.sp });

  // ---- V4 圏外静止: 13 体は全行程を通じて初期値のまま ----
  const untouched = await page.evaluate((expected) => {
    const bad = [];
    for (const s of expected) {
      const [key, pos] = s.split("@");
      const [c, r] = pos.split(",").map(Number);
      const m = G.monsters.find((m) => m.buried && m.col === c && m.row === r);
      if (!m || m.key !== key || m.hp !== MONSTER[key].hp || (m.bt || 0) !== 0 || G.dug.has(pos))
        bad.push({ s, m: m ? { key: m.key, hp: m.hp, bt: m.bt || 0 } : null });
    }
    return bad;
  }, UNTOUCHED_13);
  ck("V4 圏外 13 体は hp/bt/buried/位置とも初期値のまま不変(衰弱も脱出もしない)",
    untouched.length === 0, untouched.slice(0, 4));
  const sFinal = await rec("final");
  ck("最終盤面: 埋没 13 + 脱出 3((5,6)hp14/(5,8)hp5/(2,8)hp13 全て閉鎖ポケットで静止)+ 空間 7 = 23 体",
    sFinal.buriedCount === 13 && sFinal.monsters.split("|").length === 23 &&
      sFinal.monsters.includes("SLIME@5,6:14:1:0") && sFinal.monsters.includes("SPIDER@5,8:5:1:0") &&
      sFinal.monsters.includes("SLIME@2,8:13:2:0"),
    { buried: sFinal.buriedCount, n: sFinal.monsters.split("|").length });

  // ---- pageerror 0(シナリオ全体) ----
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  ck("シナリオ pageerror 0", pe.length === 0, pe);

  await ctx.close();
  return trace;
}

// ============================================================================
// 実行
// ============================================================================
console.log("== マインロード v0.17.0 埋没モンスター 独立検証(verify-mineroad-bury) ==");
console.log(`BASE=${BASE}`);

console.log("\n-- V1〜V5 メインシナリオ(実タップ経路 run 1) --");
const trace1 = await runScenario(true);

// V6 決定論: fresh コンテキストで同一操作列を再実行し全スナップショット照合。
console.log("\n-- V6 決定論(同一操作列 run 2 → トレース照合) --");
const trace2 = await runScenario(false);
const t1s = JSON.stringify(trace1);
const t2s = JSON.stringify(trace2);
check("V6 同一 seed 同一操作列で monsters/dug/fluid/HP/SP 全スナップショット一致", t1s === t2s,
  { steps: trace1.length, match: t1s === t2s });
if (t1s !== t2s) {
  for (let i = 0; i < Math.max(trace1.length, trace2.length); i++) {
    if (JSON.stringify(trace1[i]) !== JSON.stringify(trace2[i])) {
      log("V6 初回不一致", { run1: trace1[i], run2: trace2[i] });
      break;
    }
  }
}

// V7a 既存作回帰(同一サーバで全 URL 200)。
console.log("\n-- V7a 既存作回帰(URL 200) --");
for (const path of ["/", "/tomoshibi/", "/nagori/", "/akari/", "/mineroad/", "/healthz"]) {
  const res = await fetch(`${BASE}${path}`);
  check(`V7a ${path} 200`, res.status === 200, res.status);
}

// V7b 短高 viewport(モバイル Chrome ツールバー表示相当)。headless は実ツールバーの svh 挙動を
// 完全再現できない(svh=vh=innerHeight)ため、innerHeight 内配置 + タップ機能で担保する。
console.log("\n-- V7b 短高 viewport 412x680 / 412x730 --");
for (const vh of [680, 730]) {
  const { ctx, page, errors } = await openMineroad(412, vh);
  const btnBox = await page.evaluate(() => {
    const el = document.querySelector(".dungeon-btn:not([disabled])");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight };
  });
  check(`V7b ${vh} タイトル: ダンジョンボタン in-view`, !!btnBox && btnBox.t >= 0 && btnBox.b <= btnBox.ih, btnBox);
  const dive = await startDive(page);
  check(`V7b ${vh} タイトル: ボタンタップ機能(dive 遷移)`, dive.ok && dive.t.front, dive);
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
  check(`V7b ${vh} dive: 必須ボタン ${btns.length} 個 in-view + ヒット可`, btnRep.length === 0, btnRep);
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
  check(`V7b ${vh} dive: UI はみ出し 0`, overflow.length === 0, overflow.slice(0, 5));
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  check(`V7b ${vh} pageerror 0`, pe.length === 0, pe);
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
