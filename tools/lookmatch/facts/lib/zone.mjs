// Palette zones: the clusters of the photographs inside a disc, merged into one palette. Pure.
// Thresholds of this step are in ZONE below.
import { haversine } from '../../lib/geo.mjs';
import { weightedMedian } from '../../lib/stats.mjs';
import { labToHex } from '../../lib/color.mjs';
import { deltaE } from './rules.mjs';

export const ZONE = {
  minClusterShare: 0.03,       // a photograph's wall cluster under this share of its wall pixels is ignored
  minL: 24,                    // darker than this (L*) is shadow or an opening leaking in, not a paint
  smoothGrey: { maxChroma: 4, maxL: 60 },   // a smooth, nearly colourless, mid-dark 'render' is tarmac or shadow in the wall region, not a wall
  shadow: { maxChroma: 6, maxL: 45 },       // a dark, nearly colourless cluster of any material is shade or wet stone seen in shade, not a paint: its sunlit twin, if any, is another cluster
  maxChroma: 72,               // more saturated than this is not a wall (sky, signs)
  mergeDeltaE: 13,             // clusters of one material closer than this (CIELAB distance, de-lit) are one colour
  minGroupShare: 0.05,         // a colour under this share of the zone's classified wall pixels is dropped
  minSupport: 2,               // a colour must come from at least this many photographs (when the zone has 4 or more)
  maxWalls: 8, maxAccents: 5, maxRoofs: 3,
  accentMergeDeltaE: 18, accentMinSupport: 2,
  confidence: { high: { photos: 6, topSupport: 0.6 }, medium: { photos: 4, topSupport: 0.4 } },
  gridNeighbourhood: 60, gridSeparation: 80,
};

const median3 = (items, ch) => weightedMedian(items.map((i) => ({ v: i.lab[ch], w: i.w })));

/** Greedy grouping of items [{ lab:[L,a,b], w, photo }] by CIELAB distance to the heavier group's running centre. */
export function groupColours(items, maxDE) {
  const groups = [];
  for (const it of items.slice().sort((a, b) => b.w - a.w)) {
    let best = null, bd = Infinity;
    for (const g of groups) { const d = deltaE({ L: g.c[0], a: g.c[1], b: g.c[2] }, { L: it.lab[0], a: it.lab[1], b: it.lab[2] }); if (d < bd) { bd = d; best = g; } }
    if (best && bd <= maxDE) { best.items.push(it); best.c = [0, 1, 2].map((ch) => median3(best.items, ch)); } else groups.push({ items: [it], c: it.lab.slice() });
  }
  return groups.map((g) => ({ lab: g.c, w: g.items.reduce((s, i) => s + i.w, 0), photos: new Set(g.items.map((i) => i.photo)), items: g.items }));
}
const hexLab = (l) => labToHex(l[0], l[1], l[2]);

/** One zone from the photographs inside it. photos: [{ id, weight, walls, accents, roofs }]. */
export function zoneOf(centre, photos, radius, Z = ZONE) {
  const wallItems = [], unclassified = { w: 0 }; let totalW = 0;
  for (const p of photos) for (const c of p.walls || []) {
    if (c.share < Z.minClusterShare) continue;
    const w = p.weight * c.share; totalW += w;
    if (c.material === 'unknown' || c.lab[0] < Z.minL || c.chroma > Z.maxChroma || (c.material === 'render' && c.chroma < Z.smoothGrey.maxChroma && c.lab[0] < Z.smoothGrey.maxL) || (c.chroma < Z.shadow.maxChroma && c.lab[0] < Z.shadow.maxL)) { unclassified.w += w; continue; }
    wallItems.push({ material: c.material, lab: c.lab, w, photo: p.id });
  }
  const bigZone = photos.length >= 4, walls = [];
  for (const m of new Set(wallItems.map((i) => i.material))) for (const g of groupColours(wallItems.filter((i) => i.material === m), Z.mergeDeltaE)) {
    if (bigZone && g.photos.size < Z.minSupport) { unclassified.w += g.w; continue; }
    walls.push({ material: m, colour: hexLab(g.lab), w: g.w, support: g.photos.size });
  }
  const wsum = walls.reduce((s, x) => s + x.w, 0) || 1;
  let kept = walls.map((x) => ({ ...x, share: x.w / wsum })).filter((x) => x.share >= Z.minGroupShare).sort((a, b) => b.share - a.share).slice(0, Z.maxWalls);
  const ks = kept.reduce((s, x) => s + x.share, 0) || 1;
  kept = kept.map((x) => ({ material: x.material, colour: x.colour, share: +(x.share / ks).toFixed(3), photographs: x.support }));

  const accItems = []; for (const p of photos) for (const a of p.accents || []) accItems.push({ lab: a.lab, w: p.weight * a.share, photo: p.id });
  const aGroups = groupColours(accItems, Z.accentMergeDeltaE).filter((g) => g.photos.size >= Z.accentMinSupport).sort((a, b) => b.w - a.w).slice(0, Z.maxAccents);
  const aTot = aGroups.reduce((s, g) => s + g.w, 0) || 1;
  const accents = aGroups.map((g) => ({ colour: hexLab(g.lab), share: +(g.w / aTot).toFixed(3), photographs: g.photos.size }));

  const roofItems = []; for (const p of photos) for (const r of p.roofs || []) roofItems.push({ material: r.material, hex: r.hex, w: p.weight * r.share, photo: p.id });
  const roofs = [];
  for (const m of new Set(roofItems.map((i) => i.material))) {
    const its = roofItems.filter((i) => i.material === m), w = its.reduce((s, i) => s + i.w, 0), ph = new Set(its.map((i) => i.photo));
    roofs.push({ material: m, colour: its.slice().sort((a, b) => b.w - a.w)[0].hex, w, photographs: ph.size });
  }
  const rTot = roofs.reduce((s, r) => s + r.w, 0) || 1;
  const roofOut = roofs.sort((a, b) => b.w - a.w).slice(0, Z.maxRoofs).map((r) => ({ material: r.material, colour: r.colour, share: +(r.w / rTot).toFixed(3), photographs: r.photographs, confidence: 'low' }));

  const n = photos.length, top = kept[0] ? kept[0].photographs / n : 0, C = Z.confidence;
  const confidence = n >= C.high.photos && top >= C.high.topSupport ? 'high' : n >= C.medium.photos && top >= C.medium.topSupport ? 'medium' : 'low';
  return { centre: [+centre.lat.toFixed(6), +centre.lon.toFixed(6)], radius, walls: kept, accents, roofs: roofOut, photographs: n, confidence,
    unclassifiedShare: +(unclassified.w / (totalW || 1)).toFixed(3), sources: photos.map((p) => p.id).sort() };
}

/** Zones for every centre [{ id, lat, lon }] from photos [{ id, lat, lon, weight, walls, accents, roofs }]; a zone with fewer than minPhotos is dropped. */
export function buildZones(centres, photos, { radius = 80, minPhotos = 3 } = {}) {
  const out = [];
  for (const c of centres) {
    const inside = photos.filter((p) => p.weight > 0 && haversine(c.lat, c.lon, p.lat, p.lon) <= radius);
    if (inside.length < minPhotos) continue;
    out.push({ id: c.id, ...zoneOf(c, inside, radius) });
  }
  return out;
}

/** Extra centres from the cached photographs' own positions: the densest point first, then the next one at least gridSeparation away. */
export function gridCentres(photos, existing, { minPhotos = 3, Z = ZONE } = {}) {
  const left = photos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)), centres = existing.map((e) => ({ lat: e.lat, lon: e.lon })), out = [];
  for (;;) {
    let best = null;
    for (const p of left) {
      const near = left.filter((q) => haversine(p.lat, p.lon, q.lat, q.lon) <= Z.gridNeighbourhood);
      if (near.length >= minPhotos && centres.every((c) => haversine(c.lat, c.lon, p.lat, p.lon) >= Z.gridSeparation) && (!best || near.length > best.near.length)) best = { p, near };
    }
    if (!best) break;
    const c = { lat: best.near.reduce((s, q) => s + q.lat, 0) / best.near.length, lon: best.near.reduce((s, q) => s + q.lon, 0) / best.near.length };
    centres.push(c); out.push({ id: `grid-${out.length + 1}`, ...c, from: 'photograph cluster' });
    for (const q of best.near) left.splice(left.indexOf(q), 1);
  }
  return out;
}
