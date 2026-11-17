// A civilian standing about, for the prop kit (gen/props.js registers it): `person_stand`. Pure code, our own shapes.
//
// SCENERY ONLY. The figure is written into a soup once, static: no skeleton, no skinning, no animation, no weapon, no uniform.
// It is not a threat record and the director and the combat module never see it; a prop only stops walkers and bullets
// through its collider (props.js header).
//
// Why not the threat figure builder (threats/figures/person.js): it builds three.js geometry on a rig and lives in the
// simulation layer, which `gen` may not import (docs/ARCHITECTURE.md: imports go down; `gen` is pure, no three.js). Its
// geometry is also lifted code with a rig, not a pose. So this is a small capsule-limbed figure of its own: tapered limbs
// between joints that a two-bone solver places, an elliptical torso and a head lofted from rings. About 300 triangles.
//
// variant = a small integer: the pose is variant % 5 (0 weight on one leg, 1 hands in pockets, 2 looking at a phone,
// 3 arms folded, 4 talking with one hand raised) and everything else (height 1.55 to 1.90 m, clothes, skin, hair, a cap,
// a bag) is drawn from floor(variant / 5), so variants 0..4 are one person in five poses.
import { triN, tri, fan, linear, rng, shade } from './soup.js';
import { SOUP } from './style.js';
import { face, frameOf } from './vehicles.js';

const BODY_SOUP = SOUP.tread;   // diffuse, tinted, casts a shadow (the trim soup casts none and a person would float); it is dark, so the colours are lifted
const LIFT = 2.4;
const SIDES = 8, LIMB_SIDES = 6;

const JACKETS = ['#3b4048', '#5a5148', '#2f3d34', '#6b6f73', '#4a3a3a', '#8c7f6a', '#2d3347', '#7a6a52', '#a8a49a', '#5b3f35'].map((h) => shade(linear(h), LIFT));
const TROUSERS = ['#2e3d5c', '#3c3f44', '#222426', '#7b6c55', '#4a5568', '#5a5046'].map((h) => shade(linear(h), LIFT));
const SKIN = ['#e1b898', '#c98f6a', '#a06a47', '#6d4630', '#f0cdb4'].map((h) => shade(linear(h), LIFT));
const HAIR = ['#1b1512', '#3a281c', '#6a4a2a', '#8e8678', '#b08a4a', '#2a2a2c'].map((h) => shade(linear(h), LIFT));
const lift = (list) => list.map((h) => shade(linear(h), LIFT));
const SHOE = shade(linear('#1b1b1c'), LIFT), CAP = lift(['#2b3a52', '#6a2a2a', '#3a3a3c', '#d8d4c8']), BAG = lift(['#3a2f28', '#2a2c2e', '#4a5a3e', '#7a4a2a']), SCREEN = linear('#10151a');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Two-bone solver: the middle joint between `a` and `b` for bones l1, l2, bent towards `pole`. */
function bend(a, b, l1, l2, pole) {
  let v = sub(b, a), d = len(v); const max = l1 + l2 - 1e-4; if (d > max) { v = mul(v, max / d); d = max; }
  const n = unit(v), x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, mul(n, dot(pole, n))); if (len(p) < 1e-6) p = [0, 0, 1]; p = unit(p);
  return add(add(a, mul(n, x)), mul(p, h));
}
/** A smooth quad: points with their normals, wound counter-clockwise seen from the side the normals point to. */
function smooth(s, pts, nrm, tint) {
  const g = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), m = [nrm[0][0] + nrm[1][0] + nrm[2][0] + nrm[3][0], nrm[0][1] + nrm[1][1] + nrm[2][1] + nrm[3][1], nrm[0][2] + nrm[1][2] + nrm[2][2] + nrm[3][2]];
  if (dot(g, m) < 0) { pts = pts.slice().reverse(); nrm = nrm.slice().reverse(); }
  triN(s, pts[0], pts[1], pts[2], nrm[0], nrm[1], nrm[2], tint); triN(s, pts[0], pts[2], pts[3], nrm[0], nrm[2], nrm[3], tint);
}
// the person's own frame, set by buildPerson: limbs take their ring phase from it, so a yaw turns the same model
const REF = { fwd: [0, 0, -1], right: [1, 0, 0] };
/** A tapered limb from a to b (radii ra, rb), `LIMB_SIDES` sides, both ends closed flat. */
function limb(s, a, b, ra, rb, tint, capA = true) {
  const ax = unit(sub(b, a)); let r = cross(ax, REF.fwd); if (len(r) < 0.2) r = cross(ax, REF.right); r = unit(r); const q = cross(ax, r);
  const dir = (k) => { const t = (k / LIMB_SIDES) * 2 * Math.PI; return [r[0] * Math.cos(t) + q[0] * Math.sin(t), r[1] * Math.cos(t) + q[1] * Math.sin(t), r[2] * Math.cos(t) + q[2] * Math.sin(t)]; };
  for (let k = 0; k < LIMB_SIDES; k++) { const d0 = dir(k), d1 = dir(k + 1); smooth(s, [add(a, mul(d0, ra)), add(a, mul(d1, ra)), add(b, mul(d1, rb)), add(b, mul(d0, rb))], [d0, d1, d1, d0], tint); }
  const ring = (c, rad) => Array.from({ length: LIMB_SIDES }, (_, k) => add(c, mul(dir(k), rad)));
  face(s, ring(b, rb), ax, tint); if (capA) face(s, ring(a, ra), mul(ax, -1), tint);
}
/** Rings stacked up the vertical axis: { c: centre [x, y, z], rx, rd } with the right hand and forward as frame vectors; a quad's colour from `colour(band, k)`. */
function loft(s, rings, F, colour) {
  const pt = (R, k) => { const t = (k / SIDES) * 2 * Math.PI, u = R.rx * Math.cos(t), d = R.rd * Math.sin(t); return [R.c[0] + F.right[0] * u + F.fwd[0] * d, R.c[1], R.c[2] + F.right[2] * u + F.fwd[2] * d]; };
  const nr = (R, k) => { const t = (k / SIDES) * 2 * Math.PI, u = Math.cos(t) / (R.rx || 1), d = Math.sin(t) / (R.rd || 1); return unit([F.right[0] * u + F.fwd[0] * d, 0.15, F.right[2] * u + F.fwd[2] * d]); };
  for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < SIDES; k++) {
    const A = rings[i], B = rings[i + 1], tint = colour(i, k);
    if (A.rx < 1e-4 && B.rx < 1e-4) continue;
    smooth(s, [pt(A, k), pt(A, k + 1), pt(B, k + 1), pt(B, k)], [nr(A, k), nr(A, k + 1), nr(B, k + 1), nr(B, k)], tint);
  }
  const top = rings[rings.length - 1], bot = rings[0];
  if (top.rx > 1e-4) face(s, Array.from({ length: SIDES }, (_, k) => pt(top, k)), [0, 1, 0], colour(rings.length - 2, 0));
  if (bot.rx > 1e-4) face(s, Array.from({ length: SIDES }, (_, k) => pt(bot, k)), [0, -1, 0], colour(0, 0));
}

function buildPerson(soups, x, y, z, yaw, variant) {
  const F = frameOf(x, y, z, yaw); REF.fwd = F.fwd; REF.right = F.right; const S = soups.get(BODY_SOUP), v = variant | 0, pose = ((v % 5) + 5) % 5, r = rng(Math.floor(Math.abs(v) / 5) * 2654435761 + 977);
  const H = 1.55 + 0.35 * r(), s = H / 1.75, jacket = r.pick(JACKETS), trou = r.pick(TROUSERS), skin = r.pick(SKIN), hair = r.pick(HAIR);
  const cap = r() < 0.3 ? r.pick(CAP) : null, bagRoll = r(), bagCol = r.pick(BAG), bagSide = r() < 0.5 ? 1 : -1, toe = 0.12 + 0.1 * r();
  const W = (u, yy, d) => F.P(u * s, yy * s, d * s);          // a point in the person's frame, in metres of a 1.75 m person scaled to this one
  const hips = pose === 0 ? 0.028 : 0, lean = pose === 2 ? 0.045 : 0;
  // joints (frame units, 1.75 m person)
  const hipY = 0.92, ankleY = 0.075, legL = (hipY - ankleY) * 0.5 * 1.012;
  const legs = [1, -1].map((sg) => {
    const hip = [sg * 0.09 + hips, hipY - 0.006, 0];
    let ank = [sg * 0.11 + hips * 0.5, ankleY, 0.0];
    if (pose === 0 && sg === -1) ank = [-0.19, ankleY, 0.1];          // the free leg out and forward
    if (pose === 0 && sg === 1) ank = [0.1 + hips, ankleY, -0.02];
    if (pose === 3) ank = [sg * 0.12, ankleY, sg === 1 ? 0.03 : -0.03];
    return { hip, ank, knee: bend(hip, ank, legL, legL, [0, 0, 1]) };
  });
  const shY = 1.46, shoulders = [1, -1].map((sg) => [sg * 0.215 + hips * 0.6, shY, lean * 0.4]);
  const wrists = {
    0: [[0.23, 0.9, 0.02], [-0.23, 0.9, 0.02]], 1: [[0.15, 0.82, 0.1], [-0.15, 0.82, 0.1]], 2: [[0.065, 1.2, 0.22], [-0.05, 1.2, 0.22]],
    3: [[-0.12, 1.2, 0.15], [0.12, 1.16, 0.16]], 4: [[0.15, 1.27, 0.21], [-0.23, 0.9, 0.02]],
  }[pose];
  const poles = { 0: [0, -0.3, -1], 1: [0.5, -0.2, -0.7], 2: [0.4, -1, -0.3], 3: [0, -1, 0.1], 4: [0.4, -1, -0.5] }[pose];
  const arms = shoulders.map((sh, i) => { const sg = i === 0 ? 1 : -1, pole = [poles[0] * sg * (pose === 3 ? 0 : 1), poles[1], poles[2]]; return { sh, wr: wrists[i], el: bend(sh, wrists[i], 0.3, 0.27, pole) }; });
  const W3 = (p) => W(p[0], p[1], p[2]);
  // shoes: flat boxes, toes turned out a little, soles on the ground
  for (const [i, L] of legs.entries()) {
    const sg = i === 0 ? 1 : -1, a = W3(L.ank), tx = Math.cos(sg * toe), tz = -Math.sin(sg * toe), rx = F.rx * tx + F.fx * -tz * 0 + 0;
    void rx; const ex = F.rx * Math.cos(sg * toe) + F.fx * Math.sin(sg * toe), ez = F.rz * Math.cos(sg * toe) + F.fz * Math.sin(sg * toe);
    const cx = a[0] + F.fx * 0.05 * s, cz = a[2] + F.fz * 0.05 * s; shoe(S, cx, cz, ex, ez, 0.045 * s, 0.125 * s, y, y + 0.075 * s, SHOE);
    limb(S, W3(L.ank), W3(L.knee), 0.042 * s, 0.056 * s, trou, true); limb(S, W3(L.knee), W3(L.hip), 0.056 * s, 0.078 * s, trou, false);
  }
  // torso: hips, waist, chest, shoulders, as ellipses; leans forward a little when looking down
  const ring = (yy, rx, rd, sh = 0) => ({ c: W(hips * (1 - (yy - 0.9) * 0.6) + 0, yy, sh), rx: rx * s, rd: rd * s });
  loft(S, [ring(0.88, 0.18, 0.115), ring(1.08, 0.165, 0.11, lean * 0.2), ring(1.3, 0.2, 0.13, lean * 0.5), ring(1.44, 0.225, 0.115, lean * 0.8), ring(1.49, 0.07, 0.06, lean)], F, () => jacket);
  for (const [i, A] of arms.entries()) {
    limb(S, W3(A.sh), W3(A.el), 0.057 * s, 0.048 * s, jacket); limb(S, W3(A.el), W3(A.wr), 0.048 * s, 0.04 * s, jacket);
    const dir = unit(sub(W3(A.wr), W3(A.el))); limb(S, W3(A.wr), add(W3(A.wr), mul(dir, 0.085 * s)), 0.035 * s, 0.03 * s, skin);
    void i;
  }
  // neck and head: the head lofted from rings; lower bands skin, the upper bands hair (or a cap); a hairline lower at the back
  const hx = lean * 1.2, hy = pose === 2 ? 1.635 : 1.65, tilt = pose === 2 ? 0.05 : 0;
  limb(S, W(0, 1.47, hx * 0.5), W(0, 1.58, hx + tilt * 0.5), 0.055 * s, 0.05 * s, skin, false);
  const hr = (dy, rx, rd) => ({ c: W(0, hy + dy, hx + tilt), rx: rx * s, rd: rd * s });
  const head = [hr(-0.095, 0.0, 0.0), hr(-0.07, 0.055, 0.065), hr(-0.02, 0.086, 0.1), hr(0.04, 0.09, 0.105), hr(0.085, 0.065, 0.075), hr(0.108, 0.0, 0.0)];
  const hatCol = cap || hair;
  loft(S, head, F, (band, k) => (band <= 1 ? skin : band === 2 ? (cap ? cap : (Math.sin((k / SIDES) * 2 * Math.PI) < -0.1 ? hair : skin)) : hatCol));
  if (cap) face(S, [W(-0.08, hy + 0.05, hx + tilt + 0.09), W(0.08, hy + 0.05, hx + tilt + 0.09), W(0.07, hy + 0.045, hx + tilt + 0.19), W(-0.07, hy + 0.045, hx + tilt + 0.19)], [0, 1, 0], cap);
  // a phone held at chest height
  if (pose === 2) { const c = [0, 1.21, 0.245], h = 0.07, w = 0.035, t = -0.35; const q = (du, dh) => W(c[0] + du, c[1] + dh * Math.cos(t), c[2] - dh * Math.sin(t)); face(S, [q(-w, -h), q(w, -h), q(w, h), q(-w, h)], F.fwd.map((a) => -a).map((a, i) => (i === 1 ? 0.7 : a)), SCREEN); }
  // a bag: a shoulder bag on one hip with a strap, or a small pack on the back
  if (bagRoll < 0.22) {
    const u = 0.22 * bagSide, [bx, , bz] = W(u, 0, -0.02); bagBox(S, bx, bz, F, 0.045 * s, 0.1 * s, y + 0.82 * s, y + 1.02 * s, bagCol);
    face(S, [W(0.19 * bagSide, 1.45, 0.0), W(0.23 * bagSide, 1.45, 0.0), W(0.0 + 0.06 * bagSide, 1.12, 0.12), W(-0.04 * bagSide, 1.12, 0.12)].slice(0, 4).reverse(), [0, 0, 1], bagCol);
  } else if (bagRoll < 0.4) { const [bx, , bz] = W(0, 0, -0.17); bagBox(S, bx, bz, F, 0.13 * s, 0.055 * s, y + 1.0 * s, y + 1.4 * s, bagCol); }
}
function shoe(S, cx, cz, ex, ez, hu, hd, y0, y1, tint) { bagBoxRaw(S, cx, cz, ex, ez, hu, hd, y0, y1, tint); }
function bagBox(S, cx, cz, F, hu, hd, y0, y1, tint) { bagBoxRaw(S, cx, cz, F.rx, F.rz, hu, hd, y0, y1, tint); }
/** An upright box by centre, direction of its u axis, half sizes. Faces outwards by construction. */
function bagBoxRaw(S, cx, cz, ex, ez, hu, hd, y0, y1, tint) {
  const p = (u, d) => [cx + ex * u - ez * d, cz + ez * u + ex * d], c = [p(-hu, -hd), p(hu, -hd), p(hu, hd), p(-hu, hd)];
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4], m = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz]; face(S, [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], m, tint); }
  face(S, c.map(([a, b]) => [a, y1, b]), [0, 1, 0], tint);
}
void tri; void fan;

export const PERSON_KIT = {
  person_stand: { collider: { r: 0.25, h: 1.8, nav: false }, maxTriangles: 600, build: buildPerson },
};
