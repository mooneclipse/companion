"use strict";
// さぐり — 断章 + UI 文言 — verbatim 静的データ(lead 確定、implementer は改変しない)。
//
// 断章(FRAGMENTS): 女の子を 1 人 地表へ救出するごとに 1 行表示する補助テキスト。
//   ゲーム判定には非関与・読まなくても成立する。救出回数(1..8)で順に出し、9 回目以降は
//   循環して出す(エンドレスでも文言が尽きない)。lead 確定の 8 行を verbatim で持つ。
//
// TEXT: UI ラベル・あそびかた等の文言。emoji 不可。アイコン+数値主体・全角 12 字上限。

// 断章 8 行(救出ごとに 1 行・補助・ゲーム判定に非関与・読まなくても成立)。
const FRAGMENTS = [
  "ずっと、上の光だけ見てた",
  "掘る音が、近づいてきた",
  "暗いほうが、静かでよかったの",
  "あなたの足音、おぼえてる",
  "光の道、こわかったけど",
  "土の重さ、もう忘れていい？",
  "ひかりって、あたたかい",
  "またうえで、会えるかな",
];

const TEXT = {
  title: "さぐり",
  start: "タップでもぐる",
  bestRescuePrefix: "救出 ",
  bestRescueSuffix: " 人",
  bestDepthPrefix: "最深 ",
  bestDepthSuffix: " 層",
  // 地表基地ショップ(救出ポイントで強化を買う)。
  shopTitle: "基地（強化を買う）",
  shopNonePrefix: "女の子を救うと強化が買える",
  shopSkip: "もぐる",
  shopStockLabel: "ポイント",
  shopOwned: "取得済み",
  shopBuy: "購入",
  shopLockedTier: "深く救うと解放",
  ptPopupPrefix: "＋", // 救出ポイント加算の「＋N」演出。
  // 失敗(スタミナが尽きた)。
  failTitle: "力、尽きた",
  failReachPrefix: "連れ帰れなかった",
  retry: "もう一度",
  // 勝利(最下層の女の子を地表へ導いた)。
  clearTitle: "暁が、差した",
  clearSub: "みんな、上へ",
  again: "もっと深く",
  // HUD ラベル。
  depthPrefix: "深度 ",
  depthSuffix: " 層",
  staminaCap: "力",
  // 気配メーター(最寄りの女の子への方向 + 距離ヒート)。
  senseCap: "気配",
  senseNone: "気配なし",
  senseFar: "とおい",
  senseMid: "ちかい",
  senseNear: "すぐそば",
  rescueLabel: "救出",
  escortLabel: "同行",
  // あそびかた説明(verbatim、実装側で改変しない)。
  howtoTitle: "あそびかた",
  howto: [
    "となりをタップ／下の十字キー＝掘る。掘ると前に進む。",
    "掘った面の数字＝まわり8マスの落盤の数。0なら安全。",
    "長押し＝あぶないマスに印（旗）をつける。",
    "気配メーターの矢印＝女の子の方向。掘って近づく。",
    "落盤の真下を掘ると次の手番で落ちる。数字で読んで避ける。",
    "女の子に触れると同行。掘った道を通って地表（上）へ。",
    "力（スタミナ）が尽きる前に地表へ。尽きると連れ帰れない。",
  ],
  howtoStart: "もぐる",
  howtoBack: "もどる",
  howtoButton: "あそびかた",
  // ヒント文言(cue、短く)。
  cueCaveinWarn: "落盤がきた",
  cueCaveinBuried: "道がふさがった",
  cueRescued: "みつけた",
  cueEscortStart: "ついてくる",
  cueEscortBlocked: "道がない（掘り直し）",
  cueSupportUsed: "支え木でしのいだ",
  cueSensorUsed: "センサ：落盤が見えた",
  cueLadderUsed: "ハシゴで上がった",
  cueNoStamina: "力が足りない",
  // 救出時の断章プレフィクス(無し。断章そのものを出す)。
  toolLabel: "道具",
};

if (typeof window !== "undefined") {
  window.FRAGMENTS = FRAGMENTS;
  window.TEXT = TEXT;
}
