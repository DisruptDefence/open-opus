// Puts a decoded chunk into the simulation: its height tile into the terrain, its solids into the physics.
// Pure code, shared by the loader (browser) and the tests (node). One record feeds collision, nav and rendering.
import { createGrid } from '../terrain/heightfield.js';
import { CHUNK } from './source.js';

const FACADE_SURFACE = ['concrete', 'concrete', 'concrete', 'brick', 'concrete', 'wood', 'concrete', 'glass', 'metal', 'concrete', 'concrete'];
export const chunkTag = (cx, cz) => `chunk:${cx},${cz}`;

export function installChunk(physics, terrain, c) {
  const tag = chunkTag(c.cx, c.cz);
  terrain.addTile(c.cx, c.cz, createGrid({ nx: c.n, nz: c.n, cell: c.step, minX: c.cx * CHUNK, minZ: c.cz * CHUNK, data: c.heights, surface: c.surface, surfaceCell: c.surfaceStep }));
  for (const b of c.buildings) {
    if (b.flags & 2) continue; // noCollide
    // a building is solid from below its lowest ground to the top of its roof (SCENE-FORMAT 4.2: collision is derived)
    physics.addPrism(b.ring, b.yBase - 3, b.yBase + b.hEave + b.hRoof, { tag, surface: FACADE_SURFACE[b.facade] || 'concrete', ref: b });
  }
  for (const w of c.walls) physics.addPrism(w.ring, w.yBase, w.yTop, { tag, surface: w.material === 8 ? 'metal' : 'concrete', ref: w });
  for (const t of c.trees) {
    const y = terrain.height(t.x, t.z), r = 0.22;
    physics.addPrism([t.x - r, t.z - r, t.x + r, t.z - r, t.x + r, t.z + r, t.x - r, t.z + r], y - 1, y + t.height * 0.6, { tag, surface: 'wood', noNav: false, ref: t });
  }
  return tag;
}
export function uninstallChunk(physics, terrain, cx, cz) { physics.removeTag(chunkTag(cx, cz)); terrain.removeTile(cx, cz); }
