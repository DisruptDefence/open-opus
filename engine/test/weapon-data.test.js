// The weapon as data (docs/CONTENT-PACK.md). The view model needs WebGL, so this is a source check plus a pure one:
// weapon.js holds no weapon numbers, name or engraving of its own, and the default pack carries exactly the values
// the file held before they moved (read from git history, commit f14d33f: magazine 30, reserve 150, 720 rpm,
// damage 26, range 300). The running weapon's snapshot is checked in a browser (tools/play.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { DEFAULT_PACK } from '../src/content/default.js';
import { mergePacks, validatePack } from '../src/content/pack.js';

const src = readFileSync(join(ROOT, 'src', 'weapons', 'weapon.js'), 'utf8');

test('weapon.js declares none of the old weapon constants and carries no engraving or name text', () => {
  for (const id of ['Gv', 'B_', 'O_', 'H_', 'V_']) assert.equal(new RegExp(`\\b${id}\\b`).test(src), false, id + ' is still in weapon.js');
  for (const text of ['PAC-9', 'OPUS TRAINING ARMOURY', 'OC-9 carbine']) assert.equal(src.includes(text), false, text);
  assert.match(src, /i\.content\.weapons\[/);
  assert.match(src, /i\.content\.loadout\[0\]/);
});

test('the default pack carries the numbers the file had before', () => {
  const w = DEFAULT_PACK.weapons[DEFAULT_PACK.loadout[0]];
  assert.equal(DEFAULT_PACK.loadout[0], 'carbine');
  assert.deepEqual({ magSize: w.magSize, reserve: w.reserve, rpm: w.rpm, damage: w.damage, range: w.range }, { magSize: 30, reserve: 150, rpm: 720, damage: 26, range: 300 });
  assert.equal(w.name, 'Carbine');
});

test('a product changes the weapon in its pack, and the merged pack is valid', () => {
  const p = mergePacks(DEFAULT_PACK, { weapons: { carbine: { ...DEFAULT_PACK.weapons.carbine, name: 'Rifle', magSize: 20, damage: 30 } } });
  assert.deepEqual(validatePack(p), []);
  assert.equal(p.weapons.carbine.magSize, 20);
  assert.equal(DEFAULT_PACK.weapons.carbine.magSize, 30);
});
