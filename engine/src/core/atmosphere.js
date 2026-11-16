// Sun and sky by time of day, as plain numbers (no three.js): where the sun is for a latitude, a day and an hour,
// and what colour the light, the sky and the haze are for that elevation. The renderer takes the result.
const RAD = Math.PI / 180;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Sun elevation and azimuth (degrees; azimuth clockwise from north) for local solar time `hour` (0..24). */
export function sunPosition(latDeg, dayOfYear, hour) {
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365), lat = latDeg * RAD, H = 15 * (hour - 12) * RAD;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H), el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { elevation: el / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

/** Everything the renderer needs for an hour of the day. Directions are game axes: +x east, +y up, -z north. */
export function atmosphereAt({ lat = 46.8, day = 172, hour = 10, haze = 0.5, cloud = 0.4, convergenceDeg = 0 } = {}) {
  const sun = sunPosition(lat, day, hour), night = sun.elevation < 0;
  // below the horizon the "sun" is a low moon on the same bearing, so there is always one shadow-casting light
  const el = Math.max(night ? 14 : 2.5, sun.elevation) * RAD, az = (sun.azimuth - convergenceDeg) * RAD; // grid, not true, north
  const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
  const t = smooth(0, 28, sun.elevation), dusk = smooth(-6, 4, sun.elevation);
  let sunColor = mix([1, 0.5, 0.24], [1, 0.95, 0.86], t), zenith = mix([0.05, 0.08, 0.14], [0.16, 0.36, 0.85], t);
  let horizon = mix([0.95, 0.52, 0.26], [1.05, 1.22, 1.40], t), away = mix([0.16, 0.22, 0.30], [0.80, 1.02, 1.32], t);
  let fog = mix([0.42, 0.45, 0.50], [0.85, 0.97, 1.12], t), intensity = 4 + 6 * t;
  if (dusk < 1) {
    const k = 1 - dusk;
    sunColor = mix(sunColor, [0.45, 0.55, 0.8], k); intensity = intensity * dusk + 0.35 * k;
    zenith = mix(zenith, [0.004, 0.006, 0.014], k); horizon = mix(horizon, [0.02, 0.03, 0.06], k); away = mix(away, [0.012, 0.018, 0.035], k); fog = mix(fog, [0.02, 0.03, 0.05], k);
  }
  // haze greys the far sky and the fog towards each other
  const grey = (c) => mix(c, [0.62, 0.66, 0.70].map((v) => v * (0.08 + 1.3 * dusk * (0.4 + 0.6 * t))), haze * 0.5);
  return { hour, sun, night, cloud, sunDir: { x: dir[0], y: dir[1], z: dir[2] }, sunColor, sunIntensity: intensity, zenith, horizon: grey(horizon), horizonAway: grey(away), fog: grey(fog) };
}
