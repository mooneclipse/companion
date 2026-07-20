// v0.14.0 アイテム拡充 + アンテナ保険 自己動作確認(implementer 用、playtester とは別)。
// 判断A(鉱石6種名寄せ)/判断B(45種カタログ+開いた取得経路)/判断C(アンテナ設置型+電波網+保険)/
// 判断D(検証要件)を実プレイ経路(act/startDive/checkFail 等の内部関数直叩き)で確認する。
// 本番ポート 47825 には一切触れない。決定論(同一操作列で3回連続一致)も検証する。
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEBROOT = "/home/miho/companion/games/mineroad/web";
const PORT = 47875; // 本番(47825)・playtester(47860)・grow(47871)・companion(47873)・save(47874) と非衝突。
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: "block" });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("mineroad_seen_howto", "1");
    localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
    localStorage.removeItem("mineroad_progress");
    localStorage.removeItem("mineroad_antennas_0"); localStorage.removeItem("mineroad_insurance_0");
  } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + JSON.stringify(detail) : "")); };

await page.goto(`http://127.0.0.1:${PORT}/mineroad/`, { waitUntil: "networkidle" });

const ver = await page.evaluate(() => (typeof VERSION !== "undefined" ? VERSION : null));
check("VERSION = v0.20.0", ver === "v0.20.0", { ver }); // v0.20.0 実機 FB の原作合わせ(STATUS v0.20.0)へ機械追随。

// ============================================================================
// 1. 45種カタログ整合(item.csv verbatim 書き起こし)
// ============================================================================
console.log("\n== 1. 45種カタログ整合 ==");

const cat = await page.evaluate(() => {
  const ids = ITEM_DATA.map((i) => i.id);
  const uniqueIds = new Set(ids).size;
  return {
    len: ITEM_DATA.length,
    minId: Math.min(...ids), maxId: Math.max(...ids), uniqueIds,
    openCount: ITEM_DATA.filter((i) => i.open).length,
    deadCount: ITEM_DATA.filter((i) => !i.open).length,
    hasFruit: !!ITEM_DATA.find((i) => i.name === "フルーツ" && i.hp === 25 && i.sp === 200),
    hasRoast: !!ITEM_DATA.find((i) => i.name === "焼き肉" && i.hp === 40 && i.sp === 500),
    hasBlood: !!ITEM_DATA.find((i) => i.name === "動物の血" && i.hp === 30 && i.sp === 50),
    hasRawMeat: !!ITEM_DATA.find((i) => i.name === "生肉" && i.hp === 0 && i.sp === 250),
    hasDreamMush: !!ITEM_DATA.find((i) => i.name === "夢キノコ" && i.hp === 10 && i.sp === 100),
    hasAntenna: !!ITEM_DATA.find((i) => i.name === "アンテナ" && i.open === true),
    hasBomb: !!ITEM_DATA.find((i) => i.name === "爆弾" && i.open === false),
  };
});
check("1a ITEM_DATA 45件・ID1-45重複なし", cat.len === 45 && cat.minId === 1 && cat.maxId === 45 && cat.uniqueIds === 45, cat);
check("1b open+dead = 45件", cat.openCount + cat.deadCount === 45, cat);
check("1c open種 20件(判断B)", cat.openCount === 20, cat);
check("1d 飲食4種の HP/SP verbatim(フルーツ/焼き肉/動物の血/生肉)", cat.hasFruit && cat.hasRoast && cat.hasBlood && cat.hasRawMeat, cat);
check("1e 夢キノコ verbatim・アンテナ open・爆弾 dead(判断B非陳列方針)", cat.hasDreamMush && cat.hasAntenna && cat.hasBomb, cat);

// ============================================================================
// 2. 飲食(食べる)の HP 回復 verbatim・HP_MAX 頭打ち
// ============================================================================
console.log("\n== 2. 飲食の HP 回復 ==");

const eat = await page.evaluate(() => {
  startDive();
  G.monsters = []; G.spawned = new Set();
  const o = {};
  // フルーツ(既存・回帰確認)。
  G.hp = 5; G.fruits = 1;
  o.fruit = useFruit() === true && G.hp === Math.min(effHpMax(), 5 + CONST.FRUIT_HEAL) && G.fruits === 0;
  // 夢キノコ(既存・回帰確認)。
  G.hp = 5; G.dreamMushrooms = 1;
  o.dream = useDreamMushroom() === true && G.hp === Math.min(effHpMax(), 5 + CONST.DREAM_HEAL) && G.dreamMushrooms === 0;
  // 焼き肉(v0.14.0 新規)。
  G.hp = 5; G.roastMeat = 1;
  o.roast = useRoastMeat() === true && G.hp === Math.min(effHpMax(), 5 + CONST.ROAST_HEAL) && G.roastMeat === 0;
  // 動物の血(v0.14.0 新規、G.drops 経由)。
  G.hp = 5; G.drops["動物の血"] = 1;
  o.blood = useBlood() === true && G.hp === Math.min(effHpMax(), 5 + CONST.BLOOD_HEAL) && G.drops["動物の血"] === 0;
  // 満タン時は使用不可(所持は減らない)。
  G.hp = effHpMax(); G.roastMeat = 1;
  o.satiatedBlocked = useRoastMeat() === false && G.roastMeat === 1;
  // 所持0なら使用不可。
  G.roastMeat = 0; G.hp = 5;
  o.emptyBlocked = useRoastMeat() === false;
  return o;
});
check("2a フルーツ HP回復+頭打ち(既存回帰)", eat.fruit, eat);
check("2b 夢キノコ HP回復+頭打ち(既存回帰)", eat.dream, eat);
check("2c 焼き肉 HP回復+頭打ち(v0.14.0新規)", eat.roast, eat);
check("2d 動物の血 HP回復(G.drops経由、v0.14.0新規)", eat.blood, eat);
check("2e 満タン時は使用不可・所持減らない", eat.satiatedBlocked, eat);
check("2f 所持0は使用不可", eat.emptyBlocked, eat);

// ============================================================================
// 3. 生肉のマグマ変化(生肉→焼き肉、決定論・状態遷移のみ)
// ============================================================================
console.log("\n== 3. 生肉のマグマ変化 ==");

const cook = await page.evaluate(() => {
  startDive();
  G.monsters = []; G.spawned = new Set();
  G.drops["生肉"] = 3; G.roastMeat = 0;
  const before = { meat: G.drops["生肉"], roast: G.roastMeat };
  cookMeatInMagma(); // マグマ中の1行動を模擬。
  const after1 = { meat: G.drops["生肉"], roast: G.roastMeat };
  cookMeatInMagma();
  const after2 = { meat: G.drops["生肉"], roast: G.roastMeat };
  // 生肉0なら変化しない。
  G.drops["生肉"] = 0;
  cookMeatInMagma();
  const noMeat = { meat: G.drops["生肉"], roast: G.roastMeat };
  return { before, after1, after2, noMeat };
});
check("3a マグマ中1行動で生肉-1焼き肉+1", cook.after1.meat === 2 && cook.after1.roast === 1, cook);
check("3b 連続変化(2回で生肉-2焼き肉+2)", cook.after2.meat === 1 && cook.after2.roast === 2, cook);
check("3c 生肉0なら変化しない", cook.noMeat.meat === 0 && cook.noMeat.roast === 2, cook);

// ============================================================================
// 4. 名寄せ後クラフト(craft.csv 実レシピ、6種鉱石+G.drops骨)
// ============================================================================
console.log("\n== 4. 名寄せ後クラフト ==");

const craft = await page.evaluate(() => {
  const o = {};
  startDive();
  G.monsters = []; G.spawned = new Set();
  // 石のツルハシ ← 石炭3(翻案・単一素材)。
  G.ore.COAL = 3;
  o.stone = doCraft(CRAFT_RECIPES.find((r) => r.id === "pick_stone")) === true && G.pick === "STONE" && G.ore.COAL === 0;
  // 鉄のツルハシ ← 鋼2+骨1+石炭1(craft.csv verbatim)。
  G.ore.STEEL = 2; G.ore.COAL = 1; G.drops["骨"] = 1;
  o.iron = doCraft(CRAFT_RECIPES.find((r) => r.id === "pick_iron")) === true && G.pick === "IRON" &&
    G.ore.STEEL === 0 && G.ore.COAL === 0 && G.drops["骨"] === 0;
  // 材料不足なら実行不可(state 不変)。
  const before = { steel: G.ore.STEEL, coal: G.ore.COAL };
  o.shortBlocked = doCraft(CRAFT_RECIPES.find((r) => r.id === "pick_diamond")) === false &&
    G.ore.STEEL === before.steel && G.ore.COAL === before.coal;
  // ダイヤのツルハシ ← 鋼4+化石2+ダイヤ1+骨2(翻案・鉄段2倍スケール)。
  G.ore.STEEL = 4; G.ore.FOSSIL = 2; G.ore.DIAMOND = 1; G.drops["骨"] = 2;
  o.diamond = doCraft(CRAFT_RECIPES.find((r) => r.id === "pick_diamond")) === true && G.pick === "DIAMOND";
  // はしご ← 鉄鉱石1+石炭1+骨2(craft.csv verbatim)。
  G.ore.IRON_ORE = 1; G.ore.COAL = 1; G.drops["骨"] = 2; G.ladders = 0;
  o.ladder = doCraft(CRAFT_RECIPES.find((r) => r.id === "ladder")) === true && G.ladders === 1;
  // アンテナ ← 鉄鉱石3+鋼2+化石1(craft.csv verbatim)。
  G.ore.IRON_ORE = 3; G.ore.STEEL = 2; G.ore.FOSSIL = 1; G.antennaItems = 0;
  o.antenna = doCraft(CRAFT_RECIPES.find((r) => r.id === "antenna")) === true && G.antennaItems === 1;
  return o;
});
check("4a 石のツルハシ(石炭3)", craft.stone, craft);
check("4b 鉄のツルハシ(鋼2+骨1+石炭1 verbatim)", craft.iron, craft);
check("4c 材料不足で実行不可・state不変", craft.shortBlocked, craft);
check("4d ダイヤのツルハシ(鋼4+化石2+ダイヤ1+骨2)", craft.diamond, craft);
check("4e はしご(鉄鉱石1+石炭1+骨2 verbatim)", craft.ladder, craft);
check("4f アンテナ(鉄鉱石3+鋼2+化石1 verbatim、所持数+1)", craft.antenna, craft);

// ============================================================================
// 5. 名寄せ後 商人(shop.csv、焼き肉追加)
// ============================================================================
console.log("\n== 5. 名寄せ後 商人 ==");

const shop = await page.evaluate(() => {
  const o = {};
  startDive();
  G.monsters = []; G.spawned = new Set();
  G.ore.IRON_ORE = 2; G.fruits = 0;
  o.fruit = doShopTrade(SHOP_RECIPES.find((r) => r.id === "shop_fruit")) === true && G.fruits === 1 && G.ore.IRON_ORE === 0;
  G.ore.STEEL = 2; G.roastMeat = 0;
  o.roast = doShopTrade(SHOP_RECIPES.find((r) => r.id === "shop_roast")) === true && G.roastMeat === 1 && G.ore.STEEL === 0;
  o.recipeCount = SHOP_RECIPES.length;
  return o;
});
check("5a フルーツ(鉄鉱石2)既存回帰", shop.fruit, shop);
check("5b 焼き肉(鋼2 verbatim、v0.14.0新規)", shop.roast, shop);
check("5c SHOP_RECIPES 5行(フルーツ/焼き肉/ツルハシ/アンテナ/夢キノコ)", shop.recipeCount === 5, shop);

// ============================================================================
// 6. アンテナ設置・上限20・電波網の連結圏判定
// ============================================================================
console.log("\n== 6. アンテナ設置・上限・電波網 ==");

const antenna = await page.evaluate(() => {
  const o = {};
  startDive();
  G.monsters = []; G.spawned = new Set();
  // 地表基礎範囲(row<=ANTENNA_R0)は常に圏内。
  o.r0 = CONST.ANTENNA_R0;
  o.surfaceCovered = inRadioCoverage(G.px, 0) === true && inRadioCoverage(G.px, CONST.ANTENNA_R0) === true;
  o.beyondR0Uncovered = inRadioCoverage(G.px, CONST.ANTENNA_R0 + 5) === false; // 未設置なら圏外。
  // 設置(所持1個消費、isSpace かつ地中でのみ)。
  G.antennaItems = 2;
  G.dug.add(G.px + "," + (G.py + 1));
  moveTo(G.px, G.py + 1, true, true); // 電波網の外(深いところ)へ移動。
  while (G.py <= CONST.ANTENNA_R0) { G.dug.add(G.px + "," + (G.py + 1)); moveTo(G.px, G.py + 1, true, true); }
  const deepCol = G.px, deepRow = G.py;
  o.uncoveredBeforePlace = inRadioCoverage(deepCol, deepRow) === false;
  o.placed = placeAntenna() === true && G.antennaItems === 1 && G.placedAntennas.has(deepCol + "," + deepRow);
  o.coveredAfterPlace = inRadioCoverage(deepCol, deepRow) === true; // アンテナ直下は自身の中継半径内。
  // 回収で所持へ戻る。
  o.recovered = recoverAntenna() === true && G.antennaItems === 2 && !G.placedAntennas.has(deepCol + "," + deepRow);
  // 上限20: 直接 size を注入して上限判定のみ検証(離れた20マスを実際に掘るのは非現実的なため)。
  G.placedAntennas = new Set(Array.from({ length: 20 }, (_, i) => `${i},${deepRow}`));
  G.antennaItems = 5;
  o.capBlocked = placeAntenna() === false && G.placedAntennas.size === 20 && G.antennaItems === 5;
  return o;
});
check("6a 地表基礎範囲(ANTENNA_R0)は常に電波圏内", antenna.surfaceCovered, antenna);
check("6b 基礎範囲外・アンテナ未設置は圏外", antenna.beyondR0Uncovered && antenna.uncoveredBeforePlace, antenna);
check("6c アンテナ設置(所持-1・位置記録)", antenna.placed, antenna);
check("6d 設置直後、その地点は電波圏内へ", antenna.coveredAfterPlace, antenna);
check("6e アンテナ回収(所持+1・位置消去)", antenna.recovered, antenna);
check("6f 20本上限で設置不可(item.csv §8 verbatim)", antenna.capBlocked, antenna);

// ============================================================================
// 7. 保険: 電波圏内での力尽きは携行アイテムを1回だけ持ち越す(判断C本丸)
// ============================================================================
console.log("\n== 7. 保険(圏内 fail → 持ち越し) ==");

const insured = await page.evaluate(() => {
  startDive();
  G.monsters = []; G.spawned = new Set();
  G.ore.COAL = 7; G.mushrooms = 4; G.ladders = 1; G.antennaItems = 2; G.pick = "STONE";
  G.py = CONST.ANTENNA_R0; // 地表基礎範囲の最深部(まだ圏内)。地中扱いにするため 1 マス掘る。
  const key = G.px + "," + (G.py + 1);
  G.dug.add(key);
  moveTo(G.px, G.py + 1, true, true); // py = R0+1 だが基礎範囲は <=R0 なので実際は圏外になりうる→R0以内で止める。
  G.py = Math.min(G.py, CONST.ANTENNA_R0); // 明示的に圏内(row<=R0)を保証。
  const covered = inRadioCoverage(G.px, G.py);
  G.hp = 0; G.stamina = 0;
  checkFail();
  const raw = localStorage.getItem("mineroad_insurance_" + G.dungeonId);
  const screenAtFail = G.screen;
  startDive();
  return {
    covered, screenAtFail,
    insuranceRawExisted: !!raw,
    afterCoal: G.ore.COAL, afterMush: G.mushrooms, afterLadders: G.ladders,
    afterAntennaItems: G.antennaItems, afterPick: G.pick,
  };
});
check("7a 圏内(row<=ANTENNA_R0)で力尽き", insured.covered === true && insured.screenAtFail === "fail", insured);
check("7b 保険データが1回ぶん保存された", insured.insuranceRawExisted === true, insured);
check("7c retry で携行アイテムが持ち越される(ore/mushrooms/ladders/antennaItems/pick)",
  insured.afterCoal === 7 && insured.afterMush === 4 && insured.afterLadders === 1 &&
  insured.afterAntennaItems === 2 && insured.afterPick === "STONE", insured);

// 2回目の retry(保険なしで力尽き)では前回の携行アイテムは持ち越されない(1回だけ消費される)。
const insuredOnce = await page.evaluate(() => {
  // 直前の startDive() 済み state(保険を消費した後)で、今度は圏外まで潜ってから力尽きさせる。
  G.ore.COAL = 9; // 何か所持させておく(保険が「二度目も」効くなら誤って持ち越されてしまう)。
  while (G.py <= CONST.ANTENNA_R0) { G.dug.add(G.px + "," + (G.py + 1)); moveTo(G.px, G.py + 1, true, true); }
  const covered = inRadioCoverage(G.px, G.py);
  G.hp = 0; G.stamina = 0;
  checkFail();
  startDive();
  return { covered, coalAfter: G.ore.COAL };
});
check("7d 保険は1回消費(圏外での2度目の fail は持ち越し無し)", insuredOnce.covered === false && insuredOnce.coalAfter === 0, insuredOnce);

// ============================================================================
// 8. 圏外での力尽きは全ロスト(v0.12.0 の既存挙動を保存)
// ============================================================================
console.log("\n== 8. 圏外 fail = 全ロスト回帰 ==");

const lostAll = await page.evaluate(() => {
  startDive();
  G.monsters = []; G.spawned = new Set();
  G.ore.DIAMOND = 5; G.mushrooms = 8; G.roastMeat = 2;
  while (G.py <= CONST.ANTENNA_R0) { G.dug.add(G.px + "," + (G.py + 1)); moveTo(G.px, G.py + 1, true, true); }
  const covered = inRadioCoverage(G.px, G.py);
  const raw0 = localStorage.getItem("mineroad_insurance_" + G.dungeonId);
  G.hp = 0; G.stamina = 0;
  checkFail();
  const raw1 = localStorage.getItem("mineroad_insurance_" + G.dungeonId);
  startDive();
  return { covered, raw0, raw1, diamond: G.ore.DIAMOND, mush: G.mushrooms, roast: G.roastMeat };
});
check("8a 圏外(未設置)での力尽き", lostAll.covered === false, lostAll);
check("8b 保険データは保存されない", lostAll.raw1 === null, lostAll);
check("8c retry で全ロスト(ore/mushrooms/roastMeat が 0)", lostAll.diamond === 0 && lostAll.mush === 0 && lostAll.roast === 0, lostAll);

// ============================================================================
// 9. 設置済みアンテナは fail を無条件で跨ぐ・クリアで消去(判断C)
// ============================================================================
console.log("\n== 9. アンテナ位置の永続(fail 跨ぎ・クリア消去) ==");

const antPersist = await page.evaluate(() => {
  startDive();
  G.monsters = []; G.spawned = new Set();
  G.antennaItems = 1;
  // 地表基礎範囲内(row=1、電波圏内)まで実際に掘り進めてから設置(isSpace を満たす必要がある)。
  G.dug.add(G.px + ",1");
  moveTo(G.px, 1, true, true);
  const placed = placeAntenna();
  const key = G.px + ",1";
  // 圏外まで掘ってから力尽きさせる(保険の有無に関わらずアンテナ位置自体は判断Cで無条件持ち越し対象)。
  while (G.py <= CONST.ANTENNA_R0) { G.dug.add(G.px + "," + (G.py + 1)); moveTo(G.px, G.py + 1, true, true); }
  G.hp = 0; G.stamina = 0;
  checkFail();
  startDive();
  const persistedAfterFail = G.placedAntennas.has(key);
  showClear();
  startDive();
  const clearedAfterClear = !G.placedAntennas.has(key) && G.placedAntennas.size === 0;
  return { placed, persistedAfterFail, clearedAfterClear };
});
check("9a アンテナ設置", antPersist.placed, antPersist);
check("9b fail を無条件で跨いで位置が残る", antPersist.persistedAfterFail === true, antPersist);
check("9c クリアで設置済みアンテナが消去される", antPersist.clearedAfterClear === true, antPersist);

// ============================================================================
// 10. 決定論: 同一操作列で3回連続一致
// ============================================================================
console.log("\n== 10. 決定論 3回連続一致 ==");

const detResults = [];
for (let trial = 0; trial < 3; trial++) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("mineroad_save"); localStorage.removeItem("mineroad_save_0");
      localStorage.removeItem("mineroad_progress"); localStorage.removeItem("mineroad_antennas_0");
      localStorage.removeItem("mineroad_insurance_0");
    } catch (e) {}
  });
  const r = await page.evaluate(() => {
    startDive();
    G.pick = "DIAMOND"; G.monsters = []; G.spawned = new Set();
    // 固定 seed で 8 マス掘り下げ、鉱石/キノコ採取と power ゲートの再現性をまとめて確認。
    for (let i = 0; i < 8; i++) act(0, 1);
    const oreSweep = [];
    for (let c = 0; c < CONST.GRID_COLS; c++) for (let rr = 1; rr <= CONST.DEPTH_ROWS; rr++) oreSweep.push(oreAt(c, rr, CONST.BASE_SEED));
    return { ore: { ...G.ore }, mushrooms: G.mushrooms, py: G.py, oreSweep: oreSweep.join(",") };
  });
  detResults.push(JSON.stringify(r));
}
const detOk = detResults[0] === detResults[1] && detResults[1] === detResults[2];
check("10a 決定論(鉱石/キノコ採取・oreAt 全マス 3回連続一致)", detOk, { match: detOk, sample: (detResults[0] || "").slice(0, 120) });

// ============================================================================
// 11. 非介入: tileType/girlPositions/oreAt(消費経路以外)は不変
// ============================================================================
console.log("\n== 11. 非介入 ==");

const nonIntervention = await page.evaluate(() => {
  startDive();
  const seed = G.seed;
  const gp = girlPositions(seed).map((p) => `${p.col},${p.row}`).join("|");
  const tileSweep = [];
  for (let c = 0; c < CONST.GRID_COLS; c++) for (let r = 1; r <= CONST.DEPTH_ROWS; r++) tileSweep.push(tileType(c, r, seed));
  return { gp, tileSweep: tileSweep.join(",") };
});
const EXPECTED_GIRLS = "11,6|0,8|4,10|3,12|8,14";
check("11a girlPositions verbatim 不変", nonIntervention.gp === EXPECTED_GIRLS, { gp: nonIntervention.gp });

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
