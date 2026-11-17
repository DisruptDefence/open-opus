// Image decoding through a Playwright page (no image library is added): one page, reused. Playwright is not a
// dependency: its module path comes from --playwright or the PLAYWRIGHT variable, as the engine's own tools take it.
import { createRequire } from 'node:module';

export async function openDecoder(playwrightPath) {
  if (!playwrightPath) throw new Error('Set PLAYWRIGHT (or --playwright) to the path of an installed playwright module.');
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('about:blank');
  return {
    /** Decode image bytes, scale to `width` px wide, return { w, h, rgba: Buffer }. */
    async decode(buf, mime, width = 320) {
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
    /** A transparent PNG (Buffer) painting the region mask in translucent colours, for overlays. */
    async overlay(mask, w, h) {
      const b64 = await page.evaluate(({ m, w, h }) => {
        const bin = atob(m), c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'), img = x.createImageData(w, h), col = [[255, 140, 0, 110], [40, 120, 255, 120], [40, 200, 90, 120]];
        for (let i = 0; i < w * h; i++) { const k = col[bin.charCodeAt(i)]; img.data.set(k, i * 4); }
        x.putImageData(img, 0, 0); return c.toDataURL('image/png').split(',')[1];
      }, { m: Buffer.from(mask).toString('base64'), w, h });
      return Buffer.from(b64, 'base64');
    },
    close: () => browser.close(),
  };
}
