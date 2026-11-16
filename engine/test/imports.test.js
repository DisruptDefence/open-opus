// Imports go down the table of docs/ARCHITECTURE.md, never up. This test reads every source file's import
// statements and fails on one that climbs, on a pure module that touches three.js or the DOM, and on outside code
// that reaches past the door.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT } from './helpers.js';

// The table. `level` (meshes a decoded chunk), `shared` (helpers the lifted modules have in common) are engine-layer
// modules; the composition root lives in `world`.
const LAYER = {
  geo: 0, terrain: 0, physics: 0, nav: 0, scene: 0, gen: 0, content: 0,
  core: 1, render: 1, materials: 1, input: 1, fx: 1, audio: 1, hud: 1, level: 1, shared: 1,
  player: 2, combat: 2, weapons: 2, threats: 2, director: 2,
  world: 3,
};
const NAMES = ['pure', 'engine', 'simulation', 'door'];

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(js|mjs)$/.test(n) ? [p] : []; });
/** Every module specifier a file imports: static, side-effect, re-export and dynamic. */
export function importsOf(text) {
  const out = [], re = /(?:^|[\s;])(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m; (m = re.exec(text));) out.push(m[1] || m[2]);
  return out;
}
const moduleOf = (file) => { const r = relative(join(ROOT, 'src'), file).split(/[\\/]/); return r[0] === '..' || r.length < 2 ? null : r[0]; };
const isVendor = (file) => relative(join(ROOT, 'vendor'), file).split(/[\\/]/)[0] !== '..';

test('the import reader sees every kind of import', () => {
  assert.deepEqual(importsOf(`import a from './a.js';\nimport {\n b,\n c } from "../b.js";\nimport './c.js';\nexport { d } from './d.js';\nexport * from './e.js';\nconst f = await import('./f.js');\n// important: from here\nconst s = 'not an import';`),
    ['./a.js', '../b.js', './c.js', './d.js', './e.js', './f.js']);
});

test('every engine module is in the table and imports only its own layer or below', () => {
  const bad = [], src = files(join(ROOT, 'src'));
  assert.ok(src.length > 25, 'the source tree was found');
  for (const file of src) {
    const mod = moduleOf(file), layer = LAYER[mod], name = relative(ROOT, file);
    if (layer === undefined) { bad.push(`${name}: module "${mod}" is not in the layer table`); continue; }
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) { bad.push(`${name}: imports the package "${spec}"; the engine has no dependencies but the vendored three.js`); continue; }
      const target = resolve(dirname(file), spec);
      if (isVendor(target)) { if (layer === 0) bad.push(`${name}: a pure module imports three.js`); continue; }
      const to = moduleOf(target);
      if (to === null) bad.push(`${name}: imports ${spec}, which is outside src/ and vendor/`);
      else if (LAYER[to] === undefined) bad.push(`${name}: imports unknown module "${to}"`);
      else if (LAYER[to] > layer) bad.push(`${name} (${NAMES[layer]}) imports ${to} (${NAMES[LAYER[to]]}): imports go down, never up`);
    }
  }
  assert.deepEqual(bad, []);
});

test('pure modules do not touch the DOM', () => {
  const bad = [];
  for (const file of files(join(ROOT, 'src'))) {
    if (LAYER[moduleOf(file)] !== 0) continue;
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // the global, not a field that happens to share its name (a style has a `window`)
    const m = code.match(/(?<![.\w$'"])\b(document|window|navigator|HTMLElement|requestAnimationFrame|localStorage)\b(?!\s*:|['"])/);
    if (m) bad.push(`${relative(ROOT, file)}: uses ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('outside code uses the door only: the public entry reads the door, hosts read the public entry', () => {
  const bad = [];
  // index.js is the door's public face: the world, the error its apply() throws, the scene sources a host hands it,
  // the HUD seam a host fills
  const ENTRY = ['src/world/open.js', 'src/director/command-error.js', 'src/scene/source.js', 'src/content/default.js', 'src/hud/dev-hud.js', 'src/hud/hooks.js', 'src/hud/hud.js'];
  for (const spec of importsOf(readFileSync(join(ROOT, 'index.js'), 'utf8'))) if (!ENTRY.includes(relative(ROOT, resolve(ROOT, spec)))) bad.push(`index.js: exports ${spec}`);
  for (const file of files(join(ROOT, 'host'))) for (const spec of importsOf(readFileSync(file, 'utf8'))) {
    const target = relative(ROOT, resolve(dirname(file), spec));
    if (target !== 'index.js' && !target.startsWith('host' + '/')) bad.push(`${relative(ROOT, file)}: imports ${spec}; a host imports index.js and nothing else of the engine`);
  }
  // and no host reads an engine global or the engine behind the world
  for (const file of files(join(ROOT, 'host'))) { const t = readFileSync(file, 'utf8'); if (/engineOf|__OPUS_DEBUG|\.G\b/.test(t)) bad.push(`${relative(ROOT, file)}: reaches behind the world API`); }
  assert.deepEqual(bad, []);
});
