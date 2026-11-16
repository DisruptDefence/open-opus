// Wall variation (gen/wallvar.js): the hash is deterministic and spread; a building's tone is its own and reads back as its id;
// the window of a bay comes from the style pack's table, by storey class and seeded hash; a different table, a different choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pcg, hash2, hash3, unit, buildingId, jitterTint, compileWindows, pickWindow, windowOf, stateOf, storeyClass, windowType, MAX_TYPES, STATES, paletteRows } from '../src/gen/wallvar.js';
import { DEFAULT_STYLE, resolveStyle, parseColor } from '../src/gen/style.js';

const buckets = (n, f, k = 10) => { const b = new Array(k).fill(0); for (let i = 0; i < n; i++) b[Math.min(k - 1, Math.floor(f(i) * k))]++; return b; };

test('the hash is deterministic, covers 0..1 and has no visible pattern across neighbours', () => {
  assert.equal(pcg(12345), pcg(12345)); assert.equal(hash2(7, 9), hash2(7, 9)); assert.notEqual(hash2(7, 9), hash2(9, 7));
  for (let i = 0; i < 1000; i++) { const u = unit(hash2(i, 3)); assert.ok(u >= 0 && u < 1); assert.ok(Number.isInteger(pcg(i)) && pcg(i) >= 0 && pcg(i) < 2 ** 32); }
  const n = 20000;
  for (const f of [(i) => unit(pcg(i)), (i) => unit(hash2(i, 41)), (i) => unit(hash3(i % 100, (i / 100) | 0, 5))]) {
    for (const c of buckets(n, f)) assert.ok(c > n / 10 * 0.9 && c < n / 10 * 1.1, `bucket ${c} of ${n / 10}`);
  }
  // neighbouring bays are not alike: the correlation of unit(bay) with unit(bay + 1) is ~0
  let s = 0; const m = 5000; for (let i = 0; i < m; i++) s += (unit(hash2(99, i)) - 0.5) * (unit(hash2(99, i + 1)) - 0.5);
  assert.ok(Math.abs(s / m) < 0.01, 'no correlation between neighbouring bays');
});

test('a building tint is jittered: deterministic, in whole 1/255 steps, within about 11%, and the id reads back', () => {
  const base = [0.66, 0.65, 0.62];
  assert.deepEqual(jitterTint(base, 17), jitterTint(base, 17));
  const ids = new Set(); let lo = 9, hi = 0;
  for (let k = 0; k < 2000; k++) {
    const t = jitterTint(base, k);
    for (let c = 0; c < 3; c++) { assert.ok(Math.abs(t[c] * 255 - Math.round(t[c] * 255)) < 1e-9, 'a whole step'); const r = t[c] / base[c]; lo = Math.min(lo, r); hi = Math.max(hi, r); }
    ids.add(buildingId(t));
  }
  assert.ok(lo > 0.88 && hi < 1.12, `jitter ${lo}..${hi}`); assert.ok(lo < 0.94 && hi > 1.06, 'and it does vary');
  assert.ok(ids.size > 1200, `2000 buildings of one palette entry have ${ids.size} different ids`);
  assert.equal(buildingId([1 / 255, 2 / 255, 3 / 255]), 1 | (2 << 8) | (3 << 16));
});

test('the window table of the style pack is read: types, classes, and what each storey picks', () => {
  const c = compileWindows(resolveStyle().bayWindows);
  assert.ok(c.names.length >= 10 && c.names.length <= MAX_TYPES); assert.ok(c.names.includes('sash6') && c.names.includes('shop') && c.names.includes('blind'));
  const count = (cls) => { const n = new Array(MAX_TYPES).fill(0); for (let i = 0; i < 20000; i++) n[pickWindow(c, cls, unit(hash2(i, 5)))]++; return n; };
  const ground = count(0), upper = count(2), at = (n) => c.names.indexOf(n);
  assert.ok(ground[at('shop')] > 20000 * 0.2, 'a ground floor is often a shop'); assert.equal(upper[at('shop')], 0, 'an upper floor never is');
  assert.ok(upper[at('dormer')] > 0 && ground[at('dormer')] === 0);
  // proportion follows the weights: sash6 3 of 14.4 for upper floors
  const w = DEFAULT_STYLE.bayWindows.classes.upper, total = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(upper[at('sash6')] / 20000 - w.sash6 / total) < 0.02);
  assert.deepEqual([0, 1, 2, 3, 9].map(storeyClass), [0, 1, 2, 2, 2]);
});

test('a window is one type for a storey of a building, now and then another; bays and storeys differ; the same building always gives the same', () => {
  const c = compileWindows(resolveStyle().bayWindows), id = 0x445566;
  assert.equal(windowOf(c, id, 3, 1), windowOf(c, id, 3, 1));
  const row = (storey) => Array.from({ length: 40 }, (_, b) => windowOf(c, id, b, storey));
  for (const s of [1, 2, 3]) { const r = row(s), top = Math.max(...Object.values(r.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {}))); assert.ok(top >= 28, `storey ${s}: one type dominates (${top} of 40)`); assert.ok(new Set(r).size >= 2, 'and not every window is the same'); }
  let differ = 0; for (let b = 0; b < 40; b++) if (windowOf(c, id, b, 1) !== windowOf(c, id, b, 3)) differ++;
  assert.ok(differ > 5, 'storeys differ');
  const types = new Set(); for (let k = 0; k < 400; k++) types.add(windowOf(c, 1000 + k * 977, 0, 2));
  assert.ok(types.size >= 6, 'across buildings the upper floors use many types');
  const sc = new Array(STATES.length).fill(0); for (let b = 0; b < 4000; b++) sc[stateOf(c, id, b, 2)]++;
  assert.ok(sc.every((n) => n > 0), 'every state (curtain, blind, lit, dark, ...) occurs'); assert.ok(sc[0] > sc[3], 'a clear window is likelier than a lit one');
});

test('a custom table changes the choice: data only, no code', () => {
  const dflt = compileWindows(DEFAULT_STYLE.bayWindows);
  const only = compileWindows({ types: { porthole: { shape: 'circle', w: 0.6 }, slit: { shape: 'rect', w: 0.2, h: 1.2 } }, classes: { ground: { slit: 1 }, upper: { porthole: 1 } } });
  assert.deepEqual(only.names, ['porthole', 'slit']);
  for (let b = 0; b < 50; b++) { assert.equal(only.names[windowOf(only, 123, b, 0)], 'slit'); assert.equal(only.names[windowOf(only, 123, b, 4)], 'porthole'); }
  assert.notEqual(dflt.names.join(), only.names.join());
  // a class the table lacks borrows the one before; weights set to zero never pick
  const borrow = compileWindows({ types: { a: {}, b: {} }, classes: { ground: { a: 1, b: 0 } } });
  for (let b = 0; b < 30; b++) assert.equal(windowOf(borrow, 5, b, 3), 0);
  // the table is read into the numbers the shader gets
  assert.deepEqual(Array.from(only.types.slice(0, 4)), [3, 0.6, 0.6, 0.85].map(Math.fround), 'a circle is as high as it is wide');
  assert.equal(windowType({ shape: 'segmental', w: 1, h: 2, sill: 0.5, grid: [3, 4], rail: true, hood: 'gable', shutters: 0.4 })[11], 1);
  assert.equal(windowType({ shape: 'rect', w: 1, h: 2, shutters: 3 })[12], 1, 'a chance is capped at 1');
});

test('the style pack files carry the table the engine defaults to, and quebec only overrides', () => {
  const root = fileURLToPath(new URL('../../styles/', import.meta.url));
  const canada = JSON.parse(readFileSync(root + 'canada.json', 'utf8')).client.bayWindows;
  assert.deepEqual(canada, DEFAULT_STYLE.bayWindows, 'styles/canada.json and gen/style.js DEFAULT_STYLE hold the same table');
  const quebec = JSON.parse(readFileSync(root + 'quebec-historic.json', 'utf8')).client.bayWindows;
  assert.ok(quebec.types.sash6.shutters > canada.types.sash6.shutters, 'the old town shutters more windows');
  assert.ok(!('shop' in (quebec.types || {})), 'the regional pack names only what it changes');
});

test('palette rows repeat to fill the shader palette and parse colours', () => {
  const p = paletteRows(['#ffffff', '#000000'], parseColor, 4);
  assert.equal(p.count, 2); assert.equal(p.rows.length, 12); assert.deepEqual(Array.from(p.rows.slice(0, 3)), Array.from(p.rows.slice(6, 9)));
  assert.equal(paletteRows([], parseColor, 2).count, 1);
});
