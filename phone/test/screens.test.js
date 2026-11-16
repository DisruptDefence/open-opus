// The placeholder screen, and the switch between it and a real phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneCore } from '../core.js';
import { createPlaceholderScreen, placeholderLines } from '../placeholder-screen.js';
import { eitherScreen } from '../either-screen.js';
import { playingWorld, fakeScreen } from './helpers.js';

test('the placeholder shows the grid reference, position and true heading the world API gives, and imitates nothing', async () => {
  const { world } = await playingWorld({ x: 37, z: -12, heading: 90 }), screen = createPlaceholderScreen(), phone = createPhoneCore(world, screen);
  assert.equal(screen.text(), null);
  phone.raise(); phone.tick();
  const s = world.snapshot().self, m = world.geo.toMGRS(s.x, s.z, 5), g = world.geo.toGeo(s.x, s.z), t = screen.text();
  assert.equal(t.grid, `${m.zone} ${m.square} ${m.easting} ${m.northing}`);
  assert.equal(t.heading, String(Math.round(s.headingTrue) % 360).padStart(3, '0') + '°T');
  assert.ok(t.position.includes(Math.abs(g.lat).toFixed(5)) && t.position.includes(Math.abs(g.lon).toFixed(5)));
  assert.match(t.position, g.lat >= 0 ? /N/ : /S/); assert.equal(t.mode, 'the game is paused');
  assert.equal(screen.capturesKeys, false);
  assert.equal(phone.key({ code: 'KeyT', key: 't' }), true); assert.equal(phone.open, false, 'T puts the placeholder away');
  assert.equal(placeholderLines({ mode: 'slow', self: { ...s, lat: -1.5, lon: 2.25, mgrs: m } }).position, '1.50000° S  2.25000° E');
});

test('either screen: the second until the first is available, the first while it is, and back again', async () => {
  const { world } = await playingWorld(); let live = false;
  const real = fakeScreen({ id: 'real', capturesKeys: true, available: () => live, key: () => true, background: (v) => real.calls.push(['background', v]) });
  const empty = fakeScreen({ id: 'empty' }), screen = eitherScreen(real, empty), phone = createPhoneCore(world, screen), seen = [];
  phone.on((a, d) => { if (a === 'screen') seen.push(d.id); });
  phone.raise();
  assert.equal(empty.calls[0][0], 'open'); assert.equal(real.calls.length, 0); assert.equal(screen.capturesKeys, false);
  live = true; real.say('status', { status: 'connected' }); // the gateway answered while the phone is up
  assert.deepEqual(empty.calls.at(-1), ['close']); assert.equal(real.calls[0][0], 'open'); assert.equal(screen.capturesKeys, true);
  phone.tick(); assert.equal(real.calls.at(-1)[0], 'update');
  assert.equal(phone.key({ code: 'KeyT', key: 't' }), true); assert.equal(phone.open, true, 'T now belongs to the device');
  live = false; phone.tick(); // it went away
  assert.deepEqual(real.calls.at(-1), ['close']); assert.equal(empty.calls.at(-2)[0], 'open'); assert.equal(empty.calls.at(-1)[0], 'update');
  phone.lower(); assert.deepEqual(empty.calls.at(-1), ['close']);
  assert.deepEqual(seen, ['empty', 'real', 'empty']);
  real.say('cot', { uid: 'x', type: 'a-h-G', x: 1, z: 2 }); // reports of either screen reach the host
  let got = null; phone.on((a) => { got = a; }); real.say('cot', { uid: 'y', type: 'a-h-G', x: 1, z: 2 }); assert.equal(got, 'cot');
});
