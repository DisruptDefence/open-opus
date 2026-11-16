// The frame loop never stops (FR-4): a module that throws every frame loses its own update and nothing else, and the
// host is told once. Headless world (test/headless.js), frames run by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { packageSource } from '../src/scene/source.js';
import { ROOT, fileFetch } from './helpers.js';
import { openHeadlessWorld } from './headless.js';

async function playing() {
  const h = openHeadlessWorld(packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch)); await h.world.ready();
  const errors = []; h.world.on('error', (e) => errors.push(e));
  h.world.start({ at: { x: 20, z: 18, heading: 0 }, fadeIn: 0 }); h.run(0.2);
  return { ...h, errors, G: h.engine().G };
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const player = (h) => h.world.snapshot().self;

test('a module whose update throws every frame: 120 more frames run, the player still moves, one error is told', () => quiet(async () => {
  const h = await playing(), f0 = h.engine().frames, p0 = { ...player(h) };
  h.G.threats.update = () => { throw new Error('threats broke'); };
  h.keys.move.y = 1; h.keys.gameplay = true; h.run(2); // 120 frames
  assert.equal(h.engine().frames - f0, 120 + 0, 'every frame ran');
  const p1 = player(h); assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `the player moved: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}`);
  assert.deepEqual(h.errors, [{ module: 'threats', message: 'threats broke' }], 'told once, not 120 times');
}));
test('a throw in a frame hook, in the clock and in the render step does not stop the loop either', () => quiet(async () => {
  const h = await playing(), f0 = h.engine().frames;
  h.engine().onFrame(() => { throw new Error('hook broke'); });
  h.G.render.frame = () => { throw new Error('render broke'); };
  h.run(1);
  h.G.clock.tick = () => { throw new Error('clock broke'); };
  h.run(1);
  assert.equal(h.engine().frames - f0, 120);
  assert.deepEqual(h.errors.map((e) => e.module).sort(), ['clock', 'hook', 'render']);
}));
test('a game session that throws when its state is read does not stop the loop', () => quiet(async () => {
  const h = await playing(), f0 = h.engine().frames;
  Object.defineProperty(h.G.game, 'state', { get() { throw new Error('state broke'); }, configurable: true });
  h.run(1);
  assert.equal(h.engine().frames - f0, 60); assert.ok(h.errors.some((e) => e.module === 'game'));
}));
