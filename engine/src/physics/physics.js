// Collision for a scene on real terrain. Pure code (no three.js), so it runs under `node --test`.
//
// It keeps the calls the lifted player, weapon, combat and fx modules were written against (`boxes`, `bounds`,
// `addBox`, `removeBox`, `build`, `raycast`, `lineOfSight`, `groundHeight`, `moveCapsule`) and replaces what was
// underneath them, which was a flat floor and a list of axis-aligned boxes:
//
//   ground   the streamed height field (terrain/heightfield.js)
//   solids   upright prisms over any footprint: a building is its real outline at any angle; a box is a prism
//   lookup   a hash of 8 m cells, so a ray or a step tests only what is near it
//   walking  slopes up to CLIMB are walked, steeper ground stops the walker; a drop steeper than DROP (a cliff
//            edge) holds a walker back; steps up to STEP are climbed; ground with no loaded chunk is a wall
//
// `vec` makes the points and normals handed back (the engine passes a three.js Vector3 factory; tests use the default).

export const STEP = 0.45;   // highest step climbed without jumping, metres
export const CLIMB = 1.25;  // steepest ground walked up, rise over run (about 51 degrees)
export const DROP = 1.7;    // steepest ground walked down (about 60 degrees); beyond it an edge holds the walker back
const CELL = 8;
const EPS = 1e-4;

export function createPhysics({ terrain, bounds, vec = (x, y, z) => ({ x, y, z }) }) {
  const solids = new Set();
  const boxes = [];                 // the axis-aligned ones, as the lifted code reads them (`min`, `max`)
  const cells = new Map();
  const ck = (i, j) => i * 73856093 ^ j * 19349663;
  const ci = (v) => Math.floor(v / CELL);
  let stamp = 0;

  function insert(s) {
    for (let j = ci(s.min.z); j <= ci(s.max.z); j++) for (let i = ci(s.min.x); i <= ci(s.max.x); i++) {
      const k = ck(i, j); let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(s);
    }
    solids.add(s);
  }
  function remove(s) {
    if (!solids.delete(s)) return;
    for (let j = ci(s.min.z); j <= ci(s.max.z); j++) for (let i = ci(s.min.x); i <= ci(s.max.x); i++) {
      const c = cells.get(ck(i, j)); if (!c) continue;
      const n = c.indexOf(s); if (n >= 0) c.splice(n, 1);
      if (!c.length) cells.delete(ck(i, j));
    }
    const b = boxes.indexOf(s); if (b >= 0) boxes.splice(b, 1);
  }
  /** Calls fn(solid) once for every solid whose cells touch the rectangle. */
  function near(x0, z0, x1, z1, fn) {
    const s = ++stamp;
    for (let j = ci(z0); j <= ci(z1); j++) for (let i = ci(x0); i <= ci(x1); i++) {
      const c = cells.get(ck(i, j)); if (!c) continue;
      for (let n = 0; n < c.length; n++) { const o = c[n]; if (o._s !== s) { o._s = s; fn(o); } }
    }
  }

  /**
   * A prism: `ring` is a flat [x0, z0, x1, z1, …] outline (either winding, closed implicitly), solid from yBase to yTop.
   * opts: surface, tag (to remove a chunk's solids together), bulletOnly (stops shots, not walkers), playerOnly
   * (stops walkers, not shots), kind (a word for what the solid is: a hit reports it with `ref`, the record it came from), noNav (ignored by the nav grid), sightOnly is not modelled. holes: flat rings of
   * the same kind that are NOT solid (a courtyard): inside, closest point and rays all follow the outline with its holes.
   */
  function addPrism(ring, yBase, yTop, opts = {}) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    const s = { ring, min: vec(x0, yBase, z0), max: vec(x1, yTop, z1), surface: opts.surface || 'concrete', tag: opts.tag,
      holes: opts.holes && opts.holes.length ? opts.holes : null, bulletOnly: !!opts.bulletOnly, playerOnly: !!opts.playerOnly, noNav: !!opts.noNav, ref: opts.ref, kind: opts.kind, _s: 0 };
    insert(s);
    return s;
  }
  function addBox(min, max, opts = {}) {
    const s = addPrism([min.x, min.z, max.x, min.z, max.x, max.z, min.x, max.z], min.y, max.y, opts);
    s.box = true; boxes.push(s);
    return s;
  }
  function removeTag(tag) { for (const s of [...solids]) if (s.tag === tag) remove(s); }

  // ---- 2D helpers on a ring --------------------------------------------------------------------------------------
  function inside(r, x, z) {
    let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    }
    return c;
  }
  /** Inside the solid as drawn: even-odd over its outline and its holes. */
  function insideS(s, x, z) {
    if (!inside(s.ring, x, z)) return false;
    if (s.holes) for (const h of s.holes) if (inside(h, x, z)) return false;
    return true;
  }
  const hit = { x: 0, z: 0, d: 0 };
  /** Closest point of the outline to (x, z): fills `hit` and returns the distance. */
  function closest(r, x, z) {
    let best = Infinity;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], bx = r[i] - ax, bz = r[i + 1] - az, l = bx * bx + bz * bz;
      let t = l > 0 ? ((x - ax) * bx + (z - az) * bz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + bx * t, pz = az + bz * t, d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) { best = d; hit.x = px; hit.z = pz; }
    }
    return (hit.d = Math.sqrt(best));
  }

  /** Closest point of any edge of the solid, holes included: fills `hit`, returns the distance. */
  function closestS(s, x, z) {
    let best = closest(s.ring, x, z), bx = hit.x, bz = hit.z;
    if (s.holes) for (const h of s.holes) { const d = closest(h, x, z); if (d < best) { best = d; bx = hit.x; bz = hit.z; } }
    hit.x = bx; hit.z = bz; return (hit.d = best);
  }

  // ---- ground ----------------------------------------------------------------------------------------------------
  /**
   * The floor a body with its feet at `feetY` stands on at (x, z): the terrain, or the top of a solid under it that
   * it could step onto. NaN where the terrain is not loaded.
   */
  function floorAt(x, z, feetY, radius = 0) {
    let h = terrain.height(x, z, true);
    if (Number.isNaN(h)) return NaN;
    const lim = feetY + STEP + EPS;
    near(x - radius, z - radius, x + radius, z + radius, (s) => {
      if (s.bulletOnly || s.max.y <= h || s.max.y > lim) return;
      if (insideS(s, x, z) || (radius > 0 && closestS(s, x, z) < radius)) h = s.max.y;
    });
    return h;
  }
  /** Highest ground or solid top at (x, z) at or below `below` (default: anything). The lifted modules' call. */
  function groundHeight(x, z, below = Infinity) {
    let h = terrain.height(x, z);
    if (Number.isNaN(h)) h = 0;
    near(x, z, x, z, (s) => { if (!s.bulletOnly && s.max.y > h && s.max.y <= below && insideS(s, x, z)) h = s.max.y; });
    return h;
  }

  // ---- walking ---------------------------------------------------------------------------------------------------
  const res = { onGround: false, hitWall: false, hitCeil: false, surface: 'concrete', blocked: null };

  /** Push a circle out of every solid that overlaps the body's height. Returns true if it touched one. */
  function pushOut(pos, vel, radius, lo, hi) {
    let touched = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      near(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, (s) => {
        if (s.bulletOnly || s.max.y <= lo || s.min.y >= hi) return;
        if (pos.x + radius < s.min.x || pos.x - radius > s.max.x || pos.z + radius < s.min.z || pos.z - radius > s.max.z) return;
        const isIn = insideS(s, pos.x, pos.z), d = closestS(s, pos.x, pos.z);
        if (!isIn && d >= radius) return;
        let nx = pos.x - hit.x, nz = pos.z - hit.z;
        if (d < 1e-6) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
        if (isIn) { nx = -nx; nz = -nz; pos.x = hit.x + nx * radius; pos.z = hit.z + nz * radius; }
        else { pos.x = hit.x + nx * radius; pos.z = hit.z + nz * radius; }
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
        moved = touched = true;
      });
      if (!moved) break;
    }
    return touched;
  }

  /** May a grounded walker go from (x0, z0) to (x1, z1)? Returns null if so, else why not. */
  function groundBlock(x0, z0, y0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0, run = Math.hypot(dx, dz);
    if (run < 1e-6) return null;
    if (!terrain.loaded(x1, z1)) return 'unloaded';
    if (bounds && (x1 < bounds.min.x || x1 > bounds.max.x || z1 < bounds.min.z || z1 > bounds.max.z)) return 'bounds';
    // look a little ahead, so a slow frame cannot tunnel through a short steep face
    const probe = Math.max(run, 0.3), px = x0 + (dx / run) * probe, pz = z0 + (dz / run) * probe;
    const ga = terrain.height(px, pz, true);
    if (Number.isNaN(ga)) return 'unloaded';
    const g0 = terrain.height(x0, z0, true), rise = (ga - Math.max(g0, Math.min(y0, g0 + STEP))) / probe;
    if (rise > CLIMB) return 'slope';
    if (rise < -DROP && y0 - g0 < 0.3) {
      // steep down: is it a kerb or a cliff? measure the fall over a body length
      const far = terrain.height(x0 + (dx / run) * 1.2, z0 + (dz / run) * 1.2);
      if (!(g0 - far < 1.0)) return 'edge';
    }
    return null;
  }

  /**
   * Move a standing capsule (feet at `pos`) by `vel` for `dt`. Mutates pos and vel. `grounded` is whether the body
   * stood on the ground at the end of the last call. The returned object is reused between calls.
   */
  function moveCapsule(pos, vel, dt, radius, height, grounded = true) {
    res.hitWall = res.hitCeil = false; res.blocked = null;
    const dist = Math.hypot(vel.x, vel.z) * dt, n = Math.max(1, Math.min(10, Math.ceil(dist / (radius * 0.5)))), h = dt / n;
    const walking = grounded && vel.y <= 0.01;
    for (let i = 0; i < n; i++) {
      const x0 = pos.x, z0 = pos.z;
      let nx = x0 + vel.x * h, nz = z0 + vel.z * h;
      if (walking) {
        let why = groundBlock(x0, z0, pos.y, nx, nz);
        if (why) {
          // slide: try each axis on its own
          const wx = groundBlock(x0, z0, pos.y, nx, z0), wz = groundBlock(x0, z0, pos.y, x0, nz);
          res.blocked = why;
          if (!wx && Math.abs(vel.x) >= Math.abs(vel.z)) { nz = z0; vel.z = 0; }
          else if (!wz) { nx = x0; vel.x = 0; }
          else if (!wx) { nz = z0; vel.z = 0; }
          else { nx = x0; nz = z0; vel.x = vel.z = 0; }
          res.hitWall = true;
        }
      } else if (!terrain.loaded(nx, nz)) { nx = x0; nz = z0; vel.x = vel.z = 0; res.hitWall = true; res.blocked = 'unloaded'; }
      pos.x = nx; pos.z = nz;
      if (pushOut(pos, vel, radius, pos.y + STEP, pos.y + height)) res.hitWall = true;
      // a push must not land the walker on ground it may not walk
      if (walking && (pos.x !== nx || pos.z !== nz) && groundBlock(x0, z0, pos.y, pos.x, pos.z)) { pos.x = x0; pos.z = z0; }
      // vertical
      pos.y += vel.y * h;
      let floor = floorAt(pos.x, pos.z, Math.max(pos.y, pos.y - vel.y * h), radius * 0.6);
      if (Number.isNaN(floor)) floor = pos.y;
      if (pos.y <= floor + EPS) { pos.y = floor; if (vel.y < 0) vel.y = 0; res.onGround = true; }
      else if (walking && pos.y - floor <= STEP + 0.35) { pos.y = floor; vel.y = 0; res.onGround = true; } // stay on a down slope or a stair
      else res.onGround = false;
      if (vel.y > 0) {
        // head against the underside of something
        const top = pos.y + height;
        near(pos.x, pos.z, pos.x, pos.z, (s) => {
          if (!s.bulletOnly && s.min.y > pos.y + STEP && s.min.y < top && s.max.y > top && insideS(s, pos.x, pos.z)) { pos.y = s.min.y - height; vel.y = 0; res.hitCeil = true; }
        });
      }
    }
    res.surface = surfaceUnder(pos.x, pos.z, pos.y);
    return res;
  }

  function surfaceUnder(x, z, y) {
    let name = terrain.surfaceAt(x, z), top = terrain.height(x, z);
    near(x, z, x, z, (s) => { if (!s.bulletOnly && s.max.y <= y + 0.05 && s.max.y > top && insideS(s, x, z)) { top = s.max.y; name = s.surface; } });
    return name === 'unknown' ? 'concrete' : name;
  }

  /**
   * The top of a ledge in front of a walker, for mantling: looks `reach` ahead along (dx, dz) for a solid or a bank
   * whose top is between STEP and `maxUp` above the feet and has room to stand on. Returns { y, x, z } or null.
   */
  function ledgeAhead(pos, dx, dz, radius, height, reach = 0.75, maxUp = 1.5) {
    const x = pos.x + dx * (radius + reach), z = pos.z + dz * (radius + reach);
    if (!terrain.loaded(x, z)) return null;
    let top = terrain.height(x, z);
    near(x - radius, z - radius, x + radius, z + radius, (s) => {
      if (!s.bulletOnly && s.max.y > top && s.max.y <= pos.y + maxUp + EPS && (insideS(s, x, z) || closestS(s, x, z) < radius * 0.5)) top = s.max.y;
    });
    const up = top - pos.y;
    if (up <= STEP || up > maxUp) return null;
    // room to stand there?
    let free = true;
    near(x - radius, z - radius, x + radius, z + radius, (s) => {
      if (s.bulletOnly || s.max.y <= top + STEP || s.min.y >= top + height) return;
      if (insideS(s, x, z) || closestS(s, x, z) < radius) free = false;
    });
    return free ? { x, y: top, z } : null;
  }

  // ---- rays ------------------------------------------------------------------------------------------------------
  /** First thing a ray meets: { dist, point, normal, surface, box } or null. `forWalker` skips bullet-only solids. */
  function raycast(origin, dir, max = 200, forWalker = false) {
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    let best = max, bs = null, bnx = 0, bny = 1, bnz = 0;
    const wallsOf = (s, r) => {
      const y0 = s.min.y, y1 = s.max.y;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const ax = r[j], az = r[j + 1], ex = r[i] - ax, ez = r[i + 1] - az, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
        if (t < 0 || t >= best || u < 0 || u > 1) continue;
        const y = oy + dy * t; if (y < y0 || y > y1) continue;
        best = t; bs = s;
        const l = Math.hypot(ex, ez) || 1; bnx = ez / l; bny = 0; bnz = -ex / l;
        if (bnx * dx + bnz * dz > 0) { bnx = -bnx; bnz = -bnz; }
      }
    };
    const test = (s) => {
      if (forWalker ? s.bulletOnly : s.playerOnly) return;
      const r = s.ring, y0 = s.min.y, y1 = s.max.y;
      // walls: the outline and the edges of every hole (the ray's normal is turned to face the ray)
      wallsOf(s, r); if (s.holes) for (const h of s.holes) wallsOf(s, h);
      // caps
      if (dy < -1e-9 && oy > y1) { const t = (y1 - oy) / dy; if (t < best && insideS(s, ox + dx * t, oz + dz * t)) { best = t; bs = s; bnx = 0; bny = 1; bnz = 0; } }
      else if (dy > 1e-9 && oy < y0) { const t = (y0 - oy) / dy; if (t < best && insideS(s, ox + dx * t, oz + dz * t)) { best = t; bs = s; bnx = 0; bny = -1; bnz = 0; } }
    };
    // walk the cells the ray crosses
    const hl = Math.hypot(dx, dz), s = ++stamp;
    const visit = (i, j) => { const c = cells.get(ck(i, j)); if (c) for (let n = 0; n < c.length; n++) { const o = c[n]; if (o._s !== s) { o._s = s; test(o); } } };
    let i = ci(ox), j = ci(oz);
    if (hl < 1e-6) visit(i, j);
    else {
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
      let tx = dx !== 0 ? (((dx > 0 ? i + 1 : i) * CELL) - ox) / dx : Infinity, tz = dz !== 0 ? (((dz > 0 ? j + 1 : j) * CELL) - oz) / dz : Infinity;
      for (let guard = 0, t = 0; guard < 4096 && t <= best; guard++) {
        visit(i, j);
        if (tx < tz) { t = tx; tx += tdx; i += sx; } else { t = tz; tz += tdz; j += sz; }
      }
    }
    let surface = bs ? bs.surface : null;
    const g = terrain.raycast(ox, oy, oz, dx, dy, dz, best);
    if (g) {
      best = g.dist; bs = null;
      const n = terrain.normal(g.x, g.z); bnx = n.x; bny = n.y; bnz = n.z;
      surface = terrain.surfaceAt(g.x, g.z); if (surface === 'unknown') surface = 'concrete';
    } else if (!bs) return null;
    return { dist: best, point: vec(ox + dx * best, oy + dy * best, oz + dz * best), normal: vec(bnx, bny, bnz), surface, box: bs };
  }

  /** Can a see b? Sight and shots share the same solids. */
  function lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return !raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d - 0.05);
  }

  /** Is there a solid within `r` of (x, z) that a body with feet at `y` and this height would touch? For the nav grid. */
  function blocked(x, z, r, y, height = 1.8) {
    let b = false;
    near(x - r, z - r, x + r, z + r, (s) => {
      if (b || s.bulletOnly || s.noNav || s.max.y <= y + STEP || s.min.y >= y + height) return;
      if (insideS(s, x, z) || closestS(s, x, z) < r) b = true;
    });
    return b;
  }

  return {
    boxes, bounds, solids, terrain,
    addBox, addPrism, removeBox: remove, remove, removeTag, near,
    build() {}, // nothing to bake: solids are indexed as they are added
    floorAt, groundHeight, moveCapsule, ledgeAhead, raycast, lineOfSight, blocked, surfaceUnder,
    stats: () => ({ solids: solids.size, cells: cells.size }),
  };
}
