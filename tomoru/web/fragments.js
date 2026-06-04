"use strict";
// ともる — PALETTE / 文言 — verbatim 静的データ(lead 確定、implementer は改変しない)。
//
// なごり/みちゆきの色補間を「深度軸 + 灯量による動的明度」へ流用する。
//   PALETTE: 深度帯ごとの背景基調と鉱石の差し色。
//     bg     = その深度帯の地の色(暗い坑)。app.js が深度で隣帯と補間し、
//              さらに自機周囲の視界円(灯量で半径が決まる暖色)を per-tile で重ねる。
//     lantern= 自機/撒いた灯の暖色光(共通)。
//     ore    = その深度帯で採れる鉱石の自発光色。
//   深度: surface 地表 / shallow 浅(鉄) / mid 中(結晶) / deep 深(コア)。

const PALETTE = {
  // 地表 = 夜明け前の藍灰(安全・基地)。自機の灯 = 暖橙。
  surface: { bg: "#2a3550", ore: "#f4b860" },
  // 浅層 = 藍黒。鉄鉱 = 鈍い赤錆の点光。
  shallow: { bg: "#0d1b2a", ore: "#8a4a3a" },
  // 中層 = 紫がかった漆黒。結晶 = 青白自発光。
  mid: { bg: "#1a0f2e", ore: "#7ec8e3" },
  // 深層 = ほぼ純黒。コア = 脈打つ橙金(e0a85c→ffcf8a を時間で脈動)。
  deep: { bg: "#05030a", ore: "#e0a85c" },
  // コア大鉱脈の脈動の明側。
  coreHi: "#ffcf8a",
  // 撒いた灯・自機の灯(共通の暖橙)。
  lantern: "#f4b860",
  // 喰らい闇 = 完全な黒の穴。
  maw: "#000000",
  // 勝利演出(核を持ち帰った地表): 藍灰へ暁の光が差す。
  dawn: "#e7b98a",
};

// テキスト文言(UI ラベル等の verbatim)。emoji 不可。アイコン+数値主体・全角 12 字上限。
const TEXT = {
  title: "ともる",
  start: "タップでもぐる",
  bestDepthPrefix: "最深 ",
  bestDepthSuffix: " 層",
  bestSmeltPrefix: "精錬 ",
  bestSmeltSuffix: "",
  // 基地ショップ(地表帰還時)。v1.1.0: 全強化を一覧 → 在庫が足りるものを買い切り購入。
  upgradeTitle: "基地（強化を買う）",
  upgradeNonePrefix: "鉱石を持ち帰ると強化が買える",
  upgradeSkip: "もぐる",
  shopStockLabel: "在庫",
  shopOwned: "取得済み",
  shopBuy: "購入",
  smeltPopupPrefix: "＋", // 精錬時の「＋N」演出。
  // 失敗(灯が尽きた)。
  failTitle: "灯が、消えた",
  failReachPrefix: "未精錬の鉱石を うしなった",
  retry: "もう一度",
  // 勝利(核を持ち帰った)。
  clearTitle: "暁が、差した",
  clearSub: "核を持ち帰った",
  again: "もっと深く",
  // HUD ラベル。
  depthPrefix: "深度 ",
  depthSuffix: " 層",
  lightCap: "灯",
  returnLabel: "帰路",
  // あそびかた説明(verbatim、実装側で改変しない)。3 行。
  howtoTitle: "あそびかた",
  howto: [
    "となりをタップ／下の十字キー＝掘る。掘ると前に進む。",
    "長押し／灯ボタン＝その場に灯を撒く（消えない目印・帰り道）。",
    "灯のそばは灯量が減りにくい＝深追いの保険。",
    "灯量が尽きる前に地表（上）へ戻る。尽きると鉱石を失う。",
  ],
  howtoStart: "もぐる",
  howtoBack: "もどる",
  howtoButton: "あそびかた",
  // 撤退予告(帰路が灯量を割ったとき)。
  returnWarn: "帰れない",
  // 灯のそば(灯量が減りにくい)状態のヒント。
  lanternSafe: "灯のそば（灯量が減りにくい）",
  // 喰らい闇 cue。
  cueMaw: "闇にのまれた",
  cueMawDispel: "灯で打ち消した",
};

if (typeof window !== "undefined") {
  window.PALETTE = PALETTE;
  window.TEXT = TEXT;
}
