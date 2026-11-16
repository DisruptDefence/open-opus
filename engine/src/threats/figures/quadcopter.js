// LIFTED by hand: the animation half of the stand-in game's quadcopter (bundle statement 838, `Q_`), cut away from its
// flight and fighting, which are threats.js over the archetype; and the searchlight of its enemy module (846), which
// lends one light of the render light pool to the nearest quadcopter and puts it where the lamp points. What is left
// here: the attitude (it leans into its acceleration), the hover bob, four rotors at the thrust it needs, the
// navigation strobes, the gimballed camera and lamp that track what it looks at, and a lost rotor when it is shot
// down. Edits are marked OPUS:.
//
// OPUS: what changed in the cut
//   - the type name and the stencilled number on its back are gone;
//   - driven by a view of the threat (figures/index.js); its acceleration is read from the velocity it is given;
//   - the rig faces +Z as lifted; an inner group turns it to face -Z like every threat.
import { Group, Vector3 } from '../../../vendor/three.module.js';
import { QUADCOPTER as xm, instantiateRig } from './rigs.js';

const $o = new Vector3(), Qv = new Vector3();
const K_ = (i, e) => { let t = (i - e) % (Math.PI * 2); return t > Math.PI ? (t -= Math.PI * 2) : t < -Math.PI && (t += Math.PI * 2), t; };
const bl = (i, e, t) => (i < e ? e : i > t ? t : i);

export function createQuadcopter(G, kit, rng) {
  const r = kit.mats.lensBase.clone();
  const a = instantiateRig(kit.near, { shell: kit.mats.shell, metal: kit.mats.metal, glow: kit.mats.glow, lens: r, disc: kit.mats.disc, cone: kit.mats.cone }, { radius: 0.9, center: [0, 0, 0], extra: { def: kit.near.extra, radius: 10 } });
  const l = a.bones, root = new Group(), inner = a.group;
  inner.rotation.order = 'YXZ'; inner.rotation.set(0, Math.PI, 0); root.add(inner);
  const d = {
    pos: new Vector3(), yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, thr: 1, phase: rng() * 6.283, t: 0,
    sensor: new Vector3(), gy: 0, gp: 0, sweep: 0, alive: true, dieT: 0, lostRotor: -1, started: false, far: false,
  };
  const ou = new Vector3();
  function update(y, v) {
    d.t += y;
    const yaw = v.yaw + Math.PI, m = d.t;
    if (!d.started) { d.started = true; d.vx = v.vx; d.vy = v.vy || 0; d.vz = v.vz; }
    // OPUS: the acceleration it is flying with, from the velocity threats.js gives it
    const k = y > 0 ? 1 - Math.exp(-10 * y) : 0;
    if (y > 0) { d.ax += ((v.vx - d.vx) / y - d.ax) * k; d.ay += (((v.vy || 0) - d.vy) / y - d.ay) * k; d.az += ((v.vz - d.vz) / y - d.az) * k; }
    d.vx = v.vx; d.vy = v.vy || 0; d.vz = v.vz; d.pos.copy(v.pos); d.yaw = yaw;
    d.sensor.set(0, -0.17, 0.27).applyAxisAngle(Qv.set(0, 1, 0), yaw).add(d.pos);
    if (!d.alive) {
      d.dieT += y;
      for (let _ = 0; _ < 4; _++) _ !== d.lostRotor && (l['rotor' + _].rotation.y += (_ % 3 === 0 ? 1 : -1) * 30 * Math.max(0.2, 1 - d.dieT * 0.5) * y);
      return;
    }
    const z = Math.hypot(d.vx, d.vz), T = Math.cos(yaw), D = Math.sin(yaw);
    // it leans into what it is doing (the lifted gains on a commanded acceleration, read here from the real one)
    const Cx = d.ax + d.vx * 0.6, Cz = d.az + d.vz * 0.6, C = Cx * D + Cz * T, Gl = Cx * T - Cz * D, hurt = v.health < 0.5;
    let j = bl(C * 0.04, -0.42, 0.42), N = bl(-Gl * 0.04, -0.42, 0.42);
    hurt && ((j += Math.sin(m * 11 + d.phase) * 0.1), (N += Math.cos(m * 8.7 + d.phase * 2) * 0.13));
    const Q = 1 - Math.exp(-7 * y);
    (d.pitch += (j - d.pitch) * Q), (d.roll += (N - d.roll) * Q);
    inner.rotation.set(d.pitch, Math.PI, d.roll);
    l.body.position.y = Math.sin(m * 2.1 + d.phase) * 0.045 + Math.sin(m * 3.7 + d.phase * 1.7) * 0.018;
    d.thr += (1 + bl(d.ay * 0.03, -0.25, 0.4) + z * 0.02 - d.thr) * Q;
    const K = 41 * d.thr * y;
    (l.rotor0.rotation.y += K), (l.rotor1.rotation.y -= K * 1.03), (l.rotor2.rotation.y -= K * 0.98), (l.rotor3.rotation.y += K * 1.01);
    const ie = (m * 0.9 + d.phase * 0.1) % 1, F = ie < 0.05 || (ie > 0.13 && ie < 0.18) ? 1 : 1e-4;
    l.strobeR.scale.setScalar(F), l.strobeG.scale.setScalar(F), l.strobeW.scale.setScalar(ie > 0.5 && ie < 0.56 ? 1 : 1e-4);
    // the gimbal: on the target in a fight, sweeping round where it was last seen while searching, ahead and down on patrol
    if (v.engaged && v.target) ou.set(v.target.x, v.target.y + 1.1, v.target.z);
    else if (v.target) (d.sweep += y), ou.set(v.target.x + Math.sin(d.sweep * 0.9) * 3, v.target.y, v.target.z + Math.cos(d.sweep * 0.7) * 3);
    else { d.sweep += y; const P = yaw + Math.sin(d.sweep * 0.5 + d.phase) * 0.9; ou.set(d.pos.x + Math.sin(P) * 5, d.pos.y - 5, d.pos.z + Math.cos(P) * 5); }
    $o.copy(ou).sub(d.sensor);
    const X = $o.x * T - $o.z * D, ne = $o.x * D + $o.z * T, re = $o.y, $ = Math.atan2(X, ne), ue = bl(Math.atan2(-re, Math.hypot(X, ne)), -0.5, 1.5), me = 1 - Math.exp(-9 * y);
    (d.gy += K_($, d.gy) * me), (d.gp += (ue - d.gp) * me), (l.gimbalYaw.rotation.y = d.gy), (l.ball.rotation.x = d.gp - d.pitch), (l.gun.rotation.x = bl(d.gp, -0.2, 1.3) - d.pitch);
  }
  return {
    root, lens: r, kind: 'quadcopter', mesh: a.mesh, extraMesh: a.extraMesh, state: d,
    update,
    setFar(far) { if (far !== d.far) { d.far = far; a.mesh.geometry = far ? kit.far.geometry : kit.near.geometry; } },
    muzzle(out) { return out.set(0, -0.12, 0.17).applyAxisAngle(Qv.set(0, 1, 0), d.yaw).add(d.pos); },
    fired() {},
    hit(dir) { if (dir) { d.roll += (rng() - 0.5) * 0.5; d.pitch += (rng() - 0.5) * 0.4; } },
    die() {
      d.alive = false; d.dieT = 0; d.lostRotor = Math.floor(rng() * 4);
      l['rotor' + d.lostRotor].scale.setScalar(1e-4);
      for (const n of ['lamp', 'strobeG', 'strobeR', 'strobeW']) l[n].scale.setScalar(1e-4);
      r.color.setRGB(0.3, 0.05, 0.02);
    },
    /** Where the lamp points: { from, dir } in the world, or null once it is down. */
    lamp() {
      if (!d.alive) return null;
      const N = d.yaw + d.gy, Q = Math.cos(d.gp);
      return { from: d.sensor, dir: Qv.set(Math.sin(N) * Q, -Math.sin(d.gp), Math.cos(N) * Q).normalize() };
    },
    dispose() { r.dispose(); },
  };
}

/** The searchlight: one light of the render light pool, lent to the quadcopter nearest the camera (within 60 m). */
export function createSearchlight(G) {
  let held = null, asked = false, every = 0, strength = 0;
  const spot = new Vector3();
  return {
    update(dt, figures) {
      if (!asked) {
        asked = true;
        try { held = G.render && G.render.lightPool && G.render.lightPool.acquire ? G.render.lightPool.acquire() : null; } catch { held = null; }
        if (held && held.light) { held.light.color.setRGB(1, 0.9, 0.75); held.light.distance = 9; }
      }
      if (!held || !held.light) return;
      let best = null, bestD = 3600; const cam = G.camera ? G.camera.position : null;
      for (const f of figures) { if (f.kind !== 'quadcopter' || !f.lamp()) continue; const q = cam ? f.state.pos.distanceToSquared(cam) : 0; if (q < bestD) { bestD = q; best = f; } }
      let want = 0;
      if (best) {
        if ((every -= dt) <= 0) {
          every = 0.1;
          const L = best.lamp(), hit = G.physics.raycast(L.from, L.dir, 14);
          spot.copy(L.from).addScaledVector(L.dir, (hit ? hit.dist : 8) - 0.6); strength = hit ? 1 : 0.3;
        }
        want = 26 * strength; held.light.position.lerp(spot, 1 - Math.exp(-12 * dt));
      }
      held.light.intensity += (want - held.light.intensity) * (1 - Math.exp(-8 * dt));
    },
    dispose() { if (held) { try { held.release(); } catch { /* the renderer is gone */ } held = null; } asked = false; },
  };
}
