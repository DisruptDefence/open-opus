// The mesher: which generator draws which record into which group of a cell. Pure code: it returns triangle soups,
// and level/build.js turns them into meshes. The collision (scene/install.js) calls the same generators through the
// same helpers here, so what is drawn is what collides.
//
// THE REGISTRY. Every generator is one file with a fixed signature (its header states the contract):
//
//   roof.js        roof(soups, b, style) -> info                       base
//   passage.js     passagePieces(b) -> pieces                          far, near and collision
//                  passageArch(soups, b, p, groundAt, style)           base
//   facade.js      facadeFar(soups, piece, groundAt, style, info)      far
//                  facadeNear(soups, piece, groundAt, style, info)     near
//   structures.js  wallRings(wall, groundAt) -> rings                  collision
//                  wall(soups, wall, groundAt, style)                  base; near when the wall is a rail
//   trees.js       tree(soups, t, y, season, lod)                      far (lod 0), near (lod 1)
//   ground.js      roadRibbons / steps / crossing                      near, cut to the cell's box here
//                  liftRaster(roads, x0, z0, n, style)                 the height tile (collision and drawing)
//   props.js       PROP_KIT[kind].build(...) and .collider             near and collision
//
// An item of the plan fills the body of its own file and touches nothing else. This file changes only when a
// signature does.
//
// THE THREE GROUPS of a cell (docs/plans/SCENE-DETAIL.md section 4):
//   base   always drawn while the chunk is live: roofs, arches, solid walls
//   far    drawn while the cell is beyond the detail distance: flat façades, simple trees
//   near   drawn in its place within the detail distance: modelled façades, full trees, rails, the street's ground, props
// `far` and `near` are two pictures of the same things; `base` has no second picture.
import { createSoups, prism } from './soup.js';
import { clipSoups } from './cells.js';
import { STRUCTURE_SOUP } from './style.js';
import { roof } from './roof.js';
import { facadeFar, facadeNear } from './facade.js';
import { lookOf, lookStyle, landmarkNear, landmarkBase } from './landmark.js';
import { passagePieces, passageArch } from './passage.js';
import { wallRings, wall as drawWall } from './structures.js';
import { roadRibbons, steps, crossing, liftRaster } from './ground.js';
import { PROP_KIT } from './props.js';
import { terraceDeck } from './terrace.js';
import { tree } from './trees.js';

export const GROUPS = ['base', 'far', 'near'];

/**
 * What the generators are given beside a record: `tile` the chunk's height tile (terrain/heightfield.js createGrid),
 * `style` the scene's resolved style, `season`. `groundAt` is the tile's own height (sidewalks included), held at
 * the tile's edge beyond it, so it always answers and answers the same for the drawing and for the collision.
 */
export function chunkEnv(tile, style, season) {
  return { tile, style, season: season || style.season || 'summer', groundAt: (x, z) => tile.height(x, z) };
}
/** The height tile's sidewalk raster for a chunk: see ground.js liftRaster. */
export const chunkLift = (chunk, style) => liftRaster(chunk.roads || [], chunk.hx0, chunk.hz0, chunk.sn, style);

// ---- helpers shared by the drawing and the collision ----------------------------------------------------------------
const roofInfos = new WeakMap(), pieceLists = new WeakMap();
/** What roof.js returned for a building (slots, ridge, parapet), computed once. */
export function roofInfoOf(b, style) {
  let info = roofInfos.get(b);
  if (!info) { info = roof(createSoups(), b, style) || {}; info = { slots: info.slots || [], ridge: info.ridge || [], parapet: info.parapet || 0 }; roofInfos.set(b, info); }
  return info;
}
/** A building as the pieces its passages cut it into ([b] itself when it has none). */
export function piecesOf(b) {
  if (!b.passages || !b.passages.length) return [b];
  let p = pieceLists.get(b); if (!p) { p = passagePieces(b); if (!p || !p.length) p = [b]; pieceLists.set(b, p); }
  return p;
}
/** A wall as solids: [{ ring, yBase, yTop }]. A package may ship a wall already as one ring. */
export const wallSolids = (w, groundAt) => (w.ring ? [w] : wallRings(w, groundAt));
/** A prop's collision as a ring on the plan and a height, or null: from PROP_KIT[kind].collider. */
export function propSolid(p) {
  const kit = PROP_KIT[p.kind], c = kit && kit.collider; if (!c) return null;
  const hw = c.hw ?? c.r, hd = c.hd ?? c.r, rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw), fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const at = (u, d) => [p.x + rx * u + fx * d, p.z + rz * u + fz * d], q = [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
  return { ring: [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]], h: c.h, nav: !!c.nav };
}

/**
 * The street doors that open in a building (gen/vestibule.js records), one list for the whole building. Found by drawing the
 * building's near façade into a soup set that is thrown away: the same code as the near group, so the collision (scene/install.js)
 * and the picture never disagree about which doors open or where. [] for a building with no street front.
 */
export function doorRecords(b, groundAt, style) {
  if (!b.front || !b.front.size) { if (!piecesOf(b).some((p) => p.front && p.front.size)) return []; }
  const info = roofInfoOf(b, style), st = b.look ? lookStyle(style, lookOf(style, b)) : style, set = createSoups(), out = [];
  for (const piece of piecesOf(b)) { if (!piece.front || !piece.front.size) continue; set.doors = []; facadeNear(set, piece, groundAt, st, info); out.push(...set.doors); }
  return out;
}

const warned = new Set();
const warnOnce = (text) => { if (!warned.has(text)) { warned.add(text); console.warn('[gen] ' + text); } };

/**
 * The triangles of one group of one cell: a soup set (soup.js). `cell` is an entry of `chunk.cells`
 * (scene/source.js): its box and the records that belong to it.
 */
export function cellSoups(cell, group, env) {
  const soups = createSoups(), { groundAt, tile, style, season } = env;
  if (group === 'base') {
    for (const b of cell.buildings) {
      const info = roof(soups, b, style) || {};
      roofInfos.set(b, { slots: info.slots || [], ridge: info.ridge || [], parapet: info.parapet || 0 });
      if (b.look) landmarkBase(soups, b, style, roofInfos.get(b));
      for (const p of b.passages || []) passageArch(soups, b, p, groundAt, style);
    }
    for (const w of cell.walls) {
      if (w.ring) prism(soups.get(STRUCTURE_SOUP[w.material] || STRUCTURE_SOUP[1]), w.ring, w.yBase, w.yTop, null, true);
      else if (!w.rail) drawWall(soups, w, groundAt, style);
    }
  } else if (group === 'far') {
    for (const b of cell.buildings) { const info = roofInfoOf(b, style); for (const piece of piecesOf(b)) facadeFar(soups, piece, groundAt, style, info); }
    for (const t of cell.trees) tree(soups, t, groundAt(t.x, t.z), season, 0);
  } else if (group === 'near') {
    for (const b of cell.buildings) {
      const info = roofInfoOf(b, style), st = b.look ? lookStyle(style, lookOf(style, b)) : style;
      for (const piece of piecesOf(b)) facadeNear(soups, piece, groundAt, st, info);
      if (b.look) landmarkNear(soups, b, groundAt, style, info);
    }
    for (const t of cell.trees) tree(soups, t, groundAt(t.x, t.z), season, 1);
    for (const w of cell.walls) if (w.rail && !w.ring) drawWall(soups, w, groundAt, style);
    if (cell.roads.length || cell.crossings.length) {
      const ground = createSoups();
      for (const r of cell.roads) { if (r.tunnel || r.bridge) continue; if (r.steps) steps(ground, r, groundAt, style); else roadRibbons(ground, r, tile, style, cell.roads); }
      for (const c of cell.crossings) crossing(ground, c, tile, style);
      soups.add(clipSoups(ground, cell));
    }
    for (const d of cell.terraces || []) terraceDeck(soups, d, tile, cell, style);
    for (const p of cell.props) {
      const kit = PROP_KIT[p.kind];
      if (!kit) { warnOnce(`prop kind "${p.kind}" is not in the kit: skipped`); continue; }
      kit.build(soups, p.x, p.y ?? groundAt(p.x, p.z), p.z, p.yaw, p.variant, style);
    }
  } else throw new Error(`gen/mesher.js: no group "${group}"`);
  return soups;
}
