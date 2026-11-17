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
  const events = [], shots = [], held = new Set(), down = new Set();
  const input = { fire: false, ads: false, look: { dx: 0, dy: 0 }, move: { x: 0, y: 0 }, pressed: (n) => { const r = down.has(n); return r; } };
  const i = {
    camera: new PerspectiveCamera(74), viewCamera: new PerspectiveCamera(54), input,
    player: { alive: true, speed: 0, onGround: true, eye: undefined, sprinting: false },
    combat: { playerShot: (o, d, opt) => { shots.push(opt); return null; } },
    events: { emit: (n, p) => events.push([n, p]) }, fx: {},
  };
  const step = (n = 1) => { for (let k = 0; k < n; k++) { i.camera.updateMatrixWorld(); for (const w of env.cur) w.update(DT); down.clear(); } };
  return { i, events, shots, input, press: (n) => down.add(n), step, held };
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
