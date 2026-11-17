// The world API contract (docs/WORLD-API.md, version 1), checked on a running engine: the real simulation on the
// test scene, without a screen. Everything here goes through the `world` object, as outside code must; the test
// only adds what a person adds (keys held down) and what a browser adds (frames).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageSource, jsonSource } from '../src/scene/source.js';
import { ScenarioCommandError } from '../index.js';
import { runMission } from '../host/mission.js';
import { ROOT, fileFetch, oldQuebec } from './helpers.js';
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
  assert.throws(() => world.start(), /still loading/);
  const seen = []; world.on('state', (e) => seen.push(e));
  await world.ready();
  assert.equal(world.state(), 'title');
  assert.deepEqual(seen, [{ state: 'title', from: 'loading' }]);
  assert.ok(Object.isFrozen(world));
  for (const name of ['pause', 'resume', 'scene']) assert.equal(typeof world[name], 'function', name);
  assert.equal(typeof world.geo.toUTM, 'function'); assert.equal(typeof world.geo.convergenceDeg, 'number');
  for (const name of ['ready', 'state', 'on', 'start', 'canHold', 'hold', 'setHoldMode', 'held', 'release', 'snapshot', 'settings', 'overhead', 'apply']) assert.equal(typeof world[name], 'function', name);
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
  assert.deepEqual(Object.keys(s).sort(), ['entities', 'self', 'stats', 'time']);
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

test('scene() describes the place, pause and resume stop and restart play, chunk events report streaming', async () => {
  const { world, keys, run } = openHeadlessWorld(source());
  const chunks = []; const off = world.on('chunk', (e) => chunks.push(e));
  await world.ready();
  const sc = world.scene();
  assert.ok(isPlain(sc)); assert.equal(sc.name, 'Engine test scene');
  for (const b of [sc.bounds, sc.walkable]) assert.ok(b.minX < b.maxX && b.minZ < b.maxZ);
  assert.ok(Array.isArray(sc.credits));
  assert.deepEqual(chunks, [], 'the chunks loaded before ready() are not reported: the world starts with them');
  world.start({ at: { x: 20, z: 18 } }); keys.move.y = 1; run(0.5);
  world.pause(); assert.equal(world.state(), 'paused'); assert.equal(world.canHold(), false);
  const z = world.snapshot().self.z; run(1);
  assert.equal(world.snapshot().self.z, z, 'nothing moves while paused');
  world.resume(); assert.equal(world.state(), 'playing'); run(0.5);
  assert.ok(world.snapshot().self.z < z - 1);
  // far enough to bring new chunks in and let old ones go
  world.apply({ op: 'place', x: -400, z: -400, now: true });
  for (let i = 0; i < 20; i++) { run(0.1); await new Promise((r) => setTimeout(r, 2)); } // chunk files are read between frames
  assert.ok(Math.abs(world.snapshot().self.x - -400) < 3);
  assert.ok(chunks.every((c) => Number.isInteger(c.ce) && Number.isInteger(c.cn) && typeof c.live === 'boolean'));
  assert.ok(chunks.some((c) => c.live) && chunks.some((c) => !c.live), JSON.stringify(chunks));
  off(); const n = chunks.length;
  world.apply({ op: 'place', x: 20, z: 18, now: true });
  for (let i = 0; i < 20; i++) { run(0.1); await new Promise((r) => setTimeout(r, 2)); }
  assert.equal(chunks.length, n, 'a listener that was removed hears nothing');
});

test('apply refuses what it cannot do with a ScenarioCommandError, and a refused command changes nothing', async () => {
  const { world } = openHeadlessWorld(source());
  const refusal = (cmd) => { try { world.apply(cmd); } catch (e) { return e; } return null; };
  // before the world is ready a command is refused like any other, not with a different kind of error
  const early = refusal({ op: 'say', text: 'x' });
  assert.ok(early instanceof ScenarioCommandError); assert.equal(early.code, 'not-ready'); assert.equal(early.op, 'say');
  await world.ready();
  world.apply({ op: 'spawn', id: 's', kind: 'sentry', x: 60, z: -80 });
  world.apply({ op: 'mark', id: 'm', kind: 'objective', x: 20, z: 9 });
  const before = world.snapshot().entities;
  for (const [cmd, code, says] of [
    [{ op: 'teleport' }, 'unknown-op', /no such command/],
    [{ op: 'constructor' }, 'unknown-op', /no such command/],
    [{ x: 1 }, 'unknown-op', /no such command/],
    [null, 'invalid', /object/], ['spawn', 'invalid', /object/], [[{ op: 'say' }], 'invalid', /object/],
    [{ op: 'spawn', id: 'x', kind: 'dragon', x: 0, z: 0 }, 'unknown-kind', /archetype "dragon"/],
    [{ op: 'spawn', id: 'x', kind: 'toString', x: 0, z: 0 }, 'unknown-kind', /archetype/],
    [{ op: 'spawn', id: 'x', kind: 'sentry' }, 'invalid', /x and z/],
    [{ op: 'spawn', id: 'x', kind: 'sentry', x: '12', z: 0 }, 'invalid', /x and z/],
    [{ op: 'spawn', id: 'x', kind: 'sentry', x: 0, z: 0, route: [[1, 2], 'there'] }, 'invalid', /route/],
    [{ op: 'spawn', kind: 'sentry', x: 0, z: 0 }, 'invalid', /id/],
    [{ op: 'spawn', id: 'm', kind: 'sentry', x: 0, z: 0 }, 'invalid', /is a mark/],
    [{ op: 'spawn', id: 's', kind: 'dragon', x: 0, z: 0 }, 'unknown-kind', /archetype/], // refused: the sentry "s" stays
    [{ op: 'mark', id: 'p', kind: 'prize', x: 0, z: 0 }, 'invalid', /objective or extraction/],
    [{ op: 'mark', id: 's', kind: 'objective', x: 0, z: 0 }, 'invalid', /is a threat/],
    [{ op: 'mark', id: 'm', kind: 'objective', x: 0, z: 0, radius: -1 }, 'invalid', /radius/], // refused: the mark "m" stays
    [{ op: 'place', x: 0 }, 'invalid', /x and z/],
    [{ op: 'place', x: 0, z: 0, heading: 'north' }, 'invalid', /heading/],
    [{ op: 'end', result: 'won' }, 'invalid', /complete or dead/],
    [{ op: 'time', hour: 30 }, 'invalid', /hour/],
  ]) {
    const e = refusal(cmd);
    assert.ok(e instanceof ScenarioCommandError, `${JSON.stringify(cmd)} is refused`);
    assert.equal(e.name, 'ScenarioCommandError'); assert.equal(e.code, code, JSON.stringify(cmd)); assert.match(e.message, says);
    assert.equal(e.op, cmd && typeof cmd.op === 'string' ? cmd.op : undefined);
  }
  const cyclic = { op: 'say' }; cyclic.self = cyclic;
  assert.equal(refusal(cyclic).code, 'invalid');
  assert.deepEqual(world.snapshot().entities, before, 'nothing changed');
  assert.equal(world.state(), 'title');
});

test('standing commands are idempotent: a host can send what stands again on a redeploy or a return', async () => {
  const standing = [
    { op: 'place', x: 20, z: 18, heading: 45 },
    { op: 'time', hour: 17 }, { op: 'weather', wet: 0.5 },
    { op: 'mark', id: 'obj', kind: 'objective', label: 'A', x: 20, z: 9, radius: 2 },
    { op: 'spawn', id: 's1', kind: 'sentry', x: 60, z: -80, heading: 180, route: [[60, -80], [20, -80]] },
    { op: 'spawn', id: 'q1', kind: 'quadcopter', x: 90, z: -60 },
  ];
  const picture = (w) => { const s = w.snapshot(); return { self: s.self, entities: [...s.entities].sort((a, b) => a.id.localeCompare(b.id)) }; };
  const once = openHeadlessWorld(source()), twice = openHeadlessWorld(source());
  await once.world.ready(); await twice.world.ready();
  for (const c of standing) once.world.apply(c);
  for (const c of standing) twice.world.apply(c);
  for (const c of standing) twice.world.apply(c);
  assert.deepEqual(picture(twice.world), picture(once.world));
  assert.equal(picture(once.world).entities.length, 3);
  assert.equal(picture(once.world).self.heading, 45);
  // ... and so is taking things away
  for (const w of [once.world, twice.world]) { w.apply({ op: 'despawn', id: 'q1' }); w.apply({ op: 'unmark', id: 'obj' }); }
  twice.world.apply({ op: 'despawn', id: 'q1' }); twice.world.apply({ op: 'unmark', id: 'obj' }); twice.world.apply({ op: 'despawn', id: 'never-there' });
  assert.deepEqual(picture(twice.world), picture(once.world));

  // a return in mid-play: the world has moved on (the sentry walked, the mark was reached), the host sends what
  // stands, at the places it holds, and the world is that again
  const { world, run } = once;
  for (const c of standing) world.apply(c);
  world.start(); run(3);
  const walked = world.snapshot().entities.find((e) => e.id === 's1');
  assert.ok(Math.hypot(walked.x - 60, walked.z + 80) > 1);
  const seen = []; world.on('entity', (e) => seen.push(`${e.change}:${e.id}`));
  world.apply({ op: 'clear' });
  assert.deepEqual(world.snapshot().entities, []);
  world.apply({ op: 'clear' }); // nothing left: nothing happens
  assert.deepEqual(seen.sort(), ['despawn:obj', 'despawn:q1', 'despawn:s1']);
  for (const c of standing) world.apply(c);
  const back = world.snapshot().entities.find((e) => e.id === 's1');
  assert.deepEqual([back.x, back.z, back.alive, back.state], [60, -80, true, 'patrol']);
  assert.deepEqual(world.snapshot().entities.map((e) => e.id), ['obj', 's1', 'q1']);
  assert.equal(world.state(), 'playing', 'the standing commands do not end or restart play');
});

test('end with result dead is the player dying: one player:dead event, state dead, health gone', async () => {
  const { world, run } = openHeadlessWorld(source());
  await world.ready();
  const seen = []; world.on('player:dead', () => seen.push('player:dead')); world.on('state', (e) => seen.push(e.state));
  world.start({ at: { x: 20, z: 18 } }); run(0.2);
  world.apply({ op: 'end', result: 'dead' });
  assert.deepEqual(seen, ['playing', 'dead', 'player:dead']);
  assert.equal(world.state(), 'dead'); assert.equal(world.snapshot().self.health, 0);
  world.apply({ op: 'end', result: 'dead' }); world.apply({ op: 'end', result: 'complete' }); run(0.5);
  assert.deepEqual(seen, ['playing', 'dead', 'player:dead'], 'a run ends once');
  // deploying again brings the player back whole
  world.start({ at: { x: 20, z: 18 } }); run(0.2);
  assert.equal(world.state(), 'playing'); assert.equal(world.snapshot().self.health, 100);
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
  assert.ok(Math.abs(world.geo.headingTrue(90) - (90 + ref.convergence_deg)) < 1e-9);
  assert.ok(Math.abs(world.geo.headingTrue(0) - (360 + ref.convergence_deg)) < 1e-9, 'wraps into 0..360');
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
  assert.deepEqual(holds.slice(-2), ['pause', null], 'the listeners are told');
  assert.equal(world.held(), null); assert.equal(world.state(), 'complete');
});

test('world.phone: raising it is told once as phone:raised (to the host and the engine), a weapon gets real frames under a pause, release lowers it', async () => {
  const { world, run, engine } = openHeadlessWorld(source());
  assert.equal(world.phone.raised(), false);
  assert.throws(() => world.phone.setRaised(true), /still loading/);
  await world.ready();
  world.start({ at: { x: 20, z: 18, heading: 0 } }); run(0.2);
  const seen = [], inner = [], real = [];
  world.on('phone:raised', (e) => seen.push(e)); engine().G.events.on('phone:raised', (e) => inner.push(e.raised));
  engine().G.weapon.realFrame = (r) => real.push(r);
  world.hold('pause'); world.phone.setRaised(true); world.phone.setRaised(true);
  assert.deepEqual(seen, [{ raised: true }], 'one event per change'); assert.deepEqual(inner, [true]); assert.equal(world.phone.raised(), true);
  const n = real.length; run(0.5);
  assert.ok(real.length > n, 'the weapon is given real frames while the game is paused');
  world.release();
  assert.equal(world.phone.raised(), false); assert.deepEqual(seen.map((e) => e.raised), [true, false]);
  assert.ok(Object.isFrozen(world) && typeof world.phone.setRaised === 'function');
});

test('a mission plays from start to complete through the world API only', async () => {
  const { world, keys, run } = openHeadlessWorld(source());
  await world.ready();
  const states = [], reached = [];
  world.on('state', (e) => states.push(e.state)); world.on('interact', (e) => reached.push(e.id));
  const seenStates = new Set([world.state()]), seenKinds = new Set(), note = () => { seenStates.add(world.state()); for (const e of world.snapshot().entities) seenKinds.add(e.kind); };
  world.on('state', note); world.on('entity', note); world.on('interact', note);
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
  for (const s of seenStates) assert.ok(['loading', 'title', 'playing', 'paused', 'dead', 'complete'].includes(s), s);
  for (const k of seenKinds) assert.ok(['objective', 'threat', 'extraction'].includes(k), k);
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

test('the same mission plays on the published Old Quebec scene, loaded from its single file', async () => {
  const sc = JSON.parse(readFileSync(join(ROOT, 'host', 'scenarios', 'old-quebec.json'), 'utf8'));
  const { world, keys, run } = openHeadlessWorld(jsonSource(oldQuebec()), { x: sc.start.x, z: sc.start.z });
  await world.ready();
  assert.equal(world.scene().name, 'Vieux-Québec');
  const reached = []; world.on('interact', (e) => reached.push(e.id));
  runMission(world, sc).start();
  const first = world.snapshot().self, grid = world.geo.toMGRS(first.x, first.z);
  assert.deepEqual([grid.zone, grid.square, grid.easting, grid.northing], ['19T', 'CM', '31641', '86675'], 'the grid a TAK client shows 60 m north of the anchor');
  assert.ok(Math.abs(world.geo.toGeo(first.x, first.z, first.y).hae - (first.y - 27.6)) < 1e-9, 'and the height it is fed');
  keys.move.y = 1;
  for (let i = 0; i < 40 && world.state() === 'playing'; i++) run(0.5);
  assert.equal(world.state(), 'complete'); assert.deepEqual(reached, ['obs', 'pickup']);
  const end = world.snapshot().self;
  assert.ok(end.z < -70 && end.z > -76 && Math.abs(end.x) < 0.5 && Math.abs(end.y - first.y) < 1.5, JSON.stringify(end));
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
  assert.deepEqual(seen, ['playing', 'dead', 'player:dead'], 'the same events, in the same order, as an end with result dead');
  assert.ok(world.snapshot().self.health <= 0);
  assert.ok(world.snapshot().entities.some((e) => e.state === 'engage'), 'the sentries were engaging');
});

test('photo mode: the camera stands where the pose says, the HUD goes, and leaving gives the game back', async () => {
  const { world, keys, run, hudCalls, engine } = openHeadlessWorld(source());
  await assert.rejects(world.photo({ x: 0, z: 0 }), /still loading/);
  assert.equal(world.photographing(), false);
  await world.ready();
  const seen = []; world.on('photo', (e) => seen.push(e));
  await assert.rejects(world.photo({ x: 'east' }), /x and z/);
  const took = await world.photo({ x: 60, z: -40, height: 12, heading: 90, pitch: -10, fov: 50 });
  assert.ok(isPlain(took)); assert.equal(world.photographing(), true);
  run(0.1);
  const G = engine().G, cam = G.camera, ground = G.physics.groundHeight(60, -40);
  assert.ok(Math.abs(cam.position.x - 60) < 1e-6 && Math.abs(cam.position.z + 40) < 1e-6 && Math.abs(cam.position.y - ground - 12) < 1e-6, 'the camera is 12 m above the ground at the pose');
  assert.ok(Math.abs(took.y - cam.position.y) < 0.01); assert.equal(took.heading, 90); assert.equal(cam.fov, 50);
  const dir = cam.getWorldDirection(cam.position.clone());
  assert.ok(dir.x > 0.97 && Math.abs(dir.z) < 0.02 && dir.y < -0.15, 'heading 90 looks east, pitch -10 looks down');
  assert.deepEqual(hudCalls.at(-1), ['show', false]); assert.equal(keys.gameplay, false);
  assert.equal(world.state(), 'title', 'photo mode is not a state of play');
  await world.photo({ x: 61, z: -40, y: 80 }); run(0.05);
  assert.equal(cam.position.y, 80, 'an absolute height is taken as given');
  assert.deepEqual(seen, [{ on: true }], 'moving the camera is not entering again');
  const st = world.stats(); assert.ok(isPlain(st)); assert.ok(st.chunksLive > 0 && st.sceneTriangles > 0 && typeof st.frameMs === 'number' && st.quality === 'low', 'stats() is plain numbers about the frame and the scene');
  assert.equal(await world.photo(null), null); assert.equal(world.photographing(), false);
  assert.notEqual(cam.fov, 50, 'the field of view is the game\'s again');
  world.start({ at: { x: 20, z: 18 } }); run(0.2);
  assert.ok(Math.abs(cam.position.x - 20) < 0.5, 'after leaving, the camera is the player\'s');
  await world.photo({ x: 60, z: -40 }); run(0.1);
  assert.equal(keys.gameplay, false);
  await world.photo(null);
  assert.equal(keys.gameplay, true, 'leaving during play gives the keys back'); assert.deepEqual(hudCalls.at(-1), ['show', true]);
  assert.deepEqual(seen, [{ on: true }, { on: false }, { on: true }, { on: false }]);
});
