// Raises and lowers the phone on the demo page in a headless browser, the way a person does (a click on Deploy, the
// T key), and reports what the world API and the phone said. Pictures are saved at each stage: look at them.
//
//   1. serve the repository root:   python3 -m http.server 9771 --bind 127.0.0.1
//   2. PLAYWRIGHT=/path/to/node_modules/playwright node phone/tools/check-phone.mjs [outDir]
//      PAGE_URL overrides http://127.0.0.1:9771/phone/demo.html; QUERY adds switches (gateway=ws://…)
//      REAL=1 waits for a real ATAK from the local gateway and pictures it (start phone/local/run.sh --codec av1
//      first: the Chromium that Playwright ships cannot decode H.264). It then waits for ATAK's own position
//      report to come back as Cursor-on-Target and checks that it lies where the player stands.
//      INJECT=1 (with REAL) also sends the gateway one hostile marker on the scenario's place, as a TAK client
//      would, to show the objective being met without working ATAK's menus by hand. It is not ATAK's doing.
//
// Playwright is not a dependency: point PLAYWRIGHT at any installed copy. Exit code 0 only when every check held.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const outDir = process.argv[2] || '.', real = !!process.env.REAL;
const url = `${process.env.PAGE_URL || 'http://127.0.0.1:9771/phone/demo.html'}?q=low&noaudio=1${process.env.QUERY ? '&' + process.env.QUERY : ''}`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const log = []; page.on('console', (m) => log.push(`[${m.type()}] ${m.text().slice(0, 300)}`)); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, checks: {}, pictures: [], ok: false };
const shot = async (name) => { const p = join(outDir, `phone-${name}.png`); await page.screenshot({ path: p, timeout: 180000 }); report.pictures.push(p); };
const until = async (what, fn, seconds) => { for (let i = 0; i < seconds * 4; i++) { const v = await page.evaluate(fn); if (v) return v; await page.waitForTimeout(250); } throw new Error(`timed out waiting for ${what}`); };
const state = () => page.evaluate(() => { const w = window.__OPUS_WORLD, s = w.snapshot().self, m = w.geo.toMGRS(s.x, s.z, 5), p = window.__phone;
  const frame = document.querySelector('.opus-phone'), r = frame.getBoundingClientRect();
  return { state: w.state(), held: w.held(), time: w.snapshot().time, grid: `${m.zone} ${m.square} ${m.easting} ${m.northing}`, headingTrue: s.headingTrue, phoneOpen: p.open,
    screen: p.screen.current(), glass: (document.querySelector('.opus-placeholder') || {}).innerText || '', frameVisible: !frame.hidden && r.top < innerHeight && r.bottom > 0,
    hud: getComputedStyle(document.querySelector('[data-k="tl"]').parentElement).display, launch: !document.querySelector('.opus-phone-launch').hidden }; });

try {
  await page.goto(url);
  await until('the page', () => window.__ready === true || window.__fatal, 120);
  if (await page.evaluate(() => window.__fatal)) throw new Error(await page.evaluate(() => window.__fatal));
  await page.click('#start');
  await until('play', () => window.__OPUS_WORLD.state() === 'playing', 30);
  await page.waitForTimeout(1500);
  const down = await state(); await shot('1-down');
  if (real) { await until('a real ATAK on the phone', () => window.__phone.screen.current() === 'tak-stream', 30); }

  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1500);
  if (real) await until('the phone\'s picture', () => document.querySelector('.opus-stream-note').textContent === '', 40);
  const up = await state(); await page.waitForTimeout(1000); const still = await state(); await shot('2-up');

  // slow motion from the switch above the phone, and back
  await page.click('.opus-phone-bar [data-m="slow"]'); const slow = await state();
  await page.click('.opus-phone-bar [data-m="pause"]');

  await page.keyboard.press(real ? 'Tab' : 'KeyT'); // with a real device T is a letter for it; Tab puts the phone away
  await page.waitForTimeout(1500);
  const after = await state(); await shot('3-down-again');

  await page.keyboard.press('Tab'); await page.waitForTimeout(600); const tab = await state();
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200); const esc = await state();

  const c = report.checks;
  if (real) {
    // ATAK reports its own position to its TAK server, the gateway: game -> GPS -> ATAK -> Cursor-on-Target -> page
    const own = await until('ATAK\'s own position report', () => { const w = window.__OPUS_WORLD.snapshot().self; const r = window.__reports.filter((e) => e.self).at(-1); return r ? { uid: r.uid, type: r.type, callsign: r.callsign, mgrs: r.mgrs, offBy: +Math.hypot(r.x - w.x, r.z - w.z).toFixed(1) } : null; }, 90).catch(() => null);
    report.atakOwnReport = own; c.atakReportsWhereThePlayerStands = !!own && own.offBy < 15;
    report.overlay = await page.evaluate(() => window.__overlay || null);
    if (process.env.INJECT) {
      const g = await page.evaluate(() => window.__OPUS_WORLD.geo.toGeo(79.5, -85.9));
      const t = new Date().toISOString(), cot = `<event version="2.0" uid="check-phone-1" type="a-h-G" how="h-g-i-g-o" time="${t}" start="${t}" stale="${t}"><point lat="${g.lat}" lon="${g.lon}" hae="0" ce="10" le="10"/><detail><contact callsign="CHECK"/></detail></event>`;
      await new Promise((res, rej) => { const s = connect(+(process.env.COT_PORT || 8087), '127.0.0.1', () => s.end(cot, res)); s.on('error', rej); });
      c.injectedMarkerMeetsObjective = !!(await until('the objective', () => window.__OPUS_WORLD.state() === 'complete', 20).catch(() => false));
      await page.waitForTimeout(800); await shot('4-objective-met');
    }
  }
  c.playingBefore = down.state === 'playing' && down.held === null && !down.phoneOpen && !down.frameVisible && down.launch;
  c.raisedHolds = up.held === 'pause' && up.phoneOpen && up.frameVisible && up.state === 'playing';
  c.hudHiddenUnderPhone = up.hud === 'none' && after.hud !== 'none';
  c.timeStandsStill = still.time === up.time;
  c.screen = up.screen;
  if (!real) { c.placeholderSaysSo = /no phone connected/i.test(up.glass); c.placeholderShowsTrueGrid = up.glass.includes(up.grid); }
  c.slowMotion = slow.held === 'slow';
  c.loweredReleases = after.held === null && !after.phoneOpen && !after.frameVisible && after.state === 'playing' && after.time > up.time;
  c.tabRaisesEscapeLowers = tab.phoneOpen && tab.held === 'pause' && !esc.phoneOpen && esc.held === null && esc.state === 'playing';
  report.grid = up.grid; report.glass = up.glass;
  report.errors = await page.evaluate(() => window.__errors);
  report.ok = Object.values(c).every((v) => v !== false) && report.errors.length === 0;
} catch (e) {
  report.error = String((e && e.stack) || e);
  await shot('failed').catch(() => {});
}
report.console = log.filter((l) => !/WebSocket connection to/.test(l)).slice(0, 20);
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
