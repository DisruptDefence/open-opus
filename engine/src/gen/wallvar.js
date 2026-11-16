// Wall variation: how one building, one bay and one storey differ from the next without a texture per building.
// Pure code. The wall shader (materials/facades.js) repeats the same arithmetic on the GPU; the two must agree, so the
// hash and the picking rules live here once, are tested here, and the shader is written against them.
//
//   hash        pcg(v), hash2(a, b), unit(h): a 32-bit integer hash and its 0..1 value (24 bits: exact in a float)
//   building id the building's wall tint, 8 bits a channel, IS its id: the mesher already writes the tint into every
//               vertex of the building, so the shader gets the id with no new vertex data and no per-building material.
//               jitterTint() makes the tints of one palette entry differ a little from building to building (the
//               hue, tone and so the id), in whole steps of 1/255 so the shader reads it back exactly.
//   windows     the style pack's `bayWindows` table (types, weights per storey class, states) compiled to the flat
//               arrays the shader reads as uniforms, and pickWindow(), the same pick in JS.
//
// What a building's id decides in the shader: its course height and block length, its stone or brick family, mortar
// colour, grime, and which window types it uses on each storey; what a (building, bay, storey) decides: the window of
// that bay, its curtain, blind or light, its shutters, now and then an odd one out.

/** A 32-bit integer hash (PCG), as in the shader. */
export function pcg(v) {
  const s = (Math.imul(v | 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
/** Two integers to one hash. */
export const hash2 = (a, b) => pcg(((a >>> 0) + pcg(b)) >>> 0);
/** A hash as a number in [0, 1): 24 bits, so a float holds it exactly. */
export const unit = (h) => (h >>> 8) / 16777216;
/** Three small integers (a building id, a bay, a storey) to one hash. */
export const hash3 = (a, b, c) => hash2(hash2(a, b), c);

/** A building's id from its tint (linear [r, g, b], exact multiples of 1/255 once jitterTint has seen it). */
export function buildingId(tint) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (q(tint[0]) | (q(tint[1]) << 8) | (q(tint[2]) << 16)) >>> 0;
}

/**
 * A palette colour made a little different for each building: brightness within about +-7%, each channel a further
 * +-3.5%, in whole steps of 1/255 (so buildingId() reads it back). `key` is the building's own number. The same key
 * and tint always give the same colour.
 */
export function jitterTint(tint, key) {
  const base = hash2(key | 0, 0x7a11);
  const g = unit(base) * 2 - 1;
  return tint.map((c, i) => {
    const k = Math.max(1, Math.min(255, Math.round(c * 255 * (1 + 0.07 * g + 0.035 * (unit(hash2(base, i + 1)) * 2 - 1)))));
    return k / 255;
  });
}

// ---- the window table ------------------------------------------------------------------------------------------------
export const MAX_TYPES = 16, CLASSES = ['ground', 'first', 'upper'], STATES = ['clear', 'curtain', 'blind', 'lit', 'dark', 'bright'];
export const SHAPES = ['rect', 'segmental', 'round', 'circle', 'blind', 'shop'], HOODS = ['none', 'gable', 'arc', 'cornice'];
const indexOf = (list, name, fallback = 0) => { const i = list.indexOf(name); return i < 0 ? fallback : i; };

/**
 * One window type of the style pack as the four numbers the shader reads:
 *   [shape, width, height, sill]            metres; sill = height of the opening's foot above the floor
 *   [columns, rows, rail, muntin]           panes across and up, a meeting rail (0/1), muntin width in metres
 *   [surround, lintel, sill projection, hood] dressing round the opening (m), a lintel band (0/1), a projecting sill (0/1), a hood (HOODS)
 *   [shutters, 0, 0, 0]                     chance that the window has shutters (they are open or closed by the bay's hash)
 */
export function windowType(t) {
  const grid = Array.isArray(t.grid) ? t.grid : [2, 2];
  const shape = indexOf(SHAPES, t.shape), w = +t.w || 1, h = shape === 3 ? w : +t.h || 1.6;
  return [shape, w, h, +t.sill >= 0 ? +t.sill : 0.85, grid[0] | 0 || 1, grid[1] | 0 || 1, t.rail ? 1 : 0, +t.muntin || 0.022,
    t.surround >= 0 ? +t.surround : 0.1, t.lintel ? 1 : 0, t.sillProj === false ? 0 : 1, indexOf(HOODS, t.hood), Math.min(1, Math.max(0, +t.shutters || 0)), 0, 0, 0];
}

/** Weights to a cumulative distribution over the type list (last entry 1); all zero gives the first type. */
function cdfOf(weights, names) {
  const w = names.map((n) => Math.max(0, +(weights && weights[n]) || 0)), sum = w.reduce((a, b) => a + b, 0);
  const out = new Array(MAX_TYPES).fill(1);
  if (!sum) { out.fill(1); return out; }
  let acc = 0;
  for (let i = 0; i < names.length; i++) { acc += w[i] / sum; out[i] = i === names.length - 1 ? 1 : acc; }
  return out;
}

/**
 * The table of the style pack (`bayWindows`) compiled for the shader.
 *   { types: Float32Array(MAX_TYPES * 16), cdf: Float32Array(3 * MAX_TYPES), states: Float32Array(6), odd, names }
 * Types beyond MAX_TYPES are ignored; a class the table lacks borrows the one before it.
 */
export function compileWindows(table) {
  const types = (table && table.types) || {}, names = Object.keys(types).slice(0, MAX_TYPES);
  const arr = new Float32Array(MAX_TYPES * 16);
  names.forEach((n, i) => arr.set(windowType(types[n]), i * 16));
  const cdf = new Float32Array(CLASSES.length * MAX_TYPES);
  let prev = null;
  CLASSES.forEach((c, k) => {
    const cls = (table && table.classes && table.classes[c]) || prev;
    prev = cls; cdf.set(cdfOf(cls, names), k * MAX_TYPES);
  });
  const sw = (table && table.states) || {}, states = new Float32Array(STATES.length);
  { const w = STATES.map((s) => Math.max(0, +sw[s] || 0)), sum = w.reduce((a, b) => a + b, 0) || 1; let acc = 0; w.forEach((x, i) => { acc += x / sum; states[i] = i === STATES.length - 1 ? 1 : acc; }); }
  return { types: arr, cdf, states, odd: Math.min(1, Math.max(0, table && table.odd != null ? +table.odd : 0.12)), names };
}

/** The type index for a storey class (0 ground, 1 first, 2 upper) and a unit number u: the first type whose cumulative weight exceeds u. */
export function pickWindow(compiled, cls, u) {
  const o = Math.max(0, Math.min(CLASSES.length - 1, cls | 0)) * MAX_TYPES;
  for (let i = 0; i < MAX_TYPES; i++) if (u < compiled.cdf[o + i]) return i;
  return 0;
}
/** The storey class of storey `s` (counted from the ground, 0). */
export const storeyClass = (s) => (s <= 0 ? 0 : s === 1 ? 1 : 2);

/** The window type of bay `bay` on storey `storey` of building `id`: mostly one type for a storey, now and then another. */
export function windowOf(compiled, id, bay, storey) {
  const cls = storeyClass(storey), hs = hash3(id, storey, 77), hb = hash3(id, bay, storey * 131 + 5);
  const odd = unit(hash2(hs, bay + 3)) < compiled.odd;
  return pickWindow(compiled, cls, odd ? unit(hash2(hb, 78)) : unit(hash2(hs, 79)));
}
/** The state of a bay's window (index into STATES): drawn from the table's weights by the bay's hash. */
export function stateOf(compiled, id, bay, storey) {
  const u = unit(hash2(hash3(id, bay, storey * 131 + 5), 80));
  for (let i = 0; i < STATES.length; i++) if (u < compiled.states[i]) return i;
  return 0;
}

/** A list of colours ("#rrggbb") as linear [r, g, b] rows for a shader palette, n rows (the list repeats to fill them). */
export function paletteRows(list, parse, n, fallback = [0.8, 0.8, 0.8]) {
  const src = (list || []).map((c) => parse(c)).filter(Boolean), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set(src.length ? src[i % src.length] : fallback, i * 3);
  return { rows: out, count: src.length || 1 };
}
