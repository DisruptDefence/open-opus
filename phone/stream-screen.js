// The phone's one screen: a real TAK client (ATAK) running on an Android device on the player's own machine, shown
// live. Its picture arrives as video from the local gateway (phone/local/gateway.py), taps and keys go back, the
// player's position is sent as the device's GPS, the scene's overhead picture is sent as a map overlay, and what
// the trainee shares in ATAK comes back as Cursor-on-Target. Nothing of ATAK is in this page or this repository.
//
// It is a PhoneScreen (docs/WORLD-API.md). With no gateway it says so and how to start one, and keeps trying; it
// never shows a stand-in for ATAK. The gateway's messages are described at the top of gateway.py.
export const DEFAULT_GATEWAY = 'ws://127.0.0.1:9741';
export const START_COMMAND = 'phone/local/run.sh';

// Keys the device takes as key presses rather than text (Android key codes).
const KEYCODES = { Backspace: 67, Enter: 66, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Delete: 112 };
const POSITION_S = 0.5, OVERLAY = { half: 200, pxPerMetre: 2.5, grid: 100, moved: 120 };

/** The WebCodecs codec string of an H.264 stream, from its SPS: profile, constraint flags and level. */
export function h264Codec(config) {
  const b = config;
  for (let i = 0; i + 6 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1 && (b[i + 3] & 0x1f) === 7) return 'avc1.' + [b[i + 4], b[i + 5], b[i + 6]].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  return 'avc1.42e01f';
}

/**
 * Where a north-up picture of game ground sits on the Earth, as a KML LatLonBox. The picture's up is GRID north;
 * a LatLonBox is aligned to TRUE north, so it carries the scene's convergence as its rotation (degrees
 * counter-clockwise). Edges come from the scene's own projection, through geo.toGeo.
 */
export function overlayBox(bounds, geo) {
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const c = geo.toGeo(cx, cz), top = geo.toGeo(cx, bounds.minZ), right = geo.toGeo(bounds.maxX, cz), k = Math.cos((c.lat * Math.PI) / 180);
  const dN = Math.hypot(top.lat - c.lat, (top.lon - c.lon) * k), dE = Math.hypot(right.lat - c.lat, (right.lon - c.lon) * k);
  return { north: c.lat + dN, south: c.lat - dN, east: c.lon + dE / k, west: c.lon - dE / k, rotation: -geo.convergenceDeg };
}

/** The words on the glass for each state of the link. */
export function noteFor(status, url, command) {
  if (status === 'live') return '';
  if (status === 'connected') return 'Connected to the phone. Waiting for its picture…';
  if (status === 'no-decoder') return 'This browser cannot decode the phone’s video (it has no WebCodecs video decoder).\nUse a current Chrome, Edge, Firefox or Safari.';
  if (status === 'bad-codec') return 'This browser cannot decode the video the phone sends.\nStart the phone with another codec:  ' + command + ' --codec av1   (or h264)';
  return 'No phone connected.\n\nThe phone in this game is a real ATAK, running on an Android device on your own machine.\n'
    + 'In a copy of the repository, run:\n\n    ' + command + '\n\nThis screen then connects by itself (' + url + ').\nSee phone/README.md for what that needs.';
}

/**
 * @param url      the gateway's address
 * @param command  the command shown to a player who has no gateway running
 * @param WebSocketImpl, now, retrySeconds   for tests
 */
export function createStreamScreen({ url = DEFAULT_GATEWAY, command = START_COMMAND, WebSocketImpl = globalThis.WebSocket, now = () => Date.now() / 1000, retrySeconds = 3 } = {}) {
  const listeners = [];
  let ws = null, status = 'absent', isOpen = false, ctx = null, sentAt = -Infinity, retry = null, stopped = false;
  let el = null, video = null, overlayAt = null, device = null;
  const emit = (type, data = {}) => { for (const fn of [...listeners]) fn(type, data); };
  const setStatus = (s) => { if (s === status) return; status = s; if (el) el.note.textContent = noteFor(s, url, command); emit('status', { status: s }); };
  const send = (m) => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };

  function connect() {
    if (stopped || ws) return;
    let sock;
    try { sock = new WebSocketImpl(url); } catch { schedule(); return; }
    ws = sock; sock.binaryType = 'arraybuffer';
    sock.addEventListener('open', () => { if (ws !== sock) return; overlayAt = null; sentAt = -Infinity; setStatus('connected'); if (video) video.reset(); });
    sock.addEventListener('message', (ev) => { if (ws === sock) message(ev.data); });
    const gone = () => { if (ws !== sock) return; ws = null; device = null; setStatus('absent'); schedule(); };
    sock.addEventListener('close', gone); sock.addEventListener('error', gone);
  }
  const schedule = () => { if (!stopped && !retry) retry = setTimeout(() => { retry = null; connect(); }, retrySeconds * 1000); };

  function message(data) {
    if (typeof data !== 'string') { if (video) video.packet(data); return; }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'cot' && Number.isFinite(m.lat) && Number.isFinite(m.lon)) {
      // what ATAK shared with its server. `self` marks the device's own position report.
      emit('cot', { uid: String(m.uid || ''), type: String(m.cot || ''), how: String(m.how || ''), callsign: m.callsign == null ? null : String(m.callsign), lat: m.lat, lon: m.lon, self: /^a-f/.test(String(m.cot)) && /^m-/.test(String(m.how)) });
    } else if (m.type === 'video') { device = { codec: m.codec, width: m.width, height: m.height }; if (video) video.codec(m.codec); }
    else if (m.type === 'overlay') emit('overlay', { name: String(m.name || ''), state: String(m.state || '') });
  }

  function position(view) {
    if (now() - sentAt < POSITION_S) return;
    const s = view.self;
    if (send({ t: 'pos', lat: s.lat, lon: s.lon, hdg: s.headingTrue, spd: s.speed, alt: s.hae })) sentAt = now();
  }

  // The scene's overhead picture, for ATAK's map: sent when the phone comes up, once for each stretch of ground.
  async function overlay(view) {
    if (!ctx || !ws || ws.readyState !== 1 || typeof document === 'undefined') return;
    const s = view.self;
    if (overlayAt && Math.hypot(s.x - overlayAt.x, s.z - overlayAt.z) < OVERLAY.moved) return;
    const x = Math.round(s.x / OVERLAY.grid) * OVERLAY.grid, z = Math.round(s.z / OVERLAY.grid) * OVERLAY.grid;
    overlayAt = { x, z };
    try {
      const pic = await ctx.map({ x, z, halfWidth: OVERLAY.half, halfHeight: OVERLAY.half, pxPerMetre: OVERLAY.pxPerMetre });
      const c = document.createElement('canvas'); c.width = pic.width; c.height = pic.height; c.getContext('2d').drawImage(pic.image, 0, 0);
      const jpeg = c.toDataURL('image/jpeg', 0.85).split(',')[1], scene = ctx.scene();
      send({ t: 'overlay', name: `${scene.id}_${x}_${z}`.replace(/[^\w-]/g, '_'), title: scene.name, jpeg, ...overlayBox(pic.bounds, ctx.geo) });
    } catch (e) { overlayAt = null; console.error('[phone] the map overlay could not be made', e); }
  }

  // ---- the picture: H.264 or AV1 from the gateway, decoded by the browser -------------------------------------
  function createVideo(canvas) {
    const g = canvas.getContext('2d');
    let codec = 'h264', config = null, configured = false, waitingForKey = true, ts = 0, decoder = null, frames = 0;
    if (!('VideoDecoder' in globalThis)) { setStatus('no-decoder'); return { packet() {}, codec() {}, reset() { setStatus('no-decoder'); }, frames: () => 0 }; }
    const make = () => new VideoDecoder({
      output: (f) => {
        if (canvas.width !== f.displayWidth || canvas.height !== f.displayHeight) {
          canvas.width = f.displayWidth; canvas.height = f.displayHeight;
          if (screen.onAspect) screen.onAspect(f.displayWidth, f.displayHeight); // the glass takes the shape of the device's picture
        }
        g.drawImage(f, 0, 0); f.close(); frames++;
        setStatus('live');
      },
      error: (e) => { console.error('[phone] video decoder', e); configured = false; waitingForKey = true; },
    });
    return {
      frames: () => frames,
      codec(c) { if (c) codec = c; },
      reset() { config = null; configured = false; waitingForKey = true; },
      packet(buf) {
        const kind = new Uint8Array(buf, 0, 1)[0], data = new Uint8Array(buf, 1); // 0 configuration, 1 key frame, 2 frame
        if (kind === 0) { config = data.slice(); configured = false; waitingForKey = true; return; }
        if (!config && codec === 'h264') return;
        if (kind === 1 && !configured) {
          try {
            if (decoder && decoder.state !== 'closed') decoder.close();
            decoder = make(); decoder.configure({ codec: codec === 'av1' ? 'av01.0.08M.08' : h264Codec(config), optimizeForLatency: true }); configured = true;
          } catch (e) { console.error('[phone] video configure', e); setStatus('bad-codec'); return; }
        }
        if (!configured || (waitingForKey && kind !== 1)) return;
        let chunk = data;
        // an H.264 key frame needs its configuration (SPS, PPS) in front; an AV1 key frame carries its own header
        if (kind === 1) { if (config && codec === 'h264') { chunk = new Uint8Array(config.length + data.length); chunk.set(config); chunk.set(data, config.length); } waitingForKey = false; }
        try { decoder.decode(new EncodedVideoChunk({ type: kind === 1 ? 'key' : 'delta', timestamp: (ts += 33333), data: chunk })); }
        catch (e) { console.error('[phone] video decode', e); configured = false; waitingForKey = true; }
      },
    };
  }

  function touch(canvas) {
    let down = false;
    const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: canvas.width, h: canvas.height }; };
    canvas.addEventListener('pointerdown', (e) => { try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ } down = true; send({ t: 'touch', a: 'down', ...at(e) }); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => { if (down) send({ t: 'touch', a: 'move', ...at(e) }); });
    const up = (e) => { if (down) { down = false; send({ t: 'touch', a: 'up', ...at(e) }); } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const screen = {
    id: 'tak-stream', title: 'ATAK', capturesKeys: true, onCloseRequest: null, onAspect: null,
    /** True while a gateway is connected: what eitherScreen() asks. */
    available: () => status === 'connected' || status === 'live',
    /** Extra controls the host draws beside the phone. */
    buttons: [{ id: 'back', label: '◁ Back', title: 'Android Back', run: () => send({ t: 'back' }) }],
    status: () => status,
    device: () => device,
    frames: () => (video ? video.frames() : 0),
    /** Once: build the screen inside the phone's glass. `context` is what the host lets a screen ask of the game. */
    mount(glass, context) {
      ctx = context;
      const canvas = document.createElement('canvas'), note = document.createElement('div');
      canvas.className = 'opus-stream'; note.className = 'opus-stream-note'; canvas.width = 1068; canvas.height = 476;
      glass.append(canvas, note); el = { canvas, note };
      note.textContent = noteFor(status, url, command);
      video = createVideo(canvas); touch(canvas);
      connect();
    },
    /** For a host without a page (tests), and to start before the phone is first raised. */
    connect(context) { if (context) ctx = context; connect(); },
    disconnect() { stopped = true; clearTimeout(retry); retry = null; if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* not open */ } } },
    open(view) { isOpen = true; if (view) { position(view); overlay(view); } emit('open'); },
    close() { isOpen = false; },
    back() { return false; }, // Escape lowers the phone; Android's own Back is the button beside it
    update(view) { position(view); },
    /** While play goes on with the phone down: ATAK needs the position all the time. */
    background(view) { position(view); },
    /** A key typed while the phone is up goes to the device. True when it was sent. */
    key({ key }) {
      if (!isOpen || !key) return false;
      if (KEYCODES[key] != null) return send({ t: 'key', code: KEYCODES[key] });
      if (key.length === 1) return send({ t: 'text', s: key });
      return false;
    },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
  };
  return screen;
}
