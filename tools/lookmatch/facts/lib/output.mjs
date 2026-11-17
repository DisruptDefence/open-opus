// The enricher data file: derived numbers and attributions only (no pixel). Format `opus-facade-facts/1`.
export const FORMAT = 'opus-facade-facts/1';

/** zones: from buildZones; photos by id from `meta` (the cached photograph records). */
export function enricherFile(zones, meta = {}, photoRecords = []) {
  const byId = new Map(photoRecords.map((p) => [p.id, p]));
  const ids = [...new Set(zones.flatMap((z) => z.sources))].sort();
  const sources = ids.map((id) => { const p = byId.get(id) || {}; return { id, title: p.title || '', author: p.author || '', licence: p.licenceNorm || p.licence || '', licenceUrl: p.licenceUrl || '', url: p.pageUrl || '' }; });
  return {
    format: FORMAT,
    note: 'Colours and materials read from open-licensed photographs: numbers only (sRGB hex of de-lit cluster medians, shares), no pixel of any photograph. Sources below. See tools/lookmatch/README.md, section "facts".',
    zones: zones.map(({ sources: s, ...z }) => ({ ...z, photos: s })),
    buildings: [],
    sources,
  };
}
