// What world.apply() throws, and the only thing it throws: a host (or the mission client between it and the world)
// can tell a refused command from a fault of its own, and say why.
//   name     'ScenarioCommandError'
//   code     'not-ready'     the world is still loading
//            'unknown-op'    no such command
//            'invalid'       a field is missing or has a value the command cannot take
//            'unknown-kind'  no threat archetype of that name
//   op       the command's `op`, when it had one
//   message  a sentence a person can read
export class ScenarioCommandError extends Error {
  constructor(code, op, why) {
    super(`apply ${op === undefined ? '(no op)' : op}: ${why}`);
    this.name = 'ScenarioCommandError'; this.code = code; this.op = typeof op === 'string' ? op : undefined;
  }
}
