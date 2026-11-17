// The composition root: builds the context every module shares, boots the modules in order, runs the frame.
// It lives in the door layer because it is the one file that must import every layer below it
// (docs/ARCHITECTURE.md, "direction of imports"); no module imports it, and outside code never sees it: open.js
// wraps what it returns in the world API.
//
//   context   G = { THREE, params, events, rng, time, clock, quality, <one slot per module> }
//   registry  every slot is filled by a factory; pass `modules: { name: factory }` to replace one without editing
//             this file (a product brings its own HUD this way; the tests run the engine without a renderer)
//   frame     input -> session -> (player, weapon, threats, director) -> (fx, level, mats) -> audio, hud -> render
//   time      one clock; pause and slow motion are its scale. Nothing here needs a server to run a frame.
//
// A module may read the slots filled before it in the boot order and talks upward through events only.
import * as THREE from '../../vendor/three.module.js';
import { createEvents, createRng, pickQuality } from '../shared/lifted.js';
import { createClock } from '../core/clock.js';
import { atmosphereAt, resolveLook, parseLookParam, ambienceOf } from '../core/atmosphere.js';
import { createSession } from '../core/session.js';
import { createGeoref } from '../geo/georef.js';
import { createTerrain } from '../terrain/heightfield.js';
import { createPhysics } from '../physics/physics.js';
import { createNav } from '../nav/navgrid.js';
import { createRender } from '../render/render.js';
import { createMaterials } from '../materials/materials.js';
import { withDetail } from '../materials/detail.js';
import '../materials/outdoor.js';
import '../materials/facades.js';
import { createInput } from '../input/input.js';
import { createFx } from '../fx/fx.js';
import { createAudio } from '../audio/audio.js';
import { createNullHud } from '../hud/hooks.js';
import { createSceneLoader } from '../level/loader.js';
import { createPlayer } from '../player/player.js';
import { createCombat } from '../combat/combat.js';
import { createTreefall } from './treefall.js';
import { createWeapon } from '../weapons/weapon.js';
import { createThreats } from '../threats/threats.js';
import { validateBehaviour } from '../threats/brain.js';
import { DEFAULT_PACK } from '../content/default.js';
import { validatePack, mergePacks } from '../content/pack.js';
import { createDoors } from './doors.js';
import { createDirector } from '../director/director.js';

export const DEFAULT_MODULES = {
  render: createRender, mats: withDetail(createMaterials), input: createInput, fx: createFx, audio: createAudio, player: createPlayer,
  combat: createCombat, weapon: createWeapon, threats: createThreats, hud: createNullHud, game: createSession,
};
const nothing = () => {};
/** The audio contract with no sound: for `noaudio`, and when the browser refuses an audio context. */
export const silentAudio = () => { const h = { setPos: nothing, setGain: nothing, setPitch: nothing, stop: nothing }; return { stub: true, update: nothing, resume: nothing, play: nothing, loop: () => h, setIntensity: nothing, setInterior: nothing, setVolume: nothing, setPaused: nothing }; };
const RADIUS = { test: 1, low: 1, medium: 1, high: 2, ultra: 2 }; // chunks of full detail round the player

/** Boot the engine on a scene source (scene/source.js). Returns the engine object the world API is built on. */
export async function createEngine({ source, params = {}, modules = {}, content, onProgress = () => {} }) {
  const F = { ...DEFAULT_MODULES, ...modules }, clock = createClock();
  const G = { THREE, params, events: createEvents(), rng: createRng(+(params.seed || 4207)), time: clock.time, clock, quality: pickQuality(params.q || ''), hold: { mode: null }, photo: null };
  let lastK = 0;
  const step = async (label, k, fn) => { lastK = k; onProgress(label, k); await new Promise((r) => setTimeout(r, 0)); return fn(); };
  /** Real progress inside a step, for any module: `G.progress('textures', done, total)` (host/boot.js shows it; phases in docs/WORLD-API.md). */
  G.progress = (phase, done, total) => { try { onProgress(phase, lastK, { phase, done, total }); } catch (e) { console.error('[engine] onProgress threw: ' + e); } };
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const m = source.manifest;

  // the content pack: the product's (an object or a promise of one) over the default
  const extra = (await content) || {};
  G.content = mergePacks(DEFAULT_PACK, extra);
  const bad = validatePack(G.content, { validateBehaviour });
  if (bad.length) throw new Error('content pack: ' + bad.join('; '));

  G.georef = createGeoref(m.georef);
  // the sky is set before anything captures it (environment, fx)
  const amb = ambienceOf(params, m.ambience); // a host switch wins over the scene's ambience, which wins over the default
  const look = G.look = resolveLook(m.ambience && m.ambience.look, parseLookParam(params.look));
  const atmosphere = (hour) => atmosphereAt({ lat: G.georef.anchorGeo.lat, day: amb.day, hour, haze: amb.haze, cloud: amb.cloud, convergenceDeg: G.georef.convergenceDeg, look });
  let hour = amb.tod;

  await step('renderer', 0.05, async () => { G.render = await F.render(G); });
  G.renderer = G.render.renderer; G.scene = G.render.scene; G.camera = G.render.camera; G.viewCamera = G.render.viewCamera;
  G.render.setLook && G.render.setLook(look);
  G.render.setAtmosphere(atmosphere(hour));
  await step('materials', 0.15, async () => { G.mats = await F.mats(G); });
  if (G.mats.setDetail && !params.nodetail) { // image layer: loads in the background, procedural until then (a photo waits for it)
    const dp = G.mats.setDetail(m.style && m.style.detail).catch((e) => console.warn('[detail] ' + ((e && e.message) || e)));
    if (params.shot) await dp;
  }
  G.mats.uniforms.wet.value = amb.wet; G.render.post.wet = G.mats.uniforms.wet.value;

  const w = m.walkable || m.bounds;
  G.terrain = createTerrain({ grid: m.grid });
  G.physics = createPhysics({ terrain: G.terrain, vec, bounds: { min: vec(w.minX, -20, w.minZ), max: vec(w.maxX, 2000, w.maxZ) } });
  G.nav = createNav({ physics: G.physics, terrain: G.terrain, vec }); G.physics.nav = G.nav;
  G.doors = createDoors(G); // the loader hands it each cell's doors as the cells show
  G.input = F.input(G);

  const radius = +(params.radius || RADIUS[G.quality.name] || 1);
  const scene = await step('scene', 0.3, () => createSceneLoader(G, source, { radius }));
  G.level = scene.level; G.ground = scene.ground; G.backdrop = scene.backdrop;
  // a start: the middle of the walkable box until the host places the player
  const sx = +(params.x ?? (w.minX + w.maxX) / 2), sz = +(params.z ?? (w.minZ + w.maxZ) / 2);
  await step('terrain and buildings', 0.45, async () => { // chunks fetched + meshed over twice the window, +2 for the near cells built in one go at the end
    const g = m.grid, pce = g.ce(sx), pcn = g.cn(sz); let need = 0;
    for (let dn = -radius; dn <= radius; dn++) for (let de = -radius; de <= radius; de++) if (source.has(pce + de, pcn + dn)) need++;
    const total = 2 * need + 2, poll = () => { const s = G.level.stats(); G.progress('terrain and buildings', Math.min(total - 2, s.fetched + s.chunksLive), total); }, timer = setInterval(poll, 40);
    try { await G.level.preload(sx, sz); } finally { clearInterval(timer); }
    G.progress('terrain and buildings', total, total);
  });
  G.level.playerStart.pos.set(sx, G.physics.groundHeight(sx, sz), sz); G.level.playerStart.yaw = +(params.yaw || 0);
  G.nav.recenter(sx, sz, true);

  await step('effects', 0.7, async () => { G.fx = await F.fx(G); });
  await step('audio', 0.75, async () => { try { G.audio = params.noaudio ? silentAudio() : await F.audio(G); } catch (e) { console.error('[engine] audio failed, running silent: ' + e); G.audio = silentAudio(); } });
  G.treefall = createTreefall(G);
  G.player = F.player(G);
  G.combat = F.combat(G);
  await step('weapon', 0.8, async () => { G.weapon = await F.weapon(G); });
  G.threats = G.enemies = F.threats(G, { archetypes: G.content.threats, tuning: G.content.threatTuning }); // `enemies` is the name the lifted combat and audio modules read
  G.hud = await F.hud(G);
  G.game = F.game(G);
  G.director = createDirector(G, { setTimeOfDay: (h) => engine.setTimeOfDay(h), setWet: (k) => engine.setWet(k) });
  G.player.reset(G.level.playerStart); G.player.enabled = false;
  await step('first light', 0.92, () => G.render.onLevelReady());

  // ---- the frame ------------------------------------------------------------------------------------------------
  // A module that throws loses its own update and nothing else: the loop goes on, and the host is told once per stage
  // (event `engine:error { module, message }`, surfaced by the world API as `error`). Nothing is disabled automatically.
  const errs = {}, safe = (name, fn) => {
    try { return fn(); } catch (e) {
      if (!errs[name]) {
        errs[name] = 1; console.error(`[loop] ${name} threw: ${(e && e.stack) || e}`);
        try { G.events.emit('engine:error', { module: name, message: String((e && e.message) || e) }); } catch (e2) { console.error('[loop] engine:error listener threw: ' + e2); }
      }
    }
  };
  const upd = (name, dt) => { const mod = G[name]; if (mod && mod.update) safe(name, () => mod.update(dt)); };
  /** One simulation step of `dt` seconds (already scaled). */
  function simulate(dt) {
    const state = safe('game', () => G.game.state), active = safe('game', () => G.game.update(dt)) !== false && state !== 'title' && state !== 'paused';
    if (active && dt > 0) { upd('player', dt); upd('doors', dt); upd('weapon', dt); upd('threats', dt); upd('director', dt); }
    else if (active) upd('player', 0); // frozen: the camera still follows the view angles (the hold tilts the view)
    if (state !== 'paused' && dt > 0) { upd('treefall', dt); upd('fx', dt); upd('ground', dt); upd('mats', dt); }
    upd('level', dt); // streaming goes on whatever the clock does
  }
  function posePhoto() {
    const c = G.camera, p = G.photo;
    c.position.set(p.x, p.y, p.z); c.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (c.fov !== p.fov) { c.fov = p.fov; c.updateProjectionMatrix(); }
  }
  let last = performance.now(), smooth = 0, frames = 0, running = true;
  const hooks = [], drawn = [];
  const fixed = params.dt ? +params.dt : undefined; // a fixed step makes a run repeatable (tests, replays)
  function frame() {
    if (!running) return;
    try {
      const now = performance.now(), real = (now - last) / 1000; last = now; smooth = smooth ? smooth * 0.95 + real * 0.05 : real;
      const dt = safe('clock', () => clock.tick(real, fixed)) ?? 0;
      upd('input', dt);
      for (const fn of hooks) safe('hook', () => fn(fixed ?? Math.min(real, 0.1)));
      safe('simulate', () => simulate(dt));
      upd('audio', dt); upd('hud', dt);
      if (G.photo) safe('photo', posePhoto); // photo mode: the camera is the caller's, whatever the player does
      safe('render', () => G.render.frame(dt));
      safe('input.endFrame', () => G.input.endFrame && G.input.endFrame());
    } catch (e) { safe('frame', () => { throw e; }); } // nothing above may stop the loop: whatever got here is logged and told once
    finally { if (++frames === 2) for (const res of drawn.splice(0)) safe('drawn', res); }
  }
  G.renderer.setAnimationLoop(frame);

  const engine = {
    G,
    get frames() { return frames; },
    /** Resolves once two frames have been drawn. */
    whenDrawn: () => (frames >= 2 ? Promise.resolve() : new Promise((res) => drawn.push(res))),
    /** Call `fn(realSeconds)` every frame, whatever the clock's scale is (the hold's view tilt runs on it). */
    onFrame(fn) { hooks.push(fn); },
    stats: () => ({ ...(G.render.stats ? G.render.stats() : {}), frameMs: +(smooth * 1000).toFixed(1), quality: G.quality.name, scene: G.level.stats(), physics: G.physics.stats(), nav: G.nav.stats(), threats: G.threats.aliveCount(), state: G.game.state }),
    setTimeOfDay(h) { hour = h; G.render.setAtmosphere(atmosphere(h)); },
    get timeOfDay() { return hour; },
    setWet(k) { G.mats.uniforms.wet.value = k; G.render.post.wet = k; },
    stop() { running = false; G.renderer.setAnimationLoop(null); },
  };
  onProgress('ready', 1);
  return engine;
}
