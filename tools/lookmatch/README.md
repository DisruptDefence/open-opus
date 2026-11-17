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
