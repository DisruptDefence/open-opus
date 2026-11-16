// The player's page (play.html at the repository root): choose a mission, deploy, play it to the end. No switches.
// Like every host it imports the engine's public entry and then uses the world API and nothing else. The missions
// come from host/scenarios/ and are run by host/mission.js, the throwaway stand-in for a session host.
//
// For checks it also takes ?mission=<id> (skip the menu), ?q=<quality> and ?noaudio=1, and publishes
// window.__OPUS_WORLD, window.__mission, window.__errors, window.__fatal.
import { openWorld, packageSource, jsonSource, createHud, createBoot, DEFAULT_PACK } from '../index.js';
import { runMission } from './mission.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
const here = (path) => new URL(path, import.meta.url).href;
const panel = document.getElementById('panel'), card = document.getElementById('card');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const show = (html) => { card.innerHTML = '<h1>Open OPUS <small>tactical training through play</small></h1>' + html; panel.hidden = false; };
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String((e.reason && e.reason.message) || e.reason)));

const CONTROLS = `<table>
  <tr><td>W A S D</td><td>move</td><td>Mouse</td><td>look (arrow keys also turn)</td></tr>
  <tr><td>Shift</td><td>sprint</td><td>Left button</td><td>fire</td></tr>
  <tr><td>Space</td><td>jump; hold forward at a low wall to climb it</td><td>Right button</td><td>aim</td></tr>
  <tr><td>C</td><td>crouch</td><td>R</td><td>reload</td></tr>
  <tr><td>Esc</td><td>pause, and free the mouse</td><td></td><td></td></tr></table>`;

async function openScene(spec, boot) {
  if (spec === 'test') { boot.skip('download'); return packageSource(here('../scenes/test/')); }
  const url = here('../' + spec); // scenario files name their scene relative to the engine folder
  if (url.endsWith('.json')) return jsonSource(await boot.fetchJson(url)); // bytes shown as the download phase
  boot.skip('download'); return packageSource(url.endsWith('/') ? url : url + '/');
}

async function menu() {
  const list = await getJson(here('./scenarios/index.json'));
  const missions = await Promise.all(list.map(async (m) => ({ ...m, scenario: await getJson(here(`./scenarios/${m.id}.json`)) })));
  if (params.mission) { const m = missions.find((x) => x.id === params.mission); if (m) return play(m).catch(fail); }
  show(`<p>Choose a mission.</p><div class="list">${missions.map((m, i) => `<button data-i="${i}"><b>${esc(m.place)}</b><span>${esc(m.scenario.name)}. ${esc(m.about)}</span></button>`).join('')}</div>
    <p class="dim">You need a keyboard and a mouse, and a browser with WebGL 2.</p>`);
  card.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => play(missions[+b.dataset.i]).catch(fail)));
  card.querySelector('button').focus();
}

async function play(m) {
  const sc = m.scenario;
  panel.hidden = true;
  const boot = createBoot({ parent: document.getElementById('app'), words: DEFAULT_PACK.loader, brand: 'Open OPUS', title: m.place, subtitle: sc.name,
    onRetry: () => { location.href = location.pathname + '?mission=' + encodeURIComponent(m.id) + (params.q ? '&q=' + encodeURIComponent(params.q) : ''); } });
  window.__boot = boot;
  const world = openWorld({ source: openScene(sc.scene, boot), modules: { hud: createHud },
    params: { x: sc.start.x, z: sc.start.z, ...(params.q ? { q: params.q } : {}), ...(params.noaudio ? { noaudio: 1 } : {}) },
    onProgress: boot.onProgress });
  window.__OPUS_WORLD = world; // the contract. Everything below uses only this.
  const mission = runMission(world, sc);
  window.__mission = mission.record;
  try { await world.ready(); } catch (e) { window.__fatal = String((e && e.stack) || e); console.error('[fatal] ' + window.__fatal); boot.fail(e); return; }
  await boot.done();

  const deploy = () => { panel.hidden = true; mission.start(); };
  const offer = (title, text, label) => {
    panel.classList.add('clear');
    show(`<p><b>${esc(title)}</b></p><p>${esc(text)}</p>${CONTROLS}<p><button class="go" id="go">${esc(label)}</button> &nbsp; <button id="other">Choose another mission</button></p>
      <p class="dim">${world.scene().credits.map(esc).join(' · ')}</p>`);
    document.getElementById('go').addEventListener('click', deploy);
    document.getElementById('other').addEventListener('click', () => { location.href = location.pathname; });
    document.getElementById('go').focus();
  };
  offer(m.place, sc.name + '.', 'Deploy');
  world.on('state', (e) => {
    if (e.state === 'complete') offer('Mission complete', `${sc.name}: done in ${Math.round(world.snapshot().time)} seconds.`, 'Play it again');
    else if (e.state === 'dead') offer('You are down', 'The mission is not complete.', 'Deploy again');
    else if (e.state === 'paused') { panel.classList.add('clear'); show(`<p><b>Paused</b></p>${CONTROLS}<p><button class="go" id="go">Resume</button></p>`); document.getElementById('go').addEventListener('click', () => world.resume()); }
    else if (e.state === 'playing') panel.hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Escape' && world.state() === 'playing') world.pause();
    else if (e.code === 'Enter' && !panel.hidden) { const go = document.getElementById('go'); if (go) go.click(); }
  });
}

const fail = (e) => { window.__fatal = String((e && e.stack) || e); console.error('[fatal] ' + window.__fatal); show(`<p class="bad"><b>The game could not start.</b></p><pre>${esc((e && e.message) || e)}</pre>`); };
menu().catch(fail);
