// Where a mission host hears the phone. A mission host is driven by events; this gives it one more, `phone`, beside
// the world's own, without the engine knowing a phone exists:
//
//   const heard = withPhoneReports(world, phone, scenario.places);   // then hand `heard` to the mission host
//   heard.on('phone', (e) => ...)   e = { action, near, affiliation?, type?, callsign?, uid?, x?, z?, lat?, lon?, mgrs? }
//
// `places` is the host's own list of places it judges reports against: [{ id, x, z, radius }] in game metres. They
// are never sent to the engine or to the screen (docs/SESSION-PROTOCOL.md section 1: a hidden place is the host's).
// A report with a position is passed on once for each place it lies within, with `near` set to that place's id,
// and once with `near: null` when it lies within none. So a rule can say: when ATAK shared a hostile marker near X.
//
// A report from a real TAK client arrives as action `cot` (what the client shared with its server, as
// Cursor-on-Target); `affiliation` is read from the CoT type (a-h-… hostile, a-f-… friendly, a-n-…, a-u-…).
const AFFILIATION = { f: 'friendly', a: 'friendly', h: 'hostile', s: 'hostile', j: 'hostile', k: 'hostile', n: 'neutral', u: 'unknown' };

/** 'hostile' | 'friendly' | 'neutral' | 'unknown' for an atom type such as a-h-G, otherwise null. */
export function affiliationOf(type) {
  const p = String(type || '').split('-');
  return p[0] === 'a' && p[1] ? AFFILIATION[p[1]] || 'unknown' : null;
}

/** Ids of the places a point lies within. */
export function placesNear(places, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return [];
  return (places || []).filter((p) => Math.hypot(p.x - x, p.z - z) <= (p.radius ?? 10)).map((p) => p.id);
}

export function withPhoneReports(world, phone, places = []) {
  const listeners = [];
  phone.on((action, data) => {
    const e = { ...data, action };
    if (data.type !== undefined) e.affiliation = affiliationOf(data.type);
    const near = placesNear(places, data.x, data.z);
    for (const id of near.length ? near : [null]) for (const fn of [...listeners]) fn({ ...e, near: id });
  });
  return { ...world, on(name, fn) {
    if (name !== 'phone') return world.on(name, fn);
    listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  } };
}
