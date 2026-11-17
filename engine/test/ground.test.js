// The ground of a street (src/gen/ground.js; docs/plans/SCENE-DETAIL.md item 6). What holds for any ground generator
// that keeps the contract; item 6 adds the plan's tests of drape, ribbons, the lift raster, steps and crossings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drape, roadRibbons, steps, crossing, liftRaster } from '../src/gen/ground.js';
import { cellSoups } from '../src/gen/mesher.js';
import { jsonSource } from '../src/scene/source.js';
import { fixture, installAll, vertices, planArea, walk } from './helpers.js';
import { createGrid } from '../src/terrain/heightfield.js';
import { clipSoups } from '../src/gen/cells.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, SOUP, parseColor } from '../src/gen/style.js';

test('the ground generators have the signatures the mesher calls', () => {
  assert.deepEqual([drape.length, roadRibbons.length, steps.length, crossing.length, liftRaster.length], [2, 4, 4, 4, 5]);
});
test('what a cell draws of a street stays inside the cell, and where a sidewalk is raised the ground under a walker is raised with it', async () => {
  const { chunks, terrain } = await installAll(jsonSource(fixture('scene-new')));
  for (const { chunk, env } of chunks.values()) {
    const lift = liftRaster(chunk.roads, chunk.hx0, chunk.hz0, chunk.sn, env.style);
    assert.ok(lift === null || (lift instanceof Uint8Array && lift.length === chunk.sn * chunk.sn), 'null, or centimetres per 1 m cell');
    for (const cell of chunk.cells) {
      if (!cell.roads.length && !cell.crossings.length) continue;
      const only = { ...cell, buildings: [], trees: [], walls: [], props: [] };
      for (const [x, y, z] of vertices(cellSoups(only, 'near', env))) {
        assert.ok(x >= cell.x0 - 1e-6 && x <= cell.x1 + 1e-6 && z >= cell.z0 - 1e-6 && z <= cell.z1 + 1e-6, 'cut to the cell');
        assert.ok(Math.abs(y - terrain.height(x, z)) < 3.5, 'on the ground, not in the air');
      }
    }
  }
});

// ---- helpers: a tile from a height function, a soup's up-facing area, the plane of a terrain triangle ---------------------------
const STYLE = resolveStyle({});
function tileOf(f, { cell = 2.5, n = 41, minX = -50, minZ = -50, lift = null } = {}) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = f(minX + i * cell, minZ + j * cell);
  return createGrid({ nx: n, nz: n, cell, minX, minZ, data, lift, liftCell: 1, liftN: Math.round((n - 1) * cell) });
}
const road = (o) => ({ pts: [0, 0, 20, 0], kind: 'residential', cls: 4, surface: 1, width: 6, sidewalk: 'no', steps: null, lit: false, marking: 0, bridge: false, tunnel: false, name: '', s0: 0, len: 20, ...o });
const planeY = (tile, x, z) => { // the drawn height by the plane of the terrain triangle that contains (x, z), from the samples alone
  const i = Math.floor((x - tile.minX) / tile.cell), j = Math.floor((z - tile.minZ) / tile.cell), u = (x - tile.minX) / tile.cell - i, v = (z - tile.minZ) / tile.cell - j, n = tile.nx, d = tile.data;
  const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
};
const area2d = (t) => Math.abs((t[1][0] - t[0][0]) * (t[2][2] - t[0][2]) - (t[2][0] - t[0][0]) * (t[1][2] - t[0][2])) / 2;
const upTris = (s) => { const out = []; if (!s) return out; for (let i = 0; i < s.pos.length; i += 9) if (s.nrm[i + 1] > 0.9) out.push([0, 3, 6].map((k) => [s.pos[i + k], s.pos[i + k + 1], s.pos[i + k + 2]])); return out; };
const upArea = (s) => upTris(s).reduce((a, t) => a + area2d(t), 0);

test('drape: flat tile, ramp, bumpy tile: every vertex on the terrain triangle under it, plan area kept', () => {
  const tri3 = [[-7.3, 0, -4.1], [12.9, 0, 3.3], [1.7, 0, 15.2]], want = Math.abs((tri3[1][0] - tri3[0][0]) * (tri3[2][2] - tri3[0][2]) - (tri3[2][0] - tri3[0][0]) * (tri3[1][2] - tri3[0][2])) / 2;
  const sum = (ts) => ts.reduce((a, t) => a + area2d(t), 0);
  const flat = drape(tri3, tileOf(() => 4.2)); assert.ok(flat.length > 1); assert.ok(Math.abs(sum(flat) - want) < 1e-6); for (const t of flat) for (const v of t) assert.ok(Math.abs(v[1] - 4.2) < 1e-6);
  const ramp = drape(tri3, tileOf((x) => 3 + 0.2 * x)); assert.ok(Math.abs(sum(ramp) - want) < 1e-6); for (const t of ramp) for (const v of t) assert.ok(Math.abs(v[1] - (3 + 0.2 * v[0])) < 1e-6);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bumpy = tileOf(() => rnd() * 3), out = drape(tri3, bumpy); assert.ok(Math.abs(sum(out) - want) < 1e-6);
  for (const t of out) { const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3; for (const v of t) assert.ok(Math.abs(v[1] - planeY(bumpy, v[0], v[2])) < 1e-5, 'on the plane of the triangle it lies in');
    assert.ok(Math.abs((t[0][1] + t[1][1] + t[2][1]) / 3 - planeY(bumpy, cx, cz)) < 1e-5); }
  const s = createSoups(); roadRibbons(s, road({ pts: [-8, 0, 8, 0] }), bumpy, STYLE); for (const sp of s.map.values()) for (let i = 1; i < sp.nrm.length; i += 3) assert.ok(sp.nrm[i] > 0, 'ground faces up');
});
test('a 20 x 6 road with sidewalks both sides: areas 120 and 64, sidewalk top at 0.14, vertical kerbs 0.11 high', () => {
  const tile = tileOf(() => 0), s = createSoups(); roadRibbons(s, road({ sidewalk: 'both', pts: [-10, 0, 10, 0], s0: 0, len: 20 }), tile, STYLE);
  const carriage = s.map.get('asphalt|tn'), walk = s.map.get('concrete|tn'), stone = s.map.get(SOUP.kerb);
  assert.ok(Math.abs(upArea(carriage) - 120) < 1.2, `carriageway ${upArea(carriage)}`); assert.ok(Math.abs(upArea(walk) - 64) < 0.64, `sidewalks ${upArea(walk)}`);
  for (const t of upTris(walk)) for (const v of t) assert.ok(Math.abs(v[1] - 0.14) < 1e-9, 'every sidewalk top vertex at the kerb height');
  const faces = []; for (let i = 0; i < stone.pos.length; i += 9) if (Math.abs(stone.nrm[i + 1]) < 1e-6) faces.push([stone.pos[i + 1], stone.pos[i + 4], stone.pos[i + 7]]);
  assert.ok(faces.length >= 4); const ys = faces.flat(); assert.ok(Math.abs(Math.min(...ys) - 0.03) < 1e-9 && Math.abs(Math.max(...ys) - 0.15) < 1e-9, 'a kerb face runs from 0.03 to the kerb stone top (0.11 + the stone 0.01)');
  for (let i = 0; i < stone.pos.length; i += 9) if (Math.abs(stone.nrm[i + 1]) < 1e-6) { const zc = (stone.pos[i + 2] + stone.pos[i + 5] + stone.pos[i + 8]) / 3; assert.ok(stone.nrm[i + 2] * zc < 0, 'a kerb face looks at the carriageway'); }
});
test('liftRaster: 14 in the sidewalk strip, 0 on the carriageway and beyond; terrain.height on the sidewalk equals the drawn top', () => {
  const r = road({ sidewalk: 'both', pts: [-10, 0, 10, 0] }), x0 = -15, z0 = -15, n = 30, lift = liftRaster([r], x0, z0, n, STYLE), at = (x, z) => lift[(Math.floor(z - z0)) * n + Math.floor(x - x0)];
  assert.equal(at(0, 3.5), 14); assert.equal(at(0, -3.5), 14); assert.equal(at(0, 1), 0); assert.equal(at(0, 6), 0); assert.equal(at(0, -6), 0); assert.equal(liftRaster([road()], x0, z0, n, STYLE), null);
  const tile = tileOf(() => 0, { lift, minX: x0, minZ: z0, n: 13, cell: 2.5 }), s = createSoups(); roadRibbons(s, r, tile, STYLE);
  for (const t of upTris(s.map.get('concrete|tn'))) for (const v of t) if (Math.abs(v[0]) < 8 && Math.abs(Math.abs(v[2]) - 3.8) < 0.5) assert.ok(Math.abs(tile.height(v[0], v[2]) - v[1]) < 1e-9, 'the walker stands on the drawn top');
});
test('a way that is itself a sidewalk (sw "self") is raised by the kerb, with faces on its edges and ends, and lifts the walker', () => {
  const tile = tileOf(() => 0), r = road({ kind: 'footway', cls: 8, surface: 2, width: 1.6, sidewalk: 'self', pts: [-10, 0, 10, 0], len: 20 }), s = createSoups(); roadRibbons(s, r, tile, STYLE);
  const top = s.map.get('concrete|tn'); assert.ok(Math.abs(upArea(top) - 32) < 0.3); for (const t of upTris(top)) for (const v of t) assert.ok(Math.abs(v[1] - 0.14) < 1e-9);
  const faces = s.map.get(SOUP.kerb); let n = 0; for (let i = 0; i < faces.pos.length; i += 9) if (Math.abs(faces.nrm[i + 1]) < 1e-6) n++; assert.ok(n >= 8, `faces ${n}`);
  const lift = liftRaster([r], -15, -15, 30, STYLE); assert.equal(lift[15 * 30 + 15], 14); assert.equal(lift[12 * 30 + 15], 0);
});
test('a 90 degree bend leaves no gap at the joint', () => {
  const tile = tileOf(() => 0), s = createSoups(); roadRibbons(s, road({ pts: [-20, 0, 0, 0, 0, 20], len: 40 }), tile, STYLE);
  const tris = upTris(s.map.get('asphalt|tn')), inTri = (p, t) => { const s1 = (a, b) => (b[0] - a[0]) * (p[1] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]); const e = [s1(t[0], t[1]), s1(t[1], t[2]), s1(t[2], t[0])]; return e.every((v) => v >= -1e-9) || e.every((v) => v <= 1e-9); };
  let seed = 3; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); let n = 0;
  while (n < 200) { const x = -20 + rnd() * 23, z = -3 + rnd() * 23, inA = x <= 0 && Math.abs(z) <= 3 || x >= -20 && x <= 0 && Math.abs(z) <= 3, inB = Math.abs(x) <= 3 && z >= 0 && z <= 20; if (!(inA || inB)) continue; n++; assert.ok(tris.some((t) => inTri([x, z], t)), `covered at ${x.toFixed(2)}, ${z.toFixed(2)}`); }
});
test('steps over 3.4 m with 20 treads: equal risers, every tread within one riser of the ground', () => {
  const tile = tileOf((x) => 0.2833333 * x, { minX: -10, minZ: -30, n: 41, cell: 2.5 }), groundAt = (x, z) => tile.height(x, z), s = createSoups();
  steps(s, road({ pts: [0, 0, 12, 0], kind: 'steps', steps: { count: 20, handrail: 0 }, width: 3, len: 12, s0: 0 }), groundAt, STYLE);
  const levels = [...new Set(upTris(s.map.get(SOUP.tread)).map((t) => Math.round(t[0][1] * 1e6) / 1e6))].sort((a, b) => a - b);
  assert.equal(levels.length, 20); for (let i = 1; i < levels.length; i++) assert.ok(Math.abs(levels[i] - levels[i - 1] - 0.17) < 0.01, 'riser');
  for (const t of upTris(s.map.get(SOUP.tread))) { const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3; assert.ok(Math.abs(t[0][1] - groundAt(cx, cz)) <= 0.17 + 1e-6, 'a tread top is within one riser of the ground under it'); }
});
test('steps with a handrail on both sides stand posts and rails; none for handrail 0', () => {
  const tile = tileOf((x) => 0.2 * x), mk = (hr) => { const s = createSoups(); steps(s, road({ pts: [0, 0, 12, 0], kind: 'steps', steps: { count: 14, handrail: hr }, width: 3, len: 12 }), (x, z) => tile.height(x, z), STYLE); return s.map.get('metal|tv'); };
  assert.equal(mk(0), undefined); const both = mk(1), centre = mk(2); assert.ok(both.pos.length > 0 && centre.pos.length > 0 && both.pos.length > centre.pos.length * 1.5);
});
test('a road cut by two cells draws the same dashes and treads either side (s0)', () => {
  const tile = tileOf(() => 0, { n: 61, minX: -20, minZ: -20 }), box = { x0: 20, x1: 26, z0: -10, z1: 10 };
  const make = (r, g) => { const s = createSoups(); (r.steps ? steps : roadRibbons)(s, r, r.steps ? (x, z) => tile.height(x, z) : tile, STYLE); return clipSoups(s, box).map.get(g); };
  const key = (sp) => { const o = []; for (let i = 0; i < sp.pos.length; i += 9) o.push([...sp.pos.slice(i, i + 9)].map((v) => v.toFixed(4)).join(',')); return o.sort(); };
  const A = road({ pts: [0, 0, 24, 0], marking: 1, len: 100, s0: 0 }), B = road({ pts: [15, 0, 60, 0], marking: 1, len: 100, s0: 15 });
  const a = make(A, 'paint_white|tn'), b = make(B, 'paint_white|tn'); assert.ok(a && b); assert.equal(key(a).length, key(b).length); assert.deepEqual(key(a), key(b));
  const SA = road({ pts: [0, 0, 24, 0], kind: 'steps', steps: { count: 50, handrail: 1 }, width: 2, len: 100, s0: 0 }), SB = road({ pts: [15, 0, 60, 0], kind: 'steps', steps: { count: 50, handrail: 1 }, width: 2, len: 100, s0: 15 });
  assert.deepEqual(key(make(SA, SOUP.tread)), key(make(SB, SOUP.tread))); assert.deepEqual(key(make(SA, 'metal|tv')), key(make(SB, 'metal|tv')));
});
test('a crossing is 0.5 m stripes across the road, draped; the centre line is dashes 3 m long every 9 m', () => {
  const tile = tileOf((x) => 0.05 * x), s = createSoups(); crossing(s, { x: 0, z: 0, yaw: 0, width: 6 }, tile, STYLE);
  const p = s.map.get('paint_white|tn'); assert.ok(Math.abs(planArea(p) - 6 * 0.5 * 3) < 0.5, `stripes ${planArea(p)}`);
  for (let i = 0; i < p.pos.length; i += 3) assert.ok(Math.abs(p.pos[i + 1] - (0.05 * p.pos[i] + 0.04)) < 1e-6);
  const m = createSoups(); roadRibbons(m, road({ pts: [0, 0, 27, 0], marking: 1, len: 27 }), tile, STYLE); assert.ok(Math.abs(planArea(m.map.get('paint_white|tn')) - 3 * 0.12 * 3) < 0.05);
});
test('physics: a capsule steps down the kerb and up again, and climbs the steps road', async () => {
  const sc = fixture('scene-new', (x, z) => 20 - 0.1 * z);
  const { terrain, physics } = await installAll(jsonSource(sc));
  const pos = { x: 0, y: terrain.height(0, -24) + 0.05, z: -24 };
  const down = walk(physics, pos, 0, 1, 2, 2.5); assert.ok(!down.blocked && down.pos.z > -19, `crossed the kerb to the road: z ${down.pos.z}`);
  const up = walk(physics, down.pos, 0, -1, 2, 3.5); assert.ok(!up.blocked && up.pos.z < -24.5, `and back up onto the sidewalk and beyond: z ${up.pos.z}`);
  const st = { x: 120, y: terrain.height(120, -20) + 0.05, z: -20 }, climb = walk(physics, st, 0, -1, 2.5, 12); assert.ok(climb.pos.z < -45, `climbs the steps at walking speed: z ${climb.pos.z}`);
});

test('street wear: decals on a street, none off it, the same either side of a cell cut, in their bands, on the ground', () => {
  const tile = tileOf((x) => x * 0.02, { n: 101, minX: -20, minZ: -20 }), box = { x0: 40, x1: 90, z0: -10, z1: 10 };
  const make = (r, st = STYLE) => { const s = createSoups(); roadRibbons(s, r, tile, st); return clipSoups(s, box); };
  const key = (sp) => { const o = []; for (let i = 0; i < sp.pos.length; i += 9) o.push([...sp.pos.slice(i, i + 9)].map((v) => v.toFixed(4)).join(',')); return o.sort(); };
  const A = road({ pts: [0, 0, 100, 0], len: 230, s0: 0, sidewalk: 'both' }), B = road({ pts: [30, 0, 140, 0], len: 230, s0: 30, sidewalk: 'both' });
  const a = make(A), b = make(B), wa = a.map.get('wear|n'), wb = b.map.get('wear|n');
  assert.ok(wa && wa.pos.length > 0, 'a street gets wear'); const moments = (sp) => { let A = 0, U = 0, V = 0; for (let i = 0, t = 0; i < sp.pos.length; i += 9, t++) { const T = [0, 3, 6].map((k) => [sp.pos[i + k], 0, sp.pos[i + k + 2]]), a = area2d(T); A += a; U += a * (sp.uv[t * 6] + sp.uv[t * 6 + 2] + sp.uv[t * 6 + 4]) / 3; V += a * (sp.uv[t * 6 + 1] + sp.uv[t * 6 + 3] + sp.uv[t * 6 + 5]) / 3; } return [A, U, V]; };
  for (const [x, y] of moments(wa).map((v, i) => [v, moments(wb)[i]])) assert.ok(Math.abs(x - y) < 1e-6 * Math.max(1, Math.abs(x)), 'both pieces draw the same wear: same area, same texture coordinates');
  for (const k of ['metal|tv', 'paint_white|tn']) if (a.map.get(k) || b.map.get(k)) assert.deepEqual(key(a.map.get(k)), key(b.map.get(k)));
  for (let i = 0; i < wa.uv.length; i += 2) { const v = wa.uv[i + 1] % 1; assert.ok(wa.uv[i + 1] >= 0 && wa.uv[i + 1] <= 1 && v >= 0, 'v is within the wear texture'); }
  for (let i = 0; i < wa.pos.length; i += 3) assert.ok(Math.abs(wa.pos[i + 1] - (wa.pos[i] * 0.02)) < 0.3 && wa.pos[i + 1] > wa.pos[i] * 0.02 - 0.01, 'on the ground');
  const off = make(A, resolveStyle({ wear: { gutter: 0, tracks: 0, patches: 0, oil: 0, manholes: 0 } }));
  const has = (m, k) => !!(m.map.get(k) && m.map.get(k).pos.length);
  assert.ok(!has(off, 'wear|n') && !has(off, 'metal|tv'), 'all kinds can be switched off');
  const foot = make(road({ pts: [0, 0, 100, 0], len: 230, kind: 'footway', cls: 8, width: 2.6, surface: 4 }));
  assert.ok(!has(foot, 'wear|n'), 'a footway is not a street');
  const gravel = make(road({ pts: [0, 0, 100, 0], len: 230, surface: 5 }));
  assert.ok(!has(gravel, 'wear|n'), 'no wear on a gravel road');
});

test('junctions: a street ending on another cuts its sidewalk across the mouth, and stops its own at the kerb; a way that goes straight on or bends does not', () => {
  const tile = tileOf(() => 0, { n: 61, minX: -50, minZ: -50 }), main = road({ pts: [-40, 0, 40, 0], len: 80, sidewalk: 'both', width: 7 });
  const stem = road({ pts: [0, 30, 0, 0], len: 30, sidewalk: 'both', width: 6, kind: 'residential' }), cont = road({ pts: [40, 0, 80, 0], len: 40, sidewalk: 'both', width: 7 });
  const lift = (roads, x, z) => { const a = liftRaster(roads, -50, -50, 100, STYLE); return a ? a[Math.floor(z + 50) * 100 + Math.floor(x + 50)] : 0; };
  assert.equal(lift([main], 0.5, 4.5), 14, 'alone, the sidewalk runs on at the mouth');
  assert.equal(lift([main, stem], 0.5, 4.5), 0, 'a street ending on it: the mouth is clear');
  assert.equal(lift([main, stem], 0.5, -4.5), 14, 'the far side is still a sidewalk');
  assert.equal(lift([main, stem], 12.5, 4.5), 14, 'and the sidewalk is back beyond the mouth');
  assert.equal(lift([main, stem], 2.5, 4.5), 0, 'the cut is the street width (6 m) and a little more: 3.35 m each way'); assert.equal(lift([main, stem], -2.5, 4.5), 0);
  assert.equal(lift([main, stem], 3.5, 4.5), 14); assert.equal(lift([main, stem], -3.5, 4.5), 14);
  assert.equal(lift([main, stem], -3.5, 15.5), 14, 'the stem keeps its sidewalk away from the junction');
  assert.equal(lift([stem], -3.5, 2.5), 14); assert.equal(lift([main, stem], -3.5, 2.5), 0, 'the stem stops at the main street kerb: no strip over its carriageway (z < 3.5)');
  assert.equal(lift([main, cont], 39.5, 4.5), 14, 'a way continuing straight on is not a junction'); assert.equal(lift([main, cont], 41.5, 4.5), 14);
  const bend = road({ pts: [40, 0, 40, 30], len: 30, sidewalk: 'both', width: 7 });
  assert.equal(lift([main, bend], 39.5, -4.5), 14, 'a bend into the next way keeps its outer sidewalk');
  const tee = [road({ pts: [-40, 0, 0, 0], len: 40, sidewalk: 'both', width: 7 }), road({ pts: [0, 0, 41, 0], len: 41, sidewalk: 'both', width: 7 }), stem];
  assert.equal(lift(tee, 0.5, 4.5), 0, 'a main street split at the node: the stem still clears the mouth'); assert.equal(lift(tee, -10.5, 4.5), 14); assert.equal(lift(tee, 0.5, -4.5), 14, 'and the far side runs through');
  const s = createSoups(); roadRibbons(s, main, tile, STYLE, [main, stem]);
  const without = createSoups(); roadRibbons(without, main, tile, STYLE);
  assert.ok(upArea(s.map.get('concrete|tn')) < upArea(without.map.get('concrete|tn')) - 10, 'the drawn sidewalk loses the mouth');
});

const meanCol = (sp) => { const m = [0, 0, 0], n = sp.col.length / 3; for (let i = 0; i < sp.col.length; i++) m[i % 3] += sp.col[i] / n; return m; };
const closeTo = (m, c, tol) => m.every((v, k) => Math.abs(v - c[k]) <= c[k] * tol + 1e-9);
test('kerb stones carry one tint per vertex, near the style kerbColor (default without the key), varied by at most 6 %', () => {
  for (const [st, hex] of [[STYLE, '#8d8a84'], [resolveStyle({ kerbColor: '#928e88' }), '#928e88']]) {
    const s = createSoups(); roadRibbons(s, road({ sidewalk: 'both', pts: [-10, 0, 10, 0], s0: 0, len: 20 }), tileOf(() => 0), st);
    assert.ok(s.map.has(SOUP.kerb)); assert.equal(SOUP.kerb, 'concrete|tvn'); const sp = s.map.get(SOUP.kerb);
    assert.equal(sp.col.length, sp.pos.length); assert.ok(sp.col.every((v) => Number.isFinite(v)));
    const c = parseColor(hex); assert.ok(closeTo(meanCol(sp), c, 0.06), 'mean colour is the kerb colour');
    for (let i = 0; i < sp.col.length; i += 3) assert.ok(closeTo([sp.col[i], sp.col[i + 1], sp.col[i + 2]], c, 0.0601), 'each tone within 6 %');
  }
});
test('stair treads carry treadColor per vertex, the default without the key', () => {
  for (const [st, hex] of [[STYLE, '#9a968e'], [resolveStyle({ treadColor: '#807a70' }), '#807a70']]) {
    const s = createSoups(); steps(s, road({ pts: [0, 0, 12, 0], kind: 'steps', steps: { count: 14, handrail: 0 }, width: 3, len: 12 }), () => 0, st);
    const sp = s.map.get(SOUP.tread); assert.equal(SOUP.tread, 'concrete|tv'); assert.equal(sp.col.length, sp.pos.length); assert.ok(sp.col.every((v) => Number.isFinite(v)));
    assert.ok(closeTo(meanCol(sp), parseColor(hex), 0.06));
  }
});
