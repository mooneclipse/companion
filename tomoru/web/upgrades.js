"use strict";
// ともる — 強化ツリー — verbatim 静的データ(lead 確定、implementer は創作・改変しない)。
//
// 浅場ピストン無効化(critic 罠 a の対処): 強化は鉱石ティアでゲートする。
//   tier "iron"   = 鉄で買える序盤強化。最初から 3 択に出る。
//   tier "cryst"  = 結晶を 1 個以上持っていないと 3 択に出ない(中盤強化)。
//   tier "core"   = コアを 1 個以上持っていないと 3 択に出ない(深層強化)。
// 浅場往復では鉄しか採れず iron ティアで頭打ち → 深く潜る強制力。
//
// 各強化(UPGRADE):
//   id     一意キー。
//   tier   "iron" / "cryst" / "core"(ゲート判定に使う)。
//   name   表示名(全角 12 字上限・アイコン+数値主体)。
//   desc   効果説明 1 行(全角 12 字上限)。
//   cost   {iron, cryst, core} 建て(精錬済み在庫から支払う)。
//   apply  G.upg(永続強化倍率/加算)へ反映する効果(app.js が解釈)。
//          primitive: lightMaxAdd / drainMult / lanternRadiusAdd / visionAdd /
//                     digSpeedAdd(掘削タップ -1 の累積) / oreBonusAdd(高品位出現+)。
//
// 同じ強化を複数回取れる(累積)。取得済みでも 3 択に出る(伸ばす楽しさ)。

const UPGRADES = [
  // ---- 鉄ティア(序盤、鉄のみで買える) ----
  {
    id: "iron_lightmax",
    tier: "iron",
    name: "初期灯量＋",
    desc: "ダイブ開始の灯＋15",
    cost: { iron: 3 },
    apply: { lightMaxAdd: 15 },
  },
  {
    id: "iron_digspeed",
    tier: "iron",
    name: "掘削速度＋",
    desc: "硬い壁が掘りやすい",
    cost: { iron: 4 },
    apply: { digSpeedAdd: 1 },
  },
  {
    id: "iron_lanterncost",
    tier: "iron",
    name: "灯まきが軽い",
    desc: "灯まきの消費−3",
    cost: { iron: 4 },
    apply: { lanternCostAdd: -3 },
  },
  // ---- 結晶ティア(中盤、結晶所持で解放) ----
  {
    id: "cryst_lanternradius",
    tier: "cryst",
    name: "灯の照らし＋",
    desc: "撒いた灯が広く照らす",
    cost: { iron: 2, cryst: 2 },
    apply: { lanternRadiusAdd: 1 },
  },
  {
    id: "cryst_drain",
    tier: "cryst",
    name: "灯もち＋",
    desc: "灯量の減りを２割減",
    cost: { cryst: 3 },
    apply: { drainMult: 0.8 },
  },
  // ---- コアティア(深層、コア所持で解放) ----
  {
    id: "core_vision",
    tier: "core",
    name: "視界＋",
    desc: "見渡せる範囲が広がる",
    cost: { cryst: 2, core: 2 },
    apply: { visionAdd: 1 },
  },
  {
    id: "core_orebonus",
    tier: "core",
    name: "目利き＋",
    desc: "高品位の鉱石が増える",
    cost: { core: 3 },
    apply: { oreBonusAdd: 0.12 },
  },
];

// ティア解放判定: 在庫(精錬済み)に応じて出せる強化を絞る。
//   iron : 常に可。
//   cryst: 結晶在庫 >= 1。
//   core : コア在庫 >= 1。
function upgradeUnlocked(u, stock) {
  if (u.tier === "iron") return true;
  if (u.tier === "cryst") return (stock.cryst || 0) >= 1;
  if (u.tier === "core") return (stock.core || 0) >= 1;
  return false;
}

// 在庫で支払えるか(コストを満たすか)。
function canAfford(u, stock) {
  for (const k in u.cost) {
    if ((stock[k] || 0) < u.cost[k]) return false;
  }
  return true;
}

if (typeof window !== "undefined") {
  window.UPGRADES = UPGRADES;
  window.upgradeUnlocked = upgradeUnlocked;
  window.upgradeCanAfford = canAfford;
}
