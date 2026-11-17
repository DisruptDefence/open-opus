// node tools/lookmatch/lookmatch.mjs <fetch|render|measure|report|run|facts> --scene scenes/<id>.json --views engine/tools/viewpoints/<id>.json --work .lookmatch/<id>
// Options are in README.md.
import { parseArgs, need } from './lib/work.mjs';

const COMMANDS = ['fetch', 'render', 'measure', 'report'];
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === 'help' || ![...COMMANDS, 'run', 'facts'].includes(cmd)) { console.log('usage: lookmatch.mjs <fetch|render|measure|report|run|facts> --scene <scene.json> --views <viewpoints.json> --work <folder> [options: see tools/lookmatch/README.md]'); process.exit(cmd ? 2 : 0); }
  const o = parseArgs(rest); need(o, 'scene', 'views', 'work');
  for (const c of cmd === 'run' ? COMMANDS : [cmd]) { console.log(`== ${c}`); await (await import(c === 'facts' ? './facts/main.mjs' : `./${c}.mjs`)).main(o); }
} catch (e) { console.error('lookmatch: ' + (e && e.message || e)); process.exit(1); }
