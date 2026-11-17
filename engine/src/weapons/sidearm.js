// The sidearm: a weapon object with the same interface as the carbine's (weapons/weapon.js), whose view model is
// weapons/views/pistol.js. It is built from the pack entry (`name`, `magSize`, `reserve`, `rpm`, `damage`, `range`,
// `auto`) and nothing else; nothing about one weapon is written here. Semi-automatic unless the entry says `auto: true`.
//
// What it does each frame (`update`): hip and aim-down-sights poses (the rear notch and the front post go to the middle
// of the view), sprint lowering, bob and sway, firing one round per press (or held, when `auto`), the slide cycling
// 45 mm in about 70 ms and staying back on an empty magazine, the trigger and barrel moving with it, a muzzle flash,
// a case from the port, the reload (magazine out, magazine in, slide release when it was empty), and the dry click.
// Events it emits are the carbine's: weapon:fire, weapon:dry, weapon:reload with phase start | magout | magin | bolt | done.
//
// THE PHONE. While the in-game phone is up (the world's `phone:raised` event, docs/WORLD-API.md) and this is the weapon in
// the hands, the view model moves in `SIDEARM.phoneRaise` seconds from wherever it is to `SIDEARM.phoneReady`: the pistol
// drawn back, high and close in the firing hand alone (the compressed ready of a soldier who works a chest-mounted phone
// with the other hand), muzzle forward and a little down, the support hand gone from the gun. It cannot fire, aim or
// reload there and does not bob; only a very slow breathing sway (`phoneReady.sway` metres). Lowering the phone returns
// the pose in `SIDEARM.phoneLower` seconds. The pose runs on `realFrame(seconds)`, which the engine calls every frame
// (the simulation, and so `update`, does not run under a pause). Without such a call `update` drives it.
//
// `deps.flash` is the carbine module's muzzle-flash factory (handed in so this file need not import it back).
import * as THREE from '../../vendor/three.module.js';
import { buildPistolView } from './views/pistol.js';
import { buildHands } from './views/hands.js';
import { zc } from '../shared/lifted.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
/** A critically soft spring: x follows target 0 after an impulse on v. */
const spring = (s, dt, k = 420, c = 26) => { const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let q = 0; q < n; q++) { s.v += (-s.x * k - s.v * c) * h; s.x += s.v * h; } return s.x; };

export const SIDEARM = Object.freeze({ hipPos: [0.075, -0.112, -0.285], adsDistance: 0.3, reloadSeconds: 1.75, reloadEmptySeconds: 2.1, slideOut: 0.025, slideBack: 0.045, travel: 0.045,
  // The phone-ready pose, in view-model space (metres, the view camera looking down -z): the gun's origin (the top of the
  // backstrap) and its rotation [pitch, yaw, roll] in DEGREES (pitch negative = muzzle down, yaw positive = muzzle to
  // the left, roll positive = top of the slide tilted to the left, inboard for a right hand). Tuned by picture at 16:9,
  // 16:10 and 21:9 (engine/tools/sidearm-shot.mjs) so that the slide, sights and muzzle stand above the phone's top edge.
  phoneReady: Object.freeze({ pos: Object.freeze([0.095, 0.020, -0.32]), rot: Object.freeze([-8, 14, 15]), sway: 0.0025 }),
  phoneRaise: 0.3, phoneLower: 0.25 });

export function createSidearm(i, weaponId, W, deps = {}) {
  const view = buildPistolView(THREE, {});
  const { group, parts, muzzle, ejection, dims } = view;
  const root = new THREE.Group(); root.name = 'viewmodel-' + weaponId;
  const pose = new THREE.Group(); pose.add(group); root.add(pose);
  const hands = buildHands(THREE, dims);
  pose.add(hands.right, hands.left);
  let flash = null;
  if (deps.flash) { flash = deps.flash(); flash.visible = false; muzzle.add(flash); }
  root.traverse((o) => o.layers.set(zc)); // the view-model pass
  for (const o of [group, hands.right, hands.left]) o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
  i.camera.add(root);

  const rng = i.rng && i.rng.fork ? i.rng.fork() : Math.random;
  const k = {
    t: 0, cooldown: 0, prevFire: false, dryDone: false, autoReload: -1, reload: null, lastShot: -9, bloom: 0, heat: 0,
    adsLin: 0, adsE: 0, sprintT: 0, slideT: 9, locked: false, finger: 0, flashT: 0, flashDur: 0.05, bobPhase: 0, bobAmt: 0,
    phoneOn: false, phoneP: 0, realSeen: false, wasGround: true, spread: 0.01, kZ: { x: 0, v: 0 }, kP: { x: 0, v: 0 }, swY: { x: 0, v: 0 }, swP: { x: 0, v: 0 }, burst: 0, mag: 1, magDrop: 0,
  };
  const dbg = { freeze: false, reloadT: null, empty: false, flash: false, noFire: false };
  const auto = W.auto !== false;
  const ve = {
    id: weaponId, name: W.name, ammo: W.magSize, magSize: W.magSize, reserve: W.reserve, state: 'idle', ads: 0, spread: 0.01, damage: W.damage, rpm: W.rpm,
    root, debug: dbg, info: { tris: Math.round(dims.triangles + hands.dims.triangles.total), meshes: 6 + hands.dims.drawCalls }, update, realFrame, reset, muzzleWorld, reloadNow, addAmmo(n) { ve.reserve += n; }, setWetness() {},
    setVisible(on) { root.visible = !!on; },
    snap() { k.adsLin = i.input.ads ? 1 : 0; k.sprintT = i.player.sprinting ? 1 : 0; for (const s of [k.kZ, k.kP, k.swY, k.swP]) { s.x = 0; s.v = 0; } },
  };

  // ---- poses: the gun's origin (top of the backstrap) in view space, and its pitch ----
  const adsPitch = -Math.atan2(dims.sightFront.y - dims.sightRear.y, dims.sightRear.z - dims.sightFront.z); // sight line level
  const adsPos = new THREE.Vector3();
  { // the rear notch must land on the view axis: pos + R * notch = (0, 0, -adsDistance)
    const n = dims.sightRear.clone().applyEuler(new THREE.Euler(adsPitch, 0, 0, 'YXZ'));
    adsPos.set(-n.x, -n.y, -SIDEARM.adsDistance - n.z);
  }
  const hipPos = new THREE.Vector3(...SIDEARM.hipPos);

  // ---- the phone: the world says when it is up; the pose moves on real time ----
  const phoneRaised = (e) => { k.phoneOn = !!(e && e.raised); };
  if (i.events.on) i.events.on('phone:raised', phoneRaised);
  /** Pose progress, 0 (hip) .. 1 (phone-ready): up in phoneRaise seconds, down in phoneLower. */
  function advancePhone(dt) {
    const was = k.phoneP;
    k.phoneP = clamp(k.phoneP + (k.phoneOn ? dt / SIDEARM.phoneRaise : -dt / SIDEARM.phoneLower), 0, 1);
    return k.phoneP !== was;
  }
  /** Called by the engine every frame with the real frame time, paused or not. */
  function realFrame(real) {
    k.realSeen = true;
    if (advancePhone(real) || k.phoneP > 0) animate(0);
  }
  const phoneBusy = () => k.phoneOn || k.phoneP > 0.02;

  function reset() {
    ve.ammo = W.magSize; ve.reserve = W.reserve; ve.state = 'idle'; ve.ads = 0;
    Object.assign(k, { cooldown: 0, prevFire: false, dryDone: false, autoReload: -1, reload: null, lastShot: -9, bloom: 0, heat: 0, adsLin: 0, adsE: 0, sprintT: 0, slideT: 9, locked: false, flashT: 0, burst: 0, magDrop: 0 });
    for (const s of [k.kZ, k.kP, k.swY, k.swP]) { s.x = 0; s.v = 0; }
    parts.magazine.visible = true; animate(0);
  }

  // ---- a point of the view model in the world, as the carbine does it (the view camera has its own field of view) ----
  const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
  function worldOf(obj, out) {
    const cam = i.camera;
    obj.updateWorldMatrix(true, false); cam.updateMatrixWorld();
    m4.copy(cam.matrixWorld).invert();
    out.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(m4);
    const s = Math.tan(cam.fov * Math.PI / 360) / Math.tan(i.viewCamera.fov * Math.PI / 360);
    out.x *= s; out.y *= s;
    return out.applyQuaternion(cam.quaternion).add(cam.position);
  }
  function muzzleWorld(out = new THREE.Vector3()) { return worldOf(muzzle, out); }

  function reloadNow() {
    if (k.reload || ve.ammo >= ve.magSize || ve.reserve <= 0 || phoneBusy()) return false;
    const empty = ve.ammo <= 0;
    k.reload = { t: 0, T: empty ? SIDEARM.reloadEmptySeconds : SIDEARM.reloadSeconds, empty, f: {} };
    k.autoReload = -1;
    i.events.emit('weapon:reload', { phase: 'start', empty });
    return true;
  }

  const o = new THREE.Vector3(), d = new THREE.Vector3(), hit = new THREE.Vector3(), mz = new THREE.Vector3(), ej = new THREE.Vector3(), sv = new THREE.Vector3();
  function fire() {
    const p = i.player, cam = i.camera;
    ve.ammo--; k.burst++; k.lastShot = k.t; k.heat = Math.min(1.2, k.heat + 0.12);
    const a = rng() * Math.PI * 2, r = Math.tan(k.spread) * Math.sqrt(rng());
    d.set(Math.cos(a) * r, Math.sin(a) * r, -1).normalize().applyQuaternion(cam.quaternion);
    o.copy(p.eye || cam.position);
    let res = null;
    try { res = i.combat.playerShot(o, d, { damage: W.damage, range: W.range }); } catch { /* a shot that cannot be resolved is still fired */ }
    if (res && res.point) hit.copy(res.point); else hit.copy(o).addScaledVector(d, W.range);
    muzzleWorld(mz);
    const fx = i.fx;
    if (fx) {
      if (fx.tracer) fx.tracer(mz, hit);
      if (fx.shell) {
        worldOf(ejection, ej);
        sv.set(1.6 + rng() * 1.0, 1.4 + rng() * 0.8, 0.4 - rng() * 0.5).applyQuaternion(cam.quaternion);
        if (p.vel) sv.add(p.vel);
        fx.shell(ej, sv);
      }
    }
    if (i.render && i.render.lightPool) i.render.lightPool.flash(mz, 16756832, 40, 8, 0.05);
    i.events.emit('weapon:fire', { origin: o, dir: d, muzzle: mz, ads: k.adsE });
    const bt = lerp(1, 0.6, k.adsE) * (p.crouching ? 0.85 : 1);
    if (p.addRecoil) p.addRecoil(0.011 * bt * (0.85 + rng() * 0.3), (rng() - 0.5) * 0.004 * bt);
    if (p.addShake) p.addShake(0.1 * bt);
    k.kZ.v += 1.1 * lerp(1, 0.6, k.adsE); k.kP.v += 1.9 * bt; k.bloom = Math.min(1, k.bloom + 0.22);
    k.flashT = k.flashDur = 0.032 + rng() * 0.018;
    if (flash) {
      const u = flash.material.uniforms;
      if (u.uSeed) u.uSeed.value = rng() * 100; if (u.uJet) u.uJet.value = 0.5 + rng() * 0.5;
      flash.rotation.z = (rng() - 0.5) * 0.4;
      const s = (0.5 + rng() * 0.3) * lerp(1, 0.62, k.adsE); flash.scale.set(s, s, s * (0.8 + rng() * 0.4));
    }
    k.slideT = 0;
    if (ve.ammo <= 0) k.locked = true;
  }

  // slide offset in metres at time t after a shot: out in `slideOut`, back in `slideBack`; held back when locked
  const slideAt = (t) => {
    const out = SIDEARM.slideOut, back = SIDEARM.slideBack;
    if (t < out) return ease(t / out) * SIDEARM.travel;
    if (t < out + back) return (1 - ease((t - out) / back)) * SIDEARM.travel;
    return 0;
  };

  function update(dt) {
    const p = i.player, inp = i.input;
    if (!p || !inp || !p.alive) { k.prevFire = false; if (flash) flash.visible = false; return; }
    k.t += dt;
    if (!k.realSeen) advancePhone(dt);
    const phone = phoneBusy();
    const want = !!inp.fire && root.visible && !dbg.noFire && !phone, edge = want && !k.prevFire;
    k.prevFire = want; if (!want) k.dryDone = false;
    const sprint = !!p.sprinting && !want && !inp.ads && !k.reload && !phone;
    k.sprintT = damp(k.sprintT, sprint ? 1 : 0, 9, dt);
    if (inp.pressed && inp.pressed('reload')) reloadNow();
    if (k.autoReload >= 0 && (k.autoReload -= dt) < 0) reloadNow();
    if (phone) k.autoReload = -1;
    if (dbg.reloadT != null && !k.reload) k.reload = { t: 0, T: SIDEARM.reloadSeconds, empty: dbg.empty, f: {} };

    let magSlide = 0;
    if (k.reload) {
      const R = k.reload; R.t = dbg.reloadT != null ? dbg.reloadT : R.t + dt; const t = R.t;
      const once = (n, at) => (t >= at && !R.f[n] ? (R.f[n] = 1, i.events.emit('weapon:reload', { phase: n, empty: R.empty }), true) : false);
      // 0.30 magazine out, 0.55 new magazine at the well, 0.95 seated; slide release at 1.35 when it was empty
      once('magout', 0.3);
      if (t < 0.3) magSlide = 0; else if (t < 0.55) magSlide = ease((t - 0.3) / 0.25) * 0.16; else if (t < 0.95) magSlide = (1 - ease((t - 0.55) / 0.4)) * 0.16; else magSlide = 0;
      if (once('magin', 0.95)) { const n = Math.min(ve.magSize - ve.ammo, ve.reserve); ve.ammo += n; ve.reserve -= n; k.kZ.v -= 0.4; if (!R.empty) k.locked = false; }
      if (R.empty && t >= 1.35 && !R.f.bolt) { R.f.bolt = 1; i.events.emit('weapon:reload', { phase: 'bolt', empty: true }); k.locked = false; k.slideT = 0.001; }
      k.reloadW = Math.min(ease(t / 0.3), 1 - ease((t - (R.T - 0.4)) / 0.4));
      if (t >= R.T && dbg.reloadT == null) { k.reload = null; k.reloadW = 0; i.events.emit('weapon:reload', { phase: 'done' }); }
    } else k.reloadW = 0;
    k.magDrop = magSlide;

    k.cooldown -= dt;
    const canFire = !k.reload && k.sprintT < 0.45 && !phone;
    if ((auto ? want : edge) && canFire) {
      if (ve.ammo > 0) { if (k.cooldown <= 0) { fire(); k.cooldown = 60 / W.rpm; } }
      else if (!k.dryDone) { k.dryDone = true; i.events.emit('weapon:dry', {}); k.kZ.v -= 0.05; if (ve.reserve > 0) k.autoReload = 0.3; }
    } else if (edge && !canFire && ve.ammo <= 0 && !k.dryDone) k.dryDone = true;
    if (k.cooldown < 0) k.cooldown = -0.001;
    if (k.t - k.lastShot > 0.3) k.burst = 0;
    k.bloom = Math.max(0, k.bloom - dt * 1.6); k.heat = Math.max(0, k.heat - dt * 0.25);

    const wantAds = !!inp.ads && !k.reload && k.sprintT < 0.35 && !phone;
    k.adsLin = clamp(k.adsLin + (wantAds ? dt : -dt) / 0.16, 0, 1); k.adsE = ease(k.adsLin); ve.ads = k.adsE;
    const speed = p.speed || 0, sp = clamp(speed / 6, 0, 1);
    k.spread = damp(k.spread, lerp(0.0105, 0.0009, k.adsE) + sp * lerp(0.012, 0.004, k.adsE) + k.bloom * lerp(0.0055, 0.002, k.adsE) + (p.onGround === false ? 0.02 : 0) - (p.crouching ? 0.0015 * (1 - k.adsE) : 0), 18, dt);
    ve.spread = k.spread;
    ve.state = k.reload ? 'reloading' : k.sprintT > 0.5 ? 'sprinting' : k.t - k.lastShot < 0.14 ? 'firing' : 'idle';

    k.slideT += dt;
    k.finger = damp(k.finger, want && canFire ? 1 : 0, 28, dt);
    if (flash) {
      const u = flash.material.uniforms;
      if (dbg.flash) k.flashT = k.flashDur = 0.05;
      k.flashT -= dt;
      if (u.uInt) u.uInt.value = k.flashT > 0 ? 9 * Math.sqrt(Math.max(0, k.flashT / k.flashDur)) : 0;
      if (u.uHeat) u.uHeat.value = 0;
      flash.visible = !!(u.uInt && u.uInt.value > 0);
    }
    if (dbg.freeze) return;

    // bob, sway, springs
    const onG = p.onGround !== false;
    k.bobAmt = damp(k.bobAmt, onG ? clamp(speed / 3.6, 0, 1) : 0, 8, dt);
    k.bobPhase += dt * (speed > 0.3 && onG ? 5.2 + speed * 1.55 : 0);
    const bob = k.bobAmt * lerp(1, 0.12, k.adsE) * (1 + k.sprintT * 1.2);
    const lk = inp.look || { dx: 0, dy: 0 };
    k.swY.v += clamp(lk.dx, -0.2, 0.2) * 3.0 * lerp(1, 0.4, k.adsE); k.swP.v += clamp(lk.dy, -0.2, 0.2) * 2.4 * lerp(1, 0.4, k.adsE);
    spring(k.swY, dt, 110, 15); spring(k.swP, dt, 110, 15); k.swY.x = clamp(k.swY.x, -0.09, 0.09); k.swP.x = clamp(k.swP.x, -0.07, 0.07);
    spring(k.kZ, dt, 520, 30); spring(k.kP, dt, 380, 26);
    animate(dt, bob);
  }

  const eul = new THREE.Euler(), pos = new THREE.Vector3(), PR = SIDEARM.phoneReady;
  function animate(dt, bob = 0) {
    const a = k.adsE, hip = 1 - a, sp = k.sprintT, rl = k.reloadW || 0;
    const ph = ease(k.phoneP), calm = 1 - ph;              // the phone pose has no bob, sway or kick
    // pose of the whole gun
    pos.copy(hipPos).lerp(adsPos, a);
    pos.x += (-k.swY.x * 0.05 + Math.sin(k.bobPhase) * 0.005 * bob + (sp * -0.03) + (rl * -0.02)) * calm;
    pos.y += (k.swP.x * 0.04 + Math.sin(2 * k.bobPhase) * 0.004 * bob - sp * 0.05 - rl * 0.045) * calm;
    pos.z += (k.kZ.x * 0.5 + sp * 0.03 + rl * 0.02) * calm;
    let pitch = lerp(0.07, adsPitch, a) + (k.kP.x + k.swP.x + sp * -0.35 + rl * 0.5) * calm;
    let yaw = lerp(0.04, 0, a) + (k.swY.x + sp * 0.45 + rl * 0.1) * calm;
    let roll = hip * 0.02 - sp * 0.2 + rl * -0.35;
    if (ph > 0) { // drawn back to the chest, high and close, in the firing hand; breathing only
      const D = Math.PI / 180, br = Math.sin(k.t * 1.1) * PR.sway * ph;
      pos.x = lerp(pos.x, PR.pos[0], ph); pos.y = lerp(pos.y, PR.pos[1], ph) + br; pos.z = lerp(pos.z, PR.pos[2], ph) + br * 0.5;
      pitch = lerp(pitch, PR.rot[0] * D, ph) + br * 0.4; yaw = lerp(yaw, PR.rot[1] * D, ph); roll = lerp(roll, PR.rot[2] * D, ph);
    }
    eul.set(pitch, yaw, roll, 'YXZ');
    pose.position.copy(pos); pose.rotation.copy(eul);
    // moving parts
    const slide = k.locked && k.slideT > SIDEARM.slideOut ? SIDEARM.travel : slideAt(k.slideT);
    parts.slide.position.z = slide;
    const unlocked = clamp(slide / SIDEARM.travel, 0, 1) > 0.02 && !k.locked ? 1 : 0;
    parts.barrel.rotation.x = dims.anim.barrelTilt * Math.sin(Math.PI * clamp(k.slideT / (SIDEARM.slideOut + SIDEARM.slideBack), 0, 1)) * (unlocked || k.slideT < 0.1 ? 1 : 0);
    parts.trigger.rotation.x = dims.anim.triggerPull * k.finger;
    parts.slideStop.rotation.x = k.locked ? -0.12 : 0;
    parts.magazine.position.copy(dims.gripAxis).multiplyScalar(k.magDrop);
    parts.magazine.visible = !(k.reload && k.magDrop > 0.15 && k.reload.t < 0.45);
    // hands: the finger on the trigger while firing; the support hand lets go in a reload and leaves for the phone
    hands.setFire(k.finger * calm);
    const lv = Math.max(rl * 0.8, ph);
    hands.left.position.set(-0.05 * lv, -0.12 * lv - rl * 0.02, 0.06 * lv);
    hands.left.visible = ph < 0.97;
  }

  reset();
  return ve;
}

