// Command-line parsing and the work folder's file names. A "round" suffixes the files of a rerun so rounds sit side by
// side; the base round ("base" or none) has no suffix.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BOOL = new Set(['offline', 'help', 'no-widen']);

export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (BOOL.has(k)) o[k] = true; else { if (i + 1 >= argv.length) throw new Error(`--${k} needs a value`); o[k] = argv[++i]; } } else o._.push(a);
  }
  return o;
}
export const suffix = (round) => (round && round !== 'base' ? '-' + round : '');
export function paths(work, round) {
  const s = suffix(round);
  return { work, cache: `${work}/cache`, photos: `${work}/photos`, renders: `${work}/renders${s}`, overlays: `${work}/overlays`, measure: `${work}/measure${s}.json`, report: `${work}/report${s}.html`, gaps: `${work}/gaps${s}.md`, proposal: `${work}/proposal${s}.json` };
}
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
/** A look file: a proposal (`look` key) or a plain look object. */
export function readLookFile(p) { const j = readJson(p); return j && typeof j.look === 'object' && !Array.isArray(j.look) ? j.look : j; }
export function need(o, ...keys) { for (const k of keys) if (!o[k]) throw new Error(`missing --${k}`); }
