// Builds the engine's own test scene: one square kilometre with a hill, a cliff with a ramp down it, a river, a grid
// of streets, a cobbled square, buildings, a staircase, a low wall and trees. Deterministic: same code, same bytes.
//   node engine/tools/make-test-scene.mjs            writes engine/scenes/test/
// The package follows docs/SCENE-FORMAT.md: client.json, far.<hash>.bin, chunks/<cx>_<cz>.<hash>.bin, anchors.json.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeContainer, quantiseHeights } from '../src/scene/container.js';
import { createGeoref } from '../src/geo/georef.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenes', 'test');
const CHUNK = 250, STEP = 2, SSTEP = 1, HALF = 500; // 1 km2: x, z in [-500, 500)
const S = { asphalt: 1, concrete: 2, cobble: 3, paving: 4, gravel: 5, dirt: 6, grass: 7, sand: 8, rock: 9, water: 14 };

let seed = 20261115;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, z) { const i = Math.floor(x), j = Math.floor(z), u = sm(0, 1, x - i), v = sm(0, 1, z - j); return (hash2(i, j) * (1 - u) + hash2(i + 1, j) * u) * (1 - v) + (hash2(i, j + 1) * (1 - u) + hash2(i + 1, j + 1) * u) * v; }

// ---- the ground --------------------------------------------------------------------------------------------------
const CLIFF_X = -120, LOW = 4, HIGH = 30, RAMP_Z0 = 110, RAMP_Z1 = 170;
const STREETS_X = [-60, 20, 100, 180, 260], STREETS_Z = [-80, 0, 80, 160];
const onStreet = (x, z) => x > -75 && x < 275 && z > -95 && z < 175 && (STREETS_X.some((s) => Math.abs(x - s) < 4) || STREETS_Z.some((s) => Math.abs(z - s) < 4));
const SQUARE = { x0: -12, x1: 52, z0: -32, z1: 32 }; // around the crossing of x = 20 and z = 0
const inSquare = (x, z) => x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1;
function height(x, z) {
  // the cliff: low town to the west, high town to the east; a ramp street comes down it between RAMP_Z0 and RAMP_Z1
  const inRamp = sm(RAMP_Z0 - 6, RAMP_Z0, z) * (1 - sm(RAMP_Z1, RAMP_Z1 + 6, z));
  const sharp = sm(CLIFF_X - 3, CLIFF_X + 3, x), gentle = sm(CLIFF_X - 70, CLIFF_X + 50, x);
  let h = LOW + (HIGH - LOW) * (sharp * (1 - inRamp) + gentle * inRamp);
  // a hill on the high town
  const d = Math.hypot(x - 330, z + 260);
  h += 36 * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, d / 170)));
  // relief everywhere but the streets and the square, which the builder flattens (as the pipeline would)
  const flat = Math.max(onStreet(x, z) || inSquare(x, z) ? 1 : 0, 1 - sm(0, 8, Math.min(...STREETS_X.map((s) => Math.abs(x - s)), ...STREETS_Z.map((s) => Math.abs(z - s)))) * (x > -80 && x < 280 && z > -100 && z < 180 ? 0 : 1));
  const town = x > -80 && x < 280 && z > -100 && z < 180 ? 1 : 0;
  h += (1 - Math.max(flat, town)) * ((noise(x / 40, z / 40) - 0.5) * 5 + (noise(x / 9, z / 9) - 0.5) * 0.8);
  // the river in the west
  h -= (LOW + 1.5) * sm(-400, -440, x);
  return Math.max(0, h); // y >= 0 on all ground (SCENE-FORMAT 2.1)
}
const WATER = 1.2;
function slopeAt(x, z) { return Math.hypot(height(x + 1, z) - height(x - 1, z), height(x, z + 1) - height(x, z - 1)) / 2; }
function surface(x, z) {
  const h = height(x, z);
  if (h < WATER) return S.water;
  if (h < WATER + 0.8) return S.sand;
  if (slopeAt(x, z) > 1.0) return S.rock;
  if (inSquare(x, z)) return S.cobble;
  if (onStreet(x, z)) return S.asphalt;
  // the ramp street
  if (z > RAMP_Z0 + 8 && z < RAMP_Z1 - 8 && x > CLIFF_X - 80 && x < -56) return S.cobble;
  if (x > -80 && x < 280 && z > -100 && z < 180) return S.paving; // pavements and yards in the town
  if (x < CLIFF_X - 4 && x > -380 && Math.abs(z - 20) < 3.5) return S.gravel; // a track in the low town
  return S.grass;
}

// ---- buildings, walls, trees -------------------------------------------------------------------------------------
const buildings = [], walls = [], trees = [], landmarks = [];
let nextId = 1;
function rect(cx, cz, w, d, rot) { const c = Math.cos(rot), s = Math.sin(rot), o = []; for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) o.push(+(cx + a * c - b * s).toFixed(2), +(cz + a * s + b * c).toFixed(2)); return o; }
function addBuilding(ring, h, o = {}) {
  let yBase = Infinity; for (let i = 0; i < ring.length; i += 2) yBase = Math.min(yBase, height(ring[i], ring[i + 1]));
  const hRoof = o.roofShape ? Math.min(4, h * 0.3) : 0;
  buildings.push({ id: nextId++, parent: 0, ring, yBase: +yBase.toFixed(2), hEave: +(h - hRoof).toFixed(2), hRoof: +hRoof.toFixed(2), levels: Math.max(1, Math.round((h - hRoof) / 3.2)),
    roofShape: o.roofShape || 0, roofDir: 255, roofMat: o.roofMat ?? 1, facade: o.facade ?? 4, palette: o.palette ?? 0, use: o.use ?? 1, damage: 0, flags: 4, name: o.name || '' });
}
// town blocks between the streets
for (let bi = 0; bi < STREETS_X.length - 1; bi++) for (let bj = 0; bj < STREETS_Z.length - 1; bj++) {
  const x0 = STREETS_X[bi] + 7, x1 = STREETS_X[bi + 1] - 7, z0 = STREETS_Z[bj] + 7, z1 = STREETS_Z[bj + 1] - 7;
  // houses along the block's four sides, a yard in the middle
  for (let x = x0 + 6; x < x1 - 4; x += 13 + rnd() * 5) for (const z of [z0 + 6, z1 - 6]) {
    const w = 10 + rnd() * 3, d = 10 + rnd() * 2;
    if (inSquare(x, z) || x + w / 2 > x1 || Math.abs(x - 20) < 30 && Math.abs(z) < 44) continue;
    addBuilding(rect(x, z, w, d, (rnd() - 0.5) * 0.06), 7 + Math.floor(rnd() * 4) * 3.2, { facade: rnd() < 0.5 ? 1 : 4, palette: Math.floor(rnd() * 5), roofShape: rnd() < 0.6 ? 3 : 0, roofMat: rnd() < 0.5 ? 1 : 2 });
  }
  for (let z = z0 + 22; z < z1 - 20; z += 14 + rnd() * 5) for (const x of [x0 + 6, x1 - 6]) {
    if (inSquare(x, z) || Math.abs(x - 20) < 30 && Math.abs(z) < 44) continue;
    addBuilding(rect(x, z, 10 + rnd() * 2, 11 + rnd() * 3, Math.PI / 2 + (rnd() - 0.5) * 0.06), 7 + Math.floor(rnd() * 3) * 3.2, { facade: rnd() < 0.5 ? 1 : 4, palette: Math.floor(rnd() * 5), roofShape: rnd() < 0.6 ? 3 : 0, roofMat: 1 });
  }
}
// buildings at an angle, to prove footprints are real outlines: a row along the cliff top and an L-shaped hall
for (let z = -70; z < 90; z += 22) addBuilding(rect(-96, z, 12, 14, 0.5 + (z % 3) * 0.1), 9.6, { facade: 1, palette: 2, roofShape: 2, roofMat: 2 });
addBuilding([120, -150, 160, -150, 160, -132, 138, -132, 138, -112, 120, -112], 12.8, { facade: 1, palette: 1, roofShape: 0, roofMat: 6, use: 3, name: 'Hall' });
landmarks.push({ id: 1, kind: 'building', x: 138, z: -135, name: 'Hall', mapLabel: 'Hall' });
// low town: sheds by the track
for (let x = -360; x < -150; x += 38) addBuilding(rect(x, 38, 16, 10, 0.03), 5, { facade: 8, palette: 3, roofShape: 0, roofMat: 9, use: 5 });
// a staircase onto a terrace, north-east corner of the square: 8 risers of 0.22 m
{
  const sx = 62, sz = -24, y0 = height(sx, sz);
  for (let i = 0; i < 8; i++) walls.push({ cls: 3, ring: rect(sx + i * 0.35 + 0.175, sz, 0.35, 3, 0), yBase: y0 - 1, yTop: +(y0 + (i + 1) * 0.22).toFixed(2), material: 1, flags: 9, name: 'steps' });
  walls.push({ cls: 3, ring: rect(sx + 8 * 0.35 + 3, sz, 6, 7, 0), yBase: y0 - 1, yTop: +(y0 + 8 * 0.22).toFixed(2), material: 1, flags: 9, name: 'terrace' });
}
// a low wall to mantle, south side of the square, and a taller garden wall
walls.push({ cls: 3, ring: rect(20, 20, 14, 0.5, 0), yBase: height(20, 20) - 1, yTop: +(height(20, 20) + 1.05).toFixed(2), material: 1, flags: 7, name: 'low wall' });
walls.push({ cls: 3, ring: rect(-4, 0, 0.5, 30, 0), yBase: height(-4, 0) - 1, yTop: +(height(-4, 0) + 2.4).toFixed(2), material: 2, flags: 7, name: 'garden wall' });
// a city wall along the cliff top, with a gap at the ramp
for (const [za, zb] of [[-300, RAMP_Z0 - 10], [RAMP_Z1 + 10, 300]]) for (let z = za; z < zb; z += 20) {
  const zc = z + 10; walls.push({ cls: 1, ring: rect(CLIFF_X + 5.5, zc, 1.6, 20, 0), yBase: height(CLIFF_X + 5.5, zc) - 2, yTop: +(height(CLIFF_X + 6, zc) + 1.1).toFixed(2), material: 2, flags: 7, name: 'parapet' });
}
// trees: on the hill and in the low town
for (let i = 0; i < 260; i++) {
  const x = -480 + rnd() * 960, z = -480 + rnd() * 960, s = surface(x, z);
  if (s !== S.grass || slopeAt(x, z) > 0.6) continue;
  trees.push({ x: +x.toFixed(1), z: +z.toFixed(1), height: +(6 + rnd() * 8).toFixed(1), crownRadius: +(2 + rnd() * 2.5).toFixed(2), kind: rnd() < 0.7 ? 1 : 2 });
}

// ---- write -------------------------------------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true }); mkdirSync(join(OUT, 'chunks'), { recursive: true });
const sha = (buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex');
const bbox = (ring) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); } return { x0, x1, z0, z1 }; };
const owner = (ring) => { const b = bbox(ring); return [Math.floor((b.x0 + b.x1) / 2 / CHUNK), Math.floor((b.z0 + b.z1) / 2 / CHUNK)]; };
const rel = (ring, ox, oz) => ring.map((v, i) => +(v - (i % 2 ? oz : ox)).toFixed(2));
const chunkIndex = [];
const n = CHUNK / STEP + 1, m = CHUNK / SSTEP;
for (let cz = -HALF / CHUNK; cz < HALF / CHUNK; cz++) for (let cx = -HALF / CHUNK; cx < HALF / CHUNK; cx++) {
  const ox = cx * CHUNK, oz = cz * CHUNK, h = new Float32Array(n * n), s = new Uint8Array(m * m), walk = new Uint8Array(Math.ceil((m * m) / 8));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = height(ox + i * STEP, oz + j * STEP);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) s[j * m + i] = surface(ox + (i + 0.5) * SSTEP, oz + (j + 0.5) * SSTEP);
  const { q, yMin, yScale } = quantiseHeights(h);
  const mine = (ring) => { const [a, b] = owner(ring); return a === cx && b === cz; };
  const bs = buildings.filter((b) => mine(b.ring)), ws = walls.filter((w) => mine(w.ring));
  const ts = trees.filter((t) => Math.floor(t.x / CHUNK) === cx && Math.floor(t.z / CHUNK) === cz);
  const spill = { minX: 0, maxX: CHUNK, minZ: 0, maxZ: CHUNK };
  for (const r of [...bs, ...ws]) { const b = bbox(r.ring); spill.minX = Math.min(spill.minX, b.x0 - ox); spill.maxX = Math.max(spill.maxX, b.x1 - ox); spill.minZ = Math.min(spill.minZ, b.z0 - oz); spill.maxZ = Math.max(spill.maxZ, b.z1 - oz); }
  const header = { kind: 'chunk', cx, cz, step: STEP, surfaceStep: SSTEP, yMin, yScale, spill,
    buildings: bs.map((b) => ({ ...b, ring: rel(b.ring, ox, oz), holes: [] })),
    walls: ws.map((w) => ({ ...w, ring: rel(w.ring, ox, oz) })),
    trees: ts.map((t) => ({ ...t, x: +(t.x - ox).toFixed(1), z: +(t.z - oz).toFixed(1) })),
    water: [], landmarks: landmarks.filter((l) => Math.floor(l.x / CHUNK) === cx && Math.floor(l.z / CHUNK) === cz).map((l) => ({ ...l, x: l.x - ox, z: l.z - oz })) };
  const buf = writeContainer(header, [{ layer: 'height', type: 'u16', data: q }, { layer: 'surface', type: 'u8', data: s }]);
  const hsh = sha(buf), name = `chunks/${cx}_${cz}.${hsh.slice(0, 16)}.bin`;
  writeFileSync(join(OUT, name), Buffer.from(buf));
  chunkIndex.push({ cx, cz, name, hash: hsh, size: buf.byteLength, spill, y: [+yMin.toFixed(2), +(yMin + 65535 * yScale).toFixed(2)], buildings: bs.length });
}
// far: the whole scene at 10 m, and one hull per building
const FSTEP = 10, fn = (HALF * 2) / FSTEP + 1, fh = new Float32Array(fn * fn);
let hMin = Infinity;
for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) { fh[j * fn + i] = height(-HALF + i * FSTEP, -HALF + j * FSTEP); hMin = Math.min(hMin, fh[j * fn + i]); }
const fq = quantiseHeights(fh);
const farBuf = writeContainer({ kind: 'far', step: FSTEP, nx: fn, nz: fn, minX: -HALF, minZ: -HALF, yMin: fq.yMin, yScale: fq.yScale,
  hulls: buildings.map((b) => ({ ring: b.ring, yBase: b.yBase, top: +(b.yBase + b.hEave + b.hRoof).toFixed(1), facade: b.facade, roofMat: b.roofMat, palette: b.palette })) },
  [{ layer: 'height', type: 'u16', data: fq.q }]);
const farHash = sha(farBuf), farName = `far.${farHash.slice(0, 16)}.bin`;
writeFileSync(join(OUT, farName), Buffer.from(farBuf));

// Georeference: a fictional anchor on a whole kilometre in UTM zone 19T (near Québec, so MGRS reads 19T CM ...).
const georefBlock = { crs: 'EPSG:32619', utm: { zone: 19, hemisphere: 'N', band: 'T' }, anchor: { e0: 340000, n0: 5190000, h0: 0 },
  vertical: { datum: 'none (synthetic)', geoidUndulation: -27.6 }, scaleFactor: 0.9997,
  bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF }, walkable: { minX: -470, maxX: 470, minZ: -470, maxZ: 470 } };
const geo = createGeoref(georefBlock);
georefBlock.anchorGeo = { lat: +geo.anchorGeo.lat.toFixed(7), lon: +geo.anchorGeo.lon.toFixed(7) };
georefBlock.convergenceDeg = +geo.convergenceDeg.toFixed(4);
georefBlock.checks = [[0, 0], [250, -250], [-400, 300], [470, 470], [-470, -470]].map(([x, z]) => { const p = geo.toGeo(x, z), g = geo.toMGRS(x, z); return { x, z, lat: +p.lat.toFixed(8), lon: +p.lon.toFixed(8), mgrs: g.zone + g.square + g.easting + g.northing }; });

const client = { format: 'opus-scene/1', formatMinor: 0, scene_id: 'test', version: '2026-11-15.' + farHash.slice(0, 7), name: 'Engine test scene',
  georef: georefBlock, chunkSize: CHUNK, chunks: chunkIndex, far: { name: farName, hash: farHash, size: farBuf.byteLength },
  water: { level: WATER }, season: 'summer', zones: [{ name: 'High town', ring: [-110, -300, 500, -300, 500, 300, -110, 300] }, { name: 'Low town', ring: [-400, -300, -130, -300, -130, 300, -400, 300] }],
  credits: ['Synthetic test scene generated by engine/tools/make-test-scene.mjs. No map data.'] };
writeFileSync(join(OUT, 'client.json'), JSON.stringify(client, null, 1));
// Host-only by the format (4.9): the dev page plays the reference host and reads this file.
const y = (x, z) => +height(x, z).toFixed(2);
const anchors = [
  { id: 'a-start', kind: 'player_start', x: 20, y: y(20, 26), z: 26, yaw: 0, radius: 1, zone: 'High town' },
  { id: 'a-g1', kind: 'threat_ground', x: 60, y: y(60, -80), z: -80, yaw: 180, radius: 3, zone: 'High town', route: [[60, -80], [20, -80], [20, -40], [60, -40]] },
  { id: 'a-g2', kind: 'threat_ground', x: 140, y: y(140, 80), z: 80, yaw: 270, radius: 3, zone: 'High town', route: [[140, 80], [100, 80], [100, 30], [100, 80]] },
  { id: 'a-a1', kind: 'threat_air', x: 100, y: y(100, -60) + 28, z: -60, yaw: 0, radius: 5, zone: 'High town', route: [[100, -60], [20, -70], [-40, 0], [20, 70], [100, 40]] },
  { id: 'a-cliff', kind: 'observation', x: -110, y: y(-110, 0), z: 0, yaw: 90, radius: 2, zone: 'High town' },
  { id: 'a-hill', kind: 'observation', x: 330, y: y(330, -260), z: -260, yaw: 0, radius: 2, zone: 'High town' },
];
writeFileSync(join(OUT, 'anchors.json'), JSON.stringify(anchors, null, 1));
console.log(`test scene: ${chunkIndex.length} chunks, ${buildings.length} buildings, ${walls.length} walls, ${trees.length} trees, far ${farBuf.byteLength} B, largest chunk ${Math.max(...chunkIndex.map((c) => c.size))} B, ground ${hMin.toFixed(1)} m and up`);
