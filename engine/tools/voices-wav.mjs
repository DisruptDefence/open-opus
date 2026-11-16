// Writes every synthesised voice bark (src/audio/voice.js), every variant, at three actor pitches, as WAV files, so a
// person can listen to them without starting the engine:   node engine/tools/voices-wav.mjs outDir
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_SOUNDS } from '../src/audio/voice.js';
import { createRng } from '../src/shared/lifted.js';

const out = process.argv[2] || '.'; mkdirSync(out, { recursive: true });
function wav(samples, sr) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let peak = 0; for (const s of samples) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((samples[i] / (peak || 1)) * 0.8 * 32767), 44 + i * 2);
  return b;
}
/** The engine plays an actor's bark faster or slower by its pitch: resample the same way. */
const pitched = (x, k) => { const n = Math.floor(x.length / k), y = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i * k, j = Math.floor(p), f = p - j; y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f; } return y; };
for (const [name, def] of Object.entries(VOICE_SOUNDS))
  for (let v = 0; v < def.n; v++) {
    const x = def.gen(def.sr, createRng(1000 + v), v);
    for (const k of [0.9, 1, 1.12]) { const f = join(out, `${name}-${v}-pitch${k}.wav`); writeFileSync(f, wav(pitched(x, k), def.sr)); console.log(f); }
  }
