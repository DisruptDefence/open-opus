# Gameplay parity with the stand-in game

The engine began as modules cut out of a stand-in game's bundle (`../tools/lift.cjs`, `../tools/lift.config.json`).
Only part of that bundle was taken. This document maps the whole bundle to what the engine has, feature by
feature, and says what is missing. The plan that closes the gaps is `../../docs/plans/GAMEPLAY-PARITY.md`.

Audit of 2026-11-16, on engine commit `eb44755` plus the threat work of the same day (marked **closed** below).

## How it was audited

- **Read.** The bundle is one minified script of 876 top-level statements. "Line" below means the index of a
  top-level statement, the unit `lift.config.json` uses (`from`, `to`).
- **Run, the stand-in.** Loaded in a headless browser (software WebGL, `q=low`, no sound, fixed step 0.05 s) and
  inspected through the object it publishes. Seen running: boot, the title camera, the intro (3.55 s from deploy
  to play, a radio line 1.3 s in), the HUD's text, the three threats that stand in the level at deploy (two
  flyers, one walker, 55 to 62 m from the start), the weapon's name and ammunition (30 / 150).
  **Not driven:** the page that wraps the stand-in took the keyboard, so walking, shooting and a fight were not
  played there. Movement and weapon numbers below are the stand-in's tuning constants, read from the bundle, not
  measurements. A fight was read from the code (lines 837 to 849), not watched.
- **Run, ours.** `node --test` (the simulation without a screen), `tools/play.mjs` in a headless browser (both
  scenarios reach `complete`), and one short fight watched in a headless browser: a sentry, a crawler and a
  quadcopter 12 to 18 m from a player who stands still take 70 health in 8 s, with no error.
- **Not judged at all:** how anything feels in the hand or sounds. Every automated run of either game was silent.

## The bundle, by line range

| Lines | What it is | In the engine |
|---|---|---|
| 0–352 | three.js | `vendor/three.module.js` (r180, its own copy) |
| 353–367 | Renderer, sky, shadows, post chain | **Lifted**: `src/render/render.js` (sky rewritten for any hour) |
| 371–416 | Materials, procedural textures, labels | **Lifted**: `src/materials/materials.js` |
| 417–419 | Collision and navigation for a flat port (boxes, one grid) | Ours: `src/physics`, `src/nav`, `src/terrain` (terrain, prisms, a moving nav window) |
| 420–559 | Props: containers, barriers, forklift, crates… (~60 builders) | Not taken. A place's objects belong to scenes and content, not engine code |
| 560–585 | The level: one container port, built in code | Not taken. Ours: `src/level` reads a scene package |
| 586–623 | Backdrop: cranes, a ship, a boat | Not taken (place) |
| 624–651 | Ground: wet apron, puddles, sea | Not taken (place). Ground wetness is ours, `src/materials/outdoor.js` |
| 652–672 | Effects: tracers, impacts, decals, smoke, sparks, shells, explosions | **Lifted**: `src/fx/fx.js` |
| 673–772 | Audio: synthesised sounds, music by intensity, positional voices | **Lifted**: `src/audio/audio.js` |
| 773–774 | Input: keys, mouse and pointer lock, drag fallback, touch, gamepad | **Lifted**: `src/input/input.js` |
| 775–776 | Player controller and its tuning | **Lifted**: `src/player/player.js` (+ mantling, terrain) |
| 777–780 | Combat: hit tests, explosions, statistics | **Lifted**: `src/combat/combat.js` |
| 781–823 | The weapon: view model, animation, recoil, reload, spread | **Lifted**: `src/weapons/weapon.js` |
| 824 | Weapon showcase | Not taken (a developer's view) |
| 825–836 | Skinned rigs and models of the two threats | Not taken. Ours: plain figures from boxes (`src/threats/threats.js`) |
| 837–849 | The two threats and their manager: senses, tactics, attack turns, bolts, wrecks | Not taken. Ours: `src/threats` (state tables over archetype data). **The mechanics were rebuilt 2026-11-16** |
| 850–852 | HUD | Not taken. Ours: a development overlay (`src/hud/dev-hud.js`) |
| 853–857 | Settings (stored), title, pause, death and debrief screens, key help | Not taken. Ours: a Deploy button on the host pages |
| 858–859 | The game: intro, objectives held with a key, waves, pursuit, radio lines, rating | Not taken. Ours: `src/core/session.js`, `src/director`, and the host's scenario |
| 860–875 | Boot, frame loop, benchmark | Ours: `src/world/engine.js`, `open.js` |

## Feature by feature

Ranked by what a player meets in the first two minutes. "Size" is the work to close: S under a day, M one to
two days, L more. The item numbers are those of the plan.

| # | Feature | The stand-in (lines; its numbers) | Ours | Gap | Size · item |
|---|---|---|---|---|---|
| 1 | **HUD** | 850–852. Compass tape (4 px per degree, cardinal and 15° marks, heading), objective markers on the tape and in the world with distance, objective text typed out, progress pips, health number and 10 segments (critical at 3), ammunition number, reserve, one pip per round, "Low ammo" at 27 %, "R — Reload", crosshair whose gap is the weapon's spread, hit marker in three kinds (hit, weak, kill), four damage-direction arcs (1.5 s), kill feed (4 lines, 4.2 s), hold-key prompt with a progress ring, radio lines typed at 58 characters a second, a warning line, a message line | Text in three corners, a dot, one hit square, one message line | Nearly all of it. This is the largest visible difference | L · B |
| 2 | **A fight has rhythm** | 837–849. A threat reacts after 0.4 s (flyer) or 0.55 s (walker) in view; every burst is announced 0.5–0.55 s ahead; at most 2 threats shoot at once (3 when more than 5 live), bursts 1.25 s apart; aim tightens with exposure (+0.1/s, −0.45/s) between a far and a near spread and widens with the player's speed | Was: sees at once, shoots at once, everyone shoots together, a fixed tight spread (0.03 against the stand-in's 0.12 → 0.045) | **Closed**: `notice`, warning, turns to shoot, exposure, in archetype data and `TUNING` | done |
| 3 | **Threat attacks** | Flyer: 3 bolts a burst, 70 m/s, 7 damage, aimed ahead of the player, avoidable; orbits 12–25 m out, 4–8 m up, slows to shoot, flies wild under half health; falls spinning and explodes (3 m, 30). Walker: 140 health, bursts of 4 × 5 damage from a firing place 8–18 m away with a line of sight and apart from the others, moves after 1–2 bursts, rushes a player within 3 m (0.28 s warning, 9.5 m/s, 15 damage, 3.5 s between rushes) | Was: both shot instant hits standing still or circling at 26 m | **Closed**: weapon kind `bolt`, `skirmish`, `melee`, `death.explode`, orbit ranges, as data. Not rebuilt: the flyer's obstacle feelers (ours holds height over ground and roofs), the walker pushing others aside | done |
| 4 | **Threat look and animation** | 825–836, 841. Skinned models, a walking gait placed foot by foot, a gimballed sensor, strobes, a searchlight, hit flinch, a wreck that sparks, smokes and sinks | The two machine rigs lifted with their animation (planted feet, gimbal, strobes, searchlight, flinch, crash); people of our own on the same rig builder (planted gait, aim, recoil, flinch, limp, fall); hit zones; synthesised voices | The wreck does not sink; people have no ragdoll; looks and voices await a person | J (built, `GAMEPLAY-PARITY.md` J) |
| 5 | **Objectives done with a key** | 859. Stand within 2.2 m, face it (cosine above 0.45), hold E for 2.4 s; progress drains at 1.6× when released; prompt and ring on the HUD; a sound; the object changes state | A mark is "reached" by walking into its radius | No interaction, no prompt | M · A |
| 6 | **Encounter pacing** | 858–859. 2 flyers and 1 walker stand in the level at deploy; each objective brings a wave (3+1, 3+2, 4+3) 0.85 s apart, at spawn points 18 m or more away and out of sight, a point not reused for 6 s; at most 9 alive; after the last objective up to 5 pursuers, one every 7 s while fewer than 4 live; "Contact — NORTH-EAST" | The scenario places three threats at deploy and nothing more | Waves are the host's to decide (session protocol). Missing: the host cannot ask for "one of these places, out of the player's sight", and the development scenarios have no waves | M · A, G |
| 7 | **Start, death and end** | 859. Deploy: black, fade in over 2.6 s, a place card at 0.5 s, a radio line at 1.3 s, play at 3.5 s (1.3 s on a retry). Death: colour drains to 0.12, the view dims to 0.55, the death screen after 1.5 s. Complete: dim to 0.72, debrief after 3.3 s with time, accuracy, kills, retries and a rating | A cut into play. Death and completion are a state and a line of text | Fades, the death look, the place card. The rating is a host matter | S · A |
| 8 | **Menus, pause, settings** | 853–857. Title, pause (Escape, P, or losing the pointer), settings kept in the browser (quality, sensitivity, invert, volume, field of view), key help, death and debrief screens | Escape pauses; a Deploy button; no settings | Pause screen, settings and their storage are host pages; the engine lacks the setter | M · A (setter), G (pages) |
| 9 | **Music and ambience** | 859, 673–772. Music intensity 0.15 calm, 0.6 alerted or a threat within 26 m, 1 in contact; ambience of the port | Music never changed (nothing called `setIntensity`); port ambience switched off | **Closed** for intensity (the threats module sets it). Ambience is content: none | S · E |
| 10 | **Movement** | 775–776. Walk 3.8, sprint 6.4, crouch 1.9, aiming 2.4 m/s; ground acceleration 34, braking 26, air 9; gravity 21; jump apex 1 m; coyote 0.12 s, jump buffer 0.13 s; crouch height 1.15; head bob 0.024 / 0.013; landing dip; field of view +6 sprinting, 52 aiming; health returns 25/s after 4 s | The same module and the same numbers, plus mantling | None in numbers. Feel is unjudged | – |
| 11 | **Shooting** | 777–823. Magazine 30, reserve 150, 720 rounds a minute, 26 damage, ×2.2 on a weak point, range 300 m; recoil, spread that grows, aiming down sights, reload with phases, dry fire, shells, tracers, impact marks by surface | The same modules. Until 2026-11-16 no test fired a round at a threat | Hits and kills on every archetype are now tested (`test/combat.test.js`). The trigger in a browser is not | S · H |
| 12 | **Damage feedback** | 776, 852. Red pulse, shake, low-health vignette, hurt and ear-ring sounds, direction arcs | The post effects and sounds came with the lifted player and audio; no direction | Direction arcs (HUD), and the world API does not say where a hit came from | S · A, B |
| 13 | **Pointer and mouse** | 773–774. Pointer lock, a drag-to-look fallback after 1.2 s without lock, touch sticks, gamepad | The same module. Never exercised by a test; the touch controls have no style sheet | Untested path; touch unusable | S · F |
| 14 | **Sound** | 673–772 | The same module; every automated run was silent | Unverified that the audio graph starts | S · H |
| 15 | **Weapons** | One carbine, in code | The same carbine, in code, its name and engraving in code | Not a gap against the stand-in; a gap against "a weapon is a content pack" | M · D |
| 16 | **Title camera** | 859. A camera path through the level behind the title | None | A scene would have to carry a path | S · later |
| 17 | **Quality tiers** | 353–367. low, medium, high, ultra, automatic step-down | The same | None | – |

## What was closed on 2026-11-16, and its proof

`src/threats/threats.js`, `src/threats/archetypes.js`: rows 2, 3 and 9. Written for this engine over archetype
data; nothing was lifted. Proof: `test/combat.test.js` (11 cases on the running simulation): each archetype dies
to the right number of rounds and reports `killed` then `despawn`; a weak-point round counts 2.2 times; a sentry
engages after its notice time, warns for its aim time, then fires, and the engine's `player:hit` event carries the shooter's place (the world API's does not yet: plan item A);
never more than two threats in a burst and bursts at least 1.25 s apart; bolts fly, hit a standing player and miss
one who moved; a crawler warns, rushes and deals melee damage; a quadcopter shot down explodes where it lands; the
music intensity goes 0.15 → 1.

## Lifted and not lifted

Lifted modules: `render`, `materials`, `fx`, `audio`, `input`, `player`, `combat`, `weapons`, `shared/lifted.js`,
and since item J `threats/figures/rigs.js` (by the tool) with `quadruped.js` and `quadcopter.js` (cut by hand, `lift.config.json` `handCut`). The lifted files have since been edited by hand (search for `OPUS:`), so
**`lift.cjs` must never be run over `src/` again**: lift into a scratch folder and bring single files across.

## What only a person can judge

Whether movement, recoil and the fight feel right; whether the warning before a burst is long enough to react to;
every sound and the music; whether the HUD reads at a glance; the pointer-lock experience in a real browser.
