// Ground heights. Pure code (no three.js): the physics, the nav grid, the terrain mesh and the tests all read this.
//
// The terrain is a set of square tiles, one per scene chunk, that arrive as chunks stream in. Each tile is a regular
// grid of heights whose edge samples are shared with its neighbours. A coarse grid for the whole scene (the "far"
// terrain) answers for places whose tile has not arrived yet, when the caller allows it.
import { chunkGrid } from '../scene/grid.js';

/**
 * One grid of heights: `nx` by `nz` samples, `cell` metres apart, the first sample at (minX, minZ). `surface` is an
 * optional raster of surface classes from the same corner, `surfaceN` cells square of `surfaceCell` metres.
 * `lift` is an optional raster of centimetres to add to the ground (raised sidewalks), `liftN` cells square of
 * `liftCell` metres from the same corner: `height()` reports the ground with it, `baseHeight()` without it (what the
 * terrain mesh is drawn from). With no lift the two are the same.
 */
export function createGrid({ nx, nz, cell, minX, minZ, data, surface = null, surfaceCell = cell, surfaceN = 0, lift = null, liftCell = 1, liftN = 0 }) {
  const maxX = minX + (nx - 1) * cell, maxZ = minZ + (nz - 1) * cell;
  function baseHeight(x, z) {
    let fx = (x - minX) / cell, fz = (z - minZ) / cell;
    fx = fx < 0 ? 0 : fx > nx - 1 ? nx - 1 : fx;
    fz = fz < 0 ? 0 : fz > nz - 1 ? nz - 1 : fz;
    const i = Math.min(nx - 2, fx | 0), j = Math.min(nz - 2, fz | 0), u = fx - i, v = fz - j, k = j * nx + i;
    return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v) + (data[k + nx] * (1 - u) + data[k + nx + 1] * u) * v;
  }
  const ln = lift ? liftN || Math.round(((nx - 1) * cell) / liftCell) : 0;
  function liftAt(x, z) {
    const i = Math.floor((x - minX) / liftCell), j = Math.floor((z - minZ) / liftCell);
    return i < 0 || j < 0 || i >= ln || j >= ln ? 0 : lift[j * ln + i] / 100;
  }
  const height = lift ? (x, z) => baseHeight(x, z) + liftAt(x, z) : baseHeight;
  const sn = surface ? surfaceN || Math.round(((nx - 1) * cell) / surfaceCell) : 0;
  function surfaceAt(x, z) {
    if (!surface) return 0;
    const i = Math.min(sn - 1, Math.max(0, Math.floor((x - minX) / surfaceCell)));
    const j = Math.min(sn - 1, Math.max(0, Math.floor((z - minZ) / surfaceCell)));
    return surface[j * sn + i];
  }
  const contains = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  return { nx, nz, cell, minX, minZ, maxX, maxZ, data, surface, surfaceCell, lift, height, baseHeight, surfaceAt, contains };
}

export const SURFACES = ['unknown', 'asphalt', 'concrete', 'cobble', 'paving', 'gravel', 'dirt', 'grass', 'sand', 'rock',
  'snow', 'mud', 'wood', 'metal', 'water', 'vegetation_dense'];

/**
 * The streamed terrain: tiles by chunk, a far grid behind them. `grid` is the scene's chunk grid (scene/grid.js):
 * it says which chunk (ce, cn) a game position lies in.
 */
export function createTerrain({ grid = chunkGrid(), far = null } = {}) {
  const tiles = new Map();
  const key = grid.key;
  const tileAt = (x, z) => tiles.get(key(grid.ce(x), grid.cn(z)));
  let farGrid = far;

  /** Ground height, or NaN where nothing is known. With `detailOnly`, NaN wherever the full-detail tile is missing. */
  function height(x, z, detailOnly = false) {
    const t = tileAt(x, z);
    if (t) return t.height(x, z);
    if (detailOnly || !farGrid || !farGrid.contains(x, z)) return NaN;
    return farGrid.height(x, z);
  }
  const loaded = (x, z) => !!tileAt(x, z);
  /** Rise over run of the steepest direction. */
  function slope(x, z, d = 0.75) {
    const sx = (height(x + d, z) - height(x - d, z)) / (2 * d), sz = (height(x, z + d) - height(x, z - d)) / (2 * d);
    return Math.hypot(sx, sz);
  }
  /** Upward unit normal as { x, y, z }. */
  function normal(x, z, d = 0.75) {
    const sx = (height(x + d, z) - height(x - d, z)) / (2 * d), sz = (height(x, z + d) - height(x, z - d)) / (2 * d);
    const l = Math.hypot(sx, 1, sz);
    return { x: -sx / l, y: 1 / l, z: -sz / l };
  }
  function surfaceAt(x, z) {
    const t = tileAt(x, z);
    return SURFACES[t ? t.surfaceAt(x, z) : 0] || 'unknown';
  }
  /**
   * First point where a ray meets the ground: { dist, x, y, z } or null. Marches at `step` and refines by bisection,
   * so a ridge thinner than the step can be missed; the default step is half the finest cell seen.
   */
  let fine = 2.5;
  function raycast(ox, oy, oz, dx, dy, dz, max, step = Math.max(0.5, fine * 0.5)) {
    let t0 = 0, h0 = height(ox, oz);
    if (!Number.isNaN(h0) && oy < h0) return null; // started under the ground
    for (let t = Math.min(step, max); ; t = Math.min(max, t + step)) {
      const h = height(ox + dx * t, oz + dz * t);
      if (!Number.isNaN(h) && oy + dy * t <= h) {
        let a = t0, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2, hm = height(ox + dx * m, oz + dz * m);
          if (!Number.isNaN(hm) && oy + dy * m <= hm) b = m; else a = m;
        }
        return { dist: b, x: ox + dx * b, y: oy + dy * b, z: oz + dz * b };
      }
      if (t >= max) return null;
      t0 = t;
      // well above anything the terrain can reach and climbing: stop early
      if (dy > 0 && oy + dy * t > maxY + 1) return null;
    }
  }
  let maxY = -Infinity;
  const noteMax = (g) => { for (let i = 0; i < g.data.length; i++) if (g.data[i] > maxY) maxY = g.data[i]; };
  if (farGrid) noteMax(farGrid);

  return {
    grid, tiles,
    setFar(g) { farGrid = g; noteMax(g); },
    get far() { return farGrid; },
    addTile(ce, cn, tile) { tiles.set(key(ce, cn), tile); fine = Math.min(fine, tile.cell); noteMax(tile); },
    removeTile(ce, cn) { tiles.delete(key(ce, cn)); },
    hasTile: (ce, cn) => tiles.has(key(ce, cn)),
    height, loaded, slope, normal, surfaceAt, raycast,
    get maxY() { return maxY; },
  };
}
