// The ground of a street (src/gen/ground.js; docs/plans/SCENE-DETAIL.md item 6). What holds for any ground generator
// that keeps the contract; item 6 adds the plan's tests of drape, ribbons, the lift raster, steps and crossings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drape, roadRibbons, steps, crossing, liftRaster } from '../src/gen/ground.js';
import { cellSoups } from '../src/gen/mesher.js';
import { jsonSource } from '../src/scene/source.js';
import { fixture, installAll, vertices } from './helpers.js';

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
for (const t of ['drape: flat tile, ramp, bumpy tile: every vertex on the terrain triangle under it, plan area kept', 'a 20 x 6 road with sidewalks both sides: areas 120 and 64, sidewalk top at 0.14, vertical kerbs',
  'liftRaster: 14 in the sidewalk strip, 0 on the carriageway and beyond; terrain.height on the sidewalk equals the drawn top', 'a 90 degree bend leaves no gap at the joint',
  'steps over 3.4 m with 12 … 20 treads: equal risers, every tread within one riser of the ground', 'a road cut by two cells draws the same dashes and treads either side (s0)',
  'physics: a capsule steps down the kerb and up again, and climbs the steps road']) test.todo('item 6: ' + t);
