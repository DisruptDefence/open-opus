// Content packs, pure (no three.js, no DOM). A pack is plain data in the format `opus-content/1`
// (docs/CONTENT-PACK.md): which threats, weapons, sounds and HUD words a product has. validatePack says what is
// wrong with one; mergePacks lays a product's pack over the default one.
export const PACK_FORMAT = 'opus-content/1';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * What is wrong with a pack, as sentences that name their subject; [] when nothing is. Unknown top-level keys are
 * ignored. `validateBehaviour(def) -> string[]` is the threats module's check, handed in so this file imports nothing.
 */
export function validatePack(pack, { validateBehaviour } = {}) {
  const errors = [];
  if (!plain(pack)) return ['pack: not an object'];
  if (pack.format !== PACK_FORMAT) errors.push(`format: "${pack.format}" is not ${PACK_FORMAT}`);
  if (pack.threats !== undefined) {
    if (!plain(pack.threats)) errors.push('threats: not an object');
    else for (const [id, def] of Object.entries(pack.threats)) {
      if (!plain(def)) { errors.push(`threat "${id}": not an object`); continue; }
      if (validateBehaviour) for (const e of validateBehaviour(def)) errors.push(`threat "${id}": ${e}`);
    }
  }
  if (pack.weapons !== undefined) {
    if (!plain(pack.weapons)) errors.push('weapons: not an object');
    else for (const [id, w] of Object.entries(pack.weapons)) {
      for (const k of ['magSize', 'rpm', 'damage']) if (!plain(w) || !(w[k] > 0)) errors.push(`weapon "${id}": ${k} must be a positive number`);
    }
  }
  if (pack.loadout !== undefined) {
    if (!Array.isArray(pack.loadout)) errors.push('loadout: not an array');
    else for (const id of pack.loadout) if (!plain(pack.weapons) || !Object.hasOwn(pack.weapons, id)) errors.push(`loadout: "${id}" is not a weapon of the pack`);
  }
  return errors;
}

/**
 * `extra` over `base`, neither modified. Per id, `extra` replaces `base` whole for threats, weapons, sounds.threats and
 * marks; threatTuning, player and hud.words merge by key; hud.elements and loadout are replaced when `extra` has them.
 */
export function mergePacks(base, extra = {}) {
  const out = clone(base), x = clone(extra) || {};
  for (const k of Object.keys(x)) if (!['threats', 'weapons', 'sounds', 'marks', 'threatTuning', 'player', 'hud', 'loadout'].includes(k)) out[k] = x[k];
  for (const k of ['threats', 'weapons', 'marks']) if (x[k] !== undefined) out[k] = { ...(out[k] || {}), ...x[k] };
  for (const k of ['threatTuning', 'player']) if (x[k] !== undefined) out[k] = { ...(out[k] || {}), ...x[k] };
  if (x.sounds !== undefined) out.sounds = { ...(out.sounds || {}), ...x.sounds, threats: { ...((out.sounds || {}).threats || {}), ...(x.sounds.threats || {}) } };
  if (x.hud !== undefined) out.hud = { ...(out.hud || {}), ...x.hud, words: { ...((out.hud || {}).words || {}), ...(x.hud.words || {}) } };
  if (x.loadout !== undefined) out.loadout = x.loadout;
  return out;
}
