// node encode.mjs  : re-encode raw jpgs under /tmp/pbr/dl/{acg,ph}/<id>/raw into /tmp/pbr/stage/<name>/<map>.webp + meta.json
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);
const Q = { color: 0.86, normal: 0.92, rough: 0.8, ao: 0.8, height: 0.72, metal: 0.8 };
const jobs = [];
for (const src of ['acg', 'ph']) for (const id of fs.readdirSync(`/tmp/pbr/dl/${src}`)) {
  const raw = `/tmp/pbr/dl/${src}/${id}/raw`; if (!fs.existsSync(raw) || !fs.existsSync(raw + '/color.jpg')) { console.log('skip', src, id); continue; }
  jobs.push({ src, id, name: src === 'acg' ? id.toLowerCase() : id, raw });
}
const b = await chromium.launch();
async function work(list) {
  const p = await b.newPage(); await p.goto('about:blank');
  for (const j of list) {
    const out = `/tmp/pbr/stage/${j.name}`; if (fs.existsSync(out + '/meta.json')) continue;
    fs.mkdirSync(out, { recursive: true }); const meta = { src: j.src, id: j.id, maps: {}, bytes: 0 };
    for (const m of Object.keys(Q)) {
      const f = `${j.raw}/${m}.jpg`; if (!fs.existsSync(f)) continue;
      const b64 = fs.readFileSync(f).toString('base64');
      const r = await p.evaluate(async ([b64, q, isColor]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/webp', quality: q });
        const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 8192) s += String.fromCharCode.apply(null, ab.subarray(i, i + 8192));
        let avg = null;
        if (isColor) { const t = new OffscreenCanvas(32, 32).getContext('2d'); t.drawImage(bmp, 0, 0, 32, 32); const d = t.getImageData(0, 0, 32, 32).data; const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; let r = 0, g = 0, bl = 0; for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); g += lin(d[i + 1]); bl += lin(d[i + 2]); } const n = d.length / 4; avg = [r / n, g / n, bl / n]; }
        return { b64: btoa(s), w: bmp.width, h: bmp.height, avg };
      }, [b64, Q[m], m === 'color']);
      const buf = Buffer.from(r.b64, 'base64'); fs.writeFileSync(`${out}/${m}.webp`, buf);
      meta.maps[m] = { w: r.w, h: r.h, bytes: buf.length }; meta.bytes += buf.length; if (r.avg) meta.avg = r.avg;
    }
    fs.writeFileSync(out + '/meta.json', JSON.stringify(meta)); process.stdout.write('.');
  }
  await p.close();
}
const N = 4, parts = Array.from({ length: N }, (_, i) => jobs.filter((_, k) => k % N === i));
await Promise.all(parts.map(work)); await b.close(); console.log('\ndone', jobs.length);
