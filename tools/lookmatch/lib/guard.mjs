// The convergence guard. A round's look differs from the round before's in some keys; for each such key, did the gap it TARGETS
// (TARGETS in compare.mjs) shrink? The gap of a key is the sum, over the views that have a reference and a render, of |render - reference|
// divided by what counts as a difference for that measure (METRIC.matters), over the key's target measures; the saturation key
// leaves out views whose material mismatch is above the threshold, as its rule does. A key whose gap GREW (by more than 0.5 %) is reverted
// to the previous round's value and marked "reverted: made it worse"; tune.mjs then freezes it for the rest of the run.
import { METRIC, TARGETS, LIGHT_ACTED, MATERIAL_THRESHOLD } from './compare.mjs';

export const GROW = 1.005;

/** Sum of normalised absolute gaps of `keys` over views. view: { reference: {values}, render: {flat}, material?: {mismatch} } */
export function gapSum(views, keys, { threshold = MATERIAL_THRESHOLD, skipMaterial = false } = {}) {
  let s = 0, n = 0;
  for (const v of views) {
    const ref = v.reference && v.reference.values, rd = v.render && v.render.flat; if (!ref || !rd) continue;
    if (skipMaterial && v.material && v.material.mismatch > threshold) continue;
    for (const k of keys) if (Number.isFinite(ref[k]) && Number.isFinite(rd[k])) { s += Math.abs(rd[k] - ref[k]) / METRIC[k].matters; n++; }
  }
  return { sum: s, n };
}
/**
 * The same sum over only the (view, measure) pairs that BOTH sets of views have (a region that appears or vanishes between rounds, such as a
 * ground the rules stop finding on a lawn, would otherwise change the sum without any change in the picture). Returns { a, b, n }.
 */
export function gapSumCommon(viewsA, viewsB, keys, { threshold = MATERIAL_THRESHOLD, skipMaterial = false } = {}) {
  const pairs = (views) => { const m = new Map(); for (const v of views) { const ref = v.reference && v.reference.values, rd = v.render && v.render.flat; if (!ref || !rd) continue; if (skipMaterial && v.material && v.material.mismatch > threshold) continue; for (const k of keys) if (Number.isFinite(ref[k]) && Number.isFinite(rd[k])) m.set(v.id + '|' + k, Math.abs(rd[k] - ref[k]) / METRIC[k].matters); } return m; };
  const A = pairs(viewsA), B = pairs(viewsB); let a = 0, b = 0, n = 0;
  for (const [k, x] of A) if (B.has(k)) { a += x; b += B.get(k); n++; }
  return { a, b, n };
}
/** The summed "light" gap of a measure: every light measure the rules act on, over all views. */
export const lightGap = (views) => gapSum(views, LIGHT_ACTED).sum;

/** Keys whose value differs between two resolved looks. */
export const changedKeys = (a, b) => Object.keys(TARGETS).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

/**
 * previous: { views, look } (a measure json); current: { views }; currentLook: the look the current round was rendered with.
 * Returns [{ key, before, after, grew }] for every key that changed between the two looks.
 */
export function guard(previous, current, currentLook, { threshold = MATERIAL_THRESHOLD } = {}) {
  return changedKeys(previous.look || {}, currentLook).map((key) => {
    const opt = { threshold, skipMaterial: key === 'saturation' };
    const { a: b, b: a } = gapSumCommon(previous.views, current.views, TARGETS[key], opt);
    return { key, before: +b.toFixed(3), after: +a.toFixed(3), grew: a > b * GROW + 1e-9 };
  });
}
/** Apply a guard result to a proposal: grown keys go back to the previous round's value, are marked, and are returned in `frozen`. */
export function applyGuard(proposal, results, previousLook) {
  const frozen = [];
  for (const r of results.filter((x) => x.grew)) {
    const c = proposal.changes.find((x) => x.key === r.key); if (!c) continue;
    c.to = previousLook[r.key]; c.status = 'reverted'; c.acted = false;
    c.reason = `reverted: made it worse (the gap it targets went from ${r.before} to ${r.after}); back to the previous round's value`;
    c.evidence = c.reason; proposal.look[r.key] = c.to; frozen.push(r.key);
  }
  return frozen;
}
