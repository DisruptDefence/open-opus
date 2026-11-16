// Cells and levels of detail (docs/plans/SCENE-DETAIL.md section 4): which cells show their near group, the mesher's
// three groups, and the meshes the loader makes of them. three.js runs under Node without a screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshBasicMaterial } from '../vendor/three.module.js';
import { createDetail, DETAIL_RADIUS } from '../src/level/detail.js';
import { buildChunkStatic, buildCellNear, disposeGroup } from '../src/level/build.js';
import { cellSoups, GROUPS } from '../src/gen/mesher.js';
import { cellBoxes } from '../src/gen/cells.js';
import { triangulate } from '../src/gen/poly.js';
import { jsonSource } from '../src/scene/source.js';
import { PROP_KIT } from '../src/gen/props.js';
import { box } from '../src/gen/soup.js';
import { fixture, installAll, oldQuebec } from './helpers.js';
import { openHeadlessWorld } from './headless.js';

test('detail by distance: near within R, far beyond R + 10, thrown away beyond R + 80, and no flipping at the edge', () => {
  const log = [], d = createDetail({ radius: 50, build: (k, c) => { log.push('build ' + c.index); return { c }; }, show: (k, c, h, on) => log.push((on ? 'show ' : 'hide ') + c.index), dispose: (k, c) => log.push('drop ' + c.index) });
  const cell = cellBoxes(0, 0, 250)[0]; // x and z from 0 to 62.5
  d.add('a', [cell]);
  const at = (dist) => { log.length = 0; d.update(-dist, 30); return log.join(', '); };
  assert.equal(at(70), '', '70 m away with R = 50: the far picture stays'); assert.deepEqual(d.stats(), { shown: 0, built: 0 });
  assert.equal(at(30), 'build 0, show 0'); assert.deepEqual(d.stats(), { shown: 1, built: 1 });
  for (const dist of [52.5, 47.5, 52.5, 47.5, 59]) assert.equal(at(dist), '', `stepping across R does nothing (${dist} m)`);
  assert.equal(at(70), 'hide 0'); assert.deepEqual(d.stats(), { shown: 0, built: 1 });
  for (const dist of [57.5, 62.5, 57.5, 52]) assert.equal(at(dist), '', `and back inside the band it stays far (${dist} m)`);
  assert.equal(at(49), 'show 0', 'kept, not rebuilt');
  assert.equal(at(140), 'hide 0, drop 0'); assert.deepEqual(d.stats(), { shown: 0, built: 0 });
  // one cell a call, nearest first; a cell with nothing to draw near is never built; a radius of 0 means never
  const cells = cellBoxes(0, 0, 250); cells[2] = { ...cells[2], empty: true };
  d.remove('a'); d.add('b', cells); log.length = 0; d.update(110, 30);
  assert.deepEqual(log, ['build 1', 'show 1'], 'the cell the camera is in comes first');
  log.length = 0; d.update(110, 30, 8); assert.ok(log.includes('build 0') && !log.includes('build 2') && !log.includes('build 1'), log.join());
  d.remove('b'); assert.deepEqual(d.stats(), { shown: 0, built: 0 });
  const never = createDetail({ radius: DETAIL_RADIUS.test, build: () => assert.fail('built'), show() {}, dispose() {} }); never.add('a', [cell]); assert.equal(never.update(10, 10), 0);
  assert.deepEqual([DETAIL_RADIUS.low, DETAIL_RADIUS.medium, DETAIL_RADIUS.high, DETAIL_RADIUS.ultra], [45, 85, 140, 220]);
});

test('the mesher: base has what never changes, far and near are two pictures of the same things', async () => {
  const had = { ...PROP_KIT }; let built = 0;
  PROP_KIT.lamp_lantern = { build(soups, x, y, z) { built++; box(soups.get('metal|tv'), x, z, 1, 0, 0.1, 0.1, y, y + 3, [0.1, 0.1, 0.1]); }, collider: { r: 0.15, h: 3, nav: false } };
  try {
    const { chunks } = await installAll(jsonSource(fixture('scene-new')));
    const total = { base: new Map(), far: new Map(), near: new Map() };
    for (const { chunk, env } of chunks.values()) {
      assert.equal(env.season, 'summer', 'the environment starts from the style; the loader sets the scene\'s season');
      for (const cell of chunk.cells) for (const g of GROUPS) for (const [key, s] of cellSoups(cell, g, env).map) total[g].set(key, (total[g].get(key) || 0) + s.pos.length / 9);
    }
    assert.ok(total.base.get('roof_zinc|tv') > 0, 'roofs are in base, tinted when the scene gives a colour'); assert.ok(total.base.get('wall_stone|t') > 0, 'solid walls are in base');
    assert.equal(total.base.get('galv|t'), undefined, 'a wall drawn as a rail is not in base'); assert.equal(total.near.get('galv|t'), undefined); assert.ok(total.near.get('metal|tv') > 10, 'the rail is posts and rails in iron, in near');
    assert.ok(total.far.get('facade_stone|v') > 0 && total.far.get('leaves|t') > 0, 'flat façades and simple trees are in far');
    for (const key of ['facade_stone|v', 'facade_stucco|v', 'leaves|t', 'wood|t']) assert.equal(total.near.get(key), total.far.get(key), `the placeholders draw the same ${key} near and far`);
    assert.equal(built, 1, 'the one prop whose kind the kit has was built; the others were skipped'); 
    assert.equal(total.far.get('metal|tv'), undefined);
    // the part that floats is walled from its min height, not from the ground
    const part = [...chunks.values()].flatMap((c) => c.chunk.buildings).find((b) => b.id === 77005), cellOf = [...chunks.values()].flatMap((c) => c.chunk.cells.map((cell) => [cell, c.env])).find(([cell]) => cell.buildings.includes(part));
    const far = cellSoups({ ...cellOf[0], buildings: [part], trees: [] }, 'far', cellOf[1]).get('facade_stone|v'); let lowest = Infinity; for (let i = 1; i < far.pos.length; i += 3) lowest = Math.min(lowest, far.pos[i]);
    assert.equal(lowest, part.yBase + 12);
  } finally { for (const k of Object.keys(PROP_KIT)) delete PROP_KIT[k]; Object.assign(PROP_KIT, had); }
});

test('meshes: a chunk\'s base and far are one mesh per material, and far leaves out the cells that show near', async () => {
  const G = { mats: { get: (name, opts) => Object.assign(new MeshBasicMaterial(), { name, opts }) } };
  const { chunks } = await installAll(jsonSource(fixture('scene-new')));
  const { chunk, env } = [...chunks.values()].find((c) => c.chunk.buildings.length >= 3);
  const fixed = buildChunkStatic(G, chunk, env), far = fixed.group.children.find((g) => g.name === 'far'), base = fixed.group.children.find((g) => g.name === 'base');
  const names = (g) => g.children.map((m) => m.material.name + JSON.stringify(m.material.opts)).sort(); // one mesh per soup key: a material with other flags is another mesh
  assert.equal(new Set(names(far)).size, far.children.length, 'one mesh per material in the whole chunk'); assert.equal(new Set(names(base)).size, base.children.length);
  const stone = far.children.find((m) => m.material.name === 'facade_stone'); assert.equal(stone.material.opts.vertexColors, true); assert.equal(stone.material.opts.triplanar, false);
  const cell = chunk.cells.find((c) => c.buildings.length), all = fixed.tris(), inCell = cellSoups(cell, 'far', env).triangles();
  assert.ok(inCell > 0);
  fixed.setNear(cell.index, true); assert.equal(fixed.tris(), all - inCell, 'the cell\'s far triangles are not drawn while its near group shows');
  let drawn = 0; for (const m of far.children) if (m.visible) drawn += m.geometry.drawRange.count / 3; assert.equal(drawn, all - inCell - base.userData.tris);
  fixed.setNear(cell.index, true); assert.equal(fixed.tris(), all - inCell); fixed.setNear(cell.index, false); assert.equal(fixed.tris(), all, 'and come back');
  const nearGroup = buildCellNear(G, chunk, cell, env); assert.equal(nearGroup.userData.tris, cellSoups(cell, 'near', env).triangles()); assert.ok(nearGroup.children.some((m) => m.castShadow) && nearGroup.children.every((m) => m.castShadow || m.material.name.length), 'things cast shadows; flat ground (soup flag n) does not');
  disposeGroup(nearGroup); disposeGroup(fixed.group);
});

test('the engine on a scene with the new records: near cells round the camera, the far picture elsewhere, the same triangles', async () => {
  const { world, engine, run } = openHeadlessWorld(jsonSource(fixture('scene-new')), { x: 20, z: -30 });
  await world.ready();
  const level = engine().G.level, s0 = level.stats();
  assert.equal(s0.detail, 45, 'low quality: 45 m'); assert.ok(s0.cellsNear >= 1 && s0.cellsNear <= 9, `near cells at the start: ${s0.cellsNear}`); assert.equal(s0.cellsBuilt, s0.cellsNear, 'the first frame has them: they are built with the start window');
  level.setDetail(0); run(0.1); const none = level.stats(); assert.equal(none.cellsNear, 0); assert.equal(none.cellsBuilt, 0);
  assert.ok(s0.tris >= none.tris, 'near and far draw the same buildings and trees; the street ground (item 6) exists in near only');
  level.setDetail(400); run(0.5); const wide = level.stats();
  assert.ok(wide.cellsNear > s0.cellsNear, 'one cell a frame until all within reach are in'); assert.ok(wide.nearBuildMs >= 0 && wide.nearBuilt >= wide.cellsNear);
  const st = world.stats(); assert.equal(st.cellsNear, wide.cellsNear); assert.equal(typeof st.nearBuildMs, 'number');
});

test('budgets on the published scene: no ring defeats the triangulator, and the densest cell builds in time', async () => {
  const { chunks } = await installAll(jsonSource(oldQuebec()));
  const tris = { base: 0, far: 0, near: 0 }; let worst = 0, worstMs = 0, densest = 0;
  for (const { chunk, env } of chunks.values()) for (const cell of chunk.cells) {
    for (const g of ['base', 'far']) tris[g] += cellSoups(cell, g, env).triangles();
    const t0 = performance.now(), n = cellSoups(cell, 'near', env).triangles(), ms = performance.now() - t0;
    tris.near += n; if (n > densest) { densest = n; worst = cell.buildings.length; worstMs = ms; }
  }
  assert.equal(triangulate.fallbacks, 0);
  assert.ok(tris.base < 120000 + 40000, `base ${tris.base}`); assert.ok(densest < 180000, `densest near cell ${densest} triangles (${worst} buildings)`);
  assert.ok(worstMs < 150, `the densest near cell took ${worstMs.toFixed(1)} ms`);
});
