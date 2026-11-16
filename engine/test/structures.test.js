// Walls and passages (src/gen/structures.js, src/gen/passage.js; docs/plans/SCENE-DETAIL.md item 7). What holds for
// any generator that keeps the contracts; item 7 adds the plan's tests of scarps, crenels, pieces and vaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wallRings, wall } from '../src/gen/structures.js';
import { passagePieces, passageArch } from '../src/gen/passage.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, STRUCTURE_SOUP } from '../src/gen/style.js';
import { signedArea, pointInRing } from '../src/gen/poly.js';
import { jsonSource } from '../src/scene/source.js';
import { fixture, installAll, vertices, building } from './helpers.js';

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
for (const t of ['a wall along a 3 m scarp with hp 1.4: 4.4 m from the low side, and a walker on the high side is stopped', 'a 22 m crenellated wall: 10 merlons within its thickness, none floating; two pieces meet in step (s0)',
  'a rail: posts and rails from the kit, collision the thin ring', 'passagePieces of a 12 x 6 building with a 4 m passage: three pieces of area 24; the middle starts at yBase + h; cut edges are blind',
  'a 1.8 m capsule walks through the fixture\'s gate along the axis and is stopped 3 m to the side', 'the vault\'s highest point is at h and every vault vertex within w / 2 of the axis']) test.todo('item 7: ' + t);
