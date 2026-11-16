import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGeoref, convergenceDeg, utmForward, utmInverse } from '../src/geo/georef.js';
import { ROOT, oldQuebec } from './helpers.js';

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
// SCENE-FORMAT.md 2.2, as written there
const BLOCK = { crs: 'EPSG:32619', projection: 'utm', zone: 19, band: 'T', hemisphere: 'N', easting: 331641, northing: 5186615, h0: 0,
  anchor: { lat: 46.8118, lon: -71.20680171 }, vertical: { datum: 'CGVD2013', geoid_undulation: -27.6 }, convergence_deg: -1.6094 };

test('a georeference block is read exactly as the format writes it: anchor, axes, MGRS, convergence', () => {
  const geo = createGeoref(BLOCK);
  const a = geo.toGeo(0, 0, 10);
  assert.ok(Math.abs(a.lat - 46.8118) < 1e-5 && Math.abs(a.lon + 71.20680171) < 1e-5, `anchor ${a.lat}, ${a.lon}`);
  // +x is east, -z is north
  assert.ok(geo.toGeo(100, 0).lon > a.lon && geo.toGeo(0, -100).lat > a.lat);
  const m = geo.toMGRS(0, 0);
  assert.deepEqual(m, { zone: '19T', square: 'CM', easting: '31641', northing: '86615' });
  assert.equal(geo.toMGRS(12.9, -7.9).easting, '31653'); // truncated, not rounded
  assert.equal(geo.toMGRS(12.9, -7.9, 3).northing, '866');
  // a block without convergence_deg gets the computed one, which agrees with the builder's
  const { convergence_deg: _, ...bare } = BLOCK;
  assert.ok(Math.abs(createGeoref(bare).convergenceDeg + 1.6094) < 0.001);
  // yaw 0 looks grid north; true heading adds the convergence
  assert.equal(geo.headingGrid(0), 0);
  assert.ok(Math.abs(geo.headingGrid(-Math.PI / 2) - 90) < 1e-9);
  assert.ok(Math.abs(geo.headingTrue(0) - (360 - 1.6094)) < 1e-9);
  const back = geo.toGame(a.lat, a.lon);
  assert.ok(Math.hypot(back.x, back.z) < 0.001);
});
test('height above the ellipsoid is y + h0 + vertical.geoid_undulation, and a block without them is refused', () => {
  // the format's rule (2.2): what a TAK client is fed as its GPS height
  assert.equal(createGeoref(BLOCK).toGeo(0, 0, 10).hae, 10 - 27.6);
  assert.ok(Math.abs(createGeoref({ ...BLOCK, h0: 40, vertical: { datum: 'x', geoid_undulation: 12.5 } }).toGeo(5, 5, 10).hae - 62.5) < 1e-9);
  const { h0: _, ...noH0 } = BLOCK;
  assert.equal(createGeoref(noH0).toGeo(0, 0, 10).hae, 10 - 27.6, 'h0 is 0 unless stated');
  // spellings the format does not have: each would once have been read as "no undulation", 27.6 m wrong and silent
  assert.throws(() => createGeoref({ ...BLOCK, vertical: 'metres above CGVD2013' }), /geoid_undulation/);
  assert.throws(() => createGeoref({ ...BLOCK, vertical: { geoidUndulation: -27.6 } }), /geoid_undulation/);
  assert.throws(() => createGeoref({ ...BLOCK, vertical: undefined, anchor: { hae: -27.6 } }), /geoid_undulation/);
  assert.throws(() => createGeoref({ utm: { zone: 19, hemisphere: 'N' }, anchor: { e0: 331641, n0: 5186615 }, vertical: { geoid_undulation: 0 } }), /easting/);
  assert.throws(() => createGeoref({ ...BLOCK, h0: 'low' }), /h0/);
});
for (const [name, read] of [['the test scene', () => JSON.parse(readFileSync(join(ROOT, 'scenes', 'test', 'client.json'), 'utf8'))], ['Old Quebec', oldQuebec]]) {
  test(`${name}: the committed georeference is the format's and its check points hold`, () => {
    const m = read(), r = m.georef, geo = createGeoref(r);
    for (const k of ['crs', 'projection', 'zone', 'band', 'hemisphere', 'easting', 'northing', 'h0', 'anchor', 'vertical', 'convergence_deg', 'checks']) assert.ok(r[k] !== undefined, `georef.${k}`);
    assert.equal(typeof r.vertical.datum, 'string'); assert.deepEqual(Object.keys(r.anchor).sort(), ['lat', 'lon']);
    assert.ok(m.play && m.extent, 'play and extent sit beside the block');
    assert.ok(Number.isInteger(r.easting) && Number.isInteger(r.northing), 'the anchor is a whole metre');
    assert.ok(Math.abs(geo.convergenceDeg - convergenceDeg(geo.anchorGeo.lat, geo.anchorGeo.lon, r.zone)) < 0.001);
    assert.ok(r.checks.length >= 5);
    for (const c of r.checks) {
      const p = geo.toGeo(c.x, c.z, 12), g = geo.toGame(c.lat, c.lon), mg = geo.toMGRS(c.x, c.z);
      // 0.1 m inside the scene (2.3); 1e-6 degrees is about that
      assert.ok(Math.abs(p.lat - c.lat) < 1e-6 && Math.abs(p.lon - c.lon) < 1e-6, `toGeo at ${c.x},${c.z}`);
      assert.ok(Math.hypot(g.x - c.x, g.z - c.z) < 0.1, `toGame at ${c.x},${c.z}`);
      assert.equal(mg.zone + mg.square + mg.easting + mg.northing, c.mgrs);
      assert.equal(p.hae, 12 + r.h0 + r.vertical.geoid_undulation, 'the height a TAK client is fed');
    }
  });
}
