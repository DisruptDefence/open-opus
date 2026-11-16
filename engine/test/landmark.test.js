// Landmark looks (docs/plans/SCENE-DETAIL.md item 9). Pure generators, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { roof } from '../src/gen/roof.js';
import { landmarkNear, landmarkBase, lookOf, lookStyle } from '../src/gen/landmark.js';
import { vertices } from './helpers.js';

const style = resolveStyle({ looks: {
  wing: { course: { from: 1, every: 1, h: 0.3, out: 0.1, tint: '#d2c8ae' }, corbel: { h: 0.8, out: 0.4, steps: 3 }, oriel: { every: 10, w: 2, depth: 0.9, from: 1, floors: 2, rise: 2, minEdge: 8 },
    crest: { h: 0.5, w: 0.2 }, finial: { h: 2, w: 0.3 }, dormers: { width: 2 }, chimneys: { perBuilding: [3, 3] } },
  turret: { slits: { w: 0.6, h: 1.4, sill: 0.9, every: 2 }, finial: { h: 3, w: 0.3 }, course: { from: 1, every: 2, h: 0.3, out: 0.1 } } } });
const ring = [0, 0, 24, 0, 24, 12, 0, 12];
const wing = { id: 5, ring, holes: [], yBase: 10, hEave: 15, hRoof: 6, levels: 5, roofShape: 2, roofDir: 255, roofMat: 2, roofColor: null, facade: 3, tint: [0.4, 0.2, 0.1], blind: new Set(), front: new Set(), look: 'wing' };
const flat = (x, z) => 10; void flat;
const ground = () => 10;

test('a landmark look adds courses, corbels and oriels near, and cresting with finials in the base, only for a building with a look', () => {
  const plain = createSoups(); landmarkNear(plain, { ...wing, look: '' }, ground, style, null); assert.equal(plain.triangles(), 0);
  const near = createSoups(); landmarkNear(near, wing, ground, style, null);
  assert.ok(near.triangles() > 200 && near.triangles() < 9000, `${near.triangles()} triangles`);
  const ys = vertices(near).map((v) => v[1]); assert.ok(Math.min(...ys) > 10 && Math.max(...ys) < 10 + 15 + 6, 'everything is on the wall, below the roof top');
  const info = roof(createSoups(), wing, style), base = createSoups(); landmarkBase(base, wing, style, info);
  assert.ok(base.triangles() > 10);
  const top = 10 + 15 + 6; assert.ok(Math.max(...vertices(base).map((v) => v[1])) > top + 1.5, 'a finial stands above the ridge');
});
test('a look overrides the window bay, dormers and chimneys of the style for its building only', () => {
  const ls = lookStyle(style, lookOf(style, wing)); assert.equal(ls.dormers.width, 2); assert.deepEqual(ls.chimneys.perBuilding, [3, 3]);
  assert.equal(ls.window, style.window); assert.notEqual(style.dormers.width, 2); assert.equal(lookStyle(style, null), style);
});
test('a round turret gets slim windows on every second edge and a finial on its cone', () => {
  const r = []; for (let k = 0; k < 16; k++) r.push(5 + 3 * Math.cos((k / 16) * 2 * Math.PI), 5 + 3 * Math.sin((k / 16) * 2 * Math.PI));
  const t = { ...wing, ring: r, hEave: 10, hRoof: 8, roofShape: 7, levels: 3, look: 'turret' }, near = createSoups(); landmarkNear(near, t, ground, style, null);
  const glass = [...near.map].filter(([k]) => k.startsWith('window')).reduce((n, [, s]) => n + s.pos.length / 9, 0); assert.equal(glass, 8 * 3 * 2, 'eight edges, three storeys, two triangles');
  const info = roof(createSoups(), t, style), base = createSoups(); landmarkBase(base, t, style, info); assert.ok(Math.max(...vertices(base).map((v) => v[1])) > 10 + 10 + 8 + 1);
});

