"use strict";
// あかり — 明度(LIGHT)をリソースにする一画面固定ターン制デッキ構築ローグライク。
// バニラ JS、フレームワーク無し。ランタイムで外部 API / claude を呼ばない(唯一の外部
// 依存は CSS の和文フォント CDN)。CARDS/ENEMIES/FLOOR_THEMES/TEXT は別ファイルの global。
//
// 文字・カード・HUD は全て DOM(なごり「文字がはみ出して読めない」真因の直接対策)。
// canvas には背景の光(自キャラ中心の放射光円)と敵シルエットだけを焼く。
//
// 核メカニクス: 攻カードは明るいほど強く撃つと暗くなる/灯カードは明るくする/暗いほど
// 被ダメ増。毎手番「攻めて暗くするか/灯して蓄えるか」が意思決定。

// ---- バージョン --------------------------------------------------------
// title 画面に薄く表示。**ゲーム本体に手を入れるたびに必ず上げる**(キャッシュ残存か
// 検証不足かを切り分けるため)。
const VERSION = "v1.3.0";

// ---- CONSTANTS(初期値、playtester で実測調整可。バランスは全てここに集約) ----
const CONST = {
  PLAYER_MAX_HP: 52, // 初回 playtest 調整で確定(bot クリア率を 0%→約30-55% の手応え帯へ)。
  MANA_PER_TURN: 3, // 毎ターンのマナ(灯量)。
  HAND_SIZE: 5, // 毎ターンのドロー枚数。
  LIGHT_START: 50, // LIGHT 初期値([0,100])。
  LIGHT_MIN: 0,
  LIGHT_MAX: 100,
  WIN_HEAL: 2, // 非ボス戦の勝利確定時の HP 回復(ローグライク標準の戦闘後リカバリ)。初回 playtest 調整で確定。
  SKIP_HEAL: 14, // 報酬スキップ時の追加 HP 回復(WIN_HEAL に上乗せ = 合計 16)。
  FLOORS: 6, // 1 ラン の戦数(最後 = ボス)。
  REWARD_CHOICES: 3, // 戦闘後に提示するカード枚数。
  TAKEN_DARK_FACTOR: 0.45, // 被ダメ倍率: 1 + (100-L)/100 * この係数(0.6→0.45 でスパイラル緩和)。
};
// バランス計測 bot から係数を上書きできるよう公開(本番挙動は CONST の初期値で確定)。
if (typeof window !== "undefined") window.CONST = CONST;
const BEST_KEY = "akari_best";

// ---- 明度スケール関数(仕様の核) --------------------------------------
// L は 0..100。
function atkLightScale(L) {
  return 0.5 + L / 100; // 明攻: 明るいほど強い(0.5〜1.5)。
}
function atkDarkScale(L) {
  return 0.5 + (100 - L) / 100; // 闇攻: 暗いほど強い(0.5〜1.5)。
}
function takenMult(L) {
  return 1 + ((100 - L) / 100) * CONST.TAKEN_DARK_FACTOR; // 被ダメ: 暗いほど増。
}
function clampLight(L) {
  return Math.max(CONST.LIGHT_MIN, Math.min(CONST.LIGHT_MAX, L));
}

// ---- DOM 参照 ----------------------------------------------------------
const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const battleEl = document.getElementById("battle");
const enemyAreaEl = document.getElementById("enemy-area");
const floorLabelEl = document.getElementById("floor-label");
const lightFillEl = document.getElementById("light-fill");
const lightValEl = document.getElementById("light-val");
const playerHpEl = document.getElementById("player-hp");
const playerBlockEl = document.getElementById("player-block");
const playerManaEl = document.getElementById("player-mana");
const handEl = document.getElementById("hand");
const endTurnBtn = document.getElementById("end-turn");
const battleHintEl = document.getElementById("battle-hint");

const overlayEl = document.getElementById("overlay");
const ovTitleEl = document.getElementById("ov-title");
const ovSubEl = document.getElementById("ov-sub");
const ovHowtoEl = document.getElementById("ov-howto");
const ovCardsEl = document.getElementById("ov-cards");
const ovActionEl = document.getElementById("ov-action");
const ovAction2El = document.getElementById("ov-action2");
const ovVersionEl = document.getElementById("ov-version");

// ---- canvas / 描画状態 -------------------------------------------------
let DPR = 1;
let W = 0;
let H = 0;
let elapsed = 0;
let lastT = 0;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// ---- 色補間(なごり踏襲) ----------------------------------------------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}
function rgbStr(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ---- ゲーム状態 --------------------------------------------------------
// screen: "title" / "battle" / "reward" / "defeat" / "clear"。
const G = {
  screen: "title",
  floor: 0, // 1..FLOORS(現在の戦)。
  hp: CONST.PLAYER_MAX_HP,
  light: CONST.LIGHT_START,
  block: 0,
  mana: 0,
  deck: [], // ドロー山(card id 配列)。
  hand: [], // 手札(card id 配列)。
  discard: [], // 捨札(card id 配列)。
  enemies: [], // [{name, hp, maxHp, block, intentSet, turnIndex, dead, charging}]。
  powers: [], // 戦闘中の持続効果 [{power, amount}]。
  nextAtkMult: 1, // 集光バフ(次の攻カードに ×)。1 = なし。
  selectingTarget: null, // 対象選択待ちのカード {handIdx, card}。
  busy: false, // 敵手番アニメ中などの入力ロック。
};
// テストから読めるよう公開。
window.G = G;

// ---- localStorage 最高到達 --------------------------------------------
function getBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
  } catch (e) {
    return 0;
  }
}
function setBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch (e) {
    /* localStorage 不可環境でもゲームは成立させる(記録のみ諦める) */
  }
}
const HOWTO_KEY = "akari_seen_howto";
function seenHowto() {
  try {
    return localStorage.getItem(HOWTO_KEY) === "1";
  } catch (e) {
    return false; // 読めない環境では「未読」扱い(初回 howto を出す。ゲームは成立)。
  }
}
function markHowtoSeen() {
  try {
    localStorage.setItem(HOWTO_KEY, "1");
  } catch (e) {
    /* 記録できない環境でも進行はできる(毎回 howto が出るだけ) */
  }
}

// ---- ラン初期化 --------------------------------------------------------
function buildStarterDeck() {
  const deck = [];
  for (const e of STARTER_DECK) {
    for (let i = 0; i < e.n; i++) deck.push(e.id);
  }
  return deck;
}
function newRun() {
  G.hp = CONST.PLAYER_MAX_HP;
  G.deck = [];
  G.hand = [];
  G.discard = [];
  G.fullDeck = buildStarterDeck(); // ラン通しの所持カード(戦闘開始時にここから配り直す)。
  G.floor = 0;
  startFloor(1);
}

// ---- 戦闘開始 ----------------------------------------------------------
function shuffle(arr) {
  // Fisher-Yates。Math.random は仕様で許可(山札シャッフル・報酬抽選)。
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startFloor(floor) {
  G.floor = floor;
  G.light = CONST.LIGHT_START;
  G.block = 0;
  G.powers = [];
  G.nextAtkMult = 1;
  G.selectingTarget = null;
  G.busy = false;
  // デッキを所持カード全体からシャッフルして山に積む。
  G.deck = shuffle(G.fullDeck.slice());
  G.hand = [];
  G.discard = [];
  // 敵を生成。
  const def = ENEMIES[floor - 1];
  G.enemies = [];
  for (let u = 0; u < def.units; u++) {
    G.enemies.push({
      name: def.name,
      hp: def.hp,
      maxHp: def.hp,
      block: 0,
      intentSet: def.intent,
      turnIndex: 0,
      dead: false,
      charging: false, // Charge 予告中(次が大攻撃)。
    });
  }
  G.bossFloor = def.boss;
  G.screen = "battle";
  hideOverlay();
  battleEl.hidden = false;
  startPlayerTurn();
}

// ---- ターン処理 --------------------------------------------------------
function drawCards(n) {
  for (let i = 0; i < n; i++) {
    if (G.deck.length === 0) {
      if (G.discard.length === 0) break; // 山も捨札も尽きたらドロー不可。
      G.deck = shuffle(G.discard);
      G.discard = [];
    }
    G.hand.push(G.deck.pop());
  }
}

function startPlayerTurn() {
  G.block = 0;
  G.mana = CONST.MANA_PER_TURN;
  G.nextAtkMult = 1;
  // 持続効果(燭台 = perTurnLight)をターン開始で発火。
  for (const p of G.powers) {
    if (p.power === "perTurnLight") {
      G.light = clampLight(G.light + p.amount);
    }
  }
  // 前ターンの手札は捨札へ送ってから引き直す。
  G.discard.push(...G.hand);
  G.hand = [];
  drawCards(CONST.HAND_SIZE);
  renderAll();
}

// ---- カード効果インタプリタ --------------------------------------------
// 1 枚のカードを使う。target = 敵 obj(単体攻撃の対象)or null。
function playCard(handIdx, target) {
  const id = G.hand[handIdx];
  const card = CARDS[id];
  if (!card || card.cost > G.mana) return false;

  G.mana -= card.cost;
  // 手札から除去 → 捨札へ。
  G.hand.splice(handIdx, 1);
  G.discard.push(id);

  for (const eff of card.effects) {
    applyEffect(eff, target);
  }
  spawnFlash(card.kind); // カード使用時の光走り(演出)。
  // 死亡反映。
  reapEnemies();
  return true;
}

function applyEffect(eff, target) {
  if (eff.dmg !== undefined) {
    const scale = eff.scale === "dark" ? atkDarkScale(G.light) : atkLightScale(G.light);
    let dmg = Math.round(eff.dmg * scale);
    if (G.nextAtkMult > 1) {
      dmg = dmg * G.nextAtkMult;
      G.nextAtkMult = 1; // 集光バフは 1 回で消費。
    }
    dealToEnemy(target, dmg);
  }
  if (eff.light !== undefined) {
    G.light = clampLight(G.light + eff.light);
  }
  if (eff.block !== undefined) {
    G.block += eff.block;
  }
  if (eff.blockFromLight !== undefined) {
    G.block += Math.floor(G.light / eff.blockFromLight);
  }
  if (eff.draw !== undefined) {
    drawCards(eff.draw);
  }
  if (eff.nextAtkMult !== undefined) {
    G.nextAtkMult = eff.nextAtkMult;
  }
  if (eff.power !== undefined) {
    G.powers.push({ power: eff.power, amount: eff.amount });
  }
}

function aliveEnemies() {
  return G.enemies.filter((e) => !e.dead);
}

function dealToEnemy(target, dmg) {
  // target 未指定なら生存敵が 1 体のときに自動。
  let e = target;
  if (!e || e.dead) {
    const alive = aliveEnemies();
    if (alive.length === 1) e = alive[0];
  }
  if (!e || e.dead) return;
  // 敵 block を先に削り、残りを HP へ。
  let d = dmg;
  if (e.block > 0) {
    const absorbed = Math.min(e.block, d);
    e.block -= absorbed;
    d -= absorbed;
  }
  if (d > 0) {
    e.hp = Math.max(0, e.hp - d);
    spawnPopup(e, "-" + d);
  }
}

function reapEnemies() {
  for (const e of G.enemies) {
    if (!e.dead && e.hp <= 0) e.dead = true;
  }
  if (aliveEnemies().length === 0 && G.screen === "battle") {
    winBattle();
  }
}

// ---- 敵手番 ------------------------------------------------------------
function currentIntent(e) {
  return e.intentSet[e.turnIndex % e.intentSet.length];
}
function advanceIntent(e) {
  e.turnIndex = (e.turnIndex + 1) % e.intentSet.length;
}

function endTurn() {
  if (G.busy || G.screen !== "battle") return;
  G.selectingTarget = null;
  enemyTurn();
}

// 敵手番の段階間隔(秒)。同期一括処理だと「敵が動いたのが見えない」(押した瞬間に
// 次の手札)ため、1 体ずつ間を置いて見せる。間こそが見える化の本体。
const ENEMY_STEP_MS = 600;

// 敵手番を「1 体ずつ間を置いて見せる」非同期シーケンスに。全期間 G.busy=true で入力ロック。
// busy は全終了パスで必ず false に戻す。screen が battle でなくなったら以降の step を打ち切る。
function enemyTurn() {
  G.busy = true;
  G.selectingTarget = null;
  // 手札のヒントを「てきのターン」に差し替え(updateTurnGuidance より優先するため直接書く)。
  battleHintEl.textContent = TEXT.enemyTurnLabel;
  battleHintEl.hidden = false;
  endTurnBtn.classList.remove("emphasize");

  const queue = aliveEnemies(); // この手番に動く敵(処理開始時点の生存敵)。
  let i = 0;

  function finishEnemyTurn() {
    G.busy = false;
    reapEnemies();
    if (G.hp <= 0) {
      lose();
      return;
    }
    if (G.screen !== "battle") return; // 念のため(敵手番中に勝利は起きないが保険)。
    startPlayerTurn();
  }

  function step() {
    // battle 以外へ遷移していたら打ち切り(busy も戻す)。
    if (G.screen !== "battle") {
      G.busy = false;
      return;
    }
    if (G.hp <= 0) {
      // 手番途中でプレイヤーが倒れた → 短い間を置いて敗北。
      setTimeout(() => {
        G.busy = false;
        lose();
      }, ENEMY_STEP_MS);
      return;
    }
    if (i >= queue.length) {
      finishEnemyTurn();
      return;
    }
    const e = queue[i];
    i++;
    if (e.dead) {
      // 既に死んでいる敵は飛ばす(間も置かない)。
      step();
      return;
    }
    // この敵を強調(acting フラグは enemy obj に持つ。renderAll で DOM 再生成されても残る)。
    e.acting = true;
    const acts = currentIntent(e);
    for (const a of acts) {
      enemyAct(e, a); // 被ダメ計算/intent 内容は不変。
    }
    advanceIntent(e);
    renderAll(); // HP/あかり/敵ブロック/intent/acting を反映。
    // 約 0.6 秒見せてから強調を解除し次の敵へ。
    G.enemyTurnTimer = setTimeout(() => {
      e.acting = false;
      renderAll();
      step();
    }, ENEMY_STEP_MS);
  }

  step();
}

function enemyAct(e, a) {
  if (a.type === "Charge") {
    // 予告のみ。intent 表示は次手番の大攻撃を指すよう charging を立てる。
    e.charging = true;
    spawnCue(TEXT.cueCharge); // 「ためる」cue(ゲージ付近)。
    return;
  }
  e.charging = false;
  if (a.type === "A") {
    const raw = Math.round(a.n * takenMult(G.light));
    // ブロックは減算が先、倍率非適用(= raw から block を引く)。
    const dmg = Math.max(0, raw - G.block);
    G.block = Math.max(0, G.block - raw);
    G.hp = Math.max(0, G.hp - dmg);
    spawnPlayerPopup("-" + dmg);
  } else if (a.type === "Guard") {
    e.block += a.n; // 敵ブロックバッジは renderAll で表示される。
  } else if (a.type === "Dim") {
    G.light = clampLight(G.light - a.n);
    spawnCue(TEXT.cueDimPrefix + "-" + a.n); // 「あかり -N」cue。
  }
}

// ---- 勝敗 --------------------------------------------------------------
function winBattle() {
  G.screen = "won-pending"; // reapEnemies の再入を防ぐ中間状態。
  if (G.bossFloor) {
    showClear();
  } else {
    // 非ボス戦の勝利確定で戦闘後リカバリ(報酬でカードを取っても回復する)。
    G.hp = Math.min(CONST.PLAYER_MAX_HP, G.hp + CONST.WIN_HEAL);
    showReward();
  }
}

function lose() {
  G.screen = "defeat";
  const reached = G.floor; // 到達した戦(その戦で倒れた)。
  const best = getBest();
  // 「到達戦数」= クリアした戦数。倒れた戦はクリアしていないので floor-1 を記録。
  const cleared = G.floor - 1;
  if (cleared > best) setBest(cleared);
  showDefeat(reached);
}

// ---- 報酬 --------------------------------------------------------------
function pickRewards() {
  const pool = REWARD_POOL.slice();
  shuffle(pool);
  return pool.slice(0, CONST.REWARD_CHOICES);
}

// ---- 画面遷移(overlay) -----------------------------------------------
function showOverlay() {
  overlayEl.hidden = false;
  // 次フレームで visible(transition を効かせる)。
  requestAnimationFrame(() => overlayEl.classList.add("visible"));
}
function hideOverlay() {
  overlayEl.classList.remove("visible");
  overlayEl.hidden = true;
  ovCardsEl.innerHTML = "";
  ovHowtoEl.innerHTML = "";
}
function resetOverlayParts() {
  ovTitleEl.hidden = true;
  ovTitleEl.classList.remove("reward-title");
  ovSubEl.hidden = true;
  ovHowtoEl.hidden = true;
  ovHowtoEl.innerHTML = "";
  ovCardsEl.hidden = true;
  ovCardsEl.innerHTML = "";
  ovActionEl.hidden = true;
  ovAction2El.hidden = true;
  ovVersionEl.hidden = true;
  ovActionEl.onclick = null;
  ovAction2El.onclick = null;
}

function showTitle() {
  G.screen = "title";
  battleEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.title;
  ovTitleEl.hidden = false;
  const best = getBest();
  ovSubEl.textContent = TEXT.bestPrefix + best + TEXT.bestSuffix;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.start;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => onStartPressed();
  // 副ボタン「あそびかた」: いつでも説明を再読できる。
  ovAction2El.textContent = TEXT.howtoButton;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => showHowto("title");
  ovVersionEl.textContent = VERSION;
  ovVersionEl.hidden = false;
  showOverlay();
}

// title の「はじめる」: 初回のみ あそびかた を挟んでから battle へ。2 回目以降は直行。
function onStartPressed() {
  if (!seenHowto()) {
    showHowto("start");
  } else {
    newRun();
  }
}

// あそびかた overlay。returnTo="start"=説明後に開始 / "title"=説明後にタイトルへ戻る。
function showHowto(returnTo) {
  G.screen = "howto";
  battleEl.hidden = true;
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.howtoTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("reward-title"); // 巨大タイトルサイズを使わない。
  ovHowtoEl.innerHTML = "";
  for (const line of TEXT.howto) {
    const p = document.createElement("p");
    p.className = "howto-line";
    p.textContent = line;
    ovHowtoEl.appendChild(p);
  }
  ovHowtoEl.hidden = false;
  if (returnTo === "start") {
    ovActionEl.textContent = TEXT.howtoStart;
    ovActionEl.onclick = () => {
      markHowtoSeen();
      newRun();
    };
  } else {
    ovActionEl.textContent = TEXT.howtoBack; // 再読経路は「もどる」でタイトルへ戻る(開始しない)。
    ovActionEl.onclick = () => showTitle();
  }
  ovActionEl.hidden = false;
  showOverlay();
}

function showReward() {
  G.screen = "reward";
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.reward;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("reward-title");
  ovCardsEl.hidden = false;
  const choices = pickRewards();
  for (const id of choices) {
    const cardEl = buildCardEl(CARDS[id], { playable: true });
    cardEl.onclick = () => {
      G.fullDeck.push(id);
      nextFloor();
    };
    ovCardsEl.appendChild(cardEl);
  }
  ovAction2El.textContent = TEXT.rewardSkip;
  ovAction2El.hidden = false;
  ovAction2El.onclick = () => {
    // winBattle で WIN_HEAL を済ませた上に SKIP_HEAL を上乗せ(合計 WIN_HEAL+SKIP_HEAL)。
    G.hp = Math.min(CONST.PLAYER_MAX_HP, G.hp + CONST.SKIP_HEAL);
    nextFloor();
  };
  showOverlay();
}
function nextFloor() {
  startFloor(G.floor + 1);
}

function showDefeat(reached) {
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.defeatTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("reward-title");
  ovSubEl.textContent = TEXT.defeatReachPrefix + reached + TEXT.defeatReachSuffix;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.retry;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => newRun();
  battleEl.hidden = true;
  showOverlay();
}

function showClear() {
  G.screen = "clear";
  const best = getBest();
  if (CONST.FLOORS > best) setBest(CONST.FLOORS);
  resetOverlayParts();
  ovTitleEl.textContent = TEXT.clearTitle;
  ovTitleEl.hidden = false;
  ovTitleEl.classList.add("reward-title");
  ovSubEl.textContent = TEXT.clearSub;
  ovSubEl.hidden = false;
  ovActionEl.textContent = TEXT.retry;
  ovActionEl.hidden = false;
  ovActionEl.onclick = () => newRun();
  battleEl.hidden = true;
  showOverlay();
}

// ---- DOM レンダリング ---------------------------------------------------
function badgeClass(kind) {
  return (
    "card-badge " +
    { atk: "badge-atk", light: "badge-light", block: "badge-block", tech: "badge-tech" }[
      kind
    ]
  );
}
function badgeLabel(kind) {
  return { atk: "攻", light: "灯", block: "守", tech: "技" }[kind];
}

function buildCardEl(card, opts) {
  opts = opts || {};
  const el = document.createElement("div");
  el.className = "card";
  if (opts.playable) el.classList.add("playable");
  if (opts.unplayable) el.classList.add("unplayable");

  const top = document.createElement("div");
  top.className = "card-top";
  const badge = document.createElement("span");
  badge.className = badgeClass(card.kind);
  badge.textContent = badgeLabel(card.kind);
  const cost = document.createElement("span");
  cost.className = "card-cost";
  cost.textContent = card.cost;
  top.appendChild(badge);
  top.appendChild(cost);

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = card.name;

  const text = document.createElement("div");
  text.className = "card-text";
  text.textContent = card.text;

  el.appendChild(top);
  el.appendChild(name);
  el.appendChild(text);
  return el;
}

function renderHand() {
  handEl.innerHTML = "";
  G.hand.forEach((id, idx) => {
    const card = CARDS[id];
    const playable = card.cost <= G.mana;
    const el = buildCardEl(card, {
      playable: playable,
      unplayable: !playable,
    });
    if (G.selectingTarget && G.selectingTarget.handIdx === idx) {
      el.classList.add("selected");
    }
    el.onclick = () => onCardTap(idx);
    handEl.appendChild(el);
  });
  updateTurnGuidance();
}

// 使えるカードの有無で「ターン終了」の強調と battle ヒントを切り替える。
// 詰まり(マナ枯渇でカードが灰色になり次の導線が分からない)の直接対策。
function updateTurnGuidance() {
  // 敵手番中(busy)は enemyTurn が「てきのターン」を出しているので上書きしない。
  if (G.busy) return;
  const anyPlayable = G.hand.some((id) => CARDS[id].cost <= G.mana);
  // ターン終了ボタンの強調(使えるカードが無いときだけ脈動 + 濃色)。
  endTurnBtn.classList.toggle("emphasize", !anyPlayable);
  // ヒント行(優先度: 対象選択 > 使えるカード無し > 非表示)。
  let hint = "";
  if (G.selectingTarget) hint = TEXT.hintSelectTarget;
  else if (!anyPlayable) hint = TEXT.hintNoPlayable;
  battleHintEl.textContent = hint;
  battleHintEl.hidden = hint === "";
}

function isSingleTargetAtk(card) {
  return card.effects.some((e) => e.dmg !== undefined);
}

function onCardTap(idx) {
  if (G.busy || G.screen !== "battle") return;
  // 対象選択中に同じカードを再タップ → 選択解除(詰まり防止のキャンセル)。
  if (G.selectingTarget && G.selectingTarget.handIdx === idx) {
    G.selectingTarget = null;
    renderAll();
    return;
  }
  const id = G.hand[idx];
  const card = CARDS[id];
  if (!card || card.cost > G.mana) return;

  const alive = aliveEnemies();
  if (isSingleTargetAtk(card) && alive.length > 1) {
    // 対象選択モードへ(敵タップで確定)。
    G.selectingTarget = { handIdx: idx, card };
    renderAll();
    return;
  }
  // 単体自動(敵 1 体)or 非攻撃カード。
  const target = isSingleTargetAtk(card) && alive.length === 1 ? alive[0] : null;
  G.selectingTarget = null;
  playCard(idx, target);
  if (G.screen === "battle") renderAll();
}

function onEnemyTap(enemyObj) {
  if (!G.selectingTarget || G.busy) return;
  const idx = G.selectingTarget.handIdx;
  // selectingTarget の handIdx は最新 hand を指す前提(タップ後 renderAll で再描画済み)。
  G.selectingTarget = null;
  playCard(idx, enemyObj);
  if (G.screen === "battle") renderAll();
}

function intentIcon(e) {
  const acts = currentIntent(e);
  // 複合は先頭の主アクションで代表表示しつつ全アクションを連結。
  const parts = [];
  for (const a of acts) {
    if (a.type === "A") parts.push({ ico: "攻", n: a.n });
    else if (a.type === "Guard") parts.push({ ico: "守", n: a.n });
    else if (a.type === "Dim") parts.push({ ico: "闇", n: a.n });
    else if (a.type === "Charge") parts.push({ ico: "溜", n: null });
  }
  return parts;
}

function renderEnemies() {
  enemyAreaEl.innerHTML = "";
  G.enemies.forEach((e) => {
    const el = document.createElement("div");
    el.className = "enemy";
    if (e.dead) el.classList.add("dead");
    if (e.acting && !e.dead) el.classList.add("acting"); // 敵手番の見える化(前進+光輪)。
    if (G.selectingTarget && !e.dead) el.classList.add("targetable");

    // intent(頭上)。
    const intentEl = document.createElement("div");
    intentEl.className = "enemy-intent";
    if (!e.dead) {
      const parts = intentIcon(e);
      for (const p of parts) {
        const span = document.createElement("span");
        span.className = "ico";
        span.textContent = p.n === null ? p.ico : p.ico + " " + p.n;
        intentEl.appendChild(span);
      }
    } else {
      intentEl.style.visibility = "hidden";
      intentEl.textContent = "—";
    }
    el.appendChild(intentEl);

    // 名前。
    const nameEl = document.createElement("div");
    nameEl.className = "enemy-name";
    nameEl.textContent = e.name;
    el.appendChild(nameEl);

    // シルエット(canvas ではなく軽量 DOM の円/三角でシルエット感)。
    const sprite = document.createElement("canvas");
    sprite.className = "enemy-sprite";
    sprite.width = 110;
    sprite.height = 110;
    drawEnemySprite(sprite, e);
    el.appendChild(sprite);

    // 敵 block バッジ。
    if (e.block > 0 && !e.dead) {
      const blk = document.createElement("div");
      blk.className = "enemy-block";
      blk.textContent = "守" + e.block;
      el.appendChild(blk);
    }

    // HP バー。
    const hpBar = document.createElement("div");
    hpBar.className = "enemy-hp";
    const hpFill = document.createElement("div");
    hpFill.className = "enemy-hp-fill";
    hpFill.style.width = (100 * Math.max(0, e.hp)) / e.maxHp + "%";
    const hpText = document.createElement("div");
    hpText.className = "enemy-hp-text";
    hpText.textContent = Math.max(0, e.hp) + " / " + e.maxHp;
    hpBar.appendChild(hpFill);
    hpBar.appendChild(hpText);
    el.appendChild(hpBar);

    el.onclick = () => onEnemyTap(e);
    e._el = el; // popup 用に保持。
    enemyAreaEl.appendChild(el);
  });
}

function drawEnemySprite(cv, e) {
  const c = cv.getContext("2d");
  c.clearRect(0, 0, cv.width, cv.height);
  const cx = cv.width / 2;
  const cy = cv.height / 2;
  // 暗いシルエット + 暖色の内部光(暗背景でも輪郭が読める)。
  const theme = FLOOR_THEMES[Math.min(G.floor - 1, FLOOR_THEMES.length - 1)] || FLOOR_THEMES[0];
  const acc = hexToRgb(theme.accent);
  const g = c.createRadialGradient(cx, cy, 4, cx, cy, cv.width / 2);
  g.addColorStop(0, `rgba(${acc[0]},${acc[1]},${acc[2]},0.55)`);
  g.addColorStop(0.6, "rgba(20,16,24,0.92)");
  g.addColorStop(1, "rgba(8,6,12,0.0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, cv.width / 2 - 4, 0, Math.PI * 2);
  c.fill();
  // 細い縁(暗ターンでも輪郭)。
  c.strokeStyle = `rgba(${acc[0]},${acc[1]},${acc[2]},0.5)`;
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(cx, cy, cv.width / 2 - 6, 0, Math.PI * 2);
  c.stroke();
}

function renderPlayer() {
  // LIGHT ゲージ。
  lightFillEl.style.width = G.light + "%";
  lightValEl.textContent = Math.round(G.light);
  // HP / block / mana。
  playerHpEl.textContent = "HP " + Math.max(0, G.hp) + "/" + CONST.PLAYER_MAX_HP;
  if (G.block > 0) {
    playerBlockEl.textContent = "ブロック " + G.block;
    playerBlockEl.hidden = false;
  } else {
    playerBlockEl.hidden = true;
  }
  playerManaEl.textContent = "灯 " + G.mana + "/" + CONST.MANA_PER_TURN;
  // floor ラベル。
  const isBoss = G.floor === CONST.FLOORS;
  floorLabelEl.textContent =
    TEXT.floorPrefix + G.floor + TEXT.floorSuffix + (isBoss ? "　" + TEXT.bossLabel : "");
}

function renderAll() {
  renderEnemies();
  renderPlayer();
  renderHand();
}

// ---- 数値ポップ --------------------------------------------------------
function spawnPopup(e, text) {
  if (!e._el) return;
  const p = document.createElement("div");
  p.className = "popup";
  p.textContent = text;
  e._el.appendChild(p);
  setTimeout(() => p.remove(), 900);
}
function spawnPlayerPopup(text) {
  // プレイヤー被ダメは中央ゲージ付近に出す。
  const p = document.createElement("div");
  p.className = "popup";
  p.style.top = "50%";
  p.style.color = "#ff9a8a";
  p.textContent = text;
  battleEl.appendChild(p);
  setTimeout(() => p.remove(), 900);
}
// Dim/Charge 等の cue(ゲージ少し上)。白文字+黒縁(CSS .popup)で読める。はみ出さない。
function spawnCue(text) {
  const p = document.createElement("div");
  p.className = "popup cue";
  p.style.top = "44%";
  p.textContent = text;
  battleEl.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

// ---- canvas 背景(光と階層テーマ) -------------------------------------
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  let theme = FLOOR_THEMES[0];
  if (G.floor >= 1) {
    theme = FLOOR_THEMES[Math.min(G.floor - 1, FLOOR_THEMES.length - 1)];
  }
  // LIGHT で bgDark↔bgLight を補間(明るいほど bgLight 寄り)。
  const t = (G.screen === "battle" ? G.light : 50) / 100;
  const base = mixRgb(hexToRgb(theme.bgDark), hexToRgb(theme.bgLight), t);
  ctx.fillStyle = rgbStr(base);
  ctx.fillRect(0, 0, W, H);

  // 自キャラ中心(画面中央やや下)の放射光円。明 = 暖色光彩 / 暗 = 控えめ。
  const cx = W * 0.5;
  const cy = H * 0.62;
  const acc = hexToRgb(theme.accent);
  const glow = G.screen === "battle" ? t : 0.5;
  const radius = W * (0.4 + glow * 0.5);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  // 明るいほど強い暖色光彩、暗いと淡い。
  g.addColorStop(0, `rgba(${acc[0]},${acc[1]},${acc[2]},${0.06 + glow * 0.28})`);
  g.addColorStop(0.5, `rgba(${acc[0]},${acc[1]},${acc[2]},${0.02 + glow * 0.1})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // カード使用時の光走り(軽量。重い物理は入れない)。
  drawFlashes();
}

// カード使用時の光走り。0.3 秒で消える軽量パーティクル(矩形 1 枚のフェード)。
const flashes = [];
function spawnFlash(kind) {
  const colorMap = {
    atk: [216, 85, 46],
    light: [230, 178, 90],
    block: [74, 143, 176],
    tech: [154, 127, 192],
  };
  flashes.push({ col: colorMap[kind] || [230, 178, 90], born: elapsed });
}
function drawFlashes() {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = elapsed - f.born;
    if (age > 0.3) {
      flashes.splice(i, 1);
      continue;
    }
    const a = (1 - age / 0.3) * 0.22;
    ctx.fillStyle = `rgba(${f.col[0]},${f.col[1]},${f.col[2]},${a})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---- メインループ ------------------------------------------------------
function tick(t) {
  if (!lastT) lastT = t;
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  elapsed += dt;
  render();
  requestAnimationFrame(tick);
}

// ---- 入力束ね --------------------------------------------------------
endTurnBtn.addEventListener("click", () => endTurn());
overlayEl.addEventListener("pointerdown", (e) => {
  // title でパネル外をタップしても開始できるよう、action ボタン以外は無反応(誤操作防止)。
  // ボタン自身は onclick で処理するため、ここでは何もしない。
});

// ---- 起動 --------------------------------------------------------------
resize();
window.addEventListener("resize", () => {
  resize();
});
showTitle();
requestAnimationFrame(tick);

// 開発フェーズ: Service Worker は使わない(みちゆきの教訓)。既存登録・キャッシュを掃除。
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}
if (window.caches) {
  caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
