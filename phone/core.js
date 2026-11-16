// The phone host without a page: raising and lowering the phone over the world API, the keys, the view a screen is
// fed, and the reports that come back. It knows the world API (docs/WORLD-API.md) and the PhoneScreen contract, and
// nothing about what the screen shows. No DOM here: this file runs under node --test; host.js adds the frame.
//
// PhoneScreen, the part used here (the whole contract is in docs/WORLD-API.md):
//   open(view)  close()  back() -> boolean  update(view)  on(fn(type, data)) -> off
//   optional: capturesKeys, key({ key, code }) -> boolean, background(view), onCloseRequest (set by the host)
export const MODE_KEY = 'open-opus.phone.mode';
const BACKGROUND_S = 0.5; // a screen that needs the position while the phone is down gets it twice a second

/** What a screen is fed: the snapshot, with the player's true position on the Earth worked out once. */
export function phoneView(snapshot, geo, mode) {
  const s = snapshot.self, g = geo.toGeo(s.x, s.z, s.y);
  return { time: snapshot.time, mode, self: { ...s, lat: g.lat, lon: g.lon, hae: g.hae, mgrs: geo.toMGRS(s.x, s.z, 5) }, entities: snapshot.entities };
}
export const mgrsText = (m) => `${m.zone} ${m.square} ${m.easting} ${m.northing}`;

/** A report from a screen, with its place given both ways: game metres and latitude, longitude, grid reference. */
export function located(data, geo) {
  const d = { ...data }, num = Number.isFinite;
  if (num(d.lat) && num(d.lon) && !(num(d.x) && num(d.z))) { const p = geo.toGame(d.lat, d.lon); d.x = p.x; d.z = p.z; }
  else if (num(d.x) && num(d.z) && !(num(d.lat) && num(d.lon))) { const g = geo.toGeo(d.x, d.z); d.lat = g.lat; d.lon = g.lon; }
  if (num(d.x) && num(d.z)) d.mgrs = mgrsText(geo.toMGRS(d.x, d.z, 5));
  return d;
}

/**
 * @param world    the world API, after ready()
 * @param screen   a PhoneScreen
 * @param storage  optional, localStorage-like: remembers whether the phone pauses the game or slows it
 * @param onChange called when the phone came up, went down or changed mode
 * @param now      seconds, for the background feed (tests pass their own clock)
 */
export function createPhoneCore(world, screen, { storage = null, onChange = () => {}, now = () => Date.now() / 1000 } = {}) {
  const listeners = [];
  let open = false, fedAt = -Infinity;
  const geo = Object.freeze({ toGeo: world.geo.toGeo, toGame: world.geo.toGame, toMGRS: world.geo.toMGRS, toUTM: world.geo.toUTM, headingTrue: world.geo.headingTrue, convergenceDeg: world.geo.convergenceDeg });
  // Everything a screen may ask of the game. A screen never sees the world.
  const context = Object.freeze({ geo, scene: () => world.scene(), map: (opts) => world.overhead(opts), mode: () => world.held() });
  const stored = () => { try { return storage && storage.getItem(MODE_KEY) === 'slow' ? 'slow' : 'pause'; } catch { return 'pause'; } };
  const view = () => phoneView(world.snapshot(), geo, world.held());
  const emit = (action, data) => { for (const fn of [...listeners]) { try { fn(action, data); } catch (e) { console.error('[phone] a listener threw', e); } } };

  screen.on((type, data = {}) => emit(type, located(data, geo)));
  screen.onCloseRequest = () => phone.lower();
  // The game ended or was taken away under the hold (death in slow motion, the host ended the run): the phone goes
  // down with it. lower() clears `open` before it releases, so its own release does not come back through here.
  world.on('hold', (e) => { if (!e.mode && open) { open = false; screen.close(); onChange(); } });

  const phone = {
    context,
    get open() { return open; },
    canRaise: () => world.canHold(),
    mode: () => world.held() || stored(),
    raise() {
      if (open || !world.hold(stored())) return false;
      open = true; screen.open(view()); onChange(); emit('raised', {});
      return true;
    },
    lower() {
      if (!open) return false;
      open = false; screen.close(); world.release(); onChange(); emit('lowered', {});
      return true;
    },
    toggle() { return open ? phone.lower() : phone.raise(); },
    setMode(mode) {
      const m = mode === 'slow' ? 'slow' : 'pause';
      try { if (storage) storage.setItem(MODE_KEY, m); } catch { /* a private window */ }
      if (open) world.setHoldMode(m);
      onChange();
    },
    /**
     * A key press. Returns true when the phone used it (the caller then keeps it from everything else).
     * T or Tab raises the phone. While it is up: Escape undoes one thing on the screen, then lowers; Tab lowers;
     * a screen that captures keys (a real device) gets every other key, T included; otherwise T lowers.
     */
    key({ code, key = '', typing = false, repeat = false, ctrlKey = false, altKey = false, metaKey = false }) {
      if (ctrlKey || altKey || metaKey) return false;
      if (!open) {
        if (repeat || typing || (code !== 'KeyT' && code !== 'Tab') || !world.canHold()) return false;
        phone.raise(); return true;
      }
      if (code === 'Escape') { if (!repeat && !screen.back()) phone.lower(); return true; }
      if (code === 'Tab') { if (!repeat) phone.lower(); return true; }
      if (screen.capturesKeys) return !!(screen.key && screen.key({ key, code }));
      if (code === 'KeyT' && !typing) { if (!repeat) phone.lower(); return true; }
      return false;
    },
    /** Once a frame: feeds the screen while the phone is up, and a screen that asks for it while play goes on. */
    tick() {
      if (open) { screen.update(view()); return; }
      if (screen.background && world.state() === 'playing' && now() - fedAt >= BACKGROUND_S) { fedAt = now(); screen.background(view()); }
    },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
  return phone;
}
