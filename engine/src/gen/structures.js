// Walls and barriers: fortifications, retaining walls, garden walls, fences and rails. Pure code.
// OWNED BY ITEM 7 of docs/plans/SCENE-DETAIL.md. A wall is cut into runs of at most 6 m so its top steps with the ground;
// a wall that holds ground back stands `parapet` above the higher side; crenels and posts are placed by s0 + distance.
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   wallRings(wall, groundAt) -> [{ ring, yBase, yTop }, …]
//   wall(soups, wall, groundAt, style)
//
//   wall      a decoded wall PIECE (scene/source.js): the part of a mapped line inside one cell of 62.5 m, cut
//             exactly at the cell's edge. pts (flat [x, z, …], game metres), cls (4.4 enum: 1 city_wall
//             2 retaining_wall 3 wall 4 fence 5 hedge 6 guard_rail), kind (the source's word), height (metres above
//             the ground, used when parapet is null), parapet (null, or metres the top stands above the HIGHER
//             ground beside the wall: a wall that holds ground back), thickness (metres), material (façade enum
//             4.2), crenels (boolean), rail (null, or a prop kind of props.js: draw posts and rails, not a solid),
//             s0 (metres along the whole mapped line at which this piece starts) and len (the whole line's length):
//             anything that repeats along a wall (merlons, posts) is placed by s0 + distance, so two pieces meet in step.
//   groundAt  (x, z) -> ground height in metres, sidewalks included. Always a number.
//   wallRings what the wall is as solids: quad rings (flat [x, z, …], 4 vertices, either winding) each solid from
//             yBase (below the lowest ground under it) to yTop. scene/install.js makes one collision prism per ring
//             (a rail collides as its thin ring too), and wall() must draw the same rings: what is drawn is what
//             collides. Rings of one piece may overlap at corners; they must not reach more than the thickness beyond
//             the piece's ends.
//   wall      draws the piece: the rings as prisms with a top, crenels and coping when `crenels`; when `rail` is set,
//             posts and rails from PROP_KIT[rail] instead of prisms.
//   Soups     STRUCTURE_SOUP[wall.material] (style.js), triplanar, not tinted. Rails: SOUP.iron.
//   Winding   counter-clockwise seen from outside the solid.
//   Groups    solid walls -> `base` (seen from far away); a wall with `rail` -> `near`. The mesher decides by `rail`.
//   Budget    walls and gates <= 40 000 triangles a scene.
//   Must not  read the DOM or three.js, or return a ring the drawing does not show.
import { prism, box, quad } from './soup.js';
import { STRUCTURE_SOUP, SOUP } from './style.js';

const RUN = 6;            // m: the longest run one solid covers, so tops follow the ground
const MERLON = { length: 1.1, height: 0.7, thick: 0.5, period: 2.2 };
const IRON = [0.035, 0.037, 0.04];   // linear: dark wrought iron
const POST = { every: 2, size: 0.06, rails: [0.45, 0.92] };   // rails at these fractions of the height

/**
 * The runs of a piece: each a quad ring along one segment (at most 6 m), with its axis, its place along the whole
 * mapped line and its top. Lengthened by half the thickness at the ends of a segment so corners close.
 */
function runsOf(wall, groundAt) {
  const out = [], t = wall.thickness, pts = wall.pts, held = wall.parapet != null;
  let g = wall.s0 || 0;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l, nx = -uz, nz = ux, n = Math.ceil(l / RUN), h = t / 2;
    for (let k = 0; k < n; k++) {
      const d0 = (l * k) / n, d1 = (l * (k + 1)) / n, e0 = k === 0 ? h : 0, e1 = k === n - 1 ? h : 0;
      const x0 = ax + ux * (d0 - e0), z0 = az + uz * (d0 - e0), x1 = ax + ux * (d1 + e1), z1 = az + uz * (d1 + e1);
      const ring = [x0 + nx * h, z0 + nz * h, x1 + nx * h, z1 + nz * h, x1 - nx * h, z1 - nz * h, x0 - nx * h, z0 - nz * h];
      let lo = Infinity, hi = -Infinity;
      const sample = (x, z) => { const y = groundAt(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); };
      for (let i = 0; i < 8; i += 2) sample(ring[i], ring[i + 1]);
      sample((ring[0] + ring[2]) / 2, (ring[1] + ring[3]) / 2); sample((ring[4] + ring[6]) / 2, (ring[5] + ring[7]) / 2);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, yTop = hi + (held ? wall.parapet : wall.height);
      // the side the ground falls to: the crenels stand on that edge only (the other edge is the walk behind the parapet; one edge halves the triangles of a free-standing wall)
      const ls = groundAt(mx + nx * (h + 1), mz + nz * (h + 1)), rs = groundAt(mx - nx * (h + 1), mz - nz * (h + 1));
      const side = ls < rs ? 1 : -1;
      out.push({ ring, yBase: lo - 1, yTop, ax: ax + ux * d0, az: az + uz * d0, ux, uz, nx, nz, len: d1 - d0, g0: g + d0, side, seg: p, segG0: g, segG1: g + l });
    }
    g += l;
  }
  return out;
}

/** A polyline with a thickness, as one quad ring per segment, each lengthened by half the thickness so corners close (kept for scene/source.js). */
export function lineToRings(pts, thickness) {
  const out = [], t = thickness / 2;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const nx = (-(bz - az) / l) * t, nz = ((bx - ax) / l) * t, ex = ((bx - ax) / l) * t, ez = ((bz - az) / l) * t;
    out.push([ax - ex + nx, az - ez + nz, bx + ex + nx, bz + ez + nz, bx + ex - nx, bz + ez - nz, ax - ex - nx, az - ez - nz]);
  }
  return out;
}

/** What the wall is as solids (collision, and what wall() draws): one { ring, yBase, yTop } per run. */
export function wallRings(wall, groundAt) { return runsOf(wall, groundAt).map(({ ring, yBase, yTop }) => ({ ring, yBase, yTop })); }

/**
 * The merlons of a piece, in step with the whole mapped line (period 2.2 m counted from s0). A merlon belongs to the run
 * its middle is over and stands on the lower of the tops it overlaps (it never floats); it is cut at the end of its
 * segment and of the piece, so two pieces draw the halves of one merlon.
 */
function merlonsOf(runs, wall) {
  const { length, height, thick, period } = MERLON, th = Math.min(thick, wall.thickness), off = wall.thickness / 2 - th / 2, out = [];
  const bySeg = new Map(); for (const r of runs) { if (!bySeg.has(r.seg)) bySeg.set(r.seg, []); bySeg.get(r.seg).push(r); }
  for (const rs of bySeg.values()) {
    const { segG0, segG1 } = rs[0];
    for (let k = Math.floor((segG0 - length) / period); ; k++) {
      const a = period * k + (period - length) / 2, b = a + length;
      if (a >= segG1 - 1e-6) break;
      const lo = Math.max(a, segG0), hi = Math.min(b, segG1);
      if (hi - lo < 0.02) continue;
      const centre = (a + b) / 2, home = rs.find((r) => centre >= r.g0 && centre < r.g0 + r.len + 1e-9) || (centre < segG0 ? rs[0] : rs[rs.length - 1]);
      const y0 = Math.min(...rs.filter((r) => r.g0 < hi && r.g0 + r.len > lo).map((r) => r.yTop), home.yTop), mid = (lo + hi) / 2 - home.g0;
      for (const side of [home.side]) out.push({ cx: home.ax + home.ux * mid + home.nx * off * side, cz: home.az + home.uz * mid + home.nz * off * side, ux: home.ux, uz: home.uz, hu: (hi - lo) / 2, hd: th / 2, y0, y1: home.yTop + height });
    }
  }
  return out;
}
/** Every merlon of a crenellated piece (empty when the wall has no crenels): the boxes wall() draws. */
export function merlons(wall, groundAt) { return wall.crenels && !wall.rail ? merlonsOf(runsOf(wall, groundAt), wall) : []; }

/** A square bar from A to B (3D points), `w` across: the sides only, wound outwards. */
function bar(s, A, B, w, tint) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
  const at = (P, sx, sy) => [P[0] + nx * sx, P[1] + sy * w / 2, P[2] + nz * sx];
  const c = (P) => [at(P, -1, -1), at(P, 1, -1), at(P, 1, 1), at(P, -1, 1)];
  const a = c(A), b = c(B);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(s, a[i], b[i], b[j], a[j], tint); }
  quad(s, a[3], a[2], a[1], a[0], tint); quad(s, b[0], b[1], b[2], b[3], tint);
}

/** Posts every 2 m by s0 + distance, and two rails between them that follow the ground. */
function rail(s, wall, groundAt) {
  const pts = wall.pts, H = wall.height, w = POST.size;
  let g = wall.s0 || 0;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l, at = (d) => [ax + ux * d, az + uz * d];
    // post positions along this segment, and the segment's own ends so rails reach the corners
    const first = Math.ceil((g - 1e-9) / POST.every) * POST.every, stops = [0];
    for (let q = first; q < g + l - 1e-6; q += POST.every) if (q - g > 1e-6) stops.push(q - g);
    stops.push(l);
    const post = (d) => { const [x, z] = at(d); box(s, x, z, ux, uz, w / 2, w / 2, groundAt(x, z) - 0.05, groundAt(x, z) + H, IRON, true); };
    for (const d of stops) if (d > 1e-6 && d < l - 1e-6 || d === 0 || d === l) post(d);
    for (let i = 0; i + 1 < stops.length; i++) {
      const [x0, z0] = at(stops[i]), [x1, z1] = at(stops[i + 1]), y0 = groundAt(x0, z0), y1 = groundAt(x1, z1);
      for (const f of POST.rails) bar(s, [x0, y0 + H * f, z0], [x1, y1 + H * f, z1], w * 0.8, IRON);
    }
    g += l;
  }
}

const BALUSTER = { every: 0.14, size: 0.03, post: 2.4, postSize: 0.16, topRail: 0.1 };
/** A cast-iron balustrade: a post with a ball every 2.4 m, a top rail, a foot rail and square balusters every 0.15 m, all by s0 + distance. */
function balustrade(s, wall, groundAt) {
  const pts = wall.pts, H = wall.height, B = BALUSTER;
  let g = wall.s0 || 0;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l, at = (d) => [ax + ux * d, az + uz * d];
    for (let q = Math.ceil((g - 1e-9) / B.post) * B.post; q < g + l + 1e-9; q += B.post) { // posts
      const [x, z] = at(Math.min(l, Math.max(0, q - g))), y = groundAt(x, z);
      box(s, x, z, ux, uz, B.postSize / 2, B.postSize / 2, y - 0.05, y + H, IRON, true); box(s, x, z, ux, uz, B.postSize * 0.75, B.postSize * 0.75, y + H, y + H + 0.1, IRON, true);
      box(s, x, z, ux, uz, B.postSize * 0.5, B.postSize * 0.5, y + H + 0.1, y + H + 0.22, IRON, true);
    }
    const n = Math.max(1, Math.ceil(l / 3)), segLen = l / n;
    for (let i = 0; i < n; i++) { // rails follow the ground in pieces of about 3 m
      const [x0, z0] = at(i * segLen), [x1, z1] = at((i + 1) * segLen), y0 = groundAt(x0, z0), y1 = groundAt(x1, z1);
      bar(s, [x0, y0 + H - 0.06, z0], [x1, y1 + H - 0.06, z1], B.topRail, IRON); bar(s, [x0, y0 + 0.14, z0], [x1, y1 + 0.14, z1], 0.07, IRON);
      bar(s, [x0, y0 + 0.3, z0], [x1, y1 + 0.3, z1], 0.16, IRON);   // the kick plate: a solid band that reads at a distance
    }
    for (let q = Math.ceil((g - 1e-9) / B.every) * B.every; q < g + l; q += B.every) { // balusters
      const [x, z] = at(q - g), y = groundAt(x, z), t = B.size / 2;
      box(s, x, z, ux, uz, t, t, y + 0.16, y + H - 0.08, IRON, false);
    }
    g += l;
  }
}

export function wall(soups, wall, groundAt, style) { // eslint-disable-line no-unused-vars
  if (wall.rail === 'balustrade_iron') { balustrade(soups.get(SOUP.iron), wall, groundAt); return; }
  if (wall.rail) { rail(soups.get(SOUP.iron), wall, groundAt); return; }
  const s = soups.get(STRUCTURE_SOUP[wall.material] || STRUCTURE_SOUP[1]);
  const runs = runsOf(wall, groundAt);
  for (const r of runs) prism(s, r.ring, r.yBase, r.yTop, null, true);
  if (wall.crenels) for (const m of merlonsOf(runs, wall)) box(s, m.cx, m.cz, m.ux, m.uz, m.hu, m.hd, m.y0, m.y1, null, true);
}
