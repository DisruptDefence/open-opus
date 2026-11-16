// Mouse look through the engine's real input code, in a headless browser, from the page a person would open.
//
//   serve the repository root on 127.0.0.1 (python3 -m http.server 9760 --bind 127.0.0.1), then
//   PLAYWRIGHT=/path/to/node_modules/playwright node engine/tools/input-check.mjs [outDir]
//   ENGINE_URL overrides http://127.0.0.1:9760/engine/dev.html
//
// What it covers: input.js's own pointerlockchange handler, mousemove handler, sensitivity and invertY, the drag
// fallback, the session pausing when the lock is lost, and (last) touch mode building styled controls. The one thing
// it fakes is the browser's lock itself: headless Chromium grants no pointer lock, so document.pointerLockElement is
// overridden and pointerlockchange dispatched by hand. What stays for a person: the browser's real lock prompt, Esc
// leaving the lock, raw-input feel, a real touch screen, a real gamepad. Pitch is not in the snapshot, so vertical
// look is judged by comparing pictures. Exit code 0 only when every check passes.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const outDir = process.argv[2] || '.';
const url = `${process.env.ENGINE_URL || 'http://127.0.0.1:9760/engine/dev.html'}?scenario=test&q=low&noaudio=1`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`); };

async function open() {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__OPUS_WORLD, null, { timeout: 60000 });
  await page.evaluate(() => window.__OPUS_WORLD.ready());
  await page.click('#start');
  await page.waitForFunction(() => window.__OPUS_WORLD.state() === 'playing', null, { timeout: 30000 });
  return page;
}
const heading = (page) => page.evaluate(() => window.__OPUS_WORLD.snapshot().self.heading);
const delta = (a, b) => ((b - a + 540) % 360) - 180;
/** Wait until frames have consumed the queued look: the heading and the game clock stop disagreeing. */
async function settle(page) {
  let last = null;
  for (let i = 0; i < 80; i++) {
    const s = await page.evaluate(() => ({ h: window.__OPUS_WORLD.snapshot().self.heading, t: window.__OPUS_WORLD.snapshot().time }));
    if (last && s.h === last.h && s.t > last.t) return s.h;
    last = s; await page.waitForTimeout(400);
  }
  return last.h;
}
const lock = (page) => page.evaluate(() => {
  const canvas = document.getElementById('view');
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
  document.dispatchEvent(new Event('pointerlockchange'));
});
const unlock = (page) => page.evaluate(() => { Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null }); document.dispatchEvent(new Event('pointerlockchange')); });
const moves = (page, movementX, movementY, n = 10) => page.evaluate(([mx, my, count]) => { for (let i = 0; i < count; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: mx, movementY: my })); }, [movementX, movementY, n]);
const shot = async (page, name) => page.screenshot({ path: join(outDir, `input-${name}.png`), timeout: 180000 });

try {
  // (1) and (2): a lock, mouse look, sensitivity, invert, the lock lost
  let page = await open();
  await lock(page);
  await page.waitForTimeout(500);
  let h0 = await settle(page);
  await moves(page, 50, 0);
  let h1 = await settle(page), d = delta(h0, h1);
  check('10 x 50 px right turns the view 60 degrees clockwise (sensitivity 1)', Math.abs(d - 60.2) <= 3, `turned ${d.toFixed(1)}`);

  await page.evaluate(() => window.__OPUS_WORLD.settings({ sensitivity: 2 }));
  await moves(page, 50, 0);
  let h2 = await settle(page); d = delta(h1, h2);
  check('the same at sensitivity 2 turns 120 degrees', Math.abs(d - 120.3) <= 6, `turned ${d.toFixed(1)}`);
  await page.evaluate(() => window.__OPUS_WORLD.settings({ sensitivity: 1 }));

  const a = await shot(page, 'a-level');
  await moves(page, 0, 50); await settle(page);
  const b = await shot(page, 'b-down');
  check('10 x 50 px down moves the horizon', !a.equals(b));
  await moves(page, 0, -50); await settle(page); // back to level
  await page.evaluate(() => window.__OPUS_WORLD.settings({ invertY: true }));
  await moves(page, 0, 50); await settle(page);
  const c = await shot(page, 'c-down-inverted');
  check('with invertY the same movement looks the other way', !c.equals(a) && !c.equals(b));
  await page.evaluate(() => window.__OPUS_WORLD.settings({ invertY: false }));

  await unlock(page);
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => window.__OPUS_WORLD.state());
  check('losing the lock pauses the session', state === 'paused', `state ${state}`);
  await page.close();

  // (3): no lock at all: the drag fallback
  page = await open();
  await page.waitForTimeout(1500);
  const hd0 = await settle(page);
  await page.evaluate(() => {
    const canvas = document.getElementById('view');
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    for (let i = 0; i < 10; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 50, movementY: 0, clientX: 480, clientY: 270 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  });
  const hd1 = await settle(page);
  check('without a lock a drag turns the view (the fallback)', Math.abs(delta(hd0, hd1)) > 30, `turned ${delta(hd0, hd1).toFixed(1)}`);

  // touch: the controls are built and styled
  await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
  const t = await page.evaluate(() => {
    const css = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { position: c.position, width: c.width, display: c.display }; };
    return { fire: css('.t-fire'), reload: css('.t-reload'), root: css('.touch') };
  });
  check('touch mode builds styled buttons: fire 64 px, reload 44 px, absolute', t.fire && t.fire.position === 'absolute' && t.fire.width === '64px' && t.reload && t.reload.width === '44px', JSON.stringify(t));
  await shot(page, 'd-touch');
  await page.close();
} catch (e) {
  check('the run finished without an error', false, String((e && e.stack) || e).slice(0, 600));
}
await browser.close();
const ok = results.length > 0 && results.every((r) => r.ok);
console.log(ok ? 'OK' : 'RED');
process.exit(ok ? 0 : 1);
