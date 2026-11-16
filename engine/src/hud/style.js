// The HUD's style sheet, one string, inserted once as a <style> element by hud.js. Plain and tactical: one monospace
// system font, white, one amber accent. Everything scales with the viewport height (the root's font size), and every
// element sits on a soft dark backing so it reads over a bright scene and a dark one.
export const HUD_CSS = `
.oh { position: absolute; inset: 0; overflow: hidden; pointer-events: none; user-select: none; color: #f2f4ef; --amber: #ffb020; --red: #ff5a40; --back: rgba(8,10,12,.52);
  font: 600 clamp(10px, 2.2vh, 20px)/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; text-shadow: 0 1px 2px #000, 0 0 4px rgba(0,0,0,.7); }
.oh[hidden] { display: none; }
.oh * { box-sizing: border-box; }
.oh .pan { background: var(--back); border-radius: .25em; padding: .3em .6em; }

.oh-compass { position: absolute; top: 1em; left: 50%; width: min(46vw, 40em); transform: translateX(-50%); text-align: center; }
.oh-compass .hdg { display: inline-block; min-width: 3.6em; padding: .1em .5em; font-size: 1.25em; letter-spacing: .12em; background: var(--back); border-radius: .2em; }
.oh-compass .hdg::after { content: '\\00b0'; }
.oh-compass .win { position: relative; height: 3.3em; margin-top: .15em; overflow: hidden; background: var(--back); border-radius: .25em;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.oh-compass .strip { position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
.oh-compass .tk { position: absolute; top: 1.35em; width: 1px; height: .45em; background: rgba(255,255,255,.55); }
.oh-compass .tk.m { height: .75em; background: #fff; }
.oh-compass .tn { position: absolute; top: .1em; transform: translateX(-50%); font-size: .8em; opacity: .85; }
.oh-compass .tn.l { font-size: 1em; color: var(--amber); opacity: 1; }
.oh-compass .caret { position: absolute; left: 50%; top: 0; width: 0; height: 0; margin-left: -.35em; border: .35em solid transparent; border-top-color: #fff; }
.oh-compass .tags { position: absolute; left: 0; right: 0; bottom: .2em; height: 1.2em; }
.oh-compass .tag { position: absolute; top: 0; transform: translateX(-50%); font-size: .8em; line-height: 1.5em; padding: 0 .35em; color: #111; background: var(--amber); border-radius: .2em; white-space: nowrap; text-shadow: none; }
.oh-compass .tag.extraction { background: #30ff90; }

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

.oh-health { position: absolute; left: 1.2em; bottom: 1em; }
.oh-health .k, .oh-ammo .k { font-size: .75em; letter-spacing: .14em; text-transform: uppercase; opacity: .85; }
.oh-health .n { font-size: 2.3em; line-height: 1; margin-right: .3em; }
.oh-health .segs { display: flex; gap: .2em; margin-top: .3em; }
.oh-health .segs i { width: 1.1em; height: .55em; background: rgba(255,255,255,.22); }
.oh-health .segs i.on { background: #fff; }
.oh-health.crit .n, .oh-health.crit .segs i.on { color: var(--red); background-color: var(--red); }
.oh-health.crit .n { background: none; }
.oh-health.hurt .n { color: #fff; }
.oh-health.full { opacity: .72; }

.oh-ammo { position: absolute; right: 1.2em; bottom: 1em; text-align: right; max-width: 20em; }
.oh-ammo .n { font-size: 2.3em; line-height: 1; }
.oh-ammo .r { font-size: 1.15em; opacity: .85; margin-left: .3em; }
.oh-ammo .pips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .12em; margin-top: .3em; }
.oh-ammo .pips i { width: .3em; height: .8em; background: rgba(255,255,255,.2); }
.oh-ammo .pips i.on { background: #fff; }
.oh-ammo .cue { color: var(--amber); font-size: .95em; min-height: 1.25em; }
.oh-ammo .cue.empty, .oh-ammo.low .n { color: var(--red); }

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
