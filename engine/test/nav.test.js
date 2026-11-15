import test from 'node:test';
import assert from 'node:assert/strict';
import { createNav } from '../src/nav/navgrid.js';
import { loadTestScene } from './helpers.js';

test('nav on the test scene: walkable streets, closed buildings and cliff, paths go round', async () => {
  const { physics, terrain } = await loadTestScene();
  const nav = createNav({ physics, terrain, size: 200 });
  nav.build(20, 0);
  assert.ok(nav.isWalkable(20, -60), 'a street is walkable');
  const b = [...physics.solids].find((s) => s.ref && s.ref.hEave > 6 && s.min.x > 30 && s.min.z > 40 && s.max.x < 110);
  assert.ok(!nav.isWalkable((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2), 'inside a building is not');
  // round the garden wall (x = -4, z in -15..15): from one side to the other
  const a = { x: 6, y: 0, z: 0 }, c = { x: -10, y: 0, z: 0 };
  assert.equal(nav.clearLine(a, c), false);
  const path = nav.findPath(a, c);
  assert.ok(path && path.length >= 3, 'a path exists and bends');
  let len = 0; for (let i = 1; i < path.length; i++) { len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); assert.ok(nav.clearLine(path[i - 1], path[i]), 'each leg is clear'); }
  assert.ok(len > 30 && len < 80, `length ${len.toFixed(1)} m`);
  assert.ok(nav.coverNear({ x: 20, z: 0 }, 40).length > 0, 'cover points exist near the square');
  const p = nav.randomPoint({ x: 20, z: 0 }, 30, () => 0.37);
  assert.ok(p && nav.isWalkable(p.x, p.z));
  // the window follows the action
  assert.equal(nav.recenter(25, 5), false); assert.equal(nav.recenter(120, 0), true);
  // the cliff face is closed, so there is no path straight down it, but the ramp connects the two towns
  nav.build(-120, 100);
  assert.ok(!nav.isWalkable(-120, 60), 'the cliff face is closed');
  const down = nav.findPath({ x: -100, y: 0, z: 100 }, { x: -150, y: 0, z: 100 });
  assert.ok(down, 'there is a way down');
  assert.ok(down.some((q) => q.z > 104), 'and it goes by the ramp, not down the face');
});
