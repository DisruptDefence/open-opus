// `measure`: the same numbers on every photograph and every render (lib/measure.mjs), reference per view, written to
// <work>/measure[-round].json with region overlays under <work>/overlays/. Per view also: which photographs frame it like the render, the material
// mismatch (dominant wall colours), the candidates rejected by which rule; overall: the noise floors and the look the render was made with.
// --pin <measure.json>: reuse that round's photograph numbers, left-out reasons and framing choices (photographs do not change between rounds,
// and the reference must not change with the render), measuring only the renders. --look <file>: recorded as the look the renders carry.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readJson, paths, suffix } from './lib/work.mjs';
import { openDecoder } from './lib/browser.mjs';
import { measureImage, usable } from './lib/measure.mjs';
import { flat, referenceOf, framingMatch, noiseFloors, materialMismatch, MATERIAL_THRESHOLD } from './lib/compare.mjs';
import { resolveLook } from '../../engine/src/core/atmosphere.js';
import { readLookFile } from './lib/work.mjs';

export async function main(o, { log = console.log } = {}) {
  const spec = readJson(o.views), P = paths(o.work, o.round), only = (o.only || '').split(',').filter(Boolean);
  const dec = await openDecoder(o.playwright || process.env.PLAYWRIGHT);
  const pin = o.pin ? readJson(o.pin) : null, pinned = (vid, pid) => pin && (pin.views.find((x) => x.id === vid) || { photos: [] }).photos.find((p) => p.id === pid);
  const scene = readJson(o.scene), look = resolveLook(scene.ambience && scene.ambience.look, o.look ? readLookFile(o.look) : null);
  const out = { scene: o.scene, round: o.round || 'base', width: 320, look, materialThreshold: MATERIAL_THRESHOLD, views: [] };
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
        const pn = pinned(v.id, p.id);
        if (pn) { photos.push({ ...p, numbers: pn.numbers, overlay: pn.overlay, excluded: pn.excluded, match: pn.match }); continue; }
        const m = await one(p.file, /png/i.test(p.mime) ? 'image/png' : 'image/jpeg', `overlays/${v.id}/${p.id}.png`);
        photos.push({ ...p, numbers: m.numbers, overlay: m.overlay, excluded: usable(m.numbers) });
      }
      const rel = `renders${suffix(o.round)}/render-${v.id}.png`; let render = null;
      if (existsSync(join(o.work, rel))) { const m = await one(rel, 'image/png', `overlays/${v.id}/render${suffix(o.round) || '-base'}.png`); render = { file: rel, numbers: m.numbers, overlay: m.overlay, flat: flat(m.numbers) }; }
      if (render && !pin) for (const p of photos) p.match = p.excluded ? null : framingMatch(p.numbers, render.numbers);
      const content = {}; for (const p of photos) if (p.excluded) content[p.excluded] = (content[p.excluded] || 0) + 1;
      const fmt = (o) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', '), unmatched = photos.filter((p) => !p.excluded && p.match === false).length;
      const rejected = [Object.keys(meta.dropped || {}).length ? 'by metadata: ' + fmt(meta.dropped) : '', Object.keys(content).length ? 'by content: ' + fmt(content) : '', unmatched ? `${unmatched} set aside for framing unlike the render's` : ''].filter(Boolean).join('; ');
      out.views.push({ id: v.id, what: v.what, photos, reference: referenceOf(photos), material: render ? materialMismatch(photos, render.numbers) : null, rejected, render });
      log(`${v.id}: ${photos.length} photographs (${photos.filter((p) => p.excluded).length} left out), render ${render ? 'measured' : 'MISSING'}`);
    }
  } finally { await dec.close(); }
  out.floors = noiseFloors(out.views);
  writeFileSync(P.measure, JSON.stringify(out, null, 1));
  log('noise floors: ' + Object.entries(out.floors).filter(([k, v]) => v != null && ['walls.L', 'ground.L', 'sky.a', 'sky.b', 'sky.chroma', 'walls.chroma', 'surfaces.ratio', 'contrast'].includes(k)).map(([k, v]) => k + ' ' + v).join(', '));
  log('material mismatch: ' + out.views.map((v) => `${v.id.split('-')[0]} ${v.material ? v.material.mismatch : '-'}`).join(', '));
  log('wrote ' + P.measure);
}
