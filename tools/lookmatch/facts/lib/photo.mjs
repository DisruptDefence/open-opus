// One photograph to façade facts: wall colour clusters with materials and shares, accent colours, roof colours.
// Pure (RGBA in, numbers and per-pixel maps out). The region mask (sky / ground / wall) comes from the caller, found
// by lib/measure.mjs at 320 px; here it is carried up to the working size. All rules and thresholds: lib/rules.mjs.
import { labField } from '../../lib/measure.mjs';
import { MASK } from '../../lib/measure.mjs';
import { otsu, rng } from '../../lib/stats.mjs';
import { kmeans, nearest } from './kmeans.mjs';
import { RULES, materialOf, textureStats, hexOf, deltaE, chroma, isVegetation, isGlass, roofOf, shadeGain } from './rules.mjs';
import { hueDeg } from '../../lib/color.mjs';

export const PX = { wall: 0, sky: 1, ground: 2, veg: 3, glass: 4, opening: 5, roofBand: 6, off: 7 };  // what a pixel was taken for (overlay)

/** The mask of the 320 px analysis carried to w x h by nearest neighbour. */
export function upMask(mask, mw, mh, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const sy = Math.min(mh - 1, Math.floor((y * mh) / h)); for (let x = 0; x < w; x++) out[y * w + x] = mask[sy * mw + Math.min(mw - 1, Math.floor((x * mw) / w))]; }
  return out;
}

/** Mean of L* over a (2r+1) square at every pixel (integral image). */
function localMean(L, w, h, r) {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Dark blobs inside `candidate` pixels (darker than their surroundings by RULES.opening.drop): 1 where an opening. */
export function openings(L, candidate, w, h, R = RULES.opening) {
  const lm = localMean(L, w, h, R.radius), dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (candidate[i] && L[i] < lm[i] - R.drop) dark[i] = 1;
  // keep blobs (4-connected) of at least minPixels
  const lab = new Int32Array(w * h), keep = new Uint8Array(w * h), stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!dark[s] || lab[s]) continue;
    const comp = []; lab[s] = 1; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); comp.push(i); const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && dark[j] && !lab[j]) { lab[j] = 1; stack.push(j); }
    }
    if (comp.length >= R.minPixels) for (const i of comp) keep[i] = 1;
  }
  return dilate(keep, w, h, R.dilate);
}
export function dilate(m, w, h, r) {
  if (r <= 0) return m;
  let cur = m;
  for (let it = 0; it < r; it++) {
    const nx = new Uint8Array(cur);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (cur[i]) continue; if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) nx[i] = 1; }
    cur = nx;
  }
  return cur;
}

/** The tool's sky rule misses deep saturated blue; grow the sky mask (in place) through blue pixels 4-connected to it. */
export function growSky(f, mask, w, h, R, skyEnd) {
  const ok = (i) => f.B[i] <= R.bMax && f.A[i] <= R.aMax && mask[i] === MASK.wall, stack = [];
  for (let i = 0; i < w * h; i++) if (mask[i] === MASK.sky) stack.push(i);
  for (let x = 0; x < w; x++) if (ok(x)) { mask[x] = MASK.sky; stack.push(x); }   // a deep blue top row the tool did not call sky
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && ok(j)) { mask[j] = MASK.sky; stack.push(j); }
  }
  for (let x = 0; x < w; x++) { let y = 0; while (y < h && mask[y * w + x] === MASK.sky) y++; skyEnd[x] = y; }
}

const median = (v) => { if (!v.length) return NaN; const s = Float64Array.from(v).sort(); return s[s.length >> 1]; };

/** Cluster descriptors from the members' de-lit Lab: median L, a, b per channel. */
function describe(idx, D, n) {
  const step = Math.max(1, Math.floor(idx.length / 6000)), Ls = [], As = [], Bs = [];
  for (let q = 0; q < idx.length; q += step) { const i = idx[q]; Ls.push(D.L[i]); As.push(D.A[i]); Bs.push(D.B[i]); }
  return { L: median(Ls), a: median(As), b: median(Bs), n };
}

/**
 * Analyse one photograph. rgba/w/h at the working size; `mask` (MASK values) at the same size (see upMask).
 * Returns { walls: [{ material, hex, lab, share, e1, e4, cv, hue, chroma }], accents: [...], roofs: [...], counts, maps }.
 * `valid` (optional, stage B): 1 for the pixels to look at, 0 elsewhere (they are PX.off).
 * `maps` = { px: Uint8Array of PX, id: Int16Array of cluster index (-1 none), clusters } for the overlay.
 */
export function analysePhoto(rgba, w, h, mask, R = RULES, valid = null) {
  const f = labField(rgba, w, h), n = w * h, px = new Uint8Array(n);
  // sky edge per column and roof band
  const skyEnd = new Int32Array(w), bandRows = Math.max(2, Math.round(h * R.roofBand.rows));
  for (let x = 0; x < w; x++) { let y = 0; while (y < h && mask[y * w + x] === MASK.sky) y++; skyEnd[x] = y; }
  // the tool's sky rule (320 px, bright and smooth) takes pale stone for sky: sky that is textured at this size and not blue is wall again
  const skyTex = localMean(f.G, w, h, R.skyTexture.radius);
  for (let i = 0; i < n; i++) if (mask[i] === MASK.sky && skyTex[i] > R.skyTexture.minGradient && f.B[i] >= R.skyTexture.minB) mask[i] = MASK.wall;
  if (!valid) growSky(f, mask, w, h, R.skyLeak, skyEnd);   // (not in a façade strip: there is no sky there)
  const groundTop = new Int32Array(w).fill(h);   // per column, the top of the ground region that reaches the bottom edge
  for (let x = 0; x < w; x++) { let y = h - 1; while (y >= 0 && mask[y * w + x] === MASK.ground) y--; groundTop[x] = y + 1; }
  const cand = new Uint8Array(n);   // pixels that might be wall: region wall, not vegetation, not glass
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, m = mask[i];
    if (valid && !valid[i]) { px[i] = PX.off; continue; }   // stage B: outside the strip of one façade
    if (m === MASK.sky) { px[i] = PX.sky; continue; }
    if (m === MASK.ground) { px[i] = PX.ground; continue; }
    if (skyEnd[x] > 0 && y >= skyEnd[x] && y < skyEnd[x] + bandRows) { px[i] = PX.roofBand; continue; }
    if (y >= groundTop[x] || (y >= h * (1 - R.pavement.lowerShare) && Math.hypot(f.A[i], f.B[i]) < R.pavement.maxChroma)) { px[i] = PX.ground; continue; }
    if (isVegetation(f.L[i], f.A[i], f.B[i], R.vegetation)) { px[i] = PX.veg; continue; }
    if (isGlass(f.L[i], f.A[i], f.B[i], R.glass)) { px[i] = PX.glass; continue; }
    cand[i] = 1;
  }
  const open = openings(f.L, cand, w, h, R.opening);
  for (let i = 0; i < n; i++) if (cand[i] && open[i]) { px[i] = PX.opening; cand[i] = 0; }
  const wallIdx = []; for (let i = 0; i < n; i++) if (cand[i]) { px[i] = PX.wall; wallIdx.push(i); }
  const counts = { pixels: n, wall: wallIdx.length, opening: 0, vegetation: 0, glass: 0, roofBand: 0 };
  for (let i = 0; i < n; i++) { if (px[i] === PX.opening) counts.opening++; else if (px[i] === PX.veg) counts.vegetation++; else if (px[i] === PX.glass) counts.glass++; else if (px[i] === PX.roofBand) counts.roofBand++; }
  const out = { walls: [], accents: [], roofs: [], counts, maps: { px, id: new Int16Array(n).fill(-1), clusters: [] } };
  if (wallIdx.length < 600) return out;

  // no global de-lighting: sun and shade of one paint are merged afterwards (twin step), and the sunlit twin gives the colour
  const D = { L: f.L, A: f.A, B: f.B };

  // k-means on a sample, assign every wall pixel
  const step = Math.max(1, Math.floor(wallIdx.length / R.cluster.maxSamples)), pts = [];
  for (let q = 0; q < wallIdx.length; q += step) { const i = wallIdx[q]; pts.push(D.L[i], D.A[i], D.B[i]); }
  const km = kmeans(Float64Array.from(pts), R.cluster.k, R.cluster.iters, R.cluster.seed);
  let centres = km.centres;
  const ids = out.maps.id, member = new Int16Array(wallIdx.length);
  for (let q = 0; q < wallIdx.length; q++) { const i = wallIdx[q]; member[q] = nearest(centres, D.L[i], D.A[i], D.B[i]); }
  // merge shade twins: the same hue and the same chroma-to-lightness ratio, one darker (repeat until none)
  let alias = centres.map((_, c) => c);
  const root = (c) => { while (alias[c] !== c) c = alias[c]; return c; };
  const desc0 = () => centres.map((_, c) => { const idx = []; for (let q = 0; q < wallIdx.length; q++) if (root(member[q]) === c) idx.push(wallIdx[q]); return describe(idx, D, idx.length); });
  for (let pass = 0; pass < 6; pass++) {
    const ds = desc0(); let merged = false;
    for (let a = 0; a < ds.length && !merged; a++) for (let b = 0; b < ds.length && !merged; b++) {
      if (a === b || root(a) !== a || root(b) !== b || !ds[a].n || !ds[b].n) continue;
      const dk = ds[a].L >= ds[b].L ? [ds[a], ds[b]] : [ds[b], ds[a]], lit = dk[0], dark = dk[1];
      const dh = Math.abs(hueDeg(lit.a, lit.b) - hueDeg(dark.a, dark.b)), dhh = Math.min(dh, 360 - dh);
      const lowChroma = chroma(lit) < R.twin.minChroma || chroma(dark) < R.twin.minChroma;   // greys are never merged: hue is noise and a dark grey is not the shade of a white (they stay two clusters)
      const ratioDiff = Math.abs(chroma(lit) / Math.max(1, lit.L) - chroma(dark) / Math.max(1, dark.L));
      if ((!lowChroma && dhh <= R.twin.hueDeg && ratioDiff <= R.twin.ratio) && dark.L / lit.L >= R.twin.lRatioMin && dark.L / lit.L <= 0.97) {
        // the bigger one keeps the name
        const keep = ds[a].n >= ds[b].n ? a : b, drop = keep === a ? b : a; alias[drop] = keep; merged = true;
      }
    }
    if (!merged) break;
  }
  const finalIds = [...new Set(centres.map((_, c) => root(c)))];
  const index = new Map(finalIds.map((c, j) => [c, j]));
  for (let q = 0; q < wallIdx.length; q++) ids[wallIdx[q]] = index.get(root(member[q]));
  const K = finalIds.length;
  const tex = textureStats(D.L, ids, w, h, K);
  const members = Array.from({ length: K }, () => []); for (const i of wallIdx) members[ids[i]].push(i);
  // colour of a merged cluster: its sunlit part (the brightest original k-means cluster holding at least 20 % of it)
  const parts = Array.from({ length: K }, () => new Map());
  for (let q = 0; q < wallIdx.length; q++) { const c = index.get(root(member[q])); (parts[c].get(member[q]) || parts[c].set(member[q], []).get(member[q])).push(wallIdx[q]); }
  const litDesc = (c) => { let best = null; for (const idx of parts[c].values()) { if (idx.length < 0.2 * members[c].length) continue; const d = describe(idx, D, idx.length); if (!best || d.L > best.L) best = d; } return best || describe(members[c], D, members[c].length); };
  const clusters = [];
  for (let c = 0; c < K; c++) {
    const d = litDesc(c), share = members[c].length / wallIdx.length;
    const material = materialOf(d, tex[c], R.material);
    if (material === 'painted_white') d.L = Math.max(d.L, R.material.painted_white.litL);   // white is white in shade: see rules.mjs
    clusters.push({ material, hex: hexOf(d), lab: [+d.L.toFixed(1), +d.a.toFixed(1), +d.b.toFixed(1)], share: +share.toFixed(4), e1: +tex[c].e1.toFixed(2), e4: +tex[c].e4.toFixed(2), cv: tex[c].cv == null ? null : +tex[c].cv.toFixed(2), hue: +hueDeg(d.a, d.b).toFixed(0), chroma: +chroma(d).toFixed(1) });
  }
  out.maps.clusters = clusters;     // indexed by the ids map
  out.maps.centres = clusters.map((_, c) => ({ ...litDesc(c), n: members[c].length }));
  const FW = R.accent.fromWall;
  const moved = clusters.filter((c) => c.share >= R.cluster.minShare && ((c.chroma >= FW.minChroma && c.e1 < FW.maxE1) || (c.chroma >= FW.hueFreeMinChroma && (c.hue < FW.hueFree[0] || c.hue > FW.hueFree[1]) && c.e1 < FW.hueFreeMaxE1 && c.material !== 'brick')));
  out.walls = clusters.filter((c) => c.share >= R.cluster.minShare && !moved.includes(c)).sort((a, b) => b.share - a.share);
  for (const c of moved) { c.material = 'accent'; out.accents.push({ hex: c.hex, lab: c.lab, share: c.share, hue: c.hue, chroma: c.chroma }); }

  // accents: saturated pixels in a ring round the openings that are not the colour of a main wall cluster
  const ring = dilate(open, w, h, R.accent.ring), inner = dilate(open, w, h, R.accent.gap), ap = [], aIdx = [];
  const mains = out.maps.centres.filter((c, j) => c.n / wallIdx.length >= 0.08);
  for (let i = 0; i < n; i++) {
    if (!ring[i] || inner[i] || px[i] !== PX.wall) continue;
    const c = { L: D.L[i], a: D.A[i], b: D.B[i] };
    if (Math.hypot(c.a, c.b) < R.accent.minChroma) continue;
    if ((ids[i] >= 0 && out.maps.centres[ids[i]].n / wallIdx.length >= 0.08) || mains.some((m) => deltaE(c, m) < R.accent.minDeltaE)) continue;   // a main wall cluster's own pixels (sun or shade) are not trim
    aIdx.push(i); ap.push(c.L, c.a, c.b);
  }
  if (aIdx.length >= 40) {
    const ak = kmeans(Float64Array.from(ap), R.accent.k, 10, R.cluster.seed), groups = ak.centres.map(() => []);
    for (let q = 0; q < aIdx.length; q++) groups[ak.assign[q]].push(aIdx[q]);
    for (const g of groups) {
      const share = g.length / wallIdx.length; if (share < R.accent.minShare) continue;
      const d = describe(g, D, g.length);
      out.accents.push({ hex: hexOf(d), lab: [+d.L.toFixed(1), +d.a.toFixed(1), +d.b.toFixed(1)], share: +share.toFixed(4), hue: +hueDeg(d.a, d.b).toFixed(0), chroma: +chroma(d).toFixed(1) });
    }
  }
  out.accents.sort((a, b) => b.share - a.share); out.accents.length = Math.min(out.accents.length, R.accent.maxCount);

  // roofs: the band under the sky edge
  const band = []; for (let i = 0; i < n; i++) if (px[i] === PX.roofBand && !isGlass(f.L[i], f.A[i], f.B[i])) band.push(i);
  if (band.length >= 300) {
    const sp = []; const bs = Math.max(1, Math.floor(band.length / 4000)); for (let q = 0; q < band.length; q += bs) { const i = band[q]; sp.push(f.L[i], f.A[i], f.B[i]); }
    const rk = kmeans(Float64Array.from(sp), R.roof.k, 10, R.cluster.seed), rid = new Int16Array(n).fill(-1), rm = Array.from({ length: rk.centres.length }, () => []);
    for (const i of band) { const c = nearest(rk.centres, f.L[i], f.A[i], f.B[i]); rid[i] = c; rm[c].push(i); }
    const rt = textureStats(f.L, rid, w, h, rk.centres.length);
    for (let c = 0; c < rm.length; c++) {
      if (!rm[c].length) continue;
      const d = describe(rm[c], { L: f.L, A: f.A, B: f.B }, rm[c].length), share = rm[c].length / band.length;
      const mat = roofOf(d, rt[c], R.roof);
      if (mat && share >= R.roof.minShare) out.roofs.push({ material: mat, hex: hexOf(d), share: +share.toFixed(3), e1: +rt[c].e1.toFixed(2), confidence: 'low' });
    }
    out.roofs.sort((a, b) => b.share - a.share);
  }
  return out;
}
