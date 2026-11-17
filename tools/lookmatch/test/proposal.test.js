import test from 'node:test';
import assert from 'node:assert/strict';
import { propose, applyLook, tintFromLabShift } from '../lib/proposal.mjs';
import { gapsOf, referenceOf, flat, sentence } from '../lib/compare.mjs';
import { resolveLook, DEFAULT_LOOK } from '../../../engine/src/core/atmosphere.js';

const LOOK = resolveLook({ exposure: 0.95, env: 2, bounce: [0.6, 0.5, 0.4], saturation: 1.08, skySat: 0.7, curve: 0.3 });
const same = { 'walls.L': 50, 'ground.L': 50, 'walls.chroma': 20, 'sky.chroma': 20, 'sky.a': 0, 'sky.b': -20, 'surfaces.dark.a': 0, 'surfaces.dark.b': 0, 'surfaces.lit.a': 0, 'surfaces.lit.b': 10, 'surfaces.ratio': 0.5, contrast: 40 };
const view = (ref, render) => ({ id: 'v', reference: { ...same, ...ref }, render: { ...same, ...render } });
const get = (p, k) => p.changes.find((c) => c.key === k);

test('no gap: every multiplier is one, no tint, no step', () => {
  const p = propose([view({}, {})], LOOK);
  assert.equal(get(p, 'exposure').to, 0.95); assert.equal(get(p, 'saturation').to, 1.08); assert.equal(get(p, 'env').to, 2); assert.equal(get(p, 'curve').to, 0.3);
  assert.deepEqual(get(p, 'shadows').to, [1, 1, 1]); assert.deepEqual(get(p, 'skyTint').to, [1, 1, 1]);
});
test('exposure: darker than the photographs raises it, lighter lowers it, damped and clamped to x0.8..x1.25', () => {
  const up = get(propose([view({ 'walls.L': 60, 'ground.L': 60 }, {})], LOOK), 'exposure'), down = get(propose([view({ 'walls.L': 40, 'ground.L': 40 }, {})], LOOK), 'exposure');
  assert.ok(up.to > 0.95 && down.to < 0.95);
  const small = get(propose([view({ 'walls.L': 52, 'ground.L': 52 }, {})], LOOK), 'exposure'), full = 50 / 50; // 60 % of 2 L* is 1.2 L*: about x1.055
  assert.ok(small.to / 0.95 > 1.04 && small.to / 0.95 < 1.07, String(small.to / 0.95)); void full;
  assert.equal(get(propose([view({ 'walls.L': 95, 'ground.L': 95 }, {})], LOOK), 'exposure').to, +(0.95 * 1.25).toFixed(4));
  assert.equal(get(propose([view({ 'walls.L': 5, 'ground.L': 5 }, {})], LOOK), 'exposure').to, +(0.95 * 0.8).toFixed(4));
});
test('saturation and sky saturation: ratio of chroma, damped, clamped 0.85..1.2', () => {
  assert.ok(get(propose([view({ 'walls.chroma': 22 }, {})], LOOK), 'saturation').numbers.step > 1);
  assert.equal(get(propose([view({ 'walls.chroma': 200 }, {})], LOOK), 'saturation').numbers.step, 1.2); assert.equal(get(propose([view({ 'walls.chroma': 1 }, {})], LOOK), 'saturation').numbers.step, 0.85);
  assert.equal(get(propose([view({ 'sky.chroma': 5 }, {})], LOOK), 'skySat').numbers.step, 0.85);
  assert.ok(Math.abs(get(propose([view({ 'walls.chroma': 25 }, {})], LOOK), 'saturation').numbers.step - (1 + 0.6 * 0.25)) < 1e-3, 'damped by 0.6');
});
test('tints: a reference bluer than the render gives a bluer multiplier, never beyond 6 %, luminance kept', () => {
  const m = tintFromLabShift(0, -8); assert.ok(m[2] > m[0]); assert.ok(m.every((v) => Math.abs(v - 1) <= 0.0601));
  assert.ok(Math.abs(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] - 1) < 0.02);
  const big = tintFromLabShift(60, 60); assert.ok(Math.max(...big.map((v) => Math.abs(v - 1))) <= 0.0601);
  const p = propose([view({ 'surfaces.dark.b': -8 }, { 'surfaces.dark.b': 0 })], LOOK); const s = get(p, 'shadows').to; assert.ok(s[2] > s[0], 'shade must go bluer'); assert.ok(s.every((v) => Math.abs(v - 1) <= 0.0601));
  const h = get(propose([view({ 'surfaces.lit.b': 20 }, { 'surfaces.lit.b': 10 })], LOOK), 'highlights').to; assert.ok(h[0] > h[2], 'sunlit parts must go yellower');
  const st = get(propose([view({ 'sky.b': -30 }, { 'sky.b': -10 })], LOOK), 'skyTint').to; assert.ok(st[2] > st[0]);
});
test('env and bounce: shade too dark raises both (up to 25 % and 20 %), too light lowers them', () => {
  const dark = propose([view({ 'surfaces.ratio': 0.7 }, { 'surfaces.ratio': 0.4 })], LOOK), light = propose([view({ 'surfaces.ratio': 0.4 }, { 'surfaces.ratio': 0.7 })], LOOK);
  assert.ok(get(dark, 'env').to > 2 && get(dark, 'bounce').to[0] > 0.6); assert.ok(get(light, 'env').to < 2 && get(light, 'bounce').to[0] < 0.6);
  const huge = propose([view({ 'surfaces.ratio': 0.99 }, { 'surfaces.ratio': 0.05 })], LOOK); assert.equal(get(huge, 'env').to, 2.5); assert.equal(get(huge, 'bounce').to[0], 0.72);
  assert.equal(get(propose([view({ 'surfaces.ratio': 0.05 }, { 'surfaces.ratio': 0.99 })], LOOK), 'env').to, 1.5);
});
test('curve follows the contrast gap with a step of at most 0.1 and never goes below zero', () => {
  assert.ok(get(propose([view({ contrast: 50 }, {})], LOOK), 'curve').to > 0.3); assert.ok(get(propose([view({ contrast: 30 }, {})], LOOK), 'curve').to < 0.3);
  assert.equal(get(propose([view({ contrast: 90 }, {})], LOOK), 'curve').to, 0.4);
  assert.equal(get(propose([view({ contrast: 0 }, { contrast: 90 })], { ...LOOK, curve: 0.05 }), 'curve').to, 0);
});
test('the median over views resists one odd view; views without a reference are ignored', () => {
  const p = propose([view({ 'walls.L': 60, 'ground.L': 60 }, {}), view({ 'walls.L': 61, 'ground.L': 61 }, {}), view({ 'walls.L': 5, 'ground.L': 5 }, {}), { id: 'none', reference: null, render: same }], LOOK);
  assert.ok(get(p, 'exposure').to > 0.95); assert.deepEqual(p.used, ['v', 'v', 'v']);
});
test('damping makes repeated rounds converge: applying 60 % of the gap each round shrinks it', () => {
  let render = 40; const ref = 60, gaps = [];
  for (let i = 0; i < 4; i++) { gaps.push(Math.abs(ref - render)); render += 0.6 * (ref - render); }
  assert.ok(gaps.every((g, i) => !i || g < gaps[i - 1]));
});
test('--apply: merges into ambience.look, touches only DEFAULT_LOOK keys, nothing else in the file', () => {
  const place = { id: 'p', name: 'P', ambience: { tod: 15, look: { exposure: 0.95, saturation: 1.08, env: 2 } }, terrain: { cell: 2 } };
  const { place: out, changed } = applyLook(place, { exposure: 1.01, curve: 0.35, notAKey: 5, ambience: 1, tod: 3 });
  assert.deepEqual(out.ambience.look, { exposure: 1.01, saturation: 1.08, env: 2, curve: 0.35 });
  assert.equal(out.ambience.tod, 15); assert.deepEqual(out.terrain, place.terrain); assert.equal(out.id, 'p'); assert.ok(!('notAKey' in out.ambience.look)); assert.ok(!('tod' in out.ambience.look));
  assert.deepEqual(changed.map((c) => c.key), ['exposure', 'curve']); assert.equal(place.ambience.look.exposure, 0.95, 'the input is not mutated');
  assert.deepEqual(applyLook({ id: 'q' }, { gain: 1 }).place.ambience.look, { gain: 1 });
  assert.ok(Object.keys(DEFAULT_LOOK).includes('shadows'));
});
test('reference is the weighted median of photographs; excluded photographs count nothing, poor framing half', () => {
  const n = (L, framing = 'ok') => ({ framing, shares: { sky: 0.2, ground: 0.3, walls: 0.5 }, regions: { walls: { L }, sky: null, ground: null } });
  const ref = referenceOf([{ numbers: n(40) }, { numbers: n(50) }, { numbers: n(60) }, { numbers: n(99), excluded: 'night' }]);
  assert.equal(ref.photos, 3); assert.equal(ref.values['walls.L'], 50);
  assert.equal(referenceOf([{ numbers: n(10), excluded: 'x' }]), null);
  assert.equal(referenceOf([{ numbers: n(10, 'poor framing') }, { numbers: n(50) }, { numbers: n(50) }]).values['walls.L'], 50);
});
test('gaps are render minus reference and the sentences say which way', () => {
  const g = gapsOf({ 'walls.L': 50, 'walls.b': 10 }, { 'walls.L': 36, 'walls.b': 4 });
  assert.equal(g.find((x) => x.key === 'walls.L').gap, -14); assert.match(sentence(g.find((x) => x.key === 'walls.L')), /walls are 14\.0 L\* darker/); assert.match(sentence(g.find((x) => x.key === 'walls.b'), 'v1'), /bluer .* 6\.0 b\* \(v1\)\./);
  assert.deepEqual(gapsOf(null, {}), []); assert.equal(flat(null)['walls.L'], null);
});
