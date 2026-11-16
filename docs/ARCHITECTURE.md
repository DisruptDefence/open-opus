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
session host, one scene and its builder. Not here yet: a mission client, a phone host, a session host that
speaks the protocol.

## Three rules

1. **One door.** Everything outside the engine talks to the running game through the world API
   (`WORLD-API.md`). Nothing else reads an engine module or a global.
2. **One protocol.** The mission client knows a session protocol (`SESSION-PROTOCOL.md`), not a server. Any
   host that speaks it can run a mission: a small reference host, a hardened one elsewhere.
3. **Data in, engine unchanged.** A new place is a scene package (`SCENE-FORMAT.md`). A new weapon or threat is
   a content pack. A new mission is a scenario. None of them is a code change.

## What runs where

Anything a player feels within a frame runs in the browser: rendering, audio, movement, collision, shooting,
threat reactions. Anything that decides an outcome belongs to the session host: what spawns and when, mission
state, objectives, scoring, the clock. The client never holds a trigger or a future event; the host sends
commands when they happen, and the engine applies them through `apply()`.

## Layout and toolchain

```
engine/
  index.js              the only file a host page imports
  src/<module>/         one folder per module (table below)
  vendor/               three.js r180, with its licence
  test/                 node --test: the pure modules, threats, the direction of imports, the world API contract
  scenes/test/          a generated scene package for tests (tools/make-test-scene.mjs)
  host/, dev.html       the development host page, and a stand-in mission host with two development scenarios
  tools/                engine tools
scenes/                 published scenes (old-quebec.json)
tools/build-scene.py    the scene builder, standard library only
docs/
```

Plain ES modules that a browser loads as they are. No TypeScript, no bundler, no build step, no `node_modules`.
Tests are `cd engine && node --test`. The TypeScript in `WORLD-API.md` is notation for the contract, not source.

## Modules and the direction of imports

| Layer | Modules (`engine/src/…`) | May import |
|---|---|---|
| Pure | `geo`, `terrain`, `physics`, `nav`, `scene` | Each other. No three.js, no DOM: they run under Node and are unit-tested there |
| Engine | `core` (clock, atmosphere, session state), `render`, `materials`, `input`, `fx`, `audio`, `hud`, `level` (scene data into drawn chunks), `shared` | Pure, three.js |
| Simulation | `player`, `combat`, `weapons`, `threats`, `director` | Pure, engine, three.js |
| Door | `world`: `open.js` and `world-api.js` (the world API), and `engine.js`, which builds the shared context and boots the modules | Everything above |
| Outside | host pages, mission client, phone host, session hosts, tools | `engine/index.js` to boot, then the world API only |

Imports go down the table, never up; a module talks upward through events. `engine/test/imports.test.js`
enforces it.

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

three.js, and nothing else at run time. Before adding a package, write the small thing yourself; security
primitives and parsers of hostile input are the exception.

## Open points

- **The scenario format** is not specified, and no reference host exists. Whether the checks have one open
  implementation is a maintainer decision.
- **Lifted modules.** `render`, `materials`, `fx`, `audio`, `input`, `player`, `combat`, `weapons` and
  `shared/lifted.js` were cut from a stand-in game (`AGENTS.md` rule 8) and are to be rewritten.
- **The georeference block is written three ways** (`SCENE-FORMAT.md`, "Status").
- **Licence** of this repository: not chosen.
