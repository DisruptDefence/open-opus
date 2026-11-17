// Façade dressing (src/gen/dressing.js): signs, lanterns, window boxes, door pots. Behaviour, not names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dressEdge, dressingLook } from '../src/gen/dressing.js';
import { facadeNear } from '../src/gen/facade.js';
import { createSoups, frame } from '../src/gen/soup.js';
import { resolveStyle, SOUP } from '../src/gen/style.js';
import { building } from './helpers.js';

const base = resolveStyle(), off = { signs: 0, lanterns: 0, boxes: 0, pots: 0 };
const all = { ...base.dressing, signs: 1, lanterns: 1, boxes: 1, pots: 1 };
const styled = (d) => ({ ...base, dressing: { ...base.dressing, ...d } });
// a wall along +x at z = 0, looking towards +z: u = x, d = z
const F = frame(0, 0, 1, 0), LEN = 10, Y0 = 5;
const ops0 = [{ kind: 'shop', u0: 0.6, u1: 3.0, ys: Y0 + 0.5, yh: Y0 + 2.3 }, { kind: 'door', u0: 3.6, u1: 4.6, ys: Y0, yh: Y0 + 2.1 }, { kind: 'shop', u0: 5.3, u1: 7.5, ys: Y0 + 0.5, yh: Y0 + 2.3 }];
const ops1 = [1.5, 4.5, 7.5].map((c) => ({ kind: 'win', u0: c - 0.5, u1: c + 0.5, ys: Y0 + 3.1 + 0.9, yh: Y0 + 3.1 + 2.4 }));
function dress(d, over = {}) {
  const st = styled(d), look = dressingLook(building([0, 0, 1, 0, 1, 1], { id: over.id ?? 7 }), st), soups = createSoups();
  const ctx = { ops: ops0, storey: 0, y0: Y0, sh: 3.1, len: LEN, front: true, shop: true, style: st, r: look.dr, colors: look.dcolors, hasBoxes: look.hasBoxes, groundY: () => Y0, ...over };
  delete ctx.id; dressEdge(soups, F, ctx); return soups;
}
const tris = (soups, key) => (soups.map.get(key) ? soups.map.get(key).pos.length / 9 : 0);
const verts = (soups, key) => { const s = soups.map.get(key), o = []; if (s) for (let i = 0; i < s.pos.length; i += 3) o.push([s.pos[i], s.pos[i + 1], s.pos[i + 2]]); return o; };
const allVerts = (soups) => [...soups.map.keys()].flatMap((k) => verts(soups, k));
const found = [];

test('the neutral default draws nothing, not even an empty soup', () => {
  assert.deepEqual(base.dressing.signs + base.dressing.lanterns + base.dressing.boxes + base.dressing.pots, 0);
  assert.equal(dress(off).map.size, 0);
  const a = createSoups(), b = createSoups(), c = createSoups(), RING = [0, 0, 10, 0, 10, 8, 0, 8], bd = () => building(RING, { front: new Set([0, 1, 2, 3]), groundFloor: 1 });
  const bare = { ...base }; delete bare.dressing;
  facadeNear(a, bd(), () => 30, base, { slots: [], ridge: [], parapet: 0 }); facadeNear(b, bd(), () => 30, bare, { slots: [], ridge: [], parapet: 0 });
  facadeNear(c, bd(), () => 30, styled({ ...off, flowers: ['#000000'] }), { slots: [], ridge: [], parapet: 0 });
  assert.deepEqual([...a.map.keys()], [...b.map.keys()]); assert.deepEqual([...a.map.keys()], [...c.map.keys()]);
  for (const [k, s] of a.map) { assert.deepEqual(s.pos, b.map.get(k).pos); assert.deepEqual(s.pos, c.map.get(k).pos); }
});

test('hanging sign: on a shop edge, 2.2 m or more above the floor, at most 0.9 m out, one per 5 m', () => {
  const s = dress({ ...off, signs: 1 }); found.push(['sign', allVerts(s).length / 3]);
  const v = allVerts(s); assert.ok(v.length > 0);
  assert.ok(Math.min(...v.map((p) => p[1])) >= Y0 + 2.2 - 1e-9, 'lowest point'); assert.ok(Math.max(...v.map((p) => p[2])) <= 0.9 + 1e-9);
  assert.ok(Math.min(...v.map((p) => p[0])) >= 0.4 - 0.05, 'clamped inside the wall');
  const barY = Y0 + 2.75; assert.ok(v.some((p) => Math.abs(p[1] - (barY + 0.015)) < 1e-9), 'the bracket bar is at 2.75 m');
  // shops at 0.6 and 5.3 are 4.65 m apart: one sign only (the bar ends at d 0.85, the board is 0.6 along d)
  assert.equal(new Set(verts(s, SOUP.iron).filter((p) => Math.abs(p[2] - 0.85) < 1e-9).map((p) => Math.round(p[0] * 10))).size <= 2, true);
});
test('a house without a shop hangs its sign at the door', () => {
  const s = dress({ ...off, signs: 1 }, { shop: false, ops: [{ kind: 'door', u0: 4, u1: 5, ys: Y0, yh: Y0 + 2.1 }] });
  assert.ok(tris(s, SOUP.iron) > 0); const xs = verts(s, SOUP.iron).map((p) => p[0]); assert.ok(Math.abs(Math.min(...xs) - 3.75) < 0.05);
});
test('wall lantern: every door has one within 0.5 m of its jamb', () => {
  const ops = [{ kind: 'door', u0: 1, u1: 2, ys: Y0, yh: Y0 + 2.1 }, { kind: 'door', u0: 6, u1: 7, ys: Y0, yh: Y0 + 2.1 }];
  const s = dress({ ...off, lanterns: 1 }, { ops, shop: false }), g = verts(s, SOUP.lampGlass); found.push(['lantern', tris(s, SOUP.iron) + tris(s, SOUP.lampGlass)]);
  assert.equal(g.length / 3 / 8, 2, 'two panes, 8 triangles each');
  for (const door of ops) {
    const own = g.filter((p) => Math.abs(p[0] - (door.u0 + door.u1) / 2) < 1.2), cx = (Math.min(...own.map((p) => p[0])) + Math.max(...own.map((p) => p[0]))) / 2;
    assert.ok(own.length > 0 && Math.min(Math.abs(cx - door.u0), Math.abs(cx - door.u1)) <= 0.5, `centre ${cx}`);
  }
  assert.ok(Math.max(...allVerts(s).map((p) => p[2])) <= 0.45);
});
test('window boxes: storey 1 windows of a house with boxes, the top within 3 cm of the sill', () => {
  const s = dress({ ...off, boxes: 1 }, { storey: 1, y0: Y0 + 3.1, ops: ops1 }), wood = verts(s, SOUP.timber);
  assert.equal(wood.length / 3, 3 * 10, 'one box a window'); found.push(['box', allVerts(s).length / 9 / 3]);
  for (const o of ops1) { const mine = wood.filter((p) => p[0] > o.u0 - 0.1 && p[0] < o.u1 + 0.1); assert.ok(Math.abs(Math.max(...mine.map((p) => p[1])) - o.ys) < 0.03, 'top at the sill'); }
  assert.ok(tris(s, SOUP.leaves + 'v') > 0 && tris(s, SOUP.trim) >= 3 * 5 * 8, 'green and 5 to 7 flowers a box');
  assert.equal(dress({ ...off, boxes: 1 }, { storey: 1, y0: Y0 + 3.1, ops: ops1, hasBoxes: false }).map.size, 0, 'a house without boxes has none');
  const n = Array.from({ length: 200 }, (_, i) => dressingLook(building([0, 0, 1, 0, 1, 1], { id: i + 1 }), styled({ boxes: 0.3 })).hasBoxes).filter(Boolean).length;
  assert.ok(n > 30 && n < 90, `about 30 % of houses: ${n}`);
});
test('door pots: both sides, on the ground, clear of every opening, none by a big door', () => {
  const ground = (u) => 5 + 0.05 * u, s = dress({ ...off, pots: 1 }, { groundY: ground }), v = allVerts(s);
  found.push(['pots (2)', v.length / 3]);
  assert.equal(tris(s, SOUP.iron) / 10, 2, 'a pot each side'); assert.equal(tris(s, SOUP.leaves + 'v'), 12);
  const low = Math.min(...verts(s, SOUP.iron).map((p) => p[1])); assert.ok(Math.abs(low - Math.min(ground(3.25), ground(4.95))) < 0.02, `lowest ${low}`);
  for (const p of v) for (const o of ops0) assert.ok(!(p[0] > o.u0 + 1e-9 && p[0] < o.u1 - 1e-9), `vertex ${p[0]} inside an opening`);
  const edge = dress({ ...off, pots: 1 }, { ops: [{ kind: 'door', u0: 0.4, u1: 1.4, ys: Y0, yh: Y0 + 2.1 }] });
  assert.equal(tris(edge, SOUP.iron) / 10, 1, 'the left pot would be outside [0.3, len - 0.3]');
  assert.equal(dress({ ...off, pots: 1 }, { ops: [{ kind: 'door', u0: 4, u1: 6.6, ys: Y0, yh: Y0 + 2.4, big: true }] }).map.size, 0);
});

test('nothing on an edge that is not front, on the wrong storey, or without openings', () => {
  assert.equal(dress(all, { front: false }).map.size, 0);
  assert.equal(dress(all, { ops: [] }).map.size, 0);
  assert.equal(dress(all, { storey: 2, y0: Y0 + 6.2, ops: ops1 }).map.size, 0, 'above storey 1');
  assert.equal(dress({ ...off, boxes: 1 }, { storey: 0 }).map.size, 0, 'boxes are storey 1 only');
  assert.equal(dress({ ...off, signs: 1, lanterns: 1, pots: 1 }, { storey: 1, y0: Y0 + 3.1, ops: ops1 }).map.size, 0, 'the rest are storey 0 only');
  const RING = [0, 0, 10, 0, 10, 8, 0, 8], a = createSoups(), b = createSoups(), info = { slots: [], ridge: [], parapet: 0 };
  facadeNear(a, building(RING, { blind: new Set([0, 1, 2, 3]), front: new Set([0]) }), () => 30, base, info); facadeNear(b, building(RING, { blind: new Set([0, 1, 2, 3]), front: new Set([0]) }), () => 30, styled(all), info);
  assert.deepEqual([...a.map.keys()], [...b.map.keys()]); for (const [k, s] of a.map) assert.deepEqual(s.pos, b.map.get(k).pos);
});

test('every dressing vertex is in front of the wall plane; every coloured soup has one colour a vertex', () => {
  for (const id of [1, 2, 3, 4, 5, 6]) {
    const s = dress(all, { id }); for (const p of allVerts(s)) assert.ok(p[2] >= -1e-9, `behind the wall: ${p}`);
    const w = dress(all, { storey: 1, y0: Y0 + 3.1, ops: ops1, id }); for (const p of allVerts(w)) assert.ok(p[2] >= -1e-9);
    for (const t of [s, w]) for (const [k, so] of t.map) { if (so.col) assert.equal(so.col.length, so.pos.length, k); for (const c of so.pos) assert.ok(Number.isFinite(c)); }
  }
  // the same, through facadeNear on a wall whose outside is z < 0: distance out = -z
  const RING = [0, 0, 10, 0, 10, 8, 0, 8], soups = createSoups(); facadeNear(soups, building(RING, { front: new Set([0]), groundFloor: 1, id: 5 }), () => 30, styled(all), { slots: [], ridge: [], parapet: 0 });
  for (const [k, so] of soups.map) if (so.col) assert.equal(so.col.length, so.pos.length, k);
});

test('seeded: the same building twice is the same, two buildings differ', () => {
  const key = (s) => JSON.stringify([...s.map].map(([k, o]) => [k, o.pos, o.col]));
  assert.equal(key(dress(all, { id: 9 })), key(dress(all, { id: 9 })));
  const k = new Set(); for (let id = 1; id <= 12; id++) k.add(key(dress({ ...all, signs: 0.5, pots: 0.5, lanterns: 0.5 }, { id }))); assert.ok(k.size >= 6, `${k.size} different outputs in 12 buildings`);
  const c = dressingLook(building([0, 0, 1, 0, 1, 1], { id: 3 }), styled({})), d = dressingLook(building([0, 0, 1, 0, 1, 1], { id: 3 }), styled({}));
  assert.deepEqual(c.dcolors, d.dcolors);
});

test('budgets: sign 60, lantern 40, window box 90, pot 40 triangles; a 20 m edge with everything on stays under 1 200', () => {
  let signMax = 0, lanternMax = 0, boxMax = 0, potMax = 0;
  for (let id = 1; id <= 40; id++) {
    const one = { kind: 'shop', u0: 3, u1: 5, ys: Y0 + 0.5, yh: Y0 + 2.3 }, door = { kind: 'door', u0: 6, u1: 7, ys: Y0, yh: Y0 + 2.1 };
    signMax = Math.max(signMax, dress({ ...off, signs: 1 }, { id, ops: [one] }).triangles());
    lanternMax = Math.max(lanternMax, dress({ ...off, lanterns: 1 }, { id, ops: [door] }).triangles());
    potMax = Math.max(potMax, dress({ ...off, pots: 1 }, { id, ops: [door] }).triangles() / 2);
    boxMax = Math.max(boxMax, dress({ ...off, boxes: 1 }, { id, storey: 1, y0: Y0 + 3.1, ops: [ops1[0]] }).triangles());
  }
  found.push(['max sign', signMax], ['max lantern', lanternMax], ['max box', boxMax], ['max pot', potMax]);
  assert.ok(signMax <= 60 && signMax > 0, `sign ${signMax}`); assert.ok(lanternMax <= 40 && lanternMax > 0, `lantern ${lanternMax}`);
  assert.ok(boxMax <= 90 && boxMax > 0, `box ${boxMax}`); assert.ok(potMax <= 40 && potMax > 0, `pot ${potMax}`);
  const RING = [0, 0, 20, 0, 20, 8, 0, 8], info = { slots: [], ridge: [], parapet: 0 }; let worst = 0;
  for (let id = 1; id <= 30; id++) {
    const mk = () => building(RING, { id, front: new Set([0]), groundFloor: 1 }), a = createSoups(), b = createSoups();
    facadeNear(a, mk(), () => 30, base, info); facadeNear(b, mk(), () => 30, styled(all), info);
    worst = Math.max(worst, b.triangles() - a.triangles());
  }
  found.push(['20 m edge, everything on, worst of 30 houses', worst]); assert.ok(worst < 1200 && worst > 0, `extra ${worst}`);
  console.log(found.map(([n, v]) => `${n}: ${v}`).join('; '));
});
