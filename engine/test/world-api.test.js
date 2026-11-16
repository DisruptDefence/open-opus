// The world API contract (docs/WORLD-API.md, version 1), checked on a running engine: the real simulation on the
// test scene, without a screen. Everything here goes through the `world` object, as outside code must; the test
// only adds what a person adds (keys held down) and what a browser adds (frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageSource } from '../src/scene/source.js';
import { runMission } from '../host/mission.js';
import { ROOT, fileFetch } from './helpers.js';
import { openHeadlessWorld } from './headless.js';

const source = () => packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch);
const scenario = () => JSON.parse(readFileSync(join(ROOT, 'host', 'scenarios', 'test.json'), 'utf8'));
const isPlain = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v) || (Array.isArray(v) ? v.every(isPlain) : Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isPlain));

test('the world exists while the scene loads, then is ready in the title state', async () => {
  const { world } = openHeadlessWorld(source());
  assert.equal(world.version, 1);
  assert.equal(world.state(), 'loading');
  assert.equal(world.held(), null); assert.equal(world.canHold(), false); assert.equal(world.hold('pause'), false);
  assert.throws(() => world.snapshot(), /still loading/);
  const seen = []; world.on('state', (e) => seen.push(e));
  await world.ready();
  assert.equal(world.state(), 'title');
  assert.deepEqual(seen, [{ state: 'title', from: 'loading' }]);
  for (const name of ['ready', 'state', 'on', 'start', 'canHold', 'hold', 'setHoldMode', 'held', 'release', 'snapshot', 'overhead', 'apply']) assert.equal(typeof world[name], 'function', name);
  for (const name of ['toGeo', 'toGame', 'toMGRS', 'headingTrue']) assert.equal(typeof world.geo[name], 'function', 'geo.' + name);
});

test('a scene that cannot be read fails ready(), and the world stays in loading', async () => {
  const { world } = openHeadlessWorld(Promise.reject(new Error('no such scene')));
  await assert.rejects(world.ready(), /no such scene/);
  assert.equal(world.state(), 'loading');
});

test('snapshot is plain data in the documented shape, and the only list of things in the world', async () => {
  const { world, run } = openHeadlessWorld(source());
  await world.ready();
  assert.deepEqual(world.snapshot().entities, []);
  const events = []; world.on('entity', (e) => events.push(e));
  world.apply({ op: 'mark', id: 'obj', kind: 'objective', label: 'A', x: 20, z: 9 });
  world.apply({ op: 'mark', id: 'out', kind: 'extraction', x: 20, z: 2 });
  world.apply({ op: 'spawn', id: 's1', kind: 'sentry', x: 60, z: -80, heading: 180 });
  world.apply({ op: 'spawn', id: 'q1', kind: 'air', x: 90, z: -60 });
  world.start({ at: { x: 20, z: 18, heading: 90 } });
  run(0.5);
  const s = world.snapshot();
  assert.ok(isPlain(s), 'no engine object crosses the API');
  assert.ok(isPlain(events));
  assert.deepEqual(Object.keys(s).sort(), ['entities', 'self', 'time']);
  assert.ok(s.time > 0.4 && s.time < 0.6);
  for (const k of ['x', 'y', 'z', 'heading', 'speed', 'health']) assert.equal(typeof s.self[k], 'number', 'self.' + k);
  assert.ok(Math.abs(s.self.x - 20) < 0.01 && Math.abs(s.self.z - 18) < 0.01 && Math.abs(s.self.y - 30) < 0.2, 'the player stands where start() put them, on the ground');
  assert.equal(s.self.heading, 90); assert.equal(s.self.health, 100);
  assert.deepEqual(s.entities.map((e) => [e.id, e.kind, e.type]), [['obj', 'objective', 'objective'], ['out', 'extraction', 'extraction'], ['s1', 'threat', 'ground'], ['q1', 'threat', 'air']]);
  for (const e of s.entities) { for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(e[k]), `${e.id}.${k}`); assert.equal(e.alive, true); assert.equal(typeof e.state, 'string'); }
  assert.ok(s.entities[3].y > s.entities[2].y + 10, 'the air threat flies');
  assert.deepEqual(events.filter((e) => e.change === 'spawn').map((e) => e.id), ['obj', 'out', 's1', 'q1']);
  world.apply({ op: 'despawn', id: 's1' }); world.apply({ op: 'unmark', id: 'out' });
  assert.deepEqual(world.snapshot().entities.map((e) => e.id), ['obj', 'q1']);
  assert.deepEqual(events.filter((e) => e.change === 'despawn').map((e) => e.id), ['s1', 'out']);
});

test('apply refuses what it cannot do', async () => {
  const { world } = openHeadlessWorld(source());
  await world.ready();
  assert.throws(() => world.apply({ op: 'teleport' }), /unknown command/);
  assert.throws(() => world.apply({ op: 'spawn', id: 'x', kind: 'dragon', x: 0, z: 0 }), /archetype/);
  assert.throws(() => world.apply({ op: 'spawn', id: 'x', kind: 'sentry' }), /x and z/);
  assert.throws(() => world.apply({ op: 'mark', id: 'm', kind: 'prize', x: 0, z: 0 }), /objective or extraction/);
  assert.throws(() => world.apply({ op: 'end', result: 'won' }), /complete or dead/);
  world.apply({ op: 'spawn', id: 'x', kind: 'sentry', x: 60, z: -80 });
  assert.throws(() => world.apply({ op: 'spawn', id: 'x', kind: 'sentry', x: 60, z: -80 }), /already/);
  assert.equal(world.snapshot().entities.length, 1);
});

test('geo: the anchor, a round trip, MGRS and true heading agree with the scene georeference', async () => {
  const { world } = openHeadlessWorld(source());
  await world.ready();
  const ref = (await source()).manifest.georef;
  assert.ok(ref.checks.length >= 5);
  for (const c of ref.checks) {
    const p = world.geo.toGeo(c.x, c.z), back = world.geo.toGame(c.lat, c.lon), m = world.geo.toMGRS(c.x, c.z);
    assert.ok(Math.abs(p.lat - c.lat) < 1e-6 && Math.abs(p.lon - c.lon) < 1e-6, `toGeo at ${c.x},${c.z}`);
    assert.ok(Math.abs(back.x - c.x) < 0.1 && Math.abs(back.z - c.z) < 0.1, `toGame at ${c.x},${c.z}`);
    assert.equal(m.zone + m.square + m.easting + m.northing, c.mgrs);
  }
  const a = world.geo.toGeo(0, 0), p = world.geo.toGeo(137.5, -212.25, 30);
  assert.ok(p.lat > a.lat && p.lon > a.lon, '-z is north, +x is east');
  assert.ok(Math.abs(p.hae - a.hae - 30) < 1e-9, 'height above the ellipsoid follows y');
  const m = world.geo.toMGRS(0, 0);
  assert.deepEqual(Object.keys(m).sort(), ['easting', 'northing', 'square', 'zone']);
  assert.equal(m.easting.length, 5); assert.equal(world.geo.toMGRS(0, 0, 3).easting, m.easting.slice(0, 3));
  assert.ok(Math.abs(world.geo.headingTrue(90) - (90 + ref.convergenceDeg)) < 1e-9);
  assert.ok(Math.abs(world.geo.headingTrue(0) - (360 + ref.convergenceDeg)) < 1e-9, 'wraps into 0..360');
});

test('hold freezes or slows the game and release gives it back', async () => {
  const { world, keys, run, hudCalls } = openHeadlessWorld(source());
  await world.ready();
  assert.equal(world.canHold(), false, 'nothing to hold before play');
  world.start({ at: { x: 20, z: 18, heading: 0 } });
  run(0.2);
  assert.equal(world.canHold(), true); assert.equal(keys.gameplay, true);
  const holds = []; world.on('hold', (e) => holds.push(e.mode));
  const t0 = world.snapshot().time;
  assert.equal(world.hold('pause'), true);
  assert.equal(world.held(), 'pause'); assert.equal(world.hold('slow'), false, 'one hold at a time');
  assert.equal(keys.gameplay, false, 'input is off'); assert.equal(keys.locked, false, 'the pointer is released');
  assert.deepEqual(hudCalls.at(-1), ['show', false]);
  keys.move.y = 1; run(1);
  const held = world.snapshot();
  assert.equal(held.time, t0, 'time stands still'); assert.ok(Math.abs(held.self.z - 18) < 1e-6, 'and so does the player');
  world.setHoldMode('slow'); assert.equal(world.held(), 'slow');
  run(1);
  const dt = world.snapshot().time - t0;
  assert.ok(dt > 0.05 && dt < 0.12, `slow motion ran ${dt} s of game time in one second`);
  world.release();
  assert.equal(world.held(), null); assert.equal(keys.gameplay, true); assert.equal(keys.locked, true);
  assert.deepEqual(hudCalls.at(-1), ['show', true]);
  run(1);
  assert.ok(world.snapshot().time - t0 > 1, 'time runs again'); assert.ok(world.snapshot().self.z < 16, 'the player walks again');
  assert.deepEqual(holds, ['pause', 'slow', null]);
  // a run that ends under a hold ends the hold
  world.hold('pause'); world.apply({ op: 'end', result: 'complete' });
  assert.equal(world.held(), null); assert.equal(world.state(), 'complete');
});

test('a mission plays from start to complete through the world API only', async () => {
  const { world, keys, run } = openHeadlessWorld(source());
  await world.ready();
  const states = [], reached = [];
  world.on('state', (e) => states.push(e.state)); world.on('interact', (e) => reached.push(e.id));
  const mission = runMission(world, scenario());
  mission.start();
  assert.equal(world.state(), 'playing');
  assert.deepEqual(world.snapshot().entities.map((e) => e.id), ['obs', 'sentry-1', 'sentry-2', 'quad-1']);
  const before = world.snapshot();
  keys.move.y = 1; // the trainee holds "forward"
  for (let i = 0; i < 40 && world.state() === 'playing'; i++) run(0.5);
  const end = world.snapshot();
  assert.equal(world.state(), 'complete');
  assert.deepEqual(reached, ['obs', 'pickup']);
  assert.deepEqual(states, ['playing', 'complete']);
  assert.ok(end.self.z < 5 && end.self.z > -1 && Math.abs(end.self.x - 20) < 0.5, `the player walked north to the pick-up: ${JSON.stringify(end.self)}`);
  assert.ok(end.time > 3 && end.time < 8, `at walking pace: ${end.time} s`);
  const moved = (id) => { const a = before.entities.find((e) => e.id === id), b = end.entities.find((e) => e.id === id); return Math.hypot(a.x - b.x, a.z - b.z); };
  assert.ok(moved('sentry-1') > 2, 'the sentry walked its route'); assert.ok(moved('quad-1') > 5, 'the quadcopter flew its circuit');
  assert.deepEqual(end.entities.filter((e) => e.kind !== 'threat').map((e) => [e.id, e.state]), [['pickup', 'reached']]);
  // after the end nothing moves the player
  run(1); assert.ok(Math.abs(world.snapshot().self.z - end.self.z) < 0.5);
  // and a second run starts clean
  mission.start(); assert.equal(world.state(), 'playing');
  assert.deepEqual(world.snapshot().entities.map((e) => e.id), ['obs', 'sentry-1', 'sentry-2', 'quad-1']);
  assert.ok(Math.abs(world.snapshot().self.z - 18) < 0.01);
});

test('the player dies under fire: state dead, player:dead, and the host can read it', async () => {
  const { world, run } = openHeadlessWorld(source());
  await world.ready();
  const seen = []; world.on('player:dead', () => seen.push('player:dead')); world.on('state', (e) => seen.push(e.state));
  let hits = 0; world.on('player:hit', () => hits++);
  for (let i = 0; i < 6; i++) world.apply({ op: 'spawn', id: 'near-' + i, kind: 'sentry', x: 14 + i * 2.5, z: 8, heading: 180 });
  world.start({ at: { x: 20, z: 18, heading: 0 } });
  for (let i = 0; i < 120 && world.state() === 'playing'; i++) run(0.5);
  assert.equal(world.state(), 'dead');
  assert.ok(hits > 3, 'hits were reported');
  assert.deepEqual([...seen].sort(), ['dead', 'player:dead', 'playing'], JSON.stringify(seen));
  assert.ok(world.snapshot().self.health <= 0);
  assert.ok(world.snapshot().entities.some((e) => e.state === 'engage'), 'the sentries were engaging');
});
