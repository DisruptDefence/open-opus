// THROWAWAY. A stand-in mission host for development, so the engine can be played before a session host exists.
// The scenario shape it reads (below) is NOT the scenario format: that format is an open decision of the maintainer
// and nothing should be written against this one. When a session host speaking docs/SESSION-PROTOCOL.md lands,
// this file and host/scenarios/ go.
//
// It does what a session host does, in the page: it holds the scenario (the engine never sees it), sends commands
// when things happen, and decides when the run is over. It uses the world API and nothing else, so it runs the same
// against a browser's world and a test's.
//
//   { "name", "scene",
//     "start":  { x, z, heading },                 where the player enters
//     "setup":  [ command, ... ],                  what stands in the world at deploy
//     "rules":  [ { "when": { "event", ...fields to match }, "do": [ command, ... ] } ] }   each rule fires once
// Commands are the scenario commands of world.apply().
export function runMission(world, scenario, { log = () => {} } = {}) {
  const fired = new Set(), offs = [], record = [];
  let deployed = false;
  const matches = (when, e) => Object.entries(when).every(([k, v]) => k === 'event' || (e && e[k] === v));
  const events = [...new Set((scenario.rules || []).map((r) => r.when.event))];
  for (const name of events) offs.push(world.on(name, (e) => {
    (scenario.rules || []).forEach((rule, i) => {
      if (fired.has(i) || rule.when.event !== name || !matches(rule.when, e)) return;
      fired.add(i); record.push({ rule: i, event: name, time: world.snapshot().time });
      log(`rule ${i}: ${name} ${JSON.stringify(e)}`);
      for (const cmd of rule.do) world.apply(cmd);
    });
  }));
  return {
    record,
    /** Put the scenario into the world, from the top, and enter play. Call it from a user gesture in a browser. */
    start() {
      world.apply({ op: 'clear' }); // a redeploy starts clean
      fired.clear();
      for (const cmd of scenario.setup || []) world.apply(cmd);
      deployed = true;
      world.start({ at: scenario.start });
    },
    get deployed() { return deployed; },
    stop() { for (const off of offs) off(); },
  };
}
