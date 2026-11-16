// The texture catalogue and the style pack's detail mapping. Pure code: no three.js, no DOM, tested under Node.
//
// assets/textures/catalogue.json names every image set (a folder of colour, normal, roughness, AO and height maps, all
// CC0) with its surface kind, its real-world size in metres and tags. A style pack says which set lays over which
// material of the library (`client.detail`), so another place picks other sets and no code changes:
//
//   "detail": {
//     "catalogue": "assets/textures/catalogue.json",        // optional; default is the one beside the engine
//     "default":   { "strength": 0.85, "normal": 1, "rough": 1, "ao": 0.8, "hue": 0.1, "base": 0.3, "far": 60 },
//     "materials": {
//       "stone": { "set": ["bricks076a", "medieval_blocks_05"], "scale": 1, "strength": 0.9, "hue": 0.15 },
//       "cobble": { "set": ["cobblestone_floor_04"], "scale": 1 }
//     }
//   }
//
// `set` is a list of fallbacks: the first one the catalogue knows wins. `scale` multiplies the catalogue's tile size.
// `strength` mixes the image over the procedural surface (0 = nothing), `normal` scales the image's relief, `rough` and
// `ao` mix its roughness and occlusion in, `hue` keeps that much of the image's own colour (0 = the style palette's tint
// alone, the default), `base` is the brightness the tint is multiplied by, `tint` [r, g, b] a linear colour multiplier on top (warm a cold set: [1.15, 1, 0.8]), `far` the distance in metres where it fades out.

export const DEFAULT_DETAIL = { strength: 0.85, normal: 1, rough: 1, ao: 0.8, hue: 0.1, base: 0.3, far: 60, scale: 1 };

/** Quality tier -> what the image layer may use: biggest image side in pixels (0 = off) and how far it reaches (m). */
export const DETAIL_TIERS = {
  test: { maxRes: 0, far: 0 }, low: { maxRes: 0, far: 0 },
  medium: { maxRes: 512, far: 35 }, high: { maxRes: 1024, far: 60 }, ultra: { maxRes: 2048, far: 90 },
};
export function detailBudget(quality) {
  const name = quality && quality.name, t = DETAIL_TIERS[name] || DETAIL_TIERS.medium;
  return { ...t, name: name || 'medium' };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** A catalogue file read into a lookup. Entries that cannot be used (no colour map, no size) are dropped, never thrown. */
export function parseCatalogue(json) {
  const sets = new Map(), problems = [];
  const raw = json && typeof json === 'object' && json.sets && typeof json.sets === 'object' ? json.sets : {};
  for (const [name, e] of Object.entries(raw)) {
    if (!e || typeof e !== 'object') { problems.push(`${name}: not an object`); continue; }
    const maps = Array.isArray(e.maps) ? e.maps.filter((m) => typeof m === 'string') : [];
    if (!maps.includes('color')) { problems.push(`${name}: no colour map`); continue; }
    const tile = Array.isArray(e.tile) ? e.tile : [e.tile, e.tile];
    if (!(isNum(tile[0]) && tile[0] > 0 && isNum(tile[1]) && tile[1] > 0)) { problems.push(`${name}: bad tile size`); continue; }
    const avg = Array.isArray(e.avg) && e.avg.length === 3 && e.avg.every(isNum) ? e.avg : [0.3, 0.3, 0.3];
    sets.set(name, { name, kind: String(e.kind || 'generic'), tile: [tile[0], tile[1]], tags: Array.isArray(e.tags) ? e.tags : [], res: isNum(e.res) ? e.res : 1024,
      maps, ext: typeof e.ext === 'string' ? e.ext : 'webp', avg, bytes: isNum(e.bytes) ? e.bytes : 0 });
  }
  const byKind = new Map();
  for (const s of sets.values()) { if (!byKind.has(s.kind)) byKind.set(s.kind, []); byKind.get(s.kind).push(s.name); }
  return { base: typeof json?.base === 'string' ? json.base : 'pbr/', sets, byKind, problems };
}

/** The files of a set, by map name, as paths under `root` (a URL or directory ending in a slash). */
export function setFiles(catalogue, entry, root = '') {
  const out = {};
  for (const m of entry.maps) out[m] = `${root}${catalogue.base}${entry.name}/${m}.${entry.ext}`;
  return out;
}

/** The image side to decode: the set's own size halved until it fits `maxRes`, never below 128. 0 = do not load. */
export function pickRes(setRes, maxRes) {
  if (!(maxRes > 0)) return 0;
  let r = setRes > 0 ? setRes : 1024;
  while (r > maxRes && r > 128) r = Math.round(r / 2);
  return r;
}

/**
 * The style pack's detail block against a catalogue: material name -> the numbers the shader needs, or nothing for a
 * material whose sets are all unknown (it stays procedural). `cat` is a parsed catalogue.
 */
export function resolveDetail(detail, cat) {
  const out = new Map(), problems = [];
  if (!detail || typeof detail !== 'object' || !detail.materials) return { materials: out, problems };
  const def = { ...DEFAULT_DETAIL, ...(detail.default || {}) };
  for (const [mat, spec0] of Object.entries(detail.materials)) {
    const spec = { ...def, ...(spec0 || {}) };
    const names = Array.isArray(spec.set) ? spec.set : spec.set ? [spec.set] : [];
    const entries = names.map((n) => cat.sets.get(n)).filter(Boolean);
    if (!entries.length) { problems.push(`${mat}: none of ${JSON.stringify(names)} is in the catalogue`); continue; }
    for (const n of names) if (!cat.sets.has(n)) problems.push(`${mat}: set "${n}" is not in the catalogue`);
    const num = (k) => (isNum(spec[k]) ? spec[k] : def[k]);
    out.set(mat, { alt: resolveAlt(spec.alt, cat, problems, mat), material: mat, entries, strength: clamp01(num('strength')), normal: Math.max(0, num('normal')), rough: clamp01(num('rough')), ao: clamp01(num('ao')),
      hue: clamp01(num('hue')), base: Math.max(0.01, num('base')), tint: tintOf(spec.tint), far: Math.max(1, num('far')), scale: Math.max(0.05, num('scale')) });
  }
  return { materials: out, problems };
}
/** A colour multiplier [r, g, b] (linear, 0 to 4 each) that warms or cools a set; anything else is no change. */
export function tintOf(t) { return Array.isArray(t) && t.length === 3 && t.every(isNum) ? t.map((v) => Math.min(4, Math.max(0, v))) : [1, 1, 1]; }
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * A second set that patches the first (asphalt repairs, worn and dry grass, a different slab) where a slow world-space
 * noise is high: `alt: { set: [...], scale: 1, cover: 0.3, edge: 0.04, size: 6, tone: 1, hue: 0.5 }`. `cover` is the
 * share of the ground it takes (0 to 1), `edge` how soft its border is (0 = a hard seam), `size` the metres of one noise
 * cell, `tone` its brightness relative to the main set. null when the entry is absent or none of its sets is known.
 */
export function resolveAlt(a, cat, problems, mat) {
  if (!a || typeof a !== 'object') return null;
  const names = Array.isArray(a.set) ? a.set : a.set ? [a.set] : [];
  const entries = names.map((n) => cat.sets.get(n)).filter(Boolean);
  if (!entries.length) { problems.push(`${mat}.alt: none of ${JSON.stringify(names)} is in the catalogue`); return null; }
  const num = (v, d) => (isNum(v) ? v : d), cover = clamp01(num(a.cover, 0.3));
  return { entries, scale: Math.max(0.05, num(a.scale, 1)), cover, threshold: altThreshold(cover), edge: Math.min(0.3, Math.max(0, num(a.edge, 0.04))),
    size: Math.max(0.5, num(a.size, 6)), tone: Math.max(0.05, num(a.tone, 1)), hue: clamp01(num(a.hue, 0.5)) };
}
/** The noise value above which the patch set shows, for a wanted share of the ground (the noise is a 2-octave value noise, mean 0.5, spread about 0.13). */
export function altThreshold(cover) { return 0.5 + (0.5 - clamp01(cover)) * 0.42; }

/** The tile size in metres a resolved material lays its set at: the catalogue's size times the pack's `scale`. */
export function tileMetres(spec, entry) { return [entry.tile[0] * spec.scale, entry.tile[1] * spec.scale]; }

/** Pack three grey maps (equal length, 1 byte per pixel; null = flat 255) into RGBA bytes: R = AO, G = roughness, B = height. */
export function packOrm(ao, rough, height, n) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = ao ? ao[i] : 255; out[i * 4 + 1] = rough ? rough[i] : 255; out[i * 4 + 2] = height ? height[i] : 128; out[i * 4 + 3] = 255; }
  return out;
}
