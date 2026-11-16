# Old Quebec: what it looks like, and the values the style pack takes from it

Status: 2026-11-16. Companion to `SCENE-DETAIL.md` 2.2 (style pack) and items 5, 6 and 10. Colours are estimates read
by eye from about 100 photographs (sunny to overcast, summer and autumn; winter snow hides roofs and ground and was
set aside). Hex values are what a surface looks like in daylight, not a paint code. Where two dozen photographs
disagree the list gives several values and the style pack picks by seed. Nothing here quotes or names a photograph.

## 1. What was looked at

- Open-licensed (may ship, may be cited): about 50 Wikimedia Commons photographs of the historic district, the
  ramparts, Place Royale, Petit-Champlain, rue Saint-Pierre, rue Saint-Paul, Sous-le-Fort, Terrasse Dufferin.
- Private look-references: about 65 further photographs, kept only in the git-ignored `reference/private/` of the
  maintainer's checkout. They were looked at and described. No texture, crop or colour map is derived from them.
- Caution for whoever repeats this: a few of the web results are synthetic or heavily graded images (over-saturated
  street scenes with perfect lamp glow). The notes below use only what several independent photographs agree on.

## 2. Observed facts and proposed values per surface

Hex lists are the style-pack palette entries; the first is the commonest.

| Surface | What real Old Quebec shows | Proposed pack value |
|---|---|---|
| Dressed grey limestone (ramparts, gates, public buildings, Upper Town corners) | Coursed ashlar, blocks about 0.3 to 0.5 m high and 0.4 to 1.0 m long, tight light joints, cool grey with brown and blue-green blocks mixed in. Sunlit it reads warm. Gates are rougher "rock-faced" blocks with smooth dressed arch rings in lighter stone. | `stone_ashlar`: `#a9a69d #b8b4a8 #9a978f #c3bfb2 #a89f8a` |
| Rubble walls (the 17th and 18th century houses, Place Royale, Petit-Champlain, side walls) | Irregular fieldstone, 0.1 to 0.3 m pieces, thick pale mortar, grey to brown, much darker where wet or shaded (near black in Petit-Champlain). Dressed lighter window and door surrounds and quoins. | `stone_rubble`: `#8d887e #7a766f #9a8a74 #6f6d6a #a39a88` |
| Painted or rendered façades | Ochre yellow and cream most often, then white, pale blue-grey, salmon. Saturated paint is on shopfronts and trim more than on whole walls. | `stucco` adds `#d6a64a` (ochre) and `#8fa6bd` (blue-grey) |
| Brick (Lower Town 19th century, commercial blocks) | Two kinds: red-brown `#8a4b3a #9a5a40` and a warm buff/yellow `#c4a574 #b98a5a` (very common around Saint-Paul, Saint-Vallier, Dalhousie). Stone string courses and window heads. | `brick` adds the two buffs |
| Steep roofs, painted sheet metal ("tole") | Standing-seam steel, factory-painted. Red `#a3262c` (Place Royale, Sous-le-Fort) and dark red `#7a2a28`; pale blue-grey `#7b9ab5`; grey `#9aa0a3`; dark grey-black `#4a4f54`; also bright green on some. Old zinc-grey is the base. | `metal_seam`: `#9aa0a3 #7d8589 #b7bcbd #a3262c #7a2a28 #7b9ab5 #4a4f54` |
| Copper roofs and turrets (gates, Château, churches) | Verdigris, a cool blue-green: `#6e9c8b`, turret cones a little more teal `#5f9487`, pale `#7aa595`. Flashings and cornice edges stay dark brown. | `copper`: `#6e9c8b #5f9487 #7aa595` |
| Slate (mansards, Upper Town institutions) | Dark blue-grey, scalloped or square tails, `#53575c #464a50`; sunlit slate shifts brown-purple at the edge. | `slate`: `#53575c #464a50` |
| Roof shape | Steep gabled houses (45 to 55 degrees, tall gable-end chimneys at the gables, 3 to 5 small dormers on the street slope, roof overhangs very little), Second-Empire mansards in the Upper Town (dormers with arched or pedimented heads, one every bay), flat roofs on 19th century commercial blocks. | already in pack: `roofPitchDeg`, `dormers`; keep |
| Windows | Tall and narrow, about 0.9 to 1.05 m wide by 1.5 to 1.8 m high, 2 casements, 6 over 6 or 3 over 3 panes, white frame, set deep in thick stone walls (reveal 0.15 to 0.25 m). Rhythm: bays about 2.5 to 3 m, a ground-floor door on the second or third bay of a three-bay house, storeys 3 to 3.6 m on rubble houses (2 or 3 storeys plus attic). | `window` unchanged (bay 2.5 to 3.1, width 1.05, height 1.75, reveal 0.18, panes 2 x 4) |
| Frames and shutters | White frames most of all; also dark green `#2f5a45`, teal `#3e7c7a`, deep red `#7d1b1a`, yellow `#e8b923`. Wooden shutters on Place Royale and Petit-Champlain houses (yellow, red, green), none on most Upper Town façades. | `frames` gains green, teal, red, yellow; `window.shutters` 0.12 to 0.2 |
| Doors | Dark red `#7a1620`, forest green `#254a38`, black, navy, plain wood `#6b4a2e`, occasionally yellow `#e0b020`. Glazed top panels, a single stone step. | `doors` updated |
| Awnings, signs, shopfronts | Shop awnings in yellow, dark red, forest green and navy, scalloped edges; hanging wrought-iron signs with painted discs or shields on rue Saint-Louis, Sous-le-Fort, Petit-Champlain; flags on façades. Signs are the biggest "missing life" element but are lettering, so artist work (plan section 10). | `awnings` unchanged |
| Cobbles and setts | Square-ish granite setts about 0.10 to 0.15 m wide and 0.15 to 0.25 m long, laid in staggered rows or in shallow fans, grey with pink-brown pieces, `#8a8780` dry, `#5d5f63` wet, dark joints. Used in the Place Royale, Petit-Champlain, Sous-le-Fort, and across gates. Very worn and smooth. | pack `street.surface`: pedestrian and living_street already `cobble` |
| Roads and pavements | Asphalt dark grey `#4a4846` with yellow centre lines on through streets; sidewalks pale grey stone flags or concrete `#9a9a96`, kerbs in grey granite, about 0.12 to 0.15 m. Stairs in grey stone or timber with green-painted iron rails. | `street.sidewalk` unchanged |
| Ramparts and gates | Grey coursed wall, crenellated parapet (merlons about 0.9 m wide), stone coping, a drum tower with a copper cone (Porte Saint-Jean, Porte Saint-Louis), segmental or pointed arch, a small pedestrian postern beside the road arch; cannons painted black or light grey on wooden carriages; grass glacis. | `walls.city_wall` unchanged; gate roofs `copper` |
| Street furniture | Black cast-iron lantern lamps (single and double globe, pole or wall-bracket), black bollards, green or black iron railings, wooden benches, hanging planters, a few flags. | `props.lamps` unchanged |
| Light | Warm low afternoon sun on stone, cool shade in narrow streets; the contrast between sunlit warm stone and blue shade is the single strongest cue. | `ambience` unchanged (tod 16.5, haze 0.3) |

## 3. Assets that may ship

`assets/textures/`: 18 JPEG tiles, 0.9 MB in all, listed with author, licence, source and modification in
`assets/textures/CREDITS.json`. All are CC0: 17 from ambientCG and Poly Haven (colour maps only, halved to 512), and one
crop of a rampart wall photograph on Wikimedia Commons (`stone_ashlar_quebec.jpg`, CC0, made seamless by an offset
cross-fade; a hint of ghosting remains in the middle). The Commons licence was read from the API's `extmetadata`;
ambientCG and Poly Haven publish no per-file licence in their APIs, so those rely on each site's CC0 policy.
Commons BY-SA photographs of rubble walls were looked at but none is shipped (share-alike on a texture of a wall is
a decision for the maintainer).

Important: the engine has no image-texture loader today. `materials/outdoor.js` draws every surface procedurally.
These tiles are therefore data waiting for a loader, not yet drawn. Slot mapping when one exists:
`stone_ashlar_quebec`, `stone_ashlar` to `stone`; `stone_rubble`, `stone_rubble_b` to `rubble`;
`brick`, `brick_b` to `brick`; `slate`, `slate_dark` to `roof_zinc` (slate); `copper_patina`, `copper_new` to
`roof_copper`; `cobble_sett`, `cobble_round`, `cobble_fan` to `cobble`; `asphalt`; `plaster`, `plaster_b` to `stucco`;
`wood_painted`, `wood_weathered` to `door` and `shutter`. Tint colours still come from the pack palettes, so tiles
should be used desaturated.

## 4. What the pack changed

Only values in `styles/quebec-historic.json` `client`: the stone, stucco, brick, roof, frame and door palettes
above, and `window.shutters` 0.2. No keys were added. `scenes/old-quebec.json` bakes a copy of the style, so the scene
needs a rebuild by the builder to carry them; the renders in section 5 used a temporary copy.

## 5. Renders against references

See the end of this file (filled in after the renders).
