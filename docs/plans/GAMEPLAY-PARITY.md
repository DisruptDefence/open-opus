# Plan: gameplay parity, built once for every scene

Written 2026-11-16 from the audit in `engine/docs/PARITY.md` (read it first: its rows are referred to as "parity
row N"). Each item below can be given to one agent as it stands. An agent reads `AGENTS.md`, this file's
"Rules for every item", and its own item.

## The requirement this plan must satisfy

"We build the game engine once only and reuse it", for every scene anywhere. So:

- **The engine holds mechanisms.** What a threat can do, what a weapon can do, what a HUD can show, how a
  command is applied.
- **Content packs hold kinds.** Which threats exist and their numbers, which weapons, which sounds a threat
  makes, which HUD elements are on and their words. Format `opus-content/1`, item C.
- **Scenarios hold a mission.** What stands where, what happens when, the words spoken. They reach the engine
  only as scenario commands through `world.apply()`.
- **Scenes hold a place.**

How each item keeps to it is stated in the item ("Reuse"). The test that guards it for good is in item I:
a list of words that may not appear in `engine/src`.

### What in the engine breaks the requirement today

Each is fixed by the item named.

| Where | What is tied to a place, a mission or one kind | Item |
|---|---|---|
| `engine/src/threats/archetypes.js` | The threat kinds and their numbers are a source file of the engine | C |
| `engine/src/weapons/weapon.js` | One weapon in code: magazine 30, reserve 150, 720 rpm, damage 26, range 300 (`Gv`, `B_`, `O_`, `H_`, `V_`, line 2246), its name (`mi.name`), and the engraving texts `PAC-9` and `OPUS TRAINING ARMOURY` (about line 1880) | D |
| `engine/src/audio/audio.js` | The stand-in's port sounds are in the sound table (`foghorn`, `halyard`, `container_bang`, the gull ambience timer near line 2443, `relay_cut`, `relay_hum`); handlers for the stand-in's mission events (`objective:done`, `objective:all`, `extraction:reached`); a threat's sounds are chosen by `type === 'ground'` in code | E |
| `engine/src/shared/lifted.js` | `PORT_BOUNDS` (the port's box, `seaY`, `quayX`), exported, used by nothing | I |
| `engine/src/materials/materials.js` | Sign and label art of the port (`berth4` and its neighbours in the sign table near line 1023) | I |
| `engine/src/hud/hooks.js` | The hook `setRelays` is named after the stand-in's mission | B |
| `engine/src/director/director.js` | The colours and shape of a mark are constants in code | A (they become the pack's `marks` block) |
| `engine/src/player/player.js` | The event name `player:rescued` and a comment about a quay; the mechanism (put back inside the scene's bounds) is general | I (rename to `player:outOfBounds`) |
| `engine/src/core/atmosphere.js` | The default latitude is one city's (46.8). The engine always passes the scene's, so it is harmless, but a default should be 0 | not ours: tell the owner of `core/atmosphere.js` |
| `engine/src/input/input.js` | Builds touch controls whose style sheet stayed in the stand-in's page | F |

Not violations: `engine/host/**` (a throwaway host and its scenarios), `engine/scenes/test` (a generated scene).

## Rules for every item

1. Work in your own git worktree under `.worktrees/`, on a branch named after the item, from `main` after the
   items it depends on are merged. Edit only the files your item owns. If you need a change elsewhere, stop and
   report it.
2. Never run `engine/tools/lift.cjs` with `engine/src` as its output: the lifted files carry hand edits
   (`OPUS:` comments). Lift into a scratch folder.
3. No new dependency. Plain ES modules. Layers as in `docs/ARCHITECTURE.md`; `engine/test/imports.test.js` must pass.
4. A world API change is additive, has a case in `engine/test/world-api.test.js` or a new test file, and
   `docs/WORLD-API.md` changes in the same commit.
5. Done means: `cd engine && node --test` green; `node --test "phone/test/*.test.js"` green;
   `engine/tools/play.mjs test` and `old-quebec` exit 0 (they need a display-less browser: run under
   `flock /tmp/opus-heavy.lock`, serve on a 127.0.0.1 port between 9760 and 9764, stop your server by its PID);
   the item's own proof; pictures looked at before you say something is visible.
6. Commits are small, in plain sentences, with no co-author line.
7. Numbers in an item are the specification. Do not retune. If a number cannot work, report it.

**Status, 2026-11-16, evening.** Merged to `main`: C, A, D, E. Being executed: B (branch `gp-hud`), F (branch `gp-input`). Not started: G, H, I. J is built on branch `threats` (machines lifted, people procedural, hit reactions, voices; section J).

## Order and dependencies

```
C  content packs ──► A  world API, director, session ──► B  HUD ──────────► G  host pages ──► H  checks in a browser
                                                     ├──► D  weapon as data ─┘
                                                     ├──► E  sound as data
                                                     ├──► F  input
                                                     └──► I  clean-up and the guard test
J  threat figures: built on branch threats (section J)
```

B, D, E, F and I run in parallel: they share no file. C then A are done first, one after the other, because both
touch `engine/src/world/**`, which is also shared with the scene-detail branch: keep those edits small.

| Item | Player impact | Kind | Recommended model |
|---|---|---|---|
| C content packs | none by itself; everything else stands on it | rewrite | Sonnet |
| A world API, interaction, pacing hooks, start and end | high (rows 5, 6, 7, 12) | rewrite | Sonnet, reviewed by Fable (contract) |
| B HUD | highest (row 1) | rewrite | Sonnet, pictures reviewed by Fable |
| D weapon as data | low now, required for reuse | edit of a lifted file | Sonnet |
| E sound as data | medium | edit of a lifted file | Sonnet |
| F input | medium (row 13) | edit of a lifted file + test | Sonnet |
| G host pages: pause, settings, end screens, waves | high (rows 6, 8) | rewrite | Sonnet |
| H browser checks | none (proof) | tool | Sonnet |
| I clean-up and guard | none (hygiene) | edit | Sonnet |
| J threat figures | high (row 4) | built (branch `threats`) | Fable + maintainer |

Why nothing is lifted in items A to I: the HUD's script (lines 850–852) could be cut out, but its style sheet is
in the stand-in's page, where `lift.cjs` does not reach, and its content is that mission's (relays, "Control");
the menus (853–857) are host pages in this architecture; the game logic (858–859) is one mission written as
code, which is exactly what must become scenario data. The one candidate for a lift is J.

---

## C. Content packs

**Goal.** Threat kinds, weapons, sounds and HUD words reach the engine as one data object, `opus-content/1`,
merged over a default pack, so that a product adds a kind without editing the engine.

**Owns.** `engine/src/content/**` (new), `engine/src/threats/archetypes.js` (moves into the default pack and is
deleted), `engine/test/content.test.js` (new), `docs/CONTENT-PACK.md` (new). Small additive edits, in one
commit, to `engine/src/world/engine.js`, `engine/src/world/open.js`, `engine/index.js`,
`engine/test/imports.test.js`, `docs/ARCHITECTURE.md` (layer table: `content` joins the Pure row),
`engine/test/threats.test.js` and `engine/test/combat.test.js` (the import path of the archetypes only).

**Kind.** Rewrite.

**Data shape.**

```js
// engine/src/content/default.js   export const DEFAULT_PACK = { ... }
{
  format: 'opus-content/1',
  id: 'opus-default',
  threats: { sentry: {...}, crawler: {...}, quadcopter: {...} },   // today's ARCHETYPES, unchanged
  threatTuning: { ...TUNING of threats.js },                      // maxTokens 2, maxTokensCrowd 3, crowd 5, tokenGap 1.25, ...
  weapons: { carbine: { name: 'Carbine', magSize: 30, reserve: 150, rpm: 720, damage: 26, range: 300, weakMultiplier: 2.2, view: 'carbine' } },
  loadout: ['carbine'],
  player: {},                    // overrides of PLAYER_TUNING by key (walk, sprint, ...); empty = the engine's
  sounds: { threats: { ground: { fire: 'ground_fire', step: 'ground_step', die: 'ground_die', loop: 'ground_servo', voice: 1 },
                       air:    { fire: 'air_fire', die: 'air_die', loop: 'air_rotor', voice: 0 } } },   // keyed by archetype id, else by class
  hud: { elements: ['markers', 'objective', 'health', 'ammo', 'crosshair', 'hitmarker', 'damage', 'feed', 'prompt', 'radio', 'warn', 'message'],
         words: { objective: 'Objective', health: 'Health', lowAmmo: 'Low ammo', reload: 'R — Reload', reloading: 'Reloading', empty: 'Empty', hold: 'Hold', destroyed: 'destroyed', weak: 'Weak point' } },
  marks: { objective: { color: '#ffb020' }, extraction: { color: '#30ff90' } },
}
```

**Code.** `engine/src/content/pack.js` (pure, no three.js, no DOM):

- `validatePack(pack) → string[]`: `format` must be `opus-content/1`; every threat passes
  `validateBehaviour` (import from `../threats/brain.js`; `threats` is not a pure layer today, so move
  `brain.js`'s `validateBehaviour` import the other way: copy nothing, instead let `pack.js` take the validator as
  an argument: `validatePack(pack, { validateBehaviour })`); every weapon has positive `magSize`, `rpm`,
  `damage`; `loadout` names existing weapons; unknown top-level keys are ignored.
- `mergePacks(base, extra) → pack`: for `threats`, `weapons`, `sounds.threats`, `marks`: per id, `extra`
  replaces `base` whole (no deep merge of one archetype); `threatTuning`, `player`, `hud.words`: shallow merge by
  key; `hud.elements`, `loadout`: `extra` replaces when present. Neither argument is modified.

`openWorld({ content })`: an object or a promise of one. `createEngine` awaits it, computes
`G.content = mergePacks(DEFAULT_PACK, content || {})`, throws `Error('content pack: ' + errors.join('; '))`
when `validatePack` fails (so `ready()` rejects), and passes `{ archetypes: G.content.threats, tuning:
G.content.threatTuning }` to `createThreats` (it already takes both). `index.js` exports `DEFAULT_PACK`.
The world API gets **no** new member in this item.

**Reuse.** This item is the reuse mechanism. A scene, a mission or a product never edits `engine/src`.

**Tests** (`engine/test/content.test.js`):
1. `validatePack(DEFAULT_PACK)` is `[]`.
2. A pack whose threat has an unknown condition, a weapon with `magSize: 0`, a `loadout` naming a missing
   weapon, and a wrong `format` give four messages, each naming its subject.
3. `mergePacks`: a pack with `threats.sentry.body.health = 10` and nothing else replaces the whole sentry (so
   the test supplies a complete archetype) and leaves `crawler` and `quadcopter`; the base object is unchanged
   (deep-equal to a copy taken before).
4. On the headless world (`test/headless.js`, which gains a `content` pass-through in its `openWorld` call: the
   one edit to that file, in this item): open with a pack adding a threat `drone2` (a copy of `quadcopter` with
   `id: 'drone2'`, health 10); `world.apply({ op: 'spawn', id: 'd', kind: 'drone2', … })` works and
   `snapshot()` shows `archetype: 'drone2'`; without the pack the same command throws `unknown-kind`.
5. Opening with `{ format: 'nope' }` makes `ready()` reject with a message containing `content pack`.

**Done.** Rules 5; `archetypes.js` no longer exists; `grep -r "ARCHETYPES" engine/src` finds only
`content/default.js`.

---

## A. World API: interaction, pacing hooks, start and end, what the HUD needs

**Goal.** Give a host everything the stand-in's hard-coded mission did, as commands, events and snapshot
fields, and give the engine the start, death and end looks.

**Owns.** `engine/src/director/**`, `engine/src/core/session.js`, `engine/src/world/world-api.js`,
`engine/src/world/open.js` (the facade lines for the new members only), `docs/WORLD-API.md`,
`docs/SESSION-PROTOCOL.md` (the table rows that name events), `engine/test/world-api.test.js`,
`engine/test/interact.test.js` (new). Depends on C.

**Kind.** Rewrite. All additions are additive: version stays 1.

### A1. A mark that is used with a key (parity row 5)

`mark` gains `use?: { seconds?: number, prompt: string }`.

- With `use`, the default `radius` is 2.2 and walking in does **not** report `reached`.
- Each frame while `playing`: the candidate is the nearest unused `use` mark with horizontal distance ≤ radius,
  `|player.y − mark.y| ≤ 2.5`, and either distance ≤ 0.9 or the cosine between the player's horizontal forward
  and the direction to the mark ≥ 0.45.
- While the candidate exists and the input action `interact` is down (`G.input.down('interact')`): its
  `progress` rises by `dt / seconds` (default 2.4). Any other mark with progress > 0 falls by `1.6 · dt`.
- At 1: the mark's state becomes `used`, it is never a candidate again, `interact` is emitted with
  `action: 'used'`. Emitted also: `action: 'begin'` when progress leaves 0 by holding, `action: 'cancel'` when it
  returns to 0. Payload as today plus `progress`.
- `snapshot().entities[]` for a mark gains `use?: { prompt, progress }`; `state` is `open` | `reached` | `used`.
- Engine events for other modules: `director:prompt` `{ id, prompt, progress }` every frame a candidate exists,
  `{ id: null }` once when it stops; `objective:progress` `{ id, t }`; `objective:done` `{ id }` on `used`.
- Validation: `use.prompt` a non-empty string, `use.seconds` positive when given; otherwise `invalid`.

### A2. Words on the HUD

- `say` gains `channel?: 'message' | 'radio' | 'warn'` (default `message`) and `who?: string` (radio only). It
  calls `G.hud.message`, `G.hud.radio(text, seconds, who)` or `G.hud.warn(text, seconds)`. The `say` event gains
  `channel`.
- New command `objective`: `{ op: 'objective', text: string, done?: integer ≥ 0, total?: integer ≥ 0 }`. Sets a
  value (applying it twice changes nothing): calls `G.hud.setObjective(text)` and
  `G.hud.setProgress(done ?? 0, total ?? 0)`, keeps them in the director for `clear` (which empties them).

### A3. A spawn the host places loosely (parity row 6)

`spawn` gains `at?: [[x, z], …]`, `hidden?: boolean`, `minDistance?: number` (default 18), `alerted?: boolean`.

- With `at` (1 to 64 places), `x` and `z` are not required. The engine scores each place and takes the best:
  `score = 1.5·rng()`; distance `d` to the player: `d ≥ minDistance ? +2 + 0.5·min(1, (d − minDistance)/30) :
  −(minDistance − d)/4`; when `hidden`, `+2.5` if `physics.lineOfSight(place + 1 m up (air: the archetype's
  altitude), the player's eye)` is false; `−3` if that place was used in the last 6 s of play. The host decides
  that something comes and from which set of places; the engine only avoids making it appear in the player's view.
- `alerted`: the threat starts with `lastKnown` = the player's position and `heard = true`, so its table takes
  it to its investigating state on the first step.
- `threats.spawn` already takes `opts`; pass `alerted` through and set those two fields there (the one edit
  outside this item's files: `engine/src/threats/threats.js`, in `spawn()`, three lines; nobody else owns that
  file in this plan).
- This is the exception to "a command says what stands": applying it again may choose another place. Say so in
  `WORLD-API.md`.

### A4. What the player and the host are told

- `player:hit` gains `from?: { x, y, z }` (the engine event's `fromPos`, rounded to 0.01).
- `snapshot().self` gains `weapon: { id, name, ammo, magSize, reserve, state }` (from `G.weapon`; `id` is
  `G.weapon.id ?? 'carbine'`) and `snapshot()` gains `stats: { shots, hits, kills }` (from `G.combat.stats`).
- New member `settings(patch?) → { sensitivity, invertY, volume, fov }`. With a patch it sets what the patch
  names, clamped: `sensitivity` 0.2–3 (`G.input.sensitivity`), `invertY` boolean (`G.input.invertY`), `volume`
  0–1 (`G.audio.setVolume`; remember the value in the API closure), `fov` 60–100 (`G.player.setFov`). Unknown
  keys are ignored. Answers before `ready()` like `start` does (throws).

### A5. Start, death and end (parity row 7), in `core/session.js`

- `start({ at, fadeIn })`: `fadeIn` seconds, default 2.6, 0 allowed. On start `post.fade = fadeIn > 0 ? 1 : 0`,
  `post.saturation = 1`; while playing `post.fade` goes to 0 as `1 − smoothstep(0.25, fadeIn, t)` where `t` is
  seconds since start. The state is `playing` from the first frame and input is on: no new state (a new value of
  `state()` would be misread by an old host; see Decisions).
- `dead`: each frame `post.saturation` moves to 0.12 at rate 2.2 and `post.fade` to 0.55 at rate 1.4
  (`v += (target − v)·(1 − exp(−rate·dt))`).
- `complete`: `post.fade` to 0.72 at rate 0.9, `post.saturation` to 0.7 at rate 1.
- `post` is `G.render.post`; in the headless test it is a plain object, so the test reads the numbers.

**Reuse.** Nothing here names a mission: "relay" became a mark with `use`; waves became `spawn` with `at`;
"Control" became `who`.

**Tests.** In `engine/test/interact.test.js` on the headless world (extend `test/headless.js` so `keys.down(name)`
answers from a set the test fills: `keys.held = new Set()`):
1. A `use` mark 1.5 m in front of the player, `seconds: 2`: nothing is reported after 3 s without the key;
   with `interact` held, `begin` at once, `used` between 1.95 and 2.1 s, snapshot `state: 'used'`, and no
   `reached` at any time.
2. Hold 1 s, release: progress falls, `cancel` is reported within 0.7 s.
3. The player faces away at 1.5 m: no progress. At 0.8 m facing away: progress.
4. `objective` twice with the same fields: the HUD stub got the same values, and `clear` empties them.
5. `say` with `channel: 'radio', who: 'Net'` calls `hud.radio('…', seconds, 'Net')`; an unknown channel is `invalid`.
6. `spawn` with `at` of two places, one behind the test scene's building from the player and one in the open,
   `hidden: true`, run with 20 seeds (`params.seed`): the hidden place is chosen every time. With
   `minDistance: 18` and places 5 m and 40 m away, both in view: the far one every time. `alerted: true`: the
   entity's state is not the archetype's start state after 0.5 s.
7. A sentry shoots the player: the `player:hit` payload has `from` within 1 m of the sentry's snapshot position.
8. `snapshot().self.weapon` and `stats` exist and are plain; `settings({ sensitivity: 9, fov: 10, volume: 0.5,
   invertY: true })` returns `{ sensitivity: 3, invertY: true, volume: 0.5, fov: 60 }`.
9. `start()` then 0.1 s: `post.fade > 0.9`; after 3 s: `< 0.01`. `end dead`, 3 s: `post.saturation < 0.2`,
   `post.fade` between 0.5 and 0.56. A new `start()` resets both.

**Headless proof.** `play.mjs` both scenarios (unchanged missions still complete).

**Done.** Rule 5; `WORLD-API.md` shows every addition in its tables and its "Status" section lists them under
the date.

---

## B. The HUD

**Goal.** A complete, plain HUD that any scene and mission can use, fed only by engine events and the content
pack, replacing the development overlay on the host pages.

**Owns.** `engine/src/hud/**`, `engine/test/hud.test.js` (new), `engine/tools/hud-shot.mjs` (new). Adds one
export line to `engine/index.js` (`createHud`). Depends on A (the prompt and objective events) and C (`G.content.hud`).

**Kind.** Rewrite. Do not copy the stand-in's markup or style: specify from the behaviour below. Look: one
monospace system font, white and one amber accent (`#ffb020`), no logo, no product name.

**Structure.** `hud/model.js` (pure: numbers in, numbers out, tested under Node), `hud/hud.js` (DOM), `hud/style.js`
(one exported string of CSS, inserted once as a `<style>` element). `hooks.js`: rename `setRelays` to
`setProgress`, add `radio(text, seconds, who)`. Keep `dev-hud.js`.

**Elements** (each drawn only when named in `G.content.hud.elements`; words from `G.content.hud.words`):

| Element | Behaviour, with numbers |
|---|---|
| `compass` (REMOVED 2026-11-16: the player navigates with ATAK; not drawn, no code) | A tape, 4 px per degree, a tick every 5°, a number every 15°, letters every 45°; the centre shows the grid heading as three digits. Heading = `G.georef.headingGrid(player.yaw)` |
| `markers` | For every director mark that is not `used`: a tag on the tape at its bearing (clamped to the tape's ends) and a tag in the world at the mark + 1.9 m (extraction + 1.2 m), projected with the camera; off screen or behind, it sticks to the edge of an inner box of 90 % × 82 %; each shows the label's first two letters and the distance in whole metres. World tags hide while aiming (`player.ads ≥ 0.5`) |
| `objective` | The text of the `objective` command, typed at 46 characters a second; `done/total` as pips when `total > 0` |
| `health` | The number (rounded up) and 10 segments; class `crit` at 3 segments or fewer; shown brighter while below maximum |
| `ammo` | Rounds as two digits, reserve as three, one pip per round of `magSize` (at most 60), the weapon's name; cue text: `reloading` while `weapon.state === 'reloading'`, `reload` at 0 rounds with reserve, `empty` at 0 without, `lowAmmo` at or under `ceil(0.27 · magSize)` |
| `crosshair` | Four bars and a dot; gap in px = `tan(weapon.spread) / tan(fov/2) · (viewport height / 2) + 4`, `+10` while sprinting, clamped 4–70, rounded to 0.5; hidden while `player.ads > 0.6` or dead |
| `hitmarker` | On `player:hitEnemy`: kind `kill` (420 ms), `weak` or `hit` (240 ms); scale 1.5 → 1 for weak and kill, 1.15 → 1 for hit |
| `damage` | Four arcs. On `player:hit` with `fromPos`: an arc for 1.5 s, rotated to `atan2(from.x − p.x, −(from.z − p.z)) + player.yaw`, fading over its last 0.6 s; a fifth hit reuses the oldest |
| `feed` | On `enemy:killed`: "`<LABEL>` destroyed" (the archetype's `label`), plus the `weak` word when the same frame's `player:hitEnemy` had `weak`; at most 4 lines, 4.2 s each |
| `prompt` | On `director:prompt`: "Hold E — `<prompt>`" with a ring filled to `progress` (circumference 2π·19); hidden on `{ id: null }` |
| `radio` | A queue; each line typed at 58 characters a second, then held for its seconds; `who` before it |
| `warn` | One line, centre top, for its seconds |
| `message` | One line, for its seconds |

`model.js` exports: `tapeOffset(headingDeg, widthPx)`, `markerBearing(player, mark)` (degrees −180..180 relative
to heading), `edgeClamp(ndcX, ndcY, behind)`, `crosshairGap(spread, fovDeg, heightPx, sprinting)`,
`damageArcAngle(player, from)`, `ammoCue(ammo, magSize, reserve, state)`, `healthSegments(health, max)`.

**Reuse.** No word of a mission in the module: all text comes from commands (`objective`, `say`, a mark's
`label` and `use.prompt`) or the pack's `words`.

**Tests** (`hud.test.js`, pure): `crosshairGap(0.0125, 74, 540, false)` is 8.5 and with sprinting 18.5;
`ammoCue(8, 30, 150, 'idle')` is `lowAmmo`, `(9, …)` is `''`, `(0, 30, 150)` `reload`, `(0, 30, 0)` `empty`,
`(5, 30, 150, 'reloading')` `reloading`; `healthSegments(100, 100)` 10, `(21, 100)` 3, `(0.4, 100)` 1, `(0, 100)` 0;
`markerBearing` for a mark due east of a player heading north is 90, due west −90, behind ±180;
`damageArcAngle` for a shooter straight ahead is 0; `edgeClamp(0.5, 0.2, false)` returns the point unchanged and
`offscreen: false`, `(2, 0, false)` returns x 0.9 and `offscreen: true`, `(0.1, 0.1, true)` is off screen and mirrored.

**Headless proof.** `tools/hud-shot.mjs` (Playwright as in `play.mjs`): opens `dev.html?scenario=test`, deploys,
applies an `objective`, a `use` mark 2 m ahead, a radio `say`, a `warn`, spawns a sentry 12 m ahead facing the
player, waits for a `player:hit`, and saves four pictures: at rest; prompt with the key held half way; under
fire (arc visible); after a kill (feed, kill marker: kill through `engineOf` is not available to a page, so
place the player facing the sentry and hold `Enter`). The agent looks at each picture and lists what is and is
not visible in its report. Exit 0 only when every element's node exists and is displayed.

**Done.** Rule 5; `dev-host.js` is **not** edited here (item G switches the pages to `createHud`).

---

## D. The weapon as data

**Goal.** A weapon's numbers and name come from the content pack; the view model stays the lifted one.

**Owns.** `engine/src/weapons/**`, `engine/test/weapon-data.test.js` (new). Depends on C.

**Kind.** Edit of a lifted file (keep it marked lifted).

- In `createWeapon(i)` read `const W = i.content.weapons[i.content.loadout[0]]` and use `W.magSize`,
  `W.reserve`, `W.rpm`, `W.damage`, `W.range` where the constants `Gv`, `B_`, `O_`, `H_`, `V_` are used
  (about a dozen uses; the declarations at line 2246 are deleted). The object returned gains `id` (the pack key) and its
  `name` is `W.name`.
- The engraving textures: replace the texts `PAC-9` and `OPUS TRAINING ARMOURY` with empty strings (the plate
  stays blank). `mi.name` is deleted.
- `combat.js` takes the weak-point multiplier 2.2 as a literal: leave it; record in `CONTENT-PACK.md` that
  `weakMultiplier` is not read yet.
- Several weapons, switching, pickups and other view models are **not** in this item (see "Stays with Fable").

**Reuse.** A product changes the carbine's numbers or name in its pack.

**Tests.** The weapon needs WebGL, so the Node test is a source check plus a pure one: (1) `weapon.js` contains
none of `Gv`, `B_`, `O_`, `H_`, `V_` as identifiers and none of the two engraving strings; (2) in the browser,
through `tools/play.mjs`'s page with a pack given by a new `dev.html` switch… **no**: `dev.html` is item G's.
Instead item H checks in a browser that `snapshot().self.weapon` equals the default pack's numbers.

**Done.** Rule 5; `play.mjs` pictures still show the weapon in the hands.

---

## E. Sound as data

**Goal.** Which sounds a threat makes comes from the pack; the stand-in's port and mission sounds leave the engine.

**Owns.** `engine/src/audio/**`, `engine/test/audio-data.test.js` (new). Depends on C and A (event names).

**Kind.** Edit of a lifted file.

- Add `const voiceOf = (enemy) => i.content.sounds.threats[enemy.archetype] || i.content.sounds.threats[enemy.type] || {}`.
  In the handlers `enemy:fire`, `enemy:step`, `enemy:killed`, `enemy:alert`, `enemy:telegraph`, `enemy:melee`
  and the loop started on `enemy:spawn` (function `ho`), take the sound name from `voiceOf(e.enemy)` (`fire`,
  `step`, `die`, `loop`, and `voice` for the `variant` of `alert` and `telegraph`); a missing name plays nothing.
- Delete from the sound table and every list that names them: `foghorn`, `halyard`, `container_bang`,
  `relay_cut`, `relay_hum`, the gull ambience, and the ambience timer block that the `OPUS:` comment near
  line 2443 switched off. Delete the generators only they use.
- Mission events: keep `objective:done` (plays `objective`; A emits it on a used mark); delete the handlers of
  `objective:all` and `extraction:reached`; on `game:state` `complete` keep the `complete` sound.
- Ambience by scene is **not** in this item (no data for it exists; see Decisions).

**Reuse.** A new threat kind gets its sounds by a pack entry.

**Tests.** (1) Source check: none of the deleted names remains in `audio.js`. (2) With a fake `AudioContext`
(a minimal stub class in the test: `createGain`, `createBufferSource`, `createBuffer`, `createDynamicsCompressor`,
`createBiquadFilter`, `createPanner`, `createConvolver`, `destination`, `currentTime`, `resume`; add what the
module asks for until it constructs) count `createBufferSource` calls: an `enemy:fire` from an enemy of
archetype `sentry` plays one more source; from an archetype whose pack entry has no `fire`, none. If the module
cannot be constructed under Node within a day, drop case 2, say so, and leave the proof to item H.

**Done.** Rule 5.

---

## F. Input

**Goal.** The mouse-look path is tested, and touch controls are either styled or off.

**Owns.** `engine/src/input/**`, `engine/test/input.test.js` (new), `engine/tools/input-check.mjs` (new).

**Kind.** Edit of a lifted file + tests.

- Touch: the module builds touch buttons (`t-stick`, `t-btn`, …) with no style sheet. Add
  `input/touch-style.js` (a CSS string inserted when touch mode starts): stick bottom left 120 px, fire and aim
  buttons bottom right 64 px, the rest 44 px in a column above them, all `position: absolute`, translucent white
  borders, `pointer-events: auto`. Plain; no brand.
- No behaviour change to keys, pointer lock, drag fallback or gamepad.

**Tests.**
- `input-check.mjs` (headless browser, `dev.html?scenario=test&noaudio=1`): after Deploy, (1) define
  `document.pointerLockElement` to return the canvas (`Object.defineProperty(document, 'pointerLockElement',
  { configurable: true, get: () => canvas })`), dispatch `pointerlockchange`, then dispatch 10
  `MouseEvent('mousemove', { movementX: 50, movementY: 0 })` on `window`: `snapshot().self.heading` must rise
  by 60° ± 3° (10 × 50 × 0.0021 rad = 1.05 rad at sensitivity 1); with `movementY: 50` the picture's horizon
  moves (compare two screenshots: not identical); after `world.settings({ sensitivity: 2 })` the same events
  turn 120° ± 6°; with `invertY` the vertical direction flips (read back through two screenshots or, if item A
  is merged, nothing more: do not reach into the engine). (2) Remove the override, dispatch
  `pointerlockchange`: the state becomes `paused` (the session pauses when the pointer is lost).
  (3) Without any lock, wait 1.5 s after Deploy: a drag (`mousedown`, `mousemove` with movement, `mouseup` on
  the canvas) turns the view (the drag fallback).
- `input.test.js` under Node: the key map (`h_` export) binds `KeyE` to `interact`, `Escape` to `pause`,
  `KeyR` to `reload`; nothing else is testable without a DOM: say so in the file's header.

**What stays manual, and must be said in the report:** a real pointer lock (the browser's prompt, Escape
leaving it, the raw-input feel), a real touch screen, a real gamepad.

**Done.** Rule 5; `input-check.mjs` exits 0.

---

## G. Host pages: pause, settings, end screens, waves

**Goal.** `play.html` and `engine/dev.html` are a complete small game shell on the world API: the new HUD,
a pause screen, settings that persist, death and debrief screens, and development scenarios with waves.

**Owns.** `engine/host/**`, `engine/dev.html`, `play.html`. Depends on A, B.

**Kind.** Rewrite of host code. Everything here uses `window.__OPUS_WORLD` only.

- Both pages pass `modules: { hud: createHud }`.
- `host/shell.js` (new, shared by both pages): a pause panel on state `paused` (Resume, Settings, Redeploy);
  a settings panel (sensitivity 0.2–3, invert, volume 0–1, field of view 60–100, quality as a link that reloads
  with `?q=`), stored in `localStorage` under `opus.settings.v1` and applied with `world.settings()` after
  `ready()`; on `dead` after 1.5 s a panel "Down" with time and Redeploy; on `complete` after 3.3 s a debrief:
  time (`snapshot().time`), accuracy (`stats.hits / stats.shots`, a dash when no shot), kills. No rating words.
- `host/mission.js`: rules gain `after?: seconds` (the commands are applied that many seconds of
  `snapshot().time` later; the host holds the timer, the engine holds none) and a scenario gains
  `objectiveText` handling through the `objective` command. Keep the "throwaway, not a format" header.
- `host/scenarios/test.json` and `old-quebec.json`: the first objective becomes a `use` mark
  (`use: { seconds: 2.4, prompt: 'Mark the observation point' }`); on `used`, a wave of 3 threats with
  `at` (six places 25–60 m from the mark, chosen on walkable ground of that scene), `hidden: true`,
  `alerted: true`, 0.85 s apart (`after`), a `say` on channel `warn` ("Contact"), and the extraction mark; the
  three threats standing at deploy stay. Old Quebec's places must be checked with `physics`-free means: spawn
  them once in the page and look at `snapshot()` heights and a picture.
- `engine/tools/play.mjs` must still pass: it holds W towards the objective; with a `use` mark it must also hold
  `KeyE` when `snapshot()` shows the mark within its radius. That edit to `play.mjs` belongs to this item
  (item H creates other tools and does not touch `play.mjs`).

**Reuse.** Host code is per product by design; nothing here enters `engine/src`.

**Tests.** `engine/test/mission-host.test.js` (new): on the headless world, the test scenario plays to
`complete` with the key held at the mark; the wave's three threats appear 0.85 s apart after `used` and not
before; a redeploy (`mission.start()` again) leaves exactly the deploy-time threats.

**Headless proof.** `play.mjs test` and `old-quebec` exit 0; pictures of the pause panel, the settings panel,
the death panel and the debrief, looked at.

**Done.** Rule 5.

---

## H. Checks in a browser: the trigger, each kill, sound on

**Goal.** Prove in a real page what Node cannot: the weapon fires and kills each threat kind, and the audio
graph starts and plays.

**Owns.** `engine/tools/fight-check.mjs`, `engine/tools/audio-check.mjs` (both new), `engine/README.md`
(the "Test it" section). Depends on A, D, E, G.

- `fight-check.mjs`: `dev.html?scene=<test scene>&q=low&noaudio=1&dt=0.0167`, deploy; for each threat id in
  the default pack: `apply spawn` 10 m ahead of the player facing away (ground kinds) or 10 m ahead and
  `y` = the player's eye height + 1 (air), `apply place` with the heading towards it, hold `Enter` until an
  `entity` event with `change: 'killed'` for that id or 20 s; record rounds from `shot` events. Pass when every
  kind is killed, `stats.kills` equals the number of kinds, and `self.weapon.ammo` fell by the rounds counted.
  An air threat drifts: re-apply `place` with the fresh bearing every 0.5 s.
- `audio-check.mjs`: the same page **without** `noaudio`, Chromium launched with
  `--autoplay-policy=no-user-gesture-required`; deploy by a real click. Before the page's scripts run
  (`page.addInitScript`), wrap `AudioContext.prototype.createBufferSource` and `AudioBufferSourceNode.prototype.start`
  to count calls into `window.__audio`. Pass when: no console error mentions audio, the context's `state` is
  `running` 2 s after the click, at least one source started after a shot (`Enter`), one more after a threat
  fired (`entity` `fire`), and `window.__errors` is empty.
- README: how to run both, and the sentence "A person must still listen: these checks prove that sounds start,
  not that they are right."

**Done.** Both tools exit 0 under `flock`; their JSON reports pasted in the agent's report.

---

## I. Clean-up and the guard

**Goal.** Remove what is the stand-in's place from engine code and keep it out.

**Owns.** `engine/src/shared/lifted.js`, `engine/src/materials/materials.js`, `engine/src/player/player.js`,
`engine/test/no-place.test.js` (new).

- Delete `PORT_BOUNDS` from `shared/lifted.js` (nothing imports it; check with grep, and remove it from
  `engine/tools/lift.config.json`'s `rename` map: that file is nobody else's in this plan).
- `materials.js`: in the sign/label table delete the entries that are a port's signage (`berth4` and any entry
  whose text names a berth, quay, crane or the stand-in); keep generic hazard signs.
- `player.js`: rename the event `player:rescued` to `player:outOfBounds`; fix the comment that mentions a quay.
- `no-place.test.js`: reads every file under `engine/src` and fails on any of these words, case-insensitive,
  outside comments that start with `// OPUS:` … simpler and stricter: anywhere in the file: `saltline`,
  `harbormaster`, `foghorn`, `halyard`, `quay`, `berth`, `relay_`, `PAC-9`, `gull`, `hound`, `old-quebec`,
  `quebec`. Words still present because another item has not landed (audio: item E; weapon: item D) are listed
  in the test in a `pending` map (word → file) with the item's letter; the test fails if a pending word has
  already gone (so the map is emptied as items land).

**Done.** Rule 5; the pending map lists only D's and E's words, or is empty if they are merged.

---

## J. Threat figures (built 2026-11-16, branch `threats`; looks and voices wait for a person)

Parity row 4. Decided by the maintainer on 2026-11-16 (last section, items 1, 2 and 3): lift the two machine rigs;
threats are machines **and** people; people are procedural, ours, in the generated style of the machines, rigged
on the lifted rig builder; hit feedback on people is a flinch, a spoiled aim for 0.4 s, a limp after a leg hit and
damage by body zone, never gore; voices are synthesised, and judged by a person before they stay.

**Built** (`engine/src/threats/figures/`, `docs/DECISIONS.md` O-8):

| Item | What | Where |
|---|---|---|
| J1 machines | `lift.cjs` cuts the rig builder `iu`, its instancer `pm`, the leg IK `q_` and the rigs `Z_`, `j_` (bundle 825-836) into `rigs.js`, with a far tier from the same bones; the animation halves of 838 and 841 cut by hand into `quadruped.js` (diagonal pairs of planted feet, sprung body, turret and head tracking, recoil, flinch, crash onto the belly) and `quadcopter.js` (attitude from its acceleration, rotors, strobes, gimbal, a lost rotor; the searchlight lent from the render light pool to the nearest one). Stencilled numbers, type names and the stand-in's behaviour are left out. The quadruped's weak point is now its head (a sphere), as in the stand-in, not the top of a cylinder | `rigs.js`, `quadruped.js`, `quadcopter.js`, `lift.config.json` (`handCut`) |
| J2 people (FR-6) | `person.js`: our soldier from rounded boxes, lathed limbs and balls at the joints; helmet, cap or bare head; plate carrier, pouches, a pack on some; gloves, boots, a carbine with a weapon light (the lens that flares before a burst). Clothing, gear, skin and boot colours from `body.look`; four looks per archetype, picked by the threat's id. Poses worked out as joints every frame: a gait whose feet stand where they land (walk: always a foot down; run: moments in the air), hips on the legs, a spine that leans and twists to the aim, the rifle low on patrol, at the ready when alert, in the shoulder to aim and fire with recoil, hands on it by two-bone IK, the head on what it looks at, a crouch in cover, the fall when killed with the rifle dropped beside the body. Archetypes `sentry` (helmets) and `patrol` (caps as often as helmets, packs, a little slower to notice) | `person.js`, `content/default.js` |
| J3 reactions (FR-7) | Hit volumes are capsules along the bones (head, torso, arm, leg); `zones` multipliers from the pack (people: head 4, torso 1, arm 0.55, leg 0.7); `reactions`: aim spoiled 0.4 s (the burst being announced or fired stops), limp at 0.55 of speed for 6 s after a leg hit, a stop of 0.35 s after a round of 30 or more; the flinch is the figure's | `threats.js`, `combat.js`, `content/default.js` |
| FR-8 voices | Our formant synthesiser: `voice_pain` (4), `voice_death` (3), `voice_contact` (3) barks, per-actor pitch, one at a time, no repeat; `engine/tools/voices-wav.mjs` writes them as WAV files | `audio/voice.js` |

**Budgets** (measured by `test/figures.test.js` and `engine/tools/figure-shot.mjs`):

| Figure | Triangles near / far (beyond 18 m) | Draws per figure (+ the same again for shadows) |
|---|---|---|
| person | 5 554 with helmet and pack, 5 306 with a cap / 1 117 | 5 (cloth, gear, skin, metal, lens) |
| quadruped (lifted) | 17 344 / 3 544 | 4 (shell, metal, glow, lens) |
| quadcopter (lifted) | 13 788 with its lamp beam and rotor discs / 3 000 | 6 |

Twelve people inside 18 m are 67 000 triangles and 60 draws. Geometry is built once per look and shared; a figure
owns only its skeleton and its lens material. Skinned meshes are not instanced (three.js has no instanced skinning);
a squad of twelve is twelve skeletons of 19 bones.

**Pictures** (before and after, the same places): `engine/tools/figure-shot.mjs` sets `distance` (one person at 5, 15
and 40 m, Old Quebec viewpoint 1), `gallery` (every kind; a person in each pose), `street` (viewpoints 1 and 10 with
people and machines), `look` (close-ups in the test scene, `SCENE=test`).

**Measured in the pictures** (Old Quebec viewpoints, `q=high`, 1280×720, the whole frame): the box figures drew 581
calls in the distance set, the new figures 572 (one skinned mesh per material instead of a mesh per box); street view
1 with five threats 653 calls before, 609 after; triangles of the frame +1 to +5 %. Both missions (`play.mjs test`,
`old-quebec`) still play to the end.

**What only a person can judge, and is asked of the maintainer:** whether the people read as people and the look is
the one wanted (colours, kit, proportions) or a CC0 model is wanted soon after; the gait and the fall in motion; the
voices (`node engine/tools/voices-wav.mjs outDir` and listen); the zone numbers (a head round kills) and the
reaction times in a fight; whether the `impact_enemy` clang, made for machines, should become a duller sound on
people.

**Not built:** people that throw, reload or take a knee to fire; ragdolls (the fall is scripted); a CC0 model format
(a later figure, `plans/FORK-REUSE.md` C option 3).

## What stays with Fable

| What | Why |
|---|---|
| J, above | Built; the look, the gait and the voices are judged by a person |
| Review of item A's diff against `WORLD-API.md` | The contract is the one thing every host depends on |
| Review of item B's pictures | Whether a HUD reads at a glance is judgement |
| Tuning after the first human play | The numbers here are the stand-in's, made for a 70 m container yard with machines. In a street 300 m long with human sentries, sight 45–55 m, the 8–18 m firing band and the rush may be wrong. Change them in the pack, with a person playing |
| Several weapons, switching, pickups, ammunition in the world | The stand-in has none; it needs design (the `prop` entity kind, a view-model format) before it is work |
| Ambience and music per scene | Needs a decision on where sound content lives (pack or scene) and what it may be (synthesised by the engine, or files with licences) |
| The scenario format and waves in the session protocol | `after`, `at` and `hidden` are used by the throwaway host in G; whether they are the format is the maintainer's open point already |

## What only a person can judge

Movement and recoil in the hand; whether 0.5 s of warning is fair; whether two shooters at a time feels like a
fight in a street; every sound, the music's three levels and their changes; the HUD at a glance and at 4K;
pointer lock in a real browser; touch.

## Decisions needed from the maintainer

1. **Threat figures** (J): decided and built (last section, items 1 to 3).
2. **Machines or people.** The default pack has a person (`sentry`), a four-legged machine (`crawler`) and a
   quadcopter. The crawler's rush is the stand-in's; is a rushing machine wanted in a tactical trainer at all?
3. **An `intro` state.** A5 fades in without one. The stand-in holds the player still for 3.5 s behind a place
   card. Adding the state changes what `state()` can return.
4. **Content packs over the session protocol**: may a host name a pack in its `mission` message, or is the pack
   fixed by the product's page?
5. **Where ambience lives**: scene or pack.
6. **`core/session.js` and `core/clock.js`** have no named owner between the two running branches; this plan
   gives `session.js` to item A.

## Decisions taken by the maintainer (2026-11-16)

1. **Threat figures: lift the two machine rigs** from the stand-in (item J), as mechanisms and models driven by the
   archetype data; item J starts once items C and A are merged.
2. **Threats are both machines and people.** The machine kinds stay; human threats are added as archetypes of the
   same system (perception, warning, turns to shoot, cover). Human figures need a source of models and animation,
   which is not chosen yet: until it is, a human archetype uses a plain figure and says so.
3. **People are procedural, ours, rigged on the lifted rig builder** (2026-11-16, later the same day): in the
   generated style of the machines; no mesh, texture or voice from the `saltline-ghoul` fork (provenance unknown,
   rejected); CC0 humanoid models only later. **Hit feedback on people**: a flinch, a spoiled aim for 0.4 s after a
   hit, a limp after a leg hit, damage by body zone; no gore. **Voices synthesised** (FR-8), built as a hook with a
   few barks and listened to by a person before they stay. Built in item J.
