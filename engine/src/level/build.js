// Turns a decoded chunk into three.js meshes: the client generates meshes from semantic data (SCENE-FORMAT.md,
// principle 1). The triangles come from the generators (gen/mesher.js, pure code); this file only gives them
// materials and puts them on the graphics card.
//
//   terrain   the ground of a chunk, one mesh per surface class
//   static    a chunk's `base` and `far` groups, each ONE mesh per material for the whole chunk, so a chunk costs a
//             handful of draw calls however many cells it has. The `far` meshes keep each cell's triangles together
//             and can leave a cell out (its `near` group is showing instead) by rewriting their index.
//   near      one group per cell, built when the camera comes close and thrown away when it leaves
import { BufferAttribute, BufferGeometry, Group, Mesh } from '../../vendor/three.module.js';
import { CHUNK } from '../scene/grid.js';
import { legacyTint } from '../scene/source.js';
import { SURFACE_MATERIAL } from '../materials/outdoor.js';
import { cellSoups } from '../gen/mesher.js';
import { createSoups, prism, cap } from '../gen/soup.js';
import { SOUP } from '../gen/style.js';
import { classTriangles } from './terrain-classes.js';

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
  const n = c.n, step = c.step * stride, m = Math.floor((n - 1) / stride) + 1, ox = c.hx0, oz = c.hz0;
  const H = (i, j) => c.heights[Math.min(n - 1, j * stride) * n + Math.min(n - 1, i * stride)];
  let pos = new Float32Array(m * m * 3), nrm = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = (j * m + i) * 3;
    pos[k] = ox + i * step; pos[k + 1] = H(i, j); pos[k + 2] = oz + j * step;
    const sx = (H(Math.min(m - 1, i + 1), j) - H(Math.max(0, i - 1), j)) / ((Math.min(m - 1, i + 1) - Math.max(0, i - 1)) * step);
    const sz = (H(i, Math.min(m - 1, j + 1)) - H(i, Math.max(0, j - 1))) / ((Math.min(m - 1, j + 1) - Math.max(0, j - 1)) * step);
    const l = Math.hypot(sx, 1, sz); nrm[k] = -sx / l; nrm[k + 1] = 1 / l; nrm[k + 2] = -sz / l;
  }
  const sn = c.surface ? c.sn : 0;
  const rockCell = (i, j) => Math.max(Math.abs(H(i + 1, j) - H(i, j)), Math.abs(H(i, j + 1) - H(i, j)), Math.abs(H(i + 1, j + 1) - H(i + 1, j)), Math.abs(H(i + 1, j + 1) - H(i, j + 1))) / step > ROCK_SLOPE;
  const classAt = (x, z) => { // the surface raster under a point (1 m cells), as a material name
    if (!sn) return 'grass';
    const si = Math.min(sn - 1, Math.max(0, Math.floor((x - ox) / c.surfaceStep))), sj = Math.min(sn - 1, Math.max(0, Math.floor((z - oz) / c.surfaceStep)));
    return SURFACE_MATERIAL[c.surface[sj * sn + si]] || 'paving';
  };
  // the edge between two classes follows the raster's contour (level/terrain-classes.js) instead of the grid's cells
  const { byClass, extraPos, extraNrm } = classTriangles({ m, pos, nrm, classAt, rockCell });
  if (extraPos.length) { const p2 = new Float32Array(pos.length + extraPos.length), n2 = new Float32Array(nrm.length + extraNrm.length); p2.set(pos); p2.set(extraPos, pos.length); n2.set(nrm); n2.set(extraNrm, nrm.length); pos = p2; nrm = n2; }
  const nv = pos.length / 3;
  const group = new Group(); group.name = `terrain ${c.ce},${c.cn}`;
  const pAttr = new BufferAttribute(pos, 3), nAttr = new BufferAttribute(nrm, 3);
  let tris = 0;
  for (const [cls, idx] of byClass) {
    const g = new BufferGeometry(); g.setAttribute('position', pAttr); g.setAttribute('normal', nAttr);
    g.setIndex(idx.length > 65535 || nv > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
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

/** The material a soup key names: "stone|tv" is `stone`, triplanar, with vertex colours (gen/soup.js). */
export function materialOf(G, key) {
  const [name, flags = ''] = key.split('|');
  return G.mats.get(name, { triplanar: flags.includes('t'), vertexColors: flags.includes('v'), doubleSide: flags.includes('d') });
}
const castsShadow = (key) => !(key.split('|')[1] || '').includes('n');
function soupGeometry(s) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(s.uv), 2));
  if (s.col) g.setAttribute('color', new BufferAttribute(new Float32Array(s.col), 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
/** A soup set as a group of meshes, one per material. `userData.tris` is its triangle count. */
export function soupsToGroup(G, soups, name) {
  const group = new Group(); group.name = name; let tris = 0;
  for (const [key, s] of soups.map) { if (!s.pos.length) continue; group.add(mesh(soupGeometry(s), materialOf(G, key), castsShadow(key))); tris += s.pos.length / 9; }
  group.userData.tris = tris;
  return group;
}

/**
 * The `base` and `far` groups of a whole chunk. Returns { group, tris(), setNear(cellIndex, on) }: setNear(k, true)
 * leaves cell k out of the `far` meshes (its `near` group is showing), setNear(k, false) puts it back. tris() counts
 * what is drawn now.
 */
export function buildChunkStatic(G, chunk, env) {
  const group = new Group(); group.name = `structures ${chunk.ce},${chunk.cn}`;
  const base = createSoups(); for (const cell of chunk.cells) base.add(cellSoups(cell, 'base', env));
  const b = soupsToGroup(G, base, 'base'); group.add(b);
  // far: per material, the cells' triangles one after another, and where each cell's run starts and ends
  const far = createSoups(), runs = new Map(); // key -> [[first vertex, vertex count] per cell]
  for (const cell of chunk.cells) {
    const part = cellSoups(cell, 'far', env);
    for (const [key, s] of part.map) { if (!s.pos.length) continue; let r = runs.get(key); if (!r) runs.set(key, (r = chunk.cells.map(() => [0, 0]))); r[cell.index] = [far.get(key).pos.length / 3, s.pos.length / 3]; }
    far.add(part);
  }
  const f = new Group(); f.name = 'far'; group.add(f);
  const meshes = [];
  for (const [key, s] of far.map) {
    if (!s.pos.length) continue;
    const g = soupGeometry(s), n = s.pos.length / 3, index = new BufferAttribute(n > 65535 ? new Uint32Array(n) : new Uint16Array(n), 1);
    for (let i = 0; i < n; i++) index.array[i] = i;
    g.setIndex(index);
    const m = mesh(g, materialOf(G, key), castsShadow(key)); f.add(m); meshes.push({ m, index, runs: runs.get(key), n });
  }
  const hidden = new Set(); let farTris = 0; for (const x of meshes) farTris += x.n / 3;
  function setNear(k, on) {
    if (hidden.has(k) === !!on) return;
    if (on) hidden.add(k); else hidden.delete(k);
    farTris = 0;
    for (const x of meshes) {
      let w = 0;
      for (let c = 0; c < x.runs.length; c++) { if (hidden.has(c)) continue; const [first, count] = x.runs[c]; for (let i = 0; i < count; i++) x.index.array[w++] = first + i; }
      x.index.needsUpdate = true; x.m.geometry.setDrawRange(0, w); x.m.visible = w > 0; farTris += w / 3;
    }
  }
  return { group, setNear, tris: () => b.userData.tris + farTris };
}
/** The `near` group of one cell. */
export const buildCellNear = (G, chunk, cell, env) => soupsToGroup(G, cellSoups(cell, 'near', env), `near ${chunk.ce},${chunk.cn}/${cell.index}`);

/** The far ring for one chunk cell: coarse ground and plain hulls, drawn until the chunk itself is in. */
export function buildFarTile(G, far, ce, cn, x0, z0, hulls) {
  const g = far.grid, step = g.cell, ox = x0, oz = z0, m = Math.round(CHUNK / step) + 1;
  const c = { ce, cn, x0, z0, hx0: x0, hz0: z0, n: m, step, heights: new Float32Array(m * m), surface: null, surfaceStep: step };
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) c.heights[j * m + i] = g.height(ox + i * step, oz + j * step) - 0.4; // a little low, so detail always wins
  const group = buildTerrain(G, c, { skirt: 10 });
  if (hulls.length) {
    const set = createSoups(), s = set.get(SOUP.hull);
    for (const h of hulls) { const t = h.tint || legacyTint(h.palette || 0); prism(s, h.ring, h.yBase - 3, h.top, t, false); cap(s, h.ring, [], h.top, t); }
    const m = soupsToGroup(G, set, 'hulls'); for (const o of m.children) o.castShadow = false; group.add(m);
  }
  group.name = `far ${ce},${cn}`;
  return group;
}

export function disposeGroup(group) {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  group.removeFromParent();
}
