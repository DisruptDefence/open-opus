// The phone host on a page: the phone's frame, the key that raises it, the button for touch, and the frame loop
// that feeds the screen. Everything it does to the game goes through the world API (hold, release, snapshot, geo,
// overhead), by way of core.js; what is on the glass belongs to the PhoneScreen it is given.
//
//   const phone = createPhoneHost(world, createPlaceholderScreen(), { mount: document.getElementById('app') });
//   phone.on((action, data) => ...)      what was done on the phone (docs/WORLD-API.md, "PhoneScreen")
//
// The page links phone/phone.css. Call it after world.ready().
import { createPhoneCore } from './core.js';

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

// Purely decorative parts of the rugged case (phone.css draws them): the cast shadow, the moulded face, four corner guards, two side keys, the cable port and
// its cable, the lanyard lug and its webbing, the mount hinge and its two knuckles. Hidden from assistive tech, never focusable, never hit.
const DECO = ['shade', 'face', 'guard tl', 'guard tr', 'guard bl', 'guard br', 'key vol', 'key pwr', 'port', 'cable', 'lanyard', 'strap', 'hinge', 'knuckle l', 'knuckle r']
  .map((c) => `<i class="opus-phone-deco ${c}" aria-hidden="true"></i>`).join('');
// The phone's markup (the picture tool phone/tools/case-shot.mjs builds the same DOM from this).
export const PHONE_HTML = DECO
  + '<div class="opus-phone-bar"><button type="button" data-m="pause">Paused</button><button type="button" data-m="slow">Slow motion</button></div>'
  + '<div class="opus-phone-body"><i class="opus-phone-cam" aria-hidden="true"></i><div class="opus-phone-glass"></div></div>';

export function createPhoneHost(world, screen, { mount = document.body, storage = safeStorage(), keys = true } = {}) {
  const frame = document.createElement('div'), launch = document.createElement('button');
  frame.className = 'opus-phone'; frame.hidden = true;
  frame.innerHTML = PHONE_HTML;
  launch.className = 'opus-phone-launch'; launch.type = 'button'; launch.hidden = true;
  launch.innerHTML = '<span></span><kbd>T</kbd>'; launch.firstChild.textContent = screen.title || 'Phone'; launch.title = `Raise the phone (T)`;
  mount.append(frame, launch);
  const bar = frame.querySelector('.opus-phone-bar'), glass = frame.querySelector('.opus-phone-glass');
  const extras = [], label = launch.firstChild;
  for (const b of screen.buttons || []) {
    const e = document.createElement('button'); e.type = 'button'; e.textContent = b.label; e.title = b.title || ''; e.className = 'extra';
    e.addEventListener('click', () => b.run()); bar.appendChild(e); extras.push([b, e]);
  }

  let hideTimer = 0;
  const sync = () => {
    const open = core.open;
    mount.classList.toggle('opus-phone-open', open);
    for (const b of bar.querySelectorAll('[data-m]')) b.classList.toggle('on', b.dataset.m === core.mode());
    clearTimeout(hideTimer);
    if (open) { frame.hidden = false; requestAnimationFrame(() => frame.classList.add('on')); }
    else { frame.classList.remove('on'); hideTimer = setTimeout(() => { if (!core.open) frame.hidden = true; }, 340); }
  };
  const core = createPhoneCore(world, screen, { storage, onChange: sync });
  screen.onAspect = (w, h) => { glass.style.aspectRatio = w && h ? `${w} / ${h}` : ''; }; // a screen may give the glass its own shape
  screen.mount(glass, core.context);

  bar.addEventListener('click', (e) => { const m = e.target.dataset && e.target.dataset.m; if (m) core.setMode(m); });
  launch.addEventListener('click', () => core.toggle());
  // The phone's own keys. Capture phase, so a key the phone used reaches nothing else on the page.
  const onKey = (e) => {
    const typing = !!(e.target && TYPING.test(e.target.tagName || ''));
    if (core.key({ code: e.code, key: e.key, typing, repeat: e.repeat, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey })) { e.preventDefault(); e.stopPropagation(); }
  };
  if (keys) window.addEventListener('keydown', onKey, true);

  let raf = 0;
  const tick = () => {
    launch.hidden = !(core.open || core.canRaise()); core.tick();
    const title = screen.title || 'Phone'; if (label.textContent !== title) label.textContent = title; // the screen behind the glass may change
    for (const [b, e] of extras) e.hidden = b.shown ? !b.shown() : false;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    raise: core.raise, lower: core.lower, toggle: core.toggle, setMode: core.setMode, on: core.on,
    get open() { return core.open; },
    screen,
    remove() { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey, true); if (core.open) core.lower(); frame.remove(); launch.remove(); },
  };
}

function safeStorage() { try { return globalThis.localStorage || null; } catch { return null; } } // a page opened from a file may have none
