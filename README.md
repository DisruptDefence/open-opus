# Open OPUS

A browser game engine and SDK for tactical training through play: a first-person game set in real places,
built from open map data on real coordinates, in which the trainee uses a real TAK client (ATAK) on an in-game
phone to complete objectives.

Open OPUS is the open side of the project: the engine, the world API, the scene format and the tools a
community needs to contribute places (scenes) and missions (scenarios).

**Status, 2026-11-15: early.** This repository holds the architecture, the two contracts and the instructions
for contributors and coding agents. The engine is being built and lands here once it plays a mission on the
architecture described in `docs/ARCHITECTURE.md`.

| Read | For |
|---|---|
| `docs/ARCHITECTURE.md` | The shape: modules, the one door, what runs where |
| `docs/WORLD-API.md` | The contract everything outside the engine codes against |
| `docs/SCENE-FORMAT.md` | `opus-scene/1`: how a real place is packaged |
| `AGENTS.md` | How to work here, for people and for coding agents |

## Licence

Not chosen yet. Until a licence file is added, all rights are reserved and outside contributions cannot be
merged. Map data used by scenes keeps its own licence and attribution (see the scene format, section 6).

ATAK is not part of this project's code. The unmodified ATAK-CIV 5.8.0 and plugin APKs used by the in-game
phone are attached to the `atak-5.8.0-civ` release as downloads; they remain the work of their authors
(TAK Product Center, tak.gov, and the plugin vendors) under their own terms.
