// Triangle soups: what the generators of this module write and the mesher (level/build.js) turns into meshes.
// Pure code: plain arrays of numbers, no three.js. One soup per material; a key names the material and how it is
// drawn: "stone|tv" is the material `stone`, triplanar (t), with vertex colours (v).
//
// Winding: a triangle (a, b, c) faces the side from which a, b, c run counter-clockwise; its normal is
// (b - a) x (c - a). Every helper here computes the normal from the winding, so a face can never be lit from behind.

export function createSoup(colored = false) {
  return { pos: [], nrm: [], uv: [], col: colored ? [] : null };
}
export function createSoups() {
  const map = new Map();
  return {
    map,
    get(key) { let s = map.get(key); if (!s) map.set(key, (s = createSoup(/\|[a-z]*v/.test(key)))); return s; },
    triangles() { let n = 0; for (const s of map.values()) n += s.pos.length / 9; return n; },
  };
}
const WHITE = [1, 1, 1], UV0 = [0, 0];

export function tri(s, a, b, c, tint, ua = UV0, ub = UV0, uc = UV0) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
  if (l < 1e-10) return; // no area
  nx /= l; ny /= l; nz /= l;
  s.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  s.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  s.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  if (s.col) { const t = tint || WHITE; s.col.push(t[0], t[1], t[2], t[0], t[1], t[2], t[0], t[1], t[2]); }
}
/** A quad a, b, c, d counter-clockwise seen from its front. `uv` = [u0, v0, u1, v1]: a is (u0, v0), c is (u1, v1). */
export function quad(s, a, b, c, d, tint, uv) {
  if (uv) { tri(s, a, b, c, tint, [uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]]); tri(s, a, c, d, tint, [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]); }
  else { tri(s, a, b, c, tint); tri(s, a, c, d, tint); }
}
/** A convex polygon (points counter-clockwise seen from its front) as a fan. */
export function fan(s, pts, tint) { for (let i = 1; i + 1 < pts.length; i++) tri(s, pts[0], pts[i], pts[i + 1], tint); }

/**
 * A frame on a vertical plane: origin o = [x, z] on the ground plan, e = unit vector to the right as seen from in
 * front, n = unit vector towards the viewer. at(u, y, d) is the point u metres to the right, at height y, d metres
 * out of the plane. Everything on a wall is written in these terms.
 */
export function frame(ox, oz, ex, ez) {
  const nx = -ez, nz = ex;
  return { ox, oz, ex, ez, nx, nz, at: (u, y, d = 0) => [ox + ex * u + nx * d, y, oz + ez * u + nz * d] };
}
/** A rectangle on a frame facing the viewer, at depth d: u0..u1, y0..y1. */
export function rect(s, f, u0, u1, y0, y1, d, tint, uv) { quad(s, f.at(u0, y0, d), f.at(u1, y0, d), f.at(u1, y1, d), f.at(u0, y1, d), tint, uv); }
/**
 * A box standing out of a frame from depth d0 to d1 (d1 > d0): front, the two cheeks, top and bottom as asked.
 * `faces` is a string of the faces wanted: f front, l left, r right, t top, b bottom.
 */
export function slab(s, f, u0, u1, y0, y1, d0, d1, tint, faces = 'flrtb') {
  if (faces.includes('f')) rect(s, f, u0, u1, y0, y1, d1, tint);
  if (faces.includes('l')) quad(s, f.at(u0, y0, d0), f.at(u0, y0, d1), f.at(u0, y1, d1), f.at(u0, y1, d0), tint);
  if (faces.includes('r')) quad(s, f.at(u1, y0, d1), f.at(u1, y0, d0), f.at(u1, y1, d0), f.at(u1, y1, d1), tint);
  if (faces.includes('t')) quad(s, f.at(u0, y1, d1), f.at(u1, y1, d1), f.at(u1, y1, d0), f.at(u0, y1, d0), tint);
  if (faces.includes('b')) quad(s, f.at(u0, y0, d0), f.at(u1, y0, d0), f.at(u1, y0, d1), f.at(u0, y0, d1), tint);
}
/** An upright box by its centre on the plan, half sizes along a unit direction (ex, ez) and across it, from y0 to y1. */
export function box(s, cx, cz, ex, ez, hu, hd, y0, y1, tint, top = true) {
  const p = (u, d) => [cx + ex * u - ez * d, cz + ez * u + ex * d], c = [p(-hu, -hd), p(hu, -hd), p(hu, hd), p(-hu, hd)];
  prism(s, [c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]], y0, y1, tint, top);
}
const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return a; };
/** The sides of a ring between two heights, facing outwards whatever its winding, and a flat top when asked (convex rings only for the top). */
export function prism(s, ring, y0, y1, tint, top = true, bottom = false) {
  const out = area2(ring) > 0 ? 1 : -1, n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const A = [ring[j], ring[j + 1]], B = [ring[i], ring[i + 1]], [L, R] = out > 0 ? [B, A] : [A, B];
    quad(s, [L[0], y0, L[1]], [R[0], y0, R[1]], [R[0], y1, R[1]], [L[0], y1, L[1]], tint);
  }
  const pts = (y) => { const o = []; for (let i = 0; i < n; i += 2) o.push([ring[i], y, ring[i + 1]]); return o; };
  // game z points south: seen from above, a ring with positive area2 must be reversed to run counter-clockwise
  if (top) fan(s, out > 0 ? pts(y1).reverse() : pts(y1), tint);
  if (bottom) fan(s, out > 0 ? pts(y0) : pts(y0).reverse(), tint);
}

/** sRGB hex (0xrrggbb or "#rrggbb") to linear [r, g, b]. */
export function linear(hex) {
  if (typeof hex === 'string') hex = parseInt(hex.replace('#', ''), 16);
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
export const shade = (t, k) => [t[0] * k, t[1] * k, t[2] * k];
export const mixTint = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** A small repeatable random stream from an integer seed (mulberry32). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (n) => Math.floor(next() * n);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}
/** A seed from two coordinates, for things that have no id (a tree, a lamp). */
export const seedOf = (x, z) => (Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663)) >>> 0;
