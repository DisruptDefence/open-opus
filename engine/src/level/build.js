// Turns a decoded chunk into three.js geometry: the client generates meshes from semantic data (SCENE-FORMAT.md,
// principle 1). Everything of one material in a chunk is one mesh, so a chunk costs a handful of draw calls.
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, ShapeUtils, Vector2 } from '../../vendor/three.module.js';
import { CHUNK } from '../scene/source.js';
import { SURFACE_MATERIAL, FACADE_MATERIAL, WALL_MATERIAL, ROOF_MATERIAL, PALETTE } from '../materials/outdoor.js';

const ROCK_SLOPE = 1.05; // ground steeper than this is drawn as rock whatever the raster says

/** A growing triangle soup for one material. */
function soup() {
  const pos = [], nrm = [], uv = [], col = [];
  return {
    pos, nrm, uv, col,
    tri(a, b, c, n, ua, ub, uc, tint) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) nrm.push(n[0], n[1], n[2]);
      uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
      if (tint) for (let i = 0; i < 3; i++) col.push(tint.r, tint.g, tint.b);
    },
    geometry() {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      if (col.length) g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    },
  };
}
const mesh = (geo, mat, cast = true) => { const m = new Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; return m; };

/**
 * The ground of one chunk. `stride` skips samples (1 = full detail); `skirt` drops a curtain at the edges so a
 * coarser neighbour or the far ring never shows a gap. Triangles are grouped by surface class.
 */
export function buildTerrain(G, c, { stride = 1, skirt = 4 } = {}) {
  const n = c.n, step = c.step * stride, m = Math.floor((n - 1) / stride) + 1, ox = c.cx * CHUNK, oz = c.cz * CHUNK;
  const H = (i, j) => c.heights[Math.min(n - 1, j * stride) * n + Math.min(n - 1, i * stride)];
  const pos = new Float32Array(m * m * 3), nrm = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = (j * m + i) * 3;
    pos[k] = ox + i * step; pos[k + 1] = H(i, j); pos[k + 2] = oz + j * step;
    const sx = (H(Math.min(m - 1, i + 1), j) - H(Math.max(0, i - 1), j)) / ((Math.min(m - 1, i + 1) - Math.max(0, i - 1)) * step);
    const sz = (H(i, Math.min(m - 1, j + 1)) - H(i, Math.max(0, j - 1))) / ((Math.min(m - 1, j + 1) - Math.max(0, j - 1)) * step);
    const l = Math.hypot(sx, 1, sz); nrm[k] = -sx / l; nrm[k + 1] = 1 / l; nrm[k + 2] = -sz / l;
  }
  const sn = c.surface ? Math.round(CHUNK / c.surfaceStep) : 0;
  const classOf = (i, j) => {
    const h00 = H(i, j), h10 = H(i + 1, j), h01 = H(i, j + 1), h11 = H(i + 1, j + 1);
    if (Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00), Math.abs(h11 - h10), Math.abs(h11 - h01)) / step > ROCK_SLOPE) return 'rock';
    if (!sn) return 'grass';
    const si = Math.min(sn - 1, Math.floor(((i + 0.5) * step) / c.surfaceStep)), sj = Math.min(sn - 1, Math.floor(((j + 0.5) * step) / c.surfaceStep));
    return SURFACE_MATERIAL[c.surface[sj * sn + si]] || 'paving';
  };
  const byClass = new Map();
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
    const cls = classOf(i, j); let idx = byClass.get(cls); if (!idx) byClass.set(cls, (idx = []));
    const a = j * m + i, b = a + 1, d = a + m, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const group = new Group(); group.name = `terrain ${c.cx},${c.cz}`;
  const pAttr = new BufferAttribute(pos, 3), nAttr = new BufferAttribute(nrm, 3);
  let tris = 0;
  for (const [cls, idx] of byClass) {
    const g = new BufferGeometry(); g.setAttribute('position', pAttr); g.setAttribute('normal', nAttr);
    g.setIndex(idx.length > 65535 || m * m > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    group.add(mesh(g, G.mats.get(cls, { triplanar: true }), false)); tris += idx.length / 3;
  }
  if (skirt > 0) {
    const s = soup(), edge = (i0, j0, i1, j1, nx, nz) => {
      const a = [ox + i0 * step, H(i0, j0), oz + j0 * step], b = [ox + i1 * step, H(i1, j1), oz + j1 * step];
      const a2 = [a[0], a[1] - skirt, a[2]], b2 = [b[0], b[1] - skirt, b[2]], n3 = [nx, 0.3, nz], u = [0, 0];
      s.tri(a, a2, b, n3, u, u, u); s.tri(b, a2, b2, n3, u, u, u); s.tri(a, b, a2, n3, u, u, u); s.tri(b, b2, a2, n3, u, u, u);
    };
    for (let i = 0; i < m - 1; i++) { edge(i, 0, i + 1, 0, 0, -1); edge(i, m - 1, i + 1, m - 1, 0, 1); edge(0, i, 0, i + 1, -1, 0); edge(m - 1, i, m - 1, i + 1, 1, 0); }
    group.add(mesh(s.geometry(), G.mats.get('rock', { triplanar: true }), false));
  }
  group.userData.tris = tris;
  return group;
}

const centroid = (r) => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)]; };
const signedArea = (r) => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return a / 2; };
function cap(s, ring, holes, y, tint, up = true) {
  const pts = [], hs = holes.map((h) => { const o = []; for (let i = 0; i < h.length; i += 2) o.push(new Vector2(h[i], h[i + 1])); return o; });
  for (let i = 0; i < ring.length; i += 2) pts.push(new Vector2(ring[i], ring[i + 1]));
  const all = pts.concat(...hs), n = [0, up ? 1 : -1, 0];
  for (const t of ShapeUtils.triangulateShape(pts, hs)) {
    const [a, b, d] = t.map((k) => all[k]), A = [a.x, y, a.y], B = [b.x, y, b.y], D = [d.x, y, d.y];
    // wind so the face looks up (or down): in (x, z) a counter-clockwise triangle faces -y
    const ccw = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x) > 0;
    if (ccw === up) s.tri(A, D, B, n, [a.x, a.y], [d.x, d.y], [b.x, b.y], tint); else s.tri(A, B, D, n, [a.x, a.y], [b.x, b.y], [d.x, d.y], tint);
  }
}
/** Vertical faces round a ring between two heights, facing outwards whatever the winding. UVs in metres. */
function wallsOf(s, ring, y0, y1, tint, bays = false, vBase = y0) {
  const out = signedArea(ring) > 0 ? 1 : -1;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.02) continue;
    const nx = ((bz - az) / len) * out, nz = (-(bx - ax) / len) * out, n = [nx, 0, nz];
    // whole window bays along each wall, so no window is cut by a corner
    const u1 = bays ? Math.max(1, Math.round(len / 3)) * 3 : len, v0 = y0 - vBase, v1 = y1 - vBase;
    const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
    if (out > 0) { s.tri(A, C, B, n, [0, v0], [u1, v1], [u1, v0], tint); s.tri(A, D, C, n, [0, v0], [0, v1], [u1, v1], tint); }
    else { s.tri(A, B, C, n, [0, v0], [u1, v0], [u1, v1], tint); s.tri(A, C, D, n, [0, v0], [u1, v1], [0, v1], tint); }
  }
}
/** A roof as a frustum: the eave ring drawn in towards the centre and raised. Works for any outline; exact for none. */
function roofOf(s, b, tint) {
  const eave = b.yBase + b.hEave, top = eave + b.hRoof, r = b.ring;
  if (!b.hRoof || !b.roofShape) { cap(s, r, b.holes || [], eave, tint); return; }
  const [cx, cz] = centroid(r); let rad = Infinity;
  for (let i = 0; i < r.length; i += 2) rad = Math.min(rad, Math.hypot(r[i] - cx, r[i + 1] - cz));
  const k = b.roofShape === 4 || b.roofShape === 7 ? 0.02 : Math.max(0.15, 1 - (b.hRoof * (b.roofShape === 3 ? 0.55 : 1.1)) / Math.max(1, rad));
  const inner = r.map((v, i) => (i % 2 ? cz + (v - cz) * k : cx + (v - cx) * k)), out = signedArea(r) > 0 ? 1 : -1;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const A = [r[j], eave, r[j + 1]], B = [r[i], eave, r[i + 1]], C = [inner[i], top, inner[i + 1]], D = [inner[j], top, inner[j + 1]];
    const ex = B[0] - A[0], ez = B[2] - A[2], l = Math.hypot(ex, ez) || 1, run = Math.hypot(D[0] - A[0], D[2] - A[2]) || 0.01;
    const nl = Math.hypot(run, b.hRoof), n = [((ez / l) * out * b.hRoof) / nl, run / nl, ((-ex / l) * out * b.hRoof) / nl], u = [0, 0];
    if (out > 0) { s.tri(A, C, B, n, u, u, u, tint); s.tri(A, D, C, n, u, u, u, tint); } else { s.tri(A, B, C, n, u, u, u, tint); s.tri(A, C, D, n, u, u, u, tint); }
  }
  if (k > 0.05) cap(s, inner, [], top, tint);
}

const tintOf = (palette) => new Color(PALETTE[palette % PALETTE.length]).convertSRGBToLinear();

/** Buildings, walls and trees of a chunk. `groundAt(x, z)` gives the terrain height. */
export function buildStructures(G, c, groundAt) {
  const soups = new Map(), get = (name) => { let s = soups.get(name); if (!s) soups.set(name, (s = soup())); return s; };
  for (const b of c.buildings) {
    const tint = tintOf(b.palette || 0);
    let lo = b.yBase; for (let i = 0; i < b.ring.length; i += 2) lo = Math.min(lo, groundAt(b.ring[i], b.ring[i + 1]));
    const eave = b.yBase + b.hEave, facade = FACADE_MATERIAL[b.facade] || 'facade_stucco';
    if (lo < b.yBase - 0.05) { wallsOf(get('wall:stone'), b.ring, lo - 0.5, b.yBase, null); for (const h of b.holes || []) wallsOf(get('wall:stone'), h, lo - 0.5, b.yBase, null); } // a plinth where the ground falls away
    wallsOf(get('facade:' + facade), b.ring, b.yBase, eave, tint, true, b.yBase);
    for (const h of b.holes || []) wallsOf(get('facade:' + facade), h, b.yBase, eave, tint, true, b.yBase);
    const roofTint = b.roofColor ? safeColor(b.roofColor) : null;
    roofOf(get('roof:' + (roofTint ? 'roof_zinc' : ROOF_MATERIAL[b.roofMat] || 'roof_zinc') + (roofTint ? ':t' : '')), b, roofTint);
  }
  for (const w of c.walls) {
    const s = get('wall:' + (WALL_MATERIAL[w.material] || 'stone'));
    wallsOf(s, w.ring, w.yBase, w.yTop, null); cap(s, w.ring, [], w.yTop, null);
  }
  const group = new Group(); group.name = `structures ${c.cx},${c.cz}`;
  let tris = 0;
  for (const [key, s] of soups) {
    if (!s.pos.length) continue;
    const [kind, name, tinted] = key.split(':');
    const mat = kind === 'facade' ? G.mats.get(name, { vertexColors: true }) : kind === 'roof' ? G.mats.get(name, { triplanar: true, vertexColors: !!tinted }) : G.mats.get(name, { triplanar: true });
    group.add(mesh(s.geometry(), mat)); tris += s.pos.length / 9;
  }
  if (c.trees.length) { const t = buildTrees(G, c.trees, groundAt); group.add(t); tris += t.userData.tris; }
  group.userData.tris = tris;
  return group;
}
function safeColor(v) { try { const c = new Color(v); return c.convertSRGBToLinear().multiplyScalar(1.6); } catch { return null; } }

function buildTrees(G, trees, groundAt) {
  const trunk = soup(), crown = soup(), SEG = 6, g = new Group();
  for (const t of trees) {
    const y = groundAt(t.x, t.z), th = t.height * 0.45, r = 0.16 + t.height * 0.012;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const A = [t.x + c0 * r, y - 0.3, t.z + s0 * r], B = [t.x + c1 * r, y - 0.3, t.z + s1 * r], C = [t.x + c1 * r * 0.7, y + th, t.z + s1 * r * 0.7], D = [t.x + c0 * r * 0.7, y + th, t.z + s0 * r * 0.7];
      trunk.tri(A, C, B, [c0, 0, s0], [0, 0], [1, 1], [1, 0]); trunk.tri(A, D, C, [c0, 0, s0], [0, 0], [0, 1], [1, 1]);
    }
    // crown: two stacked rings and a tip (broadleaf round, conifer tall)
    const conifer = t.kind === 2, R = t.crownRadius * (conifer ? 0.7 : 1), y0 = y + th * (conifer ? 0.5 : 0.85), H = t.height - (y0 - y), N = 7;
    const ring = (k) => { const yy = y0 + H * k, rr = conifer ? R * (1 - k) : R * Math.sin(Math.PI * (0.12 + 0.88 * k)); const o = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2 + k * 2 + t.x; o.push([t.x + Math.cos(a) * rr * (0.85 + 0.3 * Math.sin(i * 2.3 + t.z)), yy, t.z + Math.sin(a) * rr * (0.85 + 0.3 * Math.cos(i * 1.7 + t.x))]); } return o; };
    const levels = conifer ? [0, 0.35, 0.7] : [0, 0.3, 0.62, 0.86], rings = levels.map(ring), tip = [t.x, y0 + H, t.z], base = [t.x, y0, t.z];
    const nOf = (p) => { const dx = p[0] - t.x, dy = p[1] - (y0 + H * 0.4), dz = p[2] - t.z, l = Math.hypot(dx, dy, dz) || 1; return [dx / l, dy / l, dz / l]; };
    for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < N; i++) {
      const a = rings[k][i], b = rings[k][(i + 1) % N], cc = rings[k + 1][(i + 1) % N], d = rings[k + 1][i];
      crown.tri(a, cc, b, nOf(a), [0, 0], [0, 0], [0, 0]); crown.tri(a, d, cc, nOf(d), [0, 0], [0, 0], [0, 0]);
    }
    for (let i = 0; i < N; i++) { const a = rings[rings.length - 1][i], b = rings[rings.length - 1][(i + 1) % N]; crown.tri(a, tip, b, nOf(tip), [0, 0], [0, 0], [0, 0]); const e = rings[0][i], f = rings[0][(i + 1) % N]; crown.tri(e, f, base, [0, -1, 0], [0, 0], [0, 0], [0, 0]); }
  }
  g.add(mesh(trunk.geometry(), G.mats.get('wood', { triplanar: true })), mesh(crown.geometry(), G.mats.get('leaves', { triplanar: true })));
  g.userData.tris = (trunk.pos.length + crown.pos.length) / 9;
  return g;
}

/** The far ring for one chunk cell: coarse ground and plain hulls, drawn until the chunk itself is in. */
export function buildFarTile(G, far, cx, cz, hulls) {
  const g = far.grid, step = g.cell, ox = cx * CHUNK, oz = cz * CHUNK, m = Math.round(CHUNK / step) + 1;
  const c = { cx, cz, n: m, step, heights: new Float32Array(m * m), surface: null, surfaceStep: step };
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) c.heights[j * m + i] = g.height(ox + i * step, oz + j * step) - 0.4; // a little low, so detail always wins
  const group = buildTerrain(G, c, { skirt: 10 });
  if (hulls.length) {
    const s = soup();
    for (const h of hulls) { const t = tintOf(h.palette || 0); wallsOf(s, h.ring, h.yBase - 3, h.top, t); cap(s, h.ring, [], h.top, t); }
    group.add(mesh(s.geometry(), G.mats.get('stucco', { triplanar: true, vertexColors: true }), false));
  }
  group.name = `far ${cx},${cz}`;
  return group;
}

export function disposeGroup(group) {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  group.removeFromParent();
}
