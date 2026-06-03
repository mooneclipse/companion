"use strict";
// あかり 敵定義 — verbatim 静的データ(lead 確定、implementer は創作・改変しない)。
//
// intent = 決定論ループ配列。動的 AI は作らない(StS と同じく予測可能性が面白さ)。
// 敵の手番ごとに intent[turnIndex % intent.length] を実行し、次の intent を頭上に予告表示する。
//
// intent primitive(app.js enemyAct と対応):
//   {type:"A", n}        攻撃 n(takenMult 適用、player block で減算)。
//   {type:"Guard", n}    自分に block n(その間プレイヤー攻撃を吸収)。
//   {type:"Dim", n}      プレイヤー LIGHT を n 減らす。
//   {type:"Charge"}      次手番まで予告(次が大攻撃)。この手番自体は何もしない。
//   複合手番は配列で表現する(例: Dim してから A する 1 手番)。
//
// 1 ラン 6 戦の順(floor 1..6、6 = ボス)。
// hp は 1 体あたり。units = 同時に出る体数(各体が同じ intent ループを independent に回す)。

const ENEMIES = [
  // 1. 火の粉
  {
    id: "hinoko",
    name: "火の粉",
    hp: 18,
    units: 1,
    boss: false,
    intent: [[{ type: "A", n: 5 }], [{ type: "A", n: 8 }]],
  },
  // 2. 蛾
  {
    id: "ga",
    name: "蛾",
    hp: 22,
    units: 1,
    boss: false,
    intent: [[{ type: "Guard", n: 8 }], [{ type: "A", n: 10 }]],
  },
  // 3. 影 ([A:7, Dim:12 + A:4, A:11] ループ。中央は 1 手番で Dim してから攻撃)
  {
    id: "kage",
    name: "影",
    hp: 26,
    units: 1,
    boss: false,
    intent: [
      [{ type: "A", n: 7 }],
      [{ type: "Dim", n: 12 }, { type: "A", n: 4 }],
      [{ type: "A", n: 11 }],
    ],
  },
  // 4. 二つ火 (HP14 ×2 体、各 [A:5, A:7] ループ)
  {
    id: "futatsubi",
    name: "二つ火",
    hp: 14,
    units: 2,
    boss: false,
    intent: [[{ type: "A", n: 5 }], [{ type: "A", n: 7 }]],
  },
  // 5. 篝
  {
    id: "kagari",
    name: "篝",
    hp: 30,
    units: 1,
    boss: false,
    intent: [
      [{ type: "A", n: 6 }],
      [{ type: "A", n: 6 }],
      [{ type: "Charge" }],
      [{ type: "A", n: 14 }], // バランス1周目: 終盤スパイク軽減(18→14)。
    ],
  },
  // 6. 大いなる闇(ボス)
  {
    id: "yami",
    name: "大いなる闇",
    hp: 68, // バランス1周目: 75→68。
    units: 1,
    boss: true,
    intent: [
      [{ type: "A", n: 8 }],
      [{ type: "Dim", n: 15 }],
      [{ type: "A", n: 12 }],
      [{ type: "Charge" }],
      [{ type: "A", n: 19 }], // バランス1周目: 24→19。
      [{ type: "Guard", n: 12 }],
    ],
  },
];

if (typeof window !== "undefined") {
  window.ENEMIES = ENEMIES;
}
