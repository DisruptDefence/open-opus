// The door. openWorld() returns the world API at once, in state 'loading', and boots the engine behind it; the
// caller publishes it (window.__OPUS_WORLD) and awaits ready(). Until then on(), state(), ready() and held() answer;
// anything else throws, because there is no world to act on yet.
import { createEngine } from './engine.js';
import { createWorldApi } from './world-api.js';
import { ScenarioCommandError } from '../director/command-error.js';

/**
 * @param source   a scene source (scene/source.js), or a promise of one
 * @param params   switches: q (quality), tod, wet, haze, seed, noaudio, dt (fixed step), radius, x, z
 * @param content  a content pack (opus-content/1, docs/CONTENT-PACK.md) or a promise of one, merged over the default pack
 * @param modules  factories that replace an engine module, e.g. { hud: createDevHud }
 * @param onProgress  (label, fraction) while loading
 */
export function openWorld({ source, params = {}, modules = {}, content, onProgress } = {}) {
  const listeners = new Map();
  const emit = (name, e) => { for (const fn of [...(listeners.get(name) || [])]) { try { fn(e); } catch (err) { console.error(`[world] listener for "${name}" threw`, err); } } };
  let api = null, engine = null;
  const boot = Promise.resolve(source)
    .then((src) => createEngine({ source: src, params, modules, content, onProgress }))
    .then(async (e) => { engine = e; const inner = createWorldApi(e, emit); await e.whenDrawn(); api = inner; emit('state', { state: api.state(), from: 'loading' }); });
  boot.catch(() => {}); // the caller sees the failure through ready()
  const need = (name) => { if (!api) throw new Error(`world.${name}(): the world is still loading; await ready() first`); return api; };
  const call = (name) => (...args) => need(name)[name](...args);
  const geo = (name) => (...args) => need('geo.' + name).geo[name](...args);

  const world = {
    version: 1,
    ready: () => boot,
    state: () => (api ? api.state() : 'loading'),
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); return () => { const l = listeners.get(name), i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
    start: call('start'), pause: call('pause'), resume: call('resume'),
    canHold: () => (api ? api.canHold() : false),
    hold: (mode) => (api ? api.hold(mode) : false),
    setHoldMode: call('setHoldMode'),
    held: () => (api ? api.held() : null),
    release: () => { if (api) api.release(); },
    snapshot: call('snapshot'), settings: call('settings'),
    geo: { toGeo: geo('toGeo'), toGame: geo('toGame'), toMGRS: geo('toMGRS'), toUTM: geo('toUTM'), headingTrue: geo('headingTrue'), get convergenceDeg() { return need('geo.convergenceDeg').geo.convergenceDeg; } },
    scene: call('scene'),
    overhead: call('overhead'),
    photo: (pose) => { try { return Promise.resolve(need('photo').photo(pose)); } catch (e) { return Promise.reject(e); } },
    stats: call('stats'),
    photographing: () => (api ? api.photographing() : false),
    apply: (cmd) => { if (!api) throw new ScenarioCommandError('not-ready', cmd && cmd.op, 'the world is still loading; await ready() first'); api.apply(cmd); },
  };
  // For the engine's own checks (frame statistics, a manual frame in tests). Not on the world object, so nothing
  // that holds only the door can reach it.
  internals.set(world, { get engine() { return engine; } });
  return Object.freeze(world);
}
const internals = new WeakMap();
/** The engine behind a world: for this repository's tests and development tools only. */
export const engineOf = (world) => internals.get(world).engine;
