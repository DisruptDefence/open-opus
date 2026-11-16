// The stream screen against a gateway that is not there, and against one that is (a stand-in socket speaking the
// gateway's messages): what it says, what it sends, and what it reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamScreen, noteFor, h264Codec, overlayBox, DEFAULT_GATEWAY } from '../stream-screen.js';
import { createPhoneCore } from '../core.js';
import { playingWorld } from './helpers.js';

function sockets() {
  const made = [];
  class Sock {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.l = {}; made.push(this); }
    addEventListener(n, fn) { (this.l[n] ||= []).push(fn); }
    fire(n, e = {}) { for (const fn of this.l[n] || []) fn(e); }
    accept() { this.readyState = 1; this.fire('open'); }
    refuse() { this.readyState = 3; this.fire('error'); this.fire('close'); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; }
  }
  return { Sock, made };
}

test('with no gateway the screen says so in plain words, with the command to run, and shows no stand-in', () => {
  const { Sock, made } = sockets(), seen = [];
  const screen = createStreamScreen({ WebSocketImpl: Sock, retrySeconds: 1000 }); screen.on((t, d) => seen.push([t, d]));
  screen.connect(); assert.equal(made[0].url, DEFAULT_GATEWAY);
  made[0].refuse();
  assert.equal(screen.status(), 'absent'); assert.equal(screen.frames(), 0);
  const note = noteFor('absent', DEFAULT_GATEWAY, 'phone/local/run.sh');
  assert.match(note, /No phone connected/); assert.match(note, /phone\/local\/run\.sh/); assert.match(note, /ws:\/\/127\.0\.0\.1:9741/); assert.match(note, /real ATAK/);
  assert.equal(noteFor('live'), '');
  assert.equal(screen.key({ key: 'a' }), false, 'nothing is typed into a phone that is not there');
  screen.disconnect();
});

test('it keeps trying, and connects when the gateway appears', async () => {
  const { Sock, made } = sockets(), screen = createStreamScreen({ WebSocketImpl: Sock, retrySeconds: 0.01 });
  screen.connect(); made[0].refuse();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(made.length >= 2, 'a second attempt was made');
  made.at(-1).accept(); assert.equal(screen.status(), 'connected');
  screen.disconnect();
});

test('the player\'s true position goes to the device, at most twice a second, phone up or down', async () => {
  const { world } = await playingWorld({ x: 37, z: -12, heading: 90 }), { Sock, made } = sockets(); let t = 50;
  const screen = createStreamScreen({ WebSocketImpl: Sock, now: () => t }), phone = createPhoneCore(world, screen, { now: () => t });
  screen.connect(phone.context); made[0].accept();
  phone.tick(); phone.tick();
  const pos = made[0].sent.filter((m) => m.t === 'pos'), s = world.snapshot().self, g = world.geo.toGeo(s.x, s.z, s.y);
  assert.equal(pos.length, 1);
  assert.deepEqual(pos[0], { t: 'pos', lat: g.lat, lon: g.lon, hdg: s.headingTrue, spd: s.speed, alt: g.hae });
  t += 0.6; phone.raise(); phone.tick(); t += 0.1; phone.tick();
  assert.equal(made[0].sent.filter((m) => m.t === 'pos').length, 2);
  screen.disconnect();
});

test('keys typed while the phone is up go to the device; Back is a button', async () => {
  const { world } = await playingWorld(), { Sock, made } = sockets();
  const screen = createStreamScreen({ WebSocketImpl: Sock }), phone = createPhoneCore(world, screen);
  screen.connect(phone.context); made[0].accept();
  assert.equal(phone.key({ code: 'KeyA', key: 'a' }), false, 'the phone is down: the key is the game\'s');
  phone.raise();
  phone.key({ code: 'KeyT', key: 't' }); phone.key({ code: 'Enter', key: 'Enter' }); phone.key({ code: 'ShiftLeft', key: 'Shift' });
  screen.buttons[0].run();
  assert.deepEqual(made[0].sent.filter((m) => m.t !== 'pos'), [{ t: 'text', s: 't' }, { t: 'key', code: 66 }, { t: 'back' }]);
  screen.disconnect();
});

test('what ATAK shares comes back as a report with its place in game metres', async () => {
  const { world } = await playingWorld(), { Sock, made } = sockets(), seen = [];
  const screen = createStreamScreen({ WebSocketImpl: Sock }), phone = createPhoneCore(world, screen);
  phone.on((a, d) => { if (a === 'cot') seen.push(d); });
  screen.connect(phone.context); made[0].accept();
  const g = world.geo.toGeo(55, -40);
  made[0].fire('message', { data: JSON.stringify({ type: 'cot', uid: 'abc', cot: 'a-h-G', how: 'h-g-i-g-o', lat: g.lat, lon: g.lon, callsign: 'R.15.101500' }) });
  made[0].fire('message', { data: JSON.stringify({ type: 'cot', uid: 'me', cot: 'a-f-G-U-C', how: 'm-g', lat: g.lat, lon: g.lon }) });
  made[0].fire('message', { data: 'not json' }); made[0].fire('message', { data: JSON.stringify({ type: 'cot', uid: 'bad' }) });
  assert.equal(seen.length, 2);
  assert.ok(Math.abs(seen[0].x - 55) < 0.01 && Math.abs(seen[0].z + 40) < 0.01);
  assert.equal(seen[0].type, 'a-h-G'); assert.equal(seen[0].callsign, 'R.15.101500'); assert.equal(seen[0].self, false);
  assert.equal(seen[1].self, true, 'the device\'s own position report is marked as such');
  screen.disconnect();
});

test('the H.264 codec string is read from the stream\'s own parameters', () => {
  assert.equal(h264Codec(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x29, 0x8d])), 'avc1.42c029');
  assert.equal(h264Codec(new Uint8Array([1, 2, 3])), 'avc1.42e01f');
});

test('the map overlay\'s box puts a grid-north picture on true-north ground', async () => {
  const { world } = await playingWorld(), geo = world.geo, b = { minX: -200, maxX: 200, minZ: -300, maxZ: 100 };
  const box = overlayBox(b, geo), c = geo.toGeo(0, -100), k = Math.cos((c.lat * Math.PI) / 180);
  assert.equal(box.rotation, -geo.convergenceDeg);
  assert.ok(Math.abs((box.north + box.south) / 2 - c.lat) < 1e-9 && Math.abs((box.east + box.west) / 2 - c.lon) < 1e-9, 'centred on the picture');
  // turn the box's top-middle and right-middle by its rotation: they must land on the picture's own edge points
  const a = (box.rotation * Math.PI) / 180, turn = (e, n) => ({ lon: c.lon + (e * Math.cos(a) - n * Math.sin(a)) / k, lat: c.lat + e * Math.sin(a) + n * Math.cos(a) });
  const top = turn(0, box.north - c.lat), wantTop = geo.toGeo(0, b.minZ), right = turn((box.east - c.lon) * k, 0), wantRight = geo.toGeo(b.maxX, -100);
  const metres = (p, q) => Math.hypot((p.lat - q.lat) * 111320, (p.lon - q.lon) * 111320 * k); // only to state the test's tolerance
  assert.ok(metres(top, wantTop) < 0.05, `top edge off by ${metres(top, wantTop)} m`);
  assert.ok(metres(right, wantRight) < 0.05, `right edge off by ${metres(right, wantRight)} m`);
});
