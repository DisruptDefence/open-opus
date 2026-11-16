# Open OPUS

A browser game engine and SDK for tactical training through play: a first-person game set in real places,
built from open map data on real coordinates, in which the trainee uses a real TAK client (ATAK) on an in-game
phone to complete objectives.

Open OPUS is the open side of the project: the engine, the world API, the scene format and the tools a
community needs to contribute places (scenes) and missions (scenarios).

## Play it

In the folder that holds this file:

```
python3 -m http.server 8000 --bind 127.0.0.1
```

then open `http://127.0.0.1:8000/play.html`.

Choose a mission (Old Quebec first), press Deploy, and walk to the marked point and then to the pick-up: the
page says "Mission complete". Sentries and a quadcopter are about, and they shoot. Keys: W A S D to move, the
mouse to look, Shift to sprint, Space to jump or climb a low wall, C to crouch, left button to fire, right
button to aim, R to reload, Esc to pause. The page lists them.

What you need: Python 3 to hand the files to the browser (nothing is installed and nothing is built), and a
current Chrome, Edge or Firefox with WebGL 2, a keyboard and a mouse. Opening `play.html` by double-click does
not work, because a browser will not load a game's modules or its map from the disk; the page then says so and
shows the command above. There is no TAK phone in this page yet: it is the engine, a real place and a small
stand-in mission.

**Status, 2026-11-15: early.** What is here:

- `engine/` — the engine as plain ES modules, with three.js r180 vendored in `engine/vendor/` (its only library).
  Georeference, terrain, physics, navigation and the scene container are ours and unit-tested
  (`cd engine && node --test`). Render, materials, effects, audio, input, player, combat and weapon are lifted
  from a stand-in game and are to be rewritten. The world API is implemented and has a contract test.
- `play.html` — the page a player opens (above). `engine/dev.html` is the developer's page, with switches
  (`engine/README.md`).
- `scenes/old-quebec.json` — the first map: Old Quebec in real UTM metres, from OpenStreetMap (ODbL,
  © OpenStreetMap contributors) and Natural Resources Canada's HRDEM terrain (Open Government Licence – Canada).
- `tools/build-scene.py` — the builder that produced it; standard library only. It takes a place file (`places/<id>.json`) and a
  style pack (`styles/<name>.json`): `python3 tools/build-scene.py --place places/<id>.json --cache DIR [--offline]`.
  Its modules are in `tools/scene_builder/` (tests: `python3 -m unittest discover tools/scene_builder`).
- `phone/` — the in-game phone, outside the engine and on the world API only. Press **T** in `phone/demo.html`:
  the game is held and a phone comes up. Out of the box its screen is a placeholder that says no phone is
  connected and shows the player's true grid reference and heading. A developer who runs `phone/local/run.sh`
  gets a real ATAK on a local Android device, shown live on that phone, fed the player's position as its GPS, and
  a scenario can score what the trainee shares from it (`phone/README.md`). There is no imitation of ATAK here.
  To try it, serve the folder as above and open `/phone/demo.html`. `play.html` does not have the phone yet.
- No mission client or session host that speaks the session protocol is here yet. The missions are run in the
  page by a throwaway stand-in (`engine/host/mission.js`), and their scenario shape is not a format.


| Read | For |
|---|---|
| `docs/ARCHITECTURE.md` | The shape: modules, the one door, what runs where |
| `docs/WORLD-API.md` | The contract everything outside the engine codes against |
| `docs/SESSION-PROTOCOL.md` | `opus-session/1` (draft): what a mission client and a session host say to each other |
| `docs/SCENE-FORMAT.md` | `opus-scene/1`: how a real place is packaged |
| `phone/README.md` | The phone: the placeholder, running a real ATAK locally, scoring from what ATAK shares |
| `AGENTS.md` | How to work here, for people and for coding agents |

## Licence

Not chosen yet. Until a licence file is added, all rights are reserved and outside contributions cannot be
merged. Map data used by scenes keeps its own licence and attribution (see the scene format, section 6).

Parts under other terms, whatever is chosen: three.js in `engine/vendor/` (MIT, licence beside it). The scrcpy
server used by the local phone gateway (Genymobile, Apache-2.0) is downloaded by `phone/local/fetch-scrcpy-server.sh`
and is not in this repository. Nothing here is derived from ATAK's source code.

ATAK is not part of this project's code. The unmodified ATAK-CIV 5.8.0 and plugin APKs used by the in-game
phone are attached to the `atak-5.8.0-civ` release as downloads; they remain the work of their authors
(TAK Product Center, tak.gov, and the plugin vendors) under their own terms.
