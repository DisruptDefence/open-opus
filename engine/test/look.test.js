// The look block, the ambience precedence and atmosphereAt's use of the look (all pure; the renderer is not loaded).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOK, resolveLook, parseLookParam, ambienceOf, atmosphereAt } from '../src/core/atmosphere.js';

test('resolveLook() is DEFAULT_LOOK and shares no array with it', () => {
  const l = resolveLook();
  assert.deepEqual(l, DEFAULT_LOOK);
  for (const k in l) if (Array.isArray(l[k])) { assert.notEqual(l[k], DEFAULT_LOOK[k]); l[k][0] = 99; assert.notEqual(DEFAULT_LOOK[k][0], 99); }
});

test('resolveLook layers: later wins, junk is ignored', () => {
  const l = resolveLook({ vignette: 0.5, bounce: [1, 1, 1] }, null, 'x', undefined, { vignette: '0.3', nope: 1, shadows: [1, 2], gain: 'x', exposure: NaN, highlights: 'x', curve: true, saturation: null, sun: '' });
  assert.equal(l.vignette, 0.3);
  assert.deepEqual(l.bounce, [1, 1, 1]);
  assert.equal('nope' in l, false);
  assert.deepEqual(l.shadows, DEFAULT_LOOK.shadows);
  for (const k of ['gain', 'exposure', 'highlights', 'curve', 'saturation', 'sun']) assert.deepEqual(l[k], DEFAULT_LOOK[k], k);
  assert.deepEqual(resolveLook({ skyTint: ['1', 0.5, 2] }).skyTint, [1, 0.5, 2]);
});

test('parseLookParam', () => {
  assert.deepEqual(parseLookParam('{"vignette":0.2}'), { vignette: 0.2 });
  assert.equal(parseLookParam(''), null);
  assert.equal(parseLookParam(undefined), null);
  const w = console.warn; let n = 0; console.warn = () => n++;
  try { assert.equal(parseLookParam('{bad'), null); assert.equal(parseLookParam('{bad'), null); } finally { console.warn = w; }
  assert.ok(n <= 1);
  assert.equal(parseLookParam('[1]'), null);
});

test('atmosphereAt: the default look changes nothing', () => {
  const a = atmosphereAt({ hour: 16.5 }), b = atmosphereAt({ hour: 16.5, look: resolveLook() }), { look, ...rest } = b;
  assert.deepEqual(rest, a);
  assert.deepEqual(look, DEFAULT_LOOK);
});

test('atmosphereAt: the look acts on the sky and the sun', () => {
  const base = atmosphereAt({ hour: 12 });
  const g = atmosphereAt({ hour: 12, look: resolveLook({ skySat: 0 }) }).zenith;
  assert.ok(Math.abs(g[0] - g[1]) < 1e-9 && Math.abs(g[1] - g[2]) < 1e-9);
  assert.ok(Math.abs(atmosphereAt({ hour: 12, look: resolveLook({ sun: 2 }) }).sunIntensity - 2 * base.sunIntensity) < 1e-9);
  const t = atmosphereAt({ hour: 12, look: resolveLook({ sunTint: [1, 0.5, 0.5] }) }).sunColor;
  assert.ok(Math.abs(t[0] - base.sunColor[0]) < 1e-9 && Math.abs(t[1] - base.sunColor[1] / 2) < 1e-9 && Math.abs(t[2] - base.sunColor[2] / 2) < 1e-9);
  const k = atmosphereAt({ hour: 12, look: resolveLook({ skyTint: [2, 1, 1] }) });
  assert.ok(Math.abs(k.fog[0] - 2 * base.fog[0]) < 1e-9);
});

test('ambienceOf: host switch over scene over default', () => {
  assert.deepEqual(ambienceOf({}, null), { tod: 10, day: 172, haze: 0.4, cloud: 0.4, wet: 0 });
  assert.deepEqual(ambienceOf({ tod: '', wet: undefined }, { tod: 16.5, wet: 0.3, haze: 0.1 }), { tod: 16.5, day: 172, haze: 0.1, cloud: 0.4, wet: 0.3 });
  assert.deepEqual(ambienceOf({ tod: '7', cloud: '0', day: '200' }, { tod: 16.5, cloud: 0.9, day: 100 }), { tod: 7, day: 200, haze: 0.4, cloud: 0, wet: 0 });
});
