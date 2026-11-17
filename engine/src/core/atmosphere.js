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
export function atmosphereAt({ lat = 46.8, day = 172, hour = 10, haze = 0.5, cloud = 0.4, convergenceDeg = 0, look = null } = {}) {
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
  const out = { hour, sun, night, cloud, sunDir: { x: dir[0], y: dir[1], z: dir[2] }, sunColor, sunIntensity: intensity, zenith, horizon: grey(horizon), horizonAway: grey(away), fog: grey(fog) };
  if (!look) return out;
  out.sunIntensity *= look.sun; out.sunColor = out.sunColor.map((v, i) => v * look.sunTint[i]);
  const tone = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v, i) => Math.max(0, l + (v - l) * look.skySat) * look.skyTint[i]); };
  for (const k of ['zenith', 'horizon', 'horizonAway', 'fog']) out[k] = tone(out[k]);
  out.look = look;
  return out;
}

/** The look: the picture's grade, light and haze as data. Every key is optional; these are the neutral defaults. */
export const DEFAULT_LOOK = {
  exposure: 1, // multiplies the renderer's manual exposure
  key: 0.12, minExposure: 0.6, maxExposure: 2, // eye adaptation
  env: 1, // sky light on shaded surfaces (multiplies the renderer's base environment intensity)
  sun: 1, // multiplies the sun's intensity
  sunTint: [1, 1, 1], // multiplies the sun's colour
  skySat: 1, // saturation of zenith, horizon, horizonAway and fog (0 grey .. 1 as computed .. >1 more)
  skyTint: [1, 1, 1], // multiplies zenith, horizon, horizonAway and fog
  bounce: [0, 0, 0], // linear colour x intensity of light arriving from below (ground bounce); 0 = none
  shadows: [1, 1, 1], highlights: [1, 1, 1], // split tone multipliers
  lift: [0.004, 0.004, 0.004], // added to blacks after `gain`
  gain: 0.992, // multiplies before lift
  curve: 0.22, // strength of the S-curve
  saturation: 1, // multiplies the gameplay-driven saturation
  vignette: 0.12, ca: 0.0004, grain: 0.02, sharpen: 0.3,
  bloom: 0.065, agx: 0.25,
  farHaze: 0.42, fogSigma: 0.0034, // volumetric haze
};

const copyLook = (o) => { const r = {}; for (const k in o) r[k] = Array.isArray(o[k]) ? o[k].slice() : o[k]; return r; };

/** DEFAULT_LOOK with each layer laid over it (later wins). Bad layers, unknown keys and bad values are ignored. */
export function resolveLook(...layers) {
  const out = copyLook(DEFAULT_LOOK);
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    for (const k of Object.keys(DEFAULT_LOOK)) {
      if (!Object.prototype.hasOwnProperty.call(layer, k)) continue;
      const v = layer[k];
      if (Array.isArray(DEFAULT_LOOK[k])) {
        if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x !== 'boolean' && x !== null && x !== '' && Number.isFinite(Number(x)))) out[k] = v.map(Number);
      } else if (typeof v !== 'boolean' && v !== null && v !== '' && Number.isFinite(Number(v)) && (typeof v === 'number' || typeof v === 'string')) out[k] = Number(v);
    }
  }
  return out;
}

/** The host's `look` switch: a JSON object string. Anything else (empty, undefined, bad JSON, not an object) gives null; bad JSON warns once. */
let warnedLook = false;
export function parseLookParam(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) {
    if (!warnedLook) { warnedLook = true; console.warn('[look] the look switch is not valid JSON, ignored: ' + e.message); }
    return null;
  }
}

/** Time of day, day of year, haze, cloud and wet: a host switch wins over the scene's `ambience`, which wins over the default. '' counts as unset. */
export function ambienceOf(params = {}, sceneAmbience = null) {
  const amb = sceneAmbience || {}, set = (v) => v !== undefined && v !== null && v !== '';
  const pick = (k, d) => { const v = set(params[k]) ? params[k] : set(amb[k]) ? amb[k] : d; return +v; };
  return { tod: pick('tod', 10), day: pick('day', 172), haze: pick('haze', 0.4), cloud: pick('cloud', 0.4), wet: pick('wet', 0) };
}
