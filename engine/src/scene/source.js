// Where a scene's data comes from. Two sources give the loader the same thing, so streaming is one code path:
//
//   packageSource(url)   a scene package per docs/SCENE-FORMAT.md: client.json, a far file, one container per chunk
//   jsonSource(scene)    the single-file profile the first Old Quebec scene was written in; it is cut into the same
//                        250 m chunks in memory, and its roads and areas are burnt into a surface raster here
//                        (in the full format the pipeline does that and the client never rasterises a polygon)
//
// Both return { manifest, far(), has(ce, cn), chunk(ce, cn) }. Chunks are numbered on the absolute UTM grid
// (scene/grid.js, SCENE-FORMAT.md 3.1). No three.js here: this file runs under node --test.
//
// A DECODED CHUNK
//   { ce, cn, x0, z0, hx0, hz0, step, n, heights: Float32Array(n*n), surfaceStep, sn, surface: Uint8Array(sn*sn),
//     buildings, walls, trees, roads, props, crossings, water, landmarks, cells }
// (x0, z0) is its minimum corner in game metres. The rasters run from (hx0, hz0), row by row from minimum z: in a
// package that is the chunk corner; in a single file it is the scene's own terrain sample at or before the corner,
// so the ground is the file's samples and nothing is resampled. Every record coordinate is in game metres (the
// container stores them relative to the chunk corner).
//
// THE DECODED RECORDS (docs/plans/SCENE-DETAIL.md section 4). Every field is always present: a file that lacks a key
// gets the default named here, so a generator never asks whether a field exists.
//   building  { id, ring, holes, yBase, yMin, hEave, hRoof, levels, roofShape, roofDir, roofMat, roofColor, facade,
//               tint, use, blind, front, groundFloor, passages, name, kind, part, heightSource }
//             ring and holes: flat [x, z, …]. yBase: the lowest ground. yMin: where the walls start (yBase + the
//             part's min height). The eave is at yBase + hEave, the roof's top hRoof above it. roofDir: degrees
//             clockwise from grid north, 0 to 179, or 255 (along the long side). roofColor and tint: linear
//             [r, g, b]; roofColor is null when the scene gives none. blind, front: Sets of edge numbers (edge i runs
//             from ring vertex i to i + 1). passages: [{ x1, z1, x2, z2, w, h }].
//   wall      { pts, cls, kind, height, parapet, thickness, material, crenels, rail, name, s0, len }: a PIECE of a
//             mapped line cut exactly at the edges of one cell; s0 is where it starts along the whole line of length
//             len. parapet and rail are null when absent. A package may instead ship { ring, yBase, yTop, material }.
//   road      { pts, cls, kind, surface, width, sidewalk, steps, lit, marking, bridge, tunnel, name, s0, len }: a PIECE
//             of a mapped way within reach of one cell (its box grown by width / 2 + 3 m). steps: null, or
//             { count, handrail }. sidewalk: 'both' | 'left' | 'right' | 'no' | 'self' (the way is itself a raised sidewalk).
//   tree      { x, z, height, crownRadius, kind, form }
//   prop      { kind, x, z, yaw, variant, source }: kind is the word; yaw in radians about +y as three.js turns
//             (0 faces grid north, positive towards the west): the data's degrees clockwise from north, negated.
//   crossing  { x, z, yaw, width }: yaw as a prop's, the direction the road runs.
//   cells     16 entries, 4 x 4 of 62.5 m (gen/cells.js): { i, j, index, x0, z0, x1, z1, buildings, walls, trees,
//             roads, props, crossings }, each list holding the records (the same objects as the chunk's lists). A
//             building, a tree and a prop are in the one cell of their bounding box's centre; a wall piece is in the
//             one cell it was cut to; a road piece and a crossing are in every cell they reach.
// manifest: { id, name, version, formatMinor, georef, grid, bounds (the format's `extent`), walkable (its `play`),
//             chunks, water, credits, zones, style (resolved: gen/style.js), season, ambience (or null) }

import { readContainer, dequantiseHeights } from './container.js';
import { createGrid } from '../terrain/heightfield.js';
import { CHUNK, gridOf } from './grid.js';
import { cellBoxes, cellIndex, clipLine, lineLength } from '../gen/cells.js';
import { jitterTint } from '../gen/wallvar.js';
import { resolveStyle, parseColor, paletteColor, FACADE_NAMES, ROOF_MAT_NAMES } from '../gen/style.js';
import { linear } from '../gen/soup.js';
export { lineToRings } from '../gen/structures.js';

export { CHUNK };

const abs = (ring, ox, oz) => ring.map((v, i) => v + (i % 2 ? oz : ox));

// ---- defaults and cells, shared by both sources -------------------------------------------------------------------
// Scenes written before the style block drew their walls from this list, through three.js, which darkened a colour
// twice: the same numbers are kept so those scenes look as they did.
const LEGACY_PALETTE = [0xffffff, 0xf2e3c6, 0xd9c7a8, 0xe9d2c0, 0xc9d0d4, 0xe6c9a0, 0xb8b0a4, 0xf4ead2];
const twice = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const legacyTint = (palette) => linear(LEGACY_PALETTE[((palette | 0) % LEGACY_PALETTE.length + LEGACY_PALETTE.length) % LEGACY_PALETTE.length]).map(twice);

const boxOf = (r) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return [x0, x1, z0, z1]; };

/** Fill in every field of a building record the format lets a file leave out. */
function completeBuilding(b, style) {
  b.holes = b.holes || []; b.levels = b.levels || 0; b.roofShape = b.roofShape || 0; b.roofDir = b.roofDir ?? 255; b.roofMat = b.roofMat ?? 1; b.facade = b.facade ?? 4;
  b.hRoof = b.hRoof || 0; b.use = b.use || 0; b.groundFloor = b.groundFloor || 0; b.name = b.name || ''; b.kind = b.kind || ''; b.part = !!b.part;
  b.blind = new Set(b.blind || []); b.front = new Set(b.front || []);
  b.passages = (b.passages || []).map((p) => (Array.isArray(p) ? { x1: p[0], z1: p[1], x2: p[2], z2: p[3], w: p[4], h: p[5] } : p));
  b.yMin = b.yMin ?? b.yBase + (b.minHeight || 0);
  // a styled palette entry is a family of colours: each building gets its own tone and hue within it (gen/wallvar.js), which is
  // also its id in the wall shader. A scene from before formatMinor 1 keeps its exact colours (the rules it was drawn with).
  if (!b.tint) {
    const pick = b.styled ? paletteColor(style.palettes[FACADE_NAMES[b.facade]] || style.palettes.generic, b.palette || 0) : legacyTint(b.palette || 0);
    b.tint = b.styled ? jitterTint(pick, b.id ?? Math.round(b.ring[0] * 7 + b.ring[1] * 13)) : pick;
  }
  if (b.roofColor === undefined || typeof b.roofColor === 'string') b.roofColor = parseColor(b.roofColor) || (b.roofPalette != null ? paletteColor(style.roofs[ROOF_MAT_NAMES[b.roofMat]] || style.roofs.generic, b.roofPalette, null) : null);
  return b;
}
const ROAD_CLASS = { motorway: 1, trunk: 1, primary: 2, secondary: 3, tertiary: 3, residential: 4, unclassified: 4, living_street: 4, service: 5, track: 6, pedestrian: 7, footway: 8, path: 8, cycleway: 8, steps: 9, rail: 10 };
const WALL_KIND = ['wall', 'city_wall', 'retaining_wall', 'wall', 'fence', 'hedge', 'guard_rail', 'barrier_block', 'gate'];
function completeRoad(r) {
  r.kind = r.kind || ''; r.cls = r.cls ?? (ROAD_CLASS[r.kind] || 0); r.surface = r.surface ?? 1; r.width = r.width || 4; r.sidewalk = r.sidewalk || 'no';
  r.steps = r.steps || null; r.lit = !!r.lit; r.marking = r.marking || 0; r.bridge = !!r.bridge; r.tunnel = !!r.tunnel; r.name = r.name || '';
  r.len = r.len ?? lineLength(r.pts); r.s0 = r.s0 || 0;
  return r;
}
function completeWall(w) {
  w.cls = w.cls ?? 3; w.kind = w.kind || WALL_KIND[w.cls] || 'wall'; w.material = w.material ?? 1; w.name = w.name || '';
  if (w.ring) return w;
  w.height = w.height ?? 2; w.parapet = w.parapet ?? null; w.thickness = w.thickness ?? 0.45; w.crenels = !!w.crenels; w.rail = w.rail || null;
  w.len = w.len ?? lineLength(w.pts); w.s0 = w.s0 || 0;
  return w;
}
const completeTree = (t) => { t.height = t.height ?? 8; t.crownRadius = t.crownRadius ?? 3; t.kind = t.kind || 1; t.form = t.form || 0; return t; };
const completeProp = (p) => { p.yaw = p.yaw || 0; p.variant = p.variant || 0; p.source = p.source || 0; return p; };
const ROAD_REACH = 3; // metres beyond half a road's width that its sidewalks, kerbs and stringers may reach
const HALF_OPEN = 1e-6;

/**
 * Cut a chunk's records into its 4 x 4 cells. `c` has buildings, trees, props and ringed walls (whole records) and
 * is given the mapped lines that touch it: `lines.walls` and `lines.roads` (whole lines, completed) and
 * `lines.crossings`. Sets c.walls, c.roads, c.crossings and c.cells.
 */
function layCells(c, lines = {}) {
  const cells = cellBoxes(c.x0, c.z0, CHUNK).map((box) => ({ ...box, buildings: [], walls: [], trees: [], roads: [], props: [], crossings: [] }));
  const at = (x, z) => cells[cellIndex(x, z, c.x0, c.z0, CHUNK)];
  for (const b of c.buildings) { const [x0, x1, z0, z1] = boxOf(b.ring); at((x0 + x1) / 2, (z0 + z1) / 2).buildings.push(b); }
  for (const t of c.trees) at(t.x, t.z).trees.push(t);
  for (const p of c.props) at(p.x, p.z).props.push(p);
  for (const w of c.walls) { const [x0, x1, z0, z1] = boxOf(w.ring); at((x0 + x1) / 2, (z0 + z1) / 2).walls.push(w); }
  c.roads = []; c.crossings = [];
  for (const cell of cells) {
    // a wall is cut exactly, and a line lying on a cell's far edge belongs to the next cell: each piece is in one cell
    const inner = { x0: cell.x0, z0: cell.z0, x1: cell.x1 - HALF_OPEN, z1: cell.z1 - HALF_OPEN };
    for (const w of lines.walls || []) for (const p of clipLine(w.pts, inner)) { const piece = { ...w, pts: p.pts, s0: w.s0 + p.s0 }; cell.walls.push(piece); c.walls.push(piece); }
    for (const r of lines.roads || []) for (const p of clipLine(r.pts, cell, r.width / 2 + ROAD_REACH)) { const piece = { ...r, pts: p.pts, s0: r.s0 + p.s0 }; cell.roads.push(piece); c.roads.push(piece); }
    for (const k of lines.crossings || []) { const h = (k.width + ROAD_REACH) / 2; if (k.x + h > cell.x0 && k.x - h < cell.x1 && k.z + h > cell.z0 && k.z - h < cell.z1) { cell.crossings.push(k); if (!c.crossings.includes(k)) c.crossings.push(k); } }
  }
  c.cells = cells;
  return c;
}

export function decodeChunk(buf, grid, style = resolveStyle()) {
  const { header: h, layers } = readContainer(buf);
  if (!Number.isInteger(h.ce) || !Number.isInteger(h.cn)) throw new Error('scene: a chunk header needs `ce` and `cn` (SCENE-FORMAT.md 3.1)');
  const ox = grid.x0(h.ce), oz = grid.z0(h.cn), n = Math.round(CHUNK / h.step) + 1;
  const kinds = (h.props && h.props.kinds) || [];
  const c = {
    ce: h.ce, cn: h.cn, x0: ox, z0: oz, hx0: ox, hz0: oz, sn: Math.round(CHUNK / (h.surfaceStep || h.step)), step: h.step, n, heights: dequantiseHeights(layers.height, h.yMin, h.yScale),
    surfaceStep: h.surfaceStep || h.step, surface: layers.surface || null, walk: layers.walk || null,
    buildings: (h.buildings || []).map((b) => completeBuilding({ ...b, ring: abs(b.ring, ox, oz), holes: (b.holes || []).map((r) => abs(r, ox, oz)), passages: (b.passages || []).map((p) => [p[0] + ox, p[1] + oz, p[2] + ox, p[3] + oz, p[4], p[5]]) }, style)),
    walls: (h.walls || []).filter((w) => w.ring).map((w) => completeWall({ ...w, ring: abs(w.ring, ox, oz) })),
    trees: (h.trees || []).map((t) => completeTree({ ...t, x: t.x + ox, z: t.z + oz })),
    props: ((h.props && h.props.items) || []).filter((p) => kinds[p[0]]).map((p) => completeProp({ kind: kinds[p[0]], x: p[1] + ox, z: p[2] + oz, yaw: (-(p[3] || 0) * Math.PI) / 180, variant: p[4], source: p[5] })),
    water: (h.water || []).map((w) => ({ ...w, ring: abs(w.ring, ox, oz) })),
    landmarks: (h.landmarks || []).map((l) => ({ ...l, x: l.x + ox, z: l.z + oz })),
  };
  // in a package a road or a wall line is already split at the chunk's edge (4.3); the cells cut it further
  return layCells(c, {
    walls: (h.walls || []).filter((w) => !w.ring && w.pts).map((w) => completeWall({ ...w, pts: abs(w.pts, ox, oz) })),
    roads: (h.roads || []).map((r) => completeRoad({ ...r, pts: abs(r.pts, ox, oz) })),
    crossings: (h.crossings || []).map((k) => ({ x: k[0] + ox, z: k[1] + oz, yaw: (-(k[2] || 0) * Math.PI) / 180, width: k[3] || 4 })),
  });
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
  const style = resolveStyle(manifest.style);
  const grid = gridOf(manifest.georef), byKey = new Map(manifest.chunks.map((c) => [grid.key(c.ce, c.cn), c]));
  return {
    manifest: { id: manifest.scene_id, name: manifest.name, georef: manifest.georef, grid, bounds: manifest.extent, walkable: manifest.play || manifest.extent,
      chunks: manifest.chunks.map((c) => ({ ce: c.ce, cn: c.cn })), water: manifest.water || null, credits: manifest.credits || [], zones: manifest.zones || [], version: manifest.version,
      formatMinor: manifest.formatMinor || 0, style, season: manifest.season || style.season, ambience: manifest.ambience || null },
    far: async () => decodeFar(await get(manifest.far.name)),
    has: (ce, cn) => byKey.has(grid.key(ce, cn)),
    chunk: async (ce, cn) => decodeChunk(await get(byKey.get(grid.key(ce, cn)).name), grid, style),
  };
}

// ---- the single-file profile --------------------------------------------------------------------------------------
const OSM_SURFACE = { asphalt: 1, concrete: 2, sett: 3, cobblestone: 3, unhewn_cobblestone: 3, paving_stones: 4, paved: 4, fine_gravel: 5, gravel: 5, compacted: 5, dirt: 6, ground: 6, earth: 6, grass: 7, sand: 8, rock: 9, wood: 12, metal: 13 };
const ROAD_DEFAULT = { footway: 4, steps: 4, pedestrian: 4, path: 6, track: 5, living_street: 3 };
const ROOF = { flat: 0, gabled: 1, hipped: 2, mansard: 3, pyramidal: 4, skillion: 5, sheded: 5, dome: 6, cone: 7, gambrel: 8 };
const FACADE = { stone: 1, brick: 3, stucco: 4, plaster: 4, wood: 5, concrete: 6, glass: 7, metal: 8, copper: 8 };
const WALL = { city_wall: [1, 2.4, 1], retaining_wall: [2, 0.7, 2], wall: [3, 0.45, 1], fence: [4, 0.12, 8], hedge: [5, 0.8, 1], guard_rail: [6, 0.12, 8], handrail: [6, 0.08, 8] }; // class, thickness, material

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

export function jsonSource(scene) {
  if (scene.packaging !== undefined && scene.packaging !== 'single') throw new Error(`scene: packaging "${scene.packaging}" is not a single file`);
  const t = scene.terrain, ext = scene.extent, play = scene.play || ext, cg = gridOf(scene.georef);
  const minor = scene.formatMinor || 0, style = resolveStyle(scene.style);
  const q = b64ToU16(t.data), all = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) all[i] = q[i] * t.unit;
  const grid = createGrid({ nx: t.nx, nz: t.nz, cell: t.cell, minX: t.minX, minZ: t.minZ, data: all });
  const waterLevel = scene.water ? scene.water.level : null;
  const roadSurface = (r) => r.sf ?? (OSM_SURFACE[r.s] || ROAD_DEFAULT[r.k] || 1);

  // Surface: paving by default in a town, then green areas, squares, roads, water, in that order.
  const W = Math.ceil(grid.maxX - grid.minX), H = Math.ceil(grid.maxZ - grid.minZ), ras = createRaster(grid.minX, grid.minZ, W, H, 4);
  for (const g of scene.green || []) ras.polygon(g.r, 7, g.holes || []);
  for (const a of scene.areas || []) ras.polygon(a.r, a.sf ?? (OSM_SURFACE[a.s] || 4), a.holes || []);
  for (const r of scene.roads || []) if (!r.tn) ras.line(r.p, r.w || 4, roadSurface(r));
  for (const w of (scene.water && scene.water.polygons) || []) ras.polygon(w.r, 14);
  if (waterLevel != null) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (grid.height(grid.minX + i + 0.5, grid.minZ + j + 0.5) < waterLevel + 0.8) ras.data[j * W + i] = 14;

  const own = (x0, x1, z0, z1) => cg.key(cg.ce((x0 + x1) / 2), cg.cn((z0 + z1) / 2)); // the chunk of the bounding box's centre (3.1)
  const bucket = new Map(), put = (k, kind, rec) => { let b = bucket.get(k); if (!b) bucket.set(k, (b = { buildings: [], trees: [], props: [], landmarks: [] })); b[kind].push(rec); };

  // Buildings. A key the file lacks takes the rule the engine drew with before the key existed, so an old file
  // draws as it did: those rules count buildings in file order (`seq`).
  let seq = 1;
  for (const b of scene.buildings || []) {
    if (!b.r || b.r.length < 6 || b.k === 'roof') { seq++; continue; }
    const n = seq++; // the old rules below read the number of the NEXT record, as the code they replace did
    if (b.parts && minor >= 1) continue; // an outline whose parts draw it (written so from formatMinor 1 on)
    const roofShape = b.rs ?? ROOF[b.roof] ?? (b.h > 6 && b.h < 22 ? 3 : 0), hRoof = Math.min(b.h, b.rh ?? (roofShape ? Math.min(4.5, b.h * 0.28) : 0));
    let yBase = b.g; if (yBase == null) { yBase = Infinity; for (let i = 0; i < b.r.length; i += 2) yBase = Math.min(yBase, grid.height(b.r[i], b.r[i + 1])); }
    const styled = b.pal != null;
    put(own(...boxOf(b.r)), 'buildings', completeBuilding({ id: b.id ?? n, ring: b.r, holes: b.holes || [], yBase, minHeight: b.mh || 0, hEave: b.h - hRoof, hRoof, levels: b.lv || 0,
      roofShape, roofDir: b.rd ?? 255, roofMat: b.rmt ?? (b.mat === 'copper' || /^#(4|5|6|7|8)/.test(b.rc || '') ? 2 : 1), roofColor: b.rc || undefined, roofPalette: b.rp,
      facade: b.fa ?? FACADE[b.mat] ?? (b.k === 'church' || b.h > 14 ? 1 : ((n + 1) % 3 ? 4 : 1)), styled, palette: styled ? b.pal : (n + 1) % 5,
      use: b.use || 0, blind: b.blind, front: b.front, groundFloor: b.gf || 0, passages: b.pass, name: b.n || '', kind: b.k || '', part: !!b.part, heightSource: b.hs }, style));
  }
  // Trees: [x, z, height, crownRadius, kind, form]; a short record takes the old seeded numbers.
  for (const [x, z, height, crown, kind, form] of scene.trees || []) put(own(x, x, z, z), 'trees', completeTree({ x, z, height: height ?? 7 + ((x * 13.7 + z * 7.3) % 5 + 5) % 5, crownRadius: crown ?? 2.5 + (((x * 3.1 + z * 5.9) % 2) + 2) % 2, kind: kind || 1, form: form || 0 }));
  const kinds = (scene.props && scene.props.kinds) || [];
  for (const p of (scene.props && scene.props.items) || []) if (kinds[p[0]]) put(own(p[1], p[1], p[2], p[2]), 'props', completeProp({ kind: kinds[p[0]], x: p[1], z: p[2], yaw: (-(p[3] || 0) * Math.PI) / 180, variant: p[4], source: p[5] }));
  for (const l of scene.landmarks || []) put(own(l.x, l.x, l.z, l.z), 'landmarks', { kind: l.k, x: l.x, z: l.z, name: l.n, mapLabel: l.n });

  // Lines: whole here, cut into the cells of a chunk when the chunk is asked for.
  const withBox = (rec, reach) => { const [x0, x1, z0, z1] = boxOf(rec.pts); rec.box = [x0 - reach, x1 + reach, z0 - reach, z1 + reach]; return rec; };
  const walls = (scene.walls || []).filter((w) => w.p && w.p.length >= 4).map((w) => {
    const [cls, thick, material] = WALL[w.k] || WALL.wall;
    return withBox(completeWall({ pts: w.p, cls, kind: w.k || 'wall', height: w.h || 2, parapet: w.hp ?? null, thickness: w.t ?? thick, material: w.m ?? material, crenels: !!w.cr, rail: w.rail || null, name: w.n || '' }), 0);
  });
  const roads = (scene.roads || []).filter((r) => r.p && r.p.length >= 4).map((r) => {
    let steps = null;
    if (r.k === 'steps') { const rise = Math.abs(grid.height(r.p[0], r.p[1]) - grid.height(r.p[r.p.length - 2], r.p[r.p.length - 1])); steps = { count: r.sc || Math.max(2, Math.round(rise / 0.17)), handrail: r.hr || 0 }; }
    const rec = completeRoad({ pts: r.p, kind: r.k || '', surface: roadSurface(r), width: r.w || 4, sidewalk: r.sw || 'no', steps, lit: r.lit, marking: r.mk || 0, bridge: r.br, tunnel: r.tn, name: r.n || '' });
    return withBox(rec, rec.width / 2 + ROAD_REACH);
  });
  const crossings = (scene.crossings || []).map((k) => ({ x: k[0], z: k[1], yaw: (-(k[2] || 0) * Math.PI) / 180, width: k[3] || 4 }));
  const touching = (list, x0, z0) => list.filter((l) => l.box[1] >= x0 && l.box[0] <= x0 + CHUNK && l.box[3] >= z0 && l.box[2] <= z0 + CHUNK).map(({ box, ...rec }) => rec); // eslint-disable-line no-unused-vars

  const chunks = [];
  for (let cn = cg.cn(grid.maxZ - 0.01); cn <= cg.cn(grid.minZ + 0.01); cn++) for (let ce = cg.ce(grid.minX + 0.01); ce <= cg.ce(grid.maxX - 0.01); ce++) chunks.push({ ce, cn });
  const g = scene.georef;
  return {
    manifest: { id: scene.id, name: scene.name, georef: g, grid: cg, bounds: ext, walkable: play, chunks, water: scene.water ? { level: waterLevel } : null,
      credits: (scene.sources || []).map((s) => s.attribution), zones: [], version: 'single-file',
      formatMinor: minor, style, season: scene.season || style.season, ambience: scene.ambience || null },
    far: async () => {
      // every fourth sample of the terrain, and a hull per building
      const k = 4, nx = Math.floor((t.nx - 1) / k) + 1, nz = Math.floor((t.nz - 1) / k) + 1, d = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = all[j * k * t.nx + i * k];
      const hulls = []; for (const b of bucket.values()) for (const r of b.buildings) hulls.push({ ring: r.ring, yBase: r.yBase, top: r.yBase + r.hEave + r.hRoof, facade: r.facade, roofMat: r.roofMat, tint: r.tint });
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
      const b = bucket.get(cg.key(ce, cn)) || { buildings: [], trees: [], props: [], landmarks: [] };
      return layCells({ ce, cn, x0: ox, z0: oz, hx0, hz0, sn, step, n, heights, surfaceStep: 1, surface, walk: null, buildings: b.buildings, walls: [], trees: b.trees, props: b.props, water: [], landmarks: b.landmarks },
        { walls: touching(walls, ox, oz), roads: touching(roads, ox, oz), crossings });
    },
  };
}
