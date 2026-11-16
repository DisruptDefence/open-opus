// The engine without a screen, for tests under Node: the real scene loader, physics, navigation, player controller,
// combat, threats, director, session and world API, with the modules that need WebGL, audio or a keyboard replaced
// through the engine's own module registry. Frames are run by hand at a fixed step, so a run is repeatable.
import { PerspectiveCamera, Scene, MeshBasicMaterial } from '../vendor/three.module.js';
import { openWorld, engineOf } from '../src/world/open.js';

const nothing = () => {};
export const STEP = 1 / 60;

export function openHeadlessWorld(source, params = {}, { content } = {}) {
  let loop = null;
  const keys = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, fire: false, ads: false, sprint: false, crouch: false, locked: false, gameplay: false, mode: 'lock' };
  const input = () => Object.assign(keys, {
    down: () => false, pressed: () => false, update: nothing, endFrame: nothing, setPrompt: nothing,
    requestLock() { keys.locked = true; }, exitLock() { keys.locked = false; }, setGameplay(on) { keys.gameplay = !!on; },
  });
  const material = new MeshBasicMaterial();
  const render = () => {
    const camera = new PerspectiveCamera();
    return { renderer: { domElement: null, setAnimationLoop(fn) { loop = fn; } }, scene: new Scene(), camera, viewCamera: camera, post: {}, setAtmosphere: nothing, onLevelReady: nothing, frame: nothing };
  };
  const hudCalls = [];
  const hud = () => ({ show: (on) => hudCalls.push(['show', on]), message: (t) => hudCalls.push(['message', t]), setObjective: nothing, setPrompt: nothing, warn: nothing, hitmarker: nothing, update: nothing });
  const world = openWorld({ source, content, params: { dt: STEP, noaudio: 1, q: 'low', ...params }, modules: {
    render, input, hud,
    mats: () => ({ uniforms: { wet: { value: 0 } }, get: () => material, update: nothing }),
    fx: () => ({ update: nothing, muzzleFlash: nothing, tracer: nothing }),
    weapon: () => ({ stub: true, name: 'none', ammo: 0, reserve: 0, update: nothing, reset: nothing }),
  } });
  /** Run frames for `seconds` of game time at the fixed step (fewer game seconds pass under a hold). */
  const run = (seconds) => { for (let t = 0; t < seconds - 1e-9; t += STEP) loop(); };
  // the browser draws the first frames by itself; here somebody has to
  const pump = setInterval(() => { if (loop) { loop(); loop(); clearInterval(pump); } }, 1);
  world.ready().catch(() => clearInterval(pump));
  return { world, keys, run, hudCalls, engine: () => engineOf(world) };
}
