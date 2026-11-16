// Plays a development scenario in a headless browser, from the page a person would open, and reports what happened.
// The page is driven the way a person and a host drive it: a click on Deploy, the W key held down, and
// window.__OPUS_WORLD (docs/WORLD-API.md) for everything else. Pictures are saved at each stage: look at them.
//
//   1. serve the repository root:   python3 -m http.server 9760 --bind 127.0.0.1      (from the repository root)
//   2. PLAYWRIGHT=/path/to/node_modules/playwright node engine/tools/play.mjs [scenario] [outDir]
//      scenario: test (default) | old-quebec        ENGINE_URL overrides http://127.0.0.1:9760/engine/dev.html
//
// Playwright is not a dependency of the engine: point PLAYWRIGHT at any installed copy. Software WebGL draws a few
// frames a second, so a run takes a minute or two. Exit code 0 only when the mission reached `complete`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const scenario = process.argv[2] || 'test', outDir = process.argv[3] || '.';
const url = `${process.env.ENGINE_URL || 'http://127.0.0.1:9760/engine/dev.html'}?scenario=${scenario}&q=low&noaudio=1${process.env.QUERY ? '&' + process.env.QUERY : ''}`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const log = []; page.on('console', (m) => log.push(`[${m.type()}] ${m.text().slice(0, 300)}`)); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, steps: [], pictures: [], ok: false }, t0 = Date.now();
const step = (name, data) => { report.steps.push({ at: +((Date.now() - t0) / 1000).toFixed(1), name, ...data }); };
const shot = async (name) => { const p = join(outDir, `${scenario}-${name}.png`); await page.screenshot({ path: p, timeout: 180000 }); report.pictures.push(p); };
const world = (fn, arg) => page.evaluate(fn, arg); // every call below reads or drives window.__OPUS_WORLD only
const until = async (what, fn, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await world(fn); if (v) return v; await page.waitForTimeout(250); } throw new Error(`timed out waiting for ${what}`); };

try {
  await page.goto(url);
  await until('the world object', () => !!window.__OPUS_WORLD || window.__fatal, 60);
  step('published', { state: await world(() => window.__OPUS_WORLD.state()) });
  await world(() => window.__OPUS_WORLD.ready());
  await world(() => { window.__seen = []; for (const n of ['state', 'interact', 'entity', 'hold', 'say', 'player:hit', 'player:dead']) window.__OPUS_WORLD.on(n, (e) => window.__seen.push([n, e])); });
  step('ready', { state: await world(() => window.__OPUS_WORLD.state()), scene: await world(() => window.__OPUS_WORLD.scene().name) });
  await page.waitForTimeout(1500); await shot('1-title');

  await page.click('#start'); // the user gesture
  await until('play', () => window.__OPUS_WORLD.state() === 'playing', 20);
  const first = await world(() => window.__OPUS_WORLD.snapshot());
  step('playing', { self: first.self, entities: first.entities.map((e) => `${e.id}:${e.kind}:${e.state}`), mgrs: await world(() => { const w = window.__OPUS_WORLD, s = w.snapshot().self; return Object.values(w.geo.toMGRS(s.x, s.z)).join(' '); }) });
  await page.waitForTimeout(1500); await shot('2-playing');

  await page.keyboard.down('KeyW');
  await until('the player to move', () => window.__OPUS_WORLD.snapshot().self.speed > 1, 30);
  // the phone comes up: hold, look, release
  const held = await world(() => { const w = window.__OPUS_WORLD; return { ok: w.hold('pause'), held: w.held(), time: w.snapshot().time }; });
  await page.waitForTimeout(2000);
  const still = await world(() => window.__OPUS_WORLD.snapshot().time);
  await shot('3-held');
  const over = await world(async () => { const o = await window.__OPUS_WORLD.overhead(); const c = document.createElement('canvas'); c.width = o.width; c.height = o.height; const x = c.getContext('2d'); x.drawImage(o.image, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    c.id = 'overhead-check'; c.style.cssText = 'position:fixed;right:8px;top:8px;width:320px;border:1px solid #fff;z-index:9'; document.body.appendChild(c);
    return { width: o.width, height: o.height, bounds: o.bounds, drawable: o.image instanceof ImageBitmap, darkest: lo, brightest: hi }; });
  await shot('4-overhead');
  await world(() => { document.getElementById('overhead-check').remove(); window.__OPUS_WORLD.release(); });
  step('hold', { ...held, timeStoodStill: still === held.time, overhead: over, heldAfterRelease: await world(() => window.__OPUS_WORLD.held()) });

  await page.keyboard.up('KeyW'); await page.keyboard.down('KeyW'); // the hold dropped the keys; press again
  let mid = false;
  for (let i = 0; i < 480; i++) {
    const s = await world(() => ({ state: window.__OPUS_WORLD.state(), n: window.__mission.length }));
    if (s.n >= 1 && !mid) { mid = true; await shot('5-objective-reached'); }
    if (s.state !== 'playing') break;
    await page.waitForTimeout(250);
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1000); await shot('6-end');
  const end = await world(() => ({ state: window.__OPUS_WORLD.state(), snap: window.__OPUS_WORLD.snapshot(), seen: window.__seen, mission: window.__mission, errors: window.__errors, fatal: window.__fatal || null }));
  const count = {}; for (const [n, e] of end.seen) { const k = n === 'entity' ? `entity:${e.change}` : n === 'state' ? `state:${e.state}` : n === 'interact' ? `interact:${e.id}` : n; count[k] = (count[k] || 0) + 1; }
  step('end', { state: end.state, self: end.snap.self, time: end.snap.time, moved: +Math.hypot(end.snap.self.x - first.self.x, end.snap.self.z - first.self.z).toFixed(1), entities: end.snap.entities.map((e) => `${e.id}:${e.kind}:${e.state}`), events: count, mission: end.mission });
  report.errors = end.errors; report.fatal = end.fatal;
  report.ok = end.state === 'complete' && !end.fatal && end.errors.length === 0 && held.ok && still === held.time && over.drawable && over.brightest - over.darkest > 20;
} catch (e) {
  report.error = String((e && e.stack) || e);
  report.fatal = await page.evaluate(() => window.__fatal || null).catch(() => null);
  report.errors = await page.evaluate(() => window.__errors || []).catch(() => []);
  await shot('failed').catch(() => {});
}
report.console = log.slice(0, 30);
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
