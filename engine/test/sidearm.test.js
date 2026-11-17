// The sidearm and the carry (weapons/sidearm.js, weapons/carry.js), driven on stand-ins for the player, the input, the
// combat and the camera. The view model is real (three's geometry runs under Node); drawing it is checked in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from '../vendor/three.module.js';
import { h_ } from '../src/input/input.js';
import { DEFAULT_PACK } from '../src/content/default.js';
import { createSidearm, SIDEARM } from '../src/weapons/sidearm.js';
import { createCarry, SWAP_SECONDS } from '../src/weapons/carry.js';

const DT = 1 / 60;
function env() {
  const events = [], shots = [], held = new Set(), down = new Set(), subs = new Map();
  const input = { fire: false, ads: false, look: { dx: 0, dy: 0 }, move: { x: 0, y: 0 }, pressed: (n) => { const r = down.has(n); return r; } };
  const i = {
    camera: new PerspectiveCamera(74), viewCamera: new PerspectiveCamera(54), input,
    player: { alive: true, speed: 0, onGround: true, eye: undefined, sprinting: false },
    combat: { playerShot: (o, d, opt) => { shots.push(opt); return null; } },
    events: { emit: (n, p) => { events.push([n, p]); for (const f of (subs.get(n) || [])) f(p); }, on: (n, f) => { if (!subs.has(n)) subs.set(n, []); subs.get(n).push(f); } }, fx: {},
  };
  const step = (n = 1) => { for (let k = 0; k < n; k++) { i.camera.updateMatrixWorld(); for (const w of env.cur) w.update(DT); down.clear(); } };
  // the engine's every-frame call with the real time: a paused game runs this and not update
  const real = (n = 1, dt = DT) => { for (let k = 0; k < n; k++) for (const w of env.cur) w.realFrame && w.realFrame(dt); };
  const phone = (raised) => i.events.emit('phone:raised', { raised });
  return { i, events, shots, input, press: (n) => down.add(n), step, held, real, phone };
}
env.cur = [];
const W = (extra) => ({ ...DEFAULT_PACK.weapons.pistol, ...extra });
const names = (events, n) => events.filter((e) => e[0] === n).map((e) => e[1]);

test('digits 1 and 2 are bound to weapon1 and weapon2', () => {
  assert.deepEqual([h_.Digit1, h_.Digit2, h_.Numpad1, h_.Numpad2], ['weapon1', 'weapon2', 'weapon1', 'weapon2']);
});

test('auto: false fires one round per press however long the trigger is held', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W());
  env.cur = [p]; e.step(5);
  e.input.fire = true; e.step(90);
  assert.equal(p.ammo, 16, 'one round');
  assert.equal(e.shots.length, 1);
  e.input.fire = false; e.step(20); e.input.fire = true; e.step(5);
  assert.equal(p.ammo, 15, 'a second press, a second round');
});

test('auto: true fires at the pack rpm while held', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W({ auto: true, rpm: 600 }));
  env.cur = [p]; e.step(5); e.input.fire = true; e.step(60); // one second
  assert.ok(p.ammo <= 17 - 9 && p.ammo >= 17 - 11, `rounds fired in a second: ${17 - p.ammo}`);
});

test('the slide goes back 45 mm and returns in about 70 ms; on the last round it stays back', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()), slide = p.root.getObjectByName('slide');
  env.cur = [p]; e.step(5);
  e.input.fire = true; let peak = 0, t70 = null;
  for (let k = 0; k < 20; k++) { e.step(1); peak = Math.max(peak, slide.position.z); if (k === 4) t70 = slide.position.z; }
  assert.ok(peak > SIDEARM.travel - 0.006 && peak <= SIDEARM.travel + 1e-9, `peak ${peak} (frames are 16.7 ms, the stroke out takes 25 ms)`);
  assert.ok(slide.position.z < 0.001, 'back in battery');
  p.ammo = 1; e.input.fire = false; e.step(30); e.input.fire = true; e.step(30);
  assert.equal(p.ammo, 0);
  assert.ok(Math.abs(slide.position.z - SIDEARM.travel) < 1e-6, 'locked back');
  void t70;
});

test('an empty magazine clicks, then a reload re-seats the magazine, refills it from the reserve and sends the slide home', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()), slide = p.root.getObjectByName('slide');
  env.cur = [p]; p.ammo = 1; e.step(3); e.input.fire = true; e.step(20); e.input.fire = false; e.step(20);
  assert.equal(p.ammo, 0);
  e.input.fire = true; e.step(3); assert.equal(names(e.events, 'weapon:dry').length, 1); e.input.fire = false;
  e.step(60); // the dry click starts the reload by itself
  e.step(200);
  assert.equal(p.ammo, 17); assert.equal(p.reserve, 51 - 17);
  assert.ok(slide.position.z < 0.001, 'slide released');
  const phases = names(e.events, 'weapon:reload').map((x) => x.phase);
  assert.deepEqual(phases, ['start', 'magout', 'magin', 'bolt', 'done']);
});

test('the carry switches in 0.35 s, keeps each weapon\'s own counts, refuses during a reload, and forwards the live weapon', () => {
  const e = env(), a = createSidearm(e.i, 'a', W({ name: 'Alpha', magSize: 30, reserve: 90 })), b = createSidearm(e.i, 'b', W({ name: 'Bravo' }));
  const c = createCarry(e.i, [a, b]); env.cur = [c]; e.step(3);
  assert.equal(c.name, 'Alpha'); assert.equal(c.ammo, 30);
  e.input.fire = true; e.step(3); e.input.fire = false; e.step(20);
  const aAmmo = a.ammo; assert.ok(aAmmo < 30);
  e.press('weapon2'); e.step(1); assert.ok(c.swapping);
  e.input.fire = true; e.step(5); assert.equal(a.ammo, aAmmo, 'no firing while swapping'); e.input.fire = false;
  e.step(Math.ceil(SWAP_SECONDS / DT) + 2);
  assert.ok(!c.swapping); assert.equal(c.name, 'Bravo'); assert.equal(c.ammo, 17); assert.equal(c.magSize, 17);
  assert.ok(!a.root.visible && b.root.visible);
  c.reloadNow(); e.press('weapon1'); e.step(2); // the weapon is full: no reload runs, so the swap is allowed
  e.step(Math.ceil(SWAP_SECONDS / DT) + 2); assert.equal(c.name, 'Alpha'); assert.equal(a.ammo, aAmmo, 'Alpha kept its count');
  b.ammo = 3; c.select(1); e.step(Math.ceil(SWAP_SECONDS / DT) + 2); assert.equal(c.ammo, 3);
  c.reloadNow(); e.step(10); assert.equal(c.state, 'reloading');
  assert.equal(c.select(0), false, 'no swap in a reload');
  c.reset(); assert.equal(c.name, 'Alpha'); assert.equal(b.ammo, 17);
});

// ---- the phone: the pistol is drawn back behind it ----
const poseOf = (p) => p.root.getObjectByName('pistol').parent; // the pose group
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('phone raised with the pistol in the hands: the view model reaches the phone-ready pose within 0.3 s, on real time alone (the game is paused)', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()); env.cur = [p]; e.step(5);
  const hip = poseOf(p).position.clone(), R = SIDEARM.phoneReady;
  e.phone(true);
  e.real(Math.round(0.3 / DT) + 1); // no update() at all: the simulation is stopped under a pause
  const pose = poseOf(p);
  for (let k = 0; k < 3; k++) assert.ok(near(pose.position.getComponent(k), R.pos[k], 0.0035), `axis ${k}: ${pose.position.getComponent(k)} against ${R.pos[k]}`);
  assert.ok(near(pose.rotation.x, R.rot[0] * Math.PI / 180, 0.02) && near(pose.rotation.y, R.rot[1] * Math.PI / 180, 0.02) && near(pose.rotation.z, R.rot[2] * Math.PI / 180, 0.02));
  assert.ok(pose.position.distanceTo(hip) > 0.05, 'it moved');
  assert.ok(!p.root.getObjectByName('hand-left').visible, 'the support hand is on the phone, not on the gun');
  const mid = env(), q = createSidearm(mid.i, 'pistol', W()); env.cur = [q]; mid.step(2); mid.phone(true); mid.real(8);
  const pm = poseOf(q).position, t = pm.distanceTo(hip) / new (pose.position.constructor)(...R.pos).distanceTo(hip);
  assert.ok(t > 0.05 && t < 0.95, `0.13 s into the move it is on the way (${t.toFixed(2)})`);
  env.cur = [p];
});

test('in the phone pose the pistol cannot fire, aim or reload, does not bob, and only sways by 3 mm at most', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()); env.cur = [p]; e.step(5);
  e.phone(true); e.real(30); e.step(3);
  e.input.fire = true; e.input.ads = true; e.press('reload'); e.step(40);
  assert.equal(p.ammo, 17, 'no shot'); assert.equal(e.shots.length, 0); assert.equal(p.ads, 0, 'no aim'); assert.notEqual(p.state, 'reloading');
  e.input.fire = false; e.input.ads = false; p.ammo = 10; e.press('reload'); e.step(5); assert.notEqual(p.state, 'reloading', 'a reload is refused');
  assert.equal(p.reloadNow(), false);
  e.i.player.speed = 5; e.i.player.sprinting = true;
  const pose = poseOf(p); let lo = [9, 9, 9], hi = [-9, -9, -9];
  for (let k = 0; k < 240; k++) { e.step(1); e.real(1); for (let a = 0; a < 3; a++) { const v = pose.position.getComponent(a); lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); } }
  for (let a = 0; a < 3; a++) assert.ok(hi[a] - lo[a] <= 0.006, `axis ${a} swings ${((hi[a] - lo[a]) * 1000).toFixed(1)} mm peak to peak (3 mm either way at most)`);
  assert.ok(Math.max(hi[1] - lo[1], hi[0] - lo[0]) < 0.0065, 'walking does not bob it');
});

test('lowering the phone returns the pistol to the hip pose in 0.25 s, and it fires again', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()); env.cur = [p]; e.step(5);
  const hip = poseOf(p).position.clone();
  e.phone(true); e.real(40); e.phone(false);
  e.real(Math.round(0.25 / DT) + 1);
  assert.ok(poseOf(p).position.distanceTo(hip) < 0.003, 'back at the hip');
  assert.ok(p.root.getObjectByName('hand-left').visible, 'the support hand is back');
  e.step(3); e.input.fire = true; e.step(5); assert.equal(p.ammo, 16, 'the weapon fires again');
});

test('with no engine hook the pose still follows the phone from update()', () => {
  const e = env(), p = createSidearm(e.i, 'pistol', W()); env.cur = [p]; e.step(5);
  e.phone(true); e.step(Math.round(0.3 / DT) + 1);
  assert.ok(near(poseOf(p).position.z, SIDEARM.phoneReady.pos[2], 0.0035));
});

test('carry: the carbine stays as it was behind the phone; swapping weapons while the phone is up gives the right pose', () => {
  const e = env(), a = createSidearm(e.i, 'a', W()), b = createSidearm(e.i, 'b', W({ name: 'B' }));
  const c = createCarry(e.i, [a, b]); env.cur = [c]; e.step(3);
  e.phone(true); c.realFrame(0.5);
  assert.ok(poseOf(a).position.distanceTo(new (poseOf(a).position.constructor)(...SIDEARM.phoneReady.pos)) < 0.004, 'the weapon in the hands is in the phone pose');
  assert.equal(typeof c.realFrame, 'function');
  c.select(1); e.step(Math.ceil(SWAP_SECONDS / DT) + 2); c.realFrame(0.1);
  assert.equal(c.name, 'B'); assert.ok(near(poseOf(b).position.z, SIDEARM.phoneReady.pos[2], 0.004), 'the weapon swapped in is already in the pose');
  e.phone(false); c.realFrame(0.3); assert.ok(poseOf(b).position.z > -0.29 || poseOf(b).position.z < -0.27, 'lowered');
  // a stand-in for the carbine: a weapon without realFrame is simply left alone
  const stub = { root: new (a.root.constructor)(), update() {}, reset() {}, setVisible() {}, state: 'idle', debug: {} };
  const c2 = createCarry(e.i, [stub, a]); assert.doesNotThrow(() => c2.realFrame(0.1));
});
