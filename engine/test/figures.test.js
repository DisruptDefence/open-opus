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

// ---- the person ------------------------------------------------------------------------------------------------
const person = (id = 'p', kind = 'sentry') => createFigure(stubG(), DEFAULT_PACK.threats[kind], id);

test('the person: within budget (near 6 500, far 1 500 triangles), one draw per material, looks that differ by id', () => {
  const G = stubG(), tris = figureTriangles(G);
  for (const k of ['person-helmet', 'person-cap']) { assert.ok(tris[k].near <= 6500, `${k} near ${tris[k].near}`); assert.ok(tris[k].far <= 1500, `${k} far ${tris[k].far}`); }
  const f = person(); assert.ok(f.mesh.isSkinnedMesh); assert.equal(f.mesh.material.length, f.mesh.geometry.groups.length); assert.ok(f.mesh.skeleton.bones.length >= 17);
  const geos = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => createFigure(G, DEFAULT_PACK.threats.patrol, id).mesh.geometry));
  assert.ok(geos.size >= 2, `${geos.size} looks among eight patrol members`);
});

test('the person walks and runs with its feet planted: a walk always has a foot down, a run has moments in the air', () => {
  for (const speed of [1.4, 4.5]) {
    const f = person('w' + speed);
    let last = null, lastAir = [], slid = 0, steps = 0, both = 0, minHip = 9, maxHip = 0, kneeAhead = 0, frames = 0;
    walk(f, speed, 3, (i, v) => {
      const now = f.feet().map((p) => p.clone()), air = f.swinging();
      if (air.length && air[0] !== lastAir[0]) steps++; if (air.length > 1) both++;
      if (last) for (let k = 0; k < 2; k++) if (!air.includes(k) && !lastAir.includes(k) && now[k].distanceTo(last[k]) > 1e-9) slid++;
      const j = f.joints(), hip = j.hipC.y - v.pos.y; minHip = Math.min(minHip, hip); maxHip = Math.max(maxHip, hip);
      // knees bend forwards: the knee is ahead of the line from hip to ankle
      for (const s of ['L', 'R']) { const mid = j['hip' + s].clone().lerp(j['an' + s], 0.5); if (j['kn' + s].z <= mid.z + 1e-4) kneeAhead++; } frames++;
      last = now; lastAir = air;
    });
    const cadence = steps / 3;
    assert.equal(slid, 0, `${speed} m/s: no standing foot slid`);
    if (speed < 2) assert.equal(both, 0, `${speed} m/s: never both feet in the air`); else assert.ok(both > 0, `${speed} m/s: both feet off the ground at times`);
    assert.ok(cadence > 1.4 && cadence < 4, `${speed} m/s: ${cadence.toFixed(1)} steps a second`);
    assert.ok(minHip > (speed < 2 ? 0.78 : 0.65) && maxHip < 0.96, `${speed} m/s: hips between ${minHip.toFixed(2)} and ${maxHip.toFixed(2)} m`);
    assert.equal(kneeAhead, frames * 2, 'knees bend forwards');
  }
});

test('the person on a slope keeps its feet on the ground under them', () => {
  const ground = (x, z) => -z * 0.15, G = stubG(ground), f = createFigure(G, DEFAULT_PACK.threats.sentry, 's');
  let worst = 0;
  walk(f, 1.4, 3, () => { const air = f.swinging(); f.feet().forEach((p, k) => { if (!air.includes(k)) worst = Math.max(worst, Math.abs(p.y - 0.085 - ground(p.x, p.z))); }); }, ground);
  assert.ok(worst < 0.02, `a standing foot is ${worst.toFixed(3)} m off the slope`);
});

test('the person aims: the rifle comes up to the shoulder and points at the target', () => {
  const f = person('a'), v = view({ engaged: true, alert: true, aim: 'tele', target: new Vector3(0, 0, -12) });
  for (let i = 0; i < 60; i++) f.update(DT, v);
  const m = f.muzzle(new Vector3()), j = f.joints(), dir = m.clone().sub(j.grip).normalize(), want = new Vector3(0, 1.25, -12).sub(j.grip).normalize();
  assert.ok(dir.dot(want) > 0.985, `the rifle points ${(Math.acos(Math.min(1, dir.dot(want))) * 57.3).toFixed(1)}° off the target`);
  assert.ok(j.grip.y > 1.2, `grip at ${j.grip.y.toFixed(2)} m: in the shoulder`);
  assert.ok(j.wrL.distanceTo(j.grip) < 0.45 && j.wrR.distanceTo(j.grip) < 0.12, 'both hands on the rifle');
  v.aim = 'idle'; v.engaged = false; v.alert = false; v.target = null; for (let i = 0; i < 90; i++) f.update(DT, v);
  assert.ok(f.joints().grip.y < 1.2, 'lowered on patrol');
});

test('the person crouches lower and falls down dead, lying on the ground with its rifle beside it', () => {
  const f = person('c'), v = view({ crouch: 1 });
  for (let i = 0; i < 60; i++) f.update(DT, v);
  assert.ok(f.joints().headC.y < 1.3, `crouched head at ${f.joints().headC.y.toFixed(2)}`);
  v.crouch = 0; for (let i = 0; i < 60; i++) f.update(DT, v);
  f.die(new Vector3(0, 0, 1)); v.alive = false; // shot from the front: it goes over backwards
  for (let i = 0; i < 150; i++) f.update(DT, v);
  const j = f.joints();
  assert.ok(j.headC.y < 0.4 && j.neck.y < 0.4, `the head lies at ${j.headC.y.toFixed(2)} m`);
  assert.ok(j.headC.z > 0.6, 'it fell away from the shot');
  for (const k of ['hipC', 'neck', 'knL', 'knR', 'wrL', 'wrR', 'grip']) assert.ok(j[k].y > 0.02, `${k} above the ground (${j[k].y.toFixed(2)})`);
  assert.ok(j.grip.y < 0.15, 'the rifle on the ground');
});

test('the person is hit where it is: head, torso, arms and legs are separate volumes', () => {
  const f = person('z'); for (let i = 0; i < 10; i++) f.update(DT, view());
  const parts = new Set(f.zones().map((z) => z.part)); assert.deepEqual([...parts].sort(), ['arm', 'head', 'leg', 'torso']);
  const at = (y) => { let best = null; for (const z of f.zones()) { const d = rayCapsule(new Vector3(0, y, 10), new Vector3(0, 0, -1), z.a, z.b, z.r); if (d !== null && (!best || d < best.d)) best = { d, part: z.part }; } return best && best.part; };
  assert.equal(at(1.65), 'head'); assert.equal(at(1.2), 'torso'); assert.equal(at(0.3), null, 'between the legs'); assert.equal(at(2), null, 'over the head');
});
