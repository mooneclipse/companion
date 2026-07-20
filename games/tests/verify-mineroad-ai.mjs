// verify-mineroad-ai.mjs — マインロード v0.18.0「モンスター AI/活動範囲の原作合わせ」独立検証(playtester)。
//
// 実装側テスト(selfcheck-mineroad-ai.mjs / debug-mineroad.mjs)とは**別実装・別シナリオ**:
// selfcheck は state 注入でシナリオを構築するが、本テストは seed 41027(裏庭)の実盤面から事前導出した
// 固定経路を**実タップのみ**で踏む。期待値は probe(盤面ダンプ + 経路リハーサル、2026-07-19 導出)の
// 決定論リテラルを直接 assert。
//
// v0.20.0 追随(2026-07-20): B1..B22 バウンスの上昇分は climbUp ヘルパーが目的セルへ
// G.placedLadders を transient 注入(タップ直後に即撤去)する 1 点のみ state に触れる
// (クライム廃止・判断C の代替経路。世界生成/モンスター state には非介入)。単発 1 マスの
// 移動として旧クライムと物理的に等価(SP 消費/ターン進行は不変)なため、既存の S41_TRACK/
// SP_TRACK/DUG_B 等のリテラルは変更不要と当初想定したが、実機再走で無傷一致を確認済み。
//
// 経路計画(seed 41027 実測、2026-07-19 導出):
//   - 裏庭 15×15 は自機からの Chebyshev 最大距離が 15 のため、活動箱 MONSTER_ACTIVE_RANGE=16 が
//     **常に盤面全域を覆う**。よって初回 resolveTurn(T1)で全埋没 16 体(掘り当ての 1 体を除く)が
//     一斉に土中 tick され、bury100 種 13 体(SPIDER10+WORM3)+ escBt=1 の SLIME2 体が同時脱出する
//     (v0.17.0 の wake range 4 なら距離 8 の (2,8) は凍結のはず → 活動箱 16 の実効を距離で証明)。
//     SLIME@2,8 のみ escBt=2(buryEscapeRoll 事前導出)で T2 に脱出 = 脱出抽選が活動箱ゲート下でも
//     v0.17.0 どおり機能している証明。
//   - 圏外凍結・despawn(±28 AND)は裏庭では物理的に観測不可(最大距離 15 < 16/28)。その面は
//     selfcheck-mineroad-ai.mjs(80×80 相当の state 構築)が担い、本テストは「n=24 が全行程不変 =
//     despawn 誤発火なし」の負の対照のみ持つ。
//   - 隣接 100% 種: (4,1)SPIDER(bump gate self100)を (4,0) から掘り当て → 隣接のまま 4 ターン
//     (T1 掘り + T2..T4 bump 攻撃 3 回)。毎ターン反撃 -2 が入る(SP 97/94/91/88)。攻撃で
//     hp 6→5→4→3 と削り、hp3 で生かして徘徊観察の対象にする。
//   - 寄って来ないこと: (10,0) から col10 シャフト(10,1..3)を掘り (10,2)↔(10,3) クライムバウンス
//     22 ターン。この間 s41(元(4,1)SPIDER)は 25%/turn の上ロールで地表へ出て cols 4..6 を
//     ランダム徘徊(反転あり・自機との Chebyshev 距離 4 以上を維持)。プレイヤー被弾 0
//     (SP がちょうど -1/ターン)= bfsStep 追跡の全廃を実測で確認。
//   - SP-睡眠: s41 は徘徊 5 歩(sp5→0)で B16 に入眠、sprec2 回復(sp0→2→4)で B19 に覚醒
//     (覚醒ターンは移動なし・眠り中 rc 凍結=42)。眠り「z」描画をピクセル diff で証明。
//   - den(10,5)SPIDER/(11,5)BAT/(12,5)WORM/(12,4)BAT は開マス 4 つを 4 体が埋める gridlock で
//     全行程不動(rc だけ進む)。SNAKE@13,15 は初回 dir ロール(rc1)以降ロールなしの方向持続。
//     WORM は tk%3 ターンのみロール(rc が tk/3 で進む)= SPD 剰余ゲートの実測。
//
// 計測しきい値(新ゲーム初回基準、実測根拠):
//   - 眠り z 描画のセル diff: 同一プレイヤー行(camY 同値)・camSettle 後の比較で、
//     stability(B16vsB18 両眠り)= 実測 0px、z 有無(B17vsB19)= 実測 11px(tile27px・serif z 約8px)。
//     → stability <= 8 / z-diff >= 5 を合格条件とする。プレイヤー行が違う比較は camY の
//     サブピクセル差で約 192px 出るため、必ず同行同士で比較する(導出プローブで確認)。
//
// 入力規律(tests/ ルール): 全入力は page.mouse の画面座標タップ + タップ直前に elementFromPoint で
// 最前面 = #scene(canvas) を assert(canvas への直接 dispatch なし)。
//
// 検証項目(親指示):
//   A1 初期配置リテラル(24 体・埋没 17)+ v0.18.0 表示 + 地表歩行では tick が走らない
//   A2 T1 一斉脱出(dug 16 マスリテラル・hp/bt/rc 全一致)+ 距離 8 個体の tick = 活動箱 16 実効
//   A3 隣接 100% 種の毎ターン被弾(T1..T4 反撃 -2 ×4)と、離れたら被弾 0(T5..B22 の 25 ターン)
//   A4 寄って来ない(徘徊トラックリテラル・反転あり・距離 4 以上・接近収束なし)
//   A5 SP-睡眠サイクル(入眠/回復/覚醒/rc 凍結)+ 眠り z のピクセル diff
//   A6 WORM tk%3・SNAKE 方向持続・den gridlock・n=24 不変(despawn 誤発火なし)
//   A7 決定論: fresh コンテキスト 3 run で全ターントレース完全一致
//   A8 回帰: 既存 5 URL + healthz 200 / 短高 viewport 412x680・730 ボタン in-view + はみ出し 0 /
//      pageerror 0
//
// 実行: 本番 47825 は使わない。別ポート(既定 47894)で server/app.py を自前起動してから
//   GAMES_BASE=http://127.0.0.1:47894 node tests/verify-mineroad-ai.mjs
import { chromium } from "playwright";

const BASE = process.env.GAMES_BASE || "http://127.0.0.1:47894";
const failures = [];
const log = (k, v) => console.log(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
function check(name, cond, detail) {
  log((cond ? "ok " : "NG ") + name, detail === undefined ? cond : detail);
  if (!cond) failures.push(name);
  return cond;
}

// ---- 期待値リテラル(probe 導出、seed 41027 裏庭) ----
// mon 形式: key@col,row:hp:buried:sp:sleeping:rc(ソート連結)。
const MON_START =
  "BAT@11,14:5:0:20:0:0|BAT@11,5:5:0:20:0:0|BAT@12,4:5:0:20:0:0|BAT@12,8:5:0:20:0:0|BAT@6,15:5:0:20:0:0|" +
  "SLIME@1,12:15:1:5:0:0|SLIME@2,8:15:1:5:0:0|SLIME@5,6:15:1:5:0:0|SNAKE@13,15:10:0:8:0:0|" +
  "SPIDER@0,10:6:1:5:0:0|SPIDER@0,12:6:1:5:0:0|SPIDER@10,5:6:1:5:0:0|SPIDER@13,11:6:1:5:0:0|" +
  "SPIDER@13,12:6:1:5:0:0|SPIDER@14,6:6:1:5:0:0|SPIDER@4,13:6:1:5:0:0|SPIDER@4,1:6:1:5:0:0|" +
  "SPIDER@4,7:6:0:5:0:0|SPIDER@5,8:6:1:5:0:0|SPIDER@7,11:6:1:5:0:0|SPIDER@9,11:6:1:5:0:0|" +
  "WORM@12,5:5:1:0:0:0|WORM@13,1:5:1:0:0:0|WORM@7,12:5:1:0:0:0";
const MON_T1 =
  "BAT@11,14:5:0:20:0:1|BAT@11,5:5:0:20:0:1|BAT@12,4:5:0:20:0:1|BAT@12,8:5:0:20:0:1|BAT@6,15:5:0:20:0:1|" +
  "SLIME@1,12:14:0:5:0:0|SLIME@2,8:14:1:5:0:0|SLIME@5,6:14:0:5:0:0|SNAKE@13,15:10:0:8:0:1|" +
  "SPIDER@0,10:5:0:5:0:0|SPIDER@0,12:5:0:5:0:0|SPIDER@10,5:5:0:5:0:0|SPIDER@13,11:5:0:5:0:0|" +
  "SPIDER@13,12:5:0:5:0:0|SPIDER@14,6:5:0:5:0:0|SPIDER@4,13:5:0:5:0:0|SPIDER@4,1:6:0:5:0:1|" +
  "SPIDER@4,7:6:0:5:0:2|SPIDER@5,8:5:0:5:0:0|SPIDER@7,11:5:0:5:0:0|SPIDER@9,11:5:0:5:0:0|" +
  "WORM@12,5:4:0:0:0:0|WORM@13,1:4:0:0:0:0|WORM@7,12:4:0:0:0:0";
const MON_T4 =
  "BAT@11,14:5:0:20:0:4|BAT@11,5:5:0:20:0:4|BAT@12,4:5:0:20:0:4|BAT@12,8:5:0:20:0:4|BAT@6,15:5:0:20:0:4|" +
  "SLIME@1,12:14:0:5:0:6|SLIME@2,8:13:0:5:0:4|SLIME@5,6:14:0:5:0:6|SNAKE@13,15:10:0:8:0:1|" +
  "SPIDER@0,10:5:0:5:0:6|SPIDER@0,12:5:0:5:0:6|SPIDER@10,5:5:0:5:0:6|SPIDER@13,11:5:0:5:0:6|" +
  "SPIDER@13,12:5:0:5:0:6|SPIDER@14,6:5:0:5:0:6|SPIDER@4,13:5:0:5:0:6|SPIDER@4,1:3:0:5:0:4|" +
  "SPIDER@4,7:6:0:5:0:8|SPIDER@5,8:5:0:5:0:6|SPIDER@7,11:5:0:5:0:6|SPIDER@9,11:5:0:5:0:6|" +
  "WORM@12,5:4:0:0:0:1|WORM@13,1:4:0:0:0:1|WORM@7,12:4:0:0:0:1";
const MON_B10 =
  "BAT@11,14:5:0:20:0:17|BAT@11,5:5:0:20:0:17|BAT@12,4:5:0:20:0:17|BAT@12,8:5:0:20:0:17|BAT@6,15:5:0:20:0:17|" +
  "SLIME@1,12:14:0:5:0:32|SLIME@2,8:13:0:5:0:30|SLIME@5,6:14:0:5:0:32|SNAKE@13,15:10:0:8:0:1|" +
  "SPIDER@0,10:5:0:5:0:32|SPIDER@0,12:5:0:5:0:32|SPIDER@10,5:5:0:5:0:32|SPIDER@13,11:5:0:5:0:32|" +
  "SPIDER@13,12:5:0:5:0:32|SPIDER@14,6:5:0:5:0:32|SPIDER@4,13:5:0:5:0:32|SPIDER@4,7:6:0:5:0:34|" +
  "SPIDER@5,8:5:0:5:0:32|SPIDER@6,0:3:0:3:0:30|SPIDER@7,11:5:0:5:0:32|SPIDER@9,11:5:0:5:0:32|" +
  "WORM@12,5:4:0:0:0:5|WORM@13,1:4:0:0:0:5|WORM@7,12:4:0:0:0:5";
const MON_B22 =
  "BAT@11,14:5:0:20:0:29|BAT@11,5:5:0:20:0:29|BAT@12,4:5:0:20:0:29|BAT@12,8:5:0:20:0:29|BAT@6,15:5:0:20:0:29|" +
  "SLIME@1,12:14:0:5:0:56|SLIME@2,8:13:0:5:0:54|SLIME@5,6:14:0:5:0:56|SNAKE@13,15:10:0:8:0:1|" +
  "SPIDER@0,10:5:0:5:0:56|SPIDER@0,12:5:0:5:0:56|SPIDER@10,5:5:0:5:0:56|SPIDER@13,11:5:0:5:0:56|" +
  "SPIDER@13,12:5:0:5:0:56|SPIDER@14,6:5:0:5:0:56|SPIDER@4,13:5:0:5:0:56|SPIDER@4,1:3:0:4:0:46|" +
  "SPIDER@4,7:6:0:5:0:58|SPIDER@5,8:5:0:5:0:56|SPIDER@7,11:5:0:5:0:56|SPIDER@9,11:5:0:5:0:56|" +
  "WORM@12,5:4:0:0:0:9|WORM@13,1:4:0:0:0:9|WORM@7,12:4:0:0:0:9";
// T1 一斉脱出 + 掘り当てで dug に入る 16 マス(SLIME@2,8 は T2 で +1)。
const DUG_T1 = "0,10|0,12|1,12|10,5|12,5|13,1|13,11|13,12|14,6|4,1|4,13|5,6|5,8|7,11|7,12|9,11";
const DUG_T4 = "0,10|0,12|1,12|10,5|12,5|13,1|13,11|13,12|14,6|2,8|4,1|4,13|5,6|5,8|7,11|7,12|9,11";
const DUG_B = "0,10|0,12|1,12|10,1|10,2|10,3|10,5|12,5|13,1|13,11|13,12|14,6|2,8|4,1|4,13|5,6|5,8|7,11|7,12|9,11";
// s41(spawn(4,1) SPIDER)徘徊トラック: 各ターン "col,row:sp:slp:rc"。T5..T7 + B1..B22。
const S41_TRACK = [
  "4,1:5:0:6", "4,1:5:0:8", "4,1:5:0:10", // T5..T7(穴の中でロールのみ)
  "4,1:5:0:12", "4,1:5:0:14", "4,1:5:0:16", // B1..B3
  "5,0:4:0:18", "5,0:4:0:20", "5,0:4:0:22", "5,0:4:0:24", "5,0:4:0:26", "5,0:4:0:28", // B4..B9 地表へ
  "6,0:3:0:30", "6,0:3:0:32", // B10..B11
  "5,0:2:0:34", "5,0:2:0:36", "5,0:2:0:38", // B12..B14 反転
  "6,0:1:0:40", // B15 再反転
  "5,0:0:1:42", "5,0:2:1:42", "5,0:4:1:42", // B16..B18 入眠(sp0)→回復(rc 凍結)
  "5,0:5:0:42", // B19 覚醒(移動なし)
  "4,0:4:0:44", "4,1:4:0:44", "4,1:4:0:46", // B20 移動 / B21 重力落下(ロールなし) / B22 ロール失敗
];
// SP 台帳: T5..T7 + B1..B22(全ターン -1 = 被弾ゼロ)。
const SP_TRACK = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 75];

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

// カメラ lerp の整定を実測ポーリングで待つ(裏庭でも地表側は負 camY へ lerp する)。
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

// v0.20.0 追随(判断C): クライム(真上への noGravity 移動)廃止に伴い、B1..B22 の
// (10,3)↔(10,2) バウンス上昇分はタップ直前だけ目的セルへ G.placedLadders を transient
// 注入→タップ直後に撤去する(verify-mineroad-dig8.mjs/verify-mineroad-water.mjs と同じ手段。
// 残すと次の下降タップで着地セルの重力が無効化されたままになり後続の位置トレースが狂う)。
// この 1 手 1 マスの移動そのものは旧クライムと物理的に等価(SP 消費/ターン進行は不変)なので、
// S41_TRACK/SP_TRACK 等の既存リテラルは実機再走で無傷一致を確認できたため据え置き(下記参照)。
async function climbUp(page) {
  const target = await page.evaluate(() => ({ c: G.px, r: G.py - 1 }));
  await page.evaluate(([c, r]) => { G.placedLadders.add(c + "," + r); }, [target.c, target.r]);
  const t = await tapTileOffset(page, 0, -1);
  await page.evaluate(([c, r]) => { G.placedLadders.delete(c + "," + r); }, [target.c, target.r]);
  return t;
}

// AI 機構スナップショット。s41 = spawn(4,1) SPIDER、den = spawn(10,5) SPIDER。
const snap = (page, full) =>
  page.evaluate((full) => {
    const byspawn = (c, r) => G.monsters.find((m) => m.spawnCol === c && m.spawnRow === r);
    const brief = (m) => (m ? `${m.col},${m.row}:${m.sp}:${m.sleeping ? 1 : 0}:${m.rc}` : "gone");
    return {
      px: G.px, py: G.py, hp: G.hp, sp: G.stamina,
      n: G.monsters.length,
      nb: G.monsters.filter((m) => m.buried).length,
      s41: brief(byspawn(4, 1)),
      s41hp: byspawn(4, 1) ? byspawn(4, 1).hp : -1,
      den: brief(byspawn(10, 5)),
      mon: full
        ? G.monsters.map((m) => `${m.key}@${m.col},${m.row}:${m.hp}:${m.buried ? 1 : 0}:${m.sp}:${m.sleeping ? 1 : 0}:${m.rc}`).sort().join("|")
        : undefined,
      dug: full ? [...G.dug].sort().join("|") : undefined,
    };
  }, !!full);

const hintText = (page) =>
  page.evaluate(() => (document.getElementById("hud-hint").hidden ? "" : document.getElementById("hud-hint").textContent));
const popupText = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".popup")].map((p) => p.textContent).join(","));

// セル矩形(1 タイル)の canvas 実ピクセル RGBA 配列(DPR 換算・実 camY 反映)。
const cellPixels = (page, col, row) =>
  page.evaluate(([col, row]) => {
    const cv = document.getElementById("scene");
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const cam = window.__camY || 0;
    const x = Math.round(col * tile * dpr);
    const y = Math.round((row - cam) * tile * dpr);
    const w = Math.round(tile * dpr);
    return Array.from(cv.getContext("2d").getImageData(x, y, w, w).data);
  }, [col, row]);
const pixCount = (a, b, th = 24) => {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > th) n++;
  }
  return n;
};

// ============================================================================
// メインシナリオ(実タップ経路、state 注入 0 件)。fail 記録は run 1 のみ(check)、run 2/3 は決定論照合用。
// ============================================================================
async function runScenario(recording) {
  const ck = recording ? check : () => {};
  const { ctx, page, errors } = await openMineroad(412, 915);
  const trace = [];
  const rec = async (step, full) => {
    const s = await snap(page, full);
    trace.push({ step, ...s });
    return s;
  };

  // ---- A1 タイトル(版数)→ダイブ → 初期配置 ----
  const ver = await page.evaluate(() => {
    const el = document.getElementById("ov-version");
    return el ? el.textContent : "";
  });
  ck("A1 タイトルに v0.20.0 表示(機械追随)", ver.includes("v0.20.0"), ver);
  const dive = await startDive(page);
  ck("A1 ダンジョン選択タップ(最前面)→dive", dive.ok && dive.t.front, dive);
  await camSettle(page);
  const s0 = await rec("start", true);
  ck("A1 初期配置リテラル一致(24 体・埋没 17・全個体 sp 満タン/rc0/tk0)", s0.mon === MON_START,
    { n: s0.n, nb: s0.nb });
  ck("A1 開始 state(7,0)/HP30/SP100/dug 空", s0.px === 7 && s0.py === 0 && s0.hp === 30 && s0.sp === 100 && s0.dug === "",
    { pos: `${s0.px},${s0.py}` });

  // ---- 地表歩行 (7,0)→(4,0): resolveTurn なし = 埋没 17 のまま(tick が走らない) ----
  for (const i of [1, 2, 3]) {
    const t = await tapTileOffset(page, -1, 0);
    if (!t.front) ck(`地表歩行#${i} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sW = await rec("walk-4,0", true);
  ck("A1 地表歩行後 (4,0)・SP100・埋没 17/mon 完全不変(地表歩行では tick が走らない)",
    sW.px === 4 && sW.py === 0 && sW.sp === 100 && sW.nb === 17 && sW.mon === MON_START,
    { pos: `${sW.px},${sW.py}`, nb: sW.nb });

  // ---- A2/A3 T1: (4,1) 掘り当て → 一斉脱出 + 隣接反撃(self100) ----
  let t = await tapTileOffset(page, 0, 1);
  ck("T1 掘り当てタップ 最前面=scene", t.front, t);
  const pops1 = await popupText(page);
  const hint1 = await hintText(page);
  const s1 = await rec("T1", true);
  ck("T1 A2 一斉脱出: bury100 種 13 体 + escBt1 の SLIME2 体が同時脱出(dug 16 マスリテラル一致)",
    s1.dug === DUG_T1, { dug: s1.dug });
  ck("T1 A2 mon 全リテラル一致(脱出個体 hp-1・掘り当て(4,1)は hp6 無傷・WORM は tk1%3≠0 でロールなし)",
    s1.mon === MON_T1, { nb: s1.nb });
  ck("T1 A2 残る埋没は SLIME@2,8(hp14/bt1)のみ = 距離 8 の個体が tick された(旧 wake4 なら凍結)= 活動箱 16 実効",
    s1.nb === 1 && s1.mon.includes("SLIME@2,8:14:1"), { nb: s1.nb });
  ck("T1 A3 隣接反撃: SP 100-1(掘り)-2(SPIDER self100)=97・HP30 無傷",
    s1.sp === 97 && s1.hp === 30, { sp: s1.sp });
  ck("T1 演出: popup 蛛 + -2、ヒント「飛び出した」",
    pops1.includes("蛛") && pops1.includes("-2") && hint1.includes("飛び出した"), { pops: pops1, hint: hint1 });

  // ---- T2..T4: bump 攻撃 3 回(毎ターン反撃 -2 = 隣接 100% の実測)。hp3 で生かす ----
  const expHp = [5, 4, 3];
  const expSp = [94, 91, 88];
  for (let i = 0; i < 3; i++) {
    t = await tapTileOffset(page, 0, 1);
    if (!t.front) ck(`T${2 + i} 攻撃タップ 最前面=scene`, false, t);
    const s = await rec(`T${2 + i}`, i === 2);
    if (s.s41hp !== expHp[i] || s.sp !== expSp[i])
      ck(`T${2 + i} A3 毎ターン被弾 hp=${expHp[i]}/SP=${expSp[i]}`, false, { hp: s.s41hp, sp: s.sp });
  }
  const s4 = trace[trace.length - 1];
  ck("T2 A2 SLIME@2,8 が事前導出 escBt=2 ちょうどで脱出(T4 時点 hp13・dug に 2,8)",
    s4.mon === MON_T4 && s4.dug === DUG_T4 && s4.nb === 0, { nb: s4.nb });
  ck("T4 A3 4 ターン連続反撃の合計: SP88(=100-4 行動-8 反撃)・HP30・s41 hp3 で生存",
    s4.sp === 88 && s4.hp === 30 && s4.s41hp === 3, { sp: s4.sp, s41hp: s4.s41hp });

  // ---- 地表歩行 (4,0)→(10,0): ターンなし(s41 不変)+ 地表全回復 ----
  for (const i of [1, 2, 3, 4, 5, 6]) {
    t = await tapTileOffset(page, 1, 0);
    if (!t.front) ck(`地表歩行→10,0#${i} 最前面=scene`, false, t);
  }
  await camSettle(page);
  const sW2 = await rec("walk-10,0");
  ck("A1/A3 (10,0) 到達・SP100(地表回復)・s41 不変(歩行中はターンが進まない)",
    sW2.px === 10 && sW2.py === 0 && sW2.sp === 100 && sW2.s41 === "4,1:5:0:4",
    { pos: `${sW2.px},${sW2.py}`, s41: sW2.s41 });

  // ---- A3/A4/A5 T5..T7 シャフト掘り + B1..B22 バウンス(隣接から外れて 25 ターン) ----
  // s41 トラック・SP 台帳・n=24 不変を毎ターン照合。クリップは B16/B17/B18/B19 で採取。
  let trackNg = 0, spNg = 0, nNg = 0, denMoved = 0;
  const clips = {};
  const s41Positions = [];
  for (let i = 0; i < 25; i++) {
    // T5..T7 = 下掘り(前進)、B1.. = (10,3)↔(10,2) クライム/降下交互。
    const dr = i < 3 ? 1 : (i - 3) % 2 === 0 ? -1 : 1;
    t = dr === -1 ? await climbUp(page) : await tapTileOffset(page, 0, dr);
    if (!t.front) ck(`turn#${i + 1} 最前面=scene`, false, t);
    const bn = i - 2; // B 番号(1..22)。i=0..2 は T5..T7。
    const full = bn === 10 || bn === 22;
    const s = await rec(i < 3 ? `T${5 + i}` : `B${bn}`, full);
    if (s.s41 !== S41_TRACK[i]) trackNg++;
    if (s.sp !== SP_TRACK[i] || s.hp !== 30) spNg++;
    if (s.n !== 24) nNg++;
    if (s.den !== `10,5:5:0:${8 + 2 * i}`) denMoved++; // den SPIDER: 位置凍結・rc のみ +2/turn(T4 時点 rc6)。
    s41Positions.push(s.s41.split(":")[0]);
    if (bn >= 16 && bn <= 19 && recording) {
      await camSettle(page);
      clips[bn] = await cellPixels(page, 5, 0);
    }
    if (full) {
      if (bn === 10) ck("B10 A6 checkpoint mon/dug リテラル一致(WORM rc5=tk15 の 1/3・SNAKE rc1 固定)",
        s.mon === MON_B10 && s.dug === DUG_B, { nb: s.nb });
      if (bn === 22) ck("B22 A6 checkpoint mon/dug リテラル一致(WORM rc9・den 4 体 gridlock 不動)",
        s.mon === MON_B22 && s.dug === DUG_B, { nb: s.nb });
    }
  }
  ck("A4 s41 徘徊トラック 25 ターン全一致(接近せずランダム徘徊 → 入眠 → 覚醒 → 落下)", trackNg === 0,
    { ng: trackNg, track: s41Positions.join(" ") });
  ck("A3 隣接から外れたら被弾 0: SP が 25 ターンちょうど -1/ターン(99→75)・HP30 不変", spNg === 0, { ng: spNg });
  ck("A6 n=24 全行程不変(despawn 誤発火なし・土中死なし)", nNg === 0, { ng: nNg });
  ck("A6 den SPIDER@10,5 は全行程 位置/SP 凍結・rc のみ前進(開マス 4=個体 4 の gridlock)", denMoved === 0,
    { ng: denMoved });
  // A4 追加: 観測トラックからの構造判定(リテラルと二重だが意図を明示)。
  const dists = trace.filter((s) => /^(T[5-7]|B\d+)$/.test(s.step)).map((s) => {
    const [c, r] = s.s41.split(":")[0].split(",").map(Number);
    return Math.max(Math.abs(c - s.px), Math.abs(r - s.py));
  });
  const cols = s41Positions.map((p) => Number(p.split(",")[0]));
  let reversals = 0;
  let lastDir = 0;
  for (let i = 1; i < cols.length; i++) {
    const d = Math.sign(cols[i] - cols[i - 1]);
    if (d !== 0) {
      if (lastDir !== 0 && d !== lastDir) reversals++;
      lastDir = d;
    }
  }
  ck("A4 寄って来ない: 全 25 ターンで Chebyshev 距離 4 以上(隣接 0 回)+ 徘徊方向の反転 2 回以上",
    Math.min(...dists) >= 4 && reversals >= 2, { minDist: Math.min(...dists), reversals });

  // ---- A5 眠り z 描画のピクセル diff(recording run のみ。しきい値はヘッダ記載の初回実測基準) ----
  if (recording) {
    const stab = clips[16] && clips[18] ? pixCount(clips[16], clips[18]) : -1;
    const zdiff = clips[17] && clips[19] ? pixCount(clips[17], clips[19]) : -1;
    ck("A5 眠り z 安定性: B16vsB18(両眠り・同プレイヤー行・camSettle 後)diff<=8", stab >= 0 && stab <= 8,
      { diffpx: stab });
    ck("A5 眠り z 描画: B17vsB19(眠りvs覚醒・同プレイヤー行・s41 同セル)diff>=5", zdiff >= 5,
      { diffpx: zdiff });
  }

  // ---- pageerror 0(シナリオ全体) ----
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  ck("シナリオ pageerror 0", pe.length === 0, pe);

  await ctx.close();
  return trace;
}

// ============================================================================
// 実行
// ============================================================================
console.log("== マインロード v0.18.0 モンスター AI/活動範囲 独立検証(verify-mineroad-ai) ==");
console.log(`BASE=${BASE}`);

console.log("\n-- A1〜A6 メインシナリオ(実タップ経路 run 1) --");
const trace1 = await runScenario(true);

// A7 決定論: fresh コンテキスト計 3 run で全ターントレース照合。
console.log("\n-- A7 決定論(同一操作列 run 2 / run 3 → トレース照合) --");
const trace2 = await runScenario(false);
const trace3 = await runScenario(false);
const t1s = JSON.stringify(trace1);
const t2s = JSON.stringify(trace2);
const t3s = JSON.stringify(trace3);
check("A7 fresh 3 run で全スナップショット完全一致(徘徊・攻撃・睡眠・SP 台帳)",
  t1s === t2s && t2s === t3s, { steps: trace1.length, r12: t1s === t2s, r23: t2s === t3s });
if (t1s !== t2s || t2s !== t3s) {
  for (let i = 0; i < trace1.length; i++) {
    if (JSON.stringify(trace1[i]) !== JSON.stringify(trace2[i]) || JSON.stringify(trace2[i]) !== JSON.stringify(trace3[i])) {
      log("A7 初回不一致", { run1: trace1[i], run2: trace2[i], run3: trace3[i] });
      break;
    }
  }
}

// A8a 既存作回帰(同一サーバで全 URL 200)。
console.log("\n-- A8a 既存作回帰(URL 200) --");
for (const path of ["/", "/tomoshibi/", "/nagori/", "/akari/", "/mineroad/", "/healthz"]) {
  const res = await fetch(`${BASE}${path}`);
  check(`A8a ${path} 200`, res.status === 200, res.status);
}

// A8b 短高 viewport(モバイル Chrome ツールバー表示相当)。headless は実ツールバーの svh 挙動を
// 完全再現できない(svh=vh=innerHeight)ため、innerHeight 内配置 + タップ機能で担保する。
console.log("\n-- A8b 短高 viewport 412x680 / 412x730 --");
for (const vh of [680, 730]) {
  const { ctx, page, errors } = await openMineroad(412, vh);
  const btnBox = await page.evaluate(() => {
    const el = document.querySelector(".dungeon-btn:not([disabled])");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), ih: window.innerHeight };
  });
  check(`A8b ${vh} タイトル: ダンジョンボタン in-view`, !!btnBox && btnBox.t >= 0 && btnBox.b <= btnBox.ih, btnBox);
  const dive = await startDive(page);
  check(`A8b ${vh} タイトル: ボタンタップ機能(dive 遷移)`, dive.ok && dive.t.front, dive);
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
  check(`A8b ${vh} dive: 必須ボタン ${btns.length} 個 in-view + ヒット可`, btnRep.length === 0, btnRep);
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
  check(`A8b ${vh} dive: UI はみ出し 0`, overflow.length === 0, overflow.slice(0, 5));
  const pe = errors.filter((e) => !e.includes("net::ERR_") && !e.includes("favicon"));
  check(`A8b ${vh} pageerror 0`, pe.length === 0, pe);
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
