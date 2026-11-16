// The ground a street is made of: carriageways with crisp edges, sidewalks and kerbs, stairs, crossings, markings.
// Pure code. OWNED BY ITEM 6 of docs/plans/SCENE-DETAIL.md.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   drape(tri3, tile) -> [[[x, y, z], [x, y, z], [x, y, z]], …]
//   roadRibbons(soups, road, tile, style, others = null)   others: the cell's road pieces, so a sidewalk can stop at a junction mouth
//   steps(soups, road, groundAt, style)
//   crossing(soups, c, tile, style)
//   liftRaster(roads, x0, z0, n, style) -> Uint8Array(n * n) | null
//
//   tile      the chunk's height tile (terrain/heightfield.js createGrid): nx, nz, cell, minX, minZ, data (Float32Array,
//             row by row from minimum z; sample (i, j) is at (minX + i cell, minZ + j cell)), baseHeight(x, z) (the
//             terrain without sidewalks) and height(x, z) (with them). The drawn terrain splits cell (i, j), corners
//             a = (i, j), b = (i + 1, j), d = (i, j + 1), e = (i + 1, j + 1), into the triangles a d b and b d e.
//   drape     a triangle on the plan (three [x, z] or [x, y, z] points; y is ignored), cut along those terrain
//             triangles and given their heights from `tile.data`: the result lies exactly on the drawn ground.
//             Callers add their own lift along +y. Parts outside the tile are dropped.
//   road      a decoded road PIECE (scene/source.js): the part of a mapped way that comes within reach of one cell
//             (the cell's box grown by half the width plus 3 m). pts (flat [x, z, …], game metres), kind (the
//             source's word: residential, footway, steps, living_street …), cls (4.3 enum), surface (4.1 enum),
//             width (carriageway, metres), sidewalk ('both' | 'left' | 'right' | 'no': left and right of the direction
//             of the vertices), steps (null, or { count, handrail: 0 none 1 both sides 2 centre }), lit, marking
//             (1 = centre line), bridge, s0 (metres along the whole way at which the piece starts), len (the whole
//             way's length). The mesher never passes a tunnel or a bridge.
//             DRAW THE WHOLE PIECE and let everything that repeats (dashes, treads, posts) be placed by s0 + distance
//             along the piece, never by the piece's own start: the mesher cuts what you write to the cell's box
//             (cells.js clipSoups), and the neighbouring cell draws the same way from its own piece, so the two
//             halves must be the same geometry.
//   steps     for a road with `steps`: `count` treads over the whole way (tread k covers s from k len / count to
//             (k + 1) len / count), stringers, handrails. Not draped: treads are level. Every tread top stays within
//             one riser of groundAt under it, because the walker stands on the terrain (stairs stay sloped ground in
//             the collision).
//   c         a decoded crossing: { x, z, yaw, width }; yaw as props (radians about +y, 0 = the road runs north).
//             A crossing belongs to every cell its square (width + 3 m) touches and is cut to the cell like a road.
//   liftRaster  the centimetres to add to the ground for sidewalks, 1 m cells, row by row from (x0, z0), n cells
//             square: a cell whose centre lies in a sidewalk strip gets round(style.kerb * 100). `roads` are all the
//             road pieces of the chunk (pieces of neighbouring cells overlap: the result must not depend on that).
//             null = nothing is raised. scene/install.js gives it to the height tile, so the walker, the nav grid,
//             the props and the drawn sidewalk all stand at the same height: draw the sidewalk top at
//             tile.baseHeight + style.kerb exactly where this raster is set.
//   Coordinates  game metres, y up, z south. "Left" of a segment from A to B is (ez, -ex) for its unit vector (ex, ez)
//             (on a north-up map, the left hand of someone walking A to B).
//   Winding   ground faces up (normal y > 0); kerb faces look at the carriageway.
//   UV        none: ground materials are triplanar.
//   Soups     GROUND_SOUP[road.surface] for the carriageway, GROUND_SOUP of style.sidewalk.surface for sidewalks,
//             SOUP.kerb, SOUP.paint, SOUP.tread, SOUP.iron (style.js). Lifts above the terrain: carriageway 0.03,
//             markings 0.04, sidewalk style.kerb.
//   Group     `near` only.
//   Budget    <= 60 000 triangles a cell.
//   Decisions  a sidewalk strip and the kerb stone on its edge are drawn as sheets over the terrain (the strip lifted by
//             style.kerb, the stone 0.01 above it); the lift raster of the same strips lifts the walker. Where two roads meet
//             nothing cuts the one's sidewalk where the other crosses it (the contract hands a road alone). A strip has a
//             vertical face on each edge so the lifted sheet never shows a gap under it.
//   Must not  read the DOM or three.js, or draw outside what the record says (no invented streets).


import { SOUP, GROUND_SOUP, SURFACE_NAMES } from './style.js';
import { tri, quad, prism, rng, linear } from './soup.js';

const LIFT_ROAD = 0.03, LIFT_MARK = 0.04, LIFT_MARGIN = 0.02, MARGIN = 0.6, KERB_STONE = 0.15;
const HARD = new Set([1, 2, 3, 4]); // surfaces that sit beside paving: they get a margin strip

// ---- the terrain as drawn ------------------------------------------------------------------------------------------
/** The height of the drawn terrain triangle under (x, z): the planes `drape` uses (not the bilinear baseHeight). */
export function meshHeight(tile, x, z) {
  const { nx, nz, cell, minX, minZ, data } = tile;
  const fx = Math.min(nx - 1 - 1e-9, Math.max(0, (x - minX) / cell)), fz = Math.min(nz - 1 - 1e-9, Math.max(0, (z - minZ) / cell));
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * nx + i, a = data[k], b = data[k + 1], d = data[k + nx], e = data[k + nx + 1];
  return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
}

/** Cut a convex polygon of [x, z] points by the triangle `t` (Sutherland-Hodgman, three half-planes). */
function clipTo(poly, t) {
  const sgn = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]) > 0 ? 1 : -1;
  for (let e = 0; e < 3 && poly.length >= 3; e++) {
    const p = t[e], q = t[(e + 1) % 3], ex = q[0] - p[0], ez = q[1] - p[1], out = [];
    const side = (r) => sgn * (ex * (r[1] - p[1]) - ez * (r[0] - p[0]));
    for (let k = 0; k < poly.length; k++) {
      const a = poly[(k + poly.length - 1) % poly.length], b = poly[k], da = side(a), db = side(b);
      if (da >= 0 !== db >= 0) { const f = da / (da - db); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
      if (db >= 0) out.push(b);
    }
    poly = out;
  }
  return poly;
}

export function drape(tri3, tile) {
  const P = tri3.map((p) => (p.length === 2 ? [p[0], p[1]] : [p[0], p[2]])), out = [], { nx, nz, cell, minX, minZ, data } = tile;
  const x0 = Math.min(P[0][0], P[1][0], P[2][0]), x1 = Math.max(P[0][0], P[1][0], P[2][0]), z0 = Math.min(P[0][1], P[1][1], P[2][1]), z1 = Math.max(P[0][1], P[1][1], P[2][1]);
  const i0 = Math.max(0, Math.floor((x0 - minX) / cell)), i1 = Math.min(nx - 2, Math.floor((x1 - minX) / cell));
  const j0 = Math.max(0, Math.floor((z0 - minZ) / cell)), j1 = Math.min(nz - 2, Math.floor((z1 - minZ) / cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * nx + i, hA = data[k], hB = data[k + 1], hD = data[k + nx], hE = data[k + nx + 1];
    const X = minX + i * cell, Z = minZ + j * cell, A = [X, Z], B = [X + cell, Z], D = [X, Z + cell], E = [X + cell, Z + cell];
    for (const [T, H] of [[[A, D, B], [hA, hD, hB]], [[B, D, E], [hB, hD, hE]]]) {
      const poly = clipTo(P, T);
      if (poly.length < 3) continue;
      const det = (T[1][1] - T[2][1]) * (T[0][0] - T[2][0]) + (T[2][0] - T[1][0]) * (T[0][1] - T[2][1]);
      const V = poly.map((q) => {
        const l0 = ((T[1][1] - T[2][1]) * (q[0] - T[2][0]) + (T[2][0] - T[1][0]) * (q[1] - T[2][1])) / det, l1 = ((T[2][1] - T[0][1]) * (q[0] - T[2][0]) + (T[0][0] - T[2][0]) * (q[1] - T[2][1])) / det;
        return [q[0], H[0] * l0 + H[1] * l1 + H[2] * (1 - l0 - l1), q[1]];
      });
      for (let m = 1; m + 1 < V.length; m++) {
        const a = V[0], b = V[m], c = V[m + 1], cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); // normal y of (b-a)x(c-a)
        if (Math.abs(cy) < 1e-9) continue;
        out.push(cy > 0 ? [a, b, c] : [a, c, b]);
      }
    }
  }
  return out;
}

/** A convex plan polygon [[x, z], …] laid on the ground, `lift` metres above it, into one soup. */
function lay(soup, poly, tile, lift) {
  for (let m = 1; m + 1 < poly.length; m++) for (const t of drape([poly[0], poly[m], poly[m + 1]], tile)) tri(soup, [t[0][0], t[0][1] + lift, t[0][2]], [t[1][0], t[1][1] + lift, t[1][2]], [t[2][0], t[2][1] + lift, t[2][2]]);
}

// ---- lines ---------------------------------------------------------------------------------------------------------
function points(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) { const p = out[out.length - 1]; if (!p || Math.hypot(flat[i] - p[0], flat[i + 1] - p[1]) > 1e-4) out.push([flat[i], flat[i + 1]]); }
  return out;
}
/** The polyline moved `d` metres to its left (d < 0: to its right), the corners mitred and the mitre capped at twice d. */
function offsetLine(P, d) {
  const n = P.length, seg = [];
  for (let i = 0; i + 1 < n; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz); seg.push([dz / l, -dx / l]); }
  return P.map((p, i) => {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i)], dot = a[0] * b[0] + a[1] * b[1];
    let mx = a[0] + b[0], mz = a[1] + b[1], k = 1 + dot;
    if (k < 1e-3) { mx = b[0]; mz = b[1]; k = 1; }
    mx /= k; mz /= k;
    const l = Math.hypot(mx, mz); if (l > 2) { mx = (mx / l) * 2; mz = (mz / l) * 2; }
    return [p[0] + mx * d, p[1] + mz * d];
  });
}
function stripQuads(A, B) { const q = []; for (let i = 0; i + 1 < A.length; i++) q.push([A[i], A[i + 1], B[i + 1], B[i]]); return q; }

/** The nearest point of a polyline to (x, z): { d: distance, s: metres along it, tx, tz: the unit direction there, k: the segment }. */
function nearestOn(P, cum, x, z) {
  let best = null;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1e-12;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / l2)), d = Math.hypot(a[0] + ex * t - x, a[1] + ez * t - z);
    if (!best || d < best.d) { const l = Math.sqrt(l2); best = { d, s: cum[i] + t * l, tx: ex / l, tz: ez / l, k: i }; }
  }
  return best;
}
const MOUTH_SIN = 0.4; // a street meeting another at less than about 24 degrees is a continuation or a fork, not a mouth
const isStreet = (r) => r.cls >= 2 && r.cls <= 6 && !r.steps && !r.tunnel && !r.bridge && r.sidewalk !== 'self';
const sameWay = (a, b) => a === b || (Math.abs((a.len || 0) - (b.len || 0)) < 1e-6 && a.kind === b.kind && a.width === b.width);
/**
 * The stretches of a road's sidewalk that a meeting street takes: [{ side, sa, sb }] in metres along the piece, side 1 left,
 * -1 right, 0 both. Where a street ends on this one the sidewalk is cut across the mouth (the street's width, widened for
 * the angle); where this road ends on another street, or at a node three streets share, its sidewalks stop at the kerb of
 * the other. A way that merely continues (nearly straight on) or bends into the next is not a junction.
 */
function mouthGaps(road, P, cum, others) {
  const gaps = [], s0 = road.s0 || 0, plen = cum[cum.length - 1], len = road.len || plen, hw = road.width / 2, n = P.length;
  const startTrue = s0 < 0.05, endTrue = s0 + plen > len - 0.05;
  const pieces = [];
  for (const q of others || []) {
    if (!isStreet(q) || sameWay(q, road)) continue;
    const Q = points(q.pts); if (Q.length < 2) continue;
    const cq = cumulative(Q), ql = cq[cq.length - 1], qs0 = q.s0 || 0, qlen = q.len || ql;
    pieces.push({ q, Q, cq, hw: q.width / 2, startTrue: qs0 < 0.05, endTrue: qs0 + ql > qlen - 0.05 });
  }
  const seen = [];
  for (const p of pieces) { // a street's own end on this road's body: a mouth on the side it leaves to
    for (const [E, F, tru] of [[p.Q[0], p.Q[1], p.startTrue], [p.Q[p.Q.length - 1], p.Q[p.Q.length - 2], p.endTrue]]) {
      if (!tru) continue;
      const h = nearestOn(P, cum, E[0], E[1]);
      if (h.d > hw + 0.8 || (h.s < 0.3 && startTrue) || (h.s > plen - 0.3 && endTrue)) continue; // on the body, not at this road's own end (that is the other case)
      const dx = F[0] - E[0], dz = F[1] - E[1], dl = Math.hypot(dx, dz) || 1, sn = Math.abs(h.tx * dz - h.tz * dx) / dl;
      if (sn < MOUTH_SIN) continue;
      const side = h.tx * dz - h.tz * dx < 0 ? 1 : -1, m = (p.hw + 0.35) / sn;  // left of the direction of travel is (tz, -tx)
      seen.push({ side, sa: h.s - m, sb: h.s + m });
    }
  }
  gaps.push(...seen);
  for (const [at, tru, dirSign] of [[0, startTrue, 1], [n - 1, endTrue, -1]]) { // this road's own ends
    if (!tru) continue;
    const E = P[at], F = P[at === 0 ? 1 : n - 2], rx = F[0] - E[0], rz = F[1] - E[1], rl = Math.hypot(rx, rz) || 1; // r points into the road
    const touching = [];
    for (const p of pieces) {
      const h = nearestOn(p.Q, p.cq, E[0], E[1]);
      if (h.d > p.hw + 0.8) continue;
      const atEnd = (h.s < 0.6 && p.startTrue) || (h.s > p.cq[p.cq.length - 1] - 0.6 && p.endTrue);
      touching.push({ p, h, atEnd });
    }
    if (!touching.length || (touching.length === 1 && touching[0].atEnd)) continue; // a bend into the next way, or nothing
    for (const { p, h, atEnd } of touching) {
      let dx, dz; // the direction the other street leaves the node
      if (atEnd) { const f = h.s < 0.6 ? p.Q[1] : p.Q[p.Q.length - 2]; dx = f[0] - E[0]; dz = f[1] - E[1]; } else { dx = h.tx; dz = h.tz; }
      const dl = Math.hypot(dx, dz) || 1, cr = (rx * dz - rz * dx) / (rl * dl), sn = Math.abs(cr);
      if (sn < MOUTH_SIN) continue;
      const m = (p.hw + 0.35 + hw * Math.sqrt(1 - sn * sn)) / sn, sd = atEnd ? (at === 0 ? (cr > 0 ? -1 : 1) : (cr > 0 ? 1 : -1)) : 0;
      // r points into the road; "left of travel" is flipped when the road is walked from its start (at 0), as it is for r itself
      gaps.push(at === 0 ? { side: sd, sa: -1, sb: m } : { side: sd, sa: plen - m, sb: plen + 1 });
    }
  }
  return gaps;
}

/** Where the sidewalks of a road are: [{ side: 1 left | -1 right, inner: line at the carriageway edge, outer, quads, stone, want, s: [sa, sb] }]. */
function sidewalkStrips(road, style, others) {
  const sw = road.sidewalk || 'no', width = style.sidewalk.width, hw = road.width / 2, P = points(road.pts), out = [];
  if (road.steps || P.length < 2) return out;
  if (sw === 'self') { const L = offsetLine(P, hw), R = offsetLine(P, -hw); return [{ side: 0, inner: L, outer: R, quads: stripQuads(L, R), stone: [], want: [0, 0], s: [0, 0] }]; } // a mapped sidewalk way: the way itself is raised
  const cum = cumulative(P), plen = cum[cum.length - 1], gaps = isStreet(road) && others && others.length ? mouthGaps(road, P, cum, others) : [];
  for (const side of [1, -1]) {
    if (sw !== 'both' && sw !== (side > 0 ? 'left' : 'right')) continue;
    const cuts = gaps.filter((g) => g.side === side || g.side === 0).map((g) => [Math.max(0, g.sa), Math.min(plen, g.sb)]).filter((g) => g[1] > g[0]).sort((a, b) => a[0] - b[0]);
    let spans = [], at = 0;
    for (const [a, b] of cuts) { if (a > at) spans.push([at, a]); at = Math.max(at, b); }
    if (at < plen) spans.push([at, plen]);
    for (const [sa, sb] of spans) {
      if (sb - sa < 0.4) continue;
      const M = sa === 0 && sb === plen ? P : between(P, cum, sa, sb), inner = offsetLine(M, side * hw), outer = offsetLine(M, side * (hw + width));
      const a = M[0], b = M[1], el = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push({ side, inner, outer, quads: stripQuads(inner, outer), stone: stripQuads(inner, offsetLine(M, side * (hw + Math.min(KERB_STONE, width)))), want: [side * (b[1] - a[1]) / el, -side * (b[0] - a[0]) / el], s: [sa, sb], cut: [sa > 0.001, sb < plen - 0.001] });
    }
  }
  return out;
}

/** Parameters 0..1 along a plan segment at which it crosses a terrain grid line or a cell diagonal (the drawn height is linear between). */
function breaks(a, b, tile) {
  const ts = [0, 1], fa = [(a[0] - tile.minX) / tile.cell, (a[1] - tile.minZ) / tile.cell], fb = [(b[0] - tile.minX) / tile.cell, (b[1] - tile.minZ) / tile.cell];
  for (const [p, q] of [[fa[0], fb[0]], [fa[1], fb[1]], [fa[0] + fa[1], fb[0] + fb[1]]]) {
    if (Math.abs(q - p) < 1e-9) continue;
    const lo = Math.min(p, q), hi = Math.max(p, q);
    for (let g = Math.floor(lo) + 1; g < hi; g++) ts.push((g - p) / (q - p));
  }
  return ts.sort((x, y) => x - y);
}
/** A vertical wall along a plan polyline from `y0` to `y1` above the drawn ground, facing the side of `want` = [x, z]. */
function wallAlong(soup, L, tile, y0, y1, want) {
  for (let i = 0; i + 1 < L.length; i++) {
    const a = L[i], b = L[i + 1], ts = breaks(a, b, tile);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const p = [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]], q = [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]];
      const hp = meshHeight(tile, p[0], p[1]), hq = meshHeight(tile, q[0], q[1]);
      const nrm = (b[1] - a[1]) * want[0] - (b[0] - a[0]) * want[1]; // > 0: (p, q, up) faces want
      const A = [p[0], hp + y0, p[1]], B = [q[0], hq + y0, q[1]], C = [q[0], hq + y1, q[1]], D = [p[0], hp + y1, p[1]];
      if (nrm < 0) quad(soup, A, B, C, D); else quad(soup, B, A, D, C);
    }
  }
}

// ---- the ribbons ---------------------------------------------------------------------------------------------------
const soupOf = (soups, key) => soups.get(key);
const surfaceSoup = (idx) => GROUND_SOUP[idx] || GROUND_SOUP[1];

/** The point `s` metres along a polyline, the last segment's direction carried on beyond either end. */
function along(P, cum, s) {
  const n = P.length;
  let k = 0; while (k < n - 2 && s > cum[k + 1]) k++;
  const a = P[k], b = P[k + 1], l = cum[k + 1] - cum[k], t = (s - cum[k]) / l;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const cumulative = (P) => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return c; };
/** The part of a polyline from `sa` to `sb` (both ends carried on beyond the polyline if need be). */
function between(P, cum, sa, sb) {
  const out = [along(P, cum, sa)];
  for (let i = 1; i + 1 < P.length; i++) if (cum[i] > sa + 1e-6 && cum[i] < sb - 1e-6) out.push(P[i]);
  out.push(along(P, cum, sb));
  return out;
}


// ---- street wear ---------------------------------------------------------------------------------------------------
// Thin alpha decals over the road and sidewalk (materials/outdoor.js `wear`: four bands in one texture), so a street is
// not one clean sheet: grit and leaves along the kerb and at the foot of the walls, tyre tracks, repaired patches of
// asphalt with their sealed seams, oil stains, manhole covers. Everything is placed by distance along the whole way
// (s0 + s) and by numbers drawn from the way's own length and width, never from the piece, so the two cells that
// draw one place draw the same thing. `style.wear` says how much of each kind (0 = none).
const WEAR_BAND = [0, 0.25, 0.5, 0.75], LIFT_WEAR = 0.02, WEAR_TILE = 4, WEAR_STEP = 2.5;
const wearV = (band, t) => WEAR_BAND[band] + (0.08 + 0.84 * t) * 0.25;
const hash32 = (...v) => { let h = 2166136261; for (const x of v) { h = Math.imul(h ^ (Math.round(x) | 0), 16777619); h ^= h >>> 15; } return h >>> 0; };

/** A plan quad [p0, p1, p2, p3] with a uv at each corner, laid on the ground (the uv is affine over the quad). */
function layUV(soup, q, uv, tile, lift) {
  const ax = q[1][0] - q[0][0], az = q[1][1] - q[0][1], bx = q[3][0] - q[0][0], bz = q[3][1] - q[0][1], det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-9) return;
  const at = (x, z) => { const a = ((x - q[0][0]) * bz - (z - q[0][1]) * bx) / det, b = ((z - q[0][1]) * ax - (x - q[0][0]) * az) / det; return [uv[0][0] + a * (uv[1][0] - uv[0][0]) + b * (uv[3][0] - uv[0][0]), uv[0][1] + a * (uv[1][1] - uv[0][1]) + b * (uv[3][1] - uv[0][1])]; };
  for (const tr of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) for (const t of drape(tr, tile)) tri(soup, [t[0][0], t[0][1] + lift, t[0][2]], [t[1][0], t[1][1] + lift, t[1][2]], [t[2][0], t[2][1] + lift, t[2][2]], null, at(t[0][0], t[0][2]), at(t[1][0], t[1][2]), at(t[2][0], t[2][2]));
}
/** A triangle facing up, whatever the order it was given in. */
function triUp(soup, a, b, c, ua, ub, uc) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny >= 0) tri(soup, a, b, c, null, ua, ub, uc); else tri(soup, a, c, b, null, ua, uc, ub);
}
/**
 * A band along two lines of the same length: t = 0 on A, 1 on B; u runs with the metres along the whole way (WEAR_TILE m a
 * repeat). Not cut along the terrain triangles like the road under it (that is most of the cost of a street): each segment
 * is split every WEAR_STEP metres and the points are put on the drawn ground, which the thin band follows to a centimetre.
 */
function wearBand(soup, A, B, cum, s0, band, tile, lift) {
  const v0 = wearV(band, 0), v1 = wearV(band, 1);
  for (let i = 0; i + 1 < A.length; i++) {
    const len = cum[i + 1] - cum[i], n = Math.max(1, Math.ceil(len / WEAR_STEP));
    const pt = (P0, P1, f) => { const x = P0[0] + (P1[0] - P0[0]) * f, z = P0[1] + (P1[1] - P0[1]) * f; return [x, meshHeight(tile, x, z) + lift, z]; };
    for (let k = 0; k < n; k++) {
      const f0 = k / n, f1 = (k + 1) / n, u0 = (s0 + cum[i] + len * f0) / WEAR_TILE, u1 = (s0 + cum[i] + len * f1) / WEAR_TILE;
      const a = pt(A[i], A[i + 1], f0), b = pt(A[i], A[i + 1], f1), c = pt(B[i], B[i + 1], f1), d = pt(B[i], B[i + 1], f0);
      triUp(soup, a, b, c, [u0, v0], [u1, v0], [u1, v1]); triUp(soup, a, c, d, [u0, v0], [u1, v1], [u0, v1]);
    }
  }
}
/** A rectangle centred at metre `s` along the piece, `len` along and `w` across, `off` metres left of the centre line, uv spanning the band's own square. */
function wearSpot(soup, P, cum, s, off, len, w, band, tile, lift) {
  const a = along(P, cum, s - 0.4), b = along(P, cum, s + 0.4), c = along(P, cum, s), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ex = (b[0] - a[0]) / l, ez = (b[1] - a[1]) / l, nx = ez, nz = -ex; // left of the direction of travel
  const pt = (du, dv) => [c[0] + ex * du + nx * (off + dv), c[1] + ez * du + nz * (off + dv)];
  const u0 = 0.04, u1 = 0.96;
  layUV(soup, [pt(-len / 2, -w / 2), pt(len / 2, -w / 2), pt(len / 2, w / 2), pt(-len / 2, w / 2)], [[u0, wearV(band, 0)], [u1, wearV(band, 0)], [u1, wearV(band, 1)], [u0, wearV(band, 1)]], tile, lift);
}
const IRON_TINT = linear(0x2b2c2d), IRON_LIGHT = linear(0x4a4a48);
function wearRoad(soups, road, P, cum, strips, tile, style) {
  const W = (k) => (style.wear && typeof style.wear[k] === 'number' ? style.wear[k] : 1);
  const vehicle = road.cls >= 2 && road.cls <= 5 && !road.steps && road.width >= 3, hard = road.surface === 1 || road.surface === 3 || road.surface === 2;
  const sw = style.sidewalk, hw = road.width / 2, plen = cum[cum.length - 1], len = road.len || plen, s0 = road.s0 || 0;
  const wsoup = soupOf(soups, SOUP.wear), lift = LIFT_ROAD + LIFT_WEAR;
  if (W('gutter') > 0 && vehicle && hard) for (const side of [1, -1]) wearBand(wsoup, offsetLine(P, side * hw), offsetLine(P, side * (hw - 0.8)), cum, s0, 0, tile, lift); // grit against the kerb or the wall
  if (W('gutter') > 0) for (const t of strips) { const M = between(P, cum, t.s[0], t.s[1]); wearBand(wsoup, t.outer, offsetLine(M, t.side * (hw + sw.width - 0.6)), cumulative(M), s0 + t.s[0], 0, tile, style.kerb + LIFT_WEAR); } // and at the foot of the walls
  if (!(vehicle && hard)) return;
  const seed = hash32(len * 10, road.width * 10, road.surface);
  if (W('tracks') > 0 && road.surface !== 2) {
    const o = hw >= 2.5 ? hw * 0.5 : 0.75, lo = Math.max(0, 1.5 - s0), hi = Math.min(plen, len - s0 - 1.5);
    if (hi - lo > 3) { const M = between(P, cum, lo, hi), cm = cumulative(M); for (const side of [1, -1]) wearBand(wsoup, offsetLine(M, side * o - 0.4), offsetLine(M, side * o + 0.4), cm, s0 + lo, 1, tile, lift + 0.001); }
  }
  const slot = (every, salt, fn) => { // one candidate per `every` metres of the whole way, its place drawn from the way's numbers and the slot
    for (let k = Math.floor((s0 - 6) / every); (k + 1) * every <= s0 + plen + 6; k++) { const r = rng(hash32(seed, k, salt)), sAbs = (k + 0.15 + 0.7 * r()) * every; fn(r, sAbs - s0, sAbs); }
  };
  if (W('patches') > 0 && road.surface === 1) slot(24, 1, (r, s, sAbs) => {
    if (r() > 0.5 * W('patches')) return;
    const l = r.range(2.4, 5.2), w = Math.min(r.range(1.1, 2.4), hw * 1.2), off = r.range(-(hw - w / 2 - 0.5), hw - w / 2 - 0.5);
    if (sAbs - l / 2 > 1.5 && sAbs + l / 2 < len - 1.5) wearSpot(wsoup, P, cum, s, off, l, w, 2, tile, lift + 0.002);
  });
  if (W('oil') > 0) slot(14, 2, (r, s, sAbs) => {
    if (r() > 0.45 * W('oil')) return;
    const d = r.range(0.6, 1.5), off = (r() < 0.5 ? -1 : 1) * Math.min(hw * 0.5, hw - 0.9) * r.range(0.6, 1.1) + r.range(-0.2, 0.2);
    if (sAbs > 2 && sAbs < len - 2) wearSpot(wsoup, P, cum, s, off, d * 1.1, d, 3, tile, lift + 0.003);
  });
  if (W('manholes') > 0) slot(38, 3, (r, s, sAbs) => {
    if (r() > 0.7 * W('manholes') || sAbs < 3 || sAbs > len - 3) return;
    const off = r.range(-0.35, 0.35) * hw, c = along(P, cum, s), a0 = along(P, cum, s - 0.4), b0 = along(P, cum, s + 0.4), l = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
    const x = c[0] + ((b0[1] - a0[1]) / l) * off, z = c[1] - ((b0[0] - a0[0]) / l) * off, iron = soupOf(soups, SOUP.iron);
    for (const [rad, top, tint] of [[0.32, 0.026, IRON_TINT], [0.2, 0.034, IRON_LIGHT], [0.1, 0.04, IRON_TINT]]) {
      const ring = []; let hi = -1e9, lo = 1e9;
      for (let k = 0; k < 14; k++) { const an = (k / 14) * Math.PI * 2, px = x + Math.cos(an) * rad, pz = z + Math.sin(an) * rad, h = meshHeight(tile, px, pz); ring.push(px, pz); hi = Math.max(hi, h); lo = Math.min(lo, h); }
      prism(iron, ring, lo - 0.02, hi + LIFT_ROAD + top, tint, true);
    }
  });
}

export function roadRibbons(soups, road, tile, style, others = null) {
  const P = points(road.pts); if (P.length < 2) return;
  const hw = road.width / 2, road_ = soupOf(soups, surfaceSoup(road.surface)), L = offsetLine(P, hw), R = offsetLine(P, -hw);
  if (road.sidewalk === 'self') { // a way that is itself a sidewalk: raised by the kerb, with a kerb face on both edges and at both ends
    const stone = soupOf(soups, SOUP.kerb), kerb = style.kerb;
    for (const q of stripQuads(L, R)) lay(road_, q, tile, kerb);
    const out = (A) => [A[0][0] - P[0][0], A[0][1] - P[0][1]];
    wallAlong(stone, L, tile, 0, kerb, out(L)); wallAlong(stone, R, tile, 0, kerb, out(R));
    const n = P.length - 1, dir = (a, b) => [b[0] - a[0], b[1] - a[1]];
    wallAlong(stone, [R[0], L[0]], tile, 0, kerb, dir(P[1], P[0])); wallAlong(stone, [L[n], R[n]], tile, 0, kerb, dir(P[n - 1], P[n]));
    return;
  }
  for (const q of stripQuads(L, R)) lay(road_, q, tile, road.cls >= 7 ? LIFT_ROAD + 0.006 : LIFT_ROAD); // footways and stairs over streets: one wins, never two
  const sw = style.sidewalk, kerb = style.kerb, strips = sidewalkStrips(road, style, others), have = new Set(strips.map((t) => t.side));
  if (HARD.has(road.surface) && !road.steps) {
    const pave = soupOf(soups, GROUND_SOUP[4]);
    for (const side of [1, -1]) if (!have.has(side)) for (const q of stripQuads(side > 0 ? L : R, offsetLine(P, side * (hw + MARGIN)))) lay(pave, q, tile, LIFT_MARGIN);
  }
  if (strips.length) {
    const walk = soupOf(soups, GROUND_SOUP[Math.max(1, SURFACE_NAMES.indexOf(sw.surface))] || GROUND_SOUP[2]), stone = soupOf(soups, SOUP.kerb);
    for (const t of strips) {
      for (const q of t.quads) lay(walk, q, tile, kerb);
      for (const q of t.stone) lay(stone, q, tile, kerb + 0.01);
      wallAlong(stone, t.inner, tile, LIFT_ROAD, kerb + 0.01, [-t.want[0], -t.want[1]]); // faces the carriageway axis
      wallAlong(walk, t.outer, tile, 0, kerb, t.want); // faces away from it
      for (const k of [0, 1]) if (t.cut && t.cut[k]) { // where a mouth cuts the strip: a kerb face at that end, looking along the road, away from the strip
        const i = k ? t.inner.length - 1 : 0, j = k ? i - 1 : 1, o = t.outer.length - 1;
        wallAlong(stone, [t.inner[i], t.outer[k ? o : 0]], tile, 0, kerb + 0.01, [t.inner[i][0] - t.inner[j][0], t.inner[i][1] - t.inner[j][1]]);
      }
    }
  }
  if (road.marking) {
    const cum = cumulative(P), mark = soupOf(soups, SOUP.paint), end = road.s0 + cum[cum.length - 1];
    for (let k = Math.floor(road.s0 / 9 - 1e-9); k * 9 < end; k++) {
      const sa = Math.max(k * 9 - road.s0, 0), sb = Math.min(k * 9 + 3 - road.s0, cum[cum.length - 1]);
      if (sb - sa < 0.05) continue;
      const M = between(P, cum, sa, sb);
      for (const q of stripQuads(offsetLine(M, 0.06), offsetLine(M, -0.06))) lay(mark, q, tile, LIFT_MARK);
    }
  }
  wearRoad(soups, road, P, cumulative(P), strips, tile, style);
}

export function crossing(soups, c, tile, style) { // eslint-disable-line no-unused-vars
  const ex = -Math.sin(c.yaw), ez = -Math.cos(c.yaw), nx = ez, nz = -ex, mark = soupOf(soups, SOUP.paint), n = Math.max(1, Math.floor((c.width + 0.5) / 1.0));
  for (let k = 0; k < n; k++) {
    const u = (k - (n - 1) / 2) * 1.0, cx = c.x + nx * u, cz = c.z + nz * u;
    lay(mark, [[cx - nx * 0.25 - ex * 1.5, cz - nz * 0.25 - ez * 1.5], [cx + nx * 0.25 - ex * 1.5, cz + nz * 0.25 - ez * 1.5], [cx + nx * 0.25 + ex * 1.5, cz + nz * 0.25 + ez * 1.5], [cx - nx * 0.25 + ex * 1.5, cz - nz * 0.25 + ez * 1.5]], tile, LIFT_MARK);
  }
}

export function liftRaster(roads, x0, z0, n, style) {
  const all = roads || [];
  let out = null; const cm = Math.round(style.kerb * 100);
  for (const road of roads || []) {
    if (road.tunnel || road.bridge || !road.sidewalk || road.sidewalk === 'no' || road.steps) continue;
    for (const t of sidewalkStrips(road, style, all)) for (const q of t.quads) {
      const xs = q.map((p) => p[0]), zs = q.map((p) => p[1]);
      for (let j = Math.max(0, Math.floor(Math.min(...zs) - z0)); j <= Math.min(n - 1, Math.floor(Math.max(...zs) - z0)); j++) for (let i = Math.max(0, Math.floor(Math.min(...xs) - x0)); i <= Math.min(n - 1, Math.floor(Math.max(...xs) - x0)); i++) {
        const px = x0 + i + 0.5, pz = z0 + j + 0.5; let sg = 0, ok = true;
        for (let e = 0; e < 4 && ok; e++) { const a = q[e], b = q[(e + 1) % 4], cr = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]); if (Math.abs(cr) < 1e-12) continue; if (sg && Math.sign(cr) !== sg) ok = false; else sg = Math.sign(cr); }
        if (ok) { out = out || new Uint8Array(n * n); out[j * n + i] = cm; }
      }
    }
  }
  return out;
}

// ---- steps ---------------------------------------------------------------------------------------------------------
const POST = 0.05, RAIL_H = 0.95, STRINGER = 0.2;
function bar(soup, a, b, t) { // a square bar of half-section t between two 3D points
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], hl = Math.hypot(dx, dz), hx = hl > 1e-9 ? -dz / hl : 1, hz = hl > 1e-9 ? dx / hl : 0, l = Math.hypot(dx, dy, dz) || 1;
  const ex = dx / l, ey = dy / l, ez = dz / l; let vx = ey * hz, vy = ez * hx - ex * hz, vz = -ey * hx; const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [(p * hx + q * vx) * t, (q * vy) * t, (p * hz + q * vz) * t]);
  const A = c.map((v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]]), B = c.map((v) => [b[0] + v[0], b[1] + v[1], b[2] + v[2]]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(soup, A[i], A[j], B[j], B[i]); quad(soup, A[j], A[i], B[i], B[j]); }
}

export function steps(soups, road, groundAt, style) { // eslint-disable-line no-unused-vars
  const P = points(road.pts); if (P.length < 2 || !road.steps) return;
  const cum = cumulative(P), plen = cum[cum.length - 1], n = road.steps.count, len = road.len || plen, per = len / n, hw = road.width / 2;
  const tread = soupOf(soups, SOUP.tread), top = (k) => { const a = along(P, cum, k * per - road.s0), b = along(P, cum, (k + 1) * per - road.s0); return Math.max(groundAt(a[0], a[1]), groundAt(b[0], b[1])); };
  const k0 = Math.max(0, Math.floor(road.s0 / per)), k1 = Math.min(n - 1, Math.floor((road.s0 + plen) / per));
  for (let k = k0; k <= k1; k++) {
    const sa = k * per - road.s0, sb = (k + 1) * per - road.s0, M = between(P, cum, sa, sb), ha = groundAt(M[0][0], M[0][1]), hb = groundAt(M[M.length - 1][0], M[M.length - 1][1]);
    const y1 = Math.max(ha, hb), low = ha <= hb ? k - 1 : k + 1, base = Math.min(ha, hb);
    const y0 = Math.min(y1 - 0.04, low >= 0 && low < n ? top(low) : base - 0.05);
    const ring = (a, b) => { const A = offsetLine(M, a), B = offsetLine(M, b), r = []; for (const p of A) r.push(p[0], p[1]); for (let i = B.length - 1; i >= 0; i--) r.push(B[i][0], B[i][1]); return r; };
    prism(tread, ring(hw, -hw), y0, y1, null, true);
    for (const side of [1, -1]) prism(tread, ring(side * hw, side * (hw + STRINGER)), base - 0.3, y1, null, true);
  }
  const hr = road.steps.handrail | 0;
  if (hr) {
    const iron = soupOf(soups, SOUP.iron), sides = hr === 2 ? [0] : [hw + STRINGER / 2, -(hw + STRINGER / 2)];
    const at = (s, off) => { const a = along(P, cum, s), b = along(P, cum, s + 0.05), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [a[0] + ((b[1] - a[1]) / l) * off, a[1] - ((b[0] - a[0]) / l) * off]; };
    const kOf = (s) => Math.min(n - 1, Math.max(0, Math.floor((s + road.s0) / per + 1e-9)));
    for (const off of sides) {
      let prev = null;
      const j0 = Math.ceil(road.s0 / 2 - 1e-9) - 1, j1 = Math.floor((road.s0 + plen) / 2) + 1; // one post beyond each end: the rail reaches it
      for (let j = j0; j <= j1; j++) {
        const s = j * 2 - road.s0, p = at(s, off), y = top(kOf(s)) - 0.085;
        prism(iron, [p[0] - POST, p[1] - POST, p[0] + POST, p[1] - POST, p[0] + POST, p[1] + POST, p[0] - POST, p[1] + POST], y, y + RAIL_H, null, true);
        const tip = [p[0], y + RAIL_H, p[1]];
        if (prev) bar(iron, prev, tip, 0.025);
        prev = tip;
      }
    }
  }
}
