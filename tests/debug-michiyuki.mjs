// みちゆき 実機相当デバッグ。Chromium(headless)で配信中の本体を開き、
// 実行時エラー / 初期表示 / タップ dismiss / 長押し前進 を実観測する。
// SW はブロックしてコード自体の正しさを見る(SW キャッシュ起因は別途切り分け)。
import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://127.0.0.1:47825/";
const out = (k, v) => console.log(`  ${k}: ${JSON.stringify(v)}`);

const browser = await chromium.launch();
// Pixel 6 相当のタッチ端末を模す(viewport + hasTouch)。
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await ctx.newPage();

const errors = [];
const consoleMsgs = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on("requestfailed", (r) =>
  errors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`)
);

console.log(`== open ${URL} ==`);
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

console.log("== 実行時エラー ==");
out("pageerrors", errors);
out("console", consoleMsgs);

console.log("== 初期表示(opening が出ているか) ==");
const initial = await page.evaluate(() => ({
  activeFrag: typeof activeFrag !== "undefined" ? activeFrag : "UNDEFINED",
  progress: typeof progress !== "undefined" ? progress : "UNDEFINED",
  overlayHidden: document.getElementById("overlay").hidden,
  overlayVisible: document
    .getElementById("overlay")
    .classList.contains("visible"),
  title: document.getElementById("frag-title").textContent,
  walkhintHidden: document.getElementById("walkhint").hidden,
}));
out("state", initial);

console.log("== タップ(opening を閉じる) ==");
await page.touchscreen.tap(206, 457);
await page.waitForTimeout(1000); // dismiss の setTimeout(800ms) 待ち
const afterTap = await page.evaluate(() => ({
  activeFrag: typeof activeFrag !== "undefined" ? activeFrag : "UNDEFINED",
  overlayHidden: document.getElementById("overlay").hidden,
  walkhintHidden: document.getElementById("walkhint").hidden,
  walkhintText: document.getElementById("walkhint").textContent,
}));
out("state", afterTap);

console.log("== 長押し(前進するか) ==");
// touchscreen.tap は押しっぱなしにできないので、生 pointer/touch を canvas に送る。
await page.evaluate(() => {
  const c = document.getElementById("scene");
  const r = c.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch" };
  c.dispatchEvent(new PointerEvent("pointerdown", opt));
});
const p0 = await page.evaluate(() => progress);
await page.waitForTimeout(1500);
const p1 = await page.evaluate(() => ({
  progress: progress,
  walking: walking,
  walkhintHidden: document.getElementById("walkhint").hidden,
}));
await page.evaluate(() => {
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
});
await page.waitForTimeout(100);
const p2 = await page.evaluate(() => ({ walking: walking, progressAfter: progress }));
out("press_start_progress", p0);
out("during_press", p1);
out("after_release", p2);

console.log("== 判定 ==");
const ok =
  errors.length === 0 &&
  initial.activeFrag === 0 &&
  initial.title === "みちゆき" &&
  afterTap.activeFrag === null &&
  afterTap.walkhintHidden === false &&
  p1.progress > p0 &&
  p1.walking === true &&
  p2.walking === false;
out("PASS", ok);

await browser.close();
process.exit(ok ? 0 : 1);
