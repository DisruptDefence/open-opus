# Content packs: `opus-content/1`

The engine holds mechanisms; a content pack holds kinds: which threats exist and their numbers, which weapons,
which sounds a threat makes, which HUD elements are on and their words. A product adds a kind by handing the
engine a pack, never by editing `engine/src`. The engine ships `DEFAULT_PACK` (`engine/src/content/default.js`,
exported by `engine/index.js`); a product's pack is merged over it.

```js
const world = openWorld({ source, content: myPack });   // an object, or a promise of one
```

`ready()` rejects with `content pack: …` when the merged pack is invalid. A pack is plain data (JSON-able).

## Shape

| Key | Holds |
|---|---|
| `format` | `'opus-content/1'` (required) |
| `id` | the pack's name |
| `threats` | archetypes by id: body, senses, weapon, behaviour table. The vocabulary is described at the top of `default.js` |
| `threatTuning` | how many threats shoot at once, burst gap, how aim improves, wreck and bolt limits (`maxTokens`, `tokenGap`, …) |
| `weapons` | by id: `name`, `magSize`, `reserve`, `rpm`, `damage`, `range`, `weakMultiplier`, `view` |
| `loadout` | weapon ids the player carries, in order |
| `player` | overrides of the player's tuning by key (`walk`, `sprint`, …); empty means the engine's |
| `sounds.threats` | per archetype id, else per class (`ground` \| `air`): `fire`, `step`, `die`, `loop`, `voice` |
| `hud` | `elements` (which are on) and `words` (the texts). `words` also holds `key` (the interact key's name in the prompt, default `E`). `createHud` (`engine/src/hud/hud.js`) draws an element only when it is named in `elements` |
| `marks` | per mark kind (`objective`, `extraction`): `color` |

This item only moves the data; which of these the engine reads is added item by item (weapons, sound, HUD).
Today the engine reads `threats` and `threatTuning`; the rest is carried and validated.

## Validation (`validatePack`)

`format` must be `opus-content/1`; every threat must pass the behaviour check (known conditions, states that
exist); every weapon needs positive `magSize`, `rpm` and `damage`; `loadout` may name only weapons of the pack.
Unknown top-level keys are ignored and kept.

## Merging (`mergePacks(base, extra)`)

Neither argument is modified.

- `threats`, `weapons`, `sounds.threats`, `marks`: per id, `extra` replaces `base` whole. One archetype is never
  deep-merged, so a changed sentry is written out in full.
- `threatTuning`, `player`, `hud.words`: merged by key.
- `hud.elements`, `loadout`: replaced when `extra` has them.

<!-- weapon: item D -->
## Weapons

The player's weapon is `weapons[loadout[0]]`; `weapons/weapon.js` reads `name`, `magSize`, `reserve`, `rpm`,
`damage` and `range` from it (the view model stays the engine's carbine; `view` is carried, not read). The
snapshot's `self.weapon.id` is the pack key and `name` is the pack's name. A weapon without `reserve` has 0 and
without `range` 300 m. `weakMultiplier` is **not read yet**: `combat.js` takes 2.2 as a literal. Only the first
weapon of the loadout is used; several weapons and switching are not built. The engraving plate on the view
model is blank.
<!-- /weapon -->

<!-- sound: item E -->
## Sounds of a threat

`audio/audio.js` reads `sounds.threats` for every threat event. The entry is looked up by the threat's archetype id,
then by its class (`ground` | `air`); a missing entry, or a missing name in it, plays nothing.

| Name | Used for |
|---|---|
| `fire` | `enemy:fire` |
| `step` | `enemy:step`, and the footfall of `enemy:melee` |
| `die` | `enemy:killed` |
| `loop` | the engine loop that follows the nearest threats (a looping sound of the engine's sound table) |
| `voice` | the variant (0 or 1) of the shared `alert` and `telegraph` sounds |

The names are those of the engine's own synthesised sound table (`ground_fire`, `air_rotor`, …). A pack cannot add
a new sound yet, only choose among the engine's. The port's sounds of the stand-in (horn, gulls, halyards, relay
hum, container bang) and its mission-end jingle are not in the engine. Ambience by scene is not built.
<!-- /sound -->
