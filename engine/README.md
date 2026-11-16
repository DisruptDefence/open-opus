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
| `noaudio` | no sound |
| `autostart` | deploy without the click (no pointer lock and no sound without a click, by the browser's rule) |
| `dt` | a fixed simulation step in seconds, for a repeatable run |
| `radius` | chunks of full detail round the player |
| `seed` | the random seed |

The page publishes `window.__OPUS_WORLD`, the world API, and uses nothing else of the engine after `openWorld()`.
`host/mission.js` and `host/scenarios/` are a throwaway stand-in for a session host; their scenario shape is not
a format.

## Test it

```
node --test                                        # in this folder: about 40 tests, a second or two
```

The pure modules are tested alone. `test/world-api.test.js` is the contract test: it boots the real engine
without a screen (`test/headless.js` replaces the modules that need WebGL, sound or a keyboard through the
engine's own module registry) and plays a mission through the world API.

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

## Tools

- `tools/make-test-scene.mjs` writes `scenes/test/`, the generated scene package the tests use. Same code, same bytes.
- `tools/play.mjs` is the browser run above; `tools/photo.mjs` takes the fixed pictures.
- `tools/lift.cjs` is how the lifted modules were cut out of the stand-in game's bundle. It is kept as a record;
  no more code is to be lifted (`../AGENTS.md`, rule 8).

## Where the scene reader differs from the format

The raster layers of a chunk (heights, surface) are binary sections of the container as the format says. The
vector layers (buildings, walls, trees, water, landmarks) are JSON records inside the container's header for
now, with the format's fields and enum values, not fixed-size binary records with a shared vertex pool
(`src/scene/container.js`).
