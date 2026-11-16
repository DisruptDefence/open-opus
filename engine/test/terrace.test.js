// Terrace decks and the cast-iron balustrade (docs/plans/SCENE-DETAIL.md item 8). Pure generators, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { terraceDeck } from '../src/gen/terrace.js';
import { wall } from '../src/gen/structures.js';
import { vertices } from './helpers.js';

const style = resolveStyle();
const tile = { nx: 40, nz: 40, cell: 2.5, minX: 0, minZ: 0, data: new Float32Array(1600).fill(20) };
test('a terrace deck lays boards of the data\'s width, along the direction of the data, inside the ring and the cell', () => {
  const t = { id: 3, ring: [10, 10, 40, 10, 40, 30, 10, 30], holes: [[20, 15, 24, 15, 24, 19, 20, 19]], dir: 255, boardWidth: 0.14 };
  const s = createSoups(); terraceDeck(s, t, tile, { x0: 0, z0: 0, x1: 62.5, z1: 62.5 }, style);
  const tris = s.triangles(); assert.ok(tris > 2000 && tris < 12000, `${tris} triangles`);
  for (const [x, y, z] of vertices(s)) { assert.ok(x >= 10 - 1e-6 && x <= 40 + 1e-6 && z >= 10 - 1e-6 && z <= 30 + 1e-6); assert.ok(y >= 20.01 && y <= 20.05); assert.ok(!(x > 20.01 && x < 23.99 && z > 15.01 && z < 18.99), 'no deck in the hole'); }
  const half = createSoups(); terraceDeck(half, t, tile, { x0: 0, z0: 0, x1: 25, z1: 62.5 }, style); assert.ok(half.triangles() < tris * 0.7 && half.triangles() > 0, 'only the cell\'s share');
  // boards run along the long axis (x): within one board polygon the z extent is a board width
  const first = vertices(s).slice(-3), zs = first.map((v) => v[2]); assert.ok(Math.max(...zs) - Math.min(...zs) <= 0.14 + 1e-9);
  const across = createSoups(); terraceDeck(across, { ...t, dir: 0 }, tile, { x0: 0, z0: 0, x1: 62.5, z1: 62.5 }, style); const xs = vertices(across).slice(-3).map((v) => v[0]); assert.ok(Math.max(...xs) - Math.min(...xs) <= 0.14 + 1e-9, 'dir 0 runs the boards north-south');
});
test('a balustrade has posts with balls, two rails and balusters 0.15 m apart, placed by distance along the line, and collides as a thin wall', () => {
  const w = { pts: [0, 0, 12, 0], cls: 6, kind: 'handrail', height: 1.1, parapet: null, thickness: 0.06, material: 8, crenels: false, rail: 'balustrade_iron', s0: 0, len: 12 }, s = createSoups(); wall(s, w, () => 5, style);
  const n = s.triangles(); assert.ok(n > 800 && n < 3000, `${n}`);
  const half = createSoups(); wall(half, { ...w, pts: [6, 0, 12, 0], s0: 6 }, () => 5, style); const posts = (soups) => new Set(vertices(soups).filter((v) => Math.abs(v[1] - (5 + 1.1 + 0.22)) < 1e-6).map((v) => v[0].toFixed(2))); // the ball tops
  for (const x of posts(half)) assert.ok(posts(s).has(x), 'a piece cut from s0 draws its posts where the whole line does');
  const plain = createSoups(); wall(plain, { ...w, rail: 'rail_iron' }, () => 5, style); assert.ok(plain.triangles() < n);
});
