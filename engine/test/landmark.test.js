// Landmark looks (docs/plans/SCENE-DETAIL.md item 9). Pure generators, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { roof } from '../src/gen/roof.js';
import { landmarkNear, landmarkBase, lookOf, lookStyle } from '../src/gen/landmark.js';
import { vertices } from './helpers.js';

const style = resolveStyle({ looks: {
  wing: { course: { from: 1, every: 1, h: 0.3, out: 0.1, tint: '#d2c8ae' }, corbel: { h: 0.8, out: 0.4, steps: 3 }, oriel: { every: 10, w: 2, depth: 0.9, from: 1, floors: 2, rise: 2, minEdge: 8 },
    crest: { h: 0.5, w: 0.2 }, finial: { h: 2, w: 0.3 }, dormers: { width: 2 }, chimneys: { perBuilding: [3, 3] } },
  turret: { slits: { w: 0.6, h: 1.4, sill: 0.9, every: 2 }, finial: { h: 3, w: 0.3 }, course: { from: 1, every: 2, h: 0.3, out: 0.1 } } } });
const ring = [0, 0, 24, 0, 24, 12, 0, 12];
const wing = { id: 5, ring, holes: [], yBase: 10, hEave: 15, hRoof: 6, levels: 5, roofShape: 2, roofDir: 255, roofMat: 2, roofColor: null, facade: 3, tint: [0.4, 0.2, 0.1], blind: new Set(), front: new Set(), look: 'wing' };
const flat = (x, z) => 10; void flat;
const ground = () => 10;

test('a landmark look adds courses, corbels and oriels near, and cresting with finials in the base, only for a building with a look', () => {
  const plain = createSoups(); landmarkNear(plain, { ...wing, look: '' }, ground, style, null); assert.equal(plain.triangles(), 0);
  const near = createSoups(); landmarkNear(near, wing, ground, style, null);
  assert.ok(near.triangles() > 200 && near.triangles() < 9000, `${near.triangles()} triangles`);
  const ys = vertices(near).map((v) => v[1]); assert.ok(Math.min(...ys) > 10 && Math.max(...ys) < 10 + 15 + 6, 'everything is on the wall, below the roof top');
  const info = roof(createSoups(), wing, style), base = createSoups(); landmarkBase(base, wing, style, info);
  assert.ok(base.triangles() > 10);
  const top = 10 + 15 + 6; assert.ok(Math.max(...vertices(base).map((v) => v[1])) > top + 1.5, 'a finial stands above the ridge');
});
test('a look overrides the window bay, dormers and chimneys of the style for its building only', () => {
  const ls = lookStyle(style, lookOf(style, wing)); assert.equal(ls.dormers.width, 2); assert.deepEqual(ls.chimneys.perBuilding, [3, 3]);
  assert.equal(ls.window, style.window); assert.notEqual(style.dormers.width, 2); assert.equal(lookStyle(style, null), style);
});
test('a round turret gets slim windows on every second edge and a finial on its cone', () => {
  const r = []; for (let k = 0; k < 16; k++) r.push(5 + 3 * Math.cos((k / 16) * 2 * Math.PI), 5 + 3 * Math.sin((k / 16) * 2 * Math.PI));
  const t = { ...wing, ring: r, hEave: 10, hRoof: 8, roofShape: 7, levels: 3, look: 'turret' }, near = createSoups(); landmarkNear(near, t, ground, style, null);
  const glass = [...near.map].filter(([k]) => k.startsWith('window')).reduce((n, [, s]) => n + s.pos.length / 9, 0); assert.equal(glass, 8 * 3 * 2, 'eight edges, three storeys, two triangles');
  const info = roof(createSoups(), t, style), base = createSoups(); landmarkBase(base, t, style, info); assert.ok(Math.max(...vertices(base).map((v) => v[1])) > 10 + 10 + 8 + 1);
});


// ---- the château keys (landmark_roof.js): each adds geometry only when present ---------------------------------------
import { roofSeams, stacks, dormerTiers, bartizans, bellCone, SEAM_CAP } from '../src/gen/landmark_roof.js';
import { BELL } from '../src/gen/roof.js';

const KEYS = {
  base: { storeys: 1, material: 'stone_rubble', color: '#b3ad9f' },
  roof: { seams: 0.6, battens: true, ridgeDark: 0.25, streaks: 0.3 },
  dormers: { tiers: 2, spacing: 3.2, width: 1.3, height: 2.2, gable: 'steep', finial: true },
  stacks: { count: [6, 10], height: 4.5, width: 1.4, depth: 0.9, capColor: '#a9a498' },
  turret: { bellcast: 0.35, finial: 1.2, eaveBand: true },
  crown: { corbel: 0.6, parapetTurrets: 4, cresting: true, above: 10 },
};
const plain = { course: { from: 1, every: 1, h: 0.3, out: 0.1 }, corbel: { h: 0.8, out: 0.4, steps: 3 }, crest: { h: 0.5, w: 0.2 }, finial: { h: 2, w: 0.3 } };
const kstyle = (extra) => resolveStyle({ looks: { plain, full: { ...plain, ...extra }, 'tur': { ...plain, ...(extra || {}) } } });
const big = { ...wing, ring: [0, 0, 40, 0, 40, 16, 0, 16], hEave: 24, hRoof: 14, levels: 7, roofColor: [0.12, 0.3, 0.24], id: 77 };
const draw = (b, look, st) => { const info = roof(createSoups(), b, st); const n = createSoups(), s = createSoups(); landmarkNear(n, b, ground, st, info); landmarkBase(s, b, st, info); return { n, s, info }; };
const dump = (soups) => JSON.stringify([...soups.map].map(([k, s]) => [k, s.pos]));
const tris = (r) => r.n.triangles() + r.s.triangles();

test('a look without the château keys draws exactly as before', () => {
  const st = kstyle({}), a = draw({ ...big, look: 'plain' }, 'plain', st), b2 = draw({ ...big, look: 'full' }, 'full', st);
  assert.equal(dump(a.n), dump(b2.n)); assert.equal(dump(a.s), dump(b2.s));
});
test('every key adds geometry, and only when present', () => {
  const st0 = kstyle({}), base = tris(draw({ ...big, look: 'full' }, 'full', st0));
  for (const k of Object.keys(KEYS)) {
    const st = kstyle({ [k]: KEYS[k] }), r = draw({ ...big, look: 'full' }, 'full', st);
    if (k === 'turret') continue; // a cone-roof key: tested on a round turret below
    assert.ok(tris(r) > base, `${k} adds triangles (${tris(r)} vs ${base})`);
  }
});
test('batten strips lie on their roof plane, run up the slope, and the cap holds', () => {
  const st = kstyle({ roof: KEYS.roof }), b = { ...big, look: 'full' }, info = roof(createSoups(), b, st), S = createSoups();
  const res = roofSeams(S, b, st.looks.full, info); assert.ok(res.seams > 50 && res.seams <= SEAM_CAP, `${res.seams} seams`);
  const sv = S.get('roof_zinc|tv'), P = info.planes.filter((p) => p.length >= 3);
  const planeDist = (pt) => Math.min(...P.map((pl) => { const a = pl[0], b2 = pl[1], c = pl[2]; const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n); return l < 1e-6 ? Infinity : Math.abs(((pt[0] - a[0]) * n[0] + (pt[1] - a[1]) * n[1] + (pt[2] - a[2]) * n[2]) / l); }));
  let worst = 0; for (let i = 0; i < sv.pos.length; i += 9 * 40) { for (let k = 0; k < 3; k++) worst = Math.max(worst, 0); const pt = [sv.pos[i], sv.pos[i + 1], sv.pos[i + 2]]; worst = Math.max(worst, planeDist(pt)); }
  assert.ok(worst < 0.06, `strips within 6 cm of a plane (${worst})`);
  // a batten runs up the slope: its long axis has a steep vertical share on a steep plane
  const first = [sv.pos[0], sv.pos[1], sv.pos[2]], farthest = (() => { let m = 0, q = first; for (let i = 0; i < 36; i += 3) { const d = Math.hypot(sv.pos[i] - first[0], sv.pos[i + 1] - first[1], sv.pos[i + 2] - first[2]); if (d > m) { m = d; q = [sv.pos[i], sv.pos[i + 1], sv.pos[i + 2]]; } } return q; })();
  assert.ok(Math.abs(farthest[1] - first[1]) > 1, 'the first batten climbs the slope');
  const tight = roofSeams(createSoups(), b, { roof: { seams: 0.05, battens: true } }, info); assert.ok(tight.seams <= SEAM_CAP && tight.spacing > 0.05, `cap held at ${tight.seams}, spacing widened to ${tight.spacing}`);
});
test('landmark roofs: planes only for a building with a look; slots carry run and hip', () => {
  const st = kstyle({}), withL = roof(createSoups(), { ...big, look: 'full' }, st), without = roof(createSoups(), { ...big, look: '' }, st);
  assert.ok(withL.planes.length >= 4); assert.equal(without.planes, undefined); assert.ok(withL.slots.every((s) => s.run > 0 && s.hip === 1));
  assert.deepEqual(withL.ridge, without.ridge);
});
test('dormer tiers stay under the ridge, apart from each other, and bear a finial', () => {
  const st = kstyle({ dormers: KEYS.dormers }), b = { ...big, look: 'full' }, info = roof(createSoups(), b, st), S = createSoups();
  const out = dormerTiers(S, b, st.looks.full, info, [0.5, 0.5, 0.5]); assert.ok(out.length >= 8, `${out.length} dormers`);
  assert.ok(new Set(out.map((d) => d.tier)).size === 2);
  for (const d of out) { const sl = d.sl; assert.ok(d.r1 <= sl.run - 0.4, 'the back of a dormer stays below the ridge'); assert.ok(d.u0 > 0 && d.u1 < sl.len); }
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) { const a = out[i], c = out[j]; if (a.slot !== c.slot) continue; assert.ok(a.u1 <= c.u0 || c.u1 <= a.u0 || a.r1 <= c.r0 || c.r1 <= a.r0, 'no two dormers overlap'); }
  assert.ok(S.get('metal|tv').pos.length > 0, 'finials');
  assert.equal(dormerTiers(createSoups(), b, { dormers: { width: 1 } }, info, [1, 1, 1]).length, 0, 'no tiers key, none drawn');
  assert.equal(lookStyle(st, st.looks.full).dormers.gabled, 0, 'the façade single row is replaced');
});
test('bell-cast rings narrow monotonically, flare past the wall, and a tall finial carries a ball', () => {
  assert.ok(BELL.every(([t], i) => i === 0 || t > BELL[i - 1][0]));
  const rings = bellCone(createSoups().get('roof_zinc|tv'), 0, 0, 3, 10, 8, 0.35, null, 12);
  for (let i = 1; i < rings.length; i++) assert.ok(rings[i].r < rings[i - 1].r && rings[i].y > rings[i - 1].y, 'radius falls as the cone rises'); assert.ok(rings[0].r > 3, 'the eave flares out');
  const r = []; for (let k = 0; k < 16; k++) r.push(5 + 3 * Math.cos((k / 16) * 2 * Math.PI), 5 + 3 * Math.sin((k / 16) * 2 * Math.PI));
  const st = resolveStyle({ looks: { t: { ...plain, turret: KEYS.turret } } }), t = { ...wing, ring: r, hEave: 10, hRoof: 8, roofShape: 7, levels: 3, look: 't', roofColor: [0.1, 0.3, 0.2] };
  const info = roof(createSoups(), t, st), flat = roof(createSoups(), { ...t, look: '' }, st);
  const rx = []; for (const s of createSoups().map) void s; const R = createSoups(); roof(R, t, st);
  const xs = vertices(R).map((v) => Math.hypot(v[0] - 5, v[2] - 5)); assert.ok(Math.max(...xs) > 3.3, 'the eave reaches 0.35 m past the wall'); assert.ok(info.ridge.length === 1 && flat.ridge.length === 1);
  const A = createSoups(); landmarkBase(A, t, st, info); assert.ok(Math.max(...vertices(A).map((v) => v[1])) > 10 + 10 + 8 + 1.1, 'finial 1.2 m');
  const near = createSoups(); landmarkNear(near, t, ground, st, info); const glass = [...near.map].filter(([k]) => k.startsWith('window')).reduce((n, [, s]) => n + s.pos.length / 9, 0); assert.ok(glass > 0, 'the eave band has windows');
});
test('bartizans sit at the four corners of a tall part, and stacks stand on the ridge', () => {
  const st = kstyle({ crown: KEYS.crown, stacks: KEYS.stacks }), b = { ...big, look: 'full' }, S = createSoups(), cs = bartizans(S, b, st.looks.full);
  assert.equal(cs.length, 4); const corners = [[0, 0], [40, 0], [40, 16], [0, 16]];
  for (const c of corners) assert.ok(cs.some(([x, z]) => Math.hypot(x - c[0], z - c[1]) < 1), `a bartizan at ${c}`);
  assert.equal(bartizans(createSoups(), { ...b, hEave: 2, hRoof: 2 }, st.looks.full).length, 0, 'a low part has no crown');
  const info = roof(createSoups(), b, st), sk = stacks(createSoups(), b, st.looks.full, info, st); assert.ok(sk.length >= 3);
  const [p, q] = info.ridge;
  for (const k of sk) { const t = ((k.x - p.x) * (q.x - p.x) + (k.z - p.z) * (q.z - p.z)) / ((q.x - p.x) ** 2 + (q.z - p.z) ** 2); assert.ok(t >= 0 && t <= 1 && Math.abs(k.y - p.y) < 0.01 && Math.abs(k.top - k.y - 4.5) < 0.01); const cx = p.x + (q.x - p.x) * t, cz = p.z + (q.z - p.z) * t; assert.ok(Math.hypot(k.x - cx, k.z - cz) < 0.01, 'on the ridge line'); }
});
test('the stone base faces the ground storey and every v soup has a colour per vertex; all deterministic', () => {
  const st = kstyle({ base: KEYS.base, roof: KEYS.roof, dormers: KEYS.dormers, stacks: KEYS.stacks, crown: KEYS.crown }), b = { ...big, look: 'full' };
  const r1 = draw(b, 'full', st), r2 = draw(b, 'full', st);
  assert.equal(dump(r1.n), dump(r2.n)); assert.equal(dump(r1.s), dump(r2.s));
  const rub = r1.n.get('stone|tv'); assert.ok(rub.pos.length > 0); const ys = []; for (let i = 1; i < rub.pos.length; i += 3) ys.push(rub.pos[i]);
  assert.ok(Math.min(...ys) >= 10 - 1e-6 && Math.max(...ys) < 10 + 24 / 7 + 0.2, 'the stone stays within the ground storey and its band');
  for (const set of [r1.n, r1.s]) for (const [key, s] of set.map) if (/\|[a-z]*v/.test(key)) assert.equal(s.col.length, s.pos.length, key);
});
