// Outdoor surfaces the lifted material library did not have: it was written for a port (asphalt, concrete, steel,
// paint). These are new texture generators in the library's own form: a GLSL `surf(uv)` that calls
// `emit(colour, alpha, height, ao, roughness, metalness)` using the tileable noise helpers of materials.js, drawn
// once on the GPU into albedo / ORM / normal sets. Importing this module registers them; nothing else changes.
//
//   ground    cobble, paving, grass, rock, dirt, gravel, sand
//   walls     stone (coursed ashlar) and stucco for trim, plinths and kerbs; the WALLS of buildings are materials/facades.js
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

// Concrete sidewalk slabs, driven by the geometry (gen/ground.js): uv.x = metres along the walk / (4 slabs), so one tile is
// four slabs long; uv.y = metres across / 6. Two bands in v: 0..0.5 for a walk narrower than 2.4 m (one slab across), 0.5..1
// for a wider one (a long joint down the walk at 1.5 m from the kerb edge). In the narrow band the kerb edge is at 0.12 m, in
// the wide one at 3 m (so the shader knows where the kerb is). The colour is a neutral light grey: the style's sidewalk
// colour is the vertex tint. Joints, per-slab tone, a few hairline cracks, old and new patches, pale granite flags.
GENERATORS.sidewalk_slab = `
void surf(vec2 uv){
  float su = uv.x * 4.0, k = floor(su), fu = su - k;
  float vm = uv.y * 6.0, wide = step(0.5, uv.y);
  float a = vm - mix(0.12, 3.0, wide);
  float side = wide * step(4.5, vm), row = wide * 2.0 + side;
  vec3 r = h3(vec2(k, row), vec2(4.0, 4.0), 201.0), r2 = h3(vec2(k, row), vec2(4.0, 4.0), 202.0);
  float mid = fbm(uv, vec2(10.0), 4, 206.0), fine = fbm(uv, vec2(220.0), 3, 204.0), chipn = fbm(uv, vec2(60.0), 3, 203.0);
  vec4 ag = vor(uv * 500.0, vec2(500.0), 205.0); float stone = smoothstep(0.38, 0.2, ag.x) * step(ag.z, 0.55);
  float jd = min(min(fu, 1.0 - fu) * 1.5, wide > 0.5 ? abs(vm - 4.5) : 9.0) + (chipn - 0.5) * 0.007;
  float joint = smoothstep(0.0150, 0.0070, jd), lip = smoothstep(0.045, 0.0, jd);
  vec2 wu = uv + (vec2(fbm(uv, vec2(7.0), 3, 207.0), fbm(uv, vec2(7.0), 3, 208.0)) - 0.5) * 0.02;
  vec4 cw = vor(wu * 6.0, vec2(6.0), 209.0);
  float crack = smoothstep(0.006, 0.0015, cw.y - cw.x) * step(0.9, r2.y) * step(0.01, a);
  float tone = 1.0 + (r.x - 0.5) * 0.14 + (fu - 0.5) * (r2.x - 0.5) * 0.05;
  float old = step(0.8, r.y), flag = step(0.93, r.z);
  vec3 col = L(0.80, 0.80, 0.78) * tone * (0.86 + 0.3 * mid) * (0.9 + 0.2 * fine);
  col *= mix(1.0, 0.9, old);
  col = mix(col, col * (0.65 + 0.7 * ag.w), stone * 0.45);
  col = mix(col, L(0.99, 0.985, 0.97) * (0.88 + 0.2 * fine) * (1.0 - stone * 0.3 * ag.w), flag * 0.75);
  float kb = smoothstep(0.3, 0.0, a) * step(-0.2, a);
  col *= 1.0 - kb * (0.1 + 0.12 * fine);
  col *= 1.0 - lip * 0.1;
  col = mix(col, L(0.3, 0.3, 0.29), crack * 0.7);
  col = mix(col, L(0.26, 0.26, 0.25), joint);
  float h = 0.62 + (mid - 0.5) * 0.1 + (fine - 0.5) * 0.08 + (fu - 0.5) * (r2.x - 0.5) * 0.12 - lip * 0.04 - joint * 0.5 - crack * 0.18;
  float rough = 0.9 - 0.08 * fine + old * 0.05 - flag * 0.12;
  emit(col, 1.0, h, 1.0 - joint * 0.6 - crack * 0.35, rough, 0.0);
}`;

// Sawn light grey granite for kerb stones, stair treads and door steps (SOUP.kerb, SOUP.tread). The albedo is a light neutral
// grey with a fine salt-and-pepper speckle: the style's kerbColor / treadColor (vertex tint) IS the colour you see. The library's
// `concrete` is a mid grey (0.5) and, tinted by a mid grey too, came out nearly black.
GENERATORS.kerb_granite = `
void surf(vec2 uv){
  float mid = fbm(uv, vec2(9.0), 4, 301.0), fine = fbm(uv, vec2(160.0), 3, 302.0), saw = fbm(uv * vec2(1.0, 0.3), vec2(40.0, 12.0), 3, 303.0), big = fbm(uv, vec2(3.0), 3, 304.0);
  vec4 sp = vor(uv * 420.0, vec2(420.0), 305.0), sp2 = vor(uv * 160.0, vec2(160.0), 306.0);
  float dark = smoothstep(0.34, 0.12, sp.x) * step(sp.z, 0.42), pale = smoothstep(0.3, 0.1, sp2.x) * step(0.72, sp2.z);
  vec3 col = L(0.94, 0.94, 0.92) * (0.9 + 0.14 * mid) * (0.92 + 0.12 * fine) * (0.94 + 0.1 * big);
  col *= 1.0 - dark * 0.38 * (0.5 + sp.w * 0.5);
  col = mix(col, L(1.0, 0.99, 0.97), pale * 0.5);
  col *= 1.0 - smoothstep(0.55, 0.85, saw) * 0.06;
  float h = 0.55 + (mid - 0.5) * 0.1 + (fine - 0.5) * 0.14 - dark * 0.1 + (saw - 0.5) * 0.06;
  emit(col, 1.0, h, 1.0 - dark * 0.2, 0.78 + 0.1 * fine, 0.0);
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


// Street wear laid over the ground as thin decals (gen/ground.js): one texture in four bands, alpha-blended, so the whole
// street needs one extra draw call. The band is picked by v (a fifth each; the decal's own coordinate runs 0.08..0.92 of
// the band, so the mip levels never mix two bands): 0 gutter grit and fallen leaves with a darker damp strip at the kerb
// (0 = at the kerb or wall), 1 tyre track, 2 a repaired patch of asphalt with its sealed seam (u and v span the patch),
// 3 an oil stain (u and v span the blob), 4 a network of cracks sealed with tar (u and v span the patch).
GENERATORS.wear = `
void surf(vec2 uv){
  float band = floor(uv.y * 5.0), u = uv.x, v = fract(uv.y * 5.0);
  float gr = fbm(vec2(u, v), vec2(24.0, 6.0), 4, 101.0), fine = fbm(vec2(u, v), vec2(140.0, 36.0), 3, 102.0), big = fbm(vec2(u, v), vec2(3.0, 2.0), 3, 103.0);
  vec3 col = L(0.1, 0.1, 0.1); float a = 0.0, r = 0.9;
  if (band < 0.5) {
    float edge = pow(1.0 - sat((v - 0.08) / 0.84), 1.15);
    vec4 lf = vor(vec2(u * 20.0, v * 5.0), vec2(20.0, 5.0), 105.0);
    float leaf = step(0.55, lf.z) * smoothstep(0.34, 0.12, lf.x) * smoothstep(0.7, 0.2, v);
    vec3 soil = mix(L(0.14, 0.12, 0.10), L(0.27, 0.22, 0.15), fine);
    vec3 lc = mix(L(0.32, 0.20, 0.07), L(0.20, 0.22, 0.07), lf.w);
    a = edge * (0.22 + 0.35 * smoothstep(0.3, 0.75, big)) * (0.6 + 0.9 * gr);
    col = mix(soil, lc, leaf); a = max(a, leaf * 0.85);
    float damp = smoothstep(0.42, 0.1, v) * (0.75 + 0.5 * smoothstep(0.3, 0.7, gr));
    col = mix(col, L(0.035, 0.035, 0.034), damp * 0.8 * (1.0 - leaf)); a = max(a, damp * 0.5 * (0.7 + 0.5 * fine));
    a *= smoothstep(0.0, 0.1, 1.0 - v) * smoothstep(0.0, 0.04, v);
    r = mix(0.95, 0.55, damp * 0.5);
  } else if (band < 1.5) {
    float prof = smoothstep(0.1, 0.4, v) * smoothstep(0.9, 0.6, v);
    a = prof * (0.1 + 0.2 * smoothstep(0.3, 0.75, gr)) * (0.6 + 0.8 * fine);
    col = L(0.05, 0.048, 0.045); r = 0.5;
  } else if (band < 2.5) {
    float e = min(min(u, 1.0 - u) * 0.5, min(v, 1.0 - v)) - 0.04;
    float body = smoothstep(0.0, 0.012, e), seam = smoothstep(0.045, 0.03, e) * body;
    vec3 fresh = mix(L(0.19, 0.185, 0.18), L(0.26, 0.25, 0.235), fine) * (0.85 + 0.3 * big);
    col = mix(fresh, L(0.02, 0.02, 0.022), seam * 0.9); a = body;
    r = mix(0.82, 0.3, seam);
  } else if (band < 3.5) {
    float d = length(vec2((u - 0.5) * 2.0, (v - 0.5) * 2.0)) + (gr - 0.5) * 0.55 + (fine - 0.5) * 0.12;
    a = smoothstep(0.78, 0.2, d) * 0.62 * smoothstep(0.0, 0.1, min(min(u, 1.0 - u), min(v, 1.0 - v)));
    col = mix(L(0.045, 0.04, 0.035), L(0.08, 0.075, 0.07), smoothstep(0.7, 0.1, d)); r = 0.3 + 0.3 * smoothstep(0.1, 0.7, d);
  } else {
    vec2 q = vec2(u, v) + (vec2(gr, big) - 0.5) * 0.06;
    vec4 c1 = vor(q * 3.0, vec2(3.0), 107.0), c2 = vor(q * 7.0 + 0.4, vec2(7.0), 108.0);
    float l1 = smoothstep(0.03, 0.006, c1.y - c1.x) * step(0.25, c1.z), l2 = smoothstep(0.035, 0.008, c2.y - c2.x) * step(0.62, c2.z);
    float edge = smoothstep(0.0, 0.18, min(min(u, 1.0 - u), min(v, 1.0 - v))) * smoothstep(0.15, 0.55, 1.0 - length(vec2(u, v) - 0.5) * 1.3);
    a = max(l1, l2 * 0.8) * edge * (0.65 + 0.35 * fine) * 0.9;
    col = L(0.025, 0.025, 0.026); r = 0.32;
  }
  emit(col, a, 0.5, 1.0, r, 0.0);
}`;


// road paint, worn: uP.x = how worn. The texture's alpha is where the paint colour (the material's tint) still covers; where
// it has chipped away the grey grit of the road shows. A line is a few centimetres wide, so the wear is fine-grained.
GENERATORS.paint = `
void surf(vec2 uv){
  float amt = uP.x;
  float fine = fbm(uv, vec2(180.0), 3, 111.0), mid = fbm(uv, vec2(28.0), 4, 112.0), big = fbm(uv, vec2(4.0), 4, 113.0);
  float worn = smoothstep(0.5 - 0.2 * amt, 0.82, mid * 0.55 + big * 0.45 + (fine - 0.5) * 0.45);
  float cover = 1.0 - worn * (0.3 + 0.35 * amt);
  float scuff = smoothstep(0.62, 0.9, fbm(uv * vec2(1.0, 0.25), vec2(6.0, 2.0), 3, 114.0)) * 0.3;
  vec3 under = L(0.15, 0.145, 0.14) * (0.7 + 0.6 * fine);
  emit(under, sat(cover - scuff), 0.45 + cover * 0.1 + fine * 0.06, 0.8 + 0.2 * cover, mix(0.9, 0.62, cover), 0.0);
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
  roof_zinc: { fn: 'roof', size: 0.5, tile: 2, bump: 4, p: [0] },
  roof_copper: { fn: 'roof', size: 0.5, tile: 2, bump: 4, p: [1], seed: 2 },
  roof_membrane: { fn: 'roof', size: 0.5, tile: 3, bump: 1.5, p: [2], seed: 4 },
  leaves: { fn: 'leaves', size: 0.5, tile: 3, bump: 6 },
  wear: { fn: 'wear', size: 1, tile: 4, bump: 0 },
  sidewalk_slab: { fn: 'sidewalk_slab', size: 1, tile: 6, bump: 2.5 },
  kerb_granite: { fn: 'kerb_granite', size: 1, tile: 1.5, bump: 2 },
});

// wet: how rain changes a surface; macro: large-scale variation. The numbers follow the library's own entries
// for porous ground (asphalt) and for sealed surfaces (painted concrete).
// STREET: tone drifting over several metres (amplitude, roughness, 1 / metres, grime), so a long street is not one flat shade
const STREET = [0.5, 0.18, 0.1, 0.4];
const POROUS = [0.45, 0.3, 0.5, 0], SEALED = [0.15, 0.55, 0.6, 0.3], MACRO = [0.22, 0.12, 0.35, 0.35];
Object.assign(MATERIALS, {
  cobble: def('cobble', { wet: [0.4, 0.5, 0.55, 0.2], macro: STREET }),
  paving: def('paving', { wet: [0.35, 0.45, 0.55, 0.1], macro: STREET }),
  grass: def('grass', { wet: [0.2, 0.15, 0.4, 0], macro: [0.4, 0.2, 0.12, 0.6] }),
  rock: def('rock', { wet: POROUS, macro: [0.3, 0.2, 0.5, 0.5] }),
  dirt: def('dirt', { wet: [0.5, 0.25, 0.5, 0], macro: MACRO }),
  gravel: def('gravel', { wet: POROUS, macro: MACRO }),
  sand: def('sand', { wet: [0.5, 0.2, 0.5, 0], macro: MACRO }),
  stone: def('ashlar', { wet: POROUS, macro: MACRO }),
  rubble: def('rubble', { wet: POROUS, macro: MACRO }),
  stucco: def('stucco', { wet: [0.25, 0.2, 0.5, 0], macro: [0.2, 0.15, 0.4, 0.5] }),
  roof_zinc: def('roof_zinc', { wet: SEALED, macro: MACRO }),
  roof_copper: def('roof_copper', { wet: SEALED, macro: MACRO }),
  roof_membrane: def('roof_membrane', { wet: SEALED, macro: MACRO }),
  leaves: def('leaves', { wet: [0.1, 0.3, 0.4, 0], macro: [0.3, 0.25, 0.3, 0.7] }),
  sidewalk_slab: def('sidewalk_slab', { wet: [0.35, 0.45, 0.55, 0.1], macro: [0.14, 0.1, 0.35, 0.3] }),
  kerb_granite: def('kerb_granite', { wet: [0.3, 0.4, 0.55, 0], macro: [0.1, 0.1, 0.35, 0.2] }),
  wear: def('wear', { tint: 3, transparent: true, wet: [0, 1, 0, 0], macro: [0, 0, 1, 0] }),
});

// the library's asphalt, with the same slow drift (their own table is for a floor of a few metres)
Object.assign(MATERIALS, {
  asphalt: def('asphalt', { wet: [0.45, 0.3, 0.5, 0], macro: STREET }),
});

// plain names for what the scene format calls a surface, mapped onto the library's own entries
MATERIALS.water = MATERIALS.water_dark; MATERIALS.wood = MATERIALS.wood_dark; MATERIALS.metal = MATERIALS.steel_dark; MATERIALS.galv = MATERIALS.steel_galv;

/** Scene-format classes to material names (SCENE-FORMAT.md 4.1 and 4.2). */
export const SURFACE_MATERIAL = ['paving', 'asphalt', 'concrete', 'cobble', 'paving', 'gravel', 'dirt', 'grass', 'sand', 'rock',
  'concrete', 'dirt', 'wood', 'metal', 'sand', 'grass'];
export const FACADE_MATERIAL = ['facade_stucco', 'facade_stone', 'facade_rubble', 'facade_brick', 'facade_stucco', 'facade_stucco',
  'facade_stucco', 'facade_stucco', 'facade_stucco', 'facade_stucco', 'facade_stucco'];
export const WALL_MATERIAL = ['stone', 'stone', 'rubble', 'brick', 'stucco', 'wood', 'concrete', 'concrete', 'galv', 'stucco', 'concrete'];
export const ROOF_MATERIAL = ['roof_membrane', 'roof_zinc', 'roof_copper', 'roof_zinc', 'roof_zinc', 'roof_zinc', 'roof_membrane',
  'concrete', 'roof_zinc', 'roof_zinc'];
/** Façade palettes: a tint over the wall texture, picked by the pipeline per building (`palette`). */
export const PALETTE = [0xffffff, 0xf2e3c6, 0xd9c7a8, 0xe9d2c0, 0xc9d0d4, 0xe6c9a0, 0xb8b0a4, 0xf4ead2];

import './openings.js';
