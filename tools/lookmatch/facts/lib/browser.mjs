// Image decoding and overlay PNGs through a Playwright page (copy of lib/browser.mjs: decode at any width, and
// a PNG writer that composes the picture, the cluster map and a legend). Playwright is given as a path.
import { createRequire } from 'node:module';

export async function openDecoder(playwrightPath) {
  if (!playwrightPath) throw new Error('Set PLAYWRIGHT (or --playwright) to the path of an installed playwright module.');
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const b64of = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  return {
    async decode(buf, mime, width) {
      const r = await page.evaluate(async ({ b64, mime, width }) => {
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u], { type: mime }));
        const w = width, h = Math.max(1, Math.round((bmp.height * width) / bmp.width));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
        const d = x.getImageData(0, 0, w, h).data; let s = ''; const CH = 8192;
        for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
        return { w, h, b64: btoa(s) };
      }, { b64: Buffer.from(buf).toString('base64'), mime, width });
      return { w: r.w, h: r.h, rgba: Buffer.from(r.b64, 'base64') };
    },
    /** A PNG: left the photograph, right the map (RGBA), a legend strip below ([{ hex, text }]). */
    async sheet(left, map, w, h, legend) {
      const b64 = await page.evaluate(({ l, m, w, h, legend }) => {
        const un = (s) => { const bin = atob(s), u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
        const LH = 18 * (legend.length + 1), c = document.createElement('canvas'); c.width = w * 2; c.height = h + LH;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        const put = (data, ox) => { const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0); x.drawImage(t, ox, 0); };
        put(un(l), 0); put(un(m), w);
        x.font = '13px monospace'; x.textBaseline = 'middle';
        legend.forEach((e, i) => { const y = h + 18 * i + 9; if (e.hex) { x.fillStyle = e.hex; x.fillRect(4, y - 7, 22, 14); } x.fillStyle = '#000'; x.fillText(e.text, 32, y); });
        return c.toDataURL('image/png').split(',')[1];
      }, { l: b64of(left), m: b64of(map), w, h, legend });
      return Buffer.from(b64, 'base64');
    },
    close: () => browser.close(),
  };
}
