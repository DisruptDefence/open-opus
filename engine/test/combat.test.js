// A fight, checked on the running engine without a screen (test/headless.js): the player's shots kill every kind of
// threat and the world reports it, and threats fight the way the archetype data says (notice, warning, turns to
// shoot, bolts, the rush, the explosion). The weapon needs WebGL, so a shot here is the weapon's own call into the
// combat module (engineOf: this repository's tests only); the trigger itself is checked in a browser
// (tools/play.mjs). Events and states are read through the world API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { packageSource } from '../src/scene/source.js';
import { DEFAULT_PACK } from '../src/content/default.js';
const ARCHETYPES = DEFAULT_PACK.threats;
import { TUNING, segmentDistanceSq } from '../src/threats/threats.js';
import { ROOT, fileFetch } from './helpers.js';
import { openHeadlessWorld, STEP } from './headless.js';

const source = () => packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch);
const RIFLE = 26; // the carbine's damage per round (the stand-in's tuning)
async function fight(spawns, at = { x: 20, z: 18, heading: 0 }) {
  const h = openHeadlessWorld(source()); await h.world.ready();
  const log = []; for (const n of ['entity', 'player:hit', 'player:dead', 'state']) h.world.on(n, (e) => log.push({ n, t: h.world.snapshot().time, ...e }));
  for (const c of spawns) h.world.apply({ op: 'spawn', ...c });
  h.world.start({ at });
  const G = h.engine().G, V = (x, y, z) => new G.THREE.Vector3(x, y, z);
  /** One round from the player's eye at a threat: its middle, or its top (`weak`). */
  const shootAt = (id, where = 'body') => {
    const t = G.threats.list.find((x) => x.id === id), b = t.def.body, eye = V(G.player.pos.x, G.player.pos.y + 1.6, G.player.pos.z);
    const aim = V(t.pos.x, t.pos.y + (t.type === 'air' ? 0 : where === 'weak' ? b.height - 0.1 : b.height * 0.5), t.pos.z);
    return G.combat.playerShot(eye, aim.sub(eye).normalize(), { damage: RIFLE });
  };
  return { ...h, G, log, shootAt, of: (id) => h.world.snapshot().entities.find((e) => e.id === id) };
}

test('segment distance: crossing, parallel, apart', () => {
  const P = (x, y, z) => ({ x, y, z });
  assert.ok(segmentDistanceSq(P(-1, 0, 0), P(1, 0, 0), P(0, -1, 0), P(0, 1, 0)) < 1e-9);
  assert.ok(Math.abs(segmentDistanceSq(P(0, 0, 0), P(4, 0, 0), P(0, 2, 0), P(4, 2, 0)) - 4) < 1e-9);
  assert.ok(Math.abs(segmentDistanceSq(P(0, 0, 0), P(1, 0, 0), P(4, 0, 4), P(4, 3, 4)) - 25) < 1e-9);
});

for (const kind of Object.keys(ARCHETYPES)) test(`the player's shots kill a ${kind}: rounds by its health, then "killed" and it is gone`, async () => {
  const f = await fight([{ id: 'x', kind, x: 20, z: 6, heading: 0 }]); // facing away, 12 m north
  f.run(0.2);
  const need = Math.ceil(ARCHETYPES[kind].body.health / RIFLE);
  for (let i = 1; i <= need; i++) {
    const hit = f.shootAt('x');
    assert.ok(hit && hit.enemy, `round ${i} hit the threat`);
    assert.equal(!!hit.killed, i === need, `round ${i} of ${need}`);
  }
  const killed = f.log.filter((e) => e.n === 'entity' && e.change === 'killed');
  assert.equal(killed.length, 1); assert.equal(killed[0].id, 'x'); assert.equal(killed[0].alive, false); assert.equal(killed[0].archetype, kind);
  assert.equal(f.of('x').alive, false);
  assert.equal((f.shootAt('x') || {}).enemy ?? null, null, 'a dead threat stops no bullet');
  f.run(TUNING.wreckSeconds + 1);
  assert.equal(f.of('x'), undefined, 'the wreck is removed');
  assert.ok(f.log.some((e) => e.n === 'entity' && e.change === 'despawn' && e.id === 'x'));
});

test('a round counts by the zone it hits: a head round kills a sentry, a leg round counts 0.7; being shot at turns it on the player', async () => {
  const Z = ARCHETYPES.sentry.zones;
  const f = await fight([{ id: 's', kind: 'sentry', x: 20, z: 6, heading: 0 }, { id: 't', kind: 'sentry', x: 24, z: 6, heading: 0 }]);
  f.run(0.2);
  const hit = f.shootAt('s', 'weak');
  assert.equal(hit.part, 'head', 'the top of a person is its head');
  assert.equal(hit.killed, Z.head * RIFLE >= ARCHETYPES.sentry.body.health, 'a head round kills when the zone says so');
  const t = f.G.threats.list.find((x) => x.id === 't'), knee = t.figure.joints().knL;
  const leg = f.G.combat.playerShot(f.G.player.pos.clone().setY(f.G.player.pos.y + 1.6), knee.clone().sub(f.G.player.pos.clone().setY(f.G.player.pos.y + 1.6)).normalize(), { damage: RIFLE });
  assert.equal(leg.part, 'leg');
  assert.ok(Math.abs(t.health - (90 - RIFLE * Z.leg)) < 1e-6, `health ${t.health}`);
  f.run(0.3);
  assert.ok(f.log.some((e) => e.n === 'entity' && e.change === 'state' && e.id === 't' && e.from === 'patrol' && e.state === 'engage'));
});

test('a crawler still has its weak point, its head: 2.2 times', async () => {
  const f = await fight([{ id: 'c', kind: 'crawler', x: 20, z: 6, heading: 90 }]);
  f.run(0.2);
  const t = f.G.threats.list[0], head = t.figure.headPos.clone(), from = head.clone().add(new f.G.THREE.Vector3(6, 0, 0)); // level, from in front of it
  const hit = f.G.combat.playerShot(from, head.sub(from).normalize(), { damage: RIFLE });
  assert.equal(hit.part, 'weak');
  assert.ok(Math.abs(t.health - (ARCHETYPES.crawler.body.health - RIFLE * 2.2)) < 1e-6);
});

test('a person hit while it aims stops: the burst is cancelled and it does not shoot for the 0.4 s after', async () => {
  const f = await fight([{ id: 's', kind: 'sentry', x: 20, z: 6, heading: 180 }]); // 12 m away, facing the player
  const fires = [], warns = []; f.G.events.on('enemy:fire', () => fires.push(f.G.time.t)); f.G.events.on('enemy:telegraph', () => warns.push(f.G.time.t));
  for (let i = 0; i < 600 && !warns.length; i++) f.run(STEP);
  assert.ok(warns.length, 'it warned');
  f.run(0.2); // in the middle of the warning (0.5 s)
  const t = f.G.threats.list[0], at = f.G.time.t; assert.equal(t.atk, 'tele');
  const eye = f.G.player.pos.clone().setY(f.G.player.pos.y + 1.6), chest = t.figure.joints().chest;
  assert.equal(f.G.combat.playerShot(eye, chest.sub(eye).normalize(), { damage: RIFLE }).part, 'torso');
  assert.equal(t.atk, 'idle', 'the burst is off');
  f.run(ARCHETYPES.sentry.reactions.aimSpoil - 0.02);
  assert.equal(fires.filter((x) => x > at).length, 0, 'no round in the spoiled 0.4 s');
  assert.equal(warns.filter((x) => x > at).length, 0, 'no new warning either');
  for (let i = 0; i < 600 && !fires.some((x) => x > at); i++) f.run(STEP);
  assert.ok(fires.some((x) => x > at + ARCHETYPES.sentry.reactions.aimSpoil), 'then it fights on');
});

test('a person hit in the leg limps: it moves at the limp share of its speed until the limp wears off', async () => {
  const f = await fight([{ id: 's', kind: 'sentry', x: 20, z: -14, heading: 180, alerted: true }]); // 32 m away: it runs in to fight
  const t = () => f.G.threats.list[0], speed = () => Math.hypot(t().vel.x, t().vel.z);
  let before = 0; for (let i = 0; i < 90; i++) { f.run(STEP); before = Math.max(before, speed()); }
  const R = ARCHETYPES.sentry.reactions, run = ARCHETYPES.sentry.body.speed.engage;
  assert.ok(before > run * 0.8, `it ran (${before.toFixed(2)} m/s)`);
  const eye = f.G.player.pos.clone().setY(f.G.player.pos.y + 1.6), knee = t().figure.joints().knR;
  assert.equal(f.G.combat.playerShot(eye, knee.sub(eye).normalize(), { damage: RIFLE }).part, 'leg');
  let limping = 0; for (let i = 0; i < 120; i++) { f.run(STEP); limping = Math.max(limping, speed()); }
  assert.ok(limping <= run * R.limpSpeed + 1e-6, `limping at ${limping.toFixed(2)} m/s, at most ${(run * R.limpSpeed).toFixed(2)}`);
  f.run(R.limpSeconds); let after = 0; for (let i = 0; i < 240; i++) { f.run(STEP); after = Math.max(after, speed()); }
  assert.ok(after > run * R.limpSpeed + 0.2 || t().brain.action !== 'skirmish', `the limp wore off (${after.toFixed(2)} m/s)`);
});

test('a threat notices after its notice time, warns for its aim time, then shoots; the player is told from where', async () => {
  const f = await fight([{ id: 's', kind: 'sentry', x: 20, z: 6, heading: 180 }]); // 12 m away, facing the player
  const seen = []; f.G.events.on('enemy:telegraph', (e) => seen.push(['warn', f.G.time.t, e.time])); f.G.events.on('enemy:fire', () => seen.push(['fire', f.G.time.t]));
  let from = null; f.G.events.on('player:hit', (e) => { from = e.fromPos; });
  f.run(0.3);
  assert.equal(f.of('s').state, 'patrol', 'not at once');
  for (let i = 0; i < 400 && !seen.some((e) => e[0] === 'fire'); i++) f.run(0.05);
  const engaged = f.log.find((e) => e.n === 'entity' && e.change === 'state' && e.state === 'engage');
  assert.ok(engaged.t >= ARCHETYPES.sentry.senses.notice - 0.2 && engaged.t < ARCHETYPES.sentry.senses.notice + 0.4, `engaged at ${engaged.t}`);
  assert.equal(seen[0][0], 'warn'); assert.equal(seen[0][2], ARCHETYPES.sentry.weapon.aimTime);
  const fire = seen.find((e) => e[0] === 'fire');
  assert.ok(Math.abs(fire[1] - seen[0][1] - ARCHETYPES.sentry.weapon.aimTime) < 3 * STEP, 'the burst follows the warning by the aim time');
  for (let i = 0; i < 600 && !from; i++) f.run(0.05);
  assert.ok(from && Number.isFinite(from.x), 'player:hit says where the shot came from');
  assert.equal(f.log.find((e) => e.n === 'player:hit').amount, ARCHETYPES.sentry.weapon.damage);
});

test('only two threats shoot at a time, and their bursts start at least the token gap apart', async () => {
  const f = await fight([0, 1, 2, 3, 4].map((i) => ({ id: 's' + i, kind: 'sentry', x: 12 + i * 4, z: 6, heading: 180 })));
  f.G.player.invulnerable = true;
  const starts = []; f.G.events.on('enemy:telegraph', () => starts.push(f.G.time.t));
  let most = 0, shooters = new Set();
  for (let i = 0; i < 1500; i++) { f.run(STEP); const busy = f.G.threats.list.filter((t) => t.atk !== 'idle'); most = Math.max(most, busy.length); busy.forEach((t) => shooters.add(t.id)); }
  assert.ok(most >= 1 && most <= TUNING.maxTokens, `${most} shooting at once`);
  assert.ok(starts.length > 4, 'they did shoot');
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= TUNING.tokenGap - 1e-6, `bursts ${starts[i - 1]} and ${starts[i]}`);
  assert.ok(shooters.size >= 3, 'the turn passes round');
});

test('a quadcopter shoots bolts that fly: they hurt a player who stands and pass one who has moved away', async () => {
  const f = await fight([{ id: 'q', kind: 'quadcopter', x: 20, z: 0, heading: 180 }]);
  let fired = 0, hits = 0; f.G.events.on('enemy:fire', () => fired++); f.world.on('player:hit', (e) => { hits++; assert.equal(e.amount, ARCHETYPES.quadcopter.weapon.damage); });
  let flying = 0;
  for (let i = 0; i < 3000 && hits === 0; i++) { f.run(STEP); flying = Math.max(flying, f.G.threats.bolts().length); }
  assert.ok(fired > 0 && flying > 0, 'bolts were in the air');
  assert.ok(hits > 0, 'a standing player is hit');
  assert.equal(f.of('q').state, 'track');
  // a bolt in flight towards where the player was: step aside and it misses
  const before = f.world.snapshot().self.health; let dodged = false;
  for (let i = 0; i < 6000 && !dodged; i++) {
    f.run(STEP);
    if (f.G.threats.bolts().length && f.world.snapshot().self.health === before) { f.world.apply({ op: 'place', x: 20 + (i % 2 ? 9 : -9), z: 18, now: true }); const n = hits; f.run(1.4); dodged = hits === n; }
  }
  assert.ok(dodged, 'bolts already fired do not follow the player');
});

test('a crawler rushes a player within three metres: a warning, then melee damage', async () => {
  const f = await fight([{ id: 'c', kind: 'crawler', x: 20, z: 15.6, heading: 180 }]);
  const seen = []; f.G.events.on('enemy:telegraph', (e) => seen.push(e.melee ? 'rush-warning' : 'burst-warning')); f.G.events.on('enemy:melee', () => seen.push('melee'));
  for (let i = 0; i < 600 && !seen.includes('melee'); i++) f.run(STEP);
  assert.deepEqual(seen.filter((s) => s !== 'burst-warning'), ['rush-warning', 'melee']);
  assert.ok(f.log.some((e) => e.n === 'player:hit' && e.amount === ARCHETYPES.crawler.melee.damage));
});

test('a quadcopter shot down falls, explodes where it lands and hurts whoever stands there', async () => {
  const f = await fight([{ id: 'q', kind: 'quadcopter', x: 20, z: 17, heading: 0 }]);
  f.run(0.1);
  const t = f.G.threats.list[0]; t.pos.set(f.G.player.pos.x + 0.5, f.G.player.pos.y + 5, f.G.player.pos.z); t.vel.set(0, 0, 0); // just overhead
  let boom = 0; f.world.on('player:hit', (e) => { boom = e.amount; });
  f.shootAt('q'); f.shootAt('q');
  assert.equal(f.of('q').alive, false);
  f.run(3);
  assert.equal(f.of('q'), undefined, 'it is gone after the explosion');
  assert.ok(boom > 0 && boom <= ARCHETYPES.quadcopter.death.explode.damage * 0.5, `the blast hurt the player (${boom})`);
});

test('the music follows the fight: calm, then in contact', async () => {
  const f = await fight([{ id: 's', kind: 'sentry', x: 120, z: 80, heading: 0 }]);
  f.run(0.5); assert.equal(f.G.threats.intensity, 0.15);
  f.world.apply({ op: 'spawn', id: 'n', kind: 'sentry', x: 20, z: 8, heading: 180 });
  f.run(2); assert.equal(f.G.threats.intensity, 1);
});
