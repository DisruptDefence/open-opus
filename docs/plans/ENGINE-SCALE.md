# Plan: the engine at scale — chunked scenes, real machines, and the lifted modules

Written 2026-11-16. Three things the engine needs before it carries many places for many people, cut into items.
An agent reads `AGENTS.md`, "Rules for every item" of `GAMEPLAY-PARITY.md` (they apply here unchanged), and its
own item. Decisions behind the designs: `../DECISIONS.md`.

## Order and dependencies

```
SCENE-DETAIL 1 (the builder package) ──► K1 chunked writer ──► K2 far file and client manifest ──► K3 a real place loads chunked ──► K4 terrain at 1 m
SCENE-DETAIL 3 (cells) ───────────────────────────────────────────────────────────────────────────┘
K5 measuring real machines        (any time; owns only new files)
SCENE-DETAIL 4, 9 ──► K6 straight-skeleton roofs
K7 tests that pin the lifted modules ──► K8 the rewrites, one module at a time
```

| Item | What | Size | Model | Review (planning model) checks |
|---|---|---|---|---|
| K1 | The builder writes the chunked packaging | L | Sonnet | A chunk decoded by the engine equals the single file's records for that ground |
| K2 | The far file and the client manifest | M | Sonnet | The manifest projection leaks no host-only key |
| K3 | A real place loads chunk by chunk from a base address | M | Sonnet | Play and pictures unchanged against the single file |
| K4 | Terrain at 1 m in both scenes | S | Sonnet | Budgets, and the cliff in the pictures |
| K5 | Frame times on real machines | S | Sonnet | The page measures what it says; the numbers come from a person's machines |
| K6 | Roofs from a straight skeleton | L | Planning model | — (it executes it) |
| K7 | Tests that pin each lifted module's behaviour | M | Sonnet | Each test fails when the number it pins is changed |
| K8 | Rewrite the lifted modules | L each | Planning model | — (it executes them); a person judges feel |

Budgets are those of `SCENE-DETAIL.md` 5 and `SCENE-FORMAT.md` 8. An item that cannot meet one stops and reports.

---

## K1. The builder writes the chunked packaging

**Goal.** `python3 tools/build-scene.py --place places/<id>.json --cache DIR --packaging chunked --out scenes/<id>/`
writes the package of `SCENE-FORMAT.md` 3, readable by the engine's existing chunk reader.

**Owns.** `tools/scene_builder/container.py`, `tools/scene_builder/chunks.py`, their tests; the `--packaging` and
`--out` arguments in `tools/build-scene.py`. Depends on SCENE-DETAIL item 1.

**Design.**

- **The reference writer is `engine/tools/make-test-scene.mjs`** and the reference reader is
  `engine/src/scene/container.js` with `engine/src/scene/grid.js`. `container.py` writes byte for byte what that
  reader reads: magic `OPSC`, `uint32` container version, `uint32` header length, the UTF-8 JSON header, then
  sections aligned to 4 bytes, little-endian (`SCENE-FORMAT.md` 3.2).
- **Vector layers stay JSON in the chunk header** (decision in `../DECISIONS.md`): the header's entry for
  `buildings`, `roads`, `walls`, `trees`, `water`, `landmarks`, `props`, `crossings` is
  `{ "layer", "type": "json", "records": [ … ] }` with the single file's keys and values, coordinates relative
  to the chunk's minimum corner. `SCENE-FORMAT.md` 3.2 gains the sentence that `json` is a permanent section
  type and fixed-size binary records are an optional later one; the status table loses that difference.
- **Raster layers** are binary sections: `heights` (`float32`, `(n + 1)²` samples for a chunk of `n` cells so
  that neighbours share their edge row), `surface` (`uint8` class per 1 m cell, 250²), `lift` (`uint8`
  centimetres, when SCENE-DETAIL item 6 has landed; otherwise absent).
- **Chunking** (`chunks.py`), on the absolute UTM grid of 3.1: chunk `(ce, cn) = (floor(E / 250), floor(N / 250))`.
  A point record goes to the chunk it lies in. A polyline is split at chunk edges, the cut point added to both
  pieces. A building, water body or landmark is stored once, whole, in the chunk of the centre of its bounding
  box; the header's `spill` is the bounding box of everything the chunk stores.
- **Names and hashes**: `chunks/<ce>_<cn>.<first 16 hex of SHA-256>.bin`. `scene.json` lists, per chunk, name,
  full hash, byte size, `spill`, and the lowest and highest `y`.
- The version directory is `<out>/<date>.<first 7 hex of the SHA-256 of scene.json>/`, and `<out>/latest.json`
  holds `{ "version": "…" }`.
- `--packaging single` (the default) is unchanged.

**Tests** (`python3 -m unittest discover tools/scene_builder`):

- A synthetic scene of four buildings round a chunk corner: each is in exactly one chunk; a building whose box
  centre is in chunk A and whose ring crosses into B is in A, and A's `spill` reaches into B.
- A road crossing two chunk edges gives three pieces whose ends meet to 1 mm.
- Heights: the east column of chunk `(ce, cn)` equals the west column of `(ce + 1, cn)`.
- `container.py` round trip: write, read back with a Python reader in the test, equal.
- Cross-language: `engine/test/scene.test.js` gains a case that reads one chunk written by the Python builder
  from a fixture committed under `engine/test/fixtures/chunk-py.bin` (30 KB at most) with `container.js` and
  finds the fixture's known building `id`.
- Two offline builds give byte-identical packages.

**Budget.** One chunk file ≤ 600 KB after `gzip -9` (print the largest). **Proof.** Build Old Quebec chunked from
the cache; list the files and their sizes in the report. **Done** when the tests pass and `SCENE-FORMAT.md`
status says the builder writes both packagings.

---

## K2. The far file and the client manifest

**Goal.** A browser is given `client.json` and `far.<hash>.bin`, and never a host-only key.

**Owns.** `tools/scene_builder/far.py`, `tools/scene_builder/manifest.py`, tests. Depends on K1.

**Design.** `far.py`: terrain of the whole extent at 10 m (`float32`), and one hull per building of height
≥ 12 m or footprint ≥ 400 m² (its ring simplified to 1.5 m, `yBase`, `h`, tint), in the same container.
`manifest.py`: `client.json` is the fixed projection of `SCENE-FORMAT.md` 9: `format`, `formatMinor`,
`scene_id`, `version`, `georef`, `play`, `extent`, chunk index (name, hash, size, `spill`, `y` range), `far`,
`zones`, `style`, `season`, `ambience`, `credits`. Never: `anchors`, `sources[].url`, `build`, `osm` ids,
`rules`, anything under `odbl/`. `attribution.json`, `build.json` and the `odbl/` sidecar (the OSM-derived
layers as GeoJSON, one file per layer) are written beside `scene.json`.

**Tests.** `client.json` has exactly the keys above (a closed list in the test); it contains none of the strings
`osm`, `anchors`, `build`; the far file's hulls are those the rule selects on a synthetic scene of three
buildings (11 m, 13 m, and 5 m with 500 m²: the last two); every file named in `client.json` exists with the
stated hash and size.

**Done** when the tests pass and `SCENE-FORMAT.md` status no longer lists `attribution.json` and the sidecar as
unbuilt.

---

## K3. A real place loads chunk by chunk

**Goal.** `openWorld({ scene: '<base>/client.json' })` plays a real place from a chunked package with the same
picture and collision as its single file.

**Owns.** `engine/src/scene/source.js` (the `packageSource` path only), `engine/src/level/loader.js` (the far
ring), `engine/tools/play.mjs` and `photo.mjs` (a `--packaging chunked` switch that points at the package),
tests. Depends on K2 and SCENE-DETAIL item 3 (do not start while its branch is unmerged: same files).

**Design.** The reader for the generated test package already exists; this item closes what a real place needs:
collision for a chunk is enabled only when its eight neighbours are loaded (3.1), using `spill`; the far file is
drawn beyond the live window (terrain mesh at 10 m, hulls as tinted prisms, no collision) and hidden under live
chunks; a chunk request that answers 403 or fails is retried after 2 s and then every 5 s, and the chunk stays
"not yet" (the far file shows there); hashes are verified (`crypto.subtle.digest`) and a mismatch is an error
event, not a crash.

**Tests.** `scene.test.js`: with a source that answers 403 for one chunk, the world reaches `ready()` when that
chunk is not in the start ring, and the chunk loads once the source answers; a wrong hash raises the `error`
event naming the file. `physics.test.js`: a spilled building collides when the player stands in the neighbour.

**Proof.** `play.mjs old-quebec --packaging chunked` exits 0; the six pictures against the single file's, side
by side, looked at (they must not differ to the eye). Load to `ready()` measured for both.

---

## K4. Terrain at 1 m

**Goal.** Both published scenes carry HRDEM's true 1 m ground.

**Owns.** `places/*.json` (`terrain.cell: 1`), the regenerated `scenes/<id>/` packages; `scenes/<id>.json` single
files stay at 2.5 m for authors and tests. Depends on K3.

**Do.** Rebuild chunked at 1 m; measure every budget of `SCENE-DETAIL.md` 5 and `SCENE-FORMAT.md` 8 (first
playable ≤ 3 MB, chunk ≤ 600 KB compressed, client memory for 5 × 5 chunks ≤ 400 MB: read
`performance.memory` in the headless run and say it is an estimate). **Proof.** Views 4 and 5 of Old Quebec
(the cliff, the stairs) before and after. If a budget fails, stop and report: do not thin the terrain.

---

## K5. Frame times on real machines

**Goal.** A person opens one page on a real computer and gets the numbers that today exist only for software
rendering.

**Owns.** `engine/perf.html`, `engine/host/perf.js`, `docs/perf/README.md`.

**Design.** `perf.html?scene=<id>&q=<tier>`: opens the world, and for each viewpoint of
`engine/tools/viewpoints/<id>.json` sets `world.photo(pose)`, waits for the pose's promise, lets 60 frames pass,
then records 600 frames of `world.stats()` (frame milliseconds, draw calls, triangles). Then a walk: `photo(null)`,
`start()`, and the player is moved by `apply({ op: 'place', now: true })` along the straight line between the
first two viewpoints at 4 m/s for 20 s (it measures streaming, not play). It shows a table and offers the JSON:

```json
{ "when": "2026-11-16T15:00:00Z", "scene": "old-quebec", "q": "low", "size": [1920, 1080], "dpr": 1,
  "renderer": "<WEBGL_debug_renderer_info string>", "userAgent": "…",
  "views": [ { "id": "1-street", "p50": 7.1, "p95": 9.8, "max": 22.0, "calls": 190, "tris": 610000 } ],
  "walk": { "p50": 7.9, "p95": 14.2, "max": 48.0, "worstChunkMs": 31 } }
```

`docs/perf/README.md` holds the targets and one row per machine measured:

| Machine class | Tier, size | Target |
|---|---|---|
| Integrated graphics of the last five years (Intel Iris Xe class) | `low`, 1920 × 1080 | p50 ≤ 22 ms, p95 ≤ 33 ms in every view and on the walk |
| A mid-range discrete card (GeForce GTX 1660 class) | `high`, 1920 × 1080 | p50 ≤ 16.7 ms, p95 ≤ 25 ms |
| The same | `ultra`, 2560 × 1440 | reported, no target |

**Tests.** `node --test`: `perf.js`'s `summarise(samples)` gives p50 2, p95 5, max 5 for `[1, 2, 2, 3, 5]`.
**Proof.** The page runs to its table in the headless browser at `q=low` (the numbers are software rendering and
are not recorded as a machine). **Done** when a person can follow `docs/perf/README.md`. The measuring itself is
a person's (`What only a person can judge`).

---

## K6. Roofs from a straight skeleton (planning model)

**Why the planning model.** A robust straight skeleton on real footprints (collinear edges, near-parallel edges,
simultaneous events) is a known hard piece of computational geometry; the test of success is partly the
pictures.

**Goal.** Hipped and gabled roofs on L-, T- and U-shaped footprints have true ridges and valleys.

**Owns.** `engine/src/gen/skeleton.js` (new, pure), the hipped and gabled branches of `engine/src/gen/roof.js`,
`engine/test/skeleton.test.js`.

**Contract.** `skeleton(ring) -> { faces: [{ edge, polygon: [[x, z, d], …] }] } | null`: one face per ring edge,
`d` the distance from that edge; `null` when the algorithm cannot finish (the caller then uses the inset roof of
SCENE-DETAIL item 4, which stays as the fallback). Height at a vertex is `min(d · tan(pitch), H)`.

**Tests.** A rectangle gives four faces and one ridge segment of length `2 (L − W)`; an L of two 6 m wings gives
six faces and a valley at the inner corner; a square gives a point; 1 000 seeded random orthogonal polygons
return either a result whose faces tile the footprint (areas sum to the footprint's within 0.1 %) or `null`,
never a throw; on the Old Quebec scene the share of `null` is reported. **Proof.** Views 1, 5 and 6 before and
after. **Done** when the fallback rate on both published scenes is under 10 % and the pictures show ridges on
L-shaped houses.

---

## K7. Tests that pin each lifted module

**Goal.** Before a lifted module is rewritten, its behaviour is fixed by tests that the rewrite must pass.

**Owns.** `engine/test/pin/*.test.js` (new), `engine/tools/pin-check.mjs` (new). No change to `engine/src`.

**Design.** One file per module, on the headless world (`test/headless.js`) or, where WebGL or WebAudio is
needed, in the headless browser through `pin-check.mjs` (the same harness as `play.mjs`).

| Module | Pinned (the numbers are read from the running module in this item and then written into the test) |
|---|---|
| `player` | From rest, forward held: speed after 0.25 s, 0.5 s and 2 s (walk, sprint, crouch); stopping distance; jump apex height and air time; the highest step climbed and the lowest ledge mantled; eye height standing and crouched; fall damage at 4 m and 8 m |
| `combat` | Damage of one hit at 10 m and at the weapon's range limit; the weak-point multiplier; explosion damage at 0, 1.5 and 3 m of a 3 m, 30-damage blast; `stats` after 3 shots and 2 hits |
| `input` | The key map (every action and its key); 500 px of mouse movement at sensitivity 1 turns 60° ± 0.5°; `invertY` |
| `weapons` | Rounds per second while the trigger is held for 2 s; reload time; spread after 1, 5 and 10 rounds held, and 0.5 s after release; ammunition after a reload with 7 rounds left |
| `audio` (browser) | For each of `shot`, `reload`, a threat's `fire`, `step`, `die`: the number of sources started and that the context is `running` |
| `fx` (browser) | A shot at a wall 10 m away adds one tracer and one decal to the scene graph; a 3 m explosion adds its group and removes it within 4 s |
| `materials`, `render` (browser) | The list of material names `G.mats.get` answers; the mean colour (± 6 of 255 per channel) of a 64 × 64 crop at the centre of each of three fixed pictures on the test scene at `q=low` |

Each pinned number carries its tolerance in the test (2 % unless the table says otherwise).

**Tests.** They are the deliverable. Each file's header says how its numbers were taken. **Proof.** For each
module, change one tuning constant in a scratch copy and show the test fails (the report lists the constant and
the failing assertion), then discard the copy. **Done** when `node --test` and `pin-check.mjs` are green.

---

## K8. Rewrite the lifted modules (planning model; one item per module)

**Why the planning model.** Each is a rewrite of feel-critical code against behaviour, not a transcription;
`AGENTS.md` rule 8 and the private product's notes both say a rewrite is written against the module's contract
and its behaviour in play, never by tidying the lifted file.

**Order**, smallest and most felt first: K8a `input` (423 lines), K8b `player` (411), K8c `combat` (102),
K8d `shared/lifted.js` (1 049: what the others still import, cut to what is used), K8e `weapons` (2 917),
K8f `fx` (2 311), K8g `audio` (3 050), K8h `materials` (2 102), K8i `render` (1 821).

**For each.** Owns `engine/src/<module>/**`. Inputs: the module's factory signature and the events it emits and
hears (read them from the current file's `OPUS:` comments and from `world/engine.js`), and its K7 tests. Write
the new module in a new file beside the old, switch `world/engine.js` to it behind the development switch
`?impl=<module>:new`, run K7's tests against both, then delete the old file and the switch and remove the module
from `engine/tools/lift.config.json`. **Done** when the pin tests pass, both missions play, the before/after
pictures are looked at, the file no longer carries the lifted mark, and a person has played it
(`What only a person can judge`).

## What only a person can judge

Every K8 module in the hand and by ear; whether a real machine meets K5's targets; whether skeleton roofs read
as the town's.
