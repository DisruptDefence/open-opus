// The style sheet of the touch controls that input.js builds (OPUS: the stand-in kept it in its own page, so the
// buttons came out unstyled). Plain: translucent white on whatever is behind, no brand. Inserted once, when touch mode starts.
// Layout: the stick is a floating ring that appears where the left thumb lands (the 120 px ring), with a faint
// hint ring bottom left; fire and aim are 64 px bottom right; reload, jump, use and pause are 44 px in a column above them.
export const TOUCH_CSS = `
.touch { position: absolute; inset: 0; display: none; pointer-events: none; }
.touch.on { display: block; }
.touch::before { content: ""; position: absolute; left: 20px; bottom: 20px; width: 120px; height: 120px; box-sizing: border-box; border: 2px solid rgba(255,255,255,.18); border-radius: 50%; }
.t-stick { position: absolute; left: -60px; top: -60px; width: 120px; height: 120px; display: none; pointer-events: none; }
.t-stick.on { display: block; }
.t-ring { position: absolute; inset: 0; box-sizing: border-box; border: 2px solid rgba(255,255,255,.5); border-radius: 50%; background: rgba(255,255,255,.08); }
.t-nub { position: absolute; left: 36px; top: 36px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid rgba(255,255,255,.6); }
.t-btn { position: absolute; box-sizing: border-box; padding: 0; margin: 0; border-radius: 50%; border: 2px solid rgba(255,255,255,.5); background: rgba(255,255,255,.12); color: rgba(255,255,255,.85); font: 600 11px/1 sans-serif; letter-spacing: .04em; pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; user-select: none; }
.t-btn.active { background: rgba(255,255,255,.4); }
.t-fire, .t-ads { width: 64px; height: 64px; bottom: 28px; }
.t-fire { right: 20px; }
.t-ads { right: 96px; }
.t-reload, .t-jump, .t-interact, .t-pause { width: 44px; height: 44px; right: 30px; }
.t-reload { bottom: 104px; }
.t-jump { bottom: 156px; }
.t-interact { bottom: 208px; display: none; }
.t-interact.on { display: block; }
.t-pause { bottom: 260px; }
`;
export function installTouchStyle(doc = document) {
  if (doc.getElementById('opus-touch-style')) return;
  const s = doc.createElement('style');
  s.id = 'opus-touch-style';
  s.textContent = TOUCH_CSS;
  doc.head.appendChild(s);
}
