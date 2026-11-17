// The prop kit and the trees (src/gen/props.js, src/gen/trees.js; docs/plans/SCENE-DETAIL.md item 8). The loop over
// the kit checks every kind against the contract in the file's header: it is empty on the placeholder and tests each
// prop as item 8 adds it. The tree tests hold for any tree generator that keeps its contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_KIT } from '../src/gen/props.js';
import { tree } from '../src/gen/trees.js';
import { propSolid } from '../src/gen/mesher.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle, SEASONS } from '../src/gen/style.js';
import { vertices } from './helpers.js';

const style = resolveStyle();

test('every prop in the kit: stands on its ground, fills its collider and no more, turns with yaw, 30 to 250 triangles (a kind may declare a larger maxTriangles)', () => {
  for (const [kind, kit] of Object.entries(PROP_KIT)) {
    assert.equal(typeof kit.build, 'function', kind); assert.ok(kit.collider === null || typeof kit.collider.h === 'number', `${kind}: collider is null or has a height`);
    const at = (yaw) => { const soups = createSoups(); kit.build(soups, 100, 20, -50, yaw, 0, style); return soups; };
    const a = at(0), b = at(-Math.PI / 2), va = vertices(a), vb = vertices(b);
    assert.ok(a.triangles() >= 30 && a.triangles() <= (kit.maxTriangles ?? 250), `${kind}: ${a.triangles()} triangles`); assert.ok(a.map.size <= 3, `${kind}: at most three soups`);
    assert.ok(Math.abs(Math.min(...va.map((v) => v[1])) - 20) <= 0.02, `${kind}: stands on the ground`);
    // facing east is the model facing north turned a quarter: (dx, dz) -> (-dz, dx)
    const key = (v) => v.map((n) => n.toFixed(4)).join(), turned = new Set(va.map(([x, y, z]) => key([100 - (z + 50), y, -50 + (x - 100)])));
    for (const v of vb) assert.ok(turned.has(key(v)), `${kind}: yaw turns the same model`);
    if (kit.collider) {
      const c = kit.collider, hw = (c.hw ?? c.r) + 0.1, hd = (c.hd ?? c.r) + 0.1; assert.equal(typeof c.nav, 'boolean');
      const s = propSolid({ kind, x: 100, z: -50, yaw: 0 }); assert.equal(s.ring.length, 8); assert.equal(s.h, c.h);
      // tall thin things (a lamp's arm, a flag) may overhang above head height; below it the model stays in the collider
      for (const [x, y, z] of va) if (y < 20 + Math.min(c.h, 2)) assert.ok(Math.abs(x - 100) <= hw && Math.abs(z + 50) <= hd, `${kind}: (${x}, ${y}, ${z}) is outside its collider`);
    }
  }
});
test('a collider turns with the prop: half-width along its right hand, half-depth along its facing', () => {
  PROP_KIT.__test = { build() {}, collider: { hw: 0.9, hd: 0.3, h: 0.85, nav: true } };
  try {
    const span = (yaw) => { const r = propSolid({ kind: '__test', x: 0, z: 0, yaw }).ring; return [Math.max(r[0], r[2], r[4], r[6]), Math.max(r[1], r[3], r[5], r[7])].map((v) => +v.toFixed(6)); };
    assert.deepEqual(span(0), [0.9, 0.3], 'facing north: wide along x'); assert.deepEqual(span(-Math.PI / 2), [0.3, 0.9], 'facing east: wide along z');
    assert.equal(propSolid({ kind: 'nothing', x: 0, z: 0, yaw: 0 }), null);
  } finally { delete PROP_KIT.__test; }
});
test('trees: every kind, form, season and level of detail builds, the same tree every time, as tall as its record', () => {
  for (const kind of [1, 2]) for (let form = 0; form < 5; form++) for (const season of SEASONS) for (const lod of [0, 1]) {
    const t = { x: 12.5, z: -7.5, height: 11, crownRadius: 3.5, kind, form }, a = createSoups(), b = createSoups();
    tree(a, t, 40, season, lod); tree(b, t, 40, season, lod);
    assert.ok(a.triangles() > 0 && a.triangles() <= (lod ? 400 : 70), `kind ${kind} form ${form} ${season} lod ${lod}: ${a.triangles()} triangles`);
    for (const [k, s] of a.map) assert.deepEqual(s.pos, b.map.get(k).pos);
    const v = vertices(a), top = Math.max(...v.map((p) => p[1])), reach = Math.max(...v.map((p) => Math.hypot(p[0] - t.x, p[2] - t.z)));
    assert.ok(Math.abs(top - 51) <= 11 * 0.15, `top at ${top}`); assert.ok(Math.min(...v.map((p) => p[1])) <= 40, 'the trunk reaches the ground');
    if (!(season === 'winter' && kind === 1)) assert.ok(reach <= 3.5 * 1.5 && reach >= 3.5 * 0.4, `crown reach ${reach.toFixed(2)} for a radius of 3.5`);
  }
});
for (const t of ['each kind of the plan\'s table is in the kit with its collider', 'an unknown kind in a scene is skipped with one warning', 'a winter broadleaf has no triangle in leaves; autumn tints per tree; conifers stay green',
  'the capsule is stopped by a bench and a cannon and passes between two bollards 1.6 m apart', 'crown radius of the built tree within 15 % of the record\'s']) test.todo('item 8: ' + t);
