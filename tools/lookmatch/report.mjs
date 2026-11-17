// `report`: report.html, gaps.md and proposal.json from measure.json. Never edits a place file unless --apply names one.
// --previous <measure json of the round before>: the convergence guard (lib/guard.mjs): a look key changed since that round whose targeted gap
// grew is reverted to the previous round's value and marked "reverted: made it worse". --frozen key,key: keys reverted earlier in a run, left alone.
import { writeFileSync } from 'node:fs';
import { readJson, paths, readLookFile } from './lib/work.mjs';
import { buildReport, topGaps, splitGaps, gapsDocument, beforeAfter } from './lib/report.mjs';
import { propose, applyLook } from './lib/proposal.mjs';
import { guard, applyGuard, lightGap } from './lib/guard.mjs';
import { resolveLook } from '../../engine/src/core/atmosphere.js';
import { MATERIAL_THRESHOLD } from './lib/compare.mjs';

export function main(o, { log = console.log } = {}) {
  const P = paths(o.work, o.round), scene = readJson(o.scene), m = readJson(P.measure);
  const carried = o.look ? readLookFile(o.look) : {}, base = resolveLook(scene.ambience && scene.ambience.look, carried);
  const before = o.before ? readJson(paths(o.work, o.before).measure) : null, previous = o.previous ? readJson(o.previous) : null;
  const split = splitGaps(m.views), top = topGaps(m.views), floors = m.floors || {};
  let frozen = (o.frozen || '').split(',').filter(Boolean);
  const prop = propose(m.views.map((v) => ({ id: v.id, reference: v.reference && v.reference.values, render: v.render && v.render.flat, material: v.material ? v.material.mismatch : null })), base, { floors, frozen, threshold: m.materialThreshold || MATERIAL_THRESHOLD });
  let guardResults = [];
  if (previous) { guardResults = guard(previous, m, base); frozen = [...new Set([...frozen, ...applyGuard(prop, guardResults, previous.look)])]; }
  const proposal = { scene: o.scene, round: m.round, viewsUsed: prop.used, ignoredForMaterial: prop.ignoredForMaterial, noiseFloors: floors, agreement: 0.6, lightGap: +lightGap(m.views).toFixed(3), guard: guardResults, frozen, changes: prop.changes, look: { ...carried, ...prop.look } };
  writeFileSync(P.proposal, JSON.stringify(proposal, null, 1));
  writeFileSync(P.gaps, gapsDocument({ split, floors, views: m.views }));
  writeFileSync(P.report, buildReport({ title: `Look match: ${o.scene.split('/').pop().replace(/\.json$/, '')}${m.round !== 'base' ? ' (' + m.round + ')' : ''}`, views: m.views, before: before && before.views ? before : null, proposal, top, split, floors }));
  log(`summed light gap (over the measures the rules act on, in units of "what counts as a difference"): ${proposal.lightGap}`);
  log('the largest light gaps:'); split.light.forEach((g, i) => log(`${i + 1}. ${g.text}`));
  log('material and colour gaps (for style work):'); split.material.forEach((g, i) => log(`${i + 1}. ${g.text}`));
  log('proposed look changes:'); for (const c of prop.changes) log(`  ${c.key}: ${c.status}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}   (${c.status === 'acted' || c.status.startsWith('acted') ? c.reason : c.evidence || c.reason})`);
  if (guardResults.length) { log('convergence guard:'); for (const r of guardResults) log(`  ${r.key}: gap ${r.before} -> ${r.after}${r.grew ? '  REVERTED: made it worse' : ''}`); }
  if (before && before.views) {
    const rows = beforeAfter(m.views, before.views), better = rows.filter((r) => r.better).length;
    log(`gaps against round ${o.before}: ${better} of ${rows.length} controlled gaps got smaller`);
  }
  if (o.apply) {
    const { place, changed } = applyLook(readJson(o.apply), proposal.look);
    writeFileSync(o.apply, JSON.stringify(place, null, 2) + '\n');
    log(`applied to ${o.apply}:`); for (const c of changed) log(`  ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    if (!changed.length) log('  (nothing changed)');
  }
  log(`wrote ${P.report}, ${P.gaps}, ${P.proposal}`);
  return proposal;
}
