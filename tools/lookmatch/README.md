# lookmatch: compare a render with open photographs and propose light settings

Today a person renders a fixed viewpoint, looks at a street photograph, lists the gaps and changes style values by
hand. `lookmatch` does that loop, repeatably, for any place: it fetches open-licensed photographs taken near each
viewpoint, renders the same viewpoints, measures photographs and renders in exactly the same way, and writes a
comparison sheet, a numbers file and proposed changes to the scene's light settings (`ambience.look`).

It is a tool, not engine code: it names no place, adds no dependency (Node standard library, the repository's own
`engine/src/geo/georef.js` and `engine/src/core/atmosphere.js`, and Playwright given as a path, as the engine's
tools take it), and it **never edits a place file unless `--apply` names one**.

```
node tools/lookmatch/lookmatch.mjs <command> --scene scenes/<id>.json --views engine/tools/viewpoints/<id>.json --work .lookmatch/<id>
```

The work folder is git-ignored (`.lookmatch/`). Commands: `fetch`, `render`, `measure`, `report`, and `run` (all four in order).

| command | what it does | options |
|---|---|---|
| `fetch` | per viewpoint: game metres to latitude/longitude with the scene's georef, heading from grid to true north; asks Wikimedia Commons (and Mapillary when `MAPILLARY_TOKEN` is set) for photographs within the radius, filters and ranks them, downloads the best into `<work>/photos/<view>/` with `sources.json` (the attribution record) | `--radius 80` metres, `--widen 150` (used once when nothing is found, `--no-widen` to refuse), `--per-view 6`, `--only id,id`, `--offline` (cache only) |
| `render` | runs `engine/tools/photo.mjs` into `<work>/renders/`; the engine must already be served | `--engine-url`, `--playwright` (or `ENGINE_URL`, `PLAYWRIGHT`), `--look file` (a proposal or look JSON, laid over the scene's look by the URL switch), `--quality high`, `--only`, `--lock file` (run under `flock`), `GPU=1` passes through |
| `measure` | the same numbers for every photograph and render, written to `measure.json`, plus region overlays | `--playwright`, `--only` |
| `report` | `report.html`, `gaps.md`, `proposal.json`; with `--apply places/<id>.json` the proposed look is merged into that file's `ambience.look` (keys of `DEFAULT_LOOK` only) and what changed is printed | `--look file` (the look already laid over the scene's), `--before <round>` (show an earlier round's render and gaps beside), `--apply` |

`--round <name>` on `render`, `measure` and `report` suffixes their files (`renders-r1/`, `measure-r1.json`, ...) so rounds sit side by side.
A round uses the previous proposal: `render --round r1 --look <work>/proposal.json`, `measure --round r1`, `report --round r1 --look <work>/proposal.json --before base`.
The proposal's `look` is cumulative (what `--look` already carried, plus the new changes).

## Measures

Taken identically on every photograph and render, at 320 px width, in CIELAB (sRGB to linear to XYZ D65 to L*a*b*; `lib/color.mjs`). Defined in the header of `lib/measure.mjs`.

- **sky**: pixels 4-connected to the top edge that are bright (L* >= 55), blue-or-grey (b* <= 14, chroma <= 50) and smooth (gradient < 8): flood fill.
- **ground**: pixels 4-connected to the bottom edge, below the horizon row (the median over columns of the sky height) and in the lower 45 % of the frame, with chroma < 20 and not sky.
- **walls**: the rest (buildings, trees, people, cars). Sky share under 3 % or over 70 % is flagged "poor framing" and the photograph gets half weight.
- **per region**: share; mean L*, a*, b*; L* p10, p50, p90; mean chroma; hue of the mean.
- **contrast**: L* p90 minus p10 over the whole image.
- **shade and sun**: walls, ground and both together are split at their own Otsu threshold on L*: dark and lit mean L*, a*, b*, shares, and the ratio dark/lit.
- **busyness** (rough stand-in for window density and street detail): mean gradient magnitude on walls, and the share of wall pixels darker than the walls' median minus 25.
- **colourfulness of walls**: standard deviation of a* and b*, and five dominant colours (seeded k-means, k = 5, 10 iterations) with shares.

Photographs left out of the numbers after measuring (`usable()`): mean L* under 30 (night), over 88 (washed out), mean chroma under 6 (monochrome scan), no sky and under 5 % ground (a close-up, not a street).
The **reference** of a view is the weighted median over its photographs (weight 1, or 0.5 for poor framing).

## Proposal rules (`lib/proposal.mjs`)

All damped (60 % of the gap is applied, so a rerun converges rather than oscillates) and clamped, computed on the median over views:
`exposure` (median L* gap of walls and ground through the L*-to-luminance curve, step x0.8..x1.25), `saturation` (reference/render wall chroma, step 0.85..1.2),
`skySat` (the same for the sky), `skyTint` / `shadows` / `highlights` (RGB multipliers within +-6 %, luminance kept, from the a*, b* gap of the sky, the dark part and the lit part),
`env` (+-25 %) and `bounce` (+-20 %) from the shadow/lit ratio gap, `curve` (0.006 per L* of contrast gap, at most 0.1). Each change lists its reason and numbers.

## Licences, sources and terms

- **Kept**: CC0, public domain, CC BY (any version), CC BY-SA (any version). Anything else, an unknown or empty licence, and any NC / ND variant is dropped, always.
  Attribution (title with page link, author, licence with link) is written into `sources.json` and printed under every photograph in `report.html`.
- **Photographs stay in the git-ignored work folder and are never committed or shipped**, nor any crop or pixel-derived texture. The numbers (`measure.json`, `proposal.json`, `gaps.md`) are derived and may be kept.
- **Wikimedia Commons** (no key): the public API, a generic `User-Agent` (`lookmatch/1 (open-source scene tool)`) and nothing else identifying in any request, at most two requests a second, a pause on HTTP 429 as the server asks, every response cached under `<work>/cache/`.
- **Mapillary** (only when `MAPILLARY_TOKEN` is set; the token is sent in the `Authorization` header only and is never printed or cached): Graph API images in a bounding box, licence CC BY-SA 4.0, compass angle always known. Written from the public documentation and unit-tested against hand-made fixtures; **not yet run against the live service**.
- Ranking and street-photograph rules are in the header of `lib/rank.mjs` (size, aspect, subject words, scans before 1995, winter months, night hours, facing away, distance, heading).

## What part 2 would add

Reading per-building facts (storeys, window rhythm, wall and roof colours) from photographs of single buildings. The pieces it would reuse: the fetch and its attribution record, the browser decoder, the region and colour measures, and the work-folder layout. Not built.

## Limits

- The region rules are rough: pale walls and overcast skies blur into each other, trees and cars count as "walls", wet or sunlit ground can fail the low-saturation test, and a building reaching the top edge can be taken for sky.
- Coverage is uneven: some viewpoints get many photographs, some few; camera headings are almost never recorded, so most photographs look in an unknown direction and the reference mixes directions.
- Photographs differ from a render in lens and field of view, time of day, season, weather, grading by the photographer and sensor processing; the sky and the sun's strength differ most. A gap is a hint to look at, not proof of a fault.
- The proposal changes global light settings only; it cannot see geometry, texture or colour of single buildings.
- Measures run on 320-px images, so fine detail (the busyness measure) is coarse.

## facts: palette zones from photographs, and (unrun) one façade from posed imagery

Part 2 of the look work: take FACTS about buildings (wall material and colour, trim, roofs) from the photographs and give them to the scene as an
optional enricher, so the town's colours follow the real ones where there is evidence. Code in `tools/lookmatch/facts/` (own tests in
`facts/test/`); the builder side is `tools/scene_builder/facade_facts.py` (enricher kind `facades`, `docs/SCENE-FORMAT.md` 4.2). Nothing here names a place.

```
node tools/lookmatch/lookmatch.mjs facts --scene scenes/<id>.json --views engine/tools/viewpoints/<id>.json --work .lookmatch/<id> --offline \
     [--out <file>] [--radius 80] [--min-photos 3] [--grid yes] [--only <photo ids>] [--overlays none] [--posed yes --hfov 75 --eye 1.6]
```
It works from the photographs already in the work folder (`fetch` first); it never goes to the network. Output: `<work>/facts/palette-zones.json` (or `--out`),
`<work>/facts/overlays/<photo id>.png` (the picture and, beside it, every pixel painted by what it was taken for and every wall pixel by its cluster colour, with the
label and the numbers under it), and `<work>/facts/photos-analysis.json` (every photograph's clusters).

### Stage A: local palettes from Commons photographs (run)

A zone is a disc (default 80 m) round a viewpoint or, with `--grid`, round a cluster of three or more photograph positions (densest first, 80 m from any other centre).
A photograph belongs to every zone whose disc holds its position. A zone with fewer than 3 usable photographs (the tool's own `usable()` and weight: 0.5 for poor framing) is dropped.

Per photograph (rules and every threshold in one table, `facts/lib/rules.mjs` `RULES`; each rule has a unit test with a synthetic patch):
1. Read at 960 px. The tool's region split (320 px) says sky / ground / wall; three corrections are made at working size: pale stone the split took for overcast
   sky (textured and not blue) is wall again; deep blue the split did not call sky is sky (flood from the sky and the top row through blue pixels); under the ground region's top edge, and grey pixels in the
   lowest 38 % of the picture, are pavement and foreground.
2. Not wall: leaves (a* <= -6, b* >= 5), glass or sky in a window (blue, b* <= -6, L* >= 42), openings (darker than the mean of the 49 x 49 px window by 14 L*, blobs of 14 px or more, grown by 1 px) and the roof band (7 % of the height under the sky edge).
3. The wall pixels are clustered in CIELAB (k-means, k = 6, seeded). Sun and shade of one paint are merged afterwards (same hue within 14 degrees, same chroma-to-lightness ratio within 0.1, L* ratio 0.55 to 0.97, chroma at least 6) and the merged cluster's colour is its sunlit part. A global lightening of the shaded half was tried and dropped: it turned dark brick into pale salmon. White paint is written with L* at least 88 (white is white in shade; the engine lights it again). Greys are never merged (a dark grey is not the shade of a white).
4. Material of a cluster from its colour and the texture of its own pixels (`e1`: mean |dL*| between neighbours; `e4`: four pixels apart; `cv`: spread of `e1` over 24 px blocks): `render` (e1 under 1.6, or last rule: lit, smooth, matched nothing else), `painted_white` (very light and colourless; or light grey in shade with little texture), `brick` (hue 20 to 65, chroma 13 or more, L* 28 to 68, e1 2.4 or more, cv under 0.9), `stone` (chroma under 22, L* 30 to 83, e1 2.6 or more), else `unknown`. A smooth cluster with chroma over 52 (painted doors and shutters) is moved from the walls to the accents.
5. Accents: saturated pixels (chroma 22 or more) in a ring round the opening blobs that are not the colour of a main wall cluster. Roofs: the band under the sky edge, smooth clusters read as `copper` (green-blue), `slate` (dark grey) or `metal` (mid grey), always flagged confidence `low`.

Per zone: the photographs' clusters merged by material and colour (CIELAB distance under 13), weighted by photograph weight times cluster share; a colour needs 2 photographs in a zone of 4 or more and 5 % of the classified wall; unknown, very dark (L* under 24), dark colourless (chroma under 6 and L* under 45: shade), over-saturated and smooth grey clusters are counted as `unclassifiedShare` and left out. Confidence `high` (6+ photographs and the top colour in 60 % of them), `medium` (4+ and 40 %), else `low`.

**Output format** `opus-facade-facts/1`: `{ format, note, zones: [{ id, centre: [lat, lon], radius, walls: [{ material, colour, share, photographs }], accents: [{ colour, share, photographs }], roofs: [...], photographs, confidence, unclassifiedShare, photos: [ids] }], buildings: [], sources: [{ id, title, author, licence, licenceUrl, url }] }`. `material` is `brick | stone | render | painted_white`. The scene builder maps brick to brick, stone to the style's own stone class, render and painted_white to stucco. A copy is committed under `places/enrichers/`.

**How good are the labels.** Checked by eye on the overlays (see the run report for counts): the wall material label of the large clusters is often right for brick, ochre render and fieldstone, and wrong or doubtful for: mid and dark greys (pavement, tarmac, shadow and wet stone cannot be told from grey render or white paint by colour and 960 px texture), red and white painted roofs and doors read as brick or render, wall below the pavement line is lost, and a pale stone wall in shade reads as white. Overcast and sunny photographs of one street disagree on lightness; the zone median hides that, it does not remove it. This is a rough reading of a few photographs per zone, not a survey.

**Licences.** The file holds numbers and attributions only: sRGB hex of cluster medians, shares, counts. No photograph, crop or pixel-derived texture is stored or shipped. Every photograph that contributed to a zone is listed in `sources` with title, author, licence and page URL (needed for CC BY and CC BY-SA). The sources include CC BY-SA photographs; because only derived numbers are stored, the position taken here is that no share-alike material is redistributed. That is a statement for the maintainer to confirm, not legal advice.

### Stage B: one building, one façade, from posed imagery (written and tested on fixtures; NEVER RUN ON REAL IMAGERY)

With a source that gives camera position and compass angle (Mapillary, `MAPILLARY_TOKEN`, `lib/sources/mapillary.mjs`; no token has been available, so none of this has ever seen a real image), a façade can be tied to one building. `facts/lib/posed.mjs`:
- a pinhole camera from position, heading (compass angle minus the scene's grid convergence), an ASSUMED horizontal field of view (default 75 degrees; Mapillary does not always give intrinsics: `--hfov`) and eye height (default 1.6 m: `--eye`), no pitch, no roll;
- every front edge of every building within 60 m that faces the camera is projected into columns; per column the nearest edge wins (a farther wall behind a nearer one loses those columns; trees and cars are not modelled); a wall behind the camera is rejected;
- the strip a façade owns (columns x rows between the eave and the ground) is cropped and analysed as in stage A (clusters, material, accents), openings are counted into rows and columns (storeys, windows per storey, rough);
- per building `{ buildingId, material, colour, accents, storeys, windowsPerStorey, confidence, sources }` into the file's `buildings` list; the builder lets them win over zones (confidence 0.4 or more) and uses material, colour and accents; storeys and windows are reported only.
Tests (`facts/test/posed.test.js`) cover the projection (a camera facing a known wall puts its corners in the right columns), rejection of a wall behind the camera, occlusion, strip sampling and counting on hand-written fixtures, and `test_facade_facts.py` the precedence. Run it with `--posed yes` on photographs whose records carry a `heading`.
