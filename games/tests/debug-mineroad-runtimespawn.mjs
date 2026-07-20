// v0.19.0 ランタイムスポーン(#124)の実機相当検証(実機相当デバッガ担当、team-lead 依頼)。
// selfcheck-mineroad-runtime-spawn.mjs は state 注入で関数(runtimeSpawnStep/Occupied 等)を
// 直接検証済み(implementer 側担保)。本スクリプトの役目はそれとは別: 実プレイ入力経路(画面座標
// ヒットテスト、canvas へ直接 dispatch しない)を通した長め走行で
//   (1) pageerror 0
//   (2) モンスター人口が 0 に枯れず回る(runtime-kind の累積出現数で判定=総人口>0 だけでは弱い。
//       裏庭 15×15 は活動箱 16 が全域を覆い runtime spawn が構造的に no-op になる既知の仕様
//       (STATUS v0.19.0)なので、必ず広域ダンジョン「孤独な山」(dungeonId=6, 80x80)で走らせる)
//   (3) 湧いた個体(kind:"runtime"/"runtime-bury")が通常のモンスターと同じ経路(monstersAct/
//       buriedTick/despawn)で処理されることを実プレイ結果として観測
// を実観測することにある。
//
// 座標マッピングの事前検証(本スクリプト着手前に別プローブで確認、advisor 指摘の通り必須だった):
//   ・tile = W / CONST.GRID_COLS は startDive 内 resize() で毎回再計算されるため、80 列マップでも
//     横は圧縮描画で画面内に収まる(camX 相当の水平カメラ項は無い/不要)。
//   ・camY(縦カメラ追従)は followRows(HUD 帯換算)が大きい広域マップで収束に約 1〜1.5 秒かかる
//     (0.2/frame の指数収束)。収束前にタップすると計算座標がずれて空振りする実測を確認済み。
//     → 初回ダイブ後に camY 安定を待つ(waitCamStable)。以降は 1 手ごとの camY 変化は小さいため
//     毎回の再取得 + 短い待機で足りる。
//
// v0.20.0 追随(2026-07-20、playtester 実測で原因を訂正): 引き継ぎ時点の仮説「camY lerp 収束前に
// タップするとずれる」をまず実機 probe で再検証したところ、実際に観測された 90 件の onScene
// 飛び越えは収束タイミングとは無関係で、全件が「camY が maxCam(=DEPTH_ROWS+1-floor(H/tile)、
// 実測 44)で頭打ちになった深度(実測 py=75 付近)で、次に掘る 1 マス下のタップ座標が恒久的に
// #dpad(#btn-up/down/left/right)footer 帯へ重なる」という別原因だった(camX は startDive で
// 即時合流済みのため無関係。座標自体は正しく計算できているが、その座標に #dpad が乗っていて
// canvas がヒットしない=camY 収束待ちを増やしても直らない)。実ユーザーもこの帯では #dpad の
// 対応ボタンに切り替えて操作するはずであり(tests/ ルールが認める正規の代替入力経路)、
// screenAct() に同じフォールバックを実装して解消した(詳細は screenAct 直前のコメント)。
//
// screen-tap 規律の適用範囲(lead へ明記): タイトルは裏庭のみ解放(corePass で確認済み)のため
// dungeonId=6 は画面選択で到達不能。ダンジョン選択自体は setup として G.dungeonId 直接注入 +
// startDive() で行う(selfcheck 前例踏襲、規律違反ではない)。**行動ループ(掘削・移動)は画面座標
// タップのみ**で行い、canvas へ直接 dispatch しない。毎タップ onScene(#scene が最前面)を assert。
//
// 本番ポート 47825 には一切触れない。検証は別ポート(既定 47892、GAMES_BASE で上書き可)。
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47892";
const VW = 412, VH = 915;
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("mineroad_seen_howto", "1");
    localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
    localStorage.removeItem("mineroad_save_6"); localStorage.removeItem("mineroad_progress");
  } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
console.log("== v0.19.0 ランタイムスポーン 実機相当検証(画面座標ヒットテスト経由) ==");
out("VERSION", ver);

// ---- setup: dungeon 6(孤独な山 80x80)へ。screen-tap 規律の例外(選択ボタンがロックで到達不能)。
const setup = await page.evaluate(() => {
  G.dungeonId = 6;
  startDive();
  G.pick = "DIAMOND"; // どの地形でも掘削できるようにする(power ゲートで行動ループが止まる混入を排除)。
  G.monsters = []; // 生成時の空間/埋没モンスターをクリアし、ランタイムスポーンだけを見る。
  return { screen: G.screen, px: G.px, py: G.py, cols: CONST.GRID_COLS, rows: CONST.DEPTH_ROWS, girlCount: G.girls.length };
});
out("setup(dungeon6 直接注入 + G.pick=DIAMOND + G.monsters=[])", setup);

// ---- camY 収束待ち(初回ダイブ直後のみ。以降の 1 手ごとの再収束は短い待機で足りる)。
async function waitCamStable(page, maxMs = 2500) {
  let prev = await page.evaluate(() => window.__camY);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(120);
    const cur = await page.evaluate(() => window.__camY);
    if (Math.abs((cur ?? 0) - (prev ?? 0)) < 0.15) return cur;
    prev = cur;
  }
  return prev;
}
const camAfterInit = await waitCamStable(page);
out("camY 初回収束", camAfterInit);

async function tileCenter(page, col, row) {
  return page.evaluate(([col, row]) => {
    const t = tile;
    const camYNow = window.__camY || 0;
    // v0.20.0 判断A: 横カメラ camX 導入により、80 列マップ(pointer 検証の主対象)では
    // x = col*t だけでは画面座標とずれる(旧コメント「camX 相当の水平カメラ項は無い/不要」は
    // v0.19.0 時点の tile=W/GRID_COLS 前提。判断A で tile=W/VIEW_COLS + camX 追従へ変わったため
    // 実測でずれを確認=window.__camX を通す)。
    const camXNow = window.__camX || 0;
    return { x: (col - camXNow) * t + t / 2, y: (row - camYNow) * t + t / 2 };
  }, [col, row]);
}
async function isSceneAt(page, x, y) {
  return page.evaluate(([px, py]) => {
    const e = document.elementFromPoint(px, py);
    return !!e && e.id === "scene";
  }, [x, y]);
}

// v0.20.0 追随: 実測の結果、90 件の onScene 飛び越えは「camY lerp 収束待ち不足」ではなく、広域
// マップ(80 行)を深く掘り進むと camY が maxCam(=DEPTH_ROWS+1-floor(H/tile)、実測 44)で頭打ちに
// なり、そこから先は「次に掘るセル」の画面 y 座標が固定されたまま #dpad(#btn-up/down/left/right)
// の footer 帯へ恒久的に重なる、という別原因だった(実機 probe で再現・特定済み。camX は初期化時
// 即時合流(app.js startDive)のため今回のケースでは無関係で収束待ちループの追加では直らない)。
// 実プレイでもこの帯に落ちたら実ユーザーは十字キー(#dpad、canvas 外 DOM、tests/ 既存ルールで
// 画面座標タップと併用可の正規入力経路)に切り替えるので、同じ切り替えをここでも行う
// (内部 state を直接操作しない=依然として実ユーザー操作範囲内)。
const DPAD_BTN = { "0,-1": "#btn-up", "0,1": "#btn-down", "-1,0": "#btn-left", "1,0": "#btn-right" };
let dpadFallbackCount = 0;
async function tapButton(page, sel) {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  return true;
}

// 画面座標タップで隣接 (dc,dr) を 1 手。onScene(overlay 飛び越え検出)と、action が実際に成立した
// 証拠(px/py 変化 or digProgress 変化 or spawnRollCount 増加)を返す(空振りを黙って見逃さない)。
// canvas タップが #dpad footer に恒久的に隠れているケース(上記コメント)のみ、対応する
// #btn-* への実タップへ切り替える(dpadFallbackCount で使用回数を記録し、最終報告で明示する)。
async function screenAct(page, dc, dr) {
  const before = await page.evaluate(() => ({
    px: G.px, py: G.py, spawnRollCount: G.spawnRollCount || 0,
  }));
  const pt = await tileCenter(page, before.px + dc, before.py + dr);
  let onScene = await isSceneAt(page, pt.x, pt.y);
  let usedDpad = false;
  if (!onScene) {
    const btnSel = DPAD_BTN[`${dc},${dr}`];
    if (btnSel && (await tapButton(page, btnSel))) {
      usedDpad = true;
      dpadFallbackCount++;
    } else {
      return { onScene, acted: false, before, after: before };
    }
  } else {
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(45);
  // 二段ゲージは本スクリプトのスコープ外(既存 gate B が担保済み)。ランタイムスポーン固有の
  // 観測(長め走行での発火/AI/埋没/despawn)を止めないよう、毎手後に満タンへ固定する。
  await page.evaluate(() => { if (G.screen === "dive") { G.stamina = effStaminaMax(); G.hp = effHpMax(); } });
  const after = await page.evaluate(() => ({
    px: G.px, py: G.py, spawnRollCount: G.spawnRollCount || 0,
  }));
  const acted = after.px !== before.px || after.py !== before.py || after.spawnRollCount !== before.spawnRollCount;
  // onScene は「overlay 飛び越え(canvas 以外の想定外要素が最前面)」の検出専用に戻す値。#dpad は
  // overlay ではなく tests/ ルールが認める正規の代替入力経路なので、フォールバックが成立した
  // ケースは「飛び越え」として数えない(usedDpad で別途正直に記録する)。
  return { onScene: onScene || usedDpad, usedDpad, acted, before, after };
}

// ============================================================================
// フェーズ 1: まっすぐ下方向へ実掘削(camX 不要な安定経路)。resolveTurn が毎手 1 回走り
// runtimeSpawnStep が発火する。pageerror 0 / onScene 飛び越えなし / 空振りなしを毎手 assert。
// runtime-kind の累積出現数と各時点の総人口を記録する。
// ============================================================================
console.log("\n== フェーズ1: 下方向実掘削(画面タップ)== ");
const DIG_STEPS = 200;
let onSceneFails = 0;
let actFails = 0;
const popHistory = [];
let firstRuntimeAt = -1;
let firstRuntimeBuryAt = -1;

// 二段ゲージ(スタミナ→HP)の撤退判断・水/マグマ/なだれ/埋没個体の被弾は既存 gate(B/W/X/S)が
// 別途担保済み(このスクリプトのスコープ外)。260 手の連続下掘りを地表帰還なしで行うと自然に
// 力尽きて screen が "fail" に落ち、それ以降の act が no-op になり観測が止まる(1 回目の走行で
// 実測: 260手中 step30 手前後で hp=0 fail に到達)。ランタイムスポーン固有の観測(発火/AI/埋没/
// despawn)に集中するため、screenAct 内で毎手後に HP/スタミナを満タンへ固定している(死の緊張の
// 無効化。実プレイの二段ゲージ検証は既存 debug-mineroad.mjs gate B が担う)。
for (let i = 0; i < DIG_STEPS; i++) {
  const r = await screenAct(page, 0, 1);
  if (!r.onScene) onSceneFails++;
  if (r.onScene && !r.acted) actFails++;
  if (i % 20 === 0 || i === DIG_STEPS - 1) {
    const snap = await page.evaluate(() => ({
      py: G.py, monsters: G.monsters.length,
      runtime: G.monsters.filter((m) => m.kind === "runtime").length,
      runtimeBury: G.monsters.filter((m) => m.kind === "runtime-bury").length,
      spawnRollCount: G.spawnRollCount || 0,
    }));
    popHistory.push({ step: i, ...snap });
    if (firstRuntimeAt < 0 && snap.runtime > 0) firstRuntimeAt = i;
    if (firstRuntimeBuryAt < 0 && snap.runtimeBury > 0) firstRuntimeBuryAt = i;
  }
  // 深い層で足元が壁固定(GRID_COLS-2/DEPTH_ROWS-2 の底)に達したら横へ逃がす(DIAMOND なので
  // power では止まらない前提だが、盤外ガードで act が no-op になるケースの保険)。
  const cur = await page.evaluate(() => ({ py: G.py, screen: G.screen }));
  if (cur.screen !== "dive") break; // 力尽き等は想定外なので打ち切り(下記で検出)。
  if (cur.py >= CONST_DEPTH_ROWS_GUARD()) break;
}
function CONST_DEPTH_ROWS_GUARD() { return 76; } // DEPTH_ROWS-2=78 手前で止め、despawn 検証の移動余地を残す。

const afterDig = await page.evaluate(() => ({
  screen: G.screen, px: G.px, py: G.py, hp: G.hp, stamina: G.stamina,
  monsters: G.monsters.length,
  runtimeTotal: G.monsters.filter((m) => m.kind === "runtime").length,
  runtimeBuryTotal: G.monsters.filter((m) => m.kind === "runtime-bury").length,
  spawnRollCount: G.spawnRollCount || 0,
}));
out("下方向 " + DIG_STEPS + " 手 実行後", afterDig);
out("onScene 飛び越え検出(0 であるべき。#dpad フォールバック成立分は含まない)", onSceneFails);
out("#dpad フォールバック使用回数(canvas タップが #dpad footer に隠れた深度で発生。正規入力経路)", dpadFallbackCount);
out("空振り(onScene だが px/py/spawnRollCount 無変化)件数", actFails);
out("人口推移サンプル(20手おき)", popHistory);
out("runtime 個体が初めて確認できた step(-1=未検出)", firstRuntimeAt);
out("runtime-bury 個体が初めて確認できた step(-1=未検出)", firstRuntimeBuryAt);

// spawnRollCount は resolveTurn(=掘り抜き完了 or 既に空間への移動)が走った回数。硬いタイルは
// digTaps>1 で複数タップに 1 回しか resolveTurn を発火しない仕様(app.js act() の remain>0 分岐)
// のため、タップ数と 1:1 対応しない(実測: 260 タップで spawnRollCount=74、py 到達 76 とほぼ一致=
// 前進 1 マスごとに 1 回という理解で妥当。1 回目の走行で `>= DIG_STEPS-5` という厳しすぎる閾値を
// 置いて誤って FAIL 扱いにしていたのを訂正=検証スクリプト側の見積りミスで実装側の不具合ではない)。
const phase1Pass =
  errors.length === 0 &&
  onSceneFails === 0 &&
  afterDig.screen === "dive" &&
  afterDig.spawnRollCount >= 30 && // resolveTurn が実際に複数回走った証拠(0や数回ではない)。
  (afterDig.runtimeTotal + afterDig.runtimeBuryTotal) > 0;
out("PASS(フェーズ1: pageerror0/飛び越えなし/resolveTurn実走/runtime個体が実際に出現)", phase1Pass);

// ============================================================================
// フェーズ 2: 出現した runtime 個体へ画面タップで接近し、通常個体と同じ経路(monstersAct)で
// AI(tk 進行)/攻撃可能性(BUMP_GATE)/埋没なら buriedTick(bt 進行 or 脱出)が動くことを観測する。
// spawn は必ず活動箱 16 の外に生まれる(判断)ため、接近しないと凍結したまま=盲目走行では踏めない。
// ============================================================================
// kind ごとに個別の対象を選ぶ(1体目がたまたま runtime-bury だと AI 観測が一切行われず「未検証」を
// 「失敗」と取り違えかねないため、runtime と runtime-bury をそれぞれ 1 体ずつ用意する)。
const targets = await page.evaluate(() => {
  const rt = G.monsters.find((x) => x.kind === "runtime");
  const rb = G.monsters.find((x) => x.kind === "runtime-bury");
  const pick = (m) => (m ? { key: m.key, col: m.col, row: m.row, kind: m.kind, buried: m.buried, hp: m.hp, tk: m.tk, bt: m.bt, spawnCol: m.spawnCol, spawnRow: m.spawnRow } : null);
  return { rt: pick(rt), rb: pick(rb) };
});
out("接近対象(runtime / runtime-bury それぞれ1体)", targets);

let approachOnSceneFails = 0;
let aiObserved = null;
let buryObserved = null;

// 現在地から target の活動箱16以内まで画面タップで接近する(横優先→縦、camX 不要な安定経路)。
async function approachTarget(page, target, maxSteps) {
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    const st = await page.evaluate((tgt) => {
      const dist = Math.max(Math.abs(G.px - tgt.col), Math.abs(G.py - tgt.row));
      return { px: G.px, py: G.py, dist };
    }, target);
    if (st.dist <= 15) break; // 活動箱 16 未満まで寄せる(境界 16 ちょうどは圏内)。
    const dc = Math.sign(target.col - st.px);
    const dr = Math.sign(target.row - st.py);
    const step = dc !== 0 ? [dc, 0] : [0, dr];
    const r = await screenAct(page, step[0], step[1]);
    steps++;
    if (!r.onScene) approachOnSceneFails++;
  }
  return steps;
}

// 個体を活動箱内に収めた状態で自機をその場で小さく往復させ resolveTurn(=monstersAct)を複数回
// 回す(掘削の往復は地形に依存せず安定して成立する)。
async function churnInPlace(page, n) {
  for (let i = 0; i < n; i++) {
    await screenAct(page, 0, -1);
    await screenAct(page, 0, 1);
  }
}

const MAX_APPROACH = 160;

if (targets.rt) {
  const steps = await approachTarget(page, targets.rt, MAX_APPROACH);
  const after1 = await page.evaluate((tgt) => {
    const m = G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow);
    const dist = m ? Math.max(Math.abs(G.px - m.col), Math.abs(G.py - m.row)) : null;
    return { found: !!m, dist, m: m ? { col: m.col, row: m.row, tk: m.tk, sp: m.sp, sleeping: m.sleeping } : null };
  }, targets.rt);
  out("runtime 個体への接近 " + steps + " 手後", after1);
  if (after1.found && after1.dist !== null && after1.dist <= 16) {
    await churnInPlace(page, 15);
    const fin = await page.evaluate((tgt) => {
      const m = G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow);
      return m ? { found: true, col: m.col, row: m.row, tk: m.tk, sp: m.sp, sleeping: m.sleeping } : { found: false };
    }, targets.rt);
    out("runtime 個体: 活動箱内で追加行動後", fin);
    // tk(活動ターンカウンタ)は圏内でのみ進む=monstersAct が通常個体と同じ経路でこの個体を
    // 処理した直接証拠。撃破/despawn で消えていても「処理された」証拠として扱う。
    aiObserved = fin.found ? fin.tk > targets.rt.tk : "vanished(接近中の偶発バンプ被弾で撃破された可能性)";
  } else {
    aiObserved = "活動箱16以内へ到達できず(接近" + MAX_APPROACH + "手で未達、距離=" + after1.dist;
  }
} else {
  out("runtime(非埋没)個体: フェーズ1で1体も出現しなかった", true);
}

if (targets.rb) {
  const steps = await approachTarget(page, targets.rb, MAX_APPROACH);
  const after2 = await page.evaluate((tgt) => {
    const m = G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow);
    const dist = m ? Math.max(Math.abs(G.px - m.col), Math.abs(G.py - m.row)) : null;
    return { found: !!m, dist, m: m ? { col: m.col, row: m.row, bt: m.bt, buried: m.buried, hp: m.hp } : null };
  }, targets.rb);
  out("runtime-bury 個体への接近 " + steps + " 手後", after2);
  if (after2.found && after2.dist !== null && after2.dist <= 16) {
    await churnInPlace(page, 15);
    const fin = await page.evaluate((tgt) => {
      const m = G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow);
      return m ? { found: true, col: m.col, row: m.row, bt: m.bt, buried: m.buried, hp: m.hp } : { found: false };
    }, targets.rb);
    out("runtime-bury 個体: 活動箱内で追加行動後", fin);
    if (fin.found) {
      // buried のまま bt が進行(覚醒/衰弱) or 既に自力脱出済み(buried:false) or HP 減少のいずれかが
      // 通常の埋没個体(buriedTick)と同じ経路で処理された証拠。
      buryObserved = fin.bt > targets.rb.bt || fin.buried !== targets.rb.buried || fin.hp < targets.rb.hp;
    } else {
      buryObserved = "vanished(bt進行によるHP枯渇撃破 or despawn — 通常の埋没個体と同じ末路)";
    }
  } else {
    buryObserved = "活動箱16以内へ到達できず(接近" + MAX_APPROACH + "手で未達、距離=" + after2.dist;
  }
} else {
  out("runtime-bury(埋没)個体: フェーズ1で1体も出現しなかった", true);
}
out("接近中 onScene 飛び越え検出", approachOnSceneFails);
out("AI観測(runtime, tk進行=通常個体と同じ活動処理を受けた証拠)", aiObserved);
out("埋没ライフサイクル観測(runtime-bury, bt進行/脱出/HP減少/撃破のいずれか)", buryObserved);

// ============================================================================
// フェーズ 3: despawn 観測。既知 runtime 個体から両軸(AND)とも 28 マス超まで自機を離し、
// monstersAct の despawn 判定(v0.18.0 既存機構、runtime 個体にも同一適用)で除去されることを見る。
// ============================================================================
console.log("\n== フェーズ3: despawn(既知個体から両軸28超まで離脱) ==");
// フェーズ2で使った rt(runtime)を優先、無ければ rb(runtime-bury)を使う。
const despawnTarget = targets.rt || targets.rb;
let despawnObserved = null;
if (despawnTarget) {
  const stillThere = await page.evaluate((tgt) => !!G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow), despawnTarget);
  if (stillThere) {
    const MAX_FLEE = 200;
    for (let i = 0; i < MAX_FLEE; i++) {
      const st = await page.evaluate((tgt) => ({
        dx: Math.abs(G.px - tgt.col), dy: Math.abs(G.py - tgt.row), px: G.px, py: G.py,
      }), despawnTarget);
      if (st.dx > 28 && st.dy > 28) break;
      // 縦方向優先で離脱(camX 不要な安定経路)。縦が底に達したら横へ切替。
      const r = await screenAct(page, 0, 1);
      if (!r.acted) { await screenAct(page, 1, 0); }
    }
    const finalCheck = await page.evaluate((tgt) => {
      const dx = Math.abs(G.px - tgt.col), dy = Math.abs(G.py - tgt.row);
      const found = !!G.monsters.find((x) => x.key === tgt.key && x.spawnCol === tgt.spawnCol && x.spawnRow === tgt.spawnRow);
      return { dx, dy, found, px: G.px, py: G.py };
    }, despawnTarget);
    out("離脱後の距離 + 個体残存", finalCheck);
    despawnObserved = finalCheck.dx > 28 && finalCheck.dy > 28 ? (finalCheck.found === false) : "距離不足(28超未達、判定不能)";
  } else {
    despawnObserved = "対象個体は既に消滅済み(撃破/自然despawn/脱出後撃破 等。フェーズ2到達前に消えた)";
  }
} else {
  despawnObserved = "対象個体なし(フェーズ1で runtime 個体が1体も出現しなかった)";
}
out("despawn観測(両軸28超で除去=通常個体と同一機構が runtime にも効く証拠)", despawnObserved);

// ============================================================================
// 総合 pageerror(全フェーズ通して)
// ============================================================================
console.log("\n== pageerror(全フェーズ通算) ==");
out("pageerrors", errors);

console.log("\n== 総合 ==");
out("(1) pageerror 0(全フェーズ)", errors.length === 0);
out("(2) 人口が枯れず回る(runtime-kind 累積出現 > 0)", (afterDig.runtimeTotal + afterDig.runtimeBuryTotal) > 0);
out("(3) AI観測(runtime が通常個体と同じ経路で処理された)", aiObserved);
out("(3) 埋没ライフサイクル観測(runtime-bury)", buryObserved);
out("(3) despawn観測(両軸28超で除去)", despawnObserved);
out("既存回帰(URL不変)は debug-mineroad.mjs gate F で別途 3 回連続 ALL PASS 済み(本スクリプトでは再実行しない)", true);

const overall = phase1Pass && errors.length === 0;
out("RESULT(実機相当・入力経路担保。AI/埋没/despawnの個別成否は上記の実測値を参照)", overall ? "PASS" : "FAIL");

await browser.close();
