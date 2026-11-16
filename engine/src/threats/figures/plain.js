// The engine's plain person: boxes, legs that swing, a weapon light that flares. Our own; the figure a human archetype
// drew before it had a rig, kept as the fallback (`body.figure: 'plain'`).
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3 } from '../../../vendor/three.module.js';

function part(geo, mat, x, y, z, parent) { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

export function createPlainPerson() {
  const g = new Group(), lens = new MeshBasicMaterial({ color: 0xffffff });
  const cloth = new MeshStandardMaterial({ color: 0x4a5138, roughness: 0.9 }), kit = new MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.7 }), skin = new MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
  const legL = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, -0.11, 0.43, 0, g), legR = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, 0.11, 0.43, 0, g);
  part(new BoxGeometry(0.46, 0.6, 0.26), cloth, 0, 1.16, 0, g);
  part(new BoxGeometry(0.5, 0.34, 0.3), kit, 0, 1.2, 0.01, g); // vest
  part(new BoxGeometry(0.2, 0.22, 0.22), skin, 0, 1.6, 0, g);
  part(new SphereGeometry(0.15, 10, 8), kit, 0, 1.69, 0, g).scale.set(1, 0.75, 1.1); // helmet
  const arms = new Group(); arms.position.set(0, 1.32, 0); g.add(arms);
  part(new BoxGeometry(0.12, 0.12, 0.5), cloth, -0.2, 0, -0.2, arms); part(new BoxGeometry(0.12, 0.12, 0.5), cloth, 0.2, 0, -0.2, arms);
  part(new BoxGeometry(0.06, 0.1, 0.8), kit, 0.08, 0.02, -0.5, arms); // rifle
  part(new BoxGeometry(0.03, 0.03, 0.03), lens, 0.08, 0.1, -0.88, arms).castShadow = false; // the weapon light
  const muzzle = new Vector3(0.08, 1.34, -0.95);
  let stride = 0, deadFor = -1;
  return {
    root: g, lens, kind: 'plain', machine: false,
    update(dt, v) {
      if (!v.alive) { deadFor = Math.max(0, deadFor) + dt; g.rotation.x = -Math.min(1, deadFor * 3) * 1.5; return; }
      const sp = Math.hypot(v.vx, v.vz); stride += (sp * dt) / 0.8;
      const sw = Math.sin(stride * Math.PI) * Math.min(1, sp / 2) * 0.6; legL.rotation.x = sw; legR.rotation.x = -sw;
    },
    muzzle: (out) => out.copy(muzzle).applyAxisAngle(new Vector3(0, 1, 0), g.rotation.y).add(g.position),
    fired() {}, hit() {}, die() {}, setFar() {},
    dispose() { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
  };
}
