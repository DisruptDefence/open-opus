import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseLicence, rankCandidates, dropReason } from '../lib/rank.mjs';
import { haversine, bearingTo, angDiff, viewGeo } from '../lib/geo.mjs';

const view = { lat: 10, lon: 20, headingTrue: 90 };
const cand = (id, o = {}) => ({ id, source: 'commons', title: 'A street ' + id, licence: 'CC BY-SA 4.0', mime: 'image/jpeg', width: 1600, height: 1000, lat: 10, lon: 20, heading: null, date: '2020-06-01', ...o });
const at = (m, bearing = 0) => ({ lat: 10 + (m * Math.cos((bearing * Math.PI) / 180)) / 111195, lon: 20 + (m * Math.sin((bearing * Math.PI) / 180)) / (111195 * Math.cos((10 * Math.PI) / 180)) });

test('licence: only CC0, public domain, CC BY and CC BY-SA, any version; everything else or unknown is dropped', () => {
  for (const [s, n] of [['CC0', 'CC0'], ['Public domain', 'Public domain'], ['CC BY 2.0', 'CC BY 2.0'], ['CC BY-SA 3.0', 'CC BY-SA 3.0'], ['CC-BY-SA-4.0', 'CC BY-SA 4.0'], ['CC BY 2.5', 'CC BY 2.5'], ['cc-by-sa-2.5', 'CC BY-SA 2.5']]) assert.equal(normaliseLicence(s), n, s);
  for (const s of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'GFDL', 'Fair use', '', null, undefined, 'All rights reserved', 'Attribution', 'Copyrighted free use']) assert.equal(normaliseLicence(s), null, String(s));
  assert.equal(rankCandidates([cand('a', { licence: 'CC BY-NC 4.0' }), cand('b', { licence: '' }), cand('c', { licence: 'GFDL' })], view).kept.length, 0);
});
test('rules: size, tall pictures, subject words, scans, wrong type, far away, facing away', () => {
  const why = (o) => dropReason(cand('x', o), view, 80);
  assert.equal(why({}), null); assert.equal(why({ width: 700 }), 'small'); assert.equal(why({ width: 1000, height: 1300 }), 'tall'); assert.equal(why({ mime: 'image/tiff' }), 'type');
  assert.equal(why({ title: 'Interior of the museum' }), 'subject'); assert.equal(why({ title: 'Rue de nuit' }), 'subject'); assert.equal(why({ date: '1952-01-01' }), 'old'); assert.equal(why({ date: '' }), null);
  assert.equal(why({ title: 'Pews in the church' }), 'subject'); assert.equal(why({ categories: 'Paintings of the town' }), 'subject'); assert.equal(why({ title: 'Marché de Noël' }), 'subject'); assert.equal(why({ title: 'Rue du Plan 3' }), 'subject', 'whole word plan'); assert.equal(why({ title: 'Planet street' }), null);
  const north = (d) => dropReason(cand('n', { date: d, lat: 46, lon: 20 }), { ...view, lat: 46 }, 80); assert.equal(north('2019-03-02 11:00:00'), 'winter'); assert.equal(north('2019-07-02 22:10:00'), 'not daytime'); assert.equal(why({ date: '2019-07-02 11:00:00' }), null); assert.equal(why({ date: '2019-07-02 00:00:00' }), null, 'a date without a time'); assert.equal(dropReason(cand('s', { date: '2019-01-02 11:00:00', lat: -33 }), { ...view, lat: -33 }, 80), null, 'January is summer in the south');
  assert.equal(why({ ...at(200) }), 'far'); assert.equal(why({ heading: 270 }), 'facing away'); assert.equal(why({ heading: 150 }), null);
});
test('ranking: nearer first; unknown heading after a match within 40 degrees and before a mismatch; newest among equals', () => {
  const list = [
    cand('mismatch', { ...at(5), heading: 180 }), cand('unknown', { ...at(5) }), cand('match', { ...at(5), heading: 100 }),
    cand('near', { ...at(2), heading: 95 }), cand('far', { ...at(60), heading: 90 }),
    cand('old', { ...at(30), date: '2012-01-01' }), cand('new', { ...at(30), date: '2022-01-01' }),
  ];
  const r = rankCandidates(list, view, { perView: 10 }).kept.map((c) => c.id);
  assert.ok(r.indexOf('match') < r.indexOf('unknown') && r.indexOf('unknown') < r.indexOf('mismatch'), r.join());
  assert.equal(r[0], 'near'); assert.ok(r.indexOf('new') < r.indexOf('old')); assert.ok(r.indexOf('far') > r.indexOf('match'));
  assert.equal(rankCandidates(list, view, { perView: 3 }).kept.length, 3);
  assert.equal(rankCandidates([cand('a'), cand('a')], view).kept.length, 1, 'duplicates merged');
  assert.deepEqual(rankCandidates([cand('a', { width: 100 })], view).dropped, { small: 1 });
});
test('geometry: distance, bearing, angle difference; viewpoint conversion uses the scene georef and the grid-to-true correction', () => {
  assert.ok(Math.abs(haversine(10, 20, 10.001, 20) - 111.2) < 0.5); assert.ok(Math.abs(bearingTo(10, 20, 10, 20.001) - 90) < 0.01); assert.equal(angDiff(350, 10), 20);
  const g = { zone: 19, hemisphere: 'N', easting: 331641, northing: 5186615, h0: 0, vertical: { geoid_undulation: -27.6 }, convergence_deg: -1.6094 };
  const p = viewGeo(g, { x: 0, z: 0, heading: 52 }); assert.ok(Math.abs(p.lat - 46.8118) < 1e-3 && Math.abs(p.lon + 71.2068) < 1e-3); assert.ok(Math.abs(p.headingTrue - 50.3906) < 1e-6);
  assert.ok(viewGeo(g, { x: 0, z: -100, heading: 0 }).lat > p.lat, 'minus z is north');
});
