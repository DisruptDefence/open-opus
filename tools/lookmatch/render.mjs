// `render`: the engine's picture tool (engine/tools/photo.mjs) for the viewpoint file, into <work>/renders[-round]/.
// The engine must already be served (--engine-url). --look takes a proposal or look JSON laid over the scene's look through the URL switch.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { paths, readLookFile, REPO } from './lib/work.mjs';

export function main(o, { log = console.log } = {}) {
  const P = paths(o.work, o.round), pw = o.playwright || process.env.PLAYWRIGHT;
  if (!pw) throw new Error('Set PLAYWRIGHT (or --playwright) to the path of an installed playwright module.');
  const env = { ...process.env, PLAYWRIGHT: pw };
  const url = o['engine-url'] || process.env.ENGINE_URL; if (url) env.ENGINE_URL = url;
  let q = `q=${o.quality || 'high'}`; if (o.look) q += '&look=' + encodeURIComponent(JSON.stringify(readLookFile(o.look)));
  env.QUERY = q; if (o.only) env.VIEWS = o.only;
  const args = [join(REPO, 'engine/tools/photo.mjs'), o.views, P.renders, 'render'];
  const cmd = o.lock ? ['flock', o.lock, process.execPath, ...args] : [process.execPath, ...args];
  log(`render -> ${P.renders}${o.look ? ' with look ' + o.look : ''}`);
  const r = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`the picture tool exited with ${r.status}`);
}
