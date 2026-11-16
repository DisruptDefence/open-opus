// The phone host over the real world API: raising holds the game, lowering lets it go, the screen is fed the true
// position, and the keys do what docs/WORLD-API.md says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneCore, phoneView, located, MODE_KEY } from '../core.js';
import { playingWorld, fakeScreen } from './helpers.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('raising the phone holds the game and opens the screen; lowering releases it', async () => {
  const { world, run } = await playingWorld(), screen = fakeScreen(), seen = [];
  const phone = createPhoneCore(world, screen); phone.on((a) => seen.push(a));
  assert.equal(phone.open, false); assert.equal(phone.canRaise(), true);
  assert.equal(phone.raise(), true);
  assert.equal(world.held(), 'pause'); assert.equal(phone.open, true); assert.equal(screen.calls[0][0], 'open');
  const t = world.snapshot().time; run(1); assert.equal(world.snapshot().time, t, 'time stands still under the phone');
  assert.equal(phone.raise(), false, 'a second raise does nothing');
  assert.equal(phone.lower(), true);
  assert.equal(world.held(), null); assert.equal(phone.open, false); assert.deepEqual(screen.calls.at(-1), ['close']);
  run(0.5); assert.ok(world.snapshot().time > t, 'play goes on');
  assert.deepEqual(seen, ['raised', 'lowered']);
});

test('the phone cannot be raised when the game is not being played', async () => {
  const { world } = await playingWorld(), screen = fakeScreen(), phone = createPhoneCore(world, screen);
  world.pause();
  assert.equal(phone.canRaise(), false); assert.equal(phone.raise(), false); assert.equal(phone.key({ code: 'KeyT' }), false);
  assert.equal(screen.calls.length, 0);
});

test('the screen is fed the player\'s true position: latitude, longitude and grid reference of the scene', async () => {
  const { world } = await playingWorld({ x: 37, z: -12, heading: 90 }), screen = fakeScreen(), phone = createPhoneCore(world, screen);
  phone.raise(); phone.tick();
  const v = screen.calls.at(-1)[1], s = world.snapshot().self, g = world.geo.toGeo(s.x, s.z, s.y);
  assert.equal(screen.calls.at(-1)[0], 'update');
  assert.equal(v.mode, 'pause');
  assert.equal(v.self.lat, g.lat); assert.equal(v.self.lon, g.lon); assert.equal(v.self.hae, g.hae);
  assert.deepEqual(v.self.mgrs, world.geo.toMGRS(s.x, s.z, 5));
  assert.equal(v.self.headingTrue, s.headingTrue);
  const back = world.geo.toGame(v.self.lat, v.self.lon);
  assert.ok(Math.hypot(back.x - s.x, back.z - s.z) < 0.01, 'the position fed is the place the player stands on');
  assert.deepEqual(phoneView(world.snapshot(), world.geo, null).entities, world.snapshot().entities);
});

test('the mode is remembered, and can change while the phone is up', async () => {
  const { world } = await playingWorld(), storage = memory(), phone = createPhoneCore(world, fakeScreen(), { storage });
  phone.setMode('slow'); assert.equal(storage.getItem(MODE_KEY), 'slow'); assert.equal(phone.mode(), 'slow');
  phone.raise(); assert.equal(world.held(), 'slow');
  phone.setMode('pause'); assert.equal(world.held(), 'pause');
  phone.lower();
  assert.equal(createPhoneCore(world, fakeScreen(), { storage }).mode(), 'pause');
});

test('keys: T and Tab raise; Escape asks the screen first; T lowers a screen that does not take keys', async () => {
  const { world } = await playingWorld(), screen = fakeScreen(), phone = createPhoneCore(world, screen);
  assert.equal(phone.key({ code: 'KeyW' }), false);
  assert.equal(phone.key({ code: 'KeyT', typing: true }), false, 'not while typing in a field');
  assert.equal(phone.key({ code: 'KeyT', ctrlKey: true }), false);
  assert.equal(phone.key({ code: 'KeyT' }), true); assert.equal(phone.open, true);
  assert.equal(phone.key({ code: 'KeyW' }), false, 'other keys are not the phone\'s');
  let undo = 1; screen.back = () => undo-- > 0;
  assert.equal(phone.key({ code: 'Escape' }), true); assert.equal(phone.open, true, 'the screen undid one thing');
  assert.equal(phone.key({ code: 'Escape' }), true); assert.equal(phone.open, false);
  phone.key({ code: 'Tab' }); assert.equal(phone.open, true);
  phone.key({ code: 'KeyT' }); assert.equal(phone.open, false);
});

test('keys: a screen that captures keys gets every key but Escape and Tab, T included', async () => {
  const { world } = await playingWorld(), typed = [];
  const screen = fakeScreen({ capturesKeys: true, key: (k) => { typed.push(k.key); return true; } }), phone = createPhoneCore(world, screen);
  phone.key({ code: 'KeyT', key: 't' }); assert.equal(phone.open, true); assert.deepEqual(typed, []);
  assert.equal(phone.key({ code: 'KeyT', key: 't' }), true); assert.equal(phone.key({ code: 'KeyW', key: 'w' }), true);
  assert.deepEqual(typed, ['t', 'w']); assert.equal(phone.open, true);
  phone.key({ code: 'Tab', key: 'Tab' }); assert.equal(phone.open, false);
});

test('when the game ends under the phone, the phone goes down without resuming play', async () => {
  const { world } = await playingWorld(), screen = fakeScreen(), phone = createPhoneCore(world, screen);
  phone.raise();
  world.apply({ op: 'end', result: 'complete' });
  assert.equal(phone.open, false); assert.deepEqual(screen.calls.at(-1), ['close']); assert.equal(world.state(), 'complete');
});

test('a screen that asks for it is fed twice a second while the phone is down, and only during play', async () => {
  const { world } = await playingWorld(), fed = []; let t = 100;
  const phone = createPhoneCore(world, fakeScreen({ background: (v) => fed.push(v) }), { now: () => t });
  phone.tick(); phone.tick(); assert.equal(fed.length, 1);
  t += 0.6; phone.tick(); assert.equal(fed.length, 2); assert.ok(Number.isFinite(fed[1].self.lat));
  world.pause(); t += 5; phone.tick(); assert.equal(fed.length, 2);
});

test('the screen closes itself through onCloseRequest, and its reports carry their place both ways', async () => {
  const { world } = await playingWorld(), screen = fakeScreen(), phone = createPhoneCore(world, screen), seen = [];
  phone.on((action, data) => seen.push([action, data]));
  const g = world.geo.toGeo(40, -25);
  screen.say('cot', { uid: 'm1', type: 'a-h-G', lat: g.lat, lon: g.lon });
  const [action, data] = seen[0];
  assert.equal(action, 'cot'); assert.ok(Math.abs(data.x - 40) < 0.01 && Math.abs(data.z + 25) < 0.01);
  assert.match(data.mgrs, /^\d{1,2}[C-X] [A-Z]{2} \d{5} \d{5}$/);
  const d2 = located({ x: 40, z: -25 }, world.geo); assert.ok(Math.abs(d2.lat - g.lat) < 1e-9 && Math.abs(d2.lon - g.lon) < 1e-9);
  assert.deepEqual(located({ id: 'x' }, world.geo), { id: 'x' });
  phone.raise(); screen.onCloseRequest(); assert.equal(phone.open, false); assert.equal(world.held(), null);
});
