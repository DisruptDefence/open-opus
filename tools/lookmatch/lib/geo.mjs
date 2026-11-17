// Viewpoint (game metres, heading from grid north) to latitude/longitude and heading from true north, using the
// engine's own georef module: no second projection is written here.
import { createGeoref } from '../../../engine/src/geo/georef.js';

const norm360 = (d) => ((d % 360) + 360) % 360;
export const angDiff = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)); return d > 180 ? 360 - d : d; };

/** Great-circle distance in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** Initial bearing from point 1 to point 2, degrees from true north. */
export function bearingTo(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180, dLon = (lon2 - lon1) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2 * rad), x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
  return norm360(Math.atan2(y, x) / rad);
}

/** The scene's georef block and a viewpoint -> { lat, lon, headingTrue, headingGrid }. */
export function viewGeo(sceneGeoref, view) {
  const g = createGeoref(sceneGeoref), p = g.toGeo(view.x, view.z);
  return { lat: p.lat, lon: p.lon, headingGrid: norm360(view.heading ?? 0), headingTrue: norm360((view.heading ?? 0) + g.convergenceDeg) };
}
