// STAGE B (written and tested on fixtures; NEVER RUN ON REAL IMAGERY): one building, one façade, from a photograph whose
// camera position and compass angle are known (Mapillary, behind MAPILLARY_TOKEN). Pure functions.
//
// Frame: game metres, x east, z south, heading in degrees clockwise from grid NORTH (north = -z). The caller turns the
// photograph's compass angle (true north) into a grid heading by subtracting the scene's convergence angle, and its
// latitude/longitude into game metres with the scene's georef (engine/src/geo/georef.js).
//
// PINHOLE MODEL. camera = { x, z, heading, eye (m above the ground at the camera, default 1.6 for a person, a car roof is higher),
// hfov (degrees, default 75: Mapillary does not always give intrinsics, a phone or a dash camera is 60 to 90; STATED, NOT MEASURED),
// width, height (pixels of the image used) }. A point at forward distance d and sideways offset s (right of the heading) lands in
// column  u = width * (0.5 + (s / d) / (2 tan(hfov/2)))  and, at height y above the camera's eye line, in row
// v = height * (0.5 - ((y - eye) / d) / (2 tan(hfov/2) * height / width)). The horizon is the middle row (no pitch, no roll).
// A point with d <= NEAR is behind the camera or too close and is not projected.
//
// FAÇADES. Each building's front edges (the `front` list of the scene record; every edge not blind when it has none) that face the camera
// (outward normal toward it) and lie within maxDistance. For every image column the nearest edge along that column's ray wins:
// a farther wall behind a nearer one loses those columns (no occlusion by trees or cars is modelled).
import { analysePhoto } from './photo.mjs';
import { openings } from './photo.mjs';
import { RULES, deltaE } from './rules.mjs';

export const POSED = { near: 0.5, maxDistance: 60, eye: 1.6, hfov: 75, minStripPixels: 1500, fullConfidencePixels: 12000, openingMinBlob: 14, rowGapShare: 0.5 };

const rad = (d) => (d * Math.PI) / 180;
export const camDefaults = (c) => ({ eye: POSED.eye, hfov: POSED.hfov, ...c });

/** Forward distance d, sideways offset s of a ground point from the camera. */
export function toCamera(cam, X, Z) {
  const h = rad(cam.heading), fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  const dx = X - cam.x, dz = Z - cam.z;
  return { d: dx * fx + dz * fz, s: dx * rx + dz * rz };
}
/** Column (pixels, may lie outside the image) of a point at distance d, offset s; null when behind or too near. */
export function column(cam, d, s) {
  if (d <= POSED.near) return null;
  return cam.width * (0.5 + (s / d) / (2 * Math.tan(rad(cam.hfov) / 2)));
}
/** Row of a point at height y (metres above the datum the eye height is measured from) at distance d. */
export function row(cam, d, y) {
  const t = 2 * Math.tan(rad(cam.hfov) / 2) * (cam.height / cam.width);
  return cam.height * (0.5 - ((y - cam.eye) / d) / t);
}

/**
 * The façades the camera sees, each with the image columns it owns after occlusion.
 * buildings: scene records { id, r (flat ring), g, h, rh?, blind?, front? }. cam in camDefaults form.
 * Returns [{ buildingId, edge, depth (m, at its middle), cols: [c0, c1) integer columns won, width }] sorted by buildingId, edge.
 */
export function visibleFacades(buildings, camIn) {
  const cam = camDefaults(camIn), W = cam.width, tanH = Math.tan(rad(cam.hfov) / 2);
  const cands = [];
  for (const b of buildings) {
    if (b.k === 'roof' || !b.r || b.r.length < 6) continue;
    const n = b.r.length / 2; let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += b.r[2 * i] * b.r[2 * j + 1] - b.r[2 * j] * b.r[2 * i + 1]; }
    const blind = new Set(b.blind || []), front = b.front && b.front.length ? new Set(b.front) : null;
    for (let i = 0; i < n; i++) {
      if (front ? !front.has(i) : blind.has(i)) continue;
      const j = (i + 1) % n, ax = b.r[2 * i], az = b.r[2 * i + 1], bx = b.r[2 * j], bz = b.r[2 * j + 1], ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
      if (len < 1.2) continue;
      const nx = area > 0 ? ez / len : -ez / len, nz = area > 0 ? -ex / len : ex / len;       // outward normal (the builder's convention)
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if ((cam.x - mx) * nx + (cam.z - mz) * nz <= 0) continue;                               // faces away
      cands.push({ b, i, ax, az, ex, ez, len });
    }
  }
  const best = new Float64Array(W).fill(Infinity), who = new Int32Array(W).fill(-1);
  const h = rad(cam.heading), fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  for (let c = 0; c < W; c++) {
    const k = ((c + 0.5) / W - 0.5) * 2 * tanH;            // sideways per forward metre of this column's ray
    const dirx = fx + k * rx, dirz = fz + k * rz;
    for (let q = 0; q < cands.length; q++) {
      const e = cands[q], den = dirx * e.ez - dirz * e.ex;
      if (Math.abs(den) < 1e-12) continue;
      const px = e.ax - cam.x, pz = e.az - cam.z;
      const t = (px * e.ez - pz * e.ex) / den, u = (px * dirz - pz * dirx) / den;     // ray t along dir, u along the edge
      if (t <= 0 || u < 0 || u > 1) continue;
      const depth = t;                                                  // forward distance: dir has forward component 1
      if (depth <= POSED.near || depth > POSED.maxDistance) continue;
      if (depth < best[c]) { best[c] = depth; who[c] = q; }
    }
  }
  const out = [], runs = new Map();
  for (let c = 0; c < W; c++) { if (who[c] < 0) continue; const r = runs.get(who[c]) || []; r.push(c); runs.set(who[c], r); }
  for (const [q, cols] of runs) {
    const e = cands[q], mid = cols[cols.length >> 1];
    out.push({ buildingId: e.b.id, edge: e.i, depth: +best[mid].toFixed(2), cols: [cols[0], cols[cols.length - 1] + 1], width: cols.length, columns: cols, b: e.b });
  }
  return out.sort((a, b) => a.buildingId - b.buildingId || a.edge - b.edge);
}

/** The rows a façade covers in column c at its distance: [top, bottom) between the eave (or the roof when flat) and the ground. */
export function stripRows(cam, facade, depthAt) {
  const b = facade.b, top = b.g + b.h - (b.rh || 0), bottom = b.g;
  const yEye = (cam.groundY ?? 0) + cam.eye;      // heights are metres above the same datum as `g`; cam.groundY = ground at the camera
  const c2 = { ...cam, eye: yEye };
  return [Math.max(0, Math.floor(row(c2, depthAt, top))), Math.min(cam.height, Math.ceil(row(c2, depthAt, bottom)))];
}

/** The 0/1 mask of the pixels of one façade strip in an image. */
export function stripMask(cam, facade) {
  const valid = new Uint8Array(cam.width * cam.height);
  let n = 0;
  for (const c of facade.columns) {
    const [r0, r1] = stripRows(cam, facade, facade.depth);
    for (let y = r0; y < r1; y++) { valid[y * cam.width + c] = 1; n++; }
  }
  return { valid, pixels: n };
}

/** Blobs (bounding boxes) of an opening mask, 4-connected. */
export function blobs(open, w, h, minPixels = POSED.openingMinBlob) {
  const seen = new Uint8Array(w * h), out = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!open[s] || seen[s]) continue;
    let x0 = w, x1 = -1, y0 = h, y1 = -1, n = 0; seen[s] = 1; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && open[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    if (n >= minPixels) out.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
  }
  return out;
}

/** Storeys (rows of opening blobs) and windows per storey (the median blob count of a row), roughly. Row = blobs whose centres lie within half the median blob height. */
export function storeysAndWindows(bl, gap = POSED.rowGapShare) {
  if (bl.length < 2) return { storeys: null, windowsPerStorey: null };
  const hs = bl.map((b) => b.h).sort((a, b) => a - b), medH = hs[hs.length >> 1], rows = [];
  for (const b of bl.slice().sort((a, b) => a.cy - b.cy)) { const r = rows[rows.length - 1]; if (r && b.cy - r.cy <= gap * medH) { r.items.push(b); r.cy = r.items.reduce((s, i) => s + i.cy, 0) / r.items.length; } else rows.push({ cy: b.cy, items: [b] }); }
  const counts = rows.map((r) => r.items.length).sort((a, b) => a - b);
  return { storeys: rows.length, windowsPerStorey: counts[counts.length >> 1] };
}

/**
 * Facts of one façade strip in one photograph: crop the strip's bounding box, look only at its pixels, cluster and classify as in stage A.
 * Returns null when the strip is too small. { material, colour, accents, storeys, windowsPerStorey, confidence, pixels, depth }
 */
export function factsOfStrip(rgba, cam, facade, R = RULES) {
  const { valid, pixels } = stripMask(cam, facade);
  if (pixels < POSED.minStripPixels) return null;
  const W = cam.width, H = cam.height, mask = new Uint8Array(W * H);          // MASK.wall = 0 everywhere; `valid` limits the pixels
  const S = { ...R, roofBand: { rows: 0 }, pavement: { lowerShare: 0, maxChroma: 0 }, skyTexture: { ...R.skyTexture, minGradient: 1e9 } };
  const res = analysePhoto(rgba, W, H, mask, S, valid);
  const top = res.walls.filter((c) => c.material !== 'unknown' && c.material !== 'accent').sort((a, b) => b.share - a.share)[0];
  if (!top) return null;
  const material = top.material === 'painted_white' ? 'painted_white' : top.material;
  const open = res.maps.px.map((v) => (v === 5 ? 1 : 0)), bl = blobs(open, W, H), sw = storeysAndWindows(bl);
  const unknown = 1 - res.walls.filter((c) => c.material !== 'unknown').reduce((s, c) => s + c.share, 0);
  const area = Math.min(1, pixels / POSED.fullConfidencePixels);
  const confidence = +(area * (1 - Math.min(0.8, unknown)) * (sw.storeys ? 1 : 0.9) * (facade.depth > 40 ? 0.7 : 1)).toFixed(2);
  return { material, colour: top.hex, accents: res.accents.slice(0, 2).map((a) => a.hex), storeys: sw.storeys, windowsPerStorey: sw.windowsPerStorey, confidence, pixels, depth: facade.depth };
}

/**
 * Per-building facts from posed photographs: [{ photo: { id, title, author, licence, licenceUrl, url }, cam, rgba }].
 * A building seen in several photographs keeps its most confident reading, with every contributing photograph as a source.
 */
export function posedFacts(buildings, shots) {
  const byId = new Map();
  for (const s of shots) {
    const cam = camDefaults(s.cam);
    if (cam.groundY === undefined) {   // the ground under the camera, not known: the median ground of the five nearest buildings
      const near = buildings.filter((b) => b.r && b.r.length >= 6).map((b) => ({ g: b.g, d: Math.hypot(b.r[0] - cam.x, b.r[1] - cam.z) })).sort((a, b) => a.d - b.d).slice(0, 5).map((q) => q.g).sort((a, b) => a - b);
      cam.groundY = near.length ? near[near.length >> 1] : 0;
    }
    for (const f of visibleFacades(buildings, cam)) {
      const r = factsOfStrip(s.rgba, cam, f);
      if (!r) continue;
      const cur = byId.get(f.buildingId);
      const rec = { buildingId: f.buildingId, material: r.material, colour: r.colour, accents: r.accents, storeys: r.storeys, windowsPerStorey: r.windowsPerStorey, confidence: r.confidence, sources: [s.photo.id], _e: f.edge };
      if (!cur || r.confidence > cur.confidence) byId.set(f.buildingId, cur ? { ...rec, sources: [...new Set([...cur.sources, ...rec.sources])] } : rec);
      else if (!cur.sources.includes(s.photo.id)) cur.sources.push(s.photo.id);
    }
  }
  return [...byId.values()].map(({ _e, ...r }) => r).sort((a, b) => a.buildingId - b.buildingId);
}
export { deltaE };
