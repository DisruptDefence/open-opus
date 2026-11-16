// The prop kit: street furniture as procedural models by kind. Pure code. OWNED BY ITEM 8 of
// docs/plans/SCENE-DETAIL.md; the kit below holds the kinds the landmarks and the terrace need (bench_slat, lamp_lantern,
// cannon, flagpole, plinth, monument_tall, pavilion, planter, bollard_iron); the rest of the plan's table is still to come.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   PROP_KIT[kind] = { build(soups, x, y, z, yaw, variant, style), collider }
//
//   kind      the word a scene's `props.kinds` uses: lamp_lantern, lamp_cobra, bench_slat, bollard_iron, hydrant, bin,
//             flagpole, cannon, plinth, fountain, post_box, sign_stop, bike_rack, rail_iron (plan, item 8).
//   build     writes ONE prop standing at (x, z) with its lowest point at y (the ground there, sidewalk included).
//   yaw       radians about +y as three.js turns: 0 faces grid north (-z), positive turns towards the west. The prop
//             faces (-sin yaw, -cos yaw) on the plan and its right hand is (cos yaw, -sin yaw). Model the prop in its
//             own frame (right, up, forward) and place it with soup.js box(), frame() or your own turn.
//   variant   a small integer from the scene (colour or form within the kind); 0 when the data says nothing.
//   style     the resolved style (style.js).
//   collider  null (nothing stops), or { r, h, nav } (an upright square of half-width r metres, h metres tall), or
//             { hw, hd, h, nav } (a box of half-width hw along the prop's right hand and half-depth hd along its
//             facing, turned with yaw). nav: true when the prop closes its nav cell (a bench, a cannon), false when a
//             walker and a bullet are stopped but paths go on beside it (a lamp post). scene/install.js makes the
//             solid from this, so the model must fill what the collider says and no more than 0.1 m beyond it.
//   Soups     at most three per kind: SOUP.iron, SOUP.timber, SOUP.trim, SOUP.lampGlass (style.js). Tints are linear
//             [r, g, b]. Smooth round parts: soup.js triN() with normals pointing away from the axis.
//   Winding   counter-clockwise seen from outside.
//   Group     `near` only: a prop is not drawn beyond the detail distance.
//   Budget    30 to 250 triangles a prop; <= 25 000 triangles of props a cell.
//   Must not  carry lettering, a logo or the flag of a real state; read the DOM or three.js.

export const PROP_KIT = {};

import { box, tri, triN, quad, fan, shade } from './soup.js';
import { SOUP, ROOF_SOUP } from './style.js';

const IRON = [0.03, 0.033, 0.036], GREEN_PAINT = [0.02, 0.1, 0.05], STONE = [0.42, 0.4, 0.36], BRONZE = [0.05, 0.16, 0.12], WHITE = [0.8, 0.78, 0.72];
// a prop's own frame: right, up, forward (the facing), at the plan point (x, z) turned by yaw
const frameOf = (x, z, yaw) => ({ x, z, rx: Math.cos(yaw), rz: -Math.sin(yaw), fx: -Math.sin(yaw), fz: -Math.cos(yaw) });
const at = (p, u, d) => [p.x + p.rx * u + p.fx * d, p.z + p.rz * u + p.fz * d];
const bx = (s, p, u, d, hu, hd, y0, y1, tint, top = true) => { const [cx, cz] = at(p, u, d); box(s, cx, cz, p.rx, p.rz, hu, hd, y0, y1, tint, top); };
const up = (s, a, b, c, tint) => { const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); if (ny >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint); };

/** A surface of revolution about the vertical axis at frame point (u, d): profile [[radius, y], …] bottom to top, smooth normals, a flat cap on top. */
function lathe(s, p, u, d, prof, seg, tint) {
  const [cx, cz] = at(p, u, d), ring = (r, y, k) => [cx + r * Math.cos((k / seg) * 2 * Math.PI), y, cz + r * Math.sin((k / seg) * 2 * Math.PI)];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], slope = Math.atan2(r0 - r1, y1 - y0), ny = Math.sin(slope), nr = Math.cos(slope);
    const nrm = (k) => [Math.cos((k / seg) * 2 * Math.PI) * nr, ny, Math.sin((k / seg) * 2 * Math.PI) * nr];
    for (let k = 0; k < seg; k++) {
      const A = ring(r0, y0, k), B = ring(r0, y0, k + 1), C = ring(r1, y1, k + 1), D = ring(r1, y1, k);
      if (r0 > 1e-6) triN(s, A, D, C, nrm(k), nrm(k), nrm(k + 1), tint); else if (r1 <= 1e-6) continue;
      if (r1 > 1e-6) triN(s, A, C, B, nrm(k), nrm(k + 1), nrm(k + 1), tint); else triN(s, A, D, B, nrm(k), nrm(k), nrm(k + 1), tint);
    }
  }
  const [rt, yt] = prof[prof.length - 1];
  if (rt > 1e-6) for (let k = 0; k < seg; k++) up(s, [cx, yt, cz], ring(rt, yt, k), ring(rt, yt, k + 1), tint);
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** A polygon (3D points, roughly planar) wound so that its front looks along `out`. */
function plate(s, pts, out, tint) { const n = cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0])); fan(s, dot3(n, out) >= 0 ? pts : pts.slice().reverse(), tint); }
/** A round tube between two points (world x, y, z), `seg` sides, closed at both ends. */
function tubeW(s, A, B, r0, r1, seg, tint) {
  const ax = sub3(B, A), l = Math.hypot(...ax), n = [ax[0] / l, ax[1] / l, ax[2] / l]; let pr = cross3(n, [0, 1, 0]); const pl = Math.hypot(...pr);
  pr = pl < 1e-6 ? [1, 0, 0] : [pr[0] / pl, pr[1] / pl, pr[2] / pl]; const qr = cross3(n, pr);
  const dir = (k) => { const c = Math.cos((k / seg) * 2 * Math.PI), d = Math.sin((k / seg) * 2 * Math.PI); return [pr[0] * c + qr[0] * d, pr[1] * c + qr[1] * d, pr[2] * c + qr[2] * d]; };
  const pt = (C, r, k) => { const d = dir(k); return [C[0] + d[0] * r, C[1] + d[1] * r, C[2] + d[2] * r]; };
  for (let k = 0; k < seg; k++) { const P = pt(A, r0, k), Q = pt(A, r0, k + 1), R = pt(B, r1, k + 1), S = pt(B, r1, k); const out = dir(k + 0.5); const m = cross3(sub3(Q, P), sub3(R, P)); if (dot3(m, out) >= 0) quad(s, P, Q, R, S, tint); else quad(s, S, R, Q, P, tint); }
  plate(s, Array.from({ length: seg }, (_, k) => pt(A, r0, k)), [-n[0], -n[1], -n[2]], tint); plate(s, Array.from({ length: seg }, (_, k) => pt(B, r1, k)), n, tint);
}
const w3 = (p, u, y, d) => { const q = at(p, u, d); return [q[0], y, q[1]]; };
/** A round tube between two points of the prop's frame (u, y, d). */
const tube = (s, p, A, B, r0, r1, seg, tint) => tubeW(s, w3(p, A[0], A[1], A[2]), w3(p, B[0], B[1], B[2]), r0, r1, seg, tint);

PROP_KIT.bench_slat = {
  collider: { hw: 0.9, hd: 0.3, h: 0.85, nav: true },
  build(soups, x, y, z, yaw, variant) {
    const p = frameOf(x, z, yaw), W = soups.get(SOUP.timber), I = soups.get(SOUP.iron), wood = variant === 1 ? [0.2, 0.12, 0.06] : GREEN_PAINT;
    for (const u of [-0.8, 0.8]) { bx(I, p, u, 0, 0.04, 0.27, y, y + 0.43, IRON); bx(I, p, u, -0.24, 0.04, 0.03, y + 0.43, y + 0.88, IRON); }
    for (let k = 0; k < 5; k++) bx(W, p, 0, 0.24 - k * 0.1, 0.88, 0.04, y + 0.43, y + 0.47, wood);
    for (let k = 0; k < 3; k++) bx(W, p, 0, -0.26, 0.88, 0.012, y + 0.55 + k * 0.12, y + 0.65 + k * 0.12, wood);
  },
};
PROP_KIT.lamp_lantern = {
  collider: { r: 0.15, h: 3.6, nav: false },
  build(soups, x, y, z, yaw) {
    const p = frameOf(x, z, yaw), I = soups.get(SOUP.iron), G = soups.get(SOUP.lampGlass);
    lathe(I, p, 0, 0, [[0.2, y], [0.18, y + 0.35], [0.1, y + 0.5], [0.075, y + 0.7], [0.06, y + 3.2], [0.09, y + 3.25]], 8, IRON);
    bx(I, p, 0, 0, 0.22, 0.22, y, y + 0.2, IRON, true);
    bx(I, p, 0, 0, 0.19, 0.19, y + 3.25, y + 3.33, IRON);
    bx(G, p, 0, 0, 0.17, 0.17, y + 3.33, y + 3.85, [1, 0.85, 0.55]);
    const [cx, cz] = at(p, 0, 0), apex = [cx, y + 4.15, cz], c = [[0.22, 0.22], [0.22, -0.22], [-0.22, -0.22], [-0.22, 0.22]].map(([u, d]) => { const q = at(p, u, d); return [q[0], y + 3.85, q[1]]; });
    for (let k = 0; k < 4; k++) up(I, c[k], c[(k + 1) % 4], apex, IRON);
    lathe(I, p, 0, 0, [[0.03, y + 4.15], [0.012, y + 4.3]], 8, IRON);
  },
};
PROP_KIT.bollard_iron = {
  collider: { r: 0.12, h: 0.95, nav: false },
  build(soups, x, y, z, yaw) { lathe(soups.get(SOUP.iron), frameOf(x, z, yaw), 0, 0, [[0.11, y], [0.09, y + 0.15], [0.09, y + 0.8], [0.11, y + 0.85], [0.07, y + 0.9], [0.06, y + 0.95]], 8, IRON); },
};
PROP_KIT.cannon = {
  collider: { hw: 0.6, hd: 1.4, h: 1.1, nav: true },
  build(soups, x, y, z, yaw) {
    const p = frameOf(x, z, yaw), W = soups.get(SOUP.timber), I = soups.get(SOUP.iron), car = [0.06, 0.06, 0.07], wood = [0.2, 0.17, 0.14];
    for (const u of [-0.3, 0.3]) bx(W, p, u, -0.05, 0.08, 0.6, y + 0.45, y + 0.72, car);          // cheeks of the carriage
    bx(W, p, 0, -0.95, 0.12, 0.45, y + 0.1, y + 0.3, car);                                         // trail
    bx(W, p, 0, 0.1, 0.5, 0.05, y + 0.38, y + 0.5, car);                                           // axle
    for (const u of [-0.5, 0.5]) tubeW(W, w3(p, u - 0.05, y + 0.45, 0.1), w3(p, u + 0.05, y + 0.45, 0.1), 0.45, 0.45, 8, wood);
    tubeW(I, w3(p, 0, y + 0.8, -0.85), w3(p, 0, y + 1.0, 1.25), 0.2, 0.13, 8, IRON);
  },
};
PROP_KIT.flagpole = {
  collider: { r: 0.12, h: 9, nav: false },
  build(soups, x, y, z, yaw, variant) {
    const p = frameOf(x, z, yaw), I = soups.get(SOUP.iron), F = soups.get(SOUP.awning), tops = [[0.62, 0.08, 0.1], [0.07, 0.18, 0.38], [0.85, 0.82, 0.74], [0.05, 0.28, 0.12]], c = tops[(variant | 0) % tops.length];
    lathe(I, p, 0, 0, [[0.1, y], [0.07, y + 0.3], [0.045, y + 0.5], [0.03, y + 8.6], [0.05, y + 8.7], [0.0, y + 8.82]], 8, [0.5, 0.5, 0.48]);
    quad(F, w3(p, 0.04, y + 8.45, 0), w3(p, 1.5, y + 8.45, 0), w3(p, 1.5, y + 7.8, 0), w3(p, 0.04, y + 7.8, 0), c, [0, 0, 1, 1]);
  },
};
PROP_KIT.plinth = {
  collider: { r: 0.9, h: 3.4, nav: true },
  build(soups, x, y, z, yaw) {
    const p = frameOf(x, z, yaw), T = soups.get(SOUP.trim), I = soups.get(SOUP.iron);
    bx(T, p, 0, 0, 0.8, 0.8, y, y + 0.4, STONE); bx(T, p, 0, 0, 0.55, 0.55, y + 0.4, y + 1.8, WHITE); bx(T, p, 0, 0, 0.7, 0.7, y + 1.8, y + 2.0, STONE);
    bx(I, p, 0, 0, 0.4, 0.3, y + 2.0, y + 3.2, BRONZE); bx(I, p, 0, 0, 0.2, 0.2, y + 3.2, y + 3.5, BRONZE);
  },
};
// A tall monument: stepped base, a pedestal with corner piers and a cornice, a bronze figure on a drum. Where a place has a named one it gives a
// bigger variant (variant > 0 scales it by 1 + variant / 10).
PROP_KIT.monument_tall = {
  collider: { r: 3.6, h: 9, nav: true },
  build(soups, x, y, z, yaw, variant) {
    const p = frameOf(x, z, yaw), T = soups.get(SOUP.trim), I = soups.get(SOUP.iron), k = 1 + (variant | 0) / 10;
    bx(T, p, 0, 0, 3.5, 3.5, y, y + 0.35, STONE); bx(T, p, 0, 0, 3.0, 3.0, y + 0.35, y + 0.7, STONE); bx(T, p, 0, 0, 2.5, 2.5, y + 0.7, y + 1.05, STONE);
    bx(T, p, 0, 0, 1.7, 1.7, y + 1.05, y + 1.5, WHITE);
    for (const u of [-1.2, 1.2]) for (const d of [-1.2, 1.2]) bx(T, p, u, d, 0.45, 0.45, y + 1.5, y + 5.2, STONE);
    bx(T, p, 0, 0, 1.15, 1.15, y + 1.5, y + 5.2, WHITE);
    bx(T, p, 0, 0, 1.9, 1.9, y + 5.2, y + 5.65, STONE); bx(T, p, 0, 0, 1.5, 1.5, y + 5.65, y + 5.95, WHITE);
    for (const u of [-1.2, 1.2]) for (const d of [-1.2, 1.2]) bx(I, p, u, d, 0.22, 0.22, y + 5.95, y + 6.5 * k - 0.0, BRONZE);
    lathe(I, p, 0, 0, [[0.9, y + 5.95], [0.7, y + 6.3], [0.5, y + 7.0]], 8, BRONZE);
    bx(I, p, 0, 0, 0.32, 0.22, y + 7.0, y + 8.1, BRONZE); bx(I, p, 0, 0, 0.4, 0.2, y + 8.1, y + 8.9, BRONZE);
    lathe(I, p, 0, 0, [[0.17, y + 8.9], [0.15, y + 9.1], [0.0, y + 9.25]], 8, BRONZE);
  },
};
// An open pavilion: eight slim columns on a low floor, a rail between them, a conical copper roof. variant = radius in half metres (7 = 3.5 m).
PROP_KIT.pavilion = {
  collider: null,
  build(soups, x, y, z, yaw, variant) {
    const p = frameOf(x, z, yaw), r = (variant > 0 ? variant : 7) / 2, T = soups.get(SOUP.trim), R = soups.get(ROOF_SOUP[2] || ROOF_SOUP[0]), n = 8, col = 3.1;
    const pt = (k, rad, yy) => w3(p, rad * Math.cos(((k + 0.5) / n) * 2 * Math.PI), yy, rad * Math.sin(((k + 0.5) / n) * 2 * Math.PI));
    for (let k = 0; k < n; k++) up(T, [p.x, y + 0.15, p.z], pt(k, r, y + 0.15), pt(k + 1, r, y + 0.15), [0.3, 0.26, 0.2]);
    for (let k = 0; k < n; k++) {
      const c = pt(k, r * 0.92, y), d = pt(k + 1, r * 0.92, y), l = Math.hypot(d[0] - c[0], d[2] - c[2]), ex = (d[0] - c[0]) / l, ez = (d[2] - c[2]) / l;
      box(T, c[0], c[2], 1, 0, 0.1, 0.1, y, y + col, WHITE, true);
      box(T, (c[0] + d[0]) / 2, (c[2] + d[2]) / 2, ex, ez, l / 2, 0.04, y + 0.95, y + 1.05, WHITE, true);   // top rail
    }
    const apex = [p.x, y + col + r * 0.95, p.z];
    for (let k = 0; k < n; k++) up(R, pt(k, r * 1.12, y + col), pt(k + 1, r * 1.12, y + col), apex, null);
    for (let k = 0; k < 4; k++) up(R, [apex[0] + 0.05 * Math.cos(k * Math.PI / 2), apex[1] - 0.2, apex[2] + 0.05 * Math.sin(k * Math.PI / 2)], [apex[0] + 0.05 * Math.cos((k + 1) * Math.PI / 2), apex[1] - 0.2, apex[2] + 0.05 * Math.sin((k + 1) * Math.PI / 2)], [apex[0], apex[1] + 1.1, apex[2]], null);
  },
};
PROP_KIT.planter = {
  collider: { r: 0.45, h: 0.9, nav: true },
  build(soups, x, y, z, yaw) {
    const p = frameOf(x, z, yaw), W = soups.get(SOUP.timber), L = soups.get('leaves|t');
    bx(W, p, 0, 0, 0.4, 0.4, y, y + 0.55, [0.1, 0.07, 0.045], false);
    lathe(L, p, 0, 0, [[0.38, y + 0.5], [0.44, y + 0.75], [0.3, y + 0.95], [0.0, y + 1.0]], 8, null);
  },
};
void shade;
