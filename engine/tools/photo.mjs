// Takes the fixed pictures of a scene in a headless browser, in photo mode (docs/WORLD-API.md): no HUD, no weapon,
// the camera at each viewpoint of a viewpoint file. Every change to how a scene looks is shown from the same places.
//
//   1. serve the repository root:   python3 -m http.server 9765 --bind 127.0.0.1
//   2. PLAYWRIGHT=/path/to/node_modules/playwright node engine/tools/photo.mjs engine/tools/viewpoints/old-quebec.json outDir [name]
//      ENGINE_URL overrides http://127.0.0.1:9765/engine/dev.html; QUERY adds switches (q=high&tod=16); SIZE=1280x720;
//      VIEWS=1-upper-street,4-terrasse takes only those.
//
// Writes <outDir>/<name>-<view id>.png and <outDir>/<name>.json (per view: frame time, draw calls, triangles; and the
// load time). Software WebGL takes seconds a frame at high quality: be patient. Playwright is not a dependency.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const file = process.argv[2], outDir = process.argv[3] || '.', name = process.argv[4] || 'photo';
const spec = JSON.parse(readFileSync(file, 'utf8')), only = (process.env.VIEWS || '').split(',').filter(Boolean);
const views = spec.views.filter((v) => !only.length || only.includes(v.id));
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);
const first = views[0];
const url = `${process.env.ENGINE_URL || 'http://127.0.0.1:9765/engine/dev.html'}?scene=${encodeURIComponent(spec.scene)}&noaudio=1&shot=1&x=${first.x}&z=${first.z}${process.env.QUERY ? '&' + process.env.QUERY : '&q=high'}`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const log = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text().slice(0, 300)}`); }); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, size: [W, H], views: [], ok: false }, t0 = Date.now();
try {
  await page.goto(url);
  for (let i = 0; i < 1200 && !(await page.evaluate(() => !!window.__ready || window.__fatal)); i++) await page.waitForTimeout(500);
  const fatal = await page.evaluate(() => window.__fatal || null); if (fatal) throw new Error(fatal);
  report.loadSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  await page.addStyleTag({ content: '#ui, #boot { display: none !important }' }); // the page's own Deploy button and help line
  for (const v of views) {
    const t1 = Date.now();
    const took = await page.evaluate((pose) => window.__OPUS_WORLD.photo(pose), v);
    // frames: the chunks round the camera are live when photo() resolves; exposure and shadows settle over a few more
    const frames = +(process.env.FRAMES || 8);
    await page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);
    const stats = await page.evaluate(() => window.__OPUS_WORLD.stats());
    const path = join(outDir, `${name}-${v.id}.png`);
    await page.screenshot({ path, timeout: 300000 });
    report.views.push({ id: v.id, what: v.what, pose: took, picture: path, seconds: +((Date.now() - t1) / 1000).toFixed(1), ...stats });
  }
  report.errors = await page.evaluate(() => window.__errors || []);
  report.ok = report.errors.length === 0;
} catch (e) { report.error = String((e && e.stack) || e); }
report.console = log.slice(0, 20);
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ok: report.ok, loadSeconds: report.loadSeconds, error: report.error, errors: report.errors, console: report.console, views: report.views.map((v) => ({ id: v.id, frameMs: v.frameMs, calls: v.calls, triangles: v.triangles, chunksLive: v.chunksLive })) }, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
