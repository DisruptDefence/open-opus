import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogue, resolveDetail, altThreshold, pickRes, detailBudget, setFiles, packOrm, tileMetres } from '../src/materials/catalogue.js';
import { patchDetailSource } from '../src/materials/detail.js';
import { readFileSync } from 'node:fs';

const cat = parseCatalogue({ base: 'pbr/', sets: {
  a: { kind: 'brick', tile: [1.2, 1.2], maps: ['color', 'normal', 'rough', 'ao'], res: 2048, avg: [0.2, 0.1, 0.1] },
  b: { kind: 'stone_ashlar', tile: 2, maps: ['color'], res: 1024 },
  bad1: { kind: 'x', tile: [0, 1], maps: ['color'] }, bad2: { kind: 'x', tile: 1, maps: ['normal'] }, bad3: null } });

test('catalogue keeps usable sets and reports the rest', () => {
  assert.deepEqual([...cat.sets.keys()], ['a', 'b']);
  assert.equal(cat.problems.length, 3);
  assert.deepEqual(cat.sets.get('b').tile, [2, 2]);
  assert.deepEqual(cat.byKind.get('brick'), ['a']);
});
test('real catalogue parses with no problems and every file exists', () => {
  const f = new URL('../../assets/textures/catalogue.json', import.meta.url);
  const c = parseCatalogue(JSON.parse(readFileSync(f, 'utf8')));
  assert.equal(c.problems.length, 0); assert.ok(c.sets.size > 100);
  for (const name of ['bricks076a', 'pavingstones119']) {
    const e = c.sets.get(name); assert.ok(e, name);
    for (const p of Object.values(setFiles(c, e, new URL('../../assets/textures/', import.meta.url).pathname))) assert.ok(readFileSync(p).length > 100, p);
  }
});
test('set files are paths under the root', () => {
  assert.equal(setFiles(cat, cat.sets.get('a'), '/t/').normal, '/t/pbr/a/normal.webp');
});
test('image size follows the quality budget', () => {
  assert.equal(pickRes(2048, 1024), 1024); assert.equal(pickRes(1024, 512), 512); assert.equal(pickRes(1024, 2048), 1024); assert.equal(pickRes(1024, 0), 0);
  assert.equal(detailBudget({ name: 'low' }).maxRes, 0); assert.equal(detailBudget({ name: 'high' }).maxRes, 1024); assert.ok(detailBudget({ name: 'ultra' }).far > detailBudget({ name: 'medium' }).far);
});
test('style mapping: fallbacks, defaults, overrides, unknown sets', () => {
  const r = resolveDetail({ default: { strength: 0.5 }, materials: { stone: { set: ['nope', 'b', 'a'], scale: 2 }, brick: { set: 'a', strength: 2, hue: 0.4 }, ghost: { set: ['zzz'] } } }, cat);
  const s = r.materials.get('stone');
  assert.deepEqual(s.entries.map((e) => e.name), ['b', 'a']); assert.equal(s.strength, 0.5); assert.deepEqual(tileMetres(s, s.entries[0]), [4, 4]);
  assert.deepEqual(s.tint, [1, 1, 1]);
  assert.equal(r.materials.get('brick').strength, 1); assert.equal(r.materials.get('brick').hue, 0.4);
  assert.ok(!r.materials.has('ghost')); assert.ok(r.problems.some((p) => p.includes('ghost')) && r.problems.some((p) => p.includes('"nope"')));
  assert.equal(resolveDetail(null, cat).materials.size, 0);
});
test('packOrm puts AO, roughness and height in R, G, B', () => {
  const o = packOrm(Uint8Array.of(1, 2), Uint8Array.of(3, 4), null, 2);
  assert.deepEqual([...o], [1, 3, 128, 255, 2, 4, 128, 255]);
});
test('the shader patch lands on the library patched source, and refuses an unknown one', async () => {
  const THREE = await import('../vendor/three.module.js');
  const { applyMaterialPatch } = await import('../src/materials/materials.js');
  const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>' };
  applyMaterialPatch(sh, {});
  const p = patchDetailSource(sh.fragmentShader);
  assert.ok(p.ok); assert.ok(p.src.includes('dtAxis(dqx') && p.src.includes('SL_DETAIL_ALT') && p.src.includes('slDnX * uDt.y'));
  assert.equal(patchDetailSource('void main(){}').ok, false);
  assert.ok(THREE.REVISION);
});

test('a patch set (alt): resolved with defaults, clamped, and dropped with a message when unknown', () => {
  const r = resolveDetail({ materials: {
    asphalt: { set: 'a', alt: { set: ['nope', 'b'], cover: 0.4, edge: 9, size: 0.1, scale: 2 } },
    grass: { set: 'a', alt: { set: ['zzz'] } }, plain: { set: 'a' } } }, cat);
  const a = r.materials.get('asphalt').alt;
  assert.deepEqual(a.entries.map((e) => e.name), ['b']); assert.equal(a.cover, 0.4); assert.equal(a.edge, 0.3); assert.equal(a.size, 0.5); assert.equal(a.scale, 2);
  assert.equal(a.tone, 1); assert.equal(a.hue, 0.5);
  assert.equal(r.materials.get('grass').alt, null); assert.equal(r.materials.get('plain').alt, null);
  assert.ok(r.problems.some((p) => p.includes('grass.alt')));
});
test('the patch threshold falls as the wanted cover grows, and is centred at half cover', () => {
  assert.equal(altThreshold(0.5), 0.5); assert.ok(altThreshold(0.2) > altThreshold(0.4)); assert.ok(altThreshold(0) < 0.75 && altThreshold(1) > 0.25);
});
test('a tint warms a set: three numbers, clamped; anything else is no change', () => {
  const r = resolveDetail({ materials: { a1: { set: 'a', tint: [1.2, 1, 9] }, a2: { set: 'a', tint: [1, 1] }, a3: { set: 'a', tint: 'warm' } } }, cat);
  assert.deepEqual(r.materials.get('a1').tint, [1.2, 1, 4]); assert.deepEqual(r.materials.get('a2').tint, [1, 1, 1]); assert.deepEqual(r.materials.get('a3').tint, [1, 1, 1]);
});
