// A collision audit over a whole scene: walks it the way a player and a threat do and counts what is wrong.
//
//   node engine/tools/collision-audit.mjs <scenes/NAME.json | engine/scenes/test>   (no default: the scene is named by the caller)
//
// The checks are plain functions of a physics world (engine/src/physics), so the test (engine/test/audit.test.js)
// and this tool run the same code. It reads engine/src only and writes nothing. It judges solids with its own
// point-in-outline test (holes included), never with the physics module's, so a fault in physics shows here.
//
//   a  walkAudit      seeded sprint and threat walks under gravity: frames whose capsule centre lies inside a solid
//                     that overlaps the body (feet + STEP to feet + 1.6 m) and is not bulletOnly
//   b  overlapAudit   pairs of solids of DIFFERENT records whose outlines overlap by more than 5 cm in plan and in height
//   c  insideAudit    trees and props whose footprint lies inside a building piece
//   d  slotAudit      gaps between two buildings, at ground level, wider than 0 and narrower than 0.8 m
//   e  solidSignature the solids installed, as a sorted list of rounded ring bounds: equal whatever the detail radius
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STEP } from '../src/physics/physics.js';

export const BODY_TOP = 1.6;
export const OVERLAP_MIN = 0.05;
export const SLOT_MAX = 0.8;

// ---- geometry, independent of the physics module ------------------------------------------------------------------
export function inRing(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  }
  return c;
}
/** Inside the solid as drawn: inside its outer ring and in none of its holes. */
export function inSolid(s, x, z) {
  if (!inRing(s.ring, x, z)) return false;
  if (s.holes) for (const h of s.holes) if (inRing(h, x, z)) return false;
  return true;
}
function distToRing(r, x, z) {
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], bx = r[i] - ax, bz = r[i + 1] - az, l = bx * bx + bz * bz;
    let t = l > 0 ? ((x - ax) * bx + (z - az) * bz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t); if (d < best) best = d;
  }
  return best;
}
/** Points along an outline: every vertex and a point every `step` metres of edge. */
function* along(r, step = 0.25) {
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], bx = r[i] - ax, bz = r[i + 1] - az, n = Math.max(1, Math.ceil(Math.hypot(bx, bz) / step));
    for (let k = 0; k < n; k++) yield [ax + (bx * k) / n, az + (bz * k) / n];
  }
}
/** Does outline `a` run more than `depth` metres into the solid `b` (inside it, that far from every edge)? */
function runsInto(a, b, depth) {
  for (const [x, z] of along(a)) if (inSolid(b, x, z) && Math.min(distToRing(b.ring, x, z), ...(b.holes || []).map((h) => distToRing(h, x, z))) > depth) return [x, z];
  return null;
}
/** The record a solid came from; a solid made by hand is its own record. */
const recordOf = (s) => s.ref || s;
export function kindOf(s) {
  const r = s.ref; if (!r) return 'solid';
  if (r.hEave !== undefined) return 'building';
  if (r.crownRadius !== undefined) return 'tree';
  if ('yaw' in r && 'variant' in r) return 'prop';
  return 'wall';
}
const heightOverlap = (a, b) => Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);

// ---- a: walks -----------------------------------------------------------------------------------------------------
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const WALKERS = { player: { speed: 6.5, radius: 0.38 }, threat: { speed: 4.5, radius: 0.32 } };

/**
 * `walks` seeded walks of `seconds` at 1/60 s for each of the two bodies, turning every 1.5 s, with gravity. Returns
 * { frames, inside, bodies: {player: {...}, threat: {...}}, samples: [{ who, x, y, z, t, kind }] } (samples: first of each walk).
 * `from(rnd)` may give the start points; the default picks free ground anywhere in the physics bounds.
 */
export function walkAudit(physics, { seed = 1, walks = 16, seconds = 30, from, height = 1.8 } = {}) {
  const terrain = physics.terrain, b = physics.bounds, rnd = rng(seed), dt = 1 / 60;
  const out = { frames: 0, inside: 0, walks: 0, bodies: {}, samples: [] };
  const start = from || (() => {
    for (let k = 0; k < 2000; k++) {
      const x = b.min.x + 3 + rnd() * (b.max.x - b.min.x - 6), z = b.min.z + 3 + rnd() * (b.max.z - b.min.z - 6);
      if (!terrain.loaded(x, z)) continue;
      const y = physics.groundHeight(x, z); if (physics.blocked(x, z, 0.6, y, height)) continue;
      return [x, z];
    }
    return null;
  });
  for (const [who, { speed, radius }] of Object.entries(WALKERS)) {
    const body = out.bodies[who] = { frames: 0, inside: 0, walks: 0 };
    for (let w = 0; w < walks; w++) {
      const p = start(rnd); if (!p) continue;
      const pos = { x: p[0], y: physics.groundHeight(p[0], p[1]), z: p[1] }, vel = { x: 0, y: 0, z: 0 };
      let yaw = rnd() * Math.PI * 2, grounded = true, sampled = false;
      body.walks++; out.walks++;
      for (let f = 0, n = Math.round(seconds / dt); f < n; f++) {
        if (f % 90 === 0) yaw += (rnd() - 0.5) * Math.PI * 1.5; // every 1.5 s
        vel.x = Math.sin(yaw) * speed; vel.z = Math.cos(yaw) * speed; vel.y -= 21 * dt;
        grounded = physics.moveCapsule(pos, vel, dt, radius, height, grounded).onGround;
        body.frames++; out.frames++;
        const hit = solidAt(physics, pos.x, pos.z, pos.y);
        if (hit) {
          body.inside++; out.inside++;
          if (!sampled) { sampled = true; out.samples.push({ who, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), t: +(f * dt).toFixed(2), kind: kindOf(hit), id: hit.ref && hit.ref.id }); }
        }
      }
    }
  }
  return out;
}
/** The solid a body centred at (x, z) with feet at y is inside, or null. */
export function solidAt(physics, x, z, y) {
  let found = null;
  physics.near(x, z, x, z, (s) => { if (!found && !s.bulletOnly && s.max.y > y + STEP && s.min.y < y + BODY_TOP && inSolid(s, x, z)) found = s; });
  return found;
}

// ---- b, c, d: pairs -----------------------------------------------------------------------------------------------
function eachPair(physics, pad, fn) {
  const list = [...physics.solids], index = new Map(list.map((s, i) => [s, i]));
  for (const a of list) physics.near(a.min.x - pad, a.min.z - pad, a.max.x + pad, a.max.z + pad, (o) => { if (index.get(o) > index.get(a) && recordOf(o) !== recordOf(a)) fn(a, o); });
}
/** b: pairs of different records whose outlines overlap by more than 5 cm in plan and in height. */
export function overlapAudit(physics, { depth = OVERLAP_MIN } = {}) {
  const pairs = [], byKind = {};
  eachPair(physics, 0, (a, o) => {
    if (heightOverlap(a, o) <= depth) return;
    const at = runsInto(a.ring, o, depth) || runsInto(o.ring, a, depth); if (!at) return;
    const key = [kindOf(a), kindOf(o)].sort().join('+'); byKind[key] = (byKind[key] || 0) + 1;
    pairs.push({ kinds: key, x: +at[0].toFixed(2), z: +at[1].toFixed(2), a: a.ref && a.ref.id, b: o.ref && o.ref.id });
  });
  return { count: pairs.length, byKind, pairs };
}
/** c: trees and props whose footprint lies inside a building piece. */
export function insideAudit(physics) {
  const found = [];
  for (const s of physics.solids) {
    const k = kindOf(s); if (k !== 'tree' && k !== 'prop') continue;
    const cx = (s.min.x + s.max.x) / 2, cz = (s.min.z + s.max.z) / 2;
    physics.near(cx, cz, cx, cz, (o) => {
      if (kindOf(o) !== 'building' || heightOverlap(s, o) <= OVERLAP_MIN || !inSolid(o, cx, cz)) return;
      found.push({ kind: k, x: +cx.toFixed(2), z: +cz.toFixed(2), building: o.ref.id });
    });
  }
  return { count: found.length, found };
}
/** d: gaps between two buildings at ground level wider than 0 and narrower than 0.8 m. */
export function slotAudit(physics, { max = SLOT_MAX } = {}) {
  const found = [], seen = new Map(), ground = (s) => s.min.y <= physics.terrain.height((s.min.x + s.max.x) / 2, (s.min.z + s.max.z) / 2) + STEP + 0.5;
  const gapOf = (a, b) => {
    let best = Infinity, at = null;
    for (const [p, q] of [[a, b], [b, a]]) for (let i = 0; i < p.ring.length; i += 2) {
      const d = distToRing(q.ring, p.ring[i], p.ring[i + 1]); if (d < best) { best = d; at = [p.ring[i], p.ring[i + 1]]; }
    }
    return { d: best, at };
  };
  eachPair(physics, max, (a, o) => {
    if (kindOf(a) !== 'building' || kindOf(o) !== 'building' || !ground(a) || !ground(o)) return;
    const g = gapOf(a, o); if (g.d <= 1e-3 || g.d >= max) return;
    if (runsInto(a.ring, o, 0) || runsInto(o.ring, a, 0)) return; // overlapping, not a gap (b reports it)
    const k = a.ref.id < o.ref.id ? a.ref.id + '/' + o.ref.id : o.ref.id + '/' + a.ref.id, was = seen.get(k); // one entry per pair of buildings, its narrowest gap
    const e = { gap: +g.d.toFixed(3), x: +g.at[0].toFixed(2), z: +g.at[1].toFixed(2), a: a.ref.id, b: o.ref.id };
    if (!was) { seen.set(k, e); found.push(e); } else if (e.gap < was.gap) Object.assign(was, e);
  });
  return { count: found.length, found };
}

// ---- e: the solids as a signature ---------------------------------------------------------------------------------
/** { solids, cells, rings: sorted list of rounded bounds with heights }: equal for two worlds that hold the same solids. */
export function solidSignature(physics) {
  const r = (v) => Math.round(v * 100) / 100;
  const rings = [...physics.solids].map((s) => [s.min.x, s.min.z, s.max.x, s.max.z, s.min.y, s.max.y, s.ring.length / 2, s.holes ? s.holes.length : 0].map(r).join(',')).sort();
  return { stats: physics.stats(), rings };
}
export function sameSignature(a, b) {
  if (a.stats.solids !== b.stats.solids || a.rings.length !== b.rings.length) return false;
  return a.rings.every((v, i) => v === b.rings[i]);
}

// ---- the tool -----------------------------------------------------------------------------------------------------
export function audit(physics, opts = {}) {
  return { walks: walkAudit(physics, opts), overlaps: overlapAudit(physics), inside: insideAudit(physics), slots: slotAudit(physics), solids: physics.stats() };
}
const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { jsonSource, packageSource } = await import('../src/scene/source.js');
  const { installAll, fileFetch, ROOT } = await import('../test/helpers.js');
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node engine/tools/collision-audit.mjs <scenes/NAME.json | engine/scenes/test>'); process.exit(2); }
  const source = arg.endsWith('.json') ? jsonSource(JSON.parse(readFileSync(arg, 'utf8'))) : await packageSource(resolve(arg) + '/', fileFetch);
  const { physics } = await installAll(source), t0 = Date.now();
  const r = audit(physics, { seed: +(process.env.SEED || 1) });
  const head = (l, n = 12) => l.slice(0, n);
  console.log(JSON.stringify({
    scene: source.manifest.id, solids: r.solids,
    a_walks: { frames: r.walks.frames, framesInsideSolid: r.walks.inside, bodies: r.walks.bodies, first: head(r.walks.samples, 20) },
    b_overlaps: { pairs: r.overlaps.count, byKind: r.overlaps.byKind, first: head(r.overlaps.pairs) },
    c_propsAndTreesInBuildings: { count: r.inside.count, first: head(r.inside.found) },
    d_slots: { count: r.slots.count, first: head(r.slots.found) },
    seconds: (Date.now() - t0) / 1000,
  }, null, 1));
  void ROOT;
}
