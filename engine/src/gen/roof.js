// Roofs: a building record into roof planes. Pure code. OWNED BY ITEM 4 of docs/plans/SCENE-DETAIL.md; the body below
// is item 4: every shape as real planes on any footprint (algorithms in the plan, item 4). The flat roof's inner parapet
// face goes to the wall soup (it is vertical: a roof plane always faces up), its coping to the roof soup.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   roof(soups, b, style) -> { slots, ridge, parapet }
//
//   soups   a soup set (soup.js createSoups). Write the roof into it and nothing else.
//   b       a decoded building (scene/source.js): ring, holes (flat [x, z, …], game metres, either winding), yBase,
//           hEave, hRoof (metres; the eave is at y = yBase + hEave, the top of the roof at yBase + hEave + hRoof),
//           roofShape (4.2 enum: 0 flat 1 gabled 2 hipped 3 mansard 4 pyramidal 5 skillion 6 dome 7 cone 8 gambrel),
//           roofDir (degrees clockwise from grid north, 0 to 179, the direction the ridge runs; 255 = along the long
//           axis of poly.js obb()), roofMat (4.2 enum), roofColor (linear [r, g, b] or null), tint (linear, the
//           wall colour, for gable walls), facade (4.2 enum), blind (Set of edge numbers), id.
//           The WHOLE building, never a piece of passage.js: a passage runs under the roof, not through it.
//   style   the resolved style (style.js). Roofs read nothing from it yet; it is there so they can.
//           Roof colours are written plain (b.roofColor as given): the old 1.6 lift for the zinc texture is gone.
//   returns slots   where dormers go: [{ ox, oz, ex, ez, len, y, slope, edge }]: origin on the eave line, unit
//                   vector along it (the outside is to the RIGHT of the vector turned as soup.js frame() does: the
//                   viewer stands at (-ez, ex)), length, eave height y, rise over run of the slope above it, the
//                   ring edge number. Empty when the roof takes none.
//           ridge   where chimneys go: [{ x, z, y }]. Empty for flat roofs.
//                   Additive: each slot also has `run` (horizontal run of its slope, eave to the top of that plane) and `hip`
//                   (1 when the ends of the roof slope at the same pitch, else 0), for the landmark dormer tiers.
//           top     only when the roof ends lower than hRoof says (a landmark's fallback hip): its height
//           planes  ONLY for a building with a `look`: the roof planes as convex 3-D polygons [[x, y, z], ...] (landmark seams, rolls).
//           parapet metres the outer wall rises above the eave (flat roofs with a parapet; else 0). The façade
//                   generators raise their wall by it.
//
//   Coordinates  game metres, y up, z south. Bearing d degrees is the direction (sin d, -cos d) in (x, z).
//   Winding      every triangle counter-clockwise seen from outside (soup.js computes the normal from it). A roof
//                plane faces up: normal y > 0.
//   Soups        ROOF_TINT_SOUP[b.roofMat] with b.roofColor as tint when the building has a colour, else
//                ROOF_SOUP[b.roofMat] (style.js). Gable walls and walls under a skillion: WALL_SOUP[b.facade] with
//                b.tint. Roof materials are triplanar: uv is not read.
//   Group        `base`: drawn at every distance, built once per chunk. No detail smaller than a roof plane here.
//   Budget       <= 120 000 triangles for all roofs of a scene; no allocation per frame (called once per building).
//   Must not     read the terrain, the DOM or three.js; throw on any ring (fall back to a flat cap instead).
import { cap, tri, fan, createSoups } from './soup.js';
import { ROOF_SOUP, ROOF_TINT_SOUP, WALL_SOUP } from './style.js';
import { signedArea, centroid, pointInRing, obb, clip, inset, triangulate, ringsCross } from './poly.js';

const PARAPET = 0.45, RAD = Math.PI / 180;
/** The bell-cast profile of a conical roof: [fraction of the height, share of the flare still out]; straight above the last. */
export const BELL = [[0, 1], [0.1, 0.3], [0.2, 0]];

/** A triangle that faces up whatever order it was given in. */
function upTri(s, a, b, c, tint) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint);
}
/** A triangle that faces down whatever order it was given in (the underside of an overhang). */
function downTri(s, a, b, c, tint) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny <= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint);
}
function isConvex(r) {
  let sign = 0; const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2, c = ((i + 2) % n) * 2, k = (r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]);
    if (Math.abs(k) < 1e-9) continue; if (!sign) sign = k > 0 ? 1 : -1; else if ((k > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}
/** Is hfn linear over a convex polygon (checked at the vertex mean and the edge midpoints)? */
function linearOn(p, hfn) {
  const n = p.length / 2; let mx = 0, mz = 0, mh = 0; const h = [];
  for (let i = 0; i < n; i++) { mx += p[i * 2]; mz += p[i * 2 + 1]; h.push(hfn(p[i * 2], p[i * 2 + 1])); mh += h[i]; }
  if (Math.abs(hfn(mx / n, mz / n) - mh / n) > 1e-6) return false;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (Math.abs(hfn((p[i * 2] + p[j * 2]) / 2, (p[i * 2 + 1] + p[j * 2 + 1]) / 2) - (h[i] + h[j]) / 2) > 1e-6) return false; }
  return true;
}
/** A footprint cut into convex pieces over each of which hfn is linear: cuts are lines [a, b, c] (a x + b z + c = 0). */
function pieces(ring, holes, cuts, hfn) {
  let list;
  if (!holes.length && isConvex(ring)) list = [ring];
  else { const all = ring.concat(...holes), t = triangulate(ring, holes); list = []; for (let i = 0; i < t.length; i += 3) list.push([all[t[i] * 2], all[t[i] * 2 + 1], all[t[i + 1] * 2], all[t[i + 1] * 2 + 1], all[t[i + 2] * 2], all[t[i + 2] * 2 + 1]]); }
  for (const [a, b, c] of cuts) {
    const next = [];
    for (const p of list) {
      if (linearOn(p, hfn)) { next.push(p); continue; }
      let lo = false, hi = false;
      for (let i = 0; i < p.length; i += 2) { const v = a * p[i] + b * p[i + 1] + c; if (v > 1e-9) hi = true; else if (v < -1e-9) lo = true; }
      if (hi && lo) { const A = clip(p, a, b, c), B = clip(p, -a, -b, -c); if (A.length && B.length) { next.push(A, B); continue; } }
      next.push(p);
    }
    list = next;
  }
  return list;
}
// the roof planes of a landmark (a building with a `look`), recorded as 3-D polygons for gen/landmark_roof.js; null otherwise
let PLANES = null;
const plane = (pts) => { if (PLANES) PLANES.push(pts); };
const liftPiece = (s, p, hfn, e, tint) => { const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], e + hfn(p[i], p[i + 1]), p[i + 1]]); plane(pts); for (let i = 1; i + 1 < pts.length; i++) upTri(s, pts[0], pts[i], pts[i + 1], tint); };

/** The wall between the eave and a roof profile, along each edge of a ring; flip for a hole (its wall faces into the hole). */
function profileWalls(ws, ring, flip, hfn, lines, e, tint) {
  const n = ring.length / 2, out = (signedArea(ring) > 0 ? 1 : -1) * (flip ? -1 : 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x0 = ring[i * 2], z0 = ring[i * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1], ts = [0, 1];
    const f = lines.map(([a, b, c]) => [a * x0 + b * z0 + c, a * x1 + b * z1 + c]);
    for (const [f0, f1] of f) if (f0 * f1 < 0) ts.push(f0 / (f0 - f1));
    ts.sort((p, q) => p - q);
    const seq = []; let top = 0;
    for (const t of ts) { if (seq.length && t - seq[seq.length - 1].t < 1e-6) continue; const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; let h = hfn(x, z); if (h < 1e-6) h = 0; top = Math.max(top, h); seq.push({ t, x, z, h }); }
    if (top < 1e-6) continue;
    if (out > 0) seq.reverse(); // viewer outside: the end of the edge is on his left when the ring runs counter-clockwise
    const poly = [[seq[0].x, e, seq[0].z], [seq[seq.length - 1].x, e, seq[seq.length - 1].z]];
    for (let k = seq.length - 1; k >= 0; k--) poly.push([seq[k].x, e + seq[k].h, seq[k].z]);
    fan(ws, poly, tint);
  }
}
/** A vertical band round a ring between two heights; faces out of the ring, or into it when `inward`. */
function band(ws, ring, y0, y1, inward, tint) {
  const out = (signedArea(ring) > 0 ? 1 : -1) * (inward ? -1 : 1), n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const A = [ring[j], ring[j + 1]], B = [ring[i], ring[i + 1]], [L, R] = out > 0 ? [B, A] : [A, B];
    const a = [L[0], y0, L[1]], b = [R[0], y0, R[1]], c = [R[0], y1, R[1]], d = [L[0], y1, L[1]];
    tri(ws, a, b, c, tint); tri(ws, a, c, d, tint);
  }
}
/** Quads between loop A at height yA and loop B (same vertex count, same order) at yB, facing up. */
function strip(s, A, yA, B, yB, tint) {
  const n = A.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = [A[i * 2], yA, A[i * 2 + 1]], b = [A[j * 2], yA, A[j * 2 + 1]], c = [B[j * 2], yB, B[j * 2 + 1]], d = [B[i * 2], yB, B[i * 2 + 1]];
    plane([a, b, c, d]); upTri(s, a, b, c, tint); upTri(s, a, c, d, tint);
  }
}
/** The ring and its holes moved in by d (holes grow); null when any of them fails. */
function insetSet(ring, holes, d) {
  const r = inset(ring, d); if (!r) return null;
  const hs = [];
  for (const h of holes) {
    const g = inset(h, -d);
    if (!g || ringsCross(g, r) || !pointInRing(g[0], g[1], r)) return null;
    for (const o of hs) if (ringsCross(g, o)) return null;
    hs.push(g);
  }
  return { ring: r, holes: hs };
}
/** Slots along the edges that `want(i, len)` accepts: the outside is to the right of the vector (-ez, ex) turned. */
function slotsOf(ring, e, slopeOf, want) {
  const n = ring.length / 2, fwd = signedArea(ring) > 0 ? -1 : 1, slots = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x0 = ring[i * 2], z0 = ring[i * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1], len = Math.hypot(x1 - x0, z1 - z0);
    const slope = len > 0 && want(i, len, x0, z0, x1, z1) ? slopeOf(i, x0, z0, x1, z1) : 0; if (!slope) continue;
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    slots.push(fwd > 0 ? { ox: x0, oz: z0, ex: dx, ez: dz, len, y: e, slope, edge: i } : { ox: x1, oz: z1, ex: -dx, ez: -dz, len, y: e, slope, edge: i });
  }
  return slots;
}

export function roof(soups, b, style) {
  const tmp = createSoups();
  let info;
  try { info = build(tmp, b, style); } catch (err) { // never throw: a flat cap, counted in roof.failures (a scene-wide test keeps it at 0)
    roof.failures++; roof.lastError = err;
    const t = createSoups(); t.get(soupKey(b)); info = { slots: [], ridge: [], parapet: 0 };
    const s = t.get(soupKey(b)); cap(s, b.ring, b.holes || [], b.yBase + b.hEave, b.roofColor); soups.add(t); return info;
  }
  soups.add(tmp);
  return info;
}
roof.failures = 0;
const soupKey = (b) => { const tab = b.roofColor ? ROOF_TINT_SOUP : ROOF_SOUP; return tab[b.roofMat] || tab[1]; };

function build(soups, b, style) {
  const tint = b.roofColor || null, s = soups.get(soupKey(b)), ws = soups.get(WALL_SOUP[b.facade] || WALL_SOUP[1]), wtint = b.tint || null;
  const e = b.yBase + b.hEave, H = b.hRoof, ring = b.ring, holes = b.holes || [], info = { slots: [], ridge: [], parapet: 0 };
  PLANES = b.look ? (info.planes = []) : null;
  const shape = H >= 0.2 ? b.roofShape : 0;
  const flat = () => {
    const inn = holes.length ? null : inset(ring, 0.3);
    if (!inn) { cap(s, ring, holes, e, tint); return info; }
    cap(s, inn, [], e, tint); strip(s, ring, e + PARAPET, inn, e + PARAPET, tint); band(ws, inn, e, e + PARAPET, true, wtint);
    info.parapet = PARAPET; return info;
  };
  const top = e + H;
  const hippedIrregular = () => {
    // a landmark whose footprint no steep hip fits (the inset fails) gets a lower, steeper hip rather than a flat lid: `info.top` says where it ends
    const tries = [[H, H], [H / 2, H], [H / 4, H]]; if (b.look) for (const d of [3, 2.5, 2, 1.5, 1, 0.5]) tries.push([d, Math.min(H, d * 3.2)]);
    for (const [d, h] of tries) {
      const set = insetSet(ring, holes, d); if (!set) continue;
      const ty = e + h; if (h < H) info.top = ty;
      strip(s, ring, e, set.ring, ty, tint); holes.forEach((hh, k) => strip(s, hh, e, set.holes[k], ty, tint));
      cap(s, set.ring, set.holes, ty, tint);
      const [cx, cz] = centroid(set.ring); if (pointInRing(cx, cz, set.ring)) info.ridge.push({ x: cx, z: cz, y: ty });
      return info;
    }
    return flat();
  };
  if (shape === 0 || ring.length < 6 || Math.abs(signedArea(ring)) < 1) return flat();
  const ob = obb(ring), ax = b.roofDir >= 0 && b.roofDir <= 179 ? [Math.sin(b.roofDir * RAD), -Math.cos(b.roofDir * RAD)] : [ob.ux, ob.uz];

  if (shape === 1 || shape === 8 || shape === 5) { // gabled, gambrel, skillion: a ridge axis and the distance from the centre line
    const [ux, uz] = ax, nx = -uz, nz = ux; let smin = Infinity, smax = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { const v = ring[i] * nx + ring[i + 1] * nz; smin = Math.min(smin, v); smax = Math.max(smax, v); }
    const sc = (smin + smax) / 2, W = (smax - smin) / 2; if (W < 0.3) return flat();
    const sf = (x, z) => x * nx + z * nz - sc;
    let hfn, lines;
    if (shape === 1) { hfn = (x, z) => H * (1 - Math.abs(sf(x, z)) / W); lines = [[nx, nz, -sc]]; }
    else if (shape === 8) {
      hfn = (x, z) => { const a = Math.abs(sf(x, z)); return a >= 0.6 * W ? (0.6 * H * (W - a)) / (0.4 * W) : 0.6 * H + (0.4 * H * (0.6 * W - a)) / (0.6 * W); };
      lines = [[nx, nz, -sc], [nx, nz, -sc - 0.6 * W], [nx, nz, -sc + 0.6 * W]];
    } else { hfn = (x, z) => (H * (sf(x, z) + W)) / (2 * W); lines = []; }
    for (const p of pieces(ring, holes, lines, hfn)) liftPiece(s, p, hfn, e, tint);
    profileWalls(ws, ring, false, hfn, lines, e, wtint); for (const h of holes) profileWalls(ws, h, true, hfn, lines, e, wtint);
    if (shape === 5) return info; // one plane: no ridge, no slot
    // ridge ends: where the centre line leaves the ring, pulled in 0.8 m
    let t0 = Infinity, t1 = -Infinity; const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, f0 = ring[i * 2] * nx + ring[i * 2 + 1] * nz - sc, f1 = ring[j * 2] * nx + ring[j * 2 + 1] * nz - sc;
      if (f0 * f1 > 0 || f0 === f1) continue; const k = f0 / (f0 - f1), t = (ring[i * 2] + (ring[j * 2] - ring[i * 2]) * k) * ux + (ring[i * 2 + 1] + (ring[j * 2 + 1] - ring[i * 2 + 1]) * k) * uz;
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    if (t1 > t0) {
      const pt = (t) => ({ x: nx * sc + ux * t, z: nz * sc + uz * t, y: top });
      if (t1 - t0 > 1.6) info.ridge.push(pt(t0 + 0.8), pt(t1 - 0.8)); else info.ridge.push(pt((t0 + t1) / 2));
    }
    const slope = shape === 1 ? H / W : (0.6 * H) / (0.4 * W);
    info.slots = slotsOf(ring, e, () => slope, (i, len, x0, z0, x1, z1) => len >= 1.5 && Math.abs(((x1 - x0) * ux + (z1 - z0) * uz) / len) >= Math.cos(12 * RAD) && Math.abs(sf(x0, z0)) >= W - 0.3 && Math.abs(sf(x1, z1)) >= W - 0.3);
    for (const sl of info.slots) { sl.run = shape === 1 ? W : 0.4 * W; sl.hip = 0; }
    return info;
  }

  if (shape === 2) {
    if (ob.fill >= 0.82 && !holes.length && ob.W >= 0.3) {
      const { cx, cz, ux, uz, L, W } = ob, nx = -uz, nz = ux;
      const sf = (x, z) => (x - cx) * nx + (z - cz) * nz, tf = (x, z) => (x - cx) * ux + (z - cz) * uz;
      const hfn = (x, z) => (H * Math.max(0, Math.min(W - Math.abs(sf(x, z)), L - Math.abs(tf(x, z))))) / W;
      const lines = [[nx, nz, -(cx * nx + cz * nz)], [ux, uz, -(cx * ux + cz * uz)]];
      for (const ss of [1, -1]) for (const st of [1, -1]) { const a = st * ux - ss * nx, c = st * uz - ss * nz; lines.push([a, c, -(cx * a + cz * c) - (L - W)]); }
      for (const p of pieces(ring, holes, lines, hfn)) liftPiece(s, p, hfn, e, tint);
      profileWalls(ws, ring, false, hfn, lines, e, wtint);
      if (L - W > 0.3) info.ridge.push({ x: cx + ux * (L - W), z: cz + uz * (L - W), y: top }, { x: cx - ux * (L - W), z: cz - uz * (L - W), y: top }); else info.ridge.push({ x: cx, z: cz, y: top });
      info.slots = slotsOf(ring, e, () => H / W, (i, len, x0, z0, x1, z1) => len >= 1.5 && Math.abs(((x1 - x0) * ux + (z1 - z0) * uz) / len) >= Math.cos(12 * RAD) && Math.abs(sf(x0, z0)) >= W - 0.3 && Math.abs(sf(x1, z1)) >= W - 0.3);
      for (const sl of info.slots) { sl.run = W; sl.hip = 1; }
      return info;
    }
    return hippedIrregular();
  }

  if (shape === 3) {
    let a = Math.min(1.2, 0.3 * H), s1 = null;
    for (let k = 0; k < 3 && !s1; k++, a /= 2) s1 = insetSet(ring, holes, a);
    if (!s1) return flat(); a *= 2;
    const y1 = e + 0.8 * H; strip(s, ring, e, s1.ring, y1, tint); holes.forEach((h, k) => strip(s, h, e, s1.holes[k], y1, tint));
    let bb = Math.min(3, 0.25 * ob.W), s2 = null;
    for (let k = 0; k < 3 && !s2; k++, bb /= 2) s2 = insetSet(s1.ring, s1.holes, bb);
    let deck = s1, yd = y1;
    if (s2) { strip(s, s1.ring, y1, s2.ring, top, tint); s1.holes.forEach((h, k) => strip(s, h, y1, s2.holes[k], top, tint)); deck = s2; yd = top; }
    cap(s, deck.ring, deck.holes, yd, tint);
    const nv = deck.ring.length / 2; for (let i = 0; i < nv && i < 8; i++) info.ridge.push({ x: deck.ring[i * 2], z: deck.ring[i * 2 + 1], y: yd });
    info.slots = slotsOf(ring, e, () => (0.8 * H) / a, (i, len) => len >= 2.5 && !(b.blind && b.blind.has(i)));
    for (const sl of info.slots) { sl.run = a; sl.hip = 1; }
    return info;
  }

  if (shape === 4 || shape === 7) {
    const [cx, cz] = centroid(ring), sa = signedArea(ring), n = ring.length / 2;
    let ok = !holes.length && pointInRing(cx, cz, ring);
    for (let i = 0; i < n && ok; i++) { const j = (i + 1) % n; if (((ring[i * 2] - cx) * (ring[j * 2 + 1] - cz) - (ring[i * 2 + 1] - cz) * (ring[j * 2] - cx)) * sa <= 0) ok = false; }
    if (!ok) return hippedIrregular();
    const lk = b.look && style && style.looks && style.looks[b.look], bell = shape === 7 && lk && lk.turret && lk.turret.bellcast > 0 ? lk.turret.bellcast : 0;
    let first = ring, y0 = e;
    if (bell) { // bell-cast: the lowest fifth flares out to an eave `bell` m past the wall, three rings on a concave profile
      let rm = 0; for (let i = 0; i < n; i++) rm += Math.hypot(ring[i * 2] - cx, ring[i * 2 + 1] - cz); rm /= n;
      const rings = BELL.map(([t, k]) => { const sc = 1 - t + (bell * k) / rm, o = []; for (let i = 0; i < n; i++) o.push(cx + (ring[i * 2] - cx) * sc, cz + (ring[i * 2 + 1] - cz) * sc); return { o, y: e + H * t }; });
      for (let k = 0; k + 1 < rings.length; k++) strip(s, rings[k].o, rings[k].y, rings[k + 1].o, rings[k + 1].y, tint);
      const soffit = soups.get(WALL_SOUP[b.facade] || WALL_SOUP[1]); // the underside of the flared eave, in the wall's own soup
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, o = rings[0].o; const a = [ring[i * 2], e, ring[i * 2 + 1]], c = [ring[j * 2], e, ring[j * 2 + 1]], d = [o[j * 2], e, o[j * 2 + 1]], f = [o[i * 2], e, o[i * 2 + 1]]; downTri(soffit, a, f, d, wtint); downTri(soffit, a, d, c, wtint); }
      first = rings[rings.length - 1].o; y0 = rings[rings.length - 1].y;
    }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, A = [first[i * 2], y0, first[i * 2 + 1]], B = [first[j * 2], y0, first[j * 2 + 1]], C = [cx, top, cz]; plane([A, B, C]); upTri(s, A, B, C, tint); }
    info.ridge.push({ x: cx, z: cz, y: top });
    return info;
  }

  if (shape === 6) {
    if (holes.length) return hippedIrregular();
    const [cx, cz] = centroid(ring), ringAt = (k) => { const c = Math.cos((k * Math.PI) / 10), o = []; for (let i = 0; i < ring.length; i += 2) o.push(cx + (ring[i] - cx) * c, cz + (ring[i + 1] - cz) * c); return o; };
    const hy = (k) => e + H * Math.sin((k * Math.PI) / 10);
    for (let k = 0; k < 4; k++) strip(s, ringAt(k), hy(k), ringAt(k + 1), hy(k + 1), tint);
    const r4 = ringAt(4), n = r4.length / 2;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; upTri(s, [r4[i * 2], hy(4), r4[i * 2 + 1]], [r4[j * 2], hy(4), r4[j * 2 + 1]], [cx, top, cz], tint); }
    info.ridge.push({ x: cx, z: cz, y: top });
    return info;
  }
  return flat();
}
