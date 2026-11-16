// Polygons on the plan (src/gen/poly.js) and the cells of a chunk (src/gen/cells.js): the geometry every generator
// and the reader stand on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signedArea, centroid, pointInRing, bbox, obb, clip, triangulate, inset } from '../src/gen/poly.js';
import { CELLS, cellBoxes, cellIndex, boxDistance, clipLine, lineLength, clipSoups } from '../src/gen/cells.js';
import { createSoups, tri, cap } from '../src/gen/soup.js';
import { planArea } from './helpers.js';

const SQ = [0, 0, 10, 0, 10, 10, 0, 10], L = [0, 0, 12, 0, 12, 4, 6, 4, 6, 8, 0, 8], rev = (r) => { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
const triArea = (pts, t, i) => { const [a, b, c] = [t[i], t[i + 1], t[i + 2]].map((k) => [pts[k * 2], pts[k * 2 + 1]]); return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; };

test('area, centroid, inside and bounding box of a ring', () => {
  assert.equal(signedArea(SQ), 100); assert.equal(signedArea(rev(SQ)), -100); assert.equal(Math.abs(signedArea(L)), 72);
  assert.deepEqual(centroid(SQ), [5, 5]);
  const [cx, cz] = centroid(L); assert.ok(Math.abs(cx - (48 * 6 + 24 * 3) / 72) < 1e-9 && Math.abs(cz - (48 * 2 + 24 * 6) / 72) < 1e-9, 'the centroid of the area, not of the vertices');
  assert.ok(pointInRing(3, 6, L) && !pointInRing(9, 6, L));
  assert.deepEqual(bbox(L), { minX: 0, minZ: 0, maxX: 12, maxZ: 8 });
});
test('the oriented box follows a turned rectangle: long axis, half sizes, fill', () => {
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a), R = [[-6, -4], [6, -4], [6, 4], [-6, 4]].flatMap(([x, z]) => [20 + x * c - z * s, 5 + x * s + z * c]);
  const o = obb(R);
  assert.ok(Math.abs(o.L - 6) < 1e-9 && Math.abs(o.W - 4) < 1e-9 && Math.abs(o.fill - 1) < 1e-9);
  assert.ok(Math.abs(o.cx - 20) < 1e-9 && Math.abs(o.cz - 5) < 1e-9 && Math.abs(Math.abs(o.ux * c + o.uz * s) - 1) < 1e-9, 'the long axis is the rectangle\'s');
  assert.ok(Math.abs(obb(L).fill - 72 / 96) < 1e-9);
});
test('clip keeps the side of a line where a x + b z + c >= 0', () => {
  const half = clip(SQ, 1, 0, -4); // x >= 4
  assert.equal(Math.abs(signedArea(half)), 60); assert.ok(signedArea(half) > 0, 'the winding is kept');
  assert.deepEqual(clip(SQ, 1, 0, -20), []);
});
test('triangulate: ears on any ring, in either winding, with holes; triangles face up', () => {
  for (const ring of [SQ, rev(SQ), L, rev(L)]) {
    const t = triangulate(ring); let sum = 0;
    for (let i = 0; i < t.length; i += 3) { const a = triArea(ring, t, i); assert.ok(a < 0, 'negative area in (x, z) is a face that looks up'); sum += -a; }
    assert.ok(Math.abs(sum - Math.abs(signedArea(ring))) < 1e-9); assert.equal(t.length / 3, ring.length / 2 - 2);
  }
  const hole = [3, 3, 6, 3, 6, 6, 3, 6];
  for (const h of [hole, rev(hole)]) {
    const t = triangulate(SQ, [h]), all = SQ.concat(h); let sum = 0;
    for (let i = 0; i < t.length; i += 3) { const a = triArea(all, t, i); assert.ok(a < 0); sum += -a; }
    assert.equal(t.length / 3, 8); assert.ok(Math.abs(sum - 91) < 1e-9, 'outer less the hole');
  }
  // two holes, and a spike that has no area
  const two = triangulate([0, 0, 20, 0, 20, 10, 0, 10], [[2, 2, 6, 2, 6, 6, 2, 6], [12, 3, 16, 3, 16, 7, 12, 7]]);
  let sum = 0; const pts = [0, 0, 20, 0, 20, 10, 0, 10, 2, 2, 6, 2, 6, 6, 2, 6, 12, 3, 16, 3, 16, 7, 12, 7];
  for (let i = 0; i < two.length; i += 3) sum -= triArea(pts, two, i);
  assert.ok(Math.abs(sum - (200 - 16 - 16)) < 1e-9);
  const mid = [0, 0, 5, 0, 10, 0, 10, 10, 0, 10], tm = triangulate(mid); sum = 0; for (let i = 0; i < tm.length; i += 3) sum -= triArea(mid, tm, i);
  assert.ok(Math.abs(sum - 100) < 1e-9, 'a vertex on a straight edge loses no area');
  assert.deepEqual(triangulate([0, 0, 5, 0, 10, 0]), [], 'a ring without area gives nothing');
  assert.equal(triangulate.fallbacks, 0);
  const s = createSoups().get('x|'); cap(s, SQ, [hole], 7); assert.ok(Math.abs(planArea(s) - 91) < 1e-9); assert.ok(s.pos.every((v, i) => i % 3 !== 1 || v === 7));
  const d = createSoups().get('x|'); cap(d, SQ, [], 7, null, false); assert.ok(d.nrm[1] < -0.99, 'a cap can look down');
});
test('inset is left for the roofs item and says so', () => { assert.throws(() => inset(SQ, 1), /not built/); });

test('a chunk is 4 x 4 cells; a point has one cell, clamped into the chunk', () => {
  const boxes = cellBoxes(-100, -200, 250);
  assert.equal(boxes.length, CELLS * CELLS); assert.deepEqual([boxes[5].i, boxes[5].j, boxes[5].x0, boxes[5].z0, boxes[5].x1, boxes[5].z1], [1, 1, -37.5, -137.5, 25, -75]);
  assert.equal(cellIndex(0, -100, -100, -200, 250), 5); assert.equal(cellIndex(-500, 900, -100, -200, 250), 12, 'clamped');
  assert.equal(boxDistance(boxes[5], 0, -100), 0); assert.equal(boxDistance(boxes[5], 28, -71), 5);
});
test('a line is cut to a box with a margin; pieces know where they start along the whole line', () => {
  const box = { x0: 0, z0: 0, x1: 10, z1: 10 };
  const one = clipLine([-20, 5, 30, 5], box);
  assert.deepEqual(one, [{ pts: [0, 5, 10, 5], s0: 20 }]);
  assert.deepEqual(clipLine([-20, 5, 30, 5], box, 2)[0], { pts: [-2, 5, 12, 5], s0: 18 });
  const bent = clipLine([-5, 5, 5, 5, 5, 20, 8, 20, 8, 5], box); // leaves by the far side and comes back
  assert.equal(bent.length, 2); assert.deepEqual(bent[0], { pts: [0, 5, 5, 5, 5, 10], s0: 5 }); assert.deepEqual(bent[1], { pts: [8, 10, 8, 5], s0: 10 + 15 + 3 + 10 });
  assert.deepEqual(clipLine([20, 0, 20, 10], box), []);
  assert.equal(lineLength([0, 0, 3, 4, 3, 10]), 11);
});
test('soups are cut to a box: nothing outside, nothing lost inside, neighbours share the cut', () => {
  const big = () => { const set = createSoups(), s = set.get('asphalt|tn'); tri(s, [-5, 1, -5], [-5, 3, 25], [25, 2, -5], null, [0, 0], [0, 1], [1, 0]); tri(s, [2, 0, 2], [2, 0, 4], [4, 0, 2]); return set; };
  const a = clipSoups(big(), { x0: 0, z0: 0, x1: 10, z1: 10 }).get('asphalt|tn'), b = clipSoups(big(), { x0: 10, z0: 0, x1: 20, z1: 10 }).get('asphalt|tn');
  for (const s of [a, b]) assert.equal(s.pos.length / 3, s.nrm.length / 3), assert.equal(s.pos.length / 3, s.uv.length / 2);
  for (let i = 0; i < a.pos.length; i += 3) assert.ok(a.pos[i] >= -1e-9 && a.pos[i] <= 10 + 1e-9 && a.pos[i + 2] >= -1e-9 && a.pos[i + 2] <= 10 + 1e-9);
  // the big triangle covers x + z <= 20 there: all of the first box, half of the second; the small one lies in the first
  assert.ok(Math.abs(planArea(a) - (100 + 2)) < 1e-9, `first box ${planArea(a)}`); assert.ok(Math.abs(planArea(b) - 50) < 1e-9, `second box ${planArea(b)}`);
  // the cut keeps every vertex on the triangle's own plane (y = 1 + (z + 5) / 15 + (x + 5) / 30) and carries uv with it
  for (let i = 0, v = 0; i < b.pos.length; i += 3, v += 2) { assert.ok(Math.abs(b.pos[i + 1] - (1 + (b.pos[i + 2] + 5) / 15 + (b.pos[i] + 5) / 30)) < 1e-9); assert.ok(Math.abs(b.uv[v] - (b.pos[i] + 5) / 30) < 1e-9); }
});
