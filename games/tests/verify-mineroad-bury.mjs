// verify-mineroad-bury.mjs — マインロード v0.17.0「埋没モンスター機構の原作合わせ」独立検証(playtester)。
//
// **v0.20.0 追随(2026-07-20)**: VERSION 文字列のみの機械追随。本テストのシナリオ(掘り当て/bump/
// 撃破)はクライム(真上移動)にもタップ入力方式(判断B 5等分ゾーン)にも一切依存していないため、
// v0.20.0 の判断A〜E(camera windowing/5等分ゾーン/クライム廃止/モンスタースプライト)による
// 挙動変更を受けない(実タップ経路が全て隣接 8 マス直接タップのみで構成されているため)。
//
// **v0.18.0 追随(2026-07-19、STATUS v0.18.0 判断 E③/H が根拠。テスト緑化目的ではない)**:
// v0.18.0 の活動範囲統一(判断 E③: BURIED_WAKE_RANGE(4) 撤去 → MONSTER_ACTIVE_RANGE(16) へ統一)により、
// 裏庭(15×15、自機から最大 Chebyshev 距離 15)は**常に全個体が活動箱内**になった。旧 v0.17.0 テストの
// 「圏内/圏外を歩いて作る」シナリオ(V3 自力脱出の段階的接近・V4 圏外静止)は裏庭では**物理的に構成
// 不能**になったため削除した(旧 wake=4 前提の産物で v0.18.0 実装が壊れたわけではない)。
//
// 判断基準 = 「bury 検証は tests/verify-mineroad-ai.mjs に無い何を見るか」1 問に統一:
//   - ai が既に持つ(削除/縮退): 圏外静止・段階的接近による tick 開始(V3/V4、裏庭では構成不能)。
//     17 体配置の hp/sp/sleeping/rc 込み全リテラル・脱出タイミングの決定論・活動箱 16 の実効
//     (ai の A1/A2 が距離 8 個体の tick を直接証明済み)。これらは重複させず ai 側の責務のまま残す。
//   - ai に無い(bury が固有に持つ、本テストの主役):
//     ①**埋没マスの非描画ピクセル**(埋没個体が素 SOIL タイルと画面上まったく同一に見える。ai の
//     snapshot は座標/HP/SP/sleeping/rc のみで画面ピクセルを一切見ていない)+ 掘り当て後の描画復帰
//     への遷移。②**bt(覚醒/自力脱出 tick カウンタ)フィールドそのもの**。ai の snapshot 文字列は
//     `sp`(AI 側 SP-睡眠ゲージ)/`sleeping`/`rc`(徘徊ロールカウンタ)のみを読み、buriedTick が回す
//     `bt`(buryEscapeRoll の位相引数)は一度も参照しない。SLIME@2,8(escBt=2)を bt1→bt2 で観測する
//     ことで、ai が触れない buriedTick/buryEscapeRoll の内部機構を独立に検証する(掘り当てシナリオの
//     T1/T2 に相乗りさせるだけで新規シナリオを増やさない)。③**掘り当て(activateBuriedAt)の
//     hp満タン即時アクティブ化・非攻撃扱い**(dig と bump の区別)。
//   - 正直な区分(bury 固有ではないが ai 未カバーの end-to-end として残す): 掘り当て→bump 6 回→撃破
//     (hp0)→EXP/kills/drops。これは「埋没機構」固有ではなく一般の撃破機構だが、ai のシナリオは
//     hp3 で個体を生かして徘徊観察に回すため撃破まで到達しない。bury テストの通し操作の副産物として
//     end-to-end の撃破経路を保持する(ラベルを偽らない=撃破は bury 固有機構ではない)。
//
// 期待値の再導出方法: 本番コードを一切変更せず、実タップ操作で probe(state 注入 0、Read のみ)を
// 走らせて実測(2026-07-19、seed 41027 裏庭、GAMES_PORT=47894)。旧 v0.17.0 の SP/HP/EXP/kills/drops
// 数値は掘り当て・bump 機構自体が v0.18.0 で不変(判断 G「moveTo/act/女の子追従/崩落再埋没は不変」)
// なため実測後も同一だった(推測で流用したわけではなく実測で裏取り済み)。位置リテラル
// (EXPECTED_BURIED_17)は世界生成コード非変更のため v0.17.0 と同一(実測で再確認済み)。
//
// 実装側テスト(selfcheck-mineroad-bury.mjs / debug-mineroad.mjs)とは**別実装・別シナリオ**: state
// 注入 0 件、世界生成にもランタイム state にも一切触れない実タップのみ。期待値は実測導出の決定論
// リテラルを直接 assert。
//
// 入力規律(tests/ ルール): 全入力は page.mouse の画面座標タップ + タップ直前に elementFromPoint で
// 最前面 = #scene(canvas) を assert(canvas への直接 dispatch なし = overlay 飛び越え PASS の穴を塞ぐ)。
//
// 検証項目(v0.18.0 追随後):
//   V1 生成時配置: ダイブ開始直後 G.monsters に埋没 17 体(位置リテラル一致、EXPECTED_BURIED_17)+
//      全個体 hp 満タン・bt0・配置マスは固体のまま(dug 外)+ 地表歩行では tick が走らない(全 17 体不変)
//   V1b 非描画(bury 固有・ai 未カバー): 埋没マス (4,1) の画面ピクセルが素の SOIL マス (3,1) と
//      一致(diff<=2、実測 0)。遠距離(ダイブ直後)・隣接(掘り当て直前)の両方で確認
//   V2 掘り当てアクティブ化(bury 固有・ai の T1 と同一操作だが独立検証として保持): (4,1) を実タップ
//      掘削 → そこに居た SPIDER が hp 満タンのまま即アクティブ化 + 自機非前進 + popup/ヒント演出 +
//      非描画 → 描画復帰(pixel diff>25、実測 136)
//   V3 bt 固有機構(bury 固有・ai 未カバー): SLIME@2,8(escBt=2)が T1 で bt1・buried 維持・hp14
//      (脱出抽選失敗)→ T2 で bt2・buried=false・hp13(脱出成功、dug 入り)。buriedTick/buryEscapeRoll
//      の内部カウンタを直接観測(ai の snapshot は bt を持たない)
//   V5 buried 非 bump(bury 固有): 埋没マスへのタップは攻撃でなく掘削(アクティブ化時 hp6 無傷)。
//      アクティブ化後は bump 攻撃対象に戻り(対比)、6 回攻撃で撃破まで通す(ai 未到達の end-to-end。
//      撃破自体は一般機構であり bury 固有ではないと明記)
//   V6 決定論: fresh コンテキスト 2 回で同一操作列 → 全スナップショット(monsters/dug/HP/SP/EXP)一致
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

// 位置リテラル(probe 実測、seed 41027 裏庭。v0.17.0 と同一 = 世界生成コード非変更で再確認済み)。
const EXPECTED_BURIED_17 = [
  "SPIDER@4,1", "WORM@13,1", "SPIDER@10,5", "WORM@12,5", "SLIME@5,6", "SPIDER@14,6",
  "SLIME@2,8", "SPIDER@5,8", "SPIDER@0,10", "SPIDER@7,11", "SPIDER@9,11", "SPIDER@13,11",
  "SPIDER@0,12", "SLIME@1,12", "WORM@7,12", "SPIDER@13,12", "SPIDER@4,13",
];

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
    await page.waitForTimeout(120);
    const cur = await page.evaluate(() => window.__camY || 0);
    if (Math.abs(cur - prev) < 0.001) return cur;
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
  await page.waitForTimeout(110);
  return { front, x: +p.x.toFixed(1), y: +p.y.toFixed(1) };
}

// 埋没機構スナップショット: 全モンスター("key@c,r:hp:bt:buried"ソート連結、v0.18.0 で撤去された
// cd(隔ターン追跡スロットル)は含めない)+ 主要 state。
const snap = (page) =>
  page.evaluate(() => ({
    px: G.px,
    py: G.py,
    hp: G.hp,
    sp: G.stamina,
    spHud: document.getElementById("stamina-val").textContent,
    monsters: G.monsters
      .map((m) => `${m.key}@${m.col},${m.row}:${m.hp}:${m.bt || 0}:${m.buried ? 1 : 0}`)
      .sort()
      .join("|"),
    buriedCount: G.monsters.filter((m) => m.buried).length,
    dug: [...G.dug].sort().join("|"),
    exp: G.exp,
    kills: G.kills,
    drops: Object.entries(G.drops).sort().map(([k, v]) => `${k}:${v}`).join("|"),
    screen: G.screen,
  }));

// 個体 1 体の状態を spawn 位置で特定(escBt=2 の SLIME@2,8 は脱出後も col/row 不変=移動しないため
// spawnCol/spawnRow でも col/row でも同じセルを引けるが、ai テストの convention に揃える)。
const monBySpawn = (page, c, r) =>
  page.evaluate(([c, r]) => {
    const m = G.monsters.find((m) => m.spawnCol === c && m.spawnRow === r);
    if (!m) return "gone";
    return { key: m.key, col: m.col, row: m.row, hp: m.hp, bt: m.bt || 0, buried: m.buried === true };
  }, [c, r]);

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
  ck("遷移 タイトルに v0.20.0 表示(機械追随)", ver.includes("v0.20.0"), ver);
  const dive = await startDive(page);
  ck("遷移 ダンジョン選択タップ(最前面)→dive", dive.ok && dive.t.front, dive);
  await camSettle(page);

  // ---- V1 生成時配置 ----
  const s0 = await rec("start");
  const buriedList0 = await page.evaluate(() =>
    G.monsters.filter((m) => m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|")
  );
  ck("V1 埋没 17 体がダイブ開始直後から存在(位置リテラル一致)",
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
  ck("V1 開始 state(7,0)/HP30/SP100/n=24", s0.px === 7 && s0.py === 0 && s0.hp === 30 && s0.sp === 100,
    { pos: `${s0.px},${s0.py}` });

  // ---- V1b 非描画(遠距離、bury 固有・ai 未カバー): (4,1) は可視化済みの埋没マス。素の SOIL マス
  // (3,1)(同行・非埋没)と画面ピクセルが一致 = モンスターが描かれていない。しきい値 2 は実測 diff=0
  // への安全マージン(v0.17.0 のしきい値 12 より厳格化。実測が揺れないことを確認できたため)。
  const pxBuriedFar = await cellPixel(page, 4, 1);
  const pxPlainFar = await cellPixel(page, 3, 1);
  const dNoDrawFar = pixDiff(pxBuriedFar, pxPlainFar);
  ck("V1b 非描画(遠距離): 埋没マス (4,1) が素 SOIL (3,1) とピクセル一致(diff<=2、実測0)",
    dNoDrawFar <= 2, { buried: pxBuriedFar, plain: pxPlainFar, diff: dNoDrawFar });

  // ---- 地表歩行 (7,0)→(4,0): surfaceReturn 早期 return で resolveTurn なし = tick 0 回 ----
  for (const i of [1, 2, 3]) {
    const t = await tapTileOffset(page, -1, 0);
    if (!t.front) ck(`地表歩行#${i} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sW = await rec("walk-to-4,0");
  const m41w = await monBySpawn(page, 4, 1);
  ck("V1 地表歩行後 (4,0)・SP100(地表全回復)・全 17 体不変(埋没機構は tick が走らない)",
    sW.px === 4 && sW.py === 0 && sW.sp === 100 && sW.buriedCount === 17 &&
      m41w !== "gone" && m41w.buried && m41w.hp === 6 && m41w.bt === 0,
    { pos: `${sW.px},${sW.py}`, sp: sW.sp, m41: m41w });

  // ---- V1b 非描画(隣接・掘り当て直前、bury 固有): 距離が縮まってタイル表示がハイライトされても
  // (実測: 隣接時 (4,1)(3,1) とも同一の {194,147,100} へ変化)非描画は成立し続ける。
  const pxBuriedAdj = await cellPixel(page, 4, 1);
  const pxPlainAdj = await cellPixel(page, 3, 1);
  const dNoDrawAdj = pixDiff(pxBuriedAdj, pxPlainAdj);
  ck("V1b 非描画(隣接・掘り当て直前): (4,1) が (3,1) とピクセル一致(diff<=2、実測0)",
    dNoDrawAdj <= 2, { buried: pxBuriedAdj, plain: pxPlainAdj, diff: dNoDrawAdj });

  // ---- V2/V5 掘り当て: (4,0) から (4,1) を直掘り(SOIL 1 タップ) ----
  let t = await tapTileOffset(page, 0, 1);
  ck("T1 掘り当てタップ 最前面=scene", t.front, t);
  const pops1 = await popupText(page);
  const hint1 = await hintText(page);
  const s1 = await rec("t1-dighit");
  const m41 = await monBySpawn(page, 4, 1);
  ck("T1 V2 掘り抜きで「そこに居た」SPIDER が即アクティブ化(buried=false)+ セル空間化(dug 入り)",
    m41 !== "gone" && !m41.buried && s1.dug.includes("4,1"), m41);
  ck("T1 V5 タップは攻撃でなく掘削(hp6 無傷。bump 攻撃なら playerAtk2-def1=1 ダメで hp5 のはず)",
    m41 !== "gone" && m41.hp === 6, { hp: m41 !== "gone" && m41.hp });
  ck("T1 V2 自機は前進しない(4,0 のまま)+ SP 台帳 100-1(掘り)-2(隣接反撃)=97",
    s1.px === 4 && s1.py === 0 && s1.sp === 97 && s1.spHud === "97",
    { pos: `${s1.px},${s1.py}`, sp: s1.sp });
  ck("T1 V2 演出: popup に SPIDER アイコン(蛛)+ ヒント「飛び出した」", pops1.includes("蛛") && hint1.includes("飛び出した"),
    { pops: pops1, hint: hint1 });

  // ---- V3 bt 固有機構(bury 固有・ai 未カバー): T1 時点で SLIME@2,8(escBt=2)は圏内 tick1 = 衰弱
  // のみ(bt1・buried 維持・脱出抽選失敗)。ai の snapshot は bt を一切読まないため、buriedTick/
  // buryEscapeRoll の内部カウンタそのものはここでのみ検証される。
  const m28t1 = await monBySpawn(page, 2, 8);
  ck("T1 V3 SLIME@2,8 圏内 tick1(bt1)= HP-1 の衰弱のみ、脱出抽選は失敗(buried 維持・dug 外)",
    m28t1 !== "gone" && m28t1.buried && m28t1.hp === 14 && m28t1.bt === 1 && !s1.dug.includes("2,8"),
    m28t1);

  const pxActive = await cellPixel(page, 4, 1);
  const dActive = pixDiff(pxActive, pxPlainAdj);
  ck("V1b/V2 アクティブ化後は (4,1) のピクセルが素 SOIL から変化(描画対象に戻る、diff>25、実測136)",
    dActive > 25, { active: pxActive, plain: pxPlainAdj, diff: dActive });

  // ---- V5 対比: アクティブ化後は bump 攻撃対象。6 回攻撃で撃破(1 ダメ/回、生存中は反撃 2/回)。
  // 撃破自体は bury 固有機構ではなく一般の戦闘機構だが、ai のシナリオは hp3 で個体を生かして徘徊
  // 観察に回すため撃破まで到達しない=end-to-end(hp0→EXP/kills/drops)は本テストでのみ通し確認する。
  const expHp = [5, 4, 3, 2, 1, 0];
  const expSp = [94, 91, 88, 85, 82, 81];
  for (let i = 0; i < 6; i++) {
    t = await tapTileOffset(page, 0, 1);
    if (!t.front) ck(`T${2 + i} 攻撃タップ 最前面=scene`, false, t);
    const s = await rec(`t${2 + i}-attack`);
    const m = await monBySpawn(page, 4, 1);
    const hpNow = m === "gone" ? 0 : m.hp;
    if (hpNow !== expHp[i] || s.sp !== expSp[i])
      ck(`T${2 + i} V5 bump 攻撃 hp=${expHp[i]}/SP=${expSp[i]}`, false, { hp: hpNow, sp: s.sp });
    // T2(i=0)時点で V3 の bt2 脱出も同時観測(SLIME@2,8 が事前導出どおり圏内 tick2 で脱出)。
    if (i === 0) {
      const m28t2 = await monBySpawn(page, 2, 8);
      ck("T2 V3 SLIME@2,8 が圏内 tick2(bt2)で脱出(hp13・buried=false・dug 入り)= buryEscapeRoll の位相 bt 実効",
        m28t2 !== "gone" && !m28t2.buried && m28t2.hp === 13 && m28t2.bt === 2 && s.dug.includes("2,8"),
        m28t2);
    }
  }
  const s7 = await rec("t7-killed");
  const popsKill = await popupText(page);
  ck("T7 撃破(end-to-end、bury 固有ではなく一般戦闘機構): リストから除去(23 体)+ EXP3 + kills1 + drops解毒薬1",
    s7.monsters.split("|").length === 23 && s7.exp === 3 && s7.kills === 1 && s7.drops.includes("解毒薬:1"),
    { n: s7.monsters.split("|").length, exp: s7.exp, kills: s7.kills, drops: s7.drops });
  ck("T7 撃破演出: popup に撃破マーカー(×)+ ドロップ表示(解毒薬)含む",
    popsKill.includes("×") && popsKill.includes("解毒薬"), popsKill);

  // ---- pageerror 0(シナリオ全体) ----
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  ck("シナリオ pageerror 0", pe.length === 0, pe);

  await ctx.close();
  return trace;
}

// ============================================================================
// 実行
// ============================================================================
console.log("== マインロード v0.18.0 埋没モンスター 独立検証(verify-mineroad-bury、v0.17.0 テストの追随) ==");
console.log(`BASE=${BASE}`);

console.log("\n-- V1〜V5 メインシナリオ(実タップ経路 run 1) --");
const trace1 = await runScenario(true);

// V6 決定論: fresh コンテキストで同一操作列を再実行し全スナップショット照合。
console.log("\n-- V6 決定論(同一操作列 run 2 → トレース照合) --");
const trace2 = await runScenario(false);
const t1s = JSON.stringify(trace1);
const t2s = JSON.stringify(trace2);
check("V6 同一 seed 同一操作列で monsters/dug/HP/SP/EXP 全スナップショット一致", t1s === t2s,
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
