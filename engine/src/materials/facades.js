// Façade bays, second pass. materials/outdoor.js drew a bay as a flat wall with a painted window; the street views are
// almost all this texture (the far façade, windows in the material), so its quality is the quality of the town.
//
// What changed, in the library's own method (a GLSL `surf(uv)` that calls `emit(colour, alpha, height, ao, roughness,
// metalness)`, drawn once on the GPU into albedo / ORM / normal; the lifted materials work the same way and carry their
// realism in the height and ambient-occlusion channels, which is where this pass spends its effort):
//   masonry   courses of different block counts, per-block tone and hue, a lime mortar joint recessed 5 mm (not a black
//             line), an arris on every block that catches the light, chipped corners, pits, and rain streaks
//   brick     real size (230 x 76 mm, 13 to a bay), running bond with a header course every sixth, burnt and pale bricks
//   stucco    trowel waves, hairline cracks, and patches where the render has fallen away to the masonry under it
//   window    a recessed opening with a reveal shadow, a six-over-six sash (muntins, meeting rail), panes that reflect
//             sky or stay dark or hold a curtain, a projecting sill with a drip stain, a dressed lintel and surround
//   storey    a string course at every floor line with the shadow it casts
//
// One bay is 3.0 m wide by 3.2 m high, as before (gen/facade.js: u counts bays, v counts storeys), so what is painted and
// what is modelled still line up. Importing this module (after outdoor.js, which it imports itself) replaces the
// `facade` generator and the facade sets; nothing else changes.
import './outdoor.js';
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS, Nt as def } from './materials.js';

/** The bay's size in metres; window geometry in the shader is written against it. */
export const BAY = { width: 3.0, height: 3.2, window: [1.11, 1.7], sillAt: 0.75 };

export const BAY_SHADER = `
// ---- walls: each returns albedo (linear), height, roughness, ambient occlusion ----
void brickWall(vec2 uv, out vec3 col, out float h, out float r, out float ao){
  const float rows = 42.0;
  float row = floor(uv.y * rows);
  bool header = mod(row, 6.0) > 4.5;                                    // a header course: bricks end on
  float cols = header ? 26.0 : 13.0;
  float x = uv.x * cols + (header ? 0.0 : 0.5 * mod(row, 2.0));
  vec2 f = vec2(fract(x), fract(uv.y * rows));
  vec3 q = h3(vec2(mod(floor(x), cols), row), vec2(26.0, rows), 91.0);
  float bw = 3.0 / cols, bh = 3.2 / rows;
  float de = min(min(f.x, 1.0 - f.x) * bw, min(f.y, 1.0 - f.y) * bh) + (fbm(uv, vec2(110.0), 3, 92.0) - 0.5) * 0.003;
  float brick = smoothstep(0.0035, 0.0065, de);
  float fine = fbm(uv, vec2(200.0), 3, 93.0), mid = fbm(uv, vec2(30.0), 4, 94.0), big = fbm(uv, vec2(3.0), 4, 95.0);
  vec3 c = mix(L(0.52, 0.25, 0.18), L(0.44, 0.21, 0.15), q.x);
  c = mix(c, L(0.60, 0.33, 0.21), smoothstep(0.55, 1.0, q.y) * 0.8);   // orange
  c = mix(c, L(0.25, 0.14, 0.12), smoothstep(0.86, 1.0, q.z) * 0.9);   // burnt
  c = mix(c, L(0.58, 0.42, 0.30), step(0.97, q.y) * 0.8);              // pale
  if (header) c = mix(c, L(0.27, 0.17, 0.15), 0.35);                   // vitrified headers
  c *= (0.84 + 0.3 * mid) * (0.9 + 0.2 * fine) * (0.9 + 0.16 * big);
  float pit = smoothstep(0.7, 0.8, fbm(uv, vec2(120.0), 3, 96.0)); c *= 1.0 - pit * 0.3;
  float soot = smoothstep(0.5, 0.8, fbm(uv, vec2(3.0), 4, 97.0));
  float ef = smoothstep(0.72, 0.86, fbm(uv, vec2(6.0), 4, 98.0)) * brick;
  c = mix(c, L(0.70, 0.67, 0.62), ef * 0.28);
  vec3 mortar = L(0.60, 0.57, 0.52) * (0.75 + 0.45 * fine);
  col = mix(mortar, c, brick) * (1.0 - soot * 0.3);
  float face = 0.58 + (q.x - 0.5) * 0.12 + (mid - 0.5) * 0.12 + (fine - 0.5) * 0.08 - pit * 0.16;
  h = mix(0.25 + fine * 0.06, face + 0.05 * smoothstep(0.0, 0.012, de), brick);
  r = mix(0.97, 0.88 + (mid - 0.5) * 0.12, brick);
  ao = mix(0.55, 1.0, brick * smoothstep(0.0, 0.01, de)) * (1.0 - pit * 0.25);
}

void stuccoWall(vec2 uv, out vec3 col, out float h, out float r, out float ao){
  float fine = fbm(uv, vec2(180.0), 3, 61.0), mid = fbm(uv, vec2(22.0), 4, 62.0), big = fbm(uv, vec2(2.0), 4, 63.0);
  float streak = fbm(uv * vec2(24.0, 1.0), vec2(24.0, 2.0), 4, 64.0);
  float wave = fbm(uv, vec2(9.0, 6.0), 3, 65.0);
  col = L(0.80, 0.77, 0.70) * (0.88 + 0.16 * mid) * (0.92 + 0.14 * big);
  col *= 1.0 - smoothstep(0.5, 0.85, streak) * 0.2 * (0.4 + big);
  float crack = smoothstep(0.011, 0.003, abs(fbm(uv + 0.2, vec2(3.0), 4, 66.0) - 0.5)) * smoothstep(0.45, 0.65, big);
  h = 0.52 + fine * 0.16 + wave * 0.14 - crack * 0.25;
  r = 0.92; ao = 1.0 - crack * 0.5;
  col = mix(col, L(0.30, 0.28, 0.25), crack * 0.7);
  // render fallen away: the wall under it shows (brick), with a raised, lighter edge to the patch
  float loss = smoothstep(0.80, 0.84, fbm(uv, vec2(3.0), 4, 67.0) * 0.6 + fbm(uv, vec2(14.0), 3, 68.0) * 0.4 + (big - 0.5) * 0.12) * smoothstep(0.52, 0.62, fbm(uv, vec2(5.0), 3, 69.0));
  float rim = smoothstep(0.0, 0.05, loss) * (1.0 - smoothstep(0.05, 0.2, loss));
  if (loss > 0.0) {
    vec3 bc; float bh, br, bao; brickWall(uv, bc, bh, br, bao);
    col = mix(col, mix(bc, col, 0.45) * 0.95, loss); h = mix(h, bh - 0.12, loss); r = mix(r, br, loss); ao = mix(ao, bao * 0.8, loss);
  }
  col = mix(col, col * 1.08, rim * 0.5); h += rim * 0.1;
}

void stoneWall(vec2 uv, float warm, out vec3 col, out float h, out float r, out float ao){
  const float rows = 8.0;
  float row = floor(uv.y * rows);
  vec3 rr = h3(vec2(row, 0.0), vec2(rows, 1.0), 74.0);
  float n = 4.0 + floor(rr.x * 3.0);                                   // blocks in this course: 4, 5 or 6
  float x = uv.x * n + rr.y;
  vec2 f = vec2(fract(x), fract(uv.y * rows));
  vec3 q = h3(vec2(mod(floor(x), n), row), vec2(6.0, rows), 75.0 + warm * 9.0);
  float bw = 3.0 / n, bh = 3.2 / rows;
  float rag = fbm(uv, vec2(60.0), 3, 79.0) - 0.5;
  float de = min(min(f.x, 1.0 - f.x) * bw, min(f.y, 1.0 - f.y) * bh) + rag * 0.007;
  float block = smoothstep(0.005, 0.011, de);
  float arris = smoothstep(0.0, 0.045, de);
  float fine = fbm(uv, vec2(150.0), 3, 71.0), mid = fbm(uv, vec2(16.0), 4, 72.0), big = fbm(uv, vec2(2.0), 3, 77.0);
  float pit = smoothstep(0.7, 0.82, fbm(uv, vec2(220.0), 3, 78.0));
  vec3 stoneA = mix(L(0.50, 0.49, 0.46), L(0.68, 0.66, 0.60), q.x);
  vec3 stoneB = mix(L(0.56, 0.50, 0.40), L(0.42, 0.38, 0.34), q.y);   // warmer, browner
  vec3 a = mix(stoneA, stoneB, clamp(warm * 0.75 + step(0.78, q.z) * 0.45 + (rr.z - 0.5) * 0.2, 0.0, 1.0));
  vec3 c = a * (0.8 + 0.34 * fine) * (0.86 + 0.24 * mid) * (0.94 + 0.12 * big);
  float streak = fbm(uv * vec2(30.0, 1.0), vec2(30.0, 2.0), 3, 56.0);
  c *= 1.0 - smoothstep(0.55, 0.85, streak) * 0.2 * (0.4 + big);
  // corners knocked off: paler, lower
  float chip = smoothstep(0.64, 0.8, fbm(uv, vec2(36.0), 3, 80.0)) * (1.0 - smoothstep(0.0, 0.07, de));
  c = mix(c, c * 1.18 + 0.02, chip * 0.7);
  c *= 1.0 - pit * 0.3;
  vec3 mortar = L(0.50, 0.48, 0.43) * (0.78 + 0.4 * fbm(uv, vec2(210.0), 2, 81.0));
  col = mix(mortar, c, block);
  h = mix(0.28, 0.5 + 0.2 * arris + (q.z - 0.5) * 0.14 + (mid - 0.5) * 0.12 - pit * 0.06 - chip * 0.07, block);
  r = mix(0.97, 0.86 + (mid - 0.5) * 0.12, block);
  ao = mix(0.5, 1.0, block * smoothstep(0.0, 0.02, de)) * (1.0 - pit * 0.2);
}

void surf(vec2 uv){
  float mode = uP.x;
  vec3 col; float h, r, ao;
  if (mode < 0.5) stuccoWall(uv, col, h, r, ao);
  else if (mode < 1.5) stoneWall(uv, uP.y, col, h, r, ao);
  else brickWall(uv, col, h, r, ao);
  float fine = fbm(uv, vec2(150.0), 3, 101.0);

  vec2 m = uv * vec2(3.0, 3.2);                        // metres within the bay
  vec2 cm = vec2(1.5, 1.6), hw = vec2(0.555, 0.85);    // the opening: 1.11 x 1.70 m, sill 0.75 m up
  vec2 d = abs(m - cm) - hw;
  float edge = max(d.x, d.y);                          // < 0 inside the opening
  float inside = step(edge, 0.0);
  float top = cm.y + hw.y, bot = cm.y - hw.y;
  vec3 dress = L(0.74, 0.71, 0.64) * (0.9 + 0.16 * fine);          // dressed stone or painted trim
  if (mode < 0.5) dress = L(0.88, 0.86, 0.80) * (0.92 + 0.12 * fine);
  float dressH = 0.78;

  // string course at the floor line: a band that stands out, and the shadow it throws on the wall below
  float band = step(3.02, m.y) * step(m.y, 3.2);
  float bandTop = step(3.14, m.y);
  col = mix(col, dress, band); h = mix(h, dressH - bandTop * 0.06, band); r = mix(r, 0.85, band);
  ao *= 1.0 - 0.45 * smoothstep(2.74, 3.02, m.y) * (1.0 - band);

  // surround: 110 mm of dressing round the opening, a lintel with joints and a keystone, a projecting sill
  float surround = step(0.0, edge) * step(edge, 0.11);
  float lintel = step(abs(m.x - cm.x), hw.x + 0.2) * step(top + 0.0, m.y) * step(m.y, top + 0.30);
  float vj = abs(fract((m.x - cm.x) / 0.19 + 0.5) - 0.5) * 0.19;
  float joint = step(vj, 0.004) * step(top + 0.11, m.y);
  float key = step(abs(m.x - cm.x), 0.085) * step(top + 0.11, m.y) * step(m.y, top + 0.35);
  float sill = step(abs(m.x - cm.x), hw.x + 0.1) * step(bot - 0.085, m.y) * step(m.y, bot);
  float dr = max(max(surround, lintel), max(sill, key));
  col = mix(col, dress * (1.0 - joint * 0.35), dr); h = mix(h, dressH + key * 0.06 + sill * 0.08 + lintel * 0.03, dr); r = mix(r, 0.8, dr);
  ao = mix(ao, 1.0, dr);
  // under the sill and the lintel: a dark shadow line, and a stain running down from the sill
  float underSill = step(abs(m.x - cm.x), hw.x + 0.12) * smoothstep(0.17, 0.0, (bot - 0.085) - m.y) * step(m.y, bot - 0.085);
  float underLintel = step(abs(m.x - cm.x), hw.x + 0.15) * smoothstep(0.1, 0.0, m.y - (top + 0.30)) * step(top + 0.30, m.y);
  ao *= 1.0 - 0.5 * underSill * (1.0 - dr) - 0.4 * underLintel * (1.0 - dr);
  float drip = smoothstep(0.5, 0.85, fbm(uv, vec2(54.0, 2.0), 3, 102.0)) * step(abs(m.x - cm.x), hw.x + 0.08) * smoothstep(1.2, 0.0, (bot - 0.085) - m.y) * step(m.y, bot - 0.085);
  col *= 1.0 - drip * 0.3;

  // the opening: reveal shadow, sash, muntins, panes
  float p = (m.x - (cm.x - hw.x)) / (2.0 * hw.x), s = (m.y - bot) / (2.0 * hw.y);
  float px = p * 3.0, qy = s * 4.0;
  float gx = min(fract(px), 1.0 - fract(px)) * (2.0 * hw.x / 3.0), gy = min(fract(qy), 1.0 - fract(qy)) * (2.0 * hw.y / 4.0);
  float frame = step(-0.055, edge);
  float rail = step(abs(s - 0.5) * 2.0 * hw.y, 0.032);
  float mun = max(step(gx, 0.012), step(gy, 0.011));
  vec2 pid = vec2(floor(px), floor(qy));
  vec3 pr = h3(pid, vec2(3.0, 4.0), 103.0);
  float sky = smoothstep(-0.2, 1.1, s + (pr.x - 0.5) * 0.5);
  vec3 glass = mix(L(0.03, 0.04, 0.05), L(0.34, 0.45, 0.56), sky * (0.35 + 0.65 * pr.y));
  glass = mix(glass, L(0.40, 0.37, 0.30) * 0.5, step(0.84, pr.z) * 0.8);                     // a curtain
  vec3 sashC = L(0.80, 0.78, 0.72) * (0.9 + 0.2 * fine);
  float wood = max(max(frame, rail), mun);
  vec3 win = mix(glass, sashC, wood);
  float winH = mix(0.16, 0.34 + 0.06 * (1.0 - smoothstep(0.0, 0.03, -edge)), wood);
  float winR = mix(0.06, 0.55, wood);
  float winAo = mix(0.8, 0.95, wood);
  float shadowTop = smoothstep(0.18, 0.0, top - m.y) * 0.5, shadowSide = smoothstep(0.14, 0.0, (m.x - (cm.x - hw.x))) * 0.35;
  winAo *= 1.0 - shadowTop * (1.0 - wood) - shadowSide * (1.0 - wood);
  col = mix(col, win, inside); h = mix(h, winH, inside); r = mix(r, winR, inside); ao = mix(ao, winAo, inside);

  emit(col, 1.0, h, ao, r, 0.0);
}`;

GENERATORS.facade = BAY_SHADER;

Object.assign(SETS, {
  facade_stucco: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 4, p: [0, 0] },
  facade_stone: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 5, p: [1, 0], seed: 3 },
  facade_rubble: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 6, p: [1, 1], seed: 5 },
  facade_brick: { fn: 'facade', size: 1, tile: [3.0, 3.2], bump: 6, p: [2, 0], seed: 8 },
});
Object.assign(MATERIALS, {
  facade_stucco: def('facade_stucco', { wet: [0.2, 0.2, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
  facade_stone: def('facade_stone', { wet: [0.3, 0.25, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
  facade_rubble: def('facade_rubble', { wet: [0.3, 0.25, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
  facade_brick: def('facade_brick', { wet: [0.3, 0.25, 0.5, 0], macro: [0.12, 0.08, 0.4, 0.3] }),
});
