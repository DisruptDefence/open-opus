// The HUD seam. The engine does not own a look: it calls these hooks and emits events, and whoever owns the UI
// supplies an object of this shape through the module registry (openWorld({ modules: { hud } })). This one draws
// nothing. The names are the ones the lifted modules already call.
const noop = () => {};
export function createNullHud() {
  return { root: null, show: noop, setObjective: noop, setPrompt: noop, setRelays: noop, setMarkers: noop, message: noop, warn: noop,
    radio: noop, clearRadio: noop, feed: noop, hitmarker: noop, reset: noop, update: noop };
}
