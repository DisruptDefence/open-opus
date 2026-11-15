// Where a scene's data comes from. Two sources give the loader the same thing, so streaming is one code path:
//
//   packageSource(url)   a scene package per docs/SCENE-FORMAT.md: client.json, a far file, one container per chunk
//   jsonSource(scene)    the single-file profile the first Old Quebec scene was written in; it is cut into the same
//                        250 m chunks in memory, and its roads and areas are burnt into a surface raster here
//                        (in the full format the pipeline does that and the client never rasterises a polygon)
//
// Both return { manifest, far(), chunk(cx, cz) }. A decoded chunk is:
//   { cx, cz, step, n, heights: Float32Array(n*n), surfaceStep, surface: Uint8Array, buildings, walls, trees, water, landmarks }
// with every coordinate in game metres (the container stores them relative to the chunk corner).
// No three.js here: this file runs under node --test.

import { readContainer, dequantiseHeights } from './container.js';
import { createGrid } from '../terrain/heightfield.js';

export const CHUNK = 250;

const abs = (ring, ox, oz) => ring.map((v, i) => v + (i % 2 ? oz : ox));

export function decodeChunk(buf) {
  const { header: h, layers } = readContainer(buf);
  const ox = h.cx * CHUNK, oz = h.cz * CHUNK, n = Math.round(CHUNK / h.step) + 1;
  return {
    cx: h.cx, cz: h.cz, step: h.step, n, heights: dequantiseHeights(layers.height, h.yMin, h.yScale),
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
  const byKey = new Map(manifest.chunks.map((c) => [c.cx + ',' + c.cz, c]));
  return {
    manifest: { id: manifest.scene_id, name: manifest.name, georef: manifest.georef, chunkSize: manifest.chunkSize || CHUNK, bounds: manifest.georef.bounds, walkable: manifest.georef.walkable || manifest.georef.bounds,
      chunks: manifest.chunks.map((c) => ({ cx: c.cx, cz: c.cz })), water: manifest.water || null, credits: manifest.credits || [], zones: manifest.zones || [], version: manifest.version },
    far: async () => decodeFar(await get(manifest.far.name)),
    has: (cx, cz) => byKey.has(cx + ',' + cz),
    chunk: async (cx, cz) => decodeChunk(await get(byKey.get(cx + ',' + cz).name)),
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
  const t = scene.terrain, ext = scene.extent, play = scene.play || ext;
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

  const own = (x0, x1, z0, z1) => Math.floor((x0 + x1) / 2 / CHUNK) + ',' + Math.floor((z0 + z1) / 2 / CHUNK);
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
  for (let cz = Math.floor(grid.minZ / CHUNK); cz <= Math.floor((grid.maxZ - 0.01) / CHUNK); cz++) for (let cx = Math.floor(grid.minX / CHUNK); cx <= Math.floor((grid.maxX - 0.01) / CHUNK); cx++) chunks.push({ cx, cz });
  const g = scene.georef;
  return {
    manifest: { id: scene.id, name: scene.name, georef: g, chunkSize: CHUNK, bounds: ext, walkable: play, chunks, water: scene.water ? { level: waterLevel } : null,
      credits: (scene.sources || []).map((s) => s.attribution), zones: [], version: 'single-file' },
    far: async () => {
      // every fourth sample of the terrain, and a hull per building
      const k = 4, nx = Math.floor((t.nx - 1) / k) + 1, nz = Math.floor((t.nz - 1) / k) + 1, d = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = all[j * k * t.nx + i * k];
      const hulls = []; for (const b of bucket.values()) for (const r of b.buildings) hulls.push({ ring: r.ring, yBase: r.yBase, top: r.yBase + r.hEave + r.hRoof, facade: r.facade, roofMat: r.roofMat, palette: r.palette });
      return { grid: createGrid({ nx, nz, cell: t.cell * k, minX: t.minX, minZ: t.minZ, data: d }), hulls };
    },
    has: (cx, cz) => chunks.some((c) => c.cx === cx && c.cz === cz),
    chunk: async (cx, cz) => {
      const step = t.cell, n = Math.round(CHUNK / step) + 1, ox = cx * CHUNK, oz = cz * CHUNK, heights = new Float32Array(n * n), surface = new Uint8Array(CHUNK * CHUNK);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = grid.height(ox + i * step, oz + j * step);
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) surface[j * CHUNK + i] = ras.at(ox + i + 0.5, oz + j + 0.5) || 4;
      const b = bucket.get(cx + ',' + cz) || { buildings: [], walls: [], trees: [], landmarks: [] };
      return { cx, cz, step, n, heights, surfaceStep: 1, surface, walk: null, buildings: b.buildings, walls: b.walls, trees: b.trees, water: [], landmarks: b.landmarks };
    },
  };
}
