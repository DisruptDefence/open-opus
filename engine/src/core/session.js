// Session state: title -> playing -> paused -> dead / complete. Small on purpose: the mission is not here. What is
// to be done, what counts and when it ends come from the host as scenario commands (world.apply) and go back out as
// events; this module only knows whether the player is in the world.
const FADE_IN = 2.6; // seconds from black to the view when play starts
const smoothstep = (a, b, x) => { const t = b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : x >= b ? 1 : 0; return t * t * (3 - 2 * t); };
export function createSession(G) {
  const s = {
    state: 'title',
    run: { time: 0, retries: 0 }, fadeIn: 0,
    /** Enter play. `at` is { x, z, y?, yaw? } (game metres, engine yaw); without it the level's start is used. */
    start({ at = null, fadeIn = FADE_IN } = {}) {
      if (s.state !== 'title') s.run.retries++;
      const start = at ? { pos: { x: at.x, y: at.y ?? G.physics.groundHeight(at.x, at.z), z: at.z }, yaw: at.yaw || 0 } : G.level.playerStart;
      G.player.reset(start); G.player.enabled = true;
      if (G.weapon.reset) G.weapon.reset();
      if (G.weapon.setVisible) G.weapon.setVisible(true);
      if (G.combat.reset) G.combat.reset();
      s.run.time = 0; s.fadeIn = fadeIn;
      const post = G.render && G.render.post; if (post) { post.fade = fadeIn > 0 ? 1 : 0; post.saturation = 1; }
      G.input.setGameplay(true);
      G.hud.show(true);
      set('playing');
    },
    pause() { if (s.state === 'playing') { G.input.setGameplay(false); set('paused'); } },
    resume() { if (s.state === 'paused') { G.input.setGameplay(true); set('playing'); } },
    /** End play. `dead` kills the player: the same fact, and the same `player:dead` event, as dying under fire. */
    end(result = 'complete') {
      if (s.state !== 'playing' && s.state !== 'paused') return;
      G.player.enabled = false; G.input.setGameplay(false); G.input.exitLock();
      if (result !== 'dead') return set('complete', { result });
      if (G.player.alive) { G.player.health = 0; G.player.alive = false; }
      set('dead', { result });
      G.events.emit('player:dead', {});
    },
    /** Returns false when the simulation should not advance (title, paused). */
    update(dt) {
      if (s.state === 'playing') s.run.time += dt;
      const post = G.render && G.render.post;
      if (post && dt > 0) {
        const ease = (key, target, rate) => { post[key] += (target - post[key]) * (1 - Math.exp(-rate * dt)); };
        if (s.state === 'playing') post.fade = s.fadeIn > 0 ? 1 - smoothstep(0.25, s.fadeIn, s.run.time) : 0;
        else if (s.state === 'dead') { ease('saturation', 0.12, 2.2); ease('fade', 0.55, 1.4); }
        else if (s.state === 'complete') { ease('fade', 0.72, 0.9); ease('saturation', 0.7, 1); }
      }
      return s.state === 'playing' || s.state === 'dead' || s.state === 'complete';
    },
  };
  // Before the first start nobody holds the weapon: its view model is not posed yet and would fill the title view.
  if (G.weapon.setVisible) G.weapon.setVisible(false);
  function set(state, extra) { const from = s.state; s.state = state; G.events.emit('game:state', { state, from, ...extra }); }
  G.events.on('player:dead', () => { if (s.state === 'playing') { G.input.setGameplay(false); G.input.exitLock(); set('dead'); } });
  // Losing the pointer means the player left the game: pause, unless someone is holding the game on purpose.
  G.events.on('input:lock', (e) => { if (e && !e.locked && s.state === 'playing' && !G.hold.mode && G.input.mode === 'lock') s.pause(); });
  return s;
}
