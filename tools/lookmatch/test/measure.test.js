import test from 'node:test';
import assert from 'node:assert/strict';
import { measureImage, regions, labField, MASK, T, usable } from '../lib/measure.mjs';
import { image, street } from './helpers.js';

test('regions: a blue top is sky, a grey bottom is ground, the textured middle is walls', () => {
  const w = 80, h = 60, f = labField(street(w, h), w, h), { mask, horizon } = regions(f, w, h);
  const at = (x, y) => mask[y * w + x];
  assert.equal(at(10, 2), MASK.sky); assert.equal(at(70, 20), MASK.sky);
  assert.equal(at(10, 50), MASK.ground); assert.equal(at(70, 58), MASK.ground);
  assert.equal(at(10, 30), MASK.wall); assert.equal(at(41, 35), MASK.wall);
  assert.equal(horizon, 23, "the row beside the edge has a steep gradient and is not sky");
});
test('shares add up to one and the numbers are about right', () => {
  const m = measureImage(street(), 80, 60).numbers;
  assert.ok(Math.abs(m.shares.sky - 0.4) < 0.04 && Math.abs(m.shares.ground - 0.3) < 0.04 && Math.abs(m.shares.walls - 0.3) < 0.06);
  assert.ok(Math.abs(m.shares.sky + m.shares.ground + m.shares.walls - 1) < 1e-3);
  assert.equal(m.framing, 'ok');
  assert.ok(m.regions.sky.b < 0 && m.regions.sky.L > 60);
  assert.ok(Math.abs(m.regions.ground.L - 54) < 1 && Math.abs(m.regions.ground.a) < 0.1 && m.regions.ground.chroma < 0.1);
  assert.ok(m.regions.walls.b > 10 && m.regions.walls.chroma > 15);
  assert.ok(m.regions.sky.p10 <= m.regions.sky.p50 && m.regions.sky.p50 <= m.regions.sky.p90);
  assert.ok(m.contrast > 20);
});
test('a wall that touches the top edge and is warm, textured or dark is not sky; a grey-white smooth top is', () => {
  const warm = measureImage(image(40, 40, () => [220, 190, 150]), 40, 40).numbers; assert.equal(warm.shares.sky, 0);
  const grey = measureImage(image(40, 40, (x, y) => (y < 20 ? [200, 200, 205] : [90, 70, 60])), 40, 40).numbers; assert.ok(Math.abs(grey.shares.sky - 0.5) < 0.04);
  const dark = measureImage(image(40, 40, () => [30, 40, 70]), 40, 40).numbers; assert.equal(dark.shares.sky, 0);
});
test('ground needs low saturation, the lower part of the frame, and a connection to the bottom edge', () => {
  const coloured = measureImage(image(40, 40, (x, y) => (y < 10 ? [150, 185, 235] : [200, 90, 60])), 40, 40).numbers; assert.equal(coloured.shares.ground, 0);
  const island = measureImage(image(40, 40, (x, y) => (y < 10 ? [150, 185, 235] : y === 39 ? [200, 90, 60] : y > 20 ? [128, 128, 128] : [200, 90, 60])), 40, 40).numbers; assert.equal(island.shares.ground, 0, 'cut off from the bottom edge');
  const upper = measureImage(image(40, 40, (x, y) => (y < 10 ? [150, 185, 235] : [128, 128, 128])), 40, 40).numbers; assert.ok(Math.abs(upper.shares.ground - 0.45) < 0.03, 'grey only in the lower 45 %: ' + upper.shares.ground);
});
test('a grey wall above a grey pavement is not ground: the pavement is a different brightness and a step separates them', () => {
  const m = measureImage(image(40, 60, (x, y) => (y < 10 ? [150, 185, 235] : y < 40 ? (Math.floor(x / 2) % 2 ? [190, 190, 190] : [235, 235, 235]) : [128, 128, 128])), 40, 60).numbers;
  assert.ok(m.shares.ground > 0.25 && m.shares.ground < 0.35, 'ground ' + m.shares.ground); assert.ok(m.shares.walls > 0.45);
});
test('poor framing: under 3 % or over 70 % sky', () => {
  assert.equal(measureImage(image(40, 40, () => [128, 128, 128]), 40, 40).numbers.framing, 'poor framing');
  assert.equal(measureImage(image(40, 40, (x, y) => (y < 32 ? [150, 185, 235] : [128, 128, 128])), 40, 40).numbers.framing, 'poor framing');
  assert.equal(T.poorLow, 0.03); assert.equal(T.poorHigh, 0.7);
});
test('shade split: a half shaded, half lit wall gives the two means and their ratio, and the shade is bluer', () => {
  const img = image(60, 60, (x, y) => (y < 15 ? [150, 185, 235] : y >= 45 ? [128, 128, 128] : x < 30 ? [60, 60, 80] : [210, 190, 160]));
  const s = measureImage(img, 60, 60).numbers.shade.walls;
  assert.ok(s.dark.L < 30 && s.lit.L > 70 && s.ratio > 0.2 && s.ratio < 0.5, JSON.stringify(s));
  assert.ok(s.dark.b < s.lit.b, 'shade bluer than sun'); assert.ok(Math.abs(s.dark.share - 0.5) < 0.1);
});
test('busyness: flat walls have no gradient and no dark openings; windows add both', () => {
  const flatW = measureImage(image(60, 40, () => [200, 180, 150]), 60, 40).numbers.busyness; assert.equal(flatW.gradient, 0); assert.equal(flatW.darkOpenings, 0);
  const win = measureImage(image(60, 40, (x, y) => ((x % 10 < 4 && y % 10 < 6) ? [30, 25, 20] : [200, 180, 150])), 60, 40).numbers.busyness;
  assert.ok(win.gradient > 3 && win.darkOpenings > 0.15);
});
test('colourfulness: five dominant colours with shares summing to one; a flat wall has no spread', () => {
  const c = measureImage(image(60, 40, (x) => [[200, 180, 150], [150, 90, 70], [90, 100, 110], [220, 200, 120], [70, 70, 60]][Math.floor(x / 12)]), 60, 40).numbers.colourfulness;
  assert.equal(c.dominant.length, 5); assert.ok(Math.abs(c.dominant.reduce((s, d) => s + d.share, 0) - 1) < 0.01); assert.ok(c.stdA > 2 && c.stdB > 2);
  assert.equal(measureImage(image(60, 40, () => [200, 180, 150]), 60, 40).numbers.colourfulness.stdA, 0);
});
test('the same image always gives the same numbers', () => {
  assert.deepEqual(measureImage(street(), 80, 60).numbers, measureImage(street(), 80, 60).numbers);
});
test('usable: scans, night shots and blown pictures are left out', () => {
  assert.equal(usable(measureImage(image(40, 40, (x, y) => [(x + y) * 3, (x + y) * 3, (x + y) * 3]), 40, 40).numbers), 'monochrome');
  assert.equal(usable(measureImage(image(40, 40, () => [20, 25, 40]), 40, 40).numbers), 'too dark');
  assert.equal(usable(measureImage(image(40, 40, () => [250, 245, 235]), 40, 40).numbers), 'washed out');
  assert.match(usable(measureImage(image(40, 40, (x, y) => [120 + (x % 7) * 15, 90 + (y % 5) * 10, 60]), 40, 40).numbers), /no street/);
  assert.equal(usable(measureImage(street(), 80, 60).numbers), null);
});
