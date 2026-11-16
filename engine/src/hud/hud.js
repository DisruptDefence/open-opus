// The HUD: a complete, plain heads-up display for any scene and mission. It is fed only by what the engine already
// says (events, the player, the weapon, the director's marks) and by the content pack (`G.content.hud`: which
// elements are on and their words). It owns no word of any place or mission: texts come from scenario commands
// (`objective`, `say`, a mark's `label` and `use.prompt`) or from the pack. The arithmetic is in model.js.
// A product may replace it (modules: { hud }) with anything of the shape of hooks.js.
import { Vector3 } from '../../vendor/three.module.js';
import { createNullHud } from './hooks.js';
import { HUD_CSS } from './style.js';
import {
  TAPE_PX_PER_DEG, TAPE_FROM, TAPE_TO, tapeOffset, headingOf, markerBearing, markerDistance, edgeClamp, crosshairGap, damageArcAngle,
  ammoCue, healthSegments, CRIT_SEGMENTS, typedChars, hitmarkerLook, addArc, arcAlpha, pushFeed, FEED_SECONDS, COMPASS, compassLetter,
} from './model.js';

const DEFAULT_WORDS = { objective: 'Objective', health: 'Health', lowAmmo: 'Low ammo', reload: 'R — Reload', reloading: 'Reloading', empty: 'Empty', hold: 'Hold', destroyed: 'destroyed', weak: 'Weak point', key: 'E' };
const OBJECTIVE_CPS = 46, RADIO_CPS = 58, CIRCUMFERENCE = 2 * Math.PI * 19;
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export function createHud(G) {
  const hud = createNullHud(), pack = (G.content && G.content.hud) || {};
  const on = new Set(pack.elements || []), words = { ...DEFAULT_WORDS, ...(pack.words || {}) }, markColors = (G.content && G.content.marks) || {};
  const letters = typeof words.compass === 'string' && words.compass.split(' ').length === 8 ? words.compass.split(' ') : COMPASS;
  if (!document.getElementById('opus-hud-style')) { const s = h('style'); s.id = 'opus-hud-style'; s.textContent = HUD_CSS; document.head.appendChild(s); }
  const root = h('div', 'oh'); root.hidden = true;
  (document.getElementById('ui') || document.body).appendChild(root);
  const part = {}; // name -> its nodes, only for the elements the pack turns on

  // ---- build ----------------------------------------------------------------------------------------------------
  if (on.has('compass')) {
    const box = h('div', 'oh-compass'), hdg = h('div', 'hdg', '000'), win = h('div', 'win'), strip = h('div', 'strip'), tags = h('div', 'tags');
    strip.style.width = (TAPE_TO - TAPE_FROM) * TAPE_PX_PER_DEG + 'px';
    for (let d = TAPE_FROM; d <= TAPE_TO; d += 5) {
      const deg = ((d % 360) + 360) % 360, x = (d - TAPE_FROM) * TAPE_PX_PER_DEG, m = d % 15 === 0;
      const tk = h('i', 'tk' + (m ? ' m' : '')); tk.style.left = x + 'px'; strip.appendChild(tk);
      if (m) { const letter = compassLetter(deg, letters), n = h('span', 'tn' + (letter ? ' l' : ''), letter || String(deg)); n.style.left = x + 'px'; strip.appendChild(n); }
    }
    win.append(strip, h('div', 'caret'), tags); box.append(hdg, win); root.appendChild(box);
    Object.assign(part, { compass: { hdg, win, strip, tags, tagFor: new Map(), width: 0 } });
  }
  if (on.has('markers')) { part.worldTags = h('div'); root.appendChild(part.worldTags); part.worldMap = new Map(); }
  if (on.has('objective')) {
    const box = h('div', 'oh-obj pan'), k = h('div', 'k'), t = h('div', 't'), pips = h('div', 'pips');
    k.textContent = words.objective; box.append(k, t, pips); box.hidden = true; root.appendChild(box);
    part.obj = { box, t, pips, full: '', age: 0, shown: -1, done: 0, total: 0, pipKey: '' };
  }
  if (on.has('feed')) { part.feed = h('div', 'oh-feed'); root.appendChild(part.feed); part.feedLines = []; }
  if (on.has('warn')) { part.warn = h('div', 'oh-warn'); root.appendChild(part.warn); part.warnLeft = 0; }
  if (on.has('message')) { part.msg = h('div', 'oh-msg pan'); root.appendChild(part.msg); part.msgLeft = 0; }
  if (on.has('prompt')) {
    const box = h('div', 'oh-prompt pan'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 44 44'); svg.innerHTML = '<circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19"/>';
    const text = h('span'); box.append(svg, text); box.hidden = true; root.appendChild(box);
    part.prompt = { box, text, fg: svg.querySelector('.fg'), label: '', ring: -1 };
  }
  if (on.has('radio')) { part.radio = h('div', 'oh-radio pan'); part.radio.hidden = true; root.appendChild(part.radio); part.radioQ = []; part.radioNow = null; }
  if (on.has('health')) {
    const box = h('div', 'oh-health'), k = h('div', 'k'), row = h('div'), n = h('span', 'n'), segs = h('div', 'segs');
    k.textContent = words.health; for (let i = 0; i < 10; i++) segs.appendChild(h('i')); row.append(n); box.append(k, row, segs);
    root.appendChild(box); part.health = { box, n, segs: [...segs.children], seg: -1, num: -1 };
  }
  if (on.has('ammo')) {
    const box = h('div', 'oh-ammo'), name = h('div', 'k'), row = h('div'), n = h('span', 'n'), r = h('span', 'r'), pips = h('div', 'pips'), cue = h('div', 'cue');
    row.append(n, r); box.append(name, row, pips, cue); root.appendChild(box); part.ammo = { box, name, n, r, pips, cue, key: '', pipKey: '' };
  }
  if (on.has('crosshair')) {
    const x = h('div', 'oh-x'); const bars = ['h', 'h', 'v', 'v'].map((c) => h('i', c)); const dot = h('i', 'd'); x.append(...bars, dot); root.appendChild(x); part.cross = { x, bars, gap: -1 };
  }
  if (on.has('hitmarker')) { const hm = h('div', 'oh-hit', '<i></i><i></i><i></i><i></i>'); root.appendChild(hm); part.hit = { node: hm, e: null, age: 0 }; }
  if (on.has('damage')) { const a = h('div', 'oh-arcs'); const nodes = [0, 1, 2, 3].map(() => h('i')); a.append(...nodes); root.appendChild(a); part.arcs = { nodes, list: [] }; }

  // ---- state -----------------------------------------------------------------------------------------------------
  let now = 0; // seconds of play the HUD has seen: it stands still while the game does
  const v3 = new Vector3(), set = (el, k, v) => { if (el[k] !== v) el[k] = v; };

  function typed(node, full, age, cps) { const n = typedChars(age, cps, full.length); node.textContent = full.slice(0, n); return n >= full.length; }
  function showPrompt(prompt, progress) {
    const p = part.prompt; if (!p) return;
    if (!prompt) { p.box.hidden = true; p.label = ''; return; }
    const label = `${words.hold} ${words.key} — ${prompt}`; if (label !== p.label) { p.text.textContent = label; p.label = label; }
    const q = Math.round(Math.max(0, Math.min(1, progress || 0)) * 200) / 200; if (q !== p.ring) { p.fg.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - q)); p.ring = q; }
    p.box.hidden = false;
  }
  function feedLine(text, enemy) {
    if (!part.feed) return;
    pushFeed(part.feedLines, { text, enemy, left: FEED_SECONDS, weak: false }); drawFeed();
  }
  function drawFeed() { part.feed.innerHTML = ''; for (const l of part.feedLines) { const d = h('div'); d.textContent = l.text; if (l.weak) d.appendChild(h('b', '', ' · ' + words.weak)); part.feed.appendChild(d); } }
  function hitmarker(kind) { if (part.hit) { part.hit.e = { killed: kind === 'kill', weak: kind === 'weak' }; part.hit.age = 0; part.hit.node.className = 'oh-hit ' + hitmarkerLook(part.hit.e).kind; } }
  function resetAll() {
    if (part.obj) { part.obj.full = ''; part.obj.box.hidden = true; part.obj.done = part.obj.total = 0; part.obj.pipKey = ''; }
    if (part.feed) { part.feedLines.length = 0; part.feed.innerHTML = ''; }
    if (part.warn) { part.warn.textContent = ''; part.warnLeft = 0; }
    if (part.msg) { part.msg.textContent = ''; part.msgLeft = 0; }
    if (part.radio) { part.radioQ.length = 0; part.radioNow = null; part.radio.hidden = true; }
    if (part.arcs) { part.arcs.list.length = 0; for (const n of part.arcs.nodes) n.style.opacity = '0'; }
    if (part.hit) { part.hit.e = null; part.hit.node.style.opacity = '0'; }
    showPrompt('');
    now = 0;
  }

  Object.assign(hud, {
    root,
    show(visible) { root.hidden = !visible; },
    setObjective(text) { const o = part.obj; if (!o) return; text = String(text || ''); if (text === o.full) return; o.full = text; o.age = 0; o.shown = -1; o.box.hidden = !text; },
    setProgress(done, total) { const o = part.obj; if (o) { o.done = done | 0; o.total = total | 0; } },
    setPrompt: showPrompt,
    message(text, seconds = 4) { if (part.msg) { part.msg.textContent = String(text || ''); part.msgLeft = seconds; } },
    warn(text, seconds = 4) { if (part.warn) { part.warn.textContent = String(text || ''); part.warnLeft = seconds; } },
    radio(text, seconds = 4, who = '') { if (part.radio && text) part.radioQ.push({ text: String(text), seconds, who: who ? String(who) : '' }); },
    clearRadio() { if (part.radio) { part.radioQ.length = 0; part.radioNow = null; part.radio.hidden = true; } },
    feed: feedLine,
    hitmarker,
    reset: resetAll,
    update(dt = 0) {
      if (root.hidden) return;
      const p = G.player, w = G.weapon || {}, cam = G.camera, W = root.clientWidth || 1, H = root.clientHeight || 1;
      now += dt;
      // compass tape and the marks' tags on it
      const heading = headingOf(p.yaw);
      if (part.compass) {
        const c = part.compass; if (!c.width) c.width = c.win.clientWidth;
        c.hdg.textContent = String(Math.round(G.georef.headingGrid(p.yaw)) % 360).padStart(3, '0');
        c.strip.style.transform = `translateX(${tapeOffset(heading, c.width)}px)`;
      }
      // marks: a tag on the tape and one in the world
      if (part.compass || part.worldTags) {
        if (cam) cam.updateMatrixWorld();
        const marks = G.director ? G.director.marks : new Map(), present = new Set();
        const ads = p.ads >= 0.5;
        for (const [id, m] of marks) {
          if (m.used) continue;
          const text = (m.label || m.kind).slice(0, 2).toUpperCase(), dist = markerDistance({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, m), color = (markColors[m.kind] && markColors[m.kind].color) || '#ffb020';
          if (part.compass) {
            const c = part.compass; let t = c.tagFor.get(id);
            if (!t) { t = h('span', 'tag ' + m.kind); c.tags.appendChild(t); c.tagFor.set(id, t); }
            const label = `${text} ${dist}`; if (t.textContent !== label) t.textContent = label; if (t.style.background !== color) t.style.background = color;
            const half = t.offsetWidth / 2 + 3, px = Math.max(half, Math.min(c.width - half, c.width / 2 + markerBearing(p, m) * TAPE_PX_PER_DEG));
            t.style.left = px + 'px';
          }
          if (part.worldTags && cam) {
            let t = part.worldMap.get(id);
            if (!t) { t = h('div', 'oh-tag', '<i></i><b></b><span></span>'); part.worldTags.appendChild(t); part.worldMap.set(id, t); }
            t.style.setProperty('--c', color);
            t.children[1].textContent = text; t.children[2].textContent = ' ' + dist + ' m';
            v3.set(m.x, m.y + (m.kind === 'extraction' ? 1.2 : 1.9), m.z).applyMatrix4(cam.matrixWorldInverse);
            const behind = v3.z > 0; v3.applyMatrix4(cam.projectionMatrix);
            const e = edgeClamp(v3.x, v3.y, behind);
            let tx = (e.x * 0.5 + 0.5) * W, ty = (0.5 - e.y * 0.5) * H;
            if (!e.offscreen && Math.abs(tx - W / 2) < 70 && Math.abs(ty - H / 2) < 60) ty = H / 2 - 60; // a tag on the crosshair goes just above it
            t.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) translate(-50%, -50%)`;
            t.classList.toggle('edge', e.offscreen); t.style.display = ads ? 'none' : '';
          }
          present.add(id);
        }
        for (const map of [part.compass && part.compass.tagFor, part.worldMap]) {
          if (map) for (const [id, node] of map) if (!present.has(id)) { node.remove(); map.delete(id); }
        }
      }
      // objective, typed
      if (part.obj && part.obj.full) {
        const o = part.obj; o.age += dt;
        const n = typedChars(o.age, OBJECTIVE_CPS, o.full.length); if (n !== o.shown) { o.shown = n; o.t.textContent = o.full.slice(0, n); }
        const key = o.total > 0 ? o.done + '/' + o.total : '';
        if (key !== o.pipKey) { o.pipKey = key; o.pips.innerHTML = ''; for (let i = 0; i < o.total; i++) o.pips.appendChild(h('i', i < o.done ? 'on' : '')); }
      }
      // health
      if (part.health) {
        const hh = part.health, max = p.maxHealth || 100, seg = healthSegments(p.health, max), num = Math.ceil(Math.max(0, p.health));
        if (seg !== hh.seg) { hh.seg = seg; hh.segs.forEach((s, i) => s.classList.toggle('on', i < seg)); hh.box.classList.toggle('crit', seg > 0 && seg <= CRIT_SEGMENTS); }
        if (num !== hh.num) { hh.num = num; hh.n.textContent = String(num); }
        hh.box.classList.toggle('full', p.health >= max); hh.box.classList.toggle('hurt', p.health < max);
      }
      // ammunition
      if (part.ammo) {
        const a = part.ammo, ammo = w.ammo, mag = w.magSize, reserve = w.reserve, cue = ammoCue(ammo, mag, reserve, w.state);
        const key = [ammo, reserve, w.name, mag, cue].join('|');
        if (key !== a.key) {
          a.key = key;
          a.name.textContent = w.name || ''; a.n.textContent = Number.isFinite(ammo) ? String(ammo).padStart(2, '0') : '--'; a.r.textContent = Number.isFinite(reserve) ? '/ ' + String(reserve).padStart(3, '0') : '';
          a.cue.textContent = cue ? words[cue] || '' : ''; a.cue.className = 'cue' + (cue === 'empty' ? ' empty' : '');
          a.box.classList.toggle('low', cue === 'lowAmmo' || cue === 'reload' || cue === 'empty');
          const n = Number.isFinite(mag) ? Math.min(60, mag) : 0;
          if (a.pips.children.length !== n) { a.pips.innerHTML = ''; for (let i = 0; i < n; i++) a.pips.appendChild(h('i')); }
          [...a.pips.children].forEach((pip, i) => pip.classList.toggle('on', i < ammo));
        }
      }
      // crosshair
      if (part.cross) {
        const x = part.cross, hide = p.ads > 0.6 || !p.alive; x.x.style.display = hide ? 'none' : '';
        if (!hide) {
          const gap = crosshairGap(w.spread || 0, cam ? cam.fov : 74, H, !!p.sprinting);
          if (gap !== x.gap) { x.gap = gap; const g = gap + 'px'; x.bars[0].style.right = g; x.bars[1].style.left = g; x.bars[2].style.bottom = g; x.bars[3].style.top = g; }
        }
      }
      // hit marker
      if (part.hit && part.hit.e) {
        const m = part.hit; m.age += dt; const look = hitmarkerLook(m.e, m.age);
        if (m.age >= look.life) { m.e = null; m.node.style.opacity = '0'; } else { m.node.style.opacity = String(look.alpha); m.node.style.transform = `scale(${look.scale})`; }
      }
      // damage arcs
      if (part.arcs) part.arcs.nodes.forEach((n, i) => { const arc = part.arcs.list[i]; if (!arc) return; const a = arcAlpha(arc, now); n.style.opacity = a.toFixed(2); if (!arc.set) { arc.set = true; n.style.transform = `rotate(${((arc.angle * 180) / Math.PI).toFixed(1)}deg)`; } });
      // kill feed
      if (part.feed && part.feedLines.length) { let drop = false; for (const l of part.feedLines) { l.left -= dt; if (l.left <= 0) drop = true; } if (drop) { part.feedLines = part.feedLines.filter((l) => l.left > 0); drawFeed(); } }
      // warn and message
      if (part.warn && part.warnLeft > 0 && (part.warnLeft -= dt) <= 0) part.warn.textContent = '';
      if (part.msg && part.msgLeft > 0 && (part.msgLeft -= dt) <= 0) part.msg.textContent = '';
      // radio: a queue, each line typed and then held
      if (part.radio) {
        let r = part.radioNow;
        if (!r && part.radioQ.length) { r = part.radioNow = { ...part.radioQ.shift(), age: 0, hold: -1 }; part.radio.innerHTML = ''; part.radio.append(h('span', 'who'), h('span', 'tx')); part.radio.firstChild.textContent = r.who; part.radio.hidden = false; }
        if (r) {
          r.age += dt;
          const done = typed(part.radio.lastChild, r.text, r.age, RADIO_CPS);
          if (done) { if (r.hold < 0) r.hold = r.seconds; else if ((r.hold -= dt) <= 0) { part.radioNow = null; if (!part.radioQ.length) part.radio.hidden = true; } }
        }
      }
    },
  });

  // ---- events ----------------------------------------------------------------------------------------------------
  G.events.on('director:prompt', (e) => showPrompt(e && e.id ? e.prompt : '', e && e.progress));
  G.events.on('player:hitEnemy', (e) => hitmarker(e.killed ? 'kill' : e.weak ? 'weak' : 'hit'));
  G.events.on('player:hitEnemy', (e) => { // the kill's line is made first (enemy:killed): a weak-point kill adds its word to it
    if (!part.feed || !e.killed || !e.weak) return;
    const l = part.feedLines.find((x) => x.enemy === e.enemy); if (l) { l.weak = true; drawFeed(); }
  });
  G.events.on('enemy:killed', (e) => {
    const def = e.enemy && e.enemy.def, label = (def && def.label) || (e.enemy && e.enemy.archetype) || e.type || '';
    feedLine(`${String(label).toUpperCase()} ${words.destroyed}`, e.enemy);
  });
  G.events.on('player:hit', (e) => { if (part.arcs && e && e.fromPos && Number.isFinite(e.fromPos.x)) { const arc = addArc(part.arcs.list, damageArcAngle(G.player, e.fromPos), now); arc.set = false; } });
  G.events.on('game:state', (e) => { if (e.state === 'playing' && e.from !== 'paused') resetAll(); });
  return hud;
}
