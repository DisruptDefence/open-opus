// Voices of threats that are people, synthesised: our own formant synthesiser (a glottal pulse through three
// resonators that move from vowel to vowel, breath noise, a few plosive bursts), no recording of anyone. Barks:
//
//   voice_pain     a short grunt or wince when hit          4 variants, 0.25-0.45 s
//   voice_death    a falling, breathy cry when killed       3 variants, 0.8-1.1 s
//   voice_contact  a shouted two-syllable call-out ("con-tact") when it raises the alarm   3 variants
//
// An archetype says which barks it uses in its sound entry (content pack `sounds.threats.<id>`: `pain`, `death`,
// `callout`). Each actor has its own pitch (from its id), says one thing at a time (0.85 s apart, a death always),
// and does not say the same variant twice running. How they sound is for a person to judge.

const TAU = Math.PI * 2;
/** A biquad band-pass whose centre can move, run over `x` in place into `out` (added, scaled by `gain`). */
function resonate(x, out, sr, track, bw, gain) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, a1 = 0, a2 = 0, a0 = 1;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const f = Math.min(sr * 0.45, Math.max(60, track(i / sr))), w = (TAU * f) / sr, al = Math.sin(w) / (2 * (f / bw));
      a0 = 1 + al; b0 = al / a0; a1 = (-2 * Math.cos(w)) / a0; a2 = (1 - al) / a0;
    }
    const y = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] += y * gain;
  }
}
/** Piecewise-linear value over time from [[t, v], ...]. */
const curve = (pts) => (t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0); }
  return pts[pts.length - 1][1];
};
/**
 * One bark. `s`: { dur, f0 [[t, Hz]], vowels [[t, F1, F2, F3]], amp [[t, 0..1]], voiced [[t, 0..1]], breath, bursts
 * [[t, length, Hz]] }. Returns mono samples at `sr`.
 */
export function synthBark(sr, rng, s) {
  const n = Math.max(1, Math.round(s.dur * sr)), src = new Float32Array(n), noise = new Float32Array(n), out = new Float32Array(n);
  const f0 = curve(s.f0), amp = curve(s.amp), voiced = curve(s.voiced || [[0, 1]]);
  let ph = 0, prev = 0, jit = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 63) === 0) jit = (rng() - 0.5) * (s.jitter ?? 0.03);
    const f = f0(t) * (1 + 0.012 * Math.sin(TAU * 5.3 * t) + jit);
    ph += f / sr; if (ph >= 1) ph -= 1;
    const g = ph < 0.6 ? Math.sin((Math.PI * ph) / 0.6) ** 2 : 0; // the glottal pulse, then its derivative (lip radiation)
    src[i] = (g - prev) * 6 * voiced(t) * amp(t); prev = g;
    noise[i] = (rng() * 2 - 1) * (s.breath ?? 0.1) * amp(t);
  }
  const v = s.vowels, F = (k) => curve(v.map((r) => [r[0], r[k]]));
  const ex = new Float32Array(n); for (let i = 0; i < n; i++) ex[i] = src[i] + noise[i];
  resonate(ex, out, sr, F(1), 90, 1);
  resonate(ex, out, sr, F(2), 120, 0.55);
  resonate(ex, out, sr, F(3), 180, 0.3);
  for (const [t0, len, hz] of s.bursts || []) { // plosives: a short burst of filtered noise
    const a = Math.round(t0 * sr), m = Math.round(len * sr), b = new Float32Array(m);
    for (let i = 0; i < m; i++) b[i] = (rng() * 2 - 1) * Math.exp((-4 * i) / m);
    const o = new Float32Array(m); resonate(b, o, sr, () => hz, hz * 0.5, 1);
    for (let i = 0; i < m && a + i < n; i++) out[a + i] += o[i] * 0.6;
  }
  for (let i = 0; i < Math.min(n, 64); i++) { out[i] *= i / 64; out[n - 1 - i] *= i / 64; } // no clicks
  return out;
}

// vowels, as formant triples (Hz), for a man's voice; a variant moves them a little
const AH = [760, 1230, 2500], UH = [560, 1100, 2400], MM = [280, 900, 2200], O = [580, 900, 2450], AE = [680, 1650, 2550], EH = [520, 1750, 2500];
const at = (t, v, k = 1) => [t, v[0] * k, v[1] * k, v[2] * k];
const SHAPES = {
  voice_pain: (r, k, p) => { const d = 0.25 + r() * 0.2; return { dur: d, f0: [[0, 165 * p], [0.05, 150 * p], [d, 105 * p]], vowels: [at(0, r() < 0.5 ? AH : UH, k), at(d * 0.6, UH, k), at(d, MM, k)], amp: [[0, 0], [0.012, 1], [d * 0.5, 0.7], [d, 0]], breath: 0.18 }; },
  voice_death: (r, k, p) => { const d = 0.8 + r() * 0.3; return { dur: d, f0: [[0, 150 * p], [0.12, 160 * p], [d * 0.7, 105 * p], [d, 80 * p]], vowels: [at(0, AH, k), at(d * 0.5, AH, k * 0.97), at(d, UH, k)], amp: [[0, 0], [0.03, 1], [d * 0.6, 0.6], [d, 0]], voiced: [[0, 1], [d * 0.75, 0.8], [d, 0.3]], breath: 0.25, jitter: 0.08 }; },
  voice_contact: (r, k, p) => {
    const a = 0.03, b = a + 0.12, c = b + 0.07, d = c + 0.03, e = d + 0.15, end = e + 0.06;
    return {
      dur: end, f0: [[0, 190 * p], [b, 210 * p], [c, 175 * p], [d, 185 * p], [e, 150 * p], [end, 140 * p]],
      vowels: [at(0, O, k), at(a, O, k), at(b - 0.02, O, k), at(b, MM, k), at(c, MM, k), at(d, AE, k), at(e - 0.03, AE, k), at(e, EH, k)],
      amp: [[0, 0], [a, 1], [b, 0.9], [b + 0.01, 0.35], [c, 0.3], [c + 0.005, 0], [d, 0.95], [e - 0.02, 0.8], [e, 0], [end, 0]],
      voiced: [[0, 0], [a - 0.005, 0], [a, 1], [c, 1], [c + 0.005, 0], [d, 0], [d + 0.005, 1], [e, 1], [e + 0.005, 0]],
      bursts: [[0, 0.03, 2600], [c, 0.03, 4200], [e, 0.03, 2400], [e + 0.03, 0.03, 4400]], breath: 0.12,
    };
  },
};
/** The sound table entries (audio.js `Go`): generated on first use, per variant. */
export const VOICE_SOUNDS = Object.fromEntries(Object.entries(SHAPES).map(([name, shape]) => [name, {
  gen: (sr, rng, variant) => synthBark(sr, rng, shape(rng, 0.94 + ((variant * 0.37) % 1) * 0.12, 0.95 + ((variant * 0.61) % 1) * 0.1)),
  n: name === 'voice_pain' ? 4 : 3, sr: 32000, peak: name === 'voice_death' ? 0.75 : 0.7, bus: 'world', max: 3, pri: 6, ref: 6, roll: 0.9,
}]));

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
/** Listen to the threats and let the people among them speak, through the audio module's `play`. */
export function attachVoices(G, audio) {
  const actors = new Map(), GAP = 0.85;
  const soundsOf = (e) => { const t = (G.content && G.content.sounds && G.content.sounds.threats) || {}; return (e && (t[e.archetype] || t[e.type])) || {}; };
  const now = () => (G.time && Number.isFinite(G.time.t) ? G.time.t : 0);
  function say(e, kind, { force = false, gain = 1 } = {}) {
    const name = soundsOf(e)[kind], def = name && VOICE_SOUNDS[name]; if (!def || !e) return false;
    let a = actors.get(e.id); if (!a) actors.set(e.id, (a = { until: -1, last: {}, pitch: 0.9 + hash(e.id) * 0.22 }));
    const t = now(); if (!force && t < a.until) return false;
    let v = Math.floor(Math.random() * def.n); if (def.n > 1 && v === a.last[name]) v = (v + 1) % def.n;
    a.last[name] = v; a.until = t + GAP;
    try { audio.play(name, { pos: e.pos, variant: v, pitch: a.pitch, gain }); } catch { /* sound is optional */ }
    return true;
  }
  const on = (n, f) => G.events && G.events.on && G.events.on(n, (ev) => { try { f(ev || {}); } catch { /* sound is optional */ } });
  on('enemy:hit', (ev) => { if (ev.enemy && ev.enemy.alive && ev.enemy.health > 0) say(ev.enemy, 'pain'); });
  on('enemy:killed', (ev) => say(ev.enemy, 'death', { force: true }));
  on('enemy:alert', (ev) => say(ev.enemy, 'callout', { gain: 0.9 }));
  on('enemy:despawn', (ev) => ev.enemy && actors.delete(ev.enemy.id));
  return { say, actors };
}
