// Puts a decoded chunk into the simulation: its height tile into the terrain, its solids into the physics.
// Pure code, shared by the loader (browser) and the tests (node). One record feeds collision, nav and rendering:
// every solid here comes from the function that draws it (gen/mesher.js), so what is drawn is what collides.
//
//   ground     the chunk's heights, plus the sidewalks' lift (gen/ground.js liftRaster), in one height tile
//   buildings  one prism per piece (gen/passage.js), with the piece's holes (a courtyard is open, as drawn): a piece that starts above the ground is walked under
//   doors      a street door that opens (gen/vestibule.js) carves its hall out of the piece's prism and adds what fills the rest
//              (lintels, floor, step, a nav plug, the shut leaf); the handles are returned as `env.doors` for world/doors.js. The
//              same whatever the detail radius: the records come from the same generator that draws them
//   walls      one prism per ring of gen/structures.js wallRings (a rail collides as its thin ring)
//   props      from the kit's collider (gen/props.js): a post stops a walker and a shot but closes no nav cell
//   trees      the trunk
import { createGrid } from '../terrain/heightfield.js';
import { chunkEnv, chunkLift, piecesOf, wallSolids, propSolid, doorRecords } from '../gen/mesher.js';
import { carveRing, doorSolids } from '../gen/vestibule.js';
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
  const doors = [];
  for (const b of c.buildings) {
    if (b.flags & 2) continue; // noCollide
    const top = b.yBase + b.hEave + b.hRoof, recs = doorRecords(b, groundAt, style);
    for (const p of piecesOf(b)) {
      // solid from below its lowest ground to the top of its roof (SCENE-FORMAT 4.2: collision is derived); a part
      // or a piece that starts above the ground is solid from there, and a body passes under it
      const from = p.yMin != null && p.yMin > b.yBase + 0.01 ? p.yMin : b.yBase - 3;
      if (!(top > from)) continue;
      const mine = recs.filter((r) => r.ring === p.ring), surface = FACADE_SURFACE[b.facade] || 'concrete';
      physics.addPrism(mine.length ? carveRing(p.ring, mine) : p.ring, from, top, { tag, holes: p.holes, surface, ref: b });
      for (const rec of mine) doors.push(addDoor(physics, rec, top, tag, b));
    }
  }
  for (const w of c.walls) for (const r of wallSolids(w, groundAt)) physics.addPrism(r.ring, r.yBase, r.yTop, { tag, surface: w.material === 8 ? 'metal' : 'concrete', ref: w });
  for (const p of c.props || []) {
    const s = propSolid(p); if (!s) continue;
    const y = groundAt(p.x, p.z);
    physics.addPrism(s.ring, y - 0.5, y + s.h, { tag, surface: 'metal', noNav: !s.nav, ref: p });
  }
  for (const t of c.trees) addTreeSolid(physics, t, groundAt(t.x, t.z), tag);
  env.doors = doors;
  return env;
}
/** A tree's trunk as a solid, tagged `kind: 'tree'` with its record as `ref` (a hit on it damages that tree). A felled tree keeps only its stump. */
function addTreeSolid(physics, t, y, tag) {
  const r = 0.22;
  return physics.addPrism([t.x - r, t.z - r, t.x + r, t.z - r, t.x + r, t.z + r, t.x - r, t.z + r], y - 1, y + (t.fell ? t.fell.h : t.height * 0.6), { tag, surface: 'wood', noNav: false, ref: t, kind: 'tree' });
}
/** After a tree was felled: replace its trunk solid by the stump's. False when its chunk is not installed. */
export function refitTree(physics, terrain, t) {
  const old = [];
  physics.near(t.x - 1, t.z - 1, t.x + 1, t.z + 1, (s) => { if (s.kind === 'tree' && s.ref === t) old.push(s); });
  if (!old.length) return false;
  const tag = old[0].tag; for (const s of old) physics.remove(s);
  addTreeSolid(physics, t, terrain.height(t.x, t.z), tag);
  return true;
}
/** The solids of one door's hall (see gen/vestibule.js doorSolids) and its shut leaf: { rec, tag, ref, leaf }. */
export function addDoor(physics, rec, top, tag, ref) {
  const S = doorSolids(rec), mk = (s, o = {}) => physics.addPrism(s.ring, s.y0 ?? rec.ys - 3, s.y1 ?? top, { tag, surface: 'wood', ref, ...o });
  mk(S.lintelRecess); mk(S.lintelHall); mk(S.floor); mk(S.step); mk(S.plug, { navOnly: true });
  return { rec, tag, ref, leaf: mk(S.leaf) };
}
export function uninstallChunk(physics, terrain, ce, cn) { physics.removeTag(chunkTag(ce, cn)); terrain.removeTile(ce, cn); }
