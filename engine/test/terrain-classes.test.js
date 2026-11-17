// Where two surface classes meet on the terrain, the mesh is cut along the raster's contour (level/terrain-classes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classTriangles } from '../src/level/terrain-classes.js';

const M = 11, STEP = 2.5, h = (x, z) => 3 + 0.2 * x + 0.05 * z + Math.sin(x * 0.7) * 0.3;
function grid() {
  const pos = new Float32Array(M * M * 3), nrm = new Float32Array(M * M * 3);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const k = (j * M + i) * 3; pos[k] = i * STEP; pos[k + 1] = h(i * STEP, j * STEP); pos[k + 2] = j * STEP; nrm[k + 1] = 1; }
  return { pos, nrm };
}
const run = (classAt, rockCell = () => false, snap = 0) => { const g = grid(), r = classTriangles({ m: M, ...g, classAt, rockCell, snap }); return { ...g, ...r }; };
const at = (r, v) => (v < M * M ? [r.pos[v * 3], r.pos[v * 3 + 1], r.pos[v * 3 + 2]] : [r.extraPos[(v - M * M) * 3], r.extraPos[(v - M * M) * 3 + 1], r.extraPos[(v - M * M) * 3 + 2]]);
const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
const planeY = (x, z) => { // the drawn height: the plane of the terrain triangle under (x, z), from the samples
  const i = Math.min(M - 2, Math.floor(x / STEP)), j = Math.min(M - 2, Math.floor(z / STEP)), u = x / STEP - i, v = z / STEP - j, hh = (a, b) => h((i + a) * STEP, (j + b) * STEP);
  return u + v <= 1 ? hh(0, 0) + (hh(1, 0) - hh(0, 0)) * u + (hh(0, 1) - hh(0, 0)) * v : hh(1, 1) + (hh(0, 1) - hh(1, 1)) * (1 - u) + (hh(1, 0) - hh(1, 1)) * (1 - v);
};

test('a class edge is cut along the raster contour: no triangle is drawn whole in a class its corners do not share, area and heights unchanged', () => {
  const edge = (x, z) => (x + 0.35 * z < 11.3 ? 'grass' : x - 0.2 * z > 20 ? 'cobble' : 'paving');
  const r = run(edge), whole = new Map();
  let total = 0, cutTris = 0;
  for (const [cls, idx] of r.byClass) for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]], P = v.map((q) => at(r, q)); total += area(...P);
    if (v.every((q) => q < M * M)) for (const q of v) assert.equal(edge(...[at(r, q)[0], at(r, q)[2]]), cls, 'a whole triangle only in the class all its corners are');
    else cutTris++;
    for (const p of P) assert.ok(Math.abs(p[1] - planeY(p[0], p[2])) < 1e-4, "on the terrain triangle");
    const ny = (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]); assert.ok(ny > 0, 'faces up (the mesh winding)');
  }
  assert.ok(Math.abs(total - (M - 1) * (M - 1) * STEP * STEP) < 1e-6, `covered area ${total}`);
  assert.ok(cutTris > 0 && r.byClass.size === 3, 'three classes, some cut');
  const original = (M - 1) * (M - 1) * 2; let n = 0; for (const idx of r.byClass.values()) n += idx.length / 3;
  assert.ok(n < original * 1.5, `${n} triangles against ${original}`);
});
test('the cut points lie on the contour of the raster, not on the grid', () => {
  const r = run((x) => (x < 11.3 ? 'grass' : 'paving'));
  assert.ok(r.extraPos.length > 0);
  for (let k = 0; k < r.extraPos.length; k += 3) assert.ok(Math.abs(r.extraPos[k] - 11.3) < 0.2, `cut at x ${r.extraPos[k]}`);
});
test('rock cells are rock whole, and a uniform raster adds no vertex and no triangle', () => {
  const r = run(() => 'paving', (i, j) => i === 3 && j === 4);
  assert.equal(r.extraPos.length, 0); assert.equal(r.byClass.get('rock').length, 6); assert.equal(r.byClass.get('paving').length, ((M - 1) * (M - 1) - 1) * 6);
});
test('snap: slivers are not cut out (fewer triangles), nothing is lost, and a triangle is only drawn whole in a class its corners do not share when the odd corner is under the snap share', () => {
  const edge = (x, z) => (x + 0.35 * z < 11.3 ? 'grass' : 'paving');
  const full = run(edge), snapped = run(edge, () => false, 0.3), count = (r) => { let n = 0; for (const a of r.byClass.values()) n += a.length / 3; return n; };
  assert.ok(count(snapped) < count(full), `${count(snapped)} < ${count(full)}`);
  let total = 0, wrong = 0;
  for (const [cls, idx] of snapped.byClass) for (let t = 0; t < idx.length; t += 3) { const P = [0, 1, 2].map((k) => at(snapped, idx[t + k])), a = area(...P); total += a; const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cz = (P[0][2] + P[1][2] + P[2][2]) / 3; if (edge(cx, cz) !== cls) wrong += a; }
  assert.ok(Math.abs(total - (M - 1) * (M - 1) * STEP * STEP) < 1e-6, 'area unchanged'); assert.ok(wrong < 0.1 * total, `misassigned area ${wrong} of ${total}`);
});
