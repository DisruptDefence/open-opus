// The measures, taken the same way on every photograph and every render. Pure: an RGBA array, width and height in,
// numbers and a region mask out. All images are read at 320 px width by the caller (measure.mjs does not resize).
//
// REGIONS (identical rules for photo and render; thresholds in `T` below, L*a*b* of each pixel):
//   sky    = pixels 4-connected to the top edge that are bright (L* >= 55), blue-or-grey (b* <= 14, chroma <= 50) and smooth
//            (luminance gradient < 8 L* per pixel): a flood fill from the top row.
//   horizon = the row at the median over all columns of the sky height (rows of sky counted down from the top).
//   ground = pixels 4-connected to the bottom edge, below the horizon row and in the lower 45 % of the picture, that are
//            low-saturation (chroma < 20), not sky, within 20 L* of the median of the bottom 5 % of rows (the surface the camera
//            stands on) and without a steep vertical luminance step (|dL/dy| < 10, the line where a wall meets the ground):
//            a flood fill from the bottom row.
//   walls  = everything else (buildings, trees, people, cars: "the rest").
//   Poor framing: sky share under 3 % or over 70 %: the picture gets half weight in a reference.
// PER REGION (sky, ground, walls): share; mean L*, a*, b*; 10th, 50th, 90th percentile of L*; mean chroma; hue of the mean (a*, b*) in degrees.
// WHOLE IMAGE: contrast = L* p90 - p10 over all pixels.
// SHADE AND SUN: ground, walls and `surfaces` (both together) are each split at their own Otsu threshold on L*:
//   dark part and lit part, each with mean L*, a*, b* and share; ratio = dark mean L* / lit mean L*.
// BUSYNESS (rough stand-in for window density and street detail, not a count of anything): wall pixels' mean gradient
//   magnitude of L* (per pixel, central differences) and the share of wall pixels darker than the walls' median L* minus 25 ("dark openings").
// COLOURFULNESS of walls: standard deviation of a* and of b* over wall pixels; the five dominant wall colours by
//   k-means (k = 5, seeded, 10 iterations, up to 4000 sampled pixels) with their shares.
import { srgb8ToLab, labToHex, hueDeg } from './color.mjs';
import { percentileSorted, mean, stdev, otsu, kmeans3 } from './stats.mjs';

export const T = { skyL: 55, skyB: 14, skyChroma: 50, skyGrad: 8, groundChroma: 20, groundBand: 0.05, groundDL: 20, groundStep: 10, groundLowerShare: 0.45, poorLow: 0.03, poorHigh: 0.7, minRegion: 20, openingDrop: 25 };
export const MASK = { wall: 0, sky: 1, ground: 2 };
const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);

function floodFrom(seedsOk, w, h, ok, mask, value, rowFrom = 0, startRow) {
  const stack = []; const idx = (x, y) => y * w + x;
  for (let x = 0; x < w; x++) { const i = idx(x, startRow); if (ok(i, startRow) && mask[i] === 0) { mask[i] = value; stack.push(i); } }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0 && mask[i - 1] === 0 && ok(i - 1, y)) { mask[i - 1] = value; stack.push(i - 1); }
    if (x < w - 1 && mask[i + 1] === 0 && ok(i + 1, y)) { mask[i + 1] = value; stack.push(i + 1); }
    if (y > 0 && mask[i - w] === 0 && ok(i - w, y - 1)) { mask[i - w] = value; stack.push(i - w); }
    if (y < h - 1 && mask[i + w] === 0 && ok(i + w, y + 1)) { mask[i + w] = value; stack.push(i + w); }
  }
}

/** Per-pixel Lab and L* gradient magnitude. */
export function labField(rgba, w, h) {
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), G = new Float32Array(n), GY = new Float32Array(n);
  for (let i = 0; i < n; i++) { const lab = srgb8ToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2]; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = (L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)]) / 2, gy = (L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]) / 2;
    G[i] = Math.hypot(gx, gy); GY[i] = Math.abs(gy);
  }
  return { L, A, B, G, GY };
}

/** Region mask: Uint8Array of MASK values, plus the horizon row. */
export function regions(f, w, h) {
  const mask = new Uint8Array(w * h);
  const skyOk = (i) => f.L[i] >= T.skyL && f.B[i] <= T.skyB && Math.hypot(f.A[i], f.B[i]) <= T.skyChroma && f.G[i] < T.skyGrad;
  floodFrom(null, w, h, skyOk, mask, MASK.sky, 0, 0);
  const heights = []; for (let x = 0; x < w; x++) { let y = 0; while (y < h && mask[y * w + x] === MASK.sky) y++; heights.push(y); }
  heights.sort((a, b) => a - b);
  const horizon = heights[heights.length >> 1];
  const minRow = Math.max(horizon, Math.floor(h * (1 - T.groundLowerShare)));
  const band = []; for (let y = Math.max(0, h - Math.max(1, Math.round(h * T.groundBand))); y < h; y++) for (let x = 0; x < w; x++) band.push(f.L[y * w + x]);
  band.sort((a, b) => a - b); const base = band[band.length >> 1];
  const groundOk = (i, y) => y >= minRow && Math.hypot(f.A[i], f.B[i]) < T.groundChroma && Math.abs(f.L[i] - base) <= T.groundDL && f.GY[i] < T.groundStep;
  floodFrom(null, w, h, groundOk, mask, MASK.ground, 0, h - 1);
  return { mask, horizon };
}

function regionStats(f, idxs) {
  const n = idxs.length; if (n < T.minRegion) return null;
  const Ls = new Float64Array(n); let sa = 0, sb = 0, sl = 0, sc = 0;
  for (let k = 0; k < n; k++) { const i = idxs[k]; Ls[k] = f.L[i]; sl += f.L[i]; sa += f.A[i]; sb += f.B[i]; sc += Math.hypot(f.A[i], f.B[i]); }
  Ls.sort();
  return { L: round(sl / n), a: round(sa / n), b: round(sb / n), p10: round(percentileSorted(Ls, 10)), p50: round(percentileSorted(Ls, 50)), p90: round(percentileSorted(Ls, 90)), chroma: round(sc / n), hue: round(hueDeg(sa / n, sb / n), 1) };
}

/** Dark and lit parts of a set of pixels, split at their own Otsu threshold on L*. */
export function shadeSplit(f, idxs) {
  if (idxs.length < 50) return null;
  const Ls = idxs.map((i) => f.L[i]), th = otsu(Ls, 0, 100);
  const part = (pred) => { let n = 0, l = 0, a = 0, b = 0; for (const i of idxs) if (pred(f.L[i])) { n++; l += f.L[i]; a += f.A[i]; b += f.B[i]; } return n ? { L: round(l / n), a: round(a / n), b: round(b / n), share: round(n / idxs.length, 3) } : null; };
  const dark = part((v) => v < th), lit = part((v) => v >= th);
  return { threshold: round(th), dark, lit, ratio: dark && lit && lit.L > 0 ? round(dark.L / lit.L, 3) : null };
}

export function measureImage(rgba, w, h) {
  const f = labField(rgba, w, h), { mask, horizon } = regions(f, w, h), n = w * h;
  const lists = [[], [], []]; for (let i = 0; i < n; i++) lists[mask[i]].push(i);
  const [walls, sky, ground] = lists, surfaces = walls.concat(ground);
  const share = (l) => round(l.length / n, 4);
  const allL = Float64Array.from(f.L).sort();
  const out = {
    width: w, height: h, horizonRow: horizon,
    shares: { sky: share(sky), ground: share(ground), walls: share(walls) },
    framing: sky.length / n < T.poorLow || sky.length / n > T.poorHigh ? 'poor framing' : 'ok',
    regions: { sky: regionStats(f, sky), ground: regionStats(f, ground), walls: regionStats(f, walls) },
    contrast: round(percentileSorted(allL, 90) - percentileSorted(allL, 10)),
    meanChromaAll: round(mean(Array.from(f.A, (a, i) => Math.hypot(a, f.B[i])))),
    meanL: round(mean(f.L)),
    shade: { ground: shadeSplit(f, ground), walls: shadeSplit(f, walls), surfaces: shadeSplit(f, surfaces) },
    busyness: null, colourfulness: null,
  };
  if (walls.length >= T.minRegion) {
    const wl = Float64Array.from(walls, (i) => f.L[i]).sort(), med = percentileSorted(wl, 50);
    let g = 0, open = 0; for (const i of walls) { g += f.G[i]; if (f.L[i] < med - T.openingDrop) open++; }
    out.busyness = { gradient: round(g / walls.length), darkOpenings: round(open / walls.length, 4) };
    const step = Math.max(1, Math.floor(walls.length / 4000)), pts = [];
    for (let k = 0; k < walls.length; k += step) { const i = walls[k]; pts.push(f.L[i], f.A[i], f.B[i]); }
    const cl = kmeans3(Float64Array.from(pts), 5, 10, 1);
    out.colourfulness = { stdA: round(stdev(walls.map((i) => f.A[i]))), stdB: round(stdev(walls.map((i) => f.B[i]))), dominant: cl.map((c) => ({ L: round(c.centre[0]), a: round(c.centre[1]), b: round(c.centre[2]), hex: labToHex(...c.centre), share: round(c.share, 3) })) };
  }
  return { numbers: out, mask };
}

/**
 * Why a photograph is left out of the reference (null when it is used). Applied after measuring, to photographs only:
 * night or very dark (mean L* under 30), washed out or flash (mean L* over 88), monochrome scan (mean chroma under 6), a close-up with no sky and under 5 % ground.
 */
export function usable(numbers) {
  if (numbers.meanL < 30) return 'too dark';
  if (numbers.meanL > 88) return 'washed out';
  if (numbers.meanChromaAll < 6) return 'monochrome';
  if (numbers.shares.sky < T.poorLow && numbers.shares.ground < 0.05) return 'no street in view (no sky, no ground)';
  return null;
}
