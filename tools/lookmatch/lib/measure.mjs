// The measures, taken the same way on every photograph and every render. Pure: an RGBA array, width and height in,
// numbers and a region mask out. All images are read at 320 px width by the caller (measure.mjs does not resize).
//
// REGIONS (identical rules for photo and render; thresholds in `T` below, L*a*b* of each pixel). Both are flood fills
// that grow from an edge of the picture and stop at strong edges, so neither depends on one fixed brightness:
//   sky    = seeded on the TOP edge, grown through 4-connected pixels that are (bright relative to THIS image: L* within
//            `skyRelDrop` of the image's own upper-quartile L*, OR bluish: b* <= `skyBlueB`), never darker than `skyMinL` (a dark picture is not all sky) AND smooth
//            (local luminance gradient < `skyGrad` L* per pixel) AND not warm or strongly coloured (b* <= `skyB`, chroma <= `skyChroma`).
//            A dim grey-blue sky and a cloudy sky with dark, bluish cloud bases are both found; a roof line, a wall or a tree
//            crown is a strong edge, or warm, so the fill stops there. Two more guards, because soft edges (a blurred render, haze at the
//            roof line) let a fill leak into smooth stucco and tarmac: a step to a neighbour of more than `skyStep` L* is not crossed, and in
//            every column the sky is the run from the top edge, ended by more than `skyGap` consecutive non-sky rows (a thin wire or branch is
//            crossed, a building is not): sky found below such a run is dropped.
//   horizon = the row at the median over all columns of the sky height (rows of sky counted down from the top).
//   ground = seeded on the BOTTOM edge, grown through 4-connected pixels below the horizon row and in the lower `groundLowerShare`
//            of the picture that are low-saturation (chroma < `groundChroma`), within `groundDL` L* of the median of the bottom 5 % of rows
//            (the surface the camera stands on) and not behind a steep vertical luminance step (|dL/dy| < `groundStep`, the line where a
//            wall meets the ground), and NOT in a vertical-edge-dominated neighbourhood: walls have vertical structure (window
//            reveals, corners, courses of stone seen end on), ground does not. A pixel is vertical-edge-dominated when, over a
//            (2 `vertRadius` + 1) square, the mean |dL/dx| (the strength of vertical edges) is at least `vertMin` and at least `vertRatio` times
//            the mean |dL/dy|; or when it is too textured to be a surface to stand on (mean gradient over the same square >= `groundTex`).
//            Second pass, against speckle: stone façades are grey and textured, so the first fill leaks into them as scattered
//            pixels. The fill is repeated from the bottom edge through only those first-pass pixels whose (2 `denseRadius` + 1) square is at least
//            `denseMin` ground: a solid surface stays, a speckled one is cut off.
//   walls  = everything else (buildings, trees, people, cars: "the rest").
//   Poor framing: sky share under 3 % or over 70 %: the picture gets half weight in a reference.
// PER REGION (sky, ground, walls): share; mean L*, a*, b*; 10th, 50th, 90th percentile of L*; mean chroma; hue of the mean (a*, b*) in degrees.
// WHOLE IMAGE: contrast = L* p90 - p10 over all pixels.
// SHADE AND SUN: ground, walls and `surfaces` (both together) are each split at their own Otsu threshold on L*:
//   dark part and lit part, each with mean L*, a*, b* and share; ratio = dark mean L* / lit mean L*.
// TEXTURE (to tell a photograph from a painting, print or scan; used by `usable`): `hf` = mean |Laplacian of L*| (high-frequency energy);
//   `palette` = how many cells of an L*a*b* grid (6 units) hold at least 0.2 % of the pixels (a posterised picture has few);
//   `hueR` = length of the chroma-weighted mean unit vector of hue over pixels with chroma >= 3 (1 = every pixel the same hue);
//   `hue` = that mean hue in degrees.
// BUSYNESS (rough stand-in for window density and street detail, not a count of anything): wall pixels' mean gradient
//   magnitude of L* (per pixel, central differences) and the share of wall pixels darker than the walls' median L* minus 25 ("dark openings").
// COLOURFULNESS of walls: standard deviation of a* and of b* over wall pixels; the five dominant wall colours by
//   k-means (k = 5, seeded, 10 iterations, up to 4000 sampled pixels) with their shares.
import { srgb8ToLab, labToHex, hueDeg } from './color.mjs';
import { percentileSorted, mean, stdev, otsu, kmeans3 } from './stats.mjs';

export const T = { skyRelDrop: 14, skyBlueB: -1.5, skyMinL: 25, skyB: 8, skyChroma: 50, skyGrad: 8, skyStep: 6, skyGap: 6, groundChroma: 20, groundBand: 0.05, groundDL: 25, groundStep: 10, groundLowerShare: 0.45, vertRadius: 2, vertMin: 2.5, vertRatio: 1.7, denseRadius: 3, denseMin: 0.55, groundTex: 5, poorLow: 0.03, poorHigh: 0.7, minRegion: 20, openingDrop: 25 };
export const MASK = { wall: 0, sky: 1, ground: 2 };
const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);

function floodFrom(seedsOk, w, h, ok, mask, value, rowFrom = 0, startRow, step = null) {
  const stack = []; const idx = (x, y) => y * w + x;
  for (let x = 0; x < w; x++) { const i = idx(x, startRow); if (ok(i, startRow) && mask[i] === 0) { mask[i] = value; stack.push(i); } }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0 && mask[i - 1] === 0 && ok(i - 1, y) && (!step || step(i, i - 1))) { mask[i - 1] = value; stack.push(i - 1); }
    if (x < w - 1 && mask[i + 1] === 0 && ok(i + 1, y) && (!step || step(i, i + 1))) { mask[i + 1] = value; stack.push(i + 1); }
    if (y > 0 && mask[i - w] === 0 && ok(i - w, y - 1) && (!step || step(i, i - w))) { mask[i - w] = value; stack.push(i - w); }
    if (y < h - 1 && mask[i + w] === 0 && ok(i + w, y + 1) && (!step || step(i, i + w))) { mask[i + w] = value; stack.push(i + w); }
  }
}

/** Per-pixel Lab and L* gradient magnitude. */
export function labField(rgba, w, h) {
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), G = new Float32Array(n), GY = new Float32Array(n), GX = new Float32Array(n);
  for (let i = 0; i < n; i++) { const lab = srgb8ToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2]; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = (L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)]) / 2, gy = (L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]) / 2;
    G[i] = Math.hypot(gx, gy); GY[i] = Math.abs(gy); GX[i] = Math.abs(gx);
  }
  return { L, A, B, G, GY, GX };
}

/** Per pixel: is the neighbourhood dominated by vertical edges (mean |dL/dx| strong and well above mean |dL/dy|), or too textured to be ground? */
export function verticalDominated(f, w, h) {
  const r = T.vertRadius, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sx = 0, sy = 0, sg = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { const j = yy * w + xx; sx += f.GX[j]; sy += f.GY[j]; sg += f.G[j]; n++; }
    sx /= n; sy /= n; out[y * w + x] = (sx >= T.vertMin && sx >= T.vertRatio * sy) || sg / n >= T.groundTex ? 1 : 0;
  }
  return out;
}

/** Region mask: Uint8Array of MASK values, plus the horizon row. */
export function regions(f, w, h) {
  const mask = new Uint8Array(w * h), n = w * h;
  const allL = Float64Array.from(f.L).sort(), q75 = percentileSorted(allL, 75);
  const skyOk = (i) => (f.L[i] >= q75 - T.skyRelDrop || (f.B[i] <= T.skyBlueB)) && f.L[i] >= T.skyMinL && f.B[i] <= T.skyB && Math.hypot(f.A[i], f.B[i]) <= T.skyChroma && f.G[i] < T.skyGrad;
  floodFrom(null, w, h, skyOk, mask, MASK.sky, 0, 0, (i, j) => Math.abs(f.L[i] - f.L[j]) <= T.skyStep);
  for (let x = 0; x < w; x++) { let gap = 0, end = h; for (let y = 0; y < h; y++) { if (mask[y * w + x] === MASK.sky) gap = 0; else if (++gap > T.skyGap) { end = y; break; } } for (let y = end; y < h; y++) if (mask[y * w + x] === MASK.sky) mask[y * w + x] = MASK.wall; }
  const heights = []; for (let x = 0; x < w; x++) { let y = 0; while (y < h && mask[y * w + x] === MASK.sky) y++; heights.push(y); }
  heights.sort((a, b) => a - b);
  const horizon = heights[heights.length >> 1];
  const minRow = Math.max(horizon, Math.floor(h * (1 - T.groundLowerShare)));
  const band = []; for (let y = Math.max(0, h - Math.max(1, Math.round(h * T.groundBand))); y < h; y++) for (let x = 0; x < w; x++) band.push(f.L[y * w + x]);
  band.sort((a, b) => a - b); const base = band[band.length >> 1], vert = verticalDominated(f, w, h);
  const groundOk = (i, y) => y >= minRow && Math.hypot(f.A[i], f.B[i]) < T.groundChroma && Math.abs(f.L[i] - base) <= T.groundDL && f.GY[i] < T.groundStep && !vert[i];
  floodFrom(null, w, h, groundOk, mask, MASK.ground, 0, h - 1);
  const first = Uint8Array.from(mask, (m) => (m === MASK.ground ? 1 : 0)), r = T.denseRadius, dense = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = 0, k = 0; for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { c += first[yy * w + xx]; k++; }
    dense[y * w + x] = c / k >= T.denseMin ? 1 : 0;
  }
  for (let i = 0; i < n; i++) if (mask[i] === MASK.ground) mask[i] = MASK.wall;
  floodFrom(null, w, h, (i) => first[i] === 1 && dense[i] === 1, mask, MASK.ground, 0, h - 1);
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

/** High-frequency energy, palette size and hue concentration of an image (see TEXTURE in the header). */
export function textureOf(f, w, h) {
  let hf = 0, n = 0; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; hf += Math.abs(4 * f.L[i] - f.L[i - 1] - f.L[i + 1] - f.L[i - w] - f.L[i + w]); n++; }
  const cells = new Map(); let sx = 0, sy = 0, sc = 0;
  for (let i = 0; i < w * h; i++) {
    const k = Math.round(f.L[i] / 6) * 1e6 + Math.round(f.A[i] / 6) * 1e3 + Math.round(f.B[i] / 6); cells.set(k, (cells.get(k) || 0) + 1);
    const c = Math.hypot(f.A[i], f.B[i]); if (c >= 3) { sx += f.A[i]; sy += f.B[i]; sc += c; }
  }
  return { hf: round(n ? hf / n : 0), palette: [...cells.values()].filter((c) => c >= w * h * 0.002).length, hueR: round(sc ? Math.hypot(sx, sy) / sc : 0, 3), hue: round(hueDeg(sx, sy), 1) };
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
    texture: textureOf(f, w, h), busyness: null, colourfulness: null,
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

export const U = { dark: 30, bright: 88, mono: 6, noSky: T.poorLow, noGround: 0.05, flatHf: 4, fewColours: 30, sepiaR: 0.97, sepiaHue: [30, 100], sepiaChroma: 35 };
/**
 * Why a photograph is left out of the reference (null when it is used). Applied after measuring, to photographs only:
 *  - night or very dark (mean L* under 30), washed out or flash (mean L* over 88), monochrome (mean chroma under 6);
 *  - a painting, print or scan by colour statistics: very low high-frequency energy (mean |Laplacian| under 4 L*) together with a posterised
 *    palette (fewer than 30 occupied cells of the L*a*b* grid), or a sepia tone (hue concentration >= 0.97 at a yellow-brown mean hue of
 *    30..100 degrees and mean chroma under 35: every pixel is the same tint);
 *  - a close-up: almost no sky (under 3 %) AND almost no ground (under 5 %).
 * Photographs from before 1990 and from the metadata's word list are dropped earlier (rank.mjs).
 */
export function usable(numbers) {
  if (numbers.meanL < U.dark) return 'too dark';
  if (numbers.meanL > U.bright) return 'washed out';
  if (numbers.meanChromaAll < U.mono) return 'monochrome';
  const t = numbers.texture;
  if (t && t.hf < U.flatHf && t.palette < U.fewColours) return 'painting or scan (flat and posterised)';
  if (t && t.hueR >= U.sepiaR && t.hue >= U.sepiaHue[0] && t.hue <= U.sepiaHue[1] && numbers.meanChromaAll < U.sepiaChroma) return 'sepia tone (print or scan)';
  if (numbers.shares.sky < U.noSky && numbers.shares.ground < U.noGround) return 'close-up (no sky, no ground)';
  return null;
}
