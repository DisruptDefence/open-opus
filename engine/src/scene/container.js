// The chunk and far file container of docs/SCENE-FORMAT.md 3.2: magic `OPSC`, uint32 container version, uint32
// header length, a UTF-8 JSON header, then binary sections aligned to 4 bytes, little-endian. Pure code: the scene
// builder (engine/tools/make-test-scene.mjs) writes with it, the loader reads with it, the tests do both.
//
// Deviation from the format as written, stated here and in engine/README.md ("Where the scene reader differs"): the raster layers (heights, surface,
// walk mask) are binary sections as specified; the vector layers (buildings, walls, trees, water, landmarks) are
// JSON records inside the header for now, with the specified fields and enum values, instead of fixed-size binary
// records with a shared vertex pool. A dense town chunk stays well under the 600 KB budget after HTTP compression
// either way; the binary records are a size optimisation that does not change what a reader sees.

const MAGIC = 0x4353504f; // 'OPSC' little-endian
const TYPES = { u8: Uint8Array, u16: Uint16Array, f32: Float32Array };

/** sections: [{ layer, type: 'u8' | 'u16' | 'f32', data: TypedArray }] -> ArrayBuffer */
export function writeContainer(header, sections) {
  const list = []; let offset = 0;
  for (const s of sections) {
    const bytes = s.data.byteLength;
    list.push({ layer: s.layer, type: s.type, offset, length: bytes, count: s.data.length });
    offset += (bytes + 3) & ~3;
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...header, sections: list }));
  const hlen = (json.length + 3) & ~3, buf = new ArrayBuffer(12 + hlen + offset), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, 1, true); dv.setUint32(8, hlen, true);
  u8.set(json, 12); for (let i = json.length; i < hlen; i++) u8[12 + i] = 0x20;
  sections.forEach((s, i) => u8.set(new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.byteLength), 12 + hlen + list[i].offset));
  return buf;
}

/** ArrayBuffer -> { header, layers: { name: TypedArray } } */
export function readContainer(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('scene container: bad magic');
  if (dv.getUint32(4, true) !== 1) throw new Error('scene container: version ' + dv.getUint32(4, true) + ' is not read by this engine');
  const hlen = dv.getUint32(8, true), header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
  const layers = {};
  for (const s of header.sections || []) {
    const T = TYPES[s.type]; if (!T) continue; // unknown is ignorable (format principle 5)
    layers[s.layer] = new T(buf.slice(12 + hlen + s.offset, 12 + hlen + s.offset + s.length));
  }
  return { header, layers };
}

/** Heights are stored as uint16: y = yMin + q * yScale. */
export function quantiseHeights(h) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  const yScale = Math.max(0.001, Math.ceil(((hi - lo) / 65535) * 1000) / 1000) , q = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) q[i] = Math.round((h[i] - lo) / yScale);
  return { q, yMin: lo, yScale };
}
export function dequantiseHeights(q, yMin, yScale) {
  const h = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) h[i] = yMin + q[i] * yScale;
  return h;
}
