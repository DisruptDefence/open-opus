// Proposed changes to `ambience.look` from the gaps. The rules, all damped (60 % of the measured gap is applied, so a
// rerun converges instead of oscillating), all clamped, and each views-wide number is the MEDIAN over views that have both
// a reference and a render:
//   exposure   x Y(L+dL)/Y(L): dL = 0.6 x median gap of mean L* over walls and ground (reference - render); Y is the CIE L*->luminance
//              curve; the multiplier is clamped 0.8..1.25.
//   saturation x (1 + 0.6 (r - 1)), r = reference / render mean chroma of walls; clamped 0.85..1.2.
//   skySat     the same on the sky's mean chroma; clamped 0.85..1.2.
//   skyTint    RGB multipliers (kept in luminance, within +-6 %) from 0.6 x the sky's (a*, b*) gap.
//   shadows    the same from the dark part's (a*, b*) gap (walls and ground together);   highlights: the lit part's.
//   env, bounce  shade too dark (reference ratio > render ratio, ratio = dark L* / lit L*): rel = (ref - render) / ref;
//              env x (1 + clamp(0.6 rel, -0.25, 0.25)); bounce x (1 + clamp(0.48 rel, -0.2, 0.2)); too bright lowers them.
//   curve      + clamp(0.006 x contrast gap in L*, -0.1, 0.1), never below 0.
import { labToLinear, lstarToY } from './color.mjs';
import { DEFAULT_LOOK } from '../../../engine/src/core/atmosphere.js';
import { weightedMedian } from './stats.mjs';

export const DAMP = 0.6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = (v) => +v.toFixed(4);
const med = (xs) => weightedMedian(xs.filter(Number.isFinite).map((v) => ({ v, w: 1 })));

/** RGB multipliers (luminance preserved, every channel within 1 +- limit) that move a mid grey by (da, db) in a*, b*. */
export function tintFromLabShift(da, db, limit = 0.06, baseL = 60) {
  const g = labToLinear(baseL, 0, 0)[0], s = labToLinear(baseL, da, db).map((v) => Math.max(1e-4, v) / g);
  const lum = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2], m = s.map((v) => v / lum);
  const worst = Math.max(...m.map((v) => Math.abs(v - 1))), k = worst > limit ? limit / worst : 1;
  return m.map((v) => r4(1 + (v - 1) * k));
}
const times = (cur, mul) => cur.map((v, i) => r4(v * mul[i]));

/**
 * views: [{ id, reference: {key: value}|null, render: {key: value} }]; look: the current resolved look (DEFAULT_LOOK shape).
 * Returns { used, changes: [{ key, from, to, reason, numbers }], look: { key: to } }.
 */
export function propose(views, look) {
  const use = views.filter((v) => v.reference && v.render), changes = [];
  const d = (k) => use.map((v) => (Number.isFinite(v.reference[k]) && Number.isFinite(v.render[k]) ? v.reference[k] - v.render[k] : NaN)).filter(Number.isFinite);
  const rv = (k) => med(use.map((v) => v.render[k])), fv = (k) => med(use.map((v) => v.reference[k]));
  const add = (key, to, reason, numbers) => changes.push({ key, from: look[key], to, reason, numbers });

  // exposure
  const gapL = med(use.map((v) => { const g = ['walls.L', 'ground.L'].map((k) => v.reference[k] - v.render[k]).filter(Number.isFinite); return g.length ? g.reduce((a, b) => a + b, 0) / g.length : NaN; }));
  const curL = med(use.map((v) => { const g = ['walls.L', 'ground.L'].map((k) => v.render[k]).filter(Number.isFinite); return g.length ? g.reduce((a, b) => a + b, 0) / g.length : NaN; }));
  if (Number.isFinite(gapL) && Number.isFinite(curL)) {
    const dL = DAMP * gapL, mult = clamp(lstarToY(clamp(curL + dL, 1, 99)) / lstarToY(curL), 0.8, 1.25);
    add('exposure', r4(look.exposure * mult), `walls and ground are ${Math.abs(gapL).toFixed(1)} L* ${gapL > 0 ? 'darker' : 'lighter'} than the photographs: apply 60 % of it (${dL.toFixed(1)} L*) through the L*-to-luminance curve, x${mult.toFixed(3)}`, { medianGapL: r4(gapL), renderL: r4(curL), multiplier: r4(mult) });
  }
  // saturation
  const cw = [fv('walls.chroma'), rv('walls.chroma')];
  if (cw.every((x) => x > 0)) {
    const r = cw[0] / cw[1], step = clamp(1 + DAMP * (r - 1), 0.85, 1.2);
    add('saturation', r4(look.saturation * step), `wall chroma is ${cw[1].toFixed(1)} against ${cw[0].toFixed(1)} in the photographs: x${step.toFixed(3)}`, { reference: cw[0], render: cw[1], ratio: r4(r), step: r4(step) });
  }
  // sky
  const cs = [fv('sky.chroma'), rv('sky.chroma')];
  if (cs.every((x) => x > 0)) {
    const r = cs[0] / cs[1], step = clamp(1 + DAMP * (r - 1), 0.85, 1.2);
    add('skySat', r4(look.skySat * step), `sky chroma is ${cs[1].toFixed(1)} against ${cs[0].toFixed(1)} in the photographs: x${step.toFixed(3)}`, { reference: cs[0], render: cs[1], ratio: r4(r), step: r4(step) });
  }
  const tint = (key, ka, kb, what) => {
    const da = med(d(ka)), db = med(d(kb)); if (!Number.isFinite(da) || !Number.isFinite(db)) return;
    const mul = tintFromLabShift(DAMP * da, DAMP * db);
    add(key, times(look[key], mul), `${what} is off by a* ${(-da).toFixed(1)}, b* ${(-db).toFixed(1)} (render minus reference): shift 60 % of the gap, within 6 %`, { gapA: r4(-da), gapB: r4(-db), multiplier: mul });
  };
  tint('skyTint', 'sky.a', 'sky.b', 'the sky');
  tint('shadows', 'surfaces.dark.a', 'surfaces.dark.b', 'the shade (dark part of walls and ground)');
  tint('highlights', 'surfaces.lit.a', 'surfaces.lit.b', 'the sunlit part of walls and ground');
  // env and bounce
  const rf = fv('surfaces.ratio'), rr = rv('surfaces.ratio');
  if (rf > 0 && rr > 0) {
    const rel = (rf - rr) / rf, envStep = clamp(DAMP * rel, -0.25, 0.25), bStep = clamp(0.8 * DAMP * rel, -0.2, 0.2);
    const why = `shadow/lit ratio ${rr.toFixed(2)} against ${rf.toFixed(2)} in the photographs: shade is ${rel > 0 ? 'too dark' : 'too light'}`;
    add('env', r4(look.env * (1 + envStep)), `${why}: env ${envStep >= 0 ? '+' : ''}${(envStep * 100).toFixed(0)} %`, { referenceRatio: rf, renderRatio: rr, step: r4(envStep) });
    add('bounce', look.bounce.map((v) => r4(v * (1 + bStep))), `${why}: bounce ${bStep >= 0 ? '+' : ''}${(bStep * 100).toFixed(0)} %${look.bounce.every((v) => v === 0) ? ' (the bounce is zero, so nothing changes)' : ''}`, { referenceRatio: rf, renderRatio: rr, step: r4(bStep) });
  }
  // curve
  const gc = med(d('contrast'));
  if (Number.isFinite(gc)) {
    const step = clamp(0.006 * gc, -0.1, 0.1);
    add('curve', r4(Math.max(0, look.curve + step)), `contrast (L* p90 - p10) is ${Math.abs(gc).toFixed(1)} ${gc > 0 ? 'lower' : 'higher'} than the photographs: curve ${step >= 0 ? '+' : ''}${step.toFixed(3)}`, { medianGap: r4(gc), step: r4(step) });
  }
  const out = {}; for (const c of changes) out[c.key] = c.to;
  return { used: use.map((v) => v.id), changes, look: out };
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
