import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildReport, topGaps, gapsMarkdown, attributionOf } from '../lib/report.mjs';
import { measureImage } from '../lib/measure.mjs';
import { flat, referenceOf } from '../lib/compare.mjs';
import { street } from './helpers.js';
import { makeFetcher } from '../lib/http.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const num = () => measureImage(street(), 80, 60).numbers;
const photo = (id, o = {}) => ({ id, file: `photos/v/${id}.jpg`, overlay: `overlays/v/${id}.png`, title: 'Title ' + id, pageUrl: `https://commons.example/wiki/File:${id}`, author: 'A. Author', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', distance: 4, headingDiff: null, numbers: num(), ...o });
const data = () => {
  const photos = [photo('a'), photo('b'), photo('c', { excluded: 'night' })], rn = num(); rn.regions.walls.L += 12;
  return [{ id: 'v', what: 'a view', photos, reference: referenceOf(photos), render: { file: 'renders/render-v.png', overlay: 'overlays/v/render.png', numbers: rn, flat: flat(rn) } }];
};
test('every photograph the report shows carries its author, licence with link, and page link', () => {
  const html = buildReport({ title: 't', views: data() });
  const figs = html.match(/<figure class="photo">[\s\S]*?<\/figure>/g); assert.equal(figs.length, 2, 'the excluded photograph is not shown');
  for (const f of figs) { assert.match(f, /A\. Author/); assert.match(f, /CC BY-SA 4\.0/); assert.match(f, /href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/"/); assert.match(f, /href="https:\/\/commons\.example\/wiki\/File:/); }
  assert.match(attributionOf(photo('z', { author: '' })), /author not given/);
});
test('the report is one self-contained file: relative images, no script, a CSS-only region toggle, escaped text', () => {
  const v = data(); v[0].photos[0].title = '<script>alert(1)</script>';
  const html = buildReport({ title: 't', views: v });
  assert.ok(!/<script/i.test(html)); assert.match(html, /<input type="checkbox" id="ov">/); assert.match(html, /#ov:checked ~ main \.ov/); assert.match(html, /src="photos\/v\/a\.jpg"/); assert.ok(!/src="\//.test(html) && !/src="https?:/.test(html));
});
test('the table marks the differences that matter and lists reference, render and difference', () => {
  const html = buildReport({ title: 't', views: data() });
  assert.match(html, /<tr class="big"><td>walls L\*<\/td>/); assert.match(html, /\+12\.00 ●/);
});
test('the ten largest gaps are ordered by size and written as sentences', () => {
  const top = topGaps(data()); assert.ok(top.length > 0 && top.length <= 10); assert.ok(top.every((g, i) => !i || g.size <= top[i - 1].size)); assert.match(top[0].text, /walls.* lighter than in the photographs/);
  assert.match(gapsMarkdown(top), /^# The ten largest gaps/);
});
test('the fetcher caches, never refetches, and --offline reads the cache only; headers pass through exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lm-')); let calls = 0, seen = null;
  const fetchImpl = async (url, o) => { calls++; seen = o.headers; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('{"a":1}') }; };
  const f = makeFetcher({ cacheDir: dir, fetchImpl, sleep: async () => {} });
  assert.deepEqual(await f.getJson({ url: 'https://x.example/a' }), { a: 1 }); await f.getJson({ url: 'https://x.example/a' }); assert.equal(calls, 1);
  assert.deepEqual(seen, { 'User-Agent': 'lookmatch/1 (open-source scene tool)' });
  const off = makeFetcher({ cacheDir: dir, offline: true, fetchImpl }); assert.deepEqual(await off.getJson({ url: 'https://x.example/a' }), { a: 1 }); await assert.rejects(off.getJson({ url: 'https://x.example/b' }), /offline/); assert.equal(calls, 1);
});
test('at most two requests a second and a retry on 429 with the server delay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lm-')); const waits = []; let n = 0;
  const fetchImpl = async () => (++n === 2 ? { ok: false, status: 429, headers: { get: () => '3' } } : { ok: true, status: 200, arrayBuffer: async () => Buffer.from('{}') });
  const f = makeFetcher({ cacheDir: dir, fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  await f.getJson({ url: 'https://x.example/1' }); await f.getJson({ url: 'https://x.example/2' });
  assert.ok(waits.some((w) => w > 0 && w <= 500), 'spaced by the minimum gap'); assert.ok(waits.includes(3000), 'waited the Retry-After'); assert.equal(n, 3);
});
function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
test('no file under tools/lookmatch/ writes the name of a place (the builder check scans tools/ for the same)', () => {
  const root = new URL('..', import.meta.url).pathname, dir = join(root, '../../places'), places = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = places.flatMap((p) => [p.id, p.name]).flatMap((w) => [fold(w), fold(w).replace('-', ' ')]).filter((w) => w.length >= 4); assert.ok(words.length);
  for (const f of walk(root)) { const t = fold(readFileSync(f, 'utf8')).replace(/_/g, '-'); for (const w of words) assert.ok(!t.includes(w), `${relative(root, f)} names ${w}`); }
});
