# Rue Saint-Louis material palette → CC0 sets (2026-11-16)

The PO's palette board of Rue Saint-Louis (private reference, not shipped) gave 30 materials. For each material that is a
surface, this table lists the target colour (mean of the swatch, sRGB) and the closest sets of the CC0 library by colour
distance (CIE Lab ΔE, lower is closer) within the right kind. A colour is a fact, not a copy of the picture; no pixels of the
board or of any Street View capture are used. Machine-readable: `styles/quebec-swatch-map.json`. The sets listed are in the local
library (`assets/textures/pbr/`, git-ignored); adopt one by un-ignoring it in `.gitignore` and naming it in `client.detail` of the style pack.

| Material | Target | Best set (ΔE) | Next (ΔE) | Next (ΔE) |
|---|---|---|---|---|
| Grey limestone masonry | `#a69481` | `granite001a` (2.4) | `stone_wall` (2.5) | `white_sandstone_blocks_02` (6.6) |
| Terracotta brick | `#ab7556` | `brick_wall_006` (1.8) | `large_red_bricks` (2.6) | `bricks086` (6.3) |
| White painted masonry | `#dfdbd8` | `bricks060` (-6.6) | `plaster002` (-5.9) | `plaster003` (-5.6) |
| Warm beige mortar | `#c6ad90` | `plastered_wall_02` (10.5) | `plastered_wall` (12.0) | `beige_wall_001` (13.9) |
| Cream painted trim | `#e6d2b2` | `wood061` (7.8) | `plastered_wall_02` (8.2) | `plaster001` (8.3) |
| Weathered stone sill | `#938374` | `castle_wall_varriation` (4.0) | `bricks018` (4.5) | `bricks068` (4.6) |
| Dusty blue painted wood | `#507286` | `paintedwood008a` (3.5) | `blue_painted_planks` (4.1) | `paintedwood008b` (7.4) |
| Burgundy painted wood | `#6d2b39` | `weathered_brown_planks` (18.9) | `wooden_panels` (19.8) | `peeling_painted_wall` (20.6) |
| Red painted wood | `#c73236` | `paintedwood003` (9.3) | `paintedwood006a` (24.9) | `paintedwood006b` (37.3) |
| Sage green painted wood | `#708871` | `paintedwood009b` (-4.0) | `paintedplaster011` (3.1) | `paintedplaster012` (3.1) |
| Dark stained wood | `#563b2b` | `planks015` (5.8) | `planks013` (5.9) | `wood060` (6.8) |
| Black wrought iron | `#776e66` | `metal019` (2.7) | `metal005` (6.8) | `metal024` (6.9) |
| Aged dark metal | `#584e47` | `metal_plate_02` (3.4) | `metal036` (5.4) | `metal022` (6.8) |
| Galvanized metal | `#959fa8` | `corrugated_iron` (10.2) | `metal024` (15.3) | `metal005` (15.6) |
| Charcoal roof metal | `#626d80` | `metal021` (9.2) | `metal038` (12.5) | `metal030` (12.8) |
| Black planter finish | `#313330` | `metal046b` (6.1) | `metal027` (7.5) | `metal028` (8.9) |
| Grey asphalt | `#6c6a6a` | `asphalt022` (3.9) | `aerial_asphalt_01` (4.3) | `asphalt021` (4.9) |
| Concrete sidewalk slabs | `#b2a69b` | `pavingstones108` (5.0) | `pavingstones128` (5.4) | `pavingstones125a` (5.5) |
| Granite curb | `#8b7f74` | `pavement_01` (1.7) | `concrete_pavement_02` (1.9) | `floor_pattern_02` (4.2) |
| Worn white road paint | `#a7a2a0` | `asphalt_06` (10.3) | `asphalt_04` (12.6) | `asphalt_floor` (16.0) |
| Cracked pavement | `#948c88` | `concrete_wall_001` (-5.6) | `asphalt_04` (-3.4) | `concrete_wall_009` (-1.2) |
| Evergreen foliage | `#445919` | `moss003` (3.8) | `moss004` (5.9) | `grass001` (6.6) |
| Trailing green leaves | `#67702e` | `grass004` (4.6) | `moss002` (10.5) | `ground003` (12.5) |

## Read this table with care

- ΔE under 5 is a close colour match; 5–10 is a tint away; above 10 (burgundy and red painted wood, galvanized metal,
  beige mortar, charcoal roof, worn paint) means no close set exists: tint the nearest set towards the target in the pack, or
  photograph the real thing. A negative ΔE is a name bonus for sets tagged *painted* or *cracked*, not a better colour.
- The board's swatches are textured, so a mean colour hides contrast (mortar vs block). Check each pick by eye in a render.
- Granite curb picks are pavement sets; a real rough-cut granite kerbstone (about 15 cm high, tar joints) wants geometry plus a
  granite set, not a flat paving tile.
- Not surfaces, so not matched here: reflective window glass, dark window mesh, red flowers, sky, clouds, multicolour banner
  fabric, canvas awning fabric. Glass and sky belong to the lighting pass; flowers, banners and awnings to the relief and props items.
- Gaps for the PO's own photographs, if wanted: painted clapboard/block in white with blue trim, rough fieldstone, wrought iron
  brackets.
