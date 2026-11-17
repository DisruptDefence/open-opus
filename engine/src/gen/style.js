// What the generators know about looks when a scene says nothing: the neutral style, the names of the format's
// classes, and which material every kind of surface is written into. Pure code.
//
// A scene carries the client part of its style pack as `style` (docs/plans/SCENE-DETAIL.md 2.2 and 3.6); the reader
// lays it over DEFAULT_STYLE with resolveStyle(), so a generator can read any key without asking whether it is there.
// No region lives here: DEFAULT_STYLE is the client part of the country-wide pack, copied by hand (a test compares
// the keys with styles/canada.json when that file is present).
import { linear } from './soup.js';

// ---- the format's classes (docs/SCENE-FORMAT.md 4.1 to 4.5), index = the number in a record -----------------------
export const SURFACE_NAMES = ['unknown', 'asphalt', 'concrete', 'cobble', 'paving', 'gravel', 'dirt', 'grass', 'sand', 'rock', 'snow', 'mud', 'wood', 'metal', 'water', 'vegetation_dense'];
export const FACADE_NAMES = ['generic', 'stone_ashlar', 'stone_rubble', 'brick', 'stucco', 'wood_siding', 'concrete', 'glass', 'metal_panel', 'mud_brick', 'block_unfinished'];
export const ROOF_MAT_NAMES = ['generic', 'metal_seam', 'copper', 'slate', 'shingle', 'tile', 'membrane', 'concrete', 'thatch', 'sheet_metal'];
export const ROOF_SHAPE_NAMES = ['flat', 'gabled', 'hipped', 'mansard', 'pyramidal', 'skillion', 'dome', 'cone', 'gambrel'];
export const ROAD_CLASS_NAMES = ['unknown', 'motorway', 'primary', 'secondary', 'residential', 'service', 'track', 'pedestrian', 'footway', 'steps', 'rail'];
export const WALL_CLASS_NAMES = ['unknown', 'city_wall', 'retaining_wall', 'wall', 'fence', 'hedge', 'guard_rail', 'barrier_block', 'gate'];
export const TREE_KIND_NAMES = ['unknown', 'broadleaf', 'conifer', 'palm', 'shrub', 'dead'];
export const TREE_FORM_NAMES = ['round', 'vase', 'column', 'cone', 'spreading'];
export const SEASONS = ['summer', 'autumn', 'winter', 'spring'];

// ---- material slots: the soup every kind of surface is written into ------------------------------------------------
// The name before the bar is a material of materials/outdoor.js; the letters after it are the soup flags (soup.js).
// A generator takes its soup key from here, so two generators that meet on one building agree on the material, and
// the mesher (level/build.js) needs no table of its own. A name the material library lacks is drawn with the
// library's fallback and one warning: a generator may be written before its material.

/** The textured wall a near façade is cut out of, by façade class (4.2): triplanar, tinted. Also gable walls. */
export const WALL_SOUP = ['wall_stucco|tv', 'wall_stone|tv', 'wall_rubble|tv', 'wall_brick|tv', 'wall_stucco|tv', 'wood|tv', 'concrete|tv', 'concrete|tv', 'galv|tv', 'wall_stucco|tv', 'concrete|tv'];
/** The flat far façade, windows painted in the texture, by façade class: uv counts bays and storeys, tinted. */
export const FACADE_FAR_SOUP = ['facade_stucco|v', 'facade_stone|v', 'facade_rubble|v', 'facade_brick|v', 'facade_stucco|v', 'facade_stucco|v', 'facade_stucco|v', 'facade_stucco|v', 'facade_stucco|v', 'facade_stucco|v', 'facade_stucco|v'];
/** Roof coverings by roof material (4.2). With a colour (`b.roofColor`) the tinted form `…|tv` of ROOF_TINT_SOUP is used. */
export const ROOF_SOUP = ['roof_membrane|t', 'roof_zinc|t', 'roof_copper|t', 'roof_zinc|t', 'roof_zinc|t', 'roof_zinc|t', 'roof_membrane|t', 'concrete|t', 'roof_zinc|t', 'roof_zinc|t'];
export const ROOF_TINT_SOUP = ['roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv', 'roof_zinc|tv'];
/** Free-standing walls by their material (the façade enum, 4.4): triplanar, not tinted. */
export const STRUCTURE_SOUP = ['wall_stone|t', 'wall_stone|t', 'wall_rubble|t', 'wall_brick|t', 'wall_stucco|t', 'wood|t', 'concrete|t', 'concrete|t', 'galv|t', 'wall_stucco|t', 'concrete|t'];
/** Ground laid over the terrain (ribbons, sidewalks), by surface class (4.1): triplanar, casts no shadow. */
export const GROUND_SOUP = ['paving|tn', 'asphalt|tn', 'concrete|tn', 'cobble|tn', 'paving|tn', 'gravel|tn', 'dirt|tn', 'grass|tn', 'sand|tn', 'rock|tn', 'concrete|tn', 'dirt|tn', 'wood|tn', 'metal|tn', 'sand|tn', 'grass|tn'];
/**
 * Single slots. Small things set into or onto a wall cast no shadow of their own (`n`): the shadow map cannot show
 * them, and every soup that casts is drawn once more for each shadow pass.
 */
export const SOUP = {
  plinth: 'stone|tv',       // the low foot of a façade where the ground falls away: triplanar stone, tinted per building (style.plinth.color)
  trim: 'stucco|tvn',       // sills, lintels, cornices, string courses, fascias, frames: painted render, tinted with a trim colour
  window: 'window|v',       // glass and frame, uv 0..1 a casement, 1..2 a shop pane; tinted with the frame colour
  door: 'door|v',           // uv 0..1 one door; tinted with the door colour
  shutter: 'wood|tvn',
  awning: 'tarp|vd',
  kerb: 'concrete|tvn',     // kerb stones and kerb faces: sawn grey, triplanar, tinted (style.kerbColor), no shadow
  paint: 'paint_white|tn',  // road markings
  wear: 'wear|n',           // street wear decals (gutter grit, tyre tracks, asphalt patches, oil): alpha-blended, uv = [along, across] in the wear texture's four bands
  tread: 'concrete|tv',     // stair treads, stringers and door steps: grey stone or concrete, tinted (style.treadColor)
  iron: 'metal|tv',         // lamp posts, rails, bollards: dark iron, tinted
  timber: 'wood|tv',
  lampGlass: 'glass_lamp|n',
  trunk: 'wood|tv',      // bark: tinted per vertex (gen/trees.js)
  leaves: 'leaves|tv',      // crowns: a tint per vertex, dark inside and light on top (gen/trees.js)
  hull: 'stucco|tv',        // the far ring's plain building hulls
};

// ---- the neutral style ---------------------------------------------------------------------------------------------
export const DEFAULT_STYLE = {
  palettes: { stone_ashlar: ['#a8a39a', '#b4ada0', '#99948b'], stone_rubble: ['#8f887c', '#9c9382'], stucco: ['#e6e1d6', '#d8d0c0', '#cfc8bc', '#e0d6c0'],
    brick: ['#8e4f3d', '#9c5d44', '#7d4739'], wood_siding: ['#e4e0d6', '#c9c3b4', '#aab4b8', '#d6c9a8'], concrete: ['#b5b3ad', '#a3a19b'],
    glass: ['#8fa3ad'], metal_panel: ['#a9adb0', '#8d9296'], generic: ['#d8d2c6', '#c8c2b6'] },
  roofs: { metal_seam: ['#8d9396', '#6f777b', '#a9aeb0'], copper: ['#6f9a84'], slate: ['#4a4d52'], shingle: ['#55504a', '#3f3d3a', '#6a5f52'], tile: ['#9a4f38'],
    membrane: ['#3a3b3c'], concrete: ['#8e8c86'], thatch: ['#a39064'], sheet_metal: ['#9aa0a3'], generic: ['#6a6c6e'] },
  trim: ['#e8e4da', '#d9d2c0'], frames: ['#f0ede4', '#f0ede4', '#2a2c2e'], doors: ['#5a3a2a', '#27462f', '#243a5a', '#1f2326'], awnings: ['#7a2f27', '#27462f', '#e8e4da'],
  // window.types: what a modelled window can be: w, h (m; h includes an arched head), sill (m above the floor, default window.sill),
  // reveal (m, default window.reveal), head 'flat' | 'segmental' | 'round', glaze (the panel of the glass: casement, sash22, sash66,
  // sash11, french, single), kind 'round' (a roundel of diameter d set on the wall; no cut) ; `blind` is a bricked-up window.
  // window.mix: per storey class (ground, upper, top = the attic storey of a house of 3 storeys or more) the weight of each type; one
  // type is drawn per building and storey from the building's id, and `blind` is mixed into single bays by its share of the weights.
  window: { bay: [2.8, 3.4], width: 1.0, height: 1.5, sill: 0.9, reveal: 0.12, shutters: 0, panes: [2, 2],
    types: {
      casement: { w: 1.0, h: 1.5, glaze: 'casement' }, sash22: { w: 0.95, h: 1.6, glaze: 'sash22' }, sash66: { w: 1.0, h: 1.75, glaze: 'sash66' },
      sash11: { w: 0.9, h: 1.5, glaze: 'sash11' }, arched: { w: 0.95, h: 2.0, glaze: 'sash66', head: 'segmental' }, arch_round: { w: 0.9, h: 2.2, glaze: 'sash22', head: 'round' },
      french: { w: 1.1, h: 2.3, sill: 0.12, glaze: 'french' }, attic: { w: 0.9, h: 1.15, glaze: 'sash22' }, roundel: { kind: 'round', d: 0.7 }, blind: { w: 1.0, h: 1.5, reveal: 0.05, glaze: 'sash66' },
    },
    mix: {
      ground: { sash22: 3, casement: 2, arched: 1, blind: 0.2 }, upper: { sash66: 3, sash22: 2, casement: 2, french: 0.3, arch_round: 0.4, blind: 0.25 },
      top: { attic: 3, sash11: 1, sash22: 1, roundel: 0.5 },
    } },
  // the windows painted into the far façade (materials/facades.js): the types, their weights by storey, and the lit/curtain/blind
  // states, all data; the shader draws whatever this table says (see gen/wallvar.js for the fields). `shutterColors` and
  // `glass` are colour lists; the sash and dressing colours are `frames` and `trim` above.
  bayWindows: {
    odd: 0.12,
    shutterColors: ['#2f5a45', '#7d1b1a', '#1f2326', '#3e5a7c', '#e8e4da'],
    glass: ['#1d2a33', '#24343a', '#2b2f3a', '#1b2b2a'],
    types: {
      sash6: { shape: 'rect', w: 1.05, h: 1.75, sill: 0.85, grid: [3, 4], rail: true, surround: 0.1, lintel: true, shutters: 0.15 },
      sash2: { shape: 'rect', w: 1.0, h: 1.7, sill: 0.9, grid: [2, 2], rail: true, surround: 0.1, lintel: true, shutters: 0.15 },
      sash1: { shape: 'rect', w: 0.95, h: 1.6, sill: 0.95, grid: [1, 2], rail: true, surround: 0.09, lintel: true, shutters: 0.1 },
      casement: { shape: 'rect', w: 1.1, h: 1.4, sill: 0.95, grid: [2, 3], muntin: 0.045, surround: 0.08, shutters: 0.2 },
      segmental: { shape: 'segmental', w: 1.05, h: 1.85, sill: 0.8, grid: [3, 4], rail: true, surround: 0.12, shutters: 0.1 },
      arched: { shape: 'round', w: 1.0, h: 2.1, sill: 0.7, grid: [3, 5], rail: true, surround: 0.13, shutters: 0.05 },
      oeil: { shape: 'circle', w: 0.7, sill: 1.5, grid: [2, 2], muntin: 0.03, surround: 0.1, sillProj: false },
      french: { shape: 'rect', w: 1.1, h: 2.3, sill: 0.08, grid: [2, 5], muntin: 0.03, surround: 0.12, lintel: true, hood: 'cornice', shutters: 0.4 },
      hooded: { shape: 'rect', w: 1.05, h: 1.75, sill: 0.85, grid: [3, 4], rail: true, surround: 0.1, hood: 'gable', shutters: 0.1 },
      dormer: { shape: 'rect', w: 0.75, h: 1.1, sill: 0.9, grid: [2, 3], surround: 0.08, hood: 'gable' },
      attic: { shape: 'rect', w: 0.7, h: 0.8, sill: 1.2, grid: [2, 2], surround: 0.07 },
      shop: { shape: 'shop', w: 2.3, h: 2.3, sill: 0.35, grid: [2, 1], muntin: 0.06, surround: 0.14, hood: 'cornice' },
      blind: { shape: 'blind', w: 1.0, h: 1.75, sill: 0.85, surround: 0.1, lintel: true },
    },
    classes: {
      ground: { shop: 3, sash6: 2, sash2: 2, segmental: 1.2, arched: 0.8, casement: 0.5, blind: 0.5 },
      first: { sash6: 4, sash2: 2, french: 1, segmental: 1.5, arched: 1, sash1: 1, hooded: 1.2 },
      upper: { sash6: 3, sash2: 3, sash1: 1.5, casement: 1, dormer: 1, attic: 1, oeil: 0.4, blind: 0.4, segmental: 1 },
    },
    states: { clear: 5, curtain: 2, blind: 1.2, lit: 0.5, dark: 1.5, bright: 1.5 },
  },
  groundFloor: { doorWidth: 1.0, doorHeight: 2.1, shopPier: 0.4, shopSill: 0.5, fascia: 0.5, awning: 0.2 },
  cornice: { depth: 0.2, height: 0.25 }, plinth: { height: 0.4, depth: 0.04, color: '#a39d92' },
  dormers: { mansard: 1.0, gabled: 0.25, width: 1.1, height: 1.4 },
  chimneys: { perBuilding: [0, 1], width: 0.8, depth: 0.6, above: 1.0 },
  sidewalk: { width: 1.6, surface: 'concrete' },
  kerb: 0.14, kerbColor: '#8d8a84', treadColor: '#9a968e', season: 'summer',
  // street wear (gen/ground.js): how much of each kind a street gets, 0 = none, 1 = the usual; all drawn near only
  wear: { gutter: 1, tracks: 1, patches: 1, oil: 1, manholes: 1 },
  // façade dressing (gen/dressing.js): the chance per candidate of a hanging sign, a wall lantern, a window box (per house), door pots; 0 = none
  dressing: { signs: 0, lanterns: 0, boxes: 0, pots: 0, flowers: ['#c8323c', '#d9507a', '#e8c23a', '#f2f0ea'] },
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = isObject(base[k]) && isObject(over[k]) ? merge(base[k], over[k]) : over[k];
  return out;
}
/** A scene's `style` block laid over the neutral style: objects merge key by key, lists and values replace. */
export function resolveStyle(sceneStyle) { return merge(DEFAULT_STYLE, isObject(sceneStyle) ? sceneStyle : {}); }

// ---- colours -------------------------------------------------------------------------------------------------------
const NAMED = { white: 0xffffff, black: 0x000000, grey: 0x808080, gray: 0x808080, silver: 0xc0c0c0, red: 0xff0000, maroon: 0x800000, brown: 0xa52a2a, orange: 0xffa500,
  yellow: 0xffff00, green: 0x008000, olive: 0x808000, teal: 0x008080, blue: 0x0000ff, navy: 0x000080, purple: 0x800080, pink: 0xffc0cb, beige: 0xf5f5dc, tan: 0xd2b48c,
  darkgrey: 0xa9a9a9, darkgray: 0xa9a9a9, lightgrey: 0xd3d3d3, lightgray: 0xd3d3d3, darkred: 0x8b0000, darkgreen: 0x006400, darkblue: 0x00008b };
/** A colour as data writes it ("#rrggbb", "#rgb", a common colour word) to linear [r, g, b], or null when it is not one. */
export function parseColor(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s); if (m) return linear(parseInt(m[1], 16));
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s); if (m) return linear(parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16));
  return s in NAMED ? linear(NAMED[s]) : null;
}
/** Entry `index` of a colour list of the style (wrapping), linear; `fallback` (linear) when the list is missing. */
export function paletteColor(list, index, fallback = [0.8, 0.8, 0.8]) {
  if (!Array.isArray(list) || !list.length) return fallback;
  return parseColor(list[((index | 0) % list.length + list.length) % list.length]) || fallback;
}

/** The tints of the kerb stones and of stair treads and door steps: the style's colours, linear; the defaults for an old scene without them. */
export function kerbTint(style) { return parseColor(style && style.kerbColor) || parseColor(DEFAULT_STYLE.kerbColor); }
export function treadTint(style) { return parseColor(style && style.treadColor) || parseColor(DEFAULT_STYLE.treadColor); }
