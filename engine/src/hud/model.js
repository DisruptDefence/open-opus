// The HUD's arithmetic: numbers in, numbers out. No DOM, no three.js, no events: tested under Node (test/hud.test.js).
// hud.js draws what these functions say. Angles: degrees unless a name says radians; heading and bearing are
// clockwise from grid north; `player` is { pos: { x, z }, yaw } with the engine's yaw (heading = -yaw).

export const TAPE_PX_PER_DEG = 4;
export const TAPE_FROM = -90, TAPE_TO = 450; // the strip is drawn for these headings: one full turn plus a margin each side
export const BOX = { x: 0.9, y: 0.82 }; // markers stick to the edge of this inner box (fraction of the half screen)

const DEG = 180 / Math.PI;
const wrap180 = (a) => { const m = ((a % 360) + 360) % 360; return m > 180 ? m - 360 : m; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Grid heading (0..360) of an engine yaw, the same as georef.headingGrid. */
export const headingOf = (yaw) => ((((-yaw * DEG) % 360) + 360) % 360);

/** translateX, in px, of the tape strip (drawn from TAPE_FROM degrees) so that `headingDeg` is at the middle of a `widthPx` window. */
export const tapeOffset = (headingDeg, widthPx) => widthPx / 2 - (headingDeg - TAPE_FROM) * TAPE_PX_PER_DEG;

/** Degrees, -180..180, from where the player faces to a thing at `mark` ({ x, z }). 90 is to the right. */
export function markerBearing(player, mark) {
  const dx = mark.x - player.pos.x, dz = mark.z - player.pos.z;
  return wrap180(Math.atan2(dx, -dz) * DEG - headingOf(player.yaw));
}

/**
 * Where a world tag is drawn, in normalised device coordinates (-1..1). A point inside the 90 % x 82 % box is left
 * alone. A point outside it, or behind the camera, is pulled along the line from the centre to the edge of the box.
 * `behind`: the projection of a point behind the camera is mirrored, so it is mirrored back first. Straight behind
 * (no sideways part) goes to the bottom edge.
 */
export function edgeClamp(ndcX, ndcY, behind = false) {
  let x = behind ? -ndcX : ndcX, y = behind ? -ndcY : ndcY;
  const outside = Math.abs(x) > BOX.x || Math.abs(y) > BOX.y;
  if (!behind && !outside) return { x, y, offscreen: false };
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return { x: 0, y: -BOX.y, offscreen: true };
  const s = Math.min(BOX.x / Math.abs(x || 1e-9), BOX.y / Math.abs(y || 1e-9));
  if (behind || s < 1) { x *= s; y *= s; }
  return { x, y, offscreen: true };
}

/** The crosshair's gap in px: the weapon's spread (radians) as pixels at this field of view, 4 px at least, rounded to 0.5. */
export function crosshairGap(spread, fovDeg, heightPx, sprinting) {
  const px = (Math.tan(spread) / Math.tan((fovDeg * Math.PI) / 360)) * (heightPx / 2) + 4 + (sprinting ? 10 : 0);
  return Math.round(clamp(px, 4, 70) * 2) / 2;
}

/** Radians, to rotate a damage arc that points up (ahead) so that it points at `from` ({ x, z }). */
export const damageArcAngle = (player, from) => Math.atan2(from.x - player.pos.x, -(from.z - player.pos.z)) + player.yaw;

/** The ammunition cue: reloading | reload | empty | lowAmmo | '' (a word of the pack's `hud.words`). Low is 27 % of a magazine or less. */
export function ammoCue(ammo, magSize, reserve, state) {
  if (!Number.isFinite(ammo) || !Number.isFinite(magSize)) return '';
  if (state === 'reloading') return 'reloading';
  if (ammo <= 0) return reserve > 0 ? 'reload' : 'empty';
  return ammo <= Math.floor(0.27 * magSize) ? 'lowAmmo' : '';
}

/** Lit segments of the 10 that show health: any health left lights one. */
export const healthSegments = (health, max) => (max > 0 ? clamp(Math.ceil((10 * health) / max - 1e-9), 0, 10) : 0);
export const CRIT_SEGMENTS = 3;

/** How many characters of a text of `length` are shown `seconds` after it began typing at `cps` characters a second. */
export const typedChars = (seconds, cps, length) => clamp(Math.floor(seconds * cps), 0, length);

/** The hit marker for a `player:hitEnemy`: its kind, how long it lasts (s) and its scale `age` seconds in (1.5 -> 1, or 1.15 -> 1 for a plain hit). */
export function hitmarkerLook(e, age = 0) {
  const kind = e.killed ? 'kill' : e.weak ? 'weak' : 'hit', life = kind === 'kill' ? 0.42 : 0.24, from = kind === 'hit' ? 1.15 : 1.5;
  const t = clamp(age / life, 0, 1);
  return { kind, life, scale: from + (1 - from) * t, alpha: 1 - t * t };
}

export const ARC_SECONDS = 1.5, ARC_FADE = 0.6, ARC_COUNT = 4;
/** Add a damage arc (radians) to a list of at most 4: a fifth reuses the oldest. */
export function addArc(arcs, angle, now) {
  const arc = { angle, born: now };
  if (arcs.length < ARC_COUNT) arcs.push(arc);
  else { let o = 0; for (let i = 1; i < arcs.length; i++) if (arcs[i].born < arcs[o].born) o = i; arcs[o] = arc; }
  return arc;
}
/** Opacity of an arc at `now`: 1, then fading over its last 0.6 s; 0 when over. */
export const arcAlpha = (arc, now) => { const age = now - arc.born; return age >= ARC_SECONDS || age < 0 ? 0 : age < ARC_SECONDS - ARC_FADE ? 1 : (ARC_SECONDS - age) / ARC_FADE; };

export const FEED_LINES = 4, FEED_SECONDS = 4.2;
/** Add a line to a kill feed: at most 4, the oldest dropped. */
export function pushFeed(lines, line) { lines.push(line); while (lines.length > FEED_LINES) lines.shift(); return lines; }

/** The compass letter for a heading that is a multiple of 45 (letters are the pack's `compass` word, 8 words split on spaces). */
export const COMPASS = 'N NE E SE S SW W NW'.split(' ');
export const compassLetter = (deg, letters = COMPASS) => (deg % 45 === 0 ? letters[(((deg / 45) % 8) + 8) % 8] || '' : '');

/** Distance in whole metres from the player to a mark. */
export const markerDistance = (p, m) => Math.round(Math.hypot(m.x - p.x, (m.y ?? p.y ?? 0) - (p.y ?? 0), m.z - p.z));
