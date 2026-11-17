// Pictures of the pistol view model on a plain grey page (tools/pistol-shot.html), not the game.
//   1. serve the repository root on 127.0.0.1 (any free port)
//   2. PLAYWRIGHT=/path/to/node_modules/playwright PISTOL_URL=http://127.0.0.1:PORT/engine/tools/pistol-shot.html \
//        flock /tmp/opus-heavy.lock node engine/tools/pistol-shot.mjs outDir [name]
// Writes <outDir>/<name>-<colour>-<view>.png for left, right, top, front, rear, beauty and fpv, for the black and the
// coyote frame, plus <name>-black-back.png (slide locked back, magazine half out), and <name>.json with the triangle
// and draw-call counts. Playwright is not a dependency.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const outDir = process.argv[2] || '.', name = process.argv[3] || 'pistol';
const url = process.env.PISTOL_URL || 'http://127.0.0.1:9771/engine/tools/pistol-shot.html';
mkdirSync(outDir, { recursive: true });

// the middle of the gun in group space: about (0, 0.0, -0.095)
const mid = [0, -0.032, -0.085];
const views = {
  left: { pos: [-0.62, -0.032, -0.095], at: mid, fov: 24 },
  right: { pos: [0.62, -0.032, -0.095], at: mid, fov: 24 },
  top: { pos: [0, 0.75, -0.095], at: [0, 0, -0.095], fov: 24, up: [0, 0, -1] },
  front: { pos: [0, -0.02, -0.75], at: [0, -0.02, 0], fov: 14 },
  rear: { pos: [0, 0.043, 0.30], at: [0, 0.0355, -0.2], fov: 22 },
  beauty: { pos: [0.34, 0.12, -0.42], at: [0, -0.035, -0.1], fov: 30 },
  // as held at the ready: 0.45 m behind and 0.06 m above the rear sight, looking along the bore
  detail: { pos: [0.20, 0.07, -0.02], at: [0, 0.015, -0.055], fov: 22 },
  grip: { pos: [-0.30, -0.10, 0.12], at: [0, -0.07, -0.02], fov: 22 },
  fpv: { pos: [0, 0.0355 + 0.06, -0.012 + 0.45], at: [0, 0.0135, -0.5], fov: 28 },
};
// GPU=1 draws on the graphics card (run it as `GPU=1 GALLIUM_DRIVER=d3d12 flock ...`); otherwise software WebGL
const browser = await chromium.launch(process.env.GPU
  ? { channel: 'chromium', headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--window-position=4000,4000', '--window-size=1280,720'] }
  : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const log = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text().slice(0, 400)}`); }); page.on('pageerror', (e) => log.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
const report = { url, pictures: [], ok: false };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const only = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
  for (const [colour, hex] of [['black', '#1f2022'], ['coyote', '#8a7a5c']]) {
    const info = await page.evaluate(([h]) => window.build(h), [hex]);
    report.triangles = info.triangles; report.drawCalls = info.dims.drawCalls;
    for (const [id, v] of Object.entries(views)) {
      if (only && !only.includes(id)) continue;
      const calls = await page.evaluate((v) => window.shoot(v), v);
      const path = join(outDir, `${name}-${colour}-${id}.png`);
      await page.screenshot({ path }); report.pictures.push({ path, calls }); console.log(path, 'calls', calls);
    }
  }
  await page.evaluate(() => window.build('#1f2022', { slide: true, mag: 0.045, pull: true }));
  for (const id of ['right', 'left', 'beauty', 'detail', 'grip']) {
    if (only && !only.includes(id)) continue;
    const calls = await page.evaluate((v) => window.shoot(v), views[id]);
    const path = join(outDir, `${name}-black-back-${id}.png`);
    await page.screenshot({ path }); report.pictures.push({ path, calls }); console.log(path, 'calls', calls);
  }
  report.ok = true;
} catch (e) { report.error = String((e && e.stack) || e); }
report.console = log.slice(0, 20);
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ok: report.ok, error: report.error, console: report.console, tris: report.triangles }, null, 1));
await browser.close();
process.exit(report.ok ? 0 : 1);
