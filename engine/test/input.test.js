// The part of input.js that can be tested without a DOM: the key map and the touch style sheet. Pointer lock, mouse
// look, the drag fallback, touch and the gamepad need a browser: engine/tools/input-check.mjs drives them there (and
// what it cannot do, a real lock and a real touch screen, is for a person).
import test from 'node:test';
import assert from 'node:assert/strict';
import { h_ } from '../src/input/input.js';
import { TOUCH_CSS } from '../src/input/touch-style.js';

test('the key map binds interact, pause and reload', () => {
  assert.equal(h_.KeyE, 'interact');
  assert.equal(h_.Escape, 'pause');
  assert.equal(h_.KeyR, 'reload');
});

test('movement, fire and turn keys are bound as before', () => {
  assert.deepEqual([h_.KeyW, h_.KeyS, h_.KeyA, h_.KeyD, h_.Space], ['forward', 'back', 'left', 'right', 'jump']);
  assert.equal(h_.Enter, 'fire');
  assert.equal(h_.ArrowLeft, 'turnL');
});

test('the touch style sheet styles every control the module builds', () => {
  for (const cls of ['.touch', '.t-stick', '.t-ring', '.t-nub', '.t-btn', '.t-fire', '.t-ads', '.t-reload', '.t-jump', '.t-interact', '.t-pause'])
    assert.ok(TOUCH_CSS.includes(cls), cls);
  assert.match(TOUCH_CSS, /\.t-fire[^}]*64px/);
  assert.match(TOUCH_CSS, /position: absolute/);
});
