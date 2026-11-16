// The façade bay generator (materials/facades.js): every façade class names a material that exists, with a texture set
// whose generator exists; the shader declares each helper before its first call (GLSL has no forward use); and the
// bay is the size the mesher's layout and the window geometry in the shader both assume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FACADE_FAR_SOUP } from '../src/gen/style.js';
import { Tn as GENERATORS, c3 as SETS, l1 as MATERIALS } from '../src/materials/materials.js';
import { BAY, BAY_SHADER } from '../src/materials/facades.js';
import { FACADE_MATERIAL } from '../src/materials/outdoor.js';

test('every far façade soup names a façade material with a set and a generator', () => {
  for (const key of FACADE_FAR_SOUP) {
    const name = key.split('|')[0], mat = MATERIALS[name];
    assert.ok(mat, `${name} is a material`);
    const set = SETS[mat.set]; assert.ok(set, `${name} has a texture set`);
    assert.ok(GENERATORS[set.fn], `${name} has a generator ${set.fn}`);
  }
  for (const n of FACADE_MATERIAL) assert.ok(MATERIALS[n], `${n} exists`);
});

test('brick, rubble and stone façades are three different looks, stucco another', () => {
  const modes = new Set(['facade_stucco', 'facade_stone', 'facade_rubble', 'facade_brick'].map((n) => SETS[MATERIALS[n].set].p.join(',')));
  assert.equal(modes.size, 4);
  assert.equal(FACADE_FAR_SOUP[3].split('|')[0], 'facade_brick');
});

test('the bay shader declares its helpers before use and ends in surf', () => {
  const at = (name) => BAY_SHADER.indexOf(`void ${name}(`);
  for (const f of ['brickWall', 'stuccoWall', 'stoneWall']) assert.ok(at(f) >= 0 && at(f) < at('surf'), f);
  assert.ok(at('brickWall') < at('stuccoWall'), 'stucco calls brick through the gaps in the render');
  assert.equal(GENERATORS.facade, BAY_SHADER);
  assert.equal((BAY_SHADER.match(/\{/g) || []).length, (BAY_SHADER.match(/\}/g) || []).length, 'balanced braces');
});

test('the bay keeps its size and a sill 0.75 m up', () => {
  assert.deepEqual([BAY.width, BAY.height], SETS.facade_stucco.tile);
  assert.ok(Math.abs(1.6 - 0.85 - BAY.sillAt) < 1e-9, 'window centre 1.6 m, half height 0.85 m');
});
