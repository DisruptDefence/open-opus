// What the player carries: the weapons of the pack's `loadout`, one in the hands at a time. It is a weapon object itself
// (the one the engine holds as G.weapon): every property and call goes to the weapon in the hands, so the HUD, the
// player and the world API see one weapon whose name and counts change. Keys `weapon1`, `weapon2`, ... (input/input.js)
// choose a weapon; the one in the hands is lowered and the other raised in `swapSeconds` (0.35 s). Each weapon keeps its
// own magazine and reserve. A swap is refused while a reload is running. Only the weapon in the hands is updated.
import * as THREE from '../../vendor/three.module.js';
import { zc } from '../shared/lifted.js';

export const SWAP_SECONDS = 0.35;
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/** `weapons`: the built weapon objects in loadout order (each has `root`, `update`, `reset`, `setVisible`, ...). */
export function createCarry(i, weapons) {
  const wrap = new THREE.Group(); wrap.name = 'viewmodel-carry';
  for (const w of weapons) wrap.add(w.root); // each root was put on the camera by its builder; they move into the wrapper
  i.camera.add(wrap);
  let cur = 0, shown = true, swap = null; // swap: { to, t }
  const active = () => weapons[cur];
  const show = (idx) => weapons.forEach((w, n) => w.setVisible(n === idx && shown));
  show(0);

  const carry = {
    weapons, root: wrap,
    get index() { return cur; },
    get swapping() { return !!swap; },
    /** Start taking weapon `to` (0-based) into the hands; false when it is the one in the hands, unknown or the weapon is reloading. */
    select(to) {
      if (swap || to === cur || !weapons[to] || active().state === 'reloading') return false;
      swap = { to, t: 0 }; for (const w of weapons) if (w.debug) w.debug.noFire = true;
      return true;
    },
    reset() { swap = null; cur = 0; for (const w of weapons) { if (w.debug) w.debug.noFire = false; w.reset && w.reset(); } wrap.position.set(0, 0, 0); wrap.rotation.set(0, 0, 0); show(0); },
    setVisible(on) { shown = !!on; wrap.visible = shown; show(cur); },
    update(dt) {
      const inp = i.input;
      if (inp && inp.pressed && !swap) { for (let n = 0; n < weapons.length; n++) if (inp.pressed('weapon' + (n + 1))) carry.select(n); }
      if (swap) {
        swap.t += dt;
        const h = SWAP_SECONDS / 2;
        if (swap.t >= h && swap.to !== cur) { cur = swap.to; show(cur); weapons[cur].snap && weapons[cur].snap(); }
        const low = swap.t < h ? ease(swap.t / h) : 1 - ease((swap.t - h) / h);
        wrap.position.set(0.03 * low, -0.3 * low, 0); wrap.rotation.set(-0.6 * low, 0, 0.3 * low);
        if (swap.t >= SWAP_SECONDS) { swap = null; wrap.position.set(0, 0, 0); wrap.rotation.set(0, 0, 0); for (const w of weapons) if (w.debug) w.debug.noFire = false; }
      }
      active().update(dt);
    },
    // the weapon in the hands, by the names the engine already reads
    muzzleWorld: (...a) => active().muzzleWorld(...a),
    reloadNow: () => active().reloadNow(),
    addAmmo: (n) => active().addAmmo(n),
    setWetness: (v) => weapons.forEach((w) => w.setWetness && w.setWetness(v)),
    snap: () => active().snap && active().snap(),
  };
  for (const key of ['id', 'name', 'ammo', 'magSize', 'reserve', 'state', 'ads', 'spread', 'damage', 'rpm', 'debug', 'info']) {
    Object.defineProperty(carry, key, { enumerable: true, get: () => active()[key], set: (v) => { active()[key] = v; } });
  }
  return carry;
}
