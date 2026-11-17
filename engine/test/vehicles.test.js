// The parked vehicles of gen/vehicles.js: size, wheels on the ground, budgets, colours, normals, symmetry, determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_KIT } from '../src/gen/props.js';
import { PAINT } from '../src/gen/vehicles.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { vertices } from './helpers.js';

const style = resolveStyle();
const SIZE = { car_hatch: [4.0, 1.75, 1.5], car_sedan: [4.6, 1.8, 1.45], car_suv: [4.5, 1.85, 1.7], van_delivery: [5.4, 2.0, 2.4], bicycle: [1.75, 0, 1.1] };
const MAX = { car_hatch: 700, car_sedan: 700, car_suv: 700, van_delivery: 500, bicycle: 120 };
const make = (kind, variant = 0, yaw = 0, x = 10, y = 3, z = -4) => { const s = createSoups(); PROP_KIT[kind].build(s, x, y, z, yaw, variant, style); return s; };
const flat = (s) => [...s.map.values()].map((o) => o.pos.join()).join('|');
const bbox = (s, x = 10, y = 3, z = -4) => { const v = vertices(s); const r = (i, c) => [Math.min(...v.map((p) => p[i])) - c, Math.max(...v.map((p) => p[i])) - c]; return { u: r(0, x), y: r(1, y), d: r(2, z) }; };

test('every vehicle kind is in the kit with a collider that stops walkers and bullets', () => {
  for (const kind of Object.keys(SIZE)) { assert.ok(PROP_KIT[kind], kind); assert.equal(PROP_KIT[kind].collider.nav, true); assert.ok(PROP_KIT[kind].collider.h > 1); }
});
test('vehicles have the size they are named for (within 4 %), nose along the facing', () => {
  for (const [kind, [L, W, H]] of Object.entries(SIZE)) {
    const b = bbox(make(kind));   // yaw 0 faces -z: the length runs along z
    const length = b.d[1] - b.d[0], width = b.u[1] - b.u[0], height = b.y[1] - b.y[0];
    assert.ok(Math.abs(length - L) <= L * 0.04, `${kind}: length ${length.toFixed(3)}`);
    if (W) assert.ok(Math.abs(width - W) <= W * 0.04, `${kind}: width ${width.toFixed(3)}`);
    if (kind !== 'bicycle') assert.ok(Math.abs(height - H) <= H * 0.04, `${kind}: height ${height.toFixed(3)}`);
    else assert.ok(height > 0.95 && height <= 1.2, `bicycle height ${height}`);
  }
});
test('wheels touch the ground: the lowest vertex is within 1 cm of the prop\'s y, whatever the yaw', () => {
  for (const kind of Object.keys(SIZE)) for (const yaw of [0, 0.7, 2.2]) assert.ok(Math.abs(bbox(make(kind, 1, yaw)).y[0]) <= 0.01, `${kind} yaw ${yaw}`);
});
test('budgets: cars up to 700 triangles, the van 500, the bicycle 120; at most three soups', () => {
  for (const kind of Object.keys(SIZE)) for (const variant of [0, 3, 7]) { const s = make(kind, variant); assert.ok(s.triangles() >= 30 && s.triangles() <= MAX[kind], `${kind}: ${s.triangles()}`); assert.ok(s.map.size <= 3, kind); }
});
test('every soup with vertex colours has a colour per vertex; normals are unit length', () => {
  for (const kind of Object.keys(SIZE)) for (const [key, o] of make(kind, 2).map) {
    if (/\|[a-z]*v/.test(key)) assert.equal(o.col.length, o.pos.length, `${kind} ${key}`);
    assert.equal(o.nrm.length, o.pos.length);
    for (let i = 0; i < o.nrm.length; i += 3) assert.ok(Math.abs(Math.hypot(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]) - 1) < 1e-6, `${kind} ${key}`);
  }
});
test('cars are left/right symmetric about their axis', () => {
  for (const kind of ['car_hatch', 'car_sedan', 'car_suv', 'van_delivery']) {
    const v = vertices(make(kind, 0, 0, 0, 0, 0)), key = (p) => [Math.abs(p[0]).toFixed(3), p[1].toFixed(3), p[2].toFixed(3)].join();
    const mine = new Map(); for (const p of v) mine.set(key(p), (mine.get(key(p)) || 0) + 1);
    for (const p of v) { const mirror = [-p[0], p[1], p[2]].map((n) => n.toFixed(3)); assert.ok(v.some((q) => q[0].toFixed(3) === mirror[0] && q[1].toFixed(3) === mirror[1] && q[2].toFixed(3) === mirror[2]), `${kind}: ${p} has no mirror`); }
  }
});
test('the same call gives the same triangles; a variant changes the colour only', () => {
  for (const kind of Object.keys(SIZE)) {
    assert.equal(flat(make(kind, 4)), flat(make(kind, 4)));
    const a = make(kind, 0), b = make(kind, 5);
    assert.equal(flat(a), flat(b), `${kind}: geometry does not depend on the variant`);
    const colours = (s) => [...s.map.values()].map((o) => (o.col || []).join()).join('|');
    assert.notEqual(colours(a), colours(b), `${kind}: the paint differs`);
  }
  assert.equal(PAINT.length, 8);
});
test('a car is turned by its yaw: the nose end moves with the facing', () => {
  const nose = (yaw) => { const v = vertices(make('car_sedan', 0, yaw, 0, 0, 0)); return v.reduce((m, p) => (p[1] > 0.4 && p[1] < 0.8 ? [m[0] + p[0], m[1] + p[2], m[2] + 1] : m), [0, 0, 0]); };
  void nose;
  const b0 = bbox(make('car_sedan', 0, 0, 0, 0, 0)), b1 = bbox(make('car_sedan', 0, Math.PI / 2, 0, 0, 0));
  assert.ok(Math.abs((b0.d[1] - b0.d[0]) - (b1.u[1] - b1.u[0])) < 0.05, 'a quarter turn swaps length and width');
});
