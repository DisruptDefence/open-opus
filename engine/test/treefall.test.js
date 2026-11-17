// A tree breaks under fire (src/world/treefall.js): damage per tree from trunk hits only, the hit-point formula, the event once,
// a felled tree stays felled when its cell is rebuilt or its chunk comes back, other trees are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonSource } from '../src/scene/source.js';
import { cellSoups } from '../src/gen/mesher.js';
import { SOUP } from '../src/gen/style.js';
import { treeId, trunkRadius } from '../src/gen/trees.js';
import { treeHp, breakHeight, FALL_SECONDS } from '../src/world/treefall.js';
import { fixture, installAll } from './helpers.js';
import { openHeadlessWorld } from './headless.js';

const RIFLE = 26;
async function setup() {
  const h = openHeadlessWorld(jsonSource(fixture('scene-new')), { x: -60, z: 80 }); await h.world.ready();
  const G = h.engine().G, V = (x, y, z) => new G.THREE.Vector3(x, y, z);
  const felled = []; h.world.on('tree:felled', (e) => felled.push(e));
  const trees = () => G.level.manifest && [...G.physics.solids].filter((s) => s.kind === 'tree').map((s) => s.ref);
  const treeAt = (x, z) => trees().find((t) => Math.abs(t.x - x) < 0.5 && Math.abs(t.z - z) < 0.5);
  /** One round at height `up` m above the ground, from 10 m south of the tree's trunk. */
  const shoot = (t, up) => { const y = G.terrain.height(t.x, t.z) + up; return G.combat.playerShot(V(t.x, y, t.z + 10), V(0, 0, -1), { damage: RIFLE }); };
  return { ...h, G, felled, trees, treeAt, shoot };
}

test('hit points: 12 + 90 * trunk radius * 10', () => {
  const h = (0.15 - 0.1) / 0.013;                         // the height whose trunk is 0.15 m
  assert.ok(Math.abs(trunkRadius(h) - 0.15) < 1e-9);
  assert.ok(Math.abs(treeHp({ height: h }) - 147) < 1e-6, 'a 0.15 m trunk takes 147');
  assert.ok(Math.abs(treeHp({ height: 12 }) - (12 + 900 * trunkRadius(12))) < 1e-9);
  assert.ok(treeHp({ height: 20 }) > treeHp({ height: 8 }));
  for (let i = 0; i < 20; i++) { const b = breakHeight({ x: i * 3.7, z: i * 1.3, height: 12 }); assert.ok(b >= 0.6 && b <= 1.1, `${b}`); }
});

test('damage adds up on the tree that was hit and only for trunk hits; a crown hit does nothing', async () => {
  const s = await setup(), a = s.treeAt(-60, 80), b = s.treeAt(-70, 90);
  assert.ok(a && b);
  const impacts = []; s.G.events.on('impact', (e) => impacts.push(e));
  s.shoot(a, 1.0); s.shoot(a, 1.0); s.shoot(b, 1.0);
  assert.equal(s.G.treefall.damageOf(a), 2 * RIFLE); assert.equal(s.G.treefall.damageOf(b), RIFLE);
  assert.equal(impacts.length, 3, 'every hit leaves the impact');
  const before = s.G.treefall.damageOf(a), hit = s.shoot(a, a.height * 0.9);       // through the leaves: no solid, nothing taken
  assert.equal(s.G.treefall.damageOf(a), before);
  assert.ok(!hit || hit.surface !== 'wood' || hit.point.z < a.z - 1, 'the round went on past the crown');
  s.shoot(a, -5);                                                                  // under the ground: no trunk hit either
});

test('the tree falls when its hit points are gone, once, with the event, and keeps a stump', async () => {
  const s = await setup(), a = s.treeAt(-60, 80), hp = treeHp(a), rounds = Math.ceil(hp / RIFLE);
  for (let i = 0; i < rounds - 1; i++) s.shoot(a, 1.0);
  assert.equal(s.felled.length, 0); assert.ok(!s.G.treefall.isFelled(a));
  s.shoot(a, 0.4);
  assert.equal(s.felled.length, 1); assert.deepEqual(s.felled[0], { id: treeId(a), x: a.x, z: a.z });
  assert.ok(s.G.treefall.isFelled(a)); assert.ok(a.fell && a.fell.h >= 0.6 && a.fell.h <= 1.1);
  for (let i = 0; i < 6; i++) s.shoot(a, 0.3);                                     // the stump is still hit: nothing more happens
  assert.equal(s.felled.length, 1, 'the event fires once');
  const gy = s.G.terrain.height(a.x, a.z), V = (x, y, z) => new s.G.THREE.Vector3(x, y, z), D = V(0, 0, -1);
  assert.ok(s.G.physics.raycast(V(a.x, gy + a.fell.h * 0.5, a.z + 5), D, 20), 'the stump still stops a shot below the break');
  assert.ok(!s.G.physics.raycast(V(a.x, gy + a.fell.h + 0.5, a.z + 5), D, 20), 'and nothing is solid above it');
  // the top turns about the break point, away from the shooter (the shots came from the south: it falls north, to -z), and stays
  const top = s.G.level.root.children.find((c) => c.name === `fallen ${treeId(a)}`); assert.ok(top, 'a standalone mesh for the fallen top');
  s.G.treefall.update(0.2); const early = top.quaternion.angleTo(top.quaternion.clone().identity());
  s.G.treefall.update(FALL_SECONDS); const end = top.quaternion.angleTo(top.quaternion.clone().identity());
  assert.ok(early < 0.3 * end, 'it eases in'); assert.ok(end > 1.4 && end < 1.9, `it lies down: ${end}`);
  const tip = new s.G.THREE.Vector3(0, a.height - a.fell.h, 0).applyQuaternion(top.quaternion);
  assert.ok(tip.z < -3, `the crown lies to the north, away from the shooter: ${tip.z}`);
  s.G.treefall.update(5); assert.equal(s.G.treefall.stats().falling, 0); assert.ok(top.parent, 'the fallen tree stays');
});

test('a felled tree is skipped when its cell is rebuilt, and stays felled when its chunk comes back', async () => {
  const s = await setup(), a = s.treeAt(-60, 80);
  assert.ok(s.G.level.stats().chunksLive >= 1 && s.G.level.fellTree);
  const treeSoup = (cell, env) => { const m = cellSoups(cell, 'near', env).map.get(SOUP.leaves); return m ? m.pos.length / 9 : 0; };
  const src = jsonSource(fixture('scene-new')), man = src.manifest, all = await installAll(src);
  const ce = man.grid.ce(a.x), cn = man.grid.cn(a.z), { chunk: data, env } = all.chunks.get(man.grid.key(ce, cn)), cell = data.cells.find((c) => c.trees.some((t) => t.x === a.x && t.z === a.z));
  assert.ok(cell, 'the tree is in a cell');
  const whole = treeSoup(cell, env); assert.ok(whole > 100);
  for (let i = 0; i < Math.ceil(treeHp(a) / RIFLE); i++) s.shoot(a, 1.0);
  assert.ok(a.fell);
  // a fresh decode of the chunk (what happens when it is released and fetched again) is restored from the session's felled set
  const again = await src.chunk(ce, cn), t2 = again.trees.find((t) => t.x === a.x && t.z === a.z); assert.ok(t2 && !t2.fell);
  s.G.treefall.restore(again.trees); assert.deepEqual(t2.fell, a.fell, 'felled again after a reload');
  const cell2 = again.cells.find((c) => c.trees.includes(t2)), after = treeSoup(cell2, env);
  assert.ok(after < whole && whole - after > 100, `the felled tree's crown is no longer meshed: ${whole} -> ${after}`);
  assert.ok(cellSoups(cell2, 'far', env).map.get(SOUP.trunk).pos.length > 0, 'a stump is still drawn far');
});

test('a tree in another cell is untouched', async () => {
  const s = await setup(), a = s.treeAt(-60, 80), far = s.treeAt(160, -100);
  assert.ok(far, 'the far tree is installed'); const solid = [...s.G.physics.solids].find((q) => q.ref === far), top = solid.max.y;
  for (let i = 0; i < Math.ceil(treeHp(a) / RIFLE); i++) s.shoot(a, 1.0);
  assert.ok(a.fell); assert.equal(far.fell, undefined); assert.equal(s.G.treefall.damageOf(far), 0);
  assert.equal([...s.G.physics.solids].find((q) => q.ref === far).max.y, top, 'its collider is as it was');
  assert.equal(s.felled.length, 1);
});
