"use strict";
// あかり PALETTE / 文言 — verbatim 静的データ(lead 確定、implementer は改変しない)。
//
// なごりの色補間を 2 軸(戦階層 × LIGHT 明度)へ流用する。
//   FLOOR_THEMES: 戦階層ごとの背景基調。floor 1..6。
//     1-2 戦 = 藍黒 / 3-4 戦 = 紫+琥珀 / 5 戦 = 暁の橙 / ボス = 白金の光。
//   各テーマは {bgDark, bgLight, accent} を持つ:
//     bgDark  = LIGHT 0 側(暗)の背景色。
//     bgLight = LIGHT 100 側(明)の背景色。app.js が LIGHT で bgDark↔bgLight を補間し、
//               さらに自キャラ中心の放射光円を重ねる(明=暖色光彩 / 暗=青黒フェード)。
//     accent  = その階層の差し色(HP バー・intent などのアクセント基準)。

const FLOOR_THEMES = [
  // floor 1: 藍黒
  { bgDark: "#0b0e1a", bgLight: "#2a3358", accent: "#e6b25a" },
  // floor 2: 藍黒(やや深い)
  { bgDark: "#0a0c18", bgLight: "#283054", accent: "#e6b25a" },
  // floor 3: 紫 + 琥珀
  { bgDark: "#140c20", bgLight: "#4a3360", accent: "#d98a3a" },
  // floor 4: 紫 + 琥珀(琥珀寄り)
  { bgDark: "#1a0e1c", bgLight: "#5a3a50", accent: "#e09a3a" },
  // floor 5: 暁の橙
  { bgDark: "#241010", bgLight: "#7a4326", accent: "#f0a850" },
  // floor 6(ボス): 白金の光
  { bgDark: "#1c1a26", bgLight: "#c9c2a8", accent: "#f4e6b0" },
];

// テキスト文言(UI ラベル等の verbatim)。emoji 不可。
const TEXT = {
  title: "あかり",
  start: "タップではじめる",
  bestPrefix: "最高到達 ",
  bestSuffix: " 戦",
  endTurn: "ターン終了",
  reward: "カードを えらぶ",
  rewardSkip: "スキップ（HP+14）",
  defeatTitle: "あかりが、消えた",
  defeatReachPrefix: "到達 ",
  defeatReachSuffix: " 戦",
  retry: "もう一度",
  clearTitle: "闇を、照らしきった",
  clearSub: "到達 6 / 6",
  floorPrefix: "第 ",
  floorSuffix: " 戦",
  bossLabel: "ボス",
};

if (typeof window !== "undefined") {
  window.FLOOR_THEMES = FLOOR_THEMES;
  window.TEXT = TEXT;
}
