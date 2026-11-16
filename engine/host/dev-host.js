// The engine's own host page. It stands where a product's game page and a session host will stand, and it uses the
// engine exactly as they must: openWorld(), then the world API (window.__OPUS_WORLD) and nothing else.
//
//   dev.html                               the generated test scene and its scenario
//   dev.html?scenario=old-quebec           scenarios/old-quebec.json, which names its scene
//   dev.html?scene=../scenes/x.json        a scene without a mission (a single file, or a package folder)
//   switches: q (test|low|medium|high|ultra), tod (hour 0-24), wet (0-1), haze, seed, noaudio, autostart, dt, radius
//
// What is published for checks: window.__OPUS_WORLD (the contract), window.__mission (what the mission host did),
// window.__errors, window.__ready, window.__fatal.
import { openWorld, packageSource, jsonSource, createHud, createBoot, DEFAULT_PACK } from '../index.js';
import { runMission } from './mission.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason)));
{ const err = console.error.bind(console); console.error = (...a) => { try { window.__errors.push(a.map((v) => (v && v.stack) || String(v)).join(' ').slice(0, 600)); } catch { /* keep going */ } err(...a); }; }
const $ = (id) => document.getElementById(id);
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };

async function openScene(spec, boot) {
  if (!spec || spec === 'test') { boot.skip('download'); return packageSource(new URL('../scenes/test/', import.meta.url).href); }
  const url = new URL(spec, location.href).href;
  if (url.endsWith('.json')) return jsonSource(await boot.fetchJson(url));
  boot.skip('download');
  return packageSource(url.endsWith('/') ? url : url + '/');
}

async function main() {
  const name = params.scenario || (params.scene ? null : 'test');
  if (name && !/^[\w-]+$/.test(name)) throw new Error('scenario: a name of letters, digits, - and _');
  const scenario = name ? await getJson(new URL(`./scenarios/${name}.json`, import.meta.url).href) : null;
  if (scenario && scenario.start) { params.x ??= scenario.start.x; params.z ??= scenario.start.z; } // load the chunks round the start first

  const boot = createBoot({ parent: $('app'), words: DEFAULT_PACK.loader, brand: 'OPUS engine', title: (scenario && scenario.name) || 'Engine host page', subtitle: params.scene || (scenario && scenario.scene) || '' });
  window.__boot = boot;
  const world = openWorld({ source: openScene(params.scene || (scenario && scenario.scene), boot), params, modules: { hud: createHud }, onProgress: boot.onProgress });
  window.__OPUS_WORLD = world; // the contract. Everything below uses only this.

  const mission = scenario ? runMission(world, scenario, { log: (t) => console.log('[mission] ' + t) }) : null;
  window.__mission = mission ? mission.record : null;
  world.on('state', (e) => {
    if (e.state === 'dead') world.apply({ op: 'say', text: 'Down. Press Enter to redeploy.', seconds: 60 });
    if (e.state === 'complete' || e.state === 'dead') { btn.textContent = e.state === 'complete' ? 'Complete. Deploy again' : 'Redeploy'; btn.style.display = ''; }
  });

  const ui = $('ui'), btn = document.createElement('button'), help = document.createElement('div');
  btn.id = 'start'; btn.textContent = 'Deploy'; btn.style.display = 'none'; help.id = 'help';
  help.textContent = 'WASD move · Shift sprint · C crouch · Space jump (hold forward at a low wall to climb it) · mouse or arrows look · click or Enter fire · right mouse aim · R reload · H hold (pause) · G hold (slow motion)';
  ui.append(btn, help);

  try { await world.ready(); } catch (e) { boot.fail(e); throw e; }
  await boot.done(); btn.style.display = '';
  const go = () => { btn.style.display = 'none'; if (mission) mission.start(); else world.start(); };
  btn.addEventListener('click', go);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const s = world.state();
    if (e.code === 'Enter' && s !== 'playing' && s !== 'paused') go();
    else if (e.code === 'KeyH' || e.code === 'KeyG') { if (world.held()) world.release(); else world.hold(e.code === 'KeyG' ? 'slow' : 'pause'); }
    else if ((e.code === 'Escape' || e.code === 'KeyP') && !world.held()) { if (s === 'playing') world.pause(); else if (s === 'paused') world.resume(); }
  });
  $('view').addEventListener('click', () => { if (world.state() === 'paused') world.resume(); });
  if (params.autostart) go();
  window.__ready = true;
}
main().catch((e) => { window.__fatal = String((e && e.stack) || e); console.error('[fatal] ' + window.__fatal); if (window.__boot && !window.__ready) window.__boot.fail(e); else { const d = document.createElement('div'); d.id = 'fatal'; d.textContent = 'The engine could not start: ' + window.__fatal; $('app').appendChild(d); } });
