// World API additions A1-A5 (docs/WORLD-API.md, "Status"): marks used with a key, words and the objective on the HUD,
// loose spawns, what the player is told, and the fade at start, death and end. Headless world; keys.held is the set of
// input actions the "player" holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { packageSource } from '../src/scene/source.js';
import { ROOT, fileFetch } from './helpers.js';
import { openHeadlessWorld, STEP } from './headless.js';

const source = () => packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch);
const HERE = { x: 20, z: 18 };
async function open(params, at = { ...HERE, heading: 0 }) {
  const h = openHeadlessWorld(source(), params); await h.world.ready();
  const log = []; h.world.on('interact', (e) => log.push({ ...e, at: h.world.snapshot().time }));
  h.world.start({ at, fadeIn: 0 }); h.run(0.1);
  return { ...h, log, mark: (id) => h.world.snapshot().entities.find((e) => e.id === id) };
}
const useMark = (z, seconds = 2) => ({ op: 'mark', id: 'm', kind: 'objective', x: HERE.x, z, use: { seconds, prompt: 'Hold E' } });

test('a mark used with a key: nothing without the key, begin at once, used after its seconds, never reached', async () => {
  const f = await open(); f.world.apply(useMark(16.5));
  assert.equal(f.mark('m').radius, 2.2); assert.deepEqual(f.mark('m').use, { prompt: 'Hold E', progress: 0 }); assert.equal(f.mark('m').state, 'open');
  f.run(3); assert.deepEqual(f.log, [], 'standing in it is not using it');
  const t0 = f.world.snapshot().time; f.keys.held.add('interact'); f.run(0.05);
  assert.equal(f.log[0].action, 'begin');
  f.run(2.1);
  const used = f.log.find((e) => e.action === 'used');
  assert.ok(used && used.at - t0 > 1.95 && used.at - t0 < 2.15, `used after ${used && used.at - t0}`);
  assert.equal(used.progress, 1); assert.equal(f.mark('m').state, 'used');
  f.run(2); assert.ok(f.log.every((e) => e.action !== 'reached') && f.log.filter((e) => e.action === 'used').length === 1);
});

test('releasing the key drains progress and reports cancel', async () => {
  const f = await open(); f.world.apply(useMark(16.5));
  f.keys.held.add('interact'); f.run(1); f.keys.held.delete('interact');
  const p = f.mark('m').use.progress; assert.ok(p > 0.4 && p < 0.6, `progress ${p}`);
  f.run(0.2); assert.ok(f.mark('m').use.progress < p, 'it falls'); assert.ok(!f.log.some((e) => e.action === 'cancel'));
  f.run(0.5); assert.ok(f.log.some((e) => e.action === 'cancel'), 'cancel within 0.7 s'); assert.equal(f.mark('m').use.progress, 0);
});

test('the player must face a mark more than 0.9 m away', async () => {
  const away = await open({}, { ...HERE, heading: 180 }); away.world.apply(useMark(16.5)); away.keys.held.add('interact'); away.run(1);
  assert.equal(away.mark('m').use.progress, 0, 'facing away at 1.5 m: no progress');
  const close = await open({}, { ...HERE, heading: 180 }); close.world.apply(useMark(17.2)); close.keys.held.add('interact'); close.run(0.5);
  assert.ok(close.mark('m').use.progress > 0, 'facing away at 0.8 m: progress');
});

test('a use mark is invalid without a prompt or with no seconds', async () => {
  const f = await open();
  for (const use of [{}, { prompt: '' }, { prompt: 'x', seconds: 0 }, { prompt: 'x', seconds: 'a' }, 'x']) assert.throws(() => f.world.apply({ ...useMark(16.5), use }), (e) => e.code === 'invalid');
});

test('objective is a value: twice is the same, clear empties it; say has channels', async () => {
  const f = await open(); const calls = () => f.hudCalls.filter((c) => c[0] === 'objective' || c[0] === 'progress');
  f.world.apply({ op: 'objective', text: 'Find it', done: 1, total: 3 }); const once = calls().slice();
  f.world.apply({ op: 'objective', text: 'Find it', done: 1, total: 3 });
  assert.deepEqual(calls().slice(once.length), once); assert.deepEqual(once, [['objective', 'Find it'], ['progress', 1, 3]]);
  f.world.apply({ op: 'clear' }); assert.deepEqual(calls().slice(-2), [['objective', ''], ['progress', 0, 0]]);
  assert.throws(() => f.world.apply({ op: 'objective', text: 'x', done: -1 }), (e) => e.code === 'invalid');
  const said = []; f.world.on('say', (e) => said.push(e));
  f.world.apply({ op: 'say', text: 'Move', channel: 'radio', who: 'Net', seconds: 5 });
  assert.deepEqual(f.hudCalls.at(-1), ['radio', 'Move', 5, 'Net']);
  f.world.apply({ op: 'say', text: 'Careful', channel: 'warn' }); assert.equal(f.hudCalls.at(-1)[0], 'warn');
  f.world.apply({ op: 'say', text: 'Plain' }); assert.equal(f.hudCalls.at(-1)[0], 'message');
  assert.deepEqual(said.map((e) => e.channel), ['radio', 'warn', 'message']);
  assert.throws(() => f.world.apply({ op: 'say', text: 'x', channel: 'shout' }), (e) => e.code === 'invalid');
});

test('spawn at: hidden prefers the place out of sight, far beats near, alerted starts looking', async () => {
  const P = { x: 150, z: -108, heading: 0 }, behind = [150, -165], clear = [150, -60];
  let hiddenChosen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const f = await open({ seed }, P); f.world.apply({ op: 'spawn', id: 't', kind: 'sentry', at: [clear, behind], hidden: true });
    const e = f.world.snapshot().entities.find((x) => x.id === 't'); if (Math.abs(e.z - behind[1]) < 0.5) hiddenChosen++;
  }
  assert.equal(hiddenChosen, 20, 'the hidden place every time');
  let far = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const f = await open({ seed }, { ...HERE, heading: 0 }); f.world.apply({ op: 'spawn', id: 't', kind: 'sentry', at: [[20, 13], [20, 58]], minDistance: 18 });
    if (Math.abs(f.world.snapshot().entities.find((x) => x.id === 't').z - 58) < 0.5) far++;
  }
  assert.equal(far, 20, 'the far place every time');
  const calm = await open({}, { x: 20, z: 18, heading: 0 }); calm.world.apply({ op: 'spawn', id: 'c', kind: 'sentry', x: 20, z: 70, heading: 0 }); calm.run(0.5);
  const alerted = await open({}, { x: 20, z: 18, heading: 0 }); alerted.world.apply({ op: 'spawn', id: 'a', kind: 'sentry', x: 20, z: 70, heading: 0, alerted: true }); alerted.run(0.5);
  assert.equal(calm.mark('c').state, 'patrol'); assert.notEqual(alerted.mark('a').state, 'patrol');
  for (const bad of [{ at: [] }, { at: [[1]] }, { at: [[1, 2]], hidden: 'yes' }, { at: [[1, 2]], minDistance: -1 }]) assert.throws(() => alerted.world.apply({ op: 'spawn', id: 'z', kind: 'sentry', ...bad }), (e) => e.code === 'invalid');
});

test('player:hit says where the shot came from; the snapshot has the weapon and the stats; settings clamp', async () => {
  const f = await open({}, { ...HERE, heading: 0 }); const hits = [];
  f.world.on('player:hit', (e) => hits.push(e));
  f.world.apply({ op: 'spawn', id: 's', kind: 'sentry', x: 20, z: 6, heading: 180 });
  for (let i = 0; i < 600 && !hits.length; i++) f.run(0.05);
  assert.ok(hits.length, 'the sentry hit the player');
  const s = f.mark('s'), from = hits[0].from; assert.ok(Math.hypot(from.x - s.x, from.z - s.z) < 1, `from ${JSON.stringify(from)} vs ${s.x},${s.z}`);
  const snap = f.world.snapshot();
  assert.deepEqual(Object.keys(snap.self.weapon).sort(), ['ammo', 'id', 'magSize', 'name', 'reserve', 'state']);
  assert.equal(snap.self.weapon.id, 'carbine'); assert.deepEqual(snap.stats, { shots: 0, hits: 0, kills: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.deepEqual(f.world.settings({ sensitivity: 9, fov: 10, volume: 0.5, invertY: true, nonsense: 1 }), { sensitivity: 3, invertY: true, volume: 0.5, fov: 60 });
  assert.deepEqual(f.world.settings(), { sensitivity: 3, invertY: true, volume: 0.5, fov: 60 });
});

test('the view fades in at start, drains at death, dims at the end; start resets it', async () => {
  const h = openHeadlessWorld(source()); await h.world.ready(); const post = h.engine().G.render.post;
  h.world.start({ at: { ...HERE } }); h.run(0.1); assert.ok(post.fade > 0.9, `fade ${post.fade}`);
  h.run(3); assert.ok(post.fade < 0.01, `fade ${post.fade}`); assert.equal(post.saturation, 1);
  h.world.apply({ op: 'end', result: 'dead' }); h.run(3);
  assert.ok(post.saturation < 0.2, `saturation ${post.saturation}`); assert.ok(post.fade > 0.5 && post.fade < 0.56, `fade ${post.fade}`);
  h.world.start({ at: { ...HERE }, fadeIn: 0 }); h.run(0.1); assert.equal(post.fade, 0); assert.equal(post.saturation, 1);
  h.world.apply({ op: 'end', result: 'complete' }); h.run(6); assert.ok(Math.abs(post.fade - 0.72) < 0.02 && Math.abs(post.saturation - 0.7) < 0.02);
  assert.throws(() => h.world.start({ fadeIn: -1 }), /fadeIn/);
});
