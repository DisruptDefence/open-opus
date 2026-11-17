// The static bystander (gen/bystander.js): scenery written into a soup, five poses, no rig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_KIT } from '../src/gen/props.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { vertices } from './helpers.js';

const style = resolveStyle(), kit = PROP_KIT.person_stand;
const make = (variant, yaw = 0, x = 10, y = 3, z = -4) => { const s = createSoups(); kit.build(s, x, y, z, yaw, variant, style); return s; };
const flat = (s) => [...s.map.values()].map((o) => o.pos.join()).join('|');
const height = (v) => { const vs = vertices(make(v)); return Math.max(...vs.map((p) => p[1])) - 3; };

test('person_stand is in the kit: a thin upright collider that does not close nav cells, nothing about threats', () => {
  assert.ok(kit); assert.deepEqual(kit.collider, { r: 0.25, h: 1.8, nav: false }); assert.equal(typeof kit.build, 'function');
  assert.equal(kit.threat, undefined); assert.equal(kit.skin, undefined);
});
test('budget: at most 600 triangles and three soups, for many people', () => {
  for (let v = 0; v < 120; v++) { const s = make(v); assert.ok(s.triangles() >= 30 && s.triangles() <= 600, `variant ${v}: ${s.triangles()}`); assert.ok(s.map.size <= 3); }
});
test('feet stand on y: the lowest vertex is y, in every pose', () => {
  for (let v = 0; v < 40; v++) assert.ok(Math.abs(Math.min(...vertices(make(v)).map((p) => p[1])) - 3) <= 0.01, `variant ${v}`);
});
test('height is 1.55 to 1.90 m by seed and takes both ends of the range', () => {
  const hs = []; for (let k = 0; k < 60; k++) hs.push(height(k * 5));
  for (const h of hs) assert.ok(h >= 1.5 && h <= 1.92, `height ${h}`);
  assert.ok(Math.min(...hs) < 1.65 && Math.max(...hs) > 1.8, `spread ${Math.min(...hs)} .. ${Math.max(...hs)}`);
});
test('deterministic: the same variant gives the same triangles, another seed another person', () => {
  assert.equal(flat(make(7)), flat(make(7))); assert.notEqual(flat(make(7)), flat(make(12)));
});
test('five poses differ: variants 0..4 are one person standing five ways', () => {
  const set = new Set(); for (let v = 0; v < 5; v++) set.add(flat(make(v))); assert.equal(set.size, 5);
  const col = (v) => [...make(v).map.values()].map((o) => o.col.join()).join('|');
  assert.equal(col(0), col(1), 'same clothes in different poses');
});
test('a person stays inside its collider plus 10 cm below head height, whatever the pose and seed, and has colours and unit normals', () => {
  for (let v = 0; v < 150; v++) {
    const s = make(v, 0.4); for (const [key, o] of s.map) { assert.equal(o.col.length, o.pos.length, key); for (let i = 0; i < o.nrm.length; i += 3) assert.ok(Math.abs(Math.hypot(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]) - 1) < 1e-6); }
    for (const [x, y, z] of vertices(s)) if (y < 3 + 1.8) assert.ok(Math.hypot(x - 10, z + 4) <= 0.35 * 1.45, `variant ${v}: (${x - 10}, ${z + 4})`);
  }
});
