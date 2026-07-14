"use strict";
// companion-remote PWA。ホーム型タイルランチャー + 各機能詳細画面。
// 機能: F-video 動画 / 写真(別ポート PWA ランチャ) / F-3 OS status / F-todo やること / ゲーム + トークン paste。
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
const SCREENS = ["home", "video", "todo", "games", "os", "vault", "thoughts", "ytcheck", "ytchannels"];

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
  if (id === "thoughts") refreshThoughts();
  if (id === "ytcheck") refreshYtcheck();
  if (id === "ytchannels") refreshYtChannels();
  if (id === "video" && dlOpen()) refreshDl();
}
function goHome() { showScreen("home"); }
function navOpenScreen(id) {
  history.pushState({ screen: id }, "");
  openScreen(id);
}

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


// ===== F-video（動画プレイヤー） =====
// 状態機械: IDLE → RESOLVING(通常10s前後、vendored hook + force-ipv4 後の実測) → PLAYING ⇄ PAUSED / ERROR。
// transport の真実は mpv（GET /api/video/state ポーリング）、PWA はその写像。
// サーバ stateless ゆえ resolve 開始時刻と直前 URL は localStorage の表示ヒントで持つ
// （token とは分離、§5.4）。close ≠ stop: 「閉じる」は可逆(TV 継続)、「停止」は不可逆。
const V_RESOLVE_KEY = "video_resolve_at";  // resolve 開始 epoch ms（経過秒の起点）
const V_LASTURL_KEY = "video_last_url";    // 直前投入 URL（取りこぼし時の再投入ヒント）
const V_STEP_KEY = "video_skip_step";      // ±N スキップのステップ秒（client 表示ヒント、token と分離。RV-7）
const V_QUEUE_KEY = "video_queue_titles";  // 再生キューの title 配列（JSON、表示ヒント。token と分離。RV-12）
const V_STEP_OPTIONS = [5, 10, 30, 60];    // 上下ボタンで巡回するステップ候補
const V_STEP_DEFAULT = 10;
let vState = null;          // 直近の server state
let vCollapsed = false;     // 「閉じる」で transport を畳んだ（TV は継続）
let vSeeking = false;       // シーク操作中は poll でスライダを上書きしない
let vTimer = null;          // 2s 状態ポーリング
let vTick = null;           // 1s resolve 経過秒の更新
let vAttemptActive = false; // 自分が押した再生が in-flight か（playing 到達 / 停止で false）
let vFailedLoad = false;    // 投入直後の読み込み失敗（resolving→idle、playing 未到達）
let vLocalTitle = null;     // play_local 中の表示 title（mpv media-title はファイル名になるため）
let vExpanding = false;     // play_playlist の flat 展開が in-flight（server 側で mpv 未投入＝idle のまま）
// 再生キュー(RV-12): title 配列は server 非保持(stateless)。PWA がメモリ+localStorage で保持(契約 C2)、
// playlist-pos と index で 1:1 突き合わせ(C1)。PWA を閉じて再開しても一覧を復元できるよう localStorage。
let vQueueTitles = readQueueTitles();
let vQueueRendered = null;  // キューリスト DOM の再構築シグネチャ(aligned+count、毎 poll の作り直しを避ける)

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

// 再生キュー title 配列の永続化(C2: server 非保持、PWA 側で保持)。token とは別 key。
function readQueueTitles() {
  try {
    const v = JSON.parse(localStorage.getItem(V_QUEUE_KEY) || "null");
    return Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}
function vSetQueue(titles) {
  vQueueTitles = Array.isArray(titles) ? titles : null;
  vQueueRendered = null;  // 配列が変わったらリストを作り直す
  if (vQueueTitles) localStorage.setItem(V_QUEUE_KEY, JSON.stringify(vQueueTitles));
  else localStorage.removeItem(V_QUEUE_KEY);
}
function vClearQueue() {
  vQueueTitles = null;
  vQueueRendered = null;
  localStorage.removeItem(V_QUEUE_KEY);
}

// URL クエリに list= があればプレイリスト経路(出口 UI = 自動判定、URL 欄 1 本維持。RV-12)。
function urlHasPlaylist(url) {
  try { return new URL(url).searchParams.has("list"); }
  catch (e) { return /[?&]list=/.test(url); }
}

// 現在曲の表示 title。play_local の vLocalTitle 最優先、次にキュー保持 title(index 1:1)、最後に mpv。
function vCurrentTitle(s) {
  if (vLocalTitle) return vLocalTitle;
  if (vQueueTitles && s && typeof s.playlist_pos === "number"
      && s.playlist_count === vQueueTitles.length && vQueueTitles[s.playlist_pos]) {
    return vQueueTitles[s.playlist_pos];
  }
  return (s && s.title) || "(タイトル取得中)";
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
      : "読み込みには10秒ほどかかります";
}

function renderTransport() {
  const s = vState;
  // 表示 title は vCurrentTitle で決定: play_local の vLocalTitle / キュー保持 title(RV-12) / mpv の順。
  // ローカル再生や playlist 各エントリは mpv の media-title が当てにならない(ファイル名/解決前)ため。
  $("video-title").textContent = vCurrentTitle(s);
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
  renderQueue();  // 再生キュー(RV-12): count>1 のとき一覧+ハイライト、単一/非プレイリストは非表示
}

// 再生キューの一覧描画(RV-12)。count<=1 / 非プレイリストは非表示。
// リスト DOM は signature(aligned+count) が変わった時だけ作り直し、ハイライトは毎回更新。
function renderQueue() {
  const wrap = $("video-queue");
  const s = vState;
  const count = s && typeof s.playlist_count === "number" ? s.playlist_count : 0;
  if (!vQueueTitles || count <= 1) { wrap.hidden = true; vQueueRendered = null; return; }
  wrap.hidden = false;
  // C1: title 配列長と mpv playlist-count が食い違う(再開時の stale 等)= 1:1 が崩れている。
  // 誤った曲名↔index 対応を出さないため、その場合は件数のみ表示しタップ jump は無効化する。
  const aligned = vQueueTitles.length === count;
  const list = $("video-queue-list");
  const sig = (aligned ? "A:" : "N:") + count;
  if (vQueueRendered !== sig) {
    list.textContent = "";  // innerHTML 不使用方針(app.js:4)に揃える
    if (aligned) {
      vQueueTitles.forEach((t, i) => {
        const li = document.createElement("li");
        li.className = "queue-item";
        li.dataset.idx = String(i);
        li.textContent = (i + 1) + ". " + (t || "(タイトルなし)");
        li.addEventListener("click", () => videoQueueJump(i));
        list.appendChild(li);
      });
    }
    vQueueRendered = sig;
  }
  $("video-queue-count").textContent =
    "（" + count + "曲" + (aligned ? "" : "・一覧は復元できません") + "）";
  $("video-queue-live").hidden = !s.is_live;  // live は自動 advance しない(§7、手動「次へ」で送る)
  const pos = typeof s.playlist_pos === "number" ? s.playlist_pos : -1;
  Array.from(list.children).forEach((li) => {
    li.classList.toggle("current", Number(li.dataset.idx) === pos);
  });
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
    title.textContent = vCurrentTitle(s);
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
  // play_playlist の flat 展開中は mpv 未投入で /state が idle を返す。これを「読み込み失敗」と
  // 誤判定しないよう、展開 in-flight の間は state 反映を保留(楽観 resolving 表示を維持)。
  if (vExpanding) return;
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
    if (ns.phase === "idle") { vCollapsed = false; vLocalTitle = null; vClearQueue(); }  // 終了で畳み/ローカル title/キュー解除
    renderVideo();
    renderNow();
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

async function playVideo() {
  const url = $("video-url").value.trim();
  const err = $("video-msg");
  if (!url) { err.textContent = "URL を入力してください"; return; }
  if (urlHasPlaylist(url)) { return playPlaylist(url); }  // 出口 UI: list= 自動判定で playlist 経路(RV-12)
  // 楽観的遷移: タップ即 RESOLVING（§5.2）。新規投入なので失敗フラグをリセットし attempt 開始。
  localStorage.setItem(V_LASTURL_KEY, url);
  vSetResolveAt(Date.now());
  vCollapsed = false;
  vFailedLoad = false;
  vAttemptActive = true;
  vLocalTitle = null;  // URL 再生開始 = ローカル再生の表示 title を引き継がない
  vClearQueue();       // 単一再生は旧プレイリストのキュー一覧を引き継がない
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
      // 投入そのものが弾かれた（attempt は離陸せず）。失敗文言は #video-msg 側で出す。
      vClearResolveAt();
      vAttemptActive = false;
      vState = { phase: "idle" };
      if (r.status === 400) err.textContent = "受け付けない URL です（YouTube / ニコニコ / TVer に対応）";
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

// プレイリスト投入(RV-12)。list= 検出で playVideo から分岐。server が flat 展開(最大60s)してから
// mpv に積むため、展開中は vExpanding で poll の state 反映を保留する(mpv は未投入で idle のまま)。
async function playPlaylist(url) {
  const err = $("video-msg");
  localStorage.setItem(V_LASTURL_KEY, url);
  vSetResolveAt(Date.now());
  vCollapsed = false;
  vFailedLoad = false;
  vAttemptActive = true;
  vLocalTitle = null;
  vClearQueue();        // 旧キューを消してから展開待ち(成功時に新 titles を載せる)
  vExpanding = true;    // 展開 in-flight: poll の idle 誤判定を抑止
  err.textContent = "";
  vState = { phase: "resolving", title: null, is_live: false };
  renderVideo();
  renderNow();
  startVideoPoll();
  try {
    const r = await api("/api/video/play_playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    vExpanding = false;
    if (r.ok) {
      if (!vAttemptActive) {
        // 展開中にキャンセル/停止された。server 側 load は完了しているので打ち消す。
        vClearQueue();
        try { await api("/api/video/stop", { method: "POST" }); } catch (e) { /* noop */ }
        return;
      }
      const data = await r.json();   // {titles, count, total}
      vSetQueue(data.titles || []);
      // C3/C4: 読み込み件数を表示(total>count なら一部 skip/100 件 cap)。成功後は poll が playing を拾う。
      if (typeof data.count === "number" && typeof data.total === "number" && data.count < data.total) {
        err.textContent = "全 " + data.total + " 件中 " + data.count + " 件を読み込みました";
      }
    } else {
      vClearResolveAt();
      vAttemptActive = false;
      vState = { phase: "idle" };
      if (r.status === 400) err.textContent = "プレイリストが空、または受け付けない URL です";
      else if (r.status === 502) err.textContent = "プレイリストの読み込みに失敗しました";
      else if (r.status === 503) err.textContent = "動画プレイヤーに接続できません";
      else err.textContent = "再生開始に失敗しました";
      renderVideo();
      renderNow();
    }
  } catch (e) {
    vExpanding = false;
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

// 再生キュー操作(RV-12)。固定 verb を叩いて即 poll で state を引き直す(2s 待たずハイライト反映)。
async function videoQueueNext() {
  try { await api("/api/video/queue/next", { method: "POST" }); } catch (e) { return; }
  pollVideo();
}
async function videoQueuePrev() {
  try { await api("/api/video/queue/prev", { method: "POST" }); } catch (e) { return; }
  pollVideo();
}
async function videoQueueJump(pos) {
  try {
    await api("/api/video/queue/jump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pos }),
    });
  } catch (e) { return; }
  pollVideo();
}

// キャンセル(resolving) / 停止(transport) はどちらも mpv stop（state 1本で確定、§5.2）。
async function videoStop() {
  // 明示停止/キャンセルは失敗ではない（読み込み失敗文言を出さない）。
  vClearResolveAt();
  vAttemptActive = false;
  vFailedLoad = false;
  vLocalTitle = null;
  vExpanding = false;  // 展開中キャンセルで poll の保留を即解除(60s 固着を防ぐ)
  vClearQueue();
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
  $("video-msg").textContent = "";
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
  $("video-close").addEventListener("click", () => {
    vCollapsed = true; renderVideo();
    // ホームへは履歴を1つ戻して整合(端末の戻るキーと同じ経路)。video state にいる時のみ。
    if ((history.state && history.state.screen) === "video") history.back(); else goHome();
  });
  $("video-reopen").addEventListener("click", () => { vCollapsed = false; renderVideo(); });
  $("video-toggle").addEventListener("click", videoToggle);
  $("video-prev").addEventListener("click", videoQueuePrev);  // 再生キュー(RV-12)
  $("video-next").addEventListener("click", videoQueueNext);
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

// ===== 事前DL（RV-10、F-dl） =====
// 外出先から URL をキュー投入 → 自宅機の yt-dlp がローカル保存 → 帰宅後に play_local で
// 即再生（yt-dlp 解決待ちと再生中のネットワーク依存が消える）。TVer は期限付き見逃し
// 配信のため DL 対象外（サーバ側 normalize_dl が 400 で弾く、RV-11 判断）。
// 状態の真実はサーバの .state/dlqueue.json。
// 取得はセクションを開いた時 + 開いている間のみ 15s ポーリング（todo と同周期、§6）。
const DL_ST_MARK = { queued: "待機中", downloading: "DL中", done: "済", failed: "失敗" };

function fmtBytes(n) {
  if (typeof n !== "number" || n < 0) return "";
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB";
  if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + " MB";
  return Math.round(n / 1024) + " KB";
}

function dlOpen() { return !$("dl-body").hidden; }

function toggleDl() {
  const body = $("dl-body");
  const open = body.hidden;
  body.hidden = !open;
  $("dl-toggle").setAttribute("aria-expanded", String(open));
  $("dl-caret").textContent = open ? "▾" : "▸";
  if (open) refreshDl();
}

function renderDl(data) {
  const list = $("dl-list");
  list.textContent = "";
  const items = data.items || [];
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = "(DL なし)";
    list.appendChild(li);
  }
  items.forEach((t) => {
    const li = document.createElement("li");
    li.className = "todo-item dl-item dl-" + t.status;

    const st = document.createElement("span");
    st.className = "dl-status";
    st.textContent = DL_ST_MARK[t.status] || t.status;

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = t.title || t.url;
    if (t.status === "failed" && t.error) text.title = t.error;
    if (typeof t.size === "number") {
      const sz = document.createElement("span");
      sz.className = "dl-size";
      sz.textContent = " " + fmtBytes(t.size);
      text.appendChild(sz);
    }

    li.appendChild(st);
    li.appendChild(text);

    if (t.status === "done") {
      const play = document.createElement("button");
      play.className = "todo-done";
      play.type = "button";
      play.textContent = "再生";
      play.addEventListener("click", () => playLocal(t.id, t.title));
      li.appendChild(play);
    } else if (t.status === "failed") {
      // 再試行 = 同 URL の新規 enqueue（dlqueue-design §1.2。専用 endpoint は持たない）。
      const retry = document.createElement("button");
      retry.className = "todo-done";
      retry.type = "button";
      retry.textContent = "再試行";
      retry.addEventListener("click", () => addDlUrl(t.url));
      li.appendChild(retry);
    }
    if (t.status !== "downloading") {
      const del = document.createElement("button");
      del.className = "todo-done dl-del";
      del.type = "button";
      del.textContent = "削除";
      del.addEventListener("click", () => deleteDl(t));
      li.appendChild(del);
    }
    list.appendChild(li);
  });
  if (typeof data.usage_bytes === "number" && typeof data.limit_bytes === "number") {
    $("dl-usage").textContent =
      "保存容量 " + fmtBytes(data.usage_bytes) + " / " + fmtBytes(data.limit_bytes);
  }
}

async function refreshDl() {
  if (!getToken()) return;
  try {
    const r = await api("/api/dl");
    if (!r.ok) return;
    renderDl(await r.json());
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

// out = 結果文言の出力先。idle カードの「あとでDL」は #video-msg、リスト内「再試行」は #dl-result
// （押した場所の近くに出す。折りたたみが閉じていても見える）。
async function addDlUrl(url, out) {
  out = out || $("dl-result");
  try {
    const r = await api("/api/dl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (r.ok) {
      const t = await r.json();
      out.textContent = "DLキューに追加しました（完了は Telegram に通知）";
      await refreshDl();
      return t;
    }
    if (r.status === 400) out.textContent = "受け付けない URL です（事前DLは YouTube / ニコニコのみ。TVer は不可）";
    else if (r.status === 507) out.textContent = "保存容量が上限です。済みの動画を削除してください";
    else out.textContent = "追加に失敗しました";
  } catch (e) {
    if (e.message !== "unauthorized") out.textContent = "送信エラー";
  }
  return null;
}

// 「あとでDL」: URL 欄(再生と共用)からキュー投入。成功したら欄を空にしリストを開いて見せる。
async function addDl() {
  const out = $("video-msg");
  const url = $("video-url").value.trim();
  if (!url) { out.textContent = "URL を入力してください"; return; }
  const btn = $("dl-add");
  btn.disabled = true;
  try {
    const t = await addDlUrl(url, out);
    if (t) {
      $("video-url").value = "";
      localStorage.removeItem(V_LASTURL_KEY);
      if (!dlOpen()) toggleDl();
    }
  } finally { btn.disabled = false; }
}

async function deleteDl(t) {
  const label = t.title || t.url;
  if (t.status === "done" && !confirm("「" + label + "」を削除しますか？（ファイルも消えます）")) return;
  try {
    const r = await api("/api/dl/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    });
    if (r.ok || r.status === 404) await refreshDl();  // 404=既に消えている→再取得で整合
    else if (r.status === 409) $("dl-result").textContent = "DL 中の項目は削除できません";
  } catch (e) { /* unauthorized は api() が処理 */ }
}

// DL 済み項目のローカル再生。状態機械は URL 再生と同じ（resolving はほぼ一瞬で playing）。
async function playLocal(id, title) {
  const err = $("dl-result");
  vSetResolveAt(Date.now());
  vCollapsed = false;
  vFailedLoad = false;
  vAttemptActive = true;
  vLocalTitle = title || null;
  err.textContent = "";
  vState = { phase: "resolving", title: null, is_live: false };
  renderVideo();
  renderNow();
  startVideoPoll();
  try {
    const r = await api("/api/video/play_local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) {
      vClearResolveAt();
      vAttemptActive = false;
      vLocalTitle = null;
      vState = { phase: "idle" };
      if (r.status === 404) err.textContent = "ファイルが見つかりません（一覧を更新します）";
      else if (r.status === 503) err.textContent = "動画プレイヤーに接続できません";
      else err.textContent = "再生開始に失敗しました";
      renderVideo();
      renderNow();
      if (r.status === 404) refreshDl();
    }
  } catch (e) {
    if (e.message !== "unauthorized") {
      vClearResolveAt();
      vAttemptActive = false;
      vLocalTitle = null;
      vState = { phase: "idle" };
      err.textContent = "送信エラー";
      renderVideo();
      renderNow();
    }
  }
}

function initDl() {
  $("dl-toggle").addEventListener("click", toggleDl);
  $("dl-add").addEventListener("click", addDl);
  // video 画面表示中かつセクションが開いている時のみ更新（無駄ポーリングを増やさない）。
  setInterval(() => {
    if ($("video").classList.contains("active") && dlOpen()) refreshDl();
  }, 15000);
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
// 完了操作はこの UI に置かない (#105): 完了だけ非可逆なのに編集と隣接し誤タップが
// 実際に起きたため、AI 側 (tickets.py done — 手元/Telegram どちらの claude セッション
// でも可) に一本化。UI は起票・編集・コピーのみ。
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

    const actions = document.createElement("span");
    actions.className = "todo-actions";

    const copy = document.createElement("button");
    copy.className = "todo-done";
    copy.type = "button";
    copy.textContent = "コピー";
    copy.addEventListener("click", () => copyTodo(copy, t));

    const edit = document.createElement("button");
    edit.className = "todo-done";
    edit.type = "button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => startEditTodo(li, t));

    actions.appendChild(copy);
    actions.appendChild(edit);

    li.appendChild(id);
    li.appendChild(by);
    li.appendChild(text);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

// チケット番号「#N」をクリップボードへ。ターミナル側 (claude セッション) へ貼り、
// 補足を続けて打つ用途。本文は含めない (claude は番号から tickets.py show N で実物を
// 引く運用が workspace/CLAUDE.md に明記されており、本文コピーは冗長)。
// tailscale serve の HTTPS 配信 = secure context 前提 (navigator.clipboard が使える)。
async function copyTodo(btn, t) {
  try {
    await navigator.clipboard.writeText("#" + t.id);
    btn.textContent = "済";
  } catch (e) {
    btn.textContent = "失敗";
  }
  setTimeout(() => { btn.textContent = "コピー"; }, 1200);
}

function startEditTodo(li, t) {
  const text = li.querySelector(".todo-text");
  const actions = li.querySelector(".todo-actions");
  if (!text || !actions) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "todo-edit-input";
  input.value = t.text;
  input.maxLength = 2000;

  const newActions = document.createElement("span");
  newActions.className = "todo-actions";

  const save = document.createElement("button");
  save.className = "todo-done";
  save.type = "button";
  save.textContent = "保存";

  const cancel = document.createElement("button");
  cancel.className = "todo-done";
  cancel.type = "button";
  cancel.textContent = "戻す";

  newActions.appendChild(save);
  newActions.appendChild(cancel);

  text.replaceWith(input);
  actions.replaceWith(newActions);
  input.focus();

  const doSave = async () => {
    const newText = input.value.trim();
    if (!newText) return;
    if (newText === t.text) { refreshTodo(true); return; }
    save.disabled = true;
    cancel.disabled = true;
    try {
      const r = await api("/api/todo/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, text: newText }),
      });
      if (r.ok) { await refreshTodo(true); }
      else { save.disabled = false; cancel.disabled = false; }
    } catch (e) {
      if (e.message !== "unauthorized") { save.disabled = false; cancel.disabled = false; }
    }
  };

  save.addEventListener("click", doSave);
  cancel.addEventListener("click", () => refreshTodo(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doSave(); }
    if (e.key === "Escape") { e.preventDefault(); refreshTodo(true); }
  });
}

// バッジは常時更新(15s ポーリング)、一覧はやること画面表示中のみ最新描画。
async function refreshTodo(force) {
  if (!getToken()) return;
  try {
    const r = await api("/api/todo");
    if (!r.ok) return;
    const data = await r.json();
    updateTodoBadge(data.counts);
    if ($("todo").classList.contains("active") && (force || !document.querySelector(".todo-edit-input")))
      renderTodo(data.tickets || []);
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
let vaultSearchTimer = null;    // 検索 debounce
let vaultSortMode = localStorage.getItem("vault_sort") || "folder";
let vaultListData = null;

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
  // breaks: true — Obsidian の「1改行=改行表示」に合わせる（日本語ノートの行分けを潰さない）。
  const html = marked.parse(body, { gfm: true, breaks: true });
  // DOMPurify: 生 HTML を無害化。wikilink の data 属性 + ローカル画像マーカ + class のみ追加許可。
  // input はタスクリスト checkbox（- [ ] / - [x]）のため許可し、下の後処理で checkbox 以外を落とす。
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-vault-link", "data-vault-img", "target", "rel"],
    FORBID_TAGS: ["style", "form", "textarea", "button"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
  const doc = $("vault-doc");
  doc.innerHTML = clean;  // XSS 対策: 直前で DOMPurify.sanitize 済み。生 markdown 由来の唯一の例外。
  // タスクリスト checkbox: type=checkbox 以外の input は残さない（FORBID_TAGS から外した代償）。
  // vendored marked は li に task-list-item class を付けない（node で実挙動確認済み）ため JS で付与。
  doc.querySelectorAll("input").forEach((input) => {
    if (input.type !== "checkbox") { input.remove(); return; }
    input.disabled = true;  // read-only ビューア。marked も disabled を付けるが明示的に強制
    const li = input.closest("li");
    if (li) li.classList.add("task-list-item");
  });
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
  // 外部画像（![](https://...)、wikilink 由来の blob 画像は対象外）: ロード失敗時は壊れアイコンを
  // 残さず「別タブで開く」リンクへ置換する。動画 URL を img 化した記法（YouTube/x.com）の救済も兼ねる。
  doc.querySelectorAll("img:not([data-vault-img])").forEach((img) => {
    img.addEventListener("error", () => {
      const src = img.getAttribute("src") || "";
      // http(s) 以外（data: 等）はリンク化せず除去（上の a と同じスキーム限定）。
      if (!/^https?:\/\//i.test(src)) { img.remove(); return; }
      let host = "リンク";
      try { host = new URL(src).hostname; } catch (e) { /* 不正 URL は汎用表記 */ }
      const a = document.createElement("a");
      a.href = src;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "vault-img-fallback";
      a.textContent = "▶ " + host + " で開く";
      img.replaceWith(a);
    }, { once: true });
  });
  vaultLoadImages(doc);  // ローカル画像（![[...]]）を Bearer fetch → blob で表示
}

// 一覧ビュー / 本文ビューのサブビュー切替（描画のみ。履歴 push は vaultNavDoc が担い、
// popstate からはこの2関数を直接呼んで復元する＝二重 push を避ける）。
function vaultShowList() {
  vaultRevokeImageUrls();
  $("vault-list-view").hidden = false;
  $("vault-doc-view").hidden = true;
}
function vaultShowDoc() {
  $("vault-list-view").hidden = true;
  $("vault-doc-view").hidden = false;
  window.scrollTo(0, 0);
}

// 開いているフォルダ名の記録（再描画で復元。既定は全フォルダ閉じ = 一覧を短く保つ）。
const vaultOpenFolders = new Set();

// フォルダ別の一覧を描画（DOM 構築のみ、innerHTML 不使用）。フォルダは details/summary で折りたたみ。
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
    const det = document.createElement("details");
    det.className = "vault-folder-group";
    det.open = vaultOpenFolders.has(grp.folder);
    const sum = document.createElement("summary");
    sum.className = "vault-folder";
    sum.textContent = grp.folder === "" ? "（ルート）" : grp.folder;
    const cnt = document.createElement("span");
    cnt.className = "vault-folder-count";
    cnt.textContent = String(grp.notes.length);
    sum.appendChild(cnt);
    det.appendChild(sum);
    det.addEventListener("toggle", () => {
      if (det.open) vaultOpenFolders.add(grp.folder);
      else vaultOpenFolders.delete(grp.folder);
    });
    grp.notes.forEach((n) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "vault-item";
      item.textContent = n.name;
      item.addEventListener("click", () => vaultNavDoc(n.path));
      det.appendChild(item);
    });
    root.appendChild(det);
  });
}

function vaultRenderRecent(data) {
  const root = $("vault-list");
  root.textContent = "";
  $("tile-vault-sub").textContent = (data.count || 0) + " 件";
  if (!data.folders || !data.folders.length) {
    $("vault-list-msg").textContent = "ノートがありません";
    return;
  }
  $("vault-list-msg").hidden = true;
  const all = [];
  data.folders.forEach((grp) => grp.notes.forEach((n) => all.push(n)));
  all.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  all.forEach((n) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vault-item vault-result";
    const name = document.createElement("span");
    name.className = "vault-result-name";
    name.textContent = n.name;
    item.appendChild(name);
    if (n.mtime) {
      const dt = document.createElement("span");
      dt.className = "vault-item-date";
      dt.textContent = fmtDateTime(n.mtime);
      item.appendChild(dt);
    }
    item.addEventListener("click", () => vaultNavDoc(n.path));
    root.appendChild(item);
  });
}

// text 中のクエリ一致箇所（大文字小文字無視、全出現）を <mark> で強調しつつ el へ流し込む。
// textNode + mark の appendChild のみで構築（innerHTML 不使用の規律を守る）。
function vaultAppendHighlighted(el, text, query) {
  const q = query.toLowerCase();
  if (!q) { el.textContent = text; return; }
  const lower = text.toLowerCase();
  let i = 0;
  for (let hit = lower.indexOf(q); hit >= 0; hit = lower.indexOf(q, i)) {
    if (hit > i) el.appendChild(document.createTextNode(text.slice(i, hit)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(hit, hit + q.length);
    el.appendChild(mark);
    i = hit + q.length;
  }
  if (i < text.length) el.appendChild(document.createTextNode(text.slice(i)));
}

// 検索結果を一覧領域に描画（フォルダ別の代わりに path + snippet を列挙、折りたたみなしのフラット）。
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
  const query = data.query || "";
  data.results.forEach((r) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "vault-item vault-result";
    const name = document.createElement("span");
    name.className = "vault-result-name";
    vaultAppendHighlighted(name, r.name, query);
    item.appendChild(name);
    if (r.snippet) {
      const sn = document.createElement("span");
      sn.className = "vault-result-snip";
      vaultAppendHighlighted(sn, r.snippet, query);
      item.appendChild(sn);
    }
    item.addEventListener("click", () => vaultNavDoc(r.path));
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
    vaultListData = data;
    vaultApplySort();
    vaultBuildIndex(data);
    vaultLoaded = true;
  } catch (e) {
    if (e.message !== "unauthorized") $("vault-list-msg").textContent = "通信エラー";
  }
}

function vaultApplySort() {
  if (!vaultListData) return;
  if (vaultSortMode === "recent") vaultRenderRecent(vaultListData);
  else vaultRenderList(vaultListData);
  $("vault-sort-folder").classList.toggle("active", vaultSortMode !== "recent");
  $("vault-sort-recent").classList.toggle("active", vaultSortMode === "recent");
}

async function vaultSearch(q) {
  if (!q) { if (vaultListData) vaultApplySort(); return; }
  try {
    const r = await api("/api/vault/search?q=" + encodeURIComponent(q));
    if (!r.ok) return;
    vaultRenderSearch(await r.json());
  } catch (e) { /* unauthorized は api() が処理 */ }
}

// 本文を開く（履歴を1つ積む）。一覧/検索/wikilink からの遷移はすべてここを通す。
// popstate からの復元は履歴を積まず vaultOpenDoc を直接呼ぶ（二重 push を避ける）。
function vaultNavDoc(path) {
  history.pushState({ screen: "vault", vaultView: "doc", path }, "");
  vaultOpenDoc(path);
}

async function vaultOpenDoc(path) {
  vaultShowDoc();
  // ヘッダ2段: フォルダ(小、ルート直下は省略) + ノート名(大、.md を外す)。textContent のみで構築。
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  $("vault-doc-path").textContent = dir;
  $("vault-doc-path").hidden = !dir;
  $("vault-doc-title").textContent = (slash >= 0 ? path.slice(slash + 1) : path).replace(/\.md$/, "");
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
  if (path) { vaultNavDoc(path); }
  else { $("vault-doc-msg").textContent = "リンク先のノートが見つかりません: " + target; }
}

// 詳細画面を開いた時のエントリ（openScreen から）。一覧未取得なら取得、本文表示中なら一覧へ戻す。
function openVault() {
  vaultShowList();
  if (!vaultLoaded) vaultLoadList();
}

function initVault() {
  // 戻る操作は端末の戻るキー(popstate)に集約。本文→一覧→ホームは history.back() で段階的に戻る。
  const search = $("vault-search");
  search.addEventListener("input", () => {
    clearTimeout(vaultSearchTimer);
    const q = search.value.trim();
    vaultSearchTimer = setTimeout(() => vaultSearch(q), 250);
  });
  $("vault-sort-folder").addEventListener("click", () => {
    vaultSortMode = "folder";
    localStorage.setItem("vault_sort", "folder");
    vaultApplySort();
  });
  $("vault-sort-recent").addEventListener("click", () => {
    vaultSortMode = "recent";
    localStorage.setItem("vault_sort", "recent");
    vaultApplySort();
  });
}

// ===== 思考ログ（read-only タイムライン） =====
// bot の私的観察を最新が上の時系列で「そっと読む」だけ。新着バッジ / 未読 / push は
// 一切持たない(軸4拡張 機構1 = 読まれない前提の領域)。本文はサーバ無加工で来たものを
// そのまま表示し、ここでも触らない(timestamp だけ整形)。createElement のみ(innerHTML 不使用)。

// timestamp を読みやすく整形する。bot 側の形式は epoch 秒 / epoch ミリ / ISO 文字列の
// いずれでも来うるため best-effort で日時化し、解釈できなければ原文をそのまま出す
// (本文 = observation には一切触れない、整形対象は timestamp のみ)。
function fmtThoughtTime(ts) {
  if (ts === null || ts === undefined || ts === "") return "";
  let d = null;
  if (typeof ts === "number") {
    d = new Date(ts < 1e12 ? ts * 1000 : ts);  // 秒 / ミリ秒を桁で判別
  } else if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!isNaN(parsed)) d = new Date(parsed);
  }
  if (!d || isNaN(d.getTime())) return String(ts);  // 解釈不能は原文透過
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
    + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function renderThoughts(entries) {
  const list = $("thoughts-timeline");
  const msg = $("thoughts-msg");
  list.textContent = "";
  if (!entries || !entries.length) {
    // 控えめな空表示。発火前 / 全行壊れも同じ静かな佇まいにする(「見て見て」を作らない)。
    msg.hidden = false;
    msg.textContent = "まだ何もありません";
    return;
  }
  msg.hidden = true;
  entries.forEach((e) => {
    const li = document.createElement("li");
    li.className = "thought-item";

    const when = document.createElement("div");
    when.className = "thought-when";
    when.textContent = fmtThoughtTime(e.timestamp);

    const body = document.createElement("p");
    body.className = "thought-body";
    body.textContent = e.observation == null ? "" : String(e.observation);  // 無加工透過

    li.appendChild(when);
    li.appendChild(body);
    list.appendChild(li);
  });
}

async function refreshThoughts() {
  if (!getToken()) return;
  const msg = $("thoughts-msg");
  msg.hidden = false;
  msg.textContent = "読み込み中…";
  try {
    const r = await api("/api/thoughts");
    if (!r.ok) { msg.textContent = "取得に失敗しました"; return; }
    const data = await r.json();
    renderThoughts(data.entries || []);
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

// ===== YT巡回 視聴フィードバック（F-ytcheck、#65 案 B） =====
// 月次集計レポート(サーバ生成テキストをそのまま pre 表示) + チャンネル別動画一覧。
// 各行の 視聴チェック([ ]/[x] トグル) / ○×(再タップで取り消し) は POST → 返却 entry で
// 手元の一覧を更新して再描画する。開いた時 / popstate / 月ナビでのみ取得
// (15s ポーリングには乗せない = 思考ログと同型)。外部由来文字列は必ず textContent。
let ytMonth = null;      // 表示中の月(YYYY-MM)。null は未初期化 = 当月から始める
let ytEntries = [];      // 表示中の月のエントリ(POST 返却で該当分を差し替え)
let ytBusy = false;      // POST 多重発火ガード

function ytParseVideoId(input) {
  const s = input.trim();
  let m;
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

async function ytUrlSubmit(mark) {
  const input = $("yt-url-input");
  const msg = $("yt-url-msg");
  const videoId = ytParseVideoId(input.value);
  if (!videoId) { msg.textContent = "YouTube URL を認識できません"; return; }
  if (!getToken() || ytBusy) return;
  ytBusy = true;
  msg.textContent = "記入中…";
  const cur = ytCurrentMonth();
  const months = [cur, ytShiftMonth(cur, -1)];
  let entry = null;
  let hitMonth = null;
  let netErr = false;
  for (let i = 0; i < months.length; i++) {
    try {
      const r = await api("/api/ytcheck/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: months[i], video_id: videoId, checked: true, feedback: mark }),
      });
      if (r.ok) {
        entry = await r.json();
        hitMonth = months[i];
        break;
      }
    } catch (e) {
      if (e.message === "unauthorized") { ytBusy = false; return; }
      netErr = true;
    }
  }
  ytBusy = false;
  if (entry) {
    if (hitMonth === ytMonth) {
      ytEntries = ytEntries.map((e) => e.video_id === entry.video_id ? entry : e);
      renderYtEntries();
    }
    msg.textContent = (entry.title || videoId) + " → " + mark;
    input.value = "";
  } else if (netErr) {
    msg.textContent = "記入に失敗しました";
  } else {
    msg.textContent = "この動画は推薦一覧にありません";
  }
}

function ytCurrentMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function ytShiftMonth(month, offset) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = y * 12 + (m - 1) + offset;
  return String(Math.floor(total / 12)).padStart(4, "0") + "-" + String((total % 12) + 1).padStart(2, "0");
}

async function refreshYtcheck() {
  if (!getToken()) return;
  if (!ytMonth) ytMonth = ytCurrentMonth();
  $("yt-month").textContent = ytMonth;
  const msg = $("yt-msg");
  msg.textContent = "読み込み中…";
  try {
    const r = await api("/api/ytcheck/viewing?month=" + encodeURIComponent(ytMonth));
    if (!r.ok) { msg.textContent = "取得に失敗しました"; return; }
    const data = await r.json();
    msg.textContent = "";
    ytEntries = data.entries || [];
    $("yt-report").textContent = data.report || "";
    renderYtEntries();
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

// エントリ一覧をチャンネル見出し付きで全再描画(件数は多くて数十行、全再描画で足りる)。
function renderYtEntries() {
  const box = $("yt-entries");
  box.textContent = "";
  $("yt-count").textContent = ytEntries.length ? String(ytEntries.length) + "本" : "";
  if (!ytEntries.length) {
    const p = document.createElement("p");
    p.className = "todo-empty";
    p.textContent = "この月の巡回結果はありません";
    box.appendChild(p);
    return;
  }
  let lastChannel = null;
  ytEntries.forEach((e) => {
    if (e.channel !== lastChannel) {
      lastChannel = e.channel;
      const h = document.createElement("div");
      h.className = "yt-channel";
      h.textContent = e.channel;
      box.appendChild(h);
    }
    box.appendChild(ytRow(e));
  });
}

// 動画 1 行。視聴チェック / ○ / × の 3 ボタン + タイトル + score。
function ytRow(e) {
  const row = document.createElement("div");
  row.className = "yt-item";

  const chk = document.createElement("button");
  chk.type = "button";
  chk.className = "yt-check" + (e.checked ? " on" : "");
  chk.textContent = e.checked ? "✓" : "";
  chk.setAttribute("aria-label", e.checked ? "視聴済み(タップで解除)" : "未視聴(タップで視聴済みに)");
  chk.addEventListener("click", () => ytPost(e.video_id, { checked: !e.checked }));

  const main = document.createElement("div");
  main.className = "yt-main";
  const title = document.createElement("div");
  title.className = "yt-title";
  title.textContent = e.title || e.video_id;
  const meta = document.createElement("div");
  meta.className = "yt-meta";
  meta.textContent = "score " + e.score + "/10";
  main.appendChild(title);
  main.appendChild(meta);

  // ○/× は排他でなく「同じ印の再タップで取り消し(空文字送信)」。
  const fb = document.createElement("div");
  fb.className = "yt-fbs";
  [["○", "当たり"], ["×", "外れ"]].forEach(([mark, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "yt-fb" + (e.feedback === mark ? " on" : "");
    b.textContent = mark;
    b.setAttribute("aria-label", label + (e.feedback === mark ? "(タップで取り消し)" : ""));
    b.addEventListener("click", () => ytPost(e.video_id, { feedback: e.feedback === mark ? "" : mark }));
    fb.appendChild(b);
  });

  row.appendChild(chk);
  row.appendChild(main);
  row.appendChild(fb);
  return row;
}

async function ytPost(videoId, patch) {
  if (!getToken() || ytBusy) return;
  ytBusy = true;
  const msg = $("yt-msg");
  const month = ytMonth;  // POST 中に月ナビされても表示中だった月へ書く
  try {
    const r = await api("/api/ytcheck/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ month, video_id: videoId }, patch)),
    });
    if (!r.ok) { msg.textContent = "記入に失敗しました"; return; }
    const entry = await r.json();
    if (month !== ytMonth) return;  // 別の月へ移動済みなら表示は触らない
    ytEntries = ytEntries.map((e) => (e.video_id === entry.video_id ? entry : e));
    msg.textContent = "";
    renderYtEntries();
  } catch (e) {
    if (e.message !== "unauthorized") msg.textContent = "記入に失敗しました";
  } finally {
    ytBusy = false;
  }
}

function ytMove(offset) {
  if (!ytMonth) ytMonth = ytCurrentMonth();
  ytMonth = ytShiftMonth(ytMonth, offset);
  refreshYtcheck();
}

function toggleYtReport() {
  const pre = $("yt-report");
  const open = pre.hidden;
  pre.hidden = !open;
  $("yt-report-toggle").setAttribute("aria-expanded", String(open));
  $("yt-report-caret").textContent = open ? "▾" : "▸";
}

// ===== 巡回チャンネル編集（#71、実機フィードバックで独立画面 #ytchannels 化） =====
// 画面を開いた時のみ GET /api/ytcheck/channels。行タップで編集フォームを 1 件だけ
// 展開し、保存/削除/追加 → POST → 一覧を再取得して全再描画（56ch 程度、差分更新は持たない）。
// 書き込み実体は ytcheck 側 channel_store（flock + git 自動 commit）で、PWA は表示と入力のみ。
// 追加の結果/エラーは追加ボタン直下の #yt-ch-add-msg に出す（最上部の #yt-ch-msg だと
// 長い一覧の下にある追加フォームから見えず「無反応」に見える、Pixel 6 実機で確認）。
let ytChData = null;    // {genres, channels}。null = 未取得
let ytChOpenId = null;  // 編集フォーム展開中の channel_id（1 件のみ）
let ytChBusy = false;   // POST 多重発火ガード

async function refreshYtChannels() {
  if (!getToken()) return;
  const msg = $("yt-ch-msg");
  msg.textContent = "読み込み中…";
  try {
    const r = await api("/api/ytcheck/channels");
    if (!r.ok) { msg.textContent = "取得に失敗しました"; return; }
    ytChData = await r.json();
    msg.textContent = "";
    renderYtChannels();
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

// genres の select を組み立てる（外部由来の表示名は textContent 経由）。
// genres 定義に無い現値（JSON 手編集後の「その他」行）は保存で無警告に先頭ジャンルへ
// 落とさないよう、現値の option を足して維持する（未知値のままの保存は genre を
// ペイロードから省く = 他フィールドは更新でき、genre は不変。ytChEditForm 参照）。
function ytChGenreSelect(selected) {
  const sel = document.createElement("select");
  const genres = (ytChData && ytChData.genres) || {};
  Object.keys(genres).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = genres[id];
    if (id === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  if (selected && !(selected in genres)) {
    const opt = document.createElement("option");
    opt.value = selected;
    opt.textContent = selected + "（未定義）";
    opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

function renderYtChannels() {
  const box = $("yt-ch-list");
  box.textContent = "";
  const chs = (ytChData && ytChData.channels) || [];
  const genres = (ytChData && ytChData.genres) || {};
  $("yt-ch-count").textContent = chs.length ? String(chs.length) + "ch" : "";
  // 追加フォームのジャンル select を最新の genres で作り直す（選択は維持）
  const addGenre = $("yt-ch-add-genre");
  const prevGenre = addGenre.value;
  addGenre.textContent = "";
  Object.keys(genres).forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = genres[id];
    addGenre.appendChild(opt);
  });
  if (prevGenre) addGenre.value = prevGenre;
  if (!chs.length) {
    const p = document.createElement("p");
    p.className = "todo-empty";
    p.textContent = "巡回チャンネルはありません";
    box.appendChild(p);
    return;
  }
  // ジャンル定義順にグループ表示。genres に無い genre 値は末尾に「その他」でまとめる
  const groups = Object.keys(genres).map((id) => [genres[id], chs.filter((c) => c.genre === id)]);
  const known = new Set(Object.keys(genres));
  groups.push(["その他", chs.filter((c) => !known.has(c.genre))]);
  groups.forEach(([label, list]) => {
    if (!list.length) return;
    const h = document.createElement("div");
    h.className = "yt-channel";
    h.textContent = label;
    box.appendChild(h);
    list.forEach((ch) => box.appendChild(ytChRow(ch)));
  });
}

// チャンネル 1 行。タップで編集フォームを開閉（開くのは常に 1 件だけ）。
function ytChRow(ch) {
  const wrap = document.createElement("div");
  wrap.className = "yt-ch-item";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "yt-ch-head";
  const name = document.createElement("div");
  name.className = "yt-title";
  name.textContent = ch.name || ch.channel_id;
  const meta = document.createElement("div");
  meta.className = "yt-meta";
  meta.textContent = "★" + ch.favorite + " · " + ch.check_days + "日" + (ch.note ? " · " + ch.note : "");
  head.appendChild(name);
  head.appendChild(meta);
  head.addEventListener("click", () => {
    ytChOpenId = ytChOpenId === ch.channel_id ? null : ch.channel_id;
    renderYtChannels();
  });
  wrap.appendChild(head);

  if (ytChOpenId === ch.channel_id) wrap.appendChild(ytChEditForm(ch));
  return wrap;
}

// 編集フォーム（favorite / check_days / genre / note + 保存・削除）。
function ytChEditForm(ch) {
  const form = document.createElement("div");
  form.className = "yt-ch-form";

  const fld = (labelText, control) => {
    const label = document.createElement("label");
    label.className = "fld";
    label.textContent = labelText;
    form.appendChild(label);
    form.appendChild(control);
    return control;
  };

  const fav = document.createElement("select");
  for (let i = 1; i <= 5; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = "★" + i;
    if (i === ch.favorite) opt.selected = true;
    fav.appendChild(opt);
  }
  fld("好き度", fav);

  const days = document.createElement("input");
  days.type = "number";
  days.min = "1";
  days.max = "30";
  days.value = String(ch.check_days);
  fld("巡回日数", days);

  const genre = fld("ジャンル", ytChGenreSelect(ch.genre));

  const note = document.createElement("input");
  note.type = "text";
  note.maxLength = 500;  // server 側 MAX_NOTE と同値 = 400 経路を UI で先に塞ぐ
  note.value = ch.note || "";
  note.placeholder = "メモ";
  fld("メモ", note);

  const row = document.createElement("div");
  row.className = "row tight yt-ch-btns";
  // 保存/削除の結果表示はフォーム内 (一覧最上部の #yt-ch-msg だと下方の行を編集中に
  // viewport 外 = 追加ボタンと同じ「無反応に見える」障害モードになる)。
  const formMsg = document.createElement("p");
  formMsg.className = "result";
  formMsg.setAttribute("role", "status");
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn small";
  save.textContent = "保存";
  save.addEventListener("click", async () => {
    const checkDays = Number(days.value);
    if (!Number.isInteger(checkDays) || checkDays < 1 || checkDays > 30) {
      formMsg.textContent = "巡回日数は 1〜30 の整数です";
      return;
    }
    const body = {
      channel_id: ch.channel_id,
      favorite: Number(fav.value),
      check_days: checkDays,
      note: note.value,
    };
    // 未知 genre（「（未定義）」option）のままなら genre を送らない = server 400 を踏まずに
    // 他フィールドだけ更新、genre は不変。既知ジャンルへ変えたときのみ送る。
    const genres = (ytChData && ytChData.genres) || {};
    if (genre.value in genres) body.genre = genre.value;
    const ok = await ytChPost("/api/ytcheck/channel/update", body, "保存に失敗しました", formMsg);
    if (ok) { ytChOpenId = null; refreshYtChannels(); }
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn danger small";
  del.textContent = "削除";
  del.addEventListener("click", async () => {
    if (!confirm("「" + (ch.name || ch.channel_id) + "」を巡回リストから削除しますか？")) return;
    const ok = await ytChPost("/api/ytcheck/channel/delete", { channel_id: ch.channel_id },
      "削除に失敗しました", formMsg);
    if (ok) { ytChOpenId = null; refreshYtChannels(); }
  });
  row.appendChild(save);
  row.appendChild(del);
  form.appendChild(row);
  form.appendChild(formMsg);
  return form;
}

// 編集系 POST を 1 本化。成功で応答 JSON、失敗で null（失敗文言は fallbackMsg、409 のみ重複と明示）。
// msgEl 省略時は一覧上部の #yt-ch-msg、追加系は呼び出し側がボタン直下の #yt-ch-add-msg を渡す。
async function ytChPost(path, body, fallbackMsg, msgEl) {
  if (!getToken() || ytChBusy) return null;
  ytChBusy = true;
  const msg = msgEl || $("yt-ch-msg");
  try {
    const r = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      msg.textContent = r.status === 409 ? "既に登録済みのチャンネルです" : fallbackMsg;
      return null;
    }
    msg.textContent = "";
    return await r.json();
  } catch (e) {
    if (e.message !== "unauthorized") msg.textContent = fallbackMsg;
    return null;
  } finally {
    ytChBusy = false;
  }
}

async function ytChAdd() {
  const idInput = $("yt-ch-add-id");
  const nameInput = $("yt-ch-add-name");
  const msg = $("yt-ch-add-msg");
  const raw = idInput.value.trim();
  if (!raw) { msg.textContent = "チャンネル ID / URL を入力してください"; return; }
  if (raw.includes("@")) {
    // YouTube アプリの共有 URL は https://youtube.com/@handle 形式 = server では解決不可(400)。
    // 貼った本人に「形式が違う」ことがその場で分かる文言を先に出す。
    msg.textContent = "@ハンドル形式は使えません。UC〜 のチャンネル ID を貼ってください";
    return;
  }
  if (!nameInput.value.trim()) { msg.textContent = "チャンネル名を入力してください"; return; }
  const ok = await ytChPost("/api/ytcheck/channel/add", {
    channel_id: raw,
    name: nameInput.value.trim(),
    genre: $("yt-ch-add-genre").value,
  }, "追加に失敗しました（UC〜 の ID か /channel/ URL のみ使えます）", msg);
  if (ok) {
    idInput.value = "";
    nameInput.value = "";
    msg.textContent = "追加しました";
    refreshYtChannels();
  }
}

function initYtcheck() {
  $("yt-prev").addEventListener("click", () => ytMove(-1));
  $("yt-next").addEventListener("click", () => ytMove(1));
  $("yt-report-toggle").addEventListener("click", toggleYtReport);
  $("yt-url-hit").addEventListener("click", () => ytUrlSubmit("○"));
  $("yt-url-miss").addEventListener("click", () => ytUrlSubmit("×"));
  $("yt-ch-add-btn").addEventListener("click", ytChAdd);
}

// ===== スクリーンセーバー(即トグル、画面遷移なし) =====

async function refreshScreensaver() {
  if (!getToken()) return;
  try {
    const r = await api("/api/screensaver/state");
    if (!r.ok) return;
    const data = await r.json();
    ssActive = data.active;
    $("tile-ss-sub").textContent = ssActive ? "表示中" : "停止中";
  } catch (e) { /* unauthorized は api() が token クリア + 再 paste 誘導 */ }
}

let ssBusy = false;
let ssActive = false;
async function toggleScreensaver() {
  if (!getToken() || ssBusy) return;
  ssBusy = true;
  const sub = $("tile-ss-sub");
  const action = ssActive ? "stop" : "start";
  sub.textContent = action === "stop" ? "停止中…" : "起動中…";
  try {
    const r = await api("/api/screensaver/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!r.ok) { sub.textContent = "エラー"; ssBusy = false; return; }
    const data = await r.json();
    if (data.ok) {
      sub.textContent = action === "stop" ? "-- 停止しました" : "-- 開始しました";
      // 1.5s 後は仮定値でなく実態を引き直す (dashboard 稼働中は start 直後に
      // 排他ガードで dead になるため、仮定値だと「表示中」の誤表示が残る)。
      setTimeout(() => { refreshScreensaver(); ssBusy = false; }, 1500);
    } else {
      sub.textContent = "失敗";
      setTimeout(() => { refreshScreensaver(); ssBusy = false; }, 1500);
    }
  } catch (e) {
    if (e.message !== "unauthorized") sub.textContent = "エラー";
    ssBusy = false;
  }
}

// ===== ナビゲーション初期化 =====
// タイル(data-open) → 詳細画面、戻る(data-back/data-home) → ホーム。
// 委譲ではなく要素列挙で結線(タイル枚数は少数、将来追加も局所で済む)。
function initNav() {
  // SPA なので scroll 復元はブラウザに任せず自前で行う（さもないと戻る時に
  // 動的描画後の旧 scroll 位置＝本文末尾などへ飛ぶ）。showScreen/vaultShowDoc が 0 に戻す。
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  history.replaceState({ screen: "home" }, "");

  document.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => navOpenScreen(el.getAttribute("data-open")));
  });
  // data-action タイル(screensaver 等): 画面遷移せず即アクション実行。
  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.getAttribute("data-action") === "screensaver-toggle") toggleScreensaver();
    });
  });
  // data-href タイル(写真など別オリジン PWA): 画面遷移せず外部 URL を別タブで開く。
  // user gesture 内なので window.open は許可される。opener は渡さない。
  document.querySelectorAll("[data-href]").forEach((el) => {
    el.addEventListener("click", () => window.open(el.getAttribute("data-href"), "_blank", "noopener"));
  });
  // 戻るボタン(.back)は history.back() に一本化。popstate で画面を復元する。
  document.querySelectorAll(".back").forEach((el) => {
    el.addEventListener("click", () => history.back());
  });
  // ホームの再生中バー: タップで動画詳細へ。
  $("nowbar").addEventListener("click", () => navOpenScreen("video"));
  // glance(接続/health 要約): タップで OS状態詳細へ。
  const glance = $("glance");
  glance.addEventListener("click", () => navOpenScreen("os"));
  glance.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navOpenScreen("os"); }
  });

  window.addEventListener("popstate", (e) => {
    const state = e.state || {};
    const s = state.screen || "home";
    showScreen(s);
    if (s === "vault") {
      // vault は list/doc の2サブビュー。doc state は path を持つので本文を再描画、無ければ一覧。
      if (state.vaultView === "doc" && state.path) vaultOpenDoc(state.path);
      else vaultShowList();
    } else if (s === "os") {
      refreshGlance();
    } else if (s === "thoughts") {
      refreshThoughts();
    } else if (s === "ytcheck") {
      refreshYtcheck();
    } else if (s === "ytchannels") {
      refreshYtChannels();
    } else if (s === "todo") {
      refreshTodo();
      if (!$("todo-history-list").hidden) refreshHistory();
    }
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
    refreshScreensaver();
  });
  $("status-refresh").addEventListener("click", refreshGlance);
  initNav();
  initVideo();
  initDl();
  initGames();
  initTodo();
  initVault();
  initYtcheck();

  if (getToken()) showApp(); else showTokenSetup();
  goHome();
  refreshVersion();
  refreshGlance();
  refreshTodo();
  refreshScreensaver();
  setInterval(refreshGlance, 15000);
  setInterval(refreshTodo, 15000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
document.addEventListener("DOMContentLoaded", init);
