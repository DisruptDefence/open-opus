// Source: Wikimedia Commons (no key). One geosearch query per viewpoint; the answer carries coordinates, sizes, the
// licence and the author. The camera heading comes from `GPSImgDirection` when the file has one, else from a
// `heading:` field of the page's {{Location}} template (read in the same query).
import { BASE_HEADERS } from '../http.mjs';

export const name = 'commons';
const API = 'https://commons.wikimedia.org/w/api.php';

export function buildRequests(view, { radius = 80 } = {}) {
  const q = new URLSearchParams({
    action: 'query', generator: 'geosearch', ggscoord: `${view.lat}|${view.lon}`, ggsradius: String(Math.round(radius)), ggsnamespace: '6', ggslimit: '50', ggsprimary: 'all',
    prop: 'coordinates|imageinfo|revisions', coprop: 'type|dim|globe', coprimary: 'all', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280', rvprop: 'content', rvslots: 'main', format: 'json',
  });
  return [{ url: `${API}?${q}`, headers: { ...BASE_HEADERS } }];
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ' };
export function stripTags(html) {
  return String(html ?? '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, ' ').trim();
}
/** The answer is paged (the page text limits a batch to a few files): the next request, or null when the answer is complete. */
export function nextRequest(json, req) {
  if (!json || !json.continue) return null;
  const u = new URL(req.url); for (const [k, v] of Object.entries(json.continue)) u.searchParams.set(k, v);
  return { url: u.toString(), headers: { ...req.headers } };
}
/** Merge the pages of two answers of one paged query (later fields win). */
export function mergeAnswers(a, b) {
  const pages = { ...((a && a.query && a.query.pages) || {}) };
  for (const [id, p] of Object.entries((b && b.query && b.query.pages) || {})) pages[id] = { ...(pages[id] || {}), ...p };
  return { query: { pages } };
}
const meta = (em, k) => (em && em[k] && em[k].value != null ? em[k].value : '');

/** Camera heading (degrees from true north) from the file's metadata or its page's location template; null when unknown. */
export function headingOf(em, wikitext) {
  const d = parseFloat(meta(em, 'GPSImgDirection'));
  if (Number.isFinite(d)) return ((d % 360) + 360) % 360;
  const m = /\{\{\s*Location(?: dec)?\s*\|[^}]*?\|\s*heading\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(wikitext || '');
  return m ? (((+m[1]) % 360) + 360) % 360 : null;
}

export function parse(json) {
  const out = [], pages = (json && json.query && json.query.pages) || {};
  for (const p of Object.values(pages)) {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
    const em = ii.extmetadata || {}, coords = p.coordinates || [];
    const cam = coords.find((c) => c.type === 'camera') || null, c = cam || coords.find((x) => 'primary' in x) || coords[0]; if (!c) continue;
    const wt = p.revisions && p.revisions[0] && p.revisions[0].slots && p.revisions[0].slots.main ? p.revisions[0].slots.main['*'] ?? p.revisions[0].slots.main.content : '';
    out.push({
      source: 'commons', id: 'c' + p.pageid, title: String(p.title || '').replace(/^File:/, ''), pageUrl: ii.descriptionurl || '',
      author: stripTags(meta(em, 'Artist')), licence: stripTags(meta(em, 'LicenseShortName') || meta(em, 'License')), licenceUrl: stripTags(meta(em, 'LicenseUrl')),
      lat: c.lat, lon: c.lon, positionOf: cam ? 'camera' : 'object', heading: headingOf(em, wt),
      date: stripTags(meta(em, 'DateTimeOriginal') || meta(em, 'DateTime')), description: stripTags(meta(em, 'ImageDescription')), categories: stripTags(meta(em, 'Categories')),
      width: ii.width, height: ii.height, mime: ii.mime, downloadUrl: ii.thumburl || ii.url,
    });
  }
  return out;
}
