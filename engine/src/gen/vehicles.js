// Parked vehicles for the prop kit (gen/props.js registers them): car_hatch, car_sedan, car_suv, van_delivery, bicycle.
// Pure code, our own shapes: generic bodies with no maker's grille, badge or plate text.
//
// A car body is a LOFT: a handful of stations along the length, each a cross-section ring (sill, lower side, shoulder, roof
// edge, roof crown, and the mirror image), so the bonnet, the raked windscreen, the roof and the tail come from one side
// profile swept across the width with tumblehome (the glass leans in) and rounded corners in plan (a narrower first and last
// station). Wheel arches are dark discs on the side wall with the wheel standing in front of them; glass is dark quads laid
// on the greenhouse; lamps, bumpers, a blank plate rectangle and door seams are small quads and boxes.
//
// Frame of a prop (props.js header): right hand u, up y, facing d (the nose). Soups: the body in SOUP.trim, tinted by the paint
// (variant, index into PAINT; the library has no painted-metal material: steel is tinted dark iron, and a white car would be
// grey, so the smooth tinted render stands in), glass, tyres, bumpers and lamps in SOUP.iron with vertex colours. The bicycle's thin quads are drawn from both sides
// (the iron material with the `d` flag).
import { box, fan, linear, shade } from './soup.js';
import { SOUP } from './style.js';

/** Muted body paints, sRGB: white, silver, graphite, black, dark blue, burgundy, forest green, sand. */
export const PAINT = ['#d9d8d2', '#a9adb0', '#46494d', '#1d1e20', '#22365a', '#5b2230', '#27442f', '#b9a57f'].map((h) => linear(h));
const VAN_PAINT = ['#dcdbd6', '#cfd0cd', '#aeb1b3', '#8b8e90'].map((h) => linear(h));
const GLASS = linear('#161b20'), TYRE = linear('#151515'), HUB = shade(linear('#8d9094'), 4), DARK = linear('#232527'), PLATE = shade(linear('#b4b2a6'), 4);
const LAMP_W = shade(linear('#e6e2cf'), 5), LAMP_A = shade(linear('#d08a1c'), 5), LAMP_R = shade(linear('#a01616'), 4), SEAM = linear('#26282a');
export const VEHICLE_KINDS = ['car_hatch', 'car_sedan', 'car_suv', 'van_delivery', 'bicycle'];
// the body in SOUP.trim (smooth tinted render: SOUP.tread, which casts a shadow, shows its paving joints on a car's flanks); it casts no shadow,
// so a dark quad under the car stands in for the contact shadow
const BODY_SOUP = SOUP.trim, IRON_SOUP = SOUP.iron;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** A convex polygon facing `out` (flipped when its winding says otherwise), pushed `off` metres along its own normal. */
export function face(s, pts, out, tint, off = 0) {
  let n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
  n = norm(n); if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { n = [-n[0], -n[1], -n[2]]; pts = pts.slice().reverse(); }
  if (off) pts = pts.map((p) => [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]);
  fan(s, pts, tint);
}

/** A prop's frame: P(u, y, d) is the world point u to the right, y above the ground, d ahead of the plan point. */
export function frameOf(x, y0, z, yaw) {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return { P: (u, y, d) => [x + rx * u + fx * d, y0 + y, z + rz * u + fz * d], right: [rx, 0, rz], fwd: [fx, 0, fz], x, z, rx, rz, fx, fz };
}
const lerp = (a, b, k) => a + (b - a) * k;

// ---- the cars ---------------------------------------------------------------------------------------------------
// Station: [t along the length (0 tail .. 1 nose), plan width factor, shoulder height, top-centre height, roof-edge width factor].
// Windows: polygons of [t, f] on the greenhouse side (f 0 at the shoulder, 1 at the roof edge). Screens: [t of the roof-side edge,
// t of the cowl-side edge] of the windscreen and the rear window.
const CARS = {
  car_hatch: {
    L: 4.0, W: 1.75, H: 1.5, wr: 0.30, wb: 2.5, sill: 0.17, paint: PAINT, mirrorT: 0.62, seams: [0.43, 0.56], lampY: [0.5, 0.6], tailY: [0.58, 0.7],
    st: [[0, 0.84, 0.70, 0.90, 0.90], [0.03, 0.96, 0.84, 0.95, 0.88], [0.215, 1, 0.92, 1.44, 0.74], [0.42, 1, 0.93, 1.48, 0.76], [0.54, 1, 0.93, 1.47, 0.76], [0.62, 1, 0.94, 1.24, 0.80],
      [0.70, 1, 0.95, 0.99, 0.88], [0.93, 0.98, 0.86, 0.90, 0.88], [0.985, 0.92, 0.76, 0.82, 0.88], [1, 0.84, 0.64, 0.72, 0.90]],
    win: [[[0.20, 0.12], [0.40, 0.12], [0.40, 0.88], [0.235, 0.9]], [[0.445, 0.12], [0.62, 0.14], [0.54, 0.88], [0.445, 0.88]]],
    wind: [0.54, 0.70], rear: [0.215, 0.03],
  },
  car_sedan: {
    L: 4.6, W: 1.8, H: 1.45, wr: 0.31, wb: 2.7, sill: 0.17, paint: PAINT, mirrorT: 0.65, seams: [0.45, 0.58], lampY: [0.5, 0.6], tailY: [0.58, 0.7],
    st: [[0, 0.86, 0.74, 0.90, 0.90], [0.03, 0.97, 0.88, 0.96, 0.88], [0.215, 1, 0.93, 0.97, 0.87], [0.30, 1, 0.93, 1.41, 0.72], [0.5, 1, 0.94, 1.42, 0.74], [0.60, 1, 0.94, 1.40, 0.74],
      [0.655, 1, 0.945, 1.20, 0.80], [0.715, 1, 0.95, 0.99, 0.88], [0.935, 0.98, 0.86, 0.90, 0.88], [0.985, 0.92, 0.76, 0.82, 0.88], [1, 0.84, 0.64, 0.72, 0.90]],
    win: [[[0.32, 0.12], [0.485, 0.12], [0.485, 0.88], [0.31, 0.88]], [[0.515, 0.12], [0.655, 0.14], [0.60, 0.88], [0.515, 0.88]]],
    wind: [0.60, 0.715], rear: [0.30, 0.215],
  },
  car_suv: {
    L: 4.5, W: 1.85, H: 1.7, wr: 0.34, wb: 2.7, sill: 0.22, paint: PAINT, mirrorT: 0.70, seams: [0.36, 0.52], lampY: [0.6, 0.72], tailY: [0.85, 1.0],
    st: [[0, 0.88, 0.95, 1.30, 0.90], [0.025, 0.98, 1.0, 1.38, 0.88], [0.15, 1, 1.02, 1.66, 0.78], [0.38, 1, 1.03, 1.68, 0.80], [0.56, 1, 1.03, 1.67, 0.80], [0.63, 1, 1.03, 1.40, 0.84],
      [0.70, 1, 1.02, 1.08, 0.90], [0.93, 1, 0.98, 1.03, 0.90], [0.985, 0.94, 0.86, 0.95, 0.90], [1, 0.86, 0.70, 0.85, 0.90]],
    win: [[[0.16, 0.12], [0.36, 0.12], [0.36, 0.9], [0.17, 0.9]], [[0.40, 0.12], [0.63, 0.14], [0.56, 0.9], [0.40, 0.9]]],
    wind: [0.56, 0.70], rear: [0.15, 0.025],
  },
  van_delivery: {
    L: 5.4, W: 2.0, H: 2.4, wr: 0.33, wb: 3.4, sill: 0.25, paint: VAN_PAINT, mirrorT: 0.85, seams: [0.70, 0.76], lampY: [0.62, 0.78], tailY: [1.0, 1.15], cargo: 0.685,
    st: [[0, 0.94, 2.25, 2.35, 0.95], [0.015, 1, 2.25, 2.38, 0.96], [0.685, 1, 2.25, 2.38, 0.96], [0.69, 1, 1.38, 2.38, 0.86], [0.84, 1, 1.40, 2.36, 0.84], [0.95, 1, 1.25, 1.30, 0.92],
      [0.99, 0.94, 1.0, 1.12, 0.92], [1, 0.86, 0.72, 0.92, 0.92]],
    win: [[[0.71, 0.12], [0.90, 0.12], [0.84, 0.88], [0.71, 0.88]]],
    wind: [0.84, 0.95], rear: null,
  },
};

function station(spec, t) {
  const st = spec.st; let i = 0; while (i + 2 < st.length && st[i + 1][0] <= t) i++;
  const a = st[i], b = st[i + 1], k = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
  return [t, lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k), lerp(a[4], b[4], k)];
}

function buildCar(spec, soups, x, y, z, yaw, variant) {
  const F = frameOf(x, y, z, yaw), P = F.P, B = soups.get(BODY_SOUP), I = soups.get(IRON_SOUP), hwMax = spec.W / 2 - 0.065, Lb = spec.L - 0.08;
  const paint = spec.paint[((variant | 0) % spec.paint.length + spec.paint.length) % spec.paint.length];
  const dOf = (t) => (t - 0.5) * Lb, hwOf = (s) => hwMax * s[1];
  // ring of a station as [u, y] pairs, right side first (sill up over the roof), then the left side coming down
  const half = (s) => { const hw = hwOf(s); return [[0.935 * hw, spec.sill], [hw, spec.sill + 0.22], [hw, s[2]], [hw * s[4], s[3] - 0.03], [0, s[3] + 0.02]]; };
  const ring = (s) => { const h = half(s), m = h.slice(0, 4).reverse().map(([u, yy]) => [-u, yy]); return h.concat(m); };
  const stations = spec.st.map((s) => s.slice()), rings = stations.map(ring);
  // the body: quads between stations, counter-clockwise seen from outside
  for (let i = 0; i + 1 < stations.length; i++) {
    const da = dOf(stations[i][0]), db = dOf(stations[i + 1][0]), ra = rings[i], rb = rings[i + 1];
    for (let j = 0; j + 1 < ra.length; j++) {
      const A = P(ra[j][0], ra[j][1], da), Bp = P(rb[j][0], rb[j][1], db), C = P(rb[j + 1][0], rb[j + 1][1], db), D = P(ra[j + 1][0], ra[j + 1][1], da);
      fan(B, [A, Bp, C, D], paint);
    }
  }
  // the two ends, closed
  const last = stations.length - 1;
  face(B, rings[last].map(([u, yy]) => P(u, yy, dOf(1))), F.fwd, paint); face(B, rings[0].map(([u, yy]) => P(u, yy, dOf(0))), F.fwd.map((v) => -v), paint);
  // glass on the greenhouse, laid 12 mm off the surface so it cannot sink into the body
  const surf = (t, f, side) => { const s = station(spec, t), hw = hwOf(s), c = [hw, s[2]], e = [hw * s[4], s[3] - 0.03]; return P(side * lerp(c[0], e[0], f), lerp(c[1], e[1], f), dOf(t)); };
  for (const side of [1, -1]) {
    for (const w of spec.win) face(I, w.map(([t, f]) => surf(t, f, side)), F.right.map((v) => v * side + 0), GLASS, 0.012);
    for (const t of spec.seams) { // door seams: thin dark strips down the side wall
      const s = station(spec, t), hw = hwOf(s) + 0.006, d = dOf(t);
      face(I, [P(side * hw, spec.sill + 0.26, d - 0.008), P(side * hw, spec.sill + 0.26, d + 0.008), P(side * hw, s[2] - 0.02, d + 0.008), P(side * hw, s[2] - 0.02, d - 0.008)], F.right.map((v) => v * side), SEAM);
    }
  }
  const screen = (tRoof, tCowl, uf) => { // windscreen or rear window: two quads either side of the crown line
    const edge = (t, lat) => { const s = station(spec, t), u = lat * s[4] * hwOf(s); return P(u, s[3] + 0.02 - 0.05 * Math.abs(lat), dOf(t)); };
    const dir = tCowl > tRoof ? 1 : -1, t0 = tRoof + 0.012 * dir, t1 = tCowl - 0.008 * dir;
    for (const side of [1, -1]) face(I, [edge(t0, 0), edge(t0, side * uf), edge(t1, side * uf), edge(t1, 0)], [0, 1, 0], GLASS, 0.012);
  };
  screen(spec.wind[0], spec.wind[1], 0.88);
  if (spec.rear) screen(spec.rear[0], spec.rear[1], 0.86);
  // wheels in their arches: a dark disc on the wall, the tyre standing out in front of it, a lighter hub
  const wy = spec.wr, ra = spec.wr + 0.07;
  for (const side of [1, -1]) for (const wd of [spec.wb / 2, -spec.wb / 2]) {
    const out = F.right.map((v) => v * side), ring10 = (r, u) => Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + (k / 10) * 2 * Math.PI; return P(side * u, wy + r * Math.sin(a), wd + r * Math.cos(a)); });
    const patch = Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * 2 * Math.PI; return P(side * (hwMax + 0.008), Math.max(0.04, wy + ra * Math.sin(a)), wd + ra * Math.cos(a)); });
    face(I, patch, out, DARK);
    const uo = hwMax + 0.03, outer = ring10(spec.wr, uo), inner = ring10(spec.wr, uo - 0.2);
    const axis = P(side * (uo - 0.1), wy, wd);
    for (let k = 0; k < 10; k++) { const k1 = (k + 1) % 10, m = [(outer[k][0] + outer[k1][0]) / 2 - axis[0], (outer[k][1] + outer[k1][1]) / 2 - axis[1], (outer[k][2] + outer[k1][2]) / 2 - axis[2]]; face(I, [outer[k], outer[k1], inner[k1], inner[k]], m, TYRE); }
    face(I, outer, out, TYRE);
    face(I, ring10(spec.wr * 0.56, uo + 0.012), out, HUB);
  }
  // a dark floor just above the ground, the car's contact shadow (the body casts none)
  face(I, [P(-hwMax * 0.9, 0.03, -spec.L / 2 + 0.2), P(hwMax * 0.9, 0.03, -spec.L / 2 + 0.2), P(hwMax * 0.9, 0.03, spec.L / 2 - 0.2), P(-hwMax * 0.9, 0.03, spec.L / 2 - 0.2)], [0, 1, 0], DARK);
  // bumpers, lamps, plates, mirrors
  const hwB = hwMax * 0.925;
  for (const end of [1, -1]) {
    const dEnd = end * spec.L / 2, nose = end > 0, fw = F.fwd.map((v) => v * end);
    const [cx, , cz] = P(0, 0, dEnd - end * 0.025); box(I, cx, cz, F.rx, F.rz, hwB, 0.025, y + spec.sill + 0.03, y + spec.sill + 0.2, DARK);
    face(I, [P(-0.26, spec.sill + 0.04, dEnd + end * 0.004), P(0.26, spec.sill + 0.04, dEnd + end * 0.004), P(0.26, spec.sill + 0.15, dEnd + end * 0.004), P(-0.26, spec.sill + 0.15, dEnd + end * 0.004)], fw, PLATE);
    const dF = dOf(end > 0 ? 1 : 0) + end * 0.004, [y0, y1] = nose ? spec.lampY : spec.tailY, hw = hwMax * (nose ? 0.84 : 0.88);
    for (const side of [1, -1]) {
      const u0 = side * hw * 0.5, u1 = side * hw * 0.94;
      face(I, [P(u0, y0, dF), P(u1, y0, dF), P(u1, y1, dF), P(u0, y1, dF)], fw, nose ? LAMP_W : LAMP_R);
      if (nose) face(I, [P(u1, y0 - 0.06, dF), P(u0 * 1.1 + u1 * -0.1, y0 - 0.06, dF), P(u0 * 1.1 + u1 * -0.1, y0 - 0.002, dF), P(u1, y0 - 0.002, dF)], fw, LAMP_A);
    }
    if (nose) face(I, [P(-hw * 0.46, y0 - 0.26, dF), P(hw * 0.46, y0 - 0.26, dF), P(hw * 0.46, y0 - 0.02, dF), P(-hw * 0.46, y0 - 0.02, dF)], fw, DARK); // a blank intake
  }
  const sm = station(spec, spec.mirrorT);
  for (const side of [1, -1]) { const [mx, , mz] = P(side * (hwOf(sm) + 0.03), 0, dOf(spec.mirrorT) + 0.03); box(B, mx, mz, F.rx, F.rz, 0.035, 0.05, y + sm[2] + 0.03, y + sm[2] + 0.16, paint); }
  if (spec.cargo) { // a panel van: rear door seam, and the cargo box's roof edge
    const s = station(spec, 0.0), d = dOf(0) - 0.002; void s;
    face(I, [P(-0.008, spec.sill + 0.3, d), P(0.008, spec.sill + 0.3, d), P(0.008, 2.2, d), P(-0.008, 2.2, d)], F.fwd.map((v) => -v), SEAM);
  }
}
// ---- the bicycle: thin double-sided quads, leaning on its stand ----------------------------------------------------
const LEAN = 12 * Math.PI / 180;
function buildBike(soups, x, y, z, yaw, variant) {
  const F = frameOf(x, y, z, yaw), S = soups.get(IRON_SOUP + 'd'), paint = PAINT[((variant | 0) % PAINT.length + PAINT.length) % PAINT.length], c = Math.cos(LEAN), sn = Math.sin(LEAN);
  // the model is upright in (u, y, d); the whole bicycle then leans towards +u about the line where the tyres meet the ground
  const R = (u, yy, d) => F.P(u * c + yy * sn, yy * c - u * sn, d), up = [0, 1, 0];
  const quadOf = (a, b, cc, d, tint) => face(S, [a, b, cc, d], up, tint);
  const wheel = (d) => {
    const r0 = 0.34, r1 = 0.31, n = 12, pt = (r, k) => { const a = (k / n) * 2 * Math.PI - Math.PI / 2; return R(0, 0.34 + r * Math.sin(a), d + r * Math.cos(a)); };
    for (let k = 0; k < n; k++) quadOf(pt(r0, k), pt(r0, k + 1), pt(r1, k + 1), pt(r1, k), TYRE);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI, dy = Math.sin(a) * 0.31, dd = Math.cos(a) * 0.31, w = 0.006; quadOf(R(0, 0.34 - dy, d - dd), R(0, 0.34 + dy, d + dd), R(0, 0.34 + dy + w, d + dd), R(0, 0.34 - dy + w, d - dd), HUB); }
  };
  wheel(-0.52); wheel(0.53);
  const tube = (a, b, w = 0.028, tint = paint) => { const dd = b[1] - a[1], dy = b[0] - a[0], l = Math.hypot(dd, dy), ny = dd / l * w / 2, nd = -dy / l * w / 2; quadOf(R(0, a[0] - ny, a[1] - nd), R(0, b[0] - ny, b[1] - nd), R(0, b[0] + ny, b[1] + nd), R(0, a[0] + ny, a[1] + nd), tint); };
  // points as [y, d]
  const BB = [0.30, 0.0], RH = [0.34, -0.52], FH = [0.34, 0.53], ST = [0.92, -0.20], HT = [0.90, 0.40], HB = [0.74, 0.44];
  tube(BB, ST); tube(ST, HT); tube(BB, HB); tube(HB, FH, 0.022, DARK); tube(RH, BB); tube(RH, ST, 0.02); tube(HT, [1.0, 0.37], 0.03, DARK);
  quadOf(R(-0.27, 1.01, 0.36), R(0.27, 1.01, 0.36), R(0.27, 1.01, 0.39), R(-0.27, 1.01, 0.39), DARK);       // handlebar
  quadOf(R(-0.06, 0.94, -0.32), R(0.06, 0.94, -0.32), R(0.06, 0.94, -0.10), R(-0.06, 0.94, -0.10), DARK);     // saddle
  quadOf(R(0, 0.30, 0.0), R(0, 0.30, 0.17), R(0, 0.26, 0.17), R(0, 0.26, 0.0), DARK);                          // crank
  face(S, [R(0, 0.31, -0.22), R(0, 0.31, -0.19), F.P(0.34, 0, -0.17), F.P(0.34, 0, -0.20)], up, DARK);           // the stand
}

export const carKind = (name) => ({
  collider: { hw: CARS[name].W / 2, hd: CARS[name].L / 2, h: CARS[name].H, nav: true },
  maxTriangles: 700,
  build(soups, x, y, z, yaw, variant) { buildCar(CARS[name], soups, x, y, z, yaw, variant); },
});

export const VEHICLE_KIT = {
  bicycle: { collider: { hw: 0.4, hd: 0.9, h: 1.1, nav: true }, maxTriangles: 120, build: buildBike },
  car_hatch: carKind('car_hatch'), car_sedan: carKind('car_sedan'), car_suv: carKind('car_suv'), van_delivery: carKind('van_delivery'),
};
void shade;
