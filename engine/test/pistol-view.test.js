// The pistol view model (weapons/views/pistol.js): proportions, parts, budget, muzzle, closed solids.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildPistolView, PISTOL_DIMS } from '../src/weapons/views/pistol.js';

const view = buildPistolView(THREE);
view.group.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(view.group), size = box.getSize(new THREE.Vector3());
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) / want <= tol, `${what}: ${(got * 1000).toFixed(1)} mm, wanted ${(want * 1000).toFixed(0)} mm +-${tol * 100}%`);

test('the whole pistol is 203 x 140 x 33 mm within 4 %', () => {
  near(size.z, 0.203, 0.04, 'length'); near(size.y, 0.140, 0.04, 'height'); near(size.x, 0.033, 0.04, 'width');
});

test('every named part exists, and the moving ones are separate meshes', () => {
  for (const k of ['slide', 'barrel', 'frame', 'trigger', 'magazine', 'slideStop', 'sights']) assert.ok(view.parts[k] && view.parts[k].isObject3D, k);
  const meshes = ['slide', 'barrel', 'frame', 'trigger', 'magazine', 'slideStop'].map((k) => view.parts[k]);
  for (const m of meshes) assert.ok(m.isMesh, m.name);
  assert.equal(new Set(meshes).size, 6);
  assert.ok(view.muzzle.isObject3D && view.ejection.isObject3D);
});

test('budget: at most 6000 triangles and 6 draw calls (one material, six meshes)', () => {
  let tris = 0; const meshes = [];
  view.group.traverse((o) => { if (o.isMesh) { meshes.push(o); tris += o.geometry.attributes.position.count / 3; } });
  assert.ok(tris <= 6000, `triangles ${tris}`);
  assert.ok(meshes.length <= 6, `meshes ${meshes.length}`);
  assert.equal(new Set(meshes.map((m) => m.material)).size, 1);
  assert.equal(tris, view.dims.triangles);
});

test('the muzzle is on the bore axis at the slide front face, bore centred on the barrel', () => {
  const p = new THREE.Vector3(); view.muzzle.getWorldPosition(p);
  assert.ok(Math.abs(p.x) < 1e-9);
  assert.ok(Math.abs(p.y - PISTOL_DIMS.boreY) < 1e-9);
  assert.ok(Math.abs(p.z + PISTOL_DIMS.slideFront) < 1e-9);
  const sb = new THREE.Box3().setFromObject(view.parts.slide);
  assert.ok(Math.abs(sb.min.z - p.z) < 1e-4, 'the slide ends at the muzzle plane');
  const bb = new THREE.Box3().setFromObject(view.parts.barrel);
  assert.ok(Math.abs((bb.min.z - p.z)) < 1e-3, 'the barrel crown is at the front face');
});

test('sight radius 168 mm and the barrel is 119 mm', () => {
  near(view.dims.sightRear.distanceTo(view.dims.sightFront), 0.168, 0.02, 'sight radius');
  const bb = new THREE.Box3().setFromObject(view.parts.barrel);
  near(bb.max.z - bb.min.z, 0.119, 0.03, 'barrel (hood to crown, guide rod aside)');
});

test('no solid is inside out: every closed piece has positive volume', () => {
  const bad = view.dims.pieces.filter((p) => p.volume !== null && !(p.volume > 0));
  assert.deepEqual(bad.map((p) => p.name), []);
});

test('the slide travels 45 mm rearwards and the magazine leaves along the grip axis', () => {
  const a = view.dims.anim; assert.equal(a.slideTravel, 0.045);
  assert.ok(view.dims.gripAxis.y < 0 && view.dims.gripAxis.z > 0, 'down and rearwards (the butt is towards the shooter)');
  near(Math.atan2(view.dims.gripAxis.z, -view.dims.gripAxis.y), 18 * Math.PI / 180, 0.01, 'rake');
});

test('both frame colours build; the frame colour reaches the polymer only', () => {
  const c = buildPistolView(THREE, { frameColor: '#8a7a5c' });
  const col = (v) => Array.from(v.parts.frame.geometry.attributes.color.array.slice(0, 3));
  assert.notDeepEqual(col(c), col(view));
  assert.deepEqual(Array.from(c.parts.slide.geometry.attributes.color.array.slice(0, 3)), Array.from(view.parts.slide.geometry.attributes.color.array.slice(0, 3)));
});
