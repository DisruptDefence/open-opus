# The world API — version 1

The running game is reached through this contract and nothing else. Missions, the phone, the session protocol
and tests all use it. `openWorld()` (`engine/index.js`) returns it at once, in state `loading`, and boots the
engine behind it; the host page publishes it as `window.__OPUS_WORLD` and awaits `ready()`. Until then only
`on`, `state`, `ready`, `canHold`, `hold`, `held` and `release` answer; the rest throw (`apply` throws its
usual `ScenarioCommandError`, with code `not-ready`). The object is frozen.
Additive changes keep the version number.

```ts
interface WorldApi {
  readonly version: 1;

  // lifecycle
  ready(): Promise<void>;                       // scene loaded, first frames drawn
  state(): 'loading' | 'title' | 'playing' | 'paused' | 'dead' | 'complete';
  on(event: WorldEvent, fn: (e: object) => void): () => void;    // returns the function that stops listening
  start(opts?: { at?: Pose }): void;                             // must be called from a user gesture
  pause(): void;
  resume(): void;

  // holding the game while the phone or a mission screen is up
  canHold(): boolean;                           // playing, and not held already
  hold(mode: 'pause' | 'slow'): boolean;        // input off, pointer released, HUD hidden, view tilts down
  setHoldMode(mode: 'pause' | 'slow'): void;
  held(): 'pause' | 'slow' | null;              // null also when the game ended under the hold
  release(): void;

  // what is where (game metres; +x east, −z grid north, y up)
  snapshot(): {
    time: number;                               // seconds of play on the engine's clock
    self: { x: number; y: number; z: number;
            heading: number;                    // degrees clockwise from GRID north
            headingTrue: number;                // the same from TRUE north: what a TAK client shows
            speed: number; health: number };
    entities: Array<{ id: string; kind: 'objective' | 'threat' | 'extraction';   // 'prop' is reserved, see Status
                      type: string; label?: string; x: number; y: number; z: number;
                      radius?: number;          // marks only
                      archetype?: string;       // threats only: the archetype id; `type` is its class, ground | air
                      alive: boolean; state?: string }>;
  };
  scene(): { id: string; name: string; version: string; bounds: Box; walkable: Box; credits: string[] };

  // the Earth (from the scene's georeference, SCENE-FORMAT.md section 2)
  geo: {
    toGeo(x: number, z: number, y?: number): { lat: number; lon: number; hae: number };
    toGame(lat: number, lon: number): { x: number; z: number };
    toUTM(x: number, z: number): { zone: number; easting: number; northing: number };
    toMGRS(x: number, z: number, digits?: 1|2|3|4|5): { zone: string; square: string; easting: string; northing: string };
    headingTrue(heading: number): number;       // a grid heading corrected by the scene's convergence
    readonly convergenceDeg: number;
  };

  // the map picture for an in-game map
  overhead(opts?: { x?: number; z?: number; halfWidth?: number; halfHeight?: number; pxPerMetre?: number }):
    Promise<{ image: ImageBitmap; width: number; height: number; bounds: Box }>;

  // scenario commands
  apply(cmd: ScenarioCommand): void;            // throws a ScenarioCommandError when it cannot be applied
}

type Pose = { x: number; z: number; y?: number; heading?: number };
type Box  = { minX: number; maxX: number; minZ: number; maxZ: number };
```

Every heading that crosses the door is in degrees clockwise from grid north. The engine's own yaw stays inside.

## Events

| Event | Payload | When |
|---|---|---|
| `state` | `{ state, from }` | The state changed |
| `player:dead` | `{}` | The player died: under fire, or by an `end` command with `result: 'dead'`. It follows the `state` event that says `dead` |
| `player:hit` | `{ amount, health }` | |
| `entity` | an entity as in `snapshot()`, plus `change: 'spawn' \| 'state' \| 'killed' \| 'fire' \| 'despawn'` | A threat appeared, changed behaviour, fired, died or was removed; a mark was placed or removed |
| `interact` | `{ id, kind, action: 'reached', time }` | The player entered a mark's radius |
| `shot` | `{ ammo }` | The player fired |
| `say` | `{ text }` | A `say` command was shown |
| `hold` | `{ mode }` (`null` on release) | A hold began, changed mode (`setHoldMode`) or ended, including when play ended under it |
| `chunk` | `{ ce, cn, live }` | A scene chunk (numbered as in `SCENE-FORMAT.md` 3.1) became live or was released. Reported from `ready()` onwards: the chunks round the start are loaded before it and are not announced |

An event is a report, not a decision. The engine says a mark was reached; what that is worth is the host's.

## Scenario commands

A command is a plain object with `op`. The session host sends them when they take effect
(`SESSION-PROTOCOL.md`); the mission client passes each to `apply()`. The engine keeps no command for later
and knows no condition.

| `op` | Fields | Effect |
|---|---|---|
| `place` | `x`, `z`, `y?`, `heading?`, `now?` | Sets where the player starts; with `now`, moves the player there at once |
| `spawn` | `id`, `kind` (an archetype id, or its class `ground` \| `air`), `x`, `z`, `y?`, `heading?`, `route?: [[x, z], …]` | A threat. The route is walked or flown in a loop. An id already in the world is replaced |
| `despawn` | `id` | Removes it |
| `mark` | `id`, `kind: 'objective' \| 'extraction'`, `x`, `z`, `y?`, `radius?` (3 m), `label?`, `type?` | A **visible** place in the world; appears in `snapshot().entities`; `interact` fires when the player enters it. An id already in the world is replaced |
| `unmark` | `id` | Removes it |
| `clear` | — | Removes every threat and every mark |
| `say` | `text`, `seconds?` | A line on the HUD |
| `end` | `result?: 'complete' \| 'dead'` | Ends play; the state becomes `complete` or `dead`. `dead` kills the player and `player:dead` is reported, as when dying under fire. Ignored when play has already ended |
| `time` | `hour` (0–24) | Time of day |
| `weather` | `wet` (0–1) | |

`y` omitted means "on the ground at that point". New commands are additive.

**A command says what stands, not what changes.** Applying one twice leaves the world as applying it once does:
a `spawn` or `mark` whose id is already there replaces it (at the place and in the state the command gives);
`despawn`, `unmark` and `clear` of what is not there do nothing; `place`, `time` and `weather` set a value. A host
can therefore send everything that stands again when the player deploys again or returns
(`SESSION-PROTOCOL.md` 5); `clear` first removes what no longer stands. `say` is the exception: it is shown
each time.

**A command that cannot be applied throws, and changes nothing.** `apply()` throws a `ScenarioCommandError`
(exported by `engine/index.js`) and nothing else:

| Member | |
|---|---|
| `name` | `'ScenarioCommandError'` |
| `code` | `'not-ready'` the world is still loading · `'unknown-op'` no such command · `'invalid'` a field is missing or has a value the command cannot take, or the command is not a plain object · `'unknown-kind'` no threat archetype of that name |
| `op` | the command's `op`, when it had one |
| `message` | a sentence a person can read |

Over the session protocol the mission client catches it and answers `refused` with the command's `seq`.

## Rules

- No three.js type, engine object or DOM node crosses the API: plain numbers, strings, arrays and objects, and
  an `ImageBitmap` for the overhead picture.
- `hold` owns everything needed to freeze the game for the phone: time scale, input suspension, pointer lock,
  HUD, audio, camera pitch. Callers add no capture listeners of their own.
- `snapshot().entities` is the only list of things in the world.
- The engine never imports the mission client, the phone, or a TAK screen.
- Whoever holds the world holds nothing else: the engine behind it is reachable only through `engineOf(world)`
  in `engine/src/world/open.js`, which is for this repository's tests and tools and is not exported by `index.js`.

## PhoneScreen

The second, smaller contract: what a phone host drives, whichever screen is behind it (a stream of a real TAK
client, or a fallback): `open()`, `close()`, `back()`, `update(snapshot)`, `on(fn)`, `setModeBadge(mode)`,
`openTools()`, `onCloseRequest`, `onModeChange`, `capturesKeys`, `items`. No phone host or screen is in this
repository yet; the list is what a product's phone host uses today and will be specified when one lands here.

## Status, 2026-11-15

Implemented in `engine/src/world/` (`open.js`, `world-api.js`) and `engine/src/director/director.js`. This
document was brought into line with that code on 2026-11-15 (engine commit `84a657c`) (added since the first
draft: `pause`, `resume`, `scene`, `headingTrue`, `label`, `radius`, `toUTM`, `convergenceDeg`, headings in
degrees instead of yaw, the options and size of `overhead`, the event payloads and the command table). Where
the two disagree, fix one of them in the same change and say which in the commit message.

Changed on 2026-11-15 after review: `start()` lost `quick`, which did nothing; `state()` lost `intro`; `end` with
`dead` reports `player:dead`; `apply()` throws a typed error; `spawn` of an id already in the world replaces it
instead of throwing; `clear` was added; the `chunk` event names chunks `ce`, `cn` as the scene format does.

Known gaps:

- There is no `intro` state: the engine has no opening sequence of its own. A host page shows its briefing
  before it calls `start()`. If the engine gets one, the state is added then.
- The entity kind `prop` is reserved and never produced: no command places an object that is neither a threat
  nor a mark. It needs content packs, which do not exist yet.
- A `mark` is always drawn. A host must not mark a place the player is meant to find (`SESSION-PROTOCOL.md` 4).

The contract test is `engine/test/world-api.test.js`: it runs the real simulation under Node without a screen.
