import test from 'node:test';
import assert from 'node:assert/strict';
import { writeContainer, readContainer, quantiseHeights, dequantiseHeights } from '../src/scene/container.js';
import { createRaster, lineToRings } from '../src/scene/source.js';
import { loadTestScene } from './helpers.js';

test('the container round-trips a header and typed sections', () => {
  const h = new Float32Array([0, 1.5, 97.25, 30]), { q, yMin, yScale } = quantiseHeights(h);
  const buf = writeContainer({ kind: 'chunk', cx: -1, cz: 2, yMin, yScale, name: 'é' }, [{ layer: 'height', type: 'u16', data: q }, { layer: 'surface', type: 'u8', data: new Uint8Array([1, 2, 3]) }, { layer: 'later', type: 'zz', data: new Uint8Array(4) }]);
  const { header, layers } = readContainer(buf);
  assert.equal(header.cx, -1); assert.equal(header.name, 'é');
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
test('the test scene package: manifest, chunk edges shared, y >= 0, records in game metres', async () => {
  const { source, terrain } = await loadTestScene();
  assert.equal(source.manifest.chunks.length, 16);
  const a = await source.chunk(0, 0), b = await source.chunk(1, 0);
  assert.equal(a.n, 126);
  for (let j = 0; j < a.n; j++) assert.ok(Math.abs(a.heights[j * a.n + a.n - 1] - b.heights[j * b.n]) < 0.01, 'east edge of (0,0) equals west edge of (1,0)');
  for (const c of [a, b]) for (const h of c.heights) assert.ok(h >= 0);
  for (const bd of a.buildings) for (let i = 0; i < bd.ring.length; i += 2) assert.ok(bd.ring[i] > -40 && bd.ring[i] < 290);
  // relief: a cliff of more than 20 m within 10 m of ground, and a hill
  assert.ok(terrain.height(-112, 0) - terrain.height(-128, 0) > 20);
  assert.ok(terrain.height(330, -260) > 60);
  assert.equal(terrain.surfaceAt(20, 0), 'cobble'); assert.equal(terrain.surfaceAt(100, 40), 'asphalt');
});
