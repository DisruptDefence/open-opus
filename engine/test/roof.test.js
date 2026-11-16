// Roofs (src/gen/roof.js; docs/plans/SCENE-DETAIL.md item 4). The tests here hold for ANY roof generator that keeps
// the contract in the file's header, so they pass on the placeholder and must keep passing when item 4 fills it in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roof } from '../src/gen/roof.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, ROOF_SOUP, ROOF_TINT_SOUP } from '../src/gen/style.js';
import { planArea, building, oldQuebec } from './helpers.js';
import { inset, triangulate, signedArea } from '../src/gen/poly.js';
import { jsonSource } from '../src/scene/source.js';

const style = resolveStyle();
const RECT = [0, 0, 12, 0, 12, 8, 0, 8], L = [0, 0, 12, 0, 12, 4, 6, 4, 6, 8, 0, 8], rev = (r) => { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
test('every roof shape on a rectangle, in both windings: covers the footprint, faces up, stays between eave and top', () => {
  for (const ring of [RECT, rev(RECT)]) for (let shape = 0; shape <= 8; shape++) {
    const b = building(ring, { roofShape: shape, hRoof: shape ? 3 : 0 }), soups = createSoups(), info = roof(soups, b, style), e = b.yBase + b.hEave;
    assert.ok(Array.isArray(info.slots) && Array.isArray(info.ridge) && typeof info.parapet === 'number', 'returns { slots, ridge, parapet }');
    let area = 0, tris = 0;
    for (const [key, s] of soups.map) {
      if (!/^roof_|^concrete/.test(key)) continue; // gable walls go to the wall soup
      area += planArea(s); tris += s.pos.length / 9;
      for (let i = 0; i < s.pos.length; i += 3) { assert.ok(s.pos[i + 1] >= e - 1e-6 && s.pos[i + 1] <= e + b.hRoof + 0.46 + 1e-6, `shape ${shape}: y ${s.pos[i + 1]}`); assert.ok(s.pos[i] >= -1e-3 && s.pos[i] <= 12.001 && s.pos[i + 2] >= -1e-3 && s.pos[i + 2] <= 8.001); }
      for (let i = 1; i < s.nrm.length; i += 3) assert.ok(s.nrm[i] > 0, `shape ${shape}: a roof plane faces up`);
    }
    assert.ok(Math.abs(area - 96) / 96 < 0.01, `shape ${shape}: plan area ${area.toFixed(2)} of 96`); assert.ok(tris > 0);
  }
});
test('no outline makes a roof throw or leave its box: an L, in both windings, every shape', () => {
  for (const ring of [L, rev(L)]) for (let shape = 0; shape <= 8; shape++) {
    const b = building(ring, { roofShape: shape, hRoof: shape ? 3 : 0 }), soups = createSoups(), info = roof(soups, b, style), e = b.yBase + b.hEave;
    assert.ok(Array.isArray(info.slots) && Array.isArray(info.ridge)); assert.ok(soups.triangles() > 0);
    for (const s of soups.map.values()) for (let i = 0; i < s.pos.length; i += 3) assert.ok(s.pos[i + 1] >= e - 1e-6 && s.pos[i + 1] <= e + b.hRoof + 0.46 + 1e-6 && s.pos[i] >= -1e-3 && s.pos[i] <= 12.001 && s.pos[i + 2] >= -1e-3 && s.pos[i + 2] <= 8.001);
  }
});
test('a roof with a colour goes to the tinted soup with that colour; one without goes to its material\'s soup', () => {
  const plain = createSoups(); roof(plain, building(RECT, { roofMat: 2 }), style); assert.ok(plain.map.get(ROOF_SOUP[2]).pos.length > 0);
  const tinted = createSoups(); roof(tinted, building(RECT, { roofColor: [0.2, 0.4, 0.3] }), style); const s = tinted.map.get(ROOF_TINT_SOUP[1]);
  assert.ok(s && s.col.length === s.pos.length, 'one colour per vertex');
});
test('a flat roof with a courtyard covers the footprint less the hole; the same building gives the same roof', () => {
  const b = building([0, 0, 20, 0, 20, 20, 0, 20], { holes: [[6, 6, 14, 6, 14, 14, 6, 14]], roofShape: 0, hRoof: 0 }), a = createSoups(), c = createSoups();
  roof(a, b, style); roof(c, b, style);
  assert.ok(Math.abs(planArea(a.map.get(ROOF_SOUP[1])) - (400 - 64)) < 1e-6); assert.deepEqual(a.map.get(ROOF_SOUP[1]).pos, c.map.get(ROOF_SOUP[1]).pos);
});
const HOLE = [4.5, 2.5, 7.5, 2.5, 7.5, 5.5, 4.5, 5.5];
test('on a ring with a hole, every shape covers the footprint less the hole with planes that face up, in both windings', () => {
  for (const [ring, hole] of [[RECT, HOLE], [rev(RECT), rev(HOLE)]]) for (let shape = 0; shape <= 8; shape++) {
    const b = building(ring, { holes: [hole], roofShape: shape, hRoof: shape ? 3 : 0 }), soups = createSoups(); roof(soups, b, style);
    let area = 0; for (const [key, s] of soups.map) { if (!/^roof_|^concrete/.test(key)) continue; area += planArea(s); for (let i = 1; i < s.nrm.length; i += 3) assert.ok(s.nrm[i] > 0); }
    assert.ok(Math.abs(area - 87) / 87 < 0.01, `shape ${shape}: ${area.toFixed(2)} of 87`);
  }
});
test('the L covers its footprint (72) within 1 % for every shape, in both windings', () => {
  for (const ring of [L, rev(L)]) for (let shape = 0; shape <= 8; shape++) {
    const soups = createSoups(); roof(soups, building(ring, { roofShape: shape, hRoof: shape ? 3 : 0 }), style);
    let area = 0; for (const [key, s] of soups.map) if (/^roof_|^concrete/.test(key)) area += planArea(s);
    assert.ok(Math.abs(area - 72) / 72 < 0.01, `shape ${shape}: ${area.toFixed(2)} of 72`);
  }
});
const roofOf = (soups) => [...soups.map].filter(([k]) => /^roof_|^concrete/.test(k)).map(([, s]) => s), wallsOf = (soups) => [...soups.map].filter(([k]) => !/^roof_|^concrete/.test(k)).map(([, s]) => s);
const ys = (list) => list.flatMap((s) => s.pos.filter((_, i) => i % 3 === 1)), count = (list) => list.reduce((n, s) => n + s.pos.length / 9, 0);
test('gabled 12 x 8, H 3: ridge along x at e + 3, 4 roof and 2 gable triangles; roofDir 0 turns it', () => {
  const b = building(RECT, { roofShape: 1, hRoof: 3 }), soups = createSoups(), info = roof(soups, b, style), e = 39;
  assert.equal(count(roofOf(soups)), 4); assert.equal(count(wallsOf(soups)), 2);
  const high = []; for (const s of roofOf(soups)) for (let i = 0; i < s.pos.length; i += 3) if (Math.abs(s.pos[i + 1] - (e + 3)) < 1e-9) high.push([s.pos[i], s.pos[i + 2]]);
  assert.ok(high.length && high.every(([, z]) => Math.abs(z - 4) < 1e-9)); assert.ok(info.ridge.length === 2 && info.ridge.every((r) => Math.abs(r.z - 4) < 1e-9 && Math.abs(r.y - (e + 3)) < 1e-9));
  assert.equal(info.slots.length, 2);
  for (const sl of info.slots) { const mx = sl.ox + sl.ex * sl.len / 2, mz = sl.oz + sl.ez * sl.len / 2, ox = mx - sl.ez * 0.1, oz = mz + sl.ex * 0.1; assert.ok(ox < 0 || ox > 12 || oz < 0 || oz > 8, 'the outside is at (-ez, ex)'); assert.ok(Math.abs(sl.slope - 0.75) < 1e-9); }
  const t = createSoups(), i2 = roof(t, building(RECT, { roofShape: 1, hRoof: 3, roofDir: 0 }), style);
  assert.ok(i2.ridge.every((r) => Math.abs(r.x - 6) < 1e-9) && Math.abs(i2.ridge[0].z - i2.ridge[1].z) > 1);
});
test('hipped 12 x 8, H 4: ridge of length 4 at e + 4', () => {
  const info = roof(createSoups(), building(RECT, { roofShape: 2, hRoof: 4 }), style);
  assert.equal(info.ridge.length, 2); assert.ok(Math.abs(Math.hypot(info.ridge[0].x - info.ridge[1].x, info.ridge[0].z - info.ridge[1].z) - 4) < 1e-9); assert.ok(info.ridge.every((r) => Math.abs(r.y - 43) < 1e-9));
  const soups = createSoups(); roof(soups, building(RECT, { roofShape: 2, hRoof: 4 }), style); assert.equal(Math.max(...ys(roofOf(soups))), 43);
});
test('mansard 10 x 10, H 4: lower ring at inset 1.2 and e + 3.2, four slots of slope 3.2 / 1.2', () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10], soups = createSoups(), info = roof(soups, building(sq, { roofShape: 3, hRoof: 4 }), style), e = 39;
  const lower = []; for (const s of roofOf(soups)) for (let i = 0; i < s.pos.length; i += 3) if (Math.abs(s.pos[i + 1] - (e + 3.2)) < 1e-9) lower.push([s.pos[i], s.pos[i + 2]]);
  assert.ok(lower.some(([x, z]) => Math.abs(x - 1.2) < 1e-9 && Math.abs(z - 1.2) < 1e-9)); assert.equal(info.slots.length, 4);
  for (const sl of info.slots) assert.ok(Math.abs(sl.slope - 3.2 / 1.2) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys(roofOf(soups))) - (e + 4)) < 1e-9);
});
test('pyramidal 6 x 6: 4 triangles meeting at e + H; dome: apex at e + H', () => {
  const sq = [0, 0, 6, 0, 6, 6, 0, 6], soups = createSoups(); roof(soups, building(sq, { roofShape: 4, hRoof: 3 }), style);
  assert.equal(count(roofOf(soups)), 4); const tops = []; for (const s of roofOf(soups)) for (let i = 0; i < s.pos.length; i += 3) if (s.pos[i + 1] > 39 + 2.99) tops.push([s.pos[i], s.pos[i + 2]]);
  assert.equal(tops.length, 4); assert.ok(tops.every(([x, z]) => x === 3 && z === 3));
  const d = createSoups(); roof(d, building(sq, { roofShape: 6, hRoof: 3 }), style); assert.ok(Math.abs(Math.max(...ys(roofOf(d))) - 42) < 1e-3);
});
test('inset: 10 x 10 by 1 is 8 x 8, by 6 is null, the L by 1 has area 36, in either winding', () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10], close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(close(inset(sq, 1), [1, 1, 9, 1, 9, 9, 1, 9])); assert.equal(inset(sq, 6), null); assert.ok(close(inset(rev(sq), 1), [1, 9, 9, 9, 9, 1, 1, 1]));
  const Lr = [0, 0, 12, 0, 12, 4, 6, 4, 6, 8, 0, 8]; assert.ok(close(inset(Lr, 1), [1, 1, 11, 1, 11, 3, 5, 3, 5, 7, 1, 7])); assert.ok(Math.abs(Math.abs(signedArea(inset(rev(Lr), 1))) - 36) < 1e-9);
  assert.equal(inset(Lr, 3), null, 'the collapsed notch is refused'); assert.ok(close(inset(sq, -1), [-1, -1, 11, -1, 11, 11, -1, 11]));
});
test('triangulate of a square with a square hole gives 8 triangles whose areas sum to outer - hole', () => {
  const o = [0, 0, 10, 0, 10, 10, 0, 10], h = [3, 3, 7, 3, 7, 7, 3, 7], t = triangulate(o, [h]), all = o.concat(h); let a = 0;
  for (let i = 0; i < t.length; i += 3) a += Math.abs((all[t[i + 1] * 2] - all[t[i] * 2]) * (all[t[i + 2] * 2 + 1] - all[t[i] * 2 + 1]) - (all[t[i + 2] * 2] - all[t[i] * 2]) * (all[t[i + 1] * 2 + 1] - all[t[i] * 2 + 1])) / 2;
  assert.equal(t.length / 3, 8); assert.ok(Math.abs(a - 84) < 1e-9);
});
test('on the Old Quebec scene: no roof throws, no fan fallback, under 120 000 roof triangles', async () => {
  const source = jsonSource(oldQuebec()), m = source.manifest, st = m.style || style; let tris = 0, n = 0; const before = triangulate.fallbacks, failed = roof.failures, byShape = {};
  for (const c of m.chunks) for (const b of (await source.chunk(c.ce, c.cn)).buildings || []) {
    const soups = createSoups(); roof(soups, b, st); const k = soups.triangles(); tris += k; n++; byShape[b.roofShape] = (byShape[b.roofShape] || 0) + k;
    for (const s of soups.map.values()) for (const v of s.pos) assert.ok(Number.isFinite(v));
  }
  assert.ok(n > 500, `${n} buildings`); assert.equal(triangulate.fallbacks, before, 'no fan fallback'); assert.equal(roof.failures, failed, String(roof.lastError && roof.lastError.stack)); assert.ok(tris < 120000, `${tris} roof triangles ${JSON.stringify(byShape)}`);
});
