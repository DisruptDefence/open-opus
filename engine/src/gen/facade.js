// Façades: the walls of a building, far (flat, windows in the texture) and near (real openings). Pure code.
// ITEM 5 of docs/plans/SCENE-DETAIL.md.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   bays(len, style, seed) -> { n, width, margin, start }
//   facadeFar(soups, b, groundAt, style, roofInfo)
//   facadeNear(soups, b, groundAt, style, roofInfo)
//
//   soups     a soup set (soup.js). The two functions are called for the same building into DIFFERENT sets: the far
//             set is hidden while the near one is shown, so each draws the whole wall, plinth included.
//   b         a decoded building or ONE PIECE of it (passage.js passagePieces): ring, holes, blind, front and yMin
//             belong to the piece. Edge i runs from ring vertex i to i + 1 (wrapping). blind and front number the
//             outer ring's edges; the edges of a hole are plain walls (windows, no door).
//   groundAt  (x, z) -> ground height, sidewalks included.
//   roofInfo  what roof.js roof() returned for the whole building: slots (dormers), ridge (chimneys), parapet.
//             Dormers and chimneys are drawn by facadeNear for the piece with `b.piece` 0 or undefined only.
//
//   bays      the one layout rule both functions use: bay width a value in style.window.bay fixed by the seed,
//             margin 0.45, n = floor((len - 2 margin) / width) bays centred on the edge. n = 0: no openings.
//   Winding   counter-clockwise seen from outside, on a soup.js frame(): for a ring with positive signedArea the
//             frame runs from vertex B to A, else from A to B; a hole ring is walked the other way round (its wall
//             looks into the hole).
//   UV        far: the wall is cut in three quads (margin, bays, margin): over the bays u counts bays (0 .. n) and v
//             counts storeys, so the bay texture's window lands exactly where the near façade cuts one; the margins
//             and blind edges sample the plain left part of the texture. Near: glass uv 0..1 (a casement) or 1..2 in u
//             (a shop pane), doors 0..1; walls are triplanar.
//   Soups     far: FACADE_FAR_SOUP[facade]; near walls: WALL_SOUP[facade]; plinth, trim, window, door, shutter, awning
//             from SOUP (style.js).
//   Budget    near: <= 180 000 triangles and <= 30 ms for the densest cell of a town; far: 6 triangles an edge.
//   Must not  read the DOM or three.js, keep state between calls, or draw the roof (roof.js does).
import { quad, tri, frame, rect, slab, box, shade, mixTint, rng } from './soup.js';
import { FACADE_FAR_SOUP, WALL_SOUP, ROOF_SOUP, ROOF_TINT_SOUP, SOUP, paletteColor } from './style.js';
import { signedArea, obb } from './poly.js';

const MARGIN = 0.45, DARK = [0.012, 0.012, 0.013];
export function bays(len, style, seed) {
  const [lo, hi] = style.window.bay, width = lo + (hi - lo) * rng(seed)(), n = Math.max(0, Math.floor((len - 2 * MARGIN) / width));
  return { n, width, margin: MARGIN, start: (len - n * width) / 2 };
}

// ---- the edges of a piece, each with its frame ------------------------------------------------------------------------
/** { i, f, len, ax, az, bx, bz, hole, convA, convB }: f runs left to right as seen from outside; u = 0 is the left end. */
function edgesOf(ring, hole, blindOf) {
  const out = [], n = ring.length / 2, pos = signedArea(ring) > 0, flip = hole ? !pos : pos;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, p = (i + n - 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.02) continue;
    const cross = (k, m, o) => (ring[m * 2] - ring[k * 2]) * (ring[o * 2 + 1] - ring[m * 2 + 1]) - (ring[m * 2 + 1] - ring[k * 2 + 1]) * (ring[o * 2] - ring[m * 2]);
    const sg = pos ? 1 : -1, nx = (j + 1) % n;
    const convA = !hole && cross(p, i, j) * sg > 0 && !(blindOf && blindOf.has(p)), convB = !hole && cross(i, j, nx) * sg > 0 && !(blindOf && blindOf.has(j));
    const f = flip ? frame(bx, bz, (ax - bx) / len, (az - bz) / len) : frame(ax, az, (bx - ax) / len, (bz - az) / len);
    out.push({ i, f, len, ax, az, bx, bz, hole, uA: flip ? len : 0, convLeft: flip ? convB : convA, convRight: flip ? convA : convB });
  }
  return out;
}
/** Ground heights along an edge in u (every 2.5 m at most, both ends). */
function profile(e, groundAt) {
  const k = Math.max(1, Math.ceil(e.len / 2.5)), us = [], gs = [];
  for (let s = 0; s <= k; s++) { const u = (e.len * s) / k, p = e.f.at(u, 0, 0); us.push(u); gs.push(groundAt(p[0], p[2])); }
  return { us, gs, max: Math.max(...gs), min: Math.min(...gs) };
}
/** The stone foot of a wall: from the ground (a little below it) up to the plinth height, along the ground's profile. */
function plinth(s, e, pr, base, style) {
  const h = style.plinth.height, d = style.plinth.depth, top = base + h;
  for (let k = 0; k + 1 < pr.us.length; k++) {
    const u0 = pr.us[k], u1 = pr.us[k + 1], b0 = Math.min(pr.gs[k], base) - 0.3, b1 = Math.min(pr.gs[k + 1], base) - 0.3;
    quad(s, e.f.at(u0, b0, d), e.f.at(u1, b1, d), e.f.at(u1, top, d), e.f.at(u0, top, d));
    quad(s, e.f.at(u0, top, d), e.f.at(u1, top, d), e.f.at(u1, top, 0), e.f.at(u0, top, 0)); // the weathering above it
  }
}

// ---- what a building looks like, seeded ------------------------------------------------------------------------------
function look(b, style) {
  const r = rng(((b.id | 0) ^ 0x51ed270b) >>> 0), n = (list) => r.int(Math.max(1, (list || []).length));
  const frameK = n(style.frames), doorK = n(style.doors), trimK = n(style.trim), awnK = n(style.awnings), shutK = n(style.doors);
  const w = style.window, trim = paletteColor(style.trim, trimK);
  return {
    r, trim, frameC: paletteColor(style.frames, frameK), doorC: paletteColor(style.doors, doorK), awnC: paletteColor(style.awnings, awnK), shutC: paletteColor(style.doors, shutK),
    shutters: r() < (w.shutters || 0), ww: w.width * (0.9 + 0.2 * r()), wsc: 0.9 + 0.2 * r(),
    stringCourse: r() < 0.85, headDepth: 0.03 + 0.04 * r(), recess: 0.2 + 0.1 * r(), inShadow: shade(b.tint, 0.72),
  };
}

// ---- the far façade: one wall, the windows are in the texture -------------------------------------------------------
function storeysOf(b, base, eave) {
  const lv = b.levels > 0 ? b.levels : Math.max(1, Math.round(b.hEave / 3.1)), per = b.hEave / lv;
  const n = Math.max(1, Math.round((eave - base) / per));
  return { n, h: (eave - base) / n };
}
function wallLimits(b, groundAt, pr, parapet) {
  const eave = b.yBase + b.hEave, top = eave + (parapet || 0), floats = (b.yMin ?? b.yBase) > pr.max + 0.01;
  const base = floats ? b.yMin : pr.max;
  return { eave, top, base, floats, ok: top > base + 0.05 };
}
function eachEdge(b, fn) {
  const rings = [b.ring, ...(b.holes || [])];
  rings.forEach((ring, k) => { for (const e of edgesOf(ring, k > 0, k === 0 ? b.blind : null)) fn(e, k > 0); });
}

export function facadeFar(soups, b, groundAt, style, roofInfo) {
  const parapet = (roofInfo && roofInfo.parapet) || 0, wall = soups.get(FACADE_FAR_SOUP[b.facade] || FACADE_FAR_SOUP[0]), pl = soups.get(SOUP.plinth);
  eachEdge(b, (e, hole) => {
    const pr = profile(e, groundAt), L = wallLimits(b, groundAt, pr, parapet); if (!L.ok) return;
    if (!L.floats) plinth(pl, e, pr, L.base, style);
    const st = storeysOf(b, L.base, L.eave), v1 = st.n * (L.top - L.base) / (L.eave - L.base), bl = !hole && b.blind && b.blind.has(e.i), by = bays(e.len, style, b.id);
    const q = (u0, u1, t0, t1) => quad(wall, e.f.at(u0, L.base, 0), e.f.at(u1, L.base, 0), e.f.at(u1, L.top, 0), e.f.at(u0, L.top, 0), b.tint, [t0, 0, t1, v1]);
    if (bl || by.n === 0 || st.h < 2.3) { q(0, e.len, 0.04, 0.04 + Math.min(0.26, e.len / 3)); return; }
    const m = Math.min(0.26, by.start / by.width), end = by.start + by.n * by.width;
    q(0, by.start, 0.3 - m, 0.3); q(by.start, end, 0, by.n); q(end, e.len, 0.7, 0.7 + Math.min(0.26, (e.len - end) / by.width));
  });
}

// ---- the near façade --------------------------------------------------------------------------------------------------
/** A triangle facing the side `hint` ([x, y, z] direction) whatever order the points came in. */
function facing(s, a, b, c, tint, hint) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const d = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2];
  if (d >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint);
}

/** The walls of one edge cut around openings. `ops`: [{ u0, u1, ys, yh }] sorted by u, all inside [y0, y1]. */
function wallAround(w, f, len, y0, y1, ops, tint) {
  let u = 0;
  for (const o of ops) {
    if (o.u0 > u + 1e-4) rect(w, f, u, o.u0, y0, y1, 0, tint);
    if (o.ys > y0 + 1e-4) rect(w, f, o.u0, o.u1, y0, o.ys, 0, tint);
    if (o.yh < y1 - 1e-4) rect(w, f, o.u0, o.u1, o.yh, y1, 0, tint);
    u = o.u1;
  }
  if (len > u + 1e-4) rect(w, f, u, len, y0, y1, 0, tint);
}
/** The four faces of a reveal (the opening's inside), looking into the opening. */
function reveal(w, f, o, r, tint) {
  quad(w, f.at(o.u0, o.ys, -r), f.at(o.u0, o.ys, 0), f.at(o.u0, o.yh, 0), f.at(o.u0, o.yh, -r), tint);   // left cheek, faces right
  quad(w, f.at(o.u1, o.ys, 0), f.at(o.u1, o.ys, -r), f.at(o.u1, o.yh, -r), f.at(o.u1, o.yh, 0), tint);   // right cheek, faces left
  quad(w, f.at(o.u0, o.yh, 0), f.at(o.u1, o.yh, 0), f.at(o.u1, o.yh, -r), f.at(o.u0, o.yh, -r), tint);   // soffit
  if (o.sillTop) quad(w, f.at(o.u0, o.ys, -r), f.at(o.u1, o.ys, -r), f.at(o.u1, o.ys, 0), f.at(o.u0, o.ys, 0), tint); // the sill's top
}

/** A painted frame round an opening at depth d: four strips `w` wide, on the opening's edge, facing out. */
function border(T, f, o, d, w, tint) {
  rect(T, f, o.u0, o.u0 + w, o.ys, o.yh, d, tint); rect(T, f, o.u1 - w, o.u1, o.ys, o.yh, d, tint);
  rect(T, f, o.u0 + w, o.u1 - w, o.yh - w, o.yh, d, tint); rect(T, f, o.u0 + w, o.u1 - w, o.ys, o.ys + w, d, tint);
}

function nearEdge(soups, b, e, groundAt, style, roofInfo, lk, seq) {
  const parapet = (roofInfo && roofInfo.parapet) || 0, pr = profile(e, groundAt), L = wallLimits(b, groundAt, pr, parapet); if (!L.ok) return;
  const W = soups.get(WALL_SOUP[b.facade] || WALL_SOUP[0]), T = soups.get(SOUP.trim), G = soups.get(SOUP.window), wd = style.window, gfl = style.groundFloor, f = e.f, len = e.len;
  if (!L.floats) plinth(soups.get(SOUP.plinth), e, pr, L.base, style);
  const blind = !e.hole && b.blind && b.blind.has(e.i), front = !e.hole && b.front && b.front.has(e.i), by = bays(len, style, b.id), st = storeysOf(b, L.base, L.eave);
  const tint = b.tint, inner = lk.inShadow, stone = b.facade >= 1 && b.facade <= 3;
  const cornice = style.cornice, ext0 = e.convLeft ? cornice.depth : 0, ext1 = e.convRight ? cornice.depth : 0;
  // cornice and eave: on every non-blind edge, even when there are no openings
  if (!blind && len > 1) {
    const ch = cornice.height, cd = cornice.depth;
    slab(T, f, -ext0, len + ext1, L.top - ch, L.top, 0, cd, lk.trim, 'fb');
    slab(T, f, -ext0 * 0.5, len + ext1 * 0.5, L.top - ch - 0.09, L.top - ch, 0, cd * 0.55, shade(lk.trim, 0.9), 'fb');
  }
  if (L.top > L.eave + 1e-4) rect(W, f, 0, len, L.eave, L.top, 0, tint);
  // quoins: painted strips up the convex corners of a rendered or brick house
  if (!blind && (b.facade === 4 || b.facade === 0 || (b.facade === 3 && lk.stringCourse)) && len > 2) {
    const qb = L.base + style.plinth.height, q = 0.3;
    if (e.convLeft) slab(T, f, 0, q, qb, L.top, 0, 0.03, lk.trim, 'fr');
    if (e.convRight) slab(T, f, len - q, len, qb, L.top, 0, 0.03, lk.trim, 'fl');
  }
  const noOpenings = blind || by.n === 0 || st.h < 2.3;
  if (noOpenings) { rect(W, f, 0, len, L.base, L.eave, 0, tint); return; }

  const sh = st.h, ww = Math.min(lk.ww, by.width - 0.55), sill = wd.sill * (sh / 3.1 > 1 ? 1 : 0.95), wh = Math.min(wd.height * lk.wsc, sh - sill - 0.35), reveal0 = wd.reveal;
  const door = { w: gfl.doorWidth, h: Math.min(gfl.doorHeight, sh - 0.3) };
  const centre = (k) => by.start + (k + 0.5) * by.width;
  // which bays of the ground storey are doors
  const doors = new Set();
  if (front && b.groundFloor !== 1 && b.groundFloor !== 2) {
    const count = Math.min(by.n, Math.max(1, Math.ceil(len / 14))), highA = pr.gs[0] >= pr.gs[pr.gs.length - 1], from = (k) => (highA ? k : by.n - 1 - k);
    for (let c = 0; c < count; c++) doors.add(from(Math.min(by.n - 1, (by.n > 2 ? 1 : 0) + c * Math.max(1, Math.floor(by.n / count)))));
  }
  if (front && b.groundFloor === 1 && by.n > 0) doors.add(Math.min(by.n - 1, lk.r.int(by.n)));
  if (front && b.groundFloor === 2 && by.n > 0) doors.add(Math.floor((by.n - 1) / 2));

  for (let s = 0; s < st.n; s++) {
    const y0 = L.base + s * sh, y1 = s === st.n - 1 ? L.eave : y0 + sh, ground = s === 0, ops = [];
    for (let k = 0; k < by.n; k++) {
      const c = centre(k), isDoor = ground && doors.has(k);
      if (ground && front && b.groundFloor === 1 && !isDoor) { // a shop window
        const hw = by.width / 2 - gfl.shopPier / 2, top = y0 + sh - gfl.fascia - 0.12;
        ops.push({ kind: 'shop', u0: c - hw, u1: c + hw, ys: y0 + gfl.shopSill, yh: top, r: 0.16 });
      } else if (isDoor) {
        const dw = b.groundFloor === 2 ? 2.6 : door.w, dh = b.groundFloor === 2 ? Math.min(2.4, sh - 0.3) : door.h;
        ops.push({ kind: 'door', u0: c - dw / 2, u1: c + dw / 2, ys: y0, yh: y0 + dh, r: lk.recess, big: b.groundFloor === 2 });
      } else {
        const g = 1, ys = y0 + sill, yh = ys + wh * g; ops.push({ kind: 'win', u0: c - ww / 2, u1: c + ww / 2, ys, yh, r: reveal0, sillTop: true });
      }
    }
    wallAround(W, f, len, y0, y1, ops, tint);
    for (const o of ops) {
      if (o.kind === 'win') {
        reveal(W, f, o, o.r, inner);
        rect(G, f, o.u0, o.u1, o.ys, o.yh, -o.r, null, [0, 0, 1, 1]); if (lk.frameC[1] < 0.6) border(T, f, o, -o.r + 0.04, 0.06, lk.frameC);
        slab(T, f, o.u0 - 0.08, o.u1 + 0.08, o.ys - 0.07, o.ys, 0, 0.08, lk.trim, 'ftb');
        slab(T, f, o.u0 - 0.1, o.u1 + 0.1, o.yh, o.yh + 0.22, 0, lk.headDepth, lk.trim, 'fb');
        if (lk.shutters) { const sw = 0.45 * (o.u1 - o.u0), Sh = soups.get(SOUP.shutter); rect(Sh, f, o.u0 - sw, o.u0, o.ys, o.yh, 0.03, lk.shutC); rect(Sh, f, o.u1, o.u1 + sw, o.ys, o.yh, 0.03, lk.shutC); }
      } else if (o.kind === 'shop') {
        reveal(W, f, o, o.r, inner);
        rect(G, f, o.u0, o.u1, o.ys, o.yh, -o.r, null, [1, 0, 2, 1]); border(T, f, o, -o.r + 0.04, 0.05, mixTint(lk.frameC, DARK, 0.5));
        slab(T, f, o.u0 - 0.06, o.u1 + 0.06, o.ys - 0.06, o.ys, 0, 0.1, lk.trim, 'ftb');
      } else { // a door, recessed
        const D = soups.get(SOUP.door);
        reveal(W, f, o, o.r, inner);
        quad(W, f.at(o.u0, o.ys, -o.r), f.at(o.u1, o.ys, -o.r), f.at(o.u1, o.ys, 0), f.at(o.u0, o.ys, 0), inner);
        rect(D, f, o.u0 + 0.02, o.u1 - 0.02, o.ys, o.yh, -o.r, lk.doorC, [0, 0, 1, 1]);
        const gd = groundAt(f.at((o.u0 + o.u1) / 2, 0, 0.6)[0], f.at((o.u0 + o.u1) / 2, 0, 0.6)[2]), y = Math.min(gd, L.base) - 0.05;
        slab(soups.get(SOUP.tread), f, o.u0 - 0.12, o.u1 + 0.12, y, L.base + 0.02, 0, 0.42, null, 'flrt');
        slab(T, f, o.u0 - 0.14, o.u1 + 0.14, o.yh, o.yh + 0.26, 0, lk.headDepth + 0.04, lk.trim, 'fb');
        slab(T, f, o.u0 - 0.14, o.u0 - 0.02, o.ys, o.yh, 0, 0.05, lk.trim, 'fr'); slab(T, f, o.u1 + 0.02, o.u1 + 0.14, o.ys, o.yh, 0, 0.05, lk.trim, 'fl');
      }
    }
    if (ground && front && b.groundFloor === 1) { // the fascia over the shopfronts, and sometimes an awning
      slab(T, f, 0, len, y0 + sh - gfl.fascia, y0 + sh, 0, 0.1, lk.awnC, 'fbtlr');
      if (lk.r() < gfl.awning) {
        const A = soups.get(SOUP.awning), yb = y0 + sh - gfl.fascia;
        for (const o of ops) if (o.kind === 'shop') {
          const n = Math.max(2, Math.round((o.u1 - o.u0) / 0.2));
          quad(A, f.at(o.u0 - 0.1, yb - 0.55, 1.15), f.at(o.u1 + 0.1, yb - 0.55, 1.15), f.at(o.u1 + 0.1, yb, 0.1), f.at(o.u0 - 0.1, yb, 0.1), lk.awnC, [0, 0, n, 1]);
          const hint = [0, 0, 0]; facing(A, f.at(o.u0 - 0.1, yb - 0.55, 1.15), f.at(o.u0 - 0.1, yb, 0.1), f.at(o.u0 - 0.1, yb - 0.55, 0.1), lk.awnC, [-f.ex, 0, -f.ez]); void hint;
          facing(A, f.at(o.u1 + 0.1, yb - 0.55, 1.15), f.at(o.u1 + 0.1, yb, 0.1), f.at(o.u1 + 0.1, yb - 0.55, 0.1), lk.awnC, [f.ex, 0, f.ez]);
        }
      }
    }
    if (s > 0 && stone && lk.stringCourse && s === 1) slab(T, f, -ext0, len + ext1, y0 - 0.07, y0 + 0.07, 0, 0.05, lk.trim, 'fbt');
  }
  seq.edges++;
}

// ---- dormers and chimneys, once per building --------------------------------------------------------------------------
function dormers(soups, b, style, info, lk) {
  const dz = style.dormers, mansard = b.roofShape === 3, share = mansard ? dz.mansard : dz.gabled;
  if (!info || !info.slots || !share) return;
  const R = soups.get(b.roofColor ? ROOF_TINT_SOUP[b.roofMat] || ROOF_TINT_SOUP[0] : ROOF_SOUP[b.roofMat] || ROOF_SOUP[0]), T = soups.get(SOUP.trim), G = soups.get(SOUP.window);
  const roofTint = b.roofColor || null, step = mansard ? 1 : 2, rise = 0.4, d0 = -0.35;
  for (const sl of info.slots) {
    if (!(sl.slope > 0.2) || sl.len < 2.2 || lk.r() >= Math.min(1, share * (mansard ? 1 : 2))) continue;
    const by = bays(sl.len, style, b.id), f = frame(sl.ox, sl.oz, sl.ex, sl.ez), yb = sl.y + sl.slope * -d0, yt = yb + dz.height, dback = d0 - dz.height / sl.slope;
    if (d0 - dback > 2.5) continue;
    const dw = Math.min(dz.width, by.width * 0.62), hw = dw / 2, rd1 = d0 - (dz.height + rise) / sl.slope;
    for (let k = by.n > 2 ? lk.r.int(step) : 0; k < by.n; k += step) {
      const c = by.start + (k + 0.5) * by.width, u0 = c - hw, u1 = c + hw, ub = 0.1;
      // front: window set in a painted surround, and the gable above it
      rect(G, f, u0 + ub, u1 - ub, yb + 0.1, yt - 0.1, d0 - 0.04, null, [0, 0, 1, 1]);
      rect(T, f, u0, u0 + ub, yb, yt, d0, lk.trim); rect(T, f, u1 - ub, u1, yb, yt, d0, lk.trim); rect(T, f, u0 + ub, u1 - ub, yt - 0.1, yt, d0, lk.trim); rect(T, f, u0 + ub, u1 - ub, yb, yb + 0.1, d0, lk.trim);
      tri(T, f.at(u0, yt, d0), f.at(u1, yt, d0), f.at(c, yt + rise, d0), lk.trim);
      // cheeks and roof
      facing(T, f.at(u0, yb, d0), f.at(u0, yt, d0), f.at(u0, yt, dback), lk.trim, [-f.ex, 0, -f.ez]);
      facing(T, f.at(u1, yb, d0), f.at(u1, yt, d0), f.at(u1, yt, dback), lk.trim, [f.ex, 0, f.ez]);
      for (const [ue, sgn] of [[u0, -1], [u1, 1]]) {
        const h = [sgn * f.ex * 0.7, 0.7, sgn * f.ez * 0.7], A = f.at(ue, yt, d0), B = f.at(ue, yt, dback), C = f.at(c, yt + rise, rd1), D = f.at(c, yt + rise, d0);
        facing(R, A, B, C, roofTint, h); facing(R, A, C, D, roofTint, h);
      }
    }
  }
}
function chimneys(soups, b, style, info, lk) {
  const cm = style.chimneys, pts = (info && info.ridge) || [];
  if (!pts.length || !cm.perBuilding) return;
  const n = Math.min(pts.length, cm.perBuilding[0] + lk.r.int(cm.perBuilding[1] - cm.perBuilding[0] + 1)); if (n < 1) return;
  const o = obb(b.ring), brick = b.facade === 3 || !(b.facade >= 1 && b.facade <= 2), S = soups.get(brick ? 'brick|tv' : WALL_SOUP[b.facade]), T = soups.get(SOUP.trim), eave = b.yBase + b.hEave;
  const chosen = n >= pts.length ? pts : n === 1 ? [pts[lk.r.int(pts.length)]] : [pts[0], pts[pts.length - 1]].slice(0, n), tint = brick ? shade([0.42, 0.2, 0.15], 1) : b.tint;
  for (const p of chosen) {
    const top = p.y + cm.above;
    box(S, p.x, p.z, o.ux, o.uz, cm.width / 2, cm.depth / 2, eave - 0.2, top, tint, false);
    box(T, p.x, p.z, o.ux, o.uz, cm.width / 2 + 0.07, cm.depth / 2 + 0.07, top, top + 0.1, shade(lk.trim, 0.8), true);
  }
}

export function facadeNear(soups, b, groundAt, style, roofInfo) {
  const lk = look(b, style), seq = { edges: 0 };
  eachEdge(b, (e) => nearEdge(soups, b, e, groundAt, style, roofInfo, lk, seq));
  if (b.piece == null || b.piece === 0) { dormers(soups, b, style, roofInfo, lk); chimneys(soups, b, style, roofInfo, lk); }
}
