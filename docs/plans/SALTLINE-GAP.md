# What the stand-in game does for surface and light that the engine does not

Written 2026-11-16 from a read of the stand-in's bundle (`reckon-opus/index.html`, one esbuild bundle; "statements" below
are the indices `engine/tools/lift.cjs` uses, i.e. `lift.config.json` `from`/`to`; they are not file lines, the bundle is
one minified line per script).

**The finding that shapes everything below.** The stand-in's *texture library* (statements 371-416, `createMaterials`) is
already lifted, and so is its *renderer* (353-367). So the engine has the same procedural PBR sets (GPU-baked albedo /
ORM / normal), the same triplanar + macro-variation + wet shader patch, the same advanced pipeline (AO, bloom, soft
shadows). What the engine lacks is not that machinery; it is **what the stand-in feeds it**: its own generators, tuned for
one place, rich in height and occlusion, and its **hand-written surface shaders** for the ground (statements 637-639),
which do not go through the library at all. The level builder proper (417-660) is almost all *modelling* of one harbour
(crates, rails, cranes, a roof; props and structure), not surface quality, and is not worth lifting for texture.

## Ranked by visible return

| # | What the stand-in does | Where (statements) | Engine today | Status here |
|---|---|---|---|---|
| 1 | **Height + occlusion carry the realism.** Every generator writes a height map (becomes the normal map) and an AO channel: mortar and joints sit 5 mm back and are dark in AO, not painted black; block edges have an arris; chips, pits and cracks have depth. Colour is varied per unit (brick, block) from a hash, with a rare outlier (burnt, pale) | 371-416 generators (`Tn.brick` etc.) | `facade` was one flat wall with a black joint line and a flat painted window | **done**: `materials/facades.js` |
| 2 | **Real unit size.** Brick is 230 x 76 mm, 8 x 24 to 1.8 m; the engine's wall block was 0.6 x 0.4 m everywhere, so brick read as huge tiles | `c3.brick` (tile 1.8 m) | brick façade class used the stone bay | **done**: `facade_brick`, 13 x 42 to a 3.0 x 3.2 m bay, running bond, header course |
| 3 | **Windows with depth in the texture:** recessed glass at a lower height, reveal shadow in AO, sash and muntins, panes that differ, sill that projects with a drip stain below, lintel | the stand-in's `glass`, `paint` sets with `OV` damage layers | one flat blue rectangle with a white frame | **done** (bay shader) |
| 4 | **Damage model shared by all paints** (chips, scratches, run-down stains, wear zones in clusters, "most of the panel is clean") | shader prelude `paintDmg`, `chipsF`, `scr` (in `e3`) | not used by outdoor sets | open: reuse `paintDmg` for shutters, doors, railings, painted trim |
| 5 | **Ground shader by world position, not by UV:** two detail scales (0.21 m and 1.37 m), per-slab hash tone, expansion joints with tar, cracks sealed with tar, painted marks with sub-centimetre world-space chipping, traffic-polished lanes, oil, bicubic-sampled big masks so no texel shows | 637 (`TR`, `AR`), 633 `Cb` (detail + detail-normal baked on the CPU), 636 `Pb` (marks) | ground sets tile every 2-6 m with only `macro` noise on top; repeats are visible down a street | open, and **owned by the ground agent** (`gen/ground.js`); the shader is a drop-in `onBeforeCompile` for the ground material |
| 6 | **Wet ground:** puddles by height mask, soaked band, damp fringe, film, ripples, a blurred planar reflection that tightens at grazing angles | 637 (`RR`), 638 `Ib` (material), 639 (reflection target) | the library's `wet` uniform darkens and lowers roughness; no reflection | open; costs a second render of the scene, so quality tier `high` only |
| 7 | **Anti-tiling across a surface:** the same tile never reads twice because world-space masks (puddle height, wear, oil) modulate it | 637 `uMask` + `gBicubic` | `macro` (one noise, 0.12-0.3 strength) | partly: macro exists; a per-scene wear mask is open |
| 8 | **Sky / sun / fog tuned as a set**, a low sun with a warm horizon and a cool fill, haze uniforms on the water, a skyline of dim lit boxes with blinking lights, gulls | 617-619 `Mb`, `wb`, 605 `pb`; `SUN`, `SKY` in the shared head | `core/atmosphere.js`: time of day; no skyline backdrop | open: the skyline idea (cheap far boxes with a dim emissive) is a backdrop item, not a texture item |
| 9 | **Decals with their own ORM + normal** (bullet holes, scorch, soot) so a hole has depth | 668 table, 12170-12211 | `mats.decal` is lifted and works | nothing to do |
| 10 | **Label atlas** merging per-mesh canvases into one draw call | 562 `rb` | not needed: the engine has no per-mesh canvas | skip |

## What was done in this change

Items 1-3, in `engine/src/materials/facades.js`: a new generator for the façade bay replaces the flat one and the brick
and rubble façade classes get their own bay (`gen/style.js` `FACADE_FAR_SOUP`, `materials/outdoor.js` `FACADE_MATERIAL`:
one line each). See Result below.

## Result

`saltline-lift-contact.jpg`: left before, right after, from viewpoints 1 (upper street) and 5 (lower street), `q=high`.
Brick now reads as brick (real size, running bond, header courses), masonry has recessed lime joints and an arris,
windows are six-over-six sashes set back in dressed surrounds with sills and lintels, and a string course marks every
floor. A first version of the stucco (large patches where the render had fallen away) read as dirt blotches and was
cut back to rare, small, pale patches. Tests: 141 pass, 0 fail. Frame cost is unchanged in kind (texture bake once per set).

Still not done: ground by world position (items 5-7), identical windows on every bay of a material (needs several bay
variants picked by seed in `gen/style.js`), near façades (placeholder until item 5 of SCENE-DETAIL), roofs and the far
ring (view 2 still shows plain grey hulls and flat grass).
