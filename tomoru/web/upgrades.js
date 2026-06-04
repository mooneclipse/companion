"use strict";
// ともる — 強化ツリー — verbatim 静的データ(lead 確定、implementer は創作・改変しない)。
//
// v1.1.0: 「3択ガチャ」を廃し、地表の基地ショップで全強化を一覧 → 在庫が足りる強化を
// タップで購入する「買い切り」式に作り直した。各強化は 1 回だけ買える(buyOnce)。
//
// 浅場ピストン無効化(critic 罠 a の対処): 強化は鉱石ティアでゲートする。
//   tier "iron"   = 鉄で買える序盤強化。最初から購入可。**2 個だけ**に絞り、買い切ると
//                   鉄が余っても使い道が無い = 入口で鉄を貯め続ける動機を消す。
//   tier "cryst"  = 結晶を 1 個以上持っていないと買えない(中盤強化。コストも結晶主体)。
//   tier "core"   = コアを 1 個以上持っていないと買えない(深層強化。コストもコア主体)。
//
// 各強化(UPGRADE):
//   id       一意キー。
//   tier     "iron" / "cryst" / "core"(ゲート判定に使う)。
//   name     表示名(全角 12 字上限・アイコン+数値主体)。
//   desc     効果を数値で明示(全角 12 字上限)。
//   cost     {iron, cryst, core} 建て(精錬済み在庫から支払う)。
//   apply    G.upg(永続強化倍率/加算)へ反映する効果(app.js が解釈)。
//            primitive: lightMaxAdd / drainMult / lanternRadiusAdd / lanternCostAdd /
//                       visionAdd / digSpeedAdd / oreBonusAdd。
//
// 買い切り(buyOnce): 取得済みは一覧で「取得済み」表示にし再購入させない。

const UPGRADES = [
  // ---- 鉄ティア(序盤、鉄のみ。2 個だけ = 買い切ると鉄の使い道が消える) ----
  {
    id: "iron_lightmax",
    tier: "iron",
    name: "初期灯量＋",
    desc: "灯量 ＋15",
    cost: { iron: 3 },
    apply: { lightMaxAdd: 15 },
  },
  {
    id: "iron_digspeed",
    tier: "iron",
    name: "掘削速度＋",
    desc: "硬い壁が１手 速い",
    cost: { iron: 5 },
    apply: { digSpeedAdd: 1 },
  },
  // ---- 結晶ティア(中盤、結晶所持で解放・結晶コスト主体) ----
  {
    id: "cryst_lanterncost",
    tier: "cryst",
    name: "灯まきが軽い",
    desc: "灯まき 消費−3",
    cost: { cryst: 2 },
    apply: { lanternCostAdd: -3 },
  },
  {
    id: "cryst_lanternradius",
    tier: "cryst",
    name: "灯の照らし＋",
    desc: "灯の照らし ＋１マス",
    cost: { cryst: 4 },
    apply: { lanternRadiusAdd: 1 },
  },
  {
    id: "cryst_drain",
    tier: "cryst",
    name: "灯もち＋",
    desc: "灯量の減り −20％",
    cost: { cryst: 5 },
    apply: { drainMult: 0.8 },
  },
  // ---- コアティア(深層、コア所持で解放・コアコスト主体) ----
  {
    id: "core_vision",
    tier: "core",
    name: "視界＋",
    desc: "視界 ＋１マス",
    cost: { core: 2 },
    apply: { visionAdd: 1 },
  },
  {
    id: "core_lightmax",
    tier: "core",
    name: "灯量 大＋",
    desc: "灯量 ＋30",
    cost: { core: 3 },
    apply: { lightMaxAdd: 30 },
  },
  {
    id: "core_orebonus",
    tier: "core",
    name: "目利き＋",
    desc: "高品位 ＋12％",
    cost: { core: 4 },
    apply: { oreBonusAdd: 0.12 },
  },
];

// ティア解放判定: 在庫(精錬済み)に応じて買える強化を絞る。
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
