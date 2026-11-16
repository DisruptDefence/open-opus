# Scene package format — `opus-scene/1`

Design, 2026-11-15, written beside the first real scene (Old Quebec). A scene is a real place, 1–4 km² walkable,
built from open data in UTM metres from a real anchor. This is the package a scene builder writes and the
engine's scene loader reads (`docs/ARCHITECTURE.md`). Everything else depends on it.

Values marked **(inferred)** or **(computed)** were not read from code or measured.

## Status, 2026-11-15

This document is the format. Three things write or read it today:

| | Matches | Differs |
|---|---|---|
| `tools/build-scene.py` → `scenes/old-quebec.json` (single file) | The georeference of 2.2 with `h0`, `vertical`, `checks`; `packaging`; `play`, `extent`; the layers | Buildings have no `id` (4.2), so nothing can refer to one across rebuilds. Terrain is quantised at 0.1 m (`unit`), not `yMin`/`yScale`, and its grid starts at the extent's corner, not on a chunk corner. The file was not rebuilt for 2.2: only its georeference block was rewritten (`build-scene.py --georef-only`) |
| `engine/tools/make-test-scene.mjs` → `engine/scenes/test/` (chunked) | The georeference of 2.2, `play`, `extent`; chunks on the absolute grid of 3.1 (the anchor is deliberately off a chunk corner); the container (3.2), raster layers, hashed names, `anchors.json` | Vector layers are JSON in the chunk header, not binary records |
| The engine's reader (`engine/src/geo/georef.js`, `engine/src/scene/`) | Reads 2.2 exactly as written and refuses a block without `vertical.geoid_undulation`; numbers chunks as 3.1 (`engine/src/scene/grid.js`); both tested against the check points of both scenes | Cuts a single file into chunks itself and burns its roads into a surface raster (the format gives that to the pipeline). Each tile of a single file keeps the file's own terrain samples, so it starts up to one cell before the chunk corner |

The check points of both scenes are **not** computed with a reference library, as 2.2 asks: none is installed
where they were built. Old Quebec's come from the builder's own UTM series (Python) and the engine's independent
implementation (JavaScript) is tested against them, so the two agree to 0.1 m; the test scene's come from the
engine itself. Checking either against a reference library is still to do.

Not built at all: overhead tiles and ATAK overlays (5), nav masks and the route graph (4.8), `attribution.json`
and the share-alike sidecar as files (6), grants (9).

Side: the format, the client manifest and a basic builder (`tools/build-scene.py`) belong to Open OPUS,
so that a community can contribute scenes. The production pipeline, the scene store and its links belong to
RECKON·OPUS. The format has no field that only one side can fill.

## 1. Principles

1. **Semantic data, not meshes.** A chunk carries footprints, heights, classes and rasters; the client
   generates geometry and materials (the engine's materials are procedural already). One record feeds
   rendering, collision, navigation and the map. Pre-built models are allowed only for landmarks.
2. **Game metres are grid metres.** No scale, rotation or reprojection in the client beyond one subtraction.
3. **Immutable, content-addressed, chunked.** A scene version never changes; a file's name contains its hash.
4. **Three audiences, three sets of files.** What every client gets; what only the session host reads; what is
   kept to honour licences. The package keeps them in separate files so the cut is a file list, not a filter.
5. **Unknown is ignorable.** A reader skips layers it does not know and maps unknown class values to class 0.

## 2. Georeference

### 2.1 The rule

```
x =   E − E0        east          E, N: UTM easting and northing, WGS 84, metres
z = −(N − N0)       south         one zone for the whole scene, even if the box straddles a zone boundary
y =   H − H0        up            H: orthometric height, metres
```

- `E0`, `N0`: the anchor, a **whole metre** near the centre of the walkable box, so game coordinates stay
  small. (The Old Quebec build uses 331641 E, 5186615 N.) The chunk grid does not depend on it (3.1).
- `H0`: 0 unless stated, so `y` is the height above the vertical datum. A scene with ground below the datum
  sets `H0` to its lowest ground rounded down, so that `y ≥ 0` on all ground: the engine treats negative `y`
  as "fell out of the world".
- Axis convention: +x east, −z north, y up. A flat approximation (metres per degree around an anchor) is not
  UTM and drifts by metres across a scene; do not use one.

### 2.2 The block (in both manifests)

```json
"georef": {
  "crs": "EPSG:32619", "projection": "utm", "zone": 19, "band": "T", "hemisphere": "N",
  "easting": 331641, "northing": 5186615, "h0": 0,
  "anchor": { "lat": 46.8118, "lon": -71.20680171 },
  "vertical": { "datum": "CGVD2013", "geoid_undulation": -27.6 },
  "convergence_deg": -1.6094,
  "checks": [
    { "x": 0, "z": 0, "lat": 46.8118, "lon": -71.20680171, "mgrs": "19TCM3164186615" }
  ]
},
"play":   { "minX": -350, "maxX": 350, "minZ": -300, "maxZ": 300 },
"extent": { "minX": -470, "maxX": 470, "minZ": -420, "maxZ": 420 }
```

The field names and values are those of the Old Quebec scene file, which carries seven check points written
by the builder; one is shown.

| Field | Meaning |
|---|---|
| `crs`, `projection`, `zone`, `band`, `hemisphere` | The projection. `band` is the latitude band at the anchor |
| `easting`, `northing`, `h0` | `E0`, `N0`, `H0` of 2.1 |
| `anchor` | Latitude and longitude of the anchor, for readers that only need a rough position |
| `vertical.datum` | The single vertical reference all heights were converted to (sources differ by metres to tens of metres, the map-sources survey (to be published) A) |
| `vertical.geoid_undulation` | Ellipsoid height minus orthometric height at the anchor; one constant per scene. Height above ellipsoid for ATAK's GPS = `y + h0 + geoid_undulation` |
| `convergence_deg` | Angle from true north to grid north at the anchor, east positive. True heading = grid heading + convergence |
| `extent` | Extent of the data, game metres |
| `play` | Where the player may go; the margin outside it is scenery |
| `checks` | At least five points with their latitude, longitude and MGRS, computed by the pipeline with a reference library. The client's and the host's conversions are tested against them, which pins the two implementations to each other and to the truth |

### 2.3 Deriving positions

- **MGRS** comes straight from UTM, never through latitude and longitude: `E = easting + x`, `N = northing − z`; the
  100 km square letters from the zone number and `floor(E / 100000)`, `floor(N / 100000)`; digits truncated, not rounded. The band letter needs the latitude of
  the point and is taken from the inverse projection, since a scene can cross a band boundary.
- **Latitude and longitude** (for ATAK's GPS feed and for Cursor-on-Target coming back) use the UTM inverse and
  forward series. Both are implemented in the engine's `geo` module. Required accuracy: 0.1 m inside the scene, so that the grid ATAK computes from the position it is fed
  equals the grid the game computes, to the metre.
- **Heading** sent to ATAK is true: grid heading plus `convergence_deg`. One value per scene is enough (it varies
  by under 0.02° across 2 km at this latitude **(computed)**).
- **Magnetic declination** is not in the package; ATAK computes its own.

## 3. The package

```
<scene_id>/<version>/
  scene.json                       full manifest. Host only.
  client.json                      client manifest: what a browser is given.
  far.<hash>.bin                   the whole scene at low detail: skyline hulls, coarse terrain.
  chunks/<ce>_<cn>.<hash>.bin      one file per 250 m chunk: every layer of that chunk.
  models/<name>.<hash>.glb         landmark models, when a scene has them.
  overhead/tiles/<level>/<tx>_<tz>.<hash>.webp     the map picture, in game coordinates.
  overhead/atak/<name>.kmz         the same picture as a ground overlay for real ATAK.
  anchors.json                     spawn and objective anchors. Host only.
  navgraph.<hash>.bin              scene-wide route graph. Host and client.
  attribution.json                 sources, licences, the credits text.
  odbl/                            share-alike sidecar. Never sent to a client; handed over on request.
  build.json                       provenance: tool version, inputs with dates and hashes, bounding box.
```

| File | Client | Host | Published with an open scene |
|---|---|---|---|
| `client.json`, `far`, `chunks/`, `models/`, `overhead/tiles/`, `navgraph` | yes, through grants | yes | yes |
| `overhead/atak/` | no (pushed to the phone by the host) | yes | yes |
| `scene.json`, `anchors.json`, `build.json` | **no** | yes | yes |
| `attribution.json` | credits text only, inside `client.json` | yes | yes |
| `odbl/` | no | kept | yes (that is its purpose) |

In Open OPUS an author has every file; "host only" then means only that the client code never reads them. In
RECKON·OPUS it is enforced by what the host grants.

### 3.1 Chunk grid

- A chunk is 250 × 250 m on the **absolute UTM grid**: chunk `(ce, cn)` covers eastings
  `[250·ce, 250·(ce+1))` and northings `[250·cn, 250·(cn+1))`. Every fourth chunk edge is a 1 km grid line, the
  grid is the same whatever anchor a scene chose, and two scenes of neighbouring ground share chunk borders.
  16 chunks per km².
- A point or polyline vertex belongs to the chunk it lies in. Polylines (roads, walls) are **split** at chunk
  edges by the pipeline. A building, water body or landmark is stored **once**, whole, in the chunk containing
  the centre of its bounding box; each chunk header gives `spill`, the bounding box of everything it stores,
  so a loader knows how far colliders reach.
- The client enables collision for a chunk only when its eight neighbours are loaded, so spilled colliders are
  present.

### 3.2 Chunk and far files

One container for both: 4-byte magic `OPSC`, `uint32` container version, `uint32` header length, a UTF-8 JSON
header, then binary sections aligned to 4 bytes. The header lists each section (`layer`, `offset`, `length`,
`count`, `type`) and the string table. Little-endian. Coordinates are `float32` metres **relative to the
chunk's minimum corner in game axes** (its north-west corner: `x = 250·ce − E0`, `z = N0 − 250·(cn+1)`); heights are `float32` game `y`
unless stated. Files are served with HTTP compression; no compression inside.

**Two packagings, one format.** `"packaging": "single"` is one JSON file holding the whole scene, with short
keys: it is what `tools/build-scene.py` writes today and what an author edits and
diffs. `"packaging": "chunked"` is the package above, produced from the same records by the same builder.
Georeference, axes, units and the meaning of every field are identical; a reader that lacks the container
reads only `single`. A missing `packaging` means `single`.

## 4. Layers

### 4.1 Terrain

| Item | Encoding |
|---|---|
| Height field | `(250/step + 1)²` samples, `uint16`, row by row from minimum `z`, each row from minimum `x`; `y = yMin + q · yScale` with `yMin`, `yScale` in the header. Edge samples are shared with neighbours and must be identical |
| `step` | 1, 2, 2.5 or 5 m (a divisor of 250), one value per scene: 1 m where lidar exists (Canada HRDEM), 5 m where only the 30 m global model does (finer would be invented detail) |
| Surface raster | `uint8` per cell, at `surfaceStep` (1 or 2 m): `0 unknown, 1 asphalt, 2 concrete, 3 cobble, 4 paving, 5 gravel, 6 dirt, 7 grass, 8 sand, 9 rock, 10 snow, 11 mud, 12 wood, 13 metal, 14 water, 15 vegetation_dense` |
| Tint | optional `rgb8` at 10 m, the regional ground colour from a Sentinel-2 composite (the map-sources survey (to be published) A) |

The pipeline, not the client, flattens the ground under each building and along each road, carves water, and
burns roads, paths and squares into the surface raster. The client never rasterises a polygon. The surface
class is what footsteps, impacts and wetness read (`level.groundSurfaceAt`, `ground.wetnessAt` in the engine
contract); the base content pack maps classes to the engine's surface and material names.

### 4.2 Buildings

One record per building part. Arrays of fixed-size records plus one shared vertex pool.

| Field | Type | Meaning |
|---|---|---|
| `id` | `uint32` | Scene-local, stable across versions of the scene when the source feature is the same. Not the source's id (the mapping is in the sidecar) |
| `parent` | `uint32` | 0, or the id of the building this part belongs to (towers, wings) |
| `ring`, `holes` | offsets into the vertex pool | Outer ring counter-clockwise seen from above in (east, north); holes clockwise. Closed implicitly. Courtyards are holes |
| `yBase` | `float32` | Ground at the building after flattening |
| `hEave` | `float32` | Wall height above `yBase` |
| `hRoof` | `float32` | Roof height above the eave (0 for flat) |
| `levels` | `uint8` | Storeys above ground, for window rows; 0 = derive from `hEave` |
| `roofShape` | `uint8` | `0 flat, 1 gabled, 2 hipped, 3 mansard, 4 pyramidal, 5 skillion, 6 dome, 7 cone, 8 gambrel` |
| `roofDir` | `uint8` | Ridge direction in 2° steps from grid north; 255 = along the longest side |
| `roofMat` | `uint8` | `0 generic, 1 metal_seam, 2 copper, 3 slate, 4 shingle, 5 tile, 6 membrane, 7 concrete, 8 thatch, 9 sheet_metal` |
| `facade` | `uint8` | `0 generic, 1 stone_ashlar, 2 stone_rubble, 3 brick, 4 stucco, 5 wood_siding, 6 concrete, 7 glass, 8 metal_panel, 9 mud_brick, 10 block_unfinished` |
| `palette` | `uint8` | Colour variant within the façade class; chosen by the pipeline (from tags or a seeded pick) so every client draws the same town |
| `use` | `uint8` | `0 unknown, 1 residential, 2 commercial, 3 civic, 4 religious, 5 industrial, 6 military, 7 transport, 8 ruin` |
| `damage` | `uint8` | 0 intact … 3 destroyed, for scenes drawn from conflicts |
| `heightSource` | `uint8` | `0 measured, 1 tag, 2 levels, 3 rule`: where `hEave` came from (the single-file key `hs`) |
| `flags` | `uint8` | bit 0 `landmark` (drawn from `models/`, not extruded), bit 1 `noCollide` |
| `name` | `uint16` | Index into the string table, 0 = none |

Collision is derived, not stored: each part is a prism (ring, `yBase`, `yBase + hEave + hRoof`). Interiors are
out of scope for version 1; buildings are solid.

Heights follow the order in the map-sources survey (to be published) A (tagged height, storeys × regional storey height, ML height,
class default). Every value the builder had to invent is covered by a sentence in the manifest's `rules`
block (the builder already writes one), so a reader can tell data from assumption.

### 4.3 Roads

Polylines split at chunk edges. Per segment: `class` (`1 motorway, 2 primary, 3 secondary, 4 residential,
5 service, 6 track, 7 pedestrian, 8 footway, 9 steps, 10 rail`), `surface` (the terrain enum), `width` (m),
`flags` (bridge, tunnel, covered), `layer` (int8), `name`. Vertices are `(x, z)`; `y` comes from the terrain
except on bridges, which carry `y` per vertex. Roads are already in the terrain's surface raster; the polylines
are for the map, markings and kerbs, bridges, and the route graph.

### 4.4 Walls and barriers

Polylines. Per segment: `class` (`1 city_wall, 2 retaining_wall, 3 wall, 4 fence, 5 hedge, 6 guard_rail,
7 barrier_block, 8 gate`), `height`, `thickness`, `material` (façade enum), `flags`: `blocksMove`,
`blocksShot`, `blocksSight`, `walkableTop` (ramparts), `open` (a gate that is open). Collision: a prism from
the offset polyline. A fortification wide enough to stand on is modelled as a building part with a flat roof
or as a landmark, not as a wall.

Cliffs are terrain. Nav closes cells steeper than a rise over run of 1.0 (45°).

### 4.5 Vegetation

Trees are points: `x`, `z`, `height`, `crownRadius` (`uint8`, 0.25 m steps each), `kind` (`1 broadleaf,
2 conifer, 3 palm, 4 shrub, 5 dead`). Collision: a trunk cylinder that stops movement and shots; the crown
blocks sight only. Ground cover (grass, crops, scrub) is the surface raster; the client scatters instances
from it with a seed derived from the chunk index, so it is not shipped. `season` is a scene-level field.

### 4.6 Water

Polygons with one surface height: `class` (`1 sea, 2 river, 3 lake, 4 canal, 5 pond`), `ySurface`, `depth`
class (`wadeable`, `deep`), `flow` (direction and speed, optional). The terrain under water is the bed where
known, else 1 m below the surface. Tides are not modelled.

### 4.7 Landmarks

Named places a trainee is expected to recognise on the ground and on the map. In the chunk that owns them:
`id`, `kind` (`building, gate, tower, monument, square, bridge, summit, junction`), `pos`, `name` (string
table; `client.json` carries the table in each language present), `model` (optional: file in `models/`,
transform, the building ids it replaces), `colliders` (prisms, when a model is used), `mapLabel`.

A model is glTF binary, metres, +y up, its origin on the ground at `pos`, no embedded cameras or lights,
at most 2 MB and 50 000 triangles each. Models need a licence entry in `attribution.json`.

### 4.8 Nav

| Item | Where | Encoding |
|---|---|---|
| Walk mask | chunk | 250 × 250 bits, 1 m cells: walkable on foot. Built by the pipeline from buildings, walls, water, slope, with the capsule radius already subtracted |
| Vehicle mask | chunk, optional | same, for wheeled movement |
| Links | chunk | Off-mask connections: stairs, ladders, gates; two points and a cost |
| Cover points | chunk | `x, y, z`, facing (2° steps), `low` or `high`: generated at building corners, wall ends and low walls. The engine's threats already consume a list of this kind (`level.coverPoints`) |
| Route graph | `navgraph` | Nodes `(x, z)` and edges (length, class, width) from roads and footways, for routes longer than the local window |

Until masks are shipped the client derives the walk grid itself from solids, slope and water (the level
stream's physics does this at 1 m over the play box). Shipping it matters when the host must bound positions
without running the client's geometry code, and it removes a second implementation of "walkable".

The client runs its grid search in a window of loaded chunks around the action (3 × 3 chunks is 562 500
cells) and uses the route graph beyond it. The host reads the same masks to bound reported positions.

### 4.9 Spawn and objective anchors (`anchors.json`, host only)

```json
{ "id": "a-0412", "kind": "threat_ground", "x": 212.5, "y": 31.2, "z": -88.0, "yaw": 140, "radius": 3,
  "zone": "upper-town", "tags": ["street", "concealed-from:a-0007"], "source": "pipeline" }
```

`kind`: `player_start`, `threat_ground`, `threat_air`, `vehicle`, `observation`, `objective`, `extraction`,
`civilian`, `route` (an ordered list of points with a speed). The pipeline proposes anchors (junctions, roofs
with a view, dead ground); a person adds and removes them. A scenario refers to anchors by id; the host sends
positions to the client only inside commands, when they happen. The engine's `level` contract today exposes
`playerStart`, `objectives`, `extraction` and `enemySpawns` to the client; in the target they are empty on the
client and filled by the director from commands.

Zones (named districts as polygons) are public and live in `client.json`: they are map knowledge, not scenario.

### 4.10 Far

One file for the whole scene, loaded first: terrain at 10 m, and one hull per building (ring simplified to
1 m, top height, façade and roof class). It draws the skyline and distant ground before and beyond the loaded
chunks. No colliders, no nav. It is the only file that describes the whole scene; it holds nothing a person
could not see from a hill.

## 5. Overhead imagery

Two renderings of one picture, produced by the pipeline, so the map in ATAK and the world agree.

| Product | For | Form |
|---|---|---|
| `overhead/tiles/` | The fallback screen's map and any in-game map | 256 px WebP tiles in game coordinates, grid north up. Level 0 = 0.25 m per pixel, each level halves the resolution. Addressed like chunks: tile `(tx, tz)` at level `L` covers `64·2^L` m |
| `overhead/atak/*.kmz` | Real ATAK | Ground overlays: `doc.kml` with a `LatLonBox` and a JPEG (pushed to `/sdcard/atak/grg/`). The pipeline **warps the picture to geographic coordinates**, so the box needs no rotation. Split so no image exceeds 4096 px **(limit inferred; verify on the phone)** |

`overhead.kind` in the manifest:

- `synthetic`: a top-down render of the scene's own data (roofs, roads, surfaces, water, trees). Always
  produced. It matches the 3D world exactly and carries only the attribution of the data it draws.
- `ortho`: a real orthophoto where a licence allows storing and redistributing it (the map-sources survey (to be published) 3.1).
  Optional second layer, with its own attribution entry. Never from the sources listed in 3.2 there.

Today the overlay is a screenshot of the running game taken by a headless browser. That tool retires when the
pipeline writes these files.

## 6. Attribution and licences

`attribution.json`:

```json
{
  "sources": [
    { "id": "osm", "title": "OpenStreetMap", "licence": "ODbL-1.0",
      "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
      "attribution": "© OpenStreetMap contributors",
      "retrieved": "2026-11-15", "version": "planet extract 2026-11-10",
      "layers": ["buildings", "roads", "walls", "water", "landmarks", "navgraph"],
      "shareAlike": true, "modified": true }
  ],
  "layerClass": { "buildings": "odbl", "roads": "odbl", "terrain": "independent", "vegetation": "independent" },
  "credits": ["© OpenStreetMap contributors (ODbL)", "…"],
  "odbl": { "sidecar": "odbl/", "offer": "The OpenStreetMap-derived data of this scene is available under the ODbL on request.", "contact": "…" }
}
```

Rules, from the map-sources survey (to be published) 2.1 (a technical reading, not legal advice; its open question E1 stands):

1. **Every layer is either all-ODbL or all-independent** within a scene (`layerClass`). The builder fails when
   a layer mixes them. This is what keeps terrain, land cover, imagery and our own models outside share-alike.
2. **The building table is ODbL as a whole** as soon as any OSM or Overture footprint is in it, including
   heights fused in from other sources. A scene that must avoid that takes its buildings wholly from a
   permissive source.
3. **The sidecar** (`odbl/`) holds, for each ODbL layer, the extract used (or its exact query, source version
   and date), our edits to it as a diff or a replacement table, the id mapping from scene ids to source ids,
   and a short README. It is what we hand over when asked; for an open scene it is simply published.
4. **Credits** are the exact lines to show. The client shows them on the loading screen and on a credits page
   (the OSMF guideline accepts either for games). `client.json` carries `credits` and nothing else of this file.
5. **Fixed notices** required by a source (the Copernicus notice and liability sentence, the Sentinel line with
   its year, WorldCover, canopy height) are entries like any other and end up in `credits`.
6. A source with a non-commercial or no-redistribution licence cannot be an entry; the builder has a deny list
   (the map-sources survey (to be published) D).

## 7. Versioning

| What | Rule |
|---|---|
| Format | `"format": "opus-scene/1"` in both manifests. The major number changes only when an old reader would misread a file. Additions (a layer, a field at the end of a record, an enum value) keep it and raise `formatMinor` |
| Negotiation | The client's `hello` lists the majors it reads; the host refuses a session it cannot serve with a clear message |
| Scene version | `<date>.<short hash of scene.json>`, for example `2026-11-15.a1b2c3d`. Immutable. A rebuild is a new version beside the old one |
| Files | Named with the first 16 hex digits of their SHA-256; the manifest lists name, full hash and size, and the client verifies the hash |
| Scenarios | A scenario names `scene_id` and a version or a range; anchors are matched by id, so a rebuild that keeps an anchor keeps the scenario valid. The builder reports removed anchors |
| Results | A result row records scene id and version |
| Record ids | Stable across versions for the same source feature, so damage states and scenario references survive a rebuild |

## 8. Size budget

Measured on the Old Quebec single file (2026-11-15): 0.79 km² of data (940 × 840 m), 866 building records,
823 road segments, 67 walls, 365 trees, 146 landmarks, terrain 377 × 337 samples at 2.5 m; **570 KB of JSON
before HTTP compression**, of which about 340 KB is the base64 terrain. So a dense historic centre is roughly
1 100 buildings and 0.7 MB of raw JSON per km². The budget below is for the chunked packaging, after HTTP
compression, with headroom for 1 m terrain, the surface raster and nav masks; the compressed figures are
**estimates** until a chunked build exists.

| Layer | 1 km² | 4 km² | Basis |
|---|---|---|---|
| Terrain, 1 m, heights + surface | 1.5 MB | 6 MB | 251² × 3 bytes per chunk, about 3:1 |
| Buildings | 0.15 MB | 0.6 MB | about 1 100 per km², ≈ 120 bytes each |
| Roads, walls, water | 0.2 MB | 0.8 MB | |
| Vegetation | 0.05 MB | 0.2 MB | 8 bytes a tree |
| Nav masks, links, cover | 0.15 MB | 0.6 MB | |
| Far + route graph | 0.3 MB | 1 MB | |
| Overhead tiles, 0.25 m | 4 MB | 16 MB | fetched only for the map area in view |
| **Chunks + far, total** | **≤ 3 MB** | **≤ 10 MB** | |
| **With overhead** | **≤ 8 MB** | **≤ 28 MB** | |
| Landmark models | ≤ 10 MB per scene | | ≤ 5 models × 2 MB |

Limits the builder enforces:

- A single-file scene ≤ 2 MB of JSON; beyond that it must be chunked.
- One chunk file ≤ 600 KB compressed.
- First playable frame needs `client.json`, `far` and the 9 chunks around the start: ≤ 3 MB.
- Generated geometry, at the lowest quality tier: ≤ 1.5 million triangles and ≤ 300 draw calls in view (merge
  per chunk and material; windows and joints are in the material, not the mesh).
- Client memory for a loaded scene window (5 × 5 chunks): ≤ 400 MB.

## 9. Delivery

- **Load order**: `client.json` → `far` → the start chunk and its ring → play begins → further rings.
- **Window**: full detail and collision within 375 m of the player (the 3 × 3 block, widened to 5 × 5 as it
  arrives); chunks beyond 625 m are released. The far file covers the rest.
- **Grants** (RECKON·OPUS): the client names the chunks it needs; the host grants those within a radius of the
  last bounded position and inside the mission's play area, for a few minutes. In Open OPUS the reference host serves the files directly.
- **The client manifest** (`client.json`) is generated from `scene.json` by a fixed projection: `format`,
  `scene_id`, `version`, `georef`, chunk index (name, hash, size, `spill`, `y` range), `far`, `navgraph`,
  `overhead` index, `zones`, string tables, `season`, `credits`, the content packs the scene's classes need.
  It never contains `anchors`, source ids, `build`, or the sidecar. A test asserts that.

## 10. Open points

| # | Point | Recommendation |
|---|---|---|
| S1 | Is a chunk of footprints a Produced Work or a Derivative Database under ODbL? (the map-sources survey (to be published) E1) | Assume a database, keep the sidecar, and stop treating it as a question that blocks |
| S2 | Interiors | Not in version 1. When needed: a `rooms` layer per building, additive |
| S3 | Chunk size 250 m against 256 m | 250 m on the absolute UTM grid, for the kilometre lines. Power-of-two sizes buy nothing here |
| S4 | Pre-built meshes for cities with open LOD2 models (Montréal) | Through `models/` and the `landmark` flag first; a general mesh layer only if that proves too narrow |
| S5 | The ATAK overlay format and its size limit | Keep KMZ, measure the limit on the Android 14 phone before fixing the split size |
| S6 | Vertical datum per scene or one for all | Per scene, declared, with the undulation constant; a global datum adds a geoid grid for no visible gain |
| S7 | Destructible or changing scenes (damage between missions) | `damage` per building is in the record; a scenario may override it by id through a command. Geometry edits beyond that are a new scene version |
