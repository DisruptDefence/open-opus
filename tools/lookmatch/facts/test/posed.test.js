// Stage B on hand-written fixtures. NEVER RUN ON REAL IMAGERY.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCamera, column, row, visibleFacades, stripMask, blobs, storeysAndWindows, factsOfStrip, posedFacts, camDefaults } from '../lib/posed.mjs';
import { image } from './helpers.js';

// Rings are counter-clockwise on the map in the builder's convention (negative shoelace area in (x, z)); the front edge faces the camera at the origin.
// A wall 10 m long at z = -10 (north of the camera), the building behind it (further north): ring corners (-5,-10) (5,-10) (5,-20) (-5,-20) in the order below.
const ring = (x0, z0, x1, z1) => [x0, z1, x1, z1, x1, z0, x0, z0];             // edge 0 runs along z = z1 (the near side for a building north of the camera)
const B = (id, r, extra = {}) => ({ id, r, g: 0, h: 9, rh: 0, ...extra });
const CAM = { x: 0, z: 0, heading: 0, width: 400, height: 300, hfov: 90, eye: 1.6 };

test('projection: a camera facing a known wall puts its corners in the right columns', () => {
  // hfov 90: the image edge is at s/d = +-1; a point 10 m ahead and 5 m right is at s/d = 0.5 -> u = 0.5 + 0.5/2 = 0.75
  const right = toCamera(CAM, 5, -10), left = toCamera(CAM, -5, -10);
  assert.ok(Math.abs(right.d - 10) < 1e-9 && Math.abs(right.s - 5) < 1e-9);
  assert.ok(Math.abs(column(CAM, right.d, right.s) - 300) < 1e-9); assert.ok(Math.abs(column(CAM, left.d, left.s) - 100) < 1e-9);
  const east = { ...CAM, heading: 90 }, p = toCamera(east, 10, 0); assert.ok(Math.abs(p.d - 10) < 1e-9 && Math.abs(p.s) < 1e-9, 'heading 90 looks east (+x)');
  assert.ok(Math.abs(row({ ...CAM }, 10, 1.6) - 150) < 1e-9, 'the eye line is the middle row');
  assert.ok(row(CAM, 10, 9) < 150 && row(CAM, 10, 0) > 150, 'higher is nearer the top');
});
test('the façade of a wall in front is visible and owns the columns between its corners', () => {
  const fs = visibleFacades([B(1, ring(-5, -20, 5, -10))], CAM), f = fs.find((x) => x.edge === 0);
  assert.ok(f, JSON.stringify(fs.map((x) => [x.buildingId, x.edge])));
  assert.ok(Math.abs(f.cols[0] - 100) <= 2 && Math.abs(f.cols[1] - 300) <= 2, `cols ${f.cols}`); assert.ok(Math.abs(f.depth - 10) < 0.1);
  assert.equal(fs.length, 1, 'the sides and the back face away or are edge-on');
});
test('a wall behind the camera is rejected; a wall facing away is rejected', () => {
  assert.deepEqual(visibleFacades([B(1, ring(-5, 10, 5, 20))], CAM), [], 'behind: heading north, the wall is south');
  const away = B(2, [-5, -20, -5, -10, 5, -10, 5, -20]);                         // the opposite winding: edge normals point the other way
  assert.deepEqual(visibleFacades([away], CAM).filter((x) => x.edge === 0 || x.edge === 2).length <= 1, true);
  assert.deepEqual(visibleFacades([B(3, ring(-5, -300, 5, -290))], CAM), [], 'beyond the maximum distance');
});
test('an occluded farther wall loses to the nearer one in the same columns', () => {
  const near = B(1, ring(-2, -8, 2, -5)), far = B(2, ring(-20, -30, 20, -20));
  const fs = visibleFacades([near, far], CAM), n = fs.find((f) => f.buildingId === 1), f = fs.find((f) => f.buildingId === 2);
  assert.ok(n && f);
  const nearCols = new Set(n.columns); assert.ok(f.columns.every((c) => !nearCols.has(c)), 'no column is owned twice');
  assert.ok(n.width > 60 && f.width > 100); assert.ok(f.columns.some((c) => c < n.cols[0]) && f.columns.some((c) => c >= n.cols[1]), 'the far wall shows on both sides of the near one');
  assert.ok(f.width <= 400 - n.width, 'and it owns only what the near wall leaves');
});
test('a blind edge is not a façade when the record lists front edges only', () => {
  const b = B(1, ring(-5, -20, 5, -10), { front: [1] });
  assert.equal(visibleFacades([b], CAM).some((f) => f.edge === 0), false);
});

// A picture: columns 100..299 hold a cream wall (the façade 10 m ahead) with 3 x 2 dark windows; the rest blue-red.
const pic = (cam) => image(cam.width, cam.height, (x, y) => {
  if (x < 100 || x >= 300) return [60, 90, 190];
  const wx = ((x - 100) % 60), wy = ((y - 90) % 70);
  if (wx >= 15 && wx < 45 && wy >= 15 && wy < 55 && y >= 60 && y < 260) return [15, 18, 25];
  return [215, 195, 140];
});
test('strip sampling: the façade strip is read, and only the strip: its colour is the wall\'s, not the blue beside it', () => {
  const cam = camDefaults(CAM), f = visibleFacades([B(1, ring(-5, -20, 5, -10), { h: 9 })], cam)[0];
  const { valid, pixels } = stripMask(cam, f);
  assert.ok(pixels > 1500); assert.equal(valid[150 * 400 + 50], 0, 'left of the façade'); assert.equal(valid[150 * 400 + 200], 1);
  const r = factsOfStrip(pic(cam), cam, f);
  assert.ok(r, 'a reading'); const [R, G, Bl] = [1, 3, 5].map((i) => parseInt(r.colour.slice(i, i + 2), 16));
  assert.ok(R > Bl + 40, `cream wall, not the blue beside it: ${r.colour}`); assert.ok(r.confidence > 0 && r.confidence <= 1);
});
test('openings in the strip are counted into storeys and windows per storey, roughly', () => {
  const open = new Uint8Array(100 * 100), box = (x0, y0) => { for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 6; x++) open[y * 100 + x] = 1; };
  for (const y of [10, 40, 70]) for (const x of [10, 40, 70]) box(x, y);
  const bl = blobs(open, 100, 100); assert.equal(bl.length, 9);
  assert.deepEqual(storeysAndWindows(bl), { storeys: 3, windowsPerStorey: 3 });
  assert.deepEqual(storeysAndWindows(bl.slice(0, 1)), { storeys: null, windowsPerStorey: null }, 'one blob says nothing');
});
test('a strip that is too small gives no facts', () => {
  const cam = camDefaults({ ...CAM, width: 400, height: 300 }), f = visibleFacades([B(1, ring(-0.5, -300, 0.5, -55))], cam);
  assert.deepEqual(f, []);
  const tiny = visibleFacades([B(1, ring(-1, -60, 1, -59), { h: 3 })], cam)[0];
  assert.equal(tiny === undefined || factsOfStrip(pic(cam), cam, tiny) === null, true);
});
test('posedFacts: one record per building, with sources; the most confident photograph wins', () => {
  const cam = camDefaults(CAM), b = B(7, ring(-5, -20, 5, -10)), shot = (id, cm) => ({ photo: { id }, cam: cm, rgba: pic(cm) });
  const out = posedFacts([b], [shot('p1', cam), shot('p2', { ...cam, x: 1 })]);
  assert.equal(out.length, 1); assert.equal(out[0].buildingId, 7); assert.deepEqual(out[0].sources.sort(), ['p1', 'p2']);
  for (const k of ['material', 'colour', 'accents', 'confidence']) assert.ok(k in out[0]);
});
