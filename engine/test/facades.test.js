// The wall shader (materials/facades.js): every soup that names a wall material names one that exists, with a texture set
// whose generator exists and a live part; the live GLSL declares each helper before its first call (GLSL has no forward
// use), its hash is the one gen/wallvar.js tests, and the uniform arrays it reads are the size the compiler writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACADE_FAR_SOUP, WALL_SOUP, STRUCTURE_SOUP, DEFAULT_STYLE, resolveStyle } from '../src/gen/style.js';
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, LIVE } from '../src/materials/materials.js';
import { BAY, LIVE_GLSL, setBayStyle } from '../src/materials/facades.js';
import { FACADE_MATERIAL } from '../src/materials/outdoor.js';
import { MAX_TYPES } from '../src/gen/wallvar.js';

const wallNames = (list) => list.map((k) => k.split('|')[0]).filter((n) => /^(facade|wall)_/.test(n));

test('every wall soup names a material with a set, a generator and a live part', () => {
  for (const name of new Set([...wallNames(FACADE_FAR_SOUP), ...wallNames(WALL_SOUP), ...wallNames(STRUCTURE_SOUP), ...FACADE_MATERIAL])) {
    const mat = MATERIALS[name];
    assert.ok(mat, `${name} is a material`);
    const set = SETS[mat.set]; assert.ok(set, `${name} has a texture set`);
    assert.ok(GENERATORS[set.fn], `${name} has a generator ${set.fn}`);
    assert.ok(mat.live >= 0 && mat.live <= 3, `${name} has a wall kind`);
  }
});

test('stone, rubble, brick and render are four kinds; the far and the near wall of a kind are the same look', () => {
  assert.equal(new Set(['stucco', 'stone', 'rubble', 'brick'].map((k) => MATERIALS['facade_' + k].live)).size, 4);
  for (const k of ['stucco', 'stone', 'rubble', 'brick']) assert.equal(MATERIALS['facade_' + k].live, MATERIALS['wall_' + k].live);
  assert.equal(FACADE_FAR_SOUP[3].split('|')[0], 'facade_brick');
});

test('the live shader declares its helpers before use, balances its braces and is registered', () => {
  const at = (re) => LIVE_GLSL.search(re);
  const order = ['uint lvP(', 'uint lvH(', 'float lvU(', 'void lvCourses(', 'void lvMasonry(', 'void lvWeather(', 'void lvRender(', 'void lvWindow(', 'void slLiveApply('];
  for (let i = 1; i < order.length; i++) assert.ok(LIVE_GLSL.indexOf(order[i - 1]) >= 0 && LIVE_GLSL.indexOf(order[i - 1]) < LIVE_GLSL.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`);
  assert.ok(at(/lvWindow\(vec2\(xc, ys\)/) > at(/void lvWindow\(/));
  assert.equal((LIVE_GLSL.match(/\{/g) || []).length, (LIVE_GLSL.match(/\}/g) || []).length, 'balanced braces');
  assert.equal((LIVE_GLSL.match(/\(/g) || []).length, (LIVE_GLSL.match(/\)/g) || []).length, 'balanced parentheses');
  assert.equal(LIVE.decl, LIVE_GLSL);
});

test('the GLSL hash is the JS hash (same constants) and its uniform arrays are the size the compiler writes', () => {
  for (const c of ['747796405u', '2891336453u', '277803737u', '16777216.0']) assert.ok(LIVE_GLSL.includes(c), c);
  assert.ok(LIVE_GLSL.includes(`uBwT[${MAX_TYPES * 4}]`) && LIVE_GLSL.includes(`uBwCdf[${MAX_TYPES * 3}]`));
  assert.equal(LIVE.uniforms.uBwT.value.length, MAX_TYPES * 16);
  assert.equal(LIVE.uniforms.uBwCdf.value.length, MAX_TYPES * 3);
  assert.equal(LIVE.uniforms.uBwSt.value.length, 6);
});

test('the bay keeps its size and the baked detail tile is one bay', () => {
  assert.deepEqual([BAY.width, BAY.height], SETS.wd_masonry.tile);
  assert.deepEqual(SETS.wd_render.tile, SETS.wd_masonry.tile);
});

test('setBayStyle puts the style pack table into the uniforms; another table gives other uniforms', () => {
  const c = setBayStyle(resolveStyle());
  assert.ok(c.names.length >= 10, 'the default table has many window types');
  const before = Array.from(LIVE.uniforms.uBwT.value.slice(0, 16));
  const custom = setBayStyle({ ...resolveStyle(), bayWindows: { types: { only: { shape: 'circle', w: 0.5, grid: [1, 1] } }, classes: { ground: { only: 1 } } } });
  assert.equal(custom.names.length, 1);
  assert.notDeepEqual(Array.from(LIVE.uniforms.uBwT.value.slice(0, 16)), before);
  setBayStyle(resolveStyle());
  assert.deepEqual(Array.from(LIVE.uniforms.uBwT.value.slice(0, 16)), before, 'back to the default table');
  assert.ok(DEFAULT_STYLE.bayWindows.types.sash6);
});
