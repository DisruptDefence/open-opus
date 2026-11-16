// Sound as data (docs/CONTENT-PACK.md): which sounds a threat makes comes from the content pack, and the stand-in's
// port and mission sounds are gone from audio.js. The audio module runs here on a stub AudioContext that only counts
// the buffer sources it is asked to start; nobody can hear anything, so how it SOUNDS is for a person to judge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { DEFAULT_PACK } from '../src/content/default.js';
import { mergePacks } from '../src/content/pack.js';

const src = readFileSync(join(ROOT, 'src', 'audio', 'audio.js'), 'utf8');

test('the stand-in port and mission sounds are gone from audio.js', () => {
  for (const name of ['foghorn', 'halyard', 'container_bang', 'relay_cut', 'relay_hum', 'air_cry', 'objective_all', 'extraction:reached', 'objective:all'])
    assert.equal(src.includes(name), false, name + ' is still in audio.js');
  assert.match(src, /ln\('objective:done'/);
  assert.match(src, /ee === 'complete' && Zo\(\)/);
  assert.equal(/=== 'ground' \? 'ground_(fire|die)'/.test(src), false, 'a threat sound is chosen by class in code');
});

test('the default pack names the sounds audio.js used to choose by class', () => {
  const t = DEFAULT_PACK.sounds.threats;
  assert.deepEqual(t.ground, { fire: 'ground_fire', step: 'ground_step', die: 'ground_die', loop: 'ground_servo', voice: 1 });
  assert.deepEqual(t.air, { fire: 'air_fire', die: 'air_die', loop: 'air_rotor', voice: 0 });
});

// --- the module on a stub AudioContext --------------------------------------------------------------------------
let sources = 0;
const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, cancelAndHoldAtTime() {}, setValueCurveAtTime() {} });
const node = (extra = {}) => new Proxy({ connect(n) { return n; }, disconnect() {}, start() {}, stop() {}, addEventListener() {}, ...extra }, {
  get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol' || k === 'then') return undefined; return (t[k] = param()); },
  set(t, k, v) { t[k] = v; return true; },
});
class StubContext {
  constructor() { this.state = 'running'; this.currentTime = 1; this.sampleRate = 48000; this.destination = node(); this.listener = node(); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
  createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  createBufferSource() { sources++; return node({ buffer: null, loop: false, playbackRate: param(), onended: null }); }
  decodeAudioData() { return Promise.reject(new Error('stub')); }
}
for (const m of ['createGain', 'createDynamicsCompressor', 'createBiquadFilter', 'createPanner', 'createConvolver', 'createStereoPanner', 'createDelay', 'createWaveShaper', 'createAnalyser', 'createOscillator', 'createChannelMerger', 'createChannelSplitter', 'createConstantSource'])
  StubContext.prototype[m] = function () { return node(); };

async function audioFor(content) {
  const handlers = new Map();
  const events = { on: (n, f) => { (handlers.get(n) || handlers.set(n, []).get(n)).push(f); }, emit: (n, e) => (handlers.get(n) || []).forEach((f) => f(e)) };
  const G = { events, content, camera: null, enemies: { list: [] }, level: {}, player: { pos: { x: 0, y: 0, z: 0 } } };
  const { createAudio } = await import('../src/audio/audio.js');
  const audio = await createAudio(G);
  return { audio, events, G };
}

test('an enemy shot plays a sound by the pack entry of its archetype, else its class, else nothing', async (t) => {
  const had = { window: globalThis.window, document: globalThis.document };
  globalThis.window = { AudioContext: StubContext, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false };
  t.after(() => { for (const k of ['window', 'document']) { if (had[k] === undefined) delete globalThis[k]; else globalThis[k] = had[k]; } });
  const pack = mergePacks(DEFAULT_PACK, { sounds: { threats: { sentry: { fire: 'ground_fire' }, mute: {} } } });
  const { audio, events } = await audioFor(pack);
  assert.ok(!audio.silent, 'the stub context did not start the audio module');
  const shot = (archetype, type) => { const before = sources; events.emit('enemy:fire', { enemy: { archetype, type, alive: true, pos: { x: 3, y: 0, z: 3 } }, type, pos: { x: 3, y: 0, z: 3 } }); return sources - before; };
  assert.equal(shot('sentry', 'ground'), 1, 'sentry: its own entry');
  assert.equal(shot('crawler', 'ground'), 1, 'crawler: the ground class entry');
  assert.equal(shot('quadcopter', 'air'), 1, 'quadcopter: the air class entry');
  assert.equal(shot('mute', 'ground'), 0, 'an archetype whose entry has no fire plays nothing');
  assert.equal(shot('unknown', 'naval'), 0, 'no entry at all plays nothing');
});
