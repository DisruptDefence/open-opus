// Proposed changes to `ambience.look` from the gaps. A rule acts on a look key ONLY WHERE THE EVIDENCE AGREES:
//   (i)  at least 60 % of the views that have a reference and a render agree on the SIGN of that measure's gap (reference - render,
//        one gap per view, so a median of values from different places can never have the opposite sign to the median of gaps), and
//   (ii) the median of those gaps is larger than the measure's NOISE FLOOR (the spread between photographs of the same view:
//        the median absolute deviation across a view's photographs, medianed over views; `noiseFloors` in compare.mjs).
// Otherwise the key is left as it is and the proposal says "views disagree" or "within noise".
// A view whose MATERIAL MISMATCH (the dominant wall colours differ: compare.mjs) is above MATERIAL_THRESHOLD is ignored by every rule
// for wall-colour quantities (the saturation rule, and the wall half of the exposure rule): a street of houses that are simply a
// different colour must not be chased by the light.
// Steps (damping = the part of the measured gap applied in one round; clamps keep one round small):
//   exposure   x Y(L+dL)/Y(L): dL = 0.4 x median gap of mean L* of walls and ground (reference - render); Y is the CIE L*-to-luminance curve; x0.8..1.25.
//   saturation x (1 + 0.6 (r - 1)), r = median over views of reference / render mean chroma of walls; clamped 0.85..1.2.
//   skySat     x (1 + 0.5 (r - 1)) on the sky's mean chroma, clamped 0.7..1.4.
//   skyTint    RGB multipliers (luminance kept, every channel within +-15 %) from 0.5 x the sky's (a*, b*) gap; an axis whose evidence fails counts zero.
//   env, bounce  rel = median over views of (ref - render) / ref of the shadow/lit ratio (positive: shade too dark): env x (1 + clamp(0.4 rel, +-0.25)),
//              bounce x (1 + clamp(0.4 rel, +-0.2)).
//   curve      + clamp(0.006 x contrast gap in L*, +-0.1), never below 0, never above CURVE_MAX = 0.6 (the proposal says when it was capped).
// NOT rules: `shadows` and `highlights`. The shade and sunlit colour gaps differ in sign from view to view, so one global tint
// cannot serve them; they are measured and reported as information (report.mjs).
import { labToLinear, lstarToY } from './color.mjs';
import { DEFAULT_LOOK } from '../../../engine/src/core/atmosphere.js';
import { median } from './stats.mjs';
import { WALL_COLOUR, MATERIAL_THRESHOLD } from './compare.mjs';

export const STEP = { exposure: 0.4, saturation: 0.6, skySat: 0.5, skyTint: 0.5, env: 0.4, bounce: 0.4 };
export const LIMIT = { exposure: [0.8, 1.25], saturation: [0.85, 1.2], skySat: [0.7, 1.4], skyTint: 0.15, env: 0.25, bounce: 0.2, curveStep: 0.1 };
export const CURVE_MAX = 0.6, AGREE = 0.6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = (v) => +v.toFixed(4);

/** RGB multipliers (luminance preserved, every channel within 1 +- limit) that move a mid grey by (da, db) in a*, b*. */
export function tintFromLabShift(da, db, limit = LIMIT.skyTint, baseL = 60) {
  const g = labToLinear(baseL, 0, 0)[0], s = labToLinear(baseL, da, db).map((v) => Math.max(1e-4, v) / g);
  const lum = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2], m = s.map((v) => v / lum);
  const worst = Math.max(...m.map((v) => Math.abs(v - 1))), k = worst > limit ? limit / worst : 1;
  return m.map((v) => r4(1 + (v - 1) * k));
}
const times = (cur, mul) => cur.map((v, i) => r4(v * mul[i]));

/**
 * Do the views agree, and is the gap bigger than the noise? gaps: one number per view (reference - render).
 * Returns { n, positive, negative, share, sign, median, floor, agree, aboveNoise, ok, status, line } (status null when ok).
 */
export function evidence(gaps, floor, unit = '') {
  const g = gaps.filter(Number.isFinite), n = g.length;
  if (!n) return { n: 0, ok: false, status: 'no data', line: 'no view has both a reference and a render for this measure' };
  const pos = g.filter((v) => v > 0).length, neg = g.filter((v) => v < 0).length, sign = pos >= neg ? 1 : -1, share = Math.max(pos, neg) / n, med = median(g);
  const agree = share >= AGREE, fl = Number.isFinite(floor) ? floor : 0, above = Math.abs(med) > fl;
  const status = pos + neg === 0 ? 'within noise' : !agree ? 'views disagree' : !above ? 'within noise' : null;
  const line = `${Math.max(pos, neg)} of ${n} views have the ${sign > 0 ? 'render below' : 'render above'} the photographs (${Math.round(share * 100)} %, needs ${AGREE * 100} %), median gap ${med >= 0 ? '+' : ''}${med.toFixed(2)}${unit} against a noise floor of ${fl.toFixed(2)}${unit}${status ? ': ' + status : ''}`;
  return { n, positive: pos, negative: neg, share: +share.toFixed(3), sign, median: +med.toFixed(4), floor: fl, agree, aboveNoise: above, ok: !status, status, line };
}

/**
 * views: [{ id, reference: {key: value}|null, render: {key: value}, material?: number|null (mismatch score) }]; look: the current resolved
 * look (DEFAULT_LOOK shape); floors: { key: noise floor } from noiseFloors; frozen: keys the convergence guard reverted earlier (left alone).
 * Returns { used, ignoredForMaterial, changes: [{ key, from, to, status, acted, evidence, reason, numbers }], look: { key: to } }.
 */
export function propose(views, look, { floors = {}, frozen = [], threshold = MATERIAL_THRESHOLD } = {}) {
  const use = views.filter((v) => v.reference && v.render), changes = [];
  const wallOk = (v) => !(Number.isFinite(v.material) && v.material > threshold);
  const ignored = use.filter((v) => !wallOk(v)).map((v) => v.id);
  const gapOf = (v, k) => (Number.isFinite(v.reference[k]) && Number.isFinite(v.render[k]) ? v.reference[k] - v.render[k] : NaN);
  const fl = (k) => floors[k];
  const finish = (key, ev, build) => {
    const from = look[key];
    if (frozen.includes(key)) return changes.push({ key, from, to: from, status: 'frozen', acted: false, evidence: ev ? ev.line : '', reason: 'frozen: an earlier round of this run made its gap worse, so it stays at its previous value', numbers: {} });
    if (!ev || !ev.ok) return changes.push({ key, from, to: from, status: ev ? ev.status : 'no data', acted: false, evidence: ev ? ev.line : 'no data', reason: ev ? ev.status : 'no data', numbers: {} });
    const r = build(); changes.push({ key, from, to: r.to, status: r.status || 'acted', acted: true, evidence: ev.line, reason: r.reason, numbers: r.numbers });
  };

  // exposure: per view the mean gap of walls (when the view's walls are comparable) and ground
  const expo = use.map((v) => { const ks = ['ground.L', ...(wallOk(v) ? ['walls.L'] : [])], g = ks.map((k) => gapOf(v, k)).filter(Number.isFinite), c = ks.map((k) => v.render[k]).filter(Number.isFinite); return { gap: g.length ? g.reduce((a, b) => a + b, 0) / g.length : NaN, cur: c.length ? c.reduce((a, b) => a + b, 0) / c.length : NaN }; });
  const evE = evidence(expo.map((e) => e.gap), (((fl('walls.L') ?? 0) + (fl('ground.L') ?? 0)) / 2), ' L*');
  finish('exposure', evE, () => {
    const gapL = median(expo.map((e) => e.gap)), curL = median(expo.map((e) => e.cur)), dL = STEP.exposure * gapL, mult = clamp(lstarToY(clamp(curL + dL, 1, 99)) / lstarToY(curL), ...LIMIT.exposure);
    return { to: r4(look.exposure * mult), reason: `walls and ground are ${Math.abs(gapL).toFixed(1)} L* ${gapL > 0 ? 'darker' : 'lighter'} than the photographs: apply ${STEP.exposure * 100} % of it (${dL.toFixed(1)} L*) through the L*-to-luminance curve, x${mult.toFixed(3)}`, numbers: { medianGapL: r4(gapL), renderL: r4(curL), multiplier: r4(mult) } };
  });
  // saturation: wall chroma, views with comparable walls only
  const ratios = (k, vs) => vs.map((v) => (v.reference[k] > 0 && v.render[k] > 0 ? v.reference[k] / v.render[k] : NaN)).filter(Number.isFinite);
  const wallViews = use.filter(wallOk);
  finish('saturation', evidence(wallViews.map((v) => gapOf(v, 'walls.chroma')), fl('walls.chroma'), ' chroma'), () => {
    const r = median(ratios('walls.chroma', wallViews)), step = clamp(1 + STEP.saturation * (r - 1), ...LIMIT.saturation);
    return { to: r4(look.saturation * step), reason: `wall chroma in the photographs is ${r.toFixed(2)} times the render's (median per-view ratio, ${wallViews.length} views with comparable walls): x${step.toFixed(3)}`, numbers: { ratio: r4(r), step: r4(step), views: wallViews.length } };
  });
  // sky saturation
  finish('skySat', evidence(use.map((v) => gapOf(v, 'sky.chroma')), fl('sky.chroma'), ' chroma'), () => {
    const r = median(ratios('sky.chroma', use)), step = clamp(1 + STEP.skySat * (r - 1), ...LIMIT.skySat);
    return { to: r4(look.skySat * step), reason: `sky chroma in the photographs is ${r.toFixed(2)} times the render's (median per-view ratio): x${step.toFixed(3)}`, numbers: { ratio: r4(r), step: r4(step) } };
  });
  // sky tint: per axis
  const evA = evidence(use.map((v) => gapOf(v, 'sky.a')), fl('sky.a'), ' a*'), evB = evidence(use.map((v) => gapOf(v, 'sky.b')), fl('sky.b'), ' b*');
  const evT = { ok: evA.ok || evB.ok, status: evA.ok || evB.ok ? null : evA.status === 'no data' ? 'no data' : evA.status === evB.status ? evA.status : 'views disagree', line: `a*: ${evA.line}; b*: ${evB.line}` };
  finish('skyTint', evT, () => {
    const da = evA.ok ? evA.median : 0, db = evB.ok ? evB.median : 0, mul = tintFromLabShift(STEP.skyTint * da, STEP.skyTint * db);
    return { to: times(look.skyTint, mul), reason: `the sky is off by a* ${(-da).toFixed(1)}${evA.ok ? '' : ' (not acted on)'}, b* ${(-db).toFixed(1)}${evB.ok ? '' : ' (not acted on)'} (render minus reference): shift ${STEP.skyTint * 100} % of the gap, within ${LIMIT.skyTint * 100} %`, numbers: { gapA: r4(-da), gapB: r4(-db), multiplier: mul } };
  });
  // env and bounce: shadow/lit ratio
  const evR = evidence(use.map((v) => gapOf(v, 'surfaces.ratio')), fl('surfaces.ratio'), ' ratio');
  const rel = () => median(use.map((v) => (v.reference['surfaces.ratio'] > 0 && v.render['surfaces.ratio'] > 0 ? (v.reference['surfaces.ratio'] - v.render['surfaces.ratio']) / v.reference['surfaces.ratio'] : NaN)));
  finish('env', evR, () => { const rl = rel(), st = clamp(STEP.env * rl, -LIMIT.env, LIMIT.env); return { to: r4(look.env * (1 + st)), reason: `shade is ${rl > 0 ? 'too dark' : 'too light'} against the photographs (median relative ratio gap ${(rl * 100).toFixed(0)} %): env ${st >= 0 ? '+' : ''}${(st * 100).toFixed(0)} %`, numbers: { relative: r4(rl), step: r4(st) } }; });
  finish('bounce', evR, () => { const rl = rel(), st = clamp(STEP.bounce * rl, -LIMIT.bounce, LIMIT.bounce); return { to: look.bounce.map((v) => r4(v * (1 + st))), reason: `shade is ${rl > 0 ? 'too dark' : 'too light'}: bounce ${st >= 0 ? '+' : ''}${(st * 100).toFixed(0)} %${look.bounce.every((v) => v === 0) ? ' (the bounce is zero, so nothing changes)' : ''}`, numbers: { relative: r4(rl), step: r4(st) } }; });
  // curve
  finish('curve', evidence(use.map((v) => gapOf(v, 'contrast')), fl('contrast'), ' L*'), () => {
    const gc = median(use.map((v) => gapOf(v, 'contrast'))), step = clamp(0.006 * gc, -LIMIT.curveStep, LIMIT.curveStep), want = Math.max(0, look.curve + step), capped = want > CURVE_MAX;
    return { to: r4(Math.min(want, CURVE_MAX)), status: capped ? 'acted (capped at 0.6)' : 'acted', reason: `contrast (L* p90 - p10) is ${Math.abs(gc).toFixed(1)} ${gc > 0 ? 'lower' : 'higher'} than the photographs: curve ${step >= 0 ? '+' : ''}${step.toFixed(3)}${capped ? `; capped: the rule wanted ${r4(want)} and the total is limited to ${CURVE_MAX}` : ''}`, numbers: { medianGap: r4(gc), step: r4(step), capped } };
  });
  const out = {}; for (const c of changes) out[c.key] = c.to;
  return { used: use.map((v) => v.id), ignoredForMaterial: ignored, changes, look: out };
}

/** Merge a proposed look into a place's `ambience.look`, DEFAULT_LOOK keys only. Returns the new place and what changed. */
export function applyLook(place, look) {
  const out = JSON.parse(JSON.stringify(place)); out.ambience = out.ambience || {}; out.ambience.look = out.ambience.look || {};
  const changed = [];
  for (const k of Object.keys(look || {})) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LOOK, k)) continue;
    const from = out.ambience.look[k];
    if (JSON.stringify(from) !== JSON.stringify(look[k])) { out.ambience.look[k] = look[k]; changed.push({ key: k, from: from === undefined ? null : from, to: look[k] }); }
  }
  return { place: out, changed };
}
