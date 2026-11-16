// Passages: a way through a building at ground level (a city gate, a carriage arch). Pure code.
// OWNED BY ITEM 7 of docs/plans/SCENE-DETAIL.md.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   passagePieces(b) -> [piece, …]
//   passageArch(soups, b, p, groundAt, style)
//
//   b        a decoded building (scene/source.js). b.passages = [{ x1, z1, x2, z2, w, h }]: the centre line of the
//            way through on the plan (game metres), its clear width and its clear height above b.yBase (metres).
//   pieces   the building cut by its passages. With no passage: [b] itself, the same object. Otherwise, for each
//            passage, a piece on each side that stands on the ground and a piece over the way that starts at
//            yBase + h. A piece is a COPY of the building with these fields replaced:
//              ring    the piece's outline (flat [x, z, …]); the pieces tile the building's ring exactly
//              holes   the building's holes that lie in this piece (whole; a hole a cut crosses is dropped)
//              yMin    yBase for a piece on the ground, yBase + h over the way
//              blind   Set of edge numbers OF THE PIECE'S RING with no openings: the building's blind edges,
//                      renumbered, plus every edge made by a cut
//              front   Set of edge numbers of the piece's ring that face a street, renumbered the same way
//              piece   0, 1, 2 … (roof details are drawn with piece 0 only)
//            Both the drawing (facade.js, once per piece) and the collision (scene/install.js: one prism per piece,
//            from yMin when it is above the ground, so one walks under it) come from this one function: what is
//            drawn is what collides.
//   passageArch   draws the inside of ONE passage `p` of `b`: the two side walls up to the springing, the vault, and
//            at both mouths the wall between the vault's curve and the clear height. The façade generators draw
//            nothing inside the way.
//   Soups    STRUCTURE_SOUP[b.facade] (style.js), untinted: the same material as the walls, so the arch adds no draw call to
//            the chunk's base. Triplanar: no uv.
//   Winding  counter-clockwise seen from inside the way (the faces look into the passage).
//   Group    `base` (an arch is seen from far away).
//   Budget   <= 200 triangles a passage. Walls and gates together <= 40 000 triangles a scene.
//   Must not leave a piece narrower than a wall is thick: if the cut leaves less than 0.3 m on a side, return [b].

import { quad, tri } from './soup.js';
import { STRUCTURE_SOUP } from './style.js';

const MIN_SIDE = 0.3;   // m: a cut that leaves less than this beside the way leaves the building whole
const ARC = 8;          // segments in the half vault

/**
 * Sutherland-Hodgman against one half-plane (a x + b z + c >= 0) that also says which source edge each new edge comes
 * from: ids[k] is the source edge of the edge that starts at vertex k, or -1 for the edge the cut made.
 */
function cutHalf(ring, ids, a, b, c) {
  const pts = [], arrive = [], n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const e = ids[j / 2], px = ring[j], pz = ring[j + 1], qx = ring[i], qz = ring[i + 1], dp = a * px + b * pz + c, dq = a * qx + b * qz + c;
    if (dp >= 0 !== dq >= 0) { const t = dp / (dp - dq); pts.push(px + (qx - px) * t, pz + (qz - pz) * t); arrive.push(dp >= 0 ? e : -1); }
    if (dq >= 0) { pts.push(qx, qz); arrive.push(e); }
  }
  if (pts.length < 6) return null;
  // the edge arriving at vertex k came from arrive[k]; the edge starting at k is the one arriving at k + 1
  const m = arrive.length, out = new Array(m);
  for (let k = 0; k < m; k++) out[k] = arrive[(k + 1) % m];
  return { ring: pts, ids: out };
}
/** The building's pieces' own edge sets, renumbered through `ids` (edges made by a cut are blind). */
function renumber(ids, blind, front) {
  const bl = new Set(), fr = new Set();
  ids.forEach((e, k) => { if (e < 0 || blind.has(e)) bl.add(k); else if (front.has(e)) fr.add(k); });
  return { blind: bl, front: fr };
}
const inHalf = (ring, a, b, c) => { for (let i = 0; i < ring.length; i += 2) if (a * ring[i] + b * ring[i + 1] + c < -1e-6) return false; return true; };

/** The building cut by its passages: [b] itself without one, else copies (see the header). */
export function passagePieces(b) {
  const ps = b.passages || [];
  if (!ps.length) return [b];
  let live = [{ ring: b.ring, ids: Array.from({ length: b.ring.length / 2 }, (_, k) => k), holes: b.holes || [], yMin: b.yMin, blind: b.blind, front: b.front }];
  for (const p of ps) {
    const L = Math.hypot(p.x2 - p.x1, p.z2 - p.z1); if (L < 1e-6) continue;
    const ux = (p.x2 - p.x1) / L, uz = (p.z2 - p.z1) / L, vx = -uz, vz = ux, o = vx * p.x1 + vz * p.z1, h = p.w / 2, next = [];
    for (const q of live) {
      if (q.yMin > b.yMin + 1e-6) { next.push(q); continue; } // already over a way
      const lat = []; for (let i = 0; i < q.ring.length; i += 2) lat.push(vx * q.ring[i] + vz * q.ring[i + 1] - o);
      if (Math.min(...lat) > h - 1e-6 || Math.max(...lat) < -h + 1e-6) { next.push(q); continue; } // the way does not touch it
      if (Math.max(...lat) - h < MIN_SIDE && Math.max(...lat) > h) return [b];
      if (-Math.min(...lat) - h < MIN_SIDE && Math.min(...lat) < -h) return [b];
      const left = cutHalf(q.ring, q.ids, vx, vz, -o - h), right = cutHalf(q.ring, q.ids, -vx, -vz, o - h);
      const band = cutHalf(q.ring, q.ids, vx, vz, -o + h), middle = band && cutHalf(band.ring, band.ids, -vx, -vz, o + h);
      const make = (cut, yMin, plane) => {
        if (!cut) return null;
        const holes = q.holes.filter((hh) => inHalf(hh, ...plane)), e = renumber(cut.ids, q.blind, q.front);
        return { ring: cut.ring, ids: cut.ids, holes, yMin, ...e };
      };
      // left: lateral >= h; right: lateral <= -h; middle: |lateral| <= h
      const L1 = make(left, q.yMin, [vx, vz, -o - h]), R1 = make(right, q.yMin, [-vx, -vz, o - h]);
      const M1 = middle && make(middle, Math.max(q.yMin, b.yBase + p.h), [vx, vz, -o + h]);
      for (const piece of [L1, M1, R1]) if (piece) next.push(piece);
    }
    live = next;
  }
  if (live.length < 2) return [b];
  return live.map((q, i) => ({ ...b, ring: q.ring, holes: q.holes, yMin: q.yMin, blind: q.blind, front: q.front, piece: i }));
}

// ---- the arch ------------------------------------------------------------------------------------------------------
/** The extent along the axis of the footprint on the line at lateral `lat`: [s0, s1], or null. */
function extentAt(ring, ox, oz, ux, uz, lat) {
  const vx = -uz, vz = ux; let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ap = vx * (ring[j] - ox) + vz * (ring[j + 1] - oz), aq = vx * (ring[i] - ox) + vz * (ring[i + 1] - oz);
    if ((ap - lat) * (aq - lat) > 0 || ap === aq) continue;
    const t = (lat - ap) / (aq - ap), x = ring[j] + (ring[i] - ring[j]) * t, z = ring[j + 1] + (ring[i + 1] - ring[j + 1]) * t, s = ux * (x - ox) + uz * (z - oz);
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  return hi > lo ? [lo, hi] : null;
}

/** The profile of a passage: springing height above the base and the crown's, for width w and clear height h. */
export function vaultProfile(w, h) {
  const spring = w / 2 > h - 2 ? 0.6 * h : h - w / 2;
  return { spring, rise: h - spring, half: w / 2 };
}

/** Draws the inside of ONE passage (see the header). Quads are oriented towards a point inside the way or outside the mouth. */
export function passageArch(soups, b, p, groundAt, style) { // eslint-disable-line no-unused-vars
  const L = Math.hypot(p.x2 - p.x1, p.z2 - p.z1); if (L < 1e-6) return;
  const ux = (p.x2 - p.x1) / L, uz = (p.z2 - p.z1) / L, vx = -uz, vz = ux, ox = p.x1, oz = p.z1, tint = b.tint, soup = soups.get(STRUCTURE_SOUP[b.facade] || STRUCTURE_SOUP[1]);
  const { spring, rise, half } = vaultProfile(p.w, p.h), y0 = b.yBase, inset = 0.03;
  const pt = (s, lat, y) => [ox + ux * s + vx * lat, y, oz + uz * s + vz * lat];
  const ext = (lat) => extentAt(b.ring, ox, oz, ux, uz, lat) || extentAt(b.ring, ox, oz, ux, uz, 0) || [0, L];
  // a quad whose front is the side the point `view` is on, whatever the order given
  const face = (a, bb, c, d, view) => {
    const n = [(bb[1] - a[1]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[1] - a[1]), (bb[2] - a[2]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[2] - a[2]), (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0])];
    const front = n[0] * (view[0] - a[0]) + n[1] * (view[1] - a[1]) + n[2] * (view[2] - a[2]) >= 0;
    if (front) quad(soup, a, bb, c, d, tint); else quad(soup, d, c, bb, a, tint);
  };
  const triFace = (a, bb, c, view) => {
    const n = [(bb[1] - a[1]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[1] - a[1]), (bb[2] - a[2]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[2] - a[2]), (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0])];
    if (n[0] * (view[0] - a[0]) + n[1] * (view[1] - a[1]) + n[2] * (view[2] - a[2]) >= 0) tri(soup, a, bb, c, tint); else tri(soup, a, c, bb, tint);
  };
  const inside = pt((ext(0)[0] + ext(0)[1]) / 2, 0, y0 + spring * 0.5);
  // the two piers' inner faces, up to the springing, a hair inside the cut so the piece's own face does not fight them
  for (const side of [1, -1]) {
    const lat = side * (half - inset), [s0, s1] = ext(side * half);
    const g0 = groundAt(...[pt(s0, lat, 0)[0], pt(s0, lat, 0)[2]]) - 0.2, g1 = groundAt(...[pt(s1, lat, 0)[0], pt(s1, lat, 0)[2]]) - 0.2;
    face(pt(s0, lat, g0), pt(s1, lat, g1), pt(s1, lat, y0 + spring), pt(s0, lat, y0 + spring), inside);
  }
  // the barrel: ARC segments of a half ellipse
  const arc = [];
  for (let k = 0; k <= ARC; k++) { const a = (Math.PI * k) / ARC; arc.push({ lat: Math.cos(a) * (half - inset), y: y0 + spring + Math.sin(a) * rise }); }
  for (let k = 0; k < ARC; k++) {
    const A = arc[k], B = arc[k + 1], eA = ext(A.lat), eB = ext(B.lat);
    face(pt(eA[0], A.lat, A.y), pt(eA[1], A.lat, A.y), pt(eB[1], B.lat, B.y), pt(eB[0], B.lat, B.y), inside);
  }
  // the mouths: between the curve and the clear height, facing out
  for (const end of [0, 1]) {
    const out = (lat) => { const e = ext(lat); return end ? e[1] : e[0]; };
    const view = pt(out(0) + (end ? 5 : -5), 0, y0 + spring);
    for (const side of [1, -1]) {
      const corner = pt(out(side * half), side * half, y0 + p.h);
      for (let k = 0; k < ARC / 2; k++) {
        const a0 = (Math.PI / 2) * (k / (ARC / 2)), a1 = (Math.PI / 2) * ((k + 1) / (ARC / 2));
        const q = (a) => { const lat = side * Math.cos(a) * half; return pt(out(lat), lat, y0 + spring + Math.sin(a) * rise); };
        triFace(corner, q(a0), q(a1), view);
      }
    }
  }
}
