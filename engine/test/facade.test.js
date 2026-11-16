// Façades (src/gen/facade.js; docs/plans/SCENE-DETAIL.md item 5). The tests here hold for any façade generator that
// keeps the contract in the file's header: they pass on the placeholder and must keep passing when item 5 fills it in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bays, facadeFar, facadeNear } from '../src/gen/facade.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { vertices, building } from './helpers.js';

const style = resolveStyle(), flat = () => 30, info = { slots: [], ridge: [], parapet: 0 };
const RING = [0, 0, 10, 0, 10, 8, 0, 8], rev = (r) => { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };

test('the bay rule: whole bays, centred, none on a wall too short for one', () => {
  const fixed = { window: { bay: [2.5, 2.5] } };
  assert.deepEqual(bays(10, fixed, 1), { n: 3, width: 2.5, margin: 0.45, start: 1.25 });
  assert.equal(bays(2.9, fixed, 1).n, 0); assert.equal(bays(3.4, fixed, 1).n, 1);
  const a = bays(20, style, 42), b = bays(7, style, 42); assert.equal(a.width, b.width, 'one bay width per building (the seed)');
  assert.ok(a.width >= style.window.bay[0] && a.width <= style.window.bay[1]);
});
test('far and near each draw the whole wall of a closed ring: the wall plane looks outwards, between the ground and the eave', () => {
  const planes = [[0, 1, 0, 0], [0, 1, 0, 8].slice(0, 0), [1, 0, 0, 0]]; void planes;
  const onWall = (x, z) => Math.abs(x) < 1e-6 || Math.abs(x - 10) < 1e-6 || Math.abs(z) < 1e-6 || Math.abs(z - 8) < 1e-6;
  for (const ring of [RING, rev(RING)]) for (const fn of [facadeFar, facadeNear]) {
    const b = building(ring), soups = createSoups(); fn(soups, b, flat, style, info);
    assert.ok(soups.triangles() >= 8, 'at least one quad per edge'); let plane = 0;
    for (const s of soups.map.values()) for (let i = 0; i < s.pos.length; i += 9) {
      const cx = (s.pos[i] + s.pos[i + 3] + s.pos[i + 6]) / 3, cz = (s.pos[i + 2] + s.pos[i + 5] + s.pos[i + 8]) / 3;
      const flatWall = [0, 3, 6].every((k) => Math.abs(s.pos[i + k] - s.pos[i]) < 1e-6) || [0, 3, 6].every((k) => Math.abs(s.pos[i + k + 2] - s.pos[i + 2]) < 1e-6);
      if (Math.abs(s.nrm[i + 1]) < 0.5 && flatWall && onWall(cx, cz)) { plane++; assert.ok((cx - 5) * s.nrm[i] + (cz - 4) * s.nrm[i + 2] > 0, 'a face in the wall plane looks outwards'); }
    }
    assert.ok(plane >= 8, 'there are wall faces in the planes');
    for (const [, y] of vertices(soups)) assert.ok(y >= 30 - 0.5 - 1e-6 && y <= 30 + 9 + 1.6, `y ${y}`);
  }
});
test('a piece that starts above the ground is walled from there; the parapet of a flat roof raises the wall; ground that falls away gets a plinth', () => {
  const high = createSoups(); facadeFar(high, building(RING, { yMin: 34 }), flat, style, info);
  assert.equal(Math.min(...vertices(high).map((v) => v[1])), 34);
  const raised = createSoups(); facadeFar(raised, building(RING), flat, style, { ...info, parapet: 0.45 });
  assert.ok(Math.abs(Math.max(...vertices(raised).map((v) => v[1])) - 39.45) < 1e-9);
  const slope = createSoups(); facadeFar(slope, building(RING), (x) => 30 - x * 0.2, style, info);
  assert.ok(Math.min(...vertices(slope).map((v) => v[1])) <= 28 + 1e-9, 'the wall reaches down to the lowest ground');
});
test('the same building gives the same triangles', () => {
  const a = createSoups(), b = createSoups(); facadeNear(a, building(RING), flat, style, info); facadeNear(b, building(RING), flat, style, info);
  assert.deepEqual([...a.map.keys()], [...b.map.keys()]); for (const [k, s] of a.map) assert.deepEqual(s.pos, b.map.get(k).pos);
});
for (const t of ['a 10 m wall of 3 storeys: 9 window quads; wall area plus window area is 10 x 9', 'a front edge: one door (gf 0); shop panes, fascia and a door (gf 1)', 'a blind edge and a 2 m edge: exactly 2 triangles',
  'far uv is (bays, levels) and each painted window lies within 0.15 m of the modelled one', 'two ids differ in tint or bay width', 'dormers on roofInfo.slots and chimneys on roofInfo.ridge, for piece 0 only',
  'the densest cell of the scene: under 180 000 near triangles, built in under 30 ms']) test.todo('item 5: ' + t);
