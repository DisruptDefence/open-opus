// A tree breaks under fire. Every shot that hits a trunk (the physics solid `kind: 'tree'`, its record in `ref`) adds its damage to
// THAT tree; when the damage reaches the tree's hit points the tree is felled:
//
//   hit points   12 + 90 * trunkRadius * 10   (a 0.15 m trunk: 147, about six carbine rounds of 26; a 0.4 m trunk: 372)
//   the break    0.6 to 1.1 m up the trunk (seeded by the tree's position); the part below stays as a splintered stump, with the
//                trunk's collider up to the break; the part above has no collider
//   the fall     the top, one standalone mesh built by gen/trees.js, turns about the break point away from the shooter over 1.6 s,
//                easing in, with a small bounce as it lands; it stays where it lies
//   the world    `t.fell = { h }` on the record, so the mesher draws a stump (level/loader.js `fellTree` builds the chunk's far group and
//                the cell's near group again), and `restore()` sets it again when the chunk is reloaded: a felled tree stays felled
//                for the session. Event `tree:felled { id, x, z }` once per tree (docs/WORLD-API.md).
//   crowns       are no solids: a shot through leaves does nothing to the tree.
import { Quaternion, Vector3 } from '../../vendor/three.module.js';
import { createSoups, rng, seedOf } from '../gen/soup.js';
import { tree, treeId, trunkRadius } from '../gen/trees.js';
import { soupsToGroup } from '../level/build.js';

export const FALL_SECONDS = 1.6, FALL_MAIN = 1.4;
/** Hit points of a tree by its trunk: 12 + 90 * radius(m) * 10. */
export const treeHp = (t) => 12 + 90 * trunkRadius(t.height) * 10;
/** Where the trunk breaks, metres above the ground: 0.6 to 1.1, seeded by the tree's place, never above 70 % of a small tree. */
export const breakHeight = (t) => Math.min(t.height * 0.7, 0.6 + 0.5 * rng(seedOf(t.x, t.z) ^ 0x7ee)());
const ease = (u) => Math.pow(u, 2.4);

export function createTreefall(G) {
  const damage = new Map(), felled = new Map(), falling = [];
  const up = new Vector3(0, 1, 0);
  const season = () => (G.level && G.level.manifest && G.level.manifest.season) || 'summer';

  function effects(t, y, h, dir) {
    const crown = new Vector3(t.x, y + t.height * 0.7, t.z), cut = new Vector3(t.x, y + h, t.z);
    try { G.audio && G.audio.play && G.audio.play('impact_wood', { pos: cut, variant: 1, pitch: 0.55, gain: 1.6 }); } catch { /* sound is optional */ }
    try {
      if (G.fx && G.fx.debris) {
        G.fx.debris(cut, { color: 0x9a7a50, count: 14, size: 0.07, speed: 5, normal: new Vector3(-dir.x, 0.4, -dir.z), spread: 1.2 });
        if (t.kind !== 5) G.fx.debris(crown, { color: season() === 'autumn' ? 0xb4561e : 0x4a6b2a, count: 36, size: 0.12, speed: 3.5, normal: up, spread: 1.8 });
      }
    } catch { /* particles are optional */ }
  }

  function fell(t, id, from, dir) {
    const h = breakHeight(t), rec = { h }, y = G.terrain.height(t.x, t.z), at = Number.isFinite(y) ? y : 0;
    felled.set(id, rec); damage.delete(id); t.fell = rec;
    if (G.level && G.level.fellTree) G.level.fellTree(t);
    let dx = dir ? dir.x : 0, dz = dir ? dir.z : 0; const l = Math.hypot(dx, dz);
    if (l < 1e-3) { const a = rng(seedOf(t.x, t.z) ^ 0xfa11)() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= l; dz /= l; }
    // the top: built round its pivot (the break point), at the tree's own seed
    const soups = createSoups();
    tree(soups, { ...t, fell: null, sx: t.x, sz: t.z, x: 0, z: 0 }, -h, season(), 1, { part: 'top', at: h });
    const group = soupsToGroup(G, soups, `fallen ${id}`), len = Math.max(1, t.height - h);
    group.position.set(t.x, at + h, t.z);
    if (G.level && G.level.root) G.level.root.add(group);
    const final = Math.min(1.75, Math.max(1.5, Math.acos(-Math.min(0.95, Math.max(0, (h - 0.5) / len))))); // the crown lies on the ground
    falling.push({ group, axis: new Vector3(dz, 0, -dx).normalize(), t: 0, final, q: new Quaternion() });
    effects(t, at, h, { x: dx, z: dz });
    G.events.emit('tree:felled', { id, x: t.x, z: t.z });
  }

  const api = {
    hp: treeHp,
    /** A shot hit the trunk of `t` at `point`, going along `dir`, for `amount`. True when this shot felled it. */
    hit(t, point, dir, amount) {
      if (!t || !(amount > 0)) return false;
      const id = treeId(t);
      if (felled.has(id)) return false;
      const total = (damage.get(id) || 0) + amount;
      if (total < treeHp(t)) { damage.set(id, total); return false; }
      fell(t, id, point, dir);
      return true;
    },
    damageOf: (t) => damage.get(treeId(t)) || 0,
    isFelled: (t) => felled.has(treeId(t)),
    /** Mark the felled trees among `trees` (a chunk's records) as felled: called when a chunk is loaded. */
    restore(trees) { if (felled.size) for (const t of trees) { const f = felled.get(treeId(t)); if (f) t.fell = f; } },
    update(dt) {
      for (let i = falling.length - 1; i >= 0; i--) {
        const f = falling[i]; f.t = Math.min(FALL_SECONDS, f.t + dt);
        const ang = f.t <= FALL_MAIN ? f.final * ease(f.t / FALL_MAIN) : f.final - 0.07 * Math.sin(Math.PI * (f.t - FALL_MAIN) / (FALL_SECONDS - FALL_MAIN));
        f.group.quaternion.copy(f.q.setFromAxisAngle(f.axis, ang)); f.group.updateMatrix();
        if (f.t >= FALL_SECONDS) falling.splice(i, 1);
      }
    },
    stats: () => ({ felled: felled.size, falling: falling.length, damaged: damage.size }),
  };
  return api;
}
