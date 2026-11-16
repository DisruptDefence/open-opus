// Pictures of the threat figures in a headless browser, in photo mode (no HUD, no weapon): the same places every time,
// so a change to a figure is shown before and after.
//
//   1. serve the repository root on 127.0.0.1 (any free port)
//   2. PLAYWRIGHT=/path/to/node_modules/playwright ENGINE_URL=http://127.0.0.1:PORT/engine/dev.html \
//        node engine/tools/figure-shot.mjs outDir [name]
//      SETS=distance,gallery,street  (default all)   SIZE=1280x720   QUERY adds switches (default q=high&tod=15)
//
//   distance  one person at 5, 15 and 40 m in Old Quebec, viewpoint 1, facing the camera (three pictures)
//   gallery   every archetype, then a person in each pose (idle, walk, run, aim, fire, hit, crouch, dead), at 7 m
//   street    Old Quebec viewpoints 1 and 10 with a few threats standing and walking in the street
//   look      (with SCENE=test) close-ups of every look of the people and of their poses, in the quick test scene
//
// The world is left in `title`, so nothing moves by itself: each figure is posed through the threats module's `pose`
// (an engine-internal call for tools and tests, reached with engineOf like the headless tests do). A figure without
// one is drawn as spawned. Writes <outDir>/<name>-<set>-<view>.png and <outDir>/<name>.json with draw calls and
// triangles per picture. Playwright is not a dependency.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || '.', name = process.argv[3] || 'figures';
const sets = (process.env.SETS || 'distance,gallery,street').split(',');
const [W, H] = (process.env.SIZE || '1280x720').split('x').map(Number);
const views = JSON.parse(readFileSync(join(here, 'viewpoints', 'old-quebec.json'), 'utf8')).views;
const view = (id) => views.find((v) => v.id.startsWith(id));
const base = process.env.ENGINE_URL || 'http://127.0.0.1:9760/engine/dev.html';
const v1 = view('1-'), v10 = view('10-');
// SCENE=test: the generated test scene, quick to load, for the `look` set only (close-ups while a figure is worked on)
const quick = process.env.SCENE === 'test';
const url = quick ? `${base}?scene=test&noaudio=1&shot=1&x=20&z=18&${process.env.QUERY || 'q=medium&tod=15'}`
  : `${base}?scene=../scenes/old-quebec.json&noaudio=1&shot=1&x=${v1.x}&z=${v1.z}&${process.env.QUERY || 'q=high&tod=15'}`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const log = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text().slice(0, 300)}`); }); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, pictures: [], ok: false };

// ---- in the page -------------------------------------------------------------------------------------------------
/** Put threats down and pose them. `items`: [{ id, kind, x, z, heading, pose? }]; poses: see threats.js `pose`. */
async function stage(items) {
  return page.evaluate(async (items) => {
    const { engineOf } = await import(new URL('./src/world/open.js', location.href).href);
    const world = window.__OPUS_WORLD, G = engineOf(world).G;
    world.apply({ op: 'clear' });
    const out = [];
    for (const it of items) {
      if (!G.threats.knows(it.kind)) it.kind = 'sentry'; // an older pack (a "before" picture)
      world.apply({ op: 'spawn', id: it.id, kind: it.kind, x: it.x, z: it.z, heading: it.heading, ...(it.y !== undefined ? { y: it.y } : {}) });
      const t = G.threats.list.find((x) => x.id === it.id);
      if (it.hover !== undefined) t.pos.y = G.physics.groundHeight(t.pos.x, t.pos.z) + it.hover; // an air threat brought down into the picture
      if (it.pose && G.threats.pose) G.threats.pose(t, it.pose);
      else if (G.threats.place) G.threats.place(t);
      out.push({ id: it.id, kind: t.archetype, posed: !!(it.pose && G.threats.pose), pos: [t.pos.x, t.pos.y, t.pos.z].map((v) => +v.toFixed(2)) });
    }
    return out;
  }, items);
}
async function picture(set, id, pose) {
  await page.evaluate((p) => window.__OPUS_WORLD.photo(p), pose);
  await page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), +(process.env.FRAMES || 6));
  const stats = await page.evaluate(() => window.__OPUS_WORLD.stats());
  const path = join(outDir, `${name}-${set}-${id}.png`);
  await page.screenshot({ path, timeout: 300000 });
  report.pictures.push({ set, id, path, calls: stats.calls, triangles: stats.triangles, frameMs: stats.frameMs });
  console.log(path, 'calls', stats.calls, 'tris', stats.triangles);
}
/** A place `d` metres ahead of a pose, `side` metres to its right. */
const ahead = (v, d, side = 0) => { const h = (v.heading * Math.PI) / 180; return { x: +(v.x + Math.sin(h) * d + Math.cos(h) * side).toFixed(2), z: +(v.z - Math.cos(h) * d + Math.sin(h) * side).toFixed(2) }; };
const facing = (v) => (v.heading + 180) % 360;

try {
  await page.goto(url);
  for (let i = 0; i < 1200 && !(await page.evaluate(() => !!window.__ready || window.__fatal)); i++) await page.waitForTimeout(500);
  const fatal = await page.evaluate(() => window.__fatal || null); if (fatal) throw new Error(fatal);
  await page.addStyleTag({ content: '#ui, #boot { display: none !important }' });
  const cam = (v, extra = {}) => ({ x: v.x, z: v.z, heading: v.heading, pitch: v.pitch, fov: v.fov || 60, ...extra });

  if (sets.includes('look')) { // close-ups: front and three-quarter, every look of the two human archetypes, and the poses
    const c = { x: 20, z: 19, heading: 0 }; // the test scene's open ground north of the player's start
    const row = (kind, n, d, pose, turn = 0) => Array.from({ length: n }, (_, i) => ({ id: kind[0] + i, kind, ...ahead(c, d, (i - (n - 1) / 2) * 1.0), heading: facing(c) + turn, pose }));
    await stage([...row('sentry', 4, 4.2, { anim: 'idle', t: 1 }), ...row('patrol', 4, 6, { anim: 'idle', t: 1 }, 30)]);
    await picture('look', 'looks', cam(c, { pitch: -8, fov: 55 }));
    const poses = [['walk', { speed: 1.4 }], ['run', { speed: 4.5 }], ['aim', {}], ['crouch', {}], ['dead', { t: 2.5 }]];
    await stage(poses.map(([a, o], i) => ({ id: 'q' + i, kind: 'sentry', ...ahead(c, 5, (i - 2) * 1.3), heading: facing(c) - 70, pose: { anim: a, t: 0.8, ...o } })));
    await picture('look', 'poses', cam(c, { pitch: -9, fov: 58 }));
  }
  if (sets.includes('distance')) for (const d of [5, 15, 40]) {
    await stage([{ id: 'p', kind: 'sentry', ...ahead(v1, d), heading: facing(v1), pose: { anim: 'idle', t: 1.3 } }]);
    await picture('distance', d + 'm', cam(v1, { pitch: d < 10 ? -6 : 0 }));
  }
  if (sets.includes('gallery')) {
    const kinds = ['sentry', 'patrol', 'crawler', 'quadcopter'];
    await stage(kinds.map((k, i) => ({ id: 'k' + i, kind: k, ...ahead(v1, 8, (i - 1.5) * 1.9), heading: facing(v1) - 25, hover: k === 'quadcopter' ? 2.2 : undefined, pose: { anim: 'idle', t: 1 } })));
    await picture('gallery', 'kinds', cam(v1, { pitch: -4 }));
    const poses = [['idle', {}], ['walk', { speed: 1.4 }], ['run', { speed: 4.5 }], ['aim', {}], ['fire', {}], ['hit', { zone: 'torso' }], ['crouch', {}], ['dead', { t: 2.5 }]];
    await stage(poses.map(([a, o], i) => ({ id: 'g' + i, kind: 'sentry', ...ahead(v1, 9, (i - 3.5) * 1.3), heading: facing(v1) - 60, pose: { anim: a, t: 0.9, ...o } })));
    await picture('gallery', 'poses', cam(v1, { pitch: -5, fov: 62 }));
    await stage(poses.slice(1, 3).map(([a, o], i) => ({ id: 'w' + i, kind: 'sentry', ...ahead(v1, 4.5, (i - 0.5) * 1.6), heading: facing(v1) + 90, pose: { anim: a, t: 0.7, ...o } })));
    await picture('gallery', 'gait', cam(v1, { pitch: -10 }));
  }
  if (sets.includes('street')) for (const v of [v1, v10]) {
    await stage([
      { id: 's1', kind: 'sentry', ...ahead(v, 9, -1.6), heading: facing(v) + 20, pose: { anim: 'aim', t: 1 } },
      { id: 's2', kind: 'patrol', ...ahead(v, 15, 1.8), heading: v.heading + 160, pose: { anim: 'walk', speed: 1.4, t: 1.1 } },
      { id: 's3', kind: 'patrol', ...ahead(v, 24, -2.5), heading: v.heading + 90, pose: { anim: 'walk', speed: 1.4, t: 0.5 } },
      { id: 's4', kind: 'crawler', ...ahead(v, 19, 3.2), heading: facing(v) - 30, pose: { anim: 'walk', speed: 1.5, t: 1 } },
      { id: 's5', kind: 'quadcopter', ...ahead(v, 22, 0), heading: facing(v), hover: 6, pose: { anim: 'idle', t: 1 } },
    ]);
    await picture('street', v.id.split('-')[0], cam(v));
  }
  report.errors = await page.evaluate(() => window.__errors || []);
  report.ok = report.errors.length === 0;
} catch (e) { report.error = String((e && e.stack) || e); }
report.console = log.slice(0, 20);
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ok: report.ok, error: report.error, errors: report.errors, console: report.console }, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
