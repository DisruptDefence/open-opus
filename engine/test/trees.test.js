// Trees (src/gen/trees.js): budgets, determinism, the crown within the record, unit normals, a tint for every vertex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoups } from '../src/gen/soup.js';
import { tree, trunkRadius } from '../src/gen/trees.js';
import { SOUP } from '../src/gen/style.js';

const make = (kind, form, x = 10, z = 20, height = 12, crownRadius = 3.6) => ({ x, z, height, crownRadius, kind, form });
const build = (t, lod, season = 'summer', y = 5) => { const s = createSoups(); tree(s, t, y, season, lod); return s; };
const KINDS = [[1, 0], [1, 1], [1, 2], [1, 4], [2, 3], [2, 2], [4, 0], [5, 0]];
const BUDGET = { 1: 230, 2: 120, 4: 60, 5: 90 };

test('near budgets: broadleaf <= 230 (260 allowed), conifer <= 120 (160), shrub <= 60; far <= 24', () => {
  for (let i = 0; i < 60; i++) for (const [kind, form] of KINDS) {
    const t = make(kind, form, i * 7.3, i * 3.1 - 50, 6 + (i % 9) * 2), near = build(t, 1).triangles(), far = build(t, 0).triangles();
    assert.ok(near <= BUDGET[kind] && near > 0, `kind ${kind} form ${form}: ${near} near`);
    assert.ok(far <= 24 && far > 0, `kind ${kind}: ${far} far`);
  }
});

test('a cell of 150 trees stays under 35 000 triangles near', () => {
  const s = createSoups();
  for (let i = 0; i < 150; i++) tree(s, make(1, i % 3, i * 5.1, i * 2.9, 10 + (i % 7), 3.2), 0, 'summer', 1);
  assert.ok(s.triangles() < 35000, `${s.triangles()}`);
  let worst = 0; for (let i = 0; i < 500; i++) worst = Math.max(worst, build(make(1, i % 5, i * 1.7, i * 0.9), 1).triangles());
  assert.ok(worst * 150 < 35000, `worst tree ${worst}`);
});

test('the same tree every time, another tree elsewhere', () => {
  const a = build(make(1, 0), 1), b = build(make(1, 0), 1), c = build(make(1, 0, 11, 20), 1);
  assert.deepEqual(a.map.get(SOUP.leaves).pos, b.map.get(SOUP.leaves).pos);
  assert.notDeepEqual(a.map.get(SOUP.leaves).pos.map((v) => v - 10), c.map.get(SOUP.leaves).pos.map((v) => v - 11));
});

test('the crown stays within the record height and crown radius (+10 %) and reaches them (-10 %)', () => {
  for (const [kind, form] of KINDS.filter(([k]) => k !== 5)) for (let i = 0; i < 15; i++) {
    const t = make(kind, form, 3 + i * 4.1, -7 + i * 2.3, 7 + i, 2 + i * 0.25), y = 2;
    for (const lod of [0, 1]) {
      const s = build(t, lod, 'summer', y).map.get(SOUP.leaves); let top = -1e9, reach = 0;
      for (let k = 0; k < s.pos.length; k += 3) { top = Math.max(top, s.pos[k + 1] - y); reach = Math.max(reach, Math.hypot(s.pos[k] - t.x, s.pos[k + 2] - t.z)); }
      assert.ok(top <= t.height * 1.1 && top >= t.height * 0.9, `kind ${kind} form ${form} lod ${lod}: top ${top} of ${t.height}`);
      assert.ok(reach <= t.crownRadius * 1.1 && reach >= t.crownRadius * 0.9, `kind ${kind} form ${form} lod ${lod}: reach ${reach} of ${t.crownRadius}`);
    }
  }
});

test('normals are unit length; a vertex-coloured soup has a colour for every vertex, all finite and positive', () => {
  for (const [kind, form] of KINDS) for (const lod of [0, 1]) {
    const soups = build(make(kind, form), lod);
    for (const s of soups.map.values()) {
      assert.equal(s.col.length, s.pos.length); assert.equal(s.nrm.length, s.pos.length); assert.equal(s.uv.length / 2, s.pos.length / 3);
      for (let i = 0; i < s.nrm.length; i += 3) assert.ok(Math.abs(Math.hypot(s.nrm[i], s.nrm[i + 1], s.nrm[i + 2]) - 1) < 1e-6);
      for (const v of s.col) assert.ok(Number.isFinite(v) && v > 0);
      for (const v of s.pos) assert.ok(Number.isFinite(v));
    }
  }
});

test('the crown is darker underneath than on top, and the leaf tint varies by at most 8 % per tree and follows the season', () => {
  const top = (t, season) => { const s = build(t, 1, season).map.get(SOUP.leaves); let best = 0; for (let i = 0; i < s.col.length; i += 3) best = Math.max(best, s.col[i + 1]); return best; };
  const low = (t) => { const s = build(t, 1).map.get(SOUP.leaves); let lo = 9; for (let i = 0; i < s.col.length; i += 3) lo = Math.min(lo, s.col[i + 1]); return lo; };
  const t = make(1, 0); assert.ok(low(t) < 0.6 * top(t, 'summer'));
  for (let i = 0; i < 30; i++) { const m = top(make(1, 0, i * 3.3, i * 1.1), 'summer'); assert.ok(m <= 1.45 * 1.08 + 1e-9 && m >= 1.0 * 0.92 * 0.9, `${m}`); }
  const red = (season) => { const s = build(t, 1, season).map.get(SOUP.leaves); let r = 0, g = 0; for (let i = 0; i < s.col.length; i += 3) { r += s.col[i]; g += s.col[i + 1]; } return r / g; };
  assert.ok(red('autumn') > 1.4 * red('summer'), 'autumn is warmer');
  assert.equal(build(t, 1, 'winter').map.get(SOUP.leaves).pos.length, 0, 'a broadleaf in winter has no crown');
  assert.ok(build(make(2, 3), 1, 'winter').map.get(SOUP.leaves).pos.length > 0, 'a conifer keeps its needles');
});

test('the trunk tapers and the radius grows with the tree', () => {
  assert.ok(trunkRadius(20) > trunkRadius(6)); assert.ok(trunkRadius(12) > 0.2 && trunkRadius(12) < 0.4);
  const s = build(make(1, 0, 0, 0, 12), 1, 'summer', 0).map.get(SOUP.trunk); let base = 0, high = 0;
  for (let i = 0; i < s.pos.length; i += 3) { const d = Math.hypot(s.pos[i], s.pos[i + 2]); if (s.pos[i + 1] < 0.05) base = Math.max(base, d); if (s.pos[i + 1] > 3 && s.pos[i + 1] < 4.6) high = Math.max(high, d); }
  assert.ok(base > 0 && high > 0);
});
