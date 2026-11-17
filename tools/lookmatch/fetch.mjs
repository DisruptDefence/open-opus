// `fetch`: for each viewpoint, find open-licensed photographs near it and download them into <work>/photos/<view id>/.
// sources.json in each folder is the attribution record. See README.md for the rules.
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, paths } from './lib/work.mjs';
import { viewGeo } from './lib/geo.mjs';
import { makeFetcher, BASE_HEADERS } from './lib/http.mjs';
import { rankCandidates } from './lib/rank.mjs';
import * as commons from './lib/sources/commons.mjs';
import * as mapillary from './lib/sources/mapillary.mjs';

export async function main(o, { log = console.log, fetchImpl } = {}) {
  const scene = readJson(o.scene), spec = readJson(o.views), P = paths(o.work), only = (o.only || '').split(',').filter(Boolean);
  const radius = +(o.radius || 80), widen = o['no-widen'] ? 0 : +(o.widen || 150), perView = +(o['per-view'] || 6);
  const token = process.env.MAPILLARY_TOKEN, sources = [commons, ...(mapillary.enabled() ? [mapillary] : [])];
  log(`sources: ${sources.map((s) => s.name).join(', ')}${mapillary.enabled() ? '' : ' (mapillary skipped: MAPILLARY_TOKEN not set)'}`);
  const fetcher = makeFetcher({ cacheDir: P.cache, offline: !!o.offline, fetchImpl, log });
  const summary = [];
  for (const v of spec.views.filter((x) => !only.length || only.includes(x.id))) {
    const view = { ...v, ...viewGeo(scene.georef, v) };
    let result = null, used = radius;
    for (const r of [radius, widen].filter((x, i) => x && (i === 0 || x > radius))) {
      const cands = [];
      for (const s of sources) for (const req of s.buildRequests(view, { radius: r, token })) {
        try {
          let json = await fetcher.getJson(req), next = s.nextRequest ? s.nextRequest(json, req) : null;
          for (let n = 0; next && n < 12; n++) { const more = await fetcher.getJson(next); json = s.mergeAnswers(json, more); next = s.nextRequest(more, next); }
          cands.push(...s.parse(json));
        } catch (e) { log(`  ${v.id}: ${s.name} failed: ${String(e.message).replace(token || '\0', '***')}`); }
      }
      result = rankCandidates(cands, view, { radius: r, perView }); used = r;
      if (result.kept.length) break;
      if (r === radius && widen > radius) log(`  ${v.id}: nothing within ${r} m, widening to ${widen} m`);
    }
    const dir = join(P.photos, v.id); mkdirSync(dir, { recursive: true });
    const photos = [];
    // walk down the ranked list until `perView` are downloaded (a candidate that cannot be fetched, or is not in the cache with --offline, is skipped)
    for (const c of result.ranked) {
      if (photos.length >= perView) break;
      const file = `${c.id}.${/png/i.test(c.mime) ? 'png' : 'jpg'}`;
      try { writeFileSync(join(dir, file), await fetcher.getBuffer({ url: c.downloadUrl, headers: { ...BASE_HEADERS } })); } catch (e) { log(`  ${v.id}: ${c.id} not downloaded: ${e.message}`); continue; }
      const { downloadUrl, ...rest } = c; photos.push({ file: `photos/${v.id}/${file}`, ...rest });
    }
    for (const f of readdirSync(dir)) if (f !== 'sources.json' && !photos.some((p) => p.file.endsWith('/' + f))) rmSync(join(dir, f));
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ view: v.id, lat: +view.lat.toFixed(6), lon: +view.lon.toFixed(6), headingTrue: +view.headingTrue.toFixed(1), radius: used, considered: result.considered, dropped: result.dropped, photos }, null, 1));
    const by = {}; for (const p of photos) by[p.licenceNorm] = (by[p.licenceNorm] || 0) + 1;
    const line = `${v.id}: ${photos.length} photographs within ${used} m (considered ${result.considered}; ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}; heading known on ${photos.filter((p) => Number.isFinite(p.heading)).length}; dropped ${JSON.stringify(result.dropped)})`;
    log(line); summary.push(line);
  }
  log(`requests: ${fetcher.stats.network} on the network, ${fetcher.stats.cached} from the cache`);
  return summary;
}
