// Session state: title -> playing -> paused -> dead / complete. Small on purpose: the mission is not here. What is
// to be done, what counts and when it ends come from the host as scenario commands (world.apply) and go back out as
// events; this module only knows whether the player is in the world.
export function createSession(G) {
  const s = {
    state: 'title',
    run: { time: 0, retries: 0 },
    /** Enter play. `at` is { x, z, y?, yaw? } (game metres, engine yaw); without it the level's start is used. */
    start({ quick = false, at = null } = {}) {
      if (s.state !== 'title') s.run.retries++;
      const start = at ? { pos: { x: at.x, y: at.y ?? G.physics.groundHeight(at.x, at.z), z: at.z }, yaw: at.yaw || 0 } : G.level.playerStart;
      G.player.reset(start); G.player.enabled = true;
      if (G.weapon.reset) G.weapon.reset();
      if (G.combat.reset) G.combat.reset();
      s.run.time = 0;
      G.input.setGameplay(true);
      G.hud.show(true);
      set('playing', { quick });
    },
    pause() { if (s.state === 'playing') { G.input.setGameplay(false); set('paused'); } },
    resume() { if (s.state === 'paused') { G.input.setGameplay(true); set('playing'); } },
    end(result = 'complete') { if (s.state === 'playing' || s.state === 'paused') { G.player.enabled = false; G.input.setGameplay(false); G.input.exitLock(); set(result === 'dead' ? 'dead' : 'complete', { result }); } },
    /** Returns false when the simulation should not advance (title, paused). */
    update(dt) {
      if (s.state === 'playing') s.run.time += dt;
      return s.state === 'playing' || s.state === 'dead' || s.state === 'complete';
    },
  };
  function set(state, extra) { const from = s.state; s.state = state; G.events.emit('game:state', { state, from, ...extra }); }
  G.events.on('player:dead', () => { if (s.state === 'playing') { G.input.setGameplay(false); set('dead'); } });
  // Losing the pointer means the player left the game: pause, unless someone is holding the game on purpose.
  G.events.on('input:lock', (e) => { if (e && !e.locked && s.state === 'playing' && !G.hold.mode && G.input.mode === 'lock') s.pause(); });
  return s;
}
