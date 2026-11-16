# The world API — version 1

The running game is reached through this contract and nothing else. Missions, the phone, the session protocol
and tests all use it. `openWorld()` (`engine/index.js`) returns it at once, in state `loading`, and boots the
engine behind it; the host page publishes it as `window.__OPUS_WORLD` and awaits `ready()`. Until then only
`on`, `state`, `ready`, `canHold`, `hold`, `held` and `release` answer; the rest throw. The object is frozen.
Additive changes keep the version number.

```ts
interface WorldApi {
  readonly version: 1;

  // lifecycle
  ready(): Promise<void>;                       // scene loaded, first frames drawn
  state(): 'loading' | 'title' | 'intro' | 'playing' | 'paused' | 'dead' | 'complete';
  on(event: WorldEvent, fn: (e: object) => void): () => void;    // returns the function that stops listening
  start(opts?: { quick?: boolean; at?: Pose }): void;            // must be called from a user gesture
  pause(): void;
  resume(): void;

  // holding the game while the phone or a mission screen is up
  canHold(): boolean;
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
    entities: Array<{ id: string; kind: 'objective' | 'threat' | 'extraction' | 'prop';
                      type: string; label?: string; x: number; y: number; z: number;
                      radius?: number;          // marks only
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
  apply(cmd: ScenarioCommand): void;            // throws when the command is unknown or cannot be applied
}

type Pose = { x: number; z: number; y?: number; heading?: number };
type Box  = { minX: number; maxX: number; minZ: number; maxZ: number };
```

Every heading that crosses the door is in degrees clockwise from grid north. The engine's own yaw stays inside.

## Events

| Event | Payload | When |
|---|---|---|
| `state` | `{ state, from }` | The state changed |
| `player:dead` | `{}` | |
| `player:hit` | `{ amount, health }` | |
| `entity` | an entity as in `snapshot()`, plus `change: 'spawn' \| 'state' \| 'killed' \| 'fire' \| 'despawn'` | A threat appeared, changed behaviour, fired, died or was removed; a mark was placed or removed |
| `interact` | `{ id, kind, action: 'reached', time }` | The player entered a mark's radius |
| `shot` | `{ ammo }` | The player fired |
| `say` | `{ text }` | A `say` command was shown |
| `hold` | `{ mode }` (`null` on release) | |
| `chunk` | `{ cx, cz, live }` | A scene chunk became live or was released |

An event is a report, not a decision. The engine says a mark was reached; what that is worth is the host's.

## Scenario commands

A command is a plain object with `op`. The session host sends them when they take effect
(`SESSION-PROTOCOL.md`); the mission client passes each to `apply()`. The engine keeps no command for later
and knows no condition.

| `op` | Fields | Effect |
|---|---|---|
| `place` | `x`, `z`, `y?`, `heading?`, `now?` | Sets where the player starts; with `now`, moves the player there at once |
| `spawn` | `id`, `kind` (an archetype id, or its class `ground` \| `air`), `x`, `z`, `y?`, `heading?`, `route?: [[x, z], …]` | A threat. The route is walked or flown in a loop. Throws on an id already in the world or an unknown kind |
| `despawn` | `id` | Removes it |
| `mark` | `id`, `kind: 'objective' \| 'extraction'`, `x`, `z`, `y?`, `radius?` (3 m), `label?`, `type?` | A **visible** place in the world; appears in `snapshot().entities`; `interact` fires when the player enters it |
| `unmark` | `id` | Removes it |
| `say` | `text`, `seconds?` | A line on the HUD |
| `end` | `result?: 'complete' \| 'dead'` | Ends play; the state becomes `complete` or `dead` |
| `time` | `hour` (0–24) | Time of day |
| `weather` | `wet` (0–1) | |

`y` omitted means "on the ground at that point". A command that is unknown or cannot be applied throws, so a
host learns at once that its scenario is wrong (over the session protocol the mission client catches it and
answers `refused`). New commands are additive.

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
document was brought into line with that code as it stood uncommitted on 2026-11-15 (added since the first
draft: `pause`, `resume`, `scene`, `headingTrue`, `label`, `radius`, `toUTM`, `convergenceDeg`, headings in
degrees instead of yaw, the options and size of `overhead`, the event payloads and the command table). Where
the two disagree, fix one of them in the same change and say which in the commit message.

Known gaps:

- `state()` never returns `intro`, and no entity of kind `prop` is produced.
- A `mark` is always drawn. A host must not mark a place the player is meant to find (`SESSION-PROTOCOL.md` 4).
- No contract test exists (`engine/test/` covers the pure modules and threats). Wanted: one that boots the
  engine headless and checks every member and payload above.
