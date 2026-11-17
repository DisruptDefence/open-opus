// Landmarks: the extra modelling a named building gets from a `look` of the style (`style.looks[name]`), chosen by the
// scene's building record (`b.look`, the format's `lm`). Pure code. docs/plans/SCENE-DETAIL.md item 9; no place is named here:
// what a look contains (string courses, corbel tables, oriel bays, tall chimney stacks, denser dormers, turret windows,
// ridge cresting, finials) is data in the style pack, so another place gives its own landmarks their own looks.
//
//   lookOf(style, b)                          the look table of a building, or null
//   lookStyle(style, look)                    the style a landmark's façade is drawn with: window bay, dormers, chimneys overridden
//   landmarkNear(soups, b, groundAt, style, info)   near: courses, corbels, oriels, turret windows        (info = roof.js result)
//   landmarkBase(soups, b, style, info)             base: ridge cresting, finials (seen from far away)
//
// A look (all keys optional; sizes in metres; `tint` a colour word of the style):
//   course  { from, every, h, out, tint }              a stone string course at each storey line from storey `from`
//   corbel  { h, out, steps, tint }                      a stepped corbel table under the eave
//   oriel   { every, w, depth, from, floors, rise, minEdge }  bay windows with a pointed copper cap, one per `every` m of edge
//   slits   { w, h, sill, every }                        narrow windows on a round turret, every `every` edges
//   crest   { h, w }                                     a cresting along every ridge, `finial` { h, w } a spike at its ends / on a cone
//   canopy  { depth, rise }                              a porte-cochere canopy over each end of a passage through the building
//   flag    { above, h, w, colors }                      a flagpole on the ridge of a building whose top is `above` m over its ground
//   wall    [colours]                                    the wall colour of the building (one per building by its id), instead of the façade palette
//   window  { bay: [lo, hi] }, dormers, chimneys         laid over the style's own for this building's façade
// The château keys, each drawn only when present (landmark_roof.js describes them): base { storeys, material, color, dado },
//   roof { seams, battens, ridgeDark, streaks }, dormers { tiers, spacing, width, height, gable, finial }, stacks { count,
//   height, width, depth, capColor }, turret { bellcast, finial, eaveBand }, crown { corbel, parapetTurrets, cresting, above }.
// Soups: SOUP.trim (stone dressing), SOUP.window (glass), ROOF_SOUP copper (caps), SOUP.iron (cresting). Budget: <= 9 000
// triangles for a building of 40 edges and 8 storeys; near only for courses, oriels, windows.
import { quad, tri, frame, rect, slab, box, shade } from './soup.js';
import { SOUP, ROOF_SOUP, ROOF_TINT_SOUP, WALL_SOUP, parseColor, paletteColor } from './style.js';
import { signedArea } from './poly.js';
import { bays } from './facade.js';
import { roofSeams, stacks, dormerTiers, bartizans, hasCrown, ball } from './landmark_roof.js';

const IRON = [0.03, 0.033, 0.036];
export const lookOf = (style, b) => (b && b.look && style.looks && style.looks[b.look]) || null;

const styled = new WeakMap();
/** The style a landmark façade is drawn with: the look's `window`, `dormers`, `chimneys` laid over the pack's (cached per look). */
export function lookStyle(style, look) {
  if (!look || (!look.window && !look.dormers && !look.chimneys && !look.stacks)) return style;
  let per = styled.get(style); if (!per) styled.set(style, (per = new Map()));
  let s = per.get(look);
  if (!s) {
    s = { ...style }; for (const k of ['window', 'dormers', 'chimneys']) if (look[k]) s[k] = { ...style[k], ...look[k] };
    if (look.dormers && look.dormers.tiers > 0) s.dormers = { ...s.dormers, mansard: 0, gabled: 0 };   // the tiers below replace the façade's single row
    if (look.stacks) s.chimneys = { ...s.chimneys, perBuilding: [0, 0] };                            // the stacks on the ridge replace the façade's chimneys
    per.set(look, s);
  }
  return s;
}

const tintOf = (style, t, fallback) => (t && parseColor(t)) || fallback || paletteColor(style.trim, 0);
function edgesOf(ring, hole) {
  const out = [], n = ring.length / 2, pos = signedArea(ring) > 0, flip = hole ? !pos : pos;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.02) continue;
    out.push({ i, len, f: flip ? frame(bx, bz, (ax - bx) / len, (az - bz) / len) : frame(ax, az, (bx - ax) / len, (bz - az) / len) });
  }
  return out;
}
/** Highest ground along an edge: the wall stands on it (lower ground is the plinth's). */
function baseOf(e, groundAt) {
  let hi = -Infinity; const k = Math.max(1, Math.ceil(e.len / 2.5));
  for (let s = 0; s <= k; s++) { const p = e.f.at((e.len * s) / k, 0, 0); hi = Math.max(hi, groundAt(p[0], p[2])); }
  return hi;
}

export function landmarkNear(soups, b, groundAt, style, info) { // eslint-disable-line no-unused-vars
  const look = lookOf(style, b); if (!look) return;
  const T = soups.get(SOUP.trim), G = soups.get(SOUP.window), eave = b.yBase + b.hEave, lv = Math.max(1, b.levels || Math.round(b.hEave / 3.1));
  const stone = tintOf(style, look.course && look.course.tint), cb = look.corbel, co = look.course, ori = look.oriel, sl = look.slits;
  const cap = soups.get(ROOF_SOUP[2] || ROOF_SOUP[0]), frameC = paletteColor(style.frames, 0), bs = look.base, tur = look.turret, crown = hasCrown(b, look);
  for (const e of edgesOf(b.ring, false)) {
    if (b.blind && b.blind.has(e.i)) continue;
    const base = baseOf(e, groundAt), sh = (eave - base) / lv, f = e.f, len = e.len; if (sh < 2 || len < 0.4) continue;
    if (bs) stoneBase(soups, e, b, look, style, base, sh);
    if (co) for (let s = Math.max(1, co.from || 1, bs ? (bs.storeys || 1) + 1 : 0); s < lv; s += Math.max(1, co.every || 1)) slab(T, f, 0, len, base + s * sh - co.h / 2, base + s * sh + co.h / 2, 0, co.out, stone, 'fbt');
    if (crown && len > 1) crownCorbel(soups, f, len, eave, look.crown, stone);
    if (tur && tur.eaveBand && b.roofShape === 7 && len < 3) { // a band of small windows under the eave of a round turret
      const wy = eave - (cb ? cb.h : 0.8) - 0.75, ww = Math.min(0.4, len * 0.45);
      rect(G, f, len / 2 - ww / 2, len / 2 + ww / 2, wy, wy + 0.55, 0.02, null, [0, 0, 1, 1]);
      slab(T, f, len / 2 - ww / 2 - 0.06, len / 2 + ww / 2 + 0.06, wy - 0.06, wy, 0, 0.07, stone, 'fbt'); slab(T, f, len / 2 - ww / 2 - 0.06, len / 2 + ww / 2 + 0.06, wy + 0.55, wy + 0.65, 0, 0.07, stone, 'fb');
    }
    if (cb && !crown) {
      const steps = cb.steps || 3, step = cb.h / steps;
      for (let k = 0; k < steps; k++) slab(T, f, 0, len, eave - cb.h + k * step, eave - cb.h + (k + 1) * step, 0, cb.out * ((k + 1) / steps), tintOf(style, cb.tint, stone), k === 0 ? 'fb' : 'fb');
    }
    if (sl && len < 3) { // a round turret: slim windows, one per `every` edges and storey
      if (e.i % (sl.every || 2)) continue;
      for (let s = 0; s < lv; s++) {
        const y0 = base + s * sh + sl.sill, u0 = len / 2 - sl.w / 2, u1 = len / 2 + sl.w / 2;
        rect(G, f, u0, u1, y0, y0 + sl.h, 0.02, null, [0, 0, 1, 1]);
        slab(T, f, u0 - 0.08, u1 + 0.08, y0 - 0.07, y0, 0, 0.07, stone, 'fbt'); slab(T, f, u0 - 0.08, u1 + 0.08, y0 + sl.h, y0 + sl.h + 0.18, 0, 0.07, stone, 'fb');
      }
    }
    if (ori && len >= (ori.minEdge || 14)) { // bay windows, centred in equal spans along the edge
      const n = Math.max(1, Math.floor(len / ori.every)), span = len / n, fl = Math.min(ori.floors, lv - ori.from);
      if (fl < 1) continue;
      for (let k = 0; k < n; k++) {
        const c = span * (k + 0.5), u0 = c - ori.w / 2, u1 = c + ori.w / 2, y0 = base + ori.from * sh + 0.15, y1 = y0 + fl * sh - 0.3, d = ori.depth, ch = 0.45;
        // a bay: canted front and two cheeks (three windows), a stepped corbel under it and a copper cap
        const cx = d * 0.45, a0 = u0 + cx, a1 = u1 - cx, lit = ((b.id >>> 5) + k + e.i) % 4 === 0;   // one bay in four has a lamp on
        const front = [[a0, d], [a1, d]], left = [[u0, 0], [a0, d]], right = [[a1, d], [u1, 0]];
        for (const [[ua, da], [ub, db]] of [left, front, right]) {
          quad(G, f.at(ua, y0, da + 0.01), f.at(ub, y0, db + 0.01), f.at(ub, y1, db + 0.01), f.at(ua, y1, da + 0.01), lit ? [1.0, 0.8, 0.5] : null, [0, 0, fl, 1]);
        }
        for (let s = 0; s <= fl; s++) { const y = y0 + (s * (y1 - y0)) / fl; slab(T, f, a0 - 0.05, a1 + 0.05, y - 0.07, y + 0.07, d - 0.02, d + 0.07, stone, 'fbt'); }
        slab(T, f, a0 - 0.05, a0 + 0.05, y0, y1, d - 0.02, d + 0.07, stone, 'flr'); slab(T, f, a1 - 0.05, a1 + 0.05, y0, y1, d - 0.02, d + 0.07, stone, 'flr');
        for (let s = 0; s < 3; s++) slab(T, f, u0 + cx * (1 - s / 3) * 0.5, u1 - cx * (1 - s / 3) * 0.5, y0 - 0.2 * (s + 1), y0 - 0.2 * s, 0, d * (0.4 + 0.2 * s), stone, 'fb');
        // cap: a pyramid over the bay, in the roof's own copper
        const apex = f.at(c, y1 + ch + ori.rise, d * 0.55), tint = b.roofColor || null, S = tint ? soups.get(ROOF_TINT_SOUP[2] || ROOF_TINT_SOUP[0]) : cap;
        const base4 = [f.at(u0, y1 + ch, 0), f.at(a0, y1 + ch, d + 0.08), f.at(a1, y1 + ch, d + 0.08), f.at(u1, y1 + ch, 0)];
        slab(T, f, u0 - 0.05, u1 + 0.05, y1, y1 + ch, 0, d + 0.1, stone, 'fbtlr');
        for (let q = 0; q < 3; q++) tri(S, base4[q], base4[q + 1], apex, tint);
        tri(S, base4[3], base4[0], apex, tint); // back, against the wall
        void frameC;
      }
    }
  }
  if (look.canopy) for (const pa of b.passages || []) canopy(soups, b, pa, groundAt, look.canopy, stone);
  dormerTiers(soups, b, look, info, stone);
}

/** The ground storeys in rough stone: a dado under the windows, a stone pier on every bay line and a projecting band on top. A thin facing 0.06 m proud of the wall, so the façade generator is not touched. */
function stoneBase(soups, e, b, look, style, base, sh) {
  const bs = look.base, f = e.f, len = e.len, S = soups.get(bs.material === 'stone_ashlar' ? WALL_SOUP[1] : WALL_SOUP[2]), col = parseColor(bs.color) || [0.3, 0.29, 0.27];
  const top = base + (bs.storeys || 1) * sh, front = b.front && b.front.has(e.i), round = len < 3, by = bays(len, lookStyle(style, look), b.id);
  const blind = b.blind && b.blind.has(e.i), whole = blind || by.n === 0 || sh < 2.3, dado = bs.dado || 0.72, wmax = (style.window.width || 1) * 1.3 + 0.3;
  if (whole) { slab(S, f, 0, len, base, top, 0, 0.06, col, 'ft'); }
  else {
    if (!front) slab(S, f, 0, len, base, base + dado, 0, 0.06, col, 'ft');
    if (!round) for (let k = 0; k <= by.n; k++) {
      const ub = by.start + k * by.width, p = (by.width - wmax) / 2; if (p < 0.25) continue;
      const u0 = k === 0 ? 0 : ub - p, u1 = k === by.n ? len : ub + p; slab(S, f, u0, u1, base, top, 0, 0.06, col, 'flrt');
    }
  }
  if (!round) slab(S, f, 0, len, top - 0.15, top + 0.15, 0, 0.16, col, 'fbt');
}
/** Heavy corbelling under the roof of a tall part: three courses stepping out to `corbel` m, and a bracket under every metre. */
function crownCorbel(soups, f, len, eave, c, stone) {
  const T = soups.get(SOUP.trim), out = c.corbel || 0.6;
  for (let k = 0; k < 3; k++) slab(T, f, 0, len, eave - 0.9 + k * 0.3, eave - 0.6 + k * 0.3, 0, (out * (k + 1)) / 3, stone, 'fbt');
  for (let u = 0.5; u < len - 0.3; u += 1.0) slab(T, f, u - 0.17, u + 0.17, eave - 1.7, eave - 0.9, 0, out * 0.6, shade(stone, 0.9), 'flrf');
}

/** A porte-cochere canopy over each end of a passage through the building: two stone piers, a deep stone beam and a copper-covered top. */
function canopy(soups, b, pa, groundAt, c, stone) {
  const T = soups.get(SOUP.trim), R = soups.get(b.roofColor ? ROOF_TINT_SOUP[2] || ROOF_TINT_SOUP[0] : ROOF_SOUP[2] || ROOF_SOUP[0]), l = Math.hypot(pa.x2 - pa.x1, pa.z2 - pa.z1);
  if (l < 1) return;
  const ux = (pa.x2 - pa.x1) / l, uz = (pa.z2 - pa.z1) / l;
  for (const [sgn, px, pz] of [[1, pa.x2, pa.z2], [-1, pa.x1, pa.z1]]) {
    const f = frame(px, pz, uz * sgn, -ux * sgn), W = pa.w + 1.6, y0 = groundAt(px + ux * sgn * 0.6, pz + uz * sgn * 0.6), top = y0 + Math.min(Math.max(pa.h - 0.5, 3.2), 4.6), tint = b.roofColor || null;   // a marquee about a storey high, whatever the arch's height
    slab(T, f, -W / 2, -W / 2 + 0.5, y0, top, c.depth - 0.5, c.depth, stone, 'flrf'); slab(T, f, W / 2 - 0.5, W / 2, y0, top, c.depth - 0.5, c.depth, stone, 'flrf');   // two slim piers at the outer corners
    slab(T, f, -W / 2, W / 2, top, top + 0.5, 0, c.depth, stone, 'fbtlr');
    const a = f.at(-W / 2 - 0.15, top + 0.5, c.depth + 0.15), bb = f.at(W / 2 + 0.15, top + 0.5, c.depth + 0.15), cc = f.at(W / 2 + 0.15, top + 0.5 + c.rise, 0), dd = f.at(-W / 2 - 0.15, top + 0.5 + c.rise, 0);
    quad(R, a, bb, cc, dd, tint);                       // the copper cover, sloping back to the wall
    tri(R, a, dd, f.at(-W / 2 - 0.15, top + 0.5, 0), tint); tri(R, bb, f.at(W / 2 + 0.15, top + 0.5, 0), cc, tint);
  }
}

/** Ridge cresting and finials: drawn in `base` because they show against the sky from across the river. */
export function landmarkBase(soups, b, style, info) {
  const look = lookOf(style, b); if (!look || !info) return;
  const I = soups.get(SOUP.iron), top = info.top ?? b.yBase + b.hEave + b.hRoof, cr = look.crest || (look.crown && look.crown.cresting && hasCrown(b, look) ? { h: 0.6, w: 0.18 } : null), fi = look.finial, ridge = info.ridge || [];
  if (cr && ridge.length === 2 && Math.abs(ridge[0].y - ridge[1].y) < 0.05) {
    const [p, q] = ridge, l = Math.hypot(q.x - p.x, q.z - p.z);
    if (l > 1) box(I, (p.x + q.x) / 2, (p.z + q.z) / 2, (q.x - p.x) / l, (q.z - p.z) / l, l / 2, cr.w / 2, top - 0.05, top + cr.h, IRON, true);
  }
  roofSeams(soups, b, look, info); stacks(soups, b, look, info, style); bartizans(soups, b, look);
  const fl = look.flag;
  if (fl && ridge.length && top - b.yBase >= fl.above) { // a flagpole on the highest ridge of a tall building; flags are plain colours, no emblem
    const p = ridge[0], F = soups.get(SOUP.awning), tops = fl.colors || ['#7a1620'], c = parseColor(tops[(b.id >>> 3) % tops.length]) || [0.5, 0.05, 0.05];
    box(I, p.x, p.z, 1, 0, 0.07, 0.07, top - 0.1, top + fl.h, IRON, true);
    quad(F, [p.x + 0.08, top + fl.h - 0.2, p.z], [p.x + fl.w, top + fl.h - 0.2, p.z], [p.x + fl.w, top + fl.h - fl.w * 0.55 - 0.2, p.z], [p.x + 0.08, top + fl.h - fl.w * 0.55 - 0.2, p.z], c, [0, 0, 1, 1]);
  }
  const tf = look.turret && look.turret.finial;
  if (tf && b.roofShape === 7 && ridge.length) { // a tall finial with a ball on a cone
    const p = ridge[0]; box(I, p.x, p.z, 1, 0, 0.05, 0.05, top - 0.15, top + tf, IRON, true); ball(I, p.x, top + tf + 0.12, p.z, 0.17, IRON);
  } else if (fi) {
    const pts = b.roofShape === 7 || b.roofShape === 4 ? ridge.slice(0, 1) : ridge.length === 2 ? ridge : [];
    for (const p of pts) {
      box(I, p.x, p.z, 1, 0, fi.w / 2, fi.w / 2, top - 0.1, top + fi.h * 0.55, IRON, true);
      box(I, p.x, p.z, 1, 0, fi.w * 0.25, fi.w * 0.25, top + fi.h * 0.55, top + fi.h, IRON, true);
    }
  }
}
