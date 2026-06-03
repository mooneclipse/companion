"use strict";
// companion-remote PWA。F-2 発話 + F-3 OS status + トークン paste。
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

// glance: 接続ドット(無認証 /api/health) + OS health 要約(/api/status, 要トークン)
async function refreshGlance() {
  const dot = $("conn-dot");
  try {
    const h = await fetch("/api/health", { cache: "no-store" });
    if (!h.ok) throw new Error();
    dot.className = "dot ok";
  } catch (e) {
    dot.className = "dot down";
    $("glance-text").textContent = "接続できません";
    return;
  }
  if (!getToken()) { $("glance-text").textContent = "トークン未設定"; return; }
  try {
    const r = await api("/api/status");
    if (!r.ok) throw new Error();
    const s = await r.json();
    const parts = [];
    if (s.disk) parts.push("disk " + s.disk.pct);
    if (s.cpu_temp_c != null) parts.push(s.cpu_temp_c + "℃");
    if (s.mem) parts.push("mem " + s.mem.used + "/" + s.mem.total);
    $("glance-text").textContent = parts.join("  ") || "OK";
    renderStatus(s);
  } catch (e) {
    if (e.message !== "unauthorized") $("glance-text").textContent = "status 取得失敗";
  }
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

function renderNow() {
  const now = $("glance-now");
  const s = vState;
  if (!s || s.phase === "idle") { now.hidden = true; now.textContent = ""; return; }
  now.hidden = false;
  if (s.phase === "resolving") {
    const el = vElapsed();
    now.textContent = "⟳ 解決中…" + (el == null ? "" : " " + el + "s");
  } else {
    const icon = s.is_live ? "● LIVE" : (s.pause ? "⏸" : "▶");
    now.textContent = icon + " " + (s.title || "");
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
  $("video-close").addEventListener("click", () => { vCollapsed = true; renderVideo(); });
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
// 別オリジン(games サーバ, tailnet 同居の別ポート)への単純リンク集。リモコン機能の
// 邪魔をしないよう既定は畳む(タップで展開)。リンク先は tailscale 境界で保護される。
// 第 2 作以降はこの配列に 1 行足すだけ(games 本番 URL は games/docs/STATUS.md 参照)。
const GAMES = [
  { title: "みちゆき", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/" },
  { title: "ともしび", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/tomoshibi/" },
  { title: "なごり", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/nagori/" },
  { title: "あかり", url: "https://miho-inspiron-3521.tail5e989b.ts.net:8444/akari/" },
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
  const toggle = $("games-toggle"), list = $("games-list");
  const flip = () => {
    const open = list.hidden;  // 今 hidden なら開く向き
    list.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("open", open);
  };
  toggle.addEventListener("click", flip);
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
  });
}

function init() {
  $("token-save").addEventListener("click", () => {
    const t = $("token-input").value.trim();
    if (!t) return;
    setToken(t);
    $("token-input").value = "";
    showApp();
    refreshGlance();
  });
  $("say-send").addEventListener("click", sendSay);
  $("status-refresh").addEventListener("click", refreshGlance);
  initVideo();
  initGames();

  const glance = $("glance");
  glance.addEventListener("click", () => {
    const card = $("status-card");
    card.hidden = !card.hidden;
    if (!card.hidden) refreshGlance();
  });
  glance.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); glance.click(); }
  });

  if (getToken()) showApp(); else showTokenSetup();
  refreshGlance();
  setInterval(refreshGlance, 15000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
document.addEventListener("DOMContentLoaded", init);
