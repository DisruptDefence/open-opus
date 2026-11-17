// The rugged case is decoration only: every added element is hidden from assistive tech, cannot take focus and cannot take a touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHONE_HTML } from '../host.js';

const css = readFileSync(new URL('../phone.css', import.meta.url), 'utf8');

test('case parts are aria-hidden, unfocusable <i> elements, at most 18', () => {
  const deco = PHONE_HTML.match(/<i class="opus-phone-deco[^>]*>/g) || [];
  assert.ok(deco.length >= 10 && deco.length <= 18, `${deco.length} decorative elements`);
  for (const d of deco) { assert.match(d, /aria-hidden="true"/); assert.doesNotMatch(d, /tabindex|href|role/); }
  assert.match(PHONE_HTML, /<div class="opus-phone-glass"><\/div>/); // the glass is untouched
});

test('case parts and the glass overlays never intercept input', () => {
  assert.match(css, /\.opus-phone-deco \{[^}]*pointer-events: none/);
  for (const sel of ['.opus-phone-glass::before', '.opus-phone-glass::after']) {
    const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, sel);
    assert.match(css.slice(i, css.indexOf('}', i)), /pointer-events: none/);
  }
  const o = css.match(/\.opus-phone-glass::after \{[^}]*opacity: ([\d.]+)/); assert.ok(o && Number(o[1]) <= 0.06);
});

test('the glass keeps its aspect ratio and the raise rule stays', () => {
  assert.match(css, /\.opus-phone-glass \{[^}]*aspect-ratio: 1068 \/ 476/);
  assert.match(css, /\.opus-phone\.on \{ transform: none; \}/);
  assert.match(css, /\.opus-phone\[hidden\] \{ display: none; \}/);
});

test('no filter, backdrop-filter or mask on the phone or the glass (a live stream repaints under them)', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  for (const [, sel, body] of rules) {
    const s = sel.trim();
    if (/^\.opus-phone(\.on)?(::before|::after)?$/.test(s) || /\.opus-phone-glass/.test(s) || /\.opus-stream|\.opus-placeholder/.test(s))
      assert.doesNotMatch(body, /(^|[\s;])(filter|backdrop-filter|-webkit-backdrop-filter|mask|mask-image|-webkit-mask-image)\s*:/, s);
  }
  assert.match(css, /\.opus-phone-deco\.shade \{[^}]*filter: blur/); // the one blur: a static element behind the phone
});
