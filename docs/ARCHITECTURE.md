# Architecture

```
                 ┌──────────────────────── browser ────────────────────────┐
                 │  mission client ──┐                 ┌── phone host        │
                 │  (session socket) ▼                 ▼   (PhoneScreen)     │
                 │         ┌──────────── WORLD API ────────────┐  the only door
                 │         └──────────────┬────────────────────┘             │
                 │  engine core: context, loop, clock, events                │
                 │  render · materials · physics · input · fx · audio · hud  │
                 │  player · combat · weapons · threats · director           │
                 │  scene loader · content packs                             │
                 └────────┬───────────────────┬───────────────────┬─────────┘
                     session              scene files            phone
                 ┌────────▼───────────────────▼───────────────────▼─────────┐
                 │ session host: scenario, triggers, scoring, clock │ scenes │ phone gateway
                 └───────────────────────────────────────────────────────────┘
```

## Three rules

1. **One door.** Everything outside the engine talks to the running game through the world API
   (`WORLD-API.md`). Nothing else reads an engine module or a global.
2. **One protocol.** The mission client knows a session protocol, not a server. Any host that speaks it can run
   a mission: a small reference host here, a hardened one elsewhere.
3. **Data in, engine unchanged.** A new place is a scene package (`SCENE-FORMAT.md`). A new weapon or threat is
   a content pack. A new mission is a scenario. None of them is a code change.

## What runs where

Anything a player feels within a frame runs in the browser: rendering, audio, movement, collision, shooting,
threat reactions. Anything that decides an outcome belongs to the session host: what spawns and when, mission
state, objectives, scoring, the clock. The client never holds a trigger or a future event; the host sends
commands when they happen, and the engine applies them through `apply()`.

## Modules and the direction of imports

| Layer | Modules | May import |
|---|---|---|
| Pure | `geo`, `terrain`, `physics`, `nav`, `scene` | Each other. No three.js, no DOM: they run under Node and are unit-tested there |
| Engine | `core`, `render`, `materials`, `input`, `fx`, `audio`, `hud` | Pure, three.js |
| Simulation | `player`, `combat`, `weapons`, `threats`, `director` | Pure, engine |
| Door | `world` (the world API) | Everything above |
| Outside | mission client, phone host, hosts, tools | The door only |

Imports go down the table, never up. A test enforces it.

## Real ground

Game metres are UTM grid metres from a scene's anchor: `x = E − E0`, `z = −(N − N0)`, `y` up. Position, grid
reference and heading shown in the game are the ones a TAK client computes for the same spot, to the metre.

## Dependencies

three.js, and nothing else at run time. Plain ES modules. Before adding a package, write the small thing
yourself; security primitives and parsers of hostile input are the exception.

## Open points

- Source layout and toolchain (plain ES modules tested with `node --test`, against TypeScript built by Vite)
  are being settled as the engine lands; this document will state the result.
- The session protocol and the scenario format are not written down here yet.
