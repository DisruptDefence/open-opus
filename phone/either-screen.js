// Two screens behind one glass: the first whenever it says it is available, otherwise the second. This is how the
// phone shows a real ATAK as soon as the local gateway answers, and the placeholder until then — and again if the
// gateway goes away. It is itself a PhoneScreen, so the host does not know there are two.
//
//   eitherScreen(createStreamScreen(), createPlaceholderScreen())     the first needs available(): boolean
export function eitherScreen(first, second) {
  const listeners = []; let layers = null, shown = null, isOpen = false, last = null;
  const active = () => (first.available() ? first : second);
  const emit = (type, data) => { for (const fn of [...listeners]) fn(type, data); };
  // Which screen is up can change at any moment (the gateway came or went): move the open state across.
  const settle = () => {
    const a = active();
    if (a === shown) return a;
    if (shown && isOpen) shown.close();
    shown = a;
    if (layers) { layers[0].hidden = a !== first; layers[1].hidden = a !== second; }
    if (isOpen) a.open(last);
    if (a === first && aspect) screen.onAspect && screen.onAspect(aspect[0], aspect[1]); else if (screen.onAspect) screen.onAspect(null);
    emit('screen', { id: a.id });
    return a;
  };
  let aspect = null;
  first.onAspect = (w, h) => { aspect = [w, h]; if (shown === first && screen.onAspect) screen.onAspect(w, h); };
  for (const s of [first, second]) { s.on((type, data) => { emit(type, data); if (type === 'status') settle(); }); s.onCloseRequest = () => screen.onCloseRequest && screen.onCloseRequest(); }
  const screen = {
    id: 'either', onCloseRequest: null, onAspect: null,
    get title() { return active().title; },
    get capturesKeys() { return !!active().capturesKeys; },
    buttons: (first.buttons || []).map((b) => ({ ...b, shown: () => active() === first })), // the first screen's controls, while it is the one up
    current: () => settle().id,
    mount(glass, context) {
      layers = [first, second].map((s) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;inset:0'; glass.appendChild(d); s.mount(d, context); return d; });
      shown = null; settle();
    },
    open(view) { last = view; isOpen = true; shown = null; settle(); },
    close() { if (isOpen && shown) shown.close(); isOpen = false; },
    back() { return settle().back(); },
    update(view) { last = view; settle().update(view); },
    /** While the phone is down: only a screen that asks for it (the real device needs the position all the time). */
    background(view) { last = view; settle(); if (first.background) first.background(view); },
    key(k) { const a = settle(); return a.key ? a.key(k) : false; },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
  return screen;
}
