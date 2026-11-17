// Façade facts read from photographs: the optional building fields `wc` (wall colour), `frm` (window frame) and `dr` (door)
// (docs/SCENE-FORMAT.md 4.2). An old reader ignores them and uses the palette index; a new one uses the colour instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonSource } from '../src/scene/source.js';
import { parseColor } from '../src/gen/style.js';
import { facadeNear } from '../src/gen/facade.js';
import { createSoups } from '../src/gen/soup.js';
import { resolveStyle } from '../src/gen/style.js';
import { buildingId } from '../src/gen/wallvar.js';
import { fixture } from './helpers.js';
import { building } from './helpers.js';

const decode = async (scene) => { const src = jsonSource(scene), out = []; for (const c of src.manifest.chunks) out.push(...(await src.chunk(c.ce, c.cn)).buildings); return out; };
const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('`wc` replaces the palette index: the tint is that colour, jittered by the building like any palette colour, and one constant per building', async () => {
  const scene = fixture('scene-new'), id = 2890417532, rec = scene.buildings.find((b) => b.id === id);
  const plain = (await decode(scene)).find((b) => b.id === id);
  rec.wc = '#a05e3d'; rec.dr = '#2a5db0'; rec.frm = '#ffffff';
  const a = (await decode(scene)).find((b) => b.id === id), b = (await decode(scene)).find((b) => b.id === id);
  assert.ok(near(a.tint, parseColor('#a05e3d'), 0.12), `tint ${a.tint}`); assert.ok(!near(a.tint, plain.tint, 0.02), 'not the palette colour');
  assert.deepEqual(a.tint, b.tint, 'the same every time'); assert.ok(Number.isInteger(buildingId(a.tint)));
  assert.deepEqual(a.doorColor, parseColor('#2a5db0')); assert.deepEqual(a.frameColor, parseColor('#ffffff'));
  assert.equal(plain.doorColor, null); assert.equal(plain.frameColor, null); assert.equal(plain.facade, a.facade, 'the façade class is the builder\'s, written as `fa`');
  rec.wc = 'not a colour'; rec.dr = 'x'; const bad = (await decode(scene)).find((b) => b.id === id);
  assert.deepEqual(bad.tint, plain.tint, 'an unreadable colour is ignored: the palette index is used'); assert.equal(bad.doorColor, null);
});

test('frame and door colours of the building win over the style lists in the façade', () => {
  const style = resolveStyle(), RING = [0, 0, 10, 0, 10, 8, 0, 8], info = { slots: [], ridge: [], parapet: 0 };
  const has = (soups, c) => { for (const s of soups.map.values()) if (s.col) for (let i = 0; i < s.col.length; i += 3) if (near([s.col[i], s.col[i + 1], s.col[i + 2]], c, 1e-6)) return true; return false; };
  const pink = [0.9, 0.05, 0.8], on = createSoups(), off = createSoups();
  facadeNear(on, building(RING, { id: 5, frameColor: pink, front: new Set([0]) }), () => 30, style, info);
  facadeNear(off, building(RING, { id: 5, front: new Set([0]) }), () => 30, style, info);
  assert.ok(has(on, pink), 'window frames take the building\'s frame colour'); assert.ok(!has(off, pink));
  const doors = [], DO = [0.05, 0.9, 0.1];
  for (let id = 1; id <= 12; id++) { const d = createSoups(); facadeNear(d, building(RING, { id, doorColor: DO, front: new Set([0]), groundFloor: 1 }), () => 30, style, info); doors.push(has(d, DO)); }
  assert.ok(doors.some(Boolean), 'doors take the building\'s door colour (in at least one of 12 seeds: a door is drawn where the bay draw puts one)');
});
