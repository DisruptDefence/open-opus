// report.html (one file, plain CSS, no script), gaps.md and the ten largest gaps. Pure: data in, strings out.
import { METRICS, gapsOf, sentence, materialSentence, MATERIAL_THRESHOLD, MATERIAL_MATTERS } from './compare.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//.test(String(u || '')) ? u : '');

/** Attribution line of a photograph: title and page link, author, licence with its link. Always complete. */
export function attributionOf(p) {
  const page = safeUrl(p.pageUrl), lic = safeUrl(p.licenceUrl);
  return `<a href="${esc(page)}">${esc(p.title || 'photograph')}</a> by ${esc(p.author || 'author not given')}, ${lic ? `<a href="${esc(lic)}">${esc(p.licence)}</a>` : esc(p.licence)}`;
}

/** The ten largest gaps over all views, largest first: [{ view, key, size, gap, text }]. */
export function topGaps(views, n = 10) {
  const all = [];
  for (const v of views) for (const g of gapsOf(v.reference && v.reference.values, v.render && v.render.flat)) if (g.matters) all.push({ view: v.id, ...g, text: sentence(g, v.id) });
  // one sentence per (metric, view); the largest first, by size = |gap| / the metric's "matters" threshold
  return all.sort((a, b) => b.size - a.size).slice(0, n);
}
export const gapsMarkdown = (top) => `# The ten largest gaps\n\nRender minus photographs, largest first (size is the gap in units of what counts as a difference for that measure).\n\n${top.map((g, i) => `${i + 1}. ${g.text} (size ${g.size.toFixed(1)})`).join('\n')}\n`;

/**
 * The gaps split by what can fix them: { light, material, info, framing } (each largest first, sentences with the view).
 *  light     L*, contrast, shade/sun ratio and lightness, sky colour: the scene's light settings move these;
 *  material  wall and ground hue and chroma, busyness, colour spread, and one line per view whose dominant wall colours differ
 *            (its material mismatch): the hand-off to style work;
 *  info      shade and sunlit colour (a*, b*): sign differs from view to view, a global tint cannot serve them: information only;
 *  framing   shares of sky, ground and walls.
 */
export function splitGaps(views, n = 10) {
  const out = { light: [], material: [], info: [], framing: [] };
  for (const v of views) {
    for (const g of gapsOf(v.reference && v.reference.values, v.render && v.render.flat)) {
      const m = METRICS.find((x) => x.key === g.key); if (!g.matters) continue;
      out[m.group].push({ view: v.id, ...g, text: sentence(g, v.id) });
    }
    if (v.material && v.material.mismatch != null && v.material.mismatch > MATERIAL_THRESHOLD) out.material.push({ view: v.id, key: 'material.mismatch', size: v.material.mismatch / MATERIAL_MATTERS, gap: v.material.mismatch, matters: true, text: materialSentence(v.id, v.material) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.size - a.size);
  return { light: out.light.slice(0, n), material: out.material.slice(0, n), info: out.info, framing: out.framing, all: out };
}
export const INFO_SENTENCE = 'A global tint cannot serve these when the signs differ from view to view, so shade and sunlit colour are information, not a rule.';

/** Per view the shade and sunlit colour gaps (render minus reference a*, b*), as lines. */
export function infoLines(views) {
  const lines = [];
  for (const v of views) {
    const ref = v.reference && v.reference.values, rd = v.render && v.render.flat; if (!ref || !rd) continue;
    const g = (k) => (Number.isFinite(ref[k]) && Number.isFinite(rd[k]) ? rd[k] - ref[k] : null), f = (x) => (x == null ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(1));
    lines.push(`${v.id}: shade a* ${f(g('surfaces.dark.a'))}, b* ${f(g('surfaces.dark.b'))}; sunlit a* ${f(g('surfaces.lit.a'))}, b* ${f(g('surfaces.lit.b'))} (render minus photographs)`);
  }
  return lines;
}
/** Do the signs of the shade and sunlit gaps differ between views? { key: 'both signs' | 'same sign' } */
export function infoSigns(views) {
  const out = {};
  for (const k of ['surfaces.dark.a', 'surfaces.dark.b', 'surfaces.lit.a', 'surfaces.lit.b']) {
    const gs = views.map((v) => (v.reference && v.render && Number.isFinite(v.reference.values[k]) && Number.isFinite(v.render.flat[k]) ? v.render.flat[k] - v.reference.values[k] : null)).filter((x) => x != null);
    out[k] = gs.some((x) => x > 0) && gs.some((x) => x < 0) ? 'signs differ' : 'same sign';
  }
  return out;
}

const list = (a, empty) => (a.length ? a.map((g, i) => `${i + 1}. ${g.text} (size ${g.size.toFixed(1)})`).join('\n') : empty);
/** gaps.md: the two lists, the information, the floors and the material mismatch per view. */
export function gapsDocument({ split, floors = null, views = [] }) {
  const mm = views.filter((v) => v.material && v.material.mismatch != null).map((v) => `- ${v.id}: ${v.material.mismatch.toFixed(1)}${v.material.mismatch > MATERIAL_THRESHOLD ? ' (above ' + MATERIAL_THRESHOLD + ': ignored by wall-colour rules)' : ''}`).join('\n');
  const fl = floors ? Object.entries(floors).filter(([k, v]) => v != null && ['walls.L', 'ground.L', 'sky.L', 'sky.a', 'sky.b', 'sky.chroma', 'walls.chroma', 'surfaces.ratio', 'contrast'].includes(k)).map(([k, v]) => `${k} ${v}`).join(', ') : '';
  return `# Gaps\n\nRender minus photographs, largest first (size is the gap in units of what counts as a difference for that measure).\n\n## Light (the scene's light settings can move these)\n\n${list(split.light, 'No light gap above what counts as a difference.')}\n\n## Material and colour (the hand-off to style work: not for the light settings)\n\n${list(split.material, 'No material gap above what counts as a difference.')}\n\n## Information: shade and sunlit colour\n\n${INFO_SENTENCE}\n\n${infoLines(views).map((l) => '- ' + l).join('\n')}\n\n## Material mismatch per view (earth mover's distance of dominant wall colours in a*, b*)\n\n${mm || 'none'}\n${fl ? `\n## Noise floors (spread between photographs of one view)\n\n${fl}\n` : ''}`;
}

const fmt = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) < 1 && v !== 0 ? v.toFixed(3) : v.toFixed(2)) : '–');

function table(v, before) {
  const ref = v.reference && v.reference.values, rd = v.render && v.render.flat, bf = before && before.render && before.render.flat;
  if (!rd) return '<p>No render measured.</p>';
  const rows = METRICS.map((m) => {
    const a = ref ? ref[m.key] : null, b = rd[m.key], c = bf ? bf[m.key] : null;
    const d = Number.isFinite(a) && Number.isFinite(b) ? b - a : null, d0 = Number.isFinite(a) && Number.isFinite(c) ? c - a : null;
    const big = d != null && Math.abs(d) >= m.matters, shrunk = d != null && d0 != null && Math.abs(d) < Math.abs(d0);
    return `<tr class="${big ? 'big' : ''}"><td>${esc(m.label)}</td><td>${fmt(a)}</td>${bf ? `<td>${fmt(c)}</td><td>${d0 == null ? '–' : (d0 > 0 ? '+' : '') + fmt(d0)}</td>` : ''}<td>${fmt(b)}</td><td>${d == null ? '–' : (d > 0 ? '+' : '') + fmt(d)}${big ? ' ●' : ''}${bf && d != null && d0 != null ? (shrunk ? ' <span class="good">smaller</span>' : Math.abs(d) > Math.abs(d0) ? ' <span class="bad">larger</span>' : '') : ''}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>measure</th><th>photographs (median)</th>${bf ? '<th>render before</th><th>gap before</th>' : ''}<th>render${bf ? ' now' : ''}</th><th>gap${bf ? ' now' : ''}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function palette(p) { return p && p.colourfulness ? `<div class="pal">${p.colourfulness.dominant.map((c) => `<span style="background:${esc(c.hex)}" title="${esc(c.hex)} ${(c.share * 100).toFixed(0)} %"></span>`).join('')}</div>` : ''; }

export function buildReport({ title, views, before = null, proposal = null, top = [], split = null, floors = null }) {
  const beforeBy = before ? Object.fromEntries(before.views.map((v) => [v.id, v])) : {};
  const sections = views.map((v) => {
    const used = v.photos.filter((p) => !p.excluded);
    const figs = [];
    if (before && beforeBy[v.id] && beforeBy[v.id].render) figs.push(`<figure class="render"><div class="box"><img src="${esc(beforeBy[v.id].render.file)}" alt="render before"><img class="ov" src="${esc(beforeBy[v.id].render.overlay || '')}" alt=""></div><figcaption>Render before</figcaption></figure>`);
    if (v.render) figs.push(`<figure class="render"><div class="box"><img src="${esc(v.render.file)}" alt="render"><img class="ov" src="${esc(v.render.overlay || '')}" alt=""></div><figcaption>Render${before ? ' now' : ''}${palette(v.render.numbers)}</figcaption></figure>`);
    for (const p of used) figs.push(`<figure class="photo"><div class="box"><img src="${esc(p.file)}" alt="${esc(p.title)}"><img class="ov" src="${esc(p.overlay || '')}" alt=""></div><figcaption>${attributionOf(p)}<br><small>${p.distance != null ? p.distance + ' m' : ''}${p.headingDiff != null ? `, ${p.headingDiff}° off` : ', heading unknown'}${p.numbers && p.numbers.framing !== 'ok' ? ', ' + esc(p.numbers.framing) + ' (half weight)' : ''}</small>${palette(p.numbers)}</figcaption></figure>`);
    const skipped = v.photos.filter((p) => p.excluded);
    return `<section><h2>${esc(v.id)} <small>${esc(v.what || '')}</small></h2>
<div class="row">${figs.join('\n')}</div>
${skipped.length ? `<p class="note">${skipped.length} downloaded photograph(s) left out of the numbers: ${skipped.map((p) => esc(p.excluded)).join(', ')}.</p>` : ''}
${v.rejected ? `<p class="note">Candidates rejected for this view: ${esc(v.rejected)}.</p>` : ''}${v.material && v.material.mismatch != null ? `<p class="note">Material mismatch (dominant wall colours, a* b*): ${v.material.mismatch.toFixed(1)}${v.material.mismatch > MATERIAL_THRESHOLD ? ' (above ' + MATERIAL_THRESHOLD + ': ignored by wall-colour rules)' : ''}.</p>` : ''}
${v.reference ? `<p class="note">Reference: ${v.reference.photos} photograph(s), weighted median.</p>` : '<p class="note">No usable photograph for this view: no reference.</p>'}
${table(v, beforeBy[v.id])}</section>`;
  }).join('\n');
  const prop = proposal ? `<section><h2>Proposed look changes</h2><table><thead><tr><th>key</th><th>from</th><th>to</th><th>status</th><th>evidence and why</th></tr></thead><tbody>${proposal.changes.map((c) => `<tr><td>${esc(c.key)}</td><td>${esc(JSON.stringify(c.from))}</td><td>${esc(JSON.stringify(c.to))}</td><td>${esc(c.status || '')}</td><td style="text-align:left">${esc(c.evidence || '')}<br>${esc(c.reason)}</td></tr>`).join('')}</tbody></table>${floors ? `<p class="note">Noise floors: ${esc(Object.entries(floors).filter(([k, v]) => v != null && ['walls.L', 'ground.L', 'sky.a', 'sky.b', 'sky.chroma', 'walls.chroma', 'surfaces.ratio', 'contrast'].includes(k)).map(([k, v]) => k + ' ' + v).join(', '))}</p>` : ''}</section>` : '';
  const tg2 = split ? `<section><h2>Light gaps</h2><ol>${split.light.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ol><h2>Material and colour gaps (for style work)</h2><ol>${split.material.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ol><h2>Information: shade and sunlit colour</h2><p class="note">${esc(INFO_SENTENCE)}</p><ul>${infoLines(views).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>` : '';
  const tg = top.length && !split ? `<section><h2>Largest gaps</h2><ol>${top.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ol></section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:0 16px 40px;background:#16181b;color:#e6e6e6}
h1{font-size:20px} h2{font-size:17px;margin:28px 0 8px;border-top:1px solid #333;padding-top:12px} h2 small{font-weight:400;color:#999}
a{color:#8ab4ff} .row{display:flex;gap:10px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}
figure{margin:0;flex:none} .box{position:relative;display:inline-block;line-height:0} .box img{height:240px;width:auto;display:block}
.box img.ov{position:absolute;left:0;top:0;width:100%;height:100%;display:none;pointer-events:none}
#ov:checked ~ main .ov{display:block} figcaption{font-size:12px;max-width:340px;line-height:1.35;margin-top:4px} .render figcaption{color:#ffd37a}
table{border-collapse:collapse;font-size:12px;margin-top:8px} td,th{padding:2px 10px;border-bottom:1px solid #2a2d31;text-align:right} td:first-child,th:first-child{text-align:left}
tr.big td{background:#2c2417} .good{color:#7bd88f} .bad{color:#ff8a80} .note{color:#aaa;margin:4px 0} .pal{display:flex;margin-top:3px}.pal span{width:26px;height:10px}
label.tg{display:inline-block;margin:8px 0;padding:4px 10px;border:1px solid #555;border-radius:4px;cursor:pointer} #ov{position:absolute;opacity:0}
.legend span{display:inline-block;width:12px;height:12px;vertical-align:-2px;margin:0 4px 0 12px}
</style></head><body>
<h1>${esc(title)}</h1>
<input type="checkbox" id="ov"><label class="tg" for="ov">Show regions</label>
<span class="legend"><span style="background:rgba(40,120,255,.7)"></span>sky<span style="background:rgba(40,200,90,.7)"></span>ground<span style="background:rgba(255,140,0,.7)"></span>walls</span>
<p class="note">Photographs are shown with author and licence as their licences require. They stay in the work folder and are never committed. A ● marks a difference that matters.</p>
<main>
${tg}${tg2}${prop}
${sections}
</main></body></html>`;
}

/** The measures the proposal rules act on: before and after gaps (render minus reference) per view. */
export const CONTROLLED = ['walls.L', 'ground.L', 'walls.chroma', 'sky.chroma', 'sky.a', 'sky.b', 'surfaces.dark.a', 'surfaces.dark.b', 'surfaces.lit.a', 'surfaces.lit.b', 'surfaces.ratio', 'contrast'];
export function beforeAfter(views, beforeViews) {
  const by = Object.fromEntries(beforeViews.map((v) => [v.id, v])), rows = [];
  for (const v of views) {
    const b = by[v.id]; if (!b || !v.reference || !b.reference) continue;
    for (const k of CONTROLLED) {
      const ref = v.reference.values[k], r0 = b.render && b.render.flat[k], r1 = v.render && v.render.flat[k];
      if ([ref, r0, r1].every(Number.isFinite)) rows.push({ view: v.id, key: k, before: +(r0 - ref).toFixed(2), after: +(r1 - ref).toFixed(2), better: Math.abs(r1 - ref) < Math.abs(r0 - ref) });
    }
  }
  return rows;
}
