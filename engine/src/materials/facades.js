// Walls, third pass: no wall pattern may repeat. A baked tile repeats by nature (one tile of stone laid over a town is
// the same stone everywhere), so the structure of a wall is no longer baked.
//
//   baked   one small tile of DETAIL per kind of wall (render, masonry): grain, pits, hairline cracks, soot; neutral
//           grey, the library's own method (GLSL `surf(uv)` calling `emit`, drawn once into albedo / ORM / normal).
//           The shader samples it twice at two scales (so its period is no period at all) and multiplies.
//   live    everything that must differ: the courses of stone and brick (block length, course height, bond, joint
//           width and colour, block tones), the windows of the far façade, string courses, weathering. Drawn per
//           pixel from a hash of the BUILDING (its wall tint, which the mesher writes into every vertex, is its id:
//           gen/wallvar.js), the bay and the storey. One material per kind of wall, one draw call: no per-building
//           material, no per-building vertex data.
//
// Where the per-pixel part runs: the far façade (uv in metres: u along the wall, v above the building's base, one bay
// 3.0 x 3.2 m as gen/facade.js writes it) draws masonry, windows, bands and weathering; a near wall (triplanar, real
// geometry for its openings) draws masonry and weathering only. Both read the same code.
//
// The windows are DATA: the style pack's `bayWindows` table (gen/style.js, styles/*.json) is compiled by gen/wallvar.js
// into uniforms (setBayStyle below); a new place adds or changes window types by editing that table, no engine code.
//
// Importing this module (after outdoor.js, which it imports itself) defines the sets and materials; the soups name them
// (gen/style.js).
import './outdoor.js';
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def, LIVE } from './materials.js';
import { compileWindows, paletteRows, MAX_TYPES } from '../gen/wallvar.js';
import { parseColor } from '../gen/style.js';

/** The bay's size in metres; the shader is written against it (gen/facade.js: u counts bays of 3 m, v counts storeys of 3.2 m). */
export const BAY = { width: 3.0, height: 3.2 };

// ---- the baked detail tile -------------------------------------------------------------------------------------------
GENERATORS.walldetail = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(180.0), 3, 61.0), mid = fbm(uv, vec2(22.0), 4, 62.0), big = fbm(uv, vec2(2.0), 4, 63.0);
  float wave = fbm(uv, vec2(9.0, 8.0), 3, 65.0);
  float lum, h, ao = 1.0, r = 0.92;
  if (uP.x < 0.5){                                    // render: trowel waves, streaks, hairline cracks
    float streak = fbm(uv * vec2(24.0, 1.0), vec2(24.0, 2.0), 4, 64.0);
    lum = 0.5 * (0.9 + 0.16 * mid) * (0.94 + 0.12 * big) * (1.0 - smoothstep(0.5, 0.85, streak) * 0.06);
    float crack = smoothstep(0.011, 0.003, abs(fbm(uv + 0.2, vec2(3.0), 4, 66.0) - 0.5)) * smoothstep(0.55, 0.7, big);
    lum *= 1.0 - crack * 0.3; ao = 1.0 - crack * 0.3;
    h = 0.5 + (fine - 0.5) * 0.4 + (wave - 0.5) * 0.35 - crack * 0.25;
  } else {                                            // masonry: grain, pits, soot
    float pit = smoothstep(0.7, 0.82, fbm(uv, vec2(200.0), 3, 78.0));
    float soot = smoothstep(0.5, 0.8, fbm(uv, vec2(3.0), 4, 97.0));
    lum = 0.5 * (0.84 + 0.3 * fine) * (0.88 + 0.22 * mid) * (0.94 + 0.12 * big) * (1.0 - pit * 0.3) * (1.0 - soot * 0.2);
    h = 0.5 + (fine - 0.5) * 0.45 + (mid - 0.5) * 0.3 - pit * 0.25;
    ao = 1.0 - pit * 0.35; r = 0.9 + (mid - 0.5) * 0.1;
  }
  emit(vec3(lum), 1.0, h, ao, r, 0.0);
}`;

// ---- the live part ---------------------------------------------------------------------------------------------------
const MAXT = MAX_TYPES;
export const LIVE_GLSL = `
uniform vec4 uSlLive;      // x: kind (0 render, 1 stone, 2 rubble, 3 brick); yz: tile size in metres
uniform vec4 uBwT[${MAXT * 4}];     // window types, 4 vec4 each (gen/wallvar.js windowType)
uniform float uBwCdf[${MAXT * 3}];  // cumulative weights of the types, per storey class
uniform float uBwSt[6];    // cumulative weights of the window states
uniform vec4 uBwOpt;       // x: odd-one-out chance, y: lit window glow, z: grime, w: unused
uniform vec4 uBwN;         // palette sizes: frames, trim, shutters, glass
uniform vec3 uBwF[8]; uniform vec3 uBwTr[8]; uniform vec3 uBwSh[8]; uniform vec3 uBwG[4];
float slLiveH = 0.0, slLiveFlat = 0.0; vec3 slLiveEm = vec3(0.0);

// ---- hash: the same arithmetic as gen/wallvar.js ----
uint lvP(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint lvH(uint a, uint b){ return lvP(a + lvP(b)); }
float lvU(uint h){ return float(h >> 8u) * (1.0 / 16777216.0); }
uint lvI(float f){ return uint(int(floor(f))); }
vec3 lvL(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }
float lvIn(float d, float aa){ return 1.0 - smoothstep(-aa, aa, d); }   // 1 where d < 0, with a pixel of edge

// ---- courses of stone and brick: the distance to the nearest joint (m), the block's hash, the course ----
float lvE(uint k, float i, float jit){ return i + jit * (2.0 * lvU(lvH(k, lvI(i))) - 1.0); }
void lvCourses(float x, float y, uint bid, float kind, out float d, out uint hb, out float hdr){
  float r0 = lvU(lvH(bid, 11u)), r1 = lvU(lvH(bid, 12u)), r3 = lvU(lvH(bid, 14u)), r4 = lvU(lvH(bid, 15u)), r5 = lvU(lvH(bid, 16u));
  float ch, bl, jit;
  if (kind > 2.5){ ch = mix(0.066, 0.085, r0); bl = mix(0.205, 0.26, r1); jit = 0.0; }
  else if (kind > 1.5){ ch = mix(0.19, 0.34, r0); bl = mix(0.32, 0.72, r1); jit = 0.42; }
  else { ch = mix(0.28, 0.54, r0); bl = mix(0.55, 1.2, r1); jit = 0.2; }
  float rowId, ly, chh;
  if (kind > 2.5){ rowId = floor(y / ch); ly = y - rowId * ch; chh = ch; }
  else {                                                         // three course heights in a rhythm: no two courses alike by rule
    float a1 = mix(0.68, 1.0, r4), a2 = mix(1.0, 1.35, r5), P = ch * (1.0 + a1 + a2);
    float k = floor(y / P), yy = y - k * P;
    float j = yy < ch ? 0.0 : (yy < ch * (1.0 + a1) ? 1.0 : 2.0);
    float st = j < 0.5 ? 0.0 : (j < 1.5 ? ch : ch * (1.0 + a1));
    chh = ch * (j < 0.5 ? 1.0 : (j < 1.5 ? a1 : a2)); ly = yy - st; rowId = k * 3.0 + j;
  }
  uint ru = lvI(rowId); float blr = bl, off; hdr = 0.0;
  if (kind > 2.5){
    off = 0.5 * mod(rowId, 2.0) * bl;                            // running bond; English bond (a header course every n) for some
    if (r3 < 0.5 && mod(rowId, floor(mix(4.0, 7.9, r3 * 2.0))) < 0.5){ blr = bl * 0.5; hdr = 1.0; off = 0.0; }
  } else {
    blr = bl * mix(0.8, 1.25, lvU(lvH(bid ^ ru, 17u))); off = lvU(lvH(bid + 99u, ru)) * blr;
  }
  float bx = (x + off) / blr, i = floor(bx); uint k = lvH(bid, ru);
  if (bx < lvE(k, i, jit)) i -= 1.0; else if (bx >= lvE(k, i + 1.0, jit)) i += 1.0;
  float dx = min(bx - lvE(k, i, jit), lvE(k, i + 1.0, jit) - bx) * blr;
  d = min(dx, min(ly, chh - ly)); hb = lvH(k, lvI(i) + 7u);
}
// a masonry wall: colour (before the building's tint), height (m), occlusion, roughness
void lvMasonry(float x, float y, uint bid, float kind, float aa, float warp, out vec3 col, out float h, out float ao, out float rough){
  float d, hdr; uint hb; lvCourses(x, y, bid, kind, d, hb, hdr); d += warp;
  float r2 = lvU(lvH(bid, 13u));
  float rj = kind > 2.5 ? 0.0095 : (kind > 1.5 ? mix(0.014, 0.03, r2) : mix(0.007, 0.015, r2));
  float edge = d - rj * 0.5, w = max(aa, 0.0025);
  float face = smoothstep(-w, w, edge), bevel = smoothstep(0.0, kind > 2.5 ? 0.006 : 0.05, edge);
  float u0 = lvU(hb), u1 = lvU(lvH(hb, 3u)), u2 = lvU(lvH(hb, 5u));
  vec3 c;
  if (kind > 2.5){
    float fam = lvU(lvH(bid, 21u));
    vec3 a = fam < 0.34 ? lvL(0.52, 0.25, 0.18) : (fam < 0.54 ? lvL(0.40, 0.20, 0.16) : (fam < 0.74 ? lvL(0.62, 0.36, 0.21) : (fam < 0.84 ? lvL(0.66, 0.52, 0.33) : lvL(0.34, 0.21, 0.21))));
    c = a * (0.78 + 0.44 * u0);
    c = mix(c, lvL(0.62, 0.33, 0.22), smoothstep(0.6, 1.0, u1) * 0.5);
    c = mix(c, c * 0.5, smoothstep(0.86, 1.0, u2) * 0.9);                  // burnt
    c = mix(c, lvL(0.58, 0.42, 0.30), step(0.97, u1) * 0.8);               // pale
    if (hdr > 0.5) c *= 0.82;                                              // vitrified headers
    c *= 1.3;
  } else {
    float wb = lvU(lvH(bid, 22u)); wb = wb * wb * 0.55; float contrast = mix(0.5, 1.25, lvU(lvH(bid, 23u)));
    vec3 base = mix(lvL(0.50, 0.49, 0.46), lvL(0.68, 0.66, 0.60), u0);
    vec3 warm = mix(lvL(0.56, 0.50, 0.40), lvL(0.42, 0.38, 0.34), u1);
    c = mix(base, warm, clamp(wb + step(0.86, u2) * 0.5, 0.0, 1.0));
    c *= (1.0 + (u1 - 0.5) * 0.35 * contrast * (kind > 1.5 ? 1.6 : 1.0)) * 1.3;
  }
  float m = lvU(lvH(bid, 24u));
  vec3 mortar = m < 0.4 ? lvL(0.60, 0.57, 0.52) : (m < 0.65 ? lvL(0.45, 0.45, 0.43) : (m < 0.8 ? lvL(0.28, 0.27, 0.25) : (m < 0.92 ? lvL(0.62, 0.55, 0.42) : lvL(0.76, 0.75, 0.72))));
  col = mix(mortar * (0.85 + 0.3 * u2), c, face);
  float rec = kind > 2.5 ? 0.005 : (kind > 1.5 ? 0.012 : 0.008);
  h = -rec * (1.0 - face) - (1.0 - bevel) * (kind > 2.5 ? 0.0015 : 0.004) * face + (u1 - 0.5) * 0.004;
  ao = mix(0.55, 1.0, face * smoothstep(0.0, 0.02, edge));
  rough = mix(0.97, 0.86, face);
}
float lvNz(vec2 p, float s){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(slH(vec3(i, s)), slH(vec3(i + vec2(1.0, 0.0), s)), f.x), mix(slH(vec3(i + vec2(0.0, 1.0), s)), slH(vec3(i + 1.0, s)), f.x), f.y);
}
// the weathering of any wall: tone drift, stains, streaks of rain, damp, salt, patches of repair. x, y in metres on the wall;
// base: height above the ground (m) or -1 when it is not known.
void lvWeather(inout vec3 c, inout float h, inout float ao, float x, float y, float base, uint bid, float kind, float aa){
  float gr = mix(0.5, 1.25, lvU(lvH(bid, 31u))) * uBwOpt.z;
  float sd = floor(lvU(lvH(bid, 32u)) * 61.0);
  c *= 1.0 + (lvNz(vec2(x, y) * vec2(0.11, 0.09), sd + 0.0) - 0.5) * 0.36 + (lvNz(vec2(x, y) * vec2(0.37, 0.33), sd + 5.0) - 0.5) * 0.14;
  c *= mix(vec3(1.04, 1.0, 0.95), vec3(0.96, 0.99, 1.04), lvNz(vec2(x, y) * vec2(0.07, 0.07), sd + 9.0));
  float st = lvNz(vec2(x, y) * vec2(0.5, 0.45), sd + 3.0) * 0.6 + lvNz(vec2(x, y) * vec2(1.3, 1.1), sd + 1.0) * 0.4;
  c *= 1.0 - smoothstep(0.52, 0.72, st) * 0.22 * gr;
  float sx = lvNz(vec2(x * 6.0, y * 0.45), sd) * lvNz(vec2(x * 21.0, y * 0.8), sd + 3.0);
  float sm = smoothstep(0.35, 0.65, lvNz(vec2(x * 0.55, y * 0.12), sd + 8.0));
  c *= 1.0 - smoothstep(0.14, 0.4, sx) * sm * 0.2 * gr;
  if (base >= 0.0){
    float dm = 1.0 - smoothstep(0.1, 1.15, base + (lvNz(vec2(x, y) * vec2(1.7, 1.7), sd + 2.0) - 0.5) * 0.7);
    c *= 1.0 - dm * 0.26 * gr; c.g *= 1.0 + dm * 0.05;
    float ef = smoothstep(0.6, 0.78, lvNz(vec2(x, y) * vec2(2.3, 2.3), sd + 4.0)) * (1.0 - smoothstep(0.8, 2.2, base)) ;
    c = mix(c, lvL(0.74, 0.73, 0.69), ef * 0.28);
  }
  // patches of repair: a rectangle of another tone, a little proud, with a dark edge
  vec2 cell = vec2(1.3, 0.85), g = vec2(x, y) / cell + vec2(lvU(lvH(bid, 33u)) * 9.0, 0.0), id = floor(g), f = fract(g);
  uint ph = lvH(lvH(bid, lvI(id.x)), lvI(id.y) + 55u);
  if (lvU(ph) < (kind < 0.5 ? 0.03 : 0.05) * gr){
    vec2 hw = vec2(0.28, 0.25) + 0.2 * vec2(lvU(lvH(ph, 1u)), lvU(lvH(ph, 2u)));
    vec2 dd = abs(f - 0.5) * cell - hw * 0.5 * cell / vec2(1.3, 0.85);
    float inn = 1.0 - smoothstep(-aa, aa, max(dd.x, dd.y));
    float t = lvU(lvH(ph, 3u));
    vec3 tone = t < 0.33 ? vec3(1.28, 1.2, 1.02) : (t < 0.66 ? vec3(0.78, 0.76, 0.74) : vec3(1.12, 0.98, 0.86));
    c = mix(c, c * tone, inn); h += inn * 0.004; ao *= 1.0 - 0.3 * smoothstep(-0.025, 0.0, max(dd.x, dd.y)) * inn;
  }
}
// plain render: faint score lines on a building that was dressed that way
void lvRender(float x, float y, uint bid, float aa, out vec3 col, out float h, out float ao, out float rough){
  col = lvL(0.80, 0.77, 0.70) * (0.9 + 0.2 * lvU(lvH(bid, 41u))); h = 0.0; ao = 1.0; rough = 0.93;
  if (lvU(lvH(bid, 42u)) < 0.4 && y < 3.2){
    float pitch = mix(0.35, 0.6, lvU(lvH(bid, 43u))), d = abs(fract(y / pitch + 0.5) - 0.5) * pitch;
    float gv = 1.0 - smoothstep(0.004, 0.004 + max(aa, 0.002), d); h -= gv * 0.006; ao *= 1.0 - 0.3 * gv; col *= 1.0 - 0.12 * gv;
  }
}

// ---- the window of one bay ----
void lvWindow(vec2 p, float bayW, uint bid, uint bayI, uint stor, float aa, vec3 wallCol, inout vec3 col, inout float h, inout float ao, inout float rough, inout vec3 em, inout float flatN){
  uint hs = lvH(lvH(bid, stor), 77u), hbv = lvH(lvH(bid, bayI), stor * 131u + 5u);
  int cls = stor == 0u ? 0 : (stor == 1u ? 1 : 2);
  bool odd = lvU(lvH(hs, bayI + 3u)) < uBwOpt.x;
  float pu = odd ? lvU(lvH(hbv, 78u)) : lvU(lvH(hs, 79u));
  int ti = 0;
  for (int i = ${MAXT - 1}; i >= 0; i--) if (pu < uBwCdf[cls * ${MAXT} + i]) ti = i;
  vec4 T0 = uBwT[ti * 4], T1 = uBwT[ti * 4 + 1], T2 = uBwT[ti * 4 + 2], T3 = uBwT[ti * 4 + 3];
  int shape = int(T0.x + 0.5); float w = T0.y, hh = T0.z, sill = T0.w;
  float cols = max(T1.x, 1.0), rows = max(T1.y, 1.0), mun = T1.w, sw = T2.x;
  int hood = int(T2.w + 0.5);
  float fit = bayW - 2.0 * sw - 0.35;
  if (w > fit){ float k = fit / w; w *= k; if (shape == 3) hh = w; }
  float a = w * 0.5;
  vec2 q = vec2(p.x, p.y - sill);
  // the opening as a signed distance: negative inside
  float d, rise = 0.0;
  if (shape == 1 || shape == 2){
    rise = shape == 2 ? a : a * 0.34; float hs0 = hh - rise;
    if (q.y > hs0){ float R = (a * a + rise * rise) / (2.0 * rise); d = max(-q.y, length(vec2(q.x, q.y - (hh - R))) - R); }
    else d = max(-q.y, abs(q.x) - a);
  } else if (shape == 3){ d = length(vec2(q.x, q.y - hh * 0.5)) - a; }
  else { d = max(abs(q.x) - a, max(-q.y, q.y - hh)); }
  // colours of the building
  float fbase = lvU(lvH(bid, 61u)), fodd = lvU(lvH(hbv, 62u));
  float fsel = lvU(lvH(hbv, 63u)) < 0.07 ? fodd : fbase;
  vec3 frameC = uBwF[int(fsel * uBwN.x)], trimC = uBwTr[int(lvU(lvH(bid, 64u)) * uBwN.y)], shutC = uBwSh[int(lvU(lvH(bid, 65u)) * uBwN.z)];
  vec3 trimA = trimC * (0.93 + 0.1 * lvU(lvH(bid, 66u)));
  float mOpen = lvIn(d, aa), mSur = lvIn(d - sw, aa) * (1.0 - mOpen);
  // dressing round the opening, lintel, sill, hood
  float lint = T2.y * step(abs(q.x), a + sw + 0.07) * smoothstep(-aa, aa, q.y - hh + 0.0) * (1.0 - smoothstep(-aa, aa, q.y - (hh + sw + 0.15)));
  float sil = T2.z * step(abs(q.x), a + sw + 0.07) * (1.0 - smoothstep(-aa, aa, q.y)) * smoothstep(-aa, aa, q.y + sw + 0.07);
  float hd = 0.0;
  float hx = a + sw + 0.1;
  if (hood == 1){ float yy = q.y - (hh + sw + 0.02); hd = step(0.0, yy) * (1.0 - smoothstep(-aa, aa, yy - (hx - abs(q.x)) * 0.62)) * step(abs(q.x), hx); }
  else if (hood == 2){ float yy = q.y - (hh + sw + 0.02); hd = step(0.0, yy) * (1.0 - smoothstep(-aa, aa, length(vec2(q.x, yy * 2.2)) - hx)); }
  else if (hood == 3){ float yy = q.y - (hh + sw + 0.01); hd = step(abs(q.x), hx + 0.1) * smoothstep(-aa, aa, yy) * (1.0 - smoothstep(-aa, aa, yy - 0.13)); }
  float dress = max(max(mSur, lint), max(sil, hd));
  dress *= 1.0 - mOpen;
  flatN = max(flatN, dress * 0.8);
  col = mix(col, trimA, dress); h = mix(h, 0.02 + sil * 0.03 + hd * 0.015, dress); rough = mix(rough, 0.8, dress); ao = mix(ao, 1.0, dress);
  ao *= 1.0 - 0.45 * (1.0 - dress) * (1.0 - mOpen) * smoothstep(0.16, 0.0, -(q.y + sw + 0.07)) * step(q.y, -sw - 0.07) * step(abs(q.x), a + 0.1) * T2.z;
  // inside the opening
  if (mOpen > 0.0 || shape == 4){
    float depth = -0.13;
    if (shape == 4){                                        // blocked: infill of the wall's own stone, set back a little
      col = mix(col, wallCol * 0.78, mOpen); h = mix(h, -0.035, mOpen); ao = mix(ao, 0.7, mOpen);
    } else {
      float fw = shape == 5 ? 0.04 : 0.055;
      float ux = (q.x + a) / w, uy = shape == 3 ? (q.y / hh) : q.y / hh;
      float ring = smoothstep(-fw - aa, -fw + aa, d);
      float gx = min(fract(ux * cols), 1.0 - fract(ux * cols)) * w / cols, gy = min(fract(uy * rows), 1.0 - fract(uy * rows)) * hh / rows;
      float mu = max(1.0 - smoothstep(mun * 0.5 - aa, mun * 0.5 + aa, gx), 1.0 - smoothstep(mun * 0.5 - aa, mun * 0.5 + aa, gy));
      float rail = T1.z * (1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(q.y - hh * 0.5)));
      float fr = max(ring, max(mu, rail));
      // the pane
      vec2 pid = vec2(floor(ux * cols), floor(uy * rows));
      uint ph = lvH(hbv, lvI(pid.x) * 31u + lvI(pid.y) + 700u);
      float pr = lvU(ph), sky = smoothstep(-0.2, 1.1, uy + (pr - 0.5) * 0.5);
      float us = lvU(lvH(hbv, 80u)); int stt = 0;
      for (int i = 5; i >= 0; i--) if (us < uBwSt[i]) stt = i;
      vec3 gc = uBwG[int(lvU(lvH(bid, 67u)) * uBwN.w)];
      vec3 skyC = lvL(0.34, 0.45, 0.56) * (0.35 + 0.65 * lvU(lvH(ph, 3u)));
      vec3 gl = mix(gc, skyC, sky * (0.25 + 0.4 * pr)); float gr = 0.06; vec3 emi = vec3(0.0);
      if (stt == 1){                                         // curtain
        float ct = lvU(lvH(hbv, 81u)); vec3 cc = ct < 0.4 ? lvL(0.78, 0.74, 0.66) : (ct < 0.7 ? lvL(0.62, 0.5, 0.42) : (ct < 0.88 ? lvL(0.55, 0.62, 0.7) : lvL(0.7, 0.45, 0.45)));
        gl = cc * (0.55 + 0.25 * sin(q.x * 38.0 + pr * 3.0)); gr = 0.85;
      } else if (stt == 2){                                  // roller blind drawn part way
        float drop = 0.3 + 0.6 * lvU(lvH(hbv, 82u));
        float bl = smoothstep(-0.02, 0.02, uy - (1.0 - drop)); gl = mix(gl, lvL(0.8, 0.77, 0.68) * 0.7, bl); gr = mix(0.06, 0.8, bl);
      } else if (stt == 3){ gl = mix(gc, lvL(0.9, 0.62, 0.3) * 0.5, 0.75); emi = lvL(0.95, 0.6, 0.28) * uBwOpt.y; gr = 0.2; }
      else if (stt == 4){ gl = gc * 0.35; gr = 0.25; }
      else if (stt == 5){ gl = skyC * (0.9 + 0.3 * sky) * 0.9; }
      vec3 wood = frameC * (0.95 + 0.1 * pr);
      col = mix(col, mix(gl, wood, fr), mOpen); rough = mix(rough, mix(gr, 0.55, fr), mOpen);
      h = mix(h, depth + fr * 0.045, mOpen); ao = mix(ao, mix(0.85, 0.95, fr) * mix(0.62, 1.0, smoothstep(0.0, 0.2, -d)), mOpen);
      em = mix(em, emi, mOpen * (1.0 - fr)); flatN = max(flatN, mOpen);
    }
  }
  // shutters, open (a leaf each side of the opening) or closed (over it)
  if (lvU(lvH(hbv, 91u)) < T3.x && shape != 4){
    float closed = step(lvU(lvH(hbv, 92u)), 0.25);
    float ws = min(a, bayW * 0.5 - (a + sw + 0.07));
    float zy = step(-0.03, q.y) * step(q.y, hh + 0.03);
    float leafL = step(a + sw + 0.03, abs(q.x)) * step(abs(q.x), a + sw + 0.03 + ws) * zy * step(0.14, ws);
    float over = step(abs(q.x), a + 0.03) * zy * mOpen;
    float sm = mix(leafL, max(over, 0.0), closed);
    float slat = 1.0 - smoothstep(0.004, 0.004 + aa, abs(fract(q.y / 0.04) - 0.5) * 0.04 - 0.008);
    float split = closed * (1.0 - smoothstep(0.004, 0.006 + aa, abs(q.x)));
    vec3 sc = shutC * (1.0 - 0.28 * slat - 0.4 * split);
    flatN = max(flatN, sm * 0.7); col = mix(col, sc, sm); h = mix(h, 0.03 - slat * 0.006, sm); rough = mix(rough, 0.7, sm); ao = mix(ao, 0.9 - 0.2 * slat, sm); em = mix(em, vec3(0.0), sm);
  }
}

void slLiveApply(inout vec4 samp, inout vec4 orm, vec3 tint, vec3 pos, vec3 a, bool near){
  float kind = uSlLive.x;
  uint bid;
  if (tint.r == 1.0 && tint.g == 1.0 && tint.b == 1.0) bid = lvH(lvI(pos.x / 24.0), lvI(pos.z / 24.0));         // untinted walls: a block of town is "a building"
  else bid = uint(int(tint.r * 255.0 + 0.5)) | (uint(int(tint.g * 255.0 + 0.5)) << 8u) | (uint(int(tint.b * 255.0 + 0.5)) << 16u);
  float x, y, base = -1.0;
  if (near){
    vec3 n = normalize(a); vec2 t = vec2(-n.z, n.x);
    if (abs(n.y) > 0.7){ x = pos.x; y = pos.z; } else { x = dot(pos.xz, t); y = pos.y; }
  } else { x = a.x; y = a.y; base = y; }
  float aa = max(fwidth(x), fwidth(y)) * 0.8;
  float warp = (dot(samp.rgb, vec3(0.3333)) - 1.0) * 0.004;
  vec3 col; float h, ao, rough;
  if (kind < 0.5) lvRender(x, y, bid, aa, col, h, ao, rough);
  else lvMasonry(x, y, bid, kind, aa, warp, col, h, ao, rough);
  lvWeather(col, h, ao, x, y, base, bid, kind, aa);
  vec3 wall = col;
  vec3 fin = col * tint * samp.rgb;                 // the wall: its own colour, the building's tint, the baked detail
  vec3 em = vec3(0.0); float flatN = 0.0;
  if (!near){
    float sh = 3.2, bw = 3.0;
    float stor = floor(y / sh), ys = y - stor * sh, bay = floor(x / bw), xc = x - (bay + 0.5) * bw;
    uint su = lvI(stor), bu = lvI(bay);
    // window: drawn on the lit colour, the dressing in absolute colours
    vec3 abs0 = fin; float h0 = h, ao0 = ao, r0 = rough;
    lvWindow(vec2(xc, ys), bw, bid, bu, su, aa, wall * tint, abs0, h0, ao0, r0, em, flatN);
    // string course at the floor line, with the shadow it throws
    if (lvU(lvH(bid, 51u)) > 0.3){
      float band = smoothstep(2.99 - aa, 3.02 + aa, ys) * 1.0;
      vec3 trimC = uBwTr[int(lvU(lvH(bid, 64u)) * uBwN.y)] * (0.93 + 0.1 * lvU(lvH(bid, 66u)));
      abs0 = mix(abs0, trimC, band); h0 = mix(h0, 0.035 + smoothstep(3.14, 3.17, ys) * 0.0, band); r0 = mix(r0, 0.8, band);
      ao0 *= 1.0 - 0.45 * smoothstep(2.74, 3.0, ys) * (1.0 - band); flatN = max(flatN, band * 0.8);
    }
    fin = abs0; h = h0; ao = ao0; rough = r0;
  }
  samp.rgb = fin / max(tint, vec3(0.04)); samp.a = 1.0;
  orm.r *= ao; orm.g = clamp(rough + (orm.g - 0.9) * 0.5, 0.05, 1.0);
  slLiveH = h; slLiveEm = em; slLiveFlat = flatN;
}
`;

// ---- the style table to uniforms -------------------------------------------------------------------------------------
const U = {
  uBwT: { value: new Float32Array(MAXT * 16) },
  uBwCdf: { value: new Float32Array(MAXT * 3) },
  uBwSt: { value: new Float32Array(6) },
  uBwOpt: { value: [0.12, 0.35, 1, 0] },
  uBwN: { value: [1, 1, 1, 1] },
  uBwF: { value: new Float32Array(24) }, uBwTr: { value: new Float32Array(24) }, uBwSh: { value: new Float32Array(24) }, uBwG: { value: new Float32Array(12) },
};
// uniform vec4 / vec3 / vec4[] values are given as flat arrays; vec4 and vec3 singles are converted when the uniforms are first set
LIVE.decl = LIVE_GLSL;
LIVE.uniforms = U;

/**
 * Hand the style's window table and colour lists to the wall shader. Called when a scene's style is known (level loader);
 * the materials already built pick the new values up on their next draw.
 */
export function setBayStyle(style) {
  const bw = (style && style.bayWindows) || {}, c = compileWindows(bw);
  U.uBwT.value.set(c.types); U.uBwCdf.value.set(c.cdf); U.uBwSt.value.set(c.states);
  const pal = (list, n, key, fb) => { const r = paletteRows(list, parseColor, n, fb); U[key].value.set(r.rows); return r.count; };
  const nf = pal(style && style.frames, 8, 'uBwF', [0.85, 0.83, 0.78]), nt = pal(style && style.trim, 8, 'uBwTr', [0.8, 0.78, 0.7]);
  const ns = pal(bw.shutterColors || (style && style.doors), 8, 'uBwSh', [0.2, 0.3, 0.25]), ng = pal(bw.glass, 4, 'uBwG', [0.012, 0.02, 0.026]);
  U.uBwN.value = [nf, nt, ns, ng]; U.uBwOpt.value = [c.odd, 0.35, 1, 0];
  return c;
}

// ---- sets and materials ---------------------------------------------------------------------------------------------
Object.assign(SETS, {
  wd_render: { fn: 'walldetail', size: 1, tile: [3.0, 3.2], bump: 3, p: [0] },
  wd_masonry: { fn: 'walldetail', size: 1, tile: [3.0, 3.2], bump: 3, p: [1], seed: 3 },
});
const WET = [0.3, 0.25, 0.5, 0], MACRO = [0.12, 0.08, 0.4, 0.3];
const kinds = { stucco: ['wd_render', 0], stone: ['wd_masonry', 1], rubble: ['wd_masonry', 2], brick: ['wd_masonry', 3] };
for (const [k, [set, kind]] of Object.entries(kinds)) {
  // the far façade (windows in the material) and the near wall (triplanar) are one material per kind, two programs
  MATERIALS['facade_' + k] = MATERIALS['wall_' + k] = def(set, { live: kind, wet: k === 'stucco' ? [0.2, 0.2, 0.5, 0] : WET, macro: MACRO });
}
setBayStyle(null);
