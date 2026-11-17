// The sounds of a door, synthesised: a latch click and a hinge creak. No recording of anything; how they sound is for a person to judge.
// Entries of the sound table (audio.js `Go`), played by world/doors.js through `audio.play(name, { pos, variant, gain })`.
const TAU = Math.PI * 2;
const burst = (out, sr, t0, len, freq, amp, rng) => {
  const n = Math.min(out.length - Math.round(t0 * sr), Math.round(len * sr)); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, env = Math.exp(-t / (len * 0.25)); lp += 0.35 * ((rng() * 2 - 1) - lp); out[Math.round(t0 * sr) + i] += (lp * 0.8 + Math.sin(TAU * freq * t) * 0.5) * env * amp; }
};
export const DOOR_SOUNDS = {
  door_latch: { gen: (sr, rng, v) => { const o = new Float32Array(Math.round(sr * 0.2)), k = 1 + (v % 3) * 0.08; burst(o, sr, 0, 0.05, 1400 * k, 0.5, rng); burst(o, sr, 0.07, 0.07, 700 * k, 0.6, rng); return o; },
    n: 3, sr: 32000, peak: 0.5, bus: 'world', max: 3, pri: 4, ref: 3, roll: 1 },
  door_creak: { gen: (sr, rng, v) => {
    const len = 0.7, o = new Float32Array(Math.round(sr * len)), f0 = 150 + v * 25; let ph = 0, lp = 0;
    for (let i = 0; i < o.length; i++) {
      const t = i / sr, f = f0 * (1 + 0.5 * t / len) * (1 + 0.04 * Math.sin(TAU * 9 * t)), env = Math.sin(Math.PI * Math.min(1, t / len)) ** 1.5; ph += TAU * f / sr;
      lp += 0.3 * ((rng() * 2 - 1) - lp); const saw = (ph / TAU) % 1 * 2 - 1;
      o[i] = (saw * 0.35 + lp * 0.6) * env * (0.5 + 0.5 * Math.sin(TAU * 37 * t)) * 0.5;
    }
    return o; }, n: 3, sr: 32000, peak: 0.35, bus: 'world', max: 2, pri: 3, ref: 3, roll: 1 },
};
