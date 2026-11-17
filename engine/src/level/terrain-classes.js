// Which material each triangle of the terrain mesh is drawn in, with the edge between two classes cut along the surface
// raster's own contour. Pure code (no three.js): level/build.js buildTerrain gives it the grid and the raster.
//
// The mesh is a grid of m x m vertices; cell (i, j) has corners a = (i, j), b = (i + 1, j), d = (i, j + 1), e = (i + 1, j + 1) and
// is drawn as the triangles a d b and b d e (the same split gen/ground.js `drape` assumes). A triangle whose three corners are of
// one class is drawn whole in it. Where the corners differ the triangle is cut, in its own plane (so the heights, and what the
// walker stands on, do not change), along the line that joins the points on its edges where the raster changes class: one
// small triangle for the odd corner and a quad for the rest, or three quads round the centre when all three differ. The point on
// an edge is found by walking the raster along it, so the cut follows the real boundary and not the 2.5 m grid; a cut point
// is made once per edge and shared by both triangles that own it. A cell steeper than `rock` is rock whole (a cliff face).

/**
 * @param m          vertices per side
 * @param pos        Float32Array(m * m * 3), the vertex positions (x, y, z)
 * @param nrm        Float32Array(m * m * 3), their normals
 * @param classAt    (x, z) -> class name of the raster under the point
 * @param rockCell   (i, j) -> true when the cell is drawn as rock whatever the raster says
 * @returns { byClass: Map(name -> index array), extraPos: number[], extraNrm: number[] } indices >= m * m name extra vertices
 *          (index - m * m) * 3 into extraPos / extraNrm
 */
export function classTriangles({ m, pos, nrm, classAt, rockCell, snap = 0 }) {
  const byClass = new Map(), extraPos = [], extraNrm = [], cuts = new Map(), base = m * m;
  const out = (cls) => { let a = byClass.get(cls); if (!a) byClass.set(cls, (a = [])); return a; };
  const vcls = new Array(m * m);
  for (let k = 0; k < m * m; k++) vcls[k] = classAt(pos[k * 3], pos[k * 3 + 2]);
  const P = (v) => (v < base ? [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]] : [extraPos[(v - base) * 3], extraPos[(v - base) * 3 + 1], extraPos[(v - base) * 3 + 2]]);
  const N = (v) => (v < base ? [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]] : [extraNrm[(v - base) * 3], extraNrm[(v - base) * 3 + 1], extraNrm[(v - base) * 3 + 2]]);
  const add = (p, n) => { extraPos.push(p[0], p[1], p[2]); const l = Math.hypot(n[0], n[1], n[2]) || 1; extraNrm.push(n[0] / l, n[1] / l, n[2] / l); return base + extraPos.length / 3 - 1; };
  /** The vertex on edge a-b where the raster stops being the class of `a` (a, b are grid vertices of different class). */
  const cut = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * (base + 1) + hi;
    let v = cuts.get(key); if (v !== undefined) return v;
    const A = P(lo), B = P(hi), len = Math.hypot(B[0] - A[0], B[2] - A[2]), n = Math.max(4, Math.ceil(len / 0.25)), ca = vcls[lo];
    let t = 0.5;
    for (let s = 1; s <= n; s++) { if (classAt(A[0] + ((B[0] - A[0]) * s) / n, A[2] + ((B[2] - A[2]) * s) / n) !== ca) { t = (s - 0.5) / n; break; } }
    t = Math.min(0.85, Math.max(0.15, t));
    const NA = N(lo), NB = N(hi);
    v = add([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], [NA[0] + (NB[0] - NA[0]) * t, NA[1] + (NB[1] - NA[1]) * t, NA[2] + (NB[2] - NA[2]) * t]);
    cuts.set(key, v); return v;
  };
  const triangle = (a, d, b) => { // wound as the mesh is: a d b
    const c = [vcls[a], vcls[d], vcls[b]], v = [a, d, b];
    if (c[0] === c[1] && c[1] === c[2]) { out(c[0]).push(a, d, b); return; }
    if (c[0] !== c[1] && c[1] !== c[2] && c[0] !== c[2]) { // three classes: three quads round the centroid
      const pa = P(a), pd = P(d), pb = P(b), na = N(a), nd = N(d), nb = N(b);
      const g = add([(pa[0] + pd[0] + pb[0]) / 3, (pa[1] + pd[1] + pb[1]) / 3, (pa[2] + pd[2] + pb[2]) / 3], [na[0] + nd[0] + nb[0], na[1] + nd[1] + nb[1], na[2] + nd[2] + nb[2]]);
      for (let k = 0; k < 3; k++) { const x = v[k], y = v[(k + 1) % 3], z = v[(k + 2) % 3], cy = cut(x, y), cz = cut(x, z); out(c[k]).push(x, cy, g, x, g, cz); }
      return;
    }
    const odd = c[0] === c[1] ? 2 : c[0] === c[2] ? 1 : 0, x = v[odd], y = v[(odd + 1) % 3], z = v[(odd + 2) % 3], cy = cut(x, y), cz = cut(x, z);
    if (snap > 0) { // a sliver of one class is not worth three triangles: the whole triangle takes the class that covers the rest
      const fy = Math.hypot(...P(cy).map((q, k) => q - P(x)[k])) / Math.hypot(...P(y).map((q, k) => q - P(x)[k])), fz = Math.hypot(...P(cz).map((q, k) => q - P(x)[k])) / Math.hypot(...P(z).map((q, k) => q - P(x)[k])), share = fy * fz;
      if (share < snap) { out(c[(odd + 1) % 3]).push(a, d, b); return; }
      if (share > 1 - snap) { out(c[odd]).push(a, d, b); return; }
    }
    out(c[odd]).push(x, cy, cz);                                 // the odd corner's own small triangle
    out(c[(odd + 1) % 3]).push(y, z, cz, y, cz, cy);             // the others: the quad y z cz cy
  };
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
    const a = j * m + i, b = a + 1, d = a + m, e = d + 1;
    if (rockCell(i, j)) { out('rock').push(a, d, b, b, d, e); continue; }
    triangle(a, d, b); triangle(b, d, e);
  }
  return { byClass, extraPos, extraNrm };
}
