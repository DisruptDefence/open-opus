// Roofs: a building record into roof planes. Pure code. OWNED BY ITEM 4 of docs/plans/SCENE-DETAIL.md; the body below
// is the placeholder of item 3 (the roof the engine drew before: the eave ring drawn in towards its middle and raised).
//
// CONTRACT (fixed by item 3; change it only together with gen/mesher.js and the plan)
//
//   roof(soups, b, style) -> { slots, ridge, parapet }
//
//   soups   a soup set (soup.js createSoups). Write the roof into it and nothing else.
//   b       a decoded building (scene/source.js): ring, holes (flat [x, z, …], game metres, either winding), yBase,
//           hEave, hRoof (metres; the eave is at y = yBase + hEave, the top of the roof at yBase + hEave + hRoof),
//           roofShape (4.2 enum: 0 flat 1 gabled 2 hipped 3 mansard 4 pyramidal 5 skillion 6 dome 7 cone 8 gambrel),
//           roofDir (degrees clockwise from grid north, 0 to 179, the direction the ridge runs; 255 = along the long
//           axis of poly.js obb()), roofMat (4.2 enum), roofColor (linear [r, g, b] or null), tint (linear, the
//           wall colour, for gable walls), facade (4.2 enum), blind (Set of edge numbers), id.
//           The WHOLE building, never a piece of passage.js: a passage runs under the roof, not through it.
//   style   the resolved style (style.js). Roofs read nothing from it yet; it is there so they can.
//   returns slots   where dormers go: [{ ox, oz, ex, ez, len, y, slope, edge }]: origin on the eave line, unit
//                   vector along it (the outside is to the RIGHT of the vector turned as soup.js frame() does: the
//                   viewer stands at (-ez, ex)), length, eave height y, rise over run of the slope above it, the
//                   ring edge number. Empty when the roof takes none.
//           ridge   where chimneys go: [{ x, z, y }]. Empty for flat roofs.
//           parapet metres the outer wall rises above the eave (flat roofs with a parapet; else 0). The façade
//                   generators raise their wall by it.
//
//   Coordinates  game metres, y up, z south. Bearing d degrees is the direction (sin d, -cos d) in (x, z).
//   Winding      every triangle counter-clockwise seen from outside (soup.js computes the normal from it). A roof
//                plane faces up: normal y > 0.
//   Soups        ROOF_TINT_SOUP[b.roofMat] with b.roofColor as tint when the building has a colour, else
//                ROOF_SOUP[b.roofMat] (style.js). Gable walls and walls under a skillion: WALL_SOUP[b.facade] with
//                b.tint. Roof materials are triplanar: uv is not read.
//   Group        `base`: drawn at every distance, built once per chunk. No detail smaller than a roof plane here.
//   Budget       <= 120 000 triangles for all roofs of a scene; no allocation per frame (called once per building).
//   Must not     read the terrain, the DOM or three.js; throw on any ring (fall back to a flat cap instead).
import { cap, triN } from './soup.js';
import { ROOF_SOUP, ROOF_TINT_SOUP } from './style.js';

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

export function roof(soups, b, style) { // eslint-disable-line no-unused-vars
  // the placeholder keeps the picture of before: tagged colours were darkened twice and lifted by 1.6 on the zinc texture
  const tint = b.roofColor ? b.roofColor.map((v) => srgbToLinear(v) * 1.6) : null;
  const s = soups.get((tint ? ROOF_TINT_SOUP : ROOF_SOUP)[b.roofMat] || (tint ? ROOF_TINT_SOUP : ROOF_SOUP)[1]);
  const eave = b.yBase + b.hEave, top = eave + b.hRoof, r = b.ring, info = { slots: [], ridge: [], parapet: 0 };
  if (!b.hRoof || !b.roofShape) { cap(s, r, b.holes || [], eave, tint); return info; }
  let cx = 0, cz = 0; for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; } cx /= r.length / 2; cz /= r.length / 2;
  let rad = Infinity; for (let i = 0; i < r.length; i += 2) rad = Math.min(rad, Math.hypot(r[i] - cx, r[i + 1] - cz));
  const k = b.roofShape === 4 || b.roofShape === 7 ? 0.02 : Math.max(0.15, 1 - (b.hRoof * (b.roofShape === 3 ? 0.55 : 1.1)) / Math.max(1, rad));
  const inner = r.map((v, i) => (i % 2 ? cz + (v - cz) * k : cx + (v - cx) * k));
  let area = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) area += r[j] * r[i + 1] - r[i] * r[j + 1];
  const out = area > 0 ? 1 : -1;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const A = [r[j], eave, r[j + 1]], B = [r[i], eave, r[i + 1]], C = [inner[i], top, inner[i + 1]], D = [inner[j], top, inner[j + 1]];
    // the normal the old code gave these faces (the edge's outward normal tilted by the pitch), kept so the picture is the same
    const ex = B[0] - A[0], ez = B[2] - A[2], l = Math.hypot(ex, ez) || 1, run = Math.hypot(D[0] - A[0], D[2] - A[2]) || 0.01, nl = Math.hypot(run, b.hRoof);
    const n = [((ez / l) * out * b.hRoof) / nl, run / nl, ((-ex / l) * out * b.hRoof) / nl];
    if (out > 0) { triN(s, A, C, B, n, n, n, tint); triN(s, A, D, C, n, n, n, tint); } else { triN(s, A, B, C, n, n, n, tint); triN(s, A, C, D, n, n, n, tint); }
  }
  if (k > 0.05) cap(s, inner, [], top, tint);
  info.ridge.push({ x: cx, z: cz, y: top });
  return info;
}
