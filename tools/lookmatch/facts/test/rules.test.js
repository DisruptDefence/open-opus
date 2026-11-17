import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, materialOf, textureStats, isVegetation, isGlass, roofOf, shadeGain, hexOf } from '../lib/rules.mjs';
import { kmeans, nearest } from '../lib/kmeans.mjs';
import { labField } from '../../lib/measure.mjs';
import { brick, stoneBlocks, smooth, whiteJoints, label, image, shade } from './helpers.js';

test('brick: red-orange, mid lightness, fine regular texture', () => {
  const r = label(brick(), 64, 48);
  assert.equal(r.material, 'brick', JSON.stringify(r));
  assert.ok(r.t.e1 >= RULES.material.brick.minE1 && r.t.cv <= RULES.material.brick.maxCv, `e1 ${r.t.e1} cv ${r.t.cv}`);
});
test('stone: low chroma grey-beige, mid lightness, coarse irregular texture', () => {
  const r = label(stoneBlocks(), 96, 64);
  assert.equal(r.material, 'stone', JSON.stringify(r));
});
test('render: smooth, any hue (ochre, pastel blue, brick red but smooth)', () => {
  for (const c of [[222, 190, 130], [160, 190, 215], [150, 70, 50]]) assert.equal(label(smooth(c), 64, 48).material, 'render', String(c));
});
test('painted white: very light, nearly colourless, some texture', () => {
  const r = label(whiteJoints(), 64, 48);
  assert.equal(r.material, 'painted_white', JSON.stringify(r));
  assert.ok(r.t.e1 >= RULES.material.render.maxE1, 'not smooth');
});
test('the same red-orange colour is brick when textured and render when smooth: texture decides', () => {
  assert.equal(label(brick(), 64, 48).material, 'brick'); assert.equal(label(smooth([150, 70, 50]), 64, 48).material, 'render');
});
test('a dark textured colour is none of them', () => {
  const r = label(image(64, 48, (x, y) => ((x + y) % 3 ? [28, 26, 24] : [8, 8, 8])), 64, 48);
  assert.equal(r.material, 'unknown', JSON.stringify(r));
});
test('materialOf on numbers: the boundaries of the table', () => {
  const T = { e1: 4, e4: 5, cv: 0.4 }, m = (L, a, b, t = T) => materialOf({ L, a, b }, t);
  assert.equal(m(45, 28, 28), 'brick'); assert.equal(m(45, 28, -28), 'unknown', 'blue is not brick'); assert.equal(m(75, 2, 8), 'stone');
  assert.equal(m(90, 1, 3), 'painted_white'); assert.equal(m(70, 1, 2, { e1: 2.0, e4: 3, cv: 0.4 }), 'painted_white', 'in shade or under cloud: light grey, little texture');
  assert.equal(m(45, 28, 28, { e1: 4, e4: 5, cv: 1.3 }), 'unknown', 'irregular red-brown texture is not brick, and not stone either (too saturated)');
  assert.equal(m(20, 3, 3), 'unknown'); assert.equal(m(60, 30, 30, { e1: 0.5, e4: 0.6, cv: 0.3 }), 'render');
});
test('vegetation and glass pixels are recognised', () => {
  assert.ok(isVegetation(50, -20, 30)); assert.ok(!isVegetation(50, 20, 30)); assert.ok(isGlass(70, 0, -20)); assert.ok(!isGlass(70, 0, 10)); assert.ok(!isGlass(30, 0, -20), 'too dark for sky in glass');
});
test('roof words: copper, slate, metal; rough texture is no roof', () => {
  const S = { e1: 1, e4: 1.2, cv: 0.3 };
  assert.equal(roofOf({ L: 60, a: -15, b: -2 }, S), 'copper'); assert.equal(roofOf({ L: 30, a: 0, b: 1 }, S), 'slate'); assert.equal(roofOf({ L: 62, a: -1, b: -3 }, S), 'metal');
  assert.equal(roofOf({ L: 62, a: -1, b: -3 }, { e1: 5 }), null); assert.equal(roofOf({ L: 50, a: 30, b: 30 }, S), null);
});
test('shade gain: the lit over the dark, capped; none when nothing is shaded', () => {
  assert.equal(shadeGain(40, 60), 1.5); assert.equal(shadeGain(20, 80), RULES.shade.maxGain); assert.equal(shadeGain(60, 60), 1); assert.equal(shadeGain(NaN, 60), 1);
});
test('texture statistics are per cluster and ignore the pairs that cross a boundary', () => {
  const w = 40, h = 20, img = image(w, h, (x) => (x < 20 ? [100, 100, 100] : [200, 200, 200])), f = labField(img, w, h), ids = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) ids[i] = i % w < 20 ? 0 : 1;
  const t = textureStats(f.L, ids, w, h, 2); assert.ok(t[0].e1 < 1e-9 && t[1].e1 < 1e-9, 'the step between the two is not counted'); assert.equal(t[0].n, 400);
});
test('k-means is seeded and assigns every point', () => {
  const pts = []; for (let i = 0; i < 60; i++) pts.push(i < 30 ? 20 + (i % 3) : 80 + (i % 3), 0, 0);
  const a = kmeans(Float64Array.from(pts), 2, 8, 4), b = kmeans(Float64Array.from(pts), 2, 8, 4);
  assert.deepEqual(a.centres, b.centres); assert.equal(a.assign.length, 60); assert.equal(new Set(a.assign).size, 2);
  assert.notEqual(nearest(a.centres, 20, 0, 0), nearest(a.centres, 80, 0, 0));
});
test('hex of a Lab colour', () => { assert.equal(hexOf({ L: 100, a: 0, b: 0 }), '#ffffff'); assert.equal(hexOf({ L: 0, a: 0, b: 0 }), '#000000'); void shade; });
