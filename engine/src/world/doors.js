// Doors that open: the street doors the façade generator marks (gen/vestibule.js), as the player meets them.
//
//   registry   the loader hands over a chunk's doors when it goes live (`add`: scene/install.js already carved the halls out of
//              the buildings, so the hall is a real room and the shut leaf stops walkers, sight and shots, at any distance) and
//              takes them back when it is released (`drop`). A cell's near group hands over its leaf instances (`show`/`hide`).
//   memory     which doors are open lasts the session: a cell that unloads and loads again keeps its doors as they were.
//   use        the interact key (a press, not a hold) toggles the nearest door within REACH in front of the player; the HUD
//              prompt is the existing one (event `director:prompt`, `tap: true`). A door will not shut on the player.
//   events     `door:opened { id }` and `door:closed { id }` once per change (world API: docs/WORLD-API.md).
//   switch     the host switch `doors=open` opens every door as its cell loads (for pictures).
//   Threats    neither open doors nor path through them: the hall is plugged for the nav grid.
import { doorSolids, leafRing, leafMatrix, inSwing, OPEN_DEG } from '../gen/vestibule.js';

export const REACH = 1.6, CONE = Math.cos((50 * Math.PI) / 180), OPEN_S = 0.55, CLOSE_S = 0.45;
const easeOut = (x) => 1 - (1 - x) ** 3;

export function createDoors(G) {
  const live = new Map(), memory = new Map(), cells = new Map();
  const allOpen = !!(G.params && G.params.doors === 'open');
  let down = false, shownFor = null, markPrompt = false;
  const m16 = [];
  const say = (name, d, gain = 1) => { try { G.audio.play(name, { pos: { x: d.rec.hinge[0], y: d.rec.hinge[1] + 1, z: d.rec.hinge[2] }, variant: Math.floor(Math.random() * 3), gain }); } catch { /* sound is optional */ } };
  const pose = (d) => { const m = d.mesh; if (!m || !m.instanceMatrix) return; m.instanceMatrix.array.set(leafMatrix(d.rec, d.angle, m16), d.i * 16); m.instanceMatrix.needsUpdate = true; };
  /** The shut or the open leaf as a solid (the shut one was put in by scene/install.js). */
  function addLeafSolid(d) {
    if (!d.tag) return; // a building with no collision
    if (d.leaf) G.physics.remove(d.leaf);
    d.leaf = G.physics.addPrism(d.open ? leafRing(d.rec, OPEN_DEG) : doorSolids(d.rec).leaf.ring, d.rec.ys, d.rec.yh, { tag: d.tag, surface: 'wood', ref: d.ref });
  }
  /** A chunk went live: its doors (scene/install.js `env.doors`) exist from now on, open or shut as the session left them. */
  function add(handles) {
    for (const h of handles || []) {
      const mem = memory.get(h.rec.id), open = mem ? mem.open : allOpen;
      const d = { rec: h.rec, tag: h.tag, ref: h.ref, leaf: h.leaf, open, angle: open ? OPEN_DEG : 0, from: 0, to: 0, t: 1, dur: 1, mesh: null, i: 0 };
      live.set(h.rec.id, d); if (open) addLeafSolid(d);
    }
  }
  /** The chunk went away (its solids go with its tag): forget its doors; their state stays in the session's memory. */
  function drop(handles) { for (const h of handles || []) { const d = live.get(h.rec.id); if (d && d.tag === h.tag) live.delete(h.rec.id); } }
  /** A cell's near group is showing: `recs` are its door records, `mesh` the instanced leaves (instance i = recs[i]). */
  function show(key, recs, mesh) {
    hide(key); const mine = [];
    recs.forEach((rec, i) => {
      let d = live.get(rec.id);
      if (!d) { const open = (memory.get(rec.id) || { open: allOpen }).open; d = { rec, tag: null, leaf: null, open, angle: open ? OPEN_DEG : 0, from: 0, to: 0, t: 1, dur: 1, visual: true }; live.set(rec.id, d); }
      d.mesh = mesh; d.i = i; mine.push(d); pose(d);
    });
    cells.set(key, mine);
  }
  function hide(key) {
    const mine = cells.get(key); if (!mine) return;
    for (const d of mine) { d.mesh = null; if (d.visual) live.delete(d.rec.id); }
    cells.delete(key);
  }

  function set(d, open, quiet) {
    if (d.open === open) return false;
    if (!open && !quiet && G.player && inSwing(d.rec, G.player.pos.x, G.player.pos.z)) return false; // it will not shut on somebody
    d.open = open; d.from = d.angle; d.to = open ? OPEN_DEG : 0; d.t = 0; d.dur = (open ? OPEN_S : CLOSE_S) * Math.max(0.2, Math.abs(d.to - d.from) / OPEN_DEG);
    memory.set(d.rec.id, { open }); addLeafSolid(d);
    say(open ? 'door_latch' : 'door_creak', d, open ? 0.8 : 0.9); if (open) say('door_creak', d, 0.7); else d.latch = true;
    G.events.emit(open ? 'door:opened' : 'door:closed', { id: d.rec.id });
    return true;
  }

  /** The middle of the doorway in the plane of the façade (what reach and facing are measured to). */
  const centre = (rec) => [rec.origin[0] + rec.axis[0] * (rec.u0 + rec.u1) / 2, rec.origin[1] + rec.axis[2] * (rec.u0 + rec.u1) / 2];
  /** Live doors within `r` of (x, z), nearest first: plain data. */
  function near(x, z, r = REACH) {
    const out = [];
    for (const d of live.values()) { const c = centre(d.rec), dist = Math.hypot(c[0] - x, c[1] - z); if (dist <= r) out.push({ id: d.rec.id, x: c[0], y: d.rec.ys, z: c[1], open: d.open, distance: dist }); }
    return out.sort((a, b) => a.distance - b.distance).map(({ distance, ...o }) => o);
  }
  function target() {
    const p = G.player.pos, fx = -Math.sin(G.player.yaw), fz = -Math.cos(G.player.yaw); let best = null, bd = Infinity;
    for (const d of live.values()) {
      if (Math.abs(p.y - d.rec.ys) > 1.3) continue;
      const c = centre(d.rec), dx = c[0] - p.x, dz = c[1] - p.z, dist = Math.hypot(dx, dz);
      if (dist > REACH || (dist > 0.7 && (dx * fx + dz * fz) / dist < CONE)) continue;
      if (d.open && inSwing(d.rec, p.x, p.z)) continue;
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  G.events.on('director:prompt', (e) => { if (!(e && e.door)) markPrompt = !!(e && e.id); });
  return {
    add, drop, show, hide, near,
    open: (id) => { const d = live.get(id); return !!d && set(d, true); },
    close: (id) => { const d = live.get(id); return !!d && set(d, false); },
    isOpen: (id) => { const d = live.get(id); return d ? d.open : !!(memory.get(id) && memory.get(id).open); },
    count: () => live.size,
    update(dt) {
      for (const d of live.values()) {
        if (d.t >= 1) continue;
        d.t = Math.min(1, d.t + dt / d.dur); d.angle = d.from + (d.to - d.from) * easeOut(d.t); pose(d);
        if (d.t >= 1 && d.latch) { d.latch = false; say('door_latch', d, 0.8); }
      }
      if (!G.player || !G.input) return;
      const pressed = !!G.input.down('interact') && !down; down = !!G.input.down('interact');
      const t = markPrompt ? null : target(), id = t ? t.rec.id + (t.open ? '/close' : '/open') : null;
      if (id !== shownFor) {
        shownFor = id;
        const w = (G.content && G.content.hud && G.content.hud.words) || {};
        G.events.emit('director:prompt', t ? { id: t.rec.id, prompt: t.open ? w.close || 'Close' : w.open || 'Open', progress: 0, tap: true, door: true } : { id: null, door: true });
        try { G.input.setPrompt && G.input.setPrompt(!!t); } catch { /* optional */ }
      }
      if (pressed && t) set(t, !t.open);
    },
  };
}
