# Plan: what to take from the public forks of the stand-in game

Written 2026-11-16 by the planning session. Read-only study of four public repositories, compared with `main` at
`67af6b2` and with the open branches `relief`, `landmarks` and `groundtex`. An agent reads `AGENTS.md`, "Rules for every
item" of `GAMEPLAY-PARITY.md` (they apply here unchanged), and its own item in section D.

The forks were read as untrusted data: shallow clones in `/tmp/forks-src/<name>` (outside every repository) and
`gh api`, files read only, nothing run, installed or imported, no asset copied. Fork paths below are at these commits:

| Fork | Commit | Raw base for the paths cited |
|---|---|---|
| studyzy/saltline-infinite | `d3d4a0d` | `https://raw.githubusercontent.com/studyzy/saltline-infinite/d3d4a0d65b075eb8b6e68e64abb3bb3e534110f8/` |
| jbrivesfr/saltline-ghoul | `8920c67` | `https://raw.githubusercontent.com/jbrivesfr/saltline-ghoul/8920c67306a2eecfdedfb0fa64d5aadd7700f49a/` |
| judgeou/saltline-fable-5.2 | `4cfa0eb` | `https://raw.githubusercontent.com/judgeou/saltline-fable-5.2/4cfa0eb19c258ca1f3d8b5d90010a9c48b2ff7aa/` |
| realcodebear/saltline-fable-5.2 (the original mirror) | `09c5177` | `index.html`, 1 423 569 bytes, the bundle `engine/tools/lift.cjs` cuts from |
| mariuszkreft/saltline-fable-5.2 (spec structure only) | `7398f77` | `PLAN-MULTIPLAYER.md`, `specs/001-coop-multiplayer/*` |

None of the four repositories carries a licence file (GitHub API, 2026-11-16).

---

## A. What each fork contains (read from the code)

### A1. studyzy/saltline-infinite (27 commits, 2026-11-13 to 11-15)

The bundle split into ES modules on the official three.js r180 (`js/vendor/three.module.js`, `three.core.js`, with
`THREE-LICENSE.txt`), then an endless city, then co-op.

| Part | Files (lines) | What it is |
|---|---|---|
| Module split | `js/game.js` (95 KB) + 13 modules: `hound.js` 2 100, `drone.js` 1 505, `weapon.js`, `render.js`, `mats.js`, `level.js`, `props.js`, `ground.js`, `backdrop.js`, `fx.js`, `audio.js`, `hud.js`, `mission.js` | The minified bundle cut by function, internal names renamed, Chinese comments. Each module header carries a **map from the minified names to readable ones**: `js/hound.js:25-29` gives `iu/pm → RigBuilder/instantiateRig`, `q_ → solveLegIK`, `Z_ → buildHoundRig`, `iM → createHound`, `sM/nM → raySphere/rayCapsule` |
| Endless city | `js/city.js` 1 400 | 40 m blocks from a hash of the block coordinate. `planBlock(cx, cz)` (`:371`) decides a block once from a structure stream; `planColliders(plan)` (`:522`) is the only source of its colliders; both detail levels draw the same plan (commit `b3858d9`). An occupancy registry `occ.free/claim` (`:418-512`) stops props landing in each other. `solid(...)` (`:843`) emits the drawn box and its collider from the same numbers, inflated to `MIN_SOLID = 0.3` m (`:88`); rotated boxes get their swept AABB. Collidered blocks to ±200 m (`SOLID = 5`, `:22`). Awning and sign stepped out from a point on the face and clamped to the building height (`:711-735`, commit `5f878c0`, which fixed a double offset that put them 2-4 m into the street) |
| City audit | `tools/city-audit.mjs` (9 KB) | Head-less run of the generator with the shipped physics. Asserts: a capsule dropped into each container is pushed out; no container overlaps anything; no solid above 0.6 m floats more than 12 cm from a support; ground-level colliders identical at both detail levels; 8 walks of 20 s at 7 m/s spend 0 frames inside a solid. The commit text gives before/after: 46 floating solids → 0, 90 of 385 blocks whose colliders moved with LOD → 0 |
| City life | `js/city-life.js` 515 | Each block arms one enemy pack when entered (2 to 6 by distance from spawn); a cleared block stays empty; wrecks drop ammunition and a medkit |
| Frame loop | commit `f4ee625`, `js/game.js` | The whole `setAnimationLoop` callback in `try`, first error per stage logged once, `city.update` disabled after it throws, `input.endFrame` guarded. Reason given: a throw in the callback stops three.js re-scheduling it, which reads as "the player cannot move" |
| i18n | `js/i18n.js` 493 | ~170 strings en/zh, `?lang=`, then `localStorage`, then `navigator.language`, switched live |
| Shared simulation | `shared/physics.js` 680, `player.js` 262, `constants.js`, `protocol.js` 189, `hash.js` 167, `world/port-colliders.json` 96 KB | The original AABB list physics and player step moved out unchanged ("deliberately keeps the original algorithms and quirks", `shared/physics.js:3-6`). `hash.js`: canonical box rows rounded to 1 mm, sorted, FNV-1a; client and server must agree before a match (`ready.portHash`, `cityHash`) |
| Co-op server | `server/*.js` (room.js 1 021), `client/net/*.js`, `package.json` (`ws`) | Node authority at 30 Hz, snapshots at 20 Hz, client prediction and reconcile, hitscan rewind ≤ 250 ms, downed/revive, 90 s reconnect. The server runs the client's own `createEnemies` (`server/enemies.js:6` imports `../js/game.js`) and `createCity` (`server/world.js:8`) head-less with stub materials. Spec: `docs/design/specs/2026-11-14-coop-multiplayer-design.md` (482 lines, Chinese) |
| Co-op avatar | `client/net/avatar.js` 3 151 lines | A procedural, skinned operator "in the spirit of the Hound": 21 bones, one merged `SkinnedMesh` per material (15), per-frame procedural animation, procedural cloth maps with baked AO, hands welded to the rifle by two-bone IK. 43 930 body triangles (~74 600 with the rifle), commit `6a18281`. Its references (`tools/dev/avatar-refs.html:202-265`) are Sketchfab and poly.pizza CC BY 4.0 models, Quaternius CC0, a three.js-examples Mixamo model; they are git-ignored and not shipped |

### A2. jbrivesfr/saltline-ghoul (5 commits, 2026-11-16)

Not a split: `src/base.index.html` is the untouched bundle; `tools/build.py` applies counted string patches and
prepends `src/ghoul-*.js` into a generated `index.html` (1.56 MB).

| File (lines) | What it is |
|---|---|
| `src/ghoul-a-body.js` 480 | A 28-particle skeleton (`:7-23`), 26 named hit zones (`:31`, labels in French), and a procedural soldier mesh: ~7 900 vertices, ~13 000 triangles, 14 rigid-skinned bones, gear and rifle, a cloth/skin texture generated at load (README) |
| `src/ghoul-b-physics.js` 391 | Verlet-style constraints (`:9-35`) at 90 Hz: a hit is an impulse on the struck particle, the bone is "stunned" 0.4 s, muscles pull back within ~1.4 s; death releases the body with its velocity; severing removes a joint constraint |
| `src/ghoul-c-fx.js` 285 | Blood spray and six-lobed splats (instanced, 1 536 particles, 256 splats, 30 s); voices: recordings first, and a **formant synthesiser** fallback (`:229-274`: glottal saw, two-to-three band-pass formants per tier, vibrato, six tiers wince → death) |
| `src/ghoul-d-soldier.js` 518 | Two kinds replacing the stand-in's two machines (`:4-9`: burst, telegraph, cooldown, spreads, ranges); gait with limp (`:145-184`); a hit cancels the burst and disrupts aim for 0.4 s, a leg hit adds limp (`:326-327`) |
| `src/ghoul-e-ai.js` 275 | The stand-in's own AI rules (senses, tokens, telegraph, cover, nav) driving the new body |
| `src/ghoul-a2-model.js` 196 + `assets/model/ghoul-model.json` (124 KB, 771 vertices, 20 bones, 15 clips) + `assets/model/tex/material-*.png` (10 textures, 16² to 128 × 256) | "The real GHOUL Godot-demo soldier mesh", the default body. Converted by `tools/import-godot-model.py` from a private project at `~/clawd/projects/sof-ghoul-godot/assets/generated` (`:5-8`, `:28`) |
| `assets/voice/*.wav` (12 files, 380 KB) | Gasp, Limp, Panic, Sharp, Wince |

**Provenance of the mesh and the voices: not open, most likely a commercial game's.** The evidence, all from the files:
the source project is named `sof-ghoul-godot`; the import tool speaks of "the SOF source" and "the reconstructed source
rig" (`tools/import-godot-model.py:16-19`, `:58-60`); the README calls the voices "SOF pain, choke, scream, gasp and limp".
GHOUL was the name of the model and damage system of Raven Software's *Soldier of Fortune* (2000, published by
Activision). Every WAV carries a RIFF `INFO` chunk written in 1999 (`ICRD` 1999-09-01 to 1999-12-07), `ISFT` "Sound
Forge 4.0" and `IENG` "Chia Chin Lee", 22 050 Hz mono, so the voices were recorded twenty-six years before this
fork, by someone who is not the fork's author. The PNGs carry no metadata. The source project is not public (the
author's 12 public repositories, 2026-11-16) and the fork has no licence. **Licence: unknown. Treat as not usable.**

### A3. judgeou/saltline-fable-5.2 (1 commit, `4cfa0eb`)

The bundle split by function into `src/*.js` (21 modules, e.g. `enemies.js` 2 693 lines, `props.js` 5 952, three.js kept
as the bundle's own copy in `src/vendor/three.js` with explicit exports), `styles/ui.css`, a Vite 8.3.8 workflow
(`package.json`, `package-lock.json` 896 lines, `vite.config.js` on 127.0.0.1:8731/8732), `ARCHITECTURE.md` (a module
table, preserved query parameters and `window.__*` diagnostics) and two small tests (`tests/core.test.mjs`,
`tests/vite.test.mjs`). The minified names are kept, so `src/enemies.js` is a navigable copy of the rigs: `pm` `:105`,
`q_` `:169`, `Z_` `:247`, `j_` `:551`, `iM` `:1288`.

### A4. mariuszkreft (structure only)

One commit: `PLAN-MULTIPLAYER.md` (plan), `specs/001-coop-multiplayer/{spec, plan, tasks}.md` and `contracts/{protocol,
sim-api}.md`. Requirements numbered `FR-001…`, success criteria `SC-…`, contracts "frozen after G1", tasks in waves with
`[P]` for parallel slices and each task naming the FR ids it serves. Nothing built.

---

## B. Each idea against our engine

| Idea (fork) | Ours | Verdict |
|---|---|---|
| One collider per visible volume, from the same numbers (studyzy `js/city.js:843`) | The mesher contract: `engine/src/gen/mesher.js` and `engine/src/scene/install.js` call the same helpers (`piecesOf`, `wallSolids`, `propSolid`) for drawing and collision; `engine/test/structures.test.js` "every drawn vertex of a wall lies on its rings", `engine/test/props.test.js` "fills its collider and no more" | **Ours is better**, per generator and tested. Two holes in it, below |
| `MIN_SOLID` 0.3 m, against tunnelling (studyzy `:88`) | `engine/src/physics/physics.js` `moveCapsule` sub-steps at `radius × 0.5` (≈ 0.19 m), `clock.js` caps a step at 0.05 s, `pushOut` tests circle against ring, rays test ring edges exactly | **Not needed**: a centre that never moves more than half the radius per sub-step cannot cross a ring of any thickness. A corner of two overlapping solids can still hold a walker inside (pushOut's 3 passes ping-pong): measured by item FR-1 |
| Plan a block once, colliders never move with LOD (`b3858d9`) | Collision is installed from the chunk's records (`install.js`), never from `near`/`far` soups | **We have it**, by construction |
| Collide everything reachable (`3c3da28`) | Collision lives with the live chunk window; ground without a chunk is a wall (`physics.js` `groundBlock` → `'unloaded'`); spill across chunk edges is `ENGINE-SCALE.md` K3 | **We have it** |
| Occupancy registry so props never overlap (`js/city.js:418-512`) | Branch `relief`: `tools/scene_builder/relief.py` `Obstacles` and `Placer` (`free_run`, `clear`) keep terrace furniture off buildings, carriageways, steps and walls | **We have it** in the builder for café furniture. Trees and `landmarks` props are not checked against each other or against buildings: FR-1 counts them |
| Awnings, signs, antennas attached to the building (`5f878c0`) | Branch `relief`, `engine/src/gen/relief.js`: placed in the façade's own frame from `facade.js` bays (`f.at(u, 0, d)`), seeded per building and edge, awning height clamped to the storey (`:290`), sign arm to `base + sh − 0.5` (`:304`); `engine/test/relief.test.js` "relief stays on or near its wall and off the ground" | **Ours is better** (attached by construction, rules in the style pack). But relief has **no collision**, and stoops and verandas stand on the ground and are walked through (`relief.js:22-23`): FR-5 |
| Windows as thin solid panes, not planes (`31948c7`) | Windows are drawn by `facade.js` inside the building's prism | Not applicable |
| **Paper walls in our engine: what is drawn but does not collide, or collides but is not drawn** | (1) **Courtyards are solid.** `install.js:32` adds `addPrism(p.ring, …)`; holes are dropped, and `physics.js` `addPrism` takes one ring. `facade.js:97` draws the hole walls and `roof.js` leaves the hole open, so a courtyard is drawn open and is an invisible solid block: a passage (`gen/passage.js`) can lead into a wall of air, and a shot into the courtyard stops at nothing visible. Old Quebec has 3 buildings with holes today. (2) **Roofs collide as a flat-topped prism up to the ridge** (`install.js:28`, `top = yBase + hEave + hRoof`): the air above every pitched roof's eaves stops shots and sight. In a town on a cliff (upper town over lower town) a threat on higher ground loses its line of sight through invisible volume. (3) Stoops and verandas (relief, above). (4) Steps of a stairway are drawn as treads (`gen/ground.js` `steps`) and walked as the terrain's ramp: acceptable, said here | **Real gaps**: FR-2, FR-3, FR-5 |
| A collision audit run over the whole world (`tools/city-audit.mjs`) | Per-generator tests and fixed walks (`engine/test/physics.test.js:62`, `:95`); nothing walks a real scene at random or counts overlaps | **Real gap, and the most useful single idea**: FR-1 |
| Frame loop survives a subsystem throw (`f4ee625`) | `engine/src/world/engine.js:125-127` `safe(name, fn)` round every module, error logged once per module | **We mostly have it.** Left outside `safe`: `clock.tick`, the `G.game.state` reads in `simulate`, the loop body itself; a throw there stops `setAnimationLoop` for good (three.js re-schedules after the callback returns). No host is told. No test: FR-4 |
| Shared simulation layer for co-op (`shared/*`, `server/*`) | Pure modules (`geo`, `terrain`, `physics`, `nav`, `scene`, `gen`) run under Node; `engine/test/headless.js` runs the whole engine (player, combat, threats, director, session, world API) in Node with stub render, input and HUD. `docs/SESSION-PROTOCOL.md`: one person per session, the host holds the scenario and does not simulate; shots and kills are the page's word (`ARCHITECTURE.md`, "What a host can and cannot know"); collaboration goes through a TAK server | **We already have the split studyzy had to make** (their server imports the client modules head-less, as our tests do). What a hardened, re-simulating host would still lack: `threats/threats.js:20,50` builds three.js meshes inside the simulation, and `player/player.js:48` writes the camera. The first is fixed for free if threat figures move to their own files (FR-6). Co-op itself: not wanted now (E6) |
| Collider hash in the handshake (`shared/hash.js`) | Chunk files are named and listed by SHA-256 (`ENGINE-SCALE.md` K1); a host grants the scene, the client cannot prove what it loaded anyway | **Idea only**; a host gains nothing it can trust |
| Human soldiers instead of machines (ghoul; studyzy avatar) | `threats/threats.js:62-72`: a box `person` figure (legs, torso, vest, head, arms, rifle, lens), no rig; `GAMEPLAY-PARITY.md` J decided: lift the two machine rigs; human figures' source not chosen | **Real gap** (parity row 4): section C, options |
| Hit zones, flinch, limp, aim disruption (ghoul `ghoul-d-soldier.js:326-327`) | `combat/combat.js`: one weak-point multiplier (`body.weakTop`); no reaction to a hit beyond health | **Real gap** for human archetypes (FR-7). Severing, dents and blood: not for a training product without a decision (E4) |
| Voices (ghoul) | `audio/audio.js` synthesises everything; sound is data since item E | Recordings: rejected (A2). The formant synthesiser (`ghoul-c-fx.js:229-274`) is a good **idea** for pain and call-out voices (FR-8) |
| Readable split of the bundle with name maps (studyzy, judgeou) | `engine/tools/lift.cjs` cuts modules from the original bundle by line; J needs bundle lines 825-841 | **Reading aid for J**: open `studyzy js/hound.js:1-30`, `js/drone.js:1-30` and `judgeou src/enemies.js:105-1288` beside the bundle. Keep lifting from the original bundle with `lift.cjs` so there is one provenance path |
| i18n en/zh with live switch | Loading screen in English and French; HUD words in the content pack; `SESSION-PROTOCOL.md` 7 `lang` | Idea for G (host pages); nothing to take |
| Vite workflow (judgeou) | `AGENTS.md` rules 9 and 10: plain ES modules, no build step, no `node_modules` | **Rejected.** Nothing in it we lack: we serve files as they are |
| Endless procedural city, block packs that fight back | Real places from open data (rule 3); spawns and waves are the session host's | Not applicable. "A zone arms when entered, never again once cleared" is a good **scenario** pattern: a vector for `PLATFORM.md` PL-3 |
| Build id on the title screen, "new build, reload" banner (`0791094`, `5f878c0`) | — | Idea for G; low value |
| Spec structure (mariuszkreft) | `docs/plans/*.md`: items with owns, tests, done, model | Ours already carries more per item. One thing worth copying when a plan grows: numbered acceptance criteria that tests name |

---

## C. Ranked reuse list

Kind: **copy** (bring the code over), **adapt** (rewrite from their code read side by side), **idea** (we write our own
from the description). Because the fork authors' own additions carry no licence (E3), nothing below is a copy except
code the maintainer already lifts from the original bundle.

| # | What | Value | Effort | Read in the fork | Lands in | Risk | Assets | Kind |
|---|---|---|---|---|---|---|---|---|
| 1 | **Whole-scene collision audit**: random sprint walks, never inside a solid; overlap census; things inside buildings; LOD invariance | High: finds paper walls and traps on every scene, for every future scene | S | studyzy `tools/city-audit.mjs` (whole file) | `engine/test/audit.test.js`, `engine/tools/collision-audit.mjs` (new) | Low; may expose many overlaps in OSM data that need a builder rule | none | idea |
| 2 | **Courtyards collide as drawn** (prisms with holes) | High where it occurs: passages into courtyards are a Quebec pattern | S | — (our own gap) | `physics/physics.js` `addPrism` holes; `scene/install.js:32` | Low; physics is pure and tested | none | ours |
| 3 | **Frame loop never stops**; host told of a module failure | Medium: a frozen page during a mission is the worst failure there is | S | studyzy commit `f4ee625` (the `js/game.js` hunk at `:38020-38140`) | `world/engine.js` `frame()`; event `error` | Low | none | idea |
| 4 | **Human threat figure**: procedural, rigged, on the rig builder J lifts | Highest visible gap (parity row 4) once people are the threat | L | studyzy `client/net/avatar.js:1-80` (rig, bone tree, merged `SkinnedMesh` per material, two-bone IK), `js/hound.js:25-29` (name map of the bundle's `iu/pm`); ghoul `src/ghoul-a-body.js:7-60` (proportions in metres, zone list) | `threats/figures/person.js` (new), `content/default.js` `body.figure` | Medium: feel and look are judged by eye; budget | none (procedural) | idea + the lifted rig builder |
| 5 | **Hit reactions for human archetypes**: flinch, 0.4 s aim disruption, burst cancelled, limp after leg hits, zones head/torso/limbs | High for "threats that fight" with people | M | ghoul `src/ghoul-d-soldier.js:4-9`, `:145-184`, `:320-330`; `src/ghoul-a-body.js:31-56` | `threats/threats.js` (reaction state), `content/default.js` (a `reactions` block), `combat/combat.js` zone lookup | Medium (feel) | none | idea |
| 6 | **Roof-shaped collision for shots and sight** | Medium-high in hilly towns (line of sight across roofs) | M | — (our own gap) | `physics/physics.js` (a sloped solid, rays only), `scene/install.js` | Medium: ray cost, and `ENGINE-SCALE.md` K6 changes roofs | none | ours |
| 7 | **Relief that stands on the ground collides**: stoops as steps, veranda posts and deck | Medium: walking through a stoop is visible at every door | S | studyzy `js/city.js:711-735` for the attachment idea only; ours is `relief.js` | `gen/relief.js` (a `reliefSolids(b, groundAt, style)` export), `scene/install.js` | Low; must not block doorways for the nav grid | none | ours |
| 8 | **Synthesised voices**: pain tiers, death, call-outs, per-actor pitch | Medium (feedback), judged by ear | S-M | ghoul `src/ghoul-c-fx.js:229-274` (formant table, envelopes, cooldown 0.85 s per actor, no immediate repeat) | `audio/voice.js` (new), sound names in the content pack | Low | none; never the WAVs | idea |
| 9 | **Reading aid for J**: name maps beside the bundle | Saves hours of reading minified code | — | studyzy `js/hound.js:1-30`, `js/drone.js:1-30`; judgeou `src/enemies.js` | J's brief, `GAMEPLAY-PARITY.md` J | none | none | reading only |
| 10 | Zone-armed spawns as a scenario pattern | Low-medium | S | studyzy `js/city-life.js` header | `PLATFORM.md` PL-3 vectors | none | none | idea |
| — | Ghoul mesh and voices | — | — | — | — | — | **not open; most likely a commercial game's** (A2) | **never** |
| — | Vite, co-op server, collider hash, endless city, AABB physics | — | — | — | — | — | — | not taken (B) |

### The three ways to a human figure (item J, people)

| | 1. Procedural human (recommended) | 2. The ghoul mesh | 3. A CC0 humanoid model |
|---|---|---|---|
| What | Our own figure built in code on the skinned-rig builder J lifts from the bundle (`iu`/`pm`, studyzy calls them `RigBuilder`/`instantiateRig`): ~18 bones, one merged `SkinnedMesh` per material, walk / run / crouch / aim / fire / hit / die driven per frame, like the machines | The 771-vertex, 20-bone mesh and 10 textures in `assets/model/` with its 15 clips | Quaternius *Ultimate Modular Men* (11 characters, 24 animations, FBX/OBJ/Blend; page says CC0, read 2026-11-16) or *Universal Animation Library* (CC0, GLB); Kenney *Animated Characters* (CC0 by Kenney's site, not re-read). Poly Haven has no human among its 522 models (API query, 2026-11-16) |
| Licence | Ours | Unknown, evidence of *Soldier of Fortune* (A2) | CC0, attribution kept anyway |
| Needs | Nothing new at run time | — | three's `GLTFLoader` (an add-on file, not in `engine/vendor/`: rule 9, maintainer), an animation contract (clip names), an offline FBX → GLB step for Quaternius (Blender, a developer's tool), a model format in the pack (J option 2) |
| Look | Matches the machines and the engine's procedural style; can be tuned to a plausible soldier, no face detail needed at 10-50 m | Low-poly 2000-era | Stylised low-poly, recoloured; reads as a game character next to real façades |
| Animation | Procedural: good walk and aim, weaker on falls and gestures (ghoul's particle death is an idea to borrow later) | Clips | Real key-framed clips |
| Budget | ≤ 6 000 triangles near, ≤ 1 500 at a distance tier, ≤ 12 figures drawn at once; studyzy's 43 930 and ghoul's 13 000 are both too many for a squad | — | 2 000 to 10 000 per character |
| Effort | L, Fable (FR-6) | — | M for the loader and contract, plus asset work per character |

**Recommendation: 1 now, with the figure contract (`body.figure`) shaped so that 3 can plug in later as a model
named by the pack.** It needs no decision on dependencies, ships no third-party file, matches what J does for the
machines, and moves the meshes out of `threats.js`, which is what a re-simulating host would need (B).

---

## D. Work plan

Rules: `GAMEPLAY-PARITY.md` "Rules for every item". Hot files owned by running branches, **not to be touched** by
these items until those branches are merged: `engine/src/gen/mesher.js`, `gen/props.js`, `gen/structures.js`
(`relief`, `landmarks`), `gen/ground.js`, `materials/outdoor.js`, `materials/detail.js`, `gen/style.js` (`groundtex`),
`gen/relief.js`, `gen/furniture.js`, `scene/source.js` (`relief`, `landmarks`, and `ENGINE-SCALE.md` K3). None of the
running branches touches `physics/`, `scene/install.js`, `world/engine.js`, `threats/` or `audio/` (checked with
`git diff --name-only main...<branch>` for `relief`, `landmarks`, `groundtex`, `gp-hud`, `gp-input`).

```
FR-1 audit ─────────────┬──► FR-2 courtyards ──► FR-3 roof solids (Fable; after K6 is planned)
                        └──► FR-5 relief solids (after `relief` merges)
FR-4 frame loop          (any time)
J machine rigs (Fable) ──► FR-6 human figure (Fable) ──► FR-7 hit reactions (Fable) 
                                                     └──► FR-8 voices (Sonnet; a person judges)
```

| Item | Size | Model | Review checks |
|---|---|---|---|
| FR-1 collision audit | S | Sonnet | Each check fails when a fault is planted |
| FR-2 courtyards | S | Sonnet | A walker enters a courtyard through its passage |
| FR-3 roof solids | M | **Fable** | Ray cost; agreement with the drawn roof |
| FR-4 frame loop | S | Sonnet | A planted throw does not stop frames |
| FR-5 relief solids | S | Sonnet | Doors stay reachable on the nav grid |
| FR-6 human figure | L | **Fable** | Pictures, budget, a person's eye |
| FR-7 hit reactions | M | **Fable** | A person plays it |
| FR-8 voices | S-M | Sonnet | A person listens |

### FR-1. A collision audit over whole scenes

**Goal.** One test and one tool that walk a real scene the way a player and a threat do and count what is wrong.
**Owns.** `engine/test/audit.test.js`, `engine/tools/collision-audit.mjs` (both new). Reads `engine/src` only.
**Design.** Load with `engine/test/helpers.js` `loadTestScene()` and, for Old Quebec, the same through
`jsonSource(scenes/old-quebec.json)`. Checks, each a number printed by the tool:
(a) 16 seeded walks of 30 s at 1/60 s, sprint speed 6.5 m/s and threat speed 4.5 m/s, radius 0.38 and 0.32, turning
every 1.5 s, with gravity: frames whose capsule centre lies inside a solid ring that overlaps the body's height (feet +
`STEP` to feet + 1.6 m) and is not `bulletOnly`; (b) pairs of solids from **different** records whose rings overlap by more
than 5 cm in plan and in height (the trap of B); (c) trees and props whose footprint lies inside a building piece;
(d) gaps between two buildings wider than 0 and narrower than 0.8 m at ground level (a capsule wedges); (e) the set of
solids installed is the same whatever the detail radius (`params.detail` 0 and 400, compare `physics.stats()` and a sorted
list of rounded ring bounds).
**Tests.** (a) and (e) are assertions on the test scene; (b) to (d) assert on a fixture with one planted fault each
(two overlapping prisms, a tree in a house, a 0.5 m slot) and are reported, not asserted, on Old Quebec.
**Done** when `node --test` is green and the report lists Old Quebec's numbers. A count above zero on (a) on Old Quebec
is reported as a finding, with coordinates, not fixed in this item.

### FR-2. Courtyards collide as drawn

**Goal.** A building with holes is solid only between its outer ring and its holes.
**Owns.** `engine/src/physics/physics.js`, `engine/src/scene/install.js`, `engine/test/physics.test.js`.
**Design.** `addPrism(ring, yBase, yTop, { holes })`: `inside()` is the even-odd test over ring and holes; `closest()`
runs over hole edges too; `raycast` tests hole edges as walls (normal pointing into the hole); caps exclude holes.
`install.js:32` passes `p.holes`. The nav grid uses `blocked()`, which follows.
**Tests.** A 20 × 20 m building with a 8 × 8 m hole: a walker dropped in the hole stays there and is stopped by the
inner walls; a ray from the hole's middle outwards hits the inner wall at 4 m; a ray from above lands on the ground in
the hole; a passage piece leading into a courtyard on a fixture is walked through into the hole. FR-1 (a) still 0.
**Done** when green and the three holed buildings of Old Quebec are named in the report with a picture from inside one
courtyard (photo mode).

### FR-3. Roofs stop shots where they are drawn (Fable)

**Goal.** Above the eaves, shots and sight are stopped by the roof's faces, not by the prism up to the ridge.
**Owns.** `engine/src/physics/physics.js` (a sloped solid, rays and `lineOfSight` only), `engine/src/scene/install.js`,
`engine/test/physics.test.js`. Reads `gen/roof.js` through `mesher.js` `roofInfoOf` (read-only).
**Why Fable.** It is a design choice between a new solid type (planes per roof face for rays) and stepped bullet-only
prisms, under a ray-cost budget, and it must agree with `ENGINE-SCALE.md` K6 (straight-skeleton roofs) before either is built.
**Done** when a ray grazing 0.3 m above the eave of a gabled house passes, a ray into the gable is stopped within 0.1 m
of the drawn face, walkers are unchanged (FR-1 green), and rays per frame cost no more than 10 % more on Old Quebec.

### FR-4. The frame loop never stops

**Goal.** No exception stops the animation loop; the host hears of a failing module once.
**Owns.** `engine/src/world/engine.js` (`frame()` only), `engine/test/loop.test.js` (new), `docs/WORLD-API.md` (the event).
**Design.** The whole body of `frame()` in `try/catch`; `clock.tick` and the `G.game.state` reads inside `safe`; the first
failure of each stage emits `engine:error { module, message }` on `G.events`, which `open.js` surfaces through the
world API's existing `error` event (additive). Nothing is disabled automatically.
**Tests.** Headless: a module factory whose `update` throws every frame; 120 more frames run (`engine.frames` grows by 120), the player still moves under held input, one `error` event is seen, not 120. A throw in a frame hook: the same.
**Done** when green and `WORLD-API.md` lists the event.

### FR-5. Relief that stands on the ground collides (after `relief` merges)

**Goal.** Stoops are climbed as steps and veranda posts stop walkers; doors stay reachable.
**Owns.** `engine/src/gen/relief.js` (a new export `reliefSolids(b, groundAt, style) -> [{ ring, yBase, yTop }]` from the same
plan `reliefPlan` returns), `engine/src/scene/install.js`, `engine/test/relief.test.js`. Offer it first to the `relief` owner.
**Rules.** Each stoop tread a prism whose top is the tread's drawn height (rise ≤ `STEP`), `noNav: false`; veranda posts as
0.12 m prisms, `noNav: true`; nothing above 2.3 m collides.
**Tests.** Every drawn stoop vertex lies within 0.02 m of its solids (as `structures.test.js` does for walls); a walker
climbs a three-tread stoop to the door sill; the nav grid finds a path to every door that had one before.

### FR-6. A human threat figure (Fable; after J) — built 2026-11-16 (`GAMEPLAY-PARITY.md` J)

**Goal.** The `person` figure is a rigged, animated soldier of the engine's own making.
**Owns.** `engine/src/threats/figures/person.js` (new; geometry, rig, animation), the call site in
`engine/src/threats/threats.js` (`buildModel` moves out: machines to `threats/figures/*.js` too, so `threats.js` keeps no
geometry), `engine/src/content/default.js` (`body.figure: 'person'` options: kit colours, helmet or cap), tests.
**Design constraints.** Built on the rig builder lifted for J; budgets of section C; states read from the brain
(patrol, investigate, cover, engage, telegraph, hit, die); hit zones exported as bone segments for FR-7; no face detail,
no lettering, no national insignia (rule 3).
**Done** when the figure is in both missions, pictures at 5, 15 and 40 m are looked at, budgets measured, and a person
has seen it move.

### FR-7. Hit reactions for human archetypes (Fable; after FR-6) — built 2026-11-16 (`GAMEPLAY-PARITY.md` J)

**Goal.** A person hit reacts: flinch toward the wound, burst cancelled, aim disrupted 0.4 s, a limp after a leg hit, a
stagger on a heavy hit; damage by zone (head, torso, limbs) from the pack.
**Owns.** `engine/src/threats/threats.js` (reaction state), `engine/src/combat/combat.js` (zone lookup), `content/default.js`
(`reactions` and `zones` blocks), `docs/CONTENT-PACK.md`, tests (zone multipliers, the 0.4 s window, limp speed).
**Not in it** without a maintainer decision (E4): blood, dents, severing.

### FR-8. Synthesised voices (Sonnet; after FR-6) — the hook and three barks built 2026-11-16; waits for a person to listen

**Goal.** Threats that are people make pain, death and call-out sounds, synthesised, per-actor pitch, one voice at a time
per actor, no immediate repeat.
**Owns.** `engine/src/audio/voice.js` (new), its registration in `audio.js` (one line), sound names in `content/default.js`,
`engine/test/audio-data.test.js`. The brief gives the formant table (three bands per tier, as `ghoul-c-fx.js:262` describes
the shape: open vowels for cries, closed for grunts), durations and gains as numbers. A person listens before merge.

---

## E. Decisions for the maintainer

1. **Decided 2026-11-16: procedural now, CC0 later; the ghoul mesh and voices rejected; no gore.** Was: **Human figures (J, people):** procedural now (option 1, recommended), with a later model format for CC0 figures
   (option 3); or go straight to option 3, which needs `GLTFLoader` in `engine/vendor/` (rule 9) and an animation contract.
2. **The ghoul mesh and voices:** record them as rejected in `DECISIONS.md` (recommended): no licence, a private source
   project named after *Soldier of Fortune*, voice files recorded in 1999 by a third party.
3. **The fork authors' own code** (studyzy's city, audit, avatar; jbrivesfr's ghoul code; judgeou's split), as distinct from
   the original game's: it carries no licence either. This plan treats it as ideas we rewrite. Say if you want it treated
   like the original bundle (lifted and marked), or the authors asked.
4. **Hit feedback on people:** flinch, limp and aim disruption only (recommended for a training product), or also blood
   decals; never severing or dents.
5. **Roof collision (FR-3):** worth up to 10 % more ray cost for true line of sight over roofs?
6. **Co-op:** stays out (one person per session, collaboration through a TAK server, as `SESSION-PROTOCOL.md` says). The
   forks show that our head-less engine is already the shared simulation a server would need; nothing is built for it.
7. **Vite or any build step:** rejected (rules 9 and 10). Confirm, so it is not proposed again.
