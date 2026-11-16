// Puts a decoded chunk into the simulation: its height tile into the terrain, its solids into the physics.
// Pure code, shared by the loader (browser) and the tests (node). One record feeds collision, nav and rendering:
// every solid here comes from the function that draws it (gen/mesher.js), so what is drawn is what collides.
//
//   ground     the chunk's heights, plus the sidewalks' lift (gen/ground.js liftRaster), in one height tile
//   buildings  one prism per piece (gen/passage.js), with the piece's holes (a courtyard is open, as drawn): a piece that starts above the ground is walked under
//   walls      one prism per ring of gen/structures.js wallRings (a rail collides as its thin ring)
//   props      from the kit's collider (gen/props.js): a post stops a walker and a shot but closes no nav cell
//   trees      the trunk
import { createGrid } from '../terrain/heightfield.js';
import { chunkEnv, chunkLift, piecesOf, wallSolids, propSolid } from '../gen/mesher.js';
import { resolveStyle } from '../gen/style.js';

const FACADE_SURFACE = ['concrete', 'concrete', 'concrete', 'brick', 'concrete', 'wood', 'concrete', 'glass', 'metal', 'concrete', 'concrete'];
export const chunkTag = (ce, cn) => `chunk:${ce},${cn}`;
let neutral = null;

/** `style` is the scene's resolved style (manifest.style); the neutral one when a caller has none. Returns the chunk's generator environment. */
export function installChunk(physics, terrain, c, style) {
  style = style || neutral || (neutral = resolveStyle());
  const tag = chunkTag(c.ce, c.cn);
  const tile = createGrid({ nx: c.n, nz: c.n, cell: c.step, minX: c.hx0, minZ: c.hz0, data: c.heights, surface: c.surface, surfaceCell: c.surfaceStep, surfaceN: c.sn, lift: chunkLift(c, style), liftCell: 1, liftN: c.sn });
  terrain.addTile(c.ce, c.cn, tile);
  const env = chunkEnv(tile, style), groundAt = env.groundAt;
  for (const b of c.buildings) {
    if (b.flags & 2) continue; // noCollide
    const top = b.yBase + b.hEave + b.hRoof;
    for (const p of piecesOf(b)) {
      // solid from below its lowest ground to the top of its roof (SCENE-FORMAT 4.2: collision is derived); a part
      // or a piece that starts above the ground is solid from there, and a body passes under it
      const from = p.yMin != null && p.yMin > b.yBase + 0.01 ? p.yMin : b.yBase - 3;
      if (top > from) physics.addPrism(p.ring, from, top, { tag, holes: p.holes, surface: FACADE_SURFACE[b.facade] || 'concrete', ref: b });
    }
  }
  for (const w of c.walls) for (const r of wallSolids(w, groundAt)) physics.addPrism(r.ring, r.yBase, r.yTop, { tag, surface: w.material === 8 ? 'metal' : 'concrete', ref: w });
  for (const p of c.props || []) {
    const s = propSolid(p); if (!s) continue;
    const y = groundAt(p.x, p.z);
    physics.addPrism(s.ring, y - 0.5, y + s.h, { tag, surface: 'metal', noNav: !s.nav, ref: p });
  }
  for (const t of c.trees) {
    const y = groundAt(t.x, t.z), r = 0.22;
    physics.addPrism([t.x - r, t.z - r, t.x + r, t.z - r, t.x + r, t.z + r, t.x - r, t.z + r], y - 1, y + t.height * 0.6, { tag, surface: 'wood', noNav: false, ref: t });
  }
  return env;
}
export function uninstallChunk(physics, terrain, ce, cn) { physics.removeTag(chunkTag(ce, cn)); terrain.removeTile(ce, cn); }
