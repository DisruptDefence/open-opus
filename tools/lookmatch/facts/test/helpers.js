// Synthetic patches for the rules' tests: RGBA arrays built by hand, seeded.
import { rng } from '../../lib/stats.mjs';
import { labField } from '../../lib/measure.mjs';
import { textureStats, materialOf } from '../lib/rules.mjs';
import { image } from '../../test/helpers.js';

export { image };
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const shade = (c, k) => c.map((v) => clamp(v * k));

/** Rows of bricks 8 x 3 px with 1 px mortar, every other row offset by half a brick, each brick a little lighter or darker. */
export function brick(w = 64, h = 48, base = [150, 70, 50], mortar = [200, 190, 175], seed = 1) {
  const r = rng(seed), tone = new Map();
  return image(w, h, (x, y) => {
    const row = Math.floor(y / 4), xx = x + (row % 2 ? 4 : 0), col = Math.floor(xx / 9);
    if (y % 4 === 3 || xx % 9 === 8) return mortar;
    const key = row * 1000 + col; if (!tone.has(key)) tone.set(key, 0.88 + 0.24 * r());
    return shade(base, tone.get(key) + 0.14 * (r() * 2 - 1));   // a little noise in every pixel, as in a photograph
  });
}
/** Irregular blocks (random sizes 6 to 18 px) of grey-beige, each its own tone, joints darker. */
export function stoneBlocks(w = 96, h = 64, seed = 3) {
  const r = rng(seed), cells = [];
  for (let y = 0; y < h; y += 0) { const rh = 7 + Math.floor(r() * 9); for (let x = 0; x < w; x += 0) { const rw = 9 + Math.floor(r() * 18); cells.push({ x0: x, x1: x + rw, y0: y, y1: y + rh, t: 0.65 + 0.5 * r() }); x += rw; } y += rh; }
  return image(w, h, (x, y) => { const c = cells.find((q) => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1); if (x === c.x0 || y === c.y0) return [70, 66, 60]; return shade([176, 168, 150], c.t); });
}
/** A smooth colour with sensor noise of +-1. */
export function smooth(c, w = 64, h = 48, seed = 5) { const r = rng(seed); return image(w, h, () => c.map((v) => clamp(v + (r() * 2 - 1)))); }
/** A very light wall with faint horizontal joints every 6 px. */
export function whiteJoints(w = 64, h = 48) { return image(w, h, (x, y) => (y % 6 === 0 ? [205, 203, 198] : [238, 236, 231])); }

/** Median Lab and texture of a patch taken as one cluster, and the material word. */
export function label(rgba, w, h) {
  const f = labField(rgba, w, h), n = w * h, ids = new Int16Array(n), mid = (a) => Float64Array.from(a).sort()[n >> 1];
  const t = textureStats(f.L, ids, w, h, 1)[0], c = { L: mid(f.L), a: mid(f.A), b: mid(f.B) };
  return { c, t, material: materialOf(c, t) };
}
