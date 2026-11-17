// `report`: report.html, gaps.md and proposal.json from measure.json. Never edits a place file unless --apply names one.
import { writeFileSync, readFileSync } from 'node:fs';
import { readJson, paths, readLookFile } from './lib/work.mjs';
import { buildReport, topGaps, gapsMarkdown, beforeAfter } from './lib/report.mjs';
import { propose, applyLook } from './lib/proposal.mjs';
import { resolveLook } from '../../engine/src/core/atmosphere.js';

export function main(o, { log = console.log } = {}) {
  const P = paths(o.work, o.round), scene = readJson(o.scene), m = readJson(P.measure);
  const base = resolveLook(scene.ambience && scene.ambience.look, o.look ? readLookFile(o.look) : null);
  const before = o.before ? readJson(paths(o.work, o.before).measure) : null;
  const top = topGaps(m.views), prop = propose(m.views.map((v) => ({ id: v.id, reference: v.reference && v.reference.values, render: v.render && v.render.flat })), base);
  // the proposed look is cumulative: what --look already laid over the scene's, plus these changes
  const carried = o.look ? readLookFile(o.look) : {};
  const proposal = { scene: o.scene, round: m.round, viewsUsed: prop.used, damping: 0.6, changes: prop.changes, look: { ...carried, ...prop.look } };
  writeFileSync(P.proposal, JSON.stringify(proposal, null, 1));
  writeFileSync(P.gaps, gapsMarkdown(top));
  writeFileSync(P.report, buildReport({ title: `Look match: ${o.scene.split('/').pop().replace(/\.json$/, '')}${m.round !== 'base' ? ' (' + m.round + ')' : ''}`, views: m.views, before: before && before.views ? before : null, proposal, top }));
  log('the ten largest gaps:'); top.forEach((g, i) => log(`${i + 1}. ${g.text}`));
  log('proposed look changes:'); for (const c of prop.changes) log(`  ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}   (${c.reason})`);
  if (before && before.views) {
    const rows = beforeAfter(m.views, before.views), better = rows.filter((r) => r.better).length;
    log(`gaps against round ${o.before}: ${better} of ${rows.length} controlled gaps got smaller`);
    for (const r of rows) log(`  ${r.view} ${r.key}: ${r.before} -> ${r.after}${r.better ? '' : '  (larger)'}`);
  }
  if (o.apply) {
    const { place, changed } = applyLook(readJson(o.apply), proposal.look);
    writeFileSync(o.apply, JSON.stringify(place, null, 2) + '\n');
    log(`applied to ${o.apply}:`); for (const c of changed) log(`  ${c.key}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    if (!changed.length) log('  (nothing changed)');
  }
  log(`wrote ${P.report}, ${P.gaps}, ${P.proposal}`);
}
