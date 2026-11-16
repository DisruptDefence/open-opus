// The image detail layer: lays a catalogue set (colour, normal, roughness, AO from real photographs, CC0) over a
// procedural triplanar material of the lifted library, by real metres. It is a patch of the material's own shader
// (one draw call stays one draw call), chained after the library's patch; materials the style pack does not map, and
// every material when the quality is low, the files are missing or the browser is headless, are untouched.
//
//   colour   the image's colour relative to its own average, times the material's tint (the palette; vertex colour
//            multiplies later) times `base`: the palette decides the hue, the photograph the structure and the tone.
//   normal   the image's relief replaces the procedural relief by the same strength.
//   rough/ao the image's values replace the procedural ones by their mixes.
//   no tiling: each tile of the image is sampled at a random offset and neighbouring tiles are blended in a narrow
//            band at the seam (1 tap inside, up to 4 at a seam).
//   distance the layer fades out between 55 % and 100 % of `far` and is not sampled beyond it.
import { parseCatalogue, resolveDetail, detailBudget, tileMetres } from './catalogue.js';
import { createImageTextureLoader } from './imagetex.js';

const DECL = `
#ifdef SL_DETAIL
uniform sampler2D uDtMap; uniform sampler2D uDtNrm; uniform sampler2D uDtOrm;
uniform vec4 uDt;   // x strength, y normal, z rough mix, w ao mix
uniform vec4 uDtA;  // rgb average colour of the set (linear), w far distance in m
uniform vec4 uDtB;  // x 1/tile u, y 1/tile v, z base brightness, w hue kept
uniform vec4 uDtT;  // rgb colour multiplier (warm / cool the set)
#ifdef SL_DETAIL_ALT
uniform sampler2D uDtMap2; uniform sampler2D uDtNrm2; uniform sampler2D uDtOrm2;
uniform vec4 uDtC;  // x noise threshold, y softness, z noise frequency (1/m), w unused
uniform vec4 uDtD;  // rgb average colour of the patch set, w its tone
uniform vec4 uDtE;  // x 1/tile u, y 1/tile v, z hue kept, w 1 once the patch set is loaded
#endif
vec2 slDnX = vec2(0.0); vec2 slDnY = vec2(0.0); vec2 slDnZ = vec2(0.0); float slDtF = 0.0;
vec2 dtHash(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
void dtSample(sampler2D tMap, sampler2D tNrm, sampler2D tOrm, vec2 q, vec2 dx, vec2 dy, out vec3 col, out vec2 nrm, out vec3 orm){
  vec2 c = floor(q), f = q - c; const float B = 0.12;
  vec2 s = vec2(f.x < B ? -1.0 : (f.x > 1.0 - B ? 1.0 : 0.0), f.y < B ? -1.0 : (f.y > 1.0 - B ? 1.0 : 0.0));
  vec2 w1 = vec2(s.x < 0.0 ? 0.5 * (1.0 - f.x / B) : (s.x > 0.0 ? 0.5 * (1.0 - (1.0 - f.x) / B) : 0.0), s.y < 0.0 ? 0.5 * (1.0 - f.y / B) : (s.y > 0.0 ? 0.5 * (1.0 - (1.0 - f.y) / B) : 0.0));
  col = vec3(0.0); nrm = vec2(0.0); orm = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    float w = (i == 0 ? 1.0 - w1.x : w1.x) * (j == 0 ? 1.0 - w1.y : w1.y);
    if (w < 0.002) continue;
    vec2 uv = q + dtHash(c + vec2(float(i) * s.x, float(j) * s.y));
    col += w * textureGrad(tMap, uv, dx, dy).rgb;
    nrm += w * (textureGrad(tNrm, uv, dx, dy).xy * 2.0 - 1.0);
    orm += w * textureGrad(tOrm, uv, dx, dy).rgb;
  }
}
// one projection axis: the colour multiplier (relative to the set's own average, hue kept by uDtB.w), the normal and AO/rough/height; am = share of the patch set
vec3 dtAxis(vec2 q, vec2 dx, vec2 dy, vec2 q2, vec2 dx2, vec2 dy2, float am, out vec2 nrm, out vec3 orm){
  vec3 c, o, res = vec3(0.0); vec2 n; nrm = vec2(0.0); orm = vec3(0.0);
  if (am < 0.999) {
    dtSample(uDtMap, uDtNrm, uDtOrm, q, dx, dy, c, n, o);
    float lum = max(dot(uDtA.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    res = mix(clamp(c / max(uDtA.rgb, vec3(0.02)), 0.0, 3.0), clamp(c / lum, 0.0, 3.0), uDtB.w) * (1.0 - am); nrm = n * (1.0 - am); orm = o * (1.0 - am);
  }
#ifdef SL_DETAIL_ALT
  if (am > 0.001) {
    dtSample(uDtMap2, uDtNrm2, uDtOrm2, q2, dx2, dy2, c, n, o);
    float lum = max(dot(uDtD.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
    res += mix(clamp(c / max(uDtD.rgb, vec3(0.02)), 0.0, 3.0), clamp(c / lum, 0.0, 3.0), uDtE.z) * (uDtD.w * am); nrm += n * am; orm += o * am;
  }
#endif
  return res;
}
#endif
`;

const BLOCK = `
#if defined( SL_DETAIL ) && defined( SL_TRIPLANAR )
  { float dtDist = length(vViewPosition);
    slDtF = uDt.x * (1.0 - smoothstep(uDtA.w * 0.55, uDtA.w, dtDist));
    vec2 dtI = uDtB.xy; vec2 dqx = vSlPos.zy * dtI, dqy = vSlPos.xz * dtI, dqz = vSlPos.xy * dtI;
    vec2 dxx = dFdx(dqx), dyx = dFdy(dqx), dxy = dFdx(dqy), dyy = dFdy(dqy), dxz = dFdx(dqz), dyz = dFdy(dqz);
    vec2 eqx = dqx, eqy = dqy, eqz = dqz, ex1 = dxx, ey1 = dyx, ex2 = dxy, ey2 = dyy, ex3 = dxz, ey3 = dyz; float dam = 0.0;
#ifdef SL_DETAIL_ALT
    if (uDtE.w > 0.5 && slDtF > 0.004) {
      float dn = slN3(vSlPos * uDtC.z) * 0.65 + slN3(vSlPos * (uDtC.z * 2.9) + 7.7) * 0.35;
      dam = smoothstep(uDtC.x - uDtC.y, uDtC.x + uDtC.y + 1e-4, dn);
      vec2 dtJ = uDtE.xy; eqx = vSlPos.zy * dtJ; eqy = vSlPos.xz * dtJ; eqz = vSlPos.xy * dtJ;
      ex1 = dFdx(eqx); ey1 = dFdy(eqx); ex2 = dFdx(eqy); ey2 = dFdy(eqy); ex3 = dFdx(eqz); ey3 = dFdy(eqz);
    }
#endif
    if (slDtF > 0.004) {
      vec3 dc = vec3(0.0), dorm = vec3(0.0), o1; vec2 n1; float dw = 0.0;
      if (slTw.x > 0.03) { dc += dtAxis(dqx, dxx, dyx, eqx, ex1, ey1, dam, n1, o1) * slTw.x; dorm += o1 * slTw.x; slDnX = n1; dw += slTw.x; }
      if (slTw.y > 0.03) { dc += dtAxis(dqy, dxy, dyy, eqy, ex2, ey2, dam, n1, o1) * slTw.y; dorm += o1 * slTw.y; slDnY = n1; dw += slTw.y; }
      if (slTw.z > 0.03) { dc += dtAxis(dqz, dxz, dyz, eqz, ex3, ey3, dam, n1, o1) * slTw.z; dorm += o1 * slTw.z; slDnZ = n1; dw += slTw.z; }
      dc /= dw; dorm /= dw;
      float dM = 1.0 + uSlMacro.x * 2.0 * (slMac * 0.65 + slMac2 * 0.35 - 0.5);
      vec3 dAlb = diffuse * uDtB.z * uDtT.rgb * dc * dM;
      diffuseColor.rgb = mix(diffuseColor.rgb, dAlb, slDtF);
      slORM.r = mix(slORM.r, dorm.r, slDtF * uDt.w);
      slORM.g = mix(slORM.g, dorm.g, slDtF * uDt.z);
    }
  }
#endif
`;

const NORMALS = `slTx.xy *= normalScale; slTy.xy *= normalScale; slTz.xy *= normalScale;
#ifdef SL_DETAIL
  slTx.xy = mix(slTx.xy, slDnX * uDt.y, slDtF); slTy.xy = mix(slTy.xy, slDnY * uDt.y, slDtF); slTz.xy = mix(slTz.xy, slDnZ * uDt.y, slDtF);
#endif`;

const M_DECL = 'varying vec3 vSlPos;', M_BLOCK = '#ifdef SL_FX\n  { float slLum', M_NRM = 'slTx.xy *= normalScale; slTy.xy *= normalScale; slTz.xy *= normalScale;';

/** The fragment source with the detail layer built in, after the library's patch. ok = false (source untouched) when a marker is missing. */
export function patchDetailSource(src) {
  if (!(src.includes(M_DECL) && src.includes(M_BLOCK) && src.includes(M_NRM))) return { ok: false, src };
  let out = src.replace(M_DECL, M_DECL + DECL);
  out = out.replace(M_BLOCK, BLOCK + M_BLOCK);
  out = out.replace(M_NRM, NORMALS);
  return { ok: true, src: out };
}

/**
 * Wraps the material library's constructor: the same library, plus `setDetail(block, opts)` that reads the style pack's
 * detail block and starts loading the sets of the materials it names. Everything else passes through.
 */
export function withDetail(create) {
  return async function createWithDetail(G) {
    const mats = await create(G);
    const THREE = G.THREE, seen = new Map(), live = new Map(); // seen: material name -> materials; live: name -> state
    const dummies = (() => {
      if (!THREE || !THREE.DataTexture) return null;
      const mk = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return t; };
      return { map: mk(255, 255, 255), nrm: mk(128, 128, 255), orm: mk(255, 255, 128) };
    })();
    const origGet = mats.get;
    function attach(T, name) {
      const st = live.get(name);
      if (!st || !T.userData || !T.userData.sl || !T.defines || T.defines.SL_TRIPLANAR === undefined || T.userData.dt) return;
      T.userData.dt = true; T.defines.SL_DETAIL = '';
      if (st.spec.alt) T.defines.SL_DETAIL_ALT = '';
      const prev = T.onBeforeCompile, key = T.customProgramCacheKey ? T.customProgramCacheKey() : '';
      T.onBeforeCompile = (sh, r) => {
        prev && prev(sh, r);
        const p = patchDetailSource(sh.fragmentShader);
        if (!p.ok) { console.warn('[detail] shader markers not found; detail layer off'); return; }
        sh.fragmentShader = p.src; Object.assign(sh.uniforms, st.uniforms);
      };
      T.customProgramCacheKey = () => key + (st.spec.alt ? 'dta' : 'dt');
      T.needsUpdate = true;
    }
    mats.get = (name, opts) => {
      const T = origGet(name, opts);
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(T); attach(T, name);
      return T;
    };
    mats.setDetail = async (block, opts = {}) => {
      const budget = detailBudget(G.quality);
      if (!block || !budget.maxRes || !dummies || typeof fetch !== 'function') return { loaded: 0, off: true };
      const root = opts.root || new URL('../../../assets/textures/', import.meta.url).href;
      let json;
      try { const r = await fetch(new URL(block.catalogue || 'catalogue.json', root).href); if (!r.ok) throw new Error(r.status); json = await r.json(); }
      catch (e) { console.warn('[detail] no catalogue: ' + ((e && e.message) || e)); return { loaded: 0, off: true }; }
      const cat = parseCatalogue(json), res = resolveDetail(block, cat);
      for (const p of res.problems) console.warn('[detail] ' + p);
      const loader = createImageTextureLoader({ THREE, catalogue: cat, root, maxRes: budget.maxRes, anisotropy: Math.min(4, G.renderer?.capabilities?.getMaxAnisotropy?.() || 1) });
      let loaded = 0;
      for (const [name, spec] of res.materials) {
        const u = { uDtMap: { value: dummies.map }, uDtNrm: { value: dummies.nrm }, uDtOrm: { value: dummies.orm }, uDt: { value: new THREE.Vector4(0, spec.normal, spec.rough, spec.ao) },
          uDtA: { value: new THREE.Vector4(0.3, 0.3, 0.3, Math.min(spec.far, budget.far)) }, uDtB: { value: new THREE.Vector4(1, 1, spec.base, spec.hue) }, uDtT: { value: new THREE.Vector4(spec.tint[0], spec.tint[1], spec.tint[2], 1) } };
        if (spec.alt) Object.assign(u, { uDtMap2: { value: dummies.map }, uDtNrm2: { value: dummies.nrm }, uDtOrm2: { value: dummies.orm },
          uDtC: { value: new THREE.Vector4(spec.alt.threshold, spec.alt.edge, 1 / spec.alt.size, 0) }, uDtD: { value: new THREE.Vector4(0.3, 0.3, 0.3, spec.alt.tone) },
          uDtE: { value: new THREE.Vector4(1, 1, spec.alt.hue, 0) } });
        live.set(name, { uniforms: u, spec });
        for (const T of seen.get(name) || []) attach(T, name);
      }
      for (const [name, spec] of res.materials) { // one material at a time, in the order of the pack
        for (const entry of spec.entries) {
          const set = await loader.load(entry);
          if (!set) continue;
          const u = live.get(name).uniforms, tile = tileMetres(spec, entry);
          u.uDtMap.value = set.map; u.uDtNrm.value = set.normal || dummies.nrm; u.uDtOrm.value = set.orm;
          u.uDtA.value.set(entry.avg[0], entry.avg[1], entry.avg[2], u.uDtA.value.w); u.uDtB.value.x = 1 / tile[0]; u.uDtB.value.y = 1 / tile[1];
          u.uDt.value.x = spec.strength; loaded++; break;
        }
        if (spec.alt && live.get(name).uniforms.uDt.value.x > 0) for (const entry of spec.alt.entries) { // the patch set, after the main one
          const set = await loader.load(entry);
          if (!set) continue;
          const u = live.get(name).uniforms, tile = [entry.tile[0] * spec.alt.scale, entry.tile[1] * spec.alt.scale];
          u.uDtMap2.value = set.map; u.uDtNrm2.value = set.normal || dummies.nrm; u.uDtOrm2.value = set.orm;
          u.uDtD.value.set(entry.avg[0], entry.avg[1], entry.avg[2], spec.alt.tone); u.uDtE.value.set(1 / tile[0], 1 / tile[1], spec.alt.hue, 1); loaded++; break;
        }
      }
      mats.detail = { sets: loaded, materials: [...res.materials.keys()], tier: budget.name, root };
      return mats.detail;
    };
    return mats;
  };
}
