// Landmark roofs and crowns: what a `look` of the style adds above the eave of a named building. Pure code; no place is
// named here, everything is a key of the look (documented in docs/SCENE-FORMAT.md, style.looks):
//
//   roof     { seams, battens, ridgeDark, streaks }   standing-seam copper: a 0.05 m roll up every roof plane each `seams` metres
//                                                     (at most SEAM_CAP a building), a roll along every ridge and hip, a darker
//                                                     band `ridgeDark` (0..1) 0.6 m wide beside every ridge, hip and valley, and
//                                                     seeded pale streaks (a share `streaks` of the seam bays) down the planes
//   dormers  { tiers, spacing, width, height, gable, finial }   rows of tall dormers on every roof plane longer than 6 m of slope
//   stacks   { count: [lo, hi], height, width, depth, capColor }   tall brick chimney stacks with stone caps and pots, on the ridge
//   turret   { bellcast, finial, eaveBand }           round-tower cones flare out at the eave (roof.js), carry a finial with a ball,
//                                                     and a band of small windows under the eave
//   crown    { corbel, parapetTurrets, cresting, above }   the tall part: heavy three-course corbelling under the roof, small round
//                                                     corner turrets (bartizans) with their own bell-cast cones; only on a building
//                                                     whose top is `above` m over its ground (default 0)
//
// The roof planes come from roof.js (`info.planes`, `info.slots[].run`, `.hip`, `info.ridge`). Everything is seeded from the
// building's id: the same record gives the same triangles.
import { quad, tri, frame, rect, box, prism, rng, shade, mixTint } from './soup.js';
import { SOUP, ROOF_TINT_SOUP, WALL_SOUP } from './style.js';
import { obb } from './poly.js';
import { BELL } from './roof.js';

export const SEAM_CAP = 2500, STREAK_CAP = 1500;
const IRON = [0.03, 0.033, 0.036], COPPER = [0.16, 0.34, 0.27];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const roofSoup = (soups, b) => soups.get(ROOF_TINT_SOUP[b.roofMat] || ROOF_TINT_SOUP[0]);
const roofBase = (b) => b.roofColor || COPPER;

/** A triangle / quad turned so its normal points to the side of `hint`. */
function facingTri(s, a, b, c, tint, hint) {
  const n = cross(sub(b, a), sub(c, a));
  if (dot(n, hint) >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint);
}
const facingQuad = (s, a, b, c, d, tint, hint) => { facingTri(s, a, b, c, tint, hint); facingTri(s, a, c, d, tint, hint); };
/** A triangle facing away from `centre` (a ball, a lathed turret). */
function outTri(s, a, b, c, tint, centre) {
  const m = mul(add(add(a, b), c), 1 / 3); facingTri(s, a, b, c, tint, sub(m, centre));
}
/** A small ball: 6 sides, two rings and two poles (24 triangles). */
export function ball(s, x, y, z, r, tint) {
  const c = [x, y, z], ring = (lat) => { const o = []; for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; o.push([x + Math.cos(a) * r * Math.cos(lat), y + r * Math.sin(lat), z + Math.sin(a) * r * Math.cos(lat)]); } return o; };
  const lo = ring(-0.6), hi = ring(0.6), bot = [x, y - r, z], top = [x, y + r, z];
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    outTri(s, bot, lo[k], lo[j], tint, c); outTri(s, lo[k], hi[k], hi[j], tint, c); outTri(s, lo[k], hi[j], lo[j], tint, c); outTri(s, top, hi[j], hi[k], tint, c);
  }
}

// ---- standing seams, rolls, ridge bands, streaks ---------------------------------------------------------------------
/** Normal (up), up-slope direction u and across direction h of a roof plane (u x h = n), or null for a flat or vertical one. */
function basisOf(P) {
  let nx = 0, ny = 0, nz = 0; const n = P.length;
  for (let i = 0; i < n; i++) { const a = P[i], c = P[(i + 1) % n]; nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]); }
  const l = Math.hypot(nx, ny, nz); if (l < 1e-6) return null;
  let N = [nx / l, ny / l, nz / l]; if (N[1] < 0) N = mul(N, -1);
  const hl = Math.hypot(N[0], N[2]); if (N[1] > 0.985 || N[1] < 0.1 || hl < 1e-6) return null;
  let h = [-N[2] / hl, 0, N[0] / hl], u = cross(N, h); if (u[1] < 0) u = mul(u, -1);
  if (dot(cross(u, h), N) < 0) h = mul(h, -1);
  return { n: N, u, h };
}
/** Where the line p.h = s crosses a convex polygon: [pointLow, pointHigh] along u, or null. */
function crossing(P, h, u, s) {
  let lo = null, hi = null, lt = Infinity, ht = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length], sa = dot(a, h) - s, sc = dot(c, h) - s;
    if (sa === sc || sa * sc > 0) continue;
    const t = sa / (sa - sc), q = add(a, mul(sub(c, a), t)), k = dot(q, u);
    if (k < lt) { lt = k; lo = q; } if (k > ht) { ht = k; hi = q; }
  }
  return lo && hi ? [lo, hi] : null;
}
const keyOf = (a, c) => { const f = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`, x = f(a), y = f(c); return x < y ? x + '|' + y : y + '|' + x; };

/**
 * Seams, rolls, bands and streaks on the roof planes of `info`. Returns { seams, streaks } counts (the strips drawn).
 * `seamSpacing` is the spacing actually used (wider than asked when the cap bites).
 */
export function roofSeams(soups, b, look, info) {
  const rk = look.roof, planes = (info && info.planes) || [], res = { seams: 0, streaks: 0, spacing: 0 };
  if (!rk || !planes.length) return res;
  const S = roofSoup(soups, b), base = roofBase(b), eave = b.yBase + b.hEave, r = rng((b.id ^ 0x5bd1e995) >>> 0);
  const bs = planes.map((P) => { const q = basisOf(P); if (!q) return null; let lo = Infinity, hi = -Infinity; for (const p of P) { const v = dot(p, q.h); lo = Math.min(lo, v); hi = Math.max(hi, v); } return { ...q, lo, hi, P }; });
  const want = rk.seams > 0 ? rk.seams : 0, hw = 0.025, hh = 0.035, lift = 0.006;
  let spacing = want;
  if (want) { let total = 0; for (const q of bs) if (q) total += Math.max(0, Math.floor((q.hi - q.lo) / want)); if (total > SEAM_CAP) spacing = want * (total / SEAM_CAP) * 1.02; }
  res.spacing = spacing;
  const battenC = shade(base, 1.45), streakBase = mixTint(base, [0.62, 0.72, 0.66], 0.4);
  if (want && rk.battens !== false) {
    outer: for (const q of bs) {
      if (!q) continue;
      const k0 = Math.floor((q.hi - q.lo) / spacing), off = (q.hi - q.lo - (k0 - 1) * spacing) / 2;
      for (let k = 0; k < k0; k++) {
        if (res.seams >= SEAM_CAP) break outer;
        const s = q.lo + off + k * spacing, x = crossing(q.P, q.h, q.u, s); if (!x) continue;
        const A = add(x[0], mul(q.u, 0.25)), B = add(x[1], mul(q.u, -0.25)); if (dot(sub(B, A), q.u) < 0.4) continue;
        const o = mul(q.n, lift), top = add(mul(q.n, hh), o), L = mul(q.h, -hw), Rr = mul(q.h, hw), tint = shade(battenC, 0.92 + 0.16 * r());
        const Al = add(add(A, L), o), Bl = add(add(B, L), o), Ar = add(add(A, Rr), o), Br = add(add(B, Rr), o), At = add(A, top), Bt = add(B, top);
        quad(S, Al, Bl, Bt, At, tint); quad(S, Ar, At, Bt, Br, tint);
        res.seams++;
      }
    }
  }
  // pale streaks: a share of the seam bays gets a chalky strip from the top of the plane part of the way down
  if (rk.streaks > 0 && spacing) {
    outer2: for (const q of bs) {
      if (!q) continue;
      const k0 = Math.floor((q.hi - q.lo) / spacing);
      for (let k = 0; k < k0; k++) {
        if (r() >= rk.streaks) continue;
        if (res.streaks >= STREAK_CAP) break outer2;
        const sc = q.lo + (k + 0.5) * spacing + (r() - 0.5) * spacing * 0.3, w = spacing * (0.12 + 0.2 * r()), xa = crossing(q.P, q.h, q.u, sc - w), xb = crossing(q.P, q.h, q.u, sc + w);
        if (!xa || !xb) continue;
        const tHi = Math.min(dot(xa[1], q.u), dot(xb[1], q.u)) - 0.3, tLo = Math.max(dot(xa[0], q.u), dot(xb[0], q.u)) + 0.3, len = tHi - tLo; if (len < 0.8) continue;
        const t1 = tHi, t0 = tHi - len * (0.35 + 0.55 * r()), o = mul(q.n, 0.014);
        const at = (xs, t) => add(add(xs[0], mul(q.u, t - dot(xs[0], q.u))), o);
        const tint = shade(streakBase, 0.85 + 0.3 * r());
        quad(S, at(xa, t0), at(xb, t0), at(xb, t1), at(xa, t1), tint);
        res.streaks++;
      }
    }
  }
  // rolls and darker bands along every ridge, hip and valley (an edge of a plane above the eave line)
  const edges = new Map();
  bs.forEach((q) => {
    if (!q) return;
    const n = q.P.length, c = mul(q.P.reduce((m, p) => add(m, p), [0, 0, 0]), 1 / n);
    for (let i = 0; i < n; i++) {
      const a = q.P[i], d = q.P[(i + 1) % n]; if (a[1] < eave + 0.06 && d[1] < eave + 0.06) continue;
      const len = Math.hypot(...sub(d, a)); if (len < 0.3) continue;
      let din = unit(cross(q.n, sub(d, a))); if (dot(din, sub(c, a)) < 0) din = mul(din, -1);
      const key = keyOf(a, d); let e = edges.get(key); if (!e) edges.set(key, (e = { a, d, sides: [] })); e.sides.push({ n: q.n, din });
    }
  });
  const dark = shade(base, 1 - (rk.ridgeDark ?? 0.25)), rollC = shade(base, 1.12);
  for (const e of edges.values()) {
    const { a, d } = e;
    for (const sd of e.sides) {
      if (rk.ridgeDark > 0) { const o = mul(sd.n, 0.011), a2 = add(add(a, mul(sd.din, 0.6)), o), d2 = add(add(d, mul(sd.din, 0.6)), o); facingQuad(S, add(a, o), add(d, o), d2, a2, dark, sd.n); }
    }
    if (e.sides.length === 2 && dot(e.sides[0].n, e.sides[1].n) < 0.995) {
      const n0 = unit(add(e.sides[0].n, e.sides[1].n)), ap = mul(n0, 0.1);
      for (const sd of e.sides) {
        const fa = add(a, mul(sd.din, 0.07)), fd = add(d, mul(sd.din, 0.07)), pa = add(a, ap), pd = add(d, ap);
        facingQuad(S, fa, fd, pd, pa, rollC, add(mul(n0, 0.7), mul(sd.din, 0.7)));
      }
    }
  }
  return res;
}

// ---- stacks ----------------------------------------------------------------------------------------------------------
/** Tall brick stacks on the ridge points: a stone cap, a stepped shoulder and two or three pots; returns the stacks [{ x, z, y, top }]. */
export function stacks(soups, b, look, info, style) {
  const sk = look.stacks, ridge = (info && info.ridge) || [], out = [];
  if (!sk || !ridge.length) return out;
  const r = rng((b.id ^ 0x2545f491) >>> 0), [lo, hi] = sk.count || [2, 4], want = lo + r.int(hi - lo + 1);
  const brick = soups.get('wall_brick|tv'), P = brick; // one soup less to draw: the cap is brick-textured, tinted stone grey
  const tint = b.tint ? shade(b.tint, 0.82) : [0.42, 0.2, 0.15], cap = (sk.capColor && parseHex(sk.capColor)) || [0.55, 0.53, 0.5], w = sk.width || 1.2, dp = sk.depth || 0.8, H = sk.height || 3;
  let pts, ux = 1, uz = 0;
  if (ridge.length === 2 && Math.abs(ridge[0].y - ridge[1].y) < 0.05) {
    const [p, q] = ridge, l = Math.hypot(q.x - p.x, q.z - p.z); if (l < 2) return out;
    ux = (q.x - p.x) / l; uz = (q.z - p.z) / l;
    const n = Math.max(1, Math.min(want, Math.floor(l / (w * 3.2)) + 1)); pts = [];
    for (let k = 0; k < n; k++) { const t = n === 1 ? 0.5 : 0.04 + (0.92 * k) / (n - 1); pts.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: p.y }); }
  } else if (ridge.length > 2) {
    const o = obb(b.ring); ux = o.ux; uz = o.uz; pts = ridge.slice(0, Math.min(want, ridge.length));
  } else return out;
  for (const p of pts) {
    const y0 = p.y - 0.9, yt = p.y + H;
    box(brick, p.x, p.z, ux, uz, w / 2, dp / 2, y0, yt, tint, false);
    box(brick, p.x, p.z, ux, uz, w / 2 + 0.07, dp / 2 + 0.07, yt - 0.55, yt - 0.3, shade(tint, 1.05), true); // the shoulder
    box(P, p.x, p.z, ux, uz, w / 2 + 0.15, dp / 2 + 0.15, yt, yt + 0.22, cap, true);
    const pots = 2 + (r.int(2)); // two or three pots
    for (let k = 0; k < pots; k++) {
      const c = (k - (pots - 1) / 2) * (w / pots), cx = p.x + ux * c, cz = p.z + uz * c, rr = 0.15, ring = [];
      for (let a = 0; a < 6; a++) { const an = (a / 6) * Math.PI * 2; ring.push(cx + Math.cos(an) * rr, cz + Math.sin(an) * rr); }
      prism(brick, ring, yt + 0.22, yt + 0.22 + 0.55 + 0.1 * r(), [0.5, 0.22, 0.14], true);
    }
    out.push({ x: p.x, z: p.z, y: p.y, top: yt });
  }
  return out;
}
function parseHex(v) { const m = /^#([0-9a-f]{6})$/i.exec(v); if (!m) return null; const n = parseInt(m[1], 16), f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]; }

// ---- dormer tiers ----------------------------------------------------------------------------------------------------
/**
 * Dormer slots from the roof planes themselves: every plane with a horizontal edge at the eave gives one
 * { ox, oz, ex, ez, len, y, slope, run, range(r) }, the same frame as roof.js slots; range(r) is the stretch of the plane
 * (u along the eave) that exists `r` m up the slope, so a hip or a cut corner narrows it. Irregular roofs have planes but no slots.
 */
export function planeSlots(planes, eave) {
  const out = [];
  for (const P of planes || []) {
    const q = basisOf(P); if (!q) continue;
    const hl = Math.hypot(q.n[0], q.n[2]), slope = hl / q.n[1], dh = [q.n[0] / hl, 0, q.n[2] / hl];
    let best = null;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length]; if (Math.abs(a[1] - eave) > 0.08 || Math.abs(c[1] - eave) > 0.08) continue;
      const l = Math.hypot(c[0] - a[0], c[2] - a[2]); if (!best || l > best.l) best = { a, c, l };
    }
    if (!best || best.l < 2.2) continue;
    const ex = dh[2], ez = -dh[0], A = best.a[0] * ex + best.a[2] * ez <= best.c[0] * ex + best.c[2] * ez ? best.a : best.c;
    const uv = P.map((p) => [(p[0] - A[0]) * ex + (p[2] - A[2]) * ez, -((p[0] - A[0]) * dh[0] + (p[2] - A[2]) * dh[2])]);
    const run = Math.max(...uv.map((p) => p[1])), len = best.l;
    const range = (r) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < uv.length; i++) { const a = uv[i], c = uv[(i + 1) % uv.length]; if (a[1] === c[1] || (a[1] - r) * (c[1] - r) > 0) continue; const u = a[0] + ((c[0] - a[0]) * (r - a[1])) / (c[1] - a[1]); lo = Math.min(lo, u); hi = Math.max(hi, u); } return [lo, hi]; };
    out.push({ ox: A[0], oz: A[2], ex, ez, len, y: eave, slope, run, range });
  }
  return out;
}

/** Rows of tall dormers on every roof plane with an eave edge and more than 6 m of slope. Returns the dormer boxes [{ slot, sl, tier, u0, u1, r0, r1 }]. */
export function dormerTiers(soups, b, look, info, stone) {
  const dz = look.dormers, out = [];
  if (!dz || !(dz.tiers > 0) || !info) return out;
  const R = roofSoup(soups, b), T = soups.get(SOUP.trim), G = soups.get(SOUP.window), I = soups.get(SOUP.iron), tint = b.roofColor || null;
  const tiers = Math.min(3, dz.tiers | 0), w = dz.width || 1.3, h = dz.height || 2.2, spacing = Math.max(w + 0.6, dz.spacing || 3.2), rise = dz.gable === 'steep' ? w * 1.15 : w * 0.6, hw = w / 2, ub = 0.15;
  const slots = planeSlots(info.planes, b.yBase + b.hEave);
  slots.forEach((sl, si) => {
    const run = sl.run, sp = sl.slope; if (!(sp > 0.2) || run * Math.hypot(1, sp) <= 6) return;
    const rmin = 0.7, avail = run - 0.5 - (h + rise) / sp - rmin; if (avail < 0) return;
    const f = frame(sl.ox, sl.oz, sl.ex, sl.ez);
    for (let t = 0; t < tiers; t++) {
      const r0 = tiers > 1 ? rmin + (avail * t) / (tiers - 1) : rmin, r1 = r0 + (h + rise) / sp;
      const ra = sl.range(r0), rb = sl.range(r1), lo = Math.max(0, ra[0], rb[0]) + 0.25 + hw, hi = Math.min(sl.len, ra[1], rb[1]) - 0.25 - hw;
      const yb = sl.y + sp * r0, yt = yb + h, d0 = -r0, dback = -r1;
      for (let c = lo + (t % 2) * (spacing / 2); c <= hi + 1e-6; c += spacing) {
        const u0 = c - hw, u1 = c + hw;
        rect(G, f, u0 + ub, u1 - ub, yb + 0.25, yt - 0.3, d0 - 0.04, null, [0, 0, 1, 1]);
        rect(T, f, u0, u0 + ub, yb, yt, d0, stone); rect(T, f, u1 - ub, u1, yb, yt, d0, stone);
        rect(T, f, u0 + ub, u1 - ub, yt - 0.3, yt, d0, stone); rect(T, f, u0 + ub, u1 - ub, yb, yb + 0.25, d0, stone);
        tri(T, f.at(u0, yt, d0), f.at(u1, yt, d0), f.at(c, yt + rise, d0), stone);
        facingTri(T, f.at(u0, yb, d0), f.at(u0, yt, d0), f.at(u0, yt, dback), stone, [-f.ex, 0, -f.ez]);
        facingTri(T, f.at(u1, yb, d0), f.at(u1, yt, d0), f.at(u1, yt, dback), stone, [f.ex, 0, f.ez]);
        for (const [ue, sgn] of [[u0, -1], [u1, 1]]) {
          const hint = [sgn * f.ex * 0.7, 0.7, sgn * f.ez * 0.7];
          facingQuad(R, f.at(ue, yt, d0), f.at(ue, yt, dback), f.at(c, yt + rise, dback), f.at(c, yt + rise, d0), tint, hint);
        }
        if (dz.finial) { const q = f.at(c, 0, d0 + 0.04); box(I, q[0], q[2], f.ex, f.ez, 0.035, 0.035, yt + rise - 0.1, yt + rise + 0.85, IRON, true); ball(I, q[0], yt + rise + 0.92, q[2], 0.1, IRON); }
        out.push({ slot: si, sl, tier: t, u0, u1, r0, r1 });
      }
    }
  });
  return out;
}

// ---- bell-cast cones, bartizans, the crown -----------------------------------------------------------------------------
/** A conical roof on a regular ring with a bell-cast eave (rings of BELL), about (cx, cz) at y0; the rings it makes [{ y, r }], low to high. */
export function bellCone(s, cx, cz, r, y0, H, bell, tint, sides = 8) {
  const rings = BELL.map(([t, k]) => ({ y: y0 + H * t, r: r * (1 - t) + bell * k }));
  const pt = (rg, i) => { const a = (i / sides) * Math.PI * 2; return [cx + Math.cos(a) * rg.r, rg.y, cz + Math.sin(a) * rg.r]; }, apex = [cx, y0 + H, cz], c = [cx, y0 + H * 0.4, cz];
  for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; outTri(s, pt(rings[k], i), pt(rings[k], j), pt(rings[k + 1], j), tint, c); outTri(s, pt(rings[k], i), pt(rings[k + 1], j), pt(rings[k + 1], i), tint, c); }
  const last = rings[rings.length - 1]; for (let i = 0; i < sides; i++) outTri(s, pt(last, i), pt(last, (i + 1) % sides), apex, tint, c);
  return [...rings, { y: y0 + H, r: 0 }];
}
/** The corner turrets of a tall part: a round stone body on a stepped base, a bell-cast copper cone, a finial. Returns the centres [[x, z]]. */
export function bartizans(soups, b, look) {
  const cr = look.crown, out = [];
  if (!cr || !(cr.parapetTurrets > 0) || b.ring.length < 8 || !hasCrown(b, look)) return out;
  const o = obb(b.ring), nx = -o.uz, nz = o.ux, eave = b.yBase + b.hEave, R = 0.95, bell = (look.turret && look.turret.bellcast) || 0.3;
  const W = soups.get(WALL_SOUP[b.facade] || WALL_SOUP[3]), C = roofSoup(soups, b), I = soups.get(SOUP.iron), tint = b.roofColor || null;
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].slice(0, Math.min(4, cr.parapetTurrets));
  for (const [sl, sw] of corners) {
    const dx = o.ux * sl + nx * sw, dz = o.uz * sl + nz * sw, dl = Math.hypot(dx, dz), x = o.cx + o.ux * o.L * sl + nx * o.W * sw + (dx / dl) * 0.3, z = o.cz + o.uz * o.L * sl + nz * o.W * sw + (dz / dl) * 0.3;
    const ring = (rr) => { const q = []; for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * Math.PI * 2; q.push(x + Math.cos(a) * rr, z + Math.sin(a) * rr); } return q; };
    prism(W, ring(R), eave - 0.9, eave + 2.3, b.tint || null, false);
    // the stepped base, narrowing downwards in three rings
    for (let k = 0; k < 3; k++) prism(W, ring(R * (0.78 - 0.17 * k)), eave - 0.9 - 0.4 * (k + 1), eave - 0.9 - 0.4 * k, shade(b.tint || [0.5, 0.4, 0.3], 0.9), false);
    prism(W, ring(R + 0.1), eave + 2.1, eave + 2.3, shade(b.tint || [0.5, 0.4, 0.3], 1.1), true);
    bellCone(C, x, z, R + 0.1, eave + 2.3, 3.4, bell, tint, 8);
    box(I, x, z, 1, 0, 0.04, 0.04, eave + 5.6, eave + 6.5, IRON, true); ball(I, x, eave + 6.55, z, 0.1, IRON);
    out.push([x, z]);
  }
  return out;
}
/** Does the crown of this look apply to the building? (its top is `above` m over its ground) */
export const hasCrown = (b, look) => !!(look && look.crown && b.hEave + b.hRoof >= (look.crown.above || 0));
