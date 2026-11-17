import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZones, zoneOf, groupColours, gridCentres, ZONE } from '../lib/zone.mjs';
import { enricherFile, FORMAT } from '../lib/output.mjs';
import { srgb8ToLab } from '../../lib/color.mjs';

const lab = (r, g, b) => srgb8ToLab(r, g, b).map((v) => +v.toFixed(1));
const wall = (material, rgb, share, extra = {}) => { const l = lab(...rgb); return { material, hex: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), lab: l, share, chroma: Math.hypot(l[1], l[2]), ...extra }; };
const photo = (id, walls, o = {}) => ({ id, weight: 1, lat: 0, lon: 0, walls, accents: [], roofs: [], ...o });
const BRICK = [150, 70, 50], BRICK2 = [156, 74, 54], WHITE = [236, 234, 228], STONE = [150, 144, 130];

test('clusters of one material and nearly one colour merge into one wall colour; the colour is the weighted median', () => {
  const z = zoneOf({ lat: 0, lon: 0 }, [photo('a', [wall('brick', BRICK, 0.5)]), photo('b', [wall('brick', BRICK2, 0.5)]), photo('c', [wall('brick', BRICK, 0.4), wall('painted_white', WHITE, 0.4)])], 80);
  assert.equal(z.walls.filter((w) => w.material === 'brick').length, 1);
  assert.ok(z.walls.find((w) => w.material === 'painted_white'));
  assert.equal(Math.round(z.walls.reduce((s, w) => s + w.share, 0) * 100), 100, 'shares add up to 1');
  assert.equal(z.photographs, 3);
});
test('shares follow the photograph weight: a half-weight photograph counts half', () => {
  const z = zoneOf({ lat: 0, lon: 0 }, [photo('a', [wall('brick', BRICK, 0.5)]), photo('b', [wall('brick', BRICK, 0.5)]), photo('c', [wall('painted_white', WHITE, 0.5)], { weight: 0.5 }), photo('d', [wall('painted_white', WHITE, 0.5)], { weight: 0.5 })], 80);
  assert.ok(Math.abs(z.walls.find((w) => w.material === 'brick').share - 2 / 3) < 0.01);
});
test('unknown clusters, shadows and over-saturated colours are not wall colours, but are counted as unclassified', () => {
  const z = zoneOf({ lat: 0, lon: 0 }, [1, 2, 3].map((i) => photo('p' + i, [wall('brick', BRICK, 0.4), wall('unknown', [90, 90, 90], 0.3), wall('render', [20, 20, 20], 0.2), wall('render', [120, 120, 120], 0.1)])), 80);
  assert.deepEqual(z.walls.map((w) => w.material), ['brick']); assert.ok(z.unclassifiedShare > 0.5, String(z.unclassifiedShare));
});
test('a dark colourless cluster is shade, not a wall colour; a dark brown one is kept', () => {
  const ps = [1, 2, 3].map((i) => photo('p' + i, [wall('stone', [80, 80, 78], 0.4), wall('brick', [110, 60, 45], 0.3), wall('stone', [170, 166, 150], 0.3)]));
  const z = zoneOf({ lat: 0, lon: 0 }, ps, 80);
  assert.deepEqual(z.walls.map((w) => w.material).sort(), ['brick', 'stone']); assert.ok(z.walls.every((w) => w.colour !== '#50504e'));
});
test('a colour seen in one photograph only is dropped in a zone of four or more photographs', () => {
  const ps = [photo('a', [wall('brick', BRICK, 0.5)]), photo('b', [wall('brick', BRICK, 0.5)]), photo('c', [wall('brick', BRICK, 0.5)]), photo('d', [wall('painted_white', WHITE, 0.5)])];
  assert.deepEqual(zoneOf({ lat: 0, lon: 0 }, ps, 80).walls.map((w) => w.material), ['brick']);
  assert.equal(zoneOf({ lat: 0, lon: 0 }, ps.slice(2), 80).walls.length, 2, 'with only two photographs there is no such filter');
});
test('sunlit and shaded versions of one paint, already merged per photograph, are one colour in the zone; two paints are two', () => {
  const g = groupColours([{ lab: lab(...BRICK), w: 1, photo: 'a' }, { lab: lab(...BRICK2), w: 1, photo: 'b' }, { lab: lab(...WHITE), w: 1, photo: 'c' }], ZONE.mergeDeltaE);
  assert.equal(g.length, 2);
});
test('zones: a disc around each centre; fewer than 3 usable photographs drops the zone', () => {
  const ps = ['a', 'b', 'c'].map((id, i) => photo(id, [wall('brick', BRICK, 0.5)], { lat: 0.0001 * i, lon: 0 }));
  const far = photo('z', [wall('brick', BRICK, 0.5)], { lat: 0.5, lon: 0.5 });
  const zones = buildZones([{ id: 'here', lat: 0, lon: 0 }, { id: 'there', lat: 0.5, lon: 0.5 }], [...ps, far], { radius: 80 });
  assert.deepEqual(zones.map((z) => z.id), ['here']); assert.equal(zones[0].photographs, 3);
  assert.deepEqual(buildZones([{ id: 'here', lat: 0, lon: 0 }], ps.map((p) => ({ ...p, weight: p.id === 'a' ? 0 : 1 })), { radius: 80 }), [], 'a left-out photograph does not count');
});
test('--grid: centres from the photographs\' own positions where there are enough, away from the viewpoints', () => {
  const near = (lat, lon, id) => photo(id, [], { lat, lon });
  const ps = [near(0.0100, 0, 'a'), near(0.0100, 0.0002, 'b'), near(0.0101, 0.0001, 'c'), near(0.5, 0.5, 'lonely')];
  const g = gridCentres(ps, [{ lat: 0, lon: 0 }], { minPhotos: 3 });
  assert.equal(g.length, 1); assert.ok(Math.abs(g[0].lat - 0.01003) < 0.0001);
  assert.deepEqual(gridCentres(ps, [{ lat: 0.0100, lon: 0.0001 }], { minPhotos: 3 }), [], 'a viewpoint already there');
});
test('the enricher file: numbers and attributions only, every contributing photograph credited', () => {
  const zones = buildZones([{ id: 'v', lat: 0, lon: 0 }], ['a', 'b', 'c'].map((id) => photo(id, [wall('brick', BRICK, 0.5)])), { radius: 80 });
  const f = enricherFile(zones, {}, [{ id: 'a', title: 'T a', author: 'Au', licenceNorm: 'CC BY-SA 4.0', licenceUrl: 'https://x', pageUrl: 'https://p/a' }]);
  assert.equal(f.format, FORMAT); assert.deepEqual(f.sources.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(f.sources[0], { id: 'a', title: 'T a', author: 'Au', licence: 'CC BY-SA 4.0', licenceUrl: 'https://x', url: 'https://p/a' });
  assert.deepEqual(f.zones[0].photos, ['a', 'b', 'c']); assert.deepEqual(f.buildings, []);
  const text = JSON.stringify(f); assert.ok(!/data:image|base64/.test(text), 'no pixel data');
});
