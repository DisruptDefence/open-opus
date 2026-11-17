// Pictures of the pistol IN THE GAME, on the phone's demo page (phone/demo.html: the game plus the real phone overlay, raised
// with the T key), 1280x720 unless VIEWPORT says otherwise. Pictures: hip, aim, firing mid-recoil, slide locked, reload
// mid, and the phone raised with the pistol (16:9, 16:10 and 21:9), then lowered again, and with the carbine.
//   1. serve the repository root on 127.0.0.1 (any free port)
//   2. PLAYWRIGHT=/path/to/node_modules/playwright PAGE_URL=http://127.0.0.1:PORT/phone/demo.html \
//        GPU=1 GALLIUM_DRIVER=d3d12 [CHROME=/path/to/chrome] flock /tmp/opus-heavy.lock node engine/tools/sidearm-shot.mjs outDir [name]
//   WHICH=hip,ads,fire,locked,reload,phone,carbine   limits the pictures        PHONE_W=45   sets the phone's width in vw
//   SIZES=1280x720,1280x800,1720x720                 the sizes of the phone pictures
// The tool drives the page as a person does (a click on Deploy, the keys 2 and T and R); fire and aim are held through the
// engine's input object, because a headless window has no pointer lock. Playwright is not a dependency.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const outDir = process.argv[2] || '.', name = process.argv[3] || 'game';
const url = `${process.env.PAGE_URL || 'http://127.0.0.1:9771/phone/demo.html'}?q=${process.env.Q || 'medium'}&noaudio=1`;
const want = process.env.WHICH ? process.env.WHICH.split(',') : ['hip', 'ads', 'fire', 'locked', 'reload', 'phone', 'carbine'];
const sizes = (process.env.SIZES || '1280x720,1280x800,1720x720').split(',').map((s) => s.split('x').map(Number));
const [vw, vh] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.GPU
  ? { channel: process.env.CHROME ? undefined : 'chromium', executablePath: process.env.CHROME || undefined, headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--window-position=4000,4000', `--window-size=${vw},${vh}`] }
  : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const log = []; page.on('console', (m) => { if (m.type() === 'error') log.push(`[${m.type()}] ${m.text().slice(0, 300)}`); }); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, pictures: [], ok: false };
const shot = async (id) => { const path = join(outDir, `${name}-${id}.png`); await page.screenshot({ path, timeout: 180000 }); report.pictures.push(path); console.log(path); };
const until = async (what, fn, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await page.evaluate(fn); if (v) return v; await page.waitForTimeout(250); } throw new Error(`timed out waiting for ${what}`); };
const G = (fn, arg) => page.evaluate(fn, arg); // inside, `g` is the engine's context (this repository's dev lane: engineOf)

try {
  await page.goto(url);
  await until('the page', () => window.__ready === true || window.__fatal, 180);
  if (await G(() => window.__fatal)) throw new Error(await G(() => window.__fatal));
  if (process.env.PHONE_W) await page.addStyleTag({ content: `:root .opus-phone { --w: min(${process.env.PHONE_W}vw, 118vh); }` });
  await page.click('#start');
  await until('play', () => window.__OPUS_WORLD.state() === 'playing', 60);
  await G(async () => {
    const { engineOf } = await import('/engine/src/world/open.js');
    const g = engineOf(window.__OPUS_WORLD).G; window.__g = g; window.__hold = { fire: false, ads: false };
    for (const k of ['fire', 'ads']) Object.defineProperty(g.input, k, { get: () => window.__hold[k], set() {}, configurable: true });
    document.getElementById('help').style.display = 'none'; document.getElementById('brief').style.display = 'none';
  });
  await page.waitForTimeout(1500);
  const tellW = () => G(() => { const w = window.__g.weapon; return { name: w.name, ammo: w.ammo, state: w.state, ads: +w.ads.toFixed(2) }; });
  const frames = (n) => G((n) => new Promise((res) => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  await page.keyboard.press('Digit2'); await page.waitForTimeout(1200);
  report.weapon = await tellW();
  if (want.includes('hip')) await shot('hip');
  if (want.includes('ads')) { await G(() => { window.__hold.ads = true; }); await page.waitForTimeout(800); await shot('ads'); await G(() => { window.__hold.ads = false; }); await page.waitForTimeout(600); }
  if (want.includes('fire')) {
    // one round, then the clock nearly stops with the slide at the end of its stroke: the picture shows the recoil
    await G(() => { window.__hold.fire = true; });
    await until('a round', () => window.__g.weapon.ammo < 17, 5);
    await G(() => { window.__hold.fire = false; window.__g.clock.setScale(0.03); });
    await page.waitForTimeout(60); await shot('fire'); await G(() => window.__g.clock.setScale(1)); await page.waitForTimeout(600);
  }
  if (want.includes('locked')) {
    await G(() => { window.__g.weapon.ammo = 1; window.__hold.fire = true; }); await page.waitForTimeout(150); await G(() => { window.__hold.fire = false; });
    await page.waitForTimeout(500); report.locked = await tellW(); await shot('locked');
  }
  if (want.includes('reload')) {
    await G(() => { const d = window.__g.weapon.debug; d.empty = true; d.reloadT = 0.62; }); await page.waitForTimeout(700); await shot('reload');
    await G(() => { const d = window.__g.weapon.debug; d.reloadT = null; });
    await page.waitForTimeout(3000); report.afterReload = await tellW();
  }
  if (want.includes('phone')) {
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
      await page.keyboard.press('KeyT'); await page.waitForTimeout(1400);
      report.held = await G(() => window.__OPUS_WORLD.held());
      await shot(`phone-${w}x${h}`);
      await page.keyboard.press('Tab'); await page.waitForTimeout(900); // Tab puts it away whatever is on the glass (a live ATAK takes every other key)
      if (w === sizes[0][0] && h === sizes[0][1]) await shot('phone-lowered');
    }
    await page.setViewportSize({ width: vw, height: vh }); await page.waitForTimeout(500);
  }
  if (want.includes('carbine')) {
    await page.keyboard.press('Digit1'); await page.waitForTimeout(1200); await shot('carbine-hip');
    await page.keyboard.press('KeyT'); await page.waitForTimeout(1400); await shot('carbine-phone'); await page.keyboard.press('Tab'); await page.waitForTimeout(800);
  }
  report.ok = true;
} catch (e) { report.error = String((e && e.stack) || e); await shot('failed').catch(() => {}); }
report.console = log.slice(0, 20);
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ok: report.ok, error: report.error, weapon: report.weapon, locked: report.locked, afterReload: report.afterReload, held: report.held, console: report.console }, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
