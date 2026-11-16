// The threats module: bodies in the world driven by the brains of brain.js over the archetypes of the content pack (content/default.js, or the product's).
// It keeps the surface the lifted combat and audio modules expect of `enemies` (list, spawn, raycast, aliveCount,
// clear, alert, update, and the enemy:* events) and replaces what was behind it: two hard-coded machines.
//
// This file does: perception (line of sight through the physics, hearing from events), moving a body where its
// state says (ground threats walk the nav grid and collide like the player; air threats fly over the terrain),
// shooting, taking damage. It decides nothing: the state table does.
//
// How a fight goes is the stand-in game's, rebuilt here over archetype data (engine/docs/PARITY.md):
//   notice     a threat reacts after the target has been in view for `senses.notice` seconds, not at once
//   tokens     only TUNING.maxTokens threats may be shooting at one time, TUNING.tokenGap seconds apart
//   warning    every burst and every rush is announced (`enemy:telegraph`: a sound, and the figure's lens flares)
//   exposure   aim tightens from weapon.spreadFar to spreadNear while the target stays in view, and widens when
//              the target moves fast
//   bolts      a weapon of kind `bolt` shoots a projectile that flies, can be side-stepped and hits walls
//   skirmish   ground threats run to a firing place with a line of sight, apart from each other, and move on
//   melee      an archetype with `melee` rushes a target that comes too close
//   death      a ground threat drops, sparks and smokes; an air threat spins down and may explode
//   intensity  the music follows the fight (audio.setIntensity): calm, alerted, in contact
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3 } from '../../vendor/three.module.js';
import { DEFAULT_PACK } from '../content/default.js';
import { canSee, canHear, createBrain, validateBehaviour } from './brain.js';

const GRAVITY = 21;
/** The rhythm of a fight. The values are the stand-in game's tuning constants. */
export const TUNING = DEFAULT_PACK.threatTuning; // the default pack's numbers; a pack's own arrive through createThreats
const LENS_CALM = [8, 4, 0.7], LENS_HOT = [14, 1, 0.35];
const between = (v, rng) => (Array.isArray(v) ? v[0] + rng() * (v[1] - v[0]) : +v || 0);

/** Squared distance between the segments p1-q1 and p2-q2. Pure. */
export function segmentDistanceSq(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z, rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const b = d1x * d2x + d1y * d2y + d1z * d2z, c = d1x * rx + d1y * ry + d1z * rz, den = a * e - b * b;
    s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  } else if (a > 1e-9) s = Math.min(1, Math.max(0, -(d1x * rx + d1y * ry + d1z * rz) / a));
  else if (e > 1e-9) t = Math.min(1, Math.max(0, f / e));
  const x = rx + d1x * s - d2x * t, y = ry + d1y * s - d2y * t, z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}
const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3();

function part(geo, mat, x, y, z, parent) { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

/** Our own figures, built from primitives: a person, a four-legged machine and a quadcopter. None is taken from the stand-in game. */
function buildModel(def) {
  const g = new Group(), figure = def.body.figure || (def.type === 'air' ? 'quadcopter' : 'person');
  const lens = new MeshBasicMaterial({ color: 0xffffff }); lens.color.setRGB(...LENS_CALM);
  if (figure === 'quadruped') {
    const shell = new MeshStandardMaterial({ color: 0x8d9296, roughness: 0.6, metalness: 0.2 }), dark = new MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.4 });
    const h = def.body.height, legs = [];
    part(new BoxGeometry(0.42, 0.26, 0.95), shell, 0, h - 0.33, 0, g);
    part(new BoxGeometry(0.3, 0.2, 0.3), dark, 0, h - 0.12, -0.5, g); // head
    part(new BoxGeometry(0.2, 0.06, 0.02), lens, 0, h - 0.1, -0.66, g).castShadow = false;
    part(new BoxGeometry(0.07, 0.07, 0.5), dark, 0, h - 0.02, -0.3, g); // gun
    for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) { const hip = new Group(); hip.position.set(sx * 0.25, h - 0.4, sz * 0.36); g.add(hip); part(new BoxGeometry(0.09, h - 0.4, 0.11), dark, 0, -(h - 0.4) / 2, 0, hip); legs.push(hip); }
    g.userData = { legs, lens, muzzle: new Vector3(0, h - 0.02, -0.6) };
  } else if (figure === 'person') {
    const cloth = new MeshStandardMaterial({ color: 0x4a5138, roughness: 0.9 }), kit = new MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.7 }), skin = new MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
    const legL = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, -0.11, 0.43, 0, g), legR = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, 0.11, 0.43, 0, g);
    part(new BoxGeometry(0.46, 0.6, 0.26), cloth, 0, 1.16, 0, g);
    part(new BoxGeometry(0.5, 0.34, 0.3), kit, 0, 1.2, 0.01, g); // vest
    part(new BoxGeometry(0.2, 0.22, 0.22), skin, 0, 1.6, 0, g);
    part(new SphereGeometry(0.15, 10, 8), kit, 0, 1.69, 0, g).scale.set(1, 0.75, 1.1); // helmet
    const arms = new Group(); arms.position.set(0, 1.32, 0); g.add(arms);
    part(new BoxGeometry(0.12, 0.12, 0.5), cloth, -0.2, 0, -0.2, arms); part(new BoxGeometry(0.12, 0.12, 0.5), cloth, 0.2, 0, -0.2, arms);
    part(new BoxGeometry(0.06, 0.1, 0.8), kit, 0.08, 0.02, -0.5, arms); // rifle
    part(new BoxGeometry(0.03, 0.03, 0.03), lens, 0.08, 0.1, -0.88, arms).castShadow = false; // the weapon light: it flares before a burst
    g.userData = { legL, legR, arms, lens, muzzle: new Vector3(0.08, 1.34, -0.95) };
  } else {
    const shell = new MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.3 }), led = new MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 6 });
    part(new BoxGeometry(0.34, 0.12, 0.46), shell, 0, 0, 0, g);
    part(new SphereGeometry(0.09, 10, 8), shell, 0, -0.1, -0.16, g); // camera ball
    part(new SphereGeometry(0.04, 8, 6), lens, 0, -0.11, -0.23, g).castShadow = false;
    part(new BoxGeometry(0.05, 0.03, 0.05), led, 0, 0.02, 0.24, g);
    const rotors = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = part(new BoxGeometry(0.5, 0.03, 0.05), shell, sx * 0.24, 0.02, sz * 0.24, g); arm.rotation.y = sx * sz * 0.78;
      const r = part(new CylinderGeometry(0.2, 0.2, 0.012, 14), new MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, transparent: true, opacity: 0.55 }), sx * 0.42, 0.06, sz * 0.42, g); r.castShadow = false; rotors.push(r);
    }
    g.userData = { rotors, lens, muzzle: new Vector3(0, -0.12, -0.28) };
  }
  return g;
}

export function createThreats(G, { archetypes = DEFAULT_PACK.threats, tuning = TUNING } = {}) {
  for (const def of Object.values(archetypes)) { const e = validateBehaviour(def); if (e.length) throw new Error('threats: ' + e.join('; ')); }
  const root = new Group(); root.name = 'enemies'; G.scene.add(root);
  const list = [], rng = G.rng.fork(), UP = new Vector3(0, 1, 0);
  let nextId = 1, noises = [], now = 0, playerSpeed = 0, intensity = -1, calmIn = 0;
  const noise = (pos, loudness) => { if (pos) noises.push({ x: pos.x, y: pos.y, z: pos.z, loudness }); };
  G.events.on('weapon:fire', () => noise(G.player.pos, 90));
  G.events.on('player:step', (e) => { if (e && e.sprint) noise(e.pos, 12); });
  G.events.on('player:land', (e) => noise(e && e.pos, 10));
  G.events.on('explosion', (e) => noise(e && e.pos, 150));
  const fx = (name, ...args) => { try { if (G.fx && G.fx[name]) G.fx[name](...args); } catch { /* effects are optional */ } };

  // ---- who may shoot ---------------------------------------------------------------------------------------------
  // A fight is readable because few threats shoot at a time and each burst is announced.
  const tokens = { held: 0, at: -9 };
  function requestToken(t) {
    if (t.hasToken) return true;
    const max = aliveCount() > tuning.crowd ? tuning.maxTokensCrowd : tuning.maxTokens;
    if (tokens.held >= max || now - tokens.at < tuning.tokenGap) return false;
    tokens.held++; tokens.at = now; t.hasToken = true; return true;
  }
  function releaseToken(t) { if (t.hasToken) { t.hasToken = false; tokens.held = Math.max(0, tokens.held - 1); } }
  const calm = (t) => { releaseToken(t); t.atk = 'idle'; t.es = null; };

  // `kind` is an archetype id, or the broad class the scene format's anchors use (ground | air)
  const defOf = (kind) => (typeof kind === 'string' && Object.hasOwn(archetypes, kind) ? archetypes[kind] : Object.values(archetypes).find((d) => d.type === kind)) || null;
  function spawn(kind, pos, opts = {}) {
    const def = defOf(kind);
    if (!def) return null;
    const model = buildModel(def), t = {
      id: opts.id || `${def.id}-${nextId++}`, type: def.type, archetype: def.id, def, model,
      pos: new Vector3(pos.x, pos.y, pos.z), vel: new Vector3(), yaw: opts.yaw || 0, alive: true, health: def.body.health,
      brain: createBrain(def), get mode() { return t.brain.state; },
      route: (opts.route || []).map((p) => new Vector3(p[0] ?? p.x, 0, p[1] ?? p.z)), routeAt: 0,
      path: null, pathAt: 0, pathFor: null, repath: 0, grounded: true,
      los: false, sees: false, seeT: 0, lostFor: 99, exposure: 0, lastKnown: null, heard: false, hurt: false, arrived: false, noCover: false, cover: null,
      senseIn: rng() * 0.2, atk: 'idle', atkT: 0, shots: 0, bursts: 0, lead: 0.5, hasToken: false, cooldown: 0.6 + rng(), flare: 0, lens: [...LENS_CALM],
      es: null, esT: 0, moveT: 0, lungeIn: 0.3, firePos: new Vector3(), firePlayer: new Vector3(),
      reportIn: 0, orbit: rng() * 6.28, orbitDir: rng() < 0.5 ? 1 : -1, orbitR: between(def.orbitRadius ?? 25, rng), orbitAlt: between(def.orbitAltitude ?? def.body.altitude ?? 15, rng), flipIn: 3 + rng() * 4, phase: rng() * 6.28,
      stride: 0, deadFor: 0, spin: 0, smokeIn: 0, landed: false,
      damage(amount, point, dir, bodyPart) {
        if (!t.alive) return false;
        t.health -= amount; t.hurt = true;
        if (!t.lastKnown && G.player) t.lastKnown = G.player.pos.clone();
        if (dir && t.type === 'air') t.vel.addScaledVector(dir, Math.min(3, amount * 0.09));
        G.events.emit('enemy:hit', { enemy: t, amount, point, part: bodyPart });
        if (t.health > 0) return false;
        t.alive = false; t.deadFor = 0; calm(t); t.model.userData.lens.color.setRGB(0.3, 0.05, 0.02);
        if (t.type === 'air') { t.spin = (rng() < 0.5 ? -1 : 1) * (5 + rng() * 3); t.vel.y += 1.5; if (dir) t.vel.addScaledVector(dir, 2.5); } else t.vel.set(0, 0, 0);
        fx('sparks', point || t.pos, UP, 14); fx('debris', point || t.pos, { count: 3 }); fx('smoke', t.pos, { size: 0.5, life: 1 });
        G.events.emit('enemy:killed', { enemy: t, type: t.type, pos: t.pos });
        return true;
      },
    };
    if (def.type === 'air') t.pos.y = Math.max(t.pos.y, G.physics.groundHeight(t.pos.x, t.pos.z) + (def.body.altitude || 20));
    if (opts.alerted && G.player) { t.lastKnown = G.player.pos.clone(); t.heard = true; } // starts out looking for the player
    root.add(model); list.push(t); place(t);
    G.events.emit('enemy:spawn', { enemy: t });
    return t;
  }
  function place(t) { t.model.position.copy(t.pos); t.model.rotation.y = t.yaw; }
  function remove(t) { releaseToken(t); t.model.removeFromParent(); t.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); G.events.emit('enemy:despawn', { enemy: t }); }
  const aliveCount = () => list.reduce((n, t) => n + (t.alive ? 1 : 0), 0);

  /** Tell threats within `radius` of `from` where something is. `from` defaults to the place itself. */
  function alert(pos, radius = 60, from = pos, except = null) {
    for (const t of list) if (t.alive && t !== except && t.pos.distanceTo(from) <= radius) { t.heard = true; t.lastKnown = new Vector3(pos.x, pos.y, pos.z); }
  }

  const eyeOf = (t, out) => out.set(t.pos.x, t.pos.y + (t.def.senses.eye || 0), t.pos.z);
  const targetPoint = (out) => out.set(G.player.pos.x, G.player.pos.y + (G.player.crouching ? 0.9 : 1.4), G.player.pos.z);
  const fighting = (t) => { const a = t.brain.action; return a === 'attack' || a === 'skirmish' || a === 'orbitTarget'; };

  function sense(t, dt) {
    const p = G.player, s = t.def.senses;
    t.senseIn -= dt;
    if (t.senseIn <= 0) {
      t.senseIn = 0.11 + rng() * 0.08;
      const eye = eyeOf(t, tmpA), tp = targetPoint(tmpB);
      // in a fight it keeps track of the target without having to face it
      t.los = !!p && p.alive && canSee({ x: eye.x, y: eye.y, z: eye.z, fx: -Math.sin(t.yaw), fz: -Math.cos(t.yaw) }, tp, fighting(t) ? { ...s, fov: 360 } : s, (a, b) => G.physics.lineOfSight(a, b));
    }
    if (t.los) { t.seeT += dt; t.lostFor = 0; t.lastKnown = (t.lastKnown || new Vector3()).copy(p.pos); t.exposure = Math.min(1, t.exposure + dt * tuning.exposureUp); }
    else { t.seeT = Math.max(0, t.seeT - dt * 0.6); t.lostFor += dt; t.exposure = Math.max(0, t.exposure - dt * tuning.exposureDown); }
    const notice = (s.notice || 0) * (t.brain.state === t.def.behaviour.start ? 1 : 0.45);
    t.sees = t.los && (fighting(t) || t.seeT >= notice);
    for (const n of noises) if (canHear(t.pos, n, n.loudness, s)) { t.heard = true; t.lastKnown = (t.lastKnown || new Vector3()).set(n.x, n.y, n.z); }
  }

  // ---- moving ----------------------------------------------------------------------------------------------------
  function turnTo(t, x, z, dt) {
    const want = Math.atan2(-(x - t.pos.x), -(z - t.pos.z)); let d = want - t.yaw;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    const max = t.def.body.turn * dt; t.yaw += Math.max(-max, Math.min(max, d));
    return Math.abs(d);
  }
  /** Walk towards a goal along the nav grid. Sets t.arrived. */
  function walkTo(t, goal, speed, dt) {
    const nav = G.nav;
    t.repath -= dt;
    if (!t.path || !t.pathFor || t.pathFor.distanceToSquared(goal) > 4 || t.repath <= 0) {
      t.pathFor = (t.pathFor || new Vector3()).copy(goal); t.repath = 2 + rng();
      t.path = nav.clearLine(t.pos, goal) ? [goal.clone()] : nav.findPath(t.pos, goal); t.pathAt = 0;
      if (t.path && t.path.length > 1) t.pathAt = 1;
    }
    const d = Math.hypot(goal.x - t.pos.x, goal.z - t.pos.z);
    t.arrived = d < 1.2 || !t.path;
    let vx = 0, vz = 0;
    if (!t.arrived && speed > 0) {
      let wp = t.path[Math.min(t.pathAt, t.path.length - 1)];
      if (Math.hypot(wp.x - t.pos.x, wp.z - t.pos.z) < 0.7 && t.pathAt < t.path.length - 1) wp = t.path[++t.pathAt];
      const l = Math.hypot(wp.x - t.pos.x, wp.z - t.pos.z) || 1;
      // a body that turns slowly does not run sideways: it slows down until it faces its way
      const off = turnTo(t, wp.x, wp.z, dt), k = off > 1.1 ? 0 : 1 - off * 0.5;
      vx = ((wp.x - t.pos.x) / l) * speed * k; vz = ((wp.z - t.pos.z) / l) * speed * k;
    }
    step(t, vx, vz, dt);
  }
  function step(t, vx, vz, dt) {
    t.vel.x = vx; t.vel.z = vz; t.vel.y -= GRAVITY * dt;
    const r = G.physics.moveCapsule(t.pos, t.vel, dt, t.def.body.radius, t.def.body.height, t.grounded);
    t.grounded = r.onGround;
    const sp = Math.hypot(vx, vz);
    if (sp > 0.3 && t.grounded) { const before = Math.floor(t.stride); t.stride += (sp * dt) / 0.8; if (Math.floor(t.stride) > before) G.events.emit('enemy:step', { enemy: t, type: t.type, pos: t.pos, speed: sp }); }
  }
  function flyTo(t, x, z, altitude, speed, dt) {
    const dx = x - t.pos.x, dz = z - t.pos.z, d = Math.hypot(dx, dz);
    t.arrived = d < 4;
    const k = Math.min(1, d / 6) * speed; let ax = d > 0.01 ? (dx / d) * k : 0, az = d > 0.01 ? (dz / d) * k : 0, bob = 0;
    if (t.health < t.def.body.health * 0.5) { ax += Math.sin(now * 7.3 + t.phase) * 2.2; az += Math.cos(now * 6.1 + t.phase) * 2.2; bob = Math.sin(now * 9.7 + t.phase) * 1.2; } // damaged: it flies wild
    t.vel.x += (ax - t.vel.x) * Math.min(1, dt * 1.6); t.vel.z += (az - t.vel.z) * Math.min(1, dt * 1.6);
    // hold height above whatever is below and ahead (ground or roof)
    const ahead = Math.max(G.physics.groundHeight(t.pos.x, t.pos.z), G.physics.groundHeight(t.pos.x + t.vel.x * 1.5, t.pos.z + t.vel.z * 1.5));
    t.vel.y += ((ahead + altitude - t.pos.y) * 1.2 + bob - t.vel.y) * Math.min(1, dt * 2);
    t.pos.addScaledVector(t.vel, dt);
    if (Math.hypot(t.vel.x, t.vel.z) > 0.5) turnTo(t, t.pos.x + t.vel.x, t.pos.z + t.vel.z, dt);
  }

  // ---- shooting --------------------------------------------------------------------------------------------------
  const bolts = [], boltRoot = new Group(); boltRoot.name = 'bolts'; root.add(boltRoot);
  const boltGeo = new CylinderGeometry(0.016, 0.03, 1, 6, 1); boltGeo.rotateX(Math.PI / 2); boltGeo.translate(0, 0, -0.5);
  const boltMat = new MeshBasicMaterial({ color: 0xffffff }); boltMat.color.setRGB(14, 5.5, 2.2);
  const feet = new Vector3(), head = new Vector3(), boltEnd = new Vector3();
  function fireBolt(from, dir, w) {
    let b = bolts.find((x) => !x.on);
    if (!b) { if (bolts.length >= tuning.maxBolts) return; b = { on: false, mesh: new Mesh(boltGeo, boltMat), pos: new Vector3(), dir: new Vector3(), from: new Vector3() }; b.mesh.frustumCulled = false; boltRoot.add(b.mesh); bolts.push(b); }
    b.on = true; b.life = tuning.boltLife; b.len = 0; b.speed = w.speed || 70; b.damage = w.damage; b.pos.copy(from); b.dir.copy(dir); b.from.copy(from); b.mesh.visible = true;
  }
  function updateBolts(dt) {
    const p = G.player;
    for (const b of bolts) {
      if (!b.on) continue;
      const travel = b.speed * dt, wall = G.physics.raycast(b.pos, b.dir, travel), reach = wall ? wall.dist : travel;
      b.life -= dt;
      if (p && p.alive) {
        boltEnd.copy(b.pos).addScaledVector(b.dir, reach); feet.set(p.pos.x, p.pos.y + 0.35, p.pos.z); head.set(p.pos.x, p.pos.y + (p.crouching ? 1 : 1.5), p.pos.z);
        if (segmentDistanceSq(b.pos, boltEnd, feet, head) < 0.36 * 0.36) { p.damage(b.damage, b.from); b.on = false; }
      }
      if (b.on && wall) { G.events.emit('impact', { point: wall.point, normal: wall.normal, dist: wall.dist, surface: wall.surface, enemy: null, dir: b.dir, from: 'enemy' }); b.on = false; }
      if (b.on && b.life <= 0) b.on = false;
      if (!b.on) { b.mesh.visible = false; continue; }
      b.pos.addScaledVector(b.dir, travel); b.len = Math.min(1.5, b.len + travel);
      b.mesh.position.copy(b.pos); b.mesh.lookAt(tmpA.copy(b.pos).add(b.dir)); b.mesh.scale.set(1, 1, Math.max(0.2, b.len));
    }
  }
  const muzzleOf = (t, out) => out.copy(t.model.userData.muzzle).applyAxisAngle(UP, t.yaw).add(t.pos);
  function shoot(t) {
    const w = t.def.weapon, p = G.player, from = muzzleOf(t, new Vector3()), aim = tmpB.set(p.pos.x, p.pos.y + (p.crouching ? 0.75 : 1.05), p.pos.z);
    if (w.kind === 'bolt') { const fly = (from.distanceTo(aim) / (w.speed || 70)) * t.lead, v = p.vel || tmpC.set(0, 0, 0); aim.x += v.x * fly; aim.z += v.z * fly; }
    const dir = aim.clone().sub(from).normalize();
    const sp = (w.spreadFar + (w.spreadNear - w.spreadFar) * t.exposure) * (1 + playerSpeed * (w.moving ?? 0.3)) * (t.type === 'air' && t.health < t.def.body.health * 0.5 ? 1.5 : 1);
    dir.x += (rng() - 0.5) * 2 * sp; dir.y += (rng() - 0.5) * 2 * sp; dir.z += (rng() - 0.5) * 2 * sp; dir.normalize();
    G.events.emit('enemy:fire', { enemy: t, type: t.type, pos: from, dir });
    fx('muzzleFlash', from, dir, { scale: w.kind === 'bolt' ? 0.55 : 0.9 });
    if (w.kind === 'bolt') return fireBolt(from, dir, w);
    const wall = G.physics.raycast(from, dir, w.range), hit = G.combat.enemyShot(from, dir, { damage: w.damage, range: w.range });
    fx('tracer', from, from.clone().addScaledVector(dir, hit ? from.distanceTo(aim) : wall ? wall.dist : w.range * 0.6), { color: 0xffc070, speed: 260, width: 0.035 });
  }
  /** One step of the weapon: wait for a turn, warn, shoot the burst, rest. True while a burst is announced or going. */
  function fire(t, dt, { facing = true } = {}) {
    const w = t.def.weapon, p = G.player; if (!w) return false;
    t.cooldown -= dt;
    if (t.atk === 'idle') {
      if (t.los && facing && t.cooldown <= 0 && p.alive && muzzleOf(t, tmpA).distanceTo(p.pos) <= w.range && requestToken(t)) {
        t.atk = 'tele'; t.atkT = w.aimTime;
        G.events.emit('enemy:telegraph', { enemy: t, type: t.type, pos: t.pos, time: w.aimTime });
      }
    } else if (t.atk === 'tele') {
      t.atkT -= dt; t.flare = Math.min(1, t.flare + dt * 4.5);
      if (t.atkT <= 0) { t.atk = 'burst'; t.shots = w.burst; t.atkT = 0; t.lead = between(w.lead ?? 0.5, rng); }
    } else {
      t.atkT -= dt; t.flare = 1;
      if (t.atkT <= 0) { t.atkT = w.interval; t.shots--; shoot(t); }
      if (t.shots <= 0) { t.atk = 'idle'; t.cooldown = between(w.cooldown, rng); t.bursts++; releaseToken(t); }
    }
    return t.atk !== 'idle';
  }

  /** Where to shoot from: in range of the target, with a line of sight, near me, away from the others. */
  function pickFirePos(t) {
    const p = G.player, tac = t.def.tactics || {}, lo = tac.rangeMin ?? 8, hi = tac.rangeMax ?? 18, eye = targetPoint(new Vector3());
    let best = Infinity;
    const consider = (q, bias) => {
      if (!q) return;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (d < lo || d > hi || !G.nav.isWalkable(q.x, q.z)) return;
      let cost = Math.hypot(q.x - t.pos.x, q.z - t.pos.z) * 0.9 + bias + rng() * 3; const ux = q.x - p.pos.x, uz = q.z - p.pos.z;
      for (const o of list) {
        if (o === t || !o.alive || o.type !== 'ground' || o.brain.action !== 'skirmish') continue;
        const at = o.es === 'move' ? o.firePos : o.pos, vx = at.x - p.pos.x, vz = at.z - p.pos.z, cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) + 1e-4);
        if (cos > 0.86) cost += (14 * (cos - 0.86)) / 0.14; // not in a line behind each other
        if (Math.hypot(q.x - at.x, q.z - at.z) < 3) cost += 16;
      }
      if (cost >= best) return;
      const y = Number.isFinite(q.y) ? q.y : G.physics.groundHeight(q.x, q.z);
      if (!G.physics.lineOfSight(tmpA.set(q.x, y + 0.95, q.z), eye)) cost += 22;
      if (cost < best) { best = cost; t.firePos.set(q.x, y, q.z); }
    };
    for (const c of G.nav.coverNear(p.pos, hi).slice(0, 24)) consider(c, -2);
    for (let i = 0; i < 7; i++) consider(G.nav.randomPoint(p.pos, hi, rng), 0);
    const back = Math.atan2(t.pos.z - p.pos.z, t.pos.x - p.pos.x);
    for (let i = 0; i < 5; i++) { const a = back + (rng() - 0.5) * 2.6, r = lo + 1 + rng() * (hi - lo - 2); consider({ x: p.pos.x + Math.cos(a) * r, z: p.pos.z + Math.sin(a) * r }, 1); }
    if (best === Infinity) t.firePos.copy(t.pos);
    t.firePlayer.copy(p.pos); t.es = 'move'; t.esT = 0; t.moveT = 0; t.bursts = 0; t.path = null;
  }

  // ---- what each `do` means --------------------------------------------------------------------------------------
  const speedOf = (t) => t.def.body.speed[t.brain.speed] ?? 0;
  const ACTIONS = {
    hold(t, dt) { if (t.type === 'ground') step(t, 0, 0, dt); t.arrived = true; },
    followRoute(t, dt) {
      if (!t.route.length) return ACTIONS.hold(t, dt);
      const wp = t.route[t.routeAt % t.route.length];
      if (t.type === 'air') flyTo(t, wp.x, wp.z, t.def.body.altitude, speedOf(t), dt); else walkTo(t, wp, speedOf(t), dt);
      if (t.arrived) { t.routeAt++; t.path = null; }
    },
    gotoLastKnown(t, dt) {
      if (!t.lastKnown) { t.arrived = true; return ACTIONS.hold(t, dt); }
      if (t.type === 'air') flyTo(t, t.lastKnown.x, t.lastKnown.z, Math.min(t.orbitAlt, t.def.body.altitude), speedOf(t), dt); else walkTo(t, t.lastKnown, speedOf(t), dt);
      if (t.arrived && t.type === 'ground') t.yaw += dt * 1.2; // look around
    },
    attack(t, dt) {
      const p = G.player.pos; let off = 9;
      if (t.los) { off = turnTo(t, p.x, p.z, dt); step(t, 0, 0, dt); } else if (t.lastKnown && t.atk === 'idle') walkTo(t, t.lastKnown, t.def.body.speed.investigate || 2, dt); else step(t, 0, 0, dt);
      fire(t, dt, { facing: off < 0.35 });
    },
    skirmish(t, dt) {
      const p = G.player, m = t.def.melee, tac = t.def.tactics || {}, d = Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z);
      if (!t.es) pickFirePos(t);
      t.lungeIn -= dt;
      if (m && (t.es === 'move' || t.es === 'aim') && d < m.range && t.lungeIn <= 0 && p.alive && t.los) {
        releaseToken(t); t.atk = 'idle'; t.es = 'wind'; t.esT = m.windup;
        G.events.emit('enemy:telegraph', { enemy: t, type: t.type, pos: t.pos, time: m.windup, melee: true });
      }
      if (t.es === 'move') {
        t.moveT += dt; t.cooldown -= dt;
        walkTo(t, t.firePos, speedOf(t), dt);
        const inRange = d > (tac.rangeMin ?? 8) - 1 && d < (tac.rangeMax ?? 18) + 2;
        if (t.arrived || (t.moveT > 1.4 && t.los && inRange && rng() < dt * 0.7) || t.moveT > 7) { t.es = 'aim'; t.esT = 0; }
        else if (p.pos.distanceToSquared(t.firePlayer) > 49) pickFirePos(t);
      } else if (t.es === 'aim') {
        t.esT += dt;
        const off = turnTo(t, p.pos.x, p.pos.z, dt), was = t.bursts; step(t, 0, 0, dt);
        const busy = fire(t, dt, { facing: off < 0.14 });
        if (t.bursts > was) { if (t.bursts >= 1 + (rng() < 0.4 ? 1 : 0)) pickFirePos(t); else t.esT = 0; }
        else if (!busy && (t.los ? d < (tac.rangeMin ?? 8) - 3 && t.esT > 0.8 : t.lostFor > 1.1 || t.esT > 3)) pickFirePos(t);
      } else if (t.es === 'wind') {
        turnTo(t, p.pos.x, p.pos.z, dt * 2); step(t, 0, 0, dt); t.flare = 1;
        if ((t.esT -= dt) <= 0) { t.es = 'lunge'; t.esT = m.time; }
      } else if (t.es === 'lunge') {
        turnTo(t, p.pos.x, p.pos.z, dt * 2);
        step(t, -Math.sin(t.yaw) * m.speed, -Math.cos(t.yaw) * m.speed, dt); t.esT -= dt;
        if (d < m.reach && p.alive) { p.damage(m.damage, t.pos); G.events.emit('enemy:melee', { enemy: t, pos: t.pos }); t.esT = 0; }
        if (t.esT <= 0) { t.es = 'recover'; t.esT = m.recover; t.lungeIn = m.cooldown; }
      } else if (t.es === 'recover') {
        step(t, 0, 0, dt);
        if ((t.esT -= dt) <= 0) pickFirePos(t);
      }
    },
    gotoCover(t, dt) {
      if (!t.cover && !t.noCover) {
        // cover is a place near me from which the target cannot be seen at a crouch
        const tp = targetPoint(tmpB).clone();
        t.cover = G.nav.coverNear(t.pos, 30).find((c) => !G.physics.lineOfSight({ x: c.x, y: c.y + 1.0, z: c.z }, tp)) || null;
        t.noCover = !t.cover;
        if (t.cover) t.cover = new Vector3(t.cover.x, t.cover.y, t.cover.z);
      }
      if (t.cover) walkTo(t, t.cover, speedOf(t), dt); else step(t, 0, 0, dt);
    },
    orbitTarget(t, dt) {
      const p = G.player, busy = t.atk !== 'idle', seen = t.lostFor < 1.5, c = seen ? p.pos : t.lastKnown || p.pos;
      if ((t.flipIn -= dt) <= 0) { t.flipIn = 3 + rng() * 5; if (rng() < 0.6) t.orbitDir = -t.orbitDir; t.orbitR = between(t.def.orbitRadius ?? 25, rng); }
      if (seen) t.orbit += ((t.orbitDir * (busy ? 0.9 : 3.6)) / t.orbitR) * dt; // it steadies itself to shoot
      else t.orbit = Math.atan2(t.pos.z - c.z, t.pos.x - c.x);
      const r = seen ? t.orbitR : 0;
      flyTo(t, c.x + Math.cos(t.orbit) * r, c.z + Math.sin(t.orbit) * r, t.orbitAlt + (seen ? 0 : 1), speedOf(t), dt);
      t.reportIn -= dt;
      if (t.sees && t.reportIn <= 0) { t.reportIn = t.def.reportEvery || 3; alert(p.pos, t.def.alertRadius, t.pos, t); G.events.emit('enemy:report', { enemy: t, pos: p.pos }); }
      const off = t.los ? turnTo(t, p.pos.x, p.pos.z, dt * 3) : 9;
      fire(t, dt, { facing: off < 0.35 });
    },
  };

  function die(t, dt) {
    t.deadFor += dt;
    if (t.type === 'air') {
      if (!t.landed) {
        t.vel.y -= 9.5 * dt; t.vel.x *= 1 - 0.4 * dt; t.vel.z *= 1 - 0.4 * dt; t.spin += Math.sign(t.spin) * 7 * dt;
        t.yaw += t.spin * dt; t.model.rotation.set(t.model.rotation.x + 0.9 * dt, t.yaw, t.model.rotation.z + t.spin * 0.35 * dt);
        const sp = t.vel.length(), wall = sp > 0.01 ? G.physics.raycast(t.pos, tmpA.copy(t.vel).multiplyScalar(1 / sp), sp * dt + 0.3) : null;
        if (wall) t.pos.copy(wall.point).addScaledVector(wall.normal, 0.2); else t.pos.addScaledVector(t.vel, dt);
        if ((t.smokeIn -= dt) <= 0) { t.smokeIn = 0.045; fx('smoke', t.pos, { size: 0.45, life: 1.3, color: 0x15161a, rise: 0.6 }); }
        if (wall || t.deadFor > 5 || t.pos.y < G.physics.groundHeight(t.pos.x, t.pos.z) + 0.15) {
          t.landed = true; t.vel.set(0, 0, 0);
          const ex = t.def.death && t.def.death.explode;
          if (ex) { fx('explosion', t.pos, 1.2); G.combat.explode(t.pos, ex.radius, ex.damage, 'enemy'); t.model.position.copy(t.pos); return remove(t); }
        }
      }
      t.model.position.copy(t.pos);
    } else {
      const f = Math.min(1, t.deadFor * 3);
      if (t.def.body.figure === 'quadruped') { t.model.position.set(t.pos.x, t.pos.y - f * (t.def.body.height - 0.45), t.pos.z); t.model.rotation.z = f * 0.35; }
      else { t.model.position.copy(t.pos); t.model.rotation.x = -f * 1.5; }
      if (t.deadFor < 6.5 && (t.smokeIn -= dt) <= 0) { t.smokeIn = t.deadFor < 2 ? 0.09 : 0.2; fx('smoke', tmpA.set(t.pos.x, t.pos.y + 0.42, t.pos.z), { size: 0.5, life: 1.8, color: 0x17181b, rise: 1.1 }); if (t.deadFor < 4 && rng() < 0.5) fx('sparks', tmpA, UP, 3); }
    }
    const wrecks = list.filter((x) => !x.alive);
    if (t.deadFor > tuning.wreckSeconds || (wrecks.length > tuning.maxWrecks && wrecks[0] === t)) remove(t);
  }

  function update(dt) {
    if (!(dt > 0)) return;
    now += dt;
    const p = G.player;
    if (G.nav && p) G.nav.recenter(p.pos.x, p.pos.z);
    if (p) playerSpeed += ((p.speed || 0) - playerSpeed) * (1 - Math.exp(-6 * dt));
    let hot = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (!t.alive) { die(t, dt); continue; }
      sense(t, dt);
      const rule = t.brain.step({ seesTarget: t.sees, heardNoise: t.heard, damaged: t.hurt, arrived: t.arrived, noCover: t.noCover, health: t.health / t.def.body.health, lostFor: t.lostFor }, dt);
      if (rule) {
        t.path = null; t.arrived = false; t.cover = null; t.noCover = false; calm(t);
        if (rule.alert && t.lastKnown) { alert(t.lastKnown, t.def.alertRadius, t.pos, t); G.events.emit('enemy:alert', { enemy: t, pos: t.pos }); }
        G.events.emit('enemy:state', { enemy: t, from: rule.from, to: rule.to });
      }
      t.heard = false; t.hurt = false;
      (ACTIONS[t.brain.action] || ACTIONS.hold)(t, dt);
      place(t);
      hot = Math.max(hot, fighting(t) ? 1 : t.brain.state !== t.def.behaviour.start || (p && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < tuning.nearMetres) ? 0.6 : 0.15);
      const u = t.model.userData, want = fighting(t) ? LENS_HOT : LENS_CALM, k = 1 + t.flare * 3.2;
      for (let c = 0; c < 3; c++) t.lens[c] += (want[c] - t.lens[c]) * (1 - Math.exp(-8 * dt));
      u.lens.color.setRGB(t.lens[0] * k, t.lens[1] * k, t.lens[2] * k); t.flare = Math.max(0, t.flare - dt * 1.5);
      if (u.rotors) for (const r of u.rotors) r.rotation.y += dt * 60;
      const sw = Math.sin(t.stride * Math.PI) * Math.min(1, Math.hypot(t.vel.x, t.vel.z) / 2) * 0.6;
      if (u.legL) { u.legL.rotation.x = sw; u.legR.rotation.x = -sw; }
      if (u.legs) u.legs.forEach((l, n) => { l.rotation.x = n < 2 ? sw : -sw; });
      if (t.type === 'air') { t.model.rotation.z = 0; t.model.rotation.x = -Math.min(0.35, Math.hypot(t.vel.x, t.vel.z) * 0.03); }
    }
    updateBolts(dt);
    noises = [];
    // the music follows the fight; it calms down a few seconds after the last contact
    if (hot >= intensity) calmIn = 6; else if ((calmIn -= dt) > 0) hot = intensity;
    if (hot !== intensity) { intensity = hot; try { G.audio.setIntensity(hot); } catch { /* silent */ } }
  }

  /** What a shot from `origin` along `dir` hits first among the threats: { enemy, point, dist, part, normal } or null. */
  function raycast(origin, dir, max = 300) {
    let best = null;
    for (const t of list) {
      if (!t.alive) continue;
      const b = t.def.body;
      if (t.type === 'air') {
        const oc = tmpA.copy(t.pos).sub(origin), tc = oc.dot(dir); if (tc < 0 || tc > max) continue;
        const d2 = oc.lengthSq() - tc * tc, r = b.radius; if (d2 > r * r) continue;
        const d = tc - Math.sqrt(r * r - d2); if (!best || d < best.dist) best = { enemy: t, dist: d, part: 'body' };
      } else {
        // an upright cylinder
        const ox = origin.x - t.pos.x, oz = origin.z - t.pos.z, a = dir.x * dir.x + dir.z * dir.z; if (a < 1e-9) continue;
        const bq = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - b.radius * b.radius, disc = bq * bq - 4 * a * c; if (disc < 0) continue;
        const d = (-bq - Math.sqrt(disc)) / (2 * a); if (d < 0 || d > max) continue;
        const y = origin.y + dir.y * d - t.pos.y; if (y < 0 || y > b.height) continue;
        if (!best || d < best.dist) best = { enemy: t, dist: d, part: y > b.height - (b.weakTop ?? 0.32) ? 'weak' : 'body' };
      }
    }
    if (!best) return null;
    best.point = new Vector3().copy(origin).addScaledVector(dir, best.dist); best.normal = new Vector3().copy(dir).negate();
    return best;
  }

  return {
    root, list, archetypes, tuning, spawn, raycast, alert, update, aliveCount,
    get intensity() { return intensity; },
    bolts: () => bolts.filter((b) => b.on).map((b) => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z })),
    knows: (kind) => !!defOf(kind),
    despawn(id) { const t = list.find((x) => x.id === id); if (t) remove(t); return !!t; },
    clear() { for (const t of [...list]) remove(t); for (const b of bolts) { b.on = false; b.mesh.visible = false; } tokens.held = 0; },
  };
}
