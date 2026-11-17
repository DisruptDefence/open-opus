// Street doors that open (gen/vestibule.js, scene/install.js, world/doors.js): the record, the hall, the collision, the use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { facadeNear } from '../src/gen/facade.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, SOUP } from '../src/gen/style.js';
import { carveRing, leafMatrix, leafRing, inSwing, OPEN_DEG } from '../src/gen/vestibule.js';
import { addDoor } from '../src/scene/install.js';
import { createGrid, createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics } from '../src/physics/physics.js';
import { jsonSource } from '../src/scene/source.js';
import { building, oldQuebec, ROOT } from './helpers.js';
import { openHeadlessWorld, STEP } from './headless.js';

const style = resolveStyle(), flat = () => 30, info = { slots: [], ridge: [], parapet: 0 };
const RING = [0, 0, 10, 0, 10, 8, 0, 8], SHALLOW = [0, 0, 10, 0, 10, 1.7, 0, 1.7];
const front = (ring, o = {}) => building(ring, { id: 7, front: new Set([0]), blind: new Set([1, 2, 3]), ...o });
const near = (b, st = style) => { const s = createSoups(); facadeNear(s, b, flat, st, info); return s; };
const quads = (s, key) => (s.map.get(key) ? s.map.get(key).pos.length / 18 : 0);
const mid = (r) => [r.origin[0] + r.axis[0] * (r.u0 + r.u1) / 2, r.origin[1] + r.axis[2] * (r.u0 + r.u1) / 2];

test('a front door gives one record: the hinge on a jamb at the recess depth, the normal out of the building', () => {
  for (const ring of [RING, [0, 0, 0, 8, 10, 8, 10, 0]]) { // either winding
    const s = near(front(ring)), recs = s.doors; assert.equal(recs.length, 1);
    const r = recs[0], jamb = [r.u0, r.u1].map((u) => [r.origin[0] + r.axis[0] * u - r.normal[0] * r.recess, r.origin[1] + r.axis[2] * u - r.normal[2] * r.recess]);
    const hx = r.hinge[0], hz = r.hinge[2], d = Math.min(...jamb.map((j) => Math.hypot(j[0] - hx, j[1] - hz)));
    assert.ok(d < 0.03, `hinge ${d} m from a jamb`); assert.ok(Math.abs(Math.hypot(...r.axis) - 1) < 1e-9 && Math.abs(Math.hypot(...r.normal) - 1) < 1e-9);
    assert.ok((5 - hx) * r.normal[0] + (4 - hz) * r.normal[2] > 0 === false, 'the normal points away from the middle of the building');
    assert.equal(s.map.get(SOUP.door).pos.length / 18, 1, 'the soup holds only the inner door');
    assert.ok(r.leafW > 0.9 && r.leafW < r.w && r.id && r.tint.length === 3);
  }
  const a = near(front(RING)).doors[0], b = near(front(RING)).doors[0]; assert.equal(a.id, b.id); assert.equal(a.left, b.left);
  assert.notEqual(near(front(RING, { id: 8 })).doors[0].id, a.id);
});
test('a carriage door and a door of a building too shallow behind it stay fixed, their leaf in the soup', () => {
  const big = near(front(RING, { groundFloor: 2 })); assert.equal(big.doors, undefined); assert.equal(quads(big, SOUP.door), 1);
  const shallow = near(front(SHALLOW)); assert.equal(shallow.doors, undefined); assert.equal(quads(shallow, SOUP.door), 1);
  const steep = createSoups(); facadeNear(steep, front(RING), (x, z) => (z < -0.1 ? 29 : 30), style, info); assert.equal(steep.doors, undefined, 'a street a metre below the threshold: no step could climb it');
  const off = near(front(RING), { ...style, vestibule: { ...style.vestibule, depth: 0 } }); assert.equal(off.doors, undefined);
});
test('the hall costs at most 36 triangles a door', () => {
  const on = near(front(RING)), off = near(front(RING), { ...style, vestibule: { ...style.vestibule, depth: 0 } });
  assert.ok(on.triangles() - off.triangles() <= 36 + 0, `${on.triangles() - off.triangles()} more triangles`);
  for (let id = 1; id < 40; id++) { const a = near(front(RING, { id })), b = near(front(RING, { id }), { ...style, vestibule: { ...style.vestibule, depth: 0 } }); if (a.doors) assert.ok(a.triangles() - b.triangles() <= 36, `id ${id}`); }
});
test('every face of the hall looks into it', () => {
  const s = near(front(RING)), r = s.doors[0], c = [mid(r)[0] - r.normal[0] * (r.recess + 0.7), 31, mid(r)[1] - r.normal[2] * (r.recess + 0.7)];
  for (const key of ['wall_stucco|tv', 'wood|tv', 'paving|tv']) { const g = s.map.get(key); if (!g) continue;
    for (let i = 0; i < g.pos.length; i += 9) { // only the hall's own faces: those inside the hall's box
      const p = [0, 1, 2].map((k) => (g.pos[i + k] + g.pos[i + 3 + k] + g.pos[i + 6 + k]) / 3), dx = p[0] - c[0], dz = p[2] - c[2];
      const along = dx * r.axis[0] + dz * r.axis[2], out = dx * r.normal[0] + dz * r.normal[2];
      if (Math.abs(along) > 1.3 || out < -1.0 || out > 0.1 || p[1] > r.ceil + 0.01) continue;
      assert.ok(g.nrm[i] * -dx + g.nrm[i + 1] * (c[1] - p[1]) + g.nrm[i + 2] * -dz > -1e-6, `${key} face at ${p.map((v) => v.toFixed(2))} looks away from the hall`);
    } }
});

// ---- the leaf ---------------------------------------------------------------------------------------------------------
test('the leaf turns on its hinge: shut it lies in the doorway, at 90 degrees it runs straight into the building, and the matrix is a proper rotation', () => {
  for (const id of [3, 4, 5, 6, 7, 8]) {
    const r = near(front(RING, { id })).doors[0], det = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
    const shut = leafRing(r, 0), open = leafRing(r, 90);
    const along = (ring, k) => [ring[k * 2] - r.hinge[0], ring[k * 2 + 1] - r.hinge[2]];
    const e = along(shut, 1), d = e[0] * r.normal[0] + e[1] * r.normal[2], u = e[0] * r.axis[0] + e[1] * r.axis[2];
    assert.ok(Math.abs(d) < 0.03 && Math.abs(Math.abs(u) - r.leafW) < 0.03, 'shut: across the doorway'); assert.equal(u > 0, r.left, 'the hinge is on the side `left` says');
    const o = along(open, 1), od = o[0] * r.normal[0] + o[1] * r.normal[2], ou = o[0] * r.axis[0] + o[1] * r.axis[2];
    assert.ok(Math.abs(od + r.leafW) < 0.03 && Math.abs(ou) < 0.03, `open: ${od} ${ou}`); // into the building
    for (const deg of [0, 45, 100]) assert.ok(det(leafMatrix(r, deg)) > 0, 'not mirrored');
  }
});

// ---- the collision ----------------------------------------------------------------------------------------------------
const RING20 = RING.map((v) => v + 20);
function world(b = front(RING20)) {
  const n = 101, terrain = createTerrain(); terrain.addTile(0, -1, createGrid({ nx: n, nz: n, cell: 1, minX: 0, minZ: 0, data: new Float32Array(n * n).fill(30) }));
  const physics = createPhysics({ terrain, bounds: { min: { x: -50, y: -10, z: -50 }, max: { x: 150, y: 100, z: 150 } } });
  const s = near(b), r = s.doors[0], top = 30 + 9 + 3, ring = carveRing(b.ring, [r]);
  physics.addPrism(ring, 27, top, { tag: 't', ref: b }); const h = addDoor(physics, r, top, 't', b);
  return { physics, r, h, b, top, plain: b.ring };
}
const walk = (physics, from, to, seconds = 4) => {
  const pos = { x: from[0], y: 30, z: from[1] }, vel = { x: 0, y: 0, z: 0 }; let grounded = true; const dx = to[0] - from[0], dz = to[1] - from[1], l = Math.hypot(dx, dz);
  for (let t = 0; t < seconds; t += 1 / 60) { vel.x = dx / l * 3; vel.z = dz / l * 3; vel.y -= 21 / 60; grounded = physics.moveCapsule(pos, vel, 1 / 60, 0.32, 1.8, grounded).onGround; }
  return pos;
};
const toward = (r, d) => { const m = mid(r); return [m[0] + r.normal[0] * d, m[1] + r.normal[1 + 1] * d]; };
const open = (physics, w) => { physics.remove(w.h.leaf); w.h.leaf = physics.addPrism(leafRing(w.r, OPEN_DEG), w.r.ys, w.r.yh, { tag: 't' }); };

test('shut, the leaf stops a walker, a ray and sight at the doorway; open, the walker stands 1 m inside and no further, and a ray stops at the back wall', () => {
  const w = world(), { physics, r } = w, m = mid(r), out = (d) => [m[0] + r.normal[0] * d, m[1] + r.normal[2] * d];
  const o = out(3), into = [-r.normal[0], -r.normal[2]];
  const p = walk(physics, o, out(-3)); const depth = (p.x - m[0]) * -r.normal[0] + (p.z - m[1]) * -r.normal[2];
  assert.ok(depth < r.recess - 0.02 && depth > r.recess - 0.5, `shut: stopped ${depth} m behind the wall plane, the leaf at ${r.recess}`);
  const ray = (from, dy = 0) => physics.raycast({ x: from[0], y: 31.2 + dy, z: from[1] }, { x: into[0], y: 0, z: into[1] }, 30);
  const shut = ray(o); assert.ok(shut && Math.abs(shut.dist - (3 + r.recess - 0.0225)) < 0.05, `the shut leaf stops a ray at ${shut && shut.dist}`);
  assert.equal(physics.lineOfSight({ x: o[0], y: 31.2, z: o[1] }, { x: out(-1)[0], y: 31.2, z: out(-1)[1] }), false, 'no sight through a shut door');
  open(physics, w);
  const q = walk(physics, o, out(-3)); const d2 = (q.x - m[0]) * into[0] + (q.z - m[1]) * into[1];
  assert.ok(d2 > r.recess + 1.0 && d2 < r.recess + 1.45, `open: the walker reaches ${d2.toFixed(2)} m behind the facade (hall ${r.recess}..${r.recess + 1.4})`);
  assert.ok(Math.abs(q.y - r.ys) < 0.05, `stands on the hall floor, y ${q.y}`);
  const back = ray(o); assert.ok(back && Math.abs(back.dist - (3 + r.recess + 1.4)) < 0.1, `a ray stops at the back wall: ${back && back.dist}`);
  assert.equal(physics.lineOfSight({ x: o[0], y: 31.2, z: o[1] }, { x: out(-1)[0], y: 31.2, z: out(-1)[1] }), true, 'sight through an open doorway');
  { const above = ray(o, 1.2); assert.ok(above && Math.abs(above.dist - 3) < 0.05, `above the door head the facade is solid: ${above && above.dist}`); }
  assert.equal(physics.blocked(m[0] + into[0] * 1, m[1] + into[1] * 1, 0.45, 30, 1.8, true), true, 'the nav grid sees the hall closed');
  assert.equal(physics.blocked(m[0] + into[0] * 1, m[1] + into[1] * 1, 0.3, 30, 1.8), false, 'a body standing up in it is not told it is blocked');
});
test('outside the vestibule the building is as solid as before: probes on a grid inside the footprint', () => {
  const w = world(), plain = createPhysics({ terrain: w.physics.terrain, bounds: w.physics.bounds }); plain.addPrism(w.plain, 27, w.top, {});
  const r = w.r, m = mid(r); let probes = 0;
  const inHall = (x, z) => { const u = (x - r.origin[0]) * r.axis[0] + (z - r.origin[1]) * r.axis[2], d = (x - r.origin[0]) * r.normal[0] + (z - r.origin[1]) * r.normal[2]; return u > r.u0 - 0.26 && u < r.u1 + 0.26 && d < 0.01 && d > -r.recess - 1.41; };
  for (let x = 19; x <= 31; x += 0.25) for (let z = 19; z <= 29; z += 0.25) for (const y of [30.5, 33, 38.5, 40.5]) {
    probes++; const a = w.physics.near, sa = [], sb = []; a(x, z, x, z, (s) => { if (s.min.y <= y && s.max.y >= y) sa.push(s); });
    plain.near(x, z, x, z, (s) => { if (s.min.y <= y && s.max.y >= y) sb.push(s); });
    const inside = (list, X, Z) => list.some((s) => { let c = false; const q = s.ring; for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) if ((q[i + 1] > Z) !== (q[j + 1] > Z) && X < ((q[j] - q[i]) * (Z - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) c = !c; return c; });
    const was = inside(sb, x, z), is = inside(sa, x, z);
    if (was !== is && !inHall(x, z)) assert.fail(`solidity changed at ${x}, ${z}, ${y} outside the hall`);
  }
  assert.ok(probes > 1000);
  // above the hall's ceiling and the recess's head the mass is there too
  for (const y of [r.ceil + 0.1, 41]) { const mm = [m[0] - r.normal[0] * (r.recess + 0.7), m[1] - r.normal[2] * (r.recess + 0.7)]; assert.ok(w.physics.raycast({ x: mm[0], y: 45, z: mm[1] }, { x: 0, y: -1, z: 0 }, 20), `a ray from above hits the roof block at ${y}`); }
  const hit = w.physics.raycast({ x: m[0] - r.normal[0] * (r.recess + 0.7), y: 45, z: m[1] - r.normal[2] * (r.recess + 0.7) }, { x: 0, y: -1, z: 0 }, 30); assert.ok(Math.abs(hit.point.y - 42) < 0.01, `lands on the building top, y ${hit.point.y}`);
});
test('the swing: a body in the sweep of the leaf is found, one outside it is not', () => {
  const r = near(front(RING)).doors[0], m = mid(r);
  assert.equal(inSwing(r, m[0] - r.normal[0] * 0.8, m[1] - r.normal[2] * 0.8), true); assert.equal(inSwing(r, m[0] + r.normal[0] * 1.0, m[1] + r.normal[2] * 1.0), false, 'outside on the street');
  assert.equal(inSwing(r, m[0] - r.normal[0] * 2.0, m[1] - r.normal[2] * 2.0), false, 'deep in the hall, beyond the leaf');
});

// ---- in the world -----------------------------------------------------------------------------------------------------
let found = null;
async function aDoor() {
  if (found) return found;
  const { installAll } = await import('./helpers.js'), a = await installAll(jsonSource(oldQuebec()));
  const list = []; for (const { env } of a.chunks.values()) for (const h of env.doors) list.push(h.rec);
  assert.ok(list.length > 100, `${list.length} doors in the scene`);
  // a door with a clear stretch of street in front of it
  const w = a.source.manifest.walkable, inside = (x, z) => x > w.minX + 20 && x < w.maxX - 20 && z > w.minZ + 20 && z < w.maxZ - 20;
  const r = list.find((q) => { const m = mid(q); return inside(m[0], m[1]) && [1.2, 2.0].every((d) => !a.physics.blocked(m[0] + q.normal[0] * d, m[1] + q.normal[2] * d, 0.35, q.ys)); });
  return (found = { r, count: list.length });
}
async function inWorld(params = {}, dist = 1.3) {
  const { r } = await aDoor(), m = mid(r), x = m[0] + r.normal[0] * dist, z = m[1] + r.normal[2] * dist, heading = (Math.atan2(-r.normal[0], r.normal[2]) * 180) / Math.PI; // facing the door
  const h = openHeadlessWorld(jsonSource(oldQuebec()), { x, z, ...params }); await h.world.ready();
  const log = []; h.world.on('door:opened', (e) => log.push(['opened', e.id])); h.world.on('door:closed', (e) => log.push(['closed', e.id]));
  h.world.start({ at: { x, z, heading }, fadeIn: 0 }); h.run(0.3);
  return { ...h, r, m, x, z, heading, log, press: () => { h.keys.held.add('interact'); h.run(0.1); h.keys.held.delete('interact'); h.run(0.1); } };
}
const prompts = (f) => f.hudCalls.filter((c) => c[0] === 'prompt');

test('the scene has hundreds of street doors that open; the world finds the ones near, with the hinge side and no more', async () => {
  const f = await inWorld(), near = f.world.doors.near(f.x, f.z, 3);
  assert.ok(near.length >= 1 && near[0].id === f.r.id && near[0].open === false, JSON.stringify(near));
  assert.deepEqual(Object.keys(near[0]).sort(), ['id', 'open', 'x', 'y', 'z']); assert.deepEqual(f.world.doors.near(f.x + 500, f.z, 3), []);
});
test('interact opens the door in range and in front, once: one event, the leaf solid moves, and again closes it', async () => {
  const f = await inWorld(), P = f.engine().G.physics, ray = (o, d) => P.raycast({ x: o[0], y: f.r.ys + 1.2, z: o[1] }, { x: -f.r.normal[0], y: 0, z: -f.r.normal[2] }, 30);
  const o = [f.x, f.z], before = ray(o); assert.ok(before && before.dist < 1.6 + f.r.recess, `a shut door stops the ray ${before && before.dist}`);
  f.press(); assert.deepEqual(f.log, [['opened', f.r.id]]); f.run(1);
  const after = ray(o); assert.ok(after.dist > 1.3 + f.r.recess + 1.2, `an open door lets the ray into the hall: ${after.dist}`);
  assert.equal(f.world.doors.near(f.x, f.z, 3)[0].open, true);
  f.press(); assert.deepEqual(f.log, [['opened', f.r.id], ['closed', f.r.id]]); f.run(1); assert.ok(ray(o).dist < 1.6 + f.r.recess);
  assert.equal(f.world.doors.open(f.r.id), true); assert.equal(f.world.doors.open(f.r.id), false, 'already open: no second event'); assert.equal(f.log.length, 3);
});
test('the prompt is the existing one, with the words of the pack, and only within range and facing', async () => {
  const f = await inWorld(); f.run(0.2);
  const G = f.engine().G, seen = []; G.events.on('director:prompt', (e) => seen.push(e));
  f.world.doors.open(f.r.id); f.run(0.3);
  assert.ok(seen.some((e) => e.prompt === 'Close' && e.tap === true && e.id === f.r.id), JSON.stringify(seen));
  f.world.doors.close(f.r.id); f.run(0.6);
  assert.ok(seen.some((e) => e.prompt === 'Open' && e.tap === true), 'open again offered');
  // turned away: nothing to press
  G.player.yaw += Math.PI; f.run(0.2); assert.equal(seen[seen.length - 1].id, null);
  const n = f.log.length; f.press(); assert.equal(f.log.length, n, 'facing away: interact does nothing');
  G.player.yaw += Math.PI; G.player.pos.x += f.r.normal[0] * 4; G.player.pos.z += f.r.normal[2] * 4; f.run(0.2); f.press(); assert.equal(f.log.length, n, 'out of reach: interact does nothing');
});
test('it will not shut on the player: standing in the swing it stays open', async () => {
  const f = await inWorld(); f.world.doors.open(f.r.id); f.run(1);
  const G = f.engine().G, m = f.m; G.player.pos.x = m[0] - f.r.normal[0] * 0.8; G.player.pos.z = m[1] - f.r.normal[2] * 0.8; f.run(0.1);
  assert.equal(f.world.doors.close(f.r.id), false); f.run(0.6); assert.equal(f.world.doors.near(m[0], m[1], 3)[0].open, true);
  G.player.pos.x = m[0] + f.r.normal[0] * 1.5; G.player.pos.z = m[1] + f.r.normal[2] * 1.5; f.run(0.1); assert.equal(f.world.doors.close(f.r.id), true);
});
test('the switch doors=open opens every door as its chunk loads', async () => {
  const f = await inWorld({ doors: 'open' }); assert.equal(f.world.doors.near(f.x, f.z, 3)[0].open, true); assert.deepEqual(f.log, [], 'no event: nothing changed');
});
test('state survives a chunk being released and loaded again', async () => {
  const f = await inWorld(); f.world.doors.open(f.r.id); f.run(0.2);
  const G = f.engine().G, lvl = G.level; // far away and back: the chunk is released, then streamed in again
  const g = G.level.manifest.grid; const far = { x: f.x + 3 * 250, z: f.z };
  for (let i = 0; i < 6; i++) { lvl.stream(far.x, far.z, 4); await new Promise((r) => setTimeout(r, 5)); } assert.deepEqual(f.world.doors.near(f.x, f.z, 3), [], 'released with its chunk'); void g;
  for (let i = 0; i < 20; i++) { lvl.stream(f.x, f.z, 4); await new Promise((r) => setTimeout(r, 5)); }
  const again = f.world.doors.near(f.x, f.z, 3); assert.ok(again.length && again[0].open === true, 'comes back open');
});
test('a cell\'s doors are ONE instanced mesh, drawn shut, tinted with the door colour; its triangles are counted on their own', async () => {
  const { buildCellNear } = await import('../src/level/build.js'), { installAll } = await import('./helpers.js'), { MeshBasicMaterial } = await import('../vendor/three.module.js');
  const G = { mats: { get: () => new MeshBasicMaterial() } }, a = await installAll(jsonSource(oldQuebec()));
  for (const { chunk, env } of a.chunks.values()) {
    const cell = chunk.cells.find((c) => c.buildings.length > 6); if (!cell) continue;
    const g = buildCellNear(G, chunk, cell, env), d = g.userData.doors; if (!d) continue;
    assert.equal(g.children.filter((m) => m.isInstancedMesh).length, 1); assert.equal(d.mesh.count, d.recs.length);
    const m = d.mesh.instanceMatrix.array, r = d.recs[0]; assert.ok(Math.abs(m[12] - r.hinge[0]) < 1e-5 && Math.abs(m[14] - r.hinge[2]) < 1e-5);
    assert.deepEqual([...d.mesh.instanceColor.array.slice(0, 3)].map((v) => +v.toFixed(4)), r.tint.map((v) => +v.toFixed(4)));
    assert.equal(d.mesh.userData.tris, d.recs.length * 12); return;
  }
  assert.fail('no cell with doors');
});
