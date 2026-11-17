// A polite fetcher: generic User-Agent only, at most 2 requests a second, every response cached on disk, retry on
// 429/503 with the server's own delay, an offline mode that reads the cache only.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const USER_AGENT = 'lookmatch/1 (open-source scene tool)';
export const BASE_HEADERS = Object.freeze({ 'User-Agent': USER_AGENT });

export function makeFetcher({ cacheDir, offline = false, minGapMs = 500, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  let last = 0; const stats = { network: 0, cached: 0 };
  const key = (url) => createHash('sha1').update(url).digest('hex');
  async function raw(req) {
    const path = join(cacheDir, key(req.url));
    if (existsSync(path)) { stats.cached++; return readFileSync(path); }
    if (offline) throw new Error('offline and not cached: ' + req.url.slice(0, 120));
    for (let attempt = 1; ; attempt++) {
      const wait = last + minGapMs - Date.now(); if (wait > 0) await sleep(wait);
      last = Date.now(); stats.network++;
      const res = await fetchImpl(req.url, { headers: req.headers || BASE_HEADERS });
      if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); writeFileSync(path, buf); return buf; }
      if ((res.status === 429 || res.status === 503) && attempt < 5) { const ra = +res.headers.get('retry-after'); const ms = (ra > 0 ? ra : 4 * attempt) * 1000; log(`HTTP ${res.status}, waiting ${ms / 1000}s`); await sleep(ms); last = Date.now(); continue; }
      throw new Error(`HTTP ${res.status} for ${req.url.slice(0, 120)}`);
    }
  }
  return { stats, getBuffer: raw, getJson: async (req) => JSON.parse((await raw(req)).toString('utf8')) };
}
