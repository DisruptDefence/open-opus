// The phone's first screen, and the one that needs nothing set up: an honest empty phone. It says that no phone is
// connected, shows where the player stands (the scene's true grid reference, position and heading, as the world API
// gives them) and how to connect a real ATAK. It imitates no application. A PhoneScreen (docs/WORLD-API.md).
import { mgrsText } from './core.js';

const pad = (n, w) => String(n).padStart(w, '0');
const dm = (v, pos, neg) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;

/** The lines on the glass for a view (what the host feeds a screen). */
export function placeholderLines(view) {
  const s = view.self;
  return {
    grid: mgrsText(s.mgrs),
    position: `${dm(s.lat, 'N', 'S')}  ${dm(s.lon, 'E', 'W')}`,
    heading: `${pad(Math.round(s.headingTrue) % 360, 3)}°T`,
    height: `${Math.round(s.y)} m`,
    mode: view.mode === 'slow' ? 'the game runs in slow motion' : 'the game is paused',
  };
}

export function createPlaceholderScreen({ hint = 'To use a real ATAK here, run  phone/local/run.sh  on this machine (phone/README.md).' } = {}) {
  const listeners = []; let root = null, last = null;
  const emit = (type, data = {}) => { for (const fn of [...listeners]) fn(type, data); };
  const draw = (view) => {
    last = view;
    if (!root || !view) return;
    const l = placeholderLines(view);
    for (const k of Object.keys(l)) { const e = root.querySelector(`[data-k="${k}"]`); if (e && e.textContent !== l[k]) e.textContent = l[k]; }
  };
  return {
    id: 'placeholder', title: 'Phone', capturesKeys: false, onCloseRequest: null,
    mount(glass) {
      root = document.createElement('div'); root.className = 'opus-placeholder';
      root.innerHTML = '<div class="t">No phone connected</div>'
        + '<div class="g" data-k="grid"></div>'
        + '<div class="r"><span data-k="position"></span></div>'
        + '<div class="r">heading <span data-k="heading"></span> · height <span data-k="height"></span></div>'
        + '<div class="h"></div><div class="m">T, Tab or Esc puts the phone away · <span data-k="mode"></span></div>';
      root.querySelector('.h').textContent = hint;
      glass.appendChild(root); draw(last);
    },
    open(view) { draw(view); emit('open'); },
    close() {},
    back() { return false; },
    update(view) { draw(view); },
    /** What is on the glass, as text: for checks. */
    text: () => (last ? placeholderLines(last) : null),
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
}
