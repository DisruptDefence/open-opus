// LIFTED by hand: the animation half of the stand-in game's four-legged machine (bundle statement 841, `iM`), cut away
// from its behaviour. What it decided (where to go, when to shoot, the rush) is threats.js over the archetype; what is
// left here is how the body moves while it does that: feet placed one diagonal pair at a time and held on the ground,
// a sprung body that leans with acceleration and turns, the turret and the head tracking what it looks at, the
// recoil, the flinch of a hit, and the crash of a wreck. Edits are marked OPUS:.
//
// OPUS: what changed in the cut
//   - the type name, the stencilled hull number and its label material are gone;
//   - it is driven by a view of the threat (see figures/index.js) instead of owning position, speed and yaw;
//   - the rig faces +Z as lifted; the figure's own frame faces -Z like every threat, through an inner group;
//   - the far tier swaps the skinned geometry (same bones) beyond FAR_METRES.
import { Group, Vector3 } from '../../../vendor/three.module.js';
import { QUADRUPED as ni, instantiateRig, solveLegIK } from './rigs.js';

const ps = new Vector3(), ru = new Vector3(), jv = new Vector3(0, 1, 0);
const bm = { abd: 0, hip: 0, knee: 0, reach: 0 };
const Mm = (i, e) => { let t = (i - e) % (Math.PI * 2); return t > Math.PI ? (t -= Math.PI * 2) : t < -Math.PI && (t += Math.PI * 2), t; };
const uo = (i, e, t) => (i < e ? e : i > t ? t : i);
const wm = [[0, 3], [1, 2]]; // the diagonal pairs
function xa(i, e, t, n, s) { return (i.v += ((e - i.x) * t - i.v * n) * s), (i.x += i.v * s), i.x; } // a damped spring

/** One four-legged machine. `kit`: { near, far, mats } built once per archetype (figures/index.js). */
export function createQuadruped(G, kit, rng) {
  const r = kit.mats.lensBase.clone();
  const a = instantiateRig(kit.near, { shell: kit.mats.shell, metal: kit.mats.metal, glow: kit.mats.glow, lens: r }, { radius: 1.5, center: [0, 0.6, 0] });
  const l = a.bones, root = new Group(), inner = a.group;
  inner.rotation.y = Math.PI; root.add(inner); // OPUS: the rig faces +Z
  const c = [], u = [], h = [];
  for (let T = 0; T < 4; T++) c.push(l['abd' + ni.legs[T]]), u.push(l['thigh' + ni.legs[T]]), h.push(l['shin' + ni.legs[T]]);
  const b = [0, 1, 2, 3].map(() => ({ p: new Vector3(), from: new Vector3(), to: new Vector3(), slide: new Vector3() }));
  const m = {
    pos: new Vector3(), yaw: 0, speed: 0, prevSpeed: 0, yawRate: 0, vx: 0, vz: 0, headPos: new Vector3(),
    sw: -1, swT: 0, swDur: 0.2, lastPair: 1, idleT: 0, lift: 0.08,
    sY: { x: 0, v: 0 }, sP: { x: 0, v: 0 }, sR: { x: 0, v: 0 }, sL: { x: 0, v: 0 }, sA: { x: 0, v: 0 }, sA2: { x: 0, v: 0 },
    crouch: 0, tyaw: 0, tpitch: 0, hyaw: 0, hpitch: 0, scan: 0, phase: rng() * 6.283, t: 0,
    alive: true, dieT: 0, vy: 0, dieRoll: 0, diePitch: 0, started: false, far: false,
  };
  /** Where foot D rests for a body at (C, G) facing j (the rig's yaw). */
  function A(T, D, C, G, j) {
    const N = ni.side[D] * ni.footX, Q = ni.footZ[D], K = Math.cos(j), ie = Math.sin(j);
    return T.set(C + N * K + Q * ie, 0, G - N * ie + Q * K), T;
  }
  const ground = (x, z, y) => G.physics.groundHeight(x, z, y);
  // ---- the gait: a diagonal pair swings when its feet have strayed furthest from where they should be ----------
  function H(T) {
    const D = m.vx, C = m.vz, moving = m.speed > 0.15 || Math.abs(m.yawRate) > 0.25;
    if (m.sw < 0) {
      m.idleT = moving ? 0 : m.idleT + T;
      const j = m.speed + Math.abs(m.yawRate) * 0.5, N = uo(0.27 - j * 0.026, 0.14, 0.27);
      let Q = -1, K = 0;
      for (let F = 0; F < 2; F++) {
        let X = 0;
        for (const ne of wm[F]) { A(ps, ne, m.pos.x + D * N, m.pos.z + C * N, m.yaw + m.yawRate * N); const re = Math.hypot(ps.x - b[ne].p.x, ps.z - b[ne].p.z); re > X && (X = re); }
        F !== m.lastPair && (X *= 1.25), X > K && ((K = X), (Q = F));
      }
      const ie = moving ? 0.09 : m.idleT > 0.25 ? 0.035 : 1e9;
      if (Q >= 0 && K > ie) {
        (m.sw = Q), (m.swT = 0), (m.swDur = N), (m.lift = 0.065 + Math.min(0.09, j * 0.02));
        for (const F of wm[Q]) {
          const X = b[F];
          X.from.copy(X.p), A(X.to, F, m.pos.x + D * N * 1.5, m.pos.z + C * N * 1.5, m.yaw + m.yawRate * N * 1.5), (X.to.y = ground(X.to.x, X.to.z, m.pos.y + 0.6));
        }
      }
    } else {
      m.swT += T / m.swDur;
      const j = m.swT >= 1 ? 1 : m.swT, N = j * j * (3 - 2 * j);
      for (const Q of wm[m.sw]) { const K = b[Q]; K.p.lerpVectors(K.from, K.to, N), (K.p.y += Math.sin(Math.PI * j) * m.lift); }
      if (m.swT >= 1) { (m.sY.v -= 0.12 + m.speed * 0.03), (m.lastPair = m.sw), (m.sw = -1); } // OPUS: the step sound is threats.js's
    }
  }
  // ---- the pose: body on its springs, turret, head, antenna, four legs by IK to their feet ---------------------
  function O(T) {
    const D = Math.cos(m.yaw), C = Math.sin(m.yaw),
      G2 = (b[0].p.y + b[1].p.y) * 0.5, j = (b[2].p.y + b[3].p.y) * 0.5, N = (b[0].p.y + b[2].p.y) * 0.5, Q = (b[1].p.y + b[3].p.y) * 0.5,
      K = (G2 + j) * 0.5 - m.pos.y, ie = T > 0 ? (m.speed - m.prevSpeed) / T : 0;
    let F = Math.atan2(j - G2, 0.8) * 0.6 + uo(ie * 0.006, -0.07, 0.07), X = Math.atan2(N - Q, 0.55) * 0.6 + uo(m.yawRate * m.speed * 0.02, -0.12, 0.12), ne = K * 0.45 - Math.min(0.05, m.speed * 0.011);
    m.alive || ((F = m.diePitch), (X = m.dieRoll), (ne = 0));
    m.alive && (xa(m.sY, ne, 160, 17, T), xa(m.sP, F, 130, 15, T), xa(m.sR, X, 130, 15, T), xa(m.sL, 0, 110, 13, T));
    const re = m.alive ? Math.sin(m.t * 1.7 + m.phase) * 0.004 : 0, $ = m.sL.x, ue = ni.stand + m.sY.x - m.crouch + re, me = m.sP.x, ee = m.sR.x;
    l.body.position.set($, ue, 0), l.body.rotation.set(me, 0, ee), (l.turret.rotation.y = m.tyaw), (l.gun.rotation.x = m.tpitch - me * 0.5), l.head.rotation.set(m.hpitch, m.hyaw, 0);
    xa(m.sA, uo(-ie * 0.03 - me, -0.6, 0.6), 60, 5, T), xa(m.sA2, uo(m.yawRate * 0.12 - ee, -0.6, 0.6), 60, 5, T), l.antenna.rotation.set(m.sA.x, 0, m.sA2.x);
    const B = Math.cos(me), P = Math.sin(me), V = Math.cos(ee), Y = Math.sin(ee);
    for (let L = 0; L < 4; L++) {
      const Z = b[L].p, J = Z.x - m.pos.x, oe = Z.y + ni.footR * 0.6 - m.pos.y, fe = Z.z - m.pos.z,
        le = J * D - fe * C - $, R = oe - ue, I = J * C + fe * D, se = R * B + I * P, ae = -R * P + I * B, k = le * V + se * Y, ce = -le * Y + se * V;
      solveLegIK(bm, k - ni.side[L] * ni.hipX, ce - ni.hipY, ae - ni.fore[L] * ni.hipZ, ni.side[L], ni.l0, ni.L1, ni.L2 - ni.footR * 0.6);
      (c[L].rotation.z = bm.abd), (u[L].rotation.x = bm.hip), (h[L].rotation.x = bm.knee);
    }
    root.updateMatrixWorld(!0), m.headPos.setFromMatrixPosition(l.head.matrixWorld);
  }
  function start(v) {
    m.pos.copy(v.pos); m.yaw = v.yaw + Math.PI; m.started = true;
    for (let C = 0; C < 4; C++) { A(b[C].p, C, m.pos.x, m.pos.z, m.yaw); b[C].p.y = ground(b[C].p.x, b[C].p.z, m.pos.y + 0.6); }
  }
  /** The view of the threat (figures/index.js) for this frame. */
  function update(T, v) {
    if (!m.started) start(v);
    m.t += T;
    const yaw = v.yaw + Math.PI, dy = Mm(yaw, m.yaw);
    m.yawRate += ((T > 0 ? dy / T : 0) - m.yawRate) * (1 - Math.exp(-10 * T)); m.yaw = yaw;
    m.pos.copy(v.pos); m.vx = v.vx; m.vz = v.vz; m.prevSpeed = m.speed; m.speed = Math.hypot(v.vx, v.vz);
    if (!m.alive) return dying(T);
    // OPUS: the crouch of the lifted states: a little while aiming and shooting, more while winding up a rush
    const N = v.melee === 'wind' ? 0.16 : v.aim === 'tele' || v.aim === 'burst' ? 0.05 : 0;
    if (v.melee === 'wind') m.sP.v += 3 * T;
    H(T); m.crouch += (N - m.crouch) * (1 - Math.exp(-12 * T));
    const ee = Math.cos(m.yaw), B = Math.sin(m.yaw), Z = m.pos.y + ni.stand + m.sY.x - m.crouch;
    let P = 0, V = 0, Y = 0, L = 0.05;
    const aimAt = v.target && v.engaged ? v.target : null, lookAt = v.target;
    if (aimAt) {
      const I = aimAt.x - m.pos.x, se = aimAt.z - m.pos.z, ae = aimAt.y + 1 - (Z + 0.25);
      (P = Math.atan2(I * ee - se * B, I * B + se * ee)), (V = uo(Math.atan2(-ae, Math.hypot(I, se)), -0.9, 0.35));
    } else (m.scan += T * 0.5), (P = Math.sin(m.scan * 0.9 + m.phase) * 1.1);
    if (lookAt) {
      const I = lookAt.x - m.pos.x, se = lookAt.z - m.pos.z, ae = lookAt.y + 1.2 - (Z + 0.2);
      (Y = uo(Math.atan2(I * ee - se * B, I * B + se * ee), -1.2, 1.2)), (L = uo(Math.atan2(-ae, Math.hypot(I, se)), -0.6, 0.5));
    } else Y = Math.sin(m.t * 0.7 + m.phase) * 0.5 + uo(m.yawRate * 0.25, -0.6, 0.6);
    const J = uo(4.5 * T, 0, 1);
    (m.tyaw += uo(Mm(P, m.tyaw), -J, J)), (m.tpitch += (V - m.tpitch) * (1 - Math.exp(-10 * T)));
    const oe = 1 - Math.exp(-7 * T);
    (m.hyaw += (Y - m.hyaw) * oe), (m.hpitch += (L - m.hpitch) * oe), O(T);
    const fe = (m.t * (v.alert ? 2.2 : 0.8) + m.phase) % 1;
    l.beacon.scale.setScalar(fe < 0.12 || (fe > 0.22 && fe < 0.3) ? 1 : 1e-4);
  }
  /** The wreck: it drops onto its belly, bounces once, slides its feet out and settles. */
  function dying(T) {
    m.dieT += T;
    const D = m.dieT;
    if (D < 2.2) {
      const C = 0.215 - ni.stand;
      (m.vy -= 9.8 * T * (D < 0.12 ? 0.3 : 1)), (m.sY.x += m.vy * T);
      if (m.sY.x < C) { m.sY.x = C; if (m.vy < -1.2) { try { G.fx && G.fx.dust && G.fx.dust(m.pos, jv); } catch { /* optional */ } } m.vy = -m.vy * 0.22; }
      xa(m.sP, m.diePitch, 60, 9, T), xa(m.sR, m.dieRoll, 60, 9, T), xa(m.sL, 0, 40, 8, T);
      const g = Math.exp(-3.2 * T);
      for (let N = 0; N < 4; N++) { const Q = b[N]; (Q.p.x += Q.slide.x * (1 - g)), (Q.p.z += Q.slide.z * (1 - g)), Q.slide.multiplyScalar(g); }
      (m.hpitch += (0.55 - m.hpitch) * (1 - Math.exp(-5 * T))), (m.hyaw += (m.dieRoll - m.hyaw) * (1 - Math.exp(-3 * T))), (m.tpitch += (0.3 - m.tpitch) * (1 - Math.exp(-4 * T)));
      const j = D < 1.2 ? (Math.sin(D * 60) > 0.2 ? 1 - D / 1.2 : 0.05) : 0.02;
      r.color.setRGB(6 * j + 0.05, 0.6 * j + 0.01, 0.2 * j), O(T); // the lens flickers out
    }
  }
  return {
    root, lens: r, kind: 'quadruped', mesh: a.mesh,
    get headPos() { return m.headPos; },
    update,
    /** The four feet in the world, and which of them are in the air (for tests and pictures). */
    feet: () => b.map((f) => f.p),
    swinging: () => (m.sw >= 0 ? wm[m.sw] : []),
    setFar(far) { if (far !== m.far) { m.far = far; a.mesh.geometry = far ? kit.far.geometry : kit.near.geometry; } },
    /** Where shots leave: the gun's end, along its aim. */
    muzzle(out, aim) {
      root.updateMatrixWorld(true); out.setFromMatrixPosition(l.gun.matrixWorld);
      if (aim) ps.copy(aim).sub(out).normalize(); else ps.set(0, 0, 1).transformDirection(l.gun.matrixWorld);
      return out.addScaledVector(ps, 0.43);
    },
    fired() { (m.sP.v += 1.1), (m.sY.v -= 0.25); },
    /** A round arrives along `dir` with `amount` of damage: the body is knocked by it. */
    hit(dir, amount, part) {
      if (!dir) return;
      const j = Math.cos(m.yaw), N = Math.sin(m.yaw), Q = Math.min(1.6, amount / 28), K = dir.x * N + dir.z * j, ie = dir.x * j - dir.z * N;
      (m.sL.v += ie * 1.4 * Q), (m.sR.v += -ie * 3.2 * Q), (m.sP.v += K * 2.4 * Q * (part === 'weak' ? 1.6 : 1)), (m.sY.v -= 0.5 * Q);
    },
    meleeHit() { m.sP.v -= 4; },
    die() {
      m.alive = false; m.dieT = 0; m.vy = 0; l.beacon.scale.setScalar(1e-4);
      (m.dieRoll = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.3)), (m.diePitch = (rng() - 0.5) * 0.25), (m.sR.v += m.dieRoll * 3), (m.sP.v += (rng() - 0.5) * 2);
      for (let D = 0; D < 4; D++) {
        const C = b[D]; m.sw >= 0 && (C.p.y = m.pos.y);
        const g = m.yaw, j = ni.side[D] * (0.16 + rng() * 0.2), N = ni.fore[D] * (0.05 + rng() * 0.22) + (rng() - 0.5) * 0.1;
        C.slide.set(j * Math.cos(g) + N * Math.sin(g), 0, -j * Math.sin(g) + N * Math.cos(g));
      }
      m.sw = -1;
    },
    /** Hit volumes in the world: the head (the weak point) and the body, as capsules { a, b, r, part }. */
    zones() {
      const Nc = Math.cos(m.yaw), Q = Math.sin(m.yaw), K = m.pos.y + ni.stand + m.sY.x - m.crouch, lo = m.pos.y + (K - m.pos.y) * 0.45;
      return [
        { a: m.headPos, b: m.headPos, r: 0.155, part: 'weak' },
        { a: { x: m.pos.x - Q * 0.45, y: K + 0.03, z: m.pos.z - Nc * 0.45 }, b: { x: m.pos.x + Q * 0.47, y: K + 0.03, z: m.pos.z + Nc * 0.47 }, r: 0.27, part: 'body' },
        { a: { x: m.pos.x - Q * 0.45, y: lo, z: m.pos.z - Nc * 0.45 }, b: { x: m.pos.x + Q * 0.47, y: lo, z: m.pos.z + Nc * 0.47 }, r: 0.25, part: 'body' },
      ];
    },
    dispose() { r.dispose(); },
  };
}
