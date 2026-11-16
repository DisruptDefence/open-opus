// Where a scene's data comes from. Two sources give the loader the same thing, so streaming is one code path:
//
//   packageSource(url)   a scene package per docs/SCENE-FORMAT.md: client.json, a far file, one container per chunk
//   jsonSource(scene)    the single-file profile the first Old Quebec scene was written in; it is cut into the same
//                        250 m chunks in memory, and its roads and areas are burnt into a surface raster here
//                        (in the full format the pipeline does that and the client never rasterises a polygon)
//
// Both return { manifest, far(), has(ce, cn), chunk(ce, cn) }. Chunks are numbered on the absolute UTM grid
// (scene/grid.js, SCENE-FORMAT.md 3.1). A decoded chunk is:
//   { ce, cn, x0, z0, hx0, hz0, step, n, heights: Float32Array(n*n), surfaceStep, sn, surface: Uint8Array(sn*sn),
//     buildings, walls, trees, water, landmarks }
// (x0, z0) is its minimum corner in game metres. The rasters run from (hx0, hz0), row by row from minimum z: in a
// package that is the chunk corner; in a single file it is the scene's own terrain sample at or before the corner,
// so the ground is the file's samples and nothing is resampled. Every record coordinate is in game metres (the
// container stores them relative to the chunk corner).
// manifest: { id, name, version, georef, grid, bounds (the format's `extent`), walkable (its `play`), chunks, water, credits, zones }
// No three.js here: this file runs under node --test.

import { readContainer, dequantiseHeights } from './container.js';
import { createGrid } from '../terrain/heightfield.js';
import { CHUNK, gridOf } from './grid.js';

export { CHUNK };

const abs = (ring, ox, oz) => ring.map((v, i) => v + (i % 2 ? oz : ox));

export function decodeChunk(buf, grid) {
  const { header: h, layers } = readContainer(buf);
  if (!Number.isInteger(h.ce) || !Number.isInteger(h.cn)) throw new Error('scene: a chunk header needs `ce` and `cn` (SCENE-FORMAT.md 3.1)');
  const ox = grid.x0(h.ce), oz = grid.z0(h.cn), n = Math.round(CHUNK / h.step) + 1;
  return {
    ce: h.ce, cn: h.cn, x0: ox, z0: oz, hx0: ox, hz0: oz, sn: Math.round(CHUNK / (h.surfaceStep || h.step)), step: h.step, n, heights: dequantiseHeights(layers.height, h.yMin, h.yScale),
    surfaceStep: h.surfaceStep || h.step, surface: layers.surface || null, walk: layers.walk || null,
    buildings: (h.buildings || []).map((b) => ({ ...b, ring: abs(b.ring, ox, oz), holes: (b.holes || []).map((r) => abs(r, ox, oz)) })),
    walls: (h.walls || []).map((w) => ({ ...w, ring: abs(w.ring, ox, oz) })),
    trees: (h.trees || []).map((t) => ({ ...t, x: t.x + ox, z: t.z + oz })),
    water: (h.water || []).map((w) => ({ ...w, ring: abs(w.ring, ox, oz) })),
    landmarks: (h.landmarks || []).map((l) => ({ ...l, x: l.x + ox, z: l.z + oz })),
  };
}
export function decodeFar(buf) {
  const { header: h, layers } = readContainer(buf);
  return { grid: createGrid({ nx: h.nx, nz: h.nz, cell: h.step, minX: h.minX, minZ: h.minZ, data: dequantiseHeights(layers.height, h.yMin, h.yScale) }), hulls: h.hulls || [] };
}

/** A package on a web server (or any fetch-like function, for tests). */
export async function packageSource(base, fetchFn = (u) => fetch(u)) {
  const get = async (name, as) => { const r = await fetchFn(base + name); if (!r.ok) throw new Error(`scene: ${base + name} answered ${r.status}`); return as === 'json' ? r.json() : r.arrayBuffer(); };
  const manifest = await get('client.json', 'json');
  if (!/^opus-scene\/1$/.test(manifest.format)) throw new Error(`scene: format "${manifest.format}" is not read by this engine (opus-scene/1)`);
  if (manifest.packaging !== 'chunked') throw new Error(`scene: ${base}client.json has packaging "${manifest.packaging}"; a package is "chunked"`);
  if (!manifest.extent) throw new Error('scene: client.json needs `extent` (SCENE-FORMAT.md 2.2)');
  const grid = gridOf(manifest.georef), byKey = new Map(manifest.chunks.map((c) => [grid.key(c.ce, c.cn), c]));
  return {
    manifest: { id: manifest.scene_id, name: manifest.name, georef: manifest.georef, grid, bounds: manifest.extent, walkable: manifest.play || manifest.extent,
      chunks: manifest.chunks.map((c) => ({ ce: c.ce, cn: c.cn })), water: manifest.water || null, credits: manifest.credits || [], zones: manifest.zones || [], version: manifest.version },
    far: async () => decodeFar(await get(manifest.far.name)),
    has: (ce, cn) => byKey.has(grid.key(ce, cn)),
    chunk: async (ce, cn) => decodeChunk(await get(byKey.get(grid.key(ce, cn)).name), grid),
  };
}

// ---- the single-file profile --------------------------------------------------------------------------------------
const OSM_SURFACE = { asphalt: 1, concrete: 2, sett: 3, cobblestone: 3, unhewn_cobblestone: 3, paving_stones: 4, paved: 4, fine_gravel: 5, gravel: 5, compacted: 5, dirt: 6, ground: 6, earth: 6, grass: 7, sand: 8, rock: 9, wood: 12, metal: 13 };
const ROAD_DEFAULT = { footway: 4, steps: 4, pedestrian: 4, path: 6, track: 5, living_street: 3 };
const ROOF = { flat: 0, gabled: 1, hipped: 2, mansard: 3, pyramidal: 4, skillion: 5, sheded: 5, dome: 6, cone: 7, gambrel: 8 };
const FACADE = { stone: 1, brick: 3, stucco: 4, plaster: 4, wood: 5, concrete: 6, glass: 7, metal: 8, copper: 8 };
const WALL = { city_wall: [1, 2.4, 1], retaining_wall: [2, 0.7, 2], wall: [3, 0.45, 1], fence: [4, 0.12, 8] }; // class, thickness, material

function b64ToU16(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint16Array(bin.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  return out;
}

/** A raster painter over a box, 1 m cells: polygons by scan line, lines as discs along their length. */
export function createRaster(minX, minZ, w, h, fill = 0) {
  const data = new Uint8Array(w * h).fill(fill);
  function polygon(ring, v, holes = []) {
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 1; i < ring.length; i += 2) { z0 = Math.min(z0, ring[i]); z1 = Math.max(z1, ring[i]); }
    const rings = [ring, ...holes];
    for (let j = Math.max(0, Math.floor(z0 - minZ)); j <= Math.min(h - 1, Math.floor(z1 - minZ)); j++) {
      const z = minZ + j + 0.5, xs = [];
      for (const r of rings) for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
        if ((r[i + 1] > z) !== (r[k + 1] > z)) xs.push(r[i] + ((z - r[i + 1]) / (r[k + 1] - r[i + 1])) * (r[k] - r[i]));
      }
      xs.sort((a, b) => a - b);
      for (let p = 0; p + 1 < xs.length; p += 2) for (let i = Math.max(0, Math.ceil(xs[p] - minX - 0.5)); i <= Math.min(w - 1, Math.floor(xs[p + 1] - minX - 0.5)); i++) data[j * w + i] = v;
    }
  }
  function line(pts, width, v) {
    const r = Math.max(0.75, width / 2);
    for (let p = 0; p + 3 < pts.length; p += 2) {
      const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l2 = (bx - ax) ** 2 + (bz - az) ** 2;
      for (let j = Math.max(0, Math.floor(Math.min(az, bz) - r - minZ)); j <= Math.min(h - 1, Math.floor(Math.max(az, bz) + r - minZ)); j++)
        for (let i = Math.max(0, Math.floor(Math.min(ax, bx) - r - minX)); i <= Math.min(w - 1, Math.floor(Math.max(ax, bx) + r - minX)); i++) {
          const x = minX + i + 0.5, z = minZ + j + 0.5;
          let t = l2 > 0 ? ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          if ((x - ax - (bx - ax) * t) ** 2 + (z - az - (bz - az) * t) ** 2 <= r * r) data[j * w + i] = v;
        }
    }
  }
  return { data, w, h, minX, minZ, polygon, line, at: (x, z) => { const i = Math.floor(x - minX), j = Math.floor(z - minZ); return i < 0 || j < 0 || i >= w || j >= h ? 0 : data[j * w + i]; } };
}

/** A polyline with a thickness, as one quad ring per segment. */
export function lineToRings(pts, thickness) {
  const out = [], t = thickness / 2;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const nx = (-(bz - az) / l) * t, nz = ((bx - ax) / l) * t, ex = ((bx - ax) / l) * t, ez = ((bz - az) / l) * t; // extend by t so corners close
    out.push([ax - ex + nx, az - ez + nz, bx + ex + nx, bz + ez + nz, bx + ex - nx, bz + ez - nz, ax - ex - nx, az - ez - nz]);
  }
  return out;
}

export function jsonSource(scene) {
  if (scene.packaging !== undefined && scene.packaging !== 'single') throw new Error(`scene: packaging "${scene.packaging}" is not a single file`);
  const t = scene.terrain, ext = scene.extent, play = scene.play || ext, cg = gridOf(scene.georef);
  const q = b64ToU16(t.data), all = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) all[i] = q[i] * t.unit;
  const grid = createGrid({ nx: t.nx, nz: t.nz, cell: t.cell, minX: t.minX, minZ: t.minZ, data: all });
  const waterLevel = scene.water ? scene.water.level : null;

  // Surface: paving by default in a town, then green areas, squares, roads, water, in that order.
  const W = Math.ceil(grid.maxX - grid.minX), H = Math.ceil(grid.maxZ - grid.minZ), ras = createRaster(grid.minX, grid.minZ, W, H, 4);
  for (const g of scene.green || []) ras.polygon(g.r, 7, g.holes || []);
  for (const a of scene.areas || []) ras.polygon(a.r, OSM_SURFACE[a.s] || 4, a.holes || []);
  for (const r of scene.roads || []) if (!r.tn) ras.line(r.p, r.w || 4, OSM_SURFACE[r.s] || ROAD_DEFAULT[r.k] || 1);
  for (const w of (scene.water && scene.water.polygons) || []) ras.polygon(w.r, 14);
  if (waterLevel != null) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (grid.height(grid.minX + i + 0.5, grid.minZ + j + 0.5) < waterLevel + 0.8) ras.data[j * W + i] = 14;

  const own = (x0, x1, z0, z1) => cg.key(cg.ce((x0 + x1) / 2), cg.cn((z0 + z1) / 2)); // the chunk of the bounding box's centre (3.1)
  const bucket = new Map(), put = (k, kind, rec) => { let b = bucket.get(k); if (!b) bucket.set(k, (b = { buildings: [], walls: [], trees: [], landmarks: [] })); b[kind].push(rec); };
  const box = (r) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return [x0, x1, z0, z1]; };
  let id = 1;
  for (const b of scene.buildings || []) {
    if (!b.r || b.r.length < 6 || b.k === 'roof') { id++; continue; }
    const shape = ROOF[b.roof] ?? (b.h > 6 && b.h < 22 ? 3 : 0), hRoof = shape ? Math.min(4.5, b.h * 0.28) : 0;
    let yBase = b.g; if (yBase == null) { yBase = Infinity; for (let i = 0; i < b.r.length; i += 2) yBase = Math.min(yBase, grid.height(b.r[i], b.r[i + 1])); }
    put(own(...box(b.r)), 'buildings', { id: id++, ring: b.r, holes: b.holes || [], yBase, hEave: b.h - hRoof, hRoof, levels: b.lv || 0, roofShape: shape,
      roofMat: b.mat === 'copper' || /^#(4|5|6|7|8)/.test(b.rc || '') ? 2 : 1, roofColor: b.rc || null, facade: FACADE[b.mat] ?? (b.k === 'church' || b.h > 14 ? 1 : (id % 3 ? 4 : 1)), palette: id % 5, name: b.n || '', heightSource: b.hs });
  }
  for (const w of scene.walls || []) {
    const [cls, thick, material] = WALL[w.k] || WALL.wall;
    for (const ring of lineToRings(w.p, thick)) {
      const [x0, x1, z0, z1] = box(ring); if (x1 < grid.minX || x0 > grid.maxX || z1 < grid.minZ || z0 > grid.maxZ) continue;
      let lo = Infinity, hi = -Infinity; for (let i = 0; i < ring.length; i += 2) { const h = grid.height(ring[i], ring[i + 1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      put(own(x0, x1, z0, z1), 'walls', { cls, ring, yBase: lo - 1, yTop: hi + (w.h || 2), material, name: w.n || '' });
    }
  }
  for (const [x, z] of scene.trees || []) put(own(x, x, z, z), 'trees', { x, z, height: 7 + ((x * 13.7 + z * 7.3) % 5 + 5) % 5, crownRadius: 2.5 + (((x * 3.1 + z * 5.9) % 2) + 2) % 2, kind: 1 });
  for (const l of scene.landmarks || []) put(own(l.x, l.x, l.z, l.z), 'landmarks', { kind: l.k, x: l.x, z: l.z, name: l.n, mapLabel: l.n });

  const chunks = [];
  for (let cn = cg.cn(grid.maxZ - 0.01); cn <= cg.cn(grid.minZ + 0.01); cn++) for (let ce = cg.ce(grid.minX + 0.01); ce <= cg.ce(grid.maxX - 0.01); ce++) chunks.push({ ce, cn });
  const g = scene.georef;
  return {
    manifest: { id: scene.id, name: scene.name, georef: g, grid: cg, bounds: ext, walkable: play, chunks, water: scene.water ? { level: waterLevel } : null,
      credits: (scene.sources || []).map((s) => s.attribution), zones: [], version: 'single-file' },
    far: async () => {
      // every fourth sample of the terrain, and a hull per building
      const k = 4, nx = Math.floor((t.nx - 1) / k) + 1, nz = Math.floor((t.nz - 1) / k) + 1, d = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = all[j * k * t.nx + i * k];
      const hulls = []; for (const b of bucket.values()) for (const r of b.buildings) hulls.push({ ring: r.ring, yBase: r.yBase, top: r.yBase + r.hEave + r.hRoof, facade: r.facade, roofMat: r.roofMat, palette: r.palette });
      return { grid: createGrid({ nx, nz, cell: t.cell * k, minX: t.minX, minZ: t.minZ, data: d }), hulls };
    },
    has: (ce, cn) => chunks.some((c) => c.ce === ce && c.cn === cn),
    chunk: async (ce, cn) => {
      // The tile is the file's own samples: from the one at or before the chunk's corner to the one at or after its
      // far edge. A scene's terrain grid starts at its extent, not on a chunk corner, and resampling it would move
      // the ground. Neighbouring tiles overlap by under one cell and agree there, being the same samples.
      const step = t.cell, ox = cg.x0(ce), oz = cg.z0(cn);
      const i0 = Math.floor((ox - t.minX) / step), j0 = Math.floor((oz - t.minZ) / step), n = Math.ceil((ox + CHUNK - t.minX) / step) - i0 + 1;
      const hx0 = t.minX + i0 * step, hz0 = t.minZ + j0 * step, heights = new Float32Array(n * n), sn = Math.ceil((n - 1) * step), surface = new Uint8Array(sn * sn);
      const clampI = (i) => Math.min(t.nx - 1, Math.max(0, i)), clampJ = (j) => Math.min(t.nz - 1, Math.max(0, j)); // beyond the extent the edge is held
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = all[clampJ(j0 + j) * t.nx + clampI(i0 + i)];
      for (let j = 0; j < sn; j++) for (let i = 0; i < sn; i++) surface[j * sn + i] = ras.at(hx0 + i + 0.5, hz0 + j + 0.5) || 4;
      const b = bucket.get(cg.key(ce, cn)) || { buildings: [], walls: [], trees: [], landmarks: [] };
      return { ce, cn, x0: ox, z0: oz, hx0, hz0, sn, step, n, heights, surfaceStep: 1, surface, walk: null, buildings: b.buildings, walls: b.walls, trees: b.trees, water: [], landmarks: b.landmarks };
    },
  };
}
