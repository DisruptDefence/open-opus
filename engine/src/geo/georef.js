// Where a scene sits on the Earth. Pure maths, no dependencies: used by the engine, by the world API and by tests.
//
// The rule (docs/SCENE-FORMAT.md, 2.1): game metres are UTM grid metres.
//     x =  E - E0      east
//     z = -(N - N0)    south        (-z is GRID north)
//     y =  H - H0      up
// Everything here is exact UTM (WGS 84), forward and inverse; there is no flat-earth approximation.

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
const RAD = Math.PI / 180;

const centralMeridian = (zone) => ((zone - 1) * 6 - 180 + 3) * RAD;

function meridianArc(phi) {
  return A * ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi
    - ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
}

/** Latitude and longitude (degrees) to UTM in a given zone (the scene's zone, even across a zone boundary). */
export function utmForward(lat, lon, zone, south = false) {
  const phi = lat * RAD, dl = lon * RAD - centralMeridian(zone);
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin * sin), T = tan * tan, C = EP2 * cos * cos, a = cos * dl;
  const easting = K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120) + 500000;
  let northing = K0 * (meridianArc(phi) + N * tan * ((a * a) / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  if (south) northing += 10000000;
  return { easting, northing };
}

/** UTM to latitude and longitude (degrees). Accurate to well under a millimetre inside a zone. */
export function utmInverse(easting, northing, zone, south = false) {
  const x = easting - 500000, y = south ? northing - 10000000 : northing;
  const mu = y / K0 / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 = mu + ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * E1 * E1) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
  const C1 = EP2 * cos * cos, T1 = tan * tan, N1 = A / Math.sqrt(1 - E2 * sin * sin);
  const R1 = (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5, D = x / (N1 * K0);
  const lat = phi1 - ((N1 * tan) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = centralMeridian(zone) + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / cos;
  return { lat: lat / RAD, lon: lon / RAD };
}

/** Grid convergence in degrees (true north to grid north, east positive) at a latitude and longitude. */
export function convergenceDeg(lat, lon, zone) {
  return Math.atan(Math.tan(lon * RAD - centralMeridian(zone)) * Math.sin(lat * RAD)) / RAD;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
export const latBand = (lat) => BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))];

/** MGRS parts straight from UTM (never through a rounded latitude): digits are truncated, as MGRS is. */
export function mgrsFromUtm(easting, northing, zone, band, digits = 5) {
  const cols = ['STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR'][zone % 3], rows = 'ABCDEFGHJKLMNPQRSTUV';
  const col = cols[Math.floor(easting / 100000) - 1];
  const row = rows[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  const cut = (v) => String(Math.floor((v % 100000) / 10 ** (5 - digits))).padStart(digits, '0');
  return { zone: `${zone}${band}`, square: col + row, easting: cut(easting), northing: cut(northing) };
}

/**
 * Read a scene's `georef` block. Two spellings are accepted:
 *   docs/SCENE-FORMAT.md 2.2:   { utm: { zone, hemisphere }, anchor: { e0, n0, h0 }, vertical: { geoidUndulation }, convergenceDeg }
 *   the first Old Quebec file:  { zone, hemisphere, easting, northing, anchor: { hae }, convergence_deg }
 */
export function createGeoref(g = {}) {
  const utm = g.utm || g;
  const zone = +utm.zone, south = String(utm.hemisphere || 'N').toUpperCase() === 'S';
  const a = g.anchor || {};
  const e0 = a.e0 ?? g.easting, n0 = a.n0 ?? g.northing, h0 = a.h0 ?? 0;
  if (!(zone >= 1 && zone <= 60) || !Number.isFinite(e0) || !Number.isFinite(n0)) throw new Error('georef: zone and anchor (e0, n0) are required');
  // ellipsoid height = game y + h0 + undulation
  const undulation = (g.vertical && typeof g.vertical === 'object' ? g.vertical.geoidUndulation : undefined) ?? a.hae ?? 0;
  const anchorGeo = utmInverse(e0, n0, zone, south);
  const conv = g.convergenceDeg ?? g.convergence_deg ?? convergenceDeg(anchorGeo.lat, anchorGeo.lon, zone);

  const toUTM = (x, z) => ({ zone, easting: e0 + x, northing: n0 - z });
  function toGeo(x, z, y = 0) {
    const p = utmInverse(e0 + x, n0 - z, zone, south);
    return { lat: p.lat, lon: p.lon, hae: y + h0 + undulation };
  }
  function toGame(lat, lon) {
    const u = utmForward(lat, lon, zone, south);
    return { x: u.easting - e0, z: -(u.northing - n0) };
  }
  function toMGRS(x, z, digits = 5) {
    const E = e0 + x, N = n0 - z;
    return mgrsFromUtm(E, N, zone, latBand(utmInverse(E, N, zone, south).lat), digits);
  }
  /** Compass heading, degrees clockwise from GRID north, of a game yaw (0 looks down -z, positive turns left). */
  const headingGrid = (yaw) => ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
  /** The same from TRUE north: what ATAK expects. */
  const headingTrue = (yaw) => (((headingGrid(yaw) + conv) % 360) + 360) % 360;
  /** Range (m) and grid bearing (degrees) between two game positions. */
  function rangeBearing(p, q) {
    const dx = q.x - p.x, dn = -(q.z - p.z);
    return { range: Math.hypot(dx, dn), bearing: ((Math.atan2(dx, dn) * 180) / Math.PI + 360) % 360 };
  }
  return { zone, south, e0, n0, h0, undulation, convergenceDeg: conv, anchorGeo, toUTM, toGeo, toGame, toMGRS, headingGrid, headingTrue, rangeBearing };
}
