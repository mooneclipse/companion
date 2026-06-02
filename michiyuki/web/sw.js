"use strict";
// みちゆき service worker。
// - shell precache(install で固定アセットをキャッシュ → オフラインで再プレイ可能)。
// - 和文フォント CDN はキャッシュ介在させない(取得失敗時は CSS の serif フォールバック)。
// - cache versioning: CACHE 名を bump + skipWaiting で更新を即反映。
const CACHE = "michiyuki-v1";
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/fragments.js",
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
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 同一オリジンの shell のみ cache-first。フォント CDN 等の外部はそのままネットへ。
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).catch(() => {
        if (e.request.mode === "navigate") {
          return caches.match("/").then((idx) => idx || Response.error());
        }
        return Response.error();
      });
    })
  );
});
