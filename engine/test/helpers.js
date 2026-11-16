import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageSource } from '../src/scene/source.js';
import { createTerrain } from '../src/terrain/heightfield.js';
import { createPhysics } from '../src/physics/physics.js';
import { installChunk } from '../src/scene/install.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fileFetch = async (p) => { try { const b = readFileSync(p); return { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return { ok: false, status: 404 }; } };

/** The test scene, every chunk loaded into a terrain and a physics world. */
export async function loadTestScene() {
  const source = await packageSource(join(ROOT, 'scenes', 'test') + '/', fileFetch);
  const far = await source.far(), terrain = createTerrain({ grid: source.manifest.grid, far: far.grid });
  const w = source.manifest.walkable;
  const physics = createPhysics({ terrain, bounds: { min: { x: w.minX, y: -10, z: w.minZ }, max: { x: w.maxX, y: 500, z: w.maxZ } } });
  for (const c of source.manifest.chunks) installChunk(physics, terrain, await source.chunk(c.ce, c.cn));
  return { source, terrain, physics, anchors: JSON.parse(readFileSync(join(ROOT, 'scenes', 'test', 'anchors.json'), 'utf8')) };
}

/** Walk a capsule the way the player controller does: constant wish velocity, gravity, 60 Hz. Returns the trace. */
export function walk(physics, pos, dirX, dirZ, speed, seconds, { radius = 0.32, height = 1.8 } = {}) {
  const vel = { x: 0, y: 0, z: 0 }, dt = 1 / 60; let grounded = true, minClear = Infinity, blocked = null;
  for (let t = 0; t < seconds; t += dt) {
    vel.x = dirX * speed; vel.z = dirZ * speed; vel.y -= 21 * dt;
    const r = physics.moveCapsule(pos, vel, dt, radius, height, grounded);
    grounded = r.onGround; if (r.blocked) blocked = r.blocked;
    minClear = Math.min(minClear, pos.y - physics.terrain.height(pos.x, pos.z));
  }
  return { pos, grounded, minClear, blocked };
}

/** The published Old Quebec scene (the single-file packaging), as parsed JSON. */
export const oldQuebec = () => JSON.parse(readFileSync(join(ROOT, '..', 'scenes', 'old-quebec.json'), 'utf8'));

/**
 * A fixture scene (test/fixtures/<name>.json) as parsed JSON, its terrain filled in from `terrain.plane`
 * ({ y0, sx, sz }: y = y0 + sx (x - minX) + sz (z - minZ)) or from `f(x, z)` when given.
 */
export function fixture(name, f) {
  const s = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', name + '.json'), 'utf8')), t = s.terrain, p = t.plane || { y0: 0, sx: 0, sz: 0 };
  const q = Buffer.alloc(t.nx * t.nz * 2);
  for (let j = 0; j < t.nz; j++) for (let i = 0; i < t.nx; i++) { const x = t.minX + i * t.cell, z = t.minZ + j * t.cell; q.writeUInt16LE(Math.round((f ? f(x, z) : p.y0 + p.sx * (x - t.minX) + p.sz * (z - t.minZ)) / t.unit), (j * t.nx + i) * 2); }
  t.data = q.toString('base64');
  return s;
}
/** Every chunk of a scene source, decoded and installed: { source, terrain, physics, chunks: Map key -> { chunk, env } }. */
export async function installAll(source) {
  const m = source.manifest, far = await source.far(), terrain = createTerrain({ grid: m.grid, far: far.grid }), w = m.walkable;
  const physics = createPhysics({ terrain, bounds: { min: { x: w.minX, y: -10, z: w.minZ }, max: { x: w.maxX, y: 500, z: w.maxZ } } });
  const chunks = new Map();
  for (const c of m.chunks) { const chunk = await source.chunk(c.ce, c.cn); chunks.set(m.grid.key(c.ce, c.cn), { chunk, env: installChunk(physics, terrain, chunk, m.style) }); }
  return { source, terrain, physics, chunks };
}
/** How many triangles of a soup face away from `centre` ([x, y, z]). */
export function inward(s, centre) {
  let bad = 0;
  for (let i = 0; i < s.pos.length; i += 9) {
    const c = [0, 1, 2].map((k) => (s.pos[i + k] + s.pos[i + 3 + k] + s.pos[i + 6 + k]) / 3 - centre[k]);
    if (c[0] * s.nrm[i] + c[1] * s.nrm[i + 1] + c[2] * s.nrm[i + 2] <= 0) bad++;
  }
  return bad;
}
/** The area on the plan of a soup's triangles that face up (normal y > 0.05). */
export function planArea(s) {
  let a = 0;
  for (let i = 0; i < s.pos.length; i += 9) { if (s.nrm[i + 1] <= 0.05) continue; a += Math.abs((s.pos[i + 3] - s.pos[i]) * (s.pos[i + 8] - s.pos[i + 2]) - (s.pos[i + 6] - s.pos[i]) * (s.pos[i + 5] - s.pos[i + 2])) / 2; }
  return a;
}
/** All soups of a set as one list of [x, y, z] vertices. */
export const vertices = (soups) => { const out = []; for (const s of soups.map.values()) for (let i = 0; i < s.pos.length; i += 3) out.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]); return out; };
/** A decoded building record with every field, for generator tests: a 9 m wall and a 3 m roof on ground at 30 m. */
export const building = (ring, o = {}) => ({ id: 7, ring, holes: [], yBase: 30, yMin: 30, hEave: 9, hRoof: 3, levels: 3, roofShape: 1, roofDir: 255, roofMat: 1, roofColor: null, facade: 1, tint: [0.5, 0.5, 0.5], use: 0,
  blind: new Set(), front: new Set(), groundFloor: 0, passages: [], name: '', kind: '', part: false, ...o });
