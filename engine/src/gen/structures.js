// Walls and barriers: fortifications, retaining walls, garden walls, fences and rails. Pure code.
// OWNED BY ITEM 7 of docs/plans/SCENE-DETAIL.md; the bodies below are the placeholder of item 3 (the walls the engine
// drew before: one upright slab per segment, its top `height` above the highest ground under it).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   wallRings(wall, groundAt) -> [{ ring, yBase, yTop }, …]
//   wall(soups, wall, groundAt, style)
//
//   wall      a decoded wall PIECE (scene/source.js): the part of a mapped line inside one cell of 62.5 m, cut
//             exactly at the cell's edge. pts (flat [x, z, …], game metres), cls (4.4 enum: 1 city_wall
//             2 retaining_wall 3 wall 4 fence 5 hedge 6 guard_rail), kind (the source's word), height (metres above
//             the ground, used when parapet is null), parapet (null, or metres the top stands above the HIGHER
//             ground beside the wall: a wall that holds ground back), thickness (metres), material (façade enum
//             4.2), crenels (boolean), rail (null, or a prop kind of props.js: draw posts and rails, not a solid),
//             s0 (metres along the whole mapped line at which this piece starts) and len (the whole line's length):
//             anything that repeats along a wall (merlons, posts) is placed by s0 + distance, so two pieces meet in step.
//   groundAt  (x, z) -> ground height in metres, sidewalks included. Always a number.
//   wallRings what the wall is as solids: quad rings (flat [x, z, …], 4 vertices, either winding) each solid from
//             yBase (below the lowest ground under it) to yTop. scene/install.js makes one collision prism per ring
//             (a rail collides as its thin ring too), and wall() must draw the same rings: what is drawn is what
//             collides. Rings of one piece may overlap at corners; they must not reach more than the thickness beyond
//             the piece's ends.
//   wall      draws the piece: the rings as prisms with a top, crenels and coping when `crenels`; when `rail` is set,
//             posts and rails from PROP_KIT[rail] instead of prisms.
//   Soups     STRUCTURE_SOUP[wall.material] (style.js), triplanar, not tinted. Rails: SOUP.iron.
//   Winding   counter-clockwise seen from outside the solid.
//   Groups    solid walls -> `base` (seen from far away); a wall with `rail` -> `near`. The mesher decides by `rail`.
//   Budget    walls and gates <= 40 000 triangles a scene.
//   Must not  read the DOM or three.js, or return a ring the drawing does not show.
import { prism } from './soup.js';
import { STRUCTURE_SOUP } from './style.js';

/** A polyline with a thickness, as one quad ring per segment, each lengthened by half the thickness so corners close. */
export function lineToRings(pts, thickness) {
  const out = [], t = thickness / 2;
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], az = pts[p + 1], bx = pts[p + 2], bz = pts[p + 3], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.05) continue;
    const nx = (-(bz - az) / l) * t, nz = ((bx - ax) / l) * t, ex = ((bx - ax) / l) * t, ez = ((bz - az) / l) * t;
    out.push([ax - ex + nx, az - ez + nz, bx + ex + nx, bz + ez + nz, bx + ex - nx, bz + ez - nz, ax - ex - nx, az - ez - nz]);
  }
  return out;
}

export function wallRings(wall, groundAt) {
  const out = [];
  for (const ring of lineToRings(wall.pts, wall.thickness)) {
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < ring.length; i += 2) { const h = groundAt(ring[i], ring[i + 1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    out.push({ ring, yBase: lo - 1, yTop: hi + (wall.parapet != null ? wall.parapet : wall.height) });
  }
  return out;
}
export function wall(soups, wall, groundAt, style) { // eslint-disable-line no-unused-vars
  const s = soups.get(STRUCTURE_SOUP[wall.material] || STRUCTURE_SOUP[1]);
  for (const r of wallRings(wall, groundAt)) prism(s, r.ring, r.yBase, r.yTop, null, true);
}
