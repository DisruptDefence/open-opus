// Threats as data. An archetype says what a threat is (body, senses, weapon) and how it behaves (a state table).
// The engine has a fixed vocabulary of things to do and things to notice; a new threat is a new entry here, or in
// a content pack later, not new code.
//
//   do      followRoute | gotoLastKnown | attack | gotoCover | orbitTarget | hold
//   if      seesTarget | heardNoise | damaged | arrived | noCover | healthBelow (value) | lostTargetFor (value, s)
//           | timeInState (value, s)
//   to      the next state;  `after`: the condition must have held this long;  `once`: the rule fires one time only
//   alert   on entering through this rule, tell other threats within `alertRadius` where the target is
//
// `type` is the broad class the rest of the engine knows (ground | air); `id` is the archetype.

export const ARCHETYPES = {
  // A dismounted sentry: walks a beat, goes to look at what it hears, fights from where it stands, falls back to
  // cover when hurt.
  sentry: {
    id: 'sentry', type: 'ground', label: 'Sentry',
    body: { radius: 0.38, height: 1.8, health: 90, turn: 6, speed: { patrol: 1.4, investigate: 2.8, cover: 4.4, engage: 0 } },
    senses: { sight: 70, fov: 120, hearing: 40, eye: 1.62, closeRange: 5 },
    weapon: { damage: 6, burst: 3, interval: 0.13, cooldown: 1.5, spread: 0.03, range: 80, aimTime: 0.55 },
    alertRadius: 60,
    behaviour: {
      start: 'patrol',
      states: {
        patrol: { do: 'followRoute', speed: 'patrol', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'damaged', to: 'engage', alert: true }, { if: 'heardNoise', to: 'investigate' }] },
        investigate: { do: 'gotoLastKnown', speed: 'investigate', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'arrived', after: 4, to: 'patrol' }, { if: 'timeInState', value: 25, to: 'patrol' }] },
        engage: { do: 'attack', speed: 'engage', on: [{ if: 'healthBelow', value: 0.55, once: true, to: 'takeCover' }, { if: 'lostTargetFor', value: 3.5, to: 'investigate' }] },
        takeCover: { do: 'gotoCover', speed: 'cover', on: [{ if: 'noCover', to: 'engage' }, { if: 'arrived', after: 2.5, to: 'engage' }, { if: 'timeInState', value: 9, to: 'engage' }] },
      },
    },
  },
  // A small quadcopter: flies a circuit at height, circles what it finds and reports it to everyone on the ground,
  // harasses with a light weapon, comes back to look when it loses the target.
  quadcopter: {
    id: 'quadcopter', type: 'air', label: 'Quadcopter',
    body: { radius: 0.55, height: 0.4, health: 35, turn: 3, altitude: 24, speed: { patrol: 7, orbit: 9, investigate: 11 } },
    senses: { sight: 110, fov: 200, hearing: 0, eye: 0, closeRange: 0 },
    weapon: { damage: 3, burst: 2, interval: 0.2, cooldown: 3.2, spread: 0.05, range: 70, aimTime: 0.8 },
    alertRadius: 150, orbitRadius: 26, orbitAltitude: 17, reportEvery: 2.5,
    behaviour: {
      start: 'patrol',
      states: {
        patrol: { do: 'followRoute', speed: 'patrol', on: [{ if: 'seesTarget', to: 'track', alert: true }, { if: 'damaged', to: 'search' }, { if: 'heardNoise', to: 'search' }] },
        track: { do: 'orbitTarget', speed: 'orbit', on: [{ if: 'lostTargetFor', value: 5, to: 'search' }] },
        search: { do: 'gotoLastKnown', speed: 'investigate', on: [{ if: 'seesTarget', to: 'track', alert: true }, { if: 'arrived', after: 6, to: 'patrol' }, { if: 'timeInState', value: 30, to: 'patrol' }] },
      },
    },
  },
};
