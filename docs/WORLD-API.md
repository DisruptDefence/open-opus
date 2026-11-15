# The world API — version 1

The running game is reached through this contract and nothing else. Missions, the phone, the session protocol
and tests all use it. It is published as `window.__OPUS_WORLD` and as a module export. Additive changes keep the
version number.

```ts
interface WorldApi {
  readonly version: 1;

  // lifecycle
  ready(): Promise<void>;                       // scene loaded, first frames drawn
  state(): 'loading' | 'title' | 'intro' | 'playing' | 'paused' | 'dead' | 'complete';
  on(event: WorldEvent, fn: (e: unknown) => void): () => void;   // 'state', 'player:dead', 'entity', 'interact'
  start(opts?: { quick?: boolean; at?: Pose }): void;            // must be called from a user gesture

  // holding the game while the phone or a mission screen is up
  canHold(): boolean;
  hold(mode: 'pause' | 'slow'): boolean;        // input off, pointer released, HUD hidden, view tilts down
  setHoldMode(mode: 'pause' | 'slow'): void;
  held(): 'pause' | 'slow' | null;              // null also when the game ended under the hold
  release(): void;

  // what is where (game metres; +x east, −z north, y up)
  snapshot(): {
    time: number;
    self: { x: number; y: number; z: number; heading: number; speed: number; health: number };
    entities: Array<{ id: string; kind: 'objective' | 'threat' | 'extraction' | 'prop';
                      type: string; x: number; y: number; z: number; alive: boolean; state?: string }>;
  };

  // the Earth (from the scene's georeference, SCENE-FORMAT.md section 2)
  geo: {
    toGeo(x: number, z: number, y?: number): { lat: number; lon: number; hae: number };
    toGame(lat: number, lon: number): { x: number; z: number };
    toMGRS(x: number, z: number, digits?: 1|2|3|4|5): { zone: string; square: string; easting: string; northing: string };
    headingTrue(yaw: number): number;           // grid heading corrected by the scene's convergence
  };

  // the map picture for an in-game map
  overhead(): Promise<{ image: CanvasImageSource; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }>;

  // scenario commands (used by the director only)
  apply(cmd: ScenarioCommand): void;            // place, spawn, despawn, say, mark, unmark, end
}
```

## Rules

- No three.js type, engine object or DOM node crosses the API. `overhead()` returns something drawable, not a
  render target.
- `hold` owns everything needed to freeze the game for the phone: time scale, input suspension, pointer lock,
  HUD, audio, camera pitch. Callers add no capture listeners of their own.
- `snapshot().entities` is the only list of things in the world.
- The engine never imports the mission client, the phone, or a TAK screen.

## PhoneScreen

The second, smaller contract: what the phone host drives, whichever screen is behind it (a stream of real ATAK,
or a fallback): `open()`, `close()`, `back()`, `update(snapshot)`, `on(fn)`, `setModeBadge(mode)`, `openTools()`,
`onCloseRequest`, `onModeChange`, `capturesKeys`, `items`.

## Status

Proposed. The engine's implementation and a contract test are in progress; where the two disagree, fix one of
them in the same change and say which in the commit message.
