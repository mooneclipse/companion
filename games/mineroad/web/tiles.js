"use strict";
// Mine Road リメイク — タイル種 + 決定論地形生成 + PALETTE — verbatim 静的データ。
// 原作 jp.windbellrrr.app.minerroad の dungeon.csv ID0(裏庭)のブロック分布を忠実再現する
// 「数値設計のみ」の流用。原作のコード・画像・テキストは転用していない(メカニクス再現)。
//
// ランタイム乱数(Math.random / Date.now)は一切使わない。地形は tileType(col,row,seed) の
// 決定論ハッシュ関数で都度算出し、マップ配列は持たない(掘削差分だけ Set("col,row") で記録)。
// これにより力尽き → 同 BASE_SEED 再挑戦で同じ盤面が再現される("気を抜くとすぐ負ける")。
//
// タイル種(TILE):
//   NONE     空間(元から空 or 掘り抜いた跡)。通れる。重力が作用する穴。
//   SOIL     土。1 手で掘れる(DIG_SOIL)。
//   HARD     硬土。2 手で掘れる(DIG_HARD)。
//   ROCK     硬岩。掘れない(v1.1+ でツルハシ)。
//   GIRL     女の子(救出対象)。掘って到達 = 発見、追従。暖色自発光。
//   SURFACE  地表(最上部 1 行)。安全・スタミナ/体力 全回復・帰還地点。

const TILE = {
  NONE: 0,
  SOIL: 1,
  HARD: 2,
  ROCK: 3,
  GIRL: 4,
  SURFACE: 5,
};

// タイル種ごとの掘削手数キー(CONST.DIG_TAPS を単一真実源にするためのマップ)。
// 女の子は土と同じ手数で掘れる(掘ると発見が起きるだけ)。
const TILE_DIG_KEY = {
  [TILE.SOIL]: "SOIL",
  [TILE.HARD]: "HARD",
  [TILE.ROCK]: "ROCK", // v0.4.0: 鉄ツルハシ以上で掘れる(手数 DIG_TAPS.ROCK)。
  [TILE.GIRL]: "SOIL",
};

// ---- 整数ハッシュ(決定論・乱数非使用) --------------------------------
// 32bit 整数ハッシュ。col,row,seed から再現可能な疑似乱数 [0,1) を得る。
// マップ配列を持たず、同じ (col,row,seed) は常に同じ結果を返す。
function hash3(a, b, c) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}

// ---- 全9ダンジョンのマスターデータ(dungeon_info.csv 忠実) ---------------
const DUNGEON_DATA = [
  { id: 0, name: "裏庭の洞窟",       cols: 15, rows: 15,  girls:  5, bpRate: 100, desc: "どこかの裏庭の小さな洞窟。誰が少女を埋めたのか。" },
  { id: 1, name: "古い防空壕",       cols: 30, rows: 30,  girls: 14, bpRate:  92, desc: "古い時代の防空壕。暗い、カビ臭い、気持ち悪い。" },
  { id: 2, name: "廃炭鉱",           cols: 40, rows: 40,  girls: 23, bpRate:  88, desc: "かつて炭鉱だった場所。何故だろう、骨がよく見つかるような…。" },
  { id: 3, name: "地底湖",           cols: 45, rows: 40,  girls: 27, bpRate:  68, desc: "地底の湖。それはある意味、おそろしい場所だ。" },
  { id: 4, name: "埋没城跡",         cols: 50, rows: 35,  girls: 35, bpRate:  72, desc: "火山灰に埋もれた古い城跡。かつての栄光は、もはや見る影もない。" },
  { id: 5, name: "オンカロ",         cols: 20, rows: 99,  girls: 36, bpRate:  68, desc: "人の出入りを禁止された聖地。遙か昔、そこには何物かが封印されたと云われている。" },
  { id: 6, name: "孤独な山",         cols: 80, rows: 80,  girls: 69, bpRate:  65, desc: "山っていうか……山？ ただでさえ孤独なあなたがさらに孤独を感じるような、そんな場所。" },
  { id: 7, name: "朽ち果てた塔",     cols: 28, rows: 70,  girls: 39, bpRate:  67, desc: "老朽化した巨大建造物。崩壊しきったその骨組みは、見るものに時の無情さを感じさせる。" },
  { id: 8, name: "モンスターの巣窟", cols: 50, rows: 50,  girls: 26, bpRate:  30, desc: "最近発見された、世界でも有数の危険スポット。" },
];

// ---- ダンジョン深度帯データ(dungeon.csv 忠実) ---------------------------
// 各帯: floorTo(この行まで適用), none/hard/rock(ブロック比率 0..1, 累積前),
//   hazardRate(空間に占める水/マグマの割合), magmaFrac(ハザード中のマグマ割合),
//   avalancheRate(SOIL 中の不安定土割合), oreRate(鉱石含有率 /1000),
//   oreW[石炭,鉄鉱石,化石,鋼,ルビー,ダイヤ](鉱石種の重み。dungeon.csv 列21-26 忠実、v0.14.0 名寄せ),
//   monW[BAT,SLIME,SLIME_HALF,SNAKE,WORM,SPIDER](実装済みモンスターの重み)。
const DUNGEON_BANDS = {
  0: [
    { floorTo:  5, none: 0.05, hard: 0.10, rock: 0.02, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:   0, oreW: [59,30,5,0,0,0],  monW: [80,0,0,0,10,10] },
    { floorTo: 10, none: 0.05, hard: 0.10, rock: 0.02, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:  30, oreW: [59,30,5,0,0,0],  monW: [64,5,0,0,10,20] },
    { floorTo: 15, none: 0.07, hard: 0.10, rock: 0.02, hazardRate: 0.29, magmaFrac: 0,    avalancheRate: 0,      oreRate:  50, oreW: [48,30,10,0,0,0], monW: [56,10,0,3,10,20] },
  ],
  1: [
    { floorTo:  5, none: 0.05, hard: 0.10, rock: 0.02, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:   0, oreW: [34,30,5,0,0,0],  monW: [49,10,0,10,10,20] },
    { floorTo: 10, none: 0.06, hard: 0.12, rock: 0.05, hazardRate: 0.17, magmaFrac: 0,    avalancheRate: 0.013,  oreRate:  40, oreW: [34,30,5,0,0,0],  monW: [29,10,0,20,10,30] },
    { floorTo: 15, none: 0.07, hard: 0.14, rock: 0.05, hazardRate: 0.29, magmaFrac: 0,    avalancheRate: 0.0135, oreRate:  80, oreW: [22,30,10,5,1,0], monW: [13,20,0,20,10,30] },
    { floorTo: 20, none: 0.07, hard: 0.16, rock: 0.05, hazardRate: 0.29, magmaFrac: 0.50, avalancheRate: 0.0278, oreRate: 120, oreW: [21,30,10,5,1,0], monW: [13,20,0,20,10,30] },
    { floorTo: 25, none: 0.08, hard: 0.18, rock: 0.05, hazardRate: 0.38, magmaFrac: 0.33, avalancheRate: 0.029,  oreRate: 160, oreW: [5,35,15,10,1,0], monW: [6,10,0,20,10,30] },
    { floorTo: 30, none: 0.10, hard: 0.20, rock: 0.05, hazardRate: 0.50, magmaFrac: 0.40, avalancheRate: 0.0308, oreRate: 200, oreW: [4,35,15,10,1,0], monW: [9,10,0,20,10,20] },
  ],
  2: [
    { floorTo:  5, none: 0.05, hard: 0.10, rock: 0.05, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0.0125, oreRate:   0, oreW: [59,30,5,0,0,0],  monW: [39,10,0,30,10,10] },
    { floorTo: 10, none: 0.06, hard: 0.12, rock: 0.05, hazardRate: 0.17, magmaFrac: 0,    avalancheRate: 0.013,  oreRate:  40, oreW: [55,30,5,0,0,0],  monW: [39,10,0,30,10,10] },
    { floorTo: 15, none: 0.07, hard: 0.14, rock: 0.05, hazardRate: 0.29, magmaFrac: 0,    avalancheRate: 0.027,  oreRate:  80, oreW: [36,30,10,10,3,0], monW: [16,20,0,30,10,15] },
    { floorTo: 20, none: 0.07, hard: 0.16, rock: 0.05, hazardRate: 0.29, magmaFrac: 0.50, avalancheRate: 0.0278, oreRate: 120, oreW: [36,30,10,10,3,0], monW: [16,20,0,30,10,15] },
    { floorTo: 25, none: 0.10, hard: 0.18, rock: 0.08, hazardRate: 0.50, magmaFrac: 0.40, avalancheRate: 0.0625, oreRate: 160, oreW: [17,35,10,20,5,0], monW: [1,20,0,20,10,10] },
    { floorTo: 30, none: 0.13, hard: 0.20, rock: 0.08, hazardRate: 0.62, magmaFrac: 0.38, avalancheRate: 0.0678, oreRate: 200, oreW: [17,35,10,20,5,0], monW: [4,20,0,20,10,10] },
    { floorTo: 35, none: 0.13, hard: 0.26, rock: 0.08, hazardRate: 0.62, magmaFrac: 0.62, avalancheRate: 0.0755, oreRate: 240, oreW: [8,35,10,30,7,1], monW: [5,15,0,20,0,5] },
    { floorTo: 40, none: 0.14, hard: 0.28, rock: 0.10, hazardRate: 0.64, magmaFrac: 0.89, avalancheRate: 0.125,  oreRate: 280, oreW: [2,35,15,30,7,2],  monW: [7,9,0,15,0,0] },
  ],
  3: [
    { floorTo:  4, none: 0.25, hard: 0.30, rock: 0.02, hazardRate: 0.80, magmaFrac: 0.50, avalancheRate: 0,      oreRate:   0, oreW: [55,30,10,0,0,0],  monW: [5,0,0,0,0,0] },
    { floorTo:  8, none: 0.25, hard: 0.30, rock: 0.02, hazardRate: 0.80, magmaFrac: 0.50, avalancheRate: 0,      oreRate:  20, oreW: [48,30,10,0,0,0],  monW: [9,20,0,10,5,10] },
    { floorTo: 14, none: 0.28, hard: 0.30, rock: 0.04, hazardRate: 0.71, magmaFrac: 0.50, avalancheRate: 0.0526, oreRate:  40, oreW: [30,30,15,10,3,0],  monW: [4,20,0,10,5,10] },
    { floorTo: 19, none: 0.28, hard: 0.30, rock: 0.04, hazardRate: 0.71, magmaFrac: 0.50, avalancheRate: 0.0526, oreRate:  60, oreW: [30,30,15,10,3,0],  monW: [8,20,0,10,5,10] },
    { floorTo: 25, none: 0.28, hard: 0.30, rock: 0.04, hazardRate: 0.71, magmaFrac: 0.50, avalancheRate: 0.0526, oreRate:  80, oreW: [23,30,20,10,5,0],  monW: [1,20,0,10,5,10] },
    { floorTo: 30, none: 0.28, hard: 0.30, rock: 0.04, hazardRate: 0.71, magmaFrac: 0.50, avalancheRate: 0.0526, oreRate: 100, oreW: [10,30,20,15,5,3],  monW: [5,10,0,10,5,10] },
    { floorTo: 35, none: 0.30, hard: 0.30, rock: 0.04, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.1111, oreRate: 120, oreW: [4,30,20,15,8,6], monW: [4,10,0,10,5,10] },
    { floorTo: 40, none: 0.30, hard: 0.30, rock: 0.04, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.1111, oreRate: 140, oreW: [6,30,10,20,8,9], monW: [2,10,0,10,5,5] },
  ],
  4: [
    { floorTo: 10, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.0926, oreRate:   0, oreW: [26,10,30,10,0,0],  monW: [25,5,0,5,3,8] },
    { floorTo: 15, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.0926, oreRate:  40, oreW: [23,10,30,10,3,0],  monW: [11,5,0,5,3,8] },
    { floorTo: 20, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.1481, oreRate:  80, oreW: [3,20,28,10,5,0],  monW: [8,5,0,5,3,8] },
    { floorTo: 25, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.1481, oreRate: 120, oreW: [1,20,28,10,7,0],  monW: [0,5,0,5,3,8] },
    { floorTo: 30, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.1481, oreRate: 160, oreW: [1,20,28,10,9,8], monW: [4,3,0,5,3,8] },
    { floorTo: 35, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.1481, oreRate: 200, oreW: [0,20,26,10,12,8], monW: [4,3,0,5,3,8] },
    { floorTo: 40, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.2222, oreRate: 240, oreW: [0,20,26,15,15,10], monW: [2,5,0,5,3,8] },
    { floorTo: 50, none: 0.16, hard: 0.30, rock: 0,    hazardRate: 0.38, magmaFrac: 0.50, avalancheRate: 0.2222, oreRate: 280, oreW: [0,20,26,17,18,10],  monW: [2,5,0,5,3,8] },
  ],
  5: [
    { floorTo:   5, none: 0.10, hard: 0.80, rock: 0,    hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0.20,   oreRate:   0, oreW: [45,30,20,0,0,0], monW: [36,10,0,30,0,20] },
    { floorTo:  17, none: 0.10, hard: 0.75, rock: 0.05, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0.20,   oreRate:  50, oreW: [35,30,20,10,0,0], monW: [16,10,0,30,0,20] },
    { floorTo:  30, none: 0.09, hard: 0.70, rock: 0.05, hazardRate: 0.11, magmaFrac: 0,    avalancheRate: 0.125,  oreRate: 100, oreW: [34,30,20,10,1,0], monW: [20,20,0,20,0,10] },
    { floorTo:  40, none: 0.09, hard: 0.60, rock: 0.10, hazardRate: 0.11, magmaFrac: 0,    avalancheRate: 0.0952, oreRate: 150, oreW: [34,30,20,10,1,0], monW: [20,20,0,20,0,10] },
    { floorTo:  50, none: 0.08, hard: 0.60, rock: 0.10, hazardRate: 0.38, magmaFrac: 0.67, avalancheRate: 0.0909, oreRate: 200, oreW: [19,40,25,10,1,0], monW: [22,20,0,10,0,5] },
    { floorTo:  60, none: 0.08, hard: 0.50, rock: 0.15, hazardRate: 0.38, magmaFrac: 0.67, avalancheRate: 0.0741, oreRate: 250, oreW: [9,40,25,20,1,0], monW: [22,30,0,0,0,5] },
    { floorTo:  70, none: 0.08, hard: 0.50, rock: 0.15, hazardRate: 0.38, magmaFrac: 0.67, avalancheRate: 0.0741, oreRate: 300, oreW: [8,40,25,20,2,0], monW: [20,27,0,0,0,5] },
    { floorTo:  80, none: 0.09, hard: 0.40, rock: 0.20, hazardRate: 0.44, magmaFrac: 0.50, avalancheRate: 0.0645, oreRate: 250, oreW: [7,40,25,20,2,1], monW: [22,25,0,0,0,0] },
    { floorTo:  90, none: 0.09, hard: 0.40, rock: 0.20, hazardRate: 0.44, magmaFrac: 0.50, avalancheRate: 0.0645, oreRate: 400, oreW: [0,40,25,25,3,2],  monW: [22,10,0,0,0,0] },
    { floorTo: 100, none: 0.10, hard: 0.30, rock: 0.25, hazardRate: 0.50, magmaFrac: 0.60, avalancheRate: 0.0571, oreRate: 450, oreW: [0,40,22,25,5,3],  monW: [27,5,0,0,0,0] },
  ],
  6: [
    { floorTo:  8, none: 0.01, hard: 0.10, rock: 0.05, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:   0, oreW: [59,30,5,0,0,0],  monW: [24,10,0,40,5,15] },
    { floorTo: 16, none: 0.07, hard: 0.12, rock: 0.05, hazardRate: 0.57, magmaFrac: 0.50, avalancheRate: 0,      oreRate:  40, oreW: [58,30,5,0,0,0],  monW: [19,10,0,30,5,15] },
    { floorTo: 24, none: 0.09, hard: 0.14, rock: 0.10, hazardRate: 0.44, magmaFrac: 0.50, avalancheRate: 0.0149, oreRate:  80, oreW: [41,35,10,5,1,0], monW: [6,20,0,30,5,10] },
    { floorTo: 32, none: 0.07, hard: 0.16, rock: 0.10, hazardRate: 0.57, magmaFrac: 0.50, avalancheRate: 0.0149, oreRate: 120, oreW: [40,35,10,5,1,0], monW: [7,20,0,30,5,10] },
    { floorTo: 48, none: 0.05, hard: 0.18, rock: 0.12, hazardRate: 0.80, magmaFrac: 0.50, avalancheRate: 0.0154, oreRate: 160, oreW: [25,40,15,10,1,0], monW: [9,20,0,15,5,5] },
    { floorTo: 56, none: 0.11, hard: 0.20, rock: 0.12, hazardRate: 0.73, magmaFrac: 0.50, avalancheRate: 0.0351, oreRate: 200, oreW: [24,40,15,10,1,0], monW: [9,30,0,14,5,0] },
    { floorTo: 64, none: 0.13, hard: 0.24, rock: 0.16, hazardRate: 0.62, magmaFrac: 0.50, avalancheRate: 0.0426, oreRate: 240, oreW: [13,45,20,10,2,0], monW: [1,25,0,14,5,0] },
    { floorTo: 72, none: 0.11, hard: 0.26, rock: 0.16, hazardRate: 0.73, magmaFrac: 0.50, avalancheRate: 0.0426, oreRate: 280, oreW: [11,45,20,10,2,1], monW: [3,25,0,11,5,0] },
    { floorTo: 76, none: 0.09, hard: 0.28, rock: 0.19, hazardRate: 0.89, magmaFrac: 0.50, avalancheRate: 0.0682, oreRate: 320, oreW: [0,50,20,15,3,2],  monW: [8,10,0,10,5,0] },
    { floorTo: 80, none: 0.13, hard: 0.30, rock: 0.19, hazardRate: 0.77, magmaFrac: 0.50, avalancheRate: 0.0789, oreRate: 360, oreW: [0,50,20,15,5,3],  monW: [28,5,0,2,5,0] },
  ],
  7: [
    { floorTo:  8, none: 0.01, hard: 0.80, rock: 0.10, hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:   0, oreW: [4,40,0,50,0,0],  monW: [85,0,0,0,0,15] },
    { floorTo: 16, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 100, oreW: [4,40,0,50,0,0],  monW: [16,10,0,15,5,15] },
    { floorTo: 24, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 200, oreW: [4,40,0,50,0,0],  monW: [18,10,0,15,5,15] },
    { floorTo: 32, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 300, oreW: [4,40,0,50,0,0],  monW: [15,10,0,15,5,15] },
    { floorTo: 48, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 400, oreW: [4,40,0,50,0,0],  monW: [17,10,0,15,5,15] },
    { floorTo: 56, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 500, oreW: [4,40,0,50,0,0],  monW: [5,10,0,15,5,15] },
    { floorTo: 64, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 600, oreW: [4,40,0,50,0,0],  monW: [7,10,0,15,5,15] },
    { floorTo: 72, none: 0.03, hard: 0.80, rock: 0.10, hazardRate: 0.67, magmaFrac: 0.50, avalancheRate: 0.2857, oreRate: 600, oreW: [4,40,0,50,0,0],  monW: [7,10,0,15,5,15] },
  ],
  8: [
    { floorTo:  3, none: 0.20, hard: 0.30, rock: 0,    hazardRate: 0,    magmaFrac: 0,    avalancheRate: 0,      oreRate:   0, oreW: [36,10,20,10,0,0],  monW: [28,8,0,15,3,8] },
    { floorTo: 10, none: 0.26, hard: 0.30, rock: 0.13, hazardRate: 0.23, magmaFrac: 0.50, avalancheRate: 0.0323, oreRate:  40, oreW: [36,10,20,10,0,0],  monW: [11,8,0,8,3,8] },
    { floorTo: 15, none: 0.26, hard: 0.30, rock: 0.13, hazardRate: 0.23, magmaFrac: 0.50, avalancheRate: 0.0323, oreRate:  80, oreW: [33,10,20,10,3,0],  monW: [10,8,0,8,3,8] },
    { floorTo: 20, none: 0.26, hard: 0.30, rock: 0.13, hazardRate: 0.23, magmaFrac: 0.50, avalancheRate: 0.0323, oreRate: 120, oreW: [11,20,20,10,5,0],  monW: [7,8,0,8,3,8] },
    { floorTo: 25, none: 0.30, hard: 0.30, rock: 0.13, hazardRate: 0.33, magmaFrac: 0.50, avalancheRate: 0.037,  oreRate: 160, oreW: [11,20,20,10,5,0],  monW: [7,8,0,8,3,8] },
    { floorTo: 30, none: 0.30, hard: 0.30, rock: 0.13, hazardRate: 0.33, magmaFrac: 0.50, avalancheRate: 0.037,  oreRate: 200, oreW: [13,20,20,10,5,8], monW: [4,8,0,8,3,8] },
    { floorTo: 35, none: 0.30, hard: 0.30, rock: 0.13, hazardRate: 0.33, magmaFrac: 0.50, avalancheRate: 0.037,  oreRate: 240, oreW: [13,20,20,10,5,8], monW: [4,8,0,8,3,8] },
    { floorTo: 40, none: 0.30, hard: 0.30, rock: 0.13, hazardRate: 0.33, magmaFrac: 0.50, avalancheRate: 0.037,  oreRate: 280, oreW: [11,20,20,10,5,10], monW: [3,8,0,8,3,8] },
    { floorTo: 50, none: 0.30, hard: 0.30, rock: 0.13, hazardRate: 0.33, magmaFrac: 0.50, avalancheRate: 0.037,  oreRate: 320, oreW: [11,20,20,10,5,10], monW: [3,8,0,8,3,8] },
  ],
};

// 現在のダンジョンの深度帯データを引く。row に一致する帯(floorTo 以下)を返す。
function getDungeonBand(row) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  const did = C.DUNGEON_ID != null ? C.DUNGEON_ID : 0;
  const bands = DUNGEON_BANDS[did];
  if (!bands || !bands.length) return null;
  for (const b of bands) { if (row <= b.floorTo) return b; }
  return bands[bands.length - 1];
}

// ---- ブロック分布(ダンジョン×深度帯 動的) --------------------------------
function blockThresholds(row) {
  const band = getDungeonBand(row);
  if (!band) {
    return { none: 0.05, hard: 0.15, rock: 0.17 };
  }
  const none = band.none;
  const hard = none + band.hard;
  const rock = hard + band.rock;
  return { none, hard, rock };
}

// ---- 女の子の決定論配置 ------------------------------------------------
// 裏庭(dungeon_info ID0)の girl num = 5 を忠実再現(一次データで確認)。深度を散らして
// 埋める(深いほど深部寄り、最深の 1 人は最下層付近 = 深追いと最下層到達の動線)。
// row は均等割りで全員 distinct なのでセル衝突なし(col が重複しても row 違いで別マス)。
// 救出体験を濃くするため敵スポーン抽選には混ぜず専用ロジック(仕様 §12 所見の通り)。
// 返り値: [{col, row}, ...](長さ = CONST.GIRL_COUNT)
function girlPositions(seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  const cols = C.GRID_COLS;
  const floors = C.DEPTH_ROWS;
  const count = (C.GIRL_COUNT | 0) || 5;
  const out = [];
  for (let i = 0; i < count; i++) {
    // 深度 40%〜95% に均等割り(count=5/floors=15 で row=6,8,10,12,14)。
    const frac = count > 1 ? 0.4 + (0.55 * i) / (count - 1) : 0.6;
    const row = Math.max(2, Math.min(floors - 1, Math.round(floors * frac)));
    const col = Math.floor(hash3(seed, 7001, 100 + i) * cols);
    out.push({ col, row });
  }
  return out;
}

// ある (col,row) が このダイブの女の子配置に一致するか。
function isGirlAt(col, row, seed) {
  if (row <= 0) return false;
  for (const g of girlPositions(seed)) {
    if (g.col === col && g.row === row) return true;
  }
  return false;
}

// ---- 決定論地形 --------------------------------------------------------
// tileType(col, row, seed) → TILE 値。
// row 0 = 地表(SURFACE、安全な帰還地点)。row < 0 / 範囲外は ROCK(掘れない壁)。
// それ以外は女の子・空間/硬土/硬岩/土を決定論で配置する。
function tileType(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return TILE.SURFACE; // 地表は安全な帰還地点。
  if (col < 0 || col >= C.GRID_COLS) return TILE.ROCK; // 横の壁。
  if (row > C.DEPTH_ROWS) return TILE.ROCK; // 最下層の底(掘れない岩盤)。

  // 女の子(専用配置)。最優先で返す(救出対象が硬岩等に潰されないよう)。
  if (isGirlAt(col, row, seed)) return TILE.GIRL;

  const r = hash3(col, row, seed); // このマスの基準乱数 [0,1)。
  const th = blockThresholds(row);
  if (r < th.none) return TILE.NONE;
  if (r < th.hard) return TILE.HARD;
  if (r < th.rock) return TILE.ROCK;
  return TILE.SOIL;
}

// ---- 鉱石(ore) — 原作 item.csv 忠実 + 決定論ドロップ(v0.4.0、v0.14.0 で原作実名へ名寄せ) ----
// tileType には混ぜない(既存 girlPositions・determinism snapshot・タイル分布を一切
// 変えないため)。SOIL/HARD を掘り抜いた瞬間に oreAt(col,row,seed) を引き、含有なら
// インベントリへ加算する別レイヤー。鉱石種は深度帯で分布(dungeon.csv 実データ)、含有率は控えめ。
//
// v0.14.0 翻案判断A: v0.4.0 は「銅/鉄/金/ダイヤ」の独自4種体系だったが、原作 item.csv/craft.csv に
// 存在しない翻案だったため、原作実名6種(石炭/鉄鉱石/化石/鋼/ルビー/ダイヤ)へ名寄せする。売値は
// item.csv verbatim(石炭150/鉄鉱石200/化石400/鋼3000/ルビー1200/ダイヤ15000)。
const ORE = {
  NONE: 0,
  COAL: 1, // 石炭(item.csv ID4、売値150)。
  IRON_ORE: 2, // 鉄鉱石(ID5、売値200)。
  FOSSIL: 3, // 化石(ID6、売値400)。
  STEEL: 4, // 鋼(ID9、売値3000)。
  RUBY: 5, // ルビー(ID7、売値1200)。
  DIAMOND: 6, // ダイヤ(ID8、売値15000)。
};
// 鉱石メタ(verbatim 売値 + 表示名 + HUD アイコン1字)。
const ORE_META = {
  [ORE.COAL]: { key: "COAL", name: "石炭", price: 150, ico: "炭" },
  [ORE.IRON_ORE]: { key: "IRON_ORE", name: "鉄鉱石", price: 200, ico: "鉄" },
  [ORE.FOSSIL]: { key: "FOSSIL", name: "化石", price: 400, ico: "化" },
  [ORE.STEEL]: { key: "STEEL", name: "鋼", price: 3000, ico: "鋼" },
  [ORE.RUBY]: { key: "RUBY", name: "ルビー", price: 1200, ico: "ル" },
  [ORE.DIAMOND]: { key: "DIAMOND", name: "ダイヤ", price: 15000, ico: "ダ" },
};

// ある (col,row) を掘り抜いたとき産出する鉱石種(決定論・乱数禁止)。含有しないなら ORE.NONE。
// 深度帯の重み oreW=[石炭,鉄鉱石,化石,鋼,ルビー,ダイヤ] は dungeon.csv 実データ(v0.14.0 名寄せ)。
// 別シード位相のハッシュで含有率を絞る。GIRL マスは鉱石を出さない(救出対象)。
// 同じ (col,row,seed) は常に同じ結果。
function oreAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return ORE.NONE;
  if (isGirlAt(col, row, seed)) return ORE.NONE;
  const band = getDungeonBand(row);
  if (!band || band.oreRate <= 0) return ORE.NONE;
  const h = hash3(col + 911, row + 733, seed + 5557);
  if (h >= band.oreRate / 1000) return ORE.NONE;
  const w = band.oreW;
  const total = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
  if (total <= 0) return ORE.NONE;
  const h2 = hash3(col + 733, row + 5557, seed + 911);
  const pick = h2 * total;
  if (pick < w[0]) return ORE.COAL;
  if (pick < w[0] + w[1]) return ORE.IRON_ORE;
  if (pick < w[0] + w[1] + w[2]) return ORE.FOSSIL;
  if (pick < w[0] + w[1] + w[2] + w[3]) return ORE.STEEL;
  if (pick < w[0] + w[1] + w[2] + w[3] + w[4]) return ORE.RUBY;
  return ORE.DIAMOND;
}

// ---- ツルハシ(pickaxe) — 原作 item.csv 忠実(v0.4.0) ----------------------
// power でタイル必要 power 以上なら掘れる。木(初期,岩掘れない)/石(rock=HARD)/鉄(hard=ROCK)/
// ダイヤ(何でも)。最強の所持ツルハシが常時有効。タイル必要 power: SOIL=1 / HARD=2 / ROCK=3。
const PICK = {
  WOOD: { key: "WOOD", name: "木のツルハシ", power: 1, ico: "木" },
  STONE: { key: "STONE", name: "石のツルハシ", power: 2, ico: "石" },
  IRON: { key: "IRON", name: "鉄のツルハシ", power: 3, ico: "鉄" },
  DIAMOND: { key: "DIAMOND", name: "ダイヤのツルハシ", power: 5, ico: "ダ" },
};
// タイル種ごとの必要 power(掘削ゲート、A の核)。GIRL は SOIL 相当=1(救出対象)。
const TILE_REQ_POWER = {
  [TILE.SOIL]: 1,
  [TILE.HARD]: 2,
  [TILE.ROCK]: 3,
  [TILE.GIRL]: 1,
};

// ---- アイテムカタログ — 原作 item.csv 全45種 忠実書き起こし(v0.14.0) -------------------
// 判断B: HP/SP/最大所持数は item.csv verbatim。説明文(note)は著作権境界のため自前要約。
// open=true は本リメイクで取得経路(鉱石/モンスタードロップ/飲食/道具のいずれか)が開いている種
// (工房「アイテム」タブで所持数を表示)。open=false は定義のみのカタログ表示(dead-item、クラフト/
// 商人/ドロップに新規陳列しない=判断Bの非陳列方針。ただし 解毒薬/海綿 は v0.5.0 から既存のモンスター
// ドロップ表に verbatim で残っているため実際には入手されうる — 本増分はその既存挙動に非介入、
// カタログ上は「用途未実装」の dead 扱いのまま据え置く)。爆弾/バケツ3種/矢/マジックハンド/
// フックショット/木の杭/天井フック/ロープ/浮島/海綿/タネ3種/かかし/レンガ/堅土/赤土/パンツ/
// 幸運のお守り/解毒薬/作業台/鉄骨片/鉄骨ブロックは、投擲/汲取/放水/土設置/杭/育成/霊/毒などの
// 新規メカが要り1増分を超えるため次増分候補として残す(判断B)。
const ITEM_DATA = [
  { id: 1, name: "爆弾", hp: 0, sp: 0, max: 99, open: false, note: "設置して数ターン後に爆発。爆発/破壊メカ未実装。" },
  { id: 2, name: "ハシゴ", hp: 0, sp: 0, max: 99, open: true, note: "縦穴に設置すると上掘りができる(v0.13.1)。クラフトで入手。" },
  { id: 3, name: "アンテナ", hp: 0, sp: 0, max: 99, open: true, note: "設置すると電波網が広がる。電波圏内は力尽きても持ち物を失わない(v0.14.0 保険)。" },
  { id: 4, name: "石炭", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。浅層に多い。クラフト/商人の素材。" },
  { id: 5, name: "鉄鉱石", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。クラフト/商人の素材。" },
  { id: 6, name: "化石", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。クラフト素材。" },
  { id: 7, name: "ルビー", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。深層に多い。モンスタードロップでも入手。" },
  { id: 8, name: "ダイヤ", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。最深層に多い。ダイヤのツルハシの素材。" },
  { id: 9, name: "鋼", hp: 0, sp: 0, max: 999, open: true, note: "鉱石。ツルハシ/アンテナ/焼き肉交換の素材。" },
  { id: 10, name: "生肉", hp: 0, sp: 250, max: 99, open: true, note: "モンスタードロップ。生のままは回復0、マグマで焼くと焼き肉になる(v0.14.0)。" },
  { id: 11, name: "堅土", hp: 0, sp: 0, max: 99, open: false, note: "土を埋め立てる設置土。設置(土)メカ未実装。" },
  { id: 12, name: "赤土", hp: 0, sp: 0, max: 99, open: false, note: "堅土より柔らかい設置土。設置(土)メカ未実装。" },
  { id: 13, name: "バケツ", hp: 0, sp: 0, max: 99, open: false, note: "液体を汲むための道具。汲み取りメカ未実装。" },
  { id: 14, name: "水入りバケツ", hp: 0, sp: 0, max: 99, open: false, note: "水を汲んだバケツ。放水メカ未実装。" },
  { id: 15, name: "マグマのバケツ", hp: 0, sp: 0, max: 99, open: false, note: "マグマを汲んだバケツ。放水メカ未実装。" },
  { id: 16, name: "種火", hp: 0, sp: 0, max: 999, open: true, note: "モンスタードロップ(原作)。本実装の6種モンスターからは出ない(ボス級のみ)。" },
  { id: 17, name: "矢", hp: 5, sp: 0, max: 999, open: false, note: "遠距離攻撃用の矢。PER_ARROW/遠距離攻撃メカ未実装。" },
  { id: 18, name: "作業台", hp: 0, sp: 0, max: 99, open: false, note: "アイテム加工用の設置台。既存クラフトUIで代替済み、設置メカ未実装。" },
  { id: 19, name: "レンガ", hp: 0, sp: 0, max: 99, open: false, note: "丈夫な壁になる設置ブロック。設置(土)メカ未実装。" },
  { id: 20, name: "動物の血", hp: 30, sp: 50, max: 99, open: true, note: "モンスタードロップ。食べると体力回復。" },
  { id: 21, name: "骨", hp: 0, sp: 0, max: 999, open: true, note: "モンスタードロップ。ハシゴ/ツルハシのクラフト素材。" },
  { id: 22, name: "パンツ", hp: 9999, sp: 9999, max: 999, open: false, note: "少女の遺物。原作ネタアイテム、収集メカ未実装。" },
  { id: 23, name: "タネ", hp: 0, sp: 0, max: 999, open: false, note: "水をあげると育つ種。栽培メカ未実装。" },
  { id: 24, name: "浮島", hp: 0, sp: 0, max: 99, open: false, note: "浮き沈みする足場。設置メカ未実装。" },
  { id: 25, name: "海綿", hp: 0, sp: 0, max: 99, open: false, note: "水を吸うとブロック化する。用途未実装(v0.5.0 からモンスタードロップとしては既存)。" },
  { id: 26, name: "焼き肉", hp: 40, sp: 500, max: 99, open: true, note: "生肉のマグマ変化 or 商人で鋼2と交換。食べると体力回復。" },
  { id: 27, name: "ツルハシ", hp: 0, sp: 0, max: 99, open: true, note: "掘削の要。木/石/鉄/ダイヤの4段(v0.4.0)。クラフト/商人で強化。" },
  { id: 28, name: "赤いタネ", hp: 0, sp: 0, max: 999, open: false, note: "水をあげると育つ赤い種。栽培メカ未実装。" },
  { id: 29, name: "フルーツ", hp: 25, sp: 200, max: 99, open: true, note: "商人で鉄鉱石2と交換。食べると体力回復。" },
  { id: 30, name: "マジックハンド", hp: 0, sp: 0, max: 99, open: false, note: "水/マグマ中の物を拾う道具。水中拾得メカ未実装。" },
  { id: 31, name: "キノコ", hp: 1, sp: 3, max: 999, open: true, note: "SOIL 掘り抜きで採取できる交換通貨。商人で道具/夢キノコと交換。" },
  { id: 32, name: "夢キノコ", hp: 10, sp: 100, max: 999, open: true, note: "商人でキノコ100と交換する高額通貨/高級回復実。" },
  { id: 33, name: "青いタネ", hp: 0, sp: 0, max: 999, open: false, note: "水をあげると育つ青い種。栽培メカ未実装。" },
  { id: 34, name: "天井フック", hp: 0, sp: 0, max: 99, open: false, note: "ロープを垂らす設置フック。設置メカ未実装。" },
  { id: 35, name: "ロープ", hp: 0, sp: 0, max: 999, open: false, note: "天井フックから垂らすロープ。天井フックメカ未実装のため用途無し。" },
  { id: 36, name: "動物の皮", hp: 0, sp: 0, max: 999, open: true, note: "モンスタードロップ。ハシゴのクラフト素材。" },
  { id: 37, name: "木の杭", hp: 0, sp: 0, max: 99, open: false, note: "フックショットの的になる杭。フックショットメカ未実装。" },
  { id: 38, name: "フックショット", hp: 0, sp: 0, max: 99, open: false, note: "離れた場所へ移動する道具。フックショットメカ未実装。" },
  { id: 39, name: "クモの糸", hp: 0, sp: 0, max: 999, open: true, note: "モンスタードロップ(クモ)。表示のみ、次増分でクラフト素材化候補。" },
  { id: 40, name: "解毒薬", hp: 0, sp: 0, max: 99, open: false, note: "毒を消す薬。毒状態メカ未実装(v0.5.0 からモンスタードロップとしては既存)。" },
  { id: 41, name: "祈りのかかし", hp: 0, sp: 0, max: 99, open: false, note: "霊を浄化するかかし。霊メカ未実装。" },
  { id: 42, name: "龍のウロコ", hp: 0, sp: 0, max: 999, open: true, note: "SOIL DRAGON(ボス級)のドロップ。本実装は未実装のため実際の入手経路は次増分。" },
  { id: 43, name: "幸運のお守り", hp: 0, sp: 0, max: 99, open: false, note: "所持数で良いことがあるという噂のお守り。効果メカ未実装。" },
  { id: 44, name: "鉄骨片", hp: 0, sp: 0, max: 99, open: false, note: "鉄骨ブロックの素材。建材設置メカ未実装。" },
  { id: 45, name: "鉄骨ブロック", hp: 0, sp: 0, max: 99, open: false, note: "連結して配置できる建材。建材設置メカ未実装。" },
];

// ---- クラフトレシピ — 原作 craft.csv 忠実(v0.4.0、v0.14.0 で実レシピへ差し替え) -----------
// 材料(ore/item→個数)→ 完成品。完成品は pick(ツルハシ段)/tool(はしご/アンテナ)。
// 材料が足りていれば実行可、足りなければ disabled 表示。cost は SHOP_RECIPES と同じ形
// { ore:{ORE_META.key→個数}, item:{G.drops のキー(日本語名)→個数} }(v0.14.0 で統一、canTrade で判定)。
//
// v0.14.0 判断B: 回復薬(原作に無い v0.4.0 独自アイテム)は廃し、item.csv 実在の飲食(生肉/焼き肉/
// 動物の血/フルーツ/夢キノコ)へ置換(45 種外のアイテムを並走させない=体系1本化)。
// v0.14.0 判断A(ツルハシ4段の材料スケール、翻案注記): 原作 craft.csv のツルハシは単一レシピ
// (鋼2+骨1+石炭1、確率で壊れる=劣化なし4段ゲートとは相容れないため v0.4.0 で不採用のまま維持)。
// 本リメイクは4段 power ゲートを掘削ゲートの核として維持するため、craft.csv 実レシピを「中段(鉄)」に
// verbatim 採用し、初段(石)は単一素材の安価版、最上段(ダイヤ)は鉄段レシピを2倍スケール+ダイヤ原石1個
// (原作に無い最上段のため、名前に沿わせダイヤ原石を素材へ加える翻案)とした。
//   石のツルハシ     ← 石炭3(翻案・単一素材の安価な初段)
//   鉄のツルハシ     ← 鋼2 + 骨1 + 石炭1(craft.csv id27 verbatim)
//   ダイヤのツルハシ ← 鋼4 + 骨2 + 化石2 + ダイヤ1(鉄段の2倍スケール+ダイヤ、翻案)
//   はしご           ← 骨2 + 鉄鉱石1 + 石炭1(craft.csv id2 verbatim)
//   アンテナ         ← 鉄鉱石3 + 鋼2 + 化石1(craft.csv id3 verbatim)
// result: { type:"pick"|"tool", id, name }
const CRAFT_RECIPES = [
  { id: "pick_stone", name: "石のツルハシ", result: { type: "pick", id: "STONE" }, cost: { ore: { COAL: 3 } } },
  { id: "pick_iron", name: "鉄のツルハシ", result: { type: "pick", id: "IRON" }, cost: { ore: { STEEL: 2, COAL: 1 }, item: { "骨": 1 } } },
  { id: "pick_diamond", name: "ダイヤのツルハシ", result: { type: "pick", id: "DIAMOND" }, cost: { ore: { STEEL: 4, FOSSIL: 2, DIAMOND: 1 }, item: { "骨": 2 } } },
  { id: "ladder", name: "はしご", result: { type: "tool", id: "LADDER" }, cost: { ore: { IRON_ORE: 1, COAL: 1 }, item: { "骨": 2 } } },
  { id: "antenna", name: "アンテナ", result: { type: "tool", id: "ANTENNA" }, cost: { ore: { IRON_ORE: 3, STEEL: 2, FOSSIL: 1 } } },
];

// ---- モンスター — 原作 monster.csv 忠実(v0.5.0) -------------------------
// 死の緊張(撤退判断の重み)を設計から出す本命増分。浅層向けの忠実サブセット 6 種を採用
// (BAT/SLIME/SLIME HALF/SNAKE/WORM/SPIDER)。各ステータスは monster.csv verbatim
//   HP / SP / STR(攻撃) / DEF(防御) / SPD(行動頻度) / EXP / GIRLATK(女の子を狙うか=1) /
//   bury(埋没掘りper=掘り抜き時に出現する%) / space(空間スポーン可=1)。
// ドロップ表(ITEM, PER%)も verbatim。全 20 種ロスター・ボス級(SOIL DRAGON/BEAR 等)は次以降。
//
// 決定論厳守: スポーン配置・戦闘解決・行動すべて seed 由来ハッシュ(hash3)で決める。
// ランタイム乱数(Math.random/Date.now)は使わない。oreAt と同じく tileType/girlPositions・
// determinism snapshot・タイル分布には一切介入しない別レイヤー(非介入方針 v0.4.0 踏襲)。
const MON = {
  BAT: "BAT",
  SLIME: "SLIME",
  SLIME_HALF: "SLIME_HALF",
  SNAKE: "SNAKE",
  WORM: "WORM",
  SPIDER: "SPIDER",
};
// verbatim ステータス + ドロップ(monster.csv 一次データ)。drops は確率の高い順に並べ、
// 各 per は独立判定でなく「累積しきい値で 1 種だけ落とす」抽選(決定論ハッシュ)に使う。
const MONSTER = {
  [MON.BAT]: {
    key: MON.BAT, name: "コウモリ", ico: "蝙", hp: 5, sp: 20, str: 1, def: 0, spd: 2,
    exp: 2, girlatk: 1, bury: 0, space: 1,
    drops: [{ item: "動物の血", per: 50 }, { item: "動物の皮", per: 30 }, { item: "骨", per: 20 }],
  },
  [MON.SLIME]: {
    key: MON.SLIME, name: "スライム", ico: "粘", hp: 15, sp: 5, str: 3, def: 0, spd: 1,
    exp: 4, girlatk: 1, bury: 30, space: 1,
    drops: [{ item: "生肉", per: 70 }, { item: "海綿", per: 27 }, { item: "ルビー", per: 3 }],
  },
  [MON.SLIME_HALF]: {
    key: MON.SLIME_HALF, name: "小スライム", ico: "粘", hp: 8, sp: 5, str: 2, def: 0, spd: 1,
    exp: 2, girlatk: 1, bury: 15, space: 1,
    drops: [{ item: "生肉", per: 65 }, { item: "海綿", per: 32 }, { item: "ルビー", per: 3 }],
  },
  [MON.SNAKE]: {
    key: MON.SNAKE, name: "ヘビ", ico: "蛇", hp: 10, sp: 8, str: 5, def: 1, spd: 1,
    exp: 6, girlatk: 1, bury: 80, space: 1,
    drops: [{ item: "動物の血", per: 30 }, { item: "動物の皮", per: 25 }, { item: "生肉", per: 25 }, { item: "解毒薬", per: 20 }],
  },
  [MON.WORM]: {
    key: MON.WORM, name: "ミミズ", ico: "蟲", hp: 5, sp: 0, str: 1, def: 0, spd: 3,
    exp: 1, girlatk: 1, bury: 100, space: 0, // space=0: 埋没掘りでのみ出る(土の中の住人)。
    drops: [{ item: "生肉", per: 70 }, { item: "動物の皮", per: 20 }, { item: "動物の血", per: 10 }],
  },
  [MON.SPIDER]: {
    key: MON.SPIDER, name: "クモ", ico: "蛛", hp: 6, sp: 5, str: 2, def: 1, spd: 1,
    exp: 3, girlatk: 1, bury: 100, space: 1,
    drops: [{ item: "クモの糸", per: 70 }, { item: "解毒薬", per: 30 }],
  },
};
// v0.12.0 以前の静的帯(裏庭用フォールバック、DUNGEON_BANDS が無い環境向け)。
const SPACE_SPAWN_BANDS = [
  { maxFrac: 0.34, species: [MON.SLIME_HALF, MON.BAT] },
  { maxFrac: 0.67, species: [MON.SLIME, MON.SPIDER] },
  { maxFrac: 1.01, species: [MON.SNAKE, MON.BAT] },
];
const BURY_SPAWN_BANDS = [
  { maxFrac: 0.34, species: [MON.WORM, MON.SLIME_HALF] },
  { maxFrac: 0.67, species: [MON.WORM, MON.SLIME] },
  { maxFrac: 1.01, species: [MON.SPIDER, MON.SNAKE] },
];

// 空間スポーン率(NONE マスにモンスターが居る確率)。決定論ハッシュしきい値。控えめに
// (空間の一部だけ)出し、深いほど気配が増す。tileType/oreAt と別位相のハッシュを使う。
const SPACE_SPAWN_RATE = 0.55;
// 埋没掘り「住人居住率」(掘り抜くマスのうちモンスターが潜んでいる割合)。掘りの何割で出るか
// を決める単一ノブ(密度)。各種の bury%(埋没掘りper, verbatim) は「住人が居るマスを掘ったとき
// 飛び出す確率」として住人居住の上に重ねる(WORM=100 は居れば必ず出る土の主)。密度を 1.0 に
// すると毎掘り出現で過密になるため、掘削テンポを保てる水準に絞る(対症療法でなく密度の設計値)。
const BURY_PRESENCE_RATE = 0.16;

// ある (col,row) の NONE 空間にモンスターが居るか(決定論)。居れば種キー、居なければ null。
// tileType が NONE のマスだけが対象(呼び出し側で保証)。GIRL マスは別レイヤーで対象外。
// 同じ (col,row,seed) は常に同じ結果(力尽き → 同盤面で同じ配置が再現)。
function spaceMonsterAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return null;
  if (isGirlAt(col, row, seed)) return null;
  const h = hash3(col + 313, row + 197, seed + 8821);
  if (h >= SPACE_SPAWN_RATE) return null;
  const dband = getDungeonBand(row);
  if (dband) {
    const mw = dband.monW;
    const spW = [mw[0], mw[1], mw[2], mw[3], mw[5]]; // BAT,SLIME,SLIME_HALF,SNAKE,SPIDER (space=1)
    const spS = [MON.BAT, MON.SLIME, MON.SLIME_HALF, MON.SNAKE, MON.SPIDER];
    const total = spW[0] + spW[1] + spW[2] + spW[3] + spW[4];
    if (total <= 0) return null;
    const h2 = hash3(col + 401, row + 89, seed + 8821);
    const pick = h2 * total;
    let acc = 0;
    for (let i = 0; i < spS.length; i++) { acc += spW[i]; if (pick < acc) return spS[i]; }
    return spS[spS.length - 1];
  }
  const frac = row / C.DEPTH_ROWS;
  let band = SPACE_SPAWN_BANDS[SPACE_SPAWN_BANDS.length - 1];
  for (const b of SPACE_SPAWN_BANDS) { if (frac <= b.maxFrac) { band = b; break; } }
  const pick = Math.floor(hash3(col + 401, row + 89, seed + 8821) * band.species.length);
  return band.species[Math.min(pick, band.species.length - 1)];
}

// SOIL/HARD を掘り抜いた瞬間、埋没掘りスポーンが起きるか(決定論)。起きれば種キー、なければ null。
// 深度帯から候補種を 1 つ選び、その種の bury%(埋没掘りper) を決定論ハッシュしきい値で判定。
// これが「気を抜くと死ぬ」核(掘る手が止まらない緊張)。GIRL マスは呼び出し側で除外。
function buryMonsterAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return null;
  if (isGirlAt(col, row, seed)) return null;
  const presence = hash3(col + 233, row + 617, seed + 3001);
  if (presence >= BURY_PRESENCE_RATE) return null;
  let key;
  const dband = getDungeonBand(row);
  if (dband) {
    const mw = dband.monW;
    const buW = [mw[1], mw[2], mw[3], mw[4], mw[5]]; // SLIME,SLIME_HALF,SNAKE,WORM,SPIDER (bury>0)
    const buS = [MON.SLIME, MON.SLIME_HALF, MON.SNAKE, MON.WORM, MON.SPIDER];
    const total = buW[0] + buW[1] + buW[2] + buW[3] + buW[4];
    if (total <= 0) return null;
    const h2 = hash3(col + 557, row + 271, seed + 6173);
    const pick = h2 * total;
    let acc = 0;
    key = buS[buS.length - 1];
    for (let i = 0; i < buS.length; i++) { acc += buW[i]; if (pick < acc) { key = buS[i]; break; } }
  } else {
    const frac = row / C.DEPTH_ROWS;
    let band = BURY_SPAWN_BANDS[BURY_SPAWN_BANDS.length - 1];
    for (const b of BURY_SPAWN_BANDS) { if (frac <= b.maxFrac) { band = b; break; } }
    const pick = Math.floor(hash3(col + 557, row + 271, seed + 6173) * band.species.length);
    key = band.species[Math.min(pick, band.species.length - 1)];
  }
  const m = MONSTER[key];
  if (!m) return null;
  const h = hash3(col + 1019, row + 643, seed + 6173);
  return h < m.bury / 100 ? key : null;
}

// ---- 水/マグマ 浸水ハザード — 原作忠実(v0.6.0) -------------------------
// 原作仕様(MINE_ROAD_仕様まとめ 行34/104): 水中・マグマ中は泳げる(移動できる)がスタミナを
// 激しく消耗。マグマは特に危険。深く潜るほど水/マグマが増える難度カーブ。
//
// tileType には混ぜない(既存 girlPositions・determinism snapshot・oreAt・monster レイヤー・
// タイル分布を一切変えないため)。水/マグマは「空間(NONE=元空間 or 掘った跡)に被さる浸水フラグ」
// として別オーバーレイレイヤーで持つ(固体土の中は浸水しない=掘り抜いて初めて現れる)。自機/女の子は
// その空間に入れるが浸水ペナルティを受ける(原作「泳げるが激消耗」)。GIRL マス・地表(row0)・範囲外は
// NONE を返す(救出対象/帰還地点には浸水させない)。同じ (col,row,seed) は常に同じ結果(力尽き →
// 同盤面で同じ浸水配置が再現)。
const HAZARD = {
  NONE: 0,
  WATER: 1, // 水。v0.16.0: 息(swimTurns)が切れると毎ターン HP 直撃(drownDamage)。
  MAGMA: 2, // マグマ。v0.16.0: 猶予なし毎ターン HP−ceil(maxHP/5) 直撃。長居は死。
};

// ある (col,row) の浸水ハザード種を返す(決定論・乱数禁止)。浸水しないなら HAZARD.NONE。
// v0.16.0: 流体の実体はランタイム state G.fluid(app.js)へ移り、本関数は「初期配置(startDive の
// seedFluids)・掘り当て湧出(releaseFluidAt)の決定論抽選」として温存(ハッシュ・位相 非介入)。
// GIRL マス・地表・範囲外は NONE。tileType/oreAt/monster と別位相のハッシュ(+1597/+2389/+7919)。
function hazardAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return HAZARD.NONE;
  if (col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return HAZARD.NONE;
  if (isGirlAt(col, row, seed)) return HAZARD.NONE;
  const band = getDungeonBand(row);
  if (!band || band.hazardRate <= 0) return HAZARD.NONE;
  const presence = hash3(col + 1597, row + 2389, seed + 7919);
  if (presence >= band.hazardRate) return HAZARD.NONE;
  if (band.magmaFrac <= 0) return HAZARD.WATER;
  const kindH = hash3(col + 2389, row + 7919, seed + 1597);
  return kindH < band.magmaFrac ? HAZARD.MAGMA : HAZARD.WATER;
}

// ---- なだれ/落盤 崩落物理 — 原作忠実翻案(v0.7.0) ------------------------
// 原作 dungeon.csv のブロック種分布に「なだれ土 SOIL_AVALANCHE_HARD」が実在し、深いほど分布が
// 増える(裏庭0/防空壕floor10〜1/廃炭鉱floor40=6/埋没城跡floor40〜12)。崩落の詳細物理(崩れ方・
// ダメージ・埋没判定)は一次資料に明記が無いため、忠実意図に沿った決定論翻案: なだれ土=支えを失うと
// 崩れ落ちる不安定な土。掘り抜いた後、真下が空くと落下して掘った道を塞ぎ、自機/女の子を埋めて
// ダメージ。tileType には混ぜない(既存 girlPositions・determinism snapshot・oreAt・monster・
// hazard・タイル分布を一切変えないため)。SOIL マスに「これは不安定土(なだれ土)」という意味論を
// 別オーバーレイで重ねるだけ(初期生成のハッシュ消費を増やさない)。崩落の動的 state は app.js 側の
// ランタイム state(G.fallen 等)に持つ。同じ (col,row,seed) は常に同じ結果(決定論再挑戦)。
//
// 深度ゲート: 裏庭 ID0 は AVALANCHE=0(チュートリアルは安全)だが、v0.6.0 の水/マグマ同様
// 「深いほど増える」忠実意図に沿った自前カーブで翻案。中層帯(row>=5)から出し、深いほど密度↑
// (浅層 row1-4 は崩落なし=安全帯を保つ)。
// ある (col,row) の SOIL が「不安定土(なだれ土)」か(決定論・乱数禁止)。SOIL でないマスは false
// (呼び出し側で tileType==SOIL を保証 or ここで判定)。GIRL マス・地表・範囲外・浅層は false。
// 別位相ハッシュ(+2671/+3331/+9173)。oreAt(+911/+733/+5557)・spaceMonster(+313/+197/+8821)・
// buryMonster(+233/+617/+3001)・hazard(+1597/+2389/+7919)・tileType(col,row,seed) と非衝突。
function avalancheAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0) return false;
  if (col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return false;
  if (isGirlAt(col, row, seed)) return false;
  if (tileType(col, row, seed) !== TILE.SOIL) return false;
  const band = getDungeonBand(row);
  if (!band || band.avalancheRate <= 0) return false;
  const h = hash3(col + 2671, row + 3331, seed + 9173);
  return h < band.avalancheRate;
}

// ---- キノコ(交換通貨) — 原作忠実翻案(v0.8.0) -------------------------
// 原作 item.csv: キノコ(ID31, type ITEM)=「かわいいキノコ。交換のための通貨として利用できる。
// 食べることも可能」。原作では地中で採取/栽培(青いタネ←キノコ10)して集め、商人(shop.csv)で
// 道具と交換する物々交換(バーター)の基軸通貨。本リメイクには未導入だったため、v0.8.0 で商人と
// 同時に「キノコ通貨の循環」を開く。
//
// 採取の入口は oreAt(v0.4.0)と同じ「掘り抜いたマスの決定論ドロップ」別レイヤーとして実装する
// (原作「地中で採取するキノコ」に忠実、かつ tileType/girlPositions/oreAt/monster/hazard/avalanche
// に一切介入しない=非介入方針 v0.4.0〜v0.7.0 踏襲)。SOIL を掘り抜いた瞬間に mushroomAt を引き、
// 含有ならインベントリへ加算。oreAt と同じく深度で控えめに分布(浅層も出る=序盤から通貨が貯まる)。
// GIRL マスは出さない(救出対象)。同じ (col,row,seed) は常に同じ結果(決定論再挑戦)。
//
// 位相オフセット(既存5レイヤーと非衝突): oreAt(+911/+733/+5557)・spaceMonster(+313/+197/+8821)・
// buryMonster(+233/+617/+3001)・hazard(+1597/+2389/+7919)・avalanche(+2671/+3331/+9173)・
// tileType(col,row,seed) と衝突しない新オフセット +4099/+5113/+2027 を採用。
const MUSHROOM_RATE = 0.14; // 掘り抜いた SOIL のうちキノコを含む割合(控えめ、深度非依存=序盤から通貨化)。

// ある (col,row) を掘り抜いたときキノコを 1 個産出するか(決定論・乱数禁止)。GIRL/地表/範囲外は false。
function mushroomAt(col, row, seed) {
  const C = (typeof window !== "undefined" && window.CONST) || TILES_FALLBACK_CONST;
  if (row <= 0 || col < 0 || col >= C.GRID_COLS || row > C.DEPTH_ROWS) return false;
  if (isGirlAt(col, row, seed)) return false; // 救出対象マスはキノコなし。
  const h = hash3(col + 4099, row + 5113, seed + 2027); // 既存5レイヤー + tileType と非衝突。
  return h < MUSHROOM_RATE;
}

// ---- 商人(物々交換) — 原作 shop.csv 忠実翻案(v0.8.0) -------------------
// 原作 shop.csv は「作る品(craft ID/個数) ← 対価(SALE ITEM 名 + 個数、最大3対価)」の物々交換表。
// 数値・設計意図のみ参照し、データは自前で書き起こす(原作テキスト/コードは転用しない)。
//
// 翻案判断(STATUS に記録): shop.csv のレシピは原作 item.csv の全アイテム(タネ/バケツ/ロープ等)を
// 対価/産物に使うが、本リメイクの経済系は① 鉱石 G.ore(v0.14.0 で原作実名6種へ名寄せ)② モンスター
// ドロップ G.drops(動物の血/生肉/ルビー/クモの糸/解毒薬等, v0.5.0 verbatim)③ キノコ(v0.8.0)の
// 3 系統。「対価が現経済系に実在し、かつ産物が既存メカに接続して dead-item にならない」行だけを実装
// する(産物が使えない行=タネ各種/バケツ/ロープ/マジックハンド/木の杭/爆弾/種火/骨10←ルビー1/
// キノコ100←夢キノコ1 は、支えるメカが未実装 or 既存経済の逆流になるため次以降に送る)。
// v0.14.0 で焼き肉(shop.csv 行「焼き肉1←鋼2」verbatim)を追加=ore の鋼 sink をもう1つ開く。
//
// レシピモデルは CRAFT_RECIPES に揃える(v0.14.0 で cost 形を統一)。cost は通貨種別ごとに分けて持つ:
//   ore:  ORE_META.key (COAL/IRON_ORE/FOSSIL/STEEL/RUBY/DIAMOND) → 個数
//   item: G.drops のキー(日本語アイテム名) → 個数(モンスタードロップを対価にできる行用)
//   mushroom / dreamMushroom: キノコ / 夢キノコ → 個数
// result: { type:"pick"|"tool"|"consumable", id, name }(doShopTrade が消費/付与を解決)。
const SHOP_RECIPES = [
  // フルーツ ← 鉄鉱石2(shop.csv 行2 の数値=鉄鉱石2。フルーツは item.csv HP25/SP200 の回復実=消耗品)。
  { id: "shop_fruit", name: "フルーツ", desc: "体力+25", result: { type: "consumable", id: "FRUIT" }, cost: { ore: { IRON_ORE: 2 } } },
  // 焼き肉 ← 鋼2(shop.csv 行3 verbatim)。item.csv 焼き肉=HP40/SP500(生肉のマグマ変化品と同一)。
  { id: "shop_roast", name: "焼き肉", desc: "体力+40", result: { type: "consumable", id: "ROAST_MEAT" }, cost: { ore: { STEEL: 2 } } },
  // ツルハシ ← キノコ10(shop.csv 行12)。原作の鋼ツルハシ(item27)= 本リメイクの IRON 段へ(power ゲート接続)。
  { id: "shop_pick", name: "ツルハシ", desc: "鉄のツルハシ", result: { type: "pick", id: "IRON" }, cost: { mushroom: 10 } },
  // アンテナ ← キノコ20(shop.csv 行15)。v0.14.0: 所持数を1個増やす(設置型ツールの補充)。
  { id: "shop_antenna", name: "アンテナ", desc: "設置して電波網を広げる", result: { type: "tool", id: "ANTENNA" }, cost: { mushroom: 20 } },
  // 夢キノコ ← キノコ100(shop.csv 行16。既存 v0.8.0 実装の向きを維持=次増分の再検討候補、本増分では非変更)。
  { id: "shop_dream", name: "夢キノコ", desc: "体力+回復の高級キノコ", result: { type: "consumable", id: "DREAM_MUSHROOM" }, cost: { mushroom: 100 } },
];

// 商人レシピ rec の対価(ore/drops/mushroom)が現在の所持で足りるか。
function canTrade(rec, G) {
  if (!G) return false;
  const c = rec.cost || {};
  if (c.ore) for (const k of Object.keys(c.ore)) if (((G.ore && G.ore[k]) || 0) < c.ore[k]) return false;
  if (c.item) for (const k of Object.keys(c.item)) if (((G.drops && G.drops[k]) || 0) < c.item[k]) return false;
  if (c.mushroom && (G.mushrooms || 0) < c.mushroom) return false;
  if (c.dreamMushroom && (G.dreamMushrooms || 0) < c.dreamMushroom) return false;
  return true;
}

// ---- 育成(PER_*) — 原作 §4「キャラクター育成＝パラメータのレベルアップ制」忠実(v0.9.0) ----
// 原作の強化対象パラメータ enum(ab.a)。本リメイクでは裏庭=BP100%(dungeon_info ID0)に忠実に、
// 救出した女の子の「情報」→ボーナスポイント(BP)→各 PER_* レベルアップへ消費する単一通貨路を開く。
// レベルが上がると既存の育成フック(HP_MAX/STAMINA_MAX/掘削手数/ATK_BASE/DEF_BASE/SWIM_MITIGATION)の
// 有効値が動く(app.js の effXxx ヘルパーがレベルを掛ける=フックの消費先を開く)。
//   PER_ARROW は原作も「矢=遠距離攻撃が本リメイク未実装」のため対象外(原作 §4 にも未実装機能と注記)。
//   PER_BP(ボーナスポイント枠)は「振れる通貨そのもの」なので独立 PER としては育てず通貨 G.bp で表す。
// 各エントリ: key(内部名) / label(表示) / per(レベルあたりの効果増分の説明) / max(レベル上限)。
const PER_DEFS = [
  { key: "HP", label: "体力", effect: "+5 / Lv", max: 5 }, // PER_HP → HP_MAX を +HP_PER_LV ずつ。
  { key: "ST", label: "スタミナ", effect: "+20 / Lv", max: 5 }, // PER_ST → STAMINA_MAX を +ST_PER_LV ずつ。
  { key: "DIG", label: "掘削", effect: "手数 -1 / Lv", max: 2 }, // PER_DIG → 掘削手数を -1(最低 1 で頭打ち)。
  { key: "ATTACK", label: "攻撃", effect: "+1 / Lv", max: 5 }, // PER_ATTACK → ATK_BASE を +1 ずつ。
  { key: "DEFENCE", label: "防御", effect: "+1 / Lv", max: 5 }, // PER_DEFENCE → DEF_BASE を +1 ずつ。
  { key: "SWIM", label: "水泳", effect: "息+5ターン・溺れ軽減 / Lv", max: 4 }, // PER_SWIM → 息の延長 + 溺れダメージ減額(v0.16.0 原作合わせ=減算系)。
];
// PER 別のレベルあたり効果量(app.js の effXxx ヘルパーが参照。単一ブロックに集約=対症療法回避)。
const PER_GAIN = {
  HP_PER_LV: 5, // PER_HP 1 レベルで HP_MAX が +5。
  ST_PER_LV: 20, // PER_ST 1 レベルで STAMINA_MAX が +20。
  DIG_PER_LV: 1, // PER_DIG 1 レベルで掘削手数 -1(effDigTaps で最低 1 に clamp)。
  ATK_PER_LV: 1, // PER_ATTACK 1 レベルで ATK_BASE が +1。
  DEF_PER_LV: 1, // PER_DEFENCE 1 レベルで DEF_BASE が +1。
  // SWIM_PER_LV(旧 0.5=乗算軽減の係数)は v0.16.0 で撤去。SWIM の効きは app.js の swimTurns()/
  // drownDamage()(CONST.SWIM_BREATH_PER_LV / DROWN_DMG_BASE)= 原作の減算系へ引き直した。
};
// 育成通貨の換算(原作「情報→BP/スキルポイント、変換すると情報は消費」/ EXP 用途を自機育成へ開く)。
const GROW_RATE = {
  INFO_TO_BP: 3, // 情報 1(救出した女の子の情報)→ ボーナスポイント 3。
  EXP_TO_BP: 20, // EXP 20(撃破で蓄積)→ ボーナスポイント 1(v0.5.0 で死蔵していた EXP の用途を開く)。
};
// PER をレベル lvl から lvl+1 へ上げるのに要る BP(現レベルに応じ逓増。1 箇所に集約=閾値を散らさない)。
// コスト式: 基本 2 BP + 現レベル ×1(Lv0→1=2 / Lv1→2=3 / Lv2→3=4 …)。決定論(乱数なし)。
function bpCostFor(perKey, lvl) {
  return 2 + lvl; // perKey は将来 PER 別単価に拡張できるよう引数に残す(現状は共通式)。
}

// ---- 仲間同行(原作 §5「1人だけ仲間として連れて潜れる→一緒に戦い EXP 蓄積→地上で別れて ---
// レベルアップ→別れると再び情報としてストック」忠実、v0.10.0) -----------------------------
// 同行は「following 中(護衛しながら一緒に進む)女の子1人を G.companion に指定」する翻案(新 state を
// 作らず既存 following の追従/重力/GIRLATK/ロスト物理を非介入で再利用)。撃破 EXP を companion.cexp に
// 並走で貯め(自機プール G.exp=v0.9.0 BP 路は不変=二面両立)、地表帰還(rescueGirl)で cexp→level に
// 反映して別れる。レベルが上がると effCompanionAtk() で自機攻撃力に援護が乗る(原作「一緒に戦う」)。
// 各エントリは UI 説明用(実効値・コストは app.js の CONST/ヘルパー側)。
const COMPANION_DEFS = {
  // 同行で得られる二面: 護衛の難度(GIRLATK でロストしうる)× 育てた仲間が戦力(援護)になる報酬。
  note: "同行中は一緒に戦い経験値を貯め、地上で別れるとレベルが上がる(次の同行が強くなる)。",
};
// 貯めた同行 EXP(cexp)から「上げられるレベル数」を返す決定論換算。EXP perLevel ごとに 1 レベル。
// 端数は呼び出し側(rescueGirl)が cexp に繰り越し残す。乱数なし(状態遷移のみ)。
function companionLevelGain(cexp, perLevel, lvMax, curLevel) {
  if (perLevel <= 0) return 0;
  const raw = Math.floor((cexp || 0) / perLevel);
  const room = Math.max(0, lvMax - (curLevel || 0)); // レベル上限を越えない。
  return Math.min(raw, room);
}

// 撃破ドロップ(決定論)。drops の per% を「累積しきい値で 1 種だけ落とす」抽選にする
// (原作 PSUM=100 系=合計100の重み付き 1 抽選)。落ちなければ null。kill ごとに固有の位相。
function monsterDrop(key, col, row, seed) {
  const m = MONSTER[key];
  if (!m || !m.drops || !m.drops.length) return null;
  const h = hash3(col + 1471, row + 829, seed + 4493); // [0,1)
  let acc = 0;
  for (const d of m.drops) {
    acc += d.per / 100;
    if (h < acc) return d.item;
  }
  return null; // per 合計 < 100 の端数 = 何も落とさない。
}

// app.js 未読込でも tiles.js 単体で node --check が通るフォールバック定数。
const TILES_FALLBACK_CONST = {
  GRID_COLS: 15,
  DEPTH_ROWS: 15,
  GIRL_COUNT: 5,
  DUNGEON_ID: 0,
};

// ---- PALETTE(深度軸 + 掘った道) --------------------------------------
// 地表 = 明色(安全)。下へ深度で暗くなる質量。掘った空間は道として相対的に明るい。
// 女の子 = 暖色自発光。自機 = 常時最明。fog の黒に埋もれないよう前景は別系統で描く。
const PALETTE = {
  // 地表 = 夜明けの藍白(安全・全回復・帰還地点)。
  surface: "#cdd6e8",
  // 土(未掘削の質量): 浅 → 深 で暗くなる琥珀〜土褐。
  soilShallow: "#7a5836",
  soilDeep: "#3a2c1e",
  // 硬土 = 土より青灰寄りで硬さを示す。
  hard: "#5a5240",
  // 硬岩 = 掘れない灰青(明るめの質量で「壁」と分かる)。
  rock: "#7e8290",
  // 掘った空間(道) = 深部の闇よりわずかに明るい藍。地表に近いほど明るい。
  caveShallow: "#2a2f3e",
  caveDeep: "#14161f",
  // fog(未可視) = ほぼ黒。
  fog: "#070809",
  // 女の子 = 暖色自発光(朱寄りの暖橙)。
  girl: "#ffb86a",
  // 自機 = 暖白(常時最明)。
  miner: "#fff3d0",
  // 体力バー = 朱(危険ゾーン)。
  hp: "#d8392a",
  // スタミナバー = 暖橙。
  stamina: "#e6b25a",
  // 暁の光(救出 → 地表の勝利演出)。
  dawn: "#e7b98a",
  // v0.6.0 浸水ハザード(空洞の塗りに半透明で重ねる)。水=青系/マグマ=赤橙系。
  water: "#2f6fb0", // 水の浸水(青)。
  magma: "#d8542a", // マグマの浸水(赤橙、特に危険)。
  // v0.7.0 なだれ/落盤(不安定土を SOIL 上に赤錆オーバーレイで示す=崩れそうの予兆)。
  avalanche: "#b5532a", // 不安定土(なだれ土)の赤錆色。掘ると崩れて道を塞ぐ。
  // v0.8.0 商人(キノコ通貨。採取ポップ + HUD アイコンの色)。
  mushroom: "#c98a6a", // キノコ(交換通貨)の淡赤茶。
};

if (typeof window !== "undefined") {
  window.TILE = TILE;
  window.TILE_DIG_KEY = TILE_DIG_KEY;
  window.tileType = tileType;
  window.blockThresholds = blockThresholds;
  window.girlPositions = girlPositions;
  window.isGirlAt = isGirlAt;
  window.tilesHash3 = hash3;
  window.PALETTE = PALETTE;
  // v0.14.0 アイテムカタログ(item.csv 全45種 verbatim)。
  window.ITEM_DATA = ITEM_DATA;
  // v0.4.0 アイテム/クラフト系。
  window.ORE = ORE;
  window.ORE_META = ORE_META;
  window.oreAt = oreAt;
  window.PICK = PICK;
  window.TILE_REQ_POWER = TILE_REQ_POWER;
  window.CRAFT_RECIPES = CRAFT_RECIPES;
  // v0.5.0 モンスター系(verbatim データ + 決定論スポーン/ドロップ)。
  window.MON = MON;
  window.MONSTER = MONSTER;
  window.spaceMonsterAt = spaceMonsterAt;
  window.buryMonsterAt = buryMonsterAt;
  window.monsterDrop = monsterDrop;
  // v0.6.0 水/マグマ 浸水ハザード(別オーバーレイレイヤー、決定論)。
  window.HAZARD = HAZARD;
  window.hazardAt = hazardAt;
  // v0.7.0 なだれ/落盤 崩落物理(別オーバーレイレイヤー、決定論)。
  window.avalancheAt = avalancheAt;
  // v0.8.0 商人(キノコ採取の決定論ドロップ + 物々交換レシピ)。
  window.mushroomAt = mushroomAt;
  window.SHOP_RECIPES = SHOP_RECIPES;
  window.canTrade = canTrade;
  // v0.9.0 育成(PER_* レベルアップ。データ + コスト式。実効値ヘルパーは app.js 側)。
  window.PER_DEFS = PER_DEFS;
  window.PER_GAIN = PER_GAIN;
  window.GROW_RATE = GROW_RATE;
  window.bpCostFor = bpCostFor;
  // v0.10.0 仲間同行(同行 EXP→レベル換算 + 説明データ。実効値ヘルパーは app.js 側)。
  window.COMPANION_DEFS = COMPANION_DEFS;
  window.companionLevelGain = companionLevelGain;
  // v0.13.0 全9ダンジョンデータ(マスター + 深度帯)。
  window.DUNGEON_DATA = DUNGEON_DATA;
  window.DUNGEON_BANDS = DUNGEON_BANDS;
  window.getDungeonBand = getDungeonBand;
}
