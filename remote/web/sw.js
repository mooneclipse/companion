"use strict";
// companion-remote service worker。
// - shell-only precache(install で固定アセットをキャッシュ)。
// - /api/* は network-only(キャッシュしない=常に最新・トークン応答を残さない)。
// - cache versioning: CACHE 名を bump + skipWaiting で更新を即反映。
const CACHE = "remote-v43";
const SHELL = [
  "/",
  "/app.js",
  "/marked.min.js",
  "/purify.min.js",
  "/style.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API はキャッシュ介在させない(network-only)
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;
  // shell は cache-first → 無ければネット → 両方失敗でエラー画面
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).catch(() => {
        if (e.request.mode === "navigate") {
          return caches.match("/").then((idx) => idx || errorPage());
        }
        return errorPage();
      });
    })
  );
});

function errorPage() {
  return new Response(
    "<!DOCTYPE html><meta charset=utf-8><title>オフライン</title>" +
      "<body style='font-family:sans-serif;padding:2rem;background:#1b1f2a;color:#e8eaf0'>" +
      "オフラインです。接続を確認してください。",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
