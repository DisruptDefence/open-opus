// Source: Mapillary (Graph API), used only when MAPILLARY_TOKEN is set. Written from the public documentation
// (https://www.mapillary.com/developer/api-documentation); NOT yet run against the live service. Images are CC BY-SA 4.0
// and always carry a compass angle. The token goes in the Authorization header, never in the URL, and is never printed.
import { BASE_HEADERS } from '../http.mjs';

export const name = 'mapillary';
const API = 'https://graph.mapillary.com/images';

export const enabled = (env = process.env) => !!(env.MAPILLARY_TOKEN && String(env.MAPILLARY_TOKEN).trim());

/** The bounding box (west,south,east,north) of `radius` metres round a point. */
export function bbox(lat, lon, radius) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => +v.toFixed(6));
}

export function buildRequests(view, { radius = 80, token } = {}) {
  const q = new URLSearchParams({ fields: 'id,thumb_1024_url,computed_geometry,computed_compass_angle,captured_at,creator', bbox: bbox(view.lat, view.lon, radius).join(','), limit: '100' });
  return [{ url: `${API}?${q}`, headers: { ...BASE_HEADERS, Authorization: `OAuth ${token}` } }];
}

export function parse(json) {
  const out = [];
  for (const d of (json && json.data) || []) {
    const g = d.computed_geometry && d.computed_geometry.coordinates; if (!g || !d.thumb_1024_url || !Number.isFinite(d.computed_compass_angle)) continue;
    out.push({
      source: 'mapillary', id: 'm' + d.id, title: 'Mapillary image ' + d.id, pageUrl: `https://www.mapillary.com/app/?pKey=${d.id}`,
      author: (d.creator && d.creator.username) || '', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      lat: g[1], lon: g[0], positionOf: 'camera', heading: ((d.computed_compass_angle % 360) + 360) % 360,
      date: d.captured_at ? new Date(d.captured_at).toISOString().slice(0, 10) : '', description: '', categories: '',
      width: 1024, height: null, mime: 'image/jpeg', downloadUrl: d.thumb_1024_url,
    });
  }
  return out;
}
