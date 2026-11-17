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

// ---- frames, sills, lintels ---------------------------------------------------------------------------------------------
const tris = (soup, keep) => { const out = []; if (!soup) return out; for (let i = 0; i < soup.pos.length; i += 9) { const p = [0, 3, 6].map((k) => [soup.pos[i + k], soup.pos[i + k + 1], soup.pos[i + k + 2]]); if (keep(p)) out.push(p); } return out; };
/** The windows of the wall z = 0 of RING: { u0, u1, ys, yh, glass } (glass = outward distance of the pane, negative = inside the wall). */
const windowsOf = (soups) => { const out = [], g = soups.map.get(SOUP.window); for (let i = 0; i < g.pos.length; i += 18) { const xs = [0, 3, 6, 9, 12, 15].map((k) => g.pos[i + k]), ys = [1, 4, 7, 10, 13, 16].map((k) => g.pos[i + k]); out.push({ u0: Math.min(...xs), u1: Math.max(...xs), ys: Math.min(...ys), yh: Math.max(...ys), glass: -g.pos[i + 2] }); } return out; };
const inBox = (w, m, y0, y1) => (p) => p.every(([x, y]) => x >= w.u0 - m - 1e-6 && x <= w.u1 + m + 1e-6 && y >= y0 - 1e-6 && y <= y1 + 1e-6);

for (const [name, facade] of [['stone', 1], ['rendered', 4]]) for (const glaze of ['casement', 'sash66']) {
  test(`a ${glaze} window in a ${name} wall: a frame stands 0.05 to 0.08 in front of the glass, nothing but sill and head stands out of the wall, at most 40 triangles are added`, () => {
    const mix = { ground: { [glaze]: 1 }, upper: { [glaze]: 1 }, top: { [glaze]: 1 } }, st = { ...fixed, window: { ...fixed.window, mix } };
    const soups = near(wallOnly({ id: 7, facade }), st), trim = soups.map.get(SOUP.trim), wins = windowsOf(soups);
    assert.equal(wins.length, 9);
    for (const w of wins) {
      // the frame: trim between the sill and the head, in front of the glass
      const inside = tris(trim, (p) => inBox(w, 0.02, w.ys + 0.02, w.yh - 0.02)(p) && p.every((v) => v[2] > 0));
      const reach = Math.max(...inside.flat().map((v) => -v[2])); assert.ok(inside.length >= 8, 'a frame');
      assert.ok(reach - w.glass >= 0.05 - 1e-6 && reach - w.glass <= 0.08 + 1e-6, `${glaze}: the frame stands ${(reach - w.glass).toFixed(3)} in front of the glass`);
      // in front of the wall plane (outward distance > 0) only the sill (to 0.07) and the head (stone: the lintel; rendered: the surround 0.03)
      const out = tris(trim, (p) => inBox(w, 0.13, w.ys - 0.07, w.yh + 0.25)(p) && p.some((v) => -v[2] > 1e-6));
      for (const p of out) { const d = Math.max(...p.map((v) => -v[2])), y = p.map((v) => v[1]); const sill = Math.max(...y) <= w.ys + 1e-6, head = Math.min(...y) >= w.yh - 1e-6 || (facade === 4 && d <= 0.03 + 1e-6);
        assert.ok(sill ? d <= 0.07 + 1e-6 : head || d <= 0.03 + 1e-6, `something stands out ${d} at y ${y}`); assert.ok(d <= 0.1 + 1e-6, 'the head projects at most headDepth'); }
      // the stone sill is 0.05 wider each side and the head reaches 0.12 (stone) past the opening
      const wide = (y0, y1) => { const t = tris(trim, (p) => p.every((v) => v[1] >= y0 - 1e-6 && v[1] <= y1 + 1e-6 && Math.abs(v[0] - (w.u0 + w.u1) / 2) < 1)); return Math.max(...t.flat().map((v) => v[0])) - w.u1; };
      assert.ok(Math.abs(wide(w.ys - 0.06, w.ys) - 0.05) < 1e-6, 'the sill is 0.05 wider each side');
      if (facade === 1 && glaze !== 'arched') assert.ok(Math.abs(wide(w.yh, w.yh + 0.24) - 0.12) < 1e-6, 'the lintel reaches 0.12 past the opening');
    }
    const n = tris(trim, () => true).length;
    const noFrames = near(wallOnly({ id: 7, facade }), { ...st, window: { ...st.window, mix: { ground: { blind: 1 }, upper: { blind: 1 }, top: { blind: 1 } } } });
    // a bricked-up window has sill and head but no frame and no glass: the frame is what a modelled window adds over it
    assert.ok((n - tris(noFrames.map.get(SOUP.trim), () => true).length) / 9 <= 40, `triangles of frame per window ${(n - tris(noFrames.map.get(SOUP.trim), () => true).length) / 9}`);
  });
}
test('the reveal is deeper for stone: style.window.stoneReveal multiplies it, 1 without the key', () => {
  const glassD = (st) => -windowsOf(near(wallOnly({ id: 3, facade: 1 }), st))[0].glass, d0 = glassD(fixed);
  assert.ok(Math.abs(d0 - fixed.window.reveal) < 1e-9);
  assert.ok(Math.abs(glassD({ ...fixed, window: { ...fixed.window, reveal: 0.24, stoneReveal: 1.3 } }) - 0.24 * 1.3) < 1e-9);
});
test('an arched window has its frame too: trim 0.05 to 0.08 in front of the glass, all round the arc', () => {
  const mix = { ground: { arch_round: 1 }, upper: { arch_round: 1 }, top: { arch_round: 1 } }, st = { ...fixed, window: { ...fixed.window, mix } };
  const soups = near(wallOnly({ id: 7, facade: 1 }), st), g = soups.map.get(SOUP.window);
  const glass = -Math.max(...[...g.pos].filter((_, i) => i % 3 === 2));
  const front = tris(soups.map.get(SOUP.trim), (p) => p.every((v) => Math.abs(-v[2] - (glass + 0.06)) < 1e-6) && p.every((v) => Math.abs(v[0] - 5) < 0.6));
  assert.ok(front.length >= 20, `frame triangles on the centre bays: ${front.length}`);
});
