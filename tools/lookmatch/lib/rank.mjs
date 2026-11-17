// Licence filter, simple street-photograph rules and ranking of candidates for one viewpoint.
//
// LICENCE: kept only CC0, public domain, CC BY (any version) and CC BY-SA (any version). Anything else, an empty
// licence, or any NC / ND variant is dropped, always.
// RULES (a candidate failing one is dropped): JPEG or PNG; width >= 800 px; not taller than 1.2:1 (height / width);
//   camera position known and within the search radius; title, description or categories do not name an indoor, object,
//   map, drawing, night or winter subject (word list below); date year, when known, is 1995 or later (older ones are scans);
//   taken in a winter month (Dec-Mar north of 30 degrees latitude, Jun-Sep south of -30) or outside 08:00-19:59 by its own timestamp;
//   camera heading, when known, is within 110 degrees of the view's (a photograph looking the other way is not that view).
// RANK (lower score first): distance in metres, + 25 when the heading is unknown, + 120 when it is known and more than
//   40 degrees off (an object position instead of a camera position: + 40). Ties go to the newest. The best `perView` are kept.
import { haversine, angDiff } from './geo.mjs';

export function normaliseLicence(s) {
  const t = String(s || '').toUpperCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(NC|ND)\b|NON ?COMMERCIAL|NO ?DERIV/.test(t)) return null;
  if (/^CC0\b|^CC ZERO|^PUBLIC DOMAIN\b|^PDM\b/.test(t)) return /^CC/.test(t) ? 'CC0' : 'Public domain';
  let m = /^CC BY SA (\d(?:\.\d)?)/.exec(t); if (m) return 'CC BY-SA ' + m[1];
  m = /^CC BY (\d(?:\.\d)?)/.exec(t); if (m) return 'CC BY ' + m[1];
  return null;
}
export const attributionRequired = (norm) => /^CC BY/.test(norm || '');

// word STEMS (a word starting with one: "painting" also catches "paintings") and whole words
export const BAD_WORDS = new RegExp('\\b(?:interior|int[eé]rieur|inside|museum|mus[eé]e|exhibit|plaque|statue|sculpture|painting|peinture|watercolo|lithograph|drawing|dessin|engraving|gravure|postcard|carte postale|poster|logo|coat of arms|night|nuit|nocturne|winter|hiver|snow|neige|fireworks|feux d|aerial|a[eé]rienne|drone|altar|crypt|pew|cemetery|lobby|corridor|bust|portrait|manuscript|stamp|coin|incendie|christmas|no[eë]l|trough)|\\b(?:maps?|plans?|prints?|fires?|rooms?|nave|menu|food)\\b', 'i');
// months with snow likely and the hours of a usable daylight picture, from the photograph's own timestamp
export const WINTER = { north: [12, 1, 2, 3], south: [6, 7, 8, 9] }, DAY_HOURS = [8, 19];
export const MIN_YEAR = 1995, MIN_WIDTH = 800, MAX_ASPECT = 1.2, MAX_HEADING_OFF = 110;

export function dropReason(c, view, radius) {
  if (!normaliseLicence(c.licence)) return 'licence';
  if (!/^image\/(jpeg|png)$/i.test(c.mime || '')) return 'type';
  if (!(c.width >= MIN_WIDTH)) return 'small';
  if (c.height && c.height / c.width > MAX_ASPECT) return 'tall';
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return 'no position';
  if (haversine(view.lat, view.lon, c.lat, c.lon) > radius + 1) return 'far';
  if (BAD_WORDS.test([c.title, c.description, c.categories].join(' '))) return 'subject';
  const y = parseInt(String(c.date || '').slice(0, 4), 10); if (y && y < MIN_YEAR) return 'old';
  const t = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d):(\d\d))?/.exec(String(c.date || ''));
  if (t) {
    const month = +t[2], months = view.lat >= 30 ? WINTER.north : view.lat <= -30 ? WINTER.south : [];
    if (months.includes(month)) return 'winter';
    if (t[4] !== undefined && !(+t[4] === 0 && +t[5] === 0 && +t[6] === 0) && (+t[4] < DAY_HOURS[0] || +t[4] >= DAY_HOURS[1])) return 'not daytime';
  }
  if (Number.isFinite(c.heading) && angDiff(c.heading, view.headingTrue) > MAX_HEADING_OFF) return 'facing away';
  return null;
}

export function score(c, view) {
  const d = haversine(view.lat, view.lon, c.lat, c.lon);
  let s = d;
  if (!Number.isFinite(c.heading)) s += 25; else if (angDiff(c.heading, view.headingTrue) > 40) s += 120;
  if (c.positionOf === 'object') s += 40;
  return { distance: d, score: s };
}

/** { kept, dropped: {reason: count} } for one view. Duplicates (same id) are merged. */
export function rankCandidates(cands, view, { radius = 80, perView = 6 } = {}) {
  const seen = new Set(), dropped = {}, ok = [];
  for (const c of cands) {
    if (seen.has(c.id)) continue; seen.add(c.id);
    const r = dropReason(c, view, radius); if (r) { dropped[r] = (dropped[r] || 0) + 1; continue; }
    const s = score(c, view);
    ok.push({ ...c, licenceNorm: normaliseLicence(c.licence), distance: +s.distance.toFixed(1), headingDiff: Number.isFinite(c.heading) ? +angDiff(c.heading, view.headingTrue).toFixed(0) : null, score: +s.score.toFixed(1) });
  }
  ok.sort((a, b) => a.score - b.score || String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  return { kept: ok.slice(0, perView), dropped, considered: seen.size };
}
