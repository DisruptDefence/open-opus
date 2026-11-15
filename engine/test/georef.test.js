import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGeoref, utmForward, utmInverse } from '../src/geo/georef.js';
import { ROOT } from './helpers.js';

test('UTM forward on the central meridian: false easting, and the meridian arc to the pole', () => {
  const eq = utmForward(0, -69, 19); // zone 19's central meridian is 69 W
  assert.ok(Math.abs(eq.easting - 500000) < 1e-6 && Math.abs(eq.northing) < 1e-6);
  // WGS 84 meridian quadrant is 10 001 965.729 m; the grid scales it by 0.9996
  const pole = utmForward(90, -69, 19);
  assert.ok(Math.abs(pole.northing - 0.9996 * 10001965.729) < 0.01, `northing ${pole.northing}`);
  // one degree east of the central meridian on the equator: 0.9996 x the arc, plus the series terms (111.3 km)
  const e1 = utmForward(0, -68, 19);
  assert.ok(Math.abs(e1.easting - 500000 - 111277.6) < 60, `easting ${e1.easting}`);
  assert.equal(utmForward(-10, -69, 19, true).northing > 8e6, true); // false northing in the south
});
test('UTM inverse undoes forward to a millimetre, both hemispheres', () => {
  for (const [lat, lon, zone, south] of [[46.8118, -71.2068, 19, false], [0.01, 3.2, 31, false], [-33.86, 151.21, 56, true], [63.9, 9.5, 32, false]]) {
    const u = utmForward(lat, lon, zone, south), g = utmInverse(u.easting, u.northing, zone, south), v = utmForward(g.lat, g.lon, zone, south);
    assert.ok(Math.hypot(v.easting - u.easting, v.northing - u.northing) < 0.001);
    assert.ok(Math.abs(g.lat - lat) < 1e-8 && Math.abs(g.lon - lon) < 1e-8);
  }
});
test('the Old Quebec georeference: anchor, axes, MGRS, convergence', () => {
  // the block as the first Old Quebec scene file spells it (values read from game/scenes/old-quebec.json)
  const geo = createGeoref({ zone: 19, band: 'T', hemisphere: 'N', easting: 331641, northing: 5186615, anchor: { lat: 46.8118, lon: -71.20680171, hae: -27.6 }, convergence_deg: -1.6094 });
  const a = geo.toGeo(0, 0, 10);
  assert.ok(Math.abs(a.lat - 46.8118) < 1e-5 && Math.abs(a.lon + 71.20680171) < 1e-5, `anchor ${a.lat}, ${a.lon}`);
  assert.equal(a.hae, 10 - 27.6);
  // +x is east, -z is north
  assert.ok(geo.toGeo(100, 0).lon > a.lon && geo.toGeo(0, -100).lat > a.lat);
  const m = geo.toMGRS(0, 0);
  assert.deepEqual(m, { zone: '19T', square: 'CM', easting: '31641', northing: '86615' });
  assert.equal(geo.toMGRS(12.9, -7.9).easting, '31653'); // truncated, not rounded
  assert.equal(geo.toMGRS(12.9, -7.9, 3).northing, '866');
  // computed convergence agrees with the builder's
  const own = createGeoref({ zone: 19, hemisphere: 'N', easting: 331641, northing: 5186615 });
  assert.ok(Math.abs(own.convergenceDeg + 1.6094) < 0.001, `convergence ${own.convergenceDeg}`);
  // yaw 0 looks grid north; true heading adds the convergence
  assert.equal(geo.headingGrid(0), 0);
  assert.ok(Math.abs(geo.headingGrid(-Math.PI / 2) - 90) < 1e-9);
  assert.ok(Math.abs(geo.headingTrue(0) - (360 - 1.6094)) < 1e-9);
  const back = geo.toGame(a.lat, a.lon);
  assert.ok(Math.hypot(back.x, back.z) < 0.001);
});
test('the test scene manifest: the SCENE-FORMAT spelling and its check points', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'scenes', 'test', 'client.json'), 'utf8'));
  const geo = createGeoref(m.georef);
  assert.equal(geo.e0 % 1000, 0); assert.equal(geo.n0 % 1000, 0); // whole-kilometre anchor
  assert.ok(m.georef.checks.length >= 5);
  for (const c of m.georef.checks) {
    const g = geo.toGame(c.lat, c.lon), mg = geo.toMGRS(c.x, c.z);
    assert.ok(Math.hypot(g.x - c.x, g.z - c.z) < 0.01, `check ${c.x},${c.z}`);
    assert.equal(mg.zone + mg.square + mg.easting + mg.northing, c.mgrs);
    // the last five digits are (e0 mod 100000) + x and (n0 mod 100000) - z
    assert.equal(+mg.easting, (geo.e0 % 100000) + c.x); assert.equal(+mg.northing, (geo.n0 % 100000) - c.z);
  }
});
