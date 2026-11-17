// The pistol view model (weapons/views/pistol.js): proportions, parts, budget, muzzle, closed solids.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildPistolView, PISTOL_DIMS } from '../src/weapons/views/pistol.js';
import { buildHands } from '../src/weapons/views/hands.js';
const DEG = Math.PI / 180;

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

// ---- the grip, the slide and the budget as read from the geometry itself, not from the numbers the builder declares ----
const verts = (mesh) => { const a = mesh.geometry.attributes.position.array, out = []; for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]]); return out; };

const at = (mesh, f, tol = 2e-5) => verts(mesh).filter((q) => Math.abs(q[2] + f) < tol); // the vertices of a mesh in the plane f forward of the origin

test('the grip is raked 16 to 20 degrees back from vertical: the front strap measured on the frame mesh', () => {
  const v = verts(view.parts.frame);
  const front = (y) => Math.max(...v.filter((q) => Math.abs(q[1] - y) < 1e-4).map((q) => -q[2])); // forward-most point of the frame at the height of a grip section
  const a = front(-0.0680), b = front(-0.0780);
  const deg = Math.atan2(a - b, 0.0100) / DEG;
  assert.ok(deg > 16 && deg < 20, `front strap leans ${deg.toFixed(1)} degrees back from vertical`);
  assert.ok(view.dims.gripRakeMeasuredDeg > 16 && view.dims.gripRakeMeasuredDeg < 20);
});

test('the slide is bevelled: its top is narrower than its full width (3 mm each side), and wider-bevelled at the nose', () => {
  const widest = (f, y0 = 0, y1 = 1) => 2 * Math.max(...at(view.parts.slide, f).filter((q) => q[1] >= y0 && q[1] <= y1).map((q) => Math.abs(q[0])));
  const full = widest(0.1090, 0, 0.026), top = widest(0.1090, PISTOL_DIMS.slideTop - 1e-4, 1), noseTop = widest(0.1560, PISTOL_DIMS.slideTop - 1e-4, 1);
  assert.ok(Math.abs(full - 0.026) < 0.0003, `full width ${full}`);
  assert.ok(Math.abs(top - (full - 0.006)) < 0.0004, `top ${top} against ${full}: a 3 mm bevel on both sides takes 6 mm`);
  assert.ok(noseTop < top - 0.004, `the bevel is wider towards the nose: ${noseTop} against ${top}`);
});

test('cocking serrations: seven grooves at the rear and seven at the front, each side, cut 0.6 mm below the flat', () => {
  assert.deepEqual(view.dims.serrationGrooves, { rear: 7, front: 7 });
  const names = view.dims.pieces.map((p) => p.name);
  for (const side of ['-1', '1']) for (const e of ['rearSerr', 'frontSerr']) assert.equal(names.filter((n) => new RegExp(`^${e}\\d${side}$`).test(n)).length, 7, `${e} ${side}`);
  const floor = Math.min(...at(view.parts.slide, 0.0400).filter((q) => q[1] > 0.003 && q[1] < 0.023 && Math.abs(q[0]) > 0.0115).map((q) => Math.abs(q[0]))); // the zone's section where it ends
  assert.ok(Math.abs(floor - (0.013 - 0.0006)) < 1e-5, `the floor lies ${((0.013 - floor) * 1000).toFixed(2)} mm inside the flat`);
  const lands = verts(view.parts.slide).filter((q) => q[2] < 0.0 && q[2] > -0.04 && q[1] > 0.001 && q[1] < 0.025 && Math.abs(q[0]) > 0.0129).length;
  assert.ok(lands > 50, 'the lands stand up to the flat');
});

test('the ejection port shows the barrel hood, and the pistol keeps its budget: at most 6000 triangles and 6 draw calls', () => {
  assert.ok(view.dims.triangles <= 6000, String(view.dims.triangles));
  assert.equal(view.dims.drawCalls, 6);
  const hood = view.parts.barrel.geometry.boundingBox;
  assert.ok(hood.max.y + 0.0135 > 0.0235, 'the hood rises into the port');
});

test('the hands: at most 500 triangles each and 1000 together, one mesh each, the trigger finger morphs onto the trigger', () => {
  const h = buildHands(THREE, view.dims);
  assert.ok(h.dims.triangles.right <= 500 && h.dims.triangles.left <= 500, JSON.stringify(h.dims.triangles));
  assert.ok(h.dims.triangles.total <= 1000);
  assert.ok(h.right.isMesh && h.left.isMesh && h.dims.drawCalls === 2);
  // the curled finger target differs from the straight one only in the finger, and the straight finger lies outside the guard (x > 0.012)
  const g = h.right.geometry, p = g.attributes.position, alt = g.attributes.aAlt;
  let moved = 0, ox = 1;
  for (let i = 0; i < p.count; i++) { if (Math.hypot(p.getX(i) - alt.getX(i), p.getY(i) - alt.getY(i), p.getZ(i) - alt.getZ(i)) > 1e-6) { moved++; ox = Math.min(ox, p.getX(i)); } }
  assert.ok(moved > 20 && moved < 100, `moved vertices ${moved}`);
  assert.ok(ox > 0.012, `the straight finger rests outside the guard, along the frame (x >= ${ox})`);
  const lo = buildHands(THREE, view.dims).left.geometry.attributes.position.count;
  assert.ok(lo > 0);
});
