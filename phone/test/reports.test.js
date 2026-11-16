// A mission host hears the phone: a marker shared in ATAK near a place the host holds fires the host's rule, through
// the mission host of engine/host/mission.js, unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneCore } from '../core.js';
import { withPhoneReports, affiliationOf, placesNear } from '../reports.js';
import { runMission } from '../../engine/host/mission.js';
import { playingWorld, fakeScreen, json } from './helpers.js';

test('affiliation is read from the Cursor-on-Target type', () => {
  assert.equal(affiliationOf('a-h-G'), 'hostile'); assert.equal(affiliationOf('a-f-G-U-C'), 'friendly');
  assert.equal(affiliationOf('a-n-G'), 'neutral'); assert.equal(affiliationOf('a-u-G'), 'unknown');
  assert.equal(affiliationOf('b-m-p-s-p-i'), null); assert.equal(affiliationOf(undefined), null);
});

test('a point is near the places whose radius it lies within', () => {
  const places = [{ id: 'a', x: 0, z: 0, radius: 10 }, { id: 'b', x: 15, z: 0, radius: 10 }];
  assert.deepEqual(placesNear(places, 8, 0), ['a', 'b']); assert.deepEqual(placesNear(places, -9, 0), ['a']);
  assert.deepEqual(placesNear(places, 0, 40), []); assert.deepEqual(placesNear(places, NaN, 0), []);
});

test('a rule of the mission host fires on a marker shared near its place, and not on one shared elsewhere', async () => {
  const { world, run } = await playingWorld(), screen = fakeScreen(), phone = createPhoneCore(world, screen);
  const scenario = { start: { x: 20, z: 18, heading: 0 }, places: [{ id: 'gate', x: 60, z: -30, radius: 15 }],
    rules: [{ when: { event: 'phone', action: 'cot', affiliation: 'hostile', near: 'gate' }, do: [{ op: 'end', result: 'complete' }] }] };
  const heard = withPhoneReports(world, phone, scenario.places), all = [];
  heard.on('phone', (e) => all.push(e));
  const mission = runMission(heard, scenario); mission.start(); run(0.2);
  const share = (type, x, z) => { const g = world.geo.toGeo(x, z); screen.say('cot', { uid: 'u' + all.length, type, lat: g.lat, lon: g.lon }); };
  share('a-h-G', 200, 100); assert.equal(all.at(-1).near, null);
  share('a-f-G', 62, -28); assert.equal(all.at(-1).near, 'gate'); assert.equal(all.at(-1).affiliation, 'friendly');
  assert.equal(world.state(), 'playing', 'a friendly marker there, or a hostile one elsewhere, is not the objective');
  share('a-h-G', 62, -28);
  assert.equal(world.state(), 'complete'); assert.equal(mission.record.length, 1);
  assert.equal(typeof heard.snapshot, 'function'); assert.equal(heard.version, 1);
});

test('the Old Quebec ATAK scenario is one the mission host can run: its commands apply and its phone rule is reachable', async () => {
  const s = json('phone', 'scenarios', 'old-quebec-atak.json');
  assert.ok(s.places.length >= 1 && s.places.every((p) => typeof p.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.z) && p.radius > 0));
  const phoneRules = s.rules.filter((r) => r.when.event === 'phone');
  assert.ok(phoneRules.length >= 1, 'an objective is met on the phone');
  for (const r of phoneRules) assert.ok(s.places.some((p) => p.id === r.when.near), `rule names a place the scenario holds: ${r.when.near}`);
  assert.ok(s.objectives.every((o) => o.text && Number.isInteger(o.rule) && s.rules[o.rule]));
  // no place a report is judged against is sent to the engine as a mark
  const marks = [...s.setup, ...s.rules.flatMap((r) => r.do)].filter((c) => c.op === 'mark');
  for (const p of s.places.filter((q) => q.hidden)) assert.ok(!marks.some((m) => m.x === p.x && m.z === p.z), `${p.id} stays with the host`);
});
