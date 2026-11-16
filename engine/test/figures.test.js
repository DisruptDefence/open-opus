// The threat figures (threats/figures): what each is made of, that it keeps its budget, and that it moves the way it
// should. Driven directly, with a flat ground and stand-in materials; the fight that drives them in the game is
// combat.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Vector3 } from '../vendor/three.module.js';
import { DEFAULT_PACK } from '../src/content/default.js';
import { createFigure, figureOf, figureTriangles } from '../src/threats/figures/index.js';
import { rayCapsule } from '../src/threats/threats.js';

const DT = 1 / 60;
function stubG(ground = () => 0) {
  const std = new MeshStandardMaterial();
  return {
    mats: { get: () => std, emissive: (c, k) => new MeshBasicMaterial({ color: c }) },
    physics: { groundHeight: (x, z) => ground(x, z), raycast: () => null },
    camera: new PerspectiveCamera(), fx: {}, render: {},
  };
}
const view = (o = {}) => ({ pos: new Vector3(), yaw: 0, vx: 0, vy: 0, vz: 0, alive: true, health: 1, engaged: false, target: null, aim: 'idle', melee: null, alert: false, crouch: 0, ...o });
/** Walk a figure straight ahead (-Z at yaw 0) at `speed` for `seconds`, calling `each(frame)` after every frame. */
function walk(f, speed, seconds, each = () => {}, ground = () => 0) {
  const v = view({ vz: -speed });
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    v.pos.z -= speed * DT; v.pos.y = ground(v.pos.x, v.pos.z);
    f.root.position.copy(v.pos); f.root.rotation.y = v.yaw; f.update(DT, v); each(i, v);
  }
  return v;
}

test('every archetype of the default pack names a figure the engine has', () => {
  for (const def of Object.values(DEFAULT_PACK.threats)) assert.ok(['person', 'quadruped', 'quadcopter', 'plain'].includes(figureOf(def)), def.id);
});

test('the machine rigs: one skinned mesh, one draw per material, a far tier of under a quarter of the triangles', () => {
  const G = stubG(), tris = figureTriangles(G);
  for (const kind of ['quadruped', 'quadcopter']) {
    const f = createFigure(G, DEFAULT_PACK.threats[kind === 'quadruped' ? 'crawler' : 'quadcopter'], 'a');
    assert.ok(f.mesh.isSkinnedMesh, kind);
    assert.deepEqual(f.mesh.material.length, f.mesh.geometry.groups.length, `${kind}: one group per material`);
    assert.ok(tris[kind].near <= 18000, `${kind} near ${tris[kind].near}`);
    assert.ok(tris[kind].far <= tris[kind].near / 4, `${kind} far ${tris[kind].far} of ${tris[kind].near}`);
    const before = f.mesh.geometry; f.setFar(true); assert.notEqual(f.mesh.geometry, before, 'the far tier swaps the geometry'); f.setFar(false); assert.equal(f.mesh.geometry, before);
  }
});

test('the four-legged machine walks with its feet planted: a foot on the ground does not slide, two always stand', () => {
  const G = stubG(), f = createFigure(G, DEFAULT_PACK.threats.crawler, 'w');
  let last = null, lastAir = new Set(), planted = 0, slid = 0, steps = 0, minStanding = 4;
  walk(f, 1.5, 4, () => {
    const now = f.feet().map((p) => p.clone()), air = new Set(f.swinging());
    if (air.size && !lastAir.size) steps++;
    minStanding = Math.min(minStanding, 4 - air.size);
    // a foot that was in the air in neither this frame nor the last stood still
    if (last) for (let k = 0; k < 4; k++) if (!air.has(k) && !lastAir.has(k)) { const d = now[k].distanceTo(last[k]); if (d < 1e-9) planted++; else slid++; }
    last = now; lastAir = air;
  });
  assert.ok(steps >= 8, `it stepped (${steps} pair steps in 4 s at 1.5 m/s)`);
  assert.equal(slid, 0, 'no planted foot moved');
  assert.ok(planted > 0); assert.ok(minStanding >= 2, 'a diagonal pair stands while the other swings');
  // and the body went where it was walked: its head is ahead of where it started, at its height
  assert.ok(f.headPos.z < -5 && f.headPos.y > 0.6 && f.headPos.y < 1.2, `head at ${f.headPos.toArray().map((v) => v.toFixed(2))}`);
});

test('a wrecked four-legged machine settles on its belly', () => {
  const G = stubG(), f = createFigure(G, DEFAULT_PACK.threats.crawler, 'd');
  walk(f, 0, 0.5); const standing = f.headPos.y;
  f.die(new Vector3(0, 0, -1));
  const v = view(); v.alive = false; for (let i = 0; i < 180; i++) f.update(DT, v);
  assert.ok(f.headPos.y < standing - 0.3, `head from ${standing.toFixed(2)} to ${f.headPos.y.toFixed(2)}`);
});

test('a quadcopter leans into its acceleration and its rotors turn', () => {
  const G = stubG(), f = createFigure(G, DEFAULT_PACK.threats.quadcopter, 'q'), v = view({ pos: new Vector3(0, 10, 0) });
  for (let i = 0; i < 30; i++) f.update(DT, v);
  const rotor = f.mesh.skeleton.bones.find((b) => b.name === 'rotor0'), r0 = rotor.rotation.y;
  for (let i = 0; i < 30; i++) { v.vz -= 6 * DT; v.pos.z += v.vz * DT; f.update(DT, v); } // speeding up forwards (-Z)
  assert.ok(f.state.pitch < -0.05 || f.state.pitch > 0.05, `pitched (${f.state.pitch.toFixed(3)})`);
  assert.notEqual(rotor.rotation.y, r0);
  const m = f.muzzle(new Vector3()); assert.ok(m.z < v.pos.z, 'the gun is at its front (-Z)');
});

test('a ray meets a capsule where it should', () => {
  const o = new Vector3(0, 1, 5), dir = new Vector3(0, 0, -1), a = { x: 0, y: 0.5, z: 0 }, b = { x: 0, y: 1.5, z: 0 };
  assert.ok(Math.abs(rayCapsule(o, dir, a, b, 0.2) - 4.8) < 1e-9);
  assert.equal(rayCapsule(new Vector3(0.3, 1, 5), dir, a, b, 0.2), null, 'beside it');
  assert.ok(Math.abs(rayCapsule(new Vector3(0, 1.6, 5), dir, a, b, 0.2) - (5 - Math.sqrt(0.04 - 0.01))) < 1e-9, 'over its round end');
  assert.equal(rayCapsule(o, dir, a, b, 0.2, 3), null, 'beyond the range');
});
