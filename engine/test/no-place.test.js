// The guard of docs/plans/GAMEPLAY-PARITY.md item I: no word of the stand-in game's place, mission or one weapon in
// engine/src. The engine holds mechanisms; a place is a scene, a kind is a content pack, a mission is a scenario
// (AGENTS.md rule 3). Every file under engine/src is read whole (comments included) and fails on any word below,
// case-insensitive. Complementary to the builder's own test of place names in tools/ (SCENE-DETAIL item 1): this one
// is about engine/src and about the stand-in's words, not the scene's.
//
// `PENDING` lists the words still present in a file because the item that clears them has not landed. The test
// also fails when a listed word is already gone from its file, so the entry must be deleted as the item lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './helpers.js';

export const WORDS = ['saltline', 'harbormaster', 'foghorn', 'halyard', 'quay', 'berth', 'relay_', 'PAC-9', 'gull', 'hound', 'old-quebec', 'quebec'];

// word -> [file under engine/src, the item that clears it]
const PENDING = {
  'foghorn': [['audio/audio.js', 'E (sound as data, branch gp-data)']],
  'halyard': [['audio/audio.js', 'E (sound as data, branch gp-data)']],
  'relay_': [['audio/audio.js', 'E (sound as data, branch gp-data)']],
  'gull': [['audio/audio.js', 'E (sound as data, branch gp-data)']],
  'berth': [['weapons/weapon.js', 'D (weapon as data, branch gp-data)']],
  'PAC-9': [['weapons/weapon.js', 'D (weapon as data, branch gp-data)']],
  // a comment about the first scene's format, in a file the mesher owns
  'quebec': [['scene/source.js', 'SCENE-DETAIL item 3 (the reader and the mesher, branch mesher)']],
};

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(js|mjs)$/.test(n) ? [p] : []; });
const src = join(ROOT, 'src');

/** Every [word, file] found in `texts` ({ file: text }). */
export function found(texts, words = WORDS) {
  const out = [];
  for (const [file, text] of Object.entries(texts)) {
    const low = text.toLowerCase();
    for (const w of words) if (low.includes(w.toLowerCase())) out.push([w, file]);
  }
  return out;
}

test('the finder sees a word in a comment, in any case, and ignores clean text', () => {
  assert.deepEqual(found({ 'a.js': '// Berth 4 and the QUAY' }), [['quay', 'a.js'], ['berth', 'a.js']]);
  assert.deepEqual(found({ 'a.js': 'const x = 1; // the player stands up' }), []);
});

test('no engine source names the stand-in\'s place, mission or weapon, except what a later item clears', () => {
  const texts = {};
  for (const f of files(src)) texts[relative(src, f).split('\\').join('/')] = readFileSync(f, 'utf8');
  assert.ok(Object.keys(texts).length > 25, 'the source tree was found');
  const allowed = new Set(Object.entries(PENDING).flatMap(([w, list]) => list.map(([f]) => `${w}|${f}`)));
  const hits = found(texts), hitKeys = new Set(hits.map(([w, f]) => `${w}|${f}`));
  const bad = hits.filter(([w, f]) => !allowed.has(`${w}|${f}`)).map(([w, f]) => `${f}: "${w}"`);
  assert.deepEqual(bad, [], 'words of one place, mission or weapon in the engine');
  const gone = [...allowed].filter((k) => !hitKeys.has(k)).map((k) => k.replace('|', ' in '));
  assert.deepEqual(gone, [], 'PENDING lists words that are already gone: delete those entries');
});
