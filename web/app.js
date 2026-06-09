"use strict";
// companion-remote PWA。ホーム型タイルランチャー + 各機能詳細画面。
// 機能: F-video 動画 / F-2 発話 / F-3 OS status / F-todo やること / ゲーム + トークン paste。
// XSS 面を絞るため innerHTML は使わず textContent / createElement のみで DOM 構築する。
const TOKEN_KEY = "remote_token";
const $ = (id) => document.getElementById(id);

const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// API 呼び出し。401 はトークン失効として再 paste UX に落とす(R4)。
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  const tok = getToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const res = await fetch(path, Object.assign({}, opts, { headers, cache: "no-store" }));
  if (res.status === 401) {
    clearToken();
    showTokenSetup("トークンが無効です。再発行して貼り直してください。");
    throw new Error("unauthorized");
  }
  return res;
}

function showTokenSetup(msg) {
  $("app").hidden = true;
  $("token-setup").hidden = false;
  if (msg) $("token-msg").textContent = msg;
}
function showApp() {
  $("token-setup").hidden = true;
  $("app").hidden = false;
}

// ===== 画面ナビゲーション(section.active 切替。mock の show/open_/home 方式) =====
// ホーム(タイルランチャー)⇄ 各機能詳細。詳細は左上「‹ 戻る」でホームへ。
const SCREENS = ["home", "video", "speak", "todo", "games", "os", "vault"];

function showScreen(id) {
  for (const s of SCREENS) {
    const el = $(s);
    if (el) el.classList.toggle("active", s === id);
  }
  window.scrollTo(0, 0);
}
function openScreen(id) {
  showScreen(id);
  // 詳細を開いた瞬間に最新を取りに行く(畳んでいた間の取りこぼし回収)。
  if (id === "todo") { refreshTodo(); if (!$("todo-history-list").hidden) refreshHistory(); }
  if (id === "os") refreshGlance();
  if (id === "vault") openVault();
}
function goHome() { showScreen("home"); }

// ホーム masthead の版表示。デプロイ中の git short hash + コミット日(/api/version, 要トークン)。
// 「今スマホに乗っているのが最新か」を一目で確認するためのもの。
// トークン未設定/取得失敗は控えめに既定文言へ戻し、リトライループは作らない(握り潰す)。
async function refreshVersion() {
  const el = $("app-version");
  if (!el) return;
  if (!getToken()) { el.textContent = "Remote"; return; }
  try {
    const r = await api("/api/version");
    if (!r.ok) throw new Error();
    const s = await r.json();
    el.textContent = s.version ? "v" + s.version : "Remote";
  } catch (e) { el.textContent = "Remote"; }
}

// glance: 接続ドット(無認証 /api/health) + OS health 要約(/api/status, 要トークン)。
// 要約専門(ホーム常駐)。詳細 dl は OS状態画面(renderStatus)。
async function refreshGlance() {
  const dot = $("conn-dot");
  const text = $("glance-text");
  const metrics = $("glance-metrics");
  try {
    const h = await fetch("/api/health", { cache: "no-store" });
    if (!h.ok) throw new Error();
    dot.className = "dot ok";
  } catch (e) {
    dot.className = "dot down";
    text.textContent = "接続できません";
    metrics.hidden = true;
    return;
  }
  if (!getToken()) { text.textContent = "トークン未設定"; metrics.hidden = true; return; }
  try {
    const r = await api("/api/status");
    if (!r.ok) throw new Error();
    const s = await r.json();
    text.textContent = "Connected";
    renderGlanceMetrics(s);
    renderStatus(s);
  } catch (e) {
    if (e.message !== "unauthorized") { text.textContent = "status 取得失敗"; metrics.hidden = true; }
  }
}

// glance 右肩の要約メトリクス(disk / mem / temp)。値は <b> で強調(mock 準拠)。
function renderGlanceMetrics(s) {
  const metrics = $("glance-metrics");
  metrics.textContent = "";
  const add = (label, val) => {
    const span = document.createElement("span");
    if (label) span.appendChild(document.createTextNode(label + " "));
    const b = document.createElement("b");
    b.textContent = val;
    span.appendChild(b);
    metrics.appendChild(span);
  };
  let any = false;
  if (s.disk) { add("disk", s.disk.pct); any = true; }
  if (s.mem) { add("mem", s.mem.used); any = true; }
  if (s.cpu_temp_c != null) { add("", s.cpu_temp_c + "℃"); any = true; }
  metrics.hidden = !any;
}

function renderStatus(s) {
  const dl = $("status-detail");
  dl.textContent = "";
  const add = (k, v) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.appendChild(dt); dl.appendChild(dd);
  };
  if (s.disk) add("ディスク(/)", s.disk.used + " / " + s.disk.total + " (" + s.disk.pct + ")");
  if (s.mem) add("メモリ", s.mem.used + " / " + s.mem.total + " (空き " + s.mem.available + ")");
  if (s.swap) add("swap", s.swap.used + " / " + s.swap.total);
  if (s.cpu_temp_c != null) add("CPU 温度", s.cpu_temp_c + " ℃");
  if (s.uptime) add("uptime", s.uptime);
  if (Array.isArray(s.load)) add("load", s.load.map((x) => Number(x).toFixed(2)).join("  "));
}

async function sendSay() {
  const btn = $("say-send"), out = $("say-result");
  const text = $("say-text").value.trim();
  if (!text) { out.textContent = "テキストを入力してください"; return; }
  const body = { text };
  const sp = $("say-speaker").value.trim();
  if (sp !== "") body.speaker = parseInt(sp, 10);
  btn.disabled = true;
  out.textContent = "送信中…";
  try {
    const r = await api("/api/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) out.textContent = "発話しました";
    else if (r.status === 409) out.textContent = "発話中です。少し待って再試行してください";
    else if (r.status === 429) out.textContent = "連続送信です。少し待ってください";
    else if (r.status === 503) out.textContent = "音声エンジンに接続できません";
    else {
      const j = await r.json().catch(() => ({}));
      out.textContent = "失敗: " + (j.error || r.status);
    }
  } catch (e) {
    if (e.message !== "unauthorized") out.textContent = "送信エラー";
  } finally {
    btn.disabled = false;
  }
}

// ===== F-video（動画プレイヤー） =====
// 状態機械: IDLE → RESOLVING(40〜70s) → PLAYING ⇄ PAUSED / ERROR。
// transport の真実は mpv（GET /api/video/state ポーリング）、PWA はその写像。
// サーバ stateless ゆえ resolve 開始時刻と直前 URL は localStorage の表示ヒントで持つ
// （token とは分離、§5.4）。close ≠ stop: 「閉じる」は可逆(TV 継続)、「停止」は不可逆。
const V_RESOLVE_KEY = "video_resolve_at";  // resolve 開始 epoch ms（経過秒の起点）
const V_LASTURL_KEY = "video_last_url";    // 直前投入 URL（取りこぼし時の再投入ヒント）
const V_STEP_KEY = "video_skip_step";      // ±N スキップのステップ秒（client 表示ヒント、token と分離。RV-7）
const V_STEP_OPTIONS = [5, 10, 30, 60];    // 上下ボタンで巡回するステップ候補
const V_STEP_DEFAULT = 10;
let vState = null;          // 直近の server state
let vCollapsed = false;     // 「閉じる」で transport を畳んだ（TV は継続）
let vSeeking = false;       // シーク操作中は poll でスライダを上書きしない
let vTimer = null;          // 2s 状態ポーリング
let vTick = null;           // 1s resolve 経過秒の更新
let vAttemptActive = false; // 自分が押した再生が in-flight か（playing 到達 / 停止で false）
let vFailedLoad = false;    // 投入直後の読み込み失敗（resolving→idle、playing 未到達）

const vSetResolveAt = (ms) => localStorage.setItem(V_RESOLVE_KEY, String(ms));
const vClearResolveAt = () => localStorage.removeItem(V_RESOLVE_KEY);
function vElapsed() {
  const at = parseInt(localStorage.getItem(V_RESOLVE_KEY) || "0", 10);
  if (!at) return null;  // 起点不明（別経路で開始 / localStorage 消失）
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

// ±N スキップのステップ秒（候補外の値は既定へ寄せる）。サーバは delta を受けるだけ（RV-7）。
function vStep() {
  const n = parseInt(localStorage.getItem(V_STEP_KEY) || "", 10);
  return V_STEP_OPTIONS.includes(n) ? n : V_STEP_DEFAULT;
}

function fmtTime(sec) {
  if (sec == null || isNaN(sec)) return "--:--";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + ss : m + ":" + ss;
}

function showVideoView(view) {
  $("video-idle").hidden = view !== "idle";
  $("video-resolving").hidden = view !== "resolving";
  $("video-transport").hidden = view !== "transport";
}

function renderVideo() {
  const ph = vState ? vState.phase : "idle";
  if ((ph === "playing" || ph === "paused") && !vCollapsed) {
    showVideoView("transport");
    renderTransport();
  } else if (ph === "resolving" && !vCollapsed) {
    showVideoView("resolving");
    renderResolving();
  } else {
    showVideoView("idle");
    renderIdle(ph);
  }
}

function renderIdle(ph) {
  const active = ph === "playing" || ph === "paused" || ph === "resolving";
  // 畳んだだけで TV 継続中なら操作へ戻る導線、終了済みなら中立明示 + 再投入ヒント。
  $("video-reopen").hidden = !(vCollapsed && active);
  const ended = $("video-ended");
  const last = localStorage.getItem(V_LASTURL_KEY) || "";
  if (vFailedLoad) {
    // 投入直後の読み込み失敗。playing に達さず idle に落ちた client 遷移で判定（§7 clean-fail）。
    ended.hidden = false;
    ended.textContent = "読み込めませんでした（配信終了か、再生できない動画の可能性）";
    if (last && !$("video-url").value) $("video-url").value = last;
  } else if (!active && last) {
    // 再開時の取りこぼし。stateless ゆえ成功/失敗は断定しない（§5.3）。
    ended.hidden = false;
    ended.textContent = "前回の再生は終了しています";
    if (!$("video-url").value) $("video-url").value = last;
  } else {
    ended.hidden = true;
  }
}

function renderResolving() {
  const el = vElapsed();
  $("video-resolve-text").textContent =
    el == null ? "読み込み中…" : "読み込み中… " + el + "s";
  $("video-resolve-note").textContent =
    el != null && el > 90
      ? "通常より時間がかかっています。少し待つかキャンセルしてください"
      : "読み込みに最大1分ほどかかります";
}

function renderTransport() {
  const s = vState;
  $("video-title").textContent = s.title || "(タイトル取得中)";
  $("video-toggle").textContent = s.pause ? "再開" : "一時停止";
  // LIVE: シーク無効 + ●LIVE 表示（§5.1）。VOD: duration が分かればシークバー。
  const live = !!s.is_live;
  $("video-live-badge").hidden = !live;
  const seekable = !live && typeof s.duration === "number" && s.duration > 0;
  $("video-seekrow").hidden = !seekable;
  $("video-skiprow").hidden = !seekable;  // ±N スキップも VOD のみ（RV-7）
  if (seekable && !vSeeking) {
    const seek = $("video-seek");
    seek.max = Math.floor(s.duration);
    seek.value = Math.floor(s.pos || 0);
    $("video-time").textContent = fmtTime(s.pos) + " / " + fmtTime(s.duration);
  }
}

// 再生中バー(ホーム常駐、再生中のみ)。タップで動画詳細へ。現行 renderNow を昇格。
function renderNow() {
  const bar = $("nowbar");
  const s = vState;
  if (!s || s.phase === "idle") { bar.hidden = true; return; }
  bar.hidden = false;
  const icon = $("nowbar-icon");
  const title = $("nowbar-title");
  const time = $("nowbar-time");
  if (s.phase === "resolving") {
    const el = vElapsed();
    icon.textContent = "⟳";
    title.textContent = "解決中…" + (el == null ? "" : " " + el + "s");
    time.textContent = "";
  } else {
    icon.textContent = s.is_live ? "●" : (s.pause ? "⏸" : "▶");
    title.textContent = s.title || "(タイトル取得中)";
    if (s.is_live) {
      time.textContent = "LIVE";
    } else if (typeof s.duration === "number" && s.duration > 0) {
      time.textContent = fmtTime(s.pos) + " / " + fmtTime(s.duration);
    } else {
      time.textContent = s.pause ? "一時停止中" : "再生中";
    }
  }
}

function startVideoPoll() {
  if (!vTimer) vTimer = setInterval(pollVideo, 2000);
  if (!vTick) vTick = setInterval(() => {
    if (vState && vState.phase === "resolving") { renderResolving(); renderNow(); }
  }, 1000);
}

async function pollVideo() {
  if (!getToken()) return;
  try {
    const r = await api("/api/video/state");
    if (!r.ok) return;
    const prev = vState ? vState.phase : null;
    const ns = await r.json();
    if (ns.phase === "playing" || ns.phase === "paused") vAttemptActive = false;
    // 自分の投入が playing に達さず resolving→idle に落ちた = 読み込み失敗（§7 clean-fail）。
    if (ns.phase === "idle" && vAttemptActive && prev === "resolving") {
      vFailedLoad = true;
      vAttemptActive = false;
    }
    vState = ns;
    if (ns.phase !== "resolving") vClearResolveAt();
    if (ns.phase === "idle") vCollapsed = false;  // 終了したら畳み状態を解除
    renderVideo();
    renderNow();
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

async function playVideo() {
  const url = $("video-url").value.trim();
  const err = $("video-play-err");
  if (!url) { err.textContent = "URL を入力してください"; return; }
  // 楽観的遷移: タップ即 RESOLVING（§5.2）。新規投入なので失敗フラグをリセットし attempt 開始。
  localStorage.setItem(V_LASTURL_KEY, url);
  vSetResolveAt(Date.now());
  vCollapsed = false;
  vFailedLoad = false;
  vAttemptActive = true;
  err.textContent = "";
  vState = { phase: "resolving", title: null, is_live: false };
  renderVideo();
  renderNow();
  startVideoPoll();
  try {
    const r = await api("/api/video/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      // 投入そのものが弾かれた（attempt は離陸せず）。失敗文言は #video-play-err 側で出す。
      vClearResolveAt();
      vAttemptActive = false;
      vState = { phase: "idle" };
      if (r.status === 400) err.textContent = "受け付けない URL です（YouTube のみ対応）";
      else if (r.status === 503) err.textContent = "動画プレイヤーに接続できません";
      else err.textContent = "再生開始に失敗しました";
      renderVideo();
      renderNow();
    }
  } catch (e) {
    if (e.message !== "unauthorized") {
      vClearResolveAt();
      vAttemptActive = false;
      vState = { phase: "idle" };
      err.textContent = "送信エラー";
      renderVideo();
      renderNow();
    }
  }
}

// キャンセル(resolving) / 停止(transport) はどちらも mpv stop（state 1本で確定、§5.2）。
async function videoStop() {
  // 明示停止/キャンセルは失敗ではない（読み込み失敗文言を出さない）。
  vClearResolveAt();
  vAttemptActive = false;
  vFailedLoad = false;
  try { await api("/api/video/stop", { method: "POST" }); } catch (e) { /* noop */ }
  vState = { phase: "idle" };
  vCollapsed = false;
  renderVideo();
  renderNow();
}

async function videoToggle() {
  const path = (vState && vState.pause) ? "/api/video/resume" : "/api/video/pause";
  try { await api(path, { method: "POST" }); } catch (e) { return; }
  if (vState) { vState.pause = !vState.pause; renderTransport(); renderNow(); }
}

async function videoSeek() {
  const pos = parseInt($("video-seek").value, 10);
  vSeeking = false;
  if (isNaN(pos)) return;
  try {
    await api("/api/video/seek", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pos }),
    });
  } catch (e) { /* noop */ }
}

// ±N スキップ（RV-7）。delta=±step を相対シークで送る（pos 取得待ち不要）。
async function videoSkip(sign) {
  const delta = sign * vStep();
  try {
    await api("/api/video/seek", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    });
  } catch (e) { /* noop */ }
}

// 上下ボタンでステップ秒を候補内で増減（dir=+1/-1）。client state のみ更新。
function changeStep(dir) {
  let i = V_STEP_OPTIONS.indexOf(vStep());
  if (i < 0) i = V_STEP_OPTIONS.indexOf(V_STEP_DEFAULT);
  i = Math.min(V_STEP_OPTIONS.length - 1, Math.max(0, i + dir));
  localStorage.setItem(V_STEP_KEY, String(V_STEP_OPTIONS[i]));
  renderStepLabels();
}

function renderStepLabels() {
  const n = vStep();
  $("video-step-label").textContent = n + "s";
  $("video-skip-back").textContent = "−" + n + "s";
  $("video-skip-fwd").textContent = "＋" + n + "s";
}

async function videoVolume() {
  const v = parseInt($("video-volume").value, 10);
  if (isNaN(v)) return;
  try {
    await api("/api/video/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v }),
    });
  } catch (e) { /* noop */ }
}

// URL 欄のクリア（RV-6）。URL を空に + 取りこぼし/失敗文言(#video-ended)もクリア。
// 直前 URL ヒントも消す（消さないと次の poll で renderIdle が文言/再投入を復活させる）。
function videoClear() {
  $("video-url").value = "";
  const ended = $("video-ended");
  ended.hidden = true;
  ended.textContent = "";
  $("video-play-err").textContent = "";
  vFailedLoad = false;
  localStorage.removeItem(V_LASTURL_KEY);
}

function initVideo() {
  $("video-play").addEventListener("click", playVideo);
  $("video-clear").addEventListener("click", videoClear);
  $("video-cancel").addEventListener("click", videoStop);
  $("video-stop").addEventListener("click", () => {
    if (confirm("再生を停止しますか？（TV の再生が止まります）")) videoStop();
  });
  $("video-close").addEventListener("click", () => { vCollapsed = true; renderVideo(); goHome(); });
  $("video-reopen").addEventListener("click", () => { vCollapsed = false; renderVideo(); });
  $("video-toggle").addEventListener("click", videoToggle);
  const seek = $("video-seek");
  ["pointerdown", "touchstart", "mousedown"].forEach((ev) =>
    seek.addEventListener(ev, () => { vSeeking = true; }));
  seek.addEventListener("change", videoSeek);
  $("video-skip-back").addEventListener("click", () => videoSkip(-1));
  $("video-skip-fwd").addEventListener("click", () => videoSkip(1));
  $("video-step-down").addEventListener("click", () => changeStep(-1));
  $("video-step-up").addEventListener("click", () => changeStep(1));
  renderStepLabels();
  $("video-volume").addEventListener("change", videoVolume);
  startVideoPoll();
  pollVideo();  // 初回: 既存セッション復元（§5.2）
}

// ===== ゲーム一覧 =====
// 別オリジン(games サーバ, tailnet 同居の別ポート)への単純リンク集。
// ゲーム詳細画面(タイル「ゲーム」→)に一覧を出す。リンク先は tailscale 境界で保護される。
// 第 N 作はこの配列に 1 行足すだけ(games 本番 URL は games/docs/STATUS.md 参照)。
const GAMES = [
  { title: "みちゆき", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/" },
  { title: "ともしび", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/tomoshibi/" },
  { title: "なごり", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/nagori/" },
  { title: "あかり", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/akari/" },
  { title: "ともる", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/tomoru/" },
  { title: "さぐり", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/saguri/" },
];

function renderGames() {
  const list = $("games-list");
  list.textContent = "";
  GAMES.forEach((g) => {
    const a = document.createElement("a");
    a.className = "game-link";
    a.href = g.url;
    a.textContent = g.title;
    a.rel = "noopener";  // 別オリジン遷移、opener を渡さない
    list.appendChild(a);
  });
}

function initGames() {
  renderGames();
  // ホームのゲームタイル sub / 詳細画面 kicker に収録本数を出す(配列駆動で自動追従)。
  $("tile-games-sub").textContent = GAMES.length + " 本 収録";
  $("games-kicker").textContent = GAMES.length + " Titles";
}

// ===== やること(共用 TODO/inbox) =====
// user(この PWA) と AI(claude セッション) 共用の inbox。実体は server の
// .state/tickets.json(flock 排他)。各チケットは番号(#N)付きで、user は「#N やって」と
// 番号で AI に渡せる。バッジ = 未対応(todo+doing)件数。ホームのやることタイルに表示。
const TODO_BY_MARK = { user: "🙋", ai: "🤖" };

// 未対応件数バッジ。ホームのタイル(#tile-todo-badge)に表示し、sub に件数文言。
function updateTodoBadge(counts) {
  const badge = $("tile-todo-badge");
  const sub = $("tile-todo-sub");
  const n = counts ? (counts.todo || 0) + (counts.doing || 0) : 0;
  if (n > 0) {
    badge.textContent = String(n); badge.hidden = false;
    sub.textContent = "未対応 " + n + " 件";
  } else {
    badge.textContent = ""; badge.hidden = true;
    sub.textContent = "未対応なし";
  }
}

function renderTodo(tickets) {
  const list = $("todo-list");
  list.textContent = "";
  if (!tickets.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = "(やることなし)";
    list.appendChild(li);
    return;
  }
  tickets.forEach((t) => {
    const li = document.createElement("li");
    li.className = "todo-item" + (t.status === "doing" ? " todo-doing" : "");

    const id = document.createElement("span");
    id.className = "todo-id";
    id.textContent = "#" + t.id;

    const by = document.createElement("span");
    by.className = "todo-by";
    by.textContent = TODO_BY_MARK[t.by] || "";
    by.title = t.by === "ai" ? "AI 起票" : "あなたの依頼";

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = t.text;
    if (t.status === "doing") {
      const tag = document.createElement("span");
      tag.className = "todo-tag";
      tag.textContent = "着手中";
      text.appendChild(document.createTextNode(" "));
      text.appendChild(tag);
    }

    const done = document.createElement("button");
    done.className = "todo-done";
    done.type = "button";
    done.textContent = "完了";
    done.addEventListener("click", () => doneTodo(t.id));

    li.appendChild(id);
    li.appendChild(by);
    li.appendChild(text);
    li.appendChild(done);
    list.appendChild(li);
  });
}

// バッジは常時更新(15s ポーリング)、一覧はやること画面表示中のみ最新描画。
async function refreshTodo() {
  if (!getToken()) return;
  try {
    const r = await api("/api/todo");
    if (!r.ok) return;
    const data = await r.json();
    updateTodoBadge(data.counts);
    if ($("todo").classList.contains("active")) renderTodo(data.tickets || []);
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

async function addTodo() {
  const input = $("todo-input"), out = $("todo-result");
  const text = input.value.trim();
  if (!text) { out.textContent = "内容を入力してください"; return; }
  const btn = $("todo-add");
  btn.disabled = true;
  try {
    const r = await api("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (r.ok) {
      const t = await r.json();
      input.value = "";
      out.textContent = "追加しました（#" + t.id + "）";
      await refreshTodo();
    } else {
      const j = await r.json().catch(() => ({}));
      out.textContent = "失敗: " + (j.error || r.status);
    }
  } catch (e) {
    if (e.message !== "unauthorized") out.textContent = "送信エラー";
  } finally {
    btn.disabled = false;
  }
}

async function doneTodo(id) {
  try {
    const r = await api("/api/todo/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    if (r.ok || r.status === 404) {
      await refreshTodo();        // 404=既に消えている→再取得で整合
      // 完了したものは履歴に回るので、開いていれば履歴も更新(取りこぼし防止)。
      if (!$("todo-history-list").hidden) refreshHistory();
    }
  } catch (e) { /* unauthorized は api() が処理 */ }
}

// epoch 秒 → ローカル "YYYY-MM-DD HH:MM"(完了日時表示用)。0/未定義は空文字。
function fmtDateTime(epochSec) {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
    + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// 完了履歴の描画(閲覧専用 = 完了ボタンも復活機能も出さない)。createElement のみ。
function renderHistory(tickets) {
  const list = $("todo-history-list");
  list.textContent = "";
  if (!tickets.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = "(完了履歴なし)";
    list.appendChild(li);
    return;
  }
  tickets.forEach((t) => {
    const li = document.createElement("li");
    li.className = "todo-item todo-history-item";

    const id = document.createElement("span");
    id.className = "todo-id";
    id.textContent = "#" + t.id;

    const by = document.createElement("span");
    by.className = "todo-by";
    by.textContent = TODO_BY_MARK[t.by] || "";
    by.title = t.by === "ai" ? "AI 起票" : "あなたの依頼";

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = t.text;

    const when = document.createElement("span");
    when.className = "todo-history-when";
    when.textContent = fmtDateTime(t.updated);

    li.appendChild(id);
    li.appendChild(by);
    li.appendChild(text);
    li.appendChild(when);
    list.appendChild(li);
  });
}

// 完了履歴の取得(active 一覧の 15s ポーリングには乗せない。開いた時 / todo 画面表示時のみ)。
async function refreshHistory() {
  if (!getToken()) return;
  try {
    const r = await api("/api/todo/history");
    if (!r.ok) return;
    const data = await r.json();
    renderHistory(data.tickets || []);
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

// 折りたたみトグル。開く瞬間に最新を取りに行く(畳んでいた間の取りこぼし回収)。
function toggleHistory() {
  const list = $("todo-history-list");
  const btn = $("todo-history-toggle");
  const open = list.hidden;
  list.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  $("todo-history-caret").textContent = open ? "▾" : "▸";
  if (open) refreshHistory();
}

function initTodo() {
  $("todo-add").addEventListener("click", addTodo);
  $("todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTodo(); }
  });
  $("todo-history-toggle").addEventListener("click", toggleHistory);
}

// ===== ノート閲覧（F-vault、read-only） =====
// 出先から vault の .md を閲覧。サーバは生 markdown を返すだけ（stdlib 縛り）。描画は
// ここで marked(parse) + DOMPurify(sanitize) で行う。本文は owner 自身の信頼できる vault
// 由来だが、レンダラ素通しの XSS を防ぐため必ず DOMPurify を通してから innerHTML する
// （app.js は本来 innerHTML を使わない規律。本文描画はその唯一の例外。下記コメント参照）。
let vaultLoaded = false;        // 一覧を一度取得したか（再入で再フェッチしない）
let vaultViewingDoc = false;    // 本文ビュー表示中（戻るボタンの出し分け）
let vaultSearchTimer = null;    // 検索 debounce

// 属性値内の特殊文字を実体化（marked は raw HTML を素通しするため自前でエスケープ）。
function vaultEscAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const VAULT_IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;

// wikilink を解決可能なリンク（data 属性）に前処理する。marked へ渡す前に置換。
//  - ローカル画像埋め込み ![[name.ext]] → <img data-vault-img="name">（後で blob fetch して表示）。
//  - 通常リンク [[target]] / [[target|alias]] → <a data-vault-link>（同ビューア内ジャンプ）。
// 画像埋め込みを先に処理（![[...]] の内側を [[...]] として二重置換しないため）。
function vaultRewriteWikilinks(md) {
  // (b-2) ![[name.(jpg|jpeg|png|gif|webp)]] のみ画像化。非画像埋め込み・通常リンクは下の置換へ残す。
  md = md.replace(/!\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g, (m, target) => {
    const t = target.trim();
    if (!VAULT_IMG_EXT.test(t)) return m;  // 非画像埋め込みは現状の挙動を変えない
    return '<img class="vault-img" data-vault-img="' + vaultEscAttr(t) + '" alt="' + vaultEscAttr(t) + '">';
  });
  // 通常 [[target]] / [[target|alias]]（! なし）はジャンプアンカーへ（既存挙動）。
  return md.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (m, target, alias) => {
    const t = target.trim();
    const label = (alias != null ? alias : target).trim();
    return '<a href="#" class="wikilink" data-vault-link="' + vaultEscAttr(t) + '">'
      + vaultEscAttr(label) + "</a>";
  });
}

// frontmatter（先頭 --- ... --- ブロック）を本文から分離。{meta: [[k,v]...], body}。
function vaultSplitFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: [], body: md };
  const meta = [];
  m[1].split("\n").forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) meta.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  });
  return { meta, body: md.slice(m[0].length) };
}

function vaultRenderFrontmatter(meta) {
  const box = $("vault-frontmatter");
  box.textContent = "";
  if (!meta.length) { box.hidden = true; return; }
  meta.forEach(([k, v]) => {
    const row = document.createElement("span");
    row.className = "fm-row";
    const key = document.createElement("b");
    key.textContent = k;
    row.appendChild(key);
    row.appendChild(document.createTextNode(" " + v));
    box.appendChild(row);
  });
  box.hidden = false;
}

// 本文中のローカル画像で生成した object URL を保持し、次のノートを開く前に解放する
// （createObjectURL のリーク防止。ノートを開き直すたびに revoke してから作り直す）。
let vaultObjectUrls = [];
function vaultRevokeImageUrls() {
  vaultObjectUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
  vaultObjectUrls = [];
}

// data-vault-img の画像を Bearer 付き fetch（api()）→ blob → object URL で表示する。
// <img src> は Authorization を送れないため必ず blob 方式（生 src を直接読ませない）。
// 契約: 本文の ![[name]] は vault attachments/<name> を指す（Obsidian attachmentFolderPath と一致）。
function vaultLoadImages(doc) {
  doc.querySelectorAll("img[data-vault-img]").forEach((img) => {
    const name = img.getAttribute("data-vault-img") || "";
    img.removeAttribute("data-vault-img");  // 二重ロード防止
    api("/api/vault/image?path=" + encodeURIComponent("attachments/" + name))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("img " + r.status))))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        vaultObjectUrls.push(url);
        img.src = url;
      })
      .catch(() => {
        // 取得失敗は壊れアイコンを残さず軽いプレースホルダ表示で握り潰す（リトライしない）。
        img.classList.add("vault-img-missing");
        img.alt = "画像を読み込めませんでした: " + name;
      });
  });
}

// markdown → サニタイズ済み HTML を本文要素へ。innerHTML はここだけ（DOMPurify 通過後）。
function vaultRenderMarkdown(body) {
  vaultRevokeImageUrls();  // 前ノートの object URL を解放してから描画
  const html = marked.parse(body, { gfm: true, breaks: false });
  // DOMPurify: 生 HTML を無害化。wikilink の data 属性 + ローカル画像マーカ + class のみ追加許可。
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-vault-link", "data-vault-img", "target", "rel"],
    FORBID_TAGS: ["style", "form", "input", "textarea", "button"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
  const doc = $("vault-doc");
  doc.innerHTML = clean;  // XSS 対策: 直前で DOMPurify.sanitize 済み。生 markdown 由来の唯一の例外。
  // wikilink クリック → 同ビューア内でジャンプ。外部リンクは別タブ + noopener。
  doc.querySelectorAll("a[data-vault-link]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      vaultJumpTo(a.getAttribute("data-vault-link"));
    });
  });
  doc.querySelectorAll("a:not([data-vault-link])").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    else a.addEventListener("click", (e) => e.preventDefault());  // 相対リンクは無効化
  });
  vaultLoadImages(doc);  // ローカル画像（![[...]]）を Bearer fetch → blob で表示
}

// 一覧ビュー / 本文ビューの切替（戻るボタンの挙動も連動）。
function vaultShowList() {
  vaultViewingDoc = false;
  $("vault-list-view").hidden = false;
  $("vault-doc-view").hidden = true;
  $("vault-back").removeAttribute("data-vault-to-list");
}
function vaultShowDoc() {
  vaultViewingDoc = true;
  $("vault-list-view").hidden = true;
  $("vault-doc-view").hidden = false;
  $("vault-back").setAttribute("data-vault-to-list", "1");
  window.scrollTo(0, 0);
}

// フォルダ別の一覧を描画（DOM 構築のみ、innerHTML 不使用）。
function vaultRenderList(data) {
  const root = $("vault-list");
  root.textContent = "";
  $("tile-vault-sub").textContent = (data.count || 0) + " 件";
  if (!data.folders || !data.folders.length) {
    $("vault-list-msg").textContent = "ノートがありません";
    return;
  }
  $("vault-list-msg").hidden = true;
  data.folders.forEach((grp) => {
    const h = document.createElement("div");
    h.className = "vault-folder";
    h.textContent = grp.folder === "" ? "（ルート）" : grp.folder;
    root.appendChild(h);
    grp.notes.forEach((n) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "vault-item";
      item.textContent = n.name;
      item.addEventListener("click", () => vaultOpenDoc(n.path));
      root.appendChild(item);
    });
  });
}

// 検索結果を一覧領域に描画（フォルダ別の代わりに path + snippet を列挙）。
function vaultRenderSearch(data) {
  const root = $("vault-list");
  root.textContent = "";
  const msg = $("vault-list-msg");
  msg.hidden = false;
  if (!data.results || !data.results.length) {
    msg.textContent = '「' + data.query + "」に一致なし";
    return;
  }
  msg.textContent = data.count + " 件ヒット";
  data.results.forEach((r) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vault-item vault-result";
    const name = document.createElement("span");
    name.className = "vault-result-name";
    name.textContent = r.name;
    item.appendChild(name);
    if (r.snippet) {
      const sn = document.createElement("span");
      sn.className = "vault-result-snip";
      sn.textContent = r.snippet;
      item.appendChild(sn);
    }
    item.addEventListener("click", () => vaultOpenDoc(r.path));
    root.appendChild(item);
  });
}

async function vaultLoadList() {
  if (!getToken()) return;
  $("vault-list-msg").hidden = false;
  $("vault-list-msg").textContent = "読み込み中…";
  try {
    const r = await api("/api/vault/list");
    if (!r.ok) { $("vault-list-msg").textContent = "一覧の取得に失敗しました"; return; }
    const data = await r.json();
    vaultRenderList(data);
    vaultBuildIndex(data);  // wikilink 解決辞書も同時に構築（追加フェッチ不要）
    vaultLoaded = true;
  } catch (e) {
    if (e.message !== "unauthorized") $("vault-list-msg").textContent = "通信エラー";
  }
}

async function vaultSearch(q) {
  if (!q) { if (vaultLoaded) vaultLoadList(); return; }
  try {
    const r = await api("/api/vault/search?q=" + encodeURIComponent(q));
    if (!r.ok) return;
    vaultRenderSearch(await r.json());
  } catch (e) { /* unauthorized は api() が処理 */ }
}

async function vaultOpenDoc(path) {
  vaultShowDoc();
  $("vault-doc-title").textContent = path;
  $("vault-doc").textContent = "";
  $("vault-frontmatter").hidden = true;
  $("vault-doc-msg").textContent = "読み込み中…";
  try {
    const r = await api("/api/vault/get?path=" + encodeURIComponent(path));
    if (!r.ok) {
      $("vault-doc-msg").textContent = r.status === 404 ? "ノートが見つかりません" : "読み込めません";
      return;
    }
    const data = await r.json();
    $("vault-doc-msg").textContent = "";
    const split = vaultSplitFrontmatter(data.content);
    vaultRenderFrontmatter(split.meta);
    vaultRenderMarkdown(vaultRewriteWikilinks(split.body));
  } catch (e) {
    if (e.message !== "unauthorized") $("vault-doc-msg").textContent = "通信エラー";
  }
}

// wikilink ジャンプ: target（ノート名 or 相対 path）から実 path を一覧から解決して開く。
// 解決できなければメッセージのみ（壊れたリンクで遷移しない）。
let vaultIndex = null;  // {name(lower)->path, path(lower)->path} の解決辞書（list 取得時に構築）
function vaultBuildIndex(data) {
  vaultIndex = {};
  (data.folders || []).forEach((g) => g.notes.forEach((n) => {
    vaultIndex[n.name.toLowerCase()] = n.path;
    vaultIndex[n.path.toLowerCase()] = n.path;
    vaultIndex[n.path.toLowerCase().replace(/\.md$/, "")] = n.path;
  }));
}
async function vaultEnsureIndex() {
  if (vaultIndex) return;
  try {
    const r = await api("/api/vault/list");
    if (r.ok) vaultBuildIndex(await r.json());
  } catch (e) { /* noop */ }
}
async function vaultJumpTo(target) {
  await vaultEnsureIndex();
  const key = target.toLowerCase().replace(/\.md$/, "");
  const path = vaultIndex && (vaultIndex[key] || vaultIndex[key + ".md"]);
  if (path) { vaultOpenDoc(path); }
  else { $("vault-doc-msg").textContent = "リンク先のノートが見つかりません: " + target; }
}

// 詳細画面を開いた時のエントリ（openScreen から）。一覧未取得なら取得、本文表示中なら一覧へ戻す。
function openVault() {
  vaultShowList();
  if (!vaultLoaded) vaultLoadList();
}

function initVault() {
  // 戻る: 本文ビュー中は一覧へ、一覧ビューではホームへ（data-home 既定挙動）。
  $("vault-back").addEventListener("click", (e) => {
    if (vaultViewingDoc) { e.stopImmediatePropagation(); vaultShowList(); }
  }, true);
  const search = $("vault-search");
  search.addEventListener("input", () => {
    clearTimeout(vaultSearchTimer);
    const q = search.value.trim();
    vaultSearchTimer = setTimeout(() => vaultSearch(q), 250);
  });
}

// ===== ナビゲーション初期化 =====
// タイル(data-open) → 詳細画面、戻る(data-back/data-home) → ホーム。
// 委譲ではなく要素列挙で結線(タイル枚数は少数、将来追加も局所で済む)。
function initNav() {
  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => openScreen(el.getAttribute("data-open")));
  });
  document.querySelectorAll("[data-home]").forEach((el) => {
    el.addEventListener("click", goHome);
  });
  // ホームの再生中バー: タップで動画詳細へ。
  $("nowbar").addEventListener("click", () => openScreen("video"));
  // glance(接続/health 要約): タップで OS状態詳細へ。
  const glance = $("glance");
  glance.addEventListener("click", () => openScreen("os"));
  glance.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openScreen("os"); }
  });
}

function init() {
  $("token-save").addEventListener("click", () => {
    const t = $("token-input").value.trim();
    if (!t) return;
    setToken(t);
    $("token-input").value = "";
    showApp();
    goHome();
    refreshVersion();
    refreshGlance();
    refreshTodo();
  });
  $("say-send").addEventListener("click", sendSay);
  $("status-refresh").addEventListener("click", refreshGlance);
  initNav();
  initVideo();
  initGames();
  initTodo();
  initVault();

  if (getToken()) showApp(); else showTokenSetup();
  goHome();
  refreshVersion();
  refreshGlance();
  refreshTodo();
  setInterval(refreshGlance, 15000);
  setInterval(refreshTodo, 15000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
document.addEventListener("DOMContentLoaded", init);
