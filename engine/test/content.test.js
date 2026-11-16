// Content packs (docs/CONTENT-PACK.md): validation, merging, and a product's threat reaching the running world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { packageSource } from '../src/scene/source.js';
import { DEFAULT_PACK } from '../src/content/default.js';
import { validatePack, mergePacks } from '../src/content/pack.js';
import { validateBehaviour } from '../src/threats/brain.js';
import { ROOT, fileFetch } from './helpers.js';
import { openHeadlessWorld } from './headless.js';

const source = () => packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch);
const v = (p) => validatePack(p, { validateBehaviour });
const copy = (o) => JSON.parse(JSON.stringify(o));

test('the default pack is valid', () => assert.deepEqual(v(DEFAULT_PACK), []));

test('a bad pack gives one message per fault, each naming its subject', () => {
  const bad = copy(DEFAULT_PACK);
  bad.format = 'nope';
  bad.threats.sentry.behaviour.states.patrol.on[0].if = 'telepathy';
  bad.weapons.carbine.magSize = 0;
  bad.loadout = ['railgun'];
  const e = v(bad);
  assert.equal(e.length, 4, e.join(' | '));
  assert.ok(e.some((m) => /format/.test(m)) && e.some((m) => /sentry/.test(m) && /telepathy/.test(m)) && e.some((m) => /carbine/.test(m) && /magSize/.test(m)) && e.some((m) => /railgun/.test(m)));
});

test('mergePacks replaces a threat whole, keeps the others, and changes neither argument', () => {
  const before = copy(DEFAULT_PACK), sentry = copy(DEFAULT_PACK.threats.sentry);
  sentry.body.health = 10;
  const extra = { threats: { sentry }, threatTuning: { maxTokens: 4 }, hud: { words: { objective: 'Task' } }, loadout: ['carbine'] }, extraBefore = copy(extra);
  const m = mergePacks(DEFAULT_PACK, extra);
  assert.equal(m.threats.sentry.body.health, 10);
  assert.deepEqual(m.threats.crawler, DEFAULT_PACK.threats.crawler);
  assert.deepEqual(m.threats.quadcopter, DEFAULT_PACK.threats.quadcopter);
  assert.equal(m.threatTuning.maxTokens, 4); assert.equal(m.threatTuning.tokenGap, 1.25);
  assert.equal(m.hud.words.objective, 'Task'); assert.equal(m.hud.words.health, 'Health'); assert.deepEqual(m.hud.elements, DEFAULT_PACK.hud.elements);
  assert.deepEqual(DEFAULT_PACK, before); assert.deepEqual(extra, extraBefore);
  assert.deepEqual(v(m), []);
});

test('a product adds a threat kind through the pack, and without it the kind is unknown', async () => {
  const drone2 = { ...copy(DEFAULT_PACK.threats.quadcopter), id: 'drone2' }; drone2.body.health = 10;
  const h = openHeadlessWorld(source(), {}, { content: { format: 'opus-content/1', id: 'product', threats: { drone2 } } }); await h.world.ready();
  h.world.apply({ op: 'spawn', id: 'd', kind: 'drone2', x: 20, z: 18 });
  assert.equal(h.world.snapshot().entities.find((e) => e.id === 'd').archetype, 'drone2');
  const plain = openHeadlessWorld(source()); await plain.world.ready();
  assert.throws(() => plain.world.apply({ op: 'spawn', id: 'd', kind: 'drone2', x: 20, z: 18 }), (e) => e.code === 'unknown-kind');
});

test('an invalid pack makes ready() reject', async () => {
  const h = openHeadlessWorld(source(), {}, { content: { format: 'nope' } });
  await assert.rejects(h.world.ready(), /content pack/);
});
