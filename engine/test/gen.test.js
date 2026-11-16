// The generators' foundation (src/gen/soup.js): every face a helper writes looks outwards, so nothing built from
// them can be lit from behind or culled from the street.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoup, createSoups, tri, quad, prism, box, frame, rect, slab, linear, rng, seedOf } from '../src/gen/soup.js';

/** How many triangles of a soup face away from `centre`. */
function inward(s, centre) {
  let bad = 0;
  for (let i = 0; i < s.pos.length; i += 9) {
    const c = [0, 1, 2].map((k) => (s.pos[i + k] + s.pos[i + 3 + k] + s.pos[i + 6 + k]) / 3 - centre[k]);
    if (c[0] * s.nrm[i] + c[1] * s.nrm[i + 1] + c[2] * s.nrm[i + 2] <= 0) bad++;
  }
  return bad;
}

test('a prism faces outwards whichever way its ring is wound, with top and bottom', () => {
  for (const ring of [[0, 0, 1, 0, 1, 1, 0, 1], [0, 0, 0, 1, 1, 1, 1, 0]]) {
    const s = createSoup(true); prism(s, ring, 0, 2, [0.5, 0.5, 0.5], true, true);
    assert.equal(s.pos.length / 9, 12); assert.equal(inward(s, [0.5, 1, 0.5]), 0);
    assert.equal(s.col.length, s.pos.length); assert.equal(s.nrm.length, s.pos.length); assert.equal(s.uv.length / 2, s.pos.length / 3);
  }
});

test('a box turned on the plan faces outwards', () => {
  const s = createSoup(); box(s, 10, -4, Math.SQRT1_2, Math.SQRT1_2, 2, 0.5, 3, 5, null);
  assert.equal(s.pos.length / 9, 10); assert.equal(inward(s, [10, 4, -4]), 0); assert.equal(s.col, null);
});

test('a frame puts u to the right, y up and d towards the viewer; rect and slab face the viewer', () => {
  const f = frame(5, 5, 1, 0); // e = +x; the viewer stands at +z (south of the wall)
  assert.deepEqual(f.at(2, 3, 0.5), [7, 3, 5.5]);
  const s = createSoup(); rect(s, f, 0, 2, 0, 3, 0);
  assert.ok(s.nrm[2] > 0.99, 'the rectangle faces +z');
  const b = createSoup(); slab(b, f, 0, 2, 1, 1.2, 0, 0.1);
  assert.equal(b.pos.length / 9, 10); assert.equal(inward(b, [6, 1.1, 5.05]), 0);
});

test('triangles without area are dropped; quads carry their uv corners; soups are keyed by material and flags', () => {
  const s = createSoup(); tri(s, [0, 0, 0], [1, 0, 0], [2, 0, 0]); assert.equal(s.pos.length, 0);
  quad(s, [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], null, [0, 0, 3, 2]);
  assert.deepEqual(s.uv, [0, 0, 3, 0, 3, 2, 0, 0, 3, 2, 0, 2]);
  const set = createSoups(); assert.ok(set.get('stone|tv').col); assert.equal(set.get('facade_stone|').col, null); assert.equal(set.get('stone|tv'), set.get('stone|tv'));
  tri(set.get('stone|tv'), [0, 0, 0], [1, 0, 0], [0, 1, 0]); assert.equal(set.triangles(), 1);
});

test('colours are linear, and the random stream repeats for a seed', () => {
  const c = linear('#808080'); assert.ok(Math.abs(c[0] - 0.2158) < 1e-3 && c[0] === c[1] && c[1] === c[2]);
  assert.deepEqual(linear(0xffffff), [1, 1, 1]);
  const a = rng(42), b = rng(42), seq = [a(), a(), a()]; assert.deepEqual(seq, [b(), b(), b()]);
  assert.ok(seq.every((v) => v >= 0 && v < 1) && new Set(seq).size === 3);
  assert.equal(seedOf(12.3, -4.5), seedOf(12.3, -4.5)); assert.notEqual(seedOf(12.3, -4.5), seedOf(12.4, -4.5));
});
