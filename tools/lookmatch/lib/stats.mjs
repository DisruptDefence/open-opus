// Small statistics: percentile, Otsu threshold, seeded k-means, weighted median. Pure and deterministic.

/** p in 0..100, linear interpolation between ranks; `sorted` ascending. NaN for an empty list. */
export function percentileSorted(sorted, p) {
  const n = sorted.length; if (!n) return NaN;
  const pos = (p / 100) * (n - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const percentile = (values, p) => percentileSorted(Float64Array.from(values).sort(), p);
export const mean = (v) => { let s = 0; for (const x of v) s += x; return v.length ? s / v.length : NaN; };
export const stdev = (v) => { const m = mean(v); let s = 0; for (const x of v) s += (x - m) ** 2; return v.length ? Math.sqrt(s / v.length) : NaN; };

/** Otsu's threshold of values in [lo, hi] over 128 bins: a value below it is "dark", at or above it "lit". */
export function otsu(values, lo = 0, hi = 100, bins = 128) {
  const h = new Float64Array(bins), n = values.length; if (n < 2) return (lo + hi) / 2;
  for (const v of values) h[Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
  let sumAll = 0; for (let i = 0; i < bins; i++) sumAll += i * h[i];
  let wB = 0, sumB = 0, best = -1, bestT = 0;
  for (let t = 0; t < bins; t++) {
    wB += h[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += t * h[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return lo + ((bestT + 1) / bins) * (hi - lo);
}

/** Seeded PRNG (mulberry32). */
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** k-means on 3-D points (flat array [x,y,z,...]); seeded k-means++ start, fixed iterations. Returns clusters sorted by share, largest first. */
export function kmeans3(pts, k = 5, iters = 10, seed = 1) {
  const n = pts.length / 3; if (!n) return [];
  const r = rng(seed), kk = Math.min(k, n), C = new Float64Array(kk * 3);
  const d2 = (i, c) => (pts[i * 3] - C[c * 3]) ** 2 + (pts[i * 3 + 1] - C[c * 3 + 1]) ** 2 + (pts[i * 3 + 2] - C[c * 3 + 2]) ** 2;
  let first = Math.floor(r() * n); for (let j = 0; j < 3; j++) C[j] = pts[first * 3 + j];
  const dist = new Float64Array(n);
  for (let c = 1; c < kk; c++) {
    let tot = 0; for (let i = 0; i < n; i++) { let m = Infinity; for (let q = 0; q < c; q++) m = Math.min(m, d2(i, q)); dist[i] = m; tot += m; }
    let pick = 0, t = r() * tot; for (let i = 0; i < n; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } pick = i; }
    for (let j = 0; j < 3; j++) C[c * 3 + j] = pts[pick * 3 + j];
  }
  const assign = new Int32Array(n), cnt = new Float64Array(kk);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < kk; c++) { const d = d2(i, c); if (d < bd) { bd = d; b = c; } } assign[i] = b; }
    const S = new Float64Array(kk * 3); cnt.fill(0);
    for (let i = 0; i < n; i++) { const c = assign[i]; cnt[c]++; for (let j = 0; j < 3; j++) S[c * 3 + j] += pts[i * 3 + j]; }
    for (let c = 0; c < kk; c++) if (cnt[c]) for (let j = 0; j < 3; j++) C[c * 3 + j] = S[c * 3 + j] / cnt[c];
  }
  const out = []; for (let c = 0; c < kk; c++) out.push({ centre: [C[c * 3], C[c * 3 + 1], C[c * 3 + 2]], share: cnt[c] / n });
  return out.sort((a, b) => b.share - a.share || a.centre[0] - b.centre[0]);
}

/** Weighted median of [{v, w}] (w > 0); the mean of the two middle values at an exact half. NaN when empty. */
export function weightedMedian(items) {
  const xs = items.filter((i) => Number.isFinite(i.v) && i.w > 0).sort((a, b) => a.v - b.v);
  if (!xs.length) return NaN;
  const tot = xs.reduce((s, i) => s + i.w, 0); let acc = 0;
  for (let k = 0; k < xs.length; k++) {
    acc += xs[k].w;
    if (Math.abs(acc - tot / 2) < 1e-9 && k + 1 < xs.length) return (xs[k].v + xs[k + 1].v) / 2; // exactly half: between the two middle values
    if (acc > tot / 2) return xs[k].v;
  }
  return xs[xs.length - 1].v;
}
