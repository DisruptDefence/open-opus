// The director: applies scenario commands. A mission does not live in the client; the session host decides what
// happens and sends commands when it happens, and this module makes them true in the world:
//
//   { op: 'place',   x, z, y?, heading?, now? }                 where the player starts (now: move them at once)
//   { op: 'spawn',   id, kind, x, z, y?, heading?, route? }     kind: an archetype id, or its class (ground | air);
//                                                               route: [[x, z], ...] walked or flown in a loop
//                    or  { ..., at: [[x, z], ...], hidden?, minDistance?, alerted? }   the engine picks the best place
//                        (not in the player's view, not close, not just used); the one command that may choose differently
//                        when applied again
//   { op: 'despawn', id }
//   { op: 'mark',    id, kind, x, z, y?, radius?, label?, type?, use? }   kind: objective | extraction;
//                                                               use: { seconds?, prompt }: held with the `interact` key
//   { op: 'unmark',  id }
//   { op: 'clear' }                                             removes every threat and every mark
//   { op: 'say',     text, seconds?, channel?, who? }          channel: message (default) | radio | warn
//   { op: 'objective', text, done?, total? }                    the objective line and its progress (a value, not a change)
//   { op: 'end',     result }                                   result: complete | dead
//   { op: 'time',    hour }       { op: 'weather', wet }
//
// Positions are game metres; `heading` is degrees clockwise from grid north.
// A command says what stands, not what changes: applying one twice leaves the world as applying it once does. A
// `spawn` or `mark` whose id is already in the world replaces it; `despawn`, `unmark` and `clear` of what is not
// there do nothing. So a host can send everything that stands again when a player deploys again or comes back.
// A command that cannot be applied throws a ScenarioCommandError and changes nothing.
// The director also watches the marks and reports when the player reaches one. What reaching one is worth is the
// host's business: the engine reports the fact and scores nothing.
import { Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry } from '../../vendor/three.module.js';
import { ScenarioCommandError } from './command-error.js';

const yawOf = (headingDeg) => (-(+headingDeg || 0) * Math.PI) / 180;
const fail = (c, why, code = 'invalid') => { throw new ScenarioCommandError(code, c.op, why); };
const num = (c, k) => { if (c[k] !== undefined && !Number.isFinite(c[k])) fail(c, `\`${k}\` must be a number`); };
const needXZ = (c) => { if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) fail(c, 'x and z (game metres) are required'); num(c, 'y'); num(c, 'heading'); };
const needUse = (c) => {
  const u = c.use;
  if (u === undefined) return;
  if (!u || typeof u !== 'object' || Array.isArray(u)) fail(c, '`use` must be { seconds?, prompt }');
  if (typeof u.prompt !== 'string' || !u.prompt) fail(c, '`use.prompt` must be a non-empty string');
  if (u.seconds !== undefined && !(Number.isFinite(u.seconds) && u.seconds > 0)) fail(c, '`use.seconds` must be a positive number');
};
const needId = (c) => { if (typeof c.id !== 'string' || !c.id) fail(c, 'an id (a string) is required'); };

// A mark that is used with a key (docs/WORLD-API.md): numbers of the stand-in game's objective hold.
const USE = { seconds: 2.4, drain: 1.6, reach: 2.5, near: 0.9, facing: 0.45 };

export function createDirector(G, { setTimeOfDay = () => {}, setWet = () => {} } = {}) {
  const marks = new Map();
  let objective = null, prompting = null; // the held objective line; the id of the mark the prompt is shown for
  const places = new Map(); // a place given to `spawn.at` -> when it was last used (play seconds)
  const groundY = (c) => (Number.isFinite(c.y) ? c.y : G.physics.groundHeight(c.x, c.z));
  function mark(c) {
    needId(c); needXZ(c);
    if (c.kind !== 'objective' && c.kind !== 'extraction') fail(c, `kind must be objective or extraction, not "${c.kind}"`);
    if (c.radius !== undefined && !(c.radius > 0)) fail(c, 'radius must be a positive number of metres');
    needUse(c);
    if (G.threats.list.some((t) => t.id === c.id)) fail(c, `"${c.id}" is a threat`);
    unmark(c); // the same id again replaces
    const y = groundY(c), g = new Group(), col = c.kind === 'extraction' ? 0x30ff90 : 0xffb020, radius = c.radius > 0 ? +c.radius : c.use ? 2.2 : 3;
    const beam = new Mesh(new CylinderGeometry(0.12, 0.12, 30, 8), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(3), transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 15;
    const ring = new Mesh(new TorusGeometry(radius, 0.06, 6, 40), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(4) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15;
    g.add(beam, ring); g.position.set(c.x, y, c.z); g.name = 'mark'; G.scene.add(g);
    const k = { id: c.id, kind: c.kind, type: String(c.type || c.kind), label: String(c.label || ''), x: c.x, y, z: c.z, radius, reached: false, used: false, progress: 0, use: c.use ? { prompt: c.use.prompt, seconds: c.use.seconds > 0 ? +c.use.seconds : USE.seconds } : null, node: g, beam };
    marks.set(c.id, k);
    G.events.emit('director:mark', { mark: k });
  }
  function unmark(c) {
    const k = marks.get(c.id); if (!k) return;
    k.node.removeFromParent(); k.node.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    marks.delete(c.id);
    G.events.emit('director:unmark', { mark: k });
  }
  function needAt(c) {
    if (!Array.isArray(c.at) || c.at.length < 1 || c.at.length > 64 || !c.at.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) fail(c, '`at` must be 1 to 64 places [[x, z], ...]');
    num(c, 'y'); num(c, 'heading');
  }
  /** The best of `c.at`: far enough, out of the player's sight when `hidden`, not one used a moment ago, with a little chance. */
  function choosePlace(c) {
    const p = G.player.pos, eye = { x: p.x, y: p.y + 1.6, z: p.z }, min = c.minDistance ?? 18, now = G.time.t;
    const A = G.threats.archetypes, def = Object.hasOwn(A, c.kind) ? A[c.kind] : Object.values(A).find((x) => x.type === c.kind), air = def && def.type === 'air', up = air ? (def.body.altitude || 20) : 1;
    let best = null;
    for (const [x, z] of c.at) {
      const d = Math.hypot(x - p.x, z - p.z), gy = G.physics.groundHeight(x, z);
      let score = 1.5 * G.rng();
      score += d >= min ? 2 + 0.5 * Math.min(1, (d - min) / 30) : -(min - d) / 4;
      if (c.hidden && !G.physics.lineOfSight({ x, y: gy + up, z }, eye)) score += 2.5;
      const used = places.get(x + ',' + z);
      if (used !== undefined && now - used < 6) score -= 3;
      if (!best || score > best.score) best = { x, z, score };
    }
    places.set(best.x + ',' + best.z, now);
    return best;
  }
  function interactEvent(k, action) { G.events.emit('director:interact', { id: k.id, kind: k.kind, action, time: G.time.t, progress: k.progress }); }
  /** The held-key marks: choose the one the player is using, raise or drain progress, report it. */
  function updateUse(dt) {
    const p = G.player.pos, fx = -Math.sin(G.player.yaw), fz = -Math.cos(G.player.yaw);
    let cand = null, cd = Infinity;
    for (const k of marks.values()) {
      if (!k.use || k.used) continue;
      const dx = k.x - p.x, dz = k.z - p.z, d = Math.hypot(dx, dz);
      if (d > k.radius || Math.abs(p.y - k.y) > USE.reach) continue;
      if (d > USE.near && (dx * fx + dz * fz) / d < USE.facing) continue;
      if (d < cd) { cd = d; cand = k; }
    }
    const holding = !!cand && !!G.input.down('interact');
    for (const k of marks.values()) {
      if (!k.use || k.used) continue;
      const before = k.progress;
      if (k === cand && holding) {
        k.progress = Math.min(1, k.progress + dt / k.use.seconds);
        if (before === 0 && k.progress > 0) interactEvent(k, 'begin');
      } else if (before > 0) k.progress = Math.max(0, before - USE.drain * dt);
      if (k.progress !== before) G.events.emit('objective:progress', { id: k.id, t: k.progress });
      if (k.progress >= 1) {
        k.used = true; k.beam.visible = false;
        interactEvent(k, 'used'); G.events.emit('objective:done', { id: k.id });
      } else if (before > 0 && k.progress === 0) interactEvent(k, 'cancel');
    }
    if (cand) { prompting = cand.id; G.events.emit('director:prompt', { id: cand.id, prompt: cand.use.prompt, progress: cand.progress }); }
    else if (prompting) { prompting = null; G.events.emit('director:prompt', { id: null }); }
  }
  const COMMANDS = {
    place(c) {
      needXZ(c);
      G.level.playerStart.pos.set(c.x, groundY(c), c.z); G.level.playerStart.yaw = yawOf(c.heading);
      if (G.game.state === 'title' || c.now) { const on = G.game.state === 'playing'; G.player.reset(G.level.playerStart); G.player.enabled = on; }
    },
    spawn(c) {
      needId(c);
      if (c.at !== undefined) needAt(c); else needXZ(c);
      for (const k of ['hidden', 'alerted']) if (c[k] !== undefined && typeof c[k] !== 'boolean') fail(c, `\`${k}\` must be true or false`);
      if (c.minDistance !== undefined && !(Number.isFinite(c.minDistance) && c.minDistance >= 0)) fail(c, '`minDistance` must be a number of metres, 0 or more');
      if (!G.threats.knows(c.kind)) fail(c, `no threat archetype "${c.kind}"`, 'unknown-kind');
      if (c.route !== undefined && !(Array.isArray(c.route) && c.route.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))) fail(c, 'route must be [[x, z], ...]');
      if (marks.has(c.id)) fail(c, `"${c.id}" is a mark`);
      G.threats.despawn(c.id); // the same id again: the command says what stands, so it replaces
      const where = c.at ? choosePlace(c) : c;
      G.threats.spawn(c.kind, { x: where.x, y: groundY(where), z: where.z }, { id: c.id, yaw: yawOf(c.heading), route: c.route, alerted: !!c.alerted });
    },
    despawn(c) { G.threats.despawn(c.id); },
    clear() {
      G.threats.clear(); for (const k of [...marks.values()]) unmark(k);
      if (objective) { objective = null; G.hud.setObjective(''); if (G.hud.setProgress) G.hud.setProgress(0, 0); }
    },
    say(c) {
      const channel = c.channel === undefined ? 'message' : c.channel, text = String(c.text || ''), seconds = c.seconds > 0 ? +c.seconds : 4;
      if (channel !== 'message' && channel !== 'radio' && channel !== 'warn') fail(c, `channel must be message, radio or warn, not "${channel}"`);
      if (c.who !== undefined && typeof c.who !== 'string') fail(c, '`who` must be a string');
      if (channel === 'radio') G.hud.radio(text, seconds, c.who); else if (channel === 'warn') G.hud.warn(text, seconds); else G.hud.message(text, seconds);
      G.events.emit('director:say', { text, channel });
    },
    objective(c) {
      if (typeof c.text !== 'string') fail(c, '`text` (a string) is required');
      for (const k of ['done', 'total']) if (c[k] !== undefined && !(Number.isInteger(c[k]) && c[k] >= 0)) fail(c, `\`${k}\` must be an integer of 0 or more`);
      objective = { text: c.text, done: c.done ?? 0, total: c.total ?? 0 };
      G.hud.setObjective(objective.text); if (G.hud.setProgress) G.hud.setProgress(objective.done, objective.total);
    },
    mark, unmark,
    end(c) {
      const result = c.result || 'complete';
      if (result !== 'complete' && result !== 'dead') fail(c, `result must be complete or dead, not "${result}"`);
      G.game.end(result);
    },
    time(c) { if (!(c.hour >= 0 && c.hour <= 24)) fail(c, 'hour must be 0 to 24'); setTimeOfDay(+c.hour); },
    weather(c) { setWet(Math.max(0, Math.min(1, +c.wet || 0))); },
  };
  return {
    marks, commands: Object.keys(COMMANDS),
    apply(cmd) {
      if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) throw new ScenarioCommandError('invalid', undefined, 'a command is an object with `op`');
      const fn = Object.hasOwn(COMMANDS, cmd.op) ? COMMANDS[cmd.op] : null;
      if (!fn) throw new ScenarioCommandError('unknown-op', cmd.op, 'no such command');
      fn(cmd);
    },
    update(dt = 0) {
      if (G.game.state !== 'playing') { if (prompting) { prompting = null; G.events.emit('director:prompt', { id: null }); } return; }
      const p = G.player.pos;
      if (dt > 0) updateUse(dt);
      for (const k of marks.values()) {
        if (k.use) continue; // used with a key, never "reached"
        const inside = Math.hypot(p.x - k.x, p.z - k.z) <= k.radius && Math.abs(p.y - k.y) < 4;
        if (inside && !k.reached) { k.reached = true; G.events.emit('director:reached', { id: k.id, kind: k.kind, time: G.time.t }); }
        else if (!inside && k.reached && k.kind === 'extraction') k.reached = false;
      }
    },
  };
}
