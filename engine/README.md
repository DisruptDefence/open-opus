# The Open OPUS engine

Plain ES modules that a browser loads as they are. One library, three.js r180, vendored in `vendor/` with its
licence. No build step and no `node_modules`.

What the engine is and how its modules may depend on each other: `../docs/ARCHITECTURE.md` (the layer table;
`test/imports.test.js` enforces it). What outside code may call: `../docs/WORLD-API.md`. What a scene is:
`../docs/SCENE-FORMAT.md`.

## Play it

In the repository root (the folder above this one):

```
python3 -m http.server 8000 --bind 127.0.0.1
```

then open `http://127.0.0.1:8000/play.html`: choose a mission, press Deploy, play to "Mission complete". It needs
a browser with WebGL 2, a keyboard and a mouse; the keys are listed on the page. Opened by double-click
(`file://`) the page cannot load the game and says so, with that command. `play.html` is `host/play.js`: it
uses the world API only.

## The development page

The same server also gives the developer's page, which has switches (any port will do; the tools here assume
9760):

```
python3 -m http.server 9760 --bind 127.0.0.1       # in the repository root
```

- `http://127.0.0.1:9760/engine/dev.html` plays the generated test scene with its development scenario.
- `http://127.0.0.1:9760/engine/dev.html?scenario=old-quebec` plays on `scenes/old-quebec.json`.
- `...dev.html?scene=../scenes/old-quebec.json` loads a scene with no mission (a single file, or a package folder).

Switches of the development page, as query parameters:

| Switch | Meaning |
|---|---|
| `scenario` | a name in `host/scenarios/` (default `test`) |
| `scene` | a scene to load instead of the scenario's |
| `q` | quality: `test`, `low`, `medium`, `high`, `ultra` |
| `tod`, `wet`, `haze`, `cloud`, `day` | hour of day (0–24), wetness (0–1), haze and cloud (0–1), day of the year |
| `look` | JSON object laid over the scene's `ambience.look`: grade, exposure, sky and haze, bounce light (keys in `docs/SCENE-FORMAT.md`), e.g. `look={"vignette":0.2,"bounce":[0.1,0.08,0.06]}` (URL-encoded) |
| `noaudio` | no sound |
| `autostart` | deploy without the click (no pointer lock and no sound without a click, by the browser's rule) |
| `dt` | a fixed simulation step in seconds, for a repeatable run |
| `radius` | chunks of full detail round the player |
| `detail` | metres within which a cell is drawn in near detail (default by quality: `test` 0, `low` 45, `medium` 85, `high` 140, `ultra` 220) |
| `seed` | the random seed |
| `doors` | `open` opens every street door as its chunk loads (for pictures); the default is shut |

The page publishes `window.__OPUS_WORLD`, the world API, and uses nothing else of the engine after `openWorld()`.
`host/mission.js` and `host/scenarios/` are a throwaway stand-in for a session host; their scenario shape is not
a format.

## Test it

```
node --test                                        # in this folder: about 95 tests, a few seconds
```

The pure modules are tested alone; `test/fixtures/` holds two small hand-written scenes (old keys, new keys) for
the reader, the mesher and the collision, and every generator file has a contract test. `test/world-api.test.js` is the contract test: it boots the real engine
without a screen (`test/headless.js` replaces the modules that need WebGL, sound or a keyboard through the
engine's own module registry) and plays a mission through the world API. `test/combat.test.js` fights on the same
simulation: the player's rounds kill each threat kind, and threats notice, warn, take turns, shoot bolts, rush and
explode as their archetype data says. What the stand-in game has that this engine lacks: `docs/PARITY.md`.

To see it, play a scenario in a headless browser and look at the pictures it saves:

```
PLAYWRIGHT=/path/to/node_modules/playwright node tools/play.mjs test out/        # or: old-quebec
```

To take the fixed pictures of a scene (photo mode: no HUD, no weapon, the camera at each viewpoint of
`tools/viewpoints/<scene>.json`), with the frame time, draw calls and triangles of each view:

```
PLAYWRIGHT=/path/to/node_modules/playwright node tools/photo.mjs tools/viewpoints/old-quebec.json out/ after
```

Every change to how a scene looks is shown from those viewpoints, before and after.

Playwright is not a dependency: point `PLAYWRIGHT` at any installed copy. Software WebGL draws a few frames a
second, so a run takes about a minute. The exit code is 0 only when the mission reached `complete`.

## Chunks, cells and detail

A scene streams in chunks of 250 m (`src/level/loader.js`). A live chunk is cut into 4 × 4 cells of 62.5 m, and
what is drawn comes in three groups (`src/gen/mesher.js`): `base` (roofs, arches, solid walls: always), `far`
(flat façades, simple trees) and `near` (modelled façades, full trees, rails, the street's ground, props). `far`
and `near` are two pictures of the same things: a cell shows `near` when the camera is within the detail
distance and `far` otherwise (`src/level/detail.js`: built one cell a frame, kept across a 10 m band so nothing
flips at the edge, thrown away 80 m further out). The distance comes from the quality tier or the `detail`
switch, so detail scales down with the machine. `base` and `far` are one mesh per material per chunk; only cells
in `near` add draw calls.

The triangles come from the generators in `src/gen/` (pure code, one file per kind of thing, each with its
contract in its header), and the collision comes from the same functions (`src/scene/install.js`): what is drawn
is what collides. `world.stats()` reports `cellsNear` and `nearBuildMs`.

## Tools

- `tools/make-test-scene.mjs` writes `scenes/test/`, the generated scene package the tests use. Same code, same bytes.
- `tools/play.mjs` is the browser run above; `tools/photo.mjs` takes the fixed pictures.
- `tools/input-check.mjs` drives mouse look (sensitivity, invert, the lock lost, the drag fallback) and the touch
  style sheet through the real input code in a headless browser. Headless Chromium grants no pointer lock, so the
  lock itself is faked; a real lock, a real touch screen and a gamepad are for a person.
- `test/no-place.test.js` fails on words of the stand-in's place, mission or weapon anywhere in `src/`.
- `tools/lift.cjs` is how the lifted modules were cut out of the stand-in game's bundle (`../AGENTS.md`, rule 8).
  The lifted files have been edited by hand since: never give it `src/` as its output folder; lift into a scratch
  folder and bring single files across.

## Where the scene reader differs from the format

The raster layers of a chunk (heights, surface) are binary sections of the container as the format says. The
vector layers (buildings, walls, trees, water, landmarks) are JSON records inside the container's header for
now, with the format's fields and enum values, not fixed-size binary records with a shared vertex pool
(`src/scene/container.js`).
