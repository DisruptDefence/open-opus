// What is compared: the metric catalogue, flattening of one image's numbers, the weighted-median reference over a
// view's photographs, gaps and their plain sentences. Pure.
import { weightedMedian, median, mad, emd, kmeans3w } from './stats.mjs';
import { hueDeg, labToHex } from './color.mjs';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? null : a[k]), o);
const r2 = (v) => (Number.isFinite(v) ? +v.toFixed(3) : null);

const reg = (region, name) => [
  { key: `${region}.L`, label: `${name} L*`, path: `regions.${region}.L`, matters: 4, unit: 'L*' },
  { key: `${region}.a`, label: `${name} a*`, path: `regions.${region}.a`, matters: 2, unit: 'a*' },
  { key: `${region}.b`, label: `${name} b*`, path: `regions.${region}.b`, matters: 2, unit: 'b*' },
  { key: `${region}.chroma`, label: `${name} chroma`, path: `regions.${region}.chroma`, matters: 4, unit: 'chroma' },
  { key: `${region}.p10`, label: `${name} L* p10`, path: `regions.${region}.p10`, matters: 5, unit: 'L*' },
  { key: `${region}.p90`, label: `${name} L* p90`, path: `regions.${region}.p90`, matters: 5, unit: 'L*' },
];
const shade = (part, name) => ['dark', 'lit'].flatMap((k) => [
  { key: `${part}.${k}.L`, label: `${name} ${k} part L*`, path: `shade.${part}.${k}.L`, matters: 4, unit: 'L*' },
  { key: `${part}.${k}.a`, label: `${name} ${k} part a*`, path: `shade.${part}.${k}.a`, matters: 2, unit: 'a*' },
  { key: `${part}.${k}.b`, label: `${name} ${k} part b*`, path: `shade.${part}.${k}.b`, matters: 2, unit: 'b*' },
]);
export const METRICS = [
  { key: 'share.sky', label: 'sky share', path: 'shares.sky', matters: 0.1, unit: 'share' },
  { key: 'share.ground', label: 'ground share', path: 'shares.ground', matters: 0.1, unit: 'share' },
  { key: 'share.walls', label: 'walls share', path: 'shares.walls', matters: 0.1, unit: 'share' },
  ...reg('sky', 'sky'), ...reg('ground', 'ground'), ...reg('walls', 'walls'),
  { key: 'contrast', label: 'contrast (L* p90 - p10)', path: 'contrast', matters: 6, unit: 'L*' },
  ...shade('surfaces', 'shade/sun (walls+ground):'),
  { key: 'surfaces.ratio', label: 'shadow/lit ratio (walls+ground)', path: 'shade.surfaces.ratio', matters: 0.08, unit: 'ratio' },
  { key: 'walls.ratio', label: 'shadow/lit ratio (walls)', path: 'shade.walls.ratio', matters: 0.08, unit: 'ratio' },
  { key: 'ground.ratio', label: 'shadow/lit ratio (ground)', path: 'shade.ground.ratio', matters: 0.08, unit: 'ratio' },
  { key: 'busy.gradient', label: 'wall busyness (gradient)', path: 'busyness.gradient', matters: 1.5, unit: 'gradient' },
  { key: 'busy.openings', label: 'dark openings share of walls', path: 'busyness.darkOpenings', matters: 0.05, unit: 'share' },
  { key: 'colour.stdA', label: 'wall colour spread a*', path: 'colourfulness.stdA', matters: 2, unit: 'a*' },
  { key: 'colour.stdB', label: 'wall colour spread b*', path: 'colourfulness.stdB', matters: 2, unit: 'b*' },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

// GROUPS. Every measure is in exactly one:
//   light      what the scene's light settings can move: lightness (L*, p10, p90) of any region, contrast, the shade/sun ratios,
//              the lightness of the dark and lit parts, and the sky's colour (a*, b*, chroma);
//   material   what the style work moves (wall and ground materials, colours, detail): a*, b* and chroma of walls and ground,
//              busyness, colour spread (and the dominant wall colours, compared as `materialMismatch`);
//   info       the shade and sunlit colour (a*, b* of the dark and lit parts): reported as information, never a rule;
//   framing    the shares of sky, ground and walls: where the camera points, not a fault.
export function groupOf(key) {
  if (key.startsWith('share.')) return 'framing';
  if (/^surfaces\.(dark|lit)\.[ab]$/.test(key)) return 'info';
  if (/^(walls|ground)\.(a|b|chroma)$/.test(key) || key.startsWith('busy.') || key.startsWith('colour.')) return 'material';
  return 'light';
}
for (const m of METRICS) m.group = groupOf(m.key);
/** The light measures the proposal rules act on, and which look key targets which. */
export const TARGETS = { exposure: ['walls.L', 'ground.L'], saturation: ['walls.chroma'], skySat: ['sky.chroma'], skyTint: ['sky.a', 'sky.b'], env: ['surfaces.ratio'], bounce: ['surfaces.ratio'], curve: ['contrast'] };
export const LIGHT_ACTED = ['walls.L', 'ground.L', 'sky.chroma', 'sky.a', 'sky.b', 'surfaces.ratio', 'contrast'];
/** Wall-colour-based measures: a view whose material mismatch is above the threshold is ignored for them by every rule. */
export const WALL_COLOUR = new Set(['walls.a', 'walls.b', 'walls.chroma']);
export const MATERIAL_THRESHOLD = 10, MATERIAL_MATTERS = 6;

/** One image's numbers as { metric key: value }. */
export function flat(numbers) { const o = {}; for (const m of METRICS) o[m.key] = numbers ? r2(get(numbers, m.path)) : null; return o; }

export function photoWeight(entry) { if (entry.excluded) return 0; return entry.numbers && entry.numbers.framing === 'poor framing' ? 0.5 : 1; }

/** Weight of a photograph in a reference: 0 when left out, 0.5 for poor framing, halved again when it was set aside for framing unlike the render's (`match === false`). */
export function photoWeight2(entry, onlyMatched) { const w = photoWeight(entry); return w > 0 && onlyMatched && entry.match === false ? 0 : w > 0 && entry.match === false ? w * 0.5 : w; }
/**
 * Does a photograph frame the view like the render? Its sky share and its ground share are each within a factor of 2 of the render's
 * (shares under 3 % count as 3 %, so a nearly empty region does not make every ratio huge). null when the render has no numbers.
 */
export function framingMatch(photoNumbers, renderNumbers, factor = 2, floor = 0.03) {
  if (!photoNumbers || !renderNumbers) return null;
  const ok = (a, b) => { const x = Math.max(a, floor), y = Math.max(b, floor); return x / y <= factor && y / x <= factor; };
  return ok(photoNumbers.shares.sky, renderNumbers.shares.sky) && ok(photoNumbers.shares.ground, renderNumbers.shares.ground);
}
/** The photographs a reference is made of, with weights: when at least 2 frame the view like the render only those, else all usable ones (the framing-matched at full weight, the others at half). */
export function referenceItems(photoEntries) {
  const usableE = photoEntries.filter((e) => photoWeight(e) > 0), matched = usableE.filter((e) => e.match === true), only = matched.length >= 2;
  return usableE.map((e) => ({ e, f: flat(e.numbers), w: photoWeight2(e, only) })).filter((i) => i.w > 0);
}
/** Reference of a view: weighted median of each metric over the photographs `referenceItems` chooses. */
export function referenceOf(photoEntries) {
  const items = referenceItems(photoEntries);
  if (!items.length) return null;
  const o = {}; for (const m of METRICS) o[m.key] = r2(weightedMedian(items.map((i) => ({ v: i.f[m.key], w: i.w }))));
  return { photos: items.length, weight: items.reduce((s, i) => s + i.w, 0), ids: items.map((i) => i.e.id), values: o };
}

/**
 * Noise floor of each measure: how much photographs of the SAME view differ from each other. For every view with at least 2
 * photographs in its reference, the median absolute deviation (about the median) of the measure over those photographs; then the
 * median of that over views. A gap smaller than this cannot be told from choosing other photographs.
 */
export function noiseFloors(views) {
  const per = {}; for (const m of METRICS) per[m.key] = [];
  for (const v of views) {
    const items = referenceItems(v.photos || []); if (items.length < 2) continue;
    for (const m of METRICS) { const d = mad(items.map((i) => i.f[m.key])); if (Number.isFinite(d)) per[m.key].push(d); }
  }
  const out = {}; for (const m of METRICS) { const x = median(per[m.key]); out[m.key] = Number.isFinite(x) ? r2(x) : null; }
  return out;
}

const dom = (numbers) => (numbers && numbers.colourfulness ? numbers.colourfulness.dominant : []);
/**
 * Material mismatch of one view: the earth mover's distance, in (a*, b*) units only (lightness left out), between the dominant wall
 * colours of the photographs (pooled over the reference's photographs, each colour weighted by its share times the photograph's weight)
 * and the render's. 0 = same hues and chromas of wall, large = different walls. null without both.
 */
export function materialMismatch(photoEntries, renderNumbers) {
  const items = referenceItems(photoEntries), rd = dom(renderNumbers); if (!items.length || !rd.length) return null;
  const pooled = items.flatMap((i) => dom(i.e.numbers).map((c) => ({ ...c, w: c.share * i.w }))); if (!pooled.length) return null;
  const d = emd(pooled, rd.map((c) => ({ ...c, w: c.share })), (p, q) => Math.hypot(p.a - q.a, p.b - q.b));
  const merged = kmeans3w(pooled.map((c) => ({ p: [c.L, c.a, c.b], w: c.w })), 5).map((c) => ({ L: r2(c.centre[0]), a: r2(c.centre[1]), b: r2(c.centre[2]), hex: labToHex(...c.centre), share: r2(c.share) }));
  return { mismatch: r2(d), reference: merged, render: rd.map((c) => ({ L: c.L, a: c.a, b: c.b, hex: c.hex, share: c.share })) };
}
const cm = (cs) => { const t = cs.reduce((s, c) => s + c.share, 0) || 1; let a = 0, b = 0, ch = 0; for (const c of cs) { a += c.a * c.share / t; b += c.b * c.share / t; ch += Math.hypot(c.a, c.b) * c.share / t; } return { a, b, chroma: ch }; };
/** A sentence a person can act on: which way the photographs' walls differ from the render's, with both sets of colours and shares. */
export function materialSentence(viewId, mat) {
  const R = cm(mat.reference), D = cm(mat.render), pct = (cs) => cs.map((c) => `${c.hex} (${Math.round(c.share * 100)} %)`).join(', ');
  const parts = []; const da = R.a - D.a, db = R.b - D.b, dc = R.chroma - D.chroma;
  if (Math.abs(da) >= 2) parts.push(da > 0 ? 'redder' : 'greener'); if (Math.abs(db) >= 2) parts.push(db > 0 ? 'yellower' : 'bluer');
  if (Math.abs(dc) >= 2) parts.push(dc > 0 ? 'more saturated' : 'greyer');
  const how = parts.length ? parts.join(' and ') : 'a different mix of colours (similar mean hue)';
  return `Walls in the photographs of view ${viewId} are ${how}: dominant colours ${pct(mat.reference)}; the render's: ${pct(mat.render)} (mismatch ${mat.mismatch.toFixed(1)}).`;
}

/** gap = render - reference, for every metric both have. */
export function gapsOf(reference, render) {
  const out = [];
  if (!reference || !render) return out;
  for (const m of METRICS) {
    const rf = reference[m.key], rd = render[m.key];
    if (Number.isFinite(rf) && Number.isFinite(rd)) out.push({ key: m.key, label: m.label, reference: rf, render: rd, gap: r2(rd - rf), size: Math.abs(rd - rf) / m.matters, matters: Math.abs(rd - rf) >= m.matters });
  }
  return out;
}

const f1 = (v) => Math.abs(v).toFixed(1), f2 = (v) => Math.abs(v).toFixed(2);
const WHERE = { walls: 'walls', ground: 'ground', sky: 'sky', surfaces: 'surfaces (walls and ground)' };
const BE = (part) => (part === 'walls' || part === 'surfaces' ? 'are' : 'is');
/** A plain sentence for one gap (render minus reference). */
export function sentence(g, view) {
  const [part, what] = g.key.split('.'), d = g.gap, in_ = view ? ` (${view})` : '';
  const dir = (pos, neg) => (d > 0 ? pos : neg);
  let t;
  if (['sky', 'ground', 'walls'].includes(part) && ['L', 'p10', 'p90'].includes(what)) {
    const X = WHERE[part], subj = what === 'L' ? `The ${X} ${BE(part)}` : what === 'p10' ? `The darkest tenth of the ${X} is` : `The brightest tenth of the ${X} is`;
    t = `${subj} ${f1(d)} L* ${dir('lighter', 'darker')} than in the photographs`;
  } else if (['sky', 'ground', 'walls'].includes(part) && what === 'a') t = `The ${WHERE[part]} ${BE(part)} ${dir('redder', 'greener')} than in the photographs by ${f1(d)} a*`;
  else if (['sky', 'ground', 'walls'].includes(part) && what === 'b') t = `The ${WHERE[part]} ${BE(part)} ${dir('yellower', 'bluer')} than in the photographs by ${f1(d)} b*`;
  else if (what === 'chroma') t = `The ${WHERE[part]} ${BE(part)} ${f1(d)} chroma ${dir('more colourful', 'greyer')} than in the photographs`;
  else if (part === 'contrast') t = `The picture has ${f1(d)} L* ${dir('more', 'less')} contrast than the photographs`;
  else if (g.key.endsWith('.ratio')) t = `Shade on ${WHERE[part] || part} is ${f2(d)} of the lit level ${dir('too light', 'too dark')} (shadow/lit ratio ${g.render.toFixed(2)} against ${g.reference.toFixed(2)})`;
  else if (['dark', 'lit'].includes(what) || ['dark', 'lit'].includes(g.key.split('.')[1])) {
    const k = g.key.split('.'), side = k[1] === 'dark' ? 'Shade' : 'Sunlit surfaces', q = k[2];
    t = q === 'L' ? `${side} ${k[1] === 'dark' ? 'is' : 'are'} ${f1(d)} L* ${dir('lighter', 'darker')} than in the photographs`
      : q === 'b' ? `${side} ${k[1] === 'dark' ? 'is' : 'are'} ${dir('yellower', 'bluer')} than in the photographs by ${f1(d)} b*` : `${side} ${k[1] === 'dark' ? 'is' : 'are'} ${dir('redder', 'greener')} than in the photographs by ${f1(d)} a*`;
  } else if (g.key === 'busy.gradient') t = `The walls have ${dir('more', 'less')} fine detail than the photographs (gradient ${g.render.toFixed(1)} against ${g.reference.toFixed(1)})`;
  else if (g.key === 'busy.openings') t = `The walls have ${dir('more', 'fewer')} dark openings than the photographs (${(g.render * 100).toFixed(0)} % against ${(g.reference * 100).toFixed(0)} %)`;
  else if (part === 'colour') t = `The walls' colours vary ${dir('more', 'less')} than in the photographs (${what} spread ${g.render.toFixed(1)} against ${g.reference.toFixed(1)})`;
  else if (part === 'share') t = `The ${what} fills ${(Math.abs(d) * 100).toFixed(0)} % ${dir('more', 'less')} of the frame than in the photographs`;
  else t = `${g.label}: ${d > 0 ? '+' : '-'}${f1(d)}`;
  return t + in_ + '.';
}
