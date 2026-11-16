// Façades: the walls of a building, far (flat, windows in the texture) and near (real openings). Pure code.
// OWNED BY ITEM 5 of docs/plans/SCENE-DETAIL.md; the bodies below are the placeholder of item 3 (the walls the engine
// drew before: one quad per edge with the window texture tiled every 3 m, and plain stone where the ground falls away).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   bays(len, style, seed) -> { n, width, margin, start }
//   facadeFar(soups, b, groundAt, style, roofInfo)
//   facadeNear(soups, b, groundAt, style, roofInfo)
//
//   soups     a soup set (soup.js). The two functions are called for the same building into DIFFERENT sets: the far
//             set is hidden while the near one is shown, so each must draw the whole wall, plinth included.
//   b         a decoded building or ONE PIECE of it (passage.js passagePieces): the same fields, with ring, holes,
//             blind, front and yMin belonging to the piece. Edge i runs from ring vertex i to i + 1 (wrapping).
//             Fields read here: id, ring, holes, yBase (lowest ground, metres), yMin (the wall starts at
//             max(ground, yMin): yMin > yBase for a part that floats and for the piece over a passage), hEave (the
//             eave is at yBase + hEave), levels (storeys below the eave; 0 = derive from the height), facade (4.2
//             enum), tint (linear [r, g, b]), use, blind and front (Sets of edge numbers), groundFloor (0 plain,
//             1 shopfronts on front edges, 2 large doors).
//   groundAt  (x, z) -> ground height in metres, sidewalks included. Always a number.
//   style     the resolved style (style.js): window, groundFloor, cornice, plinth, dormers, chimneys, trim, frames,
//             doors, awnings.
//   roofInfo  what roof.js roof() returned for the WHOLE building: slots (dormers), ridge (chimneys), parapet (raise
//             the wall top by it). Dormers and chimneys are drawn by facadeNear for the piece with `b.piece` 0 or
//             undefined only, so a building cut by a passage gets them once.
//
//   bays      the one layout rule both functions use, so painted and modelled windows line up: bay width = a value
//             in style.window.bay fixed by the seed (b.id), margin 0.45, n = floor((len - 2 margin) / width) bays
//             centred on the edge, the first starting at `start` = (len - n width) / 2. n = 0: no openings.
//   Coordinates  game metres, y up. Write walls on a soup.js frame(): for an edge from A to B with the outside on the
//             viewer's side, frame(Ax, Az, ex, ez) needs the unit vector that puts the outside at (-ez, ex); for a
//             ring with positive poly.js signedArea() that is B to A, else A to B (the placeholder shows it).
//   Winding   counter-clockwise seen from outside; nothing faces into the building.
//   UV        far: u counts bays (0 … n), v counts storeys (0 … levels) from the wall base, so the texture's one
//             window per unit square lands in each bay (n = 0: u 0.5 … 0.5, a column with no window). The placeholder
//             still tiles the old texture in metres (u a multiple of 3 m, v metres above yBase); item 5 changes the
//             texture and these numbers together. Near: glass uv 0..1 (casement) or 1..2 in u (shop pane), doors
//             0..1; walls are triplanar and need none.
//   Soups     far: FACADE_FAR_SOUP[b.facade]; near walls: WALL_SOUP[b.facade]; plinth SOUP.plinth; trim, window,
//             door, shutter, awning: SOUP.* (style.js). All tinted soups take linear colours: b.tint, or
//             style.js paletteColor(style.trim, k) and the like.
//   Groups    facadeFar -> `far` (built with the chunk, hidden per cell while `near` shows). facadeNear -> `near`
//             (built when the camera is within the detail distance, at most one cell a frame).
//   Budget    near: <= 180 000 triangles and <= 30 ms for the densest cell of a town; far: 2 triangles an edge.
//   Must not  read the DOM or three.js, keep state between calls, or draw the roof (roof.js does).
import { quad } from './soup.js';
import { FACADE_FAR_SOUP, SOUP } from './style.js';
import { signedArea } from './poly.js';
import { rng } from './soup.js';

const MARGIN = 0.45;
export function bays(len, style, seed) {
  const [lo, hi] = style.window.bay, width = lo + (hi - lo) * rng(seed)(), n = Math.max(0, Math.floor((len - 2 * MARGIN) / width));
  return { n, width, margin: MARGIN, start: (len - n * width) / 2 };
}

/** One quad per edge of a ring between two heights, facing outwards whatever the winding; uv as the old texture wants it. */
function legacyWalls(s, ring, y0, y1, tint, vBase, tiled) {
  const out = signedArea(ring) > 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.02) continue;
    const u1 = tiled ? Math.max(1, Math.round(len / 3)) * 3 : len, v0 = y0 - vBase, v1 = y1 - vBase;
    // u runs from A to B in both windings, as before, so the picture does not move
    if (out) quad(s, [bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], tint, [u1, v0, 0, v1]);
    else quad(s, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], tint, [0, v0, u1, v1]);
  }
}
function placeholder(soups, b, groundAt, roofInfo) {
  const rings = [b.ring, ...(b.holes || [])], eave = b.yBase + b.hEave + ((roofInfo && roofInfo.parapet) || 0), from = Math.max(b.yBase, b.yMin ?? b.yBase);
  if (from <= b.yBase) {
    let lo = b.yBase; for (let i = 0; i < b.ring.length; i += 2) lo = Math.min(lo, groundAt(b.ring[i], b.ring[i + 1]));
    if (lo < b.yBase - 0.05) for (const r of rings) legacyWalls(soups.get(SOUP.plinth), r, lo - 0.5, b.yBase, null, lo - 0.5, false);
  }
  if (eave > from) for (const r of rings) legacyWalls(soups.get(FACADE_FAR_SOUP[b.facade] || FACADE_FAR_SOUP[0]), r, from, eave, b.tint, b.yBase, true);
}

export function facadeFar(soups, b, groundAt, style, roofInfo) { placeholder(soups, b, groundAt, roofInfo); } // eslint-disable-line no-unused-vars
export function facadeNear(soups, b, groundAt, style, roofInfo) { placeholder(soups, b, groundAt, roofInfo); } // eslint-disable-line no-unused-vars
