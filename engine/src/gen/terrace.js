// A boardwalk or terrace deck: a mapped pedestrian platform drawn as laid boards. Pure code. docs/plans/SCENE-DETAIL.md item 8
// (the `terraces` layer of the format). The scene record says where (a ring with holes), which way the boards run (`dir`, degrees
// from grid north, or 255 = along the long axis of the ring) and how wide a board is (`bw`, m); this file lays them.
//
//   terraceDeck(soups, t, tile, box, style)   writes the deck inside `box` ({ x0, z0, x1, z1 }: the cell) into SOUP wood soups
//
// Boards are laid on the ground like the road ribbons are (drape: cut along the terrain's own triangles), 0.03 m above it. The
// planks are separate polygons of a board width less a 0.012 m joint, 3 to 4.8 m long, staggered row by row, each its own tone, over
// a dark under-layer, so the joints read at any angle and the board direction is the data's. The ring's own triangles come from
// poly.js triangulate; only the triangles that touch the box are laid. Budget: <= 6 000 triangles for a 62.5 m cell of a 20 m wide deck.
// Soups: 'wood|tvn' (tinted, casts no shadow). Must not read the DOM or three.js.
import { tri, rng } from './soup.js';
import { triangulate, obb, clip } from './poly.js';
import { drape } from './ground.js';

const LIFT = 0.04, UNDER = 0.015, JOINT = 0.012, DARK = [0.1, 0.075, 0.055];
const TONES = [[0.95, 0.7, 0.5], [1.1, 0.8, 0.56], [0.82, 0.6, 0.43], [1.25, 0.92, 0.66], [1.0, 0.76, 0.55]];   // weathered boards: the wood material is dark, the tint lifts it

function laid(s, poly, tile, tint, lift) { // a convex plan polygon [x, z, x, z, …] laid on the ground, cut along the terrain's own triangles
  const P = []; for (let i = 0; i < poly.length; i += 2) P.push([poly[i], poly[i + 1]]);
  for (let m = 1; m + 1 < P.length; m++) for (const t of drape([P[0], P[m], P[m + 1]], tile)) tri(s, [t[0][0], t[0][1] + lift, t[0][2]], [t[1][0], t[1][1] + lift, t[1][2]], [t[2][0], t[2][1] + lift, t[2][2]], tint);
}
/** The terrain tile's height at a point (bilinear over its samples; the tile may be a bare { nx, nz, cell, minX, minZ, data }). */
function heightAt(tile, x, z) {
  const fx = Math.min(tile.nx - 1.001, Math.max(0, (x - tile.minX) / tile.cell)), fz = Math.min(tile.nz - 1.001, Math.max(0, (z - tile.minZ) / tile.cell));
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, d = tile.data, k = j * tile.nx + i;
  return d[k] * (1 - a) * (1 - b) + d[k + 1] * a * (1 - b) + d[k + tile.nx] * (1 - a) * b + d[k + tile.nx + 1] * a * b;
}
/** A board: a convex polygon at the ground's height at each corner (a board is under 0.2 m wide: it need not be cut along terrain triangles). */
function board(s, poly, tile, tint) {
  const P = []; for (let i = 0; i < poly.length; i += 2) P.push([poly[i], heightAt(tile, poly[i], poly[i + 1]) + LIFT, poly[i + 1]]);
  for (let m = 1; m + 1 < P.length; m++) { const a = P[0], b = P[m], c = P[m + 1], ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); if (ny >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint); }
}
const hash = (a, b) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;

export function terraceDeck(soups, t, tile, box, style) { // eslint-disable-line no-unused-vars
  const ring = t.ring, holes = t.holes || [], all = ring.concat(...holes), tr = triangulate(ring, holes), s = soups.get('wood|tvn');
  const bw = t.boardWidth || 0.14, o = obb(ring), ang = t.dir >= 0 && t.dir <= 179 ? (t.dir * Math.PI) / 180 : null;
  const ux = ang == null ? o.ux : Math.sin(ang), uz = ang == null ? o.uz : -Math.cos(ang), vx = -uz, vz = ux, seed = t.id | 0;
  const rect = [box.x0, box.z0, box.x1, box.z0, box.x1, box.z1, box.x0, box.z1];
  for (let k = 0; k < tr.length; k += 3) {
    let T = [all[tr[k] * 2], all[tr[k] * 2 + 1], all[tr[k + 1] * 2], all[tr[k + 1] * 2 + 1], all[tr[k + 2] * 2], all[tr[k + 2] * 2 + 1]];
    for (let e = 0; e < 4 && T.length; e++) { // the triangle cut to the cell's box
      const x0 = rect[0], z0 = rect[1], x1 = rect[2], z1 = rect[5];
      T = e === 0 ? clip(T, 1, 0, -x0) : e === 1 ? clip(T, -1, 0, x1) : e === 2 ? clip(T, 0, 1, -z0) : clip(T, 0, -1, z1);
    }
    if (T.length < 6) continue;
    laid(s, T, tile, DARK, UNDER);
    let vlo = Infinity, vhi = -Infinity;
    for (let i = 0; i < T.length; i += 2) { const v = T[i] * vx + T[i + 1] * vz; vlo = Math.min(vlo, v); vhi = Math.max(vhi, v); }
    for (let r = Math.floor(vlo / bw); r * bw < vhi; r++) {
      let R = clip(clip(T, vx, vz, -(r * bw + JOINT / 2)), -vx, -vz, (r + 1) * bw - JOINT / 2); if (R.length < 6) continue;
      let ulo = Infinity, uhi = -Infinity;
      for (let i = 0; i < R.length; i += 2) { const u = R[i] * ux + R[i + 1] * uz; ulo = Math.min(ulo, u); uhi = Math.max(uhi, u); }
      const rr = rng(hash(seed, r)), len = 3.0 + 1.8 * rr(), off = len * rr();   // boards of 3 to 4.8 m, each row shifted
      for (let q = Math.floor((ulo - off) / len); q * len + off < uhi; q++) {
        const a = q * len + off + JOINT / 2, b = (q + 1) * len + off - JOINT / 2, P = clip(clip(R, ux, uz, -a), -ux, -uz, b);
        if (P.length >= 6) board(s, P, tile, TONES[hash(hash(seed, r), q) % TONES.length]);
      }
      R = null;
    }
  }
}
