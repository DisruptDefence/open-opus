import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES } from '../src/threats/archetypes.js';
import { canSee, canHear, createBrain, validateBehaviour } from '../src/threats/brain.js';

test('every archetype is a valid behaviour table, with a ground and an air threat', () => {
  for (const def of Object.values(ARCHETYPES)) assert.deepEqual(validateBehaviour(def), []);
  assert.deepEqual([...new Set(Object.values(ARCHETYPES).map((d) => d.type))].sort(), ['air', 'ground']);
  assert.ok(validateBehaviour({ id: 'x', behaviour: { start: 'a', states: { a: { do: 'hold', on: [{ if: 'nope', to: 'b' }] } } } }).length === 2);
});
test('sight: range, field of view, close range, line of sight', () => {
  const s = { sight: 50, fov: 90, closeRange: 4 }, me = { x: 0, y: 1.6, z: 0, fx: 0, fz: -1 }, clear = () => true;
  assert.ok(canSee(me, { x: 0, y: 1.6, z: -30 }, s, clear));
  assert.ok(!canSee(me, { x: 0, y: 1.6, z: -60 }, s, clear), 'beyond range');
  assert.ok(!canSee(me, { x: 0, y: 1.6, z: 30 }, s, clear), 'behind');
  assert.ok(canSee(me, { x: 0, y: 1.6, z: 3 }, s, clear), 'behind but at arm\'s length');
  assert.ok(!canSee(me, { x: 0, y: 1.6, z: -30 }, s, () => false), 'a wall between');
  assert.ok(canHear(me, { x: 20, y: 0, z: 0 }, 60, { hearing: 30 }) && !canHear(me, { x: 40, y: 0, z: 0 }, 60, { hearing: 30 }) && !canHear(me, { x: 1, y: 0, z: 0 }, 60, { hearing: 0 }));
});
test('the sentry: patrol -> investigate -> engage -> cover -> engage -> investigate -> patrol', () => {
  const b = createBrain(ARCHETYPES.sentry), f = { seesTarget: false, heardNoise: false, damaged: false, arrived: false, noCover: false, health: 1, lostFor: 99 };
  assert.equal(b.action, 'followRoute');
  assert.equal(ARCHETYPES.sentry.behaviour.states.engage.do, 'skirmish');
  assert.equal(b.step(f, 0.1), null);
  assert.deepEqual(b.step({ ...f, heardNoise: true }, 0.1), { from: 'patrol', to: 'investigate', alert: false });
  assert.equal(b.action, 'gotoLastKnown');
  const seen = b.step({ ...f, seesTarget: true, lostFor: 0 }, 0.1);
  assert.deepEqual(seen, { from: 'investigate', to: 'engage', alert: true });
  assert.equal(b.step({ ...f, seesTarget: true, lostFor: 0, health: 0.3 }, 0.1).to, 'takeCover');
  // in cover: `arrived` must hold for 2.5 s
  assert.equal(b.step({ ...f, arrived: true }, 1), null); assert.equal(b.step({ ...f, arrived: true }, 1), null);
  assert.equal(b.step({ ...f, arrived: true }, 1).to, 'engage');
  // hurt again: the cover rule fires once only
  assert.equal(b.step({ ...f, seesTarget: true, lostFor: 0, health: 0.2 }, 0.1), null);
  assert.equal(b.step({ ...f, lostFor: 4 }, 0.1).to, 'investigate');
  for (let i = 0; i < 3; i++) assert.equal(b.step({ ...f, arrived: true }, 1), null);
  assert.equal(b.step({ ...f, arrived: true }, 1).to, 'patrol');
});
test('the quadcopter: patrol -> track -> search -> patrol', () => {
  const b = createBrain(ARCHETYPES.quadcopter), f = { seesTarget: false, heardNoise: false, damaged: false, arrived: false, health: 1, lostFor: 99 };
  assert.equal(b.step({ ...f, seesTarget: true, lostFor: 0 }, 0.1).to, 'track'); assert.equal(b.action, 'orbitTarget');
  assert.equal(b.step({ ...f, lostFor: 2 }, 0.1), null);
  assert.equal(b.step({ ...f, lostFor: 6 }, 0.1).to, 'search');
  for (let i = 0; i < 31; i++) b.step(f, 1);
  assert.equal(b.state, 'patrol');
});
