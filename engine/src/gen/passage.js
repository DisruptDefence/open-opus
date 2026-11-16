// Passages: a way through a building at ground level (a city gate, a carriage arch). Pure code.
// OWNED BY ITEM 7 of docs/plans/SCENE-DETAIL.md; the bodies below are the placeholder of item 3 (no building is cut,
// no arch is drawn).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js, scene/install.js and the plan)
//
//   passagePieces(b) -> [piece, …]
//   passageArch(soups, b, p, groundAt, style)
//
//   b        a decoded building (scene/source.js). b.passages = [{ x1, z1, x2, z2, w, h }]: the centre line of the
//            way through on the plan (game metres), its clear width and its clear height above b.yBase (metres).
//   pieces   the building cut by its passages. With no passage: [b] itself, the same object. Otherwise, for each
//            passage, a piece on each side that stands on the ground and a piece over the way that starts at
//            yBase + h. A piece is a COPY of the building with these fields replaced:
//              ring    the piece's outline (flat [x, z, …]); the pieces tile the building's ring exactly
//              holes   the building's holes that lie in this piece (whole; a hole a cut crosses is dropped)
//              yMin    yBase for a piece on the ground, yBase + h over the way
//              blind   Set of edge numbers OF THE PIECE'S RING with no openings: the building's blind edges,
//                      renumbered, plus every edge made by a cut
//              front   Set of edge numbers of the piece's ring that face a street, renumbered the same way
//              piece   0, 1, 2 … (roof details are drawn with piece 0 only)
//            Both the drawing (facade.js, once per piece) and the collision (scene/install.js: one prism per piece,
//            from yMin when it is above the ground, so one walks under it) come from this one function: what is
//            drawn is what collides.
//   passageArch   draws the inside of ONE passage `p` of `b`: the two side walls up to the springing, the vault, and
//            at both mouths the wall between the vault's curve and the clear height. The façade generators draw
//            nothing inside the way.
//   Soups    WALL_SOUP[b.facade] with b.tint (style.js). Triplanar: no uv.
//   Winding  counter-clockwise seen from inside the way (the faces look into the passage).
//   Group    `base` (an arch is seen from far away).
//   Budget   <= 200 triangles a passage. Walls and gates together <= 40 000 triangles a scene.
//   Must not leave a piece narrower than a wall is thick: if the cut leaves less than 0.3 m on a side, return [b].

export function passagePieces(b) { return [b]; }
export function passageArch(soups, b, p, groundAt, style) {} // eslint-disable-line no-unused-vars
