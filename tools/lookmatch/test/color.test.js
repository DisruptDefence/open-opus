import test from 'node:test';
import assert from 'node:assert/strict';
import { srgb8ToLab, labToHex, labToLinear, linearToSrgb8, lstarToY } from '../lib/color.mjs';

const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m}: ${a} vs ${b}`);
test('white, black and a known red convert to the standard Lab values', () => {
  const w = srgb8ToLab(255, 255, 255); near(w[0], 100, 0.05, 'L white'); near(w[1], 0, 0.05, 'a white'); near(w[2], 0, 0.05, 'b white');
  const k = srgb8ToLab(0, 0, 0); near(k[0], 0, 0.01, 'L black');
  const r = srgb8ToLab(255, 0, 0); near(r[0], 53.24, 0.1, 'L red'); near(r[1], 80.09, 0.1, 'a red'); near(r[2], 67.2, 0.1, 'b red');
});
test('mid grey 119 is L* 50 and the Lab round trip returns the bytes', () => {
  near(srgb8ToLab(119, 119, 119)[0], 50, 0.2, 'L mid grey');
  assert.equal(labToHex(...srgb8ToLab(200, 100, 50)), '#c86432');
  assert.equal(linearToSrgb8(labToLinear(...srgb8ToLab(10, 20, 30))[1]), 20);
});
test('L* to luminance is the CIE curve', () => { near(lstarToY(100), 1, 1e-9, '100'); near(lstarToY(50), 0.1842, 0.001, '50'); near(lstarToY(0), 0, 1e-9, '0'); });
