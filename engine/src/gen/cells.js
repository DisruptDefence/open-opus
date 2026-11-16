// Cells: a chunk of 250 m is cut into 4 x 4 cells of 62.5 m, the unit in which detail is built, shown and dropped
// (docs/plans/SCENE-DETAIL.md section 4). Pure code: the reader cuts records into cells with it, the mesher clips
// what is laid on the ground to a cell with it, the loader measures its distances with it.
//
// A cell box is { i, j, index, x0, z0, x1, z1 } in game metres; index = j * 4 + i, i counting towards +x (east) and j
// towards +z (south) from the chunk's minimum corner.

export const CELLS = 4;

export function cellBoxes(x0, z0, size) {
  const out = [], d = size / CELLS;
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) out.push({ i, j, index: j * CELLS + i, x0: x0 + i * d, z0: z0 + j * d, x1: x0 + (i + 1) * d, z1: z0 + (j + 1) * d });
  return out;
}
/** The cell of a point, clamped into the chunk. */
export function cellIndex(x, z, x0, z0, size) {
  const d = size / CELLS, i = Math.min(CELLS - 1, Math.max(0, Math.floor((x - x0) / d))), j = Math.min(CELLS - 1, Math.max(0, Math.floor((z - z0) / d)));
  return j * CELLS + i;
}
/** Distance on the plan from a point to a box (0 inside it). */
export function boxDistance(box, x, z) {
  const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0, dz = z < box.z0 ? box.z0 - z : z > box.z1 ? z - box.z1 : 0;
  return Math.hypot(dx, dz);
}

/**
 * The parts of a polyline [x0, z0, x1, z1, …] inside a box grown by `grow` metres: [{ pts, s0 }], `s0` being the
 * distance along the whole line at which the piece starts. Pieces that touch are joined; a line that leaves and comes
 * back gives two.
 */
export function clipLine(pts, box, grow = 0) {
  const x0 = box.x0 - grow, x1 = box.x1 + grow, z0 = box.z0 - grow, z1 = box.z1 + grow, out = [];
  let cur = null, s = 0;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    // Liang-Barsky
    let t0 = 0, t1 = 1, ok = true;
    for (const [pp, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
      if (pp === 0) { if (q < 0) ok = false; } else { const r = q / pp; if (pp < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; } }
      if (!ok) break;
    }
    if (ok && len > 1e-9 && t1 - t0 > 1e-9) {
      const sx = ax + dx * t0, sz = az + dz * t0, ex = ax + dx * t1, ez = az + dz * t1;
      if (cur && t0 === 0) cur.pts.push(ex, ez);
      else { cur = { pts: [sx, sz, ex, ez], s0: s + len * t0 }; out.push(cur); }
      if (t1 < 1) cur = null;
    } else cur = null;
    s += len;
  }
  return out;
}
export function lineLength(pts) { let s = 0; for (let p = 0; p + 3 < pts.length; p += 2) s += Math.hypot(pts[p + 2] - pts[p], pts[p + 3] - pts[p + 1]); return s; }

/**
 * Cut every triangle of a set of soups by the four vertical planes of a box, in place: what lies outside is dropped,
 * what crosses is cut, with normals and uv carried to the new vertices. Two cells that both hold a road see the same
 * triangles and each keeps its own side, so their halves meet without a gap or an overlap.
 */
export function clipSoups(soups, box) {
  const planes = [[1, 0, -box.x0], [-1, 0, box.x1], [0, 1, -box.z0], [0, -1, box.z1]]; // a x + b z + c >= 0 inside
  for (const s of soups.map.values()) {
    const pos = s.pos, nrm = s.nrm, uv = s.uv, col = s.col, P = [], N = [], U = [], C = col ? [] : null;
    for (let i = 0, t = 0; i < pos.length; i += 9, t++) {
      let minX = Math.min(pos[i], pos[i + 3], pos[i + 6]), maxX = Math.max(pos[i], pos[i + 3], pos[i + 6]), minZ = Math.min(pos[i + 2], pos[i + 5], pos[i + 8]), maxZ = Math.max(pos[i + 2], pos[i + 5], pos[i + 8]);
      if (maxX <= box.x0 || minX >= box.x1 || maxZ <= box.z0 || minZ >= box.z1) continue;
      const tint = col ? [col[i], col[i + 1], col[i + 2]] : null;
      let poly = [0, 1, 2].map((k) => [pos[i + k * 3], pos[i + k * 3 + 1], pos[i + k * 3 + 2], nrm[i + k * 3], nrm[i + k * 3 + 1], nrm[i + k * 3 + 2], uv[t * 6 + k * 2], uv[t * 6 + k * 2 + 1]]);
      if (!(minX >= box.x0 && maxX <= box.x1 && minZ >= box.z0 && maxZ <= box.z1)) {
        for (const [a, b, c] of planes) {
          const next = [];
          for (let k = 0; k < poly.length; k++) {
            const p = poly[(k + poly.length - 1) % poly.length], q = poly[k], dp = a * p[0] + b * p[2] + c, dq = a * q[0] + b * q[2] + c;
            if (dp >= 0 !== dq >= 0) { const f = dp / (dp - dq); next.push(p.map((v, m) => v + (q[m] - v) * f)); }
            if (dq >= 0) next.push(q);
          }
          poly = next; if (poly.length < 3) break;
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
        P.push(v[0], v[1], v[2]); N.push(v[3], v[4], v[5]); U.push(v[6], v[7]); if (C) C.push(tint[0], tint[1], tint[2]);
      }
    }
    s.pos = P; s.nrm = N; s.uv = U; if (col) s.col = C;
  }
  return soups;
}
