// A host page with the phone: Old Quebec, the engine's own mission host, and the phone on T. Out of the box the phone
// shows the placeholder screen; when the local gateway answers (phone/local/run.sh) it shows a real ATAK instead. The
// page uses the engine as any product must — openWorld(), then the world API — and puts the phone host beside it.
//
//   demo.html                               phone/scenarios/old-quebec-atak.json
//   demo.html?scenario=name                 phone/scenarios/<name>.json
//   demo.html?gateway=ws://127.0.0.1:9741   where the local phone gateway listens (phone/local/run.sh)
//   switches of the engine's host page also work: q, tod, wet, noaudio, autostart
//
// Published for checks: window.__OPUS_WORLD, window.__phone, window.__mission, window.__reports, window.__errors.
import { openWorld, jsonSource, packageSource, createDevHud } from '../engine/index.js';
import { runMission } from '../engine/host/mission.js';
import { createPhoneHost } from './host.js';
import { createPlaceholderScreen } from './placeholder-screen.js';
import { createStreamScreen, DEFAULT_GATEWAY } from './stream-screen.js';
import { eitherScreen } from './either-screen.js';
import { withPhoneReports } from './reports.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason)));
const $ = (id) => document.getElementById(id);
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };

async function main() {
  const name = params.scenario || 'old-quebec-atak';
  if (!/^[\w-]+$/.test(name)) throw new Error('scenario: a name of letters, digits, - and _');
  const scenarioUrl = new URL(`./scenarios/${name}.json`, import.meta.url);
  const scenario = await getJson(scenarioUrl.href);
  params.x ??= scenario.start.x; params.z ??= scenario.start.z; // load the ground round the start first
  const sceneUrl = new URL(scenario.scene, location.href).href; // relative to the page, as the engine's own host page reads it
  const source = sceneUrl.endsWith('.json') ? getJson(sceneUrl).then(jsonSource) : packageSource(sceneUrl.endsWith('/') ? sceneUrl : sceneUrl + '/');

  const world = openWorld({ source, params, modules: { hud: createDevHud },
    onProgress: (label, k) => { $('boot-msg').textContent = label; $('fill').style.width = Math.round(k * 100) + '%'; } });
  window.__OPUS_WORLD = world;

  const ui = $('ui'), btn = document.createElement('button'), help = document.createElement('div'), brief = document.createElement('div');
  btn.id = 'start'; btn.textContent = 'Deploy'; btn.style.display = 'none'; help.id = 'help'; brief.id = 'brief';
  help.textContent = 'WASD move · Shift sprint · mouse look · T or Tab: the phone · Esc or Tab puts it away (with a real ATAK connected, every other key goes to ATAK)';
  ui.append(btn, help, brief);

  await world.ready();

  // The phone: a real ATAK streamed from the local gateway when one answers, the placeholder screen otherwise.
  const stream = createStreamScreen({ url: params.gateway || DEFAULT_GATEWAY }), screen = eitherScreen(stream, createPlaceholderScreen());
  const phone = createPhoneHost(world, screen, { mount: $('app') });
  window.__phone = phone; window.__reports = [];

  // The mission host hears the world and the phone. The places it judges reports against stay with it.
  const heard = withPhoneReports(world, phone, scenario.places);
  heard.on('phone', (e) => { if (e.action === 'cot') window.__reports.push(e); if (e.action === 'overlay') window.__overlay = e; });
  const mission = runMission(heard, scenario, { log: (t) => console.log('[mission] ' + t) });
  window.__mission = mission.record;

  const LINK = { absent: 'phone: placeholder (no real ATAK connected; phone/README.md)', connected: 'phone: connected, waiting for its picture', live: 'phone: real ATAK, live', 'no-decoder': 'phone: this browser cannot decode its video', 'bad-codec': 'phone: this browser cannot decode its video codec' };
  const drawBrief = () => {
    const done = new Set(mission.record.map((r) => r.rule));
    brief.innerHTML = '<b></b><ul></ul><div class="link"></div>';
    brief.firstChild.textContent = scenario.name;
    for (const o of scenario.objectives || []) { const li = document.createElement('li'); li.textContent = (done.has(o.rule) ? '✓ ' : '') + o.text; li.className = done.has(o.rule) ? 'done' : ''; brief.children[1].appendChild(li); }
    brief.lastChild.textContent = LINK[stream.status()] || ''; brief.lastChild.className = 'link ' + stream.status();
  };
  drawBrief(); stream.on(drawBrief); setInterval(drawBrief, 500);

  world.on('state', (e) => {
    if (e.state === 'complete' || e.state === 'dead') { btn.textContent = e.state === 'complete' ? 'Complete. Deploy again' : 'Redeploy'; btn.style.display = ''; }
  });
  $('boot').classList.add('done'); btn.style.display = '';
  const go = () => { btn.style.display = 'none'; mission.start(); };
  btn.addEventListener('click', go);
  window.addEventListener('keydown', (e) => { // after the phone's own listener, which keeps the keys it used
    if (e.repeat) return;
    const s = world.state();
    if (e.code === 'Enter' && s !== 'playing' && s !== 'paused') go();
    else if ((e.code === 'Escape' || e.code === 'KeyP') && !world.held()) { if (s === 'playing') world.pause(); else if (s === 'paused') world.resume(); }
  });
  $('view').addEventListener('click', () => { if (world.state() === 'paused') world.resume(); });
  if (params.autostart) go();
  window.__ready = true;
}
main().catch((e) => { window.__fatal = String((e && e.stack) || e); console.error('[fatal] ' + window.__fatal); const d = document.createElement('div'); d.id = 'fatal'; d.textContent = 'The page could not start: ' + window.__fatal; $('app').appendChild(d); });
