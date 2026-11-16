// Walls and passages (src/gen/structures.js, src/gen/passage.js; docs/plans/SCENE-DETAIL.md item 7). What holds for
// any generator that keeps the contracts; item 7 adds the plan's tests of scarps, crenels, pieces and vaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallRings, wall, merlons } from '../src/gen/structures.js';
import { passagePieces, passageArch } from '../src/gen/passage.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, STRUCTURE_SOUP, SOUP } from '../src/gen/style.js';
import { signedArea, pointInRing } from '../src/gen/poly.js';
import { jsonSource } from '../src/scene/source.js';
import { fixture, installAll, vertices, building, walk, oldQuebec } from './helpers.js';
import { createGrid, createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics } from '../src/physics/physics.js';
import { vaultProfile } from '../src/gen/passage.js';
import { WALL_SOUP } from '../src/gen/style.js';

const style = resolveStyle();
const piece = (o = {}) => ({ pts: [0, 0, 20, 0, 20, 12], cls: 3, kind: 'wall', height: 2, parapet: null, thickness: 0.5, material: 1, crenels: false, rail: null, name: '', s0: 0, len: 32, ...o });

test('a wall is solids that stand on the ground: one ring per run, below the lowest ground, `height` above it', () => {
  const slope = (x) => 10 + x * 0.1, rings = wallRings(piece(), slope);
  assert.ok(rings.length >= 2);
  for (const r of rings) {
    assert.equal(r.ring.length, 8); let lo = Infinity, hi = -Infinity; for (let i = 0; i < 8; i += 2) { lo = Math.min(lo, slope(r.ring[i])); hi = Math.max(hi, slope(r.ring[i])); }
    assert.ok(r.yBase <= lo - 0.5, 'the base is in the ground'); assert.ok(r.yTop >= lo + 2 - 1e-9 && r.yTop <= hi + 2 + 1e-9, 'the top is `height` above the ground under it');
    for (let i = 0; i < 8; i += 2) assert.ok(r.ring[i] >= -0.26 && r.ring[i] <= 20.26 && r.ring[i + 1] >= -0.26 && r.ring[i + 1] <= 12.26, 'no further than the thickness beyond the piece');
  }
});
test('a wall that holds ground back stands `parapet` above the higher side', () => {
  const scarp = (x, z) => (z > 0 ? 14 : 10), rings = wallRings(piece({ pts: [0, 0, 6, 0], parapet: 1.4, height: 2 }), scarp);
  for (const r of rings) assert.ok(Math.abs(r.yTop - 15.4) < 1e-9 && r.yBase < 10);
});
test('what is drawn is what collides: every drawn vertex of a wall lies on its rings', () => {
  const ground = (x) => 10 + x * 0.05, w = piece(), rings = wallRings(w, ground), soups = createSoups(); wall(soups, w, ground, style);
  assert.ok(soups.map.get(STRUCTURE_SOUP[1]).pos.length > 0, 'in the soup of its material');
  const grown = (r) => { const cx = (r[0] + r[2] + r[4] + r[6]) / 4, cz = (r[1] + r[3] + r[5] + r[7]) / 4; return r.map((v, i) => v + Math.sign(v - (i % 2 ? cz : cx)) * 0.02); };
  for (const [x, y, z] of vertices(soups)) assert.ok(rings.some((r) => pointInRing(x, z, grown(r.ring)) && y >= r.yBase - 1e-6), `(${x}, ${y}, ${z}) is on no ring`);
});
test('a building without a passage is one piece: itself. Pieces of any building tile it and keep their numbering in range', async () => {
  const b = building([0, 0, 10, 0, 10, 8, 0, 8]); assert.deepEqual(passagePieces(b), [b]); assert.equal(passagePieces(b)[0], b);
  assert.equal(passageArch.length, 5);
  const { chunks } = await installAll(jsonSource(fixture('scene-new')));
  const gate = [...chunks.values()].flatMap((c) => c.chunk.buildings).find((x) => x.passages.length), pieces = passagePieces(gate);
  let area = 0;
  for (const p of pieces) {
    area += Math.abs(signedArea(p.ring)); assert.ok(p.yMin >= gate.yBase); assert.ok(p.blind instanceof Set && p.front instanceof Set);
    for (const e of [...p.blind, ...p.front]) assert.ok(e >= 0 && e < p.ring.length / 2);
  }
  assert.ok(Math.abs(area - Math.abs(signedArea(gate.ring))) / area < 0.01, 'the pieces tile the building');
});

function world(f = () => 0) {
  const n = 101, terrain = createTerrain({ chunk: 100 });
  for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) terrain.addTile(cx, cz, createGrid({ nx: n, nz: n, cell: 1, minX: cx * 100, minZ: cz * 100, data: new Float32Array(n * n).map((_, k) => f(cx * 100 + (k % n), cz * 100 + ((k / n) | 0))) }));
  return { terrain, physics: createPhysics({ terrain }) };
}
const addWall = (physics, rings) => { for (const r of rings) physics.addPrism(r.ring, r.yBase, r.yTop); };

test('a wall along a 3 m scarp with hp 1.4: 4.4 m from the low side, and a walker on the high side is stopped', () => {
  const ground = (x, z) => (z < 0 ? 13 : 10), { physics } = world(ground), w = piece({ pts: [-10, 0, 10, 0], parapet: 1.4, height: 5, thickness: 2.4 });
  const rings = wallRings(w, ground);
  for (const r of rings) assert.ok(Math.abs(r.yTop - 14.4) < 1e-9, `top ${r.yTop}`);
  assert.ok(rings[0].yTop - 10 >= 4.4, 'shows at least 4.4 m from the low side');
  addWall(physics, rings);
  const up = walk(physics, { x: 0, y: 10, z: 8 }, 0, -1, 3, 3);
  assert.ok(up.pos.z > 1.2, `stopped at the foot, z = ${up.pos.z.toFixed(2)}`);
  const down = walk(physics, { x: 0, y: 13, z: -8 }, 0, 1, 3, 3);
  assert.ok(down.pos.z < -1.2, `and from the high side, z = ${down.pos.z.toFixed(2)}`);
});
test('a 22 m crenellated wall: 10 merlons within its thickness, none floating; two pieces meet in step', () => {
  const ground = (x, z) => 5 + 0.04 * x + (z > 0 ? 3 : 0), mk = (o) => piece({ pts: [0, 0, 22, 0], crenels: true, thickness: 1, height: 3, len: 22, parapet: 1.4, ...o });
  const w = mk(), ms = merlons(w, ground), rings = wallRings(w, ground);
  assert.equal(ms.length, 10);
  for (const m of ms) {
    assert.ok(Math.abs(m.cz) + m.hd <= 0.5 + 1e-9, 'within the thickness');
    assert.ok(m.cx - m.hu >= -1e-9 && m.cx + m.hu <= 22 + 1e-9, 'within the wall');
    assert.ok(rings.some((r) => Math.abs(r.yTop - m.y0) < 1e-9), 'stands on the top of a run, never above the ground it is over');
    assert.ok(rings.some((r) => pointInRing(m.cx, m.cz, r.ring) && m.y0 <= r.yTop + 1e-9), 'and never floats over the run under it');
  }
  const a = merlons(mk({ pts: [0, 0, 9, 0] }), ground), b = merlons(mk({ pts: [9, 0, 22, 0], s0: 9 }), ground);
  const edges = (list) => list.map((m) => [m.cx - m.hu, m.cx + m.hu]).sort((p, q) => p[0] - q[0]);
  const parts = [...edges(a), ...edges(b)].sort((p, q) => p[0] - q[0]), joined = [];
  for (const e of parts) { const last = joined[joined.length - 1]; if (last && Math.abs(last[1] - e[0]) < 1e-9) last[1] = e[1]; else joined.push([...e]); }
  const whole = edges(ms);
  assert.equal(joined.length, whole.length);
  joined.forEach((e, i) => { assert.ok(Math.abs(e[0] - whole[i][0]) < 1e-9 && Math.abs(e[1] - whole[i][1]) < 1e-9); });
  assert.ok(ms.every((m) => m.cz < 0), 'on the low edge only');
});
test('a free-standing crenellated wall has merlons on both edges', () => {
  const ms = merlons(piece({ pts: [0, 0, 22, 0], crenels: true, thickness: 1.2, height: 3, len: 22 }), () => 5);
  assert.equal(ms.length, 20);
});
test('a rail is posts and rails in iron, not a prism; its collision is the thin ring', () => {
  const ground = () => 3, w = piece({ pts: [0, 0, 10, 0], rail: 'rail_iron', thickness: 0.08, height: 1.1, len: 10 }), soups = createSoups();
  wall(soups, w, ground, style);
  assert.deepEqual([...soups.map.keys()], [SOUP.iron]);
  const ys = vertices(soups).map((v) => v[1]); assert.ok(Math.max(...ys) <= 3 + 1.1 + 1e-6 && Math.max(...ys) > 3 + 1.0);
  const rings = wallRings(w, ground); assert.ok(rings.every((r) => r.yTop >= 3 + 1.1));
  assert.ok(soups.triangles() > 60 && soups.triangles() < 600);
  // posts are placed by s0 + distance: a post stands every 2 m of the whole line, whichever piece draws it
  const xsOf = (pts, s0) => { const so = createSoups(); wall(so, { ...w, pts, s0 }, ground, style); const s = so.map.get(SOUP.iron), set = new Set(); for (let i = 0; i < s.pos.length; i += 9) if (Math.abs(s.pos[i + 4] - s.pos[i + 1]) > 0.5 && Math.abs(s.pos[i + 3] - s.pos[i]) < 1e-6) set.add(Math.round((s.pos[i] + s.pos[i + 3] + s.pos[i + 6]) / 3 * 10) / 10); return set; };
  const posts = xsOf([0, 0, 10, 0], 0), split = new Set([...xsOf([0, 0, 6, 0], 0), ...xsOf([6, 0, 10, 0], 6)]);
  assert.ok(posts.size >= 5 && split.size === posts.size);
});

const gate = (o = {}) => building([0, 0, 12, 0, 12, 6, 0, 6], { blind: new Set([1, 3]), front: new Set([0]), passages: [{ x1: 6, z1: -1, x2: 6, z2: 7, w: 4, h: 4.5 }], ...o });
test('passagePieces of a 12 x 6 building with a 4 m passage: three pieces of area 24; the middle starts at yBase + h; cut edges are blind', () => {
  const b = gate(), ps = passagePieces(b);
  assert.equal(ps.length, 3);
  const areas = ps.map((p) => Math.abs(signedArea(p.ring)));
  assert.ok(areas.every((a) => Math.abs(a - 24) < 0.24), areas.join());
  assert.deepEqual(ps.map((p) => p.piece), [0, 1, 2]);
  const mid = ps.find((p) => p.yMin > b.yBase); assert.ok(Math.abs(mid.yMin - (b.yBase + 4.5)) < 1e-9);
  assert.equal(ps.filter((p) => p.yMin === b.yMin).length, 2);
  for (const p of ps) {
    const n = p.ring.length / 2; assert.ok([...p.blind, ...p.front].every((e) => e >= 0 && e < n));
    // every edge that lies on a cut line (x = 4 or x = 8) is blind
    for (let e = 0; e < n; e++) { const z0 = p.ring[e * 2 + 1], z1 = p.ring[((e + 1) % n) * 2 + 1], x0 = p.ring[e * 2], x1 = p.ring[((e + 1) % n) * 2]; if ((Math.abs(x0 - 4) < 1e-9 && Math.abs(x1 - 4) < 1e-9 || Math.abs(x0 - 8) < 1e-9 && Math.abs(x1 - 8) < 1e-9) && Math.abs(z1 - z0) > 1) assert.ok(p.blind.has(e), 'cut edge is blind'); }
  }
  // the building's own edges keep their meaning: each end piece keeps its short end blind, the front edge (z = 0) stays on all three
  const keep = ps.filter((p) => p.yMin === b.yMin);
  assert.ok(keep.every((p) => p.blind.size >= 2), 'its cut edge and its own end');
  assert.ok(ps.every((p) => p.front.size === 1), 'the front edge is still a front on every piece');
});
test('a cut that would leave a sliver beside the way leaves the building whole', () => {
  const b = gate({ passages: [{ x1: 6, z1: -1, x2: 6, z2: 7, w: 11.8, h: 4.5 }] });
  assert.deepEqual(passagePieces(b), [b]);
});
test('a 1.8 m capsule walks through along the axis and is stopped 3 m to the side', () => {
  const ground = () => 30, { physics } = world(ground), b = gate({ ring: [10, 10, 22, 10, 22, 16, 10, 16], passages: [{ x1: 9, z1: 13, x2: 23, z2: 13, w: 4, h: 4.5 }] });
  for (const p of passagePieces(b)) { const from = p.yMin > b.yBase + 0.01 ? p.yMin : b.yBase - 3; physics.addPrism(p.ring, from, b.yBase + 12); }
  const through = walk(physics, { x: 4, y: 30, z: 13 }, 1, 0, 3, 7);
  assert.ok(through.pos.x > 24, `walked through, x = ${through.pos.x.toFixed(2)}`);
  const side = walk(physics, { x: 4, y: 30, z: 16 }, 1, 0, 3, 7);
  assert.ok(side.pos.x < 9.7, `stopped at the pier, x = ${side.pos.x.toFixed(2)}`);
});
test('the vault\'s highest point is at h and every vault vertex is within w / 2 of the axis; at most 200 triangles', () => {
  for (const [w, h] of [[4, 4.5], [6, 6.5], [3, 3.2], [7, 5.9]]) {
    const b = gate({ ring: [0, 0, 12, 0, 12, 10, 0, 10], passages: [{ x1: -1, z1: 5, x2: 13, z2: 5, w, h }] }), soups = createSoups(), p = b.passages[0];
    passageArch(soups, b, p, () => 30, style);
    const vs = vertices(soups); assert.ok(vs.length > 0 && soups.triangles() <= 200, `${soups.triangles()} triangles`);
    assert.ok(Math.abs(Math.max(...vs.map((v) => v[1])) - (b.yBase + h)) < 1e-9, 'the crown is at h');
    assert.ok(vs.every((v) => Math.abs(v[2] - 5) <= w / 2 + 1e-9 && v[1] >= 30 - 0.3));
    assert.ok(Math.abs(vaultProfile(w, h).spring + vaultProfile(w, h).rise - h) < 1e-12);
    for (const k of soups.map.keys()) assert.equal(k, WALL_SOUP[b.facade]);
  }
});
test('every passage of the published scene can be walked through, along its axis', async () => {
  const { chunks, physics, terrain, source } = await installAll(jsonSource(oldQuebec())), wk = source.manifest.walkable;
  const walkable = (x, z) => x > wk.minX + 2 && x < wk.maxX - 2 && z > wk.minZ + 2 && z < wk.maxZ - 2;
  let n = 0, outside = 0;
  for (const { chunk } of chunks.values()) for (const b of chunk.buildings) for (const p of b.passages) {
    const L0 = Math.hypot(p.x2 - p.x1, p.z2 - p.z1);
    if (![[p.x1, p.z1], [p.x2, p.z2]].every(([x, z]) => walkable(x - 3 * (p.x2 - p.x1) / L0, z - 3 * (p.z2 - p.z1) / L0) && walkable(x + 3 * (p.x2 - p.x1) / L0, z + 3 * (p.z2 - p.z1) / L0))) { outside++; continue; } // beyond the play area: the world edge stops the walker
    n++;
    const L = Math.hypot(p.x2 - p.x1, p.z2 - p.z1), ux = (p.x2 - p.x1) / L, uz = (p.z2 - p.z1) / L, sx = p.x1 - ux * 3, sz = p.z1 - uz * 3;
    const pos = { x: sx, y: terrain.height(sx, sz), z: sz }, r = walk(physics, pos, ux, uz, 2.5, (L + 6) / 2.5);
    const along = (r.pos.x - sx) * ux + (r.pos.z - sz) * uz;
    assert.ok(along > L + 3, `passage at (${p.x1}, ${p.z1}) of building ${b.id}: walked ${along.toFixed(1)} of ${L + 6}`);
  }
  assert.ok(n >= 3, `${n} passages in the scene (${outside} beyond the play area)`);
});
