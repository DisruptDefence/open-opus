// Pictures of the loading screen (host/boot.js) in its states, to LOOK at. No engine runs: a route-served page drives createBoot.
//   python3 -m http.server 9763 --bind 127.0.0.1      (from the repository root)
//   PLAYWRIGHT=/path/to/node_modules/playwright node engine/tools/boot-shot.mjs [outDir] [WxH,WxH[t]] [lang]     BOOT_BASE overrides http://127.0.0.1:9763
// Per size: 1-early (download by bytes), 2-mid (textures counting, mission title, a tip), 3-stalled, 4-error. Exit 1 on a page error.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const outDir = process.argv[2] || '.', lang = process.argv[4] || 'en';
const sizes = (process.argv[3] || '1280x720,844x390t,390x844t').split(',').map((s) => ({ t: s.endsWith('t'), wh: s.replace(/t$/, '').split('x').map(Number), name: s }));
const base = process.env.BOOT_BASE || 'http://127.0.0.1:9763';
mkdirSync(outDir, { recursive: true });
const PAGE = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}#app{position:fixed;inset:0}</style></head><body><div id="app"></div>
<script type="module">
import { createBoot } from '/engine/host/boot.js';
import { DEFAULT_PACK } from '/engine/index.js';
window.__errors = []; addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.__boot = createBoot({ parent: document.getElementById('app'), words: DEFAULT_PACK.loader, brand: 'Open OPUS', title: 'Scene title', subtitle: 'Mission subtitle', stallMs: 1500 });
window.__go = true;
</script></body></html>`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader'] });
let bad = 0;
for (const sz of sizes) {
  const ctx = await browser.newContext({ viewport: { width: sz.wh[0], height: sz.wh[1] }, hasTouch: sz.t, isMobile: sz.t, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route('**/boot-shot.html', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto(base + '/boot-shot.html'); await page.waitForFunction(() => window.__go);
  const settle = (ms = 1600) => page.waitForTimeout(ms), snap = async (n) => { await page.screenshot({ path: join(outDir, `${n}-${sz.name}.png`) }); };
  await page.evaluate(() => { const b = window.__boot; b.start('download'); b.report('download', 3.1 * 1048576, 9.8 * 1048576, 'bytes'); });
  await settle(); await snap('1-early');
  await page.evaluate(() => { const b = window.__boot; b.complete('download'); for (const l of ['renderer', 'materials']) b.onProgress(l, 0.1); b.onProgress('textures', 0.15, { phase: 'textures', done: 14, total: 31 }); });
  await settle(); await snap('2-mid');
  const mid = await page.evaluate(() => ({ pct: document.querySelector('.ob-pct span').textContent, step: document.querySelector('.ob-name').textContent, det: document.querySelector('.ob-det').textContent }));
  console.log(sz.name, 'mid', JSON.stringify(mid));
  await settle(2200); await snap('3-stalled');
  console.log(sz.name, 'stalled note shown:', await page.evaluate(() => !document.querySelector('.ob-slow').hidden));
  await page.evaluate(() => window.__boot.fail(new Error('scene.json answered 404'))); await settle(300); await snap('4-error');
  const errs = await page.evaluate(() => window.__errors); if (errs.length) { bad++; console.error(sz.name, 'page errors', errs); }
  await ctx.close();
}
await browser.close(); process.exit(bad ? 1 : 0);
