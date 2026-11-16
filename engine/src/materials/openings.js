// The things set into a modelled façade (gen/facade.js, near group): a window, a door and an awning cloth. Same form as
// outdoor.js: a GLSL `surf(uv)` calling `emit(colour, alpha, height, ao, roughness, metalness)`; the vertex tint colours the
// white parts (frame, door leaf, cloth), the dark parts stay dark.
//
//   window  uv 0..1 of the texture = [0, 0.5] a casement (two leaves, glazing bars) and [0.5, 1] one large shop pane
//           with a transom; the generator writes uv 0..1 (casement) or 1..2 (shop pane) over a set 2 m wide.
//   door    a panelled leaf, the top pair of panels glazed.
//   tarp    vertical stripes of cloth, alternating white and a half tone, for tinting.
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def } from './materials.js';

GENERATORS.window = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(120.0), 3, 101.0), mid = fbm(uv, vec2(6.0), 3, 102.0);
  bool shop = uv.x > 0.5;
  vec2 q = shop ? vec2((uv.x - 0.5) * 2.0, uv.y) : vec2(uv.x * 2.0, uv.y);
  float bx = shop ? 0.035 : 0.07, by = shop ? 0.035 : 0.045;
  float frameD = min(min(q.x, 1.0 - q.x) / bx, min(q.y, 1.0 - q.y) / by);
  float isFrame = 1.0 - smoothstep(0.9, 1.0, frameD);
  float bar = 0.0;
  if (shop) bar = smoothstep(0.014, 0.007, abs(q.y - 0.8));                    // transom
  else {
    bar = smoothstep(0.016, 0.008, abs(q.x - 0.5));                           // meeting stile
    float fy = abs(fract(q.y * 4.0) - 0.5) * 2.0;                             // 1 at a muntin
    bar = max(bar, smoothstep(0.94, 0.97, fy) * step(0.05, q.y) * step(q.y, 0.95));
  }
  float solid = max(isFrame, bar);
  float sky = smoothstep(0.0, 1.0, q.y);
  float refl = fbm(q * vec2(1.0, 2.0), vec2(3.0, 5.0), 3, 103.0);
  vec3 glass = mix(L(0.030, 0.040, 0.055), L(0.16, 0.21, 0.27), sky * 0.7 + refl * 0.5);
  float curtain = smoothstep(0.62, 0.7, fbm(q, vec2(2.0, 1.0), 3, 104.0)) * (shop ? 0.0 : 0.6) * step(q.y, 0.55);
  glass = mix(glass, L(0.30, 0.26, 0.20), curtain * 0.5);
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
  vec3 gl = mix(L(0.02, 0.03, 0.04), L(0.10, 0.13, 0.17), uv.y);
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
  window: { fn: 'window', size: 1, tile: [2, 1], bump: 3 },
  door: { fn: 'door', size: 0.5, tile: [1, 1], bump: 3 },
  tarp: { fn: 'tarp', size: 0.5, tile: [2, 1], bump: 1 },
});
Object.assign(MATERIALS, {
  window: def('window', { wet: [0.05, 0.1, 0.5, 0], macro: [0, 0, 0.3, 0] }),
  door: def('door', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
  tarp: def('tarp', { wet: [0.2, 0.3, 0.5, 0], macro: [0.1, 0.1, 0.3, 0.2] }),
});
