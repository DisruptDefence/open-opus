import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, createTerrain } from '../src/terrain/heightfield.js';
import { chunkGrid } from '../src/scene/grid.js';

// a 20 m chunk grid anchored at the origin: the chunk (0, -1) covers x in [0, 20) and z in (0, 20]
const grid = chunkGrid(0, 0, 20);

const plane = (nx, nz, cell, minX, minZ, f) => { const d = new Float32Array(nx * nz); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = f(minX + i * cell, minZ + j * cell); return createGrid({ nx, nz, cell, minX, minZ, data: d }); };

test('a grid interpolates between samples and clamps outside', () => {
  const g = plane(11, 11, 2, 0, 0, (x, z) => x * 0.5 + z * 0.25);
  assert.ok(Math.abs(g.height(3.3, 7.1) - (3.3 * 0.5 + 7.1 * 0.25)) < 1e-5);
  assert.equal(g.height(-5, 0), 0);
  assert.ok(Math.abs(g.height(100, 20) - (20 * 0.5 + 20 * 0.25)) < 1e-5);
});
test('tiles answer where loaded, the far grid elsewhere, NaN when detail is required', () => {
  const t = createTerrain({ grid, far: plane(5, 5, 10, 0, 0, () => 7) });
  t.addTile(0, -1, plane(11, 11, 2, 0, 0, (x) => x));
  assert.ok(Math.abs(t.height(5, 5) - 5) < 1e-6);
  assert.equal(t.height(30, 5), 7);
  assert.ok(Number.isNaN(t.height(30, 5, true)));
  assert.ok(Number.isNaN(t.height(300, 5)));
  assert.ok(t.loaded(5, 5) && !t.loaded(30, 5));
  t.removeTile(0, -1);
  assert.equal(t.height(5, 5), 7);
});
test('slope and normal of a 45 degree plane', () => {
  const t = createTerrain({ grid }); t.addTile(0, -1, plane(11, 11, 2, 0, 0, (x) => x));
  assert.ok(Math.abs(t.slope(10, 10) - 1) < 1e-5);
  const n = t.normal(10, 10);
  assert.ok(Math.abs(n.x + Math.SQRT1_2) < 1e-5 && Math.abs(n.y - Math.SQRT1_2) < 1e-5);
});
test('a ray finds the ground and misses when it clears it', () => {
  const t = createTerrain({ grid }); t.addTile(0, -1, plane(11, 11, 2, 0, 0, (x) => (x > 10 ? 6 : 0)));
  const hit = t.raycast(2, 3, 5, 1, 0, 0, 50); // level ray at y = 3 towards the 6 m step between x = 10 and 12
  assert.ok(hit && hit.x > 10.5 && hit.x < 11.5, JSON.stringify(hit));
  assert.equal(t.raycast(2, 8, 5, 1, 0, 0, 15), null);
  const down = t.raycast(4, 10, 4, 0, -1, 0, 50);
  assert.ok(Math.abs(down.dist - 10) < 0.01);
});

test('a lift raster raises the ground it covers; the base height ignores it', () => {
  const flat = new Float32Array(11 * 11).fill(5), lift = new Uint8Array(20 * 20); lift[3 * 20 + 7] = 14; // the 1 m cell x 7..8, z 3..4
  const g = createGrid({ nx: 11, nz: 11, cell: 2, minX: 0, minZ: 0, data: flat, lift, liftCell: 1, liftN: 20 });
  assert.ok(Math.abs(g.height(7.5, 3.5) - 5.14) < 1e-6); assert.equal(g.height(8.5, 3.5), 5); assert.equal(g.height(7.5, 4.5), 5); assert.equal(g.baseHeight(7.5, 3.5), 5);
  assert.equal(g.height(-3, -3), 5, 'outside the raster nothing is added');
  const plain = createGrid({ nx: 11, nz: 11, cell: 2, minX: 0, minZ: 0, data: flat }); assert.equal(plain.height(7.5, 3.5), plain.baseHeight(7.5, 3.5));
  const t = createTerrain({ grid }); t.addTile(0, -1, g); assert.ok(Math.abs(t.height(7.5, 3.5) - 5.14) < 1e-6, 'the terrain reports the lifted ground');
});
