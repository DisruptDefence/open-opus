// `measure`: the same numbers on every photograph and every render (lib/measure.mjs), reference per view, written to
// <work>/measure[-round].json with region overlays under <work>/overlays/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readJson, paths, suffix } from './lib/work.mjs';
import { openDecoder } from './lib/browser.mjs';
import { measureImage, usable } from './lib/measure.mjs';
import { flat, referenceOf } from './lib/compare.mjs';

export async function main(o, { log = console.log } = {}) {
  const spec = readJson(o.views), P = paths(o.work, o.round), only = (o.only || '').split(',').filter(Boolean);
  const dec = await openDecoder(o.playwright || process.env.PLAYWRIGHT);
  const out = { scene: o.scene, round: o.round || 'base', width: 320, views: [] };
  const save = (rel, buf) => { const p = join(o.work, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); return rel; };
  try {
    const one = async (file, mime, overlayRel) => {
      const d = await dec.decode(readFileSync(join(o.work, file)), mime, 320);
      const { numbers, mask } = measureImage(d.rgba, d.w, d.h);
      return { numbers, overlay: save(overlayRel, await dec.overlay(mask, d.w, d.h)) };
    };
    for (const v of spec.views.filter((x) => !only.length || only.includes(x.id))) {
      const sp = join(P.photos, v.id, 'sources.json'), meta = existsSync(sp) ? readJson(sp) : { photos: [] };
      const photos = [];
      for (const p of meta.photos) {
        const m = await one(p.file, /png/i.test(p.mime) ? 'image/png' : 'image/jpeg', `overlays/${v.id}/${p.id}.png`);
        photos.push({ ...p, numbers: m.numbers, overlay: m.overlay, excluded: usable(m.numbers) });
      }
      const rel = `renders${suffix(o.round)}/render-${v.id}.png`; let render = null;
      if (existsSync(join(o.work, rel))) { const m = await one(rel, 'image/png', `overlays/${v.id}/render${suffix(o.round) || '-base'}.png`); render = { file: rel, numbers: m.numbers, overlay: m.overlay, flat: flat(m.numbers) }; }
      out.views.push({ id: v.id, what: v.what, photos, reference: referenceOf(photos), render });
      log(`${v.id}: ${photos.length} photographs (${photos.filter((p) => p.excluded).length} left out), render ${render ? 'measured' : 'MISSING'}`);
    }
  } finally { await dec.close(); }
  writeFileSync(P.measure, JSON.stringify(out, null, 1));
  log('wrote ' + P.measure);
}
