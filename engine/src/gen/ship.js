// A coastal general-cargo ship for the prop kit: PROP_KIT.ship_cargo (registered in gen/props.js). Pure code, our own
// shapes, written from nothing but the numbers below. About 95 m long, 15 m beam, moored port side to.
//
// Model frame: x to starboard, y up, z forward (the bow), origin at the waterline amidships on the centreline. The
// prop's `y` is the water level: the hull reaches DRAFT (1.2 m) below it and is drawn closed there. That frame is
// left-handed in the world, so no winding is trusted: every face is turned to look along its outward hint (triF) or
// along its vertex normals (triS), and ship.test.js checks the stored normals against the winding.
//
// Soups (3 draw calls): SOUP.hull = tinted painted steel that casts shadows (SOUP.trim has `n`, no shadow: wrong for a
// 95 m hull); SOUP.iron = dark fittings, windows, rails; SOUP.awning = double-sided cloth material, used for the
// thin ribbons (mooring lines, rail posts) so one quad is seen from both sides.
//
// `variant` = hull colour (variant % 3: 0 blue-grey, 1 black, 2 oxide red). variant >= 3 also sets the height above
// the water where the mooring lines end: floor(variant / 3) metres (the place file gives its wharf's height); below 3
// the lines end at 0.3 m.
//
// Not walkable: the collider is the hull as one box (7.5 x 47.5 half sizes, 4.5 m above the water).
import { tri, triN, linear, shade, mixTint } from './soup.js';
import { SOUP } from './style.js';

export const SHIP = { length: 95, beam: 15, draft: 1.2, hw: 7.5, hl: 47.5 };
const HULLS = ['#27343f', '#1c1d1f', '#6b2a22'].map(linear);
const BOOT = linear('#6d1f1c'), WHITE = linear('#e6e3da'), WHITE_SLAB = linear('#cfccc2'), GREEN = linear('#3f5a4a'), ORANGE = linear('#d2601f');
const DECK = linear('#4a4640'), BLACK = [0.012, 0.012, 0.014], DARK = [0.03, 0.033, 0.036], GLASS = [0.012, 0.016, 0.022], ROPE = linear('#6e6050');
const RUST = [0.2, 0.07, 0.035];

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = (a, b, t) => { const k = clamp((t - a) / (b - a)); return k * k * (3 - 2 * k); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- the hull's numbers ----------------------------------------------------------------------------------------------
/** Height of the hull's top edge above the water at d: 5.0 at the transom, 4.2 over the parallel body, rising to the forecastle break and the bow. */
export const sheer = (d) => 4.2 + 0.8 * sm(-34, -47.5, d) + 1.4 * sm(20, 36, d) + 0.9 * sm(36, 47.5, d);
const dStern = (y) => -47.5 + 0.12 * Math.max(0, 5 - y);                                   // raked transom
const dBow = (y) => (y >= 0 ? 47.5 - 0.42 * (6.5 - Math.min(y, 6.5)) : 47.5 - 0.42 * 6.5 + 1.7 * Math.pow(Math.sin(Math.PI * clamp(-y / 1.2)), 0.7)); // raked stem, a bulb under the water
const dNom = (s) => dStern(0) + s * (dBow(0) - dStern(0));
const dAt = (s, y) => dStern(y) + s * (dBow(y) - dStern(y));
/** Half-breadth at the fraction s of the length (0 transom, 1 stem) and height y. */
function halfBreadth(s, y) {
  const eta = clamp(y / sheer(dNom(s))), t = clamp((s - 0.67) / 0.33);
  const wl = Math.pow(1 - Math.pow(t, 1.5), 0.8), dk = Math.pow(1 - Math.pow(t, 2.2), 0.55), e = Math.pow(eta, 1.2);
  const tuck = 1 - 0.3 * (1 - sm(0, 0.2, s)) * (1 - clamp((y + 1.2) / 6.2));
  const bilge = 1 - 0.07 * sm(-0.6, -1.2, y);
  return 7.5 * (wl * (1 - e) + dk * e) * (0.82 + 0.18 * sm(0, 0.22, s)) * tuck * bilge;
}
const sOf = (d, y) => clamp((d - dStern(y)) / (dBow(y) - dStern(y)));
const uAt = (d, y) => halfBreadth(sOf(d, y), y);
/** Half-breadth of the hull at d and height y (the shell's plan), for tests and for placing things on it. */
export const hullBreadth = uAt;
// stations along the length: close at the ends (the rust patches sit there), open on the parallel body
const STATIONS = [...Array.from({ length: 9 }, (_, k) => k * 0.0125), 0.12, 0.17, 0.25, 0.33, 0.42, 0.5, 0.58, 0.65, 0.7, 0.74, 0.78, 0.82, 0.85,
  ...Array.from({ length: 10 }, (_, k) => 0.875 + k * 0.0125), 1];
const ROWS_LOW = [-1.2, -0.9, -0.6, -0.3, 0, 0.5], ROWS_UP = 8;
const DECK_Y = 4.2, FORE_Y = 5.6, BREAK = 36, HOUSE_AFT = -42.5, HOUSE_FWD = -28.5;
// rust under the hawse pipes and the scuppers: [d, y of the pipe]
const STREAKS = [[40.8, 4.6], [-45, 4.7], [-42, 4.6], [38, 5.3], [43.5, 5.9]];
const streak = (d, y) => { let k = 0; for (const [d0, y0] of STREAKS) { const w = (d - d0) / 0.75, v = (y0 - y) / 2.6; if (v > -0.1 && v < 1) k = Math.max(k, Math.exp(-w * w) * (1 - clamp(v)) * (v < 0 ? 0.4 : 1)); } return k; };

/**
 * Write one ship. `opts.only = 'hull'` builds the hull, decks and bulwarks alone (tests); `opts.moorings = false` leaves the lines out
 * (the hull's footprint is then 95 x 15 m).
 */
export function buildShip(soups, x, y, z, yaw, variant = 0, opts = {}) {
  const P = soups.get(SOUP.hull), I = soups.get(SOUP.iron), R = soups.get(SOUP.awning);
  const c = Math.cos(yaw), sn = Math.sin(yaw), hullTint = HULLS[(variant | 0) % 3];
  const W = (p) => [x + c * p[0] - sn * p[2], y + p[1], z - sn * p[0] - c * p[2]];
  const V = (n) => [c * n[0] - sn * n[2], n[1], -sn * n[0] - c * n[2]];
  const hide = (a, b, d) => Math.hypot(...cross(sub(b, a), sub(d, a))) < 1e-9;
  /** A triangle whose front looks along `out` (model frame). */
  const triF = (S, a, b, d, out, tint) => { const A = W(a), B = W(b), C = W(d); if (hide(A, B, C)) return; const g = cross(sub(B, A), sub(C, A)); if (dot(g, V(out)) < 0) tri(S, A, C, B, tint); else tri(S, A, B, C, tint); };
  const quadF = (S, a, b, d, e, out, tint) => { triF(S, a, b, d, out, tint); triF(S, a, d, e, out, tint); };
  /** A triangle with a normal per corner (model frame); the front is the side the normals look to. */
  const triS = (S, a, b, d, na, nb, nd, tint) => {
    const A = W(a), B = W(b), C = W(d); if (hide(A, B, C)) return;
    const NA = unit(V(na)), NB = unit(V(nb)), NC = unit(V(nd)), g = cross(sub(B, A), sub(C, A));
    if (dot(g, [NA[0] + NB[0] + NC[0], NA[1] + NB[1] + NC[1], NA[2] + NB[2] + NC[2]]) < 0) triN(S, A, C, B, NA, NC, NB, tint); else triN(S, A, B, C, NA, NB, NC, tint);
  };
  const quadS = (S, a, b, d, e, na, nb, nd, ne, tint) => { triS(S, a, b, d, na, nb, nd, tint); triS(S, a, d, e, na, nd, ne, tint); };
  /** An upright box by its u, y, d ranges; faces: p port, s starboard, a aft, f fore, t top, b bottom. */
  const bx = (S, u0, u1, y0, y1, d0, d1, tint, faces = 'psaft') => {
    const q = (a, b, e, f, out) => quadF(S, a, b, e, f, out, tint);
    if (faces.includes('s')) q([u1, y0, d0], [u1, y0, d1], [u1, y1, d1], [u1, y1, d0], [1, 0, 0]);
    if (faces.includes('p')) q([u0, y0, d0], [u0, y0, d1], [u0, y1, d1], [u0, y1, d0], [-1, 0, 0]);
    if (faces.includes('f')) q([u0, y0, d1], [u1, y0, d1], [u1, y1, d1], [u0, y1, d1], [0, 0, 1]);
    if (faces.includes('a')) q([u0, y0, d0], [u1, y0, d0], [u1, y1, d0], [u0, y1, d0], [0, 0, -1]);
    if (faces.includes('t')) q([u0, y1, d0], [u1, y1, d0], [u1, y1, d1], [u0, y1, d1], [0, 1, 0]);
    if (faces.includes('b')) q([u0, y0, d0], [u1, y0, d0], [u1, y0, d1], [u0, y0, d1], [0, -1, 0]);
  };
  /** An elliptic cylinder (semi-axes ru across, rd along), smooth sides, flat caps as asked. */
  const cyl = (S, cu, cd, y0, y1, ru, rd, seg, tint, tint2 = tint, caps = 't', yMid = null) => {
    const ring = (k, h) => { const a = (k / seg) * 2 * Math.PI; return [cu + ru * Math.cos(a), h, cd + rd * Math.sin(a)]; };
    const nr = (k) => { const a = (k / seg) * 2 * Math.PI; return unit([Math.cos(a) / ru, 0, Math.sin(a) / rd]); };
    for (let k = 0; k < seg; k++) {
      const t0 = yMid !== null ? [[y0, yMid, tint], [yMid, y1, tint2]] : [[y0, y1, tint]];
      for (const [a0, a1, tt] of t0) quadS(S, ring(k, a0), ring(k + 1, a0), ring(k + 1, a1), ring(k, a1), nr(k), nr(k + 1), nr(k + 1), nr(k), tt);
      for (const [h, up, on] of [[y1, 1, caps.includes('t')], [y0, -1, caps.includes('b')]]) if (on) triF(S, [cu, h, cd], ring(k, h), ring(k + 1, h), [0, up, 0], yMid !== null && up > 0 ? tint2 : tint);
    }
  };
  /** A thin ribbon between two points, w wide across `side` (a unit vector), double-sided material. */
  const ribbon = (S, a, b, side, w, tint) => {
    const o = [side[0] * w / 2, side[1] * w / 2, side[2] * w / 2], n = unit(cross(sub(b, a), side));
    quadF(S, [a[0] - o[0], a[1] - o[1], a[2] - o[2]], [a[0] + o[0], a[1] + o[1], a[2] + o[2]], [b[0] + o[0], b[1] + o[1], b[2] + o[2]], [b[0] - o[0], b[1] - o[1], b[2] - o[2]], n, tint);
  };
  /** A rail along a plan polyline [[u, d], …] on height y0: posts every `step`, a top rail and a middle rail. */
  const rail = (pts, y0, h = 1, step = 2, tint = WHITE) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [u0, d0] = pts[i], [u1, d1] = pts[i + 1], len = Math.hypot(u1 - u0, d1 - d0), n = Math.max(1, Math.round(len / step));
      const ex = [(u1 - u0) / len, 0, (d1 - d0) / len], side = [-ex[2], 0, ex[0]];
      ribbon(R, [u0, y0 + h, d0], [u1, y0 + h, d1], [0, 1, 0], 0.06, tint);
      ribbon(R, [u0, y0 + h, d0], [u1, y0 + h, d1], side, 0.05, tint);
      ribbon(R, [u0, y0 + h * 0.5, d0], [u1, y0 + h * 0.5, d1], side, 0.04, tint);
      for (let k = i ? 1 : 0; k <= n; k++) {
        const u = u0 + (u1 - u0) * k / n, d = d0 + (d1 - d0) * k / n;
        ribbon(R, [u, y0, d], [u, y0 + h, d], side, 0.06, tint);
        ribbon(R, [u, y0, d], [u, y0 + h, d], ex, 0.06, tint);
      }
    }
  };

  // ---- the hull ----------------------------------------------------------------------------------------------------
  const NS = STATIONS.length, grid = [];
  for (let i = 0; i < NS; i++) {
    const s = STATIONS[i], top = sheer(dNom(s)), ys = [...ROWS_LOW];
    for (let k = 1; k <= ROWS_UP; k++) ys.push(0.5 + ((top - 0.5) * k) / ROWS_UP);
    grid.push(ys.map((yy) => [halfBreadth(s, yy), yy, dAt(s, yy)]));
  }
  const NJ = grid[0].length, normalAt = (i, j) => {
    const a = grid[Math.min(i + 1, NS - 1)][j], b = grid[Math.max(i - 1, 0)][j], u = grid[i][Math.min(j + 1, NJ - 1)], l = grid[i][Math.max(j - 1, 0)];
    return unit(cross(sub(u, l), sub(a, b)));
  };
  const norms = grid.map((col, i) => col.map((_, j) => normalAt(i, j)));
  for (const sg of [1, -1]) {
    const pt = (i, j) => [sg * grid[i][j][0], grid[i][j][1], grid[i][j][2]], nm = (i, j) => [sg * norms[i][j][0], norms[i][j][1], norms[i][j][2]];
    for (let i = 0; i + 1 < NS; i++) for (let j = 0; j + 1 < NJ; j++) {
      const cu = (grid[i][j][0] + grid[i + 1][j + 1][0]) / 2, cy = (grid[i][j][1] + grid[i + 1][j + 1][1]) / 2, cd = (grid[i][j][2] + grid[i + 1][j + 1][2]) / 2;
      let tint = j < ROWS_LOW.length - 1 ? BOOT : hullTint;
      if (j >= ROWS_LOW.length - 1) { const k = streak(cd, cy) * (cu > 0.3 ? 1 : 0); if (k > 0) tint = mixTint(shade(hullTint, 1 - 0.45 * k), RUST, 0.18 * k); }
      quadS(P, pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), nm(i, j), nm(i + 1, j), nm(i + 1, j + 1), nm(i, j + 1), tint);
    }
  }
  for (let i = 0; i + 1 < NS; i++) quadF(P, [grid[i][0][0], -1.2, grid[i][0][2]], [grid[i + 1][0][0], -1.2, grid[i + 1][0][2]], [-grid[i + 1][0][0], -1.2, grid[i + 1][0][2]], [-grid[i][0][0], -1.2, grid[i][0][2]], [0, -1, 0], BOOT);
  for (let j = 0; j + 1 < NJ; j++) quadF(P, [grid[0][j][0], grid[0][j][1], grid[0][j][2]], [-grid[0][j][0], grid[0][j][1], grid[0][j][2]], [-grid[0][j + 1][0], grid[0][j + 1][1], grid[0][j + 1][2]], [grid[0][j + 1][0], grid[0][j + 1][1], grid[0][j + 1][2]], [0, 0, -1], j < ROWS_LOW.length - 1 ? BOOT : hullTint);
  // top edge: inner face of the bulwark, its cap, the main deck and the forecastle deck
  const IN = 0.12, topRow = grid.map((col) => col[NJ - 1]), deckOf = (d) => (d < BREAK ? DECK_Y : FORE_Y);
  for (const sg of [1, -1]) {
    for (let i = 0; i + 1 < NS; i++) {
      const a = topRow[i], b = topRow[i + 1], ia = Math.max(0, a[0] - IN), ib = Math.max(0, b[0] - IN);
      const ba = Math.max(0, uAt(a[2], deckOf(a[2])) - IN), bb = Math.max(0, uAt(b[2], deckOf(b[2])) - IN);
      quadF(P, [sg * ba, deckOf(a[2]), a[2]], [sg * bb, deckOf(b[2]), b[2]], [sg * ib, b[1], b[2]], [sg * ia, a[1], a[2]], [-sg, 0, 0], hullTint);
      quadF(P, [sg * a[0], a[1], a[2]], [sg * ia, a[1], a[2]], [sg * ib, b[1], b[2]], [sg * b[0], b[1], b[2]], [0, 1, 0], hullTint);
    }
  }
  { const d = topRow[0][2] + IN, ub = Math.max(0, uAt(topRow[0][2], DECK_Y) - IN), ut = Math.max(0, topRow[0][0] - IN);   // the transom's inner face
    quadF(P, [-ub, DECK_Y, d], [ub, DECK_Y, d], [ut, topRow[0][1], d], [-ut, topRow[0][1], d], [0, 0, 1], hullTint); }
  quadF(P, [topRow[0][0], topRow[0][1], topRow[0][2]], [topRow[0][0] - IN, topRow[0][1], topRow[0][2] + IN], [-topRow[0][0] + IN, topRow[0][1], topRow[0][2] + IN], [-topRow[0][0], topRow[0][1], topRow[0][2]], [0, 1, 0], hullTint);
  const deckStrip = (yd, d0, d1, n) => {
    for (let k = 0; k < n; k++) {
      const a = d0 + ((d1 - d0) * k) / n, b = d0 + ((d1 - d0) * (k + 1)) / n, ua = Math.max(0, uAt(a, yd) - IN), ub = Math.max(0, uAt(b, yd) - IN);
      quadF(P, [-ua, yd, a], [ua, yd, a], [ub, yd, b], [-ub, yd, b], [0, 1, 0], DECK);
    }
  };
  deckStrip(DECK_Y, dStern(DECK_Y) + IN, BREAK, 48);
  deckStrip(FORE_Y, BREAK, dBow(FORE_Y) - 0.02, 14);
  // the forecastle break: a bulkhead across the deck, its aft face, with a door each side
  { const u = uAt(BREAK, FORE_Y) - IN; quadF(P, [-u, DECK_Y, BREAK], [u, DECK_Y, BREAK], [u, FORE_Y, BREAK], [-u, FORE_Y, BREAK], [0, 0, -1], hullTint);
    for (const sg of [-1, 1]) quadF(I, [sg * 3.0 - 0.45, DECK_Y, BREAK - 0.03], [sg * 3.0 + 0.45, DECK_Y, BREAK - 0.03], [sg * 3.0 + 0.45, DECK_Y + 1.8, BREAK - 0.03], [sg * 3.0 - 0.45, DECK_Y + 1.8, BREAK - 0.03], [0, 0, -1], DARK); }
  if (opts.only === 'hull') return;

  // ---- deck rails along the open stretches of the deck edge ------------------------------------------------------------
  for (const sg of [-1, 1]) rail([[sg * (uAt(-35.5, DECK_Y) - 0.16), -35.5], [sg * (uAt(19, DECK_Y) - 0.16), 19]], DECK_Y, 1.0, 2, WHITE);

  // ---- the forecastle: windlass, bollards, anchors in their hawse pockets ----------------------------------------------
  bx(I, -1.3, 1.3, FORE_Y, FORE_Y + 0.9, 41.2, 43.2, DARK, 'psaft');
  for (const sg of [-1, 1]) cyl(I, sg * 1.7, 42.2, FORE_Y + 0.15, FORE_Y + 0.75, 0.38, 0.38, 10, DARK, DARK, 'tb');
  const bollard = (u, d, h0) => { for (const o of [-0.28, 0.28]) cyl(I, u, d + o, h0, h0 + 0.5, 0.15, 0.15, 8, DARK, DARK, 't'); bx(I, u - 0.28, u + 0.28, h0, h0 + 0.12, d - 0.5, d + 0.5, DARK, 'psaft'); };
  for (const [d, m] of [[39.5, 0.8], [45.0, 0.7]]) { const u = uAt(d, FORE_Y) - m; bollard(-u, d, FORE_Y); bollard(u, d, FORE_Y); }
  for (const sg of [-1, 1]) {   // hawse pocket and anchor, on the hull side
    const hd = 40.8, hy = 4.1, hu = uAt(hd, hy), e = 0.03, f = (yy) => uAt(hd, yy), tilt = (f(hy + 0.1) - f(hy - 0.1)) / 0.2;
    const at = (_, dy, dd, out) => [sg * (hu + (dy - hy) * tilt + out), dy, hd + dd];
    const nrm = unit([1, -tilt, 0]);
    const q = (a, b, d2, e2, tint, out) => quadF(I, at(0, a[0], a[1], out), at(0, b[0], b[1], out), at(0, d2[0], d2[1], out), at(0, e2[0], e2[1], out), [sg * nrm[0], nrm[1], 0], tint);
    q([hy - 0.9, -0.7], [hy - 0.9, 0.7], [hy + 0.9, 0.7], [hy + 0.9, -0.7], DARK, e);                // pocket
    q([hy - 0.8, -0.1], [hy - 0.8, 0.1], [hy + 0.7, 0.1], [hy + 0.7, -0.1], BLACK, e * 2.5);       // shank
    q([hy + 0.45, -0.45], [hy + 0.45, 0.45], [hy + 0.55, 0.45], [hy + 0.55, -0.45], BLACK, e * 2.5);  // stock
    q([hy - 0.85, -0.5], [hy - 0.85, 0.5], [hy - 0.55, 0.15], [hy - 0.55, -0.15], BLACK, e * 2.5);   // flukes
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k / 8) * 2 * Math.PI; return [hy + 1.0 + 0.3 * Math.cos(a), 0.3 * Math.sin(a)]; });
    for (let k = 0; k < 8; k++) triF(I, at(0, hy + 1.0, 0, e * 2), at(0, ring[k][0], ring[k][1], e * 2), at(0, ring[(k + 1) % 8][0], ring[(k + 1) % 8][1], e * 2), [sg * nrm[0], nrm[1], 0], DARK);
  }

  // ---- the hatches: coamings and cambered pontoon covers, and the crane between them ------------------------------
  const hatch = (d0, d1) => {
    const hw = 5.5, top = DECK_Y + 1.4, coam = shade(GREEN, 0.8);
    bx(P, -hw, hw, DECK_Y, top, d0, d1, coam, 'psaf');
    const panels = 4;
    for (let k = 0; k < panels; k++) {
      const a = d0 + ((d1 - d0) * k) / panels + 0.04, b = d0 + ((d1 - d0) * (k + 1)) / panels - 0.04, tint = shade(GREEN, k % 2 ? 0.92 : 1.06), cm = top + 0.14;
      quadF(P, [-hw + 0.1, top + 0.02, a], [0, cm, a], [0, cm, b], [-hw + 0.1, top + 0.02, b], [-0.2, 1, 0], tint);
      quadF(P, [0, cm, a], [hw - 0.1, top + 0.02, a], [hw - 0.1, top + 0.02, b], [0, cm, b], [0.2, 1, 0], tint);
      quadF(P, [-hw + 0.1, top, a], [-hw + 0.1, top + 0.02, a], [hw - 0.1, top + 0.02, a], [hw - 0.1, top, a], [0, 0, -1], tint);
      quadF(P, [-hw + 0.1, top, b], [-hw + 0.1, top + 0.02, b], [hw - 0.1, top + 0.02, b], [hw - 0.1, top, b], [0, 0, 1], tint);
    }
  };
  hatch(-27, -5); hatch(-1.5, 20.5);
  { // crane: pedestal, slewing house, jib resting on a crutch ahead of the forward hatch
    const cd = -3.25;
    cyl(P, 0, cd, DECK_Y, DECK_Y + 2.2, 1.15, 1.15, 14, WHITE_SLAB, WHITE_SLAB, 't');
    bx(P, -1.4, 1.4, DECK_Y + 2.2, DECK_Y + 4.3, cd - 1.6, cd + 1.5, WHITE_SLAB, 'psaft');
    bx(P, 0.4, 1.4, DECK_Y + 4.3, DECK_Y + 5.5, cd + 0.2, cd + 1.5, WHITE_SLAB, 'psaft');           // cab
    quadF(I, [0.4 - 0.01, DECK_Y + 4.6, cd + 0.4], [0.4 - 0.01, DECK_Y + 4.6, cd + 1.3], [0.4 - 0.01, DECK_Y + 5.3, cd + 1.3], [0.4 - 0.01, DECK_Y + 5.3, cd + 0.4], [-1, 0, 0], GLASS);
    bx(I, -1.0, 1.0, DECK_Y + 2.4, DECK_Y + 4.0, cd - 2.4, cd - 1.6, DARK, 'psaft');                  // counterweight
    const hinge = [0, 8.6, cd + 1.0], tip = [0, 6.55, 23.5], ax = unit(sub(tip, hinge)), side = [1, 0, 0], upv = unit(cross(side, ax));
    const J = (t, a, b) => { const w = 0.9 - 0.55 * t, h = 0.75 - 0.4 * t, base = [hinge[0] + (tip[0] - hinge[0]) * t, hinge[1] + (tip[1] - hinge[1]) * t, hinge[2] + (tip[2] - hinge[2]) * t]; return [base[0] + side[0] * a * w + upv[0] * b * h, base[1] + side[1] * a * w + upv[1] * b * h, base[2] + side[2] * a * w + upv[2] * b * h]; };
    for (const [t0, t1] of [[0, 0.5], [0.5, 1]]) {
      quadF(P, J(t0, -1, 1), J(t1, -1, 1), J(t1, 1, 1), J(t0, 1, 1), upv, WHITE_SLAB); quadF(P, J(t0, -1, -1), J(t1, -1, -1), J(t1, 1, -1), J(t0, 1, -1), [-upv[0], -upv[1], -upv[2]], WHITE_SLAB);
      quadF(P, J(t0, 1, -1), J(t1, 1, -1), J(t1, 1, 1), J(t0, 1, 1), [1, 0, 0], WHITE_SLAB); quadF(P, J(t0, -1, -1), J(t1, -1, -1), J(t1, -1, 1), J(t0, -1, 1), [-1, 0, 0], WHITE_SLAB);
    }
    quadF(P, J(1, -1, -1), J(1, 1, -1), J(1, 1, 1), J(1, -1, 1), ax, WHITE_SLAB); quadF(P, J(0, -1, -1), J(0, 1, -1), J(0, 1, 1), J(0, -1, 1), [-ax[0], -ax[1], -ax[2]], WHITE_SLAB);
    const peak = [0, DECK_Y + 7.4, cd - 0.6];                                                          // A-frame and the topping lift
    ribbon(R, peak, J(0.92, 0, 1), [1, 0, 0], 0.07, DARK); ribbon(R, peak, [0, DECK_Y + 4.3, cd - 1.4], [1, 0, 0], 0.09, DARK);
    for (const sg of [-1, 1]) { bx(I, sg * 0.45 - 0.07, sg * 0.45 + 0.07, DECK_Y, DECK_Y + 1.8, 23.0, 23.14, DARK, 'psaft'); bx(I, sg * 0.45 - 0.07, sg * 0.45 + 0.07, DECK_Y, DECK_Y + 1.8, 23.86, 24.0, DARK, 'psaft'); }
    bx(I, -0.6, 0.6, DECK_Y + 1.8, DECK_Y + 1.94, 22.9, 24.1, DARK, 'psaft');                         // the crutch's cradle
  }

  // ---- the superstructure: four decks of 2.7 m, 14 m long, white ---------------------------------------------------------
  const winSide = (sg, uWall, d0, d1, y0, n) => { const w = 1.0, step = (d1 - d0) / n; for (let k = 0; k < n; k++) { const a = d0 + step * (k + 0.5); quadF(I, [sg * (uWall + 0.03), y0, a - w / 2], [sg * (uWall + 0.03), y0, a + w / 2], [sg * (uWall + 0.03), y0 + 0.95, a + w / 2], [sg * (uWall + 0.03), y0 + 0.95, a - w / 2], [sg, 0, 0], GLASS); } };
  const winEnd = (sg, dWall, u0, u1, y0, n) => { const w = 1.0, step = (u1 - u0) / n; for (let k = 0; k < n; k++) { const a = u0 + step * (k + 0.5); quadF(I, [a - w / 2, y0, dWall + sg * 0.03], [a + w / 2, y0, dWall + sg * 0.03], [a + w / 2, y0 + 0.95, dWall + sg * 0.03], [a - w / 2, y0 + 0.95, dWall + sg * 0.03], [0, 0, sg], GLASS); } };
  const hwDeck = [6.3, 6.1, 5.9];
  for (let k = 0; k < 3; k++) {
    const y0 = DECK_Y + 2.7 * k, hw = hwDeck[k];
    bx(P, -hw, hw, y0, y0 + 2.58, HOUSE_AFT, HOUSE_FWD, WHITE, 'psaf');
    bx(P, -hw - 0.15, hw + 0.15, y0 + 2.58, y0 + 2.7, HOUSE_AFT - 0.15, HOUSE_FWD + 0.15, WHITE_SLAB, 'psaft');
    for (const sg of [-1, 1]) winSide(sg, hw, HOUSE_AFT + 1.4, HOUSE_FWD - 1.4, y0 + 1.0, 6);
    winEnd(1, HOUSE_FWD, -hw + 1.1, hw - 1.1, y0 + 1.0, 5); winEnd(-1, HOUSE_AFT, -hw + 1.1, hw - 1.1, y0 + 1.0, 5);
    if (k === 0) { for (const sg of [-1, 1]) quadF(I, [sg * (hw + 0.03), y0, HOUSE_AFT + 0.4], [sg * (hw + 0.03), y0, HOUSE_AFT + 1.3], [sg * (hw + 0.03), y0 + 1.9, HOUSE_AFT + 1.3], [sg * (hw + 0.03), y0 + 1.9, HOUSE_AFT + 0.4], [sg, 0, 0], DARK); }
  }
  { // the bridge deck: wheelhouse with a continuous band of windows, wings out to each side, a deck at 15 m
    const y0 = DECK_Y + 8.1, d0 = -37.5, d1 = HOUSE_FWD + 0.2, hw = 6.2;
    bx(P, -hw, hw, y0, y0 + 2.58, d0, d1, WHITE, 'psaf'); bx(P, -hw - 0.2, hw + 0.2, y0 + 2.58, y0 + 2.7, d0 - 0.2, d1 + 0.3, WHITE_SLAB, 'psaft');
    for (const sg of [-1, 1]) { quadF(I, [sg * (hw + 0.03), y0 + 0.9, d0 + 0.8], [sg * (hw + 0.03), y0 + 0.9, d1 - 0.8], [sg * (hw + 0.03), y0 + 1.95, d1 - 0.8], [sg * (hw + 0.03), y0 + 1.95, d0 + 0.8], [sg, 0, 0], GLASS); }
    quadF(I, [-hw + 0.5, y0 + 0.9, d1 + 0.03], [hw - 0.5, y0 + 0.9, d1 + 0.03], [hw - 0.5, y0 + 2.0, d1 + 0.03], [-hw + 0.5, y0 + 2.0, d1 + 0.03], [0, 0, 1], GLASS);
    quadF(I, [-hw + 0.5, y0 + 0.9, d0 - 0.03], [hw - 0.5, y0 + 0.9, d0 - 0.03], [hw - 0.5, y0 + 2.0, d0 - 0.03], [-hw + 0.5, y0 + 2.0, d0 - 0.03], [0, 0, -1], GLASS);
    for (const sg of [-1, 1]) {   // bridge wing: floor slab, a solid dodger, a door in the wheelhouse side
      const uo = 7.3, wd0 = d1 - 4.6, wd1 = d1 - 0.4;
      bx(P, sg < 0 ? -uo : hw, sg < 0 ? -hw : uo, y0 - 0.05, y0 + 0.1, wd0, wd1, WHITE_SLAB, 'psaftb');
      bx(P, sg < 0 ? -uo : uo - 0.1, sg < 0 ? -uo + 0.1 : uo, y0 + 0.1, y0 + 1.1, wd0, wd1, WHITE, 'psaf');
      bx(P, sg < 0 ? -uo : hw, sg < 0 ? -hw : uo, y0 + 1.0, y0 + 1.1, wd0, wd0 + 0.1, WHITE, 'psaf');
      bx(P, sg < 0 ? -uo : hw, sg < 0 ? -hw : uo, y0 + 1.0, y0 + 1.1, wd1 - 0.1, wd1, WHITE, 'psaf');
    }
    // monkey island: the wheelhouse roof, with a rail, a radar scanner, a mast and two aerials
    const top = y0 + 2.7;
    rail([[-hw - 0.1, d0 - 0.1], [hw + 0.1, d0 - 0.1], [hw + 0.1, d1 + 0.2], [-hw - 0.1, d1 + 0.2], [-hw - 0.1, d0 - 0.1]], top, 1.0, 2, WHITE);
    cyl(I, 0, -33.2, top, top + 10.5, 0.17, 0.17, 8, [0.5, 0.5, 0.48], [0.5, 0.5, 0.48], 't');
    bx(I, -2.4, 2.4, top + 7.0, top + 7.12, -33.35, -33.05, [0.5, 0.5, 0.48], 'psaft');            // yardarm
    cyl(I, 0, -35.0, top, top + 1.5, 0.22, 0.22, 8, DARK, DARK, 't'); bx(I, -1.35, 1.35, top + 1.5, top + 1.68, -35.12, -34.88, DARK, 'psaft'); bx(I, -1.35, -1.2, top + 1.68, top + 1.8, -35.12, -34.88, DARK, 'psaft');   // radar bar
    for (const [u, d, h] of [[-2.2, -34.0, 4.4], [2.6, -35.5, 3.6]]) cyl(I, u, d, top, top + h, 0.04, 0.04, 4, DARK, DARK, 't');
    const lamp = (u, h, d, tint) => bx(P, u - 0.11, u + 0.11, h, h + 0.22, d - 0.11, d + 0.11, tint, 'psaft');
    lamp(-7.3, y0 + 0.9, d1 - 0.8, [1, 0.02, 0.02]); lamp(7.3, y0 + 0.9, d1 - 0.8, [0.02, 0.9, 0.12]);   // red port, green starboard
    lamp(0, top + 10.5, -33.2, [1, 0.95, 0.8]); lamp(0, top + 6.9, -33.2, [1, 0.95, 0.8]); lamp(0, DECK_Y + 1.3, -47.3 + 0.2, [1, 0.95, 0.8]);
  }
  // the funnel: oval, 5 m tall, hull colour, plain black top
  cyl(P, 0, -40.0, DECK_Y + 8.1, DECK_Y + 13.1, 2.2, 2.4, 20, hullTint, BLACK, 't', DECK_Y + 12.3);
  cyl(P, 0, -40.0, DECK_Y + 8.1, DECK_Y + 8.4, 2.45, 2.7, 20, WHITE_SLAB, WHITE_SLAB, 't');
  // free-fall lifeboat on its ramp at the stern, bow down
  {
    const top = [0, 11.6, HOUSE_AFT - 0.2], bot = [0, 7.6, -48.6], ax = unit(sub(bot, top)), side = [1, 0, 0], nrm = unit(cross(side, ax)), q = (a, b, cc) => [top[0] + ax[0] * a + side[0] * b + nrm[0] * cc, top[1] + ax[1] * a + side[1] * b + nrm[1] * cc, top[2] + ax[2] * a + side[2] * b + nrm[2] * cc];
    for (const sg of [-1, 1]) { ribbon(I, q(0, sg * 0.9, 0), q(6.7, sg * 0.9, 0), nrm, 0.14, DARK); bx(I, sg * 1.0 - 0.09, sg * 1.0 + 0.09, DECK_Y, 7.55, -48.55, -48.35, DARK, 'psaft'); }
    for (let k = 0; k < 4; k++) ribbon(I, q(0.5 + k * 1.9, -1.0, 0), q(0.5 + k * 1.9, 1.0, 0), ax, 0.18, DARK);
    // boat: sections along the ramp, a keel at 0.3 above the rails, a round top, a pointed nose
    const sec = [[0.4, 0.9, 1.25], [1.4, 1.25, 1.75], [3.0, 1.25, 1.85], [4.6, 1.15, 1.7], [5.8, 0.7, 1.15], [6.4, 0.18, 0.5]];
    const prof = (w, h) => [[-w, 0.3], [-w, h * 0.45], [-w * 0.7, h * 0.85], [0, h], [w * 0.7, h * 0.85], [w, h * 0.45], [w, 0.3]];
    for (let i = 0; i + 1 < sec.length; i++) {
      const A = prof(sec[i][1], sec[i][2]), B = prof(sec[i + 1][1], sec[i + 1][2]);
      for (let k = 0; k + 1 < A.length; k++) {
        const pa = q(sec[i][0] + 0.45, A[k][0], A[k][1] + 0.1), pb = q(sec[i][0] + 0.45, A[k + 1][0], A[k + 1][1] + 0.1), pc = q(sec[i + 1][0] + 0.45, B[k + 1][0], B[k + 1][1] + 0.1), pd = q(sec[i + 1][0] + 0.45, B[k][0], B[k][1] + 0.1);
        const mid = q(sec[i][0] + 0.45, 0, 0.7);
        const cen = [(pa[0] + pb[0] + pc[0] + pd[0]) / 4, (pa[1] + pb[1] + pc[1] + pd[1]) / 4, (pa[2] + pb[2] + pc[2] + pd[2]) / 4];
        quadF(P, pa, pb, pc, pd, unit(sub(cen, mid)), ORANGE);
      }
    }
    const noseC = q(6.85, 0, 0.45); for (let k = 0; k + 1 < prof(0.18, 0.5).length; k++) { const A = prof(0.18, 0.5), pa = q(6.85, A[k][0], A[k][1] + 0.1), pb = q(6.85, A[k + 1][0], A[k + 1][1] + 0.1); triF(P, pa, pb, noseC, ax, ORANGE); }
    const tail = q(0.85, 0, 0.7); for (let k = 0; k + 1 < prof(0.9, 1.25).length; k++) { const A = prof(0.9, 1.25), pa = q(0.85, A[k][0], A[k][1] + 0.1), pb = q(0.85, A[k + 1][0], A[k + 1][1] + 0.1); triF(P, pa, pb, tail, [-ax[0], -ax[1], -ax[2]], ORANGE); }
    for (const sg of [-1, 1]) quadF(I, q(3.1, sg * 1.87, 1.05), q(4.1, sg * 1.80, 1.05), q(4.1, sg * 1.80, 1.5), q(3.1, sg * 1.87, 1.5), [sg, 0, 0], GLASS);
    rail([[-2.4, -45.4], [-2.4, -47.3], [2.4, -47.3], [2.4, -45.4]], DECK_Y, 1.0, 2, WHITE);
  }
  // aft bollards
  bollard(-(uAt(-45, DECK_Y) - 0.7), -45.0, DECK_Y); bollard(uAt(-45, DECK_Y) - 0.7, -45.0, DECK_Y); bollard(-6.4, -34.0, DECK_Y); bollard(6.4, -34.0, DECK_Y);

  // ---- mooring lines: four from the port side, out 3 m beyond the hull and down -----------------------------------------
  if (opts.moorings !== false) {
    const endY = (variant | 0) >= 3 ? Math.floor(variant / 3) : 0.3;
    for (const [bu, bd, by, run] of [[-(uAt(39.5, FORE_Y) - 0.8), 39.5, FORE_Y + 0.4, 6], [-(uAt(45, FORE_Y) - 0.7), 45, FORE_Y + 0.4, -14], [-(uAt(-45, DECK_Y) - 0.7), -45.0, DECK_Y + 0.4, -6], [-6.4, -34.0, DECK_Y + 0.4, 14]]) {
      const A = [bu, by, bd], E = [-10.5, endY, bd + run], len = Math.hypot(E[0] - A[0], E[2] - A[2]), dip = Math.min(1.4, 0.35 + len * 0.07), N = 8;
      const at = (t) => [A[0] + (E[0] - A[0]) * t, A[1] + (E[1] - A[1]) * t - dip * 4 * t * (1 - t) * (1 - 0.6 * t), A[2] + (E[2] - A[2]) * t];
      const ex = unit([E[0] - A[0], 0, E[2] - A[2]]);
      for (let k = 0; k < N; k++) { const a = at(k / N), b = at((k + 1) / N); ribbon(R, a, b, [0, 1, 0], 0.09, ROPE); ribbon(R, a, b, [-ex[2], 0, ex[0]], 0.09, ROPE); }
    }
  }
}

export const PROP_SHIP_CARGO = {
  collider: { hw: 7.5, hd: 47.5, h: 4.5, nav: true },
  big: { maxTriangles: 9000, below: SHIP.draft },    // the kit's generic checks (30 to 250 triangles, lowest point at y) are for street furniture
  build: (soups, x, y, z, yaw, variant) => buildShip(soups, x, y, z, yaw, variant),
};
