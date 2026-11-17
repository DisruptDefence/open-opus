// `facts`: palette zones from the cached photographs (stage A) and, when posed imagery is cached, per-building facts
// (stage B, never run on real imagery). See README.md, section "facts".
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readJson, paths } from '../lib/work.mjs';
import { viewGeo } from '../lib/geo.mjs';
import { measureImage, usable } from '../lib/measure.mjs';
import { openDecoder } from './lib/browser.mjs';
import { analysePhoto, upMask } from './lib/photo.mjs';
import { RULES } from './lib/rules.mjs';
import { mapImage, legendOf } from './lib/overlay.mjs';
import { buildZones, gridCentres } from './lib/zone.mjs';
import { enricherFile } from './lib/output.mjs';
import { posedFacts } from './lib/posed.mjs';
import { createGeoref } from '../../../engine/src/geo/georef.js';

/** Every cached photograph of every view folder, once per id. */
export function cachedPhotos(work) {
  const P = paths(work), seen = new Map();
  if (!existsSync(P.photos)) return [];
  for (const d of readdirSync(P.photos).sort()) {
    const sp = join(P.photos, d, 'sources.json'); if (!existsSync(sp)) continue;
    for (const p of readJson(sp).photos) if (!seen.has(p.id)) seen.set(p.id, { ...p, view: d });
  }
  return [...seen.values()];
}

export async function main(o, { log = console.log } = {}) {
  const scene = readJson(o.scene), spec = readJson(o.views), W = o.work, F = join(W, 'facts');
  const out = o.out || join(F, 'palette-zones.json');
  const only = (o.only || '').split(',').filter(Boolean), overlays = o.overlays !== 'none', yes = (v) => !!v && !/^(no|false|0)$/i.test(v);
  const views = spec.views.map((v) => ({ id: v.id, ...viewGeo(scene.georef, v) }));
  const photos = cachedPhotos(W).filter((p) => !only.length || only.includes(p.id));
  mkdirSync(join(F, 'overlays'), { recursive: true });
  const dec = await openDecoder(o.playwright || process.env.PLAYWRIGHT);
  const done = [];
  try {
    for (const p of photos) {
      const buf = readFileSync(join(W, p.file)), mime = /png/i.test(p.mime) ? 'image/png' : 'image/jpeg';
      const s = await dec.decode(buf, mime, 320), L = await dec.decode(buf, mime, RULES.decodeWidth);
      const { numbers, mask } = measureImage(s.rgba, s.w, s.h);
      const why = usable(numbers), weight = why ? 0 : numbers.framing === 'poor framing' ? 0.5 : 1;
      const res = analysePhoto(L.rgba, L.w, L.h, upMask(mask, s.w, s.h, L.w, L.h));
      done.push({ photo: p, weight, excluded: why, res });
      log(`${p.id}: ${why ? 'left out (' + why + ')' : 'w ' + weight}; ${res.walls.map((c) => `${c.material} ${c.hex} ${Math.round(c.share * 100)}%`).join(', ')}`);
      if (overlays) writeFileSync(join(F, 'overlays', `${p.id}.png`), await dec.sheet(L.rgba, mapImage(res, L.w, L.h), L.w, L.h, legendOf(res, `${p.id} ${p.title.slice(0, 60)}${why ? '  [left out: ' + why + ']' : ''}`)));
    }
  } finally { await dec.close(); }
  const centres = [...views.map((v) => ({ id: v.id, lat: v.lat, lon: v.lon, from: 'viewpoint' })), ...(yes(o.grid) ? gridCentres(done.filter((d) => d.weight > 0).map((d) => d.photo), views, { minPhotos: +(o['min-photos'] || 3) }) : [])];
  const zones = buildZones(centres, done.filter((d) => d.weight > 0).map((d) => ({ ...d.photo, weight: d.weight, walls: d.res.walls, accents: d.res.accents, roofs: d.res.roofs })), { radius: +(o.radius || 80), minPhotos: +(o['min-photos'] || 3) });
  const file = enricherFile(zones, { scene: scene.id }, photos);
  if (yes(o.posed)) {   // STAGE B: needs photographs that carry a camera heading (Mapillary, MAPILLARY_TOKEN). Never run on real imagery.
    const g = createGeoref(scene.georef), shots = [];
    const dec2 = await openDecoder(o.playwright || process.env.PLAYWRIGHT);
    try {
      for (const p of photos.filter((q) => Number.isFinite(q.heading) && q.positionOf === 'camera')) {
        const d = await dec2.decode(readFileSync(join(W, p.file)), /png/i.test(p.mime) ? 'image/png' : 'image/jpeg', 1024), at = g.toGame(p.lat, p.lon);
        shots.push({ photo: p, rgba: d.rgba, cam: { x: at.x, z: at.z, heading: (((p.heading - g.convergenceDeg) % 360) + 360) % 360, width: d.w, height: d.h, hfov: +(o.hfov || 75), eye: +(o.eye || 1.6) } });
      }
    } finally { await dec2.close(); }
    file.buildings = posedFacts(scene.buildings || [], shots);
    const ids = new Set(file.buildings.flatMap((b) => b.sources)); for (const p of photos) if (ids.has(p.id) && !file.sources.some((s) => s.id === p.id)) file.sources.push({ id: p.id, title: p.title || '', author: p.author || '', licence: p.licenceNorm || p.licence || '', licenceUrl: p.licenceUrl || '', url: p.pageUrl || '' });
    log(`posed: ${shots.length} photographs with a camera heading, ${file.buildings.length} buildings with facts`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1));
  log(`wrote ${out}: ${file.zones.length} zones from ${file.sources.length} photographs`);
  writeFileSync(join(F, 'photos-analysis.json'), JSON.stringify(done.map((d) => ({ id: d.photo.id, view: d.photo.view, weight: d.weight, excluded: d.excluded, counts: d.res.counts, walls: d.res.walls, accents: d.res.accents, roofs: d.res.roofs })), null, 1));
  return file;
}
