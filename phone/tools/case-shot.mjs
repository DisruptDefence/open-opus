// Pictures of the phone's case, with no game and no server: a static page built with page.setContent, the phone's DOM taken
// from phone/host.js (PHONE_HTML, the same string the host uses), the stylesheet inlined, a grey backdrop, the phone raised and
// a flat map-like placeholder on the glass. Saves the whole view at 1280x720 and 1920x1080, 3x crops of the four corners and
// of the cable side, and prints the glass's bounding box so a change to the case can be shown not to move the screen.
//
//   flock /tmp/opus-heavy.lock env PLAYWRIGHT=/path/to/node_modules/playwright node phone/tools/case-shot.mjs <outDir> [prefix] [cssFile]
//
// prefix defaults to "after", cssFile to phone/phone.css (give an older copy of the stylesheet with prefix "before").
// If <outDir>/before-glass.json exists the glass boxes are compared with it, as a share of the phone's width --w.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHONE_HTML } from '../host.js';

if (!process.env.PLAYWRIGHT) { console.error('Set PLAYWRIGHT to the path of an installed playwright module.'); process.exit(2); }
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || '.'), prefix = process.argv[3] || 'after';
const css = readFileSync(resolve(process.argv[4] || join(here, '../phone.css')), 'utf8');
mkdirSync(outDir, { recursive: true });

const page_html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden}
body{position:relative;background:
  radial-gradient(120% 90% at 50% 20%, rgba(255,255,255,.22), transparent 60%),
  linear-gradient(180deg,#8c9399 0%,#6f757a 45%,#4d5256 70%,#3b3f41 100%)}
.ph{position:absolute;inset:0;background:repeating-linear-gradient(95deg,rgba(255,255,255,.03) 0 3px,rgba(0,0,0,.03) 3px 7px)}
.map{position:absolute;inset:0;background:
  linear-gradient(rgba(150,190,170,.12) 1px,transparent 1px) 0 0/12.5% 25%,
  linear-gradient(90deg,rgba(150,190,170,.12) 1px,transparent 1px) 0 0/12.5% 25%,
  linear-gradient(115deg,transparent 40%,rgba(200,200,160,.16) 40.3%,rgba(200,200,160,.16) 41.2%,transparent 41.5%),
  linear-gradient(160deg,#1b2a2c,#16211f)}
${css}</style><div class="ph"></div><div id="m"></div>`;

const browser = await chromium.launch();
const report = {};
for (const [W, H] of [[1280, 720], [1920, 1080]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(page_html);
  await page.evaluate((html) => {
    const f = document.createElement('div'); f.className = 'opus-phone'; f.innerHTML = html;
    document.getElementById('m').append(f);
    f.querySelector('.opus-phone-glass').innerHTML = '<div class="map"></div>';
    f.classList.add('on');
  }, PHONE_HTML);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `${prefix}-${W}.png`) });
  const m = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { glass: r('.opus-phone-glass'), phone: r('.opus-phone'), W: document.querySelector('.opus-phone').offsetWidth };
  });
  report[W] = m;
  // 3x crops: same page again at device scale 3
  const c3 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  const p3 = await c3.newPage();
  await p3.setContent(page_html);
  await p3.evaluate((html) => {
    const f = document.createElement('div'); f.className = 'opus-phone'; f.innerHTML = html;
    document.getElementById('m').append(f);
    f.querySelector('.opus-phone-glass').innerHTML = '<div class="map"></div>';
    f.classList.add('on');
  }, PHONE_HTML);
  await p3.waitForTimeout(700);
  const b = m.phone, w = m.W, cw = w * 0.16, ch = w * 0.12;
  const crops = {
    tl: [b.x - w * .02, b.y - w * .02], tr: [b.x + b.w - cw + w * .02, b.y - w * .02],
    bl: [b.x - w * .02, b.y + b.h - ch + w * .03], br: [b.x + b.w - cw + w * .02, b.y + b.h - ch + w * .03],
  };
  for (const [k, [x, y]] of Object.entries(crops)) await p3.screenshot({ path: join(outDir, `${prefix}-${W}-corner-${k}.png`), clip: { x: Math.max(0, x), y: Math.max(0, y), width: cw, height: ch } });
  await p3.screenshot({ path: join(outDir, `${prefix}-${W}-cable.png`), clip: { x: Math.max(0, b.x - w * .14), y: b.y + b.h / 2 - w * .09, width: w * .26, height: w * .18 } });
  await c3.close(); await ctx.close();
}
await browser.close();

writeFileSync(join(outDir, `${prefix}-glass.json`), JSON.stringify(report, null, 1));
for (const W of Object.keys(report)) { const g = report[W].glass; console.log(`${prefix} ${W}: glass x=${g.x.toFixed(2)} y=${g.y.toFixed(2)} w=${g.w.toFixed(2)} h=${g.h.toFixed(2)} (--w ${report[W].W}px)`); }
const bf = join(outDir, 'before-glass.json');
if (prefix !== 'before' && existsSync(bf)) {
  const before = JSON.parse(readFileSync(bf, 'utf8')); let ok = true;
  for (const W of Object.keys(report)) {
    const a = before[W].glass, g = report[W].glass, w = report[W].W;
    const d = { left: g.x - a.x, top: g.y - a.y, right: (g.x + g.w) - (a.x + a.w), bottom: (g.y + g.h) - (a.y + a.h) };
    const worst = Math.max(...Object.values(d).map(Math.abs)) / w * 100;
    console.log(`${W}: glass edge shift px ${JSON.stringify(d)}, worst ${worst.toFixed(3)} % of --w ${worst <= 1.5 ? 'ok' : 'FAIL'}`);
    if (worst > 1.5) ok = false;
  }
  if (!ok) process.exitCode = 1;
}
