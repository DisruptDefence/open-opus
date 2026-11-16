// The threats module: bodies in the world driven by the brains of brain.js over the archetypes of archetypes.js.
// It keeps the surface the lifted combat and audio modules expect of `enemies` (list, spawn, raycast, aliveCount,
// clear, alert, update, and the enemy:* events) and replaces what was behind it: two hard-coded machines.
//
// This file does: perception (line of sight through the physics, hearing from events), moving a body where its
// state says (ground threats walk the nav grid and collide like the player; air threats fly over the terrain),
// shooting, taking damage. It decides nothing: the state table does.
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from '../../vendor/three.module.js';
import { ARCHETYPES } from './archetypes.js';
import { canSee, canHear, createBrain, validateBehaviour } from './brain.js';

const GRAVITY = 21;
const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3();

function part(geo, mat, x, y, z, parent) { const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

/** Our own figures, built from primitives: a sentry on foot and a quadcopter. Neither is taken from the old game. */
function buildModel(def) {
  const g = new Group();
  if (def.type === 'ground') {
    const cloth = new MeshStandardMaterial({ color: 0x4a5138, roughness: 0.9 }), kit = new MeshStandardMaterial({ color: 0x2b2d2a, roughness: 0.7 }), skin = new MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
    const legL = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, -0.11, 0.43, 0, g), legR = part(new BoxGeometry(0.17, 0.86, 0.2), cloth, 0.11, 0.43, 0, g);
    part(new BoxGeometry(0.46, 0.6, 0.26), cloth, 0, 1.16, 0, g);
    part(new BoxGeometry(0.5, 0.34, 0.3), kit, 0, 1.2, 0.01, g); // vest
    part(new BoxGeometry(0.2, 0.22, 0.22), skin, 0, 1.6, 0, g);
    part(new SphereGeometry(0.15, 10, 8), kit, 0, 1.69, 0, g).scale.set(1, 0.75, 1.1); // helmet
    const arms = new Group(); arms.position.set(0, 1.32, 0); g.add(arms);
    part(new BoxGeometry(0.12, 0.12, 0.5), cloth, -0.2, 0, -0.2, arms); part(new BoxGeometry(0.12, 0.12, 0.5), cloth, 0.2, 0, -0.2, arms);
    part(new BoxGeometry(0.06, 0.1, 0.8), kit, 0.08, 0.02, -0.5, arms); // rifle
    g.userData = { legL, legR, arms, muzzle: new Vector3(0.08, 1.34, -0.95) };
  } else {
    const shell = new MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.3 }), led = new MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 6 });
    part(new BoxGeometry(0.34, 0.12, 0.46), shell, 0, 0, 0, g);
    part(new SphereGeometry(0.09, 10, 8), shell, 0, -0.1, -0.16, g); // camera ball
    part(new BoxGeometry(0.05, 0.03, 0.05), led, 0, 0.02, 0.24, g);
    const rotors = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = part(new BoxGeometry(0.5, 0.03, 0.05), shell, sx * 0.24, 0.02, sz * 0.24, g); arm.rotation.y = sx * sz * 0.78;
      const r = part(new CylinderGeometry(0.2, 0.2, 0.012, 14), new MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, transparent: true, opacity: 0.55 }), sx * 0.42, 0.06, sz * 0.42, g); r.castShadow = false; rotors.push(r);
    }
    g.userData = { rotors, muzzle: new Vector3(0, -0.12, -0.28) };
  }
  return g;
}

export function createThreats(G, { archetypes = ARCHETYPES } = {}) {
  for (const def of Object.values(archetypes)) { const e = validateBehaviour(def); if (e.length) throw new Error('threats: ' + e.join('; ')); }
  const root = new Group(); root.name = 'enemies'; G.scene.add(root);
  const list = [], rng = G.rng.fork();
  let nextId = 1, noises = [];
  const noise = (pos, loudness) => { if (pos) noises.push({ x: pos.x, y: pos.y, z: pos.z, loudness }); };
  G.events.on('weapon:fire', () => noise(G.player.pos, 90));
  G.events.on('player:step', (e) => { if (e && e.sprint) noise(e.pos, 12); });
  G.events.on('player:land', (e) => noise(e && e.pos, 10));
  G.events.on('explosion', (e) => noise(e && e.pos, 150));

  function spawn(kind, pos, opts = {}) {
    // `kind` is an archetype id, or the broad class the scene format's anchors use (ground | air)
    const def = archetypes[kind] || Object.values(archetypes).find((d) => d.type === kind);
    if (!def) { console.warn(`[threats] unknown archetype "${kind}"`); return null; }
    const model = buildModel(def), t = {
      id: opts.id || `${def.id}-${nextId++}`, type: def.type, archetype: def.id, def, model,
      pos: new Vector3(pos.x, pos.y, pos.z), vel: new Vector3(), yaw: opts.yaw || 0, alive: true, health: def.body.health,
      brain: createBrain(def), get mode() { return t.brain.state; },
      route: (opts.route || []).map((p) => new Vector3(p[0] ?? p.x, 0, p[1] ?? p.z)), routeAt: 0,
      path: null, pathAt: 0, pathFor: null, repath: 0, grounded: true,
      sees: false, lostFor: 99, lastKnown: null, heard: false, hurt: false, arrived: false, noCover: false, cover: null,
      senseIn: rng() * 0.2, aim: 0, burstLeft: 0, shotIn: 0, cooldown: rng() * 1.5, reportIn: 0, orbit: rng() * 6.28, stride: 0, deadFor: 0,
      damage(amount, point, dir, bodyPart) {
        if (!t.alive) return false;
        t.health -= amount; t.hurt = true;
        if (!t.lastKnown && G.player) t.lastKnown = G.player.pos.clone();
        G.events.emit('enemy:hit', { enemy: t, amount, point, part: bodyPart });
        if (t.health > 0) return false;
        t.alive = false; t.deadFor = 0; t.vel.set(0, 0, 0);
        G.events.emit('enemy:killed', { enemy: t, type: t.type, pos: t.pos });
        return true;
      },
    };
    if (def.type === 'air') t.pos.y = Math.max(t.pos.y, G.physics.groundHeight(t.pos.x, t.pos.z) + (def.body.altitude || 20));
    root.add(model); list.push(t); place(t);
    G.events.emit('enemy:spawn', { enemy: t });
    return t;
  }
  function place(t) { t.model.position.copy(t.pos); t.model.rotation.y = t.yaw; }
  function remove(t) { t.model.removeFromParent(); t.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); G.events.emit('enemy:despawn', { enemy: t }); }

  /** Tell threats within `radius` of `from` where something is. `from` defaults to the place itself. */
  function alert(pos, radius = 60, from = pos, except = null) {
    for (const t of list) if (t.alive && t !== except && t.pos.distanceTo(from) <= radius) { t.heard = true; t.lastKnown = new Vector3(pos.x, pos.y, pos.z); }
  }

  const eyeOf = (t, out) => out.set(t.pos.x, t.pos.y + (t.def.senses.eye || 0), t.pos.z);
  const targetPoint = (out) => out.set(G.player.pos.x, G.player.pos.y + (G.player.crouching ? 0.9 : 1.4), G.player.pos.z);

  function sense(t, dt) {
    const p = G.player, s = t.def.senses;
    t.senseIn -= dt;
    if (t.senseIn <= 0) {
      t.senseIn = 0.15;
      const eye = eyeOf(t, tmpA), tp = targetPoint(tmpB);
      t.sees = !!p && p.alive && canSee({ x: eye.x, y: eye.y, z: eye.z, fx: -Math.sin(t.yaw), fz: -Math.cos(t.yaw) }, tp, s, (a, b) => G.physics.lineOfSight(a, b));
      if (t.sees) { t.lastKnown = (t.lastKnown || new Vector3()).copy(p.pos); t.lostFor = 0; }
    }
    if (!t.sees) t.lostFor += dt;
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
      vx = ((wp.x - t.pos.x) / l) * speed; vz = ((wp.z - t.pos.z) / l) * speed;
      turnTo(t, wp.x, wp.z, dt);
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
    const k = Math.min(1, d / 6) * speed, ax = d > 0.01 ? (dx / d) * k : 0, az = d > 0.01 ? (dz / d) * k : 0;
    t.vel.x += (ax - t.vel.x) * Math.min(1, dt * 1.6); t.vel.z += (az - t.vel.z) * Math.min(1, dt * 1.6);
    // hold height above whatever is below and ahead (ground or roof)
    const ahead = Math.max(G.physics.groundHeight(t.pos.x, t.pos.z), G.physics.groundHeight(t.pos.x + t.vel.x * 1.5, t.pos.z + t.vel.z * 1.5));
    t.vel.y += ((ahead + altitude - t.pos.y) * 1.2 - t.vel.y) * Math.min(1, dt * 2);
    t.pos.addScaledVector(t.vel, dt);
    if (Math.hypot(t.vel.x, t.vel.z) > 0.5) turnTo(t, t.pos.x + t.vel.x, t.pos.z + t.vel.z, dt);
  }

  // ---- shooting --------------------------------------------------------------------------------------------------
  function fire(t, dt) {
    const w = t.def.weapon; if (!w) return;
    const p = G.player, tp = targetPoint(tmpB), muzzle = tmpA.copy(t.model.userData.muzzle).applyAxisAngle(tmpC.set(0, 1, 0), t.yaw).add(t.pos);
    if (!t.sees || muzzle.distanceTo(tp) > w.range) { t.aim = 0; t.burstLeft = 0; return; }
    t.cooldown -= dt;
    if (t.burstLeft === 0) {
      if (t.cooldown > 0) return;
      if (t.aim === 0) G.events.emit('enemy:telegraph', { enemy: t, type: t.type, pos: t.pos, time: w.aimTime });
      t.aim += dt; if (t.aim < w.aimTime) return;
      t.burstLeft = w.burst; t.shotIn = 0; t.aim = 0;
    }
    t.shotIn -= dt; if (t.shotIn > 0) return;
    t.shotIn = w.interval; t.burstLeft--; if (t.burstLeft === 0) t.cooldown = w.cooldown * (0.8 + rng() * 0.4);
    // lead nothing, spread a little, miss more when the target moves fast
    const dir = tp.clone().sub(muzzle).normalize(), sp = w.spread * (1 + Math.min(2, (p.speed || 0) / 3));
    dir.x += (rng() - 0.5) * 2 * sp; dir.y += (rng() - 0.5) * 2 * sp; dir.z += (rng() - 0.5) * 2 * sp; dir.normalize();
    const from = muzzle.clone();
    G.events.emit('enemy:fire', { enemy: t, type: t.type, pos: from });
    const hit = G.combat.enemyShot(from, dir, { damage: w.damage, range: w.range });
    try { G.fx.muzzleFlash(from, dir, { scale: 0.7 }); G.fx.tracer(from, from.clone().addScaledVector(dir, hit ? from.distanceTo(tp) : w.range * 0.6), {}); } catch { /* fx is optional */ }
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
      if (t.type === 'air') flyTo(t, t.lastKnown.x, t.lastKnown.z, t.def.orbitAltitude || t.def.body.altitude, speedOf(t), dt); else walkTo(t, t.lastKnown, speedOf(t), dt);
      if (t.arrived && t.type === 'ground') t.yaw += dt * 1.2; // look around
    },
    attack(t, dt) {
      const p = G.player.pos;
      if (t.sees) { turnTo(t, p.x, p.z, dt); step(t, 0, 0, dt); } else if (t.lastKnown) walkTo(t, t.lastKnown, t.def.body.speed.investigate || 2, dt);
      fire(t, dt);
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
      const c = t.lastKnown || G.player.pos, r = t.def.orbitRadius || 25;
      t.orbit += (speedOf(t) / r) * dt;
      flyTo(t, c.x + Math.cos(t.orbit) * r, c.z + Math.sin(t.orbit) * r, t.def.orbitAltitude || t.def.body.altitude, speedOf(t), dt);
      t.reportIn -= dt;
      if (t.sees && t.reportIn <= 0) { t.reportIn = t.def.reportEvery || 3; alert(G.player.pos, t.def.alertRadius, t.pos, t); G.events.emit('enemy:report', { enemy: t, pos: G.player.pos }); }
      if (t.sees) turnTo(t, G.player.pos.x, G.player.pos.z, dt * 3);
      fire(t, dt);
    },
  };

  function update(dt) {
    if (!(dt > 0)) return;
    if (G.nav && G.player) G.nav.recenter(G.player.pos.x, G.player.pos.z);
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (!t.alive) {
        // fall where it stood, then go
        t.deadFor += dt;
        if (t.type === 'air') { t.vel.y -= GRAVITY * dt; t.pos.addScaledVector(t.vel, dt); const g = G.physics.groundHeight(t.pos.x, t.pos.z); if (t.pos.y < g + 0.15) { t.pos.y = g + 0.15; t.vel.set(0, 0, 0); } t.model.rotation.z += dt * 4 * (t.pos.y > g + 0.2 ? 1 : 0); }
        else t.model.rotation.x = -Math.min(1.5, t.deadFor * 4);
        t.model.position.copy(t.pos);
        if (t.deadFor > 12) remove(t);
        continue;
      }
      sense(t, dt);
      const rule = t.brain.step({ seesTarget: t.sees, heardNoise: t.heard, damaged: t.hurt, arrived: t.arrived, noCover: t.noCover, health: t.health / t.def.body.health, lostFor: t.lostFor }, dt);
      if (rule) {
        t.path = null; t.arrived = false; t.cover = null; t.noCover = false; t.aim = 0;
        if (rule.alert && t.lastKnown) { alert(t.lastKnown, t.def.alertRadius, t.pos, t); G.events.emit('enemy:alert', { enemy: t, pos: t.pos }); }
        G.events.emit('enemy:state', { enemy: t, from: rule.from, to: rule.to });
      }
      t.heard = false; t.hurt = false;
      (ACTIONS[t.brain.action] || ACTIONS.hold)(t, dt);
      place(t);
      const u = t.model.userData;
      if (u.rotors) for (const r of u.rotors) r.rotation.y += dt * 60;
      if (u.legL) { const sw = Math.sin(t.stride * Math.PI) * Math.min(1, Math.hypot(t.vel.x, t.vel.z) / 2) * 0.6; u.legL.rotation.x = sw; u.legR.rotation.x = -sw; if (t.type === 'air') t.model.rotation.z = 0; }
      if (t.type === 'air') { t.model.rotation.x = -Math.min(0.35, Math.hypot(t.vel.x, t.vel.z) * 0.03); }
    }
    noises = [];
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
        if (!best || d < best.dist) best = { enemy: t, dist: d, part: y > b.height - 0.32 ? 'weak' : 'body' };
      }
    }
    if (!best) return null;
    best.point = new Vector3().copy(origin).addScaledVector(dir, best.dist); best.normal = new Vector3().copy(dir).negate();
    return best;
  }

  return {
    root, list, archetypes, spawn, raycast, alert, update,
    aliveCount: () => list.reduce((n, t) => n + (t.alive ? 1 : 0), 0),
    despawn(id) { const t = list.find((x) => x.id === id); if (t) remove(t); return !!t; },
    clear() { for (const t of [...list]) remove(t); },
  };
}
