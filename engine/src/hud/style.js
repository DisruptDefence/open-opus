// The HUD's style sheet, one string, inserted once as a <style> element by hud.js. Plain and tactical: one monospace
// system font, white, one amber accent. Everything scales with the viewport height (the root's font size), and every
// element sits on a soft dark backing so it reads over a bright scene and a dark one.
// the reference HUD's three faces, bundled (fonts/): Big Shoulders Display for numbers, Barlow Condensed for labels, IBM Plex Mono for the reserve.
const font = (family, weight, file) => `@font-face { font-family: '${family}'; font-weight: ${weight}; font-display: swap; src: url(${new URL('./fonts/' + file, import.meta.url).href}) format('truetype'); }`;
export const HUD_FONTS = [
  font('Big Shoulders Display', 700, 'BigShouldersDisplay-700.ttf'), font('Barlow Condensed', 600, 'BarlowCondensed-600.ttf'), font('IBM Plex Mono', 500, 'IBMPlexMono-500.ttf'),
].join('\n');
export const HUD_CSS = HUD_FONTS + `
.oh { position: absolute; inset: 0; overflow: hidden; pointer-events: none; user-select: none; color: #f2f4ef; --amber: #ffb020; --red: #ff5a40; --back: rgba(8,10,12,.52);
  /* the reference HUD's tokens (game/ui.css :root) that the health and ammunition use */
  --bone: #e8e4da; --bone-dim: rgba(232, 228, 218, .64); --bone-faint: rgba(232, 228, 218, .24); --signal: #ffb347; --alarm: #ff5a40;
  --f-display: 'Big Shoulders Display', 'Impact', 'Haettenschweiler', 'Arial Narrow', sans-serif; --f-label: 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif; --f-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --shadow: 0 0 2px rgba(0, 0, 0, .75), 0 1px 5px rgba(0, 0, 0, .55);
  --gl: max(16px, env(safe-area-inset-left, 0px)); --gr: max(16px, env(safe-area-inset-right, 0px)); --sat: env(safe-area-inset-top, 0px); --sab: env(safe-area-inset-bottom, 0px);
  font: 600 clamp(10px, 2.2vh, 20px)/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; text-shadow: 0 1px 2px #000, 0 0 4px rgba(0,0,0,.7); }
.oh[hidden] { display: none; }
.oh * { box-sizing: border-box; }
.oh .pan { background: var(--back); border-radius: .25em; padding: .3em .6em; }

.oh-tag { position: absolute; left: 0; top: 0; text-align: center; font-size: .85em; line-height: 1.15; white-space: nowrap; will-change: transform; }
.oh-tag i { display: block; width: .7em; height: .7em; margin: 0 auto .15em; background: var(--c, var(--amber)); transform: rotate(45deg); box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
.oh-tag b { color: var(--c, var(--amber)); }
.oh-tag.edge { opacity: .8; }

.oh-obj { position: absolute; left: 1.2em; top: 1em; max-width: calc(27vw - 2.4em); }
.oh-obj .k { font-size: .75em; letter-spacing: .14em; text-transform: uppercase; color: var(--amber); }
.oh-obj .t { white-space: pre-wrap; overflow-wrap: anywhere; }
.oh-obj .pips { margin-top: .3em; display: flex; flex-wrap: wrap; gap: .25em; }
.oh-obj .pips i { width: .8em; height: .8em; border: 1px solid #fff; background: transparent; }
.oh-obj .pips i.on { background: var(--amber); border-color: var(--amber); }

.oh-feed { position: absolute; right: 1.2em; top: 1em; max-width: calc(27vw - 2.4em); text-align: right; }
.oh-feed div { margin-bottom: .2em; }
.oh-feed div b { color: var(--amber); font-weight: 600; }

.oh-warn, .oh-msg { position: absolute; left: 50%; transform: translateX(-50%); max-width: 70vw; text-align: center; white-space: pre-wrap; }
.oh-warn { top: 6.8em; font-size: 1.15em; color: #fff; background: rgba(180,40,20,.78); padding: .15em .8em; letter-spacing: .06em; text-transform: uppercase; border-radius: .2em; }
.oh-msg { top: 10.4em; font-size: 1.1em; }
.oh-msg.pan { padding: .2em .7em; }
.oh-warn:empty, .oh-msg:empty { display: none; }

.oh-prompt { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); display: flex; align-items: center; gap: .6em; padding: .35em .9em .35em .5em; }
.oh-prompt svg { width: 2.4em; height: 2.4em; transform: rotate(-90deg); flex: none; }
.oh-prompt circle { fill: none; stroke-width: 3; }
.oh-prompt .bg { stroke: rgba(255,255,255,.3); }
.oh-prompt .fg { stroke: var(--amber); stroke-dasharray: 119.38; stroke-dashoffset: 119.38; }
.oh-prompt[hidden] { display: none; }

.oh-radio { position: absolute; left: 50%; bottom: 6.2em; transform: translateX(-50%); width: min(60vw, 42em); min-height: 1.6em; text-align: left; white-space: pre-wrap; }
.oh-radio .who { color: var(--amber); letter-spacing: .08em; text-transform: uppercase; margin-right: .6em; }
.oh-radio[hidden] { display: none; }

/* Health and ammunition: the reference HUD's (game/ui.css), class names and values as there, scoped under .oh. */
.oh .h-k { font: 600 11px/1 var(--f-label); letter-spacing: .26em; text-transform: uppercase; color: rgba(232, 228, 218, .72); }
.oh .h-health, .oh .h-ammo { text-shadow: var(--shadow); color: var(--bone); }
.oh .h-health { position: absolute; left: var(--gl); bottom: calc(22px + var(--sab)); opacity: 0; transition: opacity .6s; }
.oh .h-health.on { opacity: 1; transition-duration: .12s; }
.oh .h-hp-row { display: flex; align-items: flex-end; gap: 10px; margin-top: 6px; }
.oh .h-hp-n { font: 700 34px/.82 var(--f-display); letter-spacing: .02em; min-width: 1.6em; }
.oh .h-hp-bar { display: flex; gap: 3px; padding-bottom: 2px; }
.oh .h-hp-bar i { width: 15px; height: 5px; background: var(--bone); box-shadow: 0 0 2px rgba(0, 0, 0, .6); }
.oh .h-hp-bar i.off { background: transparent; box-shadow: inset 0 0 0 1px var(--bone-faint); }
.oh .h-health.crit .h-hp-n { color: var(--alarm); } .oh .h-health.crit .h-hp-bar i:not(.off) { background: var(--alarm); }

.oh .h-ammo { position: absolute; right: var(--gr); bottom: calc(20px + var(--sab)); text-align: right; }
.oh .h-cue { height: 16px; font: 600 12px/16px var(--f-label); letter-spacing: .26em; margin-right: -.26em; text-transform: uppercase; color: var(--signal); opacity: 0; }
.oh .h-cue.on { opacity: 1; } .oh .h-cue.urgent { color: var(--alarm); animation: oh-blink .7s steps(2, jump-none) infinite; }
@keyframes oh-blink { 0% { opacity: 1; } 100% { opacity: .35; } }
.oh .h-ammo-row { display: flex; align-items: flex-end; justify-content: flex-end; gap: 8px; }
.oh .h-ammo-n { font: 700 76px/.8 var(--f-display); letter-spacing: .01em; font-variant-numeric: tabular-nums; }
.oh .h-ammo-r { font: 500 15px/1 var(--f-mono); color: var(--bone); padding-bottom: 3px; }
.oh .h-ammo-r::before { content: '/ '; color: var(--bone-dim); }
.oh .h-ammo.low .h-ammo-n { color: var(--signal); }
.oh .h-pips { display: flex; justify-content: flex-end; gap: 2px; margin: 9px 0 7px; }
.oh .h-pips i { width: 3px; height: 11px; background: var(--bone); box-shadow: 0 0 2px rgba(0, 0, 0, .5); }
.oh .h-pips i.off { background: var(--bone-faint); box-shadow: none; }
.oh .h-ammo.low .h-pips i:not(.off) { background: var(--signal); }
.oh .h-wname { font: 600 11px/1 var(--f-label); letter-spacing: .28em; margin-right: -.28em; text-transform: uppercase; color: rgba(232, 228, 218, .82); }
/* touch layout: keep the thumbs' corners clear (the reference HUD's) */
.oh.is-touch .h-ammo { bottom: auto; top: calc(64px + var(--sat)); }
.oh.is-touch .h-ammo-n { font-size: 44px; } .oh.is-touch .h-pips { margin: 6px 0 5px; } .oh.is-touch .h-pips i { height: 7px; width: 2px; }
.oh.is-touch .h-health { bottom: auto; top: calc(128px + var(--sat)); }
.oh.is-touch .oh-feed { top: calc(150px + var(--sat)); }
@media (max-width: 760px) {
  .oh .h-ammo-n { font-size: 56px; }
  .oh.is-touch .h-ammo { top: calc(78px + var(--sat)); }
  .oh.is-touch .h-health { top: calc(150px + var(--sat)); }
}
@media (prefers-reduced-motion: reduce) { .oh .h-cue.urgent { animation: none; } }

.oh-x { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.oh-x i { position: absolute; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.65); }
.oh-x i.h { width: .9em; height: 2px; margin-top: -1px; }
.oh-x i.v { height: .9em; width: 2px; margin-left: -1px; }
.oh-x i.d { width: 3px; height: 3px; margin: -1.5px; border-radius: 50%; }

.oh-hit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
.oh-hit i { position: absolute; width: .7em; height: 3px; margin: -1.5px 0 0 -.35em; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.65); }
.oh-hit i:nth-child(1) { transform: rotate(45deg) translateX(1.1em); } .oh-hit i:nth-child(2) { transform: rotate(135deg) translateX(1.1em); }
.oh-hit i:nth-child(3) { transform: rotate(225deg) translateX(1.1em); } .oh-hit i:nth-child(4) { transform: rotate(315deg) translateX(1.1em); }
.oh-hit.weak i { background: var(--amber); } .oh-hit.kill i { background: var(--red); }

.oh-arcs { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
.oh-arcs i { position: absolute; width: 48vh; height: 48vh; left: -24vh; top: -24vh; border-radius: 50%; opacity: 0;
  background: conic-gradient(from -24deg, rgba(255,60,40,.95) 0deg, rgba(255,60,40,.95) 48deg, transparent 48deg);
  -webkit-mask: radial-gradient(circle, transparent 0, transparent calc(50% - 1.2em), #000 calc(50% - 1.15em), #000 50%, transparent calc(50% + .5px)); mask: radial-gradient(circle, transparent 0, transparent calc(50% - 1.2em), #000 calc(50% - 1.15em), #000 50%, transparent calc(50% + .5px)); }
`;
