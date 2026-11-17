// The world API over a booted engine: docs/WORLD-API.md, version 1. Rules kept here:
//   - nothing of three.js, no engine object and no DOM node crosses it: plain numbers, strings, arrays, objects,
//     and for the overhead picture an ImageBitmap;
//   - `hold` owns everything about holding the game (time scale, input, pointer, HUD, audio, the downward look);
//   - the engine imports nothing of the mission client or the phone; they call in, and listen to events.
// Headings that cross the door are degrees clockwise from grid north (what snapshot().self.heading reports); the
// engine's own yaw (radians, positive to the left) stays inside.
// open.js publishes this object behind a facade that exists while the scene is still loading.
import { ScenarioCommandError } from '../director/command-error.js';

const SLOW = 0.08, LOOK_DOWN = -0.95, TILT_S = 0.32;
const round = (v, d = 100) => Math.round(v * d) / d;
const yawOf = (headingDeg) => (-(+headingDeg || 0) * Math.PI) / 180;

/** `emit(name, data)` sends an event to the listeners of world.on(). */
export function createWorldApi(engine, emit) {
  const G = engine.G, marks = G.director.marks;

  // ---- events out: engine events are translated to plain data ----------------------------------------------------
  const threatOf = (t) => ({ id: t.id, kind: 'threat', type: t.type, archetype: t.archetype, x: round(t.pos.x), y: round(t.pos.y), z: round(t.pos.z), alive: t.alive, state: t.mode });
  const markOf = (k) => ({ id: k.id, kind: k.kind, type: k.type, label: k.label, x: k.x, y: round(k.y), z: k.z, radius: k.radius, alive: true, state: k.used ? 'used' : k.reached ? 'reached' : 'open', ...(k.use ? { use: { prompt: k.use.prompt, progress: round(k.progress, 1000) } } : {}) });
  G.events.on('game:state', (e) => emit('state', { state: e.state, from: e.from }));
  G.events.on('player:dead', () => emit('player:dead', {}));
  G.events.on('player:hit', (e) => emit('player:hit', { amount: e.amount, health: round(G.player.health), ...(e.fromPos && Number.isFinite(e.fromPos.x) ? { from: { x: round(e.fromPos.x), y: round(e.fromPos.y), z: round(e.fromPos.z) } } : {}) }));
  G.events.on('enemy:spawn', (e) => emit('entity', { change: 'spawn', ...threatOf(e.enemy) }));
  G.events.on('enemy:state', (e) => emit('entity', { change: 'state', from: e.from, ...threatOf(e.enemy) }));
  G.events.on('enemy:killed', (e) => emit('entity', { change: 'killed', ...threatOf(e.enemy) }));
  G.events.on('enemy:fire', (e) => emit('entity', { change: 'fire', ...threatOf(e.enemy) }));
  G.events.on('enemy:despawn', (e) => emit('entity', { change: 'despawn', ...threatOf(e.enemy) }));
  G.events.on('director:mark', (e) => emit('entity', { change: 'spawn', ...markOf(e.mark) }));
  G.events.on('director:unmark', (e) => emit('entity', { change: 'despawn', ...markOf(e.mark) }));
  G.events.on('director:reached', (e) => emit('interact', { id: e.id, kind: e.kind, action: 'reached', time: round(e.time) }));
  G.events.on('director:interact', (e) => emit('interact', { id: e.id, kind: e.kind, action: e.action, time: round(e.time), progress: round(e.progress, 1000) }));
  G.events.on('director:say', (e) => emit('say', { text: e.text, channel: e.channel }));
  G.events.on('weapon:fire', () => emit('shot', { ammo: G.weapon.ammo }));
  G.events.on('door:opened', (e) => emit('door:opened', { id: e.id }));
  G.events.on('door:closed', (e) => emit('door:closed', { id: e.id }));
  G.events.on('engine:error', (e) => emit('error', { module: e.module, message: e.message }));
  G.events.on('tree:felled', (e) => emit('tree:felled', { id: e.id, x: e.x, z: e.z }));
  G.events.on('scene:chunk', (e) => emit('chunk', { ce: e.ce, cn: e.cn, live: e.live }));

  // ---- holding ---------------------------------------------------------------------------------------------------
  // The view tilts down to the phone and back in real time, on the engine's frame: the clock is stopped under a hold.
  let pitchBefore = null, tilt = null;
  const lookTo = (target) => { tilt = { from: G.player.pitch, to: target, t: 0 }; };
  engine.onFrame((real) => {
    if (!tilt) return;
    tilt.t = Math.min(1, tilt.t + real / TILT_S);
    const e = tilt.t * tilt.t * (3 - 2 * tilt.t);
    G.player.pitch = tilt.from + (tilt.to - tilt.from) * e;
    if (tilt.t >= 1) tilt = null;
  });
  const applyMode = (mode) => { G.hold.mode = mode; G.clock.setScale(mode === 'slow' ? SLOW : 0); try { G.audio.setPaused(mode === 'pause'); } catch { /* silent */ } };
  function letGo() { G.hold.mode = null; G.clock.setScale(1); try { G.audio.setPaused(false); } catch { /* silent */ } }
  const canHold = () => G.game.state === 'playing' && !G.hold.mode;
  function hold(mode = 'pause') {
    if (!canHold()) return false;
    applyMode(mode === 'slow' ? 'slow' : 'pause');
    G.input.setGameplay(false); G.input.exitLock(); G.hud.show(false);
    pitchBefore = G.player.pitch;
    lookTo(LOOK_DOWN);
    emit('hold', { mode: G.hold.mode });
    return true;
  }
  function release() {
    if (!G.hold.mode) return;
    letGo();
    if (G.game.state === 'playing') {
      if (pitchBefore != null) lookTo(pitchBefore);
      G.hud.show(true); G.input.setGameplay(true); G.input.requestLock();
    } else tilt = null;
    pitchBefore = null;
    emit('hold', { mode: null });
  }
  // the game ended under the hold (the player died in slow motion, the host ended the run): the hold is over
  G.events.on('game:state', (e) => { if (G.hold.mode && e.state !== 'playing') release(); });

  // ---- the overhead picture --------------------------------------------------------------------------------------
  async function overhead({ x = G.player.pos.x, z = G.player.pos.z, halfWidth = 120, halfHeight = 84, pxPerMetre = 4 } = {}) {
    const T = G.THREE, R = G.renderer, W = Math.round(halfWidth * 2 * pxPerMetre), H = Math.round(halfHeight * 2 * pxPerMetre);
    const top = (G.terrain.maxY > -1e9 ? G.terrain.maxY : 100) + 150, cam = new T.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, top + 50);
    cam.position.set(x, top, z); cam.up.set(0, 0, -1); cam.lookAt(x, 0, z); cam.updateMatrixWorld();
    const rt = new T.WebGLRenderTarget(W, H, { depthBuffer: true, type: T.HalfFloatType }), px = new Float32Array(W * H * 4);
    const hidden = G.scene.children.filter((c) => ['sky', 'fx', 'enemies', 'mark'].includes(c.name) && c.visible);
    hidden.forEach((o) => { o.visible = false; });
    const u16 = new Uint16Array(W * H * 4);
    try { G.render.renderWorld(cam, rt); R.readRenderTargetPixels(rt, 0, 0, W, H, u16); } finally { hidden.forEach((o) => { o.visible = true; }); rt.dispose(); }
    for (let i = 0; i < u16.length; i++) px[i] = T.DataUtils.fromHalfFloat(u16[i]);
    // linear HDR to something that reads as imagery: expose to the picture's own average, then gamma
    let sum = 0; for (let i = 0; i < px.length; i += 16) sum += px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
    const k = 0.32 / Math.max(1e-4, sum / (px.length / 16)), img = new ImageData(W, H);
    for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
      const s = ((H - 1 - row) * W + col) * 4, d = (row * W + col) * 4; // GL rows are bottom-up
      for (let c = 0; c < 3; c++) { const v = px[s + c] * k; img.data[d + c] = Math.min(255, Math.round(255 * Math.pow(v / (1 + v) * 1.6, 1 / 2.2))); }
      img.data[d + 3] = 255;
    }
    return { image: await createImageBitmap(img), width: W, height: H, bounds: { minX: x - halfWidth, maxX: x + halfWidth, minZ: z - halfHeight, maxZ: z + halfHeight } };
  }

  // ---- photo mode ------------------------------------------------------------------------------------------------
  // The camera leaves the player and stands where the caller says: no HUD, no weapon, no player input. The scene
  // streams round the camera while it lasts. The simulation is not stopped: a caller that wants stillness pauses.
  let fovBefore = null;
  async function photo(pose) {
    if (pose == null) {
      if (!G.photo) return null;
      G.photo = null;
      if (fovBefore != null) { G.camera.fov = fovBefore; G.camera.updateProjectionMatrix(); fovBefore = null; }
      const playing = G.game.state === 'playing';
      if (G.weapon.setVisible) G.weapon.setVisible(playing || G.game.state === 'paused');
      if (playing && !G.hold.mode) { G.hud.show(true); G.input.setGameplay(true); }
      emit('photo', { on: false });
      return null;
    }
    const x = +pose.x, z = +pose.z;
    if (!(Number.isFinite(x) && Number.isFinite(z))) throw new Error('photo: a pose needs x and z in game metres');
    const was = !!G.photo, deg = Math.PI / 180;
    const p = { x, z, y: 0, yaw: yawOf(pose.heading), pitch: Math.max(-89, Math.min(89, +pose.pitch || 0)) * deg, fov: Math.max(10, Math.min(120, +pose.fov || 60)) };
    if (fovBefore == null) fovBefore = G.camera.fov;
    const place = () => { p.y = Number.isFinite(+pose.y) && pose.y != null ? +pose.y : G.physics.groundHeight(x, z) + (Number.isFinite(+pose.height) && pose.height != null ? +pose.height : 1.7); };
    place(); G.photo = p;
    G.hud.show(false); G.input.setGameplay(false); if (G.weapon.setVisible) G.weapon.setVisible(false);
    if (!was) emit('photo', { on: true });
    await G.level.preload(x, z); // the ground under the camera may only now be known
    if (G.photo === p) place();
    return { x, y: round(p.y), z, heading: ((+pose.heading || 0) % 360 + 360) % 360, pitch: round(p.pitch / deg), fov: p.fov };
  }

  const man = G.level.manifest;
  let volume = 0.9; // the audio module's own default
  return {
    version: 1,
    state: () => G.game.state,
    start(opts = {}) {
      const at = opts.at ? { x: +opts.at.x, z: +opts.at.z, y: opts.at.y, yaw: yawOf(opts.at.heading) } : null;
      if (at && !(Number.isFinite(at.x) && Number.isFinite(at.z))) throw new Error('start: `at` needs x and z in game metres');
      if (opts.fadeIn !== undefined && !(Number.isFinite(opts.fadeIn) && opts.fadeIn >= 0)) throw new Error('start: `fadeIn` is a number of seconds, 0 or more');
      try { G.audio.resume(); } catch { /* no audio */ }
      G.input.requestLock(); G.game.start({ at, fadeIn: opts.fadeIn });
    },
    pause: () => G.game.pause(), resume: () => G.game.resume(),

    canHold, hold, release,
    held: () => G.hold.mode,
    setHoldMode(mode) { if (G.hold.mode) { applyMode(mode === 'slow' ? 'slow' : 'pause'); emit('hold', { mode: G.hold.mode }); } },

    snapshot() {
      const p = G.player, entities = [];
      for (const k of marks.values()) entities.push(markOf(k));
      for (const t of G.threats.list) entities.push(threatOf(t));
      const wp = G.weapon, st = G.combat.stats || {};
      return {
        time: G.time.t,
        self: { x: p.pos.x, y: p.pos.y, z: p.pos.z, heading: G.georef.headingGrid(p.yaw), headingTrue: G.georef.headingTrue(p.yaw), speed: p.speed || 0, health: p.health,
          weapon: { id: String(wp.id ?? 'carbine'), name: String(wp.name ?? ''), ammo: wp.ammo ?? 0, magSize: wp.magSize ?? 0, reserve: wp.reserve ?? 0, state: String(wp.state ?? 'idle') } },
        stats: { shots: st.shots || 0, hits: st.hits || 0, kills: st.kills || 0 },
        entities,
      };
    },
    /** What the player's settings are; a patch sets what it names, clamped. Unknown keys are ignored. */
    settings(patch) {
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      if (patch && typeof patch === 'object') {
        if (Number.isFinite(patch.sensitivity)) G.input.sensitivity = clamp(patch.sensitivity, 0.2, 3);
        if (typeof patch.invertY === 'boolean') G.input.invertY = patch.invertY;
        if (Number.isFinite(patch.volume)) { volume = clamp(patch.volume, 0, 1); try { G.audio.setVolume(volume); } catch { /* silent */ } }
        if (Number.isFinite(patch.fov)) G.player.setFov(clamp(patch.fov, 60, 100));
      }
      return { sensitivity: G.input.sensitivity ?? 1, invertY: !!G.input.invertY, volume, fov: G.player.baseFov };
    },

    geo: {
      toGeo: (x, z, y = 0) => G.georef.toGeo(x, z, y),
      toGame: (lat, lon) => G.georef.toGame(lat, lon),
      toMGRS: (x, z, digits = 5) => G.georef.toMGRS(x, z, digits),
      toUTM: (x, z) => G.georef.toUTM(x, z),
      /** True heading (degrees) of a grid heading (degrees): the scene's convergence applied. */
      headingTrue: (heading) => (((+heading + G.georef.convergenceDeg) % 360) + 360) % 360,
      convergenceDeg: G.georef.convergenceDeg,
    },
    scene: () => ({ id: man.id, name: man.name, version: man.version, bounds: { ...man.bounds }, walkable: { ...(man.walkable || man.bounds) }, credits: [...(man.credits || [])] }),
    overhead,
    photo,
    /** What the last frame cost, as plain numbers: for budgets and captures. */
    stats() { const t = engine.stats(), sc = t.scene || {}; return { quality: t.quality, frameMs: t.frameMs, calls: t.calls ?? 0, triangles: t.tris ?? 0, chunksLive: sc.chunksLive ?? 0, sceneTriangles: sc.tris ?? 0, buildMs: round(sc.buildMs ?? 0, 10), cellsNear: sc.cellsNear ?? 0, nearBuildMs: round(sc.nearBuildMs ?? 0, 10) }; },
    photographing: () => !!G.photo,
    /** Street doors that open (world/doors.js): only the doors of cells that are showing in detail exist. */
    doors: { open: (id) => G.doors.open(String(id)), close: (id) => G.doors.close(String(id)), near: (x, z, r) => G.doors.near(+x, +z, r == null ? undefined : +r) },
    /** Scenario commands (director/director.js). Throws a ScenarioCommandError, and only that, when one cannot be applied. */
    apply(cmd) {
      let copy;
      try { copy = JSON.parse(JSON.stringify(cmd)); } catch { throw new ScenarioCommandError('invalid', cmd && cmd.op, 'a command is plain data'); }
      try { G.director.apply(copy); } catch (e) { throw e instanceof ScenarioCommandError ? e : new ScenarioCommandError('invalid', copy && copy.op, String((e && e.message) || e)); }
    },
  };
}
