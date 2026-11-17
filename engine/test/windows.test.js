// Modelled windows (gen/facade.js, materials/openings.js): the room behind the glass, frames with depth, sills and lintels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { facadeNear } from '../src/gen/facade.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, SOUP } from '../src/gen/style.js';
import { building } from './helpers.js';

const style = resolveStyle(), flat = () => 30, info = { slots: [], ridge: [], parapet: 0 };
const RING = [0, 0, 10, 0, 10, 8, 0, 8];
const only = { casement: 1 }, fixed = { ...style, window: { ...style.window, bay: [2.5, 2.5], shutters: 0, mix: { ground: only, upper: only, top: only } } };
const wallOnly = (extra = {}) => building(RING, { blind: new Set([1, 2, 3]), ...extra });
const near = (b, st = fixed) => { const s = createSoups(); facadeNear(s, b, flat, st, info); return s; };
/** [{ u0, v0, u1, v1 }] of every glass quad (the quad's four vertices carry the uv, two triangles each). */
const glassQuads = (soups) => { const g = soups.map.get(SOUP.window), out = []; if (!g) return out; for (let i = 0; i < g.uv.length; i += 12) out.push({ u0: g.uv[i], v0: g.uv[i + 1], u1: g.uv[i + 2], v1: g.uv[i + 5] }); return out; };

test('the room behind the glass: all four states occur at the shares of the weights, the same building twice is identical, v spans a quarter', () => {
  const count = [0, 0, 0, 0]; let n = 0;
  for (let id = 1; id <= 40; id++) {
    const q = glassQuads(near(wallOnly({ id })));
    for (const g of q) { const row = Math.round(g.v0 * 4); assert.ok(Math.abs(g.v0 * 4 - row) < 1e-9 && Math.abs((g.v1 - g.v0) - 0.25) < 1e-9, 'v spans exactly a quarter'); assert.ok(row >= 0 && row <= 3); count[row]++; n++; }
    assert.deepEqual(glassQuads(near(wallOnly({ id }))), q, 'the same building twice');
  }
  assert.ok(n >= 200, `windows ${n}`);
  const w = style.window.states, tot = w.dark + w.curtains + w.blind + w.lit;
  [w.dark, w.curtains, w.blind, w.lit].forEach((x, i) => assert.ok(Math.abs(count[i] / n - x / tot) < 0.08, `state ${i}: ${(count[i] / n).toFixed(3)} against ${(x / tot).toFixed(3)}`));
});
test('window states come from style.window.states; a style without the key draws with the defaults', () => {
  const lit = { ...fixed, window: { ...fixed.window, states: { dark: 0, curtains: 0, blind: 0, lit: 1 } } };
  assert.ok(glassQuads(near(wallOnly({ id: 5 }), lit)).every((g) => Math.round(g.v0 * 4) === 3));
  const old = { ...fixed, window: { ...fixed.window } }; delete old.window.states;
  assert.ok(glassQuads(near(wallOnly({ id: 5 }), old)).length === 9);
});
