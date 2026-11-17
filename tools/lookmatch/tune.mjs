// `tune`: up to --rounds N (default 3) of render -> measure -> propose, with the convergence guard (lib/guard.mjs).
// Round t0 renders the scene's own look (or --look); round ti renders the look proposed after t(i-1), applied by the URL switch only
// (photo.mjs QUERY look=<JSON>); the place file is NEVER touched unless --apply names one. Photograph numbers and the reference are measured once
// (t0) and pinned for later rounds, so a gap changes only because the render did. Stops early when the summed gap of the measures the
// changed keys target improves by less than 1 %. After the last round only the guard acts (a key that made its gap worse goes back);
// the final look is written to <work>/proposal-final.json with an evidence line per key, and <work>/tune.json holds the table.
//   node tools/lookmatch/lookmatch.mjs tune --scene ... --views ... --work .lookmatch/<id> --playwright <path> --engine-url <url> [--rounds 3] [--lock file]
import { writeFileSync, copyFileSync } from 'node:fs';
import { readJson, paths, readLookFile } from './lib/work.mjs';
import { resolveLook } from '../../engine/src/core/atmosphere.js';
import { changedKeys, gapSum, gapSumCommon, lightGap } from './lib/guard.mjs';
import { LIGHT_ACTED, TARGETS, METRIC } from './lib/compare.mjs';
import * as render from './render.mjs';
import * as measure from './measure.mjs';
import * as report from './report.mjs';

export const EARLY_STOP = 0.01;

export async function main(o, { log = console.log } = {}) {
  const rounds = +(o.rounds || 3), scene = readJson(o.scene), table = [], history = [];
  let lookFile = o.look || null, frozen = [], prevMeasure = null, prevName = null, final = null, stopped = null;
  const startLook = resolveLook(scene.ambience && scene.ambience.look, lookFile ? readLookFile(lookFile) : null);
  for (let i = 0; i <= rounds; i++) {
    const name = `t${i}`, o2 = { ...o, round: name, look: lookFile || undefined };
    log(`\n=== round ${name}${lookFile ? ' with ' + lookFile : ' (the scene\'s own look)'}`);
    render.main(o2, { log });
    await measure.main({ ...o2, pin: i ? paths(o.work, 't0').measure : undefined }, { log });
    const P = paths(o.work, name), m = readJson(P.measure);
    const prop = report.main({ ...o2, previous: prevMeasure || undefined, frozen: frozen.join(',') }, { log });
    frozen = prop.frozen;
    const perView = Object.fromEntries(m.views.filter((v) => v.reference && v.render).map((v) => [v.id, +gapSum([v], LIGHT_ACTED).sum.toFixed(2)]));
    table.push({ round: name, lightGap: +lightGap(m.views).toFixed(2), perView, look: m.look, reverted: prop.guard.filter((g) => g.grew).map((g) => g.key), held: prop.changes.filter((c) => !c.acted && c.status !== 'reverted').map((c) => `${c.key}: ${c.status}`) });
    history.push({ name, look: m.look, proposal: prop });
    if (i > 0) {
      const keys = changedKeys(readJson(paths(o.work, prevName).measure).look, m.look), measures = [...new Set(keys.flatMap((k) => TARGETS[k]))];
      const { a, b } = gapSumCommon(readJson(paths(o.work, prevName).measure).views, m.views, measures), gain = a > 0 ? (a - b) / a : 0;
      table[i].actedGap = { keys, before: +a.toFixed(2), after: +b.toFixed(2), improvement: +gain.toFixed(4) };
      log(`summed gap of the measures the changed keys target: ${a.toFixed(2)} -> ${b.toFixed(2)} (${(gain * 100).toFixed(1)} %)`);
      if (gain < EARLY_STOP && i < rounds) { stopped = `round ${name}: the acted-on gap improved by ${(gain * 100).toFixed(1)} %, under ${EARLY_STOP * 100} %`; log('stopping early: ' + stopped); }
    }
    // the look of the next round: this round's proposal (every key it acted on, with reverts applied); at the end or on an early stop only the reverts
    const next = { ...prop.look };
    if (i === rounds || stopped) {
      const resolved = m.look, keep = { ...(lookFile ? readLookFile(lookFile) : {}) };
      for (const c of prop.changes) if (c.status === 'reverted') keep[c.key] = c.to;
      final = { look: keep, proposal: prop, resolvedAtRound: resolved, round: name };
      break;
    }
    lookFile = `${o.work}/look-t${i + 1}.json`; writeFileSync(lookFile, JSON.stringify(next, null, 1));
    prevMeasure = P.measure; prevName = name;
  }
  // the evidence line per key
  const last = final.proposal, keys = {};
  for (const c of last.changes) {
    const first = history.find((h) => h.proposal.changes.find((x) => x.key === c.key && x.acted));
    const trail = history.map((h) => h.look[c.key]);
    keys[c.key] = { from: startLook[c.key], to: final.look[c.key] !== undefined ? final.look[c.key] : startLook[c.key], changedInRun: JSON.stringify(final.look[c.key] !== undefined ? final.look[c.key] : startLook[c.key]) !== JSON.stringify(startLook[c.key]), lastStatus: c.status, evidence: c.evidence, firstActedAtRound: first ? first.name : null, valuesPerRound: trail };
  }
  const out = { scene: o.scene, rounds: table.length - 1, stopped, note: 'The look is cumulative: keys not listed keep the scene\'s own value. Not applied to any place file.', look: final.look, keys, frozen: last.frozen, lightGapPerRound: table.map((t) => ({ round: t.round, lightGap: t.lightGap })) };
  writeFileSync(`${o.work}/proposal-final.json`, JSON.stringify(out, null, 1));
  writeFileSync(`${o.work}/tune.json`, JSON.stringify({ table }, null, 1));
  // a region that appears or vanishes between rounds changes a sum without any change in the picture: also sum over the (view, measure) pairs present in EVERY round
  const ms = table.map((t) => readJson(paths(o.work, t.round).measure).views);
  const pairsAll = (views) => { const mp = new Map(); for (const v of views) { const ref = v.reference && v.reference.values, rd = v.render && v.render.flat; if (ref && rd) for (const k of LIGHT_ACTED) if (Number.isFinite(ref[k]) && Number.isFinite(rd[k])) mp.set(v.id + '|' + k, Math.abs(rd[k] - ref[k]) / METRIC[k].matters); } return mp; };
  const maps = ms.map(pairsAll), keep = [...maps[0].keys()].filter((k) => maps.every((mp) => mp.has(k)));
  table.forEach((t, i) => { t.commonGap = +keep.reduce((s, k) => s + maps[i].get(k), 0).toFixed(2); t.commonPerView = {}; for (const k of keep) { const v = k.split('|')[0]; t.commonPerView[v] = +((t.commonPerView[v] || 0) + maps[i].get(k)).toFixed(2); } });
  out.lightGapOnCommonMeasures = table.map((t) => ({ round: t.round, lightGap: t.commonGap })); out.commonMeasures = keep.length;
  writeFileSync(`${o.work}/proposal-final.json`, JSON.stringify(out, null, 1));
  const views = Object.keys(table[0].perView);
  log('\nsummed light gap (sum of |gap| / what counts as a difference, over walls L*, ground L*, sky chroma, sky a*, sky b*, shadow/lit ratio, contrast):');
  log(['view'.padEnd(24), ...table.map((t) => t.round.padStart(8))].join(' '));
  for (const v of views) log([v.padEnd(24), ...table.map((t) => String(t.perView[v] ?? '-').padStart(8))].join(' '));
  log(['TOTAL'.padEnd(24), ...table.map((t) => String(t.lightGap).padStart(8))].join(' '));
  log(`\nthe same, over the ${keep.length} (view, measure) pairs present in every round (nothing appears or vanishes):`);
  log(['view'.padEnd(24), ...table.map((t) => t.round.padStart(8))].join(' '));
  for (const v of Object.keys(table[0].commonPerView)) log([v.padEnd(24), ...table.map((t) => String(t.commonPerView[v] ?? '-').padStart(8))].join(' '));
  log(['TOTAL'.padEnd(24), ...table.map((t) => String(t.commonGap).padStart(8))].join(' '));
  for (const t of table) log(`${t.round}: reverted [${t.reverted.join(', ')}]; held back: ${t.held.join('; ') || 'none'}`);
  log('wrote ' + `${o.work}/proposal-final.json`);
  return out;
}
