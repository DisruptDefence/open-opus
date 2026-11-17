// The things set into a modelled façade (gen/facade.js, near group): a window, a door and an awning cloth. Same form as
// outdoor.js: a GLSL `surf(uv)` calling `emit(colour, alpha, height, ao, roughness, metalness)`; the vertex tint colours the
// white parts (frame, door leaf, cloth), the dark parts stay dark.
//
//   window  a sheet of eight panels side by side (uv u = panel + 0..1) and four rows (uv v = (row + 0..1) / 4, v up: row 0 a dark
//           room, 1 curtains drawn back, 2 a blind lowered 55 %, 3 a lit room; facade.js picks the row per window): 0 casement pair, 1 shop pane with a transom, 2 sash 2 over 2,
//           3 sash 6 over 6, 4 sash 1 over 1, 5 french doors, 6 a single pane (a roundel). gen/facade.js GLAZE_PANEL names them.
//   door    a panelled leaf, the top pair of panels glazed.
//   tarp    vertical stripes of cloth, alternating white and a half tone, for tinting.
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def } from './materials.js';

GENERATORS.window = `
float bar1(float v, float c, float w){ return smoothstep(w * 2.0, w, abs(v - c)); }
// what is behind the glass, by row: 0 a dark room, 1 curtains drawn back, 2 a blind lowered 55 %, 3 a lit room (warm, not emissive)
vec3 behind(float row, vec2 q, float panel, float fine){
  vec3 room = mix(L(0.055, 0.060, 0.065), L(0.10, 0.11, 0.12), smoothstep(0.0, 1.0, q.y) * 0.6);
  float h = fract(sin(panel * 12.9898) * 43758.5);
  if (row < 0.5) return room;
  if (row < 1.5) {                                                                // curtains: folds at both sides, sheer between
    float cw = 0.2 + 0.05 * h, edge = min(q.x, 1.0 - q.x);
    float cur = 1.0 - smoothstep(cw - 0.03, cw + 0.03, edge);
    float fold = 0.5 + 0.5 * sin(q.x * 70.0 + h * 6.0);
    vec3 cloth = mix(L(0.66, 0.60, 0.50), L(0.86, 0.80, 0.68), h) * (0.62 + 0.38 * fold) * (0.9 + 0.2 * fine);
    vec3 sheer = mix(room, L(0.62, 0.62, 0.60), 0.32 * smoothstep(0.1, 0.9, q.y));
    vec3 c = mix(sheer, cloth, cur);
    return mix(c, L(0.45, 0.40, 0.33), smoothstep(0.93, 0.97, q.y));              // the rail
  }
  if (row < 2.5) {                                                                // blind or lace, lowered to 55 % of the pane
    float drop = 0.45, inB = smoothstep(drop - 0.012, drop, q.y);
    float weave = 0.5 + 0.5 * sin(q.y * 220.0), lace = 0.5 + 0.5 * sin(q.x * 90.0) * sin(q.y * 70.0);
    vec3 cloth = mix(L(0.74, 0.70, 0.60), L(0.88, 0.85, 0.76), h) * (0.86 + 0.1 * weave + 0.06 * lace);
    float hem = smoothstep(0.02, 0.0, abs(q.y - drop - 0.012));
    return mix(room, cloth * (1.0 - hem * 0.3), inB);
  }
  float lamp = exp(-pow(length((q - vec2(0.5, 0.9)) * vec2(1.0, 1.7)) * 3.2, 2.0));   // a ceiling lamp, wall and ceiling line
  vec3 wall = mix(L(0.34, 0.22, 0.12), L(0.46, 0.33, 0.19), q.y) * (0.9 + 0.2 * h);
  wall = mix(wall, wall * 0.62, smoothstep(0.82, 0.86, q.y));
  wall = mix(wall, L(0.20, 0.13, 0.08), smoothstep(0.18, 0.05, q.y) * 0.8);
  float pic = step(abs(q.x - (0.25 + 0.5 * h)), 0.09) * step(abs(q.y - 0.55), 0.12);
  wall = mix(wall, L(0.24, 0.30, 0.28), pic * 0.7);
  return wall + L(0.55, 0.38, 0.16) * lamp * 0.9;
}
// what the glass reflects by day: a sky that is brighter and bluer towards the top, and a broken dark band of the houses opposite in the
// lower third; every small pane tilts a little (old glass), so the band steps from pane to pane. Returns rgb in .rgb, the share of
// the reflection that covers the room in .a (less over a lit or curtained room).
vec4 reflection(float row, vec2 q, float panel, float fine){
  vec2 grid = panel < 0.5 ? vec2(2.0, 4.0) : (panel < 1.5 ? vec2(1.0, 1.0) : (panel < 2.5 ? vec2(2.0, 2.0) : (panel < 3.5 ? vec2(3.0, 4.0) : (panel < 4.5 ? vec2(1.0, 2.0) : (panel < 5.5 ? vec2(2.0, 4.0) : vec2(1.0, 1.0))))));
  vec2 pc = floor(q * grid), pq = fract(q * grid);
  float ph = fract(sin(dot(pc + panel * 7.0 + row * 3.0, vec2(12.9898, 78.233))) * 43758.5453);
  float tilt = (ph - 0.5) * 0.10 + (pq.x - 0.5) * (ph - 0.5) * 0.08;         // the pane's own tilt: the horizon moves, and slopes a little inside it
  float hc = fract(sin(floor(q.x * 3.0 + panel * 1.7 + row * 2.3) * 43.17) * 9731.3);            // the houses opposite: flat roofs of different heights
  float roof = 0.24 + 0.16 * hc + tilt;
  float band = smoothstep(roof + 0.012, roof - 0.012, q.y);                    // 1 below the roofline of the houses opposite
  float gaps = smoothstep(0.55, 0.7, fbm(vec2(q.x * 5.0 + ph * 4.0, q.y * 2.0), vec2(5.0, 2.0), 3, 132.0));
  vec3 sky = mix(L(0.60, 0.64, 0.68), L(0.38, 0.47, 0.60), smoothstep(0.35, 1.0, q.y + tilt * 0.5));
  vec3 houses = L(0.17, 0.15, 0.14) * (0.8 + 0.4 * fine) * (1.0 - 0.45 * gaps);
  vec3 c = mix(sky, houses, band);
  float k = row < 0.5 ? 0.55 : (row < 1.5 ? 0.42 : (row < 2.5 ? 0.34 : 0.26));
  return vec4(c, k * (0.85 + 0.3 * ph));
}
// a shop window: a low platform, goods in the lower 60 % in three cells across (bottles, boxes, hanging things, a lamp), a dark ceiling,
// the transom band and the signboard zone above clean. variant 0 = column 1, variant 1 = column 7 (more hanging goods, cloth bolts).
float rbox(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p - c) - h; return 1.0 - smoothstep(0.0, 0.006, max(d.x, d.y)); }
float rdisc(vec2 p, vec2 c, float r){ return 1.0 - smoothstep(r - 0.006, r, length((p - c) * vec2(1.0, 2.75))); }
vec3 shopDisplay(vec2 q, float variant, float fine){
  float cells = 3.0, id = floor(q.x * cells), h = fract(sin((id + 1.0 + variant * 7.0) * 78.233) * 43758.5453);
  vec2 p = vec2(fract(q.x * cells), q.y);
  vec3 wall = mix(L(0.46, 0.32, 0.19), L(0.13, 0.095, 0.07), smoothstep(0.1, 0.85, q.y));   // the back of the shop, darker towards the ceiling
  vec3 col = wall * (0.85 + 0.3 * fine);
  float kind = floor(fract(h + variant * 0.37) * 4.0);
  vec3 goods = vec3(0.0); float cover = 0.0;
  if (kind < 0.5) {                                                                        // bottles in a row
    for (int i = 0; i < 3; i++) { float x = 0.2 + 0.3 * float(i), ht = 0.2 + 0.1 * fract(h * (3.0 + float(i)));
      float b = rbox(p, vec2(x, 0.10 + ht * 0.5), vec2(0.075, ht * 0.5)) + rbox(p, vec2(x, 0.10 + ht + 0.045), vec2(0.028, 0.06));
      vec3 c = i == 1 ? L(0.55, 0.36, 0.14) : L(0.22, 0.38, 0.22); goods = mix(goods, c * (0.7 + 0.5 * p.y), min(b, 1.0)); cover = max(cover, min(b, 1.0)); }
  } else if (kind < 1.5) {                                                                 // boxes and crates, stacked
    float b1 = rbox(p, vec2(0.30, 0.17), vec2(0.22, 0.07)), b2 = rbox(p, vec2(0.34, 0.31), vec2(0.16, 0.07)), b3 = rbox(p, vec2(0.78, 0.2), vec2(0.14, 0.10));
    goods = L(0.48, 0.33, 0.20) * b1 + L(0.60, 0.50, 0.34) * b2 + L(0.38, 0.28, 0.2) * b3; cover = max(b1, max(b2, b3));
    goods /= max(cover, 0.001);
  } else if (kind < 2.5) {                                                                 // lanterns, pans and hams hanging from the transom
    for (int i = 0; i < 3; i++) { float x = 0.18 + 0.32 * float(i), l = 0.56 + 0.08 * fract(h * (5.0 + float(i)));
      float cord = rbox(p, vec2(x, (l + 0.8) * 0.5), vec2(0.004, (0.8 - l) * 0.5)), it = rdisc(p, vec2(x, l - 0.02), 0.11);
      goods = mix(goods, i == 1 ? L(0.60, 0.22, 0.15) : L(0.66, 0.52, 0.30), min(it + cord * 0.5, 1.0)); cover = max(cover, min(it + cord * 0.5, 1.0)); }
  } else {                                                                                 // a lamp on a stand with its glow
    float stem = rbox(p, vec2(0.5, 0.3), vec2(0.012, 0.2)), base = rbox(p, vec2(0.5, 0.11), vec2(0.09, 0.02)), shade = rdisc(p, vec2(0.5, 0.56), 0.12);
    float glow = exp(-pow(length((p - vec2(0.5, 0.55)) * vec2(1.0, 0.7)) * 3.2, 2.0));
    goods = L(0.55, 0.45, 0.25) * max(stem, base) + L(0.92, 0.72, 0.4) * shade; cover = max(max(stem, base), shade);
    goods /= max(cover, 0.001); col += L(0.45, 0.30, 0.12) * glow * 0.7;
  }
  if (variant > 0.5 && kind > 0.5 && kind < 1.5) { float bolt = rbox(p, vec2(0.62, 0.16), vec2(0.06, 0.06)); goods = mix(goods, L(0.5, 0.2, 0.2), bolt); cover = max(cover, bolt); }
  float inZone = step(0.1, q.y) * step(q.y, 0.62);
  col = mix(col, goods * 1.5, cover * inZone);
  float plat = smoothstep(0.1, 0.095, q.y);                                              // the low platform
  col = mix(col, L(0.40, 0.27, 0.15) * (0.85 + 0.3 * fine) * (1.0 - 0.3 * smoothstep(0.06, 0.0, q.y)), plat);
  col = mix(col, col * 0.9, smoothstep(0.62, 0.8, q.y));
  return col * (q.y > 0.9 ? 0.55 : 1.0);                                                   // the signboard zone stays dark and plain
}
void surf(vec2 uv){
  float fine = fbm(uv, vec2(120.0), 3, 101.0), mid = fbm(uv, vec2(6.0), 3, 102.0);
  float panel = floor(uv.x * 8.0), row = min(floor(uv.y * 4.0), 3.0);
  vec2 q = vec2(fract(uv.x * 8.0), fract(uv.y * 4.0));
  bool shop = (panel > 0.5 && panel < 1.5) || panel > 6.5;                      // columns 1 and 7: a shop pane over the whole height of its column
  if (shop) { row = 0.0; q.y = uv.y; }
  float bx = shop ? 0.035 : 0.035, by = shop ? 0.035 : 0.02;   // the outer frame is modelled (gen/facade.js); this strip only guards the panel edge
  float frameD = min(min(q.x, 1.0 - q.x) / bx, min(q.y, 1.0 - q.y) / by);
  float isFrame = 1.0 - smoothstep(0.9, 1.0, frameD);
  float bar = 0.0;
  if (panel < 0.5) {                                                           // casement pair, 4 rows
    bar = max(bar1(q.x, 0.5, 0.008), bar1(abs(fract(q.y * 4.0) - 0.5) * 0.25 + 0.0, 0.125, 0.004) * step(0.05, q.y) * step(q.y, 0.95));
  } else if (shop) { bar = bar1(q.y, 0.8, 0.007);
  } else if (panel < 2.5) {                                                    // sash 2 over 2
    bar = max(bar1(q.y, 0.5, 0.014), bar1(q.x, 0.5, 0.008));
  } else if (panel < 3.5) {                                                    // sash 6 over 6
    bar = max(bar1(q.y, 0.5, 0.014), max(bar1(q.x, 0.333, 0.007), bar1(q.x, 0.667, 0.007)));
    bar = max(bar, max(bar1(q.y, 0.25, 0.006), bar1(q.y, 0.75, 0.006)));
  } else if (panel < 4.5) { bar = bar1(q.y, 0.5, 0.014);                       // sash 1 over 1
  } else if (panel < 5.5) {                                                    // french doors: two leaves, a kick panel
    bar = max(bar1(q.x, 0.5, 0.01), bar1(q.y, 0.28, 0.012));
    bar = max(bar, bar1(abs(fract(q.y * 5.0) - 0.5) * 0.4, 0.1, 0.004) * step(0.3, q.y) * step(q.y, 0.95));
    bar = max(bar, step(q.y, 0.28));
  }
  float solid = max(isFrame, bar);
  float sky = smoothstep(0.0, 1.0, q.y);
  float refl = fbm(q * vec2(1.0, 2.0), vec2(3.0, 5.0), 3, 103.0);
  vec4 rf = reflection(row, q, panel, fine);
  vec3 glass = mix(behind(row, q, panel, fine), rf.rgb, min(0.8, rf.a));
  if (shop) { vec4 sr = reflection(0.0, q, 1.0, fine); glass = mix(shopDisplay(q, panel > 6.5 ? 1.0 : 0.0, fine), sr.rgb, 0.30 * (0.6 + 0.8 * smoothstep(0.55, 1.0, q.y))); }   // the display, the sky and the houses opposite over it
  vec3 paint = L(0.88, 0.87, 0.84) * (0.9 + 0.2 * fine);
  vec3 col = mix(glass, paint, max(bar, shop ? isFrame : 0.0));
  col = mix(col, glass * 0.45, isFrame * (shop ? 0.0 : 1.0));
  float inner = smoothstep(0.0, 0.12, frameD) * (1.0 - isFrame);
  col *= 1.0 - (1.0 - inner) * (1.0 - solid) * 0.35;                              // the shadow of the frame on the glass
  emit(col, 1.0, mix(0.1, 0.5 + 0.1 * mid, solid), mix(0.6, 1.0, solid), mix(0.05 + 0.03 * fine, 0.55, solid), 0.0);   // glass 0.04 .. 0.08, paint 0.55
}`;
GENERATORS.door = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(120.0), 3, 111.0);
  vec2 g = vec2(uv.x * 2.0, uv.y * 3.0); vec2 f = fract(g);
  float edge = min(uv.x, 1.0 - uv.x);
  float panel = smoothstep(0.1, 0.16, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y))) * step(0.06, edge) * step(0.04, uv.y) * step(uv.y, 0.98);
  float glazed = panel * step(0.667, uv.y);
  vec3 wood = L(0.86, 0.85, 0.82) * (0.88 + 0.2 * fine);
  vec3 col = mix(wood, wood * 0.82, panel);
  vec3 gl = mix(L(0.05, 0.055, 0.06), L(0.26, 0.31, 0.36), uv.y);
  col = mix(col, gl, glazed);
  float knob = smoothstep(0.03, 0.02, length(uv - vec2(0.85, 0.5)));
  col = mix(col, L(0.5, 0.42, 0.2), knob);
  emit(col, 1.0, 0.5 + panel * -0.15 + knob * 0.4, 1.0 - panel * 0.3, mix(0.6, 0.1, glazed), knob * 0.8);
}`;
GENERATORS.tarp = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(150.0), 3, 121.0);
  float stripe = step(0.5, fract(uv.x * 0.5));
  vec3 col = mix(L(0.92, 0.91, 0.88), L(0.45, 0.45, 0.45), stripe) * (0.9 + 0.2 * fine);
  float fold = smoothstep(0.0, 0.03, abs(fract(uv.x * 0.5 * 2.0) - 0.5) - 0.46);
  emit(col, 1.0, 0.5 + fine * 0.1 + fold * 0.1, 1.0, 0.85, 0.0);
}`;
Object.assign(SETS, {
  window: { fn: 'window', size: 1, tile: [8, 4], bump: 3 },
  door: { fn: 'door', size: 0.5, tile: [1, 1], bump: 3 },
  tarp: { fn: 'tarp', size: 0.5, tile: [2, 1], bump: 1 },
});
Object.assign(MATERIALS, {
  window: def('window', { wet: [0.05, 0.1, 0.5, 0], macro: [0, 0, 0.3, 0] }),
  door: def('door', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
  tarp: def('tarp', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
});
