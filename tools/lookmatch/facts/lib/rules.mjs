// The rules of `facts`: what is wall, what is an opening, what a colour cluster is made of, and the stated rules
// that label it. EVERY threshold is in the one table RULES below; nothing else in facts/ has a number that decides
// a label. Each rule has a unit test with a synthetic patch (test/rules.test.js) and was checked by eye against
// real photographs (README, "facts"). The rules are rough on purpose: they are written so a person can read them.
//
// Colour space: CIELAB (lib/color.mjs). Hue is the angle of (a*, b*) in degrees (0 = red-magenta, ~45 = red-orange
// brick, ~75 = ochre/yellow, 90+ yellow-green, 180 = green-cyan, 270 = blue).
//
// DE-LIGHTING. Lighting scales L*, a* and b* together (about s^(1/3) for s times the light), so the same paint in sun and in
// shade has the same hue and the same C*/L* but a lower L*. A global gain on the shaded half was tried and rejected
// (it turns dark brick into pale salmon). Instead: after clustering, two clusters with the same hue (within RULES.twin.hueDeg),
// the same C*/L* (within RULES.twin.ratio) and an L* ratio within [lRatioMin, 0.97] are one paint; the merged cluster's colour is
// its brightest (sunlit) part. Wall colours are therefore the colour under direct light, as photographed.
//
// MATERIAL of a cluster, decided from its de-lit median colour and the texture statistics of its own pixels
// (differences of L* between neighbouring pixels of the same cluster):
//   e1  = mean |dL*| between pixels 1 px apart   (fine texture energy)
//   e4  = mean |dL*| between pixels 4 px apart   (coarse texture energy; e4/e1 near 1 means texture at one scale only)
//   cv  = coefficient of variation of e1 over 24 px blocks of the cluster (low = the same texture everywhere = regular)
// Rules, first match wins, in this order: render (very smooth), painted_white, brick, stone, render (smooth and lit), else unknown. See RULES.material.
import { labToHex, hueDeg } from '../../lib/color.mjs';

export const RULES = {
  decodeWidth: 960,                // photographs are read at this width (the tool's regions are found at 320 px and carried up)
  // pixels that are never wall
  vegetation: { aMax: -6, bMin: 5 },                       // green: a* below -6 and b* above 5 (leaves, lawns)
  glass: { bMax: -6, LMin: 42, aMax: 25 },
  skyLeak: { bMax: -10, aMax: 40 },                        // blue pixels connected to the sky mask are sky (the tool's sky rule stops at chroma 50)                  // bluish and bright: sky seen in a window or a leak of the sky mask
  opening: { radius: 24, drop: 14, minPixels: 14, dilate: 1, minShare: 0.0 }, // darker than the mean of the (2r+1) window by `drop` L*: a window, door or deep shadow; blobs under minPixels are noise
  skyTexture: { radius: 3, minGradient: 1.6, minB: -4 },   // a pixel the tool called sky whose 7x7 mean gradient (L* per px) is over this and that is not blue is wall
  pavement: { lowerShare: 0.38, maxChroma: 9 },           // grey pixels in the lowest share of the picture are the pavement or the street, not wall; anything under the top of the ground region is foreground
  roofBand: { rows: 0.07 },                                // per column, this share of the picture height below the sky edge is the roof band, not wall
  // clustering
  cluster: { k: 6, iters: 12, maxSamples: 9000, seed: 7, minShare: 0.02 },
  shade: { maxGain: 1.55, minPixels: 400 },
  twin: { minChroma: 6, hueDeg: 14, ratio: 0.1, lRatioMin: 0.55 },       // merge two clusters whose hue differs under hueDeg, whose C*/L* differs under `ratio`, and whose L* ratio is within [lRatioMin, 1]
  // materials
  material: {
    render: { maxE1: 1.6, smoothE1: 3.2, smoothMinL: 45 }, // smooth: e1 under maxE1, any hue; and (last rule) a lit colour that matched nothing else with e1 under smoothE1
    painted_white: { minL: 84, maxChroma: 12, shadeL: 66, shadeChroma: 9, shadeMaxE1: 3.4, litL: 88 }, // very light and nearly colourless; or, in shade or under cloud, L* from shadeL, chroma under shadeChroma and e1 under shadeMaxE1 (some texture, not stone). The colour written for white paint has its L* raised to litL (hue and chroma kept): white paint is white in sun and in shade, the engine does its own lighting, and a photograph's grey 'white' under cloud would otherwise tint a whole street grey
    brick: { hue: [20, 65], minChroma: 13, minL: 28, maxL: 68, maxCv: 0.9, minE1: 2.4 },   // red-orange, mid light, regular fine texture
    stone: { maxChroma: 22, minL: 30, maxL: 83, minE1: 2.6 }, // grey to beige, mid light, textured (coarser or less regular than brick)
  },
  // accents: saturated small clusters just outside opening blobs (trim, shutters, doors); and a smooth wall cluster of chroma over fromWall.minChroma (painted doors and shutters seen as big flat areas) is moved from the walls to the accents, and so is a lit cluster of chroma 22 or more whose hue is outside the brick-to-ochre range 20 to 110 and that is not brick (red and pink roofs seen below the roof band, blue and green paint)
  accent: { fromWall: { minChroma: 52, maxE1: 2.6, hueFreeMinChroma: 22, hueFree: [20, 110], hueFreeMaxE1: 3.4 }, ring: 7, gap: 2, minChroma: 22, minDeltaE: 16, minShare: 0.004, k: 4, maxCount: 4 },
  // roofs: the strip under the sky edge; copper (green-blue), slate (dark grey), metal (mid grey, blue-grey) when smooth
  roof: { maxE1: 2.2, minShare: 0.05, copper: { hue: [120, 230], minChroma: 5 }, slate: { maxL: 42, maxChroma: 12 }, metal: { minL: 42, maxL: 80, maxChroma: 13 }, k: 3 },
};

const chromaOf = (a, b) => Math.hypot(a, b);

/** The decision rules for one cluster. `c` = { L, a, b } (de-lit median), `t` = { e1, e4, cv }. Returns the material word. */
export function materialOf(c, t, R = RULES.material) {
  const C = chromaOf(c.a, c.b), h = hueDeg(c.a, c.b);
  if (t.e1 < R.render.maxE1) return 'render';
  const pw = R.painted_white;
  if ((c.L >= pw.minL && C <= pw.maxChroma) || (c.L >= pw.shadeL && C <= pw.shadeChroma && t.e1 < pw.shadeMaxE1)) return 'painted_white';
  const br = R.brick;
  if (h >= br.hue[0] && h <= br.hue[1] && C >= br.minChroma && c.L >= br.minL && c.L <= br.maxL && t.e1 >= br.minE1 && (t.cv == null || t.cv <= br.maxCv)) return 'brick';
  const st = R.stone;
  if (C <= st.maxChroma && c.L >= st.minL && c.L <= st.maxL && t.e1 >= st.minE1) return 'stone';
  if (t.e1 < R.render.smoothE1 && c.L >= R.render.smoothMinL) return 'render';
  return 'unknown';
}

/** Texture statistics of every cluster id: ids is an Int16Array (-1 = none), lum the L* field. -> [{ e1, e4, cv, n }] */
export function textureStats(lum, ids, w, h, k) {
  const BS = 24, nbx = Math.ceil(w / BS), nby = Math.ceil(h / BS);
  const s1 = new Float64Array(k), n1 = new Float64Array(k), s4 = new Float64Array(k), n4 = new Float64Array(k), cnt = new Float64Array(k);
  const bs = new Float64Array(k * nbx * nby), bn = new Float64Array(k * nbx * nby);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = ids[i]; if (c < 0) continue;
    cnt[c]++;
    const add = (j, lag) => { const d = Math.abs(lum[j] - lum[i]); if (lag === 1) { s1[c] += d; n1[c]++; const bi = (c * nby + (y / BS | 0)) * nbx + (x / BS | 0); bs[bi] += d; bn[bi]++; } else { s4[c] += d; n4[c]++; } };
    if (x + 1 < w && ids[i + 1] === c) add(i + 1, 1);
    if (y + 1 < h && ids[i + w] === c) add(i + w, 1);
    if (x + 4 < w && ids[i + 4] === c) add(i + 4, 4);
    if (y + 4 < h && ids[i + 4 * w] === c) add(i + 4 * w, 4);
  }
  const out = [];
  for (let c = 0; c < k; c++) {
    const e = [];
    for (let b = 0; b < nbx * nby; b++) { const j = c * nbx * nby + b; if (bn[j] >= 60) e.push(bs[j] / bn[j]); }
    let cv = null;
    if (e.length >= 3) { const m = e.reduce((s, v) => s + v, 0) / e.length; cv = m > 1e-6 ? Math.sqrt(e.reduce((s, v) => s + (v - m) ** 2, 0) / e.length) / m : 0; }
    out.push({ e1: n1[c] ? s1[c] / n1[c] : 0, e4: n4[c] ? s4[c] / n4[c] : 0, cv, n: cnt[c] });
  }
  return out;
}

/** Hex of a Lab colour. */
export const hexOf = (c) => labToHex(c.L, c.a, c.b);
export const deltaE = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
export const chroma = (c) => chromaOf(c.a, c.b);

/** Is this pixel (L*, a*, b*) vegetation, or sky-in-glass? */
export const isVegetation = (L, a, b, R = RULES.vegetation) => a <= R.aMax && b >= R.bMin;
export const isGlass = (L, a, b, R = RULES.glass) => b <= R.bMax && L >= R.LMin && a <= R.aMax;

/** Roof word of a smooth cluster in the roof band, or null. copper | slate | metal. */
export function roofOf(c, t, R = RULES.roof) {
  if (t.e1 > R.maxE1) return null;
  const C = chromaOf(c.a, c.b), h = hueDeg(c.a, c.b);
  if (C >= R.copper.minChroma && h >= R.copper.hue[0] && h <= R.copper.hue[1]) return 'copper';
  if (C <= R.slate.maxChroma && c.L <= R.slate.maxL) return 'slate';
  if (C <= R.metal.maxChroma && c.L >= R.metal.minL && c.L <= R.metal.maxL) return 'metal';
  return null;
}

/** Shade gain of a set of wall L* values: the factor by which the shaded part's (L*, a*, b*) are multiplied. */
export function shadeGain(meanDark, meanLit) {
  if (!(meanDark > 1) || !(meanLit > meanDark)) return 1;
  return Math.min(RULES.shade.maxGain, meanLit / meanDark);
}
