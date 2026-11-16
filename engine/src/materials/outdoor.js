// Outdoor surfaces the lifted material library did not have: it was written for a port (asphalt, concrete, steel,
// paint). These are new texture generators in the library's own form: a GLSL `surf(uv)` that calls
// `emit(colour, alpha, height, ao, roughness, metalness)` using the tileable noise helpers of materials.js, drawn
// once on the GPU into albedo / ORM / normal sets. Importing this module registers them; nothing else changes.
//
//   ground    cobble, paving, grass, rock, dirt, gravel, sand
//   walls     stone (coursed ashlar), stucco, and a façade bay of each with a window (one bay = 3.0 x 3.2 m,
//             so "windows are in the material, not the mesh", SCENE-FORMAT.md 8)
//   roofs     standing-seam metal (zinc grey, and copper gone green), membrane
//   plants    leaves

import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def } from './materials.js';

GENERATORS.cobble = `
void surf(vec2 uv){
  vec4 v = vor(uv * 20.0, vec2(20.0), 3.0);
  float edge = v.y - v.x;
  float stone = smoothstep(0.03, 0.16, edge);
  float dome = sat(1.0 - v.x * 1.5);
  float grain = fbm(uv, vec2(90.0), 3, 5.0), big = fbm(uv, vec2(3.0), 3, 6.0);
  vec3 a = mix(L(0.30, 0.29, 0.28), L(0.50, 0.47, 0.43), v.z);
  a = mix(a, L(0.42, 0.33, 0.27), step(0.82, v.w) * 0.7);
  vec3 col = a * (0.75 + 0.5 * grain) * (0.85 + 0.3 * big);
  vec3 mortar = L(0.16, 0.15, 0.13) * (0.7 + 0.6 * grain);
  col = mix(mortar, col, stone);
  float h = stone * (0.45 + 0.5 * dome) + grain * 0.08;
  float r = mix(0.95, mix(0.62, 0.8, grain), stone);
  emit(col, 1.0, h, mix(0.5, 1.0, stone), r, 0.0);
}`;

GENERATORS.paving = `
void surf(vec2 uv){
  vec2 g = uv * 5.0; vec2 id = floor(g); vec2 f = g - id;
  vec3 r = h3(id, vec2(5.0), 11.0);
  float joint = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float slab = smoothstep(0.012, 0.035, joint);
  float grain = fbm(uv, vec2(120.0), 3, 12.0), stain = fbm(uv, vec2(4.0), 4, 13.0);
  vec3 col = mix(L(0.43, 0.42, 0.40), L(0.56, 0.54, 0.50), r.x) * (0.8 + 0.4 * grain) * (0.8 + 0.35 * stain);
  col = mix(L(0.14, 0.14, 0.13), col, slab);
  emit(col, 1.0, slab * (0.6 + r.y * 0.08) + grain * 0.06, mix(0.55, 1.0, slab), mix(0.95, 0.78, slab), 0.0);
}`;

GENERATORS.grass = `
void surf(vec2 uv){
  float big = fbm(uv, vec2(3.0), 4, 21.0), mid = fbm(uv, vec2(14.0), 4, 22.0), fine = fbm(uv, vec2(160.0), 3, 23.0);
  float blade = fbm(uv * vec2(1.0, 0.35), vec2(300.0, 105.0), 2, 24.0);
  vec3 a = L(0.16, 0.27, 0.09), b = L(0.30, 0.38, 0.13), dry = L(0.42, 0.40, 0.20);
  vec3 col = mix(a, b, sat(mid * 0.7 + blade * 0.6 - 0.1));
  col = mix(col, dry, smoothstep(0.55, 0.8, big) * 0.55);
  float bare = smoothstep(0.78, 0.9, fbm(uv + 0.3, vec2(6.0), 4, 25.0));
  col = mix(col, L(0.25, 0.19, 0.12), bare * 0.8);
  emit(col * (0.7 + 0.6 * fine), 1.0, mix(0.3 + blade * 0.5 + fine * 0.2, 0.2, bare), 0.75 + 0.25 * blade, 0.93, 0.0);
}`;

GENERATORS.rock = `
void surf(vec2 uv){
  vec4 v = vor(uv * 5.0 + fbm(uv, vec2(4.0), 3, 31.0) * 1.2, vec2(5.0), 32.0);
  float crack = smoothstep(0.0, 0.07, v.y - v.x);
  float strata = fbm(uv * vec2(1.0, 6.0), vec2(3.0, 18.0), 4, 33.0);
  float grain = fbm(uv, vec2(110.0), 3, 34.0), big = fbm(uv, vec2(2.0), 3, 35.0);
  vec3 col = mix(L(0.30, 0.29, 0.28), L(0.50, 0.46, 0.41), strata);
  col = mix(col, L(0.36, 0.30, 0.24), smoothstep(0.5, 0.8, big) * 0.6);
  col *= (0.7 + 0.5 * grain) * mix(0.45, 1.0, crack);
  float moss = smoothstep(0.62, 0.8, fbm(uv + 0.7, vec2(7.0), 4, 36.0)) * 0.6;
  col = mix(col, L(0.20, 0.26, 0.11), moss);
  emit(col, 1.0, crack * (0.4 + 0.4 * strata + 0.2 * v.z) + grain * 0.1, mix(0.45, 1.0, crack), 0.9, 0.0);
}`;

// uP.x: 0 = dirt, 1 = gravel, 2 = sand
GENERATORS.dirt = `
void surf(vec2 uv){
  float mode = uP.x;
  float f = mode > 1.5 ? 0.0 : (mode > 0.5 ? 60.0 : 26.0);
  vec4 v = vor(uv * max(f, 1.0), vec2(max(f, 1.0)), 41.0);
  float peb = f > 0.0 ? smoothstep(0.42, 0.25, v.x) * step(v.z, mode > 0.5 ? 0.95 : 0.35) : 0.0;
  float big = fbm(uv, vec2(3.0), 4, 42.0), fine = fbm(uv, vec2(200.0), 3, 43.0), mid = fbm(uv, vec2(20.0), 4, 44.0);
  vec3 base = mode > 1.5 ? L(0.62, 0.55, 0.40) : (mode > 0.5 ? L(0.40, 0.38, 0.35) : L(0.30, 0.23, 0.15));
  vec3 col = base * (0.75 + 0.5 * mid) * (0.85 + 0.3 * big);
  col = mix(col, mix(L(0.34, 0.33, 0.31), L(0.58, 0.55, 0.50), v.w), peb * 0.9);
  float ripple = mode > 1.5 ? 0.5 + 0.5 * sin((uv.y + big * 0.15) * TAU * 14.0) : 0.0;
  emit(col * (0.8 + 0.4 * fine), 1.0, peb * 0.6 + mid * 0.25 + fine * 0.1 + ripple * 0.15, 0.7 + 0.3 * peb, 0.95, 0.0);
}`;

// coursed stone blocks. uP.x: 0 = grey limestone, 1 = warmer rubble look
GENERATORS.ashlar = `
float ashlarMask(vec2 uv, out vec3 rnd, out vec2 f){
  float rows = 8.0; float row = floor(uv.y * rows);
  float off = h3(vec2(row, 0.0), vec2(rows, 1.0), 51.0).x;
  vec2 g = vec2(uv.x * 4.0 + off, uv.y * rows); vec2 id = floor(g); f = g - id;
  rnd = h3(vec2(mod(id.x, 4.0), id.y), vec2(4.0, rows), 52.0);
  float j = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y));
  return smoothstep(0.03, 0.09, j);
}
void surf(vec2 uv){
  vec3 r; vec2 f; float block = ashlarMask(uv, r, f);
  float grain = fbm(uv, vec2(130.0), 3, 53.0), mid = fbm(uv, vec2(18.0), 4, 54.0), big = fbm(uv, vec2(2.0), 3, 55.0);
  vec3 a = mix(L(0.46, 0.45, 0.43), L(0.62, 0.60, 0.56), r.x);
  a = mix(a, mix(L(0.52, 0.44, 0.36), L(0.40, 0.37, 0.34), r.y), uP.x * 0.8 + step(0.8, r.z) * 0.35);
  vec3 col = a * (0.72 + 0.5 * grain) * (0.85 + 0.25 * mid);
  float streak = fbm(uv * vec2(30.0, 1.0), vec2(30.0, 2.0), 3, 56.0);
  col *= 1.0 - smoothstep(0.55, 0.85, streak) * 0.22 * (0.5 + big);
  col = mix(L(0.20, 0.19, 0.17), col, block);
  emit(col, 1.0, block * (0.55 + r.z * 0.15 + mid * 0.15) + grain * 0.06, mix(0.5, 1.0, block), mix(0.95, 0.84, block), 0.0);
}`;

GENERATORS.stucco = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(180.0), 3, 61.0), mid = fbm(uv, vec2(22.0), 4, 62.0), big = fbm(uv, vec2(2.0), 4, 63.0);
  float streak = fbm(uv * vec2(24.0, 1.0), vec2(24.0, 2.0), 4, 64.0);
  vec3 col = L(0.80, 0.77, 0.70) * (0.86 + 0.2 * mid) * (0.9 + 0.15 * big);
  col *= 1.0 - smoothstep(0.5, 0.85, streak) * 0.18;
  float crack = smoothstep(0.012, 0.004, abs(fbm(uv + 0.2, vec2(3.0), 4, 65.0) - 0.5)) * smoothstep(0.5, 0.7, big);
  col = mix(col, L(0.30, 0.28, 0.25), crack * 0.7);
  emit(col, 1.0, 0.5 + fine * 0.25 + mid * 0.1 - crack * 0.3, 1.0 - crack * 0.4, 0.92, 0.0);
}`;

// One façade bay, 3.0 m wide by 3.2 m high, with a window. uP.x: 0 = stucco wall, 1 = stone wall.
GENERATORS.facade = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(150.0), 3, 71.0), mid = fbm(uv, vec2(16.0), 4, 72.0);
  // wall
  vec3 wall; float wh, wr = 0.92;
  if (uP.x < 0.5){
    float streak = fbm(uv * vec2(20.0, 1.0), vec2(20.0, 2.0), 3, 73.0);
    wall = L(0.80, 0.77, 0.70) * (0.86 + 0.2 * mid) * (1.0 - smoothstep(0.5, 0.85, streak) * 0.16);
    wh = 0.5 + fine * 0.2;
  } else {
    float rows = 8.0; float row = floor(uv.y * rows);
    float off = h3(vec2(row, 0.0), vec2(rows, 1.0), 74.0).x;
    vec2 g = vec2(uv.x * 5.0 + off, uv.y * rows); vec2 id = floor(g); vec2 f = g - id;
    vec3 r = h3(vec2(mod(id.x, 5.0), id.y), vec2(5.0, rows), 75.0);
    float j = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y)); float block = smoothstep(0.03, 0.09, j);
    wall = mix(L(0.46, 0.45, 0.43), L(0.62, 0.60, 0.56), r.x) * (0.72 + 0.5 * fine) * (0.85 + 0.25 * mid);
    wall = mix(L(0.20, 0.19, 0.17), wall, block);
    wh = 0.45 + block * 0.25; wr = mix(0.95, 0.84, block);
  }
  // window: centred, 1.1 m wide, 1.7 m high, sill 0.75 m above the floor
  vec2 c = vec2(0.5, 0.5); vec2 hw = vec2(0.185, 0.265);
  vec2 d = abs(uv - c) - hw;
  float inside = step(max(d.x, d.y), 0.0);
  float frame = step(max(d.x, d.y), 0.0) * step(-0.018, max(d.x, d.y));
  float surround = step(max(d.x - 0.03, d.y - 0.03), 0.0) * (1.0 - inside);
  float mull = inside * max(step(abs(uv.x - c.x), 0.006), step(abs(uv.y - (c.y + 0.07)), 0.005));
  float sill = step(abs(uv.x - c.x), hw.x + 0.05) * step(abs(uv.y - (c.y - hw.y - 0.018)), 0.018);
  float refl = fbm(uv, vec2(3.0), 3, 76.0);
  vec3 glass = mix(L(0.05, 0.07, 0.09), L(0.16, 0.20, 0.24), smoothstep(0.35, 0.7, refl + (uv.y - 0.5) * 0.6));
  vec3 trim = L(0.86, 0.84, 0.78) * (0.9 + 0.15 * fine);
  vec3 col = wall; float h = wh, r = wr, ao = 1.0;
  col = mix(col, trim, surround * 0.85); h = mix(h, 0.72, surround);
  col = mix(col, trim * 1.02, sill); h = mix(h, 0.95, sill);
  col = mix(col, glass, inside); h = mix(h, 0.12, inside); r = mix(r, 0.07, inside); ao = mix(ao, 0.75, inside);
  col = mix(col, trim * 0.9, max(frame, mull)); h = mix(h, 0.35, max(frame, mull)); r = mix(r, 0.6, max(frame, mull));
  emit(col, 1.0, h, ao, r, 0.0);
}`;

// standing-seam roofing. uP.x: 0 = zinc grey, 1 = copper weathered green, 2 = dark membrane
GENERATORS.roof = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(140.0), 3, 81.0), mid = fbm(uv, vec2(10.0), 4, 82.0), big = fbm(uv, vec2(2.0), 3, 83.0);
  float streak = fbm(uv * vec2(40.0, 1.0), vec2(40.0, 2.0), 3, 84.0);
  float x = fract(uv.x * 5.0);
  float seam = uP.x > 1.5 ? 0.0 : smoothstep(0.06, 0.02, abs(x - 0.5));
  vec3 zinc = L(0.42, 0.44, 0.46) * (0.8 + 0.3 * mid);
  vec3 copper = mix(L(0.30, 0.52, 0.44), L(0.22, 0.40, 0.36), mid); copper = mix(copper, L(0.33, 0.24, 0.16), smoothstep(0.7, 0.9, big) * 0.6);
  vec3 memb = L(0.12, 0.12, 0.13) * (0.8 + 0.5 * fine);
  vec3 col = uP.x > 1.5 ? memb : (uP.x > 0.5 ? copper : zinc);
  col *= 1.0 - smoothstep(0.5, 0.85, streak) * 0.25;
  float metal = uP.x > 1.5 ? 0.0 : (uP.x > 0.5 ? 0.25 : 0.75);
  float rough = uP.x > 1.5 ? 0.9 : (uP.x > 0.5 ? 0.7 : 0.42 + 0.2 * mid);
  emit(col * (0.9 + 0.2 * fine), 1.0, 0.4 + seam * 0.55 + fine * 0.05, 1.0 - seam * 0.15, rough, metal);
}`;

GENERATORS.leaves = `
void surf(vec2 uv){
  vec4 v = vor(uv * 22.0, vec2(22.0), 91.0);
  float mid = fbm(uv, vec2(8.0), 4, 92.0), fine = fbm(uv, vec2(120.0), 3, 93.0);
  vec3 col = mix(L(0.08, 0.17, 0.05), L(0.24, 0.36, 0.10), sat(v.z * 0.7 + mid * 0.5 - 0.1));
  col = mix(col, L(0.36, 0.40, 0.14), step(0.9, v.w) * 0.5);
  float leaf = smoothstep(0.5, 0.15, v.x);
  emit(col * (0.55 + 0.5 * leaf) * (0.8 + 0.4 * fine), 1.0, leaf * 0.8 + fine * 0.1, 0.45 + 0.55 * leaf, 0.85, 0.0);
}`;

// texture sets: `tile` is metres per repeat (one number, or [u, v])
Object.assign(SETS, {
  cobble: { fn: 'cobble', size: 1, tile: 2.5, bump: 5 },
  paving: { fn: 'paving', size: 1, tile: 2.5, bump: 3 },
  grass: { fn: 'grass', size: 1, tile: 4, bump: 3 },
  rock: { fn: 'rock', size: 1, tile: 6, bump: 7 },
  dirt: { fn: 'dirt', size: 0.5, tile: 3, bump: 3, p: [0] },
  gravel: { fn: 'dirt', size: 0.5, tile: 2, bump: 4, p: [1], seed: 7 },
  sand: { fn: 'dirt', size: 0.5, tile: 3, bump: 2, p: [2], seed: 9 },
  ashlar: { fn: 'ashlar', size: 1, tile: 2.4, bump: 5, p: [0] },
  rubble: { fn: 'ashlar', size: 1, tile: 2.4, bump: 6, p: [1], seed: 5 },
  stucco: { fn: 'stucco', size: 0.5, tile: 3, bump: 1.5 },
  facade_stucco: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 4, p: [0] },
  facade_stone: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 5, p: [1], seed: 3 },
  roof_zinc: { fn: 'roof', size: 0.5, tile: 2, bump: 4, p: [0] },
  roof_copper: { fn: 'roof', size: 0.5, tile: 2, bump: 4, p: [1], seed: 2 },
  roof_membrane: { fn: 'roof', size: 0.5, tile: 3, bump: 1.5, p: [2], seed: 4 },
  leaves: { fn: 'leaves', size: 0.5, tile: 3, bump: 6 },
});

// wet: how rain changes a surface; macro: large-scale variation. The numbers follow the library's own entries
// for porous ground (asphalt) and for sealed surfaces (painted concrete).
const POROUS = [0.45, 0.3, 0.5, 0], SEALED = [0.15, 0.55, 0.6, 0.3], MACRO = [0.22, 0.12, 0.35, 0.35];
Object.assign(MATERIALS, {
  cobble: def('cobble', { wet: [0.4, 0.5, 0.55, 0.2], macro: MACRO }),
  paving: def('paving', { wet: [0.35, 0.45, 0.55, 0.1], macro: MACRO }),
  grass: def('grass', { wet: [0.2, 0.15, 0.4, 0], macro: [0.3, 0.2, 0.3, 0.6] }),
  rock: def('rock', { wet: POROUS, macro: [0.3, 0.2, 0.5, 0.5] }),
  dirt: def('dirt', { wet: [0.5, 0.25, 0.5, 0], macro: MACRO }),
  gravel: def('gravel', { wet: POROUS, macro: MACRO }),
  sand: def('sand', { wet: [0.5, 0.2, 0.5, 0], macro: MACRO }),
  stone: def('ashlar', { wet: POROUS, macro: MACRO }),
  rubble: def('rubble', { wet: POROUS, macro: MACRO }),
  stucco: def('stucco', { wet: [0.25, 0.2, 0.5, 0], macro: [0.2, 0.15, 0.4, 0.5] }),
  facade_stucco: def('facade_stucco', { wet: [0.2, 0.2, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
  facade_stone: def('facade_stone', { wet: [0.3, 0.25, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
  roof_zinc: def('roof_zinc', { wet: SEALED, macro: MACRO }),
  roof_copper: def('roof_copper', { wet: SEALED, macro: MACRO }),
  roof_membrane: def('roof_membrane', { wet: SEALED, macro: MACRO }),
  leaves: def('leaves', { wet: [0.1, 0.3, 0.4, 0], macro: [0.3, 0.25, 0.3, 0.7] }),
});

// plain names for what the scene format calls a surface, mapped onto the library's own entries
MATERIALS.water = MATERIALS.water_dark; MATERIALS.wood = MATERIALS.wood_dark; MATERIALS.metal = MATERIALS.steel_dark; MATERIALS.galv = MATERIALS.steel_galv;

/** Scene-format classes to material names (SCENE-FORMAT.md 4.1 and 4.2). */
export const SURFACE_MATERIAL = ['paving', 'asphalt', 'concrete', 'cobble', 'paving', 'gravel', 'dirt', 'grass', 'sand', 'rock',
  'concrete', 'dirt', 'wood', 'metal', 'sand', 'grass'];
export const FACADE_MATERIAL = ['facade_stucco', 'facade_stone', 'facade_stone', 'facade_stone', 'facade_stucco', 'facade_stucco',
  'facade_stucco', 'facade_stucco', 'facade_stucco', 'facade_stucco', 'facade_stucco'];
export const WALL_MATERIAL = ['stone', 'stone', 'rubble', 'brick', 'stucco', 'wood', 'concrete', 'concrete', 'galv', 'stucco', 'concrete'];
export const ROOF_MATERIAL = ['roof_membrane', 'roof_zinc', 'roof_copper', 'roof_zinc', 'roof_zinc', 'roof_zinc', 'roof_membrane',
  'concrete', 'roof_zinc', 'roof_zinc'];
/** Façade palettes: a tint over the wall texture, picked by the pipeline per building (`palette`). */
export const PALETTE = [0xffffff, 0xf2e3c6, 0xd9c7a8, 0xe9d2c0, 0xc9d0d4, 0xe6c9a0, 0xb8b0a4, 0xf4ead2];
