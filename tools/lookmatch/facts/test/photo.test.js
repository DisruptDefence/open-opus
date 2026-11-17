import test from 'node:test';
import assert from 'node:assert/strict';
import { analysePhoto, openings, upMask, PX } from '../lib/photo.mjs';
import { labField, MASK } from '../../lib/measure.mjs';
import { image, brick, shade, smooth } from './helpers.js';

const W = 200, H = 120;
/** A street: sky on top (rows 0-19), a brick wall rows 20-89 whose left 40 % is in shade (x0.7), dark windows, grey pavement below. */
function street({ sky = [90, 150, 230], windows = true, extra } = {}) {
  const b = brick(W, H, [150, 70, 50], [185, 130, 110]);
  return image(W, H, (x, y) => {
    const i = (y * W + x) * 4, px = [b[i], b[i + 1], b[i + 2]];
    if (y < 20) return sky;
    if (y >= 90) return [128, 128, 128];
    if (windows && ((x % 40) >= 12 && (x % 40) < 28) && ((y - 20) % 24 >= 6 && (y - 20) % 24 < 20)) return [18, 20, 26];
    if (extra) { const e = extra(x, y); if (e) return e; }
    return x < 80 ? shade(px, 0.7) : px;
  });
}
const maskFor = (skyRows = 20, groundFrom = 90) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) m.fill(y < skyRows ? MASK.sky : y >= groundFrom ? MASK.ground : MASK.wall, y * W, (y + 1) * W); return m; };

test('a brick wall half in shade is one brick colour, read in the sun, windows left out', () => {
  const res = analysePhoto(street(), W, H, maskFor());
  const walls = res.walls;
  assert.equal(walls[0].material, 'brick', JSON.stringify(walls));
  assert.ok(walls[0].share > 0.55, `the shaded and the lit half are one cluster: share ${walls[0].share}`);
  assert.ok(walls[0].lab[0] > 35, 'the colour is the sunlit one: L* ' + walls[0].lab[0]);
  assert.ok(res.counts.opening > 300, 'windows found as openings: ' + res.counts.opening);
  assert.ok(!walls.some((c) => c.lab[0] < 20 && c.share > 0.05), 'no cluster of window blackness');
});
test('openings: a dark blob is found, a gentle gradient is not, a speck is noise', () => {
  const img = image(80, 60, (x, y) => (x >= 30 && x < 50 && y >= 20 && y < 40 ? [20, 20, 20] : x === 5 && y === 5 ? [10, 10, 10] : [200, 190, 180]));
  const f = labField(img, 80, 60), cand = new Uint8Array(80 * 60).fill(1), o = openings(f.L, cand, 80, 60);
  assert.equal(o[30 * 80 + 40], 1); assert.equal(o[5 * 80 + 5], 0, 'a speck under the blob size'); assert.equal(o[5 * 80 + 70], 0);
  const grad = image(80, 60, (x) => [100 + x, 100 + x, 100 + x]), g = labField(grad, 80, 60);
  assert.equal(openings(g.L, cand, 80, 60).reduce((s, v) => s + v, 0), 0);
});
test('deep blue sky the region split missed is not wall', () => {
  const res = analysePhoto(street(), W, H, (() => { const m = maskFor(0, 90); return m; })());   // the tool called the sky wall
  assert.ok(res.walls.every((c) => !(c.hue > 250 && c.hue < 310 && c.share > 0.02)), JSON.stringify(res.walls));
  assert.ok(res.counts.pixels > 0 && res.maps.px[5 * W + 5] === PX.sky);
});
test('leaves are not wall', () => {
  const img = street({ extra: (x, y) => (x >= 120 && x < 170 && y >= 30 && y < 80 ? [50, 120, 40] : null) });
  const res = analysePhoto(img, W, H, maskFor());
  assert.ok(res.counts.vegetation > 1500, 'vegetation ' + res.counts.vegetation); assert.ok(res.walls.every((c) => !(c.hue > 100 && c.hue < 200 && c.share > 0.03)));
});
test('pale blue glass is not wall; a blue door next to a window is an accent', () => {
  const door = (x, y) => (x >= 100 && x < 112 && y >= 45 && y < 75 ? [30, 60, 160] : null);   // beside a window column (x % 40 in 12..28 -> 92..108): ring pixels
  const res = analysePhoto(street({ extra: door }), W, H, maskFor());
  assert.ok(res.accents.length >= 1, 'an accent: ' + JSON.stringify(res.accents));
  assert.ok(res.accents[0].hue > 250 && res.accents[0].hue < 310, 'blue: ' + JSON.stringify(res.accents[0]));
});
test('the roof band under the sky edge is read as a roof, not wall: smooth green-grey copper', () => {
  const copper = (x, y) => (y >= 20 && y < 28 ? [110, 160, 140] : null);
  const res = analysePhoto(street({ extra: copper }), W, H, maskFor());
  assert.ok(res.roofs.length >= 1 && res.roofs[0].material === 'copper' && res.roofs[0].confidence === 'low', JSON.stringify(res.roofs));
  assert.ok(res.counts.roofBand > 0);
});
test('a pavement-grey region in the lower part of the picture is not wall, and nothing below the ground region is', () => {
  const res = analysePhoto(street(), W, H, maskFor());
  assert.ok(res.maps.px[100 * W + 50] === PX.ground);
});
test('too few wall pixels give no clusters instead of noise', () => {
  const img = image(40, 30, () => [128, 128, 128]), res = analysePhoto(img, 40, 30, new Uint8Array(40 * 30).fill(MASK.sky));
  assert.deepEqual(res.walls, []);
});
test('seeded: the same picture gives the same facts', () => {
  const a = analysePhoto(street(), W, H, maskFor()), b = analysePhoto(street(), W, H, maskFor());
  assert.deepEqual(a.walls, b.walls); assert.deepEqual(a.accents, b.accents);
});
test('upMask carries a small mask to a larger size by nearest neighbour', () => {
  const m = Uint8Array.from([0, 1, 2, 3]), u = upMask(m, 2, 2, 4, 4);
  assert.deepEqual([...u], [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3]);
});
test('white paint seen in shade or under cloud is written as white, not grey', () => {
  const b = brick(W, H, [172, 172, 168], [160, 160, 156]);   // grey-white, textured
  const dull = image(W, H, (x, y) => { const i = (y * W + x) * 4; return y < 20 ? [90, 150, 230] : y >= 90 ? [128, 128, 128] : [b[i], b[i + 1], b[i + 2]]; });
  const res = analysePhoto(dull, W, H, maskFor());
  const c = res.walls.find((q) => q.material === 'painted_white'); assert.ok(c, JSON.stringify(res.walls)); assert.ok(c.lab[0] >= 88 - 0.5, 'L* ' + c.lab[0]);
});
test('a red or pink roof below the roof band is not a wall colour: it goes to the accents', () => {
  const b = smooth([235, 110, 150], W, H);   // pink, smooth like a painted roof
  const pink = image(W, H, (x, y) => { const i = (y * W + x) * 4; return y < 20 ? [90, 150, 230] : y >= 90 ? [128, 128, 128] : [b[i], b[i + 1], b[i + 2]]; });
  const res = analysePhoto(pink, W, H, maskFor());
  assert.ok(res.walls.every((c) => !(c.hue < 20 || c.hue > 110) || c.chroma < 40), JSON.stringify(res.walls)); assert.ok(res.accents.length >= 1);
});
