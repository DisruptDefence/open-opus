// Shows the HUD in play in a headless browser and saves pictures to LOOK at. It uses a small host page of its own,
// served by this script from a route (no file is added to the repository), that opens the engine with createHud and
// drives it through the world API only: commands, the player's keys, and events.
//
//   1. serve the repository root:   python3 -m http.server 9762 --bind 127.0.0.1      (from the repository root)
//   2. PLAYWRIGHT=/path/to/node_modules/playwright node engine/tools/hud-shot.mjs [scenario] [outDir] [WxH,WxH]
//      scenario: test (default) | old-quebec     sizes default to 1280x720,960x540     HUD_BASE overrides http://127.0.0.1:9762
//
// Pictures per size: 1-idle (objective, markers, radio line, message), 2-prompt (a mark used with the key, half way),
// 3-lowammo, 4-reloading, 5-damage (an arc), 6-kill (feed and kill marker). Exit 0 only when every element was seen
// displayed, no two panels overlap, none is clipped by the window, and the page raised no error.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const scenario = process.argv[2] || 'test', outDir = process.argv[3] || '.';
const sizes = (process.argv[4] || '1280x720,960x540').split(',').map((s) => s.split('x').map(Number));
const base = process.env.HUD_BASE || 'http://127.0.0.1:9762';
mkdirSync(outDir, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>hud-shot</title><style>
html,body{margin:0;height:100%;background:#0b0d0f;overflow:hidden}#app{position:fixed;inset:0}#view{position:absolute;inset:0;width:100%;height:100%;display:block}#ui{position:absolute;inset:0;pointer-events:none}</style></head>
<body><div id="app"><canvas id="view"></canvas><div id="ui"></div></div><script type="module">
import { openWorld, packageSource, jsonSource, createHud } from '/engine/index.js';
const params = Object.fromEntries(new URLSearchParams(location.search));
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason)));
{ const err = console.error.bind(console); console.error = (...a) => { window.__errors.push(a.join(' ').slice(0, 400)); err(...a); }; }
const getJson = async (u) => (await fetch(u)).json();
const source = params.scenario === 'old-quebec' ? getJson('/scenes/old-quebec.json').then(jsonSource) : packageSource(new URL('/engine/scenes/test/', location.href).href);
if (params.scenario === 'old-quebec') { params.x = 0; params.z = -60; }
window.__OPUS_WORLD = openWorld({ source, params, modules: { hud: createHud } });
window.__OPUS_WORLD.ready().then(() => { window.__ready = true; }, (e) => { window.__fatal = String((e && e.stack) || e); });
// what has been seen displayed, sampled every frame
window.__seen = {};
const SEL = { compass: '.oh-compass', 'compass tag': '.oh-compass .tag', 'world tag': '.oh-tag', objective: '.oh-obj', 'objective pips': '.oh-obj .pips i', health: '.oh-health', ammo: '.oh-ammo', 'ammo pips': '.oh-ammo .pips i', crosshair: '.oh-x i.d',
  hitmarker: '.oh-hit i', damage: '.oh-arcs i', feed: '.oh-feed div', prompt: '.oh-prompt', radio: '.oh-radio', warn: '.oh-warn', message: '.oh-msg', cue: '.oh-ammo .cue' };
const alpha = (e) => { let a = 1; for (; e && e.nodeType === 1 && !e.classList.contains('oh'); e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none') return 0; a *= +s.opacity; } return a; };
const shown = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && alpha(e) > 0.05 && (e.textContent.trim() !== '' || !/warn|msg|cue|obj$/.test(e.className) || e.className.includes('pips')); };
window.__sel = SEL;
(function sample() { for (const k in SEL) for (const e of document.querySelectorAll(SEL[k])) if (shown(e)) window.__seen[k] = true; requestAnimationFrame(sample); })();
window.__layout = () => { // panels that must never overlap each other or leave the window
  const W = innerWidth, H = innerHeight, out = { overlaps: [], clipped: [] }, boxes = [];
  for (const [k, s] of Object.entries({ compass: '.oh-compass', objective: '.oh-obj', feed: '.oh-feed', warn: '.oh-warn', message: '.oh-msg', prompt: '.oh-prompt', radio: '.oh-radio', health: '.oh-health', ammo: '.oh-ammo' })) {
    const e = document.querySelector(s); if (!e || !shown(e)) continue;
    const r = e.getBoundingClientRect(); boxes.push([k, r]);
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.clipped.push(k);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i][1], b = boxes[j][1]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.overlaps.push(boxes[i][0] + ' x ' + boxes[j][0]); }
  return out;
};
</script></body></html>`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { scenario, sizes: [], ok: false, pictures: [] };
const log = [];
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('console', (m) => log.push(`[${m.type()}] ${m.text().slice(0, 300)}`)); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
    await page.route('**/engine/hud-shot.html*', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(`${base}/engine/hud-shot.html?scenario=${scenario}&q=low&noaudio=1`);
    const world = (fn, arg) => page.evaluate(fn, arg);
    const until = async (what, fn, arg, seconds = 60) => { for (let i = 0; i < seconds * 4; i++) { const v = await world(fn, arg); if (v) return v; await page.waitForTimeout(250); } throw new Error(`timed out waiting for ${what}`); };
    const size = { w, h, pictures: [], layout: [] };
    const shot = async (name) => { const p = join(outDir, `hud-${scenario}-${w}x${h}-${name}.png`); await page.screenshot({ path: p, timeout: 180000 }); size.pictures.push(p); report.pictures.push(p); size.layout.push({ name, ...(await world(() => window.__layout())) }); };
    await until('ready', () => window.__ready || window.__fatal, undefined, 90);
    const fatal = await world(() => window.__fatal); if (fatal) throw new Error(fatal);
    // start where the scenario starts, then place everything relative to where the player is
    const start = scenario === 'old-quebec' ? { x: 0, z: -60, heading: 0 } : null;
    await world((s) => { const W = window.__OPUS_WORLD; window.__ev = []; for (const n of ['player:hit', 'say']) W.on(n, (e) => window.__ev.push([n, e])); W.on('entity', (e) => window.__ev.push(['entity', e])); W.start(s ? { at: s } : {}); }, start);
    await until('play', () => window.__OPUS_WORLD.state() === 'playing', undefined, 20);
    await until('the fade-in', () => window.__OPUS_WORLD.snapshot().time > 3.2, undefined, 90); // start() fades in from black over 2.6 s
    const me = await world(() => { const s = window.__OPUS_WORLD.snapshot().self; return { x: s.x, y: s.y, z: s.z, heading: s.heading }; });
    const fwd = (d, side = 0) => { const a = (me.heading * Math.PI) / 180; return { x: +(me.x + d * Math.sin(a) + side * Math.cos(a)).toFixed(2), z: +(me.z - d * Math.cos(a) + side * Math.sin(a)).toFixed(2) }; };
    const apply = (c) => world((cmd) => window.__OPUS_WORLD.apply(cmd), c);
    const seen = () => world(() => window.__seen);

    await apply({ op: 'objective', text: 'Reach the marked position, then hold it', done: 1, total: 3 });
    await apply({ op: 'mark', id: 'm-obj', kind: 'objective', label: 'Alpha', ...fwd(30, 6) });
    await apply({ op: 'mark', id: 'm-ext', kind: 'extraction', label: 'Exfil', ...fwd(-25, -20) });
    await apply({ op: 'mark', id: 'm-use', kind: 'objective', label: 'Panel', ...fwd(2.2), radius: 2.5, use: { seconds: 9, prompt: 'Open the panel' } });
    await apply({ op: 'say', channel: 'radio', who: 'Net', text: 'All stations, contact expected from the north. Hold your fire until ordered.', seconds: 60 });
    await apply({ op: 'say', channel: 'warn', text: 'Contact', seconds: 60 });
    await apply({ op: 'say', text: 'Move to the marked position', seconds: 60 });
    await page.waitForTimeout(3000);
    await until('radio typed', () => document.querySelector('.oh-radio .tx') && document.querySelector('.oh-radio .tx').textContent.length > 60, undefined, 60);
    await shot('1-idle');

    // a mark used with the key, half way: the prompt and its ring
    await page.keyboard.down('KeyE');
    await until('progress', () => { const p = window.__OPUS_WORLD.snapshot().entities.find((e) => e.id === 'm-use'); return p && p.use && p.use.progress > 0.45; }, undefined, 90);
    await shot('2-prompt'); await page.keyboard.up('KeyE');
    await apply({ op: 'unmark', id: 'm-use' });
    await apply({ op: 'say', channel: 'warn', text: '', seconds: 0.1 }); await apply({ op: 'say', text: '', seconds: 0.1 });

    // low ammunition, then a reload
    await page.keyboard.down('Enter');
    await until('low ammo', () => window.__OPUS_WORLD.snapshot().self.weapon.ammo <= 8, undefined, 60);
    await page.keyboard.up('Enter'); await page.waitForTimeout(600);
    await shot('3-lowammo');
    await page.keyboard.press('KeyR');
    await until('reloading', () => window.__OPUS_WORLD.snapshot().self.weapon.state === 'reloading', undefined, 20);
    await shot('4-reloading');
    await until('reloaded', () => window.__OPUS_WORLD.snapshot().self.weapon.state !== 'reloading', undefined, 60);

    // under fire: a sentry in front of the player, facing it
    // the player cannot look up or down through the world API, so the sentry stands on ground level with the player's feet
    let spot = null, best = 9;
    for (const d of [11, 9, 13, 7, 15, 5]) for (const side of [0, 2, -2, 4, -4, 7, -7]) {
      const at = fwd(d, side); await apply({ op: 'spawn', id: 'probe', kind: 'sentry', ...at });
      const y = await world(() => window.__OPUS_WORLD.snapshot().entities.find((e) => e.id === 'probe').y); await apply({ op: 'despawn', id: 'probe' });
      const off = Math.abs(y - me.y - 0.2); if (off < best) { best = off; spot = at; }
      if (best < 0.2) break;
    }
    size.spot = { spot, levelError: +best.toFixed(2) };
    await apply({ op: 'spawn', id: 'shooter', kind: 'sentry', ...spot, heading: (me.heading + 180) % 360, alerted: true });
    await until('a hit', () => window.__ev.some((e) => e[0] === 'player:hit'), undefined, 90);
    await shot('5-damage');
    // keep facing the sentry (place with now moves the player where it stands, turned to it) and fire short bursts (held fire climbs
    // with the recoil) until the round that kills it; the picture is taken at once, while the kill marker is still up
    const killed = () => world(() => window.__ev.some((x) => x[0] === 'entity' && x[1].change === 'killed' && x[1].id === 'shooter'));
    let got = false;
    for (let i = 0; i < 30 && !got; i++) {
      await world(() => { const W = window.__OPUS_WORLD, s = W.snapshot(), t = s.entities.find((e) => e.id === 'shooter'); if (!t) return;
        W.apply({ op: 'place', x: s.self.x, z: s.self.z, heading: ((Math.atan2(t.x - s.self.x, -(t.z - s.self.z)) * 180) / Math.PI + 360) % 360, now: true }); });
      await page.keyboard.down('Enter');
      for (let j = 0; j < 6 && !got; j++) { await page.waitForTimeout(80); got = await killed(); }
      if (got) await shot('6-kill');
      await page.keyboard.up('Enter'); if (!got) await page.waitForTimeout(900);
    }
    if (!got) { await shot('failed-kill'); throw new Error('timed out waiting for a kill: ' + JSON.stringify(await world(() => { const sn = window.__OPUS_WORLD.snapshot(); return { self: sn.self, stats: sn.stats, shooter: sn.entities.find((e) => e.id === 'shooter') }; }))); }
    await page.waitForTimeout(500);
    await shot('7-after-kill');

    size.seen = await seen(); size.errors = await world(() => window.__errors);
    report.sizes.push(size);
    await page.close();
  }
  const need = ['compass', 'compass tag', 'world tag', 'objective', 'objective pips', 'health', 'ammo', 'ammo pips', 'crosshair', 'hitmarker', 'damage', 'feed', 'prompt', 'radio', 'warn', 'message', 'cue'];
  report.missing = report.sizes.flatMap((s) => need.filter((k) => !s.seen[k]).map((k) => `${s.w}x${s.h}: ${k}`));
  report.overlaps = report.sizes.flatMap((s) => s.layout.filter((l) => l.overlaps.length || l.clipped.length).map((l) => `${s.w}x${s.h} ${l.name}: overlaps [${l.overlaps}] clipped [${l.clipped}]`));
  report.errors = report.sizes.flatMap((s) => s.errors);
  report.ok = !report.missing.length && !report.overlaps.length && !report.errors.length;
} catch (e) { report.error = String((e && e.stack) || e); }
report.console = log.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
