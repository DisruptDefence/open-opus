import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, otsu, kmeans3, weightedMedian, rng } from '../lib/stats.mjs';

test('percentiles interpolate between ranks', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3); assert.equal(percentile([1, 2, 3, 4, 5], 10), 1.4); assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
  assert.equal(percentile([10, 0], 50), 5); assert.ok(Number.isNaN(percentile([], 50)));
});
test('Otsu splits two clusters between them', () => {
  const v = [...Array(100).fill(0).map((_, i) => 20 + (i % 5)), ...Array(100).fill(0).map((_, i) => 70 + (i % 5))];
  const t = otsu(v); assert.ok(t > 24 && t <= 71, 'threshold ' + t);
});
test('k-means is deterministic for a seed and finds well separated clusters with their shares', () => {
  const pts = []; for (let i = 0; i < 90; i++) pts.push(10 + (i % 3), 0, 0); for (let i = 0; i < 30; i++) pts.push(80 + (i % 3), 5, 5);
  const a = kmeans3(Float64Array.from(pts), 2, 10, 7), b = kmeans3(Float64Array.from(pts), 2, 10, 7);
  assert.deepEqual(a, b); assert.equal(a.length, 2); assert.ok(Math.abs(a[0].share - 0.75) < 1e-9); assert.ok(Math.abs(a[0].centre[0] - 11) < 0.1); assert.ok(Math.abs(a[1].centre[0] - 81) < 0.1);
  const r = rng(3); assert.equal(rng(3)(), r());
});
test('weighted median, and the mean of the middle two at an exact half', () => {
  assert.equal(weightedMedian([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 9, w: 1 }]), 2);
  assert.equal(weightedMedian([{ v: 1, w: 1 }, { v: 3, w: 1 }]), 2);
  assert.equal(weightedMedian([{ v: 1, w: 0.5 }, { v: 5, w: 1 }, { v: 9, w: 0.5 }]), 5);
  assert.equal(weightedMedian([{ v: 1, w: 5 }, { v: 9, w: 1 }]), 1); assert.ok(Number.isNaN(weightedMedian([])));
});
