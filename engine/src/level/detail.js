// Which cells are drawn in detail. A live chunk's cells (gen/cells.js: 4 x 4 of 62.5 m) each have a `far` picture,
// built with the chunk, and a `near` one, built here when the camera comes within the detail distance R:
//
//   distance from the camera to the cell's box, on the plan      what happens
//   <= R                 the near group is built if it is missing (nearest first, `budget` cells a call) and shown
//   R … R + 10           nothing changes: a camera walking along the edge of R does not flip a cell back and forth
//   > R + 10             the near group is hidden and the far picture shown
//   > R + 80             the near group is thrown away
//
// R comes from the quality tier, so detail scales down with the machine: at `low` only the street the player stands
// in is modelled. No three.js here: the loader hands in what building, showing and disposing mean.
import { boxDistance } from '../gen/cells.js';

export const DETAIL_RADIUS = { test: 0, low: 45, medium: 85, high: 140, ultra: 220 };
export const NEAR_BAND = 10, NEAR_KEEP = 80;

/**
 * build(key, cell) -> handle; show(key, cell, handle, on); dispose(key, cell, handle). `key` is whatever the caller
 * names a chunk by; `cell` is the cell given to add().
 */
export function createDetail({ radius = 0, build, show, dispose }) {
  const chunks = new Map();
  let shown = 0, built = 0;
  const hide = (key, e) => { if (e.on) { show(key, e.cell, e.handle, false); e.on = false; shown--; } };
  const drop = (key, e) => { hide(key, e); if (e.handle != null) { dispose(key, e.cell, e.handle); e.handle = null; built--; } };
  return {
    get radius() { return radius; },
    setRadius(r) { radius = Math.max(0, +r || 0); },
    /** A chunk went live. `cells`: its cell boxes; one with `empty: true` has nothing to draw near and is never built. */
    add(key, cells) { chunks.set(key, cells.map((cell) => ({ cell, handle: null, on: false }))); },
    /** Throw a cell's near group away (its records changed): the next update builds it again. */
    invalidate(key, index) { const e = (chunks.get(key) || []).find((x) => x.cell.index === index); if (e && e.handle != null) drop(key, e); },
    remove(key) { const list = chunks.get(key); if (!list) return; for (const e of list) drop(key, e); chunks.delete(key); },
    /** Bring every cell up to date for a camera at (x, z). Returns how many near groups were built in this call. */
    update(x, z, budget = 1) {
      const want = [];
      for (const [key, list] of chunks) for (const e of list) {
        const d = boxDistance(e.cell, x, z);
        if (e.handle != null) {
          if (d > radius + NEAR_KEEP || radius <= 0) drop(key, e);
          else if (e.on && d > radius + NEAR_BAND) hide(key, e);
          else if (!e.on && d <= radius) { show(key, e.cell, e.handle, true); e.on = true; shown++; }
        } else if (radius > 0 && d <= radius && !e.cell.empty) want.push([d, key, e]);
      }
      want.sort((a, b) => a[0] - b[0]);
      let n = 0;
      for (const [, key, e] of want) {
        if (n >= budget) break;
        e.handle = build(key, e.cell); built++; n++;
        show(key, e.cell, e.handle, true); e.on = true; shown++;
      }
      return n;
    },
    stats: () => ({ shown, built }),
  };
}
