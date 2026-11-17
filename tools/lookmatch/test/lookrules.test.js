import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { measureImage, regions, labField, MASK, usable, textureOf } from '../lib/measure.mjs';
import { emd, mad, median, kmeans3w } from '../lib/stats.mjs';
import { noiseFloors, framingMatch, materialMismatch, materialSentence, groupOf, METRICS, referenceItems, referenceOf, flat } from '../lib/compare.mjs';
import { guard, applyGuard, gapSum, lightGap, changedKeys } from '../lib/guard.mjs';
import { splitGaps, gapsDocument, infoSigns, buildReport } from '../lib/report.mjs';
import { dropReason, rankCandidates, yearOf, MEDIUM_WORDS, SUBJECT_WORDS } from '../lib/rank.mjs';
import { propose } from '../lib/proposal.mjs';
import { main as reportMain } from '../report.mjs';
import { resolveLook } from '../../../engine/src/core/atmosphere.js';
import { image } from './helpers.js';

const noise = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const shareOf = (img, w, h) => { const f = labField(img, w, h), { mask } = regions(f, w, h); const c = [0, 0, 0]; for (const m of mask) c[m]++; return { wall: c[0] / (w * h), sky: c[1] / (w * h), ground: c[2] / (w * h), mask }; };

// ---- F: regions
test('F sky: a dim grey-blue sky (L* about 35, far below the old fixed 55) is found, the lit wall below is not', () => {
  const w = 80, h = 60, img = image(w, h, (x, y) => (y < 24 ? [66 + y / 4, 76 + y / 4, 98 + y / 4] : y >= 44 ? [120, 120, 120] : (x + y) % 2 ? [200, 160, 110] : [120, 80, 50]));
  const s = shareOf(img, w, h); assert.ok(Math.abs(s.sky - 0.4) < 0.04, 'sky ' + s.sky); assert.ok(s.ground > 0.2);
});
test('F sky: a cloudy sky with dark, bluish cloud bases is one sky, and a roof against it is not', () => {
  const w = 80, h = 60, img = image(w, h, (x, y) => {
    if (y >= 34) return y >= 46 ? [128, 128, 128] : (x + y) % 2 ? [190, 120, 80] : [90, 30, 20];
    const base = Math.max(0, 1 - Math.abs(y - 16) / 14); // a band of dark cloud base, 14 rows each side: gradual (under 4 L* a row)
    const k = 1 - 0.65 * base; return [Math.round(215 * k), Math.round(222 * k), Math.round(238 * k)];
  });
  const s = shareOf(img, w, h); assert.ok(Math.abs(s.sky - 34 / 60) < 0.06, 'sky ' + s.sky); assert.equal(s.mask[16 * w + 40], MASK.sky, 'the dark cloud base itself'); assert.equal(s.mask[40 * w + 40], MASK.wall);
});
test('F sky: stops at a strong edge, and a bright warm wall touching the top edge is not sky', () => {
  const w = 60, h = 40, a = shareOf(image(w, h, (x, y) => (y < 14 ? [160, 190, 235] : [225, 200, 160])), w, h); assert.ok(Math.abs(a.sky - 0.35) < 0.04, 'sky ' + a.sky);
  const b = shareOf(image(w, h, (x, y) => (x < 30 ? [160, 190, 235] : [230, 205, 165])), w, h); assert.ok(Math.abs(b.sky - 0.5) < 0.04, 'only the blue half: ' + b.sky);
});
test('F ground: a stone wall above grey paving is walls; the paving is ground', () => {
  const w = 80, h = 60, img = image(w, h, (x, y) => {
    if (y < 10) return [150, 185, 235];
    if (y < 40) { const v = 95 + Math.round(noise(x, y) * 70), j = Math.floor(x / 4) % 2 ? 22 : 0; return [v + 6 - j, v - j, v - 8 - j]; } // speckled grey stone, vertical courses
    return [125 + Math.round(noise(x >> 3, y >> 3) * 6), 125, 125];
  });
  const s = shareOf(img, w, h); assert.ok(s.ground > 0.28 && s.ground < 0.36, 'ground ' + s.ground); assert.ok(s.wall > 0.45, 'walls ' + s.wall); assert.equal(s.mask[20 * w + 40], MASK.wall); assert.equal(s.mask[55 * w + 40], MASK.ground);
});
test('F ground: a wall with window reveals (vertical edges) that touches grey ground does not leak into it', () => {
  const w = 80, h = 60, img = image(w, h, (x, y) => (y < 10 ? [150, 185, 235] : y < 36 ? (x % 8 < 2 ? [60, 60, 62] : [128, 126, 124]) : [128, 128, 128]));
  const s = shareOf(img, w, h); assert.ok(s.ground < 0.45 && s.ground > 0.35, 'ground ' + s.ground);
});

// ---- E: references
test('E usable: a posterised, very smooth picture is a painting or scan; a sepia picture is a print; a close-up is not a street', () => {
  const w = 80, h = 60;
  const poster = measureImage(image(w, h, (x, y) => (y < 20 ? [170, 200, 230] : y < 40 ? [200, 90, 60] : [90, 140, 80])), w, h).numbers;
  assert.ok(poster.texture.hf < 4 && poster.texture.palette < 30); assert.match(usable(poster), /painting or scan/);
  const sepia = measureImage(image(w, h, (x, y) => { const v = 90 + Math.round(noise(x, y) * 110); return [v, Math.round(v * 0.82), Math.round(v * 0.58)]; }), w, h).numbers; assert.match(usable(sepia), /sepia/);
  const grain = measureImage(image(w, h, (x, y) => (y < 20 ? [150, 185, 235] : [90 + Math.round(noise(x, y) * 80), 110 + Math.round(noise(y, x) * 60), 100 + Math.round(noise(x + 7, y) * 60)])), w, h).numbers; assert.equal(usable(grain), null, 'a grainy colour photograph is kept');
  const close = measureImage(image(w, h, (x, y) => [120 + (x % 7) * 15, 90 + (y % 5) * 10, 60]), w, h).numbers; assert.match(usable(close), /close-up/);
  assert.ok(textureOf(labField(image(w, h, () => [100, 100, 100]), w, h), w, h).hf === 0);
});
test('E metadata: painting, drawing, engraving, map, plan, postcard (English and French) and old-work templates reject by the data word list', () => {
  const v = { lat: 10, lon: 20, headingTrue: 0 }, c = (o) => ({ id: 'x', title: 'A street', licence: 'CC0', mime: 'image/jpeg', width: 1600, height: 1000, lat: 10, lon: 20, date: '2020-06-01', ...o });
  for (const t of ['Watercolour of the harbour', 'Aquarelle du port', 'Peinture murale', 'Old engraving', 'Gravure ancienne', 'Map of the district', 'Plan de la ville', 'Carte postale 1910', 'Postcard', 'Lithograph', 'Dessin au crayon', 'Etching']) assert.equal(dropReason(c({ title: t }), v, 80), 'medium', t);
  for (const cat of ['PD-old-70-expired|x', 'Quebec City in art']) assert.equal(dropReason(c({ categories: cat }), v, 80), 'medium', cat);
  assert.equal(dropReason(c({ description: 'a drawing room' }), v, 80), 'medium'); assert.equal(dropReason(c({ title: 'Planter street' }), v, 80), null, 'a stem, not a substring');
  assert.ok(MEDIUM_WORDS.test('gravure') && !MEDIUM_WORDS.test('interior') && SUBJECT_WORDS.test('interior'));
  const src = readFileSync(new URL('../lib/rank.mjs', import.meta.url), 'utf8'); assert.ok(!/watercolo|gravure|postcard/.test(src), 'the words live in lib/data, not in code');
});
test('E date: before 1990 is rejected unless nothing else exists; the year is read from free text', () => {
  const v = { lat: 10, lon: 20, headingTrue: 0 }, c = (id, o) => ({ id, title: 'Street ' + id, licence: 'CC0', mime: 'image/jpeg', width: 1600, height: 1000, lat: 10, lon: 20, date: '2020-06-01', ...o });
  assert.equal(yearOf('between 1836 and 1841date QS:P,+1850'), 1836); assert.equal(yearOf('2019-08-01 10:00:00'), 2019); assert.equal(yearOf(''), null);
  assert.equal(dropReason(c('a', { date: 'between 1836 and 1841' }), v, 80), 'old'); assert.equal(dropReason(c('b', { date: '1991-05-01' }), v, 80), null); assert.equal(dropReason(c('c', { date: '1989-05-01' }), v, 80), 'old');
  const both = rankCandidates([c('old', { date: '1960-01-01' }), c('new')], v); assert.deepEqual(both.kept.map((x) => x.id), ['new']); assert.equal(both.dropped.old, 1);
  const only = rankCandidates([c('old', { date: '1960-01-01' })], v); assert.deepEqual(only.kept.map((x) => x.id), ['old']); assert.equal(only.kept[0].oldFallback, true);
});
test('E framing: sky and ground share each within a factor of 2 of the render\'s', () => {
  const n = (sky, ground) => ({ shares: { sky, ground, walls: 1 - sky - ground } }), r = n(0.2, 0.3);
  assert.equal(framingMatch(n(0.3, 0.2), r), true); assert.equal(framingMatch(n(0.45, 0.3), r), false, 'too much sky'); assert.equal(framingMatch(n(0.2, 0.1), r), false, 'too little ground');
  assert.equal(framingMatch(n(0.02, 0.3), n(0.04, 0.3)), true, 'tiny shares are floored at 3 %'); assert.equal(framingMatch(null, r), null);
  const num = (sky, ground, L) => ({ framing: 'ok', shares: { sky, ground, walls: 0.5 }, regions: { walls: { L }, sky: null, ground: null } });
  const photos = [{ id: 'a', numbers: num(0.2, 0.3, 40), match: true }, { id: 'b', numbers: num(0.25, 0.3, 50), match: true }, { id: 'c', numbers: num(0.8, 0.0, 99), match: false }];
  assert.deepEqual(referenceOf(photos).ids, ['a', 'b'], 'with two matches only they count'); assert.equal(referenceOf(photos).values['walls.L'], 45);
  assert.deepEqual(referenceOf(photos.slice(1)).ids, ['b', 'c'], 'with fewer than two matches all count'); assert.equal(referenceItems(photos.slice(1)).find((i) => i.e.id === 'c').w, 0.5);
});
// ---- A: noise floors
test('A noise floor: the median over views of the median absolute deviation across a view\'s photographs', () => {
  assert.equal(mad([1, 2, 3, 4, 100]), 1); assert.ok(Number.isNaN(mad([5]))); assert.equal(median([1, 3, 2]), 2);
  const n = (L) => ({ framing: 'ok', shares: { sky: 0.2, ground: 0.3, walls: 0.5 }, regions: { walls: { L }, sky: null, ground: null } });
  const view = (Ls) => ({ photos: Ls.map((L, i) => ({ id: 'p' + i, numbers: n(L) })) });
  const fl = noiseFloors([view([40, 42, 44]), view([50, 56, 62]), view([10]), view([30, 30, 30])]);
  assert.equal(fl['walls.L'], 2, 'MADs 2, 6 and 0 (the one-photograph view is skipped): median 2'); assert.equal(fl['sky.L'], null);
});
// ---- D: material
test('D earth mover\'s distance on a*, b* between weighted colour sets', () => {
  const d = (p, q) => Math.hypot(p.a - q.a, p.b - q.b);
  assert.equal(+emd([{ w: 1, a: 0, b: 0 }], [{ w: 1, a: 3, b: 4 }], d).toFixed(6), 5); assert.equal(emd([{ w: 1, a: 1, b: 1 }], [{ w: 5, a: 1, b: 1 }], d), 0);
  assert.equal(+emd([{ w: 0.5, a: 0, b: 0 }, { w: 0.5, a: 10, b: 0 }], [{ w: 1, a: 5, b: 0 }], d).toFixed(6), 5);
  assert.equal(+emd([{ w: 0.7, a: 0, b: 0 }, { w: 0.3, a: 10, b: 0 }], [{ w: 0.3, a: 0, b: 0 }, { w: 0.7, a: 10, b: 0 }], d).toFixed(6), 4); assert.ok(Number.isNaN(emd([], [{ w: 1 }], d)));
  assert.equal(kmeans3w([{ p: [0, 0, 0], w: 1 }, { p: [0.1, 0, 0], w: 1 }, { p: [50, 0, 0], w: 2 }], 2).length, 2);
});
const withDom = (cols) => ({ framing: 'ok', shares: { sky: 0.2, ground: 0.3, walls: 0.5 }, regions: { walls: { L: 50 } }, colourfulness: { dominant: cols.map(([L, a, b, share]) => ({ L, a, b, hex: '#888888', share })) } });
test('D material mismatch: same wall hues give ~0, different hue gives a large score, lightness is left out', () => {
  const ph = (cols) => [{ id: 'p', numbers: withDom(cols) }];
  const warm = [[60, 12, 20, 0.6], [40, 8, 12, 0.4]];
  assert.ok(materialMismatch(ph(warm), withDom(warm)).mismatch < 0.01);
  assert.ok(materialMismatch(ph(warm), withDom([[30, 12, 20, 0.6], [80, 8, 12, 0.4]])).mismatch < 0.01, 'only lightness differs');
  const far = materialMismatch(ph(warm), withDom([[60, -5, -10, 1]])); assert.ok(far.mismatch > 20, String(far.mismatch)); assert.equal(far.render.length, 1); assert.ok(far.reference.length >= 1);
  assert.equal(materialMismatch(ph(warm), null), null);
  const txt = materialSentence('v1', materialMismatch(ph([[60, 20, 25, 1]]), withDom([[60, 4, 8, 1]])));
  assert.match(txt, /^Walls in the photographs of view v1 are redder and yellower and more saturated: dominant colours #[0-9a-f]{6} \(100 %\); the render's: #888888 \(100 %\)/);
});
test('D groups: light, material, info, framing; the two lists are disjoint and cover wall hue/chroma on the material side', () => {
  assert.equal(groupOf('walls.chroma'), 'material'); assert.equal(groupOf('ground.b'), 'material'); assert.equal(groupOf('busy.gradient'), 'material'); assert.equal(groupOf('colour.stdA'), 'material');
  assert.equal(groupOf('walls.L'), 'light'); assert.equal(groupOf('contrast'), 'light'); assert.equal(groupOf('surfaces.ratio'), 'light'); assert.equal(groupOf('sky.b'), 'light'); assert.equal(groupOf('sky.chroma'), 'light'); assert.equal(groupOf('surfaces.dark.L'), 'light');
  assert.equal(groupOf('surfaces.dark.b'), 'info'); assert.equal(groupOf('surfaces.lit.a'), 'info'); assert.equal(groupOf('share.sky'), 'framing'); assert.ok(METRICS.every((m) => ['light', 'material', 'info', 'framing'].includes(m.group)));
});
const mkView = (id, refO, rdO, material = null) => ({ id, what: '', photos: [], reference: { photos: 3, values: { 'walls.L': 50, 'ground.L': 50, 'walls.chroma': 20, 'walls.b': 10, 'sky.b': -10, 'surfaces.dark.b': -3, 'surfaces.lit.b': 6, 'surfaces.ratio': 0.5, contrast: 40, ...refO } }, render: { file: 'r.png', flat: { 'walls.L': 50, 'ground.L': 50, 'walls.chroma': 20, 'walls.b': 10, 'sky.b': -10, 'surfaces.dark.b': -3, 'surfaces.lit.b': 6, 'surfaces.ratio': 0.5, contrast: 40, ...rdO }, numbers: null }, material });
test('D split lists: light and material separately, material mismatch lines are actionable, shade and sun colour are information with the sentence', () => {
  const mat = { mismatch: 18, reference: [{ L: 50, a: 20, b: 25, hex: '#aa5533', share: 0.7 }], render: [{ L: 50, a: 4, b: 6, hex: '#887766', share: 1 }] };
  const views = [mkView('v1', { 'walls.L': 70, 'walls.b': 25, 'surfaces.dark.b': -9 }, {}, mat), mkView('v2', { 'surfaces.dark.b': 5 }, {})];
  const sp = splitGaps(views); assert.ok(sp.light.some((g) => g.key === 'walls.L') && !sp.light.some((g) => g.key === 'walls.b')); assert.ok(sp.material.some((g) => g.key === 'walls.b') && !sp.material.some((g) => g.key === 'walls.L'));
  assert.ok(sp.material.some((g) => /^Walls in the photographs of view v1 are/.test(g.text))); assert.ok(!sp.light.some((g) => g.key.startsWith('surfaces.dark')) && !sp.material.some((g) => g.key.startsWith('surfaces.dark')));
  assert.equal(infoSigns(views)['surfaces.dark.b'], 'signs differ');
  const md = gapsDocument({ split: sp, floors: { 'walls.L': 2 }, views }); assert.match(md, /## Light/); assert.match(md, /## Material and colour/); assert.match(md, /global tint cannot serve these when the signs differ/); assert.match(md, /v1: 18\.0 \(above 10/); assert.match(md, /walls\.L 2/);
  const html = buildReport({ title: 't', views, split: sp, floors: { 'walls.L': 2 }, proposal: { changes: [{ key: 'exposure', from: 1, to: 1, status: 'views disagree', evidence: 'x', reason: 'y' }] } }); assert.match(html, /Material and colour gaps/); assert.match(html, /views disagree/); assert.match(html, /Noise floors/);
});
// ---- C: guard
const mview = (L, extra = {}) => ({ id: 'v', reference: { values: { 'walls.L': 50, 'ground.L': 50, 'sky.chroma': 20, 'sky.a': 0, 'sky.b': -10, 'surfaces.ratio': 0.5, contrast: 40, 'walls.chroma': 20 } }, render: { flat: { 'walls.L': L, 'ground.L': L, 'sky.chroma': 20, 'sky.a': 0, 'sky.b': -10, 'surfaces.ratio': 0.5, contrast: 40, 'walls.chroma': 20, ...extra } } });
test('C guard: a changed key whose targeted gap grew is reverted and marked; one that shrank stays', () => {
  const look0 = resolveLook({ exposure: 1, curve: 0.3 }), look1 = { ...look0, exposure: 1.2, curve: 0.4 };
  const prev = { look: look0, views: [mview(40, { contrast: 30 })] }, cur = { views: [mview(46, { contrast: 25 })] };
  assert.deepEqual(changedKeys(look0, look1).sort(), ['curve', 'exposure']);
  const res = guard(prev, cur, look1), by = Object.fromEntries(res.map((r) => [r.key, r])); assert.equal(by.exposure.grew, false); assert.equal(by.curve.grew, true, 'contrast gap 10 -> 15');
  const prop = propose([{ id: 'v', reference: cur.views[0].reference.values, render: cur.views[0].render.flat }], look1, { floors: {} });
  const frozen = applyGuard(prop, res, look0); assert.deepEqual(frozen, ['curve']); const c = prop.changes.find((x) => x.key === 'curve'); assert.equal(c.to, 0.3); assert.match(c.reason, /reverted: made it worse/); assert.equal(prop.look.curve, 0.3);
  assert.equal(prop.changes.find((x) => x.key === 'exposure').status !== 'reverted', true);
});
test('C guard: a key that did not change is not judged; the light gap is the sum of normalised gaps', () => {
  const l = resolveLook({}); assert.deepEqual(guard({ look: l, views: [mview(40)] }, { views: [mview(60)] }, l), []);
  assert.ok(Math.abs(gapSum([mview(46)], ['walls.L', 'ground.L']).sum - (4 / 4 + 4 / 4)) < 1e-9); assert.ok(lightGap([mview(46)]) > 1);
});
test('C report --previous: reverts the worsened key in proposal.json, lists it as frozen, and writes both gap lists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lm-')), look0 = resolveLook({ curve: 0.3 }), look1 = { ...look0, curve: 0.4 };
  const views = (c) => [0, 1, 2, 3].map((i) => ({ ...mview(50, { contrast: c }), id: 'v' + i, photos: [] }));
  const mk = (c, look, round) => ({ scene: 's.json', round, look, floors: {}, materialThreshold: 10, views: views(c) });
  writeFileSync(join(dir, 'scene.json'), JSON.stringify({ id: 's', ambience: { look: { curve: 0.3 } } })); writeFileSync(join(dir, 'measure-r1.json'), JSON.stringify(mk(30, look1, 'r1'))); writeFileSync(join(dir, 'measure-r0.json'), JSON.stringify(mk(38, look0, 'r0'))); writeFileSync(join(dir, 'look.json'), JSON.stringify({ curve: 0.4 }));
  const p = reportMain({ scene: join(dir, 'scene.json'), work: dir, round: 'r1', look: join(dir, 'look.json'), previous: join(dir, 'measure-r0.json') }, { log: () => {} });
  const c = p.changes.find((x) => x.key === 'curve'); assert.equal(c.status, 'reverted'); assert.equal(p.look.curve, 0.3); assert.deepEqual(p.frozen, ['curve']); assert.equal(p.guard.find((g) => g.key === 'curve').grew, true);
  assert.match(readFileSync(join(dir, 'gaps-r1.md'), 'utf8'), /## Material and colour/); assert.ok(JSON.parse(readFileSync(join(dir, 'proposal-r1.json'), 'utf8')).noiseFloors);
  const p2 = reportMain({ scene: join(dir, 'scene.json'), work: dir, round: 'r1', look: join(dir, 'look.json'), frozen: 'curve' }, { log: () => {} }); assert.equal(p2.changes.find((x) => x.key === 'curve').status, 'frozen');
});
// ---- G
test('G the default work folder is .lookmatch/, git-ignored, and the README says so', () => {
  const root = new URL('../../../', import.meta.url), ig = readFileSync(new URL('.gitignore', root), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(ig.includes('.lookmatch/')); const readme = readFileSync(new URL('tools/lookmatch/README.md', root), 'utf8'); assert.match(readme, /default work folder is `\.lookmatch\/`/);
});
