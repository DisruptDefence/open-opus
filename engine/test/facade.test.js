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

// ---- the walls themselves ---------------------------------------------------------------------------------------------
const fixedBays = { ...style, window: { ...style.window, bay: [2.5, 2.5], shutters: 0 } };
const area = (s, keep = () => true) => { let a = 0; for (let i = 0; i < s.pos.length; i += 9) { if (!keep(s.pos.slice(i, i + 9))) continue; const [ux, uy, uz, vx, vy, vz] = [s.pos[i + 3] - s.pos[i], s.pos[i + 4] - s.pos[i + 1], s.pos[i + 5] - s.pos[i + 2], s.pos[i + 6] - s.pos[i], s.pos[i + 7] - s.pos[i + 1], s.pos[i + 8] - s.pos[i + 2]]; a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return a; };
const inPlane = (p) => [2, 5, 8].every((k) => Math.abs(p[k]) < 1e-6); // the wall z = 0 of RING (edge 0)
const wallOnly = (extra = {}) => building(RING, { blind: new Set([1, 2, 3]), ...extra });
const near = (b, st = fixedBays) => { const soups = createSoups(); facadeNear(soups, b, flat, st, info); return soups; };
const quads = (soups, key) => (soups.map.get(key) ? soups.map.get(key).pos.length / 18 : 0);

test('a 10 m wall of 3 storeys: 9 window quads, and the wall plus the windows fill 10 x 9 m', () => {
  const soups = near(wallOnly()), glass = soups.map.get('window|vn');
  assert.equal(quads(soups, 'window|vn'), 9);
  const wall = area(soups.map.get('stone|tv'), inPlane), win = area(glass);
  assert.ok(Math.abs(wall + win - 90) < 0.9, `wall ${wall} + windows ${win}`);
  const d = vertices(soups).filter(([, , z]) => z < 1).map(([, , z]) => -z); // outward distance from the wall z = 0 (the other walls are blind)
  assert.ok(Math.max(...d) <= style.cornice.depth + 0.15 && Math.min(...d) >= -(style.window.reveal + 0.01) - 1e-9, `reveal and cornice stay within their depths: ${Math.min(...d)} .. ${Math.max(...d)}`);
});
test('the front edge: a door on the ground storey, or shop panes with fascia and a door', () => {
  const plain = near(wallOnly({ front: new Set([0]) })); assert.equal(quads(plain, 'window|vn'), 8); assert.equal(quads(plain, 'door|vn'), 1);
  const shop = near(wallOnly({ front: new Set([0]), groundFloor: 1 })); assert.equal(quads(shop, 'window|vn'), 6 + 2, '6 casements above, 2 shop panes and a door below'); assert.equal(quads(shop, 'door|vn'), 1);
  assert.ok(shop.map.get('stucco|tvn'), 'the fascia is in the trim soup');
  const big = near(wallOnly({ front: new Set([0]), groundFloor: 2 })); assert.equal(quads(big, 'door|vn'), 1);
  const rear = near(wallOnly({ groundFloor: 1 })); assert.equal(quads(rear, 'door|vn'), 0, 'a wall that faces no street has no door');
});
test('a blind edge and a 2 m edge are one quad of wall, with no window', () => {
  const all = building(RING, { blind: new Set([0, 1, 2, 3]) }), soups = near(all); assert.equal(quads(soups, 'window|vn'), 0);
  assert.equal(soups.map.get('stone|tv').pos.length / 9, 8, 'two triangles an edge');
  const thin = near(building([0, 0, 2, 0, 2, 8, 0, 8], { blind: new Set([1, 2, 3]) })); assert.equal(quads(thin, 'window|vn'), 0);
  assert.equal(area(thin.map.get('stone|tv'), inPlane) > 0 && thin.map.get('stone|tv').pos.length / 9 >= 8, true);
  let n = 0; const s = thin.map.get('stone|tv'); for (let i = 0; i < s.pos.length; i += 9) if (inPlane(s.pos.slice(i, i + 9))) n++; assert.equal(n, 2);
});
test('far and near agree: the painted windows lie where the modelled ones are cut', () => {
  const far = createSoups(); facadeFar(far, wallOnly(), flat, fixedBays, info);
  const s = far.map.get('facade_stone|v'); let found = null;
  for (let i = 0; i < s.uv.length; i += 12) { const us = [s.uv[i], s.uv[i + 2], s.uv[i + 4]]; if (Math.max(...us) === 3 && Math.min(...us) === 0) { const q = (i / 12) * 18; found = { v: Math.max(s.uv[i + 1], s.uv[i + 3], s.uv[i + 5]), x: [s.pos[q], s.pos[q + 3], s.pos[q + 6]] }; break; } }
  assert.ok(found, 'one far quad spans the bays, u = 0 .. n'); assert.equal(found.v, 3, 'v counts storeys');
  assert.ok(Math.abs(Math.min(...found.x) - 1.25) < 1e-9 && Math.abs(Math.max(...found.x) - 8.75) < 1e-9, 'it covers the bays 1.25 .. 8.75 m, so window i lies at 1.25 + 2.5 (i + 0.5)');
  // and a modelled window of that bay is centred there
  const g = near(wallOnly()).map.get('window|vn'); const xs = []; for (let i = 0; i < g.pos.length; i += 18) xs.push((g.pos[i] + g.pos[i + 3] + g.pos[i + 6]) / 3);
  for (const c of [2.5, 5, 7.5]) assert.ok(xs.some((x) => Math.abs(x - c) < 0.6 && Math.abs(x - c) < 0.2), `a window near ${c}`);
});
test('two buildings differ in tint or bay width, the same one never', () => {
  let differ = 0; for (let k = 1; k <= 5; k++) if (bays(20, style, k).width !== bays(20, style, k + 100).width) differ++;
  assert.ok(differ >= 1);
  const a = near(building(RING, { id: 11 })), b = near(building(RING, { id: 11 })); assert.deepEqual(a.map.get('window|vn').pos, b.map.get('window|vn').pos);
});
test('dormers and chimneys are drawn once, with piece 0', () => {
  const roofInfo = { slots: [{ ox: 10, oz: 0, ex: -1, ez: 0, len: 10, y: 39, slope: 1, edge: 0 }], ridge: [{ x: 1, z: 4, y: 41 }, { x: 9, z: 4, y: 41 }], parapet: 0 };
  const on = (piece) => { const soups = createSoups(); facadeNear(soups, building(RING, { piece, roofShape: 3, blind: new Set([0, 1, 2, 3]) }), flat, { ...style, chimneys: { ...style.chimneys, perBuilding: [2, 2] } }, roofInfo); return soups; };
  const p0 = on(0), p1 = on(1);
  assert.ok(quads(p0, 'window|vn') >= 2, 'a dormer window'); assert.equal(quads(p1, 'window|vn'), 0, 'a second piece draws none');
  assert.ok(p0.map.get('brick|tv') || p0.map.get('stone|tv'), 'chimney stacks'); assert.ok(p0.triangles() > p1.triangles());
});
