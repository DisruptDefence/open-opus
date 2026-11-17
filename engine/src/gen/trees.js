// Trees: a tree record into a trunk and a crown. Pure code (no three.js, no DOM, no terrain). Item 8 of docs/plans/SCENE-DETAIL.md.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   tree(soups, t, y, season, lod)
//
//   t        a decoded tree (scene/source.js): x, z (game metres), height (metres, ground to tip), crownRadius
//            (metres), kind (4.5 enum: 1 broadleaf 2 conifer 3 palm 4 shrub 5 dead), form (0 round 1 vase 2 column
//            3 cone 4 spreading).
//   y        the ground under it, metres.
//   season   'summer' | 'autumn' | 'winter' | 'spring'.
//   lod      0: the simple tree of the `far` group (<= 24 triangles: a thin trunk and two crossed lobes), drawn while the
//            cell is beyond the detail distance. 1: the full tree of the `near` group (<= 230 triangles a broadleaf, <= 120 a
//            conifer, <= 60 a shrub). The two are never drawn together; both fill the record's height and crown radius.
//   Everything about one tree comes from soup.js seedOf(t.x, t.z): the same tree every time.
//   Soups    SOUP.trunk (bark, a linear tint per vertex), SOUP.leaves (`leaves|tv`: a linear tint per vertex, dark inside and
//            underneath, light on top, ±8 % per tree, by season). Normals of a crown point away from the crown's middle, so a
//            crown of overlapping lobes shades as one soft mass.
//   Winding  counter-clockwise seen from outside.
//   Collision is the trunk only (scene/install.js), not written here.
//
// Shapes. Broadleaf (round, vase, column, spreading): a trunk of two tapered 5-sided sections that leans a little, 3-5 limbs
// (tapered 5-sided tubes) to the lowest lobes, and a crown of 5-9 overlapping irregular lobes (deformed icosahedra, 20
// triangles each). Conifer (cone, column): a short trunk and 4-6 stacked, slightly drooping 7-sided tiers with ragged rims.
// Shrub: three lobes. Dead: trunk and limbs. The crown is built in a unit space and then scaled so that it reaches the
// record's crown radius and height.
import { rng, seedOf } from './soup.js';
import { SOUP } from './style.js';

export const BROADLEAF = 1, CONIFER = 2, PALM = 3, SHRUB = 4, DEAD = 5;
export const FORM_ROUND = 0, FORM_VASE = 1, FORM_COLUMN = 2, FORM_CONE = 3, FORM_SPREADING = 4;

/** A tree's name: its position to 0.1 m (trees stand at least 1.8 m apart). Collision, damage and the felled set go by it. */
export const treeId = (t) => `${Math.round(t.x * 10)},${Math.round(t.z * 10)}`;
/** Trunk radius at the base (metres): a tree of height h. Collision and the damage a tree takes (world/treefall.js) use it. */
export const trunkRadius = (h) => Math.min(0.6, 0.1 + 0.013 * h);
/** Where the trunk ends and the crown begins, as a fraction of the height. */
const FORK = { [FORM_ROUND]: 0.36, [FORM_VASE]: 0.3, [FORM_COLUMN]: 0.28, [FORM_CONE]: 0.2, [FORM_SPREADING]: 0.32 };

const SEASON_LEAF = { summer: [1, 1, 1], spring: [1.18, 1.24, 0.8], autumn: null, winter: null };
const AUTUMN = [[2.5, 0.95, 0.28], [2.1, 1.45, 0.3], [1.7, 0.7, 0.22]];
const BARK = [0.55, 0.46, 0.38];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const mul = (t, k) => [t[0] * k, t[1] * k, t[2] * k];

/** A triangle with a normal and a tint per vertex (soup.js triN has one tint per triangle). */
function put(s, a, b, c, na, nb, nc, ta, tb, tc) {
  s.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  s.nrm.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
  s.uv.push(0, 0, 0, 0, 0, 0);
  if (s.col) s.col.push(ta[0], ta[1], ta[2], tb[0], tb[1], tb[2], tc[0], tc[1], tc[2]);
}

/** A tapered tube through rings [{ p, r, tint }], `sides` sides, smooth radial normals, open at both ends. */
function tube(s, rings, sides, phase = 0) {
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k], B = rings[k + 1], d = unit(sub(B.p, A.p));
    const h = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(h, d)), v = cross(d, u); // u x v = d: counter-clockwise from outside
    const at = (R, i) => { const a = phase + (i / sides) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); return { n: [c * u[0] + sn * v[0], c * u[1] + sn * v[1], c * u[2] + sn * v[2]], c, sn }; };
    for (let i = 0; i < sides; i++) {
      const p = at(A, i), q = at(A, i + 1), P = (R, e) => [R.p[0] + R.r * e.n[0], R.p[1] + R.r * e.n[1], R.p[2] + R.r * e.n[2]];
      const a0 = P(A, p), a1 = P(A, q), b0 = P(B, p), b1 = P(B, q);
      put(s, a0, a1, b1, p.n, q.n, q.n, A.tint, A.tint, B.tint);
      put(s, a0, b1, b0, p.n, q.n, p.n, A.tint, B.tint, B.tint);
    }
  }
}


const WOOD_CUT = [0.8, 0.62, 0.42];
/** The ring of the trunk line at height cutY (radius and position interpolated between the rings that bracket it). */
function ringAt(rings, cutY) {
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k], B = rings[k + 1];
    if (cutY >= A.p[1] && cutY <= B.p[1]) { const f = (cutY - A.p[1]) / (B.p[1] - A.p[1] || 1); return { p: [lerp(A.p[0], B.p[0], f), cutY, lerp(A.p[2], B.p[2], f)], r: lerp(A.r, B.r, f), tint: A.tint }; }
  }
  const e = rings[rings.length - 1]; return { p: [e.p[0], cutY, e.p[2]], r: e.r, tint: e.tint };
}
/** A jagged end on a trunk cut at ring `c`: spikes standing up (dir 1, the stump) or hanging down (dir -1, the fallen top). */
function splinters(s, c, dir, sides, phase) {
  const ring = [], spike = [], r = rng(Math.floor(phase * 1e4) + 3); // its own stream: the rest of the tree is the same standing or felled
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    ring.push([c.p[0] + Math.cos(a) * c.r, c.p[1], c.p[2] + Math.sin(a) * c.r]); spike.push(dir * (0.08 + 0.4 * r()) * Math.max(0.5, c.r * 3));
  }
  const mid = [c.p[0], c.p[1] + dir * 0.03, c.p[2]];
  for (let i = 0; i < sides; i++) {
    const a = [ring[i][0], ring[i][1] + spike[i], ring[i][2]], b = [ring[(i + 1) % sides][0], ring[(i + 1) % sides][1] + spike[(i + 1) % sides], ring[(i + 1) % sides][2]];
    let n = unit(cross(sub(b, a), sub(mid, a))); const [p, q] = n[1] * dir >= 0 ? [a, b] : [b, a];
    if (n[1] * dir < 0) n = [-n[0], -n[1], -n[2]];
    put(s, p, q, mid, n, n, n, WOOD_CUT, WOOD_CUT, mul(WOOD_CUT, 0.8));
  }
}
/** The trunk of a tree: whole, or only the stump below `at` metres (with splinters), or only what is above `at` (the felled top). */
function emitTrunk(s, rings, sides, phase, part, at, y, r) {
  if (!part) return tube(s, rings, sides, phase);
  const cutY = y + Math.min(at, rings[rings.length - 1].p[1] - y - 0.2), c = ringAt(rings, cutY);
  if (part === 'stump') { tube(s, [...rings.filter((q) => q.p[1] < cutY - 1e-6), c], sides, phase); splinters(s, c, 1, sides, phase); }
  else { tube(s, [c, ...rings.filter((q) => q.p[1] > cutY + 1e-6)], sides, phase); splinters(s, c, -1, sides, phase); }
}

// icosahedron, faces counter-clockwise seen from outside
const T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]].map(unit);
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

/** Unit-space lobes of a broadleaf crown by form: [{ c: [x, y, z], rx, ry }] with x, z around the axis and y 0..1. */
function lobesOf(form, n, r) {
  const out = [], golden = 2.399963, a0 = r() * 6.283;
  if (form === FORM_COLUMN) {
    for (let i = 0; i < n; i++) { const y = 0.14 + 0.76 * (i / (n - 1)), p = 0.12 + 0.2 * r(), a = a0 + i * golden; out.push({ c: [Math.cos(a) * p, y, Math.sin(a) * p], rx: 0.4 + 0.08 * r(), ry: 0.28 + 0.06 * r() }); }
  } else if (form === FORM_VASE) {
    for (let i = 0; i < n; i++) { const y = 0.22 + 0.62 * (i / (n - 1)), p = (0.1 + 0.55 * y) * (0.8 + 0.4 * r()), a = a0 + i * golden; out.push({ c: [Math.cos(a) * p, y, Math.sin(a) * p], rx: 0.3 + 0.22 * y + 0.06 * r(), ry: 0.3 + 0.06 * r() }); }
  } else if (form === FORM_SPREADING) {
    out.push({ c: [0, 0.58, 0], rx: 0.5, ry: 0.3 });
    for (let i = 1; i < n; i++) { const p = 0.6 + 0.25 * r(), a = a0 + i * golden; out.push({ c: [Math.cos(a) * p, 0.3 + 0.22 * r(), Math.sin(a) * p], rx: 0.45 + 0.1 * r(), ry: 0.28 + 0.06 * r() }); }
  } else { // round
    out.push({ c: [0, 0.74, 0], rx: 0.42, ry: 0.34 });
    for (let i = 1; i < n; i++) { const p = 0.62 * (0.6 + 0.4 * r()), a = a0 + i * golden; out.push({ c: [Math.cos(a) * p, 0.16 + 0.5 * r(), Math.sin(a) * p], rx: 0.36 + 0.1 * r(), ry: 0.3 + 0.08 * r() }); }
  }
  return out;
}

function leafTint(season, kind, r) {
  let base = SEASON_LEAF[season];
  if (kind === CONIFER || kind === SHRUB && season === 'winter') base = [1, 1, 1];
  if (!base) base = season === 'autumn' ? AUTUMN[Math.floor(r() * AUTUMN.length)] : [1, 1, 1];
  return [base[0] * (1 + (r() * 2 - 1) * 0.08), base[1] * (1 + (r() * 2 - 1) * 0.08), base[2] * (1 + (r() * 2 - 1) * 0.08)];
}
/** Dark inside and underneath, light on top: k 0 (bottom of the crown) to 1 (top). */
const shadeAt = (k) => lerp(0.62, 1.45, Math.pow(clamp01(k), 0.8));

/** Emit a crown: lobes given as arrays of world vertices (deformed icosahedra), normals away from `centre`, tint by height. */
function emitLobes(s, lobes, centre, yb, ytop, tint) {
  const span = Math.max(1e-6, ytop - yb), nrm = (p) => unit([p[0] - centre[0], (p[1] - centre[1]) * 0.9, p[2] - centre[2]]);
  const col = (p) => mul(tint, shadeAt((p[1] - yb) / span));
  for (const L of lobes) for (const f of ICO_F) {
    const a = L[f[0]], b = L[f[1]], c = L[f[2]];
    put(s, a, b, c, nrm(a), nrm(b), nrm(c), col(a), col(b), col(c));
  }
}

/** The trunk's rings: base (a little below the ground), middle and fork, leaning towards `lean`. */
function trunkRings(x, y, z, th, rb, lean, tint) {
  return [
    { p: [x, y - 0.3, z], r: rb * 1.15, tint: mul(tint, 0.9) },
    { p: [x + lean[0] * 0.35, y + th * 0.5, z + lean[1] * 0.35], r: rb * 0.8, tint },
    { p: [x + lean[0], y + th, z + lean[1]], r: rb * 0.55, tint: mul(tint, 1.05) },
  ];
}

function broadleaf(soups, t, y, season, lod, r, dead, part, at) {
  const trunk = soups.get(SOUP.trunk), crown = soups.get(SOUP.leaves), H = t.height, R = Math.max(0.3, t.crownRadius);
  const form = FORK[t.form] != null ? t.form : FORM_ROUND, rb = trunkRadius(H), th = H * FORK[form];
  const bark = mul(BARK, 0.9 + 0.2 * r());
  const la = r() * 6.283, leanM = (0.01 + 0.015 * r()) * H, lean = [Math.cos(la) * leanM, Math.sin(la) * leanM];
  const cx = t.x + lean[0], cz = t.z + lean[1], yb = y + th * 0.85, ytop = y + H;
  const tint = leafTint(season, BROADLEAF, r), bare = season === 'winter' || dead;
  if (lod === 0) {
    const rings = trunkRings(t.x, y, t.z, th, rb, lean, bark).filter((_, i) => i !== 1);
    if (bare) rings.push({ p: [cx, ytop, cz], r: rb * 0.05, tint: bark }); // a bare tree is a trunk running up to its tip
    emitTrunk(trunk, rings, 4, 0.8, part, at, y, r);
    if (bare || part === 'stump') return;
    const mid = [cx, (yb + ytop) / 2, cz], ch = (ytop - yb) / 2, Rr = Math.max(0.3, R - Math.hypot(lean[0], lean[1]));
    for (const [rot, k] of [[0.3, 1], [0.3 + Math.PI / 4, 0.82]]) {
      const hh = ch * (k === 1 ? 1 : 0.8), ring = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]) => [mid[0] + (a * Math.cos(rot) - b * Math.sin(rot)) * Rr * k, mid[1], mid[2] + (a * Math.sin(rot) + b * Math.cos(rot)) * Rr * k]);
      const top = [mid[0], mid[1] + hh, mid[2]], bot = [mid[0], mid[1] - hh, mid[2]];
      const lowT = mul(tint, shadeAt(0)), hiT = mul(tint, shadeAt(1)), midT = mul(tint, shadeAt(0.5)), nn = (p) => unit([p[0] - mid[0], (p[1] - mid[1]) * 0.9, p[2] - mid[2]]);
      for (let i = 0; i < 4; i++) {
        const a = ring[i], b = ring[(i + 1) % 4];
        put(crown, a, b, top, nn(a), nn(b), nn(top), midT, midT, hiT);
        put(crown, b, a, bot, nn(b), nn(a), nn(bot), midT, midT, lowT);
      }
    }
    return;
  }
  const ph = r() * 6;
  emitTrunk(trunk, trunkRings(t.x, y, t.z, th, rb, lean, bark), 5, ph, part, at, y, r);
  if (part === 'stump') return;
  // lobes in unit space, then scaled to the record
  const nLobes = 5 + Math.floor(r() * 5);
  let nLimbs = 3 + Math.floor(r() * 3); if (nLobes === 9) nLimbs = 3;
  const lobes = lobesOf(form, nLobes, r), verts = lobes.map((L) => ICO_V.map((v) => { const k = 0.7 + 0.6 * r(); return [L.c[0] + v[0] * L.rx * k, L.c[1] + v[1] * L.ry * k, L.c[2] + v[2] * L.rx * k]; }));
  let ymin = 1e9, ymax = -1e9, rmax = 0;
  for (const L of verts) for (const v of L) { ymin = Math.min(ymin, v[1]); ymax = Math.max(ymax, v[1]); rmax = Math.max(rmax, Math.hypot(v[0], v[2])); }
  let sx = Math.max(0.2, R - Math.hypot(lean[0], lean[1])) / rmax;
  const sy = (ytop - yb) / (ymax - ymin), farthest = (k) => { let d = 0; for (const L of verts) for (const v of L) d = Math.max(d, Math.hypot(lean[0] + v[0] * k, lean[1] + v[2] * k)); return d; };
  for (let i = 0; i < 4; i++) sx *= R / farthest(sx); // the farthest vertex from the trunk's foot lies on the record's crown radius
  const X = (v) => [cx + v[0] * sx, yb + (v[1] - ymin) * sy, cz + v[2] * sx];
  const world = verts.map((L) => L.map(X)), centres = lobes.map((L) => X(L.c));
  // limbs: from the fork to the lowest lobes, into the lobe
  const order = centres.map((c, i) => i).sort((a, b) => centres[a][1] - centres[b][1]).slice(0, nLimbs), fork = [t.x + lean[0], y + th, t.z + lean[1]];
  const limbTint = mul(bark, 0.95);
  order.forEach((i, k) => {
    const c = centres[i], to = [fork[0] + (c[0] - fork[0]) * (bare ? 0.95 : 0.6), fork[1] + (c[1] - fork[1]) * (bare ? 0.95 : 0.6), fork[2] + (c[2] - fork[2]) * (bare ? 0.95 : 0.6)];
    tube(trunk, [{ p: fork, r: rb * 0.5, tint: limbTint }, { p: to, r: rb * (bare ? 0.12 : 0.22), tint: limbTint }], 5, k);
  });
  if (bare) tube(trunk, [{ p: fork, r: rb * 0.45, tint: limbTint }, { p: [cx, ytop, cz], r: rb * 0.04, tint: limbTint }], 5, 2);
  if (!bare) emitLobes(crown, world, [cx, yb + (ytop - yb) * 0.45, cz], yb, ytop, tint);
}

function conifer(soups, t, y, season, lod, r, part, at) {
  const trunk = soups.get(SOUP.trunk), crown = soups.get(SOUP.leaves), H = t.height, R = Math.max(0.25, t.crownRadius), rb = trunkRadius(H) * 0.8;
  const column = t.form === FORM_COLUMN, yb = y + H * (column ? 0.12 : 0.18), ytop = y + H, tint = leafTint(season, CONIFER, r), span = ytop - yb;
  const bark = mul(BARK, 0.8 + 0.2 * r()), shade = (py) => mul(tint, shadeAt((py - yb) / span) * 0.85);
  const centre = [t.x, yb + span * 0.45, t.z], nn = (p) => unit([p[0] - centre[0], (p[1] - centre[1]) * 0.8, p[2] - centre[2]]);
  if (lod === 0) {
    emitTrunk(trunk, [{ p: [t.x, y - 0.3, t.z], r: rb * 1.1, tint: bark }, { p: [t.x, yb + span * 0.3, t.z], r: rb * 0.5, tint: bark }], 4, 0.8, part, at, y, r);
    if (part === 'stump') return;
    const SIDES = 6, ring = [], base = [t.x, yb, t.z], tip = [t.x, ytop, t.z];
    for (let i = 0; i < SIDES; i++) { const a = (i / SIDES) * Math.PI * 2 + 0.3; ring.push([t.x + Math.cos(a) * R, yb, t.z + Math.sin(a) * R]); }
    for (let i = 0; i < SIDES; i++) {
      const a = ring[i], b = ring[(i + 1) % SIDES], up = [0, -1, 0];
      put(crown, a, tip, b, nn(a), nn(tip), nn(b), shade(yb), shade(ytop), shade(yb));
      put(crown, a, b, base, up, up, up, mul(shade(yb), 0.6), mul(shade(yb), 0.6), mul(shade(yb), 0.6));
    }
    return;
  }
  const lean = [0, 0];
  emitTrunk(trunk, trunkRings(t.x, y, t.z, span * 0.5 + (yb - y), rb, lean, bark), 5, r() * 6, part, at, y, r);
  if (part === 'stump') return;
  const n = 4 + Math.floor(r() * 3), SIDES = 7, tierH = (span / n) * 1.9;
  for (let i = 0; i < n; i++) {
    const f = i / n, yi = yb + (span - tierH) * (i / (n - 1)), tipY = i === n - 1 ? ytop : yi + tierH;
    const rr = R * (column ? 1 - 0.35 * f : 1 - 0.82 * f), droop = rr * 0.12, a0 = r() * 6.283;
    const ring = [], base = [t.x, yi - droop * 0.3, t.z], tip = [t.x, tipY, t.z];
    for (let k = 0; k < SIDES; k++) { const a = a0 + (k / SIDES) * Math.PI * 2, q = i === 0 && k === 0 ? 1 : 0.84 + 0.16 * r(); ring.push([t.x + Math.cos(a) * rr * q, yi - droop, t.z + Math.sin(a) * rr * q]); }
    for (let k = 0; k < SIDES; k++) {
      const a = ring[k], b = ring[(k + 1) % SIDES], down = unit([(a[0] + b[0]) / 2 - t.x, -rr * 1.6, (a[2] + b[2]) / 2 - t.z]), dn = [0, -1, 0], dark = mul(shade(yi), 0.55);
      put(crown, a, tip, b, nn(a), nn(tip), nn(b), mul(shade(yi), 0.85), shade(tipY), mul(shade(yi), 0.85));
      put(crown, a, b, base, down, down, dn, dark, dark, mul(dark, 0.8));
    }
  }
}

function shrub(soups, t, y, season, lod, r, part) {
  if (part === 'stump') return;
  const crown = soups.get(SOUP.leaves), H = t.height, R = Math.max(0.25, t.crownRadius), tint = leafTint(season, SHRUB, r), a0 = r() * 6.283;
  if (season === 'winter') return;
  const lobes = [], count = lod === 0 ? 0 : 3;
  const spots = [[0, 0.62, 0, 0.6, 0.5], [Math.cos(a0) * 0.55, 0.38, Math.sin(a0) * 0.55, 0.5, 0.4], [Math.cos(a0 + 2.4) * 0.55, 0.36, Math.sin(a0 + 2.4) * 0.55, 0.5, 0.38]];
  if (lod === 0) { // two crossed octahedra
    const mid = [t.x, y + H * 0.5, t.z], ch = H * 0.5, nn = (p) => unit([p[0] - mid[0], (p[1] - mid[1]) * 0.9, p[2] - mid[2]]), lowT = mul(tint, shadeAt(0)), hiT = mul(tint, shadeAt(1)), midT = mul(tint, shadeAt(0.5));
    for (const [rot, k] of [[0.2, 1], [0.2 + Math.PI / 4, 0.8]]) {
      const ring = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]) => [mid[0] + (a * Math.cos(rot) - b * Math.sin(rot)) * R * k, mid[1], mid[2] + (a * Math.sin(rot) + b * Math.cos(rot)) * R * k]);
      const top = [mid[0], mid[1] + ch * k, mid[2]], bot = [mid[0], mid[1] - ch * k, mid[2]];
      for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; put(crown, a, b, top, nn(a), nn(b), nn(top), midT, midT, hiT); put(crown, b, a, bot, nn(b), nn(a), nn(bot), midT, midT, lowT); }
    }
    return;
  }
  let ymin = 1e9, ymax = -1e9, rmax = 0;
  const raw = spots.slice(0, count).map(([x, yy, z, rx, ry]) => ICO_V.map((v) => { const k = 0.8 + 0.4 * r(); return [x + v[0] * rx * k, yy + v[1] * ry * k, z + v[2] * rx * k]; }));
  for (const L of raw) for (const v of L) { ymin = Math.min(ymin, v[1]); ymax = Math.max(ymax, v[1]); rmax = Math.max(rmax, Math.hypot(v[0], v[2])); }
  const sx = R / rmax, sy = H / (ymax - ymin);
  for (const L of raw) lobes.push(L.map((v) => [t.x + v[0] * sx, y + (v[1] - ymin) * sy, t.z + v[2] * sx]));
  emitLobes(crown, lobes, [t.x, y + H * 0.45, t.z], y, y + H, tint);
}

/**
 * opts (or a record's `fell: { h }`): { part: 'stump' | 'top', at } draws only the stump below `at` metres above the ground
 * (what stays when a tree is felled; a felled record draws it by itself) or only the trunk above it and the crown (the part
 * that falls, built round the origin: `t.sx, t.sz` keep the seed of the tree's true position when t.x, t.z are shifted).
 */
export function tree(soups, t, y, season, lod, opts) {
  const r = rng(seedOf(t.sx ?? t.x, t.sz ?? t.z)), o = opts || (t.fell ? { part: 'stump', at: t.fell.h } : null), part = o && o.part, at = o ? o.at : 0;
  const kind = t.kind || BROADLEAF;
  if (kind === CONIFER) conifer(soups, t, y, season, lod, r, part, at);
  else if (kind === SHRUB) shrub(soups, t, y, season, lod, r, part);
  else broadleaf(soups, t, y, season, lod, r, kind === DEAD, part, at);
}
