// Façade dressing: what hangs on and stands before the wall at the height of a person. Pure code, ITEM 5 / 8 of
// docs/plans/SCENE-DETAIL.md. Called by facade.js nearEdge once per storey, right after the openings of that storey.
//
//   dressEdge(soups, f, ctx)
//   dressingLook(b, style) -> { dr, hasBoxes, dcolors }
//
//   f     the edge's frame (soup.js frame): f.at(u, y, d) = u metres along the wall, y up, d metres OUT of the wall.
//   ctx   { ops, storey, y0, sh, len, front, shop, style, r, colors, groundY, hasBoxes }
//         hasBoxes: the house has window boxes (lk.hasBoxes);
//         ops: the storey's openings { kind: 'win' | 'shop' | 'door', u0, u1, ys, yh, big?, blind?, arc? };
//         storey: 0 is the ground storey; y0 its floor; front: the edge faces a street; shop: b.groundFloor === 1;
//         r: the building's own seeded stream (never the stream of facade.js `look`, so its choices do not move);
//         colors: { iron, sign, box, flowers }; groundY(u, d): the ground under that point of the wall.
//   Kinds (amounts are style.dressing.signs / lanterns / boxes / pots, a chance per candidate, 0 = none; the neutral
//         style draws nothing at all and does not even create a soup):
//         hanging sign (storey 0, on shops, or on doors of a house without a shop, one per 5 m at most),
//         wall lantern (storey 0, by a door), window box (storey 1, a house has them all or none), pots with a
//         small conifer flanking a door (storey 0).
//   Only on front edges. Nothing lettered: a sign is a plain board.
//   DECISION: no collider for any of it. Everything stays within 0.45 m of the wall except the sign, which hangs
//         above head height (lowest point 2.2 m over the floor); a collider would only make the street narrower.
//   Must not  draw behind the wall plane (d < 0), read the DOM or three.js, or keep state between calls.
//   Budget    sign <= 60 triangles, lantern <= 40, window box <= 90, pot <= 40.
import { tri, triN, slab, box, shade, rng } from './soup.js';
import { SOUP, paletteColor, parseColor } from './style.js';

const IRON = [0.02, 0.02, 0.022], POT = [0.03, 0.03, 0.032], GREEN = [0.13, 0.26, 0.08], CONIFER = [0.07, 0.17, 0.07];
const LEAVES = SOUP.leaves + 'v'; // the tinted form, as trees.js uses it ('leaves|tv')
const FLOWERS = ['#c8323c', '#d9507a', '#e8c23a', '#f2f0ea'];

/** The seeded part of a building's dressing: its own stream, whether it has window boxes, its colours. */
export function dressingLook(b, style) {
  const dr = rng(((b.id | 0) ^ 0x2f6b1d93) >>> 0), dz = style.dressing || {}, fl = Array.isArray(dz.flowers) && dz.flowers.length ? dz.flowers : FLOWERS;
  const hasBoxes = dr() < (dz.boxes || 0), k = dr.int(Math.max(1, (style.awnings || []).length)), k2 = dr.int(Math.max(1, (style.doors || []).length)), k3 = dr.int(fl.length);
  return { dr, hasBoxes, dcolors: { iron: IRON, sign: paletteColor(style.awnings, k), box: paletteColor(style.doors, k2), flowers: parseColor(fl[k3]) || [0.8, 0.8, 0.8] } };
}

/** A triangle facing the side `hint` ([x, y, z]) whatever order the points came in. */
function facing(s, a, b, c, tint, hint) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const d = (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2];
  if (d >= 0) tri(s, a, b, c, tint); else tri(s, a, c, b, tint);
}
/** A convex polygon as a fan, facing `hint`. */
function poly(s, pts, tint, hint) { for (let i = 1; i + 1 < pts.length; i++) facing(s, pts[0], pts[i], pts[i + 1], tint, hint); }
/** The triangles of a convex solid, each turned to face away from `c`. */
function solid(s, tris, c, tint) {
  for (const [a, b, d] of tris) { const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]; facing(s, a, b, d, tint, m); }
}

// ---- hanging sign ---------------------------------------------------------------------------------------------------
function hangingSign(soups, f, u, y0, r, colors) {
  const I = soups.get(SOUP.iron), T = soups.get(SOUP.trim), yb = y0 + 2.75, h = 0.015, hl = [-f.ex, 0, -f.ez], hr = [f.ex, 0, f.ez];
  slab(I, f, u - h, u + h, yb - h, yb + h, 0.02, 0.85, colors.iron, 'flrtb');
  // the brace: a ribbon in the plane of the bracket, seen from both sides
  const P = (d, y) => f.at(u, y, d), br = [P(0.02, y0 + 2.45), P(0.55, yb - h), P(0.55, yb - h + 0.03), P(0.02, y0 + 2.48)];
  poly(I, br, colors.iron, hl); poly(I, br, colors.iron, hr);
  // the board hangs under the bar, its faces across the street so a walker sees them
  const top = yb - h - 0.005, bot = top - 0.45, edge = shade(colors.sign, 0.55), t = 0.015, w = 0.03;
  if (r() < 0.6) {
    slab(T, f, u - t, u + t, bot, top, 0.2, 0.8, colors.sign, 'tbf');
    for (const [side, hint] of [[-1, hl], [1, hr]]) {
      const U = (e) => u + side * (t + e), face = (d0, d1, y0_, y1_, e, col) => poly(T, [f.at(U(e), y0_, d0), f.at(U(e), y0_, d1), f.at(U(e), y1_, d1), f.at(U(e), y1_, d0)], col, hint);
      face(0.2, 0.8, bot, top, 0, colors.sign);
      face(0.2, 0.8, top - w, top, 0.002, edge); face(0.2, 0.8, bot, bot + w, 0.002, edge); face(0.2, 0.2 + w, bot + w, top - w, 0.002, edge); face(0.8 - w, 0.8, bot + w, top - w, 0.002, edge);
    }
  } else {
    const cd = 0.5, cy = (top + bot) / 2, oct = (k, e, rx, ry) => { const a = ((k + 0.5) / 8) * Math.PI * 2; return [cd + Math.cos(a) * rx, cy + Math.sin(a) * ry]; };
    for (const [side, hint] of [[-1, hl], [1, hr]]) {
      for (const [e, rx, ry, col] of [[0.002, 0.3, 0.225, edge], [0.004, 0.27, 0.195, colors.sign]]) for (let k = 0; k < 8; k++) {
        const a = oct(k, e, rx, ry), b = oct(k + 1, e, rx, ry), U = u + side * (t + e);
        facing(T, f.at(U, cy, cd), f.at(U, a[1], a[0]), f.at(U, b[1], b[0]), col, hint);
      }
    }
  }
}

// ---- wall lantern -----------------------------------------------------------------------------------------------------
function lantern(soups, f, u, y0, colors) {
  const I = soups.get(SOUP.iron), G = soups.get(SOUP.lampGlass), h = 0.015, ya = y0 + 2.25;
  slab(I, f, u - h, u + h, ya - h, ya + h, 0.02, 0.22, colors.iron, 'flrtb');
  const c = f.at(u, 0, 0.2), cx = c[0], cz = c[2], yc = y0 + 2.135, ycap = yc + 0.1; // cap base, cap tip: the tip meets the arm
  box(I, cx, cz, f.ex, f.ez, 0.09, 0.09, y0 + 1.905, y0 + 1.935, colors.iron, true);
  box(G, cx, cz, f.ex, f.ez, 0.07, 0.07, y0 + 1.935, yc, [1, 0.85, 0.55], false);
  const corner = (a, b) => [cx + f.ex * a + f.nx * b, yc, cz + f.ez * a + f.nz * b], k = [corner(-0.1, -0.1), corner(0.1, -0.1), corner(0.1, 0.1), corner(-0.1, 0.1)], apex = [cx, ycap, cz];
  solid(I, k.map((p, i) => [p, k[(i + 1) % 4], apex]), [cx, yc - 0.05, cz], colors.iron);
}

// ---- window box -------------------------------------------------------------------------------------------------------
function windowBox(soups, f, o, r, colors) {
  const W = soups.get(SOUP.timber), L = soups.get(LEAVES), T = soups.get(SOUP.trim), top = o.ys - 0.02;
  slab(W, f, o.u0 - 0.05, o.u1 + 0.05, top - 0.18, top, 0, 0.2, colors.box, 'flrtb');
  slab(L, f, o.u0 - 0.03, o.u1 + 0.03, top, top + 0.14, 0.02, 0.18, GREEN, 'flrt');
  const n = 5 + r.int(3), s = 0.07;
  for (let i = 0; i < n; i++) {
    const u = o.u0 + 0.02 + (o.u1 - o.u0 - 0.04) * r(), d = 0.04 + 0.19 * r(), y = top + 0.08 + 0.06 * r();
    slab(T, f, u - s / 2, u + s / 2, y, y + s, d - s / 2, d + s / 2, colors.flowers, 'flrt');
  }
}

// ---- door pot with a conifer ------------------------------------------------------------------------------------------
function pot(soups, f, u, gy) {
  const I = soups.get(SOUP.iron), L = soups.get(LEAVES), d0 = 0.24, P = (du, dd, y) => f.at(u + du, y, d0 + dd), yt = gy + 0.36, hb = 0.14, ht = 0.17;
  const bot = [[-hb, -hb], [hb, -hb], [hb, hb], [-hb, hb]].map(([a, b]) => P(a, b, gy)), top = [[-ht, -ht], [ht, -ht], [ht, ht], [-ht, ht]].map(([a, b]) => P(a, b, yt));
  const tris = []; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; tris.push([bot[i], bot[j], top[j]], [bot[i], top[j], top[i]]); }
  tris.push([top[0], top[1], top[2]], [top[0], top[2], top[3]]);
  solid(I, tris, P(0, 0, gy + 0.18), POT);
  // the conifer: six sides, smooth normals, base radius 0.17, 0.85 high
  const apex = P(0, 0, yt - 0.02 + 0.85), ring = [], base = P(0, 0, yt - 0.02);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ring.push(P(0.17 * Math.cos(a), 0.17 * Math.sin(a), yt - 0.02)); }
  const nrm = (p) => { const x = p[0] - base[0], z = p[2] - base[2], l = Math.hypot(x, z) || 1, k = 0.4, m = Math.hypot(x / l, k, z / l); return [x / l / m, k / m, z / l / m]; }, up = [0, 1, 0];
  for (let i = 0; i < 6; i++) {
    let a = ring[i], b = ring[(i + 1) % 6], na = nrm(a), nb = nrm(b);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = apex[0] - a[0], vy = apex[1] - a[1], vz = apex[2] - a[2];
    const mx = (na[0] + nb[0]) / 2, mz = (na[2] + nb[2]) / 2, face = (uy * vz - uz * vy) * mx + (uz * vx - ux * vz) * 0.4 + (ux * vy - uy * vx) * mz;
    if (face < 0) { [a, b] = [b, a]; [na, nb] = [nb, na]; }
    triN(L, a, b, apex, na, nb, up, CONIFER);
  }
}

// ---- the edge ---------------------------------------------------------------------------------------------------------
function free(ops, u0, u1, except) { return !ops.some((o) => o !== except && u0 < o.u1 && u1 > o.u0); }

export function dressEdge(soups, f, ctx) {
  const { ops, storey, y0, len, front, shop, style, r, colors } = ctx, dz = style.dressing;
  if (!front || !dz || !r || !ops.length) return;
  if (storey === 0) {
    if (dz.signs > 0) {
      let last = -1e9;
      for (const o of ops) {
        if (o.kind !== (shop ? 'shop' : 'door')) continue;
        if (!(r() < dz.signs)) continue;
        const u = Math.min(len - 0.4, Math.max(0.4, o.u0 - 0.25));
        if (u - last < 5) continue;
        last = u; hangingSign(soups, f, u, y0, r, colors);
      }
    }
    for (const o of ops) {
      if (o.kind !== 'door') continue;
      if (dz.lanterns > 0 && r() < dz.lanterns) {
        const right = r() < 0.5, side = (rt) => Math.min(len - 0.3, Math.max(0.3, rt ? o.u1 + 0.3 : o.u0 - 0.3)), jamb = (rt) => (rt ? o.u1 : o.u0);
        const rt = [right, !right].find((q) => free(ops, side(q) - 0.1, side(q) + 0.1, o) && Math.abs(side(q) - jamb(q)) <= 0.5);
        if (rt !== undefined) lantern(soups, f, side(rt), y0, colors);
      }
      if (dz.pots > 0 && !o.big && r() < dz.pots) for (const u of [o.u0 - 0.35, o.u1 + 0.35]) {
        if (u < 0.3 || u > len - 0.3 || !free(ops, u - 0.17, u + 0.17, o)) continue;
        pot(soups, f, u, ctx.groundY(u, 0.24));
      }
    }
  } else if (storey === 1 && ctx.hasBoxes) {
    for (const o of ops) if (o.kind === 'win' && !o.blind && !o.arc) windowBox(soups, f, o, r, colors);
  }
}
