import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics, STEP } from '../src/physics/physics.js';
import { loadTestScene, walk } from './helpers.js';

function flat(f = () => 0) {
  const n = 101, d = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d[j * n + i] = f(-50 + i, -50 + j);
  const terrain = createTerrain({ chunk: 100 }); terrain.addTile(-1, -1, createGrid({ nx: n, nz: n, cell: 1, minX: -100, minZ: -100, data: new Float32Array(n * n) }));
  for (const [cx, cz] of [[0, 0], [-1, 0], [0, -1]]) terrain.addTile(cx, cz, createGrid({ nx: n, nz: n, cell: 1, minX: cx * 100, minZ: cz * 100, data: new Float32Array(n * n).map((_, k) => f(cx * 100 + (k % n), cz * 100 + ((k / n) | 0))) }));
  return { terrain, physics: createPhysics({ terrain }) };
}

test('a walker is stopped by a wall at any angle and slides along it', () => {
  const { physics } = flat();
  // a wall at 45 degrees across the path
  physics.addPrism([10, 0, 30, 20, 29, 21, 9, 1], -1, 3);
  const r = walk(physics, { x: 5, y: 0, z: 5 }, 1, 0, 4, 4);
  assert.ok(r.pos.x < 30 && r.pos.z > 5.5, `slid along the wall: ${r.pos.x.toFixed(2)}, ${r.pos.z.toFixed(2)}`);
  // never inside it: distance from the wall's near face is at least the radius
  const d = Math.abs((r.pos.x - 10) - (r.pos.z - 0)) / Math.SQRT2;
  assert.ok(d >= 0.31, `clear of the wall by ${d.toFixed(3)}`);
});
test('steps are climbed, a high ledge is not, and a ledge can be found for mantling', () => {
  const { physics } = flat();
  for (let i = 0; i < 6; i++) physics.addBox({ x: 10 + i * 0.4, y: -1, z: 0 }, { x: 10.4 + i * 0.4, y: (i + 1) * 0.25, z: 4 });
  physics.addBox({ x: 12.4, y: -1, z: 0 }, { x: 20, y: 1.5, z: 4 });
  const up = walk(physics, { x: 5, y: 0, z: 2 }, 1, 0, 3, 5);
  assert.ok(Math.abs(up.pos.y - 1.5) < 0.01 && up.pos.x > 13, `climbed the stair to ${up.pos.y.toFixed(2)} at x ${up.pos.x.toFixed(2)}`);
  physics.addBox({ x: 30, y: -1, z: 0 }, { x: 34, y: 1.2, z: 4 });
  const no = walk(physics, { x: 25, y: 0, z: 2 }, 1, 0, 3, 4);
  assert.ok(no.pos.x < 30 - 0.3 && no.pos.y === 0, 'a 1.2 m ledge is not walked up');
  const ledge = physics.ledgeAhead(no.pos, 1, 0, 0.32, 1.8);
  assert.ok(ledge && Math.abs(ledge.y - 1.2) < 1e-6, 'but it is found as a ledge to mantle');
  assert.equal(physics.ledgeAhead({ x: 5, y: 0, z: 2 }, 0, 1, 0.32, 1.8), null);
  assert.ok(STEP < 1.2);
});
test('rays hit prisms, their tops and the ground; line of sight follows', () => {
  const { physics } = flat();
  const s = physics.addPrism([10, -5, 12, -5, 12, 5, 10, 5], 0, 4, { surface: 'brick' });
  const h = physics.raycast({ x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 100);
  assert.ok(Math.abs(h.dist - 10) < 1e-6 && h.box === s && h.surface === 'brick' && h.normal.x === -1);
  const top = physics.raycast({ x: 11, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
  assert.ok(Math.abs(top.dist - 6) < 1e-6 && top.normal.y === 1);
  const ground = physics.raycast({ x: 0, y: 2, z: 20 }, { x: 0.6, y: -0.8, z: 0 }, 100);
  assert.ok(Math.abs(ground.dist - 2.5) < 0.01 && ground.box === null);
  assert.equal(physics.raycast({ x: 0, y: 6, z: 0 }, { x: 1, y: 0, z: 0 }, 100), null);
  assert.equal(physics.lineOfSight({ x: 0, y: 1.5, z: 0 }, { x: 20, y: 1.5, z: 0 }), false);
  assert.equal(physics.lineOfSight({ x: 0, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }), true);
  physics.remove(s);
  assert.equal(physics.lineOfSight({ x: 0, y: 1.5, z: 0 }, { x: 20, y: 1.5, z: 0 }), true);
});
test('a far ray crosses many cells and still finds a small solid', () => {
  const { physics } = flat();
  physics.addBox({ x: -80, y: 0, z: -61 }, { x: -79, y: 3, z: -60 });
  const d = Math.hypot(80 + 40, 60.5 + 30), h = physics.raycast({ x: 40, y: 1, z: 30 }, { x: (-79.5 - 40) / d, y: 0, z: (-60.5 - 30) / d }, 400);
  assert.ok(h && h.dist > 140 && h.dist < 152, `hit at ${h && h.dist}`);
});

test('on the test scene: up the ramp, held at the cliff edge, stopped by a building, never through the ground', async () => {
  const { physics, terrain } = await loadTestScene();
  // 1. the ramp street climbs the cliff: from the low town at x = -185 to the high town at x = -70, 26 m of rise
  const y0 = terrain.height(-185, 140);
  const ramp = walk(physics, { x: -185, y: y0, z: 140 }, 1, 0, 3.8, 34);
  assert.ok(ramp.pos.x > -75 && ramp.pos.y - y0 > 15, `climbed ${(ramp.pos.y - y0).toFixed(1)} m to x ${ramp.pos.x.toFixed(1)}`);
  assert.ok(ramp.grounded && ramp.minClear > -0.01, `stayed on the ground (lowest clearance ${ramp.minClear.toFixed(3)})`);
  // 2. the same walk at the cliff face is refused: 26 m in 6 m is not a slope
  const face = walk(physics, { x: -140, y: terrain.height(-140, 0), z: 0 }, 1, 0, 3.8, 10);
  assert.ok(face.pos.x < -121 && face.blocked === 'slope', `stopped at the foot at x ${face.pos.x.toFixed(1)} (${face.blocked})`);
  // 3. from the top, walking west: the parapet wall first; from beyond it, the edge itself holds the walker
  const top = walk(physics, { x: -100, y: terrain.height(-100, 100), z: 100 }, -1, 0, 3.8, 10);
  assert.ok(top.pos.x > -116 && top.pos.y > 28, `held at the parapet at x ${top.pos.x.toFixed(1)}`);
  const lip = walk(physics, { x: -117.3, y: terrain.height(-117.3, 0), z: 0 }, -1, 0, 3.8, 10);
  assert.ok(lip.pos.x > -121.5 && lip.pos.y > 20 && lip.blocked === 'edge', `held at the edge at x ${lip.pos.x.toFixed(2)}, y ${lip.pos.y.toFixed(1)} (${lip.blocked})`);
  // 4. a building stops a walker on the street
  const b = [...physics.solids].find((s) => s.ref && s.ref.hEave > 6 && s.min.x > 30 && s.min.z > 40);
  const cx = (b.min.x + b.max.x) / 2, start = { x: cx, y: terrain.height(cx, b.min.z - 6), z: b.min.z - 6 };
  const hit = walk(physics, start, 0, 1, 3.8, 6);
  assert.ok(hit.pos.z < b.min.z + 0.5 && hit.pos.z > b.min.z - 1.5, `stopped at the wall: z ${hit.pos.z.toFixed(2)} against ${b.min.z.toFixed(2)}`);
  // 5. dropped from the air anywhere, a body lands on the ground or on a roof and stays there
  let s = 7;
  for (let i = 0; i < 60; i++) {
    s = (s * 16807) % 2147483647; const x = -440 + (s % 880); s = (s * 16807) % 2147483647; const z = -440 + (s % 880);
    const pos = { x, y: terrain.height(x, z) + 40, z }, vel = { x: 0, y: 0, z: 0 }; let g = false;
    for (let t = 0; t < 400 && !g; t++) { vel.y -= 21 / 60; g = physics.moveCapsule(pos, vel, 1 / 60, 0.32, 1.8, false).onGround; }
    assert.ok(g && pos.y >= terrain.height(x, z) - 1e-3, `landed at ${x},${z}: y ${pos.y.toFixed(2)} over ground ${terrain.height(x, z).toFixed(2)}`);
  }
  // 6. the stair on the square is climbed
  const st = walk(physics, { x: 58, y: terrain.height(58, -24), z: -24 }, 1, 0, 3, 4);
  assert.ok(st.pos.y - terrain.height(58, -24) > 1.7, `up the stair by ${(st.pos.y - terrain.height(58, -24)).toFixed(2)} m`);
});
