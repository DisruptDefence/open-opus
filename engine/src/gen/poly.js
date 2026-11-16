// Polygons on the plan. Pure code.
//
// A ring is a flat array [x0, z0, x1, z1, …] in game metres, closed implicitly, in either winding unless a function
// says otherwise. Game z points SOUTH, so a ring whose signedArea() is positive runs clockwise on a north-up map and
// counter-clockwise in the (x, z) plane as mathematics draws it. Lifted to 3D as (x, y, z), a triangle faces UP when
// its signed area here is NEGATIVE. Edge i of a ring runs from vertex i to vertex i + 1 (wrapping): the numbering the
// scene format uses for `blind` and `front`.
//
// Built by item 3 (the mesher needs them): signedArea, centroid, pointInRing, bbox, obb, clip, triangulate.
// Item 4 (roofs): inset, selfIntersects, ringsCross.

/** Twice-the-shoelace over two: positive when the ring runs counter-clockwise in (x, z). */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a / 2;
}
/** The centroid of the area, [x, z]. A ring without area gives the mean of its vertices. */
export function centroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const w = ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
    a += w; cx += (ring[j] + ring[i]) * w; cz += (ring[j + 1] + ring[i + 1]) * w;
  }
  if (Math.abs(a) < 1e-9) { let x = 0, z = 0; for (let i = 0; i < ring.length; i += 2) { x += ring[i]; z += ring[i + 1]; } return [x / (ring.length / 2), z / (ring.length / 2)]; }
  return [cx / (3 * a), cz / (3 * a)];
}
export function pointInRing(x, z, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    if ((ring[i + 1] > z) !== (ring[j + 1] > z) && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) c = !c;
  }
  return c;
}
/** { minX, minZ, maxX, maxZ } */
export function bbox(ring) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]); minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]); }
  return { minX, minZ, maxX, maxZ };
}

/**
 * The oriented bounding box of least area among those lying along an edge of the ring (the same rule the scene
 * builder uses): centre (cx, cz), unit long axis (ux, uz), half length L >= half width W, fill = area / (4 L W).
 * The short axis is (-uz, ux).
 */
export function obb(ring) {
  let best = null;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    let ex = ring[i] - ring[j], ez = ring[i + 1] - ring[j + 1]; const l = Math.hypot(ex, ez); if (l < 1e-6) continue;
    ex /= l; ez /= l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) { const u = ring[k] * ex + ring[k + 1] * ez, v = -ring[k] * ez + ring[k + 1] * ex; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, ex, ez, u0, u1, v0, v1 };
  }
  if (!best) { const [cx, cz] = centroid(ring); return { cx, cz, ux: 1, uz: 0, L: 0, W: 0, fill: 0 }; }
  const { ex, ez, u0, u1, v0, v1 } = best, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, cx = uc * ex - vc * ez, cz = uc * ez + vc * ex;
  const hu = (u1 - u0) / 2, hv = (v1 - v0) / 2, fill = hu * hv > 0 ? Math.abs(signedArea(ring)) / (4 * hu * hv) : 0;
  return hu >= hv ? { cx, cz, ux: ex, uz: ez, L: hu, W: hv, fill } : { cx, cz, ux: -ez, uz: ex, L: hv, W: hu, fill };
}

/** The part of a ring where a x + b z + c >= 0 (Sutherland-Hodgman: exact for a convex ring, and for any ring cut once by a line it crosses twice). Keeps the winding. May return fewer than three vertices: nothing left. */
export function clip(ring, a, b, c) {
  const out = [], n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const px = ring[j], pz = ring[j + 1], qx = ring[i], qz = ring[i + 1], dp = a * px + b * pz + c, dq = a * qx + b * qz + c;
    if (dp >= 0 !== dq >= 0) { const t = dp / (dp - dq); out.push(px + (qx - px) * t, pz + (qz - pz) * t); }
    if (dq >= 0) out.push(qx, qz);
  }
  return out.length >= 6 ? out : [];
}

/** Do segments (a, b) and (c, d) cross properly (not merely touch at an end)? */
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz), d2 = o(ax, az, bx, bz, dx, dz), d3 = o(cx, cz, dx, dz, ax, az), d4 = o(cx, cz, dx, dz, bx, bz);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
/** Does a ring cross itself (two non-adjacent edges cut each other)? */
export function selfIntersects(ring) {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
    if (i === 0 && k === n - 1) continue; // adjacent through the wrap
    if (segCross(ring[i * 2], ring[i * 2 + 1], ring[((i + 1) % n) * 2], ring[((i + 1) % n) * 2 + 1], ring[k * 2], ring[k * 2 + 1], ring[((k + 1) % n) * 2], ring[((k + 1) % n) * 2 + 1])) return true;
  }
  return false;
}
/** Do two rings' edges cross each other? */
export function ringsCross(a, b) {
  const n = a.length / 2, m = b.length / 2;
  for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) {
    if (segCross(a[i * 2], a[i * 2 + 1], a[((i + 1) % n) * 2], a[((i + 1) % n) * 2 + 1], b[k * 2], b[k * 2 + 1], b[((k + 1) % m) * 2], b[((k + 1) % m) * 2 + 1])) return true;
  }
  return false;
}

/**
 * Mitred offset of a ring towards its inside by d metres (a negative d grows it), or null when it collapses.
 * Each vertex is the intersection of its two edges moved in by d; where the edges are within 1 degree of parallel the
 * vertex is moved along the normal. Valid only when the area keeps its sign and is at least 5 % of the original, every
 * new edge points the way its old edge did, and no two non-adjacent new edges cross. Same vertex count and order.
 */
export function inset(ring, d) {
  const n = ring.length / 2; if (n < 3) return null;
  const sa = signedArea(ring); if (Math.abs(sa) < 1e-9) return null;
  const sgn = sa > 0 ? 1 : -1, nx = [], nz = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = ring[j * 2] - ring[i * 2], ez = ring[j * 2 + 1] - ring[i * 2 + 1], l = Math.hypot(ex, ez);
    if (l < 1e-9) return null;
    nx.push((-ez / l) * sgn); nz.push((ex / l) * sgn); // the inward normal of edge i
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n, px = ring[i * 2], pz = ring[i * 2 + 1], det = nx[h] * nz[i] - nz[h] * nx[i];
    if (Math.abs(det) < 0.01745) { out.push(px + (nx[h] + nx[i]) * 0.5 * d, pz + (nz[h] + nz[i]) * 0.5 * d); continue; }
    const c1 = px * nx[h] + pz * nz[h] + d, c2 = px * nx[i] + pz * nz[i] + d;
    out.push((c1 * nz[i] - c2 * nz[h]) / det, (nx[h] * c2 - nx[i] * c1) / det);
  }
  const na = signedArea(out);
  if (na * sa <= 0 || Math.abs(na) < 0.05 * Math.abs(sa)) return null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if ((out[j * 2] - out[i * 2]) * (ring[j * 2] - ring[i * 2]) + (out[j * 2 + 1] - out[i * 2 + 1]) * (ring[j * 2 + 1] - ring[i * 2 + 1]) <= 0) return null;
  }
  return selfIntersects(out) ? null : out;
}

/**
 * Triangles of a ring with holes, by ear clipping: [i, j, k, …], indices into the vertices of the ring followed by
 * those of each hole in turn (vertex n is at coordinates 2n and 2n + 1 of that concatenation). Either winding of the
 * ring and of the holes is taken. Every triangle comes out wound to face UP when lifted to (x, y, z); reverse two
 * indices for a face that looks down. A ring that defeats ear clipping is finished as a fan and counted in
 * `triangulate.fallbacks`, which a scene-wide test keeps at 0.
 */
export function triangulate(ring, holes = []) {
  const X = [], Z = []; // all vertices
  for (let i = 0; i < ring.length; i += 2) { X.push(ring[i]); Z.push(ring[i + 1]); }
  const n0 = X.length; if (n0 < 3) return [];
  // the working loop, counter-clockwise in (x, z)
  let loop = []; for (let i = 0; i < n0; i++) loop.push(i);
  if (signedArea(ring) < 0) loop.reverse();
  const hs = [];
  for (const h of holes) {
    const start = X.length; for (let i = 0; i < h.length; i += 2) { X.push(h[i]); Z.push(h[i + 1]); }
    if (h.length < 6) continue;
    const idx = []; for (let i = start; i < X.length; i++) idx.push(i);
    if (signedArea(h) > 0) idx.reverse(); // holes run the other way
    let m = 0; for (let i = 1; i < idx.length; i++) if (X[idx[i]] > X[idx[m]]) m = i;
    hs.push({ idx, m });
  }
  hs.sort((a, b) => X[b.idx[b.m]] - X[a.idx[a.m]]); // rightmost first, so a bridge never crosses a hole not yet joined
  for (const h of hs) loop = bridge(loop, h, X, Z);

  const cross = (a, b, c) => (X[b] - X[a]) * (Z[c] - Z[a]) - (Z[b] - Z[a]) * (X[c] - X[a]);
  const same = (a, b) => X[a] === X[b] && Z[a] === Z[b];
  const inTri = (a, b, c, p) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const out = [];
  let guard = loop.length * loop.length + 16;
  while (loop.length > 3 && guard-- > 0) {
    let cut = -1;
    for (let i = 0; i < loop.length && cut < 0; i++) {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[i], c = loop[(i + 1) % loop.length], k = cross(a, b, c);
      if (Math.abs(k) < 1e-10) { loop.splice(i, 1); cut = -2; break; } // a vertex on a straight line or a spike: drop it
      if (k < 0) continue; // reflex
      let ear = true;
      for (let q = 0; q < loop.length && ear; q++) {
        const p = loop[q]; if (p === a || p === b || p === c || same(p, a) || same(p, b) || same(p, c)) continue;
        const pa = loop[(q + loop.length - 1) % loop.length], pb = loop[(q + 1) % loop.length];
        if (cross(pa, p, pb) < 0 && inTri(a, b, c, p)) ear = false; // only a reflex vertex can lie inside an ear
      }
      if (ear) cut = i;
    }
    if (cut === -2) continue;
    if (cut < 0) { triangulate.fallbacks++; for (let i = 1; i + 1 < loop.length; i++) out.push(loop[0], loop[i + 1], loop[i]); loop = []; break; }
    const a = loop[(cut + loop.length - 1) % loop.length], b = loop[cut], c = loop[(cut + 1) % loop.length];
    out.push(a, c, b); // counter-clockwise in (x, z) is a, b, c; facing up is the reverse
    loop.splice(cut, 1);
  }
  if (loop.length === 3 && Math.abs(cross(loop[0], loop[1], loop[2])) > 1e-10) out.push(loop[0], loop[2], loop[1]);
  return out;
}
triangulate.fallbacks = 0;

/** Join a hole to the loop by a two-way bridge from its rightmost vertex to a loop vertex it can see. */
function bridge(loop, h, X, Z) {
  const M = h.idx[h.m], mx = X[M], mz = Z[M], n = loop.length;
  // the nearest loop edge hit by a ray from M towards +x
  let bestX = Infinity, at = -1;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    if ((Z[a] > mz) === (Z[b] > mz)) continue;
    const x = X[a] + ((mz - Z[a]) / (Z[b] - Z[a])) * (X[b] - X[a]);
    if (x >= mx - 1e-9 && x < bestX) { bestX = x; at = X[a] > X[b] ? i : (i + 1) % n; }
  }
  if (at < 0) { // no edge to the right (a hole outside its ring): nearest vertex
    let d = Infinity; for (let i = 0; i < n; i++) { const k = (X[loop[i]] - mx) ** 2 + (Z[loop[i]] - mz) ** 2; if (k < d) { d = k; at = i; } }
  } else {
    // a reflex loop vertex inside the triangle (M, hit point, candidate) hides the candidate: take the one closest in angle
    const P = loop[at], px = X[P], pz = Z[P];
    const inside = (x, z) => { const s = (ax, az, bx, bz) => (bx - ax) * (z - az) - (bz - az) * (x - ax); const d1 = s(mx, mz, bestX, mz), d2 = s(bestX, mz, px, pz), d3 = s(px, pz, mx, mz); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
    let tan = Infinity, dist = Infinity;
    for (let i = 0; i < n; i++) {
      const q = loop[i]; if (q === P || X[q] < mx || !inside(X[q], Z[q])) continue;
      const t = Math.abs(Z[q] - mz) / Math.max(1e-12, X[q] - mx), d = (X[q] - mx) ** 2 + (Z[q] - mz) ** 2;
      if (t < tan - 1e-12 || (Math.abs(t - tan) <= 1e-12 && d < dist)) { tan = t; dist = d; at = i; }
    }
  }
  const hole = []; for (let i = 0; i <= h.idx.length; i++) hole.push(h.idx[(h.m + i) % h.idx.length]); // M … back to M
  return [...loop.slice(0, at + 1), ...hole, ...loop.slice(at)];
}
