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
import { loadTestScene, oldQuebec, ROOT } from './helpers.js';

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
