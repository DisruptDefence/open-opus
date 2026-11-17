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
//            (person | quadruped | quadcopter | plain: which of the engine's figures is drawn, threats/figures),
//            look (a person's: colours of `cloth`, `gear`, `skin`, `boot` as lists of '#rrggbb', `headgear` a list of
//            helmet | cap | none, `pack` the chance of a pack on the back, `variants` how many looks one archetype
//            has (4); a threat's id picks its look)
//   senses   sight, fov (degrees), hearing, eye (height), closeRange, notice (seconds in view before it reacts;
//            less than half of that once it is already looking for the target)
//   weapon   kind hitscan | bolt (a visible projectile of `speed` m/s that can be side-stepped, aimed with `lead`),
//            damage, burst, interval, cooldown [min, max], aimTime (the warning before a burst: a sound and a
//            glow), range, spreadFar -> spreadNear (it shoots straighter the longer the target stays exposed),
//            moving (how much the target's speed spoils the aim)
//   melee    range (starts the rush), windup, speed, time, reach, damage, cooldown, recover
//   death    explode { radius, damage }: an air threat blows up where it falls
//   zones    damage multiplier of a round by the part of the figure it hits (a person: head, torso, arm, leg; a
//            machine: weak, body); a part not named counts 1, and `weak` 2.2 when there is no `zones`
//   reactions what a hit does to it (a person): aimSpoil (seconds: a burst being announced or fired stops and none
//            starts), limpSeconds and limpSpeed (after a leg hit, that share of its speed), stagger { damage, seconds }
//            (a round of that damage or more stops it where it stands). The flinch is the figure's
//
// How many threats may shoot at once, and how fast aim improves, is `threatTuning` below: the numbers are the
// stand-in game's, so a fight has its rhythm.

const THREATS = {
  // A dismounted sentry: walks a beat, goes to look at what it hears, fights from a firing place it runs to and
  // changes after a burst or two, falls back to cover when hurt.
  sentry: {
    id: 'sentry', type: 'ground', label: 'Sentry',
    body: { figure: 'person', radius: 0.38, height: 1.8, health: 90, turn: 6, speed: { patrol: 1.4, investigate: 2.8, cover: 4.4, engage: 4.5 },
      look: { cloth: ['#4d5338', '#575a45', '#45503a'], gear: ['#34362e', '#3c3b31'], skin: ['#c49a7c', '#a07a5e', '#6e4c38', '#d8b096'], boot: ['#2a2622'], headgear: ['helmet'], pack: 0.2 } },
    senses: { sight: 55, fov: 140, hearing: 45, eye: 1.62, closeRange: 3.5, notice: 0.55 },
    weapon: { kind: 'hitscan', damage: 5, burst: 4, interval: 0.11, cooldown: [1.8, 3], aimTime: 0.5, range: 80, spreadFar: 0.12, spreadNear: 0.045, moving: 0.3 },
    zones: { head: 4, torso: 1, arm: 0.55, leg: 0.7 },
    reactions: { aimSpoil: 0.4, limpSeconds: 6, limpSpeed: 0.55, stagger: { damage: 30, seconds: 0.35 } },
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
  // A foot patrol: the sentry's numbers and table, in lighter kit (caps as often as helmets, packs), walking its route
  // a little slower and noticing a little later; it is meant to be given a route.
  patrol: {
    id: 'patrol', type: 'ground', label: 'Patrol',
    body: { figure: 'person', radius: 0.38, height: 1.8, health: 90, turn: 6, speed: { patrol: 1.3, investigate: 2.8, cover: 4.4, engage: 4.5 },
      look: { cloth: ['#6b6650', '#4d5338', '#5d5f52', '#625a46'], gear: ['#3c3b31', '#4a4636', '#34362e'], skin: ['#c49a7c', '#a07a5e', '#6e4c38', '#d8b096'], boot: ['#2a2622', '#3b3127'], headgear: ['cap', 'helmet', 'cap', 'none'], pack: 0.6 } },
    senses: { sight: 50, fov: 130, hearing: 40, eye: 1.62, closeRange: 3.5, notice: 0.7 },
    weapon: { kind: 'hitscan', damage: 5, burst: 4, interval: 0.11, cooldown: [1.8, 3], aimTime: 0.5, range: 80, spreadFar: 0.12, spreadNear: 0.045, moving: 0.3 },
    zones: { head: 4, torso: 1, arm: 0.55, leg: 0.7 },
    reactions: { aimSpoil: 0.4, limpSeconds: 6, limpSpeed: 0.55, stagger: { damage: 30, seconds: 0.35 } },
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
  weapons: {
    carbine: { name: 'Carbine', magSize: 30, reserve: 150, rpm: 720, damage: 26, range: 300, weakMultiplier: 2.2, view: 'carbine' },
    pistol: { name: 'P320', magSize: 17, reserve: 51, rpm: 400, damage: 18, range: 50, weakMultiplier: 2.0, view: 'pistol', auto: false },
  },
  loadout: ['carbine', 'pistol'],
  player: {},
  // `pain`, `death`, `callout`: the synthesised barks of people (audio/voice.js); a person has no servo and no crash
  sounds: { bed: { rain: 'wet', sea: 0, wind: 0.75 }, threats: {
    ground: { fire: 'ground_fire', step: 'ground_step', die: 'ground_die', loop: 'ground_servo', voice: 1 }, air: { fire: 'air_fire', die: 'air_die', loop: 'air_rotor', voice: 0 },
    sentry: { fire: 'ground_fire', step: 'step_concrete', voice: 1, pain: 'voice_pain', death: 'voice_death', callout: 'voice_contact' },
    patrol: { fire: 'ground_fire', step: 'step_concrete', voice: 1, pain: 'voice_pain', death: 'voice_death', callout: 'voice_contact' },
  } },
  hud: {
    elements: ['markers', 'objective', 'health', 'ammo', 'crosshair', 'hitmarker', 'damage', 'feed', 'prompt', 'radio', 'warn', 'message'],
    words: { objective: 'Objective', health: 'Health', lowAmmo: 'Low ammo', reload: 'R — Reload', reloading: 'Reloading', empty: 'Empty', hold: 'Hold', press: 'Press', open: 'Open', close: 'Close', destroyed: 'destroyed', weak: 'Weak point', key: 'E' },
  },
  // The loading screen's words (host/boot.js), by language; a product's pack may replace any of them. `phases` names the
  // steps the engine reports (engine.js step labels and G.progress phases, see boot.js STEP_IDS); `tips` rotate under the bar.
  loader: {
    en: {
      title: 'Loading', error: 'The mission could not load', retry: 'Retry', slow: 'Taking longer than usual', tip: 'Tip', ready: 'Ready',
      phases: { download: 'Downloading the scene', renderer: 'Starting the renderer', materials: 'Preparing materials', textures: 'Loading textures', scene: 'Reading the map',
        terrain: 'Building the town', effects: 'Preparing effects', audio: 'Loading sound', weapon: 'Issuing equipment', light: 'Lighting', phone: 'Connecting the phone' },
      tips: ['Hold forward at a low wall to climb it.', 'Crouch to lower your profile and steady your aim.', 'Press Esc to pause and free the mouse.', 'Check your phone for the objective and the map.'],
    },
    fr: {
      title: 'Chargement', error: 'La mission n’a pas pu se charger', retry: 'Réessayer', slow: 'Plus long que d’habitude', tip: 'Conseil', ready: 'Prêt',
      phases: { download: 'Téléchargement de la scène', renderer: 'Démarrage du rendu', materials: 'Préparation des matériaux', textures: 'Chargement des textures', scene: 'Lecture de la carte',
        terrain: 'Construction de la ville', effects: 'Préparation des effets', audio: 'Chargement du son', weapon: 'Distribution de l’équipement', light: 'Éclairage', phone: 'Connexion du téléphone' },
      tips: ['Avancez contre un muret pour l’escalader.', 'Accroupissez-vous pour être moins visible et mieux viser.', 'Échap met en pause et libère la souris.', 'Votre téléphone montre l’objectif et la carte.'],
    },
  },
  marks: { objective: { color: '#ffb020' }, extraction: { color: '#30ff90' } },
};
