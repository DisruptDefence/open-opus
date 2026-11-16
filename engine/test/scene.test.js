import test from 'node:test';
import assert from 'node:assert/strict';
import { writeContainer, readContainer, quantiseHeights, dequantiseHeights } from '../src/scene/container.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRaster, lineToRings, jsonSource } from '../src/scene/source.js';
import { chunkGrid } from '../src/scene/grid.js';
import { createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics } from '../src/physics/physics.js';
import { installChunk } from '../src/scene/install.js';
import { loadTestScene, oldQuebec, ROOT, fixture, installAll } from './helpers.js';
import { DEFAULT_STYLE, resolveStyle, parseColor } from '../src/gen/style.js';
import { linear } from '../src/gen/soup.js';
import { legacyTint } from '../src/scene/source.js';
import { existsSync } from 'node:fs';

test('the container round-trips a header and typed sections', () => {
  const h = new Float32Array([0, 1.5, 97.25, 30]), { q, yMin, yScale } = quantiseHeights(h);
  const buf = writeContainer({ kind: 'chunk', ce: -1, cn: 2, yMin, yScale, name: 'é' }, [{ layer: 'height', type: 'u16', data: q }, { layer: 'surface', type: 'u8', data: new Uint8Array([1, 2, 3]) }, { layer: 'later', type: 'zz', data: new Uint8Array(4) }]);
  const { header, layers } = readContainer(buf);
  assert.equal(header.ce, -1); assert.equal(header.name, 'é');
  assert.deepEqual([...layers.surface], [1, 2, 3]);
  assert.equal(layers.later, undefined); // an unknown layer type is skipped, not an error
  const back = dequantiseHeights(layers.height, header.yMin, header.yScale);
  for (let i = 0; i < h.length; i++) assert.ok(Math.abs(back[i] - h[i]) < yScale);
  assert.throws(() => readContainer(new ArrayBuffer(16)), /bad magic/);
});
test('the raster painter fills polygons and lines', () => {
  const r = createRaster(0, 0, 20, 20, 4);
  r.polygon([2, 2, 10, 2, 10, 10, 2, 10], 7, [[4, 4, 6, 4, 6, 6, 4, 6]]);
  assert.equal(r.at(3, 3), 7); assert.equal(r.at(5, 5), 4); assert.equal(r.at(15, 15), 4);
  r.line([0, 15, 20, 15], 4, 1);
  assert.equal(r.at(10, 15.5), 1); assert.equal(r.at(10, 18.5), 4);
  assert.equal(lineToRings([0, 0, 10, 0, 10, 10], 1).length, 2);
});
test('the chunk grid is the absolute UTM grid of the format, whatever the anchor', () => {
  // SCENE-FORMAT.md 3.1: chunk (ce, cn) covers eastings [250 ce, 250 (ce + 1)) and northings [250 cn, 250 (cn + 1))
  const g = chunkGrid(331641, 5186615); // the Old Quebec anchor: not on a chunk corner
  assert.equal(g.ce(0), 1326); assert.equal(g.cn(0), 20746);
  assert.equal(g.x0(1326), 331500 - 331641); assert.equal(g.z0(20746), 5186615 - 5186750, 'the minimum corner is the north-west one');
  for (const [x, z] of [[0, 0], [-141, 115], [-141.01, 115.01], [108.99, -134.99], [109, -135], [417.3, -388.2]]) {
    const E = 331641 + x, N = 5186615 - z, ce = g.ce(x), cn = g.cn(z);
    assert.ok(250 * ce <= E && E < 250 * (ce + 1), `easting of ${x}`); assert.ok(250 * cn <= N && N < 250 * (cn + 1), `northing of ${z}`);
    assert.ok(x >= g.x0(ce) && x < g.x0(ce) + 250 && z > g.z0(cn) && z <= g.z0(cn) + 250, 'the point lies in its chunk in game metres');
  }
  // every fourth edge is a 1 km grid line, and a neighbouring scene with another anchor names the same ground the same
  assert.equal((g.x0(1328) + 331641) % 1000, 0);
  const other = chunkGrid(332900, 5187033), x = 250, z = -90, E = 331641 + x, N = 5186615 - z;
  assert.deepEqual([other.ce(E - 332900), other.cn(5187033 - N)], [g.ce(x), g.cn(z)]);
});
test('the test scene package: 2.2 manifest, chunks on the absolute grid, edges shared, y >= 0, records in game metres', async () => {
  const { source, terrain } = await loadTestScene();
  const m = source.manifest, g = m.grid, raw = JSON.parse(readFileSync(join(ROOT, 'scenes', 'test', 'client.json'), 'utf8'));
  assert.equal(raw.packaging, 'chunked'); assert.ok(raw.play && raw.extent && !raw.georef.bounds, 'play and extent sit beside georef (2.2)');
  assert.notEqual(m.georef.easting % 250, 0, 'the anchor is off the chunk grid, as a real scene\'s is');
  assert.equal(m.chunks.length, 25);
  for (const c of raw.chunks) {
    assert.ok(c.name.startsWith(`chunks/${c.ce}_${c.cn}.`), c.name);
    // the chunk's ground, in UTM, is the 250 m square its numbers name
    const E = m.georef.easting + g.x0(c.ce), N = m.georef.northing - g.z0(c.cn);
    assert.equal(E, 250 * c.ce); assert.equal(N, 250 * (c.cn + 1));
    assert.ok(g.x0(c.ce) >= raw.extent.minX && g.x0(c.ce) + 250 <= raw.extent.maxX && g.z0(c.cn) >= raw.extent.minZ && g.z0(c.cn) + 250 <= raw.extent.maxZ, 'inside the extent');
  }
  const ce = g.ce(20), cn = g.cn(0), a = await source.chunk(ce, cn), b = await source.chunk(ce + 1, cn), north = await source.chunk(ce, cn + 1);
  assert.equal(a.n, 126); assert.equal(a.x0, g.x0(ce)); assert.equal(a.z0, g.z0(cn));
  for (let j = 0; j < a.n; j++) assert.ok(Math.abs(a.heights[j * a.n + a.n - 1] - b.heights[j * b.n]) < 0.01, 'the east edge equals the west edge of the chunk to the east');
  for (let i = 0; i < a.n; i++) assert.ok(Math.abs(a.heights[i] - north.heights[(a.n - 1) * a.n + i]) < 0.01, 'the first row (minimum z) equals the last row of the chunk to the NORTH: cn counts north');
  for (const c of [a, b]) for (const h of c.heights) assert.ok(h >= 0);
  // records are stored once, in the chunk of their bounding box's centre, and come back in game metres
  assert.ok(a.buildings.length > 3);
  for (const bd of a.buildings) { let x = 0, z = 0; for (let i = 0; i < bd.ring.length; i += 2) { x += bd.ring[i]; z += bd.ring[i + 1]; } assert.equal(g.ce(x / (bd.ring.length / 2)), ce); assert.equal(g.cn(z / (bd.ring.length / 2)), cn); }
  // the ground is where the generator put it, to the quantisation: the square at 30 m, the low town, the cliff, the hill
  assert.ok(Math.abs(terrain.height(20, 0) - 30) < 0.01); assert.ok(terrain.height(-300, 20) > 0.5 && terrain.height(-300, 20) < 8, 'the low town');
  assert.ok(terrain.height(-112, 0) - terrain.height(-128, 0) > 20);
  assert.ok(terrain.height(330, -260) > 60);
  assert.equal(terrain.surfaceAt(20, 0), 'cobble'); assert.equal(terrain.surfaceAt(100, 40), 'asphalt');
  assert.equal(terrain.surfaceAt(20, -31.5), 'cobble'); assert.equal(terrain.surfaceAt(20, -32.5), 'asphalt', 'the surface raster is not shifted or flipped: the square ends at z = -32');
});
test('the Old Quebec single file is cut into the same absolute chunks, with the ground where the file has it', async () => {
  const scene = oldQuebec(), source = jsonSource(scene), g = source.manifest.grid, t = scene.terrain;
  assert.equal(scene.packaging, 'single');
  assert.deepEqual([g.ce(0), g.cn(0)], [1326, 20746]);
  assert.ok(source.has(1326, 20746) && !source.has(0, 0), 'chunks are not numbered from the anchor');
  const ext = scene.extent;
  for (const c of source.manifest.chunks) assert.ok(g.x0(c.ce) < ext.maxX && g.x0(c.ce) + 250 > ext.minX && g.z0(c.cn) < ext.maxZ && g.z0(c.cn) + 250 > ext.minZ, 'every chunk touches the extent');
  assert.equal(source.manifest.chunks.length, (g.ce(ext.maxX - 0.01) - g.ce(ext.minX) + 1) * (g.cn(ext.minZ) - g.cn(ext.maxZ - 0.01) + 1));
  // heights straight from the file's terrain block, at its own samples
  const q = Buffer.from(t.data, 'base64'), fileHeight = (i, j) => q.readUInt16LE((j * t.nx + i) * 2) * t.unit;
  const far = await source.far(), terrain = createTerrain({ grid: g, far: far.grid }), physics = createPhysics({ terrain, bounds: { min: { x: ext.minX, y: -10, z: ext.minZ }, max: { x: ext.maxX, y: 500, z: ext.maxZ } } });
  for (const c of source.manifest.chunks) installChunk(physics, terrain, await source.chunk(c.ce, c.cn));
  for (const [i, j] of [[188, 168], [10, 10], [300, 40], [57, 311], [376, 336], [0, 0]]) {
    const x = t.minX + i * t.cell, z = t.minZ + j * t.cell;
    assert.ok(Math.abs(terrain.height(x, z, true) - fileHeight(i, j)) < 0.01, `ground at ${x}, ${z}`);
  }
  // every building is in exactly one chunk, the one its bounding box's centre lies in
  let n = 0;
  for (const c of source.manifest.chunks) for (const b of (await source.chunk(c.ce, c.cn)).buildings) {
    n++; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < b.ring.length; i += 2) { x0 = Math.min(x0, b.ring[i]); x1 = Math.max(x1, b.ring[i]); z0 = Math.min(z0, b.ring[i + 1]); z1 = Math.max(z1, b.ring[i + 1]); }
    assert.deepEqual([g.ce((x0 + x1) / 2), g.cn((z0 + z1) / 2)], [c.ce, c.cn]);
  }
  assert.equal(n, scene.buildings.filter((b) => b.r && b.r.length >= 6 && b.k !== 'roof').length);
});

// ---- the records of docs/plans/SCENE-DETAIL.md section 3, read with defaults --------------------------------------
const everything = async (source) => { const out = { buildings: [], walls: [], roads: [], trees: [], props: [], crossings: new Set(), chunks: [] }; for (const c of source.manifest.chunks) { const ch = await source.chunk(c.ce, c.cn); out.chunks.push(ch); for (const k of ['buildings', 'walls', 'roads', 'trees', 'props']) out[k].push(...ch[k]); for (const x of ch.crossings) out.crossings.add(x.x + ',' + x.z); } return out; };
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);

test('a scene written before formatMinor 1 decodes with the rules the engine drew with: nothing moves', async () => {
  const source = jsonSource(fixture('scene-old')), all = await everything(source), m = source.manifest;
  assert.equal(m.formatMinor, 0); assert.deepEqual(m.style, resolveStyle()); assert.equal(m.season, 'summer'); assert.equal(m.ambience, null);
  assert.equal(all.buildings.length, 6, 'the `roof` kind is not a building; an outline with parts is still drawn in an old file');
  const shop = all.buildings.find((b) => b.kind === 'retail'), hall = all.buildings.find((b) => b.name === 'Hall');
  // file order numbers the records; the old picks read the number of the next one
  assert.equal(shop.id, 1); assert.equal(shop.roofShape, 3, 'no roof tag, between 6 and 22 m: mansard'); assert.ok(Math.abs(shop.hRoof - 14.2 * 0.28) < 1e-9 && Math.abs(shop.hEave + shop.hRoof - 14.2) < 1e-9);
  assert.equal(shop.facade, 1); assert.ok(near(shop.tint, legacyTint(2))); assert.equal(shop.roofColor, null); assert.equal(shop.roofMat, 1);
  assert.deepEqual([shop.levels, shop.roofDir, shop.use, shop.groundFloor, shop.blind.size, shop.front.size, shop.passages.length, shop.yMin - shop.yBase], [0, 255, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([hall.id, hall.roofShape, hall.facade, hall.roofMat, hall.levels], [2, 2, 3, 2, 3]); assert.ok(near(hall.roofColor, linear('#67B083'))); assert.ok(near(hall.tint, legacyTint(3)));
  const rampart = all.walls.find((w) => w.name === 'Rampart'), fence = all.walls.find((w) => w.kind === 'fence');
  assert.deepEqual([rampart.cls, rampart.thickness, rampart.material, rampart.height, rampart.parapet, rampart.crenels, rampart.rail], [1, 2.4, 1, 6, null, false, null]);
  assert.deepEqual([fence.cls, fence.thickness, fence.material, fence.height], [4, 0.12, 8, 1.1]);
  const t = all.trees.find((x) => x.x === -60);
  assert.ok(Math.abs(t.height - (7 + ((-60 * 13.7 + 80 * 7.3) % 5 + 5) % 5)) < 1e-9 && t.kind === 1 && t.form === 0 && t.crownRadius >= 2.5);
  const street = all.roads.find((r) => r.name === 'Long Street'), stair = all.roads.find((r) => r.kind === 'steps'), path = all.roads.find((r) => r.kind === 'footway');
  assert.deepEqual([street.cls, street.surface, street.width, street.sidewalk, street.steps, street.lit, street.marking], [4, 1, 6, 'no', null, false, 0]);
  assert.equal(path.surface, 4); assert.ok(stair.steps.count >= 2 && stair.steps.handrail === 0);
  assert.equal(all.props.length, 0); assert.equal(all.crossings.size, 0);
});

test('a scene with the keys of formatMinor 1 decodes to what it says', async () => {
  const scene = fixture('scene-new'), source = jsonSource(scene), all = await everything(source), m = source.manifest;
  assert.equal(m.formatMinor, 1); assert.equal(m.season, 'autumn'); assert.equal(m.ambience.tod, 16.5);
  assert.equal(m.style.window.reveal, 0.18); assert.deepEqual(m.style.cornice, DEFAULT_STYLE.cornice, 'a key the scene leaves out keeps the neutral value'); assert.deepEqual(m.style.palettes.stucco, DEFAULT_STYLE.palettes.stucco);
  const by = (id) => all.buildings.find((b) => b.id === id), shop = by(2890417532), hall = by(77001);
  assert.deepEqual([shop.roofShape, shop.hRoof, shop.levels, shop.roofDir, shop.roofMat, shop.facade, shop.use, shop.groundFloor, shop.heightSource], [3, 4.1, 3, 255, 1, 1, 2, 1, 'measured']);
  assert.ok(Math.abs(shop.hEave - 10.1) < 1e-9); assert.deepEqual([...shop.blind], [1, 3]); assert.deepEqual([...shop.front], [0]);
  assert.ok(near(shop.tint, linear('#8f8a80')), 'palette 2 of the style\'s stone_ashlar'); assert.ok(near(shop.roofColor, linear('#9aa0a3')), 'roof palette 0 of metal_seam');
  assert.equal(hall.roofDir, 90); assert.ok(near(hall.roofColor, linear('#67B083')), 'a tagged colour wins over the roof palette'); assert.ok(near(hall.tint, linear('#9a5a40')));
  assert.equal(by(77003), undefined, 'an outline with `parts: 1` is in no chunk: its parts draw it'); assert.ok(by(77004).part);
  assert.equal(by(77005).yMin, by(77005).yBase + 12, 'a part with a min height starts there'); assert.equal(by(77004).yMin, by(77004).yBase);
  assert.deepEqual(by(77006).passages, [{ x1: -60, z1: 23.5, x2: -60, z2: 36.5, w: 4, h: 5 }]);
  // every building, tree and prop is in exactly one cell, the one its box's centre lies in
  for (const kind of ['buildings', 'trees', 'props']) assert.equal(all.chunks.reduce((n, c) => n + c.cells.reduce((k, cell) => k + cell[kind].length, 0), 0), all[kind].length, kind);
  for (const c of all.chunks) { assert.equal(c.cells.length, 16); for (const cell of c.cells) for (const t of cell.trees) assert.ok(t.x >= cell.x0 && t.x <= cell.x1 && t.z >= cell.z0 && t.z <= cell.z1); }
  // a road belongs to every chunk it reaches, and the pieces either side of a chunk edge overlap there
  const g = m.grid, edge = g.x0(g.ce(0)), west = all.chunks.find((c) => c.ce === g.ce(-105) && c.cn === g.cn(-20)), east = all.chunks.find((c) => c.ce === g.ce(-95) && c.cn === g.cn(-20));
  assert.equal(edge, -100);
  const reach = (c) => { let lo = Infinity, hi = -Infinity; for (const r of c.roads) if (r.name === 'Long Street') for (let i = 0; i < r.pts.length; i += 2) { lo = Math.min(lo, r.pts[i]); hi = Math.max(hi, r.pts[i]); } return [lo, hi]; };
  assert.ok(reach(west)[1] >= edge && reach(west)[1] <= edge + 6.01, `the west chunk's piece ends just past the edge (${reach(west)[1]})`); assert.ok(reach(east)[0] <= edge && reach(east)[0] >= edge - 6.01);
  const street = east.roads.find((r) => r.name === 'Long Street'), stair = all.roads.find((r) => r.kind === 'steps');
  assert.deepEqual([street.sidewalk, street.lit, street.marking, street.surface, street.len], ['both', true, 1, 1, 300]); assert.deepEqual(stair.steps, { count: 12, handrail: 1 }); assert.equal(stair.surface, 9);
  for (const c of all.chunks) for (const cell of c.cells) for (const r of cell.roads) { const k = r.width / 2 + 3; for (let i = 0; i < r.pts.length; i += 2) assert.ok(r.pts[i] >= cell.x0 - k - 1e-6 && r.pts[i] <= cell.x1 + k + 1e-6 && r.pts[i + 1] >= cell.z0 - k - 1e-6 && r.pts[i + 1] <= cell.z1 + k + 1e-6); assert.ok(Math.abs(r.pts[0] - (-110 + r.s0)) < 1e-6 || r.name !== 'Long Street', 's0 is the distance along the whole way'); }
  assert.equal(all.crossings.size, 2); const x = all.chunks.flatMap((c) => c.crossings).find((k) => k.x === 30); assert.ok(Math.abs(x.yaw + Math.PI / 2) < 1e-9 && x.width === 6);
  assert.ok(west.crossings.some((k) => k.x === -99) && east.crossings.some((k) => k.x === -99), 'a crossing by a chunk edge is in both chunks');
  // walls: the new keys, and pieces cut exactly at cell edges, each in one cell, none lost
  const scarp = all.walls.find((w) => w.parapet === 1.4), fence = all.walls.find((w) => w.rail);
  assert.deepEqual([scarp.thickness, scarp.material, scarp.crenels, scarp.cls], [2.4, 1, true, 1]); assert.deepEqual([fence.rail, fence.thickness, fence.material], ['rail_iron', 0.08, 8]);
  const len = (pts) => { let s = 0; for (let i = 0; i + 3 < pts.length; i += 2) s += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]); return s; };
  assert.ok(Math.abs(all.walls.reduce((s, w) => s + len(w.pts), 0) - (14 + 74 + 50 + 40)) < 1e-3, 'the pieces add up to the lines');
  for (const c of all.chunks) for (const cell of c.cells) for (const w of cell.walls) for (let i = 0; i < w.pts.length; i += 2) assert.ok(w.pts[i] >= cell.x0 - 1e-9 && w.pts[i] <= cell.x1 && w.pts[i + 1] >= cell.z0 - 1e-9 && w.pts[i + 1] <= cell.z1);
  assert.deepEqual(all.trees.find((t) => t.x === -60), { x: -60, z: 80, height: 14.5, crownRadius: 4.6, kind: 1, form: 1 });
  assert.equal(all.props.length, 4); const lamp = all.props.find((p) => p.kind === 'lamp_lantern'), cannon = all.props.find((p) => p.kind === 'cannon');
  assert.ok(Math.abs(lamp.yaw + Math.PI / 2) < 1e-9 && lamp.source === 0 && cannon.source === 1 && Math.abs(cannon.yaw + (135 * Math.PI) / 180) < 1e-9);
  // the surface raster takes `sf` and the bare-ground areas
  const { terrain } = await installAll(source);
  assert.equal(terrain.surfaceAt(120, -40), 'rock'); assert.equal(terrain.surfaceAt(170, 80), 'rock'); assert.equal(terrain.surfaceAt(-60, 40), 'cobble'); assert.equal(terrain.surfaceAt(80, 15), 'cobble');
});

test('the neutral style has every key of the country-wide pack\'s client part, and colours parse', () => {
  assert.deepEqual(parseColor('#fff'), [1, 1, 1]); assert.deepEqual(parseColor('white'), [1, 1, 1]); assert.equal(parseColor('greenish'), null); assert.ok(near(parseColor('#67B083'), linear(0x67b083)));
  for (const list of [...Object.values(DEFAULT_STYLE.palettes), ...Object.values(DEFAULT_STYLE.roofs), DEFAULT_STYLE.trim, DEFAULT_STYLE.frames, DEFAULT_STYLE.doors, DEFAULT_STYLE.awnings]) for (const c of list) assert.ok(parseColor(c), c);
  const pack = join(ROOT, '..', 'styles', 'canada.json');
  if (!existsSync(pack)) return; // the pack is written by the builder's item; until it is merged there is nothing to compare
  const client = JSON.parse(readFileSync(pack, 'utf8')).client;
  for (const k of Object.keys(client)) assert.ok(k in DEFAULT_STYLE, `styles/canada.json client key "${k}" is missing from gen/style.js DEFAULT_STYLE`);
});
