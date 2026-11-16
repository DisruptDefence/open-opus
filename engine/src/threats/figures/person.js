// The person: a procedural soldier of the engine's own making, skinned on the lifted rig builder (rigs.js), in the
// generated style of the machines (rounded boxes, lathed limbs, vertex colours over the engine's material set).
//
// Body. A flat rig of 18 bones under the root: pelvis, spine, head, and for each side upper arm, forearm, hand, thigh,
// shin and foot; and the rifle. Every bone is a segment whose pivot is its upper joint; each frame the pose is
// worked out as joint positions in the figure's own frame (it faces -Z, +X is its right, its feet are at y = 0) and
// each bone is set from its two joints and a front direction. Skinning is rigid (one bone a vertex), as the machines;
// joints are covered by balls, so nothing opens when a limb bends.
//
// Look, from the archetype's `body.look` (content/default.js): colours of the clothing, the gear and the skin, the
// headgear (helmet | cap | none) and the chance of a pack on the back. A threat's id picks one of `variants` (4) of
// these, so one squad does not wear one face. No face detail, no lettering, no insignia.
//
// Motion, from the view threats.js gives each frame (figures/index.js): a gait that plants each foot where it lands
// and holds it there while the body passes over it (one foot swings at a time; a foot that strays while standing is
// stepped back under the body); the pelvis riding on the legs, its height set by where the feet are; the spine
// leaning with speed and twisting to the aim; the rifle carried low on patrol, at the ready when alert, in the
// shoulder to aim and fire (with recoil); hands held to the rifle by two-bone IK; the head on what it looks at;
// a crouch; a flinch when hit, a limp after a leg hit; a fall when killed, the rifle dropped beside the body.
import { BoxGeometry, Color, Group, LatheGeometry, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector2, Vector3 } from '../../../vendor/three.module.js';
import { Dc, RigBuilder, Wi, instantiateRig, ot, setRigDetail } from './rigs.js';

// ---- the body, in metres --------------------------------------------------------------------------------------
export const BODY = {
  ankle: 0.085, hip: 0.935, hipX: 0.095, waistUp: 0.11, spine: 0.46, shoulderUp: 0.37, shoulderX: 0.185,
  thigh: 0.43, shin: 0.42, upperArm: 0.29, forearm: 0.26, head: 0.24,
};
const B = BODY, LEG = B.thigh + B.shin;
const BONES = ['pelvis', 'spine', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'rifle'];
/** Rifle points in its own frame (grip at the origin, barrel along -Z, top +Y). */
const RIFLE = { butt: new Vector3(0, 0.035, 0.27), support: new Vector3(0, -0.005, -0.3), muzzle: new Vector3(0, 0.045, -0.64) };

// ---- geometry ------------------------------------------------------------------------------------------------
const P = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => Dc(geo, { p: [x, y, z], r: [rx, ry, rz], s });
/** A limb: a lathe down -Y from the pivot through `prof` [[radius, depth], ...], squashed front to back by `sz`. */
function limb(prof, segs, sx = 1, sz = 1) {
  const pts = [new Vector2(0, 0.0001 - prof[0][1])];
  for (const [r, d] of prof) pts.push(new Vector2(r, -d));
  pts.push(new Vector2(0, -prof[prof.length - 1][1] - 0.0001));
  const g = new LatheGeometry(pts, segs); g.scale(sx, 1, sz); return g;
}
const ball = (r, w, h, sx = 1, sy = 1, sz = 1) => { const g = new SphereGeometry(r, w, h); g.scale(sx, sy, sz); return g; };
const dome = (r, w, h, k, sx, sy, sz) => { const g = new SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * k); g.scale(sx, sy, sz); return g; };
/** A rounded box, or a plain one when it is small enough that nobody sees the rounding (a third of the triangles). */
const Bx = (w, h, d, r) => (Math.max(w, h, d) < 0.09 ? new BoxGeometry(w, h, d) : Wi(w, h, d, r));
const lin = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
const shade = (c, k) => c.map((v) => v * k);

/** The geometry of one look at one detail level (0 near, 1 far). Same bones at both. */
export function buildPerson(look, far = 0) {
  setRigDetail(far);
  const seg = (n) => (far ? Math.max(4, Math.round(n / 2)) : n), rb = new RigBuilder();
  rb.bone('root', null, 0, 0, 0);
  const bind = bindJoints();
  for (const n of BONES) rb.bone(n, 'root', ...bind[n]);
  const cloth = look.cloth, cloth2 = shade(cloth, 0.86), gear = look.gear, gear2 = shade(gear, 0.8), skin = look.skin, boot = look.boot, metal = [0.55, 0.56, 0.58], poly = [0.16, 0.16, 0.17];
  const add = (slot, bone, geo, col, ao = true) => rb.add(slot, bone, geo, col, ao);
  // pelvis: seat, belt and two pouches
  add('cloth', 'pelvis', P(Bx(0.33, 0.21, 0.22, 0.07), 0, 0.02, 0.005), cloth);
  add('gear', 'pelvis', P(Bx(0.35, 0.055, 0.24, 0.02), 0, 0.1, 0), gear2);
  if (!far) for (const x of [-0.13, 0.13]) add('gear', 'pelvis', P(Bx(0.06, 0.08, 0.07, 0.015), x, 0.06, 0.09), gear);
  // spine: the trunk, the plate carrier, mag pouches, shoulder straps, the neck; a pack on some
  add('cloth', 'spine', limb([[0.135, 0], [0.15, 0.1], [0.172, 0.25], [0.18, 0.34], [0.16, 0.41], [0.075, 0.46]], seg(12), 1.08, 0.66).rotateX(Math.PI), cloth);
  add('gear', 'spine', P(Bx(0.31, 0.3, 0.07, 0.025), 0, 0.25, -0.1), gear);
  add('gear', 'spine', P(Bx(0.31, 0.33, 0.06, 0.025), 0, 0.25, 0.105), gear);
  add('gear', 'spine', P(Bx(0.37, 0.13, 0.21, 0.03), 0, 0.13, 0), gear2);
  for (const x of [-0.115, 0.115]) add('gear', 'spine', P(Bx(0.065, 0.035, 0.27, 0.012), x, 0.42, 0), gear);
  for (const x of [-0.085, 0, 0.085]) add('gear', 'spine', P(Bx(0.075, 0.11, 0.045, 0.014), x, 0.14, -0.155), gear2);
  if (!far) add('gear', 'spine', P(Bx(0.1, 0.07, 0.04, 0.012), -0.08, 0.3, -0.15), gear2); // radio pouch
  add('skin', 'spine', P(ot(0.052, 0.058, 0.12, seg(10)), 0, 0.47, 0.005), skin);
  if (look.pack) {
    add('gear', 'spine', P(Bx(0.28, 0.34, 0.15, 0.045), 0, 0.24, 0.2), gear2);
    if (!far) add('gear', 'spine', P(ot(0.004, 0.006, 0.45, 5), 0.1, 0.55, 0.22, 0, 0, -0.08), poly); // radio antenna
  }
  // head: skull, nose, ears; helmet or cap
  add('skin', 'head', P(ball(1, seg(12), seg(9), 0.086, 0.106, 0.098), 0, 0.12, 0), skin);
  if (!far) {
    add('skin', 'head', P(Bx(0.024, 0.042, 0.03, 0.01), 0, 0.105, -0.094, -0.15), shade(skin, 0.95));
    for (const x of [-0.084, 0.084]) add('skin', 'head', P(ball(0.022, 6, 5, 0.5, 1, 0.8), x, 0.115, 0.005), shade(skin, 0.9));
  }
  if (look.headgear === 'helmet') {
    add('gear', 'head', P(dome(1, seg(14), seg(6), 0.56, 0.122, 0.112, 0.135), 0, 0.135, 0.008), gear);
    add('gear', 'head', P(Bx(0.05, 0.035, 0.025, 0.008), 0, 0.2, -0.128), gear2); // the mount at the front
    if (!far) for (const x of [-0.118, 0.118]) add('gear', 'head', P(Bx(0.012, 0.03, 0.11, 0.004), x, 0.15, 0), gear2); // rails
  } else if (look.headgear === 'cap') {
    add('cloth', 'head', P(dome(1, seg(14), seg(6), 0.5, 0.098, 0.075, 0.106), 0, 0.165, 0.004), cloth2);
    add('cloth', 'head', P(Bx(0.15, 0.012, 0.085, 0.004), 0, 0.17, -0.125, 0.18), cloth2);
  } else add('skin', 'head', P(dome(1, seg(12), seg(6), 0.5, 0.09, 0.07, 0.1), 0, 0.15, 0.006), shade(skin, 0.45)); // hair
  // arms
  for (const s of ['L', 'R']) {
    add('cloth', 'upperArm' + s, ball(0.068, seg(10), seg(8)), cloth);
    add('cloth', 'upperArm' + s, limb([[0.064, 0], [0.06, 0.12], [0.05, 0.29]], seg(9), 1, 0.95), cloth);
    add('cloth', 'forearm' + s, ball(0.05, seg(8), seg(6)), cloth);
    add('cloth', 'forearm' + s, limb([[0.05, 0], [0.047, 0.1], [0.038, 0.24]], seg(9), 1, 0.85), cloth2);
    add('gear', 'hand' + s, P(Bx(0.045, 0.1, 0.085, 0.018), 0, -0.055, 0), gear2);
    if (!far) add('gear', 'hand' + s, P(Bx(0.026, 0.055, 0.03, 0.01), (s === 'L' ? 1 : -1) * 0.022, -0.035, -0.04, 0.4), gear2); // thumb
  }
  // legs
  for (const s of ['L', 'R']) {
    const out = s === 'L' ? -1 : 1;
    add('cloth', 'thigh' + s, limb([[0.09, 0], [0.088, 0.08], [0.075, 0.25], [0.062, 0.43]], seg(10), 1, 1.05), cloth);
    if (!far) add('cloth', 'thigh' + s, P(Bx(0.035, 0.14, 0.11, 0.014), out * 0.078, -0.23, 0.005), cloth2); // cargo pocket
    add('cloth', 'shin' + s, ball(0.062, seg(10), seg(8)), cloth);
    add('gear', 'shin' + s, P(Bx(0.085, 0.1, 0.035, 0.014), 0, -0.035, -0.058), gear); // knee pad
    add('cloth', 'shin' + s, limb([[0.062, 0], [0.064, 0.1], [0.05, 0.3], [0.046, 0.36]], seg(9), 1, 1.05), cloth);
    add('gear', 'shin' + s, P(ot(0.055, 0.058, 0.13, seg(10)), 0, -0.35, 0.0), boot);
    add('gear', 'foot' + s, P(Bx(0.105, 0.095, 0.27, 0.03), 0, -0.03, -0.055), boot);
    add('gear', 'foot' + s, P(Bx(0.11, 0.028, 0.285, 0.01), 0, -0.075, -0.058), shade(boot, 0.55));
  }
  // the rifle (grip at the origin, barrel along -Z)
  add('metal', 'rifle', P(Bx(0.032, 0.1, 0.045, 0.01), 0, -0.045, 0.01, 0.32), poly);
  add('metal', 'rifle', P(Bx(0.052, 0.085, 0.3, 0.01), 0, 0.04, -0.06), metal);
  add('metal', 'rifle', P(Bx(0.03, 0.15, 0.07, 0.008), 0, -0.07, -0.13, -0.22), poly);
  add('metal', 'rifle', P(Bx(0.05, 0.11, 0.15, 0.012), 0, 0.02, 0.195), poly);
  add('metal', 'rifle', P(ot(0.016, 0.016, 0.1, seg(8)), 0, 0.045, 0.1, Math.PI / 2), metal);
  add('metal', 'rifle', P(Bx(0.058, 0.06, 0.26, 0.012), 0, 0.04, -0.3), poly);
  add('metal', 'rifle', P(ot(0.011, 0.011, 0.16, seg(8)), 0, 0.045, -0.51, Math.PI / 2), metal);
  add('metal', 'rifle', P(ot(0.017, 0.017, 0.05, seg(8)), 0, 0.045, -0.615, Math.PI / 2), metal);
  add('metal', 'rifle', P(ot(0.02, 0.02, 0.11, seg(10)), 0, 0.115, -0.07, Math.PI / 2), poly); // optic
  add('metal', 'rifle', P(Bx(0.03, 0.03, 0.05, 0.006), 0, 0.09, -0.07), metal);
  add('metal', 'rifle', P(ot(0.014, 0.014, 0.07, seg(8)), 0.037, 0.02, -0.37, Math.PI / 2), poly); // weapon light
  add('lens', 'rifle', P(ot(0.012, 0.012, 0.004, seg(8)), 0.037, 0.02, -0.407, Math.PI / 2), [1, 1, 1], false);
  const built = rb.build(['cloth', 'gear', 'skin', 'metal', 'lens']);
  setRigDetail(0);
  return built;
}

/** Bind positions: the pivot of each bone standing straight, arms down. */
function bindJoints() {
  const hipY = B.hip, waistY = hipY + B.waistUp, shY = waistY + B.shoulderUp;
  const j = { pelvis: [0, hipY, 0], spine: [0, waistY, 0], head: [0, waistY + B.spine + 0.04, 0], rifle: [0.25, 1.0, -0.25] };
  for (const [s, x] of [['L', -1], ['R', 1]]) {
    j['upperArm' + s] = [x * B.shoulderX, shY, 0]; j['forearm' + s] = [x * B.shoulderX, shY - B.upperArm, 0]; j['hand' + s] = [x * B.shoulderX, shY - B.upperArm - B.forearm, 0];
    j['thigh' + s] = [x * B.hipX, hipY, 0]; j['shin' + s] = [x * B.hipX, hipY - B.thigh, 0]; j['foot' + s] = [x * B.hipX, B.ankle, 0];
  }
  return j;
}

// ---- small vector helpers (figure space) -----------------------------------------------------------------------
const V = () => new Vector3();
const UP = new Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
function spring(s, target, k, c, dt) { s.v += ((target - s.x) * k - s.v * c) * dt; s.x += s.v * dt; return s.x; }
/** Two-bone IK: from `a` towards `c` with lengths l1, l2, the middle joint pushed towards `pole`. Writes b and the reached end. */
function ik(a, c, l1, l2, pole, outB, outC) {
  const d = V().subVectors(c, a); let len = d.length(); if (len < 1e-6) { d.set(0, -1, 0); len = 1e-6; }
  d.divideScalar(len); len = clamp(len, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = V().copy(pole).addScaledVector(d, -pole.dot(d)); if (p.lengthSq() < 1e-8) p.set(0, 0, -1).addScaledVector(d, -d.z); p.normalize();
  outB.copy(a).addScaledVector(d, x).addScaledVector(p, h); outC.copy(a).addScaledVector(d, len);
}
const m4 = new Matrix4(), bx = V(), by = V(), bz = V();
/** Set a bone from its pivot, its axis (towards its upper joint) and a front direction. */
function setBone(bone, pivot, axisUp, front) {
  by.copy(axisUp).normalize(); bz.copy(front).addScaledVector(by, -front.dot(by));
  if (bz.lengthSq() < 1e-8) bz.set(0, 0, -1).addScaledVector(by, -by.z);
  bz.normalize().negate(); bx.crossVectors(by, bz);
  m4.makeBasis(bx, by, bz); bone.quaternion.setFromRotationMatrix(m4); bone.position.copy(pivot);
}
const rotY = (v, a) => v.applyAxisAngle(UP, a);

/** One person. `kit`: { near, far, mats } for its look (figures/index.js). */
export function createPerson(G, kit, rng) {
  const lens = kit.mats.lensBase.clone();
  const r = instantiateRig(kit.near, { cloth: kit.mats.cloth, gear: kit.mats.gear, skin: kit.mats.skin, metal: kit.mats.metal, lens }, { radius: 1.3, center: [0, 0.9, 0] });
  const bone = r.bones, root = new Group(); root.add(r.group);
  // joints, in the figure's frame
  const J = {}; for (const n of ['hipC', 'waist', 'chest', 'neck', 'headTop', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'grip']) J[n] = V();
  const F = { pelvisUp: V(), pelvisFwd: V(), spineUp: V(), spineFwd: V(), spineRight: V(), headUp: V(), headFwd: V(), rifleF: V(), rifleU: V(), rifleR: V() };
  const s = {
    t: 0, phase: rng() * 6.283, far: false, started: false, pos: V(), yaw: 0, speed: 0, vLocal: V(),
    feet: [0, 1].map(() => ({ w: V(), from: V(), to: V(), yaw: 0, swing: false, u: 0, dur: 0.4, lift: 0.1, ph: 0 })), last: 1, idleFor: 1, gp: 0,
    aim: { x: 0, v: 0 }, crouch: { x: 0, v: 0 }, lean: { x: 0, v: 0 }, bob: 0, aimYaw: 0, aimPitch: 0, lookYaw: 0, lookPitch: 0,
    recoil: { x: 0, v: 0 }, fp: { x: 0, v: 0 }, fr: { x: 0, v: 0 }, fy: { x: 0, v: 0 }, fd: { x: 0, v: 0 }, hp: { x: 0, v: 0 }, hy: { x: 0, v: 0 },
    limp: 0, limpSide: 0, alive: true, deadT: 0, fall: V(0, 0, 1), fallTwist: 0, fallSide: 0,
    rifleFree: null,
  };
  const inv = new Quaternion(), tmp = V(), tmp2 = V(), tmp3 = V();
  /** World point -> figure frame. */
  const toLocal = (w, out) => out.copy(w).sub(s.pos).applyAxisAngle(UP, -s.yaw);
  const toWorld = (l, out) => out.copy(l).applyAxisAngle(UP, s.yaw).add(s.pos);
  const groundAt = (x, z, y) => G.physics.groundHeight(x, z, y + 0.7);
  const footHome = (k, out, ahead = 0) => toWorld(out.set(k ? B.hipX + 0.015 : -B.hipX - 0.015, 0, -ahead), out);

  function start(v) {
    s.started = true; s.pos.copy(v.pos); s.yaw = v.yaw;
    for (let k = 0; k < 2; k++) { const f = s.feet[k]; footHome(k, f.w); f.w.y = groundAt(f.w.x, f.w.z, s.pos.y) + B.ankle; f.yaw = s.yaw; }
  }
  // ---- the gait ------------------------------------------------------------------------------------------------
  // Each foot stands for a share of the gait cycle (`duty`) and swings for the rest. The share is what the leg can
  // sweep at this speed: over half the cycle at a walk (both feet down for a moment), under it at a run (both in the
  // air for a moment). A foot lifts when its share ends and lands where the body will be half its stance later.
  function gait(dt, v) {
    const sp = s.speed, moving = sp > 0.25 && s.alive;
    for (const f of s.feet) if (f.swing) {
      f.u += dt / f.dur;
      const u = Math.min(1, f.u); f.w.lerpVectors(f.from, f.to, ease(u)); f.w.y += Math.sin(Math.PI * u) * f.lift;
      if (f.u >= 1) { f.swing = false; f.w.copy(f.to); }
    }
    if (!s.alive) return;
    if (moving) {
      const run = clamp((sp - 1.6) / 2.6, 0, 1), C = 2 * clamp(0.56 - sp * 0.055, 0.29, 0.56), reach = 0.78 + 0.2 * run, duty = clamp(reach / (sp * C), 0.32, 0.62);
      const dutyOf = (k) => (s.limp > 0.05 ? clamp(duty * (k === s.limpSide ? 0.72 : 1.18), 0.25, 0.75) : duty); // off the bad leg quickly
      let first = -1;
      if (s.idleFor > 0) { // from standing the first step is half a swing, so neither foot is left behind
        first = 1 - s.last; const d = dutyOf(first); s.gp = (d + (1 - d) * 0.5 - first * 0.5 + 2) % 1; s.idleFor = 0;
        for (let k = 0; k < 2; k++) s.feet[k].ph = (s.gp + k * 0.5) % 1;
        if (s.feet[first].swing) first = -1;
      }
      s.gp = (s.gp + dt / C) % 1;
      for (let k = 0; k < 2; k++) {
        const f = s.feet[k], ph = (s.gp + k * 0.5) % 1, d = dutyOf(k), was = f.ph; f.ph = ph;
        if (f.swing || (k !== first && !(was < d && ph >= d))) continue;
        const air = k === first ? (1 - ph) * C : (1 - d) * C;
        f.swing = true; f.u = 0; f.dur = air; f.from.copy(f.w); s.last = k;
        footHome(k, f.to).addScaledVector(tmp2.set(v.vx, 0, v.vz), air + d * C * 0.5);
        f.to.y = groundAt(f.to.x, f.to.z, s.pos.y) + B.ankle; f.yaw = s.yaw;
        f.lift = clamp(0.06 + sp * 0.03, 0.08, 0.2) * (s.limp > 0.05 && k === s.limpSide ? 0.5 : 1);
      }
      return;
    }
    s.idleFor += dt;
    if (s.idleFor < 0.15 || s.feet.some((f) => f.swing)) return;
    let k = -1, worst = 0.13; // a foot that strays while standing is put back under the body
    for (let i = 0; i < 2; i++) { const h = footHome(i, tmp); const d = Math.hypot(h.x - s.feet[i].w.x, h.z - s.feet[i].w.z) + Math.abs(wrap(s.yaw - s.feet[i].yaw)) * 0.25; if (d > worst) { worst = d; k = i; } }
    if (k < 0) return;
    const f = s.feet[k]; f.swing = true; f.u = 0; f.dur = 0.32; f.from.copy(f.w); s.last = k;
    footHome(k, f.to); f.to.y = groundAt(f.to.x, f.to.z, s.pos.y) + B.ankle; f.yaw = s.yaw; f.lift = 0.05;
  }
  // ---- the pose ------------------------------------------------------------------------------------------------
  const anL = V(), anR = V();
  function pose(dt, v) {
    const sp = s.speed, run = clamp((sp - 1.6) / 2.6, 0, 1), walk = clamp(sp / 1.4, 0, 1);
    const up = s.feet.map((f) => f.swing), flight = up[0] && up[1], swing = flight ? null : s.feet.find((f) => f.swing), su = swing ? Math.min(1, swing.u) : 0, stanceK = flight || !swing ? -1 : 1 - s.feet.indexOf(swing);
    toLocal(s.feet[0].w, anL); toLocal(s.feet[1].w, anR);
    // the aim: low on patrol, at the ready when alert, in the shoulder when it shoots
    const wantAim = !s.alive ? 0 : v.aim === 'tele' || v.aim === 'burst' ? 1 : v.engaged ? (sp < 0.6 ? 0.85 : 0.45) : v.alert ? 0.35 : 0;
    spring(s.aim, wantAim, 60, 14, dt); spring(s.crouch, v.crouch || 0, 50, 13, dt);
    const aim = clamp(s.aim.x, 0, 1), cr = clamp(s.crouch.x, 0, 1);
    // where it looks and aims, as angles from its front
    let ty = 0, tp = 0;
    if (v.target) { toLocal(v.target, tmp); tmp.y += 1.25 - 1.45; ty = Math.atan2(-tmp.x, -tmp.z); tp = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)); }
    else if (!sp) { ty = Math.sin(s.t * 0.37 + s.phase) * 0.55 * (1 - aim); tp = -0.05; }
    const k7 = 1 - Math.exp(-7 * dt);
    s.aimYaw += (clamp(ty, -0.85, 0.85) - s.aimYaw) * k7; s.aimPitch += (clamp(tp, -0.7, 0.6) - s.aimPitch) * k7;
    s.lookYaw += (clamp(ty, -1.1, 1.1) - s.lookYaw) * k7; s.lookPitch += (clamp(tp, -0.6, 0.5) - s.lookPitch) * k7;
    // pelvis: on the legs, lower in a crouch, a bob and a sway over the standing foot
    spring(s.lean, (0.06 + run * 0.16) * walk * (1 - aim * 0.6) + cr * 0.32 + aim * 0.06, 40, 12, dt);
    // a walk vaults over the standing leg; a run sinks onto it and rises in the flight between steps
    const bobWant = sp < 0.25 ? 0 : flight ? 0.03 * run : swing ? (run > 0.5 ? -0.025 : 0.018) * Math.sin(Math.PI * su) - 0.01 : -0.015;
    s.bob += (bobWant - s.bob) * (1 - Math.exp(-18 * dt)); const bob = s.bob;
    const sway = stanceK < 0 ? 0 : (stanceK ? 1 : -1) * 0.025 * walk * (1 - run * 0.6);
    let py = B.hip - 0.015 * walk - 0.05 * run - cr * 0.36 + bob + spring(s.fd, 0, 70, 12, dt) - (s.limp > 0.05 && stanceK === s.limpSide ? 0.035 * s.limp : 0);
    for (const [an, x] of [[anL, -B.hipX], [anR, B.hipX]]) { const dx = an.x - (x + sway), dz = an.z; py = Math.min(py, an.y + Math.sqrt(Math.max(0.01, (LEG * 0.985) ** 2 - dx * dx - dz * dz))); }
    J.hipC.set(sway, py, 0.02 * run);
    const twist = swing && sp > 0.25 ? (swing === s.feet[0] ? 1 : -1) * 0.1 * walk * Math.sin(Math.PI * su) : 0;
    const flP = spring(s.fp, 0, 90, 11, dt), flR = spring(s.fr, 0, 90, 11, dt), flY = spring(s.fy, 0, 80, 10, dt);
    F.pelvisFwd.set(0, 0, -1); rotY(F.pelvisFwd, twist + s.aimYaw * 0.25); F.pelvisUp.set(0, 1, 0);
    // spine: leans with speed and the crouch, twists to the aim, flinches
    const lean = s.lean.x + flP, sy = s.aimYaw * 0.7 - twist * 0.6 + flY;
    F.spineFwd.set(0, -Math.sin(lean), -Math.cos(lean)); F.spineUp.set(0, Math.cos(lean), -Math.sin(lean));
    const qy = new Quaternion().setFromAxisAngle(UP, sy), qr = new Quaternion().setFromAxisAngle(tmp.set(0, 0, -1), flR + sway * 1.2);
    F.spineFwd.applyQuaternion(qr).applyQuaternion(qy); F.spineUp.applyQuaternion(qr).applyQuaternion(qy);
    F.spineRight.crossVectors(F.spineFwd, F.spineUp).normalize();
    J.waist.copy(J.hipC).addScaledVector(F.pelvisUp, B.waistUp);
    J.neck.copy(J.waist).addScaledVector(F.spineUp, B.spine + 0.04); J.chest.copy(J.waist).addScaledVector(F.spineUp, 0.32);
    for (const [n, x] of [['shL', -1], ['shR', 1]]) J[n].copy(J.waist).addScaledVector(F.spineUp, B.shoulderUp).addScaledVector(F.spineRight, x * B.shoulderX);
    const pr = V().set(1, 0, 0).applyAxisAngle(UP, twist + s.aimYaw * 0.25);
    J.hipL.copy(J.hipC).addScaledVector(pr, -B.hipX); J.hipR.copy(J.hipC).addScaledVector(pr, B.hipX);
    // legs: knees forward, towards where the foot points
    const footFwd = (k) => V().set(-Math.sin(s.feet[k].yaw - s.yaw), 0, -Math.cos(s.feet[k].yaw - s.yaw));
    ik(J.hipL, anL, B.thigh, B.shin, footFwd(0).add(F.pelvisFwd), J.knL, J.anL);
    ik(J.hipR, anR, B.thigh, B.shin, footFwd(1).add(F.pelvisFwd), J.knR, J.anR);
    // the rifle: from low carry to the shoulder
    const ay = s.aimYaw * 0.3 + sy, ap = s.aimPitch;
    const fAim = V().set(0, Math.sin(ap), -Math.cos(ap)).applyAxisAngle(UP, ay);
    const fLow = V().set(0, 0, -1).applyAxisAngle(tmp.set(1, 0, 0), -0.75 - (1 - Math.min(1, aim * 3)) * 0.2).applyAxisAngle(UP, sy + 0.42);
    F.rifleF.copy(fLow).lerp(fAim, ease(aim)).normalize();
    const rec = spring(s.recoil, 0, 220, 20, dt);
    F.rifleF.y += rec * 0.5; F.rifleF.normalize();
    F.rifleU.copy(UP).addScaledVector(F.rifleF, -F.rifleF.y).normalize(); F.rifleR.crossVectors(F.rifleF, F.rifleU);
    // aim: the butt in the shoulder; low: the grip by the right hip, the muzzle down and across
    const pocket = V().copy(J.shR).addScaledVector(F.spineFwd, 0.06).addScaledVector(F.spineRight, -0.05).addScaledVector(F.spineUp, -0.035);
    const gripAim = V().copy(pocket).addScaledVector(F.rifleF, RIFLE.butt.z).addScaledVector(F.rifleU, -RIFLE.butt.y);
    const gripLow = V().copy(J.waist).addScaledVector(F.spineRight, 0.12).addScaledVector(F.spineFwd, 0.22).addScaledVector(F.spineUp, 0.09);
    J.grip.copy(gripLow).lerp(gripAim, ease(aim)).addScaledVector(F.rifleF, -rec * 0.06).addScaledVector(F.rifleU, Math.sin(s.t * 9.5) * 0.008 * run);
    // arms: hands on the grip and on the handguard
    const wrR = V().copy(J.grip).addScaledVector(F.rifleU, 0.055).addScaledVector(F.rifleF, -0.03);
    const sup = V().copy(RIFLE.support), wrL = V().copy(J.grip).addScaledVector(F.rifleF, -sup.z).addScaledVector(F.rifleU, -0.05).addScaledVector(F.rifleR, -0.045);
    ik(J.shR, wrR, B.upperArm, B.forearm, V().copy(F.spineRight).multiplyScalar(0.7).addScaledVector(F.spineUp, -1).addScaledVector(F.spineFwd, -0.2), J.elR, J.wrR);
    ik(J.shL, wrL, B.upperArm, B.forearm, V().copy(F.spineRight).multiplyScalar(-0.9).addScaledVector(F.spineUp, -0.8), J.elL, J.wrL);
    // head: on what it looks at; in the aim, down on the stock
    const hy = s.lookYaw * (1 - aim) + ay * aim - sy + spring(s.hy, 0, 120, 12, dt), hp = s.lookPitch * (1 - aim) + (ap - 0.08) * aim + spring(s.hp, 0, 120, 12, dt);
    F.headFwd.set(0, Math.sin(hp), -Math.cos(hp)).applyAxisAngle(UP, hy + sy); F.headUp.copy(F.spineUp).addScaledVector(F.spineRight, aim * 0.12).addScaledVector(F.headFwd, -0.1 * aim).normalize();
  }
  // ---- the fall ------------------------------------------------------------------------------------------------
  function fall(dt) {
    s.deadT += dt;
    const t = s.deadT, drop = 0.42 * ease(t / 0.3) * (1 - 0.7 * ease((t - 0.6) / 0.5)), th = (Math.PI / 2 - 0.06) * Math.pow(clamp((t - 0.08) / 0.78, 0, 1), 1.7);
    // a standing pose that buckles at the knees, then rotates about the feet towards `fall` until it lies
    J.hipC.y -= drop;
    const axis = V().crossVectors(UP, s.fall).normalize(), pivot = V().addVectors(anL, anR).multiplyScalar(0.5), q = new Quaternion().setFromAxisAngle(axis, th);
    const qt = new Quaternion().setFromAxisAngle(UP, s.fallTwist * ease(t / 0.9));
    for (const n of ['hipC', 'waist', 'chest', 'neck', 'shL', 'shR', 'hipL', 'hipR']) J[n].sub(pivot).applyQuaternion(qt).applyQuaternion(q).add(pivot);
    for (const f of ['pelvisUp', 'pelvisFwd', 'spineUp', 'spineFwd', 'spineRight']) F[f].applyQuaternion(qt).applyQuaternion(q);
    // limbs go slack: the arms fall to the ground beside the body, the legs follow the hips
    const g = groundLocal;
    for (const [sh, el, wr, x] of [[J.shL, J.elL, J.wrL, -1], [J.shR, J.elR, J.wrR, 1]]) {
      const reach = V().copy(sh).addScaledVector(F.spineRight, x * 0.25 * ease(t / 0.8)).addScaledVector(F.spineUp, -0.35); reach.y = Math.min(reach.y, g(reach) + 0.05);
      ik(sh, reach, B.upperArm, B.forearm, V().copy(F.spineFwd).negate().addScaledVector(UP, -0.3), el, wr);
    }
    const knee = (h, an, kn, out) => { an.y = Math.max(an.y, g(an) + B.ankle * 0.6); ik(h, an, B.thigh, B.shin, V().copy(F.pelvisFwd).addScaledVector(UP, 0.3), kn, out); };
    knee(J.hipL, anL, J.knL, J.anL); knee(J.hipR, anR, J.knR, J.anR);
    // nothing sinks into the ground
    for (const n of ['hipC', 'waist', 'neck', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR']) { const lo = g(J[n]) + (n === 'neck' || n === 'waist' || n === 'hipC' ? 0.12 : 0.06); if (J[n].y < lo) J[n].y = lo; }
    F.headFwd.copy(F.spineFwd); F.headUp.copy(J.neck).sub(J.waist).normalize();
    // the rifle, dropped: it falls and lies flat beside the body
    const rf = s.rifleFree;
    if (rf) {
      rf.vel.y -= 9.8 * dt; rf.pos.addScaledVector(rf.vel, dt);
      const floor = g(rf.pos) + 0.035; if (rf.pos.y < floor) { rf.pos.y = floor; rf.vel.multiplyScalar(0.3); rf.vel.y = 0; }
      const k = 1 - Math.exp(-3.5 * dt); rf.f.y += (0 - rf.f.y) * k; rf.f.normalize(); rf.u.lerp(rf.side, k).normalize();
      J.grip.copy(rf.pos); F.rifleF.copy(rf.f); F.rifleU.copy(rf.u).addScaledVector(rf.f, -rf.u.dot(rf.f)).normalize();
    }
  }
  const gl = V(), groundLocal = (p) => { toWorld(p, gl); return groundAt(gl.x, gl.z, gl.y + 0.3) - s.pos.y; };

  function apply() {
    setBone(bone.pelvis, J.hipC, F.pelvisUp, F.pelvisFwd);
    setBone(bone.spine, J.waist, F.spineUp, F.spineFwd);
    setBone(bone.head, J.neck, F.headUp, F.headFwd);
    for (const sd of ['L', 'R']) {
      const sh = J['sh' + sd], el = J['el' + sd], wr = J['wr' + sd], bend = V().subVectors(wr, sh); // an arm bends towards its hand
      if (bend.lengthSq() < 1e-6) bend.copy(F.spineFwd);
      setBone(bone['upperArm' + sd], sh, tmp.subVectors(sh, el), bend);
      setBone(bone['forearm' + sd], el, tmp.subVectors(el, wr), bend.add(F.rifleF));
      setBone(bone['hand' + sd], wr, V().subVectors(el, wr).normalize().multiplyScalar(0.4).add(F.rifleU), F.rifleF);
      const hip = J['hip' + sd], kn = J['kn' + sd], an = J['an' + sd], kf = V().subVectors(kn, hip).add(V().subVectors(kn, an)).multiplyScalar(0.5);
      setBone(bone['thigh' + sd], hip, V().subVectors(hip, kn), V().subVectors(kn, J.hipC).add(F.pelvisFwd).add(kf));
      setBone(bone['shin' + sd], kn, V().subVectors(kn, an), V().copy(kf).add(F.pelvisFwd));
      const f = s.feet[sd === 'L' ? 0 : 1], ff = V().set(-Math.sin(f.yaw - s.yaw), 0, -Math.cos(f.yaw - s.yaw));
      const toe = f.swing ? Math.sin(Math.PI * Math.min(1, f.u)) * 0.35 - 0.12 : 0; // the toe drops, then lifts, in a swing
      const fu = V().copy(UP).addScaledVector(ff, -Math.sin(toe)); if (!s.alive) fu.copy(F.pelvisUp).lerp(UP, 0.4);
      setBone(bone['foot' + sd], an, fu, ff);
    }
    setBone(bone.rifle, J.grip, F.rifleU, F.rifleF);
  }

  function update(dt, v) {
    if (!s.started) start(v);
    s.t += dt; s.pos.copy(v.pos); s.yaw = v.yaw; s.speed = Math.hypot(v.vx, v.vz);
    s.limp = Math.max(0, s.limp - dt * 0.12);
    if (v.limp !== undefined) { s.limp = v.limp; if (v.limpSide !== undefined) s.limpSide = v.limpSide; }
    gait(dt, v); pose(dt, v);
    if (!s.alive) fall(dt);
    apply();
  }
  /** The joints, in the world (for tests): ankles, knees, hips, hands, the head. */
  function joints() {
    root.updateMatrixWorld(true); const m = r.mesh.matrixWorld, out = {};
    for (const [k, p] of Object.entries(J)) out[k] = p.clone().applyMatrix4(m);
    out.headC = V().copy(J.neck).addScaledVector(F.headUp, 0.13).applyMatrix4(m);
    return out;
  }
  const ZONES = [['head', 'headC', 'headC', 0.125], ['torso', 'waist', 'chest', 0.175], ['torso', 'hipL', 'hipR', 0.13], ['arm', 'shL', 'elL', 0.06], ['arm', 'elL', 'wrL', 0.05], ['arm', 'shR', 'elR', 0.06], ['arm', 'elR', 'wrR', 0.05], ['leg', 'hipL', 'knL', 0.085, 0], ['leg', 'knL', 'anL', 0.065, 0], ['leg', 'hipR', 'knR', 0.085, 1], ['leg', 'knR', 'anR', 0.065, 1]];
  return {
    root, lens, kind: 'person', machine: false, mesh: r.mesh, state: s,
    update, joints,
    feet: () => s.feet.map((f) => f.w), swinging: () => s.feet.map((f, k) => (f.swing ? k : -1)).filter((k) => k >= 0),
    setFar(far) { if (far !== s.far) { s.far = far; r.mesh.geometry = far ? kit.far.geometry : kit.near.geometry; } },
    muzzle(out) { root.updateMatrixWorld(true); return out.copy(RIFLE.muzzle).applyMatrix4(bone.rifle.matrixWorld); },
    fired() { s.recoil.v += 3.2; s.fp.v -= 0.35; },
    /** A round arrived along `dir` (world) in `zone`: the body gives way to it (a reaction, not damage). */
    hit(dir, amount = 26, zone = 'torso', side) {
      const k = clamp(amount / 30, 0.3, 1.6), d = dir ? toLocal(tmp.copy(s.pos).add(dir), tmp) : tmp.set(0, 0, 1);
      d.y = 0; if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize();
      // pushed the way the round went: back if hit from the front, turned towards the wound's side
      s.fp.v += -d.z * 5.5 * k; s.fr.v += d.x * 4 * k; s.fy.v += (rng() - 0.5) * 5 * k;
      if (zone === 'head') { s.hp.v += -d.z * 9 * k; s.hy.v += d.x * 8 * k; }
      if (zone === 'leg') { s.fd.v -= 1.6 * k; s.limp = Math.min(1, s.limp + 0.6); s.limpSide = side ?? (d.x > 0 ? 0 : 1); }
      if (zone === 'arm') s.recoil.v += 2.5;
    },
    die(dir) {
      if (!s.alive) return;
      s.alive = false; s.deadT = 0;
      const d = dir ? toLocal(tmp.copy(s.pos).add(dir), V()) : V(0, 0, 1); d.y = 0;
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      s.fall.copy(d.normalize()).add(V((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6)).normalize(); s.fallTwist = (rng() - 0.5) * 1.2;
      for (const f of s.feet) if (f.swing) { f.swing = false; f.w.y = groundAt(f.w.x, f.w.z, s.pos.y) + B.ankle; }
      s.rifleFree = { pos: J.grip.clone(), vel: V().copy(s.fall).multiplyScalar(0.8).add(V(0, 0.6, 0)), f: F.rifleF.clone(), u: F.rifleU.clone(), side: V((rng() < 0.5 ? -1 : 1), 0, 0) };
    },
    /** Hit volumes in the world: capsules { a, b, r, part, side } along the bones. */
    zones() {
      const j = joints();
      return ZONES.map(([part, a, b, rad, side]) => ({ part, a: j[a], b: j[b], r: rad, side }));
    },
    dispose() { lens.dispose(); },
  };
}

/** The materials of people, made once per material set. */
export function personMats(G, base) {
  const cloth = G.mats.get('glove_fabric', { triplanar: true, vertexColors: true, color: 0xffffff });
  const gear = G.mats.get('polymer_black', { triplanar: true, vertexColors: true, color: 0xffffff });
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }); skin.name = 'skin';
  return { cloth, gear, skin, metal: G.mats.get('gunmetal', { triplanar: true, vertexColors: true, color: 0xffffff }), lensBase: base.lensBase };
}

/** One of a look's variants, picked by `rng`: the colours as linear RGB, the headgear, a pack or not. */
export function pickLook(look = {}, rng) {
  const pick = (a, d) => { const l = Array.isArray(a) && a.length ? a : d; return l[Math.floor(rng() * l.length) % l.length]; };
  return {
    cloth: lin(pick(look.cloth, ['#4b5139'])), gear: lin(pick(look.gear, ['#33352f'])), skin: lin(pick(look.skin, ['#a07a5e'])), boot: lin(pick(look.boot, ['#2a2622'])),
    headgear: pick(look.headgear, ['helmet']), pack: rng() < (look.pack ?? 0.3),
  };
}
