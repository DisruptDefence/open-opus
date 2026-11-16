// The loading screen every host shares: one module, plain ES, no imports. A host makes one with createBoot(), hands it
// openWorld's onProgress, and calls boot.done() when the world is ready (or boot.fail(error) when it is not).
//
//   const boot = createBoot({ parent: document.getElementById('app'), words: DEFAULT_PACK.loader, title: 'Old Quebec', subtitle: 'Patrol' });
//   openWorld({ source: boot.fetchJson(url).then(jsonSource), onProgress: boot.onProgress, ... });
//   await world.ready(); await boot.done();
//
// THE BAR IS WEIGHTED PHASES. Each phase (PHASES below) has a weight and a fraction of its own; the bar is the weighted
// sum. A phase's fraction is real when its work reports `done / total` (the scene download by bytes, the textures, the
// chunks meshed), and a slow creep that never reaches 90% when it cannot (a step the engine only announces). A phase
// the run never opens is dropped from the sum, so the bar only ever moves forward. What the screen shows eases towards
// that value and never goes back.
//
// WHERE THE NUMBERS COME FROM
//   engine step announcements   onProgress(label, k): opens the phase of that label (STEP_IDS), and settles the earlier
//                               ones that gave no numbers
//   G.progress(phase, done, total)   inside the engine, any module: arrives as onProgress(phase, k, { phase, done, total })
//   boot.report(id, done, total, 'bytes'|'count')   the host's own phases ('download', 'phone', or one it adds)
//   boot.addPhase({ id, weight, after })             an extra phase, e.g. the phone connecting after first light
// The model (createModel) and the easing (easeStep) are pure and tested under Node; createBoot is the DOM part.

export const PHASES = [
  { id: 'download', w: 3 }, { id: 'renderer', w: 1 }, { id: 'materials', w: 2 }, { id: 'textures', w: 5 }, { id: 'scene', w: 2 },
  { id: 'terrain', w: 7 }, { id: 'effects', w: 1 }, { id: 'audio', w: 1 }, { id: 'weapon', w: 1 }, { id: 'light', w: 3 },
];
/** The engine's step labels (engine.js `step(label, ...)`) and G.progress phases, as phase ids. */
export const STEP_IDS = {
  renderer: 'renderer', materials: 'materials', textures: 'textures', scene: 'scene', 'terrain and buildings': 'terrain',
  effects: 'effects', audio: 'audio', weapon: 'weapon', 'first light': 'light',
};
const CREEP_MS = 2500, CREEP_CAP = 0.9, STALL_MS = 6000;

/**
 * The phases' state and the weighted sum. Time is passed in (milliseconds), so a test controls it.
 * Phase states: idle -> active -> done, or idle -> skipped (never opened; a later report revives it).
 */
export function createModel({ phases = PHASES, creepMs = CREEP_MS, stallMs = STALL_MS } = {}) {
  const list = phases.map((p) => ({ id: p.id, w: p.w ?? p.weight ?? 1, state: 'idle', done: 0, total: 0, unit: 'count', t0: 0 }));
  let high = 0, lastEvent = 0, finished = false;
  const find = (id) => list.find((p) => p.id === id);
  const real = (p) => p.total > 0;
  // opening a phase settles the ones before it: never opened -> skipped; without numbers -> done; with numbers they finish themselves
  function open(id, t) {
    const p = find(id); if (!p) return null;
    const i = list.indexOf(p);
    if (p.state === 'skipped' || p.state === 'idle') { p.state = 'active'; p.t0 = t; lastEvent = t; }
    for (let j = 0; j < i; j++) { const q = list[j]; if (q.state === 'idle') q.state = 'skipped'; else if (q.state === 'active' && (!real(q) || q.done >= q.total)) q.state = 'done'; }
    return p;
  }
  const model = {
    phases: list,
    /** A phase begins (the engine announced its step). */
    start(id, t) { open(id, t); },
    /** A phase has numbers: done of total (total 0 or unknown: it stays a creep). */
    report(id, done, total, t, unit = 'count') {
      const p = open(id, t); if (!p) return;
      if (p.state === 'done') return;
      if (done !== p.done || total !== p.total) lastEvent = t;
      p.done = Math.max(p.done, done || 0); p.total = total > 0 ? total : 0; p.unit = unit;
      if (real(p) && p.done >= p.total) { p.state = 'done'; p.done = p.total; }
    },
    complete(id, t) { const p = open(id, t); if (p) { p.state = 'done'; lastEvent = t; } },
    skip(id) { const p = find(id); if (p && p.state === 'idle') p.state = 'skipped'; },
    /** A phase of the host's, placed after another (or at the end). */
    add({ id, weight = 1, after }) {
      if (find(id)) return;
      const i = after ? list.findIndex((p) => p.id === after) : -1;
      list.splice(i < 0 ? list.length : i + 1, 0, { id, w: weight, state: 'idle', done: 0, total: 0, unit: 'count', t0: 0 });
    },
    /** Everything is done: the world is ready. */
    finish(t) { for (const p of list) if (p.state !== 'skipped') p.state = 'done'; finished = true; lastEvent = t; },
    fraction(p, t) {
      if (p.state === 'done') return 1;
      if (p.state !== 'active') return 0;
      if (real(p)) return Math.min(0.999, p.done / p.total);
      return CREEP_CAP * (1 - Math.exp(-Math.max(0, t - p.t0) / creepMs));
    },
    /** The weighted sum, 0..1, never lower than it has been. */
    value(t) {
      if (finished) return 1;
      let num = 0, den = 0;
      for (const p of list) { if (p.state === 'skipped') continue; den += p.w; num += p.w * model.fraction(p, t); }
      high = Math.max(high, den ? Math.min(0.999, num / den) : 0);
      return high;
    },
    /** The phase to name: the last one opened that is still going. */
    current() { for (let i = list.length - 1; i >= 0; i--) if (list[i].state === 'active') return list[i]; return null; },
    /** Phase boundaries as fractions of the whole, for the bar's ticks (skipped phases leave no tick). */
    ticks() { const live = list.filter((p) => p.state !== 'skipped'), den = live.reduce((a, p) => a + p.w, 0); let at = 0; return live.slice(0, -1).map((p) => (at += p.w / den)); },
    /** Milliseconds since anything real happened. */
    quietFor(t) { return t - lastEvent; },
    stalled(t) { return !finished && model.quietFor(t) >= stallMs; },
    touch(t) { lastEvent = t; },
  };
  return model;
}

/**
 * One easing step: `shown` moves towards `target` (exponential, `rate` per second), at least `minSpeed` per second so it
 * arrives, never past the target and never backwards.
 */
export function easeStep(shown, target, dtSec, { rate = 5, minSpeed = 0.03 } = {}) {
  if (!(target > shown)) return shown;
  const gap = target - shown, step = Math.max(gap * (1 - Math.exp(-rate * Math.max(0, dtSec))), minSpeed * Math.max(0, dtSec));
  return Math.min(target, shown + step);
}

export const formatElapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const formatBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' kB' : n + ' B');

/** The words for a language: the pack's `loader` block ({ en: {...}, fr: {...} } or one flat set), `en` underneath. */
export function resolveWords(loader = {}, lang = 'en', over = {}) {
  const flat = loader.en || loader.fr ? null : loader, base = flat || loader.en || {}, own = flat ? {} : loader[String(lang).slice(0, 2)] || {};
  const phases = { ...(base.phases || {}), ...(own.phases || {}), ...(over.phases || {}) };
  return { ...base, ...own, ...over, phases, tips: over.tips || own.tips || base.tips || [] };
}

/**
 * Read a JSON file and report bytes as they arrive: `onBytes(received, total)` with total 0 when the length is unknown
 * (no Content-Length, or the body is compressed and the count would pass it). Resolves to the parsed value.
 */
export async function fetchJsonProgress(url, onBytes = () => {}, fetchFn = fetch) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const len = +(r.headers.get('content-length') || 0), encoded = !!r.headers.get('content-encoding');
  if (!r.body || !r.body.getReader) { const j = await r.json(); onBytes(len, len); return j; }
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onBytes(got, len && !encoded && got <= len ? len : 0);
  }
  const all = new Uint8Array(got); let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  onBytes(got, got);
  return JSON.parse(new TextDecoder().decode(all));
}

// ---- the screen ---------------------------------------------------------------------------------------------------
const font = (family, weight, file) => `@font-face{font-family:'${family}';font-weight:${weight};font-display:swap;src:url(${new URL('../src/hud/fonts/' + file, import.meta.url).href}) format('truetype')}`;
const CSS = [
  font('Big Shoulders Display', 700, 'BigShouldersDisplay-700.ttf'), font('Barlow Condensed', 600, 'BarlowCondensed-600.ttf'), font('IBM Plex Mono', 500, 'IBMPlexMono-500.ttf'),
  `.ob{position:absolute;inset:0;z-index:50;display:grid;align-items:end;color:#e8e4da;background:#0b0d0f;overflow:hidden;opacity:1;transition:opacity .45s ease;
  --amber:#ffb020;--signal:#ffb347;--alarm:#ff5a40;--bone:#e8e4da;--dim:rgba(232,228,218,.64);--faint:rgba(232,228,218,.24);--back:rgba(8,10,12,.52);
  --f-display:'Big Shoulders Display','Impact','Haettenschweiler','Arial Narrow',sans-serif;--f-label:'Barlow Condensed','Arial Narrow',system-ui,sans-serif;--f-mono:'IBM Plex Mono',ui-monospace,'SFMono-Regular',Menlo,monospace;
  padding:max(20px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));box-sizing:border-box}`,
  `.ob.out{opacity:0;pointer-events:none}.ob[hidden]{display:none}.ob *{box-sizing:border-box}`,
  `.ob-bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 18% 100%,rgba(255,176,32,.10),transparent 60%),repeating-linear-gradient(0deg,rgba(232,228,218,.035) 0 1px,transparent 1px 4px),#0b0d0f}`,
  `.ob-bg::after{content:'';position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--amber);opacity:.85}`,
  `.ob-in{position:relative;width:min(960px,100%);margin:0 auto;display:grid;gap:clamp(10px,2.4vh,22px)}`,
  `.ob-brand{font:600 clamp(11px,1.7vh,14px)/1 var(--f-label);letter-spacing:.32em;text-transform:uppercase;color:var(--amber);display:flex;align-items:center;gap:.9em}.ob-brand::after{content:'';height:1px;width:3.5em;background:var(--amber);opacity:.6}`,
  `.ob-title{margin:0;font:700 clamp(34px,9vh,84px)/.92 var(--f-display);letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere;text-shadow:0 2px 14px rgba(0,0,0,.6)}`,
  `.ob-sub{margin:0;font:600 clamp(15px,2.6vh,22px)/1.2 var(--f-label);letter-spacing:.08em;color:var(--dim);text-transform:uppercase}.ob-sub:empty,.ob-title:empty{display:none}`,
  `.ob-main{display:grid;grid-template-columns:auto 1fr;align-items:end;gap:clamp(14px,3vw,34px);margin-top:clamp(6px,2vh,24px)}`,
  `.ob-pct{font:700 clamp(48px,13vh,120px)/.8 var(--f-display);letter-spacing:.01em;color:var(--bone);min-width:2.1ch;text-align:right;font-variant-numeric:tabular-nums}.ob-pct small{font-size:.36em;color:var(--amber);margin-left:.1em}`,
  `.ob-col{display:grid;gap:10px;min-width:0}`,
  `.ob-step{display:flex;align-items:baseline;justify-content:space-between;gap:14px;font:600 clamp(16px,2.8vh,24px)/1.1 var(--f-label);letter-spacing:.14em;text-transform:uppercase}`,
  `.ob-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ob-name::after{content:'';display:inline-block;width:.5em;height:.9em;margin-left:.3em;vertical-align:-.1em;background:var(--amber);animation:ob-blink 1s steps(2,start) infinite}`,
  `.ob-det{font:500 clamp(11px,1.8vh,15px)/1 var(--f-mono);color:var(--dim);letter-spacing:0;white-space:nowrap;text-transform:none}`,
  `.ob-bar{position:relative;height:clamp(8px,1.6vh,14px);background:rgba(232,228,218,.10);border:1px solid var(--faint)}`,
  `.ob-fill{position:absolute;inset:0;background:var(--amber);transform-origin:0 50%;transform:scaleX(0);overflow:hidden}`,
  `.ob-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);width:30%;animation:ob-sheen 1.8s linear infinite}`,
  `.ob-tick{position:absolute;top:-1px;bottom:-1px;width:2px;margin-left:-1px;background:#0b0d0f}`,
  `.ob-meta{display:flex;justify-content:space-between;gap:14px;min-height:1.3em;font:500 clamp(11px,1.8vh,15px)/1.2 var(--f-mono);color:var(--dim)}`,
  `.ob-slow{color:var(--signal)}.ob-slow[hidden],.ob-err[hidden],.ob-tip[hidden]{display:none}`,
  `.ob-tip{display:flex;gap:1em;align-items:baseline;min-height:2.6em;margin-top:clamp(4px,1.6vh,18px);padding-top:clamp(8px,1.6vh,16px);border-top:1px solid var(--faint);font:600 clamp(14px,2.2vh,19px)/1.3 var(--f-label);letter-spacing:.06em;color:var(--dim);transition:opacity .5s}`,
  `.ob-tip b{flex:none;color:var(--amber);letter-spacing:.26em;text-transform:uppercase;font-size:.8em}.ob-tip em{font-style:normal;transition:opacity .5s}.ob-tip.swap em{opacity:0}`,
  `.ob-err{display:grid;gap:12px;padding:14px 16px;background:var(--back);border-left:4px solid var(--alarm)}`,
  `.ob-err b{font:700 clamp(20px,3.4vh,30px)/1.1 var(--f-display);letter-spacing:.06em;text-transform:uppercase;color:var(--alarm)}`,
  `.ob-err pre{margin:0;max-height:28vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:500 clamp(11px,1.8vh,14px)/1.4 var(--f-mono);color:var(--bone)}`,
  `.ob-err button{justify-self:start;min-height:44px;padding:0 28px;font:700 18px/1 var(--f-label);letter-spacing:.2em;text-transform:uppercase;color:#0b0d0f;background:var(--amber);border:0;cursor:pointer;touch-action:manipulation}`,
  `.ob-err button:hover,.ob-err button:focus-visible{background:#ffc654;outline:2px solid var(--bone);outline-offset:2px}`,
  `.ob.fail .ob-step{display:none}.ob.fail .ob-fill{background:var(--alarm)}.ob.fail .ob-fill::after,.ob.fail .ob-name::after{display:none}.ob.fail .ob-pct small{color:var(--alarm)}.ob.fail .ob-meta .ob-slow{display:none}`,
  `@keyframes ob-blink{to{visibility:hidden}}@keyframes ob-sheen{from{left:-30%}to{left:100%}}`,
  `@media (max-width:560px){.ob-main{grid-template-columns:1fr;gap:8px}.ob-pct{text-align:left}.ob-step{letter-spacing:.1em}}`,
  `@media (max-height:430px){.ob{align-items:center}.ob-in{gap:6px}.ob-tip{margin-top:0;padding-top:6px;min-height:0}.ob-main{margin-top:0}}`,
  `@media (prefers-reduced-motion:reduce){.ob,.ob-tip,.ob-tip em{transition:none}.ob-fill::after,.ob-name::after{animation:none}.ob-name::after{display:none}}`,
].join('\n');

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/**
 * The loading screen. Options:
 *   parent      where it goes (default document.body); it covers its parent
 *   words       the pack's `loader` block (DEFAULT_PACK.loader), or any object of the same shape
 *   lang        'en' | 'fr' (default: the page's lang, then the browser's)
 *   brand       the small word above the title (default 'OPUS')
 *   title, subtitle   the mission; boot.setMission() changes them later
 *   tips        a list of tip lines (default: words.tips)
 *   phases      replace the phase table; extraPhases: [{ id, weight, after }] added to it
 *   onRetry     what the Retry button does (default: reload the page)
 *   stallMs     how long without news counts as stalled (default 6000)
 *   reducedMotion  force on or off (default: the user's preference)
 */
export function createBoot(opts = {}) {
  const parent = opts.parent || document.body;
  if (!document.getElementById('opus-boot-style')) { const s = make('style'); s.id = 'opus-boot-style'; s.textContent = CSS; document.head.appendChild(s); }
  const lang = opts.lang || document.documentElement.lang || (navigator.language || 'en');
  const words = resolveWords(opts.words || {}, lang, opts.wordsOver || {});
  const reduce = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const model = createModel({ phases: opts.phases || PHASES, stallMs: opts.stallMs });
  for (const p of opts.extraPhases || []) model.add(p);
  const now = () => performance.now();

  const root = make('div', 'ob'), brand = make('div', 'ob-brand', opts.brand || 'OPUS'), title = make('h1', 'ob-title', opts.title || ''), sub = make('p', 'ob-sub', opts.subtitle || '');
  const pct = make('div', 'ob-pct'), pctN = make('span', '', '0'), pctU = make('small', '', '%'); pct.append(pctN, pctU);
  const name = make('span', 'ob-name'), det = make('span', 'ob-det'), step = make('div', 'ob-step'); step.append(name, det);
  const bar = make('div', 'ob-bar'), fill = make('i', 'ob-fill'); bar.append(fill);
  const el = make('span', 'ob-el', '0:00'), slow = make('span', 'ob-slow', words.slow || ''); slow.hidden = true;
  const meta = make('div', 'ob-meta'); meta.append(el, slow);
  const col = make('div', 'ob-col'); col.append(step, bar, meta);
  const main = make('div', 'ob-main'); main.append(pct, col);
  const err = make('div', 'ob-err'), errT = make('b'), errM = make('pre'), retry = make('button', '', words.retry || 'Retry'); retry.type = 'button'; err.hidden = true; err.append(errT, errM, retry);
  const tip = make('div', 'ob-tip'), tipK = make('b', '', words.tip || 'Tip'), tipT = make('em'); tip.append(tipK, tipT);
  const bg = make('div', 'ob-bg'), inner = make('div', 'ob-in'); inner.append(brand, title, sub, main, err, tip);
  root.append(bg, inner); root.setAttribute('role', 'progressbar'); root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '100'); root.setAttribute('aria-live', 'polite');
  parent.appendChild(root);

  let tips = (opts.tips || words.tips || []).slice(), tipAt = tips.length ? Math.floor(Math.random() * tips.length) : 0, tipTimer = 0;
  const t0 = now();
  let shown = 0, lastFrame = t0, failed = false, finished = false, raf = 0, tickSig = '', lastText = '', lastDet = '';
  let doneRes; const donePromise = new Promise((r) => { doneRes = r; });

  const phaseName = (p) => (p ? (words.phases || {})[p.id] || p.id : '');
  const detail = (p) => (p && p.total > 0 ? (p.unit === 'bytes' ? `${formatBytes(p.done)} / ${formatBytes(p.total)}` : `${p.done} / ${p.total}`) : p && p.unit === 'bytes' && p.done > 0 ? formatBytes(p.done) : '');

  function render(t) {
    const target = model.value(t), dt = (t - lastFrame) / 1000; lastFrame = t;
    shown = reduce ? Math.max(shown, target) : easeStep(shown, target, dt, finished ? { rate: 14, minSpeed: 1.5 } : {});
    const whole = finished ? 100 : Math.min(99, Math.floor(shown * 100));
    fill.style.transform = `scaleX(${shown.toFixed(4)})`;
    if (pctN.textContent !== String(whole)) { pctN.textContent = whole; root.setAttribute('aria-valuenow', String(whole)); }
    const p = model.current(), text = failed ? '' : finished ? words.ready || '' : phaseName(p) || words.title || '', d = failed || finished ? '' : detail(p);
    if (text !== lastText) { name.textContent = lastText = text; root.setAttribute('aria-valuetext', text); }
    if (d !== lastDet) det.textContent = lastDet = d;
    el.textContent = formatElapsed(t - t0);
    slow.hidden = failed || finished || !model.stalled(t);
    const sig = model.ticks().map((x) => x.toFixed(3)).join();
    if (sig !== tickSig) { tickSig = sig; bar.querySelectorAll('.ob-tick').forEach((e) => e.remove()); for (const x of model.ticks()) { const k = make('i', 'ob-tick'); k.style.left = (x * 100).toFixed(2) + '%'; bar.appendChild(k); } }
  }
  const loop = () => { render(now()); if (!finished || shown < 1) raf = requestAnimationFrame(loop); else raf = 0; };
  const kick = () => { if (!raf && !failed) raf = requestAnimationFrame(loop); };

  function showTip() {
    if (!tips.length) { tip.hidden = true; return; }
    tip.hidden = false; tipT.textContent = tips[tipAt % tips.length];
    clearInterval(tipTimer);
    if (tips.length > 1) tipTimer = setInterval(() => { if (reduce) { tipAt++; tipT.textContent = tips[tipAt % tips.length]; return; } tip.classList.add('swap'); setTimeout(() => { tipAt++; tipT.textContent = tips[tipAt % tips.length]; tip.classList.remove('swap'); }, 500); }, 7000);
  }
  showTip(); render(t0); kick();
  retry.addEventListener('click', () => (opts.onRetry ? opts.onRetry() : location.reload()));

  const boot = {
    element: root, model, words,
    /** openWorld's onProgress: (label, fraction, info?) — info is G.progress's { phase, done, total }. */
    onProgress(label, k, info) {
      const t = now();
      if (label === 'ready') { return; } // boot.done() ends it, after the first frames are drawn
      const id = STEP_IDS[label] || label;
      if (info && info.total != null) model.report(id, info.done, info.total, t);
      else model.start(id, t);
    },
    /** A phase of the host's own: boot.report('download', bytes, total, 'bytes'), boot.report('phone', 1, 3). */
    report(id, done, total, unit) { model.report(id, done, total, now(), unit); },
    start(id) { model.start(id, now()); }, complete(id) { model.complete(id, now()); }, skip(id) { model.skip(id); },
    addPhase(p) { model.add(p); },
    /** fetch + parse a JSON file with bytes reported as the 'download' phase; the scene file's way in. */
    fetchJson(url) { boot.start('download'); return fetchJsonProgress(url, (got, total) => boot.report('download', got, total, 'bytes')).then((j) => { boot.complete('download'); return j; }); },
    setMission({ title: ti, subtitle: su, brand: br } = {}) { if (ti !== undefined) title.textContent = ti; if (su !== undefined) sub.textContent = su; if (br !== undefined) brand.textContent = br; },
    setTips(list) { tips = (list || []).slice(); tipAt = 0; showTip(); },
    /** Stop on an error: the message and a Retry button. */
    fail(e, { onRetry } = {}) {
      if (finished) return;
      failed = true; root.classList.add('fail'); cancelAnimationFrame(raf); raf = 0; clearInterval(tipTimer);
      errT.textContent = words.error || ''; errM.textContent = String((e && e.message) || e || ''); err.hidden = false; tip.hidden = true;
      if (onRetry) { const b = retry.cloneNode(true); retry.replaceWith(b); b.addEventListener('click', onRetry); b.focus(); } else retry.focus();
      render(now());
    },
    /** The world is ready: finish the bar, then fade the screen out. Resolves when it is gone. */
    done() {
      if (failed || finished) return donePromise;
      finished = true; model.finish(now()); clearInterval(tipTimer); kick();
      const gone = () => { cancelAnimationFrame(raf); root.hidden = true; root.remove(); doneRes(); };
      if (reduce) { shown = 1; render(now()); gone(); } else setTimeout(() => { root.classList.add('out'); setTimeout(gone, 480); }, 260);
      return donePromise;
    },
    /** Redraw now (for tests that stop the clock). */
    render: () => render(now()),
    get fraction() { return shown; },
  };
  return boot;
}
