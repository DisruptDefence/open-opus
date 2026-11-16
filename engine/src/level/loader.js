// The scene loader: streams a scene's chunks in around the player and supplies what the rest of the engine used
// to get from a hand-built level (the `level`, `ground` and `backdrop` slots of the context).
//
//   order     manifest -> far ring (whole scene, coarse) -> the start chunk and its ring -> play -> further rings
//   window    full detail and collision within `radius` chunks of the player; released beyond `radius + 1`
//   budget    one chunk is decoded and one is meshed per frame at most, so streaming never stalls a frame for long
//
// Objectives, the extraction point and threat spawns are NOT here: by the format they are the host's (anchors.json)
// and arrive as scenario commands through the world API.
import { Group, Mesh, PlaneGeometry, Vector3 } from '../../vendor/three.module.js';
import { installChunk, uninstallChunk } from '../scene/install.js';
import { buildTerrain, buildStructures, buildFarTile, disposeGroup } from './build.js';

export async function createSceneLoader(G, source, { radius = 1 } = {}) {
  const m = source.manifest, root = new Group(); root.name = 'level'; G.scene.add(root);
  const farRoot = new Group(); farRoot.name = 'far'; root.add(farRoot);
  const far = await source.far();
  G.terrain.setFar(far.grid);
  const grid = m.grid, key = grid.key;
  const state = new Map(); // key -> { cx, cz, phase: 'fetching' | 'decoded' | 'live', data, groups, far }
  const farTiles = new Map();
  const stats = { chunksLive: 0, chunksTotal: m.chunks.length, tris: 0, buildMs: 0, lastBuildMs: 0, fetched: 0, released: 0 };

  // far ring: one coarse tile per chunk cell, hulls bucketed by the cell of their first vertex
  const hullsBy = new Map();
  for (const h of far.hulls) { const k = key(grid.ce(h.ring[0]), grid.cn(h.ring[1])); if (!hullsBy.has(k)) hullsBy.set(k, []); hullsBy.get(k).push(h); }
  for (const c of m.chunks) { const t = buildFarTile(G, far, c.ce, c.cn, grid.x0(c.ce), grid.z0(c.cn), hullsBy.get(key(c.ce, c.cn)) || []); farTiles.set(key(c.ce, c.cn), t); farRoot.add(t); }

  // water: one sheet at the scene's water level
  if (m.water && m.water.level != null) {
    const b = m.bounds, w = new Mesh(new PlaneGeometry(b.maxX - b.minX + 800, b.maxZ - b.minZ + 800).rotateX(-Math.PI / 2), G.mats.get('water', { triplanar: true }));
    w.position.set((b.minX + b.maxX) / 2, m.water.level, (b.minZ + b.maxZ) / 2); w.receiveShadow = true; w.name = 'water'; root.add(w);
  }

  const groundAt = (x, z) => { const h = G.terrain.height(x, z); return Number.isNaN(h) ? 0 : h; };

  async function fetchChunk(ce, cn) {
    const k = key(ce, cn), s = { ce, cn, phase: 'fetching', data: null, groups: [] }; state.set(k, s);
    try { s.data = await source.chunk(ce, cn); stats.fetched++; if (state.get(k) === s) s.phase = 'decoded'; }
    catch (e) { state.delete(k); console.error(`[scene] chunk ${k} failed: ${(e && e.message) || e}`); }
  }
  function goLive(s) {
    const t0 = performance.now();
    installChunk(G.physics, G.terrain, s.data); // collision and height first: the simulation never waits for a mesh
    const terrain = buildTerrain(G, s.data), structures = buildStructures(G, s.data, groundAt);
    root.add(terrain, structures); s.groups = [terrain, structures]; s.tris = terrain.userData.tris + structures.userData.tris;
    const f = farTiles.get(key(s.ce, s.cn)); if (f) f.visible = false;
    s.phase = 'live'; s.data = null; // the tile and the solids hold what is still needed
    stats.chunksLive++; stats.tris += s.tris; stats.lastBuildMs = performance.now() - t0; stats.buildMs += stats.lastBuildMs;
    G.events.emit('scene:chunk', { ce: s.ce, cn: s.cn, live: true, ms: stats.lastBuildMs });
  }
  function release(s) {
    for (const g of s.groups) disposeGroup(g);
    uninstallChunk(G.physics, G.terrain, s.ce, s.cn);
    const f = farTiles.get(key(s.ce, s.cn)); if (f) f.visible = true;
    state.delete(key(s.ce, s.cn)); stats.chunksLive--; stats.tris -= s.tris; stats.released++;
    G.events.emit('scene:chunk', { ce: s.ce, cn: s.cn, live: false });
  }

  /** Bring the window round (x, z) up to date. Returns true when every chunk in it is live. */
  function stream(x, z, budget = 1) {
    const pce = grid.ce(x), pcn = grid.cn(z);
    let pending = 0, meshed = 0;
    // nearest first
    const want = [];
    for (let dn = -radius; dn <= radius; dn++) for (let de = -radius; de <= radius; de++) if (source.has(pce + de, pcn + dn)) want.push([pce + de, pcn + dn, Math.max(Math.abs(de), Math.abs(dn))]);
    want.sort((a, b) => a[2] - b[2]);
    for (const [ce, cn] of want) {
      const s = state.get(key(ce, cn));
      if (!s) { fetchChunk(ce, cn); pending++; }
      else if (s.phase === 'fetching') pending++;
      else if (s.phase === 'decoded') { if (meshed < budget) { goLive(s); meshed++; } else pending++; }
    }
    for (const s of [...state.values()]) if (s.phase === 'live' && Math.max(Math.abs(s.ce - pce), Math.abs(s.cn - pcn)) > radius + 1) release(s);
    return pending === 0;
  }
  /** Load the whole window round a point before play begins. */
  async function preload(x, z) {
    for (let guard = 0; guard < 2000; guard++) { if (stream(x, z, 4)) return; await new Promise((r) => setTimeout(r, 0)); }
    throw new Error('scene: the start window did not load');
  }

  const start = { pos: new Vector3(0, 0, 0), yaw: 0 };
  const level = {
    root, manifest: m,
    playerStart: start,
    objectives: [], extraction: null, enemySpawns: [], zones: m.zones || [], interiorBoxes: [], cinematicPath: [], coverPoints: [],
    groundSurfaceAt: (x, z) => { const s = G.terrain.surfaceAt(x, z); return s === 'unknown' ? 'concrete' : s; },
    update() { const at = G.photo || (G.player && G.player.pos); if (at) stream(at.x, at.z); }, // in photo mode the scene follows the camera
    stream, preload, stats: () => ({ ...stats }),
    setRadius(r) { radius = r; },
    get radius() { return radius; },
  };
  // What the lifted player, fx and audio ask of the ground. Wetness is one value for the scene for now.
  const ground = {
    wetnessAt: () => (G.mats && G.mats.uniforms ? G.mats.uniforms.wet.value : 0),
    isPuddle: () => false, puddleDepth: () => 0,
    seaHeight: () => (m.water ? m.water.level : -1e9),
    setRain() {}, setReflections() {}, update() {},
  };
  return { level, ground, backdrop: { update() {} } };
}
