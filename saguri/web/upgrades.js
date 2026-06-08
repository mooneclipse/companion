"use strict";
// さぐり — 強化リスト — verbatim 静的データ(lead 確定、implementer は数値テーブルを
// 埋めるだけで創作・改変しない)。
//
// 地表基地のショップ式・買い切り・全可視(ともる v1.1.1 のショップ式踏襲、あかり 3 択ガチャ
// でない)。通貨 = 救出ポイント(女の子を地表へ導くと貯まる)。各強化は 1 回だけ買える。
//
// 浅場ピストン無効化(§4・接ぎ木): 強化を **深度ティアでゲート** する。
//   tier "near"  = 浅層救出(浅い層の女の子を救う)で解放される序盤強化。最初から購入可。
//   tier "mid"   = 中層以深(row>=MID_TIER_DEPTH)の女の子を 1 人以上救うと解放。
//   tier "deep"  = 深層(row>=DEEP_TIER_DEPTH)の女の子を 1 人以上救うと解放。
//   → 浅場の女の子だけ救っても序盤強化止まり。深層を救うと上位が解放される。
//
// 各強化(UPGRADE):
//   id      一意キー。
//   tier    "near" / "mid" / "deep"(ゲート判定に使う)。
//   name    表示名(全角 12 字上限・アイコン+数値主体)。
//   desc    効果を数値で明示(全角 12 字上限)。
//   cost    救出ポイント(数値)。
//   apply   G.upg(永続強化の累積)へ反映する効果(app.js が解釈)。
//           staminaMaxAdd / senseResAdd / digSpeedAdd / tool。
//
// 道具(tool)強化は所持フラグ。ラン中に効く:
//   "ladder"  = ハシゴ。1 ラン 1 回、その場から地表方向へ数マス上がる(撤退の保険)。
//   "support" = 支え木。落盤を 1 個だけ自動で止める(1 ラン 1 回)。
//   "sensor"  = センサ。周囲の不安定岩を一時的に可視化(1 ラン数回)。

const UPGRADES = [
  // ---- near ティア(浅層救出で解放・最初から購入可) ----
  {
    id: "near_stamina",
    tier: "near",
    name: "体力＋",
    desc: "力の上限 ＋20",
    cost: 2,
    apply: { staminaMaxAdd: 20 },
  },
  {
    id: "near_sense",
    tier: "near",
    name: "気配＋",
    desc: "気配の解像度 ＋１",
    cost: 3,
    apply: { senseResAdd: 1 },
  },
  // ---- mid ティア(中層以深の救出で解放) ----
  {
    id: "mid_digspeed",
    tier: "mid",
    name: "掘削速度＋",
    desc: "硬岩が１手 速い",
    cost: 4,
    apply: { digSpeedAdd: 1 },
  },
  {
    id: "mid_sensor",
    tier: "mid",
    name: "センサ",
    desc: "周囲の落盤を一時可視",
    cost: 5,
    apply: { tool: "sensor" },
  },
  {
    id: "mid_stamina",
    tier: "mid",
    name: "体力 大＋",
    desc: "力の上限 ＋40",
    cost: 6,
    apply: { staminaMaxAdd: 40 },
  },
  // ---- deep ティア(深層の救出で解放) ----
  {
    id: "deep_support",
    tier: "deep",
    name: "支え木",
    desc: "落盤を１個 止める",
    cost: 6,
    apply: { tool: "support" },
  },
  {
    id: "deep_ladder",
    tier: "deep",
    name: "ハシゴ",
    desc: "地表へ数マス 上がる",
    cost: 7,
    apply: { tool: "ladder" },
  },
  {
    id: "deep_sense",
    tier: "deep",
    name: "気配 大＋",
    desc: "気配の解像度 ＋２",
    cost: 8,
    apply: { senseResAdd: 2 },
  },
];

// ティア解放判定: これまでの救出の最深 row(rescuedDeepest)で上位ティアを開く。
//   near : 常に可。
//   mid  : 中層以深(row >= MID_TIER_DEPTH)の女の子を救ったことがある。
//   deep : 深層(row >= DEEP_TIER_DEPTH)の女の子を救ったことがある。
function upgradeUnlocked(u, rescuedDeepest) {
  const C = (typeof window !== "undefined" && window.CONST) || { MID_TIER_DEPTH: 10, DEEP_TIER_DEPTH: 20 };
  if (u.tier === "near") return true;
  if (u.tier === "mid") return rescuedDeepest >= C.MID_TIER_DEPTH;
  if (u.tier === "deep") return rescuedDeepest >= C.DEEP_TIER_DEPTH;
  return false;
}

// 救出ポイント在庫で支払えるか。
function canAfford(u, points) {
  return points >= u.cost;
}

if (typeof window !== "undefined") {
  window.UPGRADES = UPGRADES;
  window.upgradeUnlocked = upgradeUnlocked;
  window.upgradeCanAfford = canAfford;
}
