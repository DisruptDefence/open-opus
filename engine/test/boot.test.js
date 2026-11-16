// The loading screen's arithmetic (host/boot.js): phase weighting, creep, monotonic easing, stalls, words, byte progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, easeStep, formatElapsed, formatBytes, resolveWords, fetchJsonProgress, PHASES, STEP_IDS } from '../host/boot.js';
import { DEFAULT_PACK } from '../src/content/default.js';

const total = PHASES.reduce((a, p) => a + p.w, 0);

test('a phase with numbers moves the bar by its weight', () => {
  const m = createModel();
  m.report('download', 50, 100, 0, 'bytes');
  assert.ok(Math.abs(m.value(0) - (3 * 0.5) / total) < 1e-9);
  m.report('download', 100, 100, 0);
  assert.ok(Math.abs(m.value(0) - 3 / total) < 1e-9);
});

test('opening a later phase skips the unopened ones and settles the ones without numbers; the bar never goes back', () => {
  const m = createModel();
  m.start('renderer', 0); // download never opened -> dropped from the sum
  assert.equal(m.phases[0].state, 'skipped');
  const a = m.value(0); m.start('materials', 100); m.start('scene', 200); // textures never seen: dropped
  assert.equal(m.phases.find((p) => p.id === 'textures').state, 'skipped');
  assert.equal(m.phases.find((p) => p.id === 'materials').state, 'done');
  let last = a; for (let t = 200; t < 20000; t += 250) { const v = m.value(t); assert.ok(v >= last, `went back at ${t}`); last = v; }
  assert.ok(last < 1);
});

test('a phase that reported real numbers is not forced complete by a later phase, and a late report revives a skipped one', () => {
  const m = createModel();
  m.report('textures', 2, 10, 0); m.start('scene', 10);
  assert.equal(m.phases.find((p) => p.id === 'textures').state, 'active');
  const m2 = createModel(); m2.start('scene', 0); assert.equal(m2.phases.find((p) => p.id === 'textures').state, 'skipped');
  m2.report('textures', 1, 4, 5); assert.equal(m2.phases.find((p) => p.id === 'textures').state, 'active');
});

test('without numbers a phase creeps but stays under 90%; finish() is 1', () => {
  const m = createModel(); m.start('light', 0);
  const f = (t) => m.fraction(m.phases.find((p) => p.id === 'light'), t);
  assert.ok(f(1000) > 0 && f(1000) < f(5000) && f(1e7) < 0.9 + 1e-9);
  m.finish(10); assert.equal(m.value(10), 1);
});

test('the value is monotonic even when a dropped phase is revived', () => {
  const m = createModel(); m.start('scene', 0); m.report('terrain', 5, 10, 1);
  const before = m.value(1); m.report('textures', 0, 10, 2); // adds weight back: the sum would fall
  assert.ok(m.value(2) >= before);
});

test('a host phase is placed after another and ticks sit on the phase boundaries', () => {
  const m = createModel(); m.add({ id: 'phone', weight: 2, after: 'light' });
  assert.equal(m.phases.at(-1).id, 'phone');
  const ticks = m.ticks(); assert.equal(ticks.length, m.phases.length - 1);
  assert.ok(Math.abs(ticks[0] - 3 / (total + 2)) < 1e-9);
  m.report('phone', 1, 2, 0); m.finish(0); assert.equal(m.value(0), 1);
});

test('stalled: only real events reset the quiet time, the creep does not', () => {
  const m = createModel({ stallMs: 6000 }); m.start('light', 1000);
  assert.equal(m.stalled(5000), false); assert.equal(m.stalled(7001), true);
  m.report('terrain', 1, 10, 7500); assert.equal(m.stalled(8000), false);
  m.report('terrain', 1, 10, 9000); assert.equal(m.quietFor(9000), 1500); // the same numbers again are not news
});

test('easing: forward only, never past the target, always arrives', () => {
  let s = 0; const target = 0.6;
  for (let i = 0; i < 600; i++) { const n = easeStep(s, target, 1 / 60); assert.ok(n >= s && n <= target); s = n; }
  assert.ok(Math.abs(s - target) < 1e-6);
  assert.equal(easeStep(0.8, 0.5, 0.016), 0.8); // a lower target does not pull it back
  assert.ok(easeStep(0.5, 0.5001, 1) === 0.5001); // tiny gaps close at once
  assert.ok(easeStep(0, 1, 1 / 60) > 0.03 / 60 - 1e-12); // a minimum speed, so the last stretch does not crawl
});

test('formats', () => {
  assert.equal(formatElapsed(0), '0:00'); assert.equal(formatElapsed(65400), '1:05');
  assert.equal(formatBytes(900), '900 B'); assert.equal(formatBytes(2048), '2 kB'); assert.equal(formatBytes(5 * 1048576), '5.0 MB');
});

test('every engine step label and every phase has words in English and French', () => {
  for (const lang of ['en', 'fr']) {
    const w = resolveWords(DEFAULT_PACK.loader, lang);
    for (const p of PHASES) assert.ok(w.phases[p.id], `${lang}: ${p.id}`);
    assert.ok(w.phases.phone && w.error && w.retry && w.slow && w.tips.length, lang);
  }
  assert.ok(Object.values(STEP_IDS).every((id) => PHASES.some((p) => p.id === id)));
  assert.notEqual(resolveWords(DEFAULT_PACK.loader, 'fr').phases.terrain, resolveWords(DEFAULT_PACK.loader, 'en').phases.terrain);
  assert.equal(resolveWords(DEFAULT_PACK.loader, 'de-CH').retry, 'Retry'); // unknown language falls back to English
  assert.equal(resolveWords(DEFAULT_PACK.loader, 'en', { phases: { terrain: 'X' } }).phases.terrain, 'X');
});

test('byte progress: by Content-Length when known, unknown when compressed or absent, and the JSON comes back', async () => {
  const body = JSON.stringify({ a: 'x'.repeat(5000) }), bytes = new TextEncoder().encode(body);
  const mk = (headers) => async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.slice(i, i + 1000)); c.close(); } }), { headers });
  let seen = [];
  assert.deepEqual(await fetchJsonProgress('u', (g, t) => seen.push([g, t]), mk({ 'content-length': String(bytes.length) })), JSON.parse(body));
  assert.ok(seen.length > 3 && seen.every(([g, t]) => t === bytes.length && g <= t));
  seen = []; await fetchJsonProgress('u', (g, t) => seen.push([g, t]), mk({}));
  assert.equal(seen[0][1], 0); assert.equal(seen.at(-1)[1], bytes.length); // unknown while it streams, the size at the end
  seen = []; await fetchJsonProgress('u', (g, t) => seen.push([g, t]), mk({ 'content-length': '300', 'content-encoding': 'gzip' }));
  assert.equal(seen[0][1], 0);
  await assert.rejects(fetchJsonProgress('u', () => {}, async () => new Response('no', { status: 404 })), /404/);
});
