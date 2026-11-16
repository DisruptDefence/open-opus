// Loads a catalogue set into three.js textures: sRGB colour, linear normal, and one packed linear map (R = AO,
// G = roughness, B = height). Decoded off the main thread with createImageBitmap, one set at a time, resized to the
// quality's budget. A missing file or a browser without the APIs gives `null`, never a throw: the surface then stays
// procedural. The pure parts live in catalogue.js (tested under Node).
import { pickRes, setFiles, packOrm } from './catalogue.js';

export function createImageTextureLoader({ THREE, catalogue, root = '', maxRes = 1024, anisotropy = 4, fetchImpl, decode }) {
  const cache = new Map(); // set name -> Promise<{map, normal, orm}|null>
  let chain = Promise.resolve(); // one decode at a time: never a hitch of several sets together
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const dec = decode || (async (blob, side) => createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: side, resizeHeight: side, resizeQuality: 'high' }));
  async function bitmap(url, side) {
    const r = await doFetch(url);
    if (!r || !r.ok) throw new Error('missing ' + url);
    return dec(await r.blob(), side);
  }
  function grey(bmp, side) {
    const c = new OffscreenCanvas(side, side), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0, side, side);
    const d = x.getImageData(0, 0, side, side).data, g = new Uint8Array(side * side);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
    if (bmp.close) bmp.close();
    return g;
  }
  function tex(img, srgb) {
    const t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.flipY = false; t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  }
  async function build(entry) {
    const side = pickRes(entry.res, maxRes);
    if (!side || !doFetch) return null;
    const f = setFiles(catalogue, entry, root);
    const color = await bitmap(f.color, side);
    const normal = f.normal ? await bitmap(f.normal, side).catch(() => null) : null;
    const aoB = f.ao ? await bitmap(f.ao, side).catch(() => null) : null, roB = f.rough ? await bitmap(f.rough, side).catch(() => null) : null, heB = f.height ? await bitmap(f.height, side).catch(() => null) : null;
    const n = side * side;
    const data = packOrm(aoB && grey(aoB, side), roB && grey(roB, side), heB && grey(heB, side), n);
    if (!roB) for (let i = 0; i < n; i++) data[i * 4 + 1] = 200; // no roughness map: a matte default, not a mirror
    const orm = new THREE.DataTexture(data, side, side, THREE.RGBAFormat, THREE.UnsignedByteType);
    orm.wrapS = orm.wrapT = THREE.RepeatWrapping; orm.minFilter = THREE.LinearMipmapLinearFilter; orm.magFilter = THREE.LinearFilter; orm.generateMipmaps = true; orm.anisotropy = anisotropy; orm.needsUpdate = true;
    return { map: tex(color, true), normal: normal ? tex(normal, false) : null, orm, side };
  }
  return {
    /** A promise of the textures of a set entry, or null when they cannot be had (cached either way). */
    load(entry) {
      if (!cache.has(entry.name)) {
        const p = chain.then(() => build(entry)).catch((e) => { console.warn(`[detail] ${entry.name}: ${(e && e.message) || e}`); return null; });
        chain = p.then(() => {}, () => {});
        cache.set(entry.name, p);
      }
      return cache.get(entry.name);
    },
    has: (name) => cache.has(name),
    dispose() { for (const p of cache.values()) p.then((s) => { if (s) { s.map.dispose(); s.normal && s.normal.dispose(); s.orm.dispose(); } }); cache.clear(); },
  };
}
