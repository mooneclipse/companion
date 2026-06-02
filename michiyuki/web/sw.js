"use strict";
// みちゆき killer service worker。
// 開発フェーズでは SW を使わない方針(オフライン再プレイは v1 安定後に再導入)。
// 過去に登録された cache-first SW が古い shell を返し続ける事故を断つため、
// この sw.js は「全キャッシュ削除 → 自身を unregister → 制御中ページを reload」
// だけを行う。fetch ハンドラは置かない(=ブラウザ既定のネット直取得に戻す)。
// ブラウザは navigation 時に byte 差分でこの新 sw.js を取得し、旧 SW を置き換える。
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      // SW 抜きの素のネット版を読ませるため、制御中ページをリロード。
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
