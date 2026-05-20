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
