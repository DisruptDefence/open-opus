// A plain overlay for the engine's own host page: crosshair, health, ammunition, grid, state, one message line.
// It has no identity on purpose: a product's HUD and menus plug into the same seam (hud/hooks.js). It also shows how a HUD is fed: by the hooks the engine calls and the events it emits.
import { createNullHud } from './hooks.js';

export function createDevHud(G) {
  const hud = createNullHud(), root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;color:#e8ece6;text-shadow:0 1px 2px #000';
  root.innerHTML = '<div data-k="x" style="position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border:1px solid #fff;border-radius:50%;opacity:.8"></div>'
    + '<div data-k="tl" style="position:absolute;left:12px;top:10px;white-space:pre"></div><div data-k="bl" style="position:absolute;left:12px;bottom:10px;white-space:pre"></div>'
    + '<div data-k="br" style="position:absolute;right:12px;bottom:10px;text-align:right;white-space:pre"></div><div data-k="msg" style="position:absolute;left:0;right:0;top:18%;text-align:center;font-size:15px"></div>'
    + '<div data-k="hit" style="position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px;border:2px solid #ffd060;transform:rotate(45deg);opacity:0"></div>';
  (document.getElementById('ui') || document.body).appendChild(root);
  const el = (k) => root.querySelector(`[data-k="${k}"]`);
  let msgFor = 0, hit = 0, objective = '';
  Object.assign(hud, {
    root,
    show(on) { root.style.display = on ? '' : 'none'; },
    setObjective(t) { objective = t || ''; },
    message(t, s = 4) { el('msg').textContent = t; msgFor = s; },
    warn(t) { hud.message(t, 3); },
    hitmarker() { hit = 0.25; },
    update(dt) {
      const p = G.player, w = G.weapon, g = G.georef.toMGRS(p.pos.x, p.pos.z);
      el('tl').textContent = `${G.level.manifest.name}   ${g.zone} ${g.square} ${g.easting} ${g.northing}   hdg ${String(Math.round(G.georef.headingTrue(p.yaw))).padStart(3, '0')}°T   alt ${p.pos.y.toFixed(0)} m\n${objective}`;
      el('bl').textContent = `health ${Math.round(p.health)}`;
      el('br').textContent = `${w.name || ''}\n${w.ammo ?? '-'} / ${w.reserve ?? '-'}`;
      if (msgFor > 0 && (msgFor -= Math.max(dt, 0.016)) <= 0) el('msg').textContent = '';
      hit = Math.max(0, hit - Math.max(dt, 0.016)); el('hit').style.opacity = hit > 0 ? 1 : 0;
    },
  });
  G.events.on('player:hitEnemy', () => hud.hitmarker());
  return hud;
}
