// The overlay sheet of one photograph: left the photograph, right every pixel painted by what it was taken for
// (sky, ground, leaves, glass, opening, roof band) and every wall pixel by its cluster's colour; under it a legend line
// per cluster with the material label and the numbers behind it. Pure: returns RGBA and legend, the PNG is written by the browser page.
import { PX } from './photo.mjs';

const FLAT = { [PX.sky]: [190, 210, 235], [PX.ground]: [150, 150, 150], [PX.veg]: [40, 110, 40], [PX.glass]: [0, 220, 220], [PX.opening]: [20, 20, 40], [PX.roofBand]: [230, 120, 20] };
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

export function mapImage(res, w, h) {
  const out = new Uint8ClampedArray(w * h * 4), { px, id, clusters } = res.maps;
  const cols = clusters.map((c) => hex(c.hex));
  for (let i = 0; i < w * h; i++) {
    const c = px[i] === PX.wall && id[i] >= 0 ? cols[id[i]] : (FLAT[px[i]] || [255, 0, 255]);
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}
export function legendOf(res, title) {
  const L = [{ hex: null, text: title }];
  for (const c of res.walls) L.push({ hex: c.hex, text: `${c.material.padEnd(13)} ${c.hex} ${String(Math.round(c.share * 100)).padStart(2)}%  e1 ${c.e1} e4 ${c.e4} cv ${c.cv}  hue ${c.hue} C ${c.chroma} L ${c.lab[0]}` });
  for (const a of res.accents) L.push({ hex: a.hex, text: `accent        ${a.hex} ${(a.share * 100).toFixed(1)}%  hue ${a.hue} C ${a.chroma}` });
  for (const r of res.roofs) L.push({ hex: r.hex, text: `roof ${r.material.padEnd(8)} ${r.hex} ${Math.round(r.share * 100)}% (low confidence)` });
  return L;
}
