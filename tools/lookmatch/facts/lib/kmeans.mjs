// Seeded k-means on 3-D points that also says which cluster every point is in (lib/stats.mjs kmeans3 returns the
// centres only; this is a copy of it that keeps the assignment). Deterministic.
import { rng } from '../../lib/stats.mjs';

/** pts: Float64Array [x,y,z,...]. Returns { centres: [[x,y,z]], assign: Int32Array }. */
export function kmeans(pts, k, iters, seed) {
  const n = pts.length / 3; if (!n) return { centres: [], assign: new Int32Array(0) };
  const r = rng(seed), kk = Math.min(k, n), C = new Float64Array(kk * 3);
  const d2 = (i, c) => (pts[i * 3] - C[c * 3]) ** 2 + (pts[i * 3 + 1] - C[c * 3 + 1]) ** 2 + (pts[i * 3 + 2] - C[c * 3 + 2]) ** 2;
  const first = Math.floor(r() * n); for (let j = 0; j < 3; j++) C[j] = pts[first * 3 + j];
  const dist = new Float64Array(n);
  for (let c = 1; c < kk; c++) {
    let tot = 0; for (let i = 0; i < n; i++) { let m = Infinity; for (let q = 0; q < c; q++) m = Math.min(m, d2(i, q)); dist[i] = m; tot += m; }
    let pick = 0, t = r() * tot; for (let i = 0; i < n; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } pick = i; }
    for (let j = 0; j < 3; j++) C[c * 3 + j] = pts[pick * 3 + j];
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < kk; c++) { const d = d2(i, c); if (d < bd) { bd = d; b = c; } } assign[i] = b; }
    const S = new Float64Array(kk * 3), cnt = new Float64Array(kk);
    for (let i = 0; i < n; i++) { const c = assign[i]; cnt[c]++; for (let j = 0; j < 3; j++) S[c * 3 + j] += pts[i * 3 + j]; }
    for (let c = 0; c < kk; c++) if (cnt[c]) for (let j = 0; j < 3; j++) C[c * 3 + j] = S[c * 3 + j] / cnt[c];
  }
  return { centres: Array.from({ length: kk }, (_, c) => [C[c * 3], C[c * 3 + 1], C[c * 3 + 2]]), assign };
}

/** Index of the nearest centre. */
export function nearest(centres, L, a, b) {
  let best = 0, bd = Infinity;
  for (let c = 0; c < centres.length; c++) { const d = (centres[c][0] - L) ** 2 + (centres[c][1] - a) ** 2 + (centres[c][2] - b) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}
