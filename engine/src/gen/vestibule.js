// Street doors that open, and the little hall behind each. Pure code (no three.js, no DOM).
// ITEM "doors" of docs/plans/SCENE-DETAIL.md. Interiors beyond this one hall are a later, much larger item.
//
// CONTRACT
//
//   doorOpening(soups, b, e, o, lk, style, groundAt, L, sh) -> null | reason
//       Called by gen/facade.js for one ordinary street door `o` (not a carriage door) of edge `e` of piece `b`. When the
//       door can open it draws the vestibule behind the leaf plane into the soups (floor, walls, ceiling, an inner door
//       that stays shut, a doormat or a coat rail), pushes ONE record onto `soups.doors` and returns null; the caller then
//       leaves the leaf out of the soup (level/build.js draws it as an instance). Otherwise it draws nothing and returns why
//       ('floating' | 'style' | 'room' | 'steep'): the caller draws the fixed leaf as it always did.
//   Record  { id, hinge [x, y, z], axis [x, 0, z] unit along the wall (to the right seen from outside), normal [x, 0, z] unit
//             out of the building, w opening width, leafW, h leaf height, recess, left (hinge on the left seen from outside),
//             tint (linear), facade, ring (the piece's ring: the SAME array the collision prism was made from), edge, s, flip,
//             origin [x, z], u0, u1, ys, yh, ceil, depth, side }
//   Collision  notchPoints/carveRing cut the vestibule out of the piece's ring; doorSolids gives the rest (a lintel over the
//             recess and one over the hall, a floor, the step, a plug that keeps the nav grid shut, the closed leaf).
//             Roofs, upper floors and the far hull keep the ORIGINAL ring: only the physics is given the notched one.
//   leafMatrix(rec, degrees) -> 16 numbers (column-major) for a unit leaf box (x 0..1 from the hinge, y 0..1, z -0.5..0.5).
//   Budget  <= 36 triangles a door. Seeded from the record's id only: nothing here draws from the facade's own streams.
import { quad, tri, frame, rect, slab, shade, rng } from './soup.js';
import { SOUP, paletteColor } from './style.js';
import { pointInRing } from './poly.js';

export const LEAF_T = 0.045;     // m, thickness of a leaf
export const OPEN_DEG = 100;     // how far a leaf swings, inward
export const SIDE = 0.25;        // m the hall is wider than the door, each side
export const MIN_WALL = 0.3;     // m of wall left between the hall and any other outer wall
export const MAX_RISE = 0.4;     // m the step may rise from the street to the threshold and still be climbed
const STEP_DEPTH = 0.42, STEP_OUT = 0.12; // the drawn door step (gen/facade.js)

const hash = (...v) => { let h = 2166136261; for (const x of v) h = Math.imul(h ^ (x | 0), 16777619) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return h >>> 0; };

/** A point of the door's frame: u along the wall, d out of it (negative = into the building). */
const at = (rec, u, d) => [rec.origin[0] + rec.axis[0] * u + rec.normal[0] * d, rec.origin[1] + rec.axis[2] * u + rec.normal[2] * d];
const rectRing = (rec, ua, ub, da, db) => [...at(rec, ua, da), ...at(rec, ub, da), ...at(rec, ub, db), ...at(rec, ua, db)];

/** The notch the hall cuts in the ring, as points [x, z] in the order the ring runs (from the start of its edge to the end). */
export function notchPoints(rec) {
  const { u0, u1, side: S, recess: r, depth: D } = rec;
  const p = [[u0, 0], [u0, -r], [u0 - S, -r], [u0 - S, -r - D], [u1 + S, -r - D], [u1 + S, -r], [u1, -r], [u1, 0]].map(([u, d]) => at(rec, u, d));
  return rec.flip ? p.reverse() : p;
}
/** `ring` (flat) with the notch of every record of that ring put in, in the order along each edge. */
export function carveRing(ring, recs) {
  const by = new Map();
  for (const r of recs) { let l = by.get(r.edge); if (!l) by.set(r.edge, (l = [])); l.push(r); }
  const out = [], n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    out.push(ring[i * 2], ring[i * 2 + 1]);
    const l = by.get(i); if (!l) continue;
    l.sort((a, b) => a.s - b.s);
    for (const r of l) for (const p of notchPoints(r)) out.push(p[0], p[1]);
  }
  return out;
}
/** The solids that fill what the notch leaves open: [{ ring, y0, y1 }] with y1 = null meaning "to the top of the building", y0 = null "to well below". */
export function doorSolids(rec) {
  const { u0, u1, side: S, recess: r, depth: D, ys, yh, ceil } = rec;
  return {
    lintelRecess: { ring: rectRing(rec, u0, u1, -r, 0), y0: yh, y1: null },
    lintelHall: { ring: rectRing(rec, u0 - S, u1 + S, -r - D, -r), y0: ceil, y1: null },
    floor: { ring: rectRing(rec, u0 - S, u1 + S, -r - D, 0), y0: null, y1: ys },
    step: { ring: rectRing(rec, u0 - STEP_OUT, u1 + STEP_OUT, 0, STEP_DEPTH), y0: null, y1: ys + 0.02 },
    plug: { ring: rectRing(rec, u0 - S, u1 + S, -r - D, 0), y0: ys - 1, y1: ys + 2.2 },
    leaf: { ring: rectRing(rec, u0, u1, -r - LEAF_T / 2, -r + LEAF_T / 2), y0: ys, y1: yh },
  };
}
/** Axes of the leaf turned `deg` degrees inward: x runs from the hinge along the leaf, z is the face that looks out when shut. */
function leafAxes(rec, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), e = rec.axis, n = rec.normal, k = rec.left ? 1 : -1;
  // shut: x = k e, z = k n; the turn takes x towards -n
  const x = [k * e[0] * c - n[0] * s, k * e[2] * c - n[2] * s], z = [k * n[0] * c + e[0] * s, k * n[2] * c + e[2] * s];
  return { x, z };
}
/** The leaf's footprint turned `deg` degrees (a thin rectangle on the plan): the ring of its solid. */
export function leafRing(rec, deg) {
  const { x, z } = leafAxes(rec, deg), hx = rec.hinge[0], hz = rec.hinge[2], t = LEAF_T / 2, w = rec.leafW;
  return [hx - z[0] * t, hz - z[1] * t, hx + x[0] * w - z[0] * t, hz + x[1] * w - z[1] * t, hx + x[0] * w + z[0] * t, hz + x[1] * w + z[1] * t, hx + z[0] * t, hz + z[1] * t];
}
/** Column-major matrix of a leaf instance: the unit box scaled to the leaf, its hinge edge on the hinge, turned `deg` inward. */
export function leafMatrix(rec, deg, out = new Array(16)) {
  const { x, z } = leafAxes(rec, deg);
  out[0] = x[0] * rec.leafW; out[1] = 0; out[2] = x[1] * rec.leafW; out[3] = 0;
  out[4] = 0; out[5] = rec.h; out[6] = 0; out[7] = 0;
  out[8] = z[0] * LEAF_T; out[9] = 0; out[10] = z[1] * LEAF_T; out[11] = 0;
  out[12] = rec.hinge[0]; out[13] = rec.hinge[1]; out[14] = rec.hinge[2]; out[15] = 1;
  return out;
}
/** Is a body of `radius` at (x, z) in the sweep of the leaf (so that shutting it would shut it on them)? */
export function inSwing(rec, x, z, radius = 0.35) {
  const { x: ax } = leafAxes(rec, 0), dx = x - rec.hinge[0], dz = z - rec.hinge[2];
  const s = dx * ax[0] + dz * ax[1], q = -(dx * rec.normal[0] + dz * rec.normal[2]); // along the shut leaf, depth into the building
  return q > -radius && s > -radius - 0.25 && Math.hypot(s, q) < rec.leafW + radius && s < rec.leafW + radius;
}

// ---- drawing --------------------------------------------------------------------------------------------------------
/** A quad facing the way `hint` says, whatever order its corners came in. */
function face(s, a, b, c, d, tint, hint) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const k = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2];
  if (k >= 0) { tri(s, a, b, c, tint); tri(s, a, c, d, tint); } else { tri(s, a, d, c, tint); tri(s, a, c, b, tint); }
}
const FLOOR_SOUP = { timber: 'wood|tv', stone: 'paving|tv' };
const FLOOR_TINT = { timber: [0.2, 0.115, 0.06], stone: [0.2, 0.19, 0.175] };
const DIM = 0.45; // the hall is lit by what comes through the doorway only: its colours are laid darker than the street's

function drawHall(soups, rec, f, V, kind, lk) {
  const { u0, u1, side: S, recess: r, depth: D, ys, yh, ceil } = rec, a = u0 - S, c = u1 + S, d1 = -r, d2 = -r - D;
  const q = rng(hash(rec.seed, 0x7e57)), wallC = paletteColor(V.walls, q.int(Math.max(1, (V.walls || []).length)), [0.6, 0.58, 0.52]);
  const wall = shade(wallC, DIM), ceilT = shade(wallC, DIM * 0.85), W = soups.get('wall_stucco|tv'), F = soups.get(FLOOR_SOUP[kind]);
  const up = [0, 1, 0], P = (u, y, d) => f.at(u, y, d), n = [f.nx, 0, f.nz], en = [f.ex, 0, f.ez];
  face(F, P(a, ys, d1), P(c, ys, d1), P(c, ys, d2), P(a, ys, d2), shade(FLOOR_TINT[kind], DIM), up);                       // floor
  face(W, P(a, ceil, d2), P(c, ceil, d2), P(c, ceil, d1), P(a, ceil, d1), ceilT, [0, -1, 0]);                             // ceiling
  face(W, P(a, ys, d2), P(c, ys, d2), P(c, ceil, d2), P(a, ceil, d2), wall, n);                                          // back wall
  face(W, P(a, ys, d2), P(a, ys, d1), P(a, ceil, d1), P(a, ceil, d2), wall, en);                                        // left wall, looks right
  face(W, P(c, ys, d1), P(c, ys, d2), P(c, ceil, d2), P(c, ceil, d1), wall, [-en[0], 0, -en[2]]);                       // right wall
  const out = [-n[0], 0, -n[2]];                                                                                         // the inside of the front wall
  face(W, P(a, ys, d1), P(u0, ys, d1), P(u0, ceil, d1), P(a, ceil, d1), wall, out);
  face(W, P(u1, ys, d1), P(c, ys, d1), P(c, ceil, d1), P(u1, ceil, d1), wall, out);
  face(W, P(u0, yh, d1), P(u1, yh, d1), P(u1, ceil, d1), P(u0, ceil, d1), wall, out);
  rect(soups.get(SOUP.door), f, u0 + 0.02, u1 - 0.02, ys, yh, d2 + 0.004, lk.doorC, [0, 0, 1, 1]);                          // the inner door, shut
  if (q() < 0.5) { // a doormat inside the leaf
    const m = shade(FLOOR_TINT[kind], 0.45), um = (u0 + u1) / 2;
    face(F, P(um - 0.32, ys + 0.012, d1 - 0.1), P(um + 0.32, ys + 0.012, d1 - 0.1), P(um + 0.32, ys + 0.012, d1 - 0.55), P(um - 0.32, ys + 0.012, d1 - 0.55), m, up);
  } else { // a coat rail on a side wall, on a frame that looks into the hall
    const left = q() < 0.5, o = at(rec, left ? a : c, d1), fr = left ? frame(o[0], o[1], -n[0], -n[2]) : frame(o[0], o[1], n[0], n[2]);
    slab(W, fr, 0.25, 1.15, ys + 1.55, ys + 1.62, 0, 0.07, shade(wallC, 0.3), 'flrt');
  }
}

/**
 * Called for one street door. See the header. `L` is facade.js's wallLimits (base, floats), `sh` the storey height.
 */
export function doorOpening(soups, b, e, o, lk, style, groundAt, L, sh) {
  const V = style.vestibule; if (!V || !(V.depth > 0)) return 'style';
  if (L.floats) return 'floating';
  const f = e.f, r = o.r, D = V.depth, u0 = o.u0, u1 = o.u1, a = u0 - SIDE, c = u1 + SIDE, d1 = -r, d2 = -r - D;
  if (a < 0.1 || c > e.len - 0.1) return 'room';
  const ys = o.ys, yh = o.yh, ceil = Math.max(yh + 0.1, Math.min(ys + (V.height || 2.5), ys + sh - 0.25));
  // does the hall fit inside this building, with a wall's thickness left against every other outer wall?
  const rings = [b.ring, ...(b.holes || [])], P = (u, d) => { const p = f.at(u, 0, d); return [p[0], p[2]]; };
  const probes = [];
  for (let u = a; u <= c + 1e-6; u += (c - a) / 4) probes.push(P(u, d2));
  for (let d = d1; d >= d2 - 1e-6; d += (d2 - d1) / 3) { probes.push(P(a, d)); probes.push(P(c, d)); }
  if (!pointInRing(...P((a + c) / 2, (d1 + d2) / 2), b.ring)) return 'room';
  for (const [x, z] of probes) {
    if (!pointInRing(x, z, b.ring)) return 'room';
    if (b.holes) for (const h of b.holes) if (pointInRing(x, z, h)) return 'room';
    for (let k = 0; k < rings.length; k++) {
      const R = rings[k], n = R.length / 2;
      for (let i = 0; i < n; i++) {
        if (k === 0 && i === e.i) continue;
        const ax = R[i * 2], az = R[i * 2 + 1], bx = R[((i + 1) % n) * 2], bz = R[((i + 1) % n) * 2 + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < MIN_WALL) return 'room';
      }
    }
  }
  // the threshold is climbed from the street: the ground in front of the step may not be far below it
  const um = (u0 + u1) / 2, lowest = Math.min(...[[um, STEP_DEPTH + 0.05], [u0 - STEP_OUT, STEP_DEPTH + 0.05], [u1 + STEP_OUT, STEP_DEPTH + 0.05]].map(([u, d]) => { const p = f.at(u, 0, d); return groundAt(p[0], p[2]); }));
  if (lowest < ys - MAX_RISE) return 'steep';

  const seed = hash(b.id, b.piece || 0, e.i, Math.round(um * 100)), q = rng(hash(seed, 0x1e4f)), left = q() < 0.5;
  const stone = b.facade >= 1 && b.facade <= 3, want = stone ? 'stone' : 'timber', floors = V.floors || ['timber', 'stone'];
  const kind = floors.includes(want) ? want : floors[seed % floors.length] in FLOOR_SOUP ? floors[seed % floors.length] : 'timber';
  const o0 = f.at(0, 0, 0), hu = left ? u0 + 0.02 : u1 - 0.02, hp = f.at(hu, ys + 0.01, -r);
  const rec = {
    id: 'd' + seed.toString(16), seed, hinge: hp, axis: [f.ex, 0, f.ez], normal: [f.nx, 0, f.nz], w: u1 - u0, leafW: u1 - u0 - 0.04, h: yh - ys - 0.01, recess: r, left,
    tint: lk.doorC, facade: b.facade, ring: b.ring, edge: e.i, s: e.uA > 0 ? e.len - u1 : u0, flip: e.uA > 0, origin: [o0[0], o0[2]], u0, u1, ys, yh, ceil, depth: D, side: SIDE,
  };
  drawHall(soups, rec, f, V, kind, lk);
  (soups.doors || (soups.doors = [])).push(rec);
  return null;
}
