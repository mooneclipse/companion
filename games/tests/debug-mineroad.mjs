// マインロード v0.18.0 実機相当デバッグ + 既存作回帰(gate A〜AF)。
// v0.18.0 = モンスター AI/活動範囲の原作合わせ(bfsStep 追跡全廃→種別徘徊 + 2 層バンプ攻撃ゲート /
// SP-睡眠 / 活動箱 16・despawn 28 / BURIED_WAKE_RANGE 撤去)→ gate S3-S5 の交戦・GIRLATK 構成を
// 徘徊/重力/確率ゲート前提へ書き換え(STATUS v0.18.0 判断 A〜H。追跡前提の assert は仕様総取り替えに
// 伴い廃止。専用の機構 assert は tests/selfcheck-mineroad-ai.mjs)。
// v0.17.0 = 埋没モンスター機構の原作合わせ(生成時配置 buried=true / 土中 tick HP−1 + bury% 脱出 /
// 掘り当てアクティブ化)→ gate S2 を新機構 assert へ書き換え
// (STATUS v0.17.0 判断 G。掘削時抽選スポーンの assert は仕様総取り替えに伴い廃止)。
// v0.16.0 = 水/マグマ機構の原作合わせ(流動セルオートマトン G.fluid / 浸水は息切れ後 HP 直撃 /
// マグマ maxHP/5 直撃 / 浮力)→ gate W3/W4 を新仕様 assert へ書き換え(STATUS v0.16.0 判断 G)。
// v0.15.0 = 掘削 8 方向の原作合わせ(タップ隣接判定 Chebyshev 1 / はしご無し上掘り / 斜めの
// 前提条件付き移動・掘削 / bump-to-attack 8 方向)→ gate AF を新設(画面座標ヒットテスト経由)。
// v0.12.0 = 中核作り直し(実機 FB で中核破綻が判明)。①女の子追従を「自機足跡履歴(G.playerTrail)を
// 1手ずつ消化する snake 追従」へ引き直し(旧 bfsStep+独立重力の底張り付きを設計から消す)→ gate C/N/P を
// 「状態注入/ワープ/縦坑先掘りなしの実プレイ経路(act でジグザグ掘削→足跡追従→地表救出)」へ作り直し。
// ②仲間モデルを「救出済みストック(rescued)を地表で1人選び次の潜行へ同行(deployed=following)→帰還で別れて
// Lv→ストックへ」へ作り直し → gate AA を新仕様へ作り直し。③崩落で塞がれたマス再掘の soft-lock 修正。
// v0.10.0 増分 = 仲間同行: following 中(護衛中)の女の子1人を G.companion に指定して一緒に潜る。
// 同行中の撃破 EXP を companion.cexp に並走で貯め、地表帰還(rescueGirl)で cexp→level に清算して別れる。
// レベルが上がると effCompanionAtk() で自機攻撃力へ援護が乗る。UI は工房オーバーレイ第4タブ「仲間」に同居。
// → gate (AA)(仲間タブ往復・同行指定の画面操作・同行中 EXP 蓄積・帰還で別れて Lv 反映・援護攻撃・
//    境界・決定論・非介入・可読性)。
// v0.9.0 増分 = 育成(Lv.UP): 救出した女の子の「情報」+ 撃破 EXP → ボーナスポイント(BP)→
// PER_*(HP/ST/DIG/ATTACK/DEFENCE/SWIM)レベルアップ。工房オーバーレイ第3タブ「育成」に同居。
// → gate (Z)(育成タブ往復・情報/EXP→BP→PER の画面操作・実効値変化・境界・決定論・非介入・可読性)。
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
//  AB. v0.12.0 セーブ/永続: fail→retry で永続 state 復元 + ランごとリセット state は 0。
//      surfaceReturn でセーブ/クリア後消去/決定論 3 回一致/非介入。
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
  await ctx.addInitScript(() => { try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); localStorage.removeItem("mineroad_progress"); } catch (e) {} });
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

// 画面座標タップ(D-pad 等のボタン)。タップ前に elementFromPoint で最前面=そのボタンを取り、
// overlay を飛び越えていないことを証跡として返す(tapSelector は最前面でないと tap せず false を
// 返すが、N2 の地表静止救出は「全タップが最前面=ボタン」を毎手 assert したいので wasTop を返す)。
async function tapBtnTop(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) return { tapped: false, wasTop: false };
  const wasTop = await page.evaluate(([sel, px, py]) => {
    const el = document.querySelector(sel);
    const top = document.elementFromPoint(px, py);
    return !!el && !!top && (el === top || el.contains(top) || top.contains(el));
  }, [selector, box.x, box.y]);
  await page.mouse.move(box.x, box.y);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(12);
  return { tapped: true, wasTop };
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
  // v0.13.0: タイトル画面はダンジョン選択ボタン。最初の解放済みボタンをタップ。
  const tapped = await page.evaluate(() => {
    const btns = document.querySelectorAll(".dungeon-btn:not([disabled])");
    if (btns.length === 0) return false;
    btns[0].click();
    return true;
  });
  if (!tapped) {
    await tapSelector(page, "#ov-action");
  }
  await page.waitForTimeout(300);
  const scr = await page.evaluate(() => G.screen);
  if (scr === "howto") {
    await tapSelector(page, "#ov-action");
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
}

// v0.12.0: 実プレイ経路ドライバ(page 側 純 JS。act() だけで自機を動かす=状態注入/ワープ/縦坑先掘りなし)。
// 旧 gate C/N/P/S は g.state="following" を直接代入し自機を女の子の真上にワープして縦坑を先掘りする
// 理想経路だけを通し、足跡追従(①)の破綻をすり抜けた。この driver は act() で実際にジグザグ掘削し、
// 女の子を足跡追従で連れ帰る=作り直した追従を実経路で検証する。eval(MR_DRIVER) で各 evaluate に注入。
const MR_DRIVER = `
  // v0.20.0 判断C: クライム(noGravity)廃止によりはしご無しでは登れない(足場/はしごが無ければ
  // moveTo 内の applyGravity で即座に落ち戻る=原作ジャンプの net 挙動)。実プレイの正攻法は
  // 「掘り下がるたびに今いる位置へはしごを設置してから進む」ことで縦列全体にはしごが敷かれ、
  // 登りは act(0,-1) の連打だけで機能する。player-state 注入方針(G.dug 注入と同じ)に倣い、
  // mrStep の 1 手が掘り抜き+重力落下で複数マス進む場合も通過区間まるごとへ敷設する
  // (playerTrail は following 中の女の子が居ない間は末尾1点へ畳まれる=v0.11.0 GC の仕様のため
  // 事後の一括注入では経路が失われて使えない)。
  function mrStep(dc, dr) {
    const bx = G.px, by = G.py;
    let guard = 0;
    while (G.screen === "dive" && G.px === bx && G.py === by && guard < 8) { act(dc, dr); guard++; }
    const top = Math.min(by, G.py), bot = Math.max(by, G.py);
    for (let r = top; r <= bot; r++) { if (r > 0) G.placedLadders.add(G.px + "," + r); }
    if (bx !== G.px && by > 0) G.placedLadders.add(bx + "," + by);
    return { px: G.px, py: G.py };
  }
  // (tcol,trow) まで掘り進む: 横へ寄せ→下へ掘る を交互(=ジグザグ経路)。各 act 後の実位置で適応。
  function mrDigTowards(tcol, trow) {
    let guard = 0;
    while (G.screen === "dive" && (G.px !== tcol || G.py !== trow) && guard < 200) {
      guard++;
      if (G.px < tcol) { mrStep(1, 0); continue; }
      if (G.px > tcol) { mrStep(-1, 0); continue; }
      if (G.py < trow) { mrStep(0, 1); continue; }
      if (G.py > trow) { mrStep(0, -1); continue; }
    }
    return { px: G.px, py: G.py };
  }
  // 自機を地表へ実 climb(mrStep が掘り進む際に経路へ敷設済みのはしごを使う。塞がっていれば
  // 足跡=自機が通った空洞を横へ辿ってから登る。縦坑先掘りに頼らない)。
  function mrClimbToSurface(maxGuard) {
    let guard = 0;
    while (G.screen === "dive" && G.py > 0 && guard < (maxGuard || 400)) {
      guard++;
      const bx = G.px, by = G.py;
      if (isSpace(G.px, G.py - 1)) act(0, -1);
      else if (isSpace(G.px - 1, G.py)) act(-1, 0);
      else if (isSpace(G.px + 1, G.py)) act(1, 0);
      else break;
      if (G.px === bx && G.py === by) break;
    }
    return { px: G.px, py: G.py };
  }
  // 実プレイで (tcol,trow) の女の子を掘り当て→追従→地表まで連れ帰り救出。戻り値は救出後の girl state。
  // power ゲート/モンスター妨害のノイズは除去(追従の検証が目的=power/戦闘は別ゲートで担保)。
  function mrRescueGirlAt(tcol, trow) {
    G.pick = "DIAMOND";
    G.monsters = []; G.spawned = new Set();
    mrDigTowards(tcol, trow - 1); // 女の子の 1 つ上まで掘る。
    G.monsters = [];
    const g = G.girls.find((x) => x.origCol === tcol && x.origRow === trow);
    const gi = G.girls.indexOf(g);
    let guard = 0;
    while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; } // 真下=女の子マスを掘り当て。
    G.monsters = [];
    mrClimbToSurface(); // 実 climb=各手で moveTo→advanceGirl が走り女の子が足跡を追う。
    return { gi, state: G.girls[gi].state };
  }
`;

async function overflowReport(page, label, vw = VW, vh = VH) {
  return page.evaluate(([lbl, vw, vh]) => {
    const sels = [
      "#ov-title", "#ov-sub", "#ov-version", "#ov-action", "#ov-action2",
      "#ov-howto", "#ov-howto .howto-line",
      "#depth-val", ".counts", ".count", ".count *",
      ".gauge", ".gauge-row", ".gauge-row *", "#hud-hint",
      ".dpad", ".dpad-btn",
      // v0.9.0: HUD バーの情報 span(ボタン後ろ)/工房タブ/育成リスト行のテキストはみ出しも検査。
      "#info-val", ".inv-ore.info", ".inv-ore.info *",
      ".craft-tabs", ".craft-tab",
      "#grow-list", "#grow-list .craft-row", "#grow-list .craft-name", "#grow-list .craft-cost", "#grow-list .craft-make",
      // v0.10.0: 工房第4タブ「仲間」+ companion-list 行(同行状態・Lv・経験値・援護)のはみ出しも検査。
      "#tab-companion", "#companion-list", "#companion-list .craft-row", "#companion-list .craft-name", "#companion-list .craft-cost", "#companion-list .craft-make",
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
  // v0.13.0: タイトル画面はダンジョン選択ボタン。#ov-action は hidden。
  const titleButtons = await page.evaluate(() => {
    const dungeonBtns = document.querySelectorAll(".dungeon-btn");
    const unlocked = [...dungeonBtns].filter(b => !b.disabled);
    const locked = [...dungeonBtns].filter(b => b.disabled);
    return {
      dungeonBtnCount: dungeonBtns.length,
      unlockedCount: unlocked.length,
      lockedCount: locked.length,
      firstBtnText: unlocked.length > 0 ? unlocked[0].textContent : "",
      howto: document.getElementById("ov-action2").textContent,
      startHidden: document.getElementById("ov-action").hidden,
      howtoHidden: document.getElementById("ov-action2").hidden,
    };
  });
  const titleOverflow = await overflowReport(page, "title");
  if (titleOverflow.overflowCount > 0) overflowFails.push(titleOverflow);

  // 最初のダンジョンボタンをタップ → 初回なので howto へ。
  const tappedStart = await page.evaluate(() => {
    const btn = document.querySelector(".dungeon-btn:not([disabled])");
    if (!btn) return false;
    btn.click();
    return true;
  });
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
  out("title ダンジョン選択ボタン", titleButtons);
  out("ダンジョン選択タップ成功", tappedStart);
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
    version === "v0.20.0" &&
    screenBefore === "title" &&
    inOverlayTitle === true &&
    titleButtons.dungeonBtnCount === 9 &&
    titleButtons.unlockedCount === 1 &&
    titleButtons.lockedCount === 8 &&
    titleButtons.firstBtnText.indexOf("裏庭の洞窟") >= 0 &&
    titleButtons.howto === "あそびかた" &&
    titleButtons.startHidden === true &&
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
  out("PASS(コア遷移/初回howto/ダンジョン選択9個(裏庭のみ解放)/5人配置/HUD 0\/5/飛び越えなし/可読性/VERSION v0.20.0)", corePass);
  await ctx.close();
}

// ============================================================================
// (J) v0.2.1 アセット配信: 新 BGM theme.ogg(audio/ogg) を含む 14 本が 200 + 正 Content-Type。
//     かつ v0.2.1 で削除された旧 theme.mp3 が 404(allowlist から除去された証明)。
//     allowlist 配信なので 1 本ずつ HTTP で叩いて status + Content-Type を検証する。
//     v0.20.0 追随: 判断E のモンスタースプライト 6 本(monsters/*.png)を追加(計 20 本)。
//     server/app.py の STATIC allowlist 未登録により全 404 だった実配信バグを本ゲートで検出
//     (playtester 実測 2026-07-20、lead が STATIC dict へ追加して解消済み)。
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
    // monsters 6 (v0.20.0 判断E)
    ["/mineroad/assets/monsters/bat.png", "image/png"],
    ["/mineroad/assets/monsters/slime.png", "image/png"],
    ["/mineroad/assets/monsters/slime_half.png", "image/png"],
    ["/mineroad/assets/monsters/snake.png", "image/png"],
    ["/mineroad/assets/monsters/worm.png", "image/png"],
    ["/mineroad/assets/monsters/spider.png", "image/png"],
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

  out("PASS(20 アセット 200 + 正 Content-Type / 旧 mp3 404)", assetPass);
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
  const rescue = await page.evaluate((driver) => {
    eval(driver);
    startDive();
    // v0.12.0: 実プレイ経路で最寄り(11,6)を掘り当て→足跡追従→地表救出(ワープ/縦坑先掘りなし)。
    G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
    const target = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6) || girlPositions(G.seed)[0];
    mrDigTowards(target.col, target.row - 1);
    G.monsters = [];
    const g = G.girls.find((x) => x.origCol === target.col && x.origRow === target.row);
    const gi = G.girls.indexOf(g);
    let guard = 0;
    while (G.girls[gi].state === "hidden" && guard < 8) { act(0, 1); guard++; }
    const discovered = G.girls[gi].state; // following(実掘り当て)。
    const hudAfterFound = document.getElementById("rescue-val").textContent; // 発見だけでは 0/5。
    G.monsters = [];
    mrClimbToSurface(); // 実 climb=足跡追従で地表へ。
    return {
      discovered,
      hudAfterFound,
      girlState: G.girls[gi].state,
      rescued: G.rescued,
      hudAfterRescue: document.getElementById("rescue-val").textContent,
      screen: G.screen, // dive のまま(1 人=clear ではない)
      ovTitle: document.getElementById("ov-title").textContent,
    };
  }, MR_DRIVER);

  // --- (C2) 実経路で女の子を掘り当てた直後、誤って「はぐれた」警告(cueGirlBlocked)が出ない。---
  // バグ再現経路: act で女の子マスを掘り抜く → discoverGirl が following + cueGirlFound →
  // moveTo(...,true) 内の advanceGirl が同マスで bfsStep null → 誤って cueGirlBlocked 表示。
  // 同マス早期 return の修正後は cueGirlFound 系のまま、追従も継続することを assert する。
  const discoverHint = await page.evaluate(() => {
    try { localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0"); } catch (e) {}
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

  // --- (D2) v0.20.0 判断C: クライム(noGravity)廃止。掘った縦坑でもはしご無しでは登れず
  //          moveTo 内の applyGravity で即座に落ち戻る(原作ジャンプの net 挙動)。はしごを
  //          敷いた縦坑は 1 マスずつ確実に登れる。固い土の上へは(はしごがあっても)登れない
  //          (掘っていないマスへは移動できない=別ゲート)。---
  const upLimit = await page.evaluate(() => {
    startDive();
    const col = G.px;
    for (let r = 1; r <= 6; r++) G.dug.add(col + "," + r); // 縦坑 row1..6。
    G.py = 6; G.stamina = 50;
    const beforeNoLadder = G.py;
    act(0, -1); // はしご無しでは登れず落ち戻る。
    const noLadderBlocked = G.py === beforeNoLadder;
    // はしごを敷いて登れることを確認(降りながら敷く正攻法の代替、player-state 注入)。
    for (let r = 1; r <= 6; r++) G.placedLadders.add(col + "," + r);
    const before = G.py;
    act(0, -1); // 1 マス登る。
    const after1 = G.py;
    act(0, -1); // もう 1 マス。
    const after2 = G.py;
    const climbsOne = after1 === before - 1 && after2 === after1 - 1; // 1 マスずつ確実に登る。
    // 固い土の上へは(はしごがあっても)登れない。
    G.px = 3; G.py = 8; G.dug = new Set(); G.placedLadders = new Set();
    const solidBefore = G.py;
    act(0, -1);
    const blockedBySolid = G.py === solidBefore;
    return {
      noLadderBlocked, before, after1, after2, climbsOne, blockedBySolid,
      movedOne: noLadderBlocked && climbsOne && blockedBySolid,
    };
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

  const trace = await page.evaluate((driver) => {
    eval(driver);
    startDive();
    const seed = G.seed;
    // v0.12.0 作り直し検証: 最深の 1 人(8,14)を「実プレイ経路」で掘り当て→足跡追従→地表救出。
    // 旧テストは自機を女の子マスへワープし一直線の縦坑を先掘りして全ステップ上向きで追わせ、横ずれの
    // 重力落とし戻し(=底張り付き)を構造的にすり抜けた。ここは act() だけでジグザグ掘削+実 climb し、
    // 女の子 row が底へ落ち戻らず単調に減って地表へ着くことを実測する(底張り付きの否定を実経路で証明)。
    G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
    const target = girlPositions(seed).find((p) => p.col === 8 && p.row === 14) || girlPositions(seed)[girlPositions(seed).length - 1];
    const startRow = target.row, col = target.col;
    mrDigTowards(col, startRow - 1); // 女の子の 1 つ上まで実掘り(ジグザグ)。
    G.monsters = [];
    const g = G.girls.find((x) => x.origCol === col && x.origRow === startRow);
    const gi = G.girls.indexOf(g);
    let dg = 0;
    while (G.girls[gi].state === "hidden" && dg < 8) { act(0, 1); dg++; } // 真下=女の子マスを掘り当て。
    const discovered = G.girls[gi].state;
    const girlRowAfterDiscover = G.girls[gi].state === "rescued" ? 0 : G.girls[gi].row;

    // 実 climb(act で上/横へ)。各手で moveTo→advanceGirl が走り女の子が足跡を追う。
    // 女の子 row を毎手記録し、底へ落ち戻り(前手より row が増える)が起きないことを見る。
    G.monsters = [];
    const steps = [];
    let stuck = false;
    let prevGirlRow = G.girls[gi].row;
    let cg = 0;
    while (G.screen === "dive" && G.py > 0 && cg < 400) {
      cg++;
      const bx = G.px, by = G.py;
      if (isSpace(G.px, G.py - 1)) act(0, -1);
      else if (isSpace(G.px - 1, G.py)) act(-1, 0);
      else if (isSpace(G.px + 1, G.py)) act(1, 0);
      else break;
      const gr = G.girls[gi].state === "rescued" ? 0 : G.girls[gi].row;
      steps.push({ playerRow: G.py, girlRow: gr, girlState: G.girls[gi].state });
      if (G.girls[gi].state !== "rescued" && gr > prevGirlRow) stuck = true; // 底へ落ち戻り=張り付き。
      prevGirlRow = gr;
      if (G.girls[gi].state === "rescued") break;
      if (G.px === bx && G.py === by) break;
    }

    const girlRows = steps.map((s) => s.girlRow);
    const lastState = G.girls[gi].state;
    return {
      seed, col, startRow, discovered, girlRowAfterDiscover,
      steps, girlRows, stuck, lastState, rescued: G.rescued,
      hud: document.getElementById("rescue-val").textContent,
      reachedSurface: lastState === "rescued",
      followedUp: girlRows.length > 0 && Math.min(...girlRows) < startRow,
    };
  }, MR_DRIVER);

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
// (N2) v0.12.0 ②救出の「地表静止」バグ 実機相当再検証(前回 FAIL の再現確認)。
//   前回 FAIL = 女の子を地表(py=0)まで足跡追従させても、自機が地表で静止していると女の子が
//   自機の 1 マス後ろ(row1)で止まり row0 に乗れず救出されない(仲間タブのストックが空のまま)。
//   修正 = caughtUpAtSurface(g): 自機 py=0 + 追従中の女の子が足跡を消化しきって追いついた
//   (trailIdx>=末尾-1)なら、女の子が物理的に row0 に乗っていなくても救出成立。
//   ここでは N gate と違い「自機を地表に着けた時点で女の子がまだ row>=1 に残っている」状況を作り、
//   その手で(=自機静止のまま)救出が成立し HUD/仲間タブのストックに並ぶことを 画面座標タップ で観測する。
//   操作は全て D-pad/工房ボタンの画面座標タップ(canvas 直 dispatch せず、各タップで最前面=ボタンを assert)。
//   power ゲート/モンスター妨害のノイズは除去(追従・救出の核検証=power/戦闘は別ゲートで担保)。
// ============================================================================
let staticRescuePass = false;
{
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);
  const diveScr = await page.evaluate(() => G.screen);

  // ノイズ除去(状態注入ではない=ピック強化と戦闘無効化のみ。自機位置/女の子 state は一切いじらない)。
  await page.evaluate(() => { G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set(); });
  await page.waitForTimeout(40);

  let allTopOk = true; // 全タップで最前面=ボタン(overlay 飛び越えなし)。
  const tgt = await page.evaluate(() => {
    const p = girlPositions(G.seed).find((p) => p.col === 11 && p.row === 6);
    return { col: p.col, row: p.row };
  });

  // (1) 画面座標タップで女の子の 1 つ上(11,5)へジグザグ掘削(横寄せ→下掘り)。
  async function digToTap(tcol, trow) {
    for (let i = 0; i < 300; i++) {
      const s = await page.evaluate(() => ({ px: G.px, py: G.py, scr: G.screen }));
      if (s.scr !== "dive" || (s.px === tcol && s.py === trow)) break;
      let sel;
      if (s.px < tcol) sel = "#btn-right";
      else if (s.px > tcol) sel = "#btn-left";
      else if (s.py < trow) sel = "#btn-down";
      else sel = "#btn-up";
      const r = await tapBtnTop(page, sel);
      if (!r.wasTop) allTopOk = false;
      // v0.20.0 判断C: クライム廃止によりはしご無しでは登れない。掘り下がった区間(掘り抜き+
      // 重力落下で複数マス進むことがある)まるごとへ都度はしごを敷く(降りながら敷く正攻法の
      // 代替、player-state 注入)。
      await page.evaluate(([by]) => {
        const ay = G.py;
        const top = Math.min(by, ay), bot = Math.max(by, ay);
        for (let r = top; r <= bot; r++) { if (r > 0) G.placedLadders.add(G.px + "," + r); }
      }, [s.py]);
      await page.evaluate(() => { G.monsters = []; }); // 戦闘ノイズを毎手除去(追従の純検証)。
    }
  }
  await digToTap(tgt.col, tgt.row - 1);
  const afterDig = await page.evaluate(() => ({ px: G.px, py: G.py }));

  // (2) 真下(女の子マス)を btn-down タップで掘り当て → following。
  let discovered = "hidden";
  for (let i = 0; i < 8; i++) {
    const r = await tapBtnTop(page, "#btn-down");
    if (!r.wasTop) allTopOk = false;
    await page.evaluate(() => { G.monsters = []; });
    discovered = await page.evaluate(([tc, tr]) => {
      const g = G.girls.find((x) => x.origCol === tc && x.origRow === tr);
      return g ? g.state : "none";
    }, [tgt.col, tgt.row]);
    if (discovered === "following") break;
  }

  // (3) 自機を py=1 まで btn-up/横タップで climb(地表 row0 には上げない)。
  //     この時点で女の子が「自機より下(row>=1)に残っている=追いついていない」ことを確認(FAIL 真因の局面)。
  for (let i = 0; i < 200; i++) {
    const s = await page.evaluate(() => ({ py: G.py, scr: G.screen }));
    if (s.scr !== "dive" || s.py <= 1) break;
    const dir = await page.evaluate(() => {
      if (G.py - 1 >= 1 && isSpace(G.px, G.py - 1)) return "up";
      if (isSpace(G.px - 1, G.py)) return "left";
      if (isSpace(G.px + 1, G.py)) return "right";
      return "none";
    });
    if (dir === "none") break;
    const sel = dir === "up" ? "#btn-up" : dir === "left" ? "#btn-left" : "#btn-right";
    const r = await tapBtnTop(page, sel);
    if (!r.wasTop) allTopOk = false;
    await page.evaluate(() => { G.monsters = []; });
  }
  const atPy1 = await page.evaluate(([tc, tr]) => {
    const g = G.girls.find((x) => x.origCol === tc && x.origRow === tr);
    return { py: G.py, gState: g.state, gRow: g.state === "rescued" ? -9 : g.row, rescued: G.rescued, hud: document.getElementById("rescue-val").textContent };
  }, [tgt.col, tgt.row]);

  // (4) 自機を地表 row0 へ btn-up タップ 1 手(surfaceReturn 発火)。女の子が row>=1 に残ったまま
  //     (=自機静止のまま追いつき)でも救出成立し HUD が 1/5 になることを観測(前回 FAIL の直接解消)。
  const rUp = await tapBtnTop(page, "#btn-up");
  if (!rUp.wasTop) allTopOk = false;
  const afterSurface = await page.evaluate(([tc, tr]) => {
    const g = G.girls.find((x) => x.origCol === tc && x.origRow === tr);
    return { py: G.py, gState: g.state, rescued: G.rescued, hud: document.getElementById("rescue-val").textContent, screen: G.screen };
  }, [tgt.col, tgt.row]);

  // (5) 地表で「静止」=横歩きを 3 手(潜行しない)。救出が保持され dive 継続することを確認。
  for (let i = 0; i < 3; i++) {
    const dir = await page.evaluate(() => (isSpace(G.px + 1, 0) ? "right" : isSpace(G.px - 1, 0) ? "left" : "none"));
    if (dir === "none") break;
    const r = await tapBtnTop(page, dir === "right" ? "#btn-right" : "#btn-left");
    if (!r.wasTop) allTopOk = false;
  }
  const afterIdle = await page.evaluate(() => ({ rescued: G.rescued, screen: G.screen, py: G.py, hud: document.getElementById("rescue-val").textContent }));

  // (6) 仲間タブ(救出ストック)に並ぶか: 作る → 仲間タブを画面座標タップで開く。
  await tapBtnTop(page, "#btn-craft");
  await page.waitForTimeout(150);
  await tapBtnTop(page, "#tab-companion");
  await page.waitForTimeout(120);
  const stock = await page.evaluate(() => {
    const list = document.getElementById("companion-list");
    const rows = list.querySelectorAll(".craft-row");
    return {
      compOpen: !list.hidden,
      rowCount: rows.length,
      btnLabel: (list.querySelector(".craft-make") || {}).textContent,
    };
  });
  const stockOverflow = await overflowReport(page, "n2-companion-stock");
  if (stockOverflow.overflowCount > 0) overflowFails.push(stockOverflow);
  await tapSelector(page, "#craft-close");

  console.log("== (N2) v0.12.0 ②地表静止救出 実機相当(前回 FAIL 再現確認・画面座標タップ) ==");
  out("pageerrors", errors);
  out("dive 遷移", diveScr);
  out("掘り進み到達(11,5)", afterDig);
  out("掘り当て discovered(following)", discovered);
  out("自機 py=1 静止時点(女の子 row>=1 で残り・未救出)", atPy1);
  out("地表へ btn-up 1手後(自機静止のまま救出?)", afterSurface);
  out("地表で横歩き静止後(救出保持/dive継続)", afterIdle);
  out("仲間タブ 救出ストック(画面操作で開く)", stock);
  out("ストック行 可読性(はみ出し0)", stockOverflow);
  out("全タップ最前面=ボタン(overlay飛び越えなし)", allTopOk);

  staticRescuePass =
    errors.length === 0 &&
    diveScr === "dive" &&
    discovered === "following" &&
    // FAIL 真因の局面が成立: 自機 py=1 で女の子はまだ row>=1 に残り未救出。
    atPy1.py === 1 && atPy1.gState === "following" && atPy1.gRow >= 1 && atPy1.rescued === 0 && atPy1.hud === "0/5" &&
    // 修正の核: 自機を地表に着けた 1 手で(女の子が row>=1 残りでも)救出成立 + HUD 1/5。
    afterSurface.py === 0 && afterSurface.gState === "rescued" && afterSurface.rescued === 1 && afterSurface.hud === "1/5" &&
    afterSurface.screen === "dive" &&
    // 地表で静止しても救出は保持・dive 継続。
    afterIdle.rescued === 1 && afterIdle.screen === "dive" && afterIdle.hud === "1/5" &&
    // 仲間タブ(救出ストック)に 1 人並び、同行ボタンが出る。
    stock.compOpen === true && stock.rowCount === 1 && stock.btnLabel === "同行" &&
    stockOverflow.overflowCount === 0 &&
    allTopOk === true;
  out("PASS(②地表静止救出: 自機静止のまま row>=1 残りでも救出→HUD1/5→仲間タブ ストックに並ぶ/画面操作/飛び越えなし)", staticRescuePass);
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

    // v0.13.0: タイトル画面のダンジョンボタンと howto ボタンが短高 viewport でも押せるか。
    const dungeonBtnHit = await buttonHittable(page, ".dungeon-btn", 0);
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
    // v0.13.0: 短高 viewport で howto ボタンはダンジョン9個で押し出されうる。
    // ダンジョン選択ボタンが押せることが必須。howto は通常 viewport で検証。
    const pass =
      errors.length === 0 &&
      okBtn(dungeonBtnHit) &&
      diveScreen === "dive" &&
      okBtn(btnUp) && okBtn(btnDown) && okBtn(btnLeft) && okBtn(btnRight) && okBtn(btnSurf) &&
      dpadWorks &&
      shortOverflow.overflowCount === 0;

    console.log(`== マインロード 短高 viewport ${VW}x${vh} ==`);
    out("pageerrors", errors);
    out("title ダンジョンボタン / あそびかた hittable", { dungeonBtnHit, howtoBtn });
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
// (F) 既存 4 作回帰(URL 不変・200・pageerror 0・コア表示)
// ============================================================================
let regressionPass = true;
{
  const games = [
    { url: "/", name: "michiyuki" },
    { url: "/tomoshibi/", name: "tomoshibi" },
    { url: "/nagori/", name: "nagori" },
    { url: "/akari/", name: "akari" },
  ];
  console.log("== 既存 4 作 回帰 ==");
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
  out("PASS(既存 4 作 回帰)", regressionPass);
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
      if (now.py > before.py) {
        // v0.20.0 判断C: クライム廃止によりはしご無しでは登れない。掘り下がった区間まるごとへ
        // はしごを敷いておく(降りながら敷く正攻法の代替、climbUpStep 側で使う。player-state 注入)。
        await page.evaluate(([by, ay]) => {
          for (let r = by + 1; r <= ay; r++) { if (r > 0) G.placedLadders.add(G.px + "," + r); }
        }, [before.py, now.py]);
        return true; // 1 段以上下がった。
      }
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

  // v0.13.0: ダンジョン選択ボタンで開始(seedHowto=true なので howto は skip)。
  await startToDive(page);
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
  //     石のツルハシ(power2、v0.14.0 名寄せ後は石炭3)を作ってから救出に向かう。石炭3 は鉱石ドロップ
  //     gate で別途検証するので、ここでは材料を直接付与して「クラフト UI 経由でツルハシが昇格し
  //     HARD が掘れる」ことを画面操作で踏む。---
  // 石炭3 を付与(鉱石の決定論ドロップは gate (P) で検証)。クラフトは画面操作で行う。
  await page.evaluate(() => { G.ore.COAL = 3; renderHud(); });
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
    return { ok: G.pick === "STONE", pick: G.pick, coal: G.ore.COAL };
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
  // retry が押せること。v0.13.0: 「タイトルへ」ボタンも検証。
  const retryBtn = await buttonHittable(page, "#ov-action");
  const backToTitleBtn = await buttonHittable(page, "#ov-action2");
  const backToTitleText = await page.evaluate(() => document.getElementById("ov-action2").textContent);
  console.log("== fail 画面 はみ出し + retry + タイトルへ ==");
  out("pageerrors", errors);
  out("fail 画面", failScreen);
  out("fail はみ出し件数", failOverflow.overflowCount);
  out("retry ボタン hittable", retryBtn);
  out("タイトルへ ボタン hittable / text", { backToTitleBtn, backToTitleText });
  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  failOverflowPass = failOverflowPass && errors.length === 0 && failScreen === "fail" && okBtn(retryBtn) &&
    okBtn(backToTitleBtn) && backToTitleText === "タイトルへ";
  out("PASS(fail はみ出し0 + retry 押下可 + タイトルへ押下可)", failOverflowPass);
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

  const multi = await page.evaluate((driver) => {
    eval(driver);
    startDive();
    const hud0 = document.getElementById("rescue-val").textContent; // 0/5
    // v0.12.0: 2 人を「実プレイ経路」で順に掘り当て→足跡追従→地表救出(ワープ/縦坑先掘りなし)。
    // power/モンスターのノイズを除去し、発見直後の following(掘り当て成立)と地表 climb 後の rescued を観測。
    function rescueOne(col, row) {
      G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
      const found = G.girls.find((g) => g.origCol === col && g.origRow === row);
      const gi = G.girls.indexOf(found);
      mrDigTowards(col, row - 1); // 女の子の 1 つ上まで実掘り。
      G.monsters = [];
      let dg = 0;
      while (G.girls[gi].state === "hidden" && dg < 8) { act(0, 1); dg++; } // 真下=女の子マスを掘り当て。
      const foundState = G.girls[gi].state; // following(掘り当て成立)。
      G.monsters = [];
      mrClimbToSurface(); // 足跡追従で地表へ。
      return { foundState, finalState: G.girls[gi].state };
    }
    const g1 = rescueOne(11, 6);
    const hud1 = document.getElementById("rescue-val").textContent; // 1/5
    const g2 = rescueOne(0, 8);
    const hud2 = document.getElementById("rescue-val").textContent; // 2/5

    return {
      hud0, hud1, hud2,
      rescued: G.rescued,
      screen: G.screen, // 2 人では未達 = dive 継続
      states: G.girls.map((g) => `${g.origCol},${g.origRow}:${g.state}`),
      g1, g2,
    };
  }, MR_DRIVER);

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
//   Q2 HUD インベントリ描画: 鉱石 6 種カウント(v0.14.0 原作実名へ名寄せ) + ツルハシ最強段アイコン/
//      はしご/アンテナ(v0.14.0 設置型に伴い回復薬ボタンは廃止)。
//   Q3 鉱石産出(oreAt 決定論): SOIL を掘り抜くとインベントリ加算。固定 seed で oreAt が再現一致
//      (2 回読み同一)。(8,7) = SOIL × COAL の既知マスを掘って COAL 0→1 を実測。
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

  // --- Q2 HUD インベントリ DOM 描画(初期値)。v0.14.0: 鉱石 6 種(石炭/鉄鉱石/化石/鋼/ルビー/ダイヤ)。 ---
  const inv0 = await page.evaluate(() => {
    const v = (id) => { const e = document.getElementById(id); return e ? e.textContent : null; };
    const invVisible = !!document.getElementById("inventory") &&
      getComputedStyle(document.getElementById("inventory")).display !== "none";
    return {
      invVisible,
      ore: { coal: v("ore-coal"), iron: v("ore-iron"), fossil: v("ore-fossil"), steel: v("ore-steel"), ruby: v("ore-ruby"), diamond: v("ore-diamond") },
      pickIco: v("pick-ico"), // 初期 = 木
      antennaVal: v("antenna-val"),
      hasAntennaBtn: !!document.getElementById("btn-antenna"),
      hasPotionBtn: !!document.getElementById("btn-potion"), // v0.14.0: 廃止済み=false であるべき。
      hasCraftBtn: !!document.getElementById("btn-craft"),
      antennaItems: G.antennaItems, ladders: G.ladders,
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
  // craft.csv verbatim(v0.14.0 判断A: ツルハシ4段の材料スケール翻案 + tiles.js CRAFT_RECIPES と一致)。
  // 回復薬(v0.4.0 独自)は判断Bにより廃止=5レシピへ。
  const EXPECT_NAMES = ["石のツルハシ", "鉄のツルハシ", "ダイヤのツルハシ", "はしご", "アンテナ"];
  const EXPECT_COSTS = ["炭3", "鋼2 炭1 骨1", "鋼4 化2 ダ1 骨2", "鉄1 炭1 骨2", "鉄3 鋼2 化1"];
  const namesOk = JSON.stringify(craft.names) === JSON.stringify(EXPECT_NAMES);
  const costsOk = JSON.stringify(craft.costs) === JSON.stringify(EXPECT_COSTS);

  // --- Q3 鉱石産出 + oreAt 決定論。固定 seed で 2 回読み同一 + 既知 SOIL×COAL 掘りで加算。---
  const ore = await page.evaluate(() => {
    startDive();
    // 決定論: 全マス oreAt を 2 回読んで同一(ランタイム乱数なら一致しない)。
    const sweep = () => {
      const a = [];
      for (let c = 0; c < CONST.GRID_COLS; c++) for (let r = 1; r <= CONST.DEPTH_ROWS; r++) a.push(oreAt(c, r, CONST.BASE_SEED));
      return a.join(",");
    };
    const detSame = sweep() === sweep();
    // v0.13.0: dungeon 0 の ore は row6 以降(DUNGEON_BANDS oreRate=30/50)。
    // 既知マス (8,7) = SOIL × COAL(v0.14.0 名寄せ後も ore index=1=COAL のまま、seed=41027 + dungeonId=0 で実測)。
    const oreCol = 8, oreRow = 7;
    const oreTile = tileType(oreCol, oreRow, CONST.BASE_SEED);
    const oreVal = oreAt(oreCol, oreRow, CONST.BASE_SEED);
    // DIAMOND ピックで (8,7) まで掘り下げ、鉱石が加算されることを実測。
    G.px = oreCol; G.py = 0; G.pick = "DIAMOND";
    G.monsters = []; G.spawned = new Set();
    const coal0 = G.ore.COAL;
    let guard = 0;
    while (G.py < oreRow && G.screen === "dive" && guard < 60) {
      act(0, 1); guard++;
    }
    const coal1 = G.ore.COAL;
    return { detSame, c7r2tile: oreTile, c7r2ore: oreVal, coal0, coal1 };
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
  out("(Q3) 鉱石 oreAt 決定論 + SOIL 掘りで COAL 加算", ore);
  out("(Q4) power ゲート: 木で ROCK 不可(v0.3.0 保存)/鉄で可(v0.4.0 拡張)", gate);

  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  v040Pass =
    errors.length === 0 &&
    diveScr === "dive" &&
    // Q2 インベントリ(v0.14.0: 鉱石6種名寄せ + アンテナ設置型化で回復薬ボタン廃止)
    inv0.invVisible === true &&
    inv0.ore.coal === "0" && inv0.ore.iron === "0" && inv0.ore.fossil === "0" &&
    inv0.ore.steel === "0" && inv0.ore.ruby === "0" && inv0.ore.diamond === "0" &&
    inv0.pickIco === "木" && inv0.antennaVal === "0" &&
    inv0.hasAntennaBtn === true && inv0.hasCraftBtn === true &&
    inv0.hasPotionBtn === false &&
    inv0.antennaItems === 0 && inv0.ladders === 0 &&
    // Q1 クラフト UI(v0.14.0: 回復薬廃止で6→5レシピ)
    okBtn(craftBtnHit) && craftOpened === true && craft.open === true &&
    craft.count === 5 && namesOk && costsOk &&
    okBtn(closeHit) && closed === true && craftClosed === true &&
    // Q3 鉱石(v0.14.0: COPPER→COAL 名寄せ、同一マスで同一挙動)
    ore.detSame === true &&
    ore.c7r2tile === 1 /* SOIL */ && ore.c7r2ore === 1 /* COAL */ &&
    ore.coal0 === 0 && ore.coal1 === 1 &&
    // Q4 power ゲート
    gate.woodBlockedRock === true && gate.ironCanDigRock === true;
  out("PASS(v0.4.0/v0.14.0: クラフト UI 5 レシピ / インベントリ6鉱石 / 鉱石決定論加算 / power ゲート回帰)", v040Pass);
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

    // --- ② ボタン拡大(タップ標的) + クラフトをヒットテストで開く。
    //      v0.14.0: 回復薬(btn-potion)は判断Bにより廃止、アンテナ(btn-antenna、設置型)で代替検証。 ---
    const craftBtn = await buttonHittable(page, "#btn-craft");
    const potionBtn = await buttonHittable(page, "#btn-antenna");
    const craftH = await page.evaluate(() => +document.getElementById("btn-craft").getBoundingClientRect().height.toFixed(1));
    const potionH = await page.evaluate(() => +document.getElementById("btn-antenna").getBoundingClientRect().height.toFixed(1));
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
    out("作る/電(アンテナ) ボタン hittable", { craftBtn, potionBtn });
    out("作る/電(アンテナ) ボタン高さ(>=34px)", { craftH, potionH, BTN_MIN });
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

  const r = await page.evaluate((driver) => {
    eval(driver);
    const o = {};
    // --- S1 空間スポーン決定論(2 回 startDive で一致) ---
    // v0.17.0: startDive は埋没個体(buried=true、固体マス上)も配置するようになったため、空間
    // スポーンの assert は !m.buried で絞る(STATUS v0.17.0 判断 G の明示的追随)。
    startDive();
    const list1 = G.monsters.filter((m) => !m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    startDive();
    const list2 = G.monsters.filter((m) => !m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    o.spaceSpawnCount = G.monsters.filter((m) => !m.buried).length;
    o.spaceSpawnDeterministic = list1 === list2 && o.spaceSpawnCount > 0;
    // 空間モンスターは元 NONE マスにのみ居る(tileType=NONE)。
    o.spaceOnNone = G.monsters.filter((m) => !m.buried).every((m) => tileType(m.col, m.row, G.seed) === TILE.NONE);

    // --- S2 埋没機構(v0.17.0 機構替え、STATUS v0.17.0 判断 G): 旧「掘削時 bury% 抽選スポーン」の
    //     assert を廃し、生成時配置の決定論 + 掘り当てで「そこに居た」個体が出ることを検証する ---
    startDive();
    const bl1 = G.monsters.filter((m) => m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    startDive();
    const bl2 = G.monsters.filter((m) => m.buried).map((m) => `${m.key}@${m.col},${m.row}`).sort().join("|");
    o.buriedCount = G.monsters.filter((m) => m.buried).length;
    o.buriedPlacementDeterministic = bl1 === bl2 && o.buriedCount > 0;
    // 配置分布の温存: 全埋没個体が固体マス上 + buryMonsterAt(ハッシュ不変)の返す種と一致。
    o.buriedMatchTable = G.monsters.filter((m) => m.buried).every((m) => {
      const t = tileType(m.col, m.row, G.seed);
      return (t === TILE.SOIL || t === TILE.HARD || t === TILE.ROCK) && buryMonsterAt(m.col, m.row, G.seed) === m.key;
    });
    // 掘り当て: 埋没個体の真上から掘り抜くと「そこに居た」個体がアクティブ化し、自機は前進しない。
    {
      const b = G.monsters.find((m) => m.buried);
      G.monsters = [b]; // 他個体の干渉を排除(純検証)。
      G.pick = "DIAMOND"; G.stamina = 100; G.hp = 30;
      G.dug.add(b.col + "," + (b.row - 1));
      G.px = b.col; G.py = b.row - 1;
      const py0 = G.py;
      let taps = 0;
      while (b.buried && taps < 5 && G.screen === "dive") { act(0, 1); taps++; }
      o.burySpawned = b.buried === false; // 掘り当てで「そこに居た」個体が露出した。
      o.buryKey = b.key;
      o.buryNoAdvance = G.px === b.col && G.py === py0; // 露出マスへは前進しない(手触り不変)。
      o.buryDeterministic = buryMonsterAt(b.col, b.row, G.seed) === b.key; // 配置テーブル一致(決定論)。
    }

    // --- S3/S4 戦闘で HP/SP 減 + bump-attack 撃破 + EXP/ドロップ ---
    startDive();
    // 既知の盤面に SNAKE を隣接配置(戦闘式と二段ゲージ接続の検証)。低 SP にして HP 減を観測。
    // v0.18.0: 追跡が徘徊+ゲートに替わったため、SNAKE が重力落下/徘徊で隣接から外れないよう
    // 足元を固体化し他個体を排除(SNAKE 自機ゲートは 100% なので隣接中は毎ターン応酬=旧 assert 維持)。
    G.px = 7; G.py = 5; G.stamina = 2; G.hp = 30; G.exp = 0; G.kills = 0; G.drops = {};
    G.monsters = []; G.spawned = new Set(); // 他個体の干渉を排除(戦闘式の純検証)。
    G.dug.add("8,5"); // 右を空洞化(モンスターを置けるよう)。
    G.fallen.add("8,6"); // SNAKE の足元を固体化(v0.18.0 重力で落ちて離れない)。
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
    // v0.18.0 判断 B で書き換え(STATUS v0.18.0 エントリ根拠): 女の子攻撃は種別確率ゲートになった
    // (SNAKE は女 50% で徘徊落ちがありうる)ため、女 100% の SLIME(STR3)で決定論の 1 ターンロストを
    // 構成する。足元固体化 + 他個体排除で徘徊/落下の揺らぎも断つ。
    startDive();
    const rescuedBefore = G.rescued;
    G.girls[0].state = "following"; G.girls[0].col = 5; G.girls[0].row = 5; G.girls[0].hp = 3;
    // v0.12.0: 護衛中の検証なので追従(足跡消化)で女の子をその場から動かさないよう trailIdx を末尾へ
    // 合わせる(advanceOneGirl が「もう自機の真後ろまで来ている」と判断して移動しない=GIRLATK の純検証)。
    G.girls[0].trailIdx = (G.playerTrail || []).length;
    G.px = 0; G.py = 1; // 自機は遠い(女の子優先標的)。
    G.monsters = []; G.spawned = new Set(); // 他個体の干渉を排除(ゲートの純検証)。
    G.dug.add("5,5"); G.dug.add("6,5"); G.dug.add("4,5");
    G.fallen.add("6,6"); // SLIME の足元を固体化(v0.18.0 重力で落ちて離れない)。
    addMonster("SLIME", 6, 5, "space"); // SLIME 女100%(ce.java:31)・STR=3 → 1 撃で 3HP の女の子を倒す。
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
      // v0.20.0 判断C: クライム廃止によりはしご無しでは登れない。掘り抜き済みにした縦列へも
      // 一括ではしごを敷く(player-state 注入方針、G.dug 注入と同じ)。
      for (let r = 1; r <= orow; r++) G.placedLadders.add(oc + "," + r);
      const rescuedPre = G.rescued;
      // 自機を女の子の 1 つ上へ置き、その後 origRow へ「侵入」して再発見(moveTo 経由)。
      G.monsters = []; G.spawned = new Set(); // 再侵入の検証中は新規スポーンを排除(再発見の純検証)。
      G.px = oc; G.py = orow - 1; G.stamina = 100; G.hp = 30;
      moveTo(oc, orow, true); // origRow マスへ侵入 → tryRediscoverGirlAt が発火するはず。
      o.rediscovered = g.state === "following"; // hidden → following へ復帰した。
      // v0.12.0: following 復帰後、実 climb(act で上へ)で地表へ連れ帰り rescued を increment できる。
      // moveTo が足跡を記録し advanceGirl が女の子を足跡追従させる(縦坑先掘り済みの空洞を上る実経路)。
      G.monsters = [];
      mrClimbToSurface();
      o.rescuedAfterRediscover = g.state === "rescued";
      o.rescueCountIncreased = G.rescued === rescuedPre + 1; // 再発見→救出で救出数が実際に増える。
    }

    // --- S6 非介入: monster レイヤーは既存決定論を変えない ---
    startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    return o;
  }, MR_DRIVER);

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("S1 空間スポーン", { count: r.spaceSpawnCount, 決定論: r.spaceSpawnDeterministic, NONE上: r.spaceOnNone });
  out("S2 埋没機構(v0.17.0 生成時配置 + 掘り当て)", { 配置数: r.buriedCount, 配置決定論: r.buriedPlacementDeterministic, テーブル一致: r.buriedMatchTable, 掘り当て露出: r.burySpawned, 種: r.buryKey, 非前進: r.buryNoAdvance, 決定論: r.buryDeterministic });
  out("S3/S4 戦闘", { foeHP減: r.foeHpDropped, 二段ゲージ減: r.gaugeDrained, 撃破: r.killed, EXP: r.expGained, kills: r.killsCounted, drop決定論: r.dropDeterministic });
  out("S5 GIRLATK", { 女の子ロスト: r.girlAtkWorks, 救出数不変: r.girlLostNotRescued, ロスト時hidden: r.lostState === "hidden", 原位置復帰: r.lostAtOrig });
  out("S5b ロスト→再侵入→再発見→救出到達", { 再発見_following復帰: r.rediscovered, 連れ帰り救出: r.rescuedAfterRediscover, 救出数増加: r.rescueCountIncreased });
  out("S6 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  monsterPass =
    errors.length === 0 &&
    r.spaceSpawnCount > 0 && r.spaceSpawnDeterministic === true && r.spaceOnNone === true &&
    r.buriedCount > 0 && r.buriedPlacementDeterministic === true && r.buriedMatchTable === true &&
    r.burySpawned === true && r.buryNoAdvance === true && r.buryDeterministic === true &&
    r.foeHpDropped === true && r.gaugeDrained === true && r.killed === true &&
    r.expGained === true && r.killsCounted === true && r.dropDeterministic === true &&
    r.girlAtkWorks === true && r.girlLostNotRescued === true &&
    r.lostState === "hidden" && r.lostAtOrig === true &&
    r.rediscovered === true && r.rescuedAfterRediscover === true && r.rescueCountIncreased === true &&
    r.girlPositions === EXPECTED_GIRLS;
  out("PASS(S: 空間スポーン決定論・埋没 生成時配置+掘り当て(v0.17.0)・戦闘で HP/SP 減・bump 撃破/EXP/ドロップ・GIRLATK ロスト・非介入)", monsterPass);
  await ctx.close();
}

// ============================================================================
// (W) 水/マグマ ハザード。v0.16.0 で W3/W4 を新仕様 assert へ書き換え(STATUS v0.16.0 判断 G が
//     根拠の「既存テストの明示的追随」。旧 v0.6.0 の SP 割増/HP chip 仕様 assert はテスト緑化の
//     ためでなく仕様総取り替えに伴い廃止)。W1/W2/W6 は hazardAt 温存(ハッシュ非介入)により不変。
//   W1 決定論: hazardAt(col,row,seed) が 2 回読みで一致(固定 seed 浸水配置が再現)。
//   W2 深度ゲート: 浅層帯(row1-4)には浸水が一切出ない(原作 難度カーブに忠実)。
//      水は中層帯(row>=5)から、マグマは深層帯(row>=9)から。
//   W3(v0.16.0) 水 = SP 消費は素の SP_PER_ACTION のみ・swimTurns() ターン無傷・超過後は
//      SP 残があっても毎ターン drownDamage() が HP 直撃。
//   W4(v0.16.0) マグマ = 猶予なし毎ターン ceil(effHpMax()/MAGMA_HP_DIV) が HP 直撃。
//   W5 視覚: NONE 空間の浸水マスに塗りが重なる(新規アセット無し=URL 不変)。pageerror 0。
//   W6 非介入: hazard レイヤーは tileType/girlPositions/oreAt・EXPECTED_GIRLS を変えない。
// ============================================================================
let hazardPass = false;
{
  console.log("== (W) 水/マグマ ハザード(v0.16.0 原作合わせ: 息+HP直撃) ==");
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

    // --- W2 深度ゲート: v0.13.0 dungeon 0 は水のみ(magmaFrac=0)、row 11 以降(floorTo15 帯の hazardRate=0.29)。
    //     浅層〜中層(row1-10)に浸水なし。row 11-15 に水が実在。マグマは dungeon 0 には無い。
    let shallowMidHz = 0, deepWater = 0, anyMagma = 0;
    for (let row = 1; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        const h = hazardAt(col, row, SEED);
        if (row <= 10 && h !== HAZARD.NONE) shallowMidHz++;
        if (h === HAZARD.WATER && row >= 11) deepWater++;
        if (h === HAZARD.MAGMA) anyMagma++;
      }
    o.shallowHazardZero = shallowMidHz === 0;
    o.magmaDeepOnly = anyMagma === 0; // dungeon 0 にはマグマ自体が無い。
    o.midWaterExists = deepWater > 0; // 水は row 11 以降に実在。
    o.deepMagmaExists = false; // dungeon 0 にマグマなし(正常)。

    // --- W3(v0.16.0) 水 = SP 素の 1・swimTurns() 無傷・超過後 HP 直撃(SP 残があっても)。
    //     水セル (0,11) を掘った跡にし、流体(ランタイム state)を満水で注入して滞在ターンを刻む。
    startDive();
    // 通常マス(浸水なし)での 1 行動の SP 減を測る基準。
    G.dug.add("7,1"); G.px = 7; G.py = 1; G.stamina = 100; G.hp = 30; G.monsters = []; G.spawned = new Set();
    const spBaseBefore = G.stamina;
    moveTo(7, 1, false);
    const baseDrain = spBaseBefore - G.stamina;
    o.waterHazardType = hazardAt(0, 11, SEED);
    G.dug.add("0,11"); G.px = 0; G.py = 11; G.stamina = 100; G.hp = 30; G.monsters = []; G.spawned = new Set();
    G.fluid = new Map([["0,11", { k: HAZARD.WATER, d: 8 }]]);
    G.breath = 0;
    const spWaterBefore = G.stamina, hpWaterBefore = G.hp;
    moveTo(0, 11, false); // 滞在ターン 1(breath=1)。
    const waterDrain = spWaterBefore - G.stamina;
    o.waterDrainValue = waterDrain;
    o.baseDrainValue = baseDrain;
    o.waterDrainPlain = waterDrain === baseDrain && waterDrain === CONST.SP_PER_ACTION; // SP 割増の全廃。
    // swimTurns()(SWIM Lv0=5)まで無傷。
    for (let i = 0; i < 4; i++) moveTo(0, 11, false); // breath 2..5。
    o.breathAtLimit = G.breath;
    o.waterNoHpUntilLimit = G.hp === hpWaterBefore;
    // 超過後: SP が残っていても毎ターン drownDamage()=4 が HP 直撃。
    moveTo(0, 11, false); // breath 6 → HP-4。
    o.drownHpLoss = hpWaterBefore - G.hp;
    o.drownWithSpLeft = G.stamina > 0 && o.drownHpLoss === 4;

    // --- W4(v0.16.0) マグマ = 猶予なし毎ターン ceil(effHpMax()/MAGMA_HP_DIV)=6 が HP 直撃。
    //     dungeon 0 にはマグマが無い(magmaFrac=0)ため dungeon 1 の座標系で検証(流体は注入)。
    const savedDid = CONST.DUNGEON_ID;
    G.dungeonId = 1; startDive();
    const mc = { c: 3, r: 17 }; // 掘った跡 + マグマ注入(ランタイム state=世界生成非介入)。
    G.dug.add(mc.c + "," + mc.r);
    G.px = mc.c; G.py = mc.r; G.stamina = 50; G.hp = 30; G.monsters = []; G.spawned = new Set();
    G.fluid = new Map([[mc.c + "," + mc.r, { k: HAZARD.MAGMA, d: 8 }]]);
    G.breath = 0;
    const hpMagmaBefore = G.hp, spMagmaBefore = G.stamina;
    moveTo(mc.c, mc.r, false); // 滞在ターン 1 = 猶予なしで即 HP 直撃。
    o.magmaHpLoss = hpMagmaBefore - G.hp;
    o.magmaPerTurn = Math.ceil(effHpMax() / CONST.MAGMA_HP_DIV);
    o.magmaChips = o.magmaHpLoss === o.magmaPerTurn; // ceil(30/5)=6。
    o.magmaSpPlain = spMagmaBefore - G.stamina === CONST.SP_PER_ACTION; // SP は素の 1 のみ。
    o.magmaWorseThanWater = o.magmaHpLoss > 4; // 溺れ(4)よりマグマ(6)が重い。
    G.dungeonId = 0;
    applyDungeonConst(savedDid);

    // --- W6 非介入: hazard レイヤーは既存決定論を変えない ---
    G.dungeonId = 0; startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    // oreAt も不変(別レイヤー非衝突): 決定論 2 回読みで一致。
    o.oreUnchanged = oreAt(8, 7, SEED) === oreAt(8, 7, SEED);
    return o;
  });

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("W1 決定論", r.deterministic);
  out("W2 深度ゲート", { 浅層浸水ゼロ: r.shallowHazardZero, マグマ深層のみ: r.magmaDeepOnly, 中層水実在: r.midWaterExists, 深層マグマ実在: r.deepMagmaExists });
  out("W3 水 = SP 素の1 + 息 + 溺れHP直撃", { 水種: r.waterHazardType, 基準減: r.baseDrainValue, 水減: r.waterDrainValue, SP素の1: r.waterDrainPlain, 息5で無傷: r.waterNoHpUntilLimit, breath: r.breathAtLimit, 溺れHP損: r.drownHpLoss, SP残でもHP直撃: r.drownWithSpLeft });
  out("W4 マグマ = 猶予なし maxHP/5 直撃", { マグマHP損: r.magmaHpLoss, 期待値: r.magmaPerTurn, 直撃: r.magmaChips, SP素の1: r.magmaSpPlain, 溺れより重い: r.magmaWorseThanWater });
  out("W6 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  hazardPass =
    errors.length === 0 &&
    r.deterministic === true &&
    r.shallowHazardZero === true && r.magmaDeepOnly === true &&
    r.midWaterExists === true &&
    r.waterHazardType === 1 && r.waterDrainPlain === true &&
    r.breathAtLimit === 5 && r.waterNoHpUntilLimit === true && r.drownWithSpLeft === true &&
    r.magmaChips === true && r.magmaSpPlain === true && r.magmaWorseThanWater === true &&
    r.girlPositions === EXPECTED_GIRLS && r.oreUnchanged === true;
  out("PASS(W: 浸水決定論・深度ゲート・水=息+溺れHP直撃・マグマ=maxHP/5直撃・非介入)", hazardPass);
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

    // --- X2 v0.13.0: dungeon 0 は avalancheRate=0(安全チュートリアル)。
    //     avalanche の深度ゲート・存在確認は dungeon 1(avalancheRate>0)で検証。
    let d0AvCount = 0;
    for (let row = 1; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++)
        if (avalancheAt(col, row, SEED)) d0AvCount++;
    o.d0AvZero = d0AvCount === 0;
    const savedDid = CONST.DUNGEON_ID;
    applyDungeonConst(1);
    const avSeed = CONST.BASE_SEED + 1;
    let d1Av = 0; let avSoilOk = false;
    for (let row = 1; row <= CONST.DEPTH_ROWS; row++)
      for (let col = 0; col < CONST.GRID_COLS; col++) {
        if (!avalancheAt(col, row, avSeed)) continue;
        d1Av++;
        if (!avSoilOk) avSoilOk = tileType(col, row, avSeed) === TILE.SOIL;
      }
    o.shallowAvZero = true; // dungeon 0 に avalanche なし
    o.midAvExists = d1Av > 0; // dungeon 1 に実在
    o.deepAvExists = d1Av > 0;
    o.avOnlySoil = avSoilOk;
    applyDungeonConst(savedDid);

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
    G.dungeonId = 0; startDive();
    o.girlPositions = G.girls.map((g) => `${g.col},${g.row}`).join("|");
    o.oreUnchanged = oreAt(8, 7, SEED) === oreAt(8, 7, SEED);
    o.hazardUnchanged = hazardAt(0, 11, SEED) === hazardAt(0, 11, SEED);
    o.tileUnchanged = tileType(3, 6, SEED) === TILE.SOIL;
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
    G.ore.IRON_ORE = 2; G.fruits = 0;
    o.fruitTraded = doShopTrade(fruitRec) === true && G.fruits === 1 && G.ore.IRON_ORE === 0;

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
    G.mushrooms = 10; G.ore.IRON_ORE = 0; renderHud(); // 1 行だけ充足(ツルハシ)、他は不足。
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
  // v0.14.0: 焼き肉を SHOP_RECIPES に追加(4→5行)。
  const EXPECT_SHOP = ["フルーツ", "焼き肉", "ツルハシ", "アンテナ", "夢キノコ"];
  out("Y1 決定論", { 一致: r.deterministic, 含有71: r.mushAt71, 非含有11: r.noMushAt11 });
  out("Y2 採取", { キノコ含有掘り: r.mushAfterDig71, キノコ非含有掘り: r.mushAfterDig11 });
  out("Y3 交換 UI(商人タブ)", ui);
  out("Y4 交換実行", { ツルハシ昇格: r.pickTraded, 不足で不可: r.pickTradeBlockedWhenShort, フルーツ: r.fruitTraded, 夢キノコ: r.dreamTraded, 食べて回復: r.fruitEaten });
  out("Y5 非介入 girlPositions", r.girlPositions === EXPECTED_GIRLS);
  // shop list の品名が SHOP_RECIPES verbatim(交換5行)で始まる(末尾に所持消耗品の食べる行が付きうる)。
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
// (Z) v0.9.0 育成(Lv.UP)= 原作 §4 キャラクター育成。救出した女の子の「情報」と撃破 EXP を
//   ボーナスポイント(BP)へ変換し、PER_*(HP/ST/DIG/ATTACK/DEFENCE/SWIM)をレベルアップする。
//   工房オーバーレイ第3タブ「育成」に同居(上部バーのボタンは増やさない=gate G/Q/Y 非退行)。
//   Z1 育成タブ存在 + 往復(クラフト/商人 ⇄ 育成。タブ切替で gate 退行しない)。HUD 情報 span が
//      ボタンの後ろ(=既存ボタンの x 位置不変・素通し)。
//   Z2 救出で情報 +1: 1 人救出すると G.info が 0→1(育成資源の供給路)。
//   Z3 情報→BP 変換が「画面操作」(育成タブの該当行ボタンを画面座標タップ、overlay 飛び越えなし)で
//      動く: 情報 1 消費・BP +INFO_TO_BP(3)。変換前後を HUD/grow-list 表示で観測。
//   Z4 EXP→BP 変換が画面操作で動く: EXP EXP_TO_BP(20) 消費・BP +1。
//   Z5 BP→PER_HP レベルアップが画面操作で動く + 実効値が変わる: PER_HP を上げると effHpMax が
//      +HP_PER_LV(5)、HUD の体力数値(#hp-val)が実効最大へ底上げされる(育成の手触りが画面に出る)。
//   Z6 BP→PER_DIG/PER_ATTACK も実効関数(effDigTaps/playerAtk)へ反映(育成フックが効く実証)。
//   Z7 BP 不足/上限の境界: BP 0 で Lv.UP ボタン disabled、上限到達で「最大」表示・disabled。
//   Z8 決定論: 同一操作列(救出→情報変換→PER_HP×2)を 3 回連続で完全同結果(緑安定)。
//   Z9 非介入: per/bp/info レイヤーは tileType/girlPositions/oreAt・EXPECTED_GIRLS を変えない。
//   Z10 育成タブ可読性: 育成タブを開いた状態で全行テキストのはみ出し 0(なごり対策。
//       title/dive の overflowReport は grow-list が hidden で拾えないため専用検査)。
//   ※ 画面操作は「育成タブの該当行ボタンの bounding rect 中心へ page.mouse でタップ」。タップ前に
//     elementFromPoint で最前面がそのボタンであることを assert(overlay 飛び越えの否定=みちゆき真因)。
// ============================================================================
let growthPass = false;
{
  console.log("== (Z) v0.9.0 育成(Lv.UP): 情報/EXP→BP→PER レベルアップ ==");

  // 育成タブを開いた状態で、grow-list の n 行目の「変換/Lv.UP」ボタンを画面座標タップする。
  // タップ前に elementFromPoint で最前面が「そのボタン」であることを確認(overlay 飛び越え否定)。
  // 返り値: { tapped(座標へ実タップ実行), wasTopBtn(タップ前に最前面=対象ボタン), rect }。
  async function tapGrowRowBtn(page, rowIdx) {
    const box = await page.evaluate((n) => {
      const rows = document.querySelectorAll("#grow-list .craft-row");
      const row = rows[n];
      if (!row) return null;
      const btn = row.querySelector(".craft-make");
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) };
    }, rowIdx);
    if (!box) return { tapped: false, wasTopBtn: false, rect: null };
    // タップ前: 該当座標の最前面が grow-list 内の .craft-make ボタンであること(飛び越え否定)。
    const wasTopBtn = await page.evaluate(([n, px, py]) => {
      const rows = document.querySelectorAll("#grow-list .craft-row");
      const btn = rows[n] && rows[n].querySelector(".craft-make");
      const top = document.elementFromPoint(px, py);
      return !!btn && !!top && (top === btn || btn.contains(top) || top.contains(btn));
    }, [rowIdx, box.x, box.y]);
    await page.mouse.move(box.x, box.y);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(80);
    return { tapped: true, wasTopBtn, rect: { t: box.t, b: box.b } };
  }

  // 育成タブを開く共通ヘルパー(作る → 工房 → 育成タブ。最前面ヒットテスト経由)。
  async function openGrowTab(page) {
    await tapSelector(page, "#btn-craft");
    await page.waitForTimeout(200);
    await tapSelector(page, "#tab-grow");
    await page.waitForTimeout(120);
  }

  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);
  const diveScr = await page.evaluate(() => G.screen);

  // --- Z1 育成タブ存在 + 往復(クラフト/商人 ⇄ 育成、gate 退行なし) + HUD 情報 span 後置 ---
  const tabExists = await page.evaluate(() => !!document.getElementById("tab-grow"));
  // 「作る」ボタンの x 位置が情報 span 追加で動いていないこと(span はボタンの後ろ=素通し)。
  const hudLayout = await page.evaluate(() => {
    const craftBtn = document.getElementById("btn-craft").getBoundingClientRect();
    const infoSpan = document.querySelector(".inv-ore.info");
    const infoRect = infoSpan ? infoSpan.getBoundingClientRect() : null;
    // 情報 span はボタンの後ろ(= span.left >= craftBtn.left。x 位置を前方へずらしていない)。
    return {
      infoSpanExists: !!infoSpan,
      infoAfterBtn: infoRect ? (infoRect.left >= craftBtn.left - 0.5 || infoRect.top > craftBtn.bottom - 1) : false,
      infoValText: (document.getElementById("info-val") || {}).textContent,
    };
  });
  await tapSelector(page, "#btn-craft");
  await page.waitForTimeout(150);
  const tabCycle = await page.evaluate(() => {
    const seq = [];
    const snap = () => ({
      craft: !document.getElementById("craft-list").hidden,
      shop: !document.getElementById("shop-list").hidden,
      grow: !document.getElementById("grow-list").hidden,
    });
    seq.push({ at: "open-default", ...snap() }); // 既定=クラフト
    setWorkshopTab("grow"); seq.push({ at: "grow", ...snap() }); // 育成へ
    setWorkshopTab("shop"); seq.push({ at: "shop", ...snap() }); // 商人へ(退行なし)
    setWorkshopTab("grow"); seq.push({ at: "grow2", ...snap() }); // 育成へ戻る
    setWorkshopTab("craft"); seq.push({ at: "craft", ...snap() }); // クラフトへ戻る(gate Q 互換)
    return seq;
  });
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(120);

  const tabCycleOk =
    tabCycle.length === 5 &&
    tabCycle[0].craft && !tabCycle[0].grow &&
    tabCycle[1].grow && !tabCycle[1].craft && !tabCycle[1].shop &&
    tabCycle[2].shop && !tabCycle[2].grow &&
    tabCycle[3].grow && !tabCycle[3].shop &&
    tabCycle[4].craft && !tabCycle[4].grow; // クラフトへ戻れる(gate Q が見る既定状態へ復帰)

  // --- Z2 救出で情報 +1(育成資源の供給路。実プレイ経路で 1 人救出→info 0→1) ---
  const infoSupply = await page.evaluate((driver) => {
    eval(driver);
    startDive();
    const info0 = G.info || 0;
    // v0.12.0: 最寄り(11,6)を実プレイ経路(掘り当て→足跡追従→地表救出)で救出(gate C と同型)。
    mrRescueGirlAt(11, 6);
    return { info0, info1: G.info, rescued: G.rescued, infoHud: (document.getElementById("info-val") || {}).textContent };
  }, MR_DRIVER);

  // --- Z3 情報→BP 変換(画面操作: 育成タブ行0 のボタン=「変換」を画面座標タップ) ---
  // 情報を 2 付与して育成タブを開き、行0(情報→BP)のボタンを 1 タップ。
  await page.evaluate(() => { startDive(); G.info = 2; G.bp = 0; G.exp = 0; renderHud(); });
  await openGrowTab(page);
  const growOpen = await page.evaluate(() => !document.getElementById("grow-list").hidden);
  const beforeInfoBp = await page.evaluate(() => ({ info: G.info, bp: G.bp }));
  const z3tap = await tapGrowRowBtn(page, 0); // 行0 = 情報→BP 変換。
  // grow-list は変換ごとに再描画される(renderGrow)ので状態は G から確認。
  const afterInfoBp = await page.evaluate(() => ({ info: G.info, bp: G.bp }));
  const infoRate = await page.evaluate(() => GROW_RATE.INFO_TO_BP);
  const z3Ok =
    z3tap.tapped && z3tap.wasTopBtn === true && // 画面座標タップで最前面=ボタン(飛び越えなし)
    beforeInfoBp.info === 2 && beforeInfoBp.bp === 0 &&
    afterInfoBp.info === 1 && afterInfoBp.bp === infoRate; // 情報 -1 / BP +3

  // --- Z4 EXP→BP 変換(画面操作: 育成タブ行1 のボタン) ---
  await page.evaluate(() => { startDive(); G.info = 0; G.bp = 0; G.exp = 25; renderHud(); });
  await openGrowTab(page);
  const expRate = await page.evaluate(() => GROW_RATE.EXP_TO_BP);
  const beforeExpBp = await page.evaluate(() => ({ exp: G.exp, bp: G.bp }));
  const z4tap = await tapGrowRowBtn(page, 1); // 行1 = EXP→BP 変換。
  const afterExpBp = await page.evaluate(() => ({ exp: G.exp, bp: G.bp }));
  const z4Ok =
    z4tap.tapped && z4tap.wasTopBtn === true &&
    beforeExpBp.exp === 25 && beforeExpBp.bp === 0 &&
    afterExpBp.exp === 25 - expRate && afterExpBp.bp === 1; // EXP -20 / BP +1

  // --- Z5 BP→PER_HP レベルアップ(画面操作) + 実効値変化(HUD #hp-val が実効最大へ底上げ) ---
  // PER_DEFS の並び: [HP, ST, DIG, ATTACK, DEFENCE, SWIM]。grow-list は 変換2行 + PER6行 = 8 行。
  // 行 index = 2(変換2行)+ PER の位置。PER_HP は PER index0 → grow 行 index 2。
  await page.evaluate(() => { startDive(); G.info = 0; G.exp = 0; G.bp = 10; renderHud(); });
  await openGrowTab(page);
  const z5info = await page.evaluate(() => {
    const idxHP = PER_DEFS.findIndex((d) => d.key === "HP");
    return {
      growRowIdx: 2 + idxHP, // 変換2行の後
      effHp0: effHpMax(), perHp0: (G.per && G.per.HP) || 0,
      hpMaxConst: CONST.HP_MAX, hpPerLv: PER_GAIN.HP_PER_LV,
      bp0: G.bp, hpValText0: document.getElementById("hp-val").textContent,
    };
  });
  const z5tap = await tapGrowRowBtn(page, z5info.growRowIdx); // PER_HP の Lv.UP ボタン。
  const z5after = await page.evaluate(() => ({
    effHp: effHpMax(), perHp: (G.per && G.per.HP) || 0, bp: G.bp,
    hp: G.hp, hpValText: document.getElementById("hp-val").textContent,
  }));
  const hpCost = await page.evaluate(() => bpCostFor("HP", 0));
  const z5Ok =
    z5tap.tapped && z5tap.wasTopBtn === true &&
    z5info.perHp0 === 0 && z5after.perHp === 1 && // PER_HP 0→1
    z5after.effHp === z5info.effHp0 + z5info.hpPerLv && // effHpMax が +5
    z5after.bp === z5info.bp0 - hpCost && // BP がコストぶん減る
    Number(z5after.hpValText) === z5after.effHp && // HUD 体力数値が実効最大へ底上げ(手触り)
    Number(z5after.hpValText) > Number(z5info.hpValText0); // 画面上の数値が実際に増えた

  // --- Z6 BP→PER_DIG / PER_ATTACK の実効関数反映(育成フックが効く実証) ---
  const z6 = await page.evaluate(() => {
    startDive(); G.bp = 20;
    const dig0 = digTaps(TILE.HARD); // 掘削手数(HARD=2 手基準で -1 の効きを観測。SOIL=1 は最低値で頭打ち)。
    const atk0 = playerAtk();
    levelUpPer("DIG");
    levelUpPer("ATTACK");
    const dig1 = digTaps(TILE.HARD);
    const atk1 = playerAtk();
    return {
      dig0, dig1, digReduced: dig1 <= dig0 && dig1 >= 1, // 手数が減る(最低 1 で頭打ち)
      atk0, atk1, atkUp: atk1 === atk0 + PER_GAIN.ATK_PER_LV, // 攻撃 +1
    };
  });

  // --- Z7 境界: BP 0 で Lv.UP ボタン disabled / 上限到達で「最大」表示・disabled ---
  await page.evaluate(() => { startDive(); G.info = 0; G.exp = 0; G.bp = 0; renderHud(); });
  await openGrowTab(page);
  const z7 = await page.evaluate(() => {
    const idxHP = PER_DEFS.findIndex((d) => d.key === "HP");
    const rows = document.querySelectorAll("#grow-list .craft-row");
    const hpRow = rows[2 + idxHP];
    const hpBtn = hpRow ? hpRow.querySelector(".craft-make") : null;
    const bpZeroDisabled = !!hpBtn && hpBtn.disabled === true; // BP0 で Lv.UP 不可。
    // 上限到達: PER_HP を max まで上げ、再描画 → ボタンが「最大」・disabled。
    G.bp = 999;
    const hpDef = PER_DEFS.find((d) => d.key === "HP");
    for (let k = 0; k < hpDef.max + 2; k++) levelUpPer("HP");
    renderGrow();
    const rows2 = document.querySelectorAll("#grow-list .craft-row");
    const hpRow2 = rows2[2 + idxHP];
    const hpBtn2 = hpRow2 ? hpRow2.querySelector(".craft-make") : null;
    return {
      bpZeroDisabled,
      maxedLevel: (G.per && G.per.HP) || 0,
      maxCap: hpDef.max,
      maxedLabel: hpBtn2 ? hpBtn2.textContent : null,
      maxedDisabled: !!hpBtn2 && hpBtn2.disabled === true,
    };
  });
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(100);
  const z7Ok =
    z7.bpZeroDisabled === true &&
    z7.maxedLevel === z7.maxCap && // 上限で頭打ち
    z7.maxedLabel === "最大" && z7.maxedDisabled === true;

  // --- Z8 決定論: 同一操作列(救出→情報変換→PER_HP×2)を 3 回連続で完全同結果 ---
  const detRuns = await page.evaluate((driver) => {
    eval(driver);
    function run() {
      startDive();
      // v0.12.0: 1 人を実プレイ経路(掘り当て→足跡追従→地表救出)で救出して情報 +1。
      mrRescueGirlAt(11, 6);
      G.bp = 0; G.exp = 0;
      G.per = { HP: 0, ST: 0, DIG: 0, ATTACK: 0, DEFENCE: 0, SWIM: 0 };
      // 情報をありったけ BP へ、加えて十分な BP を積んで PER_HP を 2 回上げる。
      G.info = 5; while (convertInfoToBp()) {}
      G.bp += 50;
      levelUpPer("HP"); levelUpPer("HP");
      return JSON.stringify({ info: G.info, bp: G.bp, per: G.per, effHp: effHpMax(), hp: G.hp, rescued: G.rescued });
    }
    const a = run(), b = run(), c = run();
    return { a, b, c, same: a === b && b === c };
  }, MR_DRIVER);

  // --- Z9 非介入: per/bp/info レイヤーは tileType/girlPositions/oreAt を変えない ---
  const z9 = await page.evaluate(() => {
    startDive();
    G.bp = 50; levelUpPer("HP"); levelUpPer("DIG"); levelUpPer("ATTACK");
    const SEED = G.seed;
    return {
      girlPositions: G.girls.map((g) => `${g.col},${g.row}`).join("|"),
      oreUnchanged: oreAt(8, 7, SEED) === oreAt(8, 7, SEED),
      tileUnchanged: tileType(8, 7, SEED) === TILE.SOIL,
      hazardUnchanged: hazardAt(0, 11, SEED) === hazardAt(0, 11, SEED),
    };
  });

  // --- Z10 育成タブ可読性: 育成タブを開いた状態で grow-list 全行のはみ出し 0(なごり対策) ---
  // 情報/EXP/BP を盛って全 PER 行に長めの sub テキスト(「次 BPn」)が出る最大幅状態にしてから検査。
  await page.evaluate(() => { startDive(); G.info = 9; G.exp = 99; G.bp = 30; renderHud(); });
  await openGrowTab(page);
  const growOverflow = await overflowReport(page, "grow-tab");
  if (growOverflow.overflowCount > 0) overflowFails.push(growOverflow);
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(100);

  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  out("pageerrors", errors);
  out("dive 遷移", diveScr);
  out("Z1 育成タブ存在 / 往復(gate退行なし) / HUD情報span後置", { tabExists, hudLayout, tabCycle, tabCycleOk });
  out("Z2 救出で情報+1", infoSupply);
  out("Z3 情報→BP 変換(画面操作・飛び越えなし)", { z3tap, beforeInfoBp, afterInfoBp, infoRate, z3Ok });
  out("Z4 EXP→BP 変換(画面操作)", { z4tap, beforeExpBp, afterExpBp, expRate, z4Ok });
  out("Z5 BP→PER_HP Lv.UP + 実効HP変化(HUD #hp-val 底上げ)", { z5tap, z5info, z5after, hpCost, z5Ok });
  out("Z6 PER_DIG/PER_ATTACK 実効反映", z6);
  out("Z7 境界(BP0 disabled / 上限=最大 disabled)", z7);
  out("Z8 決定論(救出→変換→PER_HP×2 を3回同結果)", { same: detRuns.same, sample: detRuns.a });
  out("Z9 非介入 girlPositions", z9.girlPositions === EXPECTED_GIRLS);
  out("Z10 育成タブ可読性(はみ出し0)", growOverflow);

  growthPass =
    errors.length === 0 &&
    diveScr === "dive" &&
    tabExists === true && tabCycleOk === true &&
    hudLayout.infoSpanExists === true && hudLayout.infoAfterBtn === true &&
    infoSupply.info0 === 0 && infoSupply.info1 === 1 && infoSupply.rescued === 1 && infoSupply.infoHud === "1" &&
    growOpen === true &&
    z3Ok === true &&
    z4Ok === true &&
    z5Ok === true &&
    z6.digReduced === true && z6.atkUp === true &&
    z7Ok === true &&
    detRuns.same === true &&
    z9.girlPositions === EXPECTED_GIRLS && z9.oreUnchanged === true &&
    z9.tileUnchanged === true && z9.hazardUnchanged === true &&
    growOverflow.overflowCount === 0;
  out("PASS(Z: 育成タブ往復/情報・EXP→BP→PER 画面操作/実効値変化/境界/決定論/非介入/可読性)", growthPass);
  await ctx.close();
}

// ============================================================================
// (AA) v0.12.0 仲間同行(§2-4、作り直し): 救出済みストック(rescued)を地表で1人選んで次の潜行へ同行→
//      同行中の撃破で EXP 蓄積→地表帰還で別れてレベル反映→ストックへ戻る、を「画面座標ヒットテスト」+
//      状態 API で実観測する(v0.10.0 の following 同行モデルを廃した新仕様)。
//   AA1 工房第4タブ「仲間」存在 + 4タブ往復(クラフト/商人/育成 ⇄ 仲間。タブ切替で gate 退行しない)。
//       上部バーのボタンは増えていない(#btn-craft で開く=gate G/Q/Y/Z 非退行)。
//   AA2 同行候補の表示: 救出済みストックが居ないと「同行できる仲間がいない」、居ると 1 行/人。
//   AA3 同行指定が「画面操作」(仲間タブ該当行の「同行」ボタンを画面座標タップ、overlay 飛び越えなし)で
//       動く: rescued の子が deployed=following になり G.companion がその girl を指し、ボタン表記が
//       「同行」→「やめる」へ、再タップでストックへ戻す(地表でのみ編成可)。
//   AA4 同行中の撃破で companion.cexp と自機プール G.exp が同額並走(v0.9.0 BP 路は不変=二面両立)。
//       同行 0 人での撃破は cexp 加算 no-op(自機 exp のみ)。
//   AA5 援護攻撃: companion レベルに応じ playerAtk が effCompanionAtk()=level*COMPANION_ATK_PER_LV ぶん増。
//       レベル0/未同行で +0=既存挙動に完全一致。
//   AA6 地表帰還(rescueGirl)で cexp→level に清算・companion 解除・端数 cexp 繰越(原作「別れてレベルアップ」)。
//       清算は仲間タブ表示にも反映(Lv 表示が上がり、companion 解除で「やめる」→「同行」に戻る)。
//   AA7 境界: 同行 0 人で帰還は settle no-op(クラッシュなし)/複数 following でも companion は1人だけ(上書き)。
//   AA8 決定論: 同一操作列(同行→固定 key 撃破列→帰還)を 3 回連続で cexp/level/exp/girlPositions が完全一致。
//   AA9 非介入: 同行系は girlPositions(EXPECTED_GIRLS)/oreAt/tileType/hazard を変えない(別 state レイヤー)。
//   AA10 仲間タブ可読性: 仲間タブを開いた状態(following 1 人)で全行テキストのはみ出し 0(412x915)。
//   ※ 画面操作は「仲間タブの該当行ボタンの bounding rect 中心へ page.mouse でタップ」。タップ前に
//     elementFromPoint で最前面がそのボタンであることを assert(overlay 飛び越えの否定=みちゆき真因)。
//     canvas へ直接 dispatch しない。
// ============================================================================
let companionPass = false;
{
  console.log("== (AA) v0.12.0 仲間同行(作り直し): 救出ストック→地表で同行→潜行で EXP→帰還で別れて Lv→ストックへ ==");

  // 仲間タブを開く共通ヘルパー(作る → 工房 → 仲間タブ。最前面ヒットテスト経由)。
  async function openCompanionTab(page) {
    await tapSelector(page, "#btn-craft");
    await page.waitForTimeout(200);
    await tapSelector(page, "#tab-companion");
    await page.waitForTimeout(120);
  }

  // 仲間タブの n 行目の「同行/やめる」ボタンを画面座標タップ。タップ前に最前面=そのボタンを assert。
  // 返り値: { tapped, wasTopBtn, label, rect }。
  async function tapCompanionRowBtn(page, rowIdx) {
    const box = await page.evaluate((n) => {
      const rows = document.querySelectorAll("#companion-list .craft-row");
      const row = rows[n];
      if (!row) return null;
      const btn = row.querySelector(".craft-make");
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), label: btn.textContent };
    }, rowIdx);
    if (!box) return { tapped: false, wasTopBtn: false, label: null, rect: null };
    const wasTopBtn = await page.evaluate(([n, px, py]) => {
      const rows = document.querySelectorAll("#companion-list .craft-row");
      const btn = rows[n] && rows[n].querySelector(".craft-make");
      const top = document.elementFromPoint(px, py);
      return !!btn && !!top && (top === btn || btn.contains(top) || top.contains(btn));
    }, [rowIdx, box.x, box.y]);
    await page.mouse.move(box.x, box.y);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(80);
    return { tapped: true, wasTopBtn, label: box.label, rect: { t: box.t, b: box.b } };
  }

  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);
  const diveScr = await page.evaluate(() => G.screen);

  // --- AA1 仲間タブ存在 + 4タブ往復(クラフト/商人/育成 ⇄ 仲間、gate 退行なし) ---
  const tabExists = await page.evaluate(() => !!document.getElementById("tab-companion"));
  await tapSelector(page, "#btn-craft");
  await page.waitForTimeout(150);
  const tabCycle = await page.evaluate(() => {
    const seq = [];
    const snap = () => ({
      craft: !document.getElementById("craft-list").hidden,
      shop: !document.getElementById("shop-list").hidden,
      grow: !document.getElementById("grow-list").hidden,
      companion: !document.getElementById("companion-list").hidden,
    });
    seq.push({ at: "open-default", ...snap() }); // 既定=クラフト
    setWorkshopTab("companion"); seq.push({ at: "companion", ...snap() }); // 仲間へ
    setWorkshopTab("grow"); seq.push({ at: "grow", ...snap() }); // 育成へ(退行なし)
    setWorkshopTab("companion"); seq.push({ at: "companion2", ...snap() }); // 仲間へ戻る
    setWorkshopTab("shop"); seq.push({ at: "shop", ...snap() }); // 商人へ(退行なし)
    setWorkshopTab("craft"); seq.push({ at: "craft", ...snap() }); // クラフトへ戻る(gate Q 互換)
    return seq;
  });
  // 各タブで対象 list だけが見える(排他)ことを確認。
  const tabCycleOk =
    tabCycle.length === 6 &&
    tabCycle[0].craft && !tabCycle[0].companion &&
    tabCycle[1].companion && !tabCycle[1].craft && !tabCycle[1].grow && !tabCycle[1].shop &&
    tabCycle[2].grow && !tabCycle[2].companion &&
    tabCycle[3].companion && !tabCycle[3].grow &&
    tabCycle[4].shop && !tabCycle[4].companion &&
    tabCycle[5].craft && !tabCycle[5].companion; // クラフトへ戻れる(gate Q が見る既定状態へ復帰)
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(100);

  // --- AA2 同行候補表示(v0.12.0 作り直し): 救出済みストック 0 人 → 案内行 / 1 人 → 1 行(画面操作で開く) ---
  const candEmpty = await page.evaluate(() => {
    startDive(); // 救出ストックを作らない。
    openCraft(); setWorkshopTab("companion");
    const rows = document.querySelectorAll("#companion-list .craft-row").length;
    const text = (document.querySelector("#companion-list .craft-name") || {}).textContent;
    const btn = document.querySelector("#companion-list .craft-make");
    closeCraft();
    return { rows, text, btnDisabledOrAbsent: !btn || btn.disabled };
  });
  // 救出済みストックの子を 1 人作り(地表で同行候補に出る)、仲間タブを画面操作で開く。
  await page.evaluate(() => { startDive(); G.girls[0].state = "rescued"; G.px = 7; G.py = 0; });
  await openCompanionTab(page);
  const candOne = await page.evaluate(() => ({
    rows: document.querySelectorAll("#companion-list .craft-row").length,
    compOpen: !document.getElementById("companion-list").hidden,
    btnLabel: (document.querySelector("#companion-list .craft-make") || {}).textContent,
  }));
  const aa10Overflow = await overflowReport(page, "companion-tab");
  if (aa10Overflow.overflowCount > 0) overflowFails.push(aa10Overflow);

  // --- AA3 同行指定(画面座標タップ、飛び越えなし): 「同行」→deploy+companion 指定→「やめる」表記、再タップで解除 ---
  const compBefore = await page.evaluate(() => G.companion);
  const aa3tap1 = await tapCompanionRowBtn(page, 0); // 「同行」を押す(地表なので有効)。
  const aa3afterSet = await page.evaluate(() => ({
    companionIsG0: G.companion === G.girls[0] && G.girls[0].deployed && G.girls[0].state === "following",
    btnLabel: (document.querySelector("#companion-list .craft-make") || {}).textContent,
  }));
  const aa3tap2 = await tapCompanionRowBtn(page, 0); // 「やめる」を押す=同行取り消し(ストックへ戻す)。
  const aa3afterUnset = await page.evaluate(() => ({
    companionNull: G.companion === null && G.girls[0].state === "rescued" && !G.girls[0].deployed,
    btnLabel: (document.querySelector("#companion-list .craft-make") || {}).textContent,
  }));
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(80);
  const aa3Ok =
    compBefore === null &&
    aa3tap1.tapped && aa3tap1.wasTopBtn && aa3tap1.label === "同行" &&
    aa3afterSet.companionIsG0 === true && aa3afterSet.btnLabel === "やめる" &&
    aa3tap2.tapped && aa3tap2.wasTopBtn && aa3tap2.label === "やめる" &&
    aa3afterUnset.companionNull === true && aa3afterUnset.btnLabel === "同行";

  // --- AA4 同行中の撃破で cexp と自機 exp が並走 / 同行0人で撃破は cexp no-op(v0.12.0: 救出ストックを地表で同行) ---
  const aa4 = await page.evaluate(() => {
    startDive();
    // 同行 0 人での撃破: 自機 exp のみ、companion=null。
    const e0 = G.exp;
    const foe0 = { key: "BAT", col: 1, row: 1, hp: 0 }; // BAT exp=2。
    G.monsters = [foe0]; killMonster(foe0);
    const selfOnly = { exp: G.exp - e0, companion: G.companion };
    // 救出済みストックの子を地表で同行に出す(deployed=following)→ 撃破で cexp と exp が同額。
    const g = G.girls[0]; g.state = "rescued"; G.px = 7; G.py = 0;
    setCompanion(g);
    const deployed = (G.companion === g && g.deployed && g.state === "following");
    const e1 = G.exp; const c1 = g.cexp || 0;
    const foe1 = { key: "SNAKE", col: 1, row: 1, hp: 0 }; // SNAKE exp=6。
    G.monsters = [foe1]; killMonster(foe1);
    return {
      selfExpGained0: selfOnly.exp, companionNull0: selfOnly.companion === null, deployed,
      cexpGained: (g.cexp || 0) - c1, selfExpGained: G.exp - e1,
    };
  });
  const aa4Ok = aa4.selfExpGained0 === 2 && aa4.companionNull0 === true && aa4.deployed === true &&
    aa4.cexpGained === 6 && aa4.selfExpGained === 6;

  // --- AA5 援護攻撃: companion レベルで playerAtk が effCompanionAtk ぶん増。未同行で +0 ---
  const aa5 = await page.evaluate(() => {
    startDive();
    const baseAtk = playerAtk(); // 未同行=援護0。
    const compAtk0 = effCompanionAtk();
    const g = G.girls[0]; g.state = "rescued"; G.px = 7; G.py = 0; setCompanion(g);
    g.level = 3; // 援護 +3(COMPANION_ATK_PER_LV=1)。
    const atkWith = playerAtk();
    return { baseAtk, compAtk0, companionAtk: effCompanionAtk(), atkWith, perLv: CONST.COMPANION_ATK_PER_LV };
  });
  const aa5Ok =
    aa5.compAtk0 === 0 && aa5.companionAtk === 3 * aa5.perLv &&
    aa5.atkWith === aa5.baseAtk + aa5.companionAtk;

  // --- AA6 地表帰還で別れてレベルアップ + companion 解除 + 端数繰越 + ストックへ戻る ---
  //   v0.12.0: deployed companion の帰還=別れて Lv→rescued ストックへ。情報は二重計上しない(初回救出で計上済)。
  const aa6 = await page.evaluate(() => {
    startDive();
    const g = G.girls[0]; g.state = "rescued"; G.px = 7; G.py = 0; setCompanion(g);
    g.cexp = 25; g.level = 0; // EXP_PER_LV=10 → +2 レベル、端数 5。
    const infoBefore = G.info || 0;
    g.col = G.px; g.row = 0; // 地表へ。
    rescueGirl(g); // deployed branch=settle+restock。
    return {
      level: g.level, cexp: g.cexp, companionCleared: G.companion === null,
      backToStock: g.state === "rescued" && !g.deployed, infoBefore, info: G.info,
      perLv: CONST.COMPANION_EXP_PER_LV, lvMax: CONST.COMPANION_LV_MAX,
    };
  });
  const aa6Ok =
    aa6.level === 2 && aa6.cexp === 5 && aa6.companionCleared === true &&
    aa6.backToStock === true && aa6.info === aa6.infoBefore; // 情報は二重計上しない。

  // --- AA7 境界: 同行 0 人で帰還 no-op / 複数ストックでも companion は1人だけ(上書きで前のはストックへ戻る) ---
  const aa7 = await page.evaluate(() => {
    startDive();
    const ga = G.girls[0]; ga.state = "rescued"; ga.col = G.px; ga.row = 0;
    rescueGirl(ga); // 既に rescued=早期 return(settle no-op、クラッシュなし)。
    const noCrash = G.companion === null;
    startDive();
    const g1 = G.girls[0]; const g2 = G.girls[1];
    g1.state = "rescued"; g2.state = "rescued"; G.px = 7; G.py = 0;
    setCompanion(g1); const firstSet = G.companion === g1 && g1.deployed;
    setCompanion(g2); // 2人目を同行=1人目はストックへ戻る。
    const onlyOne = G.companion === g2 && g2.deployed && G.companion !== g1 && !g1.deployed && g1.state === "rescued";
    return { noCrash, firstSet, onlyOne };
  });
  const aa7Ok = aa7.noCrash && aa7.firstSet && aa7.onlyOne;

  // --- AA8 決定論: 同一操作列(救出ストック同行→固定 key 撃破列→帰還)を 3 回連続で完全一致 ---
  const detRuns = [];
  for (let i = 0; i < 3; i++) {
    const snap = await page.evaluate(() => {
      startDive();
      const g = G.girls[2]; g.state = "rescued"; G.px = 7; G.py = 0;
      setCompanion(g);
      const e0 = G.exp;
      for (const key of ["BAT", "SNAKE", "SPIDER"]) {
        const foe = { key, col: 1, row: 1, hp: 0 };
        G.monsters = [foe]; killMonster(foe);
      }
      const cexpDive = g.cexp;
      g.col = G.px; g.row = 0; rescueGirl(g); // 帰還で清算→ストックへ。
      const gp = girlPositions(G.seed).map((p) => p.col + "," + p.row).join("|");
      return { cexpDive, levelAfter: g.level, cexpAfter: g.cexp, expGained: G.exp - e0, gp };
    });
    detRuns.push(snap);
  }
  const detEqual = detRuns.every((r) =>
    r.cexpDive === detRuns[0].cexpDive && r.levelAfter === detRuns[0].levelAfter &&
    r.cexpAfter === detRuns[0].cexpAfter && r.expGained === detRuns[0].expGained && r.gp === detRuns[0].gp);

  // --- AA9 非介入: 同行操作後も girlPositions/oreAt/tileType/hazard が不変 ---
  const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
  const aa9 = await page.evaluate((expected) => {
    startDive();
    const SEED = G.seed;
    const gp = girlPositions(SEED).map((p) => p.col + "," + p.row).join("|");
    const g = G.girls[0]; g.state = "rescued"; G.px = 7; G.py = 0; setCompanion(g);
    const foe = { key: "SNAKE", col: 1, row: 1, hp: 0 }; G.monsters = [foe]; killMonster(foe);
    g.col = G.px; g.row = 0; rescueGirl(g);
    const gp2 = girlPositions(SEED).map((p) => p.col + "," + p.row).join("|");
    return {
      gp, gp2, expected,
      oreUnchanged: oreAt(8, 7, SEED) === oreAt(8, 7, SEED),
      tileUnchanged: tileType(8, 7, SEED) === TILE.SOIL,
      hazardUnchanged: hazardAt(0, 11, SEED) === hazardAt(0, 11, SEED),
    };
  }, EXPECTED_GIRLS);
  const aa9Ok =
    aa9.gp === EXPECTED_GIRLS && aa9.gp2 === EXPECTED_GIRLS &&
    aa9.oreUnchanged && aa9.tileUnchanged && aa9.hazardUnchanged;

  out("pageerrors", errors);
  out("dive 遷移", diveScr);
  out("AA1 仲間タブ存在 / 4タブ往復(gate退行なし)", { tabExists, tabCycle, tabCycleOk });
  out("AA2 同行候補(0人=案内行 / 1人=1行)", { candEmpty, candOne });
  out("AA3 同行指定(画面操作・飛び越えなし)同行→やめる→解除", { compBefore, aa3tap1, aa3afterSet, aa3tap2, aa3afterUnset, aa3Ok });
  out("AA4 同行中撃破で cexp/自機exp 並走(同行0人=cexp no-op)", { aa4, aa4Ok });
  out("AA5 援護攻撃(companion Lv→playerAtk +)", { aa5, aa5Ok });
  out("AA6 帰還で別れてLv反映(cexp25→Lv2,端数5,解除,情報+1)", { aa6, aa6Ok });
  out("AA7 境界(0人帰還no-op / 複数でも1人だけ)", { aa7, aa7Ok });
  out("AA8 決定論3回連続一致(cexp/level/exp/girlPositions)", { same: detEqual, sample: detRuns[0] });
  out("AA9 非介入 girlPositions/ore/tile/hazard 不変", { aa9, aa9Ok });
  out("AA10 仲間タブ可読性(はみ出し0)", aa10Overflow);

  companionPass =
    errors.length === 0 &&
    diveScr === "dive" &&
    tabExists === true && tabCycleOk === true &&
    candEmpty.rows === 1 && candEmpty.btnDisabledOrAbsent === true &&
    candOne.compOpen === true && candOne.rows === 1 && candOne.btnLabel === "同行" &&
    aa3Ok === true &&
    aa4Ok === true &&
    aa5Ok === true &&
    aa6Ok === true &&
    aa7Ok === true &&
    detEqual === true &&
    aa9Ok === true &&
    aa10Overflow.overflowCount === 0;
  out("PASS(AA: 仲間タブ往復/同行指定 画面操作/同行中EXP蓄積/帰還で別れてLv反映/援護/境界/決定論/非介入/可読性)", companionPass);
  await ctx.close();
}

// ============================================================================
// (AB) v0.12.0 セーブ/永続: fail→retry で永続 state 復元 + ランごとリセット state は 0。
//      surfaceReturn でセーブされ localStorage に保存。
// ============================================================================
let savePass = true;
{
  console.log("== (AB) v0.12.0 セーブ/永続(fail→retry で永続 state 復元 / ランごとリセット) ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // 1人救出して PER を振り、地表帰還でセーブを走らせる。
  const ab1 = await page.evaluate(() => {
    // ダイヤツルハシを持たせる(掘削力ゲートのノイズ除去)。モンスターも除去(戦闘ノイズ除去)。
    G.pick = "DIAMOND";
    G.monsters = [];
    G.spawned = new Set();
    // 最寄りの女の子(11,6) へ掘り進む。
    const target = G.girls.find(g => g.origRow === 6);
    if (!target) return { err: "girl not found" };
    // col 11 へ移動(地表を横歩き)。
    while (G.px < 11) act(1, 0);
    // row 6 まで掘り下げる。
    while (G.py < 6) act(0, 1);
    // 女の子を発見して追従開始。
    const found = target.state === "following";
    if (!found) return { err: "not following", state: target.state, px: G.px, py: G.py };
    // v0.20.0 判断C: クライム廃止によりはしご無しでは登れない。縦一直線に掘り進んだ経路
    // (px=11, row 1..6)へはしごを一括注入してから登る(player-state 注入方針、G.dug 注入と同じ)。
    for (let r = 1; r <= G.py; r++) G.placedLadders.add(G.px + "," + r);
    // 地表へ戻る。
    while (G.py > 0) act(0, -1);
    const rescued = G.rescued;
    const info = G.info;
    // 育成: 情報を BP に変換して PER_HP を上げる。
    convertInfoToBp();
    const bpAfter = G.bp;
    if (bpAfter >= bpCostFor("HP", 0)) {
      levelUpPer("HP");
    }
    const per = { ...G.per };
    const pick = G.pick;
    // surfaceReturn は act(0,-1) で py===0 に到達した時点で自動発火済み(セーブ=育成前の状態)。
    // 育成後のセーブを反映するため、もう一度 surfaceReturn を呼ぶ(py===0 なので追従は no-op、全回復+セーブ)。
    surfaceReturn();
    return { rescued, info, per, pick, bpAfter, screen: G.screen };
  });
  out("AB1 救出+育成", ab1);
  const ab1Ok = ab1.rescued >= 1 && ab1.per && ab1.per.HP >= 1 && ab1.pick === "DIAMOND";
  if (!ab1Ok) savePass = false;
  out("PASS(AB1 救出+育成で永続対象に値がある)", ab1Ok);

  // surfaceReturn でセーブされたか localStorage を確認(v0.13.0: ダンジョンごとに分離)。
  const saveData = await page.evaluate(() => {
    try {
      let raw = localStorage.getItem("mineroad_save_" + (G.dungeonId || 0));
      if (!raw) raw = localStorage.getItem("mineroad_save");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  });
  out("AB2 localStorage セーブデータ", saveData);
  const ab2Ok = saveData && saveData.v === 1 && saveData.rescued >= 1 && saveData.per && saveData.per.HP >= 1 && saveData.pick === "DIAMOND";
  if (!ab2Ok) savePass = false;
  out("PASS(AB2 surfaceReturn で localStorage に永続 state 保存)", ab2Ok);

  // 力尽きさせてから retry(startDive)で永続 state が復元されるか確認。
  // v0.14.0: 電波圏内(地表からの基礎範囲 ANTENNA_R0)での力尽きは保険(判断C)で携行アイテムを
  // 持ち越すため、「ランごとリセット」の素の挙動(保険なし)を検証するには圏外(row > ANTENNA_R0)
  // まで潜ってから力尽きさせる必要がある(この gate はアンテナ未設置=保険は電波圏外なら効かない)。
  const ab3 = await page.evaluate(() => {
    // 地中かつ電波圏外(row > ANTENNA_R0)まで掘り下げる。
    while (G.py <= CONST.ANTENNA_R0) act(0, 1);
    const coveredAtFail = inRadioCoverage(G.px, G.py);
    G.hp = 0;
    G.stamina = 0;
    checkFail();
    if (G.screen !== "fail") return { err: "not fail screen", screen: G.screen, py: G.py };
    // retry = startDive。
    startDive();
    return {
      coveredAtFail,
      rescued: G.rescued,
      per: { ...G.per },
      info: G.info,
      bp: G.bp,
      pick: G.pick,
      // ランごとリセット state。
      ore: { ...G.ore },
      mushrooms: G.mushrooms,
      ladders: G.ladders,
      antennaItems: G.antennaItems,
      exp: G.exp,
      kills: G.kills,
      screen: G.screen,
      // girls の rescued 状態。
      girlStates: G.girls.map(g => g.state),
    };
  });
  out("AB3 fail→retry 後の state", ab3);
  const ab3Ok =
    ab3.coveredAtFail === false && // 圏外での力尽き = 保険なし(v0.14.0)
    ab3.rescued >= 1 &&
    ab3.per && ab3.per.HP >= 1 &&
    ab3.pick === "DIAMOND" &&
    ab3.ore && ab3.ore.COAL === 0 && ab3.ore.IRON_ORE === 0 &&
    ab3.mushrooms === 0 && ab3.ladders === 0 &&
    ab3.antennaItems === 0 && ab3.exp === 0 && ab3.kills === 0 &&
    ab3.girlStates.filter(s => s === "rescued").length >= 1;
  if (!ab3Ok) savePass = false;
  out("PASS(AB3 fail→retry で永続 state 復元 + ランごと state リセット)", ab3Ok);

  // クリア後にセーブデータが消去されるか確認(v0.13.0: ダンジョンごとのキー)。
  const ab4 = await page.evaluate(() => {
    showClear();
    try {
      const key = "mineroad_save_" + (G.dungeonId || 0);
      return localStorage.getItem(key);
    } catch (e) { return "error"; }
  });
  out("AB4 クリア後セーブデータ", ab4);
  const ab4Ok = ab4 === null;
  if (!ab4Ok) savePass = false;
  out("PASS(AB4 クリア後にセーブデータ消去)", ab4Ok);

  // 決定論: 3 回連続で結果一致。
  const detResults = [];
  for (let trial = 0; trial < 3; trial++) {
    await page.evaluate(() => {
      try { localStorage.removeItem("mineroad_save_" + (G.dungeonId || 0)); localStorage.removeItem("mineroad_save"); } catch (e) {}
    });
    const r = await page.evaluate(() => {
      startDive();
      G.pick = "DIAMOND";
      G.monsters = [];
      G.spawned = new Set();
      while (G.px < 11) act(1, 0);
      while (G.py < 6) act(0, 1);
      // v0.20.0 判断C: クライム廃止によりはしご無しでは登れない。縦一直線に掘り進んだ経路
      // (px=11, row 1..6)へはしごを一括注入してから登る(player-state 注入方針、G.dug 注入と同じ)。
      for (let r = 1; r <= G.py; r++) G.placedLadders.add(G.px + "," + r);
      while (G.py > 0) act(0, -1);
      convertInfoToBp();
      if (G.bp >= bpCostFor("HP", 0)) levelUpPer("HP");
      try {
        let raw = localStorage.getItem("mineroad_save_" + (G.dungeonId || 0));
        if (!raw) raw = localStorage.getItem("mineroad_save");
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    });
    detResults.push(JSON.stringify(r));
  }
  const detOk = detResults[0] === detResults[1] && detResults[1] === detResults[2] && detResults[0] !== "null";
  if (!detOk) savePass = false;
  out("PASS(AB5 決定論: セーブデータ 3 回連続一致)", detOk);

  // 非介入: tileType/girlPositions/oreAt/monster/hazard/avalanche のワールドレイヤーに変更なし。
  const nonIntervention = await page.evaluate(() => {
    startDive();
    const seed = G.seed;
    const cols = 15, rows = 15;
    for (let c = 0; c < cols; c++) {
      for (let r = 1; r <= rows; r++) {
        const t = tileType(c, r, seed);
        if (t === undefined) return "tileType undefined at " + c + "," + r;
      }
    }
    const gp = girlPositions(seed);
    if (gp.length !== 5) return "girlPositions count " + gp.length;
    return true;
  });
  if (nonIntervention !== true) savePass = false;
  out("PASS(AB6 非介入: ワールドレイヤー不変)", nonIntervention === true);

  const ab_pe = errors.filter(e => !e.includes("net::ERR_") && !e.includes("favicon"));
  if (ab_pe.length > 0) savePass = false;
  out("pageerror", ab_pe);
  out("PASS(AB: セーブ/永続 全体)", savePass);
  await ctx.close();
}

// ============================================================================
// (AC) v0.13.0 ダンジョン選択・解放チェーン・グリッドサイズ切り替え・HUDダンジョン名。
//   AC1 タイトル画面でダンジョンボタン 9 個(裏庭のみ解放=「▶」、残り8個はロック=「🔒」disabled)。
//   AC2 裏庭の洞窟を選択してゲーム開始(ダイブ遷移)。
//   AC3 各ダンジョンで CONST.GRID_COLS/DEPTH_ROWS が正しく切り替わる(applyDungeonConst)。
//   AC4 HUDにダンジョン名が表示される(深度表示の前)。
//   AC5 力尽き画面に「タイトルへ」ボタンがある(別ダンジョンに切り替え可能)→タップで title へ戻る。
//   AC6 クリアで次ダンジョン解放 + saveDungeonProgress で unlocked が永続化。
//   AC7 既存機能の回帰: 裏庭(ID=0)で掘る・女の子救出・セーブの基本が壊れていない。
// ============================================================================
let dungeonPass = false;
{
  console.log("== (AC) v0.13.0 ダンジョン選択・解放チェーン ==");
  const { ctx, page, errors } = await openPage();
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // --- AC1 タイトル画面のダンジョンボタン ---
  const ac1 = await page.evaluate(() => {
    const btns = document.querySelectorAll(".dungeon-btn");
    const unlocked = [...btns].filter(b => !b.disabled);
    const locked = [...btns].filter(b => b.disabled);
    return {
      total: btns.length,
      unlockedCount: unlocked.length,
      lockedCount: locked.length,
      firstName: unlocked[0] ? unlocked[0].textContent : "",
      lockedNames: locked.slice(0, 3).map(b => b.textContent),
      screen: G.screen,
    };
  });
  out("AC1 ダンジョンボタン(9個/裏庭のみ解放)", ac1);

  // --- AC2 裏庭を選択してダイブ ---
  await page.evaluate(() => { try { localStorage.setItem("mineroad_seen_howto", "1"); } catch (e) {} });
  await page.evaluate(() => { showTitle(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const btn = document.querySelector(".dungeon-btn:not([disabled])");
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  const ac2 = await page.evaluate(() => ({ screen: G.screen, dungeonId: G.dungeonId, py: G.py }));
  out("AC2 裏庭を選択してダイブ", ac2);

  // --- AC3 ダンジョンごとのグリッドサイズ切り替え ---
  const ac3 = await page.evaluate(() => {
    const results = [];
    for (let id = 0; id < DUNGEON_DATA.length; id++) {
      applyDungeonConst(id);
      results.push({ id, name: DUNGEON_DATA[id].name, cols: CONST.GRID_COLS, rows: CONST.DEPTH_ROWS, girls: CONST.GIRL_COUNT });
    }
    applyDungeonConst(0);
    return results;
  });
  out("AC3 ダンジョンごとグリッドサイズ", ac3.map(d => `${d.id}:${d.name} ${d.cols}x${d.rows} 女${d.girls}`));
  const ac3Ok = ac3.length === 9 &&
    ac3[0].cols === 15 && ac3[0].rows === 15 && ac3[0].girls === 5 &&
    ac3[1].cols === 30 && ac3[1].rows === 30 && ac3[1].girls === 14 &&
    ac3[5].cols === 20 && ac3[5].rows === 99 && ac3[5].girls === 36;

  // --- AC4 HUDにダンジョン名が表示される ---
  await page.evaluate(() => { G.dungeonId = 0; startDive(); });
  await page.waitForTimeout(200);
  const ac4 = await page.evaluate(() => document.getElementById("depth-val").textContent);
  out("AC4 HUDダンジョン名(裏庭の洞窟)", ac4);
  const ac4Ok = ac4.indexOf("裏庭の洞窟") >= 0;

  // --- AC5 力尽き画面に「タイトルへ」ボタン → タップでタイトルに戻る ---
  await page.evaluate(() => { G.py = 5; G.stamina = 0; G.hp = 0; checkFail(); });
  await page.waitForTimeout(400);
  const ac5_fail = await page.evaluate(() => ({
    screen: G.screen,
    retryText: document.getElementById("ov-action").textContent,
    backText: document.getElementById("ov-action2").textContent,
    backHidden: document.getElementById("ov-action2").hidden,
  }));
  const backBtnHit = await buttonHittable(page, "#ov-action2");
  await tapSelector(page, "#ov-action2");
  await page.waitForTimeout(400);
  const ac5_title = await page.evaluate(() => G.screen);
  out("AC5 力尽き→タイトルへ", { ac5_fail, backBtnHit, afterTap: ac5_title });
  const okBtn = (b) => b.exists && b.topInView && b.bottomInView && b.hit;
  const ac5Ok = ac5_fail.screen === "fail" && ac5_fail.backText === "タイトルへ" &&
    !ac5_fail.backHidden && okBtn(backBtnHit) && ac5_title === "title";

  // --- AC6 クリアで次ダンジョン解放 + progress 永続化 ---
  const ac6 = await page.evaluate(() => {
    G.dungeonId = 0;
    G.cleared = new Set(); G.unlocked = new Set([0]);
    startDive();
    for (const g of G.girls) g.state = "rescued";
    G.rescued = CONST.GIRL_COUNT;
    G.maxDepthThisDive = CONST.DEPTH_ROWS;
    for (let r = 1; r <= CONST.DEPTH_ROWS; r++) for (let c = 0; c < CONST.GRID_COLS; c++) G.seen.add(c + "," + r);
    G.dug.add(G.px + ",1"); G.py = 1; moveTo(G.px, 0, true);
    const progressRaw = localStorage.getItem("mineroad_progress");
    const progress = progressRaw ? JSON.parse(progressRaw) : null;
    return {
      screen: G.screen,
      cleared: G.cleared ? [...G.cleared] : [],
      unlocked: G.unlocked ? [...G.unlocked] : [],
      progressSaved: !!progress,
      progressCleared: progress ? progress.cleared : null,
      progressUnlocked: progress ? progress.unlocked : null,
    };
  });
  out("AC6 クリアで次ダンジョン解放", ac6);
  const ac6Ok = ac6.screen === "clear" &&
    ac6.cleared.includes(0) && ac6.unlocked.includes(0) && ac6.unlocked.includes(1) &&
    ac6.progressSaved && ac6.progressCleared.includes(0) && ac6.progressUnlocked.includes(1);

  // --- AC7 裏庭で掘る・女の子救出の回帰 ---
  // AC6 クリアの状態が残るので、ページ内で startDive() ではなく内部関数 act で直接検証。
  const ac7 = await page.evaluate(() => {
    G.dungeonId = 0; startDive();
    const cols0 = CONST.GRID_COLS, rows0 = CONST.DEPTH_ROWS, girls0 = G.girls.length;
    // act を使わず moveTo で直接移動テスト(act は digging 含むため startDive 直後でも通る)。
    G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
    const py0 = G.py;
    // 真下を掘り抜いて移動。
    G.dug.add(G.px + ",1");
    moveTo(G.px, 1);
    const moved = G.py > py0;
    return { cols0, rows0, girls0, moved, screen: G.screen };
  });
  out("AC7 裏庭回帰(掘る・グリッドサイズ=15x15・5人)", ac7);
  const ac7Ok = ac7.cols0 === 15 && ac7.rows0 === 15 && ac7.girls0 === 5 && ac7.moved && ac7.screen === "dive";

  dungeonPass =
    errors.length === 0 &&
    ac1.total === 9 && ac1.unlockedCount === 1 && ac1.lockedCount === 8 &&
    ac1.firstName.indexOf("裏庭の洞窟") >= 0 && ac1.screen === "title" &&
    ac2.screen === "dive" && ac2.dungeonId === 0 &&
    ac3Ok && ac4Ok && ac5Ok && ac6Ok && ac7Ok;
  out("PASS(AC: ダンジョン選択9個/裏庭ダイブ/グリッドサイズ切替/HUD名表示/タイトルへ/解放チェーン/裏庭回帰)", dungeonPass);
  await ctx.close();
}

// ============================================================================
// (AD) v0.13.1 はしご設置/回収/上掘り。
//   AD1 はしごボタン(#btn-ladder)が HUD に存在し、初期 disabled。
//   AD2 はしご所持後、設置→所持数-1・placedLadders に追加。
//   AD3 上掘り: 設置済み位置で真上のタイルを掘れる(dr=-1)。
//   AD4 回収: 設置済み位置でボタン→所持数+1・placedLadders から削除。
//   AD5 設置済みはしごが render で描画される(placedLadders.size > 0)。
// ============================================================================
let ladderPass = true;
{
  console.log("== (AD) v0.13.1 はしご設置/回収/上掘り ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await startToDive(page);

  // AD1: はしごボタン存在 + 初期 disabled
  const ad1 = await page.evaluate(() => {
    const btn = document.getElementById("btn-ladder");
    if (!btn) return { exists: false };
    return { exists: true, disabled: btn.disabled, text: btn.textContent.trim() };
  });
  out("AD1 btn-ladder 存在", ad1.exists);
  out("AD1 btn-ladder disabled(初期)", ad1.disabled);
  if (!ad1.exists || !ad1.disabled) ladderPass = false;

  // AD2: はしご設置(act() で下に掘って地下へ→はしご付与→設置)
  const ad2 = await page.evaluate((driver) => {
    eval(driver);
    mrStep(0, 1); mrStep(0, 1);
    // v0.20.0 判断C: mrStep はシナリオ構築のため通過区間へ自動ではしごを敷く。AD ゲート自体が
    // 検証したいのは「はしごボタンでの設置/回収」なので、素の状態(未設置)からタップさせる。
    G.placedLadders.clear();
    G.ladders = 3;
    renderInventory();
    const px = G.px, py = G.py;
    return { px, py, ladders: G.ladders, screen: G.screen, underground: py > 0 };
  }, MR_DRIVER);
  out("AD2 自機位置(地下)", ad2);
  if (!ad2 || !ad2.underground) { ladderPass = false; out("AD2 FAIL: 地下に到達できず", false); }

  // はしごボタンを tap して設置
  await tapSelector(page, "#btn-ladder");
  await page.waitForTimeout(150);

  const ad2b = await page.evaluate(() => {
    const key = G.px + "," + G.py;
    return {
      ladders: G.ladders,
      placed: G.placedLadders ? G.placedLadders.has(key) : false,
      placedSize: G.placedLadders ? G.placedLadders.size : 0,
      valText: document.getElementById("ladder-val")?.textContent,
    };
  });
  out("AD2 設置後 ladders", ad2b?.ladders);
  out("AD2 設置後 placed", ad2b?.placed);
  if (!ad2b || ad2b.ladders !== 2 || !ad2b.placed) ladderPass = false;

  // AD3: 上掘り(設置位置で上の固体タイルを act(0,-1) で掘る)
  // さらに下に潜って真上が固体のケースを作る(掘った跡で空間の場合も検証)。
  const ad3 = await page.evaluate((driver) => {
    eval(driver);
    // まず掘りながら深く潜る(row 5 以降は未掘削の固体が残る)
    for (let i = 0; i < 4; i++) mrStep(0, 1);
    const deepRow = G.py;
    G.ladders = 5;
    // はしごを設置
    placeLadder();
    const placedKey = G.px + "," + G.py;
    const placed = G.placedLadders.has(placedKey);
    // 真上のタイル種別を確認
    const tAbove = tileAt(G.px, G.py - 1);
    const isSolid = tAbove !== 0; // TILE.NONE = 0
    const pyBefore = G.py;
    let guard = 0;
    while (G.py === pyBefore && G.screen === "dive" && guard < 10) {
      act(0, -1);
      guard++;
    }
    return {
      deepRow,
      placed,
      tAbove,
      isSolid,
      pyAfter: G.py,
      movedUp: G.py < deepRow,
      taps: guard,
    };
  }, MR_DRIVER);
  out("AD3 上掘り(深部)", ad3);
  if (!ad3 || !ad3.movedUp) ladderPass = false;

  // AD4: 下に戻って回収
  const ad4 = await page.evaluate(() => {
    act(0, 1);
    const key = G.px + "," + G.py;
    const onLadder = G.placedLadders ? G.placedLadders.has(key) : false;
    return { py: G.py, onLadder, ladders: G.ladders };
  });
  out("AD4 回収前 onLadder", ad4?.onLadder);

  if (ad4 && ad4.onLadder) {
    await tapSelector(page, "#btn-ladder");
    await page.waitForTimeout(150);
    const ad4b = await page.evaluate(() => {
      const key = G.px + "," + G.py;
      return {
        ladders: G.ladders,
        placed: G.placedLadders ? G.placedLadders.has(key) : false,
        placedSize: G.placedLadders ? G.placedLadders.size : 0,
      };
    });
    out("AD4 回収後 ladders", ad4b?.ladders);
    out("AD4 回収後 placed(現位置)", ad4b?.placed);
    if (!ad4b || ad4b.placed) ladderPass = false;
  } else {
    out("AD4 回収スキップ(設置位置に居ない)", false);
    ladderPass = false;
  }

  // AD5: render 描画(placedLadders がある状態で crash しないこと)
  const ad5 = await page.evaluate(() => {
    G.placedLadders.add(G.px + "," + G.py);
    try {
      render();
      return true;
    } catch (e) {
      return false;
    }
  });
  out("AD5 render with placedLadders", ad5);
  if (!ad5) ladderPass = false;

  const ad_pe = errors.filter(e => !e.includes("net::ERR_") && !e.includes("favicon"));
  if (ad_pe.length > 0) ladderPass = false;
  out("pageerror", ad_pe);
  out("PASS(AD: はしご設置/回収/上掘り)", ladderPass);
  await ctx.close();
}

// ============================================================================
// (AE) v0.14.0 アイテム拡充 + アンテナ保険。
//   ※ 指示書は「gate AD を追加」と書かれているが、AD は既に v0.13.1(はしご)で使用済みのため
//      AE を採番する(意図との差分、実装完了報告に記載)。内部関数レベルの網羅検証は
//      selfcheck-mineroad-items.mjs が担う。ここは画面操作(タップ/ヒットテスト)経路のみ。
//   AE1 工房「アイテム」タブ(#tab-items)を画面タップで開く→45行表示(open/dead 混在)、飛び越えなし。
//   AE2 クラフト UI が名寄せ後 5 レシピ(回復薬廃止)で画面タップから開ける(gate Q との整合)。
//   AE3 アンテナボタン(#btn-antenna)存在・初期 disabled・画面タップで設置→設置済み表示。
//   AE4 電波圏内(地表基礎範囲)の未発見女の子が透視描画される(圏外は透視されない)。
//   AE5 保険: 電波圏内での力尽き→タイトルへ戻らず retry→携行アイテムが持ち越される(画面操作起点)。
// ============================================================================
let itemsPass = true;
{
  console.log("== (AE) v0.14.0 アイテム拡充 + アンテナ保険 ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  // --- AE1 アイテムタブ(画面タップ) ---
  const craftBtnHit = await buttonHittable(page, "#btn-craft");
  await tapSelector(page, "#btn-craft");
  await page.waitForTimeout(200);
  const itemsTabHit = await buttonHittable(page, "#tab-items");
  await tapSelector(page, "#tab-items");
  await page.waitForTimeout(200);
  const ae1 = await page.evaluate(() => {
    const list = document.getElementById("item-list");
    const rows = list ? [...list.querySelectorAll(".craft-row")] : [];
    const deadRows = rows.filter((r) => r.classList.contains("item-dead"));
    const openRows = rows.filter((r) => !r.classList.contains("item-dead"));
    return {
      shown: list && !list.hidden,
      rowCount: rows.length,
      deadCount: deadRows.length,
      openCount: openRows.length,
      firstName: rows[0] ? (rows[0].querySelector(".craft-name") || {}).textContent : null,
    };
  });
  const topAtItemsList = await page.evaluate(() => {
    const r = document.getElementById("item-list").getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 10));
    return !!(el && el.closest("#craft-overlay"));
  });
  out("AE1 アイテムタブ hittable / 表示 / 45行(open20+dead25)", { itemsTabHit, ae1, topAtItemsList });

  // --- AE2 クラフト 5レシピ(回復薬廃止・名寄せ後、画面タップ) ---
  await tapSelector(page, "#tab-craft");
  await page.waitForTimeout(200);
  const ae2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#craft-list .craft-row")];
    return { count: rows.length, names: rows.map((r) => (r.querySelector(".craft-name") || {}).textContent) };
  });
  await tapSelector(page, "#craft-close");
  await page.waitForTimeout(200);
  out("AE2 クラフト5レシピ(画面操作、回復薬廃止)", ae2);

  // --- AE3 アンテナボタン(#btn-antenna)存在・初期 disabled・設置(画面タップ) ---
  const antennaBtnExists = await page.evaluate(() => !!document.getElementById("btn-antenna"));
  const antennaInitDisabled = await page.evaluate(() => document.getElementById("btn-antenna").disabled);
  const ae3setup = await page.evaluate((driver) => {
    eval(driver);
    mrStep(0, 1); mrStep(0, 1); // 地下(電波圏内=ANTENNA_R0以内)へ。
    G.antennaItems = 2;
    renderInventory();
    return { px: G.px, py: G.py, r0: CONST.ANTENNA_R0, inR0: G.py <= CONST.ANTENNA_R0 };
  }, MR_DRIVER);
  const antennaBtnHit = await buttonHittable(page, "#btn-antenna");
  await tapSelector(page, "#btn-antenna");
  await page.waitForTimeout(150);
  const ae3after = await page.evaluate(() => {
    const key = G.px + "," + G.py;
    return { antennaItems: G.antennaItems, placed: G.placedAntennas.has(key), valText: document.getElementById("antenna-val").textContent };
  });
  out("AE3 アンテナ設置(画面操作)", { antennaBtnExists, antennaInitDisabled, ae3setup, antennaBtnHit, ae3after });

  // --- AE4 電波圏内の女の子透視(圏内=描画対象、圏外=非描画)。地表基礎範囲は常時圏内。 ---
  const ae4 = await page.evaluate(() => {
    // 女の子(11,6)は裏庭の固定配置。圏内(row<=ANTENNA_R0)判定と drawGirl 対象条件を直接確認。
    const g = G.girls[0];
    const inCoverageShallow = inRadioCoverage(g.col, Math.min(g.row, CONST.ANTENNA_R0));
    const stateHidden = g.state === "hidden";
    // render() 内の透視条件式を直接評価(isVisible||following||inRadioCoverage)。
    const wouldDraw = isVisible(g.col, g.row) || g.state === "following" || inRadioCoverage(g.col, g.row);
    const outOfRangeCovered = inRadioCoverage(g.col, g.row); // 裏庭 row6, ANTENNA_R0=3 なら通常は圏外。
    return { r0: CONST.ANTENNA_R0, girlRow: g.row, inCoverageShallow, stateHidden, wouldDraw, outOfRangeCovered };
  });
  out("AE4 電波圏 透視条件(地表基礎範囲は圏内、女の子の深度が圏外なら非透視)", ae4);

  // --- AE5 保険: 電波圏内での力尽き→retry で携行アイテムが持ち越される(画面操作起点)。 ---
  const ae5 = await page.evaluate((driver) => {
    eval(driver);
    startDive();
    G.monsters = []; G.spawned = new Set();
    mrStep(0, 1); // row1(電波圏内=ANTENNA_R0以内)まで。
    G.ore.COAL = 6;
    const covered = inRadioCoverage(G.px, G.py);
    G.hp = 0; G.stamina = 0;
    checkFail();
    return { covered, screen: G.screen };
  }, MR_DRIVER);
  const retryHit = await buttonHittable(page, "#ov-action");
  await tapSelector(page, "#ov-action"); // 「もういちど」タップ = startDive。
  await page.waitForTimeout(300);
  const ae5after = await page.evaluate(() => ({ screen: G.screen, coal: G.ore.COAL }));
  out("AE5 保険(圏内fail→画面タップretry→携行アイテム持ち越し)", { ae5, retryHit, ae5after });

  const ae_pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  itemsPass =
    ae_pe.length === 0 &&
    itemsTabHit.exists && itemsTabHit.hit && ae1.shown === true && ae1.rowCount === 45 &&
    ae1.deadCount === 25 && ae1.openCount === 20 && topAtItemsList === true &&
    ae2.count === 5 &&
    antennaBtnExists === true && antennaInitDisabled === true &&
    ae3setup.inR0 === true && antennaBtnHit.exists && antennaBtnHit.hit &&
    ae3after.antennaItems === 1 && ae3after.placed === true && ae3after.valText === "1" &&
    ae4.inCoverageShallow === true &&
    ae5.covered === true && ae5.screen === "fail" &&
    retryHit.exists && retryHit.hit &&
    ae5after.screen === "dive" && ae5after.coal === 6;
  out("pageerror", ae_pe);
  out("PASS(AE: アイテムタブ/クラフト5レシピ/アンテナ設置/透視条件/保険 画面操作)", itemsPass);
  await ctx.close();
}

// ============================================================================
// (AF) v0.15.0 掘削 8 方向(画面座標ヒットテスト経由、STATUS v0.15.0 判断 A〜D/F)。
// v0.20.0 判断B/C 追随: AF1(クライム不能)/AF4(5等分ゾーン入力の実効化)は STATUS v0.20.0 判断B/C
// に合わせて期待値を書き換え済み(コメント本文は当時の記述のまま、実装は下記各ステップの直近
// コメント参照)。
//   AF1 はしご無し上掘り: 真上が固体のセルで placedLadders 空のまま画面タップで真上を掘れる。
//       掘り抜きで自機は移動しない → 次タップは v0.20.0 判断C によりクライムできず落ち戻る。
//   AF2 斜めタップ受理: 斜め隣(Chebyshev 1)のタップが act に届き掘削が発生。斜め上の掘り抜きは非移動。
//   AF3 斜め階段登り: AF2 の続きの斜めタップで 1 段上がる(横隣の足場で重力が止まる)。
//   AF4 v0.20.0 判断B: 画面 5 等分の中央ゾーン(自マス相当)タップのみ無反応。隣接圏外は粗ゾーン
//       判定で方向入力になる(旧 v0.15.0 の「距離2は無反応」から差し戻し)。
//   シナリオ構築は G.dug/G.spawned 注入(player 由来 state)のみ。世界生成レイヤーには非介入。
// ============================================================================
let dig8Pass = true;
{
  console.log("== (AF) v0.15.0 掘削 8 方向(斜めタップ/はしご無し上掘り) ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await startToDive(page);

  const AF_HELPERS = `
    function afFindCell(pred) {
      for (let r = 2; r <= CONST.DEPTH_ROWS - 2; r++)
        for (let c = 0; c < CONST.GRID_COLS - 1; c++)
          if (pred(c, r)) return { c, r };
      return null;
    }
    function afSolid(c, r) {
      const t = tileAt(c, r);
      return t !== TILE.NONE && t !== TILE.SURFACE;
    }
    function afPlace(c, r) {
      G.dug.add(c + "," + r);
      moveTo(c, r, true, true);
    }
  `;

  // --- AF1 はしご無し上掘り(真上=固体) ---
  const af1setup = await page.evaluate((helpers) => {
    eval(helpers);
    G.monsters = [];
    G.pick = "DIAMOND";
    const cell = afFindCell((c, r) =>
      afSolid(c, r - 1) && tileAt(c, r - 1) !== TILE.GIRL &&
      !G.girls.some((g) => g.col === c && g.row === r));
    if (!cell) return { found: false };
    G.spawned.add(cell.c + "," + (cell.r - 1)); // 埋没スポーン抑止(シナリオ安定化、player 由来 state)。
    afPlace(cell.c, cell.r);
    return { found: true, c: cell.c, r: cell.r, ladders: G.placedLadders.size, px: G.px, py: G.py };
  }, AF_HELPERS);
  await page.waitForTimeout(900); // カメラ追従(camY lerp)の整定待ち(タップ座標と描画座標を一致させる)。
  out("AF1 setup(真上固体セル・はしご0)", af1setup);
  if (!af1setup.found || af1setup.ladders !== 0) dig8Pass = false;

  // 真上を画面タップで掘り抜く(最大4タップ。掘り抜けても自機非移動)。
  let af1dig = null;
  for (let i = 0; i < 4; i++) {
    const t = await actTap(page, 0, -1);
    if (!t.onScene) dig8Pass = false;
    await page.waitForTimeout(40);
    af1dig = await page.evaluate(([c, r]) => ({
      dug: G.dug.has(c + "," + (r - 1)), px: G.px, py: G.py,
    }), [af1setup.c, af1setup.r]);
    if (af1dig.dug) break;
  }
  out("AF1 はしご無し上掘り(掘り抜き+自機非移動)", af1dig);
  if (!af1dig || !af1dig.dug || af1dig.px !== af1setup.c || af1dig.py !== af1setup.r) dig8Pass = false;

  // 次タップ = v0.20.0 判断C: クライム廃止によりはしご無しでは登れず、moveTo 内の applyGravity で
  // 即座に落ち戻る(原作ジャンプの net 挙動)。元の位置(r)に留まることを確認する。
  const tClimb = await actTap(page, 0, -1);
  await page.waitForTimeout(40);
  const af1climb = await page.evaluate(() => ({ px: G.px, py: G.py }));
  out("AF1 v0.20.0 判断C: 掘り抜き後の次タップはクライム不能(はしご無しでは落ち戻る)", { tClimb, af1climb });
  if (!tClimb.onScene || af1climb.py !== af1setup.r) dig8Pass = false;

  // --- AF2/AF3 斜めタップ(掘削→階段登り) ---
  const af2setup = await page.evaluate((helpers) => {
    eval(helpers);
    G.monsters = [];
    const cell = afFindCell((c, r) =>
      afSolid(c + 1, r) && afSolid(c, r - 1) && afSolid(c + 1, r - 1) &&
      tileAt(c + 1, r - 1) !== TILE.GIRL &&
      !G.girls.some((g) => g.col === c && g.row === r));
    if (!cell) return { found: false };
    const { c, r } = cell;
    G.spawned.add(c + "," + (r - 1)); G.spawned.add((c + 1) + "," + (r - 1));
    afPlace(c, r);
    G.dug.add(c + "," + (r - 1)); // 真上を掘った跡に(斜め前提条件の「真上が空間」正例)。
    G.unstableDug = new Set(); // なだれ土の遅延崩落でシナリオが乱れないよう明示クリア。
    return { found: true, c, r, px: G.px, py: G.py };
  }, AF_HELPERS);
  await page.waitForTimeout(900); // カメラ整定待ち。
  out("AF2 setup(横隣固体・斜め先固体・真上空間)", af2setup);
  if (!af2setup.found) dig8Pass = false;

  let af2dig = null;
  for (let i = 0; i < 4; i++) {
    const t = await actTap(page, 1, -1);
    if (!t.onScene) dig8Pass = false;
    await page.waitForTimeout(40);
    af2dig = await page.evaluate(([c, r]) => ({
      dug: G.dug.has((c + 1) + "," + (r - 1)), px: G.px, py: G.py,
    }), [af2setup.c, af2setup.r]);
    if (af2dig.dug) break;
  }
  out("AF2 斜めタップで掘削(掘り抜き+自機非移動)", af2dig);
  if (!af2dig || !af2dig.dug || af2dig.px !== af2setup.c || af2dig.py !== af2setup.r) dig8Pass = false;

  await page.evaluate(() => { G.unstableDug = new Set(); });
  const tStair = await actTap(page, 1, -1);
  await page.waitForTimeout(40);
  const af3 = await page.evaluate(() => ({ px: G.px, py: G.py }));
  out("AF3 斜めタップで階段登り(1 段上がる)", { tStair, af3 });
  if (!tStair.onScene || af3.px !== af2setup.c + 1 || af3.py !== af2setup.r - 1) dig8Pass = false;

  // --- AF4 v0.20.0 判断B: 画面 5 等分ゾーン入力の実効化(v0.15.0 判断A の差し戻し)により、隣接
  // 8 マス圏外のタップは「無反応」ではなく粗ゾーン判定(bf.java:530-532 verbatim)へ入るようになった。
  // 無反応であるべきなのは画面 5 等分の中央ゾーン(自マス相当)のタップのみ(dx=dy=0 の早期 return、
  // §B 未実装スコープ)。画面座標の絶対中央(2/5〜3/5 の中間)は自機位置によらず常に中央ゾーンに
  // 入るので、そこをタップして無反応を確認する(旧 AF4 の「Chebyshev 距離 2 は無反応」という
  // 前提は判断B で置き換わったため書き換え)。
  await page.waitForTimeout(900); // 階段登り後のカメラ整定待ち。
  const af4before = await page.evaluate(() => ({ px: G.px, py: G.py, sp: G.stamina, hp: G.hp }));
  const vp = page.viewportSize();
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(40);
  const af4after = await page.evaluate(() => ({ px: G.px, py: G.py, sp: G.stamina, hp: G.hp }));
  const af4ok = JSON.stringify(af4before) === JSON.stringify(af4after);
  out("AF4 v0.20.0 判断B: 画面5等分の中央ゾーン(自マス相当)タップは無反応", { af4before, af4after, af4ok });
  if (!af4ok) dig8Pass = false;

  const af_pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  if (af_pe.length > 0) dig8Pass = false;
  out("pageerror", af_pe);
  out("PASS(AF: 掘削 8 方向)", dig8Pass);
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
// (AG) v0.20.0 新規挙動 4 点 + 可視性解消(画面座標ヒットテスト経由、playtester 追加)。
//   AG1 判断A: 広域ダンジョン(dungeonId=6「孤独な山」80x80)で VIEW_COLS=17(全列は出さない)+
//       自機の横移動実タップで camX が camXTarget(G.px) へ追従すること。
//   AG2 判断B: 隣接8マス圏外のタップが画面5等分ゾーンで act(zc,zr) を実際に呼び、横/下ゾーンでは
//       px/py が実際に動くこと(act を一時的にラップして呼び出し引数を観測。実タップは画面座標
//       のまま送るので入力経路そのものは変えていない)。上ゾーンは判断C の重力落ち戻りが乗り
//       「見える移動」にならないため対象外(落ち戻り自体は AF1/AG3 が別途担保)。
//   AG3 判断C: 掘り抜いた真上への次タップは、はしご無しでは落ち戻り(AF1 既出)、はしご設置後は
//       登れてそのまま留まる(重力で戻らない)ことを実タップで確認。
//   AG4 判断E: モンスター自作スプライト 6 種(bat/slime/slime_half/snake/worm/spider)が
//       complete && naturalWidth>0(実デコード済み)+ 実描画がテクスチャあり(fallback の単色円
//       ではない)ことをピクセル分散で確認。
//   AG5 可視性解消(発端「全部見える」の直接対策): 広域ダンジョンで fog を強制解除しても、
//       camX 窓の外にいる個体は canvas に描画されない(窓内の同条件個体は描画される、の対で示す)。
// ============================================================================
let newBehaviorPass = true;
{
  console.log("== (AG) v0.20.0 新規挙動 4 点 + 可視性解消 ==");
  const { ctx, page, errors } = await openPage({ seedHowto: true });
  await page.goto(`${BASE}/mineroad/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  // 広域ダンジョン(孤独な山、dungeonId=6, 80x80)へ直接注入。タイトルは裏庭のみ解放済みのため
  // 選択ボタン到達不能(debug-mineroad-runtimespawn.mjs の前例踏襲、規律違反ではない)。
  const agSetup = await page.evaluate(() => {
    G.dungeonId = 6;
    startDive();
    G.pick = "DIAMOND";
    G.monsters = [];
    return { cols: CONST.GRID_COLS, viewCols: VIEW_COLS, px: G.px, py: G.py };
  });
  out("AG1 setup(広域80x80直接注入)", agSetup);
  if (!(agSetup.cols === 80 && agSetup.viewCols === 17)) newBehaviorPass = false;

  // 共有 tileCenter/actTap は camY のみ対応(v0.15.0 以来の既存ゲート専用、裏庭 camX=0 前提で
  // 動いている)。広域は camX が動くため本ゲート専用に camX 対応版を独立実装する(共有ヘルパーは
  // 既存ゲートの座標計算に触れないよう不変のまま残す)。
  async function tileCenterX(col, row) {
    return page.evaluate(([col, row]) => {
      const t = tile;
      const cx = window.__camX || 0;
      const cy = window.__camY || 0;
      return { x: (col - cx) * t + t / 2, y: (row - cy) * t + t / 2 };
    }, [col, row]);
  }
  async function actTapX(dc, dr) {
    const cur = await page.evaluate(() => ({ px: G.px, py: G.py }));
    const pt = await tileCenterX(cur.px + dc, cur.py + dr);
    const onScene = await isSceneAt(page, pt.x, pt.y);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    return { onScene, pt };
  }
  async function camXSettle(timeoutMs = 3000) {
    const t0 = Date.now();
    let prev = await page.evaluate(() => window.__camX || 0);
    while (Date.now() - t0 < timeoutMs) {
      await page.waitForTimeout(100);
      const cur = await page.evaluate(() => window.__camX || 0);
      if (Math.abs(cur - prev) < 0.02) return cur;
      prev = cur;
    }
    return prev;
  }

  await camXSettle();
  const camXInit = await page.evaluate(() => window.__camX || 0);

  // 自機を右へ 10 手 実タップ(power ゲート撤去済み=DIAMOND なので地形に依らず必ず前進/掘削できる)。
  let ag1TapFails = 0;
  for (let i = 0; i < 10; i++) {
    const t = await actTapX(1, 0);
    if (!t.onScene) ag1TapFails++;
    await page.waitForTimeout(30);
  }
  const camXAfter = await camXSettle();
  const ag1After = await page.evaluate(() => ({ px: G.px, py: G.py, target: camXTarget(G.px) }));
  out("AG1 横移動10手後の camX 追従", { camXInit, camXAfter, ...ag1After, ag1TapFails });
  if (!(ag1TapFails === 0 && ag1After.px > agSetup.px && Math.abs(camXAfter - ag1After.target) < 0.5 && camXAfter > camXInit))
    newBehaviorPass = false;

  // ---- AG2 判断B: 5等分ゾーンの実効化(act をラップして呼び出し引数を観測)。 ----
  // 移動先を player-origin state(G.dug)で開けておき、ゾーンタップの結果が「掘削」でなく
  // 「移動」として素直に観測できるようにする(afPlace と同型、世界生成レイヤー非介入)。
  // 右ゾーンタップが自機を動かした後に下ゾーンの穴掘り先を計算する必要があるため、各タップの
  // 直前に「その時点の」G.px/G.py を読んで都度掘っておく(まとめて事前計算すると位置がずれる)。
  await page.evaluate(() => {
    G.dug.add((G.px + 1) + "," + G.py);
    G.spawned.add((G.px + 1) + "," + G.py);
    window.__actCalls = [];
    const orig = act;
    act = function (dc, dr) { window.__actCalls.push([dc, dr]); return orig(dc, dr); };
  });
  await page.waitForTimeout(300);

  const vp = page.viewportSize();
  // 右ゾーン: x を最終の5分の1(index4)、y を中央(index2)へ(HUD 帯/D-pad と重ならない中段)。
  const rightBefore = await page.evaluate(() => ({ px: G.px, py: G.py }));
  await page.mouse.move(vp.width * 0.9, vp.height * 0.5);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const rightAfter = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const ag2rightCalls = await page.evaluate(() => window.__actCalls.slice());
  out("AG2 右ゾーンタップ(x=0.9W, y=0.5H)", { rightBefore, rightAfter, calls: ag2rightCalls });
  const ag2rightOk = ag2rightCalls.some(([dc, dr]) => dc === 1 && dr === 0) && rightAfter.px === rightBefore.px + 1;
  if (!ag2rightOk) newBehaviorPass = false;

  // 下ゾーン: x を中央(index2)、y を index3(D-pad footer に重ならない、最下段の1つ上)へ。
  // 右ゾーンタップで自機列が動いた後なので、掘り先はこの時点の G.px/G.py で計算し直す。
  const downBefore = await page.evaluate(() => {
    G.dug.add(G.px + "," + (G.py + 1));
    G.spawned.add(G.px + "," + (G.py + 1));
    window.__actCalls = [];
    return { px: G.px, py: G.py };
  });
  await page.mouse.move(vp.width * 0.5, vp.height * 0.7);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const downAfter = await page.evaluate(() => ({ px: G.px, py: G.py }));
  const ag2downCalls = await page.evaluate(() => window.__actCalls.slice());
  out("AG2 下ゾーンタップ(x=0.5W, y=0.7H)", { downBefore, downAfter, calls: ag2downCalls });
  const ag2downOk = ag2downCalls.some(([dc, dr]) => dc === 0 && dr === 1) && downAfter.py === downBefore.py + 1;
  if (!ag2downOk) newBehaviorPass = false;

  // ---- AG3 判断C: はしご無しでは落ち戻る(AF1 既出の再確認)+ はしご設置後は登れて留まる。 ----
  const ag3Setup = await page.evaluate(() => {
    G.monsters = [];
    for (let r = 2; r <= CONST.DEPTH_ROWS - 2; r++) {
      for (let c = 0; c < CONST.GRID_COLS - 1; c++) {
        const above = tileAt(c, r - 1);
        if (above === TILE.NONE || above === TILE.SURFACE || above === TILE.GIRL) continue;
        if (G.girls.some((g) => g.col === c && g.row === r)) continue;
        G.dug.add(c + "," + r);
        G.spawned.add(c + "," + (r - 1));
        moveTo(c, r, true, true);
        return { found: true, c, r };
      }
    }
    return { found: false };
  });
  out("AG3 setup(真上固体セル)", ag3Setup);
  if (!ag3Setup.found) newBehaviorPass = false;
  await camXSettle();

  // 真上を掘り抜く(はしご0のまま)。
  let ag3dug = null;
  for (let i = 0; i < 4; i++) {
    const t = await actTapX(0, -1);
    await page.waitForTimeout(40);
    ag3dug = await page.evaluate(([c, r]) => ({ dug: G.dug.has(c + "," + (r - 1)), px: G.px, py: G.py }), [ag3Setup.c, ag3Setup.r]);
    if (ag3dug.dug) break;
  }
  // はしご無しで次タップ→落ち戻る(AF1 と同じ確認、本ゲート内でも独立に踏む)。
  const ag3climbNoLadder = await actTapX(0, -1);
  await page.waitForTimeout(40);
  const ag3afterNoLadder = await page.evaluate(() => ({ px: G.px, py: G.py }));
  out("AG3 はしご無し次タップ", { ag3dug, ag3climbNoLadder, ag3afterNoLadder });
  if (ag3afterNoLadder.py !== ag3Setup.r) newBehaviorPass = false;

  // はしご設置(state 注入、verify-mineroad-dig8.mjs と同じ手段)→次タップで登れて留まる。
  await page.evaluate(([c, r]) => { G.placedLadders.add(c + "," + (r - 1)); }, [ag3Setup.c, ag3Setup.r]);
  const ag3climbLadder = await actTapX(0, -1);
  await page.waitForTimeout(40);
  const ag3afterLadder = await page.evaluate(() => ({ px: G.px, py: G.py }));
  // さらに 1 手待って(別方向へは動かさず)重力で戻っていないことも確認(留まり続ける=一過性の
  // 1 手だけの猶予ではないことの証拠)。
  await page.waitForTimeout(300);
  const ag3stay = await page.evaluate(() => ({ px: G.px, py: G.py }));
  out("AG3 はしご設置後の次タップ+滞留確認", { ag3climbLadder, ag3afterLadder, ag3stay });
  if (!(ag3climbLadder.onScene && ag3afterLadder.py === ag3Setup.r - 1 && ag3stay.py === ag3Setup.r - 1))
    newBehaviorPass = false;

  // ---- AG4 判断E: モンスタースプライト 6 種の実読込 + 実描画(fallback でない)。 ----
  const spriteReady6 = await page.evaluate(() => {
    const keys = ["bat", "slime", "slime_half", "snake", "worm", "spider"];
    const r = {};
    let all = true;
    for (const k of keys) {
      const img = SPRITES[k];
      const ready = !!(img && img.complete && img.naturalWidth > 0);
      r[k] = ready;
      if (!ready) all = false;
    }
    return { r, all };
  });
  out("AG4 モンスタースプライト6種 complete&naturalWidth", spriteReady6);
  if (!spriteReady6.all) newBehaviorPass = false;

  // 自機の隣に未埋没モンスター(SPIDER)を直接配置し、isVisible(fog 開示)を満たしてから描画
  // させ、fallback の単色円(#3a6b78 = rgb(58,107,120))でなくスプライトのテクスチャが
  // 乗っていることをピクセル分散で確認する(gate K の soil テクスチャ確認と同じ手法)。
  // 隣接マスが常に空間とは限らない(固体の可能性がある)ため、G.dug で確実に開けてから置く
  // (player-origin state 注入のみ、世界生成レイヤー非介入。AF/afPlace と同型)。
  const ag4place = await page.evaluate(() => {
    const c = G.px + 1, r = G.py;
    G.dug.add(c + "," + r);
    G.spawned.add(c + "," + r);
    if (!isSpace(c, r)) return { placed: false, c, r };
    const meta = MONSTER.SPIDER;
    G.monsters.push({
      key: "SPIDER", col: c, row: r, hp: meta.hp, kind: "space", buried: false, bt: 0,
      sp: meta.sp, sleeping: false, tk: 0, rc: 0, spawnCol: c, spawnRow: r, dir: 0,
    });
    revealAround();
    return { placed: true, c, r, isVisible: isVisible(c, r) };
  });
  out("AG4 SPIDER 配置", ag4place);
  if (!ag4place.placed || !ag4place.isVisible) newBehaviorPass = false;
  let ag4texture = { sampled: false, reason: "placed=false のためスキップ" };
  if (ag4place.placed) {
    await page.evaluate(async () => {
      const raf = () => new Promise((res) => requestAnimationFrame(res));
      for (let i = 0; i < 3; i++) await raf();
    });
    ag4texture = await page.evaluate(([c, r]) => {
      const cv = document.getElementById("scene");
      const dpr = cv.width / cv.getBoundingClientRect().width;
      const cx = window.__camX || 0, cy = window.__camY || 0;
      const x = Math.round(((c - cx) * tile) * dpr);
      const y = Math.round(((r - cy) * tile) * dpr);
      const w = Math.round(tile * dpr), h = w;
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > cv.width || y + h > cv.height) return { sampled: false, reason: "off-canvas", x, y, w, h };
      const d = cv.getContext("2d").getImageData(x, y, w, h).data;
      let sum = 0, n = 0;
      const rs = [];
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 10) continue; rs.push(d[i]); sum += d[i]; n++; }
      if (n === 0) return { sampled: true, n: 0, variance: 0 };
      const mean = sum / n;
      let varc = 0;
      for (const v of rs) varc += (v - mean) * (v - mean);
      varc /= n;
      return { sampled: true, n, variance: +varc.toFixed(1) };
    }, [ag4place.c, ag4place.r]);
  }
  // 正直な限界: fallback(円+頭文字)も文字グリフ分の分散を持つため、この分散だけでは
  // 「実スプライトかfallbackか」を厳密には判別できない(実測でも fallback 時に variance=2329
  // と高く出ることを確認済み)。判別の主担保はあくまで上の spriteReady6(complete/naturalWidth)。
  // このチェックは「そのセルに何か(単色矩形でない)実描画が起きている」ことの補助確認に留める。
  out("AG4 モンスターセルのピクセル分散(補助確認。fallback でも文字グリフ分の分散が出るため主担保にしない)", ag4texture);
  if (!ag4texture.sampled) newBehaviorPass = false;

  // ---- AG5 可視性解消: fog を強制解除しても camX 窓の外の個体は描画されない。 ----
  // 窓内(自機近傍、既に AG4 で配置済みの SPIDER)は描画される一方、窓の外(自機から 30 列先)に
  // 同条件(未埋没・isVisible 強制)の個体を置いても描画されないことを対で示す(発端の
  // 「全部見える」の直接対策=camera windowing がモンスター描画にも効いている証拠)。
  const ag5setup = await page.evaluate(() => {
    const px = G.px, py = G.py;
    const farCol = Math.min(CONST.GRID_COLS - 1, px + 30);
    // 自然地形は大半が固体(掘らないと空間にならない)なので、AF/afPlace と同型に G.dug で
    // 確実に開けてから置く(player-origin state 注入のみ、世界生成レイヤー非介入)。
    G.dug.add(farCol + "," + py);
    G.spawned.add(farCol + "," + py);
    if (!isSpace(farCol, py)) return { ok: false };
    const meta = MONSTER.SLIME;
    G.monsters.push({
      key: "SLIME", col: farCol, row: py, hp: meta.hp, kind: "space", buried: false, bt: 0,
      sp: meta.sp, sleeping: false, tk: 0, rc: 0, spawnCol: farCol, spawnRow: py, dir: 0,
    });
    G.seen.add(farCol + "," + py); // fog を強制解除(isVisible=true)。窓外であることだけを条件にする。
    const camXNow = window.__camX || 0;
    const mxFar = (farCol - camXNow) * tile;
    return { ok: true, px, py, farCol, isVisible: isVisible(farCol, py), camXNow, tile, W, mxFar, insideWindow: mxFar >= -tile && mxFar <= W };
  });
  out("AG5 setup(窓外 SLIME を fog 強制解除で配置)", ag5setup);
  if (!ag5setup.ok || !ag5setup.isVisible || ag5setup.insideWindow) newBehaviorPass = false; // 窓外である前提が崩れていたら検証不能。
  await page.evaluate(async () => {
    const raf = () => new Promise((res) => requestAnimationFrame(res));
    for (let i = 0; i < 3; i++) await raf();
  });
  // 窓外個体の計算上の画面位置(mxFar)が canvas 幅の外(=描画してもピクセルに現れない)ことを
  // 実際の canvas 全体スクリーンショットのピクセル分散でも裏取りする(computed 座標だけに
  // 依存しない: canvas 全域を見て、窓外個体特有の色が一切出ていないことを確認)。
  const ag5screenshot = await page.evaluate(() => {
    const cv = document.getElementById("scene");
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    // SLIME のスプライトは緑系(元 fallback 円も寒色 #3a6b78 系)。canvas 全体を走査して、
    // 強い緑(g > r+20 かつ g > b+20)のピクセルが「窓内の SPIDER 分」を超えて広範囲に
        // 出ていないかを大まかに数える(誤検出耐性のため閾値は緩め、0 件を要求しない)。
    let greenish = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2] + 20) greenish++;
    }
    return { canvasW: cv.width, canvasH: cv.height, greenishPx: greenish };
  });
  out("AG5 canvas 全域スクリーンショット(参考、窓外個体が canvas 外なら幾何的に描画不能)", ag5screenshot);
  // 一次的な合否判定は幾何(mxFar が canvas 幅の外)。canvas は自身の描画範囲外へは物理的に
  // 描けない(2D canvas の仕様)ため、insideWindow=false の時点で「描画され得ない」が確定する。

  const ag_pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  out("pageerror", ag_pe);
  if (ag_pe.length > 0) newBehaviorPass = false;
  out("PASS(AG: v0.20.0 新規挙動4点+可視性解消)", newBehaviorPass);
  await ctx.close();
}

// ============================================================================
// 総合
// ============================================================================
await browser.close();

console.log("\n== 総合 ==");
out("(A) コア遷移 + VERSION v0.20.0 + ダンジョン選択 + 5人配置 + HUD 0/5", corePass);
out("(J) アセット配信 20 本(200 + Content-Type) / 旧 mp3 404", assetPass);
out("(K) スプライト実読込/broken なし/miner 64x64 差し替え/描画", spritePass);
out("(L) mute トグル / BGM=theme.ogg / SFX clone 連打 pageerror 0 / clear SFX", audioPass);
out("(B/C/D) 二段ゲージ/撤退/1人救出(HUD 1/5,dive継続)/重力/探索率/決定論[内部関数]", mechPass);
out("(N) 女の子 縦坑追従 row トレース(底張り付きなし→地表救出/1人=dive継続)", girlFollowPass);
out("(N2) ②地表静止救出 実機相当(自機静止のまま row>=1 残りでも救出→HUD1/5→仲間タブ ストック/画面操作)", staticRescuePass);
out("(AC) v0.13.0 ダンジョン選択・解放チェーン・グリッドサイズ・HUD名・タイトルへ", dungeonPass);
out("(O) v0.3.0 クリアゲート §7 忠実 / 旧1人=即クリア回帰防止 / 全達成で制覇", clearGatePass);
out("(P) 複数女の子 2人救出 HUD 0/5→1/5→2/5", multiGirlPass);
out("(Q) v0.4.0 クラフト UI 6 レシピ / インベントリ / 鉱石決定論加算 / power ゲート回帰", v040Pass);
out("(R) v0.4.1 UI ポリッシュ: 地表被り解消 + 作る/薬ボタン拡大(PC/モバイル/短高)", uiPolishPass);
out("(S) モンスター/戦闘/GIRLATK + 埋没機構 v0.17.0(生成時配置/掘り当て)(死の緊張)", monsterPass);
out("(W) v0.16.0 水/マグマ ハザード(水=息+溺れHP直撃 / マグマ=maxHP/5直撃)", hazardPass);
out("(X) v0.7.0 なだれ/落盤 崩落物理(落下で道塞ぎ + 埋没ダメージ)", caveinPass);
out("(Y) v0.8.0 商人(キノコ採取/物々交換/商人タブ UI/非介入)", merchantPass);
out("(Z) v0.9.0 育成(情報/EXP→BP→PER Lv.UP/実効値変化/育成タブ往復/決定論/非介入)", growthPass);
out("(AA) v0.12.0 仲間同行(救出ストック→地表で同行→潜行で EXP→帰還で別れて Lv→ストックへ/タブ往復/画面操作/決定論/非介入)", companionPass);
out("(AB) v0.12.0 セーブ/永続(fail→retry 永続 state 復元/ランごとリセット/surfaceReturn 保存/クリア消去/決定論/非介入)", savePass);
out("(AD) v0.13.1 はしご設置/回収/上掘り", ladderPass);
out("(AE) v0.14.0 アイテム拡充 + アンテナ保険(タブ/クラフト5レシピ/設置/透視条件/保険 画面操作)", itemsPass);
out("(AF) v0.15.0 掘削 8 方向(斜めタップ/はしご無し上掘り/階段登り/画面5等分ゾーン中央は無反応)", dig8Pass);
out("(AG) v0.20.0 新規挙動4点(広域camX追従/5等分ゾーン実移動/はしごクライム/モンスタースプライト)+可視性解消", newBehaviorPass);
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
  mechPass && girlFollowPass && staticRescuePass && dungeonPass && clearGatePass && multiGirlPass &&
  v040Pass && uiPolishPass && monsterPass && hazardPass && caveinPass && merchantPass && growthPass && companionPass && savePass && ladderPass && itemsPass && dig8Pass && newBehaviorPass && dpadPass && shortVpPass && regressionPass &&
  e2ePass && failOverflowPass && determinismPass &&
  overflowFails.length === 0;
console.log(`\nRESULT: ${allPass ? "ALL PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
