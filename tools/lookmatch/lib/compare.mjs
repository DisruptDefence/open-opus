// What is compared: the metric catalogue, flattening of one image's numbers, the weighted-median reference over a
// view's photographs, gaps and their plain sentences. Pure.
import { weightedMedian } from './stats.mjs';

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

/** One image's numbers as { metric key: value }. */
export function flat(numbers) { const o = {}; for (const m of METRICS) o[m.key] = numbers ? r2(get(numbers, m.path)) : null; return o; }

export function photoWeight(entry) { if (entry.excluded) return 0; return entry.numbers && entry.numbers.framing === 'poor framing' ? 0.5 : 1; }

/** Reference of a view: weighted median of each metric over its photographs. */
export function referenceOf(photoEntries) {
  const items = photoEntries.map((e) => ({ f: flat(e.numbers), w: photoWeight(e) })).filter((i) => i.w > 0);
  if (!items.length) return null;
  const o = {}; for (const m of METRICS) o[m.key] = r2(weightedMedian(items.map((i) => ({ v: i.f[m.key], w: i.w }))));
  return { photos: items.length, weight: items.reduce((s, i) => s + i.w, 0), values: o };
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
