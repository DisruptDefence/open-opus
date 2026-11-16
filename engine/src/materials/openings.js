// The things set into a modelled façade (gen/facade.js, near group): a window, a door and an awning cloth. Same form as
// outdoor.js: a GLSL `surf(uv)` calling `emit(colour, alpha, height, ao, roughness, metalness)`; the vertex tint colours the
// white parts (frame, door leaf, cloth), the dark parts stay dark.
//
//   window  a sheet of eight panels side by side (uv u = panel + 0..1): 0 casement pair, 1 shop pane with a transom, 2 sash 2 over 2,
//           3 sash 6 over 6, 4 sash 1 over 1, 5 french doors, 6 a single pane (a roundel). gen/facade.js GLAZE_PANEL names them.
//   door    a panelled leaf, the top pair of panels glazed.
//   tarp    vertical stripes of cloth, alternating white and a half tone, for tinting.
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def } from './materials.js';

GENERATORS.window = `
float bar1(float v, float c, float w){ return smoothstep(w * 2.0, w, abs(v - c)); }
void surf(vec2 uv){
  float fine = fbm(uv, vec2(120.0), 3, 101.0), mid = fbm(uv, vec2(6.0), 3, 102.0);
  float panel = floor(uv.x * 8.0);
  vec2 q = vec2(fract(uv.x * 8.0), uv.y);
  bool shop = panel > 0.5 && panel < 1.5;
  float bx = shop ? 0.035 : (panel > 1.5 && panel < 4.5 ? 0.075 : 0.07), by = shop ? 0.035 : 0.045;
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
  vec3 glass = mix(L(0.055, 0.060, 0.065), L(0.34, 0.40, 0.46), sky * 0.75 + refl * 0.4);
  if (shop) glass = mix(L(0.30, 0.22, 0.13), L(0.30, 0.36, 0.42), smoothstep(0.1, 0.8, q.y) * 0.8 + refl * 0.3);   // a lit shop behind the pane
  float curtain = smoothstep(0.62, 0.7, fbm(q, vec2(2.0, 1.0), 3, 104.0)) * (shop ? 0.0 : 0.6) * step(q.y, 0.55);
  glass = mix(glass, L(0.62, 0.58, 0.50), curtain * 0.7);
  vec3 paint = L(0.88, 0.87, 0.84) * (0.9 + 0.2 * fine);
  vec3 col = mix(glass, paint, solid);
  float inner = smoothstep(0.0, 0.12, frameD) * (1.0 - isFrame);
  col *= 1.0 - (1.0 - inner) * (1.0 - solid) * 0.35;                              // the shadow of the frame on the glass
  emit(col, 1.0, mix(0.1, 0.5 + 0.1 * mid, solid), mix(0.6, 1.0, solid), mix(0.06, 0.55, solid), 0.0);
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
  window: { fn: 'window', size: 1, tile: [8, 1], bump: 3 },
  door: { fn: 'door', size: 0.5, tile: [1, 1], bump: 3 },
  tarp: { fn: 'tarp', size: 0.5, tile: [2, 1], bump: 1 },
});
Object.assign(MATERIALS, {
  window: def('window', { wet: [0.05, 0.1, 0.5, 0], macro: [0, 0, 0.3, 0] }),
  door: def('door', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
  tarp: def('tarp', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
});
