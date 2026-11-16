// The director: applies scenario commands. A mission does not live in the client; the session host decides what
// happens and sends commands when it happens, and this module makes them true in the world:
//
//   { op: 'place',   x, z, y?, heading?, now? }                 where the player starts (now: move them at once)
//   { op: 'spawn',   id, kind, x, z, y?, heading?, route? }     kind: an archetype id, or its class (ground | air);
//                                                               route: [[x, z], ...] walked or flown in a loop
//   { op: 'despawn', id }
//   { op: 'mark',    id, kind, x, z, y?, radius?, label?, type? }   kind: objective | extraction
//   { op: 'unmark',  id }
//   { op: 'clear' }                                             removes every threat and every mark
//   { op: 'say',     text, seconds? }
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
const needId = (c) => { if (typeof c.id !== 'string' || !c.id) fail(c, 'an id (a string) is required'); };

export function createDirector(G, { setTimeOfDay = () => {}, setWet = () => {} } = {}) {
  const marks = new Map();
  const groundY = (c) => (Number.isFinite(c.y) ? c.y : G.physics.groundHeight(c.x, c.z));
  function mark(c) {
    needId(c); needXZ(c);
    if (c.kind !== 'objective' && c.kind !== 'extraction') fail(c, `kind must be objective or extraction, not "${c.kind}"`);
    if (c.radius !== undefined && !(c.radius > 0)) fail(c, 'radius must be a positive number of metres');
    if (G.threats.list.some((t) => t.id === c.id)) fail(c, `"${c.id}" is a threat`);
    unmark(c); // the same id again replaces
    const y = groundY(c), g = new Group(), col = c.kind === 'extraction' ? 0x30ff90 : 0xffb020, radius = c.radius > 0 ? +c.radius : 3;
    const beam = new Mesh(new CylinderGeometry(0.12, 0.12, 30, 8), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(3), transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 15;
    const ring = new Mesh(new TorusGeometry(radius, 0.06, 6, 40), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(4) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15;
    g.add(beam, ring); g.position.set(c.x, y, c.z); g.name = 'mark'; G.scene.add(g);
    const k = { id: c.id, kind: c.kind, type: String(c.type || c.kind), label: String(c.label || ''), x: c.x, y, z: c.z, radius, reached: false, node: g };
    marks.set(c.id, k);
    G.events.emit('director:mark', { mark: k });
  }
  function unmark(c) {
    const k = marks.get(c.id); if (!k) return;
    k.node.removeFromParent(); k.node.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    marks.delete(c.id);
    G.events.emit('director:unmark', { mark: k });
  }
  const COMMANDS = {
    place(c) {
      needXZ(c);
      G.level.playerStart.pos.set(c.x, groundY(c), c.z); G.level.playerStart.yaw = yawOf(c.heading);
      if (G.game.state === 'title' || c.now) { const on = G.game.state === 'playing'; G.player.reset(G.level.playerStart); G.player.enabled = on; }
    },
    spawn(c) {
      needId(c); needXZ(c);
      if (!G.threats.knows(c.kind)) fail(c, `no threat archetype "${c.kind}"`, 'unknown-kind');
      if (c.route !== undefined && !(Array.isArray(c.route) && c.route.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))) fail(c, 'route must be [[x, z], ...]');
      if (marks.has(c.id)) fail(c, `"${c.id}" is a mark`);
      G.threats.despawn(c.id); // the same id again: the command says what stands, so it replaces
      G.threats.spawn(c.kind, { x: c.x, y: groundY(c), z: c.z }, { id: c.id, yaw: yawOf(c.heading), route: c.route });
    },
    despawn(c) { G.threats.despawn(c.id); },
    clear() { G.threats.clear(); for (const k of [...marks.values()]) unmark(k); },
    say(c) { const text = String(c.text || ''); G.hud.message(text, c.seconds > 0 ? +c.seconds : 4); G.events.emit('director:say', { text }); },
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
    update() {
      if (G.game.state !== 'playing') return;
      const p = G.player.pos;
      for (const k of marks.values()) {
        const inside = Math.hypot(p.x - k.x, p.z - k.z) <= k.radius && Math.abs(p.y - k.y) < 4;
        if (inside && !k.reached) { k.reached = true; G.events.emit('director:reached', { id: k.id, kind: k.kind, time: G.time.t }); }
        else if (!inside && k.reached && k.kind === 'extraction') k.reached = false;
      }
    },
  };
}
