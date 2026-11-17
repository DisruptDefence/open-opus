// The collision audit (tools/collision-audit.mjs): the walk and detail checks assert on real scenes; the pair checks
// assert on fixtures with one planted fault each, and are reported (not asserted) on the published scene by the tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics } from '../src/physics/physics.js';
import { jsonSource } from '../src/scene/source.js';
import { loadTestScene, fixture } from './helpers.js';
import { openHeadlessWorld } from './headless.js';
import { walkAudit, overlapAudit, insideAudit, slotAudit, solidSignature, sameSignature, solidAt } from '../tools/collision-audit.mjs';

function field() {
  const n = 101, terrain = createTerrain();
  terrain.addTile(0, -1, createGrid({ nx: n, nz: n, cell: 1, minX: 0, minZ: 0, data: new Float32Array(n * n) }));
  return createPhysics({ terrain, bounds: { min: { x: 2, y: -10, z: 2 }, max: { x: 98, y: 100, z: 98 } } });
}
const sq = (x, z, w, d = w) => [x, z, x + w, z, x + w, z + d, x, z + d];
const building = (id) => ({ id, hEave: 6, hRoof: 0 }), tree = () => ({ crownRadius: 2 }), prop = () => ({ yaw: 0, variant: 0 });

test('walks on the test scene: no frame has the body inside a solid', async () => {
  const { physics } = await loadTestScene();
  const r = walkAudit(physics, { seed: 7 });
  assert.equal(r.frames, 2 * 16 * 1800); assert.equal(r.walks, 32);
  assert.equal(r.inside, 0, JSON.stringify(r.samples));
});
test('the walk check sees a body inside a solid when collision is broken', () => {
  const physics = field(); physics.addPrism(sq(20, 20, 60), -3, 8, { ref: building(1) });
  assert.equal(walkAudit(physics, { seed: 3, walks: 8, seconds: 20 }).inside, 0, 'real physics keeps walkers out');
  const ghost = { ...physics, moveCapsule: (pos, vel, dt) => { pos.x += vel.x * dt; pos.z += vel.z * dt; pos.y += vel.y * dt; if (pos.y < 0) { pos.y = 0; vel.y = 0; } return { onGround: pos.y <= 0 }; } };
  const bad = walkAudit(ghost, { seed: 3, walks: 8, seconds: 20, from: () => [10, 50] });
  assert.ok(bad.inside > 0 && bad.samples.length > 0, 'planted fault is counted');
});
test('the walk check ignores bullet-only solids, a roof overhead and a body standing on top', () => {
  const physics = field();
  physics.addPrism(sq(20, 20, 20), -3, 8, { bulletOnly: true }); physics.addPrism(sq(50, 50, 20), 3, 8); physics.addBox({ x: 70, y: -1, z: 70 }, { x: 80, y: 1, z: 80 });
  assert.equal(solidAt(physics, 30, 30, 0), null); assert.equal(solidAt(physics, 60, 60, 0), null); assert.equal(solidAt(physics, 75, 75, 1), null);
  assert.ok(solidAt(physics, 75, 75, 0));
});
test('pairs: two prisms of different buildings that overlap are found; touching ones and one building are not', () => {
  const physics = field();
  physics.addPrism(sq(10, 10, 10), -3, 8, { ref: building(1) }); physics.addPrism(sq(18, 12, 10), -3, 8, { ref: building(2) }); // 2 m deep
  physics.addPrism(sq(40, 10, 10), -3, 8, { ref: building(3) }); physics.addPrism(sq(50, 10, 10), -3, 8, { ref: building(4) }); // sharing a face
  const five = building(5); physics.addPrism(sq(10, 40, 10), -3, 8, { ref: five }); physics.addPrism(sq(15, 40, 10), -3, 8, { ref: five }); // one record
  physics.addPrism(sq(10, 70, 10), -3, 8, { ref: building(6) }); physics.addPrism(sq(12, 72, 4), 9, 12, { ref: building(7) });      // above it
  const r = overlapAudit(physics); assert.equal(r.count, 1, JSON.stringify(r.pairs)); assert.deepEqual([r.pairs[0].a, r.pairs[0].b].sort(), [1, 2]);
  assert.equal(r.byKind['building+building'], 1);
});
test('a tree or a prop inside a building is found; one beside it is not', () => {
  const physics = field(); physics.addPrism(sq(10, 10, 20), -3, 8, { ref: building(1) });
  physics.addPrism(sq(19.8, 19.8, 0.4), -1, 4, { ref: tree() }); physics.addPrism(sq(14.8, 14.8, 0.4), -1, 1, { ref: prop() }); physics.addPrism(sq(40, 40, 0.4), -1, 4, { ref: tree() });
  const r = insideAudit(physics); assert.deepEqual(r.found.map((f) => f.kind).sort(), ['prop', 'tree']);
});
test('a slot between two buildings narrower than 0.8 m is found; wider, touching and raised ones are not', () => {
  const physics = field();
  physics.addPrism(sq(10, 10, 10), -3, 8, { ref: building(1) }); physics.addPrism(sq(20.5, 10, 10), -3, 8, { ref: building(2) });  // 0.5 m
  physics.addPrism(sq(10, 40, 10), -3, 8, { ref: building(3) }); physics.addPrism(sq(21, 40, 10), -3, 8, { ref: building(4) });    // 1 m
  physics.addPrism(sq(10, 60, 10), -3, 8, { ref: building(5) }); physics.addPrism(sq(20, 60, 10), -3, 8, { ref: building(6) });    // touching
  physics.addPrism(sq(60, 10, 10), -3, 8, { ref: building(7) }); physics.addPrism(sq(70.4, 10, 10), 5, 8, { ref: building(8) });   // 0.4 m but raised
  const r = slotAudit(physics); assert.equal(r.count, 1, JSON.stringify(r.found)); assert.equal(r.found[0].gap, 0.5);
});
test('the solids installed are the same whatever the detail radius', async () => {
  const sig = async (detail) => { const { world, engine } = openHeadlessWorld(jsonSource(fixture('scene-new')), { x: 20, z: -30, detail }); await world.ready(); return solidSignature(engine().G.physics); };
  const near = await sig(0), wide = await sig(400);
  assert.ok(near.stats.solids > 0); assert.ok(sameSignature(near, wide), 'same solids at detail 0 and 400');
  const gone = { ...wide, stats: { ...wide.stats, solids: wide.stats.solids - 1 }, rings: wide.rings.slice(1) };
  assert.ok(!sameSignature(near, gone), 'a missing solid is seen');
});
