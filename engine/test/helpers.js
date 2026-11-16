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
