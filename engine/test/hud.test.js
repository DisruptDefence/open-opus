// The HUD's arithmetic (src/hud/model.js), under Node. What is drawn is checked by tools/hud-shot.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNullHud } from '../src/hud/hooks.js';
import {
  tapeOffset, markerBearing, edgeClamp, crosshairGap, damageArcAngle, ammoCue, healthSegments, typedChars, hitmarkerLook,
  addArc, arcAlpha, pushFeed, compassLetter, headingOf, markerDistance,
} from '../src/hud/model.js';

const at = (x, z, yaw = 0) => ({ pos: { x, z }, yaw });

test('the crosshair gap is the weapon spread in pixels at this field of view', () => {
  assert.equal(crosshairGap(0.0125, 74, 540, false), 8.5);
  assert.equal(crosshairGap(0.0125, 74, 540, true), 18.5);
  assert.equal(crosshairGap(0, 74, 540, false), 4, 'never tighter than 4 px');
  assert.equal(crosshairGap(0.5, 74, 540, true), 70, 'never wider than 70 px');
  assert.ok(crosshairGap(0.0125, 52, 540, false) > 8.5, 'a narrower view makes the same spread wider on screen');
});

test('the ammunition cue: reloading, reload, empty, low, or nothing', () => {
  assert.equal(ammoCue(8, 30, 150, 'idle'), 'lowAmmo');
  assert.equal(ammoCue(9, 30, 150, 'idle'), '');
  assert.equal(ammoCue(0, 30, 150, 'idle'), 'reload');
  assert.equal(ammoCue(0, 30, 0, 'idle'), 'empty');
  assert.equal(ammoCue(5, 30, 150, 'reloading'), 'reloading');
  assert.equal(ammoCue(0, 30, 150, 'reloading'), 'reloading');
  assert.equal(ammoCue(undefined, undefined, undefined, 'idle'), '', 'a weapon without numbers says nothing');
  assert.equal(ammoCue(2, 10, 0, 'idle'), 'lowAmmo', '27 percent of a small magazine');
});

test('health segments: ten, and any health left lights one', () => {
  assert.equal(healthSegments(100, 100), 10);
  assert.equal(healthSegments(21, 100), 3);
  assert.equal(healthSegments(0.4, 100), 1);
  assert.equal(healthSegments(0, 100), 0);
  assert.equal(healthSegments(50, 200), 3);
  assert.equal(healthSegments(-5, 100), 0);
});

test('the bearing of a mark is relative to where the player faces', () => {
  assert.equal(markerBearing(at(0, 0, 0), { x: 10, z: 0 }), 90);
  assert.equal(markerBearing(at(0, 0, 0), { x: -10, z: 0 }), -90);
  assert.equal(markerBearing(at(0, 0, 0), { x: 0, z: -10 }), 0);
  assert.equal(Math.abs(markerBearing(at(0, 0, 0), { x: 0, z: 10 })), 180);
  assert.ok(Math.abs(markerBearing(at(0, 0, -Math.PI / 2), { x: 10, z: 0 })) < 1e-9, 'facing east (yaw -90 degrees), a mark due east is ahead');
  assert.equal(headingOf(-Math.PI / 2), 90);
});

test('the damage arc points at the shooter', () => {
  assert.equal(damageArcAngle(at(0, 0, 0), { x: 0, z: -20 }), 0);
  assert.ok(Math.abs(damageArcAngle(at(0, 0, 0), { x: 20, z: 0 }) - Math.PI / 2) < 1e-9, 'to the right');
  assert.ok(Math.abs(Math.abs(damageArcAngle(at(0, 0, 0), { x: 0, z: 20 })) - Math.PI) < 1e-9, 'behind');
  assert.ok(Math.abs(damageArcAngle(at(0, 0, -Math.PI / 2), { x: 20, z: 0 })) < 1e-9, 'turning to face the shooter puts the arc ahead');
});

test('a tag inside the box stays; outside or behind it sticks to the edge of the box', () => {
  assert.deepEqual(edgeClamp(0.5, 0.2, false), { x: 0.5, y: 0.2, offscreen: false });
  const far = edgeClamp(2, 0, false); assert.equal(far.x, 0.9); assert.equal(far.y, 0); assert.equal(far.offscreen, true);
  const tall = edgeClamp(0, -3, false); assert.equal(tall.y, -0.82); assert.equal(tall.offscreen, true);
  const back = edgeClamp(0.1, 0.1, true);
  assert.equal(back.offscreen, true); assert.ok(back.x < 0 && back.y < 0, 'mirrored: a point behind projects on the wrong side');
  assert.ok(Math.abs(back.x) <= 0.9 && Math.abs(back.y) <= 0.82 && (Math.abs(back.x) === 0.9 || Math.abs(back.y) === 0.82), 'on the edge of the box');
  assert.deepEqual(edgeClamp(0, 0, true), { x: 0, y: -0.82, offscreen: true }, 'straight behind goes to the bottom');
});

test('the compass tape puts the heading in the middle of its window', () => {
  const x = (deg) => tapeOffset(deg, 560) + (deg + 90) * 4; // where `deg` is drawn in the window
  assert.equal(x(0), 280); assert.equal(x(123), 280);
  assert.equal(tapeOffset(10, 560) - tapeOffset(0, 560), -40, '4 px a degree, the tape moving left as the heading grows');
  assert.equal(compassLetter(0), 'N'); assert.equal(compassLetter(135), 'SE'); assert.equal(compassLetter(360), 'N'); assert.equal(compassLetter(15), '');
  assert.equal(compassLetter(90, 'A B C D E F G H'.split(' ')), 'C', 'letters come from the pack');
});

test('typing, the hit marker, the damage arcs and the kill feed run on the numbers of the plan', () => {
  assert.equal(typedChars(0, 46, 20), 0); assert.equal(typedChars(1, 46, 20), 20); assert.equal(typedChars(0.5, 58, 100), 29);
  assert.deepEqual([hitmarkerLook({ killed: true }).kind, hitmarkerLook({ killed: true }).life], ['kill', 0.42]);
  assert.deepEqual([hitmarkerLook({ weak: true }).kind, hitmarkerLook({ weak: true }).life], ['weak', 0.24]);
  assert.equal(hitmarkerLook({}).kind, 'hit');
  assert.equal(hitmarkerLook({ weak: true }, 0).scale, 1.5); assert.equal(hitmarkerLook({}, 0).scale, 1.15); assert.equal(hitmarkerLook({}, 0.24).scale, 1);
  const arcs = []; for (let i = 0; i < 4; i++) addArc(arcs, i, i);
  const fifth = addArc(arcs, 9, 4);
  assert.equal(arcs.length, 4); assert.equal(arcs[0], fifth, 'the fifth hit reuses the oldest');
  assert.equal(arcAlpha({ born: 0 }, 0.5), 1); assert.equal(arcAlpha({ born: 0 }, 1.5), 0); assert.ok(Math.abs(arcAlpha({ born: 0 }, 1.2) - 0.5) < 1e-9);
  const feed = []; for (let i = 0; i < 6; i++) pushFeed(feed, i);
  assert.deepEqual(feed, [2, 3, 4, 5], 'at most 4 lines');
  assert.equal(markerDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: -4 }), 5);
});

test('the null HUD answers every hook the director and the engine call', () => {
  const hud = createNullHud();
  for (const k of ['show', 'setObjective', 'setProgress', 'setPrompt', 'message', 'warn', 'radio', 'clearRadio', 'feed', 'hitmarker', 'reset', 'update']) assert.equal(typeof hud[k], 'function', k);
  assert.equal(hud.setRelays, undefined, 'the stand-in mission\'s hook is gone');
});
