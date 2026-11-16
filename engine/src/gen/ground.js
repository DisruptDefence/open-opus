// The ground a street is made of: carriageways with crisp edges, sidewalks and kerbs, stairs, crossings, markings.
// Pure code. OWNED BY ITEM 6 of docs/plans/SCENE-DETAIL.md; the bodies below are the placeholder of item 3 (nothing
// is drawn over the terrain and no sidewalk is raised).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   drape(tri3, tile) -> [[[x, y, z], [x, y, z], [x, y, z]], …]
//   roadRibbons(soups, road, tile, style)
//   steps(soups, road, groundAt, style)
//   crossing(soups, c, tile, style)
//   liftRaster(roads, x0, z0, n, style) -> Uint8Array(n * n) | null
//
//   tile      the chunk's height tile (terrain/heightfield.js createGrid): nx, nz, cell, minX, minZ, data (Float32Array,
//             row by row from minimum z; sample (i, j) is at (minX + i cell, minZ + j cell)), baseHeight(x, z) (the
//             terrain without sidewalks) and height(x, z) (with them). The drawn terrain splits cell (i, j), corners
//             a = (i, j), b = (i + 1, j), d = (i, j + 1), e = (i + 1, j + 1), into the triangles a d b and b d e.
//   drape     a triangle on the plan (three [x, z] or [x, y, z] points; y is ignored), cut along those terrain
//             triangles and given their heights from `tile.data`: the result lies exactly on the drawn ground.
//             Callers add their own lift along +y. Parts outside the tile are dropped.
//   road      a decoded road PIECE (scene/source.js): the part of a mapped way that comes within reach of one cell
//             (the cell's box grown by half the width plus 3 m). pts (flat [x, z, …], game metres), kind (the
//             source's word: residential, footway, steps, living_street …), cls (4.3 enum), surface (4.1 enum),
//             width (carriageway, metres), sidewalk ('both' | 'left' | 'right' | 'no': left and right of the direction
//             of the vertices), steps (null, or { count, handrail: 0 none 1 both sides 2 centre }), lit, marking
//             (1 = centre line), bridge, s0 (metres along the whole way at which the piece starts), len (the whole
//             way's length). The mesher never passes a tunnel or a bridge.
//             DRAW THE WHOLE PIECE and let everything that repeats (dashes, treads, posts) be placed by s0 + distance
//             along the piece, never by the piece's own start: the mesher cuts what you write to the cell's box
//             (cells.js clipSoups), and the neighbouring cell draws the same way from its own piece, so the two
//             halves must be the same geometry.
//   steps     for a road with `steps`: `count` treads over the whole way (tread k covers s from k len / count to
//             (k + 1) len / count), stringers, handrails. Not draped: treads are level. Every tread top stays within
//             one riser of groundAt under it, because the walker stands on the terrain (stairs stay sloped ground in
//             the collision).
//   c         a decoded crossing: { x, z, yaw, width }; yaw as props (radians about +y, 0 = the road runs north).
//             A crossing belongs to every cell its square (width + 3 m) touches and is cut to the cell like a road.
//   liftRaster  the centimetres to add to the ground for sidewalks, 1 m cells, row by row from (x0, z0), n cells
//             square: a cell whose centre lies in a sidewalk strip gets round(style.kerb * 100). `roads` are all the
//             road pieces of the chunk (pieces of neighbouring cells overlap: the result must not depend on that).
//             null = nothing is raised. scene/install.js gives it to the height tile, so the walker, the nav grid,
//             the props and the drawn sidewalk all stand at the same height: draw the sidewalk top at
//             tile.baseHeight + style.kerb exactly where this raster is set.
//   Coordinates  game metres, y up, z south. "Left" of a segment from A to B is (ez, -ex) for its unit vector (ex, ez)
//             (on a north-up map, the left hand of someone walking A to B).
//   Winding   ground faces up (normal y > 0); kerb faces look at the carriageway.
//   UV        none: ground materials are triplanar.
//   Soups     GROUND_SOUP[road.surface] for the carriageway, GROUND_SOUP of style.sidewalk.surface for sidewalks,
//             SOUP.kerb, SOUP.paint, SOUP.tread, SOUP.iron (style.js). Lifts above the terrain: carriageway 0.03,
//             markings 0.04, sidewalk style.kerb.
//   Group     `near` only.
//   Budget    <= 60 000 triangles a cell.
//   Must not  read the DOM or three.js, or draw outside what the record says (no invented streets).

export function drape(tri3, tile) { return []; } // eslint-disable-line no-unused-vars
export function roadRibbons(soups, road, tile, style) {} // eslint-disable-line no-unused-vars
export function steps(soups, road, groundAt, style) {} // eslint-disable-line no-unused-vars
export function crossing(soups, c, tile, style) {} // eslint-disable-line no-unused-vars
export function liftRaster(roads, x0, z0, n, style) { return null; } // eslint-disable-line no-unused-vars
