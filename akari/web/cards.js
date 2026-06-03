"use strict";
// あかり カード定義 — verbatim 静的データ(lead 確定、implementer は創作・改変しない)。
//
// 文言は全角 12 字以内・1 行(可読性のため。データ側で語数を制約する)。emoji 不可。
// 種別バッジ: kind = "atk"(攻) / "light"(灯) / "block"(守) / "tech"(技)。
// cost = マナ(灯量)コスト。effects = primitive 配列(app.js のインタプリタが順に適用)。
//
// primitive 一覧(app.js applyEffect と対応):
//   {dmg, scale}        ダメージ。scale = "light"(明攻 0.5+L/100)/"dark"(闇攻 0.5+(100-L)/100)。
//                       集光バフ(nextAtkMult)中ならダメージを ×倍して消費。
//   {light}             LIGHT を delta 増減([0,100] にクランプ)。
//   {block}             プレイヤー block を加算。
//   {blockFromLight}    floor(LIGHT / div) を block に加算。
//   {draw}              n 枚ドロー。
//   {nextAtkMult}       このターンの次の攻カードに ×x。1 回適用で消費。
//   {power, amount}     持続。"perTurnLight" = 戦闘中、各ターン開始時に LIGHT を amount 増。

// 初期デッキ 10 枚(id を重複させて枚数を表現する)。
const STARTER_DECK = [
  { id: "tomoshibi", n: 3 },
  { id: "utsu", n: 4 },
  { id: "mamoru", n: 3 },
];

// 報酬プール 10 種(戦闘後 3 枚提示 → 1 枚加える。各 1 枚ずつデッキに加わる)。
const REWARD_POOL = [
  "homura",
  "ohomura",
  "kageuchi",
  "mushibami",
  "tomoshibidama",
  "zanko",
  "shuko",
  "tomonotate",
  "tomoshimamori",
  "shokudai",
];

// 全カード定義テーブル。id をキーに引く。
const CARDS = {
  // ---- 初期デッキ -------------------------------------------------------
  tomoshibi: {
    id: "tomoshibi",
    name: "ともし火",
    kind: "light",
    cost: 1,
    text: "あかりを +18",
    effects: [{ light: 18 }],
  },
  utsu: {
    id: "utsu",
    name: "打つ",
    kind: "atk",
    cost: 1,
    text: "光ダメージ 6／暗 -6",
    effects: [{ dmg: 6, scale: "light" }, { light: -6 }],
  },
  mamoru: {
    id: "mamoru",
    name: "守る",
    kind: "block",
    cost: 1,
    text: "ブロック +5",
    effects: [{ block: 5 }],
  },
  // ---- 報酬プール -------------------------------------------------------
  homura: {
    id: "homura",
    name: "焔",
    kind: "atk",
    cost: 1,
    text: "光ダメージ10／暗-12",
    effects: [{ dmg: 10, scale: "light" }, { light: -12 }],
  },
  ohomura: {
    id: "ohomura",
    name: "大焔",
    kind: "atk",
    cost: 2,
    text: "光ダメージ22／暗-22",
    effects: [{ dmg: 22, scale: "light" }, { light: -22 }],
  },
  kageuchi: {
    id: "kageuchi",
    name: "影撃ち",
    kind: "atk",
    cost: 1,
    text: "闇ダメージ 9",
    effects: [{ dmg: 9, scale: "dark" }],
  },
  mushibami: {
    id: "mushibami",
    name: "蝕",
    kind: "atk",
    cost: 2,
    text: "闇ダメージ18",
    effects: [{ dmg: 18, scale: "dark" }],
  },
  tomoshibidama: {
    id: "tomoshibidama",
    name: "灯火球",
    kind: "light",
    cost: 1,
    text: "あかりを +32",
    effects: [{ light: 32 }],
  },
  zanko: {
    id: "zanko",
    name: "残光",
    kind: "tech",
    cost: 1,
    text: "2 枚引く",
    effects: [{ draw: 2 }],
  },
  shuko: {
    id: "shuko",
    name: "集光",
    kind: "tech",
    cost: 1,
    text: "次の攻撃 ×2",
    effects: [{ nextAtkMult: 2 }],
  },
  tomonotate: {
    id: "tomonotate",
    name: "灯の盾",
    kind: "block",
    cost: 1,
    text: "ブロック=明/8",
    effects: [{ blockFromLight: 8 }],
  },
  tomoshimamori: {
    id: "tomoshimamori",
    name: "灯し守り",
    kind: "block",
    cost: 1,
    text: "ブロック+6 灯+12",
    effects: [{ block: 6 }, { light: 12 }],
  },
  shokudai: {
    id: "shokudai",
    name: "燭台",
    kind: "tech",
    cost: 1,
    text: "毎ターン 灯+8",
    effects: [{ power: "perTurnLight", amount: 8 }],
  },
};

if (typeof window !== "undefined") {
  window.CARDS = CARDS;
  window.STARTER_DECK = STARTER_DECK;
  window.REWARD_POOL = REWARD_POOL;
}
