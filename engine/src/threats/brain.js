// The part of a threat that decides: perception tests and the state table. Pure code (no three.js, no engine):
// given facts, it answers "which state, doing what". Tested under node.

const DEG = Math.PI / 180;

/**
 * Can an observer see a target? `facing` is a unit (x, z) direction; `los(a, b)` is the world's line-of-sight test.
 * Inside `closeRange` the field of view does not matter (you notice someone at your shoulder).
 */
export function canSee(observer, target, senses, los) {
  const dx = target.x - observer.x, dy = target.y - observer.y, dz = target.z - observer.z, d = Math.hypot(dx, dy, dz);
  if (d > senses.sight) return false;
  if (d > (senses.closeRange || 0) && senses.fov < 360) {
    const h = Math.hypot(dx, dz);
    if (h > 1e-3) {
      const cos = (dx * observer.fx + dz * observer.fz) / h;
      if (cos < Math.cos((senses.fov / 2) * DEG)) return false;
    }
  }
  return los(observer, target);
}

/** Does a noise of a given loudness (metres it carries) at `at` reach a listener with this hearing range? */
export function canHear(listener, at, loudness, senses) {
  if (!senses.hearing) return false;
  return Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z) <= Math.min(loudness, senses.hearing);
}

const TESTS = {
  seesTarget: (f) => !!f.seesTarget,
  heardNoise: (f) => !!f.heardNoise,
  damaged: (f) => !!f.damaged,
  arrived: (f) => !!f.arrived,
  noCover: (f) => !!f.noCover,
  healthBelow: (f, r) => f.health < r.value,
  lostTargetFor: (f, r) => f.lostFor >= r.value,
  timeInState: (f, r, b) => b.time >= r.value,
};

export function validateBehaviour(def) {
  const b = def.behaviour, errs = [];
  if (!b || !b.states || !b.states[b.start]) errs.push(`${def.id}: start state "${b && b.start}" is not defined`);
  for (const [name, s] of Object.entries((b && b.states) || {})) for (const r of s.on || []) {
    if (!TESTS[r.if]) errs.push(`${def.id}.${name}: unknown condition "${r.if}"`);
    if (!b.states[r.to]) errs.push(`${def.id}.${name}: unknown state "${r.to}"`);
  }
  return errs;
}

/** One threat's state machine over an archetype's behaviour table. */
export function createBrain(def) {
  const table = def.behaviour, held = new Map(), fired = new Set();
  const b = {
    state: table.start, time: 0,
    get action() { return table.states[b.state].do; },
    get speed() { return table.states[b.state].speed; },
    /** Advance by dt with the current facts. Returns the rule that fired ({ from, to, alert }) or null. */
    step(facts, dt) {
      b.time += dt;
      const rules = table.states[b.state].on || [];
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i], k = b.state + ':' + i;
        if (r.once && fired.has(k)) continue;
        if (!TESTS[r.if](facts, r, b)) { held.delete(k); continue; }
        const t = (held.get(k) || 0) + dt; held.set(k, t);
        if (r.after && t < r.after) continue;
        if (r.once) fired.add(k);
        const from = b.state; b.state = r.to; b.time = 0; held.clear();
        return { from, to: r.to, alert: !!r.alert };
      }
      return null;
    },
    reset() { b.state = table.start; b.time = 0; held.clear(); fired.clear(); },
  };
  return b;
}
