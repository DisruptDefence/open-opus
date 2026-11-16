# Plan: scene detail — a generated place that reads as the real place

Written 2026-11-16 on branch `detail`. It turns priority 3 of `AGENTS.md` ("a high bar for detail") into work
items that can be executed one at a time without design decisions left open. Every format addition below is
additive to `opus-scene/1` (`formatMinor: 1`); none makes an old reader misread a new file.

Contents: 1 diagnosis · 2 the design that makes it reusable · 3 format additions · 4 engine contracts shared by
the items · 5 budgets · 6 work items · 7 what stays with the planning model · 8 decisions for the maintainer ·
9 sources and licences.

## 1. Diagnosis: why the generated town looks bare

The fixed viewpoints are `engine/tools/viewpoints/old-quebec.json` (five at eye height, one overview). The
"before" set, taken at `q=high`, 1280 × 720, software WebGL, is in `docs/plans/scene-detail-before/`
(`contact-sheet.jpg` shows all six). Retake any of them with `engine/tools/photo.mjs` (`engine/README.md`).

Ranked by what the eye misses first:

1. **Buildings are extruded footprints.** One box per footprint, one tint, a window painted in a tiling texture
   (so windows stretch, ignore floors and are cut by nothing: no door, no ground floor, no depth). 753 of 866
   heights are a rule (10.5 m), so every street is one height. The roof is the footprint shrunk towards its
   centroid: the same blue-grey lump on every house. Cause in data: OpenStreetMap here has `building:levels` on
   126 of 1 046 buildings, `roof:shape` on 39, `height` on 1, a material on 4. Cause in code: `scene/source.js`
   picks roof, façade and palette from `id % n`; `level/build.js` draws walls as one quad per edge.
2. **The ground is a raster.** Roads and squares are burnt into a 1 m class raster and drawn per 2.5 m terrain
   cell, so every street edge is a staircase of squares; there is no kerb, no sidewalk, no marking, no stair
   (100 `highway=steps` ways are drawn as flat paving). The default class is paving, so the cliff between the
   upper and the lower town, the identity of the place, is drawn as white paving slabs on a slope.
3. **Nothing at the scale of a person.** No lamp, bench, rail, sign, cannon, flagpole: zero props. The Terrasse
   Dufferin is a bare plane with no railing. Trees are 365 identical blobs.
4. **Landmarks are boxes.** The Château Frontenac is its outline extruded *plus* its 9 building parts inside it
   (the reader does not skip an outline that has parts, and ignores `min_height`); the Price Building is a brick
   box; the gates are points, and the gate buildings block their own road.
5. **Walls are slabs.** The fortification is a 6 m prism above whichever side is higher, with no parapet or
   crenel, floating over slopes.
6. **Light is flat by default.** 10:00 with haze 0.4 puts the sun behind most views and greys the far town.
   Shadows, sky and fog work; ambient occlusion is off at `low`.

What is *not* the problem: the renderer, the materials and the lighting model are those of the hand-built level
the scene is compared with. What a generated scene lacks is geometry and dressing, and the data to choose them.

Measured before (2026-11-16, this machine, software WebGL):

| | 1 street | 2 square | 3 gate | 4 terrace | 5 lower | 6 overview |
|---|---|---|---|---|---|---|
| draw calls, `q=high` | 214 | 204 | 90 | 154 | 176 | 247 |
| triangles, `q=high` | 281 k | 317 k | 114 k | 210 k | 296 k | 389 k |
| frame ms, `q=high` 1280×720 | 706 | 1289 | 1172 | 850 | 929 | 1167 |
| frame ms, `q=low` 960×540 | 289 | 246 | 187 | 216 | 231 | 257 |

Draw calls and triangles at `q=low`: at most 182 and 235 k. Scene file 570 194 bytes; load to ready 6.3 s at
`q=high`, 3.6 s at `q=low`. `engine/tools/play.mjs old-quebec` completes.

## 2. The design: one engine, one builder, places as data

Two requirements shape everything below: **the engine is built once and reused**, and **the next place, anywhere
in Canada, reuses as much as possible**. So:

```
places/<id>.json        a place: name, anchor, box, sources, style pack, optional enrichers        DATA
styles/<name>.json      a style pack: what buildings, streets and trees look like in a region      DATA
tools/build-scene.py    the builder: place + style + open data -> scenes/<id>.json                  CODE, no place in it
tools/scene_builder/    its modules (one per layer), standard library only                          CODE, no place in it
engine/src/gen/         generators: records -> triangles (roofs, façades, ground, props)            CODE, no place in it
scenes/<id>.json        the scene: semantic records + the resolved client part of the style         DATA
```

Rules that keep it so (each is checked by a test named in the items):

- No file under `engine/` or `tools/` contains the name of a place, a street, a landmark, a city or a province,
  or a coordinate of one. `tools/scene_builder/test_no_place.py` greps for the ids and names of every file in
  `places/` and fails on a hit outside `places/`, `styles/`, `scenes/`, `docs/` and `engine/tools/viewpoints/`.
- The builder takes `--place places/<id>.json`. UTM zone, band and convergence are computed from the anchor.
- **Canada-wide sources first**, behind one interface, so a place with nothing but them still builds:
  OpenStreetMap (Overpass) for everything vector, NRCan HRDEM mosaic WCS for terrain (`dtm`) and for measured
  building and tree heights (`dsm − dtm`). Where HRDEM has no cover the builder falls back to tagged and ruled
  heights and says so in `rules`. City or provincial data are **enrichers**: optional entries in the place
  file, each of a known `kind` (`trees`, later `footprints`, `dates`), each with its licence, each only adding
  attributes to a layer or replacing a non-ODbL layer whole (section 6 of the scene format: a layer is all-ODbL
  or all-independent).
- **What varies by region is the style pack**, not code: roof shapes and pitches, façade materials and colours,
  storey heights, window proportions, ground-floor treatment, street furniture kinds and spacing, tree species,
  road surfaces. `styles/canada.json` is the default; a regional pack names `"extends": "canada"` and overrides
  keys (deep merge, lists replace). Packs planned: `quebec-historic` (this plan), `atlantic-wood` (item 11);
  `prairie-town`, `west-coast`, `arctic` are data to add later, not work in this plan.
- The builder **resolves** the style into records (each building gets its roof shape, façade class, palette
  index, levels) and copies the pack's *client part* (colours, proportions, prop variants) into the scene as
  `style`. The engine never sees a pack name and holds no regional table; without a `style` block it uses
  neutral defaults (`engine/src/gen/style.js`, equal to the client part of `styles/canada.json`).
- **The prop kit** (`engine/src/gen/props.js`) is a table of procedural models by kind (`lamp_lantern`,
  `lamp_cobra`, `bench_slat`, `bollard_iron`, …). A style pack chooses which kind a data feature becomes.
- Proof (item 11): a second place of different character is built with a new place file and style pack and
  zero code change.

### 2.1 Place file

```json
{
  "id": "old-quebec", "name": "Vieux-Québec",
  "anchor": { "lat": 46.8118, "lon": -71.2068 },
  "play": { "halfWidth": 350, "halfHeight": 300 }, "margin": 120,
  "terrain": { "source": "hrdem", "cell": 2.5 },
  "vertical": { "datum": "CGVD2013", "geoid_undulation": -27.6 },
  "style": "quebec-historic", "season": "summer",
  "ambience": { "tod": 16.5, "day": 200, "haze": 0.3, "cloud": 0.35, "wet": 0 },
  "enrichers": [
    { "kind": "trees", "title": "Arbres répertoriés, Ville de Québec", "licence": "CC-BY-4.0",
      "licenceUrl": "https://www.donneesquebec.ca/recherche/dataset/vque_26",
      "attribution": "Ville de Québec, Arbres répertoriés (CC BY 4.0)",
      "ckan": "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=vque_26", "format": "CSV",
      "fields": { "lat": "LATITUDE", "lon": "LONGITUDE", "species": "NOM_LATIN", "diameter_cm": "DIAMETRE" } }
  ]
}
```

The anchor is snapped to a whole UTM metre as today; for this file the result must stay 331641 E, 5186615 N,
zone 19 (a test asserts it), so existing scenarios keep their coordinates.

### 2.2 Style pack

Builder part (never leaves the builder) and client part (copied to the scene as `style`, marked ▸):

```json
{
  "id": "quebec-historic", "extends": "canada",
  "storeyHeight": { "default": 3.1, "ground_commercial": 3.8, "min": 2.6, "max": 4.2 },
  "buildings": [
    { "when": { "building": ["church", "cathedral", "chapel"] },
      "roof": { "gabled": 1 }, "roofMat": { "copper": 2, "metal_seam": 1 }, "facade": { "stone_ashlar": 1 } },
    { "when": { "pitch": "steep", "levelsMin": 3, "attached": true },
      "roof": { "mansard": 3, "gabled": 2 }, "roofMat": { "metal_seam": 4, "copper": 1 },
      "facade": { "stone_ashlar": 3, "stucco": 3, "brick": 2 } },
    { "when": { "pitch": "steep" },
      "roof": { "gabled": 4, "mansard": 1, "hipped": 1 }, "roofMat": { "metal_seam": 1 },
      "facade": { "stone_rubble": 2, "stucco": 3, "stone_ashlar": 1 } },
    { "when": { "pitch": "flat" }, "roof": { "flat": 1 }, "roofMat": { "membrane": 1 },
      "facade": { "brick": 2, "stone_ashlar": 1, "stucco": 1 } },
    { "when": {}, "roof": { "mansard": 2, "gabled": 2, "flat": 1 }, "roofMat": { "metal_seam": 1 },
      "facade": { "stucco": 2, "stone_ashlar": 1, "brick": 1 } }
  ],
  "roofPitchDeg": { "gabled": 45, "hipped": 32, "mansard": 70, "skillion": 15, "pyramidal": 50 },
  "street": {
    "sidewalk": { "width": 1.6, "kerb": 0.14, "surface": "paving",
                  "on": ["primary", "secondary", "tertiary", "residential", "unclassified"] },
    "surface": { "pedestrian": "cobble", "living_street": "cobble", "footway": "paving", "steps": "rock",
                 "residential": "asphalt", "service": "asphalt", "path": "gravel" },
    "lamps": { "kind": "lamp_lantern", "spacing": 28, "offset": 0.6, "stagger": true,
               "on": ["residential", "living_street", "pedestrian", "tertiary", "secondary", "primary"] },
    "bollards": { "kind": "bollard_iron", "at": "pedestrian_ends", "gap": 1.6 }
  },
  "props": { "amenity=bench": "bench_slat", "highway=street_lamp": "lamp_lantern", "historic=cannon": "cannon",
             "man_made=flagpole": "flagpole", "emergency=fire_hydrant": "hydrant", "amenity=waste_basket": "bin",
             "historic=monument": "plinth", "historic=memorial": "plinth", "amenity=fountain": "fountain",
             "amenity=post_box": "post_box", "highway=stop": "sign_stop", "amenity=bicycle_parking": "bike_rack",
             "barrier=bollard": "bollard_iron" },
  "trees": { "default": { "kind": "broadleaf", "form": "round" },
             "genus": { "Ulmus": { "form": "vase" }, "Acer": { "form": "round" }, "Picea": { "kind": "conifer" },
                        "Pinus": { "kind": "conifer" }, "Thuja": { "kind": "conifer", "form": "column" } } },
  "walls": { "city_wall": { "material": "stone_ashlar", "thickness": 2.4, "freeHeight": 5, "parapet": 1.4, "crenels": true },
             "retaining_wall": { "material": "stone_rubble", "thickness": 0.7, "parapet": 1.0 },
             "wall": { "material": "stone_ashlar", "thickness": 0.45, "freeHeight": 2.0 },
             "fence": { "material": "metal_panel", "thickness": 0.08, "freeHeight": 1.1, "rail": "rail_iron" } },
  "client": {
    "palettes": { "stone_ashlar": ["#9c978c", "#a8a294", "#8f8a80", "#b1a78f"],
                  "stone_rubble": ["#8c8477", "#9a8f7c", "#7f7a70"],
                  "stucco": ["#e9e3d3", "#d9cdb4", "#cfc6b8", "#e2d2a8", "#c9b79a", "#b9c0bd", "#d8b9a0"],
                  "brick": ["#8a4b3a", "#9a5a40", "#7a4436", "#a56a4c"], "wood_siding": ["#d8d2c2", "#b9b3a2"] },
    "roofs": { "metal_seam": ["#9aa0a3", "#7d8589", "#b7bcbd", "#7a2f27", "#2e3030"], "copper": ["#6f9a84", "#5f8a78"],
               "slate": ["#4a4d52"], "shingle": ["#55504a"], "membrane": ["#3a3b3c"] },
    "trim": ["#e8e4da", "#d9d2c0", "#8f8a80"], "frames": ["#f0ede4", "#f0ede4", "#2f4a3a", "#5a2a24", "#1f2326"],
    "doors": ["#6d2a22", "#27462f", "#243a5a", "#1f2326", "#6b4a2e"], "awnings": ["#7a2f27", "#27462f", "#e8e4da", "#243a5a"],
    "window": { "bay": [2.5, 3.1], "width": 1.05, "height": 1.75, "sill": 0.85, "reveal": 0.18, "shutters": 0.12,
                "panes": [2, 4] },
    "groundFloor": { "doorWidth": 1.05, "doorHeight": 2.25, "shopPier": 0.45, "shopSill": 0.5, "fascia": 0.55, "awning": 0.4 },
    "cornice": { "depth": 0.28, "height": 0.32 }, "plinth": { "height": 0.6, "depth": 0.05 },
    "dormers": { "mansard": 1.0, "gabled": 0.5, "width": 1.1, "height": 1.5 },
    "chimneys": { "perBuilding": [1, 2], "width": 0.9, "depth": 0.6, "above": 1.1 },
    "kerb": 0.14, "season": "summer"
  }
}
```

**`client.bayWindows`** (added with wall variation, `gen/wallvar.js`, `materials/facades.js`): the windows the far façade
draws in its material, as data. `types` names each type with its `shape` (`rect`, `segmental`, `round`, `circle`,
`blind` for a bricked-up opening, `shop`), size (`w`, `h`, `sill`), pane `grid` `[columns, rows]`, a meeting `rail`,
`muntin` width, `surround`, `lintel`, `sillProj`, a `hood` (`gable`, `arc`, `cornice`) and the chance of `shutters`.
`classes` gives the weights of the types for the `ground`, `first` and `upper` storeys (a class the table lacks borrows
the one before); `states` the weights of what is behind the glass (`clear`, `curtain`, `blind`, `lit`, `dark`,
`bright`); `odd` the chance that a bay differs from the rest of its storey. `shutterColors` and `glass` are colour
lists; sash and dressing colours are `frames` and `trim`. A regional pack names only what it changes (lists replace,
objects merge). Up to 16 types. A new place adds or changes window types by editing this table; no engine code.

`when` keys, all optional, all must hold: `building` (the OSM value, after the worship/hotel substitution the
builder already does), `use`, `areaMin`, `areaMax` (m²), `levelsMin`, `levelsMax`, `attached` (shares a wall,
3.1 `blind` not empty), `pitch` (`flat` | `low` | `steep`, measured, 6.2; absent when not measured, and then a
rule that asks for `pitch` does not match). The first rule that matches is used. Weighted choices are made with
a random stream seeded by the building `id`, so a rebuild draws the same town.

## 3. Format additions (`formatMinor: 1`)

`docs/SCENE-FORMAT.md` is updated in the same commit as the builder writes each one (items say which). Single-
file key first, the chunked field name in brackets. An old reader ignores every one of them.

### 3.1 Buildings (4.2)

| Key | Type | Meaning |
|---|---|---|
| `id` [`id`] | uint32 | FNV-1a 32 of `"<osm type>/<osm id>/<ring index>"`; on a clash, +1 until free, in ascending source-id order. Never 0 |
| `h` | m | unchanged: top of roof above `g`. `hs` gains the value `"measured"` (format `heightSource` 0) |
| `rh` [`hRoof`] | m | roof height above the eave; now always written (was: only when tagged) |
| `rs` [`roofShape`] | enum 4.2 | resolved roof shape; `roof` (the raw tag) stays when tagged |
| `rd` [`roofDir`] | 0–179, or 255 | ridge direction, degrees from grid north (not 2° steps in the single file); 255 = along the longest side |
| `rmt` [`roofMat`] | enum 4.2 | |
| `rp` [`roofPalette`] | uint8 | index into `style.roofs[<roofMat name>]`; when `rc` (tagged colour) is present the reader uses `rc` instead |
| `fa` [`facade`] | enum 4.2 | |
| `pal` [`palette`] | uint8 | index into `style.palettes[<facade name>]` |
| `use` [`use`] | enum 4.2 | |
| `lv` [`levels`] | uint8 | storeys below the eave; now always written |
| `mh` | m | unchanged (min height of a part); the reader now honours it |
| `blind` | int[] | edges with no openings: edge `i` runs from ring vertex `i` to `i + 1` (wrapping). A party wall or a wall within 0.6 m of another building |
| `front` | int[] | edges that face a street: doors and shopfronts go here |
| `gf` [`groundFloor`] | 0 \| 1 \| 2 | 0 plain, 1 shopfronts on `front` edges, 2 large doors (garage, coach house) |
| `pass` [`passages`] | [[x1, z1, x2, z2, w, hgt], …] | a way through the building at ground level: centre line, width, clear height. The reader opens an arch there, in drawing and in collision |
| `parts` | 1 | unchanged in the file; **the reader now skips a building with `parts: 1`** (its parts draw it) |

```json
{ "id": 2890417532, "r": [12.1, -40.3, 21.9, -39.8, 22.3, -48.9, 12.4, -49.5], "g": 52.1, "h": 14.2, "hs": "measured",
  "rh": 4.1, "rs": 3, "rd": 255, "rmt": 1, "rp": 0, "fa": 1, "pal": 2, "use": 2, "lv": 3,
  "blind": [1, 3], "front": [0], "gf": 1, "k": "retail" }
```

### 3.2 Roads (4.3), new optional keys on a road record

| Key | Meaning |
|---|---|
| `sw` | sidewalks to draw: `"both"`, `"left"`, `"right"`, `"no"` (left and right of the direction of the vertices). Resolved by the builder from `sidewalk=*` and the style |
| `sf` | resolved surface class (terrain enum 4.1), so the reader no longer maps OSM words. `s` stays |
| `sc`, `hr` | steps only: step count (tag, else `round(rise / 0.17)`, at least 2), handrail `0` none `1` both sides `2` centre |
| `lit` | 1 when tagged `lit=yes` |
| `mk` | markings: `1` centre line (`primary`, `secondary`, `tertiary` with asphalt) |

New layer `crossings`: `[[x, z, bearingDeg, width], …]` from `highway=crossing` nodes on a drawn road; bearing is
the road's direction there, width the road's.

### 3.3 Walls (4.4), new optional keys

| Key | Meaning |
|---|---|
| `t` | thickness, m (was a reader table) |
| `m` | material, façade enum |
| `hp` | parapet: metres the top stands above the **higher** ground beside the wall. Present on a wall that holds ground back (builder rule 6.6). When present the reader uses `top = higher ground + hp`; otherwise `top = ground + h` as today |
| `cr` | 1 = crenellated top |
| `rail` | a prop kind: the record is drawn as posts and rails, not as a solid (fences, handrails). It still collides as a thin wall |

### 3.4 Trees (4.5)

A tree stays an array and grows at the end: `[x, z, height, crownRadius, kind, form]`, `kind` the enum of 4.5,
`form` `0 round, 1 vase, 2 column, 3 cone, 4 spreading`. An old reader takes `[x, z]` and invents the rest, as
before. `season` at scene level (`"summer" | "autumn" | "winter" | "spring"`), as 4.5 already says.

### 3.5 Props (new layer, section 4.11 of the format)

```json
"props": { "kinds": ["lamp_lantern", "bench_slat", "cannon"],
           "items": [[0, 101.2, -43.0, 90, 0, 0], [2, 180.4, -60.1, 135, 0, 1]] }
```

An item is `[kind index, x, z, yawDeg, variant, source]`; `yaw` is the direction the prop faces, degrees
clockwise from grid north; `source` `0` = a mapped feature, `1` = placed by a rule of the style pack (so data
and assumption can be told apart, as `hs` does for heights). An unknown kind is skipped by the reader. In a
chunk: fixed records `kind uint8, x, z float32, yaw uint8 (2° steps), variant uint8, flags uint8`.
Collision is derived from the kind (4 below).

### 3.6 Manifest

| Key | Meaning |
|---|---|
| `formatMinor` | `1` |
| `style` | the client part of the style pack (2.2), verbatim. Optional; the reader has neutral defaults |
| `season` | as 3.4 |
| `ambience` | `{ tod, day, haze, cloud, wet }`: the light the place is best seen in. A host's own switches win |
| `sources[]` | gains one entry per enricher and per use of the surface model; each entry has `licence`, `licenceUrl`, `attribution`, `layers` |
| `rules` | gains one sentence per new rule the builder applies |

## 4. Engine contracts the items share

**Built by item 3 (2026-11-16) and fixed.** This section says what is in the code; where an earlier draft of it
differed, the list at its end says what changed and why. Each generator file's header repeats its own contract
(inputs, outputs, units, winding, UV, soups, group, budget), so an item is done by filling the body of its file.

`engine/src/gen/` is a **pure** module (layer 0 of `docs/ARCHITECTURE.md`, enforced by `test/imports.test.js`):

| File | What | Owner |
|---|---|---|
| `soup.js` | triangle soups keyed `"<material>\|<flags>"`; `tri`, `triN` (normals given, for round things), `quad`, `fan`, `cap` (any ring with holes), `frame`, `rect`, `slab`, `box`, `prism`, `linear`, `shade`, `mixTint`, `rng`, `seedOf` | item 3, frozen |
| `poly.js` | `signedArea`, `centroid`, `pointInRing`, `bbox`, `obb`, `clip`, `triangulate` (built); `inset` (throws until built) | item 3; `inset` by item 4 |
| `cells.js` | `cellBoxes`, `cellIndex`, `boxDistance`, `clipLine`, `clipSoups` | item 3, frozen |
| `style.js` | `DEFAULT_STYLE`, `resolveStyle`, `parseColor`, `paletteColor`, the format's class names, and the **material slots** (`WALL_SOUP`, `FACADE_FAR_SOUP`, `ROOF_SOUP`, `ROOF_TINT_SOUP`, `STRUCTURE_SOUP`, `GROUND_SOUP`, `SOUP.*`) | item 3; the slot tables are edited by item 5 only, with the materials |
| `mesher.js` | the registry: which generator draws which record into which group; `cellSoups(cell, group, env)`, `chunkEnv`, `chunkLift`, `roofInfoOf`, `piecesOf`, `wallSolids`, `propSolid` | item 3, frozen |
| `roof.js` | `roof` | item 4 (round roofs: item 9) |
| `facade.js` | `bays`, `facadeFar`, `facadeNear` | item 5 |
| `ground.js` | `drape`, `roadRibbons`, `steps`, `crossing`, `liftRaster` | item 6 |
| `structures.js`, `passage.js` | `wallRings`, `wall`; `passagePieces`, `passageArch` | item 7 |
| `props.js`, `trees.js` | `PROP_KIT`; `tree` | item 8 |

Every generator writes into soups and nothing else. `level/build.js` turns soups into meshes; `scene/install.js`
turns the same functions' answers into collision. No two items share a file.

**Soup flags** (after the bar, any order): `t` triplanar (uv not read), `v` vertex colours (a linear `[r, g, b]`
per triangle), `d` drawn from both sides, `n` casts no shadow (flat things lying on the ground). A material name
the library lacks is drawn with the library's fallback and one warning, so a generator may land before its material.

**Material slots.** A generator never writes a material name: it takes its soup key from `style.js`
(`WALL_SOUP[b.facade]`, `ROOF_SOUP[b.roofMat]`, `GROUND_SOUP[road.surface]`, `SOUP.trim`, `SOUP.window`, …), so two
generators that meet on one building agree. Today the tables name the materials that exist (`roof_zinc`,
`facade_stone`, …); item 5 adds `roof_metal`, `roof_slate`, `facade_brick`, `window`, `door`, `paint_white`,
`glass_lamp`, `tarp` to `materials/outdoor.js` and changes the tables in the same commit. Colours in tinted soups
are linear: `b.tint`, `b.roofColor`, or `paletteColor(style.trim, k)`.

**Coordinates.** Game metres, `y` up, `z` south. A ring is `[x0, z0, x1, z1, …]`, either winding; edge `i` runs
from vertex `i` to `i + 1`. A bearing of `d` degrees is the direction `(sin d, −cos d)`. A `yaw` is radians about
`+y` as three.js turns: 0 faces grid north, positive towards the west (the data's degrees clockwise from north,
negated); a thing with that yaw faces `(−sin yaw, −cos yaw)` and its right hand is `(cos yaw, −sin yaw)`.
**Winding:** counter-clockwise seen from the front; `soup.js` computes normals from it.

**Decoded records** (what `scene/source.js` hands on, single file and package alike; every field always present):

```
building  { id, ring, holes, yBase, yMin (= yBase + mh), hEave, hRoof, levels, roofShape, roofDir (0-179 or 255), roofMat,
            roofColor (linear rgb or null), facade, tint (linear rgb), use, blind:Set, front:Set, groundFloor,
            passages:[{x1,z1,x2,z2,w,h}], name, kind, part, heightSource }
road      { pts, cls (4.3 enum), kind (the source's word), surface (4.1 enum), width, sidewalk ('both'|'left'|'right'|'no'),
            steps:{count,handrail}|null, lit, marking, bridge, tunnel, name, s0, len }                    a PIECE (below)
wall      { pts, cls, kind, height, parapet|null, thickness, material, crenels, rail|null, name, s0, len }   a PIECE (below)
tree      { x, z, height, crownRadius, kind, form }
prop      { kind (string), x, z, yaw, variant, source }
crossing  { x, z, yaw, width }
chunk     + roads, props, crossings, cells; manifest + formatMinor, style (resolved), season, ambience (or null)
```

Defaults for a file without the new keys are the rules the engine drew with before (roof from `roof` or the
height, façade and tint from the record's number in file order, trees from their coordinates), so an old file
draws as it did. Two rules depend on `formatMinor`: a building with `parts: 1` is skipped **only when
`formatMinor >= 1`** (an older file's parts carry no heights of their own, and its outline is still what is
drawn); `mh` is honoured always. `tint` is `style.palettes[<facade>][pal]` when `pal` is present; `roofColor` is
`rc` when it parses, else `style.roofs[<roofMat>][rp]`, else `null`. A `steps` road without `sc` gets
`round(rise / 0.17)`, at least 2, from the terrain. An unknown prop kind is kept as a record and skipped by the
mesher with one warning.

**Cells.** A chunk is cut into 4 × 4 cells of 62.5 m; `chunk.cells[k]` is `{ i, j, index, x0, z0, x1, z1,
buildings, walls, trees, roads, props, crossings }`, the lists holding the records themselves.

- A building, a tree and a prop are in the one cell of their bounding-box centre (clamped into the chunk).
- A **wall** is cut exactly at cell edges; each piece is in one cell. `s0` is where the piece starts along the
  whole mapped line, `len` the whole line's length.
- A **road** piece is the part of the way inside the cell's box grown by `width / 2 + 3` m; a **crossing** is in
  every cell its square of `width + 3` m touches. The generator draws the whole piece, and the mesher cuts what it
  wrote to the cell's box (`cells.js clipSoups`: triangles cut by the four vertical planes, normals and uv
  carried). The neighbouring cell draws the same way from its own piece and keeps its own side. **So everything
  that repeats along a line (dashes, treads, merlons, posts) is placed by `s0 + distance`, never from the piece's
  own start**: then two cells, and two chunks, meet with no gap, no overlap and no step in the pattern.

**The three groups and levels of detail.**

| Group | Holds | Meshes | Shown |
|---|---|---|---|
| `base` | roofs, passage arches, solid walls with their crenels | one per material per **chunk** | while the chunk is live |
| `far` | flat façades with their plinth, simple trees (`lod` 0) | one per material per **chunk**; a cell is left out by rewriting the mesh's index | while the cell's `near` is not showing |
| `near` | modelled façades with their plinth, doors, shopfronts, cornices, dormers, chimneys; full trees (`lod` 1); rails; road ribbons, kerbs, steps, markings, crossings; props | one per material per **cell** | built when the camera is within `R` (nearest first, one cell a frame; all of them at once in `preload` and `photo`); hidden beyond `R + 10`; disposed beyond `R + 80` |

`far` and `near` are two pictures of the same things and are never drawn together; `base` has no second picture.
`R` by quality: `test` 0 (never), `low` 45 m, `medium` 85 m, `high` 140 m, `ultra` 220 m; the switch
`detail=<m>` overrides it. The distance is on the plan from the camera (the photo pose in photo mode, else the
player) to the cell's box (`level/detail.js`). A live chunk therefore costs the draw calls it cost before plus
one for the plinths, however many cells it has; only cells within `R` add calls.

**Generator signatures** (`groundAt(x, z)` is the chunk's own height tile, sidewalks included, held at the tile's
edge beyond it; `tile` is that tile: `nx, nz, cell, minX, minZ, data, height(), baseHeight()`):

```js
// gen/roof.js                                                                                  group
roof(soups, b, style) -> { slots: [{ ox, oz, ex, ez, len, y, slope, edge }], ridge: [{ x, z, y }], parapet }   // base
// gen/facade.js
bays(len, style, seed) -> { n, width, margin, start }          // the one bay rule both use
facadeFar(soups, piece, groundAt, style, roofInfo)             // far: one quad per edge, uv = (bays, levels), and the plinth
facadeNear(soups, piece, groundAt, style, roofInfo)            // near: openings, doors, shopfronts, cornice, plinth; dormers and chimneys with piece 0
// gen/passage.js
passagePieces(b) -> [piece]                                    // far, near and collision. [b] itself without a passage; else copies of b
                                                               // with ring, holes, yMin, blind, front (renumbered for the piece's ring), piece
passageArch(soups, b, p, groundAt, style)                      // base: the inside of one passage
// gen/structures.js
wallRings(wall, groundAt) -> [{ ring, yBase, yTop }]           // collision, and what wall() must draw
wall(soups, wall, groundAt, style)                             // base; near when wall.rail
// gen/ground.js
drape(tri3, tile) -> [[[x, y, z] x 3], ...]                    // a plan triangle cut along the terrain's own triangles
roadRibbons(soups, road, tile, style)                          // near, cut to the cell by the mesher
steps(soups, road, groundAt, style)                            // near, cut to the cell; called instead of roadRibbons when road.steps
crossing(soups, c, tile, style)                                // near, cut to the cell
liftRaster(roads, x0, z0, n, style) -> Uint8Array(n * n) | null    // centimetres per 1 m cell: sidewalks. null = none
// gen/props.js
PROP_KIT[kind] = { build(soups, x, y, z, yaw, variant, style), collider: null | { r, h, nav } | { hw, hd, h, nav } }   // near and collision
// gen/trees.js
tree(soups, t, y, season, lod)                                 // far (lod 0), near (lod 1)
```

The mesher never passes a road with `tunnel` or `bridge`. `roofInfo` is what `roof()` returned for the whole
building (computed once and kept); `parapet` is the height the façade raises its wall above the eave.

**Collision is what is drawn** (`scene/install.js`): the ground is the chunk's heights plus `liftRaster` in one
height tile (`terrain/heightfield.js createGrid({ …, lift, liftCell, liftN })`: `height()` with the lift,
`baseHeight()` without), so the player, the nav grid, the props and the drawn sidewalk agree; buildings are one
prism per piece of `passagePieces(b)`, from `yMin` when it is above the ground (one walks under it) and from 3 m
below the ground otherwise; walls are one prism per ring of `wallRings` (a rail collides as its thin ring);
props are `PROP_KIT[kind].collider` turned with the prop's yaw, `noNav` unless `nav` is true, so a lamp post stops
a walker and a bullet but does not close a nav cell; trees are their trunk. Stairs stay the sloped ground they are
in the terrain; the drawn treads stay within one riser of it. A kerb is lower than a step (`STEP = 0.45`).

**What changed from the first draft of this section, and why** (found while building it):

1. `base` and `far` are one mesh per material per chunk, not per cell: per-cell meshes would have cost up to 16
   times the draw calls for a few thousand triangles. A `far` mesh leaves a cell out through its index buffer.
2. Simple trees and plinths moved from `base` to `far`/`near`: a thing that has a near picture must be hidden
   when that picture shows, and `base` is never hidden.
3. Roads and crossings are cut per **cell**, with a margin, and the **mesher** clips what was drawn to the cell's
   box. The draft clipped polylines to the chunk plus 2 m and left the clipping to the generator: 2 m is less
   than half a wide street with its sidewalk, and a road in one cell only would have been modelled or not as a
   whole. Walls are cut per cell exactly. Pieces carry `s0` and `len`.
4. `passagePieces` returns whole building copies with `front` renumbered as well as `blind` (edge numbers change
   when a ring is cut); the arch is `passageArch` in `passage.js`, not a function of `structures.js`.
5. `roof()` also returns `parapet`; `facadeFar` takes `style` and `roofInfo` (it needs the bay rule and the parapet).
6. A prop collider may be a box (`hw`, `hd`), turned with the prop: a bench is not a square. `nav` is stated per
   kind instead of derived from the radius.
7. `liftRaster` may return `null`; `crossing` takes `style`; a road carries `kind` (the 4.3 classes cannot tell a
   living street from a residential one) and `tunnel`.
8. A crossing and a prop carry `yaw` (radians, the engine's turn), not a bearing in degrees.
9. `poly.js` is built except `inset`: the mesher itself needs triangulation without three.js.
10. `parts: 1` is skipped from `formatMinor >= 1` only (3.1 says "now"): the published scene has five such
    outlines whose parts carry no measured heights, and it must draw as before until item 2 regenerates it.
11. The client part of a style pack (2.2) needs one more key, `sidewalk: { width, surface }`: the engine draws
    and raises sidewalks and cannot read the builder part. `DEFAULT_STYLE` has it (1.6 m, concrete); the packs of
    items 1 and 6 should carry it in `client`.

## 5. Budgets (stated now, measured by every item)

| Budget | Limit | Before |
|---|---|---|
| Scene file, single | ≤ 1.5 MB (the format's limit is 2 MB; beyond it the chunked packaging is needed, which no item here builds) | 0.57 MB |
| Triangles in a frame at `q=low`, any fixed view | ≤ 700 k | ≤ 235 k |
| Draw calls in a frame at `q=low`, any fixed view | ≤ 300 | ≤ 182 |
| Frame time at `q=low`, 960 × 540, software WebGL, mean of the five street views | ≤ 1.3 × before | 234 ms |
| Load to `ready()` at `q=low` | ≤ 1.5 × before | 3.6 s |
| Building a `near` cell | ≤ 30 ms on a desktop, one cell a frame | — |
| `node --test` in `engine/` | green, ≤ 10 s | 49 tests, 2 s |

An item that cannot meet a budget stops and reports the measurement; it does not raise the limit.

## 6. Work items

Order is by visual return. `→` marks what must be merged first. Items with no arrow between them and no shared
file may run in parallel. Every item: its own branch and worktree from `detail`; small commits; `cd engine &&
node --test` green; `engine/tools/play.mjs old-quebec` exits 0; the before/after pair of the named viewpoints
taken with `engine/tools/photo.mjs` at `q=high` **and looked at**; the budget table measured at `q=low`; the
scene regenerated by the builder (`--offline --cache`), never edited by hand; documents in the same commit.

| # | Item | Needs | Owns | Model |
|---|---|---|---|---|
| 0 | Photo mode, frame statistics, the picture tool, `gen/soup.js` | — | done on `detail` | — |
| 1 | The builder takes a place and a style | 0 | `tools/**`, `places/`, `styles/` | Sonnet |
| 2 | Buildings in data: measured heights, roofs, façades, edges | 1 | `tools/scene_builder/buildings.py`, `styles/*` (building keys) | Sonnet |
| 3 | The reader and the mesher: records, cells, levels of detail, collision | 0 | done on `mesher` (section 4): `engine/src/scene/*`, `engine/src/level/*`, `engine/src/terrain/heightfield.js`, `gen/soup.js`, `poly.js`, `cells.js`, `style.js`, `mesher.js`, a placeholder and a contract test for every other `gen/*.js` | Planning model (engine internals; every later item builds on it) |
| 4 | Roofs | 3 | `engine/src/gen/roof.js`, `inset` in `gen/poly.js`, `test/roof.test.js` | Sonnet |
| 5 | Façades | 3 (4 for dormers) | `engine/src/gen/facade.js`, `engine/src/materials/outdoor.js`, the slot tables of `gen/style.js`, `test/facade.test.js` | Sonnet; colours and proportions judged by the planning model |
| 6 | Ground: surfaces, kerbs, sidewalks, stairs, crossings | 1, 3 | `tools/scene_builder/ground.py`, `engine/src/gen/ground.js`, `test/ground.test.js` | Sonnet |
| 7 | Walls, crenels, gates as arches | 1, 3 | `tools/scene_builder/walls.py`, `engine/src/gen/structures.js`, `passage.js`, `test/structures.test.js` | Sonnet |
| 8 | Dressing: props and trees | 1, 3 | `tools/scene_builder/props.py`, `trees.py`, `engine/src/gen/props.js`, `trees.js`, `test/props.test.js` | Sonnet; the look of each prop judged by the planning model |
| 9 | Landmarks from building parts | 2, 4 | `tools/scene_builder/parts.py`, additions to `roof.js` (cone, dome, onion-free), `test/parts.test.js` | Sonnet |
| 10 | Light and air | 3 | `engine/src/core/atmosphere.js`, the `ambience` reader in `engine/src/world/engine.js` (three lines), `places/*` | Planning model (judgement), Sonnet for the wiring |
| 11 | Proof of reuse: a second place, zero code change | 1–9 | `places/lunenburg.json`, `styles/atlantic-wood.json`, `engine/tools/viewpoints/lunenburg.json`, `scenes/lunenburg.json` | Sonnet; the verdict "zero code change" checked by `git diff --stat` |

**Status, 2026-11-16, evening.** Merged to `main`: items 0, 1, 2. Being executed: item 3 (branch `mesher`). Not started: 4 to 11.

### Item 1 — The builder takes a place and a style

**Goal.** `python3 tools/build-scene.py --place places/old-quebec.json --cache DIR [--offline]` writes the same
kind of scene as today from a place file and a style pack, with no place in the code.

**Do.**

1. Split `tools/build-scene.py` into a package `tools/scene_builder/` (standard library only), keeping the
   command: `geo.py` (UTM, MGRS, Lambert: moved unchanged, zone from the anchor: `zone = floor((lon + 180) / 6) + 1`,
   band from latitude), `fetch.py`, `tiff.py` (`read_float_tiff`), `geom.py` (rings, simplify, `inside`,
   `centroid`, plus `seg_dist`, `ring_edges`), `style.py`, `place.py`, `osm.py` (elements → typed features),
   `terrain.py`, and one module per layer with the function `build(ctx) -> dict of scene keys`:
   `buildings.py`, `ground.py` (roads, areas, green, water, crossings), `walls.py`, `props.py`, `trees.py`,
   `parts.py`. In this item the layer modules hold today's logic moved as is; items 2, 6, 7, 8, 9 fill them.
   `ctx` carries: `place`, `style`, `osm` (list of elements), `game(lat, lon)`, `geo(x, z)`, `ground(x, z)`,
   `surface_height(x, z)` (the surface model, `None` when absent), `ext`, `play`, `rng(seed)`, `rules` (dict to
   add sentences to), `sources` (list to add entries to).
2. **Fetch and cache.** One Overpass query for everything tagged in the box:
   `[out:json][timeout:120];(nwr[~"."~"."](S,W,N,E););out body geom;` → `<cache>/osm.json`. HRDEM WCS
   (`https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic`, version 1.1.1, `GridOffsets=1.0,-1.0`,
   EPSG:3979 box as today plus 6 m) twice: `identifier=dtm` → `hrdem-dtm.tif`, `identifier=dsm` → `hrdem-dsm.tif`.
   Each enricher → `<cache>/enrich-<n>.<ext>`. `meta.json` records url, date, byte count and SHA-256 of each.
   `--offline` reads only the cache and fails naming the missing file. User-Agent stays `scene-builder/1.0`; no
   other header. (Both rasters were fetched this way on 2026-11-16: 1218 × 1164 float32 each, 6.5 MB, true 1 m.)
3. Terrain in the scene stays at the place's `terrain.cell` (2.5 m here), sampled from the 1 m `dtm` by the mean of
   the 1 m samples inside each cell (not one bilinear sample: it removes lidar speckle). Encoding unchanged.
   If a WCS answer is all no-data: terrain is flat at 0 with a warning, `surface_height` is `None`.
4. `style.py`: load `styles/<name>.json`, follow `extends` (deep merge of objects, lists replaced, at most 4
   levels, a cycle is an error), validate (every key of `styles/canada.json` present after the merge; every
   weight table non-empty; every enum word known), expose `pick(table, rnd)` for weighted choices and
   `client()` for the block copied to the scene. Write `styles/canada.json` (complete, neutral: asphalt,
   gabled 30°, wood siding / brick / stucco, `lamp_cobra`, 3.0 m storeys) and `styles/quebec-historic.json`
   (2.2 above, verbatim as the starting point).
5. The scene gains `formatMinor: 1`, `style`, `season`, `ambience` and the `sources` shape of 3.6. Everything
   else in the file is as today in this item.
6. `--georef-only` is kept. `README.md` (repository) and `docs/SCENE-FORMAT.md` (status table, 3.6) updated.

**Tests** (`python3 -m unittest discover tools/scene_builder`, standard library):

- `zone_of(-71.2068) == 19`, `zone_of(-64.31) == 20`, `zone_of(-105.53) == 13`; the anchor of
  `places/old-quebec.json` snaps to (331641, 5186615); its seven check points equal those in the committed scene.
- `to_utm`/`from_utm` round trip within 1 mm for (46.8118, −71.2068), (44.377, −64.31), (50.39, −105.53), (64.06, −139.43).
- Style merge: `{"a": {"b": 1, "c": [1, 2]}}` extended by `{"a": {"c": [3]}}` gives `{"a": {"b": 1, "c": [3]}}`; a cycle raises; a pack missing a key of `canada` raises naming the key.
- `pick({"x": 1, "y": 3}, rnd)` over 4 000 seeded draws gives y between 70 % and 80 %; the same seed gives the same sequence.
- Offline rebuild twice from one cache gives byte-identical scenes.
- `test_no_place.py` (section 2).
- `engine/test/scene.test.js` still passes on the regenerated scene (counts may move with the OSM date: where the test pins a count, pin a range of ±15 %).

**Budget.** Scene file within 5 % of before (plus the `style` block, about 3 KB). **Proof.** The six views are
unchanged to the eye (same code draws them). **Done** when the old script's constants are gone
(`grep -n "46.81\|Qu[ée]bec\|331641" tools/` finds nothing outside tests' fixtures) and the tests pass.

### Item 2 — Buildings in data

**Goal.** Every building record says how tall it really is, what roof it has and which way it runs, what it is
built of, how many storeys, which walls are blind and which face a street.

**Data.** OSM tags `building`, `building:part`, `building:levels`, `roof:levels`, `height`, `min_height`,
`roof:shape`, `roof:height`, `roof:orientation`, `roof:direction`, `roof:colour`, `roof:material`,
`building:material`, `building:colour`, `shop`, `amenity`, `tourism`, `start_date` (ODbL). HRDEM `dsm` and `dtm`
(Open Government Licence – Canada). No other source.

**Algorithm**, per building ring (parts too), in `buildings.py`:

1. `g` = lowest `ground()` on the ring vertices (as today).
2. **Measured height** (rewritten 2026-11-16: reading the eave 1 to 2.5 m inside the wall and the ridge off the
   lattice gave a rise about half the true one). Sample `surface_height − g` on a 1 m lattice of points inside the
   ring and at least 1.0 m from every edge (if fewer than 6 such points, use all points inside); each sample has
   its distance `d` to the nearest edge, and `dmax` is the footprint's true inradius, computed from the polygon.
   (a) **Eave** = the value at `d = 0` of a robust line fit of height against `d` over the samples with
   `1 ≤ d ≤ min(4, 0.6 dmax)` (if they lie on fewer than two distinct distances, up to `min(4, 0.95 dmax)`; least
   squares, then passes that drop the samples more than 2.5, 1.0 and 0.5 m off the median residual while at least 4
   samples on 2 distances remain: chimneys, dormers, overhanging trees, the high ends of a ridge); clamped to at
   most the 20th percentile of all samples + 0.5 m and at least 2.2 m. With fewer than 4 samples in the band,
   the eave is that 20th percentile. (b) **Ridge** = the 95th percentile of the samples; where the fit's slope is at
   least 0.25 m/m and fewer than two samples have `d ≥ 0.8 dmax` (the lattice missed the middle of a narrow roof),
   the larger of that and the fit carried to `d = dmax`. (c) Accept the measurement when `3 ≤ ridge ≤ 150` and at
   least 6 samples: then `h = ridge`, `hs = "measured"`, `pitchRise = ridge − eave`, which is 0 when the fit's slope is
   below 0.08 m/m and the rise below 0.8 m (a flat roof). Precedence for `h`: tagged `height` (minus nothing;
   `hs: "tag"`), else measured, else `levels × storey` (`"levels"`), else the rule of today (`"rule"`). A building
   part with `building:levels` and no tagged height uses the measured value of *its own ring*. Known limit: a
   rooftop structure covering more than 5 % of the roof reads as a ridge.
3. **Pitch class.** With `W` = half-width of the ring's oriented bounding box (5): `flat` when `pitchRise < 1.0`
   or `pitchRise / W < 0.12`; `steep` when `pitchRise / W ≥ 0.6`; else `low`. Not measured → no pitch class.
4. **Roof shape `rs`.** Tagged `roof:shape` wins (`sheded`/`skillion` → 5, `gambrel` → 8, `round`/`onion` → 6,
   unknown word → the style). Else the style rule (2.2) picks by weight. A ring with fewer than 4 vertices after
   simplification or an area under 20 m² is `flat`. A ring with holes may be `flat`, `mansard` or `hipped` only
   (others are re-picked as `mansard`).
5. **Oriented box** (also needed by the engine; same rule there): for each ring edge direction, the bounding
   rectangle in that frame; keep the one of least area; `L ≥ W` half sizes; `fill = area / (4 L W)`.
6. **Ridge direction `rd`.** Tagged `roof:direction` (degrees) or `roof:orientation` (`along` → long axis,
   `across` → short axis) wins. Else when measured and the shape is gabled, gambrel or skillion: for the long
   and for the short axis compute the correlation between sample height and the distance of the sample from
   that axis's centre line; the ridge runs along the axis with the more negative correlation, if it is below
   −0.3; write its bearing rounded to a degree in 0–179. Otherwise 255.
7. **Roof height `rh`.** Tagged `roof:height`, else measured `pitchRise` clamped to `[0.8, 0.9 × h − 2.4]` for a
   pitched shape (0 for flat), else `W × tan(roofPitchDeg[shape])` clamped to `[1.2, 0.45 × h]`; mansard:
   `min(pitchRise or 3.2, 4.2)`. Then `eaveH = h − rh`. (A mansard's lower slope lies mostly inside the 1 m margin, so its
   measured eave sits a little high.)
8. **Levels `lv`.** Tagged `building:levels` (minus `roof:levels` when the tag counts them: OSM levels exclude
   roof levels, so use as is), else `max(1, round(eaveH / storeyHeight.default))`. If the tagged levels would
   make a storey outside `[min, max]` of the style, keep the tag and note nothing: the reader stretches storeys.
9. **Use.** `church|cathedral|chapel|place_of_worship` → 4; `retail|commercial|supermarket|kiosk`, or a `shop`,
   `amenity=restaurant|cafe|bar|pub|fast_food|bank|pharmacy`, `tourism=hotel|museum` node inside the ring or
   within 3 m of it → 2; `civic|public|government|townhall|school|university|hospital` → 3;
   `industrial|warehouse` → 5; `train_station|transportation` → 7; `house|apartments|residential|detached|terrace`
   → 1; else 0.
10. **Façade `fa`, palette `pal`, roof material `rmt`, roof palette `rp`.** Tagged `building:material`
    (`stone` → 1, `brick` → 3, `plaster|stucco|cement_block` → 4, `wood` → 5, `concrete` → 6, `glass` → 7,
    `metal` → 8) and `roof:material` (`metal|tin|zinc` → 1, `copper` → 2, `slate` → 3, `shingle|asphalt` → 4,
    `tile|roof_tiles` → 5, `gravel|tar_paper|bitumen` → 6, `concrete` → 7, `thatch` → 8) win; else the style
    rule by weight. `pal`, `rp`: uniform seeded pick over the length of the style's list for that class. A tagged
    `roof:colour` whose green channel exceeds red and blue (copper gone green) sets `rmt = 2`.
11. **Blind edges.** For each edge, take the three points at ¼, ½, ¾ of it, pushed 0.6 m outwards; the edge is
    blind when at least two of them lie inside another building ring (not a part of the same building). Use a
    25 m grid of ring bounding boxes so this is not quadratic. Edges shorter than 1.2 m are blind.
12. **Front edges.** An edge that is not blind, at least 2.5 m long, whose midpoint is within
    `road.width / 2 + 6` m of a road of class other than `service`, `steps`, `path`, `corridor`, and whose
    outward normal points towards that road's nearest point (dot product > 0.3).
13. **Ground floor `gf`.** 1 when `use = 2` and there is a front edge; 2 when `building` is
    `garage|garages|carport` ; else 0.
14. **`id`** as 3.1. **`parts`** as today (an outline whose ring contains the centroid of a part).

`rules` gains a sentence for each of 2, 4, 6, 7, 11, 12. `docs/SCENE-FORMAT.md` 4.2 and its status table are
updated with section 3.1 of this plan.

**Tests** (synthetic `ctx`, no network):

- A 10 × 8 ring on flat ground with a surface model that is a gable (ridge along x, eave 6 m, ridge 9 m): eave
  within 0.4 of 6, ridge (`h`) within 0.4 of 9, `hs == "measured"`, `rh` within 0.6 of 3, pitch `steep` (3 / 4 = 0.75), `rd` = 90, `lv` = 2.
- The same with a flat surface at 7 m: pitch `flat`, `rs == 0`, `rh == 0`, `h` within 0.2 of 7.
- No surface model: `hs` is `levels` or `rule`, `rd == 255`, no pitch class, and a rule with `"pitch"` in `when` is not chosen.
- Two 10 × 8 rings sharing an edge: that edge is in `blind` of both and no other edge is.
- A road 5 m in front of edge 0: `front == [0]`. A `shop` node inside the ring: `use == 2`, `gf == 1`.
- `id` is the same on two builds, differs between two buildings, and is never 0.
- On the real cache: at least 85 % of buildings `measured`; at most 2 % with `h > 60`; the standard deviation
  of `h` over buildings exceeds 3 m (the town is no longer one height); every `blind`/`front` index < vertex count.

**Budget.** ≤ 125 bytes added per building (≤ 0.12 MB): `rd` and `gf` are always written, so the reader needs no defaults for them. **Proof.** With item 3 merged: views 1, 5, 6: heights
vary along a street; the overview shows the measured skyline. **Done** when the tests pass and the scene's
`rules` block explains every invented value.

### Item 3 — The reader and the mesher

**Done on branch `mesher`, 2026-11-16.** Section 4 is its result and the contract for items 4 to 10.

**Goal.** The engine reads every addition of section 3, cuts chunks into cells with the three groups of 4,
derives collision from the same functions that draw, and calls generators that are placeholders until their
items land.

**What was built.**

1. `scene/source.js`: both sources hand on the decoded records of section 4, every field present, with the
   defaults that keep an old file's picture; `layCells` cuts a chunk's records into its 16 cells; the manifest
   gains `formatMinor`, `style` (resolved), `season`, `ambience`. The surface raster is burnt from `sf` when present.
2. `gen/style.js`, `gen/poly.js`, `gen/cells.js`, `gen/mesher.js` (section 4), and `triN`, `cap` in `gen/soup.js`.
3. A placeholder in every generator file, drawing exactly what the engine drew before (the frustum roof, one
   quad per edge with the old texture, slab walls, the old tree; no ribbons, no props, no arch), under the final
   signature, with the contract in the file's header.
4. `level/build.js`: `buildChunkStatic` (base and far, one mesh per material per chunk, far maskable per cell),
   `buildCellNear`; `level/detail.js`: which cells show their near group; `level/loader.js` keeps a live chunk's
   records, runs the detail every frame and builds every near cell in reach in `preload` (so `photo()` shows the
   place as it is). `stats()` gains `cellsNear`, `cellsBuilt`, `nearBuildMs`, `detail`; `tris` counts what is drawn.
5. `terrain/heightfield.js`: `lift`, `liftCell`, `liftN`, `baseHeight()`. `scene/install.js`: collision as section 4.
6. `world.stats()` gains `cellsNear` and `nearBuildMs` (additive; `docs/WORLD-API.md`).

**Tests** (`engine/test/`): `poly.test.js` (polygons, cells, line and soup clipping), `scene.test.js` (the two
fixture scenes of `test/fixtures/`: old keys decode to the old rules, new keys to their values; parts, `mh`,
passages, roads across a chunk edge, wall pieces, crossings, props, style), `terrain.test.js` (the lift),
`physics.test.js` (under a floating part; a post and a bench from their colliders), `level.test.js` (the
distance rule and its band; the three groups; meshes per chunk and the far mask; the engine on a new-style
scene; budgets on the published scene), and one contract test per generator file (`roof`, `facade`, `ground`,
`structures`, `props`, `parts`) that passes on the placeholder, must keep passing, and lists the item's own
tests as todo.

**Measured** (2026-11-16, this machine, software WebGL, the published scene, placeholders in every generator):

| | 1 street | 2 square | 3 gate | 4 terrace | 5 lower | 6 overview |
|---|---|---|---|---|---|---|
| draw calls, `q=low`, before → after | 147 → 173 | 180 → 211 | 86 → 100 | 142 → 149 | 164 → 193 | 182 → 189 |
| triangles, `q=low`, before → after | 166 k → 166 k | 234 k → 234 k | 114 k → 115 k | 170 k → 169 k | 234 k → 235 k | 233 k → 233 k |
| near cells, `q=low` (R = 45 m) | 4 | 6 | 5 | 4 | 6 | 2 |
| draw calls, `q=high`, before → after | 214 → 343 | 204 → 280 | 90 → 130 | 154 → 214 | 176 → 234 | 247 → 282 |
| triangles, `q=high`, before → after | 281 k → 275 k | 317 k → 314 k | 114 k → 114 k | 210 k → 208 k | 296 k → 296 k | 389 k → 388 k |
| near cells, `q=high` (R = 140 m) | 28 | 24 | 24 | 28 | 25 | 17 |

Frame time at `q=low`, 960 × 540, mean of the five street views, old and new code run in turn three times with
40 frames a view: before 252, 245, 241 ms; after 244, 242, 239 ms (no slower). At `q=high`, 1280 × 720, one pair
with 24 frames a view: 1064 ms before, 1075 ms after (within what two runs of the same code differ by here). Load to ready at `q=low`: 3.9 to
6.1 s before, 3.9 to 6.2 s after (the spread is the machine's). `node --test`: 96 pass, 35 todo (the items' own
tests), 2 s. The densest near cell of the scene (1 768 triangles with the placeholders) builds in under 3 ms. The extra draw
calls are the near groups (a group per cell and material, drawn again in each shadow pass); with the
placeholders they show nothing the far picture did not, and `detail=0` gives the old numbers back.

**Proof.** The six views are unchanged to the eye (placeholders draw the old picture; against a second run of the
old code the pictures differ by no more than two runs of the old code do), and `play.mjs` completes on both
scenarios. **Done**: a generator item lands by editing only its own file.

### Item 4 — Roofs

**Goal.** Every roof shape of the format drawn as real planes on any footprint, with the places dormers and
chimneys go.

**Contract** (section 4, and the header of `gen/roof.js`, which is the placeholder to replace): `roof(soups, b,
style) -> { slots, ridge, parapet }`, called once per whole building for the `base` group; `poly.js` is built
except `inset`, which this item writes. Soups come from `style.js`: `ROOF_TINT_SOUP[b.roofMat]` with `b.roofColor`
when the building has a colour, else `ROOF_SOUP[b.roofMat]`; gable walls `WALL_SOUP[b.facade]` with `b.tint`. Do
not edit the tables: item 5 points them at `roof_metal`, `roof_slate` when those materials exist. The placeholder
lifts a roof colour by 1.6 to suit the old zinc texture; write the plain colour.

**Algorithms** (`gen/roof.js`, `inset` in `gen/poly.js`). `e` = `yBase + hEave`, `H` = `hRoof`.

- **`inset(ring, d)`**: for each vertex, the intersection of the two adjacent edges moved inwards by `d` (mitre;
  when the edges are within 1° of parallel, the vertex moved along the normal). Valid when: the signed area
  keeps its sign and is at least 5 % of the original; every new edge points the same way as its old edge (dot
  product > 0); no two non-adjacent new edges intersect. Otherwise `null`.
- **`triangulate`** is built (item 3): ear clipping with holes bridged in; triangles come out facing up; a ring
  that defeats it is finished as a fan and counted in `triangulate.fallbacks` (a test keeps it at 0 on the scene).
  `soup.js cap(s, ring, holes, y, tint)` draws a flat polygon with it.
- **flat (0)**: `in = inset(ring, 0.3)`. If valid: cap of `in` at `e` (membrane), parapet top strip between ring
  and `in` at `e + 0.45`, inner parapet face from `e` to `e + 0.45`; the façade is told the parapet height
  through the return value (`parapet: 0.45`) so the outer wall rises to it. If not valid, or with holes: a plain cap at `e`.
- **gabled (1), gambrel (8)**: axis = `roofDir` or the long axis of `obb`. `s(p)` = signed distance from the
  centre line, `W` = the greatest `|s|` on the ring. Height `H (1 − |s| / W)`. The two halves are
  `clip(ring, s ≥ 0)` and `clip(ring, s ≤ 0)`, each triangulated and lifted. Every ring edge whose ends are not
  both at height 0 gets a wall from `e` up to the roof (a fan in the wall plane, with the ridge point added
  when the edge crosses the centre line). Slots: ring edges within 12° of the axis and within 0.3 m of `|s| = W`.
  Ridge: the two points where the centre line leaves the ring, pulled in 0.8 m. Gambrel: the same with the
  profile `0.6 H` at `|s| = 0.6 W`.
- **hipped (2)** when `obb.fill ≥ 0.82` and no holes: with `a = W − |s|`, `b = L − |t|`: height
  `H min(a, b) / W`. Four regions, each a convex cut of the ring by three half-planes (two long sides: `±s ≥ 0`,
  `a ≤ b` on both ends; two ends: `±t ≥ 0`, `b ≤ a` on both sides), triangulated and lifted. Ring edges not on
  the box are given walls up to the roof, sampled every metre. Otherwise (irregular, or holes): `in = inset(ring,
  d)` with `d = H`, then `H / 2`, then `H / 4`; one quad per edge from the ring at `e` to `in` at `e + H`, cap of
  `in` at `e + H`; holes are inset outwards by the same `d` and treated the same; if no inset is valid, flat.
- **mansard (3)**: lower slope: `in1 = inset(ring, a)` with `a = min(1.2, 0.3 H)`, rising `0.8 H`; upper:
  `in2 = inset(in1, b)` with `b = min(3, 0.25 × obb.W)`, rising the remaining `0.2 H`, cap of `in2`. Each inset
  halves on failure (twice), then the stage is skipped (lower failing → flat; upper failing → cap of `in1` at
  `e + 0.8 H`). Holes as in hipped. Slots: every ring edge at least 2.5 m long that is not blind; `slope` =
  `0.8 H / a`.
- **pyramidal (4), cone (7)**: apex at the centroid, at `e + H`, one triangle per edge. If the centroid is not
  inside the ring, as hipped-irregular.
- **dome (6)**: five rings: the ring scaled about its centroid by `cos(k π / 10)` at height `e + H sin(k π / 10)`,
  `k = 0…4`, quads between, a fan to the apex.
- **skillion (5)**: one plane, `H (s + W) / 2W` across the short axis (rising towards `+s`), cap triangulated and
  lifted, walls up to it on every edge.

Normals are per face (flat shading), from the winding (`soup.tri`).

**Tests** (`engine/test/roof.test.js`), helper `planArea(soup)` = sum of triangle areas projected on the plan,
counting only triangles with `ny > 0.05`:

- For each shape on a 12 × 8 rectangle, an L (12 × 8 with a 6 × 4 corner removed), a ring with a 3 × 3 hole, and
  both windings: `planArea` equals the footprint area (less holes) within 1 %; every roof vertex has
  `e − 1e-6 ≤ y ≤ e + H + 0.46`; every roof triangle has `ny > 0`; no vertex lies more than 1 mm outside the ring's bounding box.
- Gabled 12 × 8, `H = 3`, axis along x: the highest vertices are at `z` = centre and `y = e + 3`; exactly 4 roof
  triangles and 2 gable triangles; with `roofDir = 0` (north-south) the ridge runs along z.
- Hipped 12 × 8, `H = 4`: ridge length 4 (12 − 8), ridge at `e + 4`.
- Mansard 10 × 10, `H = 4`: the lower ring is at inset 1.2 and height `e + 3.2`; four slots, each `slope` = 3.2 / 1.2.
- Pyramidal 6 × 6: 4 triangles meeting at the centre at `e + H`. Dome: apex at `e + H` within 1 mm.
- `inset` of a 10 × 10 square by 1 is the 8 × 8 square; by 6 is `null`; of the L `(0,0) (12,0) (12,4) (6,4) (6,8) (0,8)` by 1 is
  `(1,1) (11,1) (11,3) (5,3) (5,7) (1,7)` (area 36), in either winding.
- `triangulate` of a square with a square hole gives 8 triangles whose areas sum to outer − hole.
- On the regenerated Old Quebec scene: every building produces a roof without throwing; the fan-fallback counter is 0; total roof triangles < 120 000.

**Budget.** Roofs stay in `base`: ≤ 120 k triangles for the scene. **Proof.** Views 1, 2, 5, 6: mansards and
steep gables instead of lumps; the overview reads as a roofscape. **Done** when the tests pass and the planning
model has looked at the pairs.

### Item 5 — Façades

**Goal.** Walls with storeys, window bays with real depth, doors, shopfronts, cornices, dormers and chimneys,
varied by material and seeded choice; and a flat far façade that lines up with them.

**Contract** (section 4, and the header of `gen/facade.js`): `facadeFar(soups, piece, groundAt, style, roofInfo)`
fills the `far` group and `facadeNear(…)` the `near` group; the two are never drawn together, so **each draws the
whole wall, plinth included**. They are called once per piece of `passagePieces(b)`: a piece is a building record
with its own `ring`, `holes`, `yMin`, `blind`, `front`; the wall starts at `max(ground, yMin)`. Dormers and
chimneys are drawn with piece 0 only. Soup keys come from `style.js` (`FACADE_FAR_SOUP`, `WALL_SOUP`, `SOUP.*`);
this item adds the materials below and edits those tables in the same commit (it is the only item that does).

**Layout rule** (shared by far and near, `bays(len, style, seed)`): bay width `w` = seeded value in
`style.window.bay` fixed per building; `margin = 0.45`; `n = floor((len − 2 margin) / w)`; if `n < 1` the edge has
no openings; the bays are centred: first bay starts at `(len − n w) / 2`. Per edge the wall starts at
`base = max(ground at the two ends)` (the plinth below it, down to `min − 0.5`, is plain stone) and ends at the
eave; `levelsE = max(1, round((eave − base) / (hEave / levels)))`, storey `= (eave − base) / levelsE`. A window
is `style.window.width × min(style.window.height, storey − sill − 0.35)`, centred in its bay, sill at
`style.window.sill` above the storey's floor. Storeys under 2.3 m get no windows.

**Far** (`facadeFar`): one quad per edge from `base` to eave with `uv = [0, 0, n, levelsE]` (for `n = 0`:
`[0.5, 0, 0.5, levelsE]`, a column of the texture with no window in it), soup `"facade_<stone|stucco|brick>|v"`;
the plinth quad in `"stone|tv"`. The façade texture (below) draws one window per unit square in the same
proportions as the style's defaults.

**Near** (`facadeNear`), per edge, on a `frame` (left to right as seen from outside):

- Wall soup `"<stone|rubble|stucco|brick>|tv"`, tinted. Per storey: a band from floor to sill and a band from
  head to the next floor, full width; between sill and head, `n + 1` piers. Blind edges and `n = 0`: one quad.
- Per window: glass quad at depth `−reveal` in `"window|v"` with `uv = [0, 0, 1, 1]`, tinted with the frame
  colour; four reveal quads in the wall soup; a sill `slab` 0.06 high, out 0.07, 0.08 wider each side, top and
  front only, in `"stone|tv"` tinted with the trim colour; a lintel: a front quad 0.22 high, out 0.02, in trim.
  Shutters (probability `style.window.shutters` per building): two quads 0.45 of the window width, out 0.03,
  in `"wood|tv"` tinted with the door colour.
- Ground storey on `front` edges. `gf = 0`: one door per edge (per 14 m of edge at most), in the bay nearest the
  higher end of the edge but not the corner bay when `n > 2`: opening `doorWidth × doorHeight` from `base`,
  recessed 0.25, door quad in `"door|v"` tinted with the door colour, a 0.12 step slab in stone. `gf = 1`: every
  bay is a shop window from `shopSill` to `storey − fascia − 0.1`, piers `shopPier` wide, glass in `"window|v"`
  with `uv = [1, 0, 2, 1]` (the texture's second panel: one large pane), a fascia `slab` out 0.1 the height
  `fascia` across the whole edge tinted with an awning colour, one bay a door as above; with probability
  `awning` per edge a sloped quad 1.1 m out over the shop windows, double-sided soup `"tarp|vd"`. `gf = 2`: one
  opening 2.6 × 2.4 with a door quad.
- Cornice along every non-blind edge at the eave: `slab` out `cornice.depth`, high `cornice.height`, front,
  bottom and top, trim colour. Stone façades also get a string course (0.12 high, out 0.04) at the first floor.
- Dormers on `roofInfo.slots`: at every bay centre (mansard; `style.dormers.mansard` share) or every other
  (gabled): front at 0.35 m in from the eave, `width × height`, a window quad on the front, two side triangles
  back to the roof plane (depth `height / slope`), a small gabled roof 0.4 high in the roof soup. Skip a dormer
  whose depth would exceed 2.5 m (roof too shallow).
- Chimneys: `rng`-picked count from `style.chimneys.perBuilding` on `roofInfo.ridge` points (pitched roofs
  only): `box` `width × depth`, from the eave to `ridge.y + above`, soup `"brick|tv"` or the wall soup for stone
  buildings, a 0.08 cap slab.
- The function is called per piece (see the contract); edges in the piece's `blind` set get one quad.

**Materials** (`materials/outdoor.js`; our own generators, same form as the file's others):

- `facade` generator: add brick (`uP.x = 2`), and make the window `style`-proportioned: width 0.36 of the bay,
  from 0.27 to 0.83 of the storey. Sets `facade_stone`, `facade_stucco`, `facade_brick` with `tile: [1, 1]`
  semantics (UV counts bays and storeys). Fix `FACADE_MATERIAL` so class 3 is `facade_brick`.
- `window`: two panels side by side in u (0–1 a casement of `panes` 2 × 4 with frame and glazing bars; 1–2 one
  large pane with a transom at 0.8). Frame near white (the vertex tint colours it), glass dark, roughness 0.08.
- `door`: a panelled door (2 × 3 panels, the top pair glazed), near white for tinting.
- `roof_metal` (light standing seam, for tinting), `roof_slate` (rows of slates), `roof_membrane` as today.
  `ROOF_MATERIAL` updated.

**Tests** (`engine/test/facade.test.js`):

- `bays(10, { window: { bay: [2.5, 2.5] } }, 1)` → `n = 3`, first bay at 1.25; `bays(2.9, …)` → `n = 0`... (2.9 − 0.9 = 2.0 < 2.5); `bays(3.4, …)` → `n = 1`.
- One 10 m wall, 3 storeys of 3 m, not front: 9 window quads in `window|v`; the area of wall-soup triangles in
  the wall plane (d = 0) plus 9 × window area equals 10 × 9 within 1 %; no vertex further out than
  `cornice.depth + 0.01` or further in than `reveal + 0.26`.
- The same as a `front` edge with `gf = 0`: 8 windows and 1 door quad; with `gf = 1`: 6 windows above, 2 shop panes and 1 door on the ground storey.
- A blind edge: exactly 2 triangles. An edge of 2 m: exactly 2 triangles and no window.
- Far and near agree: for the 10 m wall the far quad's `uv` is `[0, 0, 3, 3]`, and the centre of far window
  `(i + 0.5, j + 0.55)` maps to within 0.15 m of the centre of the near window `(i, j)`.
- The same building twice gives identical soups; two ids give different tints or bay widths in at least one of 5 pairs.
- Every triangle of the near façade of a closed 10 × 8 ring faces outwards (normal · (centroid − building centre) > 0) except reveal and soffit faces (allow the known count).
- Scene-level: `near` triangles for the densest cell of Old Quebec < 180 000; building it < 30 ms on this machine (assert < 150 ms to leave room for slow machines).

**Budget.** Section 5. **Proof.** Views 1, 2, 3, 5 at `q=high`; view 1 also at `q=low`, where only the near
houses are modelled and the far ones keep painted windows in the same places. **Done** when tests pass, budgets
are measured, and the planning model has judged colours and proportions on the pairs (section 7).

### Item 6 — Ground

**Built (2026-11-16, branch `ground`).** Decisions that differ from the text below: a mapped `footway=sidewalk` way is itself a raised sidewalk (`sw: "self"`, 1.6 m); a `footway=crossing` way takes the surface of the street it crosses; the paving margin is drawn only beside hard surfaces (asphalt, concrete, cobble, paving); nothing yet cuts one road's sidewalk where another crosses it (junction mouths stay raised); steps rails are boxes (no `rail_iron` yet); bare ground is 5 m rectangles.

**Goal.** Streets with crisp edges, the right surface, kerbs and raised sidewalks, real stairs, crossings and
centre lines; the cliff drawn as rock.

**Data.** OSM `highway`, `surface`, `width`, `sidewalk`, `sidewalk:left|right|both`, `footway=sidewalk`,
`lit`, `step_count`, `handrail*`, `incline`, `bridge`, `tunnel`, `highway=crossing` nodes; areas as today.

**Builder** (`ground.py`): `sf` = `surface` tag mapped (`asphalt` 1; `concrete`, `concrete:plates`,
`concrete:lanes` 2; `sett`, `cobblestone`, `unhewn_cobblestone` 3; `paving_stones`, `paved`, `bricks` 4;
`fine_gravel`, `gravel`, `compacted`, `pebblestone` 5; `dirt`, `ground`, `earth`, `mud` 6; `grass` 7; `sand` 8;
`rock` 9; `wood` 12; `metal`, `metal_grid` 13), else `style.street.surface[highway]`, else 1. `sw`: `no` when
tagged `sidewalk=no|none|separate` or when the road has a mapped `footway=sidewalk` way within 6 m along most of
its length; the tag's side when tagged; else `both` for classes in `style.street.sidewalk.on`, else `no`.
`sc`, `hr`, `lit`, `mk` as 3.2. `crossings` as 3.2 (snap the node to the nearest road vertex or segment within
1.5 m; drop it otherwise). **Bare ground:** the surface raster's default stays paving inside built-up ground,
but a cell whose terrain slope exceeds 0.6 (rise over run, from the 1 m `dtm`) and that no road, area or
building covers is written into a new area list `bare` (`areas` records with `k: "bare"`, `s: "rock"`,
polygons from merged 5 m cells, simplified to 1 m) so the reader burns rock there; cells of slope 0.25–0.6
uncovered and outside any `green` become `k: "bare", s: "grass"` (the wooded bank). Rules sentences added.

**Contract** (section 4, and the header of `gen/ground.js`): a `road` is a **piece**: the part of a way within
reach of one cell, with `s0` (where it starts along the whole way) and `len` (the whole way's length). Draw the
whole piece; the mesher cuts the triangles to the cell's box, and the next cell draws its own piece the same way.
So place dashes, treads and posts by `s0 + distance`, never from the piece's start, and do not drop triangles
yourself. `road.kind` is the source's word (`living_street`, `footway`, …); the mesher never passes a tunnel or a
bridge. Sidewalk width and surface are `style.sidewalk` (a key the packs' `client` part must carry; the neutral
style has 1.6 m, concrete), the kerb `style.kerb`. `crossing(soups, c, tile, style)`: `c.yaw` in radians, the
direction the road runs. `liftRaster` gets every road piece of the chunk (pieces overlap: the result must not
depend on it) and may return `null`.

**Engine** (`gen/ground.js`):

- **`drape(tri, tile)`**: the terrain mesh splits cell `(i, j)` (corner `a = (i, j)`, `b = (i + 1, j)`,
  `d = (i, j + 1)`, `e = (i + 1, j + 1)`) into triangles `a d b` and `b d e` (`level/build.js`). For every cell the
  triangle's bounding box touches, clip the triangle (Sutherland–Hodgman, three half-planes) against each of the
  two cell triangles; fan the result; give each vertex the height of that cell triangle's plane (from the tile's
  `baseHeight` samples, not bilinear). Output is exactly on the drawn ground. Callers add a lift along +y.
- **`roadRibbons`**: per segment, the carriageway quad (width `w`) as two triangles, draped, lifted 0.03, soup
  `"<surface material>|t"` (`SURFACE_MATERIAL` of `materials/outdoor.js`); joints: at each inner vertex a fan
  of the wedge between the two segment ends on the outer side (mitre, capped at `w`). Sidewalks where `sw` says:
  a strip `width` wide outside the carriageway edge, draped, lifted `kerb`; its inner edge gets a kerb face (a
  vertical quad from +0.03 to `kerb`, per draped edge piece) and a kerb-stone strip 0.15 wide in `"stone|t"`;
  roads with `sw = no` of class pedestrian, footway, living street get a level margin strip 0.6 wide in paving
  that hides the raster's staircase edge. Centre line (`mk`): dashes 3 m long, 0.12 wide, every 9 m, lifted
  0.04, soup `"paint_white|t"`. Bridges and tunnels never arrive. Triangles outside the cell are cut away by the
  mesher (the neighbour draws them).
- **`liftRaster`**: 1 m cells whose centre lies in a sidewalk strip get `round(kerb × 100)`.
- **`steps`**: for a `steps` road (called instead of `roadRibbons`): walk the polyline; `count` treads over the
  whole way (`road.len`), of which this piece shows those from `s0` on; tread `k` is a box from its going
  (length / count) wide `road.width`, top at the ground height of its upper end, front face down to the tread
  below; soup `"stone|t"`. Side stringers 0.2 wide down to the ground − 0.3. Handrails (`hr`): posts every 2 m
  and a rail at 0.95 above the tread line, soup `"metal|t"`, via `PROP_KIT.rail_iron` when item 8 has landed,
  else two boxes.
- **`crossing`**: stripes 0.5 wide, 0.5 apart, across the road width, 3 m deep, draped, lifted 0.04, white.

`scene/install.js` already feeds `liftRaster` to the height tile (item 3): a walker on the sidewalk stands
`style.kerb` higher. Nothing else collides: a kerb is lower than a step (`STEP = 0.45`).

**Tests** (`engine/test/ground.test.js`):

- `drape` of a triangle on a flat tile returns triangles whose plan areas sum to the input's (1e-6) at the
  tile's height; on a tile that is a ramp in x every output vertex satisfies the ramp equation (1e-6); on a
  random bumpy tile every output vertex lies on the plane of the cell triangle that contains its centroid (1e-5),
  and the summed plan area still equals the input's.
- A straight 20 × 6 road with `sw = both`, width 1.6, kerb 0.14 on a flat tile: carriageway plan area 120 ± 1 %,
  sidewalk plan area 64 ± 1 %, every sidewalk-top vertex at `0.14`, kerb faces vertical, total height 0.11.
- `liftRaster` for it: the cell at 4 m from the axis (in the strip 3–4.6 m) is 14; at 1 m it is 0; at 6 m it is 0.
- With the lift installed, `terrain.height` on the sidewalk equals the drawn top (the two can never disagree).
- A bend of 90°: no gap at the joint (the plan area of the union ≥ the two rectangles' union: sample 200 points).
- Steps over a rise of 3.4 m with `count = 20`: 20 treads, each riser 0.17 ± 0.01, every tread top within 0.17 of the ground under it.
- Physics: a capsule walks along the sidewalk, steps down the kerb and up again without being blocked; it climbs the steps road (the terrain under it) at walking speed.
- Builder: `surface=sett` → 3; a road with a parallel `footway=sidewalk` 3 m away → `sw: "no"`; a `crossing` node 5 m from any road is dropped.

**Budget.** Ribbons are `near` only: ≤ 60 k triangles per cell. **Proof.** Views 1, 3, 4, 5, 6: no staircase
edges within `R`; kerbs; the Escalier in view 5's neighbourhood; the cliff as rock and wooded bank in 4 and 6.
**Done** when tests pass and `play.mjs` still completes (the mission walks on these streets).

### Item 7 — Walls, crenels, gates

**Goal.** Fortification and retaining walls that sit on the relief with a parapet and crenels; rails drawn as
rails; a road through a building is an arch you walk through.

**Builder** (`walls.py`): thickness, material, free height and parapet from `style.walls[barrier]` (tags
`height`, `width` win). **Holding ground back:** for each segment, ground at 1.5 m either side of its midpoint;
if the difference exceeds 1.5 m on at least 60 % of a way's length the way is a scarp: write `hp` = the style's
parapet and no `h`; else `h` = `freeHeight`. A way that changes character is split into runs at the vertex where
it changes (minimum run 10 m). `cr: 1` for `city_wall` when the style says so. `fence`, `handrail`,
`guard_rail` get `rail` from the style. **Passages** (`pass` on a building, written here into the building
records through `ctx`): a road (class not `steps`) with `tunnel=building_passage`, or any road that crosses a
building tagged `historic=city_gate`, gives `[x1, z1, x2, z2, w, hgt]`: the segment of the road inside the
footprint extended 0.5 m each end, `w` = `max(road.width, 3)` but at most the footprint's extent across the road
minus 2 × 1.2 m (so piers remain; if nothing remains, no passage), `hgt` = `min(0.7 × hEave, w + 1)`. Such a
building gets `rs = 0`, `cr`-style parapet through `gf = 0` and no front edges.

**Contract** (section 4, and the headers of `gen/structures.js` and `gen/passage.js`): a `wall` is a **piece** cut
exactly at the edges of one cell, with `s0` and `len`; merlons and posts are placed by `s0 + distance` so two
pieces meet in step. `wallRings(wall, groundAt)` is the collision and `wall()` must draw those rings; a wall with
`rail` is drawn in `near`, every other wall in `base` (the mesher decides). `passagePieces(b)` returns `[b]`
itself without a passage, else copies of the building with `ring`, `holes`, `yMin`, `blind`, `front` (both
renumbered for the piece's ring) and `piece` (0, 1, …); the façades and the collision are made per piece.
`passageArch(soups, b, p, groundAt, style)` in `passage.js` draws the inside of one passage, in `base`.

**Engine.** `gen/structures.js`: `wallRings` cuts the piece into runs of at most 6 m (so tops step with the
ground), each a quad ring of the thickness, `yBase` = lowest ground under it − 1, `yTop` = `higher + hp` or
`highest + h`. `wall` draws each ring as a `prism` in the wall material; with `cr`: merlons 1.1 long, 0.7 high,
0.5 thick, every 2.2 m on the edge over the lower ground (both edges when free-standing), and a coping slab.
With `rail`: no prism; `PROP_KIT[rail]` posts every 2 m and two rails (the collider stays the thin ring).
`gen/passage.js`: `passagePieces(b)`: for each passage with axis unit `u` and normal `v`: left piece
`clip(ring, v·p ≥ w/2)`, right piece `clip(ring, v·p ≤ −w/2)`, middle `clip(clip(ring, …), …)` with
`yMin = yBase + hgt`; edges created by the cut are in the piece's `blind` set. Drawing the arch
(`passageArch` in `passage.js`, called by the mesher once per passage): the two inner walls of the passage
up to the springing `hgt − w/2` (or 0.6 `hgt` when `w/2 > hgt − 2`), a barrel vault of 8 segments between them
along the middle piece's extent on the axis, and at both mouths the wall between the vault curve and `hgt`
(fans), all in the wall soup.

**Tests** (`engine/test/structures.test.js`, builder tests):

- A wall along a 3 m scarp with `hp = 1.4`: every ring's `yTop` is `higher ground + 1.4`; from the low side the wall shows ≥ 4.4 m; a walker on the high side is stopped (physics) and cannot step over.
- A 22 m crenellated wall: 10 merlons; all within the wall's thickness; none floating (base at `yTop`).
- `passagePieces` of a 12 × 6 building with a passage of width 4 through its middle: three pieces of plan area 24, 24, 24 (± 1 %); the middle has `yMin = yBase + hgt`; a capsule 1.8 m tall walks through along the axis and is stopped 3 m to the side.
- The vault's highest point is at `hgt` and every vault vertex is within `w/2` of the axis.
- Builder: flat ground both sides → `h`, no `hp`; a 4 m step → `hp`; a road crossing a `city_gate` building 10 m wide with road width 6 → `w = 6`, piers of 2 m; a building narrower than `w + 2.4` → `w` reduced or no passage.

**Budget.** Walls and gates are `base`: ≤ 40 k triangles in the scene. **Proof.** View 3 (the gate is an arch
with the street through it and the wall beside it), view 4 (the terrace rail), view 6 (the ramparts).
**Done** when the mission still plays and a walker passes each gate in the scene (a test walks every `pass`).

### Item 8 — Dressing: props and trees

**Goal.** Streets with lamps, benches, bollards, signs, hydrants, flagpoles, cannons, monuments, rails; trees
that differ by species, size and season. All from data or a stated rule.

**Builder.** `props.py`: every OSM node (or the centroid of a small way) whose `key=value` is in
`style.props` becomes an item with `source: 0`. Yaw: a tagged `direction` (degrees or a compass word); else
facing away from the nearest building edge within 6 m; else along the nearest road within 10 m; else seeded.
Cannons face outwards across the nearest `city_wall` within 8 m. **Rule lamps** (`style.street.lamps`): along
each road of the listed classes that is not `lit=no`, a lamp every `spacing` m, starting at half a spacing,
`offset` m outside the carriageway edge (on the sidewalk when there is one), alternating sides when `stagger`;
skipped when a mapped lamp is within `spacing / 2`, when the point is inside a building or within 0.4 m of one
(then try the other side; else skip), on a bridge, on steps, or outside `extent`. `source: 1`. **Rule bollards**:
at both ends of a `pedestrian` road that meets a vehicular one, a row across the width at `gap` spacing.
Rules sentences added; the count of ruled props is printed. `trees.py`: OSM `natural=tree` nodes and `tree_row`
ways (every 8 m, as today) with `species`, `genus`, `leaf_type`; then each `trees` enricher: its points replace
OSM trees within 3 m (the inventory is the better record: it carries species and trunk diameter) and add the
rest. **Decided (section 8, decision 3): every tree uses the best record there is**, the inventory where one
exists and OpenStreetMap elsewhere, de-duplicated as above. The merged layer is then ODbL as a whole (format
rule 6.1), like the buildings and roads already are, and `sources` gains one entry per source with its own
attribution (both credited) and `"layers": ["trees"]`. A species or diameter the inventory gives is never
replaced by an OSM value; an OSM `species`/`genus` fills an inventory record that lacks one. Height: the
surface model (`max` of `surface_height − ground` within 2 m, accepted between 3 and 35 m); else from a
`diameter_cm` (`h = 4 + 0.22 × d`, clamped 4–26); else seeded 6–13. Crown radius `0.32 h`, clamped 1.5–8.
`kind`, `form` from `style.trees` by genus (the first word of the species), `leaf_type=needleleaved` → conifer.
Drop a tree inside a building footprint.

**Contract** (section 4, and the headers of `gen/props.js` and `gen/trees.js`): `PROP_KIT[kind] = { build(soups,
x, y, z, yaw, variant, style), collider }`; `yaw` in radians, 0 facing grid north, positive towards the west;
`collider` is `null`, `{ r, h, nav }` (a square of half-width `r`) or `{ hw, hd, h, nav }` (a box of half-width
`hw` along the prop's right hand and half-depth `hd` along its facing), from which `scene/install.js` makes the
solid: the sizes in the table below are half sizes, and "no" in its last column is `nav: false`. Round parts use
`soup.js triN` with normals away from the axis. `tree(soups, t, y, season, lod)`: `lod` 0 is drawn in `far`,
`lod` 1 in `near`, never together. `test/props.test.js` checks every kind added to the kit against this.

**Engine.** `gen/props.js`, the kit. Each kind is a function of boxes, prisms and lathed rings (a helper
`lathe(soup, cx, cz, profile [[r, y], …], segments, tint)`), 30–250 triangles, in at most three soups
(`"metal|tv"` dark iron, `"wood|tv"`, `"stone|tv"`, plus `"glass_lamp|"` for a lantern's panes). Dimensions:

| Kind | Model | Collider (r, h, nav) |
|---|---|---|
| `lamp_lantern` | base 0.3 × 0.5 high, fluted post r 0.07 to 3.6 m, cross arm, four-sided lantern 0.4 × 0.6 with a pyramidal cap | 0.15, 3.6, no |
| `lamp_cobra` | plain post r 0.09 to 8 m, arm 1.8 m, flat head | 0.15, 8, no |
| `bench_slat` | two iron ends, 5 seat slats 1.8 m long at 0.45, 3 back slats to 0.85 | 0.9 × 0.3 box, 0.85, yes |
| `bollard_iron` | lathed post r 0.09, 0.95 high, ball top | 0.12, 0.95, no |
| `hydrant` | lathed body r 0.13, 0.75 high, two side caps, bonnet; red | 0.2, 0.75, no |
| `bin` | lathed drum r 0.28, 0.9 high, rim | 0.3, 0.9, no |
| `flagpole` | post r 0.06 to 9 m, ball, a flag quad 1.8 × 0.9 (double-sided, colour by variant, neutral set) | 0.12, 9, no |
| `cannon` | wooden carriage 1.6 × 0.7 × 0.55 on four lathed wheels, lathed barrel 2.4 m, r 0.2 to 0.13, raised 6° | 1.3 × 0.5 box, 1.1, yes |
| `plinth` | stone base 1.6 square, 0.4; die 1.1 square to 1.8; cap; a bronze-green block 1.6 high on top (no figure: we do not sculpt) | 0.9, 3.4, yes |
| `fountain` | lathed basin r 2.2, rim 0.5 high, centre column 1.6, bowl | 2.3, 0.6, yes |
| `post_box` | box 0.45 × 0.4 × 1.15, rounded top (prism), red | 0.3, 1.15, no |
| `sign_stop` | post to 2.2 m, octagon 0.6 across, red, double-sided | 0.08, 2.2, no |
| `bike_rack` | three inverted-U hoops 0.8 high, 0.9 apart | 1.2 × 0.4 box, 0.8, yes |
| `rail_iron` | (for lines) post r 0.03, 1.05 high every 2 m; top rail and mid rail boxes 0.05 | from the wall record |

No lettering, no logo, no flag of a real state on any prop. `gen/trees.js`: `lod 0` (far): trunk of 5 sides and
a crown of two rings and a tip (≤ 70 triangles); `lod 1` (near): trunk of 8 sides with a flare, 3–5 crown lobes
(squashed spheres of 3 rings × 8) placed by `form` (`round`: clustered; `vase`: a high wide cluster on a long
trunk; `column`: stacked; `cone`: conifer tiers; `spreading`: wide and low). Season: `summer` the leaves
material; `autumn` vertex tint per tree from a seeded pick of green, yellow, orange, red (conifers stay green);
`winter` no lobes on broadleaf trees, 6 bare branches (thin boxes) instead; `spring` lighter green and 20 %
smaller lobes. Soups `"wood|t"`, `"leaves|tv"`.

**Tests** (`engine/test/props.test.js`, builder tests):

- Every kind in the kit builds at yaw 0 and 90°: triangle count within its bound; every vertex within the
  kind's stated size box (rotated); the lowest vertex at `y` (it stands on the ground, ± 0.02); collider present
  or `null` as the table says; yaw 90° is the yaw-0 soup rotated (compare sorted vertices to 1e-6).
- An unknown kind in a scene is skipped with one warning, not an error.
- Each tree `form` and `season` builds; `winter` broadleaf has no triangle in `leaves`; the same tree twice is identical; crown radius of the built tree within 15 % of the record's.
- Physics: the capsule is stopped by a bench and a cannon and passes between two bollards 1.6 m apart.
- Builder: a 100 m road, spacing 28, stagger → 4 lamps, alternating sides, each `offset + width / 2` from the axis; a mapped lamp at 14 m removes the first ruled one; a lamp that would stand in a building moves to the other side; `amenity=bench` with `direction=180` → yaw 180; an inventory tree 2 m from an OSM tree replaces it; a tree in a footprint is dropped.
- Builder, the merged tree layer: an inventory tree 2 m from an OSM tree gives ONE tree at the inventory's position with the inventory's species and diameter; an inventory tree with no species 2 m from an OSM tree tagged `genus=Acer` gives one tree with genus `Acer`; an OSM tree 10 m from any inventory tree is kept; with an enricher present `sources` holds two entries whose `layers` include `trees`, one ODbL and one CC-BY-4.0, and the scene's `rules` says the layer is ODbL as a whole.

**Budget.** Props are `near`: ≤ 25 k triangles per cell; trees in `far` ≤ 70 × count. Scene file: ≤ 22 bytes a
prop, ≤ 30 a tree. **Proof.** Views 1, 2, 3, 4, 5. **Done** when tests pass and the planning model has looked at
each kind alone (a contact sheet of the kit, one prop per picture, taken in photo mode on the test scene).

### Item 9 — Landmarks from building parts

**Goal.** A building mapped with `building:part` is drawn from its parts (towers, wings, steep roofs,
turrets), each with its own measured height.

**Contract** (section 4): the engine's side is built. An outline with `parts: 1` is skipped when the scene says
`formatMinor >= 1`; a part is walled, roofed and solid from `yBase + mh` (`test/parts.test.js`). This item writes
the data and, in `roof.js`, the round roofs.

**Do.** `parts.py`: a part takes `h` from item 2's measurement over its own ring; `mh` from `min_height` or
`building:min_level × storey`; a part whose ring lies inside a larger part of the same building and is at most
12 m across is a tower: its `g` is the building's `g` (so `yBase` matches), and its default roof is `pyramidal`
(`cone` when the ring has ≥ 8 vertices and is within 10 % of a circle) with `rh = clamp(1.4 × width, 3, 18)`
unless measured. Parts inherit `fa`, `pal`, `rmt`, `rp`, `use` from their outline unless tagged. A building
with `height ≥ 40` or `levels ≥ 12` and a flat roof that has no parts gets ruled setbacks **only when the
surface model shows them**: slice the samples in 3 m bands; where the area of samples above a band falls below
70 % of the footprint, write a synthetic part (the footprint inset by the distance that gives that area, via
the same inset rule as item 4 implemented in `geom.py`) from that height up; at most three; `rules` says so.
`roof.js`: cone and dome on rings that are circles (already covered), nothing else new.

**Tests.** A part with `min_height=12` has `mh = 12` and its collision starts there (item 3). A tower part
inside a wing gets `pyramidal` and the outline's façade. A synthetic stepped surface (30 × 30 to 40 m, 20 × 20
to 60 m) yields one synthetic part within 1 m of 20 × 20 from 40 m. On the scene: the hotel's outline is skipped
and its parts have at least 4 distinct heights.

**Budget.** ≤ 60 parts added. **Proof.** Views 2 and 6: a skyline with a tall central tower, turrets and steep
green roofs; the office tower steps back as it rises. **Done** when the pair shows it. If the data does not
carry a landmark (no parts, nothing in the surface model), it stays a plain building: say which.

**Built (branch `landmarks`, 2026-11-16): place-level landmark rules.** What the data lacks is written in the place file, not in code:
`places/<id>.json` → `landmarks: [{ id, match: { osm | wikidata | name }, source, fill, set, turrets, terrace, prop }]`
(`tools/scene_builder/landmark_rules.py`, `terrace.py`, `props.py`). `fill` makes parts of the area of an outline that no mapped part covers
(a 0.5 m raster, traced and simplified; measured like any part); `set` gives the building and its parts a façade, palette, roof material,
the style's roof colours instead of the tagged one, and a `look`; `turrets` adds round corner turrets with conical roofs on the outer square
corners of the parts (**estimated**: `syn: 1`, `hs: "rule"`, one sentence in `rules.landmarks`); `terrace` turns a mapped pedestrian area into a deck
with its cliff-side balustrade and lamps; `prop` gives one named node its own prop kind. A `look` is a table in the style pack
(`client.looks.<name>`, `gen/landmark.js`): string courses, corbel table, oriel bays, ridge cresting, finials, a porte-cochère canopy, a flagpole,
and overrides of the window bay, dormers and chimneys for that building. A passage through a part belongs to the part (`walls.passages`), and a
part keeps its measured roof over a passage. The first landmark rule is the one for the Château Frontenac in `places/old-quebec.json`; its
`source` field lists what is data and what is estimated.

### Item 10 — Light and air

**Goal.** The place is shown in flattering light by default, from data; what is not real is listed.

**Do.** `engine/src/world/engine.js`: where `params.tod`, `day`, `haze`, `cloud`, `wet` are read, fall back to
`source.manifest.ambience` (the reader hands it on since item 3; `null` when the scene has none) before the
built-in default (three lines; a host's switch still wins). `places/*.json`
`ambience`: chosen by looking at the six views at `tod` 8, 10, 14, 16.5, 18.5 and haze 0.15, 0.3, 0.45 (a
contact sheet), keeping the one where façades on both sides of views 1 and 5 show relief and the far town in 4
and 6 is still separated by air. `core/atmosphere.js`: only if a view shows a fault (banding, a black sky
side); no new feature. Ambient occlusion at `low` stays off (measure it once: if `ao` costs under 10 % of frame
time at `low`, report it as a decision, do not switch it). Report, in `engine/README.md` under "Light and air",
what is stubbed today: rain and puddles (`ground.setRain`, `isPuddle`), reflections, the backdrop, wetness as
one value for the whole scene, water as one flat sheet, no night lighting of lamps or windows, no clouds'
shadows, no seasonal light.

**Tests.** `world-api.test.js`: a scene with `ambience.tod = 17` starts at 17; with `params.tod = 9` at 9.
**Proof.** All six views, before and after. **Done** when the pairs are chosen by the planning model.

### Item 11 — Proof of reuse

**Goal.** A second place of different character, built with data only, and **published**: `scenes/lunenburg.json`
is committed to `scenes/` beside Old Quebec (section 8, decision 7), with its sources and licences in the file.

**Place.** The old town of Lunenburg, Nova Scotia: a planned grid of painted wooden houses on a slope down to a
wharf, the opposite of a walled stone town. Checked 2026-11-16: the HRDEM `dsm` and `dtm` answer there
(surface 2–13 m over ground 2–4 m at 44.377, −64.3105), and OSM has 406 buildings within 300 m, almost none
with levels or roofs — which is the point: the style pack and the measurements must carry it. UTM zone 20.
Fallback if a source fails: downtown Moose Jaw, Saskatchewan (50.3925, −105.5345; HRDEM answers there too).

**Do.** `places/lunenburg.json` (anchor 44.3770, −64.3105; `play` 200 × 150 half sizes; margin 80; terrain cell
2.5; `geoid_undulation` from NRCan's GPS·H for that point, about −21 m — look it up and cite it in the file's
`note`; `style: "atlantic-wood"`; `ambience` chosen as in item 10; no enricher). `styles/atlantic-wood.json`
(`extends: canada`: wood siding 6 : brick 1; palettes of strong painted colours — red, ochre, blue, green,
white, with white trim; gabled 5 : hipped 1 : mansard 1 at 40°; shingle roofs dark grey; 2.9 m storeys; bay
2.2–2.8, window 0.9 × 1.6, shutters 0.05; `lamp_cobra`; asphalt streets with concrete sidewalks both sides;
trees round). `engine/tools/viewpoints/lunenburg.json`: two views (a street looking down the slope to the
water; the waterfront looking back up at the town) plus an overview. Build, take the pictures, measure the
budgets.

**Tests.** The builder's unit tests run for both places from their caches. `git diff --stat <start of item>..HEAD`
lists only `places/`, `styles/`, `scenes/`, `engine/tools/viewpoints/`, `docs/`. `engine/test/scene.test.js`
gains the generic checks (georeference check points, every record valid) run over every file in `scenes/`.
**Done** when the two pictures read as a different town drawn by the same engine. **If a code change proves
necessary, the item stops**: the change is a finding (the assumption that leaked), fixed in its own commit in
the item that owns the file, with a test, and listed in the report.

## 7. What stays with the planning model

| What | Why |
|---|---|
| Review of item 3 before items 4–9 start | Every later item builds on its contracts; a wrong cell or record shape costs six items |
| Colours, proportions and material look (items 5, 8, 10; the style packs' palettes) | "Reads as the real place" is a visual judgement against the pictures, not a testable rule. The values in 2.2 are a first cut to be tuned by looking |
| Each before/after pair | `AGENTS.md`: look at every picture before claiming an improvement. The executing agent attaches the pairs; the judgement is made on them |
| Budget overruns | Whether to cut detail, change `R`, or merge meshes is a trade between look and speed |
| Anything a generator cannot do exactly (a roof the inset rejects, a passage that leaves no pier) | The fallback is specified; a *pattern* of fallbacks in a real place means the algorithm, not the data, needs work |
| The straight skeleton | The roofs here are exact on rectangles and conservative elsewhere (an inset and a flat top). A true skeleton would give ridges on L-shaped houses; it is a contained, hard piece of geometry worth doing once, by the planning model. Scheduled: `ENGINE-SCALE.md` item K6 (section 8) |

## 8. Decisions

### Taken by the maintainer (2026-11-16)

| # | Decision | Effect on this plan |
|---|---|---|
| 3 | **Trees: as good as possible.** Use the best data available for every tree: the city tree inventory (species, trunk diameter) where one exists, merged with the OpenStreetMap trees elsewhere, de-duplicated. The merged tree layer is ODbL as a whole (the scene's buildings and roads already are); both sources are credited | Item 8 (builder text and one more test). Cost: the tree layer cannot be offered outside share-alike |
| 7 | **The proof-of-reuse scene is published.** Lunenburg, Nova Scotia is committed to `scenes/` | Item 11 owns `scenes/lunenburg.json`; the engine's generic scene checks run over it |
| — | **Where this plan left quality against simplicity open, choose quality and state the cost.** | Applied below |

### Settled by that principle (planning model, 2026-11-16)

| # | Was open | Now | Cost, stated |
|---|---|---|---|
| 2 | Terrain at 1 m against 2.5 m | **1 m is the target.** This plan keeps 2.5 m (mean of the 1 m samples) only until the chunked packaging exists, because a single file would pass the format's 2 MB limit. The chunked writer and reader are `docs/plans/ENGINE-SCALE.md` items K1 to K3; item K4 there rebuilds both scenes at 1 m | About 1.5 MB per km² after compression (format section 8) and the chunked reader in the engine |
| 5 | Ambient occlusion at `low` | **On, when item 10 measures it under 10 % of frame time at `low`**; otherwise off and the measurement is reported. No further decision needed | Up to 10 % of frame time at the lowest tier |
| §7 | Roofs: an inset and a flat top on irregular footprints, or a true straight skeleton | **The straight skeleton is built** (`ENGINE-SCALE.md` item K6, planning model), after items 4 and 9 have landed and their pictures show where the inset roofs fall short | One contained, hard piece of geometry; a risk of slivers on bad footprints, so the inset stays as the fallback |
| 1 | Pictures in the repository | Contact sheets only are committed per item (one JPEG per item, six views, before above after); full-size pairs are attached to the item's report. The "before" set already committed stays | Full-size history lives in reports, not in git |

### Still the maintainer's

4. **`world.stats()` and `world.photo()`** were added to the world API (additive). They stay on the contract
   unless he says otherwise (`docs/CONTRACTS.md`).
6. **Parked vehicles**: none. We own no vehicle model and this plan writes none; a procedural car that does not
   look like a toy is artist's work. Quality here needs a source of models, which is a purchase or a licence.
8. **Which model executes** follows `AGENTS.md`; item 3 stays with the planning model.

## 9. Sources and licences

Verified on the source's own page on 2026-11-15/16 unless marked.

| Source | Used for | Licence | Where read |
|---|---|---|---|
| OpenStreetMap, through Overpass | every vector layer | ODbL 1.0, "© OpenStreetMap contributors" | openstreetmap.org/copyright |
| NRCan HRDEM Mosaic, `dtm` and `dsm`, WCS 1.1.1, 1 m | terrain; measured building and tree heights, roof pitch and direction | Open Government Licence – Canada; "Contains information licensed under the Open Government Licence – Canada." | open.canada.ca dataset `0fe65119-e96e-4a57-8bfe-9d9245fba06b` |
| Ville de Québec, Arbres répertoriés (`vque_26`): 157 434 trees, 696 in the box, species and trunk diameter | tree species and size (enricher) | CC BY 4.0 ("Attribution (CC-BY 4.0)") | donneesquebec.ca/recherche/dataset/vque_26 |

Looked at and **not used**, with the reason: Ville de Québec building footprints and pedestrian network
(CC BY 4.0, but no height, width or step count: OSM plus the surface model give more, and mixing them into an
OSM layer gains nothing); the provincial building reference (CC BY 4.0, roof altitudes per footprint: a possible
enricher of kind `footprints` later, unverified whether its altitudes are roof or ground); the provincial lidar
point cloud (CC BY 4.0, LAZ needs a decoder that is not in the standard library); classified heritage buildings
(CC BY 4.0, construction dates for 46 points in the box: a possible enricher of kind `dates`); the 2021
orthophoto of the Québec metropolitan community (**CC BY-NC-SA: excluded**); no open orthophoto covers the box;
the city publishes no 3D model, no roofs, no street lamps and no street furniture. What OSM holds in the box
(2026-11-16): 1 046 buildings, 21 building parts (9 on the Château, none with a height), 4 street lamps, 170
benches, 91 cannons, 16 flagpoles, 141 crossings, 100 stairways (49 with `step_count`), 487 trees (5 with a leaf
type), 125 mapped sidewalks, 5 gate buildings.

## 10. What will still fall short of a hand-built level

Stated now so nobody is surprised by the "after": signs with lettering, shop names and window displays;
weathering, stains and decals placed with intent; interiors; vehicles; statues and carved stone (the landmarks
get their massing, not their ornament: the Château's dormers, finials and brickwork are an artist's or a
licensed model's work, through `models/` of the format); real façade textures (no open street-level imagery
allows it); people. Each is either artist's work or a licensed asset; none is blocked by the engine.
