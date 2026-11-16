// Trees: a tree record into a trunk and a crown. Pure code. OWNED BY ITEM 8 of docs/plans/SCENE-DETAIL.md; the body
// below is the placeholder of item 3 (the tree the engine drew before, at both levels of detail).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   tree(soups, t, y, season, lod)
//
//   t        a decoded tree (scene/source.js): x, z (game metres), height (metres, ground to tip), crownRadius
//            (metres), kind (4.5 enum: 1 broadleaf 2 conifer 3 palm 4 shrub 5 dead), form (0 round 1 vase 2 column
//            3 cone 4 spreading).
//   y        the ground under it, metres.
//   season   'summer' | 'autumn' | 'winter' | 'spring'.
//   lod      0: the simple tree of the `far` group (<= 70 triangles), drawn while the cell is beyond the detail
//            distance. 1: the full tree of the `near` group. The two are never drawn together; they must have the
//            same height and crown radius within 15 %, so nothing jumps when one replaces the other.
//   Everything about one tree comes from soup.js seedOf(t.x, t.z): the same tree every time.
//   Soups    SOUP.trunk, SOUP.leaves; `leaves|tv` with a linear tint when a tree is coloured (autumn). Triplanar.
//   Winding  counter-clockwise seen from outside; crowns use soup.js triN() with normals away from the crown's middle.
//   Budget   lod 0 <= 70 triangles; lod 1 <= 400. Collision is the trunk only (scene/install.js), not written here.
//   Must not read the terrain, the DOM or three.js.
import { triN } from './soup.js';
import { SOUP } from './style.js';

export function tree(soups, t, y, season, lod) { // eslint-disable-line no-unused-vars
  const trunk = soups.get(SOUP.trunk), crown = soups.get(SOUP.leaves), SEG = 6;
  const th = t.height * 0.45, r = 0.16 + t.height * 0.012;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const A = [t.x + c0 * r, y - 0.3, t.z + s0 * r], B = [t.x + c1 * r, y - 0.3, t.z + s1 * r], C = [t.x + c1 * r * 0.7, y + th, t.z + s1 * r * 0.7], D = [t.x + c0 * r * 0.7, y + th, t.z + s0 * r * 0.7], n = [c0, 0, s0];
    triN(trunk, A, C, B, n, n, n); triN(trunk, A, D, C, n, n, n);
  }
  // crown: stacked rings and a tip (broadleaf round, conifer tall)
  const conifer = t.kind === 2, R = t.crownRadius * (conifer ? 0.7 : 1), y0 = y + th * (conifer ? 0.5 : 0.85), H = t.height - (y0 - y), N = 7;
  const ring = (k) => { const yy = y0 + H * k, rr = conifer ? R * (1 - k) : R * Math.sin(Math.PI * (0.12 + 0.88 * k)); const o = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2 + k * 2 + t.x; o.push([t.x + Math.cos(a) * rr * (0.85 + 0.3 * Math.sin(i * 2.3 + t.z)), yy, t.z + Math.sin(a) * rr * (0.85 + 0.3 * Math.cos(i * 1.7 + t.x))]); } return o; };
  const levels = conifer ? [0, 0.35, 0.7] : [0, 0.3, 0.62, 0.86], rings = levels.map(ring), tip = [t.x, y0 + H, t.z], base = [t.x, y0, t.z];
  const nOf = (p) => { const dx = p[0] - t.x, dy = p[1] - (y0 + H * 0.4), dz = p[2] - t.z, l = Math.hypot(dx, dy, dz) || 1; return [dx / l, dy / l, dz / l]; };
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) {
    const a = rings[k][i], b = rings[k][(i + 1) % N], cc = rings[k + 1][(i + 1) % N], d = rings[k + 1][i], na = nOf(a), nd = nOf(d);
    triN(crown, a, cc, b, na, na, na); triN(crown, a, d, cc, nd, nd, nd);
  }
  const nt = nOf(tip), down = [0, -1, 0];
  for (let i = 0; i < N; i++) { const a = rings[rings.length - 1][i], b = rings[rings.length - 1][(i + 1) % N]; triN(crown, a, tip, b, nt, nt, nt); const e = rings[0][i], f = rings[0][(i + 1) % N]; triN(crown, e, f, base, down, down, down); }
}
