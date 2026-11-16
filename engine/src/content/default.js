// The default content pack (opus-content/1): what the engine ships with. A product's pack is merged over it
// (pack.js, docs/CONTENT-PACK.md). Pure data, no imports.
//
// Threats as data. An archetype says what a threat is (body, senses, weapon) and how it behaves (a state table).
// The engine has a fixed vocabulary of things to do and things to notice; a new threat is a new entry here, or in
// a content pack (docs/CONTENT-PACK.md), not new code.
//
//   do      followRoute | gotoLastKnown | attack | skirmish | gotoCover | orbitTarget | hold
//           attack: stand and shoot;  skirmish: run to a firing place `tactics.rangeMin`..`rangeMax` from the target,
//           shoot a burst or two, move again, and rush a target inside `melee.range` when the archetype has `melee`
//   if      seesTarget | heardNoise | damaged | arrived | noCover | healthBelow (value) | lostTargetFor (value, s)
//           | timeInState (value, s)
//   to      the next state;  `after`: the condition must have held this long;  `once`: the rule fires one time only
//   alert   on entering through this rule, tell other threats within `alertRadius` where the target is
//
// `type` is the broad class the rest of the engine knows (ground | air); `id` is the archetype.
//
//   body     radius, height, health, turn (rad/s), speed by name (a state names the one it moves at), figure
//            (person | quadruped | quadcopter: which of the engine's plain figures is drawn)
//   senses   sight, fov (degrees), hearing, eye (height), closeRange, notice (seconds in view before it reacts;
//            less than half of that once it is already looking for the target)
//   weapon   kind hitscan | bolt (a visible projectile of `speed` m/s that can be side-stepped, aimed with `lead`),
//            damage, burst, interval, cooldown [min, max], aimTime (the warning before a burst: a sound and a
//            glow), range, spreadFar -> spreadNear (it shoots straighter the longer the target stays exposed),
//            moving (how much the target's speed spoils the aim)
//   melee    range (starts the rush), windup, speed, time, reach, damage, cooldown, recover
//   death    explode { radius, damage }: an air threat blows up where it falls
//
// How many threats may shoot at once, and how fast aim improves, is `threatTuning` below: the numbers are the
// stand-in game's, so a fight has its rhythm.

const THREATS = {
  // A dismounted sentry: walks a beat, goes to look at what it hears, fights from a firing place it runs to and
  // changes after a burst or two, falls back to cover when hurt.
  sentry: {
    id: 'sentry', type: 'ground', label: 'Sentry',
    body: { figure: 'person', radius: 0.38, height: 1.8, health: 90, turn: 6, speed: { patrol: 1.4, investigate: 2.8, cover: 4.4, engage: 4.5 } },
    senses: { sight: 55, fov: 140, hearing: 45, eye: 1.62, closeRange: 3.5, notice: 0.55 },
    weapon: { kind: 'hitscan', damage: 5, burst: 4, interval: 0.11, cooldown: [1.8, 3], aimTime: 0.5, range: 80, spreadFar: 0.12, spreadNear: 0.045, moving: 0.3 },
    tactics: { rangeMin: 8, rangeMax: 18 },
    alertRadius: 60,
    behaviour: {
      start: 'patrol',
      states: {
        patrol: { do: 'followRoute', speed: 'patrol', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'damaged', to: 'engage', alert: true }, { if: 'heardNoise', to: 'investigate' }] },
        investigate: { do: 'gotoLastKnown', speed: 'investigate', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'arrived', after: 4, to: 'patrol' }, { if: 'timeInState', value: 25, to: 'patrol' }] },
        engage: { do: 'skirmish', speed: 'engage', on: [{ if: 'healthBelow', value: 0.4, once: true, to: 'takeCover' }, { if: 'lostTargetFor', value: 4, to: 'investigate' }] },
        takeCover: { do: 'gotoCover', speed: 'cover', on: [{ if: 'noCover', to: 'engage' }, { if: 'arrived', after: 2.5, to: 'engage' }, { if: 'timeInState', value: 9, to: 'engage' }] },
      },
    },
  },
  // A four-legged ground machine: tougher and slower to turn than a person, skirmishes the same way, and rushes
  // whoever lets it come within three metres.
  crawler: {
    id: 'crawler', type: 'ground', label: 'Crawler',
    body: { figure: 'quadruped', radius: 0.5, height: 0.95, weakTop: 0.3, health: 140, turn: 2.5, speed: { patrol: 1.5, investigate: 2, engage: 4.5 } },
    senses: { sight: 45, fov: 200, hearing: 45, eye: 0.85, closeRange: 3.5, notice: 0.55 },
    weapon: { kind: 'hitscan', damage: 5, burst: 4, interval: 0.11, cooldown: [1.8, 3], aimTime: 0.5, range: 60, spreadFar: 0.12, spreadNear: 0.045, moving: 0.3 },
    melee: { range: 3, windup: 0.28, speed: 9.5, time: 0.36, reach: 1.35, damage: 15, cooldown: 3.5, recover: 0.55 },
    tactics: { rangeMin: 8, rangeMax: 18 },
    alertRadius: 20,
    behaviour: {
      start: 'patrol',
      states: {
        patrol: { do: 'followRoute', speed: 'patrol', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'damaged', to: 'engage', alert: true }, { if: 'heardNoise', to: 'investigate' }] },
        investigate: { do: 'gotoLastKnown', speed: 'investigate', on: [{ if: 'seesTarget', to: 'engage', alert: true }, { if: 'arrived', after: 8, to: 'patrol' }, { if: 'timeInState', value: 25, to: 'patrol' }] },
        engage: { do: 'skirmish', speed: 'engage', on: [{ if: 'lostTargetFor', value: 4, to: 'investigate' }] },
      },
    },
  },
  // A small quadcopter: flies a circuit, circles what it finds a few metres up and reports it to everyone on the
  // ground, shoots slow bright bolts that a moving target can avoid, flies wild when damaged and blows up where it
  // comes down.
  quadcopter: {
    id: 'quadcopter', type: 'air', label: 'Quadcopter',
    body: { figure: 'quadcopter', radius: 0.55, height: 0.4, health: 45, turn: 3.2, altitude: 14, speed: { patrol: 3, orbit: 8, investigate: 5.5 } },
    senses: { sight: 60, fov: 200, hearing: 45, eye: 0, closeRange: 3.5, notice: 0.4 },
    weapon: { kind: 'bolt', speed: 70, lead: [0.2, 0.85], damage: 7, burst: 3, interval: 0.12, cooldown: [1.9, 3.3], aimTime: 0.55, range: 42, spreadFar: 0.065, spreadNear: 0.018, moving: 0.45 },
    death: { explode: { radius: 3, damage: 30 } },
    alertRadius: 60, orbitRadius: [12, 25], orbitAltitude: [4, 8], reportEvery: 2.5,
    behaviour: {
      start: 'patrol',
      states: {
        patrol: { do: 'followRoute', speed: 'patrol', on: [{ if: 'seesTarget', to: 'track', alert: true }, { if: 'damaged', to: 'search' }, { if: 'heardNoise', to: 'search' }] },
        track: { do: 'orbitTarget', speed: 'orbit', on: [{ if: 'lostTargetFor', value: 4, to: 'search' }] },
        search: { do: 'gotoLastKnown', speed: 'investigate', on: [{ if: 'seesTarget', to: 'track', alert: true }, { if: 'arrived', after: 8, to: 'patrol' }, { if: 'timeInState', value: 30, to: 'patrol' }] },
      },
    },
  },
};

export const DEFAULT_PACK = {
  format: 'opus-content/1',
  id: 'opus-default',
  threats: THREATS,
  threatTuning: { maxTokens: 2, maxTokensCrowd: 3, crowd: 5, tokenGap: 1.25, exposureUp: 0.1, exposureDown: 0.45, maxBolts: 32, boltLife: 1.3, maxWrecks: 5, wreckSeconds: 12, nearMetres: 26 },
  weapons: { carbine: { name: 'Carbine', magSize: 30, reserve: 150, rpm: 720, damage: 26, range: 300, weakMultiplier: 2.2, view: 'carbine' } },
  loadout: ['carbine'],
  player: {},
  sounds: { threats: { ground: { fire: 'ground_fire', step: 'ground_step', die: 'ground_die', loop: 'ground_servo', voice: 1 }, air: { fire: 'air_fire', die: 'air_die', loop: 'air_rotor', voice: 0 } } },
  hud: {
    elements: ['compass', 'markers', 'objective', 'health', 'ammo', 'crosshair', 'hitmarker', 'damage', 'feed', 'prompt', 'radio', 'warn', 'message'],
    words: { objective: 'Objective', health: 'Health', lowAmmo: 'Low ammo', reload: 'R — Reload', reloading: 'Reloading', empty: 'Empty', hold: 'Hold', destroyed: 'destroyed', weak: 'Weak point' },
  },
  marks: { objective: { color: '#ffb020' }, extraction: { color: '#30ff90' } },
};
