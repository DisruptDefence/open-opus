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

The default work folder is `.lookmatch/` (already git-ignored; give `--work .lookmatch/<id>`): photographs, caches, renders, measures and reports live there and are never committed. Commands: `fetch`, `render`, `measure`, `report`, `run` (the four in order) and `tune` (rounds of render, measure and propose with a convergence guard).

| command | what it does | options |
|---|---|---|
| `fetch` | per viewpoint: game metres to latitude/longitude with the scene's georef, heading from grid to true north; asks Wikimedia Commons (and Mapillary when `MAPILLARY_TOKEN` is set) for photographs within the radius, filters and ranks them, downloads the best into `<work>/photos/<view>/` with `sources.json` (the attribution record) | `--radius 80` metres, `--widen 150` (used once when nothing is found, `--no-widen` to refuse), `--per-view 6`, `--only id,id`, `--offline` (cache only) |
| `render` | runs `engine/tools/photo.mjs` into `<work>/renders/`; the engine must already be served | `--engine-url`, `--playwright` (or `ENGINE_URL`, `PLAYWRIGHT`), `--look file` (a proposal or look JSON, laid over the scene's look by the URL switch), `--quality high`, `--only`, `--lock file` (run under `flock`), `GPU=1` passes through |
| `measure` | the same numbers for every photograph and render, written to `measure.json`, plus region overlays; per view the material mismatch, the framing choice and the rejections; overall the noise floors | `--playwright`, `--only`, `--look file` (recorded as the look the renders carry), `--pin <measure.json>` (reuse that round's photograph numbers and reference choices) |
| `report` | `report.html`, `gaps.md` (light and material lists, information, floors), `proposal.json` (status and evidence per key); with `--apply places/<id>.json` the proposed look is merged into that file's `ambience.look` (keys of `DEFAULT_LOOK` only) and what changed is printed | `--look file` (the look already laid over the scene's), `--before <round>` (show an earlier round's render and gaps beside), `--previous <measure json of the round before>` (the convergence guard), `--frozen key,key`, `--apply` |
| `tune` | `--rounds N` (default 3) of render, measure and propose; round `t0` renders the scene's own look, later rounds the previous proposal laid on by the URL switch only; photographs are measured once and pinned; stops early when the summed gap of the measures the changed keys target improves by under 1 %; writes `proposal-final.json` (final look, evidence line per key) and `tune.json` (light gap per round and view) | `--rounds`, `--look` (a start), `--lock file` (or run the whole command under `flock`), `--engine-url`, `--playwright` |

`--round <name>` on `render`, `measure` and `report` suffixes their files (`renders-r1/`, `measure-r1.json`, ...) so rounds sit side by side.
A round uses the previous proposal: `render --round r1 --look <work>/proposal.json`, `measure --round r1`, `report --round r1 --look <work>/proposal.json --before base`.
The proposal's `look` is cumulative (what `--look` already carried, plus the new changes).

## Measures

Taken identically on every photograph and render, at 320 px width, in CIELAB (sRGB to linear to XYZ D65 to L*a*b*; `lib/color.mjs`). Defined in the header of `lib/measure.mjs`.

- **sky**: seeded on the top edge, grown through pixels that are bright relative to the image's own upper-quartile L* (within 14) or bluish (b* <= -1.5), never under L* 25, not warm (b* <= 8), and smooth (gradient < 8, step to the neighbour <= 6); in every column the sky is the run from the top, ended by more than 6 non-sky rows. A dim grey-blue render sky and a cloudy photograph sky (dark cloud bases) are both found; edges stop it.
- **ground**: seeded on the bottom edge, grown below the horizon row (the median over columns of the sky height) and in the lower 45 % through low-saturation pixels (chroma < 20, within 25 L* of the surface at the bottom edge, no steep vertical step) that are NOT in a vertical-edge-dominated or too textured neighbourhood (walls have vertical structure and stone texture; ground does not), then cut back to solid parts (a second fill through pixels whose 7x7 square is at least 55 % ground), so grey stone façades do not speckle into ground.
- **walls**: the rest (buildings, trees, people, cars). Sky share under 3 % or over 70 % is flagged "poor framing" and the photograph gets half weight.
- **per region**: share; mean L*, a*, b*; L* p10, p50, p90; mean chroma; hue of the mean.
- **contrast**: L* p90 minus p10 over the whole image.
- **shade and sun**: walls, ground and both together are split at their own Otsu threshold on L*: dark and lit mean L*, a*, b*, shares, and the ratio dark/lit.
- **busyness** (rough stand-in for window density and street detail): mean gradient magnitude on walls, and the share of wall pixels darker than the walls' median minus 25.
- **colourfulness of walls**: standard deviation of a* and b*, and five dominant colours (seeded k-means, k = 5, 10 iterations) with shares.

Photographs left out of the numbers after measuring (`usable()`): mean L* under 30 (night), over 88 (washed out), mean chroma under 6 (monochrome), painting or scan by colour statistics (very low high-frequency energy with a posterised palette, or a sepia tone), no sky and under 5 % ground (a close-up, not a street).
The **reference** of a view is the weighted median over its photographs: weight 1, or 0.5 for poor framing; photographs whose sky share and ground share are each within a factor of 2 of the render's (eye-level street framing like the render) are preferred: with at least two of them only they count, otherwise the others count at half weight.
**Noise floor** of a measure: the median absolute deviation across a view's photographs, medianed over views (printed by `measure`, stored in `measure.json` and `proposal.json`).
**Material mismatch** of a view: earth mover's distance, in a* and b* only (lightness left out), between the dominant wall colours of its photographs and of its render. Above 10 the view is ignored by every wall-colour rule.
**Groups**: gaps are listed as *light* (L*, contrast, shade/sun ratio, sky colour: the light settings can move them) and *material and colour* (wall and ground hue and chroma, busyness, colour spread, one line per view with a large mismatch: the hand-off to style work); shade and sunlit colour are *information* only; shares are framing.

## Proposal rules (`lib/proposal.mjs`)

A rule acts on a look key only where the evidence agrees: at least 60 % of the views that have a reference and a render agree on the SIGN of the gap (one gap per view, never a median of values from different places), and the median gap exceeds the measure's noise floor. Otherwise `proposal.json` and the report say "views disagree" or "within noise" and the key keeps its value. Each key has a status (`acted`, `views disagree`, `within noise`, `no data`, `reverted`, `frozen`) and an evidence line.
Steps: `exposure` 0.4 of the L* gap of walls and ground through the L*-to-luminance curve (x0.8..1.25); `saturation` 0.6 of the wall chroma ratio (0.85..1.2, views with comparable walls only); `skySat` 0.5 (0.7..1.4); `skyTint` 0.5 of the sky a*, b* gap, each axis only with evidence, every channel within 15 %; `env` and `bounce` 0.4 of the relative shadow/lit ratio gap (25 % and 20 % at most); `curve` 0.006 per L* of contrast gap, at most 0.1 a round, total capped at 0.6 (and the proposal says when it was capped).
`shadows` and `highlights` are NOT rules: the shade and sunlit colour gaps differ in sign from view to view, so a global tint cannot serve them; they are reported per view as information.
**Convergence guard** (`lib/guard.mjs`): with `report --previous` (and in `tune`), a key changed since the previous round whose targeted gap (sum over views of |gap| over what counts as a difference, for its target measures) grew is reverted to the previous round's value, marked "reverted: made it worse", and frozen for the rest of the run.

## Licences, sources and terms

- **Kept**: CC0, public domain, CC BY (any version), CC BY-SA (any version). Anything else, an unknown or empty licence, and any NC / ND variant is dropped, always.
  Attribution (title with page link, author, licence with link) is written into `sources.json` and printed under every photograph in `report.html`.
- **Photographs stay in the git-ignored work folder and are never committed or shipped**, nor any crop or pixel-derived texture. The numbers (`measure.json`, `proposal.json`, `gaps.md`) are derived and may be kept.
- **Wikimedia Commons** (no key): the public API, a generic `User-Agent` (`lookmatch/1 (open-source scene tool)`) and nothing else identifying in any request, at most two requests a second, a pause on HTTP 429 as the server asks, every response cached under `<work>/cache/`.
- **Mapillary** (only when `MAPILLARY_TOKEN` is set; the token is sent in the `Authorization` header only and is never printed or cached): Graph API images in a bounding box, licence CC BY-SA 4.0, compass angle always known. Written from the public documentation and unit-tested against hand-made fixtures; **not yet run against the live service**.
- Ranking and street-photograph rules are in the header of `lib/rank.mjs` (size, aspect, subject and medium words, dates before 1990 only when nothing else exists, winter months, night hours, facing away, distance, heading). The word lists (painting, drawing, engraving, map, plan, postcard, old-work templates, in English and French) are data in `lib/data/subject-words.json`. `sources.json` records the candidates rejected by each rule; `measure` adds the content rules and the framing choice, and the report prints both per view.

## What part 2 would add

Reading per-building facts (storeys, window rhythm, wall and roof colours) from photographs of single buildings. The pieces it would reuse: the fetch and its attribution record, the browser decoder, the region and colour measures, and the work-folder layout. Not built.

## Limits

- The region rules are rough: pale walls and overcast skies blur into each other (a bright, smooth, neutral wall touching the top edge or a bright grey stone wall beside the sky can be taken for sky), trees, grass, lawns and cars count as "walls", wet or sunlit ground can fail the low-saturation test, and cobbles with deep joints are only partly ground.
- Coverage is uneven: some viewpoints get many photographs, some few; camera headings are almost never recorded, so most photographs look in an unknown direction and the reference mixes directions.
- Photographs differ from a render in lens and field of view, time of day, season, weather, grading by the photographer and sensor processing; the sky and the sun's strength differ most. A gap is a hint to look at, not proof of a fault.
- The proposal changes global light settings only; it cannot see geometry, texture or colour of single buildings.
- Measures run on 320-px images, so fine detail (the busyness measure) is coarse.
