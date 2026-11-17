import test from 'node:test';
import assert from 'node:assert/strict';
import { propose, applyLook, tintFromLabShift, evidence, STEP } from '../lib/proposal.mjs';
import { gapsOf, referenceOf, flat, sentence } from '../lib/compare.mjs';
import { resolveLook, DEFAULT_LOOK } from '../../../engine/src/core/atmosphere.js';

const LOOK = resolveLook({ exposure: 0.95, env: 2, bounce: [0.6, 0.5, 0.4], saturation: 1.08, skySat: 0.7, curve: 0.3 });
const same = { 'walls.L': 50, 'ground.L': 50, 'walls.chroma': 20, 'sky.chroma': 20, 'sky.a': 0, 'sky.b': -20, 'surfaces.dark.a': 0, 'surfaces.dark.b': 0, 'surfaces.lit.a': 0, 'surfaces.lit.b': 10, 'surfaces.ratio': 0.5, contrast: 40 };
const view = (ref, render, o = {}) => ({ id: 'v', reference: { ...same, ...ref }, render: { ...same, ...render }, ...o });
const get = (p, k) => p.changes.find((c) => c.key === k);
const many = (n, ref, render) => Array.from({ length: n }, () => view(ref, render));

test('no gap: nothing acts ("within noise"), every value stays', () => {
  const p = propose([view({}, {})], LOOK);
  for (const k of ['exposure', 'saturation', 'skySat', 'skyTint', 'env', 'bounce', 'curve']) { assert.equal(get(p, k).acted, false, k); assert.deepEqual(get(p, k).to, LOOK[k]); }
  assert.equal(get(p, 'exposure').status, 'within noise');
});
test('shadows and highlights are no longer rules: they are not in the proposal at all', () => {
  const p = propose([view({ 'surfaces.dark.b': -8, 'surfaces.lit.b': 20 }, {})], LOOK);
  assert.ok(!p.changes.some((c) => c.key === 'shadows' || c.key === 'highlights')); assert.ok(!('shadows' in p.look) && !('highlights' in p.look));
});
test('a rule acts only when at least 60 % of the views agree on the sign of the gap', () => {
  const up = (L) => view({ 'walls.L': L, 'ground.L': L }, {}), down = (L) => view({ 'walls.L': L, 'ground.L': L }, {});
  const three = propose([up(60), up(60), down(40)], LOOK), half = propose([up(60), up(60), down(40), down(40)], LOOK), five = propose([up(60), up(60), up(60), down(40), down(40)], LOOK);
  assert.equal(get(three, 'exposure').acted, true, '2 of 3 is 67 %'); assert.equal(get(half, 'exposure').status, 'views disagree'); assert.match(get(half, 'exposure').evidence, /views disagree/);
  assert.equal(get(five, 'exposure').acted, true, '3 of 5 is exactly 60 %'); assert.deepEqual(get(half, 'exposure').to, 0.95, 'nothing proposed when views disagree');
});
test('a rule acts only when the median gap is larger than the measure\'s noise floor', () => {
  const v = [view({ 'walls.L': 53, 'ground.L': 53 }, {}), view({ 'walls.L': 53, 'ground.L': 53 }, {})];
  assert.equal(get(propose(v, LOOK, { floors: { 'walls.L': 4, 'ground.L': 4 } }), 'exposure').status, 'within noise');
  const big = get(propose(v, LOOK, { floors: { 'walls.L': 1, 'ground.L': 1 } }), 'exposure'); assert.equal(big.acted, true); assert.match(big.evidence, /noise floor of 1\.00/);
});
test('exposure: darker than the photographs raises it, lighter lowers it, damping 0.4 and clamped x0.8..1.25', () => {
  const run = (L, n = 3) => get(propose(many(n, { 'walls.L': L, 'ground.L': L }, {}), LOOK), 'exposure');
  assert.ok(run(60).to > 0.95 && run(40).to < 0.95);
  const small = run(52).to / 0.95; assert.ok(small > 1.03 && small < 1.045, 'about 0.4 x 2 L*: ' + small);
  assert.equal(run(95).to, +(0.95 * 1.25).toFixed(4)); assert.equal(run(5).to, +(0.95 * 0.8).toFixed(4));
});
test('saturation (damping 0.6, 0.85..1.2) and sky saturation (damping 0.5, 0.7..1.4)', () => {
  const sat = (ref) => get(propose(many(3, ref, {}), LOOK), 'saturation'), sky = (ref) => get(propose(many(3, ref, {}), LOOK), 'skySat');
  assert.ok(sat({ 'walls.chroma': 22 }).numbers.step > 1); assert.equal(sat({ 'walls.chroma': 200 }).numbers.step, 1.2); assert.equal(sat({ 'walls.chroma': 1 }).numbers.step, 0.85);
  assert.ok(Math.abs(sat({ 'walls.chroma': 25 }).numbers.step - (1 + 0.6 * 0.25)) < 1e-3);
  assert.equal(sky({ 'sky.chroma': 200 }).numbers.step, 1.4); assert.equal(sky({ 'sky.chroma': 1 }).numbers.step, 0.7); assert.ok(Math.abs(sky({ 'sky.chroma': 30 }).numbers.step - 1.25) < 1e-3, 'damping 0.5: 1 + 0.5 x 0.5');
  assert.equal(sky({ 'sky.chroma': 5 }).status, 'acted'); assert.ok(sky({ 'sky.chroma': 5 }).numbers.step < 0.85, 'the old clamp of 0.85 is gone');
});
test('sky tint: a bluer reference gives a bluer multiplier, up to 15 % a round, luminance kept; an axis without evidence counts zero', () => {
  const m = tintFromLabShift(0, -8); assert.ok(m[2] > m[0]); assert.ok(m.every((v) => Math.abs(v - 1) <= 0.1501)); assert.ok(Math.abs(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] - 1) < 0.02);
  const big = tintFromLabShift(60, 60); assert.ok(Math.max(...big.map((v) => Math.abs(v - 1))) <= 0.1501); assert.ok(Math.max(...big.map((v) => Math.abs(v - 1))) > 0.1, 'the limit is 15 %, not 6 %');
  const st = get(propose(many(3, { 'sky.b': -30 }, { 'sky.b': -10 }), LOOK), 'skyTint'); assert.equal(st.acted, true); assert.ok(st.to[2] > st.to[0]); assert.equal(st.numbers.gapA, 0, 'a* has no gap');
  const mixed = get(propose([view({ 'sky.b': -30 }, {}), view({ 'sky.b': 10 }, {}), view({ 'sky.b': -30 }, {}), view({ 'sky.b': 10 }, {})], LOOK), 'skyTint'); assert.equal(mixed.acted, false); assert.match(mixed.evidence, /views disagree/);
});
test('env and bounce: shade too dark raises both, too light lowers them, damping 0.4, up to 25 % and 20 %', () => {
  const dark = propose(many(3, { 'surfaces.ratio': 0.7 }, { 'surfaces.ratio': 0.4 }), LOOK), light = propose(many(3, { 'surfaces.ratio': 0.4 }, { 'surfaces.ratio': 0.7 }), LOOK);
  assert.ok(get(dark, 'env').to > 2 && get(dark, 'bounce').to[0] > 0.6); assert.ok(get(light, 'env').to < 2 && get(light, 'bounce').to[0] < 0.6);
  const rel = (0.7 - 0.4) / 0.7; assert.ok(Math.abs(get(dark, 'env').numbers.step - 0.4 * rel) < 1e-3);
  const huge = propose(many(3, { 'surfaces.ratio': 0.99 }, { 'surfaces.ratio': 0.05 }), LOOK); assert.equal(get(huge, 'env').to, 2.5); assert.equal(get(huge, 'bounce').to[0], 0.72);
  assert.equal(get(propose(many(3, { 'surfaces.ratio': 0.05 }, { 'surfaces.ratio': 0.99 }), LOOK), 'env').to, 1.5);
});
test('curve keeps its rule, never goes below zero, and is capped at 0.6 total with the cap reported', () => {
  const c = (ref, look = LOOK, render = {}) => get(propose(many(3, ref, render), look), 'curve');
  assert.ok(c({ contrast: 50 }).to > 0.3); assert.ok(c({ contrast: 30 }).to < 0.3); assert.equal(c({ contrast: 90 }).to, 0.4);
  assert.equal(c({ contrast: 0 }, { ...LOOK, curve: 0.05 }, { contrast: 90 }).to, 0);
  const capped = c({ contrast: 90 }, { ...LOOK, curve: 0.55 }); assert.equal(capped.to, 0.6); assert.match(capped.status, /capped at 0\.6/); assert.match(capped.reason, /capped/);
  assert.equal(c({ contrast: 90 }, { ...LOOK, curve: 0.45 }).status, 'acted');
});
test('views without a reference are ignored; one odd view does not flip the median', () => {
  const p = propose([view({ 'walls.L': 60, 'ground.L': 60 }, {}), view({ 'walls.L': 61, 'ground.L': 61 }, {}), view({ 'walls.L': 5, 'ground.L': 5 }, {}), { id: 'none', reference: null, render: same }], LOOK);
  assert.ok(get(p, 'exposure').to > 0.95); assert.deepEqual(p.used, ['v', 'v', 'v']);
});
test('each view\'s own ratio and gap is used: a median of values from different places would have the opposite sign', () => {
  const a = view({ 'walls.chroma': 40, 'surfaces.ratio': 0.8 }, { 'walls.chroma': 50, 'surfaces.ratio': 0.9 }), b = view({ 'walls.chroma': 10, 'surfaces.ratio': 0.3 }, { 'walls.chroma': 12, 'surfaces.ratio': 0.35 }), c = view({ 'walls.chroma': 20, 'surfaces.ratio': 0.5 }, { 'walls.chroma': 30, 'surfaces.ratio': 0.7 });
  const p = propose([a, b, c], LOOK, { floors: { 'walls.chroma': 1, 'surfaces.ratio': 0.01 } }); assert.ok(get(p, 'saturation').numbers.step < 1); assert.ok(get(p, 'env').to < 2);
});
test('material mismatch: a view above the threshold is ignored for wall colour (saturation, and the wall half of exposure)', () => {
  const ok = view({ 'walls.chroma': 30 }, {}, { material: 2 }), odd = (c) => view({ 'walls.chroma': c, 'walls.L': 70 }, {}, { material: 25 });
  const p = propose([ok, odd(5), odd(5)], LOOK); assert.deepEqual(p.ignoredForMaterial, ['v', 'v']); assert.equal(get(p, 'saturation').numbers.views, 1); assert.ok(get(p, 'saturation').numbers.step > 1, 'only the comparable view counts');
  const p2 = propose([odd(5), odd(5), odd(5)], LOOK); assert.equal(get(p2, 'saturation').status, 'no data');
  assert.equal(get(p2, 'exposure').acted, false, 'the walls of these views are not comparable, and the ground has no gap');
  assert.equal(get(propose([ok, ok, ok], LOOK, { floors: { 'walls.chroma': 1 } }), 'saturation').acted, true);
});
test('a frozen key is left alone', () => { const p = propose(many(3, { 'walls.L': 70, 'ground.L': 70 }, {}), LOOK, { frozen: ['exposure'] }); assert.equal(get(p, 'exposure').status, 'frozen'); assert.equal(get(p, 'exposure').to, 0.95); });
test('evidence: counts the sign share and the median against the floor', () => {
  const e = evidence([3, 4, 5, -1], 1); assert.equal(e.share, 0.75); assert.equal(e.ok, true); assert.equal(evidence([3, 4, -5, -4], 1).status, 'views disagree'); assert.equal(evidence([0.2, 0.3, 0.1], 1).status, 'within noise'); assert.equal(evidence([], 1).status, 'no data');
});
test('damping makes repeated rounds converge: applying 40 % of the gap each round shrinks it', () => {
  let render = 40; const ref = 60, gaps = [];
  for (let i = 0; i < 4; i++) { gaps.push(Math.abs(ref - render)); render += STEP.exposure * (ref - render); }
  assert.ok(gaps.every((g, i) => !i || g < gaps[i - 1]));
});
test('--apply: merges into ambience.look, touches only DEFAULT_LOOK keys, nothing else in the file', () => {
  const place = { id: 'p', name: 'P', ambience: { tod: 15, look: { exposure: 0.95, saturation: 1.08, env: 2 } }, terrain: { cell: 2 } };
  const { place: out, changed } = applyLook(place, { exposure: 1.01, curve: 0.35, notAKey: 5, ambience: 1, tod: 3 });
  assert.deepEqual(out.ambience.look, { exposure: 1.01, saturation: 1.08, env: 2, curve: 0.35 });
  assert.equal(out.ambience.tod, 15); assert.deepEqual(out.terrain, place.terrain); assert.equal(out.id, 'p'); assert.ok(!('notAKey' in out.ambience.look)); assert.ok(!('tod' in out.ambience.look));
  assert.deepEqual(changed.map((c) => c.key), ['exposure', 'curve']); assert.equal(place.ambience.look.exposure, 0.95, 'the input is not mutated');
  assert.deepEqual(applyLook({ id: 'q' }, { gain: 1 }).place.ambience.look, { gain: 1 });
  assert.ok(Object.keys(DEFAULT_LOOK).includes('shadows'), 'still a look key; just not a rule');
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
