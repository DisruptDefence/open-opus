// Navigation for threats: a grid of walkable cells in a window around the action, derived from the scene itself
// (terrain slope, solids, water), with A* over it. Pure code (no three.js).
//
// The window is the answer to scale: a 2 x 2 km scene at 1 m cells would be 4 million cells; the window is
// `size` x `size` cells and is rebuilt when its centre drifts (docs/SCENE-FORMAT.md 4.8 calls for exactly this).
// The scene format also lets a chunk ship a baked walk mask; none of the scenes we have does yet, so the mask is
// always derived here.

const SQRT2 = Math.SQRT2;

export function createNav({ physics, terrain, cell = 1, size = 160, maxSlope = 0.9, pad = 0.45, vec = (x, y, z) => ({ x, y, z }) }) {
  const n = size, walk = new Uint8Array(n * n), hgt = new Float32Array(n * n);
  let ox = 0, oz = 0, built = false, version = 0;
  const g = new Float32Array(n * n), from = new Int32Array(n * n), mark = new Uint32Array(n * n), closed = new Uint32Array(n * n);
  let run = 0;
  let covers = [];

  const ix = (x) => Math.floor((x - ox) / cell), iz = (z) => Math.floor((z - oz) / cell);
  const inWin = (i, j) => i >= 0 && j >= 0 && i < n && j < n;
  const cx = (i) => ox + (i + 0.5) * cell, cz = (j) => oz + (j + 0.5) * cell;

  /** Rebuild the window centred on (x, z). */
  function build(x, z) {
    ox = Math.round(x / cell) * cell - (n * cell) / 2; oz = Math.round(z / cell) * cell - (n * cell) / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const px = cx(i), pz = cz(j), k = j * n + i, h = terrain.height(px, pz, true);
      hgt[k] = h;
      walk[k] = !Number.isNaN(h) && terrain.slope(px, pz, cell * 0.5) <= maxSlope && terrain.surfaceAt(px, pz) !== 'water'
        && !physics.blocked(px, pz, pad, h) ? 1 : 0;
    }
    buildCover();
    built = true; version++;
  }
  /** Keep the window around a point of interest; rebuilds when it has drifted a quarter of the window. */
  function recenter(x, z, force = false) {
    const half = (n * cell) / 2;
    if (force || !built || Math.abs(x - (ox + half)) > half / 2 || Math.abs(z - (oz + half)) > half / 2) { build(x, z); return true; }
    return false;
  }

  function isWalkable(x, z) { const i = ix(x), j = iz(z); return inWin(i, j) && walk[j * n + i] === 1; }

  /** Straight walk from a to b with no blocked cell and no step higher than a walker takes? */
  function clearLine(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(d / (cell * 0.5)));
    for (let s = 0; s <= steps; s++) if (!isWalkable(a.x + (dx * s) / steps, a.z + (dz * s) / steps)) return false;
    return true;
  }

  function nearestWalkable(i, j, r = 6) {
    if (inWin(i, j) && walk[j * n + i]) return j * n + i;
    for (let d = 1; d <= r; d++) for (let b = -d; b <= d; b++) for (let a = -d; a <= d; a++) {
      if (Math.max(Math.abs(a), Math.abs(b)) !== d) continue;
      const p = i + a, q = j + b;
      if (inWin(p, q) && walk[q * n + p]) return q * n + p;
    }
    return -1;
  }

  // binary heap of cell indices ordered by f
  const heap = [], f = new Float32Array(n * n);
  function push(k) { heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } }
  function pop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  }

  /** A path of points from a to b, smoothed, or null. Both ends are moved to the nearest walkable cell. */
  function findPath(a, b, maxExpand = 12000) {
    if (!built) return null;
    const s = nearestWalkable(ix(a.x), iz(a.z)), t = nearestWalkable(ix(b.x), iz(b.z));
    if (s < 0 || t < 0) return null;
    run++; heap.length = 0;
    const ti = t % n, tj = (t / n) | 0;
    const hfn = (k) => { const dx = Math.abs((k % n) - ti), dz = Math.abs(((k / n) | 0) - tj); return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * cell; };
    g[s] = 0; f[s] = hfn(s); from[s] = -1; mark[s] = run; push(s);
    let found = false, expanded = 0;
    while (heap.length && expanded++ < maxExpand) {
      const k = pop();
      if (closed[k] === run) continue; closed[k] = run;
      if (k === t) { found = true; break; }
      const i = k % n, j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const p = i + di, q = j + dj; if (!inWin(p, q)) continue;
        const m = q * n + p; if (!walk[m] || closed[m] === run) continue;
        if (di && dj && (!walk[j * n + p] || !walk[q * n + i])) continue; // no cutting corners
        const dh = hgt[m] - hgt[k];
        const c = g[k] + (di && dj ? SQRT2 : 1) * cell * (1 + Math.max(0, dh) * 0.6); // uphill costs a little more
        if (mark[m] !== run || c < g[m]) { g[m] = c; f[m] = c + hfn(m); from[m] = k; mark[m] = run; push(m); }
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = t; k >= 0; k = from[k]) raw.push(k);
    raw.reverse();
    const pt = (k) => vec(cx(k % n), hgt[k], cz((k / n) | 0));
    // string pulling: keep a point only when the straight line to the next one is blocked
    const out = [pt(raw[0])]; let anchor = 0;
    for (let i = 2; i < raw.length; i++) {
      if (!clearLine(pt(raw[anchor]), pt(raw[i]))) { out.push(pt(raw[i - 1])); anchor = i - 1; }
    }
    out.push(pt(raw[raw.length - 1]));
    return out;
  }

  /** A walkable point within r of centre (rng returns 0..1), or null. */
  function randomPoint(centre, r, rng = Math.random) {
    for (let tries = 0; tries < 24; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r, x = centre.x + Math.cos(a) * d, z = centre.z + Math.sin(a) * d;
      if (isWalkable(x, z)) return vec(x, hgt[iz(z) * n + ix(x)], z);
    }
    return null;
  }

  // Cover: a walkable cell that touches a blocked cell on one side. The facing is from the cover towards the wall.
  function buildCover() {
    covers = [];
    for (let j = 2; j < n - 2; j += 2) for (let i = 2; i < n - 2; i += 2) {
      const k = j * n + i; if (!walk[k]) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const w1 = (j + dj) * n + i + di, w2 = (j + dj * 2) * n + i + di * 2;
        // a solid there (not just a slope): ask the physics at head height
        if (!walk[w1] && !walk[w2] && physics.blocked(cx(i + di * 2), cz(j + dj * 2), 0.3, hgt[k])) { covers.push({ x: cx(i), y: hgt[k], z: cz(j), nx: di, nz: dj }); break; }
      }
    }
  }
  /** Cover points within r of p, nearest first. */
  function coverNear(p, r) {
    const out = [];
    for (const c of covers) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d <= r) out.push({ ...c, d }); }
    return out.sort((a, b) => a.d - b.d);
  }

  return {
    cell, size, build, recenter, isWalkable, clearLine, findPath, randomPoint, coverNear,
    heightAt: (x, z) => { const i = ix(x), j = iz(z); return inWin(i, j) ? hgt[j * n + i] : NaN; },
    get version() { return version; },
    get origin() { return { x: ox, z: oz }; },
    stats: () => { let w = 0; for (let k = 0; k < walk.length; k++) w += walk[k]; return { cells: n * n, walkable: w, cover: covers.length, version }; },
  };
}
