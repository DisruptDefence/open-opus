// Landmarks from building parts (docs/plans/SCENE-DETAIL.md item 9). The engine's side is the reader and the mesher,
// built by item 3: an outline whose parts draw it is skipped, a part is walled, roofed and solid from its own
// minimum height. Item 9 writes the data (tools/scene_builder/parts.py) and adds round roofs to gen/roof.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonSource } from '../src/scene/source.js';
import { cellSoups } from '../src/gen/mesher.js';
import { fixture, installAll, vertices } from './helpers.js';

test('a building drawn from its parts: no outline, each part from its own base to its own top, in the drawing and in the collision', async () => {
  const { chunks, physics } = await installAll(jsonSource(fixture('scene-new')));
  const all = [...chunks.values()], buildings = all.flatMap((c) => c.chunk.buildings);
  assert.ok(!buildings.some((b) => b.name === 'Outline'));
  const wing = buildings.find((b) => b.id === 77004), tower = buildings.find((b) => b.id === 77005);
  assert.ok(wing.part && tower.part); assert.equal(wing.yBase, tower.yBase, 'parts of one building share its ground');
  for (const b of [wing, tower]) {
    const { chunk, env } = all.find((c) => c.chunk.buildings.includes(b)), cell = chunk.cells.find((c) => c.buildings.includes(b)), only = { ...cell, buildings: [b], trees: [], walls: [], roads: [], props: [], crossings: [] };
    const ys = ['base', 'far'].flatMap((g) => vertices(cellSoups(only, g, env))).map((v) => v[1]);
    assert.ok(Math.abs(Math.max(...ys) - (b.yBase + b.hEave + b.hRoof)) < 1e-6, 'the top of the roof is the record\'s height'); assert.ok(Math.min(...ys) >= b.yMin - 0.5 - 1e-6, 'nothing is drawn below the part\'s base');
    const solid = [...physics.solids].find((s) => s.ref === b);
    assert.equal(solid.max.y, b.yBase + b.hEave + b.hRoof); assert.equal(solid.min.y, b === tower ? b.yMin : b.yBase - 3, 'a floating part is solid from its base, a standing one from below the ground');
  }
});
for (const t of ['a tower part inside a wing gets a pyramidal roof and the outline\'s façade (builder)', 'a ring within 10 % of a circle with 8 or more vertices gets a cone; cone and dome meet at the apex',
  'on the scene: the hotel\'s outline is skipped and its parts have at least 4 distinct heights']) test.todo('item 9: ' + t);
