// dist/*.html を 460x944 で実レンダリングし、コンソールエラー/白紙を検査して shots/ に PNG を残す
// 依存: playwright は ~/companion/games/node_modules から絶対パス import (このディレクトリには node_modules を置かない)
import { chromium } from '/home/miho/companion/games/node_modules/playwright/index.mjs';
import { readdirSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const dist = resolve(import.meta.dirname, 'dist');
const shots = resolve(import.meta.dirname, 'shots');
mkdirSync(shots, { recursive: true });

const files = readdirSync(dist).filter(f => f.endsWith('.html')).sort();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 944 } });

const results = [];
for (const f of files) {
  const errors = [];
  const onErr = m => { if (m.type() === 'error') errors.push(m.text()); };
  page.on('console', onErr);
  await page.goto('file://' + resolve(dist, f), { waitUntil: 'networkidle' });
  await page.waitForTimeout(300); // webfont 適用待ち
  const textLen = (await page.evaluate(() => document.body.innerText.trim().length));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.phone')).backgroundColor);
  await page.screenshot({ path: resolve(shots, f.replace('.html', '.png')) });
  page.off('console', onErr);
  const ok = errors.length === 0 && textLen > 10 && bg !== 'rgba(0, 0, 0, 0)';
  results.push({ file: f, ok, textLen, bg, errors });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f} text=${textLen} bg=${bg} err=${errors.length}`);
}
await browser.close();
writeFileSync(resolve(import.meta.dirname, '.render-check.json'), JSON.stringify(results, null, 1));
const bad = results.filter(r => !r.ok).length;
console.log(`total=${results.length} bad=${bad}`);
process.exit(bad ? 1 : 0);
