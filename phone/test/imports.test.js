// The phone stays outside the engine: it reaches the game through the world API it is handed, never through an
// engine file; and the engine never imports the phone (docs/ARCHITECTURE.md). Only the host page's own script
// (demo.js) puts the two together, through the engine's public entry and its mission host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { importsOf } from '../../engine/test/imports.test.js';
import { REPO } from './helpers.js';

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === 'test' || n === 'vendor' ? [] : files(p)) : /\.(js|mjs)$/.test(n) ? [p] : []; });
const PAGE = { 'phone/demo.js': ['engine/index.js', 'engine/host/mission.js'] }; // a host page: what it may take from the engine

test('phone code imports only phone code; the host page takes the engine\'s public entry and mission host', () => {
  const bad = [];
  for (const file of files(join(REPO, 'phone'))) {
    const name = relative(REPO, file).split('\\').join('/');
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:') && name.startsWith('phone/tools/')) continue; // a tool run under Node, not page code
      if (!spec.startsWith('.')) { bad.push(`${name}: imports the package "${spec}"`); continue; }
      const target = relative(REPO, resolve(dirname(file), spec)).split('\\').join('/');
      if (target.startsWith('phone/')) continue;
      if (!(PAGE[name] || []).includes(target)) bad.push(`${name}: imports ${target}`);
    }
    if (!PAGE[name] && !name.startsWith('phone/tools/') && /engineOf|__OPUS_WORLD|__OPUS_DEBUG/.test(readFileSync(file, 'utf8'))) bad.push(`${name}: reaches for the game other than through the world it is handed`);
  }
  assert.deepEqual(bad, []);
});

test('the engine imports nothing of the phone', () => {
  const bad = [];
  for (const file of files(join(REPO, 'engine'))) for (const spec of importsOf(readFileSync(file, 'utf8'))) {
    if (spec.startsWith('.') && relative(REPO, resolve(dirname(file), spec)).split('\\').join('/').startsWith('phone/')) bad.push(`${relative(REPO, file)}: imports ${spec}`);
  }
  assert.deepEqual(bad, []);
});

test('the pure parts of the phone do not touch the page', () => {
  for (const f of ['core.js', 'reports.js']) {
    const code = readFileSync(join(REPO, 'phone', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(code.match(/\b(document|window|navigator|requestAnimationFrame|localStorage)\b/), null, f);
  }
});
