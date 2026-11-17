// The coastal cargo ship (gen/ship.js): size, draught, budget, normals, colour, symmetry, determinism, the collider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_KIT } from '../src/gen/props.js';
import { buildShip, hullBreadth, sheer } from '../src/gen/ship.js';
import { propSolid } from '../src/gen/mesher.js';
import { createSoups } from '../src/gen/soup.js';
import { SOUP } from '../src/gen/style.js';
import { vertices } from './helpers.js';

const make = (variant = 0, opts = {}, yaw = 0) => { const s = createSoups(); buildShip(s, 0, 0, 0, yaw, variant, opts); return s; };
const range = (v, i) => [Math.min(...v.map((p) => p[i])), Math.max(...v.map((p) => p[i]))];

test('the hull and its fittings are 95 x 15 m, 1.2 m under the water, 22 to 30 m to the mast head', () => {
  const v = vertices(make(0, { moorings: false })), [x0, x1] = range(v, 0), [y0, y1] = range(v, 1), [z0, z1] = range(v, 2);
  // the stern ramp of the free-fall boat overhangs the transom a little: inside the +-3 %
  assert.ok(Math.abs(z1 - z0 - 95) <= 95 * 0.03, `length ${z1 - z0}`); assert.ok(Math.abs(x1 - x0 - 15) <= 15 * 0.03, `beam ${x1 - x0}`);
  assert.ok(Math.abs(y0 + 1.2) < 1e-6, `lowest ${y0}`); assert.ok(y1 > 22 && y1 < 30, `highest ${y1}`);
});
test('triangle budget (9 000) and draw calls (3 soups, at most 4)', () => {
  const s = make(); assert.ok(s.triangles() > 2000 && s.triangles() <= 9000, `${s.triangles()} triangles`); assert.ok(s.map.size <= 4 && s.map.size === 3, `${s.map.size} soups`);
  assert.deepEqual([...s.map.keys()].sort(), [SOUP.awning, SOUP.hull, SOUP.iron].sort());
});
test('every soup with vertex colours has a colour per vertex; every normal is unit length and agrees with the winding', () => {
  for (const [key, s] of make().map) {
    assert.equal(s.nrm.length, s.pos.length, key); assert.ok(s.col && s.col.length === s.pos.length, `${key}: a colour per vertex`);
    for (let i = 0; i < s.nrm.length; i += 3) assert.ok(Math.abs(Math.hypot(s.nrm[i], s.nrm[i + 1], s.nrm[i + 2]) - 1) < 1e-6, `${key}: normal ${i / 3}`);
    if (key === SOUP.awning) continue; // double-sided cloth: either side is a front
    for (let t = 0; t < s.pos.length; t += 9) {
      const P = s.pos, a = [P[t], P[t + 1], P[t + 2]], b = [P[t + 3], P[t + 4], P[t + 5]], c = [P[t + 6], P[t + 7], P[t + 8]];
      const g = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const n = [s.nrm[t] + s.nrm[t + 3] + s.nrm[t + 6], s.nrm[t + 1] + s.nrm[t + 4] + s.nrm[t + 7], s.nrm[t + 2] + s.nrm[t + 5] + s.nrm[t + 8]];
      assert.ok(g[0] * n[0] + g[1] * n[1] + g[2] * n[2] > 0, `${key}: triangle ${t / 9} faces away from its normal`);
    }
  }
});
test('the shell faces outward: every side-plating triangle looks away from the centre line', () => {
  const s = make(0, { only: 'hull' }).map.get(SOUP.hull);
  let sides = 0;
  for (let t = 0; t < s.pos.length; t += 9) {
    const cx = (s.pos[t] + s.pos[t + 3] + s.pos[t + 6]) / 3, cy = (s.pos[t + 1] + s.pos[t + 4] + s.pos[t + 7]) / 3, nx = s.nrm[t] + s.nrm[t + 3] + s.nrm[t + 6];
    if (cy < -1.19 || cy > 4.1 || Math.abs(cx) < 0.5) continue;          // not the bottom, the deck edge or the stem line
    sides++; assert.ok(nx * cx > -0.3, `triangle ${t / 9} at x ${cx.toFixed(2)} looks inward (nx ${nx.toFixed(2)})`);
  }
  assert.ok(sides > 300, `${sides} side triangles`);
});
test('the three variants differ in colour only', () => {
  const a = make(0), b = make(1), c = make(2);
  for (const [k, s] of a.map) for (const o of [b, c]) { const t = o.map.get(k); assert.deepEqual(t.pos, s.pos, `${k}: same shape`); assert.deepEqual(t.nrm, s.nrm); assert.equal(t.col.length, s.col.length); }
  const hull = (s) => s.map.get(SOUP.hull).col, same = (x, y) => x.every((v, i) => v === y[i]);
  assert.ok(!same(hull(a), hull(b)) && !same(hull(a), hull(c)) && !same(hull(b), hull(c)), 'the hull colour changes');
  assert.ok(same(a.map.get(SOUP.iron).col, b.map.get(SOUP.iron).col) && same(a.map.get(SOUP.awning).col, c.map.get(SOUP.awning).col), 'the fittings keep theirs');
});
test('port and starboard are mirror images: station offsets and the hull as built', () => {
  for (const d of [-47, -40, -20, 0, 14, 30, 44]) for (const y of [-1, 0, 2, 4]) assert.ok(hullBreadth(d, y) >= 0 && hullBreadth(d, y) <= 7.5 + 1e-9);
  assert.ok(Math.abs(hullBreadth(0, 2) - 7.5) < 1e-9 && hullBreadth(47.4, 3) < 0.5, 'full beam amidships, nothing at the stem');
  const v = vertices(make(0, { only: 'hull' })), key = (p) => p.map((n) => (Math.round(n * 1000) / 1000 + 0).toFixed(3)).join();
  const star = new Set(v.filter((p) => p[0] > 1e-6).map((p) => key([p[0], p[1], p[2]]))), port = new Set(v.filter((p) => p[0] < -1e-6).map((p) => key([-p[0], p[1], p[2]])));
  assert.ok(star.size > 400); assert.deepEqual([...star].sort(), [...port].sort());
});
test('the hull has at least 13 stations, a raked stem with a bulb, sheer 4.2 amidships, 6.5 at the bow, 5 at the stern', () => {
  const ys = vertices(make(0, { only: 'hull' })), ds = [...new Set(ys.map((p) => Math.round(-p[2] * 2) / 2))]; assert.ok(ds.length >= 13);
  assert.equal(sheer(0).toFixed(2), '4.20'); assert.equal(sheer(47.5).toFixed(2), '6.50'); assert.equal(sheer(-47.5).toFixed(2), '5.00');
  const reach = (lo, hi) => Math.max(...ys.filter((p) => p[1] >= lo && p[1] <= hi).map((p) => -p[2]));
  assert.ok(reach(5.5, 7) > reach(0, 0.1) + 2, 'the stem is raked forward'); assert.ok(reach(-0.8, -0.4) > reach(0, 0.1) + 1, 'a bulb under the water');
});
test('deterministic, and turns with yaw', () => {
  const a = make(0), b = make(0); for (const [k, s] of a.map) { assert.deepEqual(s.pos, b.map.get(k).pos); assert.deepEqual(s.col, b.map.get(k).col); }
  const q = vertices(make(0, {}, -Math.PI / 2)), p = vertices(a);   // facing east: (x, z) -> (-z, x), vertex by vertex
  assert.equal(q.length, p.length); p.forEach(([x, y, z], k) => assert.ok(Math.hypot(q[k][0] + z, q[k][1] - y, q[k][2] - x) < 1e-6, 'yaw turns the same ship'));
});
test('mooring lines: four, out 3 m past the port side and down to 0.3 m (or the quay height of a variant >= 3)', () => {
  const lines = (variant) => { const only = vertices({ map: new Map([[SOUP.awning, make(variant).map.get(SOUP.awning)]]) }); return only.filter((p) => p[0] < -10.4); };
  for (const [variant, end] of [[0, 0.3], [12, 4]]) { const out = lines(variant), ends = out.filter((p) => Math.abs(p[0] + 10.5) < 0.2); assert.ok(ends.length >= 8, `lines reach x -10.5 (${ends.length})`); assert.ok(Math.abs(Math.min(...ends.map((p) => p[1])) - (end - 0.045)) < 0.1, `end height ${Math.min(...ends.map((p) => p[1]))}`); }
  const rope = vertices({ map: new Map([[SOUP.awning, make(0).map.get(SOUP.awning)]]) }).filter((p) => p[0] < -8 && p[2] > 30 && p[1] < 4);
  assert.ok(rope.length > 0, 'a line dips below the deck');
  const v = vertices(make(0)), [x0] = range(v, 0); assert.ok(Math.abs(x0 + 10.5) < 0.2, 'nothing but the lines reaches past 10.5 m to port');
});
test('the kit entry: collider is the hull as one box (not walkable), solid turns with yaw, y is the water level', () => {
  const kit = PROP_KIT.ship_cargo; assert.deepEqual(kit.collider, { hw: 7.5, hd: 47.5, h: 4.5, nav: true });
  const r = propSolid({ kind: 'ship_cargo', x: 0, z: 0, yaw: 0 }).ring; assert.deepEqual([Math.max(r[0], r[2], r[4], r[6]), Math.max(r[1], r[3], r[5], r[7])], [7.5, 47.5]);
  const s = createSoups(); kit.build(s, 10, 3.5, -20, 0, 0, null); const v = vertices(s); assert.ok(Math.abs(range(v, 1)[0] - 2.3) < 1e-6, 'drawn from 1.2 m below the given y');
});
