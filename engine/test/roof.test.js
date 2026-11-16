// Roofs (src/gen/roof.js; docs/plans/SCENE-DETAIL.md item 4). The tests here hold for ANY roof generator that keeps
// the contract in the file's header, so they pass on the placeholder and must keep passing when item 4 fills it in.
// The plan's tests of each shape are listed as todo: item 4 writes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roof } from '../src/gen/roof.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, ROOF_SOUP, ROOF_TINT_SOUP } from '../src/gen/style.js';
import { planArea, building } from './helpers.js';

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
for (const t of ['on an L and on a ring with a hole, every shape covers the footprint within 1 % with planes that face up (the placeholder does on rectangles only)', 'gabled 12 x 8, H 3: ridge along x at e + 3, 4 roof and 2 gable triangles; roofDir 0 turns it', 'hipped 12 x 8, H 4: ridge of length 4 at e + 4',
  'mansard 10 x 10, H 4: lower ring at inset 1.2 and e + 3.2, four slots of slope 3.2 / 1.2', 'pyramidal 6 x 6: 4 triangles meeting at e + H; dome: apex at e + H',
  'inset: 10 x 10 by 1 is 8 x 8, by 6 is null, the L by 1 has area 36, in either winding', 'on the regenerated scene: no roof throws, no fan fallback, under 120 000 roof triangles']) test.todo('item 4: ' + t);
