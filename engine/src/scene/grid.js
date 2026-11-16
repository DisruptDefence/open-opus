// The chunk grid of docs/SCENE-FORMAT.md 3.1. A chunk is 250 x 250 m on the ABSOLUTE UTM grid: chunk (ce, cn)
// covers eastings [250 ce, 250 (ce + 1)) and northings [250 cn, 250 (cn + 1)), whatever anchor a scene chose. Every
// fourth chunk edge is a 1 km grid line, and two scenes of neighbouring ground share chunk borders.
// This file turns that into game metres for one scene (x = E - E0, z = N0 - N). Pure code.
export const CHUNK = 250;

/** The grid seen from a scene whose anchor is (e0, n0). `size` is 250 in every scene; tests use small grids. */
export function chunkGrid(e0 = 0, n0 = 0, size = CHUNK) {
  return {
    e0, n0, size,
    /** The chunk column of a game x, and the chunk row of a game z (rows count NORTH, so they fall as z grows). */
    ce: (x) => Math.floor((e0 + x) / size),
    cn: (z) => Math.floor((n0 - z) / size),
    /** The chunk's minimum corner in game axes (its north-west corner): where its records and rasters start. */
    x0: (ce) => ce * size - e0,
    z0: (cn) => n0 - (cn + 1) * size,
    key: (ce, cn) => ce + ',' + cn,
  };
}
/** The grid of a scene, from its georeference block (SCENE-FORMAT.md 2.2). */
export const gridOf = (georef) => chunkGrid(georef.easting, georef.northing);
