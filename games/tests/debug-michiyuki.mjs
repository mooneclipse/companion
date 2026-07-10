// みちゆき 実機相当デバッグ。
// 重要: 入力は「画面座標」へ送り、最前面要素へのヒットテストを実機同様に通す
// (canvas へ直接 dispatch しない。overlay が残っていれば canvas に届かないことを再現する)。
// 機能(walking/progress)と「目に見える変化」(canvas ピクセル差分)の両方を測る。
import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://127.0.0.1:47825/";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const sample = (page) =>
  page.evaluate(() => {
    const c = document.getElementById("scene");
    const g = c.getContext("2d");
    const W = c.width,
      H = c.height;
    const d = g.getImageData(0, 0, W, H).data;
    const o = [];
    for (let y = 0; y < H; y += 16)
      for (let x = 0; x < W; x += 16) {
        const i = (y * W + x) * 4;
        o.push(d[i], d[i + 1], d[i + 2]);
      }
    return o;
  });
const changed = (a, b) => {
  let c = 0;
  for (let i = 0; i < a.length; i += 3)
    if (
      Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2]) >
      24
    )
      c++;
  return c / (a.length / 3);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

// opening を画面座標クリックで閉じる(最前面=overlay に当たる)。
await page.mouse.click(206, 457);
await page.waitForTimeout(1000); // フェードアウト + hidden(800ms) 待ち

// 画面中央の最前面要素(overlay が残っていれば scene にならない)。
const topEl = await page.evaluate(() => {
  const e = document.elementFromPoint(206, 457);
  return e ? e.id || e.tagName : "none";
});

// 画面座標で長押し(最前面要素へヒット = 実機同等)。
await page.mouse.move(206, 457);
const p0 = await page.evaluate(() => progress);
const s0 = await sample(page);
await page.mouse.down();
await page.waitForTimeout(50);
const wlk = await page.evaluate(() => walking);
await page.waitForTimeout(3000);
const p1 = await page.evaluate(() => progress);
const s1 = await sample(page);
await page.mouse.up();

const dP = p1 - p0;
const ratio = changed(s0, s1);
console.log("== overlay 修正後 実機相当(画面座標ヒットテスト) ==");
out("pageerrors", errors);
out("中央の最前面要素(scene であるべき)", topEl);
out("down直後 walking", wlk);
out("progressΔ(3s)", dP);
out("画面変化率(3s)", +(ratio * 100).toFixed(2) + "%");
out(
  "最初の文章(@0.12)到達まで概算秒",
  dP > 0 ? Math.round((0.12 - p1) / (dP / 3)) : Infinity
);

const pass = errors.length === 0 && topEl === "scene" && wlk === true && dP > 0;
out("PASS(歩行が始まる)", pass);
await browser.close();
process.exit(pass ? 0 : 1);
