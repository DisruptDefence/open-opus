// Time for the simulation. One place owns the scale, so pause and slow motion are a number, not a patch.
//   scale 1 = normal, 0 = frozen (the world is drawn, nothing moves), 0.08 = slow motion
export function createClock({ maxStep = 0.05 } = {}) {
  const time = { t: 0, dt: 0, frame: 0, real: 0, scale: 1 };
  return {
    time,
    setScale(k) { time.scale = Math.max(0, Math.min(4, +k || 0)); },
    get scale() { return time.scale; },
    /** Advance by a real frame time in seconds; returns the simulation step. `fixed` replaces the measured time. */
    tick(realDt, fixed) {
      const base = fixed !== undefined ? fixed : Math.min(Math.max(0, realDt), maxStep);
      time.dt = base * time.scale; time.t += time.dt; time.frame++; time.real += realDt;
      return time.dt;
    },
  };
}
