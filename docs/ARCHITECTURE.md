# Architecture

```
                 ┌──────────────────────── browser ────────────────────────┐
                 │  host page                                              │
                 │  mission client ──┐                 ┌── phone host      │
                 │  (session socket) ▼                 ▼   (PhoneScreen)   │
                 │         ┌──────────── WORLD API ────────────┐  the only door
                 │         └──────────────┬────────────────────┘           │
                 │  engine: core · render · materials · input · fx · audio │
                 │  hud · level · player · combat · weapons · threats      │
                 │  director · geo · terrain · physics · nav · scene       │
                 └────────┬───────────────────┬───────────────────┬────────┘
                     session              scene files            phone
                 ┌────────▼───────────────────▼───────────────────▼────────┐
                 │ session host: scenario, triggers, scoring, clock │ scenes │ phone gateway
                 └──────────────────────────────────────────────────────────┘
```

In this repository today: the engine, the world API, a development host page with an in-page stand-in for a
session host, one scene and its builder, and the phone (`phone/`): a host on the world API, a placeholder screen,
a viewer for a real ATAK, and the local gateway that streams one. Not here yet: a mission client and a session
host that speak the protocol, and a reader of the scenario format (`plans/PLATFORM.md`).

The contracts, their versions and how they may change: `CONTRACTS.md`. Decisions and why: `DECISIONS.md`.
Work in hand, cut into items: `plans/` (`GAMEPLAY-PARITY.md`, `SCENE-DETAIL.md`, `PLATFORM.md`, `ENGINE-SCALE.md`).

## Three rules

1. **One door.** Everything outside the engine talks to the running game through the world API
   (`WORLD-API.md`). Nothing else reads an engine module or a global.
2. **One protocol.** The mission client knows a session protocol (`SESSION-PROTOCOL.md`), not a server. Any
   host that speaks it can run a mission: a small reference host, a hardened one elsewhere.
3. **Data in, engine unchanged.** A new place is a scene package (`SCENE-FORMAT.md`). A new weapon or threat is
   a content pack (`opus-content/1`). A new mission is a scenario (`SCENARIO-FORMAT.md`). None of them is a code
   change.

## What runs where

Anything a player feels within a frame runs in the browser: rendering, audio, movement, collision, shooting,
threat reactions. Anything that decides an outcome belongs to the session host: what spawns and when, mission
state, objectives, scoring, the clock. The client never holds a trigger or a future event; the host sends
commands when they happen, and the engine applies them through `apply()`.

### What a host can and cannot know

The client is a web page on the player's machine: a host can bound what it reports, never prove it.

| What | A host can rely on it? | Why |
|---|---|---|
| What the trainee did in the TAK client | **Yes**, when the host takes Cursor-on-Target from the phone side | It never passes through the page |
| Where the scenario's own things are, the clock, the objectives | **Yes** | The host placed them and keeps them |
| Where the player is | **Within bounds** | Play area and speed are checked; inside them it is the page's word. A changed page can walk through a wall at walking speed |
| Shots, hits, kills, damage, death | **No** | The simulation runs in the page. A host does not rest a result on them, or says so (`debrief.unverified`) |
| That a person, and not a script, touched the phone | **No** | Touches are relayed as they come |

So a result is worth what its TAK-side checks are worth. Design a scenario so that what matters is done in the
TAK client, and treat position as the context of a report, not as the proof of one.

## Layout and toolchain

```
engine/
  README.md             how to run and test the engine, the development page's switches
  index.js              the only file a host page imports
  src/<module>/         one folder per module (table below)
  vendor/               three.js r180, with its licence
  test/                 node --test: the pure modules, threats, the direction of imports, the world API contract
  scenes/test/          a generated scene package for tests (tools/make-test-scene.mjs)
  host/, dev.html       the development host page, and a stand-in mission host with two development scenarios
                        (host/play.js is the player's page, play.html at the repository root)
  tools/                engine tools
play.html               the page a player opens: choose a mission, deploy, play
phone/                  the in-game phone, outside the engine (phone/README.md)
  core.js, host.js      the phone host: T raises the phone through world.hold(), feeds the screen, relays its reports
  placeholder-screen.js the default screen: an empty phone that says so
  stream-screen.js      a real ATAK on a local Android device, shown live; either-screen.js switches between the two
  reports.js            how a mission host hears the phone (the `phone` event, with the host's own places)
  demo.html, demo.js    a host page with the phone; scenarios/ holds its development scenario
  local/                run.sh, gateway.py, android/: the local Android + ATAK + gateway stack (Python, adb)
  test/, tools/         node --test "phone/test/*.test.js"; a headless check of the demo page
scenes/                 published scenes (old-quebec.json)
tools/build-scene.py    the scene builder, standard library only
docs/
```

Plain ES modules that a browser loads as they are. No TypeScript, no bundler, no build step, no `node_modules`.
Tests are `cd engine && node --test` and `node --test "phone/test/*.test.js"`. The TypeScript in `WORLD-API.md` is notation for the contract, not source.

## Modules and the direction of imports

| Layer | Modules (`engine/src/…`) | May import |
|---|---|---|
| Pure | `geo`, `terrain`, `physics`, `nav`, `scene`, `gen` (records into triangles: plain arrays; `docs/plans/SCENE-DETAIL.md`), `content` (content packs: data and their validator) | Each other. No three.js, no DOM: they run under Node and are unit-tested there |
| Engine | `core` (clock, atmosphere, session state), `render`, `materials`, `input`, `fx`, `audio`, `hud`, `level` (scene data into drawn chunks), `shared` | Pure, three.js |
| Simulation | `player`, `combat`, `weapons`, `threats`, `director` | Pure, engine, three.js |
| Door | `world`: `open.js` and `world-api.js` (the world API), and `engine.js`, which builds the shared context and boots the modules | Everything above |
| Outside | host pages, mission client, phone host, session hosts, tools | `engine/index.js` to boot, then the world API only |

Imports go down the table, never up; a module talks upward through events. `engine/test/imports.test.js`
enforces it. `phone/test/imports.test.js` enforces the phone's side: phone code imports only phone code, the
engine imports nothing of the phone, and only the host page's script (`phone/demo.js`) takes `engine/index.js`.

A product replaces a module without editing the engine by passing its own factory to `openWorld`
(`modules: { hud: … }`).

## Using the engine in a product

A product copies `engine/index.js`, `engine/src/` and `engine/vendor/` at a commit it names, serves them as
static files, and writes its own host page: import `openWorld` from `index.js`, give it a scene source, and hand
the `world` it returns to its mission client and phone host. There is no package to install and
nothing to build. The commit is the version until releases are tagged.

## Real ground

Game metres are UTM grid metres from a scene's anchor: `x = E − E0`, `z = −(N − N0)`, `y` up. Position, grid
reference and heading shown in the game are the ones a TAK client computes for the same spot, to the metre.

## Dependencies

three.js, and nothing else at run time in the browser. The local phone gateway (`phone/local/`, a developer's
tool, not part of a page) is Python with the `websockets` package, uses `adb`, and downloads the scrcpy server
(Genymobile, Apache-2.0) instead of keeping it here. Before adding a package, write the small thing yourself; security
primitives and parsers of hostile input are the exception.

## The phone

The phone is real ATAK or nothing: this repository holds no imitation of ATAK's screen. Pressing T raises a phone
frame over the held game. Out of the box its glass shows the placeholder screen. A developer who runs
`phone/local/run.sh` gets an Android device (a virtual one, or later one on USB) with their own copy of ATAK, and a
gateway on `ws://127.0.0.1:9741`; the page finds it by itself and the glass shows that ATAK, live. What the trainee
shares in ATAK reaches the gateway as Cursor-on-Target (ATAK's TAK server is the gateway) and the page's mission
host as the `phone` event. In the in-page stand-in the browser relays that report; a hardened session host takes
it from the phone side itself (`SESSION-PROTOCOL.md` 4, rule 5).

## Scale: what is proven where

| Claim | Proven by | Not proven |
|---|---|---|
| The simulation (movement, collision, threats, commands, the world API) | `node --test` under Node, no screen | — |
| A mission plays end to end in a browser | `engine/tools/play.mjs`, software WebGL, lowest quality, no sound | On a real GPU; at `medium` and above; with sound |
| Pictures of a scene | `engine/tools/photo.mjs`, software WebGL | Frame time on a real GPU: every figure in the plans is software rendering. `plans/ENGINE-SCALE.md` item K5 measures real machines |
| Feel, sound, pointer lock, touch, a gamepad | Nothing automated | A person must judge them |
| A scene larger than one file (2 MB) | The chunked reader, on the generated test scene | The builder does not write chunks; no real place is chunked (`plans/ENGINE-SCALE.md` K1 to K4) |

## Open points

- **The scenario format** is decided (`SCENARIO-FORMAT.md`, draft) and not built; no reference host exists
  (`plans/PLATFORM.md` PL-3, PL-4).
- **Lifted modules.** `render`, `materials`, `fx`, `audio`, `input`, `player`, `combat`, `weapons` and
  `shared/lifted.js` were cut from a stand-in game (`AGENTS.md` rule 8) and are to be rewritten, each against
  tests that pin its behaviour first (`plans/ENGINE-SCALE.md` K7, K8).
- **The scene format is partly implemented**: what each writer and reader does is the table in
  `SCENE-FORMAT.md`, "Status" (the georeference block is no longer among the differences).
- **Licence** of this repository: not chosen.
