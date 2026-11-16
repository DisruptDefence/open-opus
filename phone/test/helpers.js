// What the phone's tests share: the engine's own headless world on its test scene (the real simulation and world
// API, no screen), and a screen that records what a host does to it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageSource } from '../../engine/src/scene/source.js';
import { openHeadlessWorld } from '../../engine/test/headless.js';
import { fileFetch } from '../../engine/test/helpers.js';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const json = (...p) => JSON.parse(readFileSync(join(REPO, ...p), 'utf8'));

export async function playingWorld(at = { x: 20, z: 18, heading: 0 }) {
  const h = openHeadlessWorld(packageSource(join(REPO, 'engine', 'scenes', 'test') + '/', fileFetch));
  await h.world.ready();
  h.world.start({ at }); h.run(0.2);
  return h;
}

export function fakeScreen(extra = {}) {
  const calls = [], fns = [];
  return { calls, say: (type, data) => { for (const fn of fns) fn(type, data); },
    open: (v) => calls.push(['open', v]), close: () => calls.push(['close']), update: (v) => calls.push(['update', v]),
    back: () => { calls.push(['back']); return false; }, on: (fn) => { fns.push(fn); return () => {}; }, onCloseRequest: null, ...extra };
}
