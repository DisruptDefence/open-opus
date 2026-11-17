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

/** Median of plain numbers (NaN when empty). */
export const median = (xs) => weightedMedian(xs.filter(Number.isFinite).map((v) => ({ v, w: 1 })));
/** Median absolute deviation about the median (NaN for fewer than 2 numbers). */
export function mad(xs) { const v = xs.filter(Number.isFinite); if (v.length < 2) return NaN; const m = median(v); return median(v.map((x) => Math.abs(x - m))); }

/**
 * Earth mover's distance between two weighted point sets (weights normalised to 1 each): the least total of weight x distance
 * that turns one into the other. A minimum-cost flow on the small bipartite graph (source -> P -> Q -> sink), by successive shortest
 * paths (SPFA). `dist(p, q)` is the ground distance. Points: [{ w, ... }]. NaN when either set is empty.
 */
export function emd(P, Q, dist) {
  const sp = P.reduce((s, p) => s + p.w, 0), sq = Q.reduce((s, q) => s + q.w, 0); if (!(sp > 0) || !(sq > 0)) return NaN;
  const n = P.length, m = Q.length, S = n + m, T = n + m + 1, N = n + m + 2, E = [], adj = Array.from({ length: N }, () => []);
  const edge = (u, v, cap, cost) => { adj[u].push(E.length); E.push({ v, cap, cost }); adj[v].push(E.length); E.push({ v: u, cap: 0, cost: -cost }); };
  P.forEach((p, i) => edge(S, i, p.w / sp, 0)); Q.forEach((q, j) => edge(n + j, T, q.w / sq, 0));
  P.forEach((p, i) => Q.forEach((q, j) => edge(i, n + j, 1, dist(p, q))));
  let total = 0;
  for (let round = 0; round < 1000; round++) {
    const d = new Array(N).fill(Infinity), via = new Array(N).fill(-1), queue = [S]; d[S] = 0;
    for (let qi = 0; qi < queue.length && qi < 100000; qi++) { const u = queue[qi]; for (const id of adj[u]) { const e = E[id]; if (e.cap > 1e-12 && d[u] + e.cost < d[e.v] - 1e-12) { d[e.v] = d[u] + e.cost; via[e.v] = id; queue.push(e.v); } } }
    if (!Number.isFinite(d[T])) break;
    let cap = Infinity; for (let v = T; v !== S; v = E[via[v] ^ 1].v) cap = Math.min(cap, E[via[v]].cap);
    if (!(cap > 1e-12)) break;
    for (let v = T; v !== S; v = E[via[v] ^ 1].v) { E[via[v]].cap -= cap; E[via[v] ^ 1].cap += cap; }
    total += cap * d[T];
  }
  return total;
}

/** Weighted k-means in 3-D ([{ p: [x,y,z], w }]); farthest-first start, fixed iterations. Clusters by weight, largest first, as { centre, share }. */
export function kmeans3w(items, k = 5, iters = 10) {
  const xs = items.filter((i) => i.w > 0); if (!xs.length) return [];
  const kk = Math.min(k, xs.length), tot = xs.reduce((s, i) => s + i.w, 0), d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const C = [xs.reduce((b, i) => (i.w > b.w ? i : b), xs[0]).p.slice()];
  while (C.length < kk) { let best = null, bd = -1; for (const i of xs) { const d = Math.min(...C.map((c) => d2(i.p, c))); if (d > bd) { bd = d; best = i; } } C.push(best.p.slice()); }
  let assign = new Array(xs.length).fill(0);
  for (let it = 0; it < iters; it++) {
    assign = xs.map((i) => { let b = 0, bd = Infinity; C.forEach((c, ci) => { const d = d2(i.p, c); if (d < bd) { bd = d; b = ci; } }); return b; });
    C.forEach((c, ci) => { let w = 0, s = [0, 0, 0]; xs.forEach((i, ii) => { if (assign[ii] === ci) { w += i.w; for (let j = 0; j < 3; j++) s[j] += i.p[j] * i.w; } }); if (w) for (let j = 0; j < 3; j++) c[j] = s[j] / w; });
  }
  const out = C.map((c, ci) => ({ centre: c, share: xs.reduce((s, i, ii) => s + (assign[ii] === ci ? i.w : 0), 0) / tot })).filter((c) => c.share > 0);
  return out.sort((a, b) => b.share - a.share || a.centre[0] - b.centre[0]);
}
